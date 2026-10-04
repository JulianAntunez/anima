// Canal entre el panel del recepcionista y la pantalla del cliente (mismo navegador, sin servidor).
//
// panel -> cliente:
//   { tipo: "cliente", nombre, habitacion, estadia }     datos cargados por el recepcionista
//   { tipo: "lectura", emocion|null, confianza, caja }   expresión actual (null = sin rostro); caja ya viene en espejo
//   { tipo: "estado", activo, demo }                     cámara activa, en pausa o modo demo
// cliente -> panel:
//   { tipo: "hola" }                                      pide que el panel reenvíe el estado actual
export const CANAL = "anima-cliente";

export function limpiarTexto(valor, max = 60) {
  return String(valor ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
}

export function datosCliente({ nombre, habitacion, estadia } = {}) {
  return { tipo: "cliente", nombre: limpiarTexto(nombre), habitacion: limpiarTexto(habitacion, 12), estadia: limpiarTexto(estadia, 40) };
}
