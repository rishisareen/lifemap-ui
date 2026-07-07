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

// ---------- day plan ----------

test("dayPlanPath matches the compiler's Plans/Daily/{Y}/{M}/{D}-Plan.md shape", () => {
  assert.equal(M.dayPlanPath("2026-07-08"), "Plans/Daily/2026/07/08-Plan.md");
});

// Same fixture text as _System/bin/test_day_plan.py's test_build_parse_round_trip
// (built via day_plan.build_day_plan with the identical inputs) — byte-identical
// parsing is the paired-change contract.
const DAY_PLAN_FIXTURE = `---
date: 2026-07-08
generated_by: agent
generated_at: 2026-07-08T04:15:00+05:30
---

## Today's 3
<!-- today3-start -->
1. Finish day-planner spec review [deep-work] ⟨weekly⟩
2. Call Mom about the Bihar trip [relationships] ⟨commitment:bihar-trip-mom⟩
3. Try a new recovery routine [health] ⟨suggestion⟩
<!-- today3-end -->

## Yesterday
- done — Wrote the day-planner requirements doc
- slipped — Evening gym session

## Context
Calendar is blank today — no meetings to work around.
`;

test("parseDayPlan round-trips the shared fixture (both suites parse it identically)", () => {
  const parsed = M.parseDayPlan(DAY_PLAN_FIXTURE);
  assert.equal(parsed.date, "2026-07-08");
  assert.equal(parsed.generatedBy, "agent");
  assert.equal(parsed.generatedAt, "2026-07-08T04:15:00+05:30");
  assert.deepEqual(parsed.today3, [
    { text: "Finish day-planner spec review", pillar: "deep-work", source: "weekly" },
    { text: "Call Mom about the Bihar trip", pillar: "relationships", source: "commitment:bihar-trip-mom" },
    { text: "Try a new recovery routine", pillar: "health", source: "suggestion" },
  ]);
  assert.deepEqual(parsed.yesterday, [
    { verdict: "done", text: "Wrote the day-planner requirements doc" },
    { verdict: "slipped", text: "Evening gym session" },
  ]);
  assert.equal(parsed.context, "Calendar is blank today — no meetings to work around.");
});

test("parseDayPlan: no Schedule section is fine (optional in every phase)", () => {
  assert.equal(M.parseDayPlan(DAY_PLAN_FIXTURE).error, undefined);
});

test("parseDayPlan: 4 MITs returns a structured error, does not throw", () => {
  const fourMits = DAY_PLAN_FIXTURE.replace(
    "<!-- today3-end -->",
    "4. A fourth MIT [health] ⟨suggestion⟩\n<!-- today3-end -->");
  const result = M.parseDayPlan(fourMits);
  assert.match(result.error, /1-3 items/);
});

