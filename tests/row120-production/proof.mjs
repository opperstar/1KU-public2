var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/.pnpm/comlink@4.4.2/node_modules/comlink/dist/umd/comlink.js
var require_comlink = __commonJS({
  "node_modules/.pnpm/comlink@4.4.2/node_modules/comlink/dist/umd/comlink.js"(exports, module) {
    "use strict";
    (function(global, factory) {
      typeof exports === "object" && typeof module !== "undefined" ? factory(exports) : typeof define === "function" && define.amd ? define(["exports"], factory) : (global = typeof globalThis !== "undefined" ? globalThis : global || self, factory(global.Comlink = {}));
    })(exports, (function(exports2) {
      "use strict";
      const proxyMarker = /* @__PURE__ */ Symbol("Comlink.proxy");
      const createEndpoint = /* @__PURE__ */ Symbol("Comlink.endpoint");
      const releaseProxy2 = /* @__PURE__ */ Symbol("Comlink.releaseProxy");
      const finalizer = /* @__PURE__ */ Symbol("Comlink.finalizer");
      const throwMarker = /* @__PURE__ */ Symbol("Comlink.thrown");
      const isObject = (val) => typeof val === "object" && val !== null || typeof val === "function";
      const proxyTransferHandler = {
        canHandle: (val) => isObject(val) && val[proxyMarker],
        serialize(obj) {
          const { port1, port2 } = new MessageChannel();
          expose2(obj, port1);
          return [port2, [port2]];
        },
        deserialize(port) {
          port.start();
          return wrap2(port);
        }
      };
      const throwTransferHandler = {
        canHandle: (value) => isObject(value) && throwMarker in value,
        serialize({ value }) {
          let serialized;
          if (value instanceof Error) {
            serialized = {
              isError: true,
              value: {
                message: value.message,
                name: value.name,
                stack: value.stack
              }
            };
          } else {
            serialized = { isError: false, value };
          }
          return [serialized, []];
        },
        deserialize(serialized) {
          if (serialized.isError) {
            throw Object.assign(new Error(serialized.value.message), serialized.value);
          }
          throw serialized.value;
        }
      };
      const transferHandlers = /* @__PURE__ */ new Map([
        ["proxy", proxyTransferHandler],
        ["throw", throwTransferHandler]
      ]);
      function isAllowedOrigin(allowedOrigins, origin) {
        for (const allowedOrigin of allowedOrigins) {
          if (origin === allowedOrigin || allowedOrigin === "*") {
            return true;
          }
          if (allowedOrigin instanceof RegExp && allowedOrigin.test(origin)) {
            return true;
          }
        }
        return false;
      }
      function expose2(obj, ep = globalThis, allowedOrigins = ["*"]) {
        ep.addEventListener("message", function callback(ev) {
          if (!ev || !ev.data) {
            return;
          }
          if (!isAllowedOrigin(allowedOrigins, ev.origin)) {
            console.warn(`Invalid origin '${ev.origin}' for comlink proxy`);
            return;
          }
          const { id, type, path } = Object.assign({ path: [] }, ev.data);
          const argumentList = (ev.data.argumentList || []).map(fromWireValue);
          let returnValue;
          try {
            const parent = path.slice(0, -1).reduce((obj2, prop) => obj2[prop], obj);
            const rawValue = path.reduce((obj2, prop) => obj2[prop], obj);
            switch (type) {
              case "GET":
                {
                  returnValue = rawValue;
                }
                break;
              case "SET":
                {
                  parent[path.slice(-1)[0]] = fromWireValue(ev.data.value);
                  returnValue = true;
                }
                break;
              case "APPLY":
                {
                  returnValue = rawValue.apply(parent, argumentList);
                }
                break;
              case "CONSTRUCT":
                {
                  const value = new rawValue(...argumentList);
                  returnValue = proxy(value);
                }
                break;
              case "ENDPOINT":
                {
                  const { port1, port2 } = new MessageChannel();
                  expose2(obj, port2);
                  returnValue = transfer(port1, [port1]);
                }
                break;
              case "RELEASE":
                {
                  returnValue = void 0;
                }
                break;
              default:
                return;
            }
          } catch (value) {
            returnValue = { value, [throwMarker]: 0 };
          }
          Promise.resolve(returnValue).catch((value) => {
            return { value, [throwMarker]: 0 };
          }).then((returnValue2) => {
            const [wireValue, transferables] = toWireValue(returnValue2);
            ep.postMessage(Object.assign(Object.assign({}, wireValue), { id }), transferables);
            if (type === "RELEASE") {
              ep.removeEventListener("message", callback);
              closeEndPoint(ep);
              if (finalizer in obj && typeof obj[finalizer] === "function") {
                obj[finalizer]();
              }
            }
          }).catch((error) => {
            const [wireValue, transferables] = toWireValue({
              value: new TypeError("Unserializable return value"),
              [throwMarker]: 0
            });
            ep.postMessage(Object.assign(Object.assign({}, wireValue), { id }), transferables);
          });
        });
        if (ep.start) {
          ep.start();
        }
      }
      function isMessagePort(endpoint) {
        return endpoint.constructor.name === "MessagePort";
      }
      function closeEndPoint(endpoint) {
        if (isMessagePort(endpoint))
          endpoint.close();
      }
      function wrap2(ep, target) {
        const pendingListeners = /* @__PURE__ */ new Map();
        ep.addEventListener("message", function handleMessage(ev) {
          const { data } = ev;
          if (!data || !data.id) {
            return;
          }
          const resolver = pendingListeners.get(data.id);
          if (!resolver) {
            return;
          }
          try {
            resolver(data);
          } finally {
            pendingListeners.delete(data.id);
          }
        });
        return createProxy(ep, pendingListeners, [], target);
      }
      function throwIfProxyReleased(isReleased) {
        if (isReleased) {
          throw new Error("Proxy has been released and is not useable");
        }
      }
      function releaseEndpoint(ep) {
        return requestResponseMessage(ep, /* @__PURE__ */ new Map(), {
          type: "RELEASE"
        }).then(() => {
          closeEndPoint(ep);
        });
      }
      const proxyCounter = /* @__PURE__ */ new WeakMap();
      const proxyFinalizers = "FinalizationRegistry" in globalThis && new FinalizationRegistry((ep) => {
        const newCount = (proxyCounter.get(ep) || 0) - 1;
        proxyCounter.set(ep, newCount);
        if (newCount === 0) {
          releaseEndpoint(ep);
        }
      });
      function registerProxy(proxy2, ep) {
        const newCount = (proxyCounter.get(ep) || 0) + 1;
        proxyCounter.set(ep, newCount);
        if (proxyFinalizers) {
          proxyFinalizers.register(proxy2, ep, proxy2);
        }
      }
      function unregisterProxy(proxy2) {
        if (proxyFinalizers) {
          proxyFinalizers.unregister(proxy2);
        }
      }
      function createProxy(ep, pendingListeners, path = [], target = function() {
      }) {
        let isProxyReleased = false;
        const proxy2 = new Proxy(target, {
          get(_target, prop) {
            throwIfProxyReleased(isProxyReleased);
            if (prop === releaseProxy2) {
              return () => {
                unregisterProxy(proxy2);
                releaseEndpoint(ep);
                pendingListeners.clear();
                isProxyReleased = true;
              };
            }
            if (prop === "then") {
              if (path.length === 0) {
                return { then: () => proxy2 };
              }
              const r = requestResponseMessage(ep, pendingListeners, {
                type: "GET",
                path: path.map((p) => p.toString())
              }).then(fromWireValue);
              return r.then.bind(r);
            }
            return createProxy(ep, pendingListeners, [...path, prop]);
          },
          set(_target, prop, rawValue) {
            throwIfProxyReleased(isProxyReleased);
            const [value, transferables] = toWireValue(rawValue);
            return requestResponseMessage(ep, pendingListeners, {
              type: "SET",
              path: [...path, prop].map((p) => p.toString()),
              value
            }, transferables).then(fromWireValue);
          },
          apply(_target, _thisArg, rawArgumentList) {
            throwIfProxyReleased(isProxyReleased);
            const last = path[path.length - 1];
            if (last === createEndpoint) {
              return requestResponseMessage(ep, pendingListeners, {
                type: "ENDPOINT"
              }).then(fromWireValue);
            }
            if (last === "bind") {
              return createProxy(ep, pendingListeners, path.slice(0, -1));
            }
            const [argumentList, transferables] = processArguments(rawArgumentList);
            return requestResponseMessage(ep, pendingListeners, {
              type: "APPLY",
              path: path.map((p) => p.toString()),
              argumentList
            }, transferables).then(fromWireValue);
          },
          construct(_target, rawArgumentList) {
            throwIfProxyReleased(isProxyReleased);
            const [argumentList, transferables] = processArguments(rawArgumentList);
            return requestResponseMessage(ep, pendingListeners, {
              type: "CONSTRUCT",
              path: path.map((p) => p.toString()),
              argumentList
            }, transferables).then(fromWireValue);
          }
        });
        registerProxy(proxy2, ep);
        return proxy2;
      }
      function myFlat(arr) {
        return Array.prototype.concat.apply([], arr);
      }
      function processArguments(argumentList) {
        const processed = argumentList.map(toWireValue);
        return [processed.map((v) => v[0]), myFlat(processed.map((v) => v[1]))];
      }
      const transferCache = /* @__PURE__ */ new WeakMap();
      function transfer(obj, transfers) {
        transferCache.set(obj, transfers);
        return obj;
      }
      function proxy(obj) {
        return Object.assign(obj, { [proxyMarker]: true });
      }
      function windowEndpoint(w, context = globalThis, targetOrigin = "*") {
        return {
          postMessage: (msg, transferables) => w.postMessage(msg, targetOrigin, transferables),
          addEventListener: context.addEventListener.bind(context),
          removeEventListener: context.removeEventListener.bind(context)
        };
      }
      function toWireValue(value) {
        for (const [name, handler] of transferHandlers) {
          if (handler.canHandle(value)) {
            const [serializedValue, transferables] = handler.serialize(value);
            return [
              {
                type: "HANDLER",
                name,
                value: serializedValue
              },
              transferables
            ];
          }
        }
        return [
          {
            type: "RAW",
            value
          },
          transferCache.get(value) || []
        ];
      }
      function fromWireValue(value) {
        switch (value.type) {
          case "HANDLER":
            return transferHandlers.get(value.name).deserialize(value.value);
          case "RAW":
            return value.value;
        }
      }
      function requestResponseMessage(ep, pendingListeners, msg, transfers) {
        return new Promise((resolve2) => {
          const id = generateUUID();
          pendingListeners.set(id, resolve2);
          if (ep.start) {
            ep.start();
          }
          ep.postMessage(Object.assign({ id }, msg), transfers);
        });
      }
      function generateUUID() {
        return new Array(4).fill(0).map(() => Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(16)).join("-");
      }
      exports2.createEndpoint = createEndpoint;
      exports2.expose = expose2;
      exports2.finalizer = finalizer;
      exports2.proxy = proxy;
      exports2.proxyMarker = proxyMarker;
      exports2.releaseProxy = releaseProxy2;
      exports2.transfer = transfer;
      exports2.transferHandlers = transferHandlers;
      exports2.windowEndpoint = windowEndpoint;
      exports2.wrap = wrap2;
    }));
  }
});

