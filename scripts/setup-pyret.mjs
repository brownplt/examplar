import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const pin = JSON.parse(fs.readFileSync(path.join(root, 'upstream.json'), 'utf8'));
const vendor = path.join(root, 'vendor/pyret-upstream');
const source = process.argv[2] ? path.resolve(process.argv[2]) : vendor;
const git = (...args) => execFileSync('git', args, { cwd: source, encoding: 'utf8' }).trim();
fs.mkdirSync(path.dirname(vendor), { recursive: true });
if (!fs.existsSync(source)) {
  if (process.argv[2]) throw new Error('Upstream checkout does not exist: ' + source);
  execFileSync('git', ['clone', '--filter=blob:none', '--no-checkout', pin.repository, vendor], { stdio: 'inherit' });
  execFileSync('git', ['checkout', '--detach', pin.revision], { cwd: vendor, stdio: 'inherit' });
}
if (git('rev-parse', 'HEAD') !== pin.revision) {
  throw new Error('Expected Pyret revision ' + pin.revision + ' at ' + source + '. Existing checkouts are never reset.');
}
function link(target, name) {
  const dest = path.join(root, name);
  if (fs.existsSync(dest)) {
    if (fs.realpathSync(dest) !== fs.realpathSync(target)) throw new Error('Unexpected existing path: ' + dest);
    return;
  }
  fs.symlinkSync(path.relative(path.dirname(dest), target), dest, 'dir');
}
if (source !== vendor) link(source, 'vendor/pyret-upstream');
link(path.join(vendor, 'lang'), 'pyret');
link(path.join(vendor, 'codemirror-mode'), 'mode');
console.log('Pinned Pyret and CodeMirror mode ready. Run npm ci --ignore-scripts in pyret, then make phaseA there.');
