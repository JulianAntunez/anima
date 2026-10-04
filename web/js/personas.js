// Clientes registrados, guardados solo en este navegador (IndexedDB). No se guardan fotos: únicamente
// el nombre, los datos de la estadía y un vector numérico de 512 valores, con la fecha del consentimiento.

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

export const agregarPersona = ({ nombre, habitacion, estadia, embedding }) =>
  operar("readwrite", (s) => s.add({ nombre, habitacion, estadia, embedding: Array.from(embedding), consentimiento_ts: new Date().toISOString() }));

export const actualizarPersona = (persona) =>
  operar("readwrite", (s) => s.put({ ...persona, embedding: Array.from(persona.embedding), consentimiento_ts: new Date().toISOString() }));

export const eliminarPersona = (id) => operar("readwrite", (s) => s.delete(id));

export const borrarPersonas = () => operar("readwrite", (s) => s.clear());

export async function galeria() {
  return (await listarPersonas()).map((p) => ({ ...p, embedding: Float32Array.from(p.embedding) }));
}
