import test from "node:test";
import assert from "node:assert/strict";
import { SupabaseStore } from "../js/store.js";

// falla: { tabla: error } hace fallar los insert/upsert/delete de esa tabla.
function clienteFalso({ falla = false, fallaEn = {}, sinColumnaHuesped = false } = {}) {
  const tablas = { registros: [], episodios: [], huespedes: [] };
  const llamadas = [];
  const error = (nombre) => (falla ? new Error("sin red") : fallaEn[nombre] || null);
  const consulta = (nombre) => {
    let filas = tablas[nombre];
    const q = {
      insert: async (f) => {
        llamadas.push(`insert:${nombre}`);
        if (nombre === "episodios" && sinColumnaHuesped && f.some((x) => "huesped_id" in x)) {
          return { error: { code: "PGRST204", message: "Could not find the 'huesped_id' column of 'episodios' in the schema cache" } };
        }
        const e = error(nombre);
        return e ? { error: e } : (tablas[nombre].push(...f), { error: null });
      },
      upsert: async (f) => {
        llamadas.push(`upsert:${nombre}`);
        const e = error(nombre);
        if (e) return { error: e };
        for (const fila of f) {
          const i = tablas[nombre].findIndex((x) => x.id === fila.id);
          if (i >= 0) tablas[nombre][i] = fila;
          else tablas[nombre].push(fila);
        }
        return { error: null };
      },
      select: () => q,
      gte: (col, v) => ((filas = filas.filter((x) => x[col] >= v)), q),
      lt: (col, v) => ((filas = filas.filter((x) => x[col] < v)), q),
      order: () => q,
      range: async () => ({ data: filas, error: null }),
      delete: () => ({
        gte: async () => ((tablas[nombre] = []), { error: null }),
        in: async (col, valores) => {
          llamadas.push(`delete:${nombre}`);
          const e = error(nombre);
          if (e) return { error: e };
          tablas[nombre] = tablas[nombre].filter((x) => !valores.includes(x[col]));
          return { error: null };
        },
      }),
    };
    return q;
  };
  return { from: consulta, tablas, llamadas };
}

const ficha = (uid, nombre) => ({ uid, nombre, habitacion: "204", estadia: "3 noches", consentimiento_ts: "2026-10-03T10:00:00.000Z" });

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

test("guarda la ficha del huésped sin vector y la actualiza sin duplicarla", async () => {
  const c = clienteFalso();
  const s = new SupabaseStore(c, { intervaloMs: 60000 });
  await s.guardarHuespedes([{ ...ficha("u1", "Ana"), embedding: [1, 2, 3] }]);
  await s.vaciar();
  await s.guardarHuespedes([ficha("u1", "Ana María")]);
  await s.vaciar();
  assert.equal(c.tablas.huespedes.length, 1);
  assert.equal(c.tablas.huespedes[0].nombre, "Ana María");
  assert.equal(c.tablas.huespedes[0].habitacion, "204");
  assert.ok(!("embedding" in c.tablas.huespedes[0]));
});

test("la atención lleva el huésped y el huésped se envía antes que la atención", async () => {
  const c = clienteFalso();
  const s = new SupabaseStore(c, { intervaloMs: 60000 });
  const t0 = new Date("2026-10-03T10:00:00").getTime();
  await s.agregarEpisodio({ id: 1, inicio: t0, fin: t0 + 5000, duracion: 5000, dominante: "feliz", alerta: false, huesped: "u1" });
  await s.guardarHuespedes([ficha("u1", "Ana")]);
  await s.vaciar();
  assert.ok(c.llamadas.indexOf("upsert:huespedes") < c.llamadas.indexOf("insert:episodios"));
  assert.equal(c.tablas.episodios[0].huesped_id, "u1");
  const d = await s.cargarDia("2026-10-03");
  assert.equal(d.episodios[0].huesped, "u1");
});

test("olvidar a un huésped lo borra de la base y desvincula atenciones pendientes", async () => {
  const c = clienteFalso();
  const s = new SupabaseStore(c, { intervaloMs: 60000 });
  const t0 = Date.now();
  await s.guardarHuespedes([ficha("u1", "Ana"), ficha("u2", "Beto")]);
  await s.vaciar();
  await s.agregarEpisodio({ id: 1, inicio: t0, fin: t0 + 5000, duracion: 5000, dominante: "feliz", alerta: false, huesped: "u1" });
  await s.quitarHuespedes(["u1"]);
  await s.vaciar();
  assert.deepEqual(c.tablas.huespedes.map((h) => h.id), ["u2"]);
  assert.equal(c.tablas.episodios[0].huesped_id, null);
});

test("un huésped borrado antes de enviarse no llega a la base", async () => {
  const c = clienteFalso();
  const s = new SupabaseStore(c, { intervaloMs: 60000 });
  await s.guardarHuespedes([ficha("u1", "Ana")]);
  await s.quitarHuespedes(["u1"]);
  await s.vaciar();
  assert.equal(c.tablas.huespedes.length, 0);
});

test("si falla un tramo solo se reintenta ese tramo y no se duplican registros", async () => {
  const c = clienteFalso({ fallaEn: { episodios: new Error("sin red") } });
  const s = new SupabaseStore(c, { intervaloMs: 60000 });
  s.onError = () => {};
  const t0 = Date.now();
  await s.agregarRegistro({ ts: t0, emocion: "neutral", confianza: 0.5, episodio: 1 });
  await s.agregarEpisodio({ id: 1, inicio: t0, fin: t0 + 5000, duracion: 5000, dominante: "neutral", alerta: false });
  await s.vaciar();
  assert.equal(c.tablas.registros.length, 1);
  assert.equal(s.cola.registros.length, 0);
  assert.equal(s.cola.episodios.length, 1);
  clearTimeout(s.timer);
});

test("sin ejecutar huespedes.sql sigue guardando atenciones y avisa una sola vez", async () => {
  const c = clienteFalso({ sinColumnaHuesped: true });
  const s = new SupabaseStore(c, { intervaloMs: 60000 });
  let avisos = 0;
  s.onEsquemaViejo = () => avisos++;
  const t0 = Date.now();
  await s.agregarEpisodio({ id: 1, inicio: t0, fin: t0 + 5000, duracion: 5000, dominante: "feliz", alerta: false, huesped: "u1" });
  await s.vaciar();
  assert.equal(c.tablas.episodios.length, 1);
  assert.ok(!("huesped_id" in c.tablas.episodios[0]));
  await s.agregarEpisodio({ id: 2, inicio: t0 + 9000, fin: t0 + 14000, duracion: 5000, dominante: "feliz", alerta: false, huesped: "u1" });
  await s.vaciar();
  assert.equal(c.tablas.episodios.length, 2);
  assert.equal(avisos, 1);
});
