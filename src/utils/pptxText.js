import { parseOffice } from 'officeparser'

/**
 * Extract plain text from a PPTX (or PDF/DOCX) buffer. Returns '' on failure (caller decides
 * whether to block or let HR add questions manually).
 * officeparser v5 exports `parseOffice(input, config?)` returning a Promise<string>.
 */
export async function extractPresentationText(buffer) {
  if (!buffer || !buffer.length) return ''
  try {
    const text = await parseOffice(buffer)
    return String(text || '').trim()
  } catch (err) {
    console.error('[TED] PPTX text extraction failed:', err?.message)
    return ''
  }
}
