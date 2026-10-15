-- Result of the private-info check when the author insisted it was fine.
ALTER TABLE locations ADD COLUMN privacy_flag jsonb;
ALTER TABLE location_edits ADD COLUMN privacy_flag jsonb;

-- Language for the "your shelf photos are ready" email, and when it was sent.
ALTER TABLE scans ADD COLUMN lang text NOT NULL DEFAULT 'he';
ALTER TABLE scans ADD COLUMN notified_at timestamptz;

-- How sure the reading is (high = found in a catalogue, medium = clean text,
-- low = garbled/guessed), and a cut-out of that spine so the user can compare.
ALTER TABLE scan_items ADD COLUMN quality text NOT NULL DEFAULT 'medium' CHECK (quality IN ('high','medium','low'));
ALTER TABLE scan_items ADD COLUMN crop_path text;

ALTER TABLE scans DROP CONSTRAINT scans_status_check;
ALTER TABLE scans ADD CONSTRAINT scans_status_check CHECK (status IN ('queued','processing','done','failed','confirmed','dismissed'));
