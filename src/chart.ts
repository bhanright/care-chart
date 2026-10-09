// The chart itself: medications, doses given, observations and the patient profile.

import type { Caregiver } from "./auth";
import {
  HttpError, json, localDate, nowIso, oneOf, optionalNumber, readJson, text, timeRange, timestamp, type Env,
} from "./http";

/** Kept in step with public/js/entry-types.js, which describes each type's fields. */
const ENTRY_TYPES = ["fluid", "food", "bowel", "urine", "behavior", "sleep", "pain", "vitals", "care", "note"] as const;
const SETTING_KEYS = ["patient", "preferences"] as const;
const DOSE_STATUSES = ["given", "refused", "held", "missed"] as const;
const EFFECTS = ["effective", "partial", "not_effective"] as const;
const MAXIMUM_ENTRY_DATA_BYTES = 8000;
const MAXIMUM_SETTING_BYTES = 20_000;
/** Matches LARGEST_ON_TIME_WINDOW_MINUTES in public/js/schedule.js. */
const LARGEST_ON_TIME_WINDOW_MINUTES = 240;
/** Phones' clocks drift a little; a dose "a few minutes in the future" is clock skew, not an error. */
const FUTURE_GRACE_MINUTES = 10;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

interface MedicationRow {
  id: number;
  name: string;
  kind: "scheduled" | "as_needed";
  schedule_times: string;
  schedule_weekdays: string;
  schedule_effective_at: string;
  minimum_hours_between: number | null;
  maximum_doses_per_day: number | null;
  discontinued_at: string | null;
  updated_at: string;
  updated_by: number | null;
}

interface AdministrationRow {
  id: number;
  medication_id: number;
  scheduled_for: string | null;
  status: (typeof DOSE_STATUSES)[number];
  given_at: string;
  dose_given: string;
  reason: string;
  note: string;
  effect: string | null;
  effect_note: string;
  effect_recorded_at: string | null;
  safety_override: string;
  recorded_by: number;
  updated_at: string;
  updated_by: number | null;
  voided_at: string | null;
}

function bumpRevision(env: Env): D1PreparedStatement {
  return env.DB.prepare("UPDATE revision SET value = value + 1 WHERE id = 1");
}

async function currentRevision(env: Env): Promise<number> {
  const row = await env.DB.prepare("SELECT value FROM revision WHERE id = 1").first<{ value: number }>();
  return row?.value ?? 0;
}

/** Runs one write together with the revision bump and returns the write's first row. */
export async function write<T>(env: Env, statement: D1PreparedStatement): Promise<T | null> {
  const [result] = await env.DB.batch<T>([statement, bumpRevision(env)]);
  return (result.results?.[0] as T | undefined) ?? null;
}

function jsonList(value: unknown, field: string, check: (item: unknown) => boolean): void {
  if (!Array.isArray(value) || !value.every(check)) throw new HttpError(400, `${field} is not a valid list.`);
}

/**
 * Refuses a save made from an out-of-date copy. Each edit form sends back the
 * updated_at it was opened with; if the other caregiver saved in between, the save is
 * refused instead of silently erasing their change.
 */
export async function requireUnchanged(env: Env, body: Record<string, unknown>, current: { updated_at: string; updated_by: number | null }): Promise<void> {
  const expected = body.expectedUpdatedAt;
  if (typeof expected !== "string" || expected === current.updated_at) return;
  const editor = current.updated_by
    ? await env.DB.prepare("SELECT name FROM caregivers WHERE id = ?").bind(current.updated_by).first<{ name: string }>()
    : null;
  throw new HttpError(409, `${editor?.name ?? "Someone"} changed this while you had it open. Close it and look again before saving.`, {
    code: "changed_elsewhere",
  });
}

function checkNotInFuture(givenAt: string): void {
  if (new Date(givenAt).getTime() > Date.now() + FUTURE_GRACE_MINUTES * MINUTE_MS) {
    throw new HttpError(400, "A dose cannot be recorded in the future.");
  }
}

// ---- Medications

