# Contrato de la API

Base: `/api`. Todas las rutas requieren el encabezado `x-api-key: <ADMIN_API_KEY>`
salvo `/api/health` y `/api/webhooks/evolution` (que trae su propio token).

Errores: `{ "error": <string | objeto de validación> }` con 400, 401, 404, 409 o 502.

**CORS.** Deshabilitado por defecto: en el despliegue normal el navegador llama al
frontend y nginx proxea `/api` al backend, así que todo ocurre en el mismo origen.
Si el panel se sirve desde otro dominio, hay que listarlo en `CORS_ORIGIN`
(backend). El preflight `OPTIONS` no lleva `x-api-key` y se responde con 204.

---

## Salud

### `GET /api/health`
```json
{ "ok": true, "ts": "2026-08-13T05:30:37.280Z" }
```

---

## Webhook

### `POST /api/webhooks/evolution`
También acepta `POST /api/webhooks/evolution/*` (Evolution añade el nombre del
evento cuando `byEvents=true`).

Autenticación: encabezado `x-webhook-token` o query `?token=`.

Cuerpo: el payload de Evolution (`{ event, instance, data }`). Se procesan
`messages.upsert` y `messages.update`.

```json
{ "ok": true, "accepted": 1 }
```

`accepted` cuenta sólo los mensajes nuevos guardados. Los mensajes de grupos no
habilitados, chats privados y repeticiones del mismo `message_id` devuelven 0.
Ante un error interno responde `200 {"ok": false}` para que Evolution no
reintente en bucle.

---

## Grupos

### `GET /api/groups`
```json
{ "groups": [ { "id": 1, "remoteJid": "...@g.us", "groupName": "...",
                "enabled": true, "role": "SOURCE",
                "createdAt": "...", "updatedAt": "..." } ] }
```

### `GET /api/groups/available`
Grupos que ve el WhatsApp conectado, cruzados con los ya registrados. `502` si
Evolution no responde.
```json
{ "groups": [ { "remoteJid": "...@g.us", "groupName": "...", "size": 91,
                "monitored": true, "enabled": true, "role": "SOURCE" } ] }
```

### `POST /api/groups/sync`
Trae los grupos visibles por la instancia y los registra **deshabilitados**. No
reactiva ni cambia el rol de los que ya existen: sólo refresca el nombre.
Equivale a `npm run sync:groups`. `502` si Evolution no responde.
```json
{ "synced": 5, "added": 5 }
```

### `POST /api/groups` → `201`
```json
{ "remoteJid": "...@g.us", "groupName": "...", "enabled": true, "role": "SOURCE" }
```
`role`: `SOURCE` (monitoreado) o `NOTIFICATION` (grupo central). Idempotente por
`remoteJid`.

### `PATCH /api/groups/:id`
Campos opcionales: `enabled`, `role`, `groupName`.

### `DELETE /api/groups/:id` → `204`

---

## Reportes

### `GET /api/reports`
Query: `status`, `category`, `priority` (listas separadas por coma), `since`
(ISO), `limit` (≤200, def. 50), `offset`.

```json
{
  "total": 27,
  "reports": [
    {
      "id": 31,
      "title": "Posible saqueo en supermercado 5ta con 13",
      "claim": "Se están presentando saqueos en el supermercado de la Calle 5 con Carrera 13.",
      "pollQuestion": "¿Puedes confirmar que...?",
      "category": "SAQUEO",
      "priority": "HIGH",
      "zone": "San Fernando",
      "lat": 3.4234, "lng": -76.5432,
      "status": "VOTING",
      "scamFlag": false,
      "occurredApprox": "hace ~20 minutos",
      "messageCount": 14, "duplicateCount": 6,
      "distinctSenders": 8, "distinctGroups": 4, "independentSources": 4,
      "pollMessageId": "...", "pollSentAt": "...", "pollClosesAt": "...",
      "votesYes": 82, "votesNo": 7, "votesUnknown": 31,
      "confidence": 0.921, "adminNote": null, "closedAt": null,
      "createdAt": "...", "updatedAt": "...",
      "tally": { "total": 120, "informed": 89, "yesPct": 68.3, "noPct": 5.8,
                 "unknownPct": 25.8, "confidence": 0.921, "status": "SUPPORTED" }
    }
  ]
}
```

