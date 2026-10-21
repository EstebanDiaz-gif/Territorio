// Crea una campaña de DEMOSTRACIÓN completa en Firebase (todo inventado).
// Se usa desde sembrar-demo.html. No toca la sesión de quien la abre: usa sus propias instancias de Firebase.
import { FIREBASE_CONFIG, EMAIL_DOMAIN } from './config.js';
import { bucketDe, padronAString, palabrasDe, idLista } from './roles.js';
import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, addDoc, collection, writeBatch, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

export const CLAVE = 'demo2027';
const email = (dni) => `${dni}@${EMAIL_DOMAIN}`;

// ---------- datos inventados ----------
// DNI de usuarios en la serie 99.xxx.xxx y de votantes en la 98.xxx.xxx: no corresponden a personas reales.
export const EQUIPO = [
  { k: 'cab', dni: '99000001', nombre: 'Mariana Quiroga', rol: 'cabeza' },
  { k: 'e1', dni: '99000011', nombre: 'Ricardo Albornoz', rol: 'encargado', padre: 'cab', circuito: '1' },
  { k: 'e2', dni: '99000012', nombre: 'Silvina Frías', rol: 'encargado', padre: 'cab', circuito: '2, 3' },
  { k: 'e3', dni: '99000013', nombre: 'Gustavo Medina', rol: 'encargado', padre: 'cab', circuito: '4' },
  { k: 'd1', dni: '99000021', nombre: 'Héctor Paz', rol: 'dirigente', padre: 'e1' },
  { k: 'd2', dni: '99000022', nombre: 'Lorena Villagra', rol: 'dirigente', padre: 'e1' },
  { k: 'd3', dni: '99000023', nombre: 'Javier Sosa', rol: 'dirigente', padre: 'e2' },
  { k: 'd4', dni: '99000024', nombre: 'Natalia Ruiz', rol: 'dirigente', padre: 'e2' },
  { k: 'd5', dni: '99000025', nombre: 'Marcelo Juárez', rol: 'dirigente', padre: 'e3' },
  { k: 'd6', dni: '99000026', nombre: 'Andrea Costilla', rol: 'dirigente', padre: 'e3' },
  { k: 'm1', dni: '99000031', nombre: 'Diego Lazarte', rol: 'movilizador', padre: 'd1' },
  { k: 'm2', dni: '99000032', nombre: 'Carla Ledesma', rol: 'movilizador', padre: 'd1' },
  { k: 'm3', dni: '99000033', nombre: 'Pablo Acosta', rol: 'movilizador', padre: 'd2' },
  { k: 'm4', dni: '99000034', nombre: 'Romina Díaz', rol: 'movilizador', padre: 'd2' },
  { k: 'm5', dni: '99000035', nombre: 'Sergio Gómez', rol: 'movilizador', padre: 'd3' },
  { k: 'm6', dni: '99000036', nombre: 'Valeria Moreno', rol: 'movilizador', padre: 'd3' },
  { k: 'm7', dni: '99000037', nombre: 'Martín Herrera', rol: 'movilizador', padre: 'd4' },
  { k: 'm8', dni: '99000038', nombre: 'Gabriela Luna', rol: 'movilizador', padre: 'd4' },
  { k: 'm9', dni: '99000039', nombre: 'Facundo Romero', rol: 'movilizador', padre: 'd5' },
  { k: 'm10', dni: '99000040', nombre: 'Daniela Torres', rol: 'movilizador', padre: 'd5' },
  { k: 'm11', dni: '99000041', nombre: 'Ezequiel Rojas', rol: 'movilizador', padre: 'd6' },
  { k: 'm12', dni: '99000042', nombre: 'Paula Figueroa', rol: 'movilizador', padre: 'd6' },
  { k: 'f1', dni: '99000051', nombre: 'Lucía Benítez', rol: 'fiscal', padre: 'm1' },
  { k: 'f2', dni: '99000052', nombre: 'Tomás Aguirre', rol: 'fiscal', padre: 'm5' },
  { k: 'f3', dni: '99000053', nombre: 'Julieta Molina', rol: 'fiscal', padre: 'm7' },
  { k: 'f4', dni: '99000054', nombre: 'Ramiro Vega', rol: 'fiscal', padre: 'm9' }
];

