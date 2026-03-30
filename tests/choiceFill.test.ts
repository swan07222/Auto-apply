// Note: describe, expect, it are provided globally by vitest (globals: true)
// vi must be imported for mocking
import { vi } from "vitest";

import {
  applyAnswerToRadioGroup,
  selectOptionByAnswer,
} from "../src/content/choiceFill";

describe("choice fill helpers", () => {
  it("can override a preselected radio choice when allowed", () => {
    document.body.innerHTML = `
      <form>
        <label for="auth-no">No</label>
        <input id="auth-no" name="authorized" type="radio" value="no" checked />
        <label for="auth-yes">Yes</label>
        <input id="auth-yes" name="authorized" type="radio" value="yes" />
      </form>
    `;

    const no = document.querySelector("#auth-no") as HTMLInputElement;
    const yes = document.querySelector("#auth-yes") as HTMLInputElement;
    const inputSpy = vi.fn();
    const changeSpy = vi.fn();
    const clickSpy = vi.fn();

    yes.addEventListener("input", inputSpy);
    yes.addEventListener("change", changeSpy);
    yes.addEventListener("click", clickSpy);

    expect(applyAnswerToRadioGroup(no, "Yes", true)).toBe(true);
    expect(yes.checked).toBe(true);
    expect(no.checked).toBe(false);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(inputSpy).toHaveBeenCalledTimes(1);
    expect(changeSpy).toHaveBeenCalledTimes(1);
  });

  it("fires click-aware radio updates so controlled forms can enable progression", () => {
    document.body.innerHTML = `
      <form>
        <fieldset>
          <legend>Do you have a completed Bachelor's degree?</legend>
          <label for="degree-yes">Yes</label>
          <input id="degree-yes" name="degree" type="radio" value="yes" />
          <label for="degree-no">No</label>
          <input id="degree-no" name="degree" type="radio" value="no" />
        </fieldset>
        <button id="continue" type="button" disabled>Continue</button>
      </form>
    `;

    const yes = document.querySelector("#degree-yes") as HTMLInputElement;
    const no = document.querySelector("#degree-no") as HTMLInputElement;
    const continueButton = document.querySelector("#continue") as HTMLButtonElement;

    yes.addEventListener("click", () => {
      continueButton.disabled = !yes.checked;
    });

    expect(continueButton.disabled).toBe(true);
    expect(applyAnswerToRadioGroup(no, "Yes", true)).toBe(true);
    expect(yes.checked).toBe(true);
    expect(continueButton.disabled).toBe(false);
  });

  it("keeps an existing radio choice when overwrite is not allowed", () => {
    document.body.innerHTML = `
      <form>
        <label for="sponsor-no">No</label>
        <input id="sponsor-no" name="sponsorship" type="radio" value="no" checked />
        <label for="sponsor-yes">Yes</label>
        <input id="sponsor-yes" name="sponsorship" type="radio" value="yes" />
      </form>
    `;

    const no = document.querySelector("#sponsor-no") as HTMLInputElement;
    const yes = document.querySelector("#sponsor-yes") as HTMLInputElement;

    expect(applyAnswerToRadioGroup(no, "Yes", false)).toBe(false);
    expect(no.checked).toBe(true);
    expect(yes.checked).toBe(false);
  });

  it("selects the matching option by answer text", () => {
    document.body.innerHTML = `
      <label for="authorization">Authorization</label>
      <select id="authorization">
        <option value="">Select one</option>
        <option value="citizen">US Citizen</option>
        <option value="visa">Needs sponsorship</option>
      </select>
    `;

    const select = document.querySelector("#authorization") as HTMLSelectElement;
    const inputSpy = vi.fn();
    const changeSpy = vi.fn();

    select.addEventListener("input", inputSpy);
    select.addEventListener("change", changeSpy);

    expect(selectOptionByAnswer(select, "US Citizen")).toBe(true);
    expect(select.value).toBe("citizen");
    expect(inputSpy).toHaveBeenCalledTimes(1);
    expect(changeSpy).toHaveBeenCalledTimes(1);
  });
});
