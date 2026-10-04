import test from "node:test";
import assert from "node:assert/strict";
import { Sesion } from "../js/sesion.js";
import { LocalStore, resumir, porHora, aCSV } from "../js/store.js";

const lectura = (emocion, confianza = 0.8) => ({ emocion, confianza });

test("registra al cambiar de emoción y cada 5 segundos", () => {
  const s = new Sesion();
  assert.equal(s.procesar(0, lectura("neutral")).registros.length, 1);
  assert.equal(s.procesar(1000, lectura("neutral")).registros.length, 0);
  assert.equal(s.procesar(2000, lectura("feliz")).registros.length, 1);
  assert.equal(s.procesar(7500, lectura("feliz")).registros.length, 1);
});

test("no registra lecturas inciertas", () => {
  const s = new Sesion();
  assert.equal(s.procesar(0, lectura("incierto")).registros.length, 0);
});

test("la atención se cierra tras la ausencia y elige la emoción dominante", () => {
  const s = new Sesion();
  for (let t = 0; t <= 6000; t += 500) s.procesar(t, lectura(t < 2000 ? "neutral" : "feliz"));
  assert.equal(s.procesar(8000, null).cerrado, null);
  const cerrado = s.procesar(11000, null).cerrado;
  assert.equal(cerrado.dominante, "feliz");
  assert.equal(cerrado.duracion, 6000);
});

test("las atenciones muy cortas se descartan", () => {
  const s = new Sesion();
  s.procesar(0, lectura("neutral"));
  s.procesar(500, lectura("neutral"));
  assert.equal(s.procesar(6000, null).cerrado, null);
});

test("alerta tras 3 segundos sostenidos de enojo, una sola vez", () => {
  const s = new Sesion();
  let alertas = 0;
  for (let t = 0; t <= 6000; t += 500) alertas += s.procesar(t, lectura("enojado")).alertaNueva ? 1 : 0;
  assert.equal(alertas, 1);
  const cerrado = s.procesar(12000, null).cerrado;
  assert.equal(cerrado.alerta, true);
});

test("un gesto breve de enojo no dispara alerta", () => {
  const s = new Sesion();
  s.procesar(0, lectura("neutral"));
  s.procesar(500, lectura("enojado"));
  s.procesar(1000, lectura("enojado"));
  s.procesar(1500, lectura("neutral"));
  for (let t = 2000; t <= 4000; t += 500) s.procesar(t, lectura("neutral"));
  assert.equal(s.procesar(9000, null).cerrado.alerta, false);
});

class MemStorage {
  constructor() {
    this.m = new Map();
  }
  get length() {
    return this.m.size;
  }
  key(i) {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k) {
    return this.m.has(k) ? this.m.get(k) : null;
  }
  setItem(k, v) {
    this.m.set(k, String(v));
  }
  removeItem(k) {
    this.m.delete(k);
  }
}

test("el almacenamiento guarda, resume y borra", async () => {
  const store = new LocalStore(new MemStorage());
  const t0 = new Date("2026-10-03T10:00:00").getTime();
  await store.agregarRegistro({ ts: t0, emocion: "feliz", confianza: 0.9, episodio: 1 });
  await store.agregarRegistro({ ts: t0 + 1000, emocion: "enojado", confianza: 0.7, episodio: 1 });
  await store.agregarRegistro({ ts: t0 + 2000, emocion: "neutral", confianza: 0.8, episodio: 1 });
  await store.agregarEpisodio({ id: 1, inicio: t0, fin: t0 + 60000, duracion: 60000, dominante: "feliz", alerta: true });
  const dia = await store.cargarDia("2026-10-03");
  const r = resumir(dia);
  assert.equal(r.clientes, 1);
  assert.equal(r.alertas, 1);
  assert.equal(r.indiceAnimo, 67);
  assert.equal(r.tiempoMedio, 60000);
  assert.equal(porHora(dia.registros)[10].positivo, 1);
  assert.ok(aCSV(dia).includes("feliz"));
  await store.borrarTodo();
  assert.equal((await store.cargarDia("2026-10-03")).registros.length, 0);
});
