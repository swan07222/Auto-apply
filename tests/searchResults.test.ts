import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { waitForJobDetailUrls } from "../src/content/searchResults";

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
});
