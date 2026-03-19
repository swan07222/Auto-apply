// src/background.ts
// COMPLETE FILE — replace entirely

import {
  AutomationSession,
  AutomationStage,
  AutomationStatus,
  JobContextSnapshot,
  SEARCH_OPEN_DELAY_MS,
  SiteKey,
  STARTUP_COMPANIES_REFRESH_ALARM,
  STARTUP_COMPANIES_REFRESH_INTERVAL_MS,
  SpawnTabRequest,
  buildOtherJobSiteTargets,
  buildStartupSearchTargets,
  createSession,
  detectSiteFromUrl,
  getJobDedupKey,
  getSpawnDedupKey,
  getSessionStorageKey,
  isJobBoardSite,
  readAutomationSettings,
  refreshStartupCompanies,
  resolveStartupRegion,
} from "./shared";

type BackgroundRequest =
  | { type: "start-automation"; tabId: number }
  | { type: "start-startup-automation"; tabId?: number }
  | { type: "start-other-sites-automation"; tabId?: number }
  | { type: "reserve-job-openings"; requested: number }
  | {
      type: "claim-job-openings";
      requested: number;
      candidates: { url: string; key: string }[];
    }
  | { type: "get-tab-session"; tabId: number }
  | { type: "remember-job-context"; context: JobContextSnapshot }
  | { type: "get-job-context" }
  | { type: "content-ready" }
  | {
      type: "status-update";
      status: AutomationStatus;
      shouldResume?: boolean;
      stage?: AutomationStage;
      label?: string;
      resumeKind?: SpawnTabRequest["resumeKind"];
    }
  | { type: "spawn-tabs"; items: SpawnTabRequest[]; maxJobPages?: number }
  | {
      type: "finalize-session";
      status: AutomationStatus;
      stage?: AutomationStage;
      label?: string;
      resumeKind?: SpawnTabRequest["resumeKind"];
    }
  | { type: "close-current-tab" };

type AutomationRunState = {
  id: string;
  jobPageLimit: number;
  openedJobPages: number;
  openedJobKeys: string[];
  updatedAt: number;
};

const AUTOMATION_RUN_STORAGE_PREFIX = "remote-job-search-run:";
const SESSION_STORAGE_PREFIX = "remote-job-search-session:";
const JOB_CONTEXT_STORAGE_PREFIX = "remote-job-search-job-context:";
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

    case "remember-job-context": {
      const tabId = sender.tab?.id;
      if (tabId === undefined) {
        return { ok: false };
      }

      await setJobContext(tabId, message.context);
      return { ok: true };
    }

    case "get-job-context": {
      const tabId = sender.tab?.id;
      if (tabId === undefined) {
        return { ok: false, context: null };
      }

      return {
        ok: true,
        context: await getJobContext(tabId),
      };
    }

    case "content-ready": {
      const tabId = sender.tab?.id;

      if (tabId === undefined) {
        return { ok: false, shouldResume: false };
      }

      const session = await getSession(tabId);
      return {
        ok: true,
        shouldResume: Boolean(session?.shouldResume),
        session,
      };
    }

    case "status-update":
      return updateSessionFromMessage(message, sender, false);

    case "finalize-session":
      return updateSessionFromMessage(message, sender, true);

    case "spawn-tabs": {
      const currentTab = sender.tab;

      if (!currentTab?.id) {
        return { ok: false, error: "Missing source tab." };
      }

      let itemsToOpen = message.items;

      if (
        typeof message.maxJobPages === "number" &&
        Number.isFinite(message.maxJobPages)
      ) {
        const cap = Math.max(0, Math.floor(message.maxJobPages));
        itemsToOpen = capJobOpeningItems(itemsToOpen, cap);
      }

      // FIX: Deduplicate items before opening — uses getSpawnDedupKey to preserve query params
      itemsToOpen = deduplicateSpawnItems(itemsToOpen);

      const baseIndex = currentTab.index ?? 0;
      reserveExtensionSpawnSlots(currentTab.id, itemsToOpen.length);

      let openedCount = 0;

      for (const [offset, item] of itemsToOpen.entries()) {
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
          // FIX: Don't throw on individual tab creation failure — continue with others
          continue;
        }

        if (item.stage && createdTab.id !== undefined) {
          const session = createSession(
            createdTab.id,
            item.site,
            "running",
            item.message ?? `Starting ${getReadableStageName(item.stage)}...`,
            true,
            item.stage,
            item.runId,
            item.label,
            item.resumeKind
          );
          session.jobSlots = item.jobSlots;

          await setSession(session);
        }

        await delay(SEARCH_OPEN_DELAY_MS);
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

  const nextSession: AutomationSession = {
    tabId,
    site,
    phase: message.status.phase,
    message: message.status.message,
    updatedAt: message.status.updatedAt,
    shouldResume,
    stage: message.stage ?? existingSession?.stage ?? "bootstrap",
    runId: existingSession?.runId,
    jobSlots: existingSession?.jobSlots,
    label: message.label ?? existingSession?.label,
    resumeKind: message.resumeKind ?? existingSession?.resumeKind,
  };

  await setSession(nextSession);
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
    openerSession.resumeKind
  );

  childSession.jobSlots = openerSession.jobSlots;

  await setSession(childSession);
  const rememberedJobContext = await getJobContext(openerTabId);
  if (rememberedJobContext) {
    await setJobContext(childTabId, rememberedJobContext);
  }

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
        "The active tab could not be accessed. Focus an Indeed, ZipRecruiter, Dice, or Monster page and try again.",
    };
  }

  const resolvedTabId = tab.id;
  const site = detectSiteFromUrl(getTabUrl(tab));
  const settings = await readAutomationSettings();
  const runId = createRunId();

  if (!isJobBoardSite(site)) {
    return {
      ok: false,
      error: "Open an Indeed, ZipRecruiter, Dice, or Monster page first.",
    };
  }

  await setRunState({
    id: runId,
    jobPageLimit: settings.jobPageLimit,
    openedJobPages: 0,
    openedJobKeys: [],
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
    runId
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
  const startupCompanies = await refreshStartupCompanies();
  const targets = buildStartupSearchTargets(settings, startupCompanies);

  if (targets.length === 0) {
    return {
      ok: false,
      error: "No startup career pages are configured for the selected region.",
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
        item.resumeKind
      );
      childSession.jobSlots = item.jobSlots;

      await setSession(childSession);
    }

    await delay(SEARCH_OPEN_DELAY_MS);
  }

  const region = resolveStartupRegion(
    settings.startupRegion,
    settings.candidate.country
  );

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
    regionLabel: region.toUpperCase(),
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
  const targets = buildOtherJobSiteTargets(settings);

  if (targets.length === 0) {
    return {
      ok: false,
      error: "No other job site searches are configured for the selected region.",
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
        item.resumeKind
      );
      childSession.jobSlots = item.jobSlots;

      await setSession(childSession);
    }

    await delay(SEARCH_OPEN_DELAY_MS);
  }

  const region = resolveStartupRegion(
    settings.startupRegion,
    settings.candidate.country
  );

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
    regionLabel: region.toUpperCase(),
  };
}

