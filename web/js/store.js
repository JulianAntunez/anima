// Almacenamiento de registros resumidos. Solo se guardan números y etiquetas, nunca imágenes.
// LocalStore usa el navegador. Más adelante se agrega SupabaseStore con la misma interfaz.
//
// Registro:  { ts, emocion, confianza, episodio }
// Episodio:  { id, inicio, fin, duracion, dominante, alerta }

import { tonoDe } from "./mood.js";

export const dia = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export class LocalStore {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    this.nombre = "Modo local (este navegador)";
  }

  _leer(clave, defecto) {
    try {
      const v = this.storage.getItem(clave);
      return v ? JSON.parse(v) : defecto;
    } catch {
      return defecto;
    }
  }

  _escribir(clave, valor) {
    try {
      this.storage.setItem(clave, JSON.stringify(valor));
    } catch {
      /* cuota llena o almacenamiento bloqueado: se sigue sin guardar */
    }
  }

  async agregarRegistro(reg) {
    const clave = `registros_${dia(reg.ts)}`;
    const lista = this._leer(clave, []);
    lista.push(reg);
    this._escribir(clave, lista);
  }

  async agregarEpisodio(ep) {
    const clave = `episodios_${dia(ep.inicio)}`;
    const lista = this._leer(clave, []);
    lista.push(ep);
    this._escribir(clave, lista);
  }

  async cargarDia(fecha = dia(Date.now())) {
    return {
      registros: this._leer(`registros_${fecha}`, []),
      episodios: this._leer(`episodios_${fecha}`, []),
    };
  }

  async cargarRango(dias) {
    const todo = { registros: [], episodios: [] };
    for (let i = dias - 1; i >= 0; i--) {
      const d = await this.cargarDia(dia(Date.now() - i * 86400000));
      todo.registros.push(...d.registros);
      todo.episodios.push(...d.episodios);
    }
    return todo;
  }

  async borrarTodo() {
    const claves = [];
    for (let i = 0; i < this.storage.length; i++) {
      const k = this.storage.key(i);
      if (k && (k.startsWith("registros_") || k.startsWith("episodios_"))) claves.push(k);
    }
    claves.forEach((k) => this.storage.removeItem(k));
  }
}

// Guarda en Supabase con la misma interfaz que LocalStore. Los inserts se agrupan cada 5 s.
export class SupabaseStore {
  constructor(client, { intervaloMs = 5000 } = {}) {
    this.client = client;
    this.intervaloMs = intervaloMs;
    this.nombre = "Supabase (nube)";
    this.cola = { registros: [], episodios: [] };
    this.timer = null;
    this.onError = null;
  }

  async agregarRegistro(reg) {
    this.cola.registros.push({ ts: new Date(reg.ts).toISOString(), emocion: reg.emocion, confianza: reg.confianza, episodio: reg.episodio ?? null });
    this._programar();
  }

  async agregarEpisodio(ep) {
    this.cola.episodios.push({
      ref: ep.id,
      inicio: new Date(ep.inicio).toISOString(),
      fin: new Date(ep.fin).toISOString(),
      duracion_ms: Math.round(ep.duracion),
      dominante: ep.dominante,
      alerta: !!ep.alerta,
    });
    this._programar();
  }

  _programar() {
    if (!this.timer) this.timer = setTimeout(() => this.vaciar(), this.intervaloMs);
  }

  async vaciar() {
    clearTimeout(this.timer);
    this.timer = null;
    const registros = this.cola.registros.splice(0);
    const episodios = this.cola.episodios.splice(0);
    try {
      if (registros.length) {
        const { error } = await this.client.from("registros").insert(registros);
        if (error) throw error;
      }
      if (episodios.length) {
        const { error } = await this.client.from("episodios").insert(episodios);
        if (error) throw error;
      }
    } catch (err) {
      this.cola.registros.unshift(...registros);
      this.cola.episodios.unshift(...episodios);
      this.onError?.(err);
      this._programar();
    }
  }

  async cargarDia(fecha = dia(Date.now())) {
    const desde = new Date(`${fecha}T00:00:00`);
    return this._consultar(desde, new Date(desde.getTime() + 86400000));
  }

  async cargarRango(dias) {
    await this.vaciar();
    const hoy = new Date(`${dia(Date.now())}T00:00:00`);
    return this._consultar(new Date(hoy.getTime() - (dias - 1) * 86400000), new Date(hoy.getTime() + 86400000));
  }

  async _consultar(desde, hasta) {
    const [r, e] = await Promise.all([
      this.client.from("registros").select("ts,emocion,confianza,episodio").gte("ts", desde.toISOString()).lt("ts", hasta.toISOString()).order("ts").range(0, 9999),
      this.client.from("episodios").select("ref,inicio,fin,duracion_ms,dominante,alerta").gte("inicio", desde.toISOString()).lt("inicio", hasta.toISOString()).order("inicio").range(0, 9999),
    ]);
    if (r.error) throw r.error;
    if (e.error) throw e.error;
    return {
      registros: r.data.map((x) => ({ ts: Date.parse(x.ts), emocion: x.emocion, confianza: x.confianza, episodio: x.episodio })),
      episodios: e.data.map((x) => ({ id: x.ref, inicio: Date.parse(x.inicio), fin: Date.parse(x.fin), duracion: x.duracion_ms, dominante: x.dominante, alerta: x.alerta })),
    };
  }

  async borrarTodo() {
    await this.vaciar();
    for (const [tabla, col] of [["registros", "ts"], ["episodios", "inicio"]]) {
      const { error } = await this.client.from(tabla).delete().gte(col, "1970-01-01");
      if (error) throw error;
    }
  }
}

export function resumir({ registros, episodios }, episodioActivo = null) {
  const validos = registros.filter((r) => r.emocion !== "incierto");
  const buenos = validos.filter((r) => ["positivo", "neutral"].includes(tonoDe(r.emocion))).length;
  const cerrados = episodios.length;
  const clientes = cerrados + (episodioActivo ? 1 : 0);
  const duracionTotal = episodios.reduce((s, e) => s + e.duracion, 0);
  return {
    clientes,
    indiceAnimo: validos.length ? Math.round((buenos / validos.length) * 100) : null,
    alertas: episodios.filter((e) => e.alerta).length + (episodioActivo?.alerta ? 1 : 0),
    tiempoMedio: cerrados ? duracionTotal / cerrados : null,
  };
}

export function porHora(registros) {
  const horas = {};
  for (const r of registros) {
    if (r.emocion === "incierto") continue;
    const h = new Date(r.ts).getHours();
    horas[h] ||= { positivo: 0, neutral: 0, atencion: 0, alerta: 0 };
    horas[h][tonoDe(r.emocion)] += 1;
  }
  return horas;
}

export function aCSV({ registros }) {
  const filas = ["timestamp,emocion,confianza,episodio", ...registros.map((r) => `${new Date(r.ts).toISOString()},${r.emocion},${r.confianza.toFixed(3)},${r.episodio ?? ""}`)];
  return filas.join("\n");
}
