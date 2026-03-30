import type { AutomationSession, SiteKey, SpawnTabRequest } from "../shared";
import { getSessionStorageKey } from "../shared";

export type AutomationQueuedJobItem = {
  url: string;
  site: SiteKey;
  stage?: SpawnTabRequest["stage"];
  runId?: SpawnTabRequest["runId"];
  claimedJobKey?: string;
  message?: string;
  label?: string;
  resumeKind?: SpawnTabRequest["resumeKind"];
  profileId?: string;
  keyword?: string;
  active?: boolean;
  sourceTabId?: number;
  sourceWindowId?: number;
  sourceTabIndex?: number;
  enqueuedAt: number;
};

export type AutomationRunState = {
  id: string;
  jobPageLimit: number;
  openedJobPages: number;
  openedJobKeys: string[];
  reviewedJobKeys: string[];
  successfulJobPages: number;
  successfulJobKeys: string[];
  queuedJobItems: AutomationQueuedJobItem[];
  stopRequested: boolean;
  rateLimitedUntil?: number;
  updatedAt: number;
};

const AUTOMATION_RUN_STORAGE_PREFIX = "remote-job-search-run:";
const SESSION_STORAGE_PREFIX = "remote-job-search-session:";
const ACTIVE_RUNS_STORAGE_KEY = "remote-job-search-active-runs";

export async function getSession(
  tabId: number
): Promise<AutomationSession | null> {
  const key = getSessionStorageKey(tabId);
  const stored = await chrome.storage.local.get(key);
  return (stored[key] as AutomationSession | undefined) ?? null;
}

export async function setSession(session: AutomationSession): Promise<void> {
  await chrome.storage.local.set({
    [getSessionStorageKey(session.tabId)]: session,
  });
}

export async function removeSession(tabId: number): Promise<void> {
  const existingSession = await getSession(tabId);
  await chrome.storage.local.remove(getSessionStorageKey(tabId));

  if (existingSession?.runId) {
    await removeRunStateIfUnused(existingSession.runId);
  }
}

export async function getRunState(
  runId: string
): Promise<AutomationRunState | null> {
  const key = getAutomationRunStorageKey(runId);
  const stored = await chrome.storage.local.get(key);
  const value = stored[key];

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const raw = value as Partial<AutomationRunState>;

  const queuedJobItems = Array.isArray(raw.queuedJobItems)
    ? raw.queuedJobItems
        .filter(
          (item): item is AutomationQueuedJobItem =>
            Boolean(item) &&
            typeof item === "object" &&
            !Array.isArray(item) &&
            typeof (item as AutomationQueuedJobItem).url === "string" &&
            typeof (item as AutomationQueuedJobItem).site === "string"
        )
        .map((item) => ({
          ...item,
          url: item.url.trim(),
          site: item.site,
          stage:
            item.stage === "bootstrap" ||
            item.stage === "collect-results" ||
            item.stage === "open-apply" ||
            item.stage === "autofill-form"
              ? item.stage
              : undefined,
          runId:
            typeof item.runId === "string" && item.runId.trim()
              ? item.runId
              : undefined,
          claimedJobKey:
            typeof item.claimedJobKey === "string" && item.claimedJobKey.trim()
              ? item.claimedJobKey
              : undefined,
          message: typeof item.message === "string" ? item.message : undefined,
          label: typeof item.label === "string" ? item.label : undefined,
          resumeKind:
            item.resumeKind === "front_end" ||
            item.resumeKind === "back_end" ||
            item.resumeKind === "full_stack"
              ? item.resumeKind
              : undefined,
          profileId:
            typeof item.profileId === "string" ? item.profileId : undefined,
          keyword: typeof item.keyword === "string" ? item.keyword : undefined,
          active: Boolean(item.active),
          sourceTabId: Number.isFinite(Number(item.sourceTabId))
            ? Number(item.sourceTabId)
            : undefined,
          sourceWindowId: Number.isFinite(Number(item.sourceWindowId))
            ? Number(item.sourceWindowId)
            : undefined,
          sourceTabIndex: Number.isFinite(Number(item.sourceTabIndex))
            ? Number(item.sourceTabIndex)
            : undefined,
          enqueuedAt: Number.isFinite(Number(item.enqueuedAt))
            ? Number(item.enqueuedAt)
            : Date.now(),
        }))
        .filter((item) => item.url.length > 0)
    : [];

  return {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id : runId,
    jobPageLimit: Number.isFinite(Number(raw.jobPageLimit))
      ? Math.max(0, Math.floor(Number(raw.jobPageLimit)))
      : 0,
    openedJobPages: Number.isFinite(Number(raw.openedJobPages))
      ? Math.max(0, Math.floor(Number(raw.openedJobPages)))
      : 0,
    openedJobKeys: Array.isArray(raw.openedJobKeys)
      ? raw.openedJobKeys.filter(
          (key): key is string => typeof key === "string" && Boolean(key.trim())
        )
      : [],
    reviewedJobKeys: Array.isArray(raw.reviewedJobKeys)
      ? raw.reviewedJobKeys.filter(
          (key): key is string => typeof key === "string" && Boolean(key.trim())
        )
      : [],
    successfulJobPages: Number.isFinite(Number(raw.successfulJobPages))
      ? Math.max(0, Math.floor(Number(raw.successfulJobPages)))
      : 0,
    successfulJobKeys: Array.isArray(raw.successfulJobKeys)
      ? raw.successfulJobKeys.filter(
          (key): key is string => typeof key === "string" && Boolean(key.trim())
        )
      : [],
    queuedJobItems,
    stopRequested: raw.stopRequested === true,
    rateLimitedUntil: Number.isFinite(Number(raw.rateLimitedUntil))
      ? Number(raw.rateLimitedUntil)
      : undefined,
    updatedAt: Number.isFinite(raw.updatedAt) ? Number(raw.updatedAt) : Date.now(),
  };
}

