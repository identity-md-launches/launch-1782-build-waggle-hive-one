// Worker-side checks against the production export. Test tools stay outside the site bundle.
// Set PLAYWRIGHT_MODULE and AXE_MODULE for externally installed tools. Requires Node 24+.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

async function dependency(name, env) {
  return import(process.env[env] ? pathToFileURL(process.env[env]).href : name);
}
const { chromium, webkit } = await dependency('playwright', 'PLAYWRIGHT_MODULE');
const { default: AxeBuilder } = await dependency('@axe-core/playwright', 'AXE_MODULE');
const scratch = resolve('test/scratch/validation');
await mkdir(scratch, { recursive: true });
for (const name of ['data', 'geometry', 'poll']) {
  const source = await readFile(`src/${name}.ts`, 'utf8');
  const result = stripTypeScriptTypes(source);
  await writeFile(`${scratch}/${name}.mjs`, result.replaceAll("'./data'", "'./data.mjs'"));
}
const data = await import(pathToFileURL(`${scratch}/data.mjs`).href);
const geo = await import(pathToFileURL(`${scratch}/geometry.mjs`).href);
const { parseSwarm, number, compact, seatMetrics, eventText, percent } = data;
const report = { started: new Date().toISOString(), checks: [], limitations: [], screenshots: [], liveSeats: [] };
function pass(name, detail = '') { report.checks.push({ name, passed: true, detail }); console.log(`PASS ${name}${detail ? `: ${detail}` : ''}`); }

assert.throws(() => parseSwarm({ seats: null }));
assert.throws(() => parseSwarm({ seats: [] }));
const hostile = {
  health: { agentsOnline: '12', workingNow: Infinity, acceptedLastDay: null, seatsEnrolled: NaN },
  seats: {
    0: { accepted: 10, rejected: 2, failed: 1, working: true, last: null },
    1: { accepted: 20, rejected: 0, failed: 0, working: false },
    2: { accepted: 20, rejected: 0, failed: 0 },
    3: { accepted: Infinity, rejected: '2', failed: NaN },
  },
  get owners() { throw new Error('Unpermitted field accessed'); },
  events: [
    { kind: 'node', at: '2026-10-14T00:00:00Z', tokenId: 0, role: 'build', step: '<img src=x>', state: '<script>bad</script>' },
    { kind: 'node', at: '2026-10-14T00:00:01Z', tokenId: 1, role: 'verify', step: 'check_build', state: 'accepted' },
    { kind: 'node', at: '2026-10-14T00:00:02Z', tokenId: 2, role: 'build', state: 'working' },
    { kind: 'agent', at: '2026-10-14T00:00:03Z', tokenId: 0, state: 'joined' },
    { kind: 'node', at: 'invalid', tokenId: 0, state: 'accepted' },
    { kind: 'node', at: '2026-10-14T00:00:04Z', tokenId: 2000, state: 'accepted' },
  ],
};
const sanitized = parseSwarm(hostile);
assert.equal(sanitized.seats.length, 2000);
assert.deepEqual(Object.values(sanitized.health), [null, null, null, null]);
assert.equal(sanitized.seats[3].accepted, null);
assert.equal(sanitized.events.length, 4);
assert.equal(eventText(sanitized.events[0]), 'Seat #0 joined the swarm');
assert.equal(eventText(sanitized.events[1]), 'Seat #2 is working on a build step');
assert.equal(eventText(sanitized.events[2]), 'Seat #1 had a verify step accepted: check build');
assert.equal(eventText(sanitized.events[3]), 'Seat #0 –');
assert.deepEqual(seatMetrics(sanitized.seats[0], sanitized), { total: 13, success: 10 / 13, rank: 3, share: 0.2 });
assert.equal(seatMetrics(sanitized.seats[1], sanitized).rank, 1);
assert.equal(seatMetrics(sanitized.seats[2], sanitized).rank, 1);
assert.equal(seatMetrics(sanitized.seats[3], sanitized).success, null);
assert.equal(number(NaN), '–'); assert.equal(number(Infinity), '–');
assert.equal(compact(13135), '13k'); assert.equal(compact(202313247763), '202B');
pass('Allowlist, untrusted text, invalid numbers, sparse seats, tied rank, share and success');

