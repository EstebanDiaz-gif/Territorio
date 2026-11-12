// Mapa del territorio: la zona de cada uno (contorno armado con la gente que cargó) y los puntos de su gente.
// Usa Leaflet + OpenStreetMap (gratis). Las direcciones se ubican con Nominatim, de a una por segundo, y se guardan en la persona.
const PALETA = ['#0E8A57', '#2563EB', '#D97706', '#9333EA', '#DC2626', '#0891B2', '#65A30D', '#DB2777', '#475569', '#B45309'];
const CENTRO = [-26.8241, -65.2226]; // San Miguel de Tucumán
const ROL = { cabeza: 'Cabeza', encargado: 'Encargado', dirigente: 'Dirigente', movilizador: 'Movilizador' };

let libL = null;
function leaflet() {
  if (!document.getElementById('css-leaflet')) {
    const css = document.createElement('link'); css.id = 'css-leaflet'; css.rel = 'stylesheet'; css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'; document.head.appendChild(css);
  }
  if (window.L) return Promise.resolve(window.L);
  libL ||= new Promise((res, rej) => {
    const sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
    sc.onload = () => res(window.L); sc.onerror = () => { libL = null; rej(new Error('No se pudo cargar el mapa. Revisá la conexión.')); };
    document.head.appendChild(sc);
  });
  return libL;
}

// ----- geometría
const conGeo = (p) => p.geo && typeof p.geo.lat === 'number';
function casco(pts) { // contorno convexo (monotone chain) de [lat, lng]
  const P = [...pts].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  if (P.length < 3) return P;
  const cruz = (o, a, b) => (a[1] - o[1]) * (b[0] - o[0]) - (a[0] - o[0]) * (b[1] - o[1]);
  const abajo = []; for (const p of P) { while (abajo.length >= 2 && cruz(abajo[abajo.length - 2], abajo[abajo.length - 1], p) <= 0) abajo.pop(); abajo.push(p); }
  const arriba = []; for (const p of [...P].reverse()) { while (arriba.length >= 2 && cruz(arriba[arriba.length - 2], arriba[arriba.length - 1], p) <= 0) arriba.pop(); arriba.push(p); }
  return abajo.slice(0, -1).concat(arriba.slice(0, -1));
}
const metros = (a, b) => { const k = 111320; const dx = (a[1] - b[1]) * k * Math.cos(a[0] * Math.PI / 180); const dy = (a[0] - b[0]) * k; return Math.hypot(dx, dy); };
const mediana = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
// Separa los puntos de la zona de los que quedan muy lejos del resto (una dirección mal ubicada o alguien de otro barrio)
function zona(pts) {
  if (pts.length < 4) return { dentro: pts, fuera: [] };
  const c = [mediana(pts.map((p) => p[0])), mediana(pts.map((p) => p[1]))];
  const d = pts.map((p) => metros(p, c));
  const lim = Math.max(mediana(d) * 3, 600);
  const dentro = []; const fuera = [];
  pts.forEach((p, i) => (d[i] <= lim ? dentro : fuera).push(p));
  return { dentro, fuera };
}

// ----- ubicar direcciones (Nominatim: máximo 1 pedido por segundo)
const CACHE = 'territorio-geo-v1';
let cacheGeo = {}; try { cacheGeo = JSON.parse(localStorage.getItem(CACHE) || '{}'); } catch { /* */ }
const guardarCache = () => { try { localStorage.setItem(CACHE, JSON.stringify(cacheGeo)); } catch { /* */ } };
const limpiarDom = (d) => String(d || '').replace(/\b(B[°º]?|Bº|Barrio)\s*/gi, 'Barrio ').replace(/\bPJE\.?\b/gi, 'Pasaje').replace(/\bAV\.?\b/gi, 'Avenida').replace(/\s+/g, ' ').trim();
async function ubicar(dom) {
  const q = limpiarDom(dom);
  if (q.length < 4) return null;
  if (q in cacheGeo) return cacheGeo[q];
  const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=ar&viewbox=-66.3,-26.0,-64.4,-28.1&bounded=1&q=' + encodeURIComponent(q + ', Tucumán, Argentina');
  const r = await fetch(url, { headers: { 'Accept-Language': 'es' } });
  if (!r.ok) throw new Error('El servicio de mapas no respondió (' + r.status + ')');
  const j = await r.json();
  const g = j[0] ? { lat: +(+j[0].lat).toFixed(6), lng: +(+j[0].lon).toFixed(6), src: 'dir' } : null;
  cacheGeo[q] = g; guardarCache();
  return g;
}

