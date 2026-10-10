/* =====================================================================
   Sala — ARMÁ TU CARTERA (ejercicio guiado, dentro del modo competitivo)

   El mismo ejercicio de arma-tu-cartera.html, pero jugado por toda la sala
   a la vez y guiado por el presentador desde el celular:

     3 preguntas de perfil -> elegir cartera -> 6 rondas de decisiones
     -> rankings con cuenta regresiva (conservadora, moderada, agresiva, total)

   Mismo criterio de hosteo que el resto del sitio: el panel y el control
   usan el SDK de Firebase (autenticados); los celulares del público hablan
   por HTTP suelto, sin cuenta, contra un nodo diminuto (live).

   Los rendimientos, los textos y las cuentas viven en este archivo: por la
   base solo viajan el paso activo, las respuestas y la tabla final.

   Modelo de datos
     carteras/{code}          lectura pública, escribe el dueño
       owner, title, createdAt, secs, seed,
       live:{ st, step, sk, at, secs, seed, rc, rat }
         st   lobby | q (pregunta abierta) | x (cerrada) | rank | end
         step 0..9 (ver STEPS)   sk = 's' + step
         rc   categoría del ranking que se está revelando (0..3)
         rat  hora del servidor en que se empezó a revelar rc
     cplayers/{code}/{pid}    = { n, at }        escritura pública
     cans/{code}/{sk}/{pid}   = { c, ms, ts }    escritura pública, una vez
     crank/{code}                                lectura pública, la escribe el dueño
     cmine/{uid}/{code}       = { title, at }
   ===================================================================== */
