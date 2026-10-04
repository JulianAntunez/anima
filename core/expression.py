"""
Clasificador de emociones basado en blendshapes de MediaPipe FaceLandmarker.
Mide directamente los movimientos faciales (sonrisa, cejas, boca, nariz, ojos), los compara con
el reposo de la persona y los convierte en probabilidades con reglas inspiradas en EMFACS.
Opcionalmente se combina con FER+ como segunda opinión (EnsembleEmotionClassifier).
"""

from pathlib import Path
import time
from typing import Dict, List, Optional, Sequence, Tuple, Union
import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python as mp_tasks
from mediapipe.tasks.python import vision

from config import DEFAULT_CONFIG
from core.classifier import EmotionClassifier, EmotionResult
from core.detector import FaceDetector

# Peso del "prior" de neutral frente a las demás emociones (se escala con neutral_bias)
_PRIOR_NEUTRAL_BASE = 0.5

# Nivel de reposo típico, usado hasta que la persona calibra su propia cara neutra
_REPOSO_GENERICO: Dict[str, float] = {
    "browDownLeft": 0.10,
    "browDownRight": 0.10,
    "eyeSquintLeft": 0.25,
    "eyeSquintRight": 0.25,
}


def _r(x: float, lo: float, hi: float) -> float:
    """Normaliza x al rango [0, 1] entre lo (0) y hi (1)."""
    return float(min(1.0, max(0.0, (x - lo) / (hi - lo))))


def _media(bs: Dict[str, float], *nombres: str) -> float:
    return float(np.mean([bs.get(n, 0.0) for n in nombres]))


def restar_reposo(bs: Dict[str, float], reposo: Optional[Dict[str, float]]) -> Dict[str, float]:
    """Devuelve cuánto se aparta cada blendshape del reposo (nunca negativo)."""
    ref = reposo if reposo is not None else _REPOSO_GENERICO
    return {k: max(0.0, v - ref.get(k, 0.0)) for k, v in bs.items()}


def puntuar_emociones(bs: Dict[str, float], reposo: Optional[Dict[str, float]] = None) -> Dict[str, float]:
    """
    Puntuación 0-1 por emoción (sin neutral) a partir de blendshapes y reglas EMFACS:
    felicidad AU6+12, tristeza AU1+4+15, sorpresa AU1+2+5+26, enojo AU4+5+7+23,
    asco AU9/10, miedo AU1+2+4+5+20.
    """
    d = restar_reposo(bs, reposo)

    sonrisa = _media(d, "mouthSmileLeft", "mouthSmileRight")  # AU12
    mejillas = _media(d, "cheekSquintLeft", "cheekSquintRight")  # AU6
    ceja_baja = _media(d, "browDownLeft", "browDownRight")  # AU4
    ceja_int = d.get("browInnerUp", 0.0)  # AU1
    ceja_ext = _media(d, "browOuterUpLeft", "browOuterUpRight")  # AU2
    ojos_abiertos = _media(d, "eyeWideLeft", "eyeWideRight")  # AU5
    ojos_tensos = _media(d, "eyeSquintLeft", "eyeSquintRight")  # AU7
    mandibula = d.get("jawOpen", 0.0)  # AU26
    comisura_baja = _media(d, "mouthFrownLeft", "mouthFrownRight")  # AU15
    labio_inf = d.get("mouthShrugLower", 0.0)  # AU17
    nariz = _media(d, "noseSneerLeft", "noseSneerRight")  # AU9
    labio_sup = _media(d, "mouthUpperUpLeft", "mouthUpperUpRight")  # AU10
    labios_presion = _media(d, "mouthPressLeft", "mouthPressRight")  # AU23/24
    boca_estirada = _media(d, "mouthStretchLeft", "mouthStretchRight")  # AU20

    feliz = min(1.0, _r(sonrisa, 0.05, 0.30) + 0.25 * _r(mejillas, 0.05, 0.30))

    sorprendido = min(
        1.0,
        0.5 * _r(mandibula, 0.05, 0.30)
        + 0.3 * _r(ceja_int, 0.03, 0.30)
        + 0.3 * _r(ceja_ext, 0.03, 0.25)
        + 0.3 * _r(ojos_abiertos, 0.05, 0.40),
    )

    triste = min(
        1.0,
        0.6 * _r(comisura_baja, 0.05, 0.35)
        + 0.5 * _r(labio_inf, 0.15, 0.50)
        + 0.4 * _r(ceja_int, 0.05, 0.30)
        + 0.2 * _r(ceja_baja, 0.10, 0.45),
    ) * (1.0 - feliz)

    # El ceño solo no alcanza: hace falta otra señal (ojos tensos, labios apretados, nariz, ojos abiertos)
    apoyo_enojo = min(
        1.0,
        0.6 * _r(ojos_tensos, 0.10, 0.40)
        + 0.6 * _r(labios_presion, 0.05, 0.30)
        + 0.4 * _r(nariz, 0.05, 0.30)
        + 0.4 * _r(ojos_abiertos, 0.10, 0.40),
    )
    enojado = (
        _r(ceja_baja, 0.10, 0.45)
        * (0.35 + 0.65 * apoyo_enojo)
        * (1.0 - 0.6 * _r(labio_inf, 0.15, 0.50))
        * (1.0 - feliz)
    )

    asco = min(1.0, 0.6 * _r(nariz, 0.05, 0.35) + 0.6 * _r(labio_sup, 0.08, 0.40)) * (1.0 - feliz)

    miedo = min(
        1.0,
        0.5 * _r(ojos_abiertos, 0.10, 0.45)
        + 0.4 * _r(ceja_int, 0.10, 0.40)
        + 0.2 * _r(ceja_ext, 0.05, 0.25)
        + 0.4 * _r(boca_estirada, 0.10, 0.50),
    ) * (1.0 - feliz) * (1.0 - 0.7 * _r(mandibula, 0.15, 0.40))

    return {
        "feliz": feliz,
        "sorprendido": sorprendido,
        "triste": triste,
        "enojado": enojado,
        "asco": asco,
        "miedo": miedo,
    }


