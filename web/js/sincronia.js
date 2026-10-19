// Decide qué copiar entre los clientes de este navegador y los de la nube (sin dependencias de navegador).
//
// locales:  [{ uid, nombre, consentimiento_ts, nube? }]          nube = id del usuario con el que se sincronizó
// remotos:  [{ uid, nombre, consentimiento_ts, embedding|null }]
// Devuelve { descargar, subir, borrarLocal, marcar }
//
// Reglas:
//  - Está en la nube y no acá: se descarga (por ejemplo, alguien que se registró desde su teléfono).
//  - Está en los dos: gana el de fecha más nueva.
//  - Está acá y no en la nube: si ya se había sincronizado con este usuario, lo borraron desde otro equipo y se
//    borra acá; si nunca se sincronizó, se sube. Los de otro usuario no se tocan.

export function planificarSincronia(locales, remotos, usuarioId) {
  const descargar = [];
  const subir = [];
  const borrarLocal = [];
  const marcar = [];
  const localPor = new Map(locales.map((l) => [l.uid, l]));
  const remotoPor = new Set(remotos.map((r) => r.uid));

  for (const r of remotos) {
    const l = localPor.get(r.uid);
    const tieneVector = Array.isArray(r.embedding) && r.embedding.length > 0;
    if (!tieneVector) {
      if (l) subir.push(l);
      continue;
    }
    if (!l) {
      descargar.push(r);
      continue;
    }
    const tr = Date.parse(r.consentimiento_ts);
    const tl = Date.parse(l.consentimiento_ts);
    if (tr > tl) descargar.push(r);
    else if (tl > tr) subir.push(l);
    else if (l.nube !== usuarioId) marcar.push(l.uid);
  }

  for (const l of locales) {
    if (remotoPor.has(l.uid)) continue;
    if (l.nube && l.nube !== usuarioId) continue;
    if (l.nube === usuarioId) borrarLocal.push(l.uid);
    else subir.push(l);
  }

  return { descargar, subir, borrarLocal, marcar };
}
