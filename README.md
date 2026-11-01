# fitNotes

Log the strongest set of an exercise on your iPhone and see what weight should hit your
target reps next time. It is a Home Screen web app that works offline and backs up to a
private GitHub repo. See [SPEC.md](SPEC.md) for what it does and why, and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how it is built.

The app is live at <https://linusjohansson111.github.io/fitNotes/>.

## Develop

```sh
npm ci
npm run dev     # local server, also reachable from a phone on the same network
npm run check   # types, tests and production build
npm run e2e     # the "Done when" walkthrough in Chrome, against an in-memory GitHub
```

Offline behaviour needs the production build, because the service worker only runs there:
`npm run build && npm run preview`.

## Install on your iPhone

1. Open <https://linusjohansson111.github.io/fitNotes/> in Safari. The address is
   case-sensitive, so `fitnotes` in lower case gives a 404.
2. Tap Share, then Add to Home Screen, and open the app from the Home Screen. Safari and
   the Home Screen app keep separate data.
3. Go to Settings, paste your GitHub token, and set your bodyweight. A new phone or a
   reinstall restores every record as soon as the token is in.

**Creating a token.** On GitHub, go to Settings → Developer settings → Fine-grained tokens.
Limit it to the `fitnotes-data` repo and give it Contents read and write access.

## Deploy

Pushing `main` publishes the app to GitHub Pages through `.github/workflows/deploy.yml`.
The phone picks up a new version the next time the app is opened online.

Backups go to `backup.json` in the private `fitnotes-data` repo. The repo must keep that
name, and the app refuses to back up to it if it is ever made public.

## Exercises

`src/data/exercises.json` holds every exercise the app knows, one record per exercise:
muscles, equipment, base lift, ratio, confidence and reason. Regenerate it with
`node scripts/build-exercises.mjs`, which refuses to write a bad row. To change a row, edit
`src/data/catalogue.json`, where ratios and corrections to the source data live, and
`src/data/gaps.json` for lifts the source lacks.

## Muscle map

Every logged lift counts, for each of its muscles. A lift is compared with your own average
level, so one lift always shows yellow and the map needs at least two before colours
differ. Tap a muscle to see its numbers.

An exercise's level comes from its base lift's levels at your bodyweight, times its ratio
and the raise for its group. `RAISES` in `src/balance/index.ts` is yours to edit. Base lift
levels are men's gym percentiles from
[FitnessVolt](https://fitnessvolt.com/strength-standards/strength-data/), CC BY 4.0, held in
`src/balance/baseLifts.json`. Its class above 120 kg is left out, because its low
percentiles fall below bodyweight on bodyweight lifts.

## Backup and restore

- Backups run while the app is open: at start, after each change, when the phone
  reconnects, when you return to the app and when you leave it. iPhones give web apps no
  background time, so changes made offline are backed up the next time the app is open
  with a connection.
- Before deleting the app, open it once while online. Deleting it removes everything on
  the phone that has not been backed up yet.
- After a reinstall, paste the token in Settings and every record comes back. A fresh
  install needs the token again because deleting the app also deletes the stored token.
- Every backup is a commit in `fitnotes-data`, so older versions stay in its history.
- When the token expires, paste a new one in Settings.
