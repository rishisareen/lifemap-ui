// model.js — pure logic, no DOM, no network. Everything here runs under node --test.
//
// PAIRED-CHANGE NOTE: parsing rules mirror lifemap/_System/bin/lifemap_compile.py
// (frontmatter, CSV, weekly-plan MIT lines). Change them together.

export const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const MONS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ---------- frontmatter ----------

export function parseFrontmatter(text) {
  const m = /^\s*---\n([\s\S]*?)\n---/.exec(text);
  if (!m) return {};
  const fm = {};
  for (const line of m[1].split("\n")) {
    const kv = /^(\w+):\s*(.*)$/.exec(line);
    if (kv) fm[kv[1]] = kv[2].trim().replace(/^"|"$/g, "");
  }
  return fm;
}

export function setFrontmatterField(text, key, value) {
  const quoted = /^[\w.-]+$/.test(String(value)) ? String(value) : `"${String(value).replace(/"/g, "'")}"`;
  const re = new RegExp(`^${key}:.*$`, "m");
  const fmEnd = text.indexOf("\n---", 4);
  if (fmEnd < 0) throw new Error("no frontmatter block");
  const head = text.slice(0, fmEnd);
  if (re.test(head)) return head.replace(re, `${key}: ${quoted}`) + text.slice(fmEnd);
  return head + `\n${key}: ${quoted}` + text.slice(fmEnd);
}

// ---------- commitments ----------

export function parseCommitment(text) {
  const fm = parseFrontmatter(text);
  const constraints = text.split("\n")
    .filter((ln) => ln.trim().startsWith("**Constraint"))
    .map((ln) => ln.replace(/\*\*/g, "").replace(/^[-\s]+/, "").trim());
  return {
    id: fm.id || null,
    title: fm.title || "",
    pillar: fm.pillar || "",
    state: fm.state || "",
    isRock: (fm.is_rock || "false").toLowerCase() === "true",
    carryCount: parseInt(fm.carry_count || "0", 10) || 0,
    gateDate: fm.gate_date || null,
    reviewBy: fm.review_by || null,
    closedOn: fm.closed_on || null,
    targetMetric: fm.target_metric || null,
    targetValue: fm.target_value ? parseFloat(fm.target_value) : null,
    targetDate: fm.target_date || null,
    forcingFunction: fm.forcing_function || "",
    constraints,
    fm,
  };
}

// Insert a log line directly under "## Log" (newest first, matching the ledger convention).
export function appendLogLine(text, line) {
  const m = /^##\s*Log.*$/m.exec(text);
  if (!m) return text.trimEnd() + `\n\n## Log\n\n${line}\n`;
  const idx = m.index + m[0].length;
  return text.slice(0, idx) + `\n\n${line}` + text.slice(idx).replace(/^\n+/, "\n");
}

// Check a milestone checkbox by its (partial) text. Returns null if not found.
export function checkMilestone(text, payloadText) {
  const needle = payloadText.trim().toLowerCase().slice(0, 30);
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*-\s*\[ \]/.test(lines[i]) && lines[i].toLowerCase().includes(needle)) {
      lines[i] = lines[i].replace("- [ ]", "- [x]");
      return lines.join("\n");
    }
  }
  return null;
}

// ---------- board: lifecycle transitions ----------
//
// Each returns { text } (the rewritten commitment file). Rules mirror
// _System/OS-Manual.md: commit needs a gate; close needs done|retired
// (+reason); reschedule keeps state active, bumps carry, needs a new gate.

export function boardColumn(c) {
  if (c.state === "idea") return "ideas";
  if (c.state === "committed") return "committed";
  if (c.state === "done" || c.state === "retired") return "closed";
  return "active"; // active, blocked
}

export function transition(text, { to, gate, disposition, reason, today }) {
  if (to === "committed") {
    if (!gate) throw new Error("A gate date is required to commit (OS-Manual rule 1).");
    let t = setFrontmatterField(text, "state", "committed");
    t = setFrontmatterField(t, "committed_on", today);
    t = setFrontmatterField(t, "gate_date", gate);
    return { text: appendLogLine(t, `- ${today} — Committed (gate ${gate})`) };
  }
  if (to === "active") {
    return { text: setFrontmatterField(text, "state", "active") };
  }
  if (to === "closed") {
    if (disposition !== "done" && disposition !== "retired") throw new Error("Closing needs done or retired.");
    if (disposition === "retired" && !reason?.trim()) throw new Error("A reason is required to retire.");
    let t = setFrontmatterField(text, "state", disposition);
    t = setFrontmatterField(t, "closed_on", today);
    const line = disposition === "done" ? "Done." : `Retired: ${reason.trim()}`;
    return { text: appendLogLine(t, `- ${today} — ${line}`) };
  }
  throw new Error(`unknown transition target: ${to}`);
}

