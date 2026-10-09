// The Today screen: what is due, what was given, where each as-needed medication
// stands, today's totals, quick recording and recent notable changes.

import { ENTRY_TYPES, ENTRY_TYPE_ORDER, ML_PER_FLUID_OUNCE, formatFluid } from "../entry-types.js";
import { openDoseForm, openEffectForm, openEntryForm, quickFluid, quickGive } from "../forms.js";
import { asNeededStatus, doseSlots, dosesNeedingAttention, isActive } from "../schedule.js";
import { DAY_MS, HOUR_MS, addDays, dateKey, formatClock, formatClockText, formatDate, formatDuration, relativeTime, startOfDay } from "../time.js";
import { h, progressBar, windowBox } from "../ui.js";
import { renderTimeline, timelineItems } from "./timeline.js";

const NOTABLE_LOOKBACK_HOURS = 72;
// "Behind pace" on fluids: drinking is expected between these hours, and the tile warns
// when the day's total is under this share of what should have been drunk by now.
const DRINKING_DAY_START_HOUR = 7;
const DRINKING_DAY_END_HOUR = 21;
const BEHIND_PACE_SHARE = 0.75;
const STATUS_WORDS = { given: "Given", refused: "Refused", held: "Held", missed: "Missed", due: "Due now", overdue: "OVERDUE", upcoming: "Upcoming" };

/** The Today screen loads a week so "days since last bowel movement" can be shown. */
export function todayRange(now = new Date()) {
  return { from: startOfDay(addDays(dateKey(now), -7)), to: startOfDay(addDays(dateKey(now), 2)) };
}

export function renderToday(context) {
  const now = context.now();
  const today = dateKey(now);
  const startOfToday = startOfDay(today);
  const data = context.data;
  const live = (record) => !record.voided_at;
  const entriesToday = data.entries.filter((entry) => live(entry) && new Date(entry.occurred_at) >= startOfToday);

  return h("div", {},
    renderTiles(context, entriesToday, now),
    h("div", { class: "dashboard today" },
      h("div", { class: "column" },
        renderAttention(context, now),
        renderTodaysDoses(context, now, today),
        renderAsNeeded(context, now),
      ),
      h("div", { class: "column" },
        renderQuickRecord(context),
        renderNotable(context, now),
        windowBox({ title: "Today's chart", bodyClass: "flush", className: "phone-order-6" },
          h("div", { class: "well", style: { maxHeight: "520px" } },
            renderTimeline(timelineItems({
              entries: data.entries.filter((entry) => new Date(entry.occurred_at) >= startOfToday),
              administrations: data.administrations.filter((record) => new Date(record.given_at) >= startOfToday),
            }), context, { emptyText: "Nothing charted today yet." }))),
      ),
    ),
  );
}

// ---- Summary tiles

function tile(label, value, detail, state = "", extra = null) {
  return h("div", { class: `tile ${state}` },
    h("span", { class: "tile-label" }, label),
    h("span", { class: "tile-value" }, value),
    extra,
    detail ? h("span", { class: "tile-detail" }, detail) : null);
}

