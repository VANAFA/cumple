/* Cumple · ¿cómo llegamos?  —  lógica de la página
   Mapa: Leaflet + OpenStreetMap · Caminos: OSRM (demo público) · Datos compartidos: Firestore (proyecto nallibar, el de nallib.ar) */

const CFG = window.CUMPLE_CONFIG;
const FIESTA = { lat: CFG.fiesta.lat, lng: CFG.fiesta.lng, label: CFG.fiesta.nombre };
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// =====================================================================
//  Almacenamiento: Firebase si está configurado, si no localStorage
// =====================================================================
class LocalStore {
  constructor() {
    this.key = "cumple-invitados";
    this.cbs = [];
    window.addEventListener("storage", (e) => { if (e.key === this.key) this.emit(); });
  }
  read() { try { return JSON.parse(localStorage.getItem(this.key)) || {}; } catch { return {}; } }
  write(d) { localStorage.setItem(this.key, JSON.stringify(d)); this.emit(); }
  emit() { const d = this.read(); this.cbs.forEach((cb) => cb(d)); }
  subscribe(cb) { this.cbs.push(cb); cb(this.read()); }
  async save(g) { const d = this.read(); d[g.id] = g; this.write(d); }
  async update(id, patch) { const d = this.read(); if (d[id]) { Object.assign(d[id], patch); this.write(d); } }
  async remove(id) { const d = this.read(); delete d[id]; this.write(d); }
}

