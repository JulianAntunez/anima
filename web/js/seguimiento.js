// Seguimiento de varias caras entre cuadros (sin dependencias de navegador, se prueba con Node).
// Cada caja es { x, y, w, h } en coordenadas normalizadas.

export function iou(a, b) {
  const xa = Math.max(a.x, b.x);
  const ya = Math.max(a.y, b.y);
  const xb = Math.min(a.x + a.w, b.x + b.w);
  const yb = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, xb - xa) * Math.max(0, yb - ya);
  if (inter === 0) return 0;
  return inter / (a.w * a.h + b.w * b.h - inter);
}

// Para cada caja nueva devuelve el índice de la caja previa que le corresponde, o -1 si es una cara nueva.
// Asigna por mayor superposición y no repite una caja previa para dos caras nuevas.
export function asociarCaras(previas, nuevas, iouMinimo = 0.2) {
  const pares = [];
  nuevas.forEach((n, i) => previas.forEach((p, j) => pares.push({ i, j, v: iou(n, p) })));
  pares.sort((a, b) => b.v - a.v);
  const resultado = nuevas.map(() => -1);
  const usadasPrevias = new Set();
  for (const { i, j, v } of pares) {
    if (v < iouMinimo) break;
    if (resultado[i] !== -1 || usadasPrevias.has(j)) continue;
    resultado[i] = j;
    usadasPrevias.add(j);
  }
  return resultado;
}

// La cara principal es la más grande (la persona más cercana a la cámara).
export function principalDe(caras) {
  let mejor = null;
  for (const c of caras) if (!mejor || c.caja.w * c.caja.h > mejor.caja.w * mejor.caja.h) mejor = c;
  return mejor;
}
