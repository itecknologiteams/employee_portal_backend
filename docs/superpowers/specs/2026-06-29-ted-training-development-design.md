# TED — Training & Development Module — Design

**Date:** 2026-06-29
**Status:** Draft for review
**Author:** Generated via brainstorming with the product owner

## 1. Overview

TED lets HR run training sessions and verify learning with an auto-generated quiz.
HR uploads a presentation (PPTX); the system extracts its text and uses Google Gemini to
generate a pool of multiple-choice questions. The system randomly assigns a small set of
employees per department to each session. After the scheduled training time, the assigned
employees take a 5-question quiz drawn randomly from the pool. Scoring is automatic; an
employee who scores below the pass threshold (default 60%) must retake the session in the
next cycle until they pass. Once an employee passes a session, they are never re-assigned to it.

## 2. Goals / Non-goals

**Goals**
- HR creates a training session, uploads a PPTX, and schedules a training time.
- Auto-generate a quiz (pool of 10–15 MCQs) from the presentation via Gemini; HR can review/edit/publish.
- Auto-select 2 random **active** employees per department, excluding HOD / CEO / Committee members
  and anyone who has already passed the session.
- Quiz unlocks after the scheduled training time.
- Each attempt draws a random 5 questions from the pool (people may get different subsets).
- Auto-score; ≥ threshold = pass (once), below = fail and retake in a later cycle.

**Non-goals (this phase)**
- Reading non-text/image-only slides (Gemini gets only extracted text).
- Live training delivery inside the portal (training itself happens outside; portal hosts the post-quiz).
- A configured per-session attempt limit is **deferred** (schema supports it; default = unlimited).
- Department-level analytics/reporting beyond the HR assignments+scores dashboard.

## 3. Locked decisions

| # | Decision |
|---|----------|
| 1 | HR uploads **PPTX**. Text is extracted server-side (pure-Node lib, e.g. `officeparser`) → fed to Gemini. |
| 2 | AI = **Google Gemini** via **direct REST** (`X-goog-api-key` header), model `gemini-flash-latest` (configurable; currently resolves to gemini-3.5-flash). Structured JSON output (`responseSchema`). HR reviews/edits before publish (fallback if AI is wrong/unavailable). **Key validated** (HTTP 200). |
| 3 | **Pool of 10–15 MCQs** per session. Each attempt = **random 5** from the pool. Not required that everyone gets the same questions. |
| 4 | Auto-select **2 random active employees per department**, excluding HOD/CEO/Committee and already-passed employees. |
| 5 | Quiz **unlocks after** the session's scheduled training time. |
| 6 | Pass threshold default **60%** (`pass_threshold`, configurable per session). |
| 7 | Retake model **(B)**: a failed employee retakes **only when HR re-holds/re-opens the session** (next cycle). On re-open, failed assignments are re-activated and draw a fresh random 5. |
| 8 | **Pass = per-employee-per-session.** A passed employee is never re-assigned to that session. |
| 9 | `max_attempts` deferred → default **null (unlimited)**; schema-ready for later. |

## 4. Data model

Five tables (`ted_` prefix). All timestamps UTC.

### `ted_session`
- `id` PK
- `title` text
- `presentation_file` text (stored PPTX, same upload pattern as other modules)
- `presentation_text` text (extracted; kept for re-generation/audit)
- `scheduled_at` timestamp (training time; quiz unlocks at/after this)
- `pass_threshold` int default 60
- `max_attempts` int null (unlimited)
- `cycle_no` int default 1 (incremented when HR re-opens for retakes)
- `status` enum: `draft` (created, quiz not yet published) → `published` (quiz live for the cycle) → `closed`
- `created_by`, `created_at`, `updated_at`

### `ted_question_pool`
- `id` PK, `session_id` FK
- `question` text
- `option_a/b/c/d` text
- `correct_option` char (`A`/`B`/`C`/`D`)
- `source` enum: `ai` | `hr` (HR-added/edited)
- `is_active` bool (HR can disable a bad question without deleting)
- `created_at`

### `ted_assignment`
- `id` PK, `session_id` FK, `employee_id` FK
- `status` enum: `assigned` | `passed` | `failed`
- `best_score` numeric (highest % so far)
- `current_cycle` int (which session cycle this assignment is active for)
- `assigned_at`, `updated_at`
- UNIQUE (`session_id`, `employee_id`)

### `ted_attempt`
- `id` PK, `assignment_id` FK
- `cycle_no` int (the session cycle this attempt belongs to)
- `question_ids` int[] (the 5 randomly-drawn pool questions)
- `answers` jsonb (question_id → chosen option)
- `score` numeric (%), `passed` bool
- `attempted_at`

## 5. Lifecycle / state machine

```
HR creates session (draft) ── upload PPTX ──▶ extract text ──▶ Gemini generates pool
        │                                                              │
        ▼                                                              ▼
 auto-select 2 random eligible / dept                       HR reviews/edits pool
        │                                                              │
        └──────────────────────────► HR publishes (status=published) ◄┘
                                                  │
                                   scheduled_at reached (BullMQ) → quiz unlocks
                                                  │
                       employee attempts ──▶ random 5 from pool ──▶ auto-score
                                   │                                    │
                          score ≥ threshold                     score < threshold
                                   │                                    │
                          assignment=passed                    assignment=failed
                          (never re-assigned)                          │
                                                       HR re-opens session (cycle_no++)
                                                       → failed assignments re-activated
                                                       → retake with fresh random 5
```

## 6. Employee selection logic

