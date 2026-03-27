export type SiteKey =
  | "indeed"
  | "ziprecruiter"
  | "dice"
  | "monster"
  | "glassdoor"
  | "greenhouse"
  | "builtin"
  | "startup"
  | "other_sites";

export type JobBoardSite = Exclude<SiteKey, "startup" | "other_sites">;
export type ResumeKind = "front_end" | "back_end" | "full_stack";
export type SearchMode = "job_board" | "startup_careers" | "other_job_sites";
export type StartupRegion = "auto" | "us" | "uk" | "eu";
export type DatePostedWindow =
  | "any"
  | "24h"
  | "2d"
  | "3d"
  | "5d"
  | "1w"
  | "10d"
  | "14d"
  | "30d";

export type AutomationStage =
  | "bootstrap"
  | "collect-results"
  | "open-apply"
  | "autofill-form";

export type AutomationPhase =
  | "idle"
  | "running"
  | "queued"
  | "paused"
  | "waiting_for_verification"
  | "completed"
  | "error";

export interface AutomationRunSummary {
  queuedJobCount: number;
  successfulJobPages: number;
  appliedTodayCount: number;
  stopRequested: boolean;
}

export interface AutomationStatus {
  phase: AutomationPhase;
  message: string;
  site: SiteKey | "unsupported";
  updatedAt: number;
}

export interface AutomationSession extends AutomationStatus {
  tabId: number;
  shouldResume: boolean;
  stage: AutomationStage;
  manualSubmitPending?: boolean;
  runId?: string;
  jobSlots?: number;
  label?: string;
  keyword?: string;
  resumeKind?: ResumeKind;
  profileId?: string;
  controllerFrameId?: number;
  claimedJobKey?: string;
  openedUrlKey?: string;
  runSummary?: AutomationRunSummary;
}

export interface SearchTarget {
  label: string;
  url: string;
  resumeKind?: ResumeKind;
  keyword?: string;
}

export interface StartupCompany {
  name: string;
  careersUrl: string;
  regions: Exclude<StartupRegion, "auto">[];
}

export interface StartupCompanyCache {
  companies: StartupCompany[];
  updatedAt: number;
  sourceUrl: string;
}

export interface SpawnTabRequest {
  url: string;
  site: SiteKey;
  active?: boolean;
  stage?: AutomationStage;
  runId?: string;
  claimedJobKey?: string;
  jobSlots?: number;
  message?: string;
  label?: string;
  resumeKind?: ResumeKind;
  profileId?: string;
  keyword?: string;
}

export interface ResumeAsset {
  name: string;
  type: string;
  dataUrl: string;
  textContent: string;
  size: number;
  updatedAt: number;
}

export interface SavedAnswer {
  question: string;
  value: string;
  updatedAt: number;
}

export interface CandidateProfile {
  fullName: string;
  email: string;
  phone: string;
  city: string;
  state: string;
  country: string;
  linkedinUrl: string;
  portfolioUrl: string;
  currentCompany: string;
  yearsExperience: string;
  workAuthorization: string;
  needsSponsorship: string;
  willingToRelocate: string;
}

export interface AutomationProfile {
  id: string;
  name: string;
  candidate: CandidateProfile;
  resume: ResumeAsset | null;
  answers: Record<string, SavedAnswer>;
  preferenceAnswers: Record<string, SavedAnswer>;
  updatedAt: number;
}

export interface AutomationSettings {
  jobPageLimit: number;
  autoUploadResumes: boolean;
  searchMode: SearchMode;
  startupRegion: StartupRegion;
  datePostedWindow: DatePostedWindow;
  searchKeywords: string;
  activeProfileId: string;
  profiles: Record<string, AutomationProfile>;
  candidate: CandidateProfile;
  resume: ResumeAsset | null;
  resumes: Partial<Record<ResumeKind, ResumeAsset>>;
  answers: Record<string, SavedAnswer>;
  preferenceAnswers: Record<string, SavedAnswer>;
}

export type BrokenPageReason =
  | "access_denied"
  | "bad_gateway"
  | "not_found";
