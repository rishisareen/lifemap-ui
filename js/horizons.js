// horizons.js — quarterly/annual goals at a glance (read-only).
// Facts only: title, gate countdown, carry count, metric readout, success
// criteria — never a computed "on pace / behind" verdict. That judgment
// stays in the authored review, one tap away via each section's review link.

import {
  todayIST, parseCommitment, parseCSV, quarterRocks, thisMonthGates, annualGoals,
  metricReadout, quarterOf, reviewPath, blobUrl, daysBetween, fmtDays, truncate,
  gateUrgencyClass, METRIC_FILES, UNITS,
} from "./model.js?v=12";

export async function renderHorizons(gh, view) {
  const today = todayIST();
  const { entries, headOid } = await gh.tree();
  const commitmentPaths = [...entries.keys()].filter((p) => /^Ledger\/Commitments\/.+\.md$/.test(p));

  const files = await gh.readFiles([...commitmentPaths, ...Object.values(METRIC_FILES)], headOid, { tolerant: true });
  const commitments = commitmentPaths.map((p) => parseCommitment(files[p] ?? "")).filter((c) => c.id);
  // Map, not a plain object: target_metric is free-text frontmatter, and a
  // value like "__proto__" or "constructor" would otherwise resolve through
  // the prototype chain instead of missing cleanly.
  const metricRows = new Map();
  for (const [name, path] of Object.entries(METRIC_FILES)) {
    metricRows.set(name, files[path] != null ? parseCSV(files[path]).rows : []);
  }

  view.replaceChildren();
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  // Section-level review link — only when the authored file actually exists
  // in the tree (early-month files may not be written yet; omit, don't 404).
  const reviewLink = (horizon) => {
    const path = reviewPath(horizon, today);
    if (!path || !entries.has(path)) return null;
    const a = el("a", "muted", "review ↗");
    a.href = blobUrl(path);
    a.target = "_blank";
    a.rel = "noopener";
    return a;
  };

  const sectionHead = (title, horizon) => {
    const head = el("div", "cardtop");
    head.append(el("h2", null, title));
    const link = reviewLink(horizon);
    if (link) head.append(link);
    return head;
  };

  // A gate-fact chip shared by all three sections: colored countdown when a
  // gate_date exists, the same muted "no gate set" fact when it doesn't —
  // never a verdict like "drifting", never inferred from forcing_function.
  const gateChip = (gateDate) => {
    if (!gateDate) return el("span", "chip muted", "no gate set");
    const n = daysBetween(today, gateDate);
    return el("span", `chip ${gateUrgencyClass(n)}`, `gate ${fmtDays(n)}`);
  };

  // Metric readout label. target/latest are guarded with Number.isFinite —
  // target_value can be absent (target: null) or non-numeric (target: NaN,
  // if someone writes a non-numeric target_value); latest is a raw CSV
  // string that can likewise be missing or garbage. Never interpolate a
  // non-finite value into the chip text (that would print the literal
  // string "null" or "NaN").
  const metricChip = (c) => {
    const r = metricReadout(c, metricRows.get(c.targetMetric) || [], today);
    const unit = UNITS[c.targetMetric] || "";
    const target = Number.isFinite(r.target) ? `${r.target}${unit ? ` ${unit}` : ""}` : "no target set";
    const latest = Number.isFinite(Number(r.latest)) ? r.latest : null;
    const label = latest != null
      ? `${latest} → ${target}${r.daysLeft != null ? ` · ${fmtDays(r.daysLeft)} left` : ""}`
      : `— → ${target}`;
    return el("span", "chip", label);
  };

  const { year, q } = quarterOf(today);

  // ---- This Quarter ----
  const qCard = el("div", "card");
  qCard.append(sectionHead("This Quarter", `${year}-Q${q}`));
  const rocks = quarterRocks(commitments);
  if (!rocks.length) {
    qCard.append(el("p", "muted", "No active rocks this quarter."));
  } else {
    for (const c of rocks) {
      const row = el("div", "commit-card");
      const top = el("div", "cardtop");
      top.append(el("strong", null, c.title || c.id));
      top.append(el("span", "chip muted", c.pillar || "—"));
      row.append(top);
      if (c.successCriteria) row.append(el("p", null, truncate(c.successCriteria, 160)));
      if (c.forcingFunction) row.append(el("p", "muted", truncate(c.forcingFunction, 160)));

      const meta = el("div", "floors");
      meta.append(gateChip(c.gateDate));
      if (c.carryCount >= 3) meta.append(el("span", "chip warn", `carry ${c.carryCount}`));
      if (c.targetMetric) meta.append(metricChip(c));
      row.append(meta);
      qCard.append(row);
    }
  }
  view.append(qCard);

  // ---- This Month ----
  const moCard = el("div", "card");
  moCard.append(sectionHead("This Month", today.slice(0, 7)));
  const gates = thisMonthGates(commitments, today);
  if (!gates.length) {
    moCard.append(el("p", "muted", "No gates land this month."));
  } else {
    for (const g of gates) {
      const row = el("div", "commit-card");
      const top = el("div", "cardtop");
      top.append(el("strong", null, g.title));
      top.append(el("span", "chip muted", g.pillar || "—"));
      row.append(top);
      const meta = el("div", "floors");
      meta.append(gateChip(g.gateDate));
      row.append(meta);
      moCard.append(row);
    }
  }
  view.append(moCard);

  // ---- This Year ----
  const yCard = el("div", "card");
  yCard.append(sectionHead("This Year", String(year)));
  const goals = annualGoals(commitments, today);
  if (!goals.length) {
    yCard.append(el("p", "muted", `No annual goals set for ${year}.`));
  } else {
    for (const c of goals) {
      const row = el("div", "commit-card");
      const top = el("div", "cardtop");
      top.append(el("strong", null, c.title || c.id));
      top.append(el("span", "chip muted", c.pillar || "—"));
      row.append(top);
      if (c.successCriteria) row.append(el("p", null, truncate(c.successCriteria, 160)));
      const meta = el("div", "floors");
      meta.append(gateChip(c.gateDate));
      row.append(meta);
      yCard.append(row);
    }
  }
  view.append(yCard);
}
