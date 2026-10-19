import test from "node:test";
import assert from "node:assert/strict";
import { planificarSincronia } from "../js/sincronia.js";

const U = "usuario-1";
const vec = [0.1, 0.2];
const local = (uid, ts = "2026-10-03T10:00:00.000Z", nube) => ({ uid, nombre: uid, consentimiento_ts: ts, ...(nube ? { nube } : {}) });
const remoto = (uid, ts = "2026-10-03T10:00:00.000Z", embedding = vec) => ({ uid, nombre: uid, consentimiento_ts: ts, embedding });

test("un cliente que solo está en la nube se descarga", () => {
  const p = planificarSincronia([], [remoto("a")], U);
  assert.deepEqual(p.descargar.map((x) => x.uid), ["a"]);
  assert.equal(p.subir.length + p.borrarLocal.length, 0);
});

test("un cliente nuevo de este navegador, nunca sincronizado, se sube", () => {
  const p = planificarSincronia([local("a")], [], U);
  assert.deepEqual(p.subir.map((x) => x.uid), ["a"]);
  assert.equal(p.borrarLocal.length, 0);
});

test("si ya estaba sincronizado y desapareció de la nube, lo borraron en otro equipo", () => {
  const p = planificarSincronia([local("a", undefined, U)], [], U);
  assert.deepEqual(p.borrarLocal, ["a"]);
  assert.equal(p.subir.length, 0);
});

test("los clientes de otro usuario no se tocan", () => {
  const p = planificarSincronia([local("a", undefined, "otro")], [], U);
  assert.deepEqual(p, { descargar: [], subir: [], borrarLocal: [], marcar: [] });
});

test("en los dos lados gana la fecha más nueva", () => {
  const nuevoRemoto = planificarSincronia([local("a", "2026-10-03T10:00:00Z", U)], [remoto("a", "2026-10-03T11:00:00Z")], U);
  assert.deepEqual(nuevoRemoto.descargar.map((x) => x.uid), ["a"]);
  const nuevoLocal = planificarSincronia([local("a", "2026-10-03T12:00:00Z", U)], [remoto("a", "2026-10-03T11:00:00Z")], U);
  assert.deepEqual(nuevoLocal.subir.map((x) => x.uid), ["a"]);
});

test("con la misma fecha no se copia nada y se marca como sincronizado", () => {
  const p = planificarSincronia([local("a")], [remoto("a")], U);
  assert.deepEqual(p.marcar, ["a"]);
  assert.equal(p.descargar.length + p.subir.length, 0);
  assert.deepEqual(planificarSincronia([local("a", undefined, U)], [remoto("a")], U).marcar, []);
});

test("una ficha de la nube sin vector se completa subiendo la local", () => {
  const p = planificarSincronia([local("a")], [remoto("a", undefined, null)], U);
  assert.deepEqual(p.subir.map((x) => x.uid), ["a"]);
  assert.equal(p.borrarLocal.length, 0);
});

test("una ficha de la nube sin vector y sin copia local se ignora", () => {
  const p = planificarSincronia([], [remoto("a", undefined, null)], U);
  assert.deepEqual(p, { descargar: [], subir: [], borrarLocal: [], marcar: [] });
});

test("fechas ilegibles no provocan descargas ni subidas", () => {
  const p = planificarSincronia([local("a", "t")], [remoto("a")], U);
  assert.equal(p.descargar.length + p.subir.length, 0);
});
