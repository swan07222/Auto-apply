/**
 * Test Configuration and Utilities
 * 
 * Provides test configuration helpers, retry logic for flaky tests,
 * and performance monitoring utilities.
 * 
 * @example
 * ```typescript
 * import { withRetry, measurePerformance } from './helpers/testUtils';
 * 
 * it('should handle flaky network calls', async () => {
 *   await withRetry(async () => {
 *     // flaky operation
 *   });
 * });
 * 
 * it('should be performant', async () => {
 *   const { duration } = await measurePerformance(async () => {
 *     // operation to measure
 *   });
 *   expect(duration).toBeLessThan(100);
 * });
 * ```
 */

import { AsyncTestUtils } from "./factories";

/**
 * Retry configuration options
 */
export interface RetryOptions {
  /**
   * Maximum number of retry attempts (default: 3)
   */
  maxRetries?: number;
  /**
   * Delay between retries in milliseconds (default: 100)
   */
  delay?: number;
  /**
   * Backoff multiplier for exponential backoff (default: 2)
   */
  backoff?: number;
  /**
   * Only retry if error matches this condition
   */
  retryIf?: (error: Error) => boolean;
  /**
   * Callback invoked on each retry
   */
  onRetry?: (attempt: number, error: Error) => void;
}

/**
 * Performance measurement result
 */
export interface PerformanceResult<T> {
  /**
   * The result of the measured operation
   */
  result: T;
  /**
   * Duration in milliseconds
   */
  duration: number;
  /**
   * Memory usage difference in bytes (if available)
   */
  memoryUsed?: number;
}

/**
 * Test timeout configuration
 */
export interface TimeoutOptions {
  /**
   * Timeout in milliseconds (default: 5000)
   */
  timeout?: number;
  /**
   * Error message to show on timeout
   */
  message?: string;
}

/**
 * Wraps a test function with retry logic for handling flaky tests
 * 
 * @param fn - The test function to retry
 * @param options - Retry configuration options
 * @returns Promise that resolves when the function succeeds or rejects after all retries
 * 
 * @example
 * ```typescript
 * it('should handle flaky network calls', async () => {
 *   await withRetry(
 *     async () => {
 *       const response = await fetch('/api/flaky-endpoint');
 *       expect(response.ok).toBe(true);
 *     },
 *     { maxRetries: 3, delay: 200 }
 *   );
 * });
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T> | T,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    delay = 100,
    backoff = 2,
    retryIf,
    onRetry,
  } = options;

  let lastError: Error | null = null;
  let currentDelay = delay;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Check if we should retry this error
      if (retryIf && !retryIf(lastError)) {
        throw lastError;
      }

      // Don't retry on the last attempt
      if (attempt < maxRetries) {
        onRetry?.(attempt, lastError);
        await AsyncTestUtils.delay(currentDelay);
        currentDelay *= backoff; // Exponential backoff
      }
    }
  }

  throw lastError ?? new Error("Unknown error occurred");
}

/**
 * Measures the performance of an async operation
 * 
 * @param fn - The function to measure
 * @param options - Performance measurement options
 * @returns Object containing the result, duration, and memory usage
 * 
 * @example
 * ```typescript
 * it('should complete within performance budget', async () => {
 *   const { result, duration, memoryUsed } = await measurePerformance(
 *     async () => {
 *       return await expensiveOperation();
 *     }
 *   );
 *   
 *   expect(duration).toBeLessThan(100); // 100ms budget
 *   expect(result).toBeDefined();
 * });
 * ```
 */
export async function measurePerformance<T>(
  fn: () => Promise<T> | T,
  options: { measureMemory?: boolean } = {}
): Promise<PerformanceResult<T>> {
  const { measureMemory = false } = options;
  
  const startTime = performance.now();
  const startMemory = measureMemory && globalThis.process?.memoryUsage 
    ? globalThis.process.memoryUsage().heapUsed 
    : undefined;
  
  const result = await fn();
  
  const endTime = performance.now();
  const duration = endTime - startTime;
  
  const endMemory = measureMemory && globalThis.process?.memoryUsage
    ? globalThis.process.memoryUsage().heapUsed
    : undefined;
  
  const memoryUsed = startMemory !== undefined && endMemory !== undefined
    ? endMemory - startMemory
    : undefined;

  return {
    result,
    duration,
    memoryUsed,
  };
}

