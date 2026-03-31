/**
 * Custom Vitest Matchers
 * 
 * Extends Vitest's expect with domain-specific matchers for testing
 * the job application automation extension.
 * 
 * @example
 * ```typescript
 * // In your test file
 * import '../../tests/helpers/customMatchers';
 * 
 * expect(action).toBeClickAction();
 * expect(form).toHaveRequiredField('email');
 * expect(state).toHaveApplicationStatus('completed');
 * ```
 */

import type { Assertion, AsymmetricMatchersContaining } from "vitest";

/**
 * Custom matcher return type
 */
interface MatcherResult {
  pass: boolean;
  message: () => string;
}

/**
 * Action type for application progression
 */
interface ProgressionAction {
  type: "click" | "navigate" | "submit" | "scroll";
  text?: string;
  description?: string;
  element?: Element;
  url?: string;
  fallbackElements?: Element[];
}

/**
 * Application state type
 */
interface ApplicationState {
  status: "pending" | "in-progress" | "completed" | "failed" | "review";
  stage?: string;
  jobId?: string;
  site?: string;
  errorMessage?: string | null;
  appliedAt?: number | null;
}

/**
 * Form field descriptor
 */
interface FormField {
  name?: string;
  type?: string;
  required?: boolean;
  value?: string;
  label?: string;
}

declare module "vitest" {
  interface Assertion<T = unknown> {
    /**
     * Asserts that the value is a valid click action
     * 
     * @example
     * ```typescript
     * expect(action).toBeClickAction();
     * ```
     */
    toBeClickAction(): T;

    /**
     * Asserts that the value is a valid navigate action
     * 
     * @example
     * ```typescript
     * expect(action).toBeNavigateAction();
     * ```
     */
    toBeNavigateAction(): T;

    /**
     * Asserts that the value is a valid progression action with optional type
     * 
     * @param actionType - Expected action type (optional)
     * 
     * @example
     * ```typescript
     * expect(action).toBeProgressionAction();
     * expect(action).toBeProgressionAction('click');
     * ```
     */
    toBeProgressionAction(actionType?: string): T;

    /**
     * Asserts that the application state has the expected status
     * 
     * @param status - Expected application status
     * 
     * @example
     * ```typescript
     * expect(state).toHaveApplicationStatus('completed');
     * ```
     */
    toHaveApplicationStatus(status: ApplicationState["status"]): T;

    /**
     * Asserts that the application state is in a terminal state
     * 
     * @example
     * ```typescript
     * expect(state).toBeTerminalState();
     * ```
     */
    toBeTerminalState(): T;

    /**
     * Asserts that the form contains a field with the given selector or name
     * 
     * @param fieldSelector - CSS selector or field name
     * 
     * @example
     * ```typescript
     * expect(form).toHaveField('#email');
     * expect(form).toHaveField('email');
     * ```
     */
    toHaveField(fieldSelector: string): T;

    /**
     * Asserts that the form contains a required field
     * 
     * @param fieldSelector - CSS selector or field name
     * 
     * @example
     * ```typescript
     * expect(form).toHaveRequiredField('email');
     * ```
     */
    toHaveRequiredField(fieldSelector: string): T;

    /**
     * Asserts that the form field has the expected value
     * 
     * @param fieldSelector - CSS selector or field name
     * @param value - Expected field value
     * 
     * @example
     * ```typescript
     * expect(form).toHaveFieldValue('email', 'test@example.com');
     * ```
     */
    toHaveFieldValue(fieldSelector: string, value: string): T;

    /**
     * Asserts that the element contains the expected text
     * 
     * @param text - Expected text content
     * 
     * @example
     * ```typescript
     * expect(element).toContainText('Apply Now');
     * ```
     */
    toContainText(text: string): T;

    /**
     * Asserts that the element has the expected CSS class
     * 
     * @param className - Expected class name
     * 
     * @example
     * ```typescript
     * expect(element).toHaveClass('active');
     * ```
     */
    toHaveClass(className: string): T;

    /**
     * Asserts that the element has the expected ARIA attribute
     * 
     * @param attributeName - ARIA attribute name (without 'aria-' prefix)
     * @param value - Expected attribute value (optional)
     * 
     * @example
     * ```typescript
     * expect(element).toHaveAriaAttribute('label', 'Submit form');
     * expect(element).toHaveAriaAttribute('hidden');
     * ```
     */
    toHaveAriaAttribute(attributeName: string, value?: string): T;

