// Drives the fitNotes production build in headless Chrome, one command per line on stdin.
// Pipe a script to it, or run it under tmux to work step by step. See SKILL.md.
//
//   node .claude/skills/run-fitnotes/driver.mjs <<'EOF'
//   find Incline Dumbell Press
//   ss search
//   EOF
//
// CHROME sets the browser path, PORT the preview port, SHOTS where screenshots go.
// Exits 1 if a command failed or the page logged an error.

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { chromium } from 'playwright-core';

const ROOT = resolve(import.meta.dirname, '../../..');
const PORT = process.env.PORT ?? '5198';
// Not localhost: Vite and Chrome can land on different families, each reaching another server.
const HOST = '127.0.0.1';
const BASE = `http://${HOST}:${PORT}/`;
const SHOTS = process.env.SHOTS ?? join(tmpdir(), 'fitnotes-shots');
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome';
const NO_DATA = 'rgb(58, 58, 60)';

mkdirSync(SHOTS, { recursive: true });

const problems = [];
let failures = 0;
let shots = 0;

async function until(condition, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return true;
    await new Promise((done) => setTimeout(done, 100));
  }
  return false;
}

const answers = () => fetch(BASE).then((reply) => reply.ok, () => false);

if (await answers()) {
  console.error(`Something already answers on ${BASE}. Stop it, or set PORT.`);
  process.exit(1);
}

const build = spawnSync('npx', ['vite', 'build'], { cwd: ROOT, encoding: 'utf8' });
if (build.status !== 0) {
  console.error(build.stdout, build.stderr);
  process.exit(1);
}

const server = spawn('npx', ['vite', 'preview', '--host', HOST, '--port', PORT, '--strictPort'], {
  cwd: ROOT,
  stdio: 'ignore',
  detached: true,
});

// Its own process group, so without this it outlives Ctrl-C, a timeout or a crash.
process.on('exit', () => {
  try {
    process.kill(-server.pid);
  } catch {
    // Already gone.
  }
});

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
});

// Nothing driven from here may reach the real backup, whatever token gets typed in.
await context.route('https://api.github.com/**', (route) => route.abort('blockedbyclient'));

const page = await context.newPage();
page.setDefaultTimeout(5_000);
page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() !== 'error') return;
  if (/ERR_INTERNET_DISCONNECTED|ERR_BLOCKED_BY_CLIENT|Failed to load resource/.test(message.text())) return;
  problems.push(`console: ${message.text()}`);
});

if (!(await until(answers))) {
  console.error(`The preview server did not answer on ${BASE}.`);
  await browser.close();
  process.exit(1);
}

await page.goto(BASE);
// `offline on` only works once the service worker controls the page.
await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15_000 });

const go = async (hash) => {
  await page.evaluate((target) => {
    window.location.hash = target;
  }, hash);
  await page.locator('main').waitFor();
};

const resultNames = () => page.locator('.result-name').allInnerTexts();

const commands = {
  /** home, search, map, settings, log/<id> or exercise/<id>. */
  go: ([route]) => go(route === 'home' ? '#/' : `#/${route}`),

  /** Opens search, types the query and prints the top results. */
  async find(words) {
    await go('#/search');
    const box = page.getByLabel('Search exercises');
    await box.fill(words.join(' '));
    await until(async () => (await resultNames()).length > 0, 2_000);
    console.log((await resultNames()).slice(0, 8).join('\n') || '(no results)');
  },

  /** log <id> <kg> <reps> [YYYY-MM-DD]. Saves an entry and stops on the exercise screen. */
  async log([id, kg, reps, date]) {
    await go(`#/log/${id}`);
    await page.locator('#log-reps').fill(reps);
    await page.locator('#log-weight').fill(kg);
    if (date) await page.locator('#log-date').fill(date);
    await page.locator('button.save').click();
    await page.locator('.ins-history').waitFor();
  },

  async bodyweight([kg]) {
    await go('#/settings');
    await page.locator('#bodyweight').fill(kg);
    await page.locator('#bodyweight').press('Enter');
  },

  /** A CSS selector, or failing that the visible text. */
  async click(words) {
    const target = words.join(' ');
    const css = await page.locator(target).count().catch(() => 0);
    await (css > 0 ? page.locator(target).first() : page.getByText(target, { exact: false }).first()).click();
  },

  /** fill <css> <value>. Goes through real input events, so React sees it. */
  fill: ([selector, ...value]) => page.locator(selector).fill(value.join(' ')),

  /** press <css> <key>, such as Enter. */
  press: ([selector, key]) => page.locator(selector).press(key),

  /** On the map, opens the numbers for the Nth muscle that has data, counting from 0. */
  async tap([n = '0']) {
    const polygons = page.locator('svg polygon');
    const fills = await polygons.evaluateAll((all) => all.map((polygon) => getComputedStyle(polygon).fill));
    const filled = fills.flatMap((fill, index) => (fill === NO_DATA ? [] : [index]));
    if (filled[n] === undefined) throw new Error(`Only ${filled.length} polygons have data.`);
    await polygons.nth(filled[n]).click();
  },

  async text() {
    console.log(await page.locator('main').innerText());
  },

  async ss([name]) {
    shots += 1;
    const path = join(SHOTS, `${String(shots).padStart(2, '0')}-${name ?? 'shot'}.png`);
    await page.screenshot({ path });
    console.log(path);
  },

  offline: ([state]) => context.setOffline(state !== 'off'),

  async reload() {
    await page.reload();
    await page.locator('nav.bar').waitFor();
  },

  async errors() {
    console.log(problems.join('\n') || '(none)');
  },

  // Runs in the headless page, not in Node, and only takes what the operator types here.
  async eval(words) {
    console.log(await page.evaluate(words.join(' ')));
  },
};

console.log(`ready ${BASE}`);
for await (const line of createInterface({ input: process.stdin })) {
  const [name, ...args] = line.trim().split(/\s+/);
  if (!name || name.startsWith('#')) continue;
  if (name === 'quit') break;
  console.log(`> ${line.trim()}`);
  try {
    if (!commands[name]) throw new Error(`Unknown command. Try: ${Object.keys(commands).join(', ')}, quit`);
    await commands[name](args);
  } catch (error) {
    failures += 1;
    console.log(`FAILED: ${error.message.split('\n')[0]}`);
  }
}

await browser.close();
console.log(problems.length > 0 ? `Page errors:\n${problems.join('\n')}` : 'No page errors.');
process.exit(failures > 0 || problems.length > 0 ? 1 : 0);
