CREATE TABLE IF NOT EXISTS social_posts (
    id INTEGER PRIMARY KEY,
    incident_id TEXT NOT NULL,
    kind TEXT NOT NULL,              -- new | update | seed
    created_at TEXT NOT NULL,
    status TEXT NOT NULL,            -- posted | dry_run | skipped | error
    post_id TEXT,
    text TEXT,
    acres REAL,
    contained REAL,
    error TEXT
);
CREATE INDEX IF NOT EXISTS social_posts_incident ON social_posts (incident_id, created_at);
CREATE INDEX IF NOT EXISTS social_posts_created ON social_posts (created_at);
