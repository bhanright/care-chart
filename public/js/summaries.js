// Day-by-day totals used by the Trends charts and the Report.

import { doseSlots, slotCounts } from "./schedule.js";
import { addDays, dateKey, startOfDay } from "./time.js";

const VITAL_KEYS = ["systolic", "diastolic", "pulse", "temperatureF", "oxygen", "respirations", "glucose", "weightLb"];

const average = (values) => values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;

/** One summary per local day from firstDay to lastDay (both "YYYY-MM-DD", inclusive). */
export function dailySummaries(context, firstDay, lastDay) {
  const now = context.now();
  const entries = context.data.entries.filter((entry) => !entry.voided_at);
  const administrations = context.data.administrations.filter((record) => !record.voided_at);
  const slots = doseSlots(context.medications, context.data.administrations, startOfDay(firstDay), startOfDay(addDays(lastDay, 1)), now);
  const asNeeded = context.medications.filter((medication) => medication.kind === "as_needed");

  const days = [];
  for (let day = firstDay; day <= lastDay; day = addDays(day, 1)) {
    const onDay = (iso) => dateKey(new Date(iso)) === day;
    const of = (type) => entries.filter((entry) => entry.type === type && onDay(entry.occurred_at));
    const meals = of("food").filter((entry) => typeof entry.data.percentEaten === "number" && entry.data.meal !== "Snack");
    const behavior = of("behavior");
    const pain = of("pain").filter((entry) => typeof entry.data.score === "number");
    const sleep = of("sleep").filter((entry) => typeof entry.data.hours === "number" && entry.data.kind !== "Awake at night");
    const dayCounts = slotCounts(slots.filter((slot) => slot.day === day));
    const vitals = {};
    for (const key of VITAL_KEYS) {
      const readings = of("vitals").filter((entry) => typeof entry.data[key] === "number").map((entry) => entry.data[key]);
      vitals[key] = readings.length ? average(readings) : null;
    }
    const dosesOnDay = administrations.filter((record) => record.status === "given" && onDay(record.given_at));
    days.push({
      day,
      isFuture: startOfDay(day) > now,
      fluidMl: of("fluid").reduce((total, entry) => total + (entry.data.amountMl ?? 0), 0),
      mealAveragePercent: meals.length ? average(meals.map((entry) => entry.data.percentEaten)) : null,
      mealCount: meals.length,
      bowelCount: of("bowel").length,
      bristolTypes: of("bowel").map((entry) => entry.data.bristol).filter(Boolean),
      urineCount: of("urine").length,
      accidents: [...of("urine"), ...of("bowel")].filter((entry) => entry.data.continence === "Accident (brief)").length,
      moodAverage: average(behavior.filter((entry) => entry.data.moodScore).map((entry) => entry.data.moodScore)),
      behaviorsSeen: behavior.flatMap((entry) => entry.data.behaviors ?? []),
      painMaximum: pain.length ? Math.max(...pain.map((entry) => entry.data.score)) : null,
      sleepHours: sleep.length ? sleep.reduce((total, entry) => total + entry.data.hours, 0) : null,
      vitals,
      // Doses not yet due are "pending", not missed, so today isn't marked down in the morning.
      scheduledDue: dayCounts.counted,
      scheduledGiven: dayCounts.given,
      scheduledNotGiven: dayCounts.notGiven,
      scheduledPending: dayCounts.pending,
      asNeededDoses: Object.fromEntries(asNeeded.map((medication) => [medication.id, dosesOnDay.filter((record) => record.medication_id === medication.id).length])),
      notableCount: entries.filter((entry) => entry.notable && onDay(entry.occurred_at)).length,
    });
  }
  return days;
}
