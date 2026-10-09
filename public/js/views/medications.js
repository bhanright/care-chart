// The Medications tab: the current medication list (the "orders"), and stopped ones.

import { openDoseForm, openMedicationForm } from "../forms.js";
import { isActive } from "../schedule.js";
import { formatClockText, formatDateTime } from "../time.js";
import { h, windowBox } from "../ui.js";

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function scheduleText(medication) {
  if (medication.kind === "as_needed") {
    return [
      "As needed",
      medication.minimum_hours_between ? `every ${medication.minimum_hours_between} h at most` : null,
      medication.maximum_doses_per_day ? `max ${medication.maximum_doses_per_day} in 24 h` : null,
      medication.effect_duration_hours ? `lasts ~${medication.effect_duration_hours} h` : null,
    ].filter(Boolean).join(", ");
  }
  const days = medication.schedule_weekdays.length === 7 ? "daily" : medication.schedule_weekdays.map((day) => WEEKDAY_NAMES[day]).join(", ");
  return `${medication.schedule_times.map(formatClockText).join(", ")} — ${days}`;
}

function courseText(medication) {
  if (medication.start_date && medication.end_date) return `${medication.start_date} to ${medication.end_date}`;
  if (medication.end_date) return `until ${medication.end_date}`;
  if (medication.start_date) return `from ${medication.start_date}`;
  return "";
}

function medicationTable(context, medications, { stopped = false } = {}) {
  return h("div", { class: "well" }, h("table", { class: "grid" },
    h("thead", {}, h("tr", {},
      h("th", {}, "Medication"), h("th", {}, "Dose"), h("th", {}, "Schedule"), h("th", {}, "For"),
      h("th", {}, stopped ? "Stopped" : "Instructions"), h("th", {}, ""))),
    h("tbody", {}, medications.map((medication) => h("tr", {},
      h("td", {}, h("b", {}, medication.name), " ", medication.strength,
        medication.prescriber ? h("div", { class: "small muted" }, medication.prescriber) : null),
      h("td", {}, medication.dose, h("div", { class: "small muted" }, medication.route)),
      h("td", {}, scheduleText(medication), courseText(medication) ? h("div", { class: "small muted" }, courseText(medication)) : null),
      h("td", {}, medication.purpose),
      h("td", {}, stopped
        ? [formatDateTime(medication.discontinued_at ?? medication.end_date), medication.discontinued_reason ? h("div", { class: "small muted" }, medication.discontinued_reason) : null]
        : medication.instructions),
      h("td", { class: "nowrap" },
        h("div", { class: "row", style: { gap: "4px", flexWrap: "nowrap" } },
          !stopped ? h("button", { class: "compact", title: medication.kind === "scheduled" ? "Record a dose that is not on the schedule" : "Give a dose", onclick: () => openDoseForm(context, { medication }) },
            medication.kind === "scheduled" ? "Extra dose" : "Give") : null,
          h("button", { class: "compact", onclick: () => openMedicationForm(context, medication) }, stopped ? "View" : "Edit"))),
    ))),
  ));
}

export function renderMedications(context) {
  const now = context.now();
  const active = context.medications.filter((medication) => isActive(medication, now));
  const stopped = context.medications.filter((medication) => !isActive(medication, now));
  const scheduled = active.filter((medication) => medication.kind === "scheduled");
  const asNeeded = active.filter((medication) => medication.kind === "as_needed");

  return h("div", { class: "stack" },
    h("div", { class: "toolbar" },
      h("button", { class: "default", onclick: () => openMedicationForm(context) }, "+ Add medication"),
      h("span", { class: "small muted" }, "Changes here take effect on the Today screen right away, for both of you."),
    ),
    context.patient.allergies
      ? h("div", { class: "warning-box" }, h("b", {}, "Allergies: "), context.patient.allergies)
      : h("div", { class: "warning-box" }, "No allergies recorded. Add them (or \"No known allergies\") under Settings → Patient."),
    windowBox({ title: "Scheduled medications", extra: `${scheduled.length}`, bodyClass: "flush" },
      scheduled.length ? medicationTable(context, scheduled) : h("div", { class: "empty" }, "None yet.")),
    windowBox({ title: "As-needed (PRN) medications", extra: `${asNeeded.length}`, bodyClass: "flush" },
      asNeeded.length ? medicationTable(context, asNeeded) : h("div", { class: "empty" }, "None yet.")),
    stopped.length ? h("details", {},
      h("summary", { style: { cursor: "pointer", padding: "4px 0" } }, `Stopped and finished medications (${stopped.length})`),
      medicationTable(context, stopped, { stopped: true })) : null,
  );
}
