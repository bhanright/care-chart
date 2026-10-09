// The dialogs that write to the chart: observations, doses, dose follow-ups and
// medication orders. Each resolves true when it saved something.

import { api, ApiError } from "./api.js";
import { ENTRY_TYPES, ML_PER_FLUID_OUNCE, SIP_AMOUNTS_ML, formatFluid } from "./entry-types.js";
import { attachMedicationSearch } from "./medication-search.js";
import { clockTimeOf, formatClock, formatClockText, formatDate, formatDateTime, fromLocalInputValue, relativeTime, toLocalInputValue } from "./time.js";
import { choiceButtons, confirmBox, field, guardSave, h, openDialog, promptBox, toast, warningIcon } from "./ui.js";

const FLUID_PRESETS = { oz: [4, 6, 8, 12, 16], ml: [100, 150, 240, 350, 500] };
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function errorLine() {
  return h("p", { class: "error-text small", role: "alert" });
}

function whenField(initialIso) {
  const input = h("input", { type: "datetime-local", value: toLocalInputValue(initialIso), required: true });
  const nowButton = h("button", { type: "button", class: "compact", onclick: () => { input.value = toLocalInputValue(new Date()); input.dispatchEvent(new Event("change")); } }, "Now");
  const wrapper = field("When", h("div", { class: "row", style: { flexWrap: "nowrap" } }, input, nowButton), "when-field");
  wrapper.input = input;
  return wrapper;
}

// ---- Observations