    /**
     * Asserts that the element is visible (not hidden or display: none)
     * 
     * @example
     * ```typescript
     * expect(element).toBeVisible();
     * ```
     */
    toBeVisible(): T;

    /**
     * Asserts that the element is hidden
     * 
     * @example
     * ```typescript
     * expect(element).toBeHidden();
     * ```
     */
    toBeHidden(): T;

    /**
     * Asserts that the element is disabled
     * 
     * @example
     * ```typescript
     * expect(button).toBeDisabled();
     * ```
     */
    toBeDisabled(): T;

    /**
     * Asserts that the element is enabled
     * 
     * @example
     * ```typescript
     * expect(button).toBeEnabled();
     * ```
     */
    toBeEnabled(): T;

    /**
     * Asserts that the profile has the expected property
     * 
     * @param property - Profile property name
     * @param value - Expected property value
     * 
     * @example
     * ```typescript
     * expect(profile).toHaveProfileProperty('email', 'test@example.com');
     * ```
     */
    toHaveProfileProperty(property: string, value: string): T;

    /**
     * Asserts that the job posting has the expected property
     * 
     * @param property - Job property name
     * @param value - Expected property value
     * 
     * @example
     * ```typescript
     * expect(job).toHaveJobProperty('remote', true);
     * ```
     */
    toHaveJobProperty(property: string, value: unknown): T;

    /**
     * Asserts that the automation settings are valid
     * 
     * @example
     * ```typescript
     * expect(settings).toBeValidAutomationSettings();
     * ```
     */
    toBeValidAutomationSettings(): T;

    /**
     * Asserts that the response is successful (ok: true)
     * 
     * @example
     * ```typescript
     * expect(response).toBeSuccessfulResponse();
     * ```
     */
    toBeSuccessfulResponse(): T;

    /**
     * Asserts that the error response contains the expected message
     * 
     * @param message - Expected error message or substring
     * 
     * @example
     * ```typescript
     * expect(error).toHaveErrorMessage('Network timeout');
     * ```
     */
    toHaveErrorMessage(message?: string): T;

    /**
     * Asserts that the DOM contains the expected element
     * 
     * @param selector - CSS selector
     * 
     * @example
     * ```typescript
     * expect(document).toContainElement('.job-card');
     * ```
     */
    toContainElement(selector: string): T;

    /**
     * Asserts that the DOM contains the expected number of elements
     * 
     * @param selector - CSS selector
     * @param count - Expected number of elements
     * 
     * @example
     * ```typescript
     * expect(document).toContainElements('.job-card', 5);
     * ```
     */
    toContainElements(selector: string, count: number): T;

    /**
     * Asserts that the value is within an acceptable range
     * 
     * @param min - Minimum value (inclusive)
     * @param max - Maximum value (inclusive)
     * 
     * @example
     * ```typescript
     * expect(score).toBeInRange(0, 100);
     * ```
     */
    toBeInRange(min: number, max: number): T;

    /**
     * Asserts that the value is approximately equal to expected
     * 
     * @param expected - Expected value
     * @param tolerance - Acceptable tolerance (default: 0.001)
     * 
     * @example
     * ```typescript
     * expect(result).toBeApproximately(3.14159, 0.01);
     * ```
     */
    toBeApproximately(expected: number, tolerance?: number): T;

    /**
     * Asserts that the promise resolves successfully
     * 
     * @example
     * ```typescript
     * await expect(promise).resolvesSuccessfully();
     * ```
     */
    resolvesSuccessfully(): T;

    /**
     * Asserts that the promise rejects with expected message
     * 
     * @param message - Expected error message or substring
     * 
     * @example
     * ```typescript
     * await expect(promise).rejectsWithMessage('Timeout');
     * ```
     */
    rejectsWithMessage(message?: string): T;
  }

