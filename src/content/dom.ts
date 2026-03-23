// src/content/dom.ts
// COMPLETE FILE — replace entirely

import { cleanText } from "./text";

export function getActionText(el: HTMLElement): string {
  return cleanText(
    [
      el.innerText,
      el.textContent,
      el.shadowRoot?.textContent,
      el.getAttribute("aria-label"),
      el.getAttribute("title"),
      el.getAttribute("value"),
    ].find((value) => value && value.trim().length > 0)?.trim() ?? ""
  );
}

export function collectDeepMatches<T extends Element>(
  selector: string
): T[] {
  const results: T[] = [];
  const seen = new Set<Element>();
  const roots: Array<Document | ShadowRoot> = [document];

  while (roots.length > 0) {
    const root = roots.shift();
    if (!root) {
      continue;
    }

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

export function getClickableApplyElement(el: HTMLElement): HTMLElement {
  // FIX: Check shadow DOM first
  if (el.shadowRoot) {
    const shadowTarget = el.shadowRoot.querySelector<HTMLElement>(
      "a[href], button, input[type='submit'], input[type='button'], [role='button']"
    );
    if (shadowTarget && isElementVisible(shadowTarget)) {
      return shadowTarget;
    }
  }

  // FIX: Check for nested clickable elements
  const childTarget = el.querySelector<HTMLElement>(
    "a[href], button, input[type='submit'], input[type='button'], [role='button']"
  );

  if (childTarget && isElementVisible(childTarget)) {
    return childTarget;
  }

  return el;
}

export function getNavigationUrl(el: HTMLElement): string | null {
  // Direct href on anchor
  if (el instanceof HTMLAnchorElement && el.href) {
    return unwrapRedirectNavigationUrl(normalizeUrl(el.href));
  }

  // Parent anchor
  const parentAnchor = el.closest("a");
  if (parentAnchor?.href) {
    return unwrapRedirectNavigationUrl(normalizeUrl(parentAnchor.href));
  }

  // Form action on button/input
  if (
    el instanceof HTMLButtonElement &&
    el.formAction &&
    el.formAction !== window.location.href
  ) {
    return unwrapRedirectNavigationUrl(normalizeUrl(el.formAction));
  }

  if (
    el instanceof HTMLInputElement &&
    el.formAction &&
    el.formAction !== window.location.href
  ) {
    return unwrapRedirectNavigationUrl(normalizeUrl(el.formAction));
  }

  // Data attributes commonly used for URLs
  const dataUrlAttributes = [
    "data-href",
    "data-url",
    "data-to",
    "data-apply-url",
    "data-apply-href",
    "data-link",
    "data-link-to",
    "data-target-url",
    "data-job-url",
    "data-destination",
    "data-redirect",
    "data-action-url",
    "data-navigate",
    "data-external-url",
    "data-company-url",
  ];

  for (const attr of dataUrlAttributes) {
    const value = el.getAttribute(attr);
    if (value) {
      const normalized = normalizeUrl(value);
      if (normalized) {
        return unwrapRedirectNavigationUrl(normalized);
      }
    }
  }

  // FIX: Check all attributes for URL-like values
  for (const attribute of Array.from(el.attributes)) {
    const name = attribute.name.toLowerCase();
    const value = attribute.value?.trim();
    if (!value) {
      continue;
    }

    // Skip common non-URL attributes
    if (
      [
        "class",
        "id",
        "style",
        "type",
        "name",
        "value",
        "placeholder",
        "aria-label",
        "aria-labelledby",
        "aria-describedby",
        "role",
        "tabindex",
        "disabled",
        "readonly",
      ].includes(name)
    ) {
      continue;
    }

    if (!/(href|url|link|target|dest|redirect|navigate|action|(^|-)to$)/i.test(name)) {
      continue;
    }

    const normalized = normalizeUrl(value);
    if (normalized) {
      return unwrapRedirectNavigationUrl(normalized);
    }
  }

  // Check onclick handler for navigation
  const onclick = el.getAttribute("onclick");
  if (onclick) {
    const match =
      onclick.match(
        /(?:window\.open|window\.location(?:\.href)?|document\.location(?:\.href)?)\s*\(?\s*['"]([^'"]+)['"]/i
      ) ??
      onclick.match(/location(?:\.href)?\s*=\s*['"]([^'"]+)['"]/i) ??
      onclick.match(/navigate\s*\(\s*['"]([^'"]+)['"]/i);

    if (match?.[1]) {
      return unwrapRedirectNavigationUrl(normalizeUrl(match[1]));
    }
  }

  // FIX: Check for URL in inner anchor if element wraps one
  const innerAnchor = el.querySelector<HTMLAnchorElement>("a[href]");
  if (innerAnchor?.href) {
    return unwrapRedirectNavigationUrl(normalizeUrl(innerAnchor.href));
  }

  return null;
}

export function normalizeUrl(url: string): string | null {
  const trimmedUrl = url.trim();

  if (
    !trimmedUrl ||
    trimmedUrl.startsWith("javascript:") ||
    trimmedUrl.startsWith("#") ||
    /^_(?:blank|self|parent|top)$/i.test(trimmedUrl)
  ) {
    return null;
  }

  // FIX: Handle protocol-relative URLs
  if (trimmedUrl.startsWith("//")) {
    url = window.location.protocol + trimmedUrl;
  } else {
    url = trimmedUrl;
  }

  try {
    const normalized = new URL(url, window.location.href);
    normalized.hash = "";
    return normalized.toString();
  } catch {
    return null;
  }
}

function unwrapRedirectNavigationUrl(url: string | null): string | null {
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(url, window.location.href);
    const redirectParamNames = [
      "url",
      "u",
      "dest",
      "destination",
      "redirect",
      "redirect_url",
      "external_url",
      "target",
      "target_url",
      "href",
      "link",
      "apply_url",
      "job_url",
    ];

    for (const name of redirectParamNames) {
      const value = parsed.searchParams.get(name);
      if (!value) {
        continue;
      }

      const normalized = normalizeUrl(value);
      if (!normalized || normalized === url) {
        continue;
      }

      return normalized;
    }

    return parsed.toString();
  } catch {
    return url;
  }
}

export function isExternalUrl(url: string): boolean {
  try {
    const urlHost = new URL(url).hostname.toLowerCase();
    const currentHost = window.location.hostname.toLowerCase();

    // FIX: Handle subdomains properly
    if (urlHost === currentHost) {
      return false;
    }

    // Check if one is a subdomain of the other
    if (urlHost.endsWith(`.${currentHost}`) || currentHost.endsWith(`.${urlHost}`)) {
      return false;
    }

    // FIX: Handle common CDN/asset domains as not external
    const assetDomains = [
      "cloudfront.net",
      "amazonaws.com",
      "cloudflare.com",
      "akamaized.net",
      "fastly.net",
    ];
    if (assetDomains.some((domain) => urlHost.endsWith(domain))) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

export function isElementVisible(el: HTMLElement): boolean {
  // FIX: More robust visibility check
  if (!el || !el.isConnected) {
    return false;
  }

  const styles = window.getComputedStyle(el);

  if (
    styles.visibility === "hidden" ||
    styles.display === "none" ||
    styles.opacity === "0"
  ) {
    return false;
  }

  const rect = el.getBoundingClientRect();

  // FIX: Allow very small elements that might be icon buttons
  if (rect.width <= 0 || rect.height <= 0) {
    return false;
  }

  // FIX: Check if element is within viewport or scrollable area
  // Some elements may be off-screen but still "visible" in DOM sense
  if (
    rect.bottom < 0 ||
    rect.right < 0 ||
    rect.top > window.innerHeight + 1000 ||
    rect.left > window.innerWidth + 1000
  ) {
    // Element is way off screen, but might still be scrollable
    // Check if any parent has overflow scroll
    let parent = el.parentElement;
    let hasScrollableParent = false;
    while (parent) {
      const parentStyles = window.getComputedStyle(parent);
      if (
        parentStyles.overflow === "scroll" ||
        parentStyles.overflow === "auto" ||
        parentStyles.overflowX === "scroll" ||
        parentStyles.overflowX === "auto" ||
        parentStyles.overflowY === "scroll" ||
        parentStyles.overflowY === "auto"
      ) {
        hasScrollableParent = true;
        break;
      }
      parent = parent.parentElement;
    }

    if (!hasScrollableParent) {
      return false;
    }
  }

  return true;
}

export function performClickAction(element: HTMLElement): void {
  const isNativeSubmitControl =
    (element instanceof HTMLButtonElement &&
      element.type.toLowerCase() === "submit") ||
    (element instanceof HTMLInputElement &&
      element.type.toLowerCase() === "submit");

  // FIX: Ensure element is focused first
  try {
    element.focus();
  } catch {
    // Some elements cannot be focused
  }

  if (isNativeSubmitControl) {
    try {
      element.click();
      return;
    } catch {
      // Fall through to the synthetic path when native click is unavailable.
    }
  }

  // FIX: Dispatch a complete sequence of pointer/mouse events
  const eventOptions = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    button: 0,
    buttons: 1,
    clientX: 0,
    clientY: 0,
  };

  // Get element center for more realistic click coordinates
  try {
    const rect = element.getBoundingClientRect();
    eventOptions.clientX = rect.left + rect.width / 2;
    eventOptions.clientY = rect.top + rect.height / 2;
  } catch {
    // Use default 0,0 coordinates
  }

  const events = [
    "pointerover",
    "pointerenter",
    "pointerdown",
    "mousedown",
    "pointerup",
    "mouseup",
    "click",
  ] as const;

  for (const eventType of events) {
    try {
      if (eventType.startsWith("pointer")) {
        element.dispatchEvent(new PointerEvent(eventType, eventOptions));
      } else {
        element.dispatchEvent(new MouseEvent(eventType, eventOptions));
      }
    } catch {
      // Ignore event-construction issues
    }
  }

  // FIX: Also try native click as fallback
  try {
    element.click();
  } catch {
    // Some elements may throw on click()
  }

  const keyboardEvents = [
    ["keydown", "Enter"],
    ["keyup", "Enter"],
    ["keydown", " "],
    ["keyup", " "],
  ] as const;

  for (const [eventType, key] of keyboardEvents) {
    try {
      element.dispatchEvent(
        new KeyboardEvent(eventType, {
          bubbles: true,
          cancelable: true,
          composed: true,
          key,
        })
      );
    } catch {
      // Ignore keyboard dispatch issues
    }
  }
}

// FIX: Add helper to check if element is interactive
export function isElementInteractive(el: HTMLElement): boolean {
  if (!isElementVisible(el)) {
    return false;
  }

  if (
    el.hasAttribute("disabled") ||
    (el as HTMLButtonElement | HTMLInputElement).disabled
  ) {
    return false;
  }

  if (el.getAttribute("aria-disabled") === "true") {
    return false;
  }

  const styles = window.getComputedStyle(el);
  if (styles.pointerEvents === "none") {
    return false;
  }

  return true;
}
