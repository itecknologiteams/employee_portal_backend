# TED — Training & Development Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** HR uploads a training presentation; the system auto-generates a quiz via Gemini, auto-assigns 2 random eligible employees per department, and verifies learning with a post-training quiz (pass = 60%, retake by cycle, pass-once).

**Architecture:** New `ted_*` tables + a `ted` backend module (repository → service → controller → routes), an env-driven AI layer (`config/aiQuiz.js`, Gemini REST now / swappable to self-hosted later), PPTX→text via `officeparser`, BullMQ for quiz-unlock scheduling, and two React surfaces (HR Administration tab + Employee "My Trainings").

**Tech Stack:** Node/Express, PostgreSQL (`pg`), Node built-in `fetch` (Gemini REST), `officeparser`, BullMQ/Redis, React/Vite. Tests: Node built-in runner (`node --test`).

**Testing convention (this repo):** Pure functions get `node:test` unit tests in `tests/*.test.js` (see `tests/requisition-status.test.js`). DB/API/UI are verified manually (curl, `node --check`, DB queries) — there is no integration-test harness. Plan tasks reflect this: TDD for pure logic, explicit manual-verification steps elsewhere.

**Spec:** `docs/superpowers/specs/2026-06-29-ted-training-development-design.md`

---

## File Structure

**Backend (create):**
- `database/migrations/ted_create_tables_pg.sql` — 5 `ted_*` tables.
- `src/utils/tedQuiz.utils.js` — pure logic: `scoreQuiz`, `drawRandomQuestions`, `normalizeGeneratedQuestions`, `isEligibleForSelection`.
- `config/aiQuiz.js` — provider-agnostic AI call (Gemini REST) → returns MCQ array.
- `src/utils/pptxText.js` — PPTX buffer → plain text (officeparser wrapper).
- `src/repositories/ted.repository.js` — all `ted_*` DB access + eligible-employee selection query.
- `src/services/ted.service.js` — session lifecycle, quiz generation, selection, attempt/scoring, reopen.
- `src/controllers/ted.controller.js` — HTTP handlers + HR/employee authz.
- `src/routes/ted.routes.js` — route table.

**Backend (modify):**
- `package.json` — add `officeparser`.
- `app.js` — mount `tedRoutes`.
- `src/routes/index.js` — export `tedRoutes`.

**Backend (tests):**
- `tests/ted-quiz.test.js` — unit tests for `tedQuiz.utils.js`.

**Frontend (create):**
- `src/components/TedSessionModal.jsx` — HR: create session, upload PPTX, generate+review+publish questions.
- `src/pages/MyTrainings.jsx` — Employee: assigned trainings + quiz attempt + result.
- `src/components/TedQuizModal.jsx` — Employee: take the 5-question quiz.

**Frontend (modify):**
- `src/services/api.js` — `tedAPI` methods.
- `src/pages/Administration.jsx` — new "Training & Development" tab.
- `src/App.jsx` + nav — route for `/my-trainings`.

---

## Phase 0 — Database & dependency

### Task 0.1: Create `ted_*` tables migration

**Files:**
- Create: `database/migrations/ted_create_tables_pg.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- TED (Training & Development) tables. Run: node scripts/run-schema.js (or psql -f).
CREATE TABLE IF NOT EXISTS ted_session (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  presentation_file TEXT,            -- stored PPTX (data URL / path, same pattern as other uploads)
  presentation_text TEXT,            -- extracted slide text (for (re)generation + audit)
  scheduled_at TIMESTAMP NOT NULL,   -- training time; quiz unlocks at/after this
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
```

- [ ] **Step 2: Apply the migration**

Run: `psql "$DATABASE_URL" -f database/migrations/ted_create_tables_pg.sql` (or the project's `node scripts/run-schema.js` if it targets a file; otherwise psql).
Expected: `TED tables created.`

- [ ] **Step 3: Verify tables exist**

Run: `psql "$DATABASE_URL" -c "\dt ted_*"`
Expected: 4 tables listed (`ted_session`, `ted_question_pool`, `ted_assignment`, `ted_attempt`).

- [ ] **Step 4: Commit**

```bash
git add database/migrations/ted_create_tables_pg.sql
git commit -m "feat(ted): add training & development tables"
```

### Task 0.2: Add `officeparser` dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install**

Run: `npm install officeparser`
Expected: added to `dependencies`.

- [ ] **Step 2: Verify it imports**

Run: `node -e "import('officeparser').then(m=>console.log(typeof m.parseOfficeAsync))"`
Expected: `function`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(ted): add officeparser for PPTX text extraction"
```

---

## Phase 1 — Pure quiz logic (TDD)

### Task 1.1: `scoreQuiz` — grade answers

**Files:**
- Create: `src/utils/tedQuiz.utils.js`
- Test: `tests/ted-quiz.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scoreQuiz } from '../src/utils/tedQuiz.utils.js'

test('scoreQuiz: all correct = 100, passed at threshold 60', () => {
  const questions = [
    { id: 1, correct_option: 'A' }, { id: 2, correct_option: 'B' },
    { id: 3, correct_option: 'C' }, { id: 4, correct_option: 'D' }, { id: 5, correct_option: 'A' }
  ]
  const answers = { 1: 'A', 2: 'B', 3: 'C', 4: 'D', 5: 'A' }
  const r = scoreQuiz(questions, answers, 60)
  assert.equal(r.score, 100)
  assert.equal(r.correct, 5)
  assert.equal(r.passed, true)
})

test('scoreQuiz: 3/5 = 60 passes; 2/5 = 40 fails (threshold 60)', () => {
  const questions = [
    { id: 1, correct_option: 'A' }, { id: 2, correct_option: 'B' },
    { id: 3, correct_option: 'C' }, { id: 4, correct_option: 'D' }, { id: 5, correct_option: 'A' }
  ]
  assert.equal(scoreQuiz(questions, { 1:'A', 2:'B', 3:'C', 4:'X', 5:'X' }, 60).score, 60)
  assert.equal(scoreQuiz(questions, { 1:'A', 2:'B', 3:'C', 4:'X', 5:'X' }, 60).passed, true)
  assert.equal(scoreQuiz(questions, { 1:'A', 2:'B', 3:'X', 4:'X', 5:'X' }, 60).passed, false)
})

