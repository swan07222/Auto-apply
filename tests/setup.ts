import { afterEach, beforeAll, vi } from "vitest";

beforeAll(() => {
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

afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
});
