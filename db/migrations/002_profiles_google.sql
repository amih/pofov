-- Public identity is the screen name + avatar; the email is never shown to anyone.
ALTER TABLE users RENAME COLUMN display_name TO screen_name;
CREATE UNIQUE INDEX users_screen_name_uq ON users (lower(screen_name));

ALTER TABLE users
  ADD COLUMN google_sub     text UNIQUE,
  ADD COLUMN avatar_path    text,             -- relative to UPLOAD_DIR
  ADD COLUMN avatar_source  text CHECK (avatar_source IN ('google','upload')),
  ADD COLUMN google_picture text,             -- last picture URL Google gave us
  ADD COLUMN last_login_at  timestamptz;
