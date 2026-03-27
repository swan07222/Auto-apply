// Background runtime orchestration for tab spawning, session state, and run quotas.

import {
  AutomationSession,
  AutomationStage,
  AutomationStatus,
  AutomationRunSummary,
  BrokenPageReason,
  SEARCH_OPEN_DELAY_MS,
  SearchTarget,
  SiteKey,
  STARTUP_COMPANIES_REFRESH_ALARM,
  STARTUP_COMPANIES_REFRESH_INTERVAL_MS,
  SpawnTabRequest,
  buildOtherJobSiteTargets,
  buildStartupSearchTargets,
  createSession,
  detectSiteFromUrl,
  formatStartupRegionList,
  getJobDedupKey,
  getSpawnDedupKey,
  isJobBoardSite,
  parseSearchKeywords,
  readAutomationSettings,
  refreshStartupCompanies,
  resolveStartupTargetRegions,
  shouldKeepManagedJobPageOpen,
} from "./shared";
import { deduplicateSpawnItems } from "./background/spawnQueue";
import {
  buildQueuedJobSessionMessage,
  isManagedJobSession,
  isManagedJobSessionActive,
  isManagedJobSessionPending,
  isManagedJobStage,
  isRateLimitedSession,
  isSuccessfulJobCompletion,
  ManagedSessionCompletionKind,
  resolveContentReadySession,
  shouldQueueManagedJobSession,
  shouldReleaseManagedJobOpening,
} from "./background/sessionState";
import {
  AutomationQueuedJobItem,
  addActiveRunId,
  createRunId,
  getRunState,
  getSession,
  isRunRateLimited,
  listLiveSessionsForRunId,
  listSessionsForRunId,
  removeActiveRunId,
  removeRunState,
  removeSession,
  setRunState,
  setSession,
} from "./background/sessionStore";

type BackgroundRequest =
  | { type: "start-automation"; tabId: number }
  | { type: "start-startup-automation"; tabId?: number }
  | { type: "start-other-sites-automation"; tabId?: number }
  | { type: "pause-automation-session"; tabId?: number; message?: string }
  | { type: "resume-automation-session"; tabId?: number }
  | { type: "manual-submit-detected"; tabId?: number }
  | { type: "mark-job-reviewed"; tabId?: number; fallbackUrl?: string }
  | { type: "stop-automation-run"; tabId?: number; message?: string }
  | { type: "extract-monster-search-results" }
  | { type: "queue-job-tabs"; items: SpawnTabRequest[] }
  | { type: "get-tab-session"; tabId: number }
  | { type: "get-run-summary"; tabId?: number }
  | { type: "content-ready"; looksLikeApplicationSurface?: boolean }
  | {
      type: "status-update";
      status: AutomationStatus;
      shouldResume?: boolean;
      stage?: AutomationStage;
      jobSlots?: number;
      label?: string;
      resumeKind?: SpawnTabRequest["resumeKind"];
      profileId?: SpawnTabRequest["profileId"];
      completionKind?: ManagedSessionCompletionKind;
    }
  | { type: "spawn-tabs"; items: SpawnTabRequest[]; maxJobPages?: number }
  | {
      type: "finalize-session";
      status: AutomationStatus;
      stage?: AutomationStage;
      jobSlots?: number;
      label?: string;
      resumeKind?: SpawnTabRequest["resumeKind"];
      profileId?: SpawnTabRequest["profileId"];
      completionKind?: ManagedSessionCompletionKind;
    }
  | { type: "probe-application-target"; url: string }
  | { type: "close-current-tab" };

type ProbedTargetFailureReason = BrokenPageReason | "unreachable";

const ZIPRECRUITER_SPAWN_DELAY_MS = 4_000;
const MONSTER_SPAWN_DELAY_MS = 9_000;
const RATE_LIMIT_COOLDOWN_MS = 10 * 60 * 1_000;

const APPLIED_JOB_HISTORY_STORAGE_KEY = "remote-job-search-applied-job-history";
const REVIEWED_JOB_HISTORY_STORAGE_KEY = "remote-job-search-reviewed-job-history";
const MAX_APPLIED_JOB_HISTORY = 5_000;
const MAX_REVIEWED_JOB_HISTORY = 10_000;

const runLocks = new Map<string, Promise<void>>();
const pendingExtensionTabSpawns = new Map<number, number>();
let pendingSpawnPersistTimerId: number | null = null;
let appliedJobHistoryCache: Map<string, number> | null = null;
let appliedJobHistoryLoadPromise: Promise<Map<string, number>> | null = null;
let appliedJobHistoryWritePromise: Promise<void> = Promise.resolve();
let reviewedJobHistoryCache: Map<string, number> | null = null;
let reviewedJobHistoryLoadPromise: Promise<Map<string, number>> | null = null;
let reviewedJobHistoryWritePromise: Promise<void> = Promise.resolve();

chrome.runtime.onMessage.addListener(
  (message: BackgroundRequest, sender, sendResponse) => {
    void handleMessage(message, sender)
      .then((response) => sendResponse(response))
      .catch((error: unknown) => {
        sendResponse({
          ok: false,
          error:
            error instanceof Error ? error.message : "Unknown background error.",
        });
      });

    return true;
  }
);

chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    const session = await getSession(tabId);
    await removeSession(tabId);
    if (session?.runId) {
      await maybeOpenNextQueuedJobForRunId(session.runId);
    }
  })();
});

chrome.tabs.onCreated.addListener((tab) => {
  void attachSessionToSiteOpenedChildTab(tab);
});

chrome.runtime.onStartup.addListener(() => {
  void restorePendingSpawnsFromStorage();
  void scheduleStartupCompanyRefresh();
  void refreshStartupCompanies();
});

chrome.runtime.onInstalled.addListener(() => {
  void restorePendingSpawnsFromStorage();
  void scheduleStartupCompanyRefresh();
  void refreshStartupCompanies(true);
});

chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name === STARTUP_COMPANIES_REFRESH_ALARM) {
    void refreshStartupCompanies(true);
  }
});

async function restorePendingSpawnsFromStorage(): Promise<void> {
  try {
    const key = "remote-job-search-pending-spawns";
    const stored = await chrome.storage.local.get(key);
    const data = stored[key];
    if (data && typeof data === "object" && !Array.isArray(data)) {
      for (const [tabIdStr, count] of Object.entries(data)) {
        const tabId = Number(tabIdStr);
        if (Number.isFinite(tabId) && typeof count === "number" && count > 0) {
          pendingExtensionTabSpawns.set(tabId, count);
        }
      }
    }
  } catch {
    // Ignore restore errors.
  }
}

async function scheduleStartupCompanyRefresh(): Promise<void> {
  try {
    await chrome.alarms.create(STARTUP_COMPANIES_REFRESH_ALARM, {
      delayInMinutes: 1,
      periodInMinutes: STARTUP_COMPANIES_REFRESH_INTERVAL_MS / 60_000,
    });
  } catch {
    // Ignore alarm scheduling errors.
  }
}

