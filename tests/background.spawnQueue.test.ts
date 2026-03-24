import { deduplicateSpawnItems, pickUniqueCandidateUrls } from "../src/background/spawnQueue";
import { getJobDedupKey } from "../src/shared";

describe("background spawn queue helpers", () => {
  it("deduplicates spawn items while preserving separate search targets and aggregating slots", () => {
    expect(
      deduplicateSpawnItems(
        [
          {
            url: "https://www.indeed.com/viewjob?jk=alpha123",
            site: "indeed",
            jobSlots: 1,
          },
          {
            url: "https://www.indeed.com/viewjob?jk=alpha123",
            site: "indeed",
            jobSlots: 2,
          },
          {
            url: "https://www.indeed.com/jobs?q=platform+engineer&start=10",
            site: "indeed",
            jobSlots: 1,
          },
        ],
        2
      )
    ).toEqual([
      {
        url: "https://www.indeed.com/viewjob?jk=alpha123",
        site: "indeed",
        jobSlots: 2,
      },
      {
        url: "https://www.indeed.com/jobs?q=platform+engineer&start=10",
        site: "indeed",
        jobSlots: 1,
      },
    ]);
  });

  it("picks unique candidate urls by canonical job key and skips reviewed items", () => {
    const reviewedUrl = "https://www.indeed.com/viewjob?jk=alpha123";
    const freshUrl = "https://www.indeed.com/viewjob?jk=beta456";

    expect(
      pickUniqueCandidateUrls(
        [
          { url: reviewedUrl, key: getJobDedupKey(reviewedUrl)! },
          {
            url: "https://www.indeed.com/rc/clk?jk=alpha123&from=vj",
            key: getJobDedupKey(reviewedUrl)!,
          },
          { url: freshUrl, key: getJobDedupKey(freshUrl)! },
        ],
        3,
        new Set([getJobDedupKey(reviewedUrl)!])
      )
    ).toEqual([freshUrl]);
  });
});