test('scoreQuiz: missing/extra answers are ignored safely', () => {
  const questions = [{ id: 1, correct_option: 'A' }, { id: 2, correct_option: 'B' }]
  const r = scoreQuiz(questions, { 1: 'A', 99: 'Z' }, 60)
  assert.equal(r.correct, 1)
  assert.equal(r.score, 50)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/ted-quiz.test.js`
Expected: FAIL — `scoreQuiz is not a function` / module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// src/utils/tedQuiz.utils.js
// Pure helpers for TED quiz logic. No DB, no side effects (unit-testable).

/**
 * Grade a quiz. `questions` = the drawn questions [{id, correct_option}], `answers` = {questionId: 'A'..'D'}.
 * Score is percent over the number of drawn questions. passed = score >= threshold.
 */
export function scoreQuiz(questions, answers, passThreshold = 60) {
  const list = Array.isArray(questions) ? questions : []
  const total = list.length
  let correct = 0
  for (const q of list) {
    const given = String(answers?.[q.id] ?? '').trim().toUpperCase()
    if (given && given === String(q.correct_option).trim().toUpperCase()) correct++
  }
  const score = total > 0 ? Math.round((correct / total) * 10000) / 100 : 0
  return { correct, total, score, passed: score >= passThreshold }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/ted-quiz.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/tedQuiz.utils.js tests/ted-quiz.test.js
git commit -m "feat(ted): scoreQuiz pure helper + tests"
```

### Task 1.2: `drawRandomQuestions` — pick N from pool (seeded)

**Files:**
- Modify: `src/utils/tedQuiz.utils.js`
- Test: `tests/ted-quiz.test.js`

- [ ] **Step 1: Add failing tests**

```js
import { drawRandomQuestions } from '../src/utils/tedQuiz.utils.js'

test('drawRandomQuestions: returns N items, all from the pool, no repeats', () => {
  const pool = Array.from({ length: 12 }, (_, i) => ({ id: i + 1 }))
  const picked = drawRandomQuestions(pool, 5, 'seed-1')
  assert.equal(picked.length, 5)
  const ids = picked.map(p => p.id)
  assert.equal(new Set(ids).size, 5)            // no repeats
  ids.forEach(id => assert.ok(id >= 1 && id <= 12))
})

test('drawRandomQuestions: same seed = same draw (deterministic), different seed usually differs', () => {
  const pool = Array.from({ length: 12 }, (_, i) => ({ id: i + 1 }))
  const a = drawRandomQuestions(pool, 5, 'seed-1').map(p => p.id)
  const b = drawRandomQuestions(pool, 5, 'seed-1').map(p => p.id)
  assert.deepEqual(a, b)
})

test('drawRandomQuestions: pool smaller than N returns whole pool', () => {
  const pool = [{ id: 1 }, { id: 2 }]
  assert.equal(drawRandomQuestions(pool, 5, 's').length, 2)
})
```

- [ ] **Step 2: Run to verify fail**

Run: `node --test tests/ted-quiz.test.js`
Expected: FAIL — `drawRandomQuestions is not a function`.

- [ ] **Step 3: Implement**

```js
// Append to src/utils/tedQuiz.utils.js

/** Deterministic string hash → 32-bit int (for seeded shuffle). */
function hashSeed(seed) {
  let h = 2166136261
  const s = String(seed)
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

/** Mulberry32 PRNG — deterministic from a numeric seed. */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Pick N items from `pool` using a seeded Fisher–Yates shuffle. Same seed → same result. */
export function drawRandomQuestions(pool, n, seed) {
  const arr = Array.isArray(pool) ? pool.slice() : []
  const rand = mulberry32(hashSeed(seed))
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr.slice(0, Math.min(n, arr.length))
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/ted-quiz.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/tedQuiz.utils.js tests/ted-quiz.test.js
git commit -m "feat(ted): seeded drawRandomQuestions + tests"
```

### Task 1.3: `normalizeGeneratedQuestions` — validate/clean AI output

**Files:**
- Modify: `src/utils/tedQuiz.utils.js`
- Test: `tests/ted-quiz.test.js`

- [ ] **Step 1: Add failing tests**

```js
import { normalizeGeneratedQuestions } from '../src/utils/tedQuiz.utils.js'

test('normalizeGeneratedQuestions: maps correctIndex→letter, keeps only valid 4-option MCQs', () => {
  const raw = [
    { question: 'Q1', options: ['a', 'b', 'c', 'd'], correctIndex: 0 },
    { question: 'Q2', options: ['a', 'b', 'c', 'd'], correctIndex: 3 },
    { question: 'bad', options: ['only', 'two'], correctIndex: 0 },   // dropped: not 4 options
    { question: '', options: ['a', 'b', 'c', 'd'], correctIndex: 1 }   // dropped: empty question
  ]
  const out = normalizeGeneratedQuestions(raw)
  assert.equal(out.length, 2)
  assert.deepEqual(out[0], { question: 'Q1', option_a: 'a', option_b: 'b', option_c: 'c', option_d: 'd', correct_option: 'A' })
  assert.equal(out[1].correct_option, 'D')
})

test('normalizeGeneratedQuestions: out-of-range correctIndex is dropped', () => {
  const out = normalizeGeneratedQuestions([{ question: 'Q', options: ['a','b','c','d'], correctIndex: 9 }])
  assert.equal(out.length, 0)
})
```

- [ ] **Step 2: Run to verify fail**

Run: `node --test tests/ted-quiz.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

```js
// Append to src/utils/tedQuiz.utils.js
const LETTERS = ['A', 'B', 'C', 'D']

/** Validate + normalize the AI's MCQ array into DB rows. Drops malformed entries. */
export function normalizeGeneratedQuestions(raw) {
  const list = Array.isArray(raw) ? raw : []
  const out = []
  for (const q of list) {
    const question = String(q?.question ?? '').trim()
    const options = Array.isArray(q?.options) ? q.options.map((o) => String(o ?? '').trim()) : []
    const idx = Number(q?.correctIndex)
    if (!question) continue
    if (options.length !== 4 || options.some((o) => !o)) continue
    if (!Number.isInteger(idx) || idx < 0 || idx > 3) continue
    out.push({
      question,
      option_a: options[0], option_b: options[1], option_c: options[2], option_d: options[3],
      correct_option: LETTERS[idx]
    })
  }
  return out
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/ted-quiz.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/tedQuiz.utils.js tests/ted-quiz.test.js
git commit -m "feat(ted): normalizeGeneratedQuestions + tests"
```

---

## Phase 2 — AI layer & PPTX extraction

### Task 2.1: PPTX → text (`officeparser`)

**Files:**
- Create: `src/utils/pptxText.js`

- [ ] **Step 1: Implement**

```js
// src/utils/pptxText.js
import { parseOfficeAsync } from 'officeparser'

/**
 * Extract plain text from a PPTX (or PDF/DOCX) buffer. Returns '' on failure (caller decides
 * whether to block or let HR add questions manually).
 */
export async function extractPresentationText(buffer) {
  if (!buffer || !buffer.length) return ''
  try {
    const text = await parseOfficeAsync(buffer)
    return String(text || '').trim()
  } catch (err) {
    console.error('[TED] PPTX text extraction failed:', err?.message)
    return ''
  }
}
```

- [ ] **Step 2: Verify syntax**

Run: `node --check src/utils/pptxText.js`
Expected: no output (OK).

- [ ] **Step 3: Manual smoke test (with any .pptx on disk)**

Run: `node -e "import('./src/utils/pptxText.js').then(async m=>{const fs=await import('fs');const b=fs.readFileSync(process.argv[1]);console.log((await m.extractPresentationText(b)).slice(0,200))})" path/to/sample.pptx`
Expected: prints the first 200 chars of extracted slide text.

- [ ] **Step 4: Commit**

```bash
git add src/utils/pptxText.js
git commit -m "feat(ted): PPTX text extraction util"
```

### Task 2.2: AI quiz generation (`config/aiQuiz.js`, Gemini REST, provider-agnostic)

**Files:**
- Create: `config/aiQuiz.js`

- [ ] **Step 1: Implement**

```js
// config/aiQuiz.js
// Provider-agnostic AI quiz generation. Phase 1 = Gemini via REST (X-goog-api-key header).
// Switching to a self-hosted model later (Ollama/Qwen) is config-only via AI_* env.
import { normalizeGeneratedQuestions } from '../src/utils/tedQuiz.utils.js'

const PROVIDER = (process.env.AI_PROVIDER || 'gemini').toLowerCase()
const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.AI_API_KEY || ''
const GEMINI_MODEL = process.env.GEMINI_MODEL || process.env.AI_MODEL || 'gemini-flash-latest'

const QUESTION_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      question: { type: 'STRING' },
      options: { type: 'ARRAY', items: { type: 'STRING' } },
      correctIndex: { type: 'INTEGER' }
    },
    required: ['question', 'options', 'correctIndex']
  }
}

function buildPrompt(presentationText, count) {
  return [
    `You are creating a training quiz. From the TRAINING MATERIAL below, write exactly ${count} multiple-choice questions.`,
    `Rules: each question has exactly 4 options; exactly one is correct; "correctIndex" is the 0-based index of the correct option;`,
    `questions must be answerable from the material; avoid trick/ambiguous wording.`,
    ``,
    `TRAINING MATERIAL:`,
    presentationText.slice(0, 20000) // cap to keep the request bounded
  ].join('\n')
}

