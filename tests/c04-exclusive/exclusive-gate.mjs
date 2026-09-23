import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function libraryGatePath(coordRoot, libraryId) {
  const key = crypto.createHash('sha256').update(String(libraryId), 'utf8').digest('hex');
  return path.join(coordRoot, `${key}.sqlite`);
}

function isBusy(error) {
  return error?.code === 'ERR_SQLITE_ERROR' &&
    /database is locked|database is busy|SQLITE_BUSY|SQLITE_LOCKED/i.test(String(error?.message || ''));
}

export async function acquireLibraryExclusiveGate({ coordRoot, libraryId }) {
  await fs.mkdir(coordRoot, { recursive: true });
  const gatePath = libraryGatePath(coordRoot, libraryId);
  const db = new DatabaseSync(gatePath);

  try {
    db.exec('PRAGMA busy_timeout=0;');
    db.exec('BEGIN EXCLUSIVE;');
    db.prepare('PRAGMA schema_version').get();

    let released = false;
    return {
      acquired: true,
      gatePath,
      release() {
        if (released) return;
        released = true;
        try { db.exec('ROLLBACK;'); } finally { db.close(); }
      },
    };
  } catch (error) {
    try { db.close(); } catch {}
    if (isBusy(error)) {
      return { acquired: false, gatePath, reason: 'IN_USE' };
    }
    throw error;
  }
}
