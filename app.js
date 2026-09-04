/* =====================================================================
   Sala — nubes de palabras y encuestas en vivo
   Frontend estático (GitHub Pages) + Firebase Realtime Database.
   Un solo archivo, sin build. Comentarios en español.
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

/* Acceso a la base por HTTP suelto (REST). Lo usan los celulares del público:
   no abre una conexión permanente, así que no consume el cupo de 100 conexiones
   simultáneas del plan gratuito. */
let DBU = '';
async function restGet(path) {
  const r = await fetch(DBU + '/' + path + '.json');
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
async function restPut(path, body) {
  const r = await fetch(DBU + '/' + path + '.json', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

const timers = [];
function clearTimers() { while (timers.length) clearInterval(timers.pop()); }

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
function participantId() {
  let p = store.get('sala:pid');
  if (!p || p.length < 8) { p = 'p' + randomId(19); store.set('sala:pid', p); }
  return p;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin I, O, 0, 1
function randomCode(n) {
  let out = '';
  const arr = new Uint32Array(n);
  (window.crypto || window.msCrypto).getRandomValues(arr);
  for (let i = 0; i < n; i++) out += CODE_ALPHABET[arr[i] % CODE_ALPHABET.length];
  return out;
}

function baseUrl() {
  return location.origin + location.pathname;
}

/* ---------------------------------------------------------------
   2. Filtro de groserías
   Normaliza (acentos, leet, repeticiones) y compara por palabra
   completa para evitar falsos positivos tipo "computadora".
   --------------------------------------------------------------- */
const BAD_WORDS = `
puta puto putas putos putita putito mierda mierdas pelotudo pelotuda pelotudos boludo boluda boludos
conchudo forro forra gilipollas cono concha pija verga polla joder jodete carajo culiado culiao culeado
chupapija chupamedias sorete soreto pendejo pendeja maricon marica trolo hdp hijodeputa hijadeputa
lameculos garca choto chota pajero pajera cagada cagon cagona zorra imbecil idiota estupido estupida
tarado tarada mogolico mogolica retrasado subnormal tortillera punetas cojones follar folla mamahuevo
mamaguevo pinche chingar chinga chingada culero ojete orto chupala chupame cagar cagate cagon teta tetas
culo culos verguero prostituta puton putona
fuck fucking fucker fuk fuq shit shitty bullshit bitch bitches bastard asshole arsehole cunt dick dickhead
cock pussy whore slut motherfucker wanker bollocks twat retard retarded nigga nigger faggot fag rape rapist
`.trim().split(/\s+/);

const BAD_PHRASES = [
  'hijo de puta','hija de puta','la concha de tu madre','la puta que te pario','andate a la mierda',
  'vete a la mierda','la re puta','son of a bitch','fuck you','fuck off','shut the fuck up'
];

const LEET = { '0':'o','1':'i','3':'e','4':'a','5':'s','7':'t','8':'b','@':'a','$':'s','!':'i','|':'i','+':'t' };

/** Forma base: minúsculas, sin acentos, sin puntuación. */
function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')     // saca acentos y ñ -> n
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
/** Segunda forma: además traduce el "leet" (p3l0tud0 -> pelotudo, m!erda -> mierda). */
function normalizeLeet(s) {
  return normalize(String(s || '').replace(/[0134578@$!|+]/g, c => LEET[c] || c));
}
const squeeze = s => s.replace(/([a-z])\1{1,}/g, '$1');   // holaaaa -> hola

function buildBadSet(extra) {
  const set = new Set();
  BAD_WORDS.forEach(w => { const n = normalize(w); if (n) { set.add(n); set.add(squeeze(n)); } });
  const phrases = BAD_PHRASES.map(normalize);
  (extra || '').split(/[,\n;]+/).forEach(w => {
    const n = normalize(w);
    if (!n) return;
    if (n.includes(' ')) phrases.push(n); else { set.add(n); set.add(squeeze(n)); }
  });
  return { set, phrases };
}

const isBadToken = (t, bad) =>
  !!t && (bad.set.has(t) || bad.set.has(squeeze(t)));

/** Devuelve { bad:boolean, clean:string } */
function checkText(text, bad) {
  const forms = [normalize(text), normalizeLeet(text)];
  if (!forms[0] && !forms[1]) return { bad: false, clean: text };

  for (const n of forms) {
    // frases completas
    for (const p of bad.phrases) if (p && n.includes(p)) return { bad: true, clean: mask(text) };
    // letras separadas a mano: "p u t a" -> "puta"
    const joined = n.replace(/\s/g, '');
    if (isBadToken(joined, bad)) return { bad: true, clean: mask(text) };
  }

  let hit = false;
  forms.forEach(n => n.split(' ').forEach(t => { if (isBadToken(t, bad)) hit = true; }));
  if (!hit) return { bad: false, clean: text };

  // censura solo las palabras ofensivas, respetando el resto del texto
  const clean = String(text).split(/\s+/)
    .map(w => (isBadToken(normalize(w), bad) || isBadToken(normalizeLeet(w), bad)) ? mask(w) : w)
    .join(' ');
  return { bad: true, clean };
}
const mask = w => '*'.repeat(Math.max(3, String(w).replace(/\s/g, '').length));

/* ---------------------------------------------------------------
   3. Firebase
   --------------------------------------------------------------- */
const CFG = window.FIREBASE_CONFIG || {};
const NAME = window.APP_NAME || 'Sala';
let db = null, uid = null;
const listeners = [];   // { ref, event, cb }

function detachAll() {
  clearTimers();
  while (listeners.length) {
    const l = listeners.pop();
    try { l.ref.off(l.event, l.cb); } catch (e) {}
  }
}
function on(ref, event, cb, err) {
  const bound = ref.on(event, cb, err || (e => console.warn('DB:', e && e.code)));
  listeners.push({ ref, event, cb: bound });
  return bound;
}

function configMissing() {
  return !CFG.apiKey || String(CFG.apiKey).indexOf('PEGA_') === 0 || !CFG.databaseURL;
}

let authPromise = null;
/* La autenticación anónima solo hace falta para crear y manejar sesiones.
   El público no se autentica: así no se crean 400 cuentas ni se choca con el
   límite de altas por dirección IP de una red de auditorio. */
function ensureAuth() {
  if (uid) return Promise.resolve(uid);
  if (!authPromise) {
    authPromise = new Promise((res, rej) => {
      let settled = false;
      firebase.auth().onAuthStateChanged(u => {
        if (u) {
          uid = u.uid; db = db || firebase.database();
          if (!settled) { settled = true; res(uid); }
        } else if (!settled) {
          // Nadie guardado en este navegador: identidad temporal.
          firebase.auth().signInAnonymously().catch(rej);
        }
      });
    });
  }
  return authPromise;
}

/* Vincular la identidad de este navegador a una cuenta de Google, para poder
   abrir los paneles desde cualquier dispositivo sin perder lo anterior. */
function signInGoogle() {
  const provider = new firebase.auth.GoogleAuthProvider();
  const u = firebase.auth().currentUser;
  const p = (u && u.isAnonymous) ? u.linkWithPopup(provider) : firebase.auth().signInWithPopup(provider);
  return p.catch(e => {
    if (e.code === 'auth/credential-already-in-use' && e.credential) {
      // Esa cuenta de Google ya tenía sesiones propias: entramos con ella.
      return firebase.auth().signInWithCredential(e.credential);
    }
    throw e;
  }).then(() => {
    uid = firebase.auth().currentUser.uid;
    return uid;
  });
}

function googleFail(e) {
  const c = (e && e.code) || '';
  if (c === 'auth/operation-not-allowed') return toast('Falta activar el proveedor Google en la consola de Firebase');
  if (c === 'auth/popup-blocked') return toast('El navegador bloqueó la ventana. Permitila y probá de nuevo');
  if (c === 'auth/popup-closed-by-user' || c === 'auth/cancelled-popup-request') return;
  if (c === 'auth/unauthorized-domain') return toast('Agregá este dominio en Authentication → Settings → Authorized domains');
  toast('No se pudo entrar con Google');
}

function authFail(e) {
  if (e && (e.code === 'auth/operation-not-allowed' || e.code === 'auth/admin-restricted-operation')) {
    renderFatal('Falta activar el acceso anónimo',
      'En la consola de Firebase entrá en Authentication → Sign-in method y activá el proveedor "Anónimo". Después recargá esta página.');
  } else {
    renderFatal('No se pudo conectar', (e && e.message) || 'Error desconocido');
  }
}

function boot() {
  if (configMissing()) return renderSetup();
  try {
    firebase.initializeApp(CFG);
  } catch (e) {
    return renderFatal('No se pudo iniciar Firebase', e.message);
  }
  DBU = String(CFG.databaseURL || '').replace(/\/+$/, '');
  route();
}

/* ---------------------------------------------------------------
   4. Modelo de datos
   sessions/{code} = { owner, createdAt, title, open, activeItem, banned, items:{ id:{...} } }
   responses/{code}/{itemId}/{uid} = { ts, words:[] } | { ts, choices:[], labels:[] }
   --------------------------------------------------------------- */
function newItem(type, order) {
  const it = {
    order: order,
    type: type,
    question: type === 'cloud' ? 'En una palabra, ¿cómo llegaste hoy?' : '¿Cuál de estas opciones preferís?',
    hideResults: true,
    filter: 'block'
  };
  if (type === 'cloud') it.maxWords = 2;
  else { it.options = ['Opción A', 'Opción B', 'Opción C']; it.multi = false; }
  return it;
}

function itemsSorted(session) {
  const items = session.items || {};
  return Object.keys(items)
    .map(id => [id, items[id]])
    .sort((a, b) => (a[1].order || 0) - (b[1].order || 0));
}

async function createSession(title) {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code = randomCode(6);
    const snap = await db.ref('sessions/' + code).get();
    if (!snap.exists()) break;
  }
  const id = 'q' + Date.now().toString(36);
  const items = {}; items[id] = newItem('cloud', 1);
  const name = title && title.trim() ? title.trim() : 'Sesión sin título';
  await writeSession(code, {
    owner: uid,
    createdAt: firebase.database.ServerValue.TIMESTAMP,
    title: name,
    open: true,
    activeItem: id,
    banned: '',
    phoneResults: true,
    items: items,
    live: { item: id, open: true }
  });
  location.hash = '#/host/' + code;
}

/* Guarda la sesión y, en paralelo, la anota en la lista del anfitrión. */
function writeSession(code, session) {
  const up = {};
  up['sessions/' + code] = session;
  up['mine/' + session.owner + '/' + code] = {
    title: session.title, at: firebase.database.ServerValue.TIMESTAMP
  };
  return db.ref().update(up);
}

/* Copia las preguntas de una sesión anterior en una nueva, con otro código. */
async function duplicateSession(from) {
  const snap = await db.ref('sessions/' + from).get();
  const old = snap.val();
  if (!old) throw new Error('No encontramos esa sesión');
  let code = '';
  for (let i = 0; i < 6; i++) {
    code = randomCode(6);
    const c = await db.ref('sessions/' + code).get();
    if (!c.exists()) break;
  }
  const list = itemsSorted(old);
  const first = list.length ? list[0][0] : null;
  await writeSession(code, {
    owner: uid,
    createdAt: firebase.database.ServerValue.TIMESTAMP,
    title: (old.title || 'Sesión') + ' (copia)',
    open: true,
    activeItem: first,
    banned: old.banned || '',
    phoneResults: old.phoneResults !== false,
    items: old.items || {},
    live: { item: first, open: true, pr: old.phoneResults !== false }
  });
  return code;
}

/* Borra la sesión completa: preguntas, respuestas, resumen y la entrada de la lista. */
function deleteSession(code) {
  return Promise.all([
    db.ref('responses/' + code).remove(),
    db.ref('tally/' + code).remove(),
    db.ref('mine/' + uid + '/' + code).remove(),
    db.ref('sessions/' + code).remove()
  ]);
}

/* ---------------------------------------------------------------
   5. Ruteo
   --------------------------------------------------------------- */
function route() {
  detachAll();
  document.body.classList.remove('present');
  const raw = location.hash.replace(/^#\/?/, '').split('?')[0];
  const parts = raw.split('/').filter(Boolean);
  if (!parts.length) return renderHome();
  if (parts[0] === 'host' && parts[1]) {
    const c = parts[1].toUpperCase();
    APP().innerHTML = '<div class="setup"><p class="muted">Abriendo el panel…</p></div>';
    return ensureAuth().then(() => renderHost(c)).catch(authFail);
  }
  return renderJoin(parts[0].toUpperCase());
}
window.addEventListener('hashchange', route);

/* ---------------------------------------------------------------
   6. Pantallas auxiliares
   --------------------------------------------------------------- */
function renderSetup() {
  APP().innerHTML = `
  <div class="setup">
    <p class="eyebrow">Falta un paso</p>
    <h1 style="font-family:var(--display);font-size:34px;letter-spacing:-.03em;margin:8px 0 14px">
      Conectá tu base de datos</h1>
    <p class="muted">La aplicación está publicada, pero todavía no sabe dónde guardar las respuestas.
      Abrí el archivo <code>config.js</code> del repositorio y pegá la configuración de tu proyecto de
      Firebase. Es gratis y no pide tarjeta.</p>
    <pre>window.FIREBASE_CONFIG = {
  apiKey: "AIza...",
  authDomain: "mi-proyecto.firebaseapp.com",
  databaseURL: "https://mi-proyecto-default-rtdb.firebaseio.com",
  projectId: "mi-proyecto",
  storageBucket: "mi-proyecto.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:1234:web:abcd"
};</pre>
    <p class="muted">El paso a paso completo está en el archivo <code>README.md</code>.</p>
  </div>`;
}

function renderFatal(title, msg) {
  APP().innerHTML = `
  <div class="setup">
    <p class="eyebrow">Error</p>
    <h1 style="font-family:var(--display);font-size:32px;letter-spacing:-.03em;margin:8px 0 14px">${esc(title)}</h1>
    <p class="muted">${esc(msg)}</p>
    <p><a class="btn" href="#">Volver al inicio</a></p>
  </div>`;
}

function topbar(titleHtml, actionsHtml) {
  return `<header class="topbar">
    <a class="brand" href="#"><span class="dots"><i></i><i></i><i></i></span>${esc(NAME)}</a>
    ${titleHtml || ''}
    <span class="spacer"></span>
    ${actionsHtml || ''}
  </header>`;
}

/* ---------------------------------------------------------------
   7. Portada
   --------------------------------------------------------------- */
function fmtDate(ms) {
  if (!ms) return '';
  try { return new Date(ms).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch (e) { return ''; }
}

function renderHome() {
  APP().innerHTML = topbar('', '<span id="acct"></span>') + `
  <div class="home">
    <div class="home-hero">
      <p class="eyebrow">Nubes de palabras y encuestas en vivo</p>
      <h1>Preguntá desde el escenario. <em>Contestan desde el bolsillo.</em></h1>
      <p>Creás la pregunta, mostrás el QR, y las respuestas aparecen en la pantalla a medida que llegan.
         El público no se registra ni deja ningún dato: escanea y contesta.</p>
    </div>
    <div class="home-grid">
      <div class="card">
        <h3>Crear una sesión</h3>
        <div class="field">
          <label for="ttl">Nombre de la sesión</label>
          <input class="input" id="ttl" placeholder="Taller de inducción · martes" maxlength="80">
        </div>
        <button class="btn btn-primary btn-lg" id="go">Crear sesión</button>
        <ol class="steps">
          <li>Escribí tus preguntas: nube de palabras o encuesta.</li>
          <li>Proyectá el código y el QR que aparecen en el panel.</li>
          <li>Mirá los resultados en vivo y descargalos al final.</li>
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
      </div>
    </div>
    <section style="margin-top:38px">
      <h3 style="font-family:var(--display);font-size:15px;margin:0 0 12px">Mis sesiones</h3>
      <div id="mine"><p class="muted">Cargando…</p></div>
    </section>
  </div>`;

  document.getElementById('go').onclick = function () {
    this.disabled = true; this.textContent = 'Creando…';
    const t = document.getElementById('ttl').value;
    ensureAuth().then(() => createSession(t)).catch(e => {
      if (e && String(e.code || '').indexOf('auth/') === 0) return authFail(e);
      renderFatal('No se pudo crear la sesión', dbMsg(e));
    });
  };
  const join = () => {
    const c = (document.getElementById('jc').value || '').trim().toUpperCase();
    if (c.length === 6) location.hash = '#/' + c; else toast('El código tiene 6 caracteres');
  };
  document.getElementById('jb').onclick = join;
  document.getElementById('jc').addEventListener('keydown', e => { if (e.key === 'Enter') join(); });

  ensureAuth().then(() => { paintAcct(); loadMine(); }).catch(authFail);
}

/* Estado de la cuenta del anfitrión, arriba a la derecha. */
function paintAcct() {
  const el = document.getElementById('acct');
  if (!el) return;
  const u = firebase.auth().currentUser;
  if (u && !u.isAnonymous) {
    el.innerHTML = `<span class="muted" style="font-size:13px;margin-right:8px">${esc(u.displayName || u.email || '')}</span>
      <button class="btn btn-sm" id="out">Salir</button>`;
    document.getElementById('out').onclick = () => {
      firebase.auth().signOut().then(() => { uid = null; authPromise = null; route(); });
    };
  } else {
    el.innerHTML = `<button class="btn btn-sm" id="gsi">Guardar mis sesiones con Google</button>`;
    document.getElementById('gsi').onclick = () => {
      signInGoogle().then(() => { paintAcct(); loadMine(); toast('Listo: ahora abrís tus paneles desde cualquier dispositivo'); })
        .catch(googleFail);
    };
  }
}

/* Lista de sesiones propias. */
function loadMine() {
  const el = document.getElementById('mine');
  if (!el) return;
  db.ref('mine/' + uid).get().then(snap => {
    const v = snap.val() || {};
    const list = Object.keys(v).map(c => [c, v[c] || {}]).sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
    if (!list.length) {
      el.innerHTML = `<p class="muted">Todavía no creaste ninguna. Las que crees quedan acá, en esta lista.</p>`;
      return;
    }
    el.innerHTML = list.map(([c, m]) => `
      <div class="card" style="padding:13px 16px;margin-bottom:8px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <div style="flex:1;min-width:190px">
          <div style="font-family:var(--display);font-weight:600">${esc(m.title || 'Sesión sin título')}</div>
          <div class="muted" style="font-size:12.5px;font-family:var(--mono)">${esc(c)} · ${esc(fmtDate(m.at))}</div>
        </div>
        <a class="btn btn-sm" href="#/host/${esc(c)}">Abrir panel</a>
        <button class="btn btn-sm" data-dup="${esc(c)}">Duplicar</button>
        <button class="btn btn-sm btn-danger" data-del="${esc(c)}">Borrar</button>
      </div>`).join('');

    el.querySelectorAll('[data-dup]').forEach(b => {
      b.onclick = () => {
        b.disabled = true; b.textContent = 'Copiando…';
        duplicateSession(b.dataset.dup)
          .then(code => { location.hash = '#/host/' + code; })
          .catch(e => { b.disabled = false; b.textContent = 'Duplicar'; toast(dbMsg(e)); });
      };
    });
    el.querySelectorAll('[data-del]').forEach(b => {
      b.onclick = () => {
        if (!confirm('Se borran la sesión y todas sus respuestas. No se puede deshacer.')) return;
        b.disabled = true;
        deleteSession(b.dataset.del).then(loadMine).catch(e => { b.disabled = false; toast(dbMsg(e)); });
      };
    });
  }).catch(e => { el.innerHTML = `<p class="muted">${esc(dbMsg(e))}</p>`; });
}

function dbMsg(e) {
  if (e && e.code === 'PERMISSION_DENIED') {
    return 'La base de datos rechazó la operación. Revisá que hayas pegado las reglas de seguridad del archivo database.rules.json.';
  }
  return (e && e.message) || 'Error desconocido';
}

/* ---------------------------------------------------------------
   8. Panel del anfitrión
   --------------------------------------------------------------- */
function renderHost(code) {
  const state = { code, session: null, responses: {}, seen: new Set(), qrDone: false };

  APP().innerHTML = topbar('', '') + `<div class="host"><div class="rail"></div>
    <div class="stage-wrap"><div class="stage"><p class="empty">Cargando…</p></div></div></div>
    <button class="btn exit-present" id="exitPres">Salir de presentación</button>`;
  document.getElementById('exitPres').onclick = () => document.body.classList.remove('present');

  const sref = db.ref('sessions/' + code);

  on(sref, 'value', snap => {
    if (!snap.exists()) return renderFatal('Esa sesión no existe', 'El código ' + code + ' no corresponde a ninguna sesión activa.');
    const s = snap.val();
    if (s.owner !== uid) {
      return renderFatal('No sos el anfitrión de esta sesión',
        'Esta pantalla solo la puede abrir quien creó la sesión, desde el mismo navegador. Si querés participar, entrá con el código.');
    }
    const changedItem = !state.session || state.session.activeItem !== s.activeItem;
    state.session = s;
    // Nodo diminuto que consultan los celulares para saber qué pregunta está activa.
    const live = s.live || {};
    const pr = s.phoneResults !== false;
    if (live.item !== s.activeItem || live.open !== (s.open !== false) || live.pr !== pr) {
      sref.child('live').set({ item: s.activeItem, open: s.open !== false, pr: pr });
    }
    if (changedItem) {
      state.seen = new Set();
      state.responses = {};
      watchResponses();
    }
    paint();
  }, e => renderFatal('No se pudo leer la sesión', dbMsg(e)));

  let rref = null, rcb = null;
  function watchResponses() {
    if (rref && rcb) { try { rref.off('value', rcb); } catch (e) {} }
    const item = state.session.activeItem;
    if (!item) return;
    rref = db.ref('responses/' + code + '/' + item);
    rcb = rref.on('value', snap => { state.responses = snap.val() || {}; paint(); publishSoon(); },
                  e => { state.responses = {}; paint(); });
    listeners.push({ ref: rref, event: 'value', cb: rcb });
  }

  /* Publica un resumen liviano para que lo lean los celulares sin descargar
     todas las respuestas. Como mucho una escritura cada segundo y medio. */
  let pubTimer = null;
  function publishSoon() {
    if (pubTimer) return;
    pubTimer = setTimeout(() => {
      pubTimer = null;
      const s = state.session; if (!s) return;
      const item = (s.items || {})[s.activeItem]; if (!item) return;
      if (s.phoneResults === false) return;
      db.ref('tally/' + code + '/' + s.activeItem).set(buildTally(item, state.responses)).catch(() => {});
    }, 1500);
  }

  /* ---- pintar ---- */
  function paint() {
    const s = state.session;
    const list = itemsSorted(s);
    const activeId = s.activeItem;
    const item = (s.items || {})[activeId];

    // encabezado
    const tb = document.querySelector('.topbar');
    if (!tb.dataset.ready) {
      tb.dataset.ready = '1';
      tb.innerHTML = `<a class="brand" href="#"><span class="dots"><i></i><i></i><i></i></span>${esc(NAME)}</a>
        <input class="topbar-title" id="ttl" value="${esc(s.title)}" maxlength="80" aria-label="Nombre de la sesión">
        <span class="spacer"></span>
        <button class="btn btn-sm" id="bOpen"></button>
        <button class="btn btn-sm" id="bPres">Presentar</button>
        <button class="btn btn-sm" id="bExp">Descargar resultados</button>`;
      const t = document.getElementById('ttl');
      t.onchange = () => {
        const v = t.value.trim() || 'Sesión sin título';
        sref.child('title').set(v);
        db.ref('mine/' + uid + '/' + code + '/title').set(v).catch(() => {});
      };
      document.getElementById('bPres').onclick = () => document.body.classList.add('present');
      document.getElementById('bOpen').onclick = () => sref.child('open').set(!state.session.open);
      document.getElementById('bExp').onclick = () => openExport(code, state.session);
    }
    document.getElementById('bOpen').textContent = s.open ? 'Cerrar votación' : 'Abrir votación';

    paintRail(list, activeId);
    paintStage(item, activeId);
    paintEditor(item, activeId);
  }

  /* ---- barra lateral ---- */
  function paintRail(list, activeId) {
    const rail = document.querySelector('.rail');
    const url = baseUrl() + '#/' + code;
    const n = Object.keys(state.responses || {}).length;

    // Solo se reconstruye si cambió algo estructural; si no, se actualiza el contador.
    const sig = activeId + '|' + list.map(([id, it]) => id + it.type + it.question).join('~') +
                '|' + (state.session.banned || '') + '|' + (state.session.phoneResults !== false);
    if (rail.dataset.sig === sig) {
      const c = document.getElementById('cnt');
      if (c) c.innerHTML = `<b>${n}</b><span>${n === 1 ? 'respuesta' : 'respuestas'} en esta pregunta</span>`;
      return;
    }
    rail.dataset.sig = sig;

    rail.innerHTML = `
      <section>
        <div class="invite">
          <p class="eyebrow">Entrá y participá</p>
          <div class="code-slab">${esc(code)}</div>
          <div class="qr-frame"><div id="qr"></div></div>
          <div class="invite-url">${esc(url)}</div>
          <div class="btn-row" style="justify-content:center">
            <button class="btn btn-sm" id="cpy">Copiar link</button>
            <button class="btn btn-sm" id="dqr">Descargar QR</button>
          </div>
          <div class="counter" id="cnt"><b>${n}</b><span>${n === 1 ? 'respuesta' : 'respuestas'} en esta pregunta</span></div>
        </div>
      </section>
      <section>
        <h3>Preguntas</h3>
        <div class="slides">
          ${list.map(([id, it], i) => `
            <button class="slide ${id === activeId ? 'on' : ''}" data-go="${id}">
              <div class="slide-top">
                <span class="slide-n">${i + 1}</span>
                <span class="badge ${it.type}">${it.type === 'cloud' ? 'Nube' : 'Encuesta'}</span>
                ${id === activeId ? '<span class="live-dot"></span>' : ''}
              </div>
              <div class="slide-q">${esc(it.question || 'Sin pregunta')}</div>
            </button>`).join('')}
        </div>
        <div class="btn-row">
          <button class="btn btn-sm" data-add="cloud">+ Nube</button>
          <button class="btn btn-sm" data-add="poll">+ Encuesta</button>
        </div>
      </section>
      <section>
        <h3>Sala grande</h3>
        <label class="check"><input type="checkbox" id="phres" ${state.session.phoneResults !== false ? 'checked' : ''}>
          <span>Mostrar los resultados en los celulares
          <small>Desactivalo en auditorios: el público mira la pantalla y cada teléfono descarga muchísimo menos.</small></span></label>
      </section>
      <section>
        <h3>Palabras bloqueadas</h3>
        <textarea class="input" id="ban" placeholder="separadas por comas">${esc(state.session.banned || '')}</textarea>
        <p class="muted" style="font-size:12.5px;margin:6px 0 0">Se suman a la lista de groserías que ya trae la aplicación.</p>
      </section>
      <section>
        <button class="btn btn-sm btn-danger" id="del">Eliminar la sesión</button>
      </section>`;

    // QR
    const qbox = document.getElementById('qr');
    qbox.innerHTML = '';
    try {
      new QRCode(qbox, { text: url, width: 168, height: 168, colorDark: '#12141F', colorLight: '#ffffff',
                         correctLevel: QRCode.CorrectLevel.M });
    } catch (e) { qbox.textContent = 'QR no disponible'; }

    document.getElementById('cpy').onclick = () => copy(url);
    document.getElementById('dqr').onclick = () => {
      const cv = qbox.querySelector('canvas');
      if (!cv) return toast('El QR todavía no está listo');
      const a = document.createElement('a');
      a.href = cv.toDataURL('image/png'); a.download = 'qr-' + code + '.png'; a.click();
    };
    const ban = document.getElementById('ban');
    ban.onchange = () => sref.child('banned').set(ban.value);
    const phres = document.getElementById('phres');
    phres.onchange = () => sref.child('phoneResults').set(phres.checked);

    rail.querySelectorAll('[data-go]').forEach(b => {
      b.onclick = () => sref.child('activeItem').set(b.dataset.go);
    });
    rail.querySelectorAll('[data-add]').forEach(b => {
      b.onclick = () => {
        const list2 = itemsSorted(state.session);
        const order = list2.length ? (list2[list2.length - 1][1].order || list2.length) + 1 : 1;
        const id = 'q' + Date.now().toString(36);
        const up = {};
        up['items/' + id] = newItem(b.dataset.add, order);
        up['activeItem'] = id;
        sref.update(up);
      };
    });
    document.getElementById('del').onclick = () => {
      if (!confirm('Se elimina la sesión y todas sus respuestas. Esta acción no se puede deshacer.')) return;
      deleteSession(code).then(() => { location.hash = ''; });
    };
  }

  /* ---- escenario ---- */
  function paintStage(item, itemId) {
    const wrap = document.querySelector('.stage-wrap');
    let stage = wrap.querySelector('.stage');
    if (!stage) { wrap.insertAdjacentHTML('afterbegin', '<div class="stage"></div>'); stage = wrap.querySelector('.stage'); }
    if (!item) { stage.innerHTML = '<p class="empty">Agregá una pregunta desde el panel de la izquierda.</p>'; return; }

    const n = Object.keys(state.responses || {}).length;
    stage.innerHTML = `
      <div class="stage-head">
        <h2 class="stage-q">${esc(item.question || '')}</h2>
        <div class="stage-meta">
          ${n} ${n === 1 ? 'respuesta' : 'respuestas'}<br>
          ${state.session.open ? 'Votación abierta' : 'Votación cerrada'}<br>
          código ${esc(code)}
        </div>
      </div>
      <div class="stage-body" id="sbody"></div>`;
    renderResults(document.getElementById('sbody'), item, state.responses, state.seen, true);
  }

  /* ---- editor ---- */
  function paintEditor(item, itemId) {
    const wrap = document.querySelector('.stage-wrap');
    let ed = wrap.querySelector('.editor');
    if (!ed) { wrap.insertAdjacentHTML('beforeend', '<div class="editor"></div>'); ed = wrap.querySelector('.editor'); }
    if (!item) { ed.innerHTML = ''; ed.dataset.sig = ''; return; }

    const sigE = itemId + '|' + JSON.stringify(item);
    if (ed.dataset.sig === sigE) return;   // no pisar lo que se está escribiendo
    ed.dataset.sig = sigE;

    const isCloud = item.type === 'cloud';
    ed.innerHTML = `
      <div class="editor-head">
        <span class="badge ${item.type}">${isCloud ? 'Nube de palabras' : 'Encuesta'}</span>
        <h3>Editar esta pregunta</h3>
        <button class="btn btn-sm btn-danger" id="eDel">Eliminar</button>
      </div>
      <div class="field">
        <label for="eQ">Pregunta</label>
        <input class="input" id="eQ" value="${esc(item.question || '')}" maxlength="160">
      </div>
      ${isCloud ? `
      <div class="two-col">
        <div class="field">
          <label for="eMax">Palabras por participante</label>
          <select class="select" id="eMax">
            ${[1,2,3,4,5].map(v => `<option value="${v}" ${(item.maxWords||1)==v?'selected':''}>${v}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="eFil">Control de groserías</label>
          <select class="select" id="eFil">
            <option value="block" ${item.filter==='block'?'selected':''}>Rechazar la respuesta</option>
            <option value="censor" ${item.filter==='censor'?'selected':''}>Mostrarla censurada</option>
            <option value="off" ${item.filter==='off'?'selected':''}>Sin control</option>
          </select>
        </div>
      </div>` : `
      <div class="field">
        <label>Opciones</label>
        <div id="eOpts">${(item.options || []).map((o, i) => optRow(o, i)).join('')}</div>
        <button class="btn btn-sm" id="eAdd" style="margin-top:4px">+ Agregar opción</button>
      </div>
      <label class="check"><input type="checkbox" id="eMulti" ${item.multi ? 'checked' : ''}>
        <span>Permitir elegir varias opciones</span></label>`}
      <label class="check"><input type="checkbox" id="eHide" ${item.hideResults ? 'checked' : ''}>
        <span>Ocultar los resultados hasta que la persona responda
        <small>El público ve la nube o los porcentajes recién después de enviar su respuesta.</small></span></label>
      <div class="btn-row" style="margin-top:16px">
        <button class="btn btn-primary" id="eSave">Guardar cambios</button>
        <button class="btn" id="eReset">Borrar las respuestas de esta pregunta</button>
      </div>`;

    if (!isCloud) {
      const box = document.getElementById('eOpts');
      const wire = () => box.querySelectorAll('[data-rm]').forEach(b => {
        b.onclick = () => { if (box.children.length > 2) b.parentElement.remove(); else toast('Tiene que haber al menos dos opciones'); };
      });
      wire();
      document.getElementById('eAdd').onclick = () => {
        if (box.children.length >= 10) return toast('Máximo diez opciones');
        box.insertAdjacentHTML('beforeend', optRow('', box.children.length));
        wire();
      };
    }

    document.getElementById('eSave').onclick = () => {
      const up = { question: (document.getElementById('eQ').value || '').trim() || 'Sin pregunta',
                   hideResults: document.getElementById('eHide').checked };
      if (isCloud) {
        up.maxWords = parseInt(document.getElementById('eMax').value, 10);
        up.filter = document.getElementById('eFil').value;
      } else {
        const opts = Array.from(document.querySelectorAll('#eOpts .input'))
          .map(i => i.value.trim()).filter(Boolean);
        if (opts.length < 2) return toast('Tiene que haber al menos dos opciones');
        up.options = opts;
        up.multi = document.getElementById('eMulti').checked;
      }
      sref.child('items/' + itemId).update(up).then(() => toast('Cambios guardados'));
    };
    document.getElementById('eReset').onclick = () => {
      if (!confirm('Se borran todas las respuestas de esta pregunta.')) return;
      db.ref('tally/' + code + '/' + itemId).remove();
      db.ref('responses/' + code + '/' + itemId).remove().then(() => { state.seen = new Set(); toast('Respuestas borradas'); });
    };
    document.getElementById('eDel').onclick = () => {
      const list = itemsSorted(state.session);
      if (list.length < 2) return toast('La sesión necesita al menos una pregunta');
      if (!confirm('Se elimina la pregunta y sus respuestas.')) return;
      const other = list.find(([id]) => id !== itemId)[0];
      db.ref('responses/' + code + '/' + itemId).remove();
      db.ref('tally/' + code + '/' + itemId).remove();
      const up = {}; up['items/' + itemId] = null; up['activeItem'] = other;
      sref.update(up);
    };
  }
}

const optRow = (val, i) => `<div class="opt-row">
  <input class="input" value="${esc(val)}" maxlength="90" placeholder="Opción ${i + 1}">
  <button class="btn btn-sm" data-rm="1" aria-label="Quitar opción">×</button></div>`;

/* ---------------------------------------------------------------
   9. Resultados (compartido entre anfitrión y participante)
   --------------------------------------------------------------- */
function aggregateCloud(responses) {
  const groups = new Map();     // clave normalizada -> { count, forms:Map }
  Object.keys(responses || {}).forEach(u => {
    const words = (responses[u] && responses[u].words) || [];
    words.forEach(w => {
      const key = normalize(w);
      if (!key) return;
      if (!groups.has(key)) groups.set(key, { count: 0, forms: new Map() });
      const g = groups.get(key);
      g.count++;
      g.forms.set(w, (g.forms.get(w) || 0) + 1);
    });
  });
  return Array.from(groups.values()).map(g => {
    let best = '', bn = -1;
    g.forms.forEach((n, form) => { if (n > bn) { bn = n; best = form; } });
    return { label: best, count: g.count };
  }).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function aggregatePoll(responses, options) {
  const counts = (options || []).map(() => 0);
  let total = 0;
  Object.keys(responses || {}).forEach(u => {
    const ch = (responses[u] && responses[u].choices) || [];
    ch.forEach(i => { if (counts[i] != null) { counts[i]++; total++; } });
  });
  return { counts, total, voters: Object.keys(responses || {}).length };
}

const PALETTE = ['var(--w1)', 'var(--w2)', 'var(--w3)', 'var(--w4)', 'var(--w5)', 'var(--w6)'];

function renderResults(el, item, responses, seen, big) {
  if (!el) return;
  const empty = !responses || !Object.keys(responses).length;
  if (empty) {
    el.innerHTML = '<p class="empty">Todavía no llegó ninguna respuesta. Las palabras van a aparecer acá solas, sin recargar.</p>';
    return;
  }
  if (item.type === 'cloud') {
    const data = aggregateCloud(responses).slice(0, 60);
    const max = data.length ? data[0].count : 1;
    const min = big ? 20 : 15, top = big ? 92 : 40;
    el.innerHTML = '<div class="cloud">' + data.map((d, i) => {
      const size = Math.round(min + (top - min) * Math.sqrt(d.count / max));
      const isNew = seen && !seen.has(d.label);
      if (seen) seen.add(d.label);
      return `<span class="cloud-word ${isNew ? 'is-new' : ''}" style="font-size:${size}px;color:${PALETTE[i % PALETTE.length]}">
        ${esc(d.label)}${d.count > 1 ? `<i>${d.count}</i>` : ''}</span>`;
    }).join('') + '</div>';
  } else {
    const opts = item.options || [];
    const { counts, total, voters } = aggregatePoll(responses, opts);
    el.innerHTML = '<div class="bars">' + opts.map((o, i) => {
      const pct = total ? Math.round(counts[i] / total * 1000) / 10 : 0;
      return `<div class="bar-row">
        <div class="bar-top"><span class="bar-label">${esc(o)}</span>
          <span class="bar-num">${pct}%<small>${counts[i]}</small></span></div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${PALETTE[i % PALETTE.length]}"></div></div>
      </div>`;
    }).join('') + `<p class="muted" style="color:var(--muted-dark);font-family:var(--mono);font-size:12px;margin:4px 0 0">
      ${voters} ${voters === 1 ? 'persona votó' : 'personas votaron'}</p></div>`;
  }
}

/* ---------------------------------------------------------------
   10. Vista del participante
   Sin SDK ni conexión permanente: pedidos HTTP sueltos cada pocos
   segundos. Así entran cientos de personas sin tocar el límite de
   100 conexiones simultáneas del plan gratuito.
   --------------------------------------------------------------- */
function buildTally(item, responses) {
  const voters = Object.keys(responses || {}).length;
  if (item.type === 'cloud') {
    return { t: 'cloud', n: voters,
             d: aggregateCloud(responses).slice(0, 40).map(x => ({ l: x.label, c: x.count })) };
  }
  const a = aggregatePoll(responses, item.options || []);
  return { t: 'poll', n: voters, o: item.options || [], c: a.counts, total: a.total };
}

/* Dibuja el resumen publicado por el anfitrión. */
function renderTally(el, tally, seen) {
  if (!el) return;
  if (!tally || !tally.n) {
    el.innerHTML = '<p class="empty">Todavía no hay respuestas para mostrar.</p>';
    return;
  }
  if (tally.t === 'cloud') {
    const d = (tally.d || []).filter(Boolean);
    if (!d.length) { el.innerHTML = '<p class="empty">Todavía no hay respuestas para mostrar.</p>'; return; }
    const max = d[0].c || 1;
    el.innerHTML = '<div class="cloud">' + d.map((x, i) => {
      const size = Math.round(15 + 25 * Math.sqrt(x.c / max));
      const isNew = seen && !seen.has(x.l);
      if (seen) seen.add(x.l);
      return `<span class="cloud-word ${isNew ? 'is-new' : ''}" style="font-size:${size}px;color:${PALETTE[i % PALETTE.length]}">
        ${esc(x.l)}${x.c > 1 ? `<i>${x.c}</i>` : ''}</span>`;
    }).join('') + '</div>';
  } else {
    const o = tally.o || [], c = tally.c || [], total = tally.total || 0;
    el.innerHTML = '<div class="bars">' + o.map((label, i) => {
      const n = c[i] || 0, pct = total ? Math.round(n / total * 1000) / 10 : 0;
      return `<div class="bar-row">
        <div class="bar-top"><span class="bar-label">${esc(label)}</span>
          <span class="bar-num">${pct}%<small>${n}</small></span></div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${PALETTE[i % PALETTE.length]}"></div></div>
      </div>`;
    }).join('') + `<p class="muted" style="color:var(--muted-dark);font-family:var(--mono);font-size:12px;margin:4px 0 0">
      ${tally.n} ${tally.n === 1 ? 'persona votó' : 'personas votaron'}</p></div>`;
  }
}

function renderJoin(code) {
  const st = { s: null, itemId: null, item: null, answered: false, tally: null, seen: new Set() };
  const pid = participantId();
  APP().innerHTML = topbar('', '') + `<div class="join" id="jw"><p class="muted">Cargando…</p></div>`;

  load();

  async function load() {
    let s;
    try { s = await restGet('sessions/' + code); }
    catch (e) { return fail('No pudimos conectarnos. Revisá tu conexión y volvé a intentar.'); }
    if (!s) return fail('No encontramos ninguna sesión con el código ' + code + '. Revisalo con quien está presentando.');
    st.s = s;
    setItem(s.activeItem, (s.items || {})[s.activeItem]);
    poll();
  }

  function fail(msg) {
    document.getElementById('jw').innerHTML =
      `<div class="notice bad">${esc(msg)}</div><a class="btn" href="#">Volver al inicio</a>`;
  }

  function setItem(id, item) {
    st.itemId = id; st.item = item || null; st.tally = null; st.seen = new Set();
    st.answered = store.get('sala:' + code + ':' + id) === '1';
    paint();
    if (canSee()) refreshTally();
  }

  const canSee = () => !!st.item && st.s.phoneResults !== false && (!st.item.hideResults || st.answered);

  /* Consulta un nodo de pocos bytes para seguir la pregunta activa.
     El intervalo lleva una variación al azar para que 400 celulares no
     pregunten todos en el mismo instante. */
  function poll() {
    timers.push(setInterval(async () => {
      try {
        const live = await restGet('sessions/' + code + '/live');
        if (!live) return;
        const pr = live.pr !== false;
        if (live.open !== st.s.open || pr !== (st.s.phoneResults !== false)) {
          st.s.open = live.open; st.s.phoneResults = pr; paint();
        }
        if (live.item && live.item !== st.itemId) {
          const it = await restGet('sessions/' + code + '/items/' + live.item);
          setItem(live.item, it);
        } else if (canSee()) {
          refreshTally();
        }
      } catch (e) { /* un pedido perdido no rompe nada: se reintenta al siguiente ciclo */ }
    }, 4000 + Math.floor(Math.random() * 3000)));
  }

  async function refreshTally() {
    try {
      st.tally = await restGet('tally/' + code + '/' + st.itemId);
      const el = document.getElementById('jres');
      if (el) renderTally(el, st.tally, st.seen);
    } catch (e) {}
  }

  function paint() {
    const w = document.getElementById('jw');
    const item = st.item;
    if (!item) { w.innerHTML = '<p class="muted">El anfitrión todavía no activó ninguna pregunta.</p>'; return; }

    let html = `<p class="eyebrow">${esc(st.s.title || '')}</p><h1 class="join-q">${esc(item.question)}</h1>`;

    if (st.s.open === false && !st.answered) {
      html += `<div class="notice warn">La votación está cerrada. Ya no se pueden enviar respuestas.</div>`;
    } else if (st.answered) {
      html += `<div class="notice good center"><div class="done-mark">✓</div>
        Recibimos tu respuesta.<br><button class="btn btn-sm" id="again" style="margin-top:10px">Cambiar mi respuesta</button></div>`;
    } else {
      html += item.type === 'cloud' ? formCloud(item) : formPoll(item);
    }

    if (canSee()) {
      html += `<div class="stage" style="margin-top:20px">
        <p class="eyebrow" style="color:var(--muted-dark);margin:0 0 14px">Resultados</p>
        <div id="jres"><p class="empty">Buscando resultados…</p></div></div>`;
    } else if (st.s.phoneResults === false) {
      if (st.answered) html += `<div class="notice">Los resultados están en la pantalla grande.</div>`;
    } else if (!st.answered) {
      html += `<div class="notice">Los resultados se muestran cuando envíes tu respuesta.</div>`;
    }
    w.innerHTML = html;

    if (canSee() && st.tally) renderTally(document.getElementById('jres'), st.tally, st.seen);
    const again = document.getElementById('again');
    if (again) again.onclick = () => { st.answered = false; paint(); };
    wireForm(item);
  }

  function formCloud(item) {
    const n = Math.max(1, Math.min(5, item.maxWords || 1));
    return `<div class="word-inputs">
      ${Array.from({ length: n }, (_, i) =>
        `<input class="input wi" maxlength="40" placeholder="${i === 0 ? 'Escribí una palabra' : 'Otra palabra (opcional)'}">`).join('')}
    </div>
    <div id="ferr"></div>
    <button class="btn btn-primary btn-lg" id="send" style="width:100%">Enviar</button>`;
  }
  function formPoll(item) {
    return `<div id="opts">
      ${(item.options || []).map((o, i) =>
        `<button class="choice" data-i="${i}"><span class="tick">✓</span><span>${esc(o)}</span></button>`).join('')}
    </div>
    <div id="ferr"></div>
    <button class="btn btn-primary btn-lg" id="send" style="width:100%;margin-top:10px">Enviar</button>`;
  }

  function wireForm(item) {
    const send = document.getElementById('send');
    if (!send) return;
    const picked = new Set();

    if (item.type === 'poll') {
      document.querySelectorAll('.choice').forEach(b => {
        b.onclick = () => {
          const i = parseInt(b.dataset.i, 10);
          if (item.multi) {
            if (picked.has(i)) { picked.delete(i); b.classList.remove('on'); }
            else { picked.add(i); b.classList.add('on'); }
          } else {
            picked.clear(); picked.add(i);
            document.querySelectorAll('.choice').forEach(x => x.classList.remove('on'));
            b.classList.add('on');
          }
        };
      });
    }

    send.onclick = async () => {
      const err = document.getElementById('ferr');
      err.innerHTML = '';
      const payload = { ts: { '.sv': 'timestamp' } };

      if (item.type === 'cloud') {
        let words = Array.from(document.querySelectorAll('.wi'))
          .map(i => i.value.replace(/\s+/g, ' ').trim()).filter(Boolean);
        if (!words.length) { err.innerHTML = '<div class="notice bad">Escribí al menos una palabra.</div>'; return; }
        const mode = item.filter || 'block';
        if (mode !== 'off') {
          const bad = buildBadSet(st.s.banned);
          const out = [];
          for (const wd of words) {
            const r = checkText(wd, bad);
            if (r.bad && mode === 'block') {
              err.innerHTML = '<div class="notice bad">Esa palabra no se puede enviar. Probá con otra.</div>';
              return;
            }
            out.push(r.bad ? r.clean : wd);
          }
          words = out;
        }
        payload.words = words.slice(0, Math.max(1, item.maxWords || 1));
      } else {
        if (!picked.size) { err.innerHTML = '<div class="notice bad">Elegí una opción para poder enviar.</div>'; return; }
        const arr = Array.from(picked).sort((a, b) => a - b);
        payload.choices = arr;
        payload.labels = arr.map(i => (item.options || [])[i] || '');
      }

      send.disabled = true; send.textContent = 'Enviando…';
      try {
        await restPut('responses/' + code + '/' + st.itemId + '/' + pid, payload);
        store.set('sala:' + code + ':' + st.itemId, '1');
        st.answered = true;
        toast('Respuesta enviada');
        paint();
        if (canSee()) refreshTally();
      } catch (e) {
        send.disabled = false; send.textContent = 'Enviar';
        err.innerHTML = '<div class="notice bad">' +
          (st.s.open === false ? 'La votación está cerrada.' : 'No se pudo enviar. Revisá tu conexión y probá de nuevo.') +
          '</div>';
      }
    };
  }
}

/* ---------------------------------------------------------------
   11. Exportación
   --------------------------------------------------------------- */
function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
const csvRows = rows => '\ufeff' + rows.map(r => r.map(csvCell).join(',')).join('\r\n');

function openExport(code, session) {
  db.ref('responses/' + code).get().then(snap => {
    const all = snap.val() || {};
    const list = itemsSorted(session);
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const slug = (session.title || 'sesion').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 40) || 'sesion';

    // seudónimos estables por participante
    const order = [];
    list.forEach(([id]) => Object.keys(all[id] || {}).forEach(u => { if (order.indexOf(u) < 0) order.push(u); }));
    const alias = {}; order.forEach((u, i) => alias[u] = 'P' + (i + 1));

    // detalle
    const detail = [['sesion', 'codigo', 'n_pregunta', 'tipo', 'pregunta', 'participante', 'respuesta', 'fecha_hora']];
    list.forEach(([id, it], idx) => {
      const rs = all[id] || {};
      Object.keys(rs).forEach(u => {
        const r = rs[u] || {};
        const vals = it.type === 'cloud' ? (r.words || [])
          : (r.labels || (r.choices || []).map(i => (it.options || [])[i]));
        (vals.length ? vals : ['']).forEach(v => {
          detail.push([session.title, code, idx + 1, it.type === 'cloud' ? 'nube' : 'encuesta',
            it.question, alias[u] || '?', v, r.ts ? new Date(r.ts).toLocaleString('es-AR') : '']);
        });
      });
    });

    // agregado
    const agg = [['n_pregunta', 'pregunta', 'tipo', 'respuesta', 'menciones', 'porcentaje']];
    list.forEach(([id, it], idx) => {
      const rs = all[id] || {};
      if (it.type === 'cloud') {
        const data = aggregateCloud(rs);
        const tot = data.reduce((a, b) => a + b.count, 0) || 1;
        data.forEach(d => agg.push([idx + 1, it.question, 'nube', d.label, d.count, Math.round(d.count / tot * 1000) / 10]));
      } else {
        const { counts, total } = aggregatePoll(rs, it.options || []);
        (it.options || []).forEach((o, i) => agg.push([idx + 1, it.question, 'encuesta', o, counts[i],
          total ? Math.round(counts[i] / total * 1000) / 10 : 0]));
      }
    });

    const json = JSON.stringify({ code, title: session.title, exportedAt: new Date().toISOString(),
      items: list.map(([id, it], i) => ({ n: i + 1, type: it.type, question: it.question, options: it.options || null,
        responses: Object.keys(all[id] || {}).map(u => ({ participante: alias[u], ...(all[id][u]) })) })) }, null, 2);

    download(`${slug}-${stamp}-resumen.csv`, csvRows(agg), 'text/csv;charset=utf-8');
    setTimeout(() => download(`${slug}-${stamp}-detalle.csv`, csvRows(detail), 'text/csv;charset=utf-8'), 350);
    setTimeout(() => download(`${slug}-${stamp}.json`, json, 'application/json'), 700);
    toast('Se descargan tres archivos: resumen, detalle y JSON');
  }).catch(e => toast(dbMsg(e)));
}

/* ---------------------------------------------------------------
   12. Arranque
   --------------------------------------------------------------- */
boot();

})();