Runs **at publish** (and again on each re-open, for the new cycle):
1. List all departments.
2. For each department, list `is_active` employees who are **NOT**:
   - HOD (via `employee_hod_departments` or `employee_type`/designation = HOD),
   - CEO (`isCeoMember`), Committee (`isCommitteeMember`),
   - already `passed` this `session_id`.
3. Randomly pick **2** (or fewer if the eligible pool is smaller).
4. Create/refresh `ted_assignment` rows (status `assigned`, `current_cycle = session.cycle_no`).

Reuses existing helpers: `isHodOfDepartment`, `isCeoMember`, `isCommitteeMember`, dept/member queries.

## 7. AI quiz generation

- **PPTX → text:** `officeparser` (pure Node, no external binary) extracts slide text from the uploaded buffer.
- **Provider-agnostic:** all AI calls live behind one module (`config/aiQuiz.js`) driven by env
  (`AI_PROVIDER`, `AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY`). **Phase 1 = Gemini** (key set + validated).
  Switching to a self-hosted open-source model later (e.g. Ollama + Qwen2.5-7B for unlimited/private)
  is a **config change only** — no code changes to the quiz logic.
- **Gemini (current provider):** `config/gemini.js` — **no SDK**, uses Node built-in `fetch` to
  `POST https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`
  with header `X-goog-api-key: ${GEMINI_API_KEY}`. (`gemini-flash-latest`; key format `AQ.…` works on REST.)
  - Prompt: "From this training material, write {N} MCQs (4 options, one correct)…" + extracted text.
  - **Structured output** via `generationConfig.responseMimeType = "application/json"` + `responseSchema`
    → array of `{question, options[4], correctIndex}`. No fragile parsing.
- **HR review:** generated questions land as `draft` pool rows; HR can edit text/options/correct answer, disable, or add their own (`source=hr`) before publishing.
- **Fallback:** if Gemini fails or returns too few, HR adds/edits manually; publish is blocked until ≥ 5 active questions exist.

## 8. Quiz attempt + scoring + retake

- **Unlock gate:** attempt allowed only when `status=published` AND `now ≥ scheduled_at` AND the employee's assignment is `assigned` for `current_cycle = session.cycle_no`.
- **Draw:** server randomly selects 5 active pool questions, records their ids in the attempt (so scoring is server-side and tamper-proof; the client never sees `correct_option`).
- **Score:** `% = correct/5 × 100`. `passed = % ≥ pass_threshold`.
- **On pass:** assignment → `passed`, `best_score` updated. Excluded from all future selection.
- **On fail:** assignment → `failed`, `best_score` updated. Stays out until HR re-opens.
- **Retake (B):** HR "re-opens" the session → `cycle_no++`, status back to `published` with a new `scheduled_at`; failed assignments are set to `assigned` with `current_cycle = new cycle_no`. They retake (fresh random 5) after the new training time.
- **Attempt limit:** if `max_attempts` set, block further attempts in a cycle once reached (deferred; default unlimited).

## 9. Scheduling (BullMQ)

- Reuse existing BullMQ/Redis. On publish, enqueue a delayed job at `scheduled_at` → flips quiz to "open" state and notifies assignees. Fallback (BullMQ disabled): compute open-state from `now ≥ scheduled_at` at request time (no job needed for correctness).
- Optional reminder jobs (e.g., quiz-open, quiz-closing) mirroring the requisition reminder pattern.

## 10. Notifications

Reuse the existing notification service for:
- Assigned to a training session.
- Quiz unlocked (training time reached).
- Result (passed / failed-please-retake).

## 11. API endpoints (sketch)

HR (Administration-gated):
- `POST /api/ted/sessions` (create + PPTX upload)
- `POST /api/ted/sessions/:id/generate-quiz` (run Gemini)
- `GET/PUT /api/ted/sessions/:id/questions` (review/edit pool)
- `POST /api/ted/sessions/:id/publish` (validate ≥5 questions, select employees, schedule)
- `POST /api/ted/sessions/:id/reopen` (new cycle for retakes)
- `GET /api/ted/sessions/:id/assignments` (dashboard: who, status, scores)

Employee:
- `GET /api/ted/my-trainings` (assigned sessions + state)
- `GET /api/ted/sessions/:id/quiz` (draw 5 — only when unlocked; no correct answers sent)
- `POST /api/ted/sessions/:id/quiz/submit` (answers → score)

## 12. UI surfaces

- **HR (Administration):** new "Training & Development" tab — create session, upload PPTX, generate + review/edit questions, publish, re-open, and an assignments/scores dashboard.
- **Employee:** "My Trainings" page — assigned sessions, quiz (after unlock), result/score, retake when re-opened.

## 13. Permissions

- HR/Admin gating consistent with the rest of the app (`isHrMember` / `administration` permission / SuperAdmin), same pattern as the employee-history feature.
- Employee endpoints scoped to the logged-in employee's own assignments.

## 14. Open items (revisit later)

- **Attempt limit per cycle** — value TBD by product owner; schema-ready (`max_attempts`).
- **PPTX with image-only slides** — low text yields weak quizzes; may add OCR later.
- **Department-wide analytics/reports** — future phase.

## 15. New dependencies

- `officeparser` (or equivalent) — PPTX → text. **(only new runtime dep)**
- Gemini: **no SDK** — Node built-in `fetch` to the REST endpoint. Env (already set in `.env`):
  `GEMINI_API_KEY`, `GEMINI_MODEL` (default `gemini-flash-latest`).
