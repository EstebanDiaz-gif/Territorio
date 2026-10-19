// Datos reales en Firebase (Auth + Firestore). Misma interfaz que store-demo.js.
import { FIREBASE_CONFIG, EMAIL_DOMAIN, URL_CLAVES } from './config.js';
import { bucketDe, padronAString, padronDeString, palabrasDe } from './roles.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged,
  EmailAuthProvider, reauthenticateWithCredential, updatePassword
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, getFirestore,
  doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, query, where, onSnapshot,
  writeBatch, serverTimestamp, getCountFromServer, getDocs, arrayUnion, limit
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

export const modo = 'firebase';

const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
// Caché local: la app sigue funcionando sin señal y sincroniza cuando vuelve
const db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });

let me = null;
let cid = null;
const email = (dni) => `${dni}@${EMAIL_DOMAIN}`;
const D = (...p) => doc(db, 'campanias', cid, ...p);
const C = (nombre) => collection(db, 'campanias', cid, nombre);

// Las escrituras quedan en cola si no hay señal; no esperamos al servidor más de unos segundos
const sinTrabar = (p, ms = 4000) => Promise.race([p.then(() => ({ ok: true })), new Promise((r) => setTimeout(() => r({ ok: true, pendiente: true }), ms))]);

async function cargarMe(uid) {
  const cuenta = await getDoc(doc(db, 'cuentas', uid));
  if (!cuenta.exists()) throw Object.assign(new Error('Este usuario no pertenece a ninguna campaña'), { code: 'sin-campania' });
  cid = cuenta.data().cid;
  const u = await getDoc(D('usuarios', uid));
  if (!u.exists()) throw Object.assign(new Error('Tu usuario fue dado de baja de la campaña'), { code: 'sin-campania' });
  const camp = await getDoc(doc(db, 'campanias', cid));
  me = { ...u.data(), uid, campania: camp.data()?.nombre || '', listas: camp.data()?.listas || [], categorias: camp.data()?.categorias || [] };
  return me;
}

export function init() {
  return new Promise((res) => {
    const off = onAuthStateChanged(auth, async (u) => {
      off();
      if (!u) return res(null);
      try { res(await cargarMe(u.uid)); } catch { res(null); }
    });
  });
}

export async function login(dni, pass) {
  const r = await signInWithEmailAndPassword(auth, email(dni), pass);
  return cargarMe(r.user.uid);
}

export async function logout() {
  await signOut(auth);
  me = null; cid = null;
}

export async function crearCampania({ campania, nombre, dni, pass, tel }) {
  const r = await createUserWithEmailAndPassword(auth, email(dni), pass);
  const uid = r.user.uid;
  cid = doc(collection(db, 'campanias')).id;
  await setDoc(doc(db, 'cuentas', uid), { cid });
  await setDoc(doc(db, 'campanias', cid), { nombre: campania, ownerUid: uid, creado: serverTimestamp() });
  await setDoc(D('usuarios', uid), { uid, dni, nombre, tel: tel || '', rol: 'cabeza', parentId: null, path: [uid], circuito: '', creado: serverTimestamp() });
  return cargarMe(uid);
}

// ---------- Usuarios ----------
// Para crear la cuenta de otra persona sin cerrar la sesión propia se usa una segunda instancia de Firebase
let secundaria = null;
export async function crearUsuario({ dni, nombre, tel, rol, pass, circuito, padre, domicilio }) {
  const sup = padre || me;
  secundaria ||= initializeApp(FIREBASE_CONFIG, 'secundaria');
  const sAuth = getAuth(secundaria);
  let uid;
  let reactivado = false;
  try {
    const r = await createUserWithEmailAndPassword(sAuth, email(dni), pass);
    uid = r.user.uid;
    await setDoc(doc(getFirestore(secundaria), 'cuentas', uid), { cid });
    await signOut(sAuth);
  } catch (e) {
    // Si lo habían quitado antes de esta campaña, se lo vuelve a sumar con su cuenta de siempre
    if (e.code !== 'auth/email-already-in-use') throw e;
    const baja = await getDoc(D('bajas', dni));
    if (!baja.exists()) throw e;
    uid = baja.data().uid;
    reactivado = true;
  }
  const esCabeza = rol === 'cabeza';
  await setDoc(D('usuarios', uid), {
    uid, dni, nombre, tel: tel || '', rol, domicilio: domicilio || '',
    parentId: esCabeza ? null : sup.uid,
    path: esCabeza ? [uid] : [...sup.path, uid],
    circuito: circuito || sup.circuito || '',
    creado: serverTimestamp()
  });
  if (reactivado) await deleteDoc(D('bajas', dni));
  return { uid, reactivado };
}