export function reschedule(text, { gate, today, note }) {
  if (!gate) throw new Error("A new gate date is required to reschedule.");
  const carry = (parseInt(parseFrontmatter(text).carry_count || "0", 10) || 0) + 1;
  let t = setFrontmatterField(text, "carry_count", String(carry));
  t = setFrontmatterField(t, "gate_date", gate);
  t = setFrontmatterField(t, "state", "active");
  const tail = note?.trim() ? `: ${note.trim()}` : "";
  return { text: appendLogLine(t, `- ${today} — Rescheduled to ${gate} (carry #${carry})${tail}`) };
}

// Would moving `card` into `toColumn` exceed the 3-rock budget? Only rocks
// landing in active/committed count; a rock already counted (same column
// family) doesn't re-trip it.
export function rockBudgetBlocks(card, toColumn, allCommitments) {
  if (!card.isRock) return false;
  if (toColumn !== "active" && toColumn !== "committed") return false;
  const counted = allCommitments.filter(
    (c) => c.isRock && (c.state === "active" || c.state === "committed") && !(card.id && c.id === card.id));
  return counted.length >= 3;
}

export function newIdeaFile(title, pillar, today, existingPaths) {
  let slug = slugify(title);
  let path = `Ledger/Commitments/${slug}.md`;
  for (let n = 2; existingPaths.has(path); n++) path = `Ledger/Commitments/${slug}-${n}.md`;
  const idFromPath = path.slice("Ledger/Commitments/".length, -3);
  const text = [
    "---", `id: ${idFromPath}`, `title: "${title.replace(/"/g, "'")}"`, `pillar: ${pillar}`,
    "horizon: idea", "is_rock: false", "state: idea", `captured_on: ${today}`,
    "carry_count: 0", 'forcing_function: ""', "---", "",
    `*Captured ${today} via the board. Promote to Committed with a gate date when it's real.*`, "",
    "## Log", "",
  ].join("\n") + "\n";
  return { path, text };
}

// ---------- CSV (metrics) ----------

export function parseCSV(text) {
  const rows = [];
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  if (!lines.length) return { header: [], rows };
  const header = splitCSVLine(lines[0]);
  for (const ln of lines.slice(1)) {
    const cells = splitCSVLine(ln);
    const row = {};
    header.forEach((h, i) => (row[h] = cells[i] ?? ""));
    rows.push(row);
  }
  return { header, rows };
}

function splitCSVLine(line) {
  const out = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function csvField(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvAppend(text, row) {
  const line = [row.date, row.value, row.source, row.note ?? ""].map(csvField).join(",");
  return text.replace(/\n*$/, "\n") + line + "\n";
}

// Replace/remove by (date, source). Used for same-day correction and delete.
export function csvUpsert(text, row) {
  const { header, rows } = parseCSV(text);
  const kept = rows.filter((r) => !(r.date === row.date && r.source === row.source));
  kept.push(row);
  kept.sort((a, b) => a.date.localeCompare(b.date));
  return [header.join(","), ...kept.map((r) => [r.date, r.value, r.source, r.note ?? ""].map(csvField).join(","))].join("\n") + "\n";
}

export function latestMetric(rows) {
  const valid = rows.filter((r) => r.value && /^\d{4}-\d{2}-\d{2}/.test(r.date));
  if (!valid.length) return null;
  const best = valid.reduce((a, b) => (b.date >= a.date ? b : a));
  return best;
}

export const METRIC_RANGES = {
  weight: [40, 150], steps: [0, 60000], protein: [0, 400], sleep_quality: [1, 5],
};

export function validateMetric(name, value) {
  const v = parseFloat(value);
  if (!Number.isFinite(v)) return `not a number: ${value}`;
  const r = METRIC_RANGES[name];
  if (r && (v < r[0] || v > r[1])) return `${name} ${v} outside plausible range ${r[0]}–${r[1]}`;
  return null;
}

// ---------- dates & weeks (canonical timezone: Asia/Kolkata) ----------

export function todayIST(now = new Date()) {
  const s = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // YYYY-MM-DD
  return s;
}

export function isoWeek(dateStr) {
  const d = new Date(dateStr + "T12:00:00Z");
  const day = (d.getUTCDay() + 6) % 7; // Mon=0
  d.setUTCDate(d.getUTCDate() - day + 3); // nearest Thursday
  const isoYear = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4, 12));
  const week1Thu = new Date(jan4);
  week1Thu.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + 3);
  return { year: isoYear, week: 1 + Math.round((d - week1Thu) / (7 * 864e5)) };
}

