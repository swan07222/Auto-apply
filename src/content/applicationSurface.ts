import { sleep, SiteKey } from "../shared";
import {
  getFieldDescriptor,
  getQuestionText,
  matchesDescriptor,
  shouldAutofillField,
} from "./autofill";
import { isElementVisible, normalizeUrl } from "./dom";
import {
  findApplyAction,
  findCompanySiteAction,
  findProgressionAction,
  hasIndeedApplyIframe,
  hasZipRecruiterApplyModal,
  isAlreadyOnApplyPage,
} from "./apply";
import { cleanText, normalizeChoiceText } from "./text";
import { AutofillField } from "./types";

type ApplicationSurfaceCollectors = {
  collectAutofillFields: () => AutofillField[];
  collectResumeFileInputs: () => HTMLInputElement[];
};

const APPLICATION_FRAME_SELECTOR =
  "iframe[src*='apply'], iframe[src*='application'], iframe[id*='apply'], iframe[class*='apply'], iframe[src*='greenhouse'], iframe[src*='lever'], iframe[src*='workday'], iframe[data-src*='apply'], iframe[data-src*='application'], iframe[data-src*='greenhouse'], iframe[data-src*='lever'], iframe[data-src*='workday']";

export async function waitForLikelyApplicationSurface(
  site: SiteKey,
  collectors: ApplicationSurfaceCollectors
): Promise<boolean> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (hasLikelyApplicationSurface(site, collectors)) {
      return true;
    }

    if (attempt === 5 || attempt === 10 || attempt === 15 || attempt === 20) {
      window.scrollTo({
        top: document.body.scrollHeight / 2,
        behavior: "smooth",
      });
    }

    await sleep(700);
  }

  return false;
}

export function hasLikelyApplicationForm(
  collectors: ApplicationSurfaceCollectors
): boolean {
  const relevantFields = collectors.collectAutofillFields().filter(
    (field) => shouldAutofillField(field, true, true) && isLikelyApplicationField(field)
  );

  if (relevantFields.length >= 2) {
    return true;
  }

  return collectors.collectResumeFileInputs().some(
    (input) => shouldAutofillField(input, true, true) && isLikelyApplicationField(input)
  );
}

export function hasLikelyApplicationFrame(): boolean {
  return collectLikelyApplicationFrames().length > 0;
}

export function findStandaloneApplicationFrameUrl(
  collectors: ApplicationSurfaceCollectors
): string | null {
  const localRelevantFields = collectors.collectAutofillFields().filter(
    (field) => shouldAutofillField(field, true, true) && isLikelyApplicationField(field)
  );

  if (localRelevantFields.length > 0) {
    return null;
  }

  const hasLocalResumeUpload = collectors.collectResumeFileInputs().some(
    (input) => shouldAutofillField(input, true, true) && isLikelyApplicationField(input)
  );

  if (hasLocalResumeUpload) {
    return null;
  }

  let best:
    | {
        score: number;
        url: string;
      }
    | undefined;

  for (const frame of collectLikelyApplicationFrames()) {
    if (!best || frame.score > best.score) {
      best = {
        score: frame.score,
        url: frame.url,
      };
    }
  }

  return best?.url ?? null;
}

function collectLikelyApplicationFrames(): Array<{
  frame: HTMLIFrameElement;
  score: number;
  url: string;
}> {
  const frames: Array<{
    frame: HTMLIFrameElement;
    score: number;
    url: string;
  }> = [];

  for (const frame of Array.from(
    document.querySelectorAll<HTMLIFrameElement>(APPLICATION_FRAME_SELECTOR)
  )) {
    if (!isElementVisible(frame)) {
      continue;
    }

    const rawUrl = frame.getAttribute("src") || frame.getAttribute("data-src") || "";
    const url = normalizeUrl(rawUrl);

    if (!url) {
      continue;
    }

    const lower = url.toLowerCase();
    const frameSignals = [
      frame.id,
      frame.className,
      frame.getAttribute("title"),
      frame.getAttribute("aria-label"),
    ]
      .join(" ")
      .toLowerCase();

    let score = 0;

    if (lower.includes("greenhouse.io")) score += 120;
    if (lower.includes("lever.co")) score += 110;
    if (lower.includes("workdayjobs.com") || lower.includes("myworkdayjobs.com")) {
      score += 110;
    }
    if (lower.includes("apply")) score += 40;
    if (lower.includes("application")) score += 35;
    if (lower.includes("candidate")) score += 30;
    if (frameSignals.includes("apply")) score += 20;
    if (frameSignals.includes("application")) score += 18;
    if (frameSignals.includes("resume")) score += 12;

    if (score <= 0) {
      continue;
    }

    frames.push({
      frame,
      score,
      url,
    });
  }

  return frames;
}