class FirestoreStore {
  // Mismo proyecto Firebase que nallib.ar (Firestore, plan Spark). La config es un
  // identificador público; lo que protege son las reglas (firestore.rules del repo portfolio).
  static async create(cfg, coleccion) {
    const v = "10.14.1";
    const [{ initializeApp }, fs] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${v}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${v}/firebase-firestore.js`),
    ]);
    const s = new FirestoreStore();
    s.fs = fs;
    s.db = fs.getFirestore(initializeApp(cfg));
    s.col = coleccion;
    return s;
  }
  doc(id) { return this.fs.doc(this.db, this.col, id); }
  subscribe(cb) {
    this.fs.onSnapshot(this.fs.collection(this.db, this.col), (snap) => {
      const d = {}; snap.forEach((x) => { d[x.id] = x.data(); });
      setStatus("on", "Conectado"); cb(d);
    }, (err) => setStatus("err", "Error de conexión: " + err.message));
  }
  save(g) { return this.fs.setDoc(this.doc(g.id), g); }
  update(id, patch) { return this.fs.updateDoc(this.doc(id), patch); }
  remove(id) { return this.fs.deleteDoc(this.doc(id)); }
}

function setStatus(cls, title) { const el = $("#status"); el.className = "status " + cls; el.title = title; }

// =====================================================================
//  Rutas (OSRM)
// =====================================================================
const cacheOSRM = new Map();
let enCurso = 0; const cola = [];
function limitar(fn) { return new Promise((res, rej) => { cola.push({ fn, res, rej }); bombear(); }); }
function bombear() {
  while (enCurso < 3 && cola.length) {
    const { fn, res, rej } = cola.shift();
    enCurso++;
    fn().then(res, rej).finally(() => { enCurso--; bombear(); });
  }
}
function osrm(servicio, puntos, params) {
  const coords = puntos.map((p) => `${p.lng},${p.lat}`).join(";");
  const url = `https://router.project-osrm.org/${servicio}/v1/driving/${coords}?` + new URLSearchParams(params);
  if (cacheOSRM.has(url)) return cacheOSRM.get(url);
  const p = limitar(() => fetch(url).then((r) => r.json())).then((j) => {
    if (j.code !== "Ok") throw new Error(j.message || j.code);
    return j;
  });
  cacheOSRM.set(url, p);
  p.catch(() => cacheOSRM.delete(url));
  return p;
}
async function ruta(puntos) {
  const j = await osrm("route", puntos, { overview: "full", geometries: "geojson" });
  const r = j.routes[0];
  return { duracion: r.duration, distancia: r.distance, geo: r.geometry, orden: puntos };
}
// Viaje con paradas intermedias en el orden óptimo (origen y destino fijos)
async function viaje(origen, paradas, destino) {
  if (paradas.length <= 1) return ruta([origen, ...paradas, destino]);
  const puntos = [origen, ...paradas, destino];
  const j = await osrm("trip", puntos, { source: "first", destination: "last", roundtrip: "false", overview: "full", geometries: "geojson" });
  const t = j.trips[0];
  const orden = j.waypoints.map((w, i) => ({ i, k: w.waypoint_index })).sort((a, b) => a.k - b.k).map((x) => puntos[x.i]);
  return { duracion: t.duration, distancia: t.distance, geo: t.geometry, orden };
}
// Cuánto más tarda un conductor si pasa a buscar a alguien, respecto a ir directo
async function desvio(origenConductor, puntoInvitado) {
  const [directo, via] = await Promise.all([ruta([origenConductor, FIESTA]), ruta([origenConductor, puntoInvitado, FIESTA])]);
  return { extraMin: Math.max(0, (via.duracion - directo.duracion) / 60), extraKm: Math.max(0, (via.distancia - directo.distancia) / 1000) };
}
const fmtMin = (s) => { const m = Math.round(s / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };
const fmtKm = (m) => (m / 1000).toFixed(m < 10000 ? 1 : 0) + " km";
function linkGoogleMaps(origen, paradas, destino) {
  const q = new URLSearchParams({ api: "1", origin: `${origen.lat},${origen.lng}`, destination: `${destino.lat},${destino.lng}`, travelmode: "driving" });
  if (paradas.length) q.set("waypoints", paradas.map((p) => `${p.lat},${p.lng}`).join("|"));
  return "https://www.google.com/maps/dir/?" + q;
}

// =====================================================================
//  Geocodificación (Nominatim)
// =====================================================================
const nominatim = (path, params) =>
  fetch(`https://nominatim.openstreetmap.org/${path}?` + new URLSearchParams({ format: "jsonv2", "accept-language": "es", ...params })).then((r) => r.json());
const etiqueta = (r) => (r.display_name || "").split(",").slice(0, 3).map((s) => s.trim()).join(", ");
async function buscarDireccion(q) {
  return nominatim("search", { q, limit: 6, countrycodes: CFG.pais || "", viewbox: `${FIESTA.lng - 1},${FIESTA.lat + 1},${FIESTA.lng + 1},${FIESTA.lat - 1}` });
}
async function nombreDePunto(lat, lng) {
  try { const r = await nominatim("reverse", { lat, lon: lng, zoom: 16 }); return etiqueta(r) || `${lat.toFixed(4)}, ${lng.toFixed(4)}`; }
  catch { return `${lat.toFixed(4)}, ${lng.toFixed(4)}`; }
}

// =====================================================================
//  Mapa
// =====================================================================
const map = L.map("mapa").setView([FIESTA.lat, FIESTA.lng], 12);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19, attribution: "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a>",
}).addTo(map);
const icono = (clase, emoji = "") => L.divIcon({ className: "", html: `<div class="mk ${clase}">${emoji}</div>`, iconSize: clase.includes("fiesta") ? [34, 34] : [26, 26], iconAnchor: clase.includes("fiesta") ? [17, 17] : [13, 13], popupAnchor: [0, -16] });
const iconoFiesta = L.divIcon({ className: "", html: '<div class="cabeza"><img src="images/cabeza.png?v=2" alt="La fiesta"></div>', iconSize: [72, 72], iconAnchor: [36, 36], popupAnchor: [0, -30] });
L.marker([FIESTA.lat, FIESTA.lng], { icon: iconoFiesta, zIndexOffset: 1000 }).addTo(map)
  .bindPopup(`<b>${esc(CFG.fiesta.nombre)}</b><br>${esc(CFG.fiesta.direccion)}<br>${esc(CFG.fecha)} · ${esc(CFG.hora)}`);
