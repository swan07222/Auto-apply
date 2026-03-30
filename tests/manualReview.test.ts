// Note: describe, expect, it are provided globally by vitest (globals: true)

import {
  findVisibleManualSubmitAction,
  hasEditableAutofillFields,
  hasPendingRequiredAutofillFields,
  hasVisibleManualSubmitAction,
  isLikelyManualProgressionActionTarget,
  isLikelyManualSubmitReviewPage,
  resolveReadyManualSubmitActionForFormEvent,
  shouldTreatManualSubmitActionAsReady,
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

  it("treats continue-style controls as manual progression but ignores framework labels", () => {
    document.body.innerHTML = `
      <main>
        <button id="continue">Continue</button>
        <a id="framework" href="https://nextjs.org/">Next.js</a>
      </main>
    `;

    expect(
      isLikelyManualProgressionActionTarget(document.querySelector("#continue"))
    ).toBe(true);
    expect(
      isLikelyManualProgressionActionTarget(document.querySelector("#framework"))
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

  it("detects required application fields that still need manual input", () => {
    document.body.innerHTML = `
      <form>
        <label for="job-title">Job title *</label>
        <input id="job-title" type="text" required />
        <label for="company">Company *</label>
        <input id="company" type="text" required value="Acme" />
      </form>
    `;

    const jobTitle = document.querySelector("#job-title") as HTMLInputElement;
    const company = document.querySelector("#company") as HTMLInputElement;

    expect(hasPendingRequiredAutofillFields([jobTitle, company])).toBe(true);

    jobTitle.value = "Senior Engineer";
    expect(hasPendingRequiredAutofillFields([jobTitle, company])).toBe(false);
  });

  it("ignores hidden required fields outside the active step", () => {
    document.body.innerHTML = `
      <form>
        <div>
          <label for="email">Email *</label>
          <input id="email" type="email" required value="dev@example.com" />
        </div>
        <div>
          <label for="future-step" style="display: none;">Future step question *</label>
          <input id="future-step" type="text" required style="display: none;" />
        </div>
      </form>
    `;

    const email = document.querySelector("#email") as HTMLInputElement;
    const futureStep = document.querySelector(
      "#future-step"
    ) as HTMLInputElement;

    expect(hasPendingRequiredAutofillFields([email, futureStep])).toBe(false);
  });

  it("recognizes final review pages with manual submit actions", () => {
    document.body.innerHTML = `
      <main>
        <h1>Please review your application</h1>
        <p>You will not be able to make changes after you submit your application.</p>
        <button type="submit" disabled>Submit your application</button>
      </main>
    `;

    expect(hasVisibleManualSubmitAction()).toBe(true);
    expect(isLikelyManualSubmitReviewPage()).toBe(true);
  });

  it("returns the visible manual submit control when one is present", () => {
    document.body.innerHTML = `
      <main>
        <button type="button">Continue</button>
        <button id="submit" type="submit">Submit application</button>
      </main>
    `;

    expect(findVisibleManualSubmitAction()?.id).toBe("submit");
  });

  it("does not treat submit clicks as ready when required fields are still empty", () => {
    document.body.innerHTML = `
      <form>
        <label for="full-name">Full name *</label>
        <input id="full-name" type="text" required />
        <button id="submit" type="submit">Submit application</button>
      </form>
    `;

    const fullName = document.querySelector("#full-name") as HTMLInputElement;
    const submit = document.querySelector("#submit") as HTMLButtonElement;

    expect(
      shouldTreatManualSubmitActionAsReady(submit, [fullName])
    ).toBe(false);
  });

  it("does not treat submit clicks as ready when visible invalid flags are present", () => {
    document.body.innerHTML = `
      <form>
        <label for="email">Email *</label>
        <input
          id="email"
          type="email"
          required
          value="not-an-email"
          aria-invalid="true"
        />
        <button id="submit" type="submit">Submit application</button>
      </form>
    `;

    const email = document.querySelector("#email") as HTMLInputElement;
    const submit = document.querySelector("#submit") as HTMLButtonElement;

    expect(
      shouldTreatManualSubmitActionAsReady(submit, [email])
    ).toBe(false);
  });

  it("allows submit clicks when the visible step looks valid", () => {
    document.body.innerHTML = `
      <form>
        <label for="full-name">Full name *</label>
        <input id="full-name" type="text" required value="Ada Lovelace" />
        <button id="submit" type="submit">Submit application</button>
      </form>
    `;

    const fullName = document.querySelector("#full-name") as HTMLInputElement;
    const submit = document.querySelector("#submit") as HTMLButtonElement;

    expect(
      shouldTreatManualSubmitActionAsReady(submit, [fullName])
    ).toBe(true);
  });

  it("treats accepted Ashby-style resume widgets as ready for manual submit", () => {
    document.body.innerHTML = `
      <form>
        <label for="resume">Resume/CV *</label>
        <input id="resume" type="file" required />
        <div class="ashby-upload-widget">
          <span>Resume/CV</span>
          <button type="button">Replace file</button>
          <button type="button">Remove file</button>
        </div>
        <button id="submit" type="submit">Submit application</button>
      </form>
    `;

    const resume = document.querySelector("#resume") as HTMLInputElement;
    const submit = document.querySelector("#submit") as HTMLButtonElement;

    expect(hasPendingRequiredAutofillFields([resume])).toBe(false);
    expect(
      shouldTreatManualSubmitActionAsReady(submit, [resume])
    ).toBe(true);
  });

  it("does not fall back to a visible final submit button when a non-submit continue button triggered the form submit", () => {
    document.body.innerHTML = `
      <form id="application-form">
        <label for="full-name">Full name *</label>
        <input id="full-name" type="text" required value="Ada Lovelace" />
        <button id="continue" type="submit">Continue</button>
        <button id="submit" type="submit">Submit application</button>
      </form>
    `;

    const form = document.querySelector("#application-form") as HTMLFormElement;
    const fullName = document.querySelector("#full-name") as HTMLInputElement;
    const continueButton = document.querySelector(
      "#continue"
    ) as HTMLButtonElement;

    expect(
      resolveReadyManualSubmitActionForFormEvent(form, continueButton, [fullName])
    ).toBeNull();
  });

  it("uses the visible manual submit button when the form submit event has no explicit submitter", () => {
    document.body.innerHTML = `
      <form id="application-form">
        <label for="full-name">Full name *</label>
        <input id="full-name" type="text" required value="Ada Lovelace" />
        <button id="submit" type="submit">Submit application</button>
      </form>
    `;

    const form = document.querySelector("#application-form") as HTMLFormElement;
    const fullName = document.querySelector("#full-name") as HTMLInputElement;

    expect(
      resolveReadyManualSubmitActionForFormEvent(form, null, [fullName])?.id
    ).toBe("submit");
  });
});
