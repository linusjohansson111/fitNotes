# fitNotes

`SPEC.md` holds what and why, and `docs/ARCHITECTURE.md` holds how. `/run-fitnotes` runs and drives the app.

## Commands

- `.claude/check`: types and unit tests, about 10 seconds.
- `npm run e2e`: the "Done when" flow in Chrome against a fake GitHub. It needs Chrome at `/usr/bin/google-chrome`, or `CHROME` set.

## Gotchas

- `src/data/exercises.json` is generated. Edit `src/data/catalogue.json` or `src/data/gaps.json`, then run `node scripts/build-exercises.mjs`, which downloads the pinned source unless given a local copy.
- Never use, open or consult Strength Level data, including the old tables in git history. Its policy forbids deriving ratios from it.
- Existing exercise ids must not change, and `Snapshot` stays version 1 with `customExercises`. Live backups depend on both.
- vitest sometimes exits 1 with `window is not defined` from react-dom while every test passes. It is a teardown race in `src/App.test.tsx`, so run it again.

## Release

1. Stop if a live entry in `backup.json` has no row, because Home hides such entries. Compare the entries without `deleted` in the private `fitnotes-data` repo, which `gh` can read, with `src/data/exercises.json`.
2. Run `npm version <x.y.z> --no-git-tag-version`, commit it as "Release version <x.y.z>", and add an annotated tag `v<x.y.z>` with the message "fitNotes <x.y.z>".
3. Fast-forward `main`. The owner pushes `main` and the tag, which deploys the app. Never force-push.
