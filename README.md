# fitNotes

Log the strongest set of an exercise on your iPhone and see what weight should hit your
target reps next time. It is a Home Screen web app that works offline and backs up to a
private GitHub repo. See [SPEC.md](SPEC.md) for what it does and why, and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how it is built.

## Develop

```sh
npm ci
npm run dev     # local server, also reachable from a phone on the same network
npm run check   # types, tests and production build
```

Offline behaviour needs the production build, because the service worker only runs there:
`npm run build && npm run preview`.

## Set up on your iPhone

**1. Host the app.** iPhones only install web apps from HTTPS. Pushing to `main` deploys
to GitHub Pages through `.github/workflows/deploy.yml`, which needs a public repo on a
free GitHub plan. The app holds no secrets or personal data, so this is safe.

```sh
gh repo create fitNotes --public --source . --push
gh api -X POST repos/{owner}/fitNotes/pages -f build_type=workflow
```

**2. Create the private backup repo.** Backups go to `backup.json` in a repo that must be
named `fitnotes-data`. The app refuses to back up to a repo that is not private.

```sh
gh repo create fitnotes-data --private
```

**3. Create a token.** On GitHub, go to Settings → Developer settings → Fine-grained
tokens. Limit it to the `fitnotes-data` repo and give it Contents read and write access.

**4. Install.** Open the site in Safari, then Share → Add to Home Screen. Open the app from
the Home Screen, go to Settings, paste the token, and set your bodyweight.

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
