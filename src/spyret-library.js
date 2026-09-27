const fs = require('node:fs');

// Keep the rules and native code on the same pinned npm release. The wrapper
// uses a normal URL import; only its native dependency needs the new locator.
function wrapper(baseUrl) {
  const nativeUrl = new URL('libraries/spyret.js', baseUrl.replace(/\/?$/, '/')).href;
  const rules = fs.readFileSync(require.resolve('spyret/spytial.arr'), 'utf8');
  return rules.replace('provide-types *\n', 'provide-types *\nimport js-http(' +
    JSON.stringify(nativeUrl) + ') as NativeSpyret\n') +
    '\ndiagram = NativeSpyret.diagram\ndiagram-with-rules = NativeSpyret.diagram-with-rules\ngenlayout = NativeSpyret.genlayout\n';
}

function register(app, baseUrl) {
  app.get('/libraries/spyret.arr', function(req, res) {
    res.type('text/plain').send(wrapper(baseUrl));
  });
  app.get('/libraries/spyret.js', function(req, res) {
    res.type('application/javascript').sendFile(require.resolve('spyret/pyret-module'));
  });
}

module.exports = { wrapper, register };
