// Modo evaluación: sesión guiada para validar Ánima con distintas personas (expresiones y reconocimiento).
// Todo queda en este navegador (localStorage). No se guardan fotos ni se envía nada a internet.

import { ETIQUETAS, probabilidades, promediar, ganadora, reposoDesdeMuestras } from "./emotion.js";
import { animoCliente } from "./mood.js";
import { cargarReconocedor, embeddingDe } from "./reconocimiento.js";
import { promediar as promediarEmbeddings, UMBRAL, coseno } from "./reconocer.js";
import { matrizConfusion, metricasPorClase, exactitud, resumenReconocimiento, aCSV, porcentaje, COLUMNAS } from "./evaluacion-calculo.js";

const MEDIAPIPE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const CLAVE = "anima_eval";
const MUESTRAS_EMBEDDING = 10;
const ENTRE_EMBEDDINGS_MS = 350;
const MIN_LECTURAS = 5;
const REINTENTOS = 2;

// Los tiempos se pueden acortar con ?prep=800&cap=800 (solo para pruebas del propio sistema).
const parametros = new URLSearchParams(location.search);
const entre = (v, def, min, max) => Math.min(max, Math.max(min, Number(v) || def));
const MS_CALIBRACION = entre(parametros.get("cal"), 3000, 400, 10000);
const MS_PREPARACION = entre(parametros.get("prep"), 3000, 400, 10000);
const MS_CAPTURA = entre(parametros.get("cap"), 2000, 400, 10000);

const PEDIDOS = {
  neutral: { nombre: "Neutral", pista: "Cara relajada, sin ningún gesto." },
  feliz: { nombre: "Feliz", pista: "Sonreí." },
  sorprendido: { nombre: "Sorprendido", pista: "Abrí bien los ojos y la boca, y levantá las cejas." },
  triste: { nombre: "Triste", pista: "Bajá las comisuras de la boca y subí el centro de las cejas." },
  enojado: { nombre: "Enojado", pista: "Fruncí el ceño y apretá los labios." },
  asco: { nombre: "Asco", pista: "Arrugá la nariz como si algo oliera mal." },
  miedo: { nombre: "Miedo", pista: "Abrí los ojos, cejas arriba y juntas, boca tensa." },
};

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- almacenamiento ---------- */

function leer() {
  try {
    const d = JSON.parse(localStorage.getItem(CLAVE));
    return d && Array.isArray(d.participantes) ? d : { participantes: [] };
  } catch {
    return { participantes: [] };
  }
}

function guardar(datos) {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(datos));
    return true;
  } catch {
    return false;
  }
}

const redondear = (v, n = 4) => Array.from(v, (x) => Number(x.toFixed(n)));

function siguienteCodigo() {
  const usados = new Set(leer().participantes.map((p) => p.id));
  for (let i = 1; i < 1000; i++) {
    const c = `P${String(i).padStart(2, "0")}`;
    if (!usados.has(c)) return c;
  }
  return "P";
}

function mostrar(seccion) {
  for (const id of ["intro", "sesion", "final", "resultados"]) $(`ev-${id}`).hidden = id !== seccion;
}

function actualizarCuenta() {
  const n = leer().participantes.length;
  $("ev-cuenta").textContent = n ? `Participantes guardados en este navegador: ${n}.` : "Todavía no hay participantes guardados.";
}

/* ---------- cámara y detección ---------- */

let stream = null;
let landmarker = null;
let cancelado = false;
let ultimoT = -1;
let reposo = null;
const neutralBias = (() => {
  const v = parseFloat(localStorage.getItem("neutralBias"));
  return v > 0 && v <= 1 ? v : 0.6;
})();

async function cargarLandmarker() {
  if (landmarker) return landmarker;
  const { FaceLandmarker, FilesetResolver } = await import(`${MEDIAPIPE}/vision_bundle.mjs`);
  const fileset = await FilesetResolver.forVisionTasks(`${MEDIAPIPE}/wasm`);
  const crear = (delegate) =>
    FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: "models/face_landmarker.task", delegate },
      runningMode: "VIDEO",
      numFaces: 2,
      outputFaceBlendshapes: true,
    });
  try {
    landmarker = await crear("GPU");
  } catch {
    landmarker = await crear("CPU");
  }
  return landmarker;
}

function detener() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}

