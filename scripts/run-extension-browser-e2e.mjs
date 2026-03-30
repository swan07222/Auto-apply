import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { chromium } from "playwright";

const EXTENSION_PATH = path.resolve("dist");
const SETTINGS_KEY = "remote-job-search-settings";
const APPLIED_HISTORY_KEY = "remote-job-search-applied-job-history";
const HEADLESS = process.argv.includes("--headless");
const LOG_PROGRESS = process.argv.includes("--verbose");
const RUN_GREENHOUSE =
  process.argv.includes("--greenhouse") || !process.argv.includes("--zip");
const RUN_ZIP =
  process.argv.includes("--zip") || !process.argv.includes("--greenhouse");

function logProgress(scope, message) {
  if (!LOG_PROGRESS) {
    return;
  }

  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${scope}] ${message}`);
}

function buildSettings(searchKeywords) {
  const now = Date.now();
  const profileId = "default-profile";

  return {
    jobPageLimit: 2,
    autoUploadResumes: true,
    searchMode: "job_board",
    startupRegion: "auto",
    datePostedWindow: "any",
    searchKeywords,
    activeProfileId: profileId,
    profiles: {
      [profileId]: {
        id: profileId,
        name: "Default Profile",
        candidate: {
          fullName: "Ava Stone",
          email: "ava.stone@example.com",
          phone: "+1 602 555 0184",
          city: "Phoenix",
          state: "Arizona",
          country: "United States",
          linkedinUrl: "https://www.linkedin.com/in/ava-stone",
          portfolioUrl: "https://ava-stone.dev",
          currentCompany: "Example Co",
          yearsExperience: "7",
          workAuthorization: "Authorized to work in the United States",
          needsSponsorship: "No",
          willingToRelocate: "Yes",
        },
        resume: null,
        answers: {},
        preferenceAnswers: {},
        updatedAt: now,
      },
    },
    candidate: {
      fullName: "Ava Stone",
      email: "ava.stone@example.com",
      phone: "+1 602 555 0184",
      city: "Phoenix",
      state: "Arizona",
      country: "United States",
      linkedinUrl: "https://www.linkedin.com/in/ava-stone",
      portfolioUrl: "https://ava-stone.dev",
      currentCompany: "Example Co",
      yearsExperience: "7",
      workAuthorization: "Authorized to work in the United States",
      needsSponsorship: "No",
      willingToRelocate: "Yes",
    },
    resume: null,
    resumes: {},
    answers: {},
    preferenceAnswers: {},
  };
}

function greenhouseBoardHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Impiricus Jobs</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 0; background: #f7f7f7; color: #1d1d1d; }
      main { max-width: 980px; margin: 0 auto; padding: 48px 24px 96px; }
      .job-card { display: block; padding: 24px; margin: 18px 0; background: #fff; border: 1px solid #d7d7d7; border-radius: 18px; color: inherit; text-decoration: none; }
      .job-card h2 { margin: 0 0 8px; font-size: 28px; color: #245cd5; }
      .job-card p { margin: 0; color: #4b5563; }
    </style>
  </head>
  <body>
    <main>
      <h1>Impiricus Open Roles</h1>
      <a class="job-card" href="https://job-boards.greenhouse.io/impiricus/jobs/gh-1">
        <h2>Senior Platform Engineer</h2>
        <p>Remote</p>
      </a>
      <a class="job-card" href="https://job-boards.greenhouse.io/impiricus/jobs/gh-2">
        <h2>Staff Full Stack Engineer</h2>
        <p>Remote</p>
      </a>
    </main>
  </body>
</html>`;
}

