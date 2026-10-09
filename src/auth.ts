// Caregiver accounts and sign-in sessions.
//
// Passwords are stored as salted PBKDF2 hashes. A session is a random token kept in an
// HttpOnly cookie; the database holds only its SHA-256, so a leaked database cannot be
// used to sign in.

import { HttpError, json, nowIso, readJson, text, type Env } from "./http";

const SESSION_COOKIE = "care_chart_session";
const SESSION_DAYS = 60;
const PBKDF2_ITERATIONS = 100_000; // the most Cloudflare Workers allows
const LOCKOUT_FAILED_ATTEMPTS = 8;
const LOCKOUT_WINDOW_MINUTES = 15;
const MINIMUM_PASSWORD_LENGTH = 8;

export interface Caregiver {
  id: number;
  name: string;
  initials: string;
}

// ---- Hashing

function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of array) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(encoded: string): Uint8Array {
  return Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
}

async function hashPassword(password: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
    key,
    256,
  );
  return toBase64(bits);
}

async function sha256(value: string): Promise<string> {
  return toBase64(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

/** Compares two strings in time that does not depend on where they first differ. */
function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index++) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}

function initialsOf(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[words.length - 1][0] : name.slice(0, 2);
  return letters.toUpperCase();
}

function checkPassword(password: string): void {
  if (password.length < MINIMUM_PASSWORD_LENGTH) {
    throw new HttpError(400, `Passwords need at least ${MINIMUM_PASSWORD_LENGTH} characters.`);
  }
}

export async function createCaregiver(env: Env, name: string, password: string, initials = ""): Promise<Caregiver> {
  checkPassword(password);
  const existing = await env.DB.prepare("SELECT id FROM caregivers WHERE name = ?").bind(name).first();
  if (existing) throw new HttpError(409, `There is already a caregiver named ${name}.`);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await hashPassword(password, salt);
  const finalInitials = (initials || initialsOf(name)).slice(0, 4).toUpperCase();
  const row = await env.DB.prepare(
    `INSERT INTO caregivers (name, initials, password_hash, password_salt, created_at)
     VALUES (?, ?, ?, ?, ?) RETURNING id, name, initials`,
  ).bind(name, finalInitials, hash, toBase64(salt), nowIso()).first<Caregiver>();
  return row!;
}

// ---- Sessions

function cookieValue(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

function sessionCookie(token: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
}

async function startSession(env: Env, caregiverId: number): Promise<string> {
  const token = toBase64(crypto.getRandomValues(new Uint8Array(32))).replace(/[^A-Za-z0-9]/g, "");
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000).toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(nowIso()),
    env.DB.prepare("INSERT INTO sessions (token_hash, caregiver_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .bind(await sha256(token), caregiverId, nowIso(), expires),
  ]);
  return token;
}

