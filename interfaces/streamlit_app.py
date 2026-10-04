"""
Dashboard Web Interactivo con Streamlit (Fase 6)
Permite:
1. Análisis de emociones en imágenes subidas (JPG/PNG) y fotos de webcam en el navegador.
2. Exploración interactiva y analítica de los registros CSV generados en tiempo real.
3. Panel de control ético, métricas de latencia y configuración de umbrales.
"""

from datetime import datetime
from pathlib import Path
import sys
import time
from typing import Dict, List, Optional, Tuple
import cv2
import numpy as np
import pandas as pd
from PIL import Image
import streamlit as st

# Asegurar importación de módulos locales
ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from config import DEFAULT_CONFIG
from core import FaceDetector, EmotionClassifier, EmotionResult, FaceDetection
from utils import EmotionCSVLogger, CSV_COLUMNS

# Paleta de colores para gráficos y etiquetas
EMOTION_COLORS_HEX: Dict[str, str] = {
    "feliz": "#32CD32",        # Verde lima
    "sorprendido": "#FFD700",  # Amarillo oro
    "neutral": "#A0AEC0",      # Gris neutro
    "triste": "#1E90FF",       # Azul acero
    "enojado": "#FF4500",      # Rojo anaranjado
    "miedo": "#BA55D3",        # Violeta orquídea
    "asco": "#2E8B57",         # Verde bosque
    "incierto": "#718096",     # Gris apagado
}

# Configuración general de la página Streamlit
st.set_page_config(
    page_title="Ánima | Panel de análisis",
    page_icon="🎭",
    layout="wide",
    initial_sidebar_state="expanded",
)

# Estilos CSS modernos para una presentación premium
st.markdown(
    """
    <style>
    .main { background-color: #0E1117; }
    .stMetric {
        background-color: #1A202C;
        border-radius: 10px;
        padding: 15px;
        border: 1px solid #2D3748;
    }
    .metric-card {
        background: linear-gradient(135deg, #1E2640 0%, #151928 100%);
        border: 1px solid #2E3856;
        border-radius: 12px;
        padding: 16px;
        text-align: center;
    }
    .badge-emotion {
        display: inline-block;
        padding: 4px 12px;
        border-radius: 16px;
        font-weight: 600;
        font-size: 0.85rem;
    }
    </style>
    """,
    unsafe_allow_html=True,
)


@st.cache_resource
def cargar_modelos(min_confidence: float = 0.5):
    """Carga los modelos en memoria caché para evitar reinicializaciones pesadas."""
    detector = FaceDetector(min_confidence=min_confidence)
    classifier = EmotionClassifier(min_confidence=DEFAULT_CONFIG.emotion_confidence_threshold)
    return detector, classifier