const capaInvitados = L.layerGroup().addTo(map);
const capaRuta = L.layerGroup().addTo(map);
let marcadorTemp = null;

// =====================================================================
//  Estado
// =====================================================================
let store;
let invitados = {};
let myId = localStorage.getItem("cumple-yo") || null;
let modoForm = "nuevo";          // "nuevo" | "editar"
let origenForm = null;           // {lat,lng,label}
let idsVistos = "";              // para hacer fit del mapa cuando cambia la gente
let claveRuta = "";              // para no recalcular rutas si no cambió nada
let borrarArmado = false;

const nombreDe = (g) => g.nombre || "Invitado " + g.id.slice(-4).toUpperCase();
const pasajerosDe = (g) => (Array.isArray(g.pasajeros) ? g.pasajeros : Object.values(g.pasajeros || {})).filter((id) => invitados[id]);
const conductores = () => Object.values(invitados).filter((g) => g.auto).sort((a, b) => (a.creado || 0) - (b.creado || 0));
const sinAuto = () => Object.values(invitados).filter((g) => !g.auto);
const conductorDe = (id) => conductores().find((c) => pasajerosDe(c).includes(id)) || null;
const libres = (c) => Math.max(0, (c.lugares || 0) - pasajerosDe(c).length);
const descAuto = (c) => [c.vehiculo, c.color, c.patente].filter(Boolean).join(" · ");

