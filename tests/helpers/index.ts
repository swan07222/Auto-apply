/**
 * Test Helpers Index
 * 
 * Central export point for all test helpers and utilities.
 * Import from this file to access all testing utilities.
 * 
 * @example
 * ```typescript
 * import { 
 *   createProfile, 
 *   ScenarioFixtures, 
 *   pages 
 * } from './helpers';
 * ```
 */

// Data factories
export {
  createProfile,
  createAutomationSettings,
  createJobPosting,
  createApplicationState,
  TEST_CONSTANTS,
  DomFixtures,
  AsyncTestUtils,
  StringUtils,
  NumberUtils,
  type ProfileOptions,
  type AutomationSettingsOptions,
  type JobPostingOptions,
  type ApplicationStateOptions,
} from "./factories";

// Custom matchers (auto-registered when imported)
export * from "./customMatchers";

// Page object models
export {
  BasePage,
  PopupPage,
  FormPage,
  JobCardPage,
  ModalPage,
  NavigationPage,
  TablePage,
  pages,
} from "./pageObjects";

// Test fixtures
export {
  ScenarioFixtures,
  StateFixtures,
  ResponseFixtures,
  EventFixtures,
} from "./fixtures";

// Mock utilities
export {
  createMockChromeStorageLocal,
  type MockStorageState,
} from "./mockChromeStorage";

// Test utilities (retry, performance, spies, etc.)
export {
  withRetry,
  measurePerformance,
  withTimeout,
  createDebounce,
  createThrottle,
  SpyUtils,
  AssertUtils,
  DomTestUtils,
  TestUtils,
  type RetryOptions,
  type PerformanceResult,
  type TimeoutOptions,
} from "./testUtils";
