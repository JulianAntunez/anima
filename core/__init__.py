"""
Módulo del núcleo (core) del sistema de reconocimiento de rostros y emociones.
"""

from .detector import FaceDetector, FaceDetection
from .classifier import EmotionClassifier, EmotionResult
from .expression import BlendshapeEmotionClassifier, EnsembleEmotionClassifier
from .recognizer import FaceRecognizer, Match
from .tracker import FaceTracker, TrackedFace, calcular_iou, reutilizar_resultados

__all__ = [
    "FaceDetector",
    "FaceDetection",
    "EmotionClassifier",
    "BlendshapeEmotionClassifier",
    "EnsembleEmotionClassifier",
    "EmotionResult",
    "FaceRecognizer",
    "Match",
    "FaceTracker",
    "TrackedFace",
    "calcular_iou",
    "reutilizar_resultados",
]
