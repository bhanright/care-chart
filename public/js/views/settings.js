// Settings: the patient profile, household preferences (units, goals, time zone),
// this device's display and reminders, and the caregiver accounts.

import { api } from "../api.js";
import { ML_PER_FLUID_OUNCE } from "../entry-types.js";
import { LOOKS, lookByKey, schemeFor } from "../looks.js";
import { pushStatus, pushSupported, sendTestPush, turnOffPush, turnOnPush } from "../push.js";
import { deviceTimeZone, getHouseholdTimeZone } from "../time.js";
import { field, guardSave, h, openDialog, toast, windowBox } from "../ui.js";

export const DEFAULT_PATIENT = {
  name: "", preferredName: "", dateOfBirth: "", allergies: "", conditions: "", physician: "", physicianPhone: "",
  pharmacy: "", pharmacyPhone: "", emergencyContact: "", codeStatus: "", insurance: "", notes: "",
};
export const DEFAULT_PREFERENCES = { fluidUnit: "oz", dailyFluidGoalMl: 1500, bowelAlertDays: 3, timeZone: null };

function form(onsubmit, ...children) {
  return h("form", { onsubmit: (event) => { event.preventDefault(); onsubmit(event.target); } }, children);
}

/** Saves one settings key, refusing if the other caregiver saved it since this page loaded. */
async function saveSetting(context, key, value, message) {
  try {
    await api("/api/settings", { method: "PUT", body: { key, value, expectedUpdatedAt: context.data.settingsUpdatedAt?.[key] } });
    await context.reload();
    toast(message);
  } catch (problem) {
    toast(problem.message, { error: true, seconds: 10 });
    if (problem.body?.code === "changed_elsewhere") await context.reload();
  }
}

function timeZoneOptions(selected) {
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [selected];
  const usFirst = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu"];
  const ordered = [...usFirst, ...zones.filter((zone) => !usFirst.includes(zone))];
  if (!ordered.includes(selected)) ordered.unshift(selected);
  return ordered.map((zone) => h("option", { value: zone, selected: zone === selected }, zone.replace(/_/g, " ")));
}

