// Reglas de emoción por blendshapes (port de core/expression.py). EMFACS:
// felicidad AU6+12, tristeza AU1+4+15, sorpresa AU1+2+5+26, enojo AU4+5+7+23, asco AU9/10, miedo AU1+2+4+5+20.

export const ETIQUETAS = ["neutral", "feliz", "sorprendido", "triste", "enojado", "asco", "miedo"];

const PRIOR_NEUTRAL_BASE = 0.5;

const REPOSO_GENERICO = {
  browDownLeft: 0.1,
  browDownRight: 0.1,
  eyeSquintLeft: 0.25,
  eyeSquintRight: 0.25,
};

const r = (x, lo, hi) => Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
const media = (d, ...nombres) => nombres.reduce((s, k) => s + (d[k] || 0), 0) / nombres.length;

export function restarReposo(bs, reposo = null) {
  const ref = reposo || REPOSO_GENERICO;
  const salida = {};
  for (const k of Object.keys(bs)) salida[k] = Math.max(0, bs[k] - (ref[k] || 0));
  return salida;
}

export function puntuarEmociones(bs, reposo = null) {
  const d = restarReposo(bs, reposo);

  const sonrisa = media(d, "mouthSmileLeft", "mouthSmileRight");
  const mejillas = media(d, "cheekSquintLeft", "cheekSquintRight");
  const cejaBaja = media(d, "browDownLeft", "browDownRight");
  const cejaInt = d.browInnerUp || 0;
  const cejaExt = media(d, "browOuterUpLeft", "browOuterUpRight");
  const ojosAbiertos = media(d, "eyeWideLeft", "eyeWideRight");
  const ojosTensos = media(d, "eyeSquintLeft", "eyeSquintRight");
  const mandibula = d.jawOpen || 0;
  const comisuraBaja = media(d, "mouthFrownLeft", "mouthFrownRight");
  const labioInf = d.mouthShrugLower || 0;
  const nariz = media(d, "noseSneerLeft", "noseSneerRight");
  const labioSup = media(d, "mouthUpperUpLeft", "mouthUpperUpRight");
  const labiosPresion = media(d, "mouthPressLeft", "mouthPressRight");
  const bocaEstirada = media(d, "mouthStretchLeft", "mouthStretchRight");

  const feliz = Math.min(1, r(sonrisa, 0.05, 0.3) + 0.25 * r(mejillas, 0.05, 0.3));

  const sorprendido = Math.min(
    1,
    0.5 * r(mandibula, 0.05, 0.3) + 0.3 * r(cejaInt, 0.03, 0.3) + 0.3 * r(cejaExt, 0.03, 0.25) + 0.3 * r(ojosAbiertos, 0.05, 0.4),
  );

  const triste =
    Math.min(
      1,
      0.6 * r(comisuraBaja, 0.05, 0.35) + 0.5 * r(labioInf, 0.15, 0.5) + 0.4 * r(cejaInt, 0.05, 0.3) + 0.2 * r(cejaBaja, 0.1, 0.45),
    ) *
    (1 - feliz);

  // El ceño solo no alcanza: hace falta otra señal (ojos tensos, labios apretados, nariz, ojos abiertos)
  const apoyoEnojo = Math.min(
    1,
    0.6 * r(ojosTensos, 0.1, 0.4) + 0.6 * r(labiosPresion, 0.05, 0.3) + 0.4 * r(nariz, 0.05, 0.3) + 0.4 * r(ojosAbiertos, 0.1, 0.4),
  );
  const enojado = r(cejaBaja, 0.1, 0.45) * (0.35 + 0.65 * apoyoEnojo) * (1 - 0.6 * r(labioInf, 0.15, 0.5)) * (1 - feliz);

  const asco = Math.min(1, 0.6 * r(nariz, 0.05, 0.35) + 0.6 * r(labioSup, 0.08, 0.4)) * (1 - feliz);

  const miedo =
    Math.min(
      1,
      0.5 * r(ojosAbiertos, 0.1, 0.45) + 0.4 * r(cejaInt, 0.1, 0.4) + 0.2 * r(cejaExt, 0.05, 0.25) + 0.4 * r(bocaEstirada, 0.1, 0.5),
    ) *
    (1 - feliz) *
    (1 - 0.7 * r(mandibula, 0.15, 0.4));

  return { feliz, sorprendido, triste, enojado, asco, miedo };
}

export function probabilidades(bs, { reposo = null, neutralBias = 0.6 } = {}) {
  const puntajes = puntuarEmociones(bs, reposo);
  const prior = PRIOR_NEUTRAL_BASE * neutralBias;
  const crudo = ETIQUETAS.map((e) => (e === "neutral" ? prior : puntajes[e] || 0));
  const total = crudo.reduce((a, b) => a + b, 0);
  const probs = {};
  ETIQUETAS.forEach((e, i) => (probs[e] = crudo[i] / total));
  return probs;
}

export function mediana(valores) {
  const v = [...valores].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export function reposoDesdeMuestras(muestras) {
  if (!muestras.length) return null;
  const reposo = {};
  for (const k of Object.keys(muestras[0])) reposo[k] = mediana(muestras.map((m) => m[k] || 0));
  return reposo;
}

export function promediar(historial) {
  const out = {};
  for (const e of ETIQUETAS) out[e] = historial.reduce((s, p) => s + p[e], 0) / historial.length;
  const total = Object.values(out).reduce((a, b) => a + b, 0);
  for (const e of ETIQUETAS) out[e] /= total;
  return out;
}

export function ganadora(probs, umbral = 0.45) {
  let mejor = "neutral";
  for (const e of ETIQUETAS) if (probs[e] > probs[mejor]) mejor = e;
  return { emocion: probs[mejor] >= umbral ? mejor : "incierto", crudo: mejor, confianza: probs[mejor] };
}
