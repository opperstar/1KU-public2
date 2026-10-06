// Isolated capability experiment, not a 1KU production loader or Host acceptance.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const scenario = process.argv[2];
// Filled from the current canonical D01 function by the local qualification preparation.
const qualifiedOwnerFunction =
  'function getWatchpack() {\n  const key = /* @__PURE__ */ Symbol.for(`1KU.watchpack.${IKU_WATCHPACK_SOURCE_SHA256}`);\n  const realm = globalThis;\n  const existing = realm[key];\n  if (existing !== void 0) {\n    if (typeof existing !== "function") throw new Error("D01_WATCHPACK_EXPORT_INVALID");\n    return existing;\n  }\n  const module = { exports: {} };\n  compileFunction(IKU_WATCHPACK_SOURCE, ["require", "module", "exports"], {\n    filename: "1KU-watchpack.cjs"\n  })(createRequire(process.execPath), module, module.exports);\n  if (typeof module.exports !== "function") throw new Error("D01_WATCHPACK_EXPORT_INVALID");\n  realm[key] = module.exports;\n  return module.exports;\n}\n';

function execute(source, nativeRequire = require) {
  const module = { exports: {} };
  vm.compileFunction(source, ["require", "module", "exports"], {
    filename: "upstream-dependency.cjs",
  })(nativeRequire, module, module.exports);
  return module.exports;
}

