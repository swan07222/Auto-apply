/**
 * Page Object Models for Test Automation
 * 
 * Provides page object classes that encapsulate interactions with specific
 * UI components and pages. Use these to write more maintainable and
 * readable tests.
 * 
 * @example
 * ```typescript
 * const popup = new PopupPage();
 * await popup.open();
 * await popup.setSearchKeywords('software engineer');
 * await popup.startAutomation();
 * ```
 */

import { AsyncTestUtils } from "./factories";

/**
 * Base page object with common functionality
 */
export abstract class BasePage {
  /**
   * Base CSS selector for the page/component
   */
  protected abstract readonly selector: string;

  /**
   * Root element of the page/component
   */
  protected get root(): Element | null {
    return document.querySelector(this.selector);
  }

  /**
   * Queries for an element within the page/component
   */
  protected query<T extends Element = Element>(selector: string): T | null {
    const root = this.root;
    if (!root) return null;
    return root.querySelector<T>(selector);
  }

  /**
   * Queries for all matching elements within the page/component
   */
  protected queryAll<T extends Element = Element>(selector: string): T[] {
    const root = this.root;
    if (!root) return [];
    return Array.from(root.querySelectorAll<T>(selector));
  }

  /**
   * Clicks an element within the page/component
   */
  protected async clickElement(selector: string): Promise<boolean> {
    const element = this.query(selector);
    if (!element) return false;
    
    (element as HTMLElement).click();
    await AsyncTestUtils.nextTick();
    return true;
  }

  /**
   * Sets the value of an input field
   */
  protected async setInputValue(selector: string, value: string): Promise<boolean> {
    const input = this.query<HTMLInputElement>(selector);
    if (!input) return false;
    
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await AsyncTestUtils.nextTick();
    return true;
  }

  /**
   * Gets the text content of an element
   */
  protected getText(selector: string): string | null {
    const element = this.query(selector);
    return element?.textContent?.trim() ?? null;
  }

  /**
   * Checks if an element exists
   */
  protected exists(selector: string): boolean {
    return this.query(selector) !== null;
  }

  /**
   * Checks if an element is visible
   */
  protected isVisible(selector: string): boolean {
    const element = this.query<HTMLElement>(selector);
    if (!element) return false;
    
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.offsetParent !== null;
  }

