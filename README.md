# lifemap-ui

Static planning UI for a private LifeMap repo. **This repo contains code only — no personal data, ever.**

- Vanilla HTML/JS/CSS, no build step, no dependencies, no third-party scripts.
- In the browser it talks directly to the private data repo via the GitHub API,
  authenticated by a fine-grained PAT the user pastes once (localStorage).
- All writes go through GraphQL `createCommitOnBranch` — atomic multi-file commits
  with compare-and-swap and semantic retry (`js/github.js`).
- All parsing/derivation logic is pure and tested (`js/model.js`, `node --test`).
- `js/model.js` mirrors the data repo's `_System/bin/lifemap_compile.py` parsing rules —
  change them together.

Hosted via GitHub Pages. Design/plan: `docs/plans/2026-07-06-001-feat-lifemap-ui-plan.md`
in the data repo.

## Deploying

Run `./release.sh` before committing a deploy. It bumps `.version` and stamps
`?v=N` onto every internal module URL (static + dynamic imports, entrypoint,
CSS), so a GitHub Pages deploy's module graph is always self-consistent — no
window where a fresh `main.js` loads a stale cached `model.js`. `node --test`
resolves the query strings transparently.