export function renderSettings(context) {
  const patient = { ...DEFAULT_PATIENT, ...context.patient };
  const preferences = context.preferences;
  const patientInputs = {};
  const input = (key, attributes = {}) => (patientInputs[key] = h("input", { value: patient[key] ?? "", name: key, ...attributes }));
  const area = (key) => (patientInputs[key] = h("textarea", { rows: 2, name: key }, patient[key] ?? ""));

  const savePatient = guardSave(() => {
    const value = Object.fromEntries(Object.entries(patientInputs).map(([key, element]) => [key, element.value.trim()]));
    return saveSetting(context, "patient", value, "Patient profile saved.");
  });

  // Household preferences
  const unitSelect = h("select", {}, h("option", { value: "oz", selected: preferences.fluidUnit === "oz" }, "Fluid ounces (oz)"), h("option", { value: "ml", selected: preferences.fluidUnit === "ml" }, "Milliliters (mL)"));
  const goalDisplay = preferences.fluidUnit === "ml" ? preferences.dailyFluidGoalMl : Math.round(preferences.dailyFluidGoalMl / ML_PER_FLUID_OUNCE);
  const goalInput = h("input", { type: "number", min: "0", step: preferences.fluidUnit === "ml" ? "50" : "1", value: goalDisplay });
  const bowelInput = h("input", { type: "number", min: "1", max: "14", step: "1", value: preferences.bowelAlertDays });
  const zoneSelect = h("select", {}, timeZoneOptions(getHouseholdTimeZone()));
  const savePreferences = guardSave(() => {
    // The goal is typed in the unit shown when the page was drawn.
    const goal = Number(goalInput.value) || 0;
    return saveSetting(context, "preferences", {
      fluidUnit: unitSelect.value,
      dailyFluidGoalMl: Math.round(preferences.fluidUnit === "ml" ? goal : goal * ML_PER_FLUID_OUNCE),
      bowelAlertDays: Number(bowelInput.value) || 3,
      timeZone: zoneSelect.value,
    }, "Preferences saved.");
  });

  // This device
  const device = context.device;
  const themeSelect = h("select", { onchange: () => context.setDevice({ theme: themeSelect.value }) },
    [["auto", "Match this device"], ["day", "Day (light)"], ["night", "Night (dark)"]].map(([value, label]) => h("option", { value, selected: device.theme === value }, label)));
  const sizeSelect = h("select", { onchange: () => context.setDevice({ textSize: sizeSelect.value }) },
    [["normal", "Normal"], ["large", "Large"]].map(([value, label]) => h("option", { value, selected: device.textSize === value }, label)));
  const skinSelect = h("select", { onchange: () => { context.setDevice({ skin: skinSelect.value }); context.rerender(); } },
    LOOKS.map((look) => h("option", { value: look.key, selected: device.skin === look.key }, look.label)));
  const currentLook = lookByKey(device.skin);
  const currentScheme = schemeFor(device.skin, device.schemes);
  const schemeSelect = h("select", {
    onchange: () => context.setDevice({ schemes: { ...device.schemes, [currentLook.key]: schemeSelect.value } }),
  }, currentLook.schemes.map((scheme) => h("option", { value: scheme.value, selected: scheme.value === currentScheme }, scheme.label)));
  const remindersBox = h("div", {}, h("p", { class: "small muted" }, "Checking…"));
  fillReminders(context, remindersBox);

  // Caregivers
  const newName = h("input", { required: true, maxlength: "60", autocomplete: "off", name: "new-caregiver-name" });
  const newInitials = h("input", { maxlength: "4", style: { width: "80px" }, name: "new-caregiver-initials" });
  const newPassword = h("input", { type: "password", required: true, minlength: "8", autocomplete: "new-password", name: "new-caregiver-password" });
  const addCaregiver = guardSave(async (formElement) => {
    try {
      await api("/api/caregivers", { method: "POST", body: { name: newName.value, initials: newInitials.value, password: newPassword.value } });
      formElement.reset();
      await context.reload();
      toast("Caregiver added. Share the name and password with them privately.");
    } catch (problem) {
      toast(problem.message, { error: true });
    }
  });

  const currentPassword = h("input", { type: "password", required: true, autocomplete: "current-password", name: "current-password" });
  const nextPassword = h("input", { type: "password", required: true, minlength: "8", autocomplete: "new-password", name: "new-password" });
  const changePassword = guardSave(async (formElement) => {
    try {
      await api("/api/me/password", { method: "PUT", body: { currentPassword: currentPassword.value, newPassword: nextPassword.value } });
      formElement.reset();
      toast("Password changed. Other devices signed in as you have been signed out.");
    } catch (problem) {
      toast(problem.message, { error: true });
    }
  });
  const signOutEverywhere = async () => {
    try {
      await api("/api/me/sign-out-everywhere", { method: "POST", body: {} });
      toast("Signed out on every other device.");
    } catch (problem) {
      toast(problem.message, { error: true });
    }
  };

  return h("div", { class: "dashboard" },
    h("div", { class: "column" },
      windowBox({ title: "Patient" }, form(savePatient,
        h("div", { class: "field-grid" },
          field("Full name", input("name", { maxlength: "120" })),
          field("Goes by", input("preferredName", { maxlength: "60" })),
          field("Date of birth", input("dateOfBirth", { type: "date" })),
          field("Allergies", input("allergies", { placeholder: "e.g. penicillin (hives), or No known allergies" }), "wide"),
          field("Conditions / diagnoses", area("conditions"), "wide"),
          field("Physician", input("physician")),
          field("Physician phone", input("physicianPhone", { type: "tel" })),
          field("Pharmacy", input("pharmacy")),
          field("Pharmacy phone", input("pharmacyPhone", { type: "tel" })),
          field("Emergency contact", input("emergencyContact"), "wide"),
          field("Code status / advance directive", input("codeStatus", { placeholder: "e.g. Full code; DNR on file in kitchen drawer" }), "wide"),
          field("Insurance", input("insurance"), "wide"),
          field("Other notes for caregivers", area("notes"), "wide"),
        ),
        h("div", { class: "row", style: { marginTop: "10px" } }, h("button", { class: "default", type: "submit" }, "Save patient profile")),
      )),
    ),
    h("div", { class: "column" },
      windowBox({ title: "Household preferences" }, form(savePreferences,
        h("div", { class: "field-grid" },
          field("Fluid unit", unitSelect),
          field(`Daily fluid goal (${preferences.fluidUnit === "ml" ? "mL" : "oz"})`, goalInput),
          field("Warn after days without a bowel movement", bowelInput),
          field("Household time zone", zoneSelect, "wide"),
        ),
        h("p", { class: "small muted" }, "Dose times and days follow the household time zone on every device, so both phones agree on which dose is which. Ask her doctor for the right fluid goal; some heart and kidney conditions limit fluids."),
        h("button", { class: "default", type: "submit" }, "Save preferences"),
      )),
      windowBox({ title: "This device" },
        h("div", { class: "field-grid" },
          field("Look", skinSelect),
          currentLook.schemes.length ? field("Color scheme", schemeSelect) : null,
          field("Colors", themeSelect),
          field("Text size", sizeSelect)),
        deviceTimeZone() !== getHouseholdTimeZone()
          ? h("p", { class: "warning-box small" }, `This device is set to ${deviceTimeZone().replace(/_/g, " ")}. Care Chart shows household time (${getHouseholdTimeZone().replace(/_/g, " ")}).`)
          : null,
        h("fieldset", {}, h("legend", {}, "Dose reminders"), remindersBox),
      ),
      windowBox({ title: "Caregivers" },
        h("div", { class: "well" }, h("table", { class: "grid" },
          h("thead", {}, h("tr", {}, h("th", {}, "Name"), h("th", {}, "Initials"), h("th", {}, ""))),
          h("tbody", {}, context.caregivers.map((caregiver) => h("tr", {},
            h("td", {}, caregiver.name, caregiver.id === context.me.id ? " (you)" : ""),
            h("td", {}, caregiver.initials),
            h("td", {}, caregiver.id === context.me.id ? null
              : h("button", { class: "compact", onclick: () => openResetPassword(caregiver) }, "Reset password…"))))))),
        form(addCaregiver,
          h("p", { class: "small", style: { marginBottom: 0 } }, h("b", {}, "Add a caregiver"), " — anyone added can see and edit the whole chart."),
          h("div", { class: "field-grid" },
            field("Name", newName), field("Initials", newInitials), field("Password (8+ characters)", newPassword)),
          h("button", { type: "submit", style: { marginTop: "8px" } }, "Add caregiver"),
        ),
      ),
      windowBox({ title: `Your account: ${context.me.name}` },
        form(changePassword,
          h("div", { class: "field-grid" }, field("Current password", currentPassword), field("New password", nextPassword)),
          h("div", { class: "row", style: { marginTop: "8px" } },
            h("button", { type: "submit" }, "Change password")),
        ),
        h("div", { class: "row", style: { marginTop: "10px" } },
          h("button", { type: "button", onclick: signOutEverywhere, title: "For a lost or borrowed phone" }, "Sign out other devices"),
          h("span", { class: "spacer" }),
          h("button", { type: "button", onclick: () => context.signOut() }, "Sign out")),
      ),
    ),
  );
}

