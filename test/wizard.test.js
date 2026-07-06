import { test } from "node:test";
import assert from "node:assert/strict";
import * as M from "../js/model.js";

// ---- week targeting ----

test("mondayOfISOWeek matches known weeks", () => {
  assert.equal(M.mondayOfISOWeek({ year: 2026, week: 28 }), "2026-07-06");
  assert.equal(M.mondayOfISOWeek({ year: 2026, week: 29 }), "2026-07-13");
  assert.equal(M.mondayOfISOWeek({ year: 2026, week: 1 }), "2025-12-29"); // ISO W1 Monday
  assert.equal(M.mondayOfISOWeek({ year: 2027, week: 1 }), "2027-01-04");
});

test("reviewTargetWeek: Fri–Sun plans next week, Mon–Thu the current week", () => {
  assert.deepEqual(M.reviewTargetWeek("2026-07-06"), { year: 2026, week: 28 }); // Mon
  assert.deepEqual(M.reviewTargetWeek("2026-07-09"), { year: 2026, week: 28 }); // Thu
  assert.deepEqual(M.reviewTargetWeek("2026-07-10"), { year: 2026, week: 29 }); // Fri -> next
  assert.deepEqual(M.reviewTargetWeek("2026-07-12"), { year: 2026, week: 29 }); // Sun -> next
  assert.deepEqual(M.reviewTargetWeek("2026-12-31"), { year: 2026, week: 53 }); // Thu -> W53
  assert.deepEqual(M.reviewTargetWeek("2027-01-01"), { year: 2027, week: 1 });  // Fri -> next year W1
});

test("draft and final paths for a target week", () => {
  const w = { year: 2026, week: 29 };
  assert.equal(M.weeklyDraftPath(w), "Plans/_drafts/2026 - Weekly Plan - W29.md");
  assert.equal(M.weeklyFinalPath(w), "Weekly Plan/2026/2026 - Weekly Plan - W29.md");
});

test("windowLabel spans Monday to Sunday", () => {
  assert.equal(M.windowLabel("2026-07-13"), "Jul 13 → Jul 19");
});

// ---- build / parse round-trip (Mac-switch resume) ----

const STATE = {
  target: { year: 2026, week: 29 },
  rocks: ["bihar-trip-mom", "resume-training-cut-80kg"],
  celebrate: ["[relations] Full house — warm and awesome", "[office] Inbox back under control"],
  misses: ["[relations] Bihar still unbooked — carry 6"],
  outcomes: ["[relations] Bihar tickets BOOKED by Tue", "[wellness] Physio clearance Wed"],
  mits: { Mon: "Call Mom", Tue: "Book Bihar tickets", Wed: "Physio 2pm", Thu: "", Fri: "", Sat: "", Sun: "Weekly review" },
  theme: "Book it, park it, be present",
  truth: "You've booked Bihar in your head six times.",
};

test("buildWeeklyPlan emits parseable MIT lines and correct frontmatter", () => {
  const md = M.buildWeeklyPlan(STATE, "committed");
  const fm = M.parseFrontmatter(md);
  assert.equal(fm.week, "2026-W29");
  assert.equal(fm.status, "committed");
  // the compiler's todaysMits must find Monday's line
  assert.deepEqual(M.todaysMits(md, "2026-07-13"), ["Call Mom"]);
  assert.deepEqual(M.todaysMits(md, "2026-07-15"), ["Physio 2pm"]);
  assert.deepEqual(M.todaysMits(md, "2026-07-16"), []); // Thu empty
  assert.match(md, /## 🎯 Theme/);
  assert.match(md, /Book it, park it, be present/);
});

test("parseWeeklyPlan round-trips buildWeeklyPlan exactly", () => {
  const md = M.buildWeeklyPlan(STATE, "draft");
  const back = M.parseWeeklyPlan(md);
  assert.deepEqual(back.celebrate, STATE.celebrate);
  assert.deepEqual(back.misses, STATE.misses);
  assert.deepEqual(back.outcomes, STATE.outcomes);
  assert.deepEqual(back.mits, STATE.mits);
  assert.equal(back.theme, STATE.theme);
  assert.equal(back.truth, STATE.truth);
  assert.deepEqual(back.rocks, STATE.rocks);
  assert.deepEqual(back.target, STATE.target);
});

test("parseWeeklyPlan tolerates empty sections", () => {
  const empty = { ...STATE, celebrate: [], misses: [], outcomes: [], theme: "", truth: "",
    mits: { Mon: "", Tue: "", Wed: "", Thu: "", Fri: "", Sat: "", Sun: "" } };
  const back = M.parseWeeklyPlan(M.buildWeeklyPlan(empty, "draft"));
  assert.deepEqual(back.celebrate, []);
  assert.equal(back.theme, "");
  assert.deepEqual(back.mits, empty.mits);
});

// ---- commit assembly (plan + carry decisions, atomic) ----

const CARRY_FILE = `---
id: bihar-trip-mom
title: Bihar trip
state: active
carry_count: 6
gate_date: 2026-07-07
---

## Log

- 2026-07-06 — filed
`;

test("buildWeeklyCommit: final plan + delete draft + carry decisions in ONE op", () => {
  const files = { "Ledger/Commitments/bihar-trip-mom.md": CARRY_FILE };
  const decisions = [
    { id: "bihar-trip-mom", action: "reschedule", gate: "2026-07-20", note: "Mom travel" },
  ];
  const op = M.buildWeeklyCommit(STATE, decisions, files, "2026-07-12");
  const paths = op.changes.map((c) => c.path).sort();
  assert.deepEqual(paths, [
    "Ledger/Commitments/bihar-trip-mom.md",
    "Weekly Plan/2026/2026 - Weekly Plan - W29.md",
  ]);
  assert.deepEqual(op.deletions, ["Plans/_drafts/2026 - Weekly Plan - W29.md"]);
  const plan = op.changes.find((c) => c.path.startsWith("Weekly Plan"));
  assert.match(plan.text, /status: committed/);
  const bihar = op.changes.find((c) => c.path.includes("Commitments"));
  assert.match(bihar.text, /carry_count: 7/);
  assert.match(bihar.text, /Rescheduled to 2026-07-20/);
});

test("buildWeeklyCommit: retire decision writes state + reason", () => {
  const files = { "Ledger/Commitments/bihar-trip-mom.md": CARRY_FILE };
  const op = M.buildWeeklyCommit(STATE, [{ id: "bihar-trip-mom", action: "retire", reason: "no longer relevant" }], files, "2026-07-12");
  const bihar = op.changes.find((c) => c.path.includes("Commitments"));
  assert.match(bihar.text, /state: retired/);
  assert.match(bihar.text, /Retired: no longer relevant/);
});

test("buildWeeklyDraft: single-file draft write, status draft, no deletions", () => {
  const op = M.buildWeeklyDraft(STATE);
  assert.equal(op.changes.length, 1);
  assert.equal(op.changes[0].path, "Plans/_drafts/2026 - Weekly Plan - W29.md");
  assert.match(op.changes[0].text, /status: draft/);
  assert.deepEqual(op.deletions, []);
});
