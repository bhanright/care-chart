// Care Chart service worker. It caches nothing on purpose: a medication chart must
// never show stale doses. It exists so phones can show reminders and install the app.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// A reminder sent by the server (src/reminders.ts).
self.addEventListener("push", (event) => {
  let notice = { title: "Care Chart", body: "Something needs attention.", url: "/#today" };
  try {
    notice = { ...notice, ...event.data.json() };
  } catch {
    // keep the generic notice
  }
  event.waitUntil(self.registration.showNotification(notice.title, {
    body: notice.body,
    tag: notice.tag,
    renotify: Boolean(notice.tag),
    requireInteraction: Boolean(notice.urgent),
    icon: "/icons/care-chart-192.png",
    badge: "/icons/badge-96.png", // a white silhouette; Android uses only its shape
    data: { url: notice.url },
  }));
});

// Tapping a reminder opens (or focuses) Care Chart on the Today screen.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const target = event.notification.data?.url ?? "/#today";
    for (const client of windows) {
      if ("focus" in client) {
        if ("navigate" in client) await client.navigate(target).catch(() => {});
        return client.focus();
      }
    }
    return self.clients.openWindow(target);
  })());
});
