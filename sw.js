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
  const options = {
    body: payload.body || 'Tienes un recordatorio pendiente',
    icon: 'https://cdn-icons-png.flaticon.com/512/2921/2921222.png',
    badge: 'https://cdn-icons-png.flaticon.com/512/2921/2921222.png',
    tag: payload.tag || `miso-reminder-${Date.now()}`,
    renotify: true,
    data: payload.data || {},
    actions: payload.actions || [{ action: 'open-app', title: 'Abrir app' }]
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
