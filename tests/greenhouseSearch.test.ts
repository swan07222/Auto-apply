import {
  findMyGreenhouseKeywordInput,
  findMyGreenhouseLocationControl,
  findMyGreenhouseLocationOption,
  findMyGreenhouseLocationOverlayInput,
  findMyGreenhouseRemoteOption,
  findMyGreenhouseSearchButton,
  findMyGreenhouseWorkTypeButton,
  getMyGreenhouseControlValue,
  isMyGreenhouseRemoteOptionSelected,
} from "../src/content/greenhouseSearch";

describe("greenhouse search helpers", () => {
  it("finds button-style location and work-type filters on the search surface", () => {
    document.body.innerHTML = `
      <main>
        <input type="search" placeholder="Search jobs" value="platform engineer remote" />
        <button type="button" aria-label="Location filter">United States</button>
        <button type="button" aria-label="Job Type">Job Type</button>
        <button type="button" aria-label="Search jobs">Search</button>
      </main>
    `;

    expect(findMyGreenhouseKeywordInput()?.value).toBe("platform engineer remote");
    expect(getMyGreenhouseControlValue(findMyGreenhouseLocationControl())).toBe(
      "United States"
    );
    expect(findMyGreenhouseWorkTypeButton()?.getAttribute("aria-label")).toBe(
      "Job Type"
    );
    expect(findMyGreenhouseSearchButton()?.getAttribute("aria-label")).toBe(
      "Search jobs"
    );
  });

  it("finds overlay-based location and remote options without confusing job-result cards", () => {
    document.body.innerHTML = `
      <main>
        <article class="job-card">
          <a href="/view_job?job_id=123">Backend Engineer</a>
          <p>Remote - United States</p>
        </article>
        <div role="dialog">
          <input aria-label="Search location" value="" />
          <div role="listbox">
            <div role="option">United States</div>
          </div>
        </div>
        <div role="menu">
          <button type="button" role="menuitemcheckbox" aria-checked="false">
            Remote only
          </button>
        </div>
      </main>
    `;

    expect(findMyGreenhouseLocationOverlayInput()?.getAttribute("aria-label")).toBe(
      "Search location"
    );
    expect(findMyGreenhouseLocationOption("United States", true)?.textContent).toContain(
      "United States"
    );
    expect(findMyGreenhouseRemoteOption(true)?.textContent).toContain("Remote only");
  });

  it("keeps shadow-root MyGreenhouse filters discoverable", () => {
    const host = document.createElement("section");
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `
      <button type="button" aria-label="Location filter">United States</button>
    `;
    document.body.appendChild(host);

    expect(getMyGreenhouseControlValue(findMyGreenhouseLocationControl())).toBe(
      "United States"
    );
  });

  it("reads selected remote options from aria state", () => {
    document.body.innerHTML = `
      <div role="menu">
        <button type="button" role="menuitemcheckbox" aria-checked="true">
          Remote only
        </button>
      </div>
    `;

    const remoteOption = findMyGreenhouseRemoteOption(true);
    expect(remoteOption).not.toBeNull();
    expect(isMyGreenhouseRemoteOptionSelected(remoteOption as HTMLElement)).toBe(
      true
    );
  });
});
