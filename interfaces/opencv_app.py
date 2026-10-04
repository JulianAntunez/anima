"""
Módulo de la Interfaz OpenCV Integrada (Fase 5)
Aplicación gráfica de escritorio en tiempo real que combina detección facial,
clasificación de emociones, telemetría de rendimiento y registro en CSV.
"""

from datetime import datetime, timezone
from pathlib import Path
import time
from typing import Dict, List, Optional, Tuple, Union
import cv2
import numpy as np

from config import DEFAULT_CONFIG, AppConfig
from core import BlendshapeEmotionClassifier, EnsembleEmotionClassifier, FaceDetector, EmotionClassifier, EmotionResult, FaceDetection, FaceRecognizer, FaceTracker, Match, reutilizar_resultados
from utils import EmotionCSVLogger, EmotionDBLogger, PersonasRepository

# Paleta armónica de colores BGR según la emoción
EMOTION_COLORS: Dict[str, Tuple[int, int, int]] = {
    "feliz": (50, 205, 50),        # Verde lima
    "sorprendido": (0, 215, 255),  # Amarillo oro
    "neutral": (220, 220, 220),    # Blanco / Gris claro
    "triste": (255, 140, 0),       # Azul acero (en BGR: 0, 140, 255)
    "enojado": (30, 30, 255),      # Rojo vibrante
    "miedo": (180, 105, 255),      # Violeta / Magenta
    "asco": (0, 140, 0),           # Verde bosque
    "incierto": (130, 130, 130),   # Gris neutro
}


