// Report: a printable summary for a date range, to bring to the doctor, plus
// spreadsheet (CSV) and full backup downloads.

import { ENTRY_TYPES, entrySummary, formatFluid } from "../entry-types.js";
import { doseSlots, slotCounts } from "../schedule.js";
import { dailySummaries } from "../summaries.js";
import { addDays, ageFrom, dateKey, formatClock, formatClockText, formatDateTime, formatDay, formatDayKey, startOfDay } from "../time.js";
import { h } from "../ui.js";
import { VISIT_STATUSES } from "./visits.js";

export const reportState = { from: null, to: null };

function ensureDefaults(now) {
  reportState.to ??= dateKey(now);
  reportState.from ??= addDays(reportState.to, -6);
}

export function reportRange(now = new Date()) {
  ensureDefaults(now);
  return { from: startOfDay(reportState.from), to: startOfDay(addDays(reportState.to, 1)) };
}

const EFFECT_WORDS = { effective: "helped", partial: "somewhat", not_effective: "did not help" };

export function renderReport(context) {
  const now = context.now();
  ensureDefaults(now);
  const { from, to } = reportState;
  const patient = context.patient;
  const days = dailySummaries(context, from, to);
  const dayKeys = days.map((day) => day.day);
  const unit = context.preferences.fluidUnit;
  const live = (record) => !record.voided_at;
  const inRange = (iso) => { const day = dateKey(new Date(iso)); return day >= from && day <= to; };
  const entries = context.data.entries.filter((entry) => live(entry) && inRange(entry.occurred_at));
  const administrations = context.data.administrations.filter((record) => live(record) && inRange(record.given_at));
  const slots = doseSlots(context.medications, context.data.administrations, startOfDay(from), startOfDay(addDays(to, 1)), now);
  const medicationsInPeriod = context.medications.filter((medication) =>
    (!medication.discontinued_at || dateKey(new Date(medication.discontinued_at)) >= from)
    && (!medication.end_date || medication.end_date >= from)
    && (!medication.start_date || medication.start_date <= to));
  const statusOf = (medication) => {
    if (medication.discontinued_at) return `Stopped ${formatDateTime(medication.discontinued_at)}`;
    if (medication.end_date && medication.end_date < dateKey(now)) return `Finished ${formatDayKey(medication.end_date, { month: "short", day: "numeric" })}`;
    return "Active";
  };

  const setRange = (key, value) => { if (value) { reportState[key] = value; context.reload(); } };
  const quickRange = (count) => { reportState.to = dateKey(now); reportState.from = addDays(reportState.to, -(count - 1)); context.reload(); };

  const age = ageFrom(patient.dateOfBirth, now);
  const report = h("article", { class: "report" },
    h("h1", {}, `Care summary: ${patient.name || "Patient"}`),
    h("p", {}, `${formatDay(from)} to ${formatDay(to)} · Printed ${formatDateTime(now)} by ${context.me.name}`),
    h("table", {}, h("tbody", {},
      h("tr", {}, h("th", {}, "Date of birth"), h("td", {}, patient.dateOfBirth ? `${patient.dateOfBirth}${age !== null ? ` (age ${age})` : ""}` : "—"),
        h("th", {}, "Allergies"), h("td", { class: patient.allergies ? "flag" : "" }, patient.allergies || "Not recorded")),
      h("tr", {}, h("th", {}, "Conditions"), h("td", {}, patient.conditions || "—"), h("th", {}, "Physician"), h("td", {}, [patient.physician, patient.physicianPhone].filter(Boolean).join(", ") || "—")),
    )),

    h("h2", {}, "Medications"),
    h("table", {},
      h("thead", {}, h("tr", {}, ["Medication", "Dose", "Schedule", "For", "Status"].map((label) => h("th", {}, label)))),
      h("tbody", {}, medicationsInPeriod.map((medication) => h("tr", {},
        h("td", {}, `${medication.name} ${medication.strength}`),
        h("td", {}, `${medication.dose} ${medication.route}`),
        h("td", {}, medication.kind === "as_needed"
          ? `As needed${medication.minimum_hours_between ? `, ≥${medication.minimum_hours_between} h apart` : ""}${medication.maximum_doses_per_day ? `, max ${medication.maximum_doses_per_day}/24 h` : ""}`
          : `${medication.schedule_times.map(formatClockText).join(", ")}${medication.schedule_weekdays.length < 7 ? ` (${medication.schedule_weekdays.map((day) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day]).join(", ")})` : ""}`),
        h("td", {}, medication.purpose),
        h("td", {}, statusOf(medication)),
      )))),

    h("h2", {}, "Medication administration (given / due)"),
    h("table", {},
      h("thead", {}, h("tr", {}, h("th", {}, "Medication"), dayKeys.map((day) => h("th", { class: "number" }, formatDayKey(day, { month: "numeric", day: "numeric" }))))),
      h("tbody", {}, medicationsInPeriod.map((medication) => h("tr", {},
        h("td", {}, medication.name, medication.kind === "as_needed" ? " (PRN count)" : ""),
        days.map((day) => {
          if (medication.kind === "as_needed") return h("td", { class: "number" }, day.asNeededDoses[medication.id] || "");
          const mine = slots.filter((slot) => slot.day === day.day && slot.medication.id === medication.id);
          if (!mine.length) return h("td", { class: "number" }, "");
          const counts = slotCounts(mine);
          const later = counts.pending ? ` (+${counts.pending} later)` : "";
          return h("td", { class: `number ${counts.notGiven ? "flag" : ""}` }, `${counts.given}/${counts.counted}${later}`);
        }),
      )))),

    h("h2", {}, "Daily summary"),
    h("table", {},
      h("thead", {}, h("tr", {}, ["Day", "Fluids", "Meals eaten", "Bowel movements", "Urinations", "Accidents", "Mood (1–5)", "Max pain", "Sleep"].map((label) => h("th", {}, label)))),
      h("tbody", {}, days.map((day) => h("tr", {},
        h("td", {}, formatDay(day.day, "short")),
        h("td", { class: "number" }, formatFluid(day.fluidMl, unit)),
        h("td", { class: "number" }, day.mealAveragePercent === null ? "—" : `${Math.round(day.mealAveragePercent)}% (${day.mealCount})`),
        h("td", {}, day.bowelCount ? `${day.bowelCount}${day.bristolTypes.length ? ` (type ${day.bristolTypes.join(", ")})` : ""}` : h("span", { class: "flag" }, "none")),
        h("td", { class: "number" }, day.urineCount),
        h("td", { class: "number" }, day.accidents || ""),
        h("td", { class: "number" }, day.moodAverage === null ? "—" : day.moodAverage.toFixed(1)),
        h("td", { class: "number" }, day.painMaximum ?? "—"),
        h("td", { class: "number" }, day.sleepHours === null ? "—" : `${day.sleepHours} h`),
      )))),

    section("Doses not given", administrations.filter((record) => record.status !== "given")
      .map((record) => `${formatDateTime(record.scheduled_for ?? record.given_at)} — ${context.medicationById(record.medication_id)?.name}: ${record.status}${record.reason ? ` (${record.reason})` : ""}`)
      .concat(slots.filter((slot) => slot.state === "overdue").map((slot) => `${formatDateTime(slot.slotTime)} — ${slot.medication.name}: not recorded`))),

    section("As-needed doses", administrations.filter((record) => context.medicationById(record.medication_id)?.kind === "as_needed" && record.status === "given")
      .map((record) => `${formatDateTime(record.given_at)} — ${context.medicationById(record.medication_id).name} ${record.dose_given}${record.reason ? `, for ${record.reason}` : ""}${record.effect ? `; ${EFFECT_WORDS[record.effect]}` : ""}${record.effect_note ? ` (${record.effect_note})` : ""}${record.safety_override ? `; given outside limits: ${record.safety_override}` : ""}`)),

    section("Notable changes", entries.filter((entry) => entry.notable)
      .map((entry) => `${formatDateTime(entry.occurred_at)} — ${ENTRY_TYPES[entry.type]?.label}: ${entry.type === "note" ? "" : entrySummary(entry, context.preferences)}${entry.note ? ` ${entry.note}` : ""}`), true),

    h("h2", {}, "Care team visits"),
    (() => {
      const visits = (context.data.visits ?? []).filter((visit) => !visit.voided_at && inRange(visit.scheduled_at) && new Date(visit.scheduled_at) <= now)
        .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
      if (!visits.length) return h("p", {}, "None.");
      return h("table", {},
        h("thead", {}, h("tr", {}, ["When", "Who", "Outcome", "Notes"].map((label) => h("th", {}, label)))),
        h("tbody", {}, visits.map((visit) => h("tr", {},
          h("td", {}, formatDateTime(visit.scheduled_at)),
          h("td", {}, `${visit.role}${visit.visitor_name ? ` (${visit.visitor_name})` : ""}`),
          h("td", { class: visit.status === "completed" ? "" : "flag" }, VISIT_STATUSES[visit.status].label),
          h("td", {}, visit.outcome_note)))));
    })(),

    section("Vital signs", entries.filter((entry) => entry.type === "vitals")
      .map((entry) => `${formatDateTime(entry.occurred_at)} — ${entrySummary(entry, context.preferences)}`)),

    section("Mood and behavior notes", entries.filter((entry) => entry.type === "behavior" || entry.type === "note")
      .map((entry) => `${formatDateTime(entry.occurred_at)} — ${entry.type === "note" ? "" : `${entrySummary(entry, context.preferences)}. `}${entry.note}`)),
  );

  return h("div", {},
    h("div", { class: "toolbar no-print" },
      h("label", { class: "row" }, "From", h("input", { type: "date", value: from, max: to, onchange: (event) => setRange("from", event.target.value) })),
      h("label", { class: "row" }, "to", h("input", { type: "date", value: to, min: from, max: dateKey(now), onchange: (event) => setRange("to", event.target.value) })),
      [7, 14, 30].map((count) => h("button", { class: "compact", onclick: () => quickRange(count) }, `Last ${count} days`)),
      h("span", { class: "separator" }),
      h("button", { class: "default", onclick: () => window.print() }, "Print…"),
      h("button", { onclick: () => downloadCsv(context, entries, administrations, from, to) }, "Download CSV"),
      h("a", { class: "button", href: "/api/export", download: "" }, "Full backup (JSON)"),
    ),
    report,
  );
}

