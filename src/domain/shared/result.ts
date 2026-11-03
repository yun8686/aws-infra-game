export type Result<T, E> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/** Deterministic, locale-independent string comparison. */
export const compareIds = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