/** Lets one caregiver set a new password for another who forgot theirs. */
function openResetPassword(caregiver) {
  let newPassword, yourPassword, error;
  const save = guardSave(async (close) => {
    error.textContent = "";
    try {
      await api(`/api/caregivers/${caregiver.id}/password`, { method: "PUT", body: { newPassword: newPassword.value, yourPassword: yourPassword.value } });
      close(true);
      toast(`New password set for ${caregiver.name}. Their other devices were signed out.`);
    } catch (problem) {
      error.textContent = problem.message;
    }
  });
  return openDialog({
    title: `Reset password: ${caregiver.name}`,
    size: "narrow",
    build: (close) => h("form", { onsubmit: (event) => { event.preventDefault(); save(close); } },
      h("p", { style: { marginTop: 0 } }, `Set a new password for ${caregiver.name} and tell it to them in person.`),
      h("div", { class: "stack" },
        field(`New password for ${caregiver.name} (8+ characters)`, newPassword = h("input", { type: "password", minlength: "8", required: true, autocomplete: "new-password", name: "reset-new-password" })),
        field("Your own password, to confirm", yourPassword = h("input", { type: "password", required: true, autocomplete: "current-password", name: "reset-your-password" })),
      ),
      error = h("p", { class: "error-text small", role: "alert" }),
      h("button", { type: "submit", hidden: true }),
    ),
    buttons: (close) => [
      h("button", { class: "default", onclick: () => save(close) }, "Set password"),
      h("button", { onclick: () => close(false) }, "Cancel"),
    ],
  });
}

