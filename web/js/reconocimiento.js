// Embeddings faciales en el navegador (ArcFace MobileFaceNet con ONNX Runtime Web).
// Nada sale del equipo: el modelo se descarga una vez y la inferencia corre localmente.

import { TAM, puntosDe, similitud2D, PLANTILLA, preprocesar, normalizar } from "./reconocer.js";

const ORT = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist";
const MODELO = "models/w600k_mbf.onnx";

let cargado = null;

async function importarOrt() {
  try {
    return await import(`${ORT}/ort.min.mjs`);
  } catch {
    await new Promise((ok, mal) => {
      const s = document.createElement("script");
      s.src = `${ORT}/ort.min.js`;
      s.onload = ok;
      s.onerror = () => mal(new Error("No se pudo cargar ONNX Runtime"));
      document.head.appendChild(s);
    });
    return globalThis.ort;
  }
}

export function cargarReconocedor() {
  if (!cargado) {
    cargado = (async () => {
      const ort = await importarOrt();
      ort.env.wasm.wasmPaths = `${ORT}/`;
      ort.env.wasm.numThreads = 1; // evita requerir aislamiento de origen (SharedArrayBuffer)
      const sesion = await ort.InferenceSession.create(MODELO, { executionProviders: ["wasm"] });
      const canvas = document.createElement("canvas");
      canvas.width = TAM;
      canvas.height = TAM;
      return { ort, sesion, canvas, ctx: canvas.getContext("2d", { willReadFrequently: true }) };
    })();
    cargado.catch(() => (cargado = null));
  }
  return cargado;
}

// fuente: <video> o <img>/<canvas> sin espejar; landmarks: los 478 puntos normalizados del FaceLandmarker
export async function embeddingDe(fuente, landmarks, ancho, alto) {
  const { ort, sesion, canvas, ctx } = await cargarReconocedor();
  const t = similitud2D(puntosDe(landmarks, ancho, alto), PLANTILLA);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, TAM, TAM);
  ctx.setTransform(t.a, t.b, -t.b, t.a, t.tx, t.ty);
  ctx.drawImage(fuente, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  const datos = preprocesar(ctx.getImageData(0, 0, TAM, TAM).data);
  const entrada = new ort.Tensor("float32", datos, [1, 3, TAM, TAM]);
  const salida = await sesion.run({ [sesion.inputNames[0]]: entrada });
  return normalizar(salida[sesion.outputNames[0]].data);
}
