// src/background.ts
// COMPLETE FILE — replace entirely

import {
  AutomationSession,
  AutomationStage,
  AutomationStatus,
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
  getSessionStorageKey,
  isJobBoardSite,
  parseSearchKeywords,
  readAutomationSettings,
  refreshStartupCompanies,
  resolveStartupTargetRegions,
} from "./shared";

type BackgroundRequest =
  | { type: "start-automation"; tabId: number }
  | { type: "start-startup-automation"; tabId?: number }
  | { type: "start-other-sites-automation"; tabId?: number }
  | { type: "extract-monster-search-results" }
  | { type: "reserve-job-openings"; requested: number }
  | {
      type: "claim-job-openings";
      requested: number;
      candidates: { url: string; key: string }[];
    }
  | { type: "get-tab-session"; tabId: number }
  | { type: "content-ready"; looksLikeApplicationSurface?: boolean }
  | {
      type: "status-update";
      status: AutomationStatus;
      shouldResume?: boolean;
      stage?: AutomationStage;
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
      label?: string;
      resumeKind?: SpawnTabRequest["resumeKind"];
      profileId?: SpawnTabRequest["profileId"];
      completionKind?: ManagedSessionCompletionKind;
    }
  | { type: "probe-application-target"; url: string }
  | { type: "close-current-tab" };

type ManagedSessionCompletionKind =
  | "successful"
  | "released"
  | "handoff";

type ProbedTargetFailureReason = BrokenPageReason | "unreachable";

type AutomationRunState = {
  id: string;
  jobPageLimit: number;
  openedJobPages: number;
  openedJobKeys: string[];
  successfulJobPages: number;
  successfulJobKeys: string[];
  rateLimitedUntil?: number;
  updatedAt: number;
};

const ZIPRECRUITER_SPAWN_DELAY_MS = 4_000;
const MONSTER_SPAWN_DELAY_MS = 9_000;
const RATE_LIMIT_COOLDOWN_MS = 10 * 60 * 1_000;

const AUTOMATION_RUN_STORAGE_PREFIX = "remote-job-search-run:";
const SESSION_STORAGE_PREFIX = "remote-job-search-session:";
const ACTIVE_RUNS_STORAGE_KEY = "remote-job-search-active-runs";

