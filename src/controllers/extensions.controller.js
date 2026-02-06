import * as extensionsService from '../services/extensions.service.js'

export async function getList(req, res) {
  try {
    const extensions = extensionsService.getExtensionsList()
    res.json(extensions)
  } catch (error) {
    console.error('Extensions list error:', error)
    res.status(500).json({ error: 'Failed to fetch extensions' })
  }
}
