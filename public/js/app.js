// Care Chart: starts the app, signs in, switches tabs, keeps both caregivers' screens
// in sync and raises dose reminders.

import { accessLabel, hasAccess } from "./access.js";
import { api } from "./api.js";
import { openEntryForm } from "./forms.js";
import { openLookPicker } from "./look-picker.js";
import { DEFAULT_LOOK, LOOKS, lookByKey, schemeFor } from "./looks.js";
import { serverRemindsThisDevice } from "./push.js";
import { asNeededStatus, dosesNeedingAttention, isActive, normalizeMedication } from "./schedule.js";
import { ageFrom, deviceTimeZone, formatClock, formatClockText, formatDate, formatDayKey, getHouseholdTimeZone, setHouseholdTimeZone } from "./time.js";
import { chartIcon, clear, field, h, isDialogOpen, openDialog, toast, windowBox } from "./ui.js";
import { logRange, renderLog } from "./views/log.js";
import { renderMedications } from "./views/medications.js";
import { renderReport, reportRange } from "./views/report.js";
import { DEFAULT_PATIENT, DEFAULT_PREFERENCES, renderSettings } from "./views/settings.js";
import { renderToday, todayRange } from "./views/today.js";
import { renderVisits, visitsRange } from "./views/visits.js";
import { installChartTooltips, renderTrends, trendsRange } from "./views/trends.js";

const SYNC_CHECK_SECONDS = 15;
const SCREEN_REFRESH_SECONDS = 30;
const DEVICE_STORAGE_KEY = "care-chart-device";
const NOTIFIED_STORAGE_KEY = "care-chart-notified";
/** Enough remembered reminder keys to cover several days of doses. */
const REMEMBERED_REMINDER_KEYS = 300;

const TABS = [
  { key: "today", label: "Today", render: renderToday, range: todayRange },
  { key: "medications", label: "Medications", render: renderMedications, range: todayRange },
  { key: "visits", label: "Visits", render: renderVisits, range: visitsRange },
  { key: "log", label: "Log", render: renderLog, range: logRange },
  { key: "trends", label: "Trends", render: renderTrends, range: trendsRange },
  { key: "report", label: "Report", render: renderReport, range: reportRange },
  { key: "settings", label: "Settings", render: renderSettings, range: todayRange },
];

const root = document.getElementById("app");
const state = {
  tab: "today",
  chart: null,       // the last /api/chart response
  revision: null,
  online: true,
  syncedAt: null,
  loading: false,
};

// ---- Per-device preferences (theme, text size, look). Storage may be unavailable.

/** skin is the look's key (public/js/looks.js); schemes holds each look's chosen color scheme. */
/** Light ("day") colors unless the device's own Settings choose otherwise. */
const DEVICE_DEFAULTS = { theme: "day", textSize: "normal", skin: DEFAULT_LOOK, schemes: {}, themeDefaultVersion: 2 };

function readDevice() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(DEVICE_STORAGE_KEY) ?? "{}");
  } catch {
    // storage unavailable; use the defaults
  }
  // ?look=<key> in the address (for example ?look=xp; keys are in looks.js) switches the look on this device.
  const lookFromAddress = new URLSearchParams(location.search).get("look");
  const device = { ...DEVICE_DEFAULTS, ...saved };
  // A saved look this version does not have falls back to the default.
  device.skin = lookByKey(device.skin).key;
  // Settings from earlier versions: one scheme for XP, an accent for a retired look.
  if (typeof device.scheme === "string") device.schemes = { ...device.schemes, xp: device.scheme };
  delete device.scheme;
  delete device.accent;
  // Devices saved before light became the default (version 2) had "Match this device"
  // only because it was the default then; move them to light once. A later choice sticks.
  if ((saved.themeDefaultVersion ?? 1) < 2) {
    if (device.theme === "auto") device.theme = "day";
    device.themeDefaultVersion = 2;
    try { localStorage.setItem(DEVICE_STORAGE_KEY, JSON.stringify(device)); } catch { /* per-device nicety only */ }
  }
  if (LOOKS.some((look) => look.key === lookFromAddress)) {
    device.skin = lookFromAddress;
    try { localStorage.setItem(DEVICE_STORAGE_KEY, JSON.stringify(device)); } catch { /* per-device nicety only */ }
  }
  return device;
}
let device = readDevice();
function applyDevice() {
  const root = document.documentElement;
  root.dataset.theme = device.theme;
  root.dataset.textSize = device.textSize;
  root.dataset.skin = device.skin;
  root.dataset.scheme = schemeFor(device.skin, device.schemes);
}
applyDevice();

