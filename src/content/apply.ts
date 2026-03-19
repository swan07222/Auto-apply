// src/content/apply.ts
// COMPLETE FILE — replace entirely

import { SiteKey } from "../shared";
import { ApplyAction, ProgressionAction } from "./types";
import { cleanText } from "./text";
import {
  getActionText,
  getClickableApplyElement,
  getNavigationUrl,
  isElementVisible,
  isExternalUrl,
  normalizeUrl,
} from "./dom";

const COMPANY_SITE_GATE_TOKENS = [
  "company website to apply",
  "company site to apply",
  "continue to the company",
  "continue to company site",
  "continue to company website",
  "continue to employer site",
  "employer website",
  "apply on company site",
  "apply on company website",
  "apply on employer",
  "apply externally",
  "external application",
  "apply on the company",
  "visit company site",
  "visit employer site",
  "redirected to the company",
  "redirected to an external",
  "taken to the employer",
  "taken to the company",
  "company's website",
  "employer's website",
  "company career",
  "employer career",
  "apply on company's site",
  "apply on the employer",
  "apply at company",
  "apply at employer",
  "go to company site",
  "go to employer site",
  "view on company site",
  "apply directly",
  "direct application",
  "original posting",
  "original job posting",
  // FIX: Additional tokens for various sites
  "apply on external site",
  "apply on their site",
  "apply on their website",
  "view original posting",
  "view original job",
  "external job",
  "external link",
  "view application",
  "apply through",
];

const KNOWN_BROKEN_APPLY_HOSTS = ["apply.monster.com"];

function collectDeepMatches<T extends HTMLElement>(
  selector: string
): T[] {
  const results: T[] = [];
  const seen = new Set<Element>();
  const roots: Array<Document | ShadowRoot> = [document];

  while (roots.length > 0) {
    const root = roots.shift()!;

    try {
      for (const element of Array.from(root.querySelectorAll<T>(selector))) {
        if (seen.has(element)) {
          continue;
        }

        seen.add(element);
        results.push(element);
      }
    } catch {
      continue;
    }

    for (const host of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
      if (host.shadowRoot) {
        roots.push(host.shadowRoot);
      }
    }
  }

  return results;
}

function collectDeepMatchesFromSelectors(
  selectors: string[]
): HTMLElement[] {
  const results: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();

  for (const selector of selectors) {
    for (const element of collectDeepMatches<HTMLElement>(selector)) {
      if (seen.has(element)) {
        continue;
      }

      seen.add(element);
      results.push(element);
    }
  }

  return results;
}

function isKnownBrokenApplyUrl(url: string | null | undefined): boolean {
  if (!url) {
    return false;
  }

  try {
    const hostname = new URL(url, window.location.href).hostname.toLowerCase();
    return KNOWN_BROKEN_APPLY_HOSTS.includes(hostname);
  } catch {
    return false;
  }
}

export function findCompanySiteAction(): ApplyAction | null {
  const pageText = cleanText(document.body?.innerText || "")
    .toLowerCase()
    .slice(0, 6000);
  const hasGateText = COMPANY_SITE_GATE_TOKENS.some((token) => pageText.includes(token));
  const candidates = collectDeepMatchesFromSelectors([
    "a[href]",
    "button",
    "input[type='submit']",
    "input[type='button']",
    "[role='button']",
  ]);

  let best:
    | {
        element: HTMLElement;
        score: number;
        text: string;
        url: string | null;
      }
    | undefined;

  for (const element of candidates) {
    const actionElement = getClickableApplyElement(element);
    if (
      !isElementVisible(actionElement) ||
      actionElement.hasAttribute("disabled") ||
      (actionElement as HTMLButtonElement).disabled
    ) {
      continue;
    }

    const text = (getActionText(actionElement) || getActionText(element)).trim();
    const lower = text.toLowerCase();
    const url = getNavigationUrl(actionElement) ?? getNavigationUrl(element);
    const attrs = [
      actionElement.getAttribute("data-testid"),
      actionElement.getAttribute("data-tn-element"),
      actionElement.getAttribute("aria-label"),
      actionElement.getAttribute("title"),
      actionElement.className,
      actionElement.id,
      element.getAttribute("data-testid"),
      element.getAttribute("data-tn-element"),
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.className,
      element.id,
    ]
      .join(" ")
      .toLowerCase();

    if (
      [
        "save",
        "share",
        "report",
        "sign in",
        "sign up",
        "dismiss",
        "close",
        "back to search",
        "back to results",
        "log in",
        "register",
        "create account",
        "job alert",
        "subscribe",
      ].some((blocked) => lower.includes(blocked))
    ) {
      continue;
    }

    let score = 0;

    if (
      lower.includes("continue to company site") ||
      lower.includes("continue to company website")
    ) {
      score += 110;
    } else if (
      lower.includes("apply on company") ||
      lower.includes("apply on employer")
    ) {
      score += 105;
    } else if (lower.includes("apply externally") || lower.includes("apply directly")) {
      score += 102;
    } else if (lower.includes("apply on external") || lower.includes("apply through")) {
      score += 100;
    } else if (
      lower.includes("company site") ||
      lower.includes("company website")
    ) {
      score += 96;
    } else if (
      lower.includes("visit company") ||
      lower.includes("visit employer") ||
      lower.includes("go to company") ||
      lower.includes("go to employer")
    ) {
      score += 90;
    } else if (lower.includes("external application") || lower.includes("direct application")) {
      score += 85;
    } else if (lower.includes("view original") || lower.includes("original posting")) {
      score += 82;
    } else if (
      lower.includes("apply now") ||
      lower.includes("apply for this") ||
      lower.includes("continue")
    ) {
      score += 62;
    } else if (lower.includes("visit") && lower.includes("site")) {
      score += 72;
    } else if (lower.includes("apply")) {
      score += 55;
    }

    if (attrs.includes("company") || attrs.includes("employer")) {
      score += 20;
    }
    if (attrs.includes("external") || attrs.includes("apply")) {
      score += 12;
    }
    if (url && isExternalUrl(url)) {
      score += 28;
    }
    if (url && shouldPreferApplyNavigation(url, text, null)) {
      score += 20;
    }
    if (hasGateText) {
      score += 18;
    }

    // FIX: Lower threshold so company-site buttons are found more reliably
    const threshold = hasGateText ? 35 : 70;
    if (score < threshold) {
      continue;
    }

    if (!best || score > best.score) {
      best = { element: actionElement, score, text, url };
    }
  }

  if (!best) {
    return null;
  }

  if (
    best.url &&
    !isKnownBrokenApplyUrl(best.url) &&
    (isExternalUrl(best.url) || shouldPreferApplyNavigation(best.url, best.text, null))
  ) {
    return {
      type: "navigate",
      url: best.url,
      description: describeApplyTarget(best.url, best.text),
    };
  }

  const extractedUrl =
    extractLikelyApplyUrl(best.element) ??
    findExternalApplyUrlInDocument();
  if (extractedUrl) {
    return {
      type: "navigate",
      url: extractedUrl,
      description: describeApplyTarget(extractedUrl, best.text),
    };
  }

  return {
    type: "click",
    element: best.element,
    description: best.text || "the company career page",
  };
}

