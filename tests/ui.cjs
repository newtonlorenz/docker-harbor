const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

// Fictional examples only. Never use real inventory to generate public screenshots.
const specifications = [
  ['budget', 'Budget', 'chart', 'mint', 'Household planning'],
  ['downloads', 'Downloads', 'download', 'amber', 'Your download queue'],
  ['home-lights', 'Home lights', 'light', 'gold', 'Rooms and scenes'],
  ['media-library', 'Media library', 'archive', 'indigo', 'Movies and music'],
  ['messages', 'Messages', 'message', 'pink', 'Keep in touch'],
  ['monitor', 'Monitor', 'pulse', 'teal', 'Your home network'],
  ['notes', 'Notes', 'research', 'violet', 'Ideas in one place'],
  ['photo-library', 'Photos', 'camera', 'rose', 'Your photo library'],
  ['secure-portal', 'Secure portal', 'shield', 'slate', 'Opens in your browser'],
  ['travel-planner', 'Travel planner', 'plane', 'blue', 'Plan your next adventure'],
  ['weather', 'Weather', 'globe', 'olive', 'The week ahead'],
  ['workspace', 'Workspace', 'layers', 'violet', 'Projects and plans'],
];
const projects = specifications.map(([id, name, icon, palette, description], index) => {
  const cid = String(index + 1).padStart(64, '0');
  const endpoint = { id: `app-${index}`, project: id, name: 'web', kind: 'website', status: 200, url: `https://app-${index}.example.test/`, port: 80, available: true };
  return { id, name, running: 1, unhealthy: 0, presentation: { name, icon, palette, description, ...(id === 'secure-portal' ? { externalUrl: 'https://portal.example.com/' } : {}) },
    containers: [{ id: cid, name: `${id}-web`, service: 'web', image: 'example/app:1', state: 'running', status: 'Up (healthy)', health: 'healthy', networks: ['example-network'], ports: [{ PrivatePort: 80, Type: 'tcp' }], workingDir: '/srv/example' }], endpoints: [endpoint] };
});
projects.push({ id: 'background-worker', name: 'Background worker', running: 0, unhealthy: 0, presentation: {}, containers: [{ id: 'f'.repeat(64), name: 'worker', service: 'worker', image: 'example/worker:1', state: 'exited', status: 'Exited', networks: [], ports: [] }], endpoints: [] });
const inventory = { projects, containers: projects.flatMap(p => p.containers), endpoints: projects.flatMap(p => p.endpoints), updated: 1791115200, error: null, host: { name: 'Docker host', cpus: 4, version: 'demo' } };
const publicDir = path.join(__dirname, '..', 'public');
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/inventory') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ...inventory, updated: Date.now() / 1000 }));
    return;
  }
  const file = path.resolve(publicDir, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
  if (!file.startsWith(publicDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src https://*.example.test; frame-ancestors 'none'; base-uri 'none'; object-src 'none'");
  res.end(fs.readFileSync(file));
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true, args: ['--disable-gpu'] });
    for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
      const context = await browser.newContext({ viewport: { width, height } });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.route('https://*.example.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Demo app</title><h1>Demo app loaded</h1><input aria-label="Draft">' }));
      await page.goto(base, { waitUntil: 'networkidle' });
      await page.waitForSelector('.app-tile');
      assert.equal(await page.locator('.project').count(), 13);
      assert.equal(await page.locator('.app-tile').count(), 12);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert(await page.getByRole('button', { name: 'Install Harbor', exact: true }).isVisible());
      assert.equal(await page.locator('.app-symbol').evaluateAll(es => new Set(es.map(e => getComputedStyle(e).backgroundImage)).size), 11);
      if (process.argv.includes('--screenshots')) {
        await page.locator('#date').evaluate(e => e.textContent = 'Demo workspace');
        await page.locator('#updated').evaluate(e => e.textContent = 'Fictional demo data');
        await page.screenshot({ path: path.join(__dirname, '..', 'docs', `${name}.png`), fullPage: true });
      }
      await page.getByRole('button', { name: 'Details for Photos', exact: true }).click();
      assert(await page.getByRole('dialog', { name: 'Photos', exact: true }).isVisible());
      await page.getByRole('button', { name: 'Add to Favorites', exact: true }).click();
      await page.getByRole('button', { name: 'Close project details' }).click();
      await page.locator('[data-filter="favorites"]').click();
      assert.equal(await page.locator('.project').count(), 1);
      await page.reload({ waitUntil: 'networkidle' });
      await page.locator('[data-filter="favorites"]').click();
      assert.equal(await page.locator('.project').count(), 1);
      await page.locator('[data-filter="all"]').click();
      await page.getByLabel('Search projects').fill('no-such-app');
      assert(await page.getByText('No matching projects.').isVisible());
      await page.getByLabel('Search projects').fill('');
      await page.locator('[data-filter="attention"]').click();
      assert.equal(await page.locator('.project').count(), 1);
      await page.locator('[data-filter="all"]').click();
      assert.equal(await page.getByRole('link', { name: 'Open Secure portal in browser' }).getAttribute('href'), 'https://portal.example.com/');
      await page.getByRole('button', { name: 'Details for Secure portal' }).click();
      assert.equal(await page.locator('#details [data-open]').count(), 0);
      await page.getByRole('button', { name: 'Close project details' }).click();
      await page.getByRole('button', { name: 'Open Photos', exact: true }).click();
      const photos = page.frameLocator('#frames iframe:not([hidden])');
      await photos.getByRole('heading', { name: 'Demo app loaded' }).waitFor();
      await photos.getByLabel('Draft').fill('Keep my session');
      const box = await page.locator('#frames iframe:not([hidden])').boundingBox();
      assert.equal(box.y, 48); assert.equal(box.height, height - 48);
      const photoId = await page.getByLabel('Switch app', { exact: true }).inputValue();
      await page.getByLabel('App actions', { exact: true }).click();
      await page.getByRole('button', { name: 'Focus app', exact: true }).click();
      assert.equal((await page.locator('#frames iframe:not([hidden])').boundingBox()).height, height);
      await page.getByRole('button', { name: 'Show Harbor controls' }).click();
      await page.getByRole('button', { name: 'Back to projects' }).click();
      await page.getByRole('button', { name: 'Open Budget', exact: true }).click();
      await page.getByLabel('Switch app', { exact: true }).selectOption(photoId);
      assert.equal(await photos.getByLabel('Draft').inputValue(), 'Keep my session');
      await page.getByLabel('App actions', { exact: true }).click();
      await page.getByRole('button', { name: 'Close app', exact: true }).click();
      assert.equal(await page.locator('#frames iframe').count(), 1);
      await page.getByRole('button', { name: 'Back to projects' }).click();
      await page.emulateMedia({ reducedMotion: 'reduce' });
      assert.equal(await page.locator('#overview').evaluate(e => getComputedStyle(e).animationName), 'none');
      await page.evaluate(() => navigator.serviceWorker.ready);
      await context.setOffline(true);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.querySelector('#connection').textContent === 'Offline');
      assert.equal(await page.locator('.project').count(), 13);
      assert.deepEqual(errors, []);
      console.log(`${name}: launcher, favorites, search, external auth, sessions, focus, reduced motion and offline passed`);
      await context.close();
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
