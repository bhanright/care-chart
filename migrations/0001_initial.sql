-- Care Chart schema. All timestamps are ISO 8601 strings in UTC (Date.toISOString()),
-- so string comparison orders them correctly. Nothing is ever hard-deleted from the
-- chart: a wrong record is marked "entered in error" (voided_at), as on a paper chart.

CREATE TABLE caregivers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  initials      TEXT NOT NULL,
  password_hash TEXT NOT NULL,   -- PBKDF2-SHA256, base64
  password_salt TEXT NOT NULL,   -- random 16 bytes, base64
  created_at    TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash   TEXT PRIMARY KEY, -- SHA-256 of the cookie value; the raw token is never stored
  caregiver_id INTEGER NOT NULL REFERENCES caregivers(id),
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL
);

-- Failed sign-ins per client address, so password guessing gets locked out.
CREATE TABLE failed_logins (
  address    TEXT NOT NULL,
  failed_at  TEXT NOT NULL
);
CREATE INDEX failed_logins_by_address ON failed_logins(address, failed_at);

-- Patient profile and household preferences, one row per key, value as JSON.
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_by INTEGER REFERENCES caregivers(id),
  updated_at TEXT NOT NULL
);

-- A single counter bumped by every write. Browsers poll it to learn that the other
-- caregiver changed something and they should reload what they are showing.
CREATE TABLE revision (
  id    INTEGER PRIMARY KEY CHECK (id = 1),
  value INTEGER NOT NULL
);
INSERT INTO revision (id, value) VALUES (1, 0);

CREATE TABLE medications (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  name                     TEXT NOT NULL,
  strength                 TEXT NOT NULL DEFAULT '',  -- "5 mg", "500 mg/5 mL"
  dose                     TEXT NOT NULL DEFAULT '',  -- "1 tablet", "10 mL"
  route                    TEXT NOT NULL DEFAULT 'by mouth',
  purpose                  TEXT NOT NULL DEFAULT '',  -- what it is for
  instructions             TEXT NOT NULL DEFAULT '',  -- "with food", "crush in applesauce"
  prescriber               TEXT NOT NULL DEFAULT '',
  kind                     TEXT NOT NULL CHECK (kind IN ('scheduled', 'as_needed')),

  -- Scheduled medications
  schedule_times           TEXT NOT NULL DEFAULT '[]', -- JSON list of household "HH:MM"
  schedule_weekdays        TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]', -- JSON, 0 = Sunday
  on_time_window_minutes   INTEGER NOT NULL DEFAULT 60, -- a dose is on time within +/- this

  -- As-needed (PRN) medications
  minimum_hours_between    REAL,     -- earliest the next dose may be given
  effect_duration_hours    REAL,     -- how long one dose keeps working
  maximum_doses_per_day    INTEGER,  -- in any rolling 24 hours
  follow_up_minutes        INTEGER,  -- when to ask "did it help?"

  -- Doses count from this moment. Set when the medication is added and whenever its
  -- times or days change, so a new schedule never creates overdue doses in the past.
  schedule_effective_at    TEXT NOT NULL,

  start_date               TEXT,     -- household "YYYY-MM-DD", inclusive (the course's first day)
  end_date                 TEXT,     -- household "YYYY-MM-DD", inclusive
  discontinued_at          TEXT,
  discontinued_reason      TEXT,
  created_by               INTEGER REFERENCES caregivers(id),
  created_at               TEXT NOT NULL,
  updated_by               INTEGER REFERENCES caregivers(id),
  updated_at               TEXT NOT NULL
);

CREATE TABLE administrations (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  medication_id    INTEGER NOT NULL REFERENCES medications(id),
  scheduled_for    TEXT,  -- the dose slot this fills; NULL for as-needed doses
  status           TEXT NOT NULL CHECK (status IN ('given', 'refused', 'held', 'missed')),
  given_at         TEXT NOT NULL, -- when it happened (or was decided, for refused/held)
  dose_given       TEXT NOT NULL DEFAULT '',
  reason           TEXT NOT NULL DEFAULT '', -- why an as-needed dose was given, or why held
  note             TEXT NOT NULL DEFAULT '',
  effect           TEXT CHECK (effect IN ('effective', 'partial', 'not_effective')),
  effect_note      TEXT NOT NULL DEFAULT '',
  effect_recorded_at TEXT,
  safety_override  TEXT NOT NULL DEFAULT '', -- the reason a dosing-limit warning was overridden
  recorded_by      INTEGER NOT NULL REFERENCES caregivers(id),
  recorded_at      TEXT NOT NULL,
  updated_by       INTEGER REFERENCES caregivers(id),
  updated_at       TEXT NOT NULL,
  voided_by        INTEGER REFERENCES caregivers(id),
  voided_at        TEXT,
  void_reason      TEXT NOT NULL DEFAULT ''
);
CREATE INDEX administrations_by_time ON administrations(given_at);
CREATE INDEX administrations_by_medication ON administrations(medication_id, given_at);
-- Two caregivers cannot both fill the same scheduled dose: the second one is refused.
CREATE UNIQUE INDEX one_record_per_dose_slot ON administrations(medication_id, scheduled_for)
  WHERE scheduled_for IS NOT NULL AND voided_at IS NULL;

-- Everything else on the chart: fluids, meals, bowel movements, urination, behavior,
-- sleep, pain, vitals, personal care and free notes. The fields for each type live in
-- data (JSON); public/js/entry-types.js describes them.
CREATE TABLE entries (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  type         TEXT NOT NULL,
  occurred_at  TEXT NOT NULL,
  data         TEXT NOT NULL DEFAULT '{}',
  note         TEXT NOT NULL DEFAULT '',
  notable      INTEGER NOT NULL DEFAULT 0, -- 1 = a notable change worth surfacing
  recorded_by  INTEGER NOT NULL REFERENCES caregivers(id),
  recorded_at  TEXT NOT NULL,
  updated_by   INTEGER REFERENCES caregivers(id),
  updated_at   TEXT NOT NULL,
  voided_by    INTEGER REFERENCES caregivers(id),
  voided_at    TEXT,
  void_reason  TEXT NOT NULL DEFAULT ''
);
CREATE INDEX entries_by_time ON entries(occurred_at);
CREATE INDEX entries_by_type ON entries(type, occurred_at);

-- Devices that asked for dose reminders (Web Push), so reminders arrive with the phone locked.
CREATE TABLE push_subscriptions (
  endpoint     TEXT PRIMARY KEY,
  key_p256dh   TEXT NOT NULL,
  key_auth     TEXT NOT NULL,
  caregiver_id INTEGER NOT NULL REFERENCES caregivers(id),
  device_label TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL
);

-- Reminders already sent by the scheduled job, so each one goes out once.
CREATE TABLE sent_reminders (
  reminder_key TEXT PRIMARY KEY,
  sent_at      TEXT NOT NULL
);
