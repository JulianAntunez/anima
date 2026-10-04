import { probabilidades, promediar, ganadora, reposoDesdeMuestras } from "./emotion.js";
import { animoDe, tonoDe, TONOS } from "./mood.js";
import { Sesion } from "./sesion.js";
import { LocalStore, SupabaseStore, resumir, porHora, aCSV } from "./store.js";
import { CONFIG } from "./config.js";

const $ = (id) => document.getElementById(id);
const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

let cliente = null;
let usuario = null;

const VENTANA = 4;
const MS_ENTRE_LECTURAS = 80;
const MEDIAPIPE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

const estado = {
  modo: null, // "camara" | "demo"
  pausado: false,
  store: null,
  sesion: new Sesion(),
  datos: { registros: [], episodios: [] },
  reposo: null,
  neutralBias: 0.6,
  historial: [],
  linea: [],
  calibrando: null,
  landmarker: null,
  stream: null,
  rafId: null,
  demoTimer: null,
  ultimaLectura: 0,
  ultimoVideoTime: -1,
};

try {
  estado.reposo = JSON.parse(localStorage.getItem("reposo") || "null");
} catch {
  estado.reposo = null;
}

/* ---------- utilidades de interfaz ---------- */

let toastTimer = null;
function aviso(texto, ms = 3000) {
  const el = $("toast");
  el.textContent = texto;
  el.hidden = false;
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(() => (el.hidden = true), ms);
}

const mmss = (ms) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const hhmm = (ts) => new Date(ts).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });

function setEstado(texto, clase = "") {
  $("estado-texto").textContent = texto;
  $("punto").className = `punto ${clase}`;
}

/* ---------- render ---------- */

function renderFoco(lectura, caja) {
  const animo = animoDe(lectura ? lectura.emocion : "ninguno");
  const tono = animo.tono;
  $("animo").className = `animo tono-${tono}`;
  $("animo-nombre").textContent = animo.nombre;
  $("sugerencia").textContent = animo.sugerencia;
  $("conf-barra").style.width = lectura ? `${Math.round(lectura.confianza * 100)}%` : "0%";
  $("conf-texto").textContent = lectura ? `Confianza ${Math.round(lectura.confianza * 100)}%` : " ";

  const el = $("caja");
  if (caja) {
    el.hidden = false;
    el.className = `caja tono-${tono}`;
    el.style.left = `${caja.x * 100}%`;
    el.style.top = `${caja.y * 100}%`;
    el.style.width = `${caja.w * 100}%`;
    el.style.height = `${caja.h * 100}%`;
    $("chip").textContent = `${animo.nombre}${lectura ? ` · ${Math.round(lectura.confianza * 100)}%` : ""}`;
  } else {
    el.hidden = true;
  }
}

function renderLinea() {
  const ahora = Date.now();
  const desde = ahora - 120000;
  const cont = $("linea");
  const tramos = estado.linea.filter((p) => p.ts >= desde - 30000);
  if (!tramos.length) {
    cont.innerHTML = "";
    return;
  }
  let html = "";
  for (let i = 0; i < tramos.length; i++) {
    const ini = Math.max(tramos[i].ts, desde);
    const fin = i + 1 < tramos.length ? tramos[i + 1].ts : ahora;
    if (fin <= desde) continue;
    const ancho = ((fin - ini) / 120000) * 100;
    const t = tramos[i].emocion === "ninguno" ? null : tonoDe(tramos[i].emocion);
    html += t
      ? `<i class="f-${t}" style="width:${ancho}%" title="${animoDe(tramos[i].emocion).nombre}"></i>`
      : `<i style="width:${ancho}%"></i>`;
  }
  cont.innerHTML = html;
}

function renderResumen() {
  const activo = estado.sesion.actual ? { alerta: estado.sesion.actual.alerta } : null;
  const r = resumir(estado.datos, activo);
  $("m-clientes").textContent = r.clientes;
  const idx = $("m-indice");
  idx.textContent = r.indiceAnimo === null ? "–" : `${r.indiceAnimo}%`;
  idx.className = `m-valor ${r.indiceAnimo !== null && r.indiceAnimo >= 70 ? "bueno" : ""}`;
  const al = $("m-alertas");
  al.textContent = r.alertas;
  al.className = `m-valor ${r.alertas > 0 ? "malo" : ""}`;
  $("m-tiempo").textContent = r.tiempoMedio === null ? "–" : mmss(r.tiempoMedio);

  const lista = $("lista");
  const ultimos = [...estado.datos.episodios].slice(-6).reverse();
  lista.innerHTML = ultimos.length
    ? ultimos
        .map((e) => {
          const a = animoDe(e.dominante);
          return `<li><span class="hora">${hhmm(e.inicio)}</span><span class="dur">${mmss(e.duracion)}${e.alerta ? " · con alerta" : ""}</span><span class="tag tono-${a.tono}">${a.nombre}</span></li>`;
        })
        .join("")
    : `<li class="vacio">Todavía no hay atenciones registradas hoy.</li>`;

  renderHoras();
}

