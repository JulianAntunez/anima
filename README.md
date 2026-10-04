# Ánima — Hospitalidad que se anticipa 🎭

Sistema de detección de rostros, clasificación de expresiones y reconocimiento opcional de huéspedes en tiempo real, con una web (carpeta `web/`) conectada a Supabase.

Aplicación modular de visión por computadora y aprendizaje profundo optimizada para ejecutarse en tiempo real sobre **CPU estándar** en Windows 11. Integra **MediaPipe BlazeFace** para detección facial ultrarrápida, una red neuronal profunda **FER+ en ONNX Runtime** para clasificar 7 emociones humanas, telemetría continua en **CSV (ISO 8601)**, seguimiento multirrostro con suavizado temporal, una interfaz gráfica de escritorio en **OpenCV** y un dashboard interactivo en **Streamlit**.

---

## 📋 Tabla de Contenidos
1. [Características Principales](#-características-principales)
2. [Justificación de Decisiones Técnicas](#-justificación-de-decisiones-técnicas)
3. [Estructura del Proyecto](#-estructura-del-proyecto)
4. [Benchmarks y Métricas en CPU](#-benchmarks-y-métricas-en-cpu)
5. [Instalación y Configuración](#-instalación-y-configuración)
6. [Guía de Uso](#-guía-de-uso)
   - [Aplicación de Escritorio (OpenCV)](#1-aplicación-de-escritorio-opencv)
   - [Dashboard Web Interactivo (Streamlit)](#2-dashboard-web-interactivo-streamlit)
   - [Suite de Pruebas Unitarias](#3-suite-de-pruebas-unitarias-pytest)
7. [Manejo de Errores y Robustez](#-manejo-de-errores-y-robustez)
8. [Privacidad, Ética y Limitaciones](#-privacidad-ética-y-limitaciones)

---

## 🌟 Características Principales

- **Detección Facial Ultrarrápida**: Localización precisa de múltiples rostros a ~4.7 ms por frame usando MediaPipe BlazeFace.
- **7 Categorías Emocionales Estándar**:
  - `Feliz` (*Happy*)
  - `Triste` (*Sad*)
  - `Enojado` (*Angry*)
  - `Sorprendido` (*Surprise*)
  - `Miedo` (*Fear*)
  - `Asco` (*Disgust*)
  - `Neutral`
- **Manejo de Incertidumbre**: Umbral de confianza configurable (por defecto 45%). Si la emoción más probable no supera dicho umbral, el sistema la etiqueta responsablemente como `incierto` en lugar de conjeturar.
- **Suavizado Temporal (*Temporal Smoothing*)**: Promedio móvil ponderado sobre la distribución de probabilidades de los últimos frames para erradicar el parpadeo (*flicker*) entre emociones en vivo.
- **Seguimiento Multirrostro (*Face Tracking*)**: Asignación de ID persistente a cada rostro mediante solapamiento espacial (IoU) y distancia euclidiana de centroides.
- **Registro y Telemetría en CSV**: Guardado automático de marcas temporales ISO 8601 (con zona horaria UTC), ID de sesión, ID de rostro, emoción asignada, confianza y el vector completo de las 7 probabilidades.
- **Privacidad por Diseño (*Privacy by Design*)**: No se almacenan imágenes en disco por defecto. Las capturas son estrictamente voluntarias y bajo demanda del operador.
- **Doble Interfaz de Usuario**:
  - Interfaz nativa OpenCV a 50+ FPS con HUD dinámico y atajos de teclado.
  - Dashboard web moderno en Streamlit para análisis de imágenes y minería visual de los CSVs históricos.

---

## 🧠 Justificación de Decisiones Técnicas

### 1. Detección Facial: MediaPipe BlazeFace vs. OpenCV (Haar / DNN SSD)
- **OpenCV Haar Cascades**: Aunque son livianos, sufren altas tasas de falsos positivos, son extremadamente sensibles a la rotación de la cabeza (> 20°) y a variaciones de iluminación.
- **OpenCV DNN (ResNet-10 / SSD)**: Ofrece buena precisión pero su latencia en CPU supera los 15-25 ms por frame, consumiendo excesivos ciclos de reloj.
- **MediaPipe BlazeFace (Elegido)**: Diseñado por Google específicamente para aceleración móvil y CPU. Procesa cada cuadro en **~4.7 ms**, maneja ángulos pronunciados, no se ve afectado por cambios de escala moderados y provee puntos clave (*landmarks*) para alineación facial.

### 2. Motor de Clasificación: ONNX Runtime vs. Frameworks Pesados
- **DeepFace / FER / TensorFlow completo**: Suelen arrastrar dependencias pesadas (> 1.5 GB en disco), presentan conflictos de compatibilidad entre versiones de Keras/TF y su latencia de inferencia en CPU ronda los 40-90 ms por rostro.
- **ONNX Runtime (Elegido)**: Es un runtime nativo en C++ optimizado por Microsoft para arquitecturas x86_64 con extensiones AVX2/AVX-512.
- **Modelo FER+ ONNX (33.4 MB)**: Arquitectura convolucional profunda entrenada sobre el dataset etiquetado FERPlus. Ofrece inferencias limpias en **~13.3 ms** en CPU, logrando una tasa combinada superior a los **50 FPS reales**.

---

## 📂 Estructura del Proyecto

```text
Anima/
│
├── web/                        # Ánima Web: panel de recepción (HTML/JS + Supabase)
├── config/
│   ├── __init__.py
│   └── config.py               # Configuración centralizada e inmutable (dataclass)
│
├── core/
│   ├── __init__.py
│   ├── detector.py             # Detección facial con MediaPipe BlazeFace
│   ├── classifier.py           # Clasificación de emociones con ONNX FER+
│   └── tracker.py              # Tracking de rostros (IoU) y suavizado temporal
│
├── interfaces/
│   ├── __init__.py
│   ├── opencv_app.py           # Aplicación gráfica de escritorio (OpenCV)
│   └── streamlit_app.py        # Dashboard web interactivo (Streamlit)
│
├── utils/
│   ├── __init__.py
│   ├── download_model.py       # Descargador automático y validador del modelo ONNX
│   └── csv_logger.py           # Logger tabular con buffer en memoria (ISO 8601)
│
├── data/
│   ├── logs/                   # Registros CSV diarios (emociones_YYYYMMDD.csv)
│   └── capturas/               # Fotos tomadas manualmente bajo demanda del usuario
│
├── models/
│   ├── .gitkeep
│   └── emotion_ferplus.onnx    # Modelo binario ONNX (ignorado por git)
│
├── tests/
│   ├── test_core.py            # Tests de detección y recortes de rostros
│   ├── test_classifier.py      # Tests del clasificador ONNX y umbrales
│   ├── test_logger.py          # Tests de persistencia CSV y tolerancia a fallos
│   ├── test_interface.py       # Tests de la GUI de OpenCV
│   └── test_tracker.py         # Tests de tracking multirrostro y suavizado
│
├── main.py                     # Punto de entrada principal unificado
├── check_environment.py        # Diagnóstico de hardware, cámara y librerías
├── pytest.ini                  # Configuración de pruebas unitarias
└── requirements.txt            # Dependencias del proyecto
```

---

## ⚡ Benchmarks y Métricas en CPU

Pruebas reales medidas en **Windows 11 (AMD64 / CPU común)** procesando más de **2.000 frames continuos**:

| Componente | Latencia Inferencia | Rendimiento Individual |
| :--- | :--- | :--- |
| **MediaPipe BlazeFace** (Detección) | **~4.69 ms** | ~213 FPS teóricos |
| **ONNX Runtime FER+** (Clasificación) | **~13.39 ms** | ~75 FPS teóricos |
| **I/O Disco CSV** (Buffer en memoria) | **< 0.15 ms** | Despreciable |
| **Pipeline Completo Integrado** | **~18.25 ms** | **~50.3 - 54.8 FPS Reales** |

---

## 🛠️ Instalación y Configuración

### 1. Clonar el repositorio
```bash
git clone https://github.com/JulianAntunez/Reconocimiento_De_Rostros.git
cd Reconocimiento_De_Rostros   # nombre actual del repositorio en GitHub
```

### 2. Crear y activar el entorno virtual
En Windows (PowerShell):
```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
```

### 3. Instalar dependencias
```powershell
pip install -r requirements.txt
```

### 4. Verificar hardware y cámara
Ejecuta el script de diagnóstico para validar que OpenCV, la cámara DirectShow y las librerías funcionen al 100%:
```powershell
.\venv\Scripts\python.exe check_environment.py
```

---

## 🚀 Guía de Uso

### 1. Aplicación de Escritorio (OpenCV)
Ejecuta el punto de entrada principal para transmisión fluida desde tu webcam a 50+ FPS:
```powershell
.\venv\Scripts\python.exe main.py
```

#### Atajos de Teclado en la Ventana de Video:
| Tecla | Acción |
| :---: | :--- |
| <kbd>H</kbd> | **HUD de Probabilidades**: Muestra u oculta el gráfico de barras en tiempo real. |
| <kbd>C</kbd> | **Captura Manual**: Toma una foto del frame anotado y la guarda en `data/capturas/`. |
| <kbd>T</kbd> | **Ajustar Umbral**: Alterna cíclicamente el umbral de certeza (`35%` / `45%` / `60%`). |
| <kbd>M</kbd> | **Suavizado Temporal**: Activa o desactiva el filtro contra parpadeos (*flicker*). |
| <kbd>S</kbd> | **Telemetría**: Muestra u oculta la información superior de FPS y latencias. |
| <kbd>Q</kbd> o <kbd>ESC</kbd> | **Salir**: Cierra la ventana y emite en consola el resumen de la sesión. |

#### Opciones por Línea de Comandos:
```powershell
# Usar una cámara USB externa (índice 1)
.\venv\Scripts\python.exe main.py --cam 1

# Probar sobre una fotografía estática
.\venv\Scripts\python.exe main.py --image "captura_prueba.jpg"

# Definir un umbral de certeza personalizado
.\venv\Scripts\python.exe main.py --threshold 0.55

# Desactivar el registro en CSV
.\venv\Scripts\python.exe main.py --no-log
```

---

### 2. Base de Datos y Reconocimiento de Personas
Cada sesión guarda las emociones en SQLite (`data/emociones.db`) con muestreo: un registro por rostro cuando cambia la emoción o cada 5 s, no por frame. Tablas: `sesiones`, `registro_emociones` y `personas`.

Opcionalmente el sistema puede reconocer a las personas registradas y mostrar su nombre en pantalla. Usa un modelo ArcFace (ONNX) que convierte el rostro en un vector de 512 números; **solo se guarda ese vector y el nombre, nunca fotos**.

```powershell
# Descargar el modelo de reconocimiento una sola vez (~122 MB de descarga, queda un archivo de ~13 MB)
.\venv\Scripts\python.exe -m utils.download_model --reconocimiento

# Registrar a alguien: durante la ejecución presionar R, escribir el nombre, confirmar consentimiento (S) y mirar a la cámara
.\venv\Scripts\python.exe main.py

# Listar / eliminar personas (la baja borra el vector y desvincula su historial)
.\venv\Scripts\python.exe main.py --listar-personas
.\venv\Scripts\python.exe main.py --eliminar-persona 1
```
Flags útiles: `--no-db` (sin base de datos) y `--no-reconocer` (sin identificación).

> Un embedding facial es un **dato biométrico sensible** (Ley 25.326): requiere consentimiento explícito. El registro exige confirmarlo y se guarda su fecha.

---

### 3. Dashboard Web Interactivo (Streamlit)
Para abrir la interfaz web con análisis de imágenes y gráficos de auditoría histórica:
```powershell
.\venv\Scripts\python.exe main.py --web
```
O directamente:
```powershell
.\venv\Scripts\streamlit.exe run interfaces/streamlit_app.py
```
El dashboard se abrirá automáticamente en tu navegador (`http://localhost:8501`).

---

### 4. Suite de Pruebas Unitarias (pytest)
Para ejecutar la suite completa de 23 pruebas:
```powershell
.\venv\Scripts\pytest
```

---

## 🛡️ Manejo de Errores y Robustez

El software contempla de forma resiliente los principales fallos de ejecución:
1. **Cámara ocupada o no disponible**: En Windows 11 se fuerza el codec por hardware `MJPG` bajo `cv2.CAP_DSHOW` con reintentos automáticos y mensajes explicativos sin cierre abrupto.
2. **Archivos CSV bloqueados (ej. abiertos en Microsoft Excel)**: El `EmotionCSVLogger` captura `PermissionError` y retiene los registros en un buffer en memoria RAM para reintentar el volcado sin trabar la reproducción de video.
3. **Imágenes corruptas o sin rostros**: Validación de dimensiones mínimas y canales antes de entrar a la red neuronal.
4. **Ausencia del modelo ONNX**: `download_model.py` detecta si el archivo binario falta y lo descarga automáticamente desde el repositorio oficial con barra de progreso.

---

## ⚖️ Privacidad, Ética y Limitaciones

### 1. Expresión Facial ≠ Estado Emocional Interno
- Este software detecta **movimientos y configuraciones musculares externas de la cara**, no sentimientos internos ni intenciones psicológicas.
- Una sonrisa puede deberse a amabilidad, ironía o incomodidad social; un rostro serio o neutro no implica tristeza ni desinterés. Es éticamente inapropiado tomar decisiones críticas sobre personas basándose únicamente en inferencias faciales automatizadas.

### 2. Privacidad por Diseño y Protección de Datos
- **Sin almacenamiento por defecto**: Ninguna imagen ni secuencia de video es guardada en disco a menos que el usuario presione deliberadamente la tecla <kbd>C</kbd>.
- **Ley Argentina 25.326 (Protección de los Datos Personales)**: Las imágenes de rostros y datos biométricos constituyen datos sensibles cuya recolección y tratamiento exigen consentimiento informado y fines legítimos.
- **Reglamento de Inteligencia Artificial de la UE (AI Act)**: Prohíbe de manera expresa la utilización de sistemas de reconocimiento de emociones en **entornos de trabajo y establecimientos educativos**, restringiéndolos a propósitos médicos o de investigación bajo estricto control.

### 3. Precisión Realista y Limitaciones del Modelo
- En el dataset de referencia **FER-2013 / FER+**, los modelos de clasificación para CPU alcanzan entre un **70% y 75%** de exactitud.
- Las clases `asco` y `miedo` son históricamente las más desafiantes debido al desbalance de muestras y similitud con `enojo` o `sorpresa`.
- Factores ambientales como iluminación deficiente, sombras duras, oclusiones (anteojos, barbijos, pelo) o ángulos mayores a 45° degradan la confianza del modelo. Por tal motivo, se introdujo el estado **`incierto`** como salvaguarda algorítmica.
