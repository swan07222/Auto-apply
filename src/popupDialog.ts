type DialogTextConfig = {
  kicker?: string;
  title: string;
  description: string;
  label: string;
  initialValue: string;
  placeholder?: string;
  submitLabel: string;
  validate?: (value: string) => string | null;
};

type DialogPairConfig = {
  kicker?: string;
  title: string;
  description: string;
  primaryLabel: string;
  primaryValue: string;
  primaryPlaceholder?: string;
  secondaryLabel: string;
  secondaryValue: string;
  secondaryPlaceholder?: string;
  submitLabel: string;
  validate?: (primaryValue: string, secondaryValue: string) => string | null;
};

type DialogConfirmConfig = {
  kicker?: string;
  title: string;
  description: string;
  submitLabel: string;
  submitTone?: "default" | "danger";
};

type PopupDialogElements = {
  root: HTMLElement;
  backdrop: HTMLElement;
  card: HTMLElement;
  kicker: HTMLElement;
  title: HTMLElement;
  description: HTMLElement;
  form: HTMLFormElement;
  primaryField: HTMLElement;
  primaryLabel: HTMLElement;
  primaryInput: HTMLInputElement;
  secondaryField: HTMLElement;
  secondaryLabel: HTMLElement;
  secondaryInput: HTMLTextAreaElement;
  error: HTMLElement;
  cancelButton: HTMLButtonElement;
  submitButton: HTMLButtonElement;
};

type DialogState =
  | {
      kind: "text";
      validate?: DialogTextConfig["validate"];
      resolve: (value: string | null) => void;
    }
  | {
      kind: "pair";
      validate?: DialogPairConfig["validate"];
      resolve: (value: { primary: string; secondary: string } | null) => void;
    }
  | {
      kind: "confirm";
      resolve: (value: boolean) => void;
    }
  | null;

export type PopupDialogController = {
  promptText(config: DialogTextConfig): Promise<string | null>;
  promptPair(
    config: DialogPairConfig
  ): Promise<{ primary: string; secondary: string } | null>;
  confirm(config: DialogConfirmConfig): Promise<boolean>;
};