function medicationFields(body: Record<string, unknown>) {
  const kind = oneOf(body, "kind", ["scheduled", "as_needed"] as const);
  const scheduleTimes = body.scheduleTimes ?? [];
  const isClockTime = (item: unknown) => typeof item === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(item);
  jsonList(scheduleTimes, "scheduleTimes", isClockTime);
  if (kind === "scheduled" && (scheduleTimes as unknown[]).length === 0) {
    throw new HttpError(400, "A scheduled medication needs at least one dose time.");
  }
  const scheduleWeekdays = body.scheduleWeekdays ?? [0, 1, 2, 3, 4, 5, 6];
  jsonList(scheduleWeekdays, "scheduleWeekdays", (item) => Number.isInteger(item) && (item as number) >= 0 && (item as number) <= 6);
  return {
    name: text(body, "name", 120, true),
    strength: text(body, "strength", 60),
    dose: text(body, "dose", 60),
    route: text(body, "route", 60) || "by mouth",
    purpose: text(body, "purpose", 200),
    instructions: text(body, "instructions", 500),
    prescriber: text(body, "prescriber", 120),
    kind,
    schedule_times: kind === "scheduled" ? JSON.stringify([...new Set(scheduleTimes as string[])].sort()) : "[]",
    schedule_weekdays: JSON.stringify([...new Set(scheduleWeekdays as number[])].sort()),
    on_time_window_minutes: optionalNumber(body, "onTimeWindowMinutes", 5, LARGEST_ON_TIME_WINDOW_MINUTES) ?? 60,
    minimum_hours_between: kind === "as_needed" ? optionalNumber(body, "minimumHoursBetween", 0, 168) : null,
    effect_duration_hours: kind === "as_needed" ? optionalNumber(body, "effectDurationHours", 0, 168) : null,
    maximum_doses_per_day: kind === "as_needed" ? optionalNumber(body, "maximumDosesPerDay", 1, 48) : null,
    follow_up_minutes: kind === "as_needed" ? optionalNumber(body, "followUpMinutes", 5, 1440) : null,
    start_date: localDate(body, "startDate"),
    end_date: localDate(body, "endDate"),
  };
}

async function saveMedication(env: Env, me: Caregiver, body: Record<string, unknown>, id: number | null): Promise<Response> {
  const fields = medicationFields(body);
  const now = nowIso();
  // The form may say when the schedule starts counting (for example, earlier today when
  // setting up a medication whose morning dose was already given); otherwise it is now.
  const requestedEffectiveAt = timestamp(body, "scheduleEffectiveAt", false);

  if (id === null) {
    const columns = { ...fields, schedule_effective_at: requestedEffectiveAt ?? now };
    const row = await write(env, env.DB.prepare(
      `INSERT INTO medications (${Object.keys(columns).join(", ")}, created_by, created_at, updated_by, updated_at)
       VALUES (${Object.keys(columns).map(() => "?").join(", ")}, ?, ?, ?, ?) RETURNING *`,
    ).bind(...Object.values(columns), me.id, now, me.id, now));
    return json({ medication: row });
  }

  const existing = await env.DB.prepare("SELECT * FROM medications WHERE id = ?").bind(id).first<MedicationRow>();
  if (!existing) throw new HttpError(404, "No such medication.");
  await requireUnchanged(env, body, existing);
  const scheduleChanged = existing.kind !== fields.kind || existing.schedule_times !== fields.schedule_times
    || existing.schedule_weekdays !== fields.schedule_weekdays;
  const columns = {
    ...fields,
    schedule_effective_at: requestedEffectiveAt ?? (scheduleChanged ? now : existing.schedule_effective_at),
  };
  const row = await write(env, env.DB.prepare(
    `UPDATE medications SET ${Object.keys(columns).map((column) => `${column} = ?`).join(", ")}, updated_by = ?, updated_at = ?
      WHERE id = ? RETURNING *`,
  ).bind(...Object.values(columns), me.id, now, id));
  return json({ medication: row });
}

// ---- Administrations

/**
 * Checks an as-needed dose at `givenAt` against the medication's limits, counting doses
 * before and after it (a dose can be entered late, between others). Returns plain-English
 * warnings; the caregiver must give a reason to record the dose anyway.
 */