async function extractMonsterSearchResults(tabId: number): Promise<{
  ok: boolean;
  error?: string;
  jobResults?: unknown[];
}> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => {
        const preferredKeys = [
          "jobResults",
          "jobViewResults",
          "jobViewResultsData",
          "jobViewResultsDataCompact",
          "jobViewData",
          "jobData",
          "jobs",
          "jobCards",
          "listings",
          "edges",
          "nodes",
          "results",
          "items",
          "searchResults",
          "jobSearchResults",
          "pageProps",
          "data",
        ];
        let visitedCount = 0;

        const looksLikeMonsterJobRecord = (value: unknown): boolean => {
          if (!value || typeof value !== "object") {
            return false;
          }

          const record = value as {
            canonicalUrl?: unknown;
            url?: unknown;
            title?: unknown;
            jobPosting?: { title?: unknown; url?: unknown };
            normalizedJobPosting?: { title?: unknown; url?: unknown };
            enrichments?: {
              localizedMonsterUrls?: Array<{ url?: unknown }>;
            };
            jobId?: unknown;
            id?: unknown;
          };

          const urls = [
            record.normalizedJobPosting?.url,
            record.jobPosting?.url,
            record.enrichments?.localizedMonsterUrls?.[0]?.url,
            record.canonicalUrl,
            record.url,
          ];
          const titles = [
            record.normalizedJobPosting?.title,
            record.jobPosting?.title,
            record.title,
          ];
          const hasRecognizedUrl = urls.some(
            (url) =>
              typeof url === "string" &&
              /monster\.|\/job(?:-openings)?\/|\/jobs\/[^/?#]{4,}/i.test(url)
          );
          const hasJobIdentity =
            typeof record.jobId === "string" ||
            typeof record.id === "string" ||
            Boolean(record.jobPosting) ||
            Boolean(record.normalizedJobPosting);

          return (
            hasRecognizedUrl ||
            (hasJobIdentity &&
              titles.some(
                (title) =>
                  typeof title === "string" && title.trim().length >= 3
              ))
          );
        };

        const normalizeMonsterUrl = (rawUrl: string): string | null => {
          const normalized = rawUrl
            .replace(/\\u002f/gi, "/")
            .replace(/\\u0026/gi, "&")
            .replace(/\\\//g, "/")
            .replace(/&amp;/gi, "&")
            .trim();

          if (!normalized) {
            return null;
          }

          try {
            const parsed = new URL(normalized, window.location.href);
            const lower = parsed.toString().toLowerCase();
            if (
              !/monster\./.test(parsed.hostname.toLowerCase()) ||
              lower.includes("/jobs/search") ||
              lower.includes("/jobs/browse") ||
              lower.includes("/jobs/q-") ||
              lower.includes("/jobs/l-")
            ) {
              return null;
            }
            parsed.hash = "";
            return parsed.toString();
          } catch {
            return null;
          }
        };

        const isLikelyMonsterJobTitle = (value: string | null | undefined): boolean => {
          const title = (value || "").trim();
          if (!title || title.length < 3 || title.length > 180) {
            return false;
          }

          const lower = title.toLowerCase();
          return ![
            "monster",
            "jobs",
            "search",
            "apply",
            "quick apply",
            "smart apply",
            "career advice",
            "salary",
            "privacy",
            "terms",
            "cookie",
          ].includes(lower);
        };

        const extractMonsterRecordsFromText = (text: string): Array<{
          url: string;
          title?: string;
        }> => {
          const normalizedText = text
            .replace(/\\u002f/gi, "/")
            .replace(/\\u0026/gi, "&")
            .replace(/\\\//g, "/");
          const urlPattern =
            /https?:\/\/(?:[\w-]+\.)?monster\.[a-z.]+\/(?:job-openings?\/[^"'\\<>\s]+|job\/[^"'\\<>\s]+|job-detail\/[^"'\\<>\s]+|jobs\/[^"'\\<>\s]{4,})/gi;
          const records: Array<{ url: string; title?: string }> = [];
          const seenUrls = new Set<string>();

          for (const match of normalizedText.matchAll(urlPattern)) {
            const rawUrl = match[0] || "";
            const url = normalizeMonsterUrl(rawUrl);
            if (!url || seenUrls.has(url)) {
              continue;
            }

            const matchIndex = typeof match.index === "number" ? match.index : -1;
            const nearbyText =
              matchIndex >= 0
                ? normalizedText.slice(
                    Math.max(0, matchIndex - 500),
                    Math.min(normalizedText.length, matchIndex + 500)
                  )
                : normalizedText;
            const titleMatch =
              nearbyText.match(
                /["']?(?:title|jobTitle|job_title|name|jobName)["']?\s*[:=]\s*["']([^"'\n]{3,180})["']/i
              );
            const title = titleMatch?.[1]
              ?.replace(/\\u0026/gi, "&")
              ?.replace(/\\u002f/gi, "/")
              ?.replace(/\\\//g, "/")
              ?.trim();

            seenUrls.add(url);
            records.push(
              isLikelyMonsterJobTitle(title)
                ? { url, title }
                : { url }
            );
          }

          return records;
        };

        const collectMonsterScriptTextRecords = (): Array<{
          url: string;
          title?: string;
        }> => {
          const records: Array<{ url: string; title?: string }> = [];
          const seenUrls = new Set<string>();

          for (const script of Array.from(
            document.querySelectorAll<HTMLScriptElement>(
              "script#__NEXT_DATA__, script[type='application/json'], script[type='application/ld+json'], script:not([src])"
            )
          ).slice(0, 40)) {
            const text = script.textContent?.trim() || "";
            if (
              text.length < 40 ||
              !/monster|job-openings|jobview|jobTitle|canonicalUrl/i.test(text)
            ) {
              continue;
            }

            for (const record of extractMonsterRecordsFromText(text)) {
              if (seenUrls.has(record.url)) {
                continue;
              }
              seenUrls.add(record.url);
              records.push(record);
            }
          }

          return records;
        };

        const scoreCandidateRecord = (value: unknown): number => {
          if (!looksLikeMonsterJobRecord(value)) {
            return 0;
          }

          const record = value as {
            canonicalUrl?: unknown;
            url?: unknown;
            title?: unknown;
            jobPosting?: { title?: unknown; url?: unknown };
            normalizedJobPosting?: { title?: unknown; url?: unknown };
            enrichments?: {
              localizedMonsterUrls?: Array<{ url?: unknown }>;
            };
          };
          let score = 0;

          if (
            [
              record.normalizedJobPosting?.url,
              record.jobPosting?.url,
              record.enrichments?.localizedMonsterUrls?.[0]?.url,
              record.canonicalUrl,
              record.url,
            ].some((url) => typeof url === "string" && Boolean(normalizeMonsterUrl(url)))
          ) {
            score += 3;
          }

          if (
            [
              record.normalizedJobPosting?.title,
              record.jobPosting?.title,
              record.title,
            ].some(
              (title) =>
                typeof title === "string" && title.trim().length >= 3
            )
          ) {
            score += 1;
          }

          return score;
        };

        const scoreCandidateArray = (value: unknown[]): number => {
          let score = 0;

          for (const entry of value.slice(0, 25)) {
            score += scoreCandidateRecord(entry);
          }

          return score;
        };

        const parsedJsonScripts = Array.from(
          document.querySelectorAll<HTMLScriptElement>(
            "script#__NEXT_DATA__, script[type='application/ld+json']"
          )
        )
          .map((script) => script.textContent || "")
          .map((text) => {
            try {
              return JSON.parse(text);
            } catch {
              return null;
            }
          })
          .filter(Boolean);

        const roots: unknown[] = [
          (
            window as Window & {
              searchResults?: { jobResults?: unknown[] };
              __NEXT_DATA__?: unknown;
              __INITIAL_STATE__?: unknown;
              __PRELOADED_STATE__?: unknown;
              __APOLLO_STATE__?: unknown;
              __NUXT__?: unknown;
            }
          ).searchResults,
          (
            window as Window & {
              __NEXT_DATA__?: unknown;
              __INITIAL_STATE__?: unknown;
              __PRELOADED_STATE__?: unknown;
              __APOLLO_STATE__?: unknown;
              __NUXT__?: unknown;
            }
          ).__NEXT_DATA__,
          (
            window as Window & {
              __INITIAL_STATE__?: unknown;
              __PRELOADED_STATE__?: unknown;
              __APOLLO_STATE__?: unknown;
              __NUXT__?: unknown;
            }
          ).__INITIAL_STATE__,
          (
            window as Window & {
              __PRELOADED_STATE__?: unknown;
              __APOLLO_STATE__?: unknown;
              __NUXT__?: unknown;
            }
          ).__PRELOADED_STATE__,
          (
            window as Window & {
              __APOLLO_STATE__?: unknown;
              __NUXT__?: unknown;
            }
          ).__APOLLO_STATE__,
          (
            window as Window & {
              __NUXT__?: unknown;
            }
          ).__NUXT__,
          ...parsedJsonScripts,
        ].filter((value) => value !== undefined && value !== null);

        const visitedObjects = new WeakSet<object>();
        const candidateArrays: unknown[][] = [];
        const candidateRecords: unknown[] = [];

        const visit = (value: unknown, depth: number): void => {
          if (depth > 8 || visitedCount > 2_500) {
            return;
          }

          if (Array.isArray(value)) {
            visitedCount += 1;
            if (scoreCandidateArray(value) > 0) {
              candidateArrays.push(value);
              return;
            }

            for (const entry of value.slice(0, 25)) {
              visit(entry, depth + 1);
            }
            return;
          }

          if (!value || typeof value !== "object") {
            return;
          }

          const obj = value as Record<string, unknown>;
          if (visitedObjects.has(obj)) {
            return;
          }
          visitedObjects.add(obj);
          visitedCount += 1;

          if (scoreCandidateRecord(obj) > 0) {
            candidateRecords.push(obj);
          }

          for (const key of preferredKeys) {
            if (key in obj) {
              visit(obj[key], depth + 1);
            }
          }

          for (const [key, nested] of Object.entries(obj)) {
            if (preferredKeys.includes(key)) {
              continue;
            }
            visit(nested, depth + 1);
          }
        };

        for (const root of roots) {
          visit(root, 0);
        }

        candidateArrays.sort(
          (left, right) =>
            scoreCandidateArray(right) - scoreCandidateArray(left) ||
            right.length - left.length
        );

        if (candidateArrays[0]?.length) {
          return candidateArrays[0];
        }

        const dedupedRecords: unknown[] = [];
        const seenRecordUrls = new Set<string>();
        for (const record of candidateRecords) {
          if (!looksLikeMonsterJobRecord(record)) {
            continue;
          }

          const resolvedUrl = normalizeMonsterUrl(
            String(
              (record as {
                normalizedJobPosting?: { url?: unknown };
                jobPosting?: { url?: unknown };
                enrichments?: {
                  localizedMonsterUrls?: Array<{ url?: unknown }>;
                };
                canonicalUrl?: unknown;
                url?: unknown;
              }).normalizedJobPosting?.url ??
                (record as { jobPosting?: { url?: unknown } }).jobPosting?.url ??
                (record as {
                  enrichments?: {
                    localizedMonsterUrls?: Array<{ url?: unknown }>;
                  };
                }).enrichments?.localizedMonsterUrls?.[0]?.url ??
                (record as { canonicalUrl?: unknown }).canonicalUrl ??
                (record as { url?: unknown }).url ??
                ""
            )
          );
          if (!resolvedUrl || seenRecordUrls.has(resolvedUrl)) {
            continue;
          }

          seenRecordUrls.add(resolvedUrl);
          dedupedRecords.push(record);
        }

        if (dedupedRecords.length > 0) {
          return dedupedRecords;
        }

        return collectMonsterScriptTextRecords();
      },
    });
    const jobResults = Array.isArray(results[0]?.result) ? results[0].result : [];

    return {
      ok: true,
      jobResults,
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Could not read Monster search results from the page.",
    };
  }
}

async function persistPendingSpawns(): Promise<void> {
  try {
    const key = "remote-job-search-pending-spawns";
    const data: Record<string, number> = {};
    for (const [tabId, count] of pendingExtensionTabSpawns.entries()) {
      if (count > 0) {
        data[String(tabId)] = count;
      }
    }
    await chrome.storage.local.set({ [key]: data });
  } catch {
    // Ignore persist errors.
  }
}

function schedulePendingSpawnsPersist(): void {
  if (pendingSpawnPersistTimerId !== null) {
    return;
  }

  pendingSpawnPersistTimerId = globalThis.setTimeout(() => {
    pendingSpawnPersistTimerId = null;
    void persistPendingSpawns();
  }, 50);
}

async function handleMessage(
  message: BackgroundRequest,
  sender: chrome.runtime.MessageSender
): Promise<unknown> {
  switch (message.type) {
    case "start-automation":
      return startAutomationForTab(message.tabId);

    case "start-startup-automation":
      return startStartupAutomation(message.tabId);

    case "start-other-sites-automation":
      return startOtherSitesAutomation(message.tabId);

    case "pause-automation-session":
      return pauseAutomationSession(
        resolveRequestedTabId(message.tabId, sender),
        message.message
      );

    case "resume-automation-session":
      return resumeAutomationSession(resolveRequestedTabId(message.tabId, sender));

    case "manual-submit-detected":
      return markManualSubmitDetected(resolveRequestedTabId(message.tabId, sender));

    case "mark-job-reviewed":
      return markJobReviewed(
        resolveRequestedTabId(message.tabId, sender),
        message.fallbackUrl ?? sender.tab?.url
      );

    case "stop-automation-run":
      return stopAutomationRun(
        resolveRequestedTabId(message.tabId, sender),
        message.message
      );

    case "extract-monster-search-results": {
      const tabId = sender.tab?.id;
      if (tabId === undefined) {
        return {
          ok: false,
          error: "No active tab was available for Monster search extraction.",
        };
      }

      return extractMonsterSearchResults(tabId);
    }

    case "queue-job-tabs":
      return queueJobTabsForSender(sender, message.items);

    case "get-tab-session":
      return {
        ok: true,
        session: await getDecoratedSession(message.tabId),
      };

    case "get-run-summary":
      return {
        ok: true,
        summary: await getRunSummaryForTab(
          resolveRequestedTabId(message.tabId, sender)
        ),
      };

    case "content-ready": {
      const tabId = sender.tab?.id;

      if (tabId === undefined) {
        return { ok: false, shouldResume: false };
      }

      const session = await getSession(tabId);
      if (!session) {
        return {
          ok: true,
          shouldResume: false,
          session: null,
        };
      }

      const resolved = await resolveContentReadySession(
        session,
        typeof sender.frameId === "number" ? sender.frameId : 0,
        Boolean(message.looksLikeApplicationSurface),
        setSession
      );

      return {
        ok: true,
        shouldResume: resolved.shouldResume,
        session: (await getDecoratedSession(tabId)) ?? resolved.session,
      };
    }

    case "status-update":
      return updateSessionFromMessage(message, sender, false);

    case "finalize-session":
      return updateSessionFromMessage(message, sender, true);

    case "probe-application-target":
      return probeApplicationTargetUrl(message.url);

    case "spawn-tabs": {
      const currentTab = sender.tab;

      if (!currentTab?.id) {
        return { ok: false, error: "Missing source tab." };
      }

      const liveSourceTab = await getTabSafely(currentTab.id);
      const sourceTab = liveSourceTab ?? currentTab;
      const sourceSession = await getSession(currentTab.id);

      let itemsToOpen = message.items;
      const failedJobOpeningItems: SpawnTabRequest[] = [];

      if (
        typeof message.maxJobPages === "number" &&
        Number.isFinite(message.maxJobPages)
      ) {
        const cap = Math.max(0, Math.floor(message.maxJobPages));
        itemsToOpen = capJobOpeningItems(itemsToOpen, cap);
      }

      // Preserve search-specific query params when deduplicating spawn targets.
      itemsToOpen = deduplicateSpawnItems(itemsToOpen, message.maxJobPages);
      const {
        items: historyFilteredItems,
        skippedItems: skippedHistoryItems,
      } = await filterManagedSpawnItemsByStoredHistory(itemsToOpen);
      itemsToOpen = historyFilteredItems;
      const {
        items: filteredItemsToOpen,
        skippedItems: skippedAlreadyOpenItems,
      } = await filterAlreadyOpenManagedSpawnItems(itemsToOpen);
      itemsToOpen = filteredItemsToOpen;

      if (skippedHistoryItems.length > 0) {
        await releaseJobOpeningsForItems(skippedHistoryItems);
      }

      if (skippedAlreadyOpenItems.length > 0) {
        await releaseJobOpeningsForItems(skippedAlreadyOpenItems);
      }

      if (itemsToOpen.length === 0) {
        return {
          ok: true,
          opened: 0,
        };
      }

      const baseIndex = sourceTab.index ?? currentTab.index ?? 0;
      reserveExtensionSpawnSlots(currentTab.id, itemsToOpen.length);

      let openedCount = 0;
      const queuedRunIds = new Set<string>();

      for (const [offset, item] of itemsToOpen.entries()) {
        if (item.runId && (await isRunRateLimited(item.runId))) {
          for (const remainingItem of itemsToOpen.slice(offset)) {
            if (
              remainingItem.stage === "open-apply" ||
              remainingItem.stage === "autofill-form"
            ) {
              failedJobOpeningItems.push(remainingItem);
            }
          }
          break;
        }

        let createdTab: chrome.tabs.Tab;
        try {
          createdTab = await createExtensionSpawnTab(item, {
            sourceTabId: liveSourceTab?.id,
            windowId: sourceTab.windowId,
            index: baseIndex + offset + 1,
          });
          openedCount += 1;
        } catch (error: unknown) {
          // Keep the first open failure so the caller gets a useful error.
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`[Auto-apply] Tab creation failed for ${item.url}: ${errorMessage}`);
          
          releaseExtensionSpawnSlots(currentTab.id, 1);
          if (item.stage === "open-apply" || item.stage === "autofill-form") {
            failedJobOpeningItems.push(item);
          }
          continue;
        }

        if (item.stage && createdTab.id !== undefined) {
          const shouldQueue = shouldQueueManagedJobSession(item, sourceSession);
          const session = createSession(
            createdTab.id,
            item.site,
            shouldQueue ? "idle" : "running",
            shouldQueue
              ? buildQueuedJobSessionMessage(item.site, getReadableSiteName)
              : (item.message ?? `Starting ${getReadableStageName(item.stage)}...`),
            shouldQueue ? false : true,
            item.stage,
            item.runId,
            item.label,
            item.keyword,
            item.resumeKind,
            item.profileId
          );
          session.jobSlots = item.jobSlots;
          if (item.runId && isManagedJobStage(item.stage)) {
            session.claimedJobKey =
              item.claimedJobKey || getJobDedupKey(item.url) || undefined;
          }
          session.openedUrlKey = getSpawnDedupKey(item.url) || undefined;

          await setSession(session);
          scheduleSessionRestartOnTabComplete(createdTab.id);

          if (!shouldQueue) {
            try {
              await sendSessionControlMessage(session, {
                type: "start-automation",
                session,
              });
            } catch {
              // The content script may still be loading; content-ready or the
              // ready-state kick will restart it.
            }
          }

          if (shouldQueue && item.runId) {
            queuedRunIds.add(item.runId);
          }
        }

        await delay(getSpawnOpenDelayMs(item));
      }

      if (failedJobOpeningItems.length > 0) {
        await releaseJobOpeningsForItems(failedJobOpeningItems);
      }

      if (openedCount === 0) {
        return {
          ok: false,
          error: "The browser blocked opening the requested tabs.",
        };
      }

      for (const runId of queuedRunIds) {
        await resumePendingJobSessionsForRunId(runId);
      }

      return {
        ok: true,
        opened: openedCount,
      };
    }

    case "close-current-tab": {
      const tabId = sender.tab?.id;

      if (tabId === undefined) {
        return { ok: false };
      }

      const session = await getSession(tabId);
      await removeSession(tabId);

      try {
        await chrome.tabs.remove(tabId);
      } catch {
        // Tab may already be closed.
      }

      if (session?.runId) {
        await maybeOpenNextQueuedJobForRunId(session.runId);
      }

      return { ok: true };
    }

    default:
      return {
        ok: false,
        error: `Unknown message type: ${(message as { type?: string }).type ?? "undefined"}`,
      };
  }
}

async function updateSessionFromMessage(
  message:
    | Extract<BackgroundRequest, { type: "status-update" }>
    | Extract<BackgroundRequest, { type: "finalize-session" }>,
  sender: chrome.runtime.MessageSender,
  isFinal: boolean
): Promise<{ ok: boolean }> {
  const tabId = sender.tab?.id;

  if (tabId === undefined) {
    return { ok: false };
  }

  const existingSession = await getSession(tabId);
  const site = existingSession?.site ?? message.status.site;

  if (site === "unsupported") {
    if (isFinal) {
      await removeSession(tabId);
    }

    return { ok: true };
  }

  const shouldResume = isFinal
    ? false
    : ("shouldResume" in message ? message.shouldResume : undefined) ??
      existingSession?.shouldResume ??
      false;
  const nextStage = message.stage ?? existingSession?.stage ?? "bootstrap";
  const controllerFrameId =
    nextStage === "autofill-form"
      ? typeof sender.frameId === "number"
        ? sender.frameId
        : existingSession?.controllerFrameId
      : undefined;
  const completionKind = message.completionKind;

  const nextSession: AutomationSession = {
    tabId,
    site,
    phase: message.status.phase,
    message: message.status.message,
    updatedAt: message.status.updatedAt,
    shouldResume,
    stage: nextStage,
    manualSubmitPending: isFinal
      ? false
      : existingSession?.manualSubmitPending ?? false,
    runId: existingSession?.runId,
    jobSlots:
      typeof message.jobSlots === "number" && Number.isFinite(message.jobSlots)
        ? Math.max(0, Math.floor(message.jobSlots))
        : existingSession?.jobSlots,
    label: message.label ?? existingSession?.label,
    keyword: existingSession?.keyword,
    resumeKind: message.resumeKind ?? existingSession?.resumeKind,
    profileId: message.profileId ?? existingSession?.profileId,
    controllerFrameId,
    claimedJobKey: existingSession?.claimedJobKey,
    openedUrlKey: existingSession?.openedUrlKey,
  };

  await setSession(nextSession);

  if (isFinal && nextSession.runId && isRateLimitedSession(nextSession)) {
    await markRunRateLimited(nextSession.runId);
    return { ok: true };
  }

  if (
    !isFinal &&
    nextSession.runId &&
    nextSession.site === "monster" &&
    nextSession.phase === "waiting_for_verification"
  ) {
    await markRunRateLimited(nextSession.runId);
  }

  if (
    isFinal &&
    nextSession.runId &&
    isManagedJobSession(nextSession)
  ) {
    if (isSuccessfulJobCompletion(nextSession, completionKind)) {
      await recordSuccessfulJobCompletion(
        nextSession.runId,
        nextSession.tabId,
        sender.tab?.url
      );
      await closeManagedOpenerJobTabForCompletedChild(nextSession, sender.tab);
    } else if (shouldReleaseManagedJobOpening(nextSession, completionKind)) {
      await releaseManagedJobOpening(
        nextSession.runId,
        nextSession.tabId,
        sender.tab?.url
      );
      await closeManagedOpenerJobTabForCompletedChild(nextSession, sender.tab);
    }

    await resumePendingJobSessionsForRunId(nextSession.runId);
  }

  return { ok: true };
}

async function getDecoratedSession(
  tabId: number
): Promise<AutomationSession | null> {
  const session = await getSession(tabId);
  if (!session) {
    return null;
  }

  const runSummary = await getRunSummaryForSession(session);
  return runSummary
    ? {
        ...session,
        runSummary,
      }
    : session;
}

async function getRunSummaryForTab(
  tabId: number
): Promise<AutomationRunSummary | null> {
  const session = await getSession(tabId);
  if (!session) {
    return null;
  }

  return getRunSummaryForSession(session);
}

async function getRunSummaryForSession(
  session: AutomationSession | null
): Promise<AutomationRunSummary | null> {
  const runId = session?.runId?.trim();
  if (!runId) {
    return null;
  }

  const runState = await getRunState(runId);
  if (!runState) {
    return null;
  }

  return {
    queuedJobCount: runState.queuedJobItems.length,
    successfulJobPages: runState.successfulJobPages,
    appliedTodayCount: await countAppliedJobsForToday(),
    stopRequested: runState.stopRequested,
  };
}

function resolveRequestedTabId(
  tabId: number | undefined,
  sender: chrome.runtime.MessageSender
): number {
  if (typeof tabId === "number" && Number.isFinite(tabId)) {
    return tabId;
  }

  if (typeof sender.tab?.id === "number") {
    return sender.tab.id;
  }

  throw new Error("No active automation tab was available for this request.");
}

async function sendSessionControlMessage(
  session: AutomationSession,
  message:
    | { type: "pause-automation"; message?: string }
    | { type: "start-automation"; session: AutomationSession }
): Promise<void> {
  const payload =
    message.type === "start-automation"
      ? {
          ...message,
          session: (await getDecoratedSession(session.tabId)) ?? message.session,
        }
      : message;

  if (typeof session.controllerFrameId === "number") {
    await chrome.tabs.sendMessage(session.tabId, payload, {
      frameId: session.controllerFrameId,
    });
    return;
  }

  await chrome.tabs.sendMessage(session.tabId, payload);
}

function scheduleSessionRestartOnTabComplete(
  tabId: number,
  timeoutMs = 20_000
): void {
  let settled = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const cleanup = () => {
    if (settled) {
      return;
    }

    settled = true;
    chrome.tabs.onUpdated.removeListener(handleUpdated);
    chrome.tabs.onRemoved.removeListener(handleRemoved);
    if (timeoutId !== null) {
      globalThis.clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  const handleRemoved = (removedTabId: number) => {
    if (removedTabId !== tabId) {
      return;
    }

    cleanup();
  };

  const handleUpdated = (
    updatedTabId: number,
    changeInfo: { status?: string }
  ) => {
    if (updatedTabId !== tabId || changeInfo.status !== "complete") {
      return;
    }

    cleanup();
    void (async () => {
      const latestSession = await getSession(tabId);
      if (
        !latestSession ||
        latestSession.site === "unsupported" ||
        !latestSession.shouldResume ||
        (latestSession.phase !== "running" &&
          latestSession.phase !== "waiting_for_verification")
      ) {
        return;
      }

      try {
        await sendSessionControlMessage(latestSession, {
          type: "start-automation",
          session: latestSession,
        });
      } catch {
        // The content script may still not be ready; content-ready can still recover.
      }
    })();
  };

  chrome.tabs.onUpdated.addListener(handleUpdated);
  chrome.tabs.onRemoved.addListener(handleRemoved);
  timeoutId = globalThis.setTimeout(() => {
    cleanup();
  }, timeoutMs);
}

async function pauseAutomationSession(
  tabId: number,
  message?: string
): Promise<{
  ok: boolean;
  error?: string;
  session?: AutomationSession;
}> {
  const session = await getSession(tabId);

  if (!session || session.site === "unsupported") {
    return {
      ok: false,
      error: "No active automation session was found on this tab.",
    };
  }

  if (
    session.phase !== "running" &&
    session.phase !== "waiting_for_verification" &&
    session.phase !== "paused"
  ) {
    return {
      ok: false,
      error: "Pause is only available while automation is actively running.",
    };
  }

  const pauseMessage =
    message?.trim() || "Automation paused. Press Resume to continue.";
  const nextSession: AutomationSession = {
    ...session,
    phase: "paused",
    message: pauseMessage,
    updatedAt: Date.now(),
    shouldResume: false,
  };

  await setSession(nextSession);

  try {
    await sendSessionControlMessage(nextSession, {
      type: "pause-automation",
      message: pauseMessage,
    });
  } catch {
    // The content script may still be loading. The stored paused session state
    // is enough for popup refresh and later resume.
  }

  return {
    ok: true,
    session: nextSession,
  };
}

async function resumeAutomationSession(
  tabId: number
): Promise<{
  ok: boolean;
  error?: string;
  session?: AutomationSession;
}> {
  const session = await getSession(tabId);

  if (!session || session.site === "unsupported") {
    return {
      ok: false,
      error: "No paused automation session was found on this tab.",
    };
  }

  if (session.phase !== "paused") {
    return {
      ok: false,
      error: "Resume is only available for paused automation.",
    };
  }

  const nextSession: AutomationSession = {
    ...session,
    phase: "running",
    message: "Resuming automation...",
    updatedAt: Date.now(),
    shouldResume: true,
  };

  await setSession(nextSession);

  try {
    await sendSessionControlMessage(nextSession, {
      type: "start-automation",
      session: nextSession,
    });
  } catch {
    // The content script may still be loading; content-ready will restart it.
  }

  return {
    ok: true,
    session: (await getDecoratedSession(tabId)) ?? nextSession,
  };
}

async function markManualSubmitDetected(
  tabId: number
): Promise<{
  ok: boolean;
  error?: string;
  session?: AutomationSession;
}> {
  const session = await getSession(tabId);

  if (!session || session.site === "unsupported") {
    return {
      ok: false,
      error: "No active automation session was found on this tab.",
    };
  }

  const nextSession: AutomationSession = {
    ...session,
    manualSubmitPending: true,
  };

  await setSession(nextSession);

  return {
    ok: true,
    session: (await getDecoratedSession(tabId)) ?? nextSession,
  };
}

async function markJobReviewed(
  tabId: number,
  fallbackUrl?: string
): Promise<{
  ok: boolean;
  error?: string;
  session?: AutomationSession;
}> {
  const session = await getSession(tabId);

  if (!session || session.site === "unsupported") {
    return {
      ok: false,
      error: "No active automation session was found on this tab.",
    };
  }

  const completionKey = await resolveManagedJobCompletionKey(
    session,
    tabId,
    fallbackUrl
  );
  if (completionKey) {
    await rememberReviewedJobKey(completionKey);
  }

  return {
    ok: true,
    session: (await getDecoratedSession(tabId)) ?? session,
  };
}

async function stopAutomationRun(
  tabId: number,
  message?: string
): Promise<{
  ok: boolean;
  error?: string;
  session?: AutomationSession;
}> {
  const session = await getSession(tabId);

  if (!session || session.site === "unsupported") {
    return {
      ok: false,
      error: "No active automation session was found on this tab.",
    };
  }

  const stopMessage =
    message?.trim() || "Automation stopped. Press Start to begin again.";

  if (!session.runId) {
    const nextSession: AutomationSession = {
      ...session,
      phase: "completed",
      message: stopMessage,
      updatedAt: Date.now(),
      shouldResume: false,
    };

    await setSession(nextSession);

    try {
      await chrome.tabs.sendMessage(tabId, {
        type: "stop-automation",
        message: stopMessage,
      });
    } catch {
      // The stored stopped session is enough if content is not ready.
    }

  return {
    ok: true,
    session: (await getDecoratedSession(tabId)) ?? nextSession,
  };
}

  const runId = session.runId;
  const runSessions = await listSessionsForRunId(runId);

  await withRunLock(runId, async () => {
    const runState = await getRunState(runId);
    if (runState) {
      await setRunState({
        ...runState,
        queuedJobItems: [],
        stopRequested: true,
        updatedAt: Date.now(),
      });
    }
  });

  for (const runSession of runSessions) {
    const nextSession: AutomationSession = {
      ...runSession,
      phase: "completed",
      message: stopMessage,
      updatedAt: Date.now(),
      shouldResume: false,
      manualSubmitPending: false,
    };
    await setSession(nextSession);

    try {
      await chrome.tabs.sendMessage(runSession.tabId, {
        type: "stop-automation",
        message: stopMessage,
      });
    } catch {
      // Ignore tabs whose content script is not currently reachable.
    }
  }

  const stoppedSession = await getDecoratedSession(tabId);

  return {
    ok: true,
    session:
      stoppedSession ??
      ({
        ...session,
        phase: "completed",
        message: stopMessage,
        updatedAt: Date.now(),
        shouldResume: false,
        manualSubmitPending: false,
      } as AutomationSession),
  };
}

async function attachSessionToSiteOpenedChildTab(
  tab: chrome.tabs.Tab
): Promise<void> {
  const childTabId = tab.id;
  const openerTabId = tab.openerTabId;

  if (childTabId === undefined || openerTabId === undefined) {
    return;
  }

  if (consumePendingExtensionSpawn(openerTabId)) {
    return;
  }

  const openerSession = await getSession(openerTabId);

  if (!openerSession) {
    return;
  }

  if (
    openerSession.site === "unsupported" ||
    (openerSession.phase !== "running" &&
      openerSession.phase !== "waiting_for_verification") ||
    (openerSession.stage !== "open-apply" &&
      openerSession.stage !== "autofill-form")
  ) {
    return;
  }

  if (await hasLiveManagedChildSessionForClaimedJob(openerSession, openerTabId)) {
    if (openerSession.site === "builtin") {
      try {
        await chrome.tabs.remove(childTabId);
      } catch {
        // Ignore close failures for transient tabs.
      }
    }
    return;
  }

  const childSession = createSession(
    childTabId,
    openerSession.site,
    "running",
    `Continuing ${getReadableSiteName(openerSession.site)} application in a new tab...`,
    true,
    "open-apply",
    openerSession.runId,
    openerSession.label,
    openerSession.keyword,
    openerSession.resumeKind,
    openerSession.profileId
  );

  childSession.jobSlots = openerSession.jobSlots;
  childSession.claimedJobKey = openerSession.claimedJobKey;
  childSession.openedUrlKey =
    getSpawnDedupKey(getTabUrl(tab as BackgroundSourceTab)) ??
    openerSession.openedUrlKey;

  await setSession(childSession);
  scheduleSessionRestartOnTabComplete(childTabId);

  try {
    await sendSessionControlMessage(childSession, {
      type: "start-automation",
      session: childSession,
    });
  } catch {
    // The child tab may still be loading; content-ready or the tab-complete
    // restart hook can still recover.
  }

  try {
    await chrome.tabs.sendMessage(openerTabId, {
      type: "automation-child-tab-opened",
    });
  } catch {
    // The opener tab may already be navigating or closing.
  }

  if (!shouldKeepManagedJobPageOpen(openerSession.site)) {
    await removeSession(openerTabId);
    try {
      await chrome.tabs.remove(openerTabId);
    } catch {
      // The opener tab may already be closing.
    }
  }
}

async function hasLiveManagedChildSessionForClaimedJob(
  openerSession: AutomationSession,
  openerTabId: number
): Promise<boolean> {
  const runId = openerSession.runId?.trim();
  const claimedJobKey = openerSession.claimedJobKey?.trim();

  if (!runId || !claimedJobKey) {
    return false;
  }

  const liveSessions = await listLiveSessionsForRunId(runId);

  return liveSessions.some(
    (session) =>
      session.tabId !== openerTabId &&
      session.claimedJobKey?.trim() === claimedJobKey &&
      isManagedJobSession(session)
  );
}

async function closeManagedOpenerJobTabForCompletedChild(
  session: AutomationSession,
  senderTab?: chrome.tabs.Tab
): Promise<void> {
  const openerTabId = senderTab?.openerTabId;

  if (
    typeof openerTabId !== "number" ||
    openerTabId === session.tabId
  ) {
    return;
  }

  const openerSession = await getSession(openerTabId);
  const completedClaimedKey = session.claimedJobKey?.trim();
  const openerClaimedKey = openerSession?.claimedJobKey?.trim();

  if (
    !openerSession ||
    !shouldKeepManagedJobPageOpen(openerSession.site) ||
    !completedClaimedKey ||
    !openerClaimedKey ||
    completedClaimedKey !== openerClaimedKey
  ) {
    return;
  }

  await removeSession(openerTabId);

  try {
    await chrome.tabs.remove(openerTabId);
  } catch {
    // The opener tab may already be closing.
  }
}

async function startAutomationForTab(
  tabId: number
): Promise<{
  ok: boolean;
  error?: string;
  session?: AutomationSession;
}> {
  const tab = await resolvePreferredTab(tabId, "job_board");

  if (!tab || tab.id === undefined) {
    return {
      ok: false,
      error:
        "The active tab could not be accessed. Focus an Indeed, ZipRecruiter, Dice, Monster, Glassdoor, Greenhouse, or Built In page and try again.",
    };
  }

  const resolvedTabId = tab.id;
  const site = await detectJobBoardSiteForTab(
    resolvedTabId,
    getTabUrl(tab)
  );
  const settings = await readAutomationSettings();
  const runId = createRunId();
  const searchKeywords = parseSearchKeywords(settings.searchKeywords);

  if (!isJobBoardSite(site)) {
    return {
      ok: false,
      error:
        "Open an Indeed, ZipRecruiter, Dice, Monster, Glassdoor, Greenhouse, or Built In page first.",
    };
  }

  if (searchKeywords.length === 0) {
    return {
      ok: false,
      error: "Add at least one search keyword in the extension before starting automation.",
    };
  }

  await setRunState({
    id: runId,
    jobPageLimit: settings.jobPageLimit,
    openedJobPages: 0,
    openedJobKeys: [],
    successfulJobPages: 0,
    successfulJobKeys: [],
    queuedJobItems: [],
    stopRequested: false,
    updatedAt: Date.now(),
  });

  await addActiveRunId(runId);

  const session = createSession(
    resolvedTabId,
    site,
    "running",
    `Preparing ${getReadableSiteName(site)} automation...`,
    true,
    "bootstrap",
    runId,
    undefined,
    undefined,
    undefined,
    settings.activeProfileId
  );

  await setSession(session);

  try {
    await reloadTabAndWait(resolvedTabId);
  } catch {
    await removeSession(resolvedTabId);
    await removeRunState(runId);
    await removeActiveRunId(runId);
    return {
      ok: false,
      error: "The page could not be reloaded to start a clean automation run.",
    };
  }

  return {
    ok: true,
    session,
  };
}

async function startStartupAutomation(
  tabId?: number
): Promise<{
  ok: boolean;
  error?: string;
  opened?: number;
  regionLabel?: string;
}> {
  const sourceTab = await resolvePreferredTab(tabId, "web_page");
  const settings = await readAutomationSettings();
  const runId = createRunId();
  const searchKeywords = parseSearchKeywords(settings.searchKeywords);
  const startupCompanies = await refreshStartupCompanies();
  const targetRegions = resolveStartupTargetRegions(
    settings.startupRegion,
    settings.candidate.country
  );

  if (searchKeywords.length === 0) {
    return {
      ok: false,
      error: "Add at least one search keyword in the extension before starting startup automation.",
    };
  }

  const targets = await filterReachableSearchTargets(
    buildStartupSearchTargets(settings, startupCompanies)
  );

  if (targets.length === 0) {
    return {
      ok: false,
      error: "No startup career pages are currently reachable for the selected region.",
    };
  }

  const items: SpawnTabRequest[] = targets
    .map((target, index) => ({
      url: target.url,
      site: "startup" as const,
      stage: "collect-results" as const,
      runId,
      active: index === 0,
      message: `Collecting ${target.label} roles...`,
      label: target.label,
      resumeKind: target.resumeKind,
      profileId: settings.activeProfileId,
      keyword: target.keyword,
    }));

  // Preserve search-specific query params when deduplicating startup targets.
  const dedupedItems = deduplicateSpawnItems(items)
    .slice(0, 1)
    .map((item, index) => ({
      ...item,
      active: index === 0,
    }));

  await setRunState({
    id: runId,
    jobPageLimit: settings.jobPageLimit,
    openedJobPages: 0,
    openedJobKeys: [],
    successfulJobPages: 0,
    successfulJobKeys: [],
    queuedJobItems: [],
    stopRequested: false,
    updatedAt: Date.now(),
  });

  await addActiveRunId(runId);

  let openedCount = 0;
  let firstCreateError: string | undefined;

  for (const [offset, item] of dedupedItems.entries()) {
    const createProperties: chrome.tabs.CreateProperties = {
      url: item.url,
      active: item.active ?? false,
    };

    if (sourceTab?.windowId !== undefined) {
      createProperties.windowId = sourceTab.windowId;
    }

    if (sourceTab?.index !== undefined) {
      createProperties.index = sourceTab.index + offset + 1;
    }

    let createdTab: chrome.tabs.Tab;
    try {
      createdTab = await chrome.tabs.create(createProperties);
      openedCount += 1;
    } catch (error: unknown) {
      if (!firstCreateError && error instanceof Error && error.message) {
        firstCreateError = error.message;
      }
      continue;
    }

    if (item.stage && createdTab.id !== undefined) {
      const childSession = createSession(
        createdTab.id,
        item.site,
        "running",
        item.message ?? `Starting ${getReadableStageName(item.stage)}...`,
        true,
        item.stage,
        item.runId,
        item.label,
        item.keyword,
        item.resumeKind,
        item.profileId ?? settings.activeProfileId
      );
      childSession.jobSlots = item.jobSlots;

      await setSession(childSession);
    }

    await delay(SEARCH_OPEN_DELAY_MS);
  }

  if (openedCount === 0) {
    await removeRunState(runId);
    await removeActiveRunId(runId);
    return {
      ok: false,
      error:
        firstCreateError ??
        "The browser blocked opening the startup career tabs.",
    };
  }

  return {
    ok: true,
    opened: openedCount,
    regionLabel: formatStartupRegionList(targetRegions),
  };
}

async function startOtherSitesAutomation(
  tabId?: number
): Promise<{
  ok: boolean;
  error?: string;
  opened?: number;
  regionLabel?: string;
}> {
  const sourceTab = await resolvePreferredTab(tabId, "web_page");
  const settings = await readAutomationSettings();
  const runId = createRunId();
  const searchKeywords = parseSearchKeywords(settings.searchKeywords);
  const targetRegions = resolveStartupTargetRegions(
    settings.startupRegion,
    settings.candidate.country
  );

  if (searchKeywords.length === 0) {
    return {
      ok: false,
      error: "Add at least one search keyword in the extension before starting other job site automation.",
    };
  }

  const targets = await filterReachableSearchTargets(
    buildOtherJobSiteTargets(settings)
  );

  if (targets.length === 0) {
    return {
      ok: false,
      error: "No other job site searches are currently reachable for the selected region.",
    };
  }

  const items: SpawnTabRequest[] = targets
    .map((target, index) => ({
      url: target.url,
      site: "other_sites" as const,
      stage: "collect-results" as const,
      runId,
      active: index === 0,
      message: `Collecting ${target.label} roles...`,
      label: target.label,
      resumeKind: target.resumeKind,
      profileId: settings.activeProfileId,
      keyword: target.keyword,
    }));

  // Preserve search-specific query params when deduplicating other-site targets.
  const dedupedItems = deduplicateSpawnItems(items)
    .slice(0, 1)
    .map((item, index) => ({
      ...item,
      active: index === 0,
    }));

  await setRunState({
    id: runId,
    jobPageLimit: settings.jobPageLimit,
    openedJobPages: 0,
    openedJobKeys: [],
    successfulJobPages: 0,
    successfulJobKeys: [],
    queuedJobItems: [],
    stopRequested: false,
    updatedAt: Date.now(),
  });

  await addActiveRunId(runId);

  let openedCount = 0;
  let firstCreateError: string | undefined;

  for (const [offset, item] of dedupedItems.entries()) {
    const createProperties: chrome.tabs.CreateProperties = {
      url: item.url,
      active: item.active ?? false,
    };

    if (sourceTab?.windowId !== undefined) {
      createProperties.windowId = sourceTab.windowId;
    }

    if (sourceTab?.index !== undefined) {
      createProperties.index = sourceTab.index + offset + 1;
    }

    let createdTab: chrome.tabs.Tab;
    try {
      createdTab = await chrome.tabs.create(createProperties);
      openedCount += 1;
    } catch (error: unknown) {
      if (!firstCreateError && error instanceof Error && error.message) {
        firstCreateError = error.message;
      }
      continue;
    }

    if (item.stage && createdTab.id !== undefined) {
      const childSession = createSession(
        createdTab.id,
        item.site,
        "running",
        item.message ?? `Starting ${getReadableStageName(item.stage)}...`,
        true,
        item.stage,
        item.runId,
        item.label,
        item.keyword,
        item.resumeKind,
        item.profileId ?? settings.activeProfileId
      );
      childSession.jobSlots = item.jobSlots;

      await setSession(childSession);
    }

    await delay(SEARCH_OPEN_DELAY_MS);
  }

  if (openedCount === 0) {
    await removeRunState(runId);
    await removeActiveRunId(runId);
    return {
      ok: false,
      error:
        firstCreateError ??
        "The browser blocked opening the other job site tabs.",
    };
  }

  return {
    ok: true,
    opened: openedCount,
    regionLabel: formatStartupRegionList(targetRegions),
  };
}

async function filterReachableSearchTargets(
  targets: SearchTarget[]
): Promise<SearchTarget[]> {
  const results = await Promise.all(
    targets.map((target) => probeSearchTarget(target))
  );
  const reachable = results
    .filter((result) => result.ok)
    .map((result) => result.target);

  if (reachable.length > 0) {
    return reachable;
  }

  return results
    .filter((result) => !result.hardFailure)
    .map((result) => result.target);
}

async function probeApplicationTargetUrl(url: string): Promise<{
  ok: boolean;
  reachable: boolean;
  reason?: ProbedTargetFailureReason;
}> {
  const result = await probeUrlForHardFailure(url);
  return {
    ok: true,
    reachable: !result.reason,
    reason: result.reason ?? undefined,
  };
}

async function probeUrlForHardFailure(
  url: string
): Promise<{ reason: ProbedTargetFailureReason | null }> {
  const timeout = 8_000;
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
    });

    if (
      response.status === 401 ||
      response.status === 403
    ) {
      return { reason: "access_denied" };
    }

    if (
      response.status === 404 ||
      response.status === 410
    ) {
      return { reason: "not_found" };
    }

    if (response.status >= 500) {
      return { reason: "bad_gateway" };
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType && !contentType.includes("text/html")) {
      return { reason: "unreachable" };
    }

    // Some Chrome responses omit `url`; fall back safely when that happens.
    let finalUrl = "";
    try {
      finalUrl = response.url?.toLowerCase() ?? "";
    } catch {
      // Response URL may not be available in some contexts
    }
    
    if (
      finalUrl &&
      ["/404", "not-found", "page-not-found", "/error", "/unavailable"].some((token) =>
        finalUrl.includes(token)
      )
    ) {
      return { reason: "not_found" };
    }

    const bodyText = (await response.text()).toLowerCase().replace(/\s+/g, " ").slice(0, 3000);
    if (bodyText.includes("access denied") || bodyText.includes("accessdenied")) {
      return { reason: "access_denied" };
    }

    if (
      bodyText.includes("bad gateway") ||
      bodyText.includes("error reference number: 502") ||
      bodyText.includes("web server reported a bad gateway error") ||
      bodyText.includes("gateway time-out") ||
      bodyText.includes("gateway timeout") ||
      bodyText.includes("error reference number: 504") ||
      bodyText.includes("web server reported a gateway time-out error") ||
      bodyText.includes("web server reported a gateway timeout error")
    ) {
      return { reason: "bad_gateway" };
    }

    if (
      [
        "page not found",
        "this page does not exist",
        "this page doesn t exist",
        "the page you were looking for does not exist",
        "the page you were looking for doesn't exist",
        "the page you requested could not be found",
        "requested page could not be found",
        "temporarily unavailable",
        "service unavailable",
      ].some((token) => bodyText.includes(token))
    ) {
      return { reason: "not_found" };
    }

    return { reason: null };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { reason: null };
    }

    if (isHardSearchTargetProbeError(error)) {
      return { reason: "unreachable" };
    }

    return { reason: null };
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

async function probeSearchTarget(target: SearchTarget): Promise<{
  target: SearchTarget;
  ok: boolean;
  hardFailure: boolean;
}> {
  const result = await probeUrlForHardFailure(target.url);
  if (!result.reason) {
    return {
      target,
      ok: true,
      hardFailure: false,
    };
  }

  return {
    target,
    ok: false,
    hardFailure: true,
  };
}

function isHardSearchTargetProbeError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return [
    "err_name_not_resolved",
    "name not resolved",
    "enotfound",
    "dns",
    "econnrefused",
    "err_connection_refused",
    "invalid url",
    "failed to parse url",
    "unsupported protocol",
  ].some((token) => message.includes(token));
}

async function queueJobTabsForSender(
  sender: chrome.runtime.MessageSender,
  items: SpawnTabRequest[]
): Promise<{
  ok: boolean;
  error?: string;
  queued: number;
  opened: number;
  summary?: AutomationRunSummary | null;
}> {
  const tabId = sender.tab?.id;

  if (tabId === undefined) {
    return {
      ok: false,
      error: "Missing source tab.",
      queued: 0,
      opened: 0,
    };
  }

  const session = await getSession(tabId);
  const runId = session?.runId?.trim();
  if (!runId) {
    return {
      ok: false,
      error: "No active automation run was found for this tab.",
      queued: 0,
      opened: 0,
    };
  }

  const sourceTab = await getTabSafely(tabId);
  const queued = await enqueueJobTabsForRunId(runId, items, sourceTab);
  const opened = await maybeOpenNextQueuedJobForRunId(runId, sourceTab);

  return {
    ok: true,
    queued,
    opened,
    summary: await getRunSummaryForSession(session),
  };
}

async function enqueueJobTabsForRunId(
  runId: string,
  items: SpawnTabRequest[],
  sourceTab: BackgroundSourceTab | null
): Promise<number> {
  return withRunLock(runId, async () => {
    const runState = await getRunState(runId);
    if (!runState || runState.stopRequested) {
      return 0;
    }

    const blockedJobKeys = await loadBlockedJobKeySet();
    const seenKeys = new Set([
      ...(runState.openedJobKeys ?? []),
      ...(runState.successfulJobKeys ?? []),
      ...runState.queuedJobItems
        .map((item) => item.claimedJobKey?.trim() || getJobDedupKey(item.url))
        .filter((key): key is string => Boolean(key)),
    ]);
    const queuedJobItems = [...runState.queuedJobItems];
    let queuedCount = 0;

    for (const item of items) {
      if (!isManagedJobStage(item.stage) || !item.url.trim()) {
        continue;
      }

      const claimedJobKey = item.claimedJobKey?.trim() || getJobDedupKey(item.url);
      if (!claimedJobKey) {
        continue;
      }

      if (
        seenKeys.has(claimedJobKey) ||
        blockedJobKeys.has(claimedJobKey)
      ) {
        continue;
      }

      seenKeys.add(claimedJobKey);
      queuedJobItems.push({
        ...item,
        claimedJobKey,
        active: item.active ?? true,
        sourceTabId: sourceTab?.id,
        sourceWindowId: sourceTab?.windowId,
        sourceTabIndex: sourceTab?.index,
        enqueuedAt: Date.now() + queuedCount,
      });
      queuedCount += 1;
    }

    if (queuedCount <= 0) {
      return 0;
    }

    await setRunState({
      ...runState,
      openedJobPages: runState.openedJobPages + queuedCount,
      openedJobKeys: Array.from(seenKeys),
      queuedJobItems,
      updatedAt: Date.now(),
    });

    return queuedCount;
  });
}

async function maybeOpenNextQueuedJobForRunId(
  runId: string,
  preferredSourceTab?: BackgroundSourceTab | null
): Promise<number> {
  const nextItem = await withRunLock(runId, async () => {
    const runState = await getRunState(runId);
    if (
      !runState ||
      runState.stopRequested ||
      runState.queuedJobItems.length === 0 ||
      (Number.isFinite(runState.rateLimitedUntil) &&
        Date.now() < Number(runState.rateLimitedUntil))
    ) {
      return null;
    }

    const runSessions = await listSessionsForRunId(runId);
    const hasBlockingManagedSession = runSessions.some(
      (session) =>
        isManagedJobSession(session) &&
        session.phase !== "completed" &&
        session.phase !== "error" &&
        session.phase !== "queued"
    );

    if (hasBlockingManagedSession) {
      return null;
    }

    const [item, ...remainingQueue] = runState.queuedJobItems;
    await setRunState({
      ...runState,
      queuedJobItems: remainingQueue,
      updatedAt: Date.now(),
    });

    return item ?? null;
  });

  if (!nextItem) {
    return 0;
  }

  try {
    await openQueuedJobItem(nextItem, preferredSourceTab);
    return 1;
  } catch (error) {
    const claimedJobKey =
      nextItem.claimedJobKey?.trim() || getJobDedupKey(nextItem.url);
    if (claimedJobKey) {
      await releaseJobOpeningsForRunId(runId, [claimedJobKey]);
    }
    return maybeOpenNextQueuedJobForRunId(runId, preferredSourceTab);
  }
}

async function openQueuedJobItem(
  item: AutomationQueuedJobItem,
  preferredSourceTab?: BackgroundSourceTab | null
): Promise<void> {
  const liveSourceTab =
    (typeof item.sourceTabId === "number"
      ? await getTabSafely(item.sourceTabId)
      : null) ??
    preferredSourceTab ??
    null;
  const indexBase =
    liveSourceTab?.index ??
    item.sourceTabIndex ??
    0;
  const createdTab = await createExtensionSpawnTab(
    {
      url: item.url,
      site: item.site,
      active: item.active ?? true,
      stage: item.stage,
      runId: item.runId,
      claimedJobKey: item.claimedJobKey,
      message: item.message,
      label: item.label,
      resumeKind: item.resumeKind,
      profileId: item.profileId,
      keyword: item.keyword,
    },
    {
      sourceTabId: liveSourceTab?.id,
      windowId: liveSourceTab?.windowId ?? item.sourceWindowId,
      index: indexBase + 1,
    }
  );

  if (!item.stage || createdTab.id === undefined) {
    return;
  }

  const session = createSession(
    createdTab.id,
    item.site,
    "running",
    item.message ?? `Starting ${getReadableStageName(item.stage)}...`,
    true,
    item.stage,
    item.runId,
    item.label,
    item.keyword,
    item.resumeKind,
    item.profileId
  );

  session.claimedJobKey = item.claimedJobKey;
  session.openedUrlKey = getSpawnDedupKey(item.url) || undefined;

  await setSession(session);
  scheduleSessionRestartOnTabComplete(createdTab.id);
  const openDelayMs = getSpawnOpenDelayMs(item);
  const eagerStartDelayMs = Math.min(openDelayMs, 600);
  if (eagerStartDelayMs > 0) {
    await delay(eagerStartDelayMs);
  }
  try {
    await sendSessionControlMessage(session, {
      type: "start-automation",
      session,
    });
  } catch {
    // The content script may still be loading; content-ready will restart it.
  }
  if (openDelayMs > eagerStartDelayMs) {
    await delay(openDelayMs - eagerStartDelayMs);
  }
}

async function releaseJobOpeningsForItems(
  items: SpawnTabRequest[]
): Promise<void> {
  const grouped = new Map<string, string[]>();

  for (const item of items) {
    const runId = item.runId?.trim();
    const key = item.claimedJobKey?.trim() || getJobDedupKey(item.url);

    if (!runId || !key) {
      continue;
    }

    const existing = grouped.get(runId) ?? [];
    existing.push(key);
    grouped.set(runId, existing);
  }

  for (const [runId, keys] of grouped) {
    await releaseJobOpeningsForRunId(runId, keys);
  }
}

async function releaseJobOpeningsForRunId(
  runId: string,
  releasedKeys: string[]
): Promise<void> {
  if (releasedKeys.length === 0) {
    return;
  }

  await withRunLock(runId, async () => {
    const runState = await getRunState(runId);

    if (!runState) {
      return;
    }

    const uniqueReleasedKeys = Array.from(new Set(releasedKeys));
    const openKeySet = new Set(runState.openedJobKeys ?? []);
    let releasedCount = 0;

    for (const key of uniqueReleasedKeys) {
      if (!openKeySet.delete(key)) {
        continue;
      }

      releasedCount += 1;
    }

    if (releasedCount <= 0) {
      return;
    }

    await setRunState({
      ...runState,
      openedJobPages: Math.max(0, runState.openedJobPages - releasedCount),
      openedJobKeys: Array.from(openKeySet),
      updatedAt: Date.now(),
    });
  });
}

async function markRunRateLimited(runId: string): Promise<void> {
  await withRunLock(runId, async () => {
    const runState = await getRunState(runId);

    if (!runState) {
      return;
    }

    await setRunState({
      ...runState,
      rateLimitedUntil: Date.now() + RATE_LIMIT_COOLDOWN_MS,
      updatedAt: Date.now(),
    });
  });
}

async function resolveManagedJobCompletionKey(
  session: AutomationSession | null,
  tabId: number,
  fallbackUrl?: string
): Promise<string> {
  if (session?.claimedJobKey?.trim()) {
    return session.claimedJobKey.trim();
  }

  if (fallbackUrl) {
    const fallbackKey = getJobDedupKey(fallbackUrl);
    if (fallbackKey) {
      return fallbackKey;
    }
  }

  try {
    const tab = await chrome.tabs.get(tabId);
    return getJobDedupKey(getTabUrl(tab));
  } catch {
    return "";
  }
}

async function recordSuccessfulJobCompletion(
  runId: string,
  tabId: number,
  fallbackUrl?: string
): Promise<void> {
  await withRunLock(runId, async () => {
    const runState = await getRunState(runId);

    if (!runState) {
      return;
    }

    const session = await getSession(tabId);
    const completionKey = await resolveManagedJobCompletionKey(
      session,
      tabId,
      fallbackUrl
    );

    if (!completionKey) {
      return;
    }

    const successfulKeys = new Set(runState.successfulJobKeys);
    if (successfulKeys.has(completionKey)) {
      return;
    }

    successfulKeys.add(completionKey);

    await setRunState({
      ...runState,
      successfulJobPages: runState.successfulJobPages + 1,
      successfulJobKeys: Array.from(successfulKeys),
      updatedAt: Date.now(),
    });

    await rememberReviewedJobKey(completionKey);
    await rememberAppliedJobKey(completionKey);
  });
}

async function releaseManagedJobOpening(
  runId: string,
  tabId: number,
  fallbackUrl?: string
): Promise<void> {
  const session = await getSession(tabId);
  const completionKey = await resolveManagedJobCompletionKey(
    session,
    tabId,
    fallbackUrl
  );
  if (!completionKey) {
    return;
  }

  await rememberReviewedJobKey(completionKey);
  await releaseJobOpeningsForRunId(runId, [completionKey]);
}

type LiveRunSessionInfo = {
  session: AutomationSession;
  liveUrl: string;
  urlKey: string;
  isApplyTarget: boolean;
};

async function listLiveRunSessionInfos(
  runId: string
): Promise<LiveRunSessionInfo[]> {
  const sessions = await listLiveSessionsForRunId(runId);
  const infos: LiveRunSessionInfo[] = [];

  for (const session of sessions) {
    const liveTab = await getTabSafely(session.tabId);
    // A tab is considered stale if getTabSafely returns null.
    // Note: getTabSafely may return a minimal tab object { id } for closed tabs,
    // but we keep the session if it has an openedUrlKey (indicating it was successfully opened)
    if (!liveTab) {
      await removeSession(session.tabId);
      continue;
    }

    const liveUrl = getTabUrl(liveTab);
    const urlKey =
      getSpawnDedupKey(liveUrl) ??
      session.openedUrlKey ??
      "";
    const applyTarget = isLikelyManagedApplyTarget(
      liveUrl || session.openedUrlKey || "",
      session.site
    );

    infos.push({
      session,
      liveUrl,
      urlKey,
      isApplyTarget: applyTarget,
    });
  }

  return infos;
}

async function resumePendingJobSessionsForRunId(runId: string): Promise<void> {
  const sessionsToResume = await withRunLock(runId, async () => {
    const runState = await getRunState(runId);

    if (!runState) {
      return [] as AutomationSession[];
    }

    if (runState.stopRequested) {
      return [] as AutomationSession[];
    }

    if (
      Number.isFinite(runState.rateLimitedUntil) &&
      Date.now() < Number(runState.rateLimitedUntil)
    ) {
      return [] as AutomationSession[];
    }

    const runSessions = await listSessionsForRunId(runId);
    const activeJobSessions = runSessions.filter(isManagedJobSessionActive);
    const pendingJobSessions = runSessions
      .filter(isManagedJobSessionPending)
      .sort((left, right) => left.updatedAt - right.updatedAt || left.tabId - right.tabId);
    const availableSlots = activeJobSessions.length > 0 ? 0 : 1;

    if (availableSlots <= 0) {
      return [] as AutomationSession[];
    }

    const nextSessions = pendingJobSessions
      .slice(0, availableSlots)
      .map((session, index) => ({
        ...session,
        shouldResume: true,
        phase: "running" as const,
        message: `Starting ${getReadableStageName(session.stage)}...`,
        updatedAt: Date.now() + index,
      }));

    for (const session of nextSessions) {
      await setSession(session);
    }

    return nextSessions;
  });

  for (const session of sessionsToResume) {
    try {
      await sendSessionControlMessage(session, {
        type: "start-automation" as const,
        session,
      });
    } catch {
      // The content script may still be loading; content-ready will pick this up.
    }
  }
}

async function withRunLock<T>(
  runId: string,
  task: () => Promise<T>
): Promise<T> {
  const previous = runLocks.get(runId) ?? Promise.resolve();
  let releaseLock = () => {};
  const current = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  runLocks.set(runId, current);
  await previous.catch(() => {});

  try {
    return await task();
  } finally {
    releaseLock();

    if (runLocks.get(runId) === current) {
      runLocks.delete(runId);
    }
  }
}

function getSpawnOpenDelayMs(item: SpawnTabRequest): number {
  if (item.site === "ziprecruiter") {
    return ZIPRECRUITER_SPAWN_DELAY_MS;
  }

  if (item.site === "monster") {
    return MONSTER_SPAWN_DELAY_MS;
  }

  return SEARCH_OPEN_DELAY_MS;
}

function capJobOpeningItems(
  items: SpawnTabRequest[],
  limit: number
): SpawnTabRequest[] {
  const safeLimit = Math.max(0, Math.floor(limit));
  const capped: SpawnTabRequest[] = [];
  let openedJobItems = 0;

  for (const item of items) {
    const isJobOpeningItem =
      item.stage === "open-apply" || item.stage === "autofill-form";

    if (!isJobOpeningItem) {
      capped.push(item);
      continue;
    }

    if (openedJobItems >= safeLimit) {
      continue;
    }

    capped.push(item);
    openedJobItems += 1;
  }

  return capped;
}

function isLikelyManagedApplyTarget(
  urlOrKey: string,
  site: SiteKey | "unsupported"
): boolean {
  if (site === "unsupported") {
    return false;
  }

  const lower = urlOrKey.trim().toLowerCase();
  if (!lower) {
    return false;
  }

  if (
    site === "ziprecruiter" &&
    (lower.includes("/candidate/") ||
      lower.includes("/my-jobs") ||
      lower.includes("/myjobs") ||
      lower.includes("/saved-jobs") ||
      lower.includes("/savedjobs") ||
      lower.includes("/profile") ||
      lower.includes("/account") ||
      lower.includes("/login") ||
      lower.includes("/signin")) &&
    !lower.includes("candidateexperience") &&
    !lower.includes("jobapply")
  ) {
    return false;
  }

  return (
    lower.includes("smartapply.indeed.com") ||
    lower.includes("indeedapply") ||
    lower.includes("zipapply") ||
    lower.includes("easyapply") ||
    lower.includes("easy-apply") ||
    lower.includes("/job-applications/") ||
    lower.includes("start-apply") ||
    lower.includes("/apply") ||
    lower.includes("application") ||
    lower.includes("candidateexperience") ||
    lower.includes("jobapply") ||
    lower.includes("job_app") ||
    lower.includes("applytojob")
  );
}

function canOpenSeparateApplyTabForClaimedJob(
  item: SpawnTabRequest,
  claimedKey: string | null | undefined,
  existingApplyClaimedKeys: Set<string>
): boolean {
  if (!claimedKey || !shouldKeepManagedJobPageOpen(item.site)) {
    return false;
  }

  if (existingApplyClaimedKeys.has(claimedKey)) {
    return false;
  }

  return isLikelyManagedApplyTarget(item.url, item.site);
}

async function filterManagedSpawnItemsByStoredHistory(
  items: SpawnTabRequest[]
): Promise<{ items: SpawnTabRequest[]; skippedItems: SpawnTabRequest[] }> {
  const blockedJobKeys = await loadBlockedJobKeySet();
  if (blockedJobKeys.size === 0) {
    return {
      items,
      skippedItems: [],
    };
  }

  const filtered: SpawnTabRequest[] = [];
  const skippedItems: SpawnTabRequest[] = [];

  for (const item of items) {
    if (!isManagedJobStage(item.stage)) {
      filtered.push(item);
      continue;
    }

    const claimedJobKey = item.claimedJobKey?.trim() || getJobDedupKey(item.url);
    if (!claimedJobKey || !blockedJobKeys.has(claimedJobKey)) {
      filtered.push(item);
      continue;
    }

    skippedItems.push(item);
  }

  return {
    items: filtered,
    skippedItems,
  };
}

async function filterAlreadyOpenManagedSpawnItems(
  items: SpawnTabRequest[]
): Promise<{ items: SpawnTabRequest[]; skippedItems: SpawnTabRequest[] }> {
  const existingUrlKeysByRunId = new Map<string, Set<string>>();
  const existingClaimedKeysByRunId = new Map<string, Set<string>>();
  const existingApplyClaimedKeysByRunId = new Map<string, Set<string>>();
  const filtered: SpawnTabRequest[] = [];
  const skippedItems: SpawnTabRequest[] = [];

  for (const item of items) {
    if (!item.runId || !isManagedJobStage(item.stage)) {
      filtered.push(item);
      continue;
    }

    const urlKey = getSpawnDedupKey(item.url);
    const claimedKey = item.claimedJobKey?.trim() || getJobDedupKey(item.url);

    let existingUrlKeys = existingUrlKeysByRunId.get(item.runId);
    let existingClaimedKeys = existingClaimedKeysByRunId.get(item.runId);
    let existingApplyClaimedKeys =
      existingApplyClaimedKeysByRunId.get(item.runId);
    if (
      !existingUrlKeys ||
      !existingClaimedKeys ||
      !existingApplyClaimedKeys
    ) {
      const existingSessions = await listLiveRunSessionInfos(item.runId);
      existingUrlKeys = new Set(
        existingSessions
          .filter(
            ({ session }) =>
              session.phase !== "error" && session.phase !== "completed"
          )
          .map(({ urlKey }) => urlKey)
          .filter(Boolean)
      );
      existingClaimedKeys = new Set(
        existingSessions
          .filter(
            ({ session }) =>
              session.phase !== "error" && session.phase !== "completed"
          )
          .map(({ session }) => session.claimedJobKey || "")
          .filter(Boolean)
      );
      existingApplyClaimedKeys = new Set(
        existingSessions
          .filter(
            ({ session }) =>
              session.phase !== "error" && session.phase !== "completed"
          )
          .filter(({ isApplyTarget }) => isApplyTarget)
          .map(({ session }) => session.claimedJobKey || "")
          .filter(Boolean)
      );
      existingUrlKeysByRunId.set(item.runId, existingUrlKeys);
      existingClaimedKeysByRunId.set(item.runId, existingClaimedKeys);
      existingApplyClaimedKeysByRunId.set(item.runId, existingApplyClaimedKeys);
    }

    if (
      claimedKey &&
      existingClaimedKeys.has(claimedKey) &&
      !canOpenSeparateApplyTabForClaimedJob(
        item,
        claimedKey,
        existingApplyClaimedKeys
      )
    ) {
      // Skip this item but DON'T release the slot - the claimed job is already being processed
      continue;
    }

    if (!urlKey) {
      if (claimedKey) {
        existingClaimedKeys.add(claimedKey);
        if (isLikelyManagedApplyTarget(item.url, item.site)) {
          existingApplyClaimedKeys.add(claimedKey);
        }
      }
      filtered.push(item);
      continue;
    }

    if (existingUrlKeys.has(urlKey)) {
      skippedItems.push(item);
      continue;
    }

    existingUrlKeys.add(urlKey);
    if (claimedKey) {
      existingClaimedKeys.add(claimedKey);
      if (isLikelyManagedApplyTarget(item.url, item.site)) {
        existingApplyClaimedKeys.add(claimedKey);
      }
    }
    filtered.push(item);
  }

  return {
    items: filtered,
    skippedItems,
  };
}

function parseJobHistoryEntries(raw: unknown): Map<string, number> {
  const history = new Map<string, number>();

  if (!Array.isArray(raw)) {
    return history;
  }

  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length < 2) {
      continue;
    }

    const [rawKey, rawAt] = entry;
    if (
      typeof rawKey === "string" &&
      rawKey.trim() &&
      Number.isFinite(Number(rawAt))
    ) {
      history.set(rawKey.trim(), Number(rawAt));
    }
  }

  return history;
}