// =====================================================================
//  Formulario
// =====================================================================
const form = $("#form");
function setOrigen(o) {
  origenForm = o;
  form.lat.value = o.lat; form.lng.value = o.lng; form.label.value = o.label;
  $("#origen-label").textContent = "📍 " + o.label;
  $("#origen-label").classList.add("ok");
  if (marcadorTemp) marcadorTemp.setLatLng([o.lat, o.lng]);
  else marcadorTemp = L.marker([o.lat, o.lng], { icon: icono("temp", "•"), zIndexOffset: 900 }).addTo(map);
  map.panTo([o.lat, o.lng]);
}
function limpiarOrigen() {
  origenForm = null;
  $("#origen-label").textContent = "Todavía no elegiste un punto.";
  $("#origen-label").classList.remove("ok");
  if (marcadorTemp) { map.removeLayer(marcadorTemp); marcadorTemp = null; }
}
map.on("click", async (e) => {
  if (form.hidden) return;
  const { lat, lng } = e.latlng;
  setOrigen({ lat, lng, label: "Buscando nombre…" });
  setOrigen({ lat, lng, label: await nombreDePunto(lat, lng) });
});
async function buscar() {
  const q = $("#buscar").value.trim();
  const ul = $("#resultados");
  if (!q) return;
  ul.hidden = false; ul.innerHTML = "<li>Buscando…</li>";
  try {
    const rs = await buscarDireccion(q);
    ul.innerHTML = rs.length ? "" : "<li>No encontré nada. Probá con más detalle o tocá el mapa.</li>";
    rs.forEach((r) => {
      const li = document.createElement("li");
      li.textContent = etiqueta(r);
      li.onclick = () => { setOrigen({ lat: +r.lat, lng: +r.lon, label: etiqueta(r) }); ul.hidden = true; map.setView([+r.lat, +r.lon], 15); };
      ul.appendChild(li);
    });
  } catch { ul.innerHTML = "<li>No pude buscar. Tocá el punto en el mapa.</li>"; }
}
$("#btn-buscar").onclick = buscar;
$("#buscar").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); buscar(); } });
$("#btn-gps").onclick = () => {
  if (!navigator.geolocation) return mostrarError("Tu navegador no permite ubicación.");
  $("#btn-gps").disabled = true;
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const { latitude: lat, longitude: lng } = pos.coords;
    setOrigen({ lat, lng, label: "Mi ubicación" });
    map.setView([lat, lng], 15);
    setOrigen({ lat, lng, label: await nombreDePunto(lat, lng) });
    $("#btn-gps").disabled = false;
  }, () => { mostrarError("No pude obtener tu ubicación. Buscá la dirección o tocá el mapa."); $("#btn-gps").disabled = false; }, { enableHighAccuracy: true, timeout: 10000 });
};
form.auto.forEach((r) => r.addEventListener("change", () => { $("#auto-campos").hidden = form.auto.value !== "si"; }));
function mostrarError(msg) { const el = $("#form-error"); el.textContent = msg; el.hidden = !msg; }

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!origenForm) return mostrarError("Falta elegir de dónde salís: buscá la dirección, usá tu ubicación o tocá el mapa.");
  mostrarError("");
  const previo = (modoForm === "editar" && invitados[myId]) || null;
  const auto = form.auto.value === "si";
  const g = {
    id: previo ? previo.id : (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)),
    nombre: form.nombre.value.trim(),
    origen: { lat: origenForm.lat, lng: origenForm.lng, label: origenForm.label },
    auto,
    lugares: auto ? Math.max(0, parseInt(form.lugares.value, 10) || 0) : 0,
    vehiculo: auto ? form.vehiculo.value.trim() : "",
    color: auto ? form.color.value.trim() : "",
    patente: auto ? form.patente.value.trim().toUpperCase() : "",
    horaSalida: form.horaSalida.value,
    contacto: form.contacto.value.trim(),
    pasajeros: auto && previo ? pasajerosDe(previo) : [],
    creado: previo ? previo.creado : Date.now(),
    actualizado: Date.now(),
  };
  try {
    await store.save(g);
    myId = g.id; localStorage.setItem("cumple-yo", myId);
    modoForm = "nuevo"; limpiarOrigen(); claveRuta = "";
    render();
  } catch (err) { mostrarError("No pude guardar: " + err.message); }
});
$("#btn-cancelar").onclick = () => { modoForm = "nuevo"; limpiarOrigen(); render(); };
$("#btn-editar").onclick = () => {
  const g = invitados[myId]; if (!g) return;
  modoForm = "editar";
  form.nombre.value = g.nombre || "";
  form.auto.value = g.auto ? "si" : "no"; $("#auto-campos").hidden = !g.auto;
  form.lugares.value = g.lugares ?? 3; form.vehiculo.value = g.vehiculo || ""; form.color.value = g.color || ""; form.patente.value = g.patente || "";
  form.horaSalida.value = g.horaSalida || ""; form.contacto.value = g.contacto || "";
  setOrigen({ ...g.origen });
  render();
};
$("#btn-borrar").onclick = async () => {
  if (!borrarArmado) { borrarArmado = true; $("#btn-borrar").textContent = "¿Seguro? Sí, borrar"; setTimeout(() => { borrarArmado = false; $("#btn-borrar").textContent = "Borrar"; }, 4000); return; }
  borrarArmado = false; $("#btn-borrar").textContent = "Borrar";
  const id = myId;
  // sacarme de cualquier combo
  for (const c of conductores()) if (pasajerosDe(c).includes(id)) await store.update(c.id, { pasajeros: pasajerosDe(c).filter((x) => x !== id) });
  await store.remove(id);
  myId = null; localStorage.removeItem("cumple-yo"); claveRuta = "";
  render();
};

// =====================================================================
//  Vista principal
// =====================================================================
function render() {
  const yo = myId ? invitados[myId] : null;
  if (myId && !yo && Object.keys(invitados).length && modoForm !== "editar") { myId = null; localStorage.removeItem("cumple-yo"); }
  const verForm = !yo || modoForm === "editar";
  form.hidden = !verForm; $("#vista").hidden = verForm;
  $("#form-titulo").textContent = modoForm === "editar" ? "Editar mis datos" : "Sumate 🎉";
  $("#btn-cancelar").hidden = modoForm !== "editar";
  renderMarcadores(yo);
  renderLista(yo);
  if (yo && !verForm) { renderYo(yo); renderRutas(yo); }
  else capaRuta.clearLayers();
}

