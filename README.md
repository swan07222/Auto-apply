# Remote Job Search Starter

This project is a Chrome extension built in TypeScript. It can start searches on:

- Indeed
- ZipRecruiter
- Dice
- Monster

From the popup you can now:

- set how many job pages each search tab should open
- upload separate resumes for `Front End`, `Back End`, and `Full Stack`
- store candidate profile details for common application fields
- automatically upload the matching resume on supported application forms
- remember answers you type into application questions and reuse them later

The automation flow now:

- opens the search tabs for front end, back end, and full stack roles
- collects individual job pages from the results
- opens the board-hosted apply flow or the external company career page
- tries to autofill blank fields and resume uploads without auto-submitting

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
- The extension stores settings, resumes, and remembered answers in Chrome local extension storage.
