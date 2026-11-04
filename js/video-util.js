// Ayudas chicas para la página del video (sin depender de toda la app)
export const normDni = (s) => String(s ?? '').replace(/\D/g, '');
export function primerNombreDe(nombre) {
  const n = String(nombre || '').trim();
  // Padrón: "APELLIDO, Nombre" → "Nombre"
  const parte = n.includes(',') ? n.split(',')[1].trim() : n;
  const p = parte.split(/\s+/)[0] || '';
  return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : '';
}
