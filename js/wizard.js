// wizard.js — the weekly review. Six steps, prefilled from the week's data,
// autosaved as a draft (status: draft) after every step so it survives
// switching Macs. "Commit week" writes the real plan (status: committed),
// applies any carry decisions, and deletes the draft — one atomic commit.
//
// The generated file IS the canonical weekly plan (the compiler reads its MIT
// lines for Today's 3); the Obsidian Templater copy is deprecated in favour of
// this. Monthly/quarterly modes are Unit 10.

import {
  todayIST, isoWeek, reviewTargetWeek, mondayOfISOWeek, windowLabel,
  weeklyDraftPath, weeklyFinalPath, parseCommitment, parseWeeklyPlan,
  buildWeeklyDraft, buildWeeklyCommit, WD, daysBetween,
} from "./model.js?v=3";
import { AuthError } from "./github.js?v=3";

const STEPS = ["Celebrate", "Analyze misses", "Top outcomes", "Schedule", "Theme & truth", "Carry decisions"];

export async function renderReview(gh, view, cadence = "weekly") {
  const today = todayIST();
  const target = reviewTargetWeek(today);
  const monday = mondayOfISOWeek(target);
  const isCurrentWeek = isoWeek(today).week === target.week && isoWeek(today).year === target.year;
  const draftPath = weeklyDraftPath(target);
  const finalPath = weeklyFinalPath(target);

  const { entries } = await gh.tree();
  const commitmentPaths = [...entries.keys()].filter((p) => /^Ledger\/Commitments\/.+\.md$/.test(p));
  const need = [draftPath, finalPath, ...commitmentPaths];
  const files = await gh.readFiles(need.filter((p) => entries.has(p)));
  const commitments = commitmentPaths.map((p) => ({ path: p, ...parseCommitment(files[p] ?? "") })).filter((c) => c.id);
  const rocks = commitments.filter((c) => c.isRock && (c.state === "active" || c.state === "committed"));
  const carryAlerts = commitments.filter((c) => c.carryCount >= 3 && (c.state === "active" || c.state === "committed"));

  // Load: draft > existing committed plan > fresh prefill.
  let state, source;
  if (files[draftPath]) { state = parseWeeklyPlan(files[draftPath]); source = "draft"; }
  else if (files[finalPath]) { state = parseWeeklyPlan(files[finalPath]); source = "existing"; }
  else { state = prefill(target, rocks, commitments); source = "new"; }
  state.target = target;
  state.rocks = rocks.map((r) => r.id);
  const decisions = {}; // id -> {action, gate?, note?, reason?}

  let step = 0;
  const busy = { on: false };

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  const save = async (msgEl, { commit = false } = {}) => {
    if (busy.on) return false;
    busy.on = true;
    if (msgEl) { msgEl.textContent = commit ? "committing…" : "saving draft…"; msgEl.className = "muted"; }
    try {
      if (commit) {
        const decList = Object.entries(decisions).map(([id, d]) => ({ id, ...d }));
        const reads = decList.map((d) => `Ledger/Commitments/${d.id}.md`);
        await gh.commitOp((f) => buildWeeklyCommit(state, decList, f, today), { reads });
      } else {
        await gh.commitOp(() => buildWeeklyDraft(state), { reads: [] });
      }
      busy.on = false;
      dispatchEvent(new CustomEvent("lifemap:changed"));
      return true;
    } catch (e) {
      busy.on = false;
      if (msgEl) {
        msgEl.textContent = e instanceof AuthError
          ? "Token rejected — draft kept locally in this form. Reload to re-authenticate."
          : `Save failed: ${e.message}`;
        msgEl.className = "err";
      }
      return false;
    }
  };

  function render() {
    view.replaceChildren();
    const head = el("div", "card");
    head.append(el("h2", null, `${cadence[0].toUpperCase() + cadence.slice(1)} review — W${target.week}`));
    const sub = el("p", "muted",
      `Planning ${isCurrentWeek ? "this" : "next"} week · ${windowLabel(monday)} · ` +
      (source === "draft" ? "resumed from your saved draft"
        : source === "existing" ? "editing the committed plan"
        : "fresh — prefilled from this week's data"));
    head.append(sub);
    // step pips
    const pips = el("div", "floors");
    STEPS.forEach((label, i) => {
      const p = el("span", `chip ${i === step ? "urgent" : i < step ? "ok" : "muted"}`, `${i + 1}. ${label}`);
      p.style.cursor = "pointer";
      p.addEventListener("click", () => { step = i; render(); });
      pips.append(p);
    });
    head.append(pips);
    view.append(head);

    const body = el("div", "card");
    const msg = el("p", "muted", "");
    STEP_RENDERERS[step](body, el);
    body.append(msg);

    const nav = el("div", "floors");
    nav.style.marginTop = ".6rem";
    if (step > 0) {
      const back = el("button", null, "← Back");
      back.addEventListener("click", () => { step--; render(); });
      nav.append(back);
    }
    if (step < STEPS.length - 1) {
      const next = el("button", "primary", "Save & next →");
      next.addEventListener("click", async () => { if (await save(msg)) { step++; render(); } });
      nav.append(next);
      const skip = el("button", null, "Skip");
      skip.addEventListener("click", () => { step++; render(); });
      nav.append(skip);
    } else {
      const commit = el("button", "primary", "✓ Commit week");
      commit.addEventListener("click", async () => {
        if (await save(msg, { commit: true })) {
          view.replaceChildren();
          const done = el("div", "card");
          done.append(el("h2", null, "Week committed ✓"));
          done.append(el("p", "muted", `${finalPath} written. The compiler will serve it as Today's 3 from Monday. Draft cleared.`));
          const again = el("button", null, "Review again");
          again.addEventListener("click", () => renderReview(gh, view, cadence));
          done.append(again);
          view.append(done);
        }
      });
      nav.append(commit);
    }
    body.append(nav);
    view.append(body);
  }

  // ---- step renderers ----
  const listStep = (body, el, key, heading, help, ordered) => {
    body.append(el("h3", null, heading));
    body.append(el("p", "muted", help));
    const ta = el("textarea");
    ta.rows = 8; ta.style.width = "100%";
    ta.value = state[key].join("\n");
    ta.placeholder = "one per line…";
    ta.addEventListener("input", () => { state[key] = ta.value.split("\n").map((s) => s.trim()).filter(Boolean); });
    body.append(ta);
  };

  const STEP_RENDERERS = [
    (body, el) => listStep(body, el, "celebrate", "Celebrate last week",
      "What went well — prefilled from this week's accepted proposals and journal presence. Edit freely."),
    (body, el) => listStep(body, el, "misses", "Analyze what didn't happen",
      "Honest misses — prefilled from carry alerts and overdue gates. A repeat miss becomes a decision in step 6."),
    (body, el) => listStep(body, el, "outcomes", "Top outcomes for the week",
      "3–6 needle-movers, tied to rocks — prefilled from each rock's next gate. Trim and reorder.", true),
    (body, el) => {
      body.append(el("h3", null, "Schedule — MIT per day"));
      body.append(el("p", "muted", "1–3 most-important tasks per day. These become the compiler's Today's 3 all week."));
      for (let i = 0; i < 7; i++) {
        const wd = WD[i];
        const d = new Date(monday + "T12:00Z"); d.setUTCDate(d.getUTCDate() + i);
        const row = el("div", "logrow");
        row.append(el("label", null, `${wd} ${d.getUTCDate()}`));
        const input = el("input");
        input.type = "text"; input.style.gridColumn = "span 3";
        input.value = state.mits[wd] || "";
        input.placeholder = i === 6 ? "e.g. 30-min weekly review" : "";
        input.addEventListener("input", () => { state.mits[wd] = input.value.trim(); });
        row.append(input);
        body.append(row);
      }
    },
    (body, el) => {
      body.append(el("h3", null, "Theme & one uncomfortable truth"));
      body.append(el("p", "muted", "These are yours — never prefilled. The theme is the week in a phrase; the truth is the thing you'd rather not write."));
      const t1 = el("input"); t1.type = "text"; t1.style.width = "100%"; t1.placeholder = "Theme for the week";
      t1.value = state.theme || "";
      t1.addEventListener("input", () => { state.theme = t1.value; });
      body.append(el("label", "muted", "🎯 Theme"), t1);
      const t2 = el("textarea"); t2.rows = 4; t2.style.width = "100%"; t2.placeholder = "One uncomfortable truth…";
      t2.value = state.truth || "";
      t2.addEventListener("input", () => { state.truth = t2.value.trim(); });
      body.append(el("label", "muted", "🪞 Uncomfortable truth"), t2);
    },
    (body, el) => {
      body.append(el("h3", null, "Carry decisions"));
      if (!carryAlerts.length) {
        body.append(el("p", "muted", "No commitment has carried 3+ times. Nothing forced this week. ✨"));
        return;
      }
      body.append(el("p", "muted", "These have carried 3+ times. The system won't let them keep sliding silently — schedule with a real gate, or retire honestly."));
      for (const c of carryAlerts) {
        const card = el("div", "commit-card");
        card.append(el("strong", null, `${c.title} — carried ${c.carryCount}×`));
        const chosen = decisions[c.id];
        const row = el("div", "floors");
        const mk = (label, cls, fn) => { const b = el("button", cls, label); b.addEventListener("click", fn); return b; };
        row.append(mk(chosen?.action === "reschedule" ? "✓ Rescheduled" : "Reschedule",
          chosen?.action === "reschedule" ? "primary" : "", () => {
            const gate = prompt(`New gate date for “${c.title}” (YYYY-MM-DD):`, c.gateDate || "");
            if (!gate?.trim()) return;
            const note = prompt("Why is it moving? (one line)", "") ?? "";
            decisions[c.id] = { action: "reschedule", gate: gate.trim(), note };
            render(); step = 5;
          }));
        row.append(mk(chosen?.action === "retire" ? "✓ Retiring" : "Retire",
          chosen?.action === "retire" ? "primary" : "", () => {
            const reason = prompt(`Retire “${c.title}” — reason (recorded honestly):`, "");
            if (!reason?.trim()) return;
            decisions[c.id] = { action: "retire", reason: reason.trim() };
            render(); step = 5;
          }));
        if (chosen) row.append(mk("clear", "", () => { delete decisions[c.id]; render(); step = 5; }));
        card.append(row);
        if (chosen) card.append(el("p", "muted",
          chosen.action === "reschedule" ? `→ new gate ${chosen.gate} (carry +1)` : `→ retire: ${chosen.reason}`));
        body.append(card);
      }
    },
  ];

  render();
}

// Prefill a fresh review from the week's live data.
function prefill(target, rocks, commitments) {
  const celebrate = [];
  const misses = [];
  const outcomes = rocks.map((r) => {
    const gate = r.gateDate ? ` (gate ${r.gateDate})` : "";
    return `[${r.pillar}] next step on ${r.title}${gate}`;
  });
  for (const c of commitments) {
    if (c.carryCount >= 3) misses.push(`[${c.pillar}] ${c.title} — carried ${c.carryCount}×`);
    const gate = c.gateDate;
    if (gate && daysBetween(mondayOfISOWeek(target), gate) < 0)
      misses.push(`[${c.pillar}] ${c.title} — gate overdue`);
  }
  return {
    celebrate, misses, outcomes,
    mits: { Mon: "", Tue: "", Wed: "", Thu: "", Fri: "", Sat: "", Sun: "30-min weekly review" },
    theme: "", truth: "",
  };
}
