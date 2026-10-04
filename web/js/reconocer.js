// Matemática del reconocimiento facial (sin dependencias de navegador, se prueba con Node).
// Port de core/recognizer.py: alineación a la plantilla de ArcFace (112x112) y comparación por coseno.

export const TAM = 112;
export const UMBRAL = 0.4;

// Plantilla estándar de ArcFace: ojo izq. de la imagen, ojo der. de la imagen, nariz, comisura izq., comisura der.
export const PLANTILLA = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
];

// Índices del FaceLandmarker (478 puntos): iris del ojo derecho del sujeto (izquierda de la imagen) y del izquierdo, punta de la nariz y comisuras.
export const INDICES = [468, 473, 1, 61, 291];

export function puntosDe(landmarks, ancho, alto) {
  return INDICES.map((i) => [landmarks[i].x * ancho, landmarks[i].y * alto]);
}

// Transformación de similitud (escala, rotación y traslación) que lleva origen hacia destino por mínimos cuadrados.
// u = a*x - b*y + tx ; v = b*x + a*y + ty
export function similitud2D(origen, destino) {
  const n = origen.length;
  const mx = origen.reduce((s, p) => s + p[0], 0) / n;
  const my = origen.reduce((s, p) => s + p[1], 0) / n;
  const mu = destino.reduce((s, p) => s + p[0], 0) / n;
  const mv = destino.reduce((s, p) => s + p[1], 0) / n;
  let num1 = 0;
  let num2 = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const x = origen[i][0] - mx;
    const y = origen[i][1] - my;
    const u = destino[i][0] - mu;
    const v = destino[i][1] - mv;
    num1 += x * u + y * v;
    num2 += x * v - y * u;
    den += x * x + y * y;
  }
  const a = num1 / den;
  const b = num2 / den;
  return { a, b, tx: mu - a * mx + b * my, ty: mv - b * mx - a * my };
}

// RGBA (112x112) a tensor NCHW en RGB normalizado a [-1, 1]
export function preprocesar(rgba) {
  const px = TAM * TAM;
  const out = new Float32Array(3 * px);
  for (let i = 0; i < px; i++) {
    out[i] = (rgba[i * 4] - 127.5) / 127.5;
    out[px + i] = (rgba[i * 4 + 1] - 127.5) / 127.5;
    out[2 * px + i] = (rgba[i * 4 + 2] - 127.5) / 127.5;
  }
  return out;
}

export function normalizar(v) {
  const n = Math.hypot(...v);
  return Float32Array.from(v, (x) => (n > 0 ? x / n : 0));
}

export function promediar(embeddings) {
  const dim = embeddings[0].length;
  const suma = new Float32Array(dim);
  for (const e of embeddings) for (let i = 0; i < dim; i++) suma[i] += e[i];
  return normalizar(suma);
}

export function coseno(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

// galeria: [{ id, nombre, embedding, ... }]. Devuelve { persona, similitud } o null si nadie supera el umbral.
export function buscar(emb, galeria, umbral = UMBRAL) {
  let mejor = null;
  for (const persona of galeria) {
    const s = coseno(emb, persona.embedding);
    if (!mejor || s > mejor.similitud) mejor = { persona, similitud: s };
  }
  return mejor && mejor.similitud >= umbral ? mejor : null;
}
