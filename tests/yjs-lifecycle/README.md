# Yjs lifecycle qualification

Run `node --expose-gc lifetime.cjs current` and `node --expose-gc lifetime.cjs candidate` in separate children. The current actual Provider must reproduce a retained synthetic old Host business object. The candidate must reuse one same-version Yjs constructor identity while retaining no synthetic old business object. Both must release destroyed documents and detached observers, preserve raw update/state-vector semantics, reject version mismatch and preserve portable convergence/duplicate/cold-rebuild/invalid-byte behavior.

The candidate executes the complete trusted official dependency through the same native Node primitive previously qualified for Watchpack. It does not compile App code or change sync semantics. Qualification only; production is unchanged. See provenance.json for scope and limitations.
