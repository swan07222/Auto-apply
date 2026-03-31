/**
 * Test Fixtures for Common Scenarios
 * 
 * Provides pre-built DOM fixtures and state configurations for common
 * testing scenarios. Use these to quickly set up realistic test environments.
 * 
 * @example
 * ```typescript
 * import { ScenarioFixtures } from './fixtures';
 * 
 * document.body.innerHTML = ScenarioFixtures.LoggedInUser;
 * // or
 * document.body.innerHTML = ScenarioFixtures.FirstTimeUser;
 * ```
 */

import { createProfile, createAutomationSettings, createJobPosting } from "./factories";

/**
 * HTML fixture templates for common UI scenarios
 */
export const ScenarioFixtures = {
  /**
   * Logged-in user with populated profile
   */
  LoggedInUser: `
    <div id="app">
      <header role="banner">
        <nav role="navigation">
          <span class="user-greeting">Welcome back, Test User</span>
          <span class="user-email">test.user@example.com</span>
          <button id="logout">Logout</button>
        </nav>
      </header>
      <main>
        <section class="dashboard">
          <div class="stats">
            <div class="stat-card">
              <span class="stat-label">Applications</span>
              <span class="stat-value">15</span>
            </div>
            <div class="stat-card">
              <span class="stat-label">Interviews</span>
              <span class="stat-value">3</span>
            </div>
            <div class="stat-card">
              <span class="stat-label">Offers</span>
              <span class="stat-value">1</span>
            </div>
          </div>
        </section>
      </main>
    </div>
  `,

  /**
   * First-time user (no profile configured)
   */
  FirstTimeUser: `
    <div id="app">
      <header role="banner">
        <nav role="navigation">
          <button id="setup-profile">Set Up Profile</button>
        </nav>
      </header>
      <main>
        <section class="onboarding">
          <h1>Welcome to Job Search Automation</h1>
          <p>Let's get started by setting up your profile.</p>
          <button id="get-started">Get Started</button>
        </section>
      </main>
    </div>
  `,

  /**
   * Profile configuration modal
   */
  ProfileModal: `
    <div class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-content profile-modal">
        <header>
          <h2 id="modal-title">Edit Profile</h2>
          <button class="modal-close" aria-label="Close dialog">&times;</button>
        </header>
        <main>
          <form id="profile-form">
            <div class="form-group">
              <label for="profile-name">Full Name *</label>
              <input type="text" id="profile-name" name="name" required value="Test User" />
            </div>
            <div class="form-group">
              <label for="profile-email">Email *</label>
              <input type="email" id="profile-email" name="email" required value="test.user@example.com" />
            </div>
            <div class="form-group">
              <label for="profile-phone">Phone</label>
              <input type="tel" id="profile-phone" name="phone" value="+1-555-0123" />
            </div>
            <div class="form-group">
              <label for="profile-linkedin">LinkedIn URL</label>
              <input type="url" id="profile-linkedin" name="linkedinUrl" value="https://linkedin.com/in/testuser" />
            </div>
            <div class="form-group">
              <label for="profile-portfolio">Portfolio URL</label>
              <input type="url" id="profile-portfolio" name="portfolioUrl" value="https://example.com" />
            </div>
            <div class="form-row">
              <div class="form-group">
                <label for="profile-city">City</label>
                <input type="text" id="profile-city" name="city" value="San Francisco" />
              </div>
              <div class="form-group">
                <label for="profile-state">State</label>
                <input type="text" id="profile-state" name="state" value="CA" />
              </div>
            </div>
            <div class="form-group">
              <label for="profile-country">Country</label>
              <input type="text" id="profile-country" name="country" value="United States" />
            </div>
            <div class="form-group">
              <label for="profile-company">Current Company</label>
              <input type="text" id="profile-company" name="currentCompany" value="Tech Corp" />
            </div>
            <div class="form-group">
              <label for="profile-experience">Years of Experience</label>
              <input type="text" id="profile-experience" name="yearsExperience" value="5" />
            </div>
            <div class="form-group">
              <label for="profile-authorization">Work Authorization *</label>
              <select id="profile-authorization" name="workAuthorization" required>
                <option value="">Select one</option>
                <option value="US Citizen" selected>US Citizen</option>
                <option value="Green Card">Green Card</option>
                <option value="H1-B">H1-B</option>
                <option value="OPT">OPT</option>
              </select>
            </div>
            <div class="form-group">
              <label for="profile-sponsorship">Need Sponsorship?</label>
              <select id="profile-sponsorship" name="needsSponsorship">
                <option value="No" selected>No</option>
                <option value="Yes">Yes</option>
              </select>
            </div>
            <div class="form-group">
              <label for="profile-relocate">Willing to Relocate?</label>
              <select id="profile-relocate" name="willingToRelocate">
                <option value="Yes" selected>Yes</option>
                <option value="No">No</option>
              </select>
            </div>
          </form>
        </main>
        <footer>
          <button class="btn-secondary" id="cancel-profile">Cancel</button>
          <button class="btn-primary" id="save-profile">Save Profile</button>
        </footer>
      </div>
    </div>
  `,

  /**
   * Job search results page
   */
  JobSearchResults: `
    <div id="app">
      <header role="banner">
        <div class="search-header">
          <h1>Job Search Results</h1>
          <span class="result-count">125 jobs found</span>
        </div>
        <div class="filters">
          <select id="job-type-filter">
            <option value="">All Types</option>
            <option value="full-time" selected>Full-time</option>
            <option value="part-time">Part-time</option>
            <option value="contract">Contract</option>
          </select>
          <select id="experience-filter">
            <option value="">All Levels</option>
            <option value="entry">Entry Level</option>
            <option value="mid" selected>Mid Level</option>
            <option value="senior">Senior</option>
          </select>
          <label>
            <input type="checkbox" id="remote-filter" checked />
            Remote Only
          </label>
        </div>
      </header>
      <main>
        <div class="job-listings">
          <article class="job-card" data-job-id="job-001">
            <h2 class="job-title">Senior Software Engineer</h2>
            <p class="company-name">Tech Corp</p>
            <p class="job-location">Remote</p>
            <p class="job-salary">$150k - $200k</p>
            <p class="job-posted">Posted 2 days ago</p>
            <div class="job-tags">
              <span class="job-tag">Full-time</span>
              <span class="job-tag">Senior</span>
            </div>
            <button class="apply-button">Apply Now</button>
            <button class="save-button">Save</button>
          </article>
          <article class="job-card" data-job-id="job-002">
            <h2 class="job-title">Frontend Developer</h2>
            <p class="company-name">Startup Inc</p>
            <p class="job-location">San Francisco, CA (Remote)</p>
            <p class="job-salary">$120k - $160k</p>
            <p class="job-posted">Posted 1 day ago</p>
            <div class="job-tags">
              <span class="job-tag">Full-time</span>
              <span class="job-tag">Mid-Level</span>
            </div>
            <button class="apply-button">Apply Now</button>
            <button class="save-button">Save</button>
          </article>
          <article class="job-card" data-job-id="job-003">
            <h2 class="job-title">Full Stack Engineer</h2>
            <p class="company-name">Enterprise Co</p>
            <p class="job-location">New York, NY</p>
            <p class="job-salary">$140k - $180k</p>
            <p class="job-posted">Posted 5 days ago</p>
            <div class="job-tags">
              <span class="job-tag">Full-time</span>
              <span class="job-tag">Senior</span>
            </div>
            <button class="apply-button">Apply Now</button>
            <button class="save-button">Save</button>
          </article>
        </div>
        <nav class="pagination" role="navigation" aria-label="Search results pages">
          <button disabled aria-label="Previous page">Previous</button>
          <span class="page-numbers">
            <button class="active" aria-current="page">1</button>
            <button>2</button>
            <button>3</button>
          </span>
          <button aria-label="Next page">Next</button>
        </nav>
      </main>
    </div>
  `,

  /**
   * Application form (multi-step)
   */
  ApplicationForm: `
    <div id="app">
      <div class="progress-indicator">
        <div class="progress-step active" data-step="1">
          <span class="step-number">1</span>
          <span class="step-label">Personal Info</span>
        </div>
        <div class="progress-step" data-step="2">
          <span class="step-number">2</span>
          <span class="step-label">Experience</span>
        </div>
        <div class="progress-step" data-step="3">
          <span class="step-number">3</span>
          <span class="step-label">Review</span>
        </div>
      </div>
      <form id="application-form">
        <div class="form-step active" data-step="1">
          <h2>Personal Information</h2>
          <div class="form-group">
            <label for="first-name">First Name *</label>
            <input type="text" id="first-name" name="firstName" required />
          </div>
          <div class="form-group">
            <label for="last-name">Last Name *</label>
            <input type="text" id="last-name" name="lastName" required />
          </div>
          <div class="form-group">
            <label for="email">Email *</label>
            <input type="email" id="email" name="email" required />
          </div>
          <div class="form-group">
            <label for="phone">Phone *</label>
            <input type="tel" id="phone" name="phone" required />
          </div>
          <div class="form-group">
            <label for="resume">Resume *</label>
            <input type="file" id="resume" name="resume" accept=".pdf,.doc,.docx" required />
          </div>
          <button type="button" class="btn-next" data-action="next">Next</button>
        </div>
        <div class="form-step" data-step="2">
          <h2>Experience Details</h2>
          <div class="form-group">
            <label for="experience-years">Years of Experience *</label>
            <input type="number" id="experience-years" name="yearsExperience" required min="0" />
          </div>
          <div class="form-group">
            <label for="skills">Skills *</label>
            <textarea id="skills" name="skills" required></textarea>
          </div>
          <div class="form-group">
            <label for="linkedin">LinkedIn Profile</label>
            <input type="url" id="linkedin" name="linkedinUrl" />
          </div>
          <button type="button" class="btn-back" data-action="back">Back</button>
          <button type="button" class="btn-next" data-action="next">Next</button>
        </div>
        <div class="form-step" data-step="3">
          <h2>Review Application</h2>
          <div class="review-summary">
            <p>Please review your information before submitting.</p>
          </div>
          <div class="form-group">
            <label>
              <input type="checkbox" id="terms" name="terms" required />
              I agree to the terms and conditions *
            </label>
          </div>
          <button type="button" class="btn-back" data-action="back">Back</button>
          <button type="submit" class="btn-submit">Submit Application</button>
        </div>
      </form>
    </div>
  `,

  /**
   * Application in progress state
   */
  ApplicationInProgress: `
    <div id="app">
      <div class="application-status" role="status" aria-live="polite">
        <div class="spinner" aria-hidden="true"></div>
        <p>Submitting your application...</p>
        <p class="status-detail">Step 2 of 3: Uploading resume</p>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" style="width: 66%"></div>
      </div>
      <button class="btn-cancel">Cancel</button>
    </div>
  `,

  /**
   * Application success state
   */
  ApplicationSuccess: `
    <div id="app">
      <div class="success-message" role="status">
        <div class="success-icon" aria-hidden="true">✓</div>
        <h1>Application Submitted!</h1>
        <p>Your application for <strong>Senior Software Engineer</strong> at <strong>Tech Corp</strong> has been submitted.</p>
        <p class="confirmation-id">Confirmation ID: APP-2024-001234</p>
        <div class="next-steps">
          <h2>What's Next?</h2>
          <ul>
            <li>You'll receive a confirmation email shortly</li>
            <li>The employer will review your application</li>
            <li>You'll be notified if you're selected for an interview</li>
          </ul>
        </div>
        <button class="btn-primary">Search More Jobs</button>
        <button class="btn-secondary">View Applications</button>
      </div>
    </div>
  `,

  /**
   * Application error state
   */
  ApplicationError: `
    <div id="app">
      <div class="error-message" role="alert">
        <div class="error-icon" aria-hidden="true">⚠</div>
        <h1>Application Failed</h1>
        <p>We encountered an error while submitting your application.</p>
        <p class="error-detail">Error: Network timeout. Please try again.</p>
        <button class="btn-primary" id="retry-application">Retry</button>
        <button class="btn-secondary" id="cancel-application">Cancel</button>
      </div>
    </div>
  `,

  /**
   * Empty state (no jobs/applications)
   */
  EmptyState: `
    <div id="app">
      <div class="empty-state" role="status">
        <div class="empty-icon" aria-hidden="true">📭</div>
        <h2>No Jobs Found</h2>
        <p>Try adjusting your search filters or check back later.</p>
        <button class="btn-primary" id="clear-filters">Clear Filters</button>
      </div>
    </div>
  `,

  /**
   * Loading state
   */
  LoadingState: `
    <div id="app">
      <div class="loading-state" role="status" aria-live="polite">
        <div class="spinner" aria-hidden="true"></div>
        <p>Loading jobs...</p>
      </div>
    </div>
  `,

  /**
   * Network error state
   */
  NetworkError: `
    <div id="app">
      <div class="error-state" role="alert">
        <div class="error-icon" aria-hidden="true">⚠</div>
        <h2>Connection Error</h2>
        <p>Unable to connect to the server. Please check your internet connection.</p>
        <button class="btn-primary" id="retry">Retry</button>
      </div>
    </div>
  `,

  /**
   * Settings page
   */
  SettingsPage: `
    <div id="app">
      <header>
        <h1>Settings</h1>
      </header>
      <main>
        <section class="settings-section">
          <h2>Search Preferences</h2>
          <form id="search-settings">
            <div class="form-group">
              <label for="search-keywords">Default Keywords</label>
              <input type="text" id="search-keywords" value="software engineer" />
            </div>
            <div class="form-group">
              <label for="location">Location</label>
              <input type="text" id="location" value="Remote" />
            </div>
            <div class="form-group">
              <label for="radius">Radius (miles)</label>
              <input type="number" id="radius" value="50" />
            </div>
            <div class="form-group">
              <label>
                <input type="checkbox" id="remote-only" checked />
                Remote jobs only
              </label>
            </div>
            <button type="submit" class="btn-primary">Save Settings</button>
          </form>
        </section>
        <section class="settings-section">
          <h2>Automation Settings</h2>
          <form id="automation-settings">
            <div class="form-group">
              <label for="daily-limit">Daily Application Limit</label>
              <input type="number" id="daily-limit" value="10" min="1" max="100" />
            </div>
            <div class="form-group">
              <label>
                <input type="checkbox" id="auto-apply" />
                Enable auto-apply
              </label>
            </div>
            <div class="form-group">
              <label>
                <input type="checkbox" id="notifications" checked />
                Enable notifications
              </label>
            </div>
            <button type="submit" class="btn-primary">Save Automation</button>
          </form>
        </section>
        <section class="settings-section danger-zone">
          <h2>Danger Zone</h2>
          <button class="btn-danger" id="clear-data">Clear All Data</button>
          <button class="btn-danger" id="reset-settings">Reset to Defaults</button>
        </section>
      </main>
    </div>
  `,

  /**
   * Applications list page
   */
  ApplicationsList: `
    <div id="app">
      <header>
        <h1>My Applications</h1>
        <div class="filters">
          <select id="status-filter">
            <option value="">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="interview">Interview</option>
            <option value="offer">Offer</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
      </header>
      <main>
        <table class="applications-table">
          <thead>
            <tr>
              <th data-sortable>Company</th>
              <th data-sortable>Position</th>
              <th data-sortable>Date Applied</th>
              <th data-sortable>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr data-application-id="app-001">
              <td>Tech Corp</td>
              <td>Senior Software Engineer</td>
              <td>2024-01-15</td>
              <td><span class="status-badge pending">Pending</span></td>
              <td>
                <button class="btn-view">View</button>
                <button class="btn-withdraw">Withdraw</button>
              </td>
            </tr>
            <tr data-application-id="app-002">
              <td>Startup Inc</td>
              <td>Frontend Developer</td>
              <td>2024-01-10</td>
              <td><span class="status-badge interview">Interview</span></td>
              <td>
                <button class="btn-view">View</button>
                <button class="btn-withdraw">Withdraw</button>
              </td>
            </tr>
            <tr data-application-id="app-003">
              <td>Enterprise Co</td>
              <td>Full Stack Engineer</td>
              <td>2024-01-05</td>
              <td><span class="status-badge offer">Offer</span></td>
              <td>
                <button class="btn-view">View</button>
                <button class="btn-withdraw">Withdraw</button>
              </td>
            </tr>
          </tbody>
        </table>
      </main>
    </div>
  `,
};