// Cambiar datos de alguien del equipo (por ahora, sus circuitos)
export async function actualizarUsuario(uid, cambios) {
  return sinTrabar(updateDoc(D('usuarios', uid), cambios));
}

// ----- contraseñas
export async function cambiarClave(actual, nueva) {
  const u = auth.currentUser;
  await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, actual));
  await updatePassword(u, nueva);
}
export const puedeBlanquear = !!URL_CLAVES;
// Un superior le genera una contraseña nueva a alguien de su equipo (lo hace la función del servidor)
export async function blanquearClave(uid) {
  const token = await auth.currentUser.getIdToken();
  let r;
  try {
    r = await fetch(URL_CLAVES, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ uid }) });
  } catch { throw Object.assign(new Error('No hay conexión. Probá de nuevo cuando tengas señal.'), { code: 'network' }); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.pass) throw Object.assign(new Error(j.error || 'No se pudo blanquear la contraseña.'), { code: 'blanqueo' });
  return j.pass;
}

// Quitar a alguien del equipo: su gente pasa a otro (o se borra) y pierde el acceso
export async function quitarUsuario(u, dnis, destino) {
  for (let i = 0; i < dnis.length; i += 400) {
    const b = writeBatch(db);
    for (const d of dnis.slice(i, i + 400)) {
      if (destino) b.update(D('personas', d), { ownerId: destino.uid, ownerNombre: destino.nombre, path: destino.path, actualizadoAt: serverTimestamp() });
      else b.delete(D('personas', d));
    }
    await b.commit();
  }
  await setDoc(D('bajas', u.dni), { uid: u.uid, nombre: u.nombre, at: serverTimestamp() });
  await deleteDoc(D('usuarios', u.uid));
}

const deMiEquipo = (nombre, campo = 'path') =>
  me.rol === 'cabeza' ? C(nombre) : query(C(nombre), where(campo, 'array-contains', me.uid));

export function watchUsuarios(cb) {
  return onSnapshot(deMiEquipo('usuarios'), (s) => cb(s.docs.map((d) => d.data())), (e) => console.error(e));
}

// ---------- Padrón ----------
// Se guarda en 1000 "baldes" según los últimos 3 dígitos del DNI: buscar un DNI = 1 lectura.
const baldes = new Map();
export async function buscarPadron(dni) {
  const k = bucketDe(dni);
  if (!baldes.has(k)) {
    const s = await getDoc(D('padron', k));
    baldes.set(k, s.exists() ? (s.data().v || {}) : {});
  }
  const v = baldes.get(k)[dni];
  return v ? padronDeString(dni, v) : null;
}

export async function importarPadron(registros, onProgreso) {
  const grupos = {};
  for (const r of registros) (grupos[bucketDe(r.dni)] ||= {})[r.dni] = padronAString(r);
  const claves = Object.keys(grupos);
  let hechos = 0;
  for (let i = 0; i < claves.length; i += 200) {
    const b = writeBatch(db);
    for (const k of claves.slice(i, i + 200)) b.set(D('padron', k), { v: grupos[k] }, { merge: true });
    await b.commit();
    hechos += claves.slice(i, i + 200).reduce((a, k) => a + Object.keys(grupos[k]).length, 0);
    onProgreso?.(hechos, registros.length);
  }
  await setDoc(D('padron', 'resumen'), { circuitos: resumirPadron(registros) }, { merge: true });
  baldes.clear();
}

