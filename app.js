"use strict";
(() => {
  const app = document.getElementById("app");
  const cache = {};          // расшифрованные курсы (только в памяти)
  let courses = null;        // публичный список
  let slideIdx = 0, slideKey = "";

  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const ss = {
    get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch {} },
    del(k) { try { sessionStorage.removeItem(k); } catch {} },
  };
  const plural = (n, a, b, c) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? b : c; };

  // ---------- Защита от копирования и сохранения ----------
  const guard = (e) => { if (!e.target.closest || !e.target.closest("input, textarea")) e.preventDefault(); };
  ["contextmenu", "copy", "cut", "dragstart", "selectstart"].forEach((ev) => document.addEventListener(ev, guard));
  document.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && ["s", "p", "c", "x", "u", "a"].includes(k) && !e.target.closest("input")) e.preventDefault();
  });

  // ---------- Расшифровка ----------
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  async function decrypt(blob, password) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: unb64(blob.salt), iterations: blob.iter, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(blob.iv) }, key, unb64(blob.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  }
  async function getBlob(id) {
    const r = await fetch(`data/${id}.json`, { cache: "no-cache" });
    if (!r.ok) throw new Error("Не удалось загрузить курс");
    return r.json();
  }
  async function openCourse(id, password) {
    const data = await decrypt(await getBlob(id), password);
    cache[id] = data;
    ss.set("k:" + id, password);
    return data;
  }

  async function loadList() {
    if (!courses) {
      const r = await fetch("data/courses.json", { cache: "no-cache" });
      courses = await r.json();
    }
    return courses;
  }

  function setColor(hex) {
    document.documentElement.style.setProperty("--c", hex || "#17202E");
    document.documentElement.style.setProperty("--c-soft", hex ? hex + "1F" : "#E7E9EE");
  }

  // ---------- Главная ----------
  function renderHome() {
    setColor(null);
    document.title = "Учебные курсы";
    app.innerHTML = `
      <section class="home">
        <h1>Лекции и задания по дисциплинам</h1>
        <p class="lead">Выберите свою дисциплину. Для входа нужен пароль, который преподаватель даёт группе на первом занятии.</p>
        <ul class="shelf">
          ${courses.map((c) => c.ready ? `
            <li><a class="course-row" href="#/c/${c.id}" style="--rc:${c.color}">
              <span class="spine"></span>
              <div><h2>${esc(c.title)}</h2><p class="aud">${esc(c.audience)}</p></div>
              <div class="meta"><b>${c.sections}</b>${plural(c.sections, "раздел", "раздела", "разделов")}</div>
            </a></li>` : `
            <li><div class="course-row pending" style="--rc:${c.color}">
              <span class="spine"></span>
              <div><h2>${esc(c.title)}</h2><p class="aud">${esc(c.audience)}</p></div>
              <div class="meta"><b>Скоро</b></div>
            </div></li>`).join("")}
        </ul>
        <p class="footnote">Материалы открыты только для просмотра на сайте: скачивание, копирование и печать отключены.</p>
      </section>`;
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
      try { await openCourse(c.id, inp.value.trim()); route(); }
      catch { btn.disabled = false; btn.textContent = "Открыть курс"; err.textContent = "Пароль не подошёл. Проверьте раскладку и регистр или уточните пароль у преподавателя."; inp.select(); }
    });
  }

  function renderCourse(meta, data, secId, tabId) {
    const secs = data.sections;
    const si = Math.max(0, secs.findIndex((s) => s.id === secId));
    const sec = secs[si];
    const tab = sec.tabs.find((t) => t.id === tabId) || sec.tabs[0];
    const link = (s, t) => `#/c/${meta.id}/${s.id}/${t || (s.tabs[0] && s.tabs[0].id)}`;
    document.title = `${sec.title} — ${meta.title}`;

    // группы в оглавлении (Лекции / Практика / Контроль)
    let group = null, n = 0;
    const toc = secs.map((s) => {
      let g = "";
      if (s.kind !== group) { group = s.kind; n = 0; g = s.kind ? `<div class="toc-group">${esc(s.kind)}</div>` : ""; }
      n++;
      return `${g}<a href="${link(s)}" ${s === sec ? 'aria-current="page"' : ""}><span class="n">${n}</span><span>${esc(s.title)}</span></a>`;
    }).join("");
    const select = `<select class="toc-select" aria-label="Раздел курса">${secs.map((s) => `<option value="${link(s)}" ${s === sec ? "selected" : ""}>${esc((s.kind ? s.kind + ": " : "") + s.title)}</option>`).join("")}</select>`;

    const prev = secs[si - 1], next = secs[si + 1];
    app.innerHTML = `<section class="course">${courseHead(meta)}
      <div class="course-body">
        <nav class="toc" aria-label="Разделы курса">${toc}</nav>
        <div>
          ${select}
          <article class="panel">
            <div class="sec-head">
              ${sec.kind ? `<p class="kind">${esc(sec.kind)}${sec.hours ? ` · ${esc(sec.hours)}` : ""}</p>` : ""}
              <h2>${esc(sec.title)}</h2>
            </div>
            <nav class="tabs" aria-label="Материалы раздела">${sec.tabs.map((t) => `<a href="${link(sec, t.id)}" ${t === tab ? 'aria-current="page"' : ""}>${t.label}</a>`).join("")}</nav>
            <div class="tab-body" id="tab-body"></div>
            <nav class="pager">
              ${prev ? `<a href="${link(prev)}">← ${esc(prev.title)}</a>` : ""}
              ${next ? `<a class="next" href="${link(next)}">${esc(next.title)} →</a>` : ""}
            </nav>
          </article>
        </div>
      </div></section>`;
    app.querySelector(".toc-select").addEventListener("change", (e) => (location.hash = e.target.value));

    const body = document.getElementById("tab-body");
    if (tab.slides) renderDeck(body, tab.slides, `${meta.id}/${sec.id}`, meta);
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
      if (!document.body.contains(frame) || e.target.closest("input, select")) return;
      if (["ArrowRight", "PageDown", " "].includes(e.key)) { e.preventDefault(); go(1); }
      if (["ArrowLeft", "PageUp"].includes(e.key)) { e.preventDefault(); go(-1); }
    };
    document.addEventListener("keydown", deckKeyHandler);
    show();
  }

  // ---------- Маршрутизация ----------
  async function route() {
    const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
    try { await loadList(); }
    catch { app.innerHTML = `<p class="home empty">Не удалось загрузить список курсов. Обновите страницу.</p>`; return; }
    if (parts[0] !== "c") { renderHome(); return; }
    const meta = courses.find((c) => c.id === parts[1]);
    if (!meta || !meta.ready) { location.hash = "#/"; return; }
    setColor(meta.color);
    let data = cache[meta.id];
    if (!data) {
      const saved = ss.get("k:" + meta.id);
      if (saved) { try { data = await openCourse(meta.id, saved); } catch { ss.del("k:" + meta.id); } }
    }
    if (!data) { renderLock(meta, false); return; }
    renderCourse(meta, data, parts[2], parts[3]);
  }
  window.addEventListener("hashchange", () => route().then(() => window.scrollTo(0, 0)));
  route();
})();
