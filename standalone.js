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

  /* ---------- extras only a normal web page can do: open a PDF to print, share a file ---------- */
  var standalone = {
    openPdf: function (blob) {
      var url = URL.createObjectURL(blob), w = window.open(url, "_blank");
      setTimeout(function () { URL.revokeObjectURL(url); }, 120000);
      if (!w) throw { code: "blocked", message: "pop-up blocked" };
    },
    canShare: function () {
      try { return !!(navigator.canShare && navigator.canShare({ files: [new File([new Blob(["x"], { type: "application/pdf" })], "x.pdf", { type: "application/pdf" })] })); }
      catch (e) { return false; }
    },
    share: function (blob, filename, title) {
      return navigator.share({ files: [new File([blob], filename, { type: "application/pdf" })], title: title });
    }
  };

  var caps = { db: db, sample: sample, downloads: downloads, standalone: standalone };
  /* ---------------- shared online database (Firebase) ----------------
   * Used when firebase-config.js is present. Entries then live in Cloud Firestore
   * instead of this browser, behind an email + password sign-in. Firestore's own
   * API has the same shape the app expects, so the store is handed over as-is. */
  var FB = window.FIREBASE_CONFIG || null, fbAuth = null, fbStore = null, fbUser = null, localDocs = docs;
  var SDK = "https://www.gstatic.com/firebasejs/10.14.1/";
  var signUi = null, signState = "wait";
  function loadScript(src) {
    return new Promise(function (resolve, reject) { var s = document.createElement("script"); s.src = src; s.onload = resolve; s.onerror = function () { reject(new Error("could not load " + src)); }; document.head.appendChild(s); });
  }
  function showSignIn(state) {           // "wait" | "form" | "off" | any other text = a fatal message
    signState = state;
    if (!document.body) return;          // applied again once the page has loaded
    if (!signUi) buildSignIn();
    signUi.wrap.hidden = state === "off";
    signUi.form.hidden = state !== "form";
    if (state === "wait") signUi.msg.textContent = "Connecting to the church database…";
    else if (state === "form") { signUi.msg.textContent = ""; signUi.email.focus(); }
    else if (state !== "off") signUi.msg.textContent = state;
  }
  function buildSignIn() {
    var wrap = el("div"); wrap.style.cssText = "position:fixed;inset:0;z-index:50;background:var(--bg);display:grid;place-items:center;padding:16px;overflow:auto";
    var card = el("div", "panel"); card.style.cssText = "width:100%;max-width:380px;display:grid;gap:12px";
    card.appendChild(el("h2", null, "Sign in to the church accounts"));
    var form = el("form"); form.style.cssText = "display:grid;gap:12px";
    var l1 = el("label", "field"); l1.appendChild(el("span", null, "Email"));
    var email = el("input"); email.type = "email"; email.id = "signEmail"; email.required = true; email.autocomplete = "username"; l1.appendChild(email);
    var l2 = el("label", "field"); l2.appendChild(el("span", null, "Password"));
    var pass = el("input"); pass.type = "password"; pass.id = "signPass"; pass.required = true; pass.autocomplete = "current-password"; l2.appendChild(pass);
    var acts = el("div", "actions"), go = el("button", "btn primary", "Sign in"), forgot = el("button", "btn", "Forgot password?");
    go.type = "submit"; forgot.type = "button"; acts.appendChild(go); acts.appendChild(forgot);
    form.appendChild(l1); form.appendChild(l2); form.appendChild(acts);
    var msg = el("p", "hint"); msg.setAttribute("role", "status"); msg.style.margin = "0";
    card.appendChild(form); card.appendChild(msg); wrap.appendChild(card); document.body.appendChild(wrap);
    form.addEventListener("submit", function (ev) {
      ev.preventDefault(); go.disabled = true; msg.textContent = "Signing in…";
      fbAuth.signInWithEmailAndPassword(email.value.trim(), pass.value).then(function () { pass.value = ""; }, function (e) {
        var c = e && e.code;
        msg.textContent = c === "auth/too-many-requests" ? "Too many attempts. Wait a few minutes and try again."
          : c === "auth/network-request-failed" ? "No connection. Check the internet and try again."
          : c === "auth/user-disabled" ? "This account has been switched off. Ask the treasurer."
          : "That email or password is not right. Accounts are created by the church treasurer.";
      }).then(function () { go.disabled = false; });
    });
    forgot.onclick = function () {
      var a = email.value.trim(); if (!a) { msg.textContent = "Type your email address first, then press Forgot password."; email.focus(); return; }
      fbAuth.sendPasswordResetEmail(a).then(function () { msg.textContent = "If that address has an account, a password reset email has been sent to it."; },
        function () { msg.textContent = "The reset email could not be sent. Check the address and try again."; });
    };
    signUi = { wrap: wrap, form: form, msg: msg, email: email };
  }
  function refreshPanel() {
    if (ui.who && fbUser) ui.who.textContent = "Signed in as " + (fbUser.email || "") + ". Entries are saved online in the church's shared database, so every signed-in device sees the same books.";
  }
  var dbReady = !FB ? Promise.resolve(db) : new Promise(function (resolve) {
    loadScript(SDK + "firebase-app-compat.js")
      .then(function () { return loadScript(SDK + "firebase-auth-compat.js"); })
      .then(function () { return loadScript(SDK + "firebase-firestore-compat.js"); })
      .then(function () {
        window.firebase.initializeApp(FB); fbAuth = window.firebase.auth(); fbStore = window.firebase.firestore();
        var first = true;
        fbAuth.onAuthStateChanged(function (user) {
          if (user) { fbUser = user; showSignIn("off"); refreshPanel(); if (first) { first = false; resolve(fbStore); } }
          else if (!first) location.reload();      // signed out: start clean
          else showSignIn("form");
        });
      })
      .catch(function () { showSignIn("The online database could not be loaded. Check the internet connection and reload the page."); });
  });
  function fbBackup() {
    if (!fbStore || !fbUser) return;
    say("Preparing the backup…");
    var out = {};
    var grab = function (q) { return q.get().then(function (s) { s.forEach(function (d) { out[d.ref.path] = d.data(); }); }); };
    Promise.all([grab(fbStore.collection("settings")), grab(fbStore.collection("invoices")), grab(fbStore.collection("reports")), grab(fbStore.collectionGroup("tx"))]).then(function () {
      var n = Object.keys(out).length; if (!n) { say("There is nothing to back up yet."); return; }
      var d = new Date(), stamp = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
      saveBlob("church-accounts-backup-" + stamp + ".json", JSON.stringify({ app: "ag-church-accounts", version: 1, exportedAt: d.toISOString(), docs: out }, null, 1));
      say("Backup downloaded (" + n + " records). Keep the file somewhere safe.");
    }, function () { say("The backup could not be prepared. Try again."); });
  }

  window.claude = { use: function (name) { return name === "db" ? dbReady : Promise.resolve(caps[name] || null); } };

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
    panel.appendChild(el("h2", null, FB ? "Shared database" : "This device"));
    var p = el("p", "hint", FB ? "Entries are saved online in the church's shared database, so every signed-in device sees the same books."
      : "Entries are saved in this browser on this device only. They are not on GitHub and are not shared with other phones or computers. Clearing the browser's data deletes them, so download a backup regularly.");
    if (FB) ui.who = p;
    p.style.margin = "0 0 12px"; panel.appendChild(p);

    var row = el("div", "actions");
    var bBackup = el("button", "btn", "Download backup"), bRestore = el("button", "btn", "Restore from backup"), bKey = el("button", "btn", "AI report key");
    var bOut = el("button", "btn", "Sign out"), nLocal = Object.keys(localDocs).length, moveLabel = "Copy this device's old entries online", bMove = el("button", "btn", moveLabel);
    var btns = FB ? [bBackup, bKey, bOut] : [bBackup, bRestore, bKey];
    if (FB && nLocal) btns.splice(1, 0, bMove);
    btns.forEach(function (b) { b.type = "button"; row.appendChild(b); });
    bOut.onclick = function () { if (fbAuth) fbAuth.signOut(); };
    bMove.onclick = function () {
      if (!fbStore || !fbUser) return;
      if (!bMove.dataset.armed) { bMove.dataset.armed = "1"; bMove.textContent = "Confirm: copy " + nLocal + " records online"; setTimeout(function () { delete bMove.dataset.armed; bMove.textContent = moveLabel; }, 5000); return; }
      bMove.disabled = true; say("Copying…");
      Promise.all(Object.keys(localDocs).map(function (path) { return fbStore.doc(path).set(localDocs[path]); })).then(function () {
        say("Copied " + nLocal + " records from this device into the shared database."); bMove.hidden = true;
      }, function () { say("Some records could not be copied. Check the connection and try again."); bMove.disabled = false; });
    };
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
      if (FB) { fbBackup(); return; }
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
  function start() { buildPanel(); if (FB) { showSignIn(signState); refreshPanel(); } }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