function trimJobHistory(
  history: Map<string, number>,
  maxEntries: number
): Array<[string, number]> {
  return Array.from(history.entries())
    .sort((left, right) => left[1] - right[1])
    .slice(-maxEntries);
}

async function loadAppliedJobHistory(): Promise<Map<string, number>> {
  if (appliedJobHistoryCache) {
    return appliedJobHistoryCache;
  }

  if (appliedJobHistoryLoadPromise) {
    return appliedJobHistoryLoadPromise;
  }

  appliedJobHistoryLoadPromise = (async () => {
    try {
      const stored = await chrome.storage.local.get(APPLIED_JOB_HISTORY_STORAGE_KEY);
      appliedJobHistoryCache = parseJobHistoryEntries(
        stored[APPLIED_JOB_HISTORY_STORAGE_KEY]
      );
      return appliedJobHistoryCache;
    } catch {
      appliedJobHistoryCache = new Map();
      return appliedJobHistoryCache;
    } finally {
      appliedJobHistoryLoadPromise = null;
    }
  })();

  return appliedJobHistoryLoadPromise;
}

async function loadReviewedJobHistory(): Promise<Map<string, number>> {
  if (reviewedJobHistoryCache) {
    return reviewedJobHistoryCache;
  }

  if (reviewedJobHistoryLoadPromise) {
    return reviewedJobHistoryLoadPromise;
  }

  reviewedJobHistoryLoadPromise = (async () => {
    try {
      const stored = await chrome.storage.local.get(REVIEWED_JOB_HISTORY_STORAGE_KEY);
      reviewedJobHistoryCache = parseJobHistoryEntries(
        stored[REVIEWED_JOB_HISTORY_STORAGE_KEY]
      );
      return reviewedJobHistoryCache;
    } catch {
      reviewedJobHistoryCache = new Map();
      return reviewedJobHistoryCache;
    } finally {
      reviewedJobHistoryLoadPromise = null;
    }
  })();

  return reviewedJobHistoryLoadPromise;
}

