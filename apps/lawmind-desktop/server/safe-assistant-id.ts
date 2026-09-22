const INVALID_ASSISTANT_ID = /[./\\]/;

export function isSafeAssistantIdSegment(value: string): boolean {
  const id = value.trim();
  return id.length > 0 && !INVALID_ASSISTANT_ID.test(id);
}
