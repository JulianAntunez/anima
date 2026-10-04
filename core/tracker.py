"""
Módulo de Seguimiento Facial y Suavizado Temporal (Fase 8)
Provee:
1. FaceTracker: Asignación de ID persistente a rostros entre frames (IoU + distancia de centroides).
2. TemporalSmoother: Suavizado por promedio móvil para eliminar parpadeo (flicker) en las emociones predichas.
"""

from collections import deque
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple
import numpy as np

from config import DEFAULT_CONFIG
from core.classifier import EmotionResult
from core.detector import FaceDetection


def calcular_iou(boxA: Tuple[int, int, int, int], boxB: Tuple[int, int, int, int]) -> float:
    """Calcula Intersection over Union (IoU) entre dos bounding boxes (x, y, w, h)."""
    xA = max(boxA[0], boxB[0])
    yA = max(boxA[1], boxB[1])
    xB = min(boxA[0] + boxA[2], boxB[0] + boxB[2])
    yB = min(boxA[1] + boxA[3], boxB[1] + boxB[3])

    inter_w = max(0, xB - xA)
    inter_h = max(0, yB - yA)
    area_inter = inter_w * inter_h

    if area_inter == 0:
        return 0.0

    areaA = boxA[2] * boxA[3]
    areaB = boxB[2] * boxB[3]
    union = float(areaA + areaB - area_inter)

    return area_inter / union if union > 0 else 0.0


def distancia_centroides(boxA: Tuple[int, int, int, int], boxB: Tuple[int, int, int, int]) -> float:
    """Calcula la distancia euclidiana entre los centros de dos recuadros."""
    cxA = boxA[0] + boxA[2] / 2.0
    cyA = boxA[1] + boxA[3] / 2.0
    cxB = boxB[0] + boxB[2] / 2.0
    cyB = boxB[1] + boxB[3] / 2.0
    return float(np.hypot(cxA - cxB, cyA - cyB))


class TrackedFace:
    """Representa un rostro rastreado a lo largo de múltiples frames continuos."""

    def __init__(
        self,
        track_id: int,
        box: Tuple[int, int, int, int],
        window_size: int = 7,
    ) -> None:
        self.track_id = track_id
        self.box = box
        self.frames_lost = 0
        self.window_size = window_size
        self.history_probs: deque = deque(maxlen=window_size)
        self.last_result: Optional[EmotionResult] = None

    def update(
        self,
        box: Tuple[int, int, int, int],
        raw_result: EmotionResult,
        threshold: Optional[float] = None,
    ) -> EmotionResult:
        """Actualiza la posición del rostro y aplica suavizado temporal a las probabilidades."""
        umbral = DEFAULT_CONFIG.emotion_confidence_threshold if threshold is None else threshold
        self.box = box
        self.frames_lost = 0

        # Guardar distribución de probabilidades en el historial
        self.history_probs.append(raw_result.probabilities)

        # Calcular promedio móvil para cada una de las 7 clases
        labels = list(raw_result.probabilities.keys())
        smoothed_probs: Dict[str, float] = {}

        for label in labels:
            val_media = np.mean([hist[label] for hist in self.history_probs])
            smoothed_probs[label] = float(val_media)

        # Normalizar para que la suma sea exactamente 1.0
        total_p = sum(smoothed_probs.values())
        if total_p > 0:
            for l in labels:
                smoothed_probs[l] /= total_p

        # Encontrar la emoción ganadora suavizada
        winner_label = max(smoothed_probs.items(), key=lambda item: item[1])[0]
        winner_confidence = smoothed_probs[winner_label]

        # Umbral de certeza vigente (el operador puede cambiarlo en vivo con la tecla T)
        assigned_emotion = winner_label if winner_confidence >= umbral else "incierto"

        smoothed_res = EmotionResult(
            emotion=assigned_emotion,
            confidence=winner_confidence,
            raw_emotion=winner_label,
            probabilities=smoothed_probs,
            inference_time_ms=raw_result.inference_time_ms,
        )

        self.last_result = smoothed_res
        return smoothed_res


