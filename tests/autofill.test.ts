// Note: describe, expect, it are provided globally by vitest (globals: true)
// vi must be imported for mocking
import { vi } from "vitest";

import {
  getAssociatedLabelText,
  getFieldDescriptor,
  getOptionLabelText,
  getQuestionText,
  isConsentField,
  isFieldRequired,
  isSelectBlank,
  isTextLikeInput,
  matchesDescriptor,
  normalizeBooleanAnswer,
  readFieldAnswerForMemory,
  scoreChoiceMatch,
  setFieldValue,
  shouldAutofillField,
  shouldOverwriteAutofillValue,
  shouldRememberField,
} from "../src/content/autofill";

describe("autofill helpers", () => {
  it("reads question text from legends, labelled-by text, and labels", () => {
    document.body.innerHTML = `
      <form>
        <fieldset>
          <legend>Work authorization</legend>
          <input id="authorization" type="text" />
        </fieldset>
        <div>
          <span id="question">Years of experience</span>
          <input id="experience" type="number" aria-labelledby="question" />
        </div>
        <label for="linkedin">LinkedIn profile</label>
        <input id="linkedin" type="url" />
      </form>
    `;

    expect(getQuestionText(document.querySelector("#authorization") as HTMLInputElement)).toBe(
      "Work authorization"
    );
    expect(getQuestionText(document.querySelector("#experience") as HTMLInputElement)).toBe(
      "Years of experience"
    );
    expect(getQuestionText(document.querySelector("#linkedin") as HTMLInputElement)).toBe(
      "LinkedIn profile"
    );
  });

  it("builds descriptors and label text from surrounding markup", () => {
    document.body.innerHTML = `
      <label for="portfolio">Portfolio URL</label>
      <input
        id="portfolio"
        name="portfolio_url"
        type="url"
        placeholder="https://example.com"
        autocomplete="url"
      />
      <label>
        Remote only
        <input id="remote-only" type="checkbox" />
      </label>
    `;

    const portfolio = document.querySelector("#portfolio") as HTMLInputElement;
    const remoteOnly = document.querySelector("#remote-only") as HTMLInputElement;

    expect(getAssociatedLabelText(portfolio)).toBe("Portfolio URL");
    expect(getFieldDescriptor(portfolio, getQuestionText(portfolio))).toContain("portfolio url");
    expect(getOptionLabelText(remoteOnly)).toContain("Remote only");
  });

  it("accepts required application fields and skips optional, search, or sensitive inputs", () => {
    document.body.innerHTML = `
      <form>
        <label for="keywords">Search jobs</label>
        <input id="keywords" name="keywords" type="search" />

        <label for="resume">Resume</label>
        <input id="resume" type="file" />

        <label for="password">Password</label>
        <input id="password" name="password" type="password" />

        <label for="country">Country</label>
        <select id="country">
          <option value="">Select one</option>
          <option value="us">United States</option>
        </select>

        <label for="authorized">Work authorization *</label>
        <select id="authorized">
          <option value="">Select one</option>
          <option value="yes">Authorized</option>
        </select>
      </form>
    `;

    expect(shouldAutofillField(document.querySelector("#keywords") as HTMLInputElement)).toBe(
      false
    );
    expect(shouldAutofillField(document.querySelector("#resume") as HTMLInputElement)).toBe(true);
    expect(shouldAutofillField(document.querySelector("#password") as HTMLInputElement)).toBe(
      false
    );
    expect(shouldAutofillField(document.querySelector("#country") as HTMLSelectElement)).toBe(
      false
    );
    expect(
      shouldAutofillField(document.querySelector("#country") as HTMLSelectElement, false, true)
    ).toBe(true);
    expect(shouldAutofillField(document.querySelector("#authorized") as HTMLSelectElement)).toBe(
      true
    );
  });

  it("treats fields marked optional in the label or container as non-required", () => {
    document.body.innerHTML = `
      <form>
        <div class="application-question optional">
          <label for="linkedin">LinkedIn profile (optional)</label>
          <input id="linkedin" type="url" />
        </div>

        <div class="application-question">
          <label for="portfolio">Portfolio</label>
          <input id="portfolio" type="url" aria-required="false" />
        </div>

        <div class="application-question required">
          <label for="email">Email</label>
          <input id="email" type="email" required />
        </div>
      </form>
    `;

    expect(isFieldRequired(document.querySelector("#linkedin") as HTMLInputElement)).toBe(false);
    expect(shouldAutofillField(document.querySelector("#linkedin") as HTMLInputElement)).toBe(
      false
    );
    expect(isFieldRequired(document.querySelector("#portfolio") as HTMLInputElement)).toBe(false);
    expect(shouldAutofillField(document.querySelector("#portfolio") as HTMLInputElement)).toBe(
      false
    );
    expect(isFieldRequired(document.querySelector("#email") as HTMLInputElement)).toBe(true);
    expect(shouldAutofillField(document.querySelector("#email") as HTMLInputElement)).toBe(true);
  });

  it("detects blank selects and text-like input types", () => {
    document.body.innerHTML = `
      <form>
        <label for="state">State</label>
        <select id="state">
          <option value="">Choose one</option>
          <option value="az">Arizona</option>
        </select>
        <label for="phone">Phone</label>
        <input id="phone" type="tel" />
        <label for="avatar">Avatar</label>
        <input id="avatar" type="file" />
      </form>
    `;

    const select = document.querySelector("#state") as HTMLSelectElement;
    const phone = document.querySelector("#phone") as HTMLInputElement;
    const avatar = document.querySelector("#avatar") as HTMLInputElement;

    expect(isSelectBlank(select)).toBe(true);
    select.selectedIndex = 1;
    expect(isSelectBlank(select)).toBe(false);
    expect(isTextLikeInput(phone)).toBe(true);
    expect(isTextLikeInput(avatar)).toBe(false);
  });

  it("allows stable profile fields to overwrite stale prefilled values", () => {
    document.body.innerHTML = `
      <form>
        <label for="email">Email</label>
        <input id="email" type="email" value="old@example.com" />

        <label for="country">Country</label>
        <select id="country">
          <option value="ca" selected>Canada</option>
          <option value="us">United States</option>
        </select>

        <label for="motivation">Why do you want this role?</label>
        <textarea id="motivation">Old answer</textarea>
      </form>
    `;

    expect(
      shouldOverwriteAutofillValue(
        document.querySelector("#email") as HTMLInputElement,
        "ada@example.com"
      )
    ).toBe(true);
    expect(
      shouldOverwriteAutofillValue(
        document.querySelector("#country") as HTMLSelectElement,
        "United States"
      )
    ).toBe(true);
    expect(
      shouldOverwriteAutofillValue(
        document.querySelector("#motivation") as HTMLTextAreaElement,
        "Mission fit."
      )
    ).toBe(false);
  });

  it("sets field values and emits input, change, and blur events", () => {
    document.body.innerHTML = `
      <label for="city">City</label>
      <input id="city" type="text" />
    `;

    const input = document.querySelector("#city") as HTMLInputElement;
    const inputSpy = vi.fn();
    const changeSpy = vi.fn();
    const blurSpy = vi.fn();

    input.addEventListener("input", inputSpy);
    input.addEventListener("change", changeSpy);
    input.addEventListener("blur", blurSpy);

    setFieldValue(input, "Phoenix");

    expect(input.value).toBe("Phoenix");
    expect(inputSpy).toHaveBeenCalledTimes(1);
    expect(changeSpy).toHaveBeenCalledTimes(1);
    expect(blurSpy).toHaveBeenCalledTimes(1);
  });

  it("scores answer choices and normalizes boolean answers", () => {
    expect(scoreChoiceMatch("Yes", "yes I am authorized")).toBe(80);
    expect(scoreChoiceMatch("Remote", "remote only")).toBe(70);
    expect(scoreChoiceMatch("Senior", "Senior")).toBe(100);
    expect(scoreChoiceMatch("No", "requires sponsorship")).toBe(0);

    expect(normalizeBooleanAnswer("authorized")).toBe(true);
    expect(normalizeBooleanAnswer("not authorized")).toBe(false);
    expect(normalizeBooleanAnswer("maybe")).toBeNull();

    expect(matchesDescriptor("work authorization status", ["authorization", "visa"])).toBe(true);
  });

  it("detects consent fields and only remembers custom answers", () => {
    document.body.innerHTML = `
      <form>
        <label for="terms">I agree to the privacy policy</label>
        <input id="terms" type="checkbox" />

        <label for="full-name">Full name</label>
        <input id="full-name" type="text" />

        <label for="essay">Why do you want this role?</label>
        <textarea id="essay"></textarea>
      </form>
    `;

    const consent = document.querySelector("#terms") as HTMLInputElement;
    const fullName = document.querySelector("#full-name") as HTMLInputElement;
    const essay = document.querySelector("#essay") as HTMLTextAreaElement;

    expect(isConsentField(consent)).toBe(true);
    expect(shouldRememberField(fullName)).toBe(false);
    expect(shouldRememberField(essay)).toBe(true);
  });

  it("detects required fields from attributes and greenhouse-style markers", () => {
    document.body.innerHTML = `
      <form>
        <div class="field required">
          <label for="first-name">First Name <span class="asterisk">*</span></label>
          <input id="first-name" name="job_application[first_name]" type="text" />
        </div>

        <label for="email">Email</label>
        <input id="email" type="email" aria-required="true" />

        <label for="city">City</label>
        <input id="city" type="text" />
      </form>
    `;

    expect(isFieldRequired(document.querySelector("#first-name") as HTMLInputElement)).toBe(true);
    expect(isFieldRequired(document.querySelector("#email") as HTMLInputElement)).toBe(true);
    expect(isFieldRequired(document.querySelector("#city") as HTMLInputElement)).toBe(false);
  });

  it("reads saved answers from text, select, radio, checkbox, and textarea fields", () => {
    document.body.innerHTML = `
      <form>
        <label for="portfolio">Portfolio</label>
        <input id="portfolio" type="url" value="https://example.com" />

        <label for="country">Country</label>
        <select id="country">
          <option value="">Select one</option>
          <option value="us" selected>United States</option>
        </select>

        <label for="authorized-yes">Yes</label>
        <input id="authorized-yes" name="authorized" type="radio" value="yes" checked />

        <label for="subscribe">Subscribe</label>
        <input id="subscribe" type="checkbox" checked />

        <label for="essay">Motivation</label>
        <textarea id="essay">I like product work.</textarea>
      </form>
    `;

    expect(readFieldAnswerForMemory(document.querySelector("#portfolio") as HTMLInputElement)).toBe(
      "https://example.com"
    );
    expect(readFieldAnswerForMemory(document.querySelector("#country") as HTMLSelectElement)).toBe(
      "United States"
    );
    expect(
      readFieldAnswerForMemory(document.querySelector("#authorized-yes") as HTMLInputElement)
    ).toBe("Yes");
    expect(readFieldAnswerForMemory(document.querySelector("#subscribe") as HTMLInputElement)).toBe(
      "Yes"
    );
    expect(readFieldAnswerForMemory(document.querySelector("#essay") as HTMLTextAreaElement)).toBe(
      "I like product work."
    );
  });
});
