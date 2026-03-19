import { describe, expect, it } from "vitest";

import {
  isAppliedJobText,
  isLikelyJobDetailUrl,
  pickRelevantJobUrls,
} from "../src/content/jobSearch";
import type { JobCandidate } from "../src/content/types";

describe("job search candidate filtering", () => {
  it("filters and prioritizes candidates by recency and resume kind", () => {
    const candidates: JobCandidate[] = [
      {
        url: "https://example.com/jobs/front-end-engineer-1",
        title: "Front End Engineer",
        contextText: "Remote role. Posted today.",
      },
      {
        url: "https://example.com/jobs/full-stack-engineer-2",
        title: "Full Stack Engineer",
        contextText: "Remote role. Posted 2 days ago.",
      },
      {
        url: "https://example.com/jobs/back-end-engineer-3",
        title: "Back End Engineer",
        contextText: "Remote role. Posted 1 week ago.",
      },
      {
        url: "https://example.com/jobs/front-end-engineer-4",
        title: "Front End Engineer",
        contextText: "Remote role. Posted 10 days ago.",
      },
    ];

    const urls = pickRelevantJobUrls(
      candidates,
      "other_sites",
      "front_end",
      "3d"
    );

    expect(urls).toEqual([
      "https://example.com/jobs/front-end-engineer-1",
      "https://example.com/jobs/full-stack-engineer-2",
    ]);
  });

  it("accepts Monster detail URLs and rejects listing URLs", () => {
    expect(
      isLikelyJobDetailUrl(
        "monster",
        "https://www.monster.com/job/senior-front-end-engineer-abc123",
        "Senior Front End Engineer"
      )
    ).toBe(true);

    expect(
      isLikelyJobDetailUrl(
        "monster",
        "https://www.monster.com/jobs/q-front-end-developer-jobs-l-remote",
        "Front End Developer jobs"
      )
    ).toBe(false);
  });

  it("detects applied-job text without false positives for applied scientist roles", () => {
    expect(
      isAppliedJobText("Application submitted. You applied 2 days ago.")
    ).toBe(true);
    expect(isAppliedJobText("Applied Scientist, Search Ranking")).toBe(false);
  });
});