const ESCUELAS = [
  { circuito: '1', escuela: 'Esc. N° 101 Los Ceibos', dirEscuela: 'Av. Mate de Luna 2100', mesas: ['1001', '1002', '1003'] },
  { circuito: '1', escuela: 'Esc. N° 118 Bernardino Rivadavia', dirEscuela: 'Pje. Las Acacias 450', mesas: ['1004', '1005'] },
  { circuito: '2', escuela: 'Esc. N° 205 Juan B. Alberdi', dirEscuela: 'Av. Roca 1800', mesas: ['2001', '2002', '2003'] },
  { circuito: '2', escuela: 'Colegio Nuevo Horizonte', dirEscuela: 'Lamadrid 950', mesas: ['2004', '2005'] },
  { circuito: '3', escuela: 'Esc. N° 312 Gral. Belgrano', dirEscuela: 'Av. Siria 1300', mesas: ['3001', '3002', '3003'] },
  { circuito: '4', escuela: 'Esc. N° 408 Domingo F. Sarmiento', dirEscuela: 'Av. Kirchner 2700', mesas: ['4001', '4002', '4003'] },
  { circuito: '4', escuela: 'Esc. N° 415 El Bosque', dirEscuela: 'Calle Los Pinos 300', mesas: ['4004', '4005'] }
];
const APELLIDOS = ['GONZÁLEZ', 'RODRÍGUEZ', 'GÓMEZ', 'FERNÁNDEZ', 'LÓPEZ', 'DÍAZ', 'MARTÍNEZ', 'PÉREZ', 'SÁNCHEZ', 'ROMERO', 'SOSA', 'TORRES', 'ÁLVAREZ', 'RUIZ', 'RAMÍREZ', 'FLORES', 'BENÍTEZ', 'ACOSTA', 'MEDINA', 'HERRERA', 'AGUIRRE', 'GIMÉNEZ', 'MOLINA', 'SILVA', 'CASTRO', 'ROJAS', 'ORTIZ', 'LUNA', 'JUÁREZ', 'CABRERA', 'RÍOS', 'FERREYRA', 'GODOY', 'MORALES', 'DOMÍNGUEZ', 'QUIROGA', 'LEDESMA', 'VERA', 'PAZ', 'ALBORNOZ', 'CORONEL', 'VILLAGRA', 'ORELLANA', 'COSTILLA', 'NAVARRO'];
const NOMBRES = ['María José', 'Juan Carlos', 'Ana Laura', 'José Luis', 'Silvia', 'Carlos Alberto', 'Patricia', 'Miguel Ángel', 'Graciela', 'Jorge', 'Mónica', 'Luis', 'Claudia', 'Ramón', 'Verónica', 'Daniel', 'Marcela', 'Roberto', 'Lucía', 'Hugo', 'Elena', 'Walter', 'Rosa', 'Sebastián', 'Agustina', 'Matías', 'Florencia', 'Nicolás', 'Camila', 'Franco', 'Milagros', 'Brian', 'Micaela', 'Gonzalo', 'Rocío', 'Lautaro', 'Antonella', 'Emanuel', 'Belén', 'Cristian'];
const CALLES = ['Av. Mate de Luna', 'Av. Roca', 'Lamadrid', 'Av. Siria', 'Santiago del Estero', 'Corrientes', 'Marcos Paz', 'Bolívar', 'Jujuy', 'Av. Alem', 'Las Heras', 'Mendoza', 'Pje. Los Álamos', 'Av. Independencia', 'Rondeau', 'Monteagudo', 'Av. Avellaneda', 'Catamarca', 'Pje. San Lorenzo', 'Av. Belgrano'];
export const LISTAS = ['Lista 501 · Frente Horizonte Tucumano', 'Lista 502 · Alianza Cerros Unidos', 'Lista 503 · Movimiento Valle Nuevo', 'Lista 504 · Unión Vecinal del Jardín'];
const CATEGORIAS = ['Gobernador', 'Legisladores', 'Intendente', 'Concejales'];

let semillaAzar = 20271;
const rnd = () => { semillaAzar = (semillaAzar * 16807) % 2147483647; return (semillaAzar - 1) / 2147483646; };
const pick = (a) => a[Math.floor(rnd() * a.length)];

function armarPadron() {
  const regs = []; let n = 0;
  for (const e of ESCUELAS) {
    for (const mesa of e.mesas) {
      for (let o = 1; o <= 70; o++) {
        n++;
        const dni = String(98000000 + n * 37);
        regs.push({
          dni, nombre: `${pick(APELLIDOS)}, ${pick(NOMBRES)}`, domicilio: `${pick(CALLES)} ${Math.floor(100 + rnd() * 3400)}`,
          circuito: e.circuito, escuela: e.escuela, dirEscuela: e.dirEscuela, mesa, orden: String(o)
        });
      }
    }
  }
  return regs;
}