/** Opens the form for an observation of `typeKey`, or edits `existing`. */
export function openEntryForm(context, typeKey, existing = null, preset = {}) {
  const type = ENTRY_TYPES[typeKey];
  const unit = context.preferences.fluidUnit;
  const data = { ...(existing?.data ?? preset) };
  if (!existing) {
    // Fields marked rememberLast start with the value of the most recent entry of this type.
    const latest = [...context.data.entries].reverse().find((entry) => entry.type === typeKey && !entry.voided_at);
    for (const spec of type.fields) {
      if (spec.rememberLast && data[spec.key] === undefined && latest?.data[spec.key] !== undefined) data[spec.key] = latest.data[spec.key];
    }
  }
  const controls = [];
  let when, note, notable, error;

  const fieldFor = (spec) => {
    if (spec.kind === "choice" || spec.kind === "scale" || spec.kind === "chips") {
      const control = choiceButtons({
        options: spec.options, value: data[spec.key], multiple: spec.kind === "chips", scale: spec.kind === "scale",
        label: spec.label, onchange: (value) => { data[spec.key] = value; },
      });
      return h("fieldset", {}, h("legend", {}, spec.label), control);
    }
    if (spec.kind === "fluid") {
      // Ounces show one decimal place, or two for sips so 5 mL does not round to nothing.
      const toDisplay = (milliliters, ounceDecimals = 1) => {
        if (!milliliters) return "";
        if (unit === "ml") return Math.round(milliliters);
        const scale = 10 ** ounceDecimals;
        return Math.round((milliliters / ML_PER_FLUID_OUNCE) * scale) / scale;
      };
      const input = h("input", { type: "number", inputmode: "decimal", min: "0", step: "any", value: toDisplay(data[spec.key]), style: { width: "110px" }, required: true });
      const store = () => {
        const amount = Number(input.value);
        data[spec.key] = input.value === "" ? null : Math.round(unit === "ml" ? amount : amount * ML_PER_FLUID_OUNCE);
      };
      input.addEventListener("input", store);
      const presets = FLUID_PRESETS[unit].map((amount) =>
        h("button", { type: "button", class: "compact", onclick: () => { input.value = amount; store(); } }, `${amount} ${unit === "ml" ? "mL" : "oz"}`));
      // Sip amounts are set in mL whatever the unit, then shown in the box in that unit.
      const sips = SIP_AMOUNTS_ML.map((milliliters) => h("button", {
        type: "button", class: "compact",
        onclick: () => { input.value = toDisplay(milliliters, 2); data[spec.key] = milliliters; },
      }, `${milliliters} mL`));
      return field(spec.label, h("div", { class: "stack" },
        h("div", { class: "row" }, input, h("span", {}, unit === "ml" ? "mL" : "fl oz"), h("span", { class: "spacer" }), presets),
        h("div", { class: "row" }, h("span", { class: "small muted" }, "Sips:"), sips)));
    }
    if (spec.kind === "number") {
      const input = h("input", { type: "number", inputmode: "decimal", step: spec.step ?? 1, min: spec.minimum, max: spec.maximum, value: data[spec.key] ?? "" });
      input.addEventListener("input", () => { data[spec.key] = input.value === "" ? null : Number(input.value); });
      controls.push(input);
      return field(`${spec.label}${spec.unit ? ` (${spec.unit})` : ""}`, input);
    }
    const input = h("input", { value: data[spec.key] ?? "", maxlength: "200" });
    input.addEventListener("input", () => { data[spec.key] = input.value.trim() || null; });
    return field(spec.label, input, "wide");
  };

  const save = guardSave(saveEntry);
  const numberFields = type.fields.filter((spec) => spec.kind === "number" || spec.kind === "text");
  const otherFields = type.fields.filter((spec) => !numberFields.includes(spec));

  return openDialog({
    title: `${existing ? "Edit" : "Record"}: ${type.label}`,
    build: (close) => h("form", { onsubmit: (event) => { event.preventDefault(); save(close); } },
      h("div", { class: "field-grid" }, when = whenField(existing?.occurred_at ?? new Date())),
      otherFields.map(fieldFor),
      numberFields.length ? h("div", { class: "field-grid", style: { marginTop: "10px" } }, numberFields.map(fieldFor)) : null,
      h("div", { style: { marginTop: "10px" } },
        field(typeKey === "note" ? "Note" : "Notes (optional)", note = h("textarea", { rows: typeKey === "note" ? 5 : 3, maxlength: "4000", autofocus: typeKey === "note" }, existing?.note ?? ""))),
      h("label", { class: "check", style: { marginTop: "8px" } },
        notable = h("input", { type: "checkbox", checked: Boolean(existing?.notable) }),
        h("span", {}, h("b", {}, "Notable change"), " — show this on the Today screen and in reports")),
      error = errorLine(),
      h("button", { type: "submit", hidden: true }),
    ),
    buttons: (close) => [
      h("button", { class: "default", onclick: () => save(close) }, existing ? "Save changes" : "Record"),
      h("button", { onclick: () => close(false) }, "Cancel"),
    ],
  });

  async function saveEntry(close) {
    error.textContent = "";
    for (const control of controls) {
      if (!control.checkValidity()) { error.textContent = "One of the numbers is out of range."; control.focus(); return; }
    }
    if (typeKey === "fluid" && !data.amountMl) { error.textContent = "Enter how much she drank."; return; }
    if (typeKey === "note" && !note.value.trim()) { error.textContent = "Write the note first."; return; }
    const cleaned = Object.fromEntries(Object.entries(data).filter(([, value]) =>
      value !== null && value !== undefined && value !== "" && !(Array.isArray(value) && value.length === 0)));
    const body = {
      type: typeKey, occurredAt: fromLocalInputValue(when.input.value), data: cleaned, note: note.value, notable: notable.checked,
      expectedUpdatedAt: existing?.updated_at,
    };
    try {
      const result = existing
        ? await api(`/api/entries/${existing.id}`, { method: "PUT", body })
        : await api("/api/entries", { method: "POST", body });
      close(true);
      await context.reload();
      if (!existing) {
        toast(`Recorded: ${ENTRY_TYPES[typeKey].summary(cleaned, context.preferences)}`, {
          action: { label: "Undo", run: () => voidRecord(context, "entry", result.entry.id, "Undone right after recording") },
        });
      }
    } catch (problem) {
      error.textContent = problem.message;
    }
  }
}

// ---- Meal-replacement shakes (Ensure and the like)

const DEFAULT_SHAKE_PRODUCT = "Ensure";
const DEFAULT_BOTTLE_OUNCES = 8;
/** Which meal a shake replaces, by the household clock's hour. */
function mealForHour(hour) {
  if (hour < 10.5) return "Breakfast";
  if (hour < 15) return "Lunch";
  if (hour < 20) return "Dinner";
  return "Snack";
}

