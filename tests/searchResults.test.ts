// Note: describe, expect, it, afterEach, beforeEach are provided globally by vitest (globals: true)
// vi must be imported for mocking
import { vi } from "vitest";

import {
  findNextResultsPageAction,
  getJobResultCollectionTargetCount,
  waitForJobDetailUrls,
} from "../src/content/searchResults";

describe("search result collection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      writable: true,
      value: {
        runtime: {
          sendMessage: vi.fn().mockResolvedValue({
            jobResults: [
              {
                normalizedJobPosting: {
                  title: "Platform Engineer",
                  url: "https://www.monster.com/job-openings/platform-engineer-remote--beta456",
                  hiringOrganization: {
                    name: "Example Co",
                  },
                },
                location: {
                  displayText: "Remote",
                },
                dateRecency: "Posted today",
              },
            ],
          }),
        },
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (globalThis as Record<string, unknown>).chrome;
  });

  it("over-collects for startup and other job sites so filtering still leaves enough pages to open", () => {
    expect(getJobResultCollectionTargetCount("other_sites", 1)).toBe(30);
    expect(getJobResultCollectionTargetCount("other_sites", 5)).toBe(30);
    expect(getJobResultCollectionTargetCount("other_sites", 8)).toBe(48);
    expect(getJobResultCollectionTargetCount("startup", 6)).toBe(36);
    expect(getJobResultCollectionTargetCount("indeed", 5)).toBe(25);
    expect(getJobResultCollectionTargetCount("dice", 5)).toBe(40);
    expect(getJobResultCollectionTargetCount("dice", 8)).toBe(64);
  });

  it("merges Monster embedded search results when the DOM alone does not satisfy the requested count", async () => {
    document.body.innerHTML = `
      <article class="job-card">
        <h2>Frontend Engineer</h2>
        <a href="https://www.monster.com/job-openings/frontend-engineer-remote--alpha123">
          View job
        </a>
      </article>
    `;

    const promise = waitForJobDetailUrls({
      site: "monster",
      datePostedWindow: "any",
      targetCount: 2,
      detectedSite: "monster",
    });

    await vi.runAllTimersAsync();
    const urls = await promise;

    expect(urls).toEqual([
      "https://www.monster.com/job-openings/frontend-engineer-remote--alpha123",
      "https://www.monster.com/job-openings/platform-engineer-remote--beta456",
    ]);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: "extract-monster-search-results",
    });
  });

  it("scrolls the Monster results rail to load additional jobs before finishing review", async () => {
    chrome.runtime.sendMessage = vi.fn().mockResolvedValue({
      jobResults: [],
    });

    document.body.innerHTML = `
      <main>
        <section
          id="monster-results-rail"
          data-testid="search-results"
          aria-label="Job results"
          style="overflow-y: auto; height: 480px;"
        >
          <article class="job-card">
            <h2>Frontend Engineer</h2>
            <a href="https://www.monster.com/job-openings/frontend-engineer-remote--alpha123">
              Frontend Engineer
            </a>
          </article>
        </section>
      </main>
    `;

    const rail = document.getElementById("monster-results-rail") as HTMLElement;
    let scrollTop = 0;
    let stage = 0;

    Object.defineProperty(rail, "clientHeight", {
      configurable: true,
      get: () => 480,
    });
    Object.defineProperty(rail, "scrollHeight", {
      configurable: true,
      get: () => 2400,
    });
    Object.defineProperty(rail, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;

        if (value >= 280 && stage === 0) {
          stage = 1;
          rail.insertAdjacentHTML(
            "beforeend",
            `
              <article class="job-card">
                <h2>Platform Engineer</h2>
                <a href="https://www.monster.com/job-openings/platform-engineer-remote--beta456">
                  Platform Engineer
                </a>
              </article>
            `
          );
        }

        if (value >= 840 && stage === 1) {
          stage = 2;
          rail.insertAdjacentHTML(
            "beforeend",
            `
              <article class="job-card">
                <h2>Site Reliability Engineer</h2>
                <a href="https://www.monster.com/job-openings/site-reliability-engineer-remote--gamma789">
                  Site Reliability Engineer
                </a>
              </article>
            `
          );
        }
      },
    });

    const promise = waitForJobDetailUrls({
      site: "monster",
      datePostedWindow: "any",
      targetCount: 3,
      detectedSite: "monster",
    });

    await vi.runAllTimersAsync();
    const urls = await promise;

    expect(urls).toEqual([
      "https://www.monster.com/job-openings/frontend-engineer-remote--alpha123",
      "https://www.monster.com/job-openings/platform-engineer-remote--beta456",
      "https://www.monster.com/job-openings/site-reliability-engineer-remote--gamma789",
    ]);
    expect(scrollTop).toBeGreaterThan(0);
  });

  it("prefers scrolling the inner Monster dashboard list instead of the page body", async () => {
    chrome.runtime.sendMessage = vi.fn().mockResolvedValue({
      jobResults: [],
    });

    document.body.innerHTML = `
      <main>
        <section id="monster-page-shell" data-testid="search-results">
          <div
            id="monster-dashboard-list"
            class="left-dashboard-panel"
            aria-label="Job results dashboard"
          >
            <article class="job-card">
              <a href="https://www.monster.com/job-openings/frontend-engineer-remote--alpha123">
                Frontend Engineer
              </a>
            </article>
          </div>
        </section>
      </main>
    `;

    const dashboard = document.getElementById("monster-dashboard-list") as HTMLElement;
    let scrollTop = 0;

    Object.defineProperty(dashboard, "clientHeight", {
      configurable: true,
      get: () => 420,
    });
    Object.defineProperty(dashboard, "scrollHeight", {
      configurable: true,
      get: () => 2200,
    });
    Object.defineProperty(dashboard, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
        if (value >= 300 && !dashboard.querySelector("#second-job")) {
          dashboard.insertAdjacentHTML(
            "beforeend",
            `
              <article class="job-card" id="second-job">
                <a href="https://www.monster.com/job-openings/platform-engineer-remote--beta456">
                  Platform Engineer
                </a>
              </article>
            `
          );
        }
      },
    });

    const pageScrollSpy = vi.spyOn(window, "scrollTo");

    const promise = waitForJobDetailUrls({
      site: "monster",
      datePostedWindow: "any",
      targetCount: 2,
      detectedSite: "monster",
    });

    await vi.runAllTimersAsync();
    const urls = await promise;

    expect(urls).toEqual([
      "https://www.monster.com/job-openings/frontend-engineer-remote--alpha123",
      "https://www.monster.com/job-openings/platform-engineer-remote--beta456",
    ]);
    expect(scrollTop).toBeGreaterThan(0);
    expect(pageScrollSpy).not.toHaveBeenCalled();
  });

  it("finds Indeed next-page pagination controls without confusing generic next buttons", () => {
    document.body.innerHTML = `
      <section role="dialog" aria-modal="true">
        <button type="button">Next</button>
      </section>
      <nav aria-label="pagination">
        <a href="/jobs?q=software+engineer&start=0" aria-label="Previous Page">Previous</a>
        <a href="/jobs?q=software+engineer&start=0" aria-current="page">1</a>
        <a href="/jobs?q=software+engineer&start=10">2</a>
        <a
          href="/jobs?q=software+engineer&start=10"
          aria-label="Next Page"
          data-testid="pagination-page-next"
        >
          Next
        </a>
      </nav>
    `;

    const action = findNextResultsPageAction("indeed");

    expect(action?.navUrl).toContain("start=10");
  });

  it("finds Dice next-page controls from pagination arrows", () => {
    document.body.innerHTML = `
      <nav class="pagination">
        <button type="button" aria-label="Previous page" class="pagination-prev">Previous</button>
        <button type="button" aria-current="page">1</button>
        <a
          href="https://www.dice.com/jobs?q=software%20engineer&page=2"
          aria-label="Next page"
          class="pagination-next"
        >
          >
        </a>
      </nav>
    `;

    const action = findNextResultsPageAction("dice");

    expect(action?.navUrl).toBe(
      "https://www.dice.com/jobs?q=software%20engineer&page=2"
    );
  });

  it("finds next-page controls that use a unicode arrow glyph", () => {
    document.body.innerHTML = `
      <nav class="pagination">
        <a href="/jobs?q=software+engineer&page=1" aria-current="page">1</a>
        <a
          href="/jobs?q=software+engineer&page=2"
          aria-label="Next page"
          class="pagination-next"
        >
          ›
        </a>
      </nav>
    `;

    const action = findNextResultsPageAction("dice");

    expect(action?.navUrl).toContain("page=2");
  });

  it("does not try generic career-surface recovery clicks on the MyGreenhouse portal", async () => {
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: new URL("https://my.greenhouse.io/") as unknown as Location,
    });

    document.body.innerHTML = `
      <main>
        <input placeholder="Search for a job title" value="full stack" />
        <button id="portal-action" type="button">Quick apply</button>
      </main>
    `;

    let clicks = 0;
    document.getElementById("portal-action")?.addEventListener("click", () => {
      clicks += 1;
    });

    const promise = waitForJobDetailUrls({
      site: "greenhouse",
      datePostedWindow: "any",
      targetCount: 1,
      detectedSite: "greenhouse",
      searchKeywords: ["full stack"],
    });

    await vi.runAllTimersAsync();
    const urls = await promise;

    expect(urls).toEqual([]);
    expect(clicks).toBe(0);

    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });
});
