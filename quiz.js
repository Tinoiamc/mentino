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
  if (u && !u.isAnonymous) {
    el.innerHTML = `<span class="muted" style="font-size:13px">${esc(u.displayName || u.email || '')}</span>`;
  } else {
    el.innerHTML = `<button class="btn btn-sm" id="gg">Entrar con Google</button>`;
    document.getElementById('gg').onclick = () =>
      signInGoogle().then(() => { paintAcct(); loadMine(); toast('Listo: abrís tus paneles desde cualquier dispositivo'); })
                    .catch(() => toast('No se pudo entrar con Google'));
  }
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
   7. Panel del anfitrión (backoffice)
   --------------------------------------------------------------- */
function renderHostQuiz(code) {
  const S = {
    code, quiz: null, sec: {}, players: {}, answers: {},
    qLocalStart: 0, qSecs: DEF_SECS, autoT: null, ticker: null
  };

  APP().innerHTML = topbar('', '') + `<div class="host"><div class="rail"></div>
    <div class="stage-wrap"><div class="stage"><p class="empty">Cargando…</p></div></div></div>
    <button class="btn exit-present" id="exitPres">Salir de presentación</button>`;
  document.getElementById('exitPres').onclick = () => document.body.classList.remove('present');

  const qref = db.ref('quizzes/' + code);
  let srvOff = 0;   // diferencia entre el reloj de esta máquina y el del servidor

  /* Atajos: flecha derecha avanza (empezar / siguiente), Escape sale de
     presentación, barra espaciadora cierra la pregunta abierta. */
  window.ENC.navKeys(function (e) {
    const t = e.target;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (!S.quiz) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); advance(); }
    else if ((e.key === ' ' || e.key === 'Spacebar') && S.quiz.state === 'q') { e.preventDefault(); closeQuestion(); }
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
    /* Alineamos el reloj con el del servidor, que es el que usan los
       celulares. Así el conteo coincide y, si recargás el panel a mitad de
       una pregunta, el tiempo sigue donde estaba en vez de arrancar de cero. */
    if (q.state === 'q' && q.live && q.live.at) {
      S.qSecs = q.live.secs || q.secs || DEF_SECS;
      S.qLocalStart = q.live.at - srvOff;
      const left = S.qSecs * 1000 - (Date.now() - S.qLocalStart);
      clearTimeout(S.autoT);
      S.autoT = setTimeout(() => closeQuestion(), Math.max(300, left + 1200));
      timeouts.push(S.autoT);
      startTicker();
    }
    paint();
  }, e => renderFatal('No se pudo leer la competencia', dbMsg(e)));

  on(db.ref('.info/serverTimeOffset'), 'value', s => { srvOff = s.val() || 0; });

  on(db.ref('qsec/' + code), 'value', s => { S.sec = s.val() || {}; paint(); });
  on(db.ref('qplayers/' + code), 'value', s => { S.players = s.val() || {}; paint(); });
  on(db.ref('qa/' + code), 'value', s => { S.answers = s.val() || {}; paint(); });

  /* ---- reloj propio del anfitrión ---- */
  function startTicker() {
    stopTicker();
    S.ticker = setInterval(paintTimer, 200);
    timers.push(S.ticker);
  }
  function stopTicker() { if (S.ticker) { clearInterval(S.ticker); S.ticker = null; } }
  function remaining() {
    if (!S.qLocalStart) return 0;
    return Math.max(0, S.qSecs * 1000 - (Date.now() - S.qLocalStart));
  }
  function paintTimer() {
    const num = document.getElementById('tnum'), fill = document.getElementById('tfill');
    if (!num || !fill) return;
    const ms = remaining();
    const s = Math.ceil(ms / 1000);
    num.textContent = s;
    const pct = Math.max(0, Math.min(100, ms / (S.qSecs * 1000) * 100));
    fill.style.width = pct + '%';
    num.classList.toggle('warn', s <= 5);
    fill.classList.toggle('warn', s <= 5);
  }

  /* ---- máquina de estados ---- */
  function startQuestion(index) {
    const list = itemsSorted(S.quiz);
    if (!list.length) return toast('Cargá al menos una pregunta');
    const idx = Math.max(0, Math.min(index, list.length - 1));
    const [qid, it] = list[idx];
    const secs = it.secs || S.quiz.secs || DEF_SECS;
    S.qLocalStart = Date.now();
    S.qSecs = secs;
    clearTimeout(S.autoT);
    S.autoT = setTimeout(() => closeQuestion(), secs * 1000 + 1200);
    timeouts.push(S.autoT);
    startTicker();
    qref.update({
      state: 'q', i: idx,
      live: { st: 'q', qid: qid, i: idx, at: firebase.database.ServerValue.TIMESTAMP, secs: secs, n: list.length }
    }).catch(e => toast(dbMsg(e)));
  }

  function closeQuestion() {
    clearTimeout(S.autoT);
    stopTicker();
    if (!S.quiz || S.quiz.state !== 'q') return;
    const list = itemsSorted(S.quiz);
    const idx = S.quiz.i || 0;
    const entry = list[idx];
    qref.update({
      state: 'rev',
      live: { st: 'rev', qid: entry ? entry[0] : '', i: idx, at: firebase.database.ServerValue.TIMESTAMP,
              secs: S.qSecs, n: list.length }
    }).then(() => publishRank(false)).catch(e => toast(dbMsg(e)));
  }

  function advance() {
    const st = S.quiz.state;
    if (st === 'lobby') return startQuestion(0);
    if (st === 'q') return closeQuestion();
    if (st === 'rev') {
      const list = itemsSorted(S.quiz);
      const next = (S.quiz.i || 0) + 1;
      if (next < list.length) return startQuestion(next);
      return endGame();
    }
  }

  function endGame() {
    clearTimeout(S.autoT); stopTicker();
    const list = itemsSorted(S.quiz);
    qref.update({
      state: 'end',
      live: { st: 'end', qid: '', i: S.quiz.i || 0, at: firebase.database.ServerValue.TIMESTAMP,
              secs: 0, n: list.length }
    }).then(() => publishRank(true)).catch(e => toast(dbMsg(e)));
  }

  function backToLobby(wipe) {
    clearTimeout(S.autoT); stopTicker();
    const list = itemsSorted(S.quiz);
    const go = () => qref.update({
      state: 'lobby', i: 0,
      live: { st: 'lobby', qid: '', i: 0, at: 0, secs: S.quiz.secs || DEF_SECS, n: list.length }
    });
    if (!wipe) return go().catch(e => toast(dbMsg(e)));
    Promise.all([
      db.ref('qa/' + code).remove(),
      db.ref('qplayers/' + code).remove(),
      db.ref('qrank/' + code).remove()
    ]).then(go).then(() => toast('Todo en cero: podés jugar de nuevo con otro grupo'))
      .catch(e => toast(dbMsg(e)));
  }

  /* ---- tabla de posiciones ---- */
  function computeRank() {
    const list = itemsSorted(S.quiz);
    const base = S.quiz.base || DEF_BASE;
    const acc = {};
    Object.keys(S.players).forEach(p => { acc[p] = { n: S.players[p].n || 'Sin nombre', s: 0, ok: 0, ans: 0 }; });
    list.forEach(([qid, it]) => {
      const correct = S.sec[qid];
      const rs = S.answers[qid] || {};
      Object.keys(rs).forEach(p => {
        if (!acc[p]) acc[p] = { n: 'Sin nombre', s: 0, ok: 0, ans: 0 };
        const pts = scoreOf(rs[p], correct, it.secs || S.quiz.secs, base);
        acc[p].s += pts; acc[p].ans++;
        if (pts > 0) acc[p].ok++;
      });
    });
    return Object.keys(acc)
      .map(p => ({ p: p, n: acc[p].n, s: acc[p].s, ok: acc[p].ok }))
      .sort((a, b) => b.s - a.s || String(a.n).localeCompare(String(b.n)));
  }

  /* Publica la tabla ya resuelta y, si corresponde, el detalle de la última
     pregunta (cuál era la correcta y cómo se repartieron las respuestas).
     El público solo lee esto: nunca ve la respuesta correcta antes de tiempo. */
  function publishRank(done) {
    const arr = computeRank();
    const sc = {};
    arr.slice(0, 400).forEach((r, i) => { sc[r.p] = [i + 1, r.s]; });
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
      const [qid, it] = entry;
      const rs = S.answers[qid] || {};
      const counts = (it.options || []).map(() => 0);
      Object.keys(rs).forEach(p => { const c = rs[p].c; if (counts[c] !== undefined) counts[c]++; });
      payload.last = {
        qid: qid, i: (S.quiz.i || 0) + 1, q: it.question || '',
        opts: it.options || [], correct: typeof S.sec[qid] === 'number' ? S.sec[qid] : -1,
        counts: counts, secs: it.secs || S.quiz.secs || DEF_SECS, base: S.quiz.base || DEF_BASE
      };
    }
    return db.ref('qrank/' + code).set(payload).catch(e => toast(dbMsg(e)));
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
    const nP = Object.keys(S.players).length;
    const q = S.quiz;

    const sig = q.state + '|' + (q.i || 0) + '|' + list.map(([id, it]) =>
      id + (it.question || '') + (it.options || []).join('~') + (it.secs || '') + '|' + S.sec[id]).join('#');
    if (rail.dataset.sig === sig) {
      const c = document.getElementById('cnt');
      if (c) c.innerHTML = `<b>${nP}</b><span>${nP === 1 ? 'persona conectada' : 'personas conectadas'}</span>`;
      return;
    }
    rail.dataset.sig = sig;

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
    const gs = document.getElementById('gsec');
    gs.onchange = () => qref.child('secs').set(Math.max(5, Math.min(120, parseInt(gs.value, 10) || DEF_SECS)));
    const gb = document.getElementById('gbase');
    gb.onchange = () => qref.child('base').set(Math.max(100, Math.min(5000, parseInt(gb.value, 10) || DEF_BASE)));
    document.getElementById('rst').onclick = () => {
      if (!confirm('Se borran los jugadores y todos los puntajes. Las preguntas quedan como están.')) return;
      backToLobby(true);
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
      document.getElementById('bStart').onclick = () => startQuestion(0);
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
      document.getElementById('bClose').onclick = closeQuestion;
      document.getElementById('bEnd').onclick = () => { if (confirm('¿Terminar la competencia y mostrar el ranking?')) endGame(); };
      return;
    }

    if (q.state === 'rev') {
      stage.dataset.sig = 'rev|' + qid;
      const counts = (it.options || []).map(() => 0);
      Object.keys(rs).forEach(p => { const c = rs[p].c; if (counts[c] !== undefined) counts[c]++; });
      const rank = computeRank();
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
      document.getElementById('bNext').onclick = () => last ? endGame() : startQuestion(idx + 1);
      const be = document.getElementById('bEnd');
      if (be) be.onclick = () => { if (confirm('¿Terminar la competencia y mostrar el ranking?')) endGame(); };
      return;
    }

    // final
    stage.dataset.sig = 'end';
    const rank = computeRank();
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
    document.getElementById('bAgain').onclick = () => backToLobby(false);
    document.getElementById('bWipe').onclick = () => {
      if (!confirm('Se borran los jugadores y todos los puntajes.')) return;
      backToLobby(true);
    };
  }

  /* ---- editor de la pregunta seleccionada ---- */
  function paintEditor(list) {
    const wrap = document.querySelector('.stage-wrap');
    let ed = wrap.querySelector('.editor');
    const q = S.quiz;

    if (q.state !== 'lobby') { if (ed) { ed.remove(); } return; }
    if (!ed) { wrap.insertAdjacentHTML('beforeend', '<div class="editor"></div>'); ed = wrap.querySelector('.editor'); }

    const entry = list[q.i || 0];
    if (!entry) { ed.innerHTML = ''; ed.dataset.sig = ''; return; }
    const [qid, it] = entry;

    const sig = qid + '|' + JSON.stringify(it) + '|' + S.sec[qid];
    if (ed.dataset.sig === sig) return;
    ed.dataset.sig = sig;

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
      <div class="btn-row" style="margin-top:8px">
        <button class="btn btn-primary" id="eSave">Guardar cambios</button>
      </div>`;

    const box = document.getElementById('eOpts');
    const wire = () => {
      box.querySelectorAll('[data-rm]').forEach(b => {
        b.onclick = () => {
          if (box.children.length <= 2) return toast('Tiene que haber al menos dos opciones');
          b.parentElement.remove();
          renumber();
        };
      });
      box.querySelectorAll('.pick').forEach(b => {
        b.onclick = () => {
          box.querySelectorAll('.pick').forEach(x => { x.classList.remove('on'); x.textContent = 'Marcar'; });
          b.classList.add('on'); b.textContent = 'Correcta';
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
    };
    document.getElementById('eSave').onclick = () => {
      const rows = Array.from(box.children);
      const opts = rows.map(r => r.querySelector('.input').value.trim());
      if (opts.filter(Boolean).length < 2) return toast('Tiene que haber al menos dos opciones con texto');
      let correct = rows.findIndex(r => r.querySelector('.pick').classList.contains('on'));
      if (correct < 0 || !opts[correct]) return toast('Marcá cuál es la opción correcta');
      const clean = [];
      let shift = correct;
      opts.forEach((o, i) => { if (o) clean.push(o); else if (i < correct) shift--; });
      const secs = Math.max(5, Math.min(120, parseInt(document.getElementById('eSecs').value, 10) || DEF_SECS));
      qref.child('items/' + qid).update({
        question: (document.getElementById('eQ').value || '').trim() || 'Sin pregunta',
        options: clean, secs: secs
      }).then(() => db.ref('qsec/' + code + '/' + qid).set(shift))
        .then(() => toast('Cambios guardados'))
        .catch(e => toast(dbMsg(e)));
    };
    document.getElementById('eDel').onclick = () => {
      if (list.length < 2) return toast('La competencia necesita al menos una pregunta');
      if (!confirm('Se elimina la pregunta y sus respuestas.')) return;
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
    const rank = computeRank();
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
  play: function (code) { sync(); renderPlay(code); }
};

})();
