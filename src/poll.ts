import { parseSwarm, type Swarm } from './data';
export const ENDPOINT = 'https://api.imd.fun/swarm';
export const REFRESH_MS = 30_000;
export const TIMEOUT_MS = 15_000;

export function startPolling(onData: (data: Swarm) => void, onError: () => void, onVisibility: (hidden: boolean) => void) {
  let lastStarted = -Infinity;
  let inFlight = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  function schedule() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (!document.hidden) timer = setTimeout(() => void refresh(), Math.max(1, REFRESH_MS - (Date.now() - lastStarted)));
  }
  async function refresh() {
    if (document.hidden || inFlight) return;
    if (Date.now() - lastStarted < REFRESH_MS) { schedule(); return; }
    lastStarted = Date.now();
    inFlight = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(ENDPOINT, { signal: controller.signal, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
      if (!response.ok) throw new Error('Swarm unavailable');
      onData(parseSwarm(await response.json()));
    } catch { onError(); }
    finally { clearTimeout(timeout); inFlight = false; schedule(); }
  }
  document.addEventListener('visibilitychange', () => {
    onVisibility(document.hidden);
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (!document.hidden && !inFlight) {
      if (Date.now() - lastStarted >= REFRESH_MS) void refresh();
      else schedule();
    }
  });
  onVisibility(document.hidden);
  void refresh();
}