/**
 * State fixtures for testing with different configurations
 */
export const StateFixtures = {
  /**
   * Default profile state
   */
  DefaultProfile: createProfile(),

  /**
   * Complete profile with all fields filled
   */
  CompleteProfile: createProfile({
    id: "complete-profile-001",
    name: "Complete User",
    email: "complete@example.com",
    phone: "+1-555-9999",
    city: "New York",
    state: "NY",
    country: "United States",
    linkedinUrl: "https://linkedin.com/in/completeuser",
    portfolioUrl: "https://completeuser.dev",
    currentCompany: "FAANG Corp",
    yearsExperience: "10",
    workAuthorization: "US Citizen",
    needsSponsorship: "No",
    willingToRelocate: "Yes",
  }),

  /**
   * Minimal profile (required fields only)
   */
  MinimalProfile: createProfile({
    id: "minimal-profile-001",
    name: "Minimal User",
    email: "minimal@example.com",
    phone: "",
    city: "",
    state: "",
    country: "",
    linkedinUrl: "",
    portfolioUrl: "",
    currentCompany: "",
    yearsExperience: "",
    workAuthorization: "",
  }),

  /**
   * Profile needing sponsorship
   */
  SponsorshipProfile: createProfile({
    id: "sponsorship-profile-001",
    name: "International User",
    email: "international@example.com",
    workAuthorization: "H1-B",
    needsSponsorship: "Yes",
  }),

  /**
   * Default automation settings
   */
  DefaultSettings: createAutomationSettings(),

  /**
   * Aggressive automation settings
   */
  AggressiveSettings: createAutomationSettings({
    searchKeywords: "software engineer developer",
    autoApply: true,
    applyLimit: 50,
    remoteOnly: true,
    jobTypes: ["Full-time", "Contract"],
    experienceLevels: ["Entry-Level", "Mid-Level", "Senior"],
  }),

  /**
   * Conservative automation settings
   */
  ConservativeSettings: createAutomationSettings({
    searchKeywords: "senior software engineer",
    autoApply: false,
    applyLimit: 5,
    remoteOnly: true,
    jobTypes: ["Full-time"],
    experienceLevels: ["Senior"],
    salaryMin: 150000,
  }),

  /**
   * Sample job posting
   */
  SampleJob: createJobPosting(),

  /**
   * Remote job posting
   */
  RemoteJob: createJobPosting({
    id: "remote-job-001",
    title: "Remote Frontend Developer",
    company: "Remote First Inc",
    location: "Remote (US)",
    remote: true,
    salary: "$130k - $170k",
  }),

  /**
   * High-paying job posting
   */
  HighPayingJob: createJobPosting({
    id: "high-paying-job-001",
    title: "Staff Software Engineer",
    company: "Big Tech Co",
    location: "San Francisco, CA",
    remote: false,
    salary: "$250k - $400k",
    experienceLevel: "Staff",
  }),

  /**
   * Entry-level job posting
   */
  EntryLevelJob: createJobPosting({
    id: "entry-level-job-001",
    title: "Junior Software Developer",
    company: "Startup Labs",
    location: "Remote",
    remote: true,
    salary: "$70k - $90k",
    experienceLevel: "Entry-Level",
    requirements: ["0-2 years experience", "JavaScript basics"],
  }),
};

