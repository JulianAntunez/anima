// Convierte lecturas de ánimo en "atenciones" (episodios por cliente) y registros muestreados.
// Una atención empieza cuando aparece un rostro y termina tras unos segundos sin verlo.

import { tonoDe } from "./mood.js";

export class Sesion {
  constructor({ ausenciaMs = 4000, muestreoMs = 5000, alertaMs = 3000, minimoMs = 2000 } = {}) {
    Object.assign(this, { ausenciaMs, muestreoMs, alertaMs, minimoMs });
    this.actual = null;
    this.ultimaEtiqueta = null;
    this.ultimoRegistro = 0;
  }

  // lectura: null (sin rostro) o { emocion, confianza }
  procesar(ts, lectura) {
    const salida = { registros: [], cerrado: null, alertaNueva: false };

    if (!lectura) {
      if (this.actual && ts - this.actual.ultima > this.ausenciaMs) salida.cerrado = this._cerrar();
      return salida;
    }

    if (!this.actual) {
      this.actual = { id: ts, inicio: ts, ultima: ts, conteo: {}, alerta: false, desdeAlerta: null };
      this.ultimaEtiqueta = null;
    }
    const ep = this.actual;
    ep.ultima = ts;

    if (lectura.emocion !== "incierto") {
      ep.conteo[lectura.emocion] = (ep.conteo[lectura.emocion] || 0) + 1;

      if (lectura.emocion !== this.ultimaEtiqueta || ts - this.ultimoRegistro >= this.muestreoMs) {
        salida.registros.push({ ts, emocion: lectura.emocion, confianza: lectura.confianza, episodio: ep.id });
        this.ultimaEtiqueta = lectura.emocion;
        this.ultimoRegistro = ts;
      }

      if (tonoDe(lectura.emocion) === "alerta") {
        if (ep.desdeAlerta === null) ep.desdeAlerta = ts;
        else if (!ep.alerta && ts - ep.desdeAlerta >= this.alertaMs) {
          ep.alerta = true;
          salida.alertaNueva = true;
        }
      } else {
        ep.desdeAlerta = null;
      }
    }
    return salida;
  }

  cerrarAhora() {
    return this.actual ? this._cerrar() : null;
  }

  _cerrar() {
    const ep = this.actual;
    this.actual = null;
    const duracion = ep.ultima - ep.inicio;
    if (duracion < this.minimoMs) return null;
    let dominante = "neutral";
    let mejor = -1;
    for (const [e, n] of Object.entries(ep.conteo)) {
      if (n > mejor) {
        mejor = n;
        dominante = e;
      }
    }
    return { id: ep.id, inicio: ep.inicio, fin: ep.ultima, duracion, dominante, alerta: ep.alerta };
  }
}