function renderHoras() {
  const horas = porHora(estado.datos.registros);
  const claves = Object.keys(horas).map(Number);
  const cont = $("horas");
  if (!claves.length) {
    cont.innerHTML = `<span class="vacio">Sin datos todavía.</span>`;
    return;
  }
  let min = Math.min(...claves);
  let max = Math.max(...claves);
  while (max - min < 4) {
    if (min > 0) min--;
    if (max - min < 4 && max < 23) max++;
  }
  let html = "";
  for (let h = min; h <= max; h++) {
    const d = horas[h];
    const total = d ? TONOS.reduce((s, t) => s + d[t], 0) : 0;
    const pila = d
      ? TONOS.map((t) => (d[t] ? `<i class="f-${t}" style="height:${(d[t] / total) * 100}%" title="${t}: ${d[t]}"></i>` : "")).join("")
      : "";
    html += `<div class="col"><div class="pila">${pila}</div><div class="hr">${h}h</div></div>`;
  }
  cont.innerHTML = html;
}

/* ---------- procesamiento ---------- */

async function guardarSalida(salida) {
  for (const reg of salida.registros) {
    estado.datos.registros.push(reg);
    await estado.store.agregarRegistro(reg);
  }
  if (salida.cerrado) {
    estado.datos.episodios.push(salida.cerrado);
    await estado.store.agregarEpisodio(salida.cerrado);
  }
  if (salida.alertaNueva) {
    $("alerta-texto").textContent = "Atención sugerida: el cliente parece molesto. Ofrecé ayuda de un supervisor.";
    $("alerta").hidden = false;
  }
  if (salida.registros.length || salida.cerrado) renderResumen();
}

function marcarLinea(emocion) {
  const ultimo = estado.linea[estado.linea.length - 1];
  if (!ultimo || ultimo.emocion !== emocion) {
    estado.linea.push({ ts: Date.now(), emocion });
    const limite = Date.now() - 180000;
    while (estado.linea.length > 1 && estado.linea[1].ts < limite) estado.linea.shift();
  }
}

function procesarBlendshapes(bs, caja) {
  const ts = Date.now();

  if (estado.calibrando) {
    estado.calibrando.muestras.push(bs);
    const resta = Math.ceil((estado.calibrando.fin - ts) / 1000);
    if (resta > 0) aviso(`Calibrando: mantené la cara neutra… ${resta}s`, 0);
    else terminarCalibracion();
  }

  const probs = probabilidades(bs, { reposo: estado.reposo, neutralBias: estado.neutralBias });
  estado.historial.push(probs);
  if (estado.historial.length > VENTANA) estado.historial.shift();
  const g = ganadora(promediar(estado.historial));
  const lectura = { emocion: g.emocion, confianza: g.confianza };

  marcarLinea(lectura.emocion);
  renderFoco(lectura, caja);
  guardarSalida(estado.sesion.procesar(ts, lectura));
}

function sinRostro() {
  const ts = Date.now();
  estado.historial = [];
  marcarLinea("ninguno");
  renderFoco(null, null);
  guardarSalida(estado.sesion.procesar(ts, null));
}

function terminarCalibracion() {
  const muestras = estado.calibrando.muestras;
  estado.calibrando = null;
  if (muestras.length >= 10) {
    estado.reposo = reposoDesdeMuestras(muestras);
    try {
      localStorage.setItem("reposo", JSON.stringify(estado.reposo));
    } catch {
      /* sin almacenamiento */
    }
    aviso("Calibrado: se registró tu cara neutra.");
  } else {
    aviso("No se pudo calibrar: no se detectó un rostro estable.");
  }
}

/* ---------- cámara real ---------- */

async function cargarMediaPipe() {
  const { FaceLandmarker, FilesetResolver } = await import(`${MEDIAPIPE}/vision_bundle.mjs`);
  const fileset = await FilesetResolver.forVisionTasks(`${MEDIAPIPE}/wasm`);
  const crear = (delegate) =>
    FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: "models/face_landmarker.task", delegate },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: true,
    });
  try {
    return await crear("GPU");
  } catch {
    return await crear("CPU");
  }
}

