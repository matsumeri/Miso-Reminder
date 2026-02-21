# Miso Reminder (PWA + Web Push)

## Ejecutar en local

1. Instala dependencias:

```bash
npm install
```

2. Inicia el servidor:

```bash
npm start
```

3. Abre la app en:

- `http://localhost:3000`

## Qué hace esta versión

- Sirve frontend + API desde el mismo origen.
- Genera y guarda claves VAPID en `data/vapid-keys.json`.
- Guarda suscripciones push en `data/subscriptions.json`.
- Guarda recordatorios en `data/reminders.json`.
- Un scheduler del servidor revisa recordatorios vencidos cada 10s y envía push real.

## Importante para celular

- En Android, funciona mejor instalando la PWA y permitiendo notificaciones.
- En iPhone, Web Push requiere PWA instalada y notificaciones habilitadas.
- Para producción en internet, despliega en HTTPS (requerido para Push fuera de localhost).
