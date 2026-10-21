import test from "node:test";
import assert from "node:assert/strict";
import { matrizConfusion, metricasPorClase, exactitud, resumenReconocimiento, aCSV, porcentaje, COLUMNAS } from "../js/evaluacion-calculo.js";

const r = (participante, esperada, predicha, confianza = 0.8) => ({ participante, esperada, predicha, confianza });

test("la matriz cuenta cada par esperada/predicha y admite 'incierto'", () => {
  const m = matrizConfusion([r("P1", "feliz", "feliz"), r("P1", "feliz", "neutral"), r("P2", "enojado", "incierto"), r("P2", "x", "feliz")]);
  assert.equal(m.total, 3);
  assert.equal(m.matriz[1][1], 1); // feliz → feliz
  assert.equal(m.matriz[1][0], 1); // feliz → neutral
  assert.equal(m.matriz[4][COLUMNAS.indexOf("incierto")], 1);
});

test("exactitud y métricas por clase", () => {
  const m = matrizConfusion([
    r("P1", "feliz", "feliz"), r("P2", "feliz", "feliz"), r("P3", "feliz", "neutral"),
    r("P1", "neutral", "neutral"), r("P2", "neutral", "feliz"),
  ]);
  assert.equal(exactitud(m), 3 / 5);
  const feliz = metricasPorClase(m).find((c) => c.clase === "feliz");
  assert.equal(feliz.pedidas, 3);
  assert.equal(feliz.aciertos, 2);
  assert.equal(feliz.recall, 2 / 3);
  assert.equal(feliz.precision, 2 / 3); // predichas feliz: 3 (2 bien, 1 era neutral)
  const triste = metricasPorClase(m).find((c) => c.clase === "triste");
  assert.equal(triste.recall, null);
  assert.equal(exactitud(matrizConfusion([])), null);
});

// Vectores de 3 dimensiones, ya normalizados, alcanzan para probar la lógica.
const v = (...x) => {
  const n = Math.hypot(...x);
  return x.map((y) => y / n);
};

test("reconocimiento: identifica, calcula TAR y FAR con el umbral", () => {
  const ps = [
    { id: "A", registro: v(1, 0, 0), verificacion: v(0.95, 0.1, 0) },
    { id: "B", registro: v(0, 1, 0), verificacion: v(0.1, 0.95, 0) },
    { id: "C", registro: v(0, 0, 1), verificacion: v(0, 0.1, 0.95) },
  ];
  const x = resumenReconocimiento(ps, 0.4);
  assert.equal(x.participantes, 3);
  assert.equal(x.tar, 1);
  assert.equal(x.far, 0);
  assert.equal(x.identificados, 3);
  assert.equal(x.tasaIdentificacion, 1);
  assert.equal(x.genuinos.n, 3);
  assert.equal(x.impostores.n, 6);
});

test("reconocimiento: detecta no reconocidos y confundidos", () => {
  const ps = [
    { id: "A", registro: v(1, 0, 0), verificacion: v(0, 0, 1) }, // no se parece a nadie
    { id: "B", registro: v(0, 1, 0), verificacion: v(1, 0.1, 0) }, // se parece a A
    { id: "C", registro: v(0, 0, 1), verificacion: v(0, 0.1, 1) },
  ];
  const x = resumenReconocimiento(ps, 0.4);
  assert.equal(x.identificados, 1);
  assert.equal(x.confundidos, 2); // A se parece a C, B se parece a A
  assert.equal(x.noReconocidos, 0);
  assert.ok(x.far > 0);
  const alto = resumenReconocimiento(ps, 0.999);
  assert.equal(alto.noReconocidos, 2);
  assert.equal(alto.confundidos, 1);
});

test("con un solo participante no hay impostores y no se rompe", () => {
  const x = resumenReconocimiento([{ id: "A", registro: v(1, 0), verificacion: v(1, 0.1) }]);
  assert.equal(x.far, null);
  assert.equal(x.identificados, 1);
  assert.equal(resumenReconocimiento([]).tasaIdentificacion, null);
});

test("CSV y porcentaje con coma decimal", () => {
  assert.equal(aCSV([r("P1", "feliz", "feliz", 0.8766)]), "participante,esperada,predicha,confianza\nP1,feliz,feliz,0.877");
  assert.equal(porcentaje(0.8571), "85,7 %");
  assert.equal(porcentaje(null), "–");
});