async function abrirStream(deviceId) {
  const video = { width: { ideal: 1280 }, height: { ideal: 720 } };
  if (deviceId) video.deviceId = { exact: deviceId };
  else video.facingMode = "user";
  return navigator.mediaDevices.getUserMedia({ video, audio: false });
}

async function llenarCamaras(actualId) {
  const sel = $("camara");
  const dispositivos = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
  if (dispositivos.length < 2) return;
  sel.innerHTML = dispositivos.map((d, i) => `<option value="${d.deviceId}">${d.label || `Cámara ${i + 1}`}</option>`).join("");
  if (actualId) sel.value = actualId;
  sel.hidden = false;
}

async function iniciarCamara(deviceId = localStorage.getItem("camaraId") || undefined) {
  const video = $("video");
  $("placeholder-texto").textContent = "Abriendo cámara…";
  $("placeholder").hidden = false;

  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Este navegador no permite usar la cámara. Abrí la página con HTTPS o desde localhost.");

  if (!estado.landmarker) {
    $("placeholder-texto").textContent = "Cargando modelo…";
    estado.landmarker = await cargarMediaPipe();
  }

  try {
    estado.stream = await abrirStream(deviceId);
  } catch (e) {
    if (deviceId) estado.stream = await abrirStream(undefined);
    else throw e;
  }
  video.srcObject = estado.stream;
  await video.play();
  const pista = estado.stream.getVideoTracks()[0];
  const id = pista.getSettings().deviceId;
  try {
    localStorage.setItem("camaraId", id);
  } catch {
    /* sin almacenamiento */
  }
  await llenarCamaras(id);

  $("escenario").style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
  $("placeholder").hidden = true;
  estado.ultimoVideoTime = -1;
  setEstado("Cámara activa");
  bucleCamara();
}

function detenerCamara() {
  cancelAnimationFrame(estado.rafId);
  estado.rafId = null;
  estado.stream?.getTracks().forEach((t) => t.stop());
  estado.stream = null;
  $("video").srcObject = null;
}

function bucleCamara() {
  const video = $("video");
  const paso = (ahora) => {
    estado.rafId = requestAnimationFrame(paso);
    if (video.readyState < 2 || ahora - estado.ultimaLectura < MS_ENTRE_LECTURAS) return;
    if (video.currentTime === estado.ultimoVideoTime) return;
    estado.ultimaLectura = ahora;
    estado.ultimoVideoTime = video.currentTime;

    let res;
    try {
      res = estado.landmarker.detectForVideo(video, performance.now());
    } catch {
      return;
    }
    const lm = res.faceLandmarks?.[0];
    const forma = res.faceBlendshapes?.[0]?.categories;
    if (!lm || !forma) return sinRostro();

    const bs = {};
    for (const c of forma) bs[c.categoryName] = c.score;
    let xmin = 1, xmax = 0, ymin = 1, ymax = 0;
    for (const p of lm) {
      if (p.x < xmin) xmin = p.x;
      if (p.x > xmax) xmax = p.x;
      if (p.y < ymin) ymin = p.y;
      if (p.y > ymax) ymax = p.y;
    }
    // el video se muestra en espejo: se invierte la X
    procesarBlendshapes(bs, { x: 1 - xmax, y: ymin, w: xmax - xmin, h: ymax - ymin });
  };
  estado.rafId = requestAnimationFrame(paso);
}

/* ---------- modo demo (sin cámara) ---------- */

const GUION_DEMO = [
  { s: 6, bs: {} },
  { s: 7, bs: { mouthSmileLeft: 0.4, mouthSmileRight: 0.38, cheekSquintLeft: 0.2 } },
  { s: 4, bs: {} },
  { s: 5, bs: { jawOpen: 0.4, browInnerUp: 0.4, browOuterUpLeft: 0.3, browOuterUpRight: 0.3, eyeWideLeft: 0.4, eyeWideRight: 0.4 } },
  { s: 3, bs: {} },
  { s: 8, bs: { browDownLeft: 0.5, browDownRight: 0.5, eyeSquintLeft: 0.6, eyeSquintRight: 0.6, mouthPressLeft: 0.25, mouthPressRight: 0.25 } },
  { s: 3, bs: {} },
  { s: 7, bs: null },
];
const DURACION_DEMO = GUION_DEMO.reduce((a, p) => a + p.s, 0);

