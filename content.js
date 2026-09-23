// Content script: watch the page, drive the panel, record turns.

(() => {
  const S = window.CLAUDE_ETA_SELECTORS;
  const parse = window.CLAUDE_ETA_PARSE;
  const CAL = window.CLAUDE_ETA_CAL;
  const USAGE = window.CLAUDE_ETA_USAGE;

  const $ = (cands, root = document) => {
    for (const c of cands) {
      const el = root.querySelector(c);
      if (el) return el;
    }
    return null;
  };
  const $$ = (cands, root = document) => {
    for (const c of cands) {
      const els = root.querySelectorAll(c);
      if (els.length) return Array.from(els);
    }
    return [];
  };

  // ---------- panel ----------
  const panel = document.createElement('div');
  panel.id = 'claude-eta-panel';
  panel.innerHTML = `
    <div class="ce-row1">
      <button class="ce-min" title="Collapse / expand">–</button>
      <span class="ce-elapsed">0:00</span>
      <span class="ce-sep">/</span>
      <span class="ce-target">–</span>
      <span class="ce-bar"><span class="ce-fill"></span></span>
    </div>
    <div class="ce-row2">
      <span class="ce-model">?</span>
      <span class="ce-cat"></span>
      <span class="ce-tools"></span>
      <span class="ce-n" title="click: export · shift+click: import · alt+click: clear">n=0</span>
      <span class="ce-ver"></span>
      <button class="ce-gear" title="Choose what to show">⚙</button>
      <button class="ce-reload" title="Reload extension + refresh this tab">↻</button>
    </div>
    <div class="ce-settings" hidden>
      <label><input type="checkbox" data-k="eta"> ETA bar</label>
      <label><input type="checkbox" data-k="model"> Model</label>
      <label><input type="checkbox" data-k="cat"> Category</label>
      <label><input type="checkbox" data-k="tools"> Tool count</label>
      <label><input type="checkbox" data-k="u5"> 5-hour quota</label>
      <label><input type="checkbox" data-k="u7"> 7-day quota</label>
    </div>
    <div class="ce-row3">
      <span class="ce-u5" title="5-hour window: used % · resets in">5h –</span>
      <span class="ce-u7" title="7-day window: used % · resets in">7d –</span>
    </div>
    <div class="ce-hist" hidden></div>`;
  document.documentElement.appendChild(panel);
  const ui = {
    elapsed: panel.querySelector('.ce-elapsed'),
    target: panel.querySelector('.ce-target'),
    fill: panel.querySelector('.ce-fill'),
    model: panel.querySelector('.ce-model'),
    cat: panel.querySelector('.ce-cat'),
    tools: panel.querySelector('.ce-tools'),
    n: panel.querySelector('.ce-n'),
    ver: panel.querySelector('.ce-ver'),
    reload: panel.querySelector('.ce-reload'),
    hist: panel.querySelector('.ce-hist'),
    min: panel.querySelector('.ce-min'),
    u5: panel.querySelector('.ce-u5'),
    u7: panel.querySelector('.ce-u7'),
    gear: panel.querySelector('.ce-gear'),
    settings: panel.querySelector('.ce-settings'),
  };

  // ---------- display settings (what to show; recording is unaffected) ----------
  const SHOW_KEY = 'claudeEtaShow';
  const SHOW_DEFAULT = { eta: true, model: true, cat: true, tools: true, u5: true, u7: true };
  let show = { ...SHOW_DEFAULT };
  function applyShow() {
    const on = (el, v) => { el.style.display = v ? '' : 'none'; };
    on(ui.sep, show.eta); on(ui.target, show.eta); on(panel.querySelector('.ce-bar'), show.eta);
    on(ui.model, show.model); on(ui.cat, show.cat); on(ui.tools, show.tools);
    on(ui.u5, show.u5); on(ui.u7, show.u7);
    panel.querySelector('.ce-row3').style.display = (show.u5 || show.u7) ? '' : 'none';
    ui.settings.querySelectorAll('input[data-k]').forEach((i) => { i.checked = !!show[i.dataset.k]; });
  }
  chrome.storage.local.get(SHOW_KEY).then((o) => {
    if (o && o[SHOW_KEY]) show = { ...SHOW_DEFAULT, ...o[SHOW_KEY] };
    applyShow();
  }).catch(() => applyShow());
  ui.gear.addEventListener('click', () => { ui.settings.hidden = !ui.settings.hidden; });
  ui.settings.addEventListener('change', (e) => {
    const k = e.target && e.target.dataset && e.target.dataset.k;
    if (!k) return;
    show[k] = e.target.checked;
    applyShow();
    try { chrome.storage.local.set({ [SHOW_KEY]: show }); } catch (_) {}
  });

  // ---------- collapse (background mode) ----------
  const MIN_KEY = 'claudeEtaCollapsed';
  function setCollapsed(v) {
    panel.classList.toggle('ce-collapsed', v);
    ui.min.textContent = v ? '+' : '–';
    try { localStorage.setItem(MIN_KEY, v ? '1' : '0'); } catch (_) {}
  }
  try { setCollapsed(localStorage.getItem(MIN_KEY) === '1'); } catch (_) {}
  ui.min.addEventListener('click', () => setCollapsed(!panel.classList.contains('ce-collapsed')));

  // ---------- quota usage ----------
  function renderUsage(u) {
    if (!u) return;
    const cell = (el, w, label) => {
      if (!w) { el.textContent = `${label} –`; el.className = el.className.replace(/ ce-hot| ce-warn/g, ''); return; }
      el.textContent = `${label} ${w.pct}% · ${USAGE.untilText(w.resetsAt)}`;
      el.classList.toggle('ce-warn', w.pct >= 70 && w.pct < 90);
      el.classList.toggle('ce-hot', w.pct >= 90);
    };
    cell(ui.u5, u.fiveHour, '5h');
    cell(ui.u7, u.sevenDay, '7d');
  }
  USAGE.start(renderUsage);
  setInterval(() => renderUsage(USAGE.last), 30000); // keep countdown fresh
  ui.elapsed.title = 'click: show recent history';
  ui.elapsed.style.cursor = 'pointer';
  ui.elapsed.addEventListener('click', () => {
    if (!ui.hist.hidden) { ui.hist.hidden = true; return; }
    renderHistory();
    ui.hist.hidden = false;
  });
  function renderHistory() {
    const rows = history.slice(-15).reverse();
    if (!rows.length) { ui.hist.textContent = '(no records yet)'; return; }
    const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    ui.hist.innerHTML = '<table>' + rows.map((r) => {
      const d = new Date(r.ts);
      const when = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      const est = r.estMid ? fmt(r.estMid) : '–';
      const ratio = r.estMid ? (r.actualSec / r.estMid).toFixed(2) + '×' : '';
      return `<tr class="${r.aborted ? 'ce-ab' : ''}"><td>${when}</td><td>${esc(r.model)}</td><td>${esc(r.category)}</td><td>${est}→${fmt(r.actualSec)}</td><td>${ratio}</td><td>${r.toolCalls}t</td></tr>`;
    }).join('') + '</table>';
  }
  try { ui.ver.textContent = 'v' + chrome.runtime.getManifest().version; } catch (_) {}
  ui.reload.addEventListener('click', () => {
    if (turn && !window.confirm('A reply is still running; reload anyway?')) return;
    try { chrome.runtime.sendMessage({ type: 'claude-eta-reload' }); } catch (_) {}
    setTimeout(() => location.reload(), 400);
  });

  ui.n.addEventListener('click', async (e) => {
    if (e.altKey) {
      if (!window.confirm('Clear Claude ETA history?')) return;
      await chrome.storage.local.clear();
      history = [];
      ui.n.textContent = 'n=0';
      return;
    }
    if (e.shiftKey) {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'application/json';
      inp.onchange = async () => {
        const f = inp.files[0];
        if (!f) return;
        const n = await CAL.importJson(await f.text());
        ui.n.textContent = `n=${n}`;
      };
      inp.click();
      return;
    }
    const blob = new Blob([await CAL.exportJson()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `claude-eta-history-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  // ---------- drag to move, position remembered ----------
  const POS_KEY = 'claudeEtaPanelPos';
  try {
    const pos = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
    if (pos && typeof pos.left === 'number') {
      panel.style.left = pos.left + 'px';
      panel.style.top = pos.top + 'px';
      panel.style.right = 'auto';
    }
  } catch (_) {}
  let drag = null;
  panel.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, .ce-n, .ce-settings, input, label')) return;
    const r = panel.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    panel.classList.add('ce-drag');
    panel.setPointerCapture(e.pointerId);
  });
  panel.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const left = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, e.clientX - drag.dx));
    const top = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, e.clientY - drag.dy));
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
    panel.style.right = 'auto';
  });
  panel.addEventListener('pointerup', () => {
    if (!drag) return;
    drag = null;
    panel.classList.remove('ce-drag');
    try {
      localStorage.setItem(POS_KEY, JSON.stringify({ left: panel.offsetLeft, top: panel.offsetTop }));
    } catch (_) {}
  });

  const fmt = (sec) => {
    sec = Math.max(0, Math.round(sec));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  // ---------- state ----------
  let turn = null; // { start, model, est, toolCalls, ratios, level, n }
  let history = [];
  CAL.load().then((h) => {
    history = h;
    ui.n.textContent = `n=${h.length}`;
  });

  function readModel() {
    const el = $(S.modelPicker);
    if (!el) return 'unknown';
    const al = el.getAttribute('aria-label') || '';
    const t = (al.replace(/^Model:\s*/i, '') || el.textContent).trim().replace(/\s+/g, ' ');
    return t || 'unknown';
  }

  function countToolSteps(msg) {
    return $$(S.step, msg).filter((el) => !S.stepIsThinking(el)).length;
  }

  // The paragraph that contains the ⏱ marker, as its own text (textContent of
  // the whole message glues blocks together with no line breaks).
  function estimateLineText(msg) {
    const walker = document.createTreeWalker(msg, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      if (n.nodeValue && n.nodeValue.includes('⏱')) {
        const block = n.parentElement.closest('p, li, div') || n.parentElement;
        return block.textContent;
      }
    }
    return '';
  }

  function latestAssistant() {
    const all = $$(S.assistantMessage);
    return all.length ? all[all.length - 1] : null;
  }

  function startTurn() {
    turn = {
      start: Date.now(),
      model: readModel(),
      est: null,
      toolCalls: 0,
      ratios: [],
      level: 'none',
      n: 0,
    };
    panel.classList.add('ce-active');
    panel.classList.remove('ce-amber', 'ce-red', 'ce-done');
    ui.model.textContent = turn.model;
    ui.cat.textContent = '';
    ui.target.textContent = '–';
    ui.fill.style.width = '0%';
  }

  async function endTurn(aborted, endedAt) {
    if (!turn) return;
    const actualSec = ((endedAt || Date.now()) - turn.start) / 1000;
    const rec = {
      ts: turn.start,
      model: turn.model,
      category: turn.est ? turn.est.category : 'none',
      estMid: turn.est ? turn.est.estMid : null,
      estLo: turn.est ? turn.est.estLo : null,
      estHi: turn.est ? turn.est.estHi : null,
      estSteps: turn.est ? turn.est.estSteps : null,
      actualSec: Math.round(actualSec),
      toolCalls: turn.toolCalls,
      aborted: !!aborted,
    };
    // Ignore sub-3-second turns: they are UI hiccups, not work.
    if (actualSec >= 3) {
      await CAL.append(rec);
      history = await CAL.load();
      ui.n.textContent = `n=${history.length}`;
    }
    panel.classList.remove('ce-active');
    panel.classList.add('ce-done');
    ui.elapsed.textContent = fmt(actualSec);
    turn = null;
    setTimeout(() => USAGE.refresh(), 1500);
  }

  // Turn end is debounced: claude.ai briefly drops the streaming flag between
  // steps, so we only end a turn after END_GRACE_MS of continuous silence.
  const END_GRACE_MS = 2500;
  let quietSince = null;

  function tick() {
    const streaming = $(S.streaming);
    if (streaming) {
      quietSince = null;
      if (!turn) startTurn();
    } else if (turn) {
      if (quietSince === null) quietSince = Date.now();
      if (Date.now() - quietSince >= END_GRACE_MS) {
        endTurn(false, quietSince);
        return;
      }
    }
    if (!turn) return;

    const elapsed = (Date.now() - turn.start) / 1000;
    ui.elapsed.textContent = fmt(elapsed);

    const msg = latestAssistant();
    if (msg) {
      turn.toolCalls = countToolSteps(msg);
      ui.tools.textContent = turn.toolCalls ? `${turn.toolCalls} tools` : '';
      if (!turn.est) {
        const est = parse(estimateLineText(msg));
        if (est) {
          turn.est = est;
          const r = CAL.ratiosFor(history, turn.model, est.category);
          turn.ratios = r.ratios;
          turn.level = r.level;
          turn.n = r.n;
          ui.cat.textContent = est.category !== 'none' ? est.category : '';
        }
      }
    }

    if (turn.est) {
      const t = CAL.target(turn.est.estMid, elapsed, turn.ratios);
      ui.target.textContent = `~${fmt(t.sec)}${t.confident ? '' : '?'}`;
      const pct = Math.min(100, (elapsed / t.sec) * 100);
      ui.fill.style.width = `${pct}%`;
      panel.classList.toggle('ce-amber', t.q === 0.75);
      panel.classList.toggle('ce-red', t.q >= 0.9);
      ui.n.textContent = `n=${turn.n}${turn.level !== 'none' ? ' ' + turn.level : ''}`;
    } else {
      ui.target.textContent = 'no ⏱';
      ui.fill.style.width = '0%';
    }
  }

  setInterval(tick, 500);

  // If the user navigates to a different chat while a turn is running, treat it
  // as aborted. Compare the path only: opening an artifact adds ?artifact=…
  // to the same chat and must not end the turn.
  let lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      if (turn) endTurn(true);
    }
  }, 1000);
})();
