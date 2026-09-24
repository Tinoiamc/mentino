/* =====================================================================
   Encuesteitor — MODO COMPETITIVO
   Competencia de preguntas con opciones y reloj. El público entra con un
   nombre (sin cuenta ni mail), responde contra reloj y el anfitrión ve el
   avance en vivo. Cuando el anfitrión corta, se muestra el ranking.

   Mismo criterio de hosteo que la app principal: archivos estáticos y
   Firebase Realtime Database. El anfitrión usa el SDK (autenticado); los
   celulares del público hablan por HTTP suelto, sin cuenta, para no abrir
   cientos de conexiones permanentes ni crear cientos de usuarios anónimos.

   La respuesta correcta NO viaja al público: vive en un nodo aparte que
   solo puede leer el anfitrión. El puntaje lo calcula el anfitrión y
   publica la tabla ya resuelta.
   ===================================================================== */
(function () {
'use strict';

/* ---------------------------------------------------------------
   1. Utilidades
   --------------------------------------------------------------- */
const APP = () => document.getElementById('app');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
  c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

let toastTimer = null;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 2600);
}

function copy(text) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => toast('Copiado'), () => toast('No se pudo copiar'));
  } else {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('Copiado'); } catch (e) { toast('No se pudo copiar'); }
    ta.remove();
  }
}

