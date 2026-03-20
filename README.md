# Remote Job Search Starter

Remote Job Search Starter is a Chrome extension built with TypeScript for streamlining multi-site software job searches and reducing repetitive application work. It can open targeted search flows from saved keywords, collect job pages, open application surfaces, autofill common fields, upload the active profile resume, and reuse previously answered questions.

The extension is designed to assist with application prep and form completion. It does not auto-submit applications.

## Overview

The project supports three search modes:

- `Job Boards`: Starts from a supported job board tab and works from the keywords saved in the popup.
- `Startup Careers`: Opens curated startup career pages by region and scans them for matching roles.
- `Other Job Sites`: Opens curated regional searches on additional job platforms and scans them for matching roles.

For each run, the extension tracks progress across tabs, limits how many managed job pages are processed, and attempts to continue automation when a flow moves into a new tab.

## Supported Sources

### Job boards

- Indeed
- ZipRecruiter
- Dice
- Monster
- Glassdoor

### Curated startup mode

- Region-aware startup career pages for `US`, `UK`, and `EU` companies

### Curated other job sites mode

- Built In
- The Muse
- Work at a Startup
- Reed
- CWJobs
- Totaljobs
- Welcome to the Jungle
- Berlin Startup Jobs

## Core Capabilities

- Supports multiple named profiles with separate candidate data, resume, remembered answers, and custom preference answers
- Uses saved keyword lists instead of hard-coded role presets
- Stores one resume per profile for uploads
- Stores candidate profile data for common application fields
- Lets you choose a search region or derive it from the saved country
- Limits how many job pages are actively processed in a run
- Scans result pages and opens matching job or application pages
- Attempts to autofill blank fields on supported application forms
- Uploads the active profile resume when resume upload is enabled
- Remembers answers typed into application questions and reuses them later
- Lets you manage custom work-preference question and answer pairs directly in the popup
- Skips jobs that already appear to be applied or submitted
- Pauses when a site presents human verification and resumes after the challenge is cleared

## How It Works

1. Configure a profile, resume, search keywords, candidate details, region, and job page limits in the extension popup.
2. Start a run in one of the available search modes.
3. The extension opens targeted search or career pages from the saved keywords.
4. It collects job links, opens job pages or application pages, and tries to continue into the apply flow.
5. On supported forms, it fills common fields, reuses remembered answers, and uploads the active profile resume.
6. As you answer new application questions, the extension remembers them for reuse on later forms.

## Build

```powershell
npm install
npm run build
```

## Testing

```powershell
npm run test:unit
npm run test:coverage
npm run test:check
```

- `npm run test:unit` runs the fast Vitest suite, including popup workflow coverage.
- `npm run test:coverage` writes HTML, JSON summary, and `lcov` coverage reports.
- `npm run test:check` runs coverage, typechecking, and a production build in one pass.
- `npm run test:live` runs the Playwright smoke suite against real job sites. It is intentionally opt-in because it depends on live pages, network conditions, and anti-bot challenges.

## Load In Chrome

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select the project root or the `dist` directory.

If you load the project root, Chrome will use `manifest.json`. If you load `dist`, Chrome will use the built assets in that folder.

## Usage

### Job Boards mode

1. Open Indeed, ZipRecruiter, Dice, Monster, or Glassdoor in the active tab.
2. Open the extension popup.
3. Confirm your active profile, search keywords, profile details, and job page limit.
4. Leave `Search Mode` set to `Job Boards`.
5. Start the run.

### Startup Careers mode

1. Open the extension popup from any page.
2. Set `Search Mode` to `Startup Careers`.
3. Choose `US`, `UK`, `EU`, or `Auto`.
4. Start the run.

### Other Job Sites mode

1. Open the extension popup from any page.
2. Set `Search Mode` to `Other Job Sites`.
3. Choose `US`, `UK`, `EU`, or `Auto`.
4. Start the run.

## Stored Data

The extension stores its working data locally in Chrome extension storage, including:

- Named profiles
- Per-profile resumes
- Candidate profile details
- Search preferences
- Remembered application answers
- Custom preference question and answer pairs
- Temporary automation session state

## Limitations

- External career sites vary widely, so autofill behavior is heuristic and should always be reviewed manually.
- Human verification, CAPTCHA, and anti-bot flows still require user intervention.
- Broad host permissions are currently used so the content script can operate across job boards, startup career sites, and external application pages.

## Project Structure

- `src/background.ts`: Background service worker and tab/session orchestration
- `src/content.ts`: Search collection, apply-flow handling, autofill logic, and answer memory
- `src/popup.ts`: Popup UI behavior and settings management
- `src/shared.ts`: Shared types, settings, curated targets, and helper utilities
- `scripts/build.mjs`: Build pipeline

## Development Notes

- The project is built with TypeScript and bundled into `dist`
- `npm run typecheck` runs the TypeScript checker without emitting files
- `npm run build` rebuilds the extension assets used by Chrome
- `npm run test:full` runs the local quality gate plus the opt-in Playwright smoke suite
