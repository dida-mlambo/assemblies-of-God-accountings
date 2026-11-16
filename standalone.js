/*
 * Standalone runtime for AG Church Accounts (GitHub Pages version).
 *
 * The app was written for claude.ai, which gives the page a shared database,
 * access to Claude and file downloads through `window.claude.use(...)`.
 * Outside claude.ai none of that exists, so this file provides the same three
 * things in a simpler form:
 *   db        - entries kept in this browser's localStorage (this device only)
 *   sample    - AI reports through the Anthropic API with the user's own key
 *   downloads - ordinary browser downloads
 * It also adds the "This device" panel at the bottom: backup, restore, API key.
 */
(function () {
  "use strict";
  var DOCS_KEY = "agca:v1:docs", API_KEY = "agca:v1:apikey";
  var MODEL = "claude-opus-5-5";

  /* ---------------- local database ---------------- */
  function load() { try { return JSON.parse(localStorage.getItem(DOCS_KEY) || "{}") || {}; } catch (e) { return {}; } }
  var docs = load(), listeners = [];
  function persist() { localStorage.setItem(DOCS_KEY, JSON.stringify(docs)); }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function meta() { return { fromCache: false, hasPendingWrites: false }; }
  function docSnap(path) {
    var d = docs[path];
    return { id: path.split("/").pop(), exists: d !== undefined, data: function () { return d === undefined ? undefined : clone(d); }, metadata: meta() };
  }
  function colSnap(col, n) {
    var pre = col + "/", depth = col.split("/").length + 1;
    var list = Object.keys(docs).filter(function (k) { return k.indexOf(pre) === 0 && k.split("/").length === depth; }).sort().slice(0, n || 1000).map(docSnap);
    return { docs: list, size: list.length, empty: !list.length, docChanges: function () { return []; }, metadata: meta() };
  }
  function notify() { setTimeout(function () { listeners.slice().forEach(function (l) { try { l.fire(); } catch (e) { console.error(e); } }); }, 0); }
  function write(fn) {
    return new Promise(function (resolve, reject) {
      try { fn(); persist(); notify(); resolve(); }
      catch (e) { docs = load(); reject({ code: "quota_exceeded", message: String(e) }); }
    });
  }
  function listen(fire) {
    var l = { fire: fire }; listeners.push(l);
    setTimeout(function () { if (listeners.indexOf(l) >= 0) fire(); }, 0);
    return function () { listeners = listeners.filter(function (x) { return x !== l; }); };
  }
  function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  function docRef(path) {
    return {
      id: path.split("/").pop(), path: path,
      get: function () { return Promise.resolve(docSnap(path)); },
      set: function (d) { return write(function () { docs[path] = clone(d); }); },
      update: function (d) { return write(function () { if (docs[path] === undefined) throw new Error("document does not exist"); Object.assign(docs[path], clone(d)); }); },
      delete: function () { return write(function () { delete docs[path]; }); },
      onSnapshot: function (next) { return listen(function () { next(docSnap(path)); }); },
      collection: function (p) { return query(path + "/" + p, 1000); }
    };
  }
  function query(col, n) {
    return {
      path: col,
      limit: function (m) { return query(col, m); },
      get: function () { return Promise.resolve(colSnap(col, n)); },
      onSnapshot: function (next) { return listen(function () { next(colSnap(col, n)); }); },
      doc: function (id) { return docRef(col + "/" + (id || newId())); },
      add: function (d) { var r = docRef(col + "/" + newId()); return r.set(d).then(function () { return r; }); }
    };
  }
  var db = { doc: docRef, collection: function (c) { return query(c, 1000); } };
  window.addEventListener("storage", function (e) { if (e.key === DOCS_KEY) { docs = load(); notify(); } });

  /* ---------------- Claude (AI reports) ---------------- */
  function getKey() { try { return localStorage.getItem(API_KEY) || ""; } catch (e) { return ""; } }
  function sample(input, opts) {
    opts = opts || {};
    var key = getKey();
    if (!key) { showKeyForm(true); return Promise.reject({ code: "no_key", message: "No API key", userMessage: "Add your Anthropic API key first, in the panel at the bottom of the page." }); }
    var messages = typeof input === "string" ? [{ role: "user", content: input }] : input;
    return fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: opts.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2026-10-21",
        "anthropic-beta": "server-side-fallback-2026-07-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({ model: MODEL, max_tokens: 16000, fallbacks: "default", messages: messages })
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (j) {
        if (!r.ok) {
          var detail = j && j.error && j.error.message ? " (" + j.error.message + ")" : "";
          var msg = r.status === 401 || r.status === 403 ? "Anthropic did not accept the API key. Check it in the panel at the bottom of the page."
            : r.status === 429 ? "Anthropic's rate limit was reached. Wait a minute and try again."
            : r.status >= 500 ? "Anthropic's service is having trouble. Try again shortly."
            : "Anthropic could not write the report" + detail + ".";
          throw { code: r.status === 429 ? "rate_limited" : "upstream_error", message: "HTTP " + r.status + detail, userMessage: msg };
        }
        if (!j || j.stop_reason === "refusal") throw { code: "refused", message: "refused" };
        var text = (j.content || []).filter(function (b) { return b.type === "text"; }).map(function (b) { return b.text; }).join("\n").trim();
        if (!text) throw { code: "empty_completion", message: "no text" };
        if (typeof opts.onText === "function") opts.onText({ text: text, delta: text });
        return { text: text, truncated: j.stop_reason === "max_tokens", modelTierApplied: "complex" };
      });
    }, function (e) {
      if (e && e.name === "AbortError") throw { code: "cancelled", message: "stopped" };
      throw { code: "upstream_error", message: String(e), userMessage: "Could not reach Anthropic. Check the internet connection and try again." };
    });
  }

  /* ---------------- downloads ---------------- */
  function saveBlob(filename, data) {
    var blob = data instanceof Blob ? data : new Blob([data], { type: "application/octet-stream" });
    var a = document.createElement("a"), url = URL.createObjectURL(blob);
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }
  var downloads = { save: function (req) { try { saveBlob(req.filename, req.data); return Promise.resolve({ status: "saved" }); } catch (e) { return Promise.reject({ code: "unavailable", message: String(e) }); } } };

  var caps = { db: db, sample: sample, downloads: downloads };
  window.claude = { use: function (name) { return Promise.resolve(caps[name] || null); } };

  /* ---------------- "This device" panel ---------------- */
  var ui = {};
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function say(msg) { ui.msg.textContent = msg || ""; }
  function showKeyForm(scroll) {
    if (!ui.keyForm) return;
    ui.keyForm.hidden = false; ui.keyInput.value = "";
    ui.keyState.textContent = getKey() ? "A key is saved in this browser. Typing a new one replaces it." : "No key saved yet.";
    if (scroll) ui.panel.scrollIntoView({ block: "center" });
    ui.keyInput.focus();
  }
  function buildPanel() {
    var foot = el("footer", "wrap"); foot.style.paddingBottom = "48px";
    var panel = ui.panel = el("div", "panel"); foot.appendChild(panel);
    panel.appendChild(el("h2", null, "This device"));
    var p = el("p", "hint", "Entries are saved in this browser on this device only. They are not on GitHub and are not shared with other phones or computers. Clearing the browser's data deletes them, so download a backup regularly.");
    p.style.margin = "0 0 12px"; panel.appendChild(p);

    var row = el("div", "actions");
    var bBackup = el("button", "btn", "Download backup"), bRestore = el("button", "btn", "Restore from backup"), bKey = el("button", "btn", "AI report key");
    [bBackup, bRestore, bKey].forEach(function (b) { b.type = "button"; row.appendChild(b); });
    panel.appendChild(row);
    var file = el("input"); file.type = "file"; file.accept = ".json,application/json"; file.hidden = true; file.id = "restoreFile"; panel.appendChild(file);
    ui.msg = el("p", "hint"); ui.msg.setAttribute("role", "status"); ui.msg.style.marginTop = "10px"; panel.appendChild(ui.msg);

    /* restore confirmation (built into the page; browsers' confirm() is avoided) */
    var confirmBox = el("div", "banner"); confirmBox.hidden = true; confirmBox.style.marginTop = "10px";
    var confirmText = el("span"), bYes = el("button", "btn small danger", "Replace everything"), bNo = el("button", "btn small", "Cancel");
    bYes.type = bNo.type = "button"; bYes.style.marginLeft = "10px"; bNo.style.marginLeft = "6px";
    confirmBox.appendChild(confirmText); confirmBox.appendChild(bYes); confirmBox.appendChild(bNo); panel.appendChild(confirmBox);
    var pending = null;

    bBackup.onclick = function () {
      var n = Object.keys(docs).length;
      if (!n) { say("There is nothing to back up yet."); return; }
      var d = new Date(), stamp = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
      saveBlob("church-accounts-backup-" + stamp + ".json", JSON.stringify({ app: "ag-church-accounts", version: 1, exportedAt: d.toISOString(), docs: docs }, null, 1));
      say("Backup downloaded (" + n + " records). Keep the file somewhere safe.");
    };
    bRestore.onclick = function () { file.value = ""; file.click(); };
    file.onchange = function () {
      var f = file.files && file.files[0]; if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var j = JSON.parse(String(reader.result));
          if (!j || j.app !== "ag-church-accounts" || !j.docs || typeof j.docs !== "object" || Array.isArray(j.docs)) throw new Error("wrong file");
          pending = j.docs;
          confirmText.textContent = "Replace the " + Object.keys(docs).length + " records on this device with the " + Object.keys(j.docs).length + " records in this backup" + (j.exportedAt ? " from " + new Date(j.exportedAt).toLocaleString() : "") + "? This cannot be undone.";
          confirmBox.hidden = false; say("");
        } catch (e) { say("That file is not a backup from this app."); }
      };
      reader.readAsText(f);
    };
    bNo.onclick = function () { pending = null; confirmBox.hidden = true; };
    bYes.onclick = function () {
      if (!pending) return;
      var before = docs;
      try { docs = pending; persist(); location.reload(); }
      catch (e) { docs = before; say("The backup is too large for this browser's storage."); }
      pending = null; confirmBox.hidden = true;
    };

    /* API key form */
    var form = ui.keyForm = el("form"); form.hidden = true; form.autocomplete = "off";
    form.style.cssText = "display:grid;gap:10px;margin-top:16px;padding-top:16px;border-top:1px solid var(--line);max-width:560px";
    var note = el("p", "hint", "AI-written reports on this site use your own Anthropic API key, and Anthropic bills each report to that key's account. Create a key in the Anthropic Console, then paste it here. It is stored only in this browser. When you press Write report, that month's entries are sent to Anthropic.");
    note.style.margin = "0"; form.appendChild(note);
    var lab = el("label", "field"); lab.appendChild(el("span", null, "Anthropic API key"));
    var inp = ui.keyInput = el("input"); inp.type = "password"; inp.id = "apiKeyInput"; inp.placeholder = "sk-ant-..."; inp.autocomplete = "off"; lab.appendChild(inp); form.appendChild(lab);
    ui.keyState = el("p", "hint"); ui.keyState.style.margin = "0"; form.appendChild(ui.keyState);
    var acts = el("div", "actions"), bSave = el("button", "btn primary", "Save key"), bRemove = el("button", "btn", "Remove key"), bClose = el("button", "btn", "Close");
    bSave.type = "submit"; bRemove.type = bClose.type = "button"; acts.appendChild(bSave); acts.appendChild(bRemove); acts.appendChild(bClose); form.appendChild(acts);
    panel.appendChild(form);
    bKey.onclick = function () { if (form.hidden) showKeyForm(false); else form.hidden = true; };
    bClose.onclick = function () { form.hidden = true; };
    bRemove.onclick = function () { try { localStorage.removeItem(API_KEY); } catch (e) {} form.hidden = true; say("API key removed from this browser."); };
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var v = inp.value.trim(); if (!v) { inp.focus(); return; }
      try { localStorage.setItem(API_KEY, v); inp.value = ""; form.hidden = true; say("API key saved in this browser. You can now write AI reports."); }
      catch (e) { say("This browser would not store the key."); }
    });

    document.body.appendChild(foot);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", buildPanel); else buildPanel();
})();