function renderMarcadores(yo) {
  capaInvitados.clearLayers();
  const todos = Object.values(invitados);
  for (const g of todos) {
    const clase = (g.auto ? "auto" : "sinauto") + (yo && g.id === yo.id ? " yo" : "");
    const c = !g.auto && conductorDe(g.id);
    L.marker([g.origen.lat, g.origen.lng], { icon: icono(clase, g.auto ? "🚗" : "") }).addTo(capaInvitados).bindPopup(
      `<b>${esc(nombreDe(g))}</b>${yo && g.id === yo.id ? " (vos)" : ""}<br>${esc(g.origen.label)}` +
      (g.auto ? `<br>🚗 ${esc(descAuto(g)) || "Auto"} · ${libres(g)} lugar${libres(g) === 1 ? "" : "es"} libre${libres(g) === 1 ? "" : "s"}` : c ? `<br>Lo busca ${esc(nombreDe(c))}` : "<br>Sin auto") +
      (g.horaSalida ? `<br>Sale ${esc(g.horaSalida)}` : "") + (g.contacto ? `<br>${esc(g.contacto)}` : ""));
  }
  const ids = todos.map((g) => g.id).sort().join(",");
  if (ids !== idsVistos) {
    idsVistos = ids;
    const b = L.latLngBounds([[FIESTA.lat, FIESTA.lng], ...todos.map((g) => [g.origen.lat, g.origen.lng])]);
    map.fitBounds(b.pad(0.2), { maxZoom: 14 });
  }
}

function renderLista(yo) {
  const todos = Object.values(invitados).sort((a, b) => (a.auto === b.auto ? (a.creado || 0) - (b.creado || 0) : a.auto ? -1 : 1));
  $("#contador").textContent = todos.length;
  $("#lista").innerHTML = todos.map((g) => {
    const c = !g.auto && conductorDe(g.id);
    const sub = g.auto
      ? `${descAuto(g) || "Auto"} · ${libres(g)} libre${libres(g) === 1 ? "" : "s"}${pasajerosDe(g).length ? " · lleva a " + pasajerosDe(g).map((id) => nombreDe(invitados[id])).join(", ") : ""}`
      : c ? `Lo busca ${nombreDe(c)}` : "Busca quien lo lleve";
    return `<li class="${yo && g.id === yo.id ? "yo" : ""}"><i class="dot ${g.auto ? "auto" : "sinauto"}"></i>
      <div class="info">${esc(nombreDe(g))}${yo && g.id === yo.id ? " (vos)" : ""}${g.horaSalida ? ` <span class="tag">sale ${esc(g.horaSalida)}</span>` : ""}
      <small>${esc(g.origen.label)} — ${esc(sub)}</small></div></li>`;
  }).join("") || "<li class='hint'>Todavía no hay nadie. ¡Sos el primero!</li>";
}

function renderYo(yo) {
  $("#yo-nombre").textContent = nombreDe(yo) + " (vos)";
  $("#yo-detalle").textContent = `Salís de ${yo.origen.label}` + (yo.auto ? ` · 🚗 ${descAuto(yo) || "con auto"} · ${yo.lugares} lugar${yo.lugares === 1 ? "" : "es"}` : " · sin auto") + (yo.horaSalida ? ` · ${yo.horaSalida}` : "");
}

