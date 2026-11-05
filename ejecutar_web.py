"""
Ejecuta Ánima Web (la interfaz principal del proyecto) en local.

Sirve la carpeta web/ en http://localhost:8765 y abre el navegador. No necesita instalar nada: solo Python 3.
Detener con Ctrl + C.

    python ejecutar_web.py              # puerto 8765 y abre el navegador
    python ejecutar_web.py --puerto 9000
    python ejecutar_web.py --no-abrir   # no abre el navegador
"""

import argparse
import functools
import http.server
import threading
import webbrowser
from pathlib import Path

WEB = Path(__file__).resolve().parent / "web"


def main() -> None:
    parser = argparse.ArgumentParser(description="Ejecuta Ánima Web en local")
    parser.add_argument("--puerto", type=int, default=8765)
    parser.add_argument("--no-abrir", action="store_true", help="no abrir el navegador")
    args = parser.parse_args()

    if not (WEB / "index.html").exists():
        raise SystemExit(f"No se encontró {WEB / 'index.html'}. Ejecutá este script desde la raíz del proyecto.")

    manejador = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(WEB))
    servidor = None
    for puerto in range(args.puerto, args.puerto + 10):
        try:
            servidor = http.server.ThreadingHTTPServer(("127.0.0.1", puerto), manejador)
            break
        except OSError:
            continue
    if servidor is None:
        raise SystemExit(f"No hay un puerto libre entre {args.puerto} y {args.puerto + 9}.")

    url = f"http://localhost:{servidor.server_address[1]}/"
    print(f"Ánima Web en {url}  (Ctrl + C para detener)")
    print("En la pantalla de ingreso, «Entrar como visitante» permite probarla sin cuenta.")
    if not args.no_abrir:
        threading.Timer(0.8, webbrowser.open, [url]).start()
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        print("Detenido.")
    finally:
        servidor.server_close()


if __name__ == "__main__":
    main()
