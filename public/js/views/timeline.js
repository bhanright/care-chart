// One list of everything charted (observations and doses) in time order, shared by the
// Today screen and the Log.

import { ENTRY_TYPES, entrySummary } from "../entry-types.js";
import { openDoseForm, openEffectForm, openEntryForm, voidRecord } from "../forms.js";
import { formatClock, formatDate, formatDateTime } from "../time.js";
import { h } from "../ui.js";

const EFFECT_WORDS = { effective: "helped", partial: "helped somewhat", not_effective: "did not help" };

/** Merges entries and administrations into timeline items: { kind, time, record }. */
export function timelineItems(data, { includeVoided = true } = {}) {
  const items = [
    ...data.entries.map((record) => ({ kind: "entry", time: new Date(record.occurred_at), record })),
    ...data.administrations.map((record) => ({ kind: "dose", time: new Date(record.given_at), record })),
  ];
  return items.filter((item) => includeVoided || !item.record.voided_at).sort((a, b) => b.time - a.time);
}

export function itemTypeKey(item) {
  return item.kind === "dose" ? "medication" : item.record.type;
}

/** Plain text describing an item, used for display and for the search box. */
export function itemText(item, context) {
  if (item.kind === "entry") {
    return `${ENTRY_TYPES[item.record.type]?.label ?? item.record.type}: ${entrySummary(item.record, context.preferences)} ${item.record.note}`;
  }
  const record = item.record;
  const medication = context.medicationById(record.medication_id);
  return `${medication?.name ?? "Medication"} ${record.status} ${record.dose_given} ${record.reason} ${record.note} ${record.effect_note}`;
}

function badge(code, color, label) {
  return h("span", { class: "type-badge", style: { background: color }, title: label }, code);
}

function doseSummary(record, medication) {
  const parts = [h("span", { class: "summary" }, medication?.name ?? "Medication", " ", record.dose_given ? `(${record.dose_given})` : "")];
  const statusWord = { given: "given", refused: "REFUSED", held: "HELD", missed: "MISSED" }[record.status];
  parts.push(" — ", h("span", { class: `status-chip ${record.status}` }, statusWord));
  if (record.scheduled_for) parts.push(h("span", { class: "small muted" }, ` for the ${formatClock(record.scheduled_for)} dose`));
  else parts.push(h("span", { class: "small muted" }, " as needed"));
  return parts;
}

export function renderTimeline(items, context, { emptyText = "Nothing charted yet.", showDay = false } = {}) {
  if (items.length === 0) return h("div", { class: "empty" }, emptyText);
  const list = h("div", { class: "timeline" });
  let lastDay = null;
  for (const item of items) {
    const day = formatDate(item.time, { weekday: "long", month: "long", day: "numeric" });
    if (showDay && day !== lastDay) {
      list.append(h("div", { class: "day-heading" }, day));
      lastDay = day;
    }
    list.append(renderItem(item, context));
  }
  return list;
}

function renderItem(item, context) {
  const record = item.record;
  const voided = Boolean(record.voided_at);
  const recordedBy = context.caregiverName(record.recorded_by);
  const editedBy = record.updated_by && record.updated_at !== record.recorded_at ? context.caregiverName(record.updated_by) : null;
  let badgeElement;
  let body;
  let actions = [];

  if (item.kind === "entry") {
    const type = ENTRY_TYPES[record.type] ?? { label: record.type, badge: "??", color: "#666" };
    badgeElement = badge(type.badge, type.color, type.label);
    body = [
      h("div", {}, h("span", { class: "summary" }, record.type === "note" ? "Note" : entrySummary(record, context.preferences)),
        record.notable ? h("span", { class: "notable-flag" }, "  ● Notable") : null),
      record.note ? h("div", { class: "note" }, record.note) : null,
    ];
    if (!voided && context.can("record")) {
      actions = [
        h("button", { class: "compact", onclick: () => openEntryForm(context, record.type, record) }, "Edit"),
        h("button", { class: "compact", title: "Mark entered in error", onclick: () => voidRecord(context, "entry", record.id) }, "Error"),
      ];
    }
  } else {
    const medication = context.medicationById(record.medication_id);
    badgeElement = badge("Rx", "#9b1c1c", "Medication");
    body = [
      h("div", {}, doseSummary(record, medication)),
      record.reason ? h("div", { class: "small" }, record.status === "given" ? "Reason: " : "Why: ", record.reason) : null,
      record.note ? h("div", { class: "note small" }, record.note) : null,
      record.safety_override ? h("div", { class: "small", style: { color: "var(--overdue)" } }, "Given outside limits — ", record.safety_override) : null,
      record.effect ? h("div", { class: "small" }, `Follow-up: ${EFFECT_WORDS[record.effect]}`, record.effect_note ? ` — ${record.effect_note}` : "") : null,
    ];
    if (!voided && medication && context.can("record")) {
      actions = [
        h("button", { class: "compact", onclick: () => openDoseForm(context, { medication, existing: record }) }, "Edit"),
        medication.kind === "as_needed" && record.status === "given"
          ? h("button", { class: "compact", onclick: () => openEffectForm(context, record, medication) }, record.effect ? "Effect" : "Did it help?")
          : null,
        h("button", { class: "compact", title: "Mark entered in error", onclick: () => voidRecord(context, "administration", record.id) }, "Error"),
      ];
    }
  }

  if (voided) {
    body.push(h("div", { class: "small", style: { textDecoration: "none" } },
      `Entered in error (${context.caregiverName(record.voided_by)}): ${record.void_reason || "no reason given"}`));
  }

  return h("div", { class: `timeline-item ${voided ? "voided" : ""} ${record.notable ? "notable" : ""}` },
    h("div", { class: "when" }, formatClock(item.time)),
    badgeElement,
    h("div", { class: "what" }, body),
    h("div", { class: "who" },
      h("div", { title: `Recorded ${formatDateTime(record.recorded_at)}` }, recordedBy),
      editedBy ? h("div", { title: `Edited ${formatDateTime(record.updated_at)}` }, `edited by ${editedBy}`) : null,
      actions.length ? h("div", { class: "row no-print", style: { justifyContent: "flex-end", marginTop: "4px", gap: "4px" } }, actions) : null,
    ),
  );
}
