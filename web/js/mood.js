// Traduce las 7 expresiones al lenguaje de servicio de una recepción.
// tono: positivo | neutral | atencion | alerta  (define el color y si cuenta como alerta)

export const ANIMOS = {
  feliz: {
    nombre: "Satisfecho",
    tono: "positivo",
    sugerencia: "Buen momento para ofrecer servicios adicionales: desayuno incluido o late check-out.",
  },
  neutral: {
    nombre: "Tranquilo",
    tono: "neutral",
    sugerencia: "Atención habitual. Un saludo cordial y claro es suficiente.",
  },
  sorprendido: {
    nombre: "Sorprendido",
    tono: "atencion",
    sugerencia: "Puede haber una duda. Explicá el trámite paso a paso.",
  },
  triste: {
    nombre: "Preocupado",
    tono: "atencion",
    sugerencia: "Preguntale si necesita ayuda y ofrecé alternativas.",
  },
  miedo: {
    nombre: "Inquieto",
    tono: "atencion",
    sugerencia: "Transmití calma y confirmá que todo está en orden.",
  },
  enojado: {
    nombre: "Molesto",
    tono: "alerta",
    sugerencia: "Escuchá sin interrumpir y ofrecé la ayuda de un supervisor.",
  },
  asco: {
    nombre: "Incómodo",
    tono: "alerta",
    sugerencia: "Revisá si algo del trámite o del lugar lo incomoda y ofrecé una solución.",
  },
  incierto: {
    nombre: "Analizando",
    tono: "neutral",
    sugerencia: "Esperando una lectura estable de la expresión.",
  },
  ninguno: {
    nombre: "Sin cliente",
    tono: "neutral",
    sugerencia: "No hay una persona frente al mostrador.",
  },
};

export const TONOS = ["positivo", "neutral", "atencion", "alerta"];

export const TONO_NOMBRE = {
  positivo: "Satisfecho",
  neutral: "Tranquilo",
  atencion: "Atención",
  alerta: "Molesto o incómodo",
};

export function animoDe(emocion) {
  return ANIMOS[emocion] || ANIMOS.incierto;
}

export function tonoDe(emocion) {
  return animoDe(emocion).tono;
}