const runLocks = new Map<string, Promise<void>>();
const pendingExtensionTabSpawns = new Map<number, number>();

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
  void removeSession(tabId);
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
        const searchResults = (
          window as Window & {
            searchResults?: { jobResults?: unknown[] };
          }
        ).searchResults;

        return Array.isArray(searchResults?.jobResults)
          ? searchResults.jobResults
          : [];
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

    case "reserve-job-openings":
      return reserveJobOpeningsForSender(sender, message.requested);

    case "claim-job-openings":
      return claimJobOpeningsForSender(
        sender,
        message.candidates,
        message.requested
      );

    case "get-tab-session":
      return {
        ok: true,
        session: await getSession(message.tabId),
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
        Boolean(message.looksLikeApplicationSurface)
      );

      return {
        ok: true,
        shouldResume: resolved.shouldResume,
        session: resolved.session,
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

      // FIX: Deduplicate items before opening — uses getSpawnDedupKey to preserve query params
      itemsToOpen = deduplicateSpawnItems(itemsToOpen);
      const {
        items: filteredItemsToOpen,
        skippedItems: skippedAlreadyOpenItems,
      } = await filterAlreadyOpenManagedSpawnItems(itemsToOpen);
      itemsToOpen = filteredItemsToOpen;

      if (skippedAlreadyOpenItems.length > 0) {
        await releaseJobOpeningsForItems(skippedAlreadyOpenItems);
      }

      if (itemsToOpen.length === 0) {
        return {
          ok: true,
          opened: 0,
        };
      }

      const baseIndex = currentTab.index ?? 0;
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
          createdTab = await chrome.tabs.create({
            url: item.url,
            active: item.active ?? false,
            index: baseIndex + offset + 1,
            openerTabId: currentTab.id,
          });
          openedCount += 1;
        } catch (error: unknown) {
          releaseExtensionSpawnSlots(currentTab.id, 1);
          if (item.stage === "open-apply" || item.stage === "autofill-form") {
            failedJobOpeningItems.push(item);
          }
          // FIX: Don't throw on individual tab creation failure - continue with others
          continue;
        }

        if (item.stage && createdTab.id !== undefined) {
          const shouldQueue = shouldQueueManagedJobSession(item, sourceSession);
          const session = createSession(
            createdTab.id,
            item.site,
            shouldQueue ? "idle" : "running",
            shouldQueue
              ? buildQueuedJobSessionMessage(item.site)
              : (item.message ?? `Starting ${getReadableStageName(item.stage)}...`),
            shouldQueue ? false : true,
            item.stage,
            item.runId,
            item.label,
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

      await removeSession(tabId);

      try {
        await chrome.tabs.remove(tabId);
      } catch {
        // Tab may already be closed.
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
    runId: existingSession?.runId,
    jobSlots: existingSession?.jobSlots,
    label: message.label ?? existingSession?.label,
    resumeKind: message.resumeKind ?? existingSession?.resumeKind,
    profileId: message.profileId ?? existingSession?.profileId,
    controllerFrameId,
    claimedJobKey: existingSession?.claimedJobKey,
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
    } else if (shouldReleaseManagedJobOpening(nextSession, completionKind)) {
      await releaseManagedJobOpening(
        nextSession.runId,
        nextSession.tabId,
        sender.tab?.url
      );
    }

    await resumePendingJobSessionsForRunId(nextSession.runId);
  }

  return { ok: true };
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

  const childSession = createSession(
    childTabId,
    openerSession.site,
    "running",
    `Continuing ${getReadableSiteName(openerSession.site)} application in a new tab...`,
    true,
    "open-apply",
    openerSession.runId,
    openerSession.label,
    openerSession.resumeKind,
    openerSession.profileId
  );

  childSession.jobSlots = openerSession.jobSlots;
  childSession.claimedJobKey = openerSession.claimedJobKey;
  childSession.openedUrlKey = openerSession.openedUrlKey;

  await setSession(childSession);

  try {
    await chrome.tabs.sendMessage(openerTabId, {
      type: "automation-child-tab-opened",
    });
  } catch {
    // The opener tab may already be navigating or closing.
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
        "The active tab could not be accessed. Focus an Indeed, ZipRecruiter, Dice, Monster, or Glassdoor page and try again.",
    };
  }

  const resolvedTabId = tab.id;
  const site = detectSiteFromUrl(getTabUrl(tab));
  const settings = await readAutomationSettings();
  const runId = createRunId();
  const searchKeywords = parseSearchKeywords(settings.searchKeywords);

  if (!isJobBoardSite(site)) {
    return {
      ok: false,
      error: "Open an Indeed, ZipRecruiter, Dice, Monster, or Glassdoor page first.",
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

  const jobSlots = distributeJobSlots(settings.jobPageLimit, targets.length);

  const items: SpawnTabRequest[] = targets
    .map((target, index) => ({
      url: target.url,
      site: "startup" as const,
      stage: "collect-results" as const,
      runId,
      jobSlots: jobSlots[index],
      message: `Collecting ${target.label} roles...`,
      label: target.label,
      resumeKind: target.resumeKind,
      profileId: settings.activeProfileId,
      keyword: target.keyword,
    }))
    .filter((item) => (item.jobSlots ?? 0) > 0);

  if (items.length === 0) {
    return {
      ok: false,
      error: "No startup career pages have available job slots.",
    };
  }

  // FIX: Deduplicate using spawn-specific dedup key (preserves query params)
  const dedupedItems = deduplicateSpawnItems(items);

  await setRunState({
    id: runId,
    jobPageLimit: settings.jobPageLimit,
    openedJobPages: 0,
    openedJobKeys: [],
    successfulJobPages: 0,
    successfulJobKeys: [],
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

  const jobSlots = distributeJobSlots(settings.jobPageLimit, targets.length);

  const items: SpawnTabRequest[] = targets
    .map((target, index) => ({
      url: target.url,
      site: "other_sites" as const,
      stage: "collect-results" as const,
      runId,
      jobSlots: jobSlots[index],
      message: `Collecting ${target.label} roles...`,
      label: target.label,
      resumeKind: target.resumeKind,
      profileId: settings.activeProfileId,
      keyword: target.keyword,
    }))
    .filter((item) => (item.jobSlots ?? 0) > 0);

  if (items.length === 0) {
    return {
      ok: false,
      error: "No other job site searches have available job slots.",
    };
  }

  // FIX: Deduplicate using spawn-specific dedup key
  const dedupedItems = deduplicateSpawnItems(items);

  await setRunState({
    id: runId,
    jobPageLimit: settings.jobPageLimit,
    openedJobPages: 0,
    openedJobKeys: [],
    successfulJobPages: 0,
    successfulJobKeys: [],
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

    const finalUrl = response.url.toLowerCase();
    if (
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
      bodyText.includes("web server reported a bad gateway error")
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

async function getSession(tabId: number): Promise<AutomationSession | null> {
  const key = getSessionStorageKey(tabId);
  const stored = await chrome.storage.local.get(key);
  return (stored[key] as AutomationSession | undefined) ?? null;
}

function isFrameBoundSession(session: AutomationSession): boolean {
  return session.stage === "autofill-form" && session.site !== "unsupported";
}

async function resolveContentReadySession(
  session: AutomationSession,
  senderFrameId: number,
  looksLikeApplicationSurface: boolean
): Promise<{ session: AutomationSession; shouldResume: boolean }> {
  if (!isFrameBoundSession(session)) {
    return {
      session,
      shouldResume: Boolean(session.shouldResume),
    };
  }

  if (typeof session.controllerFrameId === "number") {
    return {
      session,
      shouldResume:
        session.controllerFrameId === senderFrameId &&
        Boolean(session.shouldResume),
    };
  }

  if (!looksLikeApplicationSurface) {
    return {
      session,
      shouldResume: false,
    };
  }

  const claimedSession: AutomationSession = {
    ...session,
    controllerFrameId: senderFrameId,
  };
  await setSession(claimedSession);

  return {
    session: claimedSession,
    shouldResume: Boolean(claimedSession.shouldResume),
  };
}

async function reserveJobOpeningsForSender(
  sender: chrome.runtime.MessageSender,
  requested: number
): Promise<{
  ok: boolean;
  approved: number;
  remaining: number;
  limit: number;
}> {
  const tabId = sender.tab?.id;

  if (tabId === undefined) {
    return { ok: false, approved: 0, remaining: 0, limit: 0 };
  }

  const session = await getSession(tabId);
  const runId = session?.runId;

  if (!runId) {
    const settings = await readAutomationSettings();
    const approved = Math.min(Math.max(0, requested), settings.jobPageLimit);
    return {
      ok: true,
      approved,
      remaining: 0,
      limit: settings.jobPageLimit,
    };
  }

  const reservation = await reserveJobOpeningsForRunId(runId, requested);

  return {
    ok: true,
    ...reservation,
  };
}

async function claimJobOpeningsForSender(
  sender: chrome.runtime.MessageSender,
  candidates: { url: string; key: string }[],
  requested: number
): Promise<{
  ok: boolean;
  approved: number;
  approvedUrls: string[];
  remaining: number;
  limit: number;
}> {
  const tabId = sender.tab?.id;

  if (tabId === undefined) {
    return {
      ok: false,
      approved: 0,
      approvedUrls: [],
      remaining: 0,
      limit: 0,
    };
  }

  const session = await getSession(tabId);
  const runId = session?.runId;

  if (!runId) {
    const settings = await readAutomationSettings();
    const approvedUrls = pickUniqueCandidateUrls(
      candidates,
      Math.min(Math.max(0, requested), settings.jobPageLimit)
    );
    return {
      ok: true,
      approved: approvedUrls.length,
      approvedUrls,
      remaining: Math.max(0, settings.jobPageLimit - approvedUrls.length),
      limit: settings.jobPageLimit,
    };
  }

  const reservation = await claimJobOpeningsForRunId(
    runId,
    candidates,
    requested
  );

  return {
    ok: true,
    ...reservation,
  };
}

async function reserveJobOpeningsForRunId(
  runId: string,
  requested: number
): Promise<{ approved: number; remaining: number; limit: number }> {
  return withRunLock(runId, async () => {
    const runState = await getRunState(runId);

    if (!runState) {
      return { approved: 0, remaining: 0, limit: 0 };
    }

    const safeRequested = Math.max(0, Math.floor(requested));
    const remainingBefore = Math.max(
      0,
      runState.jobPageLimit - runState.openedJobPages
    );
    const approved = Math.min(safeRequested, remainingBefore);

    return {
      approved,
      remaining: Math.max(0, remainingBefore - approved),
      limit: runState.jobPageLimit,
    };
  });
}

async function claimJobOpeningsForRunId(
  runId: string,
  candidates: { url: string; key: string }[],
  requested: number
): Promise<{
  approved: number;
  approvedUrls: string[];
  remaining: number;
  limit: number;
}> {
  return withRunLock(runId, async () => {
    const runState = await getRunState(runId);

    if (!runState) {
      return {
        approved: 0,
        approvedUrls: [],
        remaining: 0,
        limit: 0,
      };
    }

    const safeRequested = Math.max(0, Math.floor(requested));
    const remainingBefore = Math.max(
      0,
      runState.jobPageLimit - runState.openedJobPages
    );
    const targetCount = Math.min(safeRequested, remainingBefore);
    const seenKeys = new Set(runState.openedJobKeys ?? []);
    const approvedUrls: string[] = [];

    for (const candidate of candidates) {
      if (approvedUrls.length >= targetCount) {
        break;
      }

      const url = candidate.url.trim();
      // FIX: Always re-derive the key using getJobDedupKey for consistency
      const key = getJobDedupKey(url);

      if (!url || !key || seenKeys.has(key)) {
        continue;
      }

      seenKeys.add(key);
      approvedUrls.push(url);
    }

    if (approvedUrls.length > 0) {
      await setRunState({
        ...runState,
        openedJobPages: runState.openedJobPages + approvedUrls.length,
        openedJobKeys: Array.from(seenKeys),
        updatedAt: Date.now(),
      });
    }

    return {
      approved: approvedUrls.length,
      approvedUrls,
      remaining: Math.max(
        0,
        runState.jobPageLimit -
          (runState.openedJobPages + approvedUrls.length)
      ),
      limit: runState.jobPageLimit,
    };
  });
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

function isManagedJobStage(
  stage: AutomationStage | undefined
): stage is "open-apply" | "autofill-form" {
  return stage === "open-apply" || stage === "autofill-form";
}

function shouldQueueManagedJobSession(
  item: SpawnTabRequest,
  sourceSession: AutomationSession | null
): boolean {
  if (!item.runId || !isManagedJobStage(item.stage)) {
    return false;
  }

  if (sourceSession?.stage === "collect-results") {
    return false;
  }

  if (
    sourceSession?.runId === item.runId &&
    isManagedJobSession(sourceSession)
  ) {
    return false;
  }

  return true;
}

function buildQueuedJobSessionMessage(site: SiteKey): string {
  return `Queued this ${getReadableSiteName(site)} job page. It will start automatically when an application slot is available.`;
}

function isManagedJobSession(session: AutomationSession): boolean {
  return Boolean(session.runId && isManagedJobStage(session.stage));
}

function isManagedJobSessionActive(session: AutomationSession): boolean {
  return (
    isManagedJobSession(session) &&
    session.shouldResume &&
    (session.phase === "running" ||
      session.phase === "waiting_for_verification")
  );
}

function isManagedJobSessionPending(session: AutomationSession): boolean {
  return (
    isManagedJobSession(session) &&
    !session.shouldResume &&
    session.phase !== "completed" &&
    session.phase !== "error"
  );
}

function isRateLimitMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("rate limited") ||
    lower.includes("rate limit exceeded")
  );
}

function isRateLimitedSession(session: AutomationSession): boolean {
  return session.phase === "error" && isRateLimitMessage(session.message);
}

function isSuccessfulJobCompletion(
  session: AutomationSession,
  completionKind?: ManagedSessionCompletionKind
): boolean {
  if (
    !isManagedJobSession(session) ||
    session.phase !== "completed"
  ) {
    return false;
  }

  if (completionKind) {
    return completionKind === "successful";
  }

  const message = session.message.toLowerCase();

  return (
    message.includes("review before submitting") ||
    message.includes("application opened. no fields auto-filled") ||
    message.includes("application opened, nothing auto-filled") ||
    message.includes("application page opened. review and complete manually") ||
    message.includes("review manually")
  );
}

function shouldReleaseManagedJobOpening(
  session: AutomationSession,
  completionKind?: ManagedSessionCompletionKind
): boolean {
  if (!isManagedJobSession(session)) {
    return false;
  }

  if (completionKind) {
    return completionKind === "released";
  }

  if (session.phase === "error") {
    return !isRateLimitedSession(session);
  }

  if (session.phase !== "completed") {
    return false;
  }

  const message = session.message.toLowerCase();
  return (
    message.includes("already applied") ||
    message.includes("no application form detected") ||
    message.includes("no apply button found")
  );
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
  if (session?.claimedJobKey) {
    return session.claimedJobKey;
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

  await releaseJobOpeningsForRunId(runId, [completionKey]);
}

async function listSessionsForRunId(runId: string): Promise<AutomationSession[]> {
  const allStored = await chrome.storage.local.get(null);

  return Object.entries(allStored)
    .filter(([key]) => key.startsWith(SESSION_STORAGE_PREFIX))
    .map(([, value]) => value)
    .filter((value): value is AutomationSession =>
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      "runId" in value &&
      (value as { runId?: unknown }).runId === runId
    );
}

async function resumePendingJobSessionsForRunId(runId: string): Promise<void> {
  const sessionsToResume = await withRunLock(runId, async () => {
    const runState = await getRunState(runId);

    if (!runState) {
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
    const remainingSuccessCapacity = Math.max(
      0,
      runState.jobPageLimit - runState.successfulJobPages
    );
    const availableSlots = Math.max(
      0,
      remainingSuccessCapacity - activeJobSessions.length
    );

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
      const message = {
        type: "start-automation" as const,
        session,
      };

      if (typeof session.controllerFrameId === "number") {
        await chrome.tabs.sendMessage(
          session.tabId,
          message,
          { frameId: session.controllerFrameId }
        );
      } else {
        await chrome.tabs.sendMessage(session.tabId, message);
      }
    } catch {
      // The content script may still be loading; content-ready will pick this up.
    }
  }
}

async function setSession(session: AutomationSession): Promise<void> {
  await chrome.storage.local.set({
    [getSessionStorageKey(session.tabId)]: session,
  });
}

async function removeSession(tabId: number): Promise<void> {
  const existingSession = await getSession(tabId);
  await chrome.storage.local.remove(getSessionStorageKey(tabId));

  if (existingSession?.runId) {
    await removeRunStateIfUnused(existingSession.runId);
  }
}

async function getRunState(runId: string): Promise<AutomationRunState | null> {
  const key = getAutomationRunStorageKey(runId);
  const stored = await chrome.storage.local.get(key);
  const value = stored[key];

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const raw = value as Partial<AutomationRunState>;

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
    successfulJobPages: Number.isFinite(Number(raw.successfulJobPages))
      ? Math.max(0, Math.floor(Number(raw.successfulJobPages)))
      : 0,
    successfulJobKeys: Array.isArray(raw.successfulJobKeys)
      ? raw.successfulJobKeys.filter(
          (key): key is string => typeof key === "string" && Boolean(key.trim())
        )
      : [],
    rateLimitedUntil: Number.isFinite(Number(raw.rateLimitedUntil))
      ? Number(raw.rateLimitedUntil)
      : undefined,
    updatedAt: Number.isFinite(raw.updatedAt) ? Number(raw.updatedAt) : Date.now(),
  };
}

async function isRunRateLimited(runId: string): Promise<boolean> {
  const runState = await getRunState(runId);

  return Boolean(
    runState &&
      Number.isFinite(runState.rateLimitedUntil) &&
      Date.now() < Number(runState.rateLimitedUntil)
  );
}

async function setRunState(runState: AutomationRunState): Promise<void> {
  await chrome.storage.local.set({
    [getAutomationRunStorageKey(runState.id)]: runState,
  });
}

async function removeRunState(runId: string): Promise<void> {
  await chrome.storage.local.remove(getAutomationRunStorageKey(runId));
}

function getAutomationRunStorageKey(runId: string): string {
  return `${AUTOMATION_RUN_STORAGE_PREFIX}${runId}`;
}

function createRunId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function distributeJobSlots(totalSlots: number, targetCount: number): number[] {
  const safeTargetCount = Math.max(0, Math.floor(targetCount));
  const safeTotalSlots = Math.max(0, Math.floor(totalSlots));
  const slots = new Array<number>(safeTargetCount).fill(0);

  for (let index = 0; index < safeTotalSlots; index += 1) {
    if (safeTargetCount === 0) {
      break;
    }
    slots[index % safeTargetCount] += 1;
  }

  return slots;
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

function pickUniqueCandidateUrls(
  candidates: { url: string; key: string }[],
  limit: number
): string[] {
  const approvedUrls: string[] = [];
  const seenKeys = new Set<string>();
  const safeLimit = Math.max(0, Math.floor(limit));

  for (const candidate of candidates) {
    if (approvedUrls.length >= safeLimit) {
      break;
    }

    const url = candidate.url.trim();
    // FIX: Always re-derive key for consistency
    const key = getJobDedupKey(url);

    if (!url || !key || seenKeys.has(key)) {
      continue;
    }

    seenKeys.add(key);
    approvedUrls.push(url);
  }

  return approvedUrls;
}

// FIX: Dedup spawn items using getSpawnDedupKey so different search URLs are preserved
function deduplicateSpawnItems(items: SpawnTabRequest[]): SpawnTabRequest[] {
  const seen = new Set<string>();
  const result: SpawnTabRequest[] = [];

  for (const item of items) {
    const key = getSpawnDedupKey(item.url);
    if (!key || seen.has(key)) {
      // If duplicate, aggregate job slots to the first occurrence
      if (key && item.jobSlots) {
        const existing = result.find((r) => getSpawnDedupKey(r.url) === key);
        if (existing && existing.jobSlots !== undefined) {
          existing.jobSlots += item.jobSlots;
        }
      }
      continue;
    }
    seen.add(key);
    result.push({ ...item });
  }

  return result;
}

async function filterAlreadyOpenManagedSpawnItems(
  items: SpawnTabRequest[]
): Promise<{ items: SpawnTabRequest[]; skippedItems: SpawnTabRequest[] }> {
  const existingUrlKeysByRunId = new Map<string, Set<string>>();
  const filtered: SpawnTabRequest[] = [];
  const skippedItems: SpawnTabRequest[] = [];

  for (const item of items) {
    if (!item.runId || !isManagedJobStage(item.stage)) {
      filtered.push(item);
      continue;
    }

    const urlKey = getSpawnDedupKey(item.url);
    if (!urlKey) {
      filtered.push(item);
      continue;
    }

    let existingUrlKeys = existingUrlKeysByRunId.get(item.runId);
    if (!existingUrlKeys) {
      const existingSessions = await listSessionsForRunId(item.runId);
      existingUrlKeys = new Set(
        existingSessions
          .filter((session) => session.phase !== "error")
          .map((session) => session.openedUrlKey || "")
          .filter(Boolean)
      );
      existingUrlKeysByRunId.set(item.runId, existingUrlKeys);
    }

    if (existingUrlKeys.has(urlKey)) {
      skippedItems.push(item);
      continue;
    }

    existingUrlKeys.add(urlKey);
    filtered.push(item);
  }

  return {
    items: filtered,
    skippedItems,
  };
}

type BackgroundSourceTab = chrome.tabs.Tab & { pendingUrl?: string };

async function getTabSafely(tabId: number): Promise<BackgroundSourceTab | null> {
  try {
    return (await chrome.tabs.get(tabId)) as BackgroundSourceTab;
  } catch {
    return null;
  }
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
  return tab?.url ?? tab?.pendingUrl ?? "";
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

  void persistPendingSpawns();
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

  void persistPendingSpawns();
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

  void persistPendingSpawns();
}

async function addActiveRunId(runId: string): Promise<void> {
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

async function removeActiveRunId(runId: string): Promise<void> {
  const stored = await chrome.storage.local.get(ACTIVE_RUNS_STORAGE_KEY);
  const activeRuns: string[] = Array.isArray(stored[ACTIVE_RUNS_STORAGE_KEY])
    ? stored[ACTIVE_RUNS_STORAGE_KEY]
    : [];

  const filtered = activeRuns.filter((id) => id !== runId);
  await chrome.storage.local.set({
    [ACTIVE_RUNS_STORAGE_KEY]: filtered,
  });
}

async function removeRunStateIfUnused(runId: string): Promise<void> {
  const allStored = await chrome.storage.local.get(null);
  const allKeys = Object.keys(allStored);
  const sessionKeys = allKeys.filter((key) =>
    key.startsWith(SESSION_STORAGE_PREFIX)
  );

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

    return (
      "runId" in value && (value as { runId?: unknown }).runId === runId
    );
  });

  if (!hasActiveSession) {
    await removeRunState(runId);
    await removeActiveRunId(runId);
  }
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