/**
 * Records a meal-replacement shake: a meal entry (how much of the bottle she had) and,
 * unless unticked, a fluid entry for the same amount, since a shake is mostly liquid.
 * The product and bottle size start as last time's.
 */
export function openShakeForm(context) {
  const lastShake = [...context.data.entries].reverse().find((entry) => entry.type === "food" && entry.data.shakeProduct && !entry.voided_at);
  let percent = 100;
  let when, product, bottleOunces, countFluids, error;
  const hour = Number(clockTimeOf(new Date()).slice(0, 2)) + Number(clockTimeOf(new Date()).slice(3, 5)) / 60;
  let mealChoice = mealForHour(hour);
  const save = guardSave(async (close) => {
    error.textContent = "";
    const ounces = Number(bottleOunces.value);
    if (!product.value.trim() || !(ounces > 0)) { error.textContent = "Enter the product and bottle size."; return; }
    const occurredAt = fromLocalInputValue(when.input.value);
    const drankMl = Math.round(ounces * ML_PER_FLUID_OUNCE * (percent / 100));
    const name = product.value.trim();
    try {
      const food = await api("/api/entries", {
        method: "POST",
        body: {
          type: "food", occurredAt,
          data: { meal: mealChoice, percentEaten: percent, description: `${name} (${ounces} oz bottle)`, shakeProduct: name, bottleOunces: ounces },
          note: "",
        },
      });
      const created = [["entry", food.entry.id]];
      if (countFluids.checked) {
        const fluid = await api("/api/entries", {
          method: "POST",
          body: { type: "fluid", occurredAt, data: { amountMl: drankMl, drink: "Nutrition shake" }, note: name },
        });
        created.push(["entry", fluid.entry.id]);
      }
      close(true);
      await context.reload();
      toast(`Recorded: ${name}, ${percent}% of the bottle${countFluids.checked ? ` (${formatFluid(drankMl, context.preferences.fluidUnit)} toward fluids)` : ""}`, {
        action: {
          label: "Undo",
          run: async () => {
            for (const [kind, id] of created) await voidRecord(context, kind, id, "Undone right after recording");
          },
        },
      });
    } catch (problem) {
      error.textContent = problem.message;
    }
  });
  return openDialog({
    title: "Record: meal shake",
    size: "narrow",
    build: (close) => h("form", { onsubmit: (event) => { event.preventDefault(); save(close); } },
      h("div", { class: "field-grid" },
        when = whenField(new Date()),
        field("Product", product = h("input", { value: lastShake?.data.shakeProduct ?? DEFAULT_SHAKE_PRODUCT, maxlength: "60", list: "shake-products" })),
        field("Bottle size (fl oz)", bottleOunces = h("input", { type: "number", min: "1", max: "32", step: "any", inputmode: "decimal", value: lastShake?.data.bottleOunces ?? DEFAULT_BOTTLE_OUNCES })),
      ),
      h("datalist", { id: "shake-products" }, ["Ensure", "Ensure Plus", "Boost", "Boost Plus", "Glucerna", "Carnation Breakfast Essentials"].map((value) => h("option", { value }))),
      h("fieldset", {}, h("legend", {}, "How much of the bottle"), choiceButtons({
        options: [100, 75, 50, 25].map((value) => ({ value, label: { 100: "All", 75: "¾", 50: "½", 25: "¼" }[value] })),
        value: percent, label: "How much of the bottle",
        onchange: (value) => { percent = value ?? 100; },
      })),
      h("fieldset", {}, h("legend", {}, "In place of"), choiceButtons({
        options: ["Breakfast", "Lunch", "Dinner", "Snack"].map((value) => ({ value, label: value })),
        value: mealChoice, label: "In place of",
        onchange: (value) => { mealChoice = value ?? mealChoice; },
      })),
      h("label", { class: "check", style: { marginTop: "10px" } },
        countFluids = h("input", { type: "checkbox", checked: true }), "Also count it toward fluids"),
      error = errorLine(),
      h("button", { type: "submit", hidden: true }),
    ),
    buttons: (close) => [
      h("button", { class: "default", onclick: () => save(close) }, "Record"),
      h("button", { onclick: () => close(false) }, "Cancel"),
    ],
  });
}

