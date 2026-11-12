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

// ----- vista (estilo app de reparto: mapa claro a pantalla completa, pines numerados y una tarjeta abajo)
const casaUrl = (d) => (d ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(d + ', Tucumán, Argentina') : '');
function pin(p, color, { voto, afuera, elegido }) {
  const txt = voto ? '✓' : String(p.mesa || '').replace(/^0+/, '') || '•';
  const chico = txt.length > 3 ? ' chico' : '';
  const cls = `pin${voto ? ' voto' : ''}${afuera ? ' afuera' : ''}${elegido ? ' elegido' : ''}`;
  return window.L.divIcon({ className: 'pin-wrap', html: `<div class="${cls}" style="--c:${color}"><span class="${chico}">${txt}</span></div>`, iconSize: [34, 42], iconAnchor: [17, 42] });
}

export async function abrirMapa(api) {
  const { esc, ic } = api;
  const raiz = api.me.rol === 'cabeza' ? 'raiz' : api.me.uid;
  const pila = [raiz];
  const cachePorNodo = new Map();
  let mapa = null; let capa = null; let capaYo = null; let ubicando = false; let cancelar = false;
  let elegido = null; let listaAbierta = false; let ultimo = null;

  const fondo = document.createElement('div');
  fondo.className = 'mapa-full'; fondo.setAttribute('role', 'dialog'); fondo.setAttribute('aria-modal', 'true'); fondo.setAttribute('aria-label', 'Mapa del territorio');
  fondo.innerHTML = `
    <div class="mapa-top">
      <button type="button" class="mapa-ib" data-m="atras" aria-label="Volver">${ic('atras', 22)}</button>
      <div class="grow" style="min-width:0"><b id="m-titulo" class="mapa-titulo"></b><div id="m-resumen" class="mapa-resumen"></div></div>
      <button type="button" class="mapa-ib" data-m="cerrar" aria-label="Cerrar mapa">${ic('x', 22)}</button>
    </div>
    <div class="mapa-cuerpo">
      <div id="m-mapa" class="mapa-lienzo"><div class="vacio" style="padding-top:40%">Cargando mapa…</div></div>
      <div id="m-migas" class="mapa-migas"></div>
      <div class="mapa-abajo">
        <div class="mapa-fabs">
          <button type="button" class="mapa-fab" data-m="yo" aria-label="Mi ubicación"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="8"/></svg></button>
          <button type="button" class="mapa-fab azul" data-m="lista" aria-label="Ver lista de zonas"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9.5h16M4 14.5h16"/></svg></button>
        </div>
        <div class="mapa-card" id="m-card"></div>
      </div>
    </div>`;
  document.body.appendChild(fondo);
  document.body.style.overflow = 'hidden'; document.body.classList.add('con-mapa');
  const cerrar = (porBoton) => { cancelar = true; mapa?.remove(); fondo.remove(); document.body.style.overflow = ''; document.body.classList.remove('con-mapa'); api.alCerrar?.(porBoton); };
  api.alAbrir?.();
  // gesto "atrás": primero cierra la tarjeta o la lista, después sube un nivel; en el primero, cierra el mapa
  fondo._atras = () => {
    if (elegido) { elegido = null; dibujar(); return true; }
    if (listaAbierta) { listaAbierta = false; tarjeta(); return true; }
    if (pila.length > 1) { pila.pop(); pintar(); return true; }
    return false;
  };
  fondo._cerrar = () => cerrar(false);

  const nodo = (id) => (id === 'raiz' ? { uid: 'raiz', nombre: api.me.campania || 'Toda la campaña', rol: 'cabeza' } : api.usuarios.find((u) => u.uid === id) || api.me);
  const hijosDe = (id) => api.usuarios.filter((u) => u.rol !== 'fiscal' && u.rol !== 'cabeza' && (id === 'raiz' ? u.rol === 'encargado' : u.parentId === id))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
  const puedeEntrar = (g) => !g.propio && (hijosDe(g.u.uid).length || g.ps.length);
  const primer = (n) => String(n || '').split(' ')[0];

  async function personasDe(id) {
    if (!cachePorNodo.has(id)) cachePorNodo.set(id, await api.personasDe(id === 'raiz' ? null : id));
    return cachePorNodo.get(id);
  }

  function grupos(id, ps) {
    const hijos = hijosDe(id);
    const out = hijos.map((u, i) => ({ u, color: PALETA[i % PALETA.length], ps: ps.filter((p) => (p.path || []).includes(u.uid)) }));
    const usados = new Set(out.flatMap((g) => g.ps.map((p) => p.dni)));
    const resto = ps.filter((p) => !usados.has(p.dni));
    if (resto.length || !out.length) out.push({ u: nodo(id), propio: true, color: out.length ? '#475569' : PALETA[1], ps: resto });
    return out;
  }

  // Carga la gente del nivel y arma las zonas; después dibuja
  async function pintar() {
    const id = pila[pila.length - 1];
    const n = nodo(id);
    elegido = null; listaAbierta = false;
    fondo.querySelector('#m-titulo').textContent = id === 'raiz' ? 'Mapa del territorio' : `Zona de ${n.nombre}`;
    fondo.querySelector('#m-resumen').textContent = 'Cargando…';
    fondo.querySelector('[data-m=atras]').style.visibility = pila.length > 1 ? 'visible' : 'hidden';
    const migas = fondo.querySelector('#m-migas');
    migas.innerHTML = pila.length > 1 ? pila.map((x, i) => `<button type="button" data-m="miga" data-i="${i}">${esc(x === 'raiz' ? 'Campaña' : primer(nodo(x).nombre))}</button>`).join('<span>›</span>') : '';
    let ps;
    try { ps = await personasDe(id); } catch (e) { fondo.querySelector('#m-resumen').textContent = e.message || 'No se pudo cargar la gente'; return; }
    const gs = grupos(id, ps);
    for (const g of gs) {
      const pts = g.ps.filter(conGeo).map((p) => [p.geo.lat, p.geo.lng, p]);
      const z = zona(pts);
      g.pts = pts; g.fueraSet = new Set(z.fuera.map((f) => f[2].dni)); g.borde = casco(z.dentro.map((p) => [p[0], p[1]]));
      g.votaron = g.ps.filter((p) => p.voto).length;
    }
    ultimo = { id, ps, gs };
    const vot = ps.filter((p) => p.voto).length;
    fondo.querySelector('#m-resumen').textContent = `${ps.length} ${ps.length === 1 ? 'persona' : 'personas'}${gs.length > 1 || !gs[0]?.propio ? ` en ${gs.filter((g) => !g.propio).length} zonas` : ''}${vot ? ` · ${vot} ya votaron` : ''}`;
    dibujar(true);
  }

  function dibujar(encuadrar = false) {
    if (!ultimo) return;
    const { gs } = ultimo;
    capa.clearLayers();
    const todos = [];
    for (const g of gs) {
      if (g.borde.length >= 3) {
        const pol = window.L.polygon(g.borde, { color: g.color, weight: 2.5, opacity: 0.85, fillColor: g.color, fillOpacity: 0.07, dashArray: g.propio ? '6 6' : null }).addTo(capa);
        if (puedeEntrar(g)) pol.on('click', () => { if (!elegido) { pila.push(g.u.uid); pintar(); } });
        if (!g.propio) {
          const c = pol.getBounds().getCenter();
          window.L.marker(c, { interactive: false, icon: window.L.divIcon({ className: 'zona-label', html: `<span style="color:${g.color}">${esc(primer(g.u.nombre))}</span>`, iconSize: [140, 20], iconAnchor: [70, 10] }) }).addTo(capa);
        }
      }
      const muchos = g.pts.length > 600;
      for (const [lat, lng, p] of g.pts) {
        const afuera = g.fueraSet.has(p.dni);
        const sel = elegido?.dni === p.dni;
        const m = muchos && !sel
          ? window.L.circleMarker([lat, lng], { radius: 5, color: afuera ? '#DC2626' : '#fff', weight: afuera ? 2.5 : 1.5, fillColor: g.color, fillOpacity: p.voto ? 0.45 : 0.95 })
          : window.L.marker([lat, lng], { icon: pin(p, g.color, { voto: p.voto, afuera, elegido: sel }), zIndexOffset: sel ? 1000 : p.voto ? -100 : 0, keyboard: false });
        m.on('click', (e) => { window.L.DomEvent.stopPropagation(e); elegido = { dni: p.dni, p, g, afuera }; dibujar(); mapa.panTo([lat, lng], { animate: true }); });
        m.addTo(capa);
        todos.push([lat, lng]);
      }
    }
    if (encuadrar) { if (todos.length) mapa.fitBounds(todos, { paddingTopLeft: [28, 56], paddingBottomRight: [28, 150], maxZoom: 16 }); else mapa.setView(CENTRO, 13); }
    tarjeta();
  }

  // La tarjeta blanca de abajo: la persona tocada, la lista de zonas, o un resumen corto
  function tarjeta() {
    const card = fondo.querySelector('#m-card');
    if (!ultimo) { card.innerHTML = ''; return; }
    const { ps, gs } = ultimo;
    fondo.querySelector('[data-m=lista]').classList.toggle('activo', listaAbierta);
    if (elegido) {
      const { p, g, afuera } = elegido;
      card.className = 'mapa-card';
      card.innerHTML = `
        <div class="row" style="gap:14px;align-items:center">
          <div class="mapa-num" style="--c:${g.color}">${p.voto ? '✓' : esc(String(p.mesa || '–').replace(/^0+/, '') || '–')}</div>
          <div class="grow" style="min-width:0">
            <div class="mapa-dir">${esc(p.domicilio || 'Sin domicilio')}${p.geo?.src === 'gps' ? ' <span title="Ubicada desde su casa" style="color:var(--accent)">✓</span>' : ''}</div>
            <div class="muted">${esc(p.nombre)}</div>
            <div class="muted small">${p.mesa ? `Mesa ${esc(p.mesa)} · ` : ''}${esc(p.escuela || '')}</div>
            <div class="small" style="margin-top:2px"><span style="color:${g.color};font-weight:700">●</span> de ${esc(p.ownerNombre || g.u.nombre)}${p.voto ? ' · <b style="color:var(--accent)">ya votó</b>' : ''}</div>
            ${afuera ? `<div class="small" style="color:#DC2626;font-weight:600">Lejos del resto de la zona de ${esc(primer(g.u.nombre))}</div>` : ''}
          </div>
          <button type="button" class="mapa-ib chico" data-m="soltar" aria-label="Cerrar">${ic('x', 18)}</button>
        </div>
        <div class="row" style="gap:8px;margin-top:12px">
          ${api.verFicha ? `<button type="button" class="btn btn-sec btn-sm grow" data-m="ficha">Ver ficha</button>` : ''}
          ${p.domicilio ? `<a class="btn btn-sm grow" href="${casaUrl(p.domicilio)}" target="_blank" rel="noopener">Ir a su casa</a>` : ''}
        </div>`;
      return;
    }
    const sinUbicar = ps.filter((p) => !conGeo(p) && !(p.geo && p.geo.no) && (p.domicilio || '').trim().length >= 4);
    const noSe = ps.filter((p) => p.geo && p.geo.no).length;
    const sinDom = ps.filter((p) => !conGeo(p) && !(p.domicilio || '').trim()).length;
    const fueraTot = gs.reduce((a, g) => a + g.fueraSet.size, 0);
    const filas = gs.map((g, i) => `
      <button type="button" class="mapa-fila" data-m="entrar" data-i="${i}" ${puedeEntrar(g) ? '' : 'disabled'}>
        <i style="background:${g.color}${g.propio ? ';background:transparent;outline:2px dashed ' + g.color + ';outline-offset:-2px' : ''}"></i>
        <span class="grow" style="min-width:0"><b>${esc(g.propio ? (gs.length > 1 ? 'Cargadas directo' : g.u.nombre) : g.u.nombre)}</b> <span class="muted small">${g.propio ? '' : ROL[g.u.rol] || ''}</span>
          <span class="muted small" style="display:block">${g.ps.length} ${g.ps.length === 1 ? 'persona' : 'personas'} · ${g.pts.length} en el mapa${g.votaron ? ` · ${g.votaron} votaron` : ''}${g.fueraSet.size ? ` · <b style="color:#DC2626">${g.fueraSet.size} fuera de zona</b>` : ''}</span></span>
        ${puedeEntrar(g) ? '<span class="chev" aria-hidden="true">›</span>' : ''}
      </button>`);
    const ubicar = sinUbicar.length ? `<div class="row" style="gap:8px;align-items:center"><span class="grow small"><b>${sinUbicar.length}</b> ${sinUbicar.length === 1 ? 'dirección todavía no está' : 'direcciones todavía no están'} en el mapa</span>
        <button type="button" class="btn btn-sm" data-m="ubicar" ${ubicando ? 'disabled' : ''}>${ubicando ? 'Ubicando…' : 'Ubicarlas'}</button></div><div id="m-prog" class="muted small"></div>` : '';
    if (!listaAbierta) {
      // resumen corto: las zonas como chips que se tocan para entrar
      card.className = 'mapa-card';
      card.innerHTML = `
        <div class="mapa-chips">${gs.map((g, i) => `<button type="button" class="mapa-chip" data-m="entrar" data-i="${i}" ${puedeEntrar(g) ? '' : 'disabled'}><i style="background:${g.color}"></i>${esc(g.propio ? (gs.length > 1 ? 'Directas' : primer(g.u.nombre)) : primer(g.u.nombre))} <b>${g.ps.length}</b></button>`).join('')}</div>
        ${fueraTot ? `<div class="small" style="margin-top:8px">Pines con <b style="color:#DC2626">borde rojo</b>: ${fueraTot} lejos de su zona.</div>` : ''}
        ${ubicar ? `<div style="margin-top:10px">${ubicar}</div>` : ''}`;
      return;
    }
    card.className = 'mapa-card abierta';
    card.innerHTML = `
      <div class="row" style="align-items:center"><b class="grow">Zonas</b><button type="button" class="mapa-ib chico" data-m="lista" aria-label="Cerrar lista">${ic('x', 18)}</button></div>
      <div class="mapa-ley">${filas.join('')}</div>
      ${fueraTot ? `<div class="muted small">Los pines con <b style="color:#DC2626">borde rojo</b> están lejos del resto de su zona: puede ser una dirección mal escrita o alguien de otro barrio.</div>` : ''}
      ${ubicar}
      ${noSe || sinDom ? `<div class="muted small">${noSe ? `${noSe} con una dirección que el mapa no encontró. ` : ''}${sinDom ? `${sinDom} sin domicilio. ` : ''}Se corrige en la ficha de la persona, o con <b>Estoy en su casa</b> cuando la visitan.</div>` : ''}
      <div class="muted small">El número de cada pin es su mesa. ✓ = ya votó.</div>`;
  }

  async function ubicarTodas() {
    if (!ultimo) return;
    const lista = ultimo.ps.filter((p) => !conGeo(p) && !(p.geo && p.geo.no) && (p.domicilio || '').trim().length >= 4);
    ubicando = true; cancelar = false;
    const prog = () => fondo.querySelector('#m-prog');
    const btn = fondo.querySelector('[data-m=ubicar]'); if (btn) { btn.disabled = true; btn.textContent = 'Ubicando…'; }
    const max = Math.min(lista.length, 400);
    let ok = 0; let no = 0;
    for (let i = 0; i < max && !cancelar; i++) {
      const p = lista[i];
      const enCache = limpiarDom(p.domicilio) in cacheGeo;
      try {
        const g = await ubicar(p.domicilio);
        const geo = g || { no: true };
        await api.guardarGeo(p.dni, geo);
        p.geo = geo; if (g) ok++; else no++;
      } catch (e) { const x = prog(); if (x) x.textContent = e.message; break; }
      const x = prog(); if (x) x.textContent = `Ubicando ${i + 1} de ${max}… (${ok} en el mapa${no ? `, ${no} no encontradas` : ''})`;
      if (!enCache) await new Promise((r) => setTimeout(r, 1100));
    }
    ubicando = false;
    if (!cancelar) { cachePorNodo.clear(); await pintar(); api.toast(`Listo: ${ok} ${ok === 1 ? 'dirección ubicada' : 'direcciones ubicadas'}${no ? ` · ${no} no se encontraron` : ''}`); }
  }

  function miUbicacion() {
    if (!navigator.geolocation) { api.toast('Este teléfono no tiene GPS disponible'); return; }
    navigator.geolocation.getCurrentPosition((pos) => {
      const ll = [pos.coords.latitude, pos.coords.longitude];
      capaYo.clearLayers();
      window.L.circle(ll, { radius: Math.min(pos.coords.accuracy, 300), color: '#2563EB', weight: 0, fillOpacity: 0.12 }).addTo(capaYo);
      window.L.circleMarker(ll, { radius: 8, color: '#fff', weight: 3, fillColor: '#2563EB', fillOpacity: 1 }).addTo(capaYo);
      mapa.setView(ll, Math.max(mapa.getZoom(), 16));
    }, () => api.toast('No se pudo usar el GPS. Revisá el permiso de ubicación.'), { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  }

  fondo.addEventListener('click', (e) => {
    const b = e.target.closest('[data-m]'); if (!b) return;
    const a = b.dataset.m;
    if (a === 'cerrar') cerrar(true);
    else if (a === 'atras') { if (pila.length > 1) { pila.pop(); pintar(); } }
    else if (a === 'miga') { pila.length = +b.dataset.i + 1; pintar(); }
    else if (a === 'entrar') { const g = ultimo?.gs[+b.dataset.i]; if (g && puedeEntrar(g)) { pila.push(g.u.uid); pintar(); } }
    else if (a === 'lista') { elegido = null; listaAbierta = !listaAbierta; dibujar(); }
    else if (a === 'soltar') { elegido = null; dibujar(); }
    else if (a === 'ficha') { if (elegido) api.verFicha(elegido.p); }
    else if (a === 'yo') miUbicacion();
    else if (a === 'ubicar') ubicarTodas();
  });

  try {
    const L = await leaflet();
    const el = fondo.querySelector('#m-mapa'); el.innerHTML = '';
    mapa = L.map(el, { zoomControl: false, attributionControl: true }).setView(CENTRO, 13);
    // Mapa base claro (CARTO Voyager, datos de OpenStreetMap): calles y barrios con nombre, deja resaltar pines y zonas
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { maxZoom: 19, subdomains: 'abcd', attribution: '© OpenStreetMap · © CARTO' }).addTo(mapa);
    capa = L.layerGroup().addTo(mapa);
    capaYo = L.layerGroup().addTo(mapa);
    mapa.on('click', () => { if (elegido) { elegido = null; dibujar(); } });
    await pintar();
  } catch (e) {
    fondo.querySelector('#m-mapa').innerHTML = `<div class="vacio" style="padding-top:30%">${esc(e.message || 'No se pudo abrir el mapa')}</div>`;
  }
}