test("parseDayPlan: malformed verdict line returns a structured error, does not throw", () => {
  const bad = DAY_PLAN_FIXTURE.replace(
    "- done — Wrote the day-planner requirements doc",
    "- maybe — Wrote the day-planner requirements doc");
  const result = M.parseDayPlan(bad);
  assert.match(result.error, /malformed ## Yesterday/);
});

test("parseDayPlan: missing Today's 3 section returns a structured error", () => {
  const missing = "---\ndate: 2026-07-08\ngenerated_by: agent\ngenerated_at: x\n---\n\n## Yesterday\n\n## Context\nc\n";
  const result = M.parseDayPlan(missing);
  assert.match(result.error, /Today's 3 block/);
});

// ---------- day plan: Schedule (Unit 6) ----------

const SCHEDULE_FIXTURE = DAY_PLAN_FIXTURE.trimEnd() + `

## Schedule
- 09:00–10:00 [deep-work] Finish spec review
- 11:00–11:30 [relationships] Call Mom
`;

test("parseDayPlan: Schedule round-trips (same fixture shape as the Python suite)", () => {
  const parsed = M.parseDayPlan(SCHEDULE_FIXTURE);
  assert.deepEqual(parsed.schedule, [
    { start: "09:00", end: "10:00", pillar: "deep-work", label: "Finish spec review" },
    { start: "11:00", end: "11:30", pillar: "relationships", label: "Call Mom" },
  ]);
});

test("parseDayPlan: malformed Schedule time line returns a structured error", () => {
  const bad = SCHEDULE_FIXTURE.replace(
    "- 09:00–10:00 [deep-work] Finish spec review", "- 9am-10am [deep-work] Finish spec review");
  assert.match(M.parseDayPlan(bad).error, /malformed ## Schedule/);
});

test("parseDayPlan: Schedule block line missing the pillar returns a structured error", () => {
  const bad = SCHEDULE_FIXTURE.replace(
    "- 09:00–10:00 [deep-work] Finish spec review", "- 09:00–10:00 Finish spec review");
  assert.match(M.parseDayPlan(bad).error, /malformed ## Schedule/);
});

test("parseDayPlan: empty Schedule section (present, no lines) still valid", () => {
  const empty = DAY_PLAN_FIXTURE.trimEnd() + "\n\n## Schedule\n";
  const parsed = M.parseDayPlan(empty);
  assert.equal(parsed.error, undefined);
  assert.deepEqual(parsed.schedule, []);
});

const JOURNAL_TEMPLATE = (b1, b2, b3) => `### 🗓️ Tue Jul 8 — Daily Journal

## Morning

**Today's 3** — a good-enough use of a chunk of my finite time, that I'd actually be willing to do
<!-- agent:day-planner:today3 — pre-filled from weekly plan + calendar + constraints; edit freely — the edit IS the signal -->

- ${b1}
- ${b2}
- ${b3}

**Affirmation** — typed fresh, not furniture

-

---

## Evening — floor: one line, every night
`;

test("extractJournalToday3: real template shape with 3 edited bullets", () => {
  const text = JOURNAL_TEMPLATE("Finish the review", "Call Mom", "Go for a run");
  assert.deepEqual(M.extractJournalToday3(text),
    { status: "ok", items: ["Finish the review", "Call Mom", "Go for a run"] });
});

test("extractJournalToday3: R13 marker detected", () => {
  const text = JOURNAL_TEMPLATE("no plan arrived — write your 3 by hand", "", "");
  const result = M.extractJournalToday3(text);
  assert.equal(result.status, "marker");
  assert.deepEqual(result.items, []);
});

test("extractJournalToday3: heading present, empty bullets — no crash", () => {
  const text = JOURNAL_TEMPLATE("", "", "");
  assert.deepEqual(M.extractJournalToday3(text), { status: "ok", items: [] });
});

test("extractJournalToday3: heading absent", () => {
  const text = "### 🗓️ Tue Jul 8 — Daily Journal\n\n## Morning\n\nNo today's-3 heading at all.\n";
  assert.equal(M.extractJournalToday3(text).status, "absent");
});

// ---------- day plan: diff summary + busy CSV (Unit 8) ----------

test("diffToday3: identical -> all accepted; one reworded -> edited=1", () => {
  assert.deepEqual(M.diffToday3(["A", "B", "C"], ["A", "B", "C"]), { accepted: 3, edited: 0, dropped: 0, added: 0 });
  assert.deepEqual(M.diffToday3(["A", "B", "C"], ["A", "B-x", "C"]), { accepted: 2, edited: 1, dropped: 0, added: 0 });
});

test("diffToday3: dropped and added bullets counted", () => {
  assert.deepEqual(M.diffToday3(["A", "B", "C"], ["A", "B"]), { accepted: 2, edited: 0, dropped: 1, added: 0 });
  assert.deepEqual(M.diffToday3(["A", "B", "C"], ["A", "B", "C", "D"]), { accepted: 3, edited: 0, dropped: 0, added: 1 });
});

test("summarizeDiff: human-readable one-liner", () => {
  assert.equal(M.summarizeDiff({ accepted: 2, edited: 1, dropped: 0, added: 0 }), "2 kept, 1 edited");
  assert.equal(M.summarizeDiff({ accepted: 0, edited: 0, dropped: 0, added: 0 }), "no changes");
});

test("parseBusyCsv: header + rows, all_day flag", () => {
  const csv = "# fetched_at: 2026-07-08T04:15:00+05:30\n# status: ok\nstart,end,all_day\n"
    + "2026-07-08T09:00:00+05:30,2026-07-08T10:00:00+05:30,0\n2026-07-15,2026-07-16,1\n";
  const busy = M.parseBusyCsv(csv);
  assert.equal(busy.fetchedAt, "2026-07-08T04:15:00+05:30");
  assert.equal(busy.status, "ok");
  assert.deepEqual(busy.rows, [
    { start: "2026-07-08T09:00:00+05:30", end: "2026-07-08T10:00:00+05:30", allDay: false },
    { start: "2026-07-15", end: "2026-07-16", allDay: true },
  ]);
});

test("parseBusyCsv: status failed, empty rows", () => {
  const csv = "# fetched_at: 2026-07-08T04:15:00+05:30\n# status: failed\nstart,end,all_day\n";
  const busy = M.parseBusyCsv(csv);
  assert.equal(busy.status, "failed");
  assert.deepEqual(busy.rows, []);
});

// ---------- inline markdown ----------

test("parseInlineMarkdown: pillar tag + bold + trailing text", () => {
  const segs = M.parseInlineMarkdown('[relations] **Full house, and it feels like it** — Jatu arrived (July 3).');
  assert.deepEqual(segs, [
    { type: "pillar", text: "relations" },
    { type: "bold", text: "Full house, and it feels like it" },
    { type: "text", text: " — Jatu arrived (July 3)." },
  ]);
});

test("parseInlineMarkdown: italic and plain text with no pillar", () => {
  assert.deepEqual(M.parseInlineMarkdown("plain line, no markup"), [{ type: "text", text: "plain line, no markup" }]);
  assert.deepEqual(M.parseInlineMarkdown("a *quick* note"), [
    { type: "text", text: "a " }, { type: "italic", text: "quick" }, { type: "text", text: " note" },
  ]);
});

test("parseInlineMarkdown: multiple bold spans on one line", () => {
  const segs = M.parseInlineMarkdown("**A** and **B**");
  assert.deepEqual(segs, [
    { type: "bold", text: "A" }, { type: "text", text: " and " }, { type: "bold", text: "B" },
  ]);
});

// ---------- horizons (quarterly/annual goal summary) ----------

function mkCommitment(f) {
  const lines = ["---", `id: ${f.id}`, `title: ${f.title || f.id}`, `pillar: ${f.pillar || "wellness"}`];
  if (f.horizon) lines.push(`horizon: ${f.horizon}`);
  lines.push(`is_rock: ${f.isRock ? "true" : "false"}`, `state: ${f.state || "active"}`);
  if (f.gateDate) lines.push(`gate_date: ${f.gateDate}`);
  if (f.targetMetric) lines.push(`target_metric: ${f.targetMetric}`);
  if (f.targetValue != null) lines.push(`target_value: ${f.targetValue}`);
  if (f.targetDate) lines.push(`target_date: ${f.targetDate}`);
  lines.push("---", "");
  return M.parseCommitment(lines.join("\n"));
}

test("parseCommitment: additive horizon/successCriteria fields; existing named fields unchanged", () => {
  const c = M.parseCommitment(COMMITMENT);
  assert.equal(c.horizon, "2026-Q3");
  assert.equal(c.successCriteria, "Trip taken with Mom, 3rd week of July 2026.");
  assert.equal(c.id, "bihar-trip-mom"); // no regression in existing named fields
  assert.equal(c.isRock, true);
  assert.equal(c.gateDate, "2026-07-07");

  const bare = M.parseCommitment("---\nid: x\ntitle: X\npillar: joy\nis_rock: false\nstate: idea\n---\n");
  assert.equal(bare.horizon, "");
  assert.equal(bare.successCriteria, "");
});

test("quarterRocks: active/committed rocks, gate-sorted; excludes non-rocks, ideas, closed, retired", () => {
  const commitments = [
    mkCommitment({ id: "rock-c", isRock: true, state: "active", gateDate: "2026-07-20" }),
    mkCommitment({ id: "rock-a", isRock: true, state: "active", gateDate: "2026-07-08" }),
    mkCommitment({ id: "rock-b", isRock: true, state: "committed", gateDate: "2026-07-12" }),
    mkCommitment({ id: "not-a-rock", isRock: false, state: "active" }),
    mkCommitment({ id: "idea-rock", isRock: true, state: "idea" }),
    mkCommitment({ id: "closed-rock", isRock: true, state: "done" }),
    mkCommitment({ id: "retired-rock", isRock: true, state: "retired" }),
  ];
  assert.deepEqual(M.quarterRocks(commitments).map((c) => c.id), ["rock-a", "rock-b", "rock-c"]);
});

test("thisMonthGates: gate_date in the current IST month + horizon:YYYY-MM, excludes other months", () => {
  const commitments = [
    mkCommitment({ id: "july-gate", title: "July gate", state: "active", gateDate: "2026-07-20" }),
    mkCommitment({ id: "july-horizon", title: "July horizon, no gate", state: "committed", horizon: "2026-07" }),
    mkCommitment({ id: "august-gate", title: "August gate", state: "active", gateDate: "2026-08-05" }),
  ];
  const gates = M.thisMonthGates(commitments, "2026-07-07");
  assert.deepEqual(gates.map((g) => g.title), ["July gate", "July horizon, no gate"]);
  assert.equal(gates[0].daysToGate, 13);
  assert.equal(gates[1].gateDate, null);
});

test("thisMonthGates: no matching gate returns []", () => {
  const commitments = [mkCommitment({ id: "august-gate", state: "active", gateDate: "2026-08-05" })];
  assert.deepEqual(M.thisMonthGates(commitments, "2026-07-07"), []);
});

test("thisMonthGates: excludes idea/done/retired state even with a matching gate or horizon", () => {
  const commitments = [
    mkCommitment({ id: "idea-this-month", state: "idea", gateDate: "2026-07-15" }),
    mkCommitment({ id: "done-this-month", state: "done", horizon: "2026-07" }),
    mkCommitment({ id: "retired-this-month", state: "retired", gateDate: "2026-07-15" }),
  ];
  assert.deepEqual(M.thisMonthGates(commitments, "2026-07-07"), []);
});

test("annualGoals: horizon:2026 active/committed only — excludes retired/done and quarter-horizon rocks", () => {
  const commitments = [
    mkCommitment({ id: "neural-reset", pillar: "mind", horizon: "2026", state: "active" }),
    mkCommitment({ id: "old-goal", pillar: "joy", horizon: "2026", state: "retired" }),
    mkCommitment({ id: "done-goal", pillar: "travel", horizon: "2026", state: "done" }),
    mkCommitment({ id: "q3-rock", pillar: "finance", horizon: "2026-Q3", isRock: true, state: "active" }),
  ];
  assert.deepEqual(M.annualGoals(commitments, "2026-07-07").map((c) => c.id), ["neural-reset"]);
});

test("annualGoals: 2+ surviving items sort by pillar then title; a committed (not just active) goal survives", () => {
  const commitments = [
    mkCommitment({ id: "travel-goal", title: "Z travel goal", pillar: "travel", horizon: "2026", state: "active" }),
    mkCommitment({ id: "finance-goal", title: "A finance goal", pillar: "finance", horizon: "2026", state: "committed" }),
    mkCommitment({ id: "mind-goal", title: "M mind goal", pillar: "mind", horizon: "2026", state: "active" }),
  ];
  assert.deepEqual(M.annualGoals(commitments, "2026-07-07").map((c) => c.id),
    ["finance-goal", "mind-goal", "travel-goal"]); // pillar-alphabetical: finance, mind, travel
});

test("metricReadout: latest-vs-target for a metric-linked commitment", () => {
  const c = mkCommitment({ id: "resume-training", targetMetric: "weight", targetValue: 80, targetDate: "2026-08-04" });
  const rows = M.parseCSV("date,value,source,note\n2026-07-01,85,q3-review,\n2026-07-06,84.6,ui,\n").rows;
  assert.deepEqual(M.metricReadout(c, rows, "2026-07-07"),
    { latest: "84.6", target: 80, targetDate: "2026-08-04", daysLeft: 28 });
});

test("metricReadout: no logged rows yet -> latest null (partial state); no target_metric -> null", () => {
  const c = mkCommitment({ id: "resume-training", targetMetric: "weight", targetValue: 80, targetDate: "2026-08-04" });
  assert.equal(M.metricReadout(c, [], "2026-07-07").latest, null);
  assert.equal(M.metricReadout(mkCommitment({ id: "no-metric" }), [], "2026-07-07"), null);
});

test("metricReadout: target_metric set but no target_value -> target null (never crashes)", () => {
  const c = mkCommitment({ id: "no-target", targetMetric: "weight" });
  const r = M.metricReadout(c, [], "2026-07-07");
  assert.equal(r.target, null);
  assert.equal(r.daysLeft, null);
});

test("quarterOf: month -> quarter mapping incl. year boundaries", () => {
  assert.deepEqual(M.quarterOf("2026-01-15"), { year: 2026, q: 1 });
  assert.deepEqual(M.quarterOf("2026-07-07"), { year: 2026, q: 3 });
  assert.deepEqual(M.quarterOf("2026-10-01"), { year: 2026, q: 4 });
  assert.deepEqual(M.quarterOf("2026-12-31"), { year: 2026, q: 4 });
});

test("reviewPath: quarterly, monthly, and annual-to-current-quarter mapping", () => {
  assert.equal(M.reviewPath("2026-Q3", "2026-07-07"), "Reviews - Month and Quarter/Q3.md");
  assert.equal(M.reviewPath("2026-07", "2026-07-07"), "Reviews - Month and Quarter/07-2026.md");
  assert.equal(M.reviewPath("2026", "2026-07-07"), "Reviews - Month and Quarter/Q3.md");
});

test("reviewPath: unrecognized horizon returns null (caller omits the link)", () => {
  assert.equal(M.reviewPath("idea", "2026-07-07"), null);
});

test("reviewPath: rejects an out-of-range month instead of building a dead link", () => {
  assert.equal(M.reviewPath("2026-13", "2026-07-07"), null);
  assert.equal(M.reviewPath("2026-00", "2026-07-07"), null);
});

test("blobUrl: percent-encodes spaces per path segment, preserves slashes", () => {
  assert.equal(M.blobUrl("Reviews - Month and Quarter/Q3.md"),
    "https://github.com/rishisareen/lifemap/blob/main/Reviews%20-%20Month%20and%20Quarter/Q3.md");
});

test("gateUrgencyClass: urgency banding by days-until", () => {
  assert.equal(M.gateUrgencyClass(-1), "overdue");
  assert.equal(M.gateUrgencyClass(0), "urgent");
  assert.equal(M.gateUrgencyClass(1), "urgent");
  assert.equal(M.gateUrgencyClass(2), "soon");
  assert.equal(M.gateUrgencyClass(3), "soon");
  assert.equal(M.gateUrgencyClass(4), "later");
});

test("truncate: short text unchanged; long text cut with ellipsis", () => {
  assert.equal(M.truncate("short", 160), "short");
  const long = "x".repeat(200);
  const t = M.truncate(long, 160);
  assert.equal(t.length, 161); // 160 chars + ellipsis
  assert.ok(t.endsWith("…"));
});

test("truncate: code-point-safe — never splits a surrogate-pair emoji at the boundary", () => {
  const s = "x".repeat(9) + "🎯" + "y".repeat(10); // emoji's high surrogate lands exactly at UTF-16 index 9
  const t = M.truncate(s, 10);
  assert.equal(t, "x".repeat(9) + "🎯" + "…"); // whole emoji preserved, not split into a lone surrogate
  assert.doesNotMatch(t, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/); // no unpaired high surrogate
});
