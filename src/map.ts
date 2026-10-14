import { SEAT_COUNT, number, type Swarm } from './data';
import { geometry, center, hitTest, keyboardSeat, type Geometry } from './geometry';

export class HiveMap {
  private canvas: HTMLCanvasElement;
  private layer: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;
  private glowContext: CanvasRenderingContext2D;
  private scroller: HTMLElement;
  private tooltip: HTMLElement;
  private g: Geometry;
  private data: Swarm | null = null;
  private selected: number | null = null;
  private ratio = 1;
  private palette = { ember: '', outline: '', text: '' };
  private timer: ReturnType<typeof setInterval> | null = null;
  private motion = matchMedia('(prefers-reduced-motion: reduce)');
  private theme = matchMedia('(prefers-color-scheme: dark)');
  private resolution!: MediaQueryList;
  private working: number[] = [];
  private phase = 0;
  private intersectionVisible = true;

  constructor(private onSelect: (id: number, open: boolean) => void, private onClose: () => void) {
    this.canvas = document.querySelector<HTMLCanvasElement>('#seat-map')!;
    this.layer = document.querySelector<HTMLCanvasElement>('#working-layer')!;
    this.context = this.canvas.getContext('2d')!;
    this.glowContext = this.layer.getContext('2d')!;
    this.scroller = document.querySelector('#map-scroll')!;
    this.tooltip = document.querySelector('#map-tooltip')!;
    this.g = geometry(this.canvas.getBoundingClientRect().width);
    this.readPalette();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(this.canvas.parentElement!);
    new IntersectionObserver(([entry]) => { this.intersectionVisible = entry.isIntersecting; this.configurePulse(); }).observe(this.scroller);
    this.watchRatio();
    this.theme.addEventListener('change', () => { this.readPalette(); this.draw(); });
    this.motion.addEventListener('change', () => this.configurePulse());
    document.addEventListener('visibilitychange', () => this.configurePulse());
    this.canvas.addEventListener('click', (event) => {
      const bounds = this.canvas.getBoundingClientRect();
      const id = hitTest(event.clientX - bounds.left, event.clientY - bounds.top, this.g);
      if (id !== null) { this.canvas.focus({ preventScroll: true }); this.onSelect(id, true); }
    });
    this.canvas.addEventListener('pointermove', event => this.hover(event));
    this.canvas.addEventListener('pointerleave', () => { this.tooltip.hidden = true; });
    this.scroller.addEventListener('scroll', () => { this.tooltip.hidden = true; }, { passive: true });
    this.canvas.addEventListener('focus', () => { if (this.selected === null) this.onSelect(0, false); });
    this.canvas.addEventListener('keydown', event => {
      const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'];
      if (keys.includes(event.key)) {
        event.preventDefault();
        const id = keyboardSeat(this.selected ?? 0, event.key, this.g.cols);
        this.onSelect(id, false);
        this.reveal(id, false);
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault(); this.onSelect(this.selected ?? 0, true);
      } else if (event.key === 'Escape') { event.preventDefault(); this.onClose(); }
    });
  }

