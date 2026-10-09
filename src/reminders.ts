// Dose reminders that reach phones even when Care Chart is closed and the screen is
// locked. A Cron Trigger (wrangler.jsonc) runs sendDueReminders every few minutes; it
// works out due doses with the same code the browser uses (public/js/schedule.js) and
// sends one Web Push notice to every subscribed device.

// @ts-expect-error -- plain JavaScript module shared with the browser
import { asNeededStatus, dosesNeedingAttention, isActive, normalizeMedication } from "../public/js/schedule.js";
// @ts-expect-error -- plain JavaScript module shared with the browser
import { formatClock, formatClockText, setHouseholdTimeZone } from "../public/js/time.js";
import type { Caregiver } from "./auth";
import { HttpError, json, nowIso, readJson, text, type Env } from "./http";
import { notifyAll } from "./push";

const LOOKBACK_HOURS = 48;
const FORGET_SENT_REMINDERS_AFTER_DAYS = 3;
const HOUR_MS = 3600 * 1000;

/** The parts of public/js/schedule.js results this file reads. */
interface SharedMedication { id: number; name: string; kind: "scheduled" | "as_needed" }
interface SharedSlot { medication: SharedMedication; scheduledFor: string; clockTime: string; state: string }

interface ReminderLine {
  key: string;
  text: string;
  overdue: boolean;
}

/** Everything that needs a caregiver right now, each with a key that identifies it. */
async function remindersDue(env: Env, now: Date): Promise<ReminderLine[]> {
  const preferences = await env.DB.prepare("SELECT value FROM settings WHERE key = 'preferences'").first<{ value: string }>();
  setHouseholdTimeZone(preferences ? JSON.parse(preferences.value).timeZone : null);

  const since = new Date(now.getTime() - LOOKBACK_HOURS * HOUR_MS).toISOString();
  const [medicationRows, administrations] = await Promise.all([
    env.DB.prepare("SELECT * FROM medications").all(),
    env.DB.prepare("SELECT * FROM administrations WHERE given_at >= ? OR scheduled_for >= ?").bind(since, since).all(),
  ]);
  const medications = medicationRows.results.map(normalizeMedication) as SharedMedication[];
  const lines: ReminderLine[] = [];

  for (const slot of dosesNeedingAttention(medications, administrations.results, now) as SharedSlot[]) {
    lines.push({
      key: `${slot.medication.id}|${slot.scheduledFor}|${slot.state}`,
      text: `${slot.medication.name} ${formatClockText(slot.clockTime)}${slot.state === "overdue" ? " (OVERDUE)" : ""}`,
      overdue: slot.state === "overdue",
    });
  }
  for (const medication of medications.filter((item) => item.kind === "as_needed")) {
    if (!isActive(medication, now)) continue;
    const status = asNeededStatus(medication, administrations.results, now);
    if (!status.followUpDue) continue;
    lines.push({
      key: `follow-up|${status.followUpDue.id}`,
      text: `did the ${formatClock(status.followUpDue.given_at)} ${medication.name} help?`,
      overdue: false,
    });
  }
  return lines;
}

/** Called by the Cron Trigger. Sends one notice listing whatever is new since last time. */
export async function sendDueReminders(env: Env): Promise<void> {
  const subscribers = await env.DB.prepare("SELECT COUNT(*) AS count FROM push_subscriptions").first<{ count: number }>();
  if (!subscribers?.count) return;

  const lines = await remindersDue(env, new Date());
  if (lines.length === 0) return;
  const { results: alreadySent } = await env.DB.prepare(
    `SELECT reminder_key FROM sent_reminders WHERE reminder_key IN (${lines.map(() => "?").join(", ")})`,
  ).bind(...lines.map((line) => line.key)).all<{ reminder_key: string }>();
  const sentKeys = new Set(alreadySent.map((row) => row.reminder_key));
  const fresh = lines.filter((line) => !sentKeys.has(line.key));
  if (fresh.length === 0) return;

  const doses = fresh.filter((line) => !line.key.startsWith("follow-up|"));
  const followUps = fresh.filter((line) => line.key.startsWith("follow-up|"));
  const anyOverdue = fresh.some((line) => line.overdue);
  const title = doses.length
    ? `${anyOverdue ? "OVERDUE" : "Due now"}: ${doses.length === 1 ? doses[0].text.replace(" (OVERDUE)", "") : `${doses.length} doses`}`
    : "Follow-up needed";
  const body = [
    doses.length > 1 ? doses.map((line) => line.text).join(", ") : null,
    followUps.length ? `Follow-up: ${followUps.map((line) => line.text).join("; ")}` : null,
  ].filter(Boolean).join("\n") || "Open Care Chart to record it.";

  await notifyAll(env, { title, body, url: "/#today", tag: "care-chart-due", urgent: anyOverdue });

  const forgetBefore = new Date(Date.now() - FORGET_SENT_REMINDERS_AFTER_DAYS * 24 * HOUR_MS).toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sent_reminders WHERE sent_at < ?").bind(forgetBefore),
    ...fresh.map((line) => env.DB.prepare("INSERT OR IGNORE INTO sent_reminders (reminder_key, sent_at) VALUES (?, ?)").bind(line.key, nowIso())),
  ]);
}

// ---- Routes: devices turning reminders on and off

export async function handleReminderRoute(request: Request, url: URL, env: Env, me: Caregiver): Promise<Response | null> {
  const path = url.pathname;
  const method = request.method;

  if (path === "/api/push/key" && method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT push_subscriptions.endpoint, push_subscriptions.device_label, caregivers.name AS caregiver_name
         FROM push_subscriptions JOIN caregivers ON caregivers.id = push_subscriptions.caregiver_id ORDER BY push_subscriptions.created_at`,
    ).all<{ endpoint: string; device_label: string; caregiver_name: string }>();
    return json({ publicKey: env.VAPID_PUBLIC_KEY ?? null, devices: results });
  }

  if (path === "/api/push/subscribe" && method === "POST") {
    const body = await readJson(request);
    const subscription = body.subscription as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | undefined;
    const endpoint = subscription?.endpoint;
    if (typeof endpoint !== "string" || !endpoint.startsWith("https://")
      || typeof subscription?.keys?.p256dh !== "string" || typeof subscription?.keys?.auth !== "string") {
      throw new HttpError(400, "That is not a valid push subscription.");
    }
    await env.DB.prepare(
      `INSERT INTO push_subscriptions (endpoint, key_p256dh, key_auth, caregiver_id, device_label, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (endpoint) DO UPDATE SET key_p256dh = excluded.key_p256dh, key_auth = excluded.key_auth,
         caregiver_id = excluded.caregiver_id, device_label = excluded.device_label`,
    ).bind(endpoint, subscription.keys.p256dh, subscription.keys.auth, me.id, text(body, "label", 80), nowIso()).run();
    return json({ ok: true });
  }

  if (path === "/api/push/unsubscribe" && method === "POST") {
    const body = await readJson(request);
    await env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(text(body, "endpoint", 2000, true)).run();
    return json({ ok: true });
  }

  if (path === "/api/push/test" && method === "POST") {
    const delivered = await notifyAll(env, {
      title: "Care Chart reminders are on",
      body: `Test sent by ${me.name}. Dose reminders will look like this.`,
      url: "/#settings",
      tag: "care-chart-test",
    });
    return json({ delivered });
  }

  return null;
}
