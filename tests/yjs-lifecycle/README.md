# Yjs lifecycle production revalidation

`current.cjs` is the frozen actual pre-cutover Provider baseline. `candidate.cjs` now contains the actual approved production Provider and the complete artifact from the canonical Build producer, with no virtual source replacement.

Run `node --expose-gc lifetime.cjs current` and `node --expose-gc lifetime.cjs candidate` in separate children. Both preserve same-version constructor identity, original update/convergence/duplicate/cold-rebuild/invalid-byte/version-fence contracts and native document/observer cleanup. The baseline reproduces a retained synthetic Host business object; production must retain none over 30 generations.

Node CI only; original Main/C01 tests and Obsidian Host are separately verified on Windows. No whole-App memory benefit is inferred; independent Redux retention remains. See provenance.json.
