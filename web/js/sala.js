// Lecturas en vivo de los teléfonos conectados al panel (sin dependencias de navegador, se prueba con Node).
// Los teléfonos envían { id, nombre, emocion, confianza } por un canal de Supabase Realtime cuya "sala" es un código
// secreto que viaja dentro de los QR. Nada de esto se guarda: el panel solo lo muestra mientras llegan lecturas.

import { ETIQUETAS } from "./emotion.js";
import { limpiarTexto } from "./canal.js";

export const SALA_RE = /^[0-9a-f]{32}$/;
const ID_RE = /^[0-9a-f-]{8,40}$/;
const EMOCIONES = new Set([...ETIQUETAS, "incierto", "ninguno"]);

export function nuevaSala() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Valida y limpia un mensaje recibido por la red: cualquiera que conozca la sala puede enviar, así que no se confía en nada.
export function leerLectura(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (typeof payload.id !== "string" || !ID_RE.test(payload.id)) return null;
  if (!EMOCIONES.has(payload.emocion)) return null;
  const confianza = Number(payload.confianza);
  return {
    id: payload.id,
    nombre: limpiarTexto(typeof payload.nombre === "string" ? payload.nombre : ""),
    emocion: payload.emocion,
    confianza: Number.isFinite(confianza) ? Math.min(1, Math.max(0, confianza)) : 0,
  };
}

export class Conectados {
  constructor({ ttlMs = 4000, maximo = 20 } = {}) {
    Object.assign(this, { ttlMs, maximo });
    this.mapa = new Map();
  }

  recibir(payload, ahora = Date.now()) {
    const l = leerLectura(payload);
    if (!l) return false;
    if (!this.mapa.has(l.id) && this.mapa.size >= this.maximo) return false;
    this.mapa.set(l.id, { ...l, ts: ahora });
    return true;
  }

  quitar(id) {
    return this.mapa.delete(id);
  }

  // Los que siguen enviando lecturas; el resto se descarta (teléfono cerrado o sin conexión).
  vigentes(ahora = Date.now()) {
    for (const [id, l] of this.mapa) if (ahora - l.ts > this.ttlMs) this.mapa.delete(id);
    return [...this.mapa.values()].sort((a, b) => !a.nombre - !b.nombre || a.nombre.localeCompare(b.nombre, "es") || a.id.localeCompare(b.id));
  }
}
