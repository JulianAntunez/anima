// Clientes registrados, guardados en este navegador (IndexedDB). No se guardan fotos: únicamente
// el nombre, los datos de la estadía y un vector numérico de 512 valores, con la fecha del consentimiento.
// El vector queda solo acá; la ficha sin vector (fichaHuesped) se copia a Supabase para poder consultarla.

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

// Cada cliente lleva un identificador propio (uid) que lo une con su ficha en la nube, que no incluye el vector.
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

// Datos que viajan a la nube: nunca incluyen el vector facial.
export const fichaHuesped = (p) => ({ uid: p.uid, nombre: p.nombre, habitacion: p.habitacion || "", estadia: p.estadia || "", consentimiento_ts: p.consentimiento_ts });
