// MODO DEMO: misma interfaz que store-firebase.js, pero todo se guarda en este navegador.
// Sirve para mostrar y probar la app sin configurar nada. Los datos son inventados.
import { bucketDe, padronAString, padronDeString, nivel, idLista, palabrasDe } from './roles.js';

export const modo = 'demo';
const KEY = 'territorio-demo-v5';
const SESION = 'territorio-demo-sesion';
let db = null;
let me = null;
const subs = new Set();

function cargar() {
  try { db = JSON.parse(localStorage.getItem(KEY)); } catch { db = null; }
  if (!db || !db.usuarios) db = semilla();
}
function guardar() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* sin almacenamiento */ }
  subs.forEach((f) => f());
}
const espera = (ms = 120) => new Promise((r) => setTimeout(r, ms));
const ahora = () => Date.now();
const err = (code, message) => Object.assign(new Error(message), { code });

// ---------- Sesión ----------
export async function init() {
  cargar();
  let uid = null;
  try { uid = sessionStorage.getItem(SESION) || localStorage.getItem(SESION); } catch { /* */ }
  if (uid && db.usuarios[uid]) me = conCampania(db.usuarios[uid]);
  return me;
}
const conCampania = (u) => ({ ...u, campania: db.campania.nombre, listas: db.campania.listas || [], categorias: db.campania.categorias || [] });

export async function login(dni, pass) {
  await espera();
  const u = Object.values(db.usuarios).find((x) => x.dni === dni);
  if (!u || db.claves[u.uid] !== pass) throw err('auth/invalid-credential', 'DNI o contraseña incorrectos');
  me = conCampania(u);
  try { localStorage.setItem(SESION, u.uid); } catch { /* */ }
  return me;
}
export async function loginDemo(uid) {
  me = conCampania(db.usuarios[uid]);
  try { localStorage.setItem(SESION, uid); } catch { /* */ }
  return me;
}
export async function logout() {
  me = null;
  try { localStorage.removeItem(SESION); } catch { /* */ }
}
export async function crearCampania() {
  throw err('demo', 'En el modo demo ya hay una campaña cargada. Conectá Firebase para crear la tuya.');
}
export function reiniciarDemo() {
  db = semilla();
  guardar();
}

// ---------- Usuarios ----------
function visibleUsuario(u) { return me.rol === 'cabeza' || u.path.includes(me.uid); }

export function watchUsuarios(cb) {
  const f = () => cb(Object.values(db.usuarios).filter(visibleUsuario));
  subs.add(f); f();
  return () => subs.delete(f);
}

export async function crearUsuario({ dni, nombre, tel, rol, pass, circuito, padre }) {
  const sup = padre || me;
  await espera();
  if (Object.values(db.usuarios).some((u) => u.dni === dni)) throw err('auth/email-already-in-use', 'Ese DNI ya tiene usuario');
  const esCabeza = rol === 'cabeza';
  const nivelOk = rol === 'fiscal' || nivel(rol) === nivel(sup.rol) + 1;
  if (esCabeza ? me.rol !== 'cabeza' : (!nivelOk || me.rol === 'fiscal' || !(me.rol === 'cabeza' || sup.path.includes(me.uid)))) throw err('permission-denied', 'No podés crear ese rol');
  const uid = 'u' + Math.random().toString(36).slice(2, 9);
  db.usuarios[uid] = {
    uid, dni, nombre, tel: tel || '', rol,
    parentId: esCabeza ? null : sup.uid,
    path: esCabeza ? [uid] : [...sup.path, uid],
    circuito: circuito || sup.circuito || '',
    creado: ahora()
  };
  db.claves[uid] = pass;
  guardar();
  return { uid, reactivado: false };
}

export async function quitarUsuario(u, dnis, destino) {
  for (const d of dnis) {
    const p = db.personas[d];
    if (!p) continue;
    if (destino) Object.assign(p, { ownerId: destino.uid, ownerNombre: destino.nombre, path: destino.path });
    else delete db.personas[d];
  }
  delete db.usuarios[u.uid];
  guardar();
}

