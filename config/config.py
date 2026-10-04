"""
Módulo de Configuración Centralizada
Define todos los parámetros del sistema (cámara, umbrales, rutas, periodicidad).
"""

from dataclasses import dataclass, field
from pathlib import Path
from typing import List


@dataclass(frozen=True)
class AppConfig:
    """Configuración inmutable de la aplicación de reconocimiento de emociones."""

    # Dispositivo de captura
    camera_index: int = 1
    # Resolución solicitada: la cámara entrega la mayor que soporte por debajo de este valor
    frame_width: int = 1920
    frame_height: int = 1080

    # Umbrales de confianza (0.0 a 1.0)
    face_detection_confidence: float = 0.5
    emotion_confidence_threshold: float = 0.45  # Menor a este valor se cataloga como 'incierto'

    # Sensibilidad de emociones: FER+ tiende a "neutral". Factor < 1 resta peso a neutral (1.0 = sin ajuste)
    neutral_bias: float = 0.6
    fer_vote_weight: float = 0.5  # Peso de FER+ al sumar su opinión a los blendshapes (0 = ignorarlo)
    smoothing_window: int = 4  # Frames promediados por rostro; menor = más reactivo, mayor = más estable

    # Optimización de rendimiento (inferencia cada N frames)
    classify_every_n_frames: int = 3

    # Rutas de almacenamiento
    project_root: Path = field(default_factory=lambda: Path(__file__).resolve().parent.parent)
    models_dir: Path = field(default_factory=lambda: Path(__file__).resolve().parent.parent / "models")
    logs_dir: Path = field(default_factory=lambda: Path(__file__).resolve().parent.parent / "data" / "logs")
    db_path: Path = field(
        default_factory=lambda: Path(__file__).resolve().parent.parent / "data" / "emociones.db"
    )
    db_sample_interval_s: float = 5.0  # Segundos mínimos entre registros de la misma emoción por rostro
    recognizer_model_path: Path = field(
        default_factory=lambda: Path(__file__).resolve().parent.parent / "models" / "w600k_mbf.onnx"
    )
    recognition_threshold: float = 0.40  # Similitud coseno mínima para identificar a una persona
    recognition_retry_frames: int = 15  # Cada cuántos frames reintentar identificar un rostro desconocido
    registration_samples: int = 30  # Embeddings promediados al registrar a una persona
    registration_frame_step: int = 8  # Un embedding cada N frames con rostro (~6 s en total para alejarse)
    landmarker_model_path: Path = field(
        default_factory=lambda: Path(__file__).resolve().parent.parent / "models" / "face_landmarker.task"
    )
    onnx_model_path: Path = field(
        default_factory=lambda: Path(__file__).resolve().parent.parent / "models" / "emotion_ferplus.onnx"
    )

    # Etiquetas de emociones en español (mapeo estándar FER-2013 / FER+)
    # Orden estándar: 0: neutral, 1: feliz, 2: sorpresa, 3: triste, 4: enojo, 5: asco, 6: miedo
    emotion_labels: List[str] = field(
        default_factory=lambda: [
            "neutral",
            "feliz",
            "sorprendido",
            "triste",
            "enojado",
            "asco",
            "miedo",
        ]
    )

    # Privacidad y seguridad de datos
    save_face_images: bool = False  # Por defecto NUNCA guardar imágenes de rostros


# Instancia por defecto para importar directamente en otros módulos
DEFAULT_CONFIG = AppConfig()
