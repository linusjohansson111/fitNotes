// End-to-end walk through the SPEC "Done when" flow on the production build, using a
// real browser, a real service worker and an in-memory GitHub. iPhone Safari itself is
// not covered: run the "Done when" check by hand on a phone as well.
//
//   npm run e2e
//
// CHROME sets the browser path. E2E_OUT sets where screenshots go.

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const PORT = 5199;
const BASE = `http://localhost:${PORT}/`;
const TOKEN = 'github_pat_e2e';
const OUT = process.env.E2E_OUT ?? join(tmpdir(), 'fitnotes-e2e');
const YELLOW = 'rgb(255, 214, 10)';
const GREY = 'rgb(58, 58, 60)';

mkdirSync(OUT, { recursive: true });

const results = [];
function check(name, passed, detail = '') {
  results.push(passed);
  console.log(`${passed ? 'ok  ' : 'FAIL'} ${name}${passed || !detail ? '' : ` -- ${detail}`}`);
}

/** The parts of the GitHub API the app uses, with the same sha rules. */
class FakeGitHub {
  isPrivate = true;
  online = true;
  puts = [];
  callsWhileOffline = 0;
  file = null;

  get snapshot() {
    return this.file && JSON.parse(Buffer.from(this.file.content, 'base64').toString('utf8'));
  }

  async handle(route) {
    const request = route.request();
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET, PUT, OPTIONS',
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (!this.online) {
      this.callsWhileOffline += 1;
      return route.abort('internetdisconnected');
    }
    const reply = (status, body) => route.fulfill({ status, headers: cors, json: body });
    if (request.headers().authorization !== `Bearer ${TOKEN}`) return reply(401, { message: 'Bad credentials' });

    const path = new URL(request.url()).pathname;
    if (path === '/user') return reply(200, { login: 'tester' });
    if (path === '/repos/tester/fitnotes-data') return reply(200, { name: 'fitnotes-data', private: this.isPrivate });
    if (path !== '/repos/tester/fitnotes-data/contents/backup.json') return reply(404, { message: 'Not Found' });

    if (request.method() === 'GET') {
      if (!this.file) return reply(404, { message: 'Not Found' });
      return reply(200, { ...this.file, encoding: 'base64' });
    }
    const body = request.postDataJSON();
    if ((body.sha ?? null) !== (this.file?.sha ?? null)) return reply(409, { message: 'sha mismatch' });
    this.file = { content: body.content, sha: `sha${this.puts.length + 1}` };
    this.puts.push(body);
    return reply(200, { content: { sha: this.file.sha } });
  }
}

const gh = new FakeGitHub();
const problems = [];

async function installApp(browser, name) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  });
  await context.route('https://api.github.com/**', (route) => gh.handle(route));
  const page = await context.newPage();
  page.on('pageerror', (error) => problems.push(`${name}: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && !/ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(message.text())) {
      problems.push(`${name}: ${message.text()}`);
    }
  });
  await page.goto(BASE);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15_000 });
  return { context, page };
}

const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.png`) });
const main = (page) => page.locator('body').innerText();

