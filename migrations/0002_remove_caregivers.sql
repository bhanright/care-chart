-- Caregivers can be removed. Removal never deletes the row: the caregiver's past records
-- still name them. A removed caregiver cannot sign in and is listed as "(removed)".
ALTER TABLE caregivers ADD COLUMN removed_at TEXT;
ALTER TABLE caregivers ADD COLUMN removed_by INTEGER REFERENCES caregivers(id);
