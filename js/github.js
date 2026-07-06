// github.js — the only file that talks to the network.
// Reads: REST (raw media type) with tree/blob caching + ETag polling.
// Writes: GraphQL createCommitOnBranch — atomic multi-file, compare-and-swap
// on expectedHeadOid, with semantic re-apply retry. Every path passes the
// journal guard. In-flight writes persist to localStorage until confirmed.

import { assertNotJournalPath } from "./model.js?v=4";

const API = "https://api.github.com";

export class AuthError extends Error {}
export class CasConflict extends Error {}

export class GitHub {
  constructor({ token, owner = "rishisareen", repo = "lifemap", branch = "main", fetchFn } = {}) {
    this.token = token;
    this.owner = owner;
    this.repo = repo;
    this.branch = branch;
    this.fetch = fetchFn || ((...a) => globalThis.fetch(...a));
    this.blobCache = new Map();   // blob sha -> text
    this.treeEtag = null;
    this.treeCache = null;        // { headOid, entries: Map(path -> {sha, size}) }
  }

  async rest(path, { method = "GET", headers = {}, body, raw = false } = {}) {
    const res = await this.fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) throw new AuthError("token rejected (401)");
    return res;
  }

  async graphql(query, variables) {
    const res = await this.fetch(`${API}/graphql`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 401) throw new AuthError("token rejected (401)");
    const data = await res.json();
    if (data.errors?.length) {
      const msg = data.errors.map((e) => e.message).join("; ");
      if (/expected branch to point|expected.*head|fast.?forward|does not match/i.test(msg)) throw new CasConflict(msg);
      throw new Error(`GraphQL: ${msg}`);
    }
    return data.data;
  }

  // ---- setup validation ----

  async validate() {
    const repo = await this.rest(`/repos/${this.owner}/${this.repo}`);
    if (repo.status === 404) return { ok: false, why: "repo not visible — token missing Contents permission or wrong repo" };
    if (!repo.ok) return { ok: false, why: `repo check failed (${repo.status})` };
    const perms = (await repo.json()).permissions || {};
    if (!perms.push) return { ok: false, why: "token is read-only — needs Contents: Read and write" };
    const runs = await this.rest(`/repos/${this.owner}/${this.repo}/actions/runs?per_page=1`);
    return { ok: true, actions: runs.ok, why: runs.ok ? "" : "Actions permission missing — workflow status & AI-draft disabled" };
  }

  // ---- reads ----

  async headOid() {
    const res = await this.rest(`/repos/${this.owner}/${this.repo}/git/ref/heads/${this.branch}`);
    if (!res.ok) throw new Error(`headOid failed (${res.status})`);
    return (await res.json()).object.sha;
  }

  // Whole-repo listing, ETag-cached: 304s are free and don't hit rate limits.
  async tree() {
    const head = await this.headOid();
    if (this.treeCache?.headOid === head) return this.treeCache;
    const res = await this.rest(
      `/repos/${this.owner}/${this.repo}/git/trees/${head}?recursive=1`,
      { headers: this.treeEtag ? { "If-None-Match": this.treeEtag } : {} });
    if (res.status === 304 && this.treeCache) return this.treeCache;
    if (!res.ok) throw new Error(`tree failed (${res.status})`);
    this.treeEtag = res.headers.get("etag");
    const entries = new Map();
    for (const e of (await res.json()).tree) {
      if (e.type === "blob") entries.set(e.path, { sha: e.sha, size: e.size });
    }
    this.treeCache = { headOid: head, entries };
    return this.treeCache;
  }

  async readFile(path) {
    const { entries } = await this.tree();
    const entry = entries.get(path);
    if (!entry) return null;
    if (this.blobCache.has(entry.sha)) return this.blobCache.get(entry.sha);
    const res = await this.rest(`/repos/${this.owner}/${this.repo}/git/blobs/${entry.sha}`, { raw: true });
    if (!res.ok) throw new Error(`read ${path} failed (${res.status})`);
    const text = await res.text();
    this.blobCache.set(entry.sha, text);
    if (this.blobCache.size > 300) this.blobCache.delete(this.blobCache.keys().next().value);
    return text;
  }

  async readFiles(paths) {
    const out = {};
    await Promise.all(paths.map(async (p) => {
      const t = await this.readFile(p);
      if (t !== null) out[p] = t;
    }));
    return out;
  }

  // ---- the write engine ----
  //
  // build(files) is the SEMANTIC operation: given fresh file texts it returns
  // { message, reads?, changes:[{path,text}], deletions:[path] }.
  // On CAS conflict we re-read and re-run build on the new base — we never
  // replay a stale tree, so concurrent writers' work is preserved.

  async commitOp(build, { reads = [], retries = 3 } = {}) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const head = await this.headOid();
      this.treeCache = null; // force fresh tree/blobs for this attempt
      const files = await this.readFiles(reads);
      const op = await build(files);
      if (!op || (!op.changes?.length && !op.deletions?.length)) return null; // nothing to do
      for (const c of op.changes || []) assertNotJournalPath(c.path);
      for (const d of op.deletions || []) assertNotJournalPath(d);
      try {
        return await this.createCommit(head, op);
      } catch (e) {
        if (e instanceof CasConflict && attempt < retries) {
          lastErr = e;
          await new Promise((r) => setTimeout(r, 300 + Math.random() * 700));
          continue;
        }
        throw e;
      }
    }
    throw lastErr;
  }

  async createCommit(expectedHeadOid, { message, changes = [], deletions = [] }) {
    const input = {
      branch: {
        repositoryNameWithOwner: `${this.owner}/${this.repo}`,
        branchName: this.branch,
      },
      expectedHeadOid,
      message: { headline: message },
      fileChanges: {
        additions: changes.map((c) => ({ path: c.path, contents: b64encode(c.text) })),
        deletions: deletions.map((path) => ({ path })),
      },
    };
    const data = await this.graphql(
      `mutation($input: CreateCommitOnBranchInput!) {
         createCommitOnBranch(input: $input) { commit { oid } } }`,
      { input });
    this.treeCache = null; // our own write invalidates the cache
    return data.createCommitOnBranch.commit.oid;
  }

  // ---- actions ----

  async dispatchWorkflow(file, inputs = {}) {
    const res = await this.rest(
      `/repos/${this.owner}/${this.repo}/actions/workflows/${file}/dispatches`,
      { method: "POST", body: { ref: this.branch, inputs } });
    if (!res.ok && res.status !== 204) throw new Error(`dispatch failed (${res.status})`);
  }

  async latestRun() {
    const res = await this.rest(`/repos/${this.owner}/${this.repo}/actions/runs?per_page=1`);
    if (!res.ok) return null;
    const run = (await res.json()).workflow_runs?.[0];
    return run ? { name: run.name, status: run.status, conclusion: run.conclusion, at: run.updated_at } : null;
  }

  async recentCommits(n = 15) {
    const res = await this.rest(`/repos/${this.owner}/${this.repo}/commits?per_page=${n}`);
    if (!res.ok) return [];
    return (await res.json()).map((c) => ({
      message: c.commit.message.split("\n")[0],
      at: c.commit.committer.date,
    }));
  }
}

export function b64encode(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

// ---- pending-write persistence (survives 401/network loss/reload) ----

const PENDING_KEY = "lifemap.pending";

export function stashPending(op) {
  const all = JSON.parse(localStorage.getItem(PENDING_KEY) || "[]");
  all.push({ ...op, stashedAt: Date.now() });
  localStorage.setItem(PENDING_KEY, JSON.stringify(all));
}

export function takePending() {
  const all = JSON.parse(localStorage.getItem(PENDING_KEY) || "[]");
  localStorage.removeItem(PENDING_KEY);
  return all;
}

export function peekPending() {
  return JSON.parse(localStorage.getItem(PENDING_KEY) || "[]");
}
