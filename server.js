import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import webpush from 'web-push';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.join(__dirname, 'data');
const SUBSCRIPTIONS_FILE = path.join(DATA_DIR, 'subscriptions.json');
const REMINDERS_FILE = path.join(DATA_DIR, 'reminders.json');
const VAPID_FILE = path.join(DATA_DIR, 'vapid-keys.json');

ensureFile(SUBSCRIPTIONS_FILE, []);
ensureFile(REMINDERS_FILE, []);
const vapidKeys = loadOrCreateVapidKeys();

webpush.setVapidDetails(
  'mailto:admin@miso.local',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

console.log('\n=== VAPID PUBLIC KEY (copia esto a Railway > Variables) ===');
console.log('VAPID_PUBLIC_KEY=' + vapidKeys.publicKey);
console.log('VAPID_PRIVATE_KEY=' + vapidKeys.privateKey);
console.log('=========================================================\n');

app.use(express.json({ limit: '1mb' }));
app.use(express.static(__dirname));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, now: Date.now(), vapidConfigured: !!vapidKeys.publicKey });
});

app.get('/api/vapid-public-key-hint', (_req, res) => {
  // Solo muestra la clave pública (no es secreta) para facilitar configuración inicial
  res.json({ publicKey: vapidKeys.publicKey });
});

app.get('/api/public-key', (_req, res) => {
  res.json({ publicKey: vapidKeys.publicKey });
});

app.post('/api/subscribe', (req, res) => {
  const { deviceId, subscription } = req.body || {};

  if (!deviceId || !subscription || !subscription.endpoint) {
    res.status(400).json({ ok: false, error: 'deviceId/subscription inválidos' });
    return;
  }

  const subscriptions = readJson(SUBSCRIPTIONS_FILE, []);
  const index = subscriptions.findIndex(item => item.deviceId === deviceId);
  const payload = {
    deviceId,
    subscription,
    updatedAt: Date.now()
  };

  if (index >= 0) {
    subscriptions[index] = payload;
  } else {
    subscriptions.push(payload);
  }

  writeJson(SUBSCRIPTIONS_FILE, subscriptions);
  res.json({ ok: true });
});

app.post('/api/reminders', (req, res) => {
  const { deviceId, reminder } = req.body || {};

  if (!deviceId || !reminder || !reminder.id || !reminder.nextTriggerAt) {
    res.status(400).json({ ok: false, error: 'Payload de reminder inválido' });
    return;
  }

  const reminders = readJson(REMINDERS_FILE, []);
  const index = reminders.findIndex(item => item.id === reminder.id);
  const payload = {
    ...reminder,
    deviceId,
    updatedAt: Date.now()
  };

  if (index >= 0) {
    reminders[index] = payload;
  } else {
    reminders.push(payload);
  }

  writeJson(REMINDERS_FILE, reminders);
  res.json({ ok: true });
});

app.listen(PORT, HOST, () => {
  console.log(`Miso backend escuchando en http://localhost:${PORT} (${HOST}:${PORT})`);
});

setInterval(processDueReminders, 10000);
processDueReminders();

async function processDueReminders() {
  const now = Date.now();
  const reminders = readJson(REMINDERS_FILE, []);
  const subscriptions = readJson(SUBSCRIPTIONS_FILE, []);

  if (!reminders.length || !subscriptions.length) {
    return;
  }

  let changed = false;
  const activeReminders = [];

  for (const reminder of reminders) {
    if (!reminder.nextTriggerAt || reminder.nextTriggerAt > now) {
      activeReminders.push(reminder);
      continue;
    }

    const subEntry = subscriptions.find(item => item.deviceId === reminder.deviceId);
    if (!subEntry) {
      activeReminders.push(reminder);
      continue;
    }

    const payload = JSON.stringify({
      title: 'Miso Reminder',
      body: reminder.mensajeCompleto,
        tag: `miso-reminder-${reminder.id}`,
        requireInteraction: true,
        vibrate: [300, 120, 300, 120, 500],
      data: buildChannelPayload(reminder),
      actions: buildActions(reminder.medio)
    });

    try {
        await webpush.sendNotification(subEntry.subscription, payload, {
          TTL: 60,
          urgency: 'high',
          topic: `miso-${reminder.id}`
        });
      changed = true;

      if (reminder.periodicidad === 'once') {
        continue;
      }

      const nextTime = computeNextTrigger(reminder);
      activeReminders.push({
        ...reminder,
        nextTriggerAt: nextTime,
        updatedAt: Date.now()
      });
    } catch (error) {
      const statusCode = error?.statusCode;
      if (statusCode === 404 || statusCode === 410) {
        removeSubscription(subEntry.deviceId, subscriptions);
      }

      activeReminders.push(reminder);
    }
  }

  if (changed || activeReminders.length !== reminders.length) {
    writeJson(REMINDERS_FILE, activeReminders);
  }

  writeJson(SUBSCRIPTIONS_FILE, subscriptions);
}

