import { APP_NAME, FIREBASE_CONFIG, ZONA } from './config.js';
import {
  ROLES, ROL_LABEL, ROL_CORTO, nivel, rolAbajo, ESTADOS, ESTADO_LABEL, TIPOS, TIPO_LABEL,
  normDni, dniValido, fmtDni, telWhatsApp, idLista, palabrasDe
} from './roles.js';
import { leerArchivo, mapearPersonas, mapearPadron, exportarExcel, NOMBRE_COLUMNA } from './importers.js';

const S = FIREBASE_CONFIG ? await import('./store-firebase.js') : await import('./store-demo.js');
const DEMO = S.modo === 'demo';

// ---------------------------------------------------------------- estado
const st = {
  me: null, tab: 'gente', usuarios: [], personas: [], conflictos: [], unsubs: [],
  f: { estado: 'todos', q: '', de: '', limite: 60 },
  dia: { solo: 'pend' },
  c: { fase: 'inicio' },          // pantalla Cargar
  imp: null, pad: null,           // importaciones en curso
  login: 'entrar'
};

// ---------------------------------------------------------------- utilidades
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sinAcentos = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const ms = (t) => (t?.toMillis ? t.toMillis() : (typeof t === 'number' ? t : Date.now()));
const pct = (a, b) => (b ? Math.round((a * 100) / b) : 0);
const iniciales = (n) => String(n || '?').replace(/,/g, ' ').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const primerNombre = (n) => {
  const s = String(n || '');
  const t = s.includes(',') ? s.split(',')[1] : s;
  const w = t.trim().split(/\s+/)[0] || '';
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
};
const mapsUrl = (p) => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent([p.dirEscuela, p.escuela, ZONA].filter(Boolean).join(', '));
const waUrl = (tel, texto) => {
  const t = telWhatsApp(tel);
  return t ? `https://wa.me/${t}${texto ? '?text=' + encodeURIComponent(texto) : ''}` : '';
};
const textoRecordatorio = (p) => `Hola ${primerNombre(p.nombre)}! Te recuerdo dónde votás: ${p.escuela || '(escuela a confirmar)'}${p.dirEscuela ? ' (' + p.dirEscuela + ')' : ''}${p.mesa ? ', mesa ' + p.mesa : ''}${p.orden ? ', número de orden ' + p.orden : ''}.`;
const esMov = () => st.me.rol === 'movilizador';
const puedePadron = () => st.me.rol === 'cabeza';
const usuarioPorId = (uid) => st.usuarios.find((u) => u.uid === uid);
const miEquipo = () => st.usuarios.filter((u) => u.uid !== st.me.uid && u.rol !== 'fiscal' && (st.me.rol === 'cabeza' || u.path.includes(st.me.uid)));
const pausa = (t) => new Promise((r) => setTimeout(r, t));

// ---------------------------------------------------------------- modo liviano (cabeza)
// La cabeza no baja a toda la gente: los números los cuenta el servidor y las listas llegan por partes.
const liviano = () => st.me?.rol === 'cabeza';
const cachePersonas = new Map();
const recordar = (ps) => { for (const p of ps) cachePersonas.set(p.dni, p); return ps; };
const personaLocal = (dni) => st.personas.find((x) => x.dni === dni) || cachePersonas.get(dni);
const conteos = {}; const pidiendo = {};
let tRefresco = null;
const programarRefresco = () => { clearTimeout(tRefresco); tRefresco = setTimeout(() => refrescar(), 150); };
const invalidarConteos = () => { for (const k in conteos) conteos[k].t = 0; };
function conteo(clave, filtros) {
  const c = conteos[clave];
  if ((!c || Date.now() - c.t > 45000) && !pidiendo[clave]) {
    pidiendo[clave] = true;
    S.contar(filtros).then((n) => { conteos[clave] = { n, t: Date.now() }; programarRefresco(); })
      .catch((e) => { console.error('conteo', clave, e); conteos[clave] = { n: c?.n ?? null, t: Date.now() }; })
      .finally(() => { delete pidiendo[clave]; });
  }
  return c ? c.n : null;
}
const fmtN = (n) => (n == null ? '…' : Number(n).toLocaleString('es-AR'));
function statsGlobal() {
  if (!liviano()) return stats(st.personas);
  return {
    total: conteo('total', []), conf: conteo('conf', [['estado', '==', 'confirmado']]), tras: conteo('tras', [['estado', '==', 'traslado']]),
    voto: conteo('voto', [['voto', '==', true]]), rev: conteo('rev', [['revisar', '==', true]]),
    fisc: conteo('fisc', [['tipo', 'in', ['fiscal', 'fiscal_suplente']]]), trasPend: conteo('trasPend', [['estado', '==', 'traslado'], ['voto', '==', false]])
  };
}
// [cargados, votaron] de alguien y todo su equipo
const contU = (cont, uid) => (liviano() ? [conteo('u' + uid, [['path', 'array-contains', uid]]), conteo('uv' + uid, [['path', 'array-contains', uid], ['voto', '==', true]])] : (cont[uid] || [0, 0]));
async function actualizarPersonaApp(dni, cambios) {
  const r = await S.actualizarPersona(dni, cambios);
  const p = personaLocal(dni); if (p) Object.assign(p, cambios);
  invalidarConteos(); programarRefresco();
  return r;
}
function filtrosGente() {
  const f = []; const e = st.f.estado;
  if (e === 'fiscal') f.push(['tipo', 'in', ['fiscal', 'fiscal_suplente']]);
  else if (e === 'revisar') f.push(['revisar', '==', true]);
  else if (e !== 'todos') f.push(['estado', '==', e]);
  const q = st.f.q.trim(); const qd = normDni(q);
  if (qd.length >= 7 && /^[\d.\s]+$/.test(q)) f.push(['dni', '==', qd]);
  else if (q.length >= 2) { const w = palabrasDe(q)[0]; if (w) f.push(['palabras', 'array-contains', w]); }
  if (st.f.de && !f.some((x) => x[1] === 'array-contains')) f.push(['path', 'array-contains', st.f.de]);
  return f;
}
// Qué parte de la gente tiene que estar en pantalla según la sección
function suscribirPagina() {
  if (!liviano()) return;
  let filtros = null; let lim = 0;
  if (st.tab === 'gente') { filtros = filtrosGente(); lim = st.f.limite; }
  if (st.tab === 'dia') { filtros = [['estado', '==', 'traslado'], ['voto', '==', false]]; lim = 50; }
  const clave = filtros ? JSON.stringify([filtros, lim]) : '';
  if (clave === st.clavePagina && st.unsubPagina) return;
  st.unsubPagina?.(); st.clavePagina = clave;
  if (!filtros) { st.personas = []; st.unsubPagina = null; return; }
  st.cargandoPagina = true;
  st.unsubPagina = S.watchPersonasConsulta(filtros, lim, (x) => { st.cargandoPagina = false; st.personas = recordar(x); refrescar(); },
    (e) => { st.cargandoPagina = false; st.errorPagina = mensajeError(e); refrescar(); });
}
const genteDe = {}; // uid -> {lista, t} (gente cargada por un movilizador, para el árbol del equipo)
function genteDeUsuario(uid) {
  if (!liviano()) return st.personas.filter((p) => p.ownerId === uid);
  const g = genteDe[uid];
  if ((!g || Date.now() - g.t > 45000) && !pidiendo['o' + uid]) {
    pidiendo['o' + uid] = true;
    S.listarPersonas([['ownerId', '==', uid]], 31).then((x) => { genteDe[uid] = { lista: recordar(x), t: Date.now() }; programarRefresco(); })
      .catch((e) => console.error(e)).finally(() => { delete pidiendo['o' + uid]; });
  }
  return g ? g.lista : null;
}
let fiscPers = null; let fiscT = 0;
function personasFiscales() {
  if (!liviano()) return st.personas.filter((p) => p.tipo && p.tipo !== 'votante');
  if (Date.now() - fiscT > 45000 && !pidiendo.fisc) {
    pidiendo.fisc = true; fiscT = Date.now();
    S.listarPersonas([['tipo', 'in', ['fiscal', 'fiscal_suplente']]], 2000).then((x) => { fiscPers = recordar(x); programarRefresco(); })
      .catch((e) => console.error(e)).finally(() => { delete pidiendo.fisc; });
  }
  return fiscPers || [];
}
const pidiendoDni = new Set();
function personaPorDni(dni) {
  const p = personaLocal(dni);
  if (p || !liviano() || pidiendoDni.has(dni)) return p;
  pidiendoDni.add(dni);
  S.listarPersonas([['dni', '==', dni]], 1).then((x) => { if (x.length) { recordar(x); programarRefresco(); } }).catch(() => {});
  return null;
}
// Toda la gente, solo cuando hace falta (borrar, exportar)
const todaLaGente = (filtros = []) => (liviano() ? S.listarPersonas(filtros) : Promise.resolve(st.personas.filter((p) => filtros.every(([c, , v]) => p[c] === v))));
let tPagina = null;
const resuscribir = () => { clearTimeout(tPagina); tPagina = setTimeout(suscribirPagina, 300); };
setInterval(() => { if (st.me && liviano() && document.visibilityState === 'visible') { invalidarConteos(); refrescar(); } }, 45000);

function mensajeError(e) {
  const c = e?.code || '';
  if (/invalid-credential|wrong-password|user-not-found|invalid-email/.test(c)) return 'DNI o contraseña incorrectos.';
  if (/email-already-in-use/.test(c)) return 'Ese DNI ya está en el equipo de otra persona. No se puede agregar dos veces. Si quedó mal ubicado, pedile a quien lo agregó que lo quite y después sumalo vos.';
  if (/weak-password/.test(c)) return 'La contraseña tiene que tener al menos 6 caracteres.';
  if (/network|unavailable/.test(c)) return 'No hay conexión. Probá de nuevo cuando tengas señal.';
  if (/too-many-requests/.test(c)) return 'Demasiados intentos. Esperá unos minutos.';
  if (/permission-denied/.test(c)) return 'No tenés permiso para hacer eso.';
  return e?.message || 'Algo salió mal. Probá de nuevo.';
}

const I = {
  gente: '<path d="M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.8.7 3 2.5 3.5 5.2"/>',
  cargar: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 10h4M7 14h6M16.5 9.5v5M14 12h5"/>',
  dia: '<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V6l4-3 4 3v4M9.5 15l1.8 1.8 3.4-3.6"/>',
  equipo: '<circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="18" r="2.5"/><circle cx="19" cy="18" r="2.5"/><path d="M12 7.5V12M5 15.5V12h14v3.5"/>',
  panel: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  buscar: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  wa: '<path d="M21 12a9 9 0 0 1-13.5 7.8L3 21l1.3-4.4A9 9 0 1 1 21 12z"/><path d="M9 9.5c.3 2.3 2.2 4.2 4.5 4.5l1-1.2 1.7.8"/>',
  mapa: '<path d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z"/><circle cx="12" cy="10" r="2"/>',
  candado: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  ok: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  llave: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M16 7l2.5 2.5M14 9l2 2"/>',
  alerta: '<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4.5M12 17.5v.3"/>',
  mas: '<path d="M12 5v14M5 12h14"/>',
  subir: '<path d="M12 15V3M7 8l5-5 5 5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
  bajar: '<path d="M12 3v12M7 10l5 5 5-5M4 19h16"/>',
  auto: '<path d="M3 16v-5l2-5h11l3 5h2v5h-2"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/><path d="M9 17h6"/>',
  camara: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="4"/>',
  fiscal: '<path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
  padron: '<path d="M5 3h11l3 3v15H5z"/><path d="M9 9h6M9 13h6M9 17h4"/>',
  mas3: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  logo: '<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V6l4-3 4 3v4M9.5 15l1.8 1.8 3.4-3.6"/>'
};
const ic = (n, s = 20, extra = '') => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${I[n]}</svg>`;

function toast(msg, t = 2600) {
  document.querySelectorAll('.toast').forEach((x) => x.remove());
  const d = document.createElement('div');
  d.className = 'toast'; d.setAttribute('role', 'status'); d.textContent = msg;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), t);
}

let sheetCtx = null;
function abrirHoja(html, ctx = null) {
  cerrarHoja();
  sheetCtx = ctx;
  const f = document.createElement('div');
  f.className = 'sheet-fondo';
  f.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="asa"></div>${html}</div>`;
  f.addEventListener('click', (e) => { if (e.target === f) cerrarHoja(); });
  document.body.appendChild(f);
  document.body.style.overflow = 'hidden';
}
function cerrarHoja() {
  document.querySelectorAll('.sheet-fondo').forEach((x) => x.remove());
  document.body.style.overflow = '';
  sheetCtx = null;
}
const hojaHtml = (html) => { const s = $('.sheet'); if (s) s.innerHTML = '<div class="asa"></div>' + html; };

// ---------------------------------------------------------------- arranque
async function boot() {
  const me = await S.init();
  if (me) iniciarSesion(me); else pintarLogin();
}

function iniciarSesion(me) {
  st.me = me;
  st.tab = 'gente';
  st.f = { estado: 'todos', q: '', de: '', limite: 60 };
  st.c = { fase: 'inicio' };
  st.resumen = undefined; st.circAbiertos = null; st.abiertos = null;
  st.unsubs.forEach((u) => u());
  st.fiscalias = []; st.fx = { votos: {} };
  st.unsubs = me.rol === 'fiscal'
    ? [S.watchFiscalias((x) => { st.fiscalias = x; refrescar(); })]
    : [
      S.watchUsuarios((x) => { st.usuarios = x; refrescar(); }),
      ...(me.rol === 'cabeza' ? [] : [S.watchPersonas((x) => { st.personas = x; refrescar(); })]),
      S.watchConflictos((x) => { st.conflictos = x; refrescar(); }),
      S.watchFiscalias((x) => { st.fiscalias = x; refrescar(); })
    ];
  pintar();
}

async function salir() {
  st.unsubs.forEach((u) => u()); st.unsubs = [];
  st.unsubPagina?.(); st.unsubPagina = null; st.clavePagina = null; cachePersonas.clear();
  for (const k in conteos) delete conteos[k];
  await S.logout();
  st.me = null; st.usuarios = []; st.personas = []; st.conflictos = [];
  cerrarHoja();
  pintarLogin();
}

// ---------------------------------------------------------------- login
function pintarLogin() {
  const app = $('#app');
  const demo = DEMO ? `
    <div class="card pad stack">
      <div><h2>Probá la app</h2><div class="muted">Modo demostración con datos inventados. Elegí con qué rol entrar:</div></div>
      <div class="demo-roles">
        ${[['cab1', 'cabeza'], ['enc1', 'encargado'], ['dir1', 'dirigente'], ['mov1', 'movilizador'], ['fis1', 'fiscal']].map(([uid, rol]) => `
          <button type="button" data-act="demo-entrar" data-uid="${uid}"><b>${ROL_CORTO[rol]}</b><span class="muted small">${esc({ cab1: 'Ricardo Benítez', enc1: 'Laura Molina · circ. 19', dir1: 'Daniel Torres', mov1: 'Marcos Ríos', fis1: 'Nadia Yasmín · solo su mesa' }[uid])}</span></button>`).join('')}
      </div>
    </div>` : '';
  if (st.login === 'crear') {
    app.innerHTML = `<div class="login">
      ${marca()}
      <form id="f-crear" class="card pad stack" autocomplete="off">
        <h2>Crear campaña</h2>
        <div class="muted">Vas a quedar como cabeza. Después agregás a los encargados de circuito.</div>
        <div><label class="label" for="cc-camp">Nombre del espacio o campaña</label><input id="cc-camp" class="input" required maxlength="60" placeholder="Ej: Frente Renovador Capital"></div>
        <div><label class="label" for="cc-nom">Tu nombre y apellido</label><input id="cc-nom" class="input" required maxlength="60"></div>
        <div><label class="label" for="cc-dni">Tu DNI</label><input id="cc-dni" class="input" inputmode="numeric" required></div>
        <div><label class="label" for="cc-tel">Tu teléfono</label><input id="cc-tel" class="input" inputmode="tel"></div>
        <div><label class="label" for="cc-pass">Contraseña (mínimo 6)</label><input id="cc-pass" class="input" type="password" minlength="6" required></div>
        <div class="error" id="cc-err" role="alert"></div>
        <button class="btn btn-full" type="submit">Crear campaña</button>
      </form>
      <button class="btn btn-ghost" type="button" data-act="ir-entrar">Ya tengo usuario</button>
    </div>`;
    return;
  }
  app.innerHTML = `<div class="login">
    ${marca()}
    ${demo}
    <form id="f-login" class="card pad stack" autocomplete="on">
      <h2>Entrar</h2>
      <div><label class="label" for="l-dni">DNI</label><input id="l-dni" class="input" inputmode="numeric" autocomplete="username" required placeholder="Sin puntos"></div>
      <div><label class="label" for="l-pass">Contraseña</label><input id="l-pass" class="input" type="password" autocomplete="current-password" required></div>
      <div class="error" id="l-err" role="alert"></div>
      <button class="btn btn-full" type="submit">Entrar</button>
      ${DEMO ? '<div class="muted small">En la demo todas las contraseñas son 1234.</div>' : ''}
    </form>
    ${DEMO ? '' : '<button class="btn btn-ghost" type="button" data-act="ir-crear">Crear una campaña nueva</button>'}
  </div>`;
}
const marca = () => `<div class="marca"><div class="logo">${ic('logo', 30)}</div><div><b>${esc(APP_NAME)}</b><div class="muted">Tu equipo y tu gente, el día de la elección</div></div></div>`;

// ---------------------------------------------------------------- estructura
function tabsDisponibles() {
  const t = [['gente', 'Gente'], ['cargar', 'Cargar'], ['dia', 'Día E']];
  if (!esMov()) t.push(['equipo', 'Equipo'], ['panel', 'Panel']);
  return t;
}

