import { compact, DASH, eventText, number, percent, relativeTime, SEAT_COUNT, seatMetrics, type Swarm } from './data';
import { HiveMap } from './map';
import { startPolling } from './poll';

function element<T extends HTMLElement = HTMLElement>(id: string): T { return document.getElementById(id)! as T; }
function text(id: string, content: string) { element(id).textContent = content; }
let swarm: Swarm | null = null;
let selected: number | null = null;
let panelOpen = false;
const panel = element('seat-panel');
// On phones the open panel sticks to the bottom; the map should stay visible above it.
const map = new HiveMap(select, closePanel, () => panelOpen && getComputedStyle(panel).position === 'sticky' ? panel.getBoundingClientRect().top : innerHeight);

function announce() {
  if (selected === null) return;
  const working = swarm?.seats[selected].working;
  text('seat-announcement', `Seat #${selected}, ${working === true ? 'working' : working === false ? 'idle' : 'status unavailable'}`);
}
function select(id: number, open = true) {
  selected = id;
  if (open) panelOpen = true;
  map.select(id);
  renderPanel();
  announce();
  document.querySelectorAll<HTMLButtonElement>('.busiest-row').forEach(button => {
    const active = button.dataset.seat === String(id);
    button.classList.toggle('is-selected', active);
    button.setAttribute('aria-pressed', String(active));
  });
}
function closePanel() {
  const focusedInside = panel.contains(document.activeElement);
  panelOpen = false;
  renderPanel();
  if (focusedInside) map.focus();
}
function openAndReveal(id: number) { select(id); map.reveal(id); }

function renderPanel() {
  element('panel-empty').hidden = panelOpen;
  element('panel-details').hidden = !panelOpen;
  panel.classList.toggle('is-open', panelOpen);
  panel.setAttribute('aria-labelledby', panelOpen ? 'agent-title' : 'empty-title');
  if (!panelOpen || selected === null) return;
  const seat = swarm?.seats[selected];
  const metrics = seatMetrics(seat, swarm);
  text('agent-title', `Agent #${selected}`);
  text('agent-status', seat?.working === true ? 'Working' : seat?.working === false ? 'Idle' : DASH);
  element('agent-status').classList.toggle('is-working', seat?.working === true);
  text('agent-accepted', number(seat?.accepted));
  text('agent-rejected', number(seat?.rejected));
  text('agent-failed', number(seat?.failed));
  text('agent-success', percent(metrics.success));
  text('agent-rank', metrics.rank === null ? `${DASH} of 2,000 by accepted work` : `#${metrics.rank} of 2,000 by accepted work`);
  text('agent-share', percent(metrics.share));
  text('agent-last', seat ? relativeTime(seat.last) : DASH);
  for (const key of ['accepted', 'rejected', 'failed'] as const) {
    const value = seat?.[key];
    const width = value != null && metrics.total !== null && metrics.total > 0 && Number.isFinite(metrics.total) ? value / metrics.total * 100 : 0;
    element(`${key}-bar`).style.width = `${width}%`;
  }
  element<HTMLButtonElement>('previous-seat').disabled = selected === 0;
  element<HTMLButtonElement>('next-seat').disabled = selected === SEAT_COUNT - 1;
  element<HTMLAnchorElement>('explorer-link').href = `https://explorer.imd.fun/agents/${selected}`;
}

function renderBusiest() {
  const list = element('busiest-list');
  const leaders = swarm?.seats.filter(s => s.accepted !== null && s.accepted > 0)
    .sort((a, b) => b.accepted! - a.accepted! || a.tokenId - b.tokenId).slice(0, 10) ?? [];
  element('busiest-empty').hidden = leaders.length > 0;
  if (swarm && leaders.length === 0) text('busiest-empty', 'No accepted work to show yet.');
  // Reuse keyed buttons so a refresh never discards keyboard focus.
  const existing = new Map(Array.from(list.children).map(li => [(li as HTMLElement).dataset.seat, li]));
  for (const [index, seat] of leaders.entries()) {
    const id = String(seat.tokenId);
    let li = existing.get(id) as HTMLLIElement | undefined;
    if (!li) {
      li = document.createElement('li'); li.dataset.seat = id;
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'busiest-row'; button.dataset.seat = id;
      const rank = document.createElement('span'); rank.className = 'row-rank';
      const chip = document.createElement('span'); chip.className = 'seat-chip';
      const bar = document.createElement('span'); bar.className = 'mini-bar'; bar.setAttribute('aria-hidden', 'true');
      const fill = document.createElement('span'); fill.className = 'mini-bar-fill'; bar.append(fill);
      const count = document.createElement('span');
      button.append(rank, chip, bar, count); li.append(button);
      button.addEventListener('click', () => openAndReveal(seat.tokenId));
    }
    const button = li.firstElementChild as HTMLButtonElement;
    button.children[0].textContent = String(index + 1).padStart(2, '0');
    button.children[1].textContent = `#${seat.tokenId}`;
    (button.querySelector('.mini-bar-fill') as HTMLElement).style.width = `${seat.accepted! / (swarm?.maxAccepted || 1) * 100}%`;
    button.children[3].textContent = number(seat.accepted);
    button.setAttribute('aria-label', `Seat #${seat.tokenId}, ${number(seat.accepted)} accepted`);
    button.setAttribute('aria-pressed', String(selected === seat.tokenId));
    button.classList.toggle('is-selected', selected === seat.tokenId);
    const current = list.children[index];
    if (current !== li) list.insertBefore(li, current ?? null);
    existing.delete(id);
  }
  for (const li of existing.values()) li.remove();
}