function buildChannelPayload(reminder) {
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(reminder.mensajeCompleto)}`;
  const emailUrl = `mailto:?subject=Recordatorio%20Miso%20Reminder&body=${encodeURIComponent(reminder.mensajeCompleto)}`;

  if (reminder.medio === 'whatsapp') {
    return {
      mode: 'whatsapp',
      primaryUrl: whatsappUrl,
      whatsappUrl
    };
  }

  if (reminder.medio === 'email') {
    return {
      mode: 'email',
      primaryUrl: emailUrl,
      emailUrl
    };
  }

  return { mode: 'self' };
}

function buildActions(medio) {
  if (medio === 'whatsapp') {
    return [{ action: 'open-whatsapp', title: 'Abrir WhatsApp' }];
  }

  if (medio === 'email') {
    return [{ action: 'open-email', title: 'Abrir correo' }];
  }

  return [{ action: 'open-app', title: 'Abrir app' }];
}

function computeNextTrigger(reminder) {
  const periodicidad = reminder.periodicidad || 'once';
  const baseDate = reminder.baseDateISO ? new Date(reminder.baseDateISO) : new Date();
  let nextDate = new Date(baseDate);

  if (Number.isNaN(nextDate.getTime())) {
    nextDate = new Date();
  }

  const now = new Date();

  if (periodicidad === 'once') {
    return now.getTime() + 1000;
  }

  while (nextDate <= now) {
    if (periodicidad === 'daily') {
      nextDate.setDate(nextDate.getDate() + 1);
    } else if (periodicidad === 'weekly') {
      nextDate.setDate(nextDate.getDate() + 7);
    } else if (periodicidad === 'monthly') {
      nextDate.setMonth(nextDate.getMonth() + 1);
    } else {
      nextDate = new Date(now.getTime() + 1000);
      break;
    }
  }

  return nextDate.getTime();
}

function removeSubscription(deviceId, subscriptions) {
  const index = subscriptions.findIndex(item => item.deviceId === deviceId);
  if (index >= 0) {
    subscriptions.splice(index, 1);
  }
}

function ensureFile(filePath, fallbackData) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(fallbackData, null, 2), 'utf8');
  }
}

function readJson(filePath, fallbackData) {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(text);
  } catch {
    return fallbackData;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function loadOrCreateVapidKeys() {
  // Prioridad 1: variables de entorno (Railway, Render, etc.)
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    console.log('Usando claves VAPID desde variables de entorno.');
    return {
      publicKey: process.env.VAPID_PUBLIC_KEY,
      privateKey: process.env.VAPID_PRIVATE_KEY
    };
  }

  // Prioridad 2: archivo local (dev / Codespace)
  if (fs.existsSync(VAPID_FILE)) {
    console.log('Usando claves VAPID desde archivo local.');
    return readJson(VAPID_FILE, null);
  }

  // Prioridad 3: generar nuevas (primer arranque sin config)
  console.warn('AVISO: Generando nuevas claves VAPID. Configura VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY como variables de entorno para que no cambien en cada redeploy.');
  const keys = webpush.generateVAPIDKeys();
  writeJson(VAPID_FILE, keys);
  return keys;
}
