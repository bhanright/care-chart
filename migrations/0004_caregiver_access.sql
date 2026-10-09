-- How much each caregiver may change (see src/access.ts). Everyone who already has an
-- account keeps full access.
ALTER TABLE caregivers ADD COLUMN access TEXT NOT NULL DEFAULT 'full'
  CHECK (access IN ('full', 'record', 'view'));
