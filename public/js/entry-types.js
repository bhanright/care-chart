// What can be charted besides medications. Each type lists its fields; the record form,
// the log and the report are all built from these descriptions. The server only checks
// the type name (src/chart.ts, ENTRY_TYPES), so adding a field here needs no server change.
//
// Field kinds:
//   choice  - one of a few options (Win95 toggle buttons)
//   chips   - any number of options
//   scale   - a numbered scale, stored as a number
//   number  - free number with a unit
//   text    - one line of text
//   fluid   - an amount stored in milliliters, shown in the household's unit

export const ML_PER_FLUID_OUNCE = 29.5735;

/** Sips (a few milliliters at a time) are recorded and shown in mL even when the household uses ounces. */
export const SIP_AMOUNTS_ML = [5, 10, 15];
/** Below this, an amount reads better in mL ("5 mL") than in ounces ("0.2 oz"). */
const SHOW_IN_ML_BELOW = 30;

export function formatFluid(milliliters, unit) {
  if (milliliters === null || milliliters === undefined) return "";
  if (unit === "ml" || (milliliters > 0 && milliliters < SHOW_IN_ML_BELOW)) return `${Math.round(milliliters)} mL`;
  return `${Math.round((milliliters / ML_PER_FLUID_OUNCE) * 10) / 10} oz`;
}

const options = (...labels) => labels.map((label) => ({ value: label, label }));

/**
 * Where a bowel movement or urination happened. For someone who wears briefs, going in
 * the brief is normal; only ACCIDENT (outside the brief) counts as an accident.
 */
export const CONTINENCE_OPTIONS = options("Brief / diaper", "Toilet / commode", "Bedpan / urinal", "Accident (outside brief)");
export const ACCIDENT = "Accident (outside brief)";
const placeWords = (continence) => ({
  "Brief / diaper": "in brief",
  "Toilet / commode": "toilet",
  "Bedpan / urinal": "bedpan",
  [ACCIDENT]: "ACCIDENT outside brief",
})[continence] ?? null;

export const BRISTOL_SCALE = [
  { value: 1, label: "1", hint: "Type 1: separate hard lumps (severe constipation)" },
  { value: 2, label: "2", hint: "Type 2: lumpy, sausage-shaped (constipation)" },
  { value: 3, label: "3", hint: "Type 3: sausage with cracks (normal)" },
  { value: 4, label: "4", hint: "Type 4: smooth, soft sausage (normal)" },
  { value: 5, label: "5", hint: "Type 5: soft blobs with clear edges (lacking fiber)" },
  { value: 6, label: "6", hint: "Type 6: mushy, ragged pieces (mild diarrhea)" },
  { value: 7, label: "7", hint: "Type 7: entirely liquid (diarrhea)" },
];

export const MOOD_SCALE = [
  { value: 1, label: "1", hint: "1: very distressed" },
  { value: 2, label: "2", hint: "2: upset or unsettled" },
  { value: 3, label: "3", hint: "3: neutral" },
  { value: 4, label: "4", hint: "4: calm" },
  { value: 5, label: "5", hint: "5: content, happy" },
];

const PAIN_SCALE = Array.from({ length: 11 }, (_, score) => ({
  value: score,
  label: String(score),
  hint: score === 0 ? "0: no pain" : score <= 3 ? `${score}: mild` : score <= 6 ? `${score}: moderate` : `${score}: severe`,
}));