  interface AsymmetricMatchersContaining {
    toBeClickAction(): unknown;
    toBeNavigateAction(): unknown;
    toBeProgressionAction(actionType?: string): unknown;
    toHaveApplicationStatus(status: string): unknown;
    toBeTerminalState(): unknown;
    toHaveField(fieldSelector: string): unknown;
    toHaveRequiredField(fieldSelector: string): unknown;
    toHaveFieldValue(fieldSelector: string, value: string): unknown;
    toContainText(text: string): unknown;
    toHaveClass(className: string): unknown;
    toHaveAriaAttribute(attributeName: string, value?: string): unknown;
    toBeVisible(): unknown;
    toBeHidden(): unknown;
    toBeDisabled(): unknown;
    toBeEnabled(): unknown;
    toHaveProfileProperty(property: string, value: string): unknown;
    toHaveJobProperty(property: string, value: unknown): unknown;
    toBeValidAutomationSettings(): unknown;
    toBeSuccessfulResponse(): unknown;
    toHaveErrorMessage(message?: string): unknown;
    toContainElement(selector: string): unknown;
    toContainElements(selector: string, count: number): unknown;
    toBeInRange(min: number, max: number): unknown;
    toBeApproximately(expected: number, tolerance?: number): unknown;
  }
}

/**
 * Helper to check if value is a valid progression action
 */
function isValidProgressionAction(value: unknown): value is ProgressionAction {
  if (!value || typeof value !== "object") return false;
  const action = value as Partial<ProgressionAction>;
  const validTypes = ["click", "navigate", "submit", "scroll"];
  
  if (!action.type || !validTypes.includes(action.type)) return false;
  if (action.type === "click" && !action.element && !action.description && !action.text) return false;
  if (action.type === "navigate" && !action.url) return false;
  
  return true;
}

/**
 * Helper to check if element matches selector
 */
function elementMatchesSelector(element: Element | null, selector: string): boolean {
  if (!element) return false;
  if (selector.startsWith("#")) {
    return element.id === selector.slice(1);
  }
  if (selector.startsWith(".")) {
    return element.classList.contains(selector.slice(1));
  }
  if (selector.startsWith("[")) {
    const attrMatch = selector.match(/\[([^\]=]+)(?:="([^"]*)")?\]/);
    if (attrMatch) {
      const [, attrName, attrValue] = attrMatch;
      if (attrValue !== undefined) {
        return element.getAttribute(attrName) === attrValue;
      }
      return element.hasAttribute(attrName);
    }
  }
  return element.matches(selector);
}

/**
 * Custom matcher implementations
 */
