// Lectura de planillas: Excel (.xlsx/.xls), CSV y Word (.docx con tablas).
// Detecta qué columna es cada dato aunque cambien los títulos o el orden.
import { normDni, dniValido } from './roles.js';

const LIBS = {
  XLSX: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  JSZip: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
};
const cargando = {};
export function necesito(nombre) {
  if (window[nombre]) return Promise.resolve(window[nombre]);
  cargando[nombre] ||= new Promise((ok, mal) => {
    const s = document.createElement('script');
    s.src = LIBS[nombre];
    s.onload = () => ok(window[nombre]);
    s.onerror = () => mal(new Error('No se pudo cargar el lector de archivos. Revisá la conexión.'));
    document.head.appendChild(s);
  });
  return cargando[nombre];
}

const sinAcentos = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// ---------- Lectura ----------
export async function leerArchivo(file) {
  const nombre = file.name || '';
  const ext = nombre.split('.').pop().toLowerCase();
  const buf = await file.arrayBuffer();
  if (ext === 'docx') return { nombre, ...(await leerDocx(buf)) };
  if (['xlsx', 'xls', 'csv', 'ods', 'txt'].includes(ext)) return { nombre, ...(await leerHoja(buf, ext)) };
  throw new Error('Formato no soportado. Usá Excel (.xlsx), CSV o Word (.docx).');
}

async function leerHoja(buf, ext) {
  const XLSX = await necesito('XLSX');
  const wb = ext === 'csv' || ext === 'txt'
    ? XLSX.read(new TextDecoder().decode(buf), { type: 'string', raw: true })
    : XLSX.read(buf, { type: 'array' });
  const tablas = wb.SheetNames.map((n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: '' })
    .map((fila) => fila.map((c) => String(c ?? '').trim())));
  return { tablas, lineas: [] };
}

async function leerDocx(buf) {
  const JSZip = await necesito('JSZip');
  const zip = await JSZip.loadAsync(buf);
  const f = zip.file('word/document.xml');
  if (!f) throw new Error('El archivo de Word está dañado o vacío.');
  const xml = new DOMParser().parseFromString(await f.async('string'), 'application/xml');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const hijos = (n, tag) => [...n.childNodes].filter((c) => c.localName === tag);
  const texto = (n) => [...n.getElementsByTagNameNS(W, 'p')].map((p) =>
    [...p.getElementsByTagNameNS(W, 't')].map((t) => t.textContent).join('')).join(' ').trim();
  const body = xml.getElementsByTagNameNS(W, 'body')[0];
  const lineas = [];
  const tablas = [];
  for (const n of body.childNodes) {
    if (n.localName === 'p') {
      const t = [...n.getElementsByTagNameNS(W, 't')].map((x) => x.textContent).join('').trim();
      if (t) lineas.push(t);
    } else if (n.localName === 'tbl') {
      tablas.push(hijos(n, 'tr').map((tr) => hijos(tr, 'tc').map(texto)));
    }
  }
  return { tablas, lineas };
}

// ---------- Columnas ----------
const COLUMNAS = [
  ['dirEscuela', /(direccion|domicilio).*(escuela|establec)/],
  ['escuela', /escuela|establecimiento|colegio|local de votacion/],
  ['dni', /\bdni\b|documento|^doc\b|^nro\.? ?doc|matricula/],
  ['apellido', /^apellidos?$/],
  ['nombre', /nombre/],
  ['tel', /telef|celular|^cel\b|whats|movil|contacto/],
  ['domicilio', /direccion|domicilio|calle/],
  ['mesa', /^mesa|n.? de mesa/],
  ['orden', /orden/],
  ['circuito', /circuito/],
  ['seccion', /seccion/]
];

function detectarEncabezado(tabla) {
  for (let i = 0; i < Math.min(tabla.length, 15); i++) {
    const mapa = {};
    tabla[i].forEach((celda, col) => {
      const t = sinAcentos(celda).replace(/\*/g, '');
      if (!t) return;
      const hit = COLUMNAS.find(([k, re]) => re.test(t) && mapa[k] === undefined);
      if (hit) mapa[hit[0]] = col;
    });
    if (mapa.dni !== undefined && (mapa.nombre !== undefined || mapa.apellido !== undefined)) return { fila: i, mapa };
  }
  return null;
}

// Datos sueltos arriba de la tabla: "Circuito: 19", "Referente: ..."
function leerEncabezados(lineas) {
  const meta = {};
  for (const l of lineas) {
    const m = l.match(/^\s*([^:]{2,30}):\s*(.+)$/);
    if (m) meta[sinAcentos(m[1])] = m[2].trim();
  }
  const titulo = lineas.join(' ');
  const circ = meta.circuito || (titulo.match(/circuito\s*(\d+)/i) || [])[1] || '';
  return { meta, titulo, circuito: normDni(circ) || circ };
}

const celda = (fila, col) => (col === undefined ? '' : String(fila[col] ?? '').trim());