function renderTiles(context, entriesToday, now) {
  const preferences = context.preferences;
  const data = context.data;
  const of = (type) => entriesToday.filter((entry) => entry.type === type);

  const fluidMl = of("fluid").reduce((total, entry) => total + (entry.data.amountMl ?? 0), 0);
  const goalMl = preferences.dailyFluidGoalMl;
  const hoursIntoDay = (now - startOfDay(now)) / HOUR_MS;
  const drinkingHours = DRINKING_DAY_END_HOUR - DRINKING_DAY_START_HOUR;
  const expectedShare = Math.max(0, Math.min(1, (hoursIntoDay - DRINKING_DAY_START_HOUR) / drinkingHours));
  const behindPace = goalMl && fluidMl < goalMl * expectedShare * BEHIND_PACE_SHARE;

  const bowelMovements = data.entries.filter((entry) => !entry.voided_at && entry.type === "bowel")
    .sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at));
  const lastBowel = bowelMovements[0];
  const daysSinceBowel = lastBowel ? (now - new Date(lastBowel.occurred_at)) / DAY_MS : null;
  const bowelAlert = daysSinceBowel === null ? false : daysSinceBowel >= preferences.bowelAlertDays;

  const urinations = of("urine");
  const accidents = urinations.filter((entry) => entry.data.continence === "Accident (brief)").length;
  const meals = of("food").filter((entry) => typeof entry.data.percentEaten === "number" && entry.data.meal !== "Snack");
  const averageEaten = meals.length ? Math.round(meals.reduce((total, entry) => total + entry.data.percentEaten, 0) / meals.length) : null;

  const slots = doseSlots(context.medications, data.administrations, startOfDay(now), startOfDay(addDays(dateKey(now), 1)), now);
  const given = slots.filter((slot) => slot.state === "given").length;
  const problems = slots.filter((slot) => ["overdue", "missed", "refused", "held"].includes(slot.state)).length;

  const latestMood = of("behavior").filter((entry) => entry.data.moodScore).at(-1);

  return h("div", { class: "tiles" },
    tile("Fluids today", formatFluid(fluidMl, preferences.fluidUnit),
      goalMl ? `Goal ${formatFluid(goalMl, preferences.fluidUnit)}${behindPace ? " — behind pace" : ""}` : null,
      behindPace ? "warn" : "", goalMl ? progressBar(fluidMl / goalMl, "Fluids toward goal") : null),
    tile("Scheduled doses", `${given} / ${slots.length}`, problems ? `${problems} not given or overdue` : slots.length ? "given so far today" : "none scheduled", problems ? "alert" : ""),
    tile("Last bowel movement", lastBowel ? relativeTime(lastBowel.occurred_at, now) : "None this week",
      lastBowel ? `Type ${lastBowel.data.bristol ?? "?"}, ${formatDate(lastBowel.occurred_at, { weekday: "short" })} ${formatClock(lastBowel.occurred_at)}` : `Alert after ${preferences.bowelAlertDays} days`,
      bowelAlert || !lastBowel ? "alert" : ""),
    tile("Urinations today", String(urinations.length), accidents ? `${accidents} accident${accidents > 1 ? "s" : ""}` : "no accidents"),
    tile("Meals today", averageEaten === null ? "—" : `${averageEaten}%`, meals.length ? `average eaten, ${meals.length} meal${meals.length > 1 ? "s" : ""}` : "no meals charted"),
    tile("Mood", latestMood ? `${latestMood.data.moodScore} / 5` : "—", latestMood ? `as of ${formatClock(latestMood.occurred_at)}` : "not charted today"),
  );
}

// ---- Scheduled doses

function slotButtons(context, slot) {
  return [
    h("button", { class: "compact default", onclick: (event) => quickGive(context, slot, event.currentTarget), title: "Record as given now, with the usual dose" }, "✓ Given"),
    h("button", { class: "compact", onclick: () => openDoseForm(context, { medication: slot.medication, slot }) }, "More…"),
  ];
}

function renderAttention(context, now) {
  const slots = dosesNeedingAttention(context.medications, context.data.administrations, now);
  if (slots.length === 0) {
    return windowBox({ title: "Doses due now", className: "phone-order-1" },
      h("div", { class: "row" }, h("span", { class: "status-chip given" }, "✓"), "Nothing due or overdue right now."),
      nextUpcoming(context, now));
  }
  return windowBox({ title: "Doses due now", extra: `${slots.length} need attention`, className: "phone-order-1" },
    h("div", { class: "dose-list" }, slots.map((slot) => h("div", { class: `dose-row ${slot.state}` },
      h("div", {},
        h("div", { class: "dose-time" }, formatClockText(slot.clockTime)),
        h("div", { class: "small" }, slot.day === dateKey(now) ? "today" : "yesterday")),
      h("div", {},
        h("div", { class: "dose-name" }, slot.medication.name, " ", h("span", { class: "small" }, slot.medication.strength)),
        h("div", { class: "dose-detail" },
          [slot.medication.dose, slot.medication.route, slot.medication.instructions].filter(Boolean).join(" · ")),
        h("div", { class: "small" }, h("span", { class: `status-chip ${slot.state}` }, STATUS_WORDS[slot.state]), " ",
          slot.state === "overdue" ? `${formatDuration(now - slot.slotTime)} late` : relativeTime(slot.slotTime, now))),
      h("div", { class: "dose-actions" }, slotButtons(context, slot)),
    ))));
}