/** One tap: records a fluid amount now. The button stays disabled until it is saved. */
export async function quickFluid(context, milliliters, button) {
  if (button?.disabled) return;
  if (button) button.disabled = true;
  try {
    const result = await api("/api/entries", { method: "POST", body: { type: "fluid", occurredAt: new Date().toISOString(), data: { amountMl: milliliters, drink: "Water" } } });
    await context.reload();
    toast(`Recorded ${formatFluid(milliliters, context.preferences.fluidUnit)} water`, {
      action: { label: "Undo", run: () => voidRecord(context, "entry", result.entry.id, "Undone right after recording") },
    });
  } catch (problem) {
    toast(problem.message, { error: true });
  } finally {
    if (button) button.disabled = false;
  }
}

// ---- Marking records entered in error

export async function voidRecord(context, kind, id, reason = null) {
  const finalReason = reason ?? await promptBox({
    title: "Mark entered in error",
    message: "The record stays on the chart, struck through, so the history is kept.",
    label: "Why is it wrong?",
    placeholder: "e.g. recorded twice, wrong medication",
    required: true,
    confirmText: "Mark in error",
  });
  if (finalReason === null) return false;
  try {
    await api(`/api/${kind === "entry" ? "entries" : "administrations"}/${id}/void`, { method: "POST", body: { reason: finalReason } });
    await context.reload();
    if (!reason) toast("Marked entered in error.");
    return true;
  } catch (problem) {
    toast(problem.message, { error: true });
    return false;
  }
}

// ---- Doses

/**
 * Records a scheduled dose in one tap, as given now with the usual dose. Offers Undo.
 */
export async function quickGive(context, slot, button) {
  if (button?.disabled) return;
  if (button) button.disabled = true;
  const body = {
    medicationId: slot.medication.id, scheduledFor: slot.scheduledFor, status: "given",
    givenAt: new Date().toISOString(), doseGiven: slot.medication.dose,
  };
  try {
    const result = await api("/api/administrations", { method: "POST", body });
    await context.reload();
    toast(`${slot.medication.name} ${formatClockText(slot.clockTime)} dose recorded as given.`, {
      action: { label: "Undo", run: () => voidRecord(context, "administration", result.administration.id, "Undone right after recording") },
    });
  } catch (problem) {
    await explainDoseProblem(context, problem);
  } finally {
    if (button) button.disabled = false;
  }
}

async function explainDoseProblem(context, problem) {
  if (problem instanceof ApiError && problem.body.code === "already_recorded") {
    const existing = problem.body.existing;
    await confirmBox({
      title: "Already recorded",
      kind: "warning",
      message: existing
        ? `${existing.recorded_by_name} already recorded this dose as ${existing.status} at ${formatClock(existing.given_at)}.`
        : "Someone already recorded this dose.",
      detail: h("p", { class: "small muted" }, "Nothing was changed. Do not give it again."),
      confirmText: "OK",
      cancelText: null,
    });
    await context.reload();
    return;
  }
  toast(problem.message, { error: true });
}

/**
 * The full dose form. For a scheduled slot it can record given, refused, held or missed;
 * for an as-needed medication it records the reason and checks the dosing limits.
 */
