import test from "node:test";
import assert from "node:assert/strict";
import { PLANTILLA, similitud2D, preprocesar, normalizar, promediar, coseno, buscar, puntosDe, TAM } from "../js/reconocer.js";

const aplicar = (t, [x, y]) => [t.a * x - t.b * y + t.tx, t.b * x + t.a * y + t.ty];

test("similitud2D recupera una transformación conocida", () => {
  const real = { a: 1.8 * Math.cos(0.3), b: 1.8 * Math.sin(0.3), tx: 250, ty: 130 };
  // origen = puntos de la imagen; la transformación real los lleva a la plantilla
  const origen = PLANTILLA.map((p) => aplicar({ a: real.a, b: -real.b, tx: 0, ty: 0 }, p).map((v, i) => v + [400, 220][i]));
  const t = similitud2D(origen, PLANTILLA);
  const vuelta = origen.map((p) => aplicar(t, p));
  vuelta.forEach((p, i) => {
    assert.ok(Math.abs(p[0] - PLANTILLA[i][0]) < 1e-6);
    assert.ok(Math.abs(p[1] - PLANTILLA[i][1]) < 1e-6);
  });
});

test("similitud2D es la identidad si ya coinciden", () => {
  const t = similitud2D(PLANTILLA, PLANTILLA);
  assert.ok(Math.abs(t.a - 1) < 1e-9 && Math.abs(t.b) < 1e-9 && Math.abs(t.tx) < 1e-9 && Math.abs(t.ty) < 1e-9);
});

test("preprocesar usa orden NCHW en RGB y rango [-1, 1]", () => {
  const rgba = new Uint8ClampedArray(TAM * TAM * 4);
  for (let i = 0; i < TAM * TAM; i++) rgba.set([255, 0, 127.5, 255], i * 4);
  const t = preprocesar(rgba);
  assert.equal(t.length, 3 * TAM * TAM);
  assert.ok(Math.abs(t[0] - 1) < 1e-6);
  assert.ok(Math.abs(t[TAM * TAM] + 1) < 1e-6);
  assert.ok(Math.abs(t[2 * TAM * TAM]) < 0.01);
});

test("normalizar, promediar y coseno", () => {
  assert.ok(Math.abs(coseno(normalizar([3, 4]), normalizar([3, 4])) - 1) < 1e-6);
  assert.ok(Math.abs(coseno(normalizar([1, 0]), normalizar([0, 1]))) < 1e-6);
  const p = promediar([normalizar([1, 0]), normalizar([0, 1])]);
  assert.ok(Math.abs(Math.hypot(...p) - 1) < 1e-6);
});

test("buscar elige a la persona correcta y respeta el umbral", () => {
  const galeria = [
    { id: 1, nombre: "Ana", embedding: normalizar([1, 0, 0]) },
    { id: 2, nombre: "Beto", embedding: normalizar([0, 1, 0]) },
  ];
  assert.equal(buscar(normalizar([0.9, 0.1, 0]), galeria).persona.nombre, "Ana");
  assert.equal(buscar(normalizar([0, 0, 1]), galeria), null);
  assert.equal(buscar(normalizar([1, 0, 0]), []), null);
});

test("puntosDe toma los 5 puntos y escala a píxeles", () => {
  const lm = Array.from({ length: 478 }, (_, i) => ({ x: i / 1000, y: 0.5 }));
  const p = puntosDe(lm, 1000, 500);
  assert.equal(p.length, 5);
  assert.deepEqual(p[2], [1, 250]);
  assert.deepEqual(p[0], [468, 250]);
});

import { decidirIdentidad } from "../js/reconocer.js";

const ana = { id: 1, nombre: "Ana" };
const beto = { id: 2, nombre: "Beto" };
const coincide = (persona, similitud = 0.7) => ({ persona, similitud });

test("sin nadie reconocido, una coincidencia reconoce de inmediato", () => {
  assert.equal(decidirIdentidad(null, coincide(ana)).accion, "reconocer");
  assert.equal(decidirIdentidad(null, null).accion, "ninguna");
});

test("la misma persona reinicia las dudas", () => {
  const dudando = decidirIdentidad(ana, coincide(beto)).estado;
  assert.equal(dudando.dudas, 1);
  assert.deepEqual(decidirIdentidad(ana, coincide(ana), dudando).estado, { candidato: null, dudas: 0 });
});

test("llega otra persona registrada: cambia solo tras dos lecturas seguidas", () => {
  const r1 = decidirIdentidad(ana, coincide(beto));
  assert.equal(r1.accion, "ninguna");
  const r2 = decidirIdentidad(ana, coincide(beto), r1.estado);
  assert.equal(r2.accion, "cambiar");
  assert.equal(r2.persona.nombre, "Beto");
});

test("llega alguien no registrado: se olvida la identidad tras dos lecturas seguidas", () => {
  const r1 = decidirIdentidad(ana, null);
  assert.equal(r1.accion, "ninguna");
  assert.equal(decidirIdentidad(ana, null, r1.estado).accion, "olvidar");
});

test("una lectura dudosa aislada no cambia nada", () => {
  const r1 = decidirIdentidad(ana, null);
  const r2 = decidirIdentidad(ana, coincide(ana), r1.estado);
  assert.equal(r2.accion, "ninguna");
  assert.equal(decidirIdentidad(ana, null, r2.estado).accion, "ninguna");
});

test("lecturas alternadas entre candidatos distintos no cambian la identidad", () => {
  const r1 = decidirIdentidad(ana, coincide(beto));
  const r2 = decidirIdentidad(ana, null, r1.estado);
  assert.equal(r2.accion, "ninguna");
  assert.equal(r2.estado.dudas, 1);
});
