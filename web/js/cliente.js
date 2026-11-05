import { CANAL } from "./canal.js";
import { animoCliente } from "./mood.js";

const $ = (id) => document.getElementById(id);
const canal = new BroadcastChannel(CANAL);

const st = {
  activo: false,
  demo: false,
  ocultar: false,
  stream: null,
  ultimaLectura: 0,
  emocion: "ninguno",
  manual: { nombre: "", habitacion: "", estadia: "" },
  principal: { nombre: "", emocion: null },
  otras: [],
};

function unir(nombres) {
  if (nombres.length < 2) return nombres.join("");
  return `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
}

// Con una persona: «Hola, Nombre». Con dos o más: saludo general y los nombres debajo.
function saludo() {
  const nombres = [];
  const agregar = (n) => {
    if (n && !nombres.some((x) => x.toLowerCase() === n.toLowerCase())) nombres.push(n);
  };
  if (!st.ocultar) {
    agregar(st.principal.nombre);
    st.otras.forEach((o) => agregar(o.nombre));
  }
  const { nombre, habitacion, estadia } = st.manual;
  const personas = (st.principal.emocion ? 1 : 0) + st.otras.length;
  if (personas >= 2 && !st.ocultar) {
    $("cli-saludo").textContent = "Hola, te damos la bienvenida";
    $("cli-datos").textContent = unir(nombres);
  } else {
    const quien = nombre || nombres[0] || "";
    $("cli-saludo").textContent = quien ? `Hola, ${quien}` : "Te damos la bienvenida";
    $("cli-datos").textContent = [habitacion ? `Habitación ${habitacion}` : "", estadia].filter(Boolean).join(" · ");
  }
}

// Con 2 o más personas se muestra una tarjeta por cada una, debajo de la cámara.
function pintarTarjetas() {
  const cont = $("cli-tarjetas");
  const gente = st.ocultar || !st.principal.emocion ? [] : [st.principal, ...st.otras];
  const multi = gente.length >= 2;
  $("cli-cuerpo").classList.toggle("multi", multi);
  while (cont.children.length < (multi ? gente.length : 0)) {
    const t = document.createElement("div");
    t.className = "animo cli-tarjeta";
    t.append(Object.assign(document.createElement("span"), { className: "ct-nombre" }), Object.assign(document.createElement("span"), { className: "ct-emoji" }));
    cont.appendChild(t);
  }
  [...cont.children].forEach((el, i) => {
    const g = multi ? gente[i] : null;
    el.hidden = !g;
    if (!g) return;
    const a = animoCliente(g.emocion);
    el.className = `animo cli-tarjeta tono-${a.tono}`;
    el.children[0].textContent = g.nombre || "";
    el.children[1].textContent = a.emoji;
    el.children[1].setAttribute("role", "img");
    el.children[1].setAttribute("aria-label", a.nombre);
  });
}

// El nombre va dentro del recuadro; si la cara está pegada al borde de arriba, el rótulo se pone adentro.
function rotulo(el, caja, nombre, emoji) {
  const chip = el.firstChild;
  chip.textContent = nombre ? `${nombre} ${emoji}` : emoji;
  chip.classList.toggle("dentro", caja.y < 0.1);
}

function pintarOtras(otras) {
  const cont = $("cli-extras");
  const lista = st.ocultar ? [] : otras || [];
  while (cont.children.length < lista.length) {
    const caja = document.createElement("div");
    caja.className = "caja";
    caja.appendChild(Object.assign(document.createElement("span"), { className: "chip" }));
    cont.appendChild(caja);
  }
  [...cont.children].forEach((el, i) => {
    const o = lista[i];
    el.hidden = !o;
    if (!o) return;
    const a = animoCliente(o.emocion);
    el.className = `caja tono-${a.tono}`;
    el.style.left = `${o.caja.x * 100}%`;
    el.style.top = `${o.caja.y * 100}%`;
    el.style.width = `${o.caja.w * 100}%`;
    el.style.height = `${o.caja.h * 100}%`;
    rotulo(el, o.caja, o.nombre, a.emoji);
  });
}

function pintar(emocion, caja, nombre = "") {
  const a = animoCliente(emocion);
  $("cli-animo").className = `animo cli-animo tono-${a.tono}`;
  const emoji = $("cli-emoji");
  emoji.textContent = a.emoji;
  emoji.setAttribute("aria-label", a.nombre);

  const el = $("cli-caja");
  if (caja && !st.ocultar) {
    el.hidden = false;
    el.className = `caja tono-${a.tono}`;
    el.style.left = `${caja.x * 100}%`;
    el.style.top = `${caja.y * 100}%`;
    el.style.width = `${caja.w * 100}%`;
    el.style.height = `${caja.h * 100}%`;
    rotulo(el, caja, nombre, a.emoji);
  } else {
    el.hidden = true;
  }
}

async function abrirCamara() {
  if (st.stream || st.demo || !st.activo || st.ocultar) return;
  try {
    const id = localStorage.getItem("camaraId");
    const video = { width: { ideal: 1280 }, height: { ideal: 720 } };
    if (id) video.deviceId = { ideal: id };
    st.stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    const v = $("cli-video");
    v.srcObject = st.stream;
    await v.play();
    $("cli-escenario").style.aspectRatio = `${v.videoWidth} / ${v.videoHeight}`;
    $("cli-escenario").style.setProperty("--ar", String(v.videoWidth / v.videoHeight));
    $("cli-placeholder").hidden = true;
  } catch {
    st.stream = null;
    $("cli-placeholder").hidden = false;
    $("cli-placeholder-texto").textContent = "No se pudo mostrar la cámara";
  }
}

function cerrarCamara() {
  st.stream?.getTracks().forEach((t) => t.stop());
  st.stream = null;
  $("cli-video").srcObject = null;
}

function actualizarEscena() {
  if (st.ocultar) {
    cerrarCamara();
    $("cli-placeholder").hidden = false;
    $("cli-placeholder-texto").textContent = "Expresión oculta";
    $("cli-animo").hidden = true;
    pintar("ninguno", null);
    pintarOtras([]);
    pintarTarjetas();
    saludo();
    return;
  }
  $("cli-animo").hidden = false;
  if (!st.activo) {
    cerrarCamara();
    $("cli-placeholder").hidden = false;
    $("cli-placeholder-texto").textContent = "Esperando al mostrador…";
    pintar("ninguno", null);
  } else if (st.demo) {
    cerrarCamara();
    $("cli-placeholder").hidden = false;
    $("cli-placeholder-texto").textContent = "Modo demo";
  } else {
    abrirCamara();
  }
}

canal.onmessage = ({ data }) => {
  if (!data || typeof data !== "object") return;
  if (data.tipo === "cliente") {
    st.manual = { nombre: data.nombre || "", habitacion: data.habitacion || "", estadia: data.estadia || "" };
    saludo();
  }
  if (data.tipo === "estado") {
    st.activo = !!data.activo;
    st.demo = !!data.demo;
    actualizarEscena();
  }
  if (data.tipo === "camara") {
    cerrarCamara();
    actualizarEscena();
  }
  if (data.tipo === "lectura" && !st.ocultar) {
    st.ultimaLectura = Date.now();
    st.emocion = data.emocion || "ninguno";
    st.principal = { nombre: data.emocion ? data.nombre || "" : "", emocion: data.emocion || null };
    st.otras = data.emocion ? (data.otras || []).filter((o) => o?.caja) : [];
    pintar(st.emocion, data.emocion ? data.caja : null, st.principal.nombre);
    pintarOtras(st.otras);
    pintarTarjetas();
    saludo();
  }
};

// Si el panel deja de enviar lecturas, se vuelve al mensaje de bienvenida.
setInterval(() => {
  if (st.activo && !st.ocultar && Date.now() - st.ultimaLectura > 2500 && st.emocion !== "ninguno") {
    st.emocion = "ninguno";
    st.principal = { nombre: "", emocion: null };
    st.otras = [];
    pintar("ninguno", null);
    pintarOtras([]);
    pintarTarjetas();
    saludo();
  }
}, 1000);

$("btn-ocultar").addEventListener("click", () => {
  st.ocultar = !st.ocultar;
  $("btn-ocultar").querySelector("span").textContent = st.ocultar ? "Mostrar mi expresión" : "Ocultar mi expresión";
  $("btn-ocultar").querySelector("i").className = `ti ti-${st.ocultar ? "eye" : "eye-off"}`;
  actualizarEscena();
});

$("btn-pantalla").addEventListener("click", () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.();
});

window.addEventListener("pagehide", cerrarCamara);

canal.postMessage({ tipo: "hola" });
