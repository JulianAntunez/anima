"""
Script de Prueba Individual para la Fase 3: Clasificación de Emociones
Permite probar:
1. Webcam en vivo con detección facial, clasificación de emociones y panel de probabilidades en tiempo real.
2. Imágenes estáticas (JPG/PNG).
3. Modo no interactivo / headless para medir latencia y rendimiento en CPU.
"""

from typing import Dict, Optional, Tuple
import argparse
import sys
import time
from pathlib import Path
import cv2
import numpy as np

# Asegurar importación de módulos locales
sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import DEFAULT_CONFIG
from core import FaceDetector, EmotionClassifier, EmotionResult
from utils import EmotionCSVLogger

# Paleta de colores BGR para las diferentes emociones
EMOTION_COLORS: Dict[str, Tuple[int, int, int]] = {
    "feliz": (50, 205, 50),        # Verde lima
    "sorprendido": (0, 215, 255),  # Amarillo / dorado
    "neutral": (200, 200, 200),    # Gris claro
    "triste": (255, 140, 0),       # Azul acero (en BGR: 0, 140, 255)
    "enojado": (30, 30, 255),      # Rojo intenso
    "miedo": (180, 105, 255),      # Rosa / violeta
    "asco": (0, 140, 0),           # Verde oscuro
    "incierto": (128, 128, 128),   # Gris apagado
}


def abrir_camara(indice_camara: int = 0) -> Optional[cv2.VideoCapture]:
    """Abre la cámara web con DirectShow forzando FourCC MJPG para Windows 11."""
    cap = cv2.VideoCapture(indice_camara, cv2.CAP_DSHOW)
    if not cap.isOpened():
        cap = cv2.VideoCapture(indice_camara, cv2.CAP_ANY)
        if not cap.isOpened():
            return None

    cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, DEFAULT_CONFIG.frame_width)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, DEFAULT_CONFIG.frame_height)
    return cap


def dibujar_panel_emociones(
    frame: np.ndarray,
    result: EmotionResult,
    x_pos: int = 15,
    y_pos: int = 120,
    ancho_barra: int = 140,
    alto_barra: int = 14,
) -> None:
    """Dibuja un HUD semitransparente con el gráfico de barras de las 7 emociones."""
    num_emociones = len(result.probabilities)
    alto_panel = num_emociones * 22 + 35
    ancho_panel = ancho_barra + 140

    # Crear capa superpuesta con transparencia
    overlay = frame.copy()
    cv2.rectangle(
        overlay,
        (x_pos - 8, y_pos - 25),
        (x_pos + ancho_panel, y_pos + alto_panel - 15),
        (20, 20, 20),
        -1,
    )
    cv2.addWeighted(overlay, 0.7, frame, 0.3, 0, frame)

    cv2.putText(
        frame,
        "PROBABILIDADES:",
        (x_pos, y_pos - 8),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.45,
        (255, 255, 255),
        1,
    )

    y_actual = y_pos + 12
    for label, prob in result.probabilities.items():
        color = EMOTION_COLORS.get(label, (255, 255, 255))
        es_ganadora = (label == result.raw_emotion)

        # Nombre de la emoción
        cv2.putText(
            frame,
            f"{label[:8].capitalize()}:",
            (x_pos, y_actual + 10),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.42,
            color if es_ganadora else (180, 180, 180),
            1,
        )

        # Barra de progreso de fondo
        bar_x = x_pos + 85
        cv2.rectangle(
            frame,
            (bar_x, y_actual),
            (bar_x + ancho_barra, y_actual + alto_barra),
            (50, 50, 50),
            -1,
        )

        # Barra de progreso rellena
        ancho_lleno = int(ancho_barra * max(0.0, min(1.0, prob)))
        if ancho_lleno > 0:
            cv2.rectangle(
                frame,
                (bar_x, y_actual),
                (bar_x + ancho_lleno, y_actual + alto_barra),
                color,
                -1,
            )

        # Porcentaje numérico
        cv2.putText(
            frame,
            f"{prob * 100:.1f}%",
            (bar_x + ancho_barra + 8, y_actual + 11),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.38,
            (255, 255, 255),
            1,
        )

        y_actual += 22