async function generateWithGemini(presentationText, count) {
  if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY is not set')
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`
  const body = {
    contents: [{ parts: [{ text: buildPrompt(presentationText, count) }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: QUESTION_SCHEMA }
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-goog-api-key': GEMINI_KEY },
    body: JSON.stringify(body)
  })
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const data = await res.json()
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '[]'
  let parsed
  try { parsed = JSON.parse(text) } catch { throw new Error('Gemini returned non-JSON content') }
  return parsed
}

/**
 * Generate `count` MCQs from presentation text. Returns normalized DB-ready rows
 * [{question, option_a..d, correct_option}]. Throws on provider/network errors so the
 * caller can surface "AI failed — add questions manually".
 */
export async function generateQuizQuestions(presentationText, count = 12) {
  if (!presentationText || !presentationText.trim()) {
    throw new Error('No presentation text to generate questions from')
  }
  let raw
  if (PROVIDER === 'gemini') raw = await generateWithGemini(presentationText, count)
  else throw new Error(`Unsupported AI_PROVIDER: ${PROVIDER}`)
  return normalizeGeneratedQuestions(raw)
}
```

- [ ] **Step 2: Verify syntax**

Run: `node --check config/aiQuiz.js`
Expected: no output (OK).

- [ ] **Step 3: Manual smoke test (real Gemini call)**

Run: `node -e "import('./config/aiQuiz.js').then(async m=>{const q=await m.generateQuizQuestions('Workplace safety: always wear a helmet on site. Report hazards to your supervisor. Fire exits must stay clear.', 5); console.log(JSON.stringify(q,null,2))})"`
Expected: a JSON array of ~5 objects each with `question, option_a..d, correct_option`.

- [ ] **Step 4: Commit**

```bash
git add config/aiQuiz.js
git commit -m "feat(ted): provider-agnostic AI quiz generation (Gemini REST)"
```

---

## Phase 3 — Repository

### Task 3.1: Session + question CRUD

**Files:**
- Create: `src/repositories/ted.repository.js`

- [ ] **Step 1: Implement session + question functions**

```js
// src/repositories/ted.repository.js
import { executeQuery } from '../../config/database.js'

// ---------- sessions ----------
export async function createSession({ title, presentationFile, presentationText, scheduledAt, passThreshold, maxAttempts, createdBy }) {
  const rows = await executeQuery(
    `INSERT INTO ted_session (title, presentation_file, presentation_text, scheduled_at, pass_threshold, max_attempts, created_by)
     VALUES ($1,$2,$3,$4,COALESCE($5,60),$6,$7) RETURNING *`,
    [title, presentationFile || null, presentationText || null, scheduledAt, passThreshold ?? null, maxAttempts ?? null, createdBy ?? null]
  )
  return rows[0]
}

export async function getSessionById(id) {
  const rows = await executeQuery(`SELECT * FROM ted_session WHERE id = $1`, [id])
  return rows[0] || null
}

export async function listSessions() {
  return executeQuery(`SELECT * FROM ted_session ORDER BY created_at DESC`)
}

export async function updateSessionStatus(id, status) {
  await executeQuery(`UPDATE ted_session SET status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [id, status])
}

export async function reopenSession(id, scheduledAt) {
  const rows = await executeQuery(
    `UPDATE ted_session SET cycle_no = cycle_no + 1, status = 'published', scheduled_at = $2, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 RETURNING *`,
    [id, scheduledAt]
  )
  return rows[0] || null
}

// ---------- question pool ----------
export async function replaceQuestionPool(sessionId, questions) {
  // Used after AI generation: clear AI questions, insert fresh. HR-added (source='hr') are preserved.
  await executeQuery(`DELETE FROM ted_question_pool WHERE session_id = $1 AND source = 'ai'`, [sessionId])
  for (const q of questions) {
    await executeQuery(
      `INSERT INTO ted_question_pool (session_id, question, option_a, option_b, option_c, option_d, correct_option, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'ai')`,
      [sessionId, q.question, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_option]
    )
  }
}

export async function listQuestions(sessionId, activeOnly = false) {
  const clause = activeOnly ? 'AND is_active = TRUE' : ''
  return executeQuery(`SELECT * FROM ted_question_pool WHERE session_id = $1 ${clause} ORDER BY id ASC`, [sessionId])
}

export async function upsertQuestion(q) {
  if (q.id) {
    const rows = await executeQuery(
      `UPDATE ted_question_pool SET question=$2, option_a=$3, option_b=$4, option_c=$5, option_d=$6, correct_option=$7, is_active=$8
       WHERE id=$1 RETURNING *`,
      [q.id, q.question, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_option, q.is_active !== false]
    )
    return rows[0]
  }
  const rows = await executeQuery(
    `INSERT INTO ted_question_pool (session_id, question, option_a, option_b, option_c, option_d, correct_option, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'hr') RETURNING *`,
    [q.session_id, q.question, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_option]
  )
  return rows[0]
}

export async function countActiveQuestions(sessionId) {
  const r = await executeQuery(`SELECT COUNT(*)::int AS c FROM ted_question_pool WHERE session_id=$1 AND is_active=TRUE`, [sessionId])
  return r[0]?.c ?? 0
}
```

- [ ] **Step 2: Verify syntax**

Run: `node --check src/repositories/ted.repository.js`
Expected: OK.

- [ ] **Step 3: Commit**

```bash
git add src/repositories/ted.repository.js
git commit -m "feat(ted): repository — session + question pool CRUD"
```

### Task 3.2: Eligible-employee selection + assignments + attempts

**Files:**
- Modify: `src/repositories/ted.repository.js`

- [ ] **Step 1: Add selection + assignment + attempt functions**

```js
// Append to src/repositories/ted.repository.js

/**
 * Eligible employees per department for a session: active, NOT HOD/CEO/Committee, and NOT already
 * passed this session. Returns rows {employee_id, department_id}. HOD = present in
 * employee_hod_departments OR employee_type/designation 'HOD'. CEO/Committee = employee_type/designation.
 */
export async function getEligibleEmployeesByDepartment(sessionId) {
  return executeQuery(
    `SELECT e.employee_id, e.department_id
       FROM employees e
       LEFT JOIN employee_type et ON e.employee_type_id = et.emp_type_id
       LEFT JOIN designation d ON e.designation_id = d.desg_id
      WHERE e.is_active = TRUE
        AND e.department_id IS NOT NULL
        AND COALESCE(et.emp_type_name,'') NOT IN ('HOD','CEO','Committee')
        AND COALESCE(d.desg_name,'') NOT IN ('HOD','CEO','Committee')
        AND e.employee_id NOT IN (SELECT employee_id FROM employee_hod_departments)
        AND e.employee_id NOT IN (
          SELECT employee_id FROM ted_assignment WHERE session_id = $1 AND status = 'passed'
        )`,
    [sessionId]
  )
}

export async function upsertAssignment(sessionId, employeeId, cycleNo) {
  await executeQuery(
    `INSERT INTO ted_assignment (session_id, employee_id, status, current_cycle)
     VALUES ($1,$2,'assigned',$3)
     ON CONFLICT (session_id, employee_id)
     DO UPDATE SET status='assigned', current_cycle=$3, updated_at=CURRENT_TIMESTAMP`,
    [sessionId, employeeId, cycleNo]
  )
}

export async function reactivateFailedAssignments(sessionId, cycleNo) {
  await executeQuery(
    `UPDATE ted_assignment SET status='assigned', current_cycle=$2, updated_at=CURRENT_TIMESTAMP
     WHERE session_id=$1 AND status='failed'`,
    [sessionId, cycleNo]
  )
}

export async function getAssignment(sessionId, employeeId) {
  const rows = await executeQuery(
    `SELECT * FROM ted_assignment WHERE session_id=$1 AND employee_id=$2`, [sessionId, employeeId]
  )
  return rows[0] || null
}

export async function listAssignmentsForSession(sessionId) {
  return executeQuery(
    `SELECT a.*, e.first_name, e.last_name, e.employee_code, dep.department_name
       FROM ted_assignment a
       JOIN employees e ON e.employee_id = a.employee_id
       LEFT JOIN departments dep ON dep.department_id = e.department_id
      WHERE a.session_id = $1 ORDER BY dep.department_name, e.first_name`,
    [sessionId]
  )
}