/** The signed-in caregiver, or null. */
export async function currentCaregiver(request: Request, env: Env): Promise<Caregiver | null> {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return null;
  return await env.DB.prepare(
    `SELECT caregivers.id, caregivers.name, caregivers.initials
       FROM sessions JOIN caregivers ON caregivers.id = sessions.caregiver_id
      WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
  ).bind(await sha256(token), nowIso()).first<Caregiver>();
}

function clientAddress(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "local";
}

function lockoutWindowStart(): string {
  return new Date(Date.now() - LOCKOUT_WINDOW_MINUTES * 60_000).toISOString();
}

/** Refuses sign-in and setup attempts from an address with too many recent failures. */
async function refuseIfLockedOut(env: Env, address: string): Promise<void> {
  const failures = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM failed_logins WHERE address = ? AND failed_at > ?",
  ).bind(address, lockoutWindowStart()).first<{ count: number }>();
  if ((failures?.count ?? 0) >= LOCKOUT_FAILED_ATTEMPTS) {
    throw new HttpError(429, `Too many wrong attempts. Try again in ${LOCKOUT_WINDOW_MINUTES} minutes.`);
  }
}

async function recordFailure(env: Env, address: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM failed_logins WHERE failed_at < ?").bind(lockoutWindowStart()),
    env.DB.prepare("INSERT INTO failed_logins (address, failed_at) VALUES (?, ?)").bind(address, nowIso()),
  ]);
}

async function passwordMatches(env: Env, caregiverId: number, password: string): Promise<boolean> {
  const account = await env.DB.prepare("SELECT password_hash, password_salt FROM caregivers WHERE id = ?")
    .bind(caregiverId).first<{ password_hash: string; password_salt: string }>();
  return Boolean(account && sameString(await hashPassword(password, fromBase64(account.password_salt)), account.password_hash));
}

async function setPassword(env: Env, caregiverId: number, password: string): Promise<void> {
  checkPassword(password);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  await env.DB.prepare("UPDATE caregivers SET password_hash = ?, password_salt = ? WHERE id = ?")
    .bind(await hashPassword(password, salt), toBase64(salt), caregiverId).run();
}

/** Signs a caregiver out on every device except, optionally, the one making the request. */
async function endSessions(env: Env, caregiverId: number, keepRequest: Request | null): Promise<void> {
  const keepToken = keepRequest ? cookieValue(keepRequest, SESSION_COOKIE) : null;
  await env.DB.prepare("DELETE FROM sessions WHERE caregiver_id = ? AND token_hash != ?")
    .bind(caregiverId, keepToken ? await sha256(keepToken) : "").run();
}

// ---- Routes that work without a session

export async function handlePublicAuthRoute(request: Request, url: URL, env: Env): Promise<Response | null> {
  const path = url.pathname;
  const method = request.method;

  if (path === "/api/setup-status" && method === "GET") {
    const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM caregivers").first<{ count: number }>();
    return json({ needsSetup: (row?.count ?? 0) === 0, setupCodeConfigured: Boolean(env.SETUP_CODE) });
  }

  if (path === "/api/setup" && method === "POST") {
    const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM caregivers").first<{ count: number }>();
    if ((row?.count ?? 0) > 0) throw new HttpError(403, "Setup is already done. Sign in instead.");
    if (!env.SETUP_CODE) throw new HttpError(503, "SETUP_CODE has not been set on the server. See the README.");
    const address = clientAddress(request);
    await refuseIfLockedOut(env, address);
    const body = await readJson(request);
    if (!sameString(text(body, "setupCode", 200, true), env.SETUP_CODE)) {
      await recordFailure(env, address);
      throw new HttpError(403, "That setup code is not right.");
    }
    const caregiver = await createCaregiver(env, text(body, "name", 60, true), text(body, "password", 200, true));
    const token = await startSession(env, caregiver.id);
    return json({ caregiver }, 200, { "Set-Cookie": sessionCookie(token, SESSION_DAYS * 86400) });
  }

  if (path === "/api/login" && method === "POST") {
    const address = clientAddress(request);
    await refuseIfLockedOut(env, address);

    const body = await readJson(request);
    const name = text(body, "name", 60, true);
    const password = text(body, "password", 200, true);
    const account = await env.DB.prepare(
      "SELECT id, name, initials, password_hash, password_salt FROM caregivers WHERE name = ?",
    ).bind(name).first<Caregiver & { password_hash: string; password_salt: string }>();

    // Hash even when the name is unknown, so timing does not reveal which names exist.
    const hash = await hashPassword(password, account ? fromBase64(account.password_salt) : new Uint8Array(16));
    if (!account || !sameString(hash, account.password_hash)) {
      await recordFailure(env, address);
      throw new HttpError(401, "Wrong name or password.");
    }
    const token = await startSession(env, account.id);
    const caregiver: Caregiver = { id: account.id, name: account.name, initials: account.initials };
    return json({ caregiver }, 200, { "Set-Cookie": sessionCookie(token, SESSION_DAYS * 86400) });
  }

  if (path === "/api/logout" && method === "POST") {
    const token = cookieValue(request, SESSION_COOKIE);
    if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
    return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", 0) });
  }

  return null;
}

// ---- Routes for signed-in caregivers

export async function handleCaregiverRoute(request: Request, url: URL, env: Env, me: Caregiver): Promise<Response | null> {
  const path = url.pathname;
  const method = request.method;

  if (path === "/api/caregivers" && method === "GET") {
    const { results } = await env.DB.prepare("SELECT id, name, initials FROM caregivers ORDER BY name").all<Caregiver>();
    return json({ caregivers: results });
  }

  if (path === "/api/caregivers" && method === "POST") {
    const body = await readJson(request);
    const caregiver = await createCaregiver(
      env, text(body, "name", 60, true), text(body, "password", 200, true), text(body, "initials", 4),
    );
    return json({ caregiver });
  }

  if (path === "/api/me/password" && method === "PUT") {
    const body = await readJson(request);
    if (!(await passwordMatches(env, me.id, text(body, "currentPassword", 200, true)))) {
      throw new HttpError(403, "Your current password is not right.");
    }
    await setPassword(env, me.id, text(body, "newPassword", 200, true));
    // A new password should lock out any lost or borrowed phone still signed in.
    await endSessions(env, me.id, request);
    return json({ ok: true });
  }

  if (path === "/api/me/sign-out-everywhere" && method === "POST") {
    await endSessions(env, me.id, request);
    return json({ ok: true });
  }

  // Sets a new password for another caregiver who has forgotten theirs. The caregiver
  // doing it confirms with their own password, so an unattended signed-in phone can't.
  const resetMatch = /^\/api\/caregivers\/(\d+)\/password$/.exec(path);
  if (resetMatch && method === "PUT") {
    const otherId = Number(resetMatch[1]);
    if (otherId === me.id) throw new HttpError(400, "Use Change password for your own account.");
    const body = await readJson(request);
    if (!(await passwordMatches(env, me.id, text(body, "yourPassword", 200, true)))) {
      throw new HttpError(403, "Your password is not right.");
    }
    const other = await env.DB.prepare("SELECT id FROM caregivers WHERE id = ?").bind(otherId).first();
    if (!other) throw new HttpError(404, "No such caregiver.");
    await setPassword(env, otherId, text(body, "newPassword", 200, true));
    await endSessions(env, otherId, null);
    return json({ ok: true });
  }

  return null;
}
