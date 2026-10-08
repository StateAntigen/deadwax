/**
 * Offline mode: what this phone does when no computer can be reached.
 *
 * Two things put this phone here, and they are not the same thing. The phone may
 * have no network at all — Wi-Fi off, out of service, camping — which only the
 * Android bridge can see. Or the phone has a network and no computer of its own
 * answers, which is what the status question says. The person may also simply
 * choose it, because they know they are about to be without signal and would
 * rather see what they hold than a library that cannot play.
 *
 * What the mode buys is a screen that never waits on anybody: the library is the
 * cache, a track that is not in it says so at once instead of holding the app for
 * a timeout, and a search reads the cache instead of the network.
 */
export const OFFLINE_MODE_KEY = 'napstrfy-offline-mode';

/** Whether the person has asked this phone to stay on what it holds. */
export function readOfflineMode(): boolean {
  try {
    return window.localStorage.getItem(OFFLINE_MODE_KEY) === 'true';
  } catch {
    // A phone that will not read its own storage is one where the automatic
    // reasons for being offline still apply, which is the part that matters.
    return false;
  }
}

export function storeOfflineMode(enabled: boolean) {
  try {
    window.localStorage.setItem(OFFLINE_MODE_KEY, enabled ? 'true' : 'false');
  } catch {
    // As above: the choice lasts this session and the automatic reasons remain.
  }
}

/**
 * The cache sizes Settings offers, in bytes.
 *
 * A short list rather than a free number: the useful answers are "roughly an
 * album", "roughly a day" and "as much as fits", and a slider over three orders
 * of magnitude is a way of choosing the wrong one by accident. The floor is the
 * app's own, so a size below it is not offered rather than silently raised.
 */
export const CACHE_SIZE_CHOICES: { bytes: number; label: string }[] = [
  { bytes: 500 * 1024 * 1024, label: '500 MB' },
  { bytes: 1 * 1024 * 1024 * 1024, label: '1 GB' },
  { bytes: 2 * 1024 * 1024 * 1024, label: '2 GB' },
  { bytes: 4 * 1024 * 1024 * 1024, label: '4 GB' },
  { bytes: 8 * 1024 * 1024 * 1024, label: '8 GB' }
];

/** A size in words, for the cache sheet's own line of text. */
export function readableBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const megabytes = bytes / 1024 / 1024;
  if (megabytes < 1000) return `${Math.round(megabytes)} MB`;
  const gigabytes = megabytes / 1024;
  // One decimal only while the tenth still means something: "3.0 GB" beside a
  // 2 GB choice reads as a different number rather than the same one.
  return `${gigabytes >= 10 ? Math.round(gigabytes) : gigabytes.toFixed(1)} GB`;
}