// ---------- Padrón ----------
export async function buscarPadron(dni) {
  await espera(80);
  const b = db.padron[bucketDe(dni)];
  return b && b[dni] ? padronDeString(dni, b[dni]) : null;
}
export async function importarPadron(registros, onProgreso) {
  let i = 0;
  for (const r of registros) {
    const k = bucketDe(r.dni);
    (db.padron[k] ||= {})[r.dni] = padronAString(r);
    if (++i % 500 === 0) { onProgreso?.(i, registros.length); await espera(0); }
  }
  guardar();
  onProgreso?.(registros.length, registros.length);
}
export async function leerResumenPadron() {
  const c = {};
  for (const b of Object.values(db.padron)) for (const dni in b) {
    const r = padronDeString(dni, b[dni]);
    const x = (c[r.circuito || '–'] ||= { e: 0, esc: {} });
    x.e++;
    const n = r.escuela || 'Sin escuela';
    x.esc[n] = (x.esc[n] || 0) + 1;
  }
  const out = {};
  for (const k in c) out[k] = { e: c[k].e, esc: Object.entries(c[k].esc).map(([n, e]) => ({ n, e })) };
  return Object.keys(out).length ? out : null;
}
export const recalcularResumenPadron = leerResumenPadron;

export function padronCantidad() {
  return Object.values(db.padron).reduce((a, b) => a + Object.keys(b).length, 0);
}

// ---------- Personas ----------
function visiblePersona(p) { return me.rol === 'cabeza' || p.path.includes(me.uid); }

export function watchPersonas(cb) {
  const f = () => cb(Object.values(db.personas).filter(visiblePersona));
  subs.add(f); f();
  return () => subs.delete(f);
}

export async function consultarPersona(dni) {
  await espera(80);
  const p = db.personas[dni];
  if (!p) return { estado: 'libre' };
  if (visiblePersona(p)) return { estado: 'propia', persona: p };
  return { estado: 'ocupada' };
}

export async function cargarPersona(datos, dueno = me) {
  await espera();
  const c = await consultarPersona(datos.dni);
  if (c.estado === 'propia') return { yaEnEquipo: true, persona: c.persona };
  if (c.estado === 'ocupada') {
    const id = registrarConflicto(datos.dni);
    return { conflicto: true, id };
  }
  if (me.rol !== 'cabeza' && !dueno.path.includes(me.uid)) throw err('permission-denied', 'Solo podés asignar a gente de tu equipo');
  db.personas[datos.dni] = {
    estado: 'sin', tipo: 'votante', tel: '', nota: '', revisar: false,
    ...datos, palabras: palabrasDe(datos.nombre),
    ownerId: dueno.uid, ownerNombre: dueno.nombre, path: dueno.path,
    voto: false, creadoAt: ahora(), creadoPor: me.uid
  };
  guardar();
  return { ok: true };
}

export async function actualizarPersona(dni, cambios) {
  const p = db.personas[dni];
  if (!p || !visiblePersona(p)) throw err('permission-denied', 'No podés editar esta persona');
  Object.assign(p, cambios, { actualizadoAt: ahora() });
  guardar();
  return { ok: true };
}

export async function transferirPersona(dni, usuario) {
  const p = db.personas[dni];
  if (!p) return;
  if (!(me.rol === 'cabeza' || (p.path.includes(me.uid) && usuario.path.includes(me.uid)))) throw err('permission-denied', 'No podés transferir a esa persona');
  Object.assign(p, { ownerId: usuario.uid, ownerNombre: usuario.nombre, path: usuario.path, actualizadoAt: ahora() });
  guardar();
}

export async function eliminarPersona(dni) {
  const p = db.personas[dni];
  if (p && visiblePersona(p)) { delete db.personas[dni]; guardar(); }
}

export async function borrarPersonas(dnis, onProgreso) {
  dnis.forEach((d) => delete db.personas[d]);
  guardar();
  onProgreso?.(dnis.length, dnis.length);
}
export async function borrarPadron(onProgreso) {
  db.padron = {};
  guardar();
  onProgreso?.(1, 1);
}

// ---------- Conflictos (intentos de cargar gente de otro) ----------
function registrarConflicto(dni) {
  const id = 'c' + Math.random().toString(36).slice(2, 9);
  db.conflictos[id] = { id, dni, byId: me.uid, byNombre: me.nombre, byPath: me.path, estado: 'intento', motivo: '', at: ahora() };
  guardar();
  return id;
}
export function watchConflictos(cb) {
  const f = () => cb(Object.values(db.conflictos).filter((c) => me.rol === 'cabeza' || c.byPath.includes(me.uid)));
  subs.add(f); f();
  return () => subs.delete(f);
}
export async function reclamar(id, motivo) {
  const c = db.conflictos[id];
  if (c && c.byId === me.uid) { c.estado = 'reclamo'; c.motivo = motivo; guardar(); }
}
export async function resolverConflicto(c, aceptar) {
  if (me.rol !== 'cabeza') throw err('permission-denied', 'Solo las cabezas resuelven conflictos');
  const x = db.conflictos[c.id];
  if (aceptar) {
    const u = db.usuarios[x.byId];
    const p = db.personas[x.dni];
    if (u && p) Object.assign(p, { ownerId: u.uid, ownerNombre: u.nombre, path: u.path, actualizadoAt: ahora() });
  }
  Object.assign(x, { estado: aceptar ? 'aceptado' : 'rechazado', resueltoPor: me.nombre });
  guardar();
}
export async function duenoDe(dni) {
  // Solo para cabezas: muestra a quién pertenece la persona en conflicto
  const p = db.personas[dni];
  return me.rol === 'cabeza' && p ? { nombre: p.nombre, ownerNombre: p.ownerNombre } : null;
}

