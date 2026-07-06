// today.js — the 30-second morning surface.
// Everything derived client-side from raw files (compiled artifacts go stale).
// Metric logging batches into ONE commit per screen-session (~8s debounce).

import {
  todayIST, isoWeek, parseFrontmatter, parseCommitment, parseFloors, floorKind,
  weeklyPlanCandidates, todaysMits, gateChips, buildMetricCommit, todaysLoggedValues,
  validateMetric, journalPath, METRIC_FILES, fmtDays, daysBetween,
} from "./model.js?v=4";
import { AuthError, stashPending, takePending } from "./github.js?v=4";

const FLUSH_MS = 8000;
const UNITS = { weight: "kg", steps: "steps", protein: "g", sleep_quality: "/5" };

export async function renderToday(gh, view) {
  const today = todayIST();
  const { entries } = await gh.tree();
  const paths = [...entries.keys()];

  // -- gather raw files --
  const commitmentPaths = paths.filter((p) => /^Ledger\/Commitments\/.+\.md$/.test(p));
  const files = await gh.readFiles([
    "Ledger/habits.md", ...commitmentPaths, ...Object.values(METRIC_FILES),
  ]);
  const commitments = commitmentPaths.map((p) => parseCommitment(files[p] ?? "")).filter((c) => c.id);
  const active = commitments.filter((c) => c.state === "active" || c.state === "committed");
  const floors = parseFloors(files["Ledger/habits.md"] ?? "");
  const logged = todaysLoggedValues(files, today);
  const journalToday = entries.has(journalPath(today));

  // -- weekly plan (skip drafts, fall back to earlier weeks) --
  const iso = isoWeek(today);
  let planWeek = null, planText = null;
  for (const cand of weeklyPlanCandidates(paths, iso)) {
    const text = await gh.readFile(cand.path);
    if (parseFrontmatter(text).status === "draft") continue;
    planWeek = cand.week; planText = text;
    break;
  }
  const mits = planText ? todaysMits(planText, today) : [];

  view.replaceChildren();
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  // ---- Today's 3 ----
  const mitCard = el("div", "card");
  mitCard.append(el("h2", null, "Today's 3"));
  if (planWeek !== null && planWeek !== iso.week) {
    mitCard.append(el("p", "muted", `No committed plan for W${iso.week} yet — showing W${planWeek}.`));
  }
  const ol = el("ol");
  const items = mits.length ? mits
    : active.filter((c) => c.isRock).map((c) => `[${c.pillar}] next step on: ${c.title}`);
  if (!mits.length && planWeek !== null) {
    mitCard.append(el("p", "muted", "No MIT line for today in the weekly plan — derived from rocks:"));
  }
  for (const it of items) ol.append(el("li", null, it));
  if (!items.length) mitCard.append(el("p", "muted", "Nothing planned — enjoy it or check the Board."));
  mitCard.append(ol);
  view.append(mitCard);

  // ---- Log (batched metric entry) ----
  const logCard = el("div", "card");
  logCard.append(el("h2", null, "Log"));
  const pending = {};
  let timer = null;
  const statusLine = el("p", "muted", "");
  const chips = {};

  const flush = async () => {
    clearTimeout(timer); timer = null;
    const batch = { ...pending };
    for (const k of Object.keys(pending)) delete pending[k];
    if (!Object.keys(batch).length) return;
    for (const k of Object.keys(batch)) setChip(k, "saving…", "muted");
    try {
      await gh.commitOp(
        (fresh) => buildMetricCommit(batch, fresh, today),
        { reads: Object.values(METRIC_FILES) });
      for (const [k, v] of Object.entries(batch)) setChip(k, `✓ ${v}`, "ok");
      statusLine.textContent = `Saved in one commit · ${new Date().toLocaleTimeString()}`;
    } catch (e) {
      if (e instanceof AuthError) {
        stashPending({ kind: "metrics", batch, today });
        statusLine.textContent = "Token rejected — entries stashed safely. Reload to re-authenticate.";
        statusLine.className = "err";
        return;
      }
      for (const [k, v] of Object.entries(batch)) {
        Object.assign(pending, { [k]: v });
        setChip(k, "✗ failed", "err");
      }
      statusLine.replaceChildren();
      statusLine.append(el("span", "err", `Save failed: ${e.message} `));
      const retry = el("button", null, "Retry");
      retry.addEventListener("click", flush);
      statusLine.append(retry);
    }
  };

  const setChip = (name, text, cls) => {
    chips[name].textContent = text;
    chips[name].className = `chip ${cls || ""}`;
  };

  const queue = (name, value, input) => {
    const err = validateMetric(name, value);
    if (err) { setChip(name, `✗ ${err}`, "err"); return; }
    pending[name] = value;
    input.value = "";
    input.placeholder = value;
    setChip(name, `queued ${value}`, "muted");
    statusLine.textContent = "Batching… saves in one commit shortly.";
    clearTimeout(timer);
    timer = setTimeout(flush, FLUSH_MS);
  };

  const floorByKind = Object.fromEntries(floors.map((f) => [floorKind(f), f]));
  for (const name of Object.keys(METRIC_FILES)) {
    const row = el("div", "logrow");
    const floor = floorByKind[name];
    row.append(el("label", null, name.replace("_", " ") + (floor ? ` (floor: ${floor.floor})` : "")));
    const input = el("input");
    input.type = "number";
    input.inputMode = "decimal";
    input.placeholder = logged[name] ?? "—";
    const chip = el("span", "chip" + (logged[name] ? " ok" : ""), logged[name] ? `✓ ${logged[name]}` : UNITS[name]);
    chips[name] = chip;
    const log = el("button", null, "Log");
    const submit = () => input.value.trim() && queue(name, input.value.trim(), input);
    log.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => e.key === "Enter" && submit());
    row.append(input, log, chip);
    logCard.append(row);
  }
  logCard.append(statusLine);
  addEventListener("pagehide", () => {
    if (Object.keys(pending).length) stashPending({ kind: "metrics", batch: { ...pending }, today });
  });
  view.append(logCard);

  // restore any stashed entries from a previous interrupted session
  const stashed = takePending().filter((s) => s.kind === "metrics" && s.today === today);
  if (stashed.length) {
    Object.assign(pending, ...stashed.map((s) => s.batch));
    for (const [k, v] of Object.entries(pending)) setChip(k, `restored ${v}`, "muted");
    statusLine.textContent = "Restored unsaved entries from your last visit — saving…";
    timer = setTimeout(flush, 1500);
  }

  // ---- Floors (status-only ones) ----
  const floorCard = el("div", "card");
  floorCard.append(el("h2", null, "Floors"));
  const fl = el("div", "floors");
  for (const f of floors) {
    const kind = floorKind(f);
    if (kind === "journal") {
      fl.append(el("span", `chip ${journalToday ? "ok" : "warn"}`,
        `${f.habit}: ${journalToday ? "entry exists ✓" : "no entry yet"}`));
    } else if (kind === "status") {
      fl.append(el("span", "chip muted", `${f.habit}: clerk-judged`));
    }
  }
  floorCard.append(fl);
  const constraints = active.flatMap((c) => c.constraints);
  for (const c of constraints) floorCard.append(el("p", "muted", `+ ${c}`));
  view.append(floorCard);

  // ---- Gates ----
  const gateCard = el("div", "card");
  gateCard.append(el("h2", null, "Gates & deadlines"));
  const chipsWrap = el("div", "floors");
  const gates = gateChips(active, today);
  if (!gates.length) chipsWrap.append(el("span", "muted", "none within reach"));
  for (const g of gates) chipsWrap.append(el("span", `chip ${g.cls}`, `${g.title} — ${g.label}`));
  gateCard.append(chipsWrap);
  const carries = active.filter((c) => c.carryCount >= 3);
  for (const c of carries) {
    gateCard.append(el("p", "warn", `⚠ ${c.id} carried ${c.carryCount}× — retire-or-real-gate decision stands`));
  }
  view.append(gateCard);
}