function greenhouseJobHtml(jobId, title) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 0; background: #ffffff; color: #121826; }
      main { max-width: 920px; margin: 0 auto; padding: 48px 24px 120px; }
      .hero { min-height: 420px; }
      .spacer { height: 2900px; }
      .primary-button,
      .secondary-button,
      .submit-button {
        border: 0;
        border-radius: 999px;
        padding: 14px 28px;
        font-size: 18px;
        cursor: pointer;
      }
      .primary-button { background: #245cd5; color: #fff; }
      .secondary-button,
      .submit-button { background: #121826; color: #fff; }
      .application-shell { display: none; padding: 24px; border: 1px solid #d8dee9; border-radius: 18px; background: #f9fafb; }
      .field { display: grid; gap: 8px; margin-bottom: 20px; }
      .field label { font-weight: 700; }
      .field input { padding: 14px 16px; border: 1px solid #b7c0cc; border-radius: 12px; font-size: 16px; }
      .hidden { display: none; }
      .review-copy { margin: 0 0 20px; }
      .success { max-width: 860px; margin: 0 auto; padding: 64px 24px; }
      .success h1 { font-size: 42px; margin-bottom: 16px; }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <a href="https://job-boards.greenhouse.io/impiricus">Back to jobs</a>
        <h1>${title}</h1>
        <p>Remote</p>
        <div id="apply-anchor" style="margin-top: 28px;"></div>
      </section>
      <div class="spacer" id="pre-form-spacer"></div>
      <section class="application-shell" id="application-shell">
        <form id="application-form" novalidate>
          <section id="application-step-1">
            <div class="field">
              <label for="first_name">First Name</label>
              <input id="first_name" name="first_name" type="text" autocomplete="given-name" required />
            </div>
            <div class="field">
              <label for="last_name">Last Name</label>
              <input id="last_name" name="last_name" type="text" autocomplete="family-name" required />
            </div>
            <div class="field">
              <label for="email">Email</label>
              <input id="email" name="email" type="email" autocomplete="email" required />
            </div>
            <div class="field">
              <label for="phone">Phone</label>
              <input id="phone" name="phone" type="tel" autocomplete="tel" required />
            </div>
            <button class="secondary-button" id="continue-button" type="button">Continue</button>
          </section>
          <section class="hidden" id="application-step-2">
            <p class="review-copy">Review your application details, then submit.</p>
            <button class="submit-button" id="submit-button" type="submit">Submit Application</button>
          </section>
        </form>
      </section>
    </main>
    <script>
      window.__scenario = {
        site: "greenhouse",
        jobId: ${JSON.stringify(jobId)},
        title: ${JSON.stringify(title)},
        applyButtonClicked: false,
        continueClicked: false,
        submitClicked: false,
        maxScrollY: 0,
        fireworksSeen: false,
        overlaySeen: false
      };

      const updateMaxScrollY = () => {
        window.__scenario.maxScrollY = Math.max(
          window.__scenario.maxScrollY,
          window.scrollY || document.documentElement.scrollTop || 0
        );
      };
      window.addEventListener("scroll", updateMaxScrollY, { passive: true });
      updateMaxScrollY();

      const fireworksObserver = new MutationObserver(() => {
        const overlayHost = document.querySelector("#remote-job-search-overlay-host");
        if (overlayHost && !window.__scenario.overlaySeen) {
          window.__scenario.overlaySeen = true;
          console.log("[scenario greenhouse] overlay seen", window.__scenario.jobId);
        }

        if (
          window.__scenario.fireworksSeen ||
          !Array.from(document.querySelectorAll("style")).some((styleElement) =>
            (styleElement.textContent || "").includes("rjs-firework-burst")
          )
        ) {
          return;
        }

        window.__scenario.fireworksSeen = true;
        console.log("[scenario greenhouse] fireworks seen", window.__scenario.jobId);
        fireworksObserver.disconnect();
      });
      fireworksObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });

      function attachApplyButton() {
        const anchor = document.getElementById("apply-anchor");
        const button = document.createElement("button");
        button.type = "button";
        button.id = "apply-button";
        button.className = "primary-button";
        button.textContent = "Apply";
        button.addEventListener("click", () => {
          window.__scenario.applyButtonClicked = true;
          console.log("[scenario greenhouse] apply clicked", window.__scenario.jobId);
          button.disabled = true;
          button.textContent = "Opening application...";
          setTimeout(() => {
            document.getElementById("application-shell").style.display = "block";
          }, 900);
        });
        anchor.append(button);
      }

      setTimeout(attachApplyButton, 1400);

      document.getElementById("continue-button").addEventListener("click", () => {
        window.__scenario.continueClicked = true;
        console.log("[scenario greenhouse] continue clicked", window.__scenario.jobId);
        document.getElementById("application-step-1").classList.add("hidden");
        document.getElementById("application-step-2").classList.remove("hidden");
      });

      document.getElementById("application-form").addEventListener("submit", (event) => {
        event.preventDefault();
        window.__scenario.submitClicked = true;
        console.log("[scenario greenhouse] submit clicked", window.__scenario.jobId);
        document.body.innerHTML = \`
          <main class="success">
            <h1>Your application has been submitted</h1>
            <p>Thank you for applying to ${title}.</p>
          </main>
        \`;
      });
    </script>
  </body>
</html>`;
}

function zipSearchHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>ZipRecruiter Search</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 0; background: #f5f7fb; color: #102132; }
      main { max-width: 980px; margin: 0 auto; padding: 48px 24px 96px; }
      .job-card { display: block; padding: 24px; margin: 18px 0; background: #fff; border: 1px solid #d7deea; border-radius: 18px; color: inherit; text-decoration: none; }
      .job-card h2 { margin: 0 0 8px; font-size: 28px; }
      .job-card p { margin: 0; color: #516273; }
    </style>
  </head>
  <body>
    <main>
      <h1>Full Stack Jobs</h1>
      <a class="job-card" href="https://www.ziprecruiter.com/jobs/acme-cloud?jid=zip-1">
        <h2>Full Stack Engineer</h2>
        <p>Remote</p>
      </a>
      <a class="job-card" href="https://www.ziprecruiter.com/jobs/acme-data?jid=zip-2">
        <h2>Senior Product Engineer</h2>
        <p>Remote</p>
      </a>
    </main>
  </body>
</html>`;
}

function zipJobHtml(jobId, title) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 0; background: #ffffff; color: #102132; }
      main { max-width: 980px; margin: 0 auto; padding: 40px 24px 96px; }
      .hero { display: grid; gap: 18px; align-items: start; }
      .apply-button { width: 220px; border: 0; border-radius: 16px; padding: 16px 20px; font-size: 18px; cursor: pointer; color: #fff; background: #12706d; }
      .modal-backdrop { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; background: rgba(16, 33, 50, 0.38); }
      .modal-backdrop.open { display: flex; }
      .modal { width: min(720px, calc(100vw - 32px)); max-height: calc(100vh - 80px); overflow: auto; background: #fff; border-radius: 22px; padding: 28px; box-shadow: 0 18px 54px rgba(16, 33, 50, 0.22); }
      .field { display: grid; gap: 8px; margin-bottom: 18px; }
      .field label { font-weight: 700; }
      .field input { padding: 14px 16px; border: 1px solid #c6d1dc; border-radius: 12px; font-size: 16px; }
      .submit-button { border: 0; border-radius: 999px; padding: 14px 24px; font-size: 18px; cursor: pointer; color: #fff; background: #102132; }
      .success-toast { position: fixed; top: 18px; left: 18px; padding: 14px 20px; border-radius: 12px; background: #165d56; color: #fff; font-weight: 700; box-shadow: 0 10px 30px rgba(0,0,0,0.2); }
      .applied-pill { display: inline-flex; align-items: center; justify-content: center; width: 220px; min-height: 64px; border-radius: 16px; background: #95d6cf; color: #fff; font-size: 28px; font-weight: 700; }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <h1>${title}</h1>
        <p>Remote</p>
        <button class="apply-button" id="job-apply-button" type="button">Apply</button>
      </section>
    </main>
    <div class="modal-backdrop" id="apply-modal-shell">
      <div class="modal" role="dialog" aria-modal="true" aria-label="ZipRecruiter application">
        <form id="zip-application-form" novalidate>
          <div class="field">
            <label for="full_name">What is your full name?</label>
            <input id="full_name" name="full_name" type="text" autocomplete="name" required />
          </div>
          <div class="field">
            <label for="email">Email</label>
            <input id="email" name="email" type="email" autocomplete="email" required />
          </div>
          <div class="field">
            <label for="phone">Phone</label>
            <input id="phone" name="phone" type="tel" autocomplete="tel" required />
          </div>
          <button class="submit-button" id="zip-submit-button" type="submit">Submit Application</button>
        </form>
      </div>
    </div>
    <script>
      window.__scenario = {
        site: "ziprecruiter",
        jobId: ${JSON.stringify(jobId)},
        title: ${JSON.stringify(title)},
        applyButtonClicked: false,
        submitClicked: false,
        fireworksSeen: false,
        overlaySeen: false
      };

      const fireworksObserver = new MutationObserver(() => {
        const overlayHost = document.querySelector("#remote-job-search-overlay-host");
        if (overlayHost && !window.__scenario.overlaySeen) {
          window.__scenario.overlaySeen = true;
          console.log("[scenario ziprecruiter] overlay seen", window.__scenario.jobId);
        }

        if (
          window.__scenario.fireworksSeen ||
          !Array.from(document.querySelectorAll("style")).some((styleElement) =>
            (styleElement.textContent || "").includes("rjs-firework-burst")
          )
        ) {
          return;
        }

        window.__scenario.fireworksSeen = true;
        console.log("[scenario ziprecruiter] fireworks seen", window.__scenario.jobId);
        fireworksObserver.disconnect();
      });
      fireworksObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });

      document.getElementById("job-apply-button").addEventListener("click", () => {
        window.__scenario.applyButtonClicked = true;
        console.log("[scenario ziprecruiter] apply clicked", window.__scenario.jobId);
        document.getElementById("apply-modal-shell").classList.add("open");
      });

      document.getElementById("zip-application-form").addEventListener("submit", (event) => {
        event.preventDefault();
        window.__scenario.submitClicked = true;
        console.log("[scenario ziprecruiter] submit clicked", window.__scenario.jobId);
        document.getElementById("apply-modal-shell").innerHTML = \`
          <div class="modal" role="dialog" aria-modal="true" aria-label="Application submitted">
            <h2>Your application was submitted!</h2>
            <p>Application submitted. You applied moments ago.</p>
          </div>
        \`;
        const toast = document.createElement("div");
        toast.className = "success-toast";
        toast.textContent = "Your application was submitted!";
        document.body.appendChild(toast);

        const applyButton = document.getElementById("job-apply-button");
        const pill = document.createElement("div");
        pill.className = "applied-pill";
        pill.textContent = "Applied";
        applyButton.replaceWith(pill);
      });
    </script>
  </body>
</html>`;
}

async function launchExtensionContext() {
  logProgress("bootstrap", `Launching Chromium context (headless=${HEADLESS}).`);
  const userDataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "auto-apply-browser-e2e-")
  );
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: HEADLESS,
    viewport: { width: 1440, height: 2200 },
    ignoreHTTPSErrors: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
  });
  logProgress("bootstrap", "Chromium context launched.");
  let [worker] = context.serviceWorkers();
  if (!worker) {
    logProgress("bootstrap", "Waiting for extension service worker.");
    worker = await context.waitForEvent("serviceworker", { timeout: 15_000 });
  }
  const extensionId = new URL(worker.url()).host;
  logProgress("bootstrap", `Extension service worker ready (${extensionId}).`);
  return { context, worker, extensionId, userDataDir };
}

