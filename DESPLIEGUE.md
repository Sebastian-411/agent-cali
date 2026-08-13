# Despliegue

## Qué hay que poner en pie

Tres piezas. Dos de ellas necesitan dominio público:

| Pieza | Imagen | ¿Dominio público? | Por qué |
|---|---|---|---|
| Postgres | `postgres:16-alpine` | no | sólo lo usa el backend |
| Backend | `./backend` | **sí** | Evolution le entrega el webhook |
| Panel | `./frontend` | **sí** | lo abren los administradores |

```
Evolution API ──webhook──► backend.tudominio.com      (backend)
                              ▲
administrador ──navegador──► panel.tudominio.com ──/api──► backend
```

El backend **necesita** dominio público: si Evolution no lo alcanza, no llega ni
un mensaje. El panel podría vivir en una red interna, pero lo normal es darle
dominio también.

> ⚠️ Antes de nada: crea una **instancia de Evolution dedicada** a este proyecto.
> Evolution admite un solo webhook por instancia; si reutilizas una que ya está
> en producción, esa integración deja de recibir mensajes.

---

## Ruta A · EasyPanel (recomendada)

Es donde ya corre tu Evolution API, así que todo queda junto.

### 1. Base de datos

Puedes usar una base existente compartida con otros proyectos: **todo este
sistema vive dentro de un esquema propio** (`DB_SCHEMA`) y no toca nada fuera de
ahí. El esquema y sus tablas se crean solos al arrancar el backend.

```bash
DATABASE_URL=postgres://usuario:clave@host:5432/labs?sslmode=disable
DB_SCHEMA=agente_grupos      # un nombre que no choque con otros proyectos
```

Si prefieres una base dedicada, crea un servicio **Postgres** en el proyecto y
apunta `DATABASE_URL` a su nombre interno.

No hace falta correr migraciones a mano ni preparar el esquema.

### 2. Backend

Crea una **App** apuntando al repo, con **Build path** `/backend` (usa su
Dockerfile). Puerto interno **3000**. Asígnale un dominio, p. ej.
`agente-api.tudominio.com`.

Variables de entorno — el contenido de `backend/.env.example`, con estos valores
reales:

```bash
DATABASE_URL=postgres://...            # la del paso 1
PUBLIC_URL=https://agente-api.tudominio.com   # ESTE dominio, sin barra final

EVOLUTION_API_URL=https://tu-evolution-api.ejemplo.com
EVOLUTION_API_KEY=...
EVOLUTION_INSTANCE=agente_grupos       # la instancia DEDICADA

WEBHOOK_TOKEN=<openssl rand -hex 32>
ADMIN_API_KEY=<openssl rand -hex 32>
SENDER_SALT=<openssl rand -hex 32>     # cambiarlo rompe la deduplicación histórica

GEMINI_API_KEY=...
GEMINI_MODEL=gemini-2.5-flash
```

`PUBLIC_URL` es el error más común: tiene que ser el dominio **del backend**, no
el del panel, porque es la dirección a la que Evolution enviará los mensajes.

### 3. Panel

Otra **App** con **Build path** `/frontend`. Puerto interno **80**. Dominio, p.
ej. `agente.tudominio.com`.

Una sola variable:

```bash
BACKEND_URL=https://agente-api.tudominio.com
```

Puedes usar el nombre interno del servicio backend si lo prefieres; el dominio
público funciona igual y evita adivinar el DNS interno. nginx resuelve ese
nombre en cada petición, así que el panel arranca aunque el backend todavía no
esté listo, y se recupera solo.

**No** necesitas `CORS_ORIGIN`: el navegador habla sólo con el panel y nginx
proxea `/api` al backend, todo en el mismo origen.

---

## Ruta B · Un VPS cualquiera con Docker

```bash
git clone <repo> && cd agent-grupos
cp backend/.env.example  backend/.env
cp frontend/.env.example frontend/.env

for v in WEBHOOK_TOKEN ADMIN_API_KEY SENDER_SALT; do echo "$v=$(openssl rand -hex 32)"; done
# pega esos valores en backend/.env, junto con EVOLUTION_API_KEY, GEMINI_API_KEY
# y PUBLIC_URL (el dominio público del backend)

docker compose up -d --build
```

El compose **no levanta Postgres** por defecto: usa la `DATABASE_URL` de
`backend/.env`, que normalmente apunta a una base externa. Si quieres uno local
para desarrollo:

```bash
docker compose --profile localdb up -d
# y en backend/.env:  DATABASE_URL=postgres://agente:agente@db:5432/agente?sslmode=disable
```

