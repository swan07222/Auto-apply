/**
 * Test Data Factories
 * 
 * Provides factory functions for creating test data objects with sensible defaults.
 * Use these factories to create consistent, realistic test data across all test suites.
 * 
 * @example
 * ```typescript
 * const profile = createProfile({ name: 'Custom Name' });
 * const job = createJob({ title: 'Senior Engineer' });
 * ```
 */

import { AutomationSettings, Profile } from "../../src/shared";

/**
 * Default test constants
 */
export const TEST_CONSTANTS = {
  DEFAULT_PROFILE_ID: "test-profile-001",
  DEFAULT_EMAIL: "test.user@example.com",
  DEFAULT_PHONE: "+1-555-0123",
  DEFAULT_CITY: "San Francisco",
  DEFAULT_STATE: "CA",
  DEFAULT_COUNTRY: "United States",
  DEFAULT_LINKEDIN: "https://linkedin.com/in/testuser",
  DEFAULT_PORTFOLIO: "https://example.com",
  DEFAULT_COMPANY: "Tech Corp",
  DEFAULT_JOB_TITLE: "Software Engineer",
  DEFAULT_YEARS_EXPERIENCE: "5",
  DEFAULT_WORK_AUTH: "US Citizen",
} as const;

/**
 * Profile factory options
 */
export interface ProfileOptions {
  id?: string;
  name?: string;
  email?: string;
  phone?: string;
  city?: string;
  state?: string;
  country?: string;
  linkedinUrl?: string;
  portfolioUrl?: string;
  currentCompany?: string;
  yearsExperience?: string;
  workAuthorization?: string;
  needsSponsorship?: string;
  willingToRelocate?: string;
  resume?: File | null;
  answers?: Record<string, string>;
  preferenceAnswers?: Record<string, string>;
  updatedAt?: number;
}

/**
 * Creates a test profile with sensible defaults
 * 
 * @param overrides - Partial options to override default values
 * @returns A complete Profile object
 * 
 * @example
 * ```typescript
 * const profile = createProfile({ 
 *   name: 'John Doe',
 *   email: 'john@example.com'
 * });
 * ```
 */
export function createProfile(overrides: ProfileOptions = {}): Profile {
  return {
    id: overrides.id ?? TEST_CONSTANTS.DEFAULT_PROFILE_ID,
    name: overrides.name ?? "Test User",
    email: overrides.email ?? TEST_CONSTANTS.DEFAULT_EMAIL,
    phone: overrides.phone ?? TEST_CONSTANTS.DEFAULT_PHONE,
    city: overrides.city ?? TEST_CONSTANTS.DEFAULT_CITY,
    state: overrides.state ?? TEST_CONSTANTS.DEFAULT_STATE,
    country: overrides.country ?? TEST_CONSTANTS.DEFAULT_COUNTRY,
    linkedinUrl: overrides.linkedinUrl ?? TEST_CONSTANTS.DEFAULT_LINKEDIN,
    portfolioUrl: overrides.portfolioUrl ?? TEST_CONSTANTS.DEFAULT_PORTFOLIO,
    currentCompany: overrides.currentCompany ?? TEST_CONSTANTS.DEFAULT_COMPANY,
    yearsExperience: overrides.yearsExperience ?? TEST_CONSTANTS.DEFAULT_YEARS_EXPERIENCE,
    workAuthorization: overrides.workAuthorization ?? TEST_CONSTANTS.DEFAULT_WORK_AUTH,
    needsSponsorship: overrides.needsSponsorship ?? "No",
    willingToRelocate: overrides.willingToRelocate ?? "Yes",
    resume: overrides.resume ?? null,
    answers: overrides.answers ?? {},
    preferenceAnswers: overrides.preferenceAnswers ?? {},
    updatedAt: overrides.updatedAt ?? Date.now(),
  };
}

/**
 * Automation settings factory options
 */
export interface AutomationSettingsOptions {
  activeProfileId?: string;
  profiles?: Record<string, Profile>;
  searchKeywords?: string;
  excludeKeywords?: string[];
  jobTypes?: string[];
  experienceLevels?: string[];
  remoteOnly?: boolean;
  datePosted?: string;
  salaryMin?: number;
  autoApply?: boolean;
  applyLimit?: number;
}

/**
 * Creates automation settings with sensible defaults
 * 
 * @param overrides - Partial options to override default values
 * @returns A complete AutomationSettings object
 * 
 * @example
 * ```typescript
 * const settings = createAutomationSettings({ 
 *   searchKeywords: 'frontend developer',
 *   autoApply: true
 * });
 * ```
 */
