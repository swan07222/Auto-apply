# Remote Job Search Starter

This project is a Chrome extension built in TypeScript. It can start searches on:

- Indeed
- ZipRecruiter
- Dice
- Monster

From the popup you can now:

- set the total number of job pages an automation run should open
- upload separate resumes for `Front End`, `Back End`, and `Full Stack`
- store candidate profile details for common application fields
- switch between `Job boards` mode and `Startup careers` mode
- switch between `Job boards`, `Startup careers`, and `Other job sites`
- filter startup companies and other job sites by `US`, `UK`, or `EU` using the search region setting or the saved country when region is set to `Auto`
- automatically upload the matching resume on supported application forms
- remember answers you type into application questions and reuse them later
- skip jobs that already appear as applied or submitted
- open ChatGPT to draft long-form application answers like cover letters or "why are you interested?" responses using the current job description and selected resume

The automation flow now:

- opens the search tabs for front end, back end, and full stack roles
- collects individual job pages from the results
- opens the board-hosted apply flow or the external company career page
- tries to autofill blank fields and resume uploads without auto-submitting
- when it finds blank long-form questions, it can open ChatGPT, attach the selected resume, send the job context, copy the generated answer, and paste it back into the application field

Startup mode opens curated startup company career pages for the selected region, scans those pages for matching front end, back end, and full stack roles, then opens the matching job pages and tries to autofill them.

Other job sites mode opens curated regional search pages on additional job sites, scans those result pages for matching front end, back end, and full stack roles, then opens the matching job pages and tries to autofill them.

If a board or career site shows a human-verification challenge, the extension pauses and resumes after you complete it manually.

## Build

```powershell
npm install
npm run build
```

## Load in Chrome

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select either the `dist` folder or the project root

## Notes

- External company-site autofill is generic and heuristic-based, so you should review each application before submitting.
- ChatGPT answer generation depends on you being signed in on `chatgpt.com`, and the site UI may occasionally require selector updates.
- The extension stores settings, resumes, and remembered answers in Chrome local extension storage.
- The curated startup company list currently covers official career pages for US, UK, and EU startups and can be expanded further.
- The curated other-job-site list currently includes region-aware searches on sites such as Built In, The Muse, Work at a Startup, Reed, CWJobs, Totaljobs, Welcome to the Jungle, and BerlinStartupJobs.
