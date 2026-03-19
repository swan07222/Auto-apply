// src/content/dom.ts
// COMPLETE FILE — replace entirely

export function getActionText(el: HTMLElement): string {
  return (
    [
      el.textContent,
      el.shadowRoot?.textContent,
      el.getAttribute("aria-label"),
      el.getAttribute("title"),
      el.getAttribute("value"),
    ].find((value) => value && value.trim().length > 0)?.trim() ?? ""
  );
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
    return normalizeUrl(el.href);
  }

  // Parent anchor
  const parentAnchor = el.closest("a");
  if (parentAnchor?.href) {
    return normalizeUrl(parentAnchor.href);
  }

  // Form action on button/input
  if (
    el instanceof HTMLButtonElement &&
    el.formAction &&
    el.formAction !== window.location.href
  ) {
    return normalizeUrl(el.formAction);
  }

  if (
    el instanceof HTMLInputElement &&
    el.formAction &&
    el.formAction !== window.location.href
  ) {
    return normalizeUrl(el.formAction);
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
        return normalized;
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
      return normalized;
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
      return normalizeUrl(match[1]);
    }
  }

  // FIX: Check for URL in inner anchor if element wraps one
  const innerAnchor = el.querySelector<HTMLAnchorElement>("a[href]");
  if (innerAnchor?.href) {
    return normalizeUrl(innerAnchor.href);
  }

  return null;
}

export function normalizeUrl(url: string): string | null {
  if (!url || url.startsWith("javascript:") || url === "#") {
    return null;
  }

  // FIX: Handle protocol-relative URLs
  if (url.startsWith("//")) {
    url = window.location.protocol + url;
  }

  try {
    const normalized = new URL(url, window.location.href);
    normalized.hash = "";
    return normalized.toString();
  } catch {
    return null;
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

export function findFirstVisibleElement<T extends HTMLElement>(
  selectors: string[]
): T | null {
  for (const selector of selectors) {
    try {
      for (const element of Array.from(document.querySelectorAll<T>(selector))) {
        if (isElementVisible(element)) {
          return element;
        }
      }
    } catch {
      // FIX: Skip invalid selectors
      continue;
    }
  }

  return null;
}

export function performClickAction(element: HTMLElement): void {
  // FIX: Ensure element is focused first
  try {
    element.focus();
  } catch {
    // Some elements cannot be focused
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
}

// FIX: Add helper to scroll element into view
export function scrollElementIntoView(element: HTMLElement): void {
  try {
    element.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "nearest",
    });
  } catch {
    // Fallback to basic scroll
    try {
      element.scrollIntoView(true);
    } catch {
      // Ignore scroll errors
    }
  }
}

// FIX: Add helper to wait for element to appear
export async function waitForElement<T extends HTMLElement>(
  selector: string,
  timeoutMs: number = 5000
): Promise<T | null> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const element = document.querySelector<T>(selector);
      if (element && isElementVisible(element)) {
        return element;
      }
    } catch {
      // Invalid selector
      return null;
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return null;
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
