// main.js — router, header status, screen mounting.
// Unit 3 ships the frame + live status; screens land in Units 4–9.

import { connect } from "./setup.js";
import { classifyCommit, ageString } from "./model.js";

const SCREENS = {
  today:  { title: "Today",  unit: "Unit 4" },
  inbox:  { title: "Inbox",  unit: "Unit 5" },
  board:  { title: "Board",  unit: "Unit 6" },
  review: { title: "Review", unit: "Units 7–8, 10" },
  trends: { title: "Trends", unit: "Unit 9" },
};

let gh;

function currentTab() {
  const h = location.hash.replace("#", "");
  return SCREENS[h] ? h : "today";
}

function renderNav() {
  const tab = currentTab();
  document.querySelectorAll("#tabs a").forEach((a) => {
    a.classList.toggle("active", a.getAttribute("href") === `#${tab}`);
  });
}

async function renderScreen() {
  renderNav();
  const tab = currentTab();
  const view = document.getElementById("view");
  view.replaceChildren();

  const card = document.createElement("div");
  card.className = "card";
  const h = document.createElement("h2");
  h.textContent = SCREENS[tab].title;
  const p = document.createElement("p");
  p.className = "muted";
  p.textContent = `This screen arrives in ${SCREENS[tab].unit}. The foundation under it — auth, atomic writes, live repo reads — is running now (see header status).`;
  card.append(h, p);
  view.append(card);

  if (tab === "today") {
    // Foundation proof: live read of the compiled brief, so the frame is useful on day one.
    try {
      const { entries } = await gh.tree();
      const briefs = [...entries.keys()].filter((p) => /^Plans\/Daily\/.*-Brief\.md$/.test(p)).sort();
      if (briefs.length) {
        const text = await gh.readFile(briefs[briefs.length - 1]);
        const pre = document.createElement("div");
        pre.className = "card";
        const title = document.createElement("h2");
        title.textContent = "Latest compiled brief (live from the repo)";
        const body = document.createElement("pre");
        body.style.whiteSpace = "pre-wrap";
        body.style.font = "inherit";
        body.textContent = text; // textContent only — never innerHTML
        pre.append(title, body);
        view.append(pre);
      }
    } catch (e) {
      const err = document.createElement("p");
      err.className = "err";
      err.textContent = `Read failed: ${e.message}`;
      view.append(err);
    }
  }
}

async function renderStatus() {
  const el = document.getElementById("status");
  try {
    const [commits, run, { entries }] = await Promise.all([
      gh.recentCommits(20), gh.latestRun(), gh.tree(),
    ]);
    const now = Date.now();
    const latest = {};
    for (const c of commits) {
      const kind = classifyCommit(c.message);
      if (!latest[kind]) latest[kind] = ageString(new Date(c.at).getTime(), now);
    }
    const bits = [];
    for (const k of ["bridge", "actions", "ui"]) {
      if (latest[k]) bits.push(`${k} ${latest[k]}`);
    }
    const bridgeMs = commits.filter((c) => classifyCommit(c.message) === "bridge")
      .map((c) => new Date(c.at).getTime())[0];
    const stale = bridgeMs && now - bridgeMs > 12 * 3600e3;

    el.replaceChildren();
    const span = document.createElement("span");
    span.textContent = bits.join(" · ") || "no recent activity";
    if (stale) span.classList.add("stale");
    el.append(span);
    if (stale) el.append(Object.assign(document.createElement("span"), { textContent: " ⚠ bridge stale", className: "stale" }));
    if (run && run.conclusion === "failure") {
      el.append(Object.assign(document.createElement("span"), { textContent: " ✗ workflow failed", className: "failed" }));
    }
    // inbox badge from live tree
    const pending = [...entries.keys()].filter((p) => /^Ledger\/Inbox\/(?!_)/.test(p)).length;
    const badge = document.getElementById("inbox-badge");
    badge.hidden = pending === 0;
    badge.textContent = pending;
  } catch {
    el.textContent = "status unavailable";
  }
}

async function boot() {
  gh = await connect();
  await renderScreen();
  await renderStatus();
  setInterval(renderStatus, 90_000); // ETag-cached — 304s are free
}

addEventListener("hashchange", renderScreen);
boot();
