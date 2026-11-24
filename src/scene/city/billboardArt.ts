import { COMPETITIONS, EXPO, HEARTBEAT, ROBOWARS, SITE, theme, TWMUN, UI, VOICES } from '@/content';
import type { StopId } from '@/lib/chapters';
import { COMPETITION_TAGS, initials, type SpeakerCategory } from '@/lib/stops';

/**
 * What each stop's LED billboard shows, drawn on a 2D canvas (text and shapes only: no
 * images, no logos). The billboard shader turns the canvas into LEDs.
 */

export const ART_W = 1024;
export const ART_H = 576;

export type ArtState = {
  robowarsClass: number;
  competitionFilter: string;
  /** 0..1 progress of the list animation after a filter change. */
  competitionAnim: number;
  previousFilter: string;
  speakerCategory: SpeakerCategory;
  expoIndex: number;
  /** 0..1 heartbeat envelope (DKMS). */
  pulse: number;
};

let display = 'Arial Black, Arial, sans-serif';
/** The page's display face (next/font gives it a generated family name). */
export function resolveFont() {
  if (typeof document === 'undefined') return display;
  const v = getComputedStyle(document.documentElement).getPropertyValue('--font-display').trim();
  if (v) display = `${v}, Arial Black, Arial, sans-serif`;
  return display;
}

const ACCENT = theme.accent;

function fit(ctx: CanvasRenderingContext2D, text: string, weight: number, size: number, maxW: number) {
  let s = size;
  ctx.font = `${weight} ${s}px ${display}`;
  while (ctx.measureText(text).width > maxW && s > 10) {
    s -= 2;
    ctx.font = `${weight} ${s}px ${display}`;
  }
  return s;
}

function base(ctx: CanvasRenderingContext2D, top: string, bottom: string) {
  const g = ctx.createLinearGradient(0, 0, 0, ART_H);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, ART_W, ART_H);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
}

function kicker(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color = ACCENT) {
  ctx.fillStyle = color;
  ctx.font = `700 26px ${display}`;
  ctx.fillText(text.toUpperCase().split('').join(' '), x, y);
}

function chip(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, on: boolean, color = ACCENT) {
  ctx.font = `700 30px ${display}`;
  const w = ctx.measureText(text).width + 44;
  ctx.lineWidth = 4;
  ctx.strokeStyle = on ? color : 'rgba(255,255,255,0.35)';
  ctx.fillStyle = on ? color : 'rgba(255,255,255,0.04)';
  ctx.beginPath();
  ctx.roundRect(x, y - 38, w, 54, 27);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = on ? '#fff' : 'rgba(255,255,255,0.75)';
  ctx.fillText(text, x + 22, y);
  return w;
}