def combinar_probabilidades(
    p_blend: Dict[str, float],
    p_fer: Optional[Dict[str, float]],
    peso_fer: float,
    labels: Sequence[str],
) -> Dict[str, float]:
    """
    Suma la opinión de FER+ solo en las emociones no neutrales (FER+ siempre favorece neutral
    y taparía las señales de los blendshapes). Devuelve probabilidades normalizadas.
    """
    if p_fer is None:
        return dict(p_blend)
    mezcla = {
        lbl: p_blend.get(lbl, 0.0) + (0.0 if lbl == "neutral" else peso_fer * p_fer.get(lbl, 0.0))
        for lbl in labels
    }
    total = sum(mezcla.values())
    return {lbl: v / total for lbl, v in mezcla.items()} if total > 0 else dict(p_blend)


def _resultado(probs: Dict[str, float], min_confidence: float, latency_ms: float) -> EmotionResult:
    raw_emotion = max(probs, key=probs.get)
    confidence = float(probs[raw_emotion])
    return EmotionResult(
        emotion=raw_emotion if confidence >= min_confidence else "incierto",
        confidence=confidence,
        raw_emotion=raw_emotion,
        probabilities=dict(probs),
        inference_time_ms=latency_ms,
    )


class BlendshapeEmotionClassifier:
    """Mismo contrato que EmotionClassifier (predict(crop) -> EmotionResult), basado en blendshapes."""

    crop_margin = 0.5  # FaceLandmarker necesita ver la cabeza completa dentro del recorte

    def __init__(
        self,
        model_path: Optional[Union[str, Path]] = None,
        min_confidence: Optional[float] = None,
        labels: Optional[List[str]] = None,
        neutral_bias: Optional[float] = None,
    ) -> None:
        self.model_path = Path(model_path or DEFAULT_CONFIG.landmarker_model_path)
        self.min_confidence = (
            float(min_confidence) if min_confidence is not None else DEFAULT_CONFIG.emotion_confidence_threshold
        )
        self.labels = labels or list(DEFAULT_CONFIG.emotion_labels)
        self.neutral_bias = float(neutral_bias if neutral_bias is not None else DEFAULT_CONFIG.neutral_bias)
        self.reposo: Optional[Dict[str, float]] = None

        if not self.model_path.is_file():
            raise FileNotFoundError(
                f"Modelo FaceLandmarker no encontrado: {self.model_path}. "
                "Descargalo con: python -m utils.download_model --landmarker"
            )

        # Se carga como bytes: en Windows MediaPipe falla con rutas absolutas
        opciones = vision.FaceLandmarkerOptions(
            base_options=mp_tasks.BaseOptions(model_asset_buffer=self.model_path.read_bytes()),
            running_mode=vision.RunningMode.IMAGE,
            num_faces=1,
            output_face_blendshapes=True,
            min_face_detection_confidence=0.3,
            min_face_presence_confidence=0.3,
        )
        self._landmarker = vision.FaceLandmarker.create_from_options(opciones)

    def blendshapes(self, face_crop: np.ndarray) -> Optional[Dict[str, float]]:
        if face_crop is None or not isinstance(face_crop, np.ndarray) or face_crop.size == 0:
            return None
        rgb = np.ascontiguousarray(cv2.cvtColor(face_crop, cv2.COLOR_BGR2RGB))
        try:
            res = self._landmarker.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
        except Exception as e:
            print(f"[ERROR] Error en FaceLandmarker: {e}")
            return None
        if not res.face_blendshapes:
            return None
        return {b.category_name: float(b.score) for b in res.face_blendshapes[0]}

    def set_reposo(self, muestras: Sequence[Dict[str, float]]) -> bool:
        """Fija el reposo personal como la mediana de varias lecturas de cara neutra."""
        if not muestras:
            return False
        self.reposo = {k: float(np.median([m.get(k, 0.0) for m in muestras])) for k in muestras[0]}
        return True

    def probabilidades(self, bs: Dict[str, float]) -> Dict[str, float]:
        puntajes = puntuar_emociones(bs, self.reposo)
        prior_neutral = _PRIOR_NEUTRAL_BASE * self.neutral_bias
        crudo = np.array(
            [prior_neutral if lbl == "neutral" else puntajes.get(lbl, 0.0) for lbl in self.labels],
            dtype=np.float64,
        )
        probs = crudo / crudo.sum()
        return {lbl: float(p) for lbl, p in zip(self.labels, probs)}

    def predict(self, face_crop: np.ndarray) -> Optional[EmotionResult]:
        t0 = time.perf_counter()
        bs = self.blendshapes(face_crop)
        if bs is None:
            return None
        probs = self.probabilidades(bs)
        return _resultado(probs, self.min_confidence, (time.perf_counter() - t0) * 1000)

    def close(self) -> None:
        if getattr(self, "_landmarker", None) is not None:
            self._landmarker.close()
            self._landmarker = None


