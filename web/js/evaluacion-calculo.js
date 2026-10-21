// Cálculo de resultados del modo evaluación (sin dependencias de navegador, se prueba con Node).
//
// resultados:    [{ participante, esperada, predicha, confianza }]   predicha puede ser "incierto"
// participantes: [{ id, registro: number[512], verificacion: number[512] }]

import { ETIQUETAS } from "./emotion.js";

export const COLUMNAS = [...ETIQUETAS, "incierto"];

export function matrizConfusion(resultados) {
  const matriz = ETIQUETAS.map(() => COLUMNAS.map(() => 0));
  let total = 0;
  for (const r of resultados) {
    const i = ETIQUETAS.indexOf(r.esperada);
    const j = COLUMNAS.indexOf(r.predicha);
    if (i < 0 || j < 0) continue;
    matriz[i][j] += 1;
    total += 1;
  }
  return { filas: ETIQUETAS, columnas: COLUMNAS, matriz, total };
}

// Por expresión: cuántas veces se pidió, cuántas acertó, y precisión / exhaustividad (recall) / F1.
export function metricasPorClase({ matriz }) {
  return ETIQUETAS.map((clase, i) => {
    const pedidas = matriz[i].reduce((a, b) => a + b, 0);
    const aciertos = matriz[i][i];
    const predichas = matriz.reduce((s, fila) => s + fila[i], 0);
    const recall = pedidas ? aciertos / pedidas : null;
    const precision = predichas ? aciertos / predichas : null;
    const f1 = recall !== null && precision !== null && recall + precision > 0 ? (2 * recall * precision) / (recall + precision) : null;
    return { clase, pedidas, aciertos, predichas, recall, precision, f1 };
  });
}

export function exactitud({ matriz, total }) {
  if (!total) return null;
  return ETIQUETAS.reduce((s, _, i) => s + matriz[i][i], 0) / total;
}

const coseno = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

const resumen = (valores) => {
  if (!valores.length) return { n: 0, media: null, min: null, max: null };
  return { n: valores.length, media: valores.reduce((a, b) => a + b, 0) / valores.length, min: Math.min(...valores), max: Math.max(...valores) };
};

// Reconocimiento: cada participante se registra una vez y más tarde se verifica con una captura nueva.
//  - genuinos:   registro propio contra su verificación (debería superar el umbral)
//  - impostores: registro de otra persona contra la verificación (debería quedar por debajo)
//  - identificación: la verificación se busca entre todos los registros y debe devolver a la misma persona
export function resumenReconocimiento(participantes, umbral = 0.4) {
  const genuinos = [];
  const impostores = [];
  let identificados = 0;
  let noReconocidos = 0;
  let confundidos = 0;

  for (const p of participantes) {
    genuinos.push(coseno(p.registro, p.verificacion));
    let mejor = null;
    for (const q of participantes) {
      const s = coseno(q.registro, p.verificacion);
      if (q.id !== p.id) impostores.push(s);
      if (!mejor || s > mejor.s) mejor = { s, id: q.id };
    }
    if (!mejor || mejor.s < umbral) noReconocidos += 1;
    else if (mejor.id === p.id) identificados += 1;
    else confundidos += 1;
  }

  const n = participantes.length;
  return {
    umbral,
    participantes: n,
    genuinos: resumen(genuinos),
    impostores: resumen(impostores),
    tar: genuinos.length ? genuinos.filter((s) => s >= umbral).length / genuinos.length : null, // aceptación de genuinos
    far: impostores.length ? impostores.filter((s) => s >= umbral).length / impostores.length : null, // falsa aceptación
    identificados,
    noReconocidos,
    confundidos,
    tasaIdentificacion: n ? identificados / n : null,
  };
}

export function aCSV(resultados) {
  const filas = resultados.map((r) => [r.participante, r.esperada, r.predicha, Number(r.confianza).toFixed(3)].join(","));
  return ["participante,esperada,predicha,confianza", ...filas].join("\n");
}

export const porcentaje = (x) => (x === null || x === undefined ? "–" : `${(x * 100).toFixed(1).replace(".", ",")} %`);
