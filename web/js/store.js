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

  // En modo local las fichas de los huéspedes ya están en el navegador (IndexedDB); no hay nube a la cual enviarlas.
  async guardarHuespedes() {}

  async quitarHuespedes() {}

  async vaciar() {}

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
    this.cola = { huespedes: [], borrados: [], registros: [], episodios: [] };
    this.timer = null;
    this.onError = null;
  }

  // Fichas de huéspedes: { uid, nombre, habitacion, estadia, consentimiento_ts }. Sin vector facial.
  async guardarHuespedes(lista) {
    for (const h of lista) {
      this.cola.borrados = this.cola.borrados.filter((id) => id !== h.uid);
      this.cola.huespedes = this.cola.huespedes.filter((x) => x.id !== h.uid);
      const fila = {
        id: h.uid,
        nombre: h.nombre,
        habitacion: h.habitacion || "",
        estadia: h.estadia || "",
        consentimiento_ts: h.consentimiento_ts || new Date().toISOString(),
      };
      if (h.embedding?.length) fila.embedding = Array.from(h.embedding);
      this.cola.huespedes.push(fila);
    }
    if (lista.length) this._programar();
  }

  // Al olvidar a un huésped también se desvincula de las atenciones que aún no se enviaron.
  async quitarHuespedes(uids) {
    const set = new Set(uids);
    this.cola.huespedes = this.cola.huespedes.filter((h) => !set.has(h.id));
    this.cola.episodios.forEach((e) => {
      if (set.has(e.huesped_id)) e.huesped_id = null;
    });
    this.cola.borrados.push(...uids.filter((id) => !this.cola.borrados.includes(id)));
    if (uids.length) this._programar();
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
      huesped_id: ep.huesped ?? null,
    });
    this._programar();
  }

  _programar() {
    if (!this.timer) this.timer = setTimeout(() => this.vaciar(), this.intervaloMs);
  }

  // Envía lo pendiente en orden: huéspedes, borrados, registros y atenciones (las atenciones apuntan a un huésped).
  // Cada tramo que se envía bien sale de la cola; solo se reintenta lo que falló, así nada se duplica.
  async vaciar() {
    clearTimeout(this.timer);
    this.timer = null;
    const pendiente = {
      huespedes: this.cola.huespedes.splice(0),
      borrados: this.cola.borrados.splice(0),
      registros: this.cola.registros.splice(0),
      episodios: this.cola.episodios.splice(0),
    };
    const devolver = () => {
      for (const k of Object.keys(pendiente)) this.cola[k].unshift(...pendiente[k]);
    };
    try {
      if (this.sinHuespedes) {
        pendiente.huespedes = [];
        pendiente.borrados = [];
      }
      if (pendiente.huespedes.length) {
        const subir = (filas) => this.client.from("huespedes").upsert(filas, { onConflict: "id" });
        const sinVector = (filas) => filas.map(({ embedding, ...resto }) => resto);
        let { error } = await subir(this.sinVector ? sinVector(pendiente.huespedes) : pendiente.huespedes);
        if (error && this._faltaVector(error)) {
          // Si todavía no se ejecutó registro_movil.sql, se guardan las fichas sin el vector.
          ({ error } = await subir(sinVector(pendiente.huespedes)));
        }
        if (error && !this._esquemaViejo(error)) throw error;
        if (error) pendiente.borrados = [];
        pendiente.huespedes = [];
      }
      if (pendiente.borrados.length) {
        const { error } = await this.client.from("huespedes").delete().in("id", pendiente.borrados);
        if (error && !this._esquemaViejo(error)) throw error;
        pendiente.borrados = [];
      }
      if (pendiente.registros.length) {
        const { error } = await this.client.from("registros").insert(pendiente.registros);
        if (error) throw error;
        pendiente.registros = [];
      }
      if (pendiente.episodios.length) {
        const filas = this.sinHuespedes ? pendiente.episodios.map(({ huesped_id, ...resto }) => resto) : pendiente.episodios;
        let { error } = await this.client.from("episodios").insert(filas);
        if (error && !this.sinHuespedes && this._esquemaViejo(error)) {
          ({ error } = await this.client.from("episodios").insert(pendiente.episodios.map(({ huesped_id, ...resto }) => resto)));
        }
        if (error) throw error;
        pendiente.episodios = [];
      }
    } catch (err) {
      devolver();
      this.onError?.(err);
      this._programar();
    }
  }

  _faltaVector(error) {
    const texto = `${error?.message || ""} ${error?.details || ""}`;
    const falta = /embedding/i.test(texto) && (["PGRST204", "42703"].includes(error?.code) || /column|schema cache|does not exist/i.test(texto));
    if (falta && !this.sinVector) {
      this.sinVector = true;
      this.onSinVector?.();
    }
    return falta;
  }

  // Clientes guardados en la nube, con su vector facial (null si la columna todavía no existe).
  async cargarHuespedes() {
    const columnas = "id,nombre,habitacion,estadia,consentimiento_ts";
    let { data, error } = await this.client.from("huespedes").select(this.sinVector ? columnas : `${columnas},embedding`).range(0, 4999);
    if (error && !this.sinVector && this._faltaVector(error)) ({ data, error } = await this.client.from("huespedes").select(columnas).range(0, 4999));
    if (error) {
      if (this._esquemaViejo(error)) return [];
      throw error;
    }
    return data.map((x) => ({ uid: x.id, nombre: x.nombre, habitacion: x.habitacion, estadia: x.estadia, consentimiento_ts: x.consentimiento_ts, embedding: x.embedding ?? null }));
  }

  // Invitación de un solo uso para que el huésped se registre desde su teléfono (vence a los 15 minutos).
  async crearInvitacion({ nombre, habitacion = "", estadia = "" }) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    const { error } = await this.client.from("invitaciones").insert({ token, nombre, habitacion, estadia });
    if (error) throw error;
    return token;
  }

  async invitacionUsada(token) {
    const { data, error } = await this.client.from("invitaciones").select("usada").eq("token", token).maybeSingle();
    if (error) throw error;
    return !!data?.usada;
  }

  // Si todavía no se ejecutó huespedes.sql en Supabase, se sigue guardando lo anónimo y se avisa una sola vez.
  _esquemaViejo(error) {
    const texto = `${error?.message || ""} ${error?.details || ""}`;
    const falta = /huesped/i.test(texto) && (["PGRST204", "PGRST205", "42P01", "42703"].includes(error?.code) || /column|table|schema cache|does not exist/i.test(texto));
    if (falta && !this.sinHuespedes) {
      this.sinHuespedes = true;
      this.onEsquemaViejo?.();
    }
    return falta;
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
    const episodios = (columnas) =>
      this.client.from("episodios").select(columnas).gte("inicio", desde.toISOString()).lt("inicio", hasta.toISOString()).order("inicio").range(0, 9999);
    const base = "ref,inicio,fin,duracion_ms,dominante,alerta";
    const [r, e0] = await Promise.all([
      this.client.from("registros").select("ts,emocion,confianza,episodio").gte("ts", desde.toISOString()).lt("ts", hasta.toISOString()).order("ts").range(0, 9999),
      episodios(this.sinHuespedes ? base : `${base},huesped_id`),
    ]);
    let e = e0;
    if (e.error && !this.sinHuespedes && this._esquemaViejo(e.error)) e = await episodios(base);
    if (r.error) throw r.error;
    if (e.error) throw e.error;
    return {
      registros: r.data.map((x) => ({ ts: Date.parse(x.ts), emocion: x.emocion, confianza: x.confianza, episodio: x.episodio })),
      episodios: e.data.map((x) => ({ id: x.ref, inicio: Date.parse(x.inicio), fin: Date.parse(x.fin), duracion: x.duracion_ms, dominante: x.dominante, alerta: x.alerta, huesped: x.huesped_id ?? null })),
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