export function createPopupDialogController(
  elements: PopupDialogElements
): PopupDialogController {
  let currentState: DialogState = null;
  let restoreFocusTarget: HTMLElement | null = null;

  const hideError = (): void => {
    elements.error.textContent = "";
    elements.error.hidden = true;
  };

  const showError = (message: string): void => {
    elements.error.textContent = message;
    elements.error.hidden = false;
  };

  const setDialogHiddenState = (hidden: boolean): void => {
    elements.root.hidden = hidden;
    elements.root.dataset.open = hidden ? "false" : "true";
    elements.root.setAttribute("aria-hidden", hidden ? "true" : "false");
    if (hidden) {
      elements.root.setAttribute("inert", "");
    } else {
      elements.root.removeAttribute("inert");
    }
  };

  const focusBodyFallback = (): void => {
    const body = elements.root.ownerDocument.body;
    const previousTabIndex = body.getAttribute("tabindex");
    body.setAttribute("tabindex", "-1");
    body.focus();

    if (previousTabIndex === null) {
      body.removeAttribute("tabindex");
      return;
    }

    body.setAttribute("tabindex", previousTabIndex);
  };

  const restoreFocusBeforeHide = (): void => {
    const activeElement = elements.root.ownerDocument.activeElement;
    if (!(activeElement instanceof HTMLElement) || !elements.root.contains(activeElement)) {
      return;
    }

    if (
      restoreFocusTarget &&
      restoreFocusTarget.isConnected &&
      !elements.root.contains(restoreFocusTarget)
    ) {
      restoreFocusTarget.focus();
      return;
    }

    focusBodyFallback();
  };

  const closeDialog = (): void => {
    restoreFocusBeforeHide();
    setDialogHiddenState(true);
    elements.submitButton.dataset.tone = "default";
    elements.form.reset();
    hideError();
  };

  const finishDialog = (result: unknown): void => {
    const pendingState = currentState;
    currentState = null;
    closeDialog();

    if (!pendingState) {
      return;
    }

    if (pendingState.kind === "text") {
      pendingState.resolve(result as string | null);
      return;
    }

    if (pendingState.kind === "pair") {
      pendingState.resolve(
        result as { primary: string; secondary: string } | null
      );
      return;
    }

    pendingState.resolve(Boolean(result));
  };

  const focusPrimaryTarget = (): void => {
    queueMicrotask(() => {
      if (!elements.primaryField.hidden) {
        elements.primaryInput.focus();
        elements.primaryInput.select();
        return;
      }

      if (!elements.secondaryField.hidden) {
        elements.secondaryInput.focus();
        elements.secondaryInput.select();
        return;
      }

      elements.submitButton.focus();
    });
  };

  const openBaseDialog = (config: {
    kicker?: string;
    title: string;
    description: string;
    submitLabel: string;
    submitTone?: "default" | "danger";
    showPrimaryField: boolean;
    primaryLabel?: string;
    primaryValue?: string;
    primaryPlaceholder?: string;
    showSecondaryField: boolean;
    secondaryLabel?: string;
    secondaryValue?: string;
    secondaryPlaceholder?: string;
  }): void => {
    if (currentState) {
      finishDialog(null);
    }

    const activeElement = elements.root.ownerDocument.activeElement;
    restoreFocusTarget =
      activeElement instanceof HTMLElement && !elements.root.contains(activeElement)
        ? activeElement
        : null;

    elements.kicker.textContent = config.kicker || "Edit";
    elements.title.textContent = config.title;
    elements.description.textContent = config.description;
    elements.submitButton.textContent = config.submitLabel;
    elements.submitButton.dataset.tone = config.submitTone ?? "default";

    elements.primaryField.hidden = !config.showPrimaryField;
    elements.primaryLabel.textContent = config.primaryLabel ?? "";
    elements.primaryInput.value = config.primaryValue ?? "";
    elements.primaryInput.placeholder = config.primaryPlaceholder ?? "";

    elements.secondaryField.hidden = !config.showSecondaryField;
    elements.secondaryLabel.textContent = config.secondaryLabel ?? "";
    elements.secondaryInput.value = config.secondaryValue ?? "";
    elements.secondaryInput.placeholder = config.secondaryPlaceholder ?? "";

    hideError();
    setDialogHiddenState(false);
    focusPrimaryTarget();
  };

  elements.cancelButton.addEventListener("click", () => {
    finishDialog(null);
  });

  elements.backdrop.addEventListener("click", () => {
    finishDialog(null);
  });

  elements.root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      finishDialog(null);
    }
  });

  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();

    if (!currentState) {
      return;
    }

    if (currentState.kind === "confirm") {
      finishDialog(true);
      return;
    }

    const primaryValue = elements.primaryInput.value.trim();
    if (currentState.kind === "text") {
      const error = currentState.validate?.(primaryValue) ?? null;
      if (error) {
        showError(error);
        return;
      }

      finishDialog(primaryValue);
      return;
    }

    const secondaryValue = elements.secondaryInput.value.trim();
    const error =
      currentState.validate?.(primaryValue, secondaryValue) ?? null;
    if (error) {
      showError(error);
      return;
    }

    finishDialog({
      primary: primaryValue,
      secondary: secondaryValue,
    });
  });

  setDialogHiddenState(true);
  closeDialog();

  return {
    promptText(config) {
      openBaseDialog({
        kicker: config.kicker,
        title: config.title,
        description: config.description,
        submitLabel: config.submitLabel,
        showPrimaryField: true,
        primaryLabel: config.label,
        primaryValue: config.initialValue,
        primaryPlaceholder: config.placeholder,
        showSecondaryField: false,
      });

      return new Promise<string | null>((resolve) => {
        currentState = {
          kind: "text",
          validate: config.validate,
          resolve,
        };
      });
    },
    promptPair(config) {
      openBaseDialog({
        kicker: config.kicker,
        title: config.title,
        description: config.description,
        submitLabel: config.submitLabel,
        showPrimaryField: true,
        primaryLabel: config.primaryLabel,
        primaryValue: config.primaryValue,
        primaryPlaceholder: config.primaryPlaceholder,
        showSecondaryField: true,
        secondaryLabel: config.secondaryLabel,
        secondaryValue: config.secondaryValue,
        secondaryPlaceholder: config.secondaryPlaceholder,
      });

      return new Promise<{ primary: string; secondary: string } | null>(
        (resolve) => {
          currentState = {
            kind: "pair",
            validate: config.validate,
            resolve,
          };
        }
      );
    },
    confirm(config) {
      openBaseDialog({
        kicker: config.kicker,
        title: config.title,
        description: config.description,
        submitLabel: config.submitLabel,
        submitTone: config.submitTone,
        showPrimaryField: false,
        showSecondaryField: false,
      });

      return new Promise<boolean>((resolve) => {
        currentState = {
          kind: "confirm",
          resolve,
        };
      });
    },
  };
}
