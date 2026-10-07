class DatabasePortError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
async function acquireWorkerUrl(options) {
  options.signal?.throwIfAborted();
  let source = await options.loadWorkerSource();
  try {
    options.signal?.throwIfAborted();
    if (!source.trim())
      throw new DatabasePortError("DATABASE_WORKER_SOURCE_EMPTY", "loadWorkerSource");
    return URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  } finally {
    source = "";
  }
}
module.exports = acquireWorkerUrl;
