import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = JSON.parse(await readFile(path.join(here, 'source.json'), 'utf8'));
const directory = path.resolve('.build/kanban-cover-smoke');
await mkdir(directory, { recursive: true });
const evaluate = (code, globals) => runInNewContext(
  stripTypeScriptTypes(code.replace(/^export /gm, ''), { mode: 'strip' }), globals,
);
const isImage = evaluate(`${source.image}\nisIkuKanbanImageAttachment;`, {});
const parseKey = evaluate(`${source.hierarchy}\nparseRelativeLocatorKey;`, {});
for (const [filename, mime, localPath, expected] of [
  ['横图.JPG', null, null, true], ['portrait.HEIC', null, null, true],
  ['photo.bin', 'image/png', null, true], ['report.txt', 'text/plain', null, false],
  ['photo.png', 'image/png', '/linked/original.png', false],
]) assert.equal(isImage({ filename, mime, localPath }), expected);

class TFile { constructor(filePath) { this.path = filePath; } }
const entries = new Map();
let writes = 0;
const vault = {
  async createBinary(key, bytes) {
    writes++;
    await writeFile(path.join(directory, key), new Uint8Array(bytes));
    const file = new TFile(key);
    entries.set(key, file);
    return file;
  },
  getAbstractFileByPath: key => entries.get(key),
  getResourcePath: file => pathToFileURL(path.join(directory, file.path)).href,
};
const files = evaluate(`${source.control}\n({${source.methods}});`, {
  parseRelativeLocatorKey: parseKey, TFile, vault,
  ensureFolder: folder => mkdir(path.join(directory, folder), { recursive: true }),
});
try {
  const record = { bodyFolder: '项目/带 空格', id: 'card', title: 'Card' };
  const id = randomUUID(), bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const file = await files.saveCover(record, id, '横图 #01.png', bytes);
  assert.equal(file.path, `项目/带 空格/attachment/${id}/横图 #01.png`);
  assert.deepEqual(await readFile(fileURLToPath(files.coverUrl(file.path))), Buffer.from(bytes));
  assert.equal(files.coverUrl(null), null);
  assert.equal(files.coverUrl('missing.png'), null);
  await assert.rejects(files.saveCover(record, id, '../outside.png', bytes));
  await assert.rejects(files.saveCover({ ...record, bodyFolder: '../outside' }, id, 'a.png', bytes));
  assert.equal(writes, 1);
  const evidence = {
    status: 'PASS', platform: process.platform, arch: process.arch, node: process.version,
    sourceCommit: source.sourceCommit, sourceHashes: source.hashes,
    scope: ['actual image-recognition source', 'actual Host saveCover/coverUrl source with a filesystem-backed Vault port', 'Unicode/space/hash filename', 'invalid paths rejected'],
    notRun: ['Obsidian native file picker', 'Obsidian app resource protocol', 'image decoding or visual acceptance', 'plugin build/deployment'],
  };
  await writeFile(path.join(directory, 'result.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
} finally {
  await rm(path.join(directory, '项目'), { recursive: true, force: true });
}