// Espera el próximo cuadro nuevo con exactamente una cara. Devuelve { bs, lm } o null si se cancela o vence el tiempo.
function cuadro(timeoutMs = 8000) {
  const video = $("ev-video");
  return new Promise((ok) => {
    const t0 = performance.now();
    const paso = () => {
      if (cancelado) return ok(null);
      const ahora = performance.now();
      if (video.readyState >= 2 && video.currentTime !== ultimoT) {
        ultimoT = video.currentTime;
        try {
          const res = landmarker.detectForVideo(video, ahora);
          const n = res.faceLandmarks?.length || 0;
          const forma = res.faceBlendshapes?.[0]?.categories;
          if (n === 1 && forma) {
            const bs = {};
            for (const c of forma) bs[c.categoryName] = c.score;
            return ok({ bs, lm: res.faceLandmarks[0] });
          }
          $("ev-estado").textContent = n === 0 ? "No veo tu cara. Mirá a la cámara." : "Tiene que aparecer una sola persona.";
        } catch {
          /* un cuadro que falla se ignora */
        }
      }
      if (ahora - t0 > timeoutMs) return ok(null);
      requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
  });
}

const barra = (fraccion) => ($("ev-barra").style.width = `${Math.round(Math.min(1, Math.max(0, fraccion)) * 100)}%`);

function pedido(esperada) {
  const el = $("ev-pedido");
  el.dataset.esperada = esperada || "";
  $("ev-emoji").textContent = esperada ? animoCliente(esperada).emoji : "";
  $("ev-titulo").textContent = esperada ? PEDIDOS[esperada].nombre : "";
  $("ev-pista").textContent = esperada ? PEDIDOS[esperada].pista : "";
}

/* ---------- pasos de la sesión ---------- */

async function calibrar() {
  pedido("neutral");
  $("ev-pista").textContent = "Mantené la cara relajada, sin gestos, mirando a la cámara.";
  $("ev-estado").textContent = "Calibración de tu cara neutra…";
  const muestras = [];
  const fin = performance.now() + MS_CALIBRACION;
  while (performance.now() < fin && !cancelado) {
    const c = await cuadro();
    if (!c) break;
    muestras.push(c.bs);
    barra(1 - (fin - performance.now()) / MS_CALIBRACION);
  }
  if (cancelado) return false;
  if (muestras.length < 10) throw new Error("No se pudo calibrar: no se vio una cara estable.");
  reposo = reposoDesdeMuestras(muestras);
  return true;
}

async function capturarEmbeddings(titulo, pista) {
  pedido(null);
  $("ev-titulo").textContent = titulo;
  $("ev-pista").textContent = pista;
  const lista = [];
  let ultimo = 0;
  const limite = performance.now() + 40000;
  while (lista.length < MUESTRAS_EMBEDDING && !cancelado && performance.now() < limite) {
    const c = await cuadro();
    if (!c) continue;
    if (performance.now() - ultimo < ENTRE_EMBEDDINGS_MS) continue;
    ultimo = performance.now();
    const v = $("ev-video");
    lista.push(await embeddingDe(v, c.lm, v.videoWidth, v.videoHeight));
    barra(lista.length / MUESTRAS_EMBEDDING);
  }
  if (cancelado) return null;
  if (lista.length < MUESTRAS_EMBEDDING) throw new Error("No se pudo tomar el rostro: mirá de frente a la cámara.");
  return promediarEmbeddings(lista);
}

async function pedirExpresion(esperada) {
  for (let intento = 0; intento <= REINTENTOS; intento++) {
    pedido(esperada);
    // Preparación con cuenta regresiva
    const finPrep = performance.now() + MS_PREPARACION;
    while (performance.now() < finPrep && !cancelado) {
      const resta = Math.ceil((finPrep - performance.now()) / 1000);
      $("ev-estado").textContent = `Prepará el gesto… ${resta}`;
      barra(1 - (finPrep - performance.now()) / MS_PREPARACION);
      await esperar(80);
    }
    if (cancelado) return null;

    // Captura
    $("ev-estado").textContent = "¡Mantené el gesto!";
    const probs = [];
    const finCap = performance.now() + MS_CAPTURA;
    while (performance.now() < finCap && !cancelado) {
      const c = await cuadro(1500);
      if (!c) continue;
      probs.push(probabilidades(c.bs, { reposo, neutralBias }));
      barra(1 - (finCap - performance.now()) / MS_CAPTURA);
    }
    if (cancelado) return null;
    if (probs.length >= MIN_LECTURAS) {
      const media = promediar(probs);
      const g = ganadora(media);
      return { esperada, predicha: g.emocion, confianza: Number(g.confianza.toFixed(3)), dist: Object.fromEntries(ETIQUETAS.map((e) => [e, Number(media[e].toFixed(3))])) };
    }
    $("ev-estado").textContent = "No se vio tu cara durante el gesto. Se repite.";
    await esperar(800);
  }
  return { esperada, predicha: "incierto", confianza: 0, dist: null };
}

const mezclar = (lista) => {
  const a = [...lista];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

async function correrSesion(codigo) {
  cancelado = false;
  ultimoT = -1;
  reposo = null;
  mostrar("sesion");
  $("ev-error").textContent = "";
  $("ev-estado").textContent = "Abriendo la cámara…";
  $("ev-paso").textContent = "Preparando…";
  pedido(null);
  barra(0);

  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    $("ev-video").srcObject = stream;
    await $("ev-video").play();
    $("ev-estado").textContent = "Cargando los modelos (puede tardar unos segundos)…";
    await Promise.all([cargarLandmarker(), cargarReconocedor()]);

    const orden = mezclar(ETIQUETAS);
    const total = 3 + orden.length; // calibración + registro + expresiones + verificación
    let n = 0;
    const paso = (texto) => ($("ev-paso").textContent = `Paso ${++n} de ${total}: ${texto}`);

    paso("calibración");
    if (!(await calibrar())) return abortar();
    paso("registro del rostro");
    const registro = await capturarEmbeddings("Registro del rostro", "Mirá de frente a la cámara, sin gestos.");
    if (!registro) return abortar();

    const resultados = [];
    for (const e of orden) {
      paso(`expresión ${resultados.length + 1} de ${orden.length}`);
      const r = await pedirExpresion(e);
      if (!r) return abortar();
      resultados.push(r);
    }

    paso("verificación del rostro");
    const verificacion = await capturarEmbeddings("Verificación del rostro", "Volvé a mirar de frente a la cámara, sin gestos.");
    if (!verificacion) return abortar();

    const datos = leer();
    datos.participantes = datos.participantes.filter((p) => p.id !== codigo);
    datos.participantes.push({ id: codigo, fecha: new Date().toISOString(), resultados, registro: redondear(registro), verificacion: redondear(verificacion) });
    const ok = guardar(datos);
    detener();
    mostrar("final");
    $("ev-final-texto").textContent = ok
      ? `Listo, ${codigo}. Gracias por participar.`
      : "No se pudo guardar en este navegador (almacenamiento lleno o bloqueado). Los datos de este participante se perdieron.";
    $("ev-final-texto").className = ok ? "ok" : "mal";
  } catch (e) {
    detener();
    mostrar("intro");
    $("ev-error").textContent = e.name === "NotAllowedError" ? "No diste permiso para usar la cámara." : e.message;
    actualizarCuenta();
  }
}

function abortar() {
  detener();
  mostrar("intro");
  $("ev-error").textContent = "Sesión cancelada: no se guardó nada.";
  actualizarCuenta();
}

/* ---------- resultados ---------- */

function todosLosResultados(participantes) {
  return participantes.flatMap((p) => p.resultados.map((r) => ({ participante: p.id, esperada: r.esperada, predicha: r.predicha, confianza: r.confianza })));
}

function renderResultados() {
  const { participantes } = leer();
  const cont = $("ev-tablas");
  if (!participantes.length) {
    cont.innerHTML = "<p>Todavía no hay participantes. Hacé al menos una sesión.</p>";
    return;
  }
  const resultados = todosLosResultados(participantes);
  const conf = matrizConfusion(resultados);
  const clases = metricasPorClase(conf);
  const acierto = exactitud(conf);

  const encabezado = COLUMNAS.map((c) => `<th>${esc(c)}</th>`).join("");
  const filas = conf.filas
    .map((f, i) => `<tr><th>${esc(f)}</th>${conf.matriz[i].map((v, j) => `<td class="${j === i ? "diag" : ""}">${v || "·"}</td>`).join("")}</tr>`)
    .join("");

  const porClase = clases
    .map((c) => `<tr><th>${esc(c.clase)}</th><td>${c.pedidas}</td><td>${c.aciertos}</td><td>${porcentaje(c.recall)}</td><td>${porcentaje(c.precision)}</td><td>${porcentaje(c.f1)}</td></tr>`)
    .join("");

  const rec = resumenReconocimiento(participantes.map((p) => ({ id: p.id, registro: p.registro, verificacion: p.verificacion })), UMBRAL);
  const dos = (x) => (x === null ? "–" : x.toFixed(2).replace(".", ","));

  const porPersona = participantes
    .map((p) => {
      const ac = p.resultados.filter((r) => r.predicha === r.esperada).length;
      return `<tr><th>${esc(p.id)}</th><td>${ac} de ${p.resultados.length}</td><td>${dos(coseno(p.registro, p.verificacion))}</td></tr>`;
    })
    .join("");

  cont.innerHTML = `
    <p><strong>${participantes.length}</strong> participante(s), <strong>${conf.total}</strong> gestos evaluados. Exactitud global: <strong>${porcentaje(acierto)}</strong>.</p>
    <h2>Matriz de confusión</h2>
    <p class="estado-cli">Filas: gesto pedido. Columnas: lo que detectó Ánima. La diagonal son los aciertos.</p>
    <div class="tabla-ev"><table><thead><tr><th></th>${encabezado}</tr></thead><tbody>${filas}</tbody></table></div>
    <h2>Resultados por expresión</h2>
    <div class="tabla-ev"><table><thead><tr><th></th><th>Pedidas</th><th>Aciertos</th><th>Exhaustividad</th><th>Precisión</th><th>F1</th></tr></thead><tbody>${porClase}</tbody></table></div>
    <h2>Reconocimiento de personas</h2>
    <p>Umbral de similitud: ${dos(rec.umbral)}. Identificados correctamente: <strong>${rec.identificados} de ${rec.participantes}</strong> (${porcentaje(rec.tasaIdentificacion)}); no reconocidos: ${rec.noReconocidos}; confundidos con otra persona: ${rec.confundidos}.</p>
    <p>Aceptación de la misma persona (TAR): ${porcentaje(rec.tar)}. Falsa aceptación de otra persona (FAR): ${porcentaje(rec.far)}${rec.impostores.n ? "" : " (hace falta más de un participante)"}.</p>
    <p>Similitud con la misma persona: media ${dos(rec.genuinos.media)}, mínima ${dos(rec.genuinos.min)}. Similitud con otras personas: media ${dos(rec.impostores.media)}, máxima ${dos(rec.impostores.max)}.</p>
    <h2>Por participante</h2>
    <div class="tabla-ev"><table><thead><tr><th>Código</th><th>Gestos acertados</th><th>Similitud consigo mismo</th></tr></thead><tbody>${porPersona}</tbody></table></div>`;
}

function descargar(nombre, texto) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([texto], { type: "text/csv;charset=utf-8" }));
  a.download = nombre;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function csvReconocimiento(participantes) {
  const filas = participantes.map((p) => {
    const propia = coseno(p.registro, p.verificacion);
    const otras = participantes.filter((q) => q.id !== p.id).map((q) => coseno(q.registro, p.verificacion));
    const mejorOtra = otras.length ? Math.max(...otras) : "";
    return [p.id, propia.toFixed(3), mejorOtra === "" ? "" : mejorOtra.toFixed(3), propia >= UMBRAL && (mejorOtra === "" || propia > mejorOtra) ? "si" : "no"].join(",");
  });
  return ["participante,similitud_propia,mejor_similitud_otra,identificado", ...filas].join("\n");
}

