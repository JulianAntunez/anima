// Clientes registrados, guardados en este navegador (IndexedDB). No se guardan fotos: únicamente
// el nombre, los datos de la estadía y un vector numérico de 512 valores, con la fecha del consentimiento.
// La ficha (fichaHuesped) se copia a Supabase para poder consultarla y reconocer al cliente desde otros equipos.

const BASE = "anima";
const TABLA = "personas";

function abrir() {
  return new Promise((ok, mal) => {
    const r = indexedDB.open(BASE, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(TABLA, { keyPath: "id", autoIncrement: true });
    r.onsuccess = () => ok(r.result);
    r.onerror = () => mal(r.error);
  });
}

async function operar(modo, fn) {
  const db = await abrir();
  try {
    return await new Promise((ok, mal) => {
      const tx = db.transaction(TABLA, modo);
      const req = fn(tx.objectStore(TABLA));
      tx.oncomplete = () => ok(req?.result);
      tx.onerror = () => mal(tx.error);
    });
  } finally {
    db.close();
  }
}

export const listarPersonas = () => operar("readonly", (s) => s.getAll()).then((l) => l ?? []);

// Cada cliente lleva un identificador propio (uid) que lo une con su ficha en la nube (tabla huespedes).
const nuevoUid = () => crypto.randomUUID();

export const agregarPersona = ({ nombre, habitacion, estadia, embedding }) =>
  operar("readwrite", (s) => s.add({ uid: nuevoUid(), nombre, habitacion, estadia, embedding: Array.from(embedding), consentimiento_ts: new Date().toISOString() }));

export const actualizarPersona = (persona) =>
  operar("readwrite", (s) => s.put({ ...persona, uid: persona.uid || nuevoUid(), embedding: Array.from(persona.embedding), consentimiento_ts: new Date().toISOString() }));

export const eliminarPersona = (id) => operar("readwrite", (s) => s.delete(id));

export const borrarPersonas = () => operar("readwrite", (s) => s.clear());

export async function galeria() {
  const lista = await listarPersonas();
  // Los clientes registrados antes de existir el uid lo reciben al cargar.
  for (const p of lista) {
    if (!p.uid) {
      p.uid = nuevoUid();
      await operar("readwrite", (s) => s.put(p));
    }
  }
  return lista.map((p) => ({ ...p, embedding: Float32Array.from(p.embedding) }));
}

// Trae a este navegador un cliente de la nube (alta o reemplazo por uid). Conserva la fecha de la nube y marca
// a qué usuario pertenece, para saber más adelante si fue borrado desde otro equipo.
export async function importarPersona(remota, usuarioId) {
  const existente = (await listarPersonas()).find((p) => p.uid === remota.uid);
  const registro = {
    ...(existente || {}),
    uid: remota.uid,
    nombre: remota.nombre,
    habitacion: remota.habitacion || "",
    estadia: remota.estadia || "",
    embedding: Array.from(remota.embedding),
    consentimiento_ts: remota.consentimiento_ts,
    nube: usuarioId,
  };
  await operar("readwrite", (s) => s.put(registro));
}

// Marca como sincronizados (presentes en la nube) a los clientes con esos uid.
export async function marcarEnNube(uids, usuarioId) {
  const set = new Set(uids);
  for (const p of (await listarPersonas()).filter((x) => set.has(x.uid) && x.nube !== usuarioId)) {
    await operar("readwrite", (s) => s.put({ ...p, nube: usuarioId }));
  }
}

export async function eliminarPorUid(uid) {
  const p = (await listarPersonas()).find((x) => x.uid === uid);
  if (p) await eliminarPersona(p.id);
}

// Ficha que viaja a la nube. Incluye el vector facial (512 números), nunca fotos.
export const fichaHuesped = (p) => ({
  uid: p.uid,
  nombre: p.nombre,
  habitacion: p.habitacion || "",
  estadia: p.estadia || "",
  consentimiento_ts: p.consentimiento_ts,
  embedding: p.embedding ? Array.from(p.embedding) : null,
});
