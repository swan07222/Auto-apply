# Contributing

Thanks for improving Auto-apply.

## Local setup

1. Install Node.js 18+ and npm.
2. Run `npm install`.
3. Build the extension with `npm run build`.
4. Load the repo root as an unpacked extension in Chromium.

## Recommended workflow

1. Create a focused branch.
2. Make the smallest safe change that solves the problem.
3. Run the local validation steps before opening a PR.

## Validation checklist

Use this for normal code changes:

```bash
npm run test:ci
```

If you changed live-browser automation behavior, also run:

```bash
npm run test:live
```

## Code guidelines

- Preserve existing behavior on unaffected job sites.
- Prefer adding or updating regression tests with every bug fix.
- Keep site-specific behavior in focused helpers where practical.
- Avoid reverting unrelated worktree changes.
- Update docs when behavior or supported workflows change.

## Live-site safety

- Never submit real applications unless the task explicitly requires it.
- Expect verification pages, auth walls, and site layout drift.
- Prefer unit, replay, and fixture coverage for risky logic whenever possible.
