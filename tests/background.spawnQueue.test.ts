import { deduplicateSpawnItems } from "../src/background/spawnQueue";

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
});