function pintar() {
  if (st.me.rol === 'fiscal') { pintarFiscal(); return; }
  const app = $('#app');
  app.innerHTML = `
    ${DEMO ? '<div class="demo-band">Modo demostración · los datos son inventados</div>' : ''}
    <header class="top" id="top"></header>
    <main id="main"></main>
    <nav class="tabs" aria-label="Secciones"><div class="in" id="nav"></div></nav>`;
  pintarNav();
  pintarTop();
  if (liviano()) { const viejo = Date.now() - 10000; for (const k in conteos) if (conteos[k].t < viejo) conteos[k].t = 0; }
  suscribirPagina();
  const v = { gente: vistaGente, cargar: vistaCargar, dia: vistaDia, equipo: vistaEquipo, panel: vistaPanel }[st.tab];
  $('#main').innerHTML = v();
  refrescarPartes();
  window.scrollTo(0, 0);
}

function pintarNav() {
  const pend = st.conflictos.filter((c) => c.estado === 'intento' || c.estado === 'reclamo').length;
  $('#nav').innerHTML = tabsDisponibles().map(([k, l]) => `
    <button type="button" data-act="tab" data-tab="${k}" ${st.tab === k ? 'aria-current="page"' : ''}>
      ${ic(k, 22)}${esc(l)}${k === 'panel' && pend && st.me.rol === 'cabeza' ? `<span class="badge">${pend}</span>` : ''}
    </button>`).join('');
}

function stats(lista) {
  const r = { total: lista.length, conf: 0, tras: 0, voto: 0, rev: 0, fisc: 0, trasPend: 0 };
  for (const p of lista) {
    if (p.estado === 'confirmado') r.conf++;
    if (p.estado === 'traslado') { r.tras++; if (!p.voto) r.trasPend++; }
    if (p.voto) r.voto++;
    if (p.revisar) r.rev++;
    if (p.tipo && p.tipo !== 'votante') r.fisc++;
  }
  return r;
}

function pintarTop() {
  const me = st.me;
  const s = statsGlobal();
  const titulos = { gente: esMov() ? 'Mi gente' : 'Gente del equipo', cargar: 'Cargar persona', dia: 'Día de elección', equipo: 'Equipo', panel: 'Panel' };
  const sub = `${ROL_LABEL[me.rol]}${me.circuito ? ' · Circuito ' + esc(me.circuito) : ''} · ${esc(me.campania || '')}`;
  let extra = '';
  if (st.tab === 'gente') {
    extra = `<div class="kpis">
      <div class="kpi"><b>${fmtN(s.total)}</b><span>cargados</span></div>
      <div class="kpi"><b class="v-ok">${fmtN(s.conf)}</b><span>confirm.</span></div>
      <div class="kpi"><b class="v-warn">${fmtN(s.tras)}</b><span>traslado</span></div>
      <div class="kpi"><b>${fmtN(s.voto)}</b><span>votaron</span></div>
    </div>`;
  } else if (st.tab === 'dia') {
    extra = `<div class="row" style="justify-content:space-between;align-items:baseline">
        <span class="top-sub">Ya votaron</span>
        <span><b class="num" style="font:800 28px/1 var(--f-display)">${fmtN(s.voto)}</b><span class="top-sub"> de ${fmtN(s.total)} · ${pct(s.voto, s.total)}%</span></span>
      </div>
      <div class="barra-voto" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct(s.voto, s.total)}" aria-label="Porcentaje que ya votó"><i style="width:${pct(s.voto, s.total)}%"></i></div>`;
  }
  $('#top').innerHTML = `
    <div class="top-row">
      <div class="top-titulo"><div class="top-sub">${sub}</div><h1>${titulos[st.tab]}</h1></div>
      <button type="button" class="avatar" data-act="cuenta" aria-label="Mi cuenta">${esc(iniciales(me.nombre))}</button>
    </div>${extra}`;
}

function refrescar() {
  if (!st.me || !$('#main')) return;
  if (st.me.rol === 'fiscal') { refrescarFiscal(); return; }
  pintarTop();
  pintarNav();
  refrescarPartes();
}
function refrescarPartes() {
  if (st.tab === 'gente') pintarLista();
  if (st.tab === 'dia') pintarDia();
  if (st.tab === 'equipo') pintarEquipo();
  if (st.tab === 'panel') { cargarResumen(); pintarTablero(); pintarFiscalizacion(); pintarConflictos(); }
}

// ---------------------------------------------------------------- GENTE
function vistaGente() {
  const equipo = miEquipo();
  const filtros = [['todos', 'Todos'], ['confirmado', 'Confirmados'], ['traslado', 'Traslado'], ['dudoso', 'Dudosos'], ['sin', 'Sin contactar'], ['fiscal', 'Fiscales'], ['revisar', 'A revisar']];
  return `
    <label class="search">${ic('buscar', 18)}<input id="q" type="search" placeholder="Buscar por nombre, DNI o escuela" value="${esc(st.f.q)}" aria-label="Buscar"></label>
    ${esMov() ? '' : `<select id="de" class="input" aria-label="Ver gente de">
        <option value="">Todo mi equipo</option>
        ${ordenarArbol(equipo).map((u) => `<option value="${u.uid}" ${st.f.de === u.uid ? 'selected' : ''}>${'  '.repeat(Math.max(0, nivel(u.rol) - nivel(st.me.rol) - 1))}${esc(u.nombre)} · ${ROL_CORTO[u.rol]}</option>`).join('')}
      </select>`}
    <div class="chips" role="group" aria-label="Filtrar">${filtros.map(([k, l]) => `<button type="button" class="chip" data-act="filtro" data-v="${k}" aria-pressed="${st.f.estado === k}">${l}</button>`).join('')}</div>
    <div id="lista" class="lista"></div>`;
}

function filtrarGente() {
  const q = sinAcentos(st.f.q).trim();
  const qd = normDni(st.f.q);
  return st.personas.filter((p) => {
    if (st.f.de && !p.path.includes(st.f.de)) return false;
    const e = st.f.estado;
    if (e === 'fiscal' && !(p.tipo && p.tipo !== 'votante')) return false;
    if (e === 'revisar' && !p.revisar) return false;
    if (!['todos', 'fiscal', 'revisar'].includes(e) && p.estado !== e) return false;
    if (q) {
      const hay = sinAcentos(`${p.nombre} ${p.escuela} ${p.ownerNombre} ${p.domicilio}`);
      if (!(hay.includes(q) || (qd.length >= 3 && p.dni.includes(qd)))) return false;
    }
    return true;
  }).sort((a, b) => ms(b.creadoAt) - ms(a.creadoAt) || String(a.nombre).localeCompare(b.nombre));
}

function tarjetaPersona(p) {
  const tags = [`<span class="pill p-${esc(p.estado)}">${esc(ESTADO_LABEL[p.estado] || p.estado)}</span>`];
  if (p.voto) tags.push('<span class="pill p-ok">Votó</span>');
  if (p.tipo && p.tipo !== 'votante') tags.push(`<span class="pill p-acc">${esc(TIPO_LABEL[p.tipo])}</span>`);
  if (p.revisar) tags.push('<span class="pill p-warn">Revisar</span>');
  const mio = p.ownerId === st.me.uid;
  const wa = waUrl(p.tel, textoRecordatorio(p));
  return `<div class="row">
    <button type="button" class="persona grow" data-act="ver" data-dni="${p.dni}">
      <div class="grow">
        <div class="n">${esc(p.nombre)}</div>
        <div class="d num">DNI ${fmtDni(p.dni)}${p.escuela ? ' · ' + esc(p.escuela) : ''}${p.mesa ? ' · Mesa ' + esc(p.mesa) : ''}</div>
        ${mio ? '' : `<div class="d">de ${esc(p.ownerNombre)}</div>`}
        <div class="tags">${tags.join('')}</div>
      </div>
    </button>
    ${wa ? `<a class="icon-btn wa" href="${wa}" target="_blank" rel="noopener" aria-label="WhatsApp a ${esc(p.nombre)}">${ic('wa')}</a>` : ''}
  </div>`;
}

function pintarLista() {
  const el = $('#lista');
  if (!el) return;
  const lista = filtrarGente();
  if (liviano()) {
    if (st.errorPagina) { el.innerHTML = `<div class="aviso bad">${ic('alerta', 18)}<span>${esc(st.errorPagina)}</span></div>`; st.errorPagina = null; return; }
    if (st.cargandoPagina && !st.personas.length) { el.innerHTML = '<div class="vacio">Buscando…</div>'; return; }
    const total = conteo('g' + JSON.stringify(filtrosGente()), filtrosGente());
    if (!lista.length) { el.innerHTML = `<div class="vacio">${st.f.q || st.f.estado !== 'todos' || st.f.de ? 'No hay nadie con ese filtro.' : 'Todavía no hay gente cargada.'}${st.f.q && !/^[\d.\s]+$/.test(st.f.q) ? '<div class="small" style="margin-top:6px">Buscá por apellido o nombre completo, o por DNI.</div>' : ''}</div>`; return; }
    el.innerHTML = lista.map(tarjetaPersona).join('') +
      (st.personas.length >= st.f.limite ? `<button class="btn btn-sec mas" data-act="mas">Ver más${total != null ? ` (son ${fmtN(total)})` : ''}</button>` : `<div class="muted small" style="text-align:center">${lista.length} ${lista.length === 1 ? 'persona' : 'personas'}</div>`);
    return;
  }
  if (!st.personas.length) {
    el.innerHTML = `<div class="card vacio stack"><h3>Todavía no cargaste a nadie</h3><div>Tocá <b>Cargar</b> y escribí el DNI: los datos de dónde vota se completan solos.</div><button class="btn" data-act="tab" data-tab="cargar">${ic('mas')} Cargar persona</button></div>`;
    return;
  }
  if (!lista.length) { el.innerHTML = '<div class="vacio">No hay nadie con ese filtro.</div>'; return; }
  el.innerHTML = lista.slice(0, st.f.limite).map(tarjetaPersona).join('') +
    (lista.length > st.f.limite ? `<button class="btn btn-sec mas" data-act="mas">Ver ${Math.min(60, lista.length - st.f.limite)} más (quedan ${lista.length - st.f.limite})</button>` : `<div class="muted small" style="text-align:center">${lista.length} ${lista.length === 1 ? 'persona' : 'personas'}</div>`);
}