function sembrarDemo(store) {
  const ahora = new Date();
  const horaActual = ahora.getHours();
  const azar = (min, max) => Math.floor(min + Math.random() * (max - min + 1));
  const tonos = [["feliz", 0.45], ["neutral", 0.35], ["sorprendido", 0.08], ["triste", 0.06], ["enojado", 0.06]];
  const elegir = () => {
    let r = Math.random();
    for (const [e, p] of tonos) if ((r -= p) < 0) return e;
    return "neutral";
  };
  let id = 1;
  for (let h = 8; h <= Math.max(8, horaActual - 1); h++) {
    for (let i = 0, n = azar(1, 4); i < n; i++) {
      const inicio = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate(), h, azar(0, 55), azar(0, 59)).getTime();
      const dom = elegir();
      const dur = azar(40, 240) * 1000;
      store.agregarEpisodio({ id: id, inicio, fin: inicio + dur, duracion: dur, dominante: dom, alerta: dom === "enojado" });
      for (let k = 0, m = azar(2, 5); k < m; k++) {
        store.agregarRegistro({ ts: inicio + k * 5000, emocion: k === 0 ? "neutral" : dom, confianza: 0.6 + Math.random() * 0.3, episodio: id });
      }
      id++;
    }
  }
}

class AlmacenMemoria {
  constructor() {
    this.m = new Map();
  }
  get length() {
    return this.m.size;
  }
  key(i) {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k) {
    return this.m.has(k) ? this.m.get(k) : null;
  }
  setItem(k, v) {
    this.m.set(k, String(v));
  }
  removeItem(k) {
    this.m.delete(k);
  }
}

function iniciarDemo() {
  $("placeholder").hidden = false;
  $("placeholder-texto").textContent = "Modo demo: datos simulados";
  $("escenario").style.aspectRatio = "4 / 3";
  setEstado("Modo demo", "demo");
  const t0 = Date.now();
  estado.demoTimer = setInterval(() => {
    const t = ((Date.now() - t0) / 1000) % DURACION_DEMO;
    let acum = 0;
    let paso = GUION_DEMO[0];
    for (const p of GUION_DEMO) {
      if (t < acum + p.s) {
        paso = p;
        break;
      }
      acum += p.s;
    }
    if (paso.bs === null) return sinRostro();
    const bs = {};
    for (const [k, v] of Object.entries(paso.bs)) bs[k] = Math.max(0, v + (Math.random() - 0.5) * 0.06);
    const jx = (Math.random() - 0.5) * 0.01;
    procesarBlendshapes(bs, { x: 0.3 + jx, y: 0.16, w: 0.4, h: 0.6 });
  }, 150);
}

/* ---------- acciones ---------- */

async function pausarReanudar() {
  const boton = $("btn-pausa");
  if (!estado.pausado) {
    estado.pausado = true;
    if (estado.modo === "camara") detenerCamara();
    clearInterval(estado.demoTimer);
    estado.demoTimer = null;
    guardarSalida({ registros: [], cerrado: estado.sesion.cerrarAhora(), alertaNueva: false });
    renderFoco(null, null);
    $("placeholder").hidden = false;
    $("placeholder-texto").textContent = "Análisis en pausa";
    setEstado("En pausa", "pausa");
    boton.innerHTML = `<i class="ti ti-player-play" aria-hidden="true"></i><span>Reanudar</span>`;
  } else {
    estado.pausado = false;
    boton.innerHTML = `<i class="ti ti-player-pause" aria-hidden="true"></i><span>Pausar</span>`;
    if (estado.modo === "camara") {
      try {
        await iniciarCamara();
      } catch (e) {
        aviso(`No se pudo reanudar: ${e.message}`, 5000);
      }
    } else iniciarDemo();
  }
}

function calibrar() {
  if (estado.modo !== "camara" || estado.pausado) return aviso("La calibración solo se usa con la cámara activa.");
  estado.calibrando = { fin: Date.now() + 3000, muestras: [] };
  aviso("Calibrando: mantené la cara neutra… 3s", 0);
}

