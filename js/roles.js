// Jerarquía y utilidades compartidas

export const ROLES = ['cabeza', 'encargado', 'dirigente', 'movilizador'];

export const ROL_LABEL = {
  cabeza: 'Cabeza',
  encargado: 'Encargado de circuito',
  dirigente: 'Dirigente',
  movilizador: 'Movilizador',
  fiscal: 'Fiscal'
};

export const ROL_CORTO = {
  cabeza: 'Cabeza',
  encargado: 'Encargado',
  dirigente: 'Dirigente',
  movilizador: 'Movilizador',
  fiscal: 'Fiscal'
};

// El fiscal no es parte de la cadena de mando: cuelga de quien lo cargó y solo ve su mesa
export const nivel = (rol) => (rol === 'fiscal' ? 4 : ROLES.indexOf(rol));
export const rolAbajo = (rol) => ROLES[nivel(rol) + 1] || null;

export const ESTADOS = [
  ['sin', 'Sin contactar'],
  ['confirmado', 'Confirmado'],
  ['traslado', 'Necesita traslado'],
  ['dudoso', 'Dudoso']
];
export const ESTADO_LABEL = Object.fromEntries(ESTADOS);

export const TIPOS = [
  ['votante', 'Votante'],
  ['fiscal', 'Fiscal'],
  ['fiscal_suplente', 'Fiscal suplente']
];
export const TIPO_LABEL = Object.fromEntries(TIPOS);

export const normDni = (s) => String(s ?? '').replace(/\D/g, '');
export const dniValido = (d) => /^\d{7,8}$/.test(d);
export const fmtDni = (d) => String(d || '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
export const bucketDe = (dni) => dni.slice(-3).padStart(3, '0');

// Padrón: cada registro se guarda como texto separado por tabulaciones para ocupar poco
export const PADRON_CAMPOS = ['nombre', 'domicilio', 'circuito', 'escuela', 'dirEscuela', 'mesa', 'orden'];
export const padronAString = (r) => PADRON_CAMPOS.map((k) => String(r[k] ?? '').replace(/\t/g, ' ')).join('\t');
export const padronDeString = (dni, s) => {
  const v = String(s).split('\t');
  const r = { dni };
  PADRON_CAMPOS.forEach((k, i) => { r[k] = v[i] || ''; });
  return r;
};

// Teléfono para WhatsApp (Argentina): 549 + característica + número
export function telWhatsApp(tel) {
  let t = normDni(tel);
  if (!t) return '';
  if (t.startsWith('54')) t = t.slice(2);
  if (t.startsWith('9')) t = t.slice(1);
  if (t.startsWith('0')) t = t.slice(1);
  t = t.replace(/^(\d{2,4})15(\d{6,8})$/, '$1$2');
  return '549' + t;
}

// Listas para el escrutinio: [{id, nombre}]. El id sale del texto para que no cambie si se reordenan.
export function idLista(nombre) {
  let h = 0;
  for (const ch of String(nombre).trim().toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return 'l' + h.toString(36);
}
