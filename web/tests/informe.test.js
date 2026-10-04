import test from "node:test";
import assert from "node:assert/strict";
import { distribucionTonos, agruparPorDia, fmtFecha, mmss } from "../js/informe.js";
import { LocalStore } from "../js/store.js";

const t = (d, h) => new Date(`2026-10-0${d}T${String(h).padStart(2, "0")}:00:00`).getTime();

test("distribucionTonos ignora lo incierto y cuenta por tono", () => {
  const { conteo, total } = distribucionTonos([
    { emocion: "feliz" }, { emocion: "neutral" }, { emocion: "enojado" }, { emocion: "asco" }, { emocion: "incierto" }, { emocion: "triste" },
  ]);
  assert.equal(total, 5);
  assert.deepEqual(conteo, { positivo: 1, neutral: 1, atencion: 1, alerta: 2 });
});

test("agruparPorDia resume cada día por separado y en orden", () => {
  const datos = {
    registros: [
      { ts: t(2, 10), emocion: "feliz", confianza: 0.9 },
      { ts: t(1, 9), emocion: "neutral", confianza: 0.8 },
      { ts: t(1, 9) + 1000, emocion: "enojado", confianza: 0.7 },
    ],
    episodios: [
      { id: 1, inicio: t(1, 9), fin: t(1, 9) + 60000, duracion: 60000, dominante: "neutral", alerta: true },
      { id: 2, inicio: t(2, 10), fin: t(2, 10) + 30000, duracion: 30000, dominante: "feliz", alerta: false },
    ],
  };
  const dias = agruparPorDia(datos);
  assert.deepEqual(dias.map((d) => d.fecha), ["2026-10-01", "2026-10-02"]);
  assert.equal(dias[0].alertas, 1);
  assert.equal(dias[0].indiceAnimo, 50);
  assert.equal(dias[1].indiceAnimo, 100);
  assert.equal(dias[1].tiempoMedio, 30000);
});

test("formatos de fecha y duración", () => {
  assert.equal(fmtFecha("2026-10-03"), "03/10/2026");
  assert.equal(mmss(125000), "2:05");
});

test("LocalStore.cargarRango junta varios días", async () => {
  const mem = new Map();
  const storage = { get length() { return mem.size; }, key: (i) => [...mem.keys()][i] ?? null, getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  const s = new LocalStore(storage);
  const ahora = Date.now();
  await s.agregarRegistro({ ts: ahora, emocion: "feliz", confianza: 0.9 });
  await s.agregarRegistro({ ts: ahora - 2 * 86400000, emocion: "neutral", confianza: 0.9 });
  await s.agregarRegistro({ ts: ahora - 10 * 86400000, emocion: "triste", confianza: 0.9 });
  assert.equal((await s.cargarRango(1)).registros.length, 1);
  assert.equal((await s.cargarRango(7)).registros.length, 2);
  assert.equal((await s.cargarRango(30)).registros.length, 3);
});
