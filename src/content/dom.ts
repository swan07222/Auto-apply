// DOM helpers shared across search result collection and apply flows.

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
  let rootIndex = 0;

  while (rootIndex < roots.length) {
    const root = roots[rootIndex];
    rootIndex += 1;
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

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let current = walker.nextNode();

    while (current) {
      const element = current as HTMLElement;
      if (element.shadowRoot) {
        roots.push(element.shadowRoot);
      }
      current = walker.nextNode();
    }
  }

  return results;
}

export function collectShadowHosts(root: ParentNode): HTMLElement[] {
  const hosts: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();

  if (root instanceof HTMLElement && root.shadowRoot) {
    seen.add(root);
    hosts.push(root);
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let current = walker.nextNode();

  while (current) {
    const element = current as HTMLElement;
    if (element.shadowRoot && !seen.has(element)) {
      seen.add(element);
      hosts.push(element);
    }
    current = walker.nextNode();
  }

  return hosts;
}

export function getClickableApplyElement(el: HTMLElement): HTMLElement {
  // Many boards render the real click target inside shadow DOM.
  if (el.shadowRoot) {
    const shadowTarget = el.shadowRoot.querySelector<HTMLElement>(
      "a[href], button, input[type='submit'], input[type='button'], [role='button']"
    );
    if (shadowTarget && isElementVisible(shadowTarget)) {
      return shadowTarget;
    }
  }

  // Cards often wrap the actionable control instead of being clickable themselves.
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

  // Some sites hide navigation URLs in custom data attributes.
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

  // Wrapper elements sometimes proxy an inner anchor's destination.
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

  // Normalize protocol-relative URLs against the current page.
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

    // Treat subdomains of the same site family as internal navigation.
    if (urlHost === currentHost) {
      return false;
    }

    // Check if one is a subdomain of the other
    if (
      urlHost.endsWith(`.${currentHost}`) ||
      currentHost.endsWith(`.${urlHost}`)
    ) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

export function isElementVisible(el: HTMLElement): boolean {
  // Visibility needs to account for more than display and dimensions.
  if (!el || !el.isConnected) {
    return false;
  }

  const styles = window.getComputedStyle(el);
  const opacity = Number.parseFloat(styles.opacity);

  if (
    styles.visibility === "hidden" ||
    styles.visibility === "collapse" ||
    styles.display === "none" ||
    (Number.isFinite(opacity) && opacity <= 0.01)
  ) {
    return false;
  }

  const rect = el.getBoundingClientRect();

  // Tiny icon buttons can still be valid interactive targets.
  if (rect.width <= 0 || rect.height <= 0) {
    return false;
  }

  // Elements inside scrollable containers can be interactive off the main viewport.
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

export function shouldScrollElementIntoViewBeforeClick(
  element: HTMLElement
): boolean {
  if (!element || !element.isConnected) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  const viewportHeight =
    window.innerHeight || document.documentElement.clientHeight || 0;
  const viewportWidth =
    window.innerWidth || document.documentElement.clientWidth || 0;

  if (rect.width <= 0 || rect.height <= 0) {
    return false;
  }

  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;

  return (
    centerY < 0 ||
    centerY > viewportHeight ||
    centerX < 0 ||
    centerX > viewportWidth
  );
}

export function performClickAction(
  element: HTMLElement,
  options?: { skipFocus?: boolean }
): void {
  const isNativeSubmitControl =
    (element instanceof HTMLButtonElement &&
      element.type.toLowerCase() === "submit") ||
    (element instanceof HTMLInputElement &&
      element.type.toLowerCase() === "submit");
  const isNativeInteractiveElement =
    element instanceof HTMLButtonElement ||
    element instanceof HTMLAnchorElement ||
    (element instanceof HTMLInputElement &&
      ["button", "submit", "checkbox", "radio"].includes(
        element.type.toLowerCase()
      ));
  const shouldDispatchKeyboardFallback =
    !isNativeInteractiveElement &&
    (element.getAttribute("role") === "button" ||
      element.getAttribute("tabindex") !== null);

  // Focus first so sites that rely on active-element state respond consistently.
  if (!options?.skipFocus) {
    try {
      element.focus();
    } catch {
      // Some elements cannot be focused
    }
  }

  if (isNativeSubmitControl) {
    try {
      element.click();
      return;
    } catch {
      // Fall through to the synthetic path when native click is unavailable.
    }
  }

  // Mirror the native pointer sequence for sites with custom listeners.
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

  let clickedNatively = false;

  // Prefer a single native click once the pointer sequence has run.
  try {
    element.click();
    clickedNatively = true;
  } catch {
    // Some elements may throw on click()
  }

  if (!clickedNatively) {
    try {
      element.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window,
          button: 0,
        })
      );
    } catch {
      // Ignore click fallback issues.
    }
  }

  if (shouldDispatchKeyboardFallback) {
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
}

// Check whether an element is still interactive before clicking it.
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
