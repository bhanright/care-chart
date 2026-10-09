// Checks the medication timing rules in public/js/schedule.js. Run with `npm run check`.

import assert from "node:assert/strict";
import { asNeededStatus, doseSlots, dosesNeedingAttention, normalizeMedication, slotCounts } from "../public/js/schedule.js";
import { atClockTime, dateKey, setHouseholdTimeZone, toLocalInputValue, fromLocalInputValue, zonedTime } from "../public/js/time.js";

// Every check runs in one household zone, whatever zone this computer is set to.
setHouseholdTimeZone("America/Chicago");
const at = (day, hours, minutes = 0) => zonedTime(2026, 10, day, hours, minutes); // October 2026, household time
let checks = 0;
const check = (name, test) => { test(); checks++; console.log(`ok - ${name}`); };

const scheduled = normalizeMedication({
  id: 1, name: "Lisinopril", kind: "scheduled", schedule_times: '["08:00","20:00"]', schedule_weekdays: "[0,1,2,3,4,5,6]",
  on_time_window_minutes: 60, created_at: at(1, 0).toISOString(), schedule_effective_at: at(1, 0).toISOString(),
  start_date: null, end_date: null, discontinued_at: null,
});

check("a dose is upcoming, then due inside the window, then overdue", () => {
  const states = [at(8, 6, 59), at(8, 7, 0), at(8, 9, 0), at(8, 9, 1)].map((now) =>
    doseSlots([scheduled], [], at(8, 0), at(8, 12), now)[0].state);
  assert.deepEqual(states, ["upcoming", "due", "due", "overdue"]);
});

check("a recorded dose takes the record's status and timing", () => {
  const record = { medication_id: 1, scheduled_for: at(8, 8).toISOString(), status: "given", given_at: at(8, 9, 30).toISOString(), voided_at: null };
  const [slot] = doseSlots([scheduled], [record], at(8, 0), at(8, 12), at(8, 10));
  assert.equal(slot.state, "given");
  assert.equal(slot.timing, "late");
});

check("a record marked in error leaves the dose overdue again", () => {
  const record = { medication_id: 1, scheduled_for: at(8, 8).toISOString(), status: "given", given_at: at(8, 8).toISOString(), voided_at: at(8, 8, 5).toISOString() };
  assert.equal(doseSlots([scheduled], [record], at(8, 0), at(8, 12), at(8, 10))[0].state, "overdue");
});

check("only listed weekdays get doses", () => {
  const weekly = { ...scheduled, schedule_weekdays: [1] }; // Mondays; Oct 5 2026 is a Monday
  const slots = doseSlots([weekly], [], at(4, 0), at(11, 0), at(11, 0));
  assert.deepEqual([...new Set(slots.map((slot) => slot.day))], ["2026-10-05"]);
});

check("no dose before the schedule took effect, even with today as the start date", () => {
  const addedAtThree = { ...scheduled, created_at: at(8, 15).toISOString(), schedule_effective_at: at(8, 15).toISOString() };
  assert.deepEqual(doseSlots([addedAtThree], [], at(8, 0), at(9, 0), at(8, 21)).map((slot) => slot.clockTime), ["20:00"]);
  const withStartDate = { ...addedAtThree, start_date: "2026-10-08" };
  assert.deepEqual(dosesNeedingAttention([withStartDate], [], at(8, 15, 1)).map((slot) => slot.clockTime), []);
});

check("adding a dose time at 3 PM does not make today's earlier slot overdue", () => {
  const edited = { ...scheduled, schedule_times: ["08:00", "10:00", "20:00"], schedule_effective_at: at(8, 15).toISOString() };
  const given = { medication_id: 1, scheduled_for: at(8, 8).toISOString(), status: "given", given_at: at(8, 8).toISOString(), voided_at: null };
  assert.deepEqual(dosesNeedingAttention([edited], [given], at(8, 15, 1)).map((slot) => slot.clockTime), []);
  // Yesterday's history is unchanged: two doses, not three.
  assert.equal(doseSlots([edited], [], at(7, 0), at(8, 0), at(8, 15, 1)).length, 0);
});

check("doses recorded under an old schedule stay in the record", () => {
  const moved = { ...scheduled, schedule_times: ["09:00", "21:00"], schedule_effective_at: at(8, 12).toISOString() };
  const given = { medication_id: 1, scheduled_for: at(8, 8).toISOString(), status: "given", given_at: at(8, 8, 3).toISOString(), voided_at: null };
  const slots = doseSlots([moved], [given], at(8, 0), at(9, 0), at(8, 22, 30));
  assert.deepEqual(slots.map((slot) => [slot.clockTime, slot.state]), [["08:00", "given"], ["21:00", "overdue"]]);
});