export async function listAssignmentsForEmployee(employeeId) {
  return executeQuery(
    `SELECT a.*, s.title, s.scheduled_at, s.status AS session_status, s.cycle_no AS session_cycle, s.pass_threshold
       FROM ted_assignment a JOIN ted_session s ON s.id = a.session_id
      WHERE a.employee_id = $1 ORDER BY s.scheduled_at DESC`,
    [employeeId]
  )
}

export async function setAssignmentResult(assignmentId, status, bestScore) {
  await executeQuery(
    `UPDATE ted_assignment SET status=$2,
       best_score = GREATEST(COALESCE(best_score,0), $3), updated_at=CURRENT_TIMESTAMP
     WHERE id=$1`,
    [assignmentId, status, bestScore]
  )
}

export async function insertAttempt({ assignmentId, cycleNo, questionIds, answers, score, passed }) {
  const rows = await executeQuery(
    `INSERT INTO ted_attempt (assignment_id, cycle_no, question_ids, answers, score, passed)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [assignmentId, cycleNo, questionIds, JSON.stringify(answers), score, passed]
  )
  return rows[0]
}

export async function getQuestionsByIds(ids) {
  if (!ids || !ids.length) return []
  return executeQuery(`SELECT * FROM ted_question_pool WHERE id = ANY($1)`, [ids])
}
```

- [ ] **Step 2: Verify syntax**

Run: `node --check src/repositories/ted.repository.js`
Expected: OK.

- [ ] **Step 3: Manual check — eligibility query runs**

Run: `node -e "import('./src/repositories/ted.repository.js').then(async m=>{console.log((await m.getEligibleEmployeesByDepartment(0)).length + ' eligible (no passed yet for session 0)')})"`
Expected: prints a number (no SQL error). (Confirms column names match this DB.)

- [ ] **Step 4: Commit**

```bash
git add src/repositories/ted.repository.js
git commit -m "feat(ted): repository — selection, assignments, attempts"
```

---

## Phase 4 — Service

### Task 4.1: Create session (with PPTX text extraction)

**Files:**
- Create: `src/services/ted.service.js`

- [ ] **Step 1: Implement createSession + listSessions + getSession**

```js
// src/services/ted.service.js
import * as repo from '../repositories/ted.repository.js'
import * as notifSvc from './notification.service.js'
import { generateQuizQuestions } from '../../config/aiQuiz.js'
import { extractPresentationText } from '../utils/pptxText.js'
import { scoreQuiz, drawRandomQuestions } from '../utils/tedQuiz.utils.js'

const QUIZ_SIZE = 5
const POOL_SIZE = 12

export async function createSession({ title, scheduledAt, passThreshold, pptxBuffer, pptxFileRef, createdBy }) {
  if (!title || !String(title).trim()) return { error: 'Title is required', status: 400 }
  if (!scheduledAt) return { error: 'Scheduled training time is required', status: 400 }
  const presentationText = pptxBuffer ? await extractPresentationText(pptxBuffer) : ''
  const session = await repo.createSession({
    title: String(title).trim(),
    presentationFile: pptxFileRef || null,
    presentationText,
    scheduledAt,
    passThreshold: passThreshold ?? 60,
    maxAttempts: null,
    createdBy
  })
  return { session }
}

export async function listSessions() { return { sessions: await repo.listSessions() } }

export async function getSession(id) {
  const session = await repo.getSessionById(id)
  if (!session) return { error: 'Session not found', status: 404 }
  const questions = await repo.listQuestions(id)
  return { session, questions }
}
```

- [ ] **Step 2: Verify syntax**

Run: `node --check src/services/ted.service.js`
Expected: OK.

- [ ] **Step 3: Commit**

```bash
git add src/services/ted.service.js
git commit -m "feat(ted): service — create/list/get session"
```

### Task 4.2: Generate quiz + question review

**Files:**
- Modify: `src/services/ted.service.js`

- [ ] **Step 1: Add generateQuiz + saveQuestion**

```js
// Append to src/services/ted.service.js

export async function generateQuiz(sessionId) {
  const session = await repo.getSessionById(sessionId)
  if (!session) return { error: 'Session not found', status: 404 }
  if (!session.presentation_text || !session.presentation_text.trim()) {
    return { error: 'No presentation text extracted. Upload a text-based PPTX or add questions manually.', status: 400 }
  }
  try {
    const questions = await generateQuizQuestions(session.presentation_text, POOL_SIZE)
    if (!questions.length) return { error: 'AI returned no valid questions. Add questions manually.', status: 502 }
    await repo.replaceQuestionPool(sessionId, questions)
    return { questions: await repo.listQuestions(sessionId) }
  } catch (err) {
    console.error('[TED] generateQuiz failed:', err?.message)
    return { error: `AI generation failed: ${err?.message}. You can add questions manually.`, status: 502 }
  }
}

export async function saveQuestion(q) {
  if (!q?.question || !q?.option_a || !q?.option_b || !q?.option_c || !q?.option_d) {
    return { error: 'Question and all 4 options are required', status: 400 }
  }
  if (!['A', 'B', 'C', 'D'].includes(String(q.correct_option).toUpperCase())) {
    return { error: 'correct_option must be A, B, C, or D', status: 400 }
  }
  const saved = await repo.upsertQuestion({ ...q, correct_option: String(q.correct_option).toUpperCase() })
  return { question: saved }
}
```

- [ ] **Step 2: Verify syntax**

Run: `node --check src/services/ted.service.js`
Expected: OK.

- [ ] **Step 3: Commit**

```bash
git add src/services/ted.service.js
git commit -m "feat(ted): service — AI quiz generation + question edit"
```

### Task 4.3: Publish (select employees + activate) and reopen

**Files:**
- Modify: `src/services/ted.service.js`

- [ ] **Step 1: Add publish + reopen + selection**

```js
// Append to src/services/ted.service.js

/** Random 2 eligible employees per department → assignments for the given cycle. */
async function selectAndAssign(sessionId, cycleNo) {
  const eligible = await repo.getEligibleEmployeesByDepartment(sessionId)
  const byDept = new Map()
  for (const e of eligible) {
    if (!byDept.has(e.department_id)) byDept.set(e.department_id, [])
    byDept.get(e.department_id).push(e.employee_id)
  }
  const picked = []
  for (const [, ids] of byDept) {
    // shuffle (Fisher–Yates) then take 2
    for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]] }
    picked.push(...ids.slice(0, 2))
  }
  for (const empId of picked) await repo.upsertAssignment(sessionId, empId, cycleNo)
  return picked
}

export async function publishSession(sessionId) {
  const session = await repo.getSessionById(sessionId)
  if (!session) return { error: 'Session not found', status: 404 }
  const activeCount = await repo.countActiveQuestions(sessionId)
  if (activeCount < QUIZ_SIZE) {
    return { error: `Need at least ${QUIZ_SIZE} active questions to publish (have ${activeCount}).`, status: 400 }
  }
  await repo.updateSessionStatus(sessionId, 'published')
  const assigned = await selectAndAssign(sessionId, session.cycle_no)
  // notify assignees
  for (const empId of assigned) {
    notifSvc.notifySafe(notifSvc.notify({
      recipientEmployeeId: empId, type: 'ted_assigned',
      title: 'Training assigned', body: `You are assigned to training: ${session.title}. Quiz unlocks after the session time.`,
      url: '/my-trainings', relatedEntityType: 'ted_session', relatedEntityId: sessionId
    }))
  }
  return { message: 'Session published', assignedCount: assigned.length }
}

export async function reopenSession(sessionId, scheduledAt) {
  const session = await repo.getSessionById(sessionId)
  if (!session) return { error: 'Session not found', status: 404 }
  if (!scheduledAt) return { error: 'New scheduled time is required', status: 400 }
  const updated = await repo.reopenSession(sessionId, scheduledAt)
  await repo.reactivateFailedAssignments(sessionId, updated.cycle_no)
  // re-select to top up to 2 per dept (passed employees are excluded by the eligibility query)
  await selectAndAssign(sessionId, updated.cycle_no)
  return { message: 'Session re-opened for retakes', cycle: updated.cycle_no }
}

export async function getAssignmentsDashboard(sessionId) {
  return { assignments: await repo.listAssignmentsForSession(sessionId) }
}
```

- [ ] **Step 2: Verify syntax**

Run: `node --check src/services/ted.service.js`
Expected: OK.

- [ ] **Step 3: Commit**

```bash
git add src/services/ted.service.js
git commit -m "feat(ted): service — publish (select+assign), reopen, dashboard"
```

### Task 4.4: Employee quiz — fetch & submit (scoring)

**Files:**
- Modify: `src/services/ted.service.js`

- [ ] **Step 1: Add getQuizForEmployee + submitQuiz + myTrainings**

```js
// Append to src/services/ted.service.js

function quizUnlocked(session) {
  return session.status === 'published' && new Date() >= new Date(session.scheduled_at)
}

/** Draw 5 questions for this employee's attempt. Seed = assignmentId+cycle+attempt-count so a
 *  re-fetch within the same pending attempt is stable, but each new cycle differs. */
export async function getQuizForEmployee(sessionId, employeeId) {
  const session = await repo.getSessionById(sessionId)
  if (!session) return { error: 'Session not found', status: 404 }
  const assignment = await repo.getAssignment(sessionId, employeeId)
  if (!assignment || assignment.status === 'passed') return { error: 'No active quiz for you on this session', status: 403 }
  if (assignment.current_cycle !== session.cycle_no) return { error: 'Quiz not open for the current cycle', status: 403 }
  if (!quizUnlocked(session)) return { error: 'Quiz unlocks after the training session time', status: 403 }
  const pool = await repo.listQuestions(sessionId, true)
  const drawn = drawRandomQuestions(pool, QUIZ_SIZE, `${assignment.id}:${session.cycle_no}`)
  // never send correct_option to the client
  const questions = drawn.map((q) => ({
    id: q.id, question: q.question, options: { A: q.option_a, B: q.option_b, C: q.option_c, D: q.option_d }
  }))
  return { sessionTitle: session.title, questionIds: drawn.map((q) => q.id), questions }
}

export async function submitQuiz(sessionId, employeeId, answers) {
  const session = await repo.getSessionById(sessionId)
  if (!session) return { error: 'Session not found', status: 404 }
  const assignment = await repo.getAssignment(sessionId, employeeId)
  if (!assignment || assignment.status === 'passed') return { error: 'No active quiz for you', status: 403 }
  if (assignment.current_cycle !== session.cycle_no) return { error: 'Quiz not open for the current cycle', status: 403 }
  if (!quizUnlocked(session)) return { error: 'Quiz unlocks after the training session time', status: 403 }
  // re-derive the SAME drawn set server-side (same seed) → scoring is tamper-proof
  const pool = await repo.listQuestions(sessionId, true)
  const drawn = drawRandomQuestions(pool, QUIZ_SIZE, `${assignment.id}:${session.cycle_no}`)
  const result = scoreQuiz(drawn, answers, session.pass_threshold)
  await repo.insertAttempt({
    assignmentId: assignment.id, cycleNo: session.cycle_no,
    questionIds: drawn.map((q) => q.id), answers, score: result.score, passed: result.passed
  })
  await repo.setAssignmentResult(assignment.id, result.passed ? 'passed' : 'failed', result.score)
  notifSvc.notifySafe(notifSvc.notify({
    recipientEmployeeId: employeeId, type: result.passed ? 'ted_passed' : 'ted_failed',
    title: result.passed ? 'Training passed' : 'Training not passed',
    body: result.passed ? `You passed "${session.title}" (${result.score}%).`
                        : `You scored ${result.score}% on "${session.title}". You will retake when HR re-opens it.`,
    url: '/my-trainings', relatedEntityType: 'ted_session', relatedEntityId: sessionId
  }))
  return { score: result.score, passed: result.passed, correct: result.correct, total: result.total }
}

export async function myTrainings(employeeId) {
  const rows = await repo.listAssignmentsForEmployee(employeeId)
  const now = new Date()
  return {
    trainings: rows.map((a) => ({
      sessionId: a.session_id, title: a.title, scheduledAt: a.scheduled_at,
      status: a.status, bestScore: a.best_score, passThreshold: a.pass_threshold,
      quizOpen: a.session_status === 'published' && a.current_cycle === a.session_cycle
        && a.status !== 'passed' && now >= new Date(a.scheduled_at)
    }))
  }
}
```

- [ ] **Step 2: Verify syntax**

Run: `node --check src/services/ted.service.js`
Expected: OK.

- [ ] **Step 3: Commit**

```bash
git add src/services/ted.service.js
git commit -m "feat(ted): service — quiz fetch, submit/scoring, my-trainings"
```

---

## Phase 5 — Controller & routes

### Task 5.1: Controller (with HR/employee authz)

**Files:**
- Create: `src/controllers/ted.controller.js`

- [ ] **Step 1: Implement controller**

```js
// src/controllers/ted.controller.js
import * as tedService from '../services/ted.service.js'
import * as reqRepo from '../repositories/requisition.repository.js'

function actorId(req) { return req.session?.user?.employeeId || req.session?.user?.id || null }

// Mirrors the employeeHistory authz: SuperAdmin, administration perm, profile_update_requests, or HR.
async function isHrOrAdmin(req) {
  const u = req.session?.user
  if (!u) return false
  if (String(u.userType || '').trim().toLowerCase() === 'superadmin') return true
  const perms = Array.isArray(u.permissions) ? u.permissions : []
  if (perms.includes('administration') || perms.includes('profile_update_requests')) return true
  const eid = actorId(req)
  return eid != null && (await reqRepo.isHrMember(eid))
}

const send = (res, result) => result?.error ? res.status(result.status || 400).json({ error: result.error }) : res.json(result)

// ---- HR ----
export async function createSession(req, res) {
  try {
    if (!(await isHrOrAdmin(req))) return res.status(403).json({ error: 'Only HR/Admin can create sessions' })
    const pptxBuffer = req.file?.buffer || null
    const pptxFileRef = req.file ? req.file.originalname : null
    const result = await tedService.createSession({
      title: req.body.title, scheduledAt: req.body.scheduledAt, passThreshold: req.body.passThreshold,
      pptxBuffer, pptxFileRef, createdBy: actorId(req)
    })
    send(res, result)
  } catch (e) { console.error('ted.createSession', e); res.status(500).json({ error: 'Failed to create session' }) }
}

export async function listSessions(req, res) {
  try {
    if (!(await isHrOrAdmin(req))) return res.status(403).json({ error: 'Forbidden' })
    send(res, await tedService.listSessions())
  } catch (e) { console.error('ted.listSessions', e); res.status(500).json({ error: 'Failed' }) }
}

export async function getSession(req, res) {
  try {
    if (!(await isHrOrAdmin(req))) return res.status(403).json({ error: 'Forbidden' })
    send(res, await tedService.getSession(parseInt(req.params.id, 10)))
  } catch (e) { console.error('ted.getSession', e); res.status(500).json({ error: 'Failed' }) }
}

export async function generateQuiz(req, res) {
  try {
    if (!(await isHrOrAdmin(req))) return res.status(403).json({ error: 'Forbidden' })
    send(res, await tedService.generateQuiz(parseInt(req.params.id, 10)))
  } catch (e) { console.error('ted.generateQuiz', e); res.status(500).json({ error: 'Failed' }) }
}

export async function saveQuestion(req, res) {
  try {
    if (!(await isHrOrAdmin(req))) return res.status(403).json({ error: 'Forbidden' })
    send(res, await tedService.saveQuestion({ ...req.body, session_id: parseInt(req.params.id, 10) }))
  } catch (e) { console.error('ted.saveQuestion', e); res.status(500).json({ error: 'Failed' }) }
}

export async function publishSession(req, res) {
  try {
    if (!(await isHrOrAdmin(req))) return res.status(403).json({ error: 'Forbidden' })
    send(res, await tedService.publishSession(parseInt(req.params.id, 10)))
  } catch (e) { console.error('ted.publishSession', e); res.status(500).json({ error: 'Failed' }) }
}

export async function reopenSession(req, res) {
  try {
    if (!(await isHrOrAdmin(req))) return res.status(403).json({ error: 'Forbidden' })
    send(res, await tedService.reopenSession(parseInt(req.params.id, 10), req.body.scheduledAt))
  } catch (e) { console.error('ted.reopenSession', e); res.status(500).json({ error: 'Failed' }) }
}

export async function assignmentsDashboard(req, res) {
  try {
    if (!(await isHrOrAdmin(req))) return res.status(403).json({ error: 'Forbidden' })
    send(res, await tedService.getAssignmentsDashboard(parseInt(req.params.id, 10)))
  } catch (e) { console.error('ted.assignments', e); res.status(500).json({ error: 'Failed' }) }
}

// ---- Employee (own data) ----
export async function myTrainings(req, res) {
  try {
    const eid = actorId(req)
    if (eid == null) return res.status(401).json({ error: 'Not logged in' })
    send(res, await tedService.myTrainings(eid))
  } catch (e) { console.error('ted.myTrainings', e); res.status(500).json({ error: 'Failed' }) }
}

export async function getQuiz(req, res) {
  try {
    const eid = actorId(req)
    if (eid == null) return res.status(401).json({ error: 'Not logged in' })
    send(res, await tedService.getQuizForEmployee(parseInt(req.params.id, 10), eid))
  } catch (e) { console.error('ted.getQuiz', e); res.status(500).json({ error: 'Failed' }) }
}

export async function submitQuiz(req, res) {
  try {
    const eid = actorId(req)
    if (eid == null) return res.status(401).json({ error: 'Not logged in' })
    send(res, await tedService.submitQuiz(parseInt(req.params.id, 10), eid, req.body.answers || {}))
  } catch (e) { console.error('ted.submitQuiz', e); res.status(500).json({ error: 'Failed' }) }
}
```

- [ ] **Step 2: Verify syntax**

Run: `node --check src/controllers/ted.controller.js`
Expected: OK.

- [ ] **Step 3: Commit**

```bash
git add src/controllers/ted.controller.js
git commit -m "feat(ted): controller + authz"
```

### Task 5.2: Routes (with multer for PPTX upload) + mount

**Files:**
- Create: `src/routes/ted.routes.js`
- Modify: `src/routes/index.js`, `app.js`

- [ ] **Step 1: Check multer is available**

Run: `node -e "import('multer').then(()=>console.log('multer ok')).catch(()=>console.log('MISSING'))"`
Expected: `multer ok`. If MISSING, run `npm install multer` and commit.

- [ ] **Step 2: Implement routes**

```js
// src/routes/ted.routes.js
import express from 'express'
import multer from 'multer'
import * as ctrl from '../controllers/ted.controller.js'

const router = express.Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } })

// HR
router.post('/sessions', upload.single('presentation'), ctrl.createSession)
router.get('/sessions', ctrl.listSessions)
router.get('/sessions/:id', ctrl.getSession)
router.post('/sessions/:id/generate-quiz', ctrl.generateQuiz)
router.post('/sessions/:id/questions', ctrl.saveQuestion)
router.post('/sessions/:id/publish', ctrl.publishSession)
router.post('/sessions/:id/reopen', ctrl.reopenSession)
router.get('/sessions/:id/assignments', ctrl.assignmentsDashboard)

// Employee
router.get('/my-trainings', ctrl.myTrainings)
router.get('/sessions/:id/quiz', ctrl.getQuiz)
router.post('/sessions/:id/quiz/submit', ctrl.submitQuiz)

export default router
```

- [ ] **Step 3: Export + mount**

In `src/routes/index.js` add:
```js
export { default as tedRoutes } from './ted.routes.js'
```
In `app.js`, with the other route imports add `tedRoutes` to the import from `./src/routes/index.js`, and near the other `app.use('/api/...')` mounts add:
```js
app.use('/api/ted', tedRoutes)
```

- [ ] **Step 4: Verify syntax + server boots**

Run: `node --check src/routes/ted.routes.js && node --check app.js`
Expected: OK. Then start the server (`npm start`) and confirm no boot error.

- [ ] **Step 5: Commit**

```bash
git add src/routes/ted.routes.js src/routes/index.js app.js package.json
git commit -m "feat(ted): routes + mount (/api/ted)"
```

### Task 5.3: End-to-end backend smoke test (manual, curl)

**Files:** none (verification only)

- [ ] **Step 1: With the server running and an HR/SuperAdmin session cookie, create a session**

```bash
# Use the browser devtools cookie or log in via /api/auth/login first; save cookie to cookies.txt
curl -s -b cookies.txt -F "title=Safety 101" -F "scheduledAt=2026-06-29T10:00:00Z" \
  -F "presentation=@sample.pptx" http://localhost:4000/api/ted/sessions
```
Expected: JSON with `session.id`, `presentation_text` non-empty (if the PPTX had text).

- [ ] **Step 2: Generate quiz, then list questions**

```bash
curl -s -b cookies.txt -X POST http://localhost:4000/api/ted/sessions/1/generate-quiz
curl -s -b cookies.txt http://localhost:4000/api/ted/sessions/1
```
Expected: ~12 questions in the pool.

- [ ] **Step 3: Publish, then check assignments**

```bash
curl -s -b cookies.txt -X POST http://localhost:4000/api/ted/sessions/1/publish
curl -s -b cookies.txt http://localhost:4000/api/ted/sessions/1/assignments
```
Expected: `assignedCount` ~2×(#departments with eligible staff); assignments list shows them.

- [ ] **Step 4: As an assigned employee (their cookie), fetch + submit quiz**

```bash
curl -s -b emp_cookies.txt http://localhost:4000/api/ted/sessions/1/quiz
curl -s -b emp_cookies.txt -X POST -H 'Content-Type: application/json' \
  -d '{"answers":{"<id1>":"A","<id2>":"B"}}' http://localhost:4000/api/ted/sessions/1/quiz/submit
```
Expected: 5 questions (no correct_option leaked); submit returns `{score, passed,...}`. (Set `scheduledAt` in the past so the quiz is unlocked.)

- [ ] **Step 5: Commit (notes only, if any fixes were needed)**

```bash
git commit -am "fix(ted): backend e2e adjustments" || echo "no changes"
```

---

## Phase 6 — Scheduling & notifications polish

### Task 6.1: BullMQ quiz-unlock notification (best-effort)

**Files:**
- Modify: `src/services/ted.service.js`

> The quiz-open gate is already correct via `now >= scheduled_at` at request time (no job needed for correctness). This task only adds a *notification* when the time arrives.

- [ ] **Step 1: On publish, enqueue a delayed unlock notification (guarded by BullMQ availability)**

In `publishSession`, after assignments, add:
```js
import { getQueue, isBullMQEnabled } from '../../config/bullmq.js' // add to imports at top of file
// ...
if (isBullMQEnabled()) {
  try {
    const delay = Math.max(0, new Date(session.scheduled_at).getTime() - Date.now())
    await getQueue().add('ted-quiz-unlock', { sessionId, cycleNo: session.cycle_no }, { delay })
  } catch (e) { console.error('[TED] unlock job enqueue failed:', e?.message) }
}
```

- [ ] **Step 2: Add a handler in the existing reminder worker**

In `workers/requisition-reminder-worker.js` (the existing worker that processes the shared queue), add a branch for job name `ted-quiz-unlock` that loads the session's assigned employees for the cycle and calls `notifSvc.notify(...)` with `type: 'ted_quiz_unlocked'`. (Follow the existing job-name switch pattern in that worker.)

- [ ] **Step 3: Verify syntax**

Run: `node --check src/services/ted.service.js && node --check workers/requisition-reminder-worker.js`
Expected: OK.

- [ ] **Step 4: Commit**

```bash
git add src/services/ted.service.js workers/requisition-reminder-worker.js
git commit -m "feat(ted): schedule quiz-unlock notification via BullMQ"
```

---

## Phase 7 — Frontend

### Task 7.1: API client

**Files:**
- Modify: `src/services/api.js` (Emp_Portal_FrontEnd)

- [ ] **Step 1: Add `tedAPI`**

```js
// Append near the other API groups in src/services/api.js
export const tedAPI = {
  listSessions: () => apiCall('/ted/sessions'),
  getSession: (id) => apiCall(`/ted/sessions/${id}`),
  createSession: (formData) => fetch(`${API_BASE_URL}/ted/sessions`, {
    method: 'POST', credentials: 'include', body: formData   // multipart; no JSON Content-Type
  }).then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Failed'); return d }),
  generateQuiz: (id) => apiCall(`/ted/sessions/${id}/generate-quiz`, { method: 'POST' }),
  saveQuestion: (id, q) => apiCall(`/ted/sessions/${id}/questions`, { method: 'POST', body: JSON.stringify(q) }),
  publish: (id) => apiCall(`/ted/sessions/${id}/publish`, { method: 'POST' }),
  reopen: (id, scheduledAt) => apiCall(`/ted/sessions/${id}/reopen`, { method: 'POST', body: JSON.stringify({ scheduledAt }) }),
  assignments: (id) => apiCall(`/ted/sessions/${id}/assignments`),
  myTrainings: () => apiCall('/ted/my-trainings'),
  getQuiz: (id) => apiCall(`/ted/sessions/${id}/quiz`),
  submitQuiz: (id, answers) => apiCall(`/ted/sessions/${id}/quiz/submit`, { method: 'POST', body: JSON.stringify({ answers }) })
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/api.js
git commit -m "feat(ted): frontend API client"
```

### Task 7.2: HR session modal (create + upload + generate + review + publish)

**Files:**
- Create: `src/components/TedSessionModal.jsx`

- [ ] **Step 1: Implement the modal**

Follow the existing modal pattern (`createPortal`, `modal-box`, `react-hot-toast`) used by `BulkAppraisalUploadModal.jsx`. The component:
1. Form: `title`, `scheduledAt` (datetime-local), file input (`.pptx`).
2. On submit → `tedAPI.createSession(formData)` (FormData with `presentation`, `title`, `scheduledAt`). Store returned `session.id`.
3. After creation → "Generate Quiz" button → `tedAPI.generateQuiz(id)` → render the questions list (editable: question, 4 options, a radio for correct option, active toggle) saved individually via `tedAPI.saveQuestion(id, q)`; an "Add question" button for manual entries.
4. "Publish" button → `tedAPI.publish(id)` → toast `assignedCount`; close.

```jsx
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Upload, Sparkles, CheckCircle, Plus } from 'lucide-react'
import toast from 'react-hot-toast'
import { tedAPI } from '../services/api'
import './EmployeeHistoryModal.css'

const emptyQ = (sessionId) => ({ session_id: sessionId, question: '', option_a: '', option_b: '', option_c: '', option_d: '', correct_option: 'A', is_active: true })

export default function TedSessionModal({ onClose, onSaved }) {
  const [step, setStep] = useState('create')       // create | questions
  const [sessionId, setSessionId] = useState(null)
  const [title, setTitle] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [file, setFile] = useState(null)
  const [questions, setQuestions] = useState([])
  const [busy, setBusy] = useState(false)

  async function create() {
    if (!title.trim() || !scheduledAt) { toast.error('Title and time required'); return }
    setBusy(true)
    try {
      const fd = new FormData()
      fd.set('title', title.trim()); fd.set('scheduledAt', new Date(scheduledAt).toISOString())
      if (file) fd.set('presentation', file)
      const { session } = await tedAPI.createSession(fd)
      setSessionId(session.id); setStep('questions')
      toast.success('Session created. Generate or add questions.')
    } catch (e) { toast.error(e.message || 'Failed') } finally { setBusy(false) }
  }
  async function generate() {
    setBusy(true)
    try { const { questions: qs, error } = await tedAPI.generateQuiz(sessionId); if (error) throw new Error(error); setQuestions(qs || []); toast.success(`${(qs||[]).length} questions generated`) }
    catch (e) { toast.error(e.message || 'AI failed — add manually') } finally { setBusy(false) }
  }
  async function saveQ(q) {
    try { const { question } = await tedAPI.saveQuestion(sessionId, q); setQuestions((p) => p.map((x) => x === q ? question : x)); toast.success('Saved') }
    catch (e) { toast.error(e.message || 'Failed') }
  }
  async function publish() {
    setBusy(true)
    try { const r = await tedAPI.publish(sessionId); if (r.error) throw new Error(r.error); toast.success(`Published — ${r.assignedCount} assigned`); onSaved?.(); onClose?.() }
    catch (e) { toast.error(e.message || 'Failed') } finally { setBusy(false) }
  }

  return createPortal(
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal-box" style={{ maxWidth: 760, width: '95%' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header"><h2 style={{ margin: 0 }}>New Training Session</h2>
          <button className="modal-close" onClick={onClose}><X size={20} /></button></div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {step === 'create' && (<>
            <label>Title<input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
            <label>Training time<input type="datetime-local" className="input" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} /></label>
            <label className="btn btn-sm btn-secondary" style={{ cursor: 'pointer' }}><Upload size={14} /> {file ? file.name : 'Choose PPTX'}
              <input type="file" accept=".pptx" style={{ display: 'none' }} onChange={(e) => setFile(e.target.files?.[0] || null)} /></label>
            <button className="btn btn-primary" disabled={busy} onClick={create}>Create</button>
          </>)}
          {step === 'questions' && (<>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-sm btn-secondary" disabled={busy} onClick={generate}><Sparkles size={14} /> Generate with AI</button>
              <button className="btn btn-sm btn-secondary" onClick={() => setQuestions((p) => [...p, emptyQ(sessionId)])}><Plus size={14} /> Add question</button>
            </div>
            <div style={{ maxHeight: 360, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {questions.map((q, i) => (
                <div key={q.id || i} style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 10 }}>
                  <input className="input" placeholder="Question" value={q.question} onChange={(e) => setQuestions((p) => p.map((x, j) => j === i ? { ...x, question: e.target.value } : x))} />
                  {['a', 'b', 'c', 'd'].map((L) => (
                    <div key={L} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                      <input type="radio" name={`correct-${i}`} checked={q.correct_option === L.toUpperCase()} onChange={() => setQuestions((p) => p.map((x, j) => j === i ? { ...x, correct_option: L.toUpperCase() } : x))} />
                      <input className="input" placeholder={`Option ${L.toUpperCase()}`} value={q[`option_${L}`]} onChange={(e) => setQuestions((p) => p.map((x, j) => j === i ? { ...x, [`option_${L}`]: e.target.value } : x))} />
                    </div>
                  ))}
                  <button className="btn btn-sm btn-secondary" style={{ marginTop: 6 }} onClick={() => saveQ(questions[i])}>Save</button>
                </div>
              ))}
            </div>
            <button className="btn btn-primary" disabled={busy} onClick={publish}><CheckCircle size={14} /> Publish &amp; Assign</button>
          </>)}
        </div>
      </div>
    </div>, document.body)
}
```

- [ ] **Step 2: Validate JSX**

Run (frontend dir): `npx --no-install esbuild src/components/TedSessionModal.jsx --jsx=automatic --bundle=false --outdir=%TEMP%/ted-check`
Expected: `JSX OK` (exit 0).

- [ ] **Step 3: Commit**

```bash
git add src/components/TedSessionModal.jsx
git commit -m "feat(ted): HR session modal (create/generate/review/publish)"
```

### Task 7.3: Administration "Training & Development" tab

**Files:**
- Modify: `src/pages/Administration.jsx`

- [ ] **Step 1: Wire the tab + sessions list + dashboard**

1. Import `TedSessionModal` and `tedAPI`; add `{ id: 'ted', label: 'Training & Development', icon: GraduationCap }` to `TABS` (import `GraduationCap` from `lucide-react`).
2. Add state: `tedSessions`, `tedModalOpen`, `tedDashboard`.
3. When `activeTab === 'ted'`, load `tedAPI.listSessions()`; render a table (title, scheduled, status, cycle) with actions: **View assignments** (`tedAPI.assignments(id)` → modal/inline list), **Re-open** (prompt for new datetime → `tedAPI.reopen(id, iso)`).
4. Toolbar "New Session" button → opens `TedSessionModal`; `onSaved` reloads the list.

(Follow the exact tab/table/toolbar pattern already in this file — same as the Employees tab and the Bulk Appraisal button added earlier.)

- [ ] **Step 2: Validate JSX**

Run: `npx --no-install esbuild src/pages/Administration.jsx --jsx=automatic --bundle=false --outdir=%TEMP%/ted-check`
Expected: JSX OK.

- [ ] **Step 3: Commit**

```bash
git add src/pages/Administration.jsx
git commit -m "feat(ted): Administration Training & Development tab"
```

### Task 7.4: Employee "My Trainings" page + quiz modal

**Files:**
- Create: `src/pages/MyTrainings.jsx`, `src/components/TedQuizModal.jsx`
- Modify: `src/App.jsx` (route) + sidebar nav

- [ ] **Step 1: Quiz modal**

```jsx
// src/components/TedQuizModal.jsx
import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import toast from 'react-hot-toast'
import { tedAPI } from '../services/api'
import './EmployeeHistoryModal.css'

export default function TedQuizModal({ sessionId, onClose, onDone }) {
  const [quiz, setQuiz] = useState(null)
  const [answers, setAnswers] = useState({})
  const [busy, setBusy] = useState(false)
  useEffect(() => { (async () => {
    try { const q = await tedAPI.getQuiz(sessionId); if (q.error) throw new Error(q.error); setQuiz(q) }
    catch (e) { toast.error(e.message || 'Cannot open quiz'); onClose?.() }
  })() }, [sessionId])
  async function submit() {
    setBusy(true)
    try { const r = await tedAPI.submitQuiz(sessionId, answers); if (r.error) throw new Error(r.error)
      toast[r.passed ? 'success' : 'error'](`Score ${r.score}% — ${r.passed ? 'Passed' : 'Not passed'}`); onDone?.(); onClose?.() }
    catch (e) { toast.error(e.message || 'Failed') } finally { setBusy(false) }
  }
  if (!quiz) return null
  return createPortal(
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal-box" style={{ maxWidth: 700, width: '95%' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header"><h2 style={{ margin: 0 }}>{quiz.sessionTitle} — Quiz</h2>
          <button className="modal-close" onClick={onClose}><X size={20} /></button></div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14, maxHeight: 460, overflow: 'auto' }}>
          {quiz.questions.map((q, i) => (
            <div key={q.id}>
              <div style={{ fontWeight: 600 }}>{i + 1}. {q.question}</div>
              {Object.entries(q.options).map(([L, text]) => (
                <label key={L} style={{ display: 'block', marginTop: 4 }}>
                  <input type="radio" name={`q-${q.id}`} checked={answers[q.id] === L} onChange={() => setAnswers((p) => ({ ...p, [q.id]: L }))} /> {text}
                </label>
              ))}
            </div>
          ))}
        </div>
        <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 0' }}>
          <button className="btn btn-primary" disabled={busy} onClick={submit}>Submit</button>
        </div>
      </div>
    </div>, document.body)
}
```

- [ ] **Step 2: My Trainings page**

```jsx
// src/pages/MyTrainings.jsx
import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import { tedAPI } from '../services/api'
import TedQuizModal from '../components/TedQuizModal'

export default function MyTrainings() {
  const [items, setItems] = useState([])
  const [quizFor, setQuizFor] = useState(null)
  const load = async () => { try { const r = await tedAPI.myTrainings(); setItems(r.trainings || []) } catch { toast.error('Failed to load') } }
  useEffect(() => { load() }, [])
  return (
    <div style={{ padding: 24 }}>
      <h1>My Trainings</h1>
      {items.length === 0 ? <p>No trainings assigned.</p> : (
        <table className="admin-table">
          <thead><tr><th>Training</th><th>Time</th><th>Status</th><th>Best</th><th></th></tr></thead>
          <tbody>{items.map((t) => (
            <tr key={t.sessionId}>
              <td>{t.title}</td>
              <td>{new Date(t.scheduledAt).toLocaleString()}</td>
              <td>{t.status}</td>
              <td>{t.bestScore != null ? `${t.bestScore}%` : '—'}</td>
              <td>{t.quizOpen ? <button className="btn btn-sm btn-primary" onClick={() => setQuizFor(t.sessionId)}>Take quiz</button>
                  : t.status === 'passed' ? '✓ Passed' : 'Locked'}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {quizFor && <TedQuizModal sessionId={quizFor} onClose={() => setQuizFor(null)} onDone={load} />}
    </div>
  )
}
```

- [ ] **Step 3: Add route + nav**

In `src/App.jsx` add a protected route `path="/my-trainings"` → `<MyTrainings />` (follow the existing route pattern). Add a sidebar/menu link "My Trainings" in the layout nav (follow the existing nav item pattern).

- [ ] **Step 4: Validate JSX**

Run: `npx --no-install esbuild src/pages/MyTrainings.jsx src/components/TedQuizModal.jsx src/App.jsx --jsx=automatic --bundle=false --outdir=%TEMP%/ted-check`
Expected: JSX OK.

- [ ] **Step 5: Commit**

```bash
git add src/pages/MyTrainings.jsx src/components/TedQuizModal.jsx src/App.jsx
git commit -m "feat(ted): employee My Trainings page + quiz modal"
```

### Task 7.5: Full manual UI walkthrough

**Files:** none

- [ ] **Step 1:** As HR: Administration → Training & Development → New Session → upload a text PPTX → Generate with AI → review/edit → Publish. Confirm "X assigned" toast.
- [ ] **Step 2:** As an assigned employee (set session time in the past): My Trainings → Take quiz → submit → see score; if ≥60% status becomes Passed and the quiz button disappears.
- [ ] **Step 3:** As HR: re-open the session (future or past time) → confirm failed employees become `assigned` again and can retake with a different draw.
- [ ] **Step 4:** Confirm a passed employee is NOT re-assigned on re-open.

---

## Self-Review (completed)

- **Spec coverage:** PPTX upload+extract (2.1), Gemini quiz gen + review/fallback (2.2, 4.2, 7.2), 2-random-per-dept excluding HOD/CEO/Committee + already-passed (3.2 query, 4.3 selectAndAssign), quiz unlock after time (4.4 `quizUnlocked`), random-5-from-pool (1.2 + 4.4), scoring/60% (1.1 + 4.4), retake model B / reopen-cycle (4.3 reopen + reactivate), pass-once (eligibility excludes passed; assignment status), notifications (4.3/4.4/6.1), HR + Employee UI (7.x), permissions (5.1 `isHrOrAdmin`). All covered.
- **Placeholder scan:** none — every code step has full code; UI tasks that reference existing patterns (7.3, 7.4 step 3) still specify exact wiring.
- **Type consistency:** `correct_option` letters A–D throughout; `drawRandomQuestions(pool, n, seed)` signature consistent (1.2, 4.4); `scoreQuiz(questions, answers, threshold)` consistent (1.1, 4.4); assignment statuses `assigned|passed|failed` consistent.

## Open items (deferred, per spec)
- `max_attempts` enforcement (schema ready; default unlimited) — add when product decides the limit.
- PPTX with image-only slides → weak/empty quiz (HR adds manually as fallback).
- Self-hosted open-source model — config-only switch later (`AI_PROVIDER`).
