#!/usr/bin/env bash
# Monthly: download the latest Open Library dump and rebuild ol_books (runs on the server).
#   deploy/ol-refresh.sh [DATA_DIR]      — needs aria2c, docker (DB container), node
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATA="${1:-$HOME/seferehov-data/ol}"
DB_CONTAINER="${DB_CONTAINER:-seferehov-db-1}"
mkdir -p "$DATA" && cd "$DATA"
psql() { docker exec -i "$DB_CONTAINER" psql -U seferehov -d seferehov -v ON_ERROR_STOP=1 "$@"; }

url=$(curl -sIL https://openlibrary.org/data/ol_dump_editions_latest.txt.gz | grep -i '^location' | tail -1 | tr -d '\r' | cut -d' ' -f2)
editions=$(basename "$url"); authors=${editions/editions/authors}
if [[ ! -f "$editions" || -f "$editions.aria2" ]]; then
  rm -f ol_dump_*.txt.gz  # older months
  printf '%s\n%s\n' "${url/editions/authors}" "$url" > urls.txt
  aria2c -q -j 2 -x 8 -s 8 -k 20M --max-tries=20 --retry-wait=30 -d . -i urls.txt
fi

psql -q -c "DROP TABLE IF EXISTS ol_books_new; CREATE TABLE ol_books_new (LIKE ol_books INCLUDING DEFAULTS);"
nice -n 19 node --max-old-space-size=8000 "$APP_DIR/server/scripts/import-ol.js" "$authors" "$editions" \
  | psql -q -c "\copy ol_books_new (isbn13, title, authors, publisher, year, lang, cover_id, ol_key, tnorm) FROM STDIN"
psql -q <<'SQL'
SET maintenance_work_mem = '2GB';
SET max_parallel_maintenance_workers = 4;
CREATE INDEX ol_books_new_isbn_idx ON ol_books_new (isbn13);
CREATE INDEX ol_books_new_tnorm_trgm ON ol_books_new USING gin (tnorm gin_trgm_ops);
ANALYZE ol_books_new;
BEGIN;
DROP TABLE ol_books;
ALTER TABLE ol_books_new RENAME TO ol_books;
ALTER INDEX ol_books_new_isbn_idx RENAME TO ol_books_isbn_idx;
ALTER INDEX ol_books_new_tnorm_trgm RENAME TO ol_books_tnorm_trgm;
COMMIT;
SQL
echo "ol_books: $(psql -Atc 'SELECT count(*) FROM ol_books') rows from $editions"
