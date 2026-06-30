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
