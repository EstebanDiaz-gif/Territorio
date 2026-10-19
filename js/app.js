import { APP_NAME, FIREBASE_CONFIG, ZONA } from './config.js';
import {
  ROLES, ROL_LABEL, ROL_CORTO, nivel, rolAbajo, ESTADOS, ESTADO_LABEL, TIPOS, TIPO_LABEL,
  normDni, dniValido, fmtDni, telWhatsApp
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
const puedePadron = () => ['cabeza', 'encargado'].includes(st.me.rol);
const usuarioPorId = (uid) => st.usuarios.find((u) => u.uid === uid);
const miEquipo = () => st.usuarios.filter((u) => u.uid !== st.me.uid && (st.me.rol === 'cabeza' || u.path.includes(st.me.uid)));
const pausa = (t) => new Promise((r) => setTimeout(r, t));

function mensajeError(e) {
  const c = e?.code || '';
  if (/invalid-credential|wrong-password|user-not-found|invalid-email/.test(c)) return 'DNI o contraseña incorrectos.';
  if (/email-already-in-use/.test(c)) return 'Ese DNI ya tiene un usuario creado.';
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
  alerta: '<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4.5M12 17.5v.3"/>',
  mas: '<path d="M12 5v14M5 12h14"/>',
  subir: '<path d="M12 15V3M7 8l5-5 5 5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
  bajar: '<path d="M12 3v12M7 10l5 5 5-5M4 19h16"/>',
  auto: '<path d="M3 16v-5l2-5h11l3 5h2v5h-2"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/><path d="M9 17h6"/>',
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
  st.unsubs.forEach((u) => u());
  st.unsubs = [
    S.watchUsuarios((x) => { st.usuarios = x; refrescar(); }),
    S.watchPersonas((x) => { st.personas = x; refrescar(); }),
    S.watchConflictos((x) => { st.conflictos = x; refrescar(); })
  ];
  pintar();
}

async function salir() {
  st.unsubs.forEach((u) => u()); st.unsubs = [];
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
        ${[['cab1', 'cabeza'], ['enc1', 'encargado'], ['dir1', 'dirigente'], ['mov1', 'movilizador']].map(([uid, rol]) => `
          <button type="button" data-act="demo-entrar" data-uid="${uid}"><b>${ROL_CORTO[rol]}</b><span class="muted small">${esc({ cab1: 'Ricardo Benítez', enc1: 'Laura Molina · circ. 19', dir1: 'Daniel Torres', mov1: 'Marcos Ríos' }[uid])}</span></button>`).join('')}
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
  const app = $('#app');
  app.innerHTML = `
    ${DEMO ? '<div class="demo-band">Modo demostración · los datos son inventados</div>' : ''}
    <header class="top" id="top"></header>
    <main id="main"></main>
    <nav class="tabs" aria-label="Secciones"><div class="in" id="nav"></div></nav>`;
  pintarNav();
  pintarTop();
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
  const s = stats(st.personas);
  const titulos = { gente: esMov() ? 'Mi gente' : 'Gente del equipo', cargar: 'Cargar persona', dia: 'Día de elección', equipo: 'Equipo', panel: 'Panel' };
  const sub = `${ROL_LABEL[me.rol]}${me.circuito ? ' · Circuito ' + esc(me.circuito) : ''} · ${esc(me.campania || '')}`;
  let extra = '';
  if (st.tab === 'gente') {
    extra = `<div class="kpis">
      <div class="kpi"><b>${s.total}</b><span>cargados</span></div>
      <div class="kpi"><b class="v-ok">${s.conf}</b><span>confirm.</span></div>
      <div class="kpi"><b class="v-warn">${s.tras}</b><span>traslado</span></div>
      <div class="kpi"><b>${s.voto}</b><span>votaron</span></div>
    </div>`;
  } else if (st.tab === 'dia') {
    extra = `<div class="row" style="justify-content:space-between;align-items:baseline">
        <span class="top-sub">Ya votaron</span>
        <span><b class="num" style="font:800 28px/1 var(--f-display)">${s.voto}</b><span class="top-sub"> de ${s.total} · ${pct(s.voto, s.total)}%</span></span>
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
  pintarTop();
  pintarNav();
  refrescarPartes();
}
function refrescarPartes() {
  if (st.tab === 'gente') pintarLista();
  if (st.tab === 'dia') pintarDia();
  if (st.tab === 'equipo') pintarEquipo();
  if (st.tab === 'panel') { pintarTablero(); pintarConflictos(); }
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
  if (!st.personas.length) {
    el.innerHTML = `<div class="card vacio stack"><h3>Todavía no cargaste a nadie</h3><div>Tocá <b>Cargar</b> y escribí el DNI: los datos de dónde vota se completan solos.</div><button class="btn" data-act="tab" data-tab="cargar">${ic('mas')} Cargar persona</button></div>`;
    return;
  }
  if (!lista.length) { el.innerHTML = '<div class="vacio">No hay nadie con ese filtro.</div>'; return; }
  el.innerHTML = lista.slice(0, st.f.limite).map(tarjetaPersona).join('') +
    (lista.length > st.f.limite ? `<button class="btn btn-sec mas" data-act="mas">Ver ${Math.min(60, lista.length - st.f.limite)} más (quedan ${lista.length - st.f.limite})</button>` : `<div class="muted small" style="text-align:center">${lista.length} ${lista.length === 1 ? 'persona' : 'personas'}</div>`);
}

function hojaPersona(dni, confirmarBorrado = false) {
  const p = st.personas.find((x) => x.dni === dni);
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
      ${DEMO ? '<div class="muted small">Para probar: <b>38512004</b> (libre) · <b>22731880</b> (ya es de otro movilizador) · <b>12345678</b> (no está en el padrón)</div>' : ''}
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
  const cont = conteoPorUsuario();
  const todos = st.me.rol === 'cabeza' ? st.usuarios : st.usuarios.filter((u) => u.path.includes(st.me.uid));
  const arbol = ordenarArbol(todos);
  const base = st.me.rol === 'cabeza' ? 0 : nivel(st.me.rol);
  if (arbol.length <= 1 && st.me.rol !== 'cabeza') {
    el.innerHTML = `<div class="card vacio">Todavía no agregaste a nadie a tu equipo.</div>`;
    return;
  }
  el.innerHTML = `<div class="card">${arbol.map((u) => {
    const [n, v] = cont[u.uid] || [0, 0];
    const prof = Math.max(0, nivel(u.rol) - base);
    const wa = waUrl(u.tel);
    return `<div class="miembro" style="padding-left:${14 + prof * 18}px">
      <div class="ini rol-${u.rol}">${esc(iniciales(u.nombre))}</div>
      <div class="grow"><div style="font-weight:700">${esc(u.nombre)}${u.uid === st.me.uid ? ' <span class="muted">(vos)</span>' : ''}</div>
        <div class="muted small">${ROL_CORTO[u.rol]}${u.circuito ? ' · Circ. ' + esc(u.circuito) : ''} · <span class="num">${n} cargados · ${v} votaron</span></div></div>
      ${wa && u.uid !== st.me.uid ? `<a class="icon-btn wa" href="${wa}" target="_blank" rel="noopener" aria-label="WhatsApp a ${esc(u.nombre)}">${ic('wa')}</a>` : ''}
    </div>`;
  }).join('')}</div>`;
}

function hojaNuevoUsuario(rol) {
  const clave = String(Math.floor(100000 + Math.random() * 900000));
  abrirHoja(`
    <div class="row"><h2 class="grow">Agregar ${ROL_CORTO[rol].toLowerCase()}</h2><button type="button" class="icon-btn" data-act="cerrar" aria-label="Cerrar">${ic('x')}</button></div>
    <form id="f-usuario" class="stack" data-rol="${rol}" autocomplete="off">
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
  const nombre = $('#nu-nom').value.trim();
  const dni = normDni($('#nu-dni').value);
  const tel = normDni($('#nu-tel').value);
  const pass = $('#nu-pass').value.trim();
  const circuito = normDni($('#nu-circ')?.value || '') || '';
  const err = $('#nu-err');
  if (!dniValido(dni)) { err.textContent = 'El DNI tiene que tener 7 u 8 números.'; return; }
  if (pass.length < 6 && !DEMO) { err.textContent = 'La contraseña tiene que tener al menos 6 caracteres.'; return; }
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true; btn.textContent = 'Creando…';
  try {
    await S.crearUsuario({ dni, nombre, tel, rol, pass, circuito });
    const link = location.origin + location.pathname;
    const msg = `Hola ${primerNombre(nombre)}! Ya tenés acceso a ${APP_NAME} como ${ROL_CORTO[rol].toLowerCase()}${circuito ? ' del circuito ' + circuito : ''}.\nEntrá en ${link}\nDNI: ${dni}\nContraseña: ${pass}`;
    const wa = waUrl(tel, msg);
    hojaHtml(`
      <div class="aviso ok">${ic('ok', 18)}<span>${esc(nombre)} ya puede entrar.</span></div>
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
  return `
    <div id="tablero" class="stack"></div>
    <div id="conflictos"></div>
    <div class="sec-title"><h2>Importar planilla de gente</h2></div>
    <div class="card pad stack">
      <div class="muted">Excel, CSV o Word con una tabla. Detecta las columnas solo, limpia los DNI y completa escuela y mesa con el padrón. Los DNI que ya son de otro no se importan.</div>
      <label class="archivo" for="imp-file">${ic('subir', 22)}<div><b>Elegir archivo</b></div><input id="imp-file" type="file" accept=".xlsx,.xls,.csv,.docx,.ods"></label>
      <div id="imp-res" class="stack"></div>
    </div>
    ${puedePadron() ? `
    <div class="sec-title"><h2>Padrón</h2>${S.padronCantidad?.() != null ? `<span class="muted num">${S.padronCantidad().toLocaleString('es-AR')} cargados</span>` : ''}</div>
    <div class="card pad stack">
      <div class="muted">Subí el padrón que recibe el partido (Excel o CSV). Con esto, al escribir un DNI se completan nombre, escuela, mesa y orden.</div>
      <div><label class="label" for="pad-circ">Circuito (si el archivo no trae esa columna)</label><input id="pad-circ" class="input" inputmode="numeric" value="${esc(st.me.circuito || '')}" placeholder="Ej: 19"></div>
      <label class="archivo" for="pad-file">${ic('subir', 22)}<div><b>Elegir padrón</b></div><input id="pad-file" type="file" accept=".xlsx,.xls,.csv,.ods,.docx"></label>
      <div id="pad-res" class="stack"></div>
    </div>` : ''}
    <div class="sec-title"><h2>Exportar</h2></div>
    <button class="btn btn-sec" data-act="exportar">${ic('bajar')} Descargar Excel de mi equipo</button>`;
}

function pintarTablero() {
  const el = $('#tablero');
  if (!el) return;
  const s = stats(st.personas);
  const porCirc = {};
  for (const p of st.personas) { const k = p.circuito || '–'; porCirc[k] ||= [0, 0]; porCirc[k][0]++; if (p.voto) porCirc[k][1]++; }
  const circs = Object.entries(porCirc).sort((a, b) => a[0].localeCompare(b[0], 'es', { numeric: true }));
  const rolRanking = st.me.rol === 'cabeza' ? 'encargado' : rolAbajo(st.me.rol);
  const cont = conteoPorUsuario();
  const ranking = st.usuarios.filter((u) => u.rol === rolRanking && (st.me.rol === 'cabeza' || u.parentId === st.me.uid))
    .map((u) => ({ u, n: (cont[u.uid] || [0, 0])[0], v: (cont[u.uid] || [0, 0])[1] }))
    .sort((a, b) => b.n - a.n);
  el.innerHTML = `
    <div class="tiles">
      <div class="tile t-acc"><b>${s.total.toLocaleString('es-AR')}</b><span>personas cargadas</span></div>
      <div class="tile t-ok"><b>${pct(s.voto, s.total)}%</b><span>ya votó (${s.voto})</span></div>
      <div class="tile t-ok"><b>${s.conf}</b><span>confirmados</span></div>
      <div class="tile t-warn"><b>${s.trasPend}</b><span>traslados pendientes</span></div>
      <div class="tile t-neutral"><b>${s.fisc}</b><span>fiscales</span></div>
      <div class="tile ${s.rev ? 't-warn' : 't-neutral'}"><b>${s.rev}</b><span>con datos a revisar</span></div>
    </div>
    ${circs.length ? `<div class="card pad stack"><h3>Votación por circuito</h3>
      ${circs.map(([k, [n, v]]) => `<div><div class="row small" style="justify-content:space-between"><b>Circuito ${esc(k)}</b><span class="muted num">${v} de ${n} · ${pct(v, n)}%</span></div><div class="bar" style="margin-top:5px"><i style="width:${pct(v, n)}%"></i></div></div>`).join('')}
    </div>` : ''}
    ${ranking.length ? `<div class="card"><div class="escuela-h"><h3 class="grow">${ROL_CORTO[rolRanking]}s</h3><span class="muted small">votaron / cargados</span></div>
      ${ranking.map(({ u, n, v }) => `<div class="miembro"><div class="ini rol-${u.rol}">${esc(iniciales(u.nombre))}</div>
        <div class="grow"><div style="font-weight:600">${esc(u.nombre)}</div><div class="muted small">${u.circuito ? 'Circuito ' + esc(u.circuito) : ''}</div></div>
        <span class="num" style="font-weight:700">${v}/${n}</span><span class="pill ${pct(v, n) >= 60 ? 'p-ok' : 'p-warn'}">${pct(v, n)}%</span></div>`).join('')}
    </div>` : ''}`;
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
      const p = cab ? st.personas.find((x) => x.dni === c.dni) : null;
      return `<div class="card pad stack">
        <div class="row"><div class="grow"><b class="num">DNI ${fmtDni(c.dni)}</b>${p ? ` · ${esc(p.nombre)}` : ''}<div class="muted small">Intentó cargarlo <b>${esc(c.byNombre)}</b>${p ? ` · hoy es de <b>${esc(p.ownerNombre)}</b>` : ''}</div></div>
        <span class="pill ${c.estado === 'reclamo' ? 'p-warn' : 'p-neutral'}">${c.estado === 'reclamo' ? 'Reclamo' : 'Intento'}</span></div>
        ${c.motivo ? `<div class="small">“${esc(c.motivo)}”</div>` : ''}
        ${cab ? `<div class="row"><button class="btn btn-sec btn-sm grow" data-act="conf-no" data-id="${c.id}">Dejar como está</button><button class="btn btn-sm grow" data-act="conf-si" data-id="${c.id}">Pasar a ${esc(primerNombre(c.byNombre))}</button></div>` : ''}
      </div>`;
    }).join('')}</div>`;
}

// ----- importar planilla de personas
async function analizarImportacion(file) {
  const res = $('#imp-res');
  res.innerHTML = '<div class="muted">Leyendo archivo…</div>';
  try {
    const leido = await leerArchivo(file);
    const m = mapearPersonas(leido);
    res.innerHTML = `<div class="muted">Revisando ${m.validas.length} personas contra el padrón y la base…</div><div class="progreso"><i id="imp-prog"></i></div>`;
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
      const bar = $('#imp-prog'); if (bar) bar.style.width = pct(++i, m.validas.length) + '%';
    });
    // ¿Quién figura como referente en la planilla?
    const refTxt = sinAcentos(m.info.meta.referente || m.info.meta.dirigente || m.info.meta.movilizador || '');
    const sugerido = refTxt ? [st.me, ...miEquipo()].find((u) => sinAcentos(u.nombre).split(/\s+/).every((w) => refTxt.includes(w))) : null;
    st.imp = { nuevas, propias, ocupadas, m, delPadron, noPadron, archivo: file.name };
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
        <div class="tile t-neutral"><b>${propias.length}</b><span>ya estaban en tu equipo</span></div>
        <div class="tile t-neutral"><b>${m.invalidas.length + m.repetidasEnArchivo}</b><span>filas con DNI inválido o repetidas</span></div>
      </div>
      ${m.invalidas.length ? `<details class="small"><summary>Ver filas con problemas</summary><ul>${m.invalidas.map((x) => `<li>${esc(x.nombre || '(sin nombre)')}: ${esc(x.motivo)}${x.dniTxt ? ' (' + esc(x.dniTxt) + ')' : ''}</li>`).join('')}</ul></details>` : ''}
      ${nuevas.length ? `
        <div><label class="label" for="imp-dueno">Asignar a</label>
          <select id="imp-dueno" class="input">${ordenarArbol([st.me, ...miEquipo()]).map((u) => `<option value="${u.uid}" ${sugerido?.uid === u.uid ? 'selected' : ''}>${esc(u.nombre)}${u.uid === st.me.uid ? ' (vos)' : ' · ' + ROL_CORTO[u.rol]}</option>`).join('')}</select>
          ${m.info.meta.referente ? `<div class="muted small" style="margin-top:4px">La planilla dice referente: ${esc(m.info.meta.referente)}${sugerido ? '' : ' (no coincide con nadie de tu equipo)'}</div>` : ''}
        </div>
        <button class="btn btn-full" data-act="imp-confirmar">Importar ${nuevas.length} ${nuevas.length === 1 ? 'persona' : 'personas'}</button>` : ''}`;
  } catch (e) {
    res.innerHTML = `<div class="aviso bad">${ic('alerta', 18)}<span>${esc(mensajeError(e))}</span></div>`;
  }
}

async function confirmarImportacion() {
  const imp = st.imp;
  if (!imp) return;
  const dueno = usuarioPorId($('#imp-dueno')?.value) || st.me;
  const res = $('#imp-res');
  res.innerHTML = `<div class="muted">Importando…</div><div class="progreso"><i id="imp-prog"></i></div>`;
  let ok = 0; let conflictos = imp.ocupadas.length; let i = 0;
  const total = imp.nuevas.length + imp.ocupadas.length;
  await enParalelo([...imp.nuevas, ...imp.ocupadas], 4, async (d) => {
    try {
      const r = await S.cargarPersona({ ...d, estado: 'sin' }, dueno);
      if (r.ok) ok++; else if (r.conflicto && imp.nuevas.includes(d)) conflictos++;
    } catch { /* se informa abajo */ }
    const bar = $('#imp-prog'); if (bar) bar.style.width = pct(++i, total) + '%';
  });
  st.imp = null;
  $('#imp-file').value = '';
  res.innerHTML = `<div class="aviso ok">${ic('ok', 18)}<span>Listo: ${ok} importadas a ${esc(dueno.uid === st.me.uid ? 'tu lista' : dueno.nombre)}.${conflictos ? ` ${conflictos} quedaron como conflicto.` : ''}</span></div>`;
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

// ---------------------------------------------------------------- cuenta
function hojaCuenta() {
  const me = st.me;
  abrirHoja(`
    <div class="row"><div class="ini rol-${me.rol}" style="width:48px;height:48px;border-radius:24px;font-size:15px">${esc(iniciales(me.nombre))}</div>
      <div class="grow"><h2>${esc(me.nombre)}</h2><div class="muted">${ROL_LABEL[me.rol]}${me.circuito ? ' · Circuito ' + esc(me.circuito) : ''}</div></div>
      <button type="button" class="icon-btn" data-act="cerrar" aria-label="Cerrar">${ic('x')}</button></div>
    <div class="card pad small stack"><div>Campaña: <b>${esc(me.campania)}</b></div><div class="num">DNI: <b>${fmtDni(me.dni)}</b></div></div>
    <button class="btn btn-sec btn-full" data-act="salir">${DEMO ? 'Cambiar de rol' : 'Cerrar sesión'}</button>
    ${DEMO ? '<button class="btn btn-ghost" data-act="demo-reset">Volver los datos de prueba al inicio</button>' : ''}`, { tipo: 'cuenta' });
}

// ---------------------------------------------------------------- eventos
const acciones = {
  'demo-entrar': async (el) => iniciarSesion(await S.loginDemo(el.dataset.uid)),
  'ir-crear': () => { st.login = 'crear'; pintarLogin(); },
  'ir-entrar': () => { st.login = 'entrar'; pintarLogin(); },
  tab: (el) => { st.tab = el.dataset.tab; cerrarHoja(); pintar(); if (st.tab === 'cargar') $('#c-dni')?.focus(); },
  cuenta: hojaCuenta,
  salir,
  'demo-reset': () => { S.reiniciarDemo(); cerrarHoja(); toast('Datos de prueba reiniciados'); },
  cerrar: cerrarHoja,
  filtro: (el) => { st.f.estado = el.dataset.v; st.f.limite = 60; document.querySelectorAll('[data-act=filtro]').forEach((b) => b.setAttribute('aria-pressed', b === el)); pintarLista(); },
  mas: () => { st.f.limite += 60; pintarLista(); },
  ver: (el) => hojaPersona(el.dataset.dni),
  'p-estado': async (el) => { const dni = sheetCtx.dni; await S.actualizarPersona(dni, { estado: el.dataset.v }); hojaPersona(dni); },
  'p-voto': async () => { const dni = sheetCtx.dni; const p = st.personas.find((x) => x.dni === dni); await S.actualizarPersona(dni, { voto: !p.voto, votoAt: p.voto ? null : Date.now() }); hojaPersona(dni); },
  'p-transferir': async () => {
    const dni = sheetCtx.dni; const u = usuarioPorId($('#p-trans').value);
    try { await S.transferirPersona(dni, u); toast(`Pasada a ${u.nombre}`); hojaPersona(dni); } catch (e) { toast(mensajeError(e)); }
  },
  'p-eliminar': () => hojaPersona(sheetCtx.dni, true),
  'p-eliminar-no': () => hojaPersona(sheetCtx.dni),
  'p-eliminar-si': async () => { await S.eliminarPersona(sheetCtx.dni); cerrarHoja(); toast('Quitada de la lista'); },
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
    const p = st.personas.find((x) => x.dni === el.dataset.dni);
    if (!p) return;
    el.classList.toggle('si', !p.voto); el.textContent = p.voto ? 'Ya votó' : '✓ Votó';
    if (!p.voto && st.dia.solo === 'pend') await pausa(450);
    await S.actualizarPersona(p.dni, { voto: !p.voto, votoAt: p.voto ? null : Date.now() });
  },
  'dia-solo': (el) => { st.dia.solo = el.dataset.v; pintarDia(); },
  'nuevo-usuario': (el) => hojaNuevoUsuario(el.dataset.rol),
  copiar: async (el) => {
    try { await navigator.clipboard.writeText(el.dataset.txt); toast('Mensaje copiado'); }
    catch { const r = document.createRange(); r.selectNodeContents($('#nu-msg')); getSelection().removeAllRanges(); getSelection().addRange(r); toast('Seleccioná y copiá el texto'); }
  },
  'conf-si': async (el) => { const c = st.conflictos.find((x) => x.id === el.dataset.id); try { await S.resolverConflicto(c, true); toast(`Pasada a ${c.byNombre}`); } catch (e) { toast(mensajeError(e)); } },
  'conf-no': async (el) => { const c = st.conflictos.find((x) => x.id === el.dataset.id); try { await S.resolverConflicto(c, false); toast('Queda como estaba'); } catch (e) { toast(mensajeError(e)); } },
  'imp-confirmar': confirmarImportacion,
  'pad-confirmar': confirmarPadron,
  exportar: async () => {
    try { await exportarExcel(st.personas, st.usuarios, `${APP_NAME}-${new Date().toISOString().slice(0, 10)}.xlsx`); toast('Excel descargado'); }
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
});

let tBusqueda = null;
document.addEventListener('input', (e) => {
  const id = e.target.id;
  if (id === 'q') { st.f.q = e.target.value; st.f.limite = 60; clearTimeout(tBusqueda); tBusqueda = setTimeout(pintarLista, 150); }
  if (id === 'c-dni') {
    st.c.dniTxt = e.target.value;
    if (normDni(e.target.value).length === 8) buscarDni();
    else if (st.c.fase !== 'inicio') { st.c = { fase: 'inicio', dniTxt: e.target.value }; pintarCargar(); }
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'c-dni') { e.preventDefault(); buscarDni(); }
  if (e.key === 'Escape' && sheetCtx) cerrarHoja();
});

document.addEventListener('change', async (e) => {
  const id = e.target.id;
  if (id === 'de') { st.f.de = e.target.value; st.f.limite = 60; pintarLista(); }
  if (sheetCtx?.tipo === 'persona') {
    const dni = sheetCtx.dni;
    if (id === 'p-tel') { await S.actualizarPersona(dni, { tel: normDni(e.target.value) }); toast('Teléfono guardado'); }
    if (id === 'p-nota') { await S.actualizarPersona(dni, { nota: e.target.value.trim(), revisar: false }); toast('Nota guardada'); }
    if (id === 'p-tipo') { await S.actualizarPersona(dni, { tipo: e.target.value }); }
  }
  if (id === 'imp-file' && e.target.files[0]) analizarImportacion(e.target.files[0]);
  if (id === 'pad-file' && e.target.files[0]) analizarPadron(e.target.files[0]);
});

boot().catch((e) => {
  console.error(e);
  $('#app').innerHTML = `<div class="login"><div class="aviso bad">${esc(mensajeError(e))}</div></div>`;
});