async function persistAppliedJobHistory(
  appliedHistory: Map<string, number>
): Promise<void> {
  const trimmedEntries = trimJobHistory(
    appliedHistory,
    MAX_APPLIED_JOB_HISTORY
  );

  appliedJobHistoryWritePromise = appliedJobHistoryWritePromise
    .catch(() => {})
    .then(async () => {
      try {
        await chrome.storage.local.set({
          [APPLIED_JOB_HISTORY_STORAGE_KEY]: trimmedEntries,
        });
        appliedJobHistoryCache = new Map(trimmedEntries);
      } catch {
        // Ignore persistence errors and keep the current in-memory map.
      }
    });

  await appliedJobHistoryWritePromise;
}

async function persistReviewedJobHistory(
  reviewedHistory: Map<string, number>
): Promise<void> {
  const trimmedEntries = trimJobHistory(
    reviewedHistory,
    MAX_REVIEWED_JOB_HISTORY
  );

  reviewedJobHistoryWritePromise = reviewedJobHistoryWritePromise
    .catch(() => {})
    .then(async () => {
      try {
        await chrome.storage.local.set({
          [REVIEWED_JOB_HISTORY_STORAGE_KEY]: trimmedEntries,
        });
        reviewedJobHistoryCache = new Map(trimmedEntries);
      } catch {
        // Ignore persistence errors and keep the current in-memory map.
      }
    });

  await reviewedJobHistoryWritePromise;
}

