/**
 * Example Test File - Professional Test Patterns
 * 
 * This file demonstrates best practices for writing professional,
 * maintainable tests using the test utilities framework.
 * 
 * Key patterns demonstrated:
 * - Using test data factories
 * - Using page object models
 * - Using custom matchers
 * - Using test fixtures
 * - Using retry logic for flaky tests
 * - Using performance monitoring
 * - Proper test organization and naming
 */

import { vi } from "vitest";
import {
  // Data factories
  createProfile,
  createAutomationSettings,
  createJobPosting,
  TEST_CONSTANTS,
  
  // Page objects
  PopupPage,
  FormPage,
  pages,
  
  // Fixtures
  ScenarioFixtures,
  StateFixtures,
  ResponseFixtures,
  
  // Test utilities
  withRetry,
  measurePerformance,
  withTimeout,
  SpyUtils,
  DomTestUtils,
  
  // Mock utilities
  createMockChromeStorageLocal,
} from "./helpers";

// ============================================================================
// Test Data Setup
// ============================================================================

describe("Professional Test Examples", () => {
  // ============================================================================
  // Example 1: Using Data Factories
  // ============================================================================
  
  describe("Data Factory Patterns", () => {
    it("creates a profile with default values", () => {
      // Arrange
      const profile = createProfile();
      
      // Assert using custom matchers
      expect(profile).toHaveProfileProperty("email", TEST_CONSTANTS.DEFAULT_EMAIL);
      expect(profile).toHaveProfileProperty("name", "Test User");
    });

    it("creates a profile with custom overrides", () => {
      // Arrange
      const profile = createProfile({
        name: "John Doe",
        email: "john.doe@example.com",
        yearsExperience: "10",
      });
      
      // Assert
      expect(profile.name).toBe("John Doe");
      expect(profile.email).toBe("john.doe@example.com");
      expect(profile.yearsExperience).toBe("10");
    });

    it("creates automation settings with associated profile", () => {
      // Arrange
      const settings = createAutomationSettings({
        searchKeywords: "frontend developer",
        autoApply: true,
      });
      
      // Assert using custom matchers
      expect(settings).toBeValidAutomationSettings();
      expect(settings.searchKeywords).toBe("frontend developer");
      expect(settings.autoApply).toBe(true);
    });

    it("creates job postings with realistic data", () => {
      // Arrange
      const job = createJobPosting({
        title: "Senior Frontend Engineer",
        company: "Tech Startup",
        remote: true,
        salary: "$150k - $200k",
      });
      
      // Assert using custom matchers
      expect(job).toHaveJobProperty("remote", true);
      expect(job.title).toBe("Senior Frontend Engineer");
      expect(job.remote).toBe(true);
    });
  });

  // ============================================================================
  // Example 2: Using Page Object Models
  // ============================================================================
  
  describe("Page Object Patterns", () => {
    let popup: PopupPage;
    let form: FormPage;

    beforeEach(() => {
      popup = new PopupPage();
      form = new FormPage();
    });

    it("interacts with popup using page object", async () => {
      // Arrange
      document.body.innerHTML = `
        <div id="app">
          <input id="search-keywords" type="text" value="software engineer" />
          <input id="remote-only" type="checkbox" checked />
          <button id="start-automation">Start Automation</button>
          <span id="status-message">Ready</span>
        </div>
      `;
      
      // Act
      await popup.setSearchKeywords("frontend developer");
      await popup.setRemoteOnly(false);
      await popup.startAutomation();
      
      // Assert
      expect(popup.getSearchKeywords()).toBe("frontend developer");
      expect(popup.getStatusMessage()).toBe("Ready");
    });

    it("fills a form using page object", async () => {
      // Arrange
      document.body.innerHTML = `
        <form>
          <label for="email">Email</label>
          <input id="email" type="email" required />
          
          <label for="name">Name</label>
          <input id="name" type="text" required />
          
          <button type="submit">Submit</button>
        </form>
      `;
      
      // Act
      await form.fillFields({
        "#email": "test@example.com",
        "#name": "Test User",
      });
      
      // Assert using custom matchers
      expect(document).toHaveFieldValue("#email", "test@example.com");
      expect(document).toHaveFieldValue("#name", "Test User");
      expect(form.areRequiredFieldsFilled()).toBe(true);
    });

    it("uses predefined page objects from pages export", () => {
      // Arrange - using the pages export for consistency
      const jobCard = new pages.jobCard();
      
      document.body.innerHTML = `
        <article class="job-card">
          <h2 class="job-title">Software Engineer</h2>
          <p class="company-name">Tech Corp</p>
          <button class="apply-button">Apply Now</button>
        </article>
      `;
      
      // Assert
      expect(jobCard.getTitle()).toBe("Software Engineer");
      expect(jobCard.getCompany()).toBe("Tech Corp");
    });
  });

  // ============================================================================
  // Example 3: Using Test Fixtures
  // ============================================================================
  
  describe("Fixture Patterns", () => {
    it("uses scenario fixtures for common UI states", () => {
      // Arrange - Using predefined fixture
      document.body.innerHTML = ScenarioFixtures.LoggedInUser;
      
      // Assert
      expect(document).toContainElement(".user-greeting");
      expect(document).toContainElement(".dashboard");
    });

    it("uses state fixtures for testing with different configurations", () => {
      // Arrange
      const completeProfile = StateFixtures.CompleteProfile;
      const aggressiveSettings = StateFixtures.AggressiveSettings;
      
      // Assert
      expect(completeProfile.email).toBe("complete@example.com");
      expect(aggressiveSettings.autoApply).toBe(true);
      expect(aggressiveSettings.applyLimit).toBe(50);
    });

    it("uses response fixtures for mocking API responses", () => {
      // Arrange
      const successResponse = ResponseFixtures.SuccessWithData({
        id: "123",
        name: "Test",
      });
      const errorResponse = ResponseFixtures.Error("Something went wrong");
      
      // Assert
      expect(successResponse.ok).toBe(true);
      expect(errorResponse.ok).toBe(false);
      expect(errorResponse.error.message).toBe("Something went wrong");
    });

    it("uses DOM fixtures for complex scenarios", () => {
      // Arrange
      document.body.innerHTML = ScenarioFixtures.ApplicationForm;
      
      // Assert
      expect(document).toContainElement("#application-form");
      expect(document).toContainElement(".form-step[data-step='1']");
      expect(document.querySelectorAll(".form-group").length).toBeGreaterThan(5);
    });
  });

  // ============================================================================
  // Example 4: Using Retry Logic for Flaky Tests
  // ============================================================================
  
  describe("Retry Patterns", () => {
    it("handles flaky operations with retry", async () => {
      // Arrange
      let attempts = 0;
      const flakyOperation = () => {
        attempts++;
        if (attempts < 3) {
          throw new Error("Network error");
        }
        return "success";
      };
      
      // Act & Assert - Retry until success
      const result = await withRetry(flakyOperation, {
        maxRetries: 3,
        delay: 10,
        onRetry: (attempt, error) => {
          console.log(`Retry ${attempt}: ${error.message}`);
        },
      });
      
      expect(result).toBe("success");
      expect(attempts).toBe(3);
    });

    it("retries only on specific errors", async () => {
      // Arrange
      let attempts = 0;
      const flakyOperation = () => {
        attempts++;
        if (attempts < 2) {
          throw new Error("Temporary failure");
        }
        return "success";
      };
      
      // Act & Assert - Only retry on temporary errors
      const result = await withRetry(flakyOperation, {
        maxRetries: 3,
        retryIf: (error) => error.message.includes("Temporary"),
      });
      
      expect(result).toBe("success");
    });
  });

  // ============================================================================
  // Example 5: Using Performance Monitoring
  // ============================================================================
  
  describe("Performance Patterns", () => {
    it("measures operation performance", async () => {
      // Act
      const { result, duration } = await measurePerformance(async () => {
        // Simulate some work
        await new Promise(resolve => setTimeout(resolve, 10));
        return "done";
      });
      
      // Assert
      expect(result).toBe("done");
      expect(duration).toBeGreaterThanOrEqual(10);
      expect(duration).toBeLessThan(100); // Performance budget
    });

    it("enforces performance budgets", async () => {
      // Act & Assert
      const { duration } = await measurePerformance(async () => {
        // Fast operation
        return "fast";
      });
      
      expect(duration).toBeLessThan(50); // 50ms budget
    });
  });

  // ============================================================================
  // Example 6: Using Timeout Handling
  // ============================================================================
  
  describe("Timeout Patterns", () => {
    it("handles long-running operations with timeout", async () => {
      // Arrange
      const slowOperation = async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return "completed";
      };
      
      // Act & Assert
      const result = await withTimeout(slowOperation, {
        timeout: 1000,
        message: "Operation took too long",
      });
      
      expect(result).toBe("completed");
    });

    it("throws on timeout", async () => {
      // Arrange
      const verySlowOperation = async () => {
        await new Promise(resolve => setTimeout(resolve, 2000));
        return "completed";
      };
      
      // Act & Assert
      await expect(
        withTimeout(verySlowOperation, { timeout: 100 })
      ).rejects.toThrow("Test timed out after 100ms");
    });
  });

  // ============================================================================
  // Example 7: Using Spy Utilities
  // ============================================================================
  
  describe("Spy Patterns", () => {
    it("tracks function calls with spy", () => {
      // Arrange
      const callback = SpyUtils.createSpy();
      
      // Act
      callback("arg1", "arg2");
      callback("arg3");
      
      // Assert
      expect(callback.callCount).toBe(2);
      expect(callback.calls[0]).toEqual(["arg1", "arg2"]);
      expect(callback.calls[1]).toEqual(["arg3"]);
      expect(callback.lastCall).toEqual(["arg3"]);
    });

    it("creates configurable mocks", () => {
      // Arrange
      const mockFn = SpyUtils.createMock()
        .mockReturnValueOnce("first")
        .mockReturnValueOnce("second")
        .mockReturnValue("default");
      
      // Act & Assert
      expect(mockFn()).toBe("first");
      expect(mockFn()).toBe("second");
      expect(mockFn()).toBe("default");
      expect(mockFn()).toBe("default");
    });

    it("mocks async operations", async () => {
      // Arrange
      const mockAsync = SpyUtils.createMock<() => Promise<string>>();
      mockAsync.mockResolvedValueOnce("success1");
      mockAsync.mockResolvedValueOnce("success2");
      mockAsync.mockRejectedValueOnce(new Error("failed"));
      
      // Act & Assert - Note: mock returns wrapped promises
      const result1 = await mockAsync();
      expect(result1).toBe("success1");
      
      const result2 = await mockAsync();
      expect(result2).toBe("success2");
      
      await expect(async () => mockAsync()).rejects.toThrow("failed");
    });
  });

  // ============================================================================
  // Example 8: Using DOM Test Utilities
  // ============================================================================
  
  describe("DOM Testing Patterns", () => {
    it("creates and tests shadow DOM elements", () => {
      // Arrange
      const shadowElement = DomTestUtils.createShadowElement(
        "test-component",
        "<div class='content'>Shadow Content</div>"
      );
      document.body.appendChild(shadowElement);
      
      // Act
      const shadowContent = shadowElement.shadowRoot?.querySelector(".content");
      
      // Assert
      expect(shadowContent).not.toBeNull();
      expect(shadowContent?.textContent).toBe("Shadow Content");
    });

    it("fires events with proper bubbling", () => {
      // Arrange
      document.body.innerHTML = `
        <div id="parent">
          <button id="child">Click me</button>
        </div>
      `;
      
      const parent = document.getElementById("parent");
      const child = document.getElementById("child");
      const clickSpy = SpyUtils.createSpy();
      
      parent?.addEventListener("click", clickSpy);
      
      // Act
      DomTestUtils.fireEvent(child!, "click");
      
      // Assert
      expect(clickSpy.callCount).toBe(1);
    });

    it("waits for dynamic elements", async () => {
      // Arrange
      document.body.innerHTML = "<div id='container'></div>";
      
      // Simulate dynamic content
      setTimeout(() => {
        const container = document.getElementById("container");
        if (container) {
          container.innerHTML = '<span class="dynamic">Dynamic Content</span>';
        }
      }, 10);
      
      // Act
      const element = await DomTestUtils.waitForElement(".dynamic", 1000);
      
      // Assert
      expect(element).not.toBeNull();
      expect(element.textContent).toBe("Dynamic Content");
    });
  });

  // ============================================================================
  // Example 9: Using Custom Matchers
  // ============================================================================
  
  describe("Custom Matcher Patterns", () => {
    it("uses domain-specific matchers for actions", () => {
      // Arrange
      const clickAction = { type: "click", element: document.createElement("button") };
      const navigateAction = { type: "navigate", url: "https://example.com" };
      
      // Assert
      expect(clickAction).toBeClickAction();
      expect(navigateAction).toBeNavigateAction();
      expect(clickAction).toBeProgressionAction("click");
      expect(navigateAction).toBeProgressionAction("navigate");
    });

    it("uses matchers for application state", () => {
      // Arrange
      const completedState = { status: "completed" as const };
      const pendingState = { status: "pending" as const };
      
      // Assert
      expect(completedState).toHaveApplicationStatus("completed");
      expect(completedState).toBeTerminalState();
      expect(pendingState).not.toBeTerminalState();
    });

    it("uses matchers for DOM assertions", () => {
      // Arrange
      document.body.innerHTML = `
        <form>
          <label for="email">Email</label>
          <input id="email" type="email" required value="test@example.com" />
          <button id="submit" type="submit" disabled>Submit</button>
          <div class="error-message">Error occurred</div>
        </form>
      `;
      
      const button = document.getElementById("submit")!;
      const errorDiv = document.querySelector(".error-message")!;
      
      // Assert
      expect(document).toHaveField("#email");
      expect(document).toHaveRequiredField("#email");
      expect(document).toHaveFieldValue("#email", "test@example.com");
      expect(errorDiv).toContainText("Error");
      expect(button).toBeDisabled();
      expect(button).not.toBeEnabled();
    });

    it("uses matchers for range and approximation", () => {
      // Arrange
      const score = 85;
      const pi = 3.14159;
      
      // Assert
      expect(score).toBeInRange(0, 100);
      expect(pi).toBeApproximately(3.14, 0.01);
    });
  });

  // ============================================================================
  // Example 10: Using Mock Chrome Storage
  // ============================================================================
  
  describe("Chrome Storage Mock Patterns", () => {
    it("creates and uses mock storage", async () => {
      // Arrange
      const mockStorage = createMockChromeStorageLocal({
        existingKey: "existingValue",
      });
      
      // Act
      await mockStorage.set({ newKey: "newValue" });
      const all = await mockStorage.get();
      const single = await mockStorage.get("existingKey");
      
      // Assert
      expect(all.existingKey).toBe("existingValue");
      expect(all.newKey).toBe("newValue");
      expect(single.existingKey).toBe("existingValue");
    });

    it("removes and clears storage", async () => {
      // Arrange
      const mockStorage = createMockChromeStorageLocal({
        key1: "value1",
        key2: "value2",
        key3: "value3",
      });
      
      // Act
      await mockStorage.remove("key1");
      await mockStorage.clear();
      const afterClear = await mockStorage.get();
      
      // Assert
      expect(afterClear).toEqual({});
    });
  });

  // ============================================================================
  // Example 11: Comprehensive Integration Test
  // ============================================================================
  
  describe("Integration Test Patterns", () => {
    it("tests complete user flow with all utilities", async () => {
      // Arrange - Setup with fixtures
      document.body.innerHTML = `
        <div id="app">
          <form>
            <input id="search-keywords" type="text" value="software engineer" />
            <input id="profile-name" type="text" value="Default Name" />
            <input id="profile-email" type="email" value="default@example.com" />
          </form>
        </div>
      `;
      
      const popup = new PopupPage();
      const form = new FormPage();
      
      // Act - Perform user actions with performance monitoring
      const { duration } = await measurePerformance(async () => {
        await form.fillFields({
          "#profile-name": "Integration Test User",
          "#profile-email": "integration@example.com",
        });
        
        await popup.setSearchKeywords("integration test");
      });
      
      // Assert - Verify results
      const nameInput = document.querySelector<HTMLInputElement>("#profile-name");
      const emailInput = document.querySelector<HTMLInputElement>("#profile-email");
      expect(nameInput?.value).toBe("Integration Test User");
      expect(emailInput?.value).toBe("integration@example.com");
      expect(popup.getSearchKeywords()).toBe("integration test");
      expect(duration).toBeLessThan(500); // Performance budget
    });
  });
});

// ============================================================================
// Best Practices Summary
// ============================================================================

/**
 * Test Organization:
 * - Group related tests in describe blocks
 * - Use descriptive test names that explain the scenario
 * - Follow Arrange-Act-Assert pattern
 * 
 * Data Management:
 * - Use factories instead of inline objects
 * - Use fixtures for complex DOM structures
 * - Keep test data separate from test logic
 * 
 * Page Objects:
 * - Encapsulate DOM interactions in page objects
 * - Use selectors from the page object, not inline
 * - Reuse page objects across tests
 * 
 * Assertions:
 * - Use custom matchers for domain-specific assertions
 * - Write assertions that provide clear error messages
 * - Test behavior, not implementation
 * 
 * Performance:
 * - Monitor performance of critical operations
 * - Set and enforce performance budgets
 * - Use timeouts for async operations
 * 
 * Reliability:
 * - Use retry logic for genuinely flaky operations
 * - Don't use retry to hide real bugs
 * - Handle timeouts gracefully
 */
