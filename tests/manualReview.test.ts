import { describe, expect, it } from "vitest";

import {
  hasEditableAutofillFields,
  shouldPauseAutomationForManualReview,
  shouldStartManualReviewPause,
} from "../src/content/manualReview";

describe("manual review helpers", () => {
  it("starts a pause for in-form back and edit actions but ignores navigation chrome", () => {
    document.body.innerHTML = `
      <main>
        <button id="back">Back</button>
        <button id="edit">Edit answers</button>
        <button id="results">Back to search</button>
      </main>
    `;

    expect(shouldStartManualReviewPause(document.querySelector("#back"))).toBe(
      true
    );
    expect(shouldStartManualReviewPause(document.querySelector("#edit"))).toBe(
      true
    );
    expect(
      shouldStartManualReviewPause(document.querySelector("#results"))
    ).toBe(false);
  });

  it("holds automation only while there are editable autofill fields", () => {
    document.body.innerHTML = `
      <form>
        <input id="full-name" aria-label="Full name" />
        <input id="search" type="search" aria-label="Search jobs" />
      </form>
    `;

    const fullName = document.querySelector("#full-name") as HTMLInputElement;
    const search = document.querySelector("#search") as HTMLInputElement;

    expect(hasEditableAutofillFields([fullName, search])).toBe(true);
    expect(
      shouldPauseAutomationForManualReview(Date.now() + 5_000, [
        fullName,
        search,
      ])
    ).toBe(true);
    expect(
      shouldPauseAutomationForManualReview(Date.now() - 1, [fullName, search])
    ).toBe(false);
  });

  it("treats preselected selects as editable review fields", () => {
    document.body.innerHTML = `
      <form>
        <label for="work-auth">Work authorization *</label>
        <select id="work-auth">
          <option value="">Select one</option>
          <option value="citizen" selected>US Citizen</option>
        </select>
      </form>
    `;

    const workAuth = document.querySelector("#work-auth") as HTMLSelectElement;

    expect(hasEditableAutofillFields([workAuth])).toBe(true);
    expect(
      shouldPauseAutomationForManualReview(Date.now() + 5_000, [workAuth])
    ).toBe(true);
  });
});
