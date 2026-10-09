// How much each caregiver may change. Kept in step with src/access.ts, which enforces it;
// the screens use this only to hide or lock what someone cannot do.

export const ACCESS_LEVELS = [
  {
    value: "full",
    label: "Full access",
    description: "Everything: medications and schedules, the visit calendar, the patient profile, settings and caregivers.",
  },
  {
    value: "record",
    label: "Records care",
    description: "Sees everything, and records doses, observations, notes and what happened at visits. Cannot change medications, schedules, the profile, settings or caregivers.",
  },
  {
    value: "view",
    label: "View only",
    description: "Sees the whole chart and changes nothing.",
  },
];

const ACCESS_RANK = { view: 0, record: 1, full: 2 };

/** Whether a caregiver has at least the given access ("view", "record" or "full"). */
export function hasAccess(caregiver, needed) {
  return ACCESS_RANK[caregiver?.access ?? "full"] >= ACCESS_RANK[needed];
}

export function accessLabel(value) {
  return ACCESS_LEVELS.find((level) => level.value === value)?.label ?? value;
}