check("slot instants follow the household zone, including daylight-saving days", () => {
  assert.equal(atClockTime("2026-10-08", "08:00").toISOString(), "2026-10-08T13:00:00.000Z"); // CDT, UTC-5
  assert.equal(atClockTime("2026-11-02", "08:00").toISOString(), "2026-11-02T14:00:00.000Z"); // CST, UTC-6
  assert.equal(atClockTime("2026-11-01", "01:30").toISOString(), "2026-11-01T06:30:00.000Z"); // repeated hour: first one
  assert.equal(dateKey(new Date("2026-10-09T04:59:00Z")), "2026-10-08");
  assert.equal(fromLocalInputValue(toLocalInputValue("2026-03-08T15:45:00Z")), "2026-03-08T15:45:00.000Z");
});

check("adherence leaves out doses that are not due yet", () => {
  const acetaminophen = { ...scheduled, schedule_times: ["08:00", "14:00", "20:00"] };
  const given = { medication_id: 1, scheduled_for: at(8, 8).toISOString(), status: "given", given_at: at(8, 8).toISOString(), voided_at: null };
  const counts = slotCounts(doseSlots([acetaminophen], [given], at(8, 0), at(9, 0), at(8, 9)));
  assert.deepEqual(counts, { counted: 1, given: 1, notGiven: 0, pending: 2 });
});

check("discontinued and finished medications stop producing doses", () => {
  const stopped = { ...scheduled, discontinued_at: at(8, 12).toISOString() };
  assert.deepEqual(doseSlots([stopped], [], at(8, 0), at(10, 0), at(10, 0)).map((slot) => slot.clockTime), ["08:00"]);
  const course = { ...scheduled, end_date: "2026-10-08" };
  assert.equal(doseSlots([course], [], at(8, 0), at(10, 0), at(10, 0)).length, 2);
});

check("needing attention covers unrecorded doses from the last 24 hours", () => {
  const slots = dosesNeedingAttention([scheduled], [], at(9, 7, 30));
  assert.deepEqual(slots.map((slot) => [slot.day, slot.clockTime, slot.state]),
    [["2026-10-08", "08:00", "overdue"], ["2026-10-08", "20:00", "overdue"], ["2026-10-09", "08:00", "due"]]);
});

const asNeeded = normalizeMedication({
  id: 2, name: "Lorazepam", kind: "as_needed", schedule_times: "[]", schedule_weekdays: "[0,1,2,3,4,5,6]",
  minimum_hours_between: 6, effect_duration_hours: 4, maximum_doses_per_day: 2, follow_up_minutes: 45,
  created_at: at(1, 0).toISOString(), discontinued_at: null,
});
const dose = (id, time, extra = {}) => ({ id, medication_id: 2, status: "given", given_at: time.toISOString(), voided_at: null, effect: null, ...extra });

check("as-needed: minimum gap, time in effect and follow-up", () => {
  const status = asNeededStatus(asNeeded, [dose(1, at(8, 10))], at(8, 11));
  assert.equal(status.inEffect, true);
  assert.equal(status.activeUntil.getTime(), at(8, 14).getTime());
  assert.equal(status.nextAllowedAt.getTime(), at(8, 16).getTime());
  assert.equal(status.canGiveNow, false);
  assert.equal(status.followUpDue.id, 1);
  assert.equal(asNeededStatus(asNeeded, [dose(1, at(8, 10), { effect: "effective" })], at(8, 11)).followUpDue, null);
});

check("as-needed: the daily limit holds the next dose until the oldest leaves the 24 hours", () => {
  const status = asNeededStatus(asNeeded, [dose(1, at(8, 2)), dose(2, at(8, 9))], at(8, 20));
  assert.equal(status.dosesInLastDay, 2);
  assert.equal(status.nextAllowedAt.getTime(), at(9, 2).getTime());
  assert.equal(asNeededStatus(asNeeded, [dose(1, at(8, 2)), dose(2, at(8, 9))], at(9, 2, 1)).canGiveNow, true);
});

check("as-needed: doses marked in error do not count", () => {
  const status = asNeededStatus(asNeeded, [dose(1, at(8, 10), { voided_at: at(8, 10, 1).toISOString() })], at(8, 11));
  assert.equal(status.last, null);
  assert.equal(status.canGiveNow, true);
});

console.log(`\n${checks} checks passed.`);
