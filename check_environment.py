"""
Script de Diagnóstico de Entorno y Hardware
Verifica:
1. Versión de Python y arquitectura del sistema.
2. Disponibilidad de las librerías necesarias.
3. Permisos de escritura en el directorio de logs.
4. Conectividad y lectura de la cámara web (usando DirectShow en Windows).
"""

import sys
import platform
from pathlib import Path

# Configurar stdout en UTF-8 si la consola de Windows lo soporta
if sys.platform == "win32" and hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

# Símbolos compatibles con cualquier consola (incluso cp1252)
ICON_OK = "[OK]"
ICON_FAIL = "[FALLO]"
ICON_WARN = "[AVISO]"

# Colores ANSI básicos
VERDE = "\033[92m"
AMARILLO = "\033[93m"
ROJO = "\033[91m"
RESET = "\033[0m"
BOLD = "\033[1m"


def print_status(componente: str, exito: bool, detalle: str = "") -> None:
    tag = f"{VERDE}{ICON_OK}{RESET}" if exito else f"{ROJO}{ICON_FAIL}{RESET}"
    print(f" {tag} {BOLD}{componente}:{RESET} {detalle}")


def print_warning(componente: str, detalle: str = "") -> None:
    print(f" {AMARILLO}{ICON_WARN}{RESET} {BOLD}{componente}:{RESET} {detalle}")


def verificar_sistema() -> bool:
    print(f"\n{BOLD}--- 1. Verificación del Sistema y Python ---{RESET}")
    os_info = f"{platform.system()} {platform.release()} ({platform.machine()})"
    py_version = sys.version.split()[0]
    print(f" Sistema Operativo: {os_info}")
    print(f" Versión de Python: {py_version}")

    if sys.version_info < (3, 10):
        print_status("Versión de Python", False, "Se requiere Python >= 3.10 (recomendado 3.11/3.12).")
        return False
    elif sys.version_info >= (3, 13):
        print_warning("Versión de Python", f"Python {py_version} es muy reciente; algunas ruedas C++ podrían requerir compilación.")
        return True
    else:
        print_status("Versión de Python", True, f"Python {py_version} es totalmente compatible.")
        return True


def verificar_librerias() -> bool:
    print(f"\n{BOLD}--- 2. Verificación de Librerías ---{RESET}")
    librerias = [
        ("cv2", "OpenCV", "opencv-python"),
        ("mediapipe", "MediaPipe", "mediapipe"),
        ("onnxruntime", "ONNX Runtime", "onnxruntime"),
        ("numpy", "NumPy", "numpy"),
        ("pandas", "Pandas", "pandas"),
        ("PIL", "Pillow", "Pillow"),
    ]

    todas_ok = True
    for modulo, nombre, paquete in librerias:
        try:
            mod = __import__(modulo)
            version = getattr(mod, "__version__", "instalado")
            print_status(nombre, True, f"v{version}")
        except ImportError:
            todas_ok = False
            print_status(nombre, False, f"No encontrado. Instalar con: pip install {paquete}")

    return todas_ok


def verificar_permisos_archivos() -> bool:
    print(f"\n{BOLD}--- 3. Verificación de Permisos de Registro ---{RESET}")
    logs_dir = Path(__file__).resolve().parent / "data" / "logs"
    try:
        logs_dir.mkdir(parents=True, exist_ok=True)
        test_file = logs_dir / ".permisos_test.tmp"
        test_file.write_text("test_escritura", encoding="utf-8")
        test_file.unlink()  # Eliminar archivo temporal
        print_status("Permisos en data/logs", True, f"Ruta accesible: {logs_dir}")
        return True
    except (PermissionError, OSError) as e:
        print_status("Permisos en data/logs", False, f"Sin permisos de escritura en {logs_dir}. Detalle: {e}")
        return False


def verificar_camara(indice_camara: int = 0) -> bool:
    print(f"\n{BOLD}--- 4. Diagnóstico de Cámara Web (Índice {indice_camara}) ---{RESET}")
    try:
        import cv2
    except ImportError:
        print_status("Cámara Web", False, "No se puede probar la cámara porque OpenCV no está instalado.")
        return False

    # En Windows, cv2.CAP_DSHOW (DirectShow) inicia mucho más rápido y evita cuelgues
    backend = cv2.CAP_DSHOW if platform.system() == "Windows" else cv2.CAP_ANY

    try:
        cap = cv2.VideoCapture(indice_camara, backend)
    except Exception as e:
        print_status("Cámara Web", False, f"Error al inicializar la captura: {e}")
        return False

    if not cap.isOpened():
        print_status(
            "Cámara Web",
            False,
            f"No se pudo abrir la cámara en el índice {indice_camara}.\n"
            f"   Posibles causas:\n"
            f"   a) La cámara está en uso por otra app (Teams, Zoom, Discord, Navegador).\n"
            f"   b) Permisos de Windows: Configuración -> Privacidad y seguridad -> Cámara (verificar que esté activa).\n"
            f"   c) Si tienes cámara externa USB, prueba cambiando el índice a 1 en config/config.py."
        )
        return False

    # Intentar capturar 1 frame de prueba
    ret, frame = cap.read()
    cap.release()

    if not ret or frame is None:
        print_warning(
            "Cámara Web",
            "La cámara abrió correctamente pero no devolvió ningún frame (retorno vacío).\n"
            "   Verifica si la tapa/obturador físico de la webcam está cerrado o si el controlador está ocupado."
        )
        return False

    alto, ancho, canales = frame.shape
    print_status("Cámara Web", True, f"Captura exitosa - Resolución detectada: {ancho}x{alto} ({canales} canales)")
    return True


def main() -> None:
    print(f"{BOLD}===================================================={RESET}")
    print(f"{BOLD}   DIAGNÓSTICO DEL ENTORNO - ÁNIMA                  {RESET}")
    print(f"{BOLD}===================================================={RESET}")

    sys_ok = verificar_sistema()
    libs_ok = verificar_librerias()
    perms_ok = verificar_permisos_archivos()
    cam_ok = verificar_camara(0)

    print(f"\n{BOLD}===================================================={RESET}")
    print(f"{BOLD}   RESUMEN FINAL                                    {RESET}")
    print(f"{BOLD}===================================================={RESET}")

    if sys_ok and libs_ok and perms_ok and cam_ok:
        print(f"{VERDE}{BOLD}[OK] ¡Todo listo! El entorno y hardware cumplen al 100% los requisitos.{RESET}\n")
    else:
        print(f"{AMARILLO}{BOLD}[AVISO] Se detectaron advertencias o faltantes. Revisa los mensajes arriba para corregirlos.{RESET}\n")


if __name__ == "__main__":
    main()