// ---------- Consultas para campañas grandes ----------
function cumple(p, filtros) {
  return filtros.every(([c, o, v]) => {
    const x = c === 'palabras' ? (p.palabras || palabrasDe(p.nombre)) : p[c];
    if (o === '==') return x === v;
    if (o === 'array-contains') return Array.isArray(x) && x.includes(v);
    if (o === 'in') return v.includes(x);
    return true;
  });
}
const visibles = (filtros) => Object.values(db.personas).filter((p) => visiblePersona(p) && cumple(p, filtros || [])).sort((a, b) => a.dni.localeCompare(b.dni));
export async function contar(filtros) { await espera(60); return visibles(filtros).length; }
export function watchPersonasConsulta(filtros, lim, cb) {
  const f = () => cb(lim ? visibles(filtros).slice(0, lim) : visibles(filtros));
  subs.add(f); f();
  return () => subs.delete(f);
}
export async function listarPersonas(filtros = [], lim = 0) { await espera(60); const r = visibles(filtros); return lim ? r.slice(0, lim) : r; }

// ---------- Fiscalización ----------
export async function leerListas() { return { listas: db.campania.listas || [], categorias: db.campania.categorias || [] }; }
export async function guardarListas(listas, categorias) { Object.assign(db.campania, { listas, categorias }); if (me) Object.assign(me, { listas, categorias }); guardar(); }
export function watchFiscalias(cb) {
  const f = () => cb(Object.values(db.fiscalias || {}).filter((x) => me.rol === 'cabeza' || x.path.includes(me.uid)));
  subs.add(f); f();
  return () => subs.delete(f);
}
export async function crearFiscalia(fiscal, datos) {
  (db.fiscalias ||= {})[fiscal.uid] = { id: fiscal.uid, fiscalUid: fiscal.uid, nombre: fiscal.nombre, dni: fiscal.dni, tel: fiscal.tel || '', path: fiscal.path, presente: false, incidencias: [], mesa: '', escuela: '', ...datos };
  guardar();
}
export async function actualizarFiscalia(fid, cambios) {
  Object.assign((db.fiscalias ||= {})[fid] ||= { id: fid, incidencias: [] }, cambios, { actualizadoAt: ahora() });
  guardar();
  return { ok: true };
}
export async function agregarIncidencia(fid, texto) {
  const x = db.fiscalias[fid];
  x.incidencias = [...(x.incidencias || []), { texto, at: ahora() }];
  guardar();
}
// En la demo la foto se guarda solo mientras la página está abierta (no entra en el almacenamiento del navegador)
const actasMem = {};
export async function guardarActa(fid, img) { actasMem[fid] = img; return { ok: true }; }
export async function leerActa(fid) { return actasMem[fid] || null; }

