import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { acquireLibraryExclusiveGate } from './exclusive-gate.mjs';

const [coordRoot, libraryId, libraryRoot, label = 'session'] = process.argv.slice(2);
if (!coordRoot || !libraryId || !libraryRoot) {
  throw new Error('usage: gate-session.mjs <coordRoot> <libraryId> <libraryRoot> [label]');
}

let gate = null;
let mainDb = null;
let viewCount = 1;
let commandChain = Promise.resolve();

function emit(payload) {
  process.stdout.write(JSON.stringify({ label, at: Date.now(), ...payload }) + '\n');
}

async function openMain(reason) {
  if (mainDb) return;
  const mainPath = path.join(libraryRoot, 'main.sqlite');
  mainDb = new DatabaseSync(mainPath);
  mainDb.exec('PRAGMA busy_timeout=0; PRAGMA main.locking_mode=EXCLUSIVE;');
  mainDb.exec('CREATE TABLE IF NOT EXISTS proof(event TEXT NOT NULL, at INTEGER NOT NULL);');
  mainDb.prepare('INSERT INTO proof(event, at) VALUES(?, ?)').run(reason, Date.now());
}

function closeMain() {
  if (!mainDb) return;
  mainDb.close();
  mainDb = null;
}

async function releaseAndExit(event = 'RELEASED') {
  closeMain();
  gate?.release();
  gate = null;
  emit({ event, viewCount });
  process.exitCode = 0;
  setTimeout(() => process.exit(0), 5);
}

async function main() {
  const started = performance.now();
  gate = await acquireLibraryExclusiveGate({ coordRoot, libraryId });
  const acquireMs = performance.now() - started;

  if (!gate.acquired) {
    emit({ event: 'DENIED', acquireMs, reason: gate.reason, mainOpened: false, mainWritten: false });
    return;
  }

  await openMain('SESSION_OPEN');
  emit({ event: 'ACQUIRED', acquireMs, gatePath: gate.gatePath, viewCount, mainOpened: true });

  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', line => {
    commandChain = commandChain.then(async () => {
      if (!line.trim()) return;
      let cmd;
      try {
        cmd = JSON.parse(line);
        switch (cmd.cmd) {
          case 'PING':
            emit({ replyTo: cmd.id, ok: true, event: 'PONG', viewCount, mainOpen: Boolean(mainDb) });
            break;
          case 'TOUCH_MAIN':
            mainDb.prepare('INSERT INTO proof(event, at) VALUES(?, ?)').run(cmd.event || 'TOUCH', Date.now());
            emit({ replyTo: cmd.id, ok: true, event: 'MAIN_TOUCHED', viewCount });
            break;
          case 'ADD_VIEW':
            viewCount += 1;
            emit({ replyTo: cmd.id, ok: true, event: 'VIEW_ADDED', viewCount });
            break;
          case 'CLOSE_VIEW':
            viewCount -= 1;
            if (viewCount < 0) throw new Error('viewCount below zero');
            emit({ replyTo: cmd.id, ok: true, event: 'VIEW_CLOSED', viewCount });
            if (viewCount === 0) await releaseAndExit('LAST_VIEW_RELEASED');
            break;
          case 'MAINTENANCE': {
            closeMain();
            emit({ event: 'MAINTENANCE_MAIN_CLOSED', viewCount });
            await new Promise(resolve => setTimeout(resolve, Number(cmd.holdMs || 250)));
            await openMain('MAINTENANCE_REOPEN');
            emit({ replyTo: cmd.id, ok: true, event: 'MAINTENANCE_MAIN_REOPENED', viewCount });
            break;
          }
          case 'CPU_SAMPLE': {
            const durationMs = Number(cmd.durationMs || 750);
            const before = process.cpuUsage();
            await new Promise(resolve => setTimeout(resolve, durationMs));
            const delta = process.cpuUsage(before);
            emit({
              replyTo: cmd.id,
              ok: true,
              event: 'CPU_SAMPLE',
              durationMs,
              userMicros: delta.user,
              systemMicros: delta.system,
            });
            break;
          }
          case 'RELEASE':
            emit({ replyTo: cmd.id, ok: true, event: 'RELEASE_REQUESTED', viewCount });
            await releaseAndExit('RELEASED');
            break;
          default:
            throw new Error(`unknown command ${cmd.cmd}`);
        }
      } catch (error) {
        emit({ replyTo: cmd?.id, ok: false, error: { message: error?.message, code: error?.code } });
      }
    });
  });
}

main().catch(error => {
  emit({ event: 'FATAL', error: { message: error?.message, code: error?.code, stack: error?.stack } });
  try { closeMain(); } catch {}
  try { gate?.release(); } catch {}
  process.exit(2);
});
