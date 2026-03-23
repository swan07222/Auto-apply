import { buildHrefContainsSelectors, JOB_DETAIL_ATS_URL_TOKENS } from "../sitePatterns";

export const GENERIC_APPLY_CANDIDATE_SELECTORS = [
  "a[href*='apply']",
  "a[href*='application']",
  "a[href]",
  "a[role='button']",
  "button",
  "input[type='submit']",
  "input[type='button']",
  "[aria-label*='apply' i]",
  "[title*='apply' i]",
  "[data-test*='apply' i]",
  "[data-test*='application' i]",
  "[data-testid*='apply']",
  "[data-automation*='apply']",
  "[class*='apply']",
  "[id*='apply']",
  "form button",
  "form a[href]",
];

export const GENERIC_CURRENT_JOB_SURFACE_SELECTORS = [
  "[data-testid*='job-detail' i]",
  "[data-testid*='jobDetail' i]",
  "[data-testid*='job-description' i]",
  "[data-testid*='jobDescription' i]",
  "[class*='job-detail']",
  "[class*='jobDetail']",
  "[class*='job_description']",
  "[class*='jobDescription']",
  "[class*='description']",
];

export const CAREER_SITE_JOB_LINK_SELECTORS = Array.from(
  new Set([
    "a[href*='builtin.com/job/']",
    "a[href*='/jobs/']",
    "a[href*='/job/']",
    "a[href*='/role/']",
    "a[href*='/roles/']",
    "a[href*='/positions/']",
    "a[href*='/position/']",
    "a[href*='/opportunity/']",
    "a[href*='/opportunities/']",
    "a[href*='/careers/']",
    "a[href*='/career/']",
    "a[href*='/openings/']",
    "a[href*='/opening/']",
    "a[href*='/vacancies/']",
    "a[href*='/vacancy/']",
    "a[href*='/job-posting/']",
    "a[href*='/job-postings/']",
    "a[href*='/requisition/']",
    "a[href*='/req/']",
    ...buildHrefContainsSelectors(JOB_DETAIL_ATS_URL_TOKENS),
  ])
);

export const DICE_NESTED_RESULT_SELECTORS = [
  "[aria-label='Job search results']",
  "[data-testid='job-search-results']",
  "dhi-search-card",
  "dhi-job-card",
  "dhi-search-cards-widget",
];

export const DICE_LIST_CARD_SELECTORS = [
  "[aria-label='Job search results'] [data-testid='job-card']",
  "[data-testid='job-search-results'] [data-testid='job-card']",
  "[data-testid='job-card']",
  "[aria-label='Job search results'] li",
  "[aria-label='Job search results'] article",
  "[data-testid='job-search-results'] li",
  "[data-testid='job-search-results'] article",
];

export const DICE_SEARCH_CARD_SELECTORS = [
  "dhi-search-card",
  "dhi-job-card",
  "dhi-search-cards-widget .card",
  "[data-testid='job-card']",
  "[data-testid='search-card']",
  "[class*='search-card']",
  "[class*='SearchCard']",
];