/**
 * Mock response fixtures
 */
export const ResponseFixtures = {
  /**
   * Successful API response
   */
  Success: {
    ok: true,
    data: {},
  },

  /**
   * Successful response with data
   */
  SuccessWithData: <T>(data: T) => ({
    ok: true,
    data,
  }),

  /**
   * Error response
   */
  Error: (message: string) => ({
    ok: false,
    error: {
      message,
      code: "ERROR",
    },
  }),

  /**
   * Validation error response
   */
  ValidationError: (field: string, message: string) => ({
    ok: false,
    error: {
      message: `Validation failed: ${field}`,
      code: "VALIDATION_ERROR",
      details: { field, message },
    },
  }),

  /**
   * Network error response
   */
  NetworkError: {
    ok: false,
    error: {
      message: "Network error. Please check your connection.",
      code: "NETWORK_ERROR",
    },
  },

  /**
   * Timeout error response
   */
  TimeoutError: {
    ok: false,
    error: {
      message: "Request timed out. Please try again.",
      code: "TIMEOUT_ERROR",
    },
  },

  /**
   * Unauthorized error response
   */
  UnauthorizedError: {
    ok: false,
    error: {
      message: "Please log in to continue.",
      code: "UNAUTHORIZED",
    },
  },
};

/**
 * Event fixtures for simulating user interactions
 */
export const EventFixtures = {
  /**
   * Creates a click event
   */
  clickEvent: new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    composed: true,
  }),

  /**
   * Creates an input event
   */
  inputEvent: new Event("input", {
    bubbles: true,
    cancelable: true,
  }),

  /**
   * Creates a change event
   */
  changeEvent: new Event("change", {
    bubbles: true,
    cancelable: true,
  }),

  /**
   * Creates a focus event
   */
  focusEvent: new FocusEvent("focus", {
    bubbles: true,
    cancelable: true,
  }),

  /**
   * Creates a blur event
   */
  blurEvent: new FocusEvent("blur", {
    bubbles: true,
    cancelable: true,
  }),

  /**
   * Creates a submit event
   */
  submitEvent: new SubmitEvent("submit", {
    bubbles: true,
    cancelable: true,
  }),

  /**
   * Creates a keyboard event
   */
  keyEvent: (key: string, type: "keydown" | "keyup" | "keypress" = "keydown") =>
    new KeyboardEvent(type, {
      key,
      bubbles: true,
      cancelable: true,
    }),

  /**
   * Creates a form validation event
   */
  invalidEvent: new Event("invalid", {
    bubbles: true,
    cancelable: true,
  }),
};
