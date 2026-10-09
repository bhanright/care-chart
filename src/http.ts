// Small helpers shared by every route: JSON responses, input checking and time.

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Needed once, to create the first caregiver account on a fresh deployment. */
  SETUP_CODE?: string;
  /** Web Push keys from `npm run vapid`: the public key raw, the private key as its "d" value. */
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  /** Who push services can contact about this sender: "mailto:you@example.com". */
  VAPID_SUBJECT?: string;
}

/**
 * Headers for every response. The static files get the same set from public/_headers.
 * The policy allows only this site's own scripts, styles and connections.
 */
export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data: blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
};

/** Thrown by route code to answer with an error status and a message the browser can show. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // Medical records must never sit in a shared or browser cache.
      "Cache-Control": "no-store",
      ...SECURITY_HEADERS,
      ...headers,
    },
  });
}

export function nowIso(): string {
  return new Date().toISOString();
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    // fall through to the error below
  }
  throw new HttpError(400, "The request body must be a JSON object.");
}

// ---- Field readers. Each one names the field in its error so the form can say what is wrong.

export function text(body: Record<string, unknown>, field: string, maximumLength = 2000, required = false): string {
  const value = body[field];
  if (value === undefined || value === null) {
    if (required) throw new HttpError(400, `${field} is required.`);
    return "";
  }
  if (typeof value !== "string") throw new HttpError(400, `${field} must be text.`);
  const trimmed = value.trim();
  if (required && trimmed === "") throw new HttpError(400, `${field} is required.`);
  if (trimmed.length > maximumLength) throw new HttpError(400, `${field} is too long (limit ${maximumLength}).`);
  return trimmed;
}

export function optionalNumber(body: Record<string, unknown>, field: string, minimum: number, maximum: number): number | null {
  const value = body[field];
  if (value === undefined || value === null || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new HttpError(400, `${field} must be a number from ${minimum} to ${maximum}.`);
  }
  return number;
}

export function timestamp(body: Record<string, unknown>, field: string, required = true): string | null {
  const value = body[field];
  if (value === undefined || value === null || value === "") {
    if (required) throw new HttpError(400, `${field} is required.`);
    return null;
  }
  const parsed = typeof value === "string" ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) throw new HttpError(400, `${field} must be a date and time.`);
  return parsed.toISOString();
}

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function localDate(body: Record<string, unknown>, field: string): string | null {
  const value = body[field];
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !LOCAL_DATE.test(value)) throw new HttpError(400, `${field} must be a date (YYYY-MM-DD).`);
  return value;
}

export function oneOf<T extends string>(body: Record<string, unknown>, field: string, allowed: readonly T[], fallback?: T): T {
  const value = body[field];
  if ((value === undefined || value === null || value === "") && fallback !== undefined) return fallback;
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) return value as T;
  throw new HttpError(400, `${field} must be one of: ${allowed.join(", ")}.`);
}

/** Reads ?from= and ?to= as a time range, defaulting to the last day. */
export function timeRange(url: URL): { from: string; to: string } {
  const to = url.searchParams.get("to");
  const from = url.searchParams.get("from");
  const toDate = to ? new Date(to) : new Date();
  const fromDate = from ? new Date(from) : new Date(toDate.getTime() - 24 * 3600 * 1000);
  if (Number.isNaN(toDate.getTime()) || Number.isNaN(fromDate.getTime())) {
    throw new HttpError(400, "from and to must be dates.");
  }
  return { from: fromDate.toISOString(), to: toDate.toISOString() };
}
