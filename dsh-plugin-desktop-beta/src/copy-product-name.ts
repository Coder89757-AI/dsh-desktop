/** Product-name substitution shared by the user-facing copy dictionaries.
 *
 * Copy dictionaries stay static and brand-free: they carry the `{product}`
 * token wherever the visible product name belongs, and the resolved name is
 * substituted at call time. That is what lets a single module serve both the
 * Host process — which resolves the name from the packaged branding projection
 * — and the native-ui renderer, which has no filesystem and receives the same
 * string through its document URL. Both sides fall back to the shipped edition
 * name when no brand is configured.
 */

/** Placeholder the copy dictionaries use for the visible product name. */
export const COPY_PRODUCT_TOKEN = '{product}'

/** Substitute the resolved product name into one copy string. */
export function copyText(text: string, productName: string): string {
  return text.replaceAll(COPY_PRODUCT_TOKEN, productName)
}

/**
 * Substitute the resolved product name into one flat copy dictionary.
 *
 * Values may be functions returning copy — several dictionaries interpolate a
 * runtime value into a sentence — so their results are substituted as well.
 */
export function copyWithProductName<T extends object>(copy: T, productName: string): T {
  const rendered: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(copy as Record<string, unknown>)) {
    if (typeof value === 'function') {
      const build = value as (...args: unknown[]) => unknown
      rendered[key] = (...args: unknown[]): unknown => {
        const result = build(...args)
        return typeof result === 'string'
          ? result.replaceAll(COPY_PRODUCT_TOKEN, productName)
          : result
      }
      continue
    }
    rendered[key] = typeof value === 'string' ? copyText(value, productName) : value
  }
  // Every source key is copied through, so the dictionary keeps its shape even
  // though TypeScript cannot prove that for an opaque copy type.
  return rendered as unknown as T
}
