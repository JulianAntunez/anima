import test from "node:test";
import assert from "node:assert/strict";
import { nuevaSala, SALA_RE, leerLectura, Conectados } from "../js/sala.js";

const id = (n) => `0000000${n}-aaaa-bbbb-cccc-000000000000`;
const msg = (n, emocion = "feliz", nombre = "Ana") => ({ id: id(n), nombre, emocion, confianza: 0.8 });

test("la sala es un código largo al azar", () => {
  const a = nuevaSala();
  assert.match(a, SALA_RE);
  assert.notEqual(a, nuevaSala());
});

test("leerLectura acepta mensajes válidos y limpia el texto", () => {
  const l = leerLectura({ id: id(1), nombre: "  Ana\n\t María ", emocion: "feliz", confianza: 5 });
  assert.equal(l.nombre, "Ana   María");
  assert.equal(l.confianza, 1);
  assert.equal(leerLectura({ id: id(1), emocion: "ninguno" }).confianza, 0);
});

test("leerLectura descarta mensajes mal formados o con datos inesperados", () => {
  for (const malo of [null, "x", 5, {}, { id: "../etc", emocion: "feliz" }, { id: id(1), emocion: "<img onerror=x>" }, { id: 7, emocion: "feliz" }]) {
    assert.equal(leerLectura(malo), null, JSON.stringify(malo));
  }
  assert.equal(leerLectura({ id: id(1), emocion: "feliz", nombre: { x: 1 } }).nombre, "");
  assert.equal(leerLectura({ id: id(1), emocion: "feliz", nombre: "x".repeat(200) }).nombre.length, 60);
});

test("un teléfono se actualiza con cada lectura y se ordena por nombre", () => {
  const c = new Conectados();
  c.recibir(msg(1, "feliz", "Beto"), 0);
  c.recibir(msg(2, "neutral", "Ana"), 0);
  c.recibir(msg(1, "triste", "Beto"), 1000);
  const v = c.vigentes(1500);
  assert.deepEqual(v.map((x) => x.nombre), ["Ana", "Beto"]);
  assert.equal(v[1].emocion, "triste");
});

test("quien deja de enviar lecturas desaparece tras el tiempo de gracia", () => {
  const c = new Conectados({ ttlMs: 4000 });
  c.recibir(msg(1), 0);
  c.recibir(msg(2, "neutral", "Beto"), 3000);
  assert.equal(c.vigentes(3500).length, 2);
  assert.deepEqual(c.vigentes(5000).map((x) => x.nombre), ["Beto"]);
  assert.equal(c.vigentes(9000).length, 0);
});

test("quitar saca a un teléfono de inmediato y hay un máximo de conectados", () => {
  const c = new Conectados({ maximo: 2 });
  assert.ok(c.recibir(msg(1), 0));
  assert.ok(c.recibir(msg(2), 0));
  assert.equal(c.recibir(msg(3), 0), false);
  assert.ok(c.recibir(msg(1, "triste"), 10));
  assert.ok(c.quitar(id(1)));
  assert.ok(c.recibir(msg(3), 20));
});

test("sin nombre se muestra al final de la lista", () => {
  const c = new Conectados();
  c.recibir(msg(1, "feliz", ""), 0);
  c.recibir(msg(2, "feliz", "Zoe"), 0);
  assert.deepEqual(c.vigentes(1).map((x) => x.nombre), ["Zoe", ""]);
});