async function rememberAppliedJobKey(
  key: string,
  appliedAt = Date.now()
): Promise<void> {
  const normalizedKey = key.trim();
  if (!normalizedKey) {
    return;
  }

  const appliedHistory = await loadAppliedJobHistory();
  appliedHistory.set(normalizedKey, appliedAt);

  while (appliedHistory.size > MAX_APPLIED_JOB_HISTORY) {
    const oldest = Array.from(appliedHistory.entries()).sort(
      (left, right) => left[1] - right[1]
    )[0];
    if (!oldest) {
      break;
    }
    appliedHistory.delete(oldest[0]);
  }

  await persistAppliedJobHistory(appliedHistory);
}

async function rememberReviewedJobKey(
  key: string,
  reviewedAt = Date.now()
): Promise<void> {
  const normalizedKey = key.trim();
  if (!normalizedKey) {
    return;
  }

  const reviewedHistory = await loadReviewedJobHistory();
  reviewedHistory.set(normalizedKey, reviewedAt);

  while (reviewedHistory.size > MAX_REVIEWED_JOB_HISTORY) {
    const oldest = Array.from(reviewedHistory.entries()).sort(
      (left, right) => left[1] - right[1]
    )[0];
    if (!oldest) {
      break;
    }
    reviewedHistory.delete(oldest[0]);
  }

  await persistReviewedJobHistory(reviewedHistory);
}