function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function csvRows(rows) {
  const cell = v => {
    const s = String(v == null ? '' : v);
    return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return '﻿' + rows.map(r => r.map(cell).join(';')).join('\r\n');
}

/* localStorage con respaldo en memoria por si el navegador lo bloquea */
const memStore = {};
let lsOk = null;
function lsAvailable() {
  if (lsOk === null) {
    try { localStorage.setItem('sala:test', '1'); localStorage.removeItem('sala:test'); lsOk = true; }
    catch (e) { lsOk = false; }
  }
  return lsOk;
}
const store = {
  get(k) { try { return lsAvailable() ? localStorage.getItem(k) : (memStore[k] || null); } catch (e) { return memStore[k] || null; } },
  set(k, v) { try { if (lsAvailable()) localStorage.setItem(k, v); else memStore[k] = v; } catch (e) { memStore[k] = v; } }
};

function randomId(n) {
  const a = new Uint32Array(n);
  (window.crypto || window.msCrypto).getRandomValues(a);
  return Array.from(a).map(x => x.toString(36)[0] || 'x').join('');
}
/* Mismo identificador de dispositivo que usa la app de encuestas: una
   persona que ya participó de una nube sigue siendo la misma acá. */
function participantId() {
  let p = store.get('sala:pid');
  if (!p || p.length < 8) { p = 'p' + randomId(19); store.set('sala:pid', p); }
  return p;
}

function baseUrl() { return location.origin + location.pathname; }

/* Los relojes y los escuchas se registran en app.js: es el que rutea y el
   que limpia todo al cambiar de pantalla. Así no quedan intervalos vivos
   cuando salís del juego. */
const timers = { push: id => window.ENC.timer(id) };
const timeouts = { push: id => window.ENC.wait(id) };

/* Nombres: cortamos lo obvio para que no aparezca una grosería proyectada
   en pantalla. No pretende ser exhaustivo. */
const BAD = `puta puto putas putos mierda pelotudo pelotuda boludo boluda concha pija verga polla conchudo
forro forra gilipollas joder carajo culiado culiao pendejo maricon marica trolo hdp hijodeputa sorete
garca choto pajero zorra imbecil idiota estupido tarado mogolico retrasado cojones follar chingar culero
ojete orto prostituta puton fuck fucking fuk shit bullshit bitch bastard asshole cunt dick cock pussy
whore slut motherfucker wanker twat retard nigga nigger faggot fag rape`.trim().split(/\s+/);
const LEET = { '0':'o','1':'i','3':'e','4':'a','5':'s','7':'t','8':'b','@':'a','$':'s','!':'i','|':'i','+':'t' };
function normalize(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
function nameLooksBad(name) {
  const forms = [normalize(name), normalize(String(name).replace(/[0134578@$!|+]/g, c => LEET[c] || c))];
  const squeeze = s => s.replace(/([a-z])\1{1,}/g, '$1');
  for (const f of forms) {
    if (!f) continue;
    const toks = f.split(' ').concat([f.replace(/\s/g, '')]);
    for (const t of toks) if (BAD.indexOf(t) >= 0 || BAD.indexOf(squeeze(t)) >= 0) return true;
  }
  return false;
}

/* ---------------------------------------------------------------
   2. Base de datos por HTTP suelto + reloj del servidor
   El encabezado Date de la respuesta nos da la hora del servidor: con eso
   el reloj de cada celular queda alineado aunque tenga la hora corrida.
   --------------------------------------------------------------- */
let DBU = '';
let skew = 0;                       // milisegundos a sumar a la hora local
const serverNow = () => Date.now() + skew;

async function restGet(path) {
  const r = await fetch(DBU + '/' + path + '.json');
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = r.headers.get('date');
  if (d) { const t = Date.parse(d); if (t) skew = t - Date.now(); }
  return r.json();
}
async function restPut(path, body) {
  const r = await fetch(DBU + '/' + path + '.json', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

/* ---------------------------------------------------------------
   3. Puente con la app principal
   Este módulo no inicializa Firebase ni escucha el hash: usa la conexión,
   la identidad y el ruteo que ya montó app.js. Se toman al entrar a cada
   pantalla, porque app.js se carga después que este archivo.
   --------------------------------------------------------------- */
const NAME = window.APP_NAME || 'Encuesteitor';
let db = null, uid = null;

function sync() {
  const E = window.ENC;
  db = E.db(); uid = E.uid(); DBU = E.dbu();
}
const on = (ref, event, cb, err) => window.ENC.on(ref, event, cb, err);
const ensureAuth = () => window.ENC.ensureAuth();
const signInGoogle = () => window.ENC.signInGoogle();

function dbMsg(e) {
  if (e && e.code === 'PERMISSION_DENIED') {
    return 'La base rechazó la operación. Falta pegar las reglas del modo competitivo (database.rules.json).';
  }
  return (e && e.message) || 'Error desconocido';
}
function renderFatal(title, detail, extra) {
  APP().innerHTML = topbar('', '') + `<div class="setup">
    <h1 style="font-family:var(--display);font-size:32px;letter-spacing:-.03em;margin:8px 0 14px">${esc(title)}</h1>
    <p class="muted">${esc(detail || '')}</p>
    <div class="btn-row" style="margin-top:18px">
      ${extra || ''}
      <a class="btn" href="#/comp">Volver al modo competitivo</a>
      <a class="btn" href="#">Ir a las encuestas</a>
    </div></div>`;
}

/* ---------------------------------------------------------------
   4. Modelo de datos

   quizzes/{code}                (lectura pública)
     owner, title, createdAt, secs, base, state, i,
     items:{ qid:{ order, question, options:[...], secs } }
     live:{ st, qid, i, at, secs, n }        <- lo consultan los celulares
   qsec/{code}/{qid} = índice correcto       (solo lo lee el anfitrión)
   qplayers/{code}/{pid} = { n, at }         (escritura pública, lectura del anfitrión)
   qa/{code}/{qid}/{pid} = { c, ms, ts }     (escritura pública una sola vez)
   qrank/{code}                              (lectura pública, la escribe el anfitrión)
   qmine/{uid}/{code} = { title, at }
   --------------------------------------------------------------- */
const DEF_SECS = 20;
const DEF_BASE = 1000;

function newQuestion(order) {
  return {
    order: order,
    question: 'Escribí acá la pregunta',
    options: ['Opción A', 'Opción B', 'Opción C', 'Opción D'],
    secs: DEF_SECS
  };
}
function itemsSorted(q) {
  const items = (q && q.items) || {};
  return Object.keys(items)
    .map(id => [id, items[id]])
    .sort((a, b) => (a[1].order || 0) - (b[1].order || 0) || (a[0] < b[0] ? -1 : 1));
}

/* Puntaje: acertar da el puntaje base; responder rápido conserva más.
   El más lento de la ventana se lleva la mitad. Errar o no contestar, cero. */
function scoreOf(ans, correct, secs, base) {
  if (!ans || typeof correct !== 'number' || ans.c !== correct) return 0;
  const win = Math.max(1, secs || DEF_SECS) * 1000;
  const t = Math.min(Math.max(ans.ms || 0, 0), win);
  return Math.round((base || DEF_BASE) * (1 - 0.5 * (t / win)));
}

async function createQuiz(title) {
  const code = await window.ENC.freeCode(6);

  const qid = 'k' + Date.now().toString(36);
  const items = {}; items[qid] = newQuestion(1);
  await db.ref('quizzes/' + code).set({
    owner: uid,
    createdAt: firebase.database.ServerValue.TIMESTAMP,
    title: (title || '').trim() || 'Competencia sin título',
    secs: DEF_SECS,
    base: DEF_BASE,
    state: 'lobby',
    i: 0,
    items: items,
    live: { st: 'lobby', qid: '', i: 0, at: 0, secs: DEF_SECS, n: 1 }
  });
  await db.ref('qsec/' + code + '/' + qid).set(0);
  await db.ref('qmine/' + uid + '/' + code).set({
    title: (title || '').trim() || 'Competencia sin título',
    at: firebase.database.ServerValue.TIMESTAMP
  }).catch(() => {});
  return code;
}

/* El permiso sobre los nodos satélite se apoya en que la competencia exista
   (así lo dicen las reglas), por eso el nodo principal se borra al final. */
function deleteQuiz(code) {
  return Promise.all([
    db.ref('qa/' + code).remove(),
    db.ref('qplayers/' + code).remove(),
    db.ref('qrank/' + code).remove(),
    db.ref('qsec/' + code).remove(),
    db.ref('qmine/' + uid + '/' + code).remove()
  ]).then(() => db.ref('quizzes/' + code).remove());
}

function topbar(titleHtml, actionsHtml) {
  return `<header class="topbar">
    <a class="brand" href="#"><span class="dots"><i></i><i></i><i></i></span>${esc(NAME)}</a>
    <span class="badge" style="margin-left:-2px">Modo competitivo</span>
    ${titleHtml || ''}
    <span class="spacer"></span>
    ${actionsHtml || ''}
  </header>`;
}

/* ---------------------------------------------------------------
   6. Portada
   --------------------------------------------------------------- */
function fmtDate(ms) {
  if (!ms) return '';
  try { return new Date(ms).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch (e) { return ''; }
}

function renderHome() {
  APP().innerHTML = topbar('', '<a class="btn btn-sm" href="#">Encuestas y nubes</a><span id="acct"></span>') + `
  <div class="home">
    <div class="home-hero">
      <p class="eyebrow">Competencia de preguntas por tiempo</p>
      <h1>Misma pregunta para todos. <em>Gana el que sabe y es rápido.</em></h1>
      <p>El público entra con un nombre, responde contra reloj y ve su puesto.
         Vos seguís el avance desde el panel y cortás cuando querés: ahí aparece el ranking.</p>
    </div>
    <div class="home-grid">
      <div class="card">
        <h3>Crear una competencia</h3>
        <div class="field">
          <label for="ttl">Nombre de la competencia</label>
          <input class="input" id="ttl" placeholder="Trivia de cierre · viernes" maxlength="80">
        </div>
        <button class="btn btn-primary btn-lg" id="go">Crear competencia</button>
        <ol class="steps">
          <li>Cargá las preguntas con sus opciones y marcá la correcta.</li>
          <li>Proyectá el código: el público entra y pone su nombre.</li>
          <li>Arrancás, avanzás pregunta por pregunta y cortás cuando quieras.</li>
        </ol>
      </div>
      <div class="card">
        <h3>Ya tengo un código</h3>
        <p class="muted" style="margin-top:-6px">Si te compartieron un código de 6 caracteres, entrá acá.</p>
        <div class="split" style="margin-top:14px">
          <input class="input" id="jc" placeholder="ABC123" maxlength="6"
                 style="font-family:var(--mono);text-transform:uppercase;letter-spacing:.12em">
          <button class="btn btn-primary" id="jb">Entrar</button>
        </div>
        <p class="muted" style="margin-top:18px">¿Buscabas las nubes de palabras y las encuestas?
          <a href="#">Ir a la app de encuestas</a>.</p>
      </div>
    </div>
    <section style="margin-top:38px">
      <h3 style="font-family:var(--display);font-size:15px;margin:0 0 12px">Mis competencias</h3>
      <div id="mine"><p class="muted">Cargando…</p></div>
    </section>
  </div>`;

  document.getElementById('go').onclick = function () {
    this.disabled = true; this.textContent = 'Creando…';
    const t = document.getElementById('ttl').value;
    ensureAuth().then(() => createQuiz(t))
      .then(code => { location.hash = '#/comp/host/' + code; })
      .catch(e => { this.disabled = false; this.textContent = 'Crear competencia'; toast(dbMsg(e)); });
  };
  const go = () => {
    const c = (document.getElementById('jc').value || '').trim().toUpperCase();
    if (c.length === 6) location.hash = '#/' + c; else toast('El código tiene seis caracteres');
  };
  document.getElementById('jb').onclick = go;
  document.getElementById('jc').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });

  ensureAuth().then(() => { paintAcct(); loadMine(); })
              .catch(e => renderFatal('No se pudo conectar', dbMsg(e)));
}

function paintAcct() {
  const el = document.getElementById('acct');
  if (!el) return;
  const u = firebase.auth().currentUser;
  if (!u) { el.innerHTML = ''; return; }
  /* El usuario del panel es "tino@sala.local": mostramos solo el nombre. */
  const dom = '@' + (window.LOGIN_DOMAIN || 'sala.local');
  const mail = u.email || '';
  const quien = mail.slice(-dom.length) === dom ? mail.slice(0, -dom.length) : (u.displayName || mail);
  el.innerHTML = `<span class="muted" style="font-size:13px;margin-right:8px">${esc(quien)}</span>
    <button class="btn btn-sm" id="qout">Salir</button>`;
  document.getElementById('qout').onclick = () =>
    firebase.auth().signOut().then(() => location.reload());
}

function loadMine() {
  const box = document.getElementById('mine');
  if (!box) return;
  db.ref('qmine/' + uid).limitToLast(30).get().then(snap => {
    const all = snap.val() || {};
    const list = Object.keys(all).map(c => [c, all[c]]).sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
    if (!list.length) { box.innerHTML = '<p class="muted">Todavía no creaste ninguna competencia.</p>'; return; }
    box.innerHTML = list.map(([c, m]) => `
      <div class="card" style="padding:13px 16px;margin-bottom:8px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <div style="flex:1;min-width:180px">
          <div style="font-family:var(--display);font-weight:600">${esc(m.title || 'Competencia')}</div>
          <div class="muted" style="font-size:12.5px;font-family:var(--mono)">${esc(c)} · ${esc(fmtDate(m.at))}</div>
        </div>
        <a class="btn btn-sm" href="#/comp/host/${esc(c)}">Abrir el panel</a>
      </div>`).join('');
  }).catch(() => { box.innerHTML = '<p class="muted">No se pudo leer la lista.</p>'; });
}

/* ---------------------------------------------------------------
   6 bis. Motor de la competencia
   Pasar preguntas, cortar el tiempo, calcular los puntajes y publicar la
   tabla. Lo usan las dos pantallas del anfitrion -el panel de la
   computadora y el control del celular-, asi que las dos escriben
   exactamente el mismo estado: da igual desde donde se maneje el juego.
   --------------------------------------------------------------- */
function quizEngine(code, S) {
  const qref = db.ref('quizzes/' + code);
  const E = { qref: qref, srvOff: 0, onTick: null };

  E.remaining = function () {
    if (!S.qLocalStart) return 0;
    return Math.max(0, S.qSecs * 1000 - (Date.now() - S.qLocalStart));
  };
  E.startTicker = function () {
    E.stopTicker();
    S.ticker = setInterval(function () { if (E.onTick) E.onTick(); }, 200);
    timers.push(S.ticker);
  };
  E.stopTicker = function () { if (S.ticker) { clearInterval(S.ticker); S.ticker = null; } };

  /* Alineamos el reloj con el del servidor, que es el que usan los
     celulares. Asi el conteo coincide y, si recargas la pantalla a mitad de
     una pregunta, el tiempo sigue donde estaba en vez de arrancar de cero. */
  E.adopt = function (q) {
    if (q.state !== 'q' || !q.live || !q.live.at) return;
    S.qSecs = q.live.secs || q.secs || DEF_SECS;
    S.qLocalStart = q.live.at - E.srvOff;
    const left = S.qSecs * 1000 - (Date.now() - S.qLocalStart);
    clearTimeout(S.autoT);
    S.autoT = setTimeout(function () { E.closeQuestion(); }, Math.max(300, left + 1200));
    timeouts.push(S.autoT);
    E.startTicker();
  };

  /* ---- maquina de estados ---- */
  E.startQuestion = function (index) {
    const list = itemsSorted(S.quiz);
    if (!list.length) return toast('Carga al menos una pregunta');
    const idx = Math.max(0, Math.min(index, list.length - 1));
    const entry = list[idx];
    const qid = entry[0], it = entry[1];
    const secs = it.secs || S.quiz.secs || DEF_SECS;
    S.qLocalStart = Date.now();
    S.qSecs = secs;
    clearTimeout(S.autoT);
    S.autoT = setTimeout(function () { E.closeQuestion(); }, secs * 1000 + 1200);
    timeouts.push(S.autoT);
    E.startTicker();
    qref.update({
      state: 'q', i: idx,
      live: { st: 'q', qid: qid, i: idx, at: firebase.database.ServerValue.TIMESTAMP, secs: secs, n: list.length }
    }).catch(function (e) { toast(dbMsg(e)); });
  };

  E.closeQuestion = function () {
    clearTimeout(S.autoT);
    E.stopTicker();
    if (!S.quiz || S.quiz.state !== 'q') return;
    const list = itemsSorted(S.quiz);
    const idx = S.quiz.i || 0;
    const entry = list[idx];
    qref.update({
      state: 'rev',
      live: { st: 'rev', qid: entry ? entry[0] : '', i: idx, at: firebase.database.ServerValue.TIMESTAMP,
              secs: S.qSecs, n: list.length }
    }).then(function () { return E.publishRank(false); }).catch(function (e) { toast(dbMsg(e)); });
  };

  E.advance = function () {
    const st = S.quiz.state;
    if (st === 'lobby') return E.startQuestion(S.quiz.i || 0);
    if (st === 'q') return E.closeQuestion();
    if (st === 'rev') {
      const list = itemsSorted(S.quiz);
      const next = (S.quiz.i || 0) + 1;
      if (next < list.length) return E.startQuestion(next);
      return E.endGame();
    }
  };

  E.endGame = function () {
    clearTimeout(S.autoT); E.stopTicker();
    const list = itemsSorted(S.quiz);
    qref.update({
      state: 'end',
      live: { st: 'end', qid: '', i: S.quiz.i || 0, at: firebase.database.ServerValue.TIMESTAMP,
              secs: 0, n: list.length }
    }).then(function () { return E.publishRank(true); }).catch(function (e) { toast(dbMsg(e)); });
  };

  E.backToLobby = function (wipe) {
    clearTimeout(S.autoT); E.stopTicker();
    const list = itemsSorted(S.quiz);
    const go = function () {
      return qref.update({
        state: 'lobby', i: 0,
        live: { st: 'lobby', qid: '', i: 0, at: 0, secs: S.quiz.secs || DEF_SECS, n: list.length }
      });
    };
    if (!wipe) return go().catch(function (e) { toast(dbMsg(e)); });
    Promise.all([
      db.ref('qa/' + code).remove(),
      db.ref('qplayers/' + code).remove(),
      db.ref('qrank/' + code).remove()
    ]).then(go).then(function () { toast('Todo en cero: podes jugar de nuevo con otro grupo'); })
      .catch(function (e) { toast(dbMsg(e)); });
  };

  /* ---- tabla de posiciones ---- */
  E.computeRank = function () {
    const list = itemsSorted(S.quiz);
    const base = S.quiz.base || DEF_BASE;
    const acc = {};
    Object.keys(S.players).forEach(function (p) { acc[p] = { n: S.players[p].n || 'Sin nombre', s: 0, ok: 0, ans: 0 }; });
    list.forEach(function (pair) {
      const qid = pair[0], it = pair[1];
      const correct = S.sec[qid];
      const rs = S.answers[qid] || {};
      Object.keys(rs).forEach(function (p) {
        if (!acc[p]) acc[p] = { n: 'Sin nombre', s: 0, ok: 0, ans: 0 };
        const pts = scoreOf(rs[p], correct, it.secs || S.quiz.secs, base);
        acc[p].s += pts; acc[p].ans++;
        if (pts > 0) acc[p].ok++;
      });
    });
    return Object.keys(acc)
      .map(function (p) { return { p: p, n: acc[p].n, s: acc[p].s, ok: acc[p].ok }; })
      .sort(function (a, b) { return b.s - a.s || String(a.n).localeCompare(String(b.n)); });
  };

  /* Publica la tabla ya resuelta y, si corresponde, el detalle de la ultima
     pregunta (cual era la correcta y como se repartieron las respuestas).
     El publico solo lee esto: nunca ve la respuesta correcta antes de tiempo. */
  E.publishRank = function (done) {
    const arr = E.computeRank();
    const sc = {};
    arr.slice(0, 400).forEach(function (r, i) { sc[r.p] = [i + 1, r.s]; });
    const payload = {
      at: firebase.database.ServerValue.TIMESTAMP,
      n: arr.length,
      done: !!done,
      top: arr.slice(0, 50),
      sc: sc
    };
    const list = itemsSorted(S.quiz);
    const entry = list[S.quiz.i || 0];
    if (entry) {
      const qid = entry[0], it = entry[1];
      const rs = S.answers[qid] || {};
      const counts = (it.options || []).map(function () { return 0; });
      Object.keys(rs).forEach(function (p) { const c = rs[p].c; if (counts[c] !== undefined) counts[c]++; });
      payload.last = {
        qid: qid, i: (S.quiz.i || 0) + 1, q: it.question || '',
        opts: it.options || [], correct: typeof S.sec[qid] === 'number' ? S.sec[qid] : -1,
        counts: counts, secs: it.secs || S.quiz.secs || DEF_SECS, base: S.quiz.base || DEF_BASE
      };
    }
    return db.ref('qrank/' + code).set(payload).catch(function (e) { toast(dbMsg(e)); });
  };

  return E;
}

/* ---------------------------------------------------------------
   7. Panel del anfitrión (backoffice)
   --------------------------------------------------------------- */
function renderHostQuiz(code) {
  const S = {
    code, quiz: null, sec: {}, players: {}, answers: {},
    qLocalStart: 0, qSecs: DEF_SECS, autoT: null, ticker: null,
    edTouch: 0, edTimer: null
  };

  APP().innerHTML = topbar('', '') + `<div class="host"><div class="rail"></div>
    <div class="stage-wrap"><div class="stage"><p class="empty">Cargando…</p></div></div></div>
    <button class="btn exit-present" id="exitPres">Salir de presentación</button>`;
  document.getElementById('exitPres').onclick = () => document.body.classList.remove('present');

  const E = quizEngine(code, S);
  const qref = E.qref;
  E.onTick = paintTimer;

  /* Atajos: flecha derecha avanza (empezar / siguiente), Escape sale de
     presentación, barra espaciadora cierra la pregunta abierta. */
  window.ENC.navKeys(function (e) {
    const t = e.target;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (!S.quiz) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); E.advance(); }
    else if ((e.key === ' ' || e.key === 'Spacebar') && S.quiz.state === 'q') { e.preventDefault(); E.closeQuestion(); }
    else if (e.key === 'Escape') document.body.classList.remove('present');
  });

  on(qref, 'value', snap => {
    if (!snap.exists()) { window.ENC.stop(); return renderFatal('Esa competencia no existe', 'El código ' + code + ' no corresponde a ninguna competencia.'); }
    const q = snap.val();
    if (q.owner !== uid) {
      window.ENC.stop();
      return renderFatal('Esta pantalla es del anfitrión',
        'El panel donde se arman las preguntas y se maneja el juego lo abre únicamente quien creó la competencia. Si te compartieron el código, entrá a jugar.',
        `<a class="btn btn-primary" href="#/${esc(code)}">Entrar a jugar</a>`);
    }
    S.quiz = q;
    E.adopt(q);
    paint();
  }, e => renderFatal('No se pudo leer la competencia', dbMsg(e)));

  on(db.ref('.info/serverTimeOffset'), 'value', s => { E.srvOff = s.val() || 0; });

  on(db.ref('qsec/' + code), 'value', s => { S.sec = s.val() || {}; paint(); });
  on(db.ref('qplayers/' + code), 'value', s => { S.players = s.val() || {}; paint(); });
  on(db.ref('qa/' + code), 'value', s => { S.answers = s.val() || {}; paint(); });

  /* ---- reloj en pantalla ---- */
  function paintTimer() {
    const num = document.getElementById('tnum'), fill = document.getElementById('tfill');
    if (!num || !fill) return;
    const ms = E.remaining();
    const s = Math.ceil(ms / 1000);
    num.textContent = s;
    const pct = Math.max(0, Math.min(100, ms / (S.qSecs * 1000) * 100));
    fill.style.width = pct + '%';
    num.classList.toggle('warn', s <= 5);
    fill.classList.toggle('warn', s <= 5);
  }

  /* ---- pintar ---- */
  function paint() {
    if (!S.quiz) return;
    // Si el panel ya no está en pantalla, un dato tardío no rompe nada.
    if (!document.querySelector('.host')) return;
    const q = S.quiz;
    const list = itemsSorted(q);

    const tb = document.querySelector('.topbar');
    if (!tb.dataset.ready) {
      tb.dataset.ready = '1';
      tb.innerHTML = `<a class="brand" href="#"><span class="dots"><i></i><i></i><i></i></span>${esc(NAME)}</a>
        <span class="badge">Modo competitivo</span>
        <input class="topbar-title" id="ttl" value="${esc(q.title)}" maxlength="80" aria-label="Nombre de la competencia">
        <span class="spacer"></span>
        <button class="btn btn-sm" id="bPres">Presentar</button>
        <button class="btn btn-sm" id="bExp">Descargar resultados</button>`;
      const t = document.getElementById('ttl');
      t.onchange = () => {
        const v = t.value.trim() || 'Competencia sin título';
        qref.child('title').set(v);
        db.ref('qmine/' + uid + '/' + code + '/title').set(v).catch(() => {});
      };
      document.getElementById('bPres').onclick = () => document.body.classList.add('present');
      document.getElementById('bExp').onclick = exportCsv;
    }

    paintRail(list);
    paintStage(list);
    paintEditor(list);
  }

  function paintRail(list) {
    const rail = document.querySelector('.rail');
    const url = baseUrl() + '#/' + code;
    const remoteUrl = baseUrl() + '#/comp/remoto/' + code;
    const nP = Object.keys(S.players).length;
    const q = S.quiz;

    /* Lo único que obliga a rehacer la barra es la estructura: qué preguntas
       hay, cuál está activa y cuáles ya tienen marcada la correcta. El texto
       y los segundos se actualizan en el lugar, porque ahora el editor guarda
       mientras escribís y rehacer la barra en cada tecla redibujaría el QR. */
    const struct = q.state + '|' + (q.i || 0) + '|' +
      list.map(([id]) => id + (typeof S.sec[id] === 'number' ? '!' : '?')).join('#');
    if (rail.dataset.struct === struct) {
      const c = document.getElementById('cnt');
      if (c) c.innerHTML = `<b>${nP}</b><span>${nP === 1 ? 'persona conectada' : 'personas conectadas'}</span>`;
      list.forEach(([id, it]) => {
        const b = rail.querySelector('[data-go="' + id + '"]');
        if (!b) return;
        const t = b.querySelector('.slide-q');
        const txt = it.question || 'Sin pregunta';
        if (t && t.textContent !== txt) t.textContent = txt;
        const sec = b.querySelector('.badge.poll');
        const secTxt = (it.secs || q.secs || DEF_SECS) + 's';
        if (sec && sec.textContent !== secTxt) sec.textContent = secTxt;
      });
      return;
    }
    rail.dataset.struct = struct;

    rail.innerHTML = `
      <section>
        <div class="invite">
          <p class="eyebrow">Entrá y jugá</p>
          <div class="code-slab">${esc(code)}</div>
          <div class="qr-frame"><div id="qr"></div></div>
          <div class="invite-url">${esc(url)}</div>
          <div class="btn-row" style="justify-content:center">
            <button class="btn btn-sm" id="cpy">Copiar link</button>
            <button class="btn btn-sm" id="dqr">Descargar QR</button>
          </div>
          <div class="counter" id="cnt"><b>${nP}</b><span>${nP === 1 ? 'persona conectada' : 'personas conectadas'}</span></div>
        </div>
      </section>
      <section>
        <h3>Preguntas</h3>
        <div class="slides">
          ${list.map(([id, it], i) => `
            <button class="slide ${i === (q.i || 0) ? 'on' : ''}" data-go="${id}">
              <div class="slide-top">
                <span class="slide-n">${i + 1}</span>
                <span class="badge poll">${it.secs || q.secs || DEF_SECS}s</span>
                ${typeof S.sec[id] === 'number' ? '' : '<span class="badge warn">sin correcta</span>'}
                ${i === (q.i || 0) && q.state === 'q' ? '<span class="live-dot"></span>' : ''}
              </div>
              <div class="slide-q">${esc(it.question || 'Sin pregunta')}</div>
            </button>`).join('')}
        </div>
        <div class="btn-row">
          <button class="btn btn-sm" id="add">+ Pregunta</button>
          <button class="btn btn-sm" id="tplBtn">Cargar plantilla</button>
        </div>
      </section>
      <section>
        <h3>Control desde el celular</h3>
        <p class="muted" style="font-size:12.5px;margin:-4px 0 9px">Escaneá esto con tu teléfono para pasar las preguntas sin volver a la computadora.</p>
        <button class="btn btn-sm" id="remoteBtn">Mostrar el QR de control</button>
        <div id="remoteBox" style="display:none;margin-top:10px;text-align:center">
          <div class="qr-frame" style="border-color:var(--accent)"><div id="qr2"></div></div>
          <p class="muted" style="font-family:var(--mono);font-size:11px;word-break:break-all;margin:8px 0 6px">${esc(remoteUrl)}</p>
          <button class="btn btn-sm" id="cpy2">Copiar link de control</button>
        </div>
      </section>
      <section>
        <h3>Reglas del juego</h3>
        <div class="field">
          <label for="gsec">Segundos por pregunta (por defecto)</label>
          <input class="input" id="gsec" type="number" min="5" max="120" value="${q.secs || DEF_SECS}">
        </div>
        <div class="field">
          <label for="gbase">Puntos por acierto</label>
          <input class="input" id="gbase" type="number" min="100" max="5000" step="100" value="${q.base || DEF_BASE}">
        </div>
        <p class="muted" style="font-size:12.5px;margin:0">Contestar sobre el final conserva la mitad de esos puntos;
        contestar al instante, todos. Errar o no llegar, cero.</p>
      </section>
      <section>
        <h3>Volver a empezar</h3>
        <button class="btn btn-sm" id="rst">Borrar jugadores y puntajes</button>
        <p class="muted" style="font-size:12.5px;margin:6px 0 0">Las preguntas y el código quedan igual.</p>
      </section>
      <section>
        <button class="btn btn-sm btn-danger" id="del">Eliminar la competencia</button>
      </section>`;

    const qbox = document.getElementById('qr');
    qbox.innerHTML = '';
    try {
      new QRCode(qbox, { text: url, width: 168, height: 168, colorDark: '#0B1A2A', colorLight: '#ffffff',
                         correctLevel: QRCode.CorrectLevel.M });
    } catch (e) { qbox.textContent = 'QR no disponible'; }

    document.getElementById('cpy').onclick = () => copy(url);
    document.getElementById('dqr').onclick = () => {
      const cv = qbox.querySelector('canvas');
      if (!cv) return toast('El QR todavía no está listo');
      const a = document.createElement('a');
      a.href = cv.toDataURL('image/png'); a.download = 'qr-' + code + '.png'; a.click();
    };
    // QR del control remoto, a pedido
    const rb = document.getElementById('remoteBtn');
    rb.onclick = () => {
      const box = document.getElementById('remoteBox');
      const open = box.style.display !== 'none';
      box.style.display = open ? 'none' : 'block';
      rb.textContent = open ? 'Mostrar el QR de control' : 'Ocultar el QR de control';
      if (!open && !box.dataset.done) {
        box.dataset.done = '1';
        try {
          new QRCode(document.getElementById('qr2'), { text: remoteUrl, width: 148, height: 148,
            colorDark: '#0B1A2A', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
        } catch (e) {}
        document.getElementById('cpy2').onclick = () => copy(remoteUrl);
      }
    };

    rail.querySelectorAll('[data-go]').forEach(b => {
      b.onclick = () => {
        if (S.quiz.state === 'q') return toast('Cerrá la pregunta abierta antes de moverte');
        const idx = list.findIndex(([id]) => id === b.dataset.go);
        qref.child('i').set(idx < 0 ? 0 : idx);
      };
    });
    document.getElementById('add').onclick = () => {
      const order = list.length ? (list[list.length - 1][1].order || list.length) + 1 : 1;
      const qid = 'k' + Date.now().toString(36);
      const up = {};
      up['items/' + qid] = newQuestion(order);
      up['i'] = list.length;
      qref.update(up).then(() => db.ref('qsec/' + code + '/' + qid).set(0));
    };
    /* Cargar una tanda de preguntas escrita afuera. La respuesta correcta
       viaja aparte, al nodo que solo lee el anfitrión, igual que cuando se
       carga a mano. Todo se agrega al final; no se borra nada. */
    document.getElementById('tplBtn').onclick = () => {
      if (!window.TPL) return toast('No se cargó app.js');
      if (S.quiz.state !== 'lobby') return toast('Volvé a la sala de espera para cargar preguntas');
      window.TPL.open({
        mode: 'comp',
        defaultSecs: S.quiz.secs || DEF_SECS,
        onImport: blocks => {
          const prev = itemsSorted(S.quiz);
          let order = prev.length ? (prev[prev.length - 1][1].order || prev.length) : 0;
          const up = {}, sec = {};
          blocks.forEach((b, i) => {
            const qid = 'k' + (Date.now() + i).toString(36);
            up['items/' + qid] = {
              order: ++order,
              question: b.question,
              options: b.options.slice(0, 6),
              secs: b.secs || S.quiz.secs || DEF_SECS
            };
            sec[qid] = b.correct;
          });
          return qref.update(up).then(() => db.ref('qsec/' + code).update(sec));
        }
      });
    };

    const gs = document.getElementById('gsec');
    gs.onchange = () => qref.child('secs').set(Math.max(5, Math.min(120, parseInt(gs.value, 10) || DEF_SECS)));
    const gb = document.getElementById('gbase');
    gb.onchange = () => qref.child('base').set(Math.max(100, Math.min(5000, parseInt(gb.value, 10) || DEF_BASE)));
    document.getElementById('rst').onclick = () => {
      if (!confirm('Se borran los jugadores y todos los puntajes. Las preguntas quedan como están.')) return;
      E.backToLobby(true);
    };
    document.getElementById('del').onclick = () => {
      if (!confirm('Se elimina la competencia completa. Esta acción no se puede deshacer.')) return;
      deleteQuiz(code).then(() => { location.hash = '#/comp'; });
    };
  }

  /* ---- escenario: es lo que se proyecta ---- */
  function paintStage(list) {
    const stage = document.querySelector('.stage');
    const q = S.quiz;
    const nP = Object.keys(S.players).length;

    if (q.state === 'lobby') {
      stage.dataset.sig = 'lobby';
      const names = Object.keys(S.players)
        .map(p => S.players[p])
        .sort((a, b) => (a.at || 0) - (b.at || 0));
      stage.innerHTML = `
        <div class="stage-head"><h2 class="stage-q">${esc(q.title)}</h2></div>
        <div class="stage-body" style="flex-direction:column;justify-content:center;gap:22px">
          <div class="center">
            <p class="eyebrow" style="color:var(--muted-dark)">Entrá desde el celular con el código</p>
            <div class="code-slab" style="font-size:clamp(40px,7vw,72px)">${esc(code)}</div>
            <div class="bignum">${nP}<small>${nP === 1 ? 'persona lista' : 'personas listas'}</small></div>
          </div>
          <div class="chips" style="justify-content:center;max-width:760px;margin:0 auto">
            ${names.slice(-40).map(p => `<span class="chip">${esc(p.n || 'Sin nombre')}</span>`).join('') ||
              '<span class="empty">Todavía no entró nadie.</span>'}
          </div>
          <div class="btn-row" style="justify-content:center">
            <button class="btn btn-lg btn-primary" id="bStart">Empezar la competencia</button>
          </div>
        </div>`;
      document.getElementById('bStart').onclick = () => E.startQuestion(0);
      return;
    }

    const idx = q.i || 0;
    const entry = list[idx];
    if (!entry) { stage.innerHTML = '<p class="empty">Agregá una pregunta.</p>'; return; }
    const [qid, it] = entry;
    const rs = S.answers[qid] || {};
    const nA = Object.keys(rs).length;
    const correct = S.sec[qid];

    if (q.state === 'q') {
      const pct = nP ? Math.round(nA / nP * 100) : 0;
      /* Mientras corre la pregunta llegan respuestas todo el tiempo: si
         rehacemos la pantalla en cada una, parpadea. Solo actualizamos el
         contador salvo que haya cambiado la pregunta. */
      const sig = 'q|' + qid + '|' + (it.options || []).length;
      if (stage.dataset.sig === sig) {
        const c = document.getElementById('nAns');
        if (c) c.innerHTML = `${nA} <small style="font-size:14px;color:var(--muted-dark)">de ${nP}</small>`;
        const pf = document.getElementById('pfill');
        if (pf) pf.style.width = pct + '%';
        return;
      }
      stage.dataset.sig = sig;
      stage.innerHTML = `
        <div class="stage-head">
          <h2 class="stage-q">${esc(it.question)}</h2>
          <div class="stage-meta">Pregunta ${idx + 1} de ${list.length}<br>${esc(code)}</div>
        </div>
        <div class="timer-row">
          <span class="lbl">Tiempo</span>
          <span class="timer-num" id="tnum">${it.secs || q.secs || DEF_SECS}</span>
        </div>
        <div class="timer"><div class="timer-fill" id="tfill" style="width:100%"></div></div>
        <div class="stage-body" style="flex-direction:column;gap:18px;justify-content:flex-start">
          <div class="tiles">
            ${(it.options || []).map((o, i) =>
              `<div class="tile t${i}"><span class="k">${'ABCDEF'[i]}</span><span>${esc(o)}</span></div>`).join('')}
          </div>
          <div style="width:100%">
            <div class="timer-row"><span class="lbl">Respondieron</span>
              <span class="timer-num" id="nAns" style="font-size:26px;color:#fff">${nA} <small style="font-size:14px;color:var(--muted-dark)">de ${nP}</small></span></div>
            <div class="progress"><i id="pfill" style="width:${pct}%"></i></div>
          </div>
        </div>
        <div class="btn-row stage-tools" style="margin-top:18px">
          <button class="btn btn-primary" id="bClose">Cerrar la pregunta ahora</button>
          <button class="btn" id="bEnd">Terminar y mostrar el ranking</button>
        </div>`;
      paintTimer();
      document.getElementById('bClose').onclick = E.closeQuestion;
      document.getElementById('bEnd').onclick = () => { if (confirm('¿Terminar la competencia y mostrar el ranking?')) E.endGame(); };
      return;
    }

    if (q.state === 'rev') {
      stage.dataset.sig = 'rev|' + qid;
      const counts = (it.options || []).map(() => 0);
      Object.keys(rs).forEach(p => { const c = rs[p].c; if (counts[c] !== undefined) counts[c]++; });
      const rank = E.computeRank();
      const last = idx + 1 >= list.length;
      stage.innerHTML = `
        <div class="stage-head">
          <h2 class="stage-q">${esc(it.question)}</h2>
          <div class="stage-meta">Pregunta ${idx + 1} de ${list.length}<br>${nA} de ${nP} respondieron</div>
        </div>
        <div class="stage-body" style="flex-direction:column;gap:22px;justify-content:flex-start">
          <div class="tiles">
            ${(it.options || []).map((o, i) =>
              `<div class="tile t${i} ${i === correct ? 'right' : 'dim'}">
                 <span class="k">${'ABCDEF'[i]}</span><span>${esc(o)}</span><span class="cnt">${counts[i]}</span></div>`).join('')}
          </div>
          <div style="width:100%">
            <p class="eyebrow" style="color:var(--muted-dark);margin:0 0 10px">Posiciones</p>
            ${rankTable(rank.slice(0, 8), null)}
          </div>
        </div>
        <div class="btn-row stage-tools" style="margin-top:18px">
          <button class="btn btn-primary" id="bNext">${last ? 'Mostrar el ranking final' : 'Siguiente pregunta'}</button>
          ${last ? '' : '<button class="btn" id="bEnd">Terminar acá</button>'}
        </div>`;
      document.getElementById('bNext').onclick = () => last ? E.endGame() : E.startQuestion(idx + 1);
      const be = document.getElementById('bEnd');
      if (be) be.onclick = () => { if (confirm('¿Terminar la competencia y mostrar el ranking?')) E.endGame(); };
      return;
    }

    // final
    stage.dataset.sig = 'end';
    const rank = E.computeRank();
    stage.innerHTML = `
      <div class="stage-head"><h2 class="stage-q">Ranking final</h2>
        <div class="stage-meta">${esc(q.title)}<br>${rank.length} ${rank.length === 1 ? 'jugador' : 'jugadores'}</div></div>
      <div class="stage-body" style="flex-direction:column;gap:10px;justify-content:flex-start">
        ${podium(rank)}
        <div style="width:100%">${rankTable(rank.slice(0, 12), null)}</div>
      </div>
      <div class="btn-row stage-tools" style="margin-top:18px">
        <button class="btn" id="bAgain">Volver a la sala de espera</button>
        <button class="btn" id="bWipe">Borrar puntajes y empezar de cero</button>
      </div>`;
    document.getElementById('bAgain').onclick = () => E.backToLobby(false);
    document.getElementById('bWipe').onclick = () => {
      if (!confirm('Se borran los jugadores y todos los puntajes.')) return;
      E.backToLobby(true);
    };
  }

  /* ---- editor de la pregunta seleccionada ---- */
  /* Se guarda solo. Mientras escribís, lo que vuelve de la base es casi
     siempre lo que vos mismo acabás de guardar: rehacer el editor con eso
     te movería el cursor a la mitad de una palabra. Por eso, mientras hay
     alguien escribiendo, el editor no se toca. */
  function editing() {
    const ed = document.querySelector('.editor');
    return !!(ed && (ed.contains(document.activeElement) || Date.now() - (S.edTouch || 0) < 2500));
  }

  function paintEditor(list) {
    const wrap = document.querySelector('.stage-wrap');
    let ed = wrap.querySelector('.editor');
    const q = S.quiz;

    if (q.state !== 'lobby') { if (ed) { ed.remove(); } return; }
    if (!ed) { wrap.insertAdjacentHTML('beforeend', '<div class="editor"></div>'); ed = wrap.querySelector('.editor'); }

    const entry = list[q.i || 0];
    if (!entry) { ed.innerHTML = ''; ed.dataset.sig = ''; ed.dataset.qid = ''; return; }
    const [qid, it] = entry;

    const sig = qid + '|' + JSON.stringify(it) + '|' + S.sec[qid];
    if (ed.dataset.sig === sig) return;
    if (ed.dataset.qid === qid && editing()) { ed.dataset.sig = sig; return; }
    clearTimeout(S.edTimer);
    ed.dataset.sig = sig;
    ed.dataset.qid = qid;

    ed.innerHTML = `
      <div class="editor-head">
        <span class="badge poll">Pregunta ${(q.i || 0) + 1}</span>
        <h3>Editar</h3>
        <button class="btn btn-sm btn-danger" id="eDel">Eliminar</button>
      </div>
      <div class="field">
        <label for="eQ">Pregunta</label>
        <input class="input" id="eQ" value="${esc(it.question || '')}" maxlength="180">
      </div>
      <div class="field">
        <label>Opciones — marcá la correcta</label>
        <div id="eOpts">${(it.options || []).map((o, i) => optRow(o, i, S.sec[qid] === i)).join('')}</div>
        <button class="btn btn-sm" id="eAdd" style="margin-top:4px">+ Agregar opción</button>
      </div>
      <div class="two-col">
        <div class="field">
          <label for="eSecs">Segundos para esta pregunta</label>
          <input class="input" id="eSecs" type="number" min="5" max="120" value="${it.secs || q.secs || DEF_SECS}">
        </div>
      </div>
      <p class="muted" id="eState" style="font-size:12.5px;margin:10px 0 0">Se guarda solo mientras escribís.</p>`;

    const box = document.getElementById('eOpts');
    const say = txt => { const el = document.getElementById('eState'); if (el) el.textContent = txt; };

    const wire = () => {
      box.querySelectorAll('[data-rm]').forEach(b => {
        b.onclick = () => {
          if (box.children.length <= 2) return toast('Tiene que haber al menos dos opciones');
          b.parentElement.remove();
          renumber();
          save(true);
        };
      });
      box.querySelectorAll('.pick').forEach(b => {
        b.onclick = () => {
          box.querySelectorAll('.pick').forEach(x => { x.classList.remove('on'); x.textContent = 'Marcar'; });
          b.classList.add('on'); b.textContent = 'Correcta';
          save(true);
        };
      });
    };
    const renumber = () => {
      Array.from(box.children).forEach((row, i) => {
        row.querySelector('.input').placeholder = 'Opción ' + (i + 1);
      });
    };
    wire();

    document.getElementById('eAdd').onclick = () => {
      if (box.children.length >= 6) return toast('Máximo seis opciones');
      box.insertAdjacentHTML('beforeend', optRow('', box.children.length, false));
      wire();
      S.edTouch = Date.now();
      box.lastElementChild.querySelector('.input').focus();
    };

    /* Las opciones vacías no se guardan, pero tampoco se borran de la
       pantalla mientras las estás escribiendo: el índice de la correcta se
       corre para seguir apuntando a la misma opción. */
    function collect() {
      const rows = Array.from(box.children);
      const raw = rows.map(r => r.querySelector('.input').value.trim());
      const marked = rows.findIndex(r => r.querySelector('.pick').classList.contains('on'));
      const clean = [];
      let shift = marked;
      raw.forEach((o, i) => { if (o) clean.push(o); else if (i < marked) shift--; });
      return { options: clean, correct: shift, hasCorrect: marked >= 0 && !!raw[marked] };
    }

    function run() {
      if (!ed.isConnected || ed.dataset.qid !== qid) return;   // cambiaste de pregunta
      const c = collect();
      const up = {
        question: (document.getElementById('eQ').value || '').trim() || 'Sin pregunta',
        secs: Math.max(5, Math.min(120, parseInt(document.getElementById('eSecs').value, 10) || DEF_SECS))
      };
      if (c.options.length >= 2) up.options = c.options;
      qref.child('items/' + qid).update(up)
        .then(() => (c.hasCorrect ? db.ref('qsec/' + code + '/' + qid).set(c.correct) : null))
        .then(() => {
          if (c.options.length < 2) return say('Guardado · faltan opciones con texto');
          if (!c.hasCorrect) return say('Guardado · falta marcar la opción correcta');
          say('Guardado');
        })
        .catch(e => say(dbMsg(e)));
    }

    function save(now) {
      S.edTouch = Date.now();
      clearTimeout(S.edTimer);
      say('Guardando…');
      if (now) return run();
      S.edTimer = setTimeout(run, 600);
      timeouts.push(S.edTimer);
    }

    /* Propiedad y no addEventListener: el editor se repinta muchas veces y
       así nunca quedan dos escuchas encima del mismo campo. */
    ed.oninput = () => save(false);
    ed.onchange = () => save(true);
    document.getElementById('eQ').onkeydown = e => {
      if (e.key === 'Enter') { e.preventDefault(); save(true); }
    };

    document.getElementById('eDel').onclick = () => {
      if (list.length < 2) return toast('La competencia necesita al menos una pregunta');
      if (!confirm('Se elimina la pregunta y sus respuestas.')) return;
      clearTimeout(S.edTimer);
      S.edTouch = 0;
      const up = {};
      up['items/' + qid] = null;
      up['i'] = 0;
      qref.update(up)
        .then(() => Promise.all([
          db.ref('qsec/' + code + '/' + qid).remove(),
          db.ref('qa/' + code + '/' + qid).remove()
        ]));
    };
  }

  /* ---- exportar ---- */
  function exportCsv() {
    const list = itemsSorted(S.quiz);
    const rank = E.computeRank();
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const slug = (S.quiz.title || 'competencia').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 40) || 'competencia';

    const head = ['puesto', 'nombre', 'puntaje', 'aciertos', 'preguntas'];
    list.forEach((_, i) => head.push('p' + (i + 1)));
    const rows = [head];
    rank.forEach((r, i) => {
      const row = [i + 1, r.n, r.s, r.ok, list.length];
      list.forEach(([qid, it]) => {
        const a = (S.answers[qid] || {})[r.p];
        row.push(a ? ((it.options || [])[a.c] || ('opción ' + (a.c + 1))) : '');
      });
      rows.push(row);
    });

    const det = [['n_pregunta', 'pregunta', 'opcion_correcta', 'nombre', 'respondio', 'segundos', 'puntos']];
    list.forEach(([qid, it], idx) => {
      const rs = S.answers[qid] || {};
      const correct = S.sec[qid];
      Object.keys(rs).forEach(p => {
        const a = rs[p];
        det.push([idx + 1, it.question, (it.options || [])[correct] || '',
          (S.players[p] && S.players[p].n) || 'Sin nombre',
          (it.options || [])[a.c] || '', Math.round((a.ms || 0) / 100) / 10,
          scoreOf(a, correct, it.secs || S.quiz.secs, S.quiz.base || DEF_BASE)]);
      });
    });

    download(`${slug}-${stamp}-ranking.csv`, csvRows(rows), 'text/csv;charset=utf-8');
    setTimeout(() => download(`${slug}-${stamp}-detalle.csv`, csvRows(det), 'text/csv;charset=utf-8'), 350);
    toast('Se descargan dos archivos: ranking y detalle');
  }
}

const optRow = (val, i, isCorrect) => `<div class="qrow">
  <input class="input" value="${esc(val)}" maxlength="120" placeholder="Opción ${i + 1}">
  <button class="pick ${isCorrect ? 'on' : ''}" type="button">${isCorrect ? 'Correcta' : 'Marcar'}</button>
  <button class="btn btn-sm" data-rm="1" type="button" aria-label="Quitar opción">×</button></div>`;

function rankTable(rows, mePid) {
  if (!rows || !rows.length) return '<p class="empty">Todavía no hay puntajes.</p>';
  return `<table class="rank"><thead><tr><th>#</th><th>Nombre</th><th style="text-align:right">Puntos</th></tr></thead>
    <tbody>${rows.map((r, i) => `
      <tr class="${mePid && r.p === mePid ? 'me' : ''}">
        <td class="pos">${r.pos || i + 1}</td>
        <td class="nm">${esc(r.n)}</td>
        <td class="pts">${r.s}</td>
      </tr>`).join('')}</tbody></table>`;
}

function podium(rank) {
  if (!rank.length) return '<p class="empty">Nadie jugó todavía.</p>';
  const p = [rank[1], rank[0], rank[2]];
  const cls = ['p2', 'p1', 'p3'];
  const med = ['2°', '1°', '3°'];
  return `<div class="podium">${p.map((r, i) => r
    ? `<div class="pod ${cls[i]}"><div class="medal">${med[i]}</div>
         <div class="nm">${esc(r.n)}</div><div class="pts">${r.s} pts</div></div>`
    : '<div></div>').join('')}</div>`;
}

/* ---------------------------------------------------------------
   7 bis. Control desde el celular
   La misma idea que el control de las encuestas: una pantalla chica para
   el teléfono del anfitrión, con botones grandes y sin editor. La
   computadora sigue proyectando; desde acá solo se maneja el juego, así no
   hay que darse vuelta ni volver al escritorio entre pregunta y pregunta.
   --------------------------------------------------------------- */
function renderRemoteQuiz(code) {
  const S = {
    code: code, quiz: null, sec: {}, players: {}, answers: {},
    qLocalStart: 0, qSecs: DEF_SECS, autoT: null, ticker: null
  };

  APP().innerHTML = topbar('', '') + '<div class="join" id="rq"><p class="muted">Cargando…</p></div>';

  const E = quizEngine(code, S);
  const qref = E.qref;
  E.onTick = paintClock;

  on(qref, 'value', snap => {
    if (!snap.exists()) {
      window.ENC.stop();
      return renderFatal('Esa competencia no existe',
        'El código ' + code + ' no corresponde a ninguna competencia.');
    }
    const q = snap.val();
    if (q.owner !== uid) {
      window.ENC.stop();
      return renderFatal('Este control es del anfitrión',
        'El control remoto lo abre únicamente quien creó la competencia. Si te compartieron el código, entrá a jugar.',
        '<a class="btn btn-primary" href="#/' + esc(code) + '">Entrar a jugar</a>');
    }
    S.quiz = q;
    E.adopt(q);
    paint();
  }, e => renderFatal('No se pudo leer la competencia', dbMsg(e)));

  on(db.ref('.info/serverTimeOffset'), 'value', s => { E.srvOff = s.val() || 0; });
  on(db.ref('qsec/' + code), 'value', s => { S.sec = s.val() || {}; paint(); });
  on(db.ref('qplayers/' + code), 'value', s => { S.players = s.val() || {}; paint(); });
  on(db.ref('qa/' + code), 'value', s => { S.answers = s.val() || {}; paint(); });

  function paintClock() {
    const num = document.getElementById('rtnum'), fill = document.getElementById('rtfill');
    if (!num || !fill) return;
    const ms = E.remaining();
    const left = Math.ceil(ms / 1000);
    num.textContent = left;
    fill.style.width = Math.max(0, Math.min(100, ms / (S.qSecs * 1000) * 100)) + '%';
    num.classList.toggle('warn', left <= 5);
    fill.classList.toggle('warn', left <= 5);
  }

  function codeLine() {
    return '<p class="muted" style="font-size:12.5px;margin-top:18px">Código de la competencia: ' +
      '<b style="font-family:var(--mono)">' + esc(code) + '</b></p>';
  }

  /* Saltar de pregunta sirve antes de empezar y entre pregunta y pregunta;
     con una pregunta abierta no, porque movería el piso a quien está
     contestando en ese momento. */
  function jumpList(list, q, idx) {
    if (q.state === 'end') return codeLine();
    return `<h3 style="font-family:var(--display);font-size:14px;margin:22px 0 10px">Ir a una pregunta</h3>
      <div class="slides">
        ${list.map(([id, it], i) => `
          <button class="slide ${i === idx ? 'on' : ''}" data-jump="${i}">
            <div class="slide-top">
              <span class="slide-n">${i + 1}</span>
              <span class="badge poll">${it.secs || q.secs || DEF_SECS}s</span>
              ${typeof S.sec[id] === 'number' ? '' : '<span class="badge warn">sin correcta</span>'}
            </div>
            <div class="slide-q">${esc(it.question || 'Sin pregunta')}</div>
          </button>`).join('')}
      </div>` + codeLine();
  }

  /* Refresco liviano: los números que cambian solos, sin rehacer los
     botones justo cuando el anfitrión los va a apretar. */
  function live() {
    const q = S.quiz;
    if (!q) return;
    const list = itemsSorted(q);
    const idx = Math.max(0, Math.min(q.i || 0, list.length - 1));
    const qid = (list[idx] || [])[0] || '';
    const nP = Object.keys(S.players).length;
    const nA = Object.keys(S.answers[qid] || {}).length;
    const a = document.getElementById('rnA');
    if (a) a.innerHTML = nA + '<small style="font-size:14px;color:var(--muted-dark)"> de ' + nP + '</small>';
    const f = document.getElementById('rpfill');
    if (f) f.style.width = (nP ? Math.round(nA / nP * 100) : 0) + '%';
    const p = document.getElementById('rnP');
    if (p) p.innerHTML = nP + '<small>' + (nP === 1 ? 'persona lista' : 'personas listas') + '</small>';
  }

  function paint() {
    const q = S.quiz;
    if (!q) return;
    const w = document.getElementById('rq');
    if (!w) return;

    const list = itemsSorted(q);
    const idx = Math.max(0, Math.min(q.i || 0, Math.max(0, list.length - 1)));
    const entry = list[idx] || null;
    const qid = entry ? entry[0] : '';
    const it = entry ? entry[1] : null;
    const nP = Object.keys(S.players).length;
    const nA = Object.keys(S.answers[qid] || {}).length;
    const last = idx + 1 >= list.length;

    const sig = [q.state, qid, idx, list.length, q.state === 'q' ? '' : nA + '/' + nP,
                 it ? (it.question || '') + (it.options || []).join('~') : '',
                 S.sec[qid]].join('|');
    if (w.dataset.sig === sig) return live();
    w.dataset.sig = sig;

    if (q.state === 'lobby') {
      w.innerHTML = `
        <p class="eyebrow">${esc(q.title || '')} · sala de espera</p>
        <h1 class="join-q sm" style="margin-bottom:14px">${esc(it ? (it.question || 'Sin pregunta') : 'Todavía no hay preguntas')}</h1>
        <div class="stage" style="padding:20px 16px;text-align:center">
          <div class="bignum" id="rnP">${nP}<small>${nP === 1 ? 'persona lista' : 'personas listas'}</small></div>
        </div>
        <button class="btn btn-primary btn-lg" id="bGo" style="width:100%;margin-top:12px">
          ${idx === 0 ? 'Empezar la competencia' : 'Empezar en la pregunta ' + (idx + 1)}</button>
        ${jumpList(list, q, idx)}`;
      document.getElementById('bGo').onclick = () => E.startQuestion(idx);

    } else if (q.state === 'q') {
      const pct = nP ? Math.round(nA / nP * 100) : 0;
      w.innerHTML = `
        <p class="eyebrow">Pregunta ${idx + 1} de ${list.length}</p>
        <h1 class="join-q sm" style="margin-bottom:14px">${esc(it ? it.question : '')}</h1>
        <div class="stage" style="padding:20px 16px">
          <div class="timer-row"><span class="lbl">Tiempo</span>
            <span class="timer-num" id="rtnum">${Math.ceil(E.remaining() / 1000)}</span></div>
          <div class="timer"><div class="timer-fill" id="rtfill" style="width:100%"></div></div>
          <div class="timer-row" style="margin:0"><span class="lbl">Respondieron</span>
            <span class="timer-num" id="rnA" style="font-size:26px;color:#fff">${nA}<small style="font-size:14px;color:var(--muted-dark)"> de ${nP}</small></span></div>
          <div class="progress"><i id="rpfill" style="width:${pct}%"></i></div>
        </div>
        <button class="btn btn-primary btn-lg" id="bGo" style="width:100%;margin-top:12px">Cerrar la pregunta ahora</button>
        <button class="btn btn-lg" id="bEnd" style="width:100%;margin-top:8px">Terminar y mostrar el ranking</button>
        ${jumpList(list, q, idx)}`;
      document.getElementById('bGo').onclick = () => E.closeQuestion();
      document.getElementById('bEnd').onclick = () => {
        if (confirm('¿Terminar la competencia y mostrar el ranking?')) E.endGame();
      };
      paintClock();

    } else if (q.state === 'rev') {
      const rs = S.answers[qid] || {};
      const counts = ((it && it.options) || []).map(() => 0);
      Object.keys(rs).forEach(p => { const c = rs[p].c; if (counts[c] !== undefined) counts[c]++; });
      const correct = S.sec[qid];
      const rank = E.computeRank();
      w.innerHTML = `
        <p class="eyebrow">Pregunta ${idx + 1} de ${list.length} · ${nA} de ${nP} respondieron</p>
        <h1 class="join-q sm" style="margin-bottom:14px">${esc(it ? it.question : '')}</h1>
        <div class="stage" style="padding:20px 16px">
          <div class="tiles">
            ${((it && it.options) || []).map((o, i) =>
              `<div class="tile t${i} ${i === correct ? 'right' : 'dim'}">
                 <span class="k">${'ABCDEF'[i]}</span><span>${esc(o)}</span><span class="cnt">${counts[i]}</span></div>`).join('')}
          </div>
          <p class="eyebrow" style="color:var(--muted-dark);margin:20px 0 10px">Posiciones</p>
          ${rankTable(rank.slice(0, 8), null)}
        </div>
        <button class="btn btn-primary btn-lg" id="bGo" style="width:100%;margin-top:12px">
          ${last ? 'Mostrar el ranking final' : 'Siguiente pregunta'}</button>
        ${last ? '' : '<button class="btn btn-lg" id="bEnd" style="width:100%;margin-top:8px">Terminar acá</button>'}
        ${jumpList(list, q, idx)}`;
      document.getElementById('bGo').onclick = () => last ? E.endGame() : E.startQuestion(idx + 1);
      const be = document.getElementById('bEnd');
      if (be) be.onclick = () => { if (confirm('¿Terminar la competencia y mostrar el ranking?')) E.endGame(); };

    } else {
      const rank = E.computeRank();
      w.innerHTML = `
        <p class="eyebrow">${esc(q.title || '')}</p>
        <h1 class="join-q sm" style="margin-bottom:14px">Ranking final</h1>
        <div class="stage" style="padding:20px 16px">
          ${podium(rank)}
          ${rankTable(rank.slice(0, 12), null)}
        </div>
        <button class="btn btn-primary btn-lg" id="bGo" style="width:100%;margin-top:12px">Volver a la sala de espera</button>
        <button class="btn btn-lg" id="bWipe" style="width:100%;margin-top:8px">Borrar puntajes y empezar de cero</button>
        ${jumpList(list, q, idx)}`;
      document.getElementById('bGo').onclick = () => E.backToLobby(false);
      document.getElementById('bWipe').onclick = () => {
        if (!confirm('Se borran los jugadores y todos los puntajes.')) return;
        E.backToLobby(true);
      };
    }

    w.querySelectorAll('[data-jump]').forEach(b => {
      b.onclick = () => {
        if (S.quiz.state === 'q') return toast('Cerrá la pregunta abierta antes de moverte');
        qref.child('i').set(parseInt(b.dataset.jump, 10) || 0);
      };
    });
  }
}

/* ---------------------------------------------------------------
   8. Pantalla del jugador
   Sin cuenta: solo un nombre. Consulta un nodo diminuto cada dos segundos
   para saber en qué está el anfitrión.
   --------------------------------------------------------------- */
function renderPlay(code) {
  const pid = participantId();
  const K = {
    name: 'enc:q:' + code + ':name',
    ans: qid => 'enc:q:' + code + ':a:' + qid
  };
  const P = {
    quiz: null, live: null, item: null, rank: null,
    name: store.get(K.name) || '',
    qid: null, mine: null, sent: false, ticker: null, lastSig: ''
  };

  APP().innerHTML = topbar('', '') + `<div class="join" id="jw"><p class="muted">Cargando…</p></div>`;
  start();

  async function start() {
    let q;
    try { q = await restGet('quizzes/' + code); }
    catch (e) { return fail('No pudimos conectarnos. Revisá tu conexión y volvé a intentar.'); }
    if (!q) return fail('No encontramos ninguna competencia con el código ' + code + '. Revisalo con quien está presentando.');
    P.quiz = q;
    P.live = q.live || { st: 'lobby' };
    if (!P.name) return paintName();
    /* Volvemos a anotarnos: si el anfitrión reinició la competencia, el
       nombre sigue guardado en este celular pero ya no está en la lista. */
    restPut('qplayers/' + code + '/' + pid, { n: P.name, at: { '.sv': 'timestamp' } }).catch(() => {});
    paintFromLive(true);
    poll();
  }

  function fail(msg) {
    document.getElementById('jw').innerHTML =
      `<div class="notice bad">${esc(msg)}</div><a class="btn" href="#">Volver al inicio</a>`;
  }

  /* ---- nombre ---- */
  function paintName() {
    document.getElementById('jw').innerHTML = `
      <p class="eyebrow">${esc(P.quiz.title || '')}</p>
      <h1 class="join-q">¿Con qué nombre jugás?</h1>
      <p class="muted" style="margin:-10px 0 18px">Lo van a ver todos en el ranking. No pedimos mail ni ningún otro dato.</p>
      <div class="field">
        <input class="input" id="nm" maxlength="24" placeholder="Tu nombre" style="font-size:19px;padding:15px"
               autocomplete="off" autocapitalize="words">
      </div>
      <div id="ferr"></div>
      <button class="btn btn-primary btn-lg" id="ok" style="width:100%">Entrar a la competencia</button>`;
    const inp = document.getElementById('nm');
    inp.focus();
    const go = async () => {
      const v = (inp.value || '').replace(/\s+/g, ' ').trim();
      const err = document.getElementById('ferr');
      err.innerHTML = '';
      if (v.length < 2) { err.innerHTML = '<div class="notice bad">Escribí un nombre de al menos dos letras.</div>'; return; }
      if (nameLooksBad(v)) { err.innerHTML = '<div class="notice bad">Ese nombre no se puede usar. Probá con otro.</div>'; return; }
      const b = document.getElementById('ok');
      b.disabled = true; b.textContent = 'Entrando…';
      try {
        await restPut('qplayers/' + code + '/' + pid, { n: v, at: { '.sv': 'timestamp' } });
      } catch (e) {
        b.disabled = false; b.textContent = 'Entrar a la competencia';
        err.innerHTML = '<div class="notice bad">No pudimos anotarte. Probá de nuevo en unos segundos.</div>';
        return;
      }
      P.name = v; store.set(K.name, v);
      paintFromLive(true);
      poll();
    };
    document.getElementById('ok').onclick = go;
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  }

  /* ---- seguimiento ---- */
  function poll() {
    timers.push(setInterval(async () => {
      try {
        const live = await restGet('quizzes/' + code + '/live');
        if (!live) return;
        const before = P.live || {};
        P.live = live;
        if (live.st !== before.st || live.qid !== before.qid) paintFromLive(true);
        else if (live.st === 'rev' || live.st === 'end') maybeRefreshRank();
      } catch (e) { /* un pedido perdido no rompe nada */ }
    }, 2000 + Math.floor(Math.random() * 900)));
  }

  async function paintFromLive(fetchExtra) {
    const st = (P.live && P.live.st) || 'lobby';
    if (st === 'q') {
      if (fetchExtra && P.live.qid && (!P.item || P.qid !== P.live.qid)) {
        try { P.item = await restGet('quizzes/' + code + '/items/' + P.live.qid); } catch (e) { P.item = null; }
      }
      P.qid = P.live.qid;
      const saved = store.get(K.ans(P.qid));
      P.mine = saved ? JSON.parse(saved) : null;
      P.sent = !!P.mine;
      return paintQuestion();
    }
    if (st === 'rev' || st === 'end') {
      if (fetchExtra) await refreshRank();
      return st === 'end' ? paintEnd() : paintReveal();
    }
    return paintLobby();
  }

  async function refreshRank() {
    try { P.rank = await restGet('qrank/' + code); } catch (e) { /* seguimos con lo que había */ }
  }
  let rankAt = 0;
  async function maybeRefreshRank() {
    const now = Date.now();
    if (now - rankAt < 3500) return;
    rankAt = now;
    const before = P.rank && P.rank.at;
    await refreshRank();
    if (P.rank && P.rank.at !== before) {
      (P.live.st === 'end') ? paintEnd() : paintReveal();
    }
  }

  /* ---- pantallas ---- */
  function paintLobby() {
    stopTicker();
    document.getElementById('jw').innerHTML = `
      <p class="eyebrow">${esc(P.quiz.title || '')}</p>
      <h1 class="join-q">Listo, ${esc(P.name)}</h1>
      <div class="notice good center"><div class="done-mark">✓</div>
        Estás anotado. Esperá a que arranque la competencia: la primera pregunta va a aparecer sola en esta pantalla.</div>
      <p class="muted center">No cierres esta pantalla.</p>`;
  }

  function paintQuestion() {
    const it = P.item;
    const w = document.getElementById('jw');
    if (!it) { w.innerHTML = '<p class="muted">Preparando la pregunta…</p>'; return; }

    if (P.sent) {
      stopTicker();
      w.innerHTML = `
        <p class="eyebrow">Pregunta ${(P.live.i || 0) + 1} de ${P.live.n || '?'}</p>
        <h1 class="join-q">${esc(it.question)}</h1>
        <div class="notice good center"><div class="done-mark">✓</div>
          Respuesta enviada: <b>${esc((it.options || [])[P.mine.c] || '')}</b><br>
          Esperá a que se cierre la pregunta.</div>`;
      return;
    }

    w.innerHTML = `
      <p class="eyebrow">Pregunta ${(P.live.i || 0) + 1} de ${P.live.n || '?'}</p>
      <h1 class="join-q">${esc(it.question)}</h1>
      <div class="timer-row"><span class="lbl" style="color:var(--muted)">Te queda</span>
        <span class="timer-num" id="tnum" style="color:var(--accent)">–</span></div>
      <div class="timer" style="background:var(--line)"><div class="timer-fill" id="tfill" style="width:100%"></div></div>
      <div class="tiles" style="margin-top:18px">
        ${(it.options || []).map((o, i) =>
          `<button class="tile t${i}" data-i="${i}"><span class="k">${'ABCDEF'[i]}</span><span>${esc(o)}</span></button>`).join('')}
      </div>
      <div id="ferr" style="margin-top:14px"></div>`;

    document.querySelectorAll('.tile[data-i]').forEach(b => { b.onclick = () => send(parseInt(b.dataset.i, 10)); });
    startTicker();
  }

  function elapsedMs() {
    const at = (P.live && P.live.at) || 0;
    if (!at) return 0;
    return Math.max(0, serverNow() - at);
  }
  function remainingMs() {
    const secs = (P.live && P.live.secs) || DEF_SECS;
    return Math.max(0, secs * 1000 - elapsedMs());
  }
  function startTicker() {
    stopTicker();
    const secs = (P.live && P.live.secs) || DEF_SECS;
    P.ticker = setInterval(() => {
      const num = document.getElementById('tnum'), fill = document.getElementById('tfill');
      if (!num || !fill) return stopTicker();
      const ms = remainingMs();
      const s = Math.ceil(ms / 1000);
      num.textContent = s;
      fill.style.width = Math.max(0, Math.min(100, ms / (secs * 1000) * 100)) + '%';
      num.classList.toggle('warn', s <= 5);
      fill.classList.toggle('warn', s <= 5);
      if (ms <= 0) {
        stopTicker();
        document.querySelectorAll('.tile[data-i]').forEach(b => { b.disabled = true; b.classList.add('dim'); });
        const err = document.getElementById('ferr');
        if (err && !P.sent) err.innerHTML = '<div class="notice warn">Se terminó el tiempo de esta pregunta.</div>';
      }
    }, 200);
    timers.push(P.ticker);
  }
  function stopTicker() { if (P.ticker) { clearInterval(P.ticker); P.ticker = null; } }

  async function send(choice) {
    if (P.sent) return;
    const ms = elapsedMs();
    const secs = (P.live && P.live.secs) || DEF_SECS;
    if (ms > secs * 1000) {
      const err = document.getElementById('ferr');
      if (err) err.innerHTML = '<div class="notice warn">Se terminó el tiempo de esta pregunta.</div>';
      return;
    }
    P.sent = true;
    P.mine = { c: choice, ms: ms };
    document.querySelectorAll('.tile[data-i]').forEach(b => {
      b.disabled = true;
      if (parseInt(b.dataset.i, 10) !== choice) b.classList.add('dim'); else b.classList.add('picked');
    });
    try {
      await restPut('qa/' + code + '/' + P.qid + '/' + pid, { c: choice, ms: ms, ts: { '.sv': 'timestamp' } });
      store.set(K.ans(P.qid), JSON.stringify(P.mine));
      stopTicker();
      paintQuestion();
    } catch (e) {
      P.sent = false; P.mine = null;
      const err = document.getElementById('ferr');
      if (err) err.innerHTML = '<div class="notice bad">No se pudo enviar (puede que ya se haya cerrado la pregunta).</div>';
    }
  }

  function myRow() {
    const sc = (P.rank && P.rank.sc) || {};
    const mine = sc[pid];
    return mine ? { pos: mine[0], s: mine[1] } : null;
  }

  function paintReveal() {
    stopTicker();
    const w = document.getElementById('jw');
    const last = P.rank && P.rank.last;
    const me = myRow();
    if (!last) {
      w.innerHTML = `<h1 class="join-q">Pregunta cerrada</h1>
        <p class="muted">Esperando los resultados…</p>`;
      return;
    }
    const saved = store.get(K.ans(last.qid));
    const mine = saved ? JSON.parse(saved) : null;
    const acerto = mine && mine.c === last.correct;
    const gain = acerto
      ? Math.round((last.base || DEF_BASE) * (1 - 0.5 * (Math.min(mine.ms, (last.secs||DEF_SECS) * 1000) / ((last.secs||DEF_SECS) * 1000))))
      : 0;

    w.innerHTML = `
      <p class="eyebrow">Pregunta ${last.i}</p>
      <h1 class="join-q">${esc(last.q)}</h1>
      <div class="verdict ${acerto ? 'ok' : 'no'}">
        <h2>${acerto ? '¡Correcto!' : (mine ? 'Esta vez no' : 'No llegaste a responder')}</h2>
        <div class="sub">La respuesta era <b>${esc(last.opts[last.correct] || '')}</b></div>
        ${acerto ? `<div class="gain">+${gain} puntos</div>` : ''}
      </div>
      ${me ? `<div class="notice center">Vas <b>${me.pos}°</b> con <b>${me.s}</b> puntos</div>` : ''}
      <div class="stage" style="margin-top:6px">
        <p class="eyebrow" style="color:var(--muted-dark);margin:0 0 14px">Posiciones</p>
        ${rankTable((P.rank.top || []).slice(0, 10), pid)}
      </div>
      <p class="muted center" style="margin-top:16px">La próxima pregunta aparece sola.</p>`;
  }

  function paintEnd() {
    stopTicker();
    const w = document.getElementById('jw');
    const top = (P.rank && P.rank.top) || [];
    const me = myRow();
    w.innerHTML = `
      <p class="eyebrow">${esc(P.quiz.title || '')}</p>
      <h1 class="join-q">Ranking final</h1>
      ${me ? `<div class="verdict ${me.pos <= 3 ? 'ok' : 'no'}">
        <h2>${me.pos}° puesto</h2><div class="sub">${esc(P.name)}</div><div class="gain">${me.s} puntos</div></div>` : ''}
      <div class="stage">
        ${podium(top)}
        ${rankTable(top.slice(0, 15), pid)}
      </div>
      <p class="muted center" style="margin-top:16px">Gracias por jugar.</p>`;
  }
}

/* ---------------------------------------------------------------
   9. Lo que ve app.js
   El módulo no arranca solo: app.js lo llama cuando la dirección empieza
   con #/comp, o cuando alguien entra con un código que resultó ser el de
   una competencia y no el de una encuesta.
   --------------------------------------------------------------- */
window.QUIZ = {
  home: function () { sync(); renderHome(); },
  host: function (code) { sync(); renderHostQuiz(code); },
  remote: function (code) { sync(); renderRemoteQuiz(code); },
  play: function (code) { sync(); renderPlay(code); }
};

})();