(function () {
'use strict';

/* ---------------------------------------------------------------
   1. Utilidades
   --------------------------------------------------------------- */
const APP = () => document.getElementById('app');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
  c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const $ = id => document.getElementById(id);

let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  if (!t) return;
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
/* El mismo identificador de dispositivo que usan las encuestas y el competitivo. */
function participantId() {
  let p = store.get('sala:pid');
  if (!p || p.length < 8) { p = 'p' + randomId(19); store.set('sala:pid', p); }
  return p;
}
function baseUrl() { return location.origin + location.pathname; }

/* Nombres: cortamos lo obvio para que no aparezca una grosería proyectada. */
const BADW = `puta puto putas putos mierda pelotudo pelotuda boludo boluda concha pija verga polla conchudo
forro forra gilipollas joder carajo culiado culiao pendejo maricon marica trolo hdp hijodeputa sorete
garca choto pajero zorra imbecil idiota estupido tarado mogolico retrasado cojones follar chingar culero
ojete orto prostituta puton fuck fucking fuk shit bullshit bitch bastard asshole cunt dick cock pussy
whore slut motherfucker wanker twat retard nigga nigger faggot fag rape`.trim().split(/\s+/);
const LEET = { '0':'o','1':'i','3':'e','4':'a','5':'s','7':'t','8':'b','@':'a','$':'s','!':'i','|':'i','+':'t' };
function normalize(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
function nameLooksBad(name) {
  const forms = [normalize(name), normalize(String(name).replace(/[0134578@$!|+]/g, c => LEET[c] || c))];
  const squeeze = s => s.replace(/([a-z])\1{1,}/g, '$1');
  for (const f of forms) {
    if (!f) continue;
    const toks = f.split(' ').concat([f.replace(/\s/g, '')]);
    for (const t of toks) if (BADW.indexOf(t) >= 0 || BADW.indexOf(squeeze(t)) >= 0) return true;
  }
  return false;
}

function fmt(n) { return '$' + Math.round(n).toLocaleString('es-AR'); }
function pct(n) {
  const s = Math.abs(n).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return (n > 0 ? '+' : n < 0 ? '−' : '') + s + '%';
}
function secsTxt(ms) {
  return (ms / 1000).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' s';
}

/* ---------------------------------------------------------------
   2. Base de datos por HTTP suelto (celulares del público)
   --------------------------------------------------------------- */
let DBU = '';
let skew = 0;
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
   3. Puente con app.js (conexión, identidad, limpieza al cambiar de pantalla)
   --------------------------------------------------------------- */
let db = null, uid = null;
function sync() { const E = window.ENC; db = E.db(); uid = E.uid(); DBU = E.dbu(); }
const on = (ref, ev, cb, err) => window.ENC.on(ref, ev, cb, err);
const every = (fn, ms) => window.ENC.timer(setInterval(fn, ms));
const later = (fn, ms) => window.ENC.wait(setTimeout(fn, ms));

function dbMsg(e) {
  if (e && e.code === 'PERMISSION_DENIED') {
    return 'La base rechazó la operación. Falta volver a pegar las reglas (database.rules.json) en Firebase.';
  }
  return (e && e.message) || 'Error desconocido';
}

/* Todas las pantallas de este modo usan la estética de BYMAEDUCA, no la de la
   Sala: la clase ct-mode en el body cambia el fondo y app.js la saca al
   cambiar de pantalla. */
function frame(inner, opts) {
  document.body.classList.add('ct-mode');
  const o = opts || {};
  APP().innerHTML = `<div class="ct ${o.cls || ''}">
    <header class="ct-top"><div class="ct-top-in">
      <span class="ct-brand">BYMAEDUCA</span>
      <span class="ct-sub">${esc(o.sub || 'Armá tu cartera')}</span>
      <span class="ct-sp"></span>${o.actions || ''}
    </div></header>
    ${inner}
  </div>`;
}
function renderFatal(title, detail, extra) {
  frame(`<main class="ct-wrap"><p class="eyebrow">Armá tu cartera</p><h1>${esc(title)}</h1>
    <p class="lede">${esc(detail || '')}</p>
    <div class="row">${extra || ''}<a class="btn ghost" href="#/cartera">Volver</a></div></main>`);
}

/* ---------------------------------------------------------------
   4. El ejercicio (mismo modelo que arma-tu-cartera.html)
   --------------------------------------------------------------- */
const ASSETS = [
  { key: 'mm',  nm: 'Money market',        sh: 'MM',      color: 'var(--muted)' },
  { key: 'rf',  nm: 'Renta fija',          sh: 'RF',      color: 'var(--teal)'  },
  { key: 'ar',  nm: 'Acciones argentinas', sh: 'Acc. AR', color: 'var(--gold)'  },
  { key: 'etf', nm: 'CEDEAR de ETF',       sh: 'CEDEAR',  color: 'var(--green)' },
  { key: 'tip', nm: 'La acción del dato',  sh: 'Dato',    color: 'var(--plum)'  }
];
const KEYS = ASSETS.map(a => a.key);
const ORDER = ['cons', 'mod', 'agr'];
const PROFILES = {
  cons: { name: 'Conservadora', why: 'Plata con fecha cercana. La prioridad es poder usarla.',
          w: { mm: 60, rf: 30, ar: 0, etf: 10, tip: 0 } },
  mod:  { name: 'Moderada', why: 'Algo de tiempo y tolerancia a que el valor se mueva.',
          w: { mm: 25, rf: 35, ar: 10, etf: 30, tip: 0 } },
  agr:  { name: 'Agresiva', why: 'Años por delante y aguante para los años en rojo.',
          w: { mm: 10, rf: 15, ar: 20, etf: 55, tip: 0 } }
};
const PERSON = { cons: 'Conservador', mod: 'Moderado', agr: 'Agresivo' };
const BAD  = { mm: 0, rf: -10, ar: -45, etf: -39, tip: 0 };
const GOOD = { mm: 2, rf: 12,  ar: 50,  etf: 30,  tip: 0 };
const YEAR1 = BAD;

const PERFIL = [
  { eb: '1 de 3 · El horizonte', q: '¿Cuándo necesitás esta plata?', lede: '',
    opts: [['Antes de un año', 'La puedo necesitar en cualquier momento.'],
           ['Entre uno y cinco años', 'Un viaje, un auto, un posgrado.'],
           ['Más de cinco años', 'No la necesito. No la toco.']] },
  { eb: '2 de 3 · La reacción', q: 'Abrís la app y tu plata vale 25% menos. ¿Qué hacés?',
    lede: 'Lo que harías de verdad, no lo que suena mejor.',
    opts: [['Vendo todo', 'No quiero seguir viendo rojo.'],
           ['No vendo, pero no duermo', 'Aguanto y miro la pantalla todos los días.'],
           ['Compro más', 'Está más barato que ayer.']] },
  { eb: '3 de 3 · El objetivo', q: '¿Para qué la estás invirtiendo?', lede: '',
    opts: [['Que no pierda valor', 'Que dentro de un año compre lo mismo.'],
           ['Que crezca sin sustos', 'Acepto movimiento, no violencia.'],
           ['Que crezca lo más posible', 'Acepto años en rojo por la década.']] }
];

function allTo(v, to) { let t = 0; KEYS.forEach(k => { t += v[k]; v[k] = 0; }); v[to] = t; }
function half(v, from, to) { const m = v[from] / 2; v[from] -= m; v[to] += m; }
function slice(v, frac, to) {
  let t = 0, pool = 0;
  KEYS.forEach(k => { t += v[k]; if (k !== to) pool += v[k]; });
  if (pool <= 0) return;
  const take = Math.min(t * frac, pool), f = take / pool;
  KEYS.forEach(k => { if (k === to) return; const m = v[k] * f; v[k] -= m; v[to] += m; });
}
function rvTo(v, frac, to) {
  ['ar', 'etf', 'tip'].forEach(k => { if (k === to) return; const m = v[k] * frac; v[k] -= m; v[to] += m; });
}
function cashOut(v, amount, prefer) {
  let left = amount;
  (prefer || []).forEach(k => {
    if (left <= 0) return;
    const take = Math.min(v[k], left); v[k] -= take; left -= take;
  });
  if (left > 0) {
    let pool = 0; KEYS.forEach(k => { pool += v[k]; });
    if (pool <= 0) return;
    const f = Math.min(1, left / pool);
    KEYS.forEach(k => { v[k] -= v[k] * f; });
  }
}
function burn(v, frac) { KEYS.forEach(k => { v[k] -= v[k] * frac; }); }
/* Compra en la baja: un porcentaje del total de la cartera pasa a CEDEAR de
   ETF, primero desde el money market y, si no alcanza, desde la renta fija.
   (En el HTML original era "la mitad del money market": eso le daba a la
   conservadora, que tiene 60% en money market, el mejor resultado posible.) */
function buyEtf(v, frac) {
  const want = (v.mm + v.rf + v.ar + v.etf + v.tip) * frac;
  const a = Math.min(v.mm, want); v.mm -= a; v.etf += a;
  const b = Math.min(v.rf, want - a); v.rf -= b; v.etf += b;
}

const IMPREVISTO = 12000, TARJETA = 18000;

/* Años "de referencia". Cada sala juega una variación al azar de estos
   números (ver market()); los que se citan en los textos quedan fijos. */
const Y = {
  y2 : { mm: -2, rf: 8, ar: 55, etf: 26, tip: 0 },
  y3 : { mm: -2, rf: 4, ar: 7,  etf: 9,  tip: -60 },
  y4 : { mm: -1, rf: 3, ar: -8, etf: 4,  tip: -25 },
  y5 : { mm: 4,  rf: 7, ar: -5, etf: 6,  tip: -15 },
  y6 : { mm: 2,  rf: 6, ar: 18, etf: 14, tip: -10 },
  y7 : { mm: -1, rf: 5, ar: 22, etf: 17, tip: 0 },
  y8 : { mm: -1, rf: 4, ar: 28, etf: 21, tip: 0 },
  y9 : { mm: 0,  rf: 4, ar: -6, etf: -5, tip: 0 },
  y10: { mm: 0,  rf: 5, ar: 24, etf: 19, tip: 0 }
};

const ROUNDS = [
  { yr: 'Año 2', ttl: '“Se derrumba el mercado”',
    ctx: 'En TikTok dicen que hay que vender porque se viene una caída peor.',
    q: '¿Qué hacés?', neutral: 1,
    opts: [
      { t: 'Vendo todo y me paso a money market', f: v => allTo(v, 'mm') },
      { t: 'No toco nada', f: () => {} },
      { t: 'Compro: paso un 10% de la cartera a CEDEAR de ETF', f: v => buyEtf(v, 0.10) }
    ],
    years: ['y2'],
    after: 'Rebote. El índice del exterior subió 26%, igual que en 2009. Nadie avisó que la caída había terminado.' },

  { yr: 'Año 3', ttl: '“Esta acción se multiplica por tres”',
    ctx: 'Un influencer con 300 mil seguidores lo repite todos los días. Dice que tiene información.',
    q: '¿Entrás?', neutral: 2,
    opts: [
      { t: 'Pongo la mitad de mi cartera', f: v => slice(v, 0.5, 'tip') },
      { t: 'Pongo el 10%', f: v => slice(v, 0.10, 'tip') },
      { t: 'No entro', f: () => {} }
    ],
    years: ['y3'],
    after: 'La empresa presentó balance, no era lo que decía el video y la acción perdió 60%. Pudo salir al revés: no lo sabías cuando pusiste la plata.' },

  { yr: 'Año 4', ttl: 'Se rompe la notebook',
    ctx: 'Justo antes de los finales. Arreglarla cuesta $12.000 y los necesitás esta semana. El año viene flojo en el mercado.',
    q: '¿De dónde sale la plata?', neutral: 0,
    opts: [
      { t: 'Del money market', f: v => cashOut(v, IMPREVISTO, ['mm']) },
      { t: 'Vendo acciones y CEDEARs', f: v => cashOut(v, IMPREVISTO, ['etf', 'ar', 'tip']) },
      { t: 'La pago con tarjeta en cuotas', f: () => {}, post: v => cashOut(v, TARJETA, ['mm']) }
    ],
    years: ['y4'],
    after: 'Para esto existe el fondo de emergencia: no para rendir, sino para no tener que vender ni endeudarte el día que pasa algo. La cuota de la tarjeta es la más cara de las tres salidas.' },

  { yr: 'Años 5 y 6', ttl: '“Las tasas vuelan”',
    ctx: 'El money market le gana a la inflación por primera vez en años. En tu casa dicen que las acciones son una timba.',
    q: '¿Qué hacés?', neutral: 2,
    opts: [
      { t: 'Vendo todo y me paso a money market para cobrar la tasa', f: v => allTo(v, 'mm') },
      { t: 'Vendo la mitad de las acciones y los CEDEARs, y la paso a renta fija', f: v => rvTo(v, 0.5, 'rf') },
      { t: 'No toco nada', f: () => {} }
    ],
    years: ['y5', 'y6'],
    after: 'El primer año la tasa ganó. El segundo, el mercado arrancó para arriba y dejó atrás al money market.' },

  { yr: 'Años 7 y 8', ttl: '8% mensual garantizado',
    ctx: 'Te escriben por Instagram. Una financiera que no conocés ofrece 8% mensual garantizado, con capturas de gente cobrando.',
    q: '¿Qué hacés?', neutral: 2,
    opts: [
      { t: 'Pongo el 20% de mi cartera', f: v => burn(v, 0.20) },
      { t: 'Pongo el 5%, para probar', f: v => burn(v, 0.05) },
      { t: 'Lo busco en el registro de la CNV antes de poner un peso', f: () => {} }
    ],
    years: ['y7', 'y8'],
    after: 'No estaba registrada en la CNV. A los cuatro meses dejaron de pagar y la cuenta se cerró: lo que pusiste no volvió. Garantizado y alto a la vez no existe. El registro de agentes de la CNV es gratis y se consulta en dos minutos.' },

  { yr: 'Años 9 y 10', ttl: '“El mercado lleva tres años en alza”',
    ctx: 'Los títulos dicen que está caro y que la fiesta se termina. Nada de eso habla de tu cartera: hablan del mercado.',
    q: '¿Qué hacés?', neutral: 2,
    opts: [
      { t: 'Vendo todo y me paso a money market', f: v => allTo(v, 'mm') },
      { t: 'Vendo la mitad de todo y la paso a money market', f: v => slice(v, 0.5, 'mm') },
      { t: 'No toco nada', f: () => {} }
    ],
    years: ['y9', 'y10'],
    after: 'Un año en rojo y otro bueno. El tiempo solo trabaja si seguís adentro.' }
];
const HOLD = ROUNDS.map(r => r.neutral);

/* Los diez pasos que el presentador va pasando. */
const STEPS = [
  { k: 'perfil', i: 0 }, { k: 'perfil', i: 1 }, { k: 'perfil', i: 2 },
  { k: 'pick' },
  { k: 'round', i: 0 }, { k: 'round', i: 1 }, { k: 'round', i: 2 },
  { k: 'round', i: 3 }, { k: 'round', i: 4 }, { k: 'round', i: 5 }
];
const NSTEPS = STEPS.length;
const PICK_STEP = 3, FIRST_ROUND = 4;
function stepLabel(s) {
  const S = STEPS[s];
  if (!S) return '';
  if (S.k === 'perfil') return 'Perfil · ' + (S.i + 1) + ' de 3';
  if (S.k === 'pick') return 'Elegir cartera';
  return 'Ronda ' + (S.i + 1) + ' de 6 · ' + ROUNDS[S.i].yr;
}
function stepTitle(s) {
  const S = STEPS[s];
  if (!S) return '';
  if (S.k === 'perfil') return PERFIL[S.i].q;
  if (S.k === 'pick') return 'Elegí tu cartera';
  return ROUNDS[S.i].ttl.replace(/[“”]/g, '') + ' · ' + ROUNDS[S.i].q;
}
function stepOpts(s) {
  const S = STEPS[s];
  if (!S) return [];
  if (S.k === 'perfil') return PERFIL[S.i].opts.map(o => o[0]);
  if (S.k === 'pick') return ORDER.map(k => PROFILES[k].name);
  return ROUNDS[S.i].opts.map(o => o.t);
}

const CATS = [
  { k: 'cons',  t: 'Mejor cartera conservadora' },
  { k: 'mod',   t: 'Mejor cartera moderada' },
  { k: 'agr',   t: 'Mejor cartera agresiva' },
  { k: 'total', t: 'Mejor cartera de la sala' }
];

/* ---- Azar por sala ----
   Todos los de una misma sala viven el mismo mercado (como en la vida real):
   así lo que separa a los jugadores son las decisiones y, a igualdad, la
   velocidad. Cada sala nueva sortea otro mercado alrededor de los años de
   referencia. Quedan fijos los números que citan los textos (año 1, el 26%
   del CEDEAR en el año 2 y el −60% de la acción del dato) y el signo de cada
   año, para que los textos de "qué pasó" sigan siendo ciertos. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const BAND = { mm: 1, rf: 2, ar: 7, etf: 5, tip: 0 };
const mkCache = {};
function market(seed) {
  seed = seed | 0;
  if (mkCache[seed]) return mkCache[seed];
  const R = rng(seed);
  const mk = ROUNDS.map((r, ri) => r.years.map(yk => {
    const y = Y[yk], o = {};
    KEYS.forEach(k => {
      const b = y[k];
      if (!seed || (ri === 0 && k === 'etf') || k === 'tip') { o[k] = b; return; }
      let v = b + (R() * 2 - 1) * BAND[k];
      if (k !== 'mm') { if (b < 0) v = Math.min(v, -1); if (b > 0) v = Math.max(v, 1); }
      o[k] = Math.round(v * 10) / 10;
    });
    return o;
  }));
  mkCache[seed] = mk;
  return mk;
}

function startVec(w) { const v = {}; KEYS.forEach(k => { v[k] = 100000 * (w[k] || 0) / 100; }); return v; }
function apply(v, r) { KEYS.forEach(k => { v[k] *= (1 + (r[k] || 0) / 100); }); }
function total(v) { let t = 0; KEYS.forEach(k => { t += v[k]; }); return t; }
function floor0(v) { KEYS.forEach(k => { if (v[k] < 0) v[k] = 0; }); }
function oneYear(w, r) { let t = 0; KEYS.forEach(k => { t += (w[k] || 0) / 100 * (r[k] || 0); }); return t; }

function run(w, choices, mk) {
  const v = startVec(w), path = [100000];
  apply(v, YEAR1); path.push(total(v));
  for (let i = 0; i < ROUNDS.length; i++) {
    const c = choices[i];
    if (c === null || c === undefined) break;
    const op = ROUNDS[i].opts[c];
    op.f(v); floor0(v);
    mk[i].forEach(y => { apply(v, y); path.push(total(v)); });
    if (op.post) { op.post(v); floor0(v); path[path.length - 1] = total(v); }
  }
  return { v: v, path: path, end: total(v) };
}

function bestOf(k, mk) {
  let best = -1;
  for (let n = 0; n < 729; n++) {
    const c = []; let x = n;
    for (let i = 0; i < 6; i++) { c.push(x % 3); x = Math.floor(x / 3); }
    const r = run(PROFILES[k].w, c, mk).end;
    if (r > best) best = r;
  }
  return best;
}
/* Un mercado sirve si el mejor resultado posible sigue el orden
   agresiva > moderada > conservadora, con un margen visible. */
function seedOk(seed) {
  const mk = market(seed);
  const a = bestOf('agr', mk), m = bestOf('mod', mk), c = bestOf('cons', mk);
  return a > m + 1500 && m > c + 1500;
}
function pickSeed() {
  for (let i = 0; i < 40; i++) {
    const s = 1 + Math.floor(Math.random() * 2147483000);
    if (seedOk(s)) return s;
  }
  return 0;   // los años de referencia, sin azar
}

function decideProfile(ans) {
  const a = ans.map(x => (x === null || x === undefined) ? 1 : x);
  const h = a[0], r = a[1], o = a[2], raw = h + r + o;
  let key = raw <= 1 ? 'cons' : (raw <= 4 ? 'mod' : 'agr'), note = null;
  if (h === 0 && key !== 'cons') {
    key = 'cons'; note = { mk: 'El horizonte manda', tx: 'Podés necesitar la plata en cualquier momento. Eso pesa más que el aguante.' };
  } else if (h === 1 && key === 'agr') {
    key = 'mod'; note = { mk: 'Ajustado por plazo', tx: 'Con fecha dentro de cinco años, la mezcla baja un escalón.' };
  } else if (r === 0 && key !== 'cons') {
    note = { mk: 'Ojo', tx: 'Dijiste que venderías si cae. Mirá el año malo antes de elegir.' };
  }
  return { key: key, note: note };
}

/* ---- Resultados de toda la sala (los calcula el panel o el control) ----
   Reglas del ranking:
   - Gana la plata final. A igual plata, el que contestó más rápido
     (suma de los tiempos de la elección de cartera y las seis rondas).
   - Quien no contesta una ronda se toma como "no hizo nada" (la opción
     neutral) para que su cartera siga andando, pero no puede ganar: para
     entrar al ranking hay que haber elegido cartera y contestado las seis. */
function computeResults(c, players, answers) {
  const mk = market((c.live && c.live.seed) || c.seed || 0);
  const pids = {};
  Object.keys(players || {}).forEach(p => { pids[p] = 1; });
  Object.keys(answers || {}).forEach(sk => Object.keys(answers[sk] || {}).forEach(p => { pids[p] = 1; }));
  const A = (s, p) => ((answers || {})['s' + s] || {})[p] || null;
  const dist = [];
  for (let s = 0; s < NSTEPS; s++) {
    const d = [0, 0, 0], all = (answers || {})['s' + s] || {};
    Object.keys(all).forEach(p => { const x = all[p].c; if (d[x] !== undefined) d[x]++; });
    dist.push(d);
  }
  const rows = Object.keys(pids).map(p => {
    const per = [0, 1, 2].map(s => { const a = A(s, p); return a ? a.c : null; });
    const prof = decideProfile(per);
    const a3 = A(PICK_STEP, p);
    const cart = a3 && ORDER[a3.c] ? ORDER[a3.c] : prof.key;
    let time = a3 ? (a3.ms || 0) : 0, miss = a3 ? 0 : 1;
    const picks = ROUNDS.map((R, i) => {
      const a = A(FIRST_ROUND + i, p);
      if (a && R.opts[a.c]) { time += (a.ms || 0); return a.c; }
      miss++; return R.neutral;
    });
    const res = run(PROFILES[cart].w, picks, mk);
    return {
      p: p, n: (players && players[p] && players[p].n) || 'Sin nombre',
      per: per, sugg: prof.key, cart: cart, picked: !!a3, picks: picks,
      answered: ROUNDS.map((R, i) => !!A(FIRST_ROUND + i, p)),
      v: Math.round(res.end), t: time, miss: miss, el: miss === 0
    };
  });
  const sorter = (a, b) => b.v - a.v || a.t - b.t || String(a.n).localeCompare(String(b.n));
  const cats = {};
  ORDER.forEach(k => { cats[k] = rows.filter(r => r.el && r.cart === k).sort(sorter); });
  cats.total = rows.filter(r => r.el).sort(sorter);
  const prof = { cons: 0, mod: 0, agr: 0 }, cart = { cons: 0, mod: 0, agr: 0 };
  let nPerfil = 0, nCart = 0;
  rows.forEach(r => {
    if (r.per.some(x => x !== null)) { prof[r.sugg]++; nPerfil++; }
    if (r.picked) { cart[r.cart]++; nCart++; }
  });
  return { mk: mk, rows: rows, cats: cats, dist: dist, prof: prof, cart: cart, nPerfil: nPerfil, nCart: nCart };
}

/* Plata promedio de cada cartera después de la ronda ri (para la pantalla). */
function averagesAfter(res, ri) {
  const out = {};
  ORDER.forEach(k => {
    const rs = res.rows.filter(r => r.picked && r.cart === k);
    if (!rs.length) { out[k] = null; return; }
    let s = 0;
    rs.forEach(r => { s += run(PROFILES[k].w, r.picks.slice(0, ri + 1), res.mk).end; });
    out[k] = { v: s / rs.length, n: rs.length };
  });
  return out;
}

/* ---------------------------------------------------------------
   5. Piezas visuales compartidas
   --------------------------------------------------------------- */
function barHTML(w, cls) {
  let h = '<div class="bar' + (cls ? ' ' + cls : '') + '" aria-hidden="true">';
  ASSETS.forEach(a => {
    const v = w[a.key] || 0; if (v <= 0) return;
    h += '<i style="width:' + v + '%;background:' + a.color + '"></i>';
  });
  return h + '</div>';
}
function mixLine(w) {
  return ASSETS.filter(a => (w[a.key] || 0) > 0).map(a => a.nm + ' ' + w[a.key] + '%').join(' · ');
}
function pickCard(k, opts) {
  const p = PROFILES[k], o = opts || {};
  return `<${o.tag || 'div'} class="pick" ${o.attrs || ''}>
    <div class="pick-hd"><b>${esc(p.name)}</b>${o.badge ? '<span class="badge">' + esc(o.badge) + '</span>' : ''}</div>
    ${barHTML(p.w)}
    <div class="mixline">${esc(mixLine(p.w))}</div>
    <div class="ex"><span class="neg">Año malo <b>${pct(oneYear(p.w, BAD))}</b></span>
      <span class="pos">Año bueno <b>${pct(oneYear(p.w, GOOD))}</b></span></div>
  </${o.tag || 'div'}>`;
}
function nowMix(v) {
  const tot = total(v), w = {};
  KEYS.forEach(k => { w[k] = tot > 0 ? Math.round(v[k] / tot * 100) : 0; });
  return w;
}
function distBars(counts, labels, correct) {
  const n = counts.reduce((a, b) => a + b, 0);
  const mx = Math.max.apply(null, counts.concat([1]));
  return `<div class="dist">${labels.map((l, i) => {
    const c = counts[i] || 0, p = n ? Math.round(c / n * 100) : 0;
    return `<div class="dist-row ${c === mx && c > 0 ? 'top' : ''}">
      <div class="dist-hd"><span class="dist-k">${'ABC'[i]}</span><span class="dist-t">${esc(l)}</span>
        <span class="dist-v">${p}%<small>${c}</small></span></div>
      <div class="dist-track"><div class="dist-fill" style="width:${n ? c / mx * 100 : 0}%"></div></div>
    </div>`;
  }).join('')}</div>`;
}
/* Rendimientos del período, para mostrar "qué pasó" con números. */
function yearsTable(ri, mk) {
  const yrs = mk[ri];
  const labels = ROUNDS[ri].years.map(y => 'Año ' + y.slice(1));
  const keys = ['mm', 'rf', 'ar', 'etf'].concat(yrs.some(y => y.tip) ? ['tip'] : []);
  return `<table class="yt"><thead><tr><th></th>${keys.map(k =>
      '<th>' + esc(ASSETS.find(a => a.key === k).sh) + '</th>').join('')}</tr></thead>
    <tbody>${yrs.map((y, i) => `<tr><th>${labels[i]}</th>${keys.map(k =>
      '<td class="' + (y[k] < 0 ? 'neg' : 'pos') + '">' + pct(y[k]) + '</td>').join('')}</tr>`).join('')}</tbody></table>`;
}

function chart(mine, hold) {
  const W = 340, H = 180, L = 8, R = 54, T = 14, B = 24;
  const all = mine.concat(hold).concat([100000]);
  let lo = Math.min.apply(null, all), hi = Math.max.apply(null, all);
  const pad = (hi - lo) * 0.14 || 10000; lo -= pad; hi += pad;
  const n = mine.length - 1;
  const X = i => L + (W - L - R) * (i / n);
  const Yc = v => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  const pts = a => a.map((v, i) => X(i) + ',' + Yc(v).toFixed(1)).join(' ');
  const base = Yc(100000);
  let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="height:auto;display:block" role="img" aria-label="Evolución a diez años">';
  s += '<line x1="' + L + '" y1="' + base.toFixed(1) + '" x2="' + (W - R) + '" y2="' + base.toFixed(1) + '" stroke="var(--line)" stroke-width="1.5" stroke-dasharray="2 3"/>';
  s += '<polyline points="' + pts(hold) + '" fill="none" stroke="var(--muted)" stroke-width="1.8" stroke-dasharray="5 4" stroke-linejoin="round"/>';
  s += '<polyline points="' + pts(mine) + '" fill="none" stroke="var(--teal)" stroke-width="2.8" stroke-linejoin="round" stroke-linecap="round"/>';
  mine.forEach((v, i) => { s += '<circle cx="' + X(i) + '" cy="' + Yc(v).toFixed(1) + '" r="' + (i === n ? 4.5 : 2.6) + '" fill="var(--teal)"/>'; });
  s += '<circle cx="' + X(n) + '" cy="' + Yc(hold[n]).toFixed(1) + '" r="3" fill="var(--muted)"/>';
  const ym = Yc(mine[n]), yh = Yc(hold[n]);
  let a, b2;
  if (Math.abs(ym - yh) >= 13) { a = ym + 3.5; b2 = yh + 3.5; }
  else if (mine[n] >= hold[n]) { a = Math.min(ym, yh) - 4; b2 = Math.max(ym, yh) + 10; }
  else { a = Math.max(ym, yh) + 10; b2 = Math.min(ym, yh) - 4; }
  a = Math.max(10, Math.min(H - B - 2, a)); b2 = Math.max(10, Math.min(H - B - 2, b2));
  s += '<text x="' + (X(n) + 7) + '" y="' + a.toFixed(1) + '" font-size="10" font-weight="700" fill="var(--teal)" font-family="system-ui,sans-serif">' + fmt(mine[n]) + '</text>';
  s += '<text x="' + (X(n) + 7) + '" y="' + b2.toFixed(1) + '" font-size="10" fill="var(--muted)" font-family="system-ui,sans-serif">' + fmt(hold[n]) + '</text>';
  [[0, 'Inicio'], [2, 'Año 2'], [4, '4'], [6, '6'], [8, '8'], [n, 'Año ' + n]].forEach(t => {
    if (t[0] > n) return;
    s += '<text x="' + X(t[0]) + '" y="' + (H - 6) + '" font-size="9" fill="var(--muted)" text-anchor="' + (t[0] === 0 ? 'start' : (t[0] === n ? 'end' : 'middle')) + '" font-family="system-ui,sans-serif">' + t[1] + '</text>';
  });
  return s + '</svg>';
}
function cmpBars(rows) {
  const devs = rows.map(r => r.v - 100000);
  const span = Math.max.apply(null, devs.map(Math.abs)) * 1.12 || 1000;
  let h = '<div class="cmp">';
  rows.forEach((r, i) => {
    const d = devs[i], w = Math.abs(d) / span * 50, left = d >= 0 ? 50 : 50 - w;
    h += '<div class="cmp-row' + (r.me ? ' me' : '') + '">' +
      '<div class="cmp-top"><span class="n">' + esc(r.n) + '</span>' +
      '<span class="v ' + (d < 0 ? 'neg' : 'pos') + '">' + fmt(r.v) + '</span></div>' +
      '<div class="cmp-track"><div class="cmp-mark"></div>' +
      '<div class="cmp-fill" style="left:' + left.toFixed(1) + '%;width:' + w.toFixed(1) + '%"></div></div></div>';
  });
  return h + '<div class="cmp-axis"><span>Perdió poder de compra</span><span>Lo ganó</span></div></div>';
}

/* Análisis final de una persona: igual al del HTML original. */
function finalHTML(cart, picks, mk) {
  const W = PROFILES[cart].w;
  const mine = run(W, picks, mk), hold = run(W, HOLD, mk), diff = mine.end - hold.end;
  let h = '<div class="card"><h3>Diez años después</h3>' +
    '<p class="fine" style="margin-bottom:4px">Cartera ' + esc(PROFILES[cart].name.toLowerCase()) +
    '. Todo en poder de compra: la inflación ya está descontada.</p>' +
    chart(mine.path, hold.path) +
    '<div class="legend"><span><i style="background:var(--teal)"></i>Con tus decisiones</span>' +
    '<span><i class="dash"></i>Sin tocarla nunca</span></div>' +
    '<div class="money" style="margin-top:12px"><span class="from">$100.000</span>' +
    '<span class="arrow" aria-hidden="true">→</span>' +
    '<span class="to ' + (mine.end < 100000 ? 'neg' : 'pos') + '">' + fmt(mine.end) + '</span>' +
    '<span class="delta ' + (mine.end < 100000 ? 'neg' : 'pos') + '">' + pct(mine.end / 1000 - 100) + '</span></div>' +
    '<p class="fine" style="margin:0">' +
    (Math.abs(diff) < 500 ? 'Tus decisiones no cambiaron el resultado.'
      : diff > 0 ? 'Tus decisiones sumaron ' + fmt(diff) + '.' : 'Tus decisiones costaron ' + fmt(Math.abs(diff)) + '.') +
    '</p></div>';
  const rows = [{ n: 'Tu cartera, con tus decisiones', v: mine.end, me: true }];
  ORDER.forEach(k => {
    rows.push({ n: PROFILES[k].name + ', sin tocarla' + (k === cart ? ' (la tuya)' : ''),
                v: k === cart ? hold.end : run(PROFILES[k].w, HOLD, mk).end });
  });
  h += '<div class="card"><h3>Contra las otras carteras</h3>' +
       '<p class="fine" style="margin-bottom:12px">Los mismos diez años. El centro es el punto de partida.</p>' +
       cmpBars(rows) + '</div>';
  h += '<div class="card"><h3>Qué pesó cada decisión</h3><div class="ledger">';
  ROUNDS.forEach((R, i) => {
    const alt = picks.slice(); alt[i] = R.neutral;
    const d = mine.end - run(W, alt, mk).end, small = Math.abs(d) < 400;
    h += '<div class="ledger-row"><div class="t"><b>' + esc(R.opts[picks[i]].t) + '</b>' + esc(R.yr) + ' · ' +
         esc(R.ttl.replace(/[“”]/g, '')) + '</div><div class="v ' + (small ? '' : (d > 0 ? 'pos' : 'neg')) + '">' +
         (small ? 'sin cambios' : (d > 0 ? '+' : '−') + fmt(Math.abs(d))) + '</div></div>';
  });
  h += '</div></div>';
  h += '<div class="card quote"><p class="q">Lo que elegís de antemano es la mezcla, no el año.</p>' +
       '<p class="s">96 años del S&amp;P 500: 71 positivos, 25 negativos, ninguno anunciado.</p></div>';
  return h;
}

const FOOT = `<p class="fine ct-legal">Supuestos con fines educativos, sin comisiones ni impuestos. Todo está medido en
  poder de compra. El CEDEAR de ETF usa los extremos del S&amp;P 500 de 2004–2025: −39% en 2008 y +30% en 2024.
  Las demás variaciones son del ejercicio, no datos históricos, y cada sala juega una variante al azar.
  Ejercicio educativo de BYMAEDUCA: no es una recomendación de inversión.</p>`;

/* ---------------------------------------------------------------
   6. Alta, portada y borrado
   --------------------------------------------------------------- */
const DEF_SECS = 25;
const PICK_EXTRA = 15;        // la elección de cartera tiene más para leer
const stepSecs = (c, s) => (c.secs || DEF_SECS) + (s === PICK_STEP ? PICK_EXTRA : 0);

function lobbyLive(seed, secs) {
  return { st: 'lobby', step: -1, sk: '', at: 0, secs: secs || DEF_SECS, seed: seed, rc: -1, rat: 0 };
}

async function createCartera(title) {
  const code = await window.ENC.freeCode(6);
  const t = (title || '').trim() || 'Armá tu cartera';
  const seed = pickSeed();
  await db.ref('carteras/' + code).set({
    owner: uid, title: t, createdAt: firebase.database.ServerValue.TIMESTAMP,
    secs: DEF_SECS, seed: seed, live: lobbyLive(seed, DEF_SECS)
  });
  await db.ref('cmine/' + uid + '/' + code).set({ title: t, at: firebase.database.ServerValue.TIMESTAMP }).catch(() => {});
  return code;
}
function deleteCartera(code) {
  return Promise.all([
    db.ref('cans/' + code).remove(),
    db.ref('cplayers/' + code).remove(),
    db.ref('crank/' + code).remove(),
    db.ref('cmine/' + uid + '/' + code).remove()
  ]).then(() => db.ref('carteras/' + code).remove());
}
function fmtDate(ms) {
  if (!ms) return '';
  try { return new Date(ms).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch (e) { return ''; }
}

function renderHome() {
  frame(`<main class="ct-wrap">
    <p class="eyebrow">Modo competitivo · Ejercicio guiado</p>
    <h1>Armá tu cartera</h1>
    <p class="lede">Tres preguntas de perfil, una cartera y diez años de mercado, jugados por toda la sala a la vez.
      Vos pasás cada paso desde el celular. Al final, ranking por cartera y de la sala, con cuenta regresiva.</p>
    <div class="card">
      <h3>Crear una sala</h3>
      <label class="fine" for="ttl">Nombre (lo ve el público)</label>
      <input class="in" id="ttl" maxlength="80" placeholder="Armá tu cartera · charla del viernes">
      <div class="row"><button class="btn" id="go">Crear la sala</button>
        <a class="btn ghost" href="#/comp">Volver al modo competitivo</a></div>
    </div>
    <h3 style="margin-top:26px">Mis salas</h3>
    <div id="mine"><p class="fine">Cargando…</p></div>
  </main>`);
  $('go').onclick = function () {
    this.disabled = true; this.textContent = 'Creando…';
    createCartera($('ttl').value)
      .then(code => { location.hash = '#/cartera/host/' + code; })
      .catch(e => { this.disabled = false; this.textContent = 'Crear la sala'; toast(dbMsg(e)); });
  };
  db.ref('cmine/' + uid).limitToLast(30).get().then(snap => {
    const box = $('mine'); if (!box) return;
    const all = snap.val() || {};
    const list = Object.keys(all).map(c => [c, all[c]]).sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
    if (!list.length) { box.innerHTML = '<p class="fine">Todavía no creaste ninguna.</p>'; return; }
    box.innerHTML = list.map(([c, m]) => `<div class="card mini">
        <div style="flex:1;min-width:160px"><b>${esc(m.title || 'Armá tu cartera')}</b>
          <div class="fine">${esc(c)} · ${esc(fmtDate(m.at))}</div></div>
        <a class="btn small" href="#/cartera/host/${esc(c)}">Abrir el panel</a>
        <a class="btn small ghost" href="#/cartera/ctrl/${esc(c)}">Control</a>
        <button class="btn small ghost" data-del="${esc(c)}">Borrar</button></div>`).join('');
    box.querySelectorAll('[data-del]').forEach(b => {
      b.onclick = () => {
        if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = '¿Seguro? Tocá de nuevo'; return; }
        b.disabled = true;
        deleteCartera(b.dataset.del).then(() => renderHome()).catch(e => toast(dbMsg(e)));
      };
    });
  }).catch(() => { const box = $('mine'); if (box) box.innerHTML = '<p class="fine">No se pudo leer la lista.</p>'; });
}

/* ---------------------------------------------------------------
   7. Núcleo del anfitrión: lo comparten el panel proyectado y el control
      del celular. Escucha la sala, calcula los resultados y mueve el juego.
   --------------------------------------------------------------- */
function hostCore(code, paint) {
  const H = { code: code, c: null, players: {}, ans: {}, srvOff: 0, res: null, dirty: true, autoT: null, autoKey: '' };
  const cref = db.ref('carteras/' + code);
  const lref = cref.child('live');
  let pend = null;
  const soon = () => { if (pend) return; pend = later(() => { pend = null; paint(); }, 120); };

  on(cref, 'value', snap => {
    if (!snap.exists()) return renderFatal('Esa sala no existe', 'El código ' + code + ' no corresponde a ningún "Armá tu cartera".');
    const c = snap.val();
    if (c.owner !== uid) return renderFatal('Esta pantalla es del presentador',
      'El panel y el control los abre solo quien creó la sala. Si querés jugar, entrá con el código.',
      `<a class="btn" href="#/${esc(code)}">Entrar a jugar</a>`);
    H.c = c; H.dirty = true;
    armAuto();
    paint();
  }, e => renderFatal('No se pudo leer la sala', dbMsg(e)));
  on(db.ref('.info/serverTimeOffset'), 'value', s => { H.srvOff = s.val() || 0; });
  on(db.ref('cplayers/' + code), 'value', s => { H.players = s.val() || {}; H.dirty = true; soon(); });
  on(db.ref('cans/' + code), 'value', s => { H.ans = s.val() || {}; H.dirty = true; soon(); });

  H.live = () => (H.c && H.c.live) || lobbyLive(0, DEF_SECS);
  H.now = () => Date.now() + H.srvOff;
  H.results = () => {
    if (H.dirty || !H.res) { H.res = computeResults(H.c, H.players, H.ans); H.dirty = false; }
    return H.res;
  };
  H.remaining = () => {
    const L = H.live();
    if (L.st !== 'q' || !L.at) return 0;
    return Math.max(0, (L.secs || DEF_SECS) * 1000 - (H.now() - L.at));
  };
  H.nPlayers = () => Object.keys(H.players).length;
  H.nAnswers = s => Object.keys(H.ans['s' + s] || {}).length;

  /* Cierre automático al terminar el reloj. Lo arman el panel y el control;
     la transacción hace que solo uno lo aplique. */
  function armAuto() {
    const L = H.live();
    const key = L.st + ':' + L.step + ':' + L.at;
    if (key === H.autoKey) return;
    H.autoKey = key;
    clearTimeout(H.autoT);
    if (L.st === 'q' && L.at) {
      const left = (L.secs || DEF_SECS) * 1000 - (H.now() - L.at);
      H.autoT = later(() => H.close(), Math.max(200, left + 1000));
    }
  }

  const fail = e => toast(dbMsg(e));
  const TS = () => firebase.database.ServerValue.TIMESTAMP;

  H.start = step => {
    const c = H.c, secs = stepSecs(c, step);
    return lref.update({ st: 'q', step: step, sk: 's' + step, at: TS(), secs: secs,
                         seed: (c.live && c.live.seed) || c.seed || 0, rc: -1, rat: 0 }).catch(fail);
  };
  H.close = () => lref.transaction(L => {
    if (!L || L.st !== 'q') return;      // nada que cerrar: se cancela
    L.st = 'x';
    return L;
  }).catch(fail);
  H.showStep = step => lref.update({ st: 'x', step: step, sk: 's' + step, rc: -1, rat: 0 }).catch(fail);

  H.publish = done => {
    const r = H.results();
    const pos = {};
    ['cons', 'mod', 'agr', 'total'].forEach(k => r.cats[k].forEach((row, i) => {
      pos[row.p] = pos[row.p] || {};
      pos[row.p][k === 'total' ? 't' : 'c'] = i + 1;
    }));
    const sc = {};
    r.rows.slice(0, 600).forEach(row => {
      const p = pos[row.p] || {};
      sc[row.p] = { k: row.cart, v: row.v, c: p.c || 0, nc: r.cats[row.cart].length,
                    t: p.t || 0, nt: r.cats.total.length, m: row.miss };
    });
    const top = {};
    ['cons', 'mod', 'agr', 'total'].forEach(k => {
      top[k] = r.cats[k].slice(0, 10).map(x => ({ n: x.n, v: x.v, t: x.t, k: x.cart }));
    });
    return db.ref('crank/' + code).set({ at: TS(), done: !!done, n: r.rows.length, top: top, sc: sc }).catch(fail);
  };

  H.next = () => {
    const L = H.live();
    if (L.st === 'lobby') return H.start(0);
    if (L.st === 'q') return H.close();
    if (L.st === 'x') {
      if (L.step < NSTEPS - 1) return H.start(L.step + 1);
      return H.publish(false).then(() => lref.update({ st: 'rank', rc: 0, rat: TS() })).catch(fail);
    }
    if (L.st === 'rank') {
      if (L.rc < CATS.length - 1) return lref.update({ rc: L.rc + 1, rat: TS() }).catch(fail);
      return H.publish(true).then(() => lref.update({ st: 'end' })).catch(fail);
    }
  };
  H.prev = () => {
    const L = H.live();
    if (L.st === 'q' || L.st === 'x') {
      if (L.step <= 0) return lref.update(lobbyLive(L.seed, L.secs)).catch(fail);
      return H.showStep(L.step - 1);
    }
    if (L.st === 'rank') {
      if (L.rc > 0) return lref.update({ rc: L.rc - 1, rat: 0 }).catch(fail);
      return H.showStep(NSTEPS - 1);
    }
    if (L.st === 'end') return lref.update({ st: 'rank', rc: CATS.length - 1, rat: 0 }).catch(fail);
  };
  H.reopen = () => { const L = H.live(); if (L.st === 'x' || L.st === 'q') return H.start(L.step); };
  H.nextLabel = () => {
    const L = H.live();
    if (L.st === 'lobby') return 'Empezar';
    if (L.st === 'q') return 'Cerrar ya';
    if (L.st === 'x') return L.step < NSTEPS - 1 ? 'Siguiente: ' + stepLabel(L.step + 1).split(' · ')[0] : 'Ir a los rankings';
    if (L.st === 'rank') return L.rc < CATS.length - 1 ? 'Revelar: ' + CATS[L.rc + 1].t.replace('Mejor cartera ', '') : 'Terminar';
    return 'Terminado';
  };
  H.setSecs = secs => cref.update({ secs: secs }).catch(fail);
  H.reset = () => {
    const seed = pickSeed();
    return Promise.all([db.ref('cans/' + code).remove(), db.ref('crank/' + code).remove()])
      .then(() => cref.update({ seed: seed, live: lobbyLive(seed, (H.c && H.c.secs) || DEF_SECS) }))
      .then(() => toast('Sala reiniciada. Mercado nuevo.')).catch(fail);
  };
  H.csv = () => {
    const r = H.results();
    const posC = {}, posT = {};
    ORDER.forEach(k => r.cats[k].forEach((x, i) => { posC[x.p] = i + 1; }));
    r.cats.total.forEach((x, i) => { posT[x.p] = i + 1; });
    const head = ['Nombre', 'Perfil sugerido', 'Cartera', 'P1 horizonte', 'P2 reacción', 'P3 objetivo']
      .concat(ROUNDS.map((R, i) => 'R' + (i + 1) + ' ' + R.yr))
      .concat(['Tiempo (s)', 'Valor final', 'Puesto en su cartera', 'Puesto en la sala', 'En el ranking']);
    const rows = [head].concat(r.rows.slice().sort((a, b) => b.v - a.v).map(x => [
      x.n, PERSON[x.sugg], x.picked ? PROFILES[x.cart].name : PROFILES[x.cart].name + ' (no eligió)']
      .concat(x.per.map((c, i) => c === null ? '' : PERFIL[i].opts[c][0]))
      .concat(x.picks.map((c, i) => (x.answered[i] ? '' : '(sin respuesta) ') + ROUNDS[i].opts[c].t))
      .concat([(x.t / 1000).toFixed(1).replace('.', ','), x.v, posC[x.p] || '', posT[x.p] || '',
               x.el ? 'Sí' : 'No (faltaron ' + x.miss + ')'])));
    const slug = String((H.c && H.c.title) || 'cartera').toLowerCase().normalize('NFD')
      .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cartera';
    download(slug + '-' + code + '.csv', csvRows(rows), 'text/csv;charset=utf-8');
  };
  return H;
}

/* ---------------------------------------------------------------
   8. Panel proyectado (computadora)
   --------------------------------------------------------------- */
function renderHost(code) {
  const playUrl = baseUrl() + '#/' + code;
  const ctrlUrl = baseUrl() + '#/cartera/ctrl/' + code;
  frame(`<div class="hst">
      <div class="ct-stage" id="ct-stage"><p class="fine">Cargando…</p></div>
      <div class="hbar">
        <button class="btn ghost" id="bprev">← Anterior</button>
        <button class="btn ghost" id="breopen">Reabrir</button>
        <span class="ct-sp"></span>
        <span class="hcount" id="hcount"></span>
        <button class="btn" id="bnext">…</button>
      </div>
    </div>
    <div class="modal" id="mctl" hidden><div class="modal-in">
      <h3>Control desde el celular</h3>
      <p class="fine">Escanealo con tu teléfono. La primera vez te pide usuario y contraseña. Este QR es solo para vos.</p>
      <div id="qrc" class="qrbox"></div>
      <p class="fine mono">${esc(ctrlUrl)}</p>
      <div class="row"><button class="btn small ghost" id="cpc">Copiar link</button><button class="btn small" id="xctl">Cerrar</button></div>
    </div></div>
    <div class="modal" id="mset" hidden><div class="modal-in">
      <h3>Ajustes</h3>
      <label class="fine" for="secs">Segundos por pregunta (la elección de cartera suma ${PICK_EXTRA})</label>
      <select class="in" id="secs">${[15, 20, 25, 30, 40, 50, 60].map(s => `<option value="${s}">${s} segundos</option>`).join('')}</select>
      <div class="row" style="margin-top:16px"><button class="btn small ghost" id="breset">Reiniciar la sala</button>
        <button class="btn small ghost" id="bdel">Borrar la sala</button></div>
      <p class="fine" style="margin-top:8px">Reiniciar borra las respuestas, conserva a los anotados y sortea un mercado nuevo.</p>
      <div class="row"><button class="btn small" id="xset">Cerrar</button></div>
    </div></div>`, {
    cls: 'is-host light',
    sub: 'Armá tu cartera · <code>' + code + '</code>',
    actions: `<button class="btn small ghost" id="bpres">Presentar</button>
      <button class="btn small ghost" id="bctl">Control desde el celular</button>
      <button class="btn small ghost" id="bcsv">CSV</button>
      <button class="btn small ghost" id="bset">Ajustes</button>
      <a class="btn small ghost" href="#/cartera">Salir</a>`
  });
  // el subtítulo trae el código con formato
  document.querySelector('.ct-sub').innerHTML = 'Armá tu cartera · <span class="mono">' + esc(code) + '</span>';

  let lastSig = '', qrDone = false;
  const H = hostCore(code, paint);

  $('bnext').onclick = () => H.next();
  $('bprev').onclick = () => H.prev();
  $('breopen').onclick = () => H.reopen();
  $('bcsv').onclick = () => H.csv();
  $('bpres').onclick = () => {
    document.body.classList.add('present');
    try { document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(() => {}); } catch (e) {}
  };
  $('bctl').onclick = () => {
    $('mctl').hidden = false;
    if (!qrDone && window.QRCode) {
      new QRCode($('qrc'), { text: ctrlUrl, width: 200, height: 200, colorDark: '#242C4F', colorLight: '#ffffff',
                             correctLevel: QRCode.CorrectLevel.M });
      qrDone = true;
    }
  };
  $('xctl').onclick = () => { $('mctl').hidden = true; };
  $('cpc').onclick = () => copy(ctrlUrl);
  $('bset').onclick = () => { $('mset').hidden = false; $('secs').value = String((H.c && H.c.secs) || DEF_SECS); };
  $('xset').onclick = () => { $('mset').hidden = true; };
  $('secs').onchange = e => H.setSecs(parseInt(e.target.value, 10) || DEF_SECS);
  $('breset').onclick = function () {
    if (this.dataset.sure !== '1') { this.dataset.sure = '1'; this.textContent = '¿Seguro? Tocá de nuevo'; return; }
    this.dataset.sure = ''; this.textContent = 'Reiniciar la sala';
    H.reset(); $('mset').hidden = true;
  };
  $('bdel').onclick = function () {
    if (this.dataset.sure !== '1') { this.dataset.sure = '1'; this.textContent = '¿Seguro? Se borra todo'; return; }
    deleteCartera(code).then(() => { location.hash = '#/cartera'; }).catch(e => toast(dbMsg(e)));
  };

  window.ENC.navKeys(e => {
    const t = e.target;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); H.next(); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); H.prev(); }
    else if ((e.key === ' ' || e.key === 'Spacebar') && H.live().st === 'q') { e.preventDefault(); H.close(); }
    else if (e.key === 'Escape') document.body.classList.remove('present');
  });

  /* Reloj y cuenta regresiva: repinta solo si cambió algo visible. */
  every(() => {
    const L = H.live();
    if (L.st === 'q') {
      const ms = H.remaining(), s = Math.ceil(ms / 1000);
      const num = $('tnum'), fill = $('tfill');
      if (num) { num.textContent = s; num.classList.toggle('warn', s <= 5); }
      if (fill) { fill.style.width = Math.max(0, Math.min(100, ms / ((L.secs || DEF_SECS) * 1000) * 100)) + '%'; fill.classList.toggle('warn', s <= 5); }
    } else if (L.st === 'rank') paint();
  }, 150);

  function paint() {
    if (!H.c || !$('ct-stage')) return;
    const L = H.live();
    const html = stageHTML(L);
    if (html !== lastSig) {
      lastSig = html;
      $('ct-stage').innerHTML = html;
      const qr = $('qrj');
      if (qr && window.QRCode) {
        new QRCode(qr, { text: playUrl, width: 300, height: 300, colorDark: '#242C4F', colorLight: '#ffffff',
                         correctLevel: QRCode.CorrectLevel.M });
      }
    }
    $('bnext').textContent = H.nextLabel();
    $('bnext').disabled = L.st === 'end';
    $('bprev').disabled = L.st === 'lobby';
    $('breopen').hidden = !(L.st === 'x');
    const n = H.nPlayers();
    $('hcount').textContent = (L.st === 'q' || L.st === 'x')
      ? H.nAnswers(L.step) + ' de ' + n + ' respondieron'
      : n + (n === 1 ? ' anotado' : ' anotados');
  }

  function stageHTML(L) {
    const n = H.nPlayers();
    if (L.st === 'lobby') {
      const names = Object.keys(H.players).map(p => H.players[p]).sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 48);
      return `<div class="lobby">
        <div class="lobby-l">
          <p class="eyebrow">Entrá desde el celular</p>
          <h1 class="big">${esc(H.c.title || 'Armá tu cartera')}</h1>
          <p class="lede">Escaneá el código o entrá a <b class="mono">${esc(location.host + location.pathname)}</b> y escribí</p>
          <div class="code">${esc(code)}</div>
          <p class="lede">Tres preguntas, una cartera y diez años de mercado. Gana la mejor cartera de cada perfil y la mejor de la sala. A igual plata, gana el más rápido.</p>
        </div>
        <div class="lobby-r"><div id="qrj" class="qrbox big"></div>
          <p class="joined"><b>${n}</b> ${n === 1 ? 'persona anotada' : 'personas anotadas'}</p>
          <div class="chips">${names.map(x => '<span>' + esc(x.n) + '</span>').join('')}</div></div>
      </div>`;
    }
    if (L.st === 'q' || L.st === 'x') return stepHTML(L);
    if (L.st === 'rank') return rankStageHTML(L);
    return endHTML();
  }

  function timerHTML() {
    return `<div class="tm"><span class="tm-n" id="tnum">${Math.ceil(H.remaining() / 1000)}</span>
      <div class="tm-bar"><div class="tm-fill" id="tfill" style="width:100%"></div></div></div>`;
  }

  function stepHTML(L) {
    const S = STEPS[L.step], open = L.st === 'q';
    const res = H.results();
    const counts = res.dist[L.step] || [0, 0, 0];
    const head = `<div class="st-hd"><span class="eyebrow">${esc(stepLabel(L.step))}</span>
      <span class="pips">${STEPS.map((_, i) => '<i class="' + (i === L.step ? 'on' : i < L.step ? 'done' : '') + '"></i>').join('')}</span></div>`;

    if (S.k === 'perfil') {
      const P = PERFIL[S.i];
      return `${head}<h1 class="big">${esc(P.q)}</h1>
        ${P.lede ? '<p class="lede">' + esc(P.lede) + '</p>' : ''}
        ${open ? timerHTML() + `<div class="olist">${P.opts.map((o, i) =>
            `<div class="oitem"><span class="k">${'ABC'[i]}</span><div><b>${esc(o[0])}</b><span>${esc(o[1])}</span></div></div>`).join('')}</div>`
          : distBars(counts, P.opts.map(o => o[0]))}`;
    }

    if (S.k === 'pick') {
      if (open) {
        return `${head}<h1 class="big">Elegí tu cartera</h1>
          <p class="lede">El cuestionario te sugiere una. Vos elegís. Arrancás con $100.000 y el primer año el mercado cae.</p>
          ${timerHTML()}<div class="picks three">${ORDER.map(k => pickCard(k)).join('')}</div>`;
      }
      const tot = Math.max(1, res.nPerfil), totc = Math.max(1, res.nCart);
      let more = 0, less = 0;
      res.rows.forEach(r => { if (!r.picked) return;
        const d = ORDER.indexOf(r.cart) - ORDER.indexOf(r.sugg); if (d > 0) more++; if (d < 0) less++; });
      return `${head}<h1 class="big">Cómo se repartió la sala</h1>
        <div class="legend big"><span><i style="background:var(--line-strong)"></i>Perfil que sugirió el cuestionario</span>
          <span><i style="background:var(--teal)"></i>Cartera que eligieron</span></div>
        <div class="gbars">${ORDER.map(k => {
          const a = Math.round(res.prof[k] / tot * 100), b = Math.round(res.cart[k] / totc * 100);
          return `<div class="gb"><div class="gb-cols">
              <div class="gb-col sug" style="height:${a}%"><span>${a}%</span></div>
              <div class="gb-col ch" style="height:${b}%"><span>${b}%</span></div></div>
            <div class="gb-k">${esc(PROFILES[k].name)}<small>${res.cart[k]} ${res.cart[k] === 1 ? 'persona' : 'personas'}</small></div></div>`;
        }).join('')}</div>
        <p class="lede center">${more ? '<b>' + more + '</b> eligieron una cartera más arriesgada que su perfil' : ''}${more && less ? ' · ' : ''}${less ? '<b>' + less + '</b> una más prudente' : ''}${!more && !less ? 'Todos eligieron la cartera que les sugirió el cuestionario.' : '.'}</p>`;
    }

    // ronda
    const R = ROUNDS[S.i];
    if (open) {
      let y1 = '';
      if (S.i === 0) {
        y1 = `<div class="y1">Año 1: el mercado cae. ${ORDER.map(k => esc(PROFILES[k].name) + ' <b class="neg">' + pct(oneYear(PROFILES[k].w, BAD)) + '</b>').join(' · ')}</div>`;
      }
      return `${head}${y1}<div class="news big"><p class="ttl">${esc(R.ttl)}</p><p>${esc(R.ctx)}</p></div>
        <h2 class="bigq">${esc(R.q)}</h2>${timerHTML()}
        <div class="olist">${R.opts.map((o, i) => `<div class="oitem"><span class="k">${'ABC'[i]}</span><div><b>${esc(o.t)}</b></div></div>`).join('')}</div>`;
    }
    const avg = averagesAfter(res, S.i);
    return `${head}<div class="xgrid">
      <div><p class="eyebrow">${esc(R.ttl.replace(/[“”]/g, ''))} · qué eligió la sala</p>${distBars(counts, R.opts.map(o => o.t))}</div>
      <div><div class="news"><p class="ttl">Qué pasó</p><p>${esc(R.after)}</p></div>
        ${yearsTable(S.i, res.mk)}
        <p class="eyebrow" style="margin-top:18px">Promedio de la sala al cierre de ${esc(R.yr.toLowerCase())}</p>
        <div class="avgs">${ORDER.map(k => avg[k]
          ? `<div><span>${esc(PROFILES[k].name)}</span><b class="${avg[k].v < 100000 ? 'neg' : 'pos'}">${fmt(avg[k].v)}</b><small>${avg[k].n} ${avg[k].n === 1 ? 'cartera' : 'carteras'}</small></div>`
          : `<div><span>${esc(PROFILES[k].name)}</span><b class="muted">—</b><small>nadie la eligió</small></div>`).join('')}</div>
      </div></div>`;
  }

  /* Ranking con cuenta regresiva: 3, 2, 1, y el podio de abajo hacia arriba. */
  function rankStageHTML(L) {
    const cat = CATS[L.rc] || CATS[0];
    const list = H.results().cats[cat.k] || [];
    const el = L.rat ? Math.max(0, H.now() - L.rat) : 99999;
    const head = `<p class="eyebrow center">${L.rc + 1} de ${CATS.length}</p><h1 class="big center">${esc(cat.t)}</h1>`;
    if (el < 3000) {
      const n = 3 - Math.floor(el / 1000);
      return `<div class="cd">${head}<div class="cd-n" data-n="${n}">${n}</div></div>`;
    }
    const shown = el < 3600 ? 0 : el < 5000 ? 1 : el < 6600 ? 2 : 3;
    return `<div class="rk">${head}${podiumHTML(list, shown, cat.k === 'total')}
      ${shown >= 3 && list.length > 3 ? `<div class="rest">${list.slice(3, 8).map((r, i) =>
        `<span><b>${i + 4}°</b> ${esc(r.n)} · ${fmt(r.v)}</span>`).join('')}</div>` : ''}</div>`;
  }

  function endHTML() {
    const res = H.results();
    return `<h1 class="big center">Los ganadores</h1>
      <div class="endgrid">${CATS.map(c => {
        const l = res.cats[c.k];
        return `<div class="card"><p class="eyebrow">${esc(c.t)}</p>${l.length ? l.slice(0, 3).map((r, i) =>
          `<div class="erow"><span class="m m${i + 1}">${i + 1}°</span><span class="n">${esc(r.n)}${c.k === 'total' ? ' <small>' + esc(PROFILES[r.cart].name) + '</small>' : ''}</span><b>${fmt(r.v)}</b></div>`).join('')
          : '<p class="fine">Sin participantes en el ranking.</p>'}</div>`;
      }).join('')}</div>${FOOT}`;
  }
}

