import {
  AutomationSession,
  AutomationStage,
  AutomationStatus,
  SEARCH_OPEN_DELAY_MS,
  SiteKey,
  SpawnTabRequest,
  buildOtherJobSiteTargets,
  buildStartupSearchTargets,
  createSession,
  detectSiteFromUrl,
  getSessionStorageKey,
  isJobBoardSite,
  readAutomationSettings,
  resolveStartupRegion
} from "./shared";

type BackgroundRequest =
  | { type: "start-automation"; tabId: number }
  | { type: "start-startup-automation"; tabId: number }
  | { type: "start-other-sites-automation"; tabId: number }
  | { type: "reserve-job-openings"; requested: number }
  | { type: "get-tab-session"; tabId: number }
  | { type: "content-ready" }
  | {
      type: "status-update";
      status: AutomationStatus;
      shouldResume?: boolean;
      stage?: AutomationStage;
      label?: string;
      resumeKind?: SpawnTabRequest["resumeKind"];
    }
  | { type: "spawn-tabs"; items: SpawnTabRequest[] }
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
  updatedAt: number;
};

const AUTOMATION_RUN_STORAGE_PREFIX = "remote-job-search-run:";
const runLocks = new Map<string, Promise<void>>();

chrome.runtime.onMessage.addListener((message: BackgroundRequest, sender, sendResponse) => {
  void handleMessage(message, sender)
    .then((response) => sendResponse(response))
    .catch((error: unknown) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Unknown background error."
      });
    });

  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void removeSession(tabId);
});

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

    case "get-tab-session":
      return {
        ok: true,
        session: await getSession(message.tabId)
      };

    case "content-ready": {
      const tabId = sender.tab?.id;

      if (tabId === undefined) {
        return { ok: false, shouldResume: false };
      }

      const session = await getSession(tabId);
      return {
        ok: true,
        shouldResume: Boolean(session?.shouldResume),
        session
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

      const sourceSession = await getSession(currentTab.id);
      const itemsToOpen = await limitSpawnItemsForSourceSession(sourceSession, message.items);
      const baseIndex = currentTab.index ?? 0;

      for (const [offset, item] of itemsToOpen.entries()) {
        const createdTab = await chrome.tabs.create({
          url: item.url,
          active: item.active ?? false,
          index: baseIndex + offset + 1
        });

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
        opened: itemsToOpen.length
      };
    }

    case "close-current-tab": {
      const tabId = sender.tab?.id;

      if (tabId === undefined) {
        return { ok: false };
      }

      await chrome.tabs.remove(tabId);
      return { ok: true };
    }
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

  const shouldResume =
    isFinal
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
    resumeKind: message.resumeKind ?? existingSession?.resumeKind
  };

  await setSession(nextSession);
  return { ok: true };
}

async function startAutomationForTab(tabId: number): Promise<{
  ok: boolean;
  error?: string;
  session?: AutomationSession;
}> {
  const tab = await chrome.tabs.get(tabId);
  const site = detectSiteFromUrl(tab.url ?? "");
  const settings = await readAutomationSettings();
  const runId = createRunId();

  if (!isJobBoardSite(site)) {
    return {
      ok: false,
      error: "Open an Indeed, ZipRecruiter, Dice, or Monster page first."
    };
  }

  await setRunState({
    id: runId,
    jobPageLimit: settings.jobPageLimit,
    openedJobPages: 0,
    updatedAt: Date.now()
  });

  const session = createSession(
    tabId,
    site,
    "running",
    `Preparing ${getReadableSiteName(site)} automation...`,
    true,
    "bootstrap",
    runId
  );

  await setSession(session);

  try {
    await chrome.tabs.sendMessage(tabId, { type: "start-automation", session });
  } catch {
    await removeSession(tabId);
    await removeRunState(runId);
    return {
      ok: false,
      error: "The page is still loading. Wait a moment and try again."
    };
  }

  return {
    ok: true,
    session
  };
}

