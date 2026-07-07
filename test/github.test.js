import { test } from "node:test";
import assert from "node:assert/strict";
import { GitHub, b64encode, CasConflict, stashPending, takePending } from "../js/github.js";

// minimal localStorage polyfill for node
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

test("b64encode is unicode-safe", () => {
  const s = "weight 84.6 → 80 ⚖️ रिशी";
  const decoded = Buffer.from(b64encode(s), "base64").toString("utf-8");
  assert.equal(decoded, s);
});

// A fake GitHub backend: head moves when told, serves tree/blobs, accepts
// createCommitOnBranch only when expectedHeadOid matches. With refLag > 0 the
// REST ref endpoint keeps reporting the PREVIOUS head for that many reads after
// a commit — GitHub's real read-after-write lag between GraphQL and REST.
function fakeBackend(files, { refLag = 0 } = {}) {
  const state = { head: "aaa", refHead: "aaa", lagReads: 0, files: { ...files }, commits: [] };
  const fetchFn = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    const json = (data, status = 200, headers = {}) => ({
      ok: status < 300, status,
      headers: { get: (h) => headers[h.toLowerCase()] || null },
      json: async () => data, text: async () => (typeof data === "string" ? data : JSON.stringify(data)),
    });
    if (url.endsWith("/graphql")) {
      const oid = body.variables.input.expectedHeadOid;
      if (oid !== state.head) {
        return json({ errors: [{ message: `Expected branch to point to "${state.head}" but it did not` }] });
      }
      state.commits.push(body.variables.input);
      for (const a of body.variables.input.fileChanges.additions) {
        state.files[a.path] = Buffer.from(a.contents, "base64").toString("utf-8");
      }
      for (const d of body.variables.input.fileChanges.deletions) delete state.files[d.path];
      state.head = state.head + "x";
      state.lagReads = refLag; // the REST ref now lags the true head for this many reads
      return json({ data: { createCommitOnBranch: { commit: { oid: state.head } } } });
    }
    if (/\/git\/ref\/heads\//.test(url)) {
      if (state.lagReads > 0) state.lagReads--;   // still reporting the stale head
      else state.refHead = state.head;            // caught up
      return json({ object: { sha: state.refHead } });
    }
    if (/\/git\/trees\//.test(url)) {
      // Realistic: GitHub serves a per-tree ETag and 304s a matching If-None-Match.
      const etag = "tree-" + state.head;
      if (opts.headers?.["If-None-Match"] === etag) return json(null, 304, { etag });
      return json(
        { tree: Object.keys(state.files).map((p) => ({ path: p, type: "blob", sha: "sha-" + p + "-" + state.head, size: 1 })) },
        200, { etag });
    }
    const blob = /\/git\/blobs\/sha-(.+?)-/.exec(url);
    if (blob) return json(state.files[decodeURIComponent(blob[1])] ?? "");
    return json({}, 404);
  };
  return { state, fetchFn };
}

test("commitOp: happy path commits changes + deletions atomically", async () => {
  const { state, fetchFn } = fakeBackend({ "Ledger/Metrics/weight.csv": "date,value,source,note\n" });
  const gh = new GitHub({ token: "t", fetchFn });
  await gh.commitOp(async (files) => ({
    message: "ui: log weight",
    changes: [{ path: "Ledger/Metrics/weight.csv", text: files["Ledger/Metrics/weight.csv"] + "2026-07-07,84.6,ui,\n" }],
    deletions: [],
  }), { reads: ["Ledger/Metrics/weight.csv"] });
  assert.equal(state.commits.length, 1);
  assert.match(state.files["Ledger/Metrics/weight.csv"], /84.6,ui/);
});