  /**
   * Waits for an element to be visible
   */
  async waitForVisible(selector: string, timeout = 1000): Promise<boolean> {
    try {
      await AsyncTestUtils.waitFor(() => this.isVisible(selector), timeout);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Waits for an element to exist
   */
  async waitForExist(selector: string, timeout = 1000): Promise<boolean> {
    try {
      await AsyncTestUtils.waitFor(() => this.exists(selector), timeout);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Popup page object for testing the extension popup UI
 */
export class PopupPage extends BasePage {
  protected readonly selector = "body";

  // Selectors
  private readonly selectors = {
    searchKeywords: "#search-keywords",
    jobTypes: "#job-types",
    experienceLevels: "#experience-levels",
    remoteOnly: "#remote-only",
    datePosted: "#date-posted",
    salaryMin: "#salary-min",
    autoApply: "#auto-apply",
    applyLimit: "#apply-limit",
    profileSelect: "#profile-select",
    startButton: "#start-automation",
    stopButton: "#stop-automation",
    statusMessage: "#status-message",
    applicationCount: "#application-count",
    errorBanner: ".error-banner",
    successBanner: ".success-banner",
    profileModal: ".profile-modal",
    profileName: "#profile-name",
    profileEmail: "#profile-email",
    profilePhone: "#profile-phone",
    saveProfile: "#save-profile",
    cancelProfile: "#cancel-profile",
  } as const;

  /**
   * Sets search keywords
   */
  async setSearchKeywords(keywords: string): Promise<boolean> {
    return this.setInputValue(this.selectors.searchKeywords, keywords);
  }

  /**
   * Gets current search keywords
   */
  getSearchKeywords(): string | null {
    const input = this.query<HTMLInputElement>(this.selectors.searchKeywords);
    return input?.value ?? null;
  }

  /**
   * Sets job types filter
   */
  async setJobTypes(types: string[]): Promise<void> {
    const select = this.query<HTMLSelectElement>(this.selectors.jobTypes);
    if (select) {
      for (const option of Array.from(select.options)) {
        option.selected = types.includes(option.value);
      }
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await AsyncTestUtils.nextTick();
    }
  }

  /**
   * Sets remote only filter
   */
  async setRemoteOnly(remote: boolean): Promise<boolean> {
    const checkbox = this.query<HTMLInputElement>(this.selectors.remoteOnly);
    if (checkbox) {
      checkbox.checked = remote;
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));
      await AsyncTestUtils.nextTick();
      return true;
    }
    return false;
  }

  /**
   * Enables/disables auto-apply
   */
  async setAutoApply(enabled: boolean): Promise<boolean> {
    const checkbox = this.query<HTMLInputElement>(this.selectors.autoApply);
    if (checkbox) {
      checkbox.checked = enabled;
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));
      await AsyncTestUtils.nextTick();
      return true;
    }
    return false;
  }

  /**
   * Sets apply limit
   */
  async setApplyLimit(limit: number): Promise<boolean> {
    return this.setInputValue(this.selectors.applyLimit, limit.toString());
  }

  /**
   * Selects a profile
   */
  async selectProfile(profileId: string): Promise<boolean> {
    const select = this.query<HTMLSelectElement>(this.selectors.profileSelect);
    if (select) {
      select.value = profileId;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await AsyncTestUtils.nextTick();
      return true;
    }
    return false;
  }

  /**
   * Clicks start automation button
   */
  async startAutomation(): Promise<boolean> {
    return this.clickElement(this.selectors.startButton);
  }

  /**
   * Clicks stop automation button
   */
  async stopAutomation(): Promise<boolean> {
    return this.clickElement(this.selectors.stopButton);
  }

  /**
   * Gets status message
   */
  getStatusMessage(): string | null {
    return this.getText(this.selectors.statusMessage);
  }

  /**
   * Gets application count
   */
  getApplicationCount(): string | null {
    return this.getText(this.selectors.applicationCount);
  }

  /**
   * Checks if error banner is visible
   */
  hasError(): boolean {
    return this.isVisible(this.selectors.errorBanner);
  }

  /**
   * Checks if success banner is visible
   */
  hasSuccess(): boolean {
    return this.isVisible(this.selectors.successBanner);
  }

  /**
   * Opens profile modal
   */
  async openProfileModal(): Promise<boolean> {
    return this.clickElement("#open-profile-modal");
  }

  /**
   * Sets profile name
   */
  async setProfileName(name: string): Promise<boolean> {
    return this.setInputValue(this.selectors.profileName, name);
  }

  /**
   * Sets profile email
   */
  async setProfileEmail(email: string): Promise<boolean> {
    return this.setInputValue(this.selectors.profileEmail, email);
  }

  /**
   * Saves profile
   */
  async saveProfile(): Promise<boolean> {
    return this.clickElement(this.selectors.saveProfile);
  }

  /**
   * Cancels profile edit
   */
  async cancelProfileEdit(): Promise<boolean> {
    return this.clickElement(this.selectors.cancelProfile);
  }
}

/**
 * Form page object for testing application forms
 */
export class FormPage extends BasePage {
  protected readonly selector = "form";

  // Selectors
  private readonly selectors = {
    fields: "input, select, textarea",
    requiredFields: "[required], [aria-required='true']",
    submitButton: 'button[type="submit"], input[type="submit"]',
    nextButton: 'button:contains("Next"), [data-action="next"]',
    backButton: 'button:contains("Back"), [data-action="back"]',
    errorMessages: ".error-message, .field-error",
    fieldLabels: "label",
  } as const;

  /**
   * Gets all form fields
   */
  getFields(): Element[] {
    return this.queryAll(this.selectors.fields);
  }

  /**
   * Gets required form fields
   */
  getRequiredFields(): Element[] {
    return this.queryAll(this.selectors.requiredFields);
  }

  /**
   * Fills a text field
   */
  async fillField(selector: string, value: string): Promise<boolean> {
    return this.setInputValue(selector, value);
  }

  /**
   * Fills multiple fields at once
   */
  async fillFields(fields: Record<string, string>): Promise<void> {
    for (const [selector, value] of Object.entries(fields)) {
      await this.fillField(selector, value);
    }
  }

  /**
   * Selects a dropdown option
   */
  async selectOption(selector: string, optionValue: string): Promise<boolean> {
    const select = this.query<HTMLSelectElement>(selector);
    if (select) {
      select.value = optionValue;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await AsyncTestUtils.nextTick();
      return true;
    }
    return false;
  }

  /**
   * Selects a radio button
   */
  async selectRadio(name: string, value: string): Promise<boolean> {
    const radio = this.query<HTMLInputElement>(`input[type="radio"][name="${name}"][value="${value}"]`);
    if (radio) {
      radio.checked = true;
      radio.dispatchEvent(new Event("change", { bubbles: true }));
      await AsyncTestUtils.nextTick();
      return true;
    }
    return false;
  }

