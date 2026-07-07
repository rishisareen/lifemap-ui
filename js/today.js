// today.js — the 30-second morning surface.
// Everything derived client-side from raw files (compiled artifacts go stale).
// Metric logging batches into ONE commit per screen-session (~8s debounce).

import {
  todayIST, parseCommitment, parseFloors, floorKind,
  gateChips, buildMetricCommit, todaysLoggedValues,
  validateMetric, journalPath, METRIC_FILES,
  dayPlanPath, parseDayPlan, extractJournalToday3, diffToday3, summarizeDiff,
  parseBusyCsv, ageString,
} from "./model.js?v=8";
import { AuthError, stashPending, takePending } from "./github.js?v=8";

const FLUSH_MS = 8000;
const UNITS = { weight: "kg", steps: "steps", protein: "g", sleep_quality: "/5" };

export async function renderToday(gh, view) {
  const today = todayIST();
  const { entries } = await gh.tree();
  const paths = [...entries.keys()];

  // -- gather raw files --
  const commitmentPaths = paths.filter((p) => /^Ledger\/Commitments\/.+\.md$/.test(p));
  const BUSY_PATH = "Plans/Calendar/busy-14d.csv";
  const dayPlanFilePath = dayPlanPath(today);
  const files = await gh.readFiles([
    "Ledger/habits.md", ...commitmentPaths, ...Object.values(METRIC_FILES),
    dayPlanFilePath, journalPath(today), BUSY_PATH,
  ]);
  const commitments = commitmentPaths.map((p) => parseCommitment(files[p] ?? "")).filter((c) => c.id);
  const active = commitments.filter((c) => c.state === "active" || c.state === "committed");
  const floors = parseFloors(files["Ledger/habits.md"] ?? "");
  const logged = todaysLoggedValues(files, today);
  const journalToday = entries.has(journalPath(today));

  view.replaceChildren();
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  // ---- Day plan (absorbs the legacy weekly-MIT card — Unit 8) ----
  const dayPlanCard = el("div", "card");
  dayPlanCard.append(el("h2", null, "Day plan"));
  const dayPlanText = files[dayPlanFilePath] ?? null;
  if (dayPlanText == null) {
    dayPlanCard.append(el("p", "muted", "Plan not generated yet."));
  } else {
    const plan = parseDayPlan(dayPlanText);
    if (plan.error) {
      dayPlanCard.append(el("p", "err", `Day plan couldn't be read: ${plan.error}`));
    } else {
      if (plan.generatedBy === "fallback") {
        dayPlanCard.append(el("p", "warn", plan.context)); // echo the plan's own failure line — not new UI copy
      }
      const journalText = journalToday ? (files[journalPath(today)] ?? null) : null;
      const extraction = journalText != null ? extractJournalToday3(journalText) : null;

      if (extraction && extraction.status === "marker") {
        dayPlanCard.append(el("p", "err", "Plan arrived late — you weren't shown a proposal today."));
      } else if (extraction && extraction.status === "ok" && extraction.items.length) {
        const ol = el("ol");
        for (const it of extraction.items) ol.append(el("li", null, it));
        dayPlanCard.append(ol);
        const diff = diffToday3(plan.today3.map((m) => m.text), extraction.items);
        dayPlanCard.append(el("p", "muted", `proposed: ${summarizeDiff(diff)}`));
      } else {
        const ol = el("ol");
        for (const m of plan.today3) {
          const li = el("li");
          li.append(document.createTextNode(`${m.text} `), el("span", "chip muted", m.pillar));
          ol.append(li);
        }
        dayPlanCard.append(ol);
        dayPlanCard.append(el("p", "muted", "Proposed — edit in your journal."));
      }
    }
  }
  view.append(dayPlanCard);

  // ---- Calendar (busy blocks + LifeMap [pillar] Schedule blocks — Unit 8) ----
  const calCard = el("div", "card");
  calCard.append(el("h2", null, "Calendar"));
  const busyText = files[BUSY_PATH] ?? null;
  if (busyText == null) {
    calCard.append(el("p", "muted", "Calendar feed not connected yet."));
  } else {
    const busy = parseBusyCsv(busyText);
    const fetchedMs = busy.fetchedAt ? new Date(busy.fetchedAt).getTime() : null;
    const isStale = busy.status === "failed" || (fetchedMs != null && Date.now() - fetchedMs > 24 * 3600e3);
    if (isStale) {
      const age = fetchedMs != null ? ageString(fetchedMs, Date.now()) : "unknown";
      calCard.append(el("p", "stale", `Calendar feed stale — last updated ${age}.`));
    } else if (!busy.rows.length) {
      calCard.append(el("p", "muted", "Free day."));
    } else {
      const strip = el("div", "floors");
      for (const r of busy.rows) {
        strip.append(el("span", "chip muted", r.allDay ? "all day" : `${r.start.slice(11, 16)}–${r.end.slice(11, 16)}`));
      }
      calCard.append(strip);
    }
  }
  if (dayPlanText != null) {
    const plan = parseDayPlan(dayPlanText);
    if (!plan.error && plan.schedule?.length) {
      const sched = el("div", "floors");
      for (const s of plan.schedule) {
        sched.append(el("span", "chip rock", `${s.start}–${s.end} [${s.pillar}] ${s.label}`));
      }
      calCard.append(sched);
    }
  }
  view.append(calCard);

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
