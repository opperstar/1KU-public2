var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var stdin_exports = {};
__export(stdin_exports, {
  createKnowledgeSearchNavigationWorkerRuntime: () => createKnowledgeSearchNavigationWorkerRuntime
});
module.exports = __toCommonJS(stdin_exports);
var import_comlink = require("comlink");
function createKnowledgeSearchNavigationWorkerRuntime(options) {
  const lossListeners = /* @__PURE__ */ new Set();
  let worker = null;
  let remote = null;
  let workerUrl = null;
  let rejectSession = null;
  let sessionFailure = null;
  let disposed = false;
  let closing = false;
  let creation = null;
  let disposal = null;
  const releaseSession = (error) => {
    if (error) rejectSession?.(error);
    rejectSession = null;
    if (remote) {
      try {
        remote[import_comlink.releaseProxy]();
      } catch {
      }
    }
    worker?.terminate();
    if (workerUrl) URL.revokeObjectURL(workerUrl);
    worker = null;
    remote = null;
    workerUrl = null;
    sessionFailure = null;
  };
  const failSession = (activeWorker, message) => {
    if (worker !== activeWorker || disposed) return;
    releaseSession(new Error(message));
    for (const listener of lossListeners) listener();
  };
  const acquireUrl = async () => {
    let source = await options.loadWorkerSource();
    try {
      if (closing || disposed) throw new Error("KNOWLEDGE_SEARCH_NAVIGATION_WORKER_DISPOSED");
      if (!source.trim()) throw new Error("KNOWLEDGE_SEARCH_NAVIGATION_WORKER_SOURCE_EMPTY");
      return URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    } finally {
      source = "";
    }
  };
  const ensureRemote = async () => {
    if (closing || disposed) throw new Error("KNOWLEDGE_SEARCH_NAVIGATION_WORKER_DISPOSED");
    if (remote) return remote;
    if (creation) return creation;
    const attempt = (async () => {
      const url = await acquireUrl();
      if (closing || disposed) {
        URL.revokeObjectURL(url);
        throw new Error("KNOWLEDGE_SEARCH_NAVIGATION_WORKER_DISPOSED");
      }
      workerUrl = url;
      let nextWorker;
      try {
        nextWorker = new Worker(url, { name: "1ku-knowledge-search-navigation" });
      } catch (cause) {
        URL.revokeObjectURL(url);
        workerUrl = null;
        throw cause;
      }
      worker = nextWorker;
      remote = (0, import_comlink.wrap)(nextWorker);
      sessionFailure = new Promise((_, reject) => {
        rejectSession = reject;
      });
      void sessionFailure.catch(() => void 0);
      nextWorker.addEventListener("error", (event) => failSession(nextWorker, event.message));
      nextWorker.addEventListener(
        "messageerror",
        () => failSession(nextWorker, "KNOWLEDGE_SEARCH_NAVIGATION_WORKER_MESSAGE_ERROR")
      );
      return remote;
    })();
    creation = attempt;
    try {
      return await attempt;
    } finally {
      if (creation === attempt) creation = null;
    }
  };
  const invoke = async (operation, onRequestPosted) => {
    const api = await ensureRemote();
    if (closing || disposed) throw new Error("KNOWLEDGE_SEARCH_NAVIGATION_WORKER_DISPOSED");
    const failure = sessionFailure;
    const result = operation(api);
    onRequestPosted?.();
    return failure ? Promise.race([result, failure]) : result;
  };
  return {
    onSessionLoss(listener) {
      lossListeners.add(listener);
      return () => lossListeners.delete(listener);
    },
    initialize: () => invoke((api) => api.initialize()),
    beginRebuild: () => invoke((api) => api.beginRebuild()),
    appendRebuildPage: (rows) => invoke((api) => api.appendRebuildPage(rows)),
    commitRebuild: () => invoke((api) => api.commitRebuild()),
    abortRebuild: () => invoke((api) => api.abortRebuild()),
    beginMatch: (input, onRequestPosted) => invoke((api) => api.beginMatch(input), onRequestPosted),
    readMembershipPage: (matchId, afterIndex, limit) => invoke(
      (api) => api.readMembershipPage(matchId, afterIndex, limit)
    ),
    readRankWindow: (matchId, rankKind, start, limit, includeTitle) => invoke(
      (api) => api.readRankWindow(matchId, rankKind, start, limit, includeTitle)
    ),
    releaseMatch: (matchId) => remote ? invoke((api) => api.releaseMatch(matchId)) : Promise.resolve(),
    dispose() {
      if (disposal) return disposal;
      closing = true;
      disposal = (async () => {
        try {
          await creation?.catch(() => void 0);
          if (remote) {
            const result = remote.dispose();
            await (sessionFailure ? Promise.race([result, sessionFailure]) : result);
          }
        } finally {
          disposed = true;
          releaseSession();
          lossListeners.clear();
        }
      })();
      return disposal;
    }
  };
}
