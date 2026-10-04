# ÁNIMA — DOCUMENTACIÓN TÉCNICA Y ACADÉMICA DEL PROYECTO

## Sistema de Visión Artificial para Detección Facial, Clasificación de Expresiones Emocionales y Telemetría en Tiempo Real

---

### Ficha Técnica del Proyecto

- **Nombre**: Ánima — *Hospitalidad que se anticipa*
- **Autor / Desarrollador**: Julián Antúnez
- **Entorno Operativo**: Windows 11 (Arquitectura AMD64)
- **Lenguaje y Versión**: Python 3.12.10 (Entorno virtual `venv`)
- **Procesamiento / Inferencia**: 100% CPU estándar (sin dependencia obligatoria de GPU dedicada)
- **Rendimiento Medido en Producción**: **~50 - 55 FPS reales** (~18.5 ms por cuadro integrado)
- **Repositorio**: [https://github.com/JulianAntunez/Reconocimiento_De_Rostros.git](https://github.com/JulianAntunez/Reconocimiento_De_Rostros.git)
- **Fecha de Validación y Entrega**: Septiembre 2026

---

## 1. Resumen Ejecutivo y Objetivos

El presente proyecto consiste en una solución completa de visión artificial por computadora y aprendizaje profundo (*Deep Learning*) diseñada para la captura de video en vivo (webcam) y análisis de fotografías estáticas. Su objetivo es identificar rostros humanos en tiempo real, rastrearlos consistentemente cuadro a cuadro, clasificar sus expresiones faciales en 7 categorías estándar mediante redes neuronales convolucionales profundas, y registrar una bitácora estructurada de telemetría en formato tabular conforme al estándar internacional ISO 8601.

### Objetivos Alcanzados:
1. **Adquisición de Video en Tiempo Real**: Conexión robusta de baja latencia con cámaras web mediante el backend `DirectShow` forzando descompresión por hardware `MJPG` en Windows 11.
2. **Detección Facial Multirrostro**: Localización espacial instantánea de múltiples personas por frame con MediaPipe BlazeFace.
3. **Clasificación de 7 Emociones Universales**: Predicción de probabilidades para *feliz*, *triste*, *enojado*, *sorprendido*, *miedo*, *asco* y *neutral* utilizando el modelo FER+ ejecutado sobre ONNX Runtime.
4. **Manejo de Incertidumbre**: Filtrado por umbral de confianza mínimo que cataloga predicciones ambiguas como `incierto` para evitar falsos positivos.
5. **Estabilización y Seguimiento**: Módulo de seguimiento espacial por *Intersection over Union* (IoU) y suavizado temporal por promedio móvil que erradica el parpadeo (*flicker*) visual.
6. **Telemetría y Privacidad**: Auditoría continua en archivos CSV con buffer en memoria, sin almacenar imágenes personales salvo bajo demanda explícita del usuario.
7. **Doble Interfaz de Usuario**:
   - Interfaz nativa de escritorio en **OpenCV** a 50+ FPS con HUD dinámico.
   - Dashboard web analítico e interactivo en **Streamlit** para minería de datos y carga de archivos.

---

## 2. Arquitectura del Sistema y Patrones de Diseño

El sistema fue concebido siguiendo principios de **Arquitectura Limpia (*Clean Architecture*)**, bajo acoplamiento y alta cohesión:

```
                                  ┌────────────────────────┐
                                  │   Entrada de Video     │
                                  │  (Webcam / Imagen /    │
                                  │    Cámara Streamlit)   │
                                  └───────────┬────────────┘
                                              │
                                              ▼
                                 ┌─────────────────────────┐
                                 │       core.detector     │
                                 │  (MediaPipe BlazeFace)  │
                                 └────────────┬────────────┘
                                              │ Recortes faciales (ROIs)
                                              ▼
                                 ┌─────────────────────────┐
                                 │      core.classifier    │
                                 │   (ONNX Runtime FER+)   │
                                 └────────────┬────────────┘
                                              │ Probabilidades crudas
                                              ▼
                                 ┌─────────────────────────┐
                                 │       core.tracker      │
                                 │ (IoU + Temporal Smooth) │
                                 └──────┬────────────┬─────┘
                                        │            │
            ┌───────────────────────────┘            └──────────────────────────┐
            ▼                                                                   ▼
┌───────────────────────┐                                           ┌───────────────────────┐
│   interfaces.opencv   │                                           │    utils.csv_logger   │
│  (GUI Desktop 50 FPS, │                                           │ (Buffer de auditoría, │
│  HUD, Teclado, Fotos) │                                           │   Marcas ISO 8601)    │
└───────────────────────┘                                           └───────────┬───────────┘
                                                                                │
                                                                                ▼
                                                                    ┌───────────────────────┐
                                                                    │ interfaces.streamlit  │
                                                                    │ (Dashboard Web, plots,│
                                                                    │  exploración de datos)│
                                                                    └───────────────────────┘
```

### Módulos Principales:
- `config/config.py`: Fuente única de la verdad (*Single Source of Truth*). Contiene una `dataclass` inmutable con todos los hiperparámetros (umbrales, resoluciones, rutas y nombres de clases).
- `core/detector.py`: Abstrae la inicialización del detector BlazeFace y el cálculo geométrico de coordenadas absolutas y márgenes de recorte.
- `core/classifier.py`: Encapsula la sesión de inferencia de ONNX Runtime, normalización y cálculo de Softmax numéricamente estable.
- `core/tracker.py`: Realiza el apareamiento de recuadros (*greedy matching*) entre cuadros sucesivos y calcula el promedio móvil de probabilidades.
- `utils/csv_logger.py`: Administra la apertura de archivos CSV con buffering inteligente para no degradar la tasa de frames por accesos a disco.
- `interfaces/opencv_app.py`: Controla la visualización gráfica de bajo nivel, atajos de teclado y notificaciones en pantalla.
- `interfaces/streamlit_app.py`: Provee un portal web intuitivo para análisis retrospectivo y pruebas desde navegadores.

---

## 3. Fundamentos Teóricos y Algorítmicos

### 3.1 Detección Facial: BlazeFace
BlazeFace es un detector compacto desarrollado por Google optimizado para CPUs y unidades de cómputo móvil:
- **Red Troncal (*Backbone*)**: Inspirada en MobileNetV1/V2 pero con modificaciones que permiten un campo receptivo mayor mediante bloques BlazeBlock (convoluciones separables en profundidad y saltos residuales).
- **Esquema de Anclas (*Anchors*)**: Genera anclas fijas en resoluciones 8x8 y 16x16, permitiendo detectar rostros que ocupan desde pequeñas porciones hasta el encuadre completo.
- **Salida**: Coordenadas relativas de la caja envolvente $(x_{min}, y_{min}, w, h)$ y 6 puntos clave faciales (ojos, nariz, boca y orejas).

### 3.2 Clasificación de Emociones: Red FER+ y Normalización
El modelo está entrenado sobre el conjunto de datos de investigación **FER+ (Microsoft Research)**, una reinterpretación depurada de FER-2013 etiquetada por múltiples revisores humanos independientes para reducir ambigüedades.

1. **Preprocesamiento del Recorte Facial**:
   - Cada caja detectada se expande con un margen del 15% ($\Delta x = 0.15 \times w$, $\Delta y = 0.15 \times h$) para incluir la barbilla, frente y mejillas sin cortar rasgos expresivos.
   - Conversión de color a escala de grises ($Y = 0.299R + 0.587G + 0.114B$).
   - Escalado a resolución espacial fija de $64 \times 64$ píxeles utilizando interpolación de área (`cv2.INTER_AREA`), ideal para reducción sin artefactos de aliasing.
   - Formateo a tensor tetradimensional: $(1, 1, 64, 64)$ en tipo de dato `np.float32`.

2. **Cálculo de Probabilidades con Softmax Estable**:
   Dado el vector de logits crudos producidos por la última capa lineal $z = [z_0, z_1, \dots, z_{K-1}]$:
   $$\sigma(z)_i = \frac{e^{z_i - \max(z)}}{\sum_{j=0}^{K-1} e^{z_j - \max(z)}}$$
   La sustracción de $\max(z)$ previene el desbordamiento numérico (*overflow*) en operaciones de coma flotante.

3. **Función de Decisión con Umbral de Incertidumbre**:
   Sea $c = \max_i (\sigma(z)_i)$ la confianza máxima y $i^* = \arg\max_i (\sigma(z)_i)$ la clase ganadora:
   $$\text{Emoción Asignada} = \begin{cases} \text{Clase}_{i^*} & \text{si } c \ge \theta \\ \text{incierto} & \text{si } c < \theta \end{cases}$$
   Donde $\theta = 0.45$ por defecto (ajustable interactivamente).

### 3.3 Seguimiento Espacial: IoU y Centroides
Para asociar detecciones en el cuadro actual $t$ con rostros rastreados en el cuadro $t-1$:
$$\text{IoU}(A, B) = \frac{\text{Área}(A \cap B)}{\text{Área}(A \cup B)}$$
Si el solapamiento $\text{IoU}(A, B) \ge 0.25$ o la distancia entre centroides $\sqrt{(cx_A - cx_B)^2 + (cy_A - cy_B)^2} \le 120\text{ px}$, se asume continuidad biológica del mismo sujeto, conservando su `track_id`.

### 3.4 Suavizado Temporal (*Temporal Smoothing*)
En video en vivo, las fluctuaciones de luminosidad o microgestos pueden generar parpadeo en la predicción. El sistema mantiene una cola circular FIFO de longitud $N=7$ con las probabilidades históricas:
$$P_{\text{suavizada}}(c) = \frac{1}{N} \sum_{k=0}^{N-1} P_{t-k}(c)$$
Garantiza transiciones continuas y naturales entre emociones.

---

## 4. Evidencia Empírica y Benchmarks Reales en CPU

Durante las sesiones de validación ejecutadas en el equipo del usuario (Windows 11, procesador AMD64, cámara DirectShow), se obtuvieron los siguientes resultados instrumentados:

| Parámetro Evaluado | Sesión Inicial (Fase 2) | Sesión de Clasificación (Fase 3) | Sesión Completa Integrada (Fase 5) |
| :--- | :---: | :---: | :---: |
| **Total Cuadros Procesados** | 295 cuadros | 1.992 cuadros | **1.897 cuadros** |
| **Latencia Detección (MediaPipe)** | 4.69 ms | 4.70 ms | **~4.70 ms** |
| **Latencia Inferencia Emoción (ONNX)** | — | 13.28 ms | **~13.40 ms** |
| **Latencia Total de Frame** | **4.69 ms** | **19.88 ms** | **18.59 ms** |
| **Tasa de Cuadros por Segundo (FPS)** | 213.2 FPS | 50.3 FPS | **53.8 FPS Reales** |
| **Registros Guardados en CSV** | — | 2.165 registros | **1.897 registros** |

### Distribución de Expresiones Medidas en Sesión Típica:
- **Neutral**: 1.858 cuadros (97.9%)
- **Feliz**: 27 cuadros (1.4%)
- **Sorprendido**: 12 cuadros (0.6%)

---

## 5. Estructura de Datos del Archivo CSV (Telemetría)

Cada fila registrada en `data/logs/emociones_YYYYMMDD.csv` respeta el estándar internacional:

| Columna | Tipo de Dato | Descripción / Ejemplo |
| :--- | :--- | :--- |
| `timestamp` | Cadena (ISO 8601 UTC) | `2026-09-24T23:03:41.941323+00:00` |
| `session_id` | Cadena | Identificador único de sesión (`sess_018403f3`) |
| `source` | Cadena | Origen del cuadro (`webcam`, `imagen`, `web_upload`) |
| `frame_id` | Entero | Número secuencial del cuadro en la sesión (`142`) |
| `face_id` | Entero | ID del rostro rastreado (`1`, `2`) |
| `emotion` | Cadena | Emoción resultante (`neutral`, `feliz`, `incierto`) |
| `confidence` | Flotante (4 dec.) | Probabilidad de la clase ganadora (`0.9721`) |
| `prob_neutral` | Flotante (4 dec.) | Probabilidad normalizada de clase Neutral (`0.9721`) |
| `prob_feliz` | Flotante (4 dec.) | Probabilidad normalizada de clase Feliz (`0.0022`) |
| `prob_sorprendido` | Flotante (4 dec.) | Probabilidad normalizada de clase Sorprendido (`0.0024`) |
| `prob_triste` | Flotante (4 dec.) | Probabilidad normalizada de clase Triste (`0.0138`) |
| `prob_enojado` | Flotante (4 dec.) | Probabilidad normalizada de clase Enojado (`0.0077`) |
| `prob_asco` | Flotante (4 dec.) | Probabilidad normalizada de clase Asco (`0.0007`) |
| `prob_miedo` | Flotante (4 dec.) | Probabilidad normalizada de clase Miedo (`0.0002`) |
| `latency_ms` | Flotante (2 dec.) | Tiempo de cómputo del modelo en milisegundos (`18.09`) |

---

## 6. Manual de Operación y Comandos

### 6.1 Ejecución de la Aplicación de Escritorio
```powershell
.\venv\Scripts\python.exe main.py
```
*Atajos de Teclado Disponibles*:
- <kbd>H</kbd>: Alternar panel HUD de barras de probabilidades.
- <kbd>C</kbd>: Capturar imagen actual anotada (se guarda en `data/capturas/`).
- <kbd>T</kbd>: Cambiar cíclicamente el umbral de certeza (`35%` / `45%` / `60%`).
- <kbd>M</kbd>: Activar / Desactivar el suavizado temporal de predicciones.
- <kbd>S</kbd>: Mostrar / Ocultar telemetría superior de FPS y tiempos de cómputo.
- <kbd>Q</kbd> o <kbd>ESC</kbd>: Finalizar sesión y desplegar estadísticas consolidadas.

### 6.2 Ejecución del Dashboard Web Streamlit
```powershell
.\venv\Scripts\python.exe main.py --web
```
Abre en el navegador una consola con gráficos de evolución temporal, distribución de frecuencias, visor de fotos y descarga de auditorías.

### 6.3 Ejecución de la Suite de Pruebas Unitarias
```powershell
.\venv\Scripts\pytest
```
*Cobertura*: 23 tests unitarios automatizados que verifican:
- Inicialización y liberación de recursos de hardware.
- Robustez ante frames corruptos, vacíos o imágenes negras.
- Cumplimiento de la propiedad matemática de probabilidades ($\sum P_i = 1.0$).
- Mecanismo de incertidumbre ante umbrales estrictos.
- Asociación espacial IoU y persistencia de IDs de rostros.
- Escritura y tolerancia a bloqueos de archivos CSV.

---

## 7. Marco Legal, Ética y Consideraciones Críticas

### 7.1 Expresiones Faciales vs. Estados Internos
Una premisa científica medular en visión computacional es que **las redes neuronales clasifican configuraciones visibles de la superficie facial, no sentimientos ni estados psicológicos internos**:
- Una sonrisa puede reflejar cortesía, sarcasmo o nerviosismo en lugar de felicidad genuina.
- La ausencia de gestos expresivos no es indicativo de apatía o tristeza.
- El software no debe utilizarse bajo ninguna circunstancia para emitir juicios de valor, evaluaciones de idoneidad laboral o diagnósticos clínicos automatizados.

### 7.2 Protección de Datos Personales (Ley Argentina 25.326)
- La imagen humana y los patrones biométricos constituyen **datos sensibles**.
- Este sistema implementa *Privacidad por Defecto*: ninguna imagen ni video se almacena de forma persistente. Toda la información visual se procesa en memoria volátil (RAM) y se descarta inmediatamente tras la inferencia.
- Únicamente se guardan registros alfanuméricos anonimizados con fines estadísticos.

### 7.3 Reglamento de Inteligencia Artificial de la Unión Europea (AI Act)
- El AI Act de la UE prohíbe taxativamente la comercialización y empleo de herramientas de reconocimiento de emociones en los ámbitos **laborales (evaluación de empleados, entrevistas de trabajo) y educativos (seguimiento de atención de alumnos)** debido al alto riesgo de discriminación algorítmica y sesgos culturales.
- Su utilización queda restringida a entornos de investigación académica controlada o fines terapéuticos autorizados.

### 7.4 Límites Realistas de Precisión
- En conjuntos de datos estandarizados como FER-2013 / FER+, los modelos de vanguardia en visión por CPU alcanzan un acierto de entre el **70% y el 75%**.
- Expresiones como *asco* y *miedo* poseen menor cantidad de datos de entrenamiento en la literatura internacional, lo que reduce su certidumbre relativa respecto a *feliz* o *neutral*.
- Factores como iluminación escasa, oclusiones (barbijos, lentes, cabello) y rotación cefálica mayor a 45° afectan la confiabilidad, justificando la presencia activa de la categoría **`incierto`**.

---

## 8. Conclusiones

El proyecto demuestra la viabilidad técnica de implementar un pipeline integral de inteligencia artificial para visión por computadora en tiempo real, operando de manera fluida (53+ FPS) sobre computadoras convencionales de oficina o académicas, sin necesidad de hardware especializado de servidor o GPUs costosas, respaldado por código modular, tests automatizados y estricto apego a normas de privacidad y ética.
