import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import net from 'node:net';
import { spawn } from 'node:child_process';

let server;
let base = process.env.TEST_BASE_URL;
if (!base) {
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  base = 'http://127.0.0.1:' + port;
  server = spawn(process.execPath, ['src/run.js'], { env: { ...process.env,
    BASE_URL: base, PORT: String(port), PYRET: base + '/js/cpo-main.jarr',
    REDISCLOUD_URL: '', SESSION_SECRET: 'examplar-browser-test', GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '', GOOGLE_API_KEY: '', GOOGLE_APP_ID: '',
    NODE_ENV: 'development', APP_NAME: 'Examplar', URL_FILE_MODE: 'all-remote',
    LOG_URL: '', SHARED_FETCH_SERVER: 'https://code.pyret.org'
  }, stdio: ['ignore', 'ignore', 'pipe'] });
  server.stderr.on('data', data => process.stderr.write(data));
  for (let i = 0; ; i++) {
    try { await fetch(base + '/apiKey'); break; }
    catch (error) {
      if (i === 100) { server.kill(); throw error; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || process.env.GOOGLE_CHROME_BINARY || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--no-sandbox', '--disable-background-timer-throttling']
}).catch(error => { server?.kill(); throw error; });
const browserErrors = [];
async function newPage() {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1100 });
  page.on('pageerror', error => { browserErrors.push(String(error)); console.error('Browser error:', error); });
  page.on('console', async msg => {
    if (process.env.DEBUG || msg.type() === 'error') console.error(msg.type(), msg.text(), ...(msg.type() === 'error' ? await Promise.all(msg.args().map(a => a.evaluate(v => v?.stack || String(v)).catch(() => '(closed)'))) : []));
  });
  // Tests never contact Google accounts or send Examplar research telemetry.
  await page.setRequestInterception(true);
  page.on('request', request => {
    if (/google-analytics|cloudfunctions\.net|apis\.google\.com|gstatic\.com/.test(request.url())) return request.abort();
    return request.continue();
  });
  return page;
}
async function ready(page, route = '/editor') {
  await page.goto(base + route);
  await page.waitForFunction(() => window.EDITOR_CONTENTS_SETTLED && window.CPO?.editor && !document.querySelector('#runButton').disabled,
    { timeout: 90000 });
}
async function run(page, source, predicate) {
  await page.evaluate(source => {
    CPO.editor.cm.setValue(source);
    CPO.replWidget.runCode(source, { check: true, cm: CPO.editor.cm });
  }, source);
  try { await page.waitForFunction(predicate, { timeout: 90000 }); }
  catch (error) {
    console.error('Output:', await page.$eval('#output', el => el.innerText));
    await page.screenshot({ path: process.env.SCREENSHOT || '/tmp/examplar-browser-failure.png' });
    throw error;
  }
}
try {
  const page = await newPage();
  await ready(page);
  await run(page, 'check: 1 + 1 is 2 end\n42', () => document.querySelector('#output').innerText.toLowerCase().includes('passed'));
  console.log('PASS: scratch editor and ordinary checks');
  await page.evaluate(() => { document.querySelector('#option-check-mode').checked = true; });
  await run(page, 'check: 1 is 2 end\n123', () => document.querySelector('#output').innerText.includes('123'));
  assert.equal(await page.$$eval('#output .check-block-test', nodes => nodes.length), 0, await page.$eval('#output', el => el.innerText));
  await page.evaluate(() => { document.querySelector('#option-check-mode').checked = false; });
  console.log('PASS: Skip Tests suppresses checks');
  const tree = `import url("${base}/libraries/spyret.arr") as S
import image as I
data Tree:
  | leaf(value)
  | branch(left, right)
sharing:
  method _spytial(self):
    [list: S.orientation("left + right", [list: S.direction-below])]
  end
end
S.diagram(branch(leaf(1), leaf(2)))
S.diagram([list: 1, 2, 3])
I.circle(10, "solid", "red")
check: 2 + 2 is 4 end`;
  for (let i = 0; i < 2; i++) {
    await run(page, tree, () => document.querySelectorAll('.spyret-diagram[data-rendered="true"][data-settled="true"]').length === 2 && /passed/i.test(document.querySelector('#output').innerText));
    const state = await page.evaluate(() => ({
      specs: [...document.querySelectorAll('.spyret-diagram')].map(v => v.dataset.specCount),
      positions: [...document.querySelectorAll('webcola-cnd-graph')].map(g => g.getNodePositions()),
      images: document.querySelectorAll('#output canvas').length,
      output: document.querySelector('#output').innerText
    }));
    assert.deepEqual(state.specs, ['1', '0']);
    assert(state.positions.every(positions => positions.length > 0 && positions.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))));
    assert(state.images > 0);
    assert.match(state.output, /passed/i);
  }
  console.log('PASS: URL wrapper, native module, typed tree hooks, images, checks, reruns');
  await page.screenshot({ path: '/tmp/examplar-spyret-tree.png' });
  await run(page, `import js-http("${base}/missing-native.js") as Missing\nMissing`,
    () => document.querySelector('#output').innerText.includes('HTTP 404'));
  console.log('PASS: failed native import reports HTTP status');
  await page.close();

  const assignmentPage = await newPage();
  await assignmentPage.evaluateOnNewDocument(() => {
    // Replace only Drive transport. Examplar's tabs, import injection,
    // compiler, checker, feedback, and hint generation all remain real.
    let storage;
    Object.defineProperty(window, 'storageAPI', { configurable: true, set() {}, get() {
      if (storage) return storage;
      const files = new Map();
      function file(name, contents, shared = false) {
        const f = {
          shared, _googObj: { properties: [{ key: 'edited', value: 'true' }] },
          getName: () => name, getUniqueId: () => name, getURI: () => 'my-gdrive://' + name,
          getContents: () => Q(contents), edited: () => Q(f), save: () => Q(f)
        };
        files.set(name, f);
        return f;
      }
      const code = file('demo-code.arr', 'provide *\nfun twice(n): n * 2 end');
      const tests = file('demo-tests.arr', 'include my-gdrive("demo-code.arr")\ncheck: twice(3) is 6 end');
      const wheat = file('wheat.arr', 'provide *\nfun twice(n): n * 2 end', true);
      const chaff = file('chaff.arr', 'provide *\nfun twice(n): n + 2 end', true);
      storage = Q({
        about: () => Q({ user: { emailAddress: 'fixture@example.invalid' } }),
        getTemplateFileById: () => {
          window.hints = { chaff: 'Check multiplication rather than addition.' };
          return Q({ assignment_id: 'fixture', assignment_name: 'Fixture', code, tests,
            wheat: [wheat], chaff: [chaff], mutant: [chaff], dummy_impl: code });
        },
        getSharedFileById: id => Q(files.get(id)),
        getFileById: id => Q(files.get(id)),
        getFileByName: name => Q([files.get(name.replace('my-gdrive://', ''))]),
        getCachedFileByName: () => Q([]), createFile: () => Q({ save: () => Q() })
      });
      return storage;
    } });
  });
  await ready(assignmentPage, '/assignment/fixture');
  await run(assignmentPage, 'include my-gdrive("demo-code.arr")\ncheck: twice(3) is 6 end',
    () => !!document.querySelector('.file-examplar-summary-validity.valid'));
  const feedback = await assignmentPage.$eval('#output', el => el.innerText);
  assert.match(feedback, /VALID/);
  assert.doesNotMatch(feedback, /THOROUGHNESS IS UNKNOWN|ERROR ENCOUNTERED/);
  console.log('PASS: assignment tabs, wheat/chaff injection, validity and thoroughness');
  await run(assignmentPage, 'include my-gdrive("demo-code.arr")\ncheck: twice(3) is 5 end',
    () => !!document.querySelector('#hint_button'));
  assert.match(await assignmentPage.$eval('#output', el => el.innerText), /INCORRECT/);
  await assignmentPage.click('#hint_button');
  await assignmentPage.waitForFunction(() => document.querySelector('#hint_box')?.innerText.includes('Check multiplication rather than addition.'),
    { timeout: 90000 });
  console.log('PASS: invalid tests and hint generation using mutant injection');
  assert.deepEqual(browserErrors, []);
  await assignmentPage.screenshot({ path: process.env.SCREENSHOT || '/tmp/examplar-browser.png' });
} finally {
  await browser.close();
  server?.kill();
}
