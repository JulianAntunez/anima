"""
Utilidad para descarga y verificación del modelo ONNX de reconocimiento de emociones (FER+).
"""

import sys
import urllib.request
import zipfile
from pathlib import Path

# Asegurar importación de módulos del proyecto
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from config import DEFAULT_CONFIG

MODEL_URL = "https://github.com/onnx/models/raw/main/validated/vision/body_analysis/emotion_ferplus/model/emotion-ferplus-8.onnx"

# Modelo de reconocimiento facial (ArcFace MobileFaceNet) incluido en el paquete buffalo_s de InsightFace
RECOGNIZER_ZIP_URL = "https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_s.zip"
RECOGNIZER_ZIP_ENTRY = "w600k_mbf.onnx"


# Modelo FaceLandmarker de MediaPipe (puntos faciales + blendshapes de expresión)
LANDMARKER_URL = (
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
)


def descargar_modelo_landmarker(destino: Path = DEFAULT_CONFIG.landmarker_model_path) -> bool:
    """Descarga face_landmarker.task (~4 MB) desde el almacenamiento oficial de MediaPipe."""
    destino = Path(destino)
    destino.parent.mkdir(parents=True, exist_ok=True)

    if destino.exists() and destino.stat().st_size > 1_000_000:
        print(f"[OK] Modelo FaceLandmarker existente en: {destino}")
        return True

    print(f"Descargando modelo FaceLandmarker desde:\n  {LANDMARKER_URL}")
    try:
        req = urllib.request.Request(LANDMARKER_URL, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req) as resp, open(destino, "wb") as f_out:
            f_out.write(resp.read())
        print(f"[OK] Modelo FaceLandmarker listo en: {destino} ({destino.stat().st_size / (1024 * 1024):.1f} MB)")
        return True
    except Exception as e:
        print(f"[ERROR] Falló la descarga del modelo FaceLandmarker: {e}")
        if destino.exists():
            destino.unlink()
        return False


def descargar_modelo(destino: Path = DEFAULT_CONFIG.onnx_model_path) -> bool:
    """Descarga el modelo ONNX si no existe en la ruta de destino."""
    destino = Path(destino)
    destino.parent.mkdir(parents=True, exist_ok=True)

    if destino.exists() and destino.stat().st_size > 30_000_000:
        print(f"[OK] Modelo existente en: {destino} ({destino.stat().st_size / (1024 * 1024):.1f} MB)")
        return True

    print(f"Descargando modelo FER+ ONNX desde:\n  {MODEL_URL}")
    print(f"Destino: {destino} ...")

    try:
        req = urllib.request.Request(MODEL_URL, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req) as resp, open(destino, "wb") as f_out:
            total_bytes = int(resp.headers.get("Content-Length", 0))
            descargados = 0
            bloque = 1024 * 64

            while True:
                chunk = resp.read(bloque)
                if not chunk:
                    break
                f_out.write(chunk)
                descargados += len(chunk)
                if total_bytes > 0:
                    porcentaje = (descargados / total_bytes) * 100
                    print(f"\rProgreso: {porcentaje:.1f}% ({descargados / (1024*1024):.1f}/{total_bytes / (1024*1024):.1f} MB)", end="")

        print(f"\n[OK] Modelo descargado con éxito en: {destino}")
        return True
    except Exception as e:
        print(f"\n[ERROR] Falló la descarga del modelo: {e}")
        if destino.exists():
            destino.unlink()
        return False


def descargar_modelo_reconocimiento(destino: Path = DEFAULT_CONFIG.recognizer_model_path) -> bool:
    """Descarga buffalo_s.zip (~122 MB), extrae solo w600k_mbf.onnx (~13 MB) y borra el zip."""
    destino = Path(destino)
    destino.parent.mkdir(parents=True, exist_ok=True)

    if destino.exists() and destino.stat().st_size > 5_000_000:
        print(f"[OK] Modelo de reconocimiento existente en: {destino}")
        return True

    zip_tmp = destino.parent / "buffalo_s.zip.tmp"
    print(f"Descargando modelo de reconocimiento desde:\n  {RECOGNIZER_ZIP_URL}")
    try:
        req = urllib.request.Request(RECOGNIZER_ZIP_URL, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req) as resp, open(zip_tmp, "wb") as f_out:
            total_bytes = int(resp.headers.get("Content-Length", 0))
            descargados = 0
            while True:
                chunk = resp.read(1024 * 64)
                if not chunk:
                    break
                f_out.write(chunk)
                descargados += len(chunk)
                if total_bytes > 0:
                    print(f"\rProgreso: {descargados / total_bytes * 100:.1f}%", end="")

        with zipfile.ZipFile(zip_tmp) as zf:
            with zf.open(RECOGNIZER_ZIP_ENTRY) as src, open(destino, "wb") as dst:
                dst.write(src.read())

        print(f"\n[OK] Modelo de reconocimiento listo en: {destino}")
        return True
    except Exception as e:
        print(f"\n[ERROR] Falló la descarga del modelo de reconocimiento: {e}")
        if destino.exists():
            destino.unlink()
        return False
    finally:
        if zip_tmp.exists():
            zip_tmp.unlink()


if __name__ == "__main__":
    if "--reconocimiento" in sys.argv:
        exito = descargar_modelo_reconocimiento()
    elif "--landmarker" in sys.argv:
        exito = descargar_modelo_landmarker()
    else:
        exito = descargar_modelo()
    sys.exit(0 if exito else 1)