  /**
   * Checks a checkbox
   */
  async checkCheckbox(selector: string): Promise<boolean> {
    const checkbox = this.query<HTMLInputElement>(selector);
    if (checkbox) {
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));
      await AsyncTestUtils.nextTick();
      return true;
    }
    return false;
  }

  /**
   * Submits the form
   */
  async submit(): Promise<boolean> {
    return this.clickElement(this.selectors.submitButton);
  }

  /**
   * Clicks next button
   */
  async next(): Promise<boolean> {
    return this.clickElement(this.selectors.nextButton);
  }

  /**
   * Clicks back button
   */
  async back(): Promise<boolean> {
    return this.clickElement(this.selectors.backButton);
  }

  /**
   * Gets error messages
   */
  getErrorMessages(): string[] {
    return this.queryAll(this.selectors.errorMessages).map(el => el.textContent?.trim() ?? "");
  }

  /**
   * Checks if form has errors
   */
  hasErrors(): boolean {
    return this.queryAll(this.selectors.errorMessages).length > 0;
  }

  /**
   * Gets field label text
   */
  getFieldLabel(fieldSelector: string): string | null {
    const field = this.query(fieldSelector);
    if (!field) return null;
    
    const fieldId = field.id;
    if (fieldId) {
      const label = this.query(`label[for="${fieldId}"]`);
      return label?.textContent?.trim() ?? null;
    }
    
    // Check for wrapping label
    const parentLabel = field.closest("label");
    return parentLabel?.textContent?.trim() ?? null;
  }

  /**
   * Validates that all required fields are filled
   */
  areRequiredFieldsFilled(): boolean {
    const requiredFields = this.getRequiredFields();
    return requiredFields.every(field => {
      if (field instanceof HTMLInputElement) {
        if (field.type === "checkbox" || field.type === "radio") {
          return field.checked;
        }
        return field.value.trim() !== "";
      }
      if (field instanceof HTMLSelectElement) {
        return field.value !== "";
      }
      if (field instanceof HTMLTextAreaElement) {
        return field.value.trim() !== "";
      }
      return false;
    });
  }
}

/**
 * Job card page object for testing job posting displays
 */
export class JobCardPage extends BasePage {
  protected readonly selector = ".job-card";

  // Selectors
  private readonly selectors = {
    title: ".job-title",
    company: ".company-name",
    location: ".job-location",
    salary: ".job-salary",
    postedDate: ".job-posted",
    applyButton: ".apply-button, [data-action='apply']",
    savedButton: ".save-button, [data-action='save']",
    tags: ".job-tag, .job-requirement",
  } as const;

  /**
   * Gets job title
   */
  getTitle(): string | null {
    return this.getText(this.selectors.title);
  }

  /**
   * Gets company name
   */
  getCompany(): string | null {
    return this.getText(this.selectors.company);
  }

  /**
   * Gets job location
   */
  getLocation(): string | null {
    return this.getText(this.selectors.location);
  }

  /**
   * Gets salary range
   */
  getSalary(): string | null {
    return this.getText(this.selectors.salary);
  }

  /**
   * Gets posted date
   */
  getPostedDate(): string | null {
    return this.getText(this.selectors.postedDate);
  }

  /**
   * Clicks apply button
   */
  async apply(): Promise<boolean> {
    return this.clickElement(this.selectors.applyButton);
  }

  /**
   * Clicks save button
   */
  async save(): Promise<boolean> {
    return this.clickElement(this.selectors.savedButton);
  }

  /**
   * Gets job tags/requirements
   */
  getTags(): string[] {
    return this.queryAll(this.selectors.tags).map(el => el.textContent?.trim() ?? "");
  }

  /**
   * Checks if job is remote
   */
  isRemote(): boolean {
    const location = this.getLocation()?.toLowerCase() ?? "";
    return location.includes("remote") || location.includes("work from home");
  }
}

/**
 * Modal dialog page object
 */
export class ModalPage extends BasePage {
  protected readonly selector = "[role='dialog'], .modal, .modal-overlay";

  // Selectors
  private readonly selectors = {
    title: "[id*='modal-title'], .modal-title, h2",
    content: ".modal-content main, .modal-body",
    closeButton: ".modal-close, [aria-label='Close'], button.close",
    confirmButton: ".btn-primary, [data-action='confirm'], button[type='submit']",
    cancelButton: ".btn-secondary, [data-action='cancel'], button[type='button']",
  } as const;

  /**
   * Gets modal title
   */
  getTitle(): string | null {
    return this.getText(this.selectors.title);
  }

  /**
   * Gets modal content text
   */
  getContent(): string | null {
    return this.getText(this.selectors.content);
  }

  /**
   * Closes the modal
   */
  async close(): Promise<boolean> {
    return this.clickElement(this.selectors.closeButton);
  }

