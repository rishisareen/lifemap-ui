import { test } from "node:test";
import assert from "node:assert/strict";
import * as M from "../js/model.js";

const COMMITMENT = `---
id: bihar-trip-mom
title: Bihar/Deoghar trip with Mom — taken, not planned
pillar: relationships
horizon: 2026-Q3
is_rock: true
state: active
committed_on: 2026-01-15
carry_count: 6
gate_date: 2026-07-07
forcing_function: "Payment confirmation (tickets booked) by Tue Jul 7."
success_criteria: "Trip taken with Mom, 3rd week of July 2026."
review_by: 2026-07-12
---

**Constraint (hard):** example constraint line.

## Plan (milestones)

- [ ] Call Mom, lock dates (Mon Jul 6)
- [ ] Book tickets — payment confirmation in inbox (Tue Jul 7)

## Log

- 2026-07-06 — Filed at Phase 0.
`;

test("frontmatter parses like the python compiler", () => {
  const c = M.parseCommitment(COMMITMENT);
  assert.equal(c.id, "bihar-trip-mom");
  assert.equal(c.isRock, true);
  assert.equal(c.carryCount, 6);
  assert.equal(c.gateDate, "2026-07-07");
  assert.equal(c.forcingFunction, "Payment confirmation (tickets booked) by Tue Jul 7.");
  assert.equal(c.constraints.length, 1);
});

test("setFrontmatterField replaces and inserts", () => {
  let t = M.setFrontmatterField(COMMITMENT, "state", "done");
  assert.match(t, /^state: done$/m);
  t = M.setFrontmatterField(t, "closed_on", "2026-07-20");
  assert.match(t, /^closed_on: 2026-07-20$/m);
  assert.equal(M.parseFrontmatter(t).id, "bihar-trip-mom"); // rest intact
});

test("appendLogLine inserts newest-first under ## Log", () => {
  const t = M.appendLogLine(COMMITMENT, "- 2026-07-07 — Tickets BOOKED.");
  const log = t.slice(t.indexOf("## Log"));
  assert.ok(log.indexOf("Tickets BOOKED") < log.indexOf("Filed at Phase 0"));
});

test("checkMilestone ticks the right box; null when absent", () => {
  const t = M.checkMilestone(COMMITMENT, "Book tickets — payment confirmation");
  assert.match(t, /- \[x\] Book tickets/);
  assert.match(t, /- \[ \] Call Mom/); // untouched
  assert.equal(M.checkMilestone(COMMITMENT, "does not exist"), null);
});

test("CSV: quoted fields, append, upsert by (date,source), latest by date", () => {
  const base = 'date,value,source,note\n2026-07-05,84.5,ui,"note, with comma"\n2026-07-01,85,q3-review,\n';
  const { rows } = M.parseCSV(base);
  assert.equal(rows[0].note, "note, with comma");
  assert.equal(M.latestMetric(rows).value, "84.5"); // by date not position

  const appended = M.csvAppend(base, { date: "2026-07-06", value: "84.2", source: "ui", note: "" });
  assert.match(appended, /2026-07-06,84.2,ui,\n$/);

  const upserted = M.csvUpsert(appended, { date: "2026-07-06", value: "84.4", source: "ui", note: "fix" });
  const rows2 = M.parseCSV(upserted).rows.filter((r) => r.date === "2026-07-06");
  assert.equal(rows2.length, 1);
  assert.equal(rows2[0].value, "84.4");
});

test("metric validation ranges", () => {
  assert.equal(M.validateMetric("weight", "84.5"), null);
  assert.match(M.validateMetric("weight", "850"), /outside plausible range/);
  assert.match(M.validateMetric("steps", "abc"), /not a number/);
});