export function openDoseForm(context, { medication, slot = null, existing = null, status = "given" }) {
  const asNeeded = medication.kind === "as_needed";
  let chosenStatus = existing?.status ?? status;
  let when, dose, reason, note, error, warningArea, reasonLabel;
  const save = guardSave(saveDose);

  const statusChoice = asNeeded ? null : choiceButtons({
    options: [
      { value: "given", label: "Given" },
      { value: "refused", label: "Refused", hint: "She would not take it." },
      { value: "held", label: "Held", hint: "Deliberately not given (e.g. low blood pressure, doctor's instructions)." },
      { value: "missed", label: "Missed", hint: "Not given and the time has passed." },
    ],
    value: chosenStatus,
    label: "Outcome",
    onchange: (value) => { chosenStatus = value ?? "given"; updateReasonLabel(); },
  });

  const updateReasonLabel = () => {
    if (!reasonLabel) return;
    reasonLabel.textContent = asNeeded ? "Reason given (symptom)" : chosenStatus === "given" ? "Reason / comment" : `Why ${chosenStatus}?`;
  };

  const checkLimits = async () => {
    if (!asNeeded) return;
    try {
      const result = await api("/api/administrations/check", {
        method: "POST",
        body: { medicationId: medication.id, givenAt: fromLocalInputValue(when.input.value), ignoreId: existing?.id ?? null },
      });
      showWarnings(result.warnings);
    } catch {
      // The save will check again; nothing to show here.
    }
  };
  const showWarnings = (warnings) => {
    warningArea.replaceChildren();
    if (!warnings.length) return;
    warningArea.append(h("div", { class: "warning-box row", style: { flexWrap: "nowrap", alignItems: "flex-start" } },
      warningIcon(28),
      h("div", {}, h("b", {}, "Check before giving"), h("ul", {}, warnings.map((warning) => h("li", {}, warning))))));
  };

  const slotTime = slot?.slotTime ?? existing?.scheduled_for ?? null;
  const scheduledLine = slotTime
    ? `Scheduled ${formatClock(slotTime)} on ${formatDate(slotTime, { weekday: "short", month: "short", day: "numeric" })}`
    : asNeeded ? "As needed" : "Extra dose (not on the schedule)";

  const title = existing ? `Edit dose: ${medication.name}` : `${asNeeded ? "Give" : "Record dose"}: ${medication.name}`;
  const dialog = openDialog({
    title,
    build: (close) => h("form", { onsubmit: (event) => { event.preventDefault(); save(close); } },
      h("div", { class: "well", style: { padding: "8px 10px", marginBottom: "10px" } },
        h("div", {}, h("b", {}, medication.name), " ", medication.strength, medication.route ? ` · ${medication.route}` : ""),
        h("div", { class: "small muted" }, scheduledLine, medication.purpose ? ` · for ${medication.purpose}` : ""),
        medication.instructions ? h("div", { class: "small" }, "Instructions: ", medication.instructions) : null,
        context.patient.allergies ? h("div", { class: "small", style: { color: "var(--allergy)", fontWeight: "bold" } }, "Allergies: ", context.patient.allergies) : null,
      ),
      statusChoice ? h("fieldset", { style: { marginTop: 0, marginBottom: "10px" } }, h("legend", {}, "Outcome"), statusChoice) : null,
      h("div", { class: "field-grid" },
        when = whenField(existing?.given_at ?? new Date()),
        field("Dose given", dose = h("input", { value: existing?.dose_given ?? medication.dose ?? "", maxlength: "120" })),
      ),
      warningArea = h("div", { style: { marginTop: "10px" } }),
      h("div", { class: "field-grid", style: { marginTop: "10px" } },
        h("label", { class: "field wide" }, reasonLabel = h("span", {}), reason = h("input", { value: existing?.reason ?? "", maxlength: "500", placeholder: asNeeded ? "e.g. agitation, back pain 6/10" : "" })),
        field("Note (optional)", note = h("textarea", { rows: 2, maxlength: "2000" }, existing?.note ?? ""), "wide"),
      ),
      error = errorLine(),
      h("button", { type: "submit", hidden: true }),
    ),
    buttons: (close) => [
      h("button", { class: "default", onclick: () => save(close) }, existing ? "Save changes" : "Record"),
      h("button", { onclick: () => close(false) }, "Cancel"),
    ],
  });
  updateReasonLabel();
  when.input.addEventListener("change", checkLimits);
  checkLimits();
  return dialog;

  async function saveDose(close) {
    error.textContent = "";
    if (!asNeeded && chosenStatus !== "given" && !reason.value.trim()) { error.textContent = `Say why the dose was ${chosenStatus}.`; reason.focus(); return; }
    const body = {
      medicationId: medication.id,
      scheduledFor: slot?.scheduledFor ?? existing?.scheduled_for ?? null,
      status: asNeeded ? "given" : chosenStatus,
      givenAt: fromLocalInputValue(when.input.value),
      doseGiven: dose.value,
      reason: reason.value,
      note: note.value,
      expectedUpdatedAt: existing?.updated_at,
    };
    const send = (extra = {}) => existing
      ? api(`/api/administrations/${existing.id}`, { method: "PUT", body: { ...body, ...extra } })
      : api("/api/administrations", { method: "POST", body: { ...body, ...extra } });
    try {
      try {
        await send();
      } catch (problem) {
        if (!(problem instanceof ApiError && problem.body.code === "dose_warning")) throw problem;
        // Recording or editing, a dose outside the limits needs a written reason.
        showWarnings(problem.body.warnings);
        const override = await promptBox({
          title: "Dose outside limits",
          message: `${problem.body.warnings.join(" ")} Record it anyway only if a doctor or nurse said to, or you are sure.`,
          label: "Reason for giving anyway",
          required: true,
          confirmText: "Record anyway",
        });
        if (override === null) return;
        await send({ overrideReason: override });
      }
      close(true);
      await context.reload();
      toast(existing ? "Dose record updated." : `${medication.name}: ${body.status} at ${formatClock(body.givenAt)}.`);
    } catch (problem) {
      if (problem instanceof ApiError && problem.body.code === "already_recorded") {
        close(false);
        await explainDoseProblem(context, problem);
        return;
      }
      error.textContent = problem.message;
    }
  }
}

