// What each caregiver may change. There are three levels:
//   full   - everything: medications and schedules, the visit calendar, the patient
//            profile, household settings, caregivers and the backup export.
//   record - records care: doses, observations and notes (and corrects them), and what
//            happened at a planned visit. Cannot change schedules, profile or caregivers.
//   view   - reads the whole chart and changes nothing.
// Everyone can manage their own account (name, password, sign-outs) and reminders.
//
// The rule is decided here from the request alone, before any route runs, so a new write
// route needs full access unless it is added to the lists below.

import type { Caregiver } from "./auth";
import { HttpError } from "./http";

export const ACCESS_LEVELS = ["full", "record", "view"] as const;
export type Access = (typeof ACCESS_LEVELS)[number];

const ACCESS_RANK: Record<Access, number> = { view: 0, record: 1, full: 2 };

const ACCESS_NAMES: Record<Access, string> = {
  full: "full access",
  record: "access to record care",
  view: "view-only access",
};

export function hasAccess(me: Caregiver, needed: Access): boolean {
  return ACCESS_RANK[me.access] >= ACCESS_RANK[needed];
}

/** The access a request needs. */
export function accessNeeded(method: string, path: string): Access {
  if (path === "/api/export") return "full";
  if (method === "GET") return "view";
  // Your own account and your own reminders.
  if (path.startsWith("/api/me/") || path.startsWith("/api/push/")) return "view";
  // Doses, observations and notes, and corrections to them.
  if (/^\/api\/(administrations|entries)(\/|$)/.test(path)) return "record";
  // Saving a visit; visits.ts lets "record" change only what happened, not the plan.
  if (method === "PUT" && /^\/api\/visits\/\d+$/.test(path)) return "record";
  return "full";
}

export function requireAccess(me: Caregiver, needed: Access): void {
  if (hasAccess(me, needed)) return;
  throw new HttpError(403, `You have ${ACCESS_NAMES[me.access]}, so you cannot make this change. A caregiver with full access can change that in Settings.`);
}
