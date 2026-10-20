// Registro del huésped desde su propio teléfono. El recepcionista genera un QR con un código de un solo uso;
// acá se calcula el vector facial en el teléfono y se envía a Supabase con ese código. No se sube ninguna foto.

import { CONFIG } from "./config.js";
import { cargarReconocedor, embeddingDe } from "./reconocimiento.js";
import { promediar } from "./reconocer.js";

const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
const MEDIAPIPE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const MUESTRAS = 10;
const ENTRE_MUESTRAS_MS = 350;

const $ = (id) => document.getElementById(id);
const token = new URLSearchParams(location.hash.slice(1)).get("t");

let cliente = null;
let stream = null;
let activo = false;
let vector = null;
let listoLandmarker = null;

function mostrar(seccion) {
  for (const id of ["carga", "invalido", "intro", "camara", "final"]) $(`p-${id}`).hidden = id !== seccion;
}

function invalido(texto) {
  $("m-error").textContent = texto;
  mostrar("invalido");
}

function cargarLandmarker() {
  if (!listoLandmarker) {
    listoLandmarker = (async () => {
      const { FaceLandmarker, FilesetResolver } = await import(`${MEDIAPIPE}/vision_bundle.mjs`);
      const fileset = await FilesetResolver.forVisionTasks(`${MEDIAPIPE}/wasm`);
      const crear = (delegate) =>
        FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: "models/face_landmarker.task", delegate },
          runningMode: "VIDEO",
          numFaces: 2,
        });
      try {
        return await crear("GPU");
      } catch {
        return await crear("CPU");
      }
    })();
    listoLandmarker.catch(() => (listoLandmarker = null));
  }
  return listoLandmarker;
}

async function iniciar() {
  if (!token || !/^[0-9a-f]{32}$/.test(token)) return invalido("Este enlace no es válido. Pedile a la recepción que te muestre el código QR nuevamente.");
  try {
    const { createClient } = await import(SUPABASE_JS);
    cliente = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await cliente.rpc("invitacion_nombre", { p_token: token });
    if (error) throw error;
    if (!data) return invalido("Este enlace venció o ya se usó. Pedile a la recepción un código nuevo.");
    $("m-nombre").textContent = data;
  } catch {
    return invalido("No pudimos conectarnos. Revisá tu conexión e intentá de nuevo.");
  }
  mostrar("intro");
  // Mientras lee el consentimiento se descargan los modelos en segundo plano.
  $("m-prep").textContent = "Preparando el reconocimiento…";
  Promise.all([cargarLandmarker(), cargarReconocedor()]).then(
    () => ($("m-prep").textContent = ""),
    () => ($("m-prep").textContent = "No se pudo preparar el reconocimiento en este teléfono."),
  );
}

function detener() {
  activo = false;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}

async function empezar() {
  mostrar("camara");
  $("m-barra").style.width = "0%";
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  } catch (e) {
    mostrar("final");
    $("m-final").className = "mal";
    $("m-final").textContent = e.name === "NotAllowedError" ? "No diste permiso para usar la cámara. Habilitalo en el navegador y volvé a intentar." : "No se pudo abrir la cámara de este teléfono.";
    $("m-reintentar").hidden = false;
    $("m-reintentar").onclick = () => {
      $("m-reintentar").hidden = true;
      empezar();
    };
    return;
  }
  const video = $("m-video");
  video.srcObject = stream;
  await video.play();
  let landmarker;
  try {
    [landmarker] = await Promise.all([cargarLandmarker(), cargarReconocedor()]);
  } catch {
    detener();
    return fallo("No se pudo preparar el reconocimiento en este teléfono.");
  }
  activo = true;
  const muestras = [];
  let ultimo = 0;
  let ultimoT = -1;

  const ciclo = async () => {
    if (!activo) return;
    const ahora = performance.now();
    if (video.readyState >= 2 && video.currentTime !== ultimoT && ahora - ultimo >= ENTRE_MUESTRAS_MS) {
      ultimoT = video.currentTime;
      ultimo = ahora;
      try {
        const caras = landmarker.detectForVideo(video, ahora).faceLandmarks || [];
        if (caras.length === 0) $("m-guia").textContent = "No veo tu cara. Mirá a la cámara.";
        else if (caras.length > 1) $("m-guia").textContent = "Tiene que aparecer una sola persona.";
        else {
          const lm = caras[0];
          const xs = lm.map((p) => p.x);
          const ancho = Math.max(...xs) - Math.min(...xs);
          const mitadOjos = (lm[468].x + lm[473].x) / 2;
          const entreOjos = Math.abs(lm[473].x - lm[468].x) || 1;
          if (ancho < 0.3) $("m-guia").textContent = "Acercá un poco el teléfono a tu cara.";
          else if (ancho > 0.9) $("m-guia").textContent = "Alejá un poco el teléfono.";
          else if (Math.abs(lm[1].x - mitadOjos) / entreOjos > 0.3) $("m-guia").textContent = "Mirá de frente a la cámara.";
          else {
            muestras.push(await embeddingDe(video, lm, video.videoWidth, video.videoHeight));
            $("m-barra").style.width = `${Math.round((muestras.length / MUESTRAS) * 100)}%`;
            $("m-guia").textContent = "Quedate quieto un momento…";
          }
        }
      } catch {
        /* un cuadro que falla se ignora */
      }
      if (muestras.length >= MUESTRAS) {
        detener();
        vector = promediar(muestras);
        return enviar();
      }
    }
    requestAnimationFrame(ciclo);
  };
  requestAnimationFrame(ciclo);
}

function fallo(texto, reintento) {
  mostrar("final");
  $("m-final").className = "mal";
  $("m-final").textContent = texto;
  $("m-reintentar").hidden = false;
  $("m-reintentar").onclick = () => {
    $("m-reintentar").hidden = true;
    reintento();
  };
}

async function enviar() {
  mostrar("final");
  $("m-final").className = "estado-cli";
  $("m-final").textContent = "Guardando tu registro…";
  $("m-reintentar").hidden = true;
  try {
    const { data, error } = await cliente.rpc("registrar_con_invitacion", { p_token: token, p_embedding: Array.from(vector) });
    if (error) throw error;
    if (!data) return invalido("Este enlace venció o ya se usó. Pedile a la recepción un código nuevo.");
    vector = null;
    $("m-final").className = "ok";
    $("m-final").textContent = "¡Listo! Ya estás registrado. Podés cerrar esta página o ver tu expresión en tu teléfono.";
    $("m-ver").hidden = false;
    $("m-ver").onclick = () => {
      location.href = `mi-animo.html#n=${encodeURIComponent($("m-nombre").textContent)}`;
    };
  } catch {
    fallo("No se pudo guardar tu registro. Revisá tu conexión.", enviar);
  }
}

$("m-consent").addEventListener("change", (e) => ($("m-empezar").disabled = !e.target.checked));
$("m-empezar").addEventListener("click", empezar);
window.addEventListener("pagehide", detener);

iniciar();
