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