export function createAutomationSettings(
  overrides: AutomationSettingsOptions = {}
): AutomationSettings {
  const defaultProfile = createProfile();
  
  return {
    activeProfileId: overrides.activeProfileId ?? defaultProfile.id,
    profiles: overrides.profiles ?? { [defaultProfile.id]: defaultProfile },
    searchKeywords: overrides.searchKeywords ?? "software engineer",
    excludeKeywords: overrides.excludeKeywords ?? [],
    jobTypes: overrides.jobTypes ?? ["Full-time"],
    experienceLevels: overrides.experienceLevels ?? ["Mid-Level", "Senior"],
    remoteOnly: overrides.remoteOnly ?? true,
    datePosted: overrides.datePosted ?? "Last 7 days",
    salaryMin: overrides.salaryMin ?? 0,
    autoApply: overrides.autoApply ?? false,
    applyLimit: overrides.applyLimit ?? 10,
  };
}

/**
 * Job posting factory options
 */
export interface JobPostingOptions {
  id?: string;
  title?: string;
  company?: string;
  location?: string;
  remote?: boolean;
  salary?: string;
  postedDate?: string;
  applyUrl?: string;
  description?: string;
  requirements?: string[];
  jobType?: string;
  experienceLevel?: string;
}

/**
 * Creates a test job posting with sensible defaults
 * 
 * @param overrides - Partial options to override default values
 * @returns A job posting object
 * 
 * @example
 * ```typescript
 * const job = createJobPosting({ 
 *   title: 'Senior Frontend Developer',
 *   company: 'Startup Inc'
 * });
 * ```
 */
export function createJobPosting(overrides: JobPostingOptions = {}) {
  return {
    id: overrides.id ?? `job-${Date.now()}`,
    title: overrides.title ?? TEST_CONSTANTS.DEFAULT_JOB_TITLE,
    company: overrides.company ?? "Test Company",
    location: overrides.location ?? "Remote",
    remote: overrides.remote ?? true,
    salary: overrides.salary ?? "$120k - $180k",
    postedDate: overrides.postedDate ?? new Date().toISOString(),
    applyUrl: overrides.applyUrl ?? "https://example.com/apply",
    description: overrides.description ?? "Test job description",
    requirements: overrides.requirements ?? ["5+ years experience", "JavaScript"],
    jobType: overrides.jobType ?? "Full-time",
    experienceLevel: overrides.experienceLevel ?? "Mid-Level",
  };
}

/**
 * Application state factory options
 */