/**
 * Wraps a test with a timeout
 * 
 * @param fn - The test function to wrap
 * @param options - Timeout configuration
 * @returns Promise that rejects if the function takes too long
 * 
 * @example
 * ```typescript
 * it('should complete within timeout', async () => {
 *   await withTimeout(
 *     async () => {
 *       await longRunningOperation();
 *     },
 *     { timeout: 5000, message: 'Operation took too long' }
 *   );
 * });
 * ```
 */
export async function withTimeout<T>(
  fn: () => Promise<T> | T,
  options: TimeoutOptions = {}
): Promise<T> {
  const { timeout = 5000, message = `Test timed out after ${timeout}ms` } = options;

  return Promise.race([
    fn(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(message)), timeout)
    ),
  ]);
}

/**
 * Creates a debounced version of a function for testing
 * 
 * @param fn - The function to debounce
 * @param delay - Delay in milliseconds
 * @returns Debounced function
 * 
 * @example
 * ```typescript
 * it('should debounce rapid calls', async () => {
 *   const mockFn = vi.fn();
 *   const debouncedFn = createDebounce(mockFn, 100);
 *   
 *   debouncedFn();
 *   debouncedFn();
 *   debouncedFn();
 *   
 *   await AsyncTestUtils.delay(150);
 *   expect(mockFn).toHaveBeenCalledTimes(1);
 * });
 * ```
 */
export function createDebounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): T & { cancel: () => void; flush: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: unknown[] | null = null;

  const debounced = function(...args: unknown[]) {
    lastArgs = args;
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      if (lastArgs) {
        fn(...lastArgs);
      }
      timeoutId = null;
      lastArgs = null;
    }, delay);
  } as T & { cancel: () => void; flush: () => void };

  debounced.cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
      lastArgs = null;
    }
  };

  debounced.flush = () => {
    if (timeoutId && lastArgs) {
      clearTimeout(timeoutId);
      fn(...lastArgs);
      timeoutId = null;
      lastArgs = null;
    }
  };

  return debounced;
}

/**
 * Creates a throttled version of a function for testing
 * 
 * @param fn - The function to throttle
 * @param limit - Minimum time between calls in milliseconds
 * @returns Throttled function
 * 
 * @example
 * ```typescript
 * it('should throttle rapid calls', async () => {
 *   const mockFn = vi.fn();
 *   const throttledFn = createThrottle(mockFn, 100);
 *   
 *   throttledFn();
 *   throttledFn();
 *   throttledFn();
 *   
 *   await AsyncTestUtils.delay(150);
 *   throttledFn();
 *   
 *   expect(mockFn).toHaveBeenCalledTimes(2);
 * });
 * ```
 */
export function createThrottle<T extends (...args: unknown[]) => unknown>(
  fn: T,
  limit: number
): T {
  let inThrottle = false;
  let lastArgs: unknown[] | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const throttled = function(...args: unknown[]) {
    if (inThrottle) {
      lastArgs = args;
      if (!timeoutId) {
        timeoutId = setTimeout(() => {
          if (lastArgs) {
            fn(...lastArgs);
          }
          inThrottle = false;
          lastArgs = null;
          timeoutId = null;
        }, limit);
      }
      return;
    }

    inThrottle = true;
    fn(...args);
  } as T;

  return throttled;
}

/**
 * Test spy utilities
 */
