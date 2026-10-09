// Visits: the care team's calendar. Hospice nurses, aides, social workers and others are
// planned for a time (one visit, or weekly on chosen days), then marked with what happened:
// completed, care declined, cancelled by hospice or family, or no-show.

import { api } from "../api.js";
import { addDays, atClockTime, clockTimeOf, dateKey, formatClock, formatDate, formatDay, formatDayKey, startOfDay, weekdayOf } from "../time.js";
import { choiceButtons, field, guardSave, h, openDialog, promptBox, toast, windowBox } from "../ui.js";

/** Kept in step with ROLES in src/visits.ts. The short form labels calendar chips. */
export const VISIT_ROLES = [
  { value: "Hospice nurse (RN)", short: "RN" },
  { value: "Nurse (LPN)", short: "LPN" },
  { value: "Hospice aide", short: "Aide" },
  { value: "Social worker", short: "SW" },
  { value: "Chaplain", short: "Chap" },
  { value: "Hospice doctor / NP", short: "MD/NP" },
  { value: "Volunteer", short: "Vol" },
  { value: "Therapist", short: "PT/OT" },
  { value: "Other", short: "Other" },
];

/** Each outcome: its label, the chip class that colors it, and what its note asks for. */
export const VISIT_STATUSES = {
  scheduled: { label: "Scheduled", chip: "upcoming", noteLabel: "Note" },
  completed: { label: "Completed", chip: "given", noteLabel: "What was done (care given, changes, advice)" },
  declined: { label: "Declined care", chip: "held", noteLabel: "What did she decline, and why?" },
  cancelled_by_agency: { label: "Cancelled by hospice", chip: "upcoming cancelled", noteLabel: "Why was it cancelled? Rescheduled?" },
  cancelled_by_family: { label: "Cancelled by family", chip: "upcoming cancelled", noteLabel: "Why was it cancelled? Rescheduled?" },
  no_show: { label: "No-show", chip: "overdue", noteLabel: "Did anyone call? What happened?" },
};
/** A scheduled visit this long past its time, with nothing recorded, asks what happened. */
const NEEDS_OUTCOME_AFTER_MS = 2 * 3600 * 1000;
const UPCOMING_DAYS = 14;
const DEFAULT_REPEAT_WEEKS = 8;
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const visitsState = { month: dateKey(new Date()).slice(0, 7), selectedDay: dateKey(new Date()) };

function monthGrid(month) {
  const firstDay = `${month}-01`;
  const gridStart = addDays(firstDay, -weekdayOf(firstDay));
  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
}

/** The calendar's six weeks, plus the next two weeks for "Coming up". */
export function visitsRange(now = new Date()) {
  const grid = monthGrid(visitsState.month);
  const comingUpEnd = addDays(dateKey(now), UPCOMING_DAYS + 1);
  const lastDay = grid[41] > comingUpEnd ? grid[41] : comingUpEnd;
  const firstDay = grid[0] < dateKey(now) ? grid[0] : dateKey(now);
  return { from: startOfDay(addDays(firstDay, -3)), to: startOfDay(addDays(lastDay, 1)) };
}

const roleShort = (role) => VISIT_ROLES.find((item) => item.value === role)?.short ?? role;

export function needsOutcome(visit, now = new Date()) {
  return visit.status === "scheduled" && now - new Date(visit.scheduled_at) > NEEDS_OUTCOME_AFTER_MS;
}

function chipFor(visit, now) {
  if (needsOutcome(visit, now)) return { chip: "due", label: "What happened?" };
  const status = VISIT_STATUSES[visit.status];
  return { chip: status.chip, label: status.label };
}

/** One line describing a visit: "10:00 AM Hospice aide (Maria)". */
export function visitTitle(visit) {
  return `${formatClock(visit.scheduled_at)} ${visit.role}${visit.visitor_name ? ` (${visit.visitor_name})` : ""}`;
}

