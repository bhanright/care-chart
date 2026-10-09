// Fills the LOCAL development chart with two weeks of made-up demo data, so every
// screen has something to show. It refuses to run against anything but localhost.
//
//   npm run dev            (in one terminal)
//   npm run seed:local     (in another)
//
// Then sign in as "Demo Caregiver" with the password below.

const BASE_URL = process.env.CARE_CHART_URL ?? "http://localhost:8790";
const SETUP_CODE = "local-setup-code"; // matches .dev.vars
const DEMO_PASSWORD = "local-test-pass";
const DAYS_OF_HISTORY = 14;

if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE_URL)) {
  throw new Error("seed-local only runs against a local development server.");
}

let cookie = "";
async function call(path, body, method = "POST") {
  const response = await fetch(BASE_URL + path, {
    method,
    headers: { "Content-Type": "application/json", "X-Care-Chart": "1", Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const data = await response.json();
  if (!response.ok) throw new Error(`${path}: ${data.error}`);
  return data;
}

// Repeatable "random" numbers so the demo looks the same every time.
let seed = 7;
const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (list) => list[Math.floor(random() * list.length)];

const status = await (await fetch(`${BASE_URL}/api/setup-status`)).json();
if (status.needsSetup) {
  await call("/api/setup", { setupCode: SETUP_CODE, name: "Demo Caregiver", password: DEMO_PASSWORD });
  await call("/api/caregivers", { name: "Second Caregiver", initials: "SC", password: DEMO_PASSWORD });
} else {
  await call("/api/login", { name: "Demo Caregiver", password: DEMO_PASSWORD });
}

await call("/api/settings", { key: "patient", value: {
  name: "Margaret Demo", preferredName: "Maggie", dateOfBirth: "1938-03-14",
  allergies: "Penicillin (hives), sulfa drugs", conditions: "Alzheimer's disease (moderate), hypertension, osteoarthritis",
  physician: "Dr. Example", physicianPhone: "(555) 010-0000", codeStatus: "DNR on file",
} }, "PUT");
// The demo runs in this computer's zone, since the history below is built with its clock.
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
await call("/api/settings", { key: "preferences", value: { fluidUnit: "oz", dailyFluidGoalMl: 1500, bowelAlertDays: 3, timeZone } }, "PUT");

const historyStart = new Date();
historyStart.setDate(historyStart.getDate() - DAYS_OF_HISTORY);
historyStart.setHours(0, 0, 0, 0);
const startDate = historyStart.toISOString().slice(0, 10);
// Back-date the schedules so the demo history counts as scheduled doses.
const scheduleEffectiveAt = historyStart.toISOString();
const medications = [
  { name: "Donepezil", strength: "10 mg", dose: "1 tablet", purpose: "memory", instructions: "at bedtime", kind: "scheduled", scheduleTimes: ["20:00"], startDate, scheduleEffectiveAt },
  { name: "Lisinopril", strength: "10 mg", dose: "1 tablet", purpose: "blood pressure", instructions: "hold if top BP under 100", kind: "scheduled", scheduleTimes: ["08:00"], startDate, scheduleEffectiveAt },
  { name: "Acetaminophen", strength: "500 mg", dose: "2 tablets", purpose: "arthritis pain", kind: "scheduled", scheduleTimes: ["08:00", "14:00", "20:00"], startDate, scheduleEffectiveAt },
  { name: "Vitamin D3", strength: "1000 IU", dose: "1 tablet", purpose: "bones", instructions: "with breakfast", kind: "scheduled", scheduleTimes: ["08:00"], scheduleWeekdays: [1, 3, 5], startDate, scheduleEffectiveAt },
  { name: "Lorazepam", strength: "0.5 mg", dose: "1 tablet", purpose: "severe agitation", instructions: "only if calming does not work", kind: "as_needed", minimumHoursBetween: 6, effectDurationHours: 6, maximumDosesPerDay: 2, followUpMinutes: 45 },
  { name: "Senna", strength: "8.6 mg", dose: "2 tablets", purpose: "constipation", kind: "as_needed", minimumHoursBetween: 12, effectDurationHours: 10, maximumDosesPerDay: 2, followUpMinutes: 480 },
];
const existing = (await call(`/api/chart?from=${new Date(0).toISOString()}`, undefined, "GET")).medications;
const saved = [];
for (const medication of medications) {
  const match = existing.find((row) => row.name === medication.name);
  saved.push(match ?? (await call("/api/medications", medication)).medication);
}
await seedVisits();
if (existing.length) {
  console.log("Demo data already present; medications kept, no new history added.");
  process.exit(0);
}

/**
 * Demo care team visits: a hospice aide Mon/Wed/Fri at 10, a nurse on Tuesdays at 1 PM and
 * a social worker once, with the past ones marked (mostly completed, some declined or
 * cancelled). Runs only when no visits exist yet.
 */
async function seedVisits() {
  const chart = await call(`/api/chart?from=${new Date(Date.now() - 30 * 86400e3).toISOString()}&to=${new Date(Date.now() + 30 * 86400e3).toISOString()}`, undefined, "GET");
  if ((chart.visits ?? []).length) return;
  const outcomes = [
    ["completed", "Bed bath, linens changed, lotion to heels. Skin intact."],
    ["completed", "Shower chair bath. Ate half her breakfast with help."],
    ["declined", "Refused the bath; agreed to a face wash and hair brushing only."],
    ["completed", "Brief change and skin check. Mild redness on sacrum; barrier cream applied."],
    ["cancelled_by_agency", "Aide out sick; hospice offered Thursday instead."],
  ];
  for (let daysAgo = 21; daysAgo >= -14; daysAgo--) {
    const day = new Date(); day.setDate(day.getDate() - daysAgo);
    const weekday = day.getDay();
    const visits = [];
    if ([1, 3, 5].includes(weekday)) visits.push({ hour: 10, role: "Hospice aide", visitorName: "Maria", durationMinutes: 60 });
    if (weekday === 2) visits.push({ hour: 13, role: "Hospice nurse (RN)", visitorName: "Dana", durationMinutes: 45 });
    if (daysAgo === 9) visits.push({ hour: 15, role: "Social worker", visitorName: "Tom", durationMinutes: 60 });
    for (const visit of visits) {
      const start = new Date(day); start.setHours(visit.hour, 0, 0, 0);
      const past = start < new Date(Date.now() - 2 * 3600e3);
      const [status, outcomeNote] = !past ? ["scheduled", ""]
        : visit.role === "Hospice nurse (RN)" ? ["completed", "Vitals stable. Reviewed comfort medications; no changes."]
          : visit.role === "Social worker" ? ["completed", "Talked about respite care options and the family's questions."]
            : pick(outcomes);
      await call("/api/visits", { scheduledAt: start.toISOString(), role: visit.role, visitorName: visit.visitorName,
        agency: "Demo Hospice", durationMinutes: visit.durationMinutes, status, outcomeNote });
    }
  }
}

const at = (daysAgo, hours, minutes = 0) => {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hours, minutes, 0, 0);
  return date;
};
const now = new Date();
const entry = async (type, date, data, note = "", notable = false) => {
  if (date <= now) await call("/api/entries", { type, occurredAt: date.toISOString(), data, note, notable });
};

for (let daysAgo = DAYS_OF_HISTORY; daysAgo >= 0; daysAgo--) {
  // Scheduled doses, with an occasional refusal or late dose.
  for (const medication of saved.filter((item) => item.kind === "scheduled")) {
    const times = JSON.parse(medication.schedule_times);
    const weekdays = JSON.parse(medication.schedule_weekdays);
    for (const time of times) {
      const [hours, minutes] = time.split(":").map(Number);
      const slot = at(daysAgo, hours, minutes);
      if (!weekdays.includes(slot.getDay())) continue;
      const givenAt = new Date(slot.getTime() + Math.round((random() * 50 - 15)) * 60000);
      if (givenAt > now || slot > now) continue;
      if (daysAgo === 0 && slot > new Date(now.getTime() - 90 * 60000)) continue; // leave recent ones open
      const refused = random() < 0.04;
      await call("/api/administrations", {
        medicationId: medication.id, scheduledFor: slot.toISOString(), givenAt: givenAt.toISOString(),
        status: refused ? "refused" : "given", doseGiven: medication.dose, reason: refused ? "Spat it out, would not retry" : "",
      });
    }
  }
  for (const [hours, amount] of [[8, 240], [10, 180], [12, 240], [15, 120], [17, 240], [19, 180]]) {
    if (random() < 0.85) await entry("fluid", at(daysAgo, hours, Math.floor(random() * 50)), { amountMl: amount, drink: pick(["Water", "Water", "Juice", "Tea", "Milk"]) });
  }
  for (const [meal, hours] of [["Breakfast", 8], ["Lunch", 12], ["Dinner", 17]]) {
    await entry("food", at(daysAgo, hours, 30), { meal, percentEaten: pick([50, 75, 75, 100, 100, 25]), assistance: pick(["Ate on own", "Set-up only", "Some help"]) });
  }
  if (daysAgo % 2 === 0 || random() < 0.3) await entry("bowel", at(daysAgo, 9 + Math.floor(random() * 4)), { bristol: pick([3, 4, 4, 2, 5]), amount: pick(["Small", "Medium"]), continence: random() < 0.1 ? "Accident (outside brief)" : random() < 0.8 ? "Brief / diaper" : "Toilet / commode" });
  for (let count = 0; count < 5 + Math.floor(random() * 3); count++) {
    await entry("urine", at(daysAgo, 7 + count * 2 + Math.floor(random() * 2), Math.floor(random() * 50)), { continence: random() < 0.05 ? "Accident (outside brief)" : random() < 0.85 ? "Brief / diaper" : "Toilet / commode", color: pick(["Pale", "Yellow", "Yellow"]) });
  }
  const evening = random() < 0.35;
  await entry("behavior", at(daysAgo, 10), { moodScore: pick([4, 4, 5, 3]), moods: ["Calm"], alertness: "Alert", orientedTo: ["Person", "Place"] });
  await entry("behavior", at(daysAgo, 18), evening
    ? { moodScore: 2, moods: ["Anxious", "Agitated"], alertness: "Alert", behaviors: ["Sundowning", "Repeating questions", "Exit-seeking"] }
    : { moodScore: pick([3, 4]), moods: ["Calm"], alertness: "Drowsy" },
    evening ? "Asked for her mother repeatedly; settled with music after about 40 minutes." : "");
  if (evening && random() < 0.5) {
    const lorazepam = saved.find((item) => item.name === "Lorazepam");
    const givenAt = at(daysAgo, 19, 10);
    if (givenAt <= now) {
      const { administration } = await call("/api/administrations", { medicationId: lorazepam.id, givenAt: givenAt.toISOString(), doseGiven: "1 tablet", reason: "Severe agitation, music and walk did not help" });
      await call(`/api/administrations/${administration.id}`, { effect: pick(["effective", "effective", "partial"]), effectNote: "Calmer within the hour" }, "PUT");
    }
  }
  await entry("sleep", at(daysAgo, 7), { kind: "Night sleep", hours: pick([6, 6.5, 7, 7.5, 8]), quality: pick(["Good", "Fair", "Fair", "Poor"]), wakings: Math.floor(random() * 3) });
  if (daysAgo % 3 === 0) await entry("vitals", at(daysAgo, 9), { systolic: 118 + Math.floor(random() * 22), diastolic: 70 + Math.floor(random() * 12), pulse: 66 + Math.floor(random() * 14), temperatureF: Math.round((97.6 + random()) * 10) / 10, oxygen: 95 + Math.floor(random() * 4), weightLb: Math.round((126 + random() * 2) * 10) / 10 });
  if (daysAgo % 2 === 1) await entry("care", at(daysAgo, 9, 45), { activities: ["Shower / bath", "Oral care", "Lotion", "Skin check"], skin: ["Intact"] });
  if (random() < 0.3) await entry("pain", at(daysAgo, 13), { score: pick([2, 3, 4, 5]), location: "Right knee", signs: ["Rubbing area"] });
}
await entry("note", at(2, 15), {}, "Fell asleep in her chair after lunch and was hard to rouse for about 10 minutes. Vital signs normal afterward. Will mention to Dr. Example.", true);
await entry("behavior", at(1, 16), { moodScore: 2, moods: ["Fearful"], behaviors: ["Hallucinating"], alertness: "Alert" }, "Said there were children in the yard. New behavior.", true);
console.log(`Seeded ${DAYS_OF_HISTORY + 1} days of demo data at ${BASE_URL}. Sign in as "Demo Caregiver" / ${DEMO_PASSWORD}.`);