async function asNeededWarnings(env: Env, medication: MedicationRow, givenAt: string, ignoreId: number | null): Promise<string[]> {
  const warnings: string[] = [];
  const givenMs = new Date(givenAt).getTime();
  // The daily limit needs a full day either side, even when the minimum gap is shorter.
  const lookaroundMs = Math.max((medication.minimum_hours_between ?? 0) * HOUR_MS, DAY_MS);
  const { results } = await env.DB.prepare(
    `SELECT given_at FROM administrations
      WHERE medication_id = ? AND status = 'given' AND voided_at IS NULL AND given_at > ? AND given_at < ? AND id != ?`,
  ).bind(
    medication.id,
    new Date(givenMs - lookaroundMs).toISOString(),
    new Date(givenMs + lookaroundMs).toISOString(),
    ignoreId ?? 0,
  ).all<{ given_at: string }>();
  const otherTimes = results.map((row) => new Date(row.given_at).getTime());

  if (medication.minimum_hours_between) {
    const nearestMs = Math.min(...otherTimes.map((time) => Math.abs(time - givenMs)));
    if (nearestMs < medication.minimum_hours_between * HOUR_MS) {
      const minutesApart = Math.round(nearestMs / MINUTE_MS);
      const gap = minutesApart < 60 ? `${minutesApart} min` : `${Math.floor(minutesApart / 60)} h ${minutesApart % 60} min`;
      warnings.push(`${medication.name} should be at least ${medication.minimum_hours_between} hours apart; ` +
        `another dose was recorded only ${gap} from this time.`);
    }
  }
  if (medication.maximum_doses_per_day) {
    // Every 24-hour window that contains this dose starts at one of the doses within the
    // day before it (or at this dose). Find the fullest such window.
    const allTimes = [...otherTimes, givenMs];
    const windowStarts = allTimes.filter((time) => time <= givenMs && time > givenMs - DAY_MS);
    const fullest = Math.max(...windowStarts.map((start) => allTimes.filter((time) => time >= start && time < start + DAY_MS).length));
    if (fullest > medication.maximum_doses_per_day) {
      warnings.push(`This would make ${fullest} doses within 24 hours; the limit is ${medication.maximum_doses_per_day}.`);
    }
  }
  return warnings;
}

/** Throws the "outside limits" answer unless the caregiver gave a reason. */
function requireOverrideReason(warnings: string[], overrideReason: string): void {
  if (warnings.length > 0 && !overrideReason) {
    throw new HttpError(409, "This dose is outside the medication's limits.", { code: "dose_warning", warnings });
  }
}

async function findMedication(env: Env, id: unknown): Promise<MedicationRow> {
  const medication = Number.isInteger(id)
    ? await env.DB.prepare("SELECT * FROM medications WHERE id = ?").bind(id).first<MedicationRow>()
    : null;
  if (!medication) throw new HttpError(404, "No such medication.");
  return medication;
}

