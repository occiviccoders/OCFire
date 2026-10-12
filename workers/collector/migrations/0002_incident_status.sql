-- Adds incident lifecycle tracking to databases created before it was in schema.sql.
ALTER TABLE incidents ADD COLUMN contained REAL;
ALTER TABLE incidents ADD COLUMN active INTEGER;
ALTER TABLE incidents ADD COLUMN contained_at TEXT;
ALTER TABLE incidents ADD COLUMN controlled_at TEXT;
ALTER TABLE incidents ADD COLUMN out_at TEXT;
ALTER TABLE incidents ADD COLUMN url TEXT;
ALTER TABLE incidents ADD COLUMN cause TEXT;

CREATE TABLE IF NOT EXISTS incident_history (
    id INTEGER PRIMARY KEY,
    incident_id TEXT NOT NULL,
    at TEXT NOT NULL,
    acres REAL,
    contained REAL,
    active INTEGER
);
CREATE INDEX IF NOT EXISTS incident_history_incident ON incident_history (incident_id, at);