/** "Did it help?" for an as-needed dose. */
export function openEffectForm(context, administration, medication) {
  let effect = administration.effect ?? null;
  let note, error;
  return openDialog({
    title: `Follow-up: ${medication.name}`,
    size: "narrow",
    build: () => h("div", {},
      h("p", { style: { marginTop: 0 } }, `Given ${formatDateTime(administration.given_at)} (${relativeTime(administration.given_at)})`,
        administration.reason ? ` for ${administration.reason}` : "", "."),
      h("fieldset", {}, h("legend", {}, "Did it help?"), choiceButtons({
        options: [
          { value: "effective", label: "Yes" },
          { value: "partial", label: "Somewhat" },
          { value: "not_effective", label: "No" },
        ],
        value: effect,
        label: "Did it help?",
        onchange: (value) => { effect = value; },
      })),
      h("div", { style: { marginTop: "10px" } }, field("What did you see? (optional)", note = h("textarea", { rows: 2, maxlength: "1000" }, administration.effect_note ?? ""))),
      error = errorLine(),
    ),
    buttons: (close) => [
      h("button", {
        class: "default",
        onclick: guardSave(async () => {
          if (!effect) { error.textContent = "Choose Yes, Somewhat or No."; return; }
          try {
            await api(`/api/administrations/${administration.id}`, {
              method: "PUT", body: { effect, effectNote: note.value, expectedUpdatedAt: administration.updated_at },
            });
            close(true);
            await context.reload();
          } catch (problem) {
            error.textContent = problem.message;
          }
        }),
      }, "Save"),
      h("button", { onclick: () => close(false) }, "Cancel"),
    ],
  });
}

// ---- Medication orders