export function weeklyPlanPath(isoYearWeek) {
  const w = String(isoYearWeek.week).padStart(2, "0");
  return `Weekly Plan/${isoYearWeek.year}/${isoYearWeek.year} - Weekly Plan - W${w}.md`;
}

export function journalPath(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return `Daily Journal/${y}/${String(m).padStart(2, "0")} (${MONS[m - 1]})/${String(d).padStart(2, "0")}-${MONS[m - 1]}.md`;
}

// ---------- day plan (mirrors _System/bin/day_plan.py — PAIRED CHANGE) ----------

const TODAY3_START = "<!-- today3-start -->";
const TODAY3_END = "<!-- today3-end -->";
const VALID_VERDICTS = ["done", "slipped", "dropped", "unverified"];
const R13_MARKER = "no plan arrived";
const MIT_RE = /^\d+\.\s+(.+?)\s+\[([^\]]+)\]\s+⟨([^⟩]+)⟩\s*$/;
const VERDICT_RE = new RegExp(`^-\\s*(${VALID_VERDICTS.join("|")})\\s*—\\s*(.+)$`);
const SCHEDULE_RE = /^-\s*(\d{2}:\d{2})–(\d{2}:\d{2})\s+\[([^\]]+)\]\s+(.+)$/;

export function dayPlanPath(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return `Plans/Daily/${y}/${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}-Plan.md`;
}

function daySection(text, header, nextHeaders) {
  const start = text.indexOf(header);
  if (start < 0) return null;
  const from = start + header.length;
  let end = text.length;
  for (const h of nextHeaders) {
    const i = text.indexOf(h, from);
    if (i >= 0) end = Math.min(end, i);
  }
  return text.slice(from, end).replace(/^\n+|\n+$/g, "");
}

// Combines parse + validate: returns { error } (structured, never throws) on
// any malformed input, or the parsed day-plan fields on success.
export function parseDayPlan(text) {
  const fm = parseFrontmatter(text);
  if (fm.generated_by !== "agent" && fm.generated_by !== "fallback") {
    return { error: `generated_by must be 'agent' or 'fallback', got ${JSON.stringify(fm.generated_by)}` };
  }
  if (!fm.date) return { error: "missing or malformed date" };
  if (!fm.generated_at) return { error: "missing generated_at" };

  const today3Block = daySection(text, TODAY3_START, [TODAY3_END]);
  if (today3Block == null) return { error: "missing Today's 3 block (today3-start/end markers)" };
  const rawToday3 = today3Block.split("\n").map((l) => l.trim()).filter(Boolean);
  const today3 = [];
  for (const ln of rawToday3) {
    const m = MIT_RE.exec(ln);
    if (m) today3.push({ text: m[1], pillar: m[2], source: m[3] });
  }
  if (today3.length !== rawToday3.length) return { error: "malformed Today's 3 line(s)" };
  if (today3.length < 1 || today3.length > 3) return { error: `Today's 3 must have 1-3 items, got ${today3.length}` };

  const yesterdayBlock = daySection(text, "## Yesterday", ["## Context", "## Schedule"]);
  if (yesterdayBlock == null) return { error: "missing ## Yesterday section" };
  const rawYesterday = yesterdayBlock.split("\n").map((l) => l.trim()).filter(Boolean);
  const yesterday = [];
  for (const ln of rawYesterday) {
    const m = VERDICT_RE.exec(ln);
    if (m) yesterday.push({ verdict: m[1], text: m[2] });
  }
  if (yesterday.length !== rawYesterday.length) return { error: "malformed ## Yesterday verdict line(s)" };

  const contextBlock = daySection(text, "## Context", ["## Schedule"]);
  if (contextBlock == null) return { error: "missing ## Context section" };

  // Schedule (Unit 6) is optional in every phase — checked only when present.
  const scheduleBlock = daySection(text, "## Schedule", []);
  let schedule = [];
  if (scheduleBlock != null) {
    const rawSchedule = scheduleBlock.split("\n").map((l) => l.trim()).filter(Boolean);
    schedule = [];
    for (const ln of rawSchedule) {
      const m = SCHEDULE_RE.exec(ln);
      if (m) schedule.push({ start: m[1], end: m[2], pillar: m[3], label: m[4] });
    }
    if (schedule.length !== rawSchedule.length) return { error: "malformed ## Schedule line(s)" };
  }

  return {
    date: fm.date, generatedBy: fm.generated_by, generatedAt: fm.generated_at,
    today3, yesterday, context: contextBlock.trim(), schedule,
  };
}