def procesar_imagen_pil(
    image: Image.Image,
    detector: FaceDetector,
    classifier: EmotionClassifier,
    threshold: float,
    registrar_csv: bool = False,
) -> Tuple[np.ndarray, List[Tuple[FaceDetection, EmotionResult]], float]:
    """Procesa una imagen PIL detectando rostros y clasificando emociones."""
    # Convertir PIL a formato OpenCV BGR
    img_array = np.array(image.convert("RGB"))
    frame_bgr = cv2.cvtColor(img_array, cv2.COLOR_RGB2BGR)

    classifier.min_confidence = threshold
    t0 = time.perf_counter()

    detecciones = detector.detect(frame_bgr)
    resultados = []

    logger = EmotionCSVLogger(source="web_upload") if registrar_csv else None

    for idx, det in enumerate(detecciones):
        crop = FaceDetector.crop_face(frame_bgr, det.box, margin=0.15)
        if crop is not None:
            res = classifier.predict(crop)
            if res:
                resultados.append((det, res))
                if logger:
                    logger.log_prediction(frame_id=1, face_id=idx, result=res)

    if logger:
        logger.close()

    tiempo_total_ms = (time.perf_counter() - t0) * 1000

    # Dibujar recuadros en la imagen resultante
    frame_dibujado = frame_bgr.copy()
    for idx, (det, em_res) in enumerate(resultados, start=1):
        x, y, w, h = det.box
        color_hex = EMOTION_COLORS_HEX.get(em_res.emotion, "#32CD32")
        # Hex a BGR
        c_rgb = tuple(int(color_hex.lstrip("#")[i : i + 2], 16) for i in (0, 2, 4))
        color_bgr = (c_rgb[2], c_rgb[1], c_rgb[0])

        cv2.rectangle(frame_dibujado, (x, y), (x + w, y + h), color_bgr, 2)
        tag = f"#{idx} {em_res.emotion.upper()}: {em_res.confidence * 100:.0f}%"
        (tw, th), _ = cv2.getTextSize(tag, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)
        y_text = max(25, y - 8)
        cv2.rectangle(frame_dibujado, (x, y_text - th - 6), (x + tw + 8, y_text + 4), color_bgr, -1)
        cv2.putText(frame_dibujado, tag, (x + 4, y_text - 2), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 2)

    frame_rgb_resultado = cv2.cvtColor(frame_dibujado, cv2.COLOR_BGR2RGB)
    return frame_rgb_resultado, resultados, tiempo_total_ms


def tab_detector_imagenes(detector: FaceDetector, classifier: EmotionClassifier, threshold: float):
    """Pestaña 1: Análisis sobre imágenes estáticas o capturas."""
    st.subheader("Subir Imagen o Capturar con Cámara Web")

    col_input1, col_input2 = st.columns([1, 1])
    with col_input1:
        uploaded_file = st.file_uploader(
            "Selecciona una imagen (JPG, PNG)",
            type=["jpg", "jpeg", "png"],
            help="Sube una fotografía con uno o más rostros para analizar.",
        )
    with col_input2:
        camera_photo = st.camera_input("O toma una foto rápida con tu cámara web")

    guardar_en_csv = st.checkbox("Registrar predicciones en el archivo CSV de auditoría", value=True)

    target_image = None
    if uploaded_file is not None:
        target_image = Image.open(uploaded_file)
    elif camera_photo is not None:
        target_image = Image.open(camera_photo)

    if target_image is not None:
        with st.spinner("Analizando rostros y expresiones faciales..."):
            frame_annotated, resultados, latencia_ms = procesar_imagen_pil(
                target_image,
                detector,
                classifier,
                threshold=threshold,
                registrar_csv=guardar_en_csv,
            )

        col_img, col_res = st.columns([1.2, 1])

        with col_img:
            st.image(
                frame_annotated,
                caption=f"Resultado ({len(resultados)} rostro(s) detectado(s) en {latencia_ms:.1f}ms)",
                use_container_width=True,
            )

        with col_res:
            st.markdown("### Resultados por Rostro")
            if not resultados:
                st.warning("No se detectó ningún rostro en la imagen con el umbral actual.")
            else:
                for idx, (det, em_res) in enumerate(resultados, start=1):
                    color = EMOTION_COLORS_HEX.get(em_res.emotion, "#A0AEC0")
                    st.markdown(
                        f"""
                        <div style="background-color: #1A202C; border-left: 5px solid {color}; padding: 10px; border-radius: 6px; margin-bottom: 12px;">
                            <h4 style="margin: 0; color: white;">Rostro #{idx}: <span style="color: {color};">{em_res.emotion.upper()}</span></h4>
                            <p style="margin: 4px 0 0 0; color: #CBD5E0; font-size: 0.9rem;">
                                Confianza: <b>{em_res.confidence * 100:.1f}%</b> | Inferencia: <b>{em_res.inference_time_ms:.1f} ms</b>
                            </p>
                        </div>
                        """,
                        unsafe_allow_html=True,
                    )

                    # Gráfico de barras de probabilidades
                    df_probs = pd.DataFrame(
                        {
                            "Emoción": [e.capitalize() for e in em_res.probabilities.keys()],
                            "Probabilidad (%)": [round(p * 100, 1) for p in em_res.probabilities.values()],
                        }
                    ).sort_values("Probabilidad (%)", ascending=True)

                    st.bar_chart(df_probs.set_index("Emoción"), horizontal=True, color=color)


