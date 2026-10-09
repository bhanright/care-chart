// Turning dose reminders (Web Push) on and off for this device. Once on, the server
// sends reminders even when Care Chart is closed (src/reminders.ts).

import { api } from "./api.js";

export function pushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function base64UrlToBytes(text) {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

/** A name the other caregiver will recognize in the device list. */
function deviceLabel() {
  const agent = navigator.userAgent;
  if (/iPhone|iPad/.test(agent)) return "iPhone or iPad";
  if (/Android/.test(agent)) return /Mobile/.test(agent) ? "Android phone" : "Android tablet";
  if (/Windows/.test(agent)) return "Windows computer";
  if (/Macintosh/.test(agent)) return "Mac";
  return "Browser";
}

async function currentSubscription() {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

/** { supported, configured, devices, thisDeviceOn } */
export async function pushStatus() {
  if (!pushSupported()) return { supported: false, configured: false, devices: [], thisDeviceOn: false };
  const [info, subscription] = await Promise.all([api("/api/push/key"), currentSubscription()]);
  const thisDeviceOn = Boolean(subscription && info.devices.some((device) => device.endpoint === subscription.endpoint));
  return { supported: true, configured: Boolean(info.publicKey), publicKey: info.publicKey, devices: info.devices, thisDeviceOn, endpoint: subscription?.endpoint ?? null };
}

/** True when the server is sending this device its reminders, so the page need not. */
let cachedThisDeviceOn = null;
export async function serverRemindsThisDevice() {
  if (cachedThisDeviceOn !== null) return cachedThisDeviceOn;
  try {
    cachedThisDeviceOn = (await pushStatus()).thisDeviceOn;
  } catch {
    cachedThisDeviceOn = false;
  }
  return cachedThisDeviceOn;
}

export async function turnOnPush(publicKey) {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notifications were not allowed. Allow them in the browser's site settings, then try again.");
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) });
  await api("/api/push/subscribe", { method: "POST", body: { subscription: subscription.toJSON(), label: deviceLabel() } });
  cachedThisDeviceOn = true;
}

export async function turnOffPush() {
  const subscription = await currentSubscription();
  if (subscription) {
    await api("/api/push/unsubscribe", { method: "POST", body: { endpoint: subscription.endpoint } }).catch(() => {});
    await subscription.unsubscribe();
  }
  cachedThisDeviceOn = false;
}

export async function sendTestPush() {
  return (await api("/api/push/test", { method: "POST", body: {} })).delivered;
}