function descargarCSV() {
  const csv = aCSV(estado.datos);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `animo_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function borrarDatos() {
  if (!confirm("¿Borrar todos los registros guardados? No se puede deshacer.")) return;
  try {
    await estado.store.borrarTodo();
  } catch (e) {
    return aviso(`No se pudo borrar: ${e.message}`, 5000);
  }
  estado.datos = { registros: [], episodios: [] };
  renderResumen();
  aviso("Datos borrados.");
}

/* ---------- arranque ---------- */

let relojIniciado = false;

async function iniciarAuth() {
  if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) {
    $("inicio").hidden = false;
    return;
  }
  try {
    const { createClient } = await import(SUPABASE_JS);
    cliente = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
    const { data } = await cliente.auth.getSession();
    usuario = data.session?.user ?? null;
  } catch (e) {
    cliente = null;
    $("inicio").hidden = false;
    $("inicio-error").textContent = "No se pudo conectar con Supabase. Se trabaja en modo local.";
    $("inicio-error").hidden = false;
    return;
  }
  $(usuario ? "inicio" : "login").hidden = false;
}

async function ingresar(e) {
  e.preventDefault();
  const err = $("login-error");
  err.hidden = true;
  $("btn-login").disabled = true;
  const { data, error } = await cliente.auth.signInWithPassword({ email: $("login-email").value.trim(), password: $("login-pass").value });
  $("btn-login").disabled = false;
  if (error) {
    err.textContent = /invalid/i.test(error.message) ? "Correo o contraseña incorrectos." : `No se pudo ingresar: ${error.message}`;
    err.hidden = false;
    return;
  }
  usuario = data.user;
  $("login-pass").value = "";
  $("login").hidden = true;
  $("inicio").hidden = false;
}

async function salir() {
  await estado.store?.vaciar?.();
  await cliente.auth.signOut();
  location.reload();
}

async function entrar(modo) {
  estado.modo = modo;
  if (modo === "demo") {
    estado.store = new LocalStore(new AlmacenMemoria());
    sembrarDemo(estado.store);
  } else if (cliente && usuario) {
    estado.store = new SupabaseStore(cliente);
    estado.store.onError = () => aviso("No se pudieron enviar los datos a Supabase. Se reintentará.", 4000);
  } else {
    estado.store = new LocalStore();
  }
  try {
    estado.datos = await estado.store.cargarDia();
  } catch (e) {
    estado.datos = { registros: [], episodios: [] };
    aviso(`No se pudo cargar el historial: ${e.message}`, 5000);
  }
  const quien = modo !== "demo" && usuario ? ` · ${usuario.email}` : "";
  $("modo-texto").textContent = modo === "demo" ? "Modo demo · datos simulados" : `${estado.store.nombre}${quien}`;
  $("btn-salir").hidden = !(cliente && usuario);
  $("inicio").hidden = true;
  $("app").hidden = false;
  renderFoco(null, null);
  renderResumen();
  if (!relojIniciado) {
    relojIniciado = true;
    setInterval(renderLinea, 1000);
    setInterval(() => ($("reloj").textContent = hhmm(Date.now())), 1000);
  }
  $("reloj").textContent = hhmm(Date.now());
}

$("consent").addEventListener("change", (e) => ($("btn-camara").disabled = !e.target.checked));

$("btn-camara").addEventListener("click", async () => {
  const err = $("inicio-error");
  err.hidden = true;
  $("btn-camara").disabled = true;
  try {
    await entrar("camara");
    await iniciarCamara();
  } catch (e) {
    $("app").hidden = true;
    $("inicio").hidden = false;
    $("btn-camara").disabled = !$("consent").checked;
    detenerCamara();
    err.textContent = e.name === "NotAllowedError" ? "El navegador no tiene permiso para usar la cámara. Habilitalo en la barra de direcciones y volvé a intentar." : `No se pudo iniciar: ${e.message}`;
    err.hidden = false;
  }
});

$("btn-demo").addEventListener("click", async () => {
  await entrar("demo");
  iniciarDemo();
});

$("btn-pausa").addEventListener("click", pausarReanudar);
$("btn-calibrar").addEventListener("click", calibrar);
$("btn-csv").addEventListener("click", descargarCSV);
$("btn-borrar").addEventListener("click", borrarDatos);
$("alerta-ok").addEventListener("click", () => ($("alerta").hidden = true));
$("camara").addEventListener("change", async (e) => {
  detenerCamara();
  try {
    await iniciarCamara(e.target.value);
  } catch (err) {
    aviso(`No se pudo cambiar de cámara: ${err.message}`, 5000);
  }
});

$("login-form").addEventListener("submit", ingresar);
$("btn-salir").addEventListener("click", salir);

window.addEventListener("pagehide", () => {
  guardarSalida({ registros: [], cerrado: estado.sesion.cerrarAhora(), alertaNueva: false });
  estado.store?.vaciar?.();
  detenerCamara();
});

iniciarAuth();
