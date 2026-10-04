"""
Módulo de Reconocimiento de Identidad
Genera embeddings faciales (ArcFace MobileFaceNet en ONNX) y los compara por similitud coseno.
Solo se manejan vectores numéricos: nunca se guardan imágenes del rostro.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, List, Optional, Sequence, Tuple
import cv2
import numpy as np
import onnxruntime as ort

from config import DEFAULT_CONFIG

if TYPE_CHECKING:
    from core.detector import FaceDetection

# Plantilla estándar de ArcFace para una cara alineada de 112x112 (x, y)
_PLANTILLA_ARCFACE = {
    "ojo_en_izquierda_imagen": (38.2946, 51.6963),
    "ojo_en_derecha_imagen": (73.5318, 51.5014),
    "punta_nariz": (56.0252, 71.7366),
    "centro_boca": (56.1396, 92.2848),  # promedio de las dos comisuras de la plantilla original
}
_TAMANO_ENTRADA = 112


@dataclass
class Match:
    """Resultado de comparar un embedding contra la galería de personas registradas."""

    persona_id: int
    nombre: str
    similitud: float


class FaceRecognizer:
    """Extrae embeddings faciales de 512 dimensiones y busca coincidencias en una galería."""

    def __init__(
        self,
        model_path: Optional[Path] = None,
        threshold: Optional[float] = None,
    ) -> None:
        self.model_path = Path(model_path or DEFAULT_CONFIG.recognizer_model_path)
        self.threshold = float(threshold if threshold is not None else DEFAULT_CONFIG.recognition_threshold)

        if not self.model_path.exists():
            raise FileNotFoundError(
                f"Modelo de reconocimiento no encontrado: {self.model_path}. "
                "Descargalo con: python -m utils.download_model --reconocimiento"
            )

        self._session = ort.InferenceSession(str(self.model_path), providers=["CPUExecutionProvider"])
        self._input_name = self._session.get_inputs()[0].name

    # ------------------------------------------------------------------ alineación

    @staticmethod
    def alinear(frame: np.ndarray, det: "FaceDetection") -> Optional[np.ndarray]:
        """
        Devuelve el rostro alineado a 112x112 (BGR).

        Usa los landmarks de BlazeFace (ojos, nariz, boca) para estimar una transformación de
        similitud hacia la plantilla de ArcFace. Sin landmarks, recorta el recuadro cuadrado.
        """
        if frame is None or frame.size == 0:
            return None

        lm = det.landmarks or {}
        claves = ("ojo_derecho", "ojo_izquierdo", "punta_nariz", "centro_boca")
        if all(k in lm for k in claves):
            # En MediaPipe, "ojo_derecho" es el ojo derecho del sujeto, que queda a la izquierda de la imagen.
            origen = np.array([lm[k] for k in claves], dtype=np.float32)
            destino = np.array(
                [
                    _PLANTILLA_ARCFACE["ojo_en_izquierda_imagen"],
                    _PLANTILLA_ARCFACE["ojo_en_derecha_imagen"],
                    _PLANTILLA_ARCFACE["punta_nariz"],
                    _PLANTILLA_ARCFACE["centro_boca"],
                ],
                dtype=np.float32,
            )
            matriz, _ = cv2.estimateAffinePartial2D(origen, destino, method=cv2.LMEDS)
            if matriz is not None:
                return cv2.warpAffine(
                    frame, matriz, (_TAMANO_ENTRADA, _TAMANO_ENTRADA), borderValue=0
                )

        # Alternativa: recorte cuadrado centrado en el recuadro
        x, y, w, h = det.box
        lado = max(w, h)
        cx, cy = x + w // 2, y + h // 2
        x1, y1 = max(0, cx - lado // 2), max(0, cy - lado // 2)
        recorte = frame[y1 : y1 + lado, x1 : x1 + lado]
        if recorte.size == 0:
            return None
        return cv2.resize(recorte, (_TAMANO_ENTRADA, _TAMANO_ENTRADA), interpolation=cv2.INTER_AREA)

    # ------------------------------------------------------------------ embedding

    def embedding(self, frame: np.ndarray, det: "FaceDetection") -> Optional[np.ndarray]:
        """Calcula el embedding L2-normalizado (512 float32) de un rostro detectado."""
        cara = self.alinear(frame, det)
        if cara is None:
            return None
        return self.embedding_de_alineada(cara)

    def embedding_de_alineada(self, cara_bgr_112: np.ndarray) -> np.ndarray:
        """Embedding de un rostro ya alineado de 112x112 en BGR."""
        rgb = cv2.cvtColor(cara_bgr_112, cv2.COLOR_BGR2RGB).astype(np.float32)
        tensor = ((rgb - 127.5) / 127.5).transpose(2, 0, 1)[np.newaxis, ...]
        salida = self._session.run(None, {self._input_name: tensor})[0][0]
        return self.normalizar(salida)

    # ------------------------------------------------------------------ comparación

    @staticmethod
    def normalizar(vector: np.ndarray) -> np.ndarray:
        v = np.asarray(vector, dtype=np.float32).ravel()
        norma = float(np.linalg.norm(v))
        return v / norma if norma > 0 else v

    @classmethod
    def promediar(cls, embeddings: Sequence[np.ndarray]) -> np.ndarray:
        """Promedia varios embeddings de una misma persona en un único vector normalizado."""
        if not embeddings:
            raise ValueError("Se necesita al menos un embedding para promediar.")
        return cls.normalizar(np.mean(np.stack(embeddings), axis=0))

    def buscar(
        self,
        embedding: np.ndarray,
        galeria: Sequence[Tuple[int, str, np.ndarray]],
    ) -> Optional[Match]:
        """
        Busca la persona más parecida. Retorna None si la mejor similitud no supera el umbral.

        :param galeria: Secuencia de (persona_id, nombre, embedding_normalizado).
        """
        if not galeria:
            return None
        matriz = np.stack([g[2] for g in galeria])
        similitudes = matriz @ self.normalizar(embedding)
        mejor = int(np.argmax(similitudes))
        if float(similitudes[mejor]) < self.threshold:
            return None
        pid, nombre, _ = galeria[mejor]
        return Match(persona_id=pid, nombre=nombre, similitud=float(similitudes[mejor]))

    def close(self) -> None:
        self._session = None