export function findMonsterApplyAction(): ApplyAction | null {
  // 1. Try custom web components first
  const customComponents = Array.from(
    document.querySelectorAll<HTMLElement>(
      "apply-button-wc, monster-apply-button, [data-testid*='applyButton'], [data-testid*='apply-button'], [data-testid='svx_applyButton']"
    )
  );

  for (const component of customComponents) {
    const attributeUrl = extractLikelyApplyUrl(component);
    if (attributeUrl) {
      return {
        type: "navigate",
        url: attributeUrl,
        description: "Monster apply button",
      };
    }

    const shadowTarget = component.shadowRoot?.querySelector<HTMLElement>(
      "a[href], button, input[type='submit'], input[type='button'], [role='button']"
    );
    if (shadowTarget && isElementVisible(shadowTarget)) {
      const url = getNavigationUrl(shadowTarget);
      if (url && shouldPreferApplyNavigation(url, getActionText(shadowTarget), "monster")) {
        return {
          type: "navigate",
          url,
          description: describeApplyTarget(url, getActionText(shadowTarget)),
        };
      }

      return {
        type: "click",
        element: shadowTarget,
        description: getActionText(shadowTarget) || "Monster apply button",
      };
    }

    const childTarget = getClickableApplyElement(component);
    if (childTarget !== component && isElementVisible(childTarget)) {
      const url = getNavigationUrl(childTarget);
      if (url && shouldPreferApplyNavigation(url, getActionText(childTarget), "monster")) {
        return {
          type: "navigate",
          url,
          description: describeApplyTarget(url, getActionText(childTarget)),
        };
      }

      return {
        type: "click",
        element: childTarget,
        description: getActionText(childTarget) || "Monster apply button",
      };
    }

    if (isElementVisible(component)) {
      return {
        type: "click",
        element: component,
        description: getActionText(component) || "Monster apply button",
      };
    }
  }

  // 2. Try specific Monster selectors
  const monsterSelectors = [
    "a[data-testid*='apply' i]",
    "button[data-testid*='apply' i]",
    "button[data-testid='svx_applyButton']",
    "[data-action*='apply' i]",
    "[data-track*='apply' i]",
    "[data-evt*='apply' i]",
    "[data-link*='apply' i]",
    "[data-url*='apply' i]",
    "[aria-label*='apply' i]",
    "[aria-label*='company site' i]",
    "button[class*='apply' i]",
    "a[class*='apply' i]",
    "button[class*='Apply']",
    "a[class*='Apply']",
    "[class*='applyBtn']",
    "[class*='apply-btn']",
    "[class*='apply_btn']",
    "[id*='applyBtn']",
    "[id*='apply-btn']",
    "[id*='apply_btn']",
    "a[href*='apply.monster']",
    "a[href*='/apply']",
    // FIX: Additional Monster selectors
    "[class*='ApplyButton']",
    "[class*='apply-button']",
    "[data-testid*='Apply']",
    "a[href*='job-openings'][href*='apply']",
  ];

  for (const selector of monsterSelectors) {
    let elements: HTMLElement[];
    try {
      elements = Array.from(document.querySelectorAll<HTMLElement>(selector));
    } catch {
      continue;
    }

    for (const element of elements) {
      if (!isElementVisible(element)) {
        continue;
      }

      const text = getActionText(element).toLowerCase().trim();
      if (
        !text ||
        text.includes("save") ||
        text.includes("share") ||
        text.includes("alert") ||
        text.includes("sign")
      ) {
        continue;
      }

      const url = getNavigationUrl(element);
      if (url && shouldPreferApplyNavigation(url, text, "monster")) {
        return {
          type: "navigate",
          url,
          description: describeApplyTarget(url, text),
        };
      }

      return {
        type: "click",
        element,
        description: text || "Apply",
      };
    }
  }

  // 3. Fallback: score all visible links/buttons
  const fallbackCandidates = Array.from(
    document.querySelectorAll<HTMLElement>("a[href], button, a[role='button']")
  );
  let best:
    | {
        element: HTMLElement;
        score: number;
        url: string | null;
        text: string;
      }
    | undefined;

  for (const element of fallbackCandidates) {
    if (!isElementVisible(element)) {
      continue;
    }

    const text = getActionText(element).toLowerCase().trim();
    if (
      !text ||
      text.includes("save") ||
      text.includes("share") ||
      text.includes("alert") ||
      text.includes("sign") ||
      text.includes("report") ||
      text.includes("dismiss") ||
      text.includes("close")
    ) {
      continue;
    }

    let score = 0;
    if (/(apply|continue|company|external|employer|resume)/.test(text)) {
      score += 50;
    }
    if (text.includes("apply now") || text.includes("apply on company")) {
      score += 25;
    }
    if (text === "apply" || text === "apply now") {
      score += 40;
    }
    // FIX: Boost for text containing "apply" as whole word
    if (/\bapply\b/.test(text)) {
      score += 15;
    }

    const url = getNavigationUrl(element);
    if (url && shouldPreferApplyNavigation(url, text, "monster")) {
      score += 30;
    }

    const attrs = [
      element.getAttribute("data-testid"),
      element.getAttribute("aria-label"),
      element.className,
      element.id,
    ]
      .join(" ")
      .toLowerCase();
    if (attrs.includes("apply")) {
      score += 20;
    }

    if (score < 50) {
      continue;
    }

    if (!best || score > best.score) {
      best = { element, score, url, text };
    }
  }

  if (!best) {
    return null;
  }

  if (best.url && shouldPreferApplyNavigation(best.url, best.text, "monster")) {
    return {
      type: "navigate",
      url: best.url,
      description: describeApplyTarget(best.url, best.text),
    };
  }

  return {
    type: "click",
    element: best.element,
    description: best.text || "Apply",
  };
}

