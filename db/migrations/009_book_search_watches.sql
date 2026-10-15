-- Book search (title or author, near me) and "tell me when this book shows up".

-- Lower case, no vowel points, punctuation → spaces. Used for the stored text and the query.
CREATE FUNCTION search_norm(s text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT btrim(regexp_replace(lower(regexp_replace(coalesce(s, ''), '[֑-ׇ]', '', 'g')), '[^[:alnum:]]+', ' ', 'g'))
$$;

ALTER TABLE books ADD COLUMN search text;
UPDATE books SET search = search_norm(title || ' ' || array_to_string(authors, ' '));
CREATE INDEX books_search_trgm ON books USING gin (search gin_trgm_ops);

CREATE FUNCTION books_set_search() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.search := search_norm(NEW.title || ' ' || array_to_string(NEW.authors, ' '));
  RETURN NEW;
END $$;
CREATE TRIGGER books_set_search BEFORE INSERT OR UPDATE OF title, authors ON books
  FOR EACH ROW EXECUTE FUNCTION books_set_search();

CREATE INDEX sightings_book_idx ON sightings (book_id, created_at DESC);

-- A reader waiting for a book: at one library, within km of a point, or anywhere.
CREATE TABLE book_watches (
  id           bigserial PRIMARY KEY,
  user_id      bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id      bigint NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  scope        text NOT NULL CHECK (scope IN ('here', 'near', 'anywhere')),
  location_id  bigint REFERENCES locations(id) ON DELETE CASCADE,   -- scope 'here'
  center       geography(Point,4326),                                -- scope 'near'
  km           int,                                                  -- scope 'near'
  created_at   timestamptz NOT NULL DEFAULT now(),
  lang         text NOT NULL DEFAULT 'he',                          -- of the email
  notified_at  timestamptz,
  CHECK ((scope = 'here') = (location_id IS NOT NULL)),
  CHECK ((scope = 'near') = (center IS NOT NULL AND km IS NOT NULL))
);
CREATE INDEX book_watches_book_idx ON book_watches (book_id);
CREATE UNIQUE INDEX book_watches_one_per_book ON book_watches (user_id, book_id);

-- Approved shelf reports not yet matched against watches (set false on approval too).
ALTER TABLE sightings ADD COLUMN watch_checked boolean NOT NULL DEFAULT true;
ALTER TABLE sightings ALTER COLUMN watch_checked SET DEFAULT false;
CREATE INDEX sightings_watch_todo ON sightings (id) WHERE NOT watch_checked;
