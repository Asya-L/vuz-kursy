"use strict";
(() => {
  const app = document.getElementById("app");
  const PARTS = { lectures: "Лекции", labs: "Лабораторные работы" };
  const state = {};          // курсы, открытые в этой вкладке (только в памяти)
  let courses = null, site = {};
  let slideIdx = 0, slideKey = "";

  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const store = (s) => ({
    get(k) { try { return s.getItem(k); } catch { return null; } },
    set(k, v) { try { s.setItem(k, v); } catch {} },
    del(k) { try { s.removeItem(k); } catch {} },
  });
  const ss = store(window.sessionStorage), ls = store(window.localStorage);
  const plural = (n, a, b, c) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? b : c; };
  const teacherPw = () => ss.get("teacher");

  // ---------- Защита от копирования и сохранения ----------
  const guard = (e) => { if (!e.target.closest || !e.target.closest("input, textarea")) e.preventDefault(); };
  ["contextmenu", "copy", "cut", "dragstart", "selectstart"].forEach((ev) => document.addEventListener(ev, guard));
  document.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && ["s", "p", "c", "x", "u", "a"].includes(k) && !e.target.closest("input, textarea")) e.preventDefault();
  });

  // ---------- Шифрование ----------
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const b64 = (u8) => { let s = ""; u8.forEach((b) => (s += String.fromCharCode(b))); return btoa(s); };
  async function decryptPw(blob, password) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: unb64(blob.salt), iterations: blob.iter, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(blob.iv) }, key, unb64(blob.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  }
  const rawKey = (k64, use) => crypto.subtle.importKey("raw", unb64(k64), "AES-GCM", false, [use]);
  async function decryptRaw(blob, k64) {
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(blob.iv) }, await rawKey(k64, "decrypt"), unb64(blob.ct)));
  }
  async function encryptRaw(bytes, k64) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await rawKey(k64, "encrypt"), bytes);
    return { iv: b64(iv), ct: b64(new Uint8Array(ct)) };
  }
  const getJSON = async (url) => { const r = await fetch(url, { cache: "no-cache" }); if (!r.ok) throw new Error(r.status); return r.json(); };

  // ---------- Загрузка курса ----------
  // Студент: пароль → план курса и ключ курса → open.json → ключи открытых разделов.
  async function openAsStudent(id, password) {
    const index = await decryptPw(await getJSON(`data/${id}/index.json`), password);
    const st = { index, keys: {}, open: new Set(), content: {}, teacher: false };
    const open = await getJSON(`data/${id}/open.json`).catch(() => ({}));
    for (const [iid, blob] of Object.entries(open)) {
      try { st.keys[iid] = b64(await decryptRaw(blob, index.ck)); st.open.add(iid); } catch {}
    }
    state[id] = st;
    ss.set("k:" + id, password);
    return st;
  }
  // Преподаватель: все ключи; открытость — из open.json.
  async function openAsTeacher(id, tpw) {
    const t = await decryptPw(await getJSON(`data/${id}/teacher.json`), tpw);
    const index = await decryptPw(await getJSON(`data/${id}/index.json`), t.studentPassword);
    const open = await getJSON(`data/${id}/open.json`).catch(() => ({}));
    const st = { index, keys: t.keys, ck: t.ck, open: new Set(Object.keys(open).filter((k) => t.keys[k])), content: {}, teacher: true, studentPassword: t.studentPassword };
    state[id] = st;
    return st;
  }
  async function loadItem(courseId, st, itemId) {
    if (st.content[itemId]) return st.content[itemId];
    const blob = await getJSON(`data/${courseId}/items/${itemId}.json`);
    const data = JSON.parse(new TextDecoder().decode(await decryptRaw(blob, st.keys[itemId])));
    st.content[itemId] = data;
    return data;
  }

  async function loadList() {
    if (!courses) {
      courses = await getJSON("data/courses.json");
      site = await getJSON("data/site.json").catch(() => ({}));
    }
    return courses;
  }
  function setColor(hex) {
    document.documentElement.style.setProperty("--c", hex || "#17202E");
    document.documentElement.style.setProperty("--c-soft", hex ? hex + "1F" : "#E7E9EE");
  }

  // ---------- Панель преподавателя ----------
  function teacherBar() {
    if (!teacherPw()) return "";
    const hasToken = !!ls.get("gh-token");
    return `<div class="teacher-bar" role="region" aria-label="Режим преподавателя">
      <span class="tb-mark">Режим преподавателя</span>
      <span class="tb-note">${hasToken ? "Изменения сохраняются на сайт сразу" : "Чтобы открывать разделы студентам, подключите GitHub"}</span>
      <button type="button" class="tb-btn" data-act="gh">${hasToken ? "Настройки GitHub" : "Подключить GitHub"}</button>
      <button type="button" class="tb-btn" data-act="logout">Выйти</button>
    </div>`;
  }
  function bindTeacherBar() {
    app.querySelectorAll(".teacher-bar [data-act]").forEach((b) => b.addEventListener("click", () => {
      if (b.dataset.act === "logout") { ss.del("teacher"); for (const k in state) if (state[k].teacher) delete state[k]; location.hash = "#/"; route(); }
      else showGitHubDialog();
    }));
  }
  function toast(msg, kind = "") {
    let t = document.getElementById("toast");
    if (!t) { t = document.createElement("div"); t.id = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.className = "toast " + kind; t.textContent = msg; t.hidden = false;
    clearTimeout(t._h); t._h = setTimeout(() => (t.hidden = true), kind === "err" ? 9000 : 5000);
  }
  function showGitHubDialog(after) {
    const d = document.createElement("dialog");
    d.className = "gh-dialog";
    d.innerHTML = `<form method="dialog">
      <h2>Подключение к GitHub</h2>
      <p>Сайт сохраняет, какие разделы открыты студентам, прямо в репозиторий <b>${esc(site.repo || "—")}</b>. Для этого нужен личный токен GitHub. Он хранится только в этом браузере.</p>
      <ol>
        <li>Откройте <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com → новый fine-grained токен</a>.</li>
        <li>Название — любое, срок — до конца семестра.</li>
        <li><b>Repository access</b> → <b>Only select repositories</b> → <b>${esc((site.repo || "").split("/")[1] || "")}</b>.</li>
        <li><b>Permissions → Repository permissions → Contents</b> → <b>Read and write</b>.</li>
        <li>Нажмите <b>Generate token</b>, скопируйте токен и вставьте ниже.</li>
      </ol>
      <label for="gh-token">Токен GitHub</label>
      <input id="gh-token" type="password" autocomplete="off" placeholder="github_pat_…" value="">
      <p class="err" id="gh-err" role="alert"></p>
      <div class="dlg-actions">
        ${ls.get("gh-token") ? '<button type="button" class="ghost" id="gh-forget">Удалить токен</button>' : ""}
        <button type="button" class="ghost" id="gh-cancel">Отмена</button>
        <button type="button" id="gh-save">Проверить и сохранить</button>
      </div></form>`;
    document.body.appendChild(d);
    d.showModal();
    const inp = d.querySelector("#gh-token"), err = d.querySelector("#gh-err");
    const close = () => { d.close(); d.remove(); };
    d.querySelector("#gh-cancel").onclick = close;
    const forget = d.querySelector("#gh-forget");
    if (forget) forget.onclick = () => { ls.del("gh-token"); close(); route(); toast("Токен удалён из этого браузера"); };
    d.querySelector("#gh-save").onclick = async () => {
      const tok = inp.value.trim();
      if (!tok) { err.textContent = "Вставьте токен."; return; }
      err.textContent = "Проверяю…";
      try {
        const r = await fetch(`https://api.github.com/repos/${site.repo}`, { headers: { Authorization: `Bearer ${tok}`, Accept: "application/vnd.github+json" } });
        const j = await r.json();
        if (!r.ok) throw new Error(r.status === 401 ? "Токен не принят GitHub. Скопируйте его ещё раз целиком." : r.status === 404 ? "У токена нет доступа к репозиторию. Проверьте шаг 3." : `GitHub ответил ошибкой ${r.status}.`);
        if (!j.permissions || !j.permissions.push) throw new Error("У токена нет права записи. Проверьте шаг 4: Contents — Read and write.");
        ls.set("gh-token", tok); close(); route(); toast("GitHub подключён");
        if (after) after();
      } catch (e) { err.textContent = e.message || "Не удалось проверить токен."; }
    };
    inp.focus();
  }
  async function saveOpen(courseId, st) {
    const tok = ls.get("gh-token");
    if (!tok) throw new Error("Подключите GitHub, чтобы сохранять изменения.");
    const open = {};
    for (const iid of st.open) open[iid] = await encryptRaw(unb64(st.keys[iid]), st.ck);
    const path = `${site.root ? site.root + "/" : ""}data/${courseId}/open.json`;
    const api = `https://api.github.com/repos/${site.repo}/contents/${path}`;
    const headers = { Authorization: `Bearer ${tok}`, Accept: "application/vnd.github+json" };
    const cur = await fetch(`${api}?ref=${site.branch || "main"}`, { headers, cache: "no-store" });
    const sha = cur.ok ? (await cur.json()).sha : undefined;
    const body = { message: `Открытые разделы: ${courseId}`, content: btoa(JSON.stringify(open)), branch: site.branch || "main", ...(sha ? { sha } : {}) };
    const r = await fetch(api, { method: "PUT", headers, body: JSON.stringify(body) });
    if (!r.ok) {
      if (r.status === 401) { ls.del("gh-token"); throw new Error("Токен GitHub больше не действует. Подключите GitHub заново."); }
      throw new Error(`GitHub не сохранил изменение (ошибка ${r.status}). Попробуйте ещё раз.`);
    }
    return true;
  }
  async function toggleOpen(courseId, st, item) {
    if (!ls.get("gh-token")) { showGitHubDialog(() => toggleOpen(courseId, st, item)); return; }
    const was = st.open.has(item.id);
    was ? st.open.delete(item.id) : st.open.add(item.id);
    route();
    try {
      await saveOpen(courseId, st);
      toast(`${was ? "Скрыто" : "Открыто"}: «${item.title}». Студенты увидят изменение через 1–2 минуты.`);
    } catch (e) {
      was ? st.open.add(item.id) : st.open.delete(item.id); route();
      toast(e.message, "err");
    }
  }

  function renderTeacherLogin(failed) {
    setColor(null);
    document.title = "Вход для преподавателя";
    app.innerHTML = `<section class="course"><a class="back" href="#/">← Все курсы</a>
      <form class="lock" id="lock" autocomplete="off">
        <h2>Вход для преподавателя</h2>
        <p>Преподаватель видит все лекции и лабораторные и решает, какие из них открыты студентам.</p>
        <label for="pw">Пароль преподавателя</label>
        <div class="row"><input id="pw" type="password" required autocomplete="off"><button type="submit">Войти</button></div>
        <p class="err" role="alert">${failed ? "Пароль не подошёл." : ""}</p>
      </form></section>`;
    const f = document.getElementById("lock"), inp = document.getElementById("pw"), btn = f.querySelector("button"), err = f.querySelector(".err");
    inp.focus();
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      btn.disabled = true; btn.textContent = "Проверяю…"; err.textContent = "";
      const first = courses.find((c) => c.ready);
      try {
        await openAsTeacher(first.id, inp.value.trim());
        ss.set("teacher", inp.value.trim());
        location.hash = "#/";
      } catch { btn.disabled = false; btn.textContent = "Войти"; err.textContent = "Пароль не подошёл."; inp.select(); }
    });
  }

  // ---------- Главная ----------
  function renderHome() {
    setColor(null);
    document.title = "Учебные курсы";
    const t = !!teacherPw();
    app.innerHTML = `${teacherBar()}
      <section class="home">
        <h1>Лекции и задания по дисциплинам</h1>
        <p class="lead">${t ? "Вы вошли как преподаватель: курсы открываются без пароля, в каждом разделе есть кнопка «Открыть студентам»." : "Выберите свою дисциплину. Для входа нужен пароль, который преподаватель даёт группе на первом занятии."}</p>
        <ul class="shelf">
          ${courses.map((c) => c.ready ? `
            <li><a class="course-row" href="#/c/${c.id}" style="--rc:${c.color}">
              <span class="spine"></span>
              <div><h2>${esc(c.title)}</h2><p class="aud">${esc(c.audience)}</p></div>
              <div class="meta"><span><b>${c.lectures}</b> ${plural(c.lectures, "лекция", "лекции", "лекций")}</span>${c.labs ? `<span><b>${c.labs}</b> ${plural(c.labs, "лабораторная", "лабораторные", "лабораторных")}</span>` : ""}</div>
            </a></li>` : `
            <li><div class="course-row pending" style="--rc:${c.color}">
              <span class="spine"></span>
              <div><h2>${esc(c.title)}</h2><p class="aud">${esc(c.audience)}</p></div>
              <div class="meta"><span>Скоро</span></div>
            </div></li>`).join("")}
        </ul>
        <p class="footnote">Материалы открыты только для просмотра на сайте: скачивание, копирование и печать отключены.${t ? "" : ` <a href="#/teacher">Вход для преподавателя</a>`}</p>
      </section>`;
    bindTeacherBar();
  }

  // ---------- Курс ----------
  function courseHead(c) {
    return `<a class="back" href="#/">← Все курсы</a>
      <header class="course-head"><h1>${esc(c.title)}</h1><p>${esc(c.audience)}${c.hours ? ` · ${esc(c.hours)}` : ""}</p></header>`;
  }
  function renderLock(c, failed) {
    app.innerHTML = `<section class="course">${courseHead(c)}
      <form class="lock" id="lock" autocomplete="off">
        <h2>Курс закрыт паролем</h2>
        <p>Введите пароль, который дал преподаватель. Он сохранится до закрытия вкладки.</p>
        <label for="pw">Пароль курса</label>
        <div class="row"><input id="pw" type="password" required autocomplete="off"><button type="submit">Открыть курс</button></div>
        <p class="err" role="alert">${failed ? "Пароль не подошёл. Проверьте раскладку и регистр или уточните пароль у преподавателя." : ""}</p>
      </form></section>`;
    const f = document.getElementById("lock"), inp = document.getElementById("pw"), btn = f.querySelector("button"), err = f.querySelector(".err");
    inp.focus();
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      btn.disabled = true; btn.textContent = "Открываю…"; err.textContent = "";
      try { await openAsStudent(c.id, inp.value.trim()); route(); }
      catch { btn.disabled = false; btn.textContent = "Открыть курс"; err.textContent = "Пароль не подошёл. Проверьте раскладку и регистр или уточните пароль у преподавателя."; inp.select(); }
    });
  }

  async function renderCourse(meta, st, partId, itemId, tabId) {
    const all = st.index.items;
    const part = PARTS[partId] ? partId : (all.find((i) => i.id === itemId) || {}).part || "lectures";
    const items = all.filter((i) => i.part === part);
    const visible = (i) => st.teacher || st.open.has(i.id);
    let item = items.find((i) => i.id === itemId && visible(i)) || items.find(visible) || null;
    const link = (i, t) => `#/c/${meta.id}/${i.part}/${i.id}${t ? "/" + t : ""}`;
    const counts = { lectures: all.filter((i) => i.part === "lectures"), labs: all.filter((i) => i.part === "labs") };

    // оглавление
    let group = null, n = 0;
    const toc = items.map((i) => {
      let g = "";
      if (i.kind !== group && part === "lectures") { group = i.kind; n = 0; g = i.kind ? `<div class="toc-group">${esc(i.kind)}</div>` : ""; }
      n++;
      const isOpen = st.open.has(i.id);
      const mark = st.teacher ? `<span class="st ${isOpen ? "on" : "off"}" title="${isOpen ? "Открыто студентам" : "Скрыто от студентов"}">${isOpen ? "открыто" : "скрыто"}</span>` : "";
      if (!visible(i)) return `${g}<span class="toc-item locked"><span class="n">${n}</span><span>${esc(i.title)}<small>Откроется после занятия</small></span></span>`;
      return `${g}<a class="toc-item" href="${link(i)}" ${i === item ? 'aria-current="page"' : ""}><span class="n">${n}</span><span>${esc(i.title)}${mark}</span></a>`;
    }).join("");
    const select = items.length ? `<select class="toc-select" aria-label="Раздел курса">${items.map((i) => visible(i)
      ? `<option value="${link(i)}" ${i === item ? "selected" : ""}>${esc((i.kind ? i.kind + ": " : "") + i.title)}</option>`
      : `<option disabled>${esc(i.title)} — откроется после занятия</option>`).join("")}</select>` : "";

    const partsNav = `<nav class="parts" aria-label="Раздел курса">${Object.entries(PARTS).map(([pid, label]) => {
      const list = counts[pid];
      const first = list.find(visible) || list[0];
      const href = first ? link(first) : `#/c/${meta.id}/${pid}`;
      return `<a href="${href}" ${pid === part ? 'aria-current="page"' : ""}>${label}<span class="cnt">${list.length}</span></a>`;
    }).join("")}</nav>`;

    let main;
    if (!item) {
      const msg = !items.length
        ? (part === "labs" ? "Лабораторные работы по этому курсу появятся позже." : "Лекции по этому курсу появятся позже.")
        : (part === "labs" ? "Лабораторные работы пока закрыты. Преподаватель откроет их по ходу курса." : "Лекции пока закрыты. Каждая лекция откроется после занятия.");
      main = `<article class="panel"><div class="empty-part"><p>${msg}</p></div></article>`;
    } else {
      document.title = `${item.title} — ${meta.title}`;
      const idx = items.indexOf(item);
      const prev = items.slice(0, idx).reverse().find(visible), next = items.slice(idx + 1).find(visible);
      const isOpen = st.open.has(item.id);
      const control = st.teacher ? `<div class="open-ctl ${isOpen ? "on" : "off"}">
          <span>${isOpen ? "Студенты видят этот раздел" : "Студенты пока не видят этот раздел"}</span>
          <button type="button" id="toggle-open">${isOpen ? "Скрыть от студентов" : "Открыть студентам"}</button></div>` : "";
      main = `<article class="panel">
          ${control}
          <div class="sec-head">
            ${item.kind || item.hours ? `<p class="kind">${esc([item.kind, item.hours].filter(Boolean).join(" · "))}</p>` : ""}
            <h2>${esc(item.title)}</h2>
          </div>
          <nav class="tabs" aria-label="Материалы раздела" id="tabs"></nav>
          <div class="tab-body" id="tab-body"><p class="loading">Загружаю…</p></div>
          <nav class="pager">
            ${prev ? `<a href="${link(prev)}">← ${esc(prev.title)}</a>` : ""}
            ${next ? `<a class="next" href="${link(next)}">${esc(next.title)} →</a>` : ""}
          </nav>
        </article>`;
    }

    app.innerHTML = `${teacherBar()}<section class="course">${courseHead(meta)}
      ${partsNav}
      <div class="course-body">
        <nav class="toc" aria-label="${PARTS[part]}">${toc || `<p class="toc-empty">Пока пусто</p>`}</nav>
        <div>${select}${main}</div>
      </div></section>`;
    bindTeacherBar();
    const sel = app.querySelector(".toc-select");
    if (sel) sel.addEventListener("change", (e) => (location.hash = e.target.value));
    if (!item) return;
    const tg = document.getElementById("toggle-open");
    if (tg) tg.addEventListener("click", () => toggleOpen(meta.id, st, item));

    let data;
    try { data = await loadItem(meta.id, st, item.id); }
    catch { document.getElementById("tab-body").innerHTML = `<p class="empty">Не удалось открыть раздел. Обновите страницу.</p>`; return; }
    if (!document.getElementById("tab-body")) return;
    const tab = data.tabs.find((t) => t.id === tabId) || data.tabs[0];
    document.getElementById("tabs").innerHTML = data.tabs.map((t) => `<a href="${link(item, t.id)}" ${t === tab ? 'aria-current="page"' : ""}>${t.label}</a>`).join("");
    const body = document.getElementById("tab-body");
    if (tab.slides) renderDeck(body, tab.slides, `${meta.id}/${item.id}`, meta);
    else {
      body.innerHTML = `<div class="reading">${tab.html}</div>`;
      if (window.hljs) body.querySelectorAll("pre code").forEach((el) => window.hljs.highlightElement(el));
    }
  }

  // ---------- Презентация ----------
  let deckKeyHandler = null;
  const slideHTML = (s, i, meta) =>
    `<div class="slide ${s.cls}"><div class="deco" aria-hidden="true"></div>${s.html}<div class="slide-foot" aria-hidden="true"><span>${esc(meta.short || "")}</span><span>${String(i + 1).padStart(2, "0")}</span></div></div>`;
  function renderDeck(host, slides, key, meta) {
    const th = `theme-${meta.theme || "plain"}`;
    if (slideKey !== key) { slideKey = key; slideIdx = 0; }
    host.innerHTML = `<div class="deck">
        <div class="slide-frame ${th}" id="frame" tabindex="0" aria-roledescription="слайд"></div>
        <div class="deck-bar">
          <button id="prev" aria-label="Предыдущий слайд">← Назад</button>
          <span class="count" id="count"></span>
          <button id="next" aria-label="Следующий слайд">Вперёд →</button>
          <button class="fs" id="fs">На весь экран</button>
        </div>
        <p class="deck-hint">Листать можно стрелками на клавиатуре или свайпом.</p>
        <div class="deck-thumbs" id="thumbs">${slides.map((s, i) => `<button data-i="${i}" aria-label="Слайд ${i + 1}"><div class="slide-frame ${th}">${slideHTML(s, i, meta)}</div></button>`).join("")}</div>
      </div>`;
    const frame = host.querySelector("#frame"), count = host.querySelector("#count");
    const thumbs = [...host.querySelectorAll("#thumbs button")];
    const show = () => {
      const s = slides[slideIdx];
      frame.innerHTML = slideHTML(s, slideIdx, meta);
      if (window.hljs) frame.querySelectorAll("pre code").forEach((el) => window.hljs.highlightElement(el));
      count.textContent = `${slideIdx + 1} / ${slides.length}`;
      host.querySelector("#prev").disabled = slideIdx === 0;
      host.querySelector("#next").disabled = slideIdx === slides.length - 1;
      thumbs.forEach((b, i) => b.setAttribute("aria-current", i === slideIdx ? "true" : "false"));
    };
    const go = (d) => { slideIdx = Math.min(slides.length - 1, Math.max(0, slideIdx + d)); show(); };
    host.querySelector("#prev").onclick = () => go(-1);
    host.querySelector("#next").onclick = () => go(1);
    thumbs.forEach((b) => (b.onclick = () => { slideIdx = +b.dataset.i; show(); frame.scrollIntoView({ block: "nearest" }); }));
    host.querySelector("#fs").onclick = () => { if (frame.requestFullscreen) frame.requestFullscreen(); else if (frame.webkitRequestFullscreen) frame.webkitRequestFullscreen(); };
    frame.onclick = (e) => { if (document.fullscreenElement) go(e.clientX > window.innerWidth / 2 ? 1 : -1); };
    let tx = null;
    frame.addEventListener("touchstart", (e) => (tx = e.touches[0].clientX), { passive: true });
    frame.addEventListener("touchend", (e) => { if (tx === null) return; const dx = e.changedTouches[0].clientX - tx; if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1); tx = null; });
    if (deckKeyHandler) document.removeEventListener("keydown", deckKeyHandler);
    deckKeyHandler = (e) => {
      if (!document.body.contains(frame) || e.target.closest("input, select, textarea, dialog")) return;
      if (["ArrowRight", "PageDown", " "].includes(e.key)) { e.preventDefault(); go(1); }
      if (["ArrowLeft", "PageUp"].includes(e.key)) { e.preventDefault(); go(-1); }
    };
    document.addEventListener("keydown", deckKeyHandler);
    show();
  }

  // ---------- Маршрутизация ----------
  // #/c/<курс>/<lectures|labs>/<раздел>/<вкладка>
  async function route() {
    const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
    try { await loadList(); }
    catch { app.innerHTML = `<p class="home empty">Не удалось загрузить список курсов. Обновите страницу.</p>`; return; }
    if (parts[0] === "teacher") { if (teacherPw()) location.hash = "#/"; else renderTeacherLogin(false); return; }
    if (parts[0] !== "c") { renderHome(); return; }
    const meta = courses.find((c) => c.id === parts[1]);
    if (!meta || !meta.ready) { location.hash = "#/"; return; }
    setColor(meta.color);
    let st = state[meta.id];
    const tpw = teacherPw();
    if (tpw && (!st || !st.teacher)) {
      try { st = await openAsTeacher(meta.id, tpw); } catch { ss.del("teacher"); st = null; }
    }
    if (!st) {
      const saved = ss.get("k:" + meta.id);
      if (saved) { try { st = await openAsStudent(meta.id, saved); } catch { ss.del("k:" + meta.id); } }
    }
    if (!st) { renderLock(meta, false); return; }
    // старые ссылки вида #/c/курс/раздел/вкладка
    let [, , partId, itemId, tabId] = parts;
    if (partId && !PARTS[partId]) { tabId = itemId; itemId = partId; partId = null; }
    await renderCourse(meta, st, partId, itemId, tabId);
  }
  window.addEventListener("hashchange", () => route().then(() => window.scrollTo(0, 0)));
  route();
})();