function nextUpcoming(context, now) {
  const upcoming = doseSlots(context.medications, context.data.administrations, now, new Date(now.getTime() + DAY_MS), now)
    .filter((slot) => slot.state === "upcoming");
  if (!upcoming.length) return null;
  const next = upcoming[0];
  const sameTime = upcoming.filter((slot) => slot.slotTime.getTime() === next.slotTime.getTime());
  return h("p", { class: "small muted" }, `Next: ${sameTime.map((slot) => slot.medication.name).join(", ")} at ${formatClockText(next.clockTime)} (${relativeTime(next.slotTime, now)}).`);
}

function renderTodaysDoses(context, now, today) {
  const scheduled = context.medications.filter((medication) => medication.kind === "scheduled");
  const slots = doseSlots(context.medications, context.data.administrations, startOfDay(today), startOfDay(addDays(today, 1)), now);
  const rows = scheduled
    .map((medication) => ({ medication, slots: slots.filter((slot) => slot.medication.id === medication.id) }))
    .filter((row) => row.slots.length > 0);
  // Doses recorded today without a slot (extra doses).
  const extras = context.data.administrations.filter((record) => !record.voided_at && !record.scheduled_for
    && dateKey(new Date(record.given_at)) === today && context.medicationById(record.medication_id)?.kind === "scheduled");

  return windowBox({ title: "Medication administration record — today", bodyClass: "flush", className: "phone-order-4" },
    rows.length === 0
      ? h("div", { class: "empty" }, scheduled.length ? "No scheduled doses today." : "No scheduled medications yet. Add them on the Medications tab.")
      : h("div", { class: "well" }, h("table", { class: "grid mar-table" },
        h("thead", {}, h("tr", {}, h("th", {}, "Medication"), h("th", {}, "Doses"))),
        h("tbody", {}, rows.map((row) => h("tr", {},
          h("td", {}, h("b", {}, row.medication.name), " ", row.medication.strength,
            h("div", { class: "small muted" }, [row.medication.dose, row.medication.purpose].filter(Boolean).join(" · "))),
          h("td", { class: "slots" }, row.slots.map((slot) => slotChip(context, slot))),
        ))),
      )),
    extras.length ? h("p", { class: "small", style: { padding: "0 8px" } }, "Extra doses today: ",
      extras.map((record) => `${context.medicationById(record.medication_id).name} at ${formatClock(record.given_at)}`).join(", ")) : null,
  );
}

function slotChip(context, slot) {
  const record = slot.record;
  const label = record
    ? `${formatClockText(slot.clockTime)} ${STATUS_WORDS[slot.state]} ${formatClock(record.given_at)} ${context.caregiverInitials(record.recorded_by)}${slot.timing && slot.timing !== "on time" ? ` (${slot.timing})` : ""}`
    : `${formatClockText(slot.clockTime)} ${STATUS_WORDS[slot.state]}`;
  return h("button", {
    class: `status-chip ${slot.state}`,
    title: record ? "Open this dose record" : "Record this dose",
    onclick: () => record
      ? openDoseForm(context, { medication: slot.medication, slot, existing: record })
      : openDoseForm(context, { medication: slot.medication, slot }),
  }, record?.status === "given" ? "✓ " : "", label);
}

// ---- As-needed medications

