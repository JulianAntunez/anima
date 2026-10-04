// Informe de recepción en PDF. Recibe un documento jsPDF y dibuja el informe (sin imágenes de personas).

import { animoDe, tonoDe, TONOS, TONO_NOMBRE } from "./mood.js";
import { resumir, porHora, dia } from "./store.js";

const COLOR = { positivo: [47, 158, 99], neutral: [185, 192, 203], atencion: [231, 169, 40], alerta: [214, 69, 59] };
const TEAL = [15, 118, 110];
const INK = [31, 41, 51];
const MUTED = [102, 112, 133];
const LINEA = [228, 224, 214];
const CAJA = [245, 243, 238];

export const mmss = (ms) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function fmtFecha(fecha) {
  const [a, m, d] = fecha.split("-");
  return `${d}/${m}/${a}`;
}

export function distribucionTonos(registros) {
  const conteo = { positivo: 0, neutral: 0, atencion: 0, alerta: 0 };
  let total = 0;
  for (const r of registros) {
    if (r.emocion === "incierto") continue;
    conteo[tonoDe(r.emocion)] += 1;
    total += 1;
  }
  return { conteo, total };
}

export function agruparPorDia({ registros, episodios }) {
  const dias = new Map();
  const tomar = (fecha) => {
    if (!dias.has(fecha)) dias.set(fecha, { registros: [], episodios: [] });
    return dias.get(fecha);
  };
  registros.forEach((r) => tomar(dia(r.ts)).registros.push(r));
  episodios.forEach((e) => tomar(dia(e.inicio)).episodios.push(e));
  return [...dias.keys()]
    .sort()
    .map((fecha) => ({ fecha, ...resumir(dias.get(fecha)) }));
}