export function openMedicationForm(context, existing = null) {
  const medication = existing ?? {
    kind: "scheduled", schedule_times: ["08:00"], schedule_weekdays: [0, 1, 2, 3, 4, 5, 6], on_time_window_minutes: 60, route: "by mouth",
  };
  let kind = medication.kind;
  let weekdays = [...medication.schedule_weekdays];
  const inputs = {};
  let timesList, scheduledSection, asNeededSection, error, effectiveInput;
  // Changed only if the caregiver edits "Count doses from"; otherwise the server decides
  // (now for a new medication or a changed schedule, unchanged otherwise).
  let effectiveTouched = false;
  const save = guardSave(saveMedication);

  const input = (key, attributes = {}) => (inputs[key] = h("input", { value: medication[key] ?? "", ...attributes }));
  // The name, strength, dose and route inputs are made first so the name search can fill the others.
  input("name", { required: true, maxlength: "120", placeholder: "Start typing, e.g. donepezil or Aricept", autofocus: true });
  input("strength", { placeholder: "e.g. 5 mg" });
  input("dose", { placeholder: "e.g. 1 tablet" });
  input("route", { placeholder: "by mouth", list: "route-options" });
  const nameField = () => {
    const search = attachMedicationSearch({ nameInput: inputs.name, strengthInput: inputs.strength, doseInput: inputs.dose, routeInput: inputs.route });
    return h("div", { class: "field wide" },
      h("label", { for: "medication-name-input" }, "Medication name"),
      inputs.name, search.elements);
  };
  inputs.name.id = "medication-name-input";

  const timeRow = (value) => {
    const row = h("div", { class: "row", style: { flexWrap: "nowrap" } },
      h("input", { type: "time", value, required: true, class: "dose-time-input", style: { flex: "0 1 170px" } }),
      h("button", { type: "button", class: "compact", "aria-label": "Remove this time", onclick: () => row.remove() }, "Remove"));
    return row;
  };

  const showKind = () => {
    scheduledSection.hidden = kind !== "scheduled";
    asNeededSection.hidden = kind !== "as_needed";
  };

  const dialog = openDialog({
    title: existing ? `Edit medication: ${existing.name}` : "Add medication",
    size: "wide",
    build: (close) => h("form", { onsubmit: (event) => { event.preventDefault(); save(close); } },
      h("div", { class: "field-grid" },
        nameField(),
        field("Strength", inputs.strength),
        field("Usual dose", inputs.dose),
        field("Route", inputs.route),
        field("What it is for", input("purpose", { placeholder: "e.g. memory" })),
        field("Prescriber", input("prescriber")),
        field("Instructions", input("instructions", { placeholder: "e.g. with food; may crush" }), "wide"),
      ),
      h("datalist", { id: "route-options" }, ["by mouth", "under the tongue", "on the skin (patch)", "eye drops", "ear drops", "nasal spray", "inhaled", "injection", "rectal", "vaginal", "applied to skin"].map((value) => h("option", { value }))),
      h("fieldset", {}, h("legend", {}, "How it is given"), choiceButtons({
        options: [
          { value: "scheduled", label: "On a schedule", hint: "Given at set times every day (or on set days)." },
          { value: "as_needed", label: "As needed (PRN)", hint: "Given only when needed, with a minimum gap and a daily limit." },
        ],
        value: kind,
        label: "How it is given",
        onchange: (value) => { kind = value ?? kind; showKind(); },
      })),
      scheduledSection = h("fieldset", {}, h("legend", {}, "Schedule"),
        h("div", { class: "field" }, h("span", {}, "Dose times"),
          timesList = h("div", { class: "stack" }, medication.schedule_times.map(timeRow)),
          h("div", {}, h("button", { type: "button", class: "compact", style: { marginTop: "6px" }, onclick: () => timesList.append(timeRow("12:00")) }, "Add a time"))),
        h("div", { class: "field", style: { marginTop: "10px" } }, h("span", {}, "Days"),
          choiceButtons({
            options: WEEKDAY_NAMES.map((label, value) => ({ value, label })),
            value: weekdays, multiple: true, label: "Days",
            onchange: (value) => { weekdays = value; },
          })),
        h("div", { class: "field-grid", style: { marginTop: "10px" } },
          field("On time if within (minutes)", input("on_time_window_minutes", { type: "number", min: "5", max: "240", step: "5" })),
          field("Count doses from", effectiveInput = h("input", {
            type: "datetime-local",
            value: toLocalInputValue(existing?.schedule_effective_at ?? new Date()),
            oninput: () => { effectiveTouched = true; },
          }), "when-field"),
        ),
        h("p", { class: "small muted" }, existing
          ? "Changing the times or days counts doses from now, so no earlier dose shows as missed."
          : "Doses before this moment are not expected. If today's earlier dose was already given, set this earlier and record it on the Today screen."),
      ),
      asNeededSection = h("fieldset", {}, h("legend", {}, "As-needed limits"),
        h("div", { class: "field-grid" },
          field("At least this many hours apart", input("minimum_hours_between", { type: "number", min: "0", max: "168", step: "0.5", placeholder: "e.g. 4" })),
          field("Lasts about (hours)", input("effect_duration_hours", { type: "number", min: "0", max: "168", step: "0.5", placeholder: "e.g. 6" })),
          field("Most doses in 24 hours", input("maximum_doses_per_day", { type: "number", min: "1", max: "48", step: "1", placeholder: "e.g. 4" })),
          field("Ask \"did it help?\" after (minutes)", input("follow_up_minutes", { type: "number", min: "5", max: "1440", step: "5", placeholder: "e.g. 60" })),
        ),
        h("p", { class: "small muted" }, "These come from the label or the prescriber. The chart warns before a dose that breaks them."),
      ),
      h("fieldset", {}, h("legend", {}, "Course (optional)"),
        h("div", { class: "field-grid" },
          field("Start date", input("start_date", { type: "date" })),
          field("Last day", input("end_date", { type: "date" })),
        ),
        h("p", { class: "small muted" }, "Leave blank for an ongoing medication. Set a last day for courses such as antibiotics."),
      ),
      error = errorLine(),
      h("button", { type: "submit", hidden: true }),
    ),
    buttons: (close) => [
      existing && !existing.discontinued_at ? h("button", { class: "left danger", onclick: () => discontinue(close) }, "Discontinue…") : null,
      existing?.discontinued_at ? h("button", { class: "left", onclick: () => resume(close) }, "Restart") : null,
      h("button", { class: "default", onclick: () => save(close) }, existing ? "Save changes" : "Add medication"),
      h("button", { onclick: () => close(false) }, "Cancel"),
    ],
  });
  showKind();
  return dialog;

  async function saveMedication(close) {
    error.textContent = "";
    const form = inputs.name.form;
    if (!form.reportValidity()) return;
    const value = (key) => inputs[key].value.trim();
    const times = [...timesList.querySelectorAll(".dose-time-input")].map((element) => element.value).filter(Boolean);
    if (kind === "scheduled" && times.length === 0) { error.textContent = "Add at least one dose time."; return; }
    if (kind === "scheduled" && weekdays.length === 0) { error.textContent = "Choose at least one day."; return; }
    const body = {
      name: value("name"), strength: value("strength"), dose: value("dose"), route: value("route"),
      purpose: value("purpose"), instructions: value("instructions"), prescriber: value("prescriber"),
      kind, scheduleTimes: times, scheduleWeekdays: [...weekdays].sort(),
      onTimeWindowMinutes: value("on_time_window_minutes") || 60,
      minimumHoursBetween: value("minimum_hours_between"), effectDurationHours: value("effect_duration_hours"),
      maximumDosesPerDay: value("maximum_doses_per_day"), followUpMinutes: value("follow_up_minutes"),
      startDate: value("start_date"), endDate: value("end_date"),
      scheduleEffectiveAt: effectiveTouched && effectiveInput.value ? fromLocalInputValue(effectiveInput.value) : null,
      expectedUpdatedAt: existing?.updated_at,
    };
    try {
      if (existing) await api(`/api/medications/${existing.id}`, { method: "PUT", body });
      else await api("/api/medications", { method: "POST", body });
      close(true);
      await context.reload();
      toast(existing ? `${body.name} updated.` : `${body.name} added to the medication list.`);
    } catch (problem) {
      error.textContent = problem.message;
    }
  }

  async function discontinue(close) {
    const reason = await promptBox({
      title: "Discontinue medication",
      message: `Stop ${existing.name}? Its history stays on the chart, and it can be restarted later.`,
      label: "Reason",
      placeholder: "e.g. stopped by Dr. Lee on 10/8",
      confirmText: "Discontinue",
    });
    if (reason === null) return;
    try {
      await api(`/api/medications/${existing.id}/discontinue`, { method: "POST", body: { reason } });
      close(true);
      await context.reload();
      toast(`${existing.name} discontinued.`);
    } catch (problem) {
      error.textContent = problem.message;
    }
  }

  async function resume(close) {
    try {
      await api(`/api/medications/${existing.id}/resume`, { method: "POST", body: {} });
      close(true);
      await context.reload();
      toast(`${existing.name} restarted.`);
    } catch (problem) {
      error.textContent = problem.message;
    }
  }
}
