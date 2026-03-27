import { type AutomationStatus, type SearchMode, type SiteKey, createStatus, getSiteLabel } from "./shared";

type PopupIdlePreviewOptions = {
  activeSite: SiteKey | null;
  activeTabId: number | null;
  hasKeywords: boolean;
  regionLabel: string;
  searchMode: SearchMode;
  supportedJobBoardPrompt: string;
};

type PopupIdlePreview = {
  startDisabled: boolean;
  status: AutomationStatus;
};

export function getStartButtonLabel(searchMode: SearchMode): string {
  switch (searchMode) {
    case "startup_careers":
      return "Start Startup Search";
    case "other_job_sites":
      return "Start Other Sites Search";
    case "job_board":
      return "Start Auto Search";
  }
}

export function getSelectedSearchMode(value: string): SearchMode {
  if (value === "startup_careers") {
    return "startup_careers";
  }
  if (value === "other_job_sites") {
    return "other_job_sites";
  }
  return "job_board";
}

export function derivePopupIdlePreview(
  options: PopupIdlePreviewOptions
): PopupIdlePreview {
  const {
    activeSite,
    activeTabId,
    hasKeywords,
    regionLabel,
    searchMode,
    supportedJobBoardPrompt,
  } = options;
  const activeJobBoardSite = isJobBoardSite(activeSite) ? activeSite : null;

  if (!hasKeywords) {
    return {
      status: createStatus(
        searchMode === "job_board"
          ? activeJobBoardSite ?? "unsupported"
          : searchMode === "startup_careers"
            ? "startup"
            : "other_sites",
        "error",
        "Add at least one search keyword before starting automation."
      ),
      startDisabled: true,
    };
  }

  if (searchMode === "startup_careers") {
    return {
      status: createStatus(
        "startup",
        "idle",
        `Ready to open startup career pages for ${regionLabel} companies.`
      ),
      startDisabled: false,
    };
  }

  if (searchMode === "other_job_sites") {
    return {
      status: createStatus(
        "other_sites",
        "idle",
        `Ready to open other job site searches for ${regionLabel}.`
      ),
      startDisabled: false,
    };
  }

  if (activeTabId === null) {
    return {
      status: createStatus("unsupported", "error", "No active tab was found."),
      startDisabled: true,
    };
  }

  if (!activeJobBoardSite) {
    return {
      status: createStatus("unsupported", "error", supportedJobBoardPrompt),
      startDisabled: true,
    };
  }

  return {
    status: createStatus(
      activeJobBoardSite,
      "idle",
      `Ready on ${getSiteLabel(activeJobBoardSite)}.`
    ),
    startDisabled: false,
  };
}

export function shouldDisableStartButtonForSession(
  searchMode: SearchMode,
  activeSite: SiteKey | null,
  session: AutomationStatus | null | undefined
): boolean {
  const sessionIsActive =
    session?.phase === "running" ||
    session?.phase === "queued" ||
    session?.phase === "paused" ||
    session?.phase === "waiting_for_verification";

  if (searchMode === "job_board") {
    return !isJobBoardSite(activeSite) || sessionIsActive;
  }

  return sessionIsActive;
}

function isJobBoardSite(site: SiteKey | null): boolean {
  return (
    site === "indeed" ||
    site === "ziprecruiter" ||
    site === "dice" ||
    site === "monster" ||
    site === "glassdoor" ||
    site === "greenhouse" ||
    site === "builtin"
  );
}
