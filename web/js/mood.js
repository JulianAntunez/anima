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

// Lo que ve el cliente en su pantalla: lenguaje amable y sin etiquetas negativas.
// Los estados de alerta se muestran con el mismo color que "atención" y un mensaje de ayuda.
export const CLIENTE = {
  feliz: { nombre: "Buen ánimo", icono: "mood-smile", tono: "positivo", mensaje: "Nos alegra verte de buen ánimo." },
  neutral: { nombre: "Tranquilidad", icono: "mood-neutral", tono: "neutral", mensaje: "Te damos la bienvenida. Estamos para ayudarte." },
  sorprendido: { nombre: "Curiosidad", icono: "mood-surprised", tono: "atencion", mensaje: "¿Tenés alguna duda? Contanos y con gusto te ayudamos." },
  triste: { nombre: "Preocupación", icono: "mood-sad", tono: "atencion", mensaje: "Estamos para ayudarte. Contanos qué necesitás." },
  miedo: { nombre: "Inquietud", icono: "mood-nervous", tono: "atencion", mensaje: "Quedate tranquilo, vamos a ayudarte." },
  enojado: { nombre: "Impaciencia", icono: "clock", tono: "atencion", mensaje: "Gracias por tu paciencia, enseguida te atendemos." },
  asco: { nombre: "Impaciencia", icono: "clock", tono: "atencion", mensaje: "Gracias por tu paciencia, enseguida te atendemos." },
  incierto: { nombre: "Un momento", icono: "mood-neutral", tono: "neutral", mensaje: "Un momento, por favor." },
  ninguno: { nombre: "Bienvenido", icono: "user", tono: "neutral", mensaje: "Acercate al mostrador, enseguida te atendemos." },
};

export function animoCliente(emocion) {
  return CLIENTE[emocion] || CLIENTE.incierto;
}