// Parses the JOURNAL's Today's 3 shape (bold label + anchor comment +
// bullets), NOT the day-plan frontmatter shape. Returns
// { status: "ok"|"absent"|"marker", items: [str, ...] }.
export function extractJournalToday3(text) {
  const m = /\*\*Today's 3\*\*.*?\n/.exec(text);
  if (!m) return { status: "absent", items: [] };
  const rest = text.slice(m.index + m[0].length);
  const stop = /\n\s*(\*\*[^\n]+\*\*|---)/.exec(rest);
  const block = stop ? rest.slice(0, stop.index) : rest;
  const items = [];
  for (const ln of block.split("\n")) {
    const bm = /^\s*-\s+(.*\S)\s*$/.exec(ln);
    if (bm) items.push(bm[1].trim());
  }
  if (items.some((it) => it.includes(R13_MARKER))) return { status: "marker", items: [] };
  return { status: "ok", items };
}

export function daysBetween(fromStr, toStr) {
  return Math.round((new Date(toStr + "T12:00Z") - new Date(fromStr + "T12:00Z")) / 864e5);
}

export function fmtDays(n) {
  return n === 0 ? "TODAY" : n === 1 ? "TOMORROW" : n > 0 ? `${n}d` : `OVERDUE ${-n}d`;
}

// ---------- weekly plan MIT lines ----------

export function todaysMits(planText, dateStr) {
  const wd = WD[(new Date(dateStr + "T12:00Z").getUTCDay() + 6) % 7];
  const re = new RegExp(`^\\s*-\\s*\\[[ xX]\\]\\s*\\**(${wd})\\b[^—-]*\\**\\s*[—-]\\s*(.+)$`);
  for (const raw of planText.split("\n")) {
    const m = re.exec(raw.trim());
    if (m) {
      const items = m[2].split(/\(\d\)\s*/).map((s) => s.replace(/[ .]+$/g, "").trim()).filter(Boolean);
      return items.length > 1 ? items : [m[2].trim()];
    }
  }
  return [];
}

// ---------- weekly review wizard ----------

export function mondayOfISOWeek({ year, week }) {
  const jan4 = new Date(Date.UTC(year, 0, 4, 12));
  const jan4Mon = new Date(jan4);
  jan4Mon.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7)); // Monday of ISO week 1
  jan4Mon.setUTCDate(jan4Mon.getUTCDate() + (week - 1) * 7);
  return jan4Mon.toISOString().slice(0, 10);
}

// Fri–Sun → plan next week; Mon–Thu → the current week.
export function reviewTargetWeek(todayStr) {
  const weekday = (new Date(todayStr + "T12:00Z").getUTCDay() + 6) % 7; // Mon=0
  if (weekday >= 4) { // Fri, Sat, Sun
    const nextMon = new Date(todayStr + "T12:00Z");
    nextMon.setUTCDate(nextMon.getUTCDate() + (7 - weekday));
    return isoWeek(nextMon.toISOString().slice(0, 10));
  }
  return isoWeek(todayStr);
}

export function weeklyDraftPath({ year, week }) {
  return `Plans/_drafts/${year} - Weekly Plan - W${String(week).padStart(2, "0")}.md`;
}
export function weeklyFinalPath({ year, week }) {
  return `Weekly Plan/${year}/${year} - Weekly Plan - W${String(week).padStart(2, "0")}.md`;
}

