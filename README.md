# Remote Job Search Starter

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Chrome Extension](https://img.shields.io/badge/Manifest-V3-4285F4?logo=google-chrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Build](https://img.shields.io/badge/build-esbuild-FFD166?logo=esbuild&logoColor=black)](https://esbuild.github.io/)
[![Testing](https://img.shields.io/badge/test-vitest%20%7C%20playwright-6E3E9A?logo=vitest&logoColor=white)](https://vitest.dev/)

A powerful Chrome extension for streamlining multi-site software job searches and reducing repetitive application work. Built with TypeScript, it automates job discovery across major job boards and curated career sites, autofills application forms, uploads resumes, and remembers answers to common questions.

> **Note:** This extension assists with application preparation and form completion. It does **not** auto-submit applications—all submissions require manual review and confirmation.

---

## ✨ Features

### Search Modes

| Mode | Description |
|------|-------------|
| **Job Boards** | Searches Indeed, ZipRecruiter, Dice, Monster, and Glassdoor using saved keywords |
| **Startup Careers** | Opens curated startup career pages by region (US, UK, EU) |
| **Other Job Sites** | Searches Built In, The Muse, Work at a Startup, Reed, CWJobs, Totaljobs, Welcome to the Jungle, Berlin Startup Jobs |

### Core Capabilities

- 📝 **Multiple Profiles** — Separate candidate data, resumes, remembered answers, and custom preferences per profile
- 🔑 **Keyword-Driven Search** — Use saved keyword lists instead of hardcoded role presets
- 📄 **Resume Management** — Store one resume per profile (PDF, DOC, DOCX, TXT, MD, RTF)
- 🎯 **Smart Filtering** — Date-posted filtering (24h, 3d, 1w, any) and job page limits (1-25)
- 🔍 **Result Collection** — Scans result pages and opens matching job/application pages
- ⚡ **Autofill** — Fills common fields on supported application forms
- 📤 **Resume Upload** — Automatically uploads the active profile resume when enabled
- 💾 **Answer Memory** — Remembers answers from application questions and reuses them later
- ⏸️ **Human Verification** — Pauses for CAPTCHA/anti-bot challenges and resumes after clearance
- ✅ **Applied Detection** — Skips jobs that already appear to be applied or submitted

---

## 🏗️ Architecture

```
Remote Job Search Starter
├── Background Service Worker  → Tab orchestration, session management, rate limiting
├── Content Script             → Search collection, apply flows, autofill, answer memory
├── Popup UI                   → Settings management, profile editing, search initiation
└── Shared Modules             → Types, storage, URL utilities, curated targets
```

### Automation Stages

```
bootstrap → collect-results → open-apply → autofill-form
```

### Site-Specific Integrations

The extension includes specialized handlers for:

- **Job Boards:** Indeed, ZipRecruiter, Dice, Monster, Glassdoor
- **ATS Platforms:** Greenhouse, Lever, Ashby, Workday
- **Curated Sites:** Built In, The Muse, Reed, CWJobs, Totaljobs, Welcome to the Jungle, Berlin Startup Jobs
- **Startup Careers:** 16+ curated startup companies with region-aware URLs

---

## 📦 Installation

### Prerequisites

- Node.js 18+ and npm
- Google Chrome (or Chromium-based browser)

### Build from Source

```bash
# Clone the repository
git clone https://github.com/your-username/auto-apply.git
cd auto-apply

# Install dependencies
npm install

# Build the extension
npm run build
```

### Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select the `dist` directory (or project root to use `manifest.json`)

---

## 🚀 Usage

### Job Boards Mode

1. Navigate to Indeed, ZipRecruiter, Dice, Monster, or Glassdoor
2. Open the extension popup
3. Configure:
   - **Profile:** Select or create a named profile
   - **Keywords:** Add search keywords (e.g., "Software Engineer", "Frontend Developer")
   - **Candidate Details:** Fill common application fields
   - **Region:** Choose search region or use Auto
   - **Job Page Limit:** Set max pages to process (1-25)
4. Ensure **Search Mode** is set to `Job Boards`
5. Click **Start Run**

### Startup Careers Mode

1. Open the extension popup from any page
2. Set **Search Mode** to `Startup Careers`
3. Choose region: `US`, `UK`, `EU`, or `Auto`
4. Click **Start Run**

### Other Job Sites Mode

1. Open the extension popup from any page
2. Set **Search Mode** to `Other Job Sites`
3. Choose region: `US`, `UK`, `EU`, or `Auto`
4. Click **Start Run**

---

## 🧪 Testing

### Unit Tests (Vitest)

```bash
# Run all unit tests
npm run test:unit

# Run with verbose output
npm run test:unit:verbose

# Run with coverage reports
npm run test:coverage

# Run specific test suites
npm run test:features
```

### End-to-End Tests (Playwright)

```bash
# Run live smoke tests against real job sites (opt-in)
npm run test:live

# Run full CI pipeline
npm run test:ci
```

### Test Coverage

| Suite | Coverage |
|-------|----------|
| **Unit Tests** | 33 test files covering background, content, popup, and shared modules |
| **E2E Tests** | Live search testing against real job sites |
| **Coverage Threshold** | 75% lines, 90% functions |

---

## 📁 Project Structure

```
auto-apply/
├── src/
│   ├── background/           # Service worker modules
│   │   ├── sessionState.ts   # Session lifecycle & rate limiting
│   │   ├── sessionStore.ts   # Session storage & job distribution
│   │   └── spawnQueue.ts     # Tab spawn deduplication
│   ├── content/              # Content script modules
│   │   ├── sites/            # Site-specific integrations
│   │   │   ├── indeed/
│   │   │   ├── ziprecruiter/
│   │   │   ├── dice/
│   │   │   ├── monster/
│   │   │   ├── glassdoor/
│   │   │   ├── greenhouse/
│   │   │   ├── builtin/
│   │   │   └── startup/
│   │   ├── answerCapture.ts  # Form answer capture
│   │   ├── answerMemory.ts   # Answer storage & retrieval
│   │   ├── apply.ts          # Apply flow navigation
│   │   ├── autofill.ts       # Form autofill logic
│   │   ├── dom.ts            # DOM utilities
│   │   ├── jobSearch.ts      # Job search collection
│   │   ├── resumeUpload.ts   # Resume upload handling
│   │   └── progression.ts    # Multi-step form progression
│   ├── popup/                # Popup UI (empty, uses root files)
│   ├── shared/               # Shared utilities
│   │   ├── catalog.ts        # Constants & curated lists
│   │   ├── profiles.ts       # Profile management
│   │   ├── storage.ts        # Chrome storage wrappers
│   │   ├── targets.ts        # Search target URL builders
│   │   └── types.ts          # Core TypeScript interfaces
│   ├── background.ts         # Main service worker (3084 lines)
│   ├── content.ts            # Main content script (4638 lines)
│   ├── popup.ts              # Popup controller (2278 lines)
│   ├── popupDialog.ts        # Dialog controller
│   └── popupState.ts         # Popup state management
├── public/
│   ├── manifest.json         # Source manifest
│   ├── popup.html            # Popup UI structure
│   └── popup.css             # Popup styles
├── data/
│   └── startup-companies.json # Curated startup company list
├── tests/
│   ├── *.test.ts             # Vitest unit tests
│   └── live.search.spec.ts   # Playwright E2E tests
├── scripts/
│   └── build.mjs             # Esbuild build pipeline
├── dist/                     # Built extension (generated)
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── playwright.config.ts
└── README.md
```

---

## 🛠️ Development

### Build Commands

```bash
npm run build          # Bundle with esbuild → dist/
npm run typecheck      # TypeScript type checking
npm run test:unit      # Run Vitest unit tests
npm run test:coverage  # Run tests with coverage reports
npm run test:live      # Run Playwright E2E (opt-in)
npm run test:ci        # Full CI: test + typecheck + build
```

### Technology Stack

| Category | Technology |
|----------|------------|
| **Language** | TypeScript 5.9 |
| **Bundler** | esbuild |
| **Unit Testing** | Vitest + jsdom |
| **E2E Testing** | Playwright |
| **PDF Processing** | PDF.js |
| **Document Parsing** | mammoth (DOCX), jszip |
| **Extension API** | Chrome Manifest V3 |

### Key Design Decisions

- **Strict TypeScript** — Full strict mode for type safety
- **Code Splitting** — ESM chunks for popup performance
- **Session Management** — Rate-limited tab spawning with deduplication
- **Heuristic-Based** — Apply-flow detection uses multi-signal scoring
- **Profile Isolation** — Each profile has separate data, resume, and answers

---

## 💾 Stored Data

The extension stores data locally in Chrome extension storage:

| Data Type | Description |
|-----------|-------------|
| **Named Profiles** | Multiple candidate profiles with separate settings |
| **Resumes** | One resume per profile (PDF, DOC, DOCX, TXT, MD, RTF) |
| **Candidate Details** | Common application fields (name, email, phone, etc.) |
| **Search Preferences** | Keywords, regions, date filters, job limits |
| **Remembered Answers** | Answers from previous applications |
| **Custom Q&A Pairs** | User-defined work-preference questions and answers |
| **Session State** | Temporary automation session data |

---

## ⚠️ Limitations

- **External Site Variability** — Career sites vary widely; autofill is heuristic-based and should be reviewed manually
- **Human Verification** — CAPTCHA, anti-bot, and verification flows require user intervention
- **Broad Permissions** — Host permissions are required for content script operation across job boards and application pages
- **No Auto-Submit** — Applications require manual review and submission

---

## 🔐 Permissions

| Permission | Purpose |
|------------|---------|
| `storage` | Store profiles, resumes, answers, and settings |
| `tabs` | Orchestrate multi-tab automation sessions |
| `scripting` | Inject content scripts into job sites |
| `clipboardWrite` | Copy application data to clipboard |
| `alarms` | Schedule background tasks |
| `host_permissions` | Run content scripts on job boards and application pages |

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📞 Support

For issues, questions, or feature requests, please open an issue on the [GitHub repository](https://github.com/your-username/auto-apply/issues).

---

**Built with ❤️ for job seekers everywhere.**
