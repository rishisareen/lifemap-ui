// inbox.js — one-tap approve. Each decision (or "accept all") is ONE atomic
// commit: apply payload(s) + delete proposal file(s) + append _processed.md.
// Stale targets render as warnings and are never written. Double-taps and
// concurrent sessions are no-ops by construction (buildInboxCommit skips
// proposals whose file is already gone).

import {
  todayIST, parseProposal, proposalSummary, buildInboxCommit, PROPOSAL_TYPES, METRIC_FILES, slugify, blobUrl,
} from "./model.js?v=12";
import { AuthError } from "./github.js?v=12";

export async function renderInbox(gh, view) {
  const today = todayIST();
  const { entries, headOid } = await gh.tree();
  const proposalPaths = [...entries.keys()]
    .filter((p) => /^Ledger\/Inbox\/[^_][^/]*\.md$/.test(p)).sort();

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  view.replaceChildren();
  const head = el("div", "card");
  head.append(el("h2", null, "Inbox"));
  if (!proposalPaths.length) {
    head.append(el("p", "muted", "Nothing waiting — the Clerk has proposed nothing new. ✨"));
    view.append(head);
    return;
  }
  head.append(el("p", "muted",
    `${proposalPaths.length} proposal(s) from your journal. ✓ applies to the Ledger, ✗ discards — either way it never comes back.`));
  view.append(head);

  const texts = await gh.readFiles(proposalPaths, headOid, { tolerant: true });
  const proposals = proposalPaths.map((p) => parseProposal(p, texts[p] ?? ""));
  const busy = { on: false };

  // reads needed to apply: proposal files + every possible target they name
  const readsFor = (decisions) => {
    const reads = new Set(["Ledger/Inbox/_processed.md"]);
    for (const { proposal } of decisions) {
      reads.add(proposal.path);
      const f = proposal.fm;
      if (f.type === "metric" && METRIC_FILES[f.target]) reads.add(METRIC_FILES[f.target]);
      if (f.type === "log" || f.type === "milestone") reads.add(`Ledger/Commitments/${f.target}.md`);
      if (f.type === "lesson") reads.add(`Ledger/lessons-${(f.payload_date || today).slice(0, 4)}.md`);
      if (f.type === "idea" && f.payload_text) reads.add(`Ledger/Commitments/${slugify(f.payload_text)}.md`);
    }
    return [...reads];
  };

  const decide = async (decisions, note, buttons = []) => {
    if (busy.on) return;
    busy.on = true;
    buttons.forEach((b) => (b.disabled = true)); // no double-submit while the commit is in flight
    note.textContent = "applying…";
    note.className = "muted";
    try {
      const result = { stale: [] };
      const oid = await gh.commitOp((files) => {
        const op = buildInboxCommit(decisions, files, today);
        if (op) result.stale = op.stale;
        return op && op.changes.length + op.deletions.length ? op : null;
      }, { reads: readsFor(decisions) });
      busy.on = false;
      if (result.stale.length) {
        note.textContent = `${result.stale.length} proposal(s) were stale (target changed) — kept for review.`;
        note.className = "warn";
      }
      dispatchEvent(new CustomEvent("lifemap:changed"));
      await renderInbox(gh, view); // re-render from fresh repo state
      if (oid === null && !result.stale.length) return; // double-tap no-op
    } catch (e) {
      busy.on = false;
      buttons.forEach((b) => (b.disabled = false)); // let the user genuinely retry a real failure
      if (e instanceof AuthError) {
        note.textContent = "Token rejected — nothing was written. Reload to re-authenticate; proposals are safe in the repo.";
      } else {
        note.textContent = `Failed: ${e.message} — nothing was partially applied (atomic commit).`;
      }
      note.className = "err";
    }
  };

  // ---- accept all ----
  const note = el("p", "muted", "");
  if (proposals.filter((p) => p.id && PROPOSAL_TYPES.includes(p.type)).length > 1) {
    const bar = el("div", "card");
    const all = el("button", "primary", `✓ Accept all ${proposals.length}`);
    all.addEventListener("click", () =>
      decide(proposals.filter((p) => p.id && PROPOSAL_TYPES.includes(p.type))
        .map((proposal) => ({ proposal, action: "accept" })), note, [all]));
    bar.append(all, note);
    view.append(bar);
  } else {
    head.append(note);
  }

  // ---- cards ----
  for (const p of proposals) {
    const card = el("div", "card proposal");
    const parseable = p.id && PROPOSAL_TYPES.includes(p.type);

    const top = el("div", "floors");
    top.append(el("span", `chip ${parseable ? "" : "warn"}`, p.type || "unparseable"));
    if (p.fm.journal_date) top.append(el("span", "chip muted", `journal ${p.fm.journal_date}`));
    card.append(top);

    if (parseable) {
      card.append(el("p", null, proposalSummary(p)));
    } else {
      card.append(el("p", "warn", "Couldn't parse this proposal — review it directly:"));
    }
    if (p.body) {
      const body = el("p", "muted");
      body.textContent = p.body.length > 300 ? p.body.slice(0, 300) + "…" : p.body;
      card.append(body);
    }
    const link = el("a", "muted", "open in repo ↗");
    link.href = blobUrl(p.path);
    link.target = "_blank";
    link.rel = "noopener";
    card.append(link);

    const row = el("div", "floors");
    if (parseable) {
      const yes = el("button", "primary", "✓ Accept");
      const no = el("button", null, "✗ Reject");
      yes.addEventListener("click", () => decide([{ proposal: p, action: "accept" }], note, [yes, no]));
      no.addEventListener("click", () => decide([{ proposal: p, action: "reject" }], note, [yes, no]));
      row.append(yes, no);
    }
    card.append(row);
    view.append(card);
  }
}
