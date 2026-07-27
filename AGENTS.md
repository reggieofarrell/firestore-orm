# AGENTS.md

`@reggieofarrell/firestore-orm` is a **TypeScript library** (published to npm) — a type-safe
Firestore ORM for the Firebase Admin SDK. There is no long-running application server; "running it"
means building the library and exercising it against the local **Firestore emulator**. For project
conventions, testing policy, and coding standards see `CLAUDE.md`, `README.md`, and
`docs/development/testing.md`.

## Cursor Cloud specific instructions

These are non-obvious environment caveats for this repo. The startup update script already runs
`npm install`; everything below is about _running_ the toolchain, not installing it.

### Node version — must be 24, and a shim shadows it

- The repo pins **Node 24** (`.nvmrc`) and the Husky hooks (`pre-commit`, `pre-push`, `commit-msg`)
  hard-fail on any other major via `scripts/check-node-version.sh`. CI uses the same pin.
- Node 24 is installed via `nvm`, **but `/exec-daemon/node` (Node 22) is earlier in `PATH` and wins
  by default**, so a bare `node` reports v22 and would break commits/pushes. `nvm use` does **not**
  fix this (the shim is re-prepended each shell).
- Before running git commits/pushes, the coverage gates, or anything that must match CI, prepend the
  nvm Node 24 bin to `PATH` in that shell:

  ```bash
  export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
  node --version   # v24.x
  ```

  (Everyday build/lint/unit-test commands also run fine under the default Node 22, since
  `engines.node` is `>=22`; Node 24 is what the git hooks and CI require.)

### Firestore emulator (integration tests)

- Java (JDK 21) is already available, which the Firestore emulator requires.
- `npm run test:integration:emulator` (and `test:integration:coverage`) auto-start/stop the emulator
  via `firebase emulators:exec` — no separate emulator process or Firebase login/credentials needed
  (it uses the demo project `demo-firestoreorm-test` on `127.0.0.1:8080`).
- Repeated `MetadataLookupWarning: ... code = UNKNOWN` lines during integration runs are
  **harmless** — the Admin SDK probing the (absent) GCE metadata server while in emulator mode.
- `npm run test:unit` uses mocks only: no Java or emulator required.

### Verifying the environment end-to-end

Full gate matches CI: `npm run lint`, `npm run check:format`, `npm run test:types`, `npm run build`,
`npm run test:unit`, and `npm run test:integration:emulator` all pass. The library itself is
exercised through the emulator-backed integration suite (create/read/query/update/hooks against real
Firestore).
