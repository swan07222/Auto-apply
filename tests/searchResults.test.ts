// Note: describe, expect, it, afterEach, beforeEach are provided globally by vitest (globals: true)
// vi must be imported for mocking
import { vi } from "vitest";

import {
  advanceToNextResultsPage,
  findNextResultsPageAction,
  getJobResultCollectionTargetCount,
  tryApplySupportedResultsDateFilter,
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

  it("scrolls an inner Greenhouse results container to load additional jobs before finishing review", async () => {
    document.body.innerHTML = `
      <main>
        <section
          id="greenhouse-results-rail"
          class="job-posts"
          aria-label="Job results"
        >
          <div class="job-posts--table--department">
            <div class="job-posts--table">
              <table>
                <tbody>
                  <tr class="job-post">
                    <td class="cell">
                      <a href="https://job-boards.greenhouse.io/vercel/jobs/5430088004">
                        <p>Software Engineer, Accounts</p>
                        <p>Remote - United States</p>
                      </a>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </main>
    `;

    const rail = document.getElementById("greenhouse-results-rail") as HTMLElement;
    let scrollTop = 0;

    Object.defineProperty(rail, "clientHeight", {
      configurable: true,
      get: () => 420,
    });
    Object.defineProperty(rail, "scrollHeight", {
      configurable: true,
      get: () => 2200,
    });
    Object.defineProperty(rail, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
        if (value >= 300 && !rail.querySelector("#second-greenhouse-job")) {
          rail.insertAdjacentHTML(
            "beforeend",
            `
              <div class="job-posts--table--department" id="second-greenhouse-job">
                <div class="job-posts--table">
                  <table>
                    <tbody>
                      <tr class="job-post">
                        <td class="cell">
                          <a href="https://job-boards.greenhouse.io/vercel/jobs/5813134004">
                            <p>Software Engineer, Domains</p>
                            <p>Remote - United States</p>
                          </a>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            `
          );
        }
      },
    });

    const pageScrollSpy = vi.spyOn(window, "scrollTo");

    const promise = waitForJobDetailUrls({
      site: "greenhouse",
      datePostedWindow: "any",
      targetCount: 2,
      detectedSite: "greenhouse",
      searchKeywords: ["software engineer"],
    });

    await vi.runAllTimersAsync();
    const urls = await promise;

    expect(urls).toEqual([
      "https://job-boards.greenhouse.io/vercel/jobs/5430088004",
      "https://job-boards.greenhouse.io/vercel/jobs/5813134004",
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

  it("finds Greenhouse next-page controls from sibling page indicators even outside a nav wrapper", () => {
    document.body.innerHTML = `
      <section class="results-pagination">
        <button type="button">Previous</button>
        <button type="button" aria-current="page">1</button>
        <button type="button" data-testid="results-next">Next</button>
      </section>
    `;

    const action = findNextResultsPageAction("greenhouse");

    expect(action?.text).toBe("next");
  });

  it("finds the live Greenhouse public-board next button from pagination classes and aria labels", () => {
    document.body.innerHTML = `
      <section class="pagination">
        <button
          type="button"
          aria-label="Previous page"
          class="pagination__btn pagination__previous pagination__previous--inactive"
        ></button>
        <button
          type="button"
          aria-label="Go to page 1"
          class="pagination__link pagination__link--active"
        >
          1
        </button>
        <button type="button" aria-label="Go to page 2" class="pagination__link">2</button>
        <button type="button" aria-label="Next page" class="pagination__btn pagination__next"></button>
      </section>
    `;

    const action = findNextResultsPageAction("greenhouse");

    expect(action?.text).toBe("next page");
  });

  it("falls back to the next numbered pagination control when there is no explicit next button", () => {
    document.body.innerHTML = `
      <section class="pagination">
        <button
          type="button"
          aria-label="Go to page 1"
          class="pagination__link pagination__link--active"
        >
          1
        </button>
        <button type="button" aria-label="Go to page 2" class="pagination__link">2</button>
        <button type="button" aria-label="Go to page 3" class="pagination__link">3</button>
      </section>
    `;

    const action = findNextResultsPageAction("greenhouse");

    expect(action?.text).toBe("2");
  });

  it("prefers the immediate next numbered Indeed page instead of jumping to the last visible page", () => {
    document.body.innerHTML = `
      <nav aria-label="pagination">
        <a href="/jobs?q=software+engineer&start=0">1</a>
        <a href="/jobs?q=software+engineer&start=10" aria-current="page">2</a>
        <a href="/jobs?q=software+engineer&start=20">3</a>
        <a href="/jobs?q=software+engineer&start=30">4</a>
        <a href="/jobs?q=software+engineer&start=40">5</a>
      </nav>
    `;

    const action = findNextResultsPageAction("indeed");

    expect(action?.text).toBe("3");
    expect(action?.navUrl).toContain("start=20");
  });

  it("ignores inactive Greenhouse next buttons on the last results page", () => {
    document.body.innerHTML = `
      <section class="pagination">
        <button type="button" aria-label="Previous page" class="pagination__btn pagination__previous"></button>
        <button type="button" aria-label="Go to page 1" class="pagination__link">1</button>
        <button
          type="button"
          aria-label="Go to page 2"
          class="pagination__link pagination__link--active"
        >
          2
        </button>
        <button
          type="button"
          aria-label="Next page"
          class="pagination__btn pagination__next pagination__next--inactive"
        ></button>
      </section>
    `;

    const action = findNextResultsPageAction("greenhouse");

    expect(action).toBeNull();
  });

  it("can find off-screen Greenhouse pagination controls on long result pages", () => {
    document.body.innerHTML = `
      <section class="pagination">
        <button type="button" aria-label="Previous page" class="pagination__btn pagination__previous"></button>
        <button
          type="button"
          aria-label="Go to page 1"
          class="pagination__link pagination__link--active"
        >
          1
        </button>
        <button type="button" aria-label="Go to page 2" class="pagination__link">2</button>
        <button type="button" aria-label="Next page" class="pagination__btn pagination__next"></button>
      </section>
    `;

    const originalInnerHeight = window.innerHeight;

    try {
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: 800,
      });

      for (const element of Array.from(document.querySelectorAll<HTMLElement>(".pagination button"))) {
        Object.defineProperty(element, "getBoundingClientRect", {
          configurable: true,
          value: () =>
            ({
              width: 48,
              height: 32,
              top: 3_000,
              bottom: 3_032,
              left: 32,
              right: 80,
              x: 32,
              y: 3_000,
              toJSON: () => ({}),
            }) as DOMRect,
        });
      }

      const action = findNextResultsPageAction("greenhouse");

      expect(action?.text).toBe("next page");
    } finally {
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: originalInnerHeight,
      });
    }
  });

  it("finds icon-only next-page controls at the end of a numbered pagination row", () => {
    document.body.innerHTML = `
      <section class="results-pagination">
        <button type="button" aria-current="page">1</button>
        <button type="button">2</button>
        <button type="button">3</button>
        <button type="button" class="pager-chevron">
          <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M6 3l5 5-5 5"></path></svg>
        </button>
      </section>
    `;

    const action = findNextResultsPageAction("builtin");

    expect(action).not.toBeNull();
  });

  it("waits for delayed in-place pagination updates before giving up on the next page", async () => {
    document.body.innerHTML = `
      <main>
        <section class="results-pagination">
          <button type="button" aria-current="page">1</button>
          <button type="button">2</button>
          <button type="button" id="next-page" class="pager-chevron">
            <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M6 3l5 5-5 5"></path></svg>
          </button>
        </section>
        <article class="job-result">
          <a href="https://www.indeed.com/viewjob?jk=alpha123">Software Engineer</a>
        </article>
      </main>
    `;

    document.getElementById("next-page")?.addEventListener("click", () => {
      setTimeout(() => {
        document.body.innerHTML = `
          <main>
            <section class="results-pagination">
              <button type="button">1</button>
              <button type="button" aria-current="page">2</button>
              <button type="button">3</button>
            </section>
            <article class="job-result">
              <a href="https://www.indeed.com/viewjob?jk=beta456">Platform Engineer</a>
            </article>
          </main>
        `;
      }, 900);
    });

    const promise = advanceToNextResultsPage("indeed");

    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe("advanced");
    expect(document.body.textContent).toContain("Platform Engineer");
  });

  it("keeps reviewing results when pagination updates the URL before the new jobs render", async () => {
    document.body.innerHTML = `
      <main>
        <section class="results-pagination">
          <button type="button" aria-current="page">1</button>
          <button type="button">2</button>
          <button type="button" id="next-page-url" class="pager-chevron">
            <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M6 3l5 5-5 5"></path></svg>
          </button>
        </section>
        <article class="job-result">
          <a href="https://www.indeed.com/viewjob?jk=alpha123">Software Engineer</a>
        </article>
      </main>
    `;

    document.getElementById("next-page-url")?.addEventListener("click", () => {
      setTimeout(() => {
        window.history.pushState({}, "", "/jobs?q=software+engineer&start=10");
      }, 150);

      setTimeout(() => {
        document.body.innerHTML = `
          <main>
            <section class="results-pagination">
              <button type="button">1</button>
              <button type="button" aria-current="page">2</button>
              <button type="button">3</button>
            </section>
            <article class="job-result">
              <a href="https://www.indeed.com/viewjob?jk=beta456">Platform Engineer</a>
            </article>
          </main>
        `;
      }, 900);
    });

    const promise = advanceToNextResultsPage("indeed");

    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe("advanced");
    expect(window.location.href).toContain("start=10");
    expect(document.body.textContent).toContain("Platform Engineer");
  });

  it("respects the selected date window when collecting career-site job URLs", async () => {
    document.body.innerHTML = `
      <main>
        <article class="job-result">
          <h2>Frontend Engineer</h2>
          <a href="https://example.com/careers/jobs/frontend-engineer-123">
            Frontend Engineer
          </a>
          <span>Remote</span>
          <span>Posted today</span>
        </article>
        <article class="job-result">
          <h2>Platform Engineer</h2>
          <a href="https://example.com/careers/jobs/platform-engineer-456">
            Platform Engineer
          </a>
          <span>Remote</span>
          <span>Reposted 2 weeks ago</span>
        </article>
      </main>
    `;

    const urls = await waitForJobDetailUrls({
      site: "other_sites",
      datePostedWindow: "24h",
      targetCount: 1,
      detectedSite: "other_sites",
    });

    expect(urls).toEqual([
      "https://example.com/careers/jobs/frontend-engineer-123",
    ]);
  });

  it("respects compact posted-age chips when collecting career-site job URLs", async () => {
    document.body.innerHTML = `
      <main>
        <article class="job-result">
          <h2>Frontend Engineer</h2>
          <a href="https://example.com/careers/jobs/frontend-engineer-123">
            Frontend Engineer
          </a>
          <span>Remote</span>
          <span>2 h</span>
        </article>
        <article class="job-result">
          <h2>Platform Engineer</h2>
          <a href="https://example.com/careers/jobs/platform-engineer-456">
            Platform Engineer
          </a>
          <span>Remote</span>
          <span>3 d</span>
        </article>
      </main>
    `;

    const urls = await waitForJobDetailUrls({
      site: "other_sites",
      datePostedWindow: "24h",
      targetCount: 1,
      detectedSite: "other_sites",
    });

    expect(urls).toEqual([
      "https://example.com/careers/jobs/frontend-engineer-123",
    ]);
  });

  it("applies the ZipRecruiter posted-date filter on the search surface before collecting results", async () => {
    document.body.innerHTML = `
      <main>
        <button id="date-filter-toggle" type="button" aria-expanded="false">
          Date Posted
        </button>
        <section id="date-filter-menu" hidden>
          <button id="date-filter-24h" type="button">Within 1 day</button>
        </section>
      </main>
    `;

    const toggle = document.getElementById("date-filter-toggle") as HTMLButtonElement;
    const menu = document.getElementById("date-filter-menu") as HTMLElement;
    const option = document.getElementById("date-filter-24h") as HTMLButtonElement;

    const makeVisibleRect = () =>
      ({
        width: 180,
        height: 32,
        top: 10,
        left: 10,
        right: 190,
        bottom: 42,
        x: 10,
        y: 10,
        toJSON: () => ({}),
      }) as DOMRect;

    Object.defineProperty(toggle, "getBoundingClientRect", {
      configurable: true,
      value: makeVisibleRect,
    });
    Object.defineProperty(option, "getBoundingClientRect", {
      configurable: true,
      value: () =>
        ({
          width: 0,
          height: 0,
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect,
    });

    toggle.addEventListener("click", () => {
      menu.hidden = false;
      toggle.setAttribute("aria-expanded", "true");
      Object.defineProperty(option, "getBoundingClientRect", {
        configurable: true,
        value: makeVisibleRect,
      });
    });
    option.addEventListener("click", () => {
      document.body.setAttribute("data-zip-date-filter", "24h");
    });

    const promise = tryApplySupportedResultsDateFilter("ziprecruiter", "24h");

    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe(true);
    expect(document.body.getAttribute("data-zip-date-filter")).toBe("24h");
  });

  it("maps narrower ZipRecruiter date windows onto the next available native bucket", async () => {
    document.body.innerHTML = `
      <main>
        <button id="date-filter-toggle" type="button" aria-expanded="false">
          Date Posted
        </button>
        <section id="date-filter-menu" hidden>
          <button id="date-filter-5d" type="button">Within 5 days</button>
        </section>
      </main>
    `;

    const toggle = document.getElementById("date-filter-toggle") as HTMLButtonElement;
    const menu = document.getElementById("date-filter-menu") as HTMLElement;
    const option = document.getElementById("date-filter-5d") as HTMLButtonElement;

    const makeVisibleRect = () =>
      ({
        width: 180,
        height: 32,
        top: 10,
        left: 10,
        right: 190,
        bottom: 42,
        x: 10,
        y: 10,
        toJSON: () => ({}),
      }) as DOMRect;

    Object.defineProperty(toggle, "getBoundingClientRect", {
      configurable: true,
      value: makeVisibleRect,
    });
    Object.defineProperty(option, "getBoundingClientRect", {
      configurable: true,
      value: () =>
        ({
          width: 0,
          height: 0,
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect,
    });

    toggle.addEventListener("click", () => {
      menu.hidden = false;
      toggle.setAttribute("aria-expanded", "true");
      Object.defineProperty(option, "getBoundingClientRect", {
        configurable: true,
        value: makeVisibleRect,
      });
    });
    option.addEventListener("click", () => {
      document.body.setAttribute("data-zip-date-filter", "5d");
    });

    const promise = tryApplySupportedResultsDateFilter("ziprecruiter", "3d");

    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe(true);
    expect(document.body.getAttribute("data-zip-date-filter")).toBe("5d");
  });

  it("applies the Monster posted-date filter through the visible results select", async () => {
    document.body.innerHTML = `
      <main>
        <select id="monster-date-filter">
          <option value="">All Dates</option>
          <option value="today">Today</option>
          <option value="last-2-days">Last 2 days</option>
          <option value="last-week">Last week</option>
          <option value="last-2-weeks">Last 2 weeks</option>
          <option value="last-month">Last month</option>
        </select>
      </main>
    `;

    const select = document.getElementById("monster-date-filter") as HTMLSelectElement;
    Object.defineProperty(select, "getBoundingClientRect", {
      configurable: true,
      value: () =>
        ({
          width: 180,
          height: 32,
          top: 10,
          left: 10,
          right: 190,
          bottom: 42,
          x: 10,
          y: 10,
          toJSON: () => ({}),
        }) as DOMRect,
    });
    select.addEventListener("change", () => {
      document.body.setAttribute("data-monster-date-filter", select.value);
    });

    const promise = tryApplySupportedResultsDateFilter("monster", "14d");

    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe(true);
    expect(document.body.getAttribute("data-monster-date-filter")).toBe("last-2-weeks");
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