export function findZipRecruiterApplyAction(): ApplyAction | null {
  const selectors = [
    "a[data-testid*='apply' i]",
    "button[data-testid='apply-button']",
    "button[data-testid*='apply']",
    "[data-testid*='quick-apply' i]",
    "[data-testid*='company' i]",
    "[data-qa*='apply' i]",
    "[data-qa*='company' i]",
    "[class*='apply_button']",
    "[class*='applyButton']",
    "[class*='quickApply']",
    "[class*='quick-apply']",
    "[class*='company']",
    "button[name='apply']",
    "button[data-testid='one-click-apply']",
    "[class*='one-click']",
    "[aria-label*='apply' i]",
    "[aria-label*='company site' i]",
    "[title*='apply' i]",
    "a[href*='/apply/']",
    "a[href*='zipapply']",
    "a[href*='jobapply']",
    "a[href*='candidate']",
  ];

  let best:
    | {
        element: HTMLElement;
        score: number;
        text: string;
        url: string | null;
      }
    | undefined;

  for (const element of collectDeepMatchesFromSelectors(selectors)) {
    const actionElement = getClickableApplyElement(element);
    if (!isElementVisible(actionElement)) {
      continue;
    }

    const text = (getActionText(actionElement) || getActionText(element)).trim();
    const lower = text.toLowerCase();
    if (
      !lower ||
      lower.includes("save") ||
      lower.includes("share") ||
      lower.includes("alert") ||
      lower.includes("sign in") ||
      lower.includes("job alert")
    ) {
      continue;
    }

    const url = getNavigationUrl(actionElement) ?? getNavigationUrl(element);
    const attrs = [
      actionElement.getAttribute("data-testid"),
      actionElement.getAttribute("data-qa"),
      actionElement.getAttribute("aria-label"),
      actionElement.getAttribute("title"),
      actionElement.className,
      actionElement.id,
      element.getAttribute("data-testid"),
      element.getAttribute("data-qa"),
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.className,
      element.id,
    ]
      .join(" ")
      .toLowerCase();

    let score = 0;
    if (lower === "apply now" || lower === "apply") score += 95;
    if (lower.includes("1-click apply") || lower.includes("1 click apply")) score += 92;
    if (lower.includes("quick apply") || lower.includes("easy apply")) score += 90;
    if (lower.includes("apply on company") || lower.includes("apply on employer")) score += 88;
    if (lower.includes("continue to company") || lower.includes("company site")) score += 86;
    if (lower.includes("apply")) score += 70;
    if (lower.includes("continue")) score += 40;
    if (attrs.includes("apply")) score += 25;
    if (attrs.includes("quick")) score += 15;
    if (attrs.includes("company")) score += 15;
    if (url && shouldPreferApplyNavigation(url, text, "ziprecruiter")) score += 35;
    if (url && /zipapply|jobapply|\/apply\/|candidate/i.test(url)) score += 35;

    if (score < 45) {
      continue;
    }

    if (!best || score > best.score) {
      best = { element: actionElement, score, text, url };
    }
  }

  if (!best) {
    for (const element of collectDeepMatchesFromSelectors([
      "a[href]",
      "button",
      "[role='button']",
    ])) {
      const actionElement = getClickableApplyElement(element);
      if (!isElementVisible(actionElement)) {
        continue;
      }

      const text = (getActionText(actionElement) || getActionText(element)).trim();
      const lower = text.toLowerCase();
      if (
        !lower ||
        ["save", "share", "alert", "sign in", "job alert", "subscribe"].some((token) =>
          lower.includes(token)
        )
      ) {
        continue;
      }

      const url = getNavigationUrl(actionElement) ?? getNavigationUrl(element);
      let score = 0;
      if (/apply|company|employer|continue|resume/.test(lower)) score += 55;
      if (/\bapply\b/.test(lower)) score += 20;
      if (url && shouldPreferApplyNavigation(url, text, "ziprecruiter")) score += 35;
      if (url && /zipapply|jobapply|\/apply\/|candidate/i.test(url)) score += 30;

      if (score < 55) {
        continue;
      }

      if (!best || score > best.score) {
        best = { element: actionElement, score, text, url };
      }
    }
  }

  if (!best) {
    return null;
  }

  if (best.url && shouldPreferApplyNavigation(best.url, best.text, "ziprecruiter")) {
    return {
      type: "navigate",
      url: best.url,
      description: describeApplyTarget(best.url, best.text || "ZipRecruiter apply"),
    };
  }

  return {
    type: "click",
    element: best.element,
    description: best.text || "ZipRecruiter apply",
  };
}