const customMatchers: Record<string, (...args: unknown[]) => MatcherResult> = {
  toBeClickAction(this: unknown, received: unknown): MatcherResult {
    const pass = received !== null && typeof received === "object" && "type" in received && (received as { type: string }).type === "click";
    return {
      pass,
      message: () => pass
        ? "Expected value not to be a click action"
        : `Expected value to be a click action, got ${received === null ? "null" : typeof received}`,
    };
  },

  toBeNavigateAction(this: unknown, received: unknown): MatcherResult {
    const pass = received !== null && typeof received === "object" && "type" in received && (received as { type: string }).type === "navigate";
    return {
      pass,
      message: () => pass
        ? "Expected value not to be a navigate action"
        : `Expected value to be a navigate action, got ${received === null ? "null" : typeof received}`,
    };
  },

  toBeProgressionAction(this: unknown, received: unknown, actionType?: string): MatcherResult {
    const isValid = isValidProgressionAction(received);
    const typeMatches = !actionType || (received as { type?: string }).type === actionType;
    const pass = isValid && typeMatches;
    
    return {
      pass,
      message: () => pass
        ? `Expected value not to be a progression action${actionType ? ` of type '${actionType}'` : ""}`
        : `Expected value to be a progression action${actionType ? ` of type '${actionType}'` : ""}, got ${received === null ? "null" : typeof received}`,
    };
  },

  toHaveApplicationStatus(this: unknown, received: unknown, status: string): MatcherResult {
    const actualStatus = (received as { status?: string })?.status;
    const pass = actualStatus === status;
    
    return {
      pass,
      message: () => pass
        ? `Expected application state not to have status '${status}'`
        : `Expected application state to have status '${status}', got '${actualStatus}'`,
    };
  },

  toBeTerminalState(this: unknown, received: unknown): MatcherResult {
    const status = (received as { status?: string })?.status;
    const terminalStates = ["completed", "failed", "review"];
    const pass = status !== undefined && terminalStates.includes(status);
    
    return {
      pass,
      message: () => pass
        ? "Expected application state not to be in a terminal state"
        : `Expected application state to be in a terminal state (completed, failed, or review), got '${status}'`,
    };
  },

  toHaveField(this: unknown, received: unknown, selector: string): MatcherResult {
    const element = received as Element | Document;
    const queryMethod = "querySelector" in element ? "querySelector" : null;
    const field = queryMethod ? (element as Document).querySelector(selector) : null;
    const pass = field !== null;
    
    return {
      pass,
      message: () => pass
        ? `Expected element not to contain field '${selector}'`
        : `Expected element to contain field '${selector}', but it was not found`,
    };
  },

  toHaveRequiredField(this: unknown, received: unknown, selector: string): MatcherResult {
    const element = received as Element | Document;
    const queryMethod = "querySelector" in element ? "querySelector" : null;
    const field = queryMethod ? (element as Document).querySelector(selector) : null;
    const isRequired = field?.hasAttribute("required") || field?.getAttribute("aria-required") === "true";
    const pass = field !== null && isRequired;
    
    return {
      pass,
      message: () => pass
        ? `Expected field '${selector}' not to be required`
        : `Expected field '${selector}' to be required, ${field ? "but it is optional" : "field not found"}`,
    };
  },

  toHaveFieldValue(this: unknown, received: unknown, selector: string, value: string): MatcherResult {
    const element = received as Element | Document;
    const field = "querySelector" in element ? (element as Document).querySelector<HTMLInputElement>(selector) : null;
    const actualValue = field?.value ?? "";
    const pass = field !== null && actualValue === value;
    
    return {
      pass,
      message: () => pass
        ? `Expected field '${selector}' not to have value '${value}'`
        : `Expected field '${selector}' to have value '${value}', got '${actualValue}'`,
    };
  },

  toContainText(this: unknown, received: unknown, text: string): MatcherResult {
    const element = received as Element;
    const actualText = element?.textContent ?? "";
    const pass = actualText.includes(text);
    
    return {
      pass,
      message: () => pass
        ? `Expected element not to contain text '${text}'`
        : `Expected element to contain text '${text}', got '${actualText.trim().substring(0, 100)}'`,
    };
  },

  toHaveClass(this: unknown, received: unknown, className: string): MatcherResult {
    const element = received as Element;
    const pass = element?.classList.contains(className) ?? false;
    
    return {
      pass,
      message: () => pass
        ? `Expected element not to have class '${className}'`
        : `Expected element to have class '${className}', got '${element?.className}'`,
    };
  },

  toHaveAriaAttribute(this: unknown, received: unknown, attributeName: string, value?: string): MatcherResult {
    const element = received as Element;
    const attrValue = element?.getAttribute(`aria-${attributeName}`);
    const pass = value !== undefined ? attrValue === value : attrValue !== null;
    
    return {
      pass,
      message: () => pass
        ? `Expected element not to have aria-${attributeName}${value ? `='${value}'` : ""}`
        : `Expected element to have aria-${attributeName}${value ? `='${value}'` : ""}, got ${attrValue === null ? "nothing" : `'${attrValue}'`}`,
    };
  },

  toBeVisible(this: unknown, received: unknown): MatcherResult {
    const element = received as HTMLElement;
    const style = element?.style;
    const pass = element != null && style?.display !== "none" && style?.visibility !== "hidden" && element.offsetParent !== null;
    
    return {
      pass,
      message: () => pass
        ? "Expected element not to be visible"
        : "Expected element to be visible, but it is hidden",
    };
  },

  toBeHidden(this: unknown, received: unknown): MatcherResult {
    const element = received as HTMLElement;
    const style = element?.style;
    const pass = element == null || style?.display === "none" || style?.visibility === "hidden" || element.offsetParent === null;
    
    return {
      pass,
      message: () => pass
        ? "Expected element not to be hidden"
        : "Expected element to be hidden, but it is visible",
    };
  },

  toBeDisabled(this: unknown, received: unknown): MatcherResult {
    const element = received as HTMLElement;
    const pass = element?.hasAttribute("disabled") ?? false;
    
    return {
      pass,
      message: () => pass
        ? "Expected element not to be disabled"
        : "Expected element to be disabled, but it is enabled",
    };
  },

  toBeEnabled(this: unknown, received: unknown): MatcherResult {
    const element = received as HTMLElement;
    const pass = !element?.hasAttribute("disabled");
    
    return {
      pass,
      message: () => pass
        ? "Expected element not to be enabled"
        : "Expected element to be enabled, but it is disabled",
    };
  },

  toHaveProfileProperty(this: unknown, received: unknown, property: string, value: string): MatcherResult {
    const profile = received as Record<string, unknown>;
    const actualValue = profile?.[property];
    const pass = actualValue === value;
    
    return {
      pass,
      message: () => pass
        ? `Expected profile not to have property '${property}' with value '${value}'`
        : `Expected profile property '${property}' to be '${value}', got '${actualValue}'`,
    };
  },

  toHaveJobProperty(this: unknown, received: unknown, property: string, value: unknown): MatcherResult {
    const job = received as Record<string, unknown>;
    const actualValue = job?.[property];
    const pass = actualValue === value;
    
    return {
      pass,
      message: () => pass
        ? `Expected job not to have property '${property}' with value '${value}'`
        : `Expected job property '${property}' to be '${value}', got '${actualValue}'`,
    };
  },

  toBeValidAutomationSettings(this: unknown, received: unknown): MatcherResult {
    const settings = received as Partial<{ activeProfileId: string; profiles: Record<string, unknown>; searchKeywords: string }>;
    const hasProfileId = settings.activeProfileId != null && settings.activeProfileId !== "";
    const hasProfiles = settings.profiles != null && Object.keys(settings.profiles).length > 0;
    const hasKeywords = settings.searchKeywords != null && settings.searchKeywords !== "";
    const pass = hasProfileId && hasProfiles && hasKeywords;
    
    return {
      pass,
      message: () => pass
        ? "Expected value not to be valid automation settings"
        : "Expected value to be valid automation settings with activeProfileId, profiles, and searchKeywords",
    };
  },

  toBeSuccessfulResponse(this: unknown, received: unknown): MatcherResult {
    const response = received as { ok?: boolean };
    const pass = response?.ok === true;
    
    return {
      pass,
      message: () => pass
        ? "Expected response not to be successful"
        : "Expected response to be successful (ok: true)",
    };
  },

  toHaveErrorMessage(this: unknown, received: unknown, message?: string): MatcherResult {
    const error = received as { message?: string };
    const errorMessage = error?.message ?? "";
    const pass = message ? errorMessage.includes(message) : errorMessage !== "";
    
    return {
      pass,
      message: () => pass
        ? `Expected error not to ${message ? `contain message '${message}'` : "have a message"}`
        : `Expected error to ${message ? `contain message '${message}'` : "have a message"}, got '${errorMessage}'`,
    };
  },

  toContainElement(this: unknown, received: unknown, selector: string): MatcherResult {
    const element = received as Element | Document;
    const found = "querySelector" in element ? (element as Document).querySelector(selector) : null;
    const pass = found !== null;
    
    return {
      pass,
      message: () => pass
        ? `Expected document not to contain element matching '${selector}'`
        : `Expected document to contain element matching '${selector}', but none found`,
    };
  },

  toContainElements(this: unknown, received: unknown, selector: string, count: number): MatcherResult {
    const element = received as Element | Document;
    const found = "querySelectorAll" in element ? (element as Document).querySelectorAll(selector) : [];
    const actualCount = found.length;
    const pass = actualCount === count;
    
    return {
      pass,
      message: () => pass
        ? `Expected document not to contain exactly ${count} elements matching '${selector}'`
        : `Expected document to contain exactly ${count} elements matching '${selector}', found ${actualCount}`,
    };
  },

  toBeInRange(this: unknown, received: unknown, min: number, max: number): MatcherResult {
    const value = received as number;
    const pass = typeof value === "number" && value >= min && value <= max;
    
    return {
      pass,
      message: () => pass
        ? `Expected value not to be in range [${min}, ${max}]`
        : `Expected value ${value} to be in range [${min}, ${max}]`,
    };
  },

  toBeApproximately(this: unknown, received: unknown, expected: number, tolerance = 0.001): MatcherResult {
    const value = received as number;
    const diff = Math.abs(value - expected);
    const pass = typeof value === "number" && diff <= tolerance;
    
    return {
      pass,
      message: () => pass
        ? `Expected value not to be approximately ${expected} (±${tolerance})`
        : `Expected value ${value} to be approximately ${expected} (±${tolerance}), difference was ${diff}`,
    };
  },

  resolvesSuccessfully: function() {
    return {
      pass: false,
      message: () => "Use with .resolves modifier",
    };
  },

  rejectsWithMessage: function() {
    return {
      pass: false,
      message: () => "Use with .rejects modifier",
    };
  },
};

// Register custom matchers
expect.extend(customMatchers);

// Export for explicit imports if needed
export { customMatchers };
