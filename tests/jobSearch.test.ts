import { describe, expect, it } from "vitest";

import {
  collectJobDetailCandidates,
  collectMonsterEmbeddedCandidates,
  isCurrentPageAppliedJob,
  isAppliedJobText,
  isLikelyJobDetailUrl,
  isStrongAppliedJobText,
  looksLikeTechnicalRoleTitle,
  pickRelevantJobUrls,
  shouldFinishJobResultScan,
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

  it("keeps fallback generic jobs after preferred matches so boards can fill the requested limit", () => {
    const candidates: JobCandidate[] = [
      {
        url: "https://www.ziprecruiter.com/jobs/front-end-engineer-1?jid=fe-1",
        title: "Front End Engineer",
        contextText: "Posted today.",
      },
      {
        url: "https://www.ziprecruiter.com/jobs/software-engineer-2?jid=se-2",
        title: "Software Engineer",
        contextText: "Posted today.",
      },
      {
        url: "https://www.ziprecruiter.com/jobs/software-engineer-3?jid=se-3",
        title: "Software Engineer II",
        contextText: "Posted 2 days ago.",
      },
    ];

    expect(pickRelevantJobUrls(candidates, "ziprecruiter", "front_end", "3d")).toEqual([
      "https://www.ziprecruiter.com/jobs/front-end-engineer-1?jid=fe-1",
      "https://www.ziprecruiter.com/jobs/software-engineer-2?jid=se-2",
      "https://www.ziprecruiter.com/jobs/software-engineer-3?jid=se-3",
    ]);
  });

  it("accepts ZipRecruiter jobs-search URLs when they pin a specific job", () => {
    expect(
      isLikelyJobDetailUrl(
        "ziprecruiter",
        "https://www.ziprecruiter.com/jobs-search?search=front-end-developer&location=Remote&lk=abc123",
        "Front End Engineer"
      )
    ).toBe(true);

    expect(
      isLikelyJobDetailUrl(
        "ziprecruiter",
        "https://www.ziprecruiter.com/jobs-search?search=front-end-developer&location=Remote&jid=job-456",
        "Front End Engineer"
      )
    ).toBe(true);

    expect(
      isLikelyJobDetailUrl(
        "ziprecruiter",
        "https://www.ziprecruiter.com/jobs-search?search=front-end-developer&location=Remote",
        "Front End Engineer"
      )
    ).toBe(false);
  });

  it("collects ZipRecruiter card and data-attribute candidates from search results", () => {
    window.history.replaceState(
      {},
      "",
      "/jobs-search?search=front-end-developer&location=Remote"
    );

    document.body.innerHTML = `
      <article id="job-card-card123">
        <h2>Front End Engineer</h2>
        <button aria-label="View Front End Engineer"></button>
      </article>
      <article data-jid="job456">
        <h2>Back End Engineer</h2>
      </article>
    `;

    const urls = pickRelevantJobUrls(
      collectJobDetailCandidates("ziprecruiter"),
      "ziprecruiter",
      "front_end"
    );

    expect(urls).toContain(
      "https://example.com/jobs-search?search=front-end-developer&location=Remote&lk=card123"
    );
    expect(urls).toContain(
      "https://example.com/jobs-search?search=front-end-developer&location=Remote&jid=job456"
    );
  });

  it("rebuilds ZipRecruiter candidate URLs without stale pinned-job parameters", () => {
    window.history.replaceState(
      {},
      "",
      "/jobs-search?search=front-end-developer&location=Remote&jid=stale-job"
    );

    document.body.innerHTML = `
      <article id="job-card-card123">
        <h2>Front End Engineer</h2>
      </article>
    `;

    const cardUrls = pickRelevantJobUrls(
      collectJobDetailCandidates("ziprecruiter"),
      "ziprecruiter"
    );

    expect(cardUrls).toContain(
      "https://example.com/jobs-search?search=front-end-developer&location=Remote&lk=card123"
    );
    expect(cardUrls.some((url) => url.includes("jid=stale-job"))).toBe(false);

    window.history.replaceState(
      {},
      "",
      "/jobs-search?search=front-end-developer&location=Remote&lk=stale-card"
    );

    document.body.innerHTML = `
      <article data-jid="job456">
        <h2>Back End Engineer</h2>
      </article>
    `;

    const dataAttributeUrls = pickRelevantJobUrls(
      collectJobDetailCandidates("ziprecruiter"),
      "ziprecruiter"
    );

    expect(dataAttributeUrls).toContain(
      "https://example.com/jobs-search?search=front-end-developer&location=Remote&jid=job456"
    );
    expect(dataAttributeUrls.some((url) => url.includes("lk=stale-card"))).toBe(false);
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
        "https://www.monster.com/jobs/search?q=front+end+developer&where=remote&so=m.h.s",
        "Front End Developer jobs"
      )
    ).toBe(false);

    expect(
      isLikelyJobDetailUrl(
        "monster",
        "https://www.monster.com/jobs/q-front-end-developer-jobs-l-remote",
        "Front End Developer jobs"
      )
    ).toBe(false);
  });

  it("collects Monster job cards while skipping search-style links", () => {
    document.body.innerHTML = `
      <article class="job-card">
        <h2>Senior Front End Engineer</h2>
        <a href="https://www.monster.com/job/senior-front-end-engineer-abc123">View job</a>
      </article>
      <article class="job-card">
        <h2>Search all jobs</h2>
        <a href="https://www.monster.com/jobs/search/?q=frontend">Browse jobs</a>
      </article>
    `;

    const urls = pickRelevantJobUrls(collectJobDetailCandidates("monster"), "monster");

    expect(urls).toEqual(["https://www.monster.com/job/senior-front-end-engineer-abc123"]);
  });

  it("collects Monster candidates from embedded search results when the DOM has no links", () => {
    const urls = pickRelevantJobUrls(
      collectMonsterEmbeddedCandidates([
        {
          normalizedJobPosting: {
            title: "Back End Java Developer",
            url: "https://www.monster.com/job-openings/back-end-java-developer-remote-fargo-nd--eabee747-01c9-4b2b-a94c-868b0d2b35d1",
            hiringOrganization: {
              name: "ConsultNet",
            },
          },
          location: {
            displayText: "Fargo, ND",
          },
          dateRecency: "30+ days ago",
          enrichments: {
            processedDescriptions: {
              shortDescription:
                "Remote Java services role working across APIs and backend systems.",
            },
          },
        },
      ]),
      "monster"
    );

    expect(urls).toEqual([
      "https://www.monster.com/job-openings/back-end-java-developer-remote-fargo-nd--eabee747-01c9-4b2b-a94c-868b0d2b35d1",
    ]);
  });

  it("collects ATS-backed startup roles and ignores listing CTAs", () => {
    document.body.innerHTML = `
      <section class="careers">
        <a href="https://jobs.lever.co/example">Open jobs</a>
        <article class="opening-card">
          <h3>Backend Engineer</h3>
          <a href="https://jobs.lever.co/example/abcd1234">Apply</a>
        </article>
        <article class="opening-card">
          <h3>Senior Product Manager</h3>
          <a href="https://jobs.lever.co/example/pm-role">Apply</a>
        </article>
      </section>
    `;

    const urls = pickRelevantJobUrls(
      collectJobDetailCandidates("startup"),
      "startup",
      "back_end"
    );

    expect(urls).toEqual(["https://jobs.lever.co/example/abcd1234"]);
  });

  it("collects generic job detail links on other job sites", () => {
    document.body.innerHTML = `
      <article class="job-result">
        <h2>Platform Engineer</h2>
        <a href="https://example.com/careers/jobs/platform-engineer-123">Platform Engineer</a>
      </article>
      <article class="job-result">
        <h2>About us</h2>
        <a href="https://example.com/careers">Careers</a>
      </article>
    `;

    const urls = pickRelevantJobUrls(collectJobDetailCandidates("other_sites"), "other_sites");

    expect(urls).toEqual(["https://example.com/careers/jobs/platform-engineer-123"]);
  });

  it("accepts ATS detail URLs on startup and other job sites but rejects listing pages", () => {
    expect(
      isLikelyJobDetailUrl(
        "startup",
        "https://boards.greenhouse.io/example/jobs/1234567",
        "Front End Engineer"
      )
    ).toBe(true);
    expect(
      isLikelyJobDetailUrl("startup", "https://example.com/careers/jobs", "Open jobs")
    ).toBe(false);
    expect(
      isLikelyJobDetailUrl(
        "startup",
        "https://jobs.ashbyhq.com/ramp/4e64ab86-4e30-403b-b1b9-41dc052570ce",
        "Software Engineer, Frontend"
      )
    ).toBe(true);
    expect(
      isLikelyJobDetailUrl("startup", "https://jobs.ashbyhq.com/ramp", "Open positions")
    ).toBe(false);
    expect(
      isLikelyJobDetailUrl(
        "other_sites",
        "https://example.com/positions/senior-backend-engineer-42",
        "Senior Backend Engineer"
      )
    ).toBe(true);
  });

  it("identifies technical role titles and current-page applied state", () => {
    document.body.innerHTML = `
      <main>
        <h1>Senior React Engineer</h1>
        <p>Application submitted. You applied 2 days ago.</p>
      </main>
    `;

    expect(looksLikeTechnicalRoleTitle("Senior React Engineer")).toBe(true);
    expect(looksLikeTechnicalRoleTitle("Head of People Operations")).toBe(false);
    expect(isCurrentPageAppliedJob("other_sites")).toBe(true);
  });

  it("detects applied-job text without false positives for applied scientist roles", () => {
    expect(
      isAppliedJobText("Application submitted. You applied 2 days ago.")
    ).toBe(true);
    expect(isAppliedJobText("Applied")).toBe(true);
    expect(isAppliedJobText("Previously applied")).toBe(true);
    expect(isAppliedJobText("Applied Scientist, Search Ranking")).toBe(false);
  });

  it("does not treat ZipRecruiter sidebar applied badges as the current job being applied", () => {
    document.body.innerHTML = `
      <aside>
        <article>Applied</article>
        <article>Applied 2 days ago</article>
      </aside>
      <main>
        <h1>Front End Engineer</h1>
        <p>Remote. 1-click apply available.</p>
      </main>
    `;

    expect(isCurrentPageAppliedJob("ziprecruiter")).toBe(false);
    expect(isStrongAppliedJobText("Applied")).toBe(true);
  });

  it("waits for enough job results unless ZipRecruiter or Dice has clearly stabilized", () => {
    expect(shouldFinishJobResultScan(1, 5, 0, 2, "dice")).toBe(false);
    expect(shouldFinishJobResultScan(5, 5, 0, 2, "dice")).toBe(true);
    expect(shouldFinishJobResultScan(3, 5, 5, 8, "ziprecruiter")).toBe(false);
    expect(shouldFinishJobResultScan(3, 5, 6, 8, "ziprecruiter")).toBe(true);
  });
});