export async function isRunRateLimited(runId: string): Promise<boolean> {
  const runState = await getRunState(runId);

  return Boolean(
    runState &&
      Number.isFinite(runState.rateLimitedUntil) &&
      Date.now() < Number(runState.rateLimitedUntil)
  );
}

export async function setRunState(runState: AutomationRunState): Promise<void> {
  await chrome.storage.local.set({
    [getAutomationRunStorageKey(runState.id)]: runState,
  });
}

export async function removeRunState(runId: string): Promise<void> {
  await chrome.storage.local.remove(getAutomationRunStorageKey(runId));
}

export async function listSessionsForRunId(
  runId: string
): Promise<AutomationSession[]> {
  const allStored = await chrome.storage.local.get(null);

  return Object.entries(allStored)
    .filter(([key]) => key.startsWith(SESSION_STORAGE_PREFIX))
    .map(([, value]) => value as AutomationSession)
    .filter((session) => session?.runId === runId);
}

export async function listLiveSessionsForRunId(
  runId: string
): Promise<AutomationSession[]> {
  const sessions = await listSessionsForRunId(runId);
  return sessions.filter(
    (session) => session.phase !== "completed" && session.phase !== "error"
  );
}

export async function addActiveRunId(runId: string): Promise<void> {
  const stored = await chrome.storage.local.get(ACTIVE_RUNS_STORAGE_KEY);
  const activeRuns: string[] = Array.isArray(stored[ACTIVE_RUNS_STORAGE_KEY])
    ? stored[ACTIVE_RUNS_STORAGE_KEY]
    : [];

  if (!activeRuns.includes(runId)) {
    activeRuns.push(runId);
    await chrome.storage.local.set({
      [ACTIVE_RUNS_STORAGE_KEY]: activeRuns,
    });
  }
}

export async function removeActiveRunId(runId: string): Promise<void> {
  const stored = await chrome.storage.local.get(ACTIVE_RUNS_STORAGE_KEY);
  const activeRuns: string[] = Array.isArray(stored[ACTIVE_RUNS_STORAGE_KEY])
    ? stored[ACTIVE_RUNS_STORAGE_KEY]
    : [];

  const filtered = activeRuns.filter((id) => id !== runId);
  await chrome.storage.local.set({
    [ACTIVE_RUNS_STORAGE_KEY]: filtered,
  });
}

export async function removeRunStateIfUnused(runId: string): Promise<void> {
  const allStored = await chrome.storage.local.get(null);
  const allKeys = Object.keys(allStored);
  const sessionKeys = allKeys.filter((key) =>
    key.startsWith(SESSION_STORAGE_PREFIX)
  );
  const runState = await getRunState(runId);

  if (
    runState &&
    runState.stopRequested !== true &&
    runState.queuedJobItems.length > 0
  ) {
    return;
  }

  if (sessionKeys.length === 0) {
    await removeRunState(runId);
    await removeActiveRunId(runId);
    return;
  }

  const sessionEntries = await chrome.storage.local.get(sessionKeys);

  const hasActiveSession = Object.values(sessionEntries).some((value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }

    return "runId" in value && (value as { runId?: unknown }).runId === runId;
  });

  if (!hasActiveSession) {
    await removeRunState(runId);
    await removeActiveRunId(runId);
  }
}

export function getAutomationRunStorageKey(runId: string): string {
  return `${AUTOMATION_RUN_STORAGE_PREFIX}${runId}`;
}

export function createRunId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