class EnsembleEmotionClassifier:
    """Blendshapes como señal principal + FER+ como segunda opinión (votación)."""

    crop_margin = BlendshapeEmotionClassifier.crop_margin

    def __init__(
        self,
        blend: BlendshapeEmotionClassifier,
        fer: EmotionClassifier,
        peso_fer: Optional[float] = None,
    ) -> None:
        self.blend = blend
        self.fer = fer
        self.peso_fer = float(peso_fer if peso_fer is not None else DEFAULT_CONFIG.fer_vote_weight)
        self.min_confidence = blend.min_confidence
        self.labels = blend.labels

    @property
    def neutral_bias(self) -> float:
        return self.blend.neutral_bias

    @neutral_bias.setter
    def neutral_bias(self, valor: float) -> None:
        self.blend.neutral_bias = valor

    def blendshapes(self, face_crop: np.ndarray) -> Optional[Dict[str, float]]:
        return self.blend.blendshapes(face_crop)

    def set_reposo(self, muestras: Sequence[Dict[str, float]]) -> bool:
        return self.blend.set_reposo(muestras)

    def predict(self, face_crop: np.ndarray) -> Optional[EmotionResult]:
        """Solo blendshapes (sirve cuando se dispone de un único recorte)."""
        self.blend.min_confidence = self.min_confidence
        return self.blend.predict(face_crop)

    def predict_face(self, frame: np.ndarray, box: Tuple[int, int, int, int]) -> Optional[EmotionResult]:
        """Usa un recorte amplio para blendshapes y uno ajustado para FER+."""
        t0 = time.perf_counter()
        bs = self.blend.blendshapes(FaceDetector.crop_face(frame, box, margin=self.blend.crop_margin))
        res_fer = self.fer.predict(FaceDetector.crop_face(frame, box, margin=0.15))
        p_fer = res_fer.probabilities if res_fer else None

        if bs is None:
            if res_fer is None:
                return None
            return _resultado(res_fer.probabilities, self.min_confidence, (time.perf_counter() - t0) * 1000)

        p_final = combinar_probabilidades(self.blend.probabilidades(bs), p_fer, self.peso_fer, self.labels)
        return _resultado(p_final, self.min_confidence, (time.perf_counter() - t0) * 1000)

    def close(self) -> None:
        self.blend.close()
        self.fer.close()
