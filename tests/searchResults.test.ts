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
});
