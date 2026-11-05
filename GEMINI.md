# Ánima: cómo ejecutar la app

**La aplicación principal es Ánima Web (carpeta `web/`), no el tablero de Streamlit.**

Para ejecutarla en local (solo hace falta Python 3, sin instalar dependencias):

```bash
python ejecutar_web.py
```

Se abre `http://localhost:8765`. Requiere internet (las librerías de MediaPipe, ONNX Runtime y otras se cargan de una CDN).
En la pantalla de ingreso usar **«Entrar como visitante»**: permite probar la cámara y el modo demo sin cuenta ni contraseña.
Los datos del visitante quedan solo en el navegador.

Qué NO ejecutar para ver la app principal:
- `app.py` y `python main.py --web` abren el **tablero de Streamlit** (análisis de fotos y CSV), una interfaz secundaria.
- `python main.py` abre la aplicación de escritorio en OpenCV (requiere entorno virtual, modelos y cámara).

Pruebas automáticas de la web: `cd web && npm test` (Node.js). Pruebas de Python: `pytest`.
