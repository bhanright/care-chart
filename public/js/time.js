// Date and time helpers. The server stores UTC instants. Everything shown, and every
// dose slot, uses the household's time zone (Settings → Household), not the device's,
// so two phones that disagree about their zone still agree on which 8 AM dose is which,
// and the server (which runs in UTC) can work out reminders the same way.
//
// This module has no DOM use, so the Worker imports it too (src/reminders.ts).

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

let householdTimeZone = deviceTimeZone();
const partFormatters = new Map();

export function deviceTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function isValidTimeZone(zone) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export function setHouseholdTimeZone(zone) {
  householdTimeZone = zone && isValidTimeZone(zone) ? zone : deviceTimeZone();
}

export function getHouseholdTimeZone() {
  return householdTimeZone;
}

/** Calendar and clock fields of an instant in the household zone (month is 1 to 12). */
function zonedParts(date) {
  let formatter = partFormatters.get(householdTimeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: householdTimeZone, hourCycle: "h23",
      year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
    });
    partFormatters.set(householdTimeZone, formatter);
  }
  const parts = {};
  for (const part of formatter.formatToParts(date)) parts[part.type] = Number(part.value);
  return parts;
}

/** How far the household's wall clock is ahead of UTC at this instant. */
function zoneOffsetMs(date) {
  const parts = zonedParts(date);
  const wallClockAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return wallClockAsUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * The instant when the household clock reads this date and time. Applying the offset
 * twice settles daylight-saving changeovers; a time skipped by "spring forward" lands
 * an hour later, the way a wall clock would show it.
 */
export function zonedTime(year, month, day, hours = 0, minutes = 0) {
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hours, minutes);
  const firstGuess = wallClockAsUtc - zoneOffsetMs(new Date(wallClockAsUtc));
  return new Date(wallClockAsUtc - zoneOffsetMs(new Date(firstGuess)));
}

function splitDayKey(dayKeyText) {
  const [year, month, day] = dayKeyText.split("-").map(Number);
  return { year, month, day };
}

/** "2026-10-08" for an instant, in the household zone. */
export function dateKey(date) {
  const parts = zonedParts(new Date(date));
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

/** "08:05" for an instant, in the household zone. */
export function clockTimeOf(date) {
  const parts = zonedParts(new Date(date));
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

/** The household's midnight at the start of a "YYYY-MM-DD" day (or of an instant's day). */
export function startOfDay(dayOrDate) {
  const { year, month, day } = splitDayKey(typeof dayOrDate === "string" ? dayOrDate : dateKey(dayOrDate));
  return zonedTime(year, month, day);
}

/** Adds whole calendar days to a day key. Pure calendar arithmetic, so no zone issues. */
export function addDays(dayKeyText, days) {
  const { year, month, day } = splitDayKey(dayKeyText);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** 0 = Sunday. */
export function weekdayOf(dayKeyText) {
  const { year, month, day } = splitDayKey(dayKeyText);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** The instant of a "HH:MM" clock time on a day, in the household zone. */
export function atClockTime(dayKeyText, clockTime) {
  const { year, month, day } = splitDayKey(dayKeyText);
  const [hours, minutes] = clockTime.split(":").map(Number);
  return zonedTime(year, month, day, hours, minutes);
}

// ---- Display (always in the household zone)

export function formatClock(dateOrIso) {
  return new Date(dateOrIso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: householdTimeZone });
}

/** "8:00 AM" from "08:00". */
export function formatClockText(clockTime) {
  const [hours, minutes] = clockTime.split(":").map(Number);
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`;
}

/** Formats an instant's date with Intl options, in the household zone. */
export function formatDate(dateOrIso, options) {
  return new Date(dateOrIso).toLocaleDateString("en-US", { ...options, timeZone: householdTimeZone });
}

/** Formats a "YYYY-MM-DD" day key. Noon UTC of that date, shown in UTC, is that date everywhere. */
export function formatDayKey(dayKeyText, options) {
  const { year, month, day } = splitDayKey(dayKeyText);
  return new Date(Date.UTC(year, month - 1, day, 12)).toLocaleDateString("en-US", { ...options, timeZone: "UTC" });
}

export function formatDay(dayKeyText, style = "long") {
  return formatDayKey(dayKeyText, style === "long"
    ? { weekday: "long", month: "long", day: "numeric", year: "numeric" }
    : { weekday: "short", month: "short", day: "numeric" });
}

export function formatDateTime(dateOrIso) {
  return `${formatDate(dateOrIso, { month: "short", day: "numeric" })} ${formatClock(dateOrIso)}`;
}

/** "45 min", "2 h 10 min", "3 days". */
export function formatDuration(milliseconds) {
  const totalMinutes = Math.round(Math.abs(milliseconds) / MINUTE_MS);
  if (totalMinutes < 1) return "under a minute";
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 48) return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
  return `${Math.floor(hours / 24)} days`;
}

/** "12 min ago", "in 2 h". */
export function relativeTime(dateOrIso, now = new Date()) {
  const difference = new Date(dateOrIso).getTime() - now.getTime();
  const span = formatDuration(difference);
  if (span === "under a minute") return "just now";
  return difference < 0 ? `${span} ago` : `in ${span}`;
}

/** Value for <input type="datetime-local">, showing the household clock. */
export function toLocalInputValue(dateOrIso) {
  const date = new Date(dateOrIso);
  return `${dateKey(date)}T${clockTimeOf(date)}`;
}

/** Reads <input type="datetime-local"> as household clock time. */
export function fromLocalInputValue(value) {
  const [dayPart, timePart] = value.split("T");
  return atClockTime(dayPart, timePart.slice(0, 5)).toISOString();
}

export function ageFrom(dateOfBirth, now = new Date()) {
  if (!dateOfBirth) return null;
  const birth = splitDayKey(dateOfBirth);
  const today = splitDayKey(dateKey(now));
  let age = today.year - birth.year;
  if (today.month < birth.month || (today.month === birth.month && today.day < birth.day)) age--;
  return age;
}