// ---- The context every view receives.

const context = {
  get data() { return state.chart; },
  get me() { return state.chart.me; },
  /** Whether the signed-in caregiver may do this: "record" care, or "full" (everything). */
  can: (needed) => hasAccess(state.chart.me, needed),
  get caregivers() { return state.chart.caregivers; },
  get medications() { return state.chart.medicationsNormalized; },
  get patient() { return { ...DEFAULT_PATIENT, ...(state.chart.settings.patient ?? {}) }; },
  get preferences() { return { ...DEFAULT_PREFERENCES, ...(state.chart.settings.preferences ?? {}) }; },
  get device() { return device; },
  now: () => new Date(),
  reload: () => loadChart(),
  rerender: (options) => render(options),
  medicationById: (id) => state.chart.medicationsNormalized.find((medication) => medication.id === id) ?? null,
  // A removed caregiver's name stays on their past records, marked as removed.
  caregiverName: (id) => {
    const caregiver = state.chart.caregivers.find((item) => item.id === id);
    if (!caregiver) return "—";
    return caregiver.removed_at ? `${caregiver.name} (removed)` : caregiver.name;
  },
  caregiverInitials: (id) => state.chart.caregivers.find((caregiver) => caregiver.id === id)?.initials ?? "",
  setDevice: (changes) => {
    device = { ...device, ...changes };
    try { localStorage.setItem(DEVICE_STORAGE_KEY, JSON.stringify(device)); } catch { /* per-device nicety only */ }
    applyDevice();
  },
  testNotification: () => notify("Care Chart reminders are on", "Dose reminders will appear like this.", "test"),
  signOut: async () => {
    await api("/api/logout", { method: "POST", body: {} }).catch(() => {});
    location.reload();
  },
};

// ---- Loading

/** The time range the current tab needs, widened so Today's reminders always have data. */
function currentRange() {
  const tab = TABS.find((item) => item.key === state.tab);
  const wanted = tab.range(new Date());
  const reminders = todayRange(new Date());
  return {
    from: new Date(Math.min(wanted.from, reminders.from)),
    to: new Date(Math.max(wanted.to, reminders.to)),
  };
}

let latestLoad = 0;

async function loadChart() {
  const { from, to } = currentRange();
  // If two loads overlap (a save, then a tab switch), only the newest one may draw.
  const thisLoad = ++latestLoad;
  state.loading = true;
  renderStatus();
  try {
    const chart = await api(`/api/chart?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`);
    if (thisLoad !== latestLoad) return;
    chart.medicationsNormalized = chart.medications.map(normalizeMedication);
    // Every device shows and schedules in the household's zone. The first device to
    // open the chart records its own zone as the household's.
    const savedZone = chart.settings.preferences?.timeZone;
    setHouseholdTimeZone(savedZone);
    if (!savedZone) saveHouseholdTimeZone(chart);
    state.chart = chart;
    state.revision = chart.revision;
    state.online = true;
    state.syncedAt = new Date();
    render();
    checkReminders();
  } catch (problem) {
    state.online = false;
    if (problem.status !== 401) toast(problem.message, { error: true });
  } finally {
    state.loading = false;
    renderStatus();
  }
}

