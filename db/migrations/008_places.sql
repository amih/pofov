-- Towns and cities (GeoNames cities1000, CC BY 4.0) so every library belongs to a place.
-- Place pages (/p/...) and country pages (/c/...) are what search engines index.

CREATE TABLE places (
  id          bigint PRIMARY KEY,          -- GeoNames id
  name        text NOT NULL,               -- local/English name from GeoNames
  name_he     text,                        -- first Hebrew alternate name, if any
  slug        text NOT NULL,               -- ascii, for the URL: /p/<id>-<slug>
  country     char(2) NOT NULL,
  population  bigint NOT NULL DEFAULT 0,
  geom        geography(Point,4326) NOT NULL
);
CREATE INDEX places_geom_idx ON places USING gist ((geom::geometry));
CREATE INDEX places_country_idx ON places (country);

ALTER TABLE locations ADD COLUMN place_id bigint REFERENCES places(id) ON DELETE SET NULL;
CREATE INDEX locations_place_idx ON locations (place_id);

-- Nearest town within 25 km; NULL far from any town. KNN on the geometry index first.
CREATE FUNCTION nearest_place(g geography) RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT id FROM (
    SELECT p.id, p.geom FROM places p ORDER BY p.geom::geometry <-> g::geometry LIMIT 1
  ) x WHERE ST_DWithin(x.geom, g, 25000)
$$;

CREATE FUNCTION locations_set_place() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.place_id := nearest_place(NEW.geom);
  RETURN NEW;
END $$;

CREATE TRIGGER locations_set_place
  BEFORE INSERT OR UPDATE OF geom ON locations
  FOR EACH ROW EXECUTE FUNCTION locations_set_place();
