-- Visits from the care team (hospice nurses, aides, social workers and others): when
-- they are expected, and what happened. Like the rest of the chart, a wrong visit is
-- marked entered in error (voided_at), never deleted.
CREATE TABLE visits (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  scheduled_at     TEXT NOT NULL,              -- when the visit is (or was) expected, UTC
  duration_minutes INTEGER,                    -- expected length, if known
  role             TEXT NOT NULL,              -- "Hospice aide", "Hospice nurse (RN)", ...
  visitor_name     TEXT NOT NULL DEFAULT '',
  agency           TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'scheduled'
                   CHECK (status IN ('scheduled', 'completed', 'declined', 'cancelled_by_agency', 'cancelled_by_family', 'no_show')),
  outcome_note     TEXT NOT NULL DEFAULT '',   -- what was done, what she declined, or why it was cancelled
  note             TEXT NOT NULL DEFAULT '',   -- anything known beforehand ("bringing new bed pads")
  series_id        TEXT,                       -- visits created together as a weekly repeat share this
  recorded_by      INTEGER NOT NULL REFERENCES caregivers(id),
  recorded_at      TEXT NOT NULL,
  updated_by       INTEGER REFERENCES caregivers(id),
  updated_at       TEXT NOT NULL,
  voided_by        INTEGER REFERENCES caregivers(id),
  voided_at        TEXT,
  void_reason      TEXT NOT NULL DEFAULT ''
);
CREATE INDEX visits_by_time ON visits(scheduled_at);

-- Going in a brief is normal for someone who wears them, not an accident. The old choice
-- "Accident (brief)" meant exactly that, so it becomes "Brief / diaper"; a true accident
-- is now "Accident (outside brief)".
UPDATE entries
   SET data = json_set(data, '$.continence', 'Brief / diaper')
 WHERE type IN ('bowel', 'urine') AND json_extract(data, '$.continence') = 'Accident (brief)';
