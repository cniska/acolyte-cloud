/** Removes keys with null values from an object, so JSON serialization omits them instead of emitting `null`. */
export function stripNulls<T extends Record<string, unknown>>(obj: T): T {
  const result = {} as Record<string, unknown>;
  for (const [key, value] of Object.entries(obj)) {
    if (value !== null) result[key] = value;
  }
  return result as T;
}