const draw: Record<StopId, (ctx: CanvasRenderingContext2D, s: ArtState) => void> = {
  arrival(ctx) {
    base(ctx, '#140608', '#050306');
    kicker(ctx, SITE.edition, 64, 110);
    const [word, year] = SITE.name.split(' ');
    ctx.fillStyle = '#fff';
    fit(ctx, word.toUpperCase(), 900, 170, 880);
    ctx.fillText(word.toUpperCase(), 60, 290);
    ctx.fillStyle = ACCENT;
    ctx.font = `900 120px ${display}`;
    ctx.fillText(year, 64, 420);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    fit(ctx, SITE.dates, 700, 40, 880);
    ctx.fillText(SITE.dates, 64, 500);
  },
  robowars(ctx, s) {
    base(ctx, '#1a0a02', '#060302');
    kicker(ctx, UI.robowars.kicker, 64, 96, '#ff7a1a');
    ctx.fillStyle = '#fff';
    ctx.font = `900 112px ${display}`;
    ctx.fillText('ROBOWARS', 60, 220);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = `700 28px ${display}`;
    ctx.fillText(UI.robowars.prizeLabel.toUpperCase(), 64, 290);
    ctx.fillStyle = '#ffb04a';
    ctx.font = `900 76px ${display}`;
    ctx.fillText(ROBOWARS.prizePool, 60, 372);
    let x = 64;
    for (const c of ROBOWARS.classes) x += chip(ctx, `${c} KG`, x, 486, c === s.robowarsClass, '#ff6a1a') + 18;
  },
  competitions(ctx, s) {
    base(ctx, '#06101a', '#030508');
    kicker(ctx, UI.competitions.kicker, 64, 90, '#3fd0ff');
    const list = COMPETITIONS.filter((c) => s.competitionFilter === 'All' || c.tag === s.competitionFilter);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = `700 26px ${display}`;
    const tagLine = COMPETITION_TAGS.map((t) => (t === s.competitionFilter ? `[${t.toUpperCase()}]` : t.toUpperCase())).join('  ');
    fit(ctx, tagLine, 700, 26, 900);
    ctx.fillText(tagLine, 64, 136);
    // rows slide up into place after a filter change
    const a = s.competitionAnim;
    list.slice(0, 5).forEach((c, i) => {
      const t = Math.min(1, Math.max(0, a * 1.6 - i * 0.15));
      const e = 1 - (1 - t) * (1 - t);
      const y = 214 + i * 76 + (1 - e) * 40;
      ctx.globalAlpha = e;
      ctx.fillStyle = '#3fd0ff';
      ctx.fillRect(64, y - 42, 8, 50);
      ctx.fillStyle = '#fff';
      fit(ctx, c.name, 800, 44, 600);
      ctx.fillText(c.name, 92, y);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = `700 24px ${display}`;
      ctx.textAlign = 'right';
      ctx.fillText(c.tag.toUpperCase(), ART_W - 64, y);
      ctx.textAlign = 'left';
    });
    ctx.globalAlpha = 1;
  },
  speakers(ctx, s) {
    base(ctx, '#070a1c', '#030409');
    kicker(ctx, UI.speakers.kicker, 64, 90, '#8fa8ff');
    ctx.fillStyle = '#fff';
    fit(ctx, s.speakerCategory.toUpperCase(), 900, 64, 900);
    ctx.fillText(s.speakerCategory.toUpperCase(), 62, 168);
    VOICES.categories[s.speakerCategory].forEach(([name, title], i) => {
      const y = 250 + i * 80;
      ctx.strokeStyle = '#8fa8ff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(96, y - 14, 28, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = `800 22px ${display}`;
      ctx.textAlign = 'center';
      ctx.fillText(initials(name), 96, y - 6);
      ctx.textAlign = 'left';
      fit(ctx, name, 800, 34, 780);
      ctx.fillText(name, 146, y - 10);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      fit(ctx, title, 600, 22, 780);
      ctx.fillText(title, 146, y + 20);
    });
  },
  expo(ctx, s) {
    const ex = EXPO.exhibits[s.expoIndex] ?? EXPO.exhibits[0];
    base(ctx, '#03141a', '#020608');
    kicker(ctx, `${UI.expo.kicker}  ${String(s.expoIndex + 1).padStart(2, '0')} / ${String(EXPO.exhibits.length).padStart(2, '0')}`, 64, 96, '#36f0e0');
    ctx.fillStyle = '#fff';
    fit(ctx, ex.name.toUpperCase(), 900, 110, 900);
    ctx.fillText(ex.name.toUpperCase(), 60, 232);
    ctx.fillStyle = '#36f0e0';
    fit(ctx, ex.from, 700, 40, 900);
    ctx.fillText(ex.from, 64, 300);
    // blurb, wrapped
    ctx.fillStyle = 'rgba(255,255,255,0.78)';
    ctx.font = `600 30px ${display}`;
    const words = ex.blurb.split(' ');
    let line = '';
    let y = 380;
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (ctx.measureText(next).width > 880) {
        ctx.fillText(line, 64, y);
        line = w;
        y += 44;
      } else line = next;
    }
    if (line) ctx.fillText(line, 64, y);
  },
  dkms(ctx, s) {
    base(ctx, '#200a06', '#080302');
    kicker(ctx, HEARTBEAT.campaign, 64, 100, '#ff9a6a');
    ctx.fillStyle = '#fff3ea';
    const head = HEARTBEAT.headline;
    const half = head.lastIndexOf(' ', Math.floor(head.length / 2) + 4);
    fit(ctx, head.slice(0, half), 800, 70, 900);
    ctx.fillText(head.slice(0, half), 62, 230);
    ctx.fillText(head.slice(half + 1), 62, 320);
    // one slow heart line
    ctx.strokeStyle = `rgba(255,140,100,${0.45 + 0.55 * s.pulse})`;
    ctx.lineWidth = 6;
    ctx.beginPath();
    const y0 = 440;
    ctx.moveTo(64, y0);
    ctx.lineTo(420, y0);
    ctx.lineTo(450, y0 - 70 * (0.4 + 0.6 * s.pulse));
    ctx.lineTo(486, y0 + 46);
    ctx.lineTo(512, y0);
    ctx.lineTo(960, y0);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,240,230,0.7)';
    ctx.font = `600 28px ${display}`;
    ctx.fillText(`${HEARTBEAT.stats[2].value} · ${HEARTBEAT.stats[2].label}`, 64, 520);
  },
  twmun(ctx) {
    base(ctx, '#12071e', '#05030a');
    kicker(ctx, UI.twmun.kicker, 64, 90, '#c08aff');
    ctx.fillStyle = '#fff';
    fit(ctx, TWMUN.name.toUpperCase(), 900, 74, 900);
    ctx.fillText(TWMUN.name.toUpperCase(), 60, 180);
    ctx.fillStyle = '#c08aff';
    ctx.font = `700 36px ${display}`;
    ctx.fillText(TWMUN.tagline, 64, 236);
    const codes = TWMUN.committees.map((c) => c.replace(/\s*\(.*\)$/, ''));
    codes.forEach((c, i) => {
      const x = 64 + (i % 4) * 228;
      const y = 330 + Math.floor(i / 4) * 110;
      ctx.strokeStyle = 'rgba(192,138,255,0.8)';
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y - 56, 208, 84);
      ctx.fillStyle = '#fff';
      fit(ctx, c, 800, 34, 180);
      ctx.fillText(c, x + 16, y);
    });
  },
  finale(ctx) {
    base(ctx, '#1a0605', '#050203');
    kicker(ctx, SITE.edition, 64, 110);
    ctx.fillStyle = '#fff';
    fit(ctx, UI.cta.toUpperCase(), 900, 92, 900);
    ctx.fillText(UI.cta.toUpperCase(), 60, 280);
    ctx.fillStyle = ACCENT;
    ctx.font = `900 70px ${display}`;
    ctx.fillText(SITE.dates, 62, 400);
  },
};

export function drawStop(id: StopId, ctx: CanvasRenderingContext2D, s: ArtState) {
  ctx.save();
  draw[id](ctx, s);
  ctx.restore();
}
