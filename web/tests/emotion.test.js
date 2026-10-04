import test from "node:test";
import assert from "node:assert/strict";
import { puntuarEmociones, probabilidades, restarReposo, reposoDesdeMuestras, promediar, ganadora, ETIQUETAS } from "../js/emotion.js";

const top = (bs, reposo = null) => {
  const p = puntuarEmociones(bs, reposo);
  return [Object.keys(p).reduce((a, b) => (p[a] >= p[b] ? a : b)), p];
};

test("cara neutra no activa emociones", () => {
  const [, p] = top({ browDownLeft: 0.12, browDownRight: 0.12, mouthPucker: 0.14, eyeSquintLeft: 0.45 });
  assert.ok(Math.max(...Object.values(p)) < 0.3);
});

test("sonrisa moderada es feliz", () => {
  const [g, p] = top({ mouthSmileLeft: 0.4, mouthSmileRight: 0.38 });
  assert.equal(g, "feliz");
  assert.ok(p.feliz > 0.9);
});

test("sonrisa leve supera el prior de neutral", () => {
  const [, p] = top({ mouthSmileLeft: 0.15, mouthSmileRight: 0.15 });
  assert.ok(p.feliz > 0.3);
});

test("sorpresa", () => {
  const [g] = top({ jawOpen: 0.4, browInnerUp: 0.4, browOuterUpLeft: 0.3, eyeWideLeft: 0.4 });
  assert.equal(g, "sorprendido");
});

test("ceño solo no alcanza para enojo", () => {
  const [, p] = top({ browDownLeft: 0.33, browDownRight: 0.33 });
  assert.ok(p.enojado < 0.2);
});

test("enojo con ojos tensos y labios apretados", () => {
  const [g] = top({ browDownLeft: 0.5, browDownRight: 0.5, eyeSquintLeft: 0.6, eyeSquintRight: 0.6, mouthPressLeft: 0.25, mouthPressRight: 0.25 });
  assert.equal(g, "enojado");
});

test("tristeza gana a enojo con comisuras abajo", () => {
  const [g] = top({ browDownLeft: 0.3, browDownRight: 0.3, mouthFrownLeft: 0.4, mouthFrownRight: 0.4, browInnerUp: 0.3 });
  assert.equal(g, "triste");
});

test("asco", () => {
  const [g] = top({ noseSneerLeft: 0.4, noseSneerRight: 0.4, mouthUpperUpLeft: 0.4, mouthUpperUpRight: 0.4 });
  assert.equal(g, "asco");
});

test("sonreír apaga emociones negativas", () => {
  const [, p] = top({ mouthSmileLeft: 0.5, mouthSmileRight: 0.5, browDownLeft: 0.6, browDownRight: 0.6 });
  assert.ok(p.enojado < 0.1);
});

test("la calibración personal neutraliza el reposo", () => {
  const reposo = { browDownLeft: 0.3, browDownRight: 0.3, eyeSquintLeft: 0.5, eyeSquintRight: 0.5 };
  assert.ok(top(reposo)[1].enojado > 0.1);
  assert.ok(Math.max(...Object.values(top(reposo, reposo)[1])) < 0.05);
});

test("restarReposo no devuelve negativos", () => {
  assert.equal(restarReposo({ jawOpen: 0.1 }, { jawOpen: 0.4 }).jawOpen, 0);
});

test("probabilidades suman 1 e incluyen neutral", () => {
  const p = probabilidades({ mouthSmileLeft: 0.4, mouthSmileRight: 0.4 });
  assert.equal(Object.keys(p).length, ETIQUETAS.length);
  assert.ok(Math.abs(Object.values(p).reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.equal(ganadora(p).emocion, "feliz");
});

test("neutral gana sin gestos y 'incierto' si nadie llega al umbral", () => {
  assert.equal(ganadora(probabilidades({})).emocion, "neutral");
  const repartida = Object.fromEntries(ETIQUETAS.map((e) => [e, 1 / ETIQUETAS.length]));
  assert.equal(ganadora(repartida).emocion, "incierto");
});

test("reposoDesdeMuestras usa la mediana y promediar normaliza", () => {
  const reposo = reposoDesdeMuestras([{ a: 0.1 }, { a: 0.2 }, { a: 0.9 }]);
  assert.equal(reposo.a, 0.2);
  const prom = promediar([probabilidades({}), probabilidades({ mouthSmileLeft: 0.4, mouthSmileRight: 0.4 })]);
  assert.ok(Math.abs(Object.values(prom).reduce((a, b) => a + b, 0) - 1) < 1e-9);
});