function hojaPersona(dni, confirmarBorrado = false) {
  const p = personaLocal(dni);
  if (!p) { cerrarHoja(); return; }
  const destinos = esMov() ? [] : [st.me, ...miEquipo()].filter((u) => u.uid !== p.ownerId);
  const wa = waUrl(p.tel, textoRecordatorio(p));
  const html = `
    <div class="row">
      <div class="grow"><h2>${esc(p.nombre)}</h2><div class="muted num">DNI ${fmtDni(p.dni)} · ${esc(TIPO_LABEL[p.tipo] || 'Votante')}</div></div>
      <button type="button" class="icon-btn" data-act="cerrar" aria-label="Cerrar">${ic('x')}</button>
    </div>
    ${p.revisar ? `<div class="aviso warn">${ic('alerta', 18)}<span>${esc(p.nota || 'Hay datos para revisar')}</span></div>` : ''}
    <div class="card pad stack">
      <dl class="ficha" style="margin:0">
        <div class="full"><dt>Escuela</dt><dd>${esc(p.escuela || 'Sin dato')}</dd>${p.dirEscuela ? `<div class="muted">${esc(p.dirEscuela)}</div>` : ''}</div>
        <div><dt>Mesa</dt><dd class="big">${esc(p.mesa || '–')}</dd></div>
        <div><dt>Orden</dt><dd class="big">${esc(p.orden || '–')}</dd></div>
        <div><dt>Circuito</dt><dd>${esc(p.circuito || '–')}</dd></div>
        <div><dt>Domicilio</dt><dd>${esc(p.domicilio || '–')}</dd></div>
      </dl>
      ${p.escuela ? `<a class="btn btn-sec btn-sm" href="${mapsUrl(p)}" target="_blank" rel="noopener">${ic('mapa', 18)} Cómo llegar</a>` : ''}
    </div>
    <div><span class="label">Estado</span>
      <div class="chips wrap">${ESTADOS.map(([k, l]) => `<button type="button" class="chip est" data-act="p-estado" data-v="${k}" aria-pressed="${p.estado === k}">${l}</button>`).join('')}</div>
    </div>
    <div><label class="label" for="p-tel">Teléfono</label>
      <div class="row"><input id="p-tel" class="input" inputmode="tel" value="${esc(p.tel)}" placeholder="381…">
      ${wa ? `<a class="icon-btn wa" href="${wa}" target="_blank" rel="noopener" aria-label="Mandar recordatorio por WhatsApp">${ic('wa')}</a>` : ''}</div>
    </div>
    <div><label class="label" for="p-tipo">Rol el día de la elección</label>
      <select id="p-tipo" class="input">${TIPOS.map(([k, l]) => `<option value="${k}" ${p.tipo === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
    </div>
    <div><label class="label" for="p-nota">Nota</label><textarea id="p-nota" class="input" rows="2" placeholder="Ej: lo busca Diego a las 10">${esc(p.revisar ? '' : p.nota)}</textarea></div>
    <button type="button" class="btn btn-full ${p.voto ? 'btn-ok' : ''}" data-act="p-voto">${p.voto ? ic('ok') + ' Ya votó · tocar para deshacer' : 'Marcar que ya votó'}</button>
    <div class="muted">Es de <b>${esc(p.ownerNombre)}</b>${p.ownerId === st.me.uid ? ' (vos)' : ''}</div>
    ${p.tipo && p.tipo !== 'votante' ? (st.usuarios.some((u) => u.dni === p.dni)
      ? `<div class="aviso ok">${ic('ok', 18)}<span>Ya tiene acceso a la app como fiscal.</span></div>`
      : `<button type="button" class="btn btn-sec" data-act="fiscal-acceso" data-dni="${p.dni}">${ic('fiscal', 18)} Darle acceso a la app como fiscal</button>`) : ''}
    ${destinos.length ? `<div><label class="label" for="p-trans">Pasar a otra persona de tu equipo</label>
      <div class="row"><select id="p-trans" class="input grow">${destinos.map((u) => `<option value="${u.uid}">${esc(u.nombre)} · ${ROL_CORTO[u.rol]}</option>`).join('')}</select>
      <button type="button" class="btn btn-sec" data-act="p-transferir">Pasar</button></div></div>` : ''}
    ${confirmarBorrado
      ? `<div class="card pad stack"><b>¿Quitar a ${esc(primerNombre(p.nombre))} de la lista?</b><div class="row"><button class="btn btn-bad grow" data-act="p-eliminar-si">Sí, quitar</button><button class="btn btn-sec grow" data-act="p-eliminar-no">Cancelar</button></div></div>`
      : '<button type="button" class="btn btn-ghost" data-act="p-eliminar">Quitar de la lista</button>'}`;
  if (sheetCtx?.dni === dni) hojaHtml(html); else abrirHoja(html, { tipo: 'persona', dni });
}

// ---------------------------------------------------------------- CARGAR
function vistaCargar() {
  return `
    <div class="card pad stack">
      <label class="label" for="c-dni" style="margin:0">DNI de la persona</label>
      <div class="row">
        <input id="c-dni" class="input input-dni grow" inputmode="numeric" autocomplete="off" placeholder="Ej: 38512004" value="${esc(st.c.dniTxt || '')}">
        <button type="button" class="btn" data-act="c-buscar" style="min-height:52px">Buscar</button>
      </div>
      <div class="muted small">Con o sin puntos. Al buscar se completan los datos del padrón.</div>
      ${DEMO ? '<div class="muted small demo-tip">Para probar: <b>38512004</b> (libre) · <b>22731880</b> (ya es de otro movilizador) · <b>12345678</b> (no está en el padrón)</div>' : ''}
    </div>
    <div id="c-res" class="stack">${resultadoCargar()}</div>`;
}

function resultadoCargar() {
  const c = st.c;
  if (c.fase === 'inicio') return '';
  if (c.fase === 'buscando') return '<div class="card pad muted">Buscando…</div>';
  if (c.fase === 'invalido') return `<div class="aviso bad">${ic('alerta', 18)}<span>El DNI tiene que tener 7 u 8 números.</span></div>`;
  if (c.fase === 'error') return `<div class="aviso bad">${ic('alerta', 18)}<span>${esc(c.error)}</span></div>`;
  if (c.fase === 'propia') {
    const p = c.persona;
    return `<div class="card pad stack">
      <div class="aviso info">${ic('ok', 18)}<span>Ya está en tu equipo${p.ownerId === st.me.uid ? ', cargada por vos' : ', es de ' + esc(p.ownerNombre)}.</span></div>
      <h3>${esc(p.nombre)}</h3><div class="muted">${esc(p.escuela || '')}${p.mesa ? ' · Mesa ' + esc(p.mesa) : ''}</div>
      <button class="btn btn-sec" data-act="ver" data-dni="${p.dni}">Ver ficha</button>
    </div>`;
  }
  if (c.fase === 'ocupada') {
    return `<div class="card pad stack bloqueo">
        <div class="ico">${ic('candado', 32)}</div>
        <h2>Este DNI ya está cargado</h2>
        <div>Pertenece a otra persona de la campaña. No se puede cargar dos veces.</div>
        <div class="muted small">Por privacidad no se muestra de quién es. El intento quedó registrado para las cabezas.</div>
      </div>
      <div class="card pad stack">
        <label class="label" for="c-motivo" style="margin:0">¿Creés que es tuya? Contá por qué</label>
        <textarea id="c-motivo" class="input" rows="3" placeholder="Ej: es mi vecino, lo vengo trabajando desde el año pasado"></textarea>
        <div class="muted small">Lo deciden las cabezas desde el Panel.</div>
        <button class="btn btn-full" data-act="c-reclamar">Enviar reclamo</button>
        <button class="btn btn-ghost" data-act="c-otro">Cargar otro DNI</button>
      </div>`;
  }
  if (c.fase === 'reclamado') {
    return `<div class="aviso ok">${ic('ok', 18)}<span>Reclamo enviado. Te avisa tu superior cuando se resuelva.</span></div>
      <button class="btn btn-sec" data-act="c-otro">Cargar otro DNI</button>`;
  }
  // libre
  const pd = c.padron;
  const otroCirc = pd && st.me.circuito && pd.circuito && pd.circuito !== st.me.circuito;
  const duenos = esMov() ? [] : [st.me, ...miEquipo()];
  return `
    ${pd ? `<div class="card">
      <div class="aviso ok card-head" style="border-radius:var(--r) var(--r) 0 0">${ic('ok', 18)}<span>Encontrado en el padrón · libre para cargar</span></div>
      <dl class="ficha pad" style="margin:0">
        <div class="full"><dt>Nombre</dt><dd style="font-size:16px">${esc(pd.nombre)}</dd></div>
        <div class="full"><dt>Escuela</dt><dd>${esc(pd.escuela || '–')}</dd>${pd.dirEscuela ? `<div class="muted">${esc(pd.dirEscuela)}</div>` : ''}</div>
        <div><dt>Mesa</dt><dd class="big">${esc(pd.mesa || '–')}</dd></div>
        <div><dt>Orden</dt><dd class="big">${esc(pd.orden || '–')}</dd></div>
        <div><dt>Circuito</dt><dd>${esc(pd.circuito || '–')}</dd></div>
        <div><dt>Domicilio</dt><dd>${esc(pd.domicilio || '–')}</dd></div>
      </dl>
    </div>
    ${otroCirc ? `<div class="aviso warn">${ic('alerta', 18)}<span>Vota en el circuito ${esc(pd.circuito)}, no en el tuyo (${esc(st.me.circuito)}). Podés cargarla igual.</span></div>` : ''}`
    : `<div class="aviso warn">${ic('alerta', 18)}<span>No figura en el padrón cargado. Podés cargarla igual y queda marcada para revisar.</span></div>
       <div class="card pad"><label class="label" for="c-nombre">Nombre y apellido</label><input id="c-nombre" class="input" maxlength="80"></div>`}
    <div class="card pad stack">
      <div><label class="label" for="c-tel">Teléfono (WhatsApp)</label><input id="c-tel" class="input" inputmode="tel" placeholder="381…"></div>
      <div><span class="label">Estado</span>
        <div class="chips wrap">${ESTADOS.map(([k, l]) => `<button type="button" class="chip est" data-act="c-estado" data-v="${k}" aria-pressed="${c.estado === k}">${l}</button>`).join('')}</div>
      </div>
      <div><label class="label" for="c-tipo">Rol el día de la elección</label>
        <select id="c-tipo" class="input">${TIPOS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
      ${duenos.length > 1 ? `<div><label class="label" for="c-dueno">Cargar a nombre de</label>
        <select id="c-dueno" class="input">${ordenarArbol(duenos).map((u) => `<option value="${u.uid}">${esc(u.nombre)}${u.uid === st.me.uid ? ' (vos)' : ' · ' + ROL_CORTO[u.rol]}</option>`).join('')}</select></div>` : ''}
      <label class="check"><input type="checkbox" id="c-ok"> La persona aceptó que la contactemos por la elección.</label>
      <div class="error" id="c-err" role="alert"></div>
      <button class="btn btn-full" data-act="c-guardar">Guardar</button>
    </div>`;
}
const pintarCargar = () => { const r = $('#c-res'); if (r) r.innerHTML = resultadoCargar(); };

let buscandoDni = null;
async function buscarDni() {
  const txt = $('#c-dni')?.value || '';
  const dni = normDni(txt);
  st.c = { fase: 'buscando', dniTxt: txt, dni, estado: 'confirmado' };
  if (!dniValido(dni)) { st.c.fase = 'invalido'; pintarCargar(); return; }
  pintarCargar();
  buscandoDni = dni;
  try {
    const [cons, padron] = await Promise.all([S.consultarPersona(dni), S.buscarPadron(dni).catch(() => null)]);
    if (buscandoDni !== dni) return;
    if (cons.estado === 'propia') Object.assign(st.c, { fase: 'propia', persona: cons.persona });
    else if (cons.estado === 'ocupada') {
      const r = await S.cargarPersona({ dni, nombre: padron?.nombre || '' }); // registra el intento
      Object.assign(st.c, { fase: 'ocupada', conflictoId: r.id });
    } else Object.assign(st.c, { fase: 'libre', padron });
  } catch (e) {
    Object.assign(st.c, { fase: 'error', error: mensajeError(e) });
  }
  pintarCargar();
  if (st.c.fase === 'libre') $('#c-tel')?.focus();
}

async function guardarCarga() {
  const c = st.c;
  const err = $('#c-err');
  if (!$('#c-ok').checked) { err.textContent = 'Confirmá que la persona aceptó que la contacten.'; return; }
  const pd = c.padron;
  const nombre = pd ? pd.nombre : ($('#c-nombre')?.value || '').trim();
  if (!nombre) { err.textContent = 'Escribí el nombre y apellido.'; $('#c-nombre')?.focus(); return; }
  const dueno = usuarioPorId($('#c-dueno')?.value) || st.me;
  const datos = {
    dni: c.dni, nombre,
    domicilio: pd?.domicilio || '', circuito: pd?.circuito || dueno.circuito || '', escuela: pd?.escuela || '',
    dirEscuela: pd?.dirEscuela || '', mesa: pd?.mesa || '', orden: pd?.orden || '',
    tel: normDni($('#c-tel').value), estado: c.estado, tipo: $('#c-tipo').value,
    enPadron: !!pd, revisar: !pd, nota: pd ? '' : 'Revisar: no figura en el padrón'
  };
  const btn = $('[data-act="c-guardar"]');
  btn.disabled = true;
  try {
    const r = await S.cargarPersona(datos, dueno);
    if (r.conflicto) { Object.assign(st.c, { fase: 'ocupada', conflictoId: r.id }); pintarCargar(); return; }
    if (r.yaEnEquipo) { Object.assign(st.c, { fase: 'propia', persona: r.persona }); pintarCargar(); return; }
    toast(r.pendiente ? `${primerNombre(nombre)} quedó guardada. Se sincroniza cuando haya señal.` : `${primerNombre(nombre)} quedó en ${dueno.uid === st.me.uid ? 'tu lista' : 'la lista de ' + dueno.nombre}`);
    st.c = { fase: 'inicio' };
    $('#c-dni').value = '';
    pintarCargar();
    $('#c-dni').focus();
  } catch (e) {
    err.textContent = mensajeError(e);
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------- DÍA E
function vistaDia() { return '<div id="dia" class="stack"></div>'; }

function pintarDia() {
  const el = $('#dia');
  if (!el) return;
  if (liviano()) { pintarDiaCabeza(el); return; }
  const s = stats(st.personas);
  const traslados = st.personas.filter((p) => p.estado === 'traslado' && !p.voto);
  const lista = st.personas.filter((p) => st.dia.solo === 'todos' || !p.voto);
  const grupos = {};
  for (const p of lista) (grupos[p.escuela || 'Sin escuela asignada'] ||= []).push(p);
  const totEsc = {};
  for (const p of st.personas) { const k = p.escuela || 'Sin escuela asignada'; totEsc[k] ||= [0, 0]; totEsc[k][0]++; if (p.voto) totEsc[k][1]++; }
  const orden = Object.keys(grupos).sort((a, b) => a.localeCompare(b));
  el.innerHTML = `
    ${traslados.length ? `<div class="card">
      <div class="escuela-h"><span style="color:var(--warn)">${ic('auto', 22)}</span><div class="grow"><h3>${traslados.length} ${traslados.length === 1 ? 'traslado pendiente' : 'traslados pendientes'}</h3><div class="muted small">Necesitan que los lleven a votar</div></div></div>
      ${traslados.slice(0, 8).map((p) => `<div class="votante"><div class="grow"><div style="font-weight:600">${esc(p.nombre)}</div><div class="muted small">${esc(p.domicilio || p.escuela || '')}</div></div>
        ${p.tel ? `<a class="icon-btn wa" href="${waUrl(p.tel, 'Hola ' + primerNombre(p.nombre) + '! Te pasamos a buscar para ir a votar. ¿A qué hora te queda bien?')}" target="_blank" rel="noopener" aria-label="WhatsApp a ${esc(p.nombre)}">${ic('wa')}</a>` : ''}</div>`).join('')}
      ${traslados.length > 8 ? `<div class="votante muted small">y ${traslados.length - 8} más (filtrá por "Traslado" en Gente)</div>` : ''}
    </div>` : ''}
    <div class="chips" role="group" aria-label="Mostrar">
      <button class="chip" data-act="dia-solo" data-v="pend" aria-pressed="${st.dia.solo === 'pend'}">Faltan votar (${s.total - s.voto})</button>
      <button class="chip" data-act="dia-solo" data-v="todos" aria-pressed="${st.dia.solo === 'todos'}">Todos (${s.total})</button>
    </div>
    ${!st.personas.length ? '<div class="card vacio">Cuando cargues gente, acá vas a ver a quién le falta votar, agrupado por escuela.</div>' : ''}
    ${st.personas.length && !lista.length ? `<div class="aviso ok">${ic('ok', 18)}<span>¡Votaron todos!</span></div>` : ''}
    ${orden.map((esc_) => {
      const ps = grupos[esc_].sort((a, b) => String(a.mesa).localeCompare(String(b.mesa)) || (+a.orden || 0) - (+b.orden || 0));
      const [tot, vot] = totEsc[esc_];
      return `<div class="card">
        <div class="escuela-h"><div class="grow"><h3>${esc(esc_)}</h3><div class="muted small">${esc(ps[0].dirEscuela || '')}${ps[0].dirEscuela ? ' · ' : ''}${vot} de ${tot} votaron</div></div>
          ${ps[0].escuela ? `<a class="btn btn-sec btn-sm" href="${mapsUrl(ps[0])}" target="_blank" rel="noopener">${ic('mapa', 16)} Ir</a>` : ''}</div>
        ${ps.map((p) => `<div class="votante">
          <div class="grow"><div style="font-weight:600">${esc(p.nombre)}</div>
          <div class="muted small num">Mesa ${esc(p.mesa || '–')} · orden ${esc(p.orden || '–')}${p.ownerId !== st.me.uid ? ' · de ' + esc(p.ownerNombre) : ''}</div></div>
          <button class="btn-voto ${p.voto ? 'si' : ''}" data-act="voto" data-dni="${p.dni}" aria-pressed="${!!p.voto}">${p.voto ? '✓ Votó' : 'Ya votó'}</button>
        </div>`).join('')}
      </div>`;
    }).join('')}`;
}

function htmlTraslados(traslados, total) {
  if (!total) return '';
  return `<div class="card">
      <div class="escuela-h"><span style="color:var(--warn)">${ic('auto', 22)}</span><div class="grow"><h3>${fmtN(total)} ${total === 1 ? 'traslado pendiente' : 'traslados pendientes'}</h3><div class="muted small">Necesitan que los lleven a votar</div></div></div>
      ${traslados.slice(0, 8).map((p) => `<div class="votante"><div class="grow"><div style="font-weight:600">${esc(p.nombre)}</div><div class="muted small">${esc(p.domicilio || p.escuela || '')}</div></div>
        ${p.tel ? `<a class="icon-btn wa" href="${waUrl(p.tel, 'Hola ' + primerNombre(p.nombre) + '! Te pasamos a buscar para ir a votar. ¿A qué hora te queda bien?')}" target="_blank" rel="noopener" aria-label="WhatsApp a ${esc(p.nombre)}">${ic('wa')}</a>` : ''}</div>`).join('')}
      ${total > 8 ? `<div class="votante muted small">y ${fmtN(total - 8)} más (filtrá por "Traslado" en Gente)</div>` : ''}
    </div>`;
}

// La cabeza ve el día de la elección en números; marcar votos lo hace cada equipo con su gente
function pintarDiaCabeza(el) {
  cargarResumen();
  const s = statsGlobal();
  const falta = s.total != null && s.voto != null ? s.total - s.voto : null;
  el.innerHTML = `
    <div class="card pad stack">
      <div class="row" style="justify-content:space-between"><h3>Avance de la votación</h3><b class="num">${pct(s.voto, s.total)}%</b></div>
      <div class="bar"><i style="width:${pct(s.voto, s.total)}%"></i></div>
      <div class="row small num" style="justify-content:space-between"><span><b>${fmtN(s.voto)}</b> votaron</span><span><b>${fmtN(falta)}</b> faltan</span><span><b>${fmtN(s.total)}</b> cargados</span></div>
      <div class="muted small">Se actualiza solo. Cada movilizador marca a su gente en su celular; si querés marcar a alguien, buscalo en Gente.</div>
    </div>
    ${htmlTraslados(st.personas.filter((p) => p.estado === 'traslado' && !p.voto), s.trasPend)}
    ${bloqueCircuitos({})}`;
}

// ---------------------------------------------------------------- EQUIPO
function ordenarArbol(usuarios) {
  const hijos = {};
  const ids = new Set(usuarios.map((u) => u.uid));
  for (const u of usuarios) {
    const padre = u.parentId && ids.has(u.parentId) ? u.parentId : '__raiz';
    (hijos[padre] ||= []).push(u);
  }
  const out = [];
  const rec = (k) => (hijos[k] || []).sort((a, b) => nivel(a.rol) - nivel(b.rol) || a.nombre.localeCompare(b.nombre)).forEach((u) => { out.push(u); rec(u.uid); });
  rec('__raiz');
  return out;
}

function conteoPorUsuario() {
  const m = {};
  for (const p of st.personas) for (const uid of p.path || []) { m[uid] ||= [0, 0]; m[uid][0]++; if (p.voto) m[uid][1]++; }
  return m;
}

function vistaEquipo() {
  const abajo = rolAbajo(st.me.rol);
  return `
    <div class="row wrap">
      ${abajo ? `<button class="btn grow" data-act="nuevo-usuario" data-rol="${abajo}">${ic('mas')} Agregar ${ROL_CORTO[abajo].toLowerCase()}</button>` : ''}
      ${st.me.rol === 'cabeza' ? `<button class="btn btn-sec" data-act="nuevo-usuario" data-rol="cabeza">${ic('mas')} Cabeza</button>` : ''}
    </div>
    <div class="muted small">Cada uno agrega a los del nivel de abajo: cabezas → encargados de circuito → dirigentes → movilizadores. Cada uno ve solo a su gente y a la de su equipo.</div>
    <div id="equipo"></div>`;
}

function pintarEquipo() {
  const el = $('#equipo');
  if (!el) return;
  const cont = liviano() ? {} : conteoPorUsuario();
  const visibles = (st.me.rol === 'cabeza' ? st.usuarios : st.usuarios.filter((u) => u.path.includes(st.me.uid))).filter((u) => u.rol !== 'fiscal');
  const ids = new Set(visibles.map((u) => u.uid));
  const hijos = {};
  for (const u of visibles) {
    const padre = u.parentId && ids.has(u.parentId) ? u.parentId : '__raiz';
    (hijos[padre] ||= []).push(u);
  }
  for (const k in hijos) hijos[k].sort((a, b) => nivel(a.rol) - nivel(b.rol) || a.nombre.localeCompare(b.nombre));
  if (!st.abiertos) st.abiertos = new Set([st.me.uid]);
  const raices = st.me.rol === 'cabeza' ? (hijos.__raiz || []) : [st.me];
  if (!(hijos[st.me.uid] || []).length && st.me.rol !== 'cabeza') {
    el.innerHTML = '<div class="card vacio">Todavía no agregaste a nadie a tu equipo.</div>';
    return;
  }
  const fila = (u, prof) => {
    const [n, v] = contU(cont, u.uid);
    const subs = hijos[u.uid] || [];
    const abierto = st.abiertos.has(u.uid);
    const wa = waUrl(u.tel);
    const PLURAL = { cabeza: 'cabezas', encargado: 'encargados', dirigente: 'dirigentes', movilizador: 'movilizadores', fiscal: 'fiscales' };
    const detalle = subs.length ? `${subs.length} ${subs.length === 1 ? ROL_CORTO[subs[0].rol].toLowerCase() : PLURAL[subs[0].rol]}` : '';
    let html = `<div class="miembro" style="padding-left:${10 + prof * 18}px">
      <button type="button" class="miembro-btn" data-act="eq-toggle" data-uid="${u.uid}" aria-expanded="${abierto}">
        <span class="chev" aria-hidden="true">${abierto ? '▾' : '▸'}</span>
        <span class="ini rol-${u.rol}">${esc(iniciales(u.nombre))}</span>
        <span class="grow" style="text-align:left"><span style="display:block;font-weight:700">${esc(u.nombre)}${u.uid === st.me.uid ? ' <span class="muted">(vos)</span>' : ''}</span>
          <span class="muted small" style="display:block">${ROL_CORTO[u.rol]}${u.circuito ? ' · Circ. ' + esc(u.circuito) : ''}${detalle ? ' · ' + detalle : ''}</span>
          <span class="small num" style="display:block"><b>${fmtN(n)}</b> cargados · <b>${fmtN(v)}</b> votaron${n ? ` · ${pct(v, n)}%` : ''}</span></span>
      </button>
      ${wa && u.uid !== st.me.uid ? `<a class="icon-btn wa" href="${wa}" target="_blank" rel="noopener" aria-label="WhatsApp a ${esc(u.nombre)}">${ic('wa')}</a>` : ''}
      ${u.uid !== st.me.uid ? `<button type="button" class="icon-btn" data-act="eq-opciones" data-uid="${u.uid}" aria-label="Opciones de ${esc(u.nombre)}: agregar a su equipo o quitar">${ic('mas3')}</button>` : ''}
    </div>`;
    if (!abierto) return html;
    if (subs.length) return html + subs.map((h) => fila(h, prof + 1)).join('');
    // Sin equipo debajo: mostramos su gente
    const g0 = genteDeUsuario(u.uid);
    html += `<div class="gente-de" style="padding-left:${14 + prof * 8}px">`;
    if (!g0) return html + '<div class="muted small">Cargando…</div></div>';
    const gente = [...g0].sort((a, b) => String(a.nombre).localeCompare(b.nombre));
    if (!gente.length) html += '<div class="muted small">Todavía no cargó a nadie.</div>';
    html += gente.slice(0, 30).map((p) => `<button type="button" class="gente-item" data-act="ver" data-dni="${p.dni}">
        <span class="grow" style="text-align:left">${esc(p.nombre)}<span class="muted small" style="display:block">${p.escuela ? esc(p.escuela) + ' · ' : ''}${p.mesa ? 'Mesa ' + esc(p.mesa) : ''}</span></span>
        <span class="pill ${p.voto ? 'p-ok' : 'p-' + esc(p.estado)}">${p.voto ? 'Votó' : esc(ESTADO_LABEL[p.estado] || '')}</span></button>`).join('');
    if (gente.length > 30) html += `<button type="button" class="btn btn-ghost btn-sm" data-act="eq-ver-gente" data-uid="${u.uid}">Ver ${liviano() ? `las ${fmtN(n)}` : `las ${gente.length}`} personas</button>`;
    return html + '</div>';
  };
  el.innerHTML = `<div class="card">${raices.map((u) => fila(u, 0)).join('')}</div>
    <div class="muted small">Tocá un nombre para ver su equipo. En los movilizadores se ve su gente.</div>`;
}

function hojaQuitarUsuario(uid) {
  const u = usuarioPorId(uid);
  if (!u) return;
  const debajo = st.usuarios.filter((x) => x.uid !== u.uid && x.path.includes(u.uid));
  const nGente = liviano() ? conteo('o' + u.uid, [['ownerId', '==', u.uid]]) : st.personas.filter((p) => p.ownerId === u.uid).length;
  if (nGente == null) { S.contar([['ownerId', '==', u.uid]]).then((n) => { conteos['o' + u.uid] = { n, t: Date.now() }; hojaQuitarUsuario(uid); }).catch((e) => toast(mensajeError(e))); return; }
  const destinos = [st.me, ...miEquipo()].filter((x) => x.uid !== u.uid && !x.path.includes(u.uid));
  abrirHoja(`
    <div class="row"><div class="ini rol-${u.rol}" style="width:48px;height:48px;border-radius:24px">${esc(iniciales(u.nombre))}</div>
      <div class="grow"><h2>${esc(u.nombre)}</h2><div class="muted num">${ROL_LABEL[u.rol]} · DNI ${fmtDni(u.dni)}</div></div>
      <button type="button" class="icon-btn" data-act="cerrar" aria-label="Cerrar">${ic('x')}</button></div>
    ${rolAbajo(u.rol) ? `<button class="btn btn-full" data-act="nuevo-usuario" data-rol="${rolAbajo(u.rol)}" data-padre="${u.uid}">${ic('mas')} Agregar ${ROL_CORTO[rolAbajo(u.rol)].toLowerCase()} a su equipo</button>` : ''}
    ${S.puedeBlanquear ? `<button class="btn btn-sec btn-full" data-act="blanquear" data-uid="${u.uid}">${ic('llave', 18)} Se olvidó la contraseña: blanquear</button>` : ''}
    ${debajo.length ? `<div class="aviso warn">${ic('alerta', 18)}<span>Tiene ${debajo.length} ${debajo.length === 1 ? 'persona' : 'personas'} en su equipo. Para quitarlo, primero quitá a los que tiene debajo.</span></div>` : `
    <div class="card pad stack">
      <h3>Quitar del equipo</h3>
      <div class="muted">Deja de poder entrar a la app. Si lo agregaste con un error (nombre, rol o superior equivocado), quitalo y volvé a agregarlo bien: puede usar el mismo DNI.</div>
      ${nGente ? `<div><label class="label" for="qu-destino">Sus ${fmtN(nGente)} personas cargadas</label>
        <select id="qu-destino" class="input">
          ${ordenarArbol(destinos).map((x) => `<option value="${x.uid}">Pasan a ${esc(x.nombre)}${x.uid === st.me.uid ? ' (vos)' : ' · ' + ROL_CORTO[x.rol]}</option>`).join('')}
          <option value="__borrar">Se borran</option>
        </select></div>` : '<div class="muted small">No cargó a nadie.</div>'}
      <div class="error" id="qu-err" role="alert"></div>
      <button class="btn btn-bad btn-full" data-act="eq-quitar" data-uid="${u.uid}">Quitar a ${esc(primerNombre(u.nombre))}</button>
    </div>`}`, { tipo: 'usuario' });
}

function hojaNuevoUsuario(rol, padreUid) {
  const clave = String(Math.floor(100000 + Math.random() * 900000));
  const padre = padreUid ? usuarioPorId(padreUid) : null;
  abrirHoja(`
    <div class="row"><div class="grow"><h2>Agregar ${ROL_CORTO[rol].toLowerCase()}</h2>${padre ? `<div class="muted">Al equipo de ${esc(padre.nombre)}</div>` : ''}</div><button type="button" class="icon-btn" data-act="cerrar" aria-label="Cerrar">${ic('x')}</button></div>
    <form id="f-usuario" class="stack" data-rol="${rol}" data-padre="${padre ? padre.uid : ''}" autocomplete="off">
      <div><label class="label" for="nu-nom">Nombre y apellido</label><input id="nu-nom" class="input" required maxlength="60"></div>
      <div><label class="label" for="nu-dni">DNI (con esto entra a la app)</label><input id="nu-dni" class="input" inputmode="numeric" required></div>
      <div><label class="label" for="nu-tel">Teléfono</label><input id="nu-tel" class="input" inputmode="tel" placeholder="381…"></div>
      ${rol === 'encargado' ? '<div><label class="label" for="nu-circ">Circuito a cargo</label><input id="nu-circ" class="input" inputmode="numeric" required placeholder="Ej: 19"></div>' : ''}
      <div><label class="label" for="nu-pass">Contraseña inicial</label><input id="nu-pass" class="input num" value="${clave}" minlength="6" required></div>
      <div class="error" id="nu-err" role="alert"></div>
      <button class="btn btn-full" type="submit">Crear y compartir acceso</button>
    </form>`, { tipo: 'usuario' });
  $('#nu-nom').focus();
}

async function crearUsuario(form) {
  const rol = form.dataset.rol;
  const padre = form.dataset.padre ? usuarioPorId(form.dataset.padre) : null;
  const nombre = $('#nu-nom').value.trim();
  const dni = normDni($('#nu-dni').value);
  const tel = normDni($('#nu-tel').value);
  const pass = $('#nu-pass').value.trim();
  const circuito = normDni($('#nu-circ')?.value || '') || '';
  const err = $('#nu-err');
  if (!dniValido(dni)) { err.textContent = 'El DNI tiene que tener 7 u 8 números.'; return; }
  const ya = st.usuarios.find((u) => u.dni === dni);
  if (ya) {
    const jefe = usuarioPorId(ya.parentId);
    err.textContent = `${ya.nombre} ya está en el equipo como ${ROL_CORTO[ya.rol].toLowerCase()}${jefe ? ', debajo de ' + jefe.nombre : ''}. No se puede agregar dos veces.`;
    return;
  }
  if (pass.length < 6 && !DEMO) { err.textContent = 'La contraseña tiene que tener al menos 6 caracteres.'; return; }
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true; btn.textContent = 'Creando…';
  try {
    const r = await S.crearUsuario({ dni, nombre, tel, rol, pass, circuito, padre });
    const link = location.origin + location.pathname;
    const msg = `Hola ${primerNombre(nombre)}! Ya tenés acceso a ${APP_NAME} como ${ROL_CORTO[rol].toLowerCase()}${circuito ? ' del circuito ' + circuito : ''}.\nEntrá en ${link}\nDNI: ${dni}\nContraseña: ${r?.reactivado ? 'la misma que usabas antes' : pass}`;
    const wa = waUrl(tel, msg);
    hojaHtml(`
      <div class="aviso ok">${ic('ok', 18)}<span>${esc(nombre)} ya puede entrar${padre ? ' · quedó en el equipo de ' + esc(padre.nombre) : ''}.</span></div>
      <div class="card pad stack"><div class="muted small">Mandale este mensaje:</div><div style="white-space:pre-line" id="nu-msg">${esc(msg)}</div></div>
      ${wa ? `<a class="btn btn-full" href="${wa}" target="_blank" rel="noopener">${ic('wa')} Enviar por WhatsApp</a>` : ''}
      <button class="btn btn-sec" data-act="copiar" data-txt="${esc(msg)}">Copiar mensaje</button>
      <button class="btn btn-ghost" data-act="cerrar">Listo</button>`);
  } catch (e) {
    err.textContent = mensajeError(e);
    btn.disabled = false; btn.textContent = 'Crear y compartir acceso';
  }
}

// ---------------------------------------------------------------- PANEL
function vistaPanel() {
  const herr = (id, icono, titulo, sub, cuerpo) => `
    <details class="herr" name="herr" id="h-${id}">
      <summary><span class="herr-ic">${ic(icono, 20)}</span><span class="grow"><b>${titulo}</b><span class="muted small" style="display:block">${sub}</span></span><span class="chev" aria-hidden="true">▸</span></summary>
      <div class="herr-body stack">${cuerpo}</div>
    </details>`;
  const subir = (pre, texto) => `<label class="archivo" for="${pre}-file">${ic('subir', 22)}<div><b>${texto}</b></div><input id="${pre}-file" type="file" accept=".xlsx,.xls,.csv,.docx,.ods"></label><div id="${pre}-res" class="stack"></div>`;
  return `
    <div id="tablero" class="stack"></div>
    <div id="fiscalizacion" class="stack"></div>
    <div id="conflictos"></div>
    <div class="sec-title"><h2>Herramientas</h2></div>
    <div class="stack" style="gap:8px">
      ${herr('gente', 'gente', 'Cargar lista de gente', 'Excel, CSV o Word de tu equipo', `
        <div class="muted">Detecta las columnas solo, limpia los DNI y completa escuela y mesa con el padrón. Los DNI que ya son de otro no se importan.</div>
        ${subir('imp', 'Elegir archivo')}`)}
      ${herr('fiscales', 'fiscal', 'Cargar fiscales', 'Planilla de titulares y suplentes', `
        <div class="muted">Todos quedan como <b>fiscales</b>. Si en la planilla hay una fila que dice <b>SUPLENTES</b>, los de abajo quedan como suplentes. Si alguno ya estaba en tu equipo como votante, pasa a ser fiscal.</div>
        ${subir('fis', 'Elegir planilla de fiscales')}`)}
      ${puedePadron() ? herr('padron', 'padron', 'Padrón oficial', 'Solo cabezas' + (S.padronCantidad?.() != null ? ` · ${S.padronCantidad().toLocaleString('es-AR')} electores` : ''), `
        <div class="muted">Subí el padrón que recibe el partido (Excel o CSV). Con esto, al escribir un DNI se completan nombre, escuela, mesa y orden.</div>
        <div><label class="label" for="pad-circ">Circuito (si el archivo no trae esa columna)</label><input id="pad-circ" class="input" inputmode="numeric" value="${esc(st.me.circuito || '')}" placeholder="Ej: 19"></div>
        <label class="archivo" for="pad-file">${ic('subir', 22)}<div><b>Elegir padrón</b></div><input id="pad-file" type="file" accept=".xlsx,.xls,.csv,.ods,.docx"></label>
        <div id="pad-res" class="stack"></div>`) : ''}
      ${st.me.rol === 'cabeza' ? herr('listas', 'fiscal', 'Listas del escrutinio', 'Las que cargan los fiscales del acta', `
        <div class="muted">Cargá <b>todas</b> las listas que compiten, no solo la tuya, una por renglón y como figuran en el acta. Blancos, nulos, recurridos e impugnados ya vienen incluidos. No cambies los nombres una vez que los fiscales empezaron a cargar.</div>
        <div><label class="label" for="listas-txt">Listas</label>
        <textarea id="listas-txt" class="input" rows="5" placeholder="Lista 501 · Nuestro frente&#10;Lista 502 · …">${esc((st.me.listas || []).map((l) => l.nombre).join('\n'))}</textarea></div>
        <div><label class="label" for="cats-txt">Categorías del acta (una por renglón, en el orden del acta)</label>
        <textarea id="cats-txt" class="input" rows="3" placeholder="Gobernador&#10;Legisladores&#10;Concejales">${esc((st.me.categorias || []).map((l) => l.nombre).join('\n'))}</textarea>
        <div class="muted small" style="margin-top:4px">Si la elección tiene una sola categoría, dejalo vacío.</div></div>
        <button class="btn" data-act="listas-guardar">Guardar</button>`) : ''}
      ${herr('excel', 'bajar', 'Descargar Excel', 'Toda la gente de tu equipo', `
        <button class="btn btn-sec" data-act="exportar">${ic('bajar')} Descargar Excel</button>`)}
      ${st.me.rol === 'cabeza' ? herr('borrar', 'alerta', 'Borrar datos', 'Para empezar de nuevo', `
        <div class="muted">No se puede deshacer.</div>
        <div><label class="label" for="borrar-que">Qué borrar</label>
          <select id="borrar-que" class="input">
            <option value="personas">Toda la gente cargada (${fmtN(liviano() ? statsGlobal().total : st.personas.length)})</option>
            <option value="padron">El padrón</option>
          </select></div>
        <div><label class="label" for="borrar-ok">Escribí BORRAR para confirmar</label><input id="borrar-ok" class="input" autocomplete="off"></div>
        <button class="btn btn-bad" data-act="borrar">Borrar</button>
        <div id="borrar-res" class="stack"></div>`) : ''}
    </div>`;
}

function pintarTablero() {
  const el = $('#tablero');
  if (!el) return;
  const s = statsGlobal();
  const porCirc = {};
  if (!liviano()) for (const p of st.personas) { const k = p.circuito || '–'; porCirc[k] ||= [0, 0]; porCirc[k][0]++; if (p.voto) porCirc[k][1]++; }
  const rolRanking = st.me.rol === 'cabeza' ? 'encargado' : rolAbajo(st.me.rol);
  const cont = liviano() ? {} : conteoPorUsuario();
  const ranking = st.usuarios.filter((u) => u.rol === rolRanking && (st.me.rol === 'cabeza' || u.parentId === st.me.uid))
    .map((u) => { const [n, v] = contU(cont, u.uid); return { u, n, v }; })
    .sort((a, b) => (b.n || 0) - (a.n || 0));
  el.innerHTML = `
    <div class="tiles">
      <div class="tile t-acc"><b>${fmtN(s.total)}</b><span>personas cargadas</span></div>
      <div class="tile t-ok"><b>${pct(s.voto, s.total)}%</b><span>ya votó (${fmtN(s.voto)})</span></div>
      <div class="tile t-ok"><b>${fmtN(s.conf)}</b><span>confirmados</span></div>
      <div class="tile t-warn"><b>${fmtN(s.trasPend)}</b><span>traslados pendientes</span></div>
      <div class="tile t-neutral"><b>${fmtN(s.fisc)}</b><span>fiscales</span></div>
      <div class="tile ${s.rev ? 't-warn' : 't-neutral'}"><b>${fmtN(s.rev)}</b><span>con datos a revisar</span></div>
    </div>
    ${bloqueCircuitos(porCirc)}
    ${ranking.length ? `<div class="card"><div class="escuela-h"><h3 class="grow">${ROL_CORTO[rolRanking]}s</h3><span class="muted small">votaron / cargados</span></div>
      ${ranking.map(({ u, n, v }) => `<div class="miembro"><div class="ini rol-${u.rol}">${esc(iniciales(u.nombre))}</div>
        <div class="grow"><div style="font-weight:600">${esc(u.nombre)}</div><div class="muted small">${u.circuito ? 'Circuito ' + esc(u.circuito) : ''}</div></div>
        <span class="num" style="font-weight:700">${fmtN(v)}/${fmtN(n)}</span><span class="pill ${pct(v, n) >= 60 ? 'p-ok' : 'p-warn'}">${pct(v, n)}%</span></div>`).join('')}
    </div>` : ''}`;
}

function bloqueCircuitos(porCirc) {
  const res = st.resumen || {};
  const cab = st.me.rol === 'cabeza';
  const claves = new Set(Object.keys(porCirc));
  if (cab) Object.keys(res).forEach((k) => claves.add(k));
  else if (st.me.circuito) claves.add(st.me.circuito);
  const lista = [...claves].sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
  if (!lista.length) return '';
  st.circAbiertos ||= new Set();
  const fmt = fmtN;
  const lv = liviano();
  const barra = (v, n) => `<div class="bar"><i style="width:${pct(v, n)}%"></i></div>`;
  const filas = lista.map((k) => {
    const [n, v] = lv ? [conteo('c' + k, [['circuito', '==', k]]), conteo('cv' + k, [['circuito', '==', k], ['voto', '==', true]])] : (porCirc[k] || [0, 0]);
    const e = res[k]?.e;
    const abierto = st.circAbiertos.has(k);
    let html = `<button type="button" class="circ-btn" data-act="circ-toggle" data-c="${esc(k)}" aria-expanded="${abierto}">
      <span class="row" style="justify-content:space-between;gap:8px">
        <span><span class="chev" aria-hidden="true">${abierto ? '▾' : '▸'}</span> <b>Circuito ${esc(k)}</b></span>
        <span class="num small"><b>${pct(v, n)}%</b> <span class="muted">· ${fmt(v)} de ${fmt(n)} votaron</span></span>
      </span>
      ${barra(v, n)}
      <span class="muted small" style="display:block">${fmt(n)} cargados${e ? ` de ${fmt(e)} electores en el padrón` : ''}</span>
    </button>`;
    if (!abierto) return html;
    const escs = {};
    if (lv) for (const r of res[k]?.esc || []) escs[r.n] = { n: conteo('e' + k + r.n, [['circuito', '==', k], ['escuela', '==', r.n]]), v: conteo('ev' + k + r.n, [['circuito', '==', k], ['escuela', '==', r.n], ['voto', '==', true]]), e: 0 };
    if (!lv) for (const p of st.personas) {
      if ((p.circuito || '–') !== k) continue;
      const x = (escs[p.escuela || 'Sin escuela'] ||= { n: 0, v: 0, e: 0 });
      x.n++; if (p.voto) x.v++;
    }
    for (const r of res[k]?.esc || []) (escs[r.n] ||= { n: 0, v: 0, e: 0 }).e = r.e;
    const nombres = Object.keys(escs).sort((a, b) => (escs[b].n || 0) - (escs[a].n || 0) || a.localeCompare(b));
    html += `<div class="circ-esc">${nombres.map((nm) => {
      const x = escs[nm];
      return `<div><div class="row small" style="justify-content:space-between;gap:8px"><span style="font-weight:600">${esc(nm)}</span>
        <span class="num"><b>${pct(x.v, x.n)}%</b> <span class="muted">· ${fmt(x.v)}/${fmt(x.n)}</span></span></div>
        ${barra(x.v, x.n)}${x.e ? `<div class="muted small">${fmt(x.e)} electores</div>` : ''}</div>`;
    }).join('')}</div>`;
    return html;
  }).join('');
  return `<div class="card pad stack"><div><h3>Votación por circuito</h3><div class="muted small">Porcentaje de tu gente cargada que ya votó. Tocá un circuito para ver sus escuelas.</div></div>
    ${filas}
    ${cab && st.resumen === null ? '<button class="btn btn-ghost btn-sm" data-act="circ-recalcular">Mostrar todos los circuitos del padrón</button>' : ''}
  </div>`;
}

function cargarResumen(forzar = false) {
  if (!forzar && st.resumen !== undefined) return;
  st.resumen = st.resumen ?? null;
  S.leerResumenPadron().then((r) => { st.resumen = r; refrescarPartes(); }).catch(() => {});
}

function pintarConflictos() {
  const el = $('#conflictos');
  if (!el) return;
  const pend = st.conflictos.filter((c) => c.estado === 'intento' || c.estado === 'reclamo').sort((a, b) => ms(b.at) - ms(a.at));
  const cab = st.me.rol === 'cabeza';
  if (!pend.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="sec-title"><h2>Conflictos</h2><span class="pill p-bad">${pend.length}</span></div>
    <div class="muted small" style="margin:4px 0 10px">Intentos de cargar a alguien que ya es de otra persona.${cab ? ' Podés dejarlo como está o pasarlo a quien reclama.' : ''}</div>
    <div class="stack">${pend.map((c) => {
      const p = cab ? personaPorDni(c.dni) : null;
      return `<div class="card pad stack">
        <div class="row"><div class="grow"><b class="num">DNI ${fmtDni(c.dni)}</b>${p ? ` · ${esc(p.nombre)}` : ''}<div class="muted small">Intentó cargarlo <b>${esc(c.byNombre)}</b>${p ? ` · hoy es de <b>${esc(p.ownerNombre)}</b>` : ''}</div></div>
        <span class="pill ${c.estado === 'reclamo' ? 'p-warn' : 'p-neutral'}">${c.estado === 'reclamo' ? 'Reclamo' : 'Intento'}</span></div>
        ${c.motivo ? `<div class="small">“${esc(c.motivo)}”</div>` : ''}
        ${cab ? (p ? `<div class="row"><button class="btn btn-sec btn-sm grow" data-act="conf-no" data-id="${c.id}">Dejar como está</button><button class="btn btn-sm grow" data-act="conf-si" data-id="${c.id}">Pasar a ${esc(primerNombre(c.byNombre))}</button></div>`
          : `<div class="muted small">Esta persona ya no está cargada.</div><button class="btn btn-sec btn-sm" data-act="conf-no" data-id="${c.id}">Quitar de la lista</button>`) : ''}
      </div>`;
    }).join('')}</div>`;
}

// ----- importar planilla de personas
async function analizarImportacion(file, pre = 'imp') {
  const fis = pre === 'fis';
  const res = $(`#${pre}-res`);
  res.innerHTML = '<div class="muted">Leyendo archivo…</div>';
  try {
    const leido = await leerArchivo(file);
    const m = mapearPersonas(leido, { fiscales: fis });
    const pareceePadron = m.columnas.includes('mesa') && m.columnas.includes('orden') && m.validas.length > 500;
    if (pareceePadron || m.validas.length > 3000) {
      $(`#${pre}-file`).value = '';
      res.innerHTML = `<div class="aviso warn">${ic('alerta', 18)}<span>Este archivo tiene ${m.validas.length.toLocaleString('es-AR')} personas${pareceePadron ? ' con mesa y número de orden: parece un padrón' : ''}. ${puedePadron() ? 'Subilo en <b>Padrón oficial</b>.' : 'El padrón lo sube una cabeza.'} Acá van solo las listas de gente de cada equipo (hasta 3.000 por archivo).</span></div>`;
      return;
    }
    res.innerHTML = `<div class="muted">Revisando ${m.validas.length} personas contra el padrón y la base…</div><div class="progreso"><i id="${pre}-prog"></i></div>`;
    const nuevas = []; const propias = []; const ocupadas = [];
    let delPadron = 0; let noPadron = 0; let i = 0;
    await enParalelo(m.validas, 5, async (v) => {
      const [pd, cons] = await Promise.all([S.buscarPadron(v.dni).catch(() => null), S.consultarPersona(v.dni)]);
      const d = { ...v };
      if (pd) {
        delPadron++;
        Object.assign(d, { nombre: pd.nombre || v.nombre, domicilio: pd.domicilio || v.domicilio, circuito: pd.circuito || v.circuito, escuela: pd.escuela || v.escuela, dirEscuela: pd.dirEscuela || v.dirEscuela, mesa: pd.mesa || v.mesa, orden: pd.orden || '', enPadron: true });
      } else { noPadron++; d.enPadron = false; }
      (cons.estado === 'libre' ? nuevas : cons.estado === 'propia' ? propias : ocupadas).push(d);
      const bar = $(`#${pre}-prog`); if (bar) bar.style.width = pct(++i, m.validas.length) + '%';
    });
    // ¿Quién figura como referente en la planilla?
    const refTxt = sinAcentos(m.info.meta.referente || m.info.meta.dirigente || m.info.meta.movilizador || '');
    const sugerido = refTxt ? [st.me, ...miEquipo()].find((u) => sinAcentos(u.nombre).split(/\s+/).every((w) => refTxt.includes(w))) : null;
    st.imp = { ...(st.imp || {}), [pre]: { nuevas, propias, ocupadas, m, delPadron, noPadron, archivo: file.name } };
    const suplentes = nuevas.filter((x) => x.tipo === 'fiscal_suplente').length;
    const fiscales = nuevas.filter((x) => x.tipo === 'fiscal').length;
    const rev = nuevas.filter((x) => x.revisar).length;
    res.innerHTML = `
      <div class="small"><b>${esc(file.name)}</b> · columnas: ${m.columnas.map((c) => NOMBRE_COLUMNA[c] || c).join(', ')}</div>
      ${Object.keys(m.info.meta).length ? `<div class="muted small">${Object.entries(m.info.meta).map(([k, v]) => `${esc(k.charAt(0).toUpperCase() + k.slice(1))}: <b>${esc(v)}</b>`).join(' · ')}</div>` : ''}
      <div class="tiles">
        <div class="tile t-ok"><b>${nuevas.length}</b><span>nuevas para importar${m.esFiscales ? ` (${fiscales} titulares, ${suplentes} suplentes)` : ''}</span></div>
        <div class="tile t-acc"><b>${delPadron}</b><span>con escuela y mesa del padrón</span></div>
        <div class="tile ${rev ? 't-warn' : 't-neutral'}"><b>${rev}</b><span>con teléfono o nombre a revisar</span></div>
        <div class="tile ${ocupadas.length ? 't-bad' : 't-neutral'}"><b>${ocupadas.length}</b><span>ya son de otro (no se importan)</span></div>
        <div class="tile t-neutral"><b>${propias.length}</b><span>ya estaban en tu equipo${fis && propias.length ? ' (pasan a fiscales)' : ''}</span></div>
        <div class="tile t-neutral"><b>${m.invalidas.length + m.repetidasEnArchivo}</b><span>filas con DNI inválido o repetidas</span></div>
      </div>
      ${m.invalidas.length ? `<details class="small"><summary>Ver filas con problemas</summary><ul>${m.invalidas.map((x) => `<li>${esc(x.nombre || '(sin nombre)')}: ${esc(x.motivo)}${x.dniTxt ? ' (' + esc(x.dniTxt) + ')' : ''}</li>`).join('')}</ul></details>` : ''}
      ${nuevas.length ? `
        <div><label class="label" for="${pre}-dueno">Asignar a</label>
          <select id="${pre}-dueno" class="input">${ordenarArbol([st.me, ...miEquipo()]).map((u) => `<option value="${u.uid}" ${sugerido?.uid === u.uid ? 'selected' : ''}>${esc(u.nombre)}${u.uid === st.me.uid ? ' (vos)' : ' · ' + ROL_CORTO[u.rol]}</option>`).join('')}</select>
          ${m.info.meta.referente ? `<div class="muted small" style="margin-top:4px">La planilla dice referente: ${esc(m.info.meta.referente)}${sugerido ? '' : ' (no coincide con nadie de tu equipo)'}</div>` : ''}
        </div>
        <button class="btn btn-full" data-act="imp-confirmar" data-pre="${pre}">Importar ${nuevas.length} ${fis ? (nuevas.length === 1 ? 'fiscal' : 'fiscales') : (nuevas.length === 1 ? 'persona' : 'personas')}</button>` : ''}
      ${!nuevas.length && fis && propias.length ? `<button class="btn btn-full" data-act="imp-confirmar" data-pre="${pre}">Marcar ${propias.length} como fiscales</button>` : ''}`;
  } catch (e) {
    res.innerHTML = `<div class="aviso bad">${ic('alerta', 18)}<span>${esc(mensajeError(e))}</span></div>`;
  }
}

async function confirmarImportacion(pre = 'imp') {
  const imp = st.imp?.[pre];
  if (!imp) return;
  const fis = pre === 'fis';
  const dueno = usuarioPorId($(`#${pre}-dueno`)?.value) || st.me;
  const res = $(`#${pre}-res`);
  res.innerHTML = `<div class="muted">Importando…</div><div class="progreso"><i id="${pre}-prog"></i></div>`;
  let ok = 0; let conflictos = imp.ocupadas.length; let i = 0;
  const total = imp.nuevas.length + imp.ocupadas.length;
  await enParalelo([...imp.nuevas, ...imp.ocupadas], 4, async (d) => {
    try {
      const r = await S.cargarPersona({ ...d, estado: 'sin' }, dueno);
      if (r.ok) ok++; else if (r.conflicto && imp.nuevas.includes(d)) conflictos++;
    } catch { /* se informa abajo */ }
    const bar = $(`#${pre}-prog`); if (bar) bar.style.width = pct(++i, total) + '%';
  });
  // Fiscales que ya estaban en el equipo como votantes: se marcan como fiscales
  let marcados = 0;
  if (fis) for (const d of imp.propias) { try { await actualizarPersonaApp(d.dni, { tipo: d.tipo }); marcados++; } catch { /* sigue */ } }
  delete st.imp[pre];
  $(`#${pre}-file`).value = '';
  res.innerHTML = `<div class="aviso ok">${ic('ok', 18)}<span>Listo: ${ok} ${fis ? 'fiscales cargados' : 'importadas'} a ${esc(dueno.uid === st.me.uid ? 'tu lista' : dueno.nombre)}.${marcados ? ` ${marcados} que ya estaban pasaron a fiscales.` : ''}${conflictos ? ` ${conflictos} quedaron como conflicto.` : ''}</span></div>`;
}

// ----- padrón
async function analizarPadron(file) {
  const res = $('#pad-res');
  res.innerHTML = '<div class="muted">Leyendo padrón…</div>';
  try {
    const leido = await leerArchivo(file);
    const m = mapearPadron(leido, normDni($('#pad-circ').value));
    st.pad = m;
    const ej = m.registros.slice(0, 3);
    res.innerHTML = `
      <div class="small">Columnas: ${m.columnas.map((c) => NOMBRE_COLUMNA[c] || c).join(', ')}</div>
      ${m.faltaCircuito && !normDni($('#pad-circ').value) ? `<div class="aviso warn">${ic('alerta', 18)}<span>El archivo no trae circuito. Escribilo arriba antes de importar.</span></div>` : ''}
      <div class="tiles"><div class="tile t-ok"><b>${m.registros.length.toLocaleString('es-AR')}</b><span>electores válidos</span></div>
      <div class="tile t-neutral"><b>${m.invalidos}</b><span>filas sin DNI válido</span></div></div>
      <div class="card pad small stack">${ej.map((r) => `<div><b>${esc(r.nombre)}</b> · DNI ${fmtDni(r.dni)}<br><span class="muted">${esc(r.escuela)} · Mesa ${esc(r.mesa)} · Orden ${esc(r.orden)} · Circ. ${esc(r.circuito)}</span></div>`).join('')}</div>
      <button class="btn btn-full" data-act="pad-confirmar">Importar padrón</button>`;
  } catch (e) {
    res.innerHTML = `<div class="aviso bad">${ic('alerta', 18)}<span>${esc(mensajeError(e))}</span></div>`;
  }
}
async function confirmarPadron() {
  const m = st.pad;
  if (!m) return;
  const circ = normDni($('#pad-circ').value);
  if (circ) m.registros.forEach((r) => { if (!r.circuito) r.circuito = circ; });
  const res = $('#pad-res');
  res.innerHTML = '<div class="muted" id="pad-txt">Subiendo…</div><div class="progreso"><i id="pad-prog"></i></div>';
  try {
    await S.importarPadron(m.registros, (h, t) => {
      const b = $('#pad-prog'); if (b) b.style.width = pct(h, t) + '%';
      const x = $('#pad-txt'); if (x) x.textContent = `Subiendo ${h.toLocaleString('es-AR')} de ${t.toLocaleString('es-AR')}…`;
    });
    st.pad = null;
    $('#pad-file').value = '';
    cargarResumen(true);
    res.innerHTML = `<div class="aviso ok">${ic('ok', 18)}<span>Padrón cargado: ${m.registros.length.toLocaleString('es-AR')} electores.</span></div>`;
  } catch (e) {
    res.innerHTML = `<div class="aviso bad">${ic('alerta', 18)}<span>${esc(mensajeError(e))}</span></div>`;
  }
}

async function enParalelo(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; await fn(items[k]); }
  }));
}

