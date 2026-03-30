# Remote Job Search Starter

Remote Job Search Starter is a Chrome extension for profile-based job search and application assistance across major job boards and curated career sites.

It can:

- collect job results from supported search pages
- open job detail or application flows one job at a time
- autofill blank application fields with saved profile data
- upload a saved resume when supported
- remember answers from previous applications and reuse them later
- pause when human verification or final review is required
- continue into supported company-site and ATS handoff flows when a board redirects externally

Important: the extension can advance and submit supported flows when a page is clearly ready, but it still pauses for human verification, missing required answers, or ambiguous review states.

## Supported Modes

### Job Boards

Use the active tab on one of these supported sites:

- Indeed
- ZipRecruiter
- Dice
- Monster
- Glassdoor
- Greenhouse
- Built In

### Startup Careers

Opens curated startup career pages by region:

- US
- UK
- EU

### Other Job Sites

Builds keyword searches for curated external sites:

- Built In
- The Muse
- Work at a Startup
- Reed
- CWJobs
- Totaljobs
- Welcome to the Jungle
- Berlin Startup Jobs

## Core Features

- Multiple named profiles with isolated candidate data, resume, answers, and preferences
- Search keywords entered as comma-separated or newline-separated terms
- Date-posted filtering where the target site supports it
- Resume upload support for `.pdf`, `.doc`, `.docx`, `.txt`, `.md`, and `.rtf`
- Remembered answer capture plus editable saved question-and-answer entries
- Applied-state detection to avoid retrying jobs that already look submitted
- Cross-site handoff support for direct-apply flows that move into another supported surface
- Manual-review and human-verification pauses so the run can safely resume

## How It Works

At a high level, the extension runs through these stages:

1. `bootstrap`
2. `collect-results`
3. `open-apply`
4. `autofill-form`

The background service worker manages tabs, session state, and spawn limits. The content script handles page detection, result collection, apply-flow discovery, autofill, resume upload, answer memory, and manual-review pauses.

## Getting Started

### Prerequisites

- Node.js 18+
- npm
- Chrome or another Chromium-based browser

### Install Dependencies

```bash
git clone https://github.com/swan07222/Auto-apply.git
cd Auto-apply
npm install
```

### Build the Extension

```bash
npm run build
```

### Load It in Chrome

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click `Load unpacked`
4. Select the project folder

The manifest points Chrome at the built files in `dist/`, so run `npm run build` before loading or reloading the extension.

## Using the Extension

### 1. Set Up a Profile

In the popup you can:

- create, rename, and delete profiles
- enter candidate basics like name, email, phone, city, state, and country
- save optional data like LinkedIn, portfolio URL, current company, and work preferences
- upload a resume
- manage saved answers and preferences

### 2. Configure Automation

The popup lets you set:

- search mode
- date posted window
- search keywords

Keywords can be entered as a comma-separated list or one per line.

### 3. Start a Run

For Job Boards mode, open a supported job board in the active tab first.

For Startup Careers and Other Job Sites mode, you can start from any page. The extension opens the generated targets for the configured region and keywords.

### 4. Review and Submission

The extension can fill fields, upload resumes, move through supported steps, and submit some flows when the page is clearly ready. If a site requires CAPTCHA, additional verification, manual answers, or a risky review state, the run pauses and lets you take over.

## Development Commands

```bash
npm run clean
npm run build
npm run rebuild
npm run typecheck
npm run typecheck:tools
npm run typecheck:all
npm run test:unit
npm run test:unit:verbose
npm run test:coverage
npm run test:features
npm run test:ci
```

## Live Tests

Live Playwright smoke tests are opt-in because they hit real sites and can trigger verification pages or rate limits.

Run the default live suite:

```bash
npm run test:live
```

Run a filtered live suite directly:

```bash
npx playwright test tests/live.search.spec.ts --grep "Monster"
```

The helper script sets `ENABLE_LIVE_TESTS=1` automatically for `npm run test:live`.

## Project Structure

```text
src/
  background.ts              Main background service worker
  content.ts                 Main content script
  popup.ts                   Popup controller
  popupDialog.ts             Popup dialog controller
  popupState.ts              Popup state helpers
  content/                   Apply, autofill, DOM, search, upload, and answer helpers
  shared/                    Types, storage, targets, catalog, and shared utilities
public/
  popup.html                 Popup markup
  popup.css                  Popup styling
scripts/
  build.mjs                  Build pipeline
  run-live-tests.mjs         Live Playwright wrapper
tests/
  *.test.ts                  Vitest coverage for extension logic
  live.search.spec.ts        Opt-in Playwright live smoke tests
data/
  startup-companies.json     Curated startup company list
```

## Permissions

The extension currently requests:

- `storage`
- `tabs`
- `scripting`
- `clipboardWrite`
- `alarms`
- broad `http://*/*` and `https://*/*` host permissions

Those host permissions are required because the content script needs to inspect and assist across many job boards, ATS flows, and external career sites.

## Data Storage

Data is stored locally through the extension's storage layer and includes:

- profiles
- candidate details
- resumes
- remembered answers
- saved preferences
- automation settings
- session state

## Limitations

- Site layouts and application flows change frequently, so behavior is heuristic-based
- Some sites block automation with verification pages or rate limits
- Resume upload and autofill depend on the target form exposing standard controls
- Some flows still require manual answers or manual verification before submit can continue

## CI

GitHub Actions runs `npm run test:ci` on pushes, pull requests, and manual dispatches. Dependabot is configured to keep npm packages and GitHub Actions dependencies up to date weekly.

## Contributing

1. Create a branch
2. Make your changes
3. Run `npm run test:unit`, `npm run typecheck`, and `npm run build`
4. Open a pull request

## License

MIT. See [LICENSE](LICENSE) if the file is present in your branch or release packaging.