export interface ApplicationStateOptions {
  jobId?: string;
  site?: string;
  status?: "pending" | "in-progress" | "completed" | "failed" | "review";
  stage?: string;
  lastAction?: string;
  errorMessage?: string;
  appliedAt?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Creates a test application state
 * 
 * @param overrides - Partial options to override default values
 * @returns An application state object
 * 
 * @example
 * ```typescript
 * const appState = createApplicationState({ 
 *   status: 'completed',
 *   appliedAt: Date.now()
 * });
 * ```
 */
export function createApplicationState(overrides: ApplicationStateOptions = {}) {
  return {
    jobId: overrides.jobId ?? `job-${Date.now()}`,
    site: overrides.site ?? "indeed",
    status: overrides.status ?? "pending",
    stage: overrides.stage ?? "initial",
    lastAction: overrides.lastAction ?? "none",
    errorMessage: overrides.errorMessage ?? null,
    appliedAt: overrides.appliedAt ?? null,
    metadata: overrides.metadata ?? {},
  };
}

/**
 * DOM fixture helpers for common test scenarios
 */
export const DomFixtures = {
  /**
   * Creates a minimal form with common field types
   */
  createMinimalForm(): string {
    return `
      <form data-testid="test-form">
        <label for="email">Email</label>
        <input id="email" type="email" name="email" required />
        
        <label for="name">Full Name</label>
        <input id="name" type="text" name="name" required />
        
        <button type="submit">Submit</button>
      </form>
    `;
  },

  /**
   * Creates a form with validation errors
   */
  createFormWithErrors(): string {
    return `
      <form data-testid="test-form">
        <label for="email">Email</label>
        <input id="email" type="email" name="email" required aria-invalid="true" />
        <span class="error-message">Email is required</span>
        
        <label for="password">Password</label>
        <input id="password" type="password" name="password" required aria-invalid="true" />
        <span class="error-message">Password must be at least 8 characters</span>
        
        <button type="submit">Submit</button>
      </form>
    `;
  },

  /**
   * Creates a multi-step form
   */
  createMultiStepForm(steps = 3): string {
    const stepFields = [
      `<label for="email">Email</label><input id="email" type="email" />`,
      `<label for="experience">Experience</label><input id="experience" type="number" />`,
      `<label for="review">Review</label><textarea id="review"></textarea>`,
    ];

    return `
      <form data-testid="multi-step-form">
        ${stepFields.slice(0, steps).map((field, i) => `
          <div class="form-step" data-step="${i}" ${i > 0 ? 'style="display:none"' : ""}>
            ${field}
            <button type="button" data-action="${i === steps - 1 ? "submit" : "next"}">
              ${i === steps - 1 ? "Submit" : "Next"}
            </button>
          </div>
        `).join("")}
      </form>
    `;
  },

  /**
   * Creates a job posting card
   */
  createJobCard(overrides: Partial<JobPostingOptions> = {}): string {
    const job = createJobPosting(overrides);
    return `
      <article class="job-card" data-job-id="${job.id}">
        <h2 class="job-title">${job.title}</h2>
        <p class="company-name">${job.company}</p>
        <p class="job-location">${job.location}</p>
        ${job.salary ? `<p class="job-salary">${job.salary}</p>` : ""}
        <p class="job-posted">Posted: ${job.postedDate}</p>
        <button class="apply-button">Apply Now</button>
      </article>
    `;
  },

  /**
   * Creates a navigation header
   */
  createNavigationHeader(): string {
    return `
      <header role="banner">
        <nav role="navigation" aria-label="Main navigation">
          <ul>
            <li><a href="/jobs">Jobs</a></li>
            <li><a href="/applications">Applications</a></li>
            <li><a href="/settings">Settings</a></li>
            <li><a href="/profile">Profile</a></li>
          </ul>
        </nav>
      </header>
    `;
  },

  /**
   * Creates a modal dialog
   */
  createModal(title = "Dialog Title", content = "Dialog content"): string {
    return `
      <div class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div class="modal-content">
          <header>
            <h2 id="modal-title">${title}</h2>
            <button class="modal-close" aria-label="Close dialog">&times;</button>
          </header>
          <main>${content}</main>
          <footer>
            <button class="btn-secondary">Cancel</button>
            <button class="btn-primary">Confirm</button>
          </footer>
        </div>
      </div>
    `;
  },

  /**
   * Creates a loading state
   */
  createLoadingState(message = "Loading..."): string {
    return `
      <div class="loading-state" role="status" aria-live="polite">
        <div class="spinner" aria-hidden="true"></div>
        <p>${message}</p>
      </div>
    `;
  },

  /**
   * Creates an error state
   */
  createErrorState(message = "An error occurred", retryAction = true): string {
    return `
      <div class="error-state" role="alert">
        <p>${message}</p>
        ${retryAction ? '<button class="retry-button">Retry</button>' : ""}
      </div>
    `;
  },

  /**
   * Creates an empty state
   */
  createEmptyState(message = "No items found"): string {
    return `
      <div class="empty-state" role="status">
        <p>${message}</p>
      </div>
    `;
  },
};

/**
 * Async test utilities
 */
export const AsyncTestUtils = {
  /**
   * Waits for a condition to be true with timeout
   * 
   * @param condition - Function that returns a boolean
   * @param timeout - Maximum time to wait in ms (default: 1000)
   * @param interval - Check interval in ms (default: 50)
   * @returns Promise that resolves when condition is true
   * @throws Error if timeout is reached
   */
  async waitFor(
    condition: () => boolean | Promise<boolean>,
    timeout = 1000,
    interval = 50
  ): Promise<void> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      const result = await condition();
      if (result) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
    
    throw new Error(`waitFor timed out after ${timeout}ms`);
  },

  /**
   * Waits for next tick of event loop
   */
  async nextTick(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  },

  /**
   * Waits for multiple ticks
   * 
   * @param rounds - Number of ticks to wait
   */
  async flushAsync(rounds = 10): Promise<void> {
    for (let i = 0; i < rounds; i++) {
      await this.nextTick();
    }
  },

  /**
   * Creates a delayed promise
   * 
   * @param ms - Delay in milliseconds
   * @returns Promise that resolves after delay
   */
  delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },
};

/**
 * String test utilities
 */
export const StringUtils = {
  /**
   * Generates a random string
   * 
   * @param length - Length of string (default: 8)
   */
  random(length = 8): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  },

  /**
   * Generates a random email
   */
  randomEmail(): string {
    return `test.${this.random(6)}@example.com`;
  },

  /**
   * Generates a random URL
   */
  randomUrl(): string {
    return `https://example.com/${this.random()}`;
  },
};

/**
 * Number test utilities
 */
export const NumberUtils = {
  /**
   * Generates a random number in range
   * 
   * @param min - Minimum value (inclusive)
   * @param max - Maximum value (inclusive)
   */
  randomInRange(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  },

  /**
   * Generates a random timestamp
   * 
   * @param daysBack - Maximum days in the past (default: 30)
   */
  randomTimestamp(daysBack = 30): number {
    const now = Date.now();
    const past = now - daysBack * 24 * 60 * 60 * 1000;
    return this.randomInRange(past, now);
  },
};