// ---------------------------------------------------------------- FISCALES
const INCIDENCIAS_RAPIDAS = ['La mesa abrió tarde', 'Faltan boletas de nuestra lista', 'Problema con las autoridades de mesa', 'Me impiden fiscalizar', 'Problema en el conteo'];
const miFiscalia = () => st.fiscalias.find((x) => x.id === st.me.uid || x.fiscalUid === st.me.uid) || {};
const hora = (t) => { const d = new Date(ms(t)); return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }); };
// Lo que guarda el fiscal lleva siempre su path (las reglas lo exigen)
const fx = (cambios) => S.actualizarFiscalia(st.me.uid, { ...cambios, path: st.me.path, fiscalUid: st.me.uid, nombre: st.me.nombre, dni: st.me.dni });

function pintarFiscal() {
  const me = st.me;
  if (!st.fx.inicio) {
    st.fx.inicio = true;
    fx({}).catch(() => {});
    S.leerListas().then((r) => { me.listas = r.listas; me.categorias = r.categorias; refrescarFiscal(); }).catch(() => {});
    S.leerResumenPadron().then((r) => { st.resumen = r; refrescarFiscal(); }).catch(() => {});
  }
  const f = miFiscalia();
  const y = window.scrollY;
  const escuelas = [...new Set([f.votaEscuela, ...Object.values(st.resumen || {}).flatMap((c) => (c.esc || []).map((e) => e.n))].filter(Boolean))].sort();
  const listas = me.listas || [];
  const tieneMesa = !!f.mesa && !st.fx.editMesa;
  const acta = f.acta;
  const mostrarFormActa = !acta || st.fx.corrigiendo;
  $('#app').innerHTML = `
    ${DEMO ? '<div class="demo-band">Modo demostración · los datos son inventados</div>' : ''}
    <header class="top"><div class="top-row">
      <div class="top-titulo"><div class="top-sub">Fiscal · ${esc(me.campania || '')}</div><h1>Mi mesa</h1></div>
      <button type="button" class="avatar" data-act="cuenta" aria-label="Mi cuenta">${esc(iniciales(me.nombre))}</button>
    </div></header>
    <main class="fiscal" style="padding-bottom:calc(32px + env(safe-area-inset-bottom, 0px))">
      ${f.votaEscuela || f.votaMesa ? `<div class="card pad"><div class="muted small">Dónde votás vos</div><b>${esc(f.votaEscuela || '')}</b>${f.votaMesa ? ` · Mesa <b class="num">${esc(f.votaMesa)}</b>` : ''}</div>` : ''}

      <section class="card pad stack paso">
        <div class="paso-h"><span class="paso-n ${tieneMesa ? 'hecho' : ''}">${tieneMesa ? '✓' : '1'}</span><h2>Mesa que fiscalizás</h2></div>
        ${tieneMesa ? `
          <div class="mesa-grande"><span class="muted small">Mesa</span><b class="num">${esc(f.mesa)}</b><span>${esc(f.escuela || '')}</span></div>
          <button class="btn btn-ghost btn-sm" data-act="fx-cambiar-mesa">Cambiar</button>` : `
          ${f.votaMesa ? `<button class="btn btn-sec btn-full" data-act="fx-misma">Es la misma mesa donde voto (${esc(f.votaMesa)})</button><div class="muted small" style="text-align:center">o escribila:</div>` : ''}
          <div class="row"><div style="flex:0 0 120px"><label class="label" for="fx-mesa">N° de mesa</label><input id="fx-mesa" class="input input-dni" inputmode="numeric" value="${esc(f.mesa || '')}" placeholder="1043"></div>
          <div class="grow"><label class="label" for="fx-escuela">Escuela</label><input id="fx-escuela" class="input" list="fx-escuelas" value="${esc(f.escuela || f.votaEscuela || '')}" placeholder="Nombre de la escuela"><datalist id="fx-escuelas">${escuelas.map((e) => `<option value="${esc(e)}"></option>`).join('')}</datalist></div></div>
          <div class="error" id="fx-err-mesa" role="alert"></div>
          <button class="btn btn-full" data-act="fx-guardar-mesa">Guardar mesa</button>`}
      </section>

      <section class="card pad stack paso">
        <div class="paso-h"><span class="paso-n ${f.presente ? 'hecho' : ''}">${f.presente ? '✓' : '2'}</span><h2>Llegada</h2></div>
        ${f.presente ? `<div class="aviso ok">${ic('ok', 18)}<span>Avisaste que estás en la mesa a las ${hora(f.presenteAt)}.</span></div>`
          : `<button class="btn btn-full btn-grande" data-act="fx-presente" ${f.mesa ? '' : 'disabled'}>Ya estoy sentado en la mesa</button>
             ${f.mesa ? '' : '<div class="muted small">Primero guardá la mesa que fiscalizás.</div>'}`}
      </section>

      <section class="card pad stack paso">
        <div class="paso-h"><span class="paso-n">!</span><h2>Incidencias</h2></div>
        <div class="chips wrap">${INCIDENCIAS_RAPIDAS.map((t) => `<button type="button" class="chip" data-act="fx-inc-rapida" data-v="${esc(t)}">${esc(t)}</button>`).join('')}</div>
        <label class="label" for="fx-inc" style="margin:0">Contá qué pasó</label>
        <textarea id="fx-inc" class="input" rows="2" placeholder="Ej: el presidente de mesa no deja ver el conteo"></textarea>
        <button class="btn btn-sec" data-act="fx-inc-enviar">Enviar incidencia</button>
        ${(f.incidencias || []).length ? `<div class="stack" style="gap:6px">${[...f.incidencias].reverse().map((i) => `<div class="inc"><span class="muted small num">${hora(i.at)}</span> ${esc(i.texto)}</div>`).join('')}</div>` : ''}
      </section>

      <section class="card pad stack paso">
        <div class="paso-h"><span class="paso-n ${acta && !st.fx.corrigiendo ? 'hecho' : ''}">${acta && !st.fx.corrigiendo ? '✓' : '3'}</span><h2>Cierre: el acta</h2></div>
        ${!mostrarFormActa ? resumenActaHtml(acta, listas) + `<div class="muted small">Enviado a las ${hora(f.actaAt)}${f.tieneFoto ? ' · con foto' : ' · sin foto'}</div>
          ${faltanCats(acta).length ? `<div class="aviso warn">${ic('alerta', 18)}<span>Falta cargar: ${faltanCats(acta).map((c) => esc(c.nombre)).join(', ')}.</span></div><button class="btn btn-full" data-act="fx-corregir">Completar lo que falta</button>` : '<button class="btn btn-ghost btn-sm" data-act="fx-corregir">Corregir</button>'}` : `
          <div class="muted">Cuando termine el conteo: sacale una foto al acta y copiá los números.</div>
          ${fotoActaHtml()}
          ${listas.length ? formActaHtml(acta) : '<div class="aviso warn">' + ic('alerta', 18) + '<span>Todavía no están cargadas las listas. Avisale a tu referente.</span></div>'}`}
      </section>
    </main>`;
  actualizarSumaActa();
  window.scrollTo(0, y);
}

