type JsonRecord = Record<string, unknown>;

export function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object'
    ? (value as JsonRecord)
    : null;
}

export function unwrapApiData<T>(payload: unknown): T {
  const record = asRecord(payload);

  if (record && record.success === true && 'data' in record) {
    return record.data as T;
  }

  return payload as T;
}