export const SpyUtils = {
  /**
   * Creates a spy function that records all calls
   * 
   * @param implementation - Optional implementation function
   * @returns Spy function with call tracking
   * 
   * @example
   * ```typescript
   * const callback = createSpy();
   * callback('arg1', 'arg2');
   * expect(callback.calls).toHaveLength(1);
   * expect(callback.calls[0]).toEqual(['arg1', 'arg2']);
   * ```
   */
  createSpy<T extends (...args: unknown[]) => unknown = () => void>(
    implementation?: T
  ): T & {
    calls: unknown[][];
    callCount: number;
    lastCall: unknown[] | null;
    reset: () => void;
  } {
    const calls: unknown[][] = [];
    
    const spy = function(...args: unknown[]) {
      calls.push(args);
      return implementation?.(...args);
    } as T & {
      calls: unknown[][];
      callCount: number;
      lastCall: unknown[] | null;
      reset: () => void;
    };

    Object.defineProperty(spy, 'calls', { value: calls, writable: false });
    Object.defineProperty(spy, 'callCount', {
      get: () => calls.length,
    });
    Object.defineProperty(spy, 'lastCall', {
      get: () => (calls.length > 0 ? calls[calls.length - 1] : null),
    });
    Object.defineProperty(spy, 'reset', {
      value: () => {
        calls.length = 0;
      },
    });

    return spy;
  },

  /**
   * Creates a mock function with configurable behavior
   * 
   * @example
   * ```typescript
   * const mockFn = createMock()
   *   .mockResolvedValue('success')
   *   .mockRejectedValueOnce(new Error('fail'))
   *   .mockReturnValue('default');
   * ```
   */
  createMock<T extends (...args: unknown[]) => unknown = () => void>(impl?: T) {
    const queue: Array<{ type: 'resolve' | 'reject' | 'return'; value: unknown }> = [];
    let defaultImpl: { type: 'resolve' | 'reject' | 'return'; value: unknown } | null = impl ? { type: 'return', value: impl } : null;
    
    const mock = function(...args: unknown[]) {
      const nextImpl = queue.shift();
      const currentImpl = nextImpl ?? defaultImpl;
      if (!currentImpl) return undefined;
      
      if (currentImpl.type === 'reject') {
        throw currentImpl.value;
      }
      if (currentImpl.type === 'resolve') {
        return Promise.resolve(currentImpl.value);
      }
      if (typeof currentImpl.value === 'function') {
        return (currentImpl.value as T)(...args);
      }
      return currentImpl.value;
    } as T & {
      mockResolvedValue: <R>(value: R) => typeof mock;
      mockResolvedValueOnce: <R>(value: R) => typeof mock;
      mockRejectedValue: (value: unknown) => typeof mock;
      mockRejectedValueOnce: (value: unknown) => typeof mock;
      mockReturnValue: (value: unknown) => typeof mock;
      mockReturnValueOnce: (value: unknown) => typeof mock;
      mockImplementation: (fn: T) => typeof mock;
    };

    mock.mockResolvedValue = <R>(value: R) => {
      defaultImpl = { type: 'resolve', value };
      return mock;
    };

    mock.mockResolvedValueOnce = <R>(value: R) => {
      queue.push({ type: 'resolve', value });
      return mock;
    };

    mock.mockRejectedValue = (value: unknown) => {
      defaultImpl = { type: 'reject', value };
      return mock;
    };

    mock.mockRejectedValueOnce = (value: unknown) => {
      queue.push({ type: 'reject', value });
      return mock;
    };

    mock.mockReturnValue = (value: unknown) => {
      defaultImpl = { type: 'return', value };
      return mock;
    };

    mock.mockReturnValueOnce = (value: unknown) => {
      queue.push({ type: 'return', value });
      return mock;
    };

    mock.mockImplementation = (fn: T) => {
      defaultImpl = { type: 'return', value: fn };
      return mock;
    };

    return mock;
  },
};

/**
 * Assertion helpers for common test patterns
 */
