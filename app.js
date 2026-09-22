/* FinanceBro — webapp. Depende de parser.js (parseExpense, categorize, formatARS, ...). */
(function () {
  'use strict';

  /* ================= Utilidades ================= */

  var $ = function (s) { return document.querySelector(s); };
  var params = new URLSearchParams(location.search);
  var DEMO = params.has('demo');
  var P = DEMO ? 'fbdemo_' : 'fb_'; // el modo demo nunca toca tus datos reales

  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem(P + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(P + k, JSON.stringify(v)); } catch (e) { /* sin storage */ } },
    del: function (k) { try { localStorage.removeItem(P + k); } catch (e) { /* sin storage */ } }
  };

  var MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var DOW = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function curMonth() { return todayISO().slice(0, 7); }
  function monthLabel(m) { var p = m.split('-'); return MONTHS[+p[1] - 1] + ' ' + p[0]; }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function monthShort(m) { var p = m.split('-'); return MONTHS[+p[1] - 1].slice(0, 3) + ' ' + p[0].slice(2); }
  function shiftMonth(m, delta) {
    var p = m.split('-'); var d = new Date(Date.UTC(+p[0], +p[1] - 1 + delta, 1));
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1);
  }
  function dayLabel(iso) {
    var p = iso.split('-'); var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    var t = todayISO();
    if (iso === t) return 'hoy';
    if (iso === addDays(t, -1)) return 'ayer';
    return DOW[d.getUTCDay()] + ' ' + p[2] + '/' + p[1];
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  var fmt = formatARS;
  function pct(n) { return (n < 10 && n > 0 ? n.toFixed(1).replace('.', ',') : Math.round(n)) + '%'; }
  function amountFrom(v) {
    var r = parseExpense('x ' + String(v || ''), { today: todayISO() });
    return r.ok ? r.amount : NaN;
  }
  function sortExpenses(list) {
    list.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (a.created || '') < (b.created || '') ? 1 : -1;
    });
    return list;
  }
  function NetError(msg) { this.message = msg; }

  /* ================= Backends ================= */

  // Google Apps Script. Se usa POST sin headers custom (text/plain) para evitar el preflight de CORS.
  function RemoteBackend(url, token) {
    return {
      kind: 'remote',
      call: function (action, payload) {
        var body = Object.assign({ token: token, action: action }, payload || {});
        return fetch(url, { method: 'POST', body: JSON.stringify(body), redirect: 'follow' })
          .catch(function (e) { throw new NetError('Sin conexión'); })
          .then(function (res) {
            return res.json().catch(function () {
              throw new NetError('La URL no respondió como la API (¿el deploy es para "Cualquier usuario"?)');
            });
          });
      }
    };
  }

  // Modo local: la misma API, guardada en este teléfono.
  function LocalBackend() {
    function load() { return LS.get('db', null) || { expenses: [], config: {}, rules: [], fixed: [] }; }
    function cats(db) {
      return db.config.categorias || DEFAULT_CATEGORIES.map(function (c) { return { id: c.id, name: c.name, emoji: c.emoji }; });
    }
    function income(db, month) {
      var best = null;
      Object.keys(db.config).forEach(function (k) {
        if (k.indexOf('ingreso:') !== 0) return;
        var m = k.slice(8);
        if (m <= month && (!best || m > best.m)) best = { m: m, a: db.config[k] };
      });
      return best ? { amount: best.a, inherited: best.m !== month } : { amount: 0, inherited: false };
    }
    function applyFixed(db, month) {
      var key = 'fijos_aplicados:' + month;
      if (db.config[key]) return;
      var dim = daysInMonth(month);
      db.fixed.forEach(function (f) {
        if (!f.active || !(f.amount > 0)) return;
        var id = 'fijo-' + f.id + '-' + month;
        if (db.expenses.some(function (e) { return e.id === id; })) return;
        db.expenses.push({ id: id, date: month + '-' + pad2(Math.min(f.day, dim)), description: f.description,
          category: f.category, amount: f.amount, source: 'fijo', created: new Date().toISOString() });
      });
      db.config[key] = true;
    }
    function upsertRule(db, kw, cat) {
      var r = db.rules.filter(function (x) { return x.keyword === kw; })[0];
      if (r) r.category = cat; else db.rules.push({ keyword: kw, category: cat });
    }
    var A = {
      state: function (db, b) {
        var month = b.month || curMonth();
        if (month === curMonth()) applyFixed(db, month);
        var inc = income(db, month);
        var months = {}; months[curMonth()] = true;
        db.expenses.forEach(function (e) { months[e.date.slice(0, 7)] = true; });
        return {
          ok: true, today: todayISO(), month: month, income: inc.amount, incomeInherited: inc.inherited,
          categories: cats(db), budgets: db.config.presupuestos || {},
          expenses: sortExpenses(db.expenses.filter(function (e) { return e.date.slice(0, 7) === month; })),
          rules: db.rules, fixed: db.fixed, months: Object.keys(months).sort()
        };
      },
      history: function (db) {
        var by = {};
        db.expenses.forEach(function (x) {
          var m = x.date.slice(0, 7);
          if (!by[m]) by[m] = { month: m, total: 0, byCategory: {} };
          by[m].total += x.amount;
          by[m].byCategory[x.category] = (by[m].byCategory[x.category] || 0) + x.amount;
        });
        return { ok: true, months: Object.keys(by).sort().slice(-12).map(function (m) { by[m].income = income(db, m).amount; return by[m]; }) };
      },
      add: function (db, b) {
        var x = b.expense;
        if (!db.expenses.some(function (e) { return e.id === x.id; })) db.expenses.push(x);
        return { ok: true, expense: x };
      },
      update: function (db, b) {
        var e = db.expenses.filter(function (x) { return x.id === b.id; })[0];
        if (!e) return { ok: true, missing: true };
        var prevCat = e.category;
        Object.assign(e, b.patch);
        var learned = null;
        if (b.learn && b.patch.category && b.patch.category !== prevCat) {
          learned = learnKeyword(e.description);
          if (learned) upsertRule(db, learned, e.category);
        }
        return { ok: true, expense: e, learned: learned };
      },
      delete: function (db, b) { db.expenses = db.expenses.filter(function (x) { return x.id !== b.id; }); return { ok: true }; },
      setIncome: function (db, b) { db.config['ingreso:' + b.month] = b.amount; return { ok: true }; },
      setBudgets: function (db, b) { db.config.presupuestos = b.budgets; return { ok: true }; },
      setCategories: function (db, b) { db.config.categorias = b.categories; return { ok: true }; },
      addRule: function (db, b) { upsertRule(db, normalizeText(b.keyword), b.category); return { ok: true }; },
      deleteRule: function (db, b) { db.rules = db.rules.filter(function (r) { return r.keyword !== b.keyword; }); return { ok: true }; },
      setFixed: function (db, b) { db.fixed = b.fixed; return { ok: true }; }
    };
    return {
      kind: 'local',
      dump: load,
      call: function (action, payload) {
        return new Promise(function (resolve) {
          var db = load();
          var r = A[action] ? A[action](db, clone(payload || {})) : { ok: false, error: 'Acción desconocida' };
          LS.set('db', db);
          resolve(clone(r));
        });
      }
    };
  }

  /* ================= Estado ================= */

  var settings = LS.get('settings', {}); // { mode: 'local' | 'remote', url, token }
  if (DEMO) settings = { mode: 'local' };
  var backend = null;

  function makeBackend() {
    backend = settings.mode === 'remote' && settings.url && settings.token
      ? RemoteBackend(settings.url, settings.token)
      : (settings.mode ? LocalBackend() : null);
  }

  var S = {
    month: curMonth(),
    tab: 'inicio',
    filter: null,
    data: null,
    history: LS.get('history', null),
    queue: LS.get('queue', []),
    sync: 'ok',
    syncMsg: '',
    override: null,
    flushing: false,
    showSetup: false
  };

  function emptyData(month) {
    return {
      month: month, income: 0, incomeInherited: false,
      categories: DEFAULT_CATEGORIES.map(function (c) { return { id: c.id, name: c.name, emoji: c.emoji }; }),
      budgets: {}, expenses: [], rules: [], fixed: [], months: [month]
    };
  }
  function normalizeData(r, month) {
    var d = emptyData(month);
    d.income = Number(r.income) || 0;
    d.incomeInherited = !!r.incomeInherited;
    if (r.categories && r.categories.length) d.categories = r.categories;
    d.budgets = r.budgets || {};
    d.expenses = sortExpenses(r.expenses || []);
    d.rules = r.rules || [];
    d.fixed = r.fixed || [];
    d.months = r.months || [month];
    return d;
  }
  function loadCached(month) { var c = LS.get('cache:' + month, null); return c ? c : emptyData(month); }
  function saveCache() { if (S.data) LS.set('cache:' + S.data.month, S.data); }
  function saveQueue() { LS.set('queue', S.queue); }

  function catOf(id) {
    var cats = S.data.categories;
    for (var i = 0; i < cats.length; i++) if (cats[i].id === id) return cats[i];
    for (var j = 0; j < cats.length; j++) if (cats[j].id === 'otros') return cats[j];
    return { id: id, name: id, emoji: '•' };
  }

  // Aplica una operación sobre los datos en pantalla (optimista y para re-aplicar la cola pendiente).
  function applyOp(d, op) {
    switch (op.action) {
      case 'add':
        if (op.expense.date.slice(0, 7) === d.month && !d.expenses.some(function (e) { return e.id === op.expense.id; })) {
          d.expenses.push(Object.assign({}, op.expense, { pending: true }));
        }
        break;
      case 'update':
        d.expenses.forEach(function (e) {
          if (e.id !== op.id) return;
          var prevCat = e.category;
          Object.assign(e, op.patch, { pending: true });
          if (op.learn && op.patch.category && op.patch.category !== prevCat) {
            var kw = learnKeyword(e.description);
            if (kw) upsertRuleLocal(d, kw, e.category);
          }
        });
        d.expenses = d.expenses.filter(function (e) { return e.date.slice(0, 7) === d.month; });
        break;
      case 'delete':
        d.expenses = d.expenses.filter(function (e) { return e.id !== op.id; });
        break;
      case 'setIncome':
        if (op.month === d.month) { d.income = op.amount; d.incomeInherited = false; }
        break;
      case 'setBudgets': d.budgets = op.budgets; break;
      case 'setCategories': d.categories = op.categories; break;
      case 'addRule': upsertRuleLocal(d, normalizeText(op.keyword), op.category); break;
      case 'deleteRule': d.rules = d.rules.filter(function (r) { return r.keyword !== op.keyword; }); break;
      case 'setFixed': d.fixed = op.fixed; break;
    }
    sortExpenses(d.expenses);
  }
  function upsertRuleLocal(d, kw, cat) {
    var r = d.rules.filter(function (x) { return x.keyword === kw; })[0];
    if (r) r.category = cat; else d.rules.push({ keyword: kw, category: cat });
  }

  function mutate(op) {
    op = clone(op);
    op._qid = uid();
    applyOp(S.data, op);
    saveCache();
    S.queue.push(op);
    saveQueue();
    S.history = null;
    render();
    flush();
  }

  function payloadOf(op) {
    var p = Object.assign({}, op);
    delete p.action; delete p._qid;
    return p;
  }

  function flush() {
    if (S.flushing || !backend) return Promise.resolve();
    S.flushing = true;
    var stopped = false;
    function next() {
      if (!S.queue.length) return Promise.resolve();
      setSync('syncing');
      var op = S.queue[0];
      return backend.call(op.action, payloadOf(op)).then(function (r) {
        if (!r.ok) {
          if (/token/i.test(r.error || '')) { stopped = true; setSync('error', r.error); return; }
          toast('No se pudo guardar: ' + r.error);
        }
        if (r.ok && r.learned) toast('Aprendí: “' + r.learned + '” va en ' + catOf(r.expense.category).name);
        S.queue.shift();
        saveQueue();
        return next();
      });
    }
    return next().catch(function (e) {
      stopped = true;
      setSync('offline', e.message);
    }).then(function () {
      S.flushing = false;
      if (!stopped) return refresh();
    });
  }

  var refreshSeq = 0;
  function refresh() {
    if (!backend) return Promise.resolve();
    if (S.queue.length) return flush();
    var month = S.month;
    var seq = ++refreshSeq;
    setSync('syncing');
    return backend.call('state', { month: month }).then(function (r) {
      if (seq !== refreshSeq || month !== S.month) return;
      if (!r.ok) { setSync('error', r.error); return; }
      S.data = normalizeData(r, month);
      S.queue.forEach(function (op) { applyOp(S.data, op); });
      saveCache();
      setSync(S.queue.length ? 'pending' : 'ok');
      render();
    }).catch(function (e) {
      if (seq === refreshSeq) setSync('offline', e.message);
    });
  }

  function setSync(state, msg) {
    S.sync = state; S.syncMsg = msg || '';
    var b = $('#syncBadge');
    var map = {
      ok: ['✓', 'Sincronizado'], syncing: ['⟳', 'Sincronizando…'], pending: ['⏳', 'Cambios pendientes'],
      offline: ['⚠', 'Sin conexión. Se guarda y sincroniza después.'], error: ['⚠', 'Error']
    };
    var m = map[state] || map.ok;
    if (backend && backend.kind === 'local') m = ['●', DEMO ? 'Modo demo' : 'Modo local (solo este teléfono)'];
    b.textContent = m[0];
    b.title = m[1] + (msg ? ': ' + msg : '');
    b.className = 'sync' + (state === 'offline' || state === 'error' ? ' warn' : '');
  }

  /* ================= Cálculos ================= */

  function summary(d) {
    var total = 0, fixedTotal = 0, by = {};
    d.expenses.forEach(function (e) {
      var cid = catOf(e.category).id;
      total += e.amount;
      if (e.source === 'fijo') fixedTotal += e.amount;
      by[cid] = (by[cid] || 0) + e.amount;
    });
    var rows = Object.keys(by).map(function (id) {
      return { cat: catOf(id), amount: by[id], pct: total ? by[id] / total * 100 : 0, budget: Number(d.budgets[id]) || 0 };
    }).sort(function (a, b) { return b.amount - a.amount; });
    // Categorías con presupuesto pero sin gastos también se muestran.
    Object.keys(d.budgets || {}).forEach(function (id) {
      if (!by[id] && Number(d.budgets[id]) > 0 && d.categories.some(function (c) { return c.id === id; })) {
        rows.push({ cat: catOf(id), amount: 0, pct: 0, budget: Number(d.budgets[id]) });
      }
    });
    return { total: total, fixedTotal: fixedTotal, variable: total - fixedTotal, rows: rows, byCat: by };
  }

  function budgetStatus(spent, budget) {
    if (!budget) return null;
    var r = spent / budget;
    if (r >= 1) return { cls: 'crit', text: '⛔ Te pasaste ' + fmt(spent - budget) + ' del tope de ' + fmt(budget) };
    if (r >= 0.8) return { cls: 'warn', text: '⚠️ ' + Math.round(r * 100) + '% del tope de ' + fmt(budget) };
    return { cls: '', text: 'Tope ' + fmt(budget) + ' · usado ' + Math.round(r * 100) + '%' };
  }

  /* ================= Render ================= */

  var view = $('#view');

  function render() {
    renderHeader();
    renderStrip();
    // No re-renderizar Ajustes mientras escribís (perderías el foco).
    var typing = S.tab === 'ajustes' && view.contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement.tagName);
    if (!typing) {
      if (!settings.mode || S.showSetup) view.innerHTML = renderWelcome();
      else view.innerHTML = { inicio: renderInicio, movimientos: renderMovs, historial: renderHist, ajustes: renderAjustes }[S.tab]();
    }
    var noApp = !settings.mode || S.showSetup;
    $('#quickForm').hidden = noApp;
    $('#tabs').hidden = noApp;
    $('#shareStrip').hidden = noApp;
    document.querySelectorAll('#tabs button').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === S.tab); });
  }

  function renderHeader() {
    $('#monthTitle').textContent = monthLabel(S.month);
    $('#nextMonth').disabled = S.month >= curMonth();
  }

  function renderStrip() {
    var s = summary(S.data);
    var el = $('#shareStrip');
    if (!s.total) { el.innerHTML = '<span class="muted">Sin gastos en ' + esc(monthLabel(S.month)) + ' todavía</span>'; return; }
    el.innerHTML = s.rows.filter(function (r) { return r.amount > 0; }).map(function (r) {
      return esc(r.cat.emoji) + ' ' + esc(r.cat.name) + ' <b>' + pct(r.pct) + '</b>';
    }).join(' <span class="muted">·</span> ');
  }

  function renderWelcome() {
    if (S.showSetup === 'remote') return renderConnectForm(true);
    return '<div class="welcome">' +
      '<div class="logo">💸</div><h2>FinanceBro</h2>' +
      '<p>Anotá tus gastos en segundos. Se clasifican solos y ves en qué se va la plata.</p>' +
      '<button class="btn-primary btn-block" data-act="welcome-remote">Conectar mi Google Sheet</button>' +
      '<button class="btn btn-block" data-act="welcome-local">Usar solo en este teléfono</button>' +
      '<p class="small muted" style="margin-top:16px">Con Google Sheet podés usar el atajo de Siri y tus datos quedan respaldados. ' +
      'El modo local no necesita configuración, pero los datos quedan solo en este dispositivo.</p>' +
      '<p class="small"><a href="?demo=1">Ver una demo con datos de ejemplo</a></p></div>';
  }

  function renderConnectForm(isWelcome) {
    return '<div class="card"><h2>Conectar Google Sheet</h2>' +
      '<p class="small ink2" style="margin-top:0">Pegá la URL del deploy de Apps Script y tu token (los ves en SETUP.md, pasos 3 y 4).</p>' +
      '<label class="f" for="cfgUrl">URL de la Web App</label>' +
      '<input class="input" id="cfgUrl" type="url" placeholder="https://script.google.com/macros/s/…/exec" value="' + esc(settings.url || '') + '">' +
      '<label class="f" for="cfgToken">Token</label>' +
      '<input class="input" id="cfgToken" type="password" autocomplete="off" value="' + esc(settings.token || '') + '">' +
      '<div class="btn-row">' + (isWelcome ? '<button class="btn" data-act="welcome-back">Volver</button>' : '') +
      '<button class="btn-primary" data-act="save-remote">Conectar y probar</button></div></div>';
  }

  function renderInicio() {
    var d = S.data, s = summary(d), html = '';
    var isCur = S.month === curMonth();

    // Ingreso
    if (!d.income) {
      html += '<div class="card"><h2>¿Cuánto te ingresa en ' + esc(MONTHS[+S.month.slice(5) - 1]) + '?</h2>' +
        '<div class="row"><input class="input" id="incomeIn" inputmode="decimal" placeholder="Ej: 850000 o 850k">' +
        '<button class="btn-primary" data-act="set-income">Guardar</button></div>' +
        '<p class="small muted" style="margin-bottom:0">Con tu ingreso te muestro cuánto te queda y a qué ritmo gastás.</p></div>';
    }

    // Resumen
    var avail = d.income - s.total;
    var usedPct = d.income ? s.total / d.income * 100 : 0;
    var dim = daysInMonth(S.month);
    var dayN = isCur ? +todayISO().slice(8) : dim;
    html += '<div class="card">';
    if (d.income) {
      html += '<div class="hero-label">' + (avail >= 0 ? 'Disponible' : 'Te pasaste') + '</div>' +
        '<div class="hero num' + (avail < 0 ? ' neg' : '') + '">' + (avail < 0 ? '⚠ ' : '') + fmt(Math.abs(avail)) + '</div>';
    } else {
      html += '<div class="hero-label">Gastado</div><div class="hero num">' + fmt(s.total) + '</div>';
    }
    html += '<div class="kpis">' +
      '<div class="kpi"><div class="v num">' + fmt(d.income) + '<button class="edit-inline" data-act="edit-income" aria-label="Editar ingreso">✎</button></div>' +
      '<div class="l">Ingreso' + (d.incomeInherited ? ' (igual al mes anterior)' : '') + '</div></div>' +
      '<div class="kpi"><div class="v num">' + fmt(s.total) + '</div><div class="l">Gastado' + (d.income ? ' · ' + pct(usedPct) + ' del ingreso' : '') + '</div></div>' +
      '</div>';
    if (d.income) {
      html += '<div class="meter" role="img" aria-label="Gastaste ' + pct(usedPct) + ' del ingreso; pasó el ' + pct(dayN / dim * 100) + ' del mes">' +
        '<div class="fill' + (usedPct > 100 ? ' over' : '') + '" style="width:' + Math.min(100, usedPct) + '%"></div>' +
        (isCur ? '<div class="today" style="left:' + (dayN / dim * 100) + '%"></div>' : '') + '</div>' +
        '<div class="meter-legend"><span>Gastado ' + pct(usedPct) + '</span>' +
        (isCur ? '<span>▏Hoy: pasó el ' + pct(dayN / dim * 100) + ' del mes</span>' : '<span>Mes cerrado</span>') + '</div>';
    }
    if (isCur && s.total) {
      // Proyección: los fijos cuentan una vez; lo variable se proyecta con el promedio diario.
      var daily = s.variable / dayN;
      var projected = s.fixedTotal + daily * dim;
      html += '<p class="pace">Gastos variables: <b class="num">' + fmt(Math.round(daily)) + '</b> por día. ';
      if (d.income) {
        var left = d.income - projected;
        html += 'A este ritmo cerrás el mes con <b class="num">' + fmt(Math.round(projected)) + '</b> gastado' +
          (left >= 0 ? ' y te sobran <b class="num">' + fmt(Math.round(left)) + '</b>.' : ', <b style="color:var(--crit)">⚠ ' + fmt(Math.round(-left)) + ' más que tu ingreso</b>.');
        var remainingDays = dim - dayN;
        if (remainingDays > 0 && avail > 0) html += ' Para no pasarte, podés gastar hasta <b class="num">' + fmt(Math.floor(avail / remainingDays)) + '</b> por día.';
      } else {
        html += 'A este ritmo cerrás el mes con <b class="num">' + fmt(Math.round(projected)) + '</b>.';
      }
      html += '</p>';
    }
    html += '</div>';

    // Categorías
    html += '<div class="card"><h2>¿En qué se va la plata?</h2>';
    if (!s.rows.length) {
      html += '<div class="empty"><div class="big">🧾</div>Anotá tu primer gasto abajo.<br><span class="small">Ej: <b>super 45k</b>, <b>uber 8000 ayer</b>, <b>netflix 9k</b></span></div>';
    } else {
      html += '<ul class="cats">' + s.rows.map(function (r) {
        var st = budgetStatus(r.amount, r.budget);
        return '<li><button class="cat" data-act="filter-cat" data-id="' + esc(r.cat.id) + '">' +
          '<span class="emo" aria-hidden="true">' + esc(r.cat.emoji) + '</span>' +
          '<span class="name">' + esc(r.cat.name) + '</span>' +
          '<span class="pct num">' + pct(r.pct) + '</span>' +
          '<span class="bar"><i style="width:' + r.pct + '%"></i></span>' +
          '<span class="amt num">' + fmt(r.amount) + '</span>' +
          (st ? '<span class="budget"><span class="status ' + st.cls + '">' + esc(st.text) + '</span></span>' : '') +
          '</button></li>';
      }).join('') + '</ul>';
    }
    html += '</div>';

    // Últimos
    if (d.expenses.length) {
      html += '<div class="card"><h2>Últimos gastos <button class="link" data-act="go-movs">Ver todos</button></h2>' +
        '<div class="tx-list" style="border:0;margin:0 -16px -16px;border-radius:0 0 16px 16px">' +
        d.expenses.slice(0, 5).map(txRow).join('') + '</div></div>';
    }
    return html;
  }

  function txRow(e) {
    var c = catOf(e.category);
    var src = e.source === 'siri' ? ' · 🎙️ Siri' : e.source === 'fijo' ? ' · 📌 Fijo' : '';
    return '<button class="tx' + (e.pending ? ' pending' : '') + '" data-act="edit-tx" data-id="' + esc(e.id) + '">' +
      '<span class="emo" aria-hidden="true">' + esc(c.emoji) + '</span>' +
      '<span class="main"><div class="d">' + esc(e.description) + '</div><div class="c">' + esc(c.name) + ' · ' + esc(dayLabel(e.date)) + src + '</div></span>' +
      '<span class="a num">' + fmt(e.amount) + '</span></button>';
  }

  function renderMovs() {
    var d = S.data, s = summary(d);
    var list = d.expenses.filter(function (e) { return !S.filter || catOf(e.category).id === S.filter; });
    var html = '<div class="chips"><button class="chip' + (!S.filter ? ' on' : '') + '" data-act="chip" data-id="">Todas · ' + fmt(s.total) + '</button>' +
      s.rows.filter(function (r) { return r.amount > 0; }).map(function (r) {
        return '<button class="chip' + (S.filter === r.cat.id ? ' on' : '') + '" data-act="chip" data-id="' + esc(r.cat.id) + '">' +
          esc(r.cat.emoji) + ' ' + esc(r.cat.name) + ' · ' + pct(r.pct) + '</button>';
      }).join('') + '</div>';
    if (!list.length) return html + '<div class="empty"><div class="big">🗒️</div>No hay gastos' + (S.filter ? ' en esta categoría' : ' este mes') + '.</div>';
    var groups = [], cur = null;
    list.forEach(function (e) {
      if (!cur || cur.date !== e.date) { cur = { date: e.date, items: [], total: 0 }; groups.push(cur); }
      cur.items.push(e); cur.total += e.amount;
    });
    if (S.filter) {
      var tot = list.reduce(function (a, e) { return a + e.amount; }, 0);
      html += '<p class="small ink2" style="margin:0 4px 10px">' + list.length + ' gastos · ' + fmt(tot) + '</p>';
    }
    html += groups.map(function (g) {
      return '<div class="day"><span>' + esc(dayLabel(g.date)) + '</span><span class="num">' + fmt(g.total) + '</span></div>' +
        '<div class="tx-list">' + g.items.map(txRow).join('') + '</div>';
    }).join('');
    return html;
  }

  function renderHist() {
    if (!S.history) {
      loadHistory();
      return '<div class="empty">Cargando historial…</div>';
    }
    var months = S.history.months || [];
    if (!months.length) return '<div class="empty"><div class="big">📅</div>Todavía no hay meses para comparar.</div>';
    var max = Math.max.apply(null, months.map(function (m) { return Math.max(m.total, m.income || 0); }));
    var html = '<div class="card"><h2>Gasto por mes</h2>' + months.slice().reverse().map(function (m) {
      var sub = m.income
        ? m.month === curMonth() && m.income >= m.total ? 'Disponible ' + fmt(m.income - m.total) + ' · mes en curso'
        : (m.income >= m.total ? 'Ahorro ' + fmt(m.income - m.total) + ' (' + pct((m.income - m.total) / m.income * 100) + ' del ingreso)' : '⚠ Te pasaste ' + fmt(m.total - m.income))
        : 'Sin ingreso cargado';
      return '<button class="hist-row" data-act="go-month" data-id="' + m.month + '">' +
        '<span class="m">' + esc(monthShort(m.month)) + '</span>' +
        '<span class="bar"><i style="width:' + (m.total / max * 100) + '%"></i></span>' +
        '<span class="v num">' + fmt(m.total) + '</span>' +
        '<span class="s">' + esc(sub) + '</span></button>';
    }).join('') + '</div>';

    // Comparación mes elegido vs anterior
    var cur = months.filter(function (m) { return m.month === S.month; })[0];
    var prev = months.filter(function (m) { return m.month === shiftMonth(S.month, -1); })[0];
    if (cur && prev) {
      var ids = {};
      Object.keys(cur.byCategory).concat(Object.keys(prev.byCategory)).forEach(function (id) { ids[catOf(id).id] = true; });
      var sumBy = function (m, id) {
        return Object.keys(m.byCategory).reduce(function (a, k) { return a + (catOf(k).id === id ? m.byCategory[k] : 0); }, 0);
      };
      var rows = Object.keys(ids).map(function (id) { return { id: id, a: sumBy(cur, id), b: sumBy(prev, id) }; })
        .sort(function (x, y) { return y.a - x.a; });
      html += '<div class="card"><h2>' + esc(cap(MONTHS[+S.month.slice(5) - 1])) + ' vs. ' + esc(MONTHS[+prev.month.slice(5) - 1]) + '</h2>' +
        '<table class="cmp"><thead><tr><th>Categoría</th><th>' + esc(monthShort(S.month)) + '</th><th>' + esc(monthShort(prev.month)) + '</th><th>Cambio</th></tr></thead><tbody>' +
        rows.map(function (r) {
          var c = catOf(r.id), delta = '';
          if (r.b > 0) {
            var ch = (r.a - r.b) / r.b * 100;
            delta = Math.abs(ch) < 1 ? '<span class="muted">=</span>' : '<span class="' + (ch > 0 ? 'up' : 'down') + '">' + (ch > 0 ? '▲ ' : '▼ ') + Math.abs(Math.round(ch)) + '%</span>';
          } else if (r.a > 0) delta = '<span class="up">nuevo</span>';
          return '<tr><td>' + esc(c.emoji) + ' ' + esc(c.name) + '</td><td class="num">' + fmt(r.a) + '</td><td class="num muted">' + fmt(r.b) + '</td><td class="num">' + delta + '</td></tr>';
        }).join('') + '</tbody></table>' +
        (S.month === curMonth() ? '<p class="small muted" style="margin-bottom:0">El mes actual todavía no terminó: compará con cuidado.</p>' : '') + '</div>';
    }
    return html;
  }

  function loadHistory() {
    if (!backend || S.loadingHistory) return;
    S.loadingHistory = true;
    backend.call('history', {}).then(function (r) {
      S.loadingHistory = false;
      if (!r.ok) { toast(r.error); return; }
      S.history = r; LS.set('history', r);
      if (S.tab === 'historial') render();
    }).catch(function () {
      S.loadingHistory = false;
      S.history = LS.get('history', { months: [] });
      if (S.tab === 'historial') render();
    });
  }

  function renderAjustes() {
    var d = S.data, html = '';
    var isLocal = backend && backend.kind === 'local';

    // Conexión
    if (DEMO) {
      html += '<div class="card"><h2>Modo demo</h2><p class="small ink2" style="margin:0">Estás viendo datos de ejemplo. Nada de esto se mezcla con tus datos reales.</p>' +
        '<button class="btn btn-block" data-act="demo-reset">Reiniciar demo</button>' +
        '<a class="btn-primary btn-block" style="display:flex;align-items:center;justify-content:center;text-decoration:none" href="./">Salir de la demo</a></div>';
    } else if (isLocal) {
      html += '<div class="card"><h2>Modo local</h2><p class="small ink2" style="margin:0">Tus datos están solo en este teléfono. Para usar el atajo de Siri y tener respaldo, conectá tu Google Sheet.</p>' +
        '<button class="btn-primary btn-block" data-act="to-remote">Conectar Google Sheet</button></div>';
    } else {
      html += renderConnectForm(false).replace('Conectar Google Sheet', 'Conexión con Google Sheet');
      var localDb = LS.get('db', null);
      if (localDb && localDb.expenses && localDb.expenses.length) {
        html += '<div class="card"><h2>Datos del modo local</h2><p class="small ink2" style="margin:0">Tenés ' + localDb.expenses.length +
          ' gastos guardados en modo local. Podés pasarlos a tu Sheet (no se duplican si lo hacés dos veces).</p>' +
          '<button class="btn btn-block" data-act="migrate">Pasar al Google Sheet</button></div>';
      }
      html += '<div class="card"><h2>Volver a modo local</h2><button class="btn btn-block" data-act="to-local">Usar modo local en este teléfono</button></div>';
    }

    // Ingreso
    html += '<div class="card"><h2>Ingreso de ' + esc(monthLabel(S.month)) + '</h2><div class="row">' +
      '<input class="input" id="incomeIn" inputmode="decimal" value="' + (d.income || '') + '" placeholder="Ej: 850k">' +
      '<button class="btn-primary" data-act="set-income">Guardar</button></div>' +
      '<p class="small muted" style="margin-bottom:0">Los meses siguientes usan este mismo ingreso hasta que lo cambies.</p></div>';

    // Presupuestos
    html += '<div class="card"><h2>Topes por categoría</h2><p class="small muted" style="margin-top:0">Te aviso al llegar al 80% y al 100%. Dejalo vacío si no querés tope.</p>' +
      '<ul class="list-edit">' + d.categories.map(function (c) {
        return '<li><span style="width:28px;text-align:center">' + esc(c.emoji) + '</span><span class="spacer">' + esc(c.name) + '</span>' +
          '<input class="input budget-in" style="width:130px" inputmode="decimal" data-id="' + esc(c.id) + '" value="' + (d.budgets[c.id] || '') + '" placeholder="Sin tope"></li>';
      }).join('') + '</ul><button class="btn-primary btn-block" data-act="save-budgets">Guardar topes</button></div>';

    // Fijos
    html += '<div class="card"><h2>Gastos fijos</h2><p class="small muted" style="margin-top:0">Se cargan solos al empezar cada mes (alquiler, internet, prepaga…).</p>' +
      (d.fixed.length ? '<ul class="list-edit">' + d.fixed.map(function (f) {
        return '<li><span style="width:28px;text-align:center">' + esc(catOf(f.category).emoji) + '</span><span class="spacer">' + esc(f.description) +
          '<br><span class="small muted">día ' + f.day + ' · ' + esc(catOf(f.category).name) + '</span></span><b class="num">' + fmt(f.amount) + '</b>' +
          '<button class="x" data-act="del-fixed" data-id="' + esc(f.id) + '" aria-label="Quitar">✕</button></li>';
      }).join('') + '</ul>' : '') +
      '<div class="grid-2" style="margin-top:8px"><input class="input" id="fxDesc" placeholder="Descripción"><input class="input" id="fxAmount" inputmode="decimal" placeholder="Monto"></div>' +
      '<div class="grid-2" style="margin-top:8px"><input class="input" id="fxDay" inputmode="numeric" placeholder="Día del mes (1-31)"><select class="input" id="fxCat">' +
      d.categories.map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === 'vivienda' ? ' selected' : '') + '>' + esc(c.emoji + ' ' + c.name) + '</option>'; }).join('') +
      '</select></div><button class="btn btn-block" data-act="add-fixed">+ Agregar gasto fijo</button></div>';

    // Categorías
    html += '<div class="card"><h2>Categorías</h2><ul class="list-edit" id="catEdit">' + d.categories.map(catEditRow).join('') + '</ul>' +
      '<div class="btn-row"><button class="btn" data-act="add-cat">+ Nueva</button><button class="btn-primary" data-act="save-cats">Guardar</button></div></div>';

    // Reglas
    html += '<div class="card"><h2>Palabras aprendidas</h2>' +
      (d.rules.length ? '<ul class="list-edit">' + d.rules.map(function (r) {
        var c = catOf(r.category);
        return '<li><span class="spacer">“' + esc(r.keyword) + '” → ' + esc(c.emoji + ' ' + c.name) + '</span>' +
          '<button class="x" data-act="del-rule" data-id="' + esc(r.keyword) + '" aria-label="Olvidar">✕</button></li>';
      }).join('') + '</ul>' : '<p class="small muted" style="margin:0">Cuando corregís la categoría de un gasto, aprendo la palabra y la uso la próxima vez.</p>') +
      '<div class="grid-2" style="margin-top:10px"><input class="input" id="ruleKw" placeholder="Palabra (ej: coto)"><select class="input" id="ruleCat">' +
      d.categories.map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.emoji + ' ' + c.name) + '</option>'; }).join('') +
      '</select></div><button class="btn btn-block" data-act="add-rule">+ Enseñar palabra</button></div>';

    // Exportar
    html += '<div class="card"><h2>Exportar</h2>' +
      '<button class="btn-primary btn-block" data-act="csv">Descargar CSV de ' + esc(monthLabel(S.month)) + '</button>' +
      (isLocal ? '<button class="btn btn-block" data-act="csv-all">CSV con todos los meses (backup)</button>' : '<p class="small muted" style="margin-bottom:0">Todo tu historial también está en tu Google Sheet.</p>') +
      '</div>';

    if (!isLocal && !DEMO) {
      html += '<div class="card"><h2>Atajo de Siri</h2><p class="small ink2" style="margin:0">Decí <b>“Oye Siri, gasto”</b> y dictá, por ejemplo, “nafta 20 lucas”. Cómo armarlo: SETUP.md, paso 6. Datos que te pide:</p>' +
        '<div class="note"><div class="small muted">URL</div><div class="code">' + esc(settings.url || '') + '</div>' +
        '<div class="small muted" style="margin-top:6px">Cuerpo (JSON)</div><div class="code">token: (tu token) · action: siri · text: (dictado)</div></div></div>';
    }
    html += '<p class="small muted" style="text-align:center">FinanceBro · hecho para anotar rápido</p>';
    return html;
  }

  function catEditRow(c) {
    return '<li data-id="' + esc(c.id) + '"><input class="input emoji-in" value="' + esc(c.emoji) + '" aria-label="Emoji">' +
      '<input class="input name-in" value="' + esc(c.name) + '" aria-label="Nombre">' +
      (c.id === 'otros' ? '<span class="x"></span>' : '<button class="x" data-act="del-cat" aria-label="Borrar categoría">✕</button>') + '</li>';
  }

  /* ================= Carga rápida ================= */

  var qInput = $('#quickInput');
  var qPreview = $('#quickPreview');

  function currentParse() {
    return parseExpense(qInput.value, { today: todayISO(), rules: S.data.rules, categories: S.data.categories });
  }

  function updatePreview() {
    var v = qInput.value.trim();
    if (!v) { qPreview.hidden = true; S.override = null; return; }
    var r = currentParse();
    qPreview.hidden = false;
    if (!r.ok) { qPreview.innerHTML = '<span class="err">' + esc(/monto/.test(r.error) ? 'Falta el monto… (ej: ' + v + ' 3500)' : r.error) + '</span>'; return; }
    var c = catOf(S.override || r.category);
    qPreview.innerHTML = '<button type="button" class="pill cat-pick" data-act="pick-cat">' + esc(c.emoji + ' ' + c.name) + ' ▾</button>' +
      '<span class="pill num">' + fmt(r.amount) + '</span>' +
      '<span class="pill">' + esc(dayLabel(r.date)) + '</span>' +
      (r.description ? '<span class="small muted">' + esc(r.description) + '</span>' : '');
  }

  function submitQuick(ev) {
    ev.preventDefault();
    if (!S.data) return;
    var r = currentParse();
    if (!r.ok) { toast(r.error); return; }
    var catId = S.override || r.category;
    var x = { id: uid(), date: r.date, description: r.description, category: catId, amount: r.amount, source: 'app', created: new Date().toISOString() };
    var before = S.data.month === r.date.slice(0, 7) ? (summary(S.data).byCat[catId] || 0) : null;
    mutate({ action: 'add', expense: x });
    var c = catOf(catId);
    var msg = '✓ ' + x.description + ' ' + fmt(x.amount) + ' → ' + c.emoji + ' ' + c.name;
    if (r.date.slice(0, 7) !== S.month) msg += ' (en ' + monthLabel(r.date.slice(0, 7)) + ')';
    var budget = Number(S.data.budgets[catId]) || 0;
    if (before != null && budget) {
      var after = before + x.amount;
      if (after >= budget && before < budget) msg = '⛔ ' + c.name + ': te pasaste del tope (' + fmt(after) + ' de ' + fmt(budget) + ')';
      else if (after >= budget * 0.8 && before < budget * 0.8) msg = '⚠️ ' + c.name + ' llegó al ' + Math.round(after / budget * 100) + '% del tope';
    }
    if (S.override && S.override !== r.category && r.categorySource !== 'tag') {
      var kw = learnKeyword(r.description);
      if (kw) { mutate({ action: 'addRule', keyword: kw, category: catId }); msg += '. Aprendí “' + kw + '”.'; }
    }
    toast(msg);
    qInput.value = '';
    S.override = null;
    updatePreview();
  }

  /* ================= Hoja inferior ================= */

  var sheet = $('#sheet'), backdrop = $('#sheetBackdrop');
  function openSheet(html) {
    sheet.innerHTML = '<div class="grab"></div>' + html;
    sheet.hidden = false; backdrop.hidden = false;
  }
  function closeSheet() { sheet.hidden = true; backdrop.hidden = true; sheet.innerHTML = ''; }

  function catGrid(selected) {
    return '<div class="cat-grid">' + S.data.categories.map(function (c) {
      return '<button type="button" data-act="sheet-cat" data-id="' + esc(c.id) + '" class="' + (c.id === selected ? 'on' : '') + '"><span>' + esc(c.emoji) + '</span>' + esc(c.name) + '</button>';
    }).join('') + '</div>';
  }

  var editing = null;
  function openEdit(id) {
    var e = S.data.expenses.filter(function (x) { return x.id === id; })[0];
    if (!e) return;
    editing = { id: id, category: catOf(e.category).id, original: catOf(e.category).id };
    openSheet('<h3>Editar gasto</h3>' +
      '<label class="f" for="edDesc">Descripción</label><input class="input" id="edDesc" value="' + esc(e.description) + '">' +
      '<div class="grid-2"><div><label class="f" for="edAmount">Monto</label><input class="input" id="edAmount" inputmode="decimal" value="' + e.amount + '"></div>' +
      '<div><label class="f" for="edDate">Fecha</label><input class="input" id="edDate" type="date" value="' + esc(e.date) + '"></div></div>' +
      '<label class="f">Categoría</label>' + catGrid(editing.category) +
      '<label class="check" id="edLearnWrap" hidden><input type="checkbox" id="edLearn" checked><span id="edLearnTxt"></span></label>' +
      '<div class="btn-row"><button class="btn-danger" data-act="ed-delete">Eliminar</button><button class="btn-primary" data-act="ed-save">Guardar</button></div>');
  }

  function openCatPicker() {
    var r = currentParse();
    openSheet('<h3>¿Qué categoría?</h3><p class="small muted" style="margin:0">Si la cambiás, aprendo la palabra para la próxima.</p>' +
      catGrid(S.override || (r.ok ? r.category : null)));
    editing = null;
  }

  /* ================= Acciones ================= */

  var ACTS = {
    'welcome-local': function () {
      settings = { mode: 'local' }; LS.set('settings', settings); makeBackend(); S.showSetup = false;
      render(); refresh();
    },
    'welcome-remote': function () { S.showSetup = 'remote'; render(); },
    'welcome-back': function () { S.showSetup = false; render(); },
    'to-remote': function () { S.showSetup = 'remote'; render(); },
    'to-local': function () {
      if (!confirm('¿Pasar a modo local? Tu Google Sheet no se borra; simplemente esta app deja de usarlo.')) return;
      settings = { mode: 'local' }; LS.set('settings', settings); makeBackend();
      S.data = emptyData(S.month); S.history = null; render(); refresh();
    },
    'save-remote': function () {
      var url = ($('#cfgUrl').value || '').trim(), token = ($('#cfgToken').value || '').trim();
      if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) { toast('La URL tiene que empezar con https://script.google.com/…'); return; }
      if (!token) { toast('Falta el token'); return; }
      var test = RemoteBackend(url, token);
      toast('Probando conexión…');
      test.call('state', { month: S.month }).then(function (r) {
        if (!r.ok) { toast('✕ ' + r.error); return; }
        settings = { mode: 'remote', url: url, token: token }; LS.set('settings', settings); makeBackend();
        S.showSetup = false; S.history = null;
        S.data = normalizeData(r, S.month); saveCache();
        toast('✓ Conectado a tu Google Sheet');
        render(); flush();
      }).catch(function (e) { toast('✕ ' + e.message); });
    },
    'migrate': function () {
      var db = LS.get('db', null);
      if (!db) return;
      Object.keys(db.config).forEach(function (k) {
        if (k.indexOf('ingreso:') === 0) S.queue.push({ action: 'setIncome', month: k.slice(8), amount: db.config[k], _qid: uid() });
      });
      if (db.config.categorias) S.queue.push({ action: 'setCategories', categories: db.config.categorias, _qid: uid() });
      if (db.config.presupuestos) S.queue.push({ action: 'setBudgets', budgets: db.config.presupuestos, _qid: uid() });
      if (db.fixed.length) S.queue.push({ action: 'setFixed', fixed: db.fixed, _qid: uid() });
      db.rules.forEach(function (r) { S.queue.push({ action: 'addRule', keyword: r.keyword, category: r.category, _qid: uid() }); });
      db.expenses.forEach(function (e) { S.queue.push({ action: 'add', expense: e, _qid: uid() }); });
      saveQueue();
      toast('Subiendo ' + db.expenses.length + ' gastos… puede tardar un poco.');
      flush().then(function () { if (!S.queue.length) toast('✓ Datos locales pasados al Sheet'); });
    },
    'demo-reset': function () {
      try { Object.keys(localStorage).forEach(function (k) { if (k.indexOf(P) === 0) localStorage.removeItem(k); }); } catch (e) { /* sin storage */ }
      location.reload();
    },
    'set-income': function () {
      var v = amountFrom($('#incomeIn').value);
      if (!(v >= 0)) { toast('Escribí un monto, por ejemplo 850000 o 850k'); return; }
      document.activeElement && document.activeElement.blur();
      mutate({ action: 'setIncome', month: S.month, amount: v });
      toast('✓ Ingreso de ' + monthLabel(S.month) + ': ' + fmt(v));
    },
    'edit-income': function () {
      var v = prompt('Ingreso de ' + monthLabel(S.month), S.data.income || '');
      if (v == null) return;
      var n = amountFrom(v);
      if (!(n >= 0)) { toast('Monto inválido'); return; }
      mutate({ action: 'setIncome', month: S.month, amount: n });
    },
    'filter-cat': function (t) { S.filter = t.dataset.id; S.tab = 'movimientos'; render(); window.scrollTo(0, 0); },
    'go-movs': function () { S.filter = null; S.tab = 'movimientos'; render(); window.scrollTo(0, 0); },
    'chip': function (t) { S.filter = t.dataset.id || null; render(); },
    'go-month': function (t) { goMonth(t.dataset.id); S.tab = 'inicio'; render(); },
    'edit-tx': function (t) { openEdit(t.dataset.id); },
    'pick-cat': function () { openCatPicker(); },
    'sheet-cat': function (t) {
      var id = t.dataset.id;
      if (editing) {
        editing.category = id;
        sheet.querySelectorAll('.cat-grid button').forEach(function (b) { b.classList.toggle('on', b.dataset.id === id); });
        var kw = learnKeyword($('#edDesc').value);
        var show = id !== editing.original && !!kw;
        $('#edLearnWrap').hidden = !show;
        if (show) $('#edLearnTxt').textContent = 'Recordar: lo que diga “' + kw + '” va siempre en ' + catOf(id).name;
      } else {
        S.override = id; closeSheet(); updatePreview(); qInput.focus();
      }
    },
    'ed-save': function () {
      var amount = amountFrom($('#edAmount').value);
      var date = $('#edDate').value;
      var desc = $('#edDesc').value.trim();
      if (!(amount > 0)) { toast('Monto inválido'); return; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast('Fecha inválida'); return; }
      var learn = editing.category !== editing.original && $('#edLearn').checked;
      mutate({ action: 'update', id: editing.id, patch: { description: desc || catOf(editing.category).name, amount: amount, date: date, category: editing.category }, learn: learn });
      closeSheet();
      toast(date.slice(0, 7) !== S.month ? '✓ Guardado (lo moviste a ' + monthLabel(date.slice(0, 7)) + ')' : '✓ Guardado');
    },
    'ed-delete': function () {
      if (!confirm('¿Eliminar este gasto?')) return;
      mutate({ action: 'delete', id: editing.id });
      closeSheet();
      toast('Gasto eliminado');
    },
    'save-budgets': function () {
      var b = {};
      document.querySelectorAll('.budget-in').forEach(function (i) {
        var v = amountFrom(i.value);
        if (i.value.trim() && v > 0) b[i.dataset.id] = v;
      });
      document.activeElement && document.activeElement.blur();
      mutate({ action: 'setBudgets', budgets: b });
      toast('✓ Topes guardados');
    },
    'add-fixed': function () {
      var desc = $('#fxDesc').value.trim(), amount = amountFrom($('#fxAmount').value), day = parseInt($('#fxDay').value, 10) || 1;
      if (!desc || !(amount > 0)) { toast('Completá descripción y monto'); return; }
      day = Math.min(31, Math.max(1, day));
      var f = { id: uid().slice(0, 8), description: desc, category: $('#fxCat').value, amount: amount, day: day, active: true };
      document.activeElement && document.activeElement.blur();
      mutate({ action: 'setFixed', fixed: S.data.fixed.concat([f]) });
      var m = curMonth();
      if (confirm('¿Lo cargo también en ' + monthLabel(m) + '?')) {
        mutate({ action: 'add', expense: { id: 'fijo-' + f.id + '-' + m, date: m + '-' + pad2(Math.min(day, daysInMonth(m))), description: desc,
          category: f.category, amount: amount, source: 'fijo', created: new Date().toISOString() } });
      }
      toast('✓ Gasto fijo agregado');
    },
    'del-fixed': function (t) {
      if (!confirm('¿Quitar este gasto fijo? Los meses ya cargados no cambian.')) return;
      mutate({ action: 'setFixed', fixed: S.data.fixed.filter(function (f) { return f.id !== t.dataset.id; }) });
    },
    'add-cat': function () {
      var ul = $('#catEdit');
      ul.insertAdjacentHTML('beforeend', catEditRow({ id: 'c' + Date.now().toString(36), emoji: '⭐', name: '' }));
      ul.lastElementChild.querySelector('.name-in').focus();
    },
    'del-cat': function (t) {
      var li = t.closest('li');
      var id = li.dataset.id;
      var used = S.data.expenses.some(function (e) { return e.category === id; });
      if (used && !confirm('Esta categoría tiene gastos este mes. Si la borrás, se van a mostrar como “Otros”. ¿Seguir?')) return;
      li.remove();
    },
    'save-cats': function () {
      var list = [];
      document.querySelectorAll('#catEdit li').forEach(function (li) {
        var name = li.querySelector('.name-in').value.trim();
        if (!name) return;
        list.push({ id: li.dataset.id, name: name, emoji: li.querySelector('.emoji-in').value.trim() || '•' });
      });
      // "Otros" siempre al final: es donde cae lo que no se reconoce.
      var otros = list.filter(function (c) { return c.id === 'otros'; })[0] || { id: 'otros', name: 'Otros', emoji: '📦' };
      list = list.filter(function (c) { return c.id !== 'otros'; }).concat([otros]);
      document.activeElement && document.activeElement.blur();
      mutate({ action: 'setCategories', categories: list });
      toast('✓ Categorías guardadas');
    },
    'add-rule': function () {
      var kw = normalizeText($('#ruleKw').value);
      if (!kw) { toast('Escribí una palabra'); return; }
      var cat = $('#ruleCat').value;
      document.activeElement && document.activeElement.blur();
      mutate({ action: 'addRule', keyword: kw, category: cat });
      toast('✓ “' + kw + '” → ' + catOf(cat).name);
    },
    'del-rule': function (t) { mutate({ action: 'deleteRule', keyword: t.dataset.id }); },
    'csv': function () { exportCSV(S.data.expenses, 'gastos-' + S.month + '.csv'); },
    'csv-all': function () {
      var db = backend.dump ? backend.dump() : null;
      if (db) exportCSV(sortExpenses(db.expenses.slice()), 'gastos-todos-' + todayISO() + '.csv');
    }
  };

  function goMonth(m) {
    if (m > curMonth()) return;
    S.month = m;
    S.filter = null;
    S.data = loadCached(m);
    S.queue.forEach(function (op) { applyOp(S.data, op); });
    render();
    refresh();
  }

  /* ================= CSV ================= */

  function csvCell(v) {
    var s = String(v == null ? '' : v);
    return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function exportCSV(expenses, filename) {
    if (!expenses.length) { toast('No hay gastos para exportar'); return; }
    var rows = expenses.slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; }).map(function (e) {
      var p = e.date.split('-');
      return [p[2] + '/' + p[1] + '/' + p[0], e.description, catOf(e.category).name, String(e.amount).replace('.', ','), e.source || 'app'];
    });
    var text = '﻿' + [['fecha', 'descripción', 'categoría', 'monto', 'origen']].concat(rows)
      .map(function (r) { return r.map(csvCell).join(';'); }).join('\r\n') + '\r\n';
    var blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    var touch = window.matchMedia && matchMedia('(pointer: coarse)').matches;
    if (touch && window.File && navigator.canShare) {
      var file = new File([blob], filename, { type: 'text/csv' });
      if (navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: filename }).catch(function (e) { if (e.name !== 'AbortError') download(blob, filename); });
        return;
      }
    }
    download(blob, filename);
  }

  function download(blob, filename) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    toast('✓ ' + filename);
  }

  /* ================= Toast ================= */

  var toastTimer = null;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 3200);
  }

  /* ================= Demo ================= */

  function seedDemo() {
    if (LS.get('db', null)) return;
    var seed = 7;
    function rnd() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
    var pool = [
      ['Coto', 'super', 25000, 60000], ['Chino', 'super', 4000, 15000], ['Verdulería', 'super', 3000, 9000],
      ['Café', 'comida', 2800, 4500], ['Almuerzo', 'comida', 8000, 16000], ['Rappi', 'comida', 12000, 25000],
      ['Medialunas', 'comida', 3000, 6000], ['Uber', 'transporte', 4000, 12000], ['SUBE', 'transporte', 5000, 5000],
      ['Nafta', 'transporte', 20000, 35000], ['Farmacity', 'salud', 5000, 18000], ['Cine', 'ocio', 8000, 14000],
      ['Birra con amigos', 'comida', 9000, 20000], ['Zapatillas', 'compras', 60000, 90000], ['Kiosco', 'comida', 1500, 4000]
    ];
    var db = { expenses: [], config: {}, rules: [{ keyword: 'chino', category: 'super' }], fixed: [
      { id: 'alq', description: 'Alquiler', category: 'vivienda', amount: 380000, day: 1, active: true },
      { id: 'net', description: 'Internet', category: 'vivienda', amount: 24000, day: 10, active: true },
      { id: 'nfx', description: 'Netflix', category: 'suscripciones', amount: 9999, day: 5, active: true },
      { id: 'pre', description: 'Prepaga', category: 'salud', amount: 95000, day: 3, active: true }
    ] };
    var t = todayISO();
    [-2, -1, 0].forEach(function (off) {
      var m = shiftMonth(t.slice(0, 7), off);
      db.config['ingreso:' + m] = off === -2 ? 1100000 : 1250000;
      var last = off === 0 ? +t.slice(8) : daysInMonth(m);
      if (off !== 0) {
        db.fixed.forEach(function (f) {
          db.expenses.push({ id: 'fijo-' + f.id + '-' + m, date: m + '-' + pad2(f.day), description: f.description, category: f.category, amount: f.amount, source: 'fijo', created: '' });
        });
        db.config['fijos_aplicados:' + m] = true;
      }
      for (var day = 1; day <= last; day++) {
        var n = rnd() < 0.3 ? 0 : rnd() < 0.7 ? 1 : 2;
        for (var i = 0; i < n; i++) {
          var p = pool[Math.floor(rnd() * pool.length)];
          if (p[0] === 'Zapatillas' && rnd() < 0.7) continue;
          var amt = Math.round((p[2] + rnd() * (p[3] - p[2])) / 100) * 100;
          db.expenses.push({ id: uid(), date: m + '-' + pad2(day), description: p[0], category: p[1], amount: amt,
            source: rnd() < 0.3 ? 'siri' : 'app', created: m + '-' + pad2(day) + 'T1' + i + ':00:00Z' });
        }
      }
    });
    db.config.presupuestos = { comida: 150000, ocio: 50000, transporte: 90000 };
    LS.set('db', db);
  }

  /* ================= Eventos ================= */

  function onAct(e) {
    var t = e.target.closest('[data-act]');
    if (!t) return;
    var fn = ACTS[t.dataset.act];
    if (fn) { e.preventDefault(); fn(t); }
  }
  view.addEventListener('click', onAct);
  sheet.addEventListener('click', onAct);
  qPreview.addEventListener('click', onAct);
  backdrop.addEventListener('click', closeSheet);
  sheet.addEventListener('input', function (e) {
    if (e.target.id === 'edDesc' && editing) {
      var kw = learnKeyword(e.target.value);
      if (!$('#edLearnWrap').hidden && kw) $('#edLearnTxt').textContent = 'Recordar: lo que diga “' + kw + '” va siempre en ' + catOf(editing.category).name;
    }
  });
  view.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.id === 'incomeIn') { e.preventDefault(); ACTS['set-income'](); }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !sheet.hidden) closeSheet(); });

  $('#tabs').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-tab]');
    if (!b) return;
    S.tab = b.dataset.tab;
    if (S.tab !== 'movimientos') S.filter = null;
    if (S.tab === 'historial') S.history = null;
    render();
    window.scrollTo(0, 0);
  });
  $('#prevMonth').addEventListener('click', function () { goMonth(shiftMonth(S.month, -1)); });
  $('#nextMonth').addEventListener('click', function () { goMonth(shiftMonth(S.month, 1)); });
  $('#shareStrip').addEventListener('click', function () { S.tab = 'inicio'; render(); window.scrollTo(0, 0); });
  $('#syncBadge').addEventListener('click', function () {
    toast($('#syncBadge').title);
    if (S.queue.length) flush(); else refresh();
  });
  qInput.addEventListener('input', function () { if (!qInput.value.trim()) S.override = null; updatePreview(); });
  $('#quickForm').addEventListener('submit', submitQuick);

  // Al volver a la app (por ejemplo, después de usar Siri) se trae lo nuevo.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') refresh();
  });
  window.addEventListener('online', function () { flush(); });
  setInterval(function () { if (document.visibilityState === 'visible' && S.queue.length) flush(); }, 30000);

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(function () { /* sin SW, la app igual funciona */ });
  }

  /* ================= Inicio ================= */

  if (DEMO) seedDemo();
  makeBackend();
  S.data = loadCached(S.month);
  S.queue.forEach(function (op) { applyOp(S.data, op); });
  render();
  setSync(S.queue.length ? 'pending' : 'ok');
  refresh();

  // Para depurar desde la consola.
  window.FB = { S: S, refresh: refresh, flush: flush };
})();