async function until(condition, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

async function openSettings(page) {
  await page.getByLabel('Home', { exact: true }).first().click();
  await page.getByLabel('Settings').click();
}

async function connect(page) {
  await openSettings(page);
  await page.getByLabel('GitHub token').fill(TOKEN);
  await page.getByLabel('GitHub token').press('Enter');
  await page.getByText(/No backup yet|Last backup/).waitFor();
}

async function logNew(page, query, name, weight, reps, date) {
  await page.getByLabel('Add exercise').click();
  await page.getByLabel('Search exercises').fill(query);
  await page.getByRole('link', { name, exact: true }).first().click();
  await logWith(page, weight, reps, date);
}

async function logWith(page, weight, reps, date) {
  await page.locator('#log-reps').fill(String(reps));
  await page.locator('#log-weight').fill(String(weight));
  if (date) await page.locator('#log-date').fill(date);
  await page.locator('button.save').click();
  await page.locator('.ins-history').waitFor();
}

function daysAgo(days) {
  const date = new Date(Date.now() - days * 86_400_000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const muscleFills = (page) =>
  page.$$eval('.rbh polygon, svg polygon', (polygons) => [...new Set(polygons.map((polygon) => getComputedStyle(polygon).fill))]);

const homeRows = (page) => page.$$eval('.row', (rows) => rows.map((row) => row.innerText.replace(/\s+/g, ' ').trim()));

async function run(browser) {
  const { context, page } = await installApp(browser, 'phone');

  await connect(page);
  await page.locator('#bodyweight').fill('80');
  await page.locator('#bodyweight').press('Enter');
  await until(() => page.locator('#bodyweight').inputValue().then((value) => value === '80'), 2_000);
  await until(() => Promise.resolve(gh.puts.length > 0), 8_000);
  const putsBeforeOffline = gh.puts.length;

  // AC1: the installed app opens and saves with no connection.
  gh.online = false;
  await context.setOffline(true);
  await page.reload();
  await page.getByLabel('Add exercise').waitFor();
  check('AC1 opens offline', true);

  // AC5: a new exercise starts yellow, 8 reps, blank weight.
  await page.getByLabel('Add exercise').click();
  await page.getByLabel('Search exercises').fill('bench');
  await page.getByRole('link', { name: 'Barbell Bench Press - Medium Grip', exact: true }).first().waitFor();
  check('AC3 search lists the bench press', true);
  await until(() => page.locator('.rows svg polygon').count().then((count) => count > 0), 3_000);
  await shot(page, '1-search');
  await page.getByRole('link', { name: 'Barbell Bench Press - Medium Grip', exact: true }).first().click();
  check('AC5 a new exercise starts yellow', (await page.locator('form.log').getAttribute('data-colour')) === 'yellow');
  check('AC5 a new exercise starts on 8 reps', (await page.locator('#log-reps').inputValue()) === '8');
  check('AC5 a new exercise starts with a blank weight', (await page.locator('#log-weight').inputValue()) === '');

  // AC7: all three colours from one entry.
  await logWith(page, 80, 8, daysAgo(7));
  const first = await main(page);
  check('AC7 shows all three colours after one entry', /87\.5[\s\S]*80[\s\S]*72\.5/.test(first), first.slice(0, 200));
  await shot(page, '2-first-entry');

  await page.getByLabel('Home', { exact: true }).first().click();
  await shot(page, '3-home');
  check('AC4 home lists the exercise', (await homeRows(page)).some((row) => row.includes('Barbell Bench Press')));

  // AC5, AC6: the form starts on the prediction and follows the reps until edited.
  await page.locator('.row-log').first().click();
  check('AC5 starts on the predicted weight', (await page.locator('#log-weight').inputValue()) === '80');
  await page.locator('#log-reps').fill('6');
  check('AC6 reps 6 turn the form red', (await page.locator('form.log').getAttribute('data-colour')) === 'red');
  check('AC6 an unedited weight follows the colour', (await page.locator('#log-weight').inputValue()) === '87.5');
  await page.locator('#log-weight').fill('90');
  await page.locator('#log-reps').fill('11');
  check('AC6 reps 11 turn the form green', (await page.locator('form.log').getAttribute('data-colour')) === 'green');
  check('AC6 an edited weight stays', (await page.locator('#log-weight').inputValue()) === '90');

  // The second entry, in another colour, today.
  await logWith(page, 90, 5);
  const dots = await page.locator('svg[aria-label^="Strength"] circle').count();
  check('AC13 the graph shows both entries as dots', dots >= 2, `${dots} dots`);
  check('AC13 the history lists both entries', (await page.locator('.ins-history li').count()) === 2);
  await shot(page, '4-second-entry');

  // AC15: one lift can only be in proportion with itself.
  await page.getByLabel('Map', { exact: true }).click();
  await page.locator('svg polygon').first().waitFor();
  const oneLift = await muscleFills(page);
  check('AC15 one lift is yellow and grey only', oneLift.every((fill) => fill === YELLOW || fill === GREY), oneLift.join(' '));

  await logNew(page, 'barbell squat', 'Barbell Squat', 180, 8, daysAgo(1));
  await page.getByLabel('Map', { exact: true }).click();
  await page.locator('svg polygon').first().waitFor();
  const twoLifts = await muscleFills(page);
  check('AC15 a stronger lift moves the map off yellow', twoLifts.some((fill) => fill !== YELLOW && fill !== GREY), twoLifts.join(' '));
  await shot(page, '5-map');

  // AC3, AC16: a misspelt search finds the lift, nothing offers to add one, and the
  // lift counts on the map, which credits its data source.
  await page.getByLabel('Add exercise').click();
  await page.getByLabel('Search exercises').fill('Incline Dumbell Press');
  await page.waitForFunction(() => document.querySelector('.result-name')?.textContent === 'Incline Dumbbell Press');
  check('AC3 a misspelling still ranks the lift first', true);
  await page.getByLabel('Search exercises').fill('Odd lift');
  await until(() => page.locator('.result').count().then((count) => count === 0), 3_000);
  check('AC3 search offers no way to add an exercise', (await page.locator('main a').count()) === 0);
  await shot(page, '5-no-add');
  await logNew(page, 'Incline Dumbell Press', 'Incline Dumbbell Press', 30, 8);
  await page.getByLabel('Map', { exact: true }).click();
  await page.locator('svg polygon').first().waitFor();
  const withIncline = await muscleFills(page);
  check('AC16 any exercise moves the map', withIncline.join() !== twoLifts.join(), withIncline.join(' '));
  const attribution = page.getByRole('link', { name: 'Powered by FitnessVolt' });
  check('AC23 the map credits FitnessVolt', (await attribution.getAttribute('href')) === 'https://fitnessvolt.com/strength-standards/strength-data/');
  const figureBottom = (await page.locator('.ins-map-figure').boundingBox()).y + (await page.locator('.ins-map-figure').boundingBox()).height;
  check('AC23 the link sits below the map', (await attribution.boundingBox()).y >= figureBottom);
  await shot(page, '5-map-attribution');

  // AC12: a target out of reach shows as assistance.
  await logNew(page, 'pullups', 'Pullups', 0, 3);
  check('AC12 an out-of-reach target shows a negative weight', /−\d/.test(await main(page)));
  await shot(page, '6-assisted');

  check('offline work sent nothing to GitHub', gh.puts.length === putsBeforeOffline);

  await page.reload();
  await page.getByLabel('Map', { exact: true }).waitFor();
  await page.getByLabel('Home', { exact: true }).first().click();
  check('AC1 entries survive an offline reload', (await homeRows(page)).length === 4);

  // AC2: reconnecting backs up with no user action.
  const rows = await homeRows(page);
  gh.online = true;
  await context.setOffline(false);
  const backedUp = await until(() => Promise.resolve(gh.snapshot?.entries.length === 5));
  check('AC2 reconnecting backs up without user action', backedUp, JSON.stringify(gh.snapshot)?.slice(0, 200));
  check('AC2 the bodyweight is in the backup', gh.snapshot?.bodyweights.length === 1);
  check('AC2 the backup keeps its format', Array.isArray(gh.snapshot?.customExercises) && gh.snapshot?.version === 1);
  check('the token is not in the backup', !JSON.stringify(gh.snapshot).includes(TOKEN));

  // AC2: a fresh install restores every record.
  const fresh = await installApp(browser, 'reinstall');
  await connect(fresh.page);
  await fresh.page.getByLabel('Home', { exact: true }).first().click();
  const restored = await until(async () => (await homeRows(fresh.page)).length === rows.length, 10_000);
  check('AC2 a fresh install restores every exercise', restored);
  check('AC2 restored rows match the phone', JSON.stringify(await homeRows(fresh.page)) === JSON.stringify(rows), JSON.stringify(await homeRows(fresh.page)));
  await shot(fresh.page, '7-restored');
  await fresh.page.locator('.row-history').first().click();
  await fresh.page.locator('.ins-history li').first().waitFor();
  check('AC13 restored history is complete', (await fresh.page.locator('.ins-history li').count()) >= 1);
  await fresh.context.close();

  // A deletion made on another device reaches this one on its next sync.
  const cleared = gh.snapshot;
  cleared.entries = cleared.entries.map((entry) => ({ ...entry, deleted: true, updatedAt: Date.now() }));
  gh.file = { content: Buffer.from(JSON.stringify(cleared)).toString('base64'), sha: 'cleared' };
  await page.reload();
  await page.getByLabel('Add exercise').waitFor();
  await page.getByLabel('Home', { exact: true }).first().click();
  check('a deletion from elsewhere clears this device', await until(async () => (await homeRows(page)).length === 0, 10_000));
  check('the bodyweight survives clearing entries', (await until(() => Promise.resolve(gh.snapshot.bodyweights.length === 1), 1_000)));

  // A repo made public stops receiving data, in the same session.
  const putsBeforePublic = gh.puts.length;
  gh.isPrivate = false;
  await logNew(page, 'barbell squat', 'Barbell Squat', 182.5, 8);
  await until(() => Promise.resolve(gh.puts.length > putsBeforePublic), 6_000);
  check('a repo made public receives no backup', gh.puts.length === putsBeforePublic);
  await openSettings(page);
  check('settings explains the public repo', /not private/i.test(await main(page)));

  await context.close();
}

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true });
let browser;
try {
  if (!(await until(() => fetch(BASE).then((reply) => reply.ok, () => false), 15_000))) throw new Error('preview server did not start');
  browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: true });
  await run(browser);
  check('no console or page errors', problems.length === 0, problems.join(' | '));
} catch (error) {
  check('walkthrough finished', false, error.stack);
} finally {
  await browser?.close();
  process.kill(-server.pid);
}

const failed = results.filter((passed) => !passed).length;
console.log(`\n${results.length - failed}/${results.length} passed. Screenshots: ${OUT}`);
process.exit(failed > 0 ? 1 : 0);
