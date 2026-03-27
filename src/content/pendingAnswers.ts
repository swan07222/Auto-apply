import { SavedAnswer, normalizeQuestionKey } from "../shared";
import { cleanText } from "./text";

export const PENDING_ANSWER_FALLBACK_STORAGE_KEY =
  "remote-job-search-pending-answers-fallback";

const DEFAULT_PENDING_ANSWER_PROFILE_KEY = "__default__";

export type PendingAnswerBuckets = Record<string, Record<string, SavedAnswer>>;

export type PendingAnswerBatch = {
  profileId?: string;
  answers: Record<string, SavedAnswer>;
};

export function mergeSavedAnswerRecords(
  base: Record<string, SavedAnswer>,
  incoming: Record<string, SavedAnswer>
): Record<string, SavedAnswer> {
  const merged: Record<string, SavedAnswer> = {};

  for (const [key, answer] of Object.entries(base)) {
    upsertSavedAnswer(merged, key, answer);
  }

  for (const [key, answer] of Object.entries(incoming)) {
    upsertSavedAnswer(merged, key, answer);
  }

  return merged;
}

export function readPendingAnswerBucketsFromFallback(
  raw: string | null
): PendingAnswerBuckets {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return readLegacyPendingAnswerEntries(parsed);
    }
    if (!isRecord(parsed)) {
      return {};
    }

    const buckets: PendingAnswerBuckets = {};

    for (const [rawProfileKey, rawAnswers] of Object.entries(parsed)) {
      if (!isRecord(rawAnswers)) {
        continue;
      }

      const profileKey = toPendingAnswerProfileKey(rawProfileKey);
      buckets[profileKey] = mergeSavedAnswerRecords(
        buckets[profileKey] ?? {},
        rawAnswers as Record<string, SavedAnswer>
      );
    }

    return buckets;
  } catch {
    return {};
  }
}

function readLegacyPendingAnswerEntries(entries: unknown[]): PendingAnswerBuckets {
  const buckets: PendingAnswerBuckets = {};

  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length < 2) {
      continue;
    }

    const [key, answer] = entry;
    if (typeof key !== "string" || !isSavedAnswerLike(answer)) {
      continue;
    }

    addPendingAnswer(
      buckets,
      undefined,
      key,
      answer
    );
  }

  return buckets;
}

export function serializePendingAnswerBuckets(
  buckets: PendingAnswerBuckets
): string | null {
  const serialized: PendingAnswerBuckets = {};

  for (const [profileKey, answers] of Object.entries(buckets)) {
    const normalizedAnswers = mergeSavedAnswerRecords({}, answers);
    if (Object.keys(normalizedAnswers).length === 0) {
      continue;
    }

    serialized[toPendingAnswerProfileKey(profileKey)] = normalizedAnswers;
  }

  return Object.keys(serialized).length > 0
    ? JSON.stringify(serialized)
    : null;
}

export function addPendingAnswer(
  buckets: PendingAnswerBuckets,
  profileId: string | undefined,
  key: string,
  answer: SavedAnswer
): void {
  const profileKey = toPendingAnswerProfileKey(profileId);
  buckets[profileKey] = mergeSavedAnswerRecords(buckets[profileKey] ?? {}, {
    [key]: answer,
  });
}

export function getPendingAnswersForProfile(
  buckets: PendingAnswerBuckets,
  profileId: string | undefined
): Record<string, SavedAnswer> {
  return mergeSavedAnswerRecords(
    {},
    buckets[toPendingAnswerProfileKey(profileId)] ?? {}
  );
}

export function removePendingAnswers(
  buckets: PendingAnswerBuckets,
  profileId: string | undefined,
  keys?: Iterable<string>
): void {
  const profileKey = toPendingAnswerProfileKey(profileId);
  const existing = buckets[profileKey];
  if (!existing) {
    return;
  }

  if (!keys) {
    delete buckets[profileKey];
    return;
  }

  for (const key of keys) {
    const normalizedKey = normalizeQuestionKey(key);
    if (!normalizedKey) {
      continue;
    }

    delete existing[normalizedKey];
  }

  if (Object.keys(existing).length === 0) {
    delete buckets[profileKey];
  }
}

export function listPendingAnswerBatches(
  buckets: PendingAnswerBuckets
): PendingAnswerBatch[] {
  return Object.entries(buckets)
    .map(([profileKey, answers]) => ({
      profileId:
        profileKey === DEFAULT_PENDING_ANSWER_PROFILE_KEY
          ? undefined
          : profileKey,
      answers: mergeSavedAnswerRecords({}, answers),
    }))
    .filter((batch) => Object.keys(batch.answers).length > 0);
}

export function hasPendingAnswerBatches(
  buckets: PendingAnswerBuckets
): boolean {
  return Object.keys(buckets).some(
    (profileKey) => Object.keys(buckets[profileKey] ?? {}).length > 0
  );
}

export function resolvePendingAnswerTargetProfileId(
  profiles: Record<string, unknown>,
  activeProfileId: string,
  profileId: string | undefined
): string | null {
  const normalizedProfileId =
    typeof profileId === "string" ? profileId.trim() : "";
  if (normalizedProfileId) {
    return profiles[normalizedProfileId] ? normalizedProfileId : null;
  }

  const normalizedActiveProfileId =
    typeof activeProfileId === "string" ? activeProfileId.trim() : "";
  if (normalizedActiveProfileId && profiles[normalizedActiveProfileId]) {
    return normalizedActiveProfileId;
  }

  return null;
}

function upsertSavedAnswer(
  target: Record<string, SavedAnswer>,
  key: string,
  answer: SavedAnswer
): void {
  const normalized = normalizeSavedAnswer(key, answer);
  if (!normalized) {
    return;
  }

  const [normalizedKey, nextAnswer] = normalized;
  const existing = target[normalizedKey];
  if (!existing || nextAnswer.updatedAt >= existing.updatedAt) {
    target[normalizedKey] = nextAnswer;
  }
}

function normalizeSavedAnswer(
  key: string,
  answer: SavedAnswer
): [string, SavedAnswer] | null {
  const question = cleanText(answer.question || key);
  const value = cleanText(answer.value);
  const normalizedKey = normalizeQuestionKey(key || question);

  if (!question || !value || !normalizedKey) {
    return null;
  }

  return [
    normalizedKey,
    {
      question,
      value,
      updatedAt: Number.isFinite(answer.updatedAt)
        ? Number(answer.updatedAt)
        : Date.now(),
    },
  ];
}

function toPendingAnswerProfileKey(profileId: string | undefined): string {
  const cleaned = typeof profileId === "string" ? profileId.trim() : "";
  return cleaned || DEFAULT_PENDING_ANSWER_PROFILE_KEY;
}

function isSavedAnswerLike(value: unknown): value is SavedAnswer {
  return (
    typeof value === "object" &&
    value !== null &&
    "question" in value &&
    "value" in value &&
    "updatedAt" in value
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