async function disposeContext(context, userDataDir) {
  try {
    await context.close();
  } finally {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

async function setAutomationSettings(worker, settings) {
  await worker.evaluate(
    async ({ key, settingsValue }) => {
      await chrome.storage.local.clear();
      await chrome.storage.local.set({
        [key]: settingsValue,
      });
    },
    { key: SETTINGS_KEY, settingsValue: settings }
  );
}

async function getStorageValue(worker, key) {
  return worker.evaluate(
    async ({ targetKey }) => {
      const result = await chrome.storage.local.get(targetKey);
      return result[targetKey];
    },
    { targetKey: key }
  );
}

async function inspectRunState(worker, runId) {
  return worker.evaluate(
    async ({
      activeRunsKey,
      runStorageKey,
      sessionPrefix,
      pendingCompletionPrefix,
    }) => {
      const everything = await chrome.storage.local.get(null);
      const sessions = Object.entries(everything)
        .filter(([key]) => key.startsWith(sessionPrefix))
        .map(([key, value]) => ({ key, value }));
      const pendingCompletions = Object.entries(everything)
        .filter(([key]) => key.startsWith(pendingCompletionPrefix))
        .map(([key, value]) => ({ key, value }));

      return {
        activeRuns: everything[activeRunsKey],
        runState: everything[runStorageKey],
        sessions,
        pendingCompletions,
      };
    },
    {
      activeRunsKey: "remote-job-search-active-runs",
      runStorageKey: `remote-job-search-run:${runId}`,
      sessionPrefix: "remote-job-search-session:",
      pendingCompletionPrefix: "remote-job-search-pending-managed-completion:",
    }
  );
}

async function findTabIdByUrl(worker, urlPrefix) {
  return worker.evaluate(
    async ({ prefix }) => {
      const tabs = await chrome.tabs.query({});
      const match = tabs.find((tab) =>
        (tab.url || tab.pendingUrl || "").startsWith(prefix)
      );
      return match?.id ?? null;
    },
    { prefix: urlPrefix }
  );
}

async function getActiveTabInfo(worker) {
  return worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    return tab
      ? {
          id: tab.id,
          index: tab.index,
          windowId: tab.windowId,
          url: tab.url || tab.pendingUrl || "",
        }
      : null;
  });
}