`tally.confidence` es la proporción de "Sí" entre las respuestas informadas
(Sí+No). No representa veracidad.

### `GET /api/reports/:id`
```json
{
  "report": { ...igual que arriba... },
  "messages": [
    { "id": "uuid", "sentAt": "...", "content": "...", "summary": "...",
      "certainty": "TESTIMONIO_DIRECTO", "category": "SAQUEO", "priority": "HIGH",
      "zone": "San Fernando", "isDuplicate": false, "type": "text",
      "groupName": "NORTE DEL VALLE", "source": "2e3642" }
  ],
  "votes": { "breakdown": { "YES": 82, "NO": 7, "UNKNOWN": 31 },
             "bySource": { "POLL": 108, "TEXT": 12 } },
  "evidence": [ { "id": 1, "kind": "PHOTO", "content": "...",
                  "createdAt": "...", "source": "9a11c4" } ]
}
```

`source` es un identificador seudónimo de 6 caracteres. La API **nunca** devuelve
el número de teléfono ni el JID del remitente.

### `POST /api/reports/:id/publish`
Fuerza la encuesta sin esperar al umbral. `409` si ya está en `VOTING`, `502` si
Evolution falla.

### `POST /api/reports/:id/close-poll`
Cierra la encuesta, recalcula la confianza, publica los resultados y pasa el
reporte a `SUPPORTED` / `DISPUTED` / `UNCONFIRMED`. `409` si no hay encuesta abierta.

### `POST /api/reports/:id/cancel-poll`
Marca el reporte como `DISMISSED`.

### `POST /api/reports/:id/status`
```json
{ "status": "VERIFIED", "note": "Confirmado por la Policía a las 21:40" }
```
`status` ∈ `DETECTED`, `PROCESSING`, `PENDING_VERIFICATION`, `VOTING`,
`SUPPORTED`, `DISPUTED`, `UNCONFIRMED`, `DISMISSED`, `VERIFIED`.
Devuelve `{ "report": {...} }`.

---

## Panel

### `GET /api/dashboard/summary`
```json
{
  "reports": { "critical": 3, "high": 12, "inVerification": 27,
               "supported": 18, "dismissed": 7,
               "byStatus": { "VOTING": 12 },
               "byCategory": [ { "category": "SAQUEO", "count": 9 } ] },
  "messages": { "total": 4210, "last24h": 812, "relevant": 96, "pending": 14 },
  "groups": { "total": 6, "enabled": 4 }
}
```

### `GET /api/dashboard/map`
Sólo reportes con zona geocodificada contra el gazetteer de Cali y el Valle.
```json
{ "points": [ { "id": 31, "title": "...", "category": "SAQUEO",
                "priority": "HIGH", "status": "VOTING", "zone": "San Fernando",
                "lat": 3.4234, "lng": -76.5432, "createdAt": "..." } ] }
```

### `GET /api/dashboard/activity?limit=100`
```json
{ "activity": [ { "id": 512, "action": "POLL_CREATED", "entityType": "report",
                  "entityId": "31", "actor": "system",
                  "detail": { "pollMessageId": "..." }, "createdAt": "..." } ] }
```

Acciones: `MESSAGE_INGESTED`, `MESSAGES_CLASSIFIED`, `REPORT_CREATED`,
`REPORT_UPDATED`, `POLL_CREATED`, `POLL_CLOSED`, `POLL_CANCELLED`,
`VOTE_RECORDED`, `EVIDENCE_ADDED`, `ALERT_SENT`, `ADMIN_VERIFIED`,
`ADMIN_DISMISSED`, `GROUP_ADDED`, `GROUP_ENABLED`, `GROUP_DISABLED`,
`SETTING_UPDATED`, `RETENTION_PURGE`, `PIPELINE_ERROR`.

---

## Administración

### `GET /api/admin/instance`
Estado de la conexión de WhatsApp y webhook configurado.

### `GET /api/admin/instance/qr`
`{ "qr": "<png en base64>", "code": "<código de vinculación>" }`

### `POST /api/admin/instance/webhook`
Apunta el webhook de la instancia a `PUBLIC_URL/api/webhooks/evolution`.
`400` si falta `PUBLIC_URL`.

### `POST /api/admin/run-cycle`
Ejecuta un ciclo completo del pipeline de forma síncrona.

### `GET /api/admin/config`
Configuración efectiva del pipeline, modelo e instancia.
