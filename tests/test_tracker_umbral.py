"""Pruebas del umbral configurable del seguimiento y de la reutilización de resultados entre cuadros."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core import FaceDetection, FaceTracker, reutilizar_resultados
from core.classifier import EmotionResult

_ETIQ = ["neutral", "feliz", "sorprendido", "triste", "enojado", "asco", "miedo"]


def _resultado(emocion: str, p: float) -> EmotionResult:
    resto = (1.0 - p) / (len(_ETIQ) - 1)
    probs = {e: (p if e == emocion else resto) for e in _ETIQ}
    return EmotionResult(emotion=emocion, confidence=p, raw_emotion=emocion, probabilities=probs, inference_time_ms=1.0)


def _det(x=100, y=100, w=80, h=80) -> FaceDetection:
    return FaceDetection(box=(x, y, w, h), confidence=0.9)


def test_el_umbral_del_seguimiento_se_puede_cambiar_en_vivo():
    tracker = FaceTracker(window_size=1, threshold=0.45)
    res = _resultado("feliz", 0.40)
    assert tracker.update([_det()], [res])[0][2].emotion == "incierto"
    tracker.threshold = 0.35
    assert tracker.update([_det()], [res])[0][2].emotion == "feliz"


def test_umbral_por_defecto_sale_de_la_configuracion():
    from config import DEFAULT_CONFIG

    assert FaceTracker().threshold == DEFAULT_CONFIG.emotion_confidence_threshold


def test_reutiliza_el_resultado_del_recuadro_que_mas_se_superpone():
    previo = _resultado("feliz", 0.9)
    previos = [((100, 100, 80, 80), previo), ((400, 100, 80, 80), _resultado("triste", 0.8))]
    salida = reutilizar_resultados([_det(105, 102), _det(402, 98)], previos)
    assert salida[0] is previo
    assert salida[1].emotion == "triste"


def test_rostro_nuevo_sin_resultado_previo_devuelve_none():
    previos = [((100, 100, 80, 80), _resultado("feliz", 0.9))]
    assert reutilizar_resultados([_det(500, 300)], previos) == [None]
    assert reutilizar_resultados([_det()], []) == [None]


def test_un_resultado_previo_no_se_asigna_a_dos_rostros():
    previos = [((100, 100, 80, 80), _resultado("feliz", 0.9))]
    salida = reutilizar_resultados([_det(100, 100), _det(102, 101)], previos)
    assert salida[0] is not None and salida[1] is None
