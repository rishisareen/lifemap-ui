// main.js — router, header status, screen mounting.
// ?demo=1 runs the whole app against bundled fixtures (no token, no network).

import { connect } from "./setup.js?v=12";
import { classifyCommit, ageString, parseBusyCsv } from "./model.js?v=12";
import { renderToday } from "./today.js?v=12";
import { renderInbox } from "./inbox.js?v=12";
import { renderBoard } from "./board.js?v=12";
import { renderReview } from "./wizard.js?v=12";
import { renderHorizons } from "./horizons.js?v=12";

const SCREENS = {
  today:    { title: "Today",    render: renderToday },
  inbox:    { title: "Inbox",    render: renderInbox },
  board:    { title: "Board",    render: renderBoard },
  review:   { title: "Review",   render: renderReview },
  trends:   { title: "Trends",   unit: "Unit 9" },
  horizons: { title: "Horizons", render: renderHorizons },
};

const DEMO = new URLSearchParams(location.search).has("demo");
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

  if (DEMO) {
    const note = document.createElement("p");
    note.className = "muted";
    note.textContent = "▦ demo data — nothing here is real and nothing is written to GitHub";
    view.append(note);
  }

  const screen = SCREENS[tab];
  if (screen.render) {
    const mount = document.createElement("div");
    view.append(mount);
    try {
      await screen.render(gh, mount);
    } catch (e) {
      const err = document.createElement("p");
      err.className = "err";
      err.textContent = `${screen.title} failed to load: ${e.message}`;
      mount.append(err);
    }
    return;
  }

  const card = document.createElement("div");
  card.className = "card";
  const h = document.createElement("h2");
  h.textContent = screen.title;
  const p = document.createElement("p");
  p.className = "muted";
  p.textContent = `This screen arrives in ${screen.unit}.`;
  card.append(h, p);
  view.append(card);
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
    const busyPath = "Plans/Calendar/busy-14d.csv";
    if (entries.has(busyPath)) {
      const busy = parseBusyCsv(await gh.readFile(busyPath));
      const fetchedMs = busy.fetchedAt ? new Date(busy.fetchedAt).getTime() : null;
      const feedStale = busy.status === "failed" || (fetchedMs != null && now - fetchedMs > 24 * 3600e3);
      if (feedStale) {
        el.append(Object.assign(document.createElement("span"),
          { textContent: " ⚠ calendar feed stale", className: "stale" }));
      }
    }
    const pending = [...entries.keys()].filter((p) => /^Ledger\/Inbox\/(?!_)/.test(p)).length;
    const badge = document.getElementById("inbox-badge");
    badge.hidden = pending === 0;
    badge.textContent = pending;
  } catch {
    el.textContent = "status unavailable";
  }
}

async function boot() {
  if (DEMO) {
    const { FakeGitHub } = await import("./fixtures.js?v=12");
    gh = new FakeGitHub();
  } else {
    gh = await connect();
  }
  await renderScreen();
  await renderStatus();
  setInterval(renderStatus, 90_000); // tree cached by head oid — unchanged polls skip the tree download
}

addEventListener("hashchange", renderScreen);
addEventListener("lifemap:changed", () => renderStatus());
boot();