function renderEvents() {
  const list = element('events-list');
  const events = swarm?.events ?? [];
  element('events-empty').hidden = events.length > 0;
  const focused = document.activeElement;
  const restoreId = focused instanceof HTMLButtonElement && list.contains(focused) ? focused.dataset.seat : null;
  const fragment = document.createDocumentFragment();
  for (const event of events) {
    const item = document.createElement('li'); item.className = 'event';
    const button = document.createElement('button'); button.type = 'button'; button.className = 'seat-chip';
    button.textContent = `#${event.tokenId}`; button.dataset.seat = String(event.tokenId);
    button.setAttribute('aria-label', `Open seat #${event.tokenId}`);
    button.addEventListener('click', () => openAndReveal(event.tokenId));
    const content = document.createElement('div'); content.className = 'event-text';
    const description = document.createElement('p'); description.textContent = eventText(event);
    const time = document.createElement('time'); time.dateTime = new Date(event.at).toISOString(); time.dataset.at = String(event.at);
    time.textContent = relativeTime(event.at); content.append(description, time); item.append(button, content); fragment.append(item);
  }
  list.replaceChildren(fragment);
  if (restoreId !== null) {
    const replacement = Array.from(list.querySelectorAll<HTMLButtonElement>('button')).find(b => b.dataset.seat === restoreId);
    if (replacement) replacement.focus({ preventScroll: true });
    else map.focus();
  }
}

element('seat-form').addEventListener('submit', event => {
  event.preventDefault();
  const input = element<HTMLInputElement>('seat-number');
  const id = input.valueAsNumber;
  if (!Number.isInteger(id) || id < 0 || id >= SEAT_COUNT) {
    input.setAttribute('aria-invalid', 'true');
    text('seat-error', 'Choose a seat from 0 to 1999.'); element('seat-error').hidden = false;
    input.focus(); return;
  }
  input.removeAttribute('aria-invalid'); element('seat-error').hidden = true;
  openAndReveal(id); map.focus();
});
element('close-panel').addEventListener('click', closePanel);
element('previous-seat').addEventListener('click', () => { if (selected !== null && selected > 0) { select(selected - 1); map.reveal(selected!, false); } });
element('next-seat').addEventListener('click', () => { if (selected !== null && selected < SEAT_COUNT - 1) { select(selected + 1); map.reveal(selected!, false); } });
panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); closePanel(); } });

startPolling(data => {
  swarm = data;
  const { health, counts } = data;
  text('agents-online', number(health.agentsOnline)); text('working-now', number(health.workingNow));
  text('accepted-today', number(health.acceptedLastDay)); text('seats-enrolled', number(health.seatsEnrolled));
  text('jobs', compact(counts.jobs)); text('launches', compact(counts.launchesLive)); text('sites', compact(counts.sites)); text('tokens', compact(counts.inferenceTokens));
  element('working-dot').classList.toggle('is-working', health.workingNow !== null && health.workingNow > 0);
  for (const [id, value] of Object.entries({ jobs: counts.jobs, launches: counts.launchesLive, sites: counts.sites, tokens: counts.inferenceTokens })) element(id).title = number(value);
  element('fetch-note').hidden = true;
  text('sync-label', `Updated ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`);
  map.update(data); renderPanel(); renderBusiest(); renderEvents(); announce();
}, () => {
  text('fetch-note', "We couldn't reach the swarm. Showing the last map we had.");
  element('fetch-note').hidden = false;
  text('sync-label', swarm ? 'Last known state' : 'Waiting for the swarm');
  // Retained data keeps ageing: refresh the relative times without touching counts or the map.
  renderPanel();
  for (const time of element('events-list').querySelectorAll('time')) time.textContent = relativeTime(Number(time.dataset.at));
}, hidden => { document.documentElement.dataset.hidden = String(hidden); });