function refrescarFiscal() {
  const a = document.activeElement;
  if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) return; // no pisar lo que está escribiendo
  if (st.fx.procesando) return;
  pintarFiscal();
}

const campoVoto = (id, nombre, solo) => { const k = catActual() + '|' + id; return `${solo ? '' : '<div class="voto-fila">'}<label for="v-${id}">${esc(nombre)}</label><input id="v-${id}" class="input num" inputmode="numeric" enterkeyhint="next" data-voto="${k}" value="${esc(st.fx.votos[k] ?? '')}" placeholder="0">${solo ? '' : '</div>'}`; };

// ----- categorías del acta
const CAT_UNICA = { id: 'general', nombre: 'Resultado' };
const categorias = () => (st.me.categorias?.length ? st.me.categorias : [CAT_UNICA]);
const catActual = () => (categorias().some((c) => c.id === st.fx.cat) ? st.fx.cat : categorias()[0].id);
// Actas viejas (sin categorías) se leen como la primera categoría
const catsDeActa = (acta) => (!acta ? {} : acta.cats || (acta.votos ? { [categorias()[0].id]: acta } : {}));
const faltanCats = (acta) => { const h = catsDeActa(acta); return st.me.categorias?.length ? categorias().filter((c) => !h[c.id]) : []; };
function catCompleta(catId) {
  const a = leerVotos(catId);
  return a.total != null && Object.values(a.votos).every((x) => x != null);
}

