-- 'added' = "I left this book here" (vs 'seen' = "I saw it on the shelf").
ALTER TABLE sightings DROP CONSTRAINT sightings_kind_check;
ALTER TABLE sightings ADD CONSTRAINT sightings_kind_check CHECK (kind IN ('seen','added','taken','gone'));

-- 'removed' = the library itself is gone.
ALTER TABLE locations DROP CONSTRAINT locations_status_check;
ALTER TABLE locations ADD CONSTRAINT locations_status_check CHECK (status IN ('pending','approved','rejected','removed'));

ALTER TABLE photos DROP CONSTRAINT photos_kind_check;
ALTER TABLE photos ADD CONSTRAINT photos_kind_check CHECK (kind IN ('location','cover','back','copyright','shelf','frame'));

-- Suggested changes to an existing library. Applied only when a reviewer approves.
-- changes: any of {name, description, restricted, lat, lon, photo_id, removed}
CREATE TABLE location_edits (
  id           bigserial PRIMARY KEY,
  location_id  bigint NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  user_id      bigint REFERENCES users(id) ON DELETE SET NULL,
  changes      jsonb NOT NULL,
  note         text,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by  bigint REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX location_edits_status_idx ON location_edits(status);

-- Shelf photos / short videos read by the vision model. The user confirms the
-- results, which then become ordinary sightings.
CREATE TABLE scans (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id  bigint NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  user_id      bigint REFERENCES users(id) ON DELETE SET NULL,
  kind         text NOT NULL DEFAULT 'seen' CHECK (kind IN ('seen','added')),
  status       text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','done','failed','confirmed')),
  media        jsonb NOT NULL DEFAULT '[]',     -- [{path, type: image|video}] relative to UPLOAD_DIR/scans
  progress     jsonb NOT NULL DEFAULT '{}',     -- {step, done, total}
  error        text,
  distance_m   int,                             -- uploader's distance from the library
  created_at   timestamptz NOT NULL DEFAULT now(),
  started_at   timestamptz,
  finished_at  timestamptz
);
CREATE INDEX scans_queue_idx ON scans(created_at) WHERE status = 'queued';
CREATE INDEX scans_user_idx ON scans(user_id, created_at DESC);

CREATE TABLE scan_items (
  id          bigserial PRIMARY KEY,
  scan_id     uuid NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  title       text NOT NULL,
  author      text,
  isbn13      text,
  book_id     bigint REFERENCES books(id) ON DELETE SET NULL,
  via         text NOT NULL CHECK (via IN ('barcode','vision')),
  matched     boolean NOT NULL DEFAULT false,  -- found in a book catalogue
  frame_path  text,                            -- thumbnail of the photo/frame it came from
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX scan_items_scan_idx ON scan_items(scan_id);

-- Small key/value store (e.g. when the admin was last emailed).
CREATE TABLE app_state (
  key    text PRIMARY KEY,
  value  jsonb NOT NULL
);