async function openExtensionControlPage(context, extensionId) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  return page;
}

async function startSessionOnTab(controlPage, tabId, session) {
  return controlPage.evaluate(
    async ({ targetTabId, targetSession }) => {
      let lastError = "";

      for (let attempt = 0; attempt < 50; attempt += 1) {
        try {
          return await chrome.tabs.sendMessage(targetTabId, {
            type: "start-automation",
            session: targetSession,
          });
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
          await new Promise((resolve) => setTimeout(resolve, 120));
        }
      }

      throw new Error(lastError || "Could not start the tab session.");
    },
    { targetTabId: tabId, targetSession: session }
  );
}

async function startAutomation(controlPage, tabId) {
  return controlPage.evaluate(
    async ({ targetTabId }) =>
      chrome.runtime.sendMessage({
        type: "start-automation",
        tabId: targetTabId,
      }),
    { targetTabId: tabId }
  );
}

async function waitForUrl(page, pattern, timeout = 60_000) {
  await page.waitForURL(pattern, { timeout });
}

async function waitForOverlayText(page, pattern, timeout = 60_000) {
  await page.waitForFunction(
    ({ source, flags }) => {
      const host = document.querySelector("#remote-job-search-overlay-host");
      if (!host) {
        return false;
      }
      const visible = window.getComputedStyle(host).display !== "none";
      if (!visible) {
        return false;
      }
      const text =
        host.shadowRoot?.textContent || host.textContent || "";
      return new RegExp(source, flags).test(text);
    },
    { source: pattern.source, flags: pattern.flags },
    { timeout }
  );
}