export function windowLabel(mondayStr) {
  const mon = new Date(mondayStr + "T12:00Z");
  const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6);
  const f = (d) => `${MONS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return `${f(mon)} → ${f(sun)}`;
}

const WIZ_SECTIONS = {
  celebrate: "## STEP THREE : CELEBRATE LAST WEEK",
  misses: "## STEP FOUR : ANALYZE WHAT DIDN'T HAPPEN",
  outcomes: "## STEP FIVE : TOP OUTCOMES",
  mits: "## STEP SIX : SCHEDULE",
  theme: "## 🎯 Theme",
  truth: "## 🪞 One Uncomfortable Truth",
};

export function buildWeeklyPlan(state, status) {
  const { target, rocks = [], celebrate = [], misses = [], outcomes = [] } = state;
  const monday = mondayOfISOWeek(target);
  const mits = state.mits || {};
  const dayDate = (i) => {
    const d = new Date(monday + "T12:00Z"); d.setUTCDate(d.getUTCDate() + i);
    return `${MONS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  };
  const lines = [
    "---",
    `week: ${target.year}-W${String(target.week).padStart(2, "0")}`,
    `window: ${windowLabel(monday)}`,
    `status: ${status}`,
    `rocks: ${rocks.join(", ")}`,
    "---", "",
    `## 🗓️ Weekly Plan (W${target.week})`, "",
    `Date: ${monday} Monday — window ${windowLabel(monday)}`, "",
    WIZ_SECTIONS.celebrate, "",
    ...(celebrate.length ? celebrate.map((c) => `- ${c}`) : ["- "]), "",
    WIZ_SECTIONS.misses, "",
    ...(misses.length ? misses.map((m) => `- ${m}`) : ["- "]), "",
    WIZ_SECTIONS.outcomes, "",
    ...(outcomes.length ? outcomes.map((o, i) => `${i + 1}. ${o}`) : ["1. "]), "",
    WIZ_SECTIONS.mits, "",
    ...WD.map((wd, i) => `- [ ] **${wd} ${dayDate(i)}** — ${mits[wd] || ""}`.trimEnd()), "",
    WIZ_SECTIONS.theme, "",
    `> ${state.theme || ""}`, "",
    WIZ_SECTIONS.truth, "",
    state.truth || "",
    "",
    "*I am a warrior monk.*", "",
  ];
  return lines.join("\n");
}

export function parseWeeklyPlan(text) {
  const fm = parseFrontmatter(text);
  const [year, week] = (fm.week || "-W").split("-W");
  const allHeadings = Object.values(WIZ_SECTIONS);
  // A section runs to the NEAREST following known heading that is actually
  // present, so partial AI files (missing sections) still parse correctly.
  const section = (heading) => {
    const start = text.indexOf(heading);
    if (start < 0) return "";
    const from = start + heading.length;
    let end = text.length;
    for (const h of allHeadings) {
      if (h === heading) continue;
      const i = text.indexOf(h, from);
      if (i >= 0 && i < end) end = i;
    }
    return text.slice(from, end).trim();
  };
  const bullets = (s) => s.split("\n").map((l) => l.replace(/^\s*-\s?/, "").trim())
    .filter((l) => l !== "");
  const numbered = (s) => s.split("\n").map((l) => l.replace(/^\s*\d+\.\s?/, "").trim())
    .filter((l) => l !== "");

  const celebrate = bullets(section(WIZ_SECTIONS.celebrate, WIZ_SECTIONS.misses));
  const misses = bullets(section(WIZ_SECTIONS.misses, WIZ_SECTIONS.outcomes));
  const outcomes = numbered(section(WIZ_SECTIONS.outcomes, WIZ_SECTIONS.mits));
  const mitBlock = section(WIZ_SECTIONS.mits, WIZ_SECTIONS.theme);
  const mits = {};
  for (const wd of WD) {
    const m = new RegExp(`- \\[[ xX]\\] \\*\\*${wd} [^*]+\\*\\* — (.*)`).exec(mitBlock);
    mits[wd] = m ? m[1].trim() : "";
  }
  const theme = section(WIZ_SECTIONS.theme, WIZ_SECTIONS.truth).replace(/^>\s?/, "").trim();
  let truth = section(WIZ_SECTIONS.truth, null);
  truth = truth.replace(/\n+\*I am a warrior monk\.\*\s*$/, "").trim();

  return {
    target: { year: parseInt(year, 10), week: parseInt(week, 10) },
    rocks: (fm.rocks || "").split(",").map((s) => s.trim()).filter(Boolean),
    celebrate, misses, outcomes, mits, theme, truth,
  };
}

