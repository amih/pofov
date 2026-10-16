-- One approval queue per reader: every book read from a photo, a video or a scanned
-- barcode waits here until the reader approves, declines or sets it aside for later.
-- merged = the same book found again (another photo, the video, its barcode): folded into merged_into.
ALTER TABLE scan_items ADD COLUMN decision text CHECK (decision IN ('approved', 'declined', 'later', 'merged'));
ALTER TABLE scan_items ADD COLUMN merged_into bigint REFERENCES scan_items(id) ON DELETE SET NULL;
ALTER TABLE scan_items ADD COLUMN sources text[] NOT NULL DEFAULT '{}';
ALTER TABLE scan_items ADD COLUMN decided_at timestamptz;
ALTER TABLE scan_items ADD COLUMN sighting_id bigint REFERENCES sightings(id) ON DELETE SET NULL;

-- Items of scans confirmed the old way (all at once) are already decided.
UPDATE scan_items SET decision = CASE WHEN outcome = 'dropped' THEN 'declined' ELSE 'approved' END, decided_at = now()
 WHERE outcome IS NOT NULL;
UPDATE scan_items i SET decision = 'declined', decided_at = now()
  FROM scans s WHERE s.id = i.scan_id AND s.status IN ('confirmed', 'dismissed') AND i.decision IS NULL;

CREATE INDEX scan_items_open_idx ON scan_items(scan_id) WHERE decision IS NULL OR decision = 'later';

-- A scanned barcode is a scan with no media: source tells the kinds apart.
ALTER TABLE scans ADD COLUMN source text NOT NULL DEFAULT 'photo' CHECK (source IN ('photo', 'video', 'barcode'));
UPDATE scans SET source = 'video' WHERE media @> '[{"type": "video"}]';
UPDATE scan_items i SET sources = ARRAY[s.source] FROM scans s WHERE s.id = i.scan_id;
