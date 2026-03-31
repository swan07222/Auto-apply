export const CAREER_LISTING_TEXT_PATTERNS = [
  "open jobs",
  "open positions",
  "open roles",
  "current openings",
  "current positions",
  "see open jobs",
  "see open positions",
  "view all jobs",
  "view jobs",
  "search jobs",
  "search roles",
  "job board",
  "browse jobs",
  "browse roles",
] as const;

export const PRIORITY_CAREER_LISTING_TEXT_PATTERNS = [
  "open jobs",
  "open positions",
  "open roles",
  "current openings",
] as const;

const CAREER_LISTING_PATH_PATTERNS = [
  "/jobs",
  "/job-board",
  "/openings",
  "/positions",
  "/roles",
] as const;

const CAREER_LISTING_HOST_TOKENS = [
  "greenhouse.io",
  "lever.co",
  "ashbyhq.com",
  "workdayjobs.com",
  "myworkdayjobs.com",
  "workable.com",
  "jobvite.com",
  "smartrecruiters.com",
  "recruitee.com",
  "bamboohr.com",
] as const;

export const CAREER_LISTING_URL_PATTERNS = [
  ...CAREER_LISTING_PATH_PATTERNS,
  ...CAREER_LISTING_HOST_TOKENS,
] as const;

export const PRIORITY_CAREER_LISTING_URL_PATTERNS = [
  "greenhouse.io",
  "lever.co",
  "ashbyhq.com",
  "workdayjobs.com",
  "myworkdayjobs.com",
] as const;

export const KNOWN_ATS_HOST_TOKENS = [
  "greenhouse.io",
  "lever.co",
  "ashbyhq.com",
  "workable.com",
  "jobvite.com",
  "workdayjobs.com",
  "myworkdayjobs.com",
  "icims.com",
  "smartrecruiters.com",
  "applytojob.com",
  "recruitee.com",
  "breezy.hr",
  "bamboohr.com",
  "jobs.gem.com",
] as const;

export const JOB_DETAIL_ATS_URL_TOKENS = [
  "gh_jid=",
  "greenhouse.io",
  "lever.co",
  "ashbyhq.com",
  "workable.com",
  "jobvite.com",
  "myworkdayjobs.com",
  "workdayjobs.com",
  "icims.com/jobs/",
  "smartrecruiters.com",
  "applytojob.com",
  "recruitee.com",
  "breezy.hr",
  "bamboohr.com",
  "jobs.gem.com",
] as const;

export const ATS_APPLICATION_URL_TOKENS = [
  "job_app",
  "applytojob",
  "candidateexperience",
  "myworkdayjobs.com",
  "workdayjobs.com",
  "icims.com/jobs/candidate",
  "smartrecruiters.com",
  "greenhouse.io/embed/job_app",
] as const;

export const ATS_APPLICATION_SELECTOR_TOKENS = [
  "/apply/",
  "job_app",
  "candidate",
  "applytojob",
  "workdayjobs.com",
  "myworkdayjobs.com",
  "smartrecruiters.com",
  "icims.com/jobs/candidate",
  "workable.com",
  "greenhouse.io/embed/job_app",
] as const;

export const ATS_SCORING_URL_TOKENS = [
  "/apply",
  "/job",
  "/jobs",
  "/career",
  "/careers",
  "/position",
  "/positions",
  "/opening",
  "/openings",
  "application",
  "candidate",
  "requisition",
  "gh_jid=",
  "jobid",
  "job_id",
  "jid=",
] as const;

export function includesAnyToken(
  value: string,
  tokens: readonly string[]
): boolean {
  return tokens.some((token) => value.includes(token));
}

export function hasKnownAtsHost(value: string): boolean {
  return includesAnyToken(value.toLowerCase(), KNOWN_ATS_HOST_TOKENS);
}

export function hasJobDetailAtsUrl(value: string): boolean {
  return includesAnyToken(value.toLowerCase(), JOB_DETAIL_ATS_URL_TOKENS);
}

export function buildHrefContainsSelectors(
  tokens: readonly string[]
): string[] {
  return tokens.map((token) => `a[href*='${token}']`);
}