export function buildWeeklyDraft(state) {
  return {
    message: `ui: weekly review draft W${state.target.week}`,
    changes: [{ path: weeklyDraftPath(state.target), text: buildWeeklyPlan(state, "draft") }],
    deletions: [],
  };
}

// Commit the week: final plan (committed) + delete draft + apply each carry
// decision to its commitment file — all one atomic op.
export function buildWeeklyCommit(state, decisions, files, today) {
  const changes = [{ path: weeklyFinalPath(state.target), text: buildWeeklyPlan(state, "committed") }];
  for (const d of decisions || []) {
    const path = `Ledger/Commitments/${d.id}.md`;
    const cur = files[path];
    if (cur == null) continue; // archived/renamed meanwhile — skip gracefully
    if (d.action === "reschedule") {
      changes.push({ path, text: reschedule(cur, { gate: d.gate, today, note: d.note }).text });
    } else if (d.action === "retire") {
      changes.push({ path, text: transition(cur, { to: "closed", disposition: "retired", reason: d.reason, today }).text });
    }
  }
  return {
    message: `ui: commit weekly plan W${state.target.week}`,
    changes,
    deletions: [weeklyDraftPath(state.target)],
  };
}

export function weeklyAIPath(target) {
  return weeklyDraftPath(target).replace(/\.md$/, "-ai.md");
}

// Append b's items to a, skipping ones already present (case/space-insensitive).
export function mergeLines(a, b) {
  const seen = new Set(a.map((x) => x.trim().toLowerCase()));
  const out = [...a];
  for (const x of b) {
    const k = x.trim().toLowerCase();
    if (k && !seen.has(k)) { seen.add(k); out.push(x); }
  }
  return out;
}

// ---------- inbox proposals ----------

export const PROPOSAL_TYPES = ["metric", "log", "milestone", "lesson", "idea"];

export function parseProposal(path, text) {
  const fm = parseFrontmatter(text);
  const body = text.replace(/^\s*---\n[\s\S]*?\n---\n?/, "").trim();
  return { path, id: fm.id || null, type: fm.type || null, fm, body };
}

// Plan the file operations for accepting a proposal. Pure: takes current file
// texts, returns {changes:[{path, text}], deletions:[path], processedLine}.
export function planAccept(proposal, files, today) {
  const { fm } = proposal;
  const changes = [];
  if (fm.type === "metric") {
    const path = `Ledger/Metrics/${fm.target}.csv`;
    const cur = files[path] ?? "date,value,source,note\n";
    changes.push({ path, text: csvUpsert(cur, { date: fm.payload_date, value: fm.payload_value, source: "clerk", note: "" }) });
  } else if (fm.type === "log") {
    const path = `Ledger/Commitments/${fm.target}.md`;
    if (!(path in files)) throw new Error(`stale: target ${fm.target} not found (archived?)`);
    changes.push({ path, text: appendLogLine(files[path], `- ${fm.payload_date} — ${fm.payload_text} (via clerk)`) });
  } else if (fm.type === "milestone") {
    const path = `Ledger/Commitments/${fm.target}.md`;
    if (!(path in files)) throw new Error(`stale: target ${fm.target} not found (archived?)`);
    const updated = checkMilestone(files[path], fm.payload_text);
    if (!updated) throw new Error(`stale: milestone not found in ${fm.target}`);
    changes.push({ path, text: updated });
  } else if (fm.type === "lesson") {
    const year = (fm.payload_date || today).slice(0, 4);
    const path = `Ledger/lessons-${year}.md`;
    const cur = files[path] ?? `# Lessons — ${year}\n`;
    const line = `- **${fm.payload_date} · ${fm.pillar}** — ${fm.payload_text} *(journal ${fm.journal_date})*`;
    changes.push({ path, text: cur.replace(/\n*$/, "\n") + line + "\n" });
  } else if (fm.type === "idea") {
    const slug = slugify(fm.payload_text);
    const path = `Ledger/Commitments/${slug}.md`;
    if (path in files) throw new Error(`slug collision: ${slug}`);
    changes.push({ path, text: ideaFile(slug, fm, today) });
  } else {
    throw new Error(`unknown proposal type: ${fm.type}`);
  }
  return {
    changes,
    deletions: [proposal.path],
    processedLine: `- applied ${proposal.id} — ${today}`,
  };
}

