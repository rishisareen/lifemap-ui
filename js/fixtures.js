// fixtures.js — demo data + a fake GitHub client (?demo=1).
// Lets the UI render and be screenshot-tested with NO token and NO network.
// Shapes mirror the real repo exactly.

const TODAY_FIX = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const [Y, Mn, D] = TODAY_FIX.split("-").map(Number);
const MONS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const wd = WD[(new Date(TODAY_FIX + "T12:00Z").getUTCDay() + 6) % 7];

function isoWeekOf(dateStr) {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3);
  const year = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4, 12));
  const w1 = new Date(jan4); w1.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + 3);
  return { year, week: 1 + Math.round((d - w1) / (7 * 864e5)) };
}
const { year: IY, week: IW } = isoWeekOf(TODAY_FIX);
const W = String(IW).padStart(2, "0");
const Q = Math.ceil(Mn / 3);

const plus = (days) => {
  const d = new Date(TODAY_FIX + "T12:00Z"); d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export const FIXTURES = {
  [`Weekly Plan/${IY}/${IY} - Weekly Plan - W${W}.md`]: `---
week: ${IY}-W${W}
status: committed
---
## 🗓️ Weekly Plan (W${W})

- [ ] **${wd} ${MONS[Mn - 1]} ${D}** — (1) Call Mom, lock Bihar dates. (2) Swim / walk (back-safe). (3) Office to steady state.
`,
  "Ledger/habits.md": `# Habits

## Active daily floors (the non-negotiables)

| habit | floor | full | pillar | tracked in | hint |
|---|---|---|---|---|---|
| evening-journal | 1 line, every night | full reflection | mind | journal | evening text |
| steps-10k | 10,000 steps | — | wellness | steps.csv | steps |
| protein-floor | ≥150 g | — | wellness | protein.csv | protein |
| no-phone-first-hour | phone untouched for the first hour | — | mind | journal | phone |

## Retired
`,
  "Ledger/Commitments/bihar-trip-mom.md": `---
id: bihar-trip-mom
title: Bihar/Deoghar trip with Mom
pillar: relationships
is_rock: true
state: active
carry_count: 6
gate_date: ${plus(1)}
review_by: ${plus(6)}
forcing_function: "Payment confirmation by tomorrow"
---
## Log
- ${TODAY_FIX} — demo data
`,
  "Ledger/Commitments/resume-training-cut-80kg.md": `---
id: resume-training-cut-80kg
title: Resume training + cut to 80kg (rehab-first)
pillar: wellness
is_rock: true
state: active
carry_count: 0
gate_date: ${plus(2)}
target_metric: weight
target_value: 80
target_date: ${plus(29)}
forcing_function: "Physio appointment defines safe load"
---
**Constraint (hard):** L4/L5 rehab — the rehab set is the ceiling, not the floor.

## Log
`,
  "Ledger/Commitments/deploy-house-capital.md": `---
id: deploy-house-capital
title: Deploy the house-sale capital
pillar: finance
is_rock: true
state: active
carry_count: 0
review_by: ${plus(-1)}
forcing_function: "Thesis outline this month"
---
## Log
`,
  "Ledger/Commitments/neural-reset.md": `---
id: neural-reset
title: Neural Reset — reclaim the mind from cheap dopamine
pillar: mind
horizon: 2026
is_rock: false
state: active
carry_count: 0
forcing_function: ""
success_criteria: "Phone outside room + Do Nothing practice + grayscale permanent."
---
## Log
`,
  "Ledger/Commitments/finance-craft.md": `---
id: finance-craft
title: Investing craft — 3 theses, a working screener, deploy top 5
pillar: finance
horizon: 2026
is_rock: false
state: active
carry_count: 0
forcing_function: ""
success_criteria: "3 written high-conviction theses; a screener over ~700 companies; capital deployed into ~5 concentrated positions by Dec 31."
---
## Log
`,
  [`Reviews - Month and Quarter/Q${Q}.md`]: `### Quarterly Review — Q${Q}\n\nDemo review content — exercises the Horizons section review-link in ?demo=1.\n`,
  [`Reviews - Month and Quarter/${String(Mn).padStart(2, "0")}-${Y}.md`]: `### Monthly Review — ${MONS[Mn - 1]} ${Y}\n\nDemo review content — exercises the Horizons This Month review-link in ?demo=1.\n`,
  "Ledger/Commitments/learn-woodworking.md": `---
id: learn-woodworking
title: "Learn woodworking at the Gurgaon studio"
pillar: joy
horizon: idea
is_rock: false
state: idea
captured_on: ${plus(-3)}
carry_count: 0
forcing_function: ""
---
*Captured via the board.*

## Log
`,
  "Ledger/Commitments/japan-trip.md": `---
id: japan-trip
title: Japan with Riya & Ryan
pillar: travel
is_rock: false
state: done
closed_on: ${plus(-2)}
carry_count: 0
---
## Log
- ${plus(-2)} — Done.
`,
  "Archive/Commitments/micro-adventure.md": `---
id: micro-adventure
title: One micro-adventure every other month
pillar: joy
is_rock: false
state: retired
closed_on: ${plus(-40)}
carry_count: 5
---
## Log
- ${plus(-40)} — Retired: too much on; joy comes via people.
`,
  "Ledger/Metrics/weight.csv": `date,value,source,note\n${plus(-5)},85,q3-review,start\n${plus(-1)},84.6,ui,\n`,
  "Ledger/Metrics/steps.csv": "date,value,source,note\n",
  "Ledger/Metrics/protein.csv": `date,value,source,note\n${TODAY_FIX},155,clerk,\n`,
  "Ledger/Metrics/sleep_quality.csv": "date,value,source,note\n",
  "Ledger/Inbox/_processed.md": "- baseline 2026-07-05\n",
  [`Ledger/Inbox/${plus(-1)}-metric-weight.md`]: `---
id: demo11111111
journal_date: ${plus(-1)}
type: metric
target: weight
payload_date: ${plus(-1)}
payload_value: "84.4"
---

**Evidence:** "weighed in at 84.4 this morning" (journal ${plus(-1)}).`,
  [`Ledger/Inbox/${plus(-1)}-log-training.md`]: `---
id: demo22222222
journal_date: ${plus(-1)}
type: log
target: resume-training-cut-80kg
payload_date: ${plus(-1)}
payload_text: "Swim 2k + rehab set, back felt fine"
---

**Evidence:** "did the full rehab set after a 2k swim, no pain" (journal ${plus(-1)}).`,
  [`Ledger/Inbox/${plus(-1)}-lesson-mind.md`]: `---
id: demo33333333
journal_date: ${plus(-1)}
type: lesson
pillar: mind
payload_date: ${plus(-1)}
payload_text: "Presence beats productivity when family is in the house"
---

**Evidence:** "the day felt right because I stopped trying to be productive" (journal ${plus(-1)}).

**Notes:** Borderline — accept only if it belongs in the annual lessons file.`,
  [`Daily Journal/${Y}/${String(Mn).padStart(2, "0")} (${MONS[Mn - 1]})/${String(D).padStart(2, "0")}-${MONS[Mn - 1]}.md`]: "### demo journal entry\n",
  [`Plans/Daily/${Y}/${String(Mn).padStart(2, "0")}/${String(D).padStart(2, "0")}-Plan.md`]: `---
date: ${TODAY_FIX}
generated_by: agent
generated_at: ${TODAY_FIX}T04:15:00+05:30
---

## Today's 3
<!-- today3-start -->
1. Call Mom, lock Bihar dates [relationships] ⟨commitment:bihar-trip-mom⟩
2. Swim / walk (back-safe) [wellness] ⟨carry⟩
3. Office to steady state [office] ⟨weekly⟩
<!-- today3-end -->

## Yesterday
- slipped — Call Mom, lock Bihar dates
- done — Draft the thesis outline

## Context
Two carries from yesterday; the swim/walk block avoids your 10am block.

## Schedule
- 09:00–09:30 [relationships] Call Mom, lock Bihar dates
- 17:00–18:00 [wellness] Swim / walk (back-safe)
`,
  "Plans/Calendar/busy-14d.csv": `# fetched_at: ${TODAY_FIX}T04:15:00+05:30
# status: ok
start,end,all_day
${TODAY_FIX}T10:00:00+05:30,${TODAY_FIX}T11:00:00+05:30,0
${TODAY_FIX}T15:00:00+05:30,${TODAY_FIX}T16:00:00+05:30,0
`,
};

export class FakeGitHub {
  constructor(files = { ...FIXTURES }) {
    this.files = files;
    this.commits = [];
  }
  async tree() {
    return { headOid: "demo", entries: new Map(Object.keys(this.files).map((p) => [p, { sha: p, size: 1 }])) };
  }
  async readFile(p) { return this.files[p] ?? null; }
  async readFiles(paths) {
    const out = {};
    for (const p of paths) if (this.files[p] != null) out[p] = this.files[p];
    return out;
  }
  async commitOp(build, { reads = [] } = {}) {
    const op = await build(await this.readFiles(reads));
    if (!op || !((op.changes || []).length + (op.deletions || []).length)) return null;
    for (const c of op.changes || []) this.files[c.path] = c.text;
    for (const d of op.deletions || []) delete this.files[d];
    this.commits.push(op.message);
    return "demo-oid-" + this.commits.length;
  }
  async recentCommits() {
    return [
      { message: "sync: demo", at: new Date(Date.now() - 20 * 60e3).toISOString() },
      { message: "lifemap: compile + clerk [skip ci]", at: new Date(Date.now() - 60 * 60e3).toISOString() },
    ];
  }
  async latestRun() { return { name: "lifemap", status: "completed", conclusion: "success", at: new Date().toISOString() }; }
  async dispatchWorkflow(file, inputs = {}) {
    // Demo only: simulate the reviewer agent producing a candidate ~2s later.
    if (file === "reviewer.yml" && inputs.week) {
      const w = inputs.week.split("-W");
      const path = `Plans/_drafts/${w[0]} - Weekly Plan - W${w[1]}-ai.md`;
      setTimeout(() => {
        this.files[path] = [
          "---", `week: ${inputs.week}`, "status: ai-draft", "---", "",
          "## STEP THREE : CELEBRATE LAST WEEK", "",
          "- [relations] Full house all week — “most lovely feeling” (Jul 3)",
          "- [office] Inbox pulled back under control after the Japan backlog",
          "- [wellness] Mobility + gym intentions returning post-trip", "",
          "## STEP FOUR : ANALYZE WHAT DIDN'T HAPPEN", "",
          "- [relations] Bihar still unbooked — the 6-month carry",
          "- [wellness] Routine still recovering; physio gates the real restart", "",
          "## 🪞 One Uncomfortable Truth", "",
          "You've booked Bihar in your head six times. The only thing that counts this week is a payment confirmation.", "",
        ].join("\n");
      }, 2000);
    }
  }
}