/** Fills the reminders box once the device's push status is known. */
async function fillReminders(context, box) {
  const show = (...children) => box.replaceChildren(...children.flat().filter(Boolean));
  if (!pushSupported()) {
    show(h("p", { class: "small muted" }, "This browser cannot receive reminders. On iPhone, add Care Chart to the home screen first (Share → Add to Home Screen), then open it from there."));
    return;
  }
  let status;
  try {
    status = await pushStatus();
  } catch (problem) {
    show(h("p", { class: "small error-text" }, problem.message));
    return;
  }
  const refresh = () => fillReminders(context, box);
  const deviceList = status.devices.length
    ? h("div", { class: "small" }, "Receiving reminders: ", status.devices.map((device) => `${device.caregiver_name} (${device.device_label || "device"})`).join(", "))
    : h("div", { class: "small muted" }, "No devices are receiving reminders yet.");

  if (!status.configured) {
    show(
      h("p", { class: "small", style: { marginTop: 0 } }, "Reminders with the app closed need the server's reminder keys (see the README, \"Dose reminders\"). Until then, this device reminds you only while Care Chart is open."),
      Notification.permission === "default" ? h("button", { onclick: async () => { await Notification.requestPermission(); refresh(); } }, "Allow notifications while open") : null,
    );
    return;
  }
  if (Notification.permission === "denied") {
    show(h("p", { class: "small error-text" }, "Notifications are blocked for this site. Allow them in the browser's site settings, then reload."), deviceList);
    return;
  }
  show(
    h("p", { class: "small", style: { marginTop: 0 } }, "When on, this device gets a notification when a dose falls due, goes overdue, or needs a \"did it help?\" follow-up, even with Care Chart closed and the screen locked."),
    status.thisDeviceOn
      ? h("div", { class: "row" },
        h("span", { class: "status-chip given" }, "On for this device"),
        h("button", { class: "compact", onclick: async (event) => {
          event.currentTarget.disabled = true;
          const delivered = await sendTestPush().catch(() => 0);
          toast(delivered ? `Test sent to ${delivered} device${delivered > 1 ? "s" : ""}.` : "The test could not be delivered.", { error: !delivered });
          refresh();
        } }, "Send a test"),
        h("button", { class: "compact", onclick: async () => { await turnOffPush(); refresh(); } }, "Turn off"))
      : h("button", { class: "default", onclick: async (event) => {
        event.currentTarget.disabled = true;
        try {
          await turnOnPush(status.publicKey);
          toast("Reminders are on for this device.");
          context.rerender();
        } catch (problem) {
          toast(problem.message, { error: true, seconds: 10 });
        }
        refresh();
      } }, "Turn on reminders for this device"),
    deviceList,
  );
}
