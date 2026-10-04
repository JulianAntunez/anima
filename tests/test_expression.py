"""Pruebas de las reglas de emoción por blendshapes (sin cámara ni modelo)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.expression import puntuar_emociones


def _ganadora(bs):
    p = puntuar_emociones(bs)
    return max(p, key=p.get), p


def test_cara_neutra_no_activa_emociones():
    _, p = _ganadora({"browDownLeft": 0.12, "browDownRight": 0.12, "mouthPucker": 0.14, "eyeSquintLeft": 0.45})
    assert max(p.values()) < 0.3


def test_sonrisa_moderada_es_feliz():
    ganadora, p = _ganadora({"mouthSmileLeft": 0.4, "mouthSmileRight": 0.38})
    assert ganadora == "feliz"
    assert p["feliz"] > 0.9


def test_sonrisa_leve_supera_el_umbral_de_neutral():
    # 0.15 de sonrisa debe dar puntaje suficiente para ganarle al prior de neutral (0.3)
    _, p = _ganadora({"mouthSmileLeft": 0.15, "mouthSmileRight": 0.15})
    assert p["feliz"] > 0.3


def test_sorpresa():
    ganadora, _ = _ganadora({"jawOpen": 0.4, "browInnerUp": 0.4, "browOuterUpLeft": 0.3, "eyeWideLeft": 0.4})
    assert ganadora == "sorprendido"


def test_enojo_por_ceno():
    ganadora, _ = _ganadora({"browDownLeft": 0.6, "browDownRight": 0.6, "mouthPressLeft": 0.2})
    assert ganadora == "enojado"


def test_tristeza_gana_a_enojo_con_comisuras_abajo():
    ganadora, _ = _ganadora(
        {"browDownLeft": 0.3, "browDownRight": 0.3, "mouthFrownLeft": 0.4, "mouthFrownRight": 0.4, "browInnerUp": 0.3}
    )
    assert ganadora == "triste"


def test_asco():
    ganadora, _ = _ganadora({"noseSneerLeft": 0.4, "noseSneerRight": 0.4, "mouthUpperUpLeft": 0.4, "mouthUpperUpRight": 0.4})
    assert ganadora == "asco"


def test_sonreir_apaga_emociones_negativas():
    _, p = _ganadora({"mouthSmileLeft": 0.5, "mouthSmileRight": 0.5, "browDownLeft": 0.6, "browDownRight": 0.6})
    assert p["enojado"] < 0.1


from core.expression import combinar_probabilidades, restar_reposo

_LABELS = ["neutral", "feliz", "sorprendido", "triste", "enojado", "asco", "miedo"]


def test_ceno_solo_no_alcanza_para_enojo():
    # Cejas moderadamente bajas (cara seria) sin otra señal no deben ser enojo
    _, p = _ganadora({"browDownLeft": 0.33, "browDownRight": 0.33})
    assert p["enojado"] < 0.2


def test_enojo_con_ojos_tensos_y_labios_apretados():
    ganadora, _ = _ganadora(
        {"browDownLeft": 0.5, "browDownRight": 0.5, "eyeSquintLeft": 0.6, "eyeSquintRight": 0.6,
         "mouthPressLeft": 0.25, "mouthPressRight": 0.25}
    )
    assert ganadora == "enojado"


def test_calibracion_personal_neutraliza_el_reposo():
    reposo = {"browDownLeft": 0.3, "browDownRight": 0.3, "eyeSquintLeft": 0.5, "eyeSquintRight": 0.5}
    p_sin = puntuar_emociones(reposo)
    p_con = puntuar_emociones(reposo, reposo)
    assert p_sin["enojado"] > 0.1
    assert max(p_con.values()) < 0.05


def test_restar_reposo_no_da_negativos():
    d = restar_reposo({"jawOpen": 0.1}, {"jawOpen": 0.4})
    assert d["jawOpen"] == 0.0


def test_voto_fer_refuerza_emocion_coincidente_sin_tocar_neutral():
    p_blend = {"neutral": 0.5, "feliz": 0.3, "sorprendido": 0.05, "triste": 0.05, "enojado": 0.05, "asco": 0.03, "miedo": 0.02}
    p_fer = {"neutral": 0.6, "feliz": 0.3, "sorprendido": 0.02, "triste": 0.02, "enojado": 0.02, "asco": 0.02, "miedo": 0.02}
    mezcla = combinar_probabilidades(p_blend, p_fer, 0.5, _LABELS)
    assert abs(sum(mezcla.values()) - 1.0) < 1e-9
    assert mezcla["feliz"] > p_blend["feliz"]
    assert mezcla["neutral"] < p_blend["neutral"]


def test_sin_fer_devuelve_blendshapes_intacto():
    p_blend = {l: 1 / 7 for l in _LABELS}
    assert combinar_probabilidades(p_blend, None, 0.5, _LABELS) == p_blend