export function findDiceApplyAction(): ApplyAction | null {
  const applyComponents = Array.from(
    document.querySelectorAll<HTMLElement>(
      "apply-button-wc, [data-cy='apply-button'], [data-cy*='apply'], [class*='apply-button'], [class*='ApplyButton']"
    )
  );

  for (const component of applyComponents) {
    const root = component.shadowRoot ?? component;

    const button = root.querySelector<HTMLElement>(
      "a[href], button, input[type='submit'], [role='button']"
    );

    if (button && isElementVisible(button)) {
      const url = getNavigationUrl(button);
      if (url) {
        return {
          type: "navigate",
          url,
          description: cleanText(getActionText(button)) || "Dice apply button",
        };
      }

      return {
        type: "click",
        element: button,
        description: cleanText(getActionText(button)) || "Dice apply button",
      };
    }

    if (isElementVisible(component)) {
      const url = getNavigationUrl(component);
      if (url) {
        return {
          type: "navigate",
          url,
          description: cleanText(getActionText(component)) || "Dice apply button",
        };
      }

      return {
        type: "click",
        element: component,
        description: cleanText(getActionText(component)) || "Dice apply button",
      };
    }
  }

  const allHosts = Array.from(document.querySelectorAll<HTMLElement>("*")).filter(
    (element) => element.shadowRoot
  );

  for (const host of allHosts) {
    if (!host.shadowRoot) {
      continue;
    }

    const applyButton = host.shadowRoot.querySelector<HTMLElement>(
      "a[href*='apply'], button[class*='apply'], [data-cy*='apply'], [aria-label*='apply' i]"
    );

    if (applyButton && isElementVisible(applyButton)) {
      const text = cleanText(getActionText(applyButton)).toLowerCase();
      if (
        text.includes("save") ||
        text.includes("share") ||
        text.includes("alert")
      ) {
        continue;
      }

      const url = getNavigationUrl(applyButton);
      if (url) {
        return {
          type: "navigate",
          url,
          description: text || "Dice apply button",
        };
      }

      return {
        type: "click",
        element: applyButton,
        description: text || "Dice apply button",
      };
    }
  }

  return null;
}

export function hasIndeedApplyIframe(): boolean {
  return Boolean(
    document.querySelector(
      "iframe[src*='smartapply.indeed.com']," +
        "iframe[src*='indeedapply']," +
        "iframe[id*='indeedapply']," +
        "iframe[title*='apply']," +
        "[class*='ia-IndeedApplyWidget']," +
        "[id*='indeedApplyWidget']"
    )
  );
}

export function hasZipRecruiterApplyModal(): boolean {
  const modals = collectDeepMatches<HTMLElement>(
    "[role='dialog'], [aria-modal='true'], [class*='modal'], [class*='overlay'], [class*='popup'], [data-testid*='modal'], [data-testid*='apply']"
  );

  for (const modal of Array.from(modals)) {
    if (!isElementVisible(modal)) {
      continue;
    }

    const text = (modal.innerText || "").toLowerCase().slice(0, 2000);
    if (
      (
        text.includes("apply") ||
        text.includes("resume") ||
        text.includes("upload") ||
        text.includes("experience") ||
        text.includes("work authorization")
      ) &&
      modal.querySelector("input, textarea, select, button")
    ) {
      return true;
    }
  }

  return false;
}