def procesar_imagen_estatica(
    ruta_imagen: str,
    detector: FaceDetector,
    classifier: EmotionClassifier,
    logger: Optional[EmotionCSVLogger] = None,
    mostrar_ventana: bool = True,
) -> None:
    """Ejecuta detección y clasificación en una imagen estática."""
    p = Path(ruta_imagen)
    if not p.is_file():
        print(f"[ERROR] Archivo no encontrado: {ruta_imagen}")
        return

    frame = cv2.imread(str(p))
    if frame is None or frame.size == 0:
        print(f"[ERROR] No se pudo leer la imagen: {ruta_imagen}")
        return

    t0 = time.perf_counter()
    detecciones = detector.detect(frame)
    t_det = (time.perf_counter() - t0) * 1000

    print(f"\n--- Resultado para {p.name} ---")
    print(f" Dimensiones: {frame.shape[1]}x{frame.shape[0]}")
    print(f" Rostros detectados: {len(detecciones)} (Inferencia: {t_det:.1f}ms)")

    if not detecciones:
        print(" [AVISO] Ningún rostro detectado en la imagen.")
        return

    for idx, det in enumerate(detecciones, start=1):
        x, y, w, h = det.box
        crop = FaceDetector.crop_face(frame, det.box, margin=getattr(classifier, "crop_margin", 0.15))
        em_res = classifier.predict(crop) if crop is not None else None

        if em_res:
            if logger:
                logger.log_prediction(frame_id=1, face_id=idx - 1, result=em_res)

            color = EMOTION_COLORS.get(em_res.emotion, (0, 255, 0))
            texto = f"#{idx}: {em_res.emotion.upper()} ({em_res.confidence * 100:.1f}%)"
            print(f" Rostro #{idx}: {texto} (Inferencia Emoción: {em_res.inference_time_ms:.1f}ms)")
            print("   Probabilidades:")
            for emo, prob in em_res.probabilities.items():
                print(f"     - {emo:12s}: {prob * 100:5.1f}%")

            cv2.rectangle(frame, (x, y), (x + w, y + h), color, 2)
            cv2.putText(frame, texto, (x, max(25, y - 8)), cv2.FONT_HERSHEY_SIMPLEX, 0.65, color, 2)
            if idx == 1:
                dibujar_panel_emociones(frame, em_res, x_pos=15, y_pos=100)

    if mostrar_ventana:
        print("\nPresiona cualquier tecla en la ventana de imagen para cerrarla...")
        cv2.imshow("Fase 3: Clasificacion de Emociones", frame)
        cv2.waitKey(0)
        cv2.destroyAllWindows()


