-- Bigger pictures and the back-cover text of a book, looked up online the first
-- time someone opens it and cached here (details_at = when we last looked).
ALTER TABLE books ADD COLUMN front_url text;      -- large front cover
ALTER TABLE books ADD COLUMN back_url text;       -- back cover, when a shop or catalogue shows one
ALTER TABLE books ADD COLUMN description text;    -- blurb / back-cover text
ALTER TABLE books ADD COLUMN details_source text; -- where the above came from
ALTER TABLE books ADD COLUMN details_at timestamptz;
