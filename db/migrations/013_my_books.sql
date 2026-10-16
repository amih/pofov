-- A reader's own books, scanned at home (away from any library). When the reader
-- later leaves one in a library, it becomes an 'added' sighting there.
CREATE TABLE my_books (
  id           bigserial PRIMARY KEY,
  user_id      bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id      bigint NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  photo_id     uuid REFERENCES photos(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  placed_at    timestamptz,
  location_id  bigint REFERENCES locations(id) ON DELETE SET NULL,
  sighting_id  bigint REFERENCES sightings(id) ON DELETE SET NULL
);
CREATE INDEX my_books_user_idx ON my_books(user_id, created_at DESC);