export function findProgressionAction(
  site?: SiteKey | null
): ProgressionAction | null {
  const candidates = collectProgressionCandidates(site);

  let best:
    | {
        element: HTMLElement;
        score: number;
        url: string | null;
        text: string;
      }
    | undefined;

  for (const element of candidates) {
    if (
      !isElementVisible(element) ||
      element.hasAttribute("disabled") ||
      (element as HTMLButtonElement).disabled
    ) {
      continue;
    }

    const text = getActionText(element).trim();
    const lower = text.toLowerCase();
    if (!lower || lower.length > 60) {
      continue;
    }

    if (
      /submit\s*(my\s*)?application/i.test(lower) ||
      /send\s*application/i.test(lower) ||
      /confirm\s*and\s*submit/i.test(lower) ||
      lower === "submit"
    ) {
      continue;
    }

    if (
      [
        "back",
        "cancel",
        "close",
        "save for later",
        "share",
        "sign in",
        "sign up",
        "log in",
        "register",
        "dismiss",
        "delete",
        "remove",
        "previous",
      ].some((word) => lower.includes(word))
    ) {
      continue;
    }

    let score = 0;

    if (/^next$/i.test(lower)) {
      score = 100;
    } else if (/^continue$/i.test(lower)) {
      score = 95;
    } else if (lower === "next step" || lower === "next page") {
      score = 90;
    } else if (lower.includes("save and continue") || lower.includes("save & continue")) {
      score = 88;
    } else if (lower.includes("save and next") || lower.includes("save & next")) {
      score = 85;
    } else if (
      lower.includes("continue to company site") ||
      lower.includes("continue to company website") ||
      lower.includes("continue to employer site")
    ) {
      score = 84;
    } else if (lower.includes("continue to")) {
      score = 82;
    } else if (
      lower.includes("visit company site") ||
      lower.includes("visit company website")
    ) {
      score = 80;
    } else if (lower.includes("proceed")) {
      score = 78;
    } else if (
      lower.includes("review application") ||
      lower.includes("review my application")
    ) {
      score = 75;
    } else if (
      lower === "review" ||
      lower === "review and continue"
    ) {
      score = 74;
    } else if (
      lower.includes("continue application") ||
      lower.includes("continue applying")
    ) {
      score = 73;
    } else if (lower.includes("next") && !lower.includes("submit")) {
      score = 70;
    } else if (lower.includes("continue") && !lower.includes("submit")) {
      score = 65;
    }

    const attrs = [
      element.getAttribute("data-testid"),
      element.getAttribute("data-cy"),
      element.id,
      element.className,
    ]
      .join(" ")
      .toLowerCase();

    if (
      attrs.includes("next") ||
      attrs.includes("continue") ||
      attrs.includes("proceed") ||
      attrs.includes("company") ||
      attrs.includes("review")
    ) {
      score += 15;
    }

    if (element.closest("form")) {
      score += 10;
    }

    if (
      element instanceof HTMLButtonElement &&
      element.type.toLowerCase() === "submit"
    ) {
      score += 8;
    }

    if (site === "indeed") {
      if (
        attrs.includes("indeed") ||
        attrs.includes("ia-") ||
        attrs.includes("smartapply")
      ) {
        score += 8;
      }
    }

    if (site === "ziprecruiter") {
      if (
        attrs.includes("zip") ||
        attrs.includes("zipapply") ||
        attrs.includes("jobapply")
      ) {
        score += 8;
      }
    }

    if (score < 50) {
      continue;
    }

    if (!best || score > best.score) {
      best = {
        element,
        score,
        url: getMeaningfulProgressionUrl(element),
        text,
      };
    }
  }

  if (!best) {
    return null;
  }

  return best.url
    ? {
        type: "navigate",
        url: best.url,
        description: best.text,
        text: best.text,
      }
    : {
        type: "click",
        element: best.element,
        description: best.text,
        text: best.text,
      };
}

function collectProgressionCandidates(
  site?: SiteKey | null
): HTMLElement[] {
  const selectors = getProgressionCandidateSelectors(site);
  return collectDeepMatchesFromSelectors(selectors);
}

function getProgressionCandidateSelectors(
  site?: SiteKey | null
): string[] {
  const generic = [
    "button",
    "input[type='submit']",
    "input[type='button']",
    "a[href]",
    "a[role='button']",
    "[role='button']",
  ];

  switch (site) {
    case "indeed":
      return [
        "button[data-testid*='continue']",
        "button[data-testid*='next']",
        "button[data-testid*='review']",
        "[aria-label*='continue' i]",
        "[aria-label*='next' i]",
        "[aria-label*='review' i]",
        "[id*='continue']",
        "[id*='next']",
        "[id*='review']",
        "[class*='continue']",
        "[class*='next']",
        "[class*='review']",
        ...generic,
      ];
    case "ziprecruiter":
      return [
        "button[data-testid*='continue']",
        "button[data-testid*='next']",
        "button[data-testid*='review']",
        "[data-testid*='continue']",
        "[data-testid*='next']",
        "[data-testid*='review']",
        "[aria-label*='continue' i]",
        "[aria-label*='next' i]",
        "[aria-label*='review' i]",
        "[id*='continue']",
        "[id*='next']",
        "[class*='continue']",
        "[class*='next']",
        "[class*='review']",
        ...generic,
      ];
    default:
      return generic;
  }
}

