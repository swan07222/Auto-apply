import { describe, expect, it } from "vitest";

import {
  findCompanySiteAction,
  findProgressionAction,
} from "../src/content/apply";

describe("application progression actions", () => {
  it("treats same-page Indeed review anchors as click actions", () => {
    window.history.replaceState({}, "", "/apply");
    document.body.innerHTML = `
      <form>
        <a href="#" data-testid="review-step-link">Review application</a>
      </form>
    `;

    const action = findProgressionAction("indeed");

    expect(action).not.toBeNull();
    expect(action?.type).toBe("click");
    expect(action?.text).toBe("Review application");
  });

  it("finds ZipRecruiter progression buttons after autofill", () => {
    document.body.innerHTML = `
      <form>
        <button type="button" data-testid="next-step">Next</button>
      </form>
    `;

    const action = findProgressionAction("ziprecruiter");

    expect(action).not.toBeNull();
    expect(action?.type).toBe("click");
    expect(action?.text).toBe("Next");
  });

  it("ignores final submit buttons when looking for progression", () => {
    document.body.innerHTML = `
      <form>
        <button type="submit">Submit application</button>
      </form>
    `;

    expect(findProgressionAction("indeed")).toBeNull();
  });

  it("finds external company-site continuation links", () => {
    document.body.innerHTML = `
      <section>
        <p>You will be redirected to the company website to apply.</p>
        <a href="https://company.example.com/careers/apply">Apply on company site</a>
      </section>
    `;

    const action = findCompanySiteAction();

    expect(action).not.toBeNull();
    expect(action?.type).toBe("navigate");
    if (action?.type === "navigate") {
      expect(action.url).toBe("https://company.example.com/careers/apply");
    }
  });
});