def procesar_webcam(
    detector: FaceDetector,
    classifier: EmotionClassifier,
    logger: Optional[EmotionCSVLogger] = None,
    indice_camara: int = 0,
    modo_headless: bool = False,
    max_frames_headless: int = 20,
) -> None:
    """Ejecuta detección y clasificación en tiempo real desde la webcam con telemetría CSV."""
    cap = abrir_camara(indice_camara)
    if cap is None or not cap.isOpened():
        print(f"[ERROR] No se pudo abrir la cámara #{indice_camara}.")
        return

    print(f"[OK] Cámara #{indice_camara} conectada.")
    nombre_ventana = "Fase 3: Reconocimiento Facial y Emociones (MediaPipe + ONNX FER+)"

    if not modo_headless:
        print("Iniciando ventana en vivo. Presiona 'q' o 'ESC' para salir.")
    else:
        print(f"Modo no interactivo: procesando {max_frames_headless} frames para benchmark...")

    frame_count = 0
    fallos_consecutivos = 0
    tiempos_totales = []
    tiempos_emocion = []

    try:
        while True:
            ret, frame = cap.read()
            if not ret or frame is None:
                fallos_consecutivos += 1
                if fallos_consecutivos >= 30:
                    print("[ERROR] Pérdida prolongada de señal de video.")
                    break
                time.sleep(0.1)
                continue

            fallos_consecutivos = 0
            frame_count += 1
            t_inicio_frame = time.perf_counter()

            # 1. Detección de rostros
            detecciones = detector.detect(frame)

            # 2. Clasificación de emociones para cada rostro
            resultados_emociones = []
            for face_idx, det in enumerate(detecciones):
                crop = FaceDetector.crop_face(frame, det.box, margin=getattr(classifier, "crop_margin", 0.15))
                if crop is not None:
                    res = classifier.predict(crop)
                    if res:
                        resultados_emociones.append((det, res))
                        tiempos_emocion.append(res.inference_time_ms)
                        # Registrar en CSV
                        if logger:
                            logger.log_prediction(frame_id=frame_count, face_id=face_idx, result=res)

            dt_total = (time.perf_counter() - t_inicio_frame) * 1000
            tiempos_totales.append(dt_total)

            # Telemetría en consola cada 15 frames
            if frame_count % 15 == 1:
                em_str = (
                    f"{resultados_emociones[0][1].emotion} ({resultados_emociones[0][1].confidence*100:.0f}%)"
                    if resultados_emociones
                    else "N/A"
                )
                print(
                    f"Frame #{frame_count:03d}: Rostros={len(detecciones)} | "
                    f"Emoción={em_str} | Latencia Total={dt_total:.1f}ms"
                )

            if modo_headless:
                if frame_count >= max_frames_headless:
                    break
            else:
                # Renderizar recuadros y etiquetas de emoción
                for det, em_res in resultados_emociones:
                    x, y, w, h = det.box
                    color = EMOTION_COLORS.get(em_res.emotion, (0, 255, 0))

                    # Recuadro con esquinas estilizadas
                    cv2.rectangle(frame, (x, y), (x + w, y + h), color, 2)

                    # Etiqueta con fondo semitransparente para máxima legibilidad
                    etiqueta = f"{em_res.emotion.upper()}: {em_res.confidence * 100:.0f}%"
                    (tw, th), _ = cv2.getTextSize(etiqueta, cv2.FONT_HERSHEY_SIMPLEX, 0.65, 2)
                    y_text = max(28, y - 8)
                    cv2.rectangle(
                        frame,
                        (x, y_text - th - 6),
                        (x + tw + 10, y_text + 4),
                        color,
                        -1,
                    )
                    cv2.putText(
                        frame,
                        etiqueta,
                        (x + 5, y_text - 2),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.65,
                        (0, 0, 0),
                        2,
                    )

                # Si hay al menos un rostro, mostrar panel HUD de probabilidades del primer rostro
                if resultados_emociones:
                    dibujar_panel_emociones(frame, resultados_emociones[0][1], x_pos=15, y_pos=90)

                # Información general superior (FPS y latencia)
                lat_media = np.mean(tiempos_totales[-25:]) if tiempos_totales else dt_total
                fps = 1000.0 / lat_media if lat_media > 0 else 0
                cv2.putText(
                    frame,
                    f"FPS: {fps:.1f} | Latencia Frame: {lat_media:.1f}ms",
                    (15, 30),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.65,
                    (0, 255, 255),
                    2,
                )
                cv2.putText(
                    frame,
                    f"Rostros: {len(detecciones)} | Salir: 'q'",
                    (15, 55),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.55,
                    (255, 255, 255),
                    1,
                )

                cv2.imshow(nombre_ventana, frame)
                tecla = cv2.waitKey(1) & 0xFF
                if tecla in (ord("q"), ord("Q"), 27):
                    break
    finally:
        cap.release()
        cv2.destroyAllWindows()

    if tiempos_totales:
        print("\n--- Estadísticas de Rendimiento en CPU (Fase 3) ---")
        print(f" Total frames procesados: {len(tiempos_totales)}")
        print(f" Latencia total por frame: {np.mean(tiempos_totales):.2f} ms")
        if tiempos_emocion:
            print(f" Latencia promedio del clasificador ONNX: {np.mean(tiempos_emocion):.2f} ms")
        print(f" FPS promedio reales alcanzables: {1000.0 / np.mean(tiempos_totales):.1f} FPS")


def main() -> None:
    parser = argparse.ArgumentParser(description="Prueba individual de clasificación de emociones (Fase 3 y 4)")
    parser.add_argument("--image", type=str, default=None, help="Ruta a una imagen JPG o PNG para probar")
    parser.add_argument("--cam", type=int, default=DEFAULT_CONFIG.camera_index, help="Índice de la cámara")
    parser.add_argument("--threshold", type=float, default=DEFAULT_CONFIG.emotion_confidence_threshold, help="Umbral de confianza")
    parser.add_argument("--headless", action="store_true", help="Modo sin interfaz gráfica")
    parser.add_argument("--no-log", action="store_true", help="Desactiva el guardado de telemetría a CSV")
    args = parser.parse_args()

    detector = FaceDetector(min_confidence=DEFAULT_CONFIG.face_detection_confidence)
    classifier = EmotionClassifier(min_confidence=args.threshold)
    logger = None if args.no_log else EmotionCSVLogger(source="imagen" if args.image else "webcam")

    try:
        if args.image:
            procesar_imagen_estatica(args.image, detector, classifier, logger=logger, mostrar_ventana=not args.headless)
        else:
            procesar_webcam(detector, classifier, logger=logger, indice_camara=args.cam, modo_headless=args.headless)
    finally:
        detector.close()
        classifier.close()
        if logger:
            logger.close()
            print(f"[OK] Telemetría registrada en: {logger.file_path} ({logger.total_logged} registros guardados)")


if __name__ == "__main__":
    main()
