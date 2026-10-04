"""
Pruebas unitarias para el registrador en base de datos SQLite.
"""

import sqlite3
import pytest
from core.classifier import EmotionResult
from utils import EmotionDBLogger, resumen_por_emocion


def _res(emocion="feliz", conf=0.9):
    return EmotionResult(
        emotion=emocion,
        confidence=conf,
        raw_emotion=emocion,
        probabilities={emocion: conf},
        inference_time_ms=10.0,
    )


@pytest.fixture
def db_path(tmp_path):
    return tmp_path / "test.db"


def test_crea_esquema_y_sesion(db_path):
    with EmotionDBLogger(db_path=db_path, session_id="s1"):
        pass
    conn = sqlite3.connect(db_path)
    tablas = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"personas", "sesiones", "registro_emociones"} <= tablas
    fin = conn.execute("SELECT fin_ts FROM sesiones WHERE id='s1'").fetchone()[0]
    assert fin is not None
    conn.close()


def test_muestreo_omite_misma_emocion_dentro_del_intervalo(db_path):
    with EmotionDBLogger(db_path=db_path, sample_interval_s=5.0) as db:
        assert db.log_prediction(1, _res("feliz"), now=0.0) is True
        assert db.log_prediction(1, _res("feliz"), now=1.0) is False
        assert db.log_prediction(1, _res("feliz"), now=5.5) is True
        assert db.total_logged == 2


def test_cambio_de_emocion_registra_de_inmediato(db_path):
    with EmotionDBLogger(db_path=db_path, sample_interval_s=5.0) as db:
        assert db.log_prediction(1, _res("feliz"), now=0.0) is True
        assert db.log_prediction(1, _res("triste"), now=0.5) is True


def test_tracks_distintos_se_muestrean_por_separado(db_path):
    with EmotionDBLogger(db_path=db_path, sample_interval_s=5.0) as db:
        assert db.log_prediction(1, _res("feliz"), now=0.0) is True
        assert db.log_prediction(2, _res("feliz"), now=0.1) is True


def test_resumen_por_emocion(db_path):
    with EmotionDBLogger(db_path=db_path, sample_interval_s=0.0, session_id="s1") as db:
        db.log_prediction(1, _res("feliz"), now=0.0)
        db.log_prediction(1, _res("feliz"), now=1.0)
        db.log_prediction(1, _res("triste"), now=2.0)
    assert resumen_por_emocion(db_path, "s1") == [("feliz", 2), ("triste", 1)]


def test_resumen_con_base_inexistente(tmp_path):
    assert resumen_por_emocion(tmp_path / "no_existe.db") == []


def test_asignar_persona_se_guarda_en_registro(db_path):
    conn = sqlite3.connect(db_path)
    conn.close()
    with EmotionDBLogger(db_path=db_path, sample_interval_s=0.0) as db:
        db._conn.execute(
            "INSERT INTO personas (nombre, creado_ts) VALUES ('Juan', '2026-10-01T00:00:00+00:00')"
        )
        db._conn.commit()
        db.asignar_persona(1, 1)
        db.log_prediction(1, _res("feliz"), now=0.0)
    conn = sqlite3.connect(db_path)
    assert conn.execute("SELECT persona_id FROM registro_emociones").fetchone()[0] == 1
    conn.close()
