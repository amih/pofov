-- Statistics on book catalogue searches, to compare sources later.

-- One row per book search (an ISBN or a title read off a spine).
CREATE TABLE lookups (
  id          uuid PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  kind        text NOT NULL CHECK (kind IN ('isbn','title')),
  query       text NOT NULL,
  author      text,
  hebrew      boolean NOT NULL,
  context     text NOT NULL,             -- scan, isbn_lookup, sighting
  book_id     bigint REFERENCES books(id) ON DELETE SET NULL,
  source      text,                      -- which source answered: cache, local_ol, nli, googlebooks, openlibrary
  score       real,                      -- title similarity of the chosen record (0–1)
  ms          int NOT NULL
);
CREATE INDEX lookups_at_idx ON lookups(at);

-- One row per request to a source inside a search.
CREATE TABLE lookup_calls (
  id          bigserial PRIMARY KEY,
  lookup_id   uuid REFERENCES lookups(id) ON DELETE CASCADE,
  at          timestamptz NOT NULL DEFAULT now(),
  source      text NOT NULL,             -- local_ol, nli, googlebooks, openlibrary
  outcome     text NOT NULL CHECK (outcome IN ('hit','miss','error','limited')),
  http_status int,
  attempts    int NOT NULL DEFAULT 1,
  results     int NOT NULL DEFAULT 0,
  ms          int NOT NULL,
  error       text
);
CREATE INDEX lookup_calls_lookup_idx ON lookup_calls(lookup_id);
CREATE INDEX lookup_calls_at_idx ON lookup_calls(at);

-- Was the match right? Set when the user confirms a scan:
-- kept = ticked unchanged, edited = ticked after changing title/author, dropped = unticked.
ALTER TABLE scan_items ADD COLUMN lookup_id uuid REFERENCES lookups(id) ON DELETE SET NULL;
ALTER TABLE scan_items ADD COLUMN outcome text CHECK (outcome IN ('kept','edited','dropped'));

-- Daily summary per source: SELECT * FROM lookup_source_daily ORDER BY day DESC, source;
CREATE VIEW lookup_source_daily AS
SELECT date_trunc('day', at)::date AS day, source,
       count(*)                                   AS calls,
       count(*) FILTER (WHERE outcome = 'hit')     AS hits,
       count(*) FILTER (WHERE outcome = 'miss')    AS misses,
       count(*) FILTER (WHERE outcome = 'error')   AS errors,
       count(*) FILTER (WHERE outcome = 'limited') AS limited,
       round(avg(ms))::int                        AS avg_ms
  FROM lookup_calls GROUP BY 1, 2;

-- How often each answering source was right, judged by what users confirmed.
CREATE VIEW lookup_match_quality AS
SELECT l.source, l.hebrew,
       count(*)                                     AS items,
       count(*) FILTER (WHERE i.outcome = 'kept')    AS kept,
       count(*) FILTER (WHERE i.outcome = 'edited')  AS edited,
       count(*) FILTER (WHERE i.outcome = 'dropped') AS dropped,
       round(avg(l.score)::numeric, 2)              AS avg_score
  FROM scan_items i JOIN lookups l ON l.id = i.lookup_id
 WHERE i.outcome IS NOT NULL
 GROUP BY 1, 2;