export const ENTRY_TYPES = {
  fluid: {
    label: "Fluids",
    badge: "FL",
    color: "#1f6fbf",
    fields: [
      { key: "amountMl", kind: "fluid", label: "Amount", required: true },
      { key: "drink", kind: "choice", label: "Drink", options: options("Water", "Juice", "Milk", "Coffee", "Tea", "Soda", "Nutrition shake", "Soup", "Jello / ice pops", "Other") },
    ],
    summary: (data, preferences) => `${formatFluid(data.amountMl, preferences.fluidUnit)}${data.drink ? ` ${data.drink.toLowerCase()}` : ""}`,
  },
  food: {
    label: "Meal",
    badge: "ME",
    color: "#2f8f3a",
    fields: [
      { key: "meal", kind: "choice", label: "Meal", options: options("Breakfast", "Lunch", "Dinner", "Snack") },
      { key: "percentEaten", kind: "choice", label: "Amount eaten", options: [0, 25, 50, 75, 100].map((value) => ({ value, label: `${value}%` })) },
      { key: "assistance", kind: "choice", label: "Help needed", options: options("Ate on own", "Set-up only", "Some help", "Fed by caregiver") },
      { key: "description", kind: "text", label: "What was served" },
      { key: "swallowing", kind: "chips", label: "Swallowing", options: options("Coughing", "Choking", "Pocketing food", "Slow to swallow") },
    ],
    summary: (data) => [data.meal ?? "Meal", data.percentEaten !== undefined && data.percentEaten !== null ? `${data.percentEaten}% eaten` : null, data.description].filter(Boolean).join(", "),
  },
  bowel: {
    label: "Bowel movement",
    badge: "BM",
    color: "#7a4b1e",
    fields: [
      { key: "bristol", kind: "scale", label: "Bristol stool type", options: BRISTOL_SCALE },
      { key: "amount", kind: "choice", label: "Amount", options: options("Smear", "Small", "Medium", "Large") },
      { key: "continence", kind: "choice", label: "Where", options: CONTINENCE_OPTIONS, rememberLast: true },
      { key: "concerns", kind: "chips", label: "Concerns", options: options("Blood", "Black / tarry", "Mucus", "Straining", "Pain") },
    ],
    summary: (data) => ["BM", data.bristol ? `type ${data.bristol}` : null, data.amount?.toLowerCase(), placeWords(data.continence), ...(data.concerns ?? []).map((item) => item.toLowerCase())].filter(Boolean).join(", "),
  },
  urine: {
    label: "Urination",
    badge: "UR",
    color: "#b08a00",
    fields: [
      { key: "continence", kind: "choice", label: "Where", options: CONTINENCE_OPTIONS, rememberLast: true },
      { key: "amount", kind: "choice", label: "Amount", options: options("Small", "Medium", "Large") },
      { key: "color", kind: "choice", label: "Color", options: options("Pale", "Yellow", "Dark yellow", "Amber / brown", "Pink / red", "Cloudy") },
      { key: "concerns", kind: "chips", label: "Concerns", options: options("Strong odor", "Burning / pain", "Urgency", "Very frequent") },
    ],
    summary: (data) => ["Urinated", data.amount?.toLowerCase(), data.color?.toLowerCase(), placeWords(data.continence), ...(data.concerns ?? []).map((item) => item.toLowerCase())].filter(Boolean).join(", "),
  },
  behavior: {
    label: "Mood & behavior",
    badge: "BH",
    color: "#7b3fa0",
    fields: [
      { key: "moodScore", kind: "scale", label: "Overall mood", options: MOOD_SCALE },
      { key: "moods", kind: "chips", label: "Mood", options: options("Calm", "Cheerful", "Anxious", "Agitated", "Irritable", "Sad / tearful", "Withdrawn", "Fearful", "Apathetic") },
      { key: "alertness", kind: "choice", label: "Alertness", options: options("Alert", "Drowsy", "Lethargic", "Hard to wake") },
      { key: "orientedTo", kind: "chips", label: "Knows (oriented to)", options: options("Person", "Place", "Time", "Situation") },
      { key: "behaviors", kind: "chips", label: "Behaviors seen", options: options("Confused", "Repeating questions", "Restless", "Wandering", "Sundowning", "Hallucinating", "Suspicious / paranoid", "Calling out", "Verbal aggression", "Physical aggression", "Refusing care", "Exit-seeking") },
      { key: "speech", kind: "choice", label: "Speech", options: options("Normal", "Less than usual", "Slurred", "Hard to understand", "Not speaking") },
    ],
    summary: (data) => [
      data.moodScore ? `Mood ${data.moodScore}/5` : null,
      ...(data.moods ?? []),
      data.alertness && data.alertness !== "Alert" ? data.alertness : null,
      ...(data.behaviors ?? []),
    ].filter(Boolean).join(", ") || "Behavior note",
  },
  sleep: {
    label: "Sleep",
    badge: "SL",
    color: "#2c3e8f",
    fields: [
      { key: "kind", kind: "choice", label: "Kind", options: options("Night sleep", "Nap", "Awake at night") },
      { key: "hours", kind: "number", label: "Hours", unit: "h", step: 0.25, minimum: 0, maximum: 24 },
      { key: "quality", kind: "choice", label: "Quality", options: options("Good", "Fair", "Poor") },
      { key: "wakings", kind: "number", label: "Times woke up", step: 1, minimum: 0, maximum: 50 },
    ],
    summary: (data) => [data.kind ?? "Sleep", data.hours ? `${data.hours} h` : null, data.quality ? `${data.quality.toLowerCase()} quality` : null, data.wakings ? `woke ${data.wakings}×` : null].filter(Boolean).join(", "),
  },
  pain: {
    label: "Pain",
    badge: "PN",
    color: "#c0392b",
    fields: [
      { key: "score", kind: "scale", label: "Pain score (0 to 10)", options: PAIN_SCALE },
      { key: "location", kind: "text", label: "Where" },
      { key: "signs", kind: "chips", label: "Signs seen", options: options("Grimacing", "Moaning", "Guarding", "Rubbing area", "Restless", "Crying") },
    ],
    summary: (data) => [data.score !== undefined && data.score !== null ? `Pain ${data.score}/10` : "Pain", data.location, ...(data.signs ?? []).map((item) => item.toLowerCase())].filter(Boolean).join(", "),
  },
  vitals: {
    label: "Vital signs",
    badge: "VS",
    color: "#0f7f7f",
    fields: [
      { key: "systolic", kind: "number", label: "Blood pressure, top", unit: "mmHg", minimum: 40, maximum: 300 },
      { key: "diastolic", kind: "number", label: "Blood pressure, bottom", unit: "mmHg", minimum: 20, maximum: 200 },
      { key: "pulse", kind: "number", label: "Pulse", unit: "bpm", minimum: 20, maximum: 250 },
      { key: "temperatureF", kind: "number", label: "Temperature", unit: "°F", step: 0.1, minimum: 85, maximum: 110 },
      { key: "oxygen", kind: "number", label: "Oxygen (SpO₂)", unit: "%", minimum: 50, maximum: 100 },
      { key: "respirations", kind: "number", label: "Breaths per minute", unit: "/min", minimum: 4, maximum: 60 },
      { key: "glucose", kind: "number", label: "Blood sugar", unit: "mg/dL", minimum: 10, maximum: 900 },
      { key: "weightLb", kind: "number", label: "Weight", unit: "lb", step: 0.1, minimum: 40, maximum: 600 },
    ],
    summary: (data) => [
      data.systolic && data.diastolic ? `BP ${data.systolic}/${data.diastolic}` : null,
      data.pulse ? `P ${data.pulse}` : null,
      data.temperatureF ? `T ${data.temperatureF}°F` : null,
      data.oxygen ? `SpO₂ ${data.oxygen}%` : null,
      data.respirations ? `R ${data.respirations}` : null,
      data.glucose ? `BG ${data.glucose}` : null,
      data.weightLb ? `Wt ${data.weightLb} lb` : null,
    ].filter(Boolean).join("  ") || "Vital signs",
  },
  care: {
    label: "Personal care",
    badge: "CA",
    color: "#5d6d7e",
    fields: [
      { key: "activities", kind: "chips", label: "Done", options: options("Shower / bath", "Sponge bath", "Oral care", "Dentures cleaned", "Hair care", "Shave", "Nail care", "Brief changed", "Dressed", "Skin check", "Lotion", "Repositioned", "Walk / exercise", "Range of motion") },
      { key: "skin", kind: "chips", label: "Skin findings", options: options("Intact", "Redness", "Bruise", "Skin tear", "Pressure sore", "Rash", "Swelling") },
    ],
    summary: (data) => [...(data.activities ?? []), ...(data.skin ?? []).filter((item) => item !== "Intact").map((item) => `skin: ${item.toLowerCase()}`)].join(", ") || "Personal care",
  },
  note: {
    label: "Note",
    badge: "NT",
    color: "#444444",
    fields: [],
    summary: () => "Note",
  },
};

export const ENTRY_TYPE_ORDER = ["fluid", "food", "bowel", "urine", "behavior", "sleep", "pain", "vitals", "care", "note"];

export function entrySummary(entry, preferences) {
  const type = ENTRY_TYPES[entry.type];
  return type ? type.summary(entry.data ?? {}, preferences) : entry.type;
}
