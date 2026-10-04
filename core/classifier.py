"""
Módulo de Clasificación de Emociones
Utiliza ONNX Runtime y el modelo preentrenado FER+ para inferencia ultra-rápida en CPU.
"""

from dataclasses import dataclass
from pathlib import Path
import time
from typing import Dict, List, Optional, Tuple, Union
import cv2
import numpy as np
import onnxruntime as ort

from config import DEFAULT_CONFIG


@dataclass
class EmotionResult:
    """Estructura de datos con el resultado de la clasificación de emoción."""

    emotion: str  # Emoción asignada (o 'incierto' si no supera el umbral)
    confidence: float  # Confianza de la emoción predicha (entre 0.0 y 1.0)
    raw_emotion: str  # Emoción ganadora original antes de aplicar el umbral
    probabilities: Dict[str, float]  # Distribución de probabilidades de las 7 clases
    inference_time_ms: float  # Tiempo de inferencia en milisegundos


class EmotionClassifier:
    """Clasificador de emociones faciales en 7 categorías estándar basado en FER+ y ONNX."""

    def __init__(
        self,
        model_path: Optional[Union[str, Path]] = None,
        min_confidence: Optional[float] = None,
        labels: Optional[List[str]] = None,
        neutral_bias: Optional[float] = None,
    ) -> None:
        """
        Inicializa el clasificador de emociones cargando el modelo ONNX.

        :param model_path: Ruta al archivo .onnx. Si no existe, intenta descargarlo automáticamente.
        :param min_confidence: Umbral de confianza mínimo (0.0 a 1.0). Menor a este valor retorna 'incierto'.
        :param labels: Lista de nombres de las 7 clases de emociones.
        """
        self.model_path = Path(model_path or DEFAULT_CONFIG.onnx_model_path)
        self.min_confidence = (
            float(min_confidence)
            if min_confidence is not None
            else DEFAULT_CONFIG.emotion_confidence_threshold
        )
        self.labels = labels or list(DEFAULT_CONFIG.emotion_labels)
        self.neutral_bias = float(neutral_bias if neutral_bias is not None else DEFAULT_CONFIG.neutral_bias)

        # Asegurar que el modelo exista localmente
        if not self.model_path.is_file():
            print(f"[INFO] Modelo no encontrado en {self.model_path}. Iniciando descarga automática...")
            from utils.download_model import descargar_modelo
            if not descargar_modelo(self.model_path):
                raise FileNotFoundError(
                    f"No se pudo cargar ni descargar el modelo ONNX en: {self.model_path}"
                )

        # Opciones de optimización para CPU en ONNX Runtime
        session_options = ort.SessionOptions()
        session_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        session_options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL

        try:
            self._session = ort.InferenceSession(
                str(self.model_path),
                sess_options=session_options,
                providers=["CPUExecutionProvider"],
            )
        except Exception as e:
            raise RuntimeError(f"Error al inicializar sesión de ONNX Runtime con {self.model_path}: {e}")

        # Inspección de tensores de entrada y salida
        inputs = self._session.get_inputs()
        self._input_name = inputs[0].name
        self._expected_shape = inputs[0].shape  # Ej: [1, 1, 64, 64]
        self._input_height = self._expected_shape[2] if len(self._expected_shape) == 4 else 64
        self._input_width = self._expected_shape[3] if len(self._expected_shape) == 4 else 64

        # Realizar inferencia de calentamiento (warm-up) para compilar kernels en CPU
        self._warmup()

    def _warmup(self) -> None:
        """Ejecuta una inferencia simulada para calentar la caché del CPU."""
        dummy_input = np.zeros(
            (1, 1, self._input_height, self._input_width), dtype=np.float32
        )
        try:
            self._session.run(None, {self._input_name: dummy_input})
        except Exception:
            pass

    def preprocess(self, face_crop: np.ndarray) -> Optional[np.ndarray]:
        """
        Preprocesa el recorte facial para adecuarlo a la entrada del modelo FER+ (64x64, 1 canal float32).

        :param face_crop: Recorte de imagen del rostro (formato BGR o Grises).
        :return: Tensor NumPy con forma (1, 1, 64, 64) o None si el recorte es inválido.
        """
        if face_crop is None or not isinstance(face_crop, np.ndarray) or face_crop.size == 0:
            return None

        h, w = face_crop.shape[:2]
        if h < 8 or w < 8:
            return None

        # Convertir a escala de grises si tiene 3 canales
        if len(face_crop.shape) == 3 and face_crop.shape[2] >= 3:
            gray = cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY)
        elif len(face_crop.shape) == 2:
            gray = face_crop
        else:
            return None

        # Redimensionar a la resolución esperada por el modelo (64x64)
        resized = cv2.resize(
            gray,
            (self._input_width, self._input_height),
            interpolation=cv2.INTER_AREA,
        )

        # Convertir a float32 y dar forma (1, 1, H, W) manteniendo rango [0.0, 255.0]
        tensor = resized.astype(np.float32).reshape(1, 1, self._input_height, self._input_width)
        return tensor

    @staticmethod
    def _softmax(logits: np.ndarray) -> np.ndarray:
        """Calcula softmax numéricamente estable sobre un vector 1D de logits."""
        shift_logits = logits - np.max(logits)
        exp_vals = np.exp(shift_logits)
        sum_exp = np.sum(exp_vals)
        if sum_exp == 0:
            return np.ones_like(logits) / len(logits)
        return exp_vals / sum_exp

    def predict(self, face_crop: np.ndarray) -> Optional[EmotionResult]:
        """
        Clasifica la emoción del rostro proporcionado.

        :param face_crop: Recorte BGR del rostro.
        :return: EmotionResult con la emoción, confianza y probabilidades, o None si el frame es inválido.
        """
        tensor = self.preprocess(face_crop)
        if tensor is None:
            return None

        t0 = time.perf_counter()
        try:
            raw_outputs = self._session.run(None, {self._input_name: tensor})
            logits = raw_outputs[0][0]
        except Exception as e:
            print(f"[ERROR] Error durante la inferencia ONNX de emoción: {e}")
            return None

        latency_ms = (time.perf_counter() - t0) * 1000

        # El modelo FER+ original produce 8 clases:
        # [0: neutral, 1: happiness, 2: surprise, 3: sadness, 4: anger, 5: disgust, 6: fear, 7: contempt]
        # Tomamos las primeras 7 clases estándar requeridas por la especificación:
        logits_7 = logits[:7]
        probs = self._softmax(logits_7)

        # FER+ favorece "neutral" (índice 0): restarle peso deja que expresiones leves ganen
        if self.neutral_bias != 1.0:
            probs = probs.copy()
            probs[0] *= self.neutral_bias
            probs /= probs.sum()

        # Construir diccionario de probabilidades para las 7 clases
        prob_dict: Dict[str, float] = {}
        for idx, label in enumerate(self.labels):
            prob_dict[label] = float(probs[idx]) if idx < len(probs) else 0.0

        # Encontrar la emoción de máxima probabilidad
        max_idx = int(np.argmax(probs))
        raw_emotion = self.labels[max_idx]
        confidence = float(probs[max_idx])

        # Aplicar umbral de certeza para evitar conjeturas dudosas
        assigned_emotion = raw_emotion if confidence >= self.min_confidence else "incierto"

        return EmotionResult(
            emotion=assigned_emotion,
            confidence=confidence,
            raw_emotion=raw_emotion,
            probabilities=prob_dict,
            inference_time_ms=latency_ms,
        )

    def close(self) -> None:
        """Libera recursos de la sesión ONNX si es necesario."""
        self._session = None
