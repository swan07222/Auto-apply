# Remote Job Search Starter

This project is a Chrome extension built in TypeScript. When you open Indeed, ZipRecruiter, or Dice and press the extension's `Start Auto Search` button, it opens remote searches for:

- `front end developer`
- `back end developer`
- `full stack developer`

Then it:

- collects individual job pages from those results
- opens the job-board apply flow when the board hosts the application
- opens the company-site apply page when the listing sends you off-site

If the current page shows a human-verification challenge, the extension pauses and resumes after you complete the check manually.

## Build

```powershell
npm install
npm run build
```

## Load in Chrome

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select either [`dist`](e:/New%20folder/dist) or the project root [`E:\New folder`](e:/New%20folder)

## Notes

- Supported sites: Indeed, ZipRecruiter, Dice
- The popup UI detects the active site and shows live status
- Search, job, and apply tabs are opened in the background next to the current tab
