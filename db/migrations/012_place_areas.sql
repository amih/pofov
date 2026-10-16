-- Town boundaries (OpenStreetMap admin_level 8), so a library near a town line is put
-- in the town it is really in, not the one whose centre is closest. Loaded by
-- scripts/import-areas.js; place_id = the GeoNames town that the boundary belongs to.
CREATE TABLE place_areas (
  id           bigint PRIMARY KEY,              -- OSM relation id
  name         text NOT NULL,
  name_he      text,
  name_en      text,
  country      text NOT NULL,
  regional     boolean NOT NULL DEFAULT false,  -- a regional council: many villages, keep the nearest one
  place_id     bigint REFERENCES places(id) ON DELETE SET NULL,
  geom         geometry(MultiPolygon, 4326) NOT NULL  -- geometry: point-in-polygon is fast with the index
);
CREATE INDEX place_areas_geom_idx ON place_areas USING gist (geom);

-- The town whose boundary holds the point; else the nearest town within 25 km.
CREATE OR REPLACE FUNCTION locations_set_place() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.place_id := COALESCE(
    (SELECT a.place_id FROM place_areas a
      WHERE NOT a.regional AND a.place_id IS NOT NULL AND ST_Covers(a.geom, NEW.geom::geometry) LIMIT 1),
    nearest_place(NEW.geom));
  RETURN NEW;
END $$;