export function visitRow(context, visit, { showDay = false } = {}) {
  const now = context.now();
  const { chip, label } = chipFor(visit, now);
  return h("div", { class: `visit-row ${visit.voided_at ? "voided" : ""}` },
    h("div", { class: "visit-when" }, showDay ? h("div", { class: "small" }, formatDate(visit.scheduled_at, { weekday: "short", month: "short", day: "numeric" })) : null,
      formatClock(visit.scheduled_at)),
    h("div", { class: "visit-what" },
      h("div", {}, h("b", {}, visit.role), visit.visitor_name ? ` — ${visit.visitor_name}` : "", visit.agency ? h("span", { class: "small muted" }, ` · ${visit.agency}`) : null),
      h("div", {}, h("span", { class: `status-chip ${chip}` }, label),
        visit.duration_minutes ? h("span", { class: "small muted" }, ` · ${visit.duration_minutes} min`) : null,
        visit.series_id ? h("span", { class: "small muted" }, " · repeats weekly") : null),
      visit.outcome_note ? h("div", { class: "small note" }, visit.outcome_note) : null,
      visit.note ? h("div", { class: "small muted note" }, visit.note) : null,
      visit.voided_at ? h("div", { class: "small" }, `Entered in error: ${visit.void_reason || "no reason given"}`) : null,
    ),
    visit.voided_at ? null : h("div", { class: "visit-actions no-print" },
      // Outcome buttons appear from the visit's day on; before that, a future visit is only edited.
      visit.status === "scheduled" && dateKey(new Date(visit.scheduled_at)) <= dateKey(now) && context.can("record")
        ? [
          h("button", { class: "compact default", onclick: () => openVisitForm(context, visit, { status: "completed" }) }, "✓ Completed"),
          h("button", { class: "compact", onclick: () => openVisitForm(context, visit, { focusOutcome: true }) }, "Other outcome…"),
        ]
        : h("button", { class: "compact", onclick: () => openVisitForm(context, visit) }, context.can("full") ? "Edit" : "Open")),
  );
}

