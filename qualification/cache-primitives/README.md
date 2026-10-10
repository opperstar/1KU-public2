# Cache primitives qualification

Isolated synthetic tests of cacache and lru-cache public APIs. No production source, user files, browser cache, native addons or runtime services.

Run `npm ci --ignore-scripts --no-audit --no-fund` and `npm test` with Node 24.18.0. The test creates a private OS temporary directory, starts two temporary child processes, and removes only its own directory after they exit. Dependency tarball integrity was checked against registry.npmjs.org metadata.

Checks cover publication, fresh-process reads, immutable versions, checksum validation, two-process writes, retirement, offline verification, declared byte cost and disposal. The 12-byte LRU budget is a semantic fixture, not a production memory policy.

Expected limitations are asserted and recorded as `gaps`: offline verify ignores already delivered file paths; writing identical valid bytes does not repair an existing corrupt immutable target; LRU does not pin active consumers. Successful CI means these facts reproduce, not that a thumbnail application or native browser memory has been optimized.
