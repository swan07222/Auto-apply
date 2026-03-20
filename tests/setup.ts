import { afterAll, afterEach, beforeAll, vi } from "vitest";

let originalConsoleError: typeof console.error;
let originalStderrWrite: typeof process.stderr.write;

beforeAll(() => {
  const originalButtonClick = HTMLButtonElement.prototype.click;
  const originalInputClick = HTMLInputElement.prototype.click;
  originalConsoleError = console.error.bind(console);
  originalStderrWrite = process.stderr.write.bind(process.stderr);

  Object.defineProperty(console, "error", {
    configurable: true,
    writable: true,
    value: (...args: unknown[]) => {
      const [firstArg] = args;
      const firstMessage =
        typeof firstArg === "string"
          ? firstArg
          : firstArg instanceof Error
            ? firstArg.message
            : typeof firstArg === "object" &&
                firstArg !== null &&
                "message" in firstArg &&
                typeof (firstArg as { message?: unknown }).message === "string"
              ? (firstArg as { message: string }).message
              : "";
      if (
        firstMessage.includes("Not implemented: HTMLFormElement's requestSubmit() method")
      ) {
        return;
      }

      originalConsoleError(...args);
    },
  });

  Object.defineProperty(process.stderr, "write", {
    configurable: true,
    writable: true,
    value: ((
      chunk: string | Uint8Array,
      encoding?: BufferEncoding | ((error?: Error | null) => void),
      callback?: (error?: Error | null) => void
    ) => {
      const text =
        typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      if (text.includes("Not implemented: HTMLFormElement's requestSubmit() method")) {
        if (typeof encoding === "function") {
          encoding(null);
        } else if (callback) {
          callback(null);
        }
        return true;
      }

      return originalStderrWrite(chunk, encoding as never, callback as never);
    }) as typeof process.stderr.write,
  });

  Object.defineProperty(HTMLElement.prototype, "innerText", {
    configurable: true,
    get() {
      return this.textContent ?? "";
    },
    set(value: string) {
      this.textContent = value;
    },
  });

  Object.defineProperty(window, "scrollTo", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });

  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });

  Object.defineProperty(HTMLFormElement.prototype, "requestSubmit", {
    configurable: true,
    writable: true,
    value(this: HTMLFormElement) {
      this.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    },
  });

  // jsdom routes submit-button clicks through an unimplemented requestSubmit path.
  Object.defineProperty(HTMLButtonElement.prototype, "click", {
    configurable: true,
    writable: true,
    value(this: HTMLButtonElement) {
      if (this.type.toLowerCase() === "submit" && this.form) {
        this.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true, composed: true })
        );
        return;
      }

      return originalButtonClick.call(this);
    },
  });

  Object.defineProperty(HTMLInputElement.prototype, "click", {
    configurable: true,
    writable: true,
    value(this: HTMLInputElement) {
      if (this.type.toLowerCase() === "submit" && this.form) {
        this.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true, composed: true })
        );
        return;
      }

      return originalInputClick.call(this);
    },
  });

  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value() {
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        bottom: 48,
        right: 240,
        width: 240,
        height: 48,
        toJSON() {
          return this;
        },
      };
    },
  });

  if (typeof PointerEvent === "undefined") {
    Object.defineProperty(globalThis, "PointerEvent", {
      configurable: true,
      writable: true,
      value: MouseEvent,
    });
  }

  if (typeof window.matchMedia !== "function") {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  }

  if (typeof globalThis.requestAnimationFrame !== "function") {
    Object.defineProperty(globalThis, "requestAnimationFrame", {
      configurable: true,
      writable: true,
      value: vi.fn((callback: FrameRequestCallback) =>
        globalThis.setTimeout(() => callback(Date.now()), 16)
      ),
    });
  }

  if (typeof globalThis.cancelAnimationFrame !== "function") {
    Object.defineProperty(globalThis, "cancelAnimationFrame", {
      configurable: true,
      writable: true,
      value: vi.fn((id: number) => globalThis.clearTimeout(id)),
    });
  }
});

afterAll(() => {
  if (originalConsoleError) {
    Object.defineProperty(console, "error", {
      configurable: true,
      writable: true,
      value: originalConsoleError,
    });
  }

  if (originalStderrWrite) {
    Object.defineProperty(process.stderr, "write", {
      configurable: true,
      writable: true,
      value: originalStderrWrite,
    });
  }
});

afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
});
