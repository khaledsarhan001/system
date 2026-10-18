ALTER TABLE users ADD COLUMN last_active_at TEXT;
CREATE INDEX IF NOT EXISTS idx_users_last_active ON users(role, last_active_at);
