const CACHE_NAME = 'miso-v2';
const assets = [
  './',
  './index.html',
  './manifest.json'
];

// Instalar el Service Worker
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(assets);
    })
  );

  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Responder con la caché si no hay internet
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    caches.match(event.request).then(response => {
      if (response) {
        return response;
      }

      return fetch(event.request).catch(() => {
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }

        return new Response('', {
          status: 503,
          statusText: 'Offline'
        });
      });
    })
  );
});

self.addEventListener('push', event => {
  let payload = {};

  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {
      title: 'Miso Reminder',
      body: event.data ? event.data.text() : 'Tienes un recordatorio pendiente'
    };
  }

  const title = payload.title || 'Miso Reminder';
  const sticky = payload.requireInteraction !== false;
  const baseData = payload.data || {};
  const notificationData = {
    ...baseData,
    _title: title,
    _body: payload.body || 'Tienes un recordatorio pendiente',
    _tag: payload.tag || `miso-reminder-${Date.now()}`,
    _actions: payload.actions || [{ action: 'open-app', title: 'Abrir app' }],
    _sticky: sticky,
    _vibrate: payload.vibrate || [300, 120, 300, 120, 500]
  };

  const options = {
    body: notificationData._body,
    icon: 'https://cdn-icons-png.flaticon.com/512/2921/2921222.png',
    badge: 'https://cdn-icons-png.flaticon.com/512/2921/2921222.png',
    tag: notificationData._tag,
    renotify: true,
    requireInteraction: sticky,
    silent: false,
    vibrate: notificationData._vibrate,
    data: notificationData,
    actions: notificationData._actions,
    timestamp: Date.now()
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();

  const data = event.notification.data || {};
  let targetUrl = './';

  if (event.action === 'open-whatsapp' && data.whatsappUrl) {
    targetUrl = data.whatsappUrl;
  } else if (event.action === 'open-email' && data.emailUrl) {
    targetUrl = data.emailUrl;
  } else if (data.primaryUrl) {
    targetUrl = data.primaryUrl;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (targetUrl === './' && 'focus' in client) {
          return client.focus();
        }
      }

      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }

      return undefined;
    })
  );
});

self.addEventListener('notificationclose', event => {
  const data = event.notification.data || {};

  if (!data._sticky) {
    return;
  }

  const title = data._title || 'Miso Reminder';
  const options = {
    body: data._body || 'Tienes un recordatorio pendiente',
    icon: 'https://cdn-icons-png.flaticon.com/512/2921/2921222.png',
    badge: 'https://cdn-icons-png.flaticon.com/512/2921/2921222.png',
    tag: data._tag || `miso-reminder-${Date.now()}`,
    renotify: true,
    requireInteraction: true,
    silent: false,
    vibrate: data._vibrate || [300, 120, 300, 120, 500],
    data,
    actions: data._actions || [{ action: 'open-app', title: 'Abrir app' }],
    timestamp: Date.now()
  };

  event.waitUntil(self.registration.showNotification(title, options));
});