function section(title, lines, flagged = false) {
  return [
    h("h2", {}, title),
    lines.length
      ? h("ul", {}, lines.map((line) => h("li", { class: flagged ? "flag" : "" }, line)))
      : h("p", {}, "None."),
  ];
}

function csvCell(value) {
  let text = String(value ?? "");
  // A cell starting with = + - @ would run as a formula in a spreadsheet; the quote keeps it text.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(context, entries, administrations, from, to) {
  const rows = [["Date", "Time", "Category", "Details", "Notes", "Notable", "Recorded by"]];
  const items = [
    ...entries.map((entry) => ({ time: new Date(entry.occurred_at), cells: [ENTRY_TYPES[entry.type]?.label, entry.type === "note" ? "" : entrySummary(entry, context.preferences), entry.note, entry.notable ? "yes" : "", context.caregiverName(entry.recorded_by)] })),
    ...administrations.map((record) => {
      const medication = context.medicationById(record.medication_id);
      return { time: new Date(record.given_at), cells: ["Medication", `${medication?.name} ${record.dose_given} — ${record.status}${record.scheduled_for ? ` (for ${formatClock(record.scheduled_for)} dose)` : " (as needed)"}`, [record.reason, record.note, record.effect ? `effect: ${EFFECT_WORDS[record.effect]}` : ""].filter(Boolean).join("; "), record.safety_override ? "yes" : "", context.caregiverName(record.recorded_by)] };
    }),
  ].sort((a, b) => a.time - b.time);
  for (const item of items) rows.push([dateKey(item.time), formatClock(item.time), ...item.cells]);
  const blob = new Blob([rows.map((row) => row.map(csvCell).join(",")).join("\r\n")], { type: "text/csv" });
  const link = h("a", { href: URL.createObjectURL(blob), download: `care-chart-${from}-to-${to}.csv` });
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