  update(data: Swarm | null) {
    this.data = data;
    this.working = data?.seats.filter(s => s.working).map(s => s.tokenId) ?? [];
    this.draw(); this.configurePulse();
  }
  select(id: number | null) {
    if (id === this.selected) return;
    this.selected = id; this.draw();
  }
  reveal(id: number, scrollPage = true) {
    const p = center(id, this.g);
    this.scroller.scrollTop = Math.max(0, p.y - this.scroller.clientHeight / 2);
    if (scrollPage) this.scroller.scrollIntoView({ behavior: 'instant', block: 'center' });
  }
  focus() { this.canvas.focus({ preventScroll: true }); }
  private readPalette() {
    const style = getComputedStyle(document.documentElement);
    this.palette = { ember: style.getPropertyValue('--ember').trim(), outline: style.getPropertyValue('--idle-stroke').trim(), text: style.getPropertyValue('--text').trim() };
  }
  private watchRatio = () => {
    this.resolution?.removeEventListener('change', this.watchRatio);
    this.resolution = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
    this.resolution.addEventListener('change', this.watchRatio, { once: true });
    this.resize();
  };
  private resize() {
    const width = this.canvas.parentElement!.getBoundingClientRect().width;
    const ratio = Math.min(3, devicePixelRatio || 1);
    if (width <= 0) return;
    const g = geometry(width);
    if (this.canvas.width === Math.round(width * ratio) && this.canvas.height === Math.round(g.height * ratio) && ratio === this.ratio) return;
    this.g = g; this.ratio = ratio;
    for (const canvas of [this.canvas, this.layer]) {
      canvas.width = Math.round(g.width * ratio);
      canvas.height = Math.round(g.height * ratio);
      canvas.style.height = `${g.height}px`;
      canvas.getContext('2d')!.setTransform(ratio, 0, 0, ratio, 0, 0);
    }
    this.draw();
    if (this.selected !== null) this.reveal(this.selected, false);
  }
  private hex(ctx: CanvasRenderingContext2D, id: number, scale = 0.9) {
    const { x, y } = center(id, this.g);
    const r = this.g.radius * scale;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 3 * i - Math.PI / 2;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }
  private draw() {
    const ctx = this.context;
    ctx.clearRect(0, 0, this.g.width, this.g.height);
    ctx.lineWidth = 0.65;
    for (let id = 0; id < SEAT_COUNT; id++) {
      const accepted = this.data?.seats[id].accepted ?? 0;
      this.hex(ctx, id);
      if (accepted > 0 && this.data?.maxAccepted) {
        const t = Math.log10(accepted + 1) / Math.log10(this.data.maxAccepted + 1);
        ctx.fillStyle = this.palette.ember;
        ctx.globalAlpha = 0.18 + 0.57 * t; ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = accepted > 0 ? this.palette.ember : this.palette.outline;
      ctx.globalAlpha = accepted > 0 ? 0.3 : 1;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    if (this.selected !== null) {
      this.hex(ctx, this.selected, 1.04);
      ctx.lineWidth = 1.8; ctx.strokeStyle = this.palette.text; ctx.stroke();
    }
    this.drawWorking();
  }
  private drawWorking() {
    const ctx = this.glowContext;
    ctx.clearRect(0, 0, this.g.width, this.g.height);
    const pulse = this.motion.matches ? 0.6 : (Math.sin(this.phase * 2 * Math.PI / 1600) + 1) / 2;
    ctx.fillStyle = this.palette.ember;
    ctx.shadowColor = this.palette.ember;
    ctx.shadowBlur = 3 + pulse * 5;
    for (const id of this.working) { this.hex(ctx, id, 0.83); ctx.fill(); }
    ctx.shadowBlur = 0;
    // Keep the selection ring above the working glow.
    if (this.selected !== null && this.working.includes(this.selected)) {
      this.hex(ctx, this.selected, 1.04);
      ctx.lineWidth = 1.8; ctx.strokeStyle = this.palette.text; ctx.stroke();
    }
  }
  private configurePulse() {
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
    this.drawWorking();
    if (!this.motion.matches && !document.hidden && this.intersectionVisible && this.working.length > 0) {
      this.timer = setInterval(() => { this.phase = (this.phase + 120) % 1600; this.drawWorking(); }, 120);
    }
  }
  private hover(event: PointerEvent) {
    if (event.pointerType !== 'mouse' || !matchMedia('(hover: hover)').matches) return;
    const bounds = this.canvas.getBoundingClientRect();
    const id = hitTest(event.clientX - bounds.left, event.clientY - bounds.top, this.g);
    this.tooltip.hidden = id === null;
    if (id === null) return;
    this.tooltip.textContent = `Seat #${id}, ${number(this.data?.seats[id].accepted)} accepted`;
    const card = this.tooltip.parentElement!.getBoundingClientRect();
    const x = Math.min(event.clientX - card.left + 12, card.width - this.tooltip.offsetWidth - 16);
    this.tooltip.style.left = `${Math.max(16, x)}px`;
    this.tooltip.style.top = `${Math.max(16, event.clientY - card.top - 44)}px`;
  }
}
