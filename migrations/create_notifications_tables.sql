-- Notifications inbox + Web Push subscriptions (Employee Portal)
-- Run against PostgreSQL after backup.

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  recipient_employee_id INTEGER NOT NULL,
  type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  body TEXT,
  url VARCHAR(512),
  is_read BOOLEAN DEFAULT FALSE,
  related_entity_type VARCHAR(50),
  related_entity_id INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient
  ON notifications (recipient_employee_id, is_read, created_at DESC);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL,
  subscription JSONB NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_push_sub_emp_digest
  ON push_subscriptions (employee_id, md5(subscription::text));

CREATE INDEX IF NOT EXISTS idx_push_sub_employee ON push_subscriptions (employee_id);
