# Agente de monitoreo y verificación comunitaria

Monitorea grupos de WhatsApp **previamente autorizados** durante una emergencia,
identifica afirmaciones relevantes, consolida mensajes redundantes de distintas
fuentes y publica en un grupo central una encuesta **Sí / No / No sé** para
calcular el nivel de confirmación comunitaria, conservando la trazabilidad de
cada fuente.

El principio de diseño es que **la IA no decide qué es verdad**. Organiza la
información; la comunidad aporta el consenso y la evidencia.

```
WhatsApp → Evolution API → webhook → ingesta → ventana de agregación
                                                      ↓
                                          clasificación (Gemini)
                                                      ↓
                                    agrupamiento + claim (Gemini)
                                                      ↓
                                     reporte → encuesta en grupo central
                                                      ↓
                                    votos → nivel de confirmación → resultados
```

---

## Requisitos previos

- Node.js 22+, Docker (para Postgres)
- Una instancia de Evolution API accesible
- Una clave de API de Google Gemini ([aistudio.google.com/apikey](https://aistudio.google.com/apikey))
- Una URL pública para recibir el webhook (ngrok, cloudflared o un servidor)

> ⚠️ **Usa una instancia de Evolution dedicada a este proyecto.**
> Evolution 2.x admite **un solo webhook por instancia**. Si apuntas el webhook
> de una instancia que ya está en producción, esa integración deja de recibir
> mensajes. `npm run setup:instance` crea una instancia nueva para evitarlo.

---

## Puesta en marcha

Backend y frontend se despliegan como contenedores independientes, y **cada uno
tiene su propio archivo de entorno**:

| Archivo | Contiene | Secretos |
|---|---|---|
| `backend/.env` | base de datos, Evolution, modelo, pipeline, claves | **sí** |
| `frontend/.env` | a dónde proxea nginx y el resolver DNS | no |

En `frontend/.env` no va ningún secreto a propósito: todo lo que se compila en
el bundle lo puede leer cualquiera que abra el panel. La `ADMIN_API_KEY` la
escribe cada administrador al entrar.

```bash
cp backend/.env.example  backend/.env
cp frontend/.env.example frontend/.env

# genera los secretos del backend
for v in WEBHOOK_TOKEN ADMIN_API_KEY SENDER_SALT; do echo "$v=$(openssl rand -hex 32)"; done
# pégalos en backend/.env, junto con EVOLUTION_API_KEY, GEMINI_API_KEY y PUBLIC_URL

cd backend
npm install
```

El esquema (`DB_SCHEMA`) y sus tablas se crean solos al arrancar; la base puede
estar compartida con otros proyectos porque nada vive fuera de ese esquema.
Para un Postgres local de desarrollo: `docker compose --profile localdb up -d`.

### 1. Levantar todo

```bash
# desarrollo
cd backend && npm run dev
cd frontend && npm install && npm run dev     # http://localhost:5173

# todo junto en una máquina
docker compose up -d --build                  # panel en http://localhost:8081
```

El panel pide la `ADMIN_API_KEY` al entrar. Los puertos se pueden mover:
`FRONTEND_PORT=9000 BACKEND_PORT=3001 docker compose up -d`.

Para desarrollo local, Evolution necesita alcanzar tu backend:
`cloudflared tunnel --url http://localhost:3000` y pon esa URL en `PUBLIC_URL`.

### 2. Conectar WhatsApp, desde el panel

En la pestaña **Conexión**, en este orden:

1. **Escanea el QR** con el teléfono del proyecto (se renueva solo cada 20 s).
2. **Apunta el webhook** a este backend, con el botón.
3. **Trae los grupos** de la instancia: quedan registrados y **deshabilitados**.

Después, en **Grupos**, habilita los comunitarios como *Monitoreado* y el central
como *Grupo central*. El sistema no lee nada hasta ese momento.

Acuérdate de **agregar el número del proyecto a esos grupos**: es un número nuevo
y no ve nada a lo que no pertenezca.

Los mismos pasos existen como scripts, si prefieres la terminal:
`npm run setup:instance` y `npm run sync:groups`.

---

## Despliegue

Guía completa en **[DESPLIEGUE.md](DESPLIEGUE.md)**: EasyPanel, VPS con Docker,
el orden del primer arranque y la operación del día a día.

En corto: son dos imágenes independientes, cada una con su `.env`.

```bash
docker build -t agent-grupos-backend  ./backend
docker build -t agent-grupos-frontend ./frontend

docker run -d --env-file backend/.env  -p 3000:3000 agent-grupos-backend
docker run -d --env-file frontend/.env -p 80:80     agent-grupos-frontend
```

El backend corre las migraciones al arrancar. El navegador habla sólo con el
panel: nginx recibe `/api` y lo proxea al backend (`BACKEND_URL`), así que todo
queda en el mismo origen y no hace falta CORS. `BACKEND_URL` se resuelve en cada
petición, por eso el panel arranca aunque el backend no esté listo todavía y se
recupera solo.

---

## Cómo funciona el ciclo

Cada `PIPELINE_TICK_MS` (60 s por defecto) el agente:

1. **Toma los mensajes** que ya cumplieron la ventana de agregación
   (`AGGREGATION_DEBOUNCE_SECONDS`, 5 min). Esto evita una encuesta por mensaje.
2. **Clasifica el lote** en una sola llamada al modelo: relevante o no, categoría,
   prioridad, grado de certeza (rumor / segunda mano / testimonio directo /
   evidencia), señal de estafa y zona.
3. **Agrupa** los relevantes contra los reportes abiertos de las últimas
   `CLUSTER_WINDOW_HOURS`. Veinte mensajes sobre el mismo hecho producen **un**
   reporte, no veinte. Los reenvíos se marcan como duplicados —además del
   criterio del modelo, hay una comprobación determinística por texto normalizado.
4. **Redacta el claim** y la pregunta de la encuesta conservando la incertidumbre
   del original (ver *Prevención de desinformación*).
5. **Publica** en el grupo central cuando hay `MIN_SOURCES_TO_PUBLISH` fuentes
   independientes (los `CRITICAL` se publican con una sola).
6. **Recoge votos** durante `POLL_OPEN_MINUTES`, cierra la encuesta, calcula el
   nivel de confirmación y publica los resultados.

Puedes forzar un ciclo desde el dashboard (*Actividad del agente → Ejecutar ciclo
ahora*) o con `POST /api/admin/run-cycle`.

### Estados de un reporte

```
PENDING_VERIFICATION → VOTING → SUPPORTED | DISPUTED | UNCONFIRMED
                                     ↓
                        VERIFIED | DISMISSED  (decisión del administrador)
```

---

## El modelo

El agente hace **dos llamadas por ciclo**, no una por mensaje, y ambas usan
salida estructurada por esquema JSON (`responseJsonSchema`), así que la respuesta
siempre llega con la forma esperada.

Cada etapa se configura por separado, porque tienen exigencias distintas:

| Etapa | Qué hace | Sugerencia |
|---|---|---|
| Clasificación | Volumen alto, decisión sencilla por mensaje | `gemini-2.5-flash-lite` o `flash`, sin razonamiento (`0`) |
| Agrupamiento y claim | Decide qué mensajes son el mismo hecho y redacta la afirmación | `gemini-2.5-flash` o `pro`, razonamiento dinámico (`-1`) |

```bash
GEMINI_CLASSIFY_MODEL=gemini-2.5-flash-lite
GEMINI_CLASSIFY_THINKING_BUDGET=0
GEMINI_CLUSTER_MODEL=gemini-2.5-pro
GEMINI_CLUSTER_THINKING_BUDGET=-1     # pro no admite 0
```

**Filtros de seguridad en `BLOCK_NONE`.** Es una decisión deliberada: el corpus
son reportes de saqueos, grupos armados y emergencias, y con los umbrales por
defecto el filtro bloquearía justo los mensajes que hay que clasificar. El
sistema no genera contenido dañino — clasifica texto ajeno para alertar a la
comunidad — y las reglas de redacción neutral siguen aplicando igual.

---

## Prevención de desinformación

Los prompts prohíben explícitamente afirmar que algo es verdadero o falso, y
obligan a conservar la incertidumbre de la fuente:

| Mensaje original | Claim generado |
|---|---|
| "dicen que la guerrilla está entrando a X" | "Circula un reporte no confirmado sobre la presencia de un supuesto grupo armado en X." |
| "manden plata a este Nequi para las víctimas" | "Se detectó una solicitud de donación cuya legitimidad no ha sido verificada." |

El sistema **nunca acusa a una persona** de estafa ni publica números de teléfono,
nombres de particulares ni datos de cuentas.

El campo `certainty` de cada mensaje distingue "la gente dice" de "tengo
evidencia", y se muestra en la trazabilidad de cada reporte.

---

## Nivel de confirmación (no es "verdad")

```
Sí 82 · No 7 · No sé 31   →   total 120
Sí 68.3% · No 5.8% · No sé 25.8%
Confirmación entre informados (Sí+No = 89): 92%
```

`confidence` es la proporción de "Sí" **entre quienes dijeron tener información**.
Los "No sé" cuentan para el total pero no empujan hacia ningún lado — por eso esa
opción es obligatoria. Con menos de `MIN_INFORMED_VOTES` respuestas informadas el
reporte queda `UNCONFIRMED`, aunque el porcentaje se vea alto.

En ningún lugar del sistema, ni de los mensajes que publica, esto se llama
"verdadero".

---

## Votos: encuesta nativa + respaldo por texto

Los votos de las encuestas de WhatsApp viajan cifrados y no todas las versiones
de Evolution los entregan desencriptados. Por eso hay dos caminos y ambos
alimentan el mismo conteo:

- **Encuesta nativa**: se aceptan tanto el texto de la opción ya desencriptado
  como el SHA-256 de la opción (en hex o base64), en los dos formatos que emite
  Evolution (`messages.update` con `pollUpdates` y `messages.upsert` con
  `pollUpdateMessage`).
- **Texto**: `#31 sí`, `#31 no`, `#31 no sé` en el grupo central, o responder
  citando el mensaje de la encuesta.

Un votante = un voto por reporte; si cambia de opinión, se sobrescribe. Cualquier
otra respuesta con `#31` se guarda como **evidencia** asociada al reporte.

---

## Privacidad

- Sólo se leen los grupos habilitados; los chats privados se descartan siempre.
- **Los números de teléfono nunca se almacenan.** Se guarda un HMAC-SHA256 con
  `SENDER_SALT`, suficiente para contar fuentes independientes y deduplicar votos.
- La API expone un identificador seudónimo corto, nunca el JID ni el hash completo.
- El dashboard y toda la API van detrás de `ADMIN_API_KEY`.
- Cada acción relevante queda en `audit_log`.
- `MESSAGE_RETENTION_DAYS` (30 por defecto) borra los mensajes crudos ya
  procesados. Con `0` no se borra nada.
- El payload crudo del webhook **no se persiste** (`messages.raw` queda en `null`).
  Si necesitas guardarlo para auditoría forense, actívalo en `ingest.ts` sabiendo
  que ahí sí viajan identificadores personales.

---

## Configuración

Ver `backend/.env.example` y `frontend/.env.example`. Las que más importan:

| Variable (backend) | Qué controla |
|---|---|
| `AGGREGATION_DEBOUNCE_SECONDS` | Cuánto espera un mensaje antes de procesarse. Más alto = mejor agrupamiento, más latencia. |
| `MIN_SOURCES_TO_PUBLISH` | Fuentes independientes para publicar. Más alto = menos ruido, más lento. |
| `POLL_OPEN_MINUTES` | Duración de la encuesta. |
| `MIN_INFORMED_VOTES` | Respuestas Sí+No para declarar SUPPORTED/DISPUTED. |
| `GEMINI_MODEL` | Modelo por defecto de ambas etapas. |
| `GEMINI_CLASSIFY_MODEL` / `GEMINI_CLUSTER_MODEL` | Modelo por etapa. Vacío = usa `GEMINI_MODEL`. |
| `GEMINI_CLASSIFY_THINKING_BUDGET` / `GEMINI_CLUSTER_THINKING_BUDGET` | Razonamiento: `0` ninguno, `-1` dinámico, `N` tope en tokens. |
| `PIPELINE_ENABLED=false` | Apaga el procesamiento sin apagar la ingesta ni la API. |
| `CORS_ORIGIN` | Orígenes autorizados. Vacío = CORS apagado (correcto con el proxy). |

| Variable (frontend) | Qué controla |
|---|---|
| `BACKEND_URL` | Upstream de nginx. Runtime: cambiarlo no requiere reconstruir. |
| `NGINX_RESOLVER` | DNS que nginx consulta en cada petición. `127.0.0.11` en Docker. |
| `VITE_API_BASE_URL` | Origen al que llama el navegador. Vacío = mismo origen. **Build**. |
| `VITE_DEV_PROXY_TARGET` | Destino del proxy de `npm run dev`. Sólo local. |

---

## Pruebas

```bash
cd backend
npm test          # 22 pruebas: confianza, deduplicación, votos, extracción
npm run typecheck
```

---

## Estado de verificación

Verificado contra un Postgres real y el webhook en vivo:

- migraciones, salud, autenticación (401 sin clave)
- ingesta: acepta grupo habilitado, ignora grupo deshabilitado, ignora chats
  privados, idempotente ante reenvío del mismo `message_id`
- privacidad: no queda ningún número de teléfono en la base
- votos por texto y por encuesta nativa (ambos formatos de Evolution)
- cierre de encuesta, cálculo de confianza, decisión administrativa, auditoría
- dashboard: resumen, mapa, actividad
- despliegue en contenedores separados: `BACKEND_URL` sustituido al arrancar sin
  tocar las variables propias de nginx, proxy `/api` funcionando, autenticación
  intacta a través del proxy, rutas del SPA, `/healthz`
- el frontend arranca aunque el backend no exista y se recupera solo cuando
  aparece, sin reiniciarlo (resolución DNS por petición)
- CORS: preflight y petición real desde un origen autorizado, sin cabeceras para
  un origen no autorizado, y apagado por defecto
- base de datos compartida: migración aplicada sobre `labs` en un esquema propio,
  sin crear nada fuera de él, y stack completo funcionando contra ella
- primer arranque desde el panel: sincronización de grupos contra la instancia
  real de Evolution (5 grupos registrados deshabilitados), idempotente y sin
  pisar las decisiones del administrador al re-sincronizar
- integración con Gemini contra un endpoint simulado: el SDK envía
  `responseJsonSchema` completo (con `additionalProperties` y `required`),
  `systemInstruction`, `thinkingConfig` y los `safetySettings`; la respuesta se
  parsea bien, y los cuatro casos de error (bloqueo por seguridad, truncamiento,
  JSON inválido, respuesta vacía) dan mensajes accionables

**Sin verificar en vivo** (no había credenciales de Gemini ni instancia de
WhatsApp vinculada en el entorno de desarrollo):

- la respuesta real del modelo en clasificación y agrupamiento — sí está
  verificado que el SDK envía `output_config` con el esquema completo y que la
  respuesta se parsea correctamente, usando un endpoint simulado
- el envío real de mensajes y encuestas a WhatsApp vía Evolution

Haz una prueba con un grupo pequeño antes de conectar los grupos reales.
