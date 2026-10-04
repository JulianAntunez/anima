import test from "node:test";
import assert from "node:assert/strict";
import { limpiarTexto, datosCliente, CANAL } from "../js/canal.js";
import { CLIENTE, animoCliente, ANIMOS } from "../js/mood.js";
import { ETIQUETAS } from "../js/emotion.js";

test("limpiarTexto recorta, quita controles y limita el largo", () => {
  assert.equal(limpiarTexto("  Julián\n\tAntúnez  "), "Julián  Antúnez");
  assert.equal(limpiarTexto("x".repeat(100)).length, 60);
  assert.equal(limpiarTexto(null), "");
});

test("datosCliente arma el mensaje con límites por campo", () => {
  const d = datosCliente({ nombre: "Ana", habitacion: "4020000000000", estadia: "Hasta el 07/10" });
  assert.equal(d.tipo, "cliente");
  assert.equal(d.habitacion.length, 12);
  assert.deepEqual(datosCliente(), { tipo: "cliente", nombre: "", habitacion: "", estadia: "" });
  assert.equal(CANAL, "anima-cliente");
});

test("el cliente tiene mensaje para todas las expresiones y para 'sin cliente'", () => {
  for (const e of [...ETIQUETAS, "incierto", "ninguno"]) {
    const a = animoCliente(e);
    assert.ok(a.nombre && a.mensaje && a.icono, e);
  }
});

test("la pantalla del cliente nunca usa colores ni palabras de alerta", () => {
  const prohibidas = /molest|enoj|incómod|alerta|asco|miedo/i;
  for (const [emocion, a] of Object.entries(CLIENTE)) {
    assert.notEqual(a.tono, "alerta", emocion);
    assert.ok(!prohibidas.test(a.nombre + " " + a.mensaje), `${emocion}: ${a.nombre} / ${a.mensaje}`);
  }
  assert.equal(ANIMOS.enojado.tono, "alerta");
});
