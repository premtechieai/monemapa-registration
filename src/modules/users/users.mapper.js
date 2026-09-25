/**
 * Shape a database profile row into the public API representation.
 * Keeping this in one place means DB column names never leak to clients.
 */
export const toPublicUser = (profile) =>
  profile && {
    id: profile.id,
    email: profile.email,
    fullName: profile.full_name,
    status: profile.status,
    registeredAt: profile.registered_at,
    lastLoginAt: profile.last_login_at,
  };
