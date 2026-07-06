// setup.js — first-run token capture, validation, and re-auth on 401.
// The token lives ONLY in localStorage on this machine and is sent only to api.github.com.

import { GitHub } from "./github.js?v=1";

const TOKEN_KEY = "lifemap.pat";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

// Shows the setup dialog (idempotent) and resolves with a validated GitHub client.
// `reason` is shown when re-authing (expired/revoked token) — pending work is preserved
// by github.js's stash, so losing the token never loses an in-flight write.
export function requestToken(reason = "") {
  const dlg = document.getElementById("setup");
  const msg = document.getElementById("setup-msg");
  const input = document.getElementById("setup-token");
  const form = document.getElementById("setup-form");
  msg.textContent = reason;
  msg.className = reason ? "err" : "";
  if (!dlg.open) dlg.showModal();
  input.focus();

  return new Promise((resolve) => {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const token = input.value.trim();
      if (!token) return;
      msg.textContent = "Validating…";
      msg.className = "muted";
      const gh = new GitHub({ token });
      try {
        const v = await gh.validate();
        if (!v.ok) {
          msg.textContent = `✗ ${v.why}`;
          msg.className = "err";
          return;
        }
        localStorage.setItem(TOKEN_KEY, token);
        input.value = "";
        msg.textContent = v.actions ? "" : `⚠ ${v.why}`;
        dlg.close();
        resolve(gh);
      } catch (err) {
        msg.textContent = `✗ ${err.message}`;
        msg.className = "err";
      }
    };
  });
}

// Returns a ready client: stored token if valid, else interactive setup.
export async function connect() {
  const token = getToken();
  if (token) {
    const gh = new GitHub({ token });
    try {
      const v = await gh.validate();
      if (v.ok) return gh;
      return requestToken(`Stored token problem: ${v.why}`);
    } catch {
      return requestToken("Stored token was rejected — paste a fresh one. Unsaved work is preserved.");
    }
  }
  return requestToken();
}
