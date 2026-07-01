// Provider-agnostic AI quiz generation. Phase 1 = Gemini via REST (X-goog-api-key header).
// Switching to a self-hosted model later (Ollama/Qwen) is config-only via AI_* env.
import { normalizeGeneratedQuestions } from '../src/utils/tedQuiz.utils.js'

// NOTE: read env LAZILY inside the functions (not as module-top consts). server.js calls
// dotenv.config() AFTER importing app.js, so this module is evaluated before .env is loaded —
// top-level reads would capture undefined and break with "GEMINI_API_KEY is not set".

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

function buildPrompt(count) {
  return [
    `You are creating a training quiz from the attached training material (a PDF) or the text below.`,
    `Write exactly ${count} multiple-choice questions.`,
    `Rules: each question has exactly 4 options; exactly one is correct; "correctIndex" is the 0-based index of the correct option;`,
    `questions must be answerable from the material; avoid trick/ambiguous wording.`
  ].join('\n')
}

/** Generate questions from a PDF (preferred, multimodal) or plain text. `input` = { pdfBase64 } | { text }. */
async function generateWithGemini(input, count) {
  const key = process.env.GEMINI_API_KEY || process.env.AI_API_KEY || ''
  const model = process.env.GEMINI_MODEL || process.env.AI_MODEL || 'gemini-flash-latest'
  if (!key) throw new Error('GEMINI_API_KEY is not set')
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
  const parts = [{ text: buildPrompt(count) }]
  if (input.pdfBase64) {
    parts.push({ inlineData: { mimeType: 'application/pdf', data: input.pdfBase64 } })
  } else {
    parts.push({ text: 'TRAINING MATERIAL:\n' + String(input.text || '').slice(0, 20000) })
  }
  const body = {
    contents: [{ parts }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: QUESTION_SCHEMA }
  }
  // Retry transient overloads (429/503/5xx) with short backoff — the model can be momentarily busy.
  let res, lastErrText = ''
  for (let attempt = 1; attempt <= 3; attempt++) {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-goog-api-key': key },
      body: JSON.stringify(body)
    })
    if (res.ok) break
    lastErrText = (await res.text()).slice(0, 300)
    const transient = res.status === 429 || res.status >= 500
    if (!transient || attempt === 3) throw new Error(`Gemini HTTP ${res.status}: ${lastErrText}`)
    await new Promise((r) => setTimeout(r, attempt * 1500)) // 1.5s, 3s backoff
  }
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
export async function generateQuizQuestions(input, count = 12) {
  const src = typeof input === 'string' ? { text: input } : (input || {})
  if (!src.pdfBase64 && !String(src.text || '').trim()) {
    throw new Error('No content (PDF or text) to generate questions from')
  }
  const provider = (process.env.AI_PROVIDER || 'gemini').toLowerCase()
  let raw
  if (provider === 'gemini') raw = await generateWithGemini(src, count)
  else throw new Error(`Unsupported AI_PROVIDER: ${provider}`)
  return normalizeGeneratedQuestions(raw)
}
