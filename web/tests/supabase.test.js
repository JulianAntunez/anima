import test from "node:test";
import assert from "node:assert/strict";
import { SupabaseStore } from "../js/store.js";

function clienteFalso({ falla = false } = {}) {
  const tablas = { registros: [], episodios: [] };
  const consulta = (nombre) => {
    let filas = tablas[nombre];
    const q = {
      insert: async (f) => (falla ? { error: new Error("sin red") } : (tablas[nombre].push(...f), { error: null })),
      select: () => q,
      gte: (col, v) => ((filas = filas.filter((x) => x[col] >= v)), q),
      lt: (col, v) => ((filas = filas.filter((x) => x[col] < v)), q),
      order: () => q,
      range: async () => ({ data: filas, error: null }),
      delete: () => ({ gte: async () => ((tablas[nombre] = []), { error: null }) }),
    };
    return q;
  };
  return { from: consulta, tablas };
}

test("agrupa y envía registros y episodios", async () => {
  const c = clienteFalso();
  const s = new SupabaseStore(c, { intervaloMs: 10 });
  const t0 = new Date("2026-10-03T10:00:00").getTime();
  await s.agregarRegistro({ ts: t0, emocion: "feliz", confianza: 0.9, episodio: 1 });
  await s.agregarEpisodio({ id: 1, inicio: t0, fin: t0 + 5000, duracion: 5000, dominante: "feliz", alerta: false });
  await s.vaciar();
  assert.equal(c.tablas.registros.length, 1);
  assert.equal(c.tablas.registros[0].emocion, "feliz");
  assert.equal(c.tablas.episodios[0].duracion_ms, 5000);
});

test("reintenta y avisa cuando falla el envío", async () => {
  const c = clienteFalso({ falla: true });
  const s = new SupabaseStore(c, { intervaloMs: 60000 });
  let errores = 0;
  s.onError = () => errores++;
  await s.agregarRegistro({ ts: Date.now(), emocion: "neutral", confianza: 0.5 });
  await s.vaciar();
  assert.equal(errores, 1);
  assert.equal(s.cola.registros.length, 1);
  clearTimeout(s.timer);
});

test("carga el día en el formato interno", async () => {
  const c = clienteFalso();
  const s = new SupabaseStore(c, { intervaloMs: 10 });
  const t0 = new Date("2026-10-03T10:00:00").getTime();
  await s.agregarRegistro({ ts: t0, emocion: "triste", confianza: 0.6, episodio: 7 });
  await s.agregarEpisodio({ id: 7, inicio: t0, fin: t0 + 60000, duracion: 60000, dominante: "triste", alerta: true });
  await s.vaciar();
  const d = await s.cargarDia("2026-10-03");
  assert.equal(d.registros[0].ts, t0);
  assert.equal(d.episodios[0].duracion, 60000);
  assert.equal(d.episodios[0].alerta, true);
  assert.equal((await s.cargarDia("2026-10-04")).registros.length, 0);
});
