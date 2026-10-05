# Library cover lifecycle qualification

Runs the current cover hook and native-image consumer with the exact current lifecycle tests on Node 24 + jsdom. Includes source-qualified descriptor reuse/expiry, actual-visibility admission, scrolling gates, cancellation, poster-only versus full invalidation, and src detach. The bundle includes only the bounded tested implementation and synthetic fixtures; no user data, plugin executable, or unrelated runtime is uploaded.

Native Image decoding and IntersectionObserver are controlled fixtures. This does not prove actual Obsidian behavior, browser decoder memory release, or media performance.

Run: npm install --ignore-scripts; npm test. Exact dependency versions and source hashes are in provenance.json.