async function renderRutas(yo) {
  const conductor = yo.auto ? yo : conductorDe(yo.id);
  const otros = yo.auto ? sinAuto() : conductores();
  const clave = JSON.stringify([yo.id, yo.origen, conductor && [conductor.id, conductor.origen, pasajerosDe(conductor)], otros.map((g) => [g.id, g.origen, g.lugares, pasajerosDe(g)])]);
  if (clave === claveRuta) return;
  claveRuta = clave;
  capaRuta.clearLayers();
  $("#gmaps").hidden = true; $("#combo").innerHTML = "";
  $("#ruta-resumen").textContent = "Calculando…";

  // ---- camino principal: el del conductor (yo, o quien me busca) ----
  try {
    const base = conductor || yo;
    const paradas = conductor ? pasajerosDe(conductor).map((id) => invitados[id]) : [];
    const v = await viaje(base.origen, paradas.map((p) => ({ ...p.origen, id: p.id })), FIESTA);
    if (claveRuta !== clave) return;
    L.geoJSON(v.geo, { style: { color: "#7c5cff", weight: 5, opacity: 0.85 } }).addTo(capaRuta);
    const paradasOrdenadas = v.orden.slice(1, -1).map((p) => invitados[p.id]);
    $("#ruta-resumen").innerHTML = (conductor && !yo.auto ? `Te busca <b>${esc(nombreDe(conductor))}</b> (${esc(descAuto(conductor)) || "auto"}${conductor.horaSalida ? ", sale " + esc(conductor.horaSalida) : ""}${conductor.contacto ? ", " + esc(conductor.contacto) : ""}). Su camino: ` : yo.auto ? "" : "Nadie te busca todavía. Si fueras en auto, serían ")
      + `<b>${fmtMin(v.duracion)}</b> · ${fmtKm(v.distancia)}`;
    $("#combo").innerHTML = [base, ...paradasOrdenadas].map((p, i) => `<div class="combo-item"><span>${i + 1}. ${esc(nombreDe(p))}${p.id === yo.id ? " (vos)" : ""}</span><span class="n">${esc(p.origen.label)}</span></div>`).join("")
      + `<div class="combo-item"><span>${paradasOrdenadas.length + 2}. 🎉 ${esc(CFG.fiesta.nombre)}</span><span class="n">${esc(CFG.fiesta.direccion)}</span></div>`;
    const a = $("#gmaps"); a.href = linkGoogleMaps(base.origen, paradasOrdenadas.map((p) => p.origen), FIESTA); a.hidden = false;
  } catch (err) { if (claveRuta === clave) $("#ruta-resumen").textContent = "No pude calcular el camino (" + err.message + "). Reintentá en un rato."; }

  // ---- sugerencias ----
  const ul = $("#sugerencias");
  if (yo.auto) {
    $("#sug-titulo").textContent = "¿A quién te queda de pasada buscar?";
    $("#sug-hint").textContent = `Minutos extra respecto a ir directo. Tenés ${libres(yo)} lugar${libres(yo) === 1 ? "" : "es"} libre${libres(yo) === 1 ? "" : "s"}. Marcá a quién llevás y se arma el combo.`;
    const cand = sinAuto();
    if (!cand.length) { ul.innerHTML = "<li class='hint'>Por ahora nadie necesita que lo busquen.</li>"; return; }
    ul.innerHTML = cand.map((g) => `<li data-id="${g.id}"><input type="checkbox" disabled><div class="info">${esc(nombreDe(g))}<small>${esc(g.origen.label)}</small></div><span class="extra">…</span></li>`).join("");
    const res = await Promise.all(cand.map((g) => desvio(yo.origen, g.origen).then((d) => ({ g, d })).catch(() => ({ g, d: null }))));
    if (claveRuta !== clave) return;
    res.sort((a, b) => (a.d?.extraMin ?? 1e9) - (b.d?.extraMin ?? 1e9));
    ul.innerHTML = res.map(({ g, d }) => {
      const mio = pasajerosDe(yo).includes(g.id);
      const otro = !mio && conductorDe(g.id);
      const lleno = !mio && libres(yo) <= 0;
      const cls = !d ? "" : d.extraMin <= CFG.desvioMaxMin ? "ok" : "meh";
      return `<li class="${otro ? "taken" : ""}" data-id="${g.id}"><input type="checkbox" ${mio ? "checked" : ""} ${otro || lleno ? "disabled" : ""}>
        <div class="info">${esc(nombreDe(g))} ${otro ? `<span class="tag">lo busca ${esc(nombreDe(otro))}</span>` : mio ? `<span class="tag ok">en tu combo</span>` : lleno ? `<span class="tag">sin lugar</span>` : ""}
        <small>${esc(g.origen.label)}${g.horaSalida ? " · sale " + esc(g.horaSalida) : ""}${g.contacto ? " · " + esc(g.contacto) : ""}</small></div>
        <span class="extra ${cls}">${d ? `+${Math.round(d.extraMin)} min · +${d.extraKm.toFixed(1)} km` : "sin dato"}</span></li>`;
    }).join("");
    ul.querySelectorAll("input[type=checkbox]").forEach((cb) => cb.addEventListener("change", async () => {
      const id = cb.closest("li").dataset.id;
      const actual = pasajerosDe(yo);
      const nuevo = cb.checked ? [...new Set([...actual, id])] : actual.filter((x) => x !== id);
      cb.disabled = true;
      await store.update(yo.id, { pasajeros: nuevo, actualizado: Date.now() });
    }));
  } else {
    $("#sug-titulo").textContent = "¿A quién le quedás de pasada?";
    $("#sug-hint").textContent = `Conductores a los que les cuesta poco pasar a buscarte (minutos extra respecto a su camino directo). Hablales para que te marquen en su combo.`;
    const cand = conductores();
    if (!cand.length) { ul.innerHTML = "<li class='hint'>Todavía no hay nadie con auto.</li>"; return; }
    ul.innerHTML = cand.map((c) => `<li data-id="${c.id}"><i class="dot auto"></i><div class="info">${esc(nombreDe(c))}<small>${esc(c.origen.label)}</small></div><span class="extra">…</span></li>`).join("");
    const res = await Promise.all(cand.map((c) => desvio(c.origen, yo.origen).then((d) => ({ c, d })).catch(() => ({ c, d: null }))));
    if (claveRuta !== clave) return;
    res.sort((a, b) => (a.d?.extraMin ?? 1e9) - (b.d?.extraMin ?? 1e9));
    ul.innerHTML = res.map(({ c, d }) => {
      const meLleva = pasajerosDe(c).includes(yo.id);
      const lleno = !meLleva && libres(c) <= 0;
      const cls = !d ? "" : d.extraMin <= CFG.desvioMaxMin ? "ok" : "meh";
      return `<li class="${lleno ? "taken" : ""}"><i class="dot auto"></i>
        <div class="info">${esc(nombreDe(c))} ${meLleva ? `<span class="tag ok">te busca</span>` : lleno ? `<span class="tag">completo</span>` : `<span class="tag">${libres(c)} libre${libres(c) === 1 ? "" : "s"}</span>`}
        <small>${esc(c.origen.label)} · ${esc(descAuto(c)) || "auto"}${c.horaSalida ? " · sale " + esc(c.horaSalida) : ""}${c.contacto ? " · " + esc(c.contacto) : ""}</small></div>
        <span class="extra ${cls}">${d ? `+${Math.round(d.extraMin)} min` : "sin dato"}</span></li>`;
    }).join("");
  }
}