async function recordAdministration(env: Env, me: Caregiver, body: Record<string, unknown>): Promise<Response> {
  const medication = await findMedication(env, body.medicationId);
  const status = oneOf(body, "status", DOSE_STATUSES, "given");
  const givenAt = timestamp(body, "givenAt")!;
  const scheduledFor = medication.kind === "scheduled" ? timestamp(body, "scheduledFor", false) : null;
  const overrideReason = text(body, "overrideReason", 500);
  checkNotInFuture(givenAt);

  if (medication.kind === "as_needed" && status === "given") {
    requireOverrideReason(await asNeededWarnings(env, medication, givenAt, null), overrideReason);
  }

  const now = nowIso();
  try {
    const row = await write(env, env.DB.prepare(
      `INSERT INTO administrations (medication_id, scheduled_for, status, given_at, dose_given, reason, note,
         safety_override, recorded_by, recorded_at, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    ).bind(
      medication.id, scheduledFor, status, givenAt, text(body, "doseGiven", 120), text(body, "reason", 500),
      text(body, "note", 2000), overrideReason, me.id, now, me.id, now,
    ));
    return json({ administration: row });
  } catch (error) {
    if (!String(error).includes("UNIQUE")) throw error;
    // The other caregiver recorded this dose first. Say who and when.
    const existing = await env.DB.prepare(
      `SELECT administrations.status, administrations.given_at, caregivers.name AS recorded_by_name
         FROM administrations JOIN caregivers ON caregivers.id = administrations.recorded_by
        WHERE medication_id = ? AND scheduled_for = ? AND voided_at IS NULL`,
    ).bind(medication.id, scheduledFor).first<{ status: string; given_at: string; recorded_by_name: string }>();
    throw new HttpError(409, "This dose has already been recorded.", { code: "already_recorded", existing });
  }
}

/**
 * Edits a dose record. The same safety checks as recording apply: a changed time or a
 * change to "given" is checked against the as-needed limits, and an override reason is
 * kept with the record.
 */
async function updateAdministration(env: Env, me: Caregiver, id: number, body: Record<string, unknown>): Promise<Response> {
  const existing = await env.DB.prepare("SELECT * FROM administrations WHERE id = ?").bind(id).first<AdministrationRow>();
  if (!existing) throw new HttpError(404, "No such dose record.");
  if (existing.voided_at) throw new HttpError(409, "This record was marked entered in error and cannot be changed.");
  await requireUnchanged(env, body, existing);
  const medication = await findMedication(env, existing.medication_id);

  const givenAt = body.givenAt !== undefined ? timestamp(body, "givenAt")! : existing.given_at;
  const status = body.status !== undefined ? oneOf(body, "status", DOSE_STATUSES) : existing.status;
  if (givenAt !== existing.given_at) checkNotInFuture(givenAt);

  let safetyOverride = existing.safety_override;
  const dosingChanged = givenAt !== existing.given_at || status !== existing.status;
  if (medication.kind === "as_needed" && status === "given" && dosingChanged) {
    const overrideReason = text(body, "overrideReason", 500);
    requireOverrideReason(await asNeededWarnings(env, medication, givenAt, id), overrideReason);
    if (overrideReason) safetyOverride = [existing.safety_override, overrideReason].filter(Boolean).join("; ");
  }

  const effect = body.effect === undefined
    ? existing.effect
    : body.effect === null || body.effect === "" ? null : oneOf(body, "effect", EFFECTS);
  const effectChanged = body.effect !== undefined || body.effectNote !== undefined;

  const row = await write(env, env.DB.prepare(
    `UPDATE administrations SET status = ?, given_at = ?, dose_given = ?, reason = ?, note = ?, effect = ?,
       effect_note = ?, effect_recorded_at = ?, safety_override = ?, updated_by = ?, updated_at = ? WHERE id = ? RETURNING *`,
  ).bind(
    status, givenAt,
    body.doseGiven !== undefined ? text(body, "doseGiven", 120) : existing.dose_given,
    body.reason !== undefined ? text(body, "reason", 500) : existing.reason,
    body.note !== undefined ? text(body, "note", 2000) : existing.note,
    effect,
    body.effectNote !== undefined ? text(body, "effectNote", 1000) : existing.effect_note,
    effectChanged ? nowIso() : existing.effect_recorded_at,
    safetyOverride, me.id, nowIso(), id,
  ));
  return json({ administration: row });
}

// ---- Entries

function entryFields(body: Record<string, unknown>) {
  const data = body.data ?? {};
  if (typeof data !== "object" || Array.isArray(data)) throw new HttpError(400, "data must be an object.");
  const encoded = JSON.stringify(data);
  if (encoded.length > MAXIMUM_ENTRY_DATA_BYTES) throw new HttpError(400, "This entry has too much detail.");
  return {
    type: oneOf(body, "type", ENTRY_TYPES),
    occurred_at: timestamp(body, "occurredAt")!,
    data: encoded,
    note: text(body, "note", 4000),
    notable: body.notable ? 1 : 0,
  };
}

function withParsedData(row: Record<string, unknown> | null) {
  return row ? { ...row, data: JSON.parse(String(row.data)) } : null;
}

// ---- Router

/** Matches "/api/<collection>/<id>" or "/api/<collection>/<id>/<action>" exactly. */
function matchItem(path: string, collection: string): { id: number; action: string | null } | null {
  const match = new RegExp(`^/api/${collection}/(\\d+)(?:/([a-z]+))?$`).exec(path);
  return match ? { id: Number(match[1]), action: match[2] ?? null } : null;
}

export async function handleChartRoute(request: Request, url: URL, env: Env, me: Caregiver): Promise<Response | null> {
  const path = url.pathname;
  const method = request.method;

  if (path === "/api/revision" && method === "GET") {
    return json({ revision: await currentRevision(env) });
  }

  // Everything one screen needs for a time range, in one round trip.
  if (path === "/api/chart" && method === "GET") {
    const { from, to } = timeRange(url);
    const [medications, administrations, entries, settings, caregivers, revision, visits] = await Promise.all([
      env.DB.prepare("SELECT * FROM medications ORDER BY name COLLATE NOCASE").all(),
      env.DB.prepare(
        `SELECT * FROM administrations WHERE (given_at >= ? AND given_at < ?) OR (scheduled_for >= ? AND scheduled_for < ?)
          ORDER BY given_at`,
      ).bind(from, to, from, to).all(),
      env.DB.prepare("SELECT * FROM entries WHERE occurred_at >= ? AND occurred_at < ? ORDER BY occurred_at")
        .bind(from, to).all(),
      env.DB.prepare("SELECT key, value, updated_at FROM settings").all<{ key: string; value: string; updated_at: string }>(),
      env.DB.prepare("SELECT id, name, initials, access, owner, removed_at FROM caregivers ORDER BY name").all(),
      currentRevision(env),
      env.DB.prepare("SELECT * FROM visits WHERE scheduled_at >= ? AND scheduled_at < ? ORDER BY scheduled_at").bind(from, to).all(),
    ]);
    return json({
      from, to, revision, me,
      medications: medications.results,
      administrations: administrations.results,
      entries: entries.results.map(withParsedData),
      settings: Object.fromEntries(settings.results.map((row) => [row.key, JSON.parse(row.value)])),
      settingsUpdatedAt: Object.fromEntries(settings.results.map((row) => [row.key, row.updated_at])),
      caregivers: caregivers.results,
      visits: visits.results,
    });
  }

  if (path === "/api/settings" && method === "PUT") {
    const body = await readJson(request);
    const key = oneOf(body, "key", SETTING_KEYS);
    if (!body.value || typeof body.value !== "object") throw new HttpError(400, "value must be an object.");
    const encoded = JSON.stringify(body.value);
    if (encoded.length > MAXIMUM_SETTING_BYTES) throw new HttpError(400, "That is too much text for one setting.");
    const existing = await env.DB.prepare("SELECT updated_at, updated_by FROM settings WHERE key = ?")
      .bind(key).first<{ updated_at: string; updated_by: number | null }>();
    if (existing) await requireUnchanged(env, body, existing);
    await write(env, env.DB.prepare(
      `INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    ).bind(key, encoded, me.id, nowIso()));
    return json({ ok: true });
  }

  // Medications
  if (path === "/api/medications" && method === "POST") return saveMedication(env, me, await readJson(request), null);
  const medicationRoute = matchItem(path, "medications");
  if (medicationRoute) {
    const { id, action } = medicationRoute;
    if (action === "discontinue" && method === "POST") {
      const body = await readJson(request);
      const row = await write(env, env.DB.prepare(
        "UPDATE medications SET discontinued_at = ?, discontinued_reason = ?, updated_by = ?, updated_at = ? WHERE id = ? RETURNING *",
      ).bind(nowIso(), text(body, "reason", 500), me.id, nowIso(), id));
      if (!row) throw new HttpError(404, "No such medication.");
      return json({ medication: row });
    }
    if (action === "resume" && method === "POST") {
      // Restarting counts doses from now, so the stopped period shows nothing as missed.
      const row = await write(env, env.DB.prepare(
        `UPDATE medications SET discontinued_at = NULL, discontinued_reason = NULL, schedule_effective_at = ?,
           updated_by = ?, updated_at = ? WHERE id = ? RETURNING *`,
      ).bind(nowIso(), me.id, nowIso(), id));
      if (!row) throw new HttpError(404, "No such medication.");
      return json({ medication: row });
    }
    if (action === null && method === "PUT") return saveMedication(env, me, await readJson(request), id);
  }

  // Administrations
  if (path === "/api/administrations" && method === "POST") return recordAdministration(env, me, await readJson(request));
  if (path === "/api/administrations/check" && method === "POST") {
    // Lets the dose dialog warn before the caregiver presses Record. When editing, the
    // record being edited is left out so it is not compared with itself.
    const body = await readJson(request);
    const medication = await findMedication(env, body.medicationId);
    const ignoreId = optionalNumber(body, "ignoreId", 1, Number.MAX_SAFE_INTEGER);
    const warnings = medication.kind === "as_needed"
      ? await asNeededWarnings(env, medication, timestamp(body, "givenAt")!, ignoreId)
      : [];
    return json({ warnings });
  }
  const administrationRoute = matchItem(path, "administrations");
  if (administrationRoute) {
    const { id, action } = administrationRoute;
    if (action === "void" && method === "POST") {
      const body = await readJson(request);
      const row = await write(env, env.DB.prepare(
        `UPDATE administrations SET voided_at = ?, voided_by = ?, void_reason = ?, updated_by = ?, updated_at = ?
          WHERE id = ? AND voided_at IS NULL RETURNING *`,
      ).bind(nowIso(), me.id, text(body, "reason", 500), me.id, nowIso(), id));
      if (!row) throw new HttpError(404, "No such dose record, or it was already marked in error.");
      return json({ administration: row });
    }
    if (action === null && method === "PUT") return updateAdministration(env, me, id, await readJson(request));
  }

  // Entries
  if (path === "/api/entries" && method === "POST") {
    const fields = entryFields(await readJson(request));
    const now = nowIso();
    const row = await write<Record<string, unknown>>(env, env.DB.prepare(
      `INSERT INTO entries (type, occurred_at, data, note, notable, recorded_by, recorded_at, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    ).bind(fields.type, fields.occurred_at, fields.data, fields.note, fields.notable, me.id, now, me.id, now));
    return json({ entry: withParsedData(row) });
  }
  const entryRoute = matchItem(path, "entries");
  if (entryRoute) {
    const { id, action } = entryRoute;
    if (action === "void" && method === "POST") {
      const body = await readJson(request);
      const row = await write(env, env.DB.prepare(
        `UPDATE entries SET voided_at = ?, voided_by = ?, void_reason = ?, updated_by = ?, updated_at = ?
          WHERE id = ? AND voided_at IS NULL RETURNING id`,
      ).bind(nowIso(), me.id, text(body, "reason", 500), me.id, nowIso(), id));
      if (!row) throw new HttpError(404, "No such entry, or it was already marked in error.");
      return json({ ok: true });
    }
    if (action === null && method === "PUT") {
      const body = await readJson(request);
      const existing = await env.DB.prepare("SELECT updated_at, updated_by, voided_at FROM entries WHERE id = ?")
        .bind(id).first<{ updated_at: string; updated_by: number | null; voided_at: string | null }>();
      if (!existing || existing.voided_at) throw new HttpError(404, "No such entry, or it was marked in error.");
      await requireUnchanged(env, body, existing);
      const fields = entryFields(body);
      const row = await write<Record<string, unknown>>(env, env.DB.prepare(
        `UPDATE entries SET type = ?, occurred_at = ?, data = ?, note = ?, notable = ?, updated_by = ?, updated_at = ?
          WHERE id = ? RETURNING *`,
      ).bind(fields.type, fields.occurred_at, fields.data, fields.note, fields.notable, me.id, nowIso(), id));
      return json({ entry: withParsedData(row) });
    }
  }

  // A complete copy of the chart, for backups.
  if (path === "/api/export" && method === "GET") {
    const tables = ["caregivers", "settings", "medications", "administrations", "entries", "visits"];
    const columns: Record<string, string> = { caregivers: "id, name, initials, access, owner, created_at" };
    const dumps = await Promise.all(tables.map((table) =>
      env.DB.prepare(`SELECT ${columns[table] ?? "*"} FROM ${table}`).all()));
    const body = Object.fromEntries(tables.map((table, index) => [table, dumps[index].results]));
    return json({ exportedAt: nowIso(), exportedBy: me.name, ...body }, 200, {
      "Content-Disposition": `attachment; filename="care-chart-${nowIso().slice(0, 10)}.json"`,
    });
  }

  return null;
}
