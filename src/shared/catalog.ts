import type {
  AutomationSettings,
  DatePostedWindow,
  ResumeKind,
  SearchMode,
  SiteKey,
  StartupCompany,
  StartupRegion,
} from "./types";
import { createAutomationProfile, createEmptyCandidateProfile } from "./profiles";

type CuratedJobSiteDefinition = {
  label: string;
  regions: Exclude<StartupRegion, "auto">[];
  buildUrl: (keyword: string) => string | null;
};

export const SUPPORTED_SITE_LABELS: Record<SiteKey, string> = {
  indeed: "Indeed",
  ziprecruiter: "ZipRecruiter",
  dice: "Dice",
  monster: "Monster",
  glassdoor: "Glassdoor",
  greenhouse: "Greenhouse",
  builtin: "Built In",
  startup: "Startup Careers",
  other_sites: "Other Job Sites",
};

export const SEARCH_MODE_LABELS: Record<SearchMode, string> = {
  job_board: "Job Boards",
  startup_careers: "Startup Careers",
  other_job_sites: "Other Job Sites",
};

export const STARTUP_REGION_LABELS: Record<StartupRegion, string> = {
  auto: "Auto",
  us: "US",
  uk: "UK",
  eu: "EU",
};

export const DATE_POSTED_WINDOW_LABELS: Record<DatePostedWindow, string> = {
  any: "Any time",
  "24h": "Past 24 hours",
  "3d": "Past 3 days",
  "1w": "Past week",
};

export const RESUME_KIND_LABELS: Record<ResumeKind, string> = {
  front_end: "Front End",
  back_end: "Back End",
  full_stack: "Full Stack",
};

export const DEFAULT_STARTUP_COMPANIES: StartupCompany[] = [
  { name: "Ramp", careersUrl: "https://jobs.ashbyhq.com/ramp", regions: ["us"] },
  { name: "Vercel", careersUrl: "https://job-boards.greenhouse.io/vercel", regions: ["us"] },
  { name: "Plaid", careersUrl: "https://jobs.lever.co/plaid", regions: ["us"] },
  { name: "Figma", careersUrl: "https://job-boards.greenhouse.io/figma", regions: ["us"] },
  { name: "Notion", careersUrl: "https://www.notion.so/careers", regions: ["us"] },
  {
    name: "Veeva",
    careersUrl: "https://careers.veeva.com/job-search-results/",
    regions: ["us", "uk", "eu"],
  },
  { name: "Monzo", careersUrl: "https://job-boards.greenhouse.io/monzo", regions: ["uk"] },
  { name: "Wise", careersUrl: "https://wise.jobs/", regions: ["uk"] },
  { name: "Synthesia", careersUrl: "https://synthesia.io/careers", regions: ["uk"] },
  { name: "Snyk", careersUrl: "https://snyk.io/careers/", regions: ["uk"] },
  { name: "Checkout.com", careersUrl: "https://www.checkout.com/careers", regions: ["uk"] },
  { name: "N26", careersUrl: "https://n26.com/en-eu/careers", regions: ["eu"] },
  { name: "Bolt", careersUrl: "https://bolt.eu/en/careers/", regions: ["eu"] },
  { name: "Adyen", careersUrl: "https://careers.adyen.com/", regions: ["eu"] },
  { name: "GetYourGuide", careersUrl: "https://www.getyourguide.careers/", regions: ["eu"] },
  { name: "Klarna", careersUrl: "https://www.klarna.com/careers/", regions: ["eu"] },
];

export const STARTUP_COMPANIES = DEFAULT_STARTUP_COMPANIES;
export const STARTUP_COMPANIES_FEED_URL =
  "https://raw.githubusercontent.com/swan07222/Auto-apply/main/data/startup-companies.json";

export const OTHER_JOB_SITE_DEFINITIONS: CuratedJobSiteDefinition[] = [
  {
    label: "Built In",
    regions: ["us"],
    buildUrl: (keyword) =>
      `https://builtin.com/jobs/remote?search=${encodeURIComponent(keyword)}`,
  },
  {
    label: "The Muse",
    regions: ["us"],
    buildUrl: (keyword) =>
      `https://www.themuse.com/search/jobs?search=${encodeURIComponent(keyword)}&location=United%20States`,
  },
  {
    label: "Work at a Startup",
    regions: ["us"],
    buildUrl: (keyword) =>
      `https://www.workatastartup.com/jobs?query=${encodeURIComponent(keyword)}`,
  },
  {
    label: "Reed",
    regions: ["uk"],
    buildUrl: (keyword) =>
      `https://www.reed.co.uk/jobs/${encodeSearchQueryForPath(keyword)}-jobs-in-united-kingdom`,
  },
  {
    label: "CWJobs",
    regions: ["uk"],
    buildUrl: (keyword) =>
      `https://www.cwjobs.co.uk/jobs/${encodeSearchQueryForPath(keyword)}/in-united-kingdom`,
  },
  {
    label: "Totaljobs",
    regions: ["uk"],
    buildUrl: (keyword) =>
      `https://www.totaljobs.com/jobs/${encodeSearchQueryForPath(keyword)}/in-united-kingdom`,
  },
  {
    label: "Welcome to the Jungle",
    regions: ["eu"],
    buildUrl: (keyword) =>
      `https://www.welcometothejungle.com/en/jobs?query=${encodeURIComponent(keyword)}`,
  },
  {
    label: "Berlin Startup Jobs",
    regions: ["eu"],
    buildUrl: (keyword) =>
      `https://berlinstartupjobs.com/?s=${encodeURIComponent(keyword)}`,
  },
];

export const SEARCH_OPEN_DELAY_MS = 900;
export const VERIFICATION_POLL_MS = 600;
export const VERIFICATION_TIMEOUT_MS = 300_000;
export const AUTOMATION_SETTINGS_STORAGE_KEY = "remote-job-search-settings";
export const STARTUP_COMPANIES_CACHE_STORAGE_KEY =
  "remote-job-search-startup-companies-cache";
export const STARTUP_COMPANIES_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const STARTUP_COMPANIES_REFRESH_ALARM =
  "remote-job-search-refresh-startup-companies";
export const MIN_JOB_PAGE_LIMIT = 1;
export const MAX_JOB_PAGE_LIMIT = 25;

const DEFAULT_PROFILE = createAutomationProfile();

export const DEFAULT_SETTINGS: AutomationSettings = {
  jobPageLimit: 5,
  autoUploadResumes: true,
  searchMode: "job_board",
  startupRegion: "auto",
  datePostedWindow: "any",
  searchKeywords: "",
  activeProfileId: DEFAULT_PROFILE.id,
  profiles: {
    [DEFAULT_PROFILE.id]: DEFAULT_PROFILE,
  },
  candidate: createEmptyCandidateProfile(),
  resume: null,
  resumes: {},
  answers: {},
  preferenceAnswers: {},
};

export const CANONICAL_JOB_BOARD_ORIGINS = {
  indeed: "https://www.indeed.com",
  ziprecruiter: "https://www.ziprecruiter.com",
  dice: "https://www.dice.com",
  monster: "https://www.monster.com",
  glassdoor: "https://www.glassdoor.com",
  greenhouse: "https://job-boards.greenhouse.io",
  builtin: "https://builtin.com",
} as const;

const STARTUP_TARGET_REGIONS: Array<Exclude<StartupRegion, "auto">> = [
  "us",
  "uk",
  "eu",
];

export function getStartupTargetRegions(): Array<Exclude<StartupRegion, "auto">> {
  return [...STARTUP_TARGET_REGIONS];
}

function encodeSearchQueryForPath(query: string): string {
  return query
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
