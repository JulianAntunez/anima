"""
Módulo de Persistencia en Base de Datos (SQLite)
Guarda sesiones y emociones dominantes muestreadas en el tiempo (no por frame),
con el esquema ya preparado para vincular registros a personas identificadas.
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Dict, List, Optional, Tuple, Union
import sqlite3
import time
import uuid

from config import DEFAULT_CONFIG

if TYPE_CHECKING:
    from core.classifier import EmotionResult


SCHEMA = """
CREATE TABLE IF NOT EXISTS personas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    embedding BLOB,
    consentimiento_ts TEXT,
    creado_ts TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sesiones (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    inicio_ts TEXT NOT NULL,
    fin_ts TEXT
);

CREATE TABLE IF NOT EXISTS registro_emociones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sesion_id TEXT NOT NULL REFERENCES sesiones(id),
    persona_id INTEGER REFERENCES personas(id),
    track_id INTEGER NOT NULL,
    emocion TEXT NOT NULL,
    confianza REAL NOT NULL,
    ts TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_registro_ts ON registro_emociones(ts);
CREATE INDEX IF NOT EXISTS idx_registro_persona ON registro_emociones(persona_id);
"""


class EmotionDBLogger:
    """
    Registrador de emociones en SQLite con muestreo para no saturar la base.

    Por cada rostro rastreado (track_id) inserta un registro solo si cambió la emoción
    o si pasaron `sample_interval_s` segundos desde el último registro de ese rostro.
    """

    def __init__(
        self,
        db_path: Optional[Union[str, Path]] = None,
        source: str = "webcam",
        session_id: Optional[str] = None,
        sample_interval_s: float = 5.0,
    ) -> None:
        self.db_path = Path(db_path or DEFAULT_CONFIG.db_path)
        self.source = str(source).lower()
        self.session_id = session_id or f"sess_{uuid.uuid4().hex[:8]}"
        self.sample_interval_s = max(0.0, float(sample_interval_s))

        self._total_logged: int = 0
        self._is_closed: bool = False
        # track_id -> (emoción, instante monotónico del último registro)
        self._ultimo: Dict[int, Tuple[str, float]] = {}
        self._persona_por_track: Dict[int, Optional[int]] = {}

        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(self.db_path))
        self._conn.execute("PRAGMA foreign_keys = ON")
        self._conn.executescript(SCHEMA)
        self._conn.execute(
            "INSERT INTO sesiones (id, source, inicio_ts) VALUES (?, ?, ?)",
            (self.session_id, self.source, self._ahora()),
        )
        self._conn.commit()

    @staticmethod
    def _ahora() -> str:
        return datetime.now(timezone.utc).isoformat()

    def asignar_persona(self, track_id: int, persona_id: Optional[int]) -> None:
        """Vincula un track con una persona identificada (usado por el módulo de reconocimiento)."""
        self._persona_por_track[int(track_id)] = persona_id

    def log_prediction(
        self,
        track_id: int,
        result: EmotionResult,
        now: Optional[float] = None,
    ) -> bool:
        """
        Registra la emoción de un rostro si corresponde según el muestreo.

        :param now: Reloj monotónico inyectable para tests deterministas.
        :return: True si se insertó un registro, False si se omitió por muestreo o error.
        """
        if self._is_closed or result is None:
            return False

        instante = time.monotonic() if now is None else now
        previo = self._ultimo.get(track_id)
        if previo is not None:
            emocion_prev, t_prev = previo
            if result.emotion == emocion_prev and (instante - t_prev) < self.sample_interval_s:
                return False

        try:
            self._conn.execute(
                "INSERT INTO registro_emociones "
                "(sesion_id, persona_id, track_id, emocion, confianza, ts) VALUES (?, ?, ?, ?, ?, ?)",
                (
                    self.session_id,
                    self._persona_por_track.get(track_id),
                    int(track_id),
                    str(result.emotion),
                    round(float(result.confidence), 4),
                    self._ahora(),
                ),
            )
            self._conn.commit()
        except sqlite3.Error as e:
            print(f"[AVISO] No se pudo escribir en la base de datos: {e}")
            return False

        self._ultimo[track_id] = (result.emotion, instante)
        self._total_logged += 1
        return True

    @property
    def total_logged(self) -> int:
        return self._total_logged

    def close(self) -> None:
        if self._is_closed:
            return
        try:
            self._conn.execute(
                "UPDATE sesiones SET fin_ts = ? WHERE id = ?", (self._ahora(), self.session_id)
            )
            self._conn.commit()
            self._conn.close()
        except sqlite3.Error:
            pass
        self._is_closed = True

    def __enter__(self) -> "EmotionDBLogger":
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        self.close()


def resumen_por_emocion(
    db_path: Optional[Union[str, Path]] = None,
    sesion_id: Optional[str] = None,
) -> List[Tuple[str, int]]:
    """Cuenta de registros por emoción (de una sesión, o de toda la base), de mayor a menor."""
    ruta = Path(db_path or DEFAULT_CONFIG.db_path)
    if not ruta.exists():
        return []
    conn = sqlite3.connect(str(ruta))
    try:
        if sesion_id:
            cur = conn.execute(
                "SELECT emocion, COUNT(*) FROM registro_emociones WHERE sesion_id = ? "
                "GROUP BY emocion ORDER BY 2 DESC",
                (sesion_id,),
            )
        else:
            cur = conn.execute(
                "SELECT emocion, COUNT(*) FROM registro_emociones GROUP BY emocion ORDER BY 2 DESC"
            )
        return [(e, int(n)) for e, n in cur.fetchall()]
    finally:
        conn.close()
