import { parseOffice } from 'officeparser'

/**
 * Extract plain text from a PDF (or PPTX/DOCX) buffer. TED uploads are PDF; officeparser parses
 * the text layer of all of these. Returns '' on failure (caller decides whether to block or let
 * HR add questions manually). officeparser exports `parseOffice(input)` → Promise<string>.
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