def tab_analitica_csv():
    """Pestaña 2: Análisis y telemetría de los archivos CSV generados."""
    st.subheader("Telemetría y Registro Histórico de Predicciones")

    logs_dir = DEFAULT_CONFIG.logs_dir
    csv_files = sorted(list(logs_dir.glob("*.csv")), reverse=True)

    if not csv_files:
        st.info("Aún no hay archivos de telemetría CSV en data/logs/. Ejecuta la app para generar datos.")
        return

    # Selector de archivo
    nombres_archivos = [f.name for f in csv_files]
    archivo_seleccionado = st.selectbox(
        "Seleccionar archivo de telemetría:",
        options=nombres_archivos,
        index=0,
    )

    ruta_csv = logs_dir / archivo_seleccionado
    try:
        df = pd.read_csv(ruta_csv)
    except Exception as e:
        st.error(f"Error al leer el archivo CSV: {e}")
        return

    if df.empty:
        st.warning("El archivo CSV seleccionado está vacío.")
        return

    # Métricas agregadas
    total_registros = len(df)
    emocion_top = df["emotion"].mode()[0] if "emotion" in df else "N/A"
    confianza_media = df["confidence"].mean() * 100 if "confidence" in df else 0.0
    latencia_media = df["latency_ms"].mean() if "latency_ms" in df else 0.0

    m1, m2, m3, m4 = st.columns(4)
    m1.metric("Total Predicciones", f"{total_registros:,}")
    m2.metric("Emoción Predominante", emocion_top.capitalize())
    m3.metric("Confianza Media", f"{confianza_media:.1f}%")
    m4.metric("Latencia Media Inferencia", f"{latencia_media:.1f} ms")

    st.markdown("---")

    col_chart1, col_chart2 = st.columns([1, 1.2])

    with col_chart1:
        st.markdown("#### Distribución de Emociones")
        conteo_emociones = df["emotion"].value_counts().reset_index()
        conteo_emociones.columns = ["Emoción", "Frecuencia"]
        st.bar_chart(conteo_emociones.set_index("Emoción"), color="#32CD32")

    with col_chart2:
        st.markdown("#### Evolución de Confianza en el Tiempo")
        if "confidence" in df and "frame_id" in df:
            df_line = df[["frame_id", "confidence"]].copy()
            df_line["Confianza (%)"] = df_line["confidence"] * 100
            st.line_chart(df_line.set_index("frame_id")["Confianza (%)"])

    st.markdown("---")
    st.markdown("#### Tabla de Registros Detallada (ISO 8601)")
    st.dataframe(df, use_container_width=True, height=280)

    # Botón para descargar el CSV
    csv_bytes = df.to_csv(index=False).encode("utf-8")
    st.download_button(
        label="📥 Descargar datos analizados (CSV)",
        data=csv_bytes,
        file_name=archivo_seleccionado,
        mime="text/csv",
    )