// Resumen del padrón: electores por circuito y por escuela (para el tablero)
function resumirPadron(registros) {
  const c = {};
  for (const r of registros) {
    const x = (c[r.circuito || '–'] ||= { e: 0, esc: {} });
    x.e++;
    const n = r.escuela || 'Sin escuela';
    x.esc[n] = (x.esc[n] || 0) + 1;
  }
  const out = {};
  for (const k in c) out[k] = { e: c[k].e, esc: Object.entries(c[k].esc).map(([n, e]) => ({ n, e })) };
  return out;
}
export async function leerResumenPadron() {
  const s = await getDoc(D('padron', 'resumen'));
  return s.exists() ? (s.data().circuitos || null) : null;
}
// Para padrones subidos antes de que existiera el resumen (lee el padrón entero una vez)
export async function recalcularResumenPadron() {
  const snap = await getDocs(C('padron'));
  const regs = [];
  snap.forEach((d) => {
    if (d.id === 'resumen') return;
    const v = d.data().v || {};
    for (const dni in v) regs.push(padronDeString(dni, v[dni]));
  });
  const circuitos = resumirPadron(regs);
  await setDoc(D('padron', 'resumen'), { circuitos });
  return regs.length ? circuitos : null;
}

export function padronCantidad() { return null; }

// ---------- Personas ----------
export function watchPersonas(cb) {
  return onSnapshot(deMiEquipo('personas'), (s) => cb(s.docs.map((d) => d.data())), (e) => console.error(e));
}

export async function consultarPersona(dni) {
  try {
    const s = await getDoc(D('personas', dni));
    if (!s.exists()) return { estado: 'libre' };
    return { estado: 'propia', persona: s.data() };
  } catch (e) {
    if (e.code === 'permission-denied') return { estado: 'ocupada' };
    if (e.code === 'unavailable') return { estado: 'libre', sinSenal: true };
    throw e;
  }
}

export async function cargarPersona(datos, dueno = me) {
  const c = await consultarPersona(datos.dni);
  if (c.estado === 'propia') return { yaEnEquipo: true, persona: c.persona };
  if (c.estado === 'ocupada') return { conflicto: true, id: await registrarConflicto(datos.dni) };
  const p = {
    estado: 'sin', tipo: 'votante', tel: '', nota: '', revisar: false,
    ...datos, palabras: palabrasDe(datos.nombre),
    ownerId: dueno.uid, ownerNombre: dueno.nombre, path: dueno.path,
    voto: false, creadoAt: serverTimestamp(), creadoPor: me.uid
  };
  try {
    return await sinTrabar(setDoc(D('personas', datos.dni), p));
  } catch (e) {
    // Alguien lo cargó justo antes que nosotros
    if (e.code === 'permission-denied') return { conflicto: true, id: await registrarConflicto(datos.dni) };
    throw e;
  }
}

export function actualizarPersona(dni, cambios) {
  return sinTrabar(updateDoc(D('personas', dni), { ...cambios, actualizadoAt: serverTimestamp() }));
}

export function transferirPersona(dni, usuario) {
  return sinTrabar(updateDoc(D('personas', dni), { ownerId: usuario.uid, ownerNombre: usuario.nombre, path: usuario.path, actualizadoAt: serverTimestamp() }));
}

export function eliminarPersona(dni) {
  return sinTrabar(deleteDoc(D('personas', dni)));
}

// ---------- Conflictos ----------
async function registrarConflicto(dni) {
  const r = await addDoc(C('conflictos'), { dni, byId: me.uid, byNombre: me.nombre, byPath: me.path, estado: 'intento', motivo: '', at: serverTimestamp() });
  return r.id;
}
export function watchConflictos(cb) {
  return onSnapshot(deMiEquipo('conflictos', 'byPath'), (s) => cb(s.docs.map((d) => ({ ...d.data(), id: d.id }))), (e) => console.error(e));
}
export function reclamar(id, motivo) {
  return sinTrabar(updateDoc(D('conflictos', id), { estado: 'reclamo', motivo }));
}
export async function resolverConflicto(c, aceptar) {
  if (aceptar) {
    const u = (await getDoc(D('usuarios', c.byId))).data();
    const p = await getDoc(D('personas', c.dni));
    if (u && p.exists()) await updateDoc(D('personas', c.dni), { ownerId: u.uid, ownerNombre: u.nombre, path: u.path, actualizadoAt: serverTimestamp() });
  }
  // Si la persona ya no existe, igual se cierra el conflicto
  await updateDoc(D('conflictos', c.id), { estado: aceptar ? 'aceptado' : 'rechazado', resueltoPor: me.nombre });
}
export async function duenoDe(dni) {
  if (me.rol !== 'cabeza') return null;
  const s = await getDoc(D('personas', dni));
  return s.exists() ? { nombre: s.data().nombre, ownerNombre: s.data().ownerNombre } : null;
}

