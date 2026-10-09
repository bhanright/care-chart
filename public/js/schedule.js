// Medication timing: which scheduled doses fall due when, whether each was given, and
// where each as-needed medication stands. Pure functions with no DOM, so
// scripts/check-schedule.mjs can test them under Node.

import { HOUR_MS, MINUTE_MS, DAY_MS, addDays, atClockTime, clockTimeOf, dateKey, weekdayOf } from "./time.js";

/**
 * The widest on-time window a medication may have (src/chart.ts allows up to 240 minutes).
 * Looking this far ahead finds every dose that is already "due".
 */
export const LARGEST_ON_TIME_WINDOW_MINUTES = 240;

/** Turns the server's row into the shape the app uses (JSON lists parsed). */
export function normalizeMedication(row) {
  return {
    ...row,
    schedule_times: typeof row.schedule_times === "string" ? JSON.parse(row.schedule_times) : row.schedule_times ?? [],
    schedule_weekdays: typeof row.schedule_weekdays === "string" ? JSON.parse(row.schedule_weekdays) : row.schedule_weekdays ?? [0, 1, 2, 3, 4, 5, 6],
  };
}

export function isActive(medication, now = new Date()) {
  if (medication.discontinued_at && new Date(medication.discontinued_at) <= now) return false;
  if (medication.end_date && dateKey(now) > medication.end_date) return false;
  return true;
}

/** True if a scheduled medication has a dose at this slot. */
function hasSlot(medication, dayKeyText, slotTime) {
  if (medication.start_date && dayKeyText < medication.start_date) return false;
  if (medication.end_date && dayKeyText > medication.end_date) return false;
  if (!medication.schedule_weekdays.includes(weekdayOf(dayKeyText))) return false;
  if (medication.discontinued_at && slotTime >= new Date(medication.discontinued_at)) return false;
  // Doses count only from when the current schedule took effect. Without this, adding
  // a 10 AM time at 3 PM (or a new medication) would make today's 10 AM dose, and every
  // earlier day's, look overdue or missed.
  if (slotTime < new Date(medication.schedule_effective_at ?? medication.created_at)) return false;
  return true;
}

/**
 * Every scheduled dose slot from `from` (inclusive) to `to` (exclusive), each with its
 * record (if any) and a state:
 *   upcoming  - not yet within the on-time window
 *   due       - inside the window now
 *   overdue   - past the window with nothing recorded
 *   given / refused / held / missed - recorded
 */
export function doseSlots(medications, administrations, from, to, now = new Date()) {
  const recordsBySlot = new Map();
  for (const record of administrations) {
    if (record.scheduled_for && !record.voided_at) recordsBySlot.set(`${record.medication_id}|${record.scheduled_for}`, record);
  }
  const usedRecords = new Set();
  const slots = [];
  for (let day = dateKey(from); day <= dateKey(to); day = addDays(day, 1)) {
    for (const medication of medications) {
      if (medication.kind !== "scheduled") continue;
      for (const clockTime of medication.schedule_times) {
        const slotTime = atClockTime(day, clockTime);
        if (slotTime < from || slotTime >= to) continue;
        const scheduledFor = slotTime.toISOString();
        const record = recordsBySlot.get(`${medication.id}|${scheduledFor}`) ?? null;
        if (!record && !hasSlot(medication, day, slotTime)) continue;
        if (record) usedRecords.add(record);
        slots.push({ medication, day, clockTime, slotTime, scheduledFor, record, ...slotState(medication, slotTime, record, now) });
      }
    }
  }
  // Doses recorded under an earlier schedule (a time since changed or removed) keep
  // their place in the record, so a schedule change never erases history.
  const medicationsById = new Map(medications.map((medication) => [medication.id, medication]));
  for (const record of recordsBySlot.values()) {
    const slotTime = new Date(record.scheduled_for);
    const medication = medicationsById.get(record.medication_id);
    if (usedRecords.has(record) || !medication || slotTime < from || slotTime >= to) continue;
    slots.push({
      medication, day: dateKey(slotTime), clockTime: clockTimeOf(slotTime), slotTime, scheduledFor: record.scheduled_for,
      record, ...slotState(medication, slotTime, record, now),
    });
  }
  return slots.sort((a, b) => a.slotTime - b.slotTime || a.medication.name.localeCompare(b.medication.name));
}