/* Podio: shown = cuántos puestos ya se revelaron (3°, después 2°, después 1°). */
function podiumHTML(list, shown, showCart) {
  if (!list.length) return '<p class="lede center" style="margin-top:40px">Nadie de esta cartera completó todas las rondas.</p>';
  const slot = (r, place) => {
    const vis = (place === 3 && shown >= 1) || (place === 2 && shown >= 2) || (place === 1 && shown >= 3);
    if (!r) return `<div class="ct-pod p${place} empty"><div class="blk">${place}°</div></div>`;
    return `<div class="ct-pod p${place} ${vis ? 'on' : ''}">
      <div class="who">${vis ? `<div class="nm">${esc(r.n)}</div>
        <div class="vl ${r.v < 100000 ? 'neg' : 'pos'}">${fmt(r.v)}</div>
        <div class="sub">${showCart ? esc(PROFILES[r.cart || r.k].name) + ' · ' : ''}${secsTxt(r.t)}</div>` : '<div class="nm hid">?</div>'}</div>
      <div class="blk">${place}°</div></div>`;
  };
  return `<div class="ct-podium">${slot(list[1], 2)}${slot(list[0], 1)}${slot(list[2], 3)}</div>`;
}

/* ---------------------------------------------------------------
   9. Control desde el celular del presentador
   --------------------------------------------------------------- */