  /**
   * Confirms the modal action
   */
  async confirm(): Promise<boolean> {
    return this.clickElement(this.selectors.confirmButton);
  }

  /**
   * Cancels the modal action
   */
  async cancel(): Promise<boolean> {
    return this.clickElement(this.selectors.cancelButton);
  }

  /**
   * Checks if modal is open
   */
  isOpen(): boolean {
    return this.root !== null && this.isVisible("");
  }
}

/**
 * Navigation page object
 */
export class NavigationPage extends BasePage {
  protected readonly selector = "header, nav";

  // Selectors
  private readonly selectors = {
    links: "a[href]",
    menuButton: ".menu-button, [aria-label='Menu']",
    menu: ".nav-menu, .dropdown-menu",
    activeLink: ".active, [aria-current='page']",
  } as const;

  /**
   * Gets all navigation links
   */
  getLinks(): Array<{ text: string; href: string }> {
    return this.queryAll(this.selectors.links).map(el => ({
      text: el.textContent?.trim() ?? "",
      href: el.getAttribute("href") ?? "",
    }));
  }

  /**
   * Clicks a navigation link
   */
  async clickLink(hrefOrText: string): Promise<boolean> {
    const link = this.query(`a[href="${hrefOrText}"]`) ?? 
                 this.query(`a:contains("${hrefOrText}")`);
    if (link) {
      (link as HTMLAnchorElement).click();
      await AsyncTestUtils.nextTick();
      return true;
    }
    return false;
  }

  /**
   * Gets active navigation item
   */
  getActiveLink(): string | null {
    return this.getText(this.selectors.activeLink);
  }

  /**
   * Opens menu (for mobile navigation)
   */
  async openMenu(): Promise<boolean> {
    return this.clickElement(this.selectors.menuButton);
  }
}

/**
 * Table page object for testing data tables
 */
export class TablePage extends BasePage {
  protected readonly selector = "table";

  // Selectors
  private readonly selectors = {
    rows: "tbody tr",
    headerRows: "thead tr",
    cells: "td, th",
    sortHeaders: "th[data-sortable], th button",
    pagination: ".pagination, [role='navigation']",
    emptyState: ".empty-state, tbody tr:has(td[colspan])",
  } as const;

  /**
   * Gets number of data rows
   */
  getRowCount(): number {
    return this.queryAll(this.selectors.rows).length;
  }

  /**
   * Gets row data by index
   */
  getRowData(rowIndex: number): string[] {
    const row = this.queryAll(this.selectors.rows)[rowIndex];
    if (!row) return [];
    return Array.from(row.querySelectorAll("td")).map(cell => cell.textContent?.trim() ?? "");
  }

  /**
   * Gets cell value by row and column index
   */
  getCellValue(rowIndex: number, colIndex: number): string | null {
    const row = this.queryAll(this.selectors.rows)[rowIndex];
    if (!row) return null;
    const cell = row.querySelectorAll("td")[colIndex];
    return cell?.textContent?.trim() ?? null;
  }

  /**
   * Gets header labels
   */
  getHeaders(): string[] {
    const headerRow = this.query(this.selectors.headerRows);
    if (!headerRow) return [];
    return Array.from(headerRow.querySelectorAll("th")).map(cell => cell.textContent?.trim() ?? "");
  }

  /**
   * Sorts by column
   */
  async sortByColumn(columnIndex: number): Promise<boolean> {
    const headerRow = this.query(this.selectors.headerRows);
    if (!headerRow) return false;
    const sortHeader = headerRow.querySelectorAll("th")[columnIndex];
    if (sortHeader) {
      (sortHeader as HTMLElement).click();
      await AsyncTestUtils.nextTick();
      return true;
    }
    return false;
  }

  /**
   * Checks if table is empty
   */
  isEmpty(): boolean {
    return this.exists(this.selectors.emptyState) || this.getRowCount() === 0;
  }

  /**
   * Goes to next page
   */
  async nextPage(): Promise<boolean> {
    return this.clickElement(`${this.selectors.pagination} button:contains("Next"), ${this.selectors.pagination} [aria-label="Next page"]`);
  }

  /**
   * Goes to previous page
   */
  async previousPage(): Promise<boolean> {
    return this.clickElement(`${this.selectors.pagination} button:contains("Previous"), ${this.selectors.pagination} [aria-label="Previous page"]`);
  }
}

/**
 * Export all page objects
 */
export const pages = {
  popup: PopupPage,
  form: FormPage,
  jobCard: JobCardPage,
  modal: ModalPage,
  navigation: NavigationPage,
  table: TablePage,
} as const;