export function renderVisits(context) {
  const now = context.now();
  const today = dateKey(now);
  const visits = (context.data.visits ?? []).filter((visit) => !visit.voided_at);
  const byDay = new Map();
  for (const visit of visits) {
    const day = dateKey(new Date(visit.scheduled_at));
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(visit);
  }
  const grid = monthGrid(visitsState.month);
  const goToMonth = (offset) => {
    const [year, month] = visitsState.month.split("-").map(Number);
    const next = new Date(Date.UTC(year, month - 1 + offset, 1)).toISOString().slice(0, 7);
    visitsState.month = next;
    visitsState.selectedDay = `${next}-01`;
    context.reload();
  };
  const selectDay = (day) => { visitsState.selectedDay = day; context.rerender(); };
  const selectedVisits = (context.data.visits ?? []).filter((visit) => dateKey(new Date(visit.scheduled_at)) === visitsState.selectedDay)
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  const comingUpEnd = addDays(today, UPCOMING_DAYS);
  const comingUp = visits.filter((visit) => {
    const day = dateKey(new Date(visit.scheduled_at));
    return day >= today && day <= comingUpEnd && visit.status === "scheduled";
  }).sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  const waiting = visits.filter((visit) => needsOutcome(visit, now));

  const calendar = h("div", { class: "calendar", role: "grid", "aria-label": formatDayKey(`${visitsState.month}-01`, { month: "long", year: "numeric" }) },
    WEEKDAY_NAMES.map((name) => h("div", { class: "calendar-weekday", role: "columnheader" }, name)),
    grid.map((day) => {
      const dayVisits = (byDay.get(day) ?? []).sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
      const classes = ["calendar-day",
        day.slice(0, 7) !== visitsState.month ? "other-month" : "",
        day === today ? "today" : "",
        day === visitsState.selectedDay ? "selected" : ""].join(" ");
      return h("div", { class: classes, role: "gridcell", tabindex: "0", "aria-selected": String(day === visitsState.selectedDay),
        onclick: () => selectDay(day),
        onkeydown: (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectDay(day); } },
      },
      h("div", { class: "calendar-date" }, Number(day.slice(8))),
      dayVisits.map((visit) => {
        const { chip } = chipFor(visit, now);
        return h("button", {
          class: `status-chip calendar-visit ${chip}`, title: `${visitTitle(visit)} — ${chipFor(visit, now).label}`,
          onclick: (event) => { event.stopPropagation(); openVisitForm(context, visit); },
        },
        // "10a" style times; phones hide them (the day's list below has the times).
        h("span", { class: "calendar-visit-time" }, `${formatClock(visit.scheduled_at).replace(":00", "").replace(/ (AM|PM)/, (match, half) => half[0].toLowerCase())} `),
        roleShort(visit.role));
      }));
    }));

  return h("div", { class: "dashboard" },
    h("div", { class: "column" },
      h("div", { class: "toolbar" },
        h("button", { class: "compact", onclick: () => goToMonth(-1), "aria-label": "Previous month" }, "◀"),
        h("b", { style: { minWidth: "150px", textAlign: "center" } }, formatDayKey(`${visitsState.month}-01`, { month: "long", year: "numeric" })),
        h("button", { class: "compact", onclick: () => goToMonth(1), "aria-label": "Next month" }, "▶"),
        h("button", { class: "compact", onclick: () => { visitsState.month = today.slice(0, 7); visitsState.selectedDay = today; context.reload(); } }, "Today"),
        h("span", { class: "spacer" }),
        context.can("full") ? h("button", { class: "default", onclick: () => openVisitForm(context, null, { day: visitsState.selectedDay < today ? today : visitsState.selectedDay }) }, "+ Add visit") : null,
      ),
      windowBox({ title: "Care team calendar", bodyClass: "flush" }, calendar),
      windowBox({ title: formatDay(visitsState.selectedDay), extra: `${selectedVisits.filter((visit) => !visit.voided_at).length} visits` },
        selectedVisits.length
          ? h("div", { class: "stack" }, selectedVisits.map((visit) => visitRow(context, visit)))
          : h("p", { class: "muted", style: { margin: 0 } }, "No visits on this day."),
        context.can("full") ? h("div", { style: { marginTop: "10px" } },
          h("button", { class: "compact", onclick: () => openVisitForm(context, null, { day: visitsState.selectedDay }) }, "+ Add a visit on this day")) : null),
    ),
    h("div", { class: "column" },
      waiting.length ? windowBox({ title: "What happened?", extra: `${waiting.length}` },
        h("p", { class: "small", style: { marginTop: 0 } }, "These visits have passed with nothing recorded."),
        h("div", { class: "stack" }, waiting.map((visit) => visitRow(context, visit, { showDay: true })))) : null,
      windowBox({ title: `Coming up — next ${UPCOMING_DAYS} days`, extra: `${comingUp.length}` },
        comingUp.length
          ? h("div", { class: "stack" }, comingUp.map((visit) => visitRow(context, visit, { showDay: true })))
          : h("p", { class: "muted", style: { margin: 0 } }, "Nothing scheduled. Use + Add visit; regular visits can repeat weekly.")),
    ),
  );
}

/**
 * Adds a visit (or a weekly series), or edits one and records what happened.
 * options.status presets the outcome; options.focusOutcome opens straight to it.
 */
