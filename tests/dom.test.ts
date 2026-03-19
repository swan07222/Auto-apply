import { describe, expect, it, vi } from "vitest";

import {
  findFirstVisibleElement,
  getClickableApplyElement,
  getNavigationUrl,
  isElementInteractive,
  isElementVisible,
  isExternalUrl,
  normalizeUrl,
  performClickAction,
} from "../src/content/dom";

describe("dom helpers", () => {
  it("prefers clickable descendants and shadow-dom targets", () => {
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    const shadowButton = document.createElement("button");
    shadowButton.textContent = "Apply";
    shadow.appendChild(shadowButton);
    document.body.appendChild(host);

    expect(getClickableApplyElement(host)).toBe(shadowButton);

    document.body.innerHTML = `
      <div id="wrapper">
        <span>Apply now</span>
        <button id="nested">Continue</button>
      </div>
    `;

    const wrapper = document.querySelector("#wrapper") as HTMLElement;
    expect(getClickableApplyElement(wrapper)).toBe(document.querySelector("#nested"));
  });

  it("extracts navigation URLs from hrefs, data attributes, onclick handlers, and form actions", () => {
    document.body.innerHTML = `
      <a id="anchor" href="/apply#step-1">Apply</a>
      <button id="data" data-apply-url="https://company.example.com/jobs/apply">Apply on company site</button>
      <button id="data-to" data-to="/candidate/apply">Continue</button>
      <button id="onclick" onclick="window.open('https://jobs.example.com/opening/123')">Open</button>
      <form action="https://company.example.com/candidate/submit">
        <button id="form-action" formaction="https://company.example.com/candidate/submit">Continue</button>
      </form>
    `;

    expect(getNavigationUrl(document.querySelector("#anchor") as HTMLAnchorElement)).toBe(
      "https://example.com/apply"
    );
    expect(getNavigationUrl(document.querySelector("#data") as HTMLButtonElement)).toBe(
      "https://company.example.com/jobs/apply"
    );
    expect(getNavigationUrl(document.querySelector("#data-to") as HTMLButtonElement)).toBe(
      "https://example.com/candidate/apply"
    );
    expect(getNavigationUrl(document.querySelector("#onclick") as HTMLButtonElement)).toBe(
      "https://jobs.example.com/opening/123"
    );
    expect(getNavigationUrl(document.querySelector("#form-action") as HTMLButtonElement)).toBe(
      "https://company.example.com/candidate/submit"
    );
  });

  it("normalizes URLs and distinguishes internal hosts from external ones", () => {
    expect(normalizeUrl("//jobs.example.com/apply#section")).toBe("https://jobs.example.com/apply");
    expect(normalizeUrl("javascript:void(0)")).toBeNull();

    expect(isExternalUrl("https://jobs.example.com/apply")).toBe(false);
    expect(isExternalUrl("https://cdn.jobs.example.com/apply")).toBe(false);
    expect(isExternalUrl("https://d111111abcdef8.cloudfront.net/asset.js")).toBe(false);
    expect(isExternalUrl("https://company.example.org/careers/apply")).toBe(true);
  });

  it("finds visible elements while skipping invalid selectors and hidden nodes", () => {
    document.body.innerHTML = `
      <button id="hidden" style="display:none">Hidden</button>
      <button id="visible">Visible</button>
    `;

    const found = findFirstVisibleElement<HTMLButtonElement>([
      "button[",
      "#hidden",
      "#visible",
    ]);

    expect(found?.id).toBe("visible");
    expect(isElementVisible(document.querySelector("#hidden") as HTMLButtonElement)).toBe(false);
    expect(isElementVisible(document.querySelector("#visible") as HTMLButtonElement)).toBe(true);
  });

  it("checks whether an element remains interactive", () => {
    document.body.innerHTML = `
      <button id="enabled">Apply</button>
      <button id="disabled" disabled>Disabled</button>
      <button id="aria-disabled" aria-disabled="true">Disabled</button>
      <button id="no-pointer" style="pointer-events:none">Blocked</button>
    `;

    expect(isElementInteractive(document.querySelector("#enabled") as HTMLButtonElement)).toBe(
      true
    );
    expect(isElementInteractive(document.querySelector("#disabled") as HTMLButtonElement)).toBe(
      false
    );
    expect(
      isElementInteractive(document.querySelector("#aria-disabled") as HTMLButtonElement)
    ).toBe(false);
    expect(isElementInteractive(document.querySelector("#no-pointer") as HTMLButtonElement)).toBe(
      false
    );
  });

  it("dispatches click semantics when performing click actions", () => {
    document.body.innerHTML = `<button id="apply">Apply</button>`;

    const button = document.querySelector("#apply") as HTMLButtonElement;
    const clickSpy = vi.fn();
    button.addEventListener("click", clickSpy);

    performClickAction(button);

    expect(clickSpy).toHaveBeenCalled();
  });
});