export function construirInforme(doc, { datos, dias, usuario = "", ahora = Date.now() }) {
  const W = 210;
  const M = 18;
  const ancho = W - 2 * M;
  let y = 20;

  const texto = (t, x, yy, { size = 10, color = INK, bold = false, align = "left" } = {}) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(...color);
    doc.text(String(t), x, yy, { align });
  };
  const asegurar = (alto) => {
    if (y + alto > 276) {
      doc.addPage();
      y = 20;
    }
  };
  const titulo = (t) => {
    asegurar(16);
    texto(t, M, y, { size: 12, bold: true, color: TEAL });
    doc.setDrawColor(...LINEA);
    doc.line(M, y + 2, M + ancho, y + 2);
    y += 9;
  };

  const desde = dia(ahora - (dias - 1) * 86400000);
  const hasta = dia(ahora);
  const periodo = dias === 1 ? `Hoy, ${fmtFecha(hasta)}` : `${fmtFecha(desde)} al ${fmtFecha(hasta)}`;

  // Encabezado
  texto("Ánima", M, y, { size: 26, bold: true, color: TEAL });
  texto("Hospitalidad que se anticipa", M, y + 7, { size: 10, color: MUTED });
  texto("Informe de recepción", W - M, y - 1, { size: 14, bold: true, align: "right" });
  texto(periodo, W - M, y + 6, { size: 10, color: MUTED, align: "right" });
  const generado = new Date(ahora).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short", hour12: false });
  texto(`Generado: ${generado}${usuario ? ` por ${usuario}` : ""}`, W - M, y + 11, { size: 8, color: MUTED, align: "right" });
  y += 18;

  // Resumen
  const r = resumir(datos);
  const cajas = [
    ["Clientes", String(r.clientes)],
    ["Índice de ánimo", r.indiceAnimo === null ? "-" : `${r.indiceAnimo}%`],
    ["Alertas", String(r.alertas)],
    ["Tiempo medio", r.tiempoMedio === null ? "-" : mmss(r.tiempoMedio)],
  ];
  const wc = (ancho - 3 * 4) / 4;
  cajas.forEach(([etiqueta, valor], i) => {
    const x = M + i * (wc + 4);
    doc.setFillColor(...CAJA);
    doc.roundedRect(x, y, wc, 20, 2, 2, "F");
    texto(etiqueta, x + 4, y + 7, { size: 8, color: MUTED });
    texto(valor, x + 4, y + 16, { size: 17, bold: true });
  });
  y += 30;

  // Distribución del ánimo
  titulo("Distribución del ánimo");
  const { conteo, total } = distribucionTonos(datos.registros);
  if (!total) {
    texto("Todavía no hay registros en este período.", M, y, { size: 10, color: MUTED });
    y += 10;
  } else {
    let x = M;
    TONOS.forEach((t) => {
      const w = (conteo[t] / total) * ancho;
      if (w > 0) {
        doc.setFillColor(...COLOR[t]);
        doc.rect(x, y, w, 8, "F");
        x += w;
      }
    });
    y += 15;
    TONOS.forEach((t, i) => {
      const xl = M + i * (ancho / 4);
      doc.setFillColor(...COLOR[t]);
      doc.rect(xl, y - 3, 3, 3, "F");
      texto(`${TONO_NOMBRE[t]}  ${Math.round((conteo[t] / total) * 100)}%`, xl + 5, y, { size: 9 });
    });
    y += 12;
  }

  // Ánimo por hora
  const horas = porHora(datos.registros);
  const claves = Object.keys(horas).map(Number);
  titulo("Ánimo por franja horaria");
  if (!claves.length) {
    texto("Sin datos por hora.", M, y, { size: 10, color: MUTED });
    y += 10;
  } else {
    let min = Math.min(...claves);
    let max = Math.max(...claves);
    while (max - min < 4) {
      if (min > 0) min--;
      if (max - min < 4 && max < 23) max++;
    }
    const n = max - min + 1;
    const alto = 42;
    const wcol = ancho / n;
    asegurar(alto + 14);
    for (let h = min; h <= max; h++) {
      const d = horas[h];
      const x = M + (h - min) * wcol + 1;
      if (d) {
        const suma = TONOS.reduce((s, t) => s + d[t], 0);
        let base = y + alto;
        TONOS.forEach((t) => {
          const hs = (d[t] / suma) * alto;
          if (hs > 0) {
            doc.setFillColor(...COLOR[t]);
            doc.rect(x, base - hs, wcol - 2, hs, "F");
            base -= hs;
          }
        });
      }
      texto(`${h}h`, x + (wcol - 2) / 2, y + alto + 5, { size: 7, color: MUTED, align: "center" });
    }
    y += alto + 12;
  }

  // Detalle por día
  const porDia = agruparPorDia(datos);
  if (dias > 1 && porDia.length) {
    titulo("Detalle por día");
    const cols = [M, M + 38, M + 78, M + 108, M + 140];
    asegurar(10);
    doc.setFillColor(...CAJA);
    doc.rect(M, y - 4.5, ancho, 7, "F");
    ["Fecha", "Clientes", "Índice de ánimo", "Alertas", "Tiempo medio"].forEach((c, i) => texto(c, cols[i] + 2, y, { size: 8, bold: true, color: MUTED }));
    y += 7;
    porDia.forEach((d) => {
      asegurar(8);
      [fmtFecha(d.fecha), d.clientes, d.indiceAnimo === null ? "-" : `${d.indiceAnimo}%`, d.alertas, d.tiempoMedio === null ? "-" : mmss(d.tiempoMedio)].forEach((v, i) =>
        texto(v, cols[i] + 2, y, { size: 9 }),
      );
      doc.setDrawColor(...LINEA);
      doc.line(M, y + 2, M + ancho, y + 2);
      y += 7;
    });
    y += 6;
  }

  // Alertas del período
  const alertas = datos.episodios.filter((e) => e.alerta).sort((a, b) => b.inicio - a.inicio).slice(0, 12);
  if (alertas.length) {
    titulo("Atenciones con alerta");
    alertas.forEach((e) => {
      asegurar(7);
      const f = new Date(e.inicio);
      const cuando = `${fmtFecha(dia(e.inicio))}  ${f.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
      texto(cuando, M, y, { size: 9 });
      texto(`Duración ${mmss(e.duracion)}`, M + 50, y, { size: 9, color: MUTED });
      texto(`Estado dominante: ${animoDe(e.dominante).nombre}`, M + 95, y, { size: 9, color: MUTED });
      y += 6.5;
    });
    y += 4;
  }

  // Nota metodológica
  asegurar(24);
  doc.setFillColor(...CAJA);
  doc.roundedRect(M, y, ancho, 20, 2, 2, "F");
  const nota = doc.splitTextToSize(
    "Nota: Ánima estima la expresión facial de los clientes en forma agregada y anónima. Es un indicador aproximado de tendencia, no un diagnóstico del estado emocional de una persona, y no debe usarse para tomar decisiones sobre un individuo. No se guardan imágenes ni datos biométricos.",
    ancho - 8,
  );
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text(nota, M + 4, y + 6);

  // Pie de página
  const paginas = doc.getNumberOfPages();
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i);
    texto("Ánima · Hospitalidad que se anticipa", M, 289, { size: 8, color: MUTED });
    texto(`Página ${i} de ${paginas}`, W - M, 289, { size: 8, color: MUTED, align: "right" });
  }
}
