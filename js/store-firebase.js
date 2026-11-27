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
  writeBatch, serverTimestamp, getCountFromServer, getDocs, arrayUnion, limit, deleteField, Timestamp, orderBy
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

// Alguien que ya tenía cuenta (de otra campaña) y lo sumaron a una nueva: al entrar, acepta la invitación
async function aceptarInvitacion(uid, dni) {
  let inv;
  try { inv = await getDoc(doc(db, 'invitaciones', dni)); } catch { return false; }
  if (!inv.exists()) return false;
  const v = inv.data();
  cid = v.cid;
  await setDoc(D('usuarios', uid), {
    uid, dni, nombre: v.nombre || '', tel: v.tel || '', rol: v.rol, domicilio: v.domicilio || '', circuito: v.circuito || '',
    parentId: v.parentId || null, path: [...(v.path || []), uid], creado: serverTimestamp()
  });
  await setDoc(doc(db, 'cuentas', uid), { cid });
  await deleteDoc(doc(db, 'invitaciones', dni)).catch(() => {});
  return true;
}

// ---------- Dueño de la app: ve todas las campañas, solo para mirar ----------
let dueno = null;
async function esDueno(uid) { try { return (await getDoc(doc(db, 'duenos', uid))).exists(); } catch { return false; } }
export async function listarCampanias() {
  const s = await getDocs(collection(db, 'campanias'));
  const cnt = async (id, n) => { try { return (await getCountFromServer(collection(db, 'campanias', id, n))).data().count; } catch { return null; } };
  return Promise.all(s.docs.map(async (d) => {
    const x = d.data();
    const [personas, usuarios] = await Promise.all([cnt(d.id, 'personas'), cnt(d.id, 'usuarios')]);
    return { cid: d.id, nombre: x.nombre || '(sin nombre)', creado: x.creado?.toMillis?.() || 0, modulos: x.modulos || {}, personas, usuarios };
  }));
}
export async function verCampania(c) {
  cid = c;
  const x = (await getDoc(doc(db, 'campanias', cid))).data() || {};
  me = { uid: dueno.uid, dni: dueno.dni, nombre: 'Dueño de la app', rol: 'cabeza', parentId: null, path: [dueno.uid], circuito: '', soloLectura: true, duenio: true,
    campania: x.nombre || '', listas: x.listas || [], categorias: x.categorias || [], alertas: x.alertas || null, videoVoto: !!x.videoVoto, modulos: x.modulos || {},
    tiposGestion: x.tiposGestion || null, espacios: x.espacios || [], disputas: !!x.disputas };
  return me;
}
export function volverAlPanel() { cid = null; me = dueno; return me; }
export function guardarModulos(c, modulos) { return updateDoc(doc(db, 'campanias', c), { modulos }); }