class OpenCVApp:
    """Aplicación principal de escritorio con interfaz gráfica en OpenCV."""

    def __init__(
        self,
        config: Optional[AppConfig] = None,
        camera_index: Optional[int] = None,
        threshold: Optional[float] = None,
        enable_logging: bool = True,
        enable_db: bool = True,
        enable_recognition: bool = True,
    ) -> None:
        self.config = config or DEFAULT_CONFIG
        self.camera_index = camera_index if camera_index is not None else self.config.camera_index
        self.threshold = threshold if threshold is not None else self.config.emotion_confidence_threshold
        self.enable_logging = enable_logging
        self.enable_db = enable_db

        # Inicialización de modelos y tracking
        self.detector = FaceDetector(min_confidence=self.config.face_detection_confidence, model_selection=1)
        try:
            blend = BlendshapeEmotionClassifier(min_confidence=self.threshold)
            fer = EmotionClassifier(min_confidence=self.threshold)
            self.classifier = EnsembleEmotionClassifier(blend, fer)
            print("[OK] Emociones: blendshapes de MediaPipe + voto de FER+ (alta sensibilidad a gestos leves).")
        except FileNotFoundError:
            print("[AVISO] Falta el modelo FaceLandmarker; se usa FER+ (menos sensible).")
            print("        Para activarlo: python -m utils.download_model --landmarker")
            self.classifier = EmotionClassifier(min_confidence=self.threshold)
        self._previos: List[Tuple[Tuple[int, int, int, int], EmotionResult]] = []
        self._calibracion: Optional[Dict] = None  # Estado de la calibración de cara neutra
        self.tracker = FaceTracker(window_size=self.config.smoothing_window, threshold=self.threshold)
        self.enable_smoothing: bool = True

        # Reconocimiento de identidad (opcional: requiere el modelo ArcFace descargado)
        self.recognizer: Optional[FaceRecognizer] = None
        self.personas: Optional[PersonasRepository] = None
        self._galeria: List[Tuple[int, str, np.ndarray]] = []
        self._identidades: Dict[int, Match] = {}
        self._ultimo_intento: Dict[int, int] = {}
        self._registro: Optional[Dict] = None  # Estado del flujo de alta de una persona
        if enable_recognition:
            self._iniciar_reconocimiento()

        # Estado de la interfaz
        self.show_hud_bars: bool = True
        self.show_stats: bool = True
        self.notification_text: str = ""
        self.notification_expiry: float = 0.0

        # Lista de umbrales cíclicos con tecla 't'
        self._threshold_levels = [0.35, 0.45, 0.60]
        self._current_thresh_idx = 1  # 0.45 por defecto

        # Directorio para capturas manuales bajo demanda
        self.captures_dir = self.config.project_root / "data" / "capturas"
        self.captures_dir.mkdir(parents=True, exist_ok=True)

        # Métricas de sesión
        self.session_counts: Dict[str, int] = {label: 0 for label in self.config.emotion_labels}
        self.session_counts["incierto"] = 0

    def _iniciar_reconocimiento(self) -> None:
        """Carga el modelo de identidad y la galería. Si falta el modelo, sigue sin reconocimiento."""
        try:
            self.recognizer = FaceRecognizer()
        except FileNotFoundError:
            print("[AVISO] Reconocimiento de personas desactivado: falta el modelo ArcFace.")
            print("        Para activarlo: python -m utils.download_model --reconocimiento")
            return
        self.personas = PersonasRepository(self.config.db_path)
        self._galeria = self.personas.galeria()
        print(f"[OK] Reconocimiento activo ({len(self._galeria)} personas registradas).")

    def _actualizar_identidades(
        self,
        frame: np.ndarray,
        items: List[Tuple[int, FaceDetection, EmotionResult]],
        frame_count: int,
        db_logger: Optional[EmotionDBLogger],
    ) -> None:
        """Identifica rostros nuevos o aún desconocidos (una vez por track, no por frame)."""
        if self.recognizer is None or not self.enable_smoothing:
            # Sin tracking estable los IDs cambian entre frames: no se puede cachear la identidad.
            return

        vivos = set(self.tracker.tracks.keys())
        for tid in list(self._identidades):
            if tid not in vivos:
                del self._identidades[tid]
        for tid in list(self._ultimo_intento):
            if tid not in vivos:
                del self._ultimo_intento[tid]

        if not self._galeria:
            return

        for track_id, det, _ in items:
            if track_id in self._identidades:
                continue
            if frame_count - self._ultimo_intento.get(track_id, -10**9) < self.config.recognition_retry_frames:
                continue
            self._ultimo_intento[track_id] = frame_count
            emb = self.recognizer.embedding(frame, det)
            if emb is None:
                continue
            match = self.recognizer.buscar(emb, self._galeria)
            if match is not None:
                self._identidades[track_id] = match
                if db_logger:
                    db_logger.asignar_persona(track_id, match.persona_id)

    # ------------------------------------------------------------ registro de personas

    def _iniciar_registro(self) -> None:
        if self.recognizer is None or self.personas is None:
            self._set_notification("Reconocimiento no disponible (falta modelo)", duration=3.0)
            return
        self._registro = {"fase": "nombre", "texto": "", "nombre": "", "muestras": [], "frames": 0}

    def _tecla_registro(self, tecla: int) -> None:
        """Procesa teclas mientras se está dando de alta a una persona."""
        reg = self._registro
        if reg is None or tecla == 255:
            return
        if tecla == 27:  # ESC
            self._registro = None
            self._set_notification("Registro cancelado")
        elif reg["fase"] == "nombre":
            if tecla in (13, 10):
                if reg["texto"].strip():
                    reg["nombre"] = reg["texto"].strip()
                    reg["fase"] = "consent"
            elif tecla == 8:
                reg["texto"] = reg["texto"][:-1]
            elif 32 <= tecla <= 126 and len(reg["texto"]) < 24:
                reg["texto"] += chr(tecla)
        elif reg["fase"] == "consent":
            if tecla in (ord("s"), ord("S")):
                reg["fase"] = "captura"
            elif tecla in (ord("n"), ord("N")):
                self._registro = None
                self._set_notification("Registro cancelado: sin consentimiento", duration=3.0)

    def _capturar_para_registro(
        self, frame: np.ndarray, items: List[Tuple[int, FaceDetection, EmotionResult]]
    ) -> None:
        """Acumula embeddings del rostro más grande y, al completar, guarda a la persona."""
        reg = self._registro
        if reg is None or reg["fase"] != "captura" or self.recognizer is None or self.personas is None:
            return
        if not items:
            return

        reg["frames"] += 1
        if reg["frames"] % self.config.registration_frame_step != 0:  # espaciar muestras para cubrir distintas distancias
            return

        _, det, _ = max(items, key=lambda it: it[1].box[2] * it[1].box[3])
        emb = self.recognizer.embedding(frame, det)
        if emb is None:
            return
        reg["muestras"].append(emb)
        if len(reg["muestras"]) < self.config.registration_samples:
            return

        promedio = FaceRecognizer.promediar(reg["muestras"])
        misma = next((g for g in self._galeria if g[1].lower() == reg["nombre"].lower()), None)
        existente = self.recognizer.buscar(promedio, self._galeria)
        if misma is not None:
            self.personas.actualizar_embedding(misma[0], promedio, consentimiento=True)
            self._galeria = self.personas.galeria()
            self._identidades.clear()
            self._ultimo_intento.clear()
            self._set_notification(f"Actualizado: {reg['nombre']}", duration=3.5)
        elif existente is not None:
            self._set_notification(f"Ya registrada como: {existente.nombre}", duration=3.5)
        else:
            self.personas.registrar(reg["nombre"], promedio, consentimiento=True)
            self._galeria = self.personas.galeria()
            self._identidades.clear()
            self._ultimo_intento.clear()
            self._set_notification(f"Registrado: {reg['nombre']}", duration=3.5)
        self._registro = None

    def _dibujar_registro(self, frame: np.ndarray) -> None:
        """Panel inferior con las instrucciones del flujo de registro (solo ASCII: limitación de OpenCV)."""
        reg = self._registro
        if reg is None:
            return
        if reg["fase"] == "nombre":
            linea1 = f"REGISTRO - Nombre: {reg['texto']}_"
            linea2 = "[Enter] continuar   [Esc] cancelar   (sin acentos)"
        elif reg["fase"] == "consent":
            linea1 = f"{reg['nombre']} acepta que se guarde su vector facial (sin fotos)?"
            linea2 = "[S] Si, acepta   [N] No"
        else:
            linea1 = f"Mire a la camara y alejese de a poco... {len(reg['muestras'])}/{self.config.registration_samples}"
            linea2 = "[Esc] cancelar"

        h, w = frame.shape[:2]
        overlay = frame.copy()
        cv2.rectangle(overlay, (0, h - 70), (w, h), (20, 20, 20), -1)
        cv2.addWeighted(overlay, 0.8, frame, 0.2, 0, frame)
        cv2.putText(frame, linea1, (15, h - 42), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)
        cv2.putText(frame, linea2, (15, h - 16), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (230, 230, 230), 1)

    # ------------------------------------------------------------ calibración de cara neutra

    def _iniciar_calibracion(self) -> None:
        if not hasattr(self.classifier, "set_reposo"):
            self._set_notification("Calibracion no disponible (falta FaceLandmarker)", duration=3.0)
            return
        self._calibracion = {"fin": time.time() + 3.0, "muestras": []}

    def _procesar_calibracion(self, frame: np.ndarray, detecciones: List[FaceDetection]) -> None:
        """Durante 3 s promedia los blendshapes del rostro más grande para fijar el reposo personal."""
        cal = self._calibracion
        if cal is None:
            return
        if detecciones:
            det = max(detecciones, key=lambda d: d.box[2] * d.box[3])
            crop = FaceDetector.crop_face(frame, det.box, margin=self.classifier.crop_margin)
            bs = self.classifier.blendshapes(crop)
            if bs:
                cal["muestras"].append(bs)

        restante = cal["fin"] - time.time()
        if restante > 0:
            self._set_notification(f"Calibrando: mantenga cara NEUTRA... {restante:.0f}s", duration=0.5)
            return
        if len(cal["muestras"]) >= 10 and self.classifier.set_reposo(cal["muestras"]):
            self._set_notification("Calibrado: cara neutra registrada", duration=3.0)
        else:
            self._set_notification("Calibracion fallida: no se detecto rostro", duration=3.0)
        self._calibracion = None

    def _set_notification(self, text: str, duration: float = 2.5) -> None:
        """Configura un mensaje emergente temporal en pantalla."""
        self.notification_text = text
        self.notification_expiry = time.time() + duration

    def _dibujar_esquinas_box(
        self,
        frame: np.ndarray,
        box: Tuple[int, int, int, int],
        color: Tuple[int, int, int],
        thickness: int = 2,
        longitud: int = 15,
    ) -> None:
        """Dibuja un recuadro con esquinas resaltadas estilo HUD."""
        x, y, w, h = box
        # Recuadro base más fino
        cv2.rectangle(frame, (x, y), (x + w, y + h), color, 1)

        l = min(longitud, w // 4, h // 4)
        t = thickness

        # Esquina superior izquierda
        cv2.line(frame, (x, y), (x + l, y), color, t)
        cv2.line(frame, (x, y), (x, y + l), color, t)

        # Esquina superior derecha
        cv2.line(frame, (x + w, y), (x + w - l, y), color, t)
        cv2.line(frame, (x + w, y), (x + w, y + l), color, t)

        # Esquina inferior izquierda
        cv2.line(frame, (x, y + h), (x + l, y + h), color, t)
        cv2.line(frame, (x, y + h), (x, y + h - l), color, t)

        # Esquina inferior derecha
        cv2.line(frame, (x + w, y + h), (x + w - l, y + h), color, t)
        cv2.line(frame, (x + w, y + h), (x + w, y + h - l), color, t)

    def _dibujar_panel_probabilidades(
        self,
        frame: np.ndarray,
        result: EmotionResult,
        x_pos: int = 15,
        y_pos: int = 100,
        ancho_barra: int = 130,
        alto_barra: int = 13,
    ) -> None:
        """Dibuja el panel HUD con barras horizontales de probabilidades de las 7 clases."""
        num_emociones = len(result.probabilities)
        alto_panel = num_emociones * 20 + 35
        ancho_panel = ancho_barra + 130

        # Fondo translúcido
        overlay = frame.copy()
        cv2.rectangle(
            overlay,
            (x_pos - 8, y_pos - 22),
            (x_pos + ancho_panel, y_pos + alto_panel - 15),
            (25, 25, 25),
            -1,
        )
        cv2.addWeighted(overlay, 0.75, frame, 0.25, 0, frame)

        cv2.putText(
            frame,
            "PROBABILIDADES (HUD):",
            (x_pos, y_pos - 6),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.42,
            (255, 255, 255),
            1,
        )

        y_actual = y_pos + 12
        for label, prob in result.probabilities.items():
            color = EMOTION_COLORS.get(label, (255, 255, 255))
            es_top = (label == result.raw_emotion)

            # Nombre de la emoción
            cv2.putText(
                frame,
                f"{label[:8].capitalize()}:",
                (x_pos, y_actual + 10),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.40,
                color if es_top else (175, 175, 175),
                1,
            )

            # Barra de fondo
            bar_x = x_pos + 80
            cv2.rectangle(
                frame,
                (bar_x, y_actual),
                (bar_x + ancho_barra, y_actual + alto_barra),
                (55, 55, 55),
                -1,
            )

            # Barra coloreada proporcional
            ancho_lleno = int(ancho_barra * max(0.0, min(1.0, prob)))
            if ancho_lleno > 0:
                cv2.rectangle(
                    frame,
                    (bar_x, y_actual),
                    (bar_x + ancho_lleno, y_actual + alto_barra),
                    color,
                    -1,
                )

            # Porcentaje
            cv2.putText(
                frame,
                f"{prob * 100:.1f}%",
                (bar_x + ancho_barra + 6, y_actual + 10),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.36,
                (255, 255, 255),
                1,
            )

            y_actual += 20

    def _renderizar_frame(
        self,
        frame: np.ndarray,
        detecciones_con_emocion: List[Tuple[int, FaceDetection, EmotionResult]],
        fps: float,
        latencia_total: float,
    ) -> None:
        """Dibuja todos los elementos gráficos sobre el frame."""
        # 1. Recuadros y etiquetas de rostros con ID de tracking
        for (track_id, det, em_res) in detecciones_con_emocion:
            x, y, w, h = det.box
            color = EMOTION_COLORS.get(em_res.emotion, (0, 255, 0))

            # Dibujar esquinas del recuadro
            self._dibujar_esquinas_box(frame, det.box, color=color, thickness=2)

            # Etiqueta con ID persistente y porcentaje
            identidad = self._identidades.get(track_id)
            quien = identidad.nombre if identidad else f"ID:{track_id}"
            etiqueta = f"{quien} {em_res.emotion.upper()} {em_res.confidence * 100:.0f}%"
            (tw, th), _ = cv2.getTextSize(etiqueta, cv2.FONT_HERSHEY_SIMPLEX, 0.58, 2)
            y_text = max(26, y - 8)

            cv2.rectangle(
                frame,
                (x, y_text - th - 6),
                (x + tw + 8, y_text + 4),
                color,
                -1,
            )
            cv2.putText(
                frame,
                etiqueta,
                (x + 4, y_text - 2),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.58,
                (0, 0, 0),
                2,
            )

        # 2. Panel HUD de probabilidades para el primer rostro activo
        if self.show_hud_bars and detecciones_con_emocion:
            self._dibujar_panel_probabilidades(frame, detecciones_con_emocion[0][2], x_pos=15, y_pos=85)

        # 3. Telemetría superior y estado de suavizado
        if self.show_stats:
            estado_smooth = "ON" if self.enable_smoothing else "OFF"
            cv2.putText(
                frame,
                f"FPS: {fps:.1f} | Latencia: {latencia_total:.1f}ms | Umbral: {self.classifier.min_confidence:.2f} | Smooth: {estado_smooth}",
                (15, 25),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.52,
                (0, 255, 255),
                2,
            )
            cv2.putText(
                frame,
                f"Rostros: {len(detecciones_con_emocion)} | [H] HUD  [C] Foto  [T] Umbral  [K] Calibrar  [B] Sensib.  [M] Suavizado  [R] Registrar  [Q] Salir",
                (15, 48),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.44,
                (240, 240, 240),
                1,
            )

        # 4. Panel de registro de personas
        self._dibujar_registro(frame)

        # 5. Notificación temporal en pantalla
        if self.notification_text and time.time() < self.notification_expiry:
            (nw, nh), _ = cv2.getTextSize(self.notification_text, cv2.FONT_HERSHEY_SIMPLEX, 0.65, 2)
            nx = (frame.shape[1] - nw) // 2
            ny = frame.shape[0] - 25

            cv2.rectangle(
                frame,
                (nx - 10, ny - nh - 8),
                (nx + nw + 10, ny + 8),
                (40, 40, 40),
                -1,
            )
            cv2.putText(
                frame,
                self.notification_text,
                (nx, ny),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.65,
                (0, 255, 255),
                2,
            )

    def _guardar_captura_manual(self, frame: np.ndarray) -> str:
        """Guarda la imagen actual en disco bajo demanda explícita del usuario."""
        ts_str = datetime.now().strftime("%Y%m%d_%H%M%S")
        nombre = f"captura_{ts_str}.jpg"
        ruta = self.captures_dir / nombre
        cv2.imwrite(str(ruta), frame)
        return str(ruta)

    def run_webcam(self) -> None:
        """Ejecuta el bucle principal de procesamiento con la cámara web."""
        from test_detector import abrir_camara

        cap = abrir_camara(self.camera_index)
        if cap is None or not cap.isOpened():
            print(f"\n[ERROR] No se pudo acceder a la cámara #{self.camera_index}.")
            print("Verifica permisos en Windows o que otra aplicación no la esté bloqueando.")
            return

        logger = EmotionCSVLogger(source="webcam") if self.enable_logging else None
        db_logger = (
            EmotionDBLogger(
                source="webcam",
                session_id=logger.session_id if logger else None,
                sample_interval_s=self.config.db_sample_interval_s,
            )
            if self.enable_db
            else None
        )
        nombre_ventana = "Ánima — Recepción (Fase 5)"
        # Ventana redimensionable que conserva la proporción (el modo por defecto no escala el video)
        cv2.namedWindow(nombre_ventana, cv2.WINDOW_NORMAL | cv2.WINDOW_KEEPRATIO)
        pantalla_completa = False
        if hasattr(self.classifier, "set_reposo"):
            self._set_notification("Tip: con cara neutra presione K para calibrar", duration=6.0)

        print(f"\n[OK] Cámara #{self.camera_index} iniciada con éxito.")
        print("Atajos de teclado:")
        print(" [H]: Alternar panel HUD de probabilidades")
        print(" [C]: Guardar captura de pantalla en data/capturas/")
        print(" [T]: Alternar umbral de confianza (0.35 / 0.45 / 0.60)")
        print(" [K]: Calibrar cara neutra (3 s mirando a la cámara sin gesto)")
        print(" [B]: Sensibilidad a expresiones leves (peso de neutral 1.0 / 0.8 / 0.6 / 0.4)")
        print(" [S]: Alternar información de telemetría y FPS")
        print(" [R]: Registrar a una persona (pide nombre y consentimiento)")
        print(" [F]: Alternar pantalla completa")
        print(" [Q] o [ESC]: Salir de la aplicación\n")

        frame_count = 0
        tiempos_frame = []
        fallos = 0

        try:
            while True:
                ret, frame = cap.read()
                if not ret or frame is None:
                    fallos += 1
                    if fallos >= 30:
                        print("[ERROR] Pérdida de conexión con la cámara web.")
                        break
                    time.sleep(0.1)
                    continue

                fallos = 0
                frame_count += 1
                if frame_count == 1:
                    h_real, w_real = frame.shape[:2]
                    print(f"[OK] Resolución de captura: {w_real}x{h_real}")
                    # La distancia máxima de seguimiento (120 px) se definió para 640 px de ancho
                    self.tracker.max_centroid_dist *= w_real / 640.0
                t0 = time.perf_counter()

                # 1. Detección
                detecciones = self.detector.detect(frame)

                if self._calibracion is not None:
                    self._procesar_calibracion(frame, detecciones)

                # 2. Clasificación cruda
                raw_results: List[EmotionResult] = []
                dets_validas: List[FaceDetection] = []
                # Solo se clasifica cada N cuadros; en los demás se reutiliza el resultado del rostro seguido
                cada_n = max(1, self.config.classify_every_n_frames)
                if cada_n > 1 and frame_count % cada_n != 0:
                    reutilizados = reutilizar_resultados(detecciones, self._previos)
                else:
                    reutilizados = [None] * len(detecciones)
                for det, reutilizado in zip(detecciones, reutilizados):
                    if reutilizado is not None:
                        em_res = reutilizado
                    elif hasattr(self.classifier, "predict_face"):
                        em_res = self.classifier.predict_face(frame, det.box)
                    else:
                        crop = FaceDetector.crop_face(
                            frame, det.box, margin=getattr(self.classifier, "crop_margin", 0.15)
                        )
                        em_res = self.classifier.predict(crop) if crop is not None else None
                    if em_res:
                        raw_results.append(em_res)
                        dets_validas.append(det)
                self._previos = [(d.box, r) for d, r in zip(dets_validas, raw_results)]

                # 3. Seguimiento multirrostro y suavizado temporal
                if self.enable_smoothing:
                    items_finales = self.tracker.update(dets_validas, raw_results)
                else:
                    items_finales = [
                        (idx, det, raw_res)
                        for idx, (det, raw_res) in enumerate(zip(dets_validas, raw_results), start=1)
                    ]

                self._actualizar_identidades(frame, items_finales, frame_count, db_logger)
                self._capturar_para_registro(frame, items_finales)

                for track_id, det, final_res in items_finales:
                    self.session_counts[final_res.emotion] = (
                        self.session_counts.get(final_res.emotion, 0) + 1
                    )
                    if logger:
                        logger.log_prediction(frame_id=frame_count, face_id=track_id, result=final_res)
                    if db_logger:
                        db_logger.log_prediction(track_id=track_id, result=final_res)

                dt = (time.perf_counter() - t0) * 1000
                tiempos_frame.append(dt)

                lat_media = np.mean(tiempos_frame[-30:]) if tiempos_frame else dt
                fps = 1000.0 / lat_media if lat_media > 0 else 0

                # 4. Renderizado
                self._renderizar_frame(frame, items_finales, fps=fps, latencia_total=lat_media)

                cv2.imshow(nombre_ventana, frame)
                tecla = cv2.waitKey(1) & 0xFF

                if self._registro is not None:
                    self._tecla_registro(tecla)
                    continue

                if tecla in (ord("q"), ord("Q"), 27):
                    break
                elif tecla in (ord("f"), ord("F")):
                    pantalla_completa = not pantalla_completa
                    cv2.setWindowProperty(
                        nombre_ventana,
                        cv2.WND_PROP_FULLSCREEN,
                        cv2.WINDOW_FULLSCREEN if pantalla_completa else cv2.WINDOW_NORMAL,
                    )
                elif tecla in (ord("r"), ord("R")):
                    self._iniciar_registro()
                elif tecla in (ord("h"), ord("H")):
                    self.show_hud_bars = not self.show_hud_bars
                    estado = "Visible" if self.show_hud_bars else "Oculto"
                    self._set_notification(f"Panel HUD: {estado}")
                elif tecla in (ord("s"), ord("S")):
                    self.show_stats = not self.show_stats
                    estado = "Visible" if self.show_stats else "Oculto"
                    self._set_notification(f"Telemetría: {estado}")
                elif tecla in (ord("m"), ord("M")):
                    self.enable_smoothing = not self.enable_smoothing
                    estado = "Activado" if self.enable_smoothing else "Desactivado"
                    self._set_notification(f"Suavizado Temporal: {estado}")
                elif tecla in (ord("t"), ord("T")):
                    self._current_thresh_idx = (self._current_thresh_idx + 1) % len(self._threshold_levels)
                    nuevo_umbral = self._threshold_levels[self._current_thresh_idx]
                    self.classifier.min_confidence = nuevo_umbral
                    self.tracker.threshold = nuevo_umbral
                    self._set_notification(f"Umbral ajustado a: {nuevo_umbral * 100:.0f}%")
                elif tecla in (ord("k"), ord("K")):
                    self._iniciar_calibracion()
                elif tecla in (ord("b"), ord("B")):
                    niveles = [1.0, 0.8, 0.6, 0.4]
                    actual = min(range(len(niveles)), key=lambda i: abs(niveles[i] - self.classifier.neutral_bias))
                    self.classifier.neutral_bias = niveles[(actual + 1) % len(niveles)]
                    self._set_notification(f"Sensibilidad (peso neutral): {self.classifier.neutral_bias:.1f}")
                elif tecla in (ord("c"), ord("C")):
                    ruta_guardada = self._guardar_captura_manual(frame)
                    p_rel = Path(ruta_guardada).name
                    self._set_notification(f"Captura guardada: {p_rel}", duration=3.0)

        finally:
            cap.release()
            cv2.destroyAllWindows()
            if logger:
                logger.close()
            if db_logger:
                db_logger.close()

        # Resumen final de la sesión
        self._imprimir_resumen(len(tiempos_frame), tiempos_frame, logger, db_logger)

    def run_image(self, image_path: str) -> None:
        """Procesa una imagen estática (JPG/PNG)."""
        from test_classifier import procesar_imagen_estatica

        logger = EmotionCSVLogger(source="imagen") if self.enable_logging else None
        try:
            procesar_imagen_estatica(
                image_path,
                self.detector,
                self.classifier,
                logger=logger,
                mostrar_ventana=True,
            )
        finally:
            if logger:
                logger.close()
                print(f"[OK] Telemetría registrada en: {logger.file_path}")

    def _imprimir_resumen(
        self,
        total_frames: int,
        tiempos: List[float],
        logger: Optional[EmotionCSVLogger],
        db_logger: Optional[EmotionDBLogger] = None,
    ) -> None:
        """Imprime métricas y estadísticas consolidadas al cerrar la sesión."""
        print("\n====================================================")
        print("          RESUMEN DE SESIÓN - FASE 5                ")
        print("====================================================")
        if total_frames > 0 and tiempos:
            lat_media = np.mean(tiempos)
            fps_medio = 1000.0 / lat_media if lat_media > 0 else 0
            print(f" Frames totales procesados: {total_frames}")
            print(f" Latencia promedio por frame: {lat_media:.2f} ms")
            print(f" FPS promedio de la sesión: {fps_medio:.1f} FPS")

            print("\n Distribución de Emociones Registradas:")
            total_emociones = sum(self.session_counts.values())
            if total_emociones > 0:
                for emo, cant in sorted(self.session_counts.items(), key=lambda x: x[1], reverse=True):
                    if cant > 0:
                        pct = (cant / total_emociones) * 100
                        print(f"  - {emo.capitalize():14s}: {cant:4d} veces ({pct:5.1f}%)")

        if logger:
            print(f"\n Log CSV guardado en:\n  {logger.file_path} ({logger.total_logged} registros)")
        if db_logger:
            print(f"\n Base de datos:\n  {db_logger.db_path} ({db_logger.total_logged} registros muestreados)")
        print("====================================================\n")

    def close(self) -> None:
        """Libera recursos del detector y clasificador."""
        self.detector.close()
        self.classifier.close()
        if self.recognizer:
            self.recognizer.close()
        if self.personas:
            self.personas.close()
