import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const artifactDir = path.resolve('artifacts');
await fsp.mkdir(artifactDir, { recursive: true });

const root = await fsp.mkdtemp(path.join(os.tmpdir(), '1ku-row120-provider-'));
const probePath = path.join(root, 'probe');
await fsp.writeFile(probePath, 'probe');

function run(cmd, args = []) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  return {
    status: r.status,
    stdout: String(r.stdout || '').trim(),
    stderr: String(r.stderr || '').trim(),
    error: r.error ? { code: r.error.code, message: r.error.message } : null,
  };
}

function decodeMountField(s) {
  return s.replace(/\\040/g, ' ').replace(/\\011/g, '\t').replace(/\\134/g, '\\');
}

function isWithin(p, mountPoint) {
  const rel = path.relative(mountPoint, p);
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}

function linuxMountInfo(target) {
  const text = fs.readFileSync('/proc/self/mountinfo', 'utf8');
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    const parts = line.split(' ');
    const sep = parts.indexOf('-');
    if (sep < 0) continue;
    const mountPoint = decodeMountField(parts[4]);
    const mountOptions = parts[5].split(',');
    const fsType = parts[sep + 1];
    if (isWithin(target, mountPoint)) rows.push({ mountPoint, mountOptions, fsType });
  }
  rows.sort((a, b) => b.mountPoint.length - a.mountPoint.length);
  return rows[0] ?? null;
}

function macMountInfo(target) {
  const r = run('/sbin/mount');
  if (r.status !== 0) return { error: r };
  const rows = [];
  for (const line of r.stdout.split('\n')) {
    const m = line.match(/^(.+?) on (.+?) \((.+)\)$/);
    if (!m) continue;
    const mountPoint = m[2];
    const flags = m[3].split(',').map(x => x.trim());
    const fsType = flags[0] ?? null;
    if (isWithin(target, mountPoint)) rows.push({ mountPoint, flags, fsType });
  }
  rows.sort((a, b) => b.mountPoint.length - a.mountPoint.length);
  return rows[0] ?? null;
}

function macNativeAdvlockProbe(target) {
  const src = path.join(root, 'getattrlist-probe.c');
  const bin = path.join(root, 'getattrlist-probe');
  const code = [
    '#include <sys/attr.h>',
    '#include <stdio.h>',
    '#include <stdint.h>',
    '#include <string.h>',
    '#include <errno.h>',
    'int main(int argc, char **argv) {',
    '  if (argc != 2) return 64;',
    '  struct attrlist al; memset(&al, 0, sizeof(al));',
    '  al.bitmapcount = ATTR_BIT_MAP_COUNT;',
    '  al.volattr = ATTR_VOL_CAPABILITIES;',
    '  struct { uint32_t len; vol_capabilities_attr_t caps; } buf; memset(&buf, 0, sizeof(buf));',
    '  if (getattrlist(argv[1], &al, &buf, sizeof(buf), 0) != 0) { perror("getattrlist"); return 2; }',
    '  uint32_t valid = buf.caps.valid[VOL_CAPABILITIES_INTERFACES];',
    '  uint32_t caps = buf.caps.capabilities[VOL_CAPABILITIES_INTERFACES];',
    '  int validAdv = (valid & VOL_CAP_INT_ADVLOCK) != 0;',
    '  int hasAdv = (caps & VOL_CAP_INT_ADVLOCK) != 0;',
    '  printf("{\\\"validAdvlock\\\":%s,\\\"supportsAdvlock\\\":%s}\\n", validAdv ? "true" : "false", hasAdv ? "true" : "false");',
    '  return 0;',
    '}',
  ].join('\n');
  fs.writeFileSync(src, code);
  const cc = run('/usr/bin/clang', [src, '-o', bin]);
  if (cc.status !== 0) return { compile: cc, result: null };
  const rr = run(bin, [target]);
  let parsed = null;
  try { parsed = JSON.parse(rr.stdout); } catch {}
  return { compile: cc, run: rr, result: parsed };
}

const statfs = await fsp.statfs(root);
const fsExportNames = Object.keys(fs).filter(x => /lock|fcntl|attrlist|statfs/i.test(x)).sort();

