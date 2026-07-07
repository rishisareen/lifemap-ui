// board.js — the plan board. Commitments as cards in four columns
// (Ideas / Committed / Active / Closed). Every move enforces the lifecycle
// rules from OS-Manual in the tested model layer and writes ONE atomic commit.
// Moves are driven by an explicit "Move ▾" menu (works on desktop + touch);
// native drag is a convenience layer over the same code path.

import {
  todayIST, parseCommitment, boardColumn, transition, reschedule, rockBudgetBlocks,
  newIdeaFile, fmtDays, daysBetween
} from "./model.js?v=10";
import { AuthError } from "./github.js?v=10";

const COLUMNS = [
  ["ideas", "Ideas"], ["committed", "Committed"], ["active", "Active"], ["closed", "Closed"],
];
const PILLARS = ["wellness", "finance", "relationships", "joy", "mind", "travel", "learning", "office", "admin"];

export async function renderBoard(gh, view) {
  const today = todayIST();
  const { entries } = await gh.tree();
  const paths = [...entries.keys()].filter((p) => /^Ledger\/Commitments\/.+\.md$/.test(p));
  const archivePaths = [...entries.keys()].filter((p) => /^Archive\/Commitments\/.+\.md$/.test(p));
  const files = await gh.readFiles([...paths, ...archivePaths]);
  const commitments = paths.map((p) => ({ path: p, ...parseCommitment(files[p] ?? "") })).filter((c) => c.id);
  const archived = archivePaths.map((p) => ({ path: p, ...parseCommitment(files[p] ?? "") })).filter((c) => c.id);
  const existingPaths = new Set([...paths, ...archivePaths]);
  const busy = { on: false };

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  const status = el("p", "muted", "");

  // Apply a file-text change to one commitment as a single atomic commit.
  const write = async (path, message, mutate, extra = {}) => {
    if (busy.on) return;
    busy.on = true;
    status.textContent = "saving…";
    status.className = "muted";
    try {
      await gh.commitOp((f) => {
        const cur = f[path];
        if (cur == null && !extra.create) throw new Error("commitment changed on disk — reload");
        const out = mutate(cur);
        return { message, changes: [{ path: out.path ?? path, text: out.text }], deletions: out.deletions ?? [] };
      }, { reads: [path, ...(extra.reads ?? [])] });
      dispatchEvent(new CustomEvent("lifemap:changed"));
      await renderBoard(gh, view);
    } catch (e) {
      busy.on = false;
      status.textContent = e instanceof AuthError
        ? "Token rejected — nothing written. Reload to re-authenticate."
        : `Failed: ${e.message}`;
      status.className = "err";
    }
  };

  const move = (card, toColumn) => {
    if (rockBudgetBlocks(card, toColumn, commitments)) {
      status.textContent = `Only 3 rocks allowed at once (OS-Manual). Close or reschedule one first.`;
      status.className = "warn";
      return;
    }
    if (toColumn === "committed") {
      const gate = prompt(`Commit “${card.title}”. Gate date (YYYY-MM-DD) — the forcing function that makes it real:`, "");
      if (gate === null) return;
      write(card.path, `ui: commit ${card.id}`, (t) => transition(t, { to: "committed", gate: gate.trim(), today }));
    } else if (toColumn === "active") {
      write(card.path, `ui: activate ${card.id}`, (t) => transition(t, { to: "active", today }));
    } else if (toColumn === "closed") {
      const disp = prompt(`Close “${card.title}”. Type "done" or "retire":`, "done");
      if (disp === null) return;
      const d = disp.trim().toLowerCase();
      if (d !== "done" && d !== "retire" && d !== "retired") { status.textContent = 'Type "done" or "retire".'; status.className = "warn"; return; }
      if (d === "done") {
        write(card.path, `ui: done ${card.id}`, (t) => transition(t, { to: "closed", disposition: "done", today }));
      } else {
        const reason = prompt(`Retire “${card.title}”. Reason (recorded honestly, per OS-Manual):`, "");
        if (reason === null || !reason.trim()) { status.textContent = "A reason is required to retire."; status.className = "warn"; return; }
        write(card.path, `ui: retire ${card.id}`, (t) => transition(t, { to: "closed", disposition: "retired", reason: reason.trim(), today }));
      }
    } else if (toColumn === "ideas") {
      status.textContent = "Move back to Ideas isn't a lifecycle transition — reschedule or close instead.";
      status.className = "warn";
    }
  };

  const doReschedule = (card) => {
    const gate = prompt(`Reschedule “${card.title}”. New gate date (YYYY-MM-DD):`, card.gateDate || "");
    if (gate === null || !gate.trim()) return;
    const note = prompt("One line — why is it moving? (carry count will increment)", "") ?? "";
    write(card.path, `ui: reschedule ${card.id}`, (t) => reschedule(t, { gate: gate.trim(), today, note }));
  };

  // ---------- render ----------
  view.replaceChildren();

  const head = el("div", "card");
  const title = el("h2", null, "Plan board");
  const addBtn = el("button", "primary", "+ Idea");
  addBtn.style.float = "right";
  addBtn.addEventListener("click", () => captureIdea());
  head.append(addBtn, title);
  const rockCount = commitments.filter((c) => c.isRock && (c.state === "active" || c.state === "committed")).length;
  head.append(el("p", "muted", `${commitments.length} active commitments · ${rockCount}/3 rocks in play`));
  head.append(status);
  view.append(head);

  const grid = el("div", "board");
  const byCol = Object.fromEntries(COLUMNS.map(([k]) => [k, []]));
  for (const c of commitments) byCol[boardColumn(c)].push(c);

  for (const [key, label] of COLUMNS) {
    const col = el("div", "col");
    col.dataset.col = key;
    const cnt = key === "closed" ? byCol[key].length + archived.length : byCol[key].length;
    col.append(el("h3", null, `${label} · ${cnt}`));

    // drop target
    col.addEventListener("dragover", (e) => { e.preventDefault(); col.classList.add("drop"); });
    col.addEventListener("dragleave", () => col.classList.remove("drop"));
    col.addEventListener("drop", (e) => {
      e.preventDefault(); col.classList.remove("drop");
      const id = e.dataTransfer.getData("text/plain");
      const card = commitments.find((c) => c.id === id);
      if (card && boardColumn(card) !== key) move(card, key);
    });

    for (const c of byCol[key]) col.append(renderCard(c, key));
    if (key === "closed") for (const c of archived) col.append(renderCard(c, key, true));
    grid.append(col);
  }
  view.append(grid);

  function renderCard(c, col, isArchived = false) {
    const card = el("div", "commit-card");
    if (!isArchived) {
      card.draggable = true;
      card.addEventListener("dragstart", (e) => e.dataTransfer.setData("text/plain", c.id));
    }
    const top = el("div", "cardtop");
    top.append(el("strong", null, c.title || c.id));
    if (c.isRock) top.append(el("span", "chip rock", "rock"));
    card.append(top);

    const meta = el("div", "floors");
    meta.append(el("span", "chip muted", c.pillar || "—"));
    const gate = c.gateDate || c.reviewBy;
    if (gate) {
      const n = daysBetween(today, gate);
      meta.append(el("span", `chip ${n < 0 ? "overdue" : n <= 2 ? "urgent" : n <= 7 ? "soon" : "later"}`,
        `${c.gateDate ? "gate" : "review"} ${fmtDays(n)}`));
    } else if (col !== "closed" && col !== "ideas") {
      meta.append(el("span", "chip warn", "no gate"));
    }
    if (c.carryCount >= 3) meta.append(el("span", "chip warn", `carry ${c.carryCount}`));
    if (isArchived) meta.append(el("span", "chip muted", "archived"));
    card.append(meta);

    if (!isArchived) {
      const actions = el("div", "floors");
      const targets = {
        ideas: [["committed", "→ Commit"], ["active", "→ Active"]],
        committed: [["active", "→ Active"], ["closed", "→ Close"]],
        active: [["closed", "→ Close"]],
        closed: [],
      }[col] || [];
      for (const [to, lbl] of targets) {
        const b = el("button", null, lbl);
        b.addEventListener("click", () => move(c, to));
        actions.append(b);
      }
      if (col === "active" || col === "committed") {
        const r = el("button", null, "⟳ Reschedule");
        r.addEventListener("click", () => doReschedule(c));
        actions.append(r);
      }
      card.append(actions);
    }
    return card;
  }

  function captureIdea() {
    const title = prompt("New idea — a title (no gate needed; it's a guilt-free parking lot):", "");
    if (title === null || !title.trim()) return;
    const pillar = (prompt(`Pillar? (${PILLARS.join(", ")})`, "joy") || "").trim().toLowerCase();
    if (!PILLARS.includes(pillar)) { status.textContent = `Pillar must be one of: ${PILLARS.join(", ")}`; status.className = "warn"; return; }
    const { path, text } = newIdeaFile(title.trim(), pillar, today, existingPaths);
    write(path, `ui: capture idea ${path.split("/").pop().replace(".md", "")}`, () => ({ path, text }), { reads: [], create: true });
  }
}