// ---------- Datos de ejemplo ----------
function semilla() {
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const nombres = ['Lucía', 'Carla', 'Ana', 'María', 'Sofía', 'Valeria', 'Romina', 'Graciela', 'Natalia', 'Paola', 'Jorge', 'Ramón', 'Pedro', 'Hugo', 'Diego', 'Marcos', 'Luis', 'Sergio', 'Oscar', 'Miguel', 'Julio', 'Gabriela', 'Silvana', 'Carlos', 'Nicolás'];
  const apellidos = ['Herrera', 'Medina', 'Acosta', 'Villalba', 'Ruiz', 'Sosa', 'Farías', 'Ledesma', 'Paz', 'Gómez', 'Olmos', 'Navarro', 'Juárez', 'Toledo', 'Correa', 'Romano', 'Alvarado', 'Díaz', 'Castillo', 'Guzmán', 'Moreno', 'Luna', 'Ibáñez', 'Vega', 'Quiroga'];
  const calles = ['Av. Sabattini', 'Pje. Chubut', 'Av. Américo Vespucio', 'Libertad', 'Pje. Magallanes', 'Eudoro Aráoz', 'Pje. Japón', 'Av. Roca', 'Lamadrid', 'Bolívar'];
  const escuelas = [
    { circuito: '19', escuela: 'Esc. Manuel Belgrano', dirEscuela: 'Av. Sabattini 2400', mesas: ['1043', '1044', '1045'] },
    { circuito: '19', escuela: 'Esc. D. F. Sarmiento', dirEscuela: 'Pje. Chubut 1700', mesas: ['1051', '1052'] },
    { circuito: '19', escuela: 'Esc. B. Rivadavia', dirEscuela: 'Libertad 1900', mesas: ['1060', '1061'] },
    { circuito: '20', escuela: 'Esc. Juan B. Alberdi', dirEscuela: 'Av. Roca 3100', mesas: ['1102', '1103', '1104'] },
    { circuito: '20', escuela: 'Esc. Gral. San Martín', dirEscuela: 'Lamadrid 2800', mesas: ['1110', '1111'] }
  ];
  const padron = {};
  const lista = [];
  const usados = new Set();
  const agregar = (r) => { (padron[bucketDe(r.dni)] ||= {})[r.dni] = padronAString(r); lista.push(r); usados.add(r.dni); };
  agregar({ dni: '38512004', nombre: 'HERRERA, Lucía Belén', domicilio: 'Av. Sabattini 2511', circuito: '19', escuela: 'Esc. Manuel Belgrano', dirEscuela: 'Av. Sabattini 2400', mesa: '1043', orden: '187' });
  agregar({ dni: '22731880', nombre: 'ACOSTA, Ramón Alberto', domicilio: 'Pje. Chubut 1853', circuito: '19', escuela: 'Esc. D. F. Sarmiento', dirEscuela: 'Pje. Chubut 1700', mesa: '1051', orden: '96' });
  agregar({ dni: '41009312', nombre: 'MEDINA, Carla Soledad', domicilio: 'Libertad 2027', circuito: '19', escuela: 'Esc. Manuel Belgrano', dirEscuela: 'Av. Sabattini 2400', mesa: '1044', orden: '52' });
  for (const e of escuelas) {
    for (const mesa of e.mesas) {
      for (let o = 1; o <= 40; o++) {
        let dni;
        do { dni = String(Math.floor(18000000 + rnd() * 30000000)); } while (usados.has(dni));
        agregar({ dni, nombre: `${pick(apellidos).toUpperCase()}, ${pick(nombres)}`, domicilio: `${pick(calles)} ${Math.floor(1000 + rnd() * 2000)}`, circuito: e.circuito, escuela: e.escuela, dirEscuela: e.dirEscuela, mesa, orden: String(o * 7) });
      }
    }
  }

  const usuarios = {};
  const claves = {};
  const U = (uid, nombre, dni, rol, parent, circuito, tel) => {
    const path = parent ? [...usuarios[parent].path, uid] : [uid];
    usuarios[uid] = { uid, nombre, dni, rol, parentId: parent || null, path, circuito: circuito || (parent ? usuarios[parent].circuito : ''), tel, creado: 0 };
    claves[uid] = '1234';
  };
  U('cab1', 'Ricardo Benítez', '20111222', 'cabeza', null, '', '3815000001');
  U('cab2', 'Silvia Ortiz', '21333444', 'cabeza', null, '', '3815000002');
  U('enc1', 'Laura Molina', '27555111', 'encargado', 'cab1', '19', '3815000003');
  U('enc2', 'Héctor Juárez', '25666222', 'encargado', 'cab2', '20', '3815000004');
  U('dir1', 'Daniel Torres', '30111333', 'dirigente', 'enc1', null, '3815000005');
  U('dir2', 'Patricia Ruiz', '31222444', 'dirigente', 'enc1', null, '3815000006');
  U('dir3', 'Claudio Paz', '29333555', 'dirigente', 'enc2', null, '3815000007');
  U('mov1', 'Marcos Ríos', '35111222', 'movilizador', 'dir1', null, '3815000008');
  U('mov2', 'Valeria Gómez', '36222333', 'movilizador', 'dir1', null, '3815000009');
  U('mov3', 'Diego Olmos', '34333444', 'movilizador', 'dir2', null, '3815000010');
  U('mov4', 'Sofía Navarro', '37444555', 'movilizador', 'dir3', null, '3815000011');
  U('mov5', 'Jorge Villalba', '33555666', 'movilizador', 'dir3', null, '3815000012');

  const personas = {};
  const asignar = (r, uid, extra = {}) => {
    const u = usuarios[uid];
    personas[r.dni] = {
      ...r, tel: '381' + Math.floor(4000000 + rnd() * 5999999), estado: 'sin', tipo: 'votante', nota: '', revisar: false,
      enPadron: true, ownerId: uid, ownerNombre: u.nombre, path: u.path, voto: false, creadoAt: 0, creadoPor: uid, ...extra
    };
  };
  asignar(lista[1], 'mov2', { estado: 'traslado' }); // Ramón Acosta: el ejemplo de DNI ya cargado por otro
  const estados = ['confirmado', 'confirmado', 'confirmado', 'traslado', 'dudoso', 'sin'];
  const porCircuito = { '19': ['mov1', 'mov1', 'mov2', 'mov3', 'mov3'], '20': ['mov4', 'mov5', 'mov5'] };
  for (const r of lista.slice(3)) {
    if (rnd() > 0.2) continue;
    const uid = pick(porCircuito[r.circuito]);
    asignar(r, uid, { estado: pick(estados), voto: rnd() < 0.3 });
  }
  // Fiscal de ejemplo (entra con DNI 40431477, clave 1234) y otros con resultados ya cargados
  const listas = ['Lista 501 · Frente Demo', 'Lista 502 · Otra fuerza', 'Lista 503 · Tercera vía'].map((n) => ({ id: idLista(n), nombre: n }));
  U('fis1', 'Nadia Yasmín', '40431477', 'fiscal', 'mov1', null, '3815000013');
  const fiscalias = {};
  const F = (uid, nombre, dni, padre, extra) => {
    const path = padre ? [...usuarios[padre].path, uid] : [uid];
    fiscalias[uid] = { id: uid, fiscalUid: uid, nombre, dni, tel: '', path, presente: false, incidencias: [], mesa: '', escuela: '', ...extra };
  };
  F('fis1', 'Nadia Yasmín', '40431477', 'mov1', { votaEscuela: 'Esc. Manuel Belgrano', votaMesa: '1043', circuito: '19' });
  const categorias = ['Gobernador', 'Legisladores', 'Concejales'].map((n) => ({ id: idLista('cat ' + n), nombre: n }));
  const votos = (a, b, c) => ({ [listas[0].id]: a, [listas[1].id]: b, [listas[2].id]: c });
  // Un acta con las tres categorías (los números de cada una varían un poco)
  const acta3 = (a, b, c, bl, nu, re, total) => ({ cats: Object.fromEntries(categorias.map((k, i) => {
    const d = [[0, 0, 0], [-6, 5, 1], [-10, 7, 3]][i];
    return [k.id, { votos: votos(a + d[0], b + d[1], c + d[2]), blancos: bl + i, nulos: nu, recurridos: re, impugnados: 0, total: total + i, sumaOk: true }];
  })) });
  F('fx1', 'Mónica Romano', '43500197', 'mov2', { mesa: '1044', escuela: 'Esc. Manuel Belgrano', circuito: '19', presente: true, presenteAt: Date.now() - 9 * 36e5, acta: acta3(112, 74, 21, 6, 3, 0, 216), actaAt: Date.now() - 20 * 6e4, tieneFoto: false });
  F('fx2', 'Vanesa Gutiérrez', '28966863', 'mov3', { mesa: '1051', escuela: 'Esc. D. F. Sarmiento', circuito: '19', presente: true, presenteAt: Date.now() - 9 * 36e5, incidencias: [{ texto: 'Faltan boletas de nuestra lista', at: Date.now() - 5 * 36e5 }] });
  F('fx3', 'Oscar Díaz', '17696513', 'mov4', { mesa: '1102', escuela: 'Esc. Juan B. Alberdi', circuito: '20', presente: true, presenteAt: Date.now() - 9 * 36e5, acta: acta3(98, 101, 15, 4, 2, 1, 221), actaAt: Date.now() - 20 * 6e4, tieneFoto: false });
  F('fx4', 'Silvia Alvarado', '32110664', 'mov5', { mesa: '1110', escuela: 'Esc. Gral. San Martín', circuito: '20', presente: false });
  return {
    campania: { nombre: 'Frente Demo 2027', listas, categorias },
    usuarios, claves, padron, personas, conflictos: {}, fiscalias
  };
}