def tab_etica_y_limitaciones():
    """Pestaña 3: Marco normativo, ética y consideraciones técnicas."""
    st.subheader("Marco Ético, Privacidad y Limitaciones Técnicas")

    st.markdown(
        """
        ### 1. Detección de Expresiones vs. Emociones Internas
        - **Aclaración fundamental**: Este sistema clasifica **expresiones faciales externas y movimientos de músculos faciales**, no sentimientos internos o intenciones subjetivas.
        - Un rostro sonriente no necesariamente implica alegría real (puede ser cortesía, nerviosismo o ironía); un rostro neutro no equivale a falta de emoción.

        ### 2. Privacidad y Seguridad por Diseño (Privacy by Design)
        - **Sin almacenamiento indiscriminado**: Por defecto, la aplicación **NUNCA guarda imágenes ni secuencias de video** de los rostros procesados.
        - Las imágenes procesadas residen efímeramente en la memoria RAM solo durante la inferencia y son desechadas de inmediato.
        - Únicamente se registran métricas numéricas tabulares anonimizadas (probabilidades y marcas temporales) para fines de auditoría.
        - Las capturas visuales solo ocurren tras una orden explícita del operador (tecla `C`).

        ### 3. Marco Normativo
        - **Argentina - Ley 25.326 de Protección de los Datos Personales**: Los datos biométricos y de imagen son datos sensibles. Su tratamiento requiere consentimiento explícito del titular del dato y fines legítimos.
        - **Unión Europea - Artificial Intelligence Act (AI Act)**: Prohíbe de forma explícita el uso de sistemas de reconocimiento de emociones en entornos **laborales y educativos**, reservándolo exclusivamente para aplicaciones médicas, terapéuticas o de seguridad bajo rigurosas salvaguardas.

        ### 4. Precisión Realista y Desafíos del Dataset
        - En el conjunto de datos estándar **FER-2013 / FER+**, los modelos de última generación para CPU rondan el **70% - 75%** de exactitud.
        - Categorías como *"asco"* y *"miedo"* presentan mayor tasa de ambigüedad debido a su baja frecuencia en los datos de entrenamiento y similitud morfológica con *"sorpresa"* y *"enojo"*.
        - Factores ambientales como ángulos pronunciados (> 45°), iluminación precaria y oclusiones (anteojos, barbijos, manos en la cara) pueden reducir la certidumbre. Por ello el sistema implementa la categoría **`incierto`** ante dudas fundadas.
        """
    )


def main():
    # Barra lateral
    with st.sidebar:
        st.title("🎭 Control Panel")
        st.markdown("**Sistema de Análisis Facial y Emocional**")
        st.markdown("*(MediaPipe BlazeFace + ONNX FER+)*")
        st.markdown("---")

        umbral_confianza = st.slider(
            "Umbral de Confianza de Emoción:",
            min_value=0.20,
            max_value=0.90,
            value=float(DEFAULT_CONFIG.emotion_confidence_threshold),
            step=0.05,
            help="Si la probabilidad máxima es menor a este umbral, se reporta como 'incierto'.",
        )

        umbral_detector = st.slider(
            "Sensibilidad del Detector Facial:",
            min_value=0.30,
            max_value=0.85,
            value=float(DEFAULT_CONFIG.face_detection_confidence),
            step=0.05,
        )

        st.markdown("---")
        st.markdown("### Aplicación de Escritorio")
        st.info("Para transmisión en vivo a 60 FPS con tu webcam, ejecuta en terminal:")
        st.code(".\\venv\\Scripts\\python.exe main.py", language="powershell")

        st.markdown("---")
        st.caption("Fase 6: Dashboard Streamlit | v1.0")

    detector, classifier = cargar_modelos(min_confidence=umbral_detector)

    # Encabezado principal
    st.title("🎭 Ánima · Reconocimiento y clasificación de expresiones")
    st.markdown(
        "Inferencia de alto rendimiento en CPU combinando detección ultrarrápida con MediaPipe y red neuronal profunda FER+ en ONNX Runtime."
    )

    # Pestañas principales
    tab1, tab2, tab3 = st.tabs(["📷 Detección en Imágenes / Fotos", "📊 Analítica de Logs CSV", "⚖️ Ética y Limitaciones"])

    with tab1:
        tab_detector_imagenes(detector, classifier, threshold=umbral_confianza)

    with tab2:
        tab_analitica_csv()

    with tab3:
        tab_etica_y_limitaciones()


if __name__ == "__main__":
    main()