if (scenario) {
  const input = JSON.parse(fs.readFileSync(0, "utf8"));
  // Independent native resolution: no plugin require closure or private Host package.
  const nativeRequire = createRequire(path.join(process.cwd(), "scope-fixture.cjs"));
  const original = {
    cwd: process.cwd,
    chdir: process.chdir,
    close: fs.close,
    closeSync: fs.closeSync,
  };
  if (scenario.endsWith("monolithic") || scenario.endsWith("isolated")) {
    let dependency;
    const module = { exports: {} };
    const probeSource = `
      const probe = {fixtureHeavyGraph: true, bytes: Buffer.alloc(1024 * 1024)};
      const weak = new WeakRef(probe);
    `;
    let weak;
    const monolithic = scenario.endsWith("monolithic");
    if (monolithic) {
      weak = vm.compileFunction(
        probeSource + input.source + "; module.exports.fixtureRead = () => probe; return weak;",
        ["require", "module", "exports", "Buffer", "WeakRef"],
        { filename: "synthetic-heavy-main.cjs" },
      )(nativeRequire, module, module.exports, Buffer, WeakRef);
      dependency = module.exports;
      // Remove the experiment's only intentional direct consumer of the heavy probe.
      delete dependency.fixtureRead;
    } else {
      weak = vm.compileFunction(
        probeSource + "install(); return weak;",
        ["install", "Buffer", "WeakRef"],
        { filename: "synthetic-heavy-main.cjs" },
      )(
        () => {
          dependency = execute(input.source, nativeRequire);
        },
        Buffer,
        WeakRef,
      );
    }
    assert.notEqual(process.cwd, original.cwd);
    assert.notEqual(process.chdir, original.chdir);
    assert.notEqual(fs.close, original.close);
    assert.notEqual(fs.closeSync, original.closeSync);
    const queueSymbol = Symbol.for("graceful-fs.queue");
    assert.equal(fs[queueSymbol], globalThis[queueSymbol]);
    if (scenario.startsWith("watchpack-")) {
      assert.equal(typeof dependency, "function");
    } else {
      assert.equal(typeof dependency.gracefulify, "function");
      assert.equal(dependency.readFileSync(input.readFile, "utf8"), input.expectedText);
    }
    dependency = null;
    module.exports = null;
    // GC is ONLY an isolated test primitive. Never add this to the plugin/Host.
    await new Promise((resolve) => setImmediate(resolve));
    for (let i = 0; i < 5; i++) globalThis.gc();
    await new Promise((resolve) => setImmediate(resolve));
    const alive = weak.deref() !== undefined;
    assert.equal(alive, monolithic);
    console.log(
      JSON.stringify({ scenario, heavyProbeAlive: alive, fullWrappers: true, sharedQueue: true }),
    );
  } else if (scenario === "watchpack-reuse" || scenario === "watchpack-reuse-legacy") {
    let legacyProbe;
    if (scenario.endsWith("legacy")) {
      const module = { exports: {} };
      legacyProbe = vm.compileFunction(
        "const probe = {bytes: Buffer.alloc(1024 * 1024)};" +
          input.source +
          ";module.exports.capture = () => probe;return new WeakRef(probe);",
        ["require", "module", "exports"],
      )(nativeRequire, module, module.exports);
      delete module.exports.capture;
      module.exports = null;
    }
    const probes = [],
      providers = [],
      wrappers = [];
    function generation(source) {
      const hash = createHash("sha256").update(source).digest("hex");
      const module = { exports: {} };
      vm.compileFunction(
        "const probe = {bytes: Buffer.alloc(1024 * 1024)};" +
          "const IKU_WATCHPACK_SOURCE=" +
          JSON.stringify(source) +
          ";" +
          "const IKU_WATCHPACK_SOURCE_SHA256=" +
          JSON.stringify(hash) +
          ";" +
          input.ownerFunction +
          ";module.exports = {provider: getWatchpack(), capture: () => probe, weak: new WeakRef(probe)};",
        ["createRequire", "compileFunction", "module"],
      )(createRequire, vm.compileFunction, module);
      const watcher = new module.exports.provider({
        aggregateTimeout: 200,
        followSymlinks: false,
        poll: undefined,
      });
      watcher.on("aggregated", module.exports.capture);
      watcher.close();
      probes.push(module.exports.weak);
      providers.push(module.exports.provider);
      wrappers.push(process.cwd);
      module.exports = null;
    }
    for (let i = 0; i < 5; i++) generation(input.source);
    assert.equal(new Set(providers).size, 1);
    assert.equal(new Set(wrappers).size, 1);
    generation(input.source + "\n// qualified changed artifact\n");
    assert.notEqual(providers[5], providers[0]);
    await new Promise((resolve) => setImmediate(resolve));
    for (let i = 0; i < 5; i++) {
      globalThis.gc();
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(probes.filter((probe) => probe.deref()).length, 0);
    const legacyRetained = legacyProbe?.deref() !== undefined;
    assert.equal(legacyRetained, scenario.endsWith("legacy"));
    assert.equal(
      process._getActiveHandles().filter((handle) => handle.constructor.name === "FSWatcher")
        .length,
      0,
    );
    console.log(
      JSON.stringify({
        scenario,
        reloads: 5,
        wrapperCountBeforeUpgrade: 1,
        businessObjects: 0,
        changedArtifact: true,
        legacyRetained,
      }),
    );
  } else if (scenario === "retry") {
    const nativeFs = Object.assign({}, fs);
    let attempts = 0;
    nativeFs.readFile = (file, options, callback) => {
      attempts++;
      if (attempts <= 2) {
        const error = Object.assign(new Error("synthetic descriptor exhaustion"), {
          code: attempts === 1 ? "EMFILE" : "ENFILE",
        });
        process.nextTick(() => callback(error));
      } else {
        fs.readFile(file, options, callback);
      }
    };
    // Native dependency injection is confined to this error-path test.
    const dependency = execute(input.source, (id) => (id === "fs" ? nativeFs : nativeRequire(id)));
    const text = await new Promise((resolve, reject) =>
      dependency.readFile(input.readFile, "utf8", (error, data) =>
        error ? reject(error) : resolve(data),
      ),
    );
    assert.equal(text, input.expectedText);
    assert.equal(attempts, 3);
    assert.equal(nativeFs[Symbol.for("graceful-fs.queue")].length, 0);
    const queue = nativeFs[Symbol.for("graceful-fs.queue")];
    execute(input.source, (id) => (id === "fs" ? nativeFs : nativeRequire(id)));
    assert.equal(nativeFs[Symbol.for("graceful-fs.queue")], queue);
    assert.equal(globalThis[Symbol.for("graceful-fs.queue")], queue);
    console.log(
      JSON.stringify({ scenario, attempts, emfile: true, enfile: true, sharedQueue: true }),
    );
  } else if (scenario === "watchpack") {
    const Watchpack = execute(input.source, nativeRequire);
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "f1-watchpack-"));
    const file = path.join(folder, "asset.txt");
    fs.writeFileSync(file, "before");
    let watcher;
    try {
      watcher = new Watchpack({ aggregateTimeout: 200, followSymlinks: false, poll: undefined });
      const ready = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("fixture observation timeout")), 10000);
        watcher.once("change", (changed) => {
          clearTimeout(timeout);
          assert.equal(changed, file);
          resolve();
        });
        // Keep writing until the upstream native watcher is attached. Test fixture only.
        const writeTimer = setInterval(() => fs.appendFileSync(file, "changed"), 100);
        watcher.once("change", () => clearInterval(writeTimer));
        watcher.once("error", (error) => {
          clearInterval(writeTimer);
          clearTimeout(timeout);
          reject(error);
        });
        timeout.unref();
        writeTimer.unref();
      });
      watcher.watch({ files: [file], directories: [], missing: [], startTime: Date.now() - 1000 });
      await ready;
      watcher.close();
      assert.equal(watcher.fileWatchers.size, 0);
      assert.equal(watcher.directoryWatchers.size, 0);
      await new Promise((resolve) => setTimeout(resolve, 250));
      assert.equal(
        process._getActiveHandles().filter((handle) => handle.constructor.name === "FSWatcher")
          .length,
        0,
      );
      console.log(
        JSON.stringify({ scenario, change: true, closed: true, activeNativeWatchers: 0 }),
      );
    } finally {
      watcher?.close();
      // Only this verified mkdtemp directory is removed; no workspace/user data.
      fs.rmSync(folder, { recursive: true });
    }
  } else {
    throw new Error(`unknown fixture scenario: ${scenario}`);
  }
} else {
  const { build } = await import("esbuild");
  const watchpackEntry = require.resolve("watchpack");
  const gracefulEntry = require.resolve("graceful-fs", { paths: [path.dirname(watchpackEntry)] });
  const gracefulVersion = require(path.join(path.dirname(gracefulEntry), "package.json")).version;
  const bundled = async (entry) =>
    build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      minify: true,
      format: "cjs",
      platform: "node",
      target: "node22",
      metafile: true,
    });
  const [graceful, watchpack] = await Promise.all([
    bundled(gracefulEntry),
    bundled(watchpackEntry),
  ]);
  const expectedText = "F1 upstream dependency capability fixture";
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "f1-scope-"));
  const readFile = path.join(folder, "fixture.txt");
  fs.writeFileSync(readFile, expectedText);
  const results = [];
  try {
    for (const scenario of [
      "monolithic",
      "isolated",
      "watchpack-monolithic",
      "watchpack-isolated",
      "retry",
      "watchpack",
      "watchpack-reuse",
      "watchpack-reuse-legacy",
    ]) {
      const source = (scenario.startsWith("watchpack") ? watchpack : graceful).outputFiles[0].text;
      const child = spawnSync(
        process.execPath,
        ["--expose-gc", fileURLToPath(import.meta.url), scenario],
        {
          input: JSON.stringify({
            source,
            readFile,
            expectedText,
            ownerFunction: qualifiedOwnerFunction,
          }),
          encoding: "utf8",
          timeout: 20000,
        },
      );
      assert.equal(child.status, 0, child.stderr || String(child.error));
      results.push(JSON.parse(child.stdout.trim()));
    }
    console.log(
      JSON.stringify(
        {
          status: "ISOLATED_CAPABILITY_PASS",
          node: process.version,
          platform: process.platform,
          versions: {
            esbuild: require("esbuild/package.json").version,
            watchpack: require("watchpack/package.json").version,
            gracefulFs: gracefulVersion,
          },
          gracefulInputs: Object.keys(graceful.metafile.inputs).map((file) => path.basename(file)),
          gracefulPayloadBytes: Buffer.byteLength(graceful.outputFiles[0].text),
          watchpackPayloadBytes: Buffer.byteLength(watchpack.outputFiles[0].text),
          results,
          limits:
            "Synthetic scope control; not actual 1KU bundle retainer or Obsidian memory acceptance.",
        },
        null,
        2,
      ),
    );
  } finally {
    fs.rmSync(folder, { recursive: true });
  }
}
