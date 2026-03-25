// Note: describe, expect, it are provided globally by vitest (globals: true)

import { createPopupDialogController } from "../src/popupDialog";

function createDialogElements() {
  document.body.innerHTML = `
    <button id="trigger" type="button">Trigger</button>
    <section id="popup-dialog" hidden aria-hidden="true">
      <button id="popup-dialog-backdrop" type="button">Backdrop</button>
      <div id="popup-dialog-card">
        <p id="popup-dialog-kicker"></p>
        <h2 id="popup-dialog-title"></h2>
        <p id="popup-dialog-description"></p>
        <form id="popup-dialog-form">
          <div id="popup-dialog-primary-field">
            <label id="popup-dialog-primary-label" for="popup-dialog-primary-input"></label>
            <input id="popup-dialog-primary-input" />
          </div>
          <div id="popup-dialog-secondary-field">
            <label id="popup-dialog-secondary-label" for="popup-dialog-secondary-input"></label>
            <textarea id="popup-dialog-secondary-input"></textarea>
          </div>
          <p id="popup-dialog-error" hidden></p>
          <button id="popup-dialog-cancel-button" type="button">Cancel</button>
          <button id="popup-dialog-submit-button" type="submit">Save</button>
        </form>
      </div>
    </section>
  `;

  return {
    trigger: document.querySelector("#trigger") as HTMLButtonElement,
    root: document.querySelector("#popup-dialog") as HTMLElement,
    backdrop: document.querySelector("#popup-dialog-backdrop") as HTMLElement,
    card: document.querySelector("#popup-dialog-card") as HTMLElement,
    kicker: document.querySelector("#popup-dialog-kicker") as HTMLElement,
    title: document.querySelector("#popup-dialog-title") as HTMLElement,
    description: document.querySelector("#popup-dialog-description") as HTMLElement,
    form: document.querySelector("#popup-dialog-form") as HTMLFormElement,
    primaryField: document.querySelector("#popup-dialog-primary-field") as HTMLElement,
    primaryLabel: document.querySelector("#popup-dialog-primary-label") as HTMLElement,
    primaryInput: document.querySelector("#popup-dialog-primary-input") as HTMLInputElement,
    secondaryField: document.querySelector("#popup-dialog-secondary-field") as HTMLElement,
    secondaryLabel: document.querySelector("#popup-dialog-secondary-label") as HTMLElement,
    secondaryInput: document.querySelector("#popup-dialog-secondary-input") as HTMLTextAreaElement,
    error: document.querySelector("#popup-dialog-error") as HTMLElement,
    cancelButton: document.querySelector("#popup-dialog-cancel-button") as HTMLButtonElement,
    submitButton: document.querySelector("#popup-dialog-submit-button") as HTMLButtonElement,
  };
}

async function flushMicrotasks(rounds = 2): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await Promise.resolve();
  }
}

describe("popupDialog", () => {
  it("validates text prompts, trims the value, and restores focus", async () => {
    const elements = createDialogElements();
    const controller = createPopupDialogController(elements);
    elements.trigger.focus();

    const resultPromise = controller.promptText({
      title: "Rename profile",
      description: "Choose a clearer profile name.",
      label: "Profile name",
      initialValue: " Piotr ",
      submitLabel: "Save",
      validate: (value) => (value ? null : "Name is required."),
    });

    await flushMicrotasks();

    expect(elements.root.hidden).toBe(false);
    expect(elements.root.getAttribute("aria-hidden")).toBe("false");
    expect(elements.root.hasAttribute("inert")).toBe(false);
    expect(elements.primaryField.style.display).not.toBe("none");
    expect(elements.secondaryField.style.display).toBe("none");
    expect(elements.primaryInput).toBe(document.activeElement);

    elements.primaryInput.value = "   ";
    elements.form.requestSubmit();
    await flushMicrotasks();

    expect(elements.error.hidden).toBe(false);
    expect(elements.error.textContent).toBe("Name is required.");

    elements.primaryInput.value = "  Engineering  ";
    elements.form.requestSubmit();

    await expect(resultPromise).resolves.toBe("Engineering");
    expect(elements.root.hidden).toBe(true);
    expect(elements.root.getAttribute("aria-hidden")).toBe("true");
    expect(elements.root.hasAttribute("inert")).toBe(true);
    expect(document.activeElement).toBe(elements.trigger);
  });

  it("resolves pair prompts with trimmed values", async () => {
    const elements = createDialogElements();
    const controller = createPopupDialogController(elements);

    const resultPromise = controller.promptPair({
      title: "Add answer",
      description: "Save a question and answer pair.",
      primaryLabel: "Question",
      primaryValue: "  What is your work authorization? ",
      secondaryLabel: "Answer",
      secondaryValue: "  Authorized to work in the US. ",
      submitLabel: "Save answer",
      validate: (primary, secondary) =>
        primary && secondary ? null : "Both fields are required.",
    });

    await flushMicrotasks();
    expect(elements.primaryField.style.display).not.toBe("none");
    expect(elements.secondaryField.style.display).not.toBe("none");
    elements.form.requestSubmit();

    await expect(resultPromise).resolves.toEqual({
      primary: "What is your work authorization?",
      secondary: "Authorized to work in the US.",
    });
  });

  it("cancels prior dialogs before opening a new one and supports backdrop dismissal", async () => {
    const elements = createDialogElements();
    const controller = createPopupDialogController(elements);

    const firstPromise = controller.promptText({
      title: "First",
      description: "First dialog",
      label: "Name",
      initialValue: "",
      submitLabel: "Save",
    });

    await flushMicrotasks();

    const secondPromise = controller.confirm({
      title: "Delete profile",
      description: "This cannot be undone.",
      submitLabel: "Delete",
      submitTone: "danger",
    });

    await expect(firstPromise).resolves.toBeNull();
    expect(elements.submitButton.dataset.tone).toBe("danger");
    expect(elements.primaryField.style.display).toBe("none");
    expect(elements.secondaryField.style.display).toBe("none");

    elements.backdrop.click();
    await expect(secondPromise).resolves.toBe(false);
    expect(elements.root.hidden).toBe(true);
  });
});
