import { test } from "node:test";
import assert from "node:assert/strict";
import * as M from "../js/model.js";

const P_METRIC = M.parseProposal("Ledger/Inbox/2026-07-07-metric-weight.md",
  '---\nid: aaa111aaa111\njournal_date: 2026-07-07\ntype: metric\ntarget: weight\npayload_date: 2026-07-07\npayload_value: "84.6"\n---\n**Evidence:** "weighed 84.6"');

const P_LOG = M.parseProposal("Ledger/Inbox/2026-07-07-log-training.md",
  '---\nid: bbb222bbb222\njournal_date: 2026-07-07\ntype: log\ntarget: resume-training-cut-80kg\npayload_date: 2026-07-07\npayload_text: "Physio cleared rehab set"\n---\nev');

const P_METRIC2 = M.parseProposal("Ledger/Inbox/2026-07-06-metric-weight.md",
  '---\nid: ccc333ccc333\njournal_date: 2026-07-07\ntype: metric\ntarget: weight\npayload_date: 2026-07-06\npayload_value: "84.9"\n---\nev');

const FILES = {
  "Ledger/Inbox/2026-07-07-metric-weight.md": "x",
  "Ledger/Inbox/2026-07-07-log-training.md": "x",
  "Ledger/Inbox/2026-07-06-metric-weight.md": "x",
  "Ledger/Inbox/_processed.md": "- baseline 2026-07-05\n",
  "Ledger/Metrics/weight.csv": "date,value,source,note\n2026-07-01,85,q3-review,\n",
  "Ledger/Commitments/resume-training-cut-80kg.md": "---\nid: resume-training-cut-80kg\nstate: active\n---\n\n## Log\n\n- 2026-07-06 — filed\n",
};

test("buildInboxCommit: accept metric+log = ONE op touching targets, _processed, deletions", () => {
  const op = M.buildInboxCommit(
    [{ proposal: P_METRIC, action: "accept" }, { proposal: P_LOG, action: "accept" }],
    FILES, "2026-07-08");
  assert.equal(op.applied.length, 2);
  const paths = op.changes.map((c) => c.path).sort();
  assert.deepEqual(paths, [
    "Ledger/Commitments/resume-training-cut-80kg.md",
    "Ledger/Inbox/_processed.md",
    "Ledger/Metrics/weight.csv",
  ]);
  assert.deepEqual(op.deletions.sort(), [
    "Ledger/Inbox/2026-07-07-log-training.md",
    "Ledger/Inbox/2026-07-07-metric-weight.md",
  ]);
  const processed = op.changes.find((c) => c.path.endsWith("_processed.md")).text;
  assert.match(processed, /- applied aaa111aaa111 — 2026-07-08/);
  assert.match(processed, /- applied bbb222bbb222 — 2026-07-08/);
  assert.match(processed, /^- baseline 2026-07-05/m); // append-only: old content kept
  const log = op.changes.find((c) => c.path.includes("Commitments")).text;
  assert.ok(log.indexOf("Physio cleared") < log.indexOf("filed"), "newest first");
  assert.match(op.message, /applied 2/);
});

test("buildInboxCommit: two proposals on the SAME csv stack sequentially", () => {
  const op = M.buildInboxCommit(
    [{ proposal: P_METRIC, action: "accept" }, { proposal: P_METRIC2, action: "accept" }],
    FILES, "2026-07-08");
  const csv = op.changes.find((c) => c.path.endsWith("weight.csv")).text;
  assert.match(csv, /2026-07-07,84.6,clerk,/);
  assert.match(csv, /2026-07-06,84.9,clerk,/);
  assert.equal(op.changes.filter((c) => c.path.endsWith("weight.csv")).length, 1);
});

test("buildInboxCommit: reject only records + deletes", () => {
  const op = M.buildInboxCommit([{ proposal: P_LOG, action: "reject" }], FILES, "2026-07-08");
  assert.equal(op.changes.length, 1); // just _processed.md
  assert.match(op.changes[0].text, /- rejected bbb222bbb222 — 2026-07-08/);
  assert.deepEqual(op.deletions, ["Ledger/Inbox/2026-07-07-log-training.md"]);
});

test("buildInboxCommit: double-tap → proposal file already gone → null (no commit)", () => {
  const files = { ...FILES };
  delete files["Ledger/Inbox/2026-07-07-metric-weight.md"];
  const op = M.buildInboxCommit([{ proposal: P_METRIC, action: "accept" }], files, "2026-07-08");
  assert.equal(op, null);
});

test("buildInboxCommit: stale target skipped gracefully, healthy ones proceed", () => {
  const files = { ...FILES };
  delete files["Ledger/Commitments/resume-training-cut-80kg.md"]; // archived meanwhile
  const op = M.buildInboxCommit(
    [{ proposal: P_LOG, action: "accept" }, { proposal: P_METRIC, action: "accept" }],
    files, "2026-07-08");
  assert.equal(op.applied.length, 1);
  assert.equal(op.stale.length, 1);
  assert.match(op.stale[0].reason, /stale/);
  assert.ok(!op.deletions.includes(P_LOG.path), "stale proposal is NOT deleted");
  assert.ok(op.deletions.includes(P_METRIC.path));
});

test("proposalSummary renders a human line per type", () => {
  assert.match(M.proposalSummary(P_METRIC), /weight.*84\.6.*2026-07-07/);
  assert.match(M.proposalSummary(P_LOG), /resume-training-cut-80kg/);
});