function getMeaningfulProgressionUrl(
  element: HTMLElement
): string | null {
  const url = getNavigationUrl(element);
  if (!url) {
    return null;
  }

  const currentUrl = normalizeUrl(window.location.href);
  if (currentUrl && url === currentUrl) {
    return null;
  }

  return url;
}

export function findApplyAction(
  site: SiteKey | null,
  context: "job-page" | "follow-up"
): ApplyAction | null {
  const selectors = getApplyCandidateSelectors(site);
  const elements = collectDeepMatchesFromSelectors(selectors);

  let best:
    | {
        element: HTMLElement;
        score: number;
        url: string | null;
        text: string;
      }
    | undefined;

  for (const element of elements) {
    const actionElement = getClickableApplyElement(element);
    const text = getActionText(actionElement) || getActionText(element);
    const url = getNavigationUrl(actionElement) ?? getNavigationUrl(element);
    const score = scoreApplyElement(text, url, actionElement, context);

    if (score < 30) {
      continue;
    }

    if (!best || score > best.score) {
      best = { element: actionElement, score, url, text };
    }
  }

  if (!best) {
    return null;
  }

  if (best.url && shouldPreferApplyNavigation(best.url, best.text, site)) {
    return {
      type: "navigate",
      url: best.url,
      description: describeApplyTarget(best.url, best.text),
    };
  }

  return {
    type: "click",
    element: best.element,
    description: best.text || "the apply button",
  };
}

export function isLikelyApplyUrl(url: string, site: SiteKey): boolean {
  if (isKnownBrokenApplyUrl(url)) {
    return false;
  }

  const lower = url.toLowerCase();
  let parsed: URL | null = null;

  try {
    parsed = new URL(url, window.location.href);
  } catch {
    parsed = null;
  }

  const hostname = parsed?.hostname.toLowerCase() ?? "";
  const pathAndQuery = `${parsed?.pathname.toLowerCase() ?? ""}${parsed?.search.toLowerCase() ?? ""}`;

  if (
    hostname.includes("greenhouse.io") &&
    (
      pathAndQuery.includes("/embed/job_app") ||
      pathAndQuery.includes("/jobs/") ||
      pathAndQuery.includes("gh_jid=")
    )
  ) {
    return true;
  }

  if (
    lower.includes("smartapply.indeed.com") ||
    lower.includes("indeedapply") ||
    lower.includes("zipapply") ||
    lower.includes("/apply") ||
    lower.includes("application") ||
    lower.includes("candidate") ||
    lower.includes("jobapply") ||
    lower.includes("job_app") ||
    lower.includes("applytojob") ||
    lower.includes("candidateexperience")
  ) {
    return true;
  }

  if (site === "startup" || site === "other_sites") {
    return [
      "/apply",
      "application",
      "candidate",
      "job_app",
      "applytojob",
      "candidateexperience",
      "myworkdayjobs.com",
      "workdayjobs.com",
      "icims.com/jobs/candidate",
      "smartrecruiters.com",
      "/embed/job_app",
    ].some((token) => lower.includes(token));
  }

  try {
    return !new URL(url).hostname.toLowerCase().endsWith(getSiteRoot(site));
  } catch {
    return false;
  }
}

export function isAlreadyOnApplyPage(site: SiteKey, url: string): boolean {
  return isLikelyApplyUrl(url, site);
}

function extractLikelyApplyUrl(element: HTMLElement): string | null {
  for (const attribute of Array.from(element.attributes)) {
    const value = attribute.value?.trim();
    if (!value) {
      continue;
    }

    if (/^https?:\/\//i.test(value) || value.startsWith("/")) {
      const normalized = normalizeUrl(value);
      if (
        normalized &&
        !isKnownBrokenApplyUrl(normalized) &&
        /apply|application|candidate|jobapply|company|career/i.test(normalized)
      ) {
        return normalized;
      }
    }
  }

  return null;
}

