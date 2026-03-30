import { RESUME_KIND_LABELS, SUPPORTED_SITE_LABELS } from "./catalog";
import type {
  AutomationPhase,
  AutomationSession,
  AutomationStage,
  AutomationStatus,
  JobBoardSite,
  ResumeKind,
  SiteKey,
} from "./types";

export function detectSiteFromUrl(url: string): SiteKey | null {
  if (!url || typeof url !== "string") {
    return null;
  }

  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }

  const bare = hostname.replace(/^www\./, "");
  if (bare === "indeed.com" || bare.endsWith(".indeed.com")) return "indeed";
  if (bare === "ziprecruiter.com" || bare.endsWith(".ziprecruiter.com")) return "ziprecruiter";
  if (bare === "dice.com" || bare.endsWith(".dice.com")) return "dice";
  if (bare === "builtin.com" || bare.endsWith(".builtin.com")) return "builtin";
  if (bare === "greenhouse.io" || bare.endsWith(".greenhouse.io")) return "greenhouse";
  if (bare === "ashbyhq.com" || bare.endsWith(".ashbyhq.com")) return "other_sites";
  if (
    bare === "workdayjobs.com" ||
    bare.endsWith(".workdayjobs.com") ||
    bare === "myworkdayjobs.com" ||
    bare.endsWith(".myworkdayjobs.com")
  ) {
    return "other_sites";
  }

  const hostParts = bare.split(".");
  for (let index = 0; index < hostParts.length; index += 1) {
    if (hostParts[index] === "monster" && index < hostParts.length - 1) {
      return "monster";
    }
    if (hostParts[index] === "glassdoor" && index < hostParts.length - 1) {
      return "glassdoor";
    }
  }

  return null;
}

export function createStatus(
  site: SiteKey | "unsupported",
  phase: AutomationPhase,
  message: string
): AutomationStatus {
  return {
    site,
    phase,
    message,
    updatedAt: Date.now(),
  };
}

export function createSession(
  tabId: number,
  site: SiteKey,
  phase: AutomationPhase,
  message: string,
  shouldResume: boolean,
  stage: AutomationStage,
  runId?: string,
  label?: string,
  keyword?: string,
  resumeKind?: ResumeKind,
  profileId?: string
): AutomationSession {
  return {
    tabId,
    shouldResume,
    stage,
    runId,
    label,
    keyword,
    resumeKind,
    profileId,
    ...createStatus(site, phase, message),
  };
}

export function getSessionStorageKey(tabId: number): string {
  return `remote-job-search-session:${tabId}`;
}

export function getSiteLabel(site: SiteKey | "unsupported" | null): string {
  if (site === null || site === "unsupported") {
    return "Unsupported";
  }
  return SUPPORTED_SITE_LABELS[site];
}

export function resolveSessionSite(
  sessionSite: SiteKey | "unsupported",
  detectedSite: SiteKey | null
): SiteKey | "unsupported" {
  return detectedSite ?? sessionSite;
}

export function resolveAutomationTargetSite(
  fallbackSite: SiteKey,
  targetUrl: string
): SiteKey;
export function resolveAutomationTargetSite(
  fallbackSite: SiteKey | "unsupported",
  targetUrl: string
): SiteKey | "unsupported";
export function resolveAutomationTargetSite(
  fallbackSite: SiteKey | "unsupported",
  targetUrl: string
): SiteKey | "unsupported" {
  return resolveSessionSite(fallbackSite, detectSiteFromUrl(targetUrl));
}

export function isJobBoardSite(
  site: SiteKey | null | "unsupported"
): site is JobBoardSite {
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

export function shouldKeepManagedJobPageOpen(
  site: SiteKey | "unsupported"
): boolean {
  return site === "dice";
}

export function getResumeKindLabel(resumeKind: ResumeKind): string {
  return RESUME_KIND_LABELS[resumeKind];
}
