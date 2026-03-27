import {
  buildSearchTargets,
  normalizeQuestionKey,
  type DatePostedWindow,
} from "../shared";
import { collectDeepMatches, getNavigationUrl, isElementInteractive } from "./dom";
import { cleanText } from "./text";

const GREENHOUSE_RESULT_SURFACE_SELECTOR =
  "a[href*='view_job'], a[href*='job_id='], a[href*='/jobs/'], [class*='job-card'], [class*='result-card'], [class*='search-result'], article[class*='job'], article[class*='result']";
const GREENHOUSE_OVERLAY_SCOPE_SELECTOR =
  "[role='listbox'], [role='menu'], [role='dialog'], [class*='popover'], [class*='dropdown'], [class*='menu']";

function readGreenhouseControlText(element: HTMLElement): string {
  const input = element as HTMLInputElement;

  return cleanText(
    [
      input.value,
      element.innerText || element.textContent || "",
      element.getAttribute("aria-label"),
      element.getAttribute("aria-labelledby"),
      element.getAttribute("aria-description"),
      element.getAttribute("aria-placeholder"),
      element.getAttribute("placeholder"),
      element.getAttribute("title"),
      element.getAttribute("name"),
      element.getAttribute("id"),
      element.getAttribute("data-testid"),
      element.getAttribute("data-test"),
      element.className,
    ]
      .filter(Boolean)
      .join(" ")
  ).toLowerCase();
}

function readGreenhouseFieldCueText(element: HTMLElement): string {
  const container = element.closest<HTMLElement>(
    "label, fieldset, [role='group'], [role='combobox'], [data-testid], [data-test], [class*='field'], [class*='filter'], [class*='input'], [class*='control']"
  );

  return cleanText(
    [
      readGreenhouseControlText(element),
      container?.innerText || container?.textContent || "",
      container?.getAttribute("aria-label") || "",
      container?.getAttribute("title") || "",
      container?.getAttribute("data-testid") || "",
      container?.getAttribute("data-test") || "",
      container?.className || "",
    ]
      .filter(Boolean)
      .join(" ")
  ).toLowerCase();
}

function looksLikeMyGreenhouseLocationControl(element: HTMLElement): boolean {
  return /\b(location|country|where|region)\b/.test(
    readGreenhouseFieldCueText(element)
  );
}

function collectInteractiveMatches<T extends HTMLElement>(
  selectors: string[],
  predicate?: (element: T) => boolean
): T[] {
  const matches: T[] = [];
  const seen = new Set<T>();

  for (const selector of selectors) {
    for (const element of collectDeepMatches<T>(selector)) {
      if (seen.has(element) || !isElementInteractive(element)) {
        continue;
      }

      if (predicate && !predicate(element)) {
        continue;
      }

      seen.add(element);
      matches.push(element);
    }
  }

  return matches;
}

function collectVisibleOverlayScopes(): HTMLElement[] {
  return collectDeepMatches<HTMLElement>(GREENHOUSE_OVERLAY_SCOPE_SELECTOR).filter(
    (candidate) => isElementInteractive(candidate)
  );
}

export function getMyGreenhouseControlValue(
  control: HTMLElement | null | undefined
): string {
  if (!control) {
    return "";
  }

  const input = control as HTMLInputElement;
  return cleanText(input.value || control.innerText || control.textContent || "");
}

export function resolveMyGreenhouseCanonicalSearchUrl(
  currentUrl: string,
  keyword: string,
  candidateCountry: string,
  datePostedWindow: DatePostedWindow = "any"
): string | null {
  if (!currentUrl || !keyword.trim()) {
    return null;
  }

  return (
    buildSearchTargets(
      "greenhouse",
      currentUrl,
      keyword,
      candidateCountry,
      datePostedWindow
    )[0]?.url ?? null
  );
}

export function findMyGreenhouseKeywordInput(): HTMLInputElement | null {
  return (
    collectInteractiveMatches<HTMLInputElement>([
      "input[placeholder*='job title' i]",
      "input[aria-label*='job title' i]",
      "input[placeholder*='search' i]",
      "input[aria-label*='search' i]",
      "input[name*='job' i]",
      "input[name*='title' i]",
      "input[name*='keyword' i]",
      "input[id*='keyword' i]",
      "input[type='search']",
    ])[0] ?? null
  );
}

export function findMyGreenhouseLocationControl(): HTMLElement | null {
  const directInput =
    collectInteractiveMatches<HTMLElement>(
      [
        "input[placeholder*='location' i]",
        "input[aria-label*='location' i]",
        "input[placeholder*='country' i]",
        "input[aria-label*='country' i]",
        "input[placeholder*='where' i]",
        "input[aria-label*='where' i]",
        "input[name*='location' i]",
        "input[id*='location' i]",
        "input[name*='country' i]",
        "input[id*='country' i]",
        "input[aria-autocomplete='list']",
        "[role='combobox'] input",
      ],
      (element) => looksLikeMyGreenhouseLocationControl(element)
    )[0] ?? null;

  if (directInput) {
    return directInput;
  }

  return (
    collectInteractiveMatches<HTMLElement>(
      [
        "button",
        "[role='button']",
        "[role='combobox']",
        "[aria-haspopup='listbox']",
      ],
      (element) =>
        isMyGreenhouseFilterCandidate(element) &&
        looksLikeMyGreenhouseLocationControl(element)
    )[0] ?? null
  );
}

