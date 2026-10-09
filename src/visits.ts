// Visits from the care team: hospice nurses, aides, social workers and others. Each is
// planned for a time, then marked with what happened (completed, care declined,
// cancelled, no-show). Weekly visits can be created as a repeating series in one step.

import type { Caregiver } from "./auth";
import { requireUnchanged, write } from "./chart";
import { HttpError, json, nowIso, oneOf, optionalNumber, readJson, text, timestamp, type Env } from "./http";

/** Kept in step with VISIT_ROLES in public/js/views/visits.js. */
const ROLES = [
  "Hospice nurse (RN)", "Nurse (LPN)", "Hospice aide", "Social worker", "Chaplain",
  "Hospice doctor / NP", "Volunteer", "Therapist", "Other",
] as const;
const STATUSES = ["scheduled", "completed", "declined", "cancelled_by_agency", "cancelled_by_family", "no_show"] as const;
/** A repeating series is created as separate visits; this caps how many at once. */
const MAXIMUM_VISITS_PER_SERIES = 120;
const MAXIMUM_SERIES_WEEKS = 26;
const DAY_MS = 24 * 3600 * 1000;

interface VisitRow {
  id: number;
  updated_at: string;
  updated_by: number | null;
  voided_at: string | null;
}

function visitFields(body: Record<string, unknown>) {
  return {
    duration_minutes: optionalNumber(body, "durationMinutes", 5, 24 * 60),
    role: oneOf(body, "role", ROLES),
    visitor_name: text(body, "visitorName", 80),
    agency: text(body, "agency", 120),
    status: oneOf(body, "status", STATUSES, "scheduled"),
    outcome_note: text(body, "outcomeNote", 2000),
    note: text(body, "note", 2000),
  };
}

/**
 * The start times for a new visit or weekly series. The browser sends each start as an
 * instant already worked out in the household's time zone, so the server only checks
 * them: at most MAXIMUM_VISITS_PER_SERIES, all within MAXIMUM_SERIES_WEEKS.
 */
function startTimes(body: Record<string, unknown>): string[] {
  if (!Array.isArray(body.startTimes)) return [timestamp(body, "scheduledAt")!];
  const starts = body.startTimes.map((value) => timestamp({ startTime: value }, "startTime")!);
  if (starts.length === 0) throw new HttpError(400, "Choose at least one day for the visits.");
  if (starts.length > MAXIMUM_VISITS_PER_SERIES) throw new HttpError(400, `That is more than ${MAXIMUM_VISITS_PER_SERIES} visits; choose a shorter repeat.`);
  const times = starts.map((iso) => new Date(iso).getTime());
  if (Math.max(...times) - Math.min(...times) > MAXIMUM_SERIES_WEEKS * 7 * DAY_MS) {
    throw new HttpError(400, `A repeat can cover at most ${MAXIMUM_SERIES_WEEKS} weeks.`);
  }
  return starts;
}

export async function handleVisitRoute(request: Request, url: URL, env: Env, me: Caregiver): Promise<Response | null> {
  const path = url.pathname;
  const method = request.method;

  if (path === "/api/visits" && method === "POST") {
    const body = await readJson(request);
    const fields = visitFields(body);
    const starts = startTimes(body);
    const seriesId = starts.length > 1 ? crypto.randomUUID() : null;
    const now = nowIso();
    const statements = starts.map((start) => env.DB.prepare(
      `INSERT INTO visits (scheduled_at, duration_minutes, role, visitor_name, agency, status, outcome_note, note,
         series_id, recorded_by, recorded_at, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(start, fields.duration_minutes, fields.role, fields.visitor_name, fields.agency, fields.status,
      fields.outcome_note, fields.note, seriesId, me.id, now, me.id, now));
    await env.DB.batch([...statements, env.DB.prepare("UPDATE revision SET value = value + 1 WHERE id = 1")]);
    return json({ created: starts.length, seriesId });
  }

  const match = /^\/api\/visits\/(\d+)(?:\/(void|cancel-series))?$/.exec(path);
  if (!match) return null;
  const id = Number(match[1]);
  const action = match[2] ?? null;
  const existing = await env.DB.prepare("SELECT id, updated_at, updated_by, voided_at FROM visits WHERE id = ?").bind(id).first<VisitRow>();
  if (!existing) throw new HttpError(404, "No such visit.");
  if (existing.voided_at) throw new HttpError(409, "This visit was marked entered in error and cannot be changed.");

  if (action === null && method === "PUT") {
    const body = await readJson(request);
    await requireUnchanged(env, body, existing);
    const fields = visitFields(body);
    const row = await write(env, env.DB.prepare(
      `UPDATE visits SET scheduled_at = ?, duration_minutes = ?, role = ?, visitor_name = ?, agency = ?, status = ?,
         outcome_note = ?, note = ?, updated_by = ?, updated_at = ? WHERE id = ? RETURNING *`,
    ).bind(timestamp(body, "scheduledAt"), fields.duration_minutes, fields.role, fields.visitor_name, fields.agency,
      fields.status, fields.outcome_note, fields.note, me.id, nowIso(), id));
    return json({ visit: row });
  }

  if (action === "void" && method === "POST") {
    const body = await readJson(request);
    await write(env, env.DB.prepare(
      "UPDATE visits SET voided_at = ?, voided_by = ?, void_reason = ?, updated_by = ?, updated_at = ? WHERE id = ?",
    ).bind(nowIso(), me.id, text(body, "reason", 500), me.id, nowIso(), id));
    return json({ ok: true });
  }

  // Stops a repeating series from a given visit on: the later planned visits are marked
  // entered in error. Visits that already happened keep their record.
  if (action === "cancel-series" && method === "POST") {
    const body = await readJson(request);
    const visit = await env.DB.prepare("SELECT series_id, scheduled_at FROM visits WHERE id = ?")
      .bind(id).first<{ series_id: string | null; scheduled_at: string }>();
    if (!visit?.series_id) throw new HttpError(400, "This visit is not part of a repeating series.");
    const [stopped] = await env.DB.batch([
      env.DB.prepare(
        `UPDATE visits SET voided_at = ?, voided_by = ?, void_reason = ?, updated_by = ?, updated_at = ?
          WHERE series_id = ? AND scheduled_at >= ? AND status = 'scheduled' AND voided_at IS NULL RETURNING id`,
      ).bind(nowIso(), me.id, text(body, "reason", 500) || "Repeating visits stopped", me.id, nowIso(), visit.series_id, visit.scheduled_at),
      env.DB.prepare("UPDATE revision SET value = value + 1 WHERE id = 1"),
    ]);
    return json({ ok: true, stopped: stopped.results.length });
  }

  return null;
}
