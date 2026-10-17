-- Pairs of books a reader checked and found to be different books (not duplicates).
CREATE TABLE book_not_dupes (
  a  bigint NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  b  bigint NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  by_user bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (a, b),
  CHECK (a < b)
);
