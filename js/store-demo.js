// MODO DEMO: misma interfaz que store-firebase.js, pero todo se guarda en este navegador.
// Sirve para mostrar y probar la app sin configurar nada. Los datos son inventados.
import { bucketDe, padronAString, padronDeString, nivel } from './roles.js';

export const modo = 'demo';
const KEY = 'territorio-demo-v3';
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
const conCampania = (u) => ({ ...u, campania: db.campania.nombre });

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

export async function crearUsuario({ dni, nombre, tel, rol, pass, circuito }) {
  await espera();
  if (Object.values(db.usuarios).some((u) => u.dni === dni)) throw err('auth/email-already-in-use', 'Ese DNI ya tiene usuario');
  const esCabeza = rol === 'cabeza';
  if (esCabeza ? me.rol !== 'cabeza' : nivel(rol) !== nivel(me.rol) + 1) throw err('permission-denied', 'No podés crear ese rol');
  const uid = 'u' + Math.random().toString(36).slice(2, 9);
  db.usuarios[uid] = {
    uid, dni, nombre, tel: tel || '', rol,
    parentId: esCabeza ? null : me.uid,
    path: esCabeza ? [uid] : [...me.path, uid],
    circuito: circuito || me.circuito || '',
    creado: ahora()
  };
  db.claves[uid] = pass;
  guardar();
  return uid;
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
    ...datos,
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
  return {
    campania: { nombre: 'Frente Demo 2027' },
    usuarios, claves, padron, personas, conflictos: {}
  };
}
