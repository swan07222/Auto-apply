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

  it("collects Indeed candidates without depending on a global Element constructor", () => {
    document.body.innerHTML = `
      <main>
        <article data-jk="alpha123">
          <a class="jcs-JobTitle" href="/rc/clk?jk=alpha123">Software Engineer</a>
        </article>
      </main>
    `;

    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "Element");
    delete (globalThis as Record<string, unknown>).Element;

    try {
      expect(collectJobDetailCandidates("indeed")).toEqual([
        {
          url: "https://example.com/viewjob?jk=alpha123",
          title: "Software Engineer",
          contextText: "Software Engineer",
        },
      ]);
    } finally {
      if (descriptor) {
        Object.defineProperty(globalThis, "Element", descriptor);
      }
    }
  });

  it("keeps candidates when a posted-date filter is requested but the board exposes no recency metadata", () => {
    const candidates: JobCandidate[] = [
      {
        url: "https://example.com/jobs/frontend-engineer-1",
        title: "Frontend Engineer",
        contextText: "Remote role with React and TypeScript.",
      },
      {
        url: "https://example.com/jobs/platform-engineer-2",
        title: "Platform Engineer",
        contextText: "Remote infrastructure role.",
      },
    ];

    expect(
      pickRelevantJobUrls(candidates, "other_sites", undefined, "24h")
    ).toEqual([
      "https://example.com/jobs/frontend-engineer-1",
      "https://example.com/jobs/platform-engineer-2",
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

  it("does not re-filter job-board results by keyword text after the board already ran the search", () => {
    const candidates: JobCandidate[] = [
      {
        url: "https://www.indeed.com/viewjob?jk=alpha123",
        title: "Software Engineer",
        contextText: "Remote role. Posted today.",
      },
      {
        url: "https://www.indeed.com/viewjob?jk=beta456",
        title: "Platform Engineer",
        contextText: "Remote role. Posted today.",
      },
    ];

    expect(
      pickRelevantJobUrls(
        candidates,
        "indeed",
        undefined,
        "any",
        ["react developer"]
      )
    ).toEqual([
      "https://www.indeed.com/viewjob?jk=alpha123",
      "https://www.indeed.com/viewjob?jk=beta456",
    ]);
  });

  it("drops clearly unrelated board results when the current search still exposes strong keyword matches", () => {
    const candidates: JobCandidate[] = [
      {
        url: "https://www.indeed.com/viewjob?jk=frontend123",
        title: "Senior Frontend Engineer",
        contextText: "Remote role. Posted today.",
      },
      {
        url: "https://www.indeed.com/viewjob?jk=sales456",
        title: "Account Executive",
        contextText: "Remote role. Posted today.",
      },
    ];

    expect(
      pickRelevantJobUrls(
        candidates,
        "indeed",
        undefined,
        "any",
        ["frontend engineer"]
      )
    ).toEqual(["https://www.indeed.com/viewjob?jk=frontend123"]);
  });

  it("keeps additional Indeed board results when only one visible card strongly matches the keyword", () => {
    const candidates: JobCandidate[] = [
      {
        url: "https://www.indeed.com/viewjob?jk=frontend123",
        title: "Senior Frontend Engineer",
        contextText: "Remote role. Posted today.",
      },
      {
        url: "https://www.indeed.com/viewjob?jk=platform456",
        title: "Platform Engineer",
        contextText: "Remote role. Posted today.",
      },
      {
        url: "https://www.indeed.com/viewjob?jk=software789",
        title: "Software Engineer",
        contextText: "Remote role. Posted today.",
      },
    ];

    expect(
      pickRelevantJobUrls(
        candidates,
        "indeed",
        undefined,
        "any",
        ["frontend engineer"]
      )
    ).toEqual([
      "https://www.indeed.com/viewjob?jk=frontend123",
      "https://www.indeed.com/viewjob?jk=platform456",
      "https://www.indeed.com/viewjob?jk=software789",
    ]);
  });

  it("dedupes equivalent Indeed tracking and canonical URLs for the same job", () => {
    expect(
      pickRelevantJobUrls(
        [
          {
            url: "https://www.indeed.com/viewjob?jk=alpha123",
            title: "Front End Engineer",
            contextText: "Remote role. Posted today.",
          },
          {
            url: "https://www.indeed.com/rc/clk?jk=alpha123&from=vj",
            title: "Front End Engineer",
            contextText: "Remote role. Posted today.",
          },
          {
            url: "https://www.indeed.com/viewjob?jk=beta456",
            title: "Platform Engineer",
            contextText: "Remote role. Posted today.",
          },
        ],
        "indeed"
      )
    ).toEqual([
      "https://www.indeed.com/viewjob?jk=alpha123",
      "https://www.indeed.com/viewjob?jk=beta456",
    ]);
  });

  it("keeps additional ZipRecruiter board results when only a few visible cards strongly match the keyword", () => {
    const candidates: JobCandidate[] = [
      {
        url: "https://www.ziprecruiter.com/jobs/frontend-1?jid=frontend-1",
        title: "Senior Frontend Engineer",
        contextText: "Remote role. Posted today.",
      },
      {
        url: "https://www.ziprecruiter.com/jobs/frontend-2?jid=frontend-2",
        title: "Frontend Engineer II",
        contextText: "Remote role. Posted today.",
      },
      {
        url: "https://www.ziprecruiter.com/jobs/frontend-3?jid=frontend-3",
        title: "Frontend Platform Engineer",
        contextText: "Remote role. Posted today.",
      },
      {
        url: "https://www.ziprecruiter.com/jobs/software-4?jid=software-4",
        title: "Software Engineer",
        contextText: "Remote role. Posted today.",
      },
      {
        url: "https://www.ziprecruiter.com/jobs/software-5?jid=software-5",
        title: "Software Engineer II",
        contextText: "Remote role. Posted today.",
      },
      {
        url: "https://www.ziprecruiter.com/jobs/platform-6?jid=platform-6",
        title: "Platform Engineer",
        contextText: "Remote role. Posted today.",
      },
    ];

    expect(
      pickRelevantJobUrls(
        candidates,
        "ziprecruiter",
        undefined,
        "any",
        ["frontend engineer"]
      )
    ).toEqual([
      "https://www.ziprecruiter.com/jobs/frontend-1?jid=frontend-1",
      "https://www.ziprecruiter.com/jobs/frontend-2?jid=frontend-2",
      "https://www.ziprecruiter.com/jobs/frontend-3?jid=frontend-3",
      "https://www.ziprecruiter.com/jobs/software-4?jid=software-4",
      "https://www.ziprecruiter.com/jobs/software-5?jid=software-5",
      "https://www.ziprecruiter.com/jobs/platform-6?jid=platform-6",
    ]);
  });

  it("still drops obvious ZipRecruiter outliers when nearly every visible result matches the keyword", () => {
    const candidates: JobCandidate[] = [
      {
        url: "https://www.ziprecruiter.com/jobs/frontend-1?jid=frontend-1",
        title: "Senior Frontend Engineer",
        contextText: "Remote role. Posted today.",
      },
      {
        url: "https://www.ziprecruiter.com/jobs/frontend-2?jid=frontend-2",
        title: "Frontend Engineer II",
        contextText: "Remote role. Posted today.",
      },
      {
        url: "https://www.ziprecruiter.com/jobs/frontend-3?jid=frontend-3",
        title: "Frontend Platform Engineer",
        contextText: "Remote role. Posted today.",
      },
      {
        url: "https://www.ziprecruiter.com/jobs/sales-4?jid=sales-4",
        title: "Account Executive",
        contextText: "Remote role. Posted today.",
      },
    ];

    expect(
      pickRelevantJobUrls(
        candidates,
        "ziprecruiter",
        undefined,
        "any",
        ["frontend engineer"]
      )
    ).toEqual([
      "https://www.ziprecruiter.com/jobs/frontend-1?jid=frontend-1",
      "https://www.ziprecruiter.com/jobs/frontend-2?jid=frontend-2",
      "https://www.ziprecruiter.com/jobs/frontend-3?jid=frontend-3",
    ]);
  });

  it("prefers remote roles over hybrid and onsite roles when the page exposes explicit remote matches", () => {
    const candidates: JobCandidate[] = [
      {
        url: "https://www.ziprecruiter.com/jobs/frontend-1?jid=remote",
        title: "Frontend Engineer",
        contextText: "Remote role. Posted today.",
      },
      {
        url: "https://www.ziprecruiter.com/jobs/frontend-2?jid=hybrid",
        title: "Frontend Engineer",
        contextText: "Hybrid role. Posted today.",
      },
      {
        url: "https://www.ziprecruiter.com/jobs/frontend-3?jid=onsite",
        title: "Frontend Engineer",
        contextText: "Onsite in Phoenix. Posted today.",
      },
    ];

    expect(
      pickRelevantJobUrls(
        candidates,
        "ziprecruiter",
        undefined,
        "any",
        ["frontend engineer"]
      )
    ).toEqual(["https://www.ziprecruiter.com/jobs/frontend-1?jid=remote"]);
  });

  it("requires explicit fully remote signals instead of falling back to ambiguous or hybrid board results", () => {
    const candidates: JobCandidate[] = [
      {
        url: "https://www.dice.com/job-detail/remote-1",
        title: "Frontend Engineer",
        contextText: "Remote role based anywhere in the US.",
      },
      {
        url: "https://www.dice.com/job-detail/hybrid-2",
        title: "Frontend Engineer",
        contextText: "Hybrid role in Phoenix, AZ.",
      },
      {
        url: "https://www.dice.com/job-detail/ambiguous-3",
        title: "Frontend Engineer",
        contextText: "Posted today.",
      },
    ];

    expect(
      pickRelevantJobUrls(
        candidates,
        "dice",
        undefined,
        "any",
        ["frontend engineer"]
      )
    ).toEqual(["https://www.dice.com/job-detail/remote-1"]);
  });

  it("returns no job pages when none of the visible candidates are explicitly fully remote", () => {
    const candidates: JobCandidate[] = [
      {
        url: "https://www.dice.com/job-detail/hybrid-2",
        title: "Frontend Engineer",
        contextText: "Hybrid role in Phoenix, AZ.",
      },
      {
        url: "https://www.dice.com/job-detail/onsite-3",
        title: "Frontend Engineer",
        contextText: "Onsite role in Dallas, TX.",
      },
      {
        url: "https://www.dice.com/job-detail/ambiguous-4",
        title: "Frontend Engineer",
        contextText: "Posted today.",
      },
    ];

    expect(
      pickRelevantJobUrls(
        candidates,
        "dice",
        undefined,
        "any",
        ["frontend engineer"]
      )
    ).toEqual([]);
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

  it("accepts Glassdoor detail URLs and rejects search listings", () => {
    expect(
      isLikelyJobDetailUrl(
        "glassdoor",
        "https://www.glassdoor.com/job-listing/software-engineer-frontend-ivo-ai-inc-JV_IC1147401_KO0,26_KE27,37.htm?jl=1010069347428",
        "Software Engineer, Frontend"
      )
    ).toBe(true);

    expect(
      isLikelyJobDetailUrl(
        "glassdoor",
        "https://www.glassdoor.com/Job/jobs.htm?sc.keyword=remote%20front%20end%20developer&locT=N&locId=1",
        "Front End Developer Jobs"
      )
    ).toBe(false);
  });

  it("canonicalizes Indeed data-jk cards instead of trusting tracking anchors", () => {
    document.body.innerHTML = `
      <article class="job_seen_beacon" data-jk="alpha123">
        <h2>Full Stack Engineer</h2>
        <a href="https://www.indeed.com/pagead/clk?url=https%3A%2F%2Fwww.indeed.com%2Flegal">
          Full Stack Engineer
        </a>
      </article>
      <article class="job_seen_beacon" data-jk="beta456">
        <h2>Platform Engineer</h2>
        <a href="https://www.indeed.com/rc/clk?jk=beta456&from=vj">
          Platform Engineer
        </a>
      </article>
    `;

    const urls = pickRelevantJobUrls(collectJobDetailCandidates("indeed"), "indeed");

    expect(urls).toHaveLength(2);
    expect(urls.map((url) => new URL(url).pathname)).toEqual([
      "/viewjob",
      "/viewjob",
    ]);
    expect(urls.map((url) => new URL(url).searchParams.get("jk"))).toEqual([
      "alpha123",
      "beta456",
    ]);
  });

  it("rejects Indeed tracking links that do not carry a real job key", () => {
    expect(
      isLikelyJobDetailUrl(
        "indeed",
        "https://www.indeed.com/pagead/clk?url=https%3A%2F%2Fwww.indeed.com%2Flegal",
        "Full Stack Engineer"
      )
    ).toBe(false);
    expect(
      isLikelyJobDetailUrl(
        "indeed",
        "https://www.indeed.com/rc/clk?jk=alpha123&from=vj",
        "Full Stack Engineer"
      )
    ).toBe(true);
  });

  it("collects Glassdoor job cards while skipping listing links", () => {
    document.body.innerHTML = `
      <article data-test="jobListing">
        <h2>Software Engineer, Frontend</h2>
        <a
          data-test="job-link"
          href="https://www.glassdoor.com/job-listing/software-engineer-frontend-ivo-ai-inc-JV_IC1147401_KO0,26_KE27,37.htm?jl=1010069347428"
        >
          Easy Apply
        </a>
      </article>
      <article>
        <h2>Browse all jobs</h2>
        <a href="https://www.glassdoor.com/Job/jobs.htm?sc.keyword=frontend">View jobs</a>
      </article>
    `;

    const urls = pickRelevantJobUrls(collectJobDetailCandidates("glassdoor"), "glassdoor");

    expect(urls).toEqual([
      "https://www.glassdoor.com/job-listing/software-engineer-frontend-ivo-ai-inc-JV_IC1147401_KO0,26_KE27,37.htm?jl=1010069347428",
    ]);
  });

  it("keeps Dice remote card context when the title link sits inside a small inner wrapper", () => {
    document.body.innerHTML = `
      <ul aria-label="Job search results">
        <li>
          <div class="card-shell">
            <a
              data-testid="job-search-job-card-link"
              href="https://www.dice.com/job-detail/remote-1"
            ></a>
            <div class="card-header">
              <a
                data-testid="job-search-job-detail-link"
                href="https://www.dice.com/job-detail/remote-1"
              >
                Space Force Software Engineer
              </a>
            </div>
            <p>Remote or Scottsdale, Arizona</p>
            <p>Today</p>
          </div>
        </li>
        <li>
          <div class="card-shell">
            <a
              data-testid="job-search-job-card-link"
              href="https://www.dice.com/job-detail/hybrid-2"
            ></a>
            <div class="card-header">
              <a
                data-testid="job-search-job-detail-link"
                href="https://www.dice.com/job-detail/hybrid-2"
              >
                Software Engineer
              </a>
            </div>
            <p>Remote or Hybrid in Denver, Colorado</p>
            <p>23d ago</p>
          </div>
        </li>
      </ul>
    `;

    const candidates = collectJobDetailCandidates("dice");
    const remoteCandidate = candidates.find((candidate) =>
      candidate.url.endsWith("/remote-1")
    );

    expect(remoteCandidate?.contextText).toContain("Remote or Scottsdale, Arizona");
    expect(pickRelevantJobUrls(candidates, "dice")).toEqual([
      "https://www.dice.com/job-detail/remote-1",
    ]);
  });

  it("does not collect Dice cards that are already applied", () => {
    document.body.innerHTML = `
      <ul aria-label="Job search results">
        <li>
          <div class="card-shell">
            <a
              data-testid="job-search-job-detail-link"
              href="https://www.dice.com/job-detail/applied-1"
            >
              Senior Software Engineer
            </a>
            <p>Remote</p>
            <p>Application submitted. You applied 2 days ago.</p>
          </div>
        </li>
        <li>
          <div class="card-shell">
            <a
              data-testid="job-search-job-detail-link"
              href="https://www.dice.com/job-detail/fresh-2"
            >
              Staff Platform Engineer
            </a>
            <p>Remote</p>
            <p>Posted today</p>
          </div>
        </li>
      </ul>
    `;

    expect(pickRelevantJobUrls(collectJobDetailCandidates("dice"), "dice")).toEqual([
      "https://www.dice.com/job-detail/fresh-2",
    ]);
  });

  it("skips Dice cards whose title is visually marked as viewed or applied", () => {
    document.body.innerHTML = `
      <ul aria-label="Job search results">
        <li>
          <div class="card-shell viewed">
            <a
              data-testid="job-search-job-detail-link"
              href="https://www.dice.com/job-detail/viewed-1"
              style="color: rgb(124, 58, 237);"
            >
              Viewed Staff Engineer
            </a>
            <p>Remote</p>
          </div>
        </li>
        <li>
          <div class="card-shell">
            <a
              data-testid="job-search-job-detail-link"
              href="https://www.dice.com/job-detail/fresh-2"
              style="color: rgb(17, 24, 39);"
            >
              Fresh Platform Engineer
            </a>
            <p>Remote</p>
          </div>
        </li>
      </ul>
    `;

    expect(pickRelevantJobUrls(collectJobDetailCandidates("dice"), "dice")).toEqual([
      "https://www.dice.com/job-detail/fresh-2",
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

  it("prefers focused startup ATS link context over giant listing-section blobs", () => {
    document.body.innerHTML = `
      <section class="current-openings">
        <a href="https://my.greenhouse.io/users/sign_in?job_board=vercel&source=job_alert_board">
          Create alert
        </a>
        <a href="https://job-boards.greenhouse.io/vercel/jobs/5431123004">
          Software Engineer, Accounts Remote - United States
        </a>
        <a href="https://job-boards.greenhouse.io/vercel/jobs/5798406004">
          Software Engineer, AI Gateway Hybrid - San Francisco
        </a>
      </section>
    `;

    const urls = pickRelevantJobUrls(collectJobDetailCandidates("startup"), "startup");

    expect(urls).toEqual([
      "https://job-boards.greenhouse.io/vercel/jobs/5431123004",
    ]);
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

  it("keeps startup and other-site fallback scans focused on technical roles even without a selected track", () => {
    const candidates: JobCandidate[] = [
      {
        url: "https://example.com/jobs/frontend-engineer-1",
        title: "Frontend Engineer",
        contextText: "Posted today.",
      },
      {
        url: "https://example.com/jobs/recruiter-2",
        title: "Technical Recruiter",
        contextText: "Posted today.",
      },
    ];

    expect(pickRelevantJobUrls(candidates, "startup")).toEqual([
      "https://example.com/jobs/frontend-engineer-1",
    ]);
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

  it("does not treat active Indeed SmartApply review steps as already applied", () => {
    window.history.replaceState({}, "", "/beta/indeedapply/form/review-module");

    document.body.innerHTML = `
      <main>
        <div>Step 2 of 2</div>
        <h1>Please review your application</h1>
        <button type="button">Back</button>
        <button type="submit">Submit</button>
        <p>Already applied with your Indeed resume</p>
      </main>
    `;

    expect(isCurrentPageAppliedJob("indeed")).toBe(false);
  });

  it("still treats Indeed SmartApply confirmation pages as applied", () => {
    window.history.replaceState({}, "", "/beta/indeedapply/form/review-module");

    document.body.innerHTML = `
      <main>
        <h1>Your application has been submitted</h1>
        <p>Thanks for applying.</p>
      </main>
    `;

    expect(isCurrentPageAppliedJob("indeed")).toBe(true);
  });

  it("waits for enough job results until slower boards exhaust their later recovery passes", () => {
    expect(shouldFinishJobResultScan(1, 5, 0, 2, "dice")).toBe(false);
    expect(shouldFinishJobResultScan(5, 5, 0, 2, "dice")).toBe(true);
    expect(shouldFinishJobResultScan(4, 8, 6, 5, "indeed")).toBe(false);
    expect(shouldFinishJobResultScan(4, 8, 6, 12, "indeed")).toBe(true);
    expect(shouldFinishJobResultScan(3, 5, 6, 8, "ziprecruiter")).toBe(false);
    expect(shouldFinishJobResultScan(3, 5, 7, 14, "ziprecruiter")).toBe(false);
    expect(shouldFinishJobResultScan(3, 5, 8, 14, "ziprecruiter")).toBe(true);
    expect(shouldFinishJobResultScan(2, 5, 7, 20, "startup")).toBe(false);
    expect(shouldFinishJobResultScan(2, 5, 8, 22, "startup")).toBe(true);
  });

  it("marks embedded Monster results as applied when the page-state record says so", () => {
    const urls = pickRelevantJobUrls(
      collectMonsterEmbeddedCandidates([
        {
          canonicalUrl: "https://www.monster.com/job-openings/frontend-engineer-remote--alpha123",
          normalizedJobPosting: {
            title: "Frontend Engineer",
            hiringOrganization: { name: "Example Corp" },
          },
          applicationStatus: "Already applied",
        },
        {
          canonicalUrl: "https://www.monster.com/job-openings/backend-engineer-remote--beta456",
          normalizedJobPosting: {
            title: "Backend Engineer",
            hiringOrganization: { name: "Example Corp" },
          },
        },
      ]),
      "monster"
    );

    expect(urls).toEqual([
      "https://www.monster.com/job-openings/backend-engineer-remote--beta456",
    ]);
  });
});
