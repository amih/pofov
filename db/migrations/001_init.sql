CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- trust_level: 0 = new (submissions reviewed), 1 = trusted (auto-publish),
--              2 = reviewer, 3 = admin
CREATE TABLE users (
  id           bigserial PRIMARY KEY,
  email        text NOT NULL UNIQUE,
  display_name text,
  trust_level  smallint NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE login_tokens (
  token_hash  bytea PRIMARY KEY,
  email       text NOT NULL,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz
);

CREATE TABLE sessions (
  token_hash  bytea PRIMARY KEY,
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE TABLE photos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     bigint REFERENCES users(id) ON DELETE SET NULL,
  kind        text NOT NULL CHECK (kind IN ('location','cover','back','copyright','shelf')),
  path        text NOT NULL,
  thumb_path  text NOT NULL,
  width       int,
  height      int,
  exif_geom   geography(Point, 4326),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- status for user content: pending (review queue), approved, rejected
CREATE TABLE locations (
  id              bigserial PRIMARY KEY,
  code            text NOT NULL UNIQUE,          -- short code used in QR links: /l/<code>
  name            text,
  description     text,                          -- "how to find it" hint
  geom            geography(Point, 4326) NOT NULL,
  source          text NOT NULL DEFAULT 'user' CHECK (source IN ('user','osm')),
  osm_type        text,
  osm_id          bigint,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  restricted      boolean NOT NULL DEFAULT false, -- e.g. inside a building lobby
  steward_id      bigint REFERENCES users(id) ON DELETE SET NULL,
  photo_id        uuid REFERENCES photos(id) ON DELETE SET NULL,
  created_by      bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_checked_at timestamptz,
  UNIQUE (osm_type, osm_id)
);
CREATE INDEX locations_geom_idx ON locations USING gist(geom);
CREATE INDEX locations_status_idx ON locations(status);

CREATE TABLE books (
  id          bigserial PRIMARY KEY,
  isbn13      text UNIQUE,
  title       text NOT NULL,
  authors     text[] NOT NULL DEFAULT '{}',
  publisher   text,
  year        int,
  language    text,
  cover_url   text,
  source      text NOT NULL,                     -- openlibrary | googlebooks | user | llm
  source_ids  jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX books_title_idx ON books USING gin (to_tsvector('simple', title));

-- Books come and go, so we store sightings, not stock. A book is "on the shelf"
-- when its latest approved sighting at that location is 'seen'.
CREATE TABLE sightings (
  id           bigserial PRIMARY KEY,
  book_id      bigint NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  location_id  bigint NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  user_id      bigint REFERENCES users(id) ON DELETE SET NULL,
  kind         text NOT NULL CHECK (kind IN ('seen','taken','gone')),
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  photo_id     uuid REFERENCES photos(id) ON DELETE SET NULL,
  distance_m   int,                              -- reporter's distance from the location
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sightings_loc_book_idx ON sightings(location_id, book_id, created_at DESC);
CREATE INDEX sightings_status_idx ON sightings(status);

-- Append-only. Every point ever awarded, with the reason. Can later be exported
-- or anchored elsewhere without changing the app.
CREATE TABLE karma_events (
  id          bigserial PRIMARY KEY,
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  points      int NOT NULL,
  reason      text NOT NULL,
  ref_type    text,
  ref_id      bigint,
  awarded_by  bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX karma_user_idx ON karma_events(user_id);
CREATE INDEX karma_created_idx ON karma_events(created_at);

CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  user_id     bigint REFERENCES users(id) ON DELETE SET NULL,
  action      text NOT NULL,
  ref_type    text,
  ref_id      bigint,
  detail      jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
