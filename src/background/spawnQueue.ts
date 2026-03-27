import { type SpawnTabRequest, getSpawnDedupKey } from "../shared";

export function deduplicateSpawnItems(
  items: SpawnTabRequest[],
  maxJobSlots?: number
): SpawnTabRequest[] {
  const seen = new Set<string>();
  const result: SpawnTabRequest[] = [];
  const resultIndexByKey = new Map<string, number>();
  let totalJobSlots = 0;

  for (const item of items) {
    const key = getSpawnDedupKey(item.url);
    if (!key || seen.has(key)) {
      if (key && item.jobSlots && item.jobSlots > 0) {
        const existingIndex = resultIndexByKey.get(key);
        const existing = existingIndex === undefined ? null : result[existingIndex];
        if (existing) {
          const currentSlots = Math.max(0, existing.jobSlots ?? 0);
          const maxAllowedForItem =
            maxJobSlots !== undefined
              ? currentSlots + Math.max(0, maxJobSlots - totalJobSlots)
              : currentSlots + item.jobSlots;
          const nextSlots = Math.min(currentSlots + item.jobSlots, maxAllowedForItem);
          totalJobSlots += Math.max(0, nextSlots - currentSlots);
          existing.jobSlots = nextSlots;
        }
      }
      continue;
    }

    seen.add(key);
    resultIndexByKey.set(key, result.length);
    const newItem = { ...item };
    if (newItem.jobSlots !== undefined && newItem.jobSlots > 0) {
      totalJobSlots += newItem.jobSlots;
    }
    result.push(newItem);
  }

  return result;
}
