"""
Pruebas unitarias del reconocimiento de identidad y del repositorio de personas.
No requieren el modelo ArcFace: se usan embeddings sintéticos.
"""

import sqlite3
import numpy as np
import pytest

from core import FaceDetection, FaceRecognizer
from utils import EmotionDBLogger, PersonasRepository
from core.classifier import EmotionResult


@pytest.fixture
def reconocedor():
    """FaceRecognizer sin sesión ONNX, para probar solo la lógica de comparación."""
    r = FaceRecognizer.__new__(FaceRecognizer)
    r.threshold = 0.40
    return r


def _vec(seed, dim=512):
    return FaceRecognizer.normalizar(np.random.default_rng(seed).normal(size=dim))


def test_modelo_inexistente_lanza_error_claro(tmp_path):
    with pytest.raises(FileNotFoundError, match="download_model"):
        FaceRecognizer(model_path=tmp_path / "no_existe.onnx")


def test_normalizar_devuelve_norma_unitaria():
    v = FaceRecognizer.normalizar(np.array([3.0, 4.0]))
    assert pytest.approx(np.linalg.norm(v)) == 1.0


def test_promediar_normaliza_y_exige_muestras():
    prom = FaceRecognizer.promediar([_vec(1), _vec(1)])
    assert pytest.approx(np.linalg.norm(prom)) == 1.0
    with pytest.raises(ValueError):
        FaceRecognizer.promediar([])


def test_buscar_encuentra_a_la_persona_correcta(reconocedor):
    galeria = [(1, "Ana", _vec(1)), (2, "Luis", _vec(2))]
    ruido = _vec(2) + 0.05 * _vec(99)
    match = reconocedor.buscar(ruido, galeria)
    assert match is not None
    assert (match.persona_id, match.nombre) == (2, "Luis")
    assert match.similitud > 0.9


def test_buscar_devuelve_none_si_no_supera_umbral(reconocedor):
    galeria = [(1, "Ana", _vec(1))]
    assert reconocedor.buscar(_vec(500), galeria) is None


def test_buscar_con_galeria_vacia(reconocedor):
    assert reconocedor.buscar(_vec(1), []) is None


def test_alinear_con_landmarks_da_112x112():
    frame = np.random.default_rng(0).integers(0, 255, (480, 640, 3), dtype=np.uint8)
    det = FaceDetection(
        box=(200, 120, 200, 240),
        confidence=0.9,
        landmarks={
            "ojo_derecho": (260, 190),
            "ojo_izquierdo": (340, 190),
            "punta_nariz": (300, 235),
            "centro_boca": (300, 290),
        },
    )
    cara = FaceRecognizer.alinear(frame, det)
    assert cara is not None and cara.shape == (112, 112, 3)


def test_alinear_sin_landmarks_usa_recorte_del_recuadro():
    frame = np.random.default_rng(0).integers(0, 255, (480, 640, 3), dtype=np.uint8)
    det = FaceDetection(box=(200, 120, 200, 240), confidence=0.9, landmarks={})
    cara = FaceRecognizer.alinear(frame, det)
    assert cara is not None and cara.shape == (112, 112, 3)


# ---------------------------------------------------------------- repositorio de personas


@pytest.fixture
def repo(tmp_path):
    with PersonasRepository(tmp_path / "p.db") as r:
        yield r


def test_registrar_exige_consentimiento(repo):
    with pytest.raises(PermissionError):
        repo.registrar("Ana", _vec(1), consentimiento=False)
    assert repo.listar() == []


def test_registrar_valida_nombre_y_dimension(repo):
    with pytest.raises(ValueError):
        repo.registrar("   ", _vec(1), consentimiento=True)
    with pytest.raises(ValueError):
        repo.registrar("Ana", np.zeros(10), consentimiento=True)


def test_registrar_y_recuperar_embedding_sin_perdida(repo):
    original = _vec(7)
    pid = repo.registrar("Ana", original, consentimiento=True)
    persona = repo.listar()[0]
    assert persona.id == pid and persona.nombre == "Ana"
    assert persona.consentimiento_ts is not None
    assert np.allclose(persona.embedding, original)
    assert repo.galeria()[0][0] == pid


def test_eliminar_borra_vector_y_desvincula_historial(tmp_path):
    db = tmp_path / "p.db"
    with PersonasRepository(db) as repo:
        pid = repo.registrar("Ana", _vec(1), consentimiento=True)

    res = EmotionResult(
        emotion="feliz", confidence=0.9, raw_emotion="feliz",
        probabilities={"feliz": 0.9}, inference_time_ms=1.0,
    )
    with EmotionDBLogger(db_path=db, sample_interval_s=0.0) as log:
        log.asignar_persona(1, pid)
        log.log_prediction(1, res, now=0.0)

    with PersonasRepository(db) as repo:
        assert repo.eliminar(pid) is True
        assert repo.listar() == []
        assert repo.eliminar(pid) is False

    conn = sqlite3.connect(db)
    assert conn.execute("SELECT persona_id FROM registro_emociones").fetchone()[0] is None
    conn.close()
