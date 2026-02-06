import * as profileService from '../services/profile.service.js'

export async function getProfile(req, res) {
  try {
    const { employeeId } = req.params
    const profile = await profileService.getProfile(employeeId)
    if (!profile) {
      return res.status(404).json({ error: 'Employee not found' })
    }
    res.json(profile)
  } catch (error) {
    console.error('Profile error:', error)
    res.status(500).json({ error: 'Failed to fetch profile' })
  }
}

export async function updateProfile(req, res) {
  try {
    const { employeeId } = req.params
    const { email, phone, address, bio } = req.body
    await profileService.updateProfile(employeeId, { email, phone, address, bio })
    res.json({ message: 'Profile updated successfully' })
  } catch (error) {
    console.error('Profile update error:', error)
    res.status(500).json({ error: 'Failed to update profile' })
  }
}