function resumirPadron(registros) {
  const c = {};
  for (const r of registros) {
    const x = (c[r.circuito || '–'] ||= { e: 0, esc: {} });
    x.e++; x.esc[r.escuela] = (x.esc[r.escuela] || 0) + 1;
  }
  const out = {};
  for (const k in c) out[k] = { e: c[k].e, esc: Object.entries(c[k].esc).map(([nm, e]) => ({ n: nm, e })) };
  return out;
}

// ---------- el sembrado ----------
export async function sembrar(log) {
  semillaAzar = 20271; // siempre los mismos datos, así un reintento completa sin duplicar
  const app = (nombre) => getApps().find((a) => a.name === nombre) || initializeApp(FIREBASE_CONFIG, nombre);
  const appA = app('demo-cabeza');
  const appB = app('demo-otros');
  const authA = getAuth(appA); const authB = getAuth(appB);
  const db = getFirestore(appA); const dbB = getFirestore(appB);

  // 1) Cabeza y campaña
  log('Creando la cabeza y la campaña…');
  const cab = EQUIPO[0];
  let uidCab;
  try { uidCab = (await createUserWithEmailAndPassword(authA, email(cab.dni), CLAVE)).user.uid; }
  catch (e) {
    if (e.code !== 'auth/email-already-in-use') throw e;
    uidCab = (await signInWithEmailAndPassword(authA, email(cab.dni), CLAVE)).user.uid;
  }
  const cuenta = await getDoc(doc(db, 'cuentas', uidCab));
  const cid = cuenta.exists() ? cuenta.data().cid : doc(collection(db, 'campanias')).id;
  const D = (...p) => doc(db, 'campanias', cid, ...p);
  const DB = (...p) => doc(dbB, 'campanias', cid, ...p);
  await setDoc(doc(db, 'cuentas', uidCab), { cid });
  if (!cuenta.exists()) await setDoc(doc(db, 'campanias', cid), { nombre: 'DEMO · Frente Horizonte Tucumano', ownerUid: uidCab, creado: serverTimestamp() });

  const U = {}; // k -> usuario
  U.cab = { uid: uidCab, dni: cab.dni, nombre: cab.nombre, rol: 'cabeza', parentId: null, path: [uidCab], circuito: '', tel: '', domicilio: 'Av. Mate de Luna 1500' };
  if (!(await getDoc(D('usuarios', uidCab))).exists()) await setDoc(D('usuarios', uidCab), { ...U.cab, creado: serverTimestamp() });

  // listas, categorías y alertas
  const listas = LISTAS.map((nm) => ({ id: idLista(nm), nombre: nm }));
  const categorias = CATEGORIAS.map((nm) => ({ id: idLista('cat ' + nm), nombre: nm }));
  const hoy = new Date(); const fecha = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
  await updateDoc(doc(db, 'campanias', cid), { listas, categorias });
  try {
    await updateDoc(doc(db, 'campanias', cid), { alertas: { fecha, minimo: 5, pasos: [{ hora: '08:00', pct: 30, niveles: 1 }, { hora: '12:00', pct: 40, niveles: 2 }, { hora: '15:00', pct: 50, niveles: 99 }] } });
  } catch (e) { log('(Las alertas no se pudieron guardar: falta pegar las reglas nuevas en Firebase. Lo demás sigue.)'); }

  // 2) Equipo
  for (const x of EQUIPO.slice(1)) {
    log(`Creando ${x.rol}: ${x.nombre}…`);
    let uid;
    try {
      uid = (await createUserWithEmailAndPassword(authB, email(x.dni), CLAVE)).user.uid;
    } catch (e) {
      if (e.code !== 'auth/email-already-in-use') throw e;
      uid = (await signInWithEmailAndPassword(authB, email(x.dni), CLAVE)).user.uid;
    }
    await setDoc(doc(dbB, 'cuentas', uid), { cid });
    await signOut(authB);
    const sup = U[x.padre];
    U[x.k] = {
      uid, dni: x.dni, nombre: x.nombre, rol: x.rol, parentId: sup.uid, path: [...sup.path, uid],
      circuito: x.circuito || sup.circuito || '', tel: '', domicilio: `${pick(CALLES)} ${Math.floor(100 + rnd() * 3000)}`
    };
    if (!(await getDoc(D('usuarios', uid))).exists()) await setDoc(D('usuarios', uid), { ...U[x.k], creado: serverTimestamp() });
  }

  // 3) Padrón
  const padron = armarPadron();
  log(`Subiendo el padrón (${padron.length} electores)…`);
  const grupos = {};
  for (const r of padron) (grupos[bucketDe(r.dni)] ||= {})[r.dni] = padronAString(r);
  const claves = Object.keys(grupos);
  for (let i = 0; i < claves.length; i += 200) {
    const b = writeBatch(db);
    for (const k of claves.slice(i, i + 200)) b.set(D('padron', k), { v: grupos[k] }, { merge: true });
    await b.commit();
  }
  await setDoc(D('padron', 'resumen'), { circuitos: resumirPadron(padron) });

  // 4) Gente cargada: cada movilizador ~25 personas de sus circuitos; cada dirigente unas pocas
  log('Cargando la gente de cada movilizador…');
  const libres = {}; // circuito -> registros sin dueño
  for (const r of padron) (libres[r.circuito] ||= []).push(r);
  for (const k in libres) libres[k].sort(() => rnd() - 0.5);
  const circuitosDe = (u) => String(u.circuito).split(/\s*,\s*/).filter(Boolean);
  const personas = [];
  const estados = ['confirmado', 'confirmado', 'confirmado', 'traslado', 'dudoso', 'sin'];
  const asignar = (u, cant) => {
    const cs = circuitosDe(u);
    for (let i = 0; i < cant; i++) {
      const c = cs[i % cs.length]; const r = libres[c]?.pop();
      if (!r) continue;
      const estado = pick(estados);
      personas.push({
        ...r, estado, tipo: 'votante', tel: '', nota: estado === 'traslado' && rnd() < 0.5 ? 'Pasarla a buscar a la mañana' : '', revisar: false, enPadron: true,
        palabras: palabrasDe(r.nombre), ownerId: u.uid, ownerNombre: u.nombre, path: u.path,
        voto: false, creadoAt: serverTimestamp(), creadoPor: uidCab,
        _votar: estado === 'confirmado' ? rnd() < 0.55 : estado === 'traslado' ? rnd() < 0.3 : rnd() < 0.15
      });
    }
  };
  for (let i = 1; i <= 12; i++) asignar(U['m' + i], 18 + Math.floor(rnd() * 14));
  for (let i = 1; i <= 6; i++) asignar(U['d' + i], 4 + Math.floor(rnd() * 4));
  // dos movilizadores flojos (para que salten las alertas)
  for (const p of personas) if ((p.ownerId === U.m4.uid || p.ownerId === U.m10.uid) && p._votar && rnd() < 0.75) p._votar = false;
  // los fiscales también figuran como personas (tipo fiscal) de quien los cargó
  for (const f of ['f1', 'f2', 'f3', 'f4']) {
    const u = U[f]; const sup = U[EQUIPO.find((x) => x.k === f).padre];
    const r = libres[circuitosDe(sup)[0]].pop();
    personas.push({ ...r, dni: u.dni, nombre: u.nombre.toUpperCase(), estado: 'confirmado', tipo: 'fiscal', tel: '', nota: '', revisar: false, enPadron: false,
      palabras: palabrasDe(u.nombre), ownerId: sup.uid, ownerNombre: sup.nombre, path: sup.path, voto: false, creadoAt: serverTimestamp(), creadoPor: uidCab, _votar: false });
  }
  // dueños agrupados (las reglas revisan al dueño de cada persona)
  const porDueno = {};
  for (const p of personas) (porDueno[p.ownerId] ||= []).push(p);
  let hechas = 0; let nuevas = 0;
  for (const lista of Object.values(porDueno)) {
    hechas += lista.length;
    if ((await getDoc(D('personas', lista[0].dni))).exists()) continue; // ya estaba (se está volviendo a correr)
    nuevas += lista.length;
    const b = writeBatch(db);
    for (const p of lista) { const { _votar, ...datos } = p; b.set(D('personas', p.dni), datos); }
    await b.commit();
    log(`Gente cargada: ${hechas} de ${personas.length}`);
  }
  log('Marcando quién ya votó…');
  const votaron = personas.filter((p) => p._votar);
  for (let i = 0; i < votaron.length; i += 300) {
    const b = writeBatch(db);
    for (const p of votaron.slice(i, i + 300)) b.update(D('personas', p.dni), { voto: true, votoAt: Date.now() - Math.floor(rnd() * 5 * 3600e3), actualizadoAt: serverTimestamp() });
    await b.commit();
  }

  // 5) Fiscales: su mesa, presencia, incidencias y actas
  log('Cargando fiscales y actas…');
  const votos = (arr) => Object.fromEntries(listas.map((l, i) => [l.id, arr[i]]));
  const acta = (base) => ({
    cats: Object.fromEntries(categorias.map((c, i) => {
      const v = base.map((x, j) => Math.max(0, x + [0, -4, 3, 1][i] * (j === 0 ? 1 : -1) + (j === 2 ? i : 0)));
      const bl = 5 + i; const nu = 3; const total = v.reduce((a, x) => a + x, 0) + bl + nu;
      return [c.id, { votos: votos(v), blancos: bl, nulos: nu, recurridos: 0, impugnados: 0, total, sumaOk: true }];
    }))
  });
  const ahora = Date.now();
  const fiscalias = [
    ['f1', { mesa: '1002', escuela: 'Esc. N° 101 Los Ceibos', circuito: '1', presente: true, presenteAt: ahora - 9 * 3600e3, acta: acta([118, 76, 22, 9]), actaAt: ahora - 25 * 60e3, tieneFoto: false }],
    ['f2', { mesa: '2002', escuela: 'Esc. N° 205 Juan B. Alberdi', circuito: '2', presente: true, presenteAt: ahora - 9 * 3600e3, acta: acta([97, 104, 18, 12]), actaAt: ahora - 15 * 60e3, tieneFoto: false,
      incidencias: [{ texto: 'Faltan boletas de la Lista 501 en el cuarto oscuro', at: ahora - 5 * 3600e3 }] }],
    ['f3', { mesa: '3001', escuela: 'Esc. N° 312 Gral. Belgrano', circuito: '3', presente: true, presenteAt: ahora - 8.5 * 3600e3,
      incidencias: [{ texto: 'La mesa abrió 40 minutos tarde', at: ahora - 8 * 3600e3 }] }],
    ['f4', { mesa: '4002', escuela: 'Esc. N° 408 Domingo F. Sarmiento', circuito: '4', presente: false }]
  ];
  for (const [k, datos] of fiscalias) {
    const u = U[k];
    await setDoc(D('fiscalias', u.uid), {
      fiscalUid: u.uid, nombre: u.nombre, dni: u.dni, tel: '', path: u.path, incidencias: [], votaEscuela: datos.escuela, votaMesa: datos.mesa,
      ...datos, creado: serverTimestamp()
    }, { merge: true });
  }

  // 6) Un reclamo por una persona que ya era de otro (lo hace un movilizador)
  if (nuevas) try {
    log('Creando un conflicto de ejemplo…');
    await signInWithEmailAndPassword(authB, email(U.m2.dni), CLAVE);
    const ajena = personas.find((p) => p.ownerId === U.m1.uid);
    const ref = await addDoc(collection(dbB, 'campanias', cid, 'conflictos'), { dni: ajena.dni, byId: U.m2.uid, byNombre: U.m2.nombre, byPath: U.m2.path, estado: 'intento', motivo: '', at: serverTimestamp() });
    await updateDoc(ref, { estado: 'reclamo', motivo: 'Es mi vecina, la trabajo desde la elección pasada' });
    await signOut(authB);
  } catch (e) { log('(No se pudo crear el conflicto de ejemplo: ' + e.message + ')'); }

  // 7) Ubicaciones de algunos movilizadores (cada uno publica la suya)
  log('Simulando la ubicación de algunos movilizadores…');
  const puntos = [[-26.8241, -65.2226, 2], [-26.8302, -65.2141, 5], [-26.8115, -65.2310, 12], [-26.8187, -65.2072, 1], [-26.8059, -65.2178, 28], [-26.8360, -65.1990, 7]];
  const quienes = ['m1', 'm3', 'm5', 'm7', 'm9', 'm11'];
  for (let i = 0; i < quienes.length; i++) {
    const u = U[quienes[i]]; const [lat, lng, min] = puntos[i];
    try {
      await signInWithEmailAndPassword(authB, email(u.dni), CLAVE);
      await setDoc(DB('ubicaciones', u.uid), { uid: u.uid, nombre: u.nombre, rol: u.rol, path: u.path, lat, lng, prec: 15, at: Date.now() - min * 60e3, activo: true });
      await signOut(authB);
    } catch (e) { log('(Ubicación de ' + u.nombre + ': ' + e.message + ')'); }
  }

  await signOut(authA);
  log('¡Listo! La demo está creada.');
  return { cid, personas: personas.length, votaron: votaron.length, padron: padron.length };
}
