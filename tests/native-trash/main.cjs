'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
require('@electron/remote/main').initialize();
async function probe(remoteModulePath) {
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const os = require('node:os');
  const assert = require('node:assert/strict');
  const { randomUUID } = require('node:crypto');
  const shell = require(remoteModulePath).shell;
  const prefix = '1ku-trash-' + randomUUID();
  const root = path.join(os.homedir(), prefix);
  await fs.mkdir(root);
  const trashRoot = process.platform === 'darwin'
    ? path.join(os.homedir(), '.Trash')
    : path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share'), 'Trash/files');
  const rows = [];
  for (const [kind, label] of [['FILE', 'ascii'], ['FILE', '中文 space'], ['DIRECTORY', 'ascii'], ['DIRECTORY', '中文 space']]) {
    const name = prefix + '-' + kind + '-' + label;
    const target = path.resolve(root, name);
    const content = Buffer.from('native-trash-proof:' + name);
    if (kind === 'DIRECTORY') {
      await fs.mkdir(target);
      await fs.writeFile(path.join(target, 'payload.md'), content);
    } else await fs.writeFile(target, content);
    await shell.trashItem(target);
    await assert.rejects(fs.stat(target), { code: 'ENOENT' });
    const entries = await fs.readdir(trashRoot);
    const matches = entries.filter(entry => entry.startsWith(name));
    assert.equal(matches.length, 1, 'target must be present in system Trash');
    const recycled = path.join(trashRoot, matches[0]);
    const payload = kind === 'DIRECTORY' ? path.join(recycled, 'payload.md') : recycled;
    assert.deepEqual(await fs.readFile(payload), content, 'recycled content must survive intact');
    rows.push({ kind, label, sourceAbsent: true, systemTrashPresent: true, contentIntact: true });
  }
  let rejection;
  try { await shell.trashItem(path.join(root, 'does-not-exist')); }
  catch (error) { rejection = String(error.message || error); }
  assert.ok(rejection, 'missing path must reject');
  await shell.trashItem(root);
  await assert.rejects(fs.stat(root), { code: 'ENOENT' });
  return { status: 'PASS', platform: process.platform, arch: process.arch,
    versions: process.versions, call: 'renderer remote.shell.trashItem -> Electron main shell',
    rows, missingTargetRejected: rejection,
    scope: 'Isolated Electron/native OS qualification; not Obsidian plugin Host acceptance',
    revealForeground: 'NOT_TESTED', permanentDeleteFallback: false };
}
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false } });
  require('@electron/remote/main').enable(window.webContents);
  const output = path.resolve(process.cwd(), 'artifacts', 'native-trash-' + process.platform + '.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  try {
    await window.loadURL('about:blank');
    const report = await window.webContents.executeJavaScript('(' + probe.toString() + ')(' + JSON.stringify(require.resolve('@electron/remote')) + ')');
    fs.writeFileSync(output, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
    app.exit(0);
  } catch (error) {
    const report = { status: 'FAIL', platform: process.platform, versions: process.versions,
      message: String(error.stack || error),
      scope: 'Isolated Electron/native OS qualification; not Obsidian Host' };
    fs.writeFileSync(output, JSON.stringify(report, null, 2));
    console.error(JSON.stringify(report));
    app.exit(1);
  }
}).catch(error => { console.error(error); app.exit(1); });