// ---------- Borrado masivo (solo cabezas) ----------
async function borrarEnTandas(refs, onProgreso) {
  let hechos = 0;
  for (let i = 0; i < refs.length; i += 400) {
    const b = writeBatch(db);
    refs.slice(i, i + 400).forEach((r) => b.delete(r));
    await b.commit();
    hechos += refs.slice(i, i + 400).length;
    onProgreso?.(hechos, refs.length);
  }
}
export function borrarPersonas(dnis, onProgreso) {
  return borrarEnTandas(dnis.map((d) => D('personas', d)), onProgreso);
}
export async function borrarPadron(onProgreso) {
  const refs = [...Array.from({ length: 1000 }, (_, i) => D('padron', String(i).padStart(3, '0'))), D('padron', 'resumen')];
  await borrarEnTandas(refs, onProgreso);
  baldes.clear();
}

export async function contarPersonas() {
  const r = await getCountFromServer(deMiEquipo('personas'));
  return r.data().count;
}

// ---------- Fiscalización ----------
// fiscalias/{uidFiscal}: mesa que fiscaliza, presente, incidencias y resultado del acta
// actas/{uidFiscal}: la foto del acta (comprimida), aparte para no cargarla salvo que se pida
export async function leerListas() {
  const c = await getDoc(doc(db, 'campanias', cid));
  return { listas: c.data()?.listas || [], categorias: c.data()?.categorias || [] };
}
export function guardarListas(listas, categorias) {
  return sinTrabar(updateDoc(doc(db, 'campanias', cid), { listas, categorias }));
}
export function watchFiscalias(cb) {
  if (me.rol === 'fiscal') return onSnapshot(D('fiscalias', me.uid), (s) => cb(s.exists() ? [{ ...s.data(), id: s.id }] : []), (e) => console.error(e));
  return onSnapshot(deMiEquipo('fiscalias'), (s) => cb(s.docs.map((d) => ({ ...d.data(), id: d.id }))), (e) => console.error(e));
}
export function crearFiscalia(fiscal, datos) {
  return sinTrabar(setDoc(D('fiscalias', fiscal.uid), {
    fiscalUid: fiscal.uid, nombre: fiscal.nombre, dni: fiscal.dni, tel: fiscal.tel || '', path: fiscal.path,
    presente: false, incidencias: [], mesa: '', escuela: '', ...datos, creado: serverTimestamp()
  }, { merge: true }));
}
export function actualizarFiscalia(fid, cambios) {
  return sinTrabar(setDoc(D('fiscalias', fid), { ...cambios, actualizadoAt: serverTimestamp() }, { merge: true }));
}
export function agregarIncidencia(fid, texto) {
  return sinTrabar(setDoc(D('fiscalias', fid), { incidencias: arrayUnion({ texto, at: Date.now() }), actualizadoAt: serverTimestamp() }, { merge: true }));
}
export function guardarActa(fid, img, path) {
  return sinTrabar(setDoc(D('actas', fid), { img, path, at: serverTimestamp() }), 15000);
}
export async function leerActa(fid) {
  const s = await getDoc(D('actas', fid));
  return s.exists() ? s.data().img : null;
}

// ---------- Consultas para campañas grandes (la cabeza no baja a toda la gente) ----------
// filtros: [[campo, operador, valor], ...] con operadores '==', 'array-contains', 'in'
function consulta(filtros = [], lim = 0) {
  const ws = filtros.map(([c, o, v]) => where(c, o, v));
  if (me.rol !== 'cabeza' && !filtros.some(([c, o]) => c === 'path' && o === 'array-contains')) ws.unshift(where('path', 'array-contains', me.uid));
  if (lim) ws.push(limit(lim));
  return query(C('personas'), ...ws);
}
export async function contar(filtros) {
  const r = await getCountFromServer(consulta(filtros));
  return r.data().count;
}
export function watchPersonasConsulta(filtros, lim, cb, alError) {
  return onSnapshot(consulta(filtros, lim), (s) => cb(s.docs.map((d) => d.data())), (e) => { console.error(e); alError?.(e); });
}
export async function listarPersonas(filtros = [], lim = 0) {
  const s = await getDocs(consulta(filtros, lim));
  return s.docs.map((d) => d.data());
}