function formActaHtml(acta) {
  const cs = categorias(); const cat = catActual(); const enviadas = catsDeActa(acta);
  const i = cs.findIndex((c) => c.id === cat);
  const listas = st.me.listas || [];
  return `
    ${cs.length > 1 ? `<div class="cat-tabs" role="tablist">${cs.map((c, n) => {
      const ok = catCompleta(c.id) || (enviadas[c.id] && !st.fx.corrigiendo);
      return `<button type="button" role="tab" class="cat-tab ${c.id === cat ? 'activa' : ''}" aria-selected="${c.id === cat}" data-act="fx-cat" data-c="${c.id}">${ok ? '✓ ' : (n + 1) + '. '}${esc(c.nombre)}</button>`;
    }).join('')}</div>
    <div class="muted small">Copiá la columna <b>${esc(cs[i].nombre)}</b> del acta. Tocá "Siguiente" en el teclado para pasar al próximo número.</div>` : ''}
    <div class="stack" style="gap:8px">
      ${listas.map((l) => campoVoto(l.id, l.nombre)).join('')}
      ${campoVoto('blancos', 'Votos en blanco')}${campoVoto('nulos', 'Votos nulos')}${campoVoto('recurridos', 'Recurridos')}${campoVoto('impugnados', 'Impugnados')}
      <div class="voto-fila total">${campoVoto('total', cs.length > 1 ? 'Total de ' + cs[i].nombre + ' (según el acta)' : 'Total de votantes de la mesa (según el acta)', true)}</div>
      <div id="fx-suma" class="small"></div>
    </div>
    <div class="error" id="fx-err-acta" role="alert"></div>
    ${i < cs.length - 1 ? `<button class="btn btn-sec btn-full" data-act="fx-siguiente">Siguiente: ${esc(cs[i + 1].nombre)} ›</button>` : ''}
    <button class="btn btn-full btn-grande" data-act="fx-enviar-acta">${cs.length > 1 && i < cs.length - 1 ? 'Enviar lo cargado' : 'Enviar resultado'}</button>`;
}

function fotoActaHtml() {
  const ft = st.fx.foto;
  if (st.fx.procesando) return '<div class="card pad muted">Revisando la foto…</div>';
  if (!ft) return `<label class="archivo foto-btn" for="fx-foto">${ic('camara', 28)}<div><b>Sacar foto del acta</b></div>
      <div class="muted small">Apoyala en una mesa, con buena luz, entera y sin sombra. Sostené el celular quieto.</div>
      <input id="fx-foto" type="file" accept="image/*" capture="environment"></label>`;
  return `<div class="stack" style="gap:8px">
      <img src="${ft.url}" alt="Foto del acta" class="foto-prev">
      ${ft.problemas.length ? `<div class="aviso warn">${ic('alerta', 18)}<span>${ft.problemas.map(esc).join(' ')} Conviene sacarla de nuevo para que se lea bien.</span></div>`
        : `<div class="aviso ok">${ic('ok', 18)}<span>La foto se ve nítida.</span></div>`}
      <button class="btn btn-sec btn-sm" data-act="fx-foto-otra">Sacar otra foto</button>
    </div>`;
}

async function tomarFotoActa(file) {
  st.fx.procesando = true; pintarFiscal();
  try { st.fx.foto = await procesarFoto(file); }
  catch { toast('No se pudo leer la foto. Probá de nuevo.'); st.fx.foto = null; }
  st.fx.procesando = false; pintarFiscal();
}