Deja `BACKEND_URL=http://backend:3000` en `frontend/.env` (red interna de
compose). Pon un reverse proxy delante (Caddy, Traefik o nginx) con TLS:
`agente.tudominio.com` → puerto 8081, `agente-api.tudominio.com` → puerto 3000.

Sin dominio real, para una prueba: `cloudflared tunnel --url http://localhost:3000`
y usa esa URL como `PUBLIC_URL`.

---

## Primer arranque · el orden importa

Todo se hace desde el panel, en `https://agente.tudominio.com` → pestaña
**Conexión**. Te pedirá la `ADMIN_API_KEY` al entrar.

1. **Vincular WhatsApp.** Escanea el QR (se renueva solo cada 20 s) desde el
   teléfono del proyecto: WhatsApp → Dispositivos vinculados → Vincular un
   dispositivo. Si no puedes escanear, usa el código de vinculación que aparece
   debajo. El estado pasa a 🟢 conectado.
2. **Apuntar el webhook.** Botón *Apuntar el webhook a este backend*. Debe quedar
   mostrando tu `PUBLIC_URL/api/webhooks/evolution`.
3. **Traer los grupos.** Botón *Traer grupos de la instancia*. Quedan todos
   registrados pero **deshabilitados**.
4. **Habilitar lo que corresponde**, en la pestaña *Grupos*:
   - los grupos comunitarios como **Monitoreado**,
   - el grupo central de alertas como **Grupo central**.

Antes del paso 4, **agrega el número del proyecto a esos grupos**: es un número
nuevo y no ve nada a lo que no pertenezca.

---

## Verificar que quedó bien

```bash
API=https://agente-api.tudominio.com
KEY=<ADMIN_API_KEY>

curl -s $API/api/health                                    # {"ok":true,...}
curl -s -o /dev/null -w '%{http_code}\n' $API/api/reports   # 401 sin clave
curl -s -H "x-api-key: $KEY" $API/api/admin/instance        # state: open, webhook: tu URL
curl -s -H "x-api-key: $KEY" $API/api/admin/config          # modelos y pipeline
```

Y la prueba de verdad: escribe algo en un grupo monitoreado y mira
`Panel → Mensajes 24h`. Si sube, la ingesta funciona. Si no, revisa en
*Conexión* que el webhook apunte a tu `PUBLIC_URL` y que el grupo esté habilitado.

Los reportes tardan: primero pasa la ventana de agregación
(`AGGREGATION_DEBOUNCE_SECONDS`, 5 min) y luego el ciclo. Para no esperar,
*Actividad del agente → Ejecutar ciclo ahora*.

---

## Antes de conectar los grupos reales

- **Prueba con un grupo pequeño.** Crea uno con dos o tres personas, habilítalo,
  escribe mensajes de prueba y revisa que los reportes salgan bien redactados y
  que la encuesta llegue al grupo central. Recién ahí conecta el grupo de 91.
- **El costo escala con el volumen de mensajes**, no con el de reportes: cada
  ciclo clasifica todo lo que entró. Si el volumen es alto, baja el modelo de
  clasificación a `gemini-2.5-flash-lite` y sube `AGGREGATION_DEBOUNCE_SECONDS`.
- **`PIPELINE_ENABLED=false`** deja el sistema ingiriendo y guardando mensajes
  sin llamar al modelo ni publicar nada. Útil para observar volumen real un día
  antes de encender el agente.

---

## Operación

| Necesito | Cómo |
|---|---|
| Ver qué está haciendo el agente | Panel → *Actividad del agente* (bitácora de auditoría) |
| Parar las publicaciones ya | `PIPELINE_ENABLED=false` y reinicia el backend |
| Dejar de leer un grupo | Panel → *Grupos* → Deshabilitar. Efecto inmediato, no desconecta WhatsApp |
| Cambiar de modelo | Cambia `GEMINI_*` y reinicia el backend |
| Rotar la clave del panel | Cambia `ADMIN_API_KEY` y reinicia. Todos vuelven a iniciar sesión |
| Ver errores | Logs del backend; los fallos del pipeline quedan como `PIPELINE_ERROR` en la bitácora |

**No cambies `SENDER_SALT` con datos en producción**: los remitentes se
seudonimizan con esa sal, y cambiarla hace que la misma persona cuente como una
fuente nueva y pueda votar otra vez.

---

## Actualizar

Reconstruye y reinicia; las migraciones corren solas al arrancar.

```bash
git pull && docker compose up -d --build     # Ruta B
```

En EasyPanel, *Deploy* en cada App. El panel y el backend se pueden desplegar por
separado: son contenedores independientes.