async function saveHouseholdTimeZone(chart) {
  const preferences = { ...DEFAULT_PREFERENCES, ...(chart.settings.preferences ?? {}), timeZone: deviceTimeZone() };
  await api("/api/settings", { method: "PUT", body: { key: "preferences", value: preferences, expectedUpdatedAt: chart.settingsUpdatedAt?.preferences } })
    .catch(() => { /* the other caregiver may have just saved it; the next load picks it up */ });
}

async function checkForChanges() {
  if (!state.chart || document.hidden) return;
  try {
    const { revision } = await api("/api/revision");
    state.online = true;
    state.syncedAt = new Date();
    // Don't redraw under an open dialog; saving from it reloads anyway.
    if (revision !== state.revision && !isDialogOpen()) await loadChart();
    else renderStatus();
  } catch {
    state.online = false;
    renderStatus();
  }
}

// ---- Rendering

let frame = null;

function renderFrame() {
  clear(root);
  frame = {
    banner: h("div"),
    tabs: h("div", { class: "tabs", role: "tablist" }),
    panel: h("div", { class: "tab-panel", role: "tabpanel" }),
    status: h("div", { class: "status-bar" }),
  };
  root.append(h("div", { class: "app" },
    h("div", { class: "window app-window" },
      h("div", { class: "title-bar" },
        chartIcon(),
        h("span", { class: "title" }, "Care Chart"),
        h("button", { class: "title-button", title: "Keyboard shortcuts", "aria-label": "Keyboard shortcuts", onclick: showShortcuts }, "?"),
      ),
      h("div", { class: "window-body", style: { padding: "6px" } },
        frame.banner,
        frame.tabs,
        frame.panel,
        frame.status,
      ),
    ),
  ));
}

// Each device is offered the "Choose a look" window once, the first time someone signs in
// there (device.lookChosen remembers it). Shown at most once per page load.
let lookPickerOffered = false;
function offerLookPicker() {
  if (lookPickerOffered || device.lookChosen) return;
  lookPickerOffered = true;
  openLookPicker(context);
}

function render({ keepFocus = null } = {}) {
  if (!state.chart) return;
  if (!frame) {
    renderFrame();
    setTimeout(offerLookPicker); // after the first screen is drawn behind it
  }
  const scroll = window.scrollY;
  // A background update must not pull the caret out of a field being typed in.
  const focusedId = keepFocus ?? (frame.panel.contains(document.activeElement) && document.activeElement.id ? document.activeElement.id : null);
  renderBanner();
  renderTabs();
  const tab = TABS.find((item) => item.key === state.tab);
  const content = tab.render(context);
  clear(frame.panel);
  if (state.tab === "today") {
    const gettingStarted = renderGettingStarted();
    if (gettingStarted) frame.panel.append(gettingStarted);
  }
  frame.panel.append(content);
  renderStatus();
  window.scrollTo(0, scroll);
  if (focusedId) {
    const element = document.getElementById(focusedId);
    if (element) {
      element.focus();
      element.setSelectionRange?.(element.value.length, element.value.length);
    }
  }
}

function renderBanner() {
  const patient = context.patient;
  const now = new Date();
  const age = ageFrom(patient.dateOfBirth, now);
  clear(frame.banner);
  frame.banner.append(h("div", { class: "patient-banner" },
    h("div", { class: "patient-name" }, patient.name || "Patient name not set",
      patient.preferredName ? h("span", { class: "small", style: { fontWeight: "normal" } }, ` "${patient.preferredName}"`) : null),
    h("div", { class: "patient-facts" },
      patient.dateOfBirth ? h("span", {}, `DOB ${formatDayKey(patient.dateOfBirth, { month: "numeric", day: "numeric", year: "numeric" })}${age !== null ? ` (${age})` : ""}`) : null,
      h("span", { class: `allergies ${patient.allergies ? "" : "none"}` }, `Allergies: ${patient.allergies || "not recorded"}`),
      patient.codeStatus ? h("span", {}, `Code status: ${patient.codeStatus}`) : null,
      patient.physician ? h("span", {}, `Physician: ${patient.physician}${patient.physicianPhone ? ` ${patient.physicianPhone}` : ""}`) : null,
    ),
    h("div", { class: "clock", id: "banner-clock" },
      formatDate(now, { weekday: "short", month: "short", day: "numeric" }), " ", formatClock(now)),
  ));
}