// Comprime la foto y mide nitidez (varianza del laplaciano), luz y tamaño
async function procesarFoto(file) {
  let img;
  try { img = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { img = await new Promise((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = mal; i.src = URL.createObjectURL(file); }); }
  const W0 = img.width; const H0 = img.height;
  const k = 700 / Math.max(W0, H0);
  const cw = Math.max(1, Math.round(W0 * Math.min(1, k))); const ch = Math.max(1, Math.round(H0 * Math.min(1, k)));
  const c = document.createElement('canvas'); c.width = cw; c.height = ch;
  const cx = c.getContext('2d', { willReadFrequently: true }); cx.drawImage(img, 0, 0, cw, ch);
  const d = cx.getImageData(0, 0, cw, ch).data;
  const g = new Float32Array(cw * ch); let suma = 0; let quemados = 0;
  for (let i = 0, j = 0; i < d.length; i += 4, j++) { g[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; suma += g[j]; if (g[j] >= 252) quemados++; }
  const brillo = suma / g.length;
  const reflejo = quemados / g.length;
  let m = 0; let m2 = 0; let n = 0;
  for (let yy = 1; yy < ch - 1; yy++) for (let xx = 1; xx < cw - 1; xx++) {
    const i = yy * cw + xx;
    const L = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - cw] - g[i + cw];
    m += L; m2 += L * L; n++;
  }
  const nitidez = n ? m2 / n - (m / n) ** 2 : 0;
  const problemas = [];
  if (nitidez < 45) problemas.push('Salió movida o desenfocada.');
  else if (nitidez < 90) problemas.push('Puede estar un poco borrosa.');
  if (brillo < 70) problemas.push('Está oscura.');
  else if (reflejo > 0.35) problemas.push('Tiene un reflejo fuerte (flash o luz directa): movela un poco.');
  if (Math.min(W0, H0) < 900) problemas.push('La imagen es muy chica: acercate o usá la cámara principal.');
  // Exportar: lado mayor 1600 px y menos de ~650 KB
  let esc_ = Math.min(1, 1600 / Math.max(W0, H0)); let q = 0.8; let url = '';
  for (let intento = 0; intento < 8; intento++) {
    const o = document.createElement('canvas'); o.width = Math.round(W0 * esc_); o.height = Math.round(H0 * esc_);
    o.getContext('2d').drawImage(img, 0, 0, o.width, o.height);
    url = o.toDataURL('image/jpeg', q);
    if (url.length < 880000) break;
    if (q > 0.55) q -= 0.1; else esc_ *= 0.8;
  }
  return { url, nitidez: Math.round(nitidez), brillo: Math.round(brillo), problemas };
}

function leerVotos(cat = catActual()) {
  const v = st.fx.votos; const num = (k) => { const x = String(v[cat + '|' + k] ?? '').trim(); return x === '' ? null : parseInt(normDni(x) || '0', 10); };
  const listas = st.me.listas || [];
  const votos = Object.fromEntries(listas.map((l) => [l.id, num(l.id)]));
  return { votos, blancos: num('blancos'), nulos: num('nulos'), recurridos: num('recurridos'), impugnados: num('impugnados'), total: num('total') };
}
function actualizarSumaActa() {
  const el = $('#fx-suma'); if (!el) return;
  const a = leerVotos();
  const suma = Object.values(a.votos).reduce((x, y) => x + (y || 0), 0) + (a.blancos || 0) + (a.nulos || 0) + (a.recurridos || 0) + (a.impugnados || 0);
  if (a.total == null) { el.innerHTML = `<span class="muted">Suma: <b class="num">${suma}</b></span>`; return; }
  el.innerHTML = suma === a.total ? `<span style="color:var(--ok);font-weight:700">✓ La suma da ${suma}, igual al total.</span>`
    : `<span style="color:var(--bad);font-weight:700">La suma da ${suma} y el total dice ${a.total}. Revisá los números.</span>`;
}
async function enviarActa() {
  const err = $('#fx-err-acta');
  const cs = categorias();
  const previas = st.fx.corrigiendo ? {} : catsDeActa(miFiscalia().acta);
  const nuevas = {};
  for (const c of cs) {
    if (!catCompleta(c.id)) continue;
    const a = leerVotos(c.id);
    ['blancos', 'nulos', 'recurridos', 'impugnados'].forEach((k) => { if (a[k] == null) a[k] = 0; });
    const suma = Object.values(a.votos).reduce((x, y) => x + y, 0) + a.blancos + a.nulos + a.recurridos + a.impugnados;
    nuevas[c.id] = { ...a, sumaOk: suma === a.total, suma };
  }
  if (!Object.keys(nuevas).length) { err.textContent = 'Completá todas las listas y el total (si una lista no tuvo votos, poné 0).'; return; }
  const malas = cs.filter((c) => nuevas[c.id] && !nuevas[c.id].sumaOk);
  if (malas.length && !st.fx.confirmaDiferencia) { err.textContent = `En ${malas.map((c) => c.nombre).join(', ')} la suma no coincide con el total. Revisá; si el acta dice así, tocá Enviar otra vez.`; st.fx.confirmaDiferencia = true; return; }
  const faltan = cs.filter((c) => !nuevas[c.id] && !previas[c.id]);
  if (cs.length > 1 && faltan.length && !st.fx.confirmaParcial) { err.textContent = `Falta ${faltan.map((c) => c.nombre).join(', ')}. Tocá Enviar otra vez para mandar lo que tenés; después completás el resto.`; st.fx.confirmaParcial = true; return; }
  if (!st.fx.foto && !miFiscalia().tieneFoto && !st.fx.confirmaSinFoto) { err.textContent = 'Falta la foto del acta. Sacala arriba; si no podés, tocá Enviar otra vez.'; st.fx.confirmaSinFoto = true; return; }
  const btn = $('[data-act="fx-enviar-acta"]'); btn.disabled = true; btn.textContent = 'Enviando…';
  try {
    if (st.fx.foto) await S.guardarActa(st.me.uid, st.fx.foto.url, st.me.path);
    for (const k in nuevas) delete nuevas[k].suma;
    await fx({ acta: { cats: { ...previas, ...nuevas } }, actaAt: Date.now(), tieneFoto: !!(st.fx.foto || miFiscalia().tieneFoto), mesa: miFiscalia().mesa || '', escuela: miFiscalia().escuela || '' });
    st.fx = { ...st.fx, foto: null, corrigiendo: false, confirmaDiferencia: false, confirmaSinFoto: false, confirmaParcial: false };
    toast('Resultado enviado. ¡Gracias!');
    pintarFiscal();
  } catch (e) { err.textContent = mensajeError(e); btn.disabled = false; btn.textContent = 'Enviar resultado'; }
}

function guardarMesaFiscal(mesa, escuela) {
  const f = miFiscalia();
  fx({ mesa: String(mesa || ''), escuela: escuela || '', circuito: f.circuito || st.me.circuito || '' }).then(() => { st.fx.editMesa = false; toast(`Mesa ${mesa} guardada`); pintarFiscal(); });
}

function resumenActaHtml(acta, listas) {
  const nombre = Object.fromEntries((listas || []).map((l) => [l.id, l.nombre]));
  const h = catsDeActa(acta); const cs = categorias().filter((c) => h[c.id]);
  return cs.map((c) => { const a = h[c.id]; return `<div class="stack acta-cat" style="gap:4px">${categorias().length > 1 ? `<b class="small">${esc(c.nombre)}</b>` : ''}
    ${Object.entries(a.votos || {}).map(([id, v]) => `<div class="row small" style="justify-content:space-between"><span>${esc(nombre[id] || 'Lista')}</span><b class="num">${v}</b></div>`).join('')}
    <div class="row small muted" style="justify-content:space-between"><span>Blancos · nulos · recurridos · impugnados</span><span class="num">${a.blancos || 0} · ${a.nulos || 0} · ${a.recurridos || 0} · ${a.impugnados || 0}</span></div>
    <div class="row small" style="justify-content:space-between"><b>Total</b><b class="num">${a.total}</b></div>
    ${a.sumaOk === false ? '<div class="small" style="color:var(--bad)">La suma no coincide con el total.</div>' : ''}</div>`; }).join('');
}

// ---------------------------------------------------------------- FISCALIZACIÓN (conducción)
const fiscalesSinAcceso = () => personasFiscales().filter((p) => !st.usuarios.some((u) => u.dni === p.dni));

function calcularEscrutinio(fs, cat) {
  const porMesa = {};
  for (const f of fs) { const a = catsDeActa(f.acta)[cat]; if (a && f.mesa && (!porMesa[f.mesa] || ms(f.actaAt) > ms(porMesa[f.mesa].actaAt))) porMesa[f.mesa] = { ...f, acta: a }; }
  const mesas = Object.values(porMesa);
  const r = { mesas: mesas.length, tot: {}, blancos: 0, nulos: 0, otros: 0, circ: {} };
  for (const m of mesas) {
    const c = (r.circ[m.circuito || '–'] ||= { mesas: 0, tot: {}, blancos: 0 });
    c.mesas++;
    for (const [id, v] of Object.entries(m.acta.votos || {})) { r.tot[id] = (r.tot[id] || 0) + (+v || 0); c.tot[id] = (c.tot[id] || 0) + (+v || 0); }
    r.blancos += +m.acta.blancos || 0; c.blancos += +m.acta.blancos || 0;
    r.nulos += +m.acta.nulos || 0; r.otros += (+m.acta.recurridos || 0) + (+m.acta.impugnados || 0);
  }
  return r;
}

function barrasListas(tot, blancos, listas) {
  const validos = Object.values(tot).reduce((a, b) => a + b, 0) + blancos;
  const filas = (listas || []).map((l) => ({ n: l.nombre, v: tot[l.id] || 0 })).sort((a, b) => b.v - a.v);
  filas.push({ n: 'En blanco', v: blancos, gris: true });
  return filas.map((f, i) => `<div><div class="row small" style="justify-content:space-between;gap:8px"><span style="font-weight:${i === 0 && !f.gris ? 800 : 600}">${esc(f.n)}</span><span class="num"><b>${validos ? (f.v * 100 / validos).toFixed(1).replace('.', ',') : '0'}%</b> <span class="muted">· ${f.v.toLocaleString('es-AR')}</span></span></div>
    <div class="bar" style="margin-top:4px"><i style="width:${validos ? (f.v * 100 / validos) : 0}%;${f.gris ? 'background:var(--muted)' : ''}"></i></div></div>`).join('');
}

function pintarFiscalizacion() {
  const el = $('#fiscalizacion');
  if (!el) return;
  const fs = st.fiscalias || [];
  const sinAcceso = fiscalesSinAcceso();
  const listas = st.me.listas || [];
  if (!fs.length && !sinAcceso.length) { el.innerHTML = ''; return; }
  const presentes = fs.filter((f) => f.presente).length;
  const incid = fs.reduce((a, f) => a + (f.incidencias || []).length, 0);
  const mesasAsignadas = new Set(fs.map((f) => f.mesa).filter(Boolean)).size;
  const cs = categorias();
  const cat = cs.some((c) => c.id === st.catSel) ? st.catSel : cs[0].id;
  const nomCat = cs.length > 1 ? ' · ' + cs.find((c) => c.id === cat).nombre : '';
  const esc_ = calcularEscrutinio(fs, cat);
  const conActa = new Set(fs.filter((f) => f.mesa && Object.keys(catsDeActa(f.acta)).length).map((f) => f.mesa)).size;
  const circs = Object.keys(esc_.circ).sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
  el.innerHTML = `
    <div class="sec-title"><h2>Fiscalización</h2></div>
    <div class="tiles">
      <div class="tile t-acc"><b>${fs.length}</b><span>fiscales con acceso</span></div>
      <div class="tile ${presentes === fs.length && fs.length ? 't-ok' : 't-warn'}"><b>${presentes}/${fs.length}</b><span>ya están en su mesa</span></div>
      <div class="tile ${incid ? 't-bad' : 't-neutral'}"><b>${incid}</b><span>incidencias</span></div>
      <div class="tile t-ok"><b>${conActa}/${mesasAsignadas || 0}</b><span>mesas con acta</span></div>
    </div>
    ${sinAcceso.length ? `<button class="btn btn-sec" data-act="fiscales-acceso-todos">${ic('fiscal', 18)} Dar acceso a ${sinAcceso.length} ${sinAcceso.length === 1 ? 'fiscal' : 'fiscales'} cargados</button>` : ''}
    ${conActa ? `<div class="card pad stack">
        ${cs.length > 1 ? `<div class="chips" role="group" aria-label="Categoría">${cs.map((c) => `<button type="button" class="chip" data-act="esc-cat" data-c="${c.id}" aria-pressed="${c.id === cat}">${esc(c.nombre)}</button>`).join('')}</div>` : ''}
        <div><h3>Resultado parcial${esc(nomCat)} · ${esc_.mesas} ${esc_.mesas === 1 ? 'mesa' : 'mesas'}</h3><div class="muted small">Sobre votos válidos (listas + blanco), según las actas que cargaron tus fiscales. No es el resultado oficial.</div></div>
        ${barrasListas(esc_.tot, esc_.blancos, listas)}
        <div class="muted small">Nulos: ${esc_.nulos} · Recurridos e impugnados: ${esc_.otros}</div>
        ${circs.length > 1 ? `<details class="small" data-recordar="porCirc" ${st.abiertosUI?.porCirc ? 'open' : ''}><summary>Por circuito</summary><div class="stack" style="margin-top:10px">${circs.map((c) => `<div class="stack" style="gap:6px"><b>Circuito ${esc(c)} · ${esc_.circ[c].mesas} mesas</b>${barrasListas(esc_.circ[c].tot, esc_.circ[c].blancos, listas)}</div>`).join('')}</div></details>` : ''}
      </div>` : (!listas.length && st.me.rol === 'cabeza' ? `<div class="aviso warn">${ic('alerta', 18)}<span>Cargá las listas en <b>Herramientas → Listas del escrutinio</b> para que los fiscales puedan pasar el acta.</span></div>` : '')}
    ${fs.length ? `<details class="herr" data-recordar="verFiscales" ${st.abiertosUI?.verFiscales ? 'open' : ''}><summary><span class="herr-ic">${ic('fiscal', 20)}</span><span class="grow"><b>Ver fiscales</b><span class="muted small" style="display:block">Mesa, llegada, incidencias y acta de cada uno</span></span><span class="chev" aria-hidden="true">▸</span></summary>
      <div class="herr-body stack" style="gap:6px">${[...fs].sort((a, b) => String(a.mesa || 'zz').localeCompare(String(b.mesa || 'zz'), 'es', { numeric: true })).map((f) => `
        <button type="button" class="gente-item" data-act="fiscal-ver" data-id="${f.id}">
          <span class="grow" style="text-align:left">${esc(f.nombre)}<span class="muted small" style="display:block">${f.mesa ? 'Mesa ' + esc(f.mesa) + (f.escuela ? ' · ' + esc(f.escuela) : '') : 'Sin mesa cargada'}</span></span>
          <span class="tags" style="margin:0;justify-content:flex-end">
            <span class="pill ${f.presente ? 'p-ok' : 'p-neutral'}">${f.presente ? 'En mesa' : 'No llegó'}</span>
            ${(f.incidencias || []).length ? `<span class="pill p-bad">${f.incidencias.length} inc.</span>` : ''}
            ${f.acta ? '<span class="pill p-acc">Acta</span>' : ''}
          </span>
        </button>`).join('')}</div></details>` : ''}`;
}

function hojaFiscal(id) {
  const f = st.fiscalias.find((x) => x.id === id);
  if (!f) return;
  const wa = waUrl(f.tel);
  abrirHoja(`
    <div class="row"><div class="grow"><h2>${esc(f.nombre)}</h2><div class="muted num">Fiscal · DNI ${fmtDni(f.dni)}</div></div>
      ${wa ? `<a class="icon-btn wa" href="${wa}" target="_blank" rel="noopener" aria-label="WhatsApp">${ic('wa')}</a>` : ''}
      <button type="button" class="icon-btn" data-act="cerrar" aria-label="Cerrar">${ic('x')}</button></div>
    <div class="card pad stack" style="gap:6px">
      <div><span class="muted small">Fiscaliza</span><div><b>${f.mesa ? 'Mesa ' + esc(f.mesa) : 'Todavía no cargó la mesa'}</b>${f.escuela ? ' · ' + esc(f.escuela) : ''}</div></div>
      ${f.votaMesa ? `<div><span class="muted small">Vota en</span><div>${esc(f.votaEscuela || '')} · Mesa ${esc(f.votaMesa)}</div></div>` : ''}
      <div>${f.presente ? `<span class="pill p-ok">En la mesa desde las ${hora(f.presenteAt)}</span>` : '<span class="pill p-neutral">Todavía no avisó que llegó</span>'}</div>
    </div>
    ${(f.incidencias || []).length ? `<div class="card pad stack" style="gap:6px"><h3>Incidencias</h3>${[...f.incidencias].reverse().map((i) => `<div class="inc"><span class="muted small num">${hora(i.at)}</span> ${esc(i.texto)}</div>`).join('')}</div>` : ''}
    ${f.acta ? `<div class="card pad stack"><h3>Acta · enviada ${hora(f.actaAt)}</h3>${resumenActaHtml(f.acta, st.me.listas)}
      ${f.tieneFoto ? `<button class="btn btn-sec" data-act="fiscal-ver-acta" data-id="${f.id}">Ver foto del acta</button>` : '<div class="muted small">No subió foto.</div>'}<div id="acta-img"></div></div>` : ''}
    ${usuarioPorId(f.id) && S.puedeBlanquear ? `<button class="btn btn-sec" data-act="blanquear" data-uid="${f.id}">${ic('llave', 18)} Se olvidó la contraseña: blanquear</button>` : ''}
    ${usuarioPorId(f.id) ? `<button class="btn btn-ghost" data-act="fiscal-quitar" data-id="${f.id}">Quitarle el acceso</button>` : ''}`, { tipo: 'fiscal' });
}

function hojaAccesoFiscal(dnis) {
  const ps = dnis.map((d) => personaLocal(d)).filter(Boolean);
  if (!ps.length) return;
  abrirHoja(`
    <div class="row"><h2 class="grow">Acceso para ${ps.length === 1 ? esc(primerNombre(ps[0].nombre)) : ps.length + ' fiscales'}</h2><button type="button" class="icon-btn" data-act="cerrar" aria-label="Cerrar">${ic('x')}</button></div>
    <div class="muted">Entran con su DNI y una contraseña que genera la app. Solo ven su mesa: cargan la mesa que fiscalizan, avisan cuando llegan, mandan incidencias y el acta.</div>
    <div class="card pad small stack" style="gap:4px;max-height:200px;overflow:auto">${ps.map((p) => `<div>${esc(p.nombre)} <span class="muted num">· DNI ${fmtDni(p.dni)}</span></div>`).join('')}</div>
    <div id="acc-res" class="stack"></div>
    <button class="btn btn-full" id="acc-btn" data-act="acc-crear" data-dnis="${ps.map((p) => p.dni).join(',')}">Crear ${ps.length === 1 ? 'acceso' : ps.length + ' accesos'}</button>`, { tipo: 'acceso' });
}

async function crearAccesosFiscales(dnis) {
  const btn = $('#acc-btn'); btn.disabled = true; btn.textContent = 'Creando…';
  const res = $('#acc-res'); const link = location.origin + location.pathname;
  const filas = [];
  for (const dni of dnis) {
    const p = personaLocal(dni);
    if (!p) continue;
    let padre = usuarioPorId(p.ownerId);
    if (!padre || padre.rol === 'fiscal') padre = st.me;
    const pass = String(Math.floor(100000 + Math.random() * 900000));
    try {
      const r = await S.crearUsuario({ dni: p.dni, nombre: p.nombre, tel: p.tel, rol: 'fiscal', pass, padre });
      const fiscal = { uid: r.uid, nombre: p.nombre, dni: p.dni, tel: p.tel, path: [...padre.path, r.uid] };
      await S.crearFiscalia(fiscal, { votaEscuela: p.escuela || '', votaMesa: p.mesa || '', circuito: p.circuito || '', tipo: p.tipo });
      const msg = `Hola ${primerNombre(p.nombre)}! Vas a ser fiscal${p.tipo === 'fiscal_suplente' ? ' suplente' : ''} de ${st.me.campania}. Entrá en ${link}\nDNI: ${p.dni}\nContraseña: ${r.reactivado ? 'la misma que usabas antes' : pass}\nEl día de la elección cargá ahí tu mesa, avisá cuando llegues y al final mandá la foto del acta.`;
      filas.push(`<div class="card pad row"><div class="grow"><b>${esc(p.nombre)}</b><div class="muted small num">DNI ${fmtDni(p.dni)} · clave ${r.reactivado ? '(la de antes)' : pass}</div></div>${waUrl(p.tel, msg) ? `<a class="icon-btn wa" href="${waUrl(p.tel, msg)}" target="_blank" rel="noopener" aria-label="Mandar acceso por WhatsApp">${ic('wa')}</a>` : `<button class="icon-btn" data-act="copiar" data-txt="${esc(msg)}" aria-label="Copiar mensaje">${ic('mas3')}</button>`}</div>`);
    } catch (e) {
      filas.push(`<div class="card pad"><b>${esc(p.nombre)}</b><div class="error">${esc(mensajeError(e))}</div></div>`);
    }
    res.innerHTML = filas.join('');
  }
  btn.remove();
  res.insertAdjacentHTML('afterbegin', `<div class="aviso ok">${ic('ok', 18)}<span>Listo. Mandale a cada uno su acceso por WhatsApp.</span></div>`);
}

// ---------------------------------------------------------------- cuenta
function hojaCuenta() {
  const me = st.me;
  abrirHoja(`
    <div class="row"><div class="ini rol-${me.rol}" style="width:48px;height:48px;border-radius:24px;font-size:15px">${esc(iniciales(me.nombre))}</div>
      <div class="grow"><h2>${esc(me.nombre)}</h2><div class="muted">${ROL_LABEL[me.rol]}${me.circuito ? ' · Circuito ' + esc(me.circuito) : ''}</div></div>
      <button type="button" class="icon-btn" data-act="cerrar" aria-label="Cerrar">${ic('x')}</button></div>
    <div class="card pad small stack"><div>Campaña: <b>${esc(me.campania)}</b></div><div class="num">DNI: <b>${fmtDni(me.dni)}</b></div></div>
    <button class="btn btn-sec btn-full" data-act="mi-clave">${ic('llave', 18)} Cambiar mi contraseña</button>
    <button class="btn btn-sec btn-full" data-act="salir">${DEMO ? 'Cambiar de rol' : 'Cerrar sesión'}</button>
    ${DEMO ? '<button class="btn btn-ghost" data-act="demo-reset">Volver los datos de prueba al inicio</button>' : ''}`, { tipo: 'cuenta' });
}

function hojaMiClave() {
  abrirHoja(`
    <div class="row"><h2 class="grow">Cambiar mi contraseña</h2><button type="button" class="icon-btn" data-act="cerrar" aria-label="Cerrar">${ic('x')}</button></div>
    <form id="f-clave" class="stack" autocomplete="off">
      <div><label class="label" for="cl-actual">Contraseña actual</label><input id="cl-actual" class="input" type="password" autocomplete="current-password" required></div>
      <div><label class="label" for="cl-nueva">Contraseña nueva</label><input id="cl-nueva" class="input" type="password" autocomplete="new-password" minlength="6" required>
        <div class="muted small">Al menos 6 caracteres. Que no sea tu DNI.</div></div>
      <div><label class="label" for="cl-rep">Repetí la nueva</label><input id="cl-rep" class="input" type="password" autocomplete="new-password" required></div>
      <div class="error" id="cl-err" role="alert"></div>
      <button class="btn btn-full" type="submit">Guardar contraseña</button>
    </form>`, { tipo: 'cuenta' });
  $('#cl-actual').focus();
}

async function guardarMiClave(form) {
  const actual = $('#cl-actual').value; const nueva = $('#cl-nueva').value; const rep = $('#cl-rep').value;
  const err = $('#cl-err');
  if (nueva.length < 6) { err.textContent = 'La contraseña nueva tiene que tener al menos 6 caracteres.'; return; }
  if (normDni(nueva) === st.me.dni) { err.textContent = 'No uses tu DNI como contraseña.'; return; }
  if (nueva !== rep) { err.textContent = 'Las dos contraseñas nuevas no son iguales.'; return; }
  if (nueva === actual) { err.textContent = 'La nueva tiene que ser distinta de la actual.'; return; }
  const btn = form.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Guardando…';
  try {
    await S.cambiarClave(actual, nueva);
    cerrarHoja(); toast('Listo, ya tenés tu contraseña nueva');
  } catch (e) {
    err.textContent = /invalid-credential|wrong-password/.test(e?.code || '') ? 'La contraseña actual no es correcta.' : mensajeError(e);
    btn.disabled = false; btn.textContent = 'Guardar contraseña';
  }
}

// Blanqueo: un superior le genera una contraseña nueva a alguien de su equipo que se la olvidó
function hojaBlanquear(uid) {
  const u = usuarioPorId(uid);
  if (!u) return;
  abrirHoja(`
    <div class="row"><h2 class="grow">Blanquear contraseña</h2><button type="button" class="icon-btn" data-act="cerrar" aria-label="Cerrar">${ic('x')}</button></div>
    <div>Se le genera a <b>${esc(u.nombre)}</b> una contraseña nueva para que vuelva a entrar. La anterior deja de funcionar y se cierra su sesión en otros celulares.</div>
    <div class="muted small">Su gente y su equipo no cambian.</div>
    <div class="error" id="bl-err" role="alert"></div>
    <button class="btn btn-full" data-act="blanquear-si" data-uid="${u.uid}">${ic('llave', 18)} Generar contraseña nueva</button>
    <button class="btn btn-ghost" data-act="cerrar">Cancelar</button>`, { tipo: 'usuario' });
}

async function blanquear(el) {
  const u = usuarioPorId(el.dataset.uid);
  el.disabled = true; el.textContent = 'Generando…';
  try {
    const pass = await S.blanquearClave(u.uid);
    const link = location.origin + location.pathname;
    const msg = `Hola ${primerNombre(u.nombre)}! Te blanqueamos la contraseña de ${APP_NAME}.\nEntrá en ${link}\nDNI: ${u.dni}\nContraseña nueva: ${pass}\nCuando entres, podés cambiarla en Mi cuenta → Cambiar mi contraseña.`;
    const wa = waUrl(u.tel, msg);
    hojaHtml(`
      <div class="aviso ok">${ic('ok', 18)}<span>Listo. ${esc(primerNombre(u.nombre))} ya puede entrar con la contraseña nueva.</span></div>
      <div class="card pad stack"><div class="muted small">Mandale este mensaje:</div><div style="white-space:pre-line">${esc(msg)}</div></div>
      ${wa ? `<a class="btn btn-full" href="${wa}" target="_blank" rel="noopener">${ic('wa')} Enviar por WhatsApp</a>` : ''}
      <button class="btn btn-sec" data-act="copiar" data-txt="${esc(msg)}">Copiar mensaje</button>
      <button class="btn btn-ghost" data-act="cerrar">Listo</button>`);
  } catch (e) {
    $('#bl-err').textContent = mensajeError(e);
    el.disabled = false; el.textContent = 'Generar contraseña nueva';
  }
}

// ---------------------------------------------------------------- eventos
const acciones = {
  'demo-entrar': async (el) => iniciarSesion(await S.loginDemo(el.dataset.uid)),
  'ir-crear': () => { st.login = 'crear'; pintarLogin(); },
  'ir-entrar': () => { st.login = 'entrar'; pintarLogin(); },
  tab: (el) => { st.tab = el.dataset.tab; cerrarHoja(); pintar(); if (st.tab === 'cargar') $('#c-dni')?.focus(); },
  cuenta: hojaCuenta,
  'mi-clave': hojaMiClave,
  blanquear: (el) => hojaBlanquear(el.dataset.uid),
  'blanquear-si': blanquear,
  salir,
  'demo-reset': () => { S.reiniciarDemo(); cerrarHoja(); toast('Datos de prueba reiniciados'); },
  cerrar: cerrarHoja,
  filtro: (el) => { st.f.estado = el.dataset.v; st.f.limite = 60; document.querySelectorAll('[data-act=filtro]').forEach((b) => b.setAttribute('aria-pressed', b === el)); if (liviano()) suscribirPagina(); else pintarLista(); },
  mas: () => { st.f.limite += 60; if (liviano()) suscribirPagina(); else pintarLista(); },
  ver: (el) => hojaPersona(el.dataset.dni),
  'p-estado': async (el) => { const dni = sheetCtx.dni; await actualizarPersonaApp(dni, { estado: el.dataset.v }); hojaPersona(dni); },
  'p-voto': async () => { const dni = sheetCtx.dni; const p = personaLocal(dni); await actualizarPersonaApp(dni, { voto: !p.voto, votoAt: p.voto ? null : Date.now() }); hojaPersona(dni); },
  'p-transferir': async () => {
    const dni = sheetCtx.dni; const u = usuarioPorId($('#p-trans').value);
    try { await S.transferirPersona(dni, u); toast(`Pasada a ${u.nombre}`); hojaPersona(dni); } catch (e) { toast(mensajeError(e)); }
  },
  'p-eliminar': () => hojaPersona(sheetCtx.dni, true),
  'p-eliminar-no': () => hojaPersona(sheetCtx.dni),
  'p-eliminar-si': async () => { await S.eliminarPersona(sheetCtx.dni); cachePersonas.delete(sheetCtx.dni); invalidarConteos(); programarRefresco(); cerrarHoja(); toast('Quitada de la lista'); },
  'c-buscar': buscarDni,
  'c-estado': (el) => { st.c.estado = el.dataset.v; document.querySelectorAll('[data-act=c-estado]').forEach((b) => b.setAttribute('aria-pressed', b === el)); },
  'c-guardar': guardarCarga,
  'c-otro': () => { st.c = { fase: 'inicio' }; $('#c-dni').value = ''; pintarCargar(); $('#c-dni').focus(); },
  'c-reclamar': async () => {
    const motivo = $('#c-motivo').value.trim();
    if (!motivo) { $('#c-motivo').focus(); return; }
    await S.reclamar(st.c.conflictoId, motivo);
    st.c.fase = 'reclamado'; pintarCargar();
  },
  voto: async (el) => {
    const p = personaLocal(el.dataset.dni);
    if (!p) return;
    el.classList.toggle('si', !p.voto); el.textContent = p.voto ? 'Ya votó' : '✓ Votó';
    if (!p.voto && st.dia.solo === 'pend') await pausa(450);
    await actualizarPersonaApp(p.dni, { voto: !p.voto, votoAt: p.voto ? null : Date.now() });
  },
  'dia-solo': (el) => { st.dia.solo = el.dataset.v; pintarDia(); },
  'nuevo-usuario': (el) => hojaNuevoUsuario(el.dataset.rol, el.dataset.padre || null),
  'eq-toggle': (el) => { const id = el.dataset.uid; if (st.abiertos.has(id)) st.abiertos.delete(id); else st.abiertos.add(id); pintarEquipo(); },
  'eq-opciones': (el) => hojaQuitarUsuario(el.dataset.uid),
  'eq-quitar': async (el) => {
    const u = usuarioPorId(el.dataset.uid);
    const sel = $('#qu-destino')?.value;
    const destino = sel && sel !== '__borrar' ? usuarioPorId(sel) : null;
    el.disabled = true; el.textContent = 'Quitando…';
    try {
      const dnis = (await todaLaGente([['ownerId', '==', u.uid]])).map((p) => p.dni);
      await S.quitarUsuario(u, dnis, destino);
      delete genteDe[u.uid]; invalidarConteos();
      cerrarHoja();
      toast(`${primerNombre(u.nombre)} ya no está en el equipo${dnis.length ? (destino ? ` · su gente pasó a ${destino.nombre}` : ' · su gente se borró') : ''}`);
    } catch (e) {
      $('#qu-err').textContent = mensajeError(e);
      el.disabled = false; el.textContent = 'Quitar';
    }
  },
  'circ-toggle': (el) => { const k = el.dataset.c; if (st.circAbiertos.has(k)) st.circAbiertos.delete(k); else st.circAbiertos.add(k); refrescarPartes(); },
  'circ-recalcular': async (el) => {
    el.disabled = true; el.textContent = 'Leyendo el padrón…';
    try { st.resumen = await S.recalcularResumenPadron(); pintarTablero(); if (!st.resumen) toast('No hay padrón cargado'); }
    catch (e) { toast(mensajeError(e)); el.disabled = false; }
  },
  'listas-guardar': async () => {
    const lineas = (id) => $(id).value.split('\n').map((x) => x.trim()).filter(Boolean);
    const listas = lineas('#listas-txt').map((n) => ({ id: idLista(n), nombre: n }));
    const categorias = lineas('#cats-txt').map((n) => ({ id: idLista('cat ' + n), nombre: n }));
    try {
      await S.guardarListas(listas, categorias); Object.assign(st.me, { listas, categorias });
      toast(`${listas.length} listas${categorias.length ? ' y ' + categorias.length + ' categorías' : ''} guardadas`); pintarFiscalizacion();
    } catch (e) { toast(mensajeError(e)); }
  },
  'esc-cat': (el) => { st.catSel = el.dataset.c; pintarFiscalizacion(); },
  'fx-cat': (el) => { st.fx.cat = el.dataset.c; pintarFiscal(); const p = document.querySelector('[data-voto]'); p?.scrollIntoView({ block: 'center' }); },
  'fx-siguiente': () => { const cs = categorias(); const i = cs.findIndex((c) => c.id === catActual()); st.fx.cat = cs[Math.min(i + 1, cs.length - 1)].id; pintarFiscal(); document.querySelector('[data-voto]')?.focus(); },
  'fiscal-acceso': (el) => hojaAccesoFiscal([el.dataset.dni]),
  'acc-crear': (el) => crearAccesosFiscales(el.dataset.dnis.split(',')),
  'fiscales-acceso-todos': () => hojaAccesoFiscal(fiscalesSinAcceso().map((p) => p.dni)),
  'fiscal-ver': (el) => hojaFiscal(el.dataset.id),
  'fiscal-ver-acta': async (el) => {
    const box = $('#acta-img');
    box.innerHTML = '<div class="muted">Cargando foto…</div>';
    try {
      const img = await S.leerActa(el.dataset.id);
      box.innerHTML = img ? `<a href="${img}" target="_blank" rel="noopener"><img src="${img}" alt="Foto del acta" style="width:100%;border-radius:12px;border:1px solid var(--line)"></a><div class="muted small">Tocá la foto para verla grande.</div>` : '<div class="muted">No subió foto.</div>';
    } catch (e) { box.innerHTML = `<div class="error">${esc(mensajeError(e))}</div>`; }
  },
  'fiscal-quitar': async (el) => {
    const u = usuarioPorId(el.dataset.id);
    if (!u) { toast('Ese fiscal no tiene acceso'); return; }
    try { await S.quitarUsuario(u, [], null); cerrarHoja(); toast(`${primerNombre(u.nombre)} ya no puede entrar`); } catch (e) { toast(mensajeError(e)); }
  },
  // --- pantalla del fiscal
  'fx-misma': () => { const f = miFiscalia(); guardarMesaFiscal(f.votaMesa, f.votaEscuela); },
  'fx-guardar-mesa': () => {
    const mesa = normDni($('#fx-mesa').value);
    const escuela = $('#fx-escuela').value.trim();
    if (!mesa) { $('#fx-err-mesa').textContent = 'Escribí el número de mesa.'; return; }
    guardarMesaFiscal(mesa, escuela);
  },
  'fx-cambiar-mesa': () => { st.fx.editMesa = true; pintarFiscal(); },
  'fx-presente': async () => { await S.actualizarFiscalia(st.me.uid, { presente: true, presenteAt: Date.now() }); toast('Listo, avisaste que estás en la mesa'); pintarFiscal(); },
  'fx-inc-rapida': (el) => { const t = $('#fx-inc'); t.value = el.dataset.v; t.focus(); },
  'fx-inc-enviar': async () => {
    const t = $('#fx-inc'); const texto = t.value.trim();
    if (!texto) { t.focus(); return; }
    await S.agregarIncidencia(st.me.uid, texto); t.value = ''; toast('Incidencia enviada'); pintarFiscal();
  },
  'fx-foto-otra': () => { st.fx.foto = null; pintarFiscal(); },
  'fx-enviar-acta': enviarActa,
  'fx-corregir': () => {
    const h = catsDeActa(miFiscalia().acta); const v = {};
    for (const [cat, a] of Object.entries(h)) {
      for (const [id, n] of Object.entries(a.votos || {})) v[cat + '|' + id] = n;
      ['blancos', 'nulos', 'recurridos', 'impugnados', 'total'].forEach((k) => { v[cat + '|' + k] = a[k]; });
    }
    st.fx.votos = v; st.fx.corrigiendo = true;
    st.fx.cat = (faltanCats(miFiscalia().acta)[0] || categorias()[0]).id;
    pintarFiscal();
  },
  'eq-ver-gente': (el) => { st.tab = 'gente'; st.f = { estado: 'todos', q: '', de: el.dataset.uid, limite: 60 }; pintar(); },
  copiar: async (el) => {
    try { await navigator.clipboard.writeText(el.dataset.txt); toast('Mensaje copiado'); }
    catch { const r = document.createRange(); r.selectNodeContents($('#nu-msg')); getSelection().removeAllRanges(); getSelection().addRange(r); toast('Seleccioná y copiá el texto'); }
  },
  'conf-si': async (el) => { const c = st.conflictos.find((x) => x.id === el.dataset.id); try { await S.resolverConflicto(c, true); toast(`Pasada a ${c.byNombre}`); } catch (e) { toast(mensajeError(e)); } },
  'conf-no': async (el) => { const c = st.conflictos.find((x) => x.id === el.dataset.id); try { await S.resolverConflicto(c, false); toast('Conflicto cerrado'); } catch (e) { toast(mensajeError(e)); } },
  borrar: async () => {
    const que = $('#borrar-que').value;
    const res = $('#borrar-res');
    if ($('#borrar-ok').value.trim().toUpperCase() !== 'BORRAR') { res.innerHTML = '<div class="error">Escribí BORRAR para confirmar.</div>'; return; }
    res.innerHTML = '<div class="muted" id="borrar-txt">Juntando la lista…</div><div class="progreso"><i id="borrar-prog"></i></div>';
    let dnis = [];
    if (que === 'personas') { try { dnis = (await todaLaGente()).map((p) => p.dni); } catch (e) { res.innerHTML = `<div class="aviso bad">${esc(mensajeError(e))}</div>`; return; } }
    res.innerHTML = '<div class="muted" id="borrar-txt">Borrando…</div><div class="progreso"><i id="borrar-prog"></i></div>';
    const prog = (h, t) => { const b = $('#borrar-prog'); if (b) b.style.width = pct(h, t) + '%'; const x = $('#borrar-txt'); if (x) x.textContent = `Borrando ${h.toLocaleString('es-AR')} de ${t.toLocaleString('es-AR')}…`; };
    try {
      if (que === 'personas') {
        await S.borrarPersonas(dnis, prog);
        cachePersonas.clear(); for (const k in genteDe) delete genteDe[k]; fiscPers = null; fiscT = 0; invalidarConteos();
        // Los conflictos pendientes ya no tienen sentido: se cierran
        for (const c of st.conflictos.filter((x) => x.estado === 'intento' || x.estado === 'reclamo')) { try { await S.resolverConflicto(c, false); } catch { /* sigue */ } }
      } else { await S.borrarPadron(prog); st.resumen = null; pintarTablero(); }
      $('#borrar-ok').value = '';
      res.innerHTML = `<div class="aviso ok">${ic('ok', 18)}<span>${que === 'personas' ? `Listo: se borraron ${dnis.length.toLocaleString('es-AR')} personas.` : 'Listo: se borró el padrón.'}</span></div>`;
    } catch (e) {
      res.innerHTML = `<div class="aviso bad">${ic('alerta', 18)}<span>${esc(mensajeError(e))}. Si cortó a la mitad, tocá Borrar de nuevo.</span></div>`;
    }
  },
  'imp-confirmar': (el) => confirmarImportacion(el.dataset.pre || 'imp'),
  'pad-confirmar': confirmarPadron,
  exportar: async () => {
    try { if (liviano()) toast('Preparando el Excel…'); await exportarExcel(await todaLaGente(), st.usuarios, `${APP_NAME}-${new Date().toISOString().slice(0, 10)}.xlsx`); toast('Excel descargado'); }
    catch (e) { toast(mensajeError(e)); }
  }
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const f = acciones[el.dataset.act];
  if (f) { e.preventDefault(); f(el, e); }
});

