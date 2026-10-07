/**
 * OWNER CONTRACT — Build representation of the existing two trusted Worker artifacts.
 * Owns: gzip data, raw-source identities, and their single embedded read functions.
 * Does not own: Worker creation, cancellation, reuse, Search, DB, or Runtime execution.
 * Consumers use the original transport Owners; no plaintext cache or alternate loader.
 */
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

const kinds = ['DATABASE', 'KNOWLEDGE_SEARCH_NAVIGATION'];
const start = '/*IKU_DATABASE_WORKER_ARTIFACT_START*/';
const end = '/*IKU_DATABASE_WORKER_ARTIFACT_END*/';
const hash = (source) => createHash('sha256').update(source).digest('hex');

export function createWorkerPayloadBanner(database, navigation) {
  return (
    start +
    [database, navigation]
      .map((source, index) => {
        const kind = kinds[index];
        if (!source.trim()) throw new Error('WORKER_PAYLOAD_SOURCE_EMPTY');
        const packed = gzipSync(Buffer.from(source, 'utf8')).toString('base64');
        return (
          `const IKU_${kind}_WORKER_SOURCE_SHA256=${JSON.stringify(hash(source))};` +
          `function IKU_READ_${kind}_WORKER_SOURCE(){return new Promise((resolve,reject)=>require('node:zlib').gunzip(Buffer.from(${JSON.stringify(packed)},'base64'),(error,bytes)=>error?reject(error):resolve(bytes.toString('utf8'))));}`
        );
      })
      .join('') +
    end
  );
}

// Build validation parses data only; it never evaluates the released Main script.
export function readWorkerPayloadArtifact(bundle) {
  const first = bundle.indexOf(start),
    last = bundle.indexOf(end, first);
  if (
    first < 0 ||
    last < 0 ||
    bundle.indexOf(start, first + start.length) >= 0 ||
    bundle.indexOf(end, last + end.length) >= 0
  )
    throw new Error('WORKER_PAYLOAD_BOUNDARY_INVALID');
  const artifact = bundle.slice(first + start.length, last);
  const result = {};
  for (const kind of kinds) {
    const match = artifact.match(
      new RegExp(
        `const IKU_${kind}_WORKER_SOURCE_SHA256=("[a-f0-9]{64}");function IKU_READ_${kind}_WORKER_SOURCE[^]*?Buffer.from\\(("[A-Za-z0-9+/=]+"),'base64'\\)`,
        'u',
      ),
    );
    if (!match) throw new Error('WORKER_PAYLOAD_DATA_INVALID');
    const packed = JSON.parse(match[2]);
    const source = gunzipSync(Buffer.from(packed, 'base64')).toString('utf8');
    if (hash(source) !== JSON.parse(match[1])) throw new Error('WORKER_PAYLOAD_IDENTITY_INVALID');
    if (bundle.split(match[2]).length !== 2 || bundle.includes(`const IKU_${kind}_WORKER_SOURCE=`))
      throw new Error('WORKER_PAYLOAD_DUPLICATE');
    result[kind] = source;
  }
  if (
    createWorkerPayloadBanner(result.DATABASE, result.KNOWLEDGE_SEARCH_NAVIGATION) !==
    start + artifact + end
  )
    throw new Error('WORKER_PAYLOAD_READER_INVALID');
  return result;
}