// =====================================================================
//  Arranque
// =====================================================================
(async function init() {
  $("#titulo").textContent = CFG.titulo; document.title = CFG.titulo + " · ¿cómo llegamos?";
  $("#fecha").textContent = CFG.fecha; $("#hora").textContent = CFG.hora;
  $("#fiesta-nombre").textContent = CFG.fiesta.nombre;
  $("#fiesta-dir").textContent = CFG.fiesta.direccion === "COMPLETAR DIRECCIÓN" ? "⚠️ falta cargar la dirección en js/config.js" : CFG.fiesta.direccion;
  const forzarLocal = new URLSearchParams(location.search).has("local");
  try {
    if (CFG.firebase && !forzarLocal) { setStatus("", "Conectando…"); store = await FirestoreStore.create(CFG.firebase, CFG.coleccion || "cumple_invitados"); }
    else {
      store = new LocalStore();
      setStatus("local", "Modo local: los datos quedan solo en este navegador");
      $("#form").insertAdjacentHTML("afterbegin", "<p class='hint' style='color:var(--auto)'>⚠️ Modo prueba: lo que cargues queda solo en este navegador.</p>");
    }
  } catch (err) { setStatus("err", "No pude conectar: " + err.message); store = new LocalStore(); }
  store.subscribe((data) => { invitados = data || {}; render(); });
})();
