/**
 * Single source of truth for the express-session secret.
 *
 * Both the session middleware (app.js) and the cross-site iframe bearer-token
 * signer (auth.controller ssoConsume) MUST use the exact same secret, or the
 * bridged token won't unsign and the session won't load. Keeping it here avoids
 * the two places drifting.
 */
export const SESSION_SECRET =
  process.env.SESSION_SECRET || 'emp-portal-dev-secret-do-not-use-in-production'
