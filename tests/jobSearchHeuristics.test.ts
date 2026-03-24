import {
  comparePostedAgeHours,
  extractPostedAgeHours,
  filterCandidatesByDatePostedWindow,
  isAppliedJobText,
  looksLikeTechnicalRoleTitle,
  scoreCandidateKeywordRelevance,
  scoreJobTitleForResume,
  shouldFinishJobResultScan,
} from "../src/content/jobSearchHeuristics";
import type { JobCandidate } from "../src/content/types";

describe("job search heuristic helpers", () => {
  it("scores keywords only when the match is strong enough", () => {
    const candidate: JobCandidate = {
      url: "https://example.com/jobs/frontend-engineer",
      title: "Frontend Engineer",
      contextText: "Remote role with React and TypeScript.",
    };

    expect(scoreCandidateKeywordRelevance(candidate, ["frontend engineer"])).toBe(100);
    expect(scoreCandidateKeywordRelevance(candidate, ["sales manager"])).toBe(0);
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
