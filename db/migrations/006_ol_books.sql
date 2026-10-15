-- Local copy of the Open Library catalogue (CC0 monthly dump), so book lookups
-- do not depend on rate-limited web APIs. Filled by deploy/ol-refresh.sh; the
-- table is built as ol_books_new and swapped in, so it may be empty until then.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS ol_books (
  isbn13     text,              -- one row per ISBN; NULL for books without one
  title      text NOT NULL,
  authors    text[] NOT NULL DEFAULT '{}',
  publisher  text,
  year       int,
  lang       text,              -- MARC code: heb, eng, rus, ara…
  cover_id   int,
  ol_key     text NOT NULL,     -- /books/OL…M
  tnorm      text NOT NULL      -- normalised title + subtitle + other titles, for fuzzy matching
);
CREATE INDEX IF NOT EXISTS ol_books_isbn_idx ON ol_books (isbn13);
CREATE INDEX IF NOT EXISTS ol_books_tnorm_trgm ON ol_books USING gin (tnorm gin_trgm_ops);
