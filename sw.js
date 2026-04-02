const CACHE = 'remindme-v1';
const FILES = ['/', '/index.html', '/manifest.json'];

// Install & cache
self.addEventListener('install', function(e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(function(c) { return c.addAll(FILES); })
  );
});

self.addEventListener('activate', function(e) {
  self.clients.claim();
});

// Serve from cache
self.addEventListener('fetch', function(e) {
  e.respondWith(
    caches.match(e.request).then(function(r) { return r || fetch(e.request); })
  );
});

// ── ALARM CHECKER ──
// Runs every 60 seconds inside service worker (works even when tab is closed)
function checkAlarms() {
  // Read alarms from IndexedDB
  openDB().then(function(db) {
    var tx = db.transaction('alarms', 'readonly');
    var store = tx.objectStore('alarms');
    var req = store.getAll();
    req.onsuccess = function() {
      var alarms = req.result || [];
      var now = new Date();
      var hh = String(now.getHours()).padStart(2, '0');
      var mm = String(now.getMinutes()).padStart(2, '0');
      var nowStr = hh + ':' + mm;

      alarms.forEach(function(a) {
        if (a.time === nowStr && !a.fired) {
          // Mark as fired
          a.fired = true;
          var tx2 = db.transaction('alarms', 'readwrite');
          tx2.objectStore('alarms').put(a);

          // Show notification
          self.registration.showNotification('🔔 RemindMe — ' + a.label, {
            body: a.message || 'Time for your ' + a.label + '!',
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            tag: 'alarm-' + a.id,
            requireInteraction: true,
            vibrate: [300, 100, 300, 100, 300],
            actions: [
              { action: 'done', title: '✅ Done' },
              { action: 'snooze', title: '⏰ Snooze 5min' }
            ]
          });

          // Reset fired after 90 seconds
          setTimeout(function() {
            openDB().then(function(db2) {
              var tx3 = db2.transaction('alarms', 'readwrite');
              var s = tx3.objectStore('alarms');
              var r2 = s.get(a.id);
              r2.onsuccess = function() {
                if (r2.result) { r2.result.fired = false; s.put(r2.result); }
              };
            });
          }, 90000);
        }
      });
    };
  });
}

// ── NOTIFICATION ACTIONS ──
self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  if (e.action === 'snooze') {
    // Snooze: add 5 minutes
    var now = new Date(Date.now() + 5 * 60000);
    var hh = String(now.getHours()).padStart(2, '0');
    var mm = String(now.getMinutes()).padStart(2, '0');
    // Show snooze confirmation
    self.registration.showNotification('⏰ Snoozed!', {
      body: 'Alarm will ring again at ' + (now.getHours()%12||12) + ':' + mm + ' ' + (now.getHours()>=12?'PM':'AM'),
      tag: 'snooze-confirm',
      requireInteraction: false
    });
  }
  // Open app on click
  e.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(function(clients) {
      if (clients.length) return clients[0].focus();
      return self.clients.openWindow('/');
    })
  );
});

// ── INDEXEDDB HELPER ──
function openDB() {
  return new Promise(function(resolve, reject) {
    var req = indexedDB.open('RemindMeDB', 1);
    req.onupgradeneeded = function(e) {
      var db = e.target.result;
      if (!db.objectStoreNames.contains('alarms')) {
        db.createObjectStore('alarms', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    req.onsuccess = function() { resolve(req.result); };
    req.onerror = function() { reject(req.error); };
  });
}

// ── START INTERVAL ──
// Check every 60 seconds
setInterval(checkAlarms, 60000);
// Also check immediately when SW activates
checkAlarms();

// Listen for messages from main page
self.addEventListener('message', function(e) {
  if (e.data && e.data.type === 'CHECK_NOW') checkAlarms();
});
