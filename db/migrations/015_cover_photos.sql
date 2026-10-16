-- Photos of a book's front and back covers, taken one after the other.
ALTER TABLE sightings ADD COLUMN back_photo_id uuid REFERENCES photos(id) ON DELETE SET NULL;
ALTER TABLE my_books ADD COLUMN back_photo_id uuid REFERENCES photos(id) ON DELETE SET NULL;

-- A book no catalogue knows: its two covers are read by the vision model and the book
-- waits in the approval queue. Covers photographed at home (My books) have no library.
ALTER TABLE scans ALTER COLUMN location_id DROP NOT NULL;
ALTER TABLE scans DROP CONSTRAINT scans_source_check;
ALTER TABLE scans ADD CONSTRAINT scans_source_check CHECK (source IN ('photo', 'video', 'barcode', 'cover'));
ALTER TABLE scans ADD COLUMN book_code text; -- the ISBN or Danacode scanned, when there was one
ALTER TABLE scan_items ADD COLUMN back_path text;
