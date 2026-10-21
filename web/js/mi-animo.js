// Pantalla del huésped en su propio teléfono: su cámara, su nombre y el emoji de su expresión.
// Todo ocurre en el teléfono: no se envía ni se guarda ninguna imagen ni lectura.

import { probabilidades, promediar, ganadora } from "./emotion.js";
import { animoCliente } from "./mood.js";
import { limpiarTexto } from "./canal.js";
import { CONFIG } from "./config.js";
import { SALA_RE } from "./sala.js";

const MEDIAPIPE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
const MS_LATIDO = 1000; // mientras la pantalla está abierta se avisa a la recepción cada tanto, aunque no cambie la emoción
const VENTANA = 4;
const NEUTRAL_BIAS = 0.6;
const MS_ENTRE_LECTURAS = 80;
const MS_SIN_ROSTRO = 700;

const $ = (id) => document.getElementById(id);
const parametros = new URLSearchParams(location.hash.slice(1));
const nombre = limpiarTexto(parametros.get("n") || "");
const sala = SALA_RE.test(parametros.get("s") || "") ? parametros.get("s") : null;
const miId = crypto.randomUUID();

let stream = null;
let activo = false;
let landmarker = null;

$("cli-saludo").textContent = nombre ? `Hola, ${nombre}` : "Hola";

// Comparte con la recepción el nombre y la emoción del momento. Es opcional: si falla, la pantalla sigue andando.
let canal = null;
let suscripto = false;
let ultimaEmocion = null;
let ultimoEnvio = 0;

async function conectarSala() {
  if (!sala) return;
  try {
    const { createClient } = await import(SUPABASE_JS);
    const cliente = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    canal = cliente.channel(`sala-${sala}`, { config: { broadcast: { self: false } } });
    canal.subscribe((estado) => {
      suscripto = estado === "SUBSCRIBED";
    });
  } catch {
    canal = null;
  }
}

function compartir(emocion, confianza = 0) {
  if (!canal || !suscripto) return;
  const ahora = Date.now();
  if (emocion === ultimaEmocion && ahora - ultimoEnvio < MS_LATIDO) return;
  ultimaEmocion = emocion;
  ultimoEnvio = ahora;
  Promise.resolve(canal.send({ type: "broadcast", event: "lectura", payload: { id: miId, nombre, emocion, confianza: Math.round(confianza * 100) / 100 } })).catch(() => {});
}

function despedirse() {
  if (canal && suscripto) Promise.resolve(canal.send({ type: "broadcast", event: "adios", payload: { id: miId } })).catch(() => {});
}

function pintar(emocion, caja) {
  const a = animoCliente(emocion);
  $("cli-animo").className = `animo cli-animo tono-${a.tono}`;
  $("cli-emoji").textContent = a.emoji;
  $("cli-emoji").setAttribute("aria-label", a.nombre);
  const el = $("cli-caja");
  if (!caja) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.className = `caja tono-${a.tono}`;
  el.style.left = `${caja.x * 100}%`;
  el.style.top = `${caja.y * 100}%`;
  el.style.width = `${caja.w * 100}%`;
  el.style.height = `${caja.h * 100}%`;
  $("cli-chip").textContent = nombre ? `${nombre} ${a.emoji}` : a.emoji;
}

async function cargarLandmarker() {
  if (landmarker) return landmarker;
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
    landmarker = await crear("GPU");
  } catch {
    landmarker = await crear("CPU");
  }
  return landmarker;
}

function detener() {
  activo = false;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}

function mostrarError(texto) {
  $("cli-placeholder").hidden = false;
  $("cli-placeholder-texto").textContent = texto;
  $("btn-reintentar").hidden = false;
}

async function iniciar() {
  $("btn-reintentar").hidden = true;
  $("cli-placeholder").hidden = false;
  $("cli-placeholder-texto").textContent = "Activando la cámara…";
  const video = $("cli-video");
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    video.srcObject = stream;
    await video.play();
    $("cli-escenario").style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
  } catch (e) {
    detener();
    return mostrarError(e.name === "NotAllowedError" ? "Permití el uso de la cámara en el navegador y tocá el botón." : "No se pudo abrir la cámara de este teléfono.");
  }
  $("cli-placeholder-texto").textContent = "Preparando el reconocimiento de expresiones…";
  let lm;
  try {
    lm = await cargarLandmarker();
  } catch {
    detener();
    return mostrarError("No se pudo preparar el análisis en este teléfono.");
  }
  $("cli-placeholder").hidden = true;

  activo = true;
  const historial = [];
  let ultimo = 0;
  let ultimoT = -1;
  let ultimoRostro = 0;

  const ciclo = () => {
    if (!activo) return;
    const ahora = performance.now();
    if (video.readyState >= 2 && video.currentTime !== ultimoT && ahora - ultimo >= MS_ENTRE_LECTURAS) {
      ultimoT = video.currentTime;
      ultimo = ahora;
      try {
        const res = lm.detectForVideo(video, ahora);
        const forma = res.faceBlendshapes?.[0]?.categories;
        const puntos = res.faceLandmarks?.[0];
        if (forma && puntos) {
          ultimoRostro = ahora;
          const bs = {};
          for (const c of forma) bs[c.categoryName] = c.score;
          historial.push(probabilidades(bs, { reposo: null, neutralBias: NEUTRAL_BIAS }));
          if (historial.length > VENTANA) historial.shift();
          let xmin = 1, xmax = 0, ymin = 1, ymax = 0;
          for (const p of puntos) {
            xmin = Math.min(xmin, p.x);
            xmax = Math.max(xmax, p.x);
            ymin = Math.min(ymin, p.y);
            ymax = Math.max(ymax, p.y);
          }
          // el video se muestra en espejo: se invierte la X
          const g = ganadora(promediar(historial));
          pintar(g.emocion, { x: 1 - xmax, y: ymin, w: xmax - xmin, h: ymax - ymin });
          compartir(g.emocion, g.confianza);
        } else if (ahora - ultimoRostro > MS_SIN_ROSTRO) {
          historial.length = 0;
          pintar("ninguno", null);
          compartir("ninguno");
        }
      } catch {
        /* un cuadro que falla se ignora */
      }
    }
    requestAnimationFrame(ciclo);
  };
  requestAnimationFrame(ciclo);
}

$("btn-reintentar").addEventListener("click", iniciar);
window.addEventListener("pagehide", () => {
  despedirse();
  detener();
});

conectarSala();
iniciar();