async function startStartupAutomation(tabId: number): Promise<{
  ok: boolean;
  error?: string;
  opened?: number;
  regionLabel?: string;
}> {
  const tab = await chrome.tabs.get(tabId);
  const settings = await readAutomationSettings();
  const runId = createRunId();
  const targets = buildStartupSearchTargets(settings);
  const jobSlots = distributeJobSlots(settings.jobPageLimit, targets.length);
  const items: SpawnTabRequest[] = targets
    .map((target, index) => ({
      url: target.url,
      site: "startup" as const,
      stage: "collect-results" as const,
      runId,
      jobSlots: jobSlots[index],
      message: `Collecting ${target.label} startup roles...`,
      label: target.label,
      resumeKind: target.resumeKind
    }))
    .filter((item) => (item.jobSlots ?? 0) > 0);

  if (items.length === 0) {
    return {
      ok: false,
      error: "No startup career pages are configured for the selected region."
    };
  }

  await setRunState({
    id: runId,
    jobPageLimit: settings.jobPageLimit,
    openedJobPages: 0,
    updatedAt: Date.now()
  });

  const session = createSession(
    tabId,
    "startup",
    "running",
    "Opening startup career pages...",
    false,
    "bootstrap",
    runId
  );

  await setSession(session);

  const baseIndex = tab.index ?? 0;

  for (const [offset, item] of items.entries()) {
    const createdTab = await chrome.tabs.create({
      url: item.url,
      active: item.active ?? false,
      index: baseIndex + offset + 1
    });

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

  const region = resolveStartupRegion(settings.startupRegion, settings.candidate.country);

  await setSession(
    createSession(
      tabId,
      "startup",
      "completed",
      `Opened ${items.length} startup career pages for ${region.toUpperCase()} companies.`,
      false,
      "bootstrap",
      runId
    )
  );

  return {
    ok: true,
    opened: items.length,
    regionLabel: region.toUpperCase()
  };
}

async function startOtherSitesAutomation(tabId: number): Promise<{
  ok: boolean;
  error?: string;
  opened?: number;
  regionLabel?: string;
}> {
  const tab = await chrome.tabs.get(tabId);
  const settings = await readAutomationSettings();
  const runId = createRunId();
  const targets = buildOtherJobSiteTargets(settings);
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
      resumeKind: target.resumeKind
    }))
    .filter((item) => (item.jobSlots ?? 0) > 0);

  if (items.length === 0) {
    return {
      ok: false,
      error: "No other job site searches are configured for the selected region."
    };
  }

  await setRunState({
    id: runId,
    jobPageLimit: settings.jobPageLimit,
    openedJobPages: 0,
    updatedAt: Date.now()
  });

  const session = createSession(
    tabId,
    "other_sites",
    "running",
    "Opening other job site searches...",
    false,
    "bootstrap",
    runId
  );

  await setSession(session);

  const baseIndex = tab.index ?? 0;

  for (const [offset, item] of items.entries()) {
    const createdTab = await chrome.tabs.create({
      url: item.url,
      active: item.active ?? false,
      index: baseIndex + offset + 1
    });

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

  const region = resolveStartupRegion(settings.startupRegion, settings.candidate.country);

  await setSession(
    createSession(
      tabId,
      "other_sites",
      "completed",
      `Opened ${items.length} other job site searches for ${region.toUpperCase()}.`,
      false,
      "bootstrap",
      runId
    )
  );

  return {
    ok: true,
    opened: items.length,
    regionLabel: region.toUpperCase()
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
): Promise<{ ok: boolean; approved: number; remaining: number; limit: number }> {
  const tabId = sender.tab?.id;

  if (tabId === undefined) {
    return { ok: false, approved: 0, remaining: 0, limit: 0 };
  }

  const session = await getSession(tabId);
  const runId = session?.runId;

  if (!runId) {
    return {
      ok: true,
      approved: Math.max(0, requested),
      remaining: 0,
      limit: Math.max(0, requested)
    };
  }

  const reservation = await reserveJobOpeningsForRunId(runId, requested);

  return {
    ok: true,
    ...reservation
  };
}

async function limitSpawnItemsForSourceSession(
  sourceSession: AutomationSession | null,
  items: SpawnTabRequest[]
): Promise<SpawnTabRequest[]> {
  if (!sourceSession || sourceSession.stage !== "collect-results") {
    return items;
  }

  const jobOpeningItems = items.filter((item) => item.stage === "open-apply" || item.stage === "autofill-form");

  if (jobOpeningItems.length === 0) {
    return items;
  }

  if (Number.isFinite(sourceSession.jobSlots)) {
    const capped = Math.max(0, Math.floor(sourceSession.jobSlots ?? 0));
    return capJobOpeningItems(items, capped);
  }

  if (!sourceSession.runId) {
    return items;
  }

  const reservation = await reserveJobOpeningsForRunId(sourceSession.runId, jobOpeningItems.length);
  return capJobOpeningItems(items, reservation.approved);
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
    const remainingBefore = Math.max(0, runState.jobPageLimit - runState.openedJobPages);
    const approved = Math.min(safeRequested, remainingBefore);
    const remainingAfter = Math.max(0, remainingBefore - approved);

    if (approved > 0) {
      await setRunState({
        ...runState,
        openedJobPages: runState.openedJobPages + approved,
        updatedAt: Date.now()
      });
    }

    return {
      approved,
      remaining: remainingAfter,
      limit: runState.jobPageLimit
    };
  });
}

async function setSession(session: AutomationSession): Promise<void> {
  await chrome.storage.local.set({
    [getSessionStorageKey(session.tabId)]: session
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
  return (stored[key] as AutomationRunState | undefined) ?? null;
}

async function setRunState(runState: AutomationRunState): Promise<void> {
  await chrome.storage.local.set({
    [getAutomationRunStorageKey(runState.id)]: runState
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

async function withRunLock<T>(runId: string, task: () => Promise<T>): Promise<T> {
  const previous = runLocks.get(runId) ?? Promise.resolve();
  let releaseLock = () => {};
  const current = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  runLocks.set(runId, current);
  await previous.catch(() => {
    // Previous reservation failures should not block the queue.
  });

  try {
    return await task();
  } finally {
    releaseLock();

    if (runLocks.get(runId) === current) {
      runLocks.delete(runId);
    }
  }
}

function capJobOpeningItems(items: SpawnTabRequest[], limit: number): SpawnTabRequest[] {
  const safeLimit = Math.max(0, Math.floor(limit));
  const capped: SpawnTabRequest[] = [];
  let openedJobItems = 0;

  for (const item of items) {
    const isJobOpeningItem = item.stage === "open-apply" || item.stage === "autofill-form";

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

async function removeRunStateIfUnused(runId: string): Promise<void> {
  const stored = await chrome.storage.local.get(null);
  const sessionPrefix = "remote-job-search-session:";
  const hasActiveSession = Object.entries(stored).some(([key, value]) => {
    if (!key.startsWith(sessionPrefix) || typeof value !== "object" || value === null) {
      return false;
    }

    return "runId" in value && (value as { runId?: unknown }).runId === runId;
  });

  if (!hasActiveSession) {
    await removeRunState(runId);
  }
}

function getReadableSiteName(site: SiteKey): string {
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
