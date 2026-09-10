/**
 * Install and storage durability.
 *
 * Two platform facts drive everything here:
 *
 * 1. On iOS, Safari deletes IndexedDB, localStorage and service worker
 *    registrations after seven days without interaction. Web apps added to the
 *    Home Screen are exempt — they get their own days-of-use counter. So
 *    installing is not cosmetic on iPhone, it is what keeps the ledger alive.
 *
 * 2. On macOS, "Add to Dock" creates a web app with storage entirely separate
 *    from Safari. Data entered in a Safari tab does NOT carry over. So install
 *    first, import second, or the import happens into the wrong container.
 */

export const isStandalone = () => {
  try {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true
    );
  } catch (err) {
    return false;
  }
};

export function detectPlatform() {
  const ua = navigator.userAgent || "";
  const touchMac = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  if (/iPhone|iPod/.test(ua)) return "iphone";
  if (/iPad/.test(ua) || touchMac) return "ipad";
  if (/Android/.test(ua)) return "android";
  if (/Macintosh|Mac OS X/.test(ua)) return "mac";
  if (/Windows/.test(ua)) return "windows";
  return "other";
}

export const isSafari = () => {
  const ua = navigator.userAgent || "";
  return /Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR|Firefox/.test(ua);
};

/**
 * Ask the browser not to evict our data. Safari resets this on every launch,
 * so this runs on each mount rather than once at setup.
 */
export async function ensurePersisted() {
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch (err) {
    return null;
  }
}

export async function storageUsed() {
  try {
    const e = await navigator.storage?.estimate?.();
    return e ? { usage: e.usage || 0, quota: e.quota || 0 } : null;
  } catch (err) {
    return null;
  }
}

/** Chromium fires this once; hold onto it so an in-app button can install. */
export function watchInstallPrompt(onAvailable) {
  const handler = (ev) => {
    ev.preventDefault();
    onAvailable(ev);
  };
  window.addEventListener("beforeinstallprompt", handler);
  return () => window.removeEventListener("beforeinstallprompt", handler);
}

const STEPS = {
  iphone: {
    label: "iPhone",
    lede: "Open this page in Safari, then:",
    steps: [
      "Tap the Share button at the bottom of the screen — the square with an arrow coming out of it.",
      "Scroll down and tap “Add to Home Screen”.",
      "Tap Add. The ledger now has its own icon.",
    ],
    why: "Open it from that icon from now on, not from a Safari tab. Safari clears saved data for sites you haven't opened in a week; home screen apps are exempt from that.",
  },
  ipad: {
    label: "iPad",
    lede: "Open this page in Safari, then:",
    steps: [
      "Tap the Share button in the top toolbar.",
      "Tap “Add to Home Screen”.",
      "Tap Add.",
    ],
    why: "Open it from that icon from now on. Safari clears saved data for sites you haven't opened in a week; home screen apps are exempt.",
  },
  mac: {
    label: "Mac",
    lede: "In Safari, with this page open:",
    steps: [
      "Choose File in the menu bar, then “Add to Dock”.",
      "Give it a name and click Add.",
      "Open it from the Dock from now on.",
    ],
    why: "A Dock web app keeps its own separate data from Safari — so install it before you import anything, or the import lands in the browser tab instead of the app. In Chrome or Edge, use the install icon in the address bar instead.",
  },
  windows: {
    label: "Windows",
    lede: "In Chrome or Edge, with this page open:",
    steps: [
      "Click the install icon at the right of the address bar — a screen with a downward arrow.",
      "Click Install.",
      "Open it from the Start menu or taskbar from now on.",
    ],
    why: "If you don't see the icon, use the three-dot menu, then Cast, save, and share, then Install page as app.",
  },
  android: {
    label: "Android",
    lede: "In Chrome, with this page open:",
    steps: [
      "Tap the three-dot menu.",
      "Tap “Add to Home screen”, then Install.",
    ],
    why: "Open it from the home screen icon from now on so it runs full screen and keeps working offline.",
  },
  other: {
    label: "your device",
    lede: "Look for an install option in your browser:",
    steps: [
      "Check the address bar for an install icon, or the browser menu for “Install” or “Add to Home screen”.",
    ],
    why: "Installing keeps the app working offline and stops the browser clearing your saved data.",
  },
};

export const installSteps = (platform) => STEPS[platform] || STEPS.other;
