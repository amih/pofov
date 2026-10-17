-- Cover photos are cut out and straightened after upload; this marks the ones done.
ALTER TABLE photos ADD COLUMN cropped_at timestamptz;

-- Whose book a scanned book is: the reader's own, a friend's (at the friend's home),
-- or borrowed from a friend; with the friend's name when given.
ALTER TABLE my_books ADD COLUMN owner text NOT NULL DEFAULT 'mine' CHECK (owner IN ('mine', 'friend', 'borrowed'));
ALTER TABLE my_books ADD COLUMN friend_name text;
ALTER TABLE scans ADD COLUMN owner text CHECK (owner IN ('mine', 'friend', 'borrowed'));
ALTER TABLE scans ADD COLUMN friend_name text;
