import { createHash } from 'crypto';

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }

  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return entries.reduce<Record<string, unknown>>((acc, [k, v]) => {
      acc[k] = sortKeysDeep(v);
      return acc;
    }, {});
  }

  return value;
}

/**
 * Deterministic hash of a request payload, independent of object key order -- used to detect
 * whether an idempotency key is being replayed with the exact same request or reused for a
 * different one.
 */
export function hashPayload(payload: unknown): string {
  const json = JSON.stringify(sortKeysDeep(payload ?? null));
  return createHash('sha256').update(json).digest('hex');
}
