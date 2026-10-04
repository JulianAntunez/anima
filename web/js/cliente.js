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
};

function saludo(nombre, habitacion, estadia) {
  $("cli-saludo").textContent = nombre ? `Hola, ${nombre}` : "Te damos la bienvenida";
  $("cli-datos").textContent = [habitacion ? `Habitación ${habitacion}` : "", estadia].filter(Boolean).join(" · ");
}

function pintar(emocion, caja) {
  const a = animoCliente(emocion);
  $("cli-animo").className = `animo cli-animo tono-${a.tono}`;
  $("cli-icono").className = `ti ti-${a.icono} cli-icono`;
  $("cli-nombre").textContent = a.nombre;
  $("cli-mensaje").textContent = a.mensaje;

  const el = $("cli-caja");
  if (caja && !st.ocultar) {
    el.hidden = false;
    el.className = `caja tono-${a.tono}`;
    el.style.left = `${caja.x * 100}%`;
    el.style.top = `${caja.y * 100}%`;
    el.style.width = `${caja.w * 100}%`;
    el.style.height = `${caja.h * 100}%`;
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
  if (data.tipo === "cliente") saludo(data.nombre, data.habitacion, data.estadia);
  if (data.tipo === "estado") {
    st.activo = !!data.activo;
    st.demo = !!data.demo;
    actualizarEscena();
  }
  if (data.tipo === "lectura" && !st.ocultar) {
    st.ultimaLectura = Date.now();
    st.emocion = data.emocion || "ninguno";
    pintar(st.emocion, data.emocion ? data.caja : null);
  }
};

// Si el panel deja de enviar lecturas, se vuelve al mensaje de bienvenida.
setInterval(() => {
  if (st.activo && !st.ocultar && Date.now() - st.ultimaLectura > 2500 && st.emocion !== "ninguno") {
    st.emocion = "ninguno";
    pintar("ninguno", null);
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
