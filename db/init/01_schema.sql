-- Database schema (decision D15 in docs/decisions.md).
--
-- The postgis image runs the files of /docker-entrypoint-initdb.d once, when
-- the data volume is empty. To apply a change to this file on an existing
-- database: `docker compose down -v` (deletes all data), then `docker compose up`.
--
-- Layout: one table per sensor type for the description (static attributes)
-- and one table per sensor type for the readings (values over time).
-- IDs are the NGSI-LD IDs of the API, kept as text (e.g. 'urn:ngsi-ld:station:006').
-- Timestamps are timestamptz, stored in UTC.

CREATE EXTENSION IF NOT EXISTS postgis;

-- ---------------------------------------------------------------------------
-- Descriptions
-- ---------------------------------------------------------------------------

CREATE TABLE bike_station (
    id          text PRIMARY KEY,
    address     text,                                -- address.streetAddress
    total_slots integer CHECK (total_slots >= 0),
    geom        geometry(Point, 4326) NOT NULL,      -- WGS84, as in the API
    loaded_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE parking (
    id            text PRIMARY KEY,
    name          text NOT NULL,
    address       text,
    total_spots   integer CHECK (total_spots >= 0),  -- known to be wrong for P-019
    is_free       boolean,
    parking_type  text,                              -- e.g. 'ouvrage', 'enclos_en_surface'
    typology      text,                              -- e.g. 'Centre-ville'
    level_number  integer,
    max_height_cm integer,                           -- NULL when the API says "N/A"
    geom          geometry(Point, 4326) NOT NULL,
    loaded_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE counter (
    id             text PRIMARY KEY,
    -- Prefix of the sensor code ('COM', 'ZLT', 'X2H', ...). The timestamp
    -- shift of the readings depends on it (api-findings.md, section 6).
    family         text GENERATED ALWAYS AS (left(split_part(id, ':', 4), 3)) STORED,
    name           text,                             -- 15 counters have no name
    lane_id        bigint,
    reversed_lane  boolean,
    vehicle_type   text,
    -- Counter this one replaces. Filled after all counters are inserted,
    -- because the referenced counter must exist first.
    old_version_id text REFERENCES counter (id),
    geom           geometry(Point, 4326) NOT NULL,
    loaded_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Readings
-- ---------------------------------------------------------------------------
-- The primary key (sensor, observed_at) does two jobs:
--   * no duplicates: the loader uses INSERT ... ON CONFLICT DO NOTHING, which
--     absorbs the point shared by two consecutive API pages;
--   * index for "one sensor over a time range", the most common query.
-- loaded_at records when the row was loaded, to trace it back to a raw file.

CREATE TABLE bike_reading (
    station_id      text NOT NULL REFERENCES bike_station (id),
    observed_at     timestamptz NOT NULL,
    available_bikes integer CHECK (available_bikes >= 0),
    free_slots      integer CHECK (free_slots >= 0),
    status          text,
    loaded_at       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (station_id, observed_at)
);

CREATE TABLE parking_reading (
    parking_id      text NOT NULL REFERENCES parking (id),
    observed_at     timestamptz NOT NULL,
    -- No upper bound (<= total_spots): P-019 reports more free spots than
    -- its listed capacity. Such values are kept and handled in the analysis.
    available_spots integer CHECK (available_spots >= 0),
    status          text,                            -- 'Open' or 'Full'
    loaded_at       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (parking_id, observed_at)
);

-- observed_at is stored exactly as received, even when it is known to be
-- shifted (X2H counters since April 2026). The correction will live in a
-- view, so it can be changed without reloading the data.
CREATE TABLE counter_reading (
    counter_id  text NOT NULL REFERENCES counter (id),
    observed_at timestamptz NOT NULL,
    intensity   integer NOT NULL CHECK (intensity >= 0),  -- bikes per hour
    loaded_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (counter_id, observed_at)
);