let cellChecks = 0;
for (const width of [246, 286, 324, 488, 684, 1120, 1432]) {
  const g = geo.geometry(width);
  assert.equal(g.cols, Math.min(40, Math.max(16, Math.floor((width - 8) / 14 - 0.5))));
  assert.equal(geo.hitTest(-1, 0, g), null);
  assert.equal(geo.hitTest(width + 1, g.height, g), null);
  assert.equal(geo.hitTest(0, 0, g), null);
  for (let id = 0; id < 2000; id++) {
    const p = geo.center(id, g);
    assert.equal(geo.hitTest(p.x, p.y, g), id);
    assert.equal(geo.hitTest(p.x + g.radius * 0.2, p.y + g.radius * 0.2, g), id);
    cellChecks += 2;
  }
  assert.equal(geo.keyboardSeat(1999, 'ArrowRight', g.cols), 1999);
  assert.equal(geo.keyboardSeat(0, 'ArrowUp', g.cols), 0);
}
pass('Hex geometry and hit testing', `${cellChecks.toLocaleString('en-US')} point checks; seven widths; empty margins and keyboard bounds`);

// Run the actual polling implementation with a deterministic scheduler; no wall-clock wait.
async function pollCheck() {
  const pollingSource = (await readFile(`${scratch}/poll.mjs`, 'utf8')).replace(/^import .*;$/m, '').replaceAll('export ', '');
  let now = 0, nextId = 1, hidden = false, mode = 'good';
  const timers = new Map(), listeners = new Map(), requests = [], callbacks = [];
  const fakeDoc = { get hidden() { return hidden; }, addEventListener: (type, fn) => listeners.set(type, fn) };
  const sandbox = {
    Date: { now: () => now }, document: fakeDoc, AbortController, parseSwarm,
    setTimeout: (fn, delay) => { const id = nextId++; timers.set(id, { at: now + delay, fn }); return id; },
    clearTimeout: id => timers.delete(id),
    fetch: (_url, opts) => {
      requests.push({ at: now, options: opts });
      if (mode === 'timeout') return new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(new Error('timeout'))));
      if (mode === 'failure') return Promise.reject(new Error('offline'));
      return Promise.resolve({ ok: true, json: async () => mode === 'invalid' ? {} : { seats: {} } });
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(`${pollingSource}\nglobalThis.start = startPolling;`, sandbox);
  const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  async function advance(ms) {
    const end = now + ms;
    while (true) {
      const ready = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!ready || ready[1].at > end) break;
      now = ready[1].at; timers.delete(ready[0]); ready[1].fn(); await flush();
    }
    now = end; await flush();
  }
  sandbox.start(() => callbacks.push('good'), () => callbacks.push('error'), () => {});
  await flush(); assert.deepEqual(callbacks, ['good']);
  await advance(29999); assert.equal(requests.length, 1);
  await advance(1); assert.equal(requests.length, 2);
  hidden = true; listeners.get('visibilitychange')();
  await advance(120000); assert.equal(requests.length, 2);
  hidden = false; listeners.get('visibilitychange')(); await flush(); assert.equal(requests.length, 3);
  hidden = true; listeners.get('visibilitychange')(); await advance(10000);
  hidden = false; listeners.get('visibilitychange')(); await flush(); assert.equal(requests.length, 3);
  mode = 'invalid'; await advance(20000); assert.equal(callbacks.at(-1), 'error');
  mode = 'failure'; await advance(30000); assert.equal(callbacks.at(-1), 'error');
  mode = 'timeout'; await advance(30000); const callbackCount = callbacks.length;
  await advance(14999); assert.equal(callbacks.length, callbackCount);
  await advance(1); assert.equal(callbacks.length, callbackCount + 1);
  assert.equal(requests.at(-1).options.signal.aborted, true);
  assert(requests.every((r, i) => i === 0 || r.at - requests[i - 1].at >= 30000));
  pass('Polling and timeout', '30 s minimum, pause while hidden, one catch-up, no early return fetch, 15 s abort, invalid-response and network-error callbacks');
}
await pollCheck();

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (!path.startsWith('/preview/')) { res.writeHead(404).end(); return; }
    const file = resolve('dist', path.slice(9) || 'index.html');
    if (!file.startsWith(resolve('dist') + '/')) { res.writeHead(403).end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const url = `${origin}/preview/`;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light', reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [], requests = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', req => requests.push(req.url()));
  const responsePromise = page.waitForResponse('https://api.imd.fun/swarm');
  await page.goto(url);
  const response = await responsePromise;
  assert.equal(response.status(), 200);
  const snapshot = parseSwarm(await response.json());
  await page.waitForFunction(() => document.querySelector('#sync-label').textContent.startsWith('Updated'));
  assert.equal(await page.title(), 'Waggle Hive');
  assert.equal(await page.locator('h1').innerText(), 'The hive, live');
  assert.equal(await page.locator('#agents-online').innerText(), number(snapshot.health.agentsOnline));
  assert((await page.locator('#seat-form').boundingBox()).y < 650);
  assert((await page.locator('#seat-map').boundingBox()).y < 844);
  pass('Live API and first screen at 390', 'Swarm statistics, finder and map are visible; export served at /preview/');

  async function choose(id) {
    await page.locator('#seat-number').fill(String(id));
    await page.getByRole('button', { name: 'Go', exact: false }).first().click();
    await page.waitForFunction(id => document.querySelector('#agent-title').textContent === `Agent #${id}`, id);
  }
  async function checkSeat(id) {
    const seat = snapshot.seats[id], metrics = seatMetrics(seat, snapshot);
    assert.equal(await page.locator('#agent-title').innerText(), `Agent #${id}`);
    assert.equal(await page.locator('#agent-accepted').innerText(), number(seat.accepted));
    assert.equal(await page.locator('#agent-rejected').innerText(), number(seat.rejected));
    assert.equal(await page.locator('#agent-failed').innerText(), number(seat.failed));
    assert.equal(await page.locator('#agent-success').innerText(), percent(metrics.success));
    assert.equal(await page.locator('#agent-share').innerText(), percent(metrics.share));
    assert.equal(await page.locator('#agent-rank').innerText(), `#${metrics.rank} of 2,000 by accepted work`);
    assert.equal(await page.locator('#explorer-link').getAttribute('href'), `https://explorer.imd.fun/agents/${id}`);
    report.liveSeats.push({ id, accepted: seat.accepted, rejected: seat.rejected, failed: seat.failed, success: percent(metrics.success), rank: metrics.rank, share: percent(metrics.share), acceptedTotal: snapshot.totalAccepted });
  }
  await choose(827); await checkSeat(827);
  await page.locator('#previous-seat').click(); assert.equal(await page.locator('#agent-title').innerText(), 'Agent #826');
  await page.locator('#next-seat').click(); await page.locator('#next-seat').click();
  assert.equal(await page.locator('#agent-title').innerText(), 'Agent #828');
  const topId = [...snapshot.seats].sort((a, b) => (b.accepted ?? 0) - (a.accepted ?? 0))[0].tokenId;
  await choose(topId); await checkSeat(topId);
  await choose(827);
  await page.screenshot({ path: `${scratch}/390-selected-light.png` });
  report.screenshots.push('390-selected-light.png');
  const panelBox = await page.locator('#seat-panel').boundingBox();
  assert(panelBox.height <= 844 * 0.45 + 1);
  assert(panelBox.y + panelBox.height <= 844);
  assert.equal(await page.locator('#seat-panel').evaluate(el => getComputedStyle(el).overflowY), 'auto');
  await page.locator('#close-panel').click();
  assert.equal(await page.locator('#panel-details').isVisible(), false);
  assert.equal(await page.locator('#seat-map').evaluate(el => el === document.activeElement), true);
  pass('Seat 827, previous/next, second-seat metrics, explorer and phone panel', 'Values match the same live response; panel ≤45% viewport, scrollable, close restores focus');

  const width = await page.locator('#seat-map').evaluate(el => el.getBoundingClientRect().width);
  const cols = geo.geometry(width).cols;
  let id = 827;
  for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp']) {
    await page.locator('#seat-map').press(key);
    id = geo.keyboardSeat(id, key, cols);
    assert((await page.locator('#seat-announcement').textContent()).startsWith(`Seat #${id}, `));
  }
  await page.locator('#seat-map').press('Enter'); assert.equal(await page.locator('#agent-title').innerText(), `Agent #${id}`);
  await page.locator('#seat-map').press('Escape'); assert.equal(await page.locator('#panel-details').isVisible(), false);
  await page.locator('#seat-map').press('Space'); assert.equal(await page.locator('#panel-details').isVisible(), true);
  await page.locator('#seat-map').press('Escape');
  await page.locator('#seat-number').fill('2000'); await page.locator('#seat-form button').click();
  assert.equal(await page.locator('#seat-number').getAttribute('aria-invalid'), 'true');
  assert.equal(await page.locator('#seat-error').innerText(), 'Choose a seat from 0 to 1999.');
  await choose(0); assert.equal(await page.locator('#previous-seat').isDisabled(), true);
  await choose(1999); assert.equal(await page.locator('#next-seat').isDisabled(), true);
  await page.locator('#close-panel').click();
  pass('Keyboard, live region, field validation and seat boundaries');

  await page.locator('.busiest-row').first().click();
  assert.equal(await page.locator('#agent-title').innerText(), `Agent #${topId}`);
  await page.locator('#close-panel').click();
  if (snapshot.events.length) {
    await page.locator('#events-list button').first().click();
    assert.equal(await page.locator('#agent-title').innerText(), `Agent #${snapshot.events[0].tokenId}`);
    await page.locator('#close-panel').click();
  }
  pass('Busiest-seat and latest-event selection');

  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 844 }); await page.evaluate(() => scrollTo(0, 0));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const targets = await page.locator('button:visible').evaluateAll(buttons => buttons.map(el => el.getBoundingClientRect()).filter(r => r.width < 44 || r.height < 44));
      assert.equal(targets.length, 0);
      if ([320, 390, 1440].includes(width)) {
        const filename = `${width}-${theme}.png`;
        await page.screenshot({ path: `${scratch}/${filename}`, fullPage: width === 1440 });
        report.screenshots.push(filename);
      }
    }
    const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    assert.deepEqual(audit.violations.map(v => `${v.id}: ${v.description}`), []);
    pass(`Responsive layout and axe scan (${theme})`, '320, 390, 768, 1024, 1440; no overflow; every visible button ≥44 px; no WCAG A/AA violations detected');
  }
  const canvasHash = await page.locator('#seat-map').evaluate(el => el.toDataURL());
  await page.emulateMedia({ colorScheme: 'light' });
  assert.notEqual(await page.locator('#seat-map').evaluate(el => el.toDataURL()), canvasHash);
  assert.equal(await page.evaluate(() => document.getAnimations().filter(a => a.playState === 'running').length), 0);
  assert.equal(await page.locator('#seat-announcement').getAttribute('aria-live'), 'polite');
  assert.equal(await page.locator('footer').innerText().then(s => s.includes('Waggle is an independent social network. It is not affiliated with, endorsed by or run by IMD.')), true);
  assert.equal(await page.locator('footer a').getAttribute('href'), 'https://waggle.social');
  assert.equal(await page.locator('body').innerText().then(s => /0x[a-fA-F0-9]{40}/.test(s)), false);
  assert(requests.every(u => u.startsWith(origin + '/') || u === 'https://api.imd.fun/swarm'));
  assert.equal(await context.cookies().then(c => c.length), 0);
  assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
  assert.deepEqual(errors, []);
  pass('Live scheme switch, reduced motion, footer, privacy, CSP, network allowlist and no console errors');

  // Intercepted network fixtures are isolated tests; no fixture is used by the application.
  const fixture = {
    health: snapshot.health, counts: snapshot.counts,
    seats: Object.fromEntries(snapshot.seats.map(s => [s.tokenId, { ...s, last: s.last === null ? null : new Date(s.last).toISOString() }])),
    events: snapshot.events.map(e => ({ ...e, at: new Date(e.at).toISOString() })),
  };
  for (const ratio of [1, 1.25, 2, 3, 4]) {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: ratio, reducedMotion: 'reduce' });
    await c.route('https://api.imd.fun/swarm', route => route.fulfill({ json: fixture }));
    const p = await c.newPage(); await p.goto(url);
    await p.locator('#seat-number').fill('827'); await p.locator('#seat-form button').click();
    const dimensions = await p.locator('#seat-map').evaluate(el => ({ width: el.getBoundingClientRect().width, pixels: el.width }));
    const g = geo.geometry(dimensions.width), point = geo.center(827, g);
    assert.equal(dimensions.pixels, Math.round(dimensions.width * Math.min(ratio, 3)));
    await p.locator('#map-scroll').evaluate((el, y) => { el.scrollTop = Math.max(0, y - 100); }, point.y);
    const box = await p.locator('#seat-map').boundingBox();
    await p.mouse.click(box.x + point.x, box.y + point.y);
    assert.equal(await p.locator('#agent-title').innerText(), 'Agent #827');
    const other = geo.center(828, g);
    await p.mouse.click(box.x + other.x, box.y + other.y);
    assert.equal(await p.locator('#agent-title').innerText(), 'Agent #828');
    await c.close();
  }
  pass('Canvas pointer hit testing at DPR 1, 1.25, 2, 3 and 4', 'Adjacent seats 827/828; raster ratio capped at 3');

  const offline = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  // Reject at fetch rather than the transport layer to distinguish app errors from browser network diagnostics.
  await offline.addInitScript(() => { globalThis.fetch = async () => { throw new TypeError('Network request blocked for test'); }; });
  const empty = await offline.newPage(), emptyErrors = [];
  empty.on('pageerror', e => emptyErrors.push(e.message)); empty.on('console', m => { if (m.type() === 'error') emptyErrors.push(m.text()); });
  await empty.goto(url);
  await empty.locator('#fetch-note').waitFor({ state: 'visible' });
  assert.equal(await empty.locator('#agents-online').innerText(), '–');
  assert.equal(await empty.locator('#fetch-note').innerText(), "We couldn't reach the swarm. Showing the last map we had.");
  assert(await empty.locator('#seat-map').evaluate(el => el.height > 0));
  await empty.locator('#seat-number').fill('827'); await empty.locator('#seat-form button').click();
  assert.equal(await empty.locator('#agent-accepted').innerText(), '–');
  assert.equal(await empty.locator('body').innerText().then(s => s.includes('NaN')), false);
  assert.deepEqual(emptyErrors, []);
  await empty.screenshot({ path: `${scratch}/390-empty.png` }); report.screenshots.push('390-empty.png');
  await offline.close();
  pass('Blocked API with no data', 'Lattice, exact failure note, selectable seats and dashes; no application or console errors');

  const stale = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  let mode = 'good';
  await stale.route('https://api.imd.fun/swarm', route => mode === 'blocked' ? route.abort('blockedbyclient') : route.fulfill({ json: mode === 'good' ? fixture : { health: { agentsOnline: 123456 } } }));
  const p = await stale.newPage();
  await p.clock.install(); await p.goto(url);
  await p.waitForFunction(() => document.querySelector('#sync-label').textContent.startsWith('Updated'));
  await p.locator('#seat-number').fill('827'); await p.locator('#seat-form button').click();
  const accepted = await p.locator('#agent-accepted').innerText();
  mode = 'bad'; await p.clock.runFor(30001);
  await p.locator('#fetch-note').waitFor({ state: 'visible' });
  assert.equal(await p.locator('#agent-accepted').innerText(), accepted);
  assert.equal(await p.locator('#agents-online').innerText(), number(snapshot.health.agentsOnline));
  await p.screenshot({ path: `${scratch}/390-stale.png` }); report.screenshots.push('390-stale.png');
  mode = 'blocked'; await p.clock.runFor(30001);
  assert.equal(await p.locator('#agent-accepted').innerText(), accepted);
  assert.equal(await p.locator('#fetch-note').isVisible(), true);
  mode = 'good'; await p.clock.runFor(30001);
  await p.locator('#fetch-note').waitFor({ state: 'hidden' });
  await stale.close();
  pass('Missing seats and a blocked API retain last good data, then recover on the next refresh');

  const motionContext = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await motionContext.addInitScript(() => {
    globalThis.__intervals = new Map();
    const original = globalThis.setInterval, clear = globalThis.clearInterval;
    globalThis.setInterval = (callback, delay, ...args) => { const id = original(callback, delay, ...args); globalThis.__intervals.set(id, delay); return id; };
    globalThis.clearInterval = id => { globalThis.__intervals.delete(id); clear(id); };
  });
  await motionContext.route('https://api.imd.fun/swarm', route => route.fulfill({ json: { ...fixture, health: { ...fixture.health, workingNow: 1 }, seats: { ...fixture.seats, 0: { ...fixture.seats[0], working: true } } } }));
  const motionPage = await motionContext.newPage(); await motionPage.goto(url);
  await motionPage.waitForFunction(() => document.querySelector('#sync-label').textContent.startsWith('Updated'));
  assert.equal(await motionPage.evaluate(() => globalThis.__intervals.size), 0);
  await motionPage.emulateMedia({ reducedMotion: 'no-preference' });
  await motionPage.waitForFunction(() => [...globalThis.__intervals.values()].includes(120));
  await motionPage.emulateMedia({ reducedMotion: 'reduce' });
  await motionPage.waitForFunction(() => globalThis.__intervals.size === 0);
  assert.equal(await motionPage.evaluate(() => globalThis.__intervals.size), 0);
  assert.equal(await motionPage.evaluate(() => document.getAnimations().filter(a => a.playState === 'running').length), 0);
  await motionContext.close();
  pass('Reduced motion removes all pulsing', 'No 120 ms timer under reduce; toggling preference starts and clears the timer');

  const blocked = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await blocked.route('https://api.imd.fun/swarm', route => route.abort('blockedbyclient'));
  const blockedPage = await blocked.newPage(), blockedErrors = [], blockedConsole = [];
  blockedPage.on('pageerror', error => blockedErrors.push(error.message));
  blockedPage.on('console', message => { if (message.type() === 'error') blockedConsole.push(message.text()); });
  await blockedPage.goto(url); await blockedPage.locator('#fetch-note').waitFor({ state: 'visible' });
  assert.deepEqual(blockedErrors, []);
  assert(blockedConsole.every(message => message.includes('net::ERR_BLOCKED_BY_CLIENT')));
  assert.equal(await blockedPage.locator('#agents-online').innerText(), '–');
  await blocked.close();
  pass('Actual browser transport block', `No JavaScript exceptions; empty-state note shown. Browser network diagnostics: ${blockedConsole.length}`);
  if (blockedConsole.length) report.limitations.push('When the browser itself blocks the API transport it emits net::ERR_BLOCKED_BY_CLIENT. The application catches the failure and logs no errors; a page cannot suppress browser network diagnostics.');

  await context.close();
  try {
    const safari = await webkit.launch({ headless: true });
    try {
      const safariPage = await safari.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
      await safariPage.route('https://api.imd.fun/swarm', route => route.fulfill({ json: fixture }));
      await safariPage.goto(url); await safariPage.locator('#seat-number').fill('827'); await safariPage.locator('#seat-form button').click();
      assert.equal(await safariPage.locator('#agent-title').innerText(), 'Agent #827');
      assert.equal(await safariPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await safariPage.locator('#next-seat').click(); assert.equal(await safariPage.locator('#agent-title').innerText(), 'Agent #828');
      pass('WebKit primary flow at 390');
    } finally { await safari.close(); }
  } catch (error) {
    report.limitations.push(`WebKit could not run: ${error.message.split('\n').filter(Boolean).slice(0, 4).join(' ')}`);
    console.log('LIMITATION WebKit could not run in this environment; see report.');
  }
} catch (error) {
  report.checks.push({ name: 'Validation run', passed: false, detail: error.stack });
  console.error(error); process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise(r => server.close(r));
  report.finished = new Date().toISOString();
  await writeFile(`${scratch}/results.json`, JSON.stringify(report, null, 2));
  console.log(`Results: ${scratch}/results.json`);
}