document.addEventListener('submit', async (e) => {
  const f = e.target;
  e.preventDefault();
  if (f.id === 'f-login') {
    const err = $('#l-err'); err.textContent = '';
    const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
    try { iniciarSesion(await S.login(normDni($('#l-dni').value), $('#l-pass').value)); }
    catch (x) { err.textContent = mensajeError(x); btn.disabled = false; }
  }
  if (f.id === 'f-crear') {
    const err = $('#cc-err'); err.textContent = '';
    const dni = normDni($('#cc-dni').value);
    if (!dniValido(dni)) { err.textContent = 'El DNI tiene que tener 7 u 8 números.'; return; }
    const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
    try {
      iniciarSesion(await S.crearCampania({ campania: $('#cc-camp').value.trim(), nombre: $('#cc-nom').value.trim(), dni, tel: normDni($('#cc-tel').value), pass: $('#cc-pass').value }));
    } catch (x) { err.textContent = mensajeError(x); btn.disabled = false; }
  }
  if (f.id === 'f-usuario') crearUsuario(f);
  if (f.id === 'f-clave') guardarMiClave(f);
});

let tBusqueda = null;
document.addEventListener('input', (e) => {
  const id = e.target.id;
  if (e.target.dataset?.voto) { st.fx.votos[e.target.dataset.voto] = e.target.value; actualizarSumaActa(); }
  if (id === 'q') { st.f.q = e.target.value; st.f.limite = 60; clearTimeout(tBusqueda); tBusqueda = setTimeout(liviano() ? suscribirPagina : pintarLista, liviano() ? 400 : 150); }
  if (id === 'c-dni') {
    st.c.dniTxt = e.target.value;
    if (normDni(e.target.value).length === 8) buscarDni();
    else if (st.c.fase !== 'inicio') { st.c = { fase: 'inicio', dniTxt: e.target.value }; pintarCargar(); }
  }
});

// Recordar qué desplegables quedaron abiertos cuando se redibuja con datos nuevos
document.addEventListener('toggle', (e) => {
  const k = e.target?.dataset?.recordar;
  if (k) (st.abiertosUI ||= {})[k] = e.target.open;
}, true);

document.addEventListener('keydown', (e) => {
  // En el acta, "Siguiente"/Enter pasa al próximo número; al final de una categoría, a la siguiente
  if (e.key === 'Enter' && e.target.dataset?.voto) {
    e.preventDefault();
    const todos = [...document.querySelectorAll('[data-voto]')];
    const i = todos.indexOf(e.target);
    if (i < todos.length - 1) { todos[i + 1].focus(); todos[i + 1].select?.(); }
    else if (document.querySelector('[data-act="fx-siguiente"]')) acciones['fx-siguiente']();
    else e.target.blur();
    return;
  }
  if (e.key === 'Enter' && e.target.id === 'c-dni') { e.preventDefault(); buscarDni(); }
  if (e.key === 'Escape' && sheetCtx) cerrarHoja();
});

document.addEventListener('change', async (e) => {
  const id = e.target.id;
  if (id === 'de') { st.f.de = e.target.value; st.f.limite = 60; if (liviano()) suscribirPagina(); else pintarLista(); }
  if (sheetCtx?.tipo === 'persona') {
    const dni = sheetCtx.dni;
    if (id === 'p-tel') { await actualizarPersonaApp(dni, { tel: normDni(e.target.value) }); toast('Teléfono guardado'); }
    if (id === 'p-nota') { await actualizarPersonaApp(dni, { nota: e.target.value.trim(), revisar: false }); toast('Nota guardada'); }
    if (id === 'p-tipo') { await actualizarPersonaApp(dni, { tipo: e.target.value }); }
  }
  if (id === 'fx-foto' && e.target.files[0]) tomarFotoActa(e.target.files[0]);
  if (id === 'imp-file' && e.target.files[0]) analizarImportacion(e.target.files[0], 'imp');
  if (id === 'fis-file' && e.target.files[0]) analizarImportacion(e.target.files[0], 'fis');
  if (id === 'pad-file' && e.target.files[0]) analizarPadron(e.target.files[0]);
});

boot().catch((e) => {
  console.error(e);
  $('#app').innerHTML = `<div class="login"><div class="aviso bad">${esc(mensajeError(e))}</div></div>`;
});
