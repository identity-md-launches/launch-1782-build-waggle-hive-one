export const SEAT_COUNT = 2000;
export const DASH = '–';
export type Count = number | null;
export interface Seat {
  tokenId: number;
  attempts: Count;
  accepted: Count;
  rejected: Count;
  failed: Count;
  pending: Count;
  queued: Count;
  last: number | null;
  working: boolean | null;
}
export interface SwarmEvent {
  kind: string | null;
  at: number;
  tokenId: number;
  step: string | null;
  role: string | null;
  state: string | null;
}
export interface Swarm {
  health: { agentsOnline: Count; workingNow: Count; acceptedLastDay: Count; seatsEnrolled: Count };
  counts: { jobs: Count; launchesLive: Count; sites: Count; inferenceTokens: Count };
  seats: Seat[];
  events: SwarmEvent[];
  maxAccepted: number;
  totalAccepted: number;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
export function count(value: unknown): Count {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}
function safeWord(value: unknown): string | null {
  return typeof value === 'string' && /^[a-z][a-z0-9_]{0,39}$/.test(value) ? value : null;
}
function timestamp(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : null;
}

// Copy an explicit allowlist into memory. The response object is never retained.
export function parseSwarm(input: unknown): Swarm {
  const raw = record(input);
  const rawSeats = record(raw?.seats);
  if (!raw || !rawSeats) throw new Error('Missing seats');
  const h = record(raw.health) ?? {};
  const c = record(raw.counts) ?? {};
  const seats = Array.from({ length: SEAT_COUNT }, (_, tokenId): Seat => {
    const seat = record(rawSeats[String(tokenId)]) ?? {};
    return {
      tokenId, attempts: count(seat.attempts), accepted: count(seat.accepted),
      rejected: count(seat.rejected), failed: count(seat.failed), pending: count(seat.pending),
      queued: count(seat.queued), last: timestamp(seat.last),
      working: seat.working === true,
    };
  });
  const events: SwarmEvent[] = [];
  if (Array.isArray(raw.events)) for (const inputEvent of raw.events) {
    const event = record(inputEvent);
    if (!event) continue;
    const id = count(event.tokenId);
    const at = timestamp(event.at);
    if (id === null || !Number.isInteger(id) || id >= SEAT_COUNT || at === null) continue;
    events.push({ tokenId: id, at, kind: safeWord(event.kind), state: safeWord(event.state), role: safeWord(event.role), step: safeWord(event.step) });
  }
  return {
    health: { agentsOnline: count(h.agentsOnline), workingNow: count(h.workingNow), acceptedLastDay: count(h.acceptedLastDay), seatsEnrolled: count(h.seatsEnrolled) },
    counts: { jobs: count(c.jobs), launchesLive: count(c.launchesLive), sites: count(c.sites), inferenceTokens: count(c.inferenceTokens) },
    seats, events: events.sort((a, b) => b.at - a.at).slice(0, 8),
    maxAccepted: Math.max(0, ...seats.map(s => s.accepted ?? 0)),
    totalAccepted: seats.reduce((total, seat) => total + (seat.accepted ?? 0), 0),
  };
}

const fullNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
export function number(value: Count | undefined): string {
  return value == null || !Number.isFinite(value) ? DASH : fullNumber.format(value);
}
export function compact(value: Count | undefined): string {
  if (value == null || !Number.isFinite(value)) return DASH;
  const unit = value >= 1e12 ? [1e12, 'T'] as const : value >= 1e9 ? [1e9, 'B'] as const : value >= 1e6 ? [1e6, 'M'] as const : value >= 1e3 ? [1e3, 'k'] as const : null;
  return unit ? `${Math.round(value / unit[0])}${unit[1]}` : number(value);
}
export function percent(value: number | null): string {
  return value === null || !Number.isFinite(value) ? DASH : `${(value * 100).toFixed(1)}%`;
}
export function seatMetrics(seat: Seat | undefined, swarm: Swarm | null) {
  const accepted = seat?.accepted ?? null;
  const rejected = seat?.rejected ?? null;
  const failed = seat?.failed ?? null;
  const sum = accepted !== null && rejected !== null && failed !== null ? accepted + rejected + failed : null;
  const total = sum !== null && Number.isFinite(sum) ? sum : null;
  return {
    total,
    success: total !== null && total > 0 && accepted !== null ? accepted / total : null,
    rank: accepted !== null && accepted > 0 && swarm
      ? 1 + swarm.seats.filter(s => s.accepted! > accepted).length : null,
    share: accepted !== null && swarm && swarm.totalAccepted > 0 && Number.isFinite(swarm.totalAccepted)
      ? accepted / swarm.totalAccepted : null,
  };
}
export function relativeTime(at: number | null, now = Date.now()): string {
  if (at === null) return 'never';
  const seconds = Math.max(0, (now - at) / 1000);
  if (seconds < 60) return 'just now';
  const [value, unit] = seconds < 3600 ? [Math.floor(seconds / 60), 'minute']
    : seconds < 86400 ? [Math.floor(seconds / 3600), 'hour'] : [Math.floor(seconds / 86400), 'day'];
  return `${number(value)} ${unit}${value === 1 ? '' : 's'} ago`;
}
export function eventText(event: SwarmEvent): string {
  const prefix = `Seat #${event.tokenId}`;
  if (event.kind === 'agent' && event.state === 'joined') return `${prefix} joined the swarm`;
  if (event.kind === 'node' && event.state === 'accepted' && event.role && event.step)
    return `${prefix} had a ${event.role} step accepted: ${event.step.replaceAll('_', ' ')}`;
  if (event.kind === 'node' && event.state === 'working' && event.role)
    return `${prefix} is working on a ${event.role} step`;
  return `${prefix} ${event.state ?? DASH}`;
}