async function waitForFireworks(page, timeout = 20_000) {
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll("style")).some((styleElement) =>
        (styleElement.textContent || "").includes("rjs-firework-burst")
      ),
    {},
    { timeout }
  );
}

async function waitForFields(page, values, timeout = 40_000) {
  await page.waitForFunction(
    (expectedValues) =>
      Object.entries(expectedValues).every(([name, expectedValue]) => {
        const field = document.querySelector(`[name="${name}"]`);
        return field instanceof HTMLInputElement && field.value === expectedValue;
      }),
    values,
    { timeout }
  );
}

async function waitForScenarioFlag(page, flagName, timeout = 40_000) {
  await page.waitForFunction(
    (flag) => Boolean(window.__scenario && window.__scenario[flag]),
    flagName,
    { timeout }
  );
}

async function waitForClose(page, timeout = 25_000) {
  if (page.isClosed()) {
    return;
  }
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${page.url()} to close.`));
    }, timeout);
    page.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function wirePageLogging(page, scope) {
  page.on("console", (message) => {
    logProgress(scope, `page console: ${message.text()}`);
  });
}

async function readPageDiagnostics(page) {
  if (page.isClosed()) {
    return { closed: true };
  }

  return page.evaluate(() => {
    const host = document.querySelector("#remote-job-search-overlay-host");
    return {
      closed: false,
      url: window.location.href,
      scrollY:
        window.scrollY ||
        window.pageYOffset ||
        document.documentElement?.scrollTop ||
        document.body?.scrollTop ||
        0,
      overlayText: host?.shadowRoot?.textContent || host?.textContent || "",
      bodyText: (document.body?.innerText || "").slice(0, 600),
      scenario:
        typeof window.__scenario === "object" && window.__scenario
          ? { ...window.__scenario }
          : null,
    };
  });
}

async function replacePageWithMockContent(page, html) {
  await page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(
    () => {}
  );
  await page.evaluate((nextHtml) => {
    const parser = new DOMParser();
    const parsed = parser.parseFromString(nextHtml, "text/html");
    document.title = parsed.title || document.title;

    const existingManagedStyles = Array.from(
      document.head.querySelectorAll("[data-rjs-mock-style='true']")
    );
    for (const node of existingManagedStyles) {
      node.remove();
    }

    for (const styleElement of Array.from(
      parsed.head.querySelectorAll("style")
    )) {
      const cloned = document.createElement("style");
      cloned.setAttribute("data-rjs-mock-style", "true");
      cloned.textContent = styleElement.textContent || "";
      document.head.append(cloned);
    }

    document.body.innerHTML = parsed.body.innerHTML;

    for (const scriptElement of Array.from(
      document.body.querySelectorAll("script")
    )) {
      const replacement = document.createElement("script");
      for (const attr of Array.from(scriptElement.attributes)) {
        replacement.setAttribute(attr.name, attr.value);
      }
      replacement.textContent = scriptElement.textContent || "";
      scriptElement.replaceWith(replacement);
    }
  }, html);
  await page.waitForTimeout(250);
}

async function seedManagedRun(worker, options) {
  const now = Date.now();
  const {
    runId,
    currentTabId,
    currentSite,
    currentLabel,
    currentKeyword,
    currentClaimedJobKey,
    queuedItem,
  } = options;

  const currentSession = {
    tabId: currentTabId,
    site: currentSite,
    phase: "running",
    message: `Starting open-apply on ${currentSite}...`,
    updatedAt: now,
    shouldResume: true,
    stage: "open-apply",
    runId,
    label: currentLabel,
    keyword: currentKeyword,
    profileId: "default-profile",
    claimedJobKey: currentClaimedJobKey,
    runSummary: {
      queuedJobCount: 1,
      successfulJobPages: 0,
      appliedTodayCount: 0,
      stopRequested: false,
    },
  };

  await worker.evaluate(
    async ({
      runStorageKey,
      sessionStorageKey,
      activeRunsKey,
      runState,
      sessionState,
    }) => {
      await chrome.storage.local.set({
        [activeRunsKey]: [runState.id],
        [runStorageKey]: runState,
        [sessionStorageKey]: sessionState,
      });
    },
    {
      activeRunsKey: "remote-job-search-active-runs",
      runStorageKey: `remote-job-search-run:${runId}`,
      sessionStorageKey: `remote-job-search-session:${currentTabId}`,
      runState: {
        id: runId,
        jobPageLimit: 2,
        openedJobPages: 2,
        openedJobKeys: [
          currentClaimedJobKey,
          queuedItem.claimedJobKey,
        ],
        successfulJobPages: 0,
        successfulJobKeys: [],
        queuedJobItems: [queuedItem],
        stopRequested: false,
        updatedAt: now,
      },
      sessionState: currentSession,
    }
  );

  return currentSession;
}

async function waitForNewPageMatchingUrl(
  context,
  pattern,
  timeout = 120_000
) {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    const page = await context.waitForEvent("page", { timeout: remaining });

    try {
      await page.waitForURL(pattern, {
        timeout: Math.min(remaining, 30_000),
      });
      return page;
    } catch {
      // Ignore unrelated pages and keep waiting for the target URL.
    }
  }

  throw new Error(`Timed out waiting for a new page matching ${pattern}.`);
}

function fulfillHtml(route, html) {
  return route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: html,
  });
}

async function runGreenhouseScenario() {
  const { context, worker, extensionId, userDataDir } =
    await launchExtensionContext();
  const scenarioResult = {
    name: "greenhouse",
    overlayAppeared: false,
    autofilled: false,
    scrolledToForm: false,
    firstJobClosed: false,
    secondJobOpened: false,
    fireworksSeen: false,
    appliedCount: 0,
  };
  const runId = `greenhouse-run-${Date.now()}`;
  const firstJobUrl = "https://job-boards.greenhouse.io/impiricus/jobs/gh-1";
  const secondJobUrl = "https://job-boards.greenhouse.io/impiricus/jobs/gh-2";

  try {
    logProgress("greenhouse", "Launching mocked job routes.");
    await context.route(
      "https://job-boards.greenhouse.io/impiricus/jobs/gh-*",
      async (route) => {
        const requestUrl = route.request().url();
        const isSecondJob = requestUrl.includes("gh-2");
        await fulfillHtml(
          route,
          greenhouseJobHtml(
            isSecondJob ? "gh-2" : "gh-1",
            isSecondJob
              ? "Staff Full Stack Engineer"
              : "Senior Platform Engineer"
          )
        );
      }
    );

    await setAutomationSettings(worker, buildSettings("platform engineer"));
    const controlPage = await openExtensionControlPage(context, extensionId);
    logProgress("greenhouse", "Extension settings seeded.");

    const firstJobPage = await context.newPage();
    wirePageLogging(firstJobPage, "greenhouse");
    await firstJobPage.goto(firstJobUrl, { waitUntil: "domcontentloaded" }).catch(
      () => {}
    );
    await firstJobPage.bringToFront();
    logProgress("greenhouse", "Opened first mocked Greenhouse job page.");
    const firstTab = await getActiveTabInfo(worker);
    assert.ok(firstTab?.id, "Could not find the Greenhouse job tab.");

    const firstSession = await seedManagedRun(worker, {
      runId,
      currentTabId: firstTab.id,
      currentSite: "greenhouse",
      currentLabel: "Impiricus",
      currentKeyword: "platform engineer",
      currentClaimedJobKey: "greenhouse-gh-1",
      queuedItem: {
        url: secondJobUrl,
        site: "greenhouse",
        stage: "open-apply",
        runId,
        claimedJobKey: "greenhouse-gh-2",
        label: "Impiricus",
        keyword: "platform engineer",
        profileId: "default-profile",
        active: true,
        message: "Starting queued Greenhouse application...",
        sourceTabId: firstTab.id,
        sourceWindowId: firstTab.windowId,
        sourceTabIndex: firstTab.index,
        enqueuedAt: Date.now() + 1,
      },
    });

    const secondJobPromise = waitForNewPageMatchingUrl(
      context,
      /job-boards\.greenhouse\.io\/impiricus\/jobs\/gh-2/i
    );
    secondJobPromise.catch(() => null);
    const startResponse = await startSessionOnTab(
      controlPage,
      firstTab.id,
      firstSession
    );
    assert.equal(startResponse?.ok, true, "Greenhouse tab start failed.");
    logProgress("greenhouse", "Automation session started on first tab.");

    await waitForScenarioFlag(firstJobPage, "overlaySeen");
    scenarioResult.overlayAppeared = true;
    logProgress("greenhouse", "Overlay appeared on first job.");
    await waitForFields(
      firstJobPage,
      {
        first_name: "Ava",
        last_name: "Stone",
        email: "ava.stone@example.com",
        phone: "+1 602 555 0184",
      }
    );
    scenarioResult.autofilled = true;
    logProgress("greenhouse", "First job autofilled.");
    const firstAutofillDiagnostics = await readPageDiagnostics(firstJobPage);
    logProgress(
      "greenhouse",
      `Diagnostics after autofill: ${JSON.stringify(firstAutofillDiagnostics)}`
    );
    assert.ok(
      (firstAutofillDiagnostics.scenario?.maxScrollY ?? 0) >= 1500,
      `Expected Greenhouse automation to scroll deep enough to reveal the form. Diagnostics: ${JSON.stringify(
        firstAutofillDiagnostics
      )}`
    );
    scenarioResult.scrolledToForm = true;
    logProgress("greenhouse", "Page auto-scrolled to the offscreen form.");
    await waitForScenarioFlag(firstJobPage, "continueClicked");
    logProgress("greenhouse", "First job advanced through Continue.");
    await waitForScenarioFlag(firstJobPage, "submitClicked");
    logProgress("greenhouse", "First job submit action fired.");
    logProgress(
      "greenhouse",
      `Run state after first submit: ${JSON.stringify(
        await inspectRunState(worker, runId)
      )}`
    );

    const secondJobPage = await secondJobPromise;
    wirePageLogging(secondJobPage, "greenhouse");
    scenarioResult.secondJobOpened = true;
    logProgress("greenhouse", "Second queued Greenhouse job opened.");
    await waitForScenarioFlag(secondJobPage, "overlaySeen");

    await waitForClose(firstJobPage);
    scenarioResult.firstJobClosed = true;
    logProgress("greenhouse", "First job tab closed.");

    const firstFireworksDiagnostics = await readPageDiagnostics(secondJobPage);
    scenarioResult.fireworksSeen = true;
    logProgress(
      "greenhouse",
      `Second job overlay after first success: ${JSON.stringify(
        firstFireworksDiagnostics
      )}`
    );

    await waitForFields(
      secondJobPage,
      {
        first_name: "Ava",
        last_name: "Stone",
        email: "ava.stone@example.com",
        phone: "+1 602 555 0184",
      }
    );
    await waitForScenarioFlag(secondJobPage, "continueClicked");
    await waitForScenarioFlag(secondJobPage, "submitClicked");
    logProgress("greenhouse", "Second job reached submit state.");
    await waitForScenarioFlag(secondJobPage, "fireworksSeen");
    await waitForClose(secondJobPage);
    logProgress("greenhouse", "Second job fireworks detected and tab closed.");

    const appliedHistory = await getStorageValue(worker, APPLIED_HISTORY_KEY);
    scenarioResult.appliedCount = Array.isArray(appliedHistory)
      ? appliedHistory.length
      : 0;
    assert.ok(
      scenarioResult.appliedCount >= 2,
      `Expected Greenhouse applied history to contain 2 entries, received ${scenarioResult.appliedCount}.`
    );

    return scenarioResult;
  } catch (error) {
    logProgress(
      "greenhouse",
      `Scenario failed with diagnostics: ${JSON.stringify(
        await readPageDiagnostics(
          context.pages().find((page) => !page.isClosed()) ?? context.pages()[0]
        ).catch(() => ({ unavailable: true }))
      )}`
    );
    throw error;
  } finally {
    await disposeContext(context, userDataDir);
  }
}

async function runZipScenario() {
  const { context, worker, extensionId, userDataDir } =
    await launchExtensionContext();
  const scenarioResult = {
    name: "ziprecruiter",
    overlayAppeared: false,
    autofilled: false,
    submitDetected: false,
    fireworksSeen: false,
    secondJobOpened: false,
    appliedCount: 0,
  };
  const runId = `zip-run-${Date.now()}`;
  const firstJobUrl =
    "https://www.ziprecruiter.com/jobs/acme-cloud?jid=zip-1";
  const secondJobUrl =
    "https://www.ziprecruiter.com/jobs/acme-data?jid=zip-2";

  try {
    logProgress("ziprecruiter", "Launching mocked job routes.");
    await context.route(
      "https://www.ziprecruiter.com/jobs/acme-*",
      async (route) => {
        const requestUrl = route.request().url();
        const isSecondJob = requestUrl.includes("acme-data");
        await fulfillHtml(
          route,
          zipJobHtml(
            isSecondJob ? "zip-2" : "zip-1",
            isSecondJob ? "Senior Product Engineer" : "Full Stack Engineer"
          )
        );
      }
    );

    await setAutomationSettings(worker, buildSettings("full stack engineer"));
    const controlPage = await openExtensionControlPage(context, extensionId);
    logProgress("ziprecruiter", "Extension settings seeded.");

    const firstJobPage = await context.newPage();
    wirePageLogging(firstJobPage, "ziprecruiter");
    await firstJobPage.goto(firstJobUrl, { waitUntil: "domcontentloaded" }).catch(
      () => {}
    );
    await firstJobPage.bringToFront();
    logProgress("ziprecruiter", "Opened first mocked ZipRecruiter job page.");
    const firstTab = await getActiveTabInfo(worker);
    assert.ok(firstTab?.id, "Could not find the ZipRecruiter job tab.");

    const firstSession = await seedManagedRun(worker, {
      runId,
      currentTabId: firstTab.id,
      currentSite: "ziprecruiter",
      currentLabel: "ZipRecruiter",
      currentKeyword: "full stack engineer",
      currentClaimedJobKey: "zip-gh-1",
      queuedItem: {
        url: secondJobUrl,
        site: "ziprecruiter",
        stage: "open-apply",
        runId,
        claimedJobKey: "zip-gh-2",
        label: "ZipRecruiter",
        keyword: "full stack engineer",
        profileId: "default-profile",
        active: true,
        message: "Starting queued ZipRecruiter application...",
        sourceTabId: firstTab.id,
        sourceWindowId: firstTab.windowId,
        sourceTabIndex: firstTab.index,
        enqueuedAt: Date.now() + 1,
      },
    });

    const secondJobPromise = waitForNewPageMatchingUrl(
      context,
      /ziprecruiter\.com\/jobs\/acme-data/i
    );
    secondJobPromise.catch(() => null);
    const startResponse = await startSessionOnTab(
      controlPage,
      firstTab.id,
      firstSession
    );
    assert.equal(startResponse?.ok, true, "ZipRecruiter tab start failed.");
    logProgress("ziprecruiter", "Automation session started on first tab.");

    await waitForFields(
      firstJobPage,
      {
        full_name: "Ava Stone",
        email: "ava.stone@example.com",
        phone: "+1 602 555 0184",
      }
    );
    scenarioResult.overlayAppeared = true;
    scenarioResult.autofilled = true;
    logProgress("ziprecruiter", "First job autofilled.");

    await waitForScenarioFlag(firstJobPage, "submitClicked");
    scenarioResult.submitDetected = true;
    logProgress("ziprecruiter", "First job reached submit/success overlay state.");
    logProgress(
      "ziprecruiter",
      `Run state after first submit: ${JSON.stringify(
        await inspectRunState(worker, runId)
      )}`
    );
    await waitForScenarioFlag(firstJobPage, "fireworksSeen");
    scenarioResult.fireworksSeen = true;
    logProgress("ziprecruiter", "First job fireworks detected.");

    const secondJobPage = await secondJobPromise;
    wirePageLogging(secondJobPage, "ziprecruiter");
    scenarioResult.secondJobOpened = true;
    logProgress("ziprecruiter", "Second queued ZipRecruiter job opened.");
    await waitForOverlayText(secondJobPage, /applied today:\s*1/i);

    await waitForClose(firstJobPage);
    logProgress("ziprecruiter", "First job tab closed.");

    await waitForFields(
      secondJobPage,
      {
        full_name: "Ava Stone",
        email: "ava.stone@example.com",
        phone: "+1 602 555 0184",
      }
    );
    await waitForScenarioFlag(secondJobPage, "submitClicked");
    logProgress("ziprecruiter", "Second job reached submit/success overlay state.");
    await waitForScenarioFlag(secondJobPage, "fireworksSeen");
    await waitForClose(secondJobPage);
    logProgress("ziprecruiter", "Second job fireworks detected and tab closed.");

    const appliedHistory = await getStorageValue(worker, APPLIED_HISTORY_KEY);
    scenarioResult.appliedCount = Array.isArray(appliedHistory)
      ? appliedHistory.length
      : 0;
    assert.ok(
      scenarioResult.appliedCount >= 2,
      `Expected ZipRecruiter applied history to contain 2 entries, received ${scenarioResult.appliedCount}.`
    );

    return scenarioResult;
  } catch (error) {
    logProgress(
      "ziprecruiter",
      `Scenario failed with diagnostics: ${JSON.stringify(
        await readPageDiagnostics(
          context.pages().find((page) => !page.isClosed()) ?? context.pages()[0]
        ).catch(() => ({ unavailable: true }))
      )}`
    );
    throw error;
  } finally {
    await disposeContext(context, userDataDir);
  }
}

async function main() {
  const results = [];

  if (RUN_GREENHOUSE) {
    results.push(await runGreenhouseScenario());
  }

  if (RUN_ZIP) {
    results.push(await runZipScenario());
  }

  console.log("\nReal-browser extension E2E results:");
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