// ----- vista
export async function abrirMapa(api) {
  const { esc, ic } = api;
  const raiz = api.me.rol === 'cabeza' ? 'raiz' : api.me.uid;
  const pila = [raiz];
  const cachePorNodo = new Map();
  let mapa = null; let capa = null; let ubicando = false; let cancelar = false;

  const fondo = document.createElement('div');
  fondo.className = 'mapa-full'; fondo.setAttribute('role', 'dialog'); fondo.setAttribute('aria-modal', 'true'); fondo.setAttribute('aria-label', 'Mapa del territorio');
  fondo.innerHTML = `
    <div class="mapa-top">
      <button type="button" class="icon-btn" data-m="atras" aria-label="Volver">${ic('atras', 20)}</button>
      <div class="grow" style="min-width:0"><div class="top-sub" id="m-migas"></div><b id="m-titulo" class="mapa-titulo"></b></div>
      <button type="button" class="icon-btn" data-m="cerrar" aria-label="Cerrar mapa">${ic('x', 20)}</button>
    </div>
    <div id="m-mapa" class="mapa-lienzo"><div class="vacio" style="padding-top:40%">Cargando mapa…</div></div>
    <div class="mapa-panel" id="m-panel"></div>`;
  document.body.appendChild(fondo);
  document.body.style.overflow = 'hidden';
  const cerrar = () => { cancelar = true; mapa?.remove(); fondo.remove(); document.body.style.overflow = ''; };

  const nodo = (id) => (id === 'raiz' ? { uid: 'raiz', nombre: api.me.campania || 'Toda la campaña', rol: 'cabeza' } : api.usuarios.find((u) => u.uid === id) || api.me);
  const hijosDe = (id) => api.usuarios.filter((u) => u.rol !== 'fiscal' && u.rol !== 'cabeza' && (id === 'raiz' ? u.rol === 'encargado' : u.parentId === id))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));

  async function personasDe(id) {
    if (!cachePorNodo.has(id)) cachePorNodo.set(id, await api.personasDe(id === 'raiz' ? null : id));
    return cachePorNodo.get(id);
  }

  function grupos(id, ps) {
    const hijos = hijosDe(id);
    const out = hijos.map((u, i) => ({ u, color: PALETA[i % PALETA.length], ps: ps.filter((p) => (p.path || []).includes(u.uid)) }));
    const usados = new Set(out.flatMap((g) => g.ps.map((p) => p.dni)));
    const resto = ps.filter((p) => !usados.has(p.dni));
    if (resto.length || !out.length) {
      const yo = nodo(id);
      out.push({ u: yo, propio: true, color: out.length ? '#14213D' : PALETA[0], ps: resto });
    }
    return out;
  }

  async function pintar() {
    const id = pila[pila.length - 1];
    const n = nodo(id);
    fondo.querySelector('#m-titulo').textContent = id === 'raiz' ? 'Mapa del territorio' : `Zona de ${n.nombre}`;
    fondo.querySelector('#m-migas').textContent = pila.map((x) => (x === 'raiz' ? 'Campaña' : nodo(x).nombre.split(' ')[0])).join(' › ');
    fondo.querySelector('[data-m=atras]').style.visibility = pila.length > 1 ? 'visible' : 'hidden';
    const panel = fondo.querySelector('#m-panel');
    panel.innerHTML = '<div class="muted small">Cargando gente…</div>';
    let ps;
    try { ps = await personasDe(id); } catch (e) { panel.innerHTML = `<div class="aviso bad"><span>${esc(e.message || 'No se pudo cargar la gente')}</span></div>`; return; }
    const gs = grupos(id, ps);
    capa.clearLayers();
    const todos = [];
    let fueraTot = 0;
    for (const g of gs) {
      const pts = g.ps.filter(conGeo).map((p) => [p.geo.lat, p.geo.lng, p]);
      const { dentro, fuera } = zona(pts);
      g.ubicadas = pts.length; g.fuera = fuera.length; fueraTot += fuera.length;
      const borde = casco(dentro.map((p) => [p[0], p[1]]));
      const drill = !g.propio && (hijosDe(g.u.uid).length || g.ps.length);
      if (borde.length >= 3) {
        const pol = window.L.polygon(borde, { color: g.color, weight: 3, opacity: 0.9, fillColor: g.color, fillOpacity: 0.10, dashArray: g.propio ? '6 6' : null }).addTo(capa);
        pol.bindTooltip(`${esc(g.propio ? 'Cargadas directo por ' + g.u.nombre : g.u.nombre)} · ${g.ps.length}`, { sticky: true });
        if (drill) pol.on('click', () => { pila.push(g.u.uid); pintar(); });
      }
      for (const [lat, lng, p] of pts) {
        const afuera = fuera.some((f) => f[2] === p);
        window.L.circleMarker([lat, lng], { radius: afuera ? 6 : 4.5, color: afuera ? '#DC2626' : '#fff', weight: afuera ? 2.5 : 1.5, fillColor: g.color, fillOpacity: 0.95 })
          .bindPopup(`<b>${esc(p.nombre)}</b><br>${esc(p.domicilio || '')}<br><span style="color:#555">de ${esc(p.ownerNombre || '')}${p.voto ? ' · ✓ votó' : ''}</span>${afuera ? '<br><b style="color:#DC2626">Fuera de la zona de ' + esc(g.u.nombre) + '</b>' : ''}`)
          .addTo(capa);
        todos.push([lat, lng]);
      }
    }
    if (todos.length) mapa.fitBounds(todos, { padding: [32, 32], maxZoom: 16 }); else mapa.setView(CENTRO, 13);

    const sinUbicar = ps.filter((p) => !conGeo(p) && !(p.geo && p.geo.no) && (p.domicilio || '').trim().length >= 4);
    const noSe = ps.filter((p) => p.geo && p.geo.no).length;
    const sinDom = ps.filter((p) => !conGeo(p) && !(p.domicilio || '').trim()).length;
    panel.innerHTML = `
      <div class="mapa-ley">${gs.map((g, i) => `
        <button type="button" class="mapa-fila" data-m="entrar" data-i="${i}" ${!g.propio && (hijosDe(g.u.uid).length || g.ps.length) ? '' : 'disabled'}>
          <i style="background:${g.color}${g.propio ? ';outline:2px dashed ' + g.color + ';background:transparent' : ''}"></i>
          <span class="grow"><b>${esc(g.propio ? (gs.length > 1 ? 'Cargadas directo' : g.u.nombre) : g.u.nombre)}</b> <span class="muted small">${g.propio ? '' : ROL[g.u.rol] || ''}</span>
            <span class="muted small" style="display:block">${g.ps.length} ${g.ps.length === 1 ? 'persona' : 'personas'} · ${g.ubicadas} en el mapa${g.fuera ? ` · <b style="color:#DC2626">${g.fuera} fuera de zona</b>` : ''}</span></span>
          ${!g.propio && (hijosDe(g.u.uid).length || g.ps.length) ? '<span class="chev" aria-hidden="true">›</span>' : ''}
        </button>`).join('')}</div>
      ${fueraTot ? `<div class="muted small">Los puntos con <b style="color:#DC2626">borde rojo</b> están lejos del resto de su zona: puede ser una dirección mal escrita o alguien de otro barrio.</div>` : ''}
      ${sinUbicar.length ? `<div class="row" style="gap:8px;align-items:center"><span class="grow small"><b>${sinUbicar.length}</b> ${sinUbicar.length === 1 ? 'dirección todavía no está' : 'direcciones todavía no están'} en el mapa</span>
        <button type="button" class="btn btn-sm" data-m="ubicar" ${ubicando ? 'disabled' : ''}>${ubicando ? 'Ubicando…' : 'Ubicarlas'}</button></div>
        <div id="m-prog" class="muted small"></div>` : ''}
      ${noSe || sinDom ? `<div class="muted small">${noSe ? `${noSe} con una dirección que el mapa no encontró. ` : ''}${sinDom ? `${sinDom} sin domicilio. ` : ''}Se corrige en la ficha de la persona, o con <b>Estoy en su casa</b> cuando la visitan.</div>` : ''}`;
    panel._gs = gs; panel._sin = sinUbicar;
  }

  async function ubicarTodas(lista) {
    ubicando = true; cancelar = false;
    const prog = () => fondo.querySelector('#m-prog');
    const btn = fondo.querySelector('[data-m=ubicar]'); if (btn) { btn.disabled = true; btn.textContent = 'Ubicando…'; }
    const max = Math.min(lista.length, 400);
    let ok = 0; let no = 0;
    for (let i = 0; i < max && !cancelar; i++) {
      const p = lista[i];
      const q = limpiarDom(p.domicilio);
      const enCache = q in cacheGeo;
      try {
        const g = await ubicar(p.domicilio);
        const geo = g || { no: true };
        await api.guardarGeo(p.dni, geo);
        p.geo = geo; if (g) ok++; else no++;
      } catch (e) { const x = prog(); if (x) x.textContent = e.message; break; }
      const x = prog(); if (x) x.textContent = `Ubicando ${i + 1} de ${max}… (${ok} en el mapa${no ? `, ${no} no encontradas` : ''})`;
      if (!enCache) await new Promise((r) => setTimeout(r, 1100));
      if ((i + 1) % 25 === 0 && !cancelar) pintarSoloPuntos();
    }
    ubicando = false;
    if (!cancelar) { await pintar(); api.toast(`Listo: ${ok} ${ok === 1 ? 'dirección ubicada' : 'direcciones ubicadas'}${no ? ` · ${no} no se encontraron` : ''}`); }
  }
  const pintarSoloPuntos = () => { pintar(); };

  fondo.addEventListener('click', (e) => {
    const b = e.target.closest('[data-m]'); if (!b) return;
    const a = b.dataset.m;
    if (a === 'cerrar') cerrar();
    else if (a === 'atras') { if (pila.length > 1) { pila.pop(); pintar(); } }
    else if (a === 'entrar') { const g = fondo.querySelector('#m-panel')._gs[+b.dataset.i]; if (g && !g.propio) { pila.push(g.u.uid); pintar(); } }
    else if (a === 'ubicar') ubicarTodas(fondo.querySelector('#m-panel')._sin || []);
  });

  try {
    const L = await leaflet();
    const el = fondo.querySelector('#m-mapa'); el.innerHTML = '';
    mapa = L.map(el, { zoomControl: true, attributionControl: true }).setView(CENTRO, 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(mapa);
    capa = L.layerGroup().addTo(mapa);
    await pintar();
  } catch (e) {
    fondo.querySelector('#m-mapa').innerHTML = `<div class="vacio" style="padding-top:30%">${esc(e.message || 'No se pudo abrir el mapa')}</div>`;
  }
}
