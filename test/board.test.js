import { test } from "node:test";
import assert from "node:assert/strict";
import * as M from "../js/model.js";

const IDEA = `---
id: learn-woodworking
title: "Learn woodworking at the Gurgaon studio"
pillar: joy
horizon: idea
is_rock: false
state: idea
captured_on: 2026-07-05
carry_count: 0
forcing_function: ""
---

*Captured from journal.*
`;

const ACTIVE = `---
id: bihar-trip-mom
title: Bihar/Deoghar trip with Mom
pillar: relationships
is_rock: true
state: active
carry_count: 6
gate_date: 2026-07-07
review_by: 2026-07-12
forcing_function: "Payment confirmation by Tue"
---

## Log

- 2026-07-06 — filed
`;

// ---- column bucketing ----

test("boardColumn maps state to the four columns", () => {
  assert.equal(M.boardColumn({ state: "idea" }), "ideas");
  assert.equal(M.boardColumn({ state: "committed" }), "committed");
  assert.equal(M.boardColumn({ state: "active" }), "active");
  assert.equal(M.boardColumn({ state: "blocked" }), "active"); // blocked shows in active w/ flag
  assert.equal(M.boardColumn({ state: "done" }), "closed");
  assert.equal(M.boardColumn({ state: "retired" }), "closed");
});

// ---- idea -> committed (needs a gate) ----

test("commitIdea sets state+committed_on+gate_date and logs", () => {
  const t = M.transition(IDEA, { to: "committed", gate: "2026-09-01", today: "2026-07-06" });
  const fm = M.parseFrontmatter(t.text);
  assert.equal(fm.state, "committed");
  assert.equal(fm.gate_date, "2026-09-01");
  assert.equal(fm.committed_on, "2026-07-06");
  assert.match(t.text, /## Log\n\n- 2026-07-06 — Committed \(gate 2026-09-01\)/);
});

test("commitIdea without a gate is refused (OS-Manual rule 1)", () => {
  assert.throws(() => M.transition(IDEA, { to: "committed", gate: "", today: "2026-07-06" }), /gate/i);
});

// ---- -> active ----

test("activate is free (no gate required)", () => {
  const committed = M.setFrontmatterField(IDEA, "state", "committed");
  const t = M.transition(committed, { to: "active", today: "2026-07-06" });
  assert.equal(M.parseFrontmatter(t.text).state, "active");
});

// ---- -> closed (done | retired) ----

test("close as done sets closed_on + reason + log line", () => {
  const t = M.transition(ACTIVE, { to: "closed", disposition: "done", today: "2026-07-20" });
  const fm = M.parseFrontmatter(t.text);
  assert.equal(fm.state, "done");
  assert.equal(fm.closed_on, "2026-07-20");
  assert.match(t.text, /- 2026-07-20 — Done\./);
});

test("close as retired requires a reason and logs it", () => {
  assert.throws(() => M.transition(ACTIVE, { to: "closed", disposition: "retired", reason: "", today: "2026-07-20" }), /reason/i);
  const t = M.transition(ACTIVE, { to: "closed", disposition: "retired", reason: "Too much on; joy comes via people", today: "2026-07-20" });
  assert.equal(M.parseFrontmatter(t.text).state, "retired");
  assert.match(t.text, /- 2026-07-20 — Retired: Too much on; joy comes via people/);
});

// ---- reschedule (action, not a column) ----

test("reschedule bumps carry, sets new gate, keeps state active, logs", () => {
  const t = M.reschedule(ACTIVE, { gate: "2026-08-15", today: "2026-07-20", note: "Mom travel pushed it" });
  const fm = M.parseFrontmatter(t.text);
  assert.equal(fm.state, "active");
  assert.equal(fm.carry_count, "7");
  assert.equal(fm.gate_date, "2026-08-15");
  assert.match(t.text, /- 2026-07-20 — Rescheduled to 2026-08-15 \(carry #7\): Mom travel pushed it/);
});

test("reschedule requires a new gate", () => {
  assert.throws(() => M.reschedule(ACTIVE, { gate: "", today: "2026-07-20" }), /gate/i);
});

// ---- rock budget enforced at drag time ----

test("rockBudgetBlocks: promoting a 4th rock into active is blocked", () => {
  const rocks = [{ isRock: true, state: "active" }, { isRock: true, state: "active" }, { isRock: true, state: "active" }];
  const card = { isRock: true, state: "committed" };
  assert.equal(M.rockBudgetBlocks(card, "active", rocks), true);
  assert.equal(M.rockBudgetBlocks({ isRock: false, state: "committed" }, "active", rocks), false); // non-rock ok
  assert.equal(M.rockBudgetBlocks(card, "closed", rocks), false); // closing is always ok
});

test("rockBudgetBlocks: a rock already active moving within active is fine", () => {
  const card = { id: "a", isRock: true, state: "active" };
  const rocks = [card, { id: "b", isRock: true, state: "active" }, { id: "c", isRock: true, state: "active" }];
  assert.equal(M.rockBudgetBlocks(card, "active", rocks), false); // already counted
});

// ---- + Idea capture ----

test("newIdeaFile builds a valid idea commitment with a unique slug", () => {
  const existing = new Set(["Ledger/Commitments/learn-pottery.md"]);
  const { path, text } = M.newIdeaFile("Learn woodworking at the studio", "joy", "2026-07-06", existing);
  assert.equal(path, "Ledger/Commitments/learn-woodworking-at-the-studio.md");
  const fm = M.parseFrontmatter(text);
  assert.equal(fm.state, "idea");
  assert.equal(fm.pillar, "joy");
  assert.equal(fm.carry_count, "0");
});

test("newIdeaFile auto-suffixes on slug collision", () => {
  const existing = new Set(["Ledger/Commitments/learn-woodworking-at-the-studio.md"]);
  const { path } = M.newIdeaFile("Learn woodworking at the studio", "joy", "2026-07-06", existing);
  assert.equal(path, "Ledger/Commitments/learn-woodworking-at-the-studio-2.md");
});
