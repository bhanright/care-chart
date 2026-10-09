-- The chart's owner: the caregiver who set the chart up. Nobody else can change the
-- owner's access, remove the owner or reset the owner's password (see src/auth.ts).
ALTER TABLE caregivers ADD COLUMN owner INTEGER NOT NULL DEFAULT 0 CHECK (owner IN (0, 1));
UPDATE caregivers SET owner = 1 WHERE id = (SELECT MIN(id) FROM caregivers);