function attentionCount() {
  if (!state.chart) return 0;
  const now = new Date();
  return dosesNeedingAttention(context.medications, state.chart.administrations, now)
    .filter((slot) => slot.state === "overdue" || slot.state === "due").length;
}

function renderTabs() {
  const count = attentionCount();
  document.title = count ? `(${count}) Care Chart` : "Care Chart";
  clear(frame.tabs);
  TABS.forEach((tab, index) => {
    frame.tabs.append(h("button", {
      class: "tab", role: "tab", "aria-selected": String(state.tab === tab.key),
      title: `${tab.label} (key ${index + 1})`,
      onclick: () => switchTab(tab.key),
    }, tab.label, tab.key === "today" && count ? h("span", { class: "status-chip overdue badge" }, count) : null));
  });
}

function renderStatus() {
  if (!frame || !state.chart) return;
  clear(frame.status);
  const light = state.loading ? "syncing" : state.online ? "" : "offline";
  frame.status.append(...[
    h("span", {}, h("span", { class: `status-light ${light}` }),
      state.loading ? "Updating…" : state.online ? "Connected" : "Offline — changes cannot be saved"),
    deviceTimeZone() !== getHouseholdTimeZone()
      ? h("span", { title: `This device is set to ${deviceTimeZone()}` }, `Times shown in ${getHouseholdTimeZone().replace(/_/g, " ")}`)
      : null,
    h("span", { class: "grow hide-small" }, state.syncedAt ? `Up to date as of ${formatClock(state.syncedAt)} · updates from other caregivers appear within ${SYNC_CHECK_SECONDS} s` : ""),
    h("span", {}, `Signed in: ${state.chart.me.name}${context.can("full") ? "" : ` (${accessLabel(state.chart.me.access).toLowerCase()})`}`),
  ].filter(Boolean));
}

function renderGettingStarted() {
  if (!context.can("full")) return null; // the setup steps are for caregivers who can make them
  const steps = [
    { done: Boolean(context.patient.name), text: "Fill in the patient profile, especially allergies.", tab: "settings" },
    { done: context.medications.length > 0, text: "Add her medications, scheduled and as-needed.", tab: "medications" },
    { done: context.caregivers.filter((caregiver) => !caregiver.removed_at).length > 1, text: "Add the other caregiver's account.", tab: "settings" },
    { done: "Notification" in window && Notification.permission !== "default", text: "Turn on dose reminders on each phone or computer.", tab: "settings" },
  ];
  if (steps.every((step) => step.done)) return null;
  return h("div", { style: { marginBottom: "12px" } }, windowBox({ title: "Getting started" },
    h("ol", { style: { margin: 0, paddingLeft: "22px" } }, steps.map((step) => h("li", { style: { marginBottom: "4px" } },
      step.done ? h("s", {}, step.text) : step.text, " ",
      step.done ? h("span", { class: "status-chip given" }, "done") : h("button", { class: "link-button", onclick: () => switchTab(step.tab) }, "Go there")))),
  ));
}

function switchTab(key) {
  if (state.tab === key) return;
  state.tab = key;
  if (location.hash !== `#${key}`) history.replaceState(null, "", `#${key}`);
  if (!frame) return; // not signed in yet; the first load draws this tab
  // Draw the new tab only once its date range has loaded, so charts never show
  // empty days that simply haven't arrived yet.
  renderTabs();
  frame.panel.replaceChildren(h("div", { class: "empty" }, "Loading…"));
  loadChart();
  window.scrollTo(0, 0);
}

// ---- Reminders

let serviceWorker = null;

function readNotified() {
  try { return new Set(JSON.parse(localStorage.getItem(NOTIFIED_STORAGE_KEY) ?? "[]")); } catch { return new Set(); }
}
function saveNotified(keys) {
  try { localStorage.setItem(NOTIFIED_STORAGE_KEY, JSON.stringify([...keys].slice(-REMEMBERED_REMINDER_KEYS))); } catch { /* reminders may repeat */ }
}