export function planReject(proposal, today) {
  return { changes: [], deletions: [proposal.path], processedLine: `- rejected ${proposal.id} — ${today}` };
}

// Batch several accept/reject decisions into ONE commit op. Proposals are
// applied SEQUENTIALLY against a working copy, so two proposals touching the
// same file stack instead of clobbering. Already-gone proposal files are
// skipped (double-tap / concurrent session = no-op). Stale targets are
// reported, not written, and their proposal files are kept for the UI.
// Returns null when there is nothing left to do.
export function buildInboxCommit(decisions, files, today) {
  const working = { ...files };
  const touched = new Set();
  const deletions = [];
  const applied = [], rejected = [], stale = [];
  const processedLines = [];

  for (const { proposal, action } of decisions) {
    if (!(proposal.path in working)) continue; // already processed elsewhere
    let plan;
    try {
      plan = action === "accept" ? planAccept(proposal, working, today) : planReject(proposal, today);
    } catch (e) {
      stale.push({ path: proposal.path, id: proposal.id, reason: e.message });
      continue;
    }
    for (const c of plan.changes) {
      working[c.path] = c.text;
      touched.add(c.path);
    }
    for (const d of plan.deletions) {
      deletions.push(d);
      delete working[d];
    }
    processedLines.push(plan.processedLine);
    (action === "accept" ? applied : rejected).push(proposal.id);
  }

  if (!processedLines.length) return stale.length ? { message: "", changes: [], deletions: [], applied, rejected, stale } : null;

  const PROCESSED = "Ledger/Inbox/_processed.md";
  const cur = working[PROCESSED] ?? "- baseline 2026-07-05\n";
  working[PROCESSED] = cur.replace(/\n*$/, "\n") + processedLines.join("\n") + "\n";
  touched.add(PROCESSED);

  const parts = [];
  if (applied.length) parts.push(`applied ${applied.length}`);
  if (rejected.length) parts.push(`rejected ${rejected.length}`);
  return {
    message: `ui: inbox — ${parts.join(", ")}`,
    changes: [...touched].map((path) => ({ path, text: working[path] })),
    deletions, applied, rejected, stale,
  };
}

// One human line per proposal card.
export function proposalSummary(p) {
  const f = p.fm;
  switch (f.type) {
    case "metric": return `${f.target} = ${f.payload_value} on ${f.payload_date}`;
    case "log": return `log on ${f.target}: “${f.payload_text}” (${f.payload_date})`;
    case "milestone": return `milestone done on ${f.target}: “${f.payload_text}”`;
    case "lesson": return `lesson [${f.pillar}]: “${f.payload_text}”`;
    case "idea": return `new idea [${f.pillar}]: “${f.payload_text}”`;
    default: return `unknown proposal type`;
  }
}

export function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").split("-").slice(0, 5).join("-");
}

function ideaFile(slug, fm, today) {
  return [
    "---", `id: ${slug}`, `title: "${String(fm.payload_text).replace(/"/g, "'")}"`,
    `pillar: ${fm.pillar}`, "horizon: idea", "is_rock: false", "state: idea",
    `captured_on: ${today}`, "carry_count: 0", 'forcing_function: ""', "---", "",
    `*Captured from journal ${fm.journal_date} via Clerk. Promote via the board — a gate date is required to commit.*`, "",
  ].join("\n");
}

// ---------- habits / floors ----------

// Mirrors lifemap_compile.py active_floors(): rows of the table under
// "## Active daily floors", first two columns.
export function parseFloors(text) {
  const m = /## Active daily floors[^\n]*\n([\s\S]*?)(\n## |$)/.exec(text);
  if (!m) return [];
  const floors = [];
  for (const ln of m[1].split("\n")) {
    const cells = ln.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    if (cells.length >= 2 && cells[0] && cells[0] !== "habit" && !/^-+$/.test(cells[0])) {
      floors.push({ habit: cells[0], floor: cells[1] });
    }
  }
  return floors;
}