export function findMyGreenhouseLocationOverlayInput(): HTMLInputElement | null {
  const scopes = collectVisibleOverlayScopes();
  for (const scope of scopes) {
    const input = collectInteractiveMatches<HTMLInputElement>(
      [
        "input[placeholder*='location' i]",
        "input[aria-label*='location' i]",
        "input[placeholder*='country' i]",
        "input[aria-label*='country' i]",
        "input[placeholder*='where' i]",
        "input[aria-label*='where' i]",
        "input[placeholder*='search' i]",
        "input[aria-label*='search' i]",
        "input[type='search']",
        "input",
      ],
      (element) => scope.contains(element)
    )[0];

    if (input) {
      return input;
    }
  }

  return null;
}

export function findMyGreenhouseSearchButton(): HTMLElement | null {
  return (
    collectInteractiveMatches<HTMLElement>([
      "button",
      "[role='button']",
      "input[type='submit']",
      "input[type='button']",
    ]).find((candidate) => {
      const text = readGreenhouseControlText(candidate);
      return (
        text === "search" ||
        text.startsWith("search ") ||
        text.includes("search jobs")
      );
    }) ?? null
  );
}

export function findMyGreenhouseWorkTypeButton(): HTMLElement | null {
  const workTypeTokens = [
    "work type",
    "job type",
    "employment type",
    "workplace type",
    "location type",
    "work arrangement",
  ];

  return (
    collectInteractiveMatches<HTMLElement>(
      [
        "button",
        "[role='button']",
        "[role='combobox']",
        "[aria-haspopup='listbox']",
      ],
      (element) => {
        if (!isMyGreenhouseFilterCandidate(element)) {
          return false;
        }

        const text = readGreenhouseControlText(element);
        return workTypeTokens.some((token) => text.includes(token));
      }
    )[0] ?? null
  );
}

export function findMyGreenhouseRemoteOption(
  preferOverlayScope = false
): HTMLElement | null {
  const overlayScopes = preferOverlayScope ? collectVisibleOverlayScopes() : [];
  const scopes: ParentNode[] = overlayScopes.length > 0 ? overlayScopes : [document];

  for (const scope of scopes) {
    let candidates: HTMLElement[] = [];

    try {
      candidates = Array.from(
        scope.querySelectorAll<HTMLElement>(
          "label, button, [role='button'], [role='checkbox'], [role='option'], [role='menuitemcheckbox'], [role='menuitemradio']"
        )
      );
    } catch {
      continue;
    }

    for (const candidate of candidates) {
      if (!isMyGreenhouseFilterCandidate(candidate)) {
        continue;
      }

      const text = readGreenhouseControlText(candidate);
      if (
        text === "remote" ||
        text.startsWith("remote ") ||
        text === "fully remote" ||
        text.startsWith("fully remote ") ||
        text === "remote only" ||
        text.startsWith("remote only ")
      ) {
        return candidate;
      }
    }
  }

  return null;
}

export function isMyGreenhouseRemoteOptionSelected(element: HTMLElement): boolean {
  const control =
    element.matches("input[type='checkbox'], input[type='radio']")
      ? (element as HTMLInputElement)
      : element.querySelector<HTMLInputElement>("input[type='checkbox'], input[type='radio']");

  if (control?.checked) {
    return true;
  }

  return (
    element.getAttribute("aria-checked") === "true" ||
    element.getAttribute("aria-selected") === "true" ||
    element.getAttribute("data-state") === "checked" ||
    /\b(selected|checked|active)\b/i.test(
      [
        element.className,
        element.getAttribute("data-testid"),
        element.getAttribute("data-test"),
      ]
        .filter(Boolean)
        .join(" ")
    )
  );
}

export function isMyGreenhouseFilterCandidate(element: HTMLElement): boolean {
  if (!element || !isElementInteractive(element)) {
    return false;
  }

  if (element.closest(GREENHOUSE_RESULT_SURFACE_SELECTOR)) {
    return false;
  }

  const navigationUrl = getNavigationUrl(element);
  if (navigationUrl && /\/view_job|job_id=|\/jobs\//i.test(navigationUrl)) {
    return false;
  }

  return true;
}

export function findMyGreenhouseLocationOption(
  value: string,
  preferOverlayScope = false
): HTMLElement | null {
  const normalizedValue = normalizeQuestionKey(value);
  if (!normalizedValue) {
    return null;
  }

  const scopes: ParentNode[] =
    preferOverlayScope && collectVisibleOverlayScopes().length > 0
      ? collectVisibleOverlayScopes()
      : [document];

  for (const scope of scopes) {
    let candidates: HTMLElement[] = [];

    try {
      candidates = Array.from(
        scope.querySelectorAll<HTMLElement>(
          "[role='option'], [role='listbox'] *, [class*='option'], [id*='option' i]"
        )
      );
    } catch {
      continue;
    }

    for (const candidate of candidates) {
      if (candidate.closest(GREENHOUSE_RESULT_SURFACE_SELECTOR)) {
        continue;
      }

      const text = normalizeQuestionKey(
        cleanText(
          [
            candidate.innerText || candidate.textContent || "",
            candidate.getAttribute("aria-label"),
            candidate.getAttribute("title"),
          ]
            .filter(Boolean)
            .join(" ")
        )
      );

      if (
        text === normalizedValue ||
        text.startsWith(`${normalizedValue} `) ||
        text.includes(normalizedValue)
      ) {
        return candidate;
      }
    }
  }

  return null;
}
