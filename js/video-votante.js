// Página pública del link personal: el votante confirma su DNI, acepta los términos y sube su video de constancia.
import { FIREBASE_CONFIG } from './config.js';
import { normDni, primerNombreDe } from './video-util.js';

const S = FIREBASE_CONFIG ? await import('./store-firebase.js') : await import('./store-demo.js');
const $ = (s) => document.querySelector(s);
const q = new URLSearchParams(location.search);
const cid = q.get('c') || ''; const token = q.get('t') || '';
let datos = null; let archivo = null;

const mostrar = (id, si = true) => { $(id).hidden = !si; };

async function iniciar() {
  try { datos = cid && token ? await S.leerLinkVideo(cid, token) : null; } catch (e) { console.error(e); datos = null; }
  mostrar('#cargando', false);
  if (!datos || datos.vence < Date.now()) { mostrar('#invalido'); return; }
  $('#saludo').textContent = `¡Hola ${primerNombreDe(datos.nombre)}!`;
  mostrar('#form');
  actualizar();
}

function listoParaElegir() {
  return normDni($('#dni').value) === datos.dni && $('#acepto').checked;
}
function actualizar() {
  const d = normDni($('#dni').value);
  $('#dni-err').hidden = !(d.length >= 7 && d !== datos.dni);
  const ok = listoParaElegir();
  for (const id of ['#b-grabar', '#b-galeria']) $(id).setAttribute('aria-disabled', String(!ok));
}

function duracion(f) {
  return new Promise((res) => {
    const v = document.createElement('video'); v.preload = 'metadata';
    const url = URL.createObjectURL(f);
    const fin = (x) => { URL.revokeObjectURL(url); res(x); };
    v.onloadedmetadata = () => fin(v.duration); v.onerror = () => fin(null); setTimeout(() => fin(null), 6000);
    v.src = url;
  });
}

async function subir() {
  if (!archivo || !listoParaElegir()) return;
  mostrar('#error', false); mostrar('#elegir', false); mostrar('#subiendo');
  const pct = (h, t) => (t ? Math.round((h * 100) / t) : 0);
  try {
    await S.subirVideoConLink(cid, token, datos.dni, archivo, (h, t) => { $('#sub-bar').style.width = pct(h, t) + '%'; $('#sub-txt').textContent = `Subiendo tu video… ${pct(h, t)}%`; });
    mostrar('#subiendo', false); mostrar('#listo');
  } catch (e) {
    console.error(e);
    mostrar('#subiendo', false); mostrar('#elegir'); mostrar('#error');
    $('#err-txt').textContent = /network|retry|unavailable/i.test(String(e.code || e.message)) ? 'No hay buena señal. Probá de nuevo en un ratito.' : 'No se pudo subir el video. Probá de nuevo o avisale a quien te mandó el link.';
  }
}

async function elegido(f) {
  if (!f) return;
  mostrar('#error', false);
  if (!/^video\//.test(f.type || '')) { mostrar('#error'); $('#err-txt').textContent = 'Ese archivo no es un video.'; return; }
  if (f.size > 60 * 1048576) { mostrar('#error'); $('#err-txt').textContent = 'El video es muy pesado. Grabá uno más corto.'; return; }
  const d = await duracion(f);
  if (d && d > 75) { mostrar('#error'); $('#err-txt').textContent = 'El video dura más de un minuto. Grabá uno más corto.'; return; }
  archivo = f;
  subir();
}

$('#dni').addEventListener('input', actualizar);
$('#acepto').addEventListener('change', actualizar);
$('#f-grabar').addEventListener('change', (e) => elegido(e.target.files[0]));
$('#f-galeria').addEventListener('change', (e) => elegido(e.target.files[0]));
$('#b-reintentar').addEventListener('click', subir);
iniciar();