test("commitOp: write after a cached-tree read survives the 304 conditional path", async () => {
  // Regression: reading first primes the tree cache; the write engine then clears
  // treeCache to force a fresh read. If a stale ETag is still sent, GitHub 304s
  // the unchanged head and the read must NOT crash with "tree failed (304)".
  const { state, fetchFn } = fakeBackend({ "f.md": "base\n" });
  const gh = new GitHub({ token: "t", fetchFn });
  await gh.readFile("f.md"); // caches the tree at the current head
  await gh.commitOp(async (files) => ({
    message: "ui: append",
    changes: [{ path: "f.md", text: files["f.md"] + "line\n" }],
    deletions: [],
  }), { reads: ["f.md"] });
  assert.equal(state.commits.length, 1);
  assert.equal(state.files["f.md"], "base\nline\n");
});

test("commitOp: back-to-back writes survive REST ref read-after-write lag", async () => {
  // Regression: after write #1 moves head via GraphQL, the REST ref keeps
  // reporting the OLD head for a while. Write #2 fired right after must commit
  // against the oid write #1 returned — not the stale ref — or it self-conflicts
  // for the whole retry window (the bug that failed the second Inbox accept).
  // refLag(10) outlasts the 4 attempts, so a ref-reading engine can never win.
  const { state, fetchFn } = fakeBackend({ "a.md": "A\n", "b.md": "B\n" }, { refLag: 10 });
  const gh = new GitHub({ token: "t", fetchFn });
  await gh.commitOp(async (f) => ({
    message: "w1", changes: [{ path: "a.md", text: f["a.md"] + "1\n" }], deletions: [],
  }), { reads: ["a.md"] });
  await gh.commitOp(async (f) => ({
    message: "w2", changes: [{ path: "b.md", text: f["b.md"] + "2\n" }], deletions: [],
  }), { reads: ["b.md"] });
  assert.equal(state.commits.length, 2);
  assert.equal(state.files["a.md"], "A\n1\n"); // write #1 preserved, not clobbered
  assert.equal(state.files["b.md"], "B\n2\n"); // write #2 applied on the fresh snapshot
});

test("commitOp: CAS conflict re-reads and re-applies semantics on new base", async () => {
  const { state, fetchFn } = fakeBackend({ "f.md": "base\n" });
  const gh = new GitHub({ token: "t", fetchFn });
  let builds = 0;
  // sabotage: after the first build, another writer appends a line and moves head
  const build = async (files) => {
    builds++;
    if (builds === 1) {
      state.files["f.md"] += "other writer line\n";
      state.head = "bbb";
    }
    return { message: "ui: append", changes: [{ path: "f.md", text: files["f.md"] + "my line\n" }], deletions: [] };
  };
  await gh.commitOp(build, { reads: ["f.md"] });
  assert.equal(builds, 2); // retried with fresh read
  assert.equal(state.files["f.md"], "base\nother writer line\nmy line\n"); // both writers preserved
});

test("commitOp: journal writes are refused before any network mutation", async () => {
  const { state, fetchFn } = fakeBackend({});
  const gh = new GitHub({ token: "t", fetchFn });
  await assert.rejects(
    gh.commitOp(async () => ({
      message: "x", changes: [{ path: "Daily Journal/2026/07 (Jul)/07-Jul.md", text: "nope" }], deletions: [],
    })),
    /REFUSED/);
  assert.equal(state.commits.length, 0);
});

test("commitOp: gives up after retries exhausted", async () => {
  const { state, fetchFn } = fakeBackend({ "f.md": "base\n" });
  const gh = new GitHub({ token: "t", fetchFn });
  const build = async (files) => {
    state.head += "!"; // head moves on EVERY attempt — permanent conflict
    return { message: "x", changes: [{ path: "f.md", text: files["f.md"] + "y\n" }], deletions: [] };
  };
  await assert.rejects(gh.commitOp(build, { reads: ["f.md"], retries: 2 }), CasConflict);
});

test("pending stash survives and drains", () => {
  stashPending({ kind: "metric", path: "Ledger/Metrics/weight.csv", value: "84.6" });
  stashPending({ kind: "metric", path: "Ledger/Metrics/steps.csv", value: "10000" });
  const drained = takePending();
  assert.equal(drained.length, 2);
  assert.equal(takePending().length, 0);
});
