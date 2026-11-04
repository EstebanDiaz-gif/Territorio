// Página pública del link personal: el votante confirma su DNI, acepta los términos y sube su video de constancia.
// Con Firebase usa llamadas directas (REST) en vez del SDK: la página abre al instante, aun con mala señal.
import { FIREBASE_CONFIG } from './config.js';
import { normDni, primerNombreDe } from './video-util.js';

const $ = (s) => document.querySelector(s);
const q = new URLSearchParams(location.search);
const cid = q.get('c') || ''; const token = q.get('t') || '';
let datos = null; let archivo = null;
const mostrar = (id, si = true) => { $(id).hidden = !si; };
const seguro = (x) => /^[A-Za-z0-9_-]{1,64}$/.test(x);

// ---------- acceso a datos ----------
const FS = FIREBASE_CONFIG ? `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents` : '';
let demo = null;
const S = async () => (demo ||= await import('./store-demo.js'));

async function leerLink() {
  if (!seguro(cid) || !seguro(token)) return null;
  if (!FIREBASE_CONFIG) return (await S()).leerLinkVideo(cid, token);
  const r = await fetch(`${FS}/campanias/${cid}/tokensVideo/${token}`);
  if (!r.ok) return null;
  const f = (await r.json()).fields || {};
  return { dni: f.dni?.stringValue || '', nombre: f.nombre?.stringValue || '', vence: Date.parse(f.expira?.timestampValue || 0) };
}

function subirArchivo(url, f, onProgreso) {
  return new Promise((res, rej) => {
    const x = new XMLHttpRequest();
    x.open('POST', url);
    x.setRequestHeader('Content-Type', f.type || 'video/mp4');
    x.upload.onprogress = (e) => onProgreso?.(e.loaded, e.total);
    x.onload = () => (x.status >= 200 && x.status < 300 ? res() : rej(Object.assign(new Error('subida ' + x.status), { code: x.status === 403 ? 'denegado' : 'servidor' })));
    x.onerror = () => rej(Object.assign(new Error('sin conexión'), { code: 'network' }));
    x.send(f);
  });
}

async function subirVideo(dni, f, onProgreso) {
  if (!FIREBASE_CONFIG) return (await S()).subirVideoConLink(cid, token, dni, f, onProgreso);
  const path = `campanias/${cid}/videos/${dni}/t_${token}`;
  await subirArchivo(`https://firebasestorage.googleapis.com/v0/b/${FIREBASE_CONFIG.storageBucket}/o?uploadType=media&name=${encodeURIComponent(path)}`, f, onProgreso);
  const ahora = Date.now();
  const campos = ['video', 'conVideo', 'voto', 'votoAt'].map((c) => 'updateMask.fieldPaths=' + c).join('&');
  const r = await fetch(`${FS}/campanias/${cid}/personas/${dni}?${campos}&currentDocument.exists=true`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: {
      video: { mapValue: { fields: { path: { stringValue: path }, tam: { integerValue: String(f.size) }, at: { integerValue: String(ahora) }, token: { stringValue: token }, por: { stringValue: 'votante' } } } },
      conVideo: { booleanValue: true }, voto: { booleanValue: true }, votoAt: { integerValue: String(ahora) }
    } })
  });
  if (!r.ok) throw Object.assign(new Error('marcar voto ' + r.status), { code: 'servidor' });
}

// ---------- pantalla ----------
async function iniciar() {
  try { datos = await leerLink(); } catch (e) { console.error(e); datos = null; }
  mostrar('#cargando', false);
  if (!datos || !datos.dni || !(datos.vence > Date.now())) { mostrar('#invalido'); return; }
  $('#saludo').textContent = `¡Hola ${primerNombreDe(datos.nombre)}!`;
  mostrar('#form');
  actualizar();
}

const listoParaElegir = () => normDni($('#dni').value) === datos.dni && $('#acepto').checked;
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
    await subirVideo(datos.dni, archivo, (h, t) => { $('#sub-bar').style.width = pct(h, t) + '%'; $('#sub-txt').textContent = `Subiendo tu video… ${pct(h, t)}%`; });
    mostrar('#subiendo', false); mostrar('#listo');
  } catch (e) {
    console.error(e);
    mostrar('#subiendo', false); mostrar('#elegir'); mostrar('#error');
    $('#err-txt').textContent = e.code === 'network' ? 'No hay buena señal. Probá de nuevo en un ratito.' : 'No se pudo subir el video. Probá de nuevo o avisale a quien te mandó el link.';
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