export function hasLikelyApplicationSurface(
  site: SiteKey,
  collectors: ApplicationSurfaceCollectors
): boolean {
  if (site === "indeed" && hasIndeedApplyIframe()) {
    return true;
  }

  if (site === "ziprecruiter" && hasZipRecruiterApplyModal()) {
    return true;
  }

  const onApplyLikeUrl = isAlreadyOnApplyPage(site, window.location.href);
  const hasPageContent = hasLikelyApplicationPageContent();
  const hasProgression = Boolean(findProgressionAction(site));
  const hasCompanySiteStep = Boolean(findCompanySiteAction());
  const stillLooksLikeJobPage = Boolean(findApplyAction(site, "job-page"));

  return (
    hasLikelyApplicationForm(collectors) ||
    hasLikelyApplicationFrame() ||
    (onApplyLikeUrl && (hasPageContent || hasProgression || hasCompanySiteStep)) ||
    (hasPageContent &&
      (hasProgression || hasCompanySiteStep) &&
      !stillLooksLikeJobPage) ||
    (onApplyLikeUrl && hasPageContent)
  );
}

export function isLikelyApplicationField(field: AutofillField): boolean {
  const question = getQuestionText(field);
  const descriptor = getFieldDescriptor(field, question);
  if (!descriptor) {
    return false;
  }

  if (
    matchesDescriptor(descriptor, [
      "job title",
      "keywords",
      "search jobs",
      "search for jobs",
      "find jobs",
      "job search",
      "search by keyword",
      "enter location",
      "search location",
      "filter",
      "sort by",
    ])
  ) {
    return false;
  }

  if (
    descriptor === "what" ||
    descriptor === "where" ||
    descriptor === "search" ||
    descriptor === "q"
  ) {
    return false;
  }

  if (field instanceof HTMLInputElement) {
    const type = field.type.toLowerCase();
    if (type === "search") {
      return false;
    }

    if (type === "file") {
      return matchesDescriptor(descriptor, [
        "resume",
        "cv",
        "cover letter",
        "attachment",
        "upload",
        "document",
      ]);
    }
  }

  const fieldAutocomplete = (field.getAttribute("autocomplete") || "")
    .toLowerCase()
    .trim();
  if (
    [
      "name",
      "given-name",
      "additional-name",
      "family-name",
      "email",
      "tel",
      "street-address",
      "address-line1",
      "address-line2",
      "address-level1",
      "address-level2",
      "postal-code",
      "country",
      "organization",
      "organization-title",
      "url",
    ].includes(fieldAutocomplete)
  ) {
    return true;
  }

  if (
    matchesDescriptor(descriptor, [
      "full name",
      "first name",
      "last name",
      "given name",
      "family name",
      "surname",
      "your name",
      "email",
      "phone",
      "mobile",
      "telephone",
      "linkedin",
      "portfolio",
      "website",
      "personal site",
      "github",
      "city",
      "location",
      "town",
      "address",
      "state",
      "province",
      "region",
      "country",
      "postal code",
      "zip code",
      "current company",
      "current employer",
      "employer",
      "experience",
      "years of experience",
      "year of experience",
      "total experience",
      "overall experience",
      "salary",
      "work authorization",
      "authorized to work",
      "eligible to work",
      "legally authorized",
      "authorized",
      "sponsorship",
      "visa",
      "relocate",
      "relocation",
      "cover letter",
      "resume",
      "cv",
      "education",
      "school",
      "degree",
      "start date",
      "available to start",
      "notice period",
    ])
  ) {
    return true;
  }

  const container = field.closest(
    "form, fieldset, [role='dialog'], article, section, main, aside, div"
  );
  const containerText = normalizeChoiceText(
    cleanText(container?.textContent).slice(0, 600)
  );
  if (!containerText) {
    return false;
  }

  if (
    [
      "job title",
      "keywords",
      "search jobs",
      "find jobs",
      "company reviews",
      "find salaries",
      "post a job",
    ].some((term) => containerText.includes(normalizeChoiceText(term)))
  ) {
    return false;
  }

  return [
    "application",
    "apply",
    "candidate",
    "resume",
    "cv",
    "cover letter",
    "work authorization",
    "experience",
    "employment",
    "education",
    "equal opportunity",
    "demographic",
  ].some((term) => containerText.includes(normalizeChoiceText(term)));
}

export function hasLikelyApplicationPageContent(): boolean {
  const bodyText = cleanText(document.body?.innerText || "")
    .toLowerCase()
    .slice(0, 5000);
  if (!bodyText) {
    return false;
  }

  const strongSignals = [
    "upload resume",
    "upload your resume",
    "upload cv",
    "attach resume",
    "attach your resume",
    "submit application",
    "apply for this",
    "application form",
    "submit your application",
    "start my application",
    "you re on your way to apply",
  ];

  if (strongSignals.some((token) => bodyText.includes(token))) {
    return true;
  }

  const weakSignals = [
    "application",
    "resume",
    "cover letter",
    "work authorization",
    "years of experience",
    "phone number",
    "email address",
    "linkedin",
    "portfolio",
    "salary",
    "start date",
    "notice period",
  ];

  const matchCount = weakSignals.filter((token) => bodyText.includes(token)).length;
  return matchCount >= 3;
}
