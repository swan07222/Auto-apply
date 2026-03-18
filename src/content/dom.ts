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
  const shadowTarget = el.shadowRoot?.querySelector<HTMLElement>(
    "a[href], button, input[type='submit'], input[type='button'], [role='button']"
  );
  const childTarget = el.querySelector<HTMLElement>(
    "a[href], button, input[type='submit'], input[type='button'], [role='button']"
  );

  return shadowTarget ?? childTarget ?? el;
}

export function getNavigationUrl(el: HTMLElement): string | null {
  if (el instanceof HTMLAnchorElement && el.href) {
    return normalizeUrl(el.href);
  }

  const parentAnchor = el.closest("a");
  if (parentAnchor?.href) {
    return normalizeUrl(parentAnchor.href);
  }

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

  const dataUrl =
    el.getAttribute("data-href") ??
    el.getAttribute("data-url") ??
    el.getAttribute("data-apply-url") ??
    el.getAttribute("data-apply-href") ??
    el.getAttribute("data-link") ??
    el.getAttribute("data-link-to") ??
    el.getAttribute("data-target-url") ??
    el.getAttribute("data-job-url") ??
    el.getAttribute("data-destination");

  if (dataUrl) {
    return normalizeUrl(dataUrl);
  }

  const onclick = el.getAttribute("onclick");
  if (onclick) {
    const match =
      onclick.match(
        /(?:window\.open|window\.location(?:\.href)?|document\.location(?:\.href)?)\s*\(?\s*['"]([^'"]+)['"]/i
      ) ??
      onclick.match(/location(?:\.href)?\s*=\s*['"]([^'"]+)['"]/i);

    if (match?.[1]) {
      return normalizeUrl(match[1]);
    }
  }

  return null;
}

export function normalizeUrl(url: string): string | null {
  if (!url || url.startsWith("javascript:") || url === "#") {
    return null;
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
    return (
      new URL(url).hostname.toLowerCase() !== window.location.hostname.toLowerCase()
    );
  } catch {
    return false;
  }
}

export function isElementVisible(el: HTMLElement): boolean {
  const styles = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();

  return (
    styles.visibility !== "hidden" &&
    styles.display !== "none" &&
    rect.width > 0 &&
    rect.height > 0
  );
}

export function findFirstVisibleElement<T extends HTMLElement>(
  selectors: string[]
): T | null {
  for (const selector of selectors) {
    for (const element of Array.from(document.querySelectorAll<T>(selector))) {
      if (isElementVisible(element)) {
        return element;
      }
    }
  }

  return null;
}

export function performClickAction(element: HTMLElement): void {
  element.click();
}
