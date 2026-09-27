const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { wrapper } = require('../../src/spyret-library');

function load(fetch) {
  let api;
  vm.runInNewContext(fs.readFileSync('src/web/js/http-imports.js', 'utf8'), {
    URL, fetch, define: (_name, _deps, factory) => { api = factory(); }
  });
  return api;
}
const runtime = {
  getField: (obj, key) => obj[key],
  safeCall: (action, resume) => Promise.resolve().then(action).then(resume),
  pauseStack: action => new Promise((resolve, reject) => action({ resume: resolve, error: reject })),
  ffi: { makeMessageException: message => new Error(message) }
};
const nativeModules = { values: { 'builtin-raw-locator-from-str': { app: contents => ({ contents }) } } };
const cpo = { values: { 'make-js-locator-from-raw': { app: (...args) => args } } };

test('accepts one absolute HTTP(S) module URL', () => {
  const api = load();
  assert.equal(api.moduleURL(['https://example.com/a/../module.js']), 'https://example.com/module.js');
  for (const args of [[], ['a', 'b'], ['relative.js'], ['data:text/javascript,1'], ['file:///module.js']]) {
    assert.throws(() => api.moduleURL(args));
  }
});

test('fetches without credentials and hands native source to the existing CPO locator', async () => {
  const url = 'https://example.com/module.js';
  const api = load(async (actual, options) => {
    assert.equal(actual, url);
    assert.equal(options.credentials, 'omit');
    return { ok: true, text: async () => '({ requires: [] })' };
  });
  const [raw, native, uri, name] = await api.makeJSHTTPLocator(url, runtime, nativeModules, cpo);
  assert.equal(raw.contents, '({ requires: [] })');
  assert.equal(native, true);
  assert.equal(uri, 'js-http://' + url);
  assert.equal(name, url);
});

test('HTTP and network errors settle the paused import with the URL', async () => {
  for (const fetch of [async () => ({ ok: false, status: 404, statusText: 'Not Found' }),
    async () => { throw new Error('Failed to fetch'); }]) {
    const api = load(fetch);
    await assert.rejects(api.makeJSHTTPLocator('https://example.com/missing.js', runtime, nativeModules, cpo),
      /Could not load JavaScript module https:\/\/example.com\/missing.js:/);
  }
});

test('Spyret wrapper includes typed rules and the matching native dependency without Drive', () => {
  const source = wrapper('https://examplar.example/');
  assert.match(source, /import js-http\("https:\/\/examplar.example\/libraries\/spyret.js"\)/);
  assert.match(source, /fun orientation\(/);
  assert.match(source, /diagram = NativeSpyret.diagram/);
  assert.doesNotMatch(source, /gdrive/);
});
