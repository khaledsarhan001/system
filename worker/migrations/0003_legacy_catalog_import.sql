ALTER TABLE products ADD COLUMN product_type TEXT NOT NULL DEFAULT 'general';
ALTER TABLE transactions ADD COLUMN employee_name_snapshot TEXT NOT NULL DEFAULT '';
ALTER TABLE transactions ADD COLUMN legacy_source_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_legacy_source ON transactions(legacy_source_id);