async function loadBlockedJobKeySet(): Promise<Set<string>> {
  const [appliedHistory, reviewedHistory] = await Promise.all([
    loadAppliedJobHistory(),
    loadReviewedJobHistory(),
  ]);

  return new Set([...appliedHistory.keys(), ...reviewedHistory.keys()]);
}

async function countAppliedJobsForToday(now = Date.now()): Promise<number> {
  const appliedHistory = await loadAppliedJobHistory();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const startAt = startOfDay.getTime();
  const endAt = startAt + 24 * 60 * 60 * 1000;

  let count = 0;

  for (const appliedAt of appliedHistory.values()) {
    if (appliedAt >= startAt && appliedAt < endAt) {
      count += 1;
    }
  }

  return count;
}

type BackgroundSourceTab = chrome.tabs.Tab & { pendingUrl?: string };

async function getTabSafely(tabId: number): Promise<BackgroundSourceTab | null> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab && typeof tab === "object") {
      return tab as BackgroundSourceTab;
    }
    // chrome.tabs.get succeeded but returned an invalid object - return minimal tab
    return { id: tabId } as BackgroundSourceTab;
  } catch {
    // chrome.tabs.get threw - tab is genuinely gone
    return null;
  }
}

async function createExtensionSpawnTab(
  item: SpawnTabRequest,
  options: {
    sourceTabId?: number;
    windowId?: number;
    index: number;
  }
): Promise<chrome.tabs.Tab> {
  const attempts: chrome.tabs.CreateProperties[] = [];
  const seenAttemptKeys = new Set<string>();
  const addAttempt = (properties: chrome.tabs.CreateProperties) => {
    const key = JSON.stringify({
      active: properties.active ?? false,
      url: properties.url ?? "",
      openerTabId:
        typeof properties.openerTabId === "number" ? properties.openerTabId : null,
      windowId: typeof properties.windowId === "number" ? properties.windowId : null,
      index: typeof properties.index === "number" ? properties.index : null,
    });

    if (seenAttemptKeys.has(key)) {
      return;
    }

    seenAttemptKeys.add(key);
    attempts.push(properties);
  };

  const baseProperties: chrome.tabs.CreateProperties = {
    url: item.url,
    active: item.active ?? false,
  };

  if (options.sourceTabId !== undefined) {
    addAttempt({
      ...baseProperties,
      openerTabId: options.sourceTabId,
      index: options.index,
    });
  }

  if (options.windowId !== undefined) {
    addAttempt({
      ...baseProperties,
      windowId: options.windowId,
      index: options.index,
    });
    addAttempt({
      ...baseProperties,
      windowId: options.windowId,
    });
  }

  addAttempt(baseProperties);

  let lastError: unknown;
  for (const properties of attempts) {
    try {
      return await createTabWithTransientRetry(properties);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Tab creation failed.");
}

async function createTabWithTransientRetry(
  properties: chrome.tabs.CreateProperties,
  maxAttempts = 4
): Promise<chrome.tabs.Tab> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const createdTab = await chrome.tabs.create(properties);
      if (!createdTab || typeof createdTab !== "object") {
        throw new Error("Tab creation returned no tab.");
      }
      return createdTab;
    } catch (error) {
      lastError = error;
      if (
        attempt >= maxAttempts ||
        !isRetryableTabCreateError(error)
      ) {
        throw error;
      }
    }

    await delay(250);
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Tab creation failed.");
}