const evidence = {
  schema: 1,
  purpose: 'Qualify the production-callable fact sources for P022 ROW120_RUNTIME_FACT_PROVIDER without changing 1KU production code or re-running row120 semantic research',
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  probePath: root,
  nodePublicFs: {
    statfsKeys: Object.keys(statfs).sort(),
    statfsValues: Object.fromEntries(Object.entries(statfs).map(([k,v]) => [k, typeof v === 'bigint' ? v.toString() : v])),
    lockRelatedExports: fsExportNames,
    hasDirectReadOnlyField: Object.prototype.hasOwnProperty.call(statfs, 'readOnly') || Object.prototype.hasOwnProperty.call(statfs, 'flags'),
    hasDirectByteRangeLockCapabilityField: Object.keys(statfs).some(k => /lock|adv/i.test(k)) || fsExportNames.some(k => /fcntl|byte.*lock|adv.*lock/i.test(k)),
  },
  providerFacts: {},
  productionBindingAssessment: {},
};

if (process.platform === 'linux') {
  const mi = linuxMountInfo(root);
  evidence.providerFacts.linux = {
    source: '/proc/self/mountinfo',
    mount: mi,
    fsType: mi?.fsType ?? null,
    readOnly: mi ? mi.mountOptions.includes('ro') : null,
    canClassifyZoteroNetworkBackupFamily:
      !!mi && ['cifs', 'smb', 'smb2', 'nfs', 'nfs4'].includes(mi.fsType),
  };
  evidence.productionBindingAssessment = {
    fsType: mi ? 'DIRECT_OS_FACT_AVAILABLE' : 'UNAVAILABLE',
    readOnly: mi ? 'DIRECT_OS_FACT_AVAILABLE' : 'UNAVAILABLE',
    byteRangeLocks: 'NOT_REQUIRED_BY_FROZEN_LINUX_BACKUP_BRANCH',
    providerCandidate: mi ? 'node:fs read /proc/self/mountinfo in existing C02 backup seam' : null,
    newDependencyRequired: false,
    nativeAddonRequired: false,
  };
}

if (process.platform === 'darwin') {
  const statType = run('/usr/bin/stat', ['-f', '%T', root]);
  const mount = macMountInfo(root);
  const nativeAdv = macNativeAdvlockProbe(root);
  evidence.providerFacts.macos = {
    statCommand: statType,
    mount,
    fsTypeFromSystemStat: statType.status === 0 ? statType.stdout : null,
    readOnlyFromMountFlags: mount && !mount.error ? mount.flags.includes('read-only') : null,
    nativeGetattrlistAdvlock: nativeAdv,
  };
  const nodeDirectAdvlock =
    evidence.nodePublicFs.hasDirectByteRangeLockCapabilityField;
  evidence.productionBindingAssessment = {
    fsType: statType.status === 0 ? 'SYSTEM_COMMAND_FACT_AVAILABLE' : 'UNAVAILABLE',
    readOnly: mount && !mount.error ? 'SYSTEM_COMMAND_FACT_AVAILABLE' : 'UNAVAILABLE',
    byteRangeLocks: nodeDirectAdvlock
      ? 'DIRECT_NODE_PUBLIC_CAPABILITY_AVAILABLE'
      : (nativeAdv.result?.validAdvlock ? 'OS_NATIVE_FACT_EXISTS_BUT_NODE_PUBLIC_BINDING_ABSENT' : 'UNAVAILABLE'),
    providerCandidate: nodeDirectAdvlock
      ? 'node public API'
      : null,
    newDependencyRequired: false,
    nativeAddonOrHelperWouldBeRequiredForExactAdvlockFact:
      !nodeDirectAdvlock && !!nativeAdv.result?.validAdvlock,
  };
}

const allRequiredBound =
  process.platform === 'linux'
    ? evidence.productionBindingAssessment.fsType === 'DIRECT_OS_FACT_AVAILABLE'
    : process.platform === 'darwin'
      ? evidence.productionBindingAssessment.fsType !== 'UNAVAILABLE'
        && evidence.productionBindingAssessment.readOnly !== 'UNAVAILABLE'
        && evidence.productionBindingAssessment.byteRangeLocks === 'DIRECT_NODE_PUBLIC_CAPABILITY_AVAILABLE'
      : false;

evidence.result = allRequiredBound ? 'PROVIDER_BINDING_CLOSED' : 'PROVIDER_GAP_CONFIRMED';
evidence.finishedAt = new Date().toISOString();

const artifact = path.join(artifactDir, `row120-runtime-fact-provider-${process.platform}-${process.arch}.json`);
await fsp.writeFile(artifact, JSON.stringify(evidence, null, 2));
await fsp.rm(root, { recursive: true, force: true });

console.log(JSON.stringify({
  result: evidence.result,
  platform: evidence.platform,
  assessment: evidence.productionBindingAssessment,
  artifact,
}, null, 2));