export function openVisitForm(context, existing = null, options = {}) {
  // Full access plans visits; recording care records what happened; view only reads.
  const canPlan = context.can("full");
  const canRecordOutcome = context.can("record");
  const pastVisits = context.data.visits ?? [];
  const known = (key) => [...new Set(pastVisits.map((visit) => visit[key]).filter(Boolean))];
  let role = existing?.role ?? pastVisits.at(-1)?.role ?? "Hospice aide";
  let status = options.status ?? existing?.status ?? "scheduled";
  let repeats = false;
  let repeatDays = [];  // weekdays (0 = Sunday) a weekly series falls on
  let dayInput, timeInput, durationInput, nameInput, agencyInput, noteInput, outcomeInput, outcomeLabel, repeatSection, untilInput, error;
  const weekdayHolder = h("div");
  // The weekday buttons start on the chosen day's weekday each time repeating is turned on.
  const showWeekdays = () => {
    repeatDays = [weekdayOf(dayInput.value || startDay)];
    weekdayHolder.replaceChildren(choiceButtons({
      options: WEEKDAY_NAMES.map((label, value) => ({ value, label })),
      value: repeatDays, multiple: true, label: "On these days",
      onchange: (value) => { repeatDays = value; },
    }));
  };
  const startDay = existing ? dateKey(new Date(existing.scheduled_at)) : options.day ?? dateKey(new Date());

  const updateOutcomeLabel = () => { if (outcomeLabel) outcomeLabel.textContent = VISIT_STATUSES[status].noteLabel; };

  const save = guardSave(async (close) => {
    error.textContent = "";
    if (!dayInput.value || !timeInput.value) { error.textContent = "Choose the day and time."; return; }
    const body = {
      role, status,
      durationMinutes: durationInput.value || null,
      visitorName: nameInput.value, agency: agencyInput.value,
      note: noteInput.value, outcomeNote: outcomeInput?.value ?? "",
    };
    try {
      if (existing) {
        await api(`/api/visits/${existing.id}`, {
          method: "PUT",
          body: { ...body, scheduledAt: atClockTime(dayInput.value, timeInput.value).toISOString(), expectedUpdatedAt: existing.updated_at },
        });
        toast(`Visit updated: ${VISIT_STATUSES[status].label.toLowerCase()}.`);
      } else if (repeats) {
        if (!untilInput.value || untilInput.value < dayInput.value) { error.textContent = "Choose a last day on or after the first."; return; }
        if (repeatDays.length === 0) { error.textContent = "Choose at least one day of the week."; return; }
        // Each visit's instant is worked out in the household's time zone, so a weekly
        // 10 AM visit stays at 10 AM across daylight-saving changes.
        const startTimes = [];
        for (let day = dayInput.value; day <= untilInput.value; day = addDays(day, 1)) {
          if (repeatDays.includes(weekdayOf(day))) startTimes.push(atClockTime(day, timeInput.value).toISOString());
        }
        const result = await api("/api/visits", { method: "POST", body: { ...body, startTimes } });
        toast(`Added ${result.created} weekly visits.`);
      } else {
        await api("/api/visits", { method: "POST", body: { ...body, scheduledAt: atClockTime(dayInput.value, timeInput.value).toISOString() } });
        toast("Visit added.");
      }
      close(true);
      await context.reload();
    } catch (problem) {
      error.textContent = problem.message;
    }
  });

  const markInError = async (close) => {
    const reason = await promptBox({
      title: "Mark entered in error", message: "The visit stays on record, struck through.",
      label: "Why is it wrong?", placeholder: "e.g. added twice", required: true, confirmText: "Mark in error",
    });
    if (reason === null) return;
    try {
      await api(`/api/visits/${existing.id}/void`, { method: "POST", body: { reason } });
      close(true);
      await context.reload();
      toast("Visit marked entered in error.");
    } catch (problem) {
      error.textContent = problem.message;
    }
  };
  const stopSeries = async (close) => {
    const reason = await promptBox({
      title: "Stop repeating visits",
      message: `Remove this and every later planned ${existing.role.toLowerCase()} visit in this weekly series? Visits already recorded are kept.`,
      label: "Reason (optional)", placeholder: "e.g. hospice changed the schedule", confirmText: "Stop repeating",
    });
    if (reason === null) return;
    try {
      const result = await api(`/api/visits/${existing.id}/cancel-series`, { method: "POST", body: { reason } });
      close(true);
      await context.reload();
      toast(`Removed ${result.stopped} planned visits.`);
    } catch (problem) {
      error.textContent = problem.message;
    }
  };

  const outcomeSection = existing ? h("fieldset", {}, h("legend", {}, "What happened"),
    choiceButtons({
      options: Object.entries(VISIT_STATUSES).map(([value, info]) => ({ value, label: info.label })),
      value: status, label: "What happened",
      onchange: (value) => { status = value ?? "scheduled"; updateOutcomeLabel(); },
    }),
    h("label", { class: "field", style: { marginTop: "8px" } },
      outcomeLabel = h("span", {}),
      outcomeInput = h("textarea", { rows: 3, maxlength: "2000", autofocus: Boolean(options.focusOutcome || options.status) }, existing.outcome_note ?? ""))) : null;

  const dialog = openDialog({
    title: existing ? `Visit: ${existing.role}` : "Add a care team visit",
    size: "wide",
    readOnly: !canRecordOutcome,
    build: (close) => h("form", { onsubmit: (event) => { event.preventDefault(); save(close); } },
      outcomeSection,
      h("fieldset", { disabled: !canPlan }, h("legend", {}, "Who"), choiceButtons({
        options: VISIT_ROLES.map((item) => ({ value: item.value, label: item.value })),
        value: role, label: "Who",
        onchange: (value) => { role = value ?? role; },
      }),
      h("div", { class: "field-grid", style: { marginTop: "8px" } },
        field("Visitor's name", nameInput = h("input", { value: existing?.visitor_name ?? "", maxlength: "80", list: "visitor-names", autocomplete: "off" })),
        field("Agency", agencyInput = h("input", { value: existing?.agency ?? pastVisits.at(-1)?.agency ?? "", maxlength: "120", list: "visit-agencies", autocomplete: "off" })))),
      h("datalist", { id: "visitor-names" }, known("visitor_name").map((value) => h("option", { value }))),
      h("datalist", { id: "visit-agencies" }, known("agency").map((value) => h("option", { value }))),
      h("fieldset", { disabled: !canPlan }, h("legend", {}, "When"),
        h("div", { class: "field-grid" },
          field("Day", dayInput = h("input", { type: "date", value: startDay, required: true })),
          field("Time", timeInput = h("input", { type: "time", value: existing ? clockTimeOf(existing.scheduled_at) : "10:00", required: true })),
          field("Expected length (minutes)", durationInput = h("input", { type: "number", min: "5", max: "1440", step: "5", value: existing?.duration_minutes ?? "" }))),
        existing ? null : h("label", { class: "check", style: { marginTop: "8px" } },
          h("input", { type: "checkbox", onchange: (event) => {
            repeats = event.target.checked;
            repeatSection.hidden = !repeats;
            if (repeats) { showWeekdays(); untilInput.value = addDays(dayInput.value || startDay, DEFAULT_REPEAT_WEEKS * 7 - 1); }
          } }),
          "Repeats every week"),
        existing ? null : repeatSection = h("div", { hidden: true, style: { marginTop: "8px" } },
          h("div", { class: "field" }, h("span", {}, "On these days"), weekdayHolder),
          h("div", { class: "field-grid", style: { marginTop: "8px" } },
            field("Until (last day)", untilInput = h("input", { type: "date", value: addDays(startDay, DEFAULT_REPEAT_WEEKS * 7 - 1) })))),
        existing?.series_id ? h("p", { class: "small muted" }, "Part of a weekly series. Changes here affect only this visit.") : null),
      h("div", { style: { marginTop: "10px" } }, field("Note (optional)", noteInput = h("textarea", { rows: 2, maxlength: "2000", disabled: !canPlan, placeholder: "e.g. bringing new bed pads; call before arriving" }, existing?.note ?? ""))),
      error = h("p", { class: "error-text small", role: "alert" }),
      h("button", { type: "submit", hidden: true }),
    ),
    buttons: (close) => [
      existing && canPlan ? h("button", { class: "left", onclick: () => markInError(close) }, "Mark in error…") : null,
      existing?.series_id && existing.status === "scheduled" && canPlan ? h("button", { onclick: () => stopSeries(close) }, "Stop repeating…") : null,
      h("button", { class: "default", onclick: () => save(close) }, existing ? "Save" : "Add visit"),
      h("button", { onclick: () => close(false) }, "Cancel"),
    ],
  });
  updateOutcomeLabel();
  return dialog;
}
