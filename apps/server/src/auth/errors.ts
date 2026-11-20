/** Missing, invalid or expired login. Routes turn it into 401 { error: { code: "UNAUTHENTICATED" } }. */
export class AuthError extends Error {
  readonly code = "UNAUTHENTICATED";
}