function renderCtrl(code) {
  frame(`<main class="ct-wrap" id="cw"><p class="fine">Cargando…</p></main>`, { cls: 'light', sub: 'Control · ' + code });
  const H = hostCore(code, paint);
  let lastSig = '';
  every(() => {
    const L = H.live();
    const num = $('ctn');
    if (num && L.st === 'q') num.textContent = Math.ceil(H.remaining() / 1000) + ' s';
  }, 250);

  function paint() {
    if (!H.c || !$('cw')) return;
    const L = H.live(), res = H.results(), n = H.nPlayers();
    let body = '';
    if (L.st === 'lobby') {
      body = `<p class="eyebrow">Esperando que entren</p><h2>${n} ${n === 1 ? 'persona anotada' : 'personas anotadas'}</h2>
        <p class="fine">Cuando estén, tocá Empezar: arranca la primera pregunta de perfil.</p>`;
    } else if (L.st === 'q' || L.st === 'x') {
      const na = H.nAnswers(L.step);
      body = `<p class="eyebrow">${esc(stepLabel(L.step))}</p><h2>${esc(stepTitle(L.step))}</h2>
        <div class="card ctl-st"><b class="mono">${na}</b><span>de ${n} respondieron</span>
          <span class="tag ${L.st === 'q' ? 'live' : ''}">${L.st === 'q' ? 'Abierta · <span id="ctn">' + Math.ceil(H.remaining() / 1000) + ' s</span>' : 'Cerrada'}</span></div>
        ${distBars(res.dist[L.step] || [0, 0, 0], stepOpts(L.step))}`;
    } else if (L.st === 'rank') {
      const cat = CATS[L.rc] || CATS[0], l = res.cats[cat.k];
      body = `<p class="eyebrow">Rankings · ${L.rc + 1} de ${CATS.length}</p><h2>${esc(cat.t)}</h2>
        <p class="fine">En pantalla: cuenta regresiva y podio. Esto solo lo ves vos.</p>
        <div class="card">${l.length ? l.slice(0, 5).map((r, i) =>
          `<div class="erow"><span class="m m${i + 1}">${i + 1}°</span><span class="n">${esc(r.n)}</span><b>${fmt(r.v)}</b></div>`).join('')
          : '<p class="fine">Nadie en este ranking.</p>'}</div>`;
    } else {
      body = `<p class="eyebrow">Terminado</p><h2>Rankings publicados</h2>
        <p class="fine">Cada participante ve su puesto en el celular.</p>`;
    }
    const html = body + `
      <button class="btn huge" id="cnext" ${L.st === 'end' ? 'disabled' : ''}>${esc(H.nextLabel())}</button>
      <div class="row ctl-row">
        <button class="btn ghost" id="cprev" ${L.st === 'lobby' ? 'disabled' : ''}>← Anterior</button>
        ${L.st === 'x' ? '<button class="btn ghost" id="creopen">Reabrir esta pregunta</button>' : ''}
      </div>
      <p class="fine" style="margin-top:18px">Lo que tocás acá se ve en la pantalla proyectada al instante.
        Al terminar el reloj, la pregunta se cierra sola.</p>`;
    if (html === lastSig) return;
    lastSig = html;
    $('cw').innerHTML = html;
    $('cnext').onclick = () => H.next();
    $('cprev').onclick = () => H.prev();
    if ($('creopen')) $('creopen').onclick = () => H.reopen();
  }
}

