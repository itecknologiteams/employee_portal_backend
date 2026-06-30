import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scoreQuiz, drawRandomQuestions, normalizeGeneratedQuestions } from '../src/utils/tedQuiz.utils.js'

// ---------- scoreQuiz ----------
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
  assert.equal(scoreQuiz(questions, { 1: 'A', 2: 'B', 3: 'C', 4: 'X', 5: 'X' }, 60).score, 60)
  assert.equal(scoreQuiz(questions, { 1: 'A', 2: 'B', 3: 'C', 4: 'X', 5: 'X' }, 60).passed, true)
  assert.equal(scoreQuiz(questions, { 1: 'A', 2: 'B', 3: 'X', 4: 'X', 5: 'X' }, 60).passed, false)
})

test('scoreQuiz: missing/extra answers are ignored safely', () => {
  const questions = [{ id: 1, correct_option: 'A' }, { id: 2, correct_option: 'B' }]
  const r = scoreQuiz(questions, { 1: 'A', 99: 'Z' }, 60)
  assert.equal(r.correct, 1)
  assert.equal(r.score, 50)
})

// ---------- drawRandomQuestions ----------
test('drawRandomQuestions: returns N items, all from the pool, no repeats', () => {
  const pool = Array.from({ length: 12 }, (_, i) => ({ id: i + 1 }))
  const picked = drawRandomQuestions(pool, 5, 'seed-1')
  assert.equal(picked.length, 5)
  const ids = picked.map(p => p.id)
  assert.equal(new Set(ids).size, 5)
  ids.forEach(id => assert.ok(id >= 1 && id <= 12))
})

test('drawRandomQuestions: same seed = same draw (deterministic)', () => {
  const pool = Array.from({ length: 12 }, (_, i) => ({ id: i + 1 }))
  const a = drawRandomQuestions(pool, 5, 'seed-1').map(p => p.id)
  const b = drawRandomQuestions(pool, 5, 'seed-1').map(p => p.id)
  assert.deepEqual(a, b)
})

test('drawRandomQuestions: pool smaller than N returns whole pool', () => {
  const pool = [{ id: 1 }, { id: 2 }]
  assert.equal(drawRandomQuestions(pool, 5, 's').length, 2)
})

// ---------- normalizeGeneratedQuestions ----------
test('normalizeGeneratedQuestions: maps correctIndex→letter, keeps only valid 4-option MCQs', () => {
  const raw = [
    { question: 'Q1', options: ['a', 'b', 'c', 'd'], correctIndex: 0 },
    { question: 'Q2', options: ['a', 'b', 'c', 'd'], correctIndex: 3 },
    { question: 'bad', options: ['only', 'two'], correctIndex: 0 },
    { question: '', options: ['a', 'b', 'c', 'd'], correctIndex: 1 }
  ]
  const out = normalizeGeneratedQuestions(raw)
  assert.equal(out.length, 2)
  assert.deepEqual(out[0], { question: 'Q1', option_a: 'a', option_b: 'b', option_c: 'c', option_d: 'd', correct_option: 'A' })
  assert.equal(out[1].correct_option, 'D')
})

test('normalizeGeneratedQuestions: out-of-range correctIndex is dropped', () => {
  const out = normalizeGeneratedQuestions([{ question: 'Q', options: ['a', 'b', 'c', 'd'], correctIndex: 9 }])
  assert.equal(out.length, 0)
})