async function notify(title, body, tag) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const options = { body, tag, icon: "/icon-192.png", badge: "/icon-192.png", renotify: true };
  try {
    // Android only shows notifications through a service worker.
    if (serviceWorker) await serviceWorker.showNotification(title, options);
    else new Notification(title, options);
  } catch {
    // Not fatal: the tab title and Today screen still show what is due.
  }
}

async function checkReminders() {
  if (!state.chart) return;
  // When the server sends this device its reminders, the page stays quiet to avoid doubles.
  if (await serverRemindsThisDevice()) return;
  const now = new Date();
  const notified = readNotified();
  for (const slot of dosesNeedingAttention(context.medications, state.chart.administrations, now)) {
    const key = `${slot.medication.id}|${slot.scheduledFor}|${slot.state}`;
    if (notified.has(key)) continue;
    notified.add(key);
    notify(
      slot.state === "overdue" ? `OVERDUE: ${slot.medication.name}` : `Dose due: ${slot.medication.name}`,
      `${formatClockText(slot.clockTime)} dose — ${[slot.medication.dose, slot.medication.instructions].filter(Boolean).join(", ")}`,
      key,
    );
  }
  for (const medication of context.medications.filter((item) => item.kind === "as_needed" && isActive(item, now))) {
    const status = asNeededStatus(medication, state.chart.administrations, now);
    if (!status.followUpDue) continue;
    const key = `follow-up|${status.followUpDue.id}`;
    if (notified.has(key)) continue;
    notified.add(key);
    notify(`Follow-up: ${medication.name}`, `Did the ${formatClock(status.followUpDue.given_at)} dose help? Record the effect.`, key);
  }
  saveNotified(notified);
}

// ---- Keyboard shortcuts

const SHORTCUTS = [
  ["1 – 7", "Switch tabs (Today, Medications, Visits, Log, Trends, Report, Settings)"],
  ["N", "Write a note"],
  ["F", "Record fluids"],
  ["B", "Record a bowel movement"],
  ["U", "Record urination"],
  ["M", "Record mood and behavior"],
  ["Esc", "Close a window"],
];
const SHORTCUT_TYPES = { n: "note", f: "fluid", b: "bowel", u: "urine", m: "behavior" };

function showShortcuts() {
  openDialog({
    title: "Keyboard shortcuts",
    size: "narrow",
    build: () => h("div", { class: "well" }, h("table", { class: "grid" }, h("tbody", {},
      SHORTCUTS.map(([keys, action]) => h("tr", {}, h("td", { class: "mono nowrap" }, keys), h("td", {}, action)))))),
    buttons: (close) => [h("button", { class: "default", onclick: () => close() }, "OK")],
  });
}

document.addEventListener("keydown", (event) => {
  if (!state.chart || isDialogOpen() || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable]")) return;
  const tabIndex = Number(event.key) - 1;
  if (tabIndex >= 0 && tabIndex < TABS.length) { switchTab(TABS[tabIndex].key); event.preventDefault(); return; }
  const type = SHORTCUT_TYPES[event.key.toLowerCase()];
  if (type && context.can("record")) { openEntryForm(context, type); event.preventDefault(); }
  if (event.key === "?") showShortcuts();
});

// ---- Sign-in and first-time setup