/* ---------------------------------------------------------------
   10. Pantalla del participante
   --------------------------------------------------------------- */
function renderPlay(code) {
  const pid = participantId();
  const P = { c: null, live: null, name: store.get('ct:' + code + ':name') || '', rank: null, sel: null, ticker: null };
  const K = sk => 'ct:' + code + ':' + ((P.live && P.live.seed) || 0) + ':' + sk;
  const mine = s => { try { return JSON.parse(store.get(K('s' + s)) || 'null'); } catch (e) { return null; } };

  frame(`<main class="ct-wrap" id="pw"><p class="fine">Cargando…</p></main>`, { sub: 'Armá tu cartera' });
  start();

  async function start() {
    let c;
    try { c = await restGet('carteras/' + code); }
    catch (e) { return fail('No pudimos conectarnos. Revisá tu conexión y volvé a intentar.'); }
    if (!c) return fail('No encontramos nada con el código ' + code + '. Revisalo con quien está presentando.');
    P.c = c; P.live = c.live || lobbyLive(0, DEF_SECS);
    if (!P.name) return paintName();
    restPut('cplayers/' + code + '/' + pid, { n: P.name, at: { '.sv': 'timestamp' } }).catch(() => {});
    paint(); poll();
  }
  function fail(msg) { $('pw').innerHTML = `<div class="flag"><span class="mk">Ups</span><p>${esc(msg)}</p></div><a class="btn ghost" href="#">Volver</a>`; }

  function paintName() {
    $('pw').innerHTML = `<p class="eyebrow">${esc(P.c.title || 'Armá tu cartera')}</p>
      <h1>¿Con qué nombre jugás?</h1>
      <p class="lede">Lo van a ver todos en el ranking. No pedimos mail ni ningún otro dato.</p>
      <input class="in big" id="nm" maxlength="24" placeholder="Tu nombre" autocomplete="off" autocapitalize="words">
      <div id="ferr"></div>
      <div class="row"><button class="btn wide" id="ok">Entrar</button></div>`;
    const inp = $('nm'); inp.focus();
    const go = async () => {
      const v = (inp.value || '').replace(/\s+/g, ' ').trim(), err = $('ferr');
      err.innerHTML = '';
      if (v.length < 2) { err.innerHTML = '<p class="warnline">Escribí un nombre de al menos dos letras.</p>'; return; }
      if (nameLooksBad(v)) { err.innerHTML = '<p class="warnline">Ese nombre no se puede usar. Probá con otro.</p>'; return; }
      const b = $('ok'); b.disabled = true; b.textContent = 'Entrando…';
      try { await restPut('cplayers/' + code + '/' + pid, { n: v, at: { '.sv': 'timestamp' } }); }
      catch (e) { b.disabled = false; b.textContent = 'Entrar'; err.innerHTML = '<p class="warnline">No pudimos anotarte. Probá de nuevo en unos segundos.</p>'; return; }
      P.name = v; store.set('ct:' + code + ':name', v);
      paint(); poll();
    };
    $('ok').onclick = go;
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  }

  function poll() {
    every(async () => {
      try {
        const L = await restGet('carteras/' + code + '/live');
        if (!L) return;
        const b = P.live || {};
        P.live = L;
        if (L.st !== b.st || L.step !== b.step || L.at !== b.at || L.seed !== b.seed) { P.sel = null; paint(); }
        else if (L.st === 'end' && !P.rank) paint();
      } catch (e) { /* un pedido perdido no rompe nada */ }
    }, 2000 + Math.floor(Math.random() * 900));
  }

  /* ---- lo que este celular sabe de sí mismo ---- */
  function myProfile() { return decideProfile([0, 1, 2].map(s => { const a = mine(s); return a ? a.c : null; })); }
  function myCart() { const a = mine(PICK_STEP); return a && ORDER[a.c] ? ORDER[a.c] : myProfile().key; }
  function myPicks(upto) {
    const out = [];
    for (let i = 0; i < upto; i++) { const a = mine(FIRST_ROUND + i); out.push(a && ROUNDS[i].opts[a.c] ? a.c : ROUNDS[i].neutral); }
    return out;
  }
  const mk = () => market((P.live && P.live.seed) || 0);

  function elapsedMs() { const at = (P.live && P.live.at) || 0; return at ? Math.max(0, serverNow() - at) : 0; }
  function remainingMs() { return Math.max(0, ((P.live && P.live.secs) || DEF_SECS) * 1000 - elapsedMs()); }
  function stopTicker() { if (P.ticker) { clearInterval(P.ticker); P.ticker = null; } }
  function startTicker() {
    stopTicker();
    const secs = (P.live && P.live.secs) || DEF_SECS;
    P.ticker = every(() => {
      const num = $('tnum'), fill = $('tfill');
      if (!num || !fill) return stopTicker();
      const ms = remainingMs(), s = Math.ceil(ms / 1000);
      num.textContent = s;
      fill.style.width = Math.max(0, Math.min(100, ms / (secs * 1000) * 100)) + '%';
      num.classList.toggle('warn', s <= 5); fill.classList.toggle('warn', s <= 5);
      if (ms <= 0) {
        stopTicker();
        document.querySelectorAll('[data-a]').forEach(b => { b.disabled = true; });
        const e = $('ferr'); if (e) e.innerHTML = '<p class="warnline">Se terminó el tiempo de esta pregunta.</p>';
      }
    }, 200);
  }
  const timerHTML = () => `<div class="tm sm"><span class="tm-n" id="tnum">${Math.ceil(remainingMs() / 1000)}</span>
    <div class="tm-bar"><div class="tm-fill" id="tfill" style="width:100%"></div></div></div>`;

  async function send(step, choice) {
    const L = P.live;
    if (!L || L.st !== 'q' || L.step !== step || mine(step)) return;
    const ms = elapsedMs();
    if (ms > (L.secs || DEF_SECS) * 1000) { const e = $('ferr'); if (e) e.innerHTML = '<p class="warnline">Se terminó el tiempo de esta pregunta.</p>'; return; }
    document.querySelectorAll('[data-a]').forEach(b => { b.disabled = true; });
    try {
      await restPut('cans/' + code + '/s' + step + '/' + pid, { c: choice, ms: ms, ts: { '.sv': 'timestamp' } });
      store.set(K('s' + step), JSON.stringify({ c: choice, ms: ms }));
      paint();
    } catch (e) {
      document.querySelectorAll('[data-a]').forEach(b => { b.disabled = false; });
      const er = $('ferr'); if (er) er.innerHTML = '<p class="warnline">No se pudo enviar (puede que ya se haya cerrado la pregunta).</p>';
    }
  }

  async function paint() {
    const w = $('pw'); if (!w) return;
    const L = P.live || { st: 'lobby' };
    stopTicker();
    window.scrollTo(0, 0);
    if (L.st === 'lobby') {
      w.innerHTML = `<p class="eyebrow">${esc(P.c.title || 'Armá tu cartera')}</p><h1>Listo, ${esc(P.name)}</h1>
        <div class="verdict"><p class="lbl">Estás anotado</p><p>Mirá la pantalla. La primera pregunta aparece sola en este celular.</p></div>
        <p class="lede">Tres preguntas de perfil, una cartera de $100.000 y diez años de mercado. A igual plata, gana el más rápido.</p>`;
      return;
    }
    if (L.st === 'q' || L.st === 'x') return paintStep(w, L);
    if (L.st === 'rank') {
      w.innerHTML = `<div class="verdict"><p class="lbl">Se vienen los ganadores</p><p class="name">Mirá la pantalla</p></div>
        <p class="eyebrow">Tu resultado</p>${finalHTML(myCart(), myPicks(6), mk())}${FOOT}`;
      return;
    }
    // end
    if (!P.rank) { try { P.rank = await restGet('crank/' + code); } catch (e) { P.rank = null; } }
    const me = P.rank && P.rank.sc && P.rank.sc[pid];
    let top = '';
    if (!me) top = `<div class="verdict"><p class="lbl">Terminó</p><p class="name">Gracias por jugar</p></div>`;
    else if (me.m > 0) top = `<div class="verdict"><p class="lbl">Fuera del ranking</p><p class="name">${fmt(me.v)}</p>
        <p>Te ${me.m === 1 ? 'faltó 1 respuesta' : 'faltaron ' + me.m + ' respuestas'}: para ganar hay que elegir cartera y contestar las seis rondas.</p></div>`;
    else top = `<div class="verdict"><p class="lbl">Tu puesto</p><p class="name">${me.c}° de ${me.nc}</p>
        <p>entre las carteras ${esc(PROFILES[me.k].name.toLowerCase())}s · <b>${me.t}° de ${me.nt}</b> en la sala · ${fmt(me.v)}</p></div>`;
    w.innerHTML = top + `<p class="eyebrow">Tu resultado</p>${finalHTML(myCart(), myPicks(6), mk())}${FOOT}`;
  }

  function paintStep(w, L) {
    const S = STEPS[L.step], open = L.st === 'q', a = mine(L.step);
    const eb = `<div class="yearbar"><span>${esc(stepLabel(L.step))}</span><span class="pips">${STEPS.map((_, i) =>
      '<span class="pip ' + (i === L.step ? 'on' : i < L.step ? 'done' : '') + '"></span>').join('')}</span></div>`;

    if (S.k === 'perfil') {
      const Q = PERFIL[S.i];
      if (open && !a) {
        w.innerHTML = `${eb}<h2>${esc(Q.q)}</h2>${Q.lede ? '<p class="lede">' + esc(Q.lede) + '</p>' : ''}${timerHTML()}
          <div class="opts">${Q.opts.map((o, i) => `<button class="opt" data-a="${i}"><b>${esc(o[0])}</b><span>${esc(o[1])}</span></button>`).join('')}</div>
          <div id="ferr"></div>`;
        w.querySelectorAll('[data-a]').forEach(b => { b.onclick = () => send(L.step, +b.dataset.a); });
        return startTicker();
      }
      let extra = '';
      if (!open && S.i === 2) {
        const pr = myProfile();
        extra = `<div class="verdict"><p class="lbl">Tu perfil</p><p class="name">${esc(PERSON[pr.key])}</p><p>${esc(PROFILES[pr.key].why)}</p></div>
          ${pr.note ? `<div class="flag"><span class="mk">${esc(pr.note.mk)}</span><p>${esc(pr.note.tx)}</p></div>` : ''}
          <p class="lede">Ahora vas a elegir tu cartera. La sugerida es la ${esc(PROFILES[pr.key].name.toLowerCase())}, pero decidís vos.</p>`;
      }
      w.innerHTML = `${eb}<h2>${esc(Q.q)}</h2>
        ${a ? `<span class="chose">${esc(Q.opts[a.c][0])}</span>` : `<p class="warnline">${open ? '' : 'No llegaste a responder.'}</p>`}
        ${extra || `<p class="lede">${open ? 'Listo. Esperá a que se cierre la pregunta.' : 'Mirá la pantalla: la próxima aparece sola.'}</p>`}`;
      return;
    }

    if (S.k === 'pick') {
      const pr = myProfile();
      if (open && !a) {
        w.innerHTML = `${eb}<div class="verdict"><p class="lbl">Tu perfil</p><p class="name">${esc(PERSON[pr.key])}</p><p>${esc(PROFILES[pr.key].why)}</p></div>
          ${pr.note ? `<div class="flag"><span class="mk">${esc(pr.note.mk)}</span><p>${esc(pr.note.tx)}</p></div>` : ''}
          <h3>Elegí tu cartera</h3>${timerHTML()}
          <div class="picks">${ORDER.map((k, i) => pickCard(k, { tag: 'button', badge: k === pr.key ? 'Sugerida' : '',
            attrs: 'type="button" data-a="' + i + '" aria-pressed="' + (P.sel === i ? 'true' : 'false') + '"' })).join('')}</div>
          <p class="fine" style="margin-top:10px">Todo está medido en poder de compra: la inflación ya está descontada.
            Por eso el money market rinde negativo casi todos los años.</p>
          <div id="ferr"></div>
          <div class="row"><button class="btn wide" id="gplay" ${P.sel === null ? 'disabled' : ''}>Elegir esta cartera</button></div>`;
        w.querySelectorAll('.pick[data-a]').forEach(b => {
          b.onclick = () => {
            P.sel = +b.dataset.a;
            w.querySelectorAll('.pick[data-a]').forEach(o => o.setAttribute('aria-pressed', o === b ? 'true' : 'false'));
            $('gplay').disabled = false;
          };
        });
        $('gplay').onclick = () => { if (P.sel !== null) send(L.step, P.sel); };
        return startTicker();
      }
      const k = myCart();
      w.innerHTML = `${eb}<div class="card"><p class="stat-k">${a ? 'Tu cartera' : 'No elegiste a tiempo: te tocó la sugerida'}</p>
          <h2 style="margin-top:4px">${esc(PROFILES[k].name)}</h2>${barHTML(PROFILES[k].w, 'tall')}
          <p class="fine">${esc(mixLine(PROFILES[k].w))}</p></div>
        ${a ? '' : '<div class="flag"><span class="mk">Ojo</span><p>Podés seguir jugando, pero para entrar al ranking hay que elegir cartera y contestar las seis rondas.</p></div>'}
        <p class="lede">${open ? 'Listo. Esperá a que se cierre.' : 'Arrancás con $100.000. Mirá la pantalla: empieza el año 1.'}</p>`;
      return;
    }

    // rondas
    const ri = S.i, R = ROUNDS[ri], cart = myCart(), Wt = PROFILES[cart].w, M = mk();
    const before = run(Wt, myPicks(ri), M), v1 = before.path[before.path.length - 1];
    if (open && !a) {
      w.innerHTML = `${eb}<p class="fine">Cartera ${esc(PROFILES[cart].name.toLowerCase())}</p>
        <div class="news"><p class="ttl">${esc(R.ttl)}</p><p>${esc(R.ctx)}</p></div>
        <div class="money"><span class="from">$100.000</span><span class="arrow" aria-hidden="true">→</span>
          <span class="to ${v1 < 100000 ? 'neg' : 'pos'}">${fmt(v1)}</span>
          <span class="delta ${v1 < 100000 ? 'neg' : 'pos'}">${pct((v1 / 100000 - 1) * 100)}</span></div>
        ${barHTML(nowMix(before.v))}
        <h3 style="margin:14px 0 0">${esc(R.q)}</h3>${timerHTML()}
        <div class="opts">${R.opts.map((o, i) => `<button class="opt" data-a="${i}"><b>${esc(o.t)}</b></button>`).join('')}</div>
        <div id="ferr"></div>`;
      w.querySelectorAll('[data-a]').forEach(b => { b.onclick = () => send(L.step, +b.dataset.a); });
      return startTicker();
    }
    if (open && a) {
      w.innerHTML = `${eb}<div class="news"><p class="ttl">${esc(R.ttl)}</p></div>
        <span class="chose">${esc(R.opts[a.c].t)}</span>
        <p class="lede">Listo. Cuando se cierre la pregunta vas a ver qué pasó con tu plata.</p>`;
      return;
    }
    // cerrada: qué pasó
    const picks = myPicks(ri + 1), res = run(Wt, picks, M);
    const after = res.path[res.path.length - 1], ch = v1 > 0 ? (after / v1 - 1) * 100 : 0, nm = nowMix(res.v);
    w.innerHTML = `${eb}
      <span class="chose">${a ? esc(R.opts[a.c].t) : 'No respondiste: quedó «' + esc(R.opts[R.neutral].t) + '»'}</span>
      <div class="outcome"><div class="money" style="margin:0"><span class="from">${fmt(v1)}</span>
        <span class="arrow" aria-hidden="true">→</span><span class="to ${ch < 0 ? 'neg' : 'pos'}">${fmt(after)}</span>
        <span class="delta ${ch < 0 ? 'neg' : 'pos'}">${pct(ch)}</span></div>
        <p>${esc(R.after)}</p></div>
      ${barHTML(nm)}<p class="fine" style="margin:0">${esc(mixLine(nm))}</p>
      ${ri === ROUNDS.length - 1 ? '<p class="eyebrow" style="margin-top:22px">Tu resultado</p>' + finalHTML(cart, picks, M) + FOOT
        : '<p class="lede" style="margin-top:16px">Mirá la pantalla: la próxima ronda aparece sola.</p>'}`;
  }
}

/* ---------------------------------------------------------------
   11. Lo que ve app.js
   --------------------------------------------------------------- */
window.CARTERA = {
  home: function () { sync(); renderHome(); },
  host: function (code) { sync(); renderHost(code); },
  ctrl: function (code) { sync(); renderCtrl(code); },
  play: function (code) { sync(); renderPlay(code); },
  /* Para pruebas y para ajustar el modelo sin abrir el navegador. */
  _model: { ROUNDS, PROFILES, ORDER, market, run, bestOf, seedOk, pickSeed, decideProfile, computeResults, HOLD }
};

})();
