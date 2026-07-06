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