/* ---------- eventos ---------- */

$("ev-consent").addEventListener("change", (e) => ($("ev-empezar").disabled = !e.target.checked));
$("ev-empezar").addEventListener("click", () => {
  const codigo = $("ev-codigo").value.trim().replace(/[^\w-]/g, "").slice(0, 12) || siguienteCodigo();
  if (leer().participantes.some((p) => p.id === codigo) && !confirm(`Ya existe un participante ${codigo}. ¿Reemplazarlo?`)) return;
  correrSesion(codigo);
});
$("ev-cancelar").addEventListener("click", () => {
  cancelado = true;
});
$("ev-otro").addEventListener("click", () => {
  $("ev-codigo").value = siguienteCodigo();
  $("ev-consent").checked = false;
  $("ev-empezar").disabled = true;
  mostrar("intro");
  actualizarCuenta();
});
for (const id of ["ev-ver", "ev-ver2"]) {
  $(id).addEventListener("click", () => {
    renderResultados();
    mostrar("resultados");
  });
}
$("ev-volver").addEventListener("click", () => {
  mostrar("intro");
  actualizarCuenta();
});
$("ev-csv").addEventListener("click", () => descargar("evaluacion_expresiones.csv", aCSV(todosLosResultados(leer().participantes))));
$("ev-csv-rec").addEventListener("click", () => descargar("evaluacion_reconocimiento.csv", csvReconocimiento(leer().participantes)));
$("ev-borrar").addEventListener("click", () => {
  if (!confirm("¿Borrar todos los participantes y resultados de este navegador? No se puede deshacer.")) return;
  try {
    localStorage.removeItem(CLAVE);
  } catch {
    /* sin almacenamiento */
  }
  renderResultados();
  actualizarCuenta();
});
window.addEventListener("pagehide", detener);

$("ev-codigo").value = siguienteCodigo();
actualizarCuenta();
