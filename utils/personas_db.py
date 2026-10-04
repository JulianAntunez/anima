"""
Repositorio de personas registradas (SQLite).
Guarda únicamente el nombre y el embedding facial (vector numérico), con constancia de
consentimiento. Permite eliminar a una persona y desvincular su historial.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional, Tuple, Union
import sqlite3

import numpy as np

from config import DEFAULT_CONFIG
from utils.db_logger import SCHEMA

EMBEDDING_DIM = 512


@dataclass
class Persona:
    id: int
    nombre: str
    embedding: np.ndarray
    consentimiento_ts: Optional[str]


class PersonasRepository:
    """Alta, consulta y baja de personas con sus embeddings faciales."""

    def __init__(self, db_path: Optional[Union[str, Path]] = None) -> None:
        self.db_path = Path(db_path or DEFAULT_CONFIG.db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(self.db_path))
        self._conn.execute("PRAGMA foreign_keys = ON")
        self._conn.executescript(SCHEMA)
        self._conn.commit()

    @staticmethod
    def _ahora() -> str:
        return datetime.now(timezone.utc).isoformat()

    def registrar(self, nombre: str, embedding: np.ndarray, consentimiento: bool) -> int:
        """
        Da de alta a una persona. Exige consentimiento explícito.

        :return: id de la persona creada.
        """
        if not consentimiento:
            raise PermissionError("No se puede registrar a una persona sin su consentimiento.")
        nombre = (nombre or "").strip()
        if not nombre:
            raise ValueError("El nombre no puede estar vacío.")
        vector = np.asarray(embedding, dtype=np.float32).ravel()
        if vector.size != EMBEDDING_DIM:
            raise ValueError(f"El embedding debe tener {EMBEDDING_DIM} dimensiones, tiene {vector.size}.")

        ahora = self._ahora()
        cur = self._conn.execute(
            "INSERT INTO personas (nombre, embedding, consentimiento_ts, creado_ts) VALUES (?, ?, ?, ?)",
            (nombre, vector.tobytes(), ahora, ahora),
        )
        self._conn.commit()
        return int(cur.lastrowid)

    def actualizar_embedding(self, persona_id: int, embedding: np.ndarray, consentimiento: bool) -> bool:
        """Reemplaza el vector facial de una persona ya registrada y renueva su consentimiento."""
        if not consentimiento:
            raise PermissionError("No se puede actualizar a una persona sin su consentimiento.")
        vector = np.asarray(embedding, dtype=np.float32).ravel()
        if vector.size != EMBEDDING_DIM:
            raise ValueError(f"El embedding debe tener {EMBEDDING_DIM} dimensiones, tiene {vector.size}.")
        cur = self._conn.execute(
            "UPDATE personas SET embedding = ?, consentimiento_ts = ? WHERE id = ?",
            (vector.tobytes(), self._ahora(), persona_id),
        )
        self._conn.commit()
        return cur.rowcount > 0

    def listar(self) -> List[Persona]:
        filas = self._conn.execute(
            "SELECT id, nombre, embedding, consentimiento_ts FROM personas WHERE embedding IS NOT NULL ORDER BY id"
        ).fetchall()
        return [
            Persona(
                id=int(pid),
                nombre=nombre,
                embedding=np.frombuffer(blob, dtype=np.float32).copy(),
                consentimiento_ts=consent,
            )
            for pid, nombre, blob, consent in filas
        ]

    def galeria(self) -> List[Tuple[int, str, np.ndarray]]:
        """Formato esperado por FaceRecognizer.buscar: (id, nombre, embedding)."""
        return [(p.id, p.nombre, p.embedding) for p in self.listar()]

    def eliminar(self, persona_id: int) -> bool:
        """
        Borra a la persona y su embedding. Su historial de emociones se conserva
        pero queda desvinculado (persona_id = NULL).
        """
        self._conn.execute(
            "UPDATE registro_emociones SET persona_id = NULL WHERE persona_id = ?", (persona_id,)
        )
        cur = self._conn.execute("DELETE FROM personas WHERE id = ?", (persona_id,))
        self._conn.commit()
        return cur.rowcount > 0

    def close(self) -> None:
        try:
            self._conn.close()
        except sqlite3.Error:
            pass

    def __enter__(self) -> "PersonasRepository":
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        self.close()
