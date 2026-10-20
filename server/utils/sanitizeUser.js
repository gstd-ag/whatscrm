// ============================================================
// SANITIZE USER
// Remove campos sensiveis antes de devolver o usuario ao cliente.
// Use SEMPRE que a rota responder com uma linha de `user` (SELECT *).
// ============================================================

const SENSITIVE_FIELDS = ["password"];

function sanitizeUser(user) {
  if (!user || typeof user !== "object") return user;

  const safe = { ...user };
  for (const field of SENSITIVE_FIELDS) {
    delete safe[field];
  }
  return safe;
}

module.exports = { sanitizeUser, SENSITIVE_FIELDS };