async function getSession(tabId: number): Promise<AutomationSession | null> {
  const key = getSessionStorageKey(tabId);
  const stored = await chrome.storage.local.get(key);
  return (stored[key] as AutomationSession | undefined) ?? null;
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
    const remainingAfter = Math.max(0, remainingBefore - approved);

    if (approved > 0) {
      await setRunState({
        ...runState,
        openedJobPages: runState.openedJobPages + approved,
        updatedAt: Date.now(),
      });
    }

    return {
      approved,
      remaining: remainingAfter,
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

async function setSession(session: AutomationSession): Promise<void> {
  await chrome.storage.local.set({
    [getSessionStorageKey(session.tabId)]: session,
  });
}

async function removeSession(tabId: number): Promise<void> {
  const existingSession = await getSession(tabId);
  await chrome.storage.local.remove(getSessionStorageKey(tabId));
  await removeJobContext(tabId);

  if (existingSession?.runId) {
    await removeRunStateIfUnused(existingSession.runId);
  }
}

async function getJobContext(
  tabId: number
): Promise<JobContextSnapshot | null> {
  const key = getJobContextStorageKey(tabId);
  const stored = await chrome.storage.local.get(key);
  return (stored[key] as JobContextSnapshot | undefined) ?? null;
}

async function setJobContext(
  tabId: number,
  context: JobContextSnapshot
): Promise<void> {
  const key = getJobContextStorageKey(tabId);
  const existing = await getJobContext(tabId);
  await chrome.storage.local.set({
    [key]: mergeJobContexts(existing, context),
  });
}

async function removeJobContext(tabId: number): Promise<void> {
  await chrome.storage.local.remove(getJobContextStorageKey(tabId));
}

async function getRunState(runId: string): Promise<AutomationRunState | null> {
  const key = getAutomationRunStorageKey(runId);
  const stored = await chrome.storage.local.get(key);
  return (stored[key] as AutomationRunState | undefined) ?? null;
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

function getJobContextStorageKey(tabId: number): string {
  return `${JOB_CONTEXT_STORAGE_PREFIX}${tabId}`;
}

function mergeJobContexts(
  existing: JobContextSnapshot | null,
  incoming: JobContextSnapshot
): JobContextSnapshot {
  if (!existing) {
    return incoming;
  }

  return {
    title: pickPreferredText(existing.title, incoming.title),
    company: pickPreferredText(existing.company, incoming.company),
    description: pickPreferredText(
      existing.description,
      incoming.description
    ),
    question: incoming.question || existing.question,
    pageUrl: incoming.pageUrl || existing.pageUrl,
  };
}

function pickPreferredText(current: string, next: string): string {
  if (!current) {
    return next;
  }
  if (!next) {
    return current;
  }

  return next.length >= current.length ? next : current;
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
    case "startup":
      return "Startup Careers";
    case "other_sites":
      return "Other Job Sites";
    case "chatgpt":
      return "ChatGPT";
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
    case "generate-ai-answer":
      return "ChatGPT answer generation";
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