// .build/row120-production-proof.ts
var import_comlink2 = __toESM(require_comlink(), 1);
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync as rmSync4, mkdirSync, symlinkSync, readFileSync as readFileSync2 } from "node:fs";
import { join as join3 } from "node:path";
import { tmpdir as tmpdir2 } from "node:os";
import { execFileSync } from "node:child_process";
import { MessageChannel as MessageChannel2 } from "node:worker_threads";
import { DatabaseSync as DatabaseSync4 } from "node:sqlite";

// src/platform/sqlite/connection-adapter.ts
import { DatabaseSync } from "node:sqlite";
import { closeSync, openSync, realpathSync, rmSync, statfsSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
function canUseWAL(databasePath) {
  if (process.platform !== "darwin") return true;
  let probePath;
  let probe;
  try {
    let physicalPath;
    try {
      physicalPath = realpathSync(databasePath);
    } catch (cause) {
      if (cause.code !== "ENOENT") throw cause;
      physicalPath = join(realpathSync(dirname(databasePath)), "main.sqlite");
    }
    const directory = dirname(physicalPath);
    statfsSync(directory);
    const candidate = join(directory, `.1ku-wal-probe-${randomUUID()}.sqlite`);
    const fd = openSync(candidate, "wx", 384);
    probePath = candidate;
    closeSync(fd);
    probe = new DatabaseSync(candidate);
    if (Number(scalar(probe, "SELECT sqlite_compileoption_used('ENABLE_LOCKING_STYLE')")) !== 1)
      return false;
    if (String(scalar(probe, "PRAGMA locking_mode=NORMAL")).toLowerCase() !== "normal")
      return false;
    return String(scalar(probe, "PRAGMA journal_mode=WAL")).toLowerCase() === "wal";
  } catch {
    return false;
  } finally {
    try {
      probe?.close();
    } finally {
      if (probePath)
        for (const suffix of ["", "-wal", "-shm", "-journal"])
          rmSync(`${probePath}${suffix}`, { force: true });
    }
  }
}
function scalar(database, sql) {
  return Object.values(database.prepare(sql).get())[0];
}
function configureDatabase(database, policy) {
  if (!policy) {
    database.exec("PRAGMA busy_timeout = 5000");
    database.exec("PRAGMA journal_mode = WAL");
    database.exec("PRAGMA synchronous = NORMAL");
    database.exec("PRAGMA foreign_keys = ON");
    return;
  }
  const main = database;
  main.exec("PRAGMA busy_timeout = 5000");
  if (Number(scalar(main, "PRAGMA busy_timeout")) !== 5e3)
    throw new Error("DATABASE_BUSY_TIMEOUT_READBACK_FAILED");
  if (policy.physicalFresh) {
    main.exec("PRAGMA page_size=4096");
    main.exec("PRAGMA encoding='UTF-8'");
    if (Number(scalar(main, "PRAGMA page_size")) !== 4096 || String(scalar(main, "PRAGMA encoding")).toUpperCase() !== "UTF-8") {
      throw new Error("DATABASE_FRESH_FORMAT_READBACK_FAILED");
    }
  }
  const pageSize = Number(scalar(main, "PRAGMA page_size"));
  if (!Number.isSafeInteger(pageSize) || pageSize <= 0)
    throw new Error("DATABASE_PAGE_SIZE_INVALID");
  const cachePages = Math.max(1, Math.floor(8192e3 / pageSize));
  main.exec(`PRAGMA cache_size=${cachePages}`);
  if (Number(scalar(main, "PRAGMA cache_size")) !== cachePages)
    throw new Error("DATABASE_CACHE_READBACK_FAILED");
  if (String(scalar(main, "PRAGMA main.locking_mode=EXCLUSIVE")).toLowerCase() !== "exclusive") {
    throw new Error("DATABASE_EXCLUSIVE_READBACK_FAILED");
  }
  const expectedMode = policy.useWAL ? "wal" : "delete";
  if (String(scalar(main, `PRAGMA journal_mode=${expectedMode.toUpperCase()}`)).toLowerCase() !== expectedMode) {
    throw new Error("DATABASE_JOURNAL_MODE_READBACK_FAILED");
  }
  if (policy.useWAL) {
    main.exec("PRAGMA synchronous=NORMAL");
    if (Number(scalar(main, "PRAGMA synchronous")) !== 1)
      throw new Error("DATABASE_SYNCHRONOUS_READBACK_FAILED");
  }
  main.exec("PRAGMA foreign_keys=ON");
  if (Number(scalar(main, "PRAGMA foreign_keys")) !== 1)
    throw new Error("DATABASE_FOREIGN_KEYS_READBACK_FAILED");
}

// src/platform/sqlite/database-worker-server.ts
var import_comlink = __toESM(require_comlink(), 1);
import { copyFileSync as copyFileSync2, existsSync as existsSync2, renameSync as renameSync2, rmSync as rmSync3, statSync as statSync2, utimesSync } from "node:fs";
import { randomUUID as randomUUID3 } from "node:crypto";
import { backup, DatabaseSync as DatabaseSync3 } from "node:sqlite";

// src/platform/sqlite/recovery-policy.ts
import {
  closeSync as closeSync2,
  copyFileSync,
  existsSync,
  openSync as openSync2,
  readSync,
  readFileSync,
  renameSync,
  rmSync as rmSync2,
  statSync,
  writeSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join as join2, resolve, sep } from "node:path";
import { randomUUID as randomUUID2 } from "node:crypto";
import { DatabaseSync as DatabaseSync2 } from "node:sqlite";
function isSqliteCorruptionError(cause) {
  if (typeof cause !== "object" || cause === null) return false;
  const error = cause;
  if (error.code !== "ERR_SQLITE_ERROR" || typeof error.errcode !== "number") return false;
  const primaryCode = error.errcode & 255;
  return primaryCode === 11 || primaryCode === 26;
}
function createRecoveryMarkerPath(databasePath) {
  return `${databasePath}.is.corrupt`;
}
function requiresOfflineBackup(databasePath) {
  if (process.platform !== "linux") return false;
  const mainPath = resolve(databasePath);
  const mounts = readFileSync("/proc/self/mountinfo", "utf8");
  let longest = -1;
  let fsType = "";
  for (const line of mounts.split("\n")) {
    const [before, after] = line.split(" - ");
    if (!before || !after) continue;
    const mount = before.split(" ")[4]?.replace(
      /\\(040|011|012|134)/gu,
      (_, code) => String.fromCharCode(Number.parseInt(code, 8))
    );
    if (!mount || !(mount === sep || mainPath === mount || mainPath.startsWith(`${mount}${sep}`)))
      continue;
    if (mount.length > longest) {
      longest = mount.length;
      fsType = after.split(" ")[0] ?? "";
    }
  }
  if (longest < 0) throw new Error("DATABASE_MAIN_MOUNT_UNKNOWN");
  return ["cifs", "smb", "smb2", "nfs"].includes(fsType);
}
function removeRequired(path) {
  rmSync2(path, { force: true });
}
function removeReplaySidecars(path) {
  removeRequired(`${path}-journal`);
  removeRequired(`${path}-wal`);
  try {
    removeRequired(`${path}-shm`);
  } catch (cause) {
    console.error("IKU_DATABASE_SHM_CLEANUP_FAILED", cause);
  }
}
function integrity(path, quick = false) {
  let database = null;
  try {
    database = new DatabaseSync2(path, { readOnly: true });
    const row = database.prepare(`PRAGMA ${quick ? "quick_check" : "integrity_check"}(1)`).get();
    return Object.values(row)[0] === "ok";
  } catch (cause) {
    if (isSqliteCorruptionError(cause)) return false;
    throw cause;
  } finally {
    database?.close();
  }
}
function verifiedRepairCandidate(databasePath) {
  const candidatePath = `${databasePath}.repair.tmp`;
  const witnessPath = `${candidatePath}.verified`;
  if (!existsSync(candidatePath)) {
    rmSync2(witnessPath, { force: true });
    removeReplaySidecars(candidatePath);
    return null;
  }
  let valid = false;
  try {
    const witness = JSON.parse(readFileSync(witnessPath, "utf8"));
    const candidate = statSync(candidatePath);
    valid = witness.size === candidate.size && witness.lastModified === candidate.mtimeMs;
  } catch {
  }
  if (!valid) valid = integrity(candidatePath);
  rmSync2(witnessPath, { force: true });
  if (valid) return candidatePath;
  rmSync2(candidatePath, { force: true });
  removeReplaySidecars(candidatePath);
  return null;
}
function applyPendingRepairBeforeOpen(databasePath) {
  for (const suffix of [".check.tmp", ".bak.reindex.tmp"]) {
    const temporaryPath = `${databasePath}${suffix}`;
    try {
      removeRequired(temporaryPath);
      removeReplaySidecars(temporaryPath);
    } catch (cause) {
      console.error("IKU_DATABASE_INTERRUPTED_REPAIR_CLEANUP_FAILED", cause);
    }
  }
  const candidatePath = verifiedRepairCandidate(databasePath);
  if (!candidatePath) return;
  removeReplaySidecars(databasePath);
  renameSync(candidatePath, databasePath);
  removeRequired(createRecoveryMarkerPath(databasePath));
}
function mainHasWALHeader(databasePath) {
  let fd;
  try {
    fd = openSync2(databasePath, "r");
  } catch (cause) {
    if (cause.code === "ENOENT") return null;
    throw cause;
  }
  try {
    const header = Buffer.alloc(20);
    return readSync(fd, header, 0, header.length, 0) >= 20 && header[18] === 2;
  } finally {
    closeSync2(fd);
  }
}
function revertWALHeader(databasePath) {
  const fd = openSync2(databasePath, "r+");
  try {
    if (writeSync(fd, Buffer.from([1, 1]), 0, 2, 18) !== 2) {
      throw new Error("DATABASE_ROLLBACK_HEADER_WRITE_FAILED");
    }
  } finally {
    closeSync2(fd);
  }
}
function normalizeMainToRollbackBeforeOpen(databasePath) {
  const walHeader = mainHasWALHeader(databasePath);
  if (walHeader === null) return;
  let walSize;
  try {
    walSize = statSync(`${databasePath}-wal`).size;
  } catch (cause) {
    if (cause.code !== "ENOENT") throw cause;
    walSize = null;
  }
  if (!walHeader && walSize === null) return;
  if (walSize !== null && walSize > 0) {
    const candidatePath = join2(tmpdir(), `1ku.${randomUUID2()}.sqlite`);
    const swapPath = `${databasePath}.convert-tmp`;
    try {
      copyFileSync(databasePath, candidatePath);
      copyFileSync(`${databasePath}-wal`, `${candidatePath}-wal`);
      let valid = false;
      try {
        const candidate = new DatabaseSync2(candidatePath);
        try {
          const mode = candidate.prepare("PRAGMA journal_mode=DELETE").get();
          if (String(Object.values(mode)[0]).toLowerCase() !== "delete") {
            throw new Error("DATABASE_ROLLBACK_CONVERSION_FAILED");
          }
        } finally {
          candidate.close();
        }
        valid = integrity(candidatePath);
      } catch (cause) {
        if (!isSqliteCorruptionError(cause)) throw cause;
      }
      if (!valid) {
        removeRequired(candidatePath);
        removeReplaySidecars(candidatePath);
        copyFileSync(databasePath, candidatePath);
        revertWALHeader(candidatePath);
        if (!integrity(candidatePath)) throw new Error("DATABASE_ROLLBACK_CANDIDATE_INVALID");
      }
      copyFileSync(candidatePath, swapPath);
      renameSync(swapPath, databasePath);
    } finally {
      removeRequired(candidatePath);
      removeReplaySidecars(candidatePath);
      removeRequired(swapPath);
    }
  } else if (walHeader) {
    revertWALHeader(databasePath);
  }
  removeRequired(`${databasePath}-wal`);
  removeRequired(`${databasePath}-shm`);
}

// src/platform/sqlite/database-worker-server.ts
var BACKUP_INTERVAL_MS = 1440 * 60 * 1e3;
function databaseFailure(code, cause) {
  return Object.assign(new Error(code, { cause }), { code });
}
function attributeDatabaseRequestFailure(database, cause) {
  if (!isSqliteCorruptionError(cause)) throw cause;
  let rows;
  try {
    rows = database.prepare("PRAGMA main.quick_check(1)").all();
  } catch (checkCause) {
    throw databaseFailure(
      isSqliteCorruptionError(checkCause) ? "DATABASE_MAIN_CORRUPTION_CONFIRMED" : "DATABASE_MAIN_HEALTH_UNKNOWN_OPERATIONAL_FAILURE",
      checkCause
    );
  }
  if (rows.length === 1 && Object.values(rows[0] ?? {})[0] === "ok") {
    throw databaseFailure("DATABASE_ATTACHED_CORRUPTION", cause);
  }
  throw databaseFailure("DATABASE_MAIN_CORRUPTION_CONFIRMED", cause);
}
function backupEligibility(databasePath, nowMs) {
  const latestPath = `${databasePath}.bak`;
  if (!existsSync2(latestPath)) return "ELIGIBLE";
  const source = statSync2(databasePath);
  const latest = statSync2(latestPath);
  const walPath = `${databasePath}-wal`;
  const walChanged = existsSync2(walPath) && statSync2(walPath).mtimeMs > latest.mtimeMs;
  if (source.mtimeMs <= latest.mtimeMs && !walChanged) {
    return "SKIPPED_UNCHANGED";
  }
  return nowMs - latest.mtimeMs < BACKUP_INTERVAL_MS ? "SKIPPED_INTERVAL" : "ELIGIBLE";
}
function meta(database, key) {
  try {
    return database.prepare("SELECT value FROM knowledge_meta WHERE key=?").get(key)?.value;
  } catch {
    return void 0;
  }
}
function validatedProtectedCopy(path, libraryId, targetVersion) {
  if (!existsSync2(path)) return null;
  let candidate = null;
  try {
    candidate = new DatabaseSync3(path, { readOnly: true });
    const integrity2 = candidate.prepare("PRAGMA main.integrity_check(1)").get();
    const version = Number(meta(candidate, "product_schema_version"));
    const target = Number(targetVersion);
    if (Object.values(integrity2)[0] !== "ok" || meta(candidate, "library_id") !== libraryId || !Number.isSafeInteger(version) || !Number.isSafeInteger(target) || version < 1 || version > target)
      return null;
    return version < target ? "UPGRADE_PRESTATE" : "CURRENT_REPAIR_PRESTATE";
  } catch {
    return null;
  } finally {
    candidate?.close();
  }
}
function publishBackup(candidatePath, databasePath) {
  const latestPath = `${databasePath}.bak`;
  const olderPath = `${databasePath}.1.bak`;
  rmSync3(olderPath, { force: true });
  const hadLatest = existsSync2(latestPath);
  if (hadLatest) renameSync2(latestPath, olderPath);
  try {
    renameSync2(candidatePath, latestPath);
  } catch (cause) {
    if (hadLatest) renameSync2(olderPath, latestPath);
    throw cause;
  }
}
async function createRegularBackup(database, databasePath, nowMs) {
  const initialEligibility = backupEligibility(databasePath, nowMs);
  if (initialEligibility !== "ELIGIBLE") return { status: initialEligibility };
  const candidatePath = `${databasePath}.bak.tmp.${randomUUID3()}`;
  try {
    await backup(database, candidatePath);
    const candidate = new DatabaseSync3(candidatePath, { readOnly: true });
    try {
      const row = candidate.prepare("PRAGMA integrity_check(1)").get();
      if (Object.values(row)[0] !== "ok") throw new Error("DATABASE_BACKUP_CANDIDATE_INVALID");
    } finally {
      candidate.close();
    }
    database.exec("PRAGMA busy_timeout = 0");
    try {
      database.exec("BEGIN IMMEDIATE");
    } catch {
      rmSync3(candidatePath, { force: true });
      return { status: "DEFERRED" };
    } finally {
      database.exec("PRAGMA busy_timeout = 5000");
    }
    try {
      const finalEligibility = backupEligibility(databasePath, nowMs);
      if (finalEligibility !== "ELIGIBLE") {
        rmSync3(candidatePath, { force: true });
        return { status: finalEligibility };
      }
      publishBackup(candidatePath, databasePath);
      return { status: "COMPLETED" };
    } finally {
      database.exec("ROLLBACK");
    }
  } catch (cause) {
    rmSync3(candidatePath, { force: true });
    return { status: "FAILED", message: cause instanceof Error ? cause.message : String(cause) };
  }
}
function runDatabaseWorkerServer(scope, operations) {
  let database = null;
  let databasePath = null;
  let backupPromise = null;
  let closePromise = null;
  let closing = false;
  let mainConfirmedCorrupt = false;
  const api = {
    open(path, mode = "NORMAL") {
      if (database) throw new Error("DATABASE_WORKER_ALREADY_OPEN");
      if (mode === "NORMAL") {
        applyPendingRepairBeforeOpen(path);
        if (existsSync2(createRecoveryMarkerPath(path))) return "DATABASE_OPEN_RECOVERY_REQUIRED";
      }
      let uncleanShutdown = false;
      if (mode === "NORMAL") {
        try {
          uncleanShutdown = statSync2(`${path}-wal`).size > 0;
        } catch (cause) {
          if (cause.code !== "ENOENT") throw cause;
        }
      }
      const useWAL = canUseWAL(path);
      if (!useWAL) normalizeMainToRollbackBeforeOpen(path);
      let opened = null;
      try {
        opened = new DatabaseSync3(path);
        const pageCount = Number(
          Object.values(opened.prepare("PRAGMA page_count").get())[0]
        );
        configureDatabase(opened, { physicalFresh: pageCount === 0, useWAL });
        if (mode === "RECOVERY_ADMISSION" || uncleanShutdown) {
          const row = opened.prepare("PRAGMA main.integrity_check(1)").get();
          if (Object.values(row)[0] !== "ok") {
            throw databaseFailure("DATABASE_MAIN_CORRUPTION_CONFIRMED", row);
          }
        }
      } catch (cause) {
        if (mode === "NORMAL" && (isSqliteCorruptionError(cause) || cause.code === "DATABASE_MAIN_CORRUPTION_CONFIRMED")) {
          database = opened;
          databasePath = path;
          closing = false;
          mainConfirmedCorrupt = true;
          return "DATABASE_MAIN_CORRUPTION_CONFIRMED";
        }
        opened?.close();
        throw cause;
      }
      database = opened;
      databasePath = path;
      closing = false;
      mainConfirmedCorrupt = false;
      return "DATABASE_OPEN_READY";
    },
    request(operation, payload) {
      if (!database || closing) throw new Error("DATABASE_WORKER_NOT_OPEN");
      const handler = operations[operation];
      if (!handler) throw new Error(`DATABASE_WORKER_OPERATION_UNKNOWN:${operation}`);
      try {
        return handler(database, payload);
      } catch (cause) {
        try {
          return attributeDatabaseRequestFailure(database, cause);
        } catch (attributed) {
          if (attributed.code === "DATABASE_MAIN_CORRUPTION_CONFIRMED" || attributed.message === "DATABASE_MAIN_CORRUPTION_CONFIRMED") {
            mainConfirmedCorrupt = true;
          }
          throw attributed;
        }
      }
    },
    regularBackup(nowMs = Date.now()) {
      if (!database || !databasePath || closing || mainConfirmedCorrupt) {
        return Promise.resolve({ status: "FAILED", message: "DATABASE_WORKER_NOT_OPEN" });
      }
      if (meta(database, "last_schema_update_target")) {
        return Promise.resolve({ status: "DEFERRED" });
      }
      if (requiresOfflineBackup(databasePath)) {
        const path = databasePath;
        const eligibility = backupEligibility(path, nowMs);
        if (eligibility !== "ELIGIBLE") return Promise.resolve({ status: eligibility });
        const candidatePath = `${path}.bak.tmp.${randomUUID3()}`;
        const checkpoint = database.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
        if (Number(Object.values(checkpoint)[0]) !== 0) {
          return Promise.resolve({
            status: "FAILED",
            message: "DATABASE_OFFLINE_CHECKPOINT_FAILED"
          });
        }
        database.close();
        database = null;
        let copyError;
        let reopenError = null;
        try {
          copyFileSync2(path, candidatePath);
          const candidate = new DatabaseSync3(candidatePath, { readOnly: true });
          try {
            const check = candidate.prepare("PRAGMA main.integrity_check(1)").get();
            if (Object.values(check)[0] !== "ok")
              throw new Error("DATABASE_BACKUP_CANDIDATE_INVALID");
          } finally {
            candidate.close();
          }
        } catch (cause) {
          copyError = cause;
        } finally {
          try {
            if (api.open(path) !== "DATABASE_OPEN_READY")
              reopenError = databaseFailure(
                "DATABASE_OFFLINE_REOPEN_FAILED",
                new Error("DATABASE_OFFLINE_REOPEN_FAILED")
              );
          } catch (cause) {
            reopenError = databaseFailure("DATABASE_OFFLINE_REOPEN_FAILED", cause);
          }
        }
        try {
          if (reopenError) throw reopenError;
          if (copyError) {
            return Promise.resolve({
              status: "FAILED",
              message: copyError instanceof Error ? copyError.message : String(copyError)
            });
          }
          publishBackup(candidatePath, path);
          return Promise.resolve({ status: "COMPLETED" });
        } finally {
          rmSync3(candidatePath, { force: true });
        }
      }
      backupPromise ??= createRegularBackup(database, databasePath, nowMs).finally(() => {
        backupPromise = null;
      });
      return backupPromise;
    },
    async preserveForProductMutation(request) {
      if (!database || !databasePath || closing || mainConfirmedCorrupt || backupPromise) {
        throw new Error("DATABASE_UPGRADE_BACKUP_NOT_ADMITTED");
      }
      if (!/^[1-9][0-9]*$/u.test(request.fromVersion) || !/^[1-9][0-9]*$/u.test(request.targetVersion) || !Number.isSafeInteger(Number(request.fromVersion)) || !Number.isSafeInteger(Number(request.targetVersion)) || Number(request.fromVersion) > Number(request.targetVersion)) {
        throw new Error("DATABASE_PRODUCT_PRESERVATION_VERSION_INVALID");
      }
      if (meta(database, "library_id") !== request.libraryId || meta(database, "product_schema_version") !== request.fromVersion || (meta(database, "last_schema_update_target") ?? null) !== request.protectedTarget) {
        throw new Error("DATABASE_UPGRADE_BACKUP_SOURCE_CHANGED");
      }
      if (request.protectedTarget !== null) {
        if (request.protectedTarget !== request.targetVersion)
          throw new Error("DATABASE_PRODUCT_PRESERVATION_TARGET_MISMATCH");
        const kind = validatedProtectedCopy(
          `${databasePath}.bak`,
          request.libraryId,
          request.targetVersion
        );
        if (kind) return { kind };
        if (request.fromVersion === request.targetVersion)
          throw new Error("DATABASE_PRODUCT_PRESERVATION_INVALID");
      }
      const path = databasePath;
      const candidatePath = `${path}.bak.tmp.${randomUUID3()}`;
      const integrity2 = database.prepare("PRAGMA main.integrity_check(1)").get();
      if (Object.values(integrity2)[0] !== "ok") throw new Error("DATABASE_UPGRADE_SOURCE_INVALID");
      const checkpoint = database.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
      if (Number(Object.values(checkpoint)[0]) !== 0)
        throw new Error("DATABASE_UPGRADE_CHECKPOINT_FAILED");
      await api.close("HEALTHY");
      let copyError;
      let reopenError = null;
      try {
        copyFileSync2(path, candidatePath);
        const kind = validatedProtectedCopy(
          candidatePath,
          request.libraryId,
          request.targetVersion
        );
        if (kind !== (request.fromVersion === request.targetVersion ? "CURRENT_REPAIR_PRESTATE" : "UPGRADE_PRESTATE"))
          throw new Error("DATABASE_UPGRADE_CANDIDATE_INVALID");
        utimesSync(candidatePath, /* @__PURE__ */ new Date(), /* @__PURE__ */ new Date());
        publishBackup(candidatePath, path);
      } catch (cause) {
        copyError = cause;
      } finally {
        rmSync3(candidatePath, { force: true });
        try {
          const mode = existsSync2(createRecoveryMarkerPath(path)) ? "RECOVERY_ADMISSION" : "NORMAL";
          if (api.open(path, mode) !== "DATABASE_OPEN_READY")
            reopenError = databaseFailure(
              "DATABASE_UPGRADE_REOPEN_FAILED",
              new Error("DATABASE_UPGRADE_REOPEN_FAILED")
            );
        } catch (cause) {
          reopenError = databaseFailure("DATABASE_UPGRADE_REOPEN_FAILED", cause);
        }
      }
      if (reopenError) throw reopenError;
      if (copyError) throw copyError;
      return {
        kind: request.fromVersion === request.targetVersion ? "CURRENT_REPAIR_PRESTATE" : "UPGRADE_PRESTATE"
      };
    },
    close(mode = "HEALTHY") {
      if (closePromise) return closePromise;
      closing = true;
      closePromise = (async () => {
        await backupPromise;
        if (database && mode === "HEALTHY" && !mainConfirmedCorrupt) {
          try {
            database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
          } catch {
          }
        }
        database?.close();
        database = null;
        databasePath = null;
      })().finally(() => {
        closePromise = null;
      });
      return closePromise;
    }
  };
  (0, import_comlink.expose)(api, scope);
}

// .build/row120-production-proof.ts
var root = mkdtempSync(join3(tmpdir2(), "1ku-row120-production-"));
var results = {};
var scalar2 = (db, sql) => Object.values(db.prepare(sql).get())[0];
try {
  const main = join3(root, "main.sqlite");
  assert.equal(canUseWAL(main), true);
  assert.deepEqual(readdirSync(root), []);
  const channel = new MessageChannel2();
  runDatabaseWorkerServer(channel.port1, {
    inspect(db) {
      return { journal: scalar2(db, "PRAGMA journal_mode"), sync: scalar2(db, "PRAGMA synchronous"), locking: scalar2(db, "PRAGMA main.locking_mode"), rows: scalar2(db, "SELECT count(*) FROM facts") };
    },
    write(db) {
      db.exec("CREATE TABLE IF NOT EXISTS facts(value TEXT); INSERT INTO facts VALUES ('committed')");
      return true;
    }
  });
  const client = (0, import_comlink2.wrap)(channel.port2);
  try {
    assert.equal(await client.open(main), "DATABASE_OPEN_READY");
    await client.request("write");
    assert.deepEqual(await client.request("inspect"), { journal: "wal", sync: 1, locking: "exclusive", rows: 1 });
    await client.close();
    assert.equal(await client.open(main), "DATABASE_OPEN_READY");
    assert.deepEqual(await client.request("inspect"), { journal: "wal", sync: 1, locking: "exclusive", rows: 1 });
    await client.close();
    results.productionWorkerLocalOpenAndReopen = "PASS";
  } finally {
    await client.close();
    client[import_comlink2.releaseProxy]();
    channel.port1.close();
    channel.port2.close();
  }
  if (process.platform === "darwin") {
    assert.equal(canUseWAL(join3(root, "missing", "main.sqlite")), false);
    const targetDir = join3(root, "target");
    mkdirSync(targetDir);
    const target = join3(targetDir, "main.sqlite");
    const db = new DatabaseSync4(target);
    db.exec("CREATE TABLE proof(value TEXT)");
    db.close();
    const bytes = readFileSync2(target);
    const aliasDir = join3(root, "alias");
    mkdirSync(aliasDir);
    symlinkSync(target, join3(aliasDir, "main.sqlite"));
    assert.equal(canUseWAL(join3(aliasDir, "main.sqlite")), true);
    assert.deepEqual(readFileSync2(target), bytes);
    assert.deepEqual(readdirSync(aliasDir), ["main.sqlite"]);
    assert.deepEqual(readdirSync(targetDir), ["main.sqlite"]);
    results.missingFactsAndSymlinkTargetAndCleanup = "PASS";
    const built = new DatabaseSync4(":memory:");
    assert.equal(scalar2(built, "SELECT sqlite_compileoption_used('ENABLE_LOCKING_STYLE')"), 1);
    built.close();
    results.nativeMacLockingStyle = "PASS";
    for (const vfs of ["unix-nfs", "unix-afp", "unix-dotfile", "unix-none"]) {
      const vfsDb = new DatabaseSync4(":memory:");
      try {
        const uri = `file:${join3(root, `${vfs}.sqlite`)}?vfs=${vfs}`;
        vfsDb.exec(`ATTACH DATABASE '${uri.replaceAll("'", "''")}' AS probe`);
        assert.notEqual(scalar2(vfsDb, "PRAGMA probe.journal_mode=WAL"), "wal");
        results[vfs] = "PASS_NATIVE_WAL_DENIED";
      } finally {
        vfsDb.close();
      }
    }
    const image = join3(root, "readonly.dmg");
    const mount = join3(root, "readonly");
    mkdirSync(mount);
    execFileSync("hdiutil", ["create", "-size", "16m", "-fs", "HFS+", "-volname", "1KU-row120", image]);
    execFileSync("hdiutil", ["attach", "-readonly", "-nobrowse", "-mountpoint", mount, image]);
    try {
      assert.equal(canUseWAL(join3(mount, "main.sqlite")), false);
      assert.deepEqual(readdirSync(mount).filter((name) => name.startsWith(".1ku-wal-probe-")), []);
      results.realReadOnlyVolume = "PASS";
    } finally {
      execFileSync("hdiutil", ["detach", mount]);
    }
  }
  console.log(JSON.stringify({ result: "PASS", platform: process.platform, node: process.version, results, realNetworkFilesystemObserved: false, realObsidianHostObserved: false }));
} catch (cause) {
  console.error(cause);
  throw cause;
} finally {
  rmSync4(root, { recursive: true, force: true });
}
/*! Bundled license information:

comlink/dist/umd/comlink.js:
  (**
   * @license
   * Copyright 2019 Google LLC
   * SPDX-License-Identifier: Apache-2.0
   *)
*/