function slotState(medication, slotTime, record, now) {
  const windowMs = medication.on_time_window_minutes * MINUTE_MS;
  if (record) {
    let timing = "on time";
    if (record.status === "given") {
      const offset = new Date(record.given_at) - slotTime;
      if (offset > windowMs) timing = "late";
      else if (offset < -windowMs) timing = "early";
    }
    return { state: record.status, timing };
  }
  if (now < slotTime - windowMs) return { state: "upcoming", timing: null };
  if (now <= slotTime.getTime() + windowMs) return { state: "due", timing: null };
  return { state: "overdue", timing: null };
}

/** Doses that need someone now: overdue in the last day, or due within the window. */
export function dosesNeedingAttention(medications, administrations, now = new Date()) {
  const from = new Date(now.getTime() - DAY_MS);
  const to = new Date(now.getTime() + LARGEST_ON_TIME_WINDOW_MINUTES * MINUTE_MS);
  return doseSlots(medications, administrations, from, to, now)
    .filter((slot) => slot.state === "due" || slot.state === "overdue");
}

/** Where an as-needed medication stands right now. */
export function asNeededStatus(medication, administrations, now = new Date()) {
  const doses = administrations
    .filter((record) => record.medication_id === medication.id && record.status === "given" && !record.voided_at
      && new Date(record.given_at) <= now)
    .sort((a, b) => new Date(b.given_at) - new Date(a.given_at));
  const last = doses[0] ?? null;
  const lastTime = last ? new Date(last.given_at) : null;

  const activeUntil = last && medication.effect_duration_hours
    ? new Date(lastTime.getTime() + medication.effect_duration_hours * HOUR_MS) : null;

  const dayAgo = now.getTime() - DAY_MS;
  const inLastDay = doses.filter((record) => new Date(record.given_at).getTime() > dayAgo)
    .sort((a, b) => new Date(a.given_at) - new Date(b.given_at));

  // The earliest the next dose is allowed: the minimum gap after the last dose, and,
  // if the daily limit is reached, the moment the oldest counted dose leaves the 24 hours.
  const earliestTimes = [];
  if (last && medication.minimum_hours_between) {
    earliestTimes.push(lastTime.getTime() + medication.minimum_hours_between * HOUR_MS);
  }
  if (medication.maximum_doses_per_day && inLastDay.length >= medication.maximum_doses_per_day) {
    const oldestThatMustExpire = inLastDay[inLastDay.length - medication.maximum_doses_per_day];
    earliestTimes.push(new Date(oldestThatMustExpire.given_at).getTime() + DAY_MS);
  }
  const nextAllowedAt = earliestTimes.length ? new Date(Math.max(...earliestTimes)) : null;

  // Ask "did it help?" once the follow-up time has passed and nobody has answered.
  const followUpDue = last && medication.follow_up_minutes && !last.effect
    && now.getTime() >= lastTime.getTime() + medication.follow_up_minutes * MINUTE_MS
    && now.getTime() - lastTime.getTime() < DAY_MS
    ? last : null;

  return {
    last,
    activeUntil,
    inEffect: Boolean(activeUntil && activeUntil > now),
    dosesInLastDay: inLastDay.length,
    nextAllowedAt,
    canGiveNow: !nextAllowedAt || nextAllowedAt <= now,
    followUpDue,
  };
}

/**
 * Counts slots for adherence. Doses not yet due (upcoming or inside their window) are
 * "pending" and left out of "counted", so a morning report doesn't show the rest of
 * the day as missed.
 */
export function slotCounts(slots) {
  const pending = slots.filter((slot) => slot.state === "due" || slot.state === "upcoming").length;
  return {
    counted: slots.length - pending,
    given: slots.filter((slot) => slot.state === "given").length,
    notGiven: slots.filter((slot) => ["refused", "held", "missed", "overdue"].includes(slot.state)).length,
    pending,
  };
}