function renderAsNeeded(context, now) {
  const medications = context.medications.filter((medication) => medication.kind === "as_needed" && isActive(medication, now));
  if (medications.length === 0) {
    return windowBox({ title: "As-needed (PRN) medications", className: "phone-order-3" }, h("p", { class: "muted", style: { margin: 0 } }, "No as-needed medications on the list."));
  }
  return windowBox({ title: "As-needed (PRN) medications", className: "phone-order-3" },
    medications.map((medication) => {
      const status = asNeededStatus(medication, context.data.administrations, now);
      const last = status.last;
      const effectFraction = status.inEffect
        ? (status.activeUntil - now) / (medication.effect_duration_hours * HOUR_MS) : 0;
      return h("div", { class: "prn-card" },
        h("div", { class: "prn-head" },
          h("div", { class: "spacer" },
            h("div", { class: "prn-name" }, medication.name, " ", h("span", { class: "small" }, medication.strength)),
            h("div", { class: "small muted" }, [medication.dose, medication.purpose ? `for ${medication.purpose}` : null].filter(Boolean).join(" · "))),
          h("button", { class: status.canGiveNow ? "default" : "", onclick: () => openDoseForm(context, { medication }) }, "Give dose…"),
        ),
        h("div", { class: "prn-facts" },
          h("div", {}, "Last dose: ", last ? h("b", {}, `${formatClock(last.given_at)} (${relativeTime(last.given_at, now)})`) : h("b", {}, "none recorded")),
          h("div", {}, "Next allowed: ", status.canGiveNow
            ? h("span", { class: "prn-ready" }, "now")
            : h("span", { class: "prn-wait" }, `${formatClock(status.nextAllowedAt)} (${relativeTime(status.nextAllowedAt, now)})`)),
          h("div", {}, "Doses in 24 h: ", h("b", {}, `${status.dosesInLastDay}${medication.maximum_doses_per_day ? ` of ${medication.maximum_doses_per_day}` : ""}`)),
          medication.minimum_hours_between ? h("div", {}, `At least ${medication.minimum_hours_between} h apart`) : null,
        ),
        status.inEffect ? h("div", {},
          h("div", { class: "small" }, `Working until about ${formatClock(status.activeUntil)} — ${formatDuration(status.activeUntil - now)} left`),
          progressBar(effectFraction, "Time left in effect")) : null,
        status.followUpDue ? h("div", { class: "follow-up" },
          h("span", { class: "spacer" }, h("b", {}, "Follow-up due: "), `did the ${formatClock(status.followUpDue.given_at)} dose help?`),
          h("button", { class: "compact", onclick: () => openEffectForm(context, status.followUpDue, medication) }, "Record effect")) : null,
      );
    }));
}

// ---- Quick record

function renderQuickRecord(context) {
  const unit = context.preferences.fluidUnit;
  const quickAmounts = unit === "ml" ? [120, 240, 360] : [4, 8, 12];
  return windowBox({ title: "Record", className: "phone-order-2" },
    h("div", { class: "quick-grid" }, ENTRY_TYPE_ORDER.map((typeKey) => {
      const type = ENTRY_TYPES[typeKey];
      return h("button", { onclick: () => openEntryForm(context, typeKey), title: `Record ${type.label.toLowerCase()}` },
        h("span", { class: "type-badge", style: { background: type.color } }, type.badge), type.label);
    })),
    h("div", { class: "quick-fluids" },
      h("span", { class: "small" }, "Quick water:"),
      quickAmounts.map((amount) => h("button", {
        class: "compact",
        onclick: (event) => quickFluid(context, unit === "ml" ? amount : Math.round(amount * ML_PER_FLUID_OUNCE), event.currentTarget),
      }, `+${amount} ${unit === "ml" ? "mL" : "oz"}`))),
  );
}

// ---- Notable changes

function renderNotable(context, now) {
  const since = new Date(now.getTime() - NOTABLE_LOOKBACK_HOURS * HOUR_MS);
  const items = timelineItems({
    entries: context.data.entries.filter((entry) => entry.notable && new Date(entry.occurred_at) >= since),
    administrations: context.data.administrations.filter((record) =>
      (record.safety_override || record.status === "refused" || record.status === "held" || record.effect === "not_effective")
      && new Date(record.given_at) >= since),
  }, { includeVoided: false });
  return windowBox({ title: "Notable changes — last 3 days", extra: items.length ? `${items.length}` : null, bodyClass: "flush", className: "phone-order-5" },
    h("div", { class: "well", style: { maxHeight: "320px" } },
      renderTimeline(items, context, { emptyText: "Nothing flagged. Tick \"Notable change\" when recording to show it here.", showDay: true })));
}
