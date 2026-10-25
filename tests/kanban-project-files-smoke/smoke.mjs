import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, realpath, stat, rename, rm, symlink } from 'node:fs/promises';
import { join, resolve, relative, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
const dir = new URL('.', import.meta.url);
const source = JSON.parse(await readFile(new URL('source.json', dir), 'utf8'));
const { createKanbanBodyFiles, FileSystemAdapter, TFile, TFolder, nativeActions, deleteBoard } = await import('data:text/javascript;base64,' + Buffer.from(source.module).toString('base64'));
const results = { status: 'RUNNING', platform: process.platform, arch: process.arch, node: process.version, cases: [], sources: source.sources, limits: source.limits };
const passed = value => results.cases.push(value);
const tempRoot = resolve('.build/tmp');
await mkdir(tempRoot, { recursive: true });
const temp = await mkdtemp(join(tempRoot, 'project-files-'));
try {
  await mkdir(join(temp, 'vault')); await mkdir(join(temp, 'outside'));
  const root = await realpath(join(temp, 'vault'));
  const entries = new Map();
  const vault = {
    adapter: new FileSystemAdapter(root),
    getAbstractFileByPath: key => entries.get(key),
    createFolder: async key => { await mkdir(join(root, key), { recursive: true }); entries.set(key, new TFolder(key)); },
    createBinary: async (key, bytes) => { await writeFile(join(root, key), Buffer.from(bytes)); const file = new TFile(key); entries.set(key, file); return file; },
    getResourcePath: file => 'app://vault/' + file.path,
  };
  const files = createKanbanBodyFiles({ vault });
  const path = '客户资料/2026/_1KU_KANBAN_HOST_20261022';
  await files.ensureProjectFolder(path);
  await writeFile(join(root, path, '保留 #1.md'), 'keep');
  await files.ensureProjectFolder(path);
  assert.equal(await readFile(join(root, path, '保留 #1.md'), 'utf8'), 'keep');
  passed('custom-multilevel-project-directory-and-original-retention');
  for (const filename of ['照片 #1.png', 'preview.jpg']) {
    const file = await files.saveCover({ bodyFolder: path }, randomUUID(), filename, new Uint8Array([1, 2, 3]));
    const url = await files.coverPreviewUrl(file.path, path, async input => {
      assert.equal(input.cacheRoot, join(root, path, 'attachment', 'thumbnail'));
      assert.equal(input.purpose, 'attachment-cover');
      assert.equal(input.size, 3);
      const output = join(input.cacheRoot, 'card-posters-v1', randomUUID() + '.webp');
      await mkdir(join(input.cacheRoot, 'card-posters-v1'), { recursive: true });
      await writeFile(output, 'fixture-thumbnail');
      return { status: 'ready', mode: 'derived-webp', path: output };
    }, new AbortController().signal);
    assert.ok(url.startsWith('app://vault/' + path + '/attachment/thumbnail/card-posters-v1/'));
  }
  passed('file-and-fetch-save-owner-thumbnail-root-and-resource-url');
  const actual = await files.projectTrashTarget(path, ['其他项目']);
  assert.equal(actual, await realpath(join(root, path)));
  for (const other of [path, '客户资料', path + '/nested']) await assert.rejects(files.projectTrashTarget(path, [other]), /共用或重叠/);
  await assert.rejects(files.projectTrashTarget('', []), /Vault根目录/);
  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  await symlink(join(temp, 'outside'), join(root, 'escape'), linkType);
  await assert.rejects(files.projectFolderPath('escape'), /OUTSIDE_VAULT/);
  await symlink(join(root, path), join(root, 'alias'), linkType);
  await assert.rejects(files.projectTrashTarget('alias', [path]), /共用或重叠/);
  await symlink(root, join(root, 'root-alias'), linkType);
  await assert.rejects(files.projectTrashTarget('root-alias', []), /Vault根目录/);
  passed('shared-overlapping-root-and-symlink-guards');
  const calls = [];
  let failTrash = false;
  const host = nativeActions(() => ({ remote: { shell: {
    openPath: async value => { calls.push(['open', value]); return ''; },
    showItemInFolder: () => { throw Error('unexpected file reveal path'); },
    trashItem: async value => { calls.push(['trash', value]); if (failTrash) throw Error('OS_TRASH_FAILED'); await rename(value, join(temp, randomUUID())); },
  } }, shell: { trashItem: () => { throw Error('renderer trash forbidden'); } } }));
  await host.openProductTarget(actual);
  assert.deepEqual(calls[0], ['open', resolve(actual)]);
  passed('same-sidebar-main-process-file-manager-entry');
  let mainCalls = 0, failMain = false;
  const product = {
    listIkuKanbanBoards: async () => [{ id: 'b', bodyFolder: path }],
    mutateIkuKanban: async () => { mainCalls++; if (failMain) throw Error('MAIN_REPLY_UNCONFIRMED'); return { id: 'b', boardId: 'b' }; },
  };
  await assert.rejects(deleteBoard({ type: 'board.delete', id: 'b' }, product, files, host), /再次确认/);
  assert.equal(mainCalls, 0);
  failTrash = true;
  const command = { type: 'board.delete', id: 'b', deleteFilesConfirmed: true };
  await assert.rejects(deleteBoard(command, product, files, host), /OS_TRASH_FAILED/);
  assert.equal(mainCalls, 0); assert.equal((await stat(actual)).isDirectory(), true);
  passed('confirmation-and-trash-failure-preserve-project-record');
  failTrash = false; failMain = true;
  await assert.rejects(deleteBoard(command, product, files, host), /MAIN_REPLY_UNCONFIRMED/);
  assert.equal(await files.projectFolderPath(path), null);
  const count = calls.filter(row => row[0] === 'trash').length;
  failMain = false;
  await deleteBoard(command, product, files, host);
  assert.equal(calls.filter(row => row[0] === 'trash').length, count);
  assert.equal(mainCalls, 2);
  passed('whole-directory-trash-before-main-and-idempotent-retry');
  results.status = 'PASS';
} catch (error) {
  results.status = 'FAIL'; results.error = String(error.stack ?? error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/gu, '[production-source]'); process.exitCode = 1;
} finally {
  assert.ok(!relative(tempRoot, temp).startsWith('..' + sep));
  await rm(temp, { recursive: true, force: true });
  await mkdir('.build/kanban-project-files-smoke', { recursive: true });
  await writeFile('.build/kanban-project-files-smoke/result.json', JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
}
