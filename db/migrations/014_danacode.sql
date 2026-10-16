-- Danacode: Israel's own book-edition number (D.A.N.A. Systems), on many Israeli books
-- instead of (or beside) an ISBN. Stored as the full 12 digits; its barcode is UPC-A.
ALTER TABLE books ADD COLUMN danacode text UNIQUE;
ALTER TABLE scan_items ADD COLUMN danacode text;
