-- Research database for hotspot tracking (Cloudflare D1 / SQLite).
-- Apply with: npx wrangler d1 execute ocfire-research --remote --file workers/collector/schema.sql

-- Every satellite fire detection seen in California.
CREATE TABLE IF NOT EXISTS detections (
    id INTEGER PRIMARY KEY,
    track_id INTEGER,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    acquired TEXT NOT NULL,          -- satellite pass time, ISO UTC
    satellite TEXT NOT NULL,
    instrument TEXT,
    confidence TEXT,
    frp REAL,                        -- fire radiative power, MW
    bright_ti4 REAL,
    daynight TEXT,
    collected_at TEXT NOT NULL,      -- when the collector first saw it
    UNIQUE (satellite, acquired, lat, lng)
);
CREATE INDEX IF NOT EXISTS detections_track ON detections (track_id);
CREATE INDEX IF NOT EXISTS detections_acquired ON detections (acquired);

-- A hotspot followed over time: detections within 1.25 mi of each other, across satellite passes.
CREATE TABLE IF NOT EXISTS tracks (
    id INTEGER PRIMARY KEY,
    first_seen TEXT NOT NULL,        -- earliest pass
    last_seen TEXT NOT NULL,         -- latest pass
    first_collected TEXT NOT NULL,   -- when the collector created the track
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'active', -- active | fire | not_reported | recurring | known_fire
    known_at_start TEXT,             -- name of the known incident it was near when first seen
    detections INTEGER NOT NULL DEFAULT 0,
    passes INTEGER NOT NULL DEFAULT 0,
    max_frp REAL,
    peak_score INTEGER,
    peak_level TEXT,
    first_moderate_at TEXT,          -- pass time when the signal first reached Moderate
    first_strong_at TEXT,            -- pass time when the signal first reached Strong
    incident_id TEXT,
    incident_name TEXT,
    incident_source TEXT,
    incident_started TEXT,           -- start time the agency lists
    incident_seen TEXT,              -- when the incident first appeared in its feed (per the collector)
    incident_preexisting INTEGER,    -- 1 if the incident was already in the feed on the collector's first run
    labeled_at TEXT
);
CREATE INDEX IF NOT EXISTS tracks_last_seen ON tracks (last_seen);
CREATE INDEX IF NOT EXISTS tracks_status ON tracks (status);

-- What was known about a track right after each satellite pass. Scores are frozen here (no hindsight).
CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY,
    track_id INTEGER NOT NULL,
    taken_at TEXT NOT NULL,
    pass_time TEXT NOT NULL,
    detections INTEGER,
    satellites INTEGER,
    high_confidence INTEGER,
    max_frp REAL,
    sum_frp REAL,
    extent_mi REAL,                  -- widest distance between detections
    drift_mi REAL,                   -- first detection to the centroid of later passes
    drift_bearing REAL,
    wind_speed REAL,
    wind_gust REAL,
    wind_dir REAL,                   -- direction the wind comes from
    humidity REAL,
    temp_f REAL,
    weather_level TEXT,              -- normal | elevated | critical
    red_flag INTEGER,
    smoke_level INTEGER,             -- NOAA HMS plume over the spot: 0 none, 1 light, 2 medium, 3 heavy
    chp_fire_reports INTEGER,        -- CHP fire calls within 3 mi in the last 6 h
    past_days INTEGER,               -- one-year baseline: days hot within ~1 km
    prior_days INTEGER,              -- days hot within 0.6 mi in the previous 5 days
    score INTEGER,
    level TEXT,
    reasons TEXT,                    -- JSON
    rules_version INTEGER
);
CREATE INDEX IF NOT EXISTS snapshots_track ON snapshots (track_id);

-- Reported incidents from CAL FIRE and the national WFIGS feed, used as outcome labels.
CREATE TABLE IF NOT EXISTS incidents (
    id TEXT PRIMARY KEY,             -- "calfire:<UniqueId>" or "wfigs:<IrwinID>"
    source TEXT NOT NULL,
    name TEXT,
    lat REAL,
    lng REAL,
    county TEXT,
    started TEXT,                    -- discovery time the agency lists
    reported TEXT,                   -- when the official record was created (WFIGS CreatedOnDateTime; null for CAL FIRE)
    first_seen TEXT NOT NULL,        -- when the collector first saw it in the feed
    preexisting INTEGER NOT NULL DEFAULT 0,
    acres REAL,
    updated TEXT,
    contained REAL,                  -- percent contained
    active INTEGER,                  -- 1 while the agency lists it as active
    contained_at TEXT,               -- WFIGS ContainmentDateTime
    controlled_at TEXT,              -- WFIGS ControlDateTime
    out_at TEXT,                     -- WFIGS FireOutDateTime / CAL FIRE ExtinguishedDate
    url TEXT,                        -- official incident page (CAL FIRE)
    cause TEXT
);
CREATE INDEX IF NOT EXISTS incidents_started ON incidents (started);

-- One row each time an incident's size, containment or active status changes (at = agency update time).
CREATE TABLE IF NOT EXISTS incident_history (
    id INTEGER PRIMARY KEY,
    incident_id TEXT NOT NULL,
    at TEXT NOT NULL,
    acres REAL,
    contained REAL,
    active INTEGER
);
CREATE INDEX IF NOT EXISTS incident_history_incident ON incident_history (incident_id, at);

CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    new_detections INTEGER,
    new_tracks INTEGER,
    snapshots INTEGER,
    labeled INTEGER,
    errors TEXT
);