async function cargarMe(uid) {
  const dni = String(auth.currentUser?.email || '').split('@')[0];
  if (await esDueno(uid)) { dueno = { uid, dni, nombre: 'Dueño de la app', rol: 'dueno', duenio: true }; cid = null; me = dueno; return me; }
  const cuenta = await getDoc(doc(db, 'cuentas', uid));
  let activo = false;
  if (cuenta.exists()) {
    cid = cuenta.data().cid;
    activo = (await getDoc(D('usuarios', uid))).exists();
  }
  if (activo) {
    // si quedó una invitación vieja a esta misma campaña, se descarta
    try { const inv = await getDoc(doc(db, 'invitaciones', dni)); if (inv.exists() && inv.data().cid === cid) await deleteDoc(inv.ref); } catch { /* sin invitación */ }
  } else if (dni) activo = await aceptarInvitacion(uid, dni);
  if (!activo && !cuenta.exists()) throw Object.assign(new Error('Este usuario no pertenece a ninguna campaña'), { code: 'sin-campania' });
  if (!activo) throw Object.assign(new Error('Tu usuario fue dado de baja de la campaña. Pedile a quien te suma que te vuelva a agregar.'), { code: 'sin-campania' });
  const u = await getDoc(D('usuarios', uid));
  const camp = await getDoc(doc(db, 'campanias', cid));
  me = { ...u.data(), uid, campania: camp.data()?.nombre || '', listas: camp.data()?.listas || [], categorias: camp.data()?.categorias || [], alertas: camp.data()?.alertas || null, videoVoto: !!camp.data()?.videoVoto, modulos: camp.data()?.modulos || {}, tiposGestion: camp.data()?.tiposGestion || null, espacios: camp.data()?.espacios || [], disputas: !!camp.data()?.disputas };
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
  me = null; cid = null; dueno = null;
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
    if (!baja.exists()) {
      // Ya tiene cuenta de otra campaña: queda invitado y se suma solo cuando entra
      const esCab = rol === 'cabeza';
      await setDoc(doc(db, 'invitaciones', dni), {
        dni, cid, nombre, tel: tel || '', rol, domicilio: domicilio || '',
        circuito: circuito || sup.circuito || '',
        parentId: esCab ? null : sup.uid, path: esCab ? [] : sup.path,
        por: me.uid, at: serverTimestamp()
      });
      return { invitado: true };
    }
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

// ----- ubicación (GPS) del día de la elección: un documento por persona, con su última posición
export async function guardarUbicacion({ lat, lng, prec }) {
  return sinTrabar(setDoc(D('ubicaciones', me.uid), {
    uid: me.uid, nombre: me.nombre, rol: me.rol, path: me.path,
    lat, lng, prec: Math.round(prec || 0), at: Date.now(), activo: true
  }));
}
export async function dejarUbicacion() {
  return sinTrabar(setDoc(D('ubicaciones', me.uid), { activo: false, at: Date.now() }, { merge: true }));
}
export function watchUbicaciones(cb) {
  return onSnapshot(deMiEquipo('ubicaciones'), (s) => cb(s.docs.map((d) => d.data())), (e) => console.error(e));
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

export async function importarPadron(registros, onProgreso, { reemplazar = false, onBorrado } = {}) {
  if (reemplazar) await borrarPadron(onBorrado);
  const grupos = {};
  for (const r of registros) (grupos[bucketDe(r.dni)] ||= {})[r.dni] = padronAString(r);
  const claves = Object.keys(grupos);
  // Firestore rechaza envíos muy grandes ("Transaction too big"): se manda de a pocos documentos
  // (cada DNI del padrón también genera entradas de índice, que cuentan para ese límite)
  const MAX_BYTES = 400_000; const MAX_DOCS = 5;
  let hechos = 0; let i = 0;
  while (i < claves.length) {
    const ops = [];
    let bytes = 0; let docs = 0; let personas = 0;
    while (i < claves.length && docs < MAX_DOCS) {
      const k = claves[i];
      const tam = JSON.stringify(grupos[k]).length * 2;
      if (docs > 0 && bytes + tam > MAX_BYTES) break;
      ops.push((b) => b.set(D('padron', k), { v: grupos[k] }, { merge: true }));
      bytes += tam; docs++; personas += Object.keys(grupos[k]).length; i++;
    }
    await enviarTanda(ops);
    hechos += personas;
    onProgreso?.(hechos, registros.length);
  }
  await setDoc(D('padron', 'resumen'), { circuitos: resumirPadron(registros) }, reemplazar ? {} : { merge: true });
  baldes.clear();
}
// Después de subir un padrón nuevo: la gente ya cargada toma la escuela, mesa y orden nuevos.
// Si el padrón reemplazó al anterior (es el completo), marca a quienes ya no figuran.
const CAMPOS_PADRON = ['circuito', 'escuela', 'dirEscuela', 'mesa', 'orden'];
export async function actualizarPersonasPadron(registros, { completo = false } = {}, onProgreso) {
  if (me.rol !== 'cabeza') return null;
  const idx = new Map(registros.map((r) => [r.dni, r]));
  const snap = await getDocs(C('personas'));
  const cambios = []; let cambioMesa = 0; let fuera = 0;
  for (const d of snap.docs) {
    const p = d.data(); const r = idx.get(p.dni || d.id);
    if (!r) {
      if (completo) { fuera++; if (!p.fueraPadron) cambios.push([d.ref, { fueraPadron: true, actualizadoAt: serverTimestamp() }]); }
      continue;
    }
    const c = {};
    for (const k of CAMPOS_PADRON) if (r[k] && String(p[k] ?? '') !== String(r[k])) c[k] = r[k];
    if ('mesa' in c || 'escuela' in c) cambioMesa++;
    if (p.fueraPadron) c.fueraPadron = deleteField();
    if (Object.keys(c).length) cambios.push([d.ref, { ...c, actualizadoAt: serverTimestamp() }]);
  }
  for (let i = 0; i < cambios.length; i += 400) {
    const b = writeBatch(db);
    cambios.slice(i, i + 400).forEach(([ref, c]) => b.update(ref, c));
    await b.commit();
    onProgreso?.(Math.min(i + 400, cambios.length), cambios.length);
  }
  return { total: snap.size, actualizadas: cambios.length, cambioMesa, fuera };
}

// Resumen del padrón: electores por circuito y por escuela (para el tablero)
function resumirPadron(registros) {
  const c = {};
  for (const r of registros) {
    const x = (c[r.circuito || '–'] ||= { e: 0, esc: {} });
    x.e++;
    const n = r.escuela || 'Sin escuela';
    const y = (x.esc[n] ||= { e: 0, m: {} });
    y.e++;
    if (r.mesa) y.m[r.mesa] = (y.m[r.mesa] || 0) + 1;
  }
  const out = {};
  for (const k in c) out[k] = { e: c[k].e, esc: Object.entries(c[k].esc).map(([n, y]) => ({ n, e: y.e, m: y.m })) };
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
  if (me.rol === 'cabeza') return onSnapshot(C('personas'), (s) => cb(s.docs.map((d) => d.data())), (e) => console.error(e));
  // Las de mi equipo + las que mi equipo tiene "en disputa" con otro (una sola vez cada una)
  let propias = []; let disputadas = [];
  const emitir = () => { const m = new Map(); for (const p of [...disputadas, ...propias]) m.set(p.dni, p); cb([...m.values()]); };
  const a = onSnapshot(deMiEquipo('personas'), (s) => { propias = s.docs.map((d) => d.data()); emitir(); }, (e) => console.error(e));
  const b = onSnapshot(query(C('personas'), where('pathsDisputa', 'array-contains', me.uid)), (s) => { disputadas = s.docs.map((d) => d.data()); emitir(); }, (e) => console.error(e));
  return () => { a(); b(); };
}
// ---------- Personas en disputa ----------
const esMia = (p) => me.rol === 'cabeza' || (p.path || []).includes(me.uid);
// Me sumo como otro dirigente que también la tiene (sin poder ver ni tocar lo del dueño)
export function disputarPersona(dni) {
  return sinTrabar(updateDoc(D('personas', dni), {
    ['disputa.' + me.uid]: { nombre: me.nombre, path: me.path, at: Date.now() },
    pathsDisputa: arrayUnion(...me.path), enDisputa: true, actualizadoAt: serverTimestamp()
  }));
}
// Campos extra al marcar "Ya votó": la disputa se cierra a favor de quien la marca
export function cierreVoto(p) {
  if (!p?.disputa) return {};
  const fin = { disputa: deleteField(), pathsDisputa: deleteField(), enDisputa: deleteField() };
  if (esMia(p)) return fin;
  const [uid, d] = Object.entries(p.disputa).find(([, x]) => (x.path || []).includes(me.uid)) || [];
  if (!uid) return fin;
  return { ...fin, ownerId: uid, ownerNombre: d.nombre, path: d.path };
}
// Una cabeza decide con quién queda
export function dejarCon(dni, u) {
  return sinTrabar(updateDoc(D('personas', dni), { ownerId: u.uid, ownerNombre: u.nombre, path: u.path, disputa: deleteField(), pathsDisputa: deleteField(), enDisputa: deleteField(), actualizadoAt: serverTimestamp() }));
}
export function guardarDisputas(v) {
  me.disputas = !!v;
  return sinTrabar(updateDoc(doc(db, 'campanias', cid), { disputas: !!v }));
}

export async function consultarPersona(dni) {
  try {
    const s = await getDoc(D('personas', dni));
    if (!s.exists()) return { estado: 'libre' };
    if (!esMia(s.data())) return { estado: 'disputa', persona: s.data() };
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
  if (c.estado === 'disputa') return { yaEnDisputa: true, persona: c.persona };
  if (c.estado === 'ocupada' && me.disputas) return { ocupada: true };
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
    if (e.code === 'permission-denied') return me.disputas ? { ocupada: true } : { conflicto: true, id: await registrarConflicto(datos.dni) };
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
// Manda varias operaciones juntas; si Firestore dice que es demasiado grande, las manda de a una.
const muyGrande = (e) => /too big|too large|exceeds|maximum/i.test(e?.message || '') || e?.code === 'invalid-argument' || e?.code === 'resource-exhausted';
async function enviarTanda(ops) {
  const b = writeBatch(db);
  ops.forEach((op) => op(b));
  try { await b.commit(); } catch (e) {
    if (!muyGrande(e) || ops.length === 1) throw e;
    for (const op of ops) { const u = writeBatch(db); op(u); await u.commit(); }
  }
}
// tam: cuántos documentos por envío. Los del padrón son grandes (miles de DNI con su índice),
// así que se borran de a pocos: si no, Firestore responde "Transaction too big".
async function borrarEnTandas(refs, onProgreso, tam = 400) {
  let hechos = 0;
  for (let i = 0; i < refs.length; i += tam) {
    await enviarTanda(refs.slice(i, i + tam).map((r) => (b) => b.delete(r)));
    hechos += refs.slice(i, i + tam).length;
    onProgreso?.(hechos, refs.length);
  }
}
export function borrarPersonas(dnis, onProgreso) {
  return borrarEnTandas(dnis.map((d) => D('personas', d)), onProgreso);
}
export async function borrarPadron(onProgreso) {
  const refs = [...Array.from({ length: 1000 }, (_, i) => D('padron', String(i).padStart(3, '0'))), D('padron', 'resumen')];
  await borrarEnTandas(refs, onProgreso, 4);
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
// ----- video de constancia de voto (Firebase Storage, plan Blaze)
let modStorage = null;
async function almacen() {
  modStorage ||= await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js');
  return { m: modStorage, s: modStorage.getStorage(app) };
}
export async function subirVideoVoto(dni, archivo, onProgreso, persona) {
  const { m, s } = await almacen();
  const ext = ((archivo.name || '').split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'mp4';
  const path = `campanias/${cid}/videos/${dni}/voto.${ext}`;
  const tarea = m.uploadBytesResumable(m.ref(s, path), archivo, { contentType: archivo.type || 'video/mp4' });
  await new Promise((res, rej) => tarea.on('state_changed', (x) => onProgreso?.(x.bytesTransferred, x.totalBytes), rej, res));
  const ahora = Date.now();
  await updateDoc(D('personas', dni), { video: { path, tam: archivo.size, at: ahora, por: me.uid }, conVideo: true, voto: true, votoAt: ahora, ...cierreVoto(persona), actualizadoAt: serverTimestamp() });
}
export async function urlVideoVoto(p) {
  const { m, s } = await almacen();
  return m.getDownloadURL(m.ref(s, p.video.path));
}
export async function borrarVideoVoto(p) {
  const { m, s } = await almacen();
  try { await m.deleteObject(m.ref(s, p.video.path)); } catch (e) { if (e.code !== 'storage/object-not-found') throw e; }
  await updateDoc(D('personas', p.dni), { video: deleteField(), conVideo: false, actualizadoAt: serverTimestamp() });
}
// Link personal para que el votante suba su video sin tener usuario (vence a los 3 días)
const tokenNuevo = () => Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 56]).join('');
export async function crearLinkVideo(p) {
  const t = tokenNuevo();
  await setDoc(D('tokensVideo', t), {
    dni: p.dni, nombre: String(p.nombre || ''), path: p.path, creadoPor: me.uid,
    expira: Timestamp.fromMillis(Date.now() + 3 * 864e5), creado: serverTimestamp()
  });
  return { cid, token: t };
}
export async function leerLinkVideo(c, t) {
  const s = await getDoc(doc(db, 'campanias', c, 'tokensVideo', t));
  if (!s.exists()) return null;
  const d = s.data();
  return { dni: d.dni, nombre: d.nombre, vence: d.expira.toMillis() };
}
export async function subirVideoConLink(c, t, dni, archivo, onProgreso) {
  const { m, s } = await almacen();
  const path = `campanias/${c}/videos/${dni}/t_${t}`;
  const tarea = m.uploadBytesResumable(m.ref(s, path), archivo, { contentType: archivo.type || 'video/mp4' });
  await new Promise((res, rej) => tarea.on('state_changed', (x) => onProgreso?.(x.bytesTransferred, x.totalBytes), rej, res));
  const ahora = Date.now();
  await updateDoc(doc(db, 'campanias', c, 'personas', dni), { video: { path, tam: archivo.size, at: ahora, token: t, por: 'votante' }, conVideo: true, voto: true, votoAt: ahora });
}
export function guardarVideoObligatorio(v) {
  return sinTrabar(updateDoc(doc(db, 'campanias', cid), { videoVoto: !!v }));
}
// ----- registro de gestiones (qué se le dio a quién, cuándo y a través de qué dirigente)
export function watchGestiones(filtro, cb, alError) {
  const ws = [where(filtro.campo, '==', filtro.valor)];
  const err = (e) => { console.error(e); alError?.(e); };
  if (me.rol === 'cabeza') return onSnapshot(query(C('gestiones'), ...ws), (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), err);
  // las de mi espacio + las que pasaron por mis manos (o las de mi equipo) en su recorrido
  let a = []; let b = [];
  const emitir = () => { const m = new Map(); for (const x of [...b, ...a]) m.set(x.id, x); cb([...m.values()]); };
  const u1 = onSnapshot(query(C('gestiones'), where('path', 'array-contains', me.uid), ...ws), (s) => { a = s.docs.map((d) => ({ id: d.id, ...d.data() })); emitir(); }, err);
  const u2 = onSnapshot(query(C('gestiones'), where('pathsRecorrido', 'array-contains', me.uid), ...ws), (s) => { b = s.docs.map((d) => ({ id: d.id, ...d.data() })); emitir(); }, err);
  return () => { u1(); u2(); };
}
// Gestiones que tengo en mano para entregar (de cualquier fecha)
// Centro de comando: los últimos que marcaron "Ya votó" (solo cabeza)
export async function ultimosVotos(n = 15) {
  const s = await getDocs(query(C('personas'), orderBy('votoAt', 'desc'), limit(n)));
  return s.docs.map((d) => d.data()).filter((p) => p.voto && p.votoAt);
}
export function watchGestionesEnMano(cb) {
  // (pathsRecorrido incluye al que la tiene: así las reglas pueden comprobar que puede verla)
  return onSnapshot(query(C('gestiones'), where('pathsRecorrido', 'array-contains', me.uid), where('tieneId', '==', me.uid), where('estado', '==', 'en_camino')),
    (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), (e) => { console.error(e); cb([]); });
}
// ----- Recorrido de una gestión: de dónde salió, por qué manos pasó y cuándo llegó al vecino
const quien = (u) => ({ uid: u.uid, nombre: u.nombre });
// Si la tenía yo y no había confirmado que la recibí, al pasarla o entregarla queda confirmado
const conMiRecibo = (g) => (g.recorrido || []).map((p, i, xs) => (i === xs.length - 1 && p.tipo !== 'entrega' && p.a?.uid === me.uid && !p.recibido ? { ...p, recibido: true, recibidoAt: Date.now() } : p));
export function pasarGestion(g, u, nota = '') {
  const paso = { tipo: 'pase', at: Date.now(), de: quien(me), a: quien(u), nota: String(nota).slice(0, 200), recibido: u.uid === me.uid };
  return sinTrabar(updateDoc(D('gestiones', g.id), { recorrido: [...conMiRecibo(g), paso], tieneId: u.uid, tieneNombre: u.nombre, pathsRecorrido: arrayUnion(...u.path), actualizadoAt: serverTimestamp() }));
}
export function confirmarRecibido(g) {
  const rec = (g.recorrido || []).map((p, i, xs) => (i === xs.length - 1 && p.tipo !== 'entrega' && p.a?.uid === me.uid ? { ...p, recibido: true, recibidoAt: Date.now() } : p));
  return sinTrabar(updateDoc(D('gestiones', g.id), { recorrido: rec, actualizadoAt: serverTimestamp() }));
}
export function entregarGestion(g, { fecha, recibio = '', nota = '' }) {
  const paso = { tipo: 'entrega', at: Date.now(), fecha, por: quien(me), recibio: String(recibio).slice(0, 120), nota: String(nota).slice(0, 200) };
  return sinTrabar(updateDoc(D('gestiones', g.id), { recorrido: [...conMiRecibo(g), paso], estado: 'entregada', fechaEntrega: fecha, tieneId: deleteField(), tieneNombre: deleteField(), actualizadoAt: serverTimestamp() }));
}
export async function gestionesDePersona(dni) {
  const ws = [where('dni', '==', dni)];
  if (me.rol !== 'cabeza') ws.unshift(where('path', 'array-contains', me.uid));
  const s = await getDocs(query(C('gestiones'), ...ws));
  return s.docs.map((d) => ({ id: d.id, ...d.data() }));
}
export async function guardarGestion(g) {
  const { id, ...datos } = g;
  if (id) { delete datos.tiene; delete datos.estado; await sinTrabar(updateDoc(D('gestiones', id), { ...datos, editadoAt: serverTimestamp() })); return id; }
  const ref = doc(C('gestiones'));
  const extra = {};
  if (datos.estado === 'en_camino' && datos.tiene) {
    // queda en manos de alguien: arranca el recorrido
    const t = datos.tiene; delete datos.tiene;
    Object.assign(extra, { tieneId: t.uid, tieneNombre: t.nombre, pathsRecorrido: t.path,
      recorrido: [{ tipo: 'origen', at: Date.now(), fecha: datos.fecha, por: quien(me), origen: datos.origen || '', a: quien(t), recibido: t.uid === me.uid }] });
  } else if (!id) {
    delete datos.tiene;
    Object.assign(extra, { estado: 'entregada', fechaEntrega: datos.fecha, recorrido: [
      ...(datos.origen ? [{ tipo: 'origen', at: Date.now(), fecha: datos.fecha, por: quien(me), origen: datos.origen, a: quien(me), recibido: true }] : []),
      { tipo: 'entrega', at: Date.now(), fecha: datos.fecha, por: quien(me), recibio: '' }] });
  }
  await sinTrabar(setDoc(ref, { ...datos, ...extra, cargadoPor: me.uid, cargadoNombre: me.nombre, at: Date.now(), creado: serverTimestamp() }));
  return ref.id;
}
export function borrarGestion(id) { return sinTrabar(deleteDoc(D('gestiones', id))); }
export function guardarTiposGestion(tipos, espacios) { return sinTrabar(updateDoc(doc(db, 'campanias', cid), { tiposGestion: tipos, espacios })); }

export function guardarAlertas(alertas) {
  return sinTrabar(updateDoc(doc(db, 'campanias', cid), { alertas }));
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