test("ISO week math incl. year boundaries", () => {
  assert.deepEqual(M.isoWeek("2026-07-06"), { year: 2026, week: 28 });
  assert.deepEqual(M.isoWeek("2026-01-01"), { year: 2026, week: 1 });
  assert.deepEqual(M.isoWeek("2024-12-30"), { year: 2025, week: 1 }); // Monday of 2025-W1
  assert.deepEqual(M.isoWeek("2027-01-01"), { year: 2026, week: 53 }); // Friday of 2026-W53
  assert.equal(M.weeklyPlanPath({ year: 2026, week: 8 }), "Weekly Plan/2026/2026 - Weekly Plan - W08.md");
});

test("journal path convention matches the vault", () => {
  assert.equal(M.journalPath("2026-07-06"), "Daily Journal/2026/07 (Jul)/06-Jul.md");
});

test("MIT line parsing — W28 real format and template format", () => {
  const w28 = "- [ ] **Mon Jul 6** — (1) Call Mom, lock Bihar dates. (2) Swim / walk (back-safe). (3) Office to steady state.";
  assert.deepEqual(M.todaysMits(w28, "2026-07-06"),
    ["Call Mom, lock Bihar dates", "Swim / walk (back-safe)", "Office to steady state"]);
  const tpl = "- [ ] Mon — single item here";
  assert.deepEqual(M.todaysMits(tpl, "2026-07-06"), ["single item here"]);
  assert.deepEqual(M.todaysMits(w28, "2026-07-07"), []); // Tuesday: no line
});

test("planAccept: metric goes to CSV as clerk row", () => {
  const p = M.parseProposal("Ledger/Inbox/x.md",
    '---\nid: abc123def456\ntype: metric\njournal_date: 2026-07-07\ntarget: weight\npayload_date: 2026-07-07\npayload_value: "84.6"\n---\nev');
  const plan = M.planAccept(p, { "Ledger/Metrics/weight.csv": "date,value,source,note\n" }, "2026-07-07");
  assert.equal(plan.changes[0].path, "Ledger/Metrics/weight.csv");
  assert.match(plan.changes[0].text, /2026-07-07,84.6,clerk,/);
  assert.deepEqual(plan.deletions, ["Ledger/Inbox/x.md"]);
  assert.equal(plan.processedLine, "- applied abc123def456 — 2026-07-07");
});

test("planAccept: stale target throws, does not write", () => {
  const p = M.parseProposal("Ledger/Inbox/x.md",
    "---\nid: abc\ntype: log\ntarget: gone-commitment\npayload_date: 2026-07-07\npayload_text: hi\n---\n");
  assert.throws(() => M.planAccept(p, {}, "2026-07-07"), /stale/);
});

test("planAccept: idea creates idea-state commitment, never committed", () => {
  const p = M.parseProposal("Ledger/Inbox/x.md",
    '---\nid: abc\ntype: idea\njournal_date: 2026-07-07\npayload_text: "Learn woodworking at the Gurgaon studio sometime"\npillar: joy\n---\n');
  const plan = M.planAccept(p, {}, "2026-07-07");
  assert.match(plan.changes[0].path, /^Ledger\/Commitments\/learn-woodworking/);
  assert.match(plan.changes[0].text, /^state: idea$/m);
});

test("planReject only deletes + records", () => {
  const p = M.parseProposal("Ledger/Inbox/x.md", "---\nid: abc\ntype: lesson\n---\n");
  const plan = M.planReject(p, "2026-07-07");
  assert.equal(plan.changes.length, 0);
  assert.equal(plan.processedLine, "- rejected abc — 2026-07-07");
});

test("commit classification for the header", () => {
  assert.equal(M.classifyCommit("sync: 2026-07-06 18:33"), "bridge");
  assert.equal(M.classifyCommit("lifemap: compile + clerk [skip ci]"), "actions");
  assert.equal(M.classifyCommit("ui: log weight 84.6"), "ui");
  assert.equal(M.classifyCommit("Phase A (data contracts)"), "manual");
});

test("journal guard refuses journal writes", () => {
  assert.throws(() => M.assertNotJournalPath("Daily Journal/2026/07 (Jul)/06-Jul.md"), /REFUSED/);
  assert.equal(M.assertNotJournalPath("Ledger/Metrics/weight.csv"), "Ledger/Metrics/weight.csv");
});
