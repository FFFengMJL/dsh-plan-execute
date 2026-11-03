/** Longest diagnostic shown inline before it is truncated. */
export const MAX_ERROR_LENGTH = 180

/** Turn any thrown value into a bounded single-line diagnostic. */
export function describeError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause)
  return message.length > MAX_ERROR_LENGTH ? `${message.slice(0, MAX_ERROR_LENGTH)}…` : message
}
