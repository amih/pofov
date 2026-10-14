-- Map bbox queries compare as planar geometry: a geography envelope wider than
-- 180° wraps the wrong way round the globe and matches nothing.
CREATE INDEX locations_geom_geometry_idx ON locations USING gist ((geom::geometry));
