// Web Push with no dependencies: VAPID signing (RFC 8292) and payload encryption
// (RFC 8291, aes128gcm), both done with WebCrypto. Copied from the Dinner Picker
// project, where it is tested against the RFC's worked example.
import type { Env } from "./http";

export interface PushSubscriptionJson {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface Notice {
  title: string;
  body: string;
  url: string;
  // Notifications with the same tag replace each other; different tags stack.
  tag?: string;
  // Keeps the notification on screen until it's dealt with.
  urgent?: boolean;
}

interface SubscriptionRow {
  endpoint: string;
  key_p256dh: string;
  key_auth: string;
}

/**
 * Sends to every subscribed device and forgets devices the push service says are gone.
 * Returns how many devices accepted the notification.
 */
export async function notifyAll(env: Env, notice: Notice): Promise<number> {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return 0;
  const { results } = await env.DB.prepare("SELECT endpoint, key_p256dh, key_auth FROM push_subscriptions").all<SubscriptionRow>();
  const subject = env.VAPID_SUBJECT || "mailto:care-chart@example.com";
  const statuses = await Promise.all(results.map((row) =>
    sendPush(env, { endpoint: row.endpoint, keys: { p256dh: row.key_p256dh, auth: row.key_auth } }, JSON.stringify(notice), subject)
      .catch(() => 0)));
  const gone = results.filter((_, index) => statuses[index] === 404 || statuses[index] === 410);
  if (gone.length) {
    await env.DB.batch(gone.map((row) => env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(row.endpoint)));
  }
  return statuses.filter((status) => status >= 200 && status < 300).length;
}

const REMINDER_LIFETIME_SECONDS = 4 * 3600;

// Returns the push service's HTTP status.
export async function sendPush(
  env: Env,
  sub: PushSubscriptionJson,
  payload: string,
  subject: string,
): Promise<number> {
  const body = await encryptPayload(sub, new TextEncoder().encode(payload));
  const jwt = await vapidToken(env, new URL(sub.endpoint).origin, subject);
  const response = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      // A dose reminder is stale after a few hours; don't deliver it tomorrow.
      TTL: String(REMINDER_LIFETIME_SECONDS),
      Urgency: "high",
    },
    body,
  });
  if (!response.ok) {
    console.error(`Push to ${new URL(sub.endpoint).host} failed (${response.status}): ${await response.text()}`);
  }
  return response.status;
}

// ---- VAPID ------------------------------------------------------------------

async function vapidToken(env: Env, audience: string, subject: string): Promise<string> {
  const publicRaw = fromBase64Url(env.VAPID_PUBLIC_KEY!);
  const key = await crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      d: env.VAPID_PRIVATE_KEY,
      x: toBase64Url(publicRaw.slice(1, 33)),
      y: toBase64Url(publicRaw.slice(33, 65)),
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const encode = (value: object) => toBase64Url(new TextEncoder().encode(JSON.stringify(value)));
  const unsigned = `${encode({ typ: "JWT", alg: "ES256" })}.${encode({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: subject,
  })}`;
  // WebCrypto returns the raw r||s signature, which is the form JWS uses.
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(unsigned),
  );
  return `${unsigned}.${toBase64Url(new Uint8Array(signature))}`;
}

// ---- Payload encryption (RFC 8291) -----------------------------------------

const RECORD_SIZE = 4096;

// `fixed` exists only so the RFC's worked example can be reproduced in a test.
export async function encryptPayload(
  sub: PushSubscriptionJson,
  plaintext: Uint8Array,
  fixed?: { senderPrivate: string; senderPublic: string; salt: string },
): Promise<Uint8Array> {
  const receiverPublic = fromBase64Url(sub.keys.p256dh);
  const authSecret = fromBase64Url(sub.keys.auth);
  const salt = fixed ? fromBase64Url(fixed.salt) : crypto.getRandomValues(new Uint8Array(16));

  let senderPrivateKey: CryptoKey;
  let senderPublic: Uint8Array;
  if (fixed) {
    senderPublic = fromBase64Url(fixed.senderPublic);
    senderPrivateKey = await crypto.subtle.importKey(
      "jwk",
      {
        kty: "EC", crv: "P-256", d: fixed.senderPrivate,
        x: toBase64Url(senderPublic.slice(1, 33)), y: toBase64Url(senderPublic.slice(33, 65)),
      },
      { name: "ECDH", namedCurve: "P-256" },
      false,
      ["deriveBits"],
    );
  } else {
    const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
      "deriveBits",
    ])) as CryptoKeyPair;
    senderPrivateKey = pair.privateKey;
    senderPublic = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  }

  const receiverKey = await crypto.subtle.importKey(
    "raw", receiverPublic, { name: "ECDH", namedCurve: "P-256" }, false, [],
  );
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      // Workers' types name this field `$public`; the WebCrypto standard calls it `public`.
      { name: "ECDH", public: receiverKey } as unknown as SubtleCryptoDeriveKeyAlgorithm,
      senderPrivateKey,
      256,
    ),
  );

  const keyInfo = concat(text("WebPush: info\0"), receiverPublic, senderPublic);
  const inputKey = await hkdf(authSecret, sharedSecret, keyInfo, 32);
  const contentKey = await hkdf(salt, inputKey, text("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, inputKey, text("Content-Encoding: nonce\0"), 12);

  // One record, so it ends with the "last record" delimiter 0x02 and no padding.
  const record = concat(plaintext, new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey("raw", contentKey, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, record),
  );

  const header = new Uint8Array(16 + 4 + 1 + senderPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = senderPublic.length;
  header.set(senderPublic, 21);
  return concat(header, ciphertext);
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8),
  );
}

// ---- Bytes ------------------------------------------------------------------

function text(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(s: string): Uint8Array {
  const base64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