function filasDeTablas(leido) {
  const salida = [];
  let encabezadoTotal = null;
  for (const tabla of leido.tablas) {
    const enc = detectarEncabezado(tabla);
    if (!enc) continue;
    encabezadoTotal = enc;
    let modoSuplente = false;
    for (const fila of tabla.slice(enc.fila + 1)) {
      const todo = fila.map(sinAcentos);
      if (todo.some((t) => /^suplentes?$/.test(t))) { modoSuplente = true; continue; }
      if (todo.some((t) => /^titulares?$/.test(t))) { modoSuplente = false; continue; }
      const m = enc.mapa;
      let nombre = celda(fila, m.nombre);
      if (m.apellido !== undefined) nombre = [celda(fila, m.apellido), nombre].filter(Boolean).join(', ');
      const dniTxt = celda(fila, m.dni);
      if (!dniTxt && !nombre) continue; // fila vacía
      salida.push({
        dniTxt, dni: normDni(dniTxt), nombre,
        tel: celda(fila, m.tel), domicilio: celda(fila, m.domicilio),
        escuela: celda(fila, m.escuela), dirEscuela: celda(fila, m.dirEscuela),
        mesa: normDni(celda(fila, m.mesa)), orden: normDni(celda(fila, m.orden)),
        circuito: celda(fila, m.circuito), suplente: modoSuplente
      });
    }
  }
  return { filas: salida, encontrado: !!encabezadoTotal, columnas: encabezadoTotal ? Object.keys(encabezadoTotal.mapa) : [] };
}

// ---------- Planilla de personas (movilizados, fiscales) ----------
export function mapearPersonas(leido) {
  const info = leerEncabezados(leido.lineas);
  const { filas, encontrado, columnas } = filasDeTablas(leido);
  if (!encontrado) throw new Error('No encontré una tabla con columnas de DNI y nombre en el archivo.');
  const esFiscales = /fiscal/i.test(info.titulo + ' ' + leido.nombre);
  const validas = [];
  const invalidas = [];
  const vistos = new Set();
  let repetidasEnArchivo = 0;
  for (const f of filas) {
    if (!dniValido(f.dni)) { invalidas.push({ ...f, motivo: f.dniTxt ? 'DNI inválido' : 'Sin DNI' }); continue; }
    if (vistos.has(f.dni)) { repetidasEnArchivo++; continue; }
    vistos.add(f.dni);
    const avisos = [];
    const telDig = normDni(f.tel);
    if (/\?/.test(f.tel) || (telDig && telDig.length < 10)) avisos.push('teléfono incompleto');
    if (/\.\.\.|…/.test(f.nombre)) avisos.push('nombre incompleto');
    validas.push({
      dni: f.dni,
      nombre: f.nombre.replace(/\s+/g, ' '),
      tel: telDig,
      domicilio: f.domicilio,
      escuela: f.escuela, dirEscuela: f.dirEscuela, mesa: f.mesa,
      circuito: normDni(f.circuito) || info.circuito || '',
      tipo: esFiscales ? (f.suplente ? 'fiscal_suplente' : 'fiscal') : 'votante',
      revisar: avisos.length > 0,
      nota: avisos.length ? 'Revisar: ' + avisos.join(', ') : ''
    });
  }
  return { validas, invalidas, repetidasEnArchivo, columnas, info, esFiscales };
}

// ---------- Padrón ----------
export function mapearPadron(leido, circuitoPorDefecto = '') {
  const info = leerEncabezados(leido.lineas);
  const { filas, encontrado, columnas } = filasDeTablas(leido);
  if (!encontrado) throw new Error('No encontré columnas de DNI y nombre en el padrón.');
  const registros = [];
  let invalidos = 0;
  for (const f of filas) {
    if (!dniValido(f.dni)) { invalidos++; continue; }
    registros.push({
      dni: f.dni, nombre: f.nombre, domicilio: f.domicilio,
      circuito: normDni(f.circuito) || f.circuito || circuitoPorDefecto || info.circuito || '',
      escuela: f.escuela, dirEscuela: f.dirEscuela, mesa: f.mesa, orden: f.orden
    });
  }
  return { registros, invalidos, columnas, faltaCircuito: !columnas.includes('circuito') };
}

export const NOMBRE_COLUMNA = {
  dni: 'DNI', nombre: 'Nombre', apellido: 'Apellido', tel: 'Teléfono', domicilio: 'Domicilio',
  escuela: 'Escuela', dirEscuela: 'Dirección escuela', mesa: 'Mesa', orden: 'Orden', circuito: 'Circuito', seccion: 'Sección'
};

// ---------- Exportar ----------
export async function exportarExcel(personas, usuarios, nombreArchivo) {
  const XLSX = await necesito('XLSX');
  const porUid = Object.fromEntries(usuarios.map((u) => [u.uid, u]));
  const filas = personas.map((p) => {
    const cadena = (p.path || []).map((id) => porUid[id]).filter(Boolean);
    const de = (rol) => cadena.find((u) => u.rol === rol)?.nombre || '';
    return {
      DNI: p.dni, Nombre: p.nombre, Teléfono: p.tel, Domicilio: p.domicilio,
      Circuito: p.circuito, Escuela: p.escuela, Mesa: p.mesa, Orden: p.orden,
      Tipo: p.tipo, Estado: p.estado, Votó: p.voto ? 'Sí' : 'No',
      Movilizador: p.ownerNombre, Dirigente: de('dirigente'), Encargado: de('encargado'), Cabeza: de('cabeza'),
      Nota: p.nota || ''
    };
  });
  const ws = XLSX.utils.json_to_sheet(filas);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Personas');
  XLSX.writeFile(wb, nombreArchivo);
}