// Which metric CSV (if any) a floor logs to; "journal" = journal-presence
// status; "status" = clerk-judged, display only.
export function floorKind(floor) {
  const map = { "steps-10k": "steps", "protein-floor": "protein" };
  if (map[floor.habit]) return map[floor.habit];
  if (floor.habit === "evening-journal") return "journal";
  return "status";
}

// ---------- weekly plan selection (client-side mirror of weekly_plan()) ----------

// Candidate plan paths for the ISO week: exact week first, then earlier weeks
// descending. Caller reads them in order and takes the first non-draft.
export function weeklyPlanCandidates(paths, { year, week }) {
  const out = [];
  const re = new RegExp(`^Weekly Plan/${year}/${year} - Weekly Plan - W(\\d+)\\.md$`);
  for (const p of paths) {
    const m = re.exec(p);
    if (m) {
      const w = parseInt(m[1], 10);
      if (w <= week) out.push({ week: w, path: p });
    }
  }
  return out.sort((a, b) => b.week - a.week);
}

// ---------- gate chips (live countdowns — never from compiled artifacts) ----------

export function gateChips(commitments, todayStr) {
  const chips = [];
  for (const c of commitments) {
    if (c.state !== "active" && c.state !== "committed") continue;
    for (const [kind, d] of [["gate", c.gateDate], ["review", c.reviewBy]]) {
      if (!d) continue;
      if (kind === "review" && c.gateDate) continue; // gate is the sharper signal
      const n = daysBetween(todayStr, d);
      chips.push({
        title: c.title, days: n,
        label: `${kind} ${fmtDays(n)}`,
        cls: n < 0 ? "overdue" : n <= 1 ? "urgent" : n <= 3 ? "soon" : "later",
      });
    }
  }
  return chips.sort((a, b) => a.days - b.days);
}

// ---------- metric logging (the batched write op) ----------

export const METRIC_FILES = {
  weight: "Ledger/Metrics/weight.csv",
  steps: "Ledger/Metrics/steps.csv",
  protein: "Ledger/Metrics/protein.csv",
  sleep_quality: "Ledger/Metrics/sleep_quality.csv",
};

// pending: {metric: value}. Validates everything BEFORE building any change,
// then upserts each metric's (today, ui) row. One commit for the whole batch.
export function buildMetricCommit(pending, files, today) {
  const entries = Object.entries(pending).filter(([, v]) => v !== "" && v != null);
  if (!entries.length) throw new Error("nothing to log");
  for (const [name, value] of entries) {
    if (!METRIC_FILES[name]) throw new Error(`unknown metric: ${name}`);
    const err = validateMetric(name, value);
    if (err) throw new Error(err);
  }
  const changes = entries.map(([name, value]) => {
    const path = METRIC_FILES[name];
    const cur = files[path] ?? "date,value,source,note\n";
    return { path, text: csvUpsert(cur, { date: today, value: String(value), source: "ui", note: "" }) };
  });
  const message = "ui: log " + entries.map(([n, v]) => `${n} ${v}`).join(", ");
  return { message, changes, deletions: [] };
}

// What's already logged today (any source) — fills the inputs' "done" state.
export function todaysLoggedValues(files, today) {
  const out = {};
  for (const [name, path] of Object.entries(METRIC_FILES)) {
    if (!(path in files)) continue;
    const rows = parseCSV(files[path]).rows.filter((r) => r.date === today);
    if (rows.length) out[name] = rows[rows.length - 1].value;
  }
  return out;
}

// ---------- header status ----------

export function classifyCommit(message) {
  if (/^sync:/.test(message)) return "bridge";
  if (/^lifemap:/.test(message)) return "actions";
  if (/^(ui|planner|clerk):/.test(message)) return /^ui:/.test(message) ? "ui" : "actions";
  return "manual";
}

export function ageString(fromMs, nowMs) {
  const s = Math.max(0, Math.round((nowMs - fromMs) / 1000));
  if (s < 90) return `${s}s`;
  if (s < 5400) return `${Math.round(s / 60)}m`;
  if (s < 172800) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

// ---------- journal guard (the sacred invariant, in code) ----------

export function assertNotJournalPath(path) {
  if (/^Daily Journal\//.test(path) || path.includes("/Daily Journal/")) {
    throw new Error(`REFUSED: write to journal path ${path}`);
  }
  return path;
}