function renderSignIn(needsSetup, setupCodeConfigured) {
  frame = null;
  clear(root);
  let rememberedName = "";
  try { rememberedName = localStorage.getItem("care-chart-name") ?? ""; } catch { /* optional */ }
  const name = h("input", { name: "username", autocomplete: "username", required: true, value: needsSetup ? "" : rememberedName, maxlength: "60" });
  const password = h("input", { name: "password", type: "password", required: true, autocomplete: needsSetup ? "new-password" : "current-password", minlength: needsSetup ? "8" : null });
  const confirm = h("input", { name: "confirm-password", type: "password", required: true, autocomplete: "new-password" });
  const setupCode = h("input", { name: "setup-code", required: true, autocomplete: "off" });
  const error = h("p", { class: "error-text small", role: "alert" });
  const submit = h("button", { class: "default", type: "submit" }, needsSetup ? "Create account" : "OK");

  const onsubmit = async (event) => {
    event.preventDefault();
    error.textContent = "";
    if (needsSetup && password.value !== confirm.value) { error.textContent = "The two passwords do not match."; return; }
    submit.disabled = true;
    try {
      if (needsSetup) await api("/api/setup", { method: "POST", body: { setupCode: setupCode.value, name: name.value, password: password.value } });
      else await api("/api/login", { method: "POST", body: { name: name.value, password: password.value } });
      try { localStorage.setItem("care-chart-name", name.value.trim()); } catch { /* optional */ }
      await start();
    } catch (problem) {
      error.textContent = problem.message;
      submit.disabled = false;
    }
  };

  const art = h("div", { class: "login-art" }, chartIcon(48),
    h("div", {}, h("b", {}, needsSetup ? "Welcome to Care Chart" : "Sign in to Care Chart"),
      h("div", { class: "small muted" }, needsSetup
        ? "Create the first caregiver account. You can add the others from Settings."
        : "Type your name and password.")));

  root.append(h("div", { class: "login-wrap" }, h("div", { class: "window login" },
    h("div", { class: "title-bar" }, chartIcon(), h("span", { class: "title" }, needsSetup ? "First-time setup" : "Sign in")),
    h("form", { class: "window-body", onsubmit },
      art,
      needsSetup && !setupCodeConfigured
        ? h("p", { class: "error-text" }, "The server has no SETUP_CODE yet. Set it as described in the README, then reload.")
        : null,
      h("div", { class: "stack" },
        needsSetup ? field("Setup code (from the README)", setupCode) : null,
        field("Your name", name),
        field(needsSetup ? "Choose a password (8+ characters)" : "Password", password),
        needsSetup ? field("Type the password again", confirm) : null,
      ),
      error,
      h("div", { class: "row", style: { justifyContent: "flex-end" } }, submit),
    ),
  )));
  (needsSetup ? setupCode : rememberedName ? password : name).focus();
}

// ---- Start

async function start() {
  try {
    await loadChart();
  } catch {
    // loadChart reports its own errors
  }
  if (!state.chart) {
    const status = await api("/api/setup-status").catch(() => ({ needsSetup: false, setupCodeConfigured: true }));
    renderSignIn(status.needsSetup, status.setupCodeConfigured);
  }
}

window.addEventListener("care-chart:signed-out", async () => {
  state.chart = null;
  const status = await api("/api/setup-status").catch(() => ({ needsSetup: false, setupCodeConfigured: true }));
  renderSignIn(status.needsSetup, status.setupCodeConfigured);
});

window.addEventListener("hashchange", () => {
  const key = location.hash.slice(1);
  if (TABS.some((tab) => tab.key === key)) switchTab(key);
});
document.addEventListener("visibilitychange", () => { if (!document.hidden) checkForChanges(); });
window.addEventListener("online", checkForChanges);
window.addEventListener("offline", () => { state.online = false; renderStatus(); });

setInterval(checkForChanges, SYNC_CHECK_SECONDS * 1000);
setInterval(() => {
  if (!state.chart || !frame) return;
  // Keep times, countdowns and due states current without reloading.
  if (state.tab === "today" && !isDialogOpen()) render();
  else { renderBanner(); renderTabs(); }
  checkReminders();
}, SCREEN_REFRESH_SECONDS * 1000);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").then(() => navigator.serviceWorker.ready).then((registration) => { serviceWorker = registration; }).catch(() => {});
}

const initialTab = location.hash.slice(1);
if (TABS.some((tab) => tab.key === initialTab)) state.tab = initialTab;
installChartTooltips();
start();

