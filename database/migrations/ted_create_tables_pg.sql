-- TED (Training & Development) tables. Run: node scripts/run-schema.js (or psql -f).
CREATE TABLE IF NOT EXISTS ted_session (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  presentation_file TEXT,            -- stored PPTX (data URL / path, same pattern as other uploads)
  presentation_text TEXT,            -- extracted slide text (for (re)generation + audit)
  start_at TIMESTAMP,                -- training start time
  end_at TIMESTAMP NOT NULL,         -- training end time; quiz unlocks at/after this
  pass_threshold INT NOT NULL DEFAULT 60,
  max_attempts INT,                  -- NULL = unlimited (deferred)
  cycle_no INT NOT NULL DEFAULT 1,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',  -- draft | published | closed
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ted_question_pool (
  id SERIAL PRIMARY KEY,
  session_id INT NOT NULL REFERENCES ted_session(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  option_a TEXT NOT NULL,
  option_b TEXT NOT NULL,
  option_c TEXT NOT NULL,
  option_d TEXT NOT NULL,
  correct_option CHAR(1) NOT NULL,   -- 'A' | 'B' | 'C' | 'D'
  source VARCHAR(10) NOT NULL DEFAULT 'ai',  -- ai | hr
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ted_question_session ON ted_question_pool(session_id);

CREATE TABLE IF NOT EXISTS ted_assignment (
  id SERIAL PRIMARY KEY,
  session_id INT NOT NULL REFERENCES ted_session(id) ON DELETE CASCADE,
  employee_id INT NOT NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'assigned',  -- assigned | passed | failed
  best_score NUMERIC(5,2),
  current_cycle INT NOT NULL DEFAULT 1,
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (session_id, employee_id)
);
CREATE INDEX IF NOT EXISTS idx_ted_assignment_emp ON ted_assignment(employee_id);

CREATE TABLE IF NOT EXISTS ted_attempt (
  id SERIAL PRIMARY KEY,
  assignment_id INT NOT NULL REFERENCES ted_assignment(id) ON DELETE CASCADE,
  cycle_no INT NOT NULL,
  question_ids INT[] NOT NULL,       -- the 5 drawn pool questions
  answers JSONB NOT NULL,            -- { "<question_id>": "A", ... }
  score NUMERIC(5,2) NOT NULL,
  passed BOOLEAN NOT NULL,
  attempted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ted_attempt_assignment ON ted_attempt(assignment_id);

SELECT 'TED tables created.' AS message;