class FaceTracker:
    """Rastreador multirrostro que asocia detecciones entre frames y estabiliza emociones."""

    def __init__(
        self,
        max_lost: int = 15,
        iou_threshold: float = 0.25,
        max_centroid_dist: float = 120.0,
        window_size: int = 7,
        threshold: Optional[float] = None,
    ) -> None:
        """
        :param threshold: Umbral de certeza para etiquetar una emoción; por debajo es "incierto".
        :param max_lost: Frames consecutivos sin detectar el rostro antes de descartar el ID.
        :param iou_threshold: Umbral mínimo de solapamiento IoU para considerar coincidencia.
        :param max_centroid_dist: Distancia máxima en píxeles permitida si el IoU es bajo.
        :param window_size: Tamaño de la ventana temporal para el suavizado de emociones.
        """
        self.max_lost = max_lost
        self.iou_threshold = iou_threshold
        self.max_centroid_dist = max_centroid_dist
        self.window_size = window_size
        self.threshold = DEFAULT_CONFIG.emotion_confidence_threshold if threshold is None else float(threshold)

        self.next_track_id: int = 1
        self.tracks: Dict[int, TrackedFace] = {}

    def update(
        self,
        detections: List[FaceDetection],
        raw_results: List[EmotionResult],
    ) -> List[Tuple[int, FaceDetection, EmotionResult]]:
        """
        Asocia las nuevas detecciones con los rostros en seguimiento.

        :return: Lista de tuplas (track_id, FaceDetection, EmotionResult_suavizado).
        """
        if not detections:
            # Incrementar contador de pérdida en todos los tracks
            ids_a_eliminar = []
            for tid, t in self.tracks.items():
                t.frames_lost += 1
                if t.frames_lost > self.max_lost:
                    ids_a_eliminar.append(tid)
            for tid in ids_a_eliminar:
                del self.tracks[tid]
            return []

        # Matriz de afinidad (IoU y distancias)
        track_ids = list(self.tracks.keys())
        emparejados: List[Tuple[int, int]] = []  # (track_idx, det_idx)
        usados_tracks = set()
        usados_dets = set()

        if track_ids:
            # Intentar primero asociación por IoU
            puntuaciones = []
            for t_idx, tid in enumerate(track_ids):
                t_box = self.tracks[tid].box
                for d_idx, det in enumerate(detections):
                    score_iou = calcular_iou(t_box, det.box)
                    dist = distancia_centroides(t_box, det.box)
                    puntuaciones.append((score_iou, dist, t_idx, d_idx))

            # Ordenar de mayor IoU a menor
            puntuaciones.sort(key=lambda x: x[0], reverse=True)

            for score_iou, dist, t_idx, d_idx in puntuaciones:
                if t_idx in usados_tracks or d_idx in usados_dets:
                    continue
                if score_iou >= self.iou_threshold or dist <= self.max_centroid_dist:
                    emparejados.append((t_idx, d_idx))
                    usados_tracks.add(t_idx)
                    usados_dets.add(d_idx)

        resultados_finales: List[Tuple[int, FaceDetection, EmotionResult]] = []

        # 1. Actualizar rostros emparejados
        for t_idx, d_idx in emparejados:
            tid = track_ids[t_idx]
            det = detections[d_idx]
            raw_res = raw_results[d_idx]
            tracked_face = self.tracks[tid]
            smoothed_res = tracked_face.update(det.box, raw_res, self.threshold)
            resultados_finales.append((tid, det, smoothed_res))

        # 2. Registrar nuevos rostros (sin emparejar)
        for d_idx, det in enumerate(detections):
            if d_idx not in usados_dets:
                nuevo_tid = self.next_track_id
                self.next_track_id += 1
                nuevo_track = TrackedFace(
                    track_id=nuevo_tid,
                    box=det.box,
                    window_size=self.window_size,
                )
                smoothed_res = nuevo_track.update(det.box, raw_results[d_idx], self.threshold)
                self.tracks[nuevo_tid] = nuevo_track
                resultados_finales.append((nuevo_tid, det, smoothed_res))

        # 3. Incrementar frames perdidos en tracks no detectados y podar los inactivos
        ids_a_eliminar = []
        for t_idx, tid in enumerate(track_ids):
            if t_idx not in usados_tracks:
                self.tracks[tid].frames_lost += 1
                if self.tracks[tid].frames_lost > self.max_lost:
                    ids_a_eliminar.append(tid)

        for tid in ids_a_eliminar:
            del self.tracks[tid]

        return resultados_finales

    def reset(self) -> None:
        """Reinicia el estado del tracker."""
        self.tracks.clear()
        self.next_track_id = 1


def reutilizar_resultados(
    detecciones: List[FaceDetection],
    previos: List[Tuple[Tuple[int, int, int, int], EmotionResult]],
    iou_minimo: float = 0.3,
) -> List[Optional[EmotionResult]]:
    """
    Para cada detección devuelve el resultado crudo del cuadro anterior cuyo recuadro más se le superpone
    (IoU >= iou_minimo), o None si no hay uno reutilizable y hay que clasificar de nuevo.
    Permite clasificar solo cada N cuadros (classify_every_n_frames) sin perder el seguimiento.
    """
    resultado: List[Optional[EmotionResult]] = []
    usados = set()
    for det in detecciones:
        mejor_idx, mejor_iou = None, iou_minimo
        for idx, (box, _) in enumerate(previos):
            if idx in usados:
                continue
            iou = calcular_iou(det.box, box)
            if iou >= mejor_iou:
                mejor_idx, mejor_iou = idx, iou
        if mejor_idx is None:
            resultado.append(None)
        else:
            usados.add(mejor_idx)
            resultado.append(previos[mejor_idx][1])
    return resultado
