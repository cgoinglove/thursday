/**
 * A failure whose message is safe to show the client as-is. The boundary
 * (`serverAction`, `serverRoute`) passes the message through instead of masking it.
 */
export class PublicError extends Error {
  constructor(public message: string) {
    super(message);
  }
}

// A function declaration with an explicit `never` return, so TS flow analysis
// treats a call as terminal (`if (!row) publicError(...)` narrows `row`).
export function publicError(message: string): never {
  throw new PublicError(message);
}

export const isPublicError = (err: unknown): err is PublicError => {
  return err instanceof PublicError;
};
