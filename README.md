# lifemap-ui

Static planning UI for a private **LifeMap OS** data repo. **This repo contains code only — no personal data, ever.**

Deployed: **https://rishisareen.com/lifemap-ui/** · Data repo: `rishisareen/lifemap` (private) · Full project handoff lives in the data repo at `HANDOFF.md`.

## What it is

- Vanilla HTML/JS/CSS ES modules. **No build step, no dependencies, no third-party scripts.**
- In the browser it talks directly to the private data repo via the GitHub API, authenticated by a fine-grained PAT the user pastes once (localStorage). Auth choice is deliberate: OAuth device flow can't work from a pure browser (CORS), so a single-repo fine-grained PAT is correct.
- **Writes** = GraphQL `createCommitOnBranch` — atomic multi-file commits with compare-and-swap + semantic retry, so the UI, GitHub Actions, and the Mac git-bridge never clobber each other.
- **Reads** derive live state client-side from raw repo files (the compiled `state.json` is treated as Clerk-only and can be stale).
- Security: strict CSP (`connect-src` limited to api.github.com), `textContent`-only rendering, a code-level journal-path write guard (the PAT can't scope by path, so "machines never write the journal" is enforced here).

## File map (`js/`)

| File | Role |
|---|---|
| `model.js` | **All pure logic**, fully unit-tested. Mirrors the data repo's `_System/bin/lifemap_compile.py` parsing rules — **change the two together.** |
| `github.js` | The only networked module: cached reads, the atomic write engine, journal guard, pending-write stash. |
| `setup.js` | Token capture + validation (Contents push + Actions probe); re-auth preserves in-flight work. |
| `today.js` / `inbox.js` / `board.js` / `wizard.js` / `horizons.js` | The five screens (Today, Inbox, Board, Review, Horizons). |
| `main.js` | Router + header status. |
| `fixtures.js` | `?demo=1` fake backend with realistic data — the app runs tokenless for dev + screenshots. |

## Develop

```bash
node --test          # run the suite (currently 103 tests)
# preview: serve this dir on any static server and open ?demo=1  (no token, no network)
```

`model.js` is the correctness core — logic changes should be test-first there. Screens are thin DOM over tested builders.

## Deploy

**Run `./release.sh` before committing a deploy.** It bumps `.version` and stamps `?v=N` onto every internal module URL (imports, entrypoint, CSS), so a GitHub Pages deploy's module graph is always self-consistent — no window where a fresh `main.js` loads a stale cached `model.js` (Pages caches modules for 10 min; unversioned ES imports were a real staleness bug). `node --test` resolves the query strings transparently. Push to `main` → `pages.yml` deploys automatically.

## Status

Units 1–8 of the plan are shipped (Today, Inbox, Board, Review + AI drafting). Remaining: Unit 9 (Trends), Unit 10 (monthly/quarterly review modes). See `docs/plans/2026-07-06-001-feat-lifemap-ui-plan.md` in the data repo.