function findExternalApplyUrlInDocument(): string | null {
  const sources = [
    ...Array.from(document.querySelectorAll<HTMLScriptElement>("script:not([src])")).map(
      (script) => script.textContent || ""
    ),
    document.documentElement?.innerHTML || "",
  ];

  let best:
    | {
        url: string;
        score: number;
      }
    | undefined;

  for (const source of sources) {
    const urls = source.match(/https?:\/\/[^"'\\<>\s]+/gi) || [];
    for (const rawUrl of urls) {
      const url = normalizeUrl(rawUrl);
      if (!url || isKnownBrokenApplyUrl(url) || !isExternalUrl(url)) {
        continue;
      }

      const score = scoreExternalApplyUrl(url);
      if (score <= 0) {
        continue;
      }

      if (!best || score > best.score) {
        best = { url, score };
      }
    }
  }

  return best?.url ?? null;
}

function scoreExternalApplyUrl(url: string): number {
  const lower = url.toLowerCase();

  if (
    /\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|woff2?|ttf|eot)(?:[?#].*)?$/.test(lower)
  ) {
    return -1;
  }

  if (
    [
      "facebook.com",
      "linkedin.com",
      "twitter.com",
      "instagram.com",
      "youtube.com",
      "tiktok.com",
      "doubleclick.net",
      "googletagmanager.com",
      "google-analytics.com",
      "privacy",
      "terms",
      "cookie",
      "help",
      "support",
    ].some((token) => lower.includes(token))
  ) {
    return -1;
  }

  let score = 0;

  if (
    [
      "workdayjobs.com",
      "myworkdayjobs.com",
      "greenhouse.io",
      "boards.greenhouse.io",
      "job-boards.greenhouse.io",
      "lever.co",
      "ashbyhq.com",
      "workable.com",
      "jobvite.com",
      "jobs.jobvite.com",
      "icims.com",
      "smartrecruiters.com",
      "applytojob.com",
      "recruitee.com",
      "breezy.hr",
      "bamboohr.com",
    ].some((token) => lower.includes(token))
  ) {
    score += 120;
  }

  if (
    [
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
    ].some((token) => lower.includes(token))
  ) {
    score += 55;
  }

  if (lower.includes("indeed.com")) {
    score = -1;
  }

  return score;
}

function scoreApplyElement(
  text: string,
  url: string | null,
  element: HTMLElement,
  context: "job-page" | "follow-up"
): number {
  if (isKnownBrokenApplyUrl(url)) {
    return -1;
  }

  if (!isElementVisible(element) || (element as HTMLButtonElement).disabled) {
    return -1;
  }

  const lower = text.toLowerCase().trim();
  const lowerUrl = url?.toLowerCase() ?? "";
  const attrs = [
    element.getAttribute("data-testid"),
    element.getAttribute("data-cy"),
    element.getAttribute("data-qa"),
    element.getAttribute("data-track"),
    element.getAttribute("aria-label"),
    element.getAttribute("title"),
    element.id,
    element.className,
    element.tagName,
  ]
    .join(" ")
    .toLowerCase();

  if (
    /submit\s*(my\s*)?application/i.test(lower) ||
    /send\s*application/i.test(lower) ||
    /confirm\s*and\s*submit/i.test(lower)
  ) {
    return -1;
  }

  const blocked = [
    "save for later",
    "share this",
    "sign in",
    "sign up",
    "register",
    "report",
    "email this",
    "copy link",
    "compare",
    "job alert",
    "subscribe",
    "learn more",
    "dismiss",
    "close",
  ];
  if (blocked.some((value) => lower.includes(value))) {
    return -1;
  }

  let score = 0;

  if (lowerUrl.includes("smartapply.indeed.com")) score += 100;
  if (lowerUrl.includes("indeedapply")) score += 95;
  if (lowerUrl.includes("zipapply")) score += 90;

  if (lower === "apply now") score += 92;
  if (lower === "apply") score += 86;
  if (lower === "easy apply") score += 85;
  if (lower === "indeed apply") score += 85;
  if (lower === "quick apply") score += 80;
  if (lower === "1-click apply") score += 80;

  if (lower.includes("apply on company")) score += 92;
  if (lower.includes("apply on employer")) score += 90;
  if (lower.includes("apply externally")) score += 88;
  if (lower.includes("continue to company")) score += 86;
  if (lower.includes("company website to apply")) score += 86;
  if (lower.includes("apply directly")) score += 86;
  if (lower.includes("apply on the company")) score += 85;
  if (lower.includes("apply on external")) score += 84;
  if (lower.includes("apply through")) score += 82;

  if (lower.includes("apply now")) score += 80;
  if (lower.includes("start application")) score += 72;
  if (lower.includes("begin application")) score += 72;
  if (lower.includes("continue to application")) score += 68;
  if (lower.includes("continue application")) score += 65;
  if (lower.includes("apply for this")) score += 75;
  if (lower.includes("apply to this")) score += 75;

  if (score === 0 && lower.includes("apply")) score += 50;

  if (context === "follow-up") {
    if (lower.includes("continue") && !lower.includes("submit")) score += 40;
    if (lower.includes("next") && !lower.includes("submit")) score += 35;
    if (lower.includes("proceed")) score += 35;
  }

  if (score === 0 && lowerUrl.includes("/apply")) score += 60;
  if (score === 0 && lowerUrl.includes("application")) score += 50;
  if (
    score === 0 &&
    [
      "job_app",
      "applytojob",
      "candidateexperience",
      "myworkdayjobs.com",
      "workdayjobs.com",
      "icims.com/jobs/candidate",
      "smartrecruiters.com",
      "greenhouse.io/embed/job_app",
    ].some((token) => lowerUrl.includes(token))
  ) {
    score += 55;
  }

  if (url && isExternalUrl(url)) score += 20;
  if (attrs.includes("apply")) score += 30;
  if (attrs.includes("application")) score += 20;
  if (attrs.includes("quick apply") || attrs.includes("easy apply")) score += 20;
  if (attrs.includes("apply-button-wc")) score += 30;
  if (attrs.includes("svx_applybutton") || attrs.includes("applybutton")) score += 35;
  if (attrs.includes("company") || attrs.includes("external")) score += 20;

  return score;
}

function getApplyCandidateSelectors(site: SiteKey | null): string[] {
  const generic = [
    "a[href*='apply']",
    "a[href*='application']",
    "a[href]",
    "a[role='button']",
    "button",
    "input[type='submit']",
    "input[type='button']",
    "[aria-label*='apply' i]",
    "[title*='apply' i]",
    "[data-testid*='apply']",
    "[data-automation*='apply']",
    "[class*='apply']",
    "[id*='apply']",
    "form button",
    "form a[href]",
  ];

  switch (site) {
    case "indeed":
      return [
        "a[href*='smartapply.indeed.com']",
        "a[href*='indeedapply']",
        "[data-tn-element*='company']",
        "[data-testid*='company']",
        "[data-testid*='apply']",
        "[id*='apply']",
        "button[id*='apply']",
        "a[href*='clk']",
        "#applyButtonLinkContainer a",
        "[class*='jobsearch-IndeedApplyButton']",
        "[class*='ia-IndeedApplyButton']",
        ...generic,
      ];

    case "ziprecruiter":
      return [
        "a[href*='zipapply']",
        "a[href*='jobapply']",
        "a[href*='candidate']",
        "[data-testid*='apply']",
        "[data-qa*='apply']",
        "[data-testid*='company']",
        "[class*='apply']",
        "[class*='quickApply']",
        "[class*='quick-apply']",
        "button[data-testid='apply-button']",
        "button[data-testid='one-click-apply']",
        "[class*='apply_button']",
        "[class*='applyButton']",
        "a[href*='/apply/']",
        ...generic,
      ];

    case "dice":
      return ["[data-cy*='apply']", "[class*='apply']", "apply-button-wc", ...generic];

    case "monster":
      return [
        "apply-button-wc",
        "monster-apply-button",
        "[data-testid*='apply' i]",
        "[data-testid='svx_applyButton']",
        "[data-track*='apply' i]",
        "[data-evt*='apply' i]",
        "[data-action*='apply' i]",
        "[data-link*='apply' i]",
        "[data-url*='apply' i]",
        "[aria-label*='apply' i]",
        "[aria-label*='company site' i]",
        "[class*='apply']",
        "button[class*='Apply']",
        "a[class*='Apply']",
        "[class*='applyBtn']",
        "[class*='apply-btn']",
        "[class*='ApplyButton']",
        "[class*='apply-button']",
        "[id*='applyBtn']",
        "[id*='apply-btn']",
        "[data-testid*='Apply']",
        "a[href*='/apply']",
        "a[href*='apply.monster']",
        "a[href*='job-openings'][href*='apply']",
        ...generic,
      ];

    case "startup":
    case "other_sites":
      return [
        "#apply_button",
        ".application-link",
        "button[data-qa='btn-apply']",
        "button[data-qa*='apply']",
        "a[data-qa*='apply']",
        "button[data-testid*='apply']",
        "a[data-testid*='apply']",
        "button[data-ui='apply-button']",
        "a[data-ui='apply-button']",
        "a[href*='/apply/']",
        "a[href*='job_app']",
        "a[href*='candidate']",
        "a[href*='applytojob']",
        "a[href*='workdayjobs.com']",
        "a[href*='myworkdayjobs.com']",
        "a[href*='smartrecruiters.com']",
        "a[href*='icims.com/jobs/candidate']",
        "a[href*='workable.com']",
        "a[href*='greenhouse.io/embed/job_app']",
        "a[href*='job-boards.greenhouse.io/embed/job_app']",
        "a[href*='boards.greenhouse.io/embed/job_app']",
        "[class*='application']",
        "[id*='application']",
        "[class*='apply']",
        ...generic,
      ];

    default:
      return generic;
  }
}

function describeApplyTarget(url: string, text: string): string {
  if (url.toLowerCase().includes("smartapply.indeed.com")) {
    return "the Indeed apply page";
  }

  if (isExternalUrl(url) || text.toLowerCase().includes("company site")) {
    return "the company career page";
  }

  return text || "the apply page";
}

export function shouldPreferApplyNavigation(
  url: string,
  text: string,
  site: SiteKey | null
): boolean {
  if (isKnownBrokenApplyUrl(url)) {
    return false;
  }

  const lowerText = text.toLowerCase();
  if (
    lowerText.includes("company site") ||
    lowerText.includes("employer site") ||
    lowerText.includes("apply externally") ||
    lowerText.includes("apply directly") ||
    lowerText.includes("apply on external") ||
    lowerText.includes("apply through")
  ) {
    return true;
  }

  if (isExternalUrl(url)) {
    return true;
  }

  if (!site) {
    return /apply|application|candidate|jobapply|zipapply|indeedapply/i.test(url);
  }

  return isLikelyApplyUrl(url, site);
}

function getSiteRoot(site: SiteKey): string {
  switch (site) {
    case "indeed":
      return "indeed.com";
    case "ziprecruiter":
      return "ziprecruiter.com";
    case "dice":
      return "dice.com";
    case "monster":
      return "monster.com";
    case "startup":
    case "other_sites":
      return window.location.hostname.toLowerCase();
    case "chatgpt":
      return "chatgpt.com";
  }
}
