import test from "node:test";
import assert from "node:assert/strict";
import { iou, asociarCaras, principalDe } from "../js/seguimiento.js";

const caja = (x, y, w = 0.2, h = 0.3) => ({ x, y, w, h });

test("iou: idénticas valen 1, separadas valen 0", () => {
  assert.ok(Math.abs(iou(caja(0.1, 0.1), caja(0.1, 0.1)) - 1) < 1e-9);
  assert.equal(iou(caja(0.0, 0.0), caja(0.7, 0.6)), 0);
});

test("una cara que se mueve poco conserva su correspondencia", () => {
  assert.deepEqual(asociarCaras([caja(0.1, 0.1)], [caja(0.12, 0.11)]), [0]);
});

test("dos caras se asocian cada una a la suya aunque cambie el orden", () => {
  const previas = [caja(0.05, 0.2), caja(0.65, 0.2)];
  const nuevas = [caja(0.66, 0.21), caja(0.06, 0.2)];
  assert.deepEqual(asociarCaras(previas, nuevas), [1, 0]);
});

test("una cara nueva lejos de las anteriores devuelve -1", () => {
  assert.deepEqual(asociarCaras([caja(0.05, 0.2)], [caja(0.06, 0.2), caja(0.7, 0.5)]), [0, -1]);
  assert.deepEqual(asociarCaras([], [caja(0.1, 0.1)]), [-1]);
  assert.deepEqual(asociarCaras([caja(0.1, 0.1)], []), []);
});

test("una caja previa no se asigna a dos caras nuevas", () => {
  const r = asociarCaras([caja(0.1, 0.1)], [caja(0.1, 0.1), caja(0.11, 0.1)]);
  assert.equal(r.filter((v) => v === 0).length, 1);
  assert.equal(r.filter((v) => v === -1).length, 1);
});

test("la principal es la de mayor área", () => {
  const caras = [{ id: 1, caja: caja(0, 0, 0.1, 0.1) }, { id: 2, caja: caja(0.5, 0, 0.3, 0.4) }, { id: 3, caja: caja(0.2, 0, 0.2, 0.2) }];
  assert.equal(principalDe(caras).id, 2);
  assert.equal(principalDe([]), null);
});