function isRetryableTabCreateError(error: unknown): boolean {
  const message = (
    error instanceof Error ? error.message : String(error ?? "")
  ).toLowerCase();

  if (!message) {
    return false;
  }

  return (
    message.includes("tabs cannot be edited right now") ||
    message.includes("user may be dragging a tab")
  );
}

async function resolvePreferredTab(
  preferredTabId?: number,
  preferredKind: "job_board" | "web_page" = "web_page"
): Promise<BackgroundSourceTab | null> {
  const candidates: BackgroundSourceTab[] = [];
  const seenTabIds = new Set<number>();

  if (typeof preferredTabId === "number") {
    const preferredTab = await getTabSafely(preferredTabId);
    if (preferredTab?.id !== undefined) {
      seenTabIds.add(preferredTab.id);
      candidates.push(preferredTab);
    }
  }

  const queryResults = await Promise.allSettled([
    chrome.tabs.query({
      active: true,
      currentWindow: true,
    }),
    chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    }),
    chrome.tabs.query({
      active: true,
    }),
  ]);

  for (const result of queryResults) {
    if (result.status !== "fulfilled") {
      continue;
    }

    for (const tab of result.value as BackgroundSourceTab[]) {
      if (tab.id === undefined || seenTabIds.has(tab.id)) {
        continue;
      }

      seenTabIds.add(tab.id);
      candidates.push(tab);
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  const preferredTab =
    typeof preferredTabId === "number"
      ? candidates.find(
          (tab) =>
            tab.id === preferredTabId &&
            isTabUsableForPreference(tab, preferredKind)
        ) ?? null
      : null;
  if (preferredTab) {
    return preferredTab;
  }

  if (preferredKind === "job_board") {
    const jobBoardTab = candidates.find((tab) =>
      isJobBoardTab(tab)
    );
    if (jobBoardTab) {
      return jobBoardTab;
    }
  }

  return candidates.find((tab) => isWebPageTab(tab)) ?? candidates[0] ?? null;
}

function getTabUrl(tab: BackgroundSourceTab | null | undefined): string {
  const currentUrl = tab?.url ?? "";
  const pendingUrl = tab?.pendingUrl ?? "";

  if (!currentUrl) {
    return pendingUrl;
  }

  if (
    pendingUrl &&
    (detectSiteFromUrl(pendingUrl) !== null || isHttpUrl(pendingUrl)) &&
    (detectSiteFromUrl(currentUrl) === null || !isHttpUrl(currentUrl))
  ) {
    return pendingUrl;
  }

  return currentUrl;
}

function isJobBoardTab(tab: BackgroundSourceTab): boolean {
  return (
    isWebPageTab(tab) &&
    isJobBoardSite(detectSiteFromUrl(getTabUrl(tab)))
  );
}

function isTabUsableForPreference(
  tab: BackgroundSourceTab,
  preferredKind: "job_board" | "web_page"
): boolean {
  if (preferredKind === "job_board") {
    return isJobBoardTab(tab);
  }

  return isWebPageTab(tab);
}

function isWebPageTab(tab: BackgroundSourceTab): boolean {
  const url = getTabUrl(tab);
  return isHttpUrl(url);
}

function isHttpUrl(url: string): boolean {
  return url.startsWith("https://") || url.startsWith("http://");
}

function reserveExtensionSpawnSlots(tabId: number, count: number): void {
  if (!Number.isFinite(count) || count <= 0) {
    return;
  }

  pendingExtensionTabSpawns.set(
    tabId,
    (pendingExtensionTabSpawns.get(tabId) ?? 0) + count
  );

  schedulePendingSpawnsPersist();
}

function consumePendingExtensionSpawn(tabId: number): boolean {
  const remaining = pendingExtensionTabSpawns.get(tabId) ?? 0;

  if (remaining <= 0) {
    return false;
  }

  if (remaining === 1) {
    pendingExtensionTabSpawns.delete(tabId);
  } else {
    pendingExtensionTabSpawns.set(tabId, remaining - 1);
  }

  schedulePendingSpawnsPersist();
  return true;
}

function releaseExtensionSpawnSlots(tabId: number, count: number): void {
  if (!Number.isFinite(count) || count <= 0) {
    return;
  }

  const remaining = Math.max(
    0,
    (pendingExtensionTabSpawns.get(tabId) ?? 0) - Math.floor(count)
  );

  if (remaining <= 0) {
    pendingExtensionTabSpawns.delete(tabId);
  } else {
    pendingExtensionTabSpawns.set(tabId, remaining);
  }

  schedulePendingSpawnsPersist();
}

function getReadableSiteName(site: SiteKey | "unsupported"): string {
  switch (site) {
    case "indeed":
      return "Indeed";
    case "ziprecruiter":
      return "ZipRecruiter";
    case "dice":
      return "Dice";
    case "monster":
      return "Monster";
    case "glassdoor":
      return "Glassdoor";
    case "greenhouse":
      return "Greenhouse";
    case "builtin":
      return "Built In";
    case "startup":
      return "Startup Careers";
    case "other_sites":
      return "Other Job Sites";
    case "unsupported":
      return "Unsupported Site";
  }
}

function getReadableStageName(stage: AutomationStage): string {
  switch (stage) {
    case "bootstrap":
      return "search automation";
    case "collect-results":
      return "result collection";
    case "open-apply":
      return "apply-page opener";
    case "autofill-form":
      return "application autofill";
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

async function detectJobBoardSiteForTab(
  tabId: number,
  tabUrl: string
): Promise<SiteKey | null> {
  const detectedFromUrl = detectSiteFromUrl(tabUrl);
  if (isJobBoardSite(detectedFromUrl)) {
    return detectedFromUrl;
  }

  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "get-status",
    });
    const contentSite = response?.status?.site;
    return isJobBoardSite(contentSite) ? contentSite : null;
  } catch {
    return null;
  }
}

async function reloadTabAndWait(tabId: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      chrome.tabs.onUpdated.removeListener(handleUpdated);
      chrome.tabs.onRemoved.removeListener(handleRemoved);
      if (timeoutId !== null) {
        globalThis.clearTimeout(timeoutId);
      }
    };

    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      callback();
    };

    const handleUpdated = (
      updatedTabId: number,
      changeInfo: { status?: string }
    ) => {
      if (updatedTabId !== tabId) {
        return;
      }
      if (changeInfo.status === "complete") {
        finish(resolve);
      }
    };

    const handleRemoved = (removedTabId: number) => {
      if (removedTabId !== tabId) {
        return;
      }
      finish(() => reject(new Error("Tab was closed.")));
    };

    chrome.tabs.onUpdated.addListener(handleUpdated);
    chrome.tabs.onRemoved.addListener(handleRemoved);
    timeoutId = globalThis.setTimeout(() => {
      finish(() => reject(new Error("Timed out reloading tab.")));
    }, 30000);

    chrome.tabs.reload(tabId).catch((error: unknown) => {
      finish(() =>
        reject(
          error instanceof Error
            ? error
            : new Error("Failed to reload tab.")
        )
      );
    });
  });
}
