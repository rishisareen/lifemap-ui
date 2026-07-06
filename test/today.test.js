import { test } from "node:test";
import assert from "node:assert/strict";
import * as M from "../js/model.js";

const HABITS = `# Habits — definitions & status

## Active daily floors (the non-negotiables)

| habit | floor | full version | pillar | tracked in | extraction hint (for the Clerk) |
|---|---|---|---|---|---|
| evening-journal | 1 line, every night | full evening reflection | mind | journal itself — presence of any Evening text | text after "Evening" heading |
| steps-10k | 10,000 steps | — | wellness | \`Metrics/steps.csv\` | "steps", "walked", "10k" |
| protein-floor | ≥150 g | — | wellness | \`Metrics/protein.csv\` | "protein" |
| no-phone-first-hour | phone untouched for the first hour | + 20-min "do nothing" sit | mind | journal mentions (no CSV yet) | "phone", "first hour" |

## Retired
`;

test("parseFloors mirrors the compiler's active_floors", () => {
  const floors = M.parseFloors(HABITS);
  assert.equal(floors.length, 4);
  assert.deepEqual(floors.map((f) => f.habit),
    ["evening-journal", "steps-10k", "protein-floor", "no-phone-first-hour"]);
  assert.equal(floors[1].floor, "10,000 steps");
});

test("floorKind classifies loggable vs status floors", () => {
  assert.equal(M.floorKind({ habit: "steps-10k" }), "steps");
  assert.equal(M.floorKind({ habit: "protein-floor" }), "protein");
  assert.equal(M.floorKind({ habit: "evening-journal" }), "journal");
  assert.equal(M.floorKind({ habit: "no-phone-first-hour" }), "status");
});

test("weeklyPlanCandidates: current week first, then earlier, never later or other years", () => {
  const paths = [
    "Weekly Plan/2026/2026 - Weekly Plan - W27.md",
    "Weekly Plan/2026/2026 - Weekly Plan - W28.md",
    "Weekly Plan/2026/2026 - Weekly Plan - W29.md",
    "Weekly Plan/2025/2025 - Weekly Plan - W28.md",
    "Weekly Plan/2026/2026 - Weekly Habit Tracker - W04.md",
  ];
  const c = M.weeklyPlanCandidates(paths, { year: 2026, week: 28 });
  assert.deepEqual(c, [
    { week: 28, path: "Weekly Plan/2026/2026 - Weekly Plan - W28.md" },
    { week: 27, path: "Weekly Plan/2026/2026 - Weekly Plan - W27.md" },
  ]);
});

test("gateChips: sorted by urgency, overdue flagged, null gates excluded", () => {
  const commitments = [
    { title: "A", state: "active", gateDate: "2026-07-08", reviewBy: null },
    { title: "B", state: "active", gateDate: "2026-07-06", reviewBy: null },
    { title: "C", state: "active", gateDate: null, reviewBy: "2026-07-05" },
    { title: "D", state: "idea", gateDate: "2026-07-07", reviewBy: null },  // not active
    { title: "E", state: "active", gateDate: null, reviewBy: null },
  ];
  const chips = M.gateChips(commitments, "2026-07-06");
  assert.deepEqual(chips.map((c) => c.title), ["C", "B", "A"]); // overdue review first
  assert.equal(chips[0].label, "review OVERDUE 1d");
  assert.equal(chips[1].label, "gate TODAY");
  assert.equal(chips[1].cls, "urgent");
  assert.equal(chips[2].cls, "soon");
});

test("buildMetricCommit: batches several metrics into ONE commit, upserting by (date,ui)", () => {
  const pending = { weight: "84.2", steps: "10500" };
  const files = {
    "Ledger/Metrics/weight.csv": "date,value,source,note\n2026-07-07,84.6,clerk,\n",
    // steps.csv missing entirely — must be created with header
  };
  const op = M.buildMetricCommit(pending, files, "2026-07-07");
  assert.equal(op.changes.length, 2);
  assert.match(op.message, /^ui: log weight 84.2, steps 10500/);
  const weight = op.changes.find((c) => c.path.endsWith("weight.csv")).text;
  assert.match(weight, /2026-07-07,84.6,clerk,/);   // clerk row preserved
  assert.match(weight, /2026-07-07,84.2,ui,/);      // ui row added alongside
  const steps = op.changes.find((c) => c.path.endsWith("steps.csv")).text;
  assert.match(steps, /^date,value,source,note\n/); // header created
  assert.match(steps, /2026-07-07,10500,ui,/);
});

test("buildMetricCommit: re-log same day replaces the ui row, never appends a second", () => {
  const files = {
    "Ledger/Metrics/weight.csv": "date,value,source,note\n2026-07-07,84.2,ui,\n",
  };
  const op = M.buildMetricCommit({ weight: "84.4" }, files, "2026-07-07");
  const rows = M.parseCSV(op.changes[0].text).rows.filter((r) => r.date === "2026-07-07" && r.source === "ui");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].value, "84.4");
});

test("buildMetricCommit: validation failures throw before any change is built", () => {
  assert.throws(() => M.buildMetricCommit({ weight: "850" }, {}, "2026-07-07"), /outside plausible range/);
  assert.throws(() => M.buildMetricCommit({ sleep_quality: "9" }, {}, "2026-07-07"), /outside plausible range/);
});

test("todaysLoggedValues reads today's ui/clerk rows per metric", () => {
  const csv = "date,value,source,note\n2026-07-06,84.9,clerk,\n2026-07-07,84.2,ui,\n";
  const v = M.todaysLoggedValues({ "Ledger/Metrics/weight.csv": csv }, "2026-07-07");
  assert.equal(v.weight, "84.2");
  assert.equal(v.steps, undefined);
});