export const AssertUtils = {
  /**
   * Asserts that a function throws an error matching the given pattern
   * 
   * @param fn - Function that should throw
   * @param pattern - Error message pattern or constructor
   * 
   * @example
   * ```typescript
   * assertThrows(() => riskyOperation(), /invalid/i);
   * assertThrows(() => riskyOperation(), TypeError);
   * ```
   */
  assertThrows(fn: () => unknown, pattern: RegExp | Function): void {
    try {
      fn();
      throw new Error("Expected function to throw");
    } catch (error) {
      if (pattern instanceof RegExp) {
        const message = error instanceof Error ? error.message : String(error);
        if (!pattern.test(message)) {
          throw new Error(`Expected error to match ${pattern}, got: ${message}`);
        }
      } else if (typeof pattern === 'function') {
        if (!(error instanceof pattern)) {
          throw new Error(`Expected error to be ${pattern.name}, got: ${error}`);
        }
      }
    }
  },

  /**
   * Asserts that all items in an array satisfy a predicate
   * 
   * @param array - Array to check
   * @param predicate - Predicate function
   * 
   * @example
   * ```typescript
   * assertAll([1, 2, 3], n => n > 0);
   * ```
   */
  assertAll<T>(array: T[], predicate: (item: T, index: number) => boolean): void {
    const failedIndex = array.findIndex(predicate);
    if (failedIndex === -1) {
      throw new Error(`Expected all items to satisfy predicate, but item at index ${failedIndex} failed`);
    }
  },

  /**
   * Asserts that none of the items in an array satisfy a predicate
   * 
   * @param array - Array to check
   * @param predicate - Predicate function
   * 
   * @example
   * ```typescript
   * assertNone([1, 2, 3], n => n < 0);
   * ```
   */
  assertNone<T>(array: T[], predicate: (item: T, index: number) => boolean): void {
    const foundIndex = array.findIndex(predicate);
    if (foundIndex !== -1) {
      throw new Error(`Expected no items to satisfy predicate, but item at index ${foundIndex} matched`);
    }
  },

  /**
   * Asserts that exactly one item in an array satisfies a predicate
   * 
   * @param array - Array to check
   * @param predicate - Predicate function
   * 
   * @example
   * ```typescript
   * assertOne([1, 2, 3], n => n === 2);
   * ```
   */
  assertOne<T>(array: T[], predicate: (item: T, index: number) => boolean): void {
    const matches = array.filter(predicate);
    if (matches.length !== 1) {
      throw new Error(`Expected exactly one item to satisfy predicate, got ${matches.length}`);
    }
  },
};

/**
 * DOM testing utilities
 */
export const DomTestUtils = {
  /**
   * Creates a shadow DOM for testing
   * 
   * @param tagName - HTML tag name for the custom element
   * @param shadowContent - Content to put in the shadow DOM
   * @returns The created custom element
   * 
   * @example
   * ```typescript
   * const element = createShadowElement('my-component', '<div>Content</div>');
   * document.body.appendChild(element);
   * ```
   */
  createShadowElement(tagName: string, shadowContent: string): HTMLElement {
    const element = document.createElement(tagName);
    const shadow = element.attachShadow({ mode: 'open' });
    shadow.innerHTML = shadowContent;
    return element;
  },

  /**
   * Fires an event on an element with all the proper bubbling
   * 
   * @param element - Target element
   * @param eventType - Type of event
   * @param options - Event options
   * 
   * @example
   * ```typescript
   * fireEvent(button, 'click');
   * fireEvent(input, 'input', { target: { value: 'test' } });
   * ```
   */
  fireEvent<T extends Event = Event>(
    element: Element,
    eventType: string,
    options?: EventInit
  ): T {
    const event = new Event(eventType, { bubbles: true, cancelable: true, ...options });
    element.dispatchEvent(event);
    return event as T;
  },

  /**
   * Waits for an element to be added to the DOM
   * 
   * @param selector - CSS selector to wait for
   * @param timeout - Maximum wait time in ms
   * @returns Promise resolving to the element
   * 
   * @example
   * ```typescript
   * const element = await waitForElement('.dynamic-content');
   * ```
   */
  async waitForElement<T extends Element = Element>(
    selector: string,
    timeout = 1000
  ): Promise<T> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      const element = document.querySelector<T>(selector);
      if (element) return element;
      await AsyncTestUtils.nextTick();
    }
    
    throw new Error(`Element matching '${selector}' not found within ${timeout}ms`);
  },

  /**
   * Waits for an element to be removed from the DOM
   * 
   * @param selector - CSS selector to wait for removal
   * @param timeout - Maximum wait time in ms
   * 
   * @example
   * ```typescript
   * await waitForElementRemoval('.loading-spinner');
   * ```
   */
  async waitForElementRemoval(selector: string, timeout = 1000): Promise<void> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      const element = document.querySelector(selector);
      if (!element) return;
      await AsyncTestUtils.nextTick();
    }
    
    throw new Error(`Element matching '${selector}' still present after ${timeout}ms`);
  },
};

/**
 * Export all utilities
 */
export const TestUtils = {
  withRetry,
  measurePerformance,
  withTimeout,
  createDebounce,
  createThrottle,
  SpyUtils,
  AssertUtils,
  DomTestUtils,
};
