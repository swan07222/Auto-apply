import { vi } from "vitest";

import {
  comparePostedAgeHours,
  extractPostedAgeHours,
  filterCandidatesByDatePostedWindow,
  isPostedAgeWithinDateWindow,
  isAppliedJobText,
  looksLikeTechnicalRoleTitle,
  scoreCandidateKeywordRelevance,
  scoreJobTitleForResume,
  shouldAllowBroadTechnicalKeywordFallback,
  shouldFinishJobResultScan,
} from "../src/content/jobSearchHeuristics";
import type { JobCandidate } from "../src/content/types";

describe("job search heuristic helpers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 26, 12, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("scores keywords only when the match is strong enough", () => {
    const candidate: JobCandidate = {
      url: "https://example.com/jobs/frontend-engineer",
      title: "Frontend Engineer",
      contextText: "Remote role with React and TypeScript.",
    };

    expect(scoreCandidateKeywordRelevance(candidate, ["frontend engineer"])).toBe(100);
    expect(scoreCandidateKeywordRelevance(candidate, ["sales manager"])).toBe(0);
  });

  it("only broad technical searches can fall back to generic technical roles", () => {
    expect(shouldAllowBroadTechnicalKeywordFallback(["software engineer"])).toBe(true);
    expect(shouldAllowBroadTechnicalKeywordFallback(["senior software engineer"])).toBe(true);
    expect(shouldAllowBroadTechnicalKeywordFallback(["backend engineer"])).toBe(false);
    expect(shouldAllowBroadTechnicalKeywordFallback(["full stack engineer"])).toBe(false);
  });

  it("parses posted-age text and filters recent candidates", () => {
    const candidates: JobCandidate[] = [
      {
        url: "https://example.com/jobs/new",
        title: "Frontend Engineer",
        contextText: "Posted today.",
      },
      {
        url: "https://example.com/jobs/old",
        title: "Frontend Engineer",
        contextText: "Posted 2 weeks ago.",
      },
    ];

    expect(extractPostedAgeHours("Posted 3 days ago")).toBe(72);
    expect(comparePostedAgeHours(24, 72, "3d")).toBeLessThan(0);
    expect(filterCandidatesByDatePostedWindow(candidates, "3d")).toEqual([candidates[0]]);
  });

  it("parses reposted and compact plus-style date chips from job boards", () => {
    expect(extractPostedAgeHours("Reposted 2 days ago")).toBe(48);
    expect(extractPostedAgeHours("Platform Engineer Remote 30d+")).toBe(720);
    expect(extractPostedAgeHours("Updated 15 minutes ago")).toBe(0);
    expect(extractPostedAgeHours("Posted Mar 25, 2026")).toBe(24);
    expect(extractPostedAgeHours("Listed 2026-03-19")).toBe(168);
  });

  it("parses compact standalone age chips and expanded posted-date labels", () => {
    expect(extractPostedAgeHours("71h")).toBe(71);
    expect(extractPostedAgeHours("3 d")).toBe(72);
    expect(extractPostedAgeHours("Remote role. 3 d")).toBe(72);
    expect(extractPostedAgeHours("1 wk ago")).toBe(168);
    expect(extractPostedAgeHours("Date posted 2 days ago")).toBe(48);
    expect(extractPostedAgeHours("Posted within 24 hours")).toBe(24);
    expect(isPostedAgeWithinDateWindow(96, "3d")).toBe(false);
    expect(isPostedAgeWithinDateWindow(216, "10d")).toBe(true);
    expect(isPostedAgeWithinDateWindow(360, "14d")).toBe(false);
    expect(isPostedAgeWithinDateWindow(720, "30d")).toBe(true);
  });

  it("treats standalone New badges as recent without misreading location or title text", () => {
    expect(extractPostedAgeHours("New")).toBe(12);
    expect(extractPostedAgeHours("Quick Apply New")).toBe(12);
    expect(extractPostedAgeHours("Remote role. Quick Apply New.")).toBe(12);
    expect(extractPostedAgeHours("Remote role. New.")).toBe(12);
    expect(extractPostedAgeHours("New York, NY")).toBeNull();
    expect(extractPostedAgeHours("New Grad Software Engineer")).toBeNull();
  });

  it("ignores unrelated page dates that are not posted-date signals", () => {
    expect(extractPostedAgeHours("Interview process starts Mar 10, 2026")).toBeNull();
    expect(extractPostedAgeHours("Compensation reviewed every quarter")).toBeNull();
  });

  it("keeps technical-title and applied-state heuristics explicit", () => {
    expect(looksLikeTechnicalRoleTitle("Senior React Engineer")).toBe(true);
    expect(looksLikeTechnicalRoleTitle("Head of People Operations")).toBe(false);
    expect(isAppliedJobText("Applied Scientist, Ranking")).toBe(false);
    expect(isAppliedJobText("Application submitted. You applied 2 days ago.")).toBe(true);
  });

  it("encodes scan stopping and resume scoring rules", () => {
    expect(shouldFinishJobResultScan(3, 5, 10, 18, "ziprecruiter")).toBe(true);
    expect(shouldFinishJobResultScan(3, 5, 9, 18, "ziprecruiter")).toBe(false);
    expect(scoreJobTitleForResume("Senior Frontend Engineer", "front_end")).toBeGreaterThan(0);
    expect(scoreJobTitleForResume("Senior Backend Engineer", "front_end")).toBeLessThan(0);
  });
});
