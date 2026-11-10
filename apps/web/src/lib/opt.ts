/**
 * Drop undefined props, so optional values can be passed to Astryx components under
 * `exactOptionalPropertyTypes`: `<Button label="Save" {...opt({ isDisabled: busy, icon })} />`.
 */
export function opt<T extends Record<string, unknown>>(o: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out as { [K in keyof T]?: Exclude<T[K], undefined> };
}
