import type {
  ScheduleSession,
  ScheduleSessionRewards,
  SessionClaimBreakdown,
  OrderServiceType
} from '../types';
import { parseDate } from './date';

export const SLOT_DURATION_MS = 900_000; // 15 minutes

export const SESSION_REWARD_EMOJI_PICKS = ['⚡', '👑', '☂️', '🧳', '🔥', '💰', '🌧️', '🎁'] as const;

export const WEEKDAY_OPTIONS: { dayIndex: number; label: string; short: string }[] = [
  { dayIndex: 0, label: 'Sunday', short: 'Sun' },
  { dayIndex: 1, label: 'Monday', short: 'Mon' },
  { dayIndex: 2, label: 'Tuesday', short: 'Tue' },
  { dayIndex: 3, label: 'Wednesday', short: 'Wed' },
  { dayIndex: 4, label: 'Thursday', short: 'Thu' },
  { dayIndex: 5, label: 'Friday', short: 'Fri' },
  { dayIndex: 6, label: 'Saturday', short: 'Sat' }
];

/**
 * Generates 15-minute increment HH:mm options for start/end dropdowns.
 */
export function generate15MinOptions(includeEndOfDay = false): string[] {
  const opts: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      opts.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }
  if (includeEndOfDay) {
    opts.push('24:00');
  }
  return opts;
}

export function formatTimeDisplay12h(hhmm: string): string {
  if (hhmm === '24:00') return '12:00 AM (next day)';
  const [hStr, mStr] = hhmm.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

export function getTodayPhtDateStr(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

export function addDaysPhtDateStr(dateStr: string, offsetDays: number): string {
  const base = new Date(`${dateStr}T12:00:00+08:00`);
  const next = new Date(base.getTime() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(next);
}

export function getPhtWeekdayIndex(dateStr: string): number {
  const d = new Date(`${dateStr}T12:00:00+08:00`);
  const name = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    weekday: 'short'
  }).format(d);
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6
  };
  return map[name] ?? d.getDay();
}

export function makePhtTimestampDate(dateStr: string, hhmm: string): Date {
  if (hhmm === '24:00') {
    const nextDate = addDaysPhtDateStr(dateStr, 1);
    return new Date(`${nextDate}T00:00:00+08:00`);
  }
  return new Date(`${dateStr}T${hhmm}:00+08:00`);
}

export function extractPhtDateAndTime(ts: any): { dateStr: string; hhmm: string } {
  const d = parseDate(ts);
  if (!d) return { dateStr: getTodayPhtDateStr(), hhmm: '09:00' };
  const dateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(d);
  let hour = parts.find((p) => p.type === 'hour')?.value || '00';
  if (hour === '24') hour = '00';
  const minute = parts.find((p) => p.type === 'minute')?.value || '00';
  return { dateStr, hhmm: `${hour}:${minute}` };
}

export function formatPhtWindow(startTs: any, endTs: any): {
  dateLabel: string;
  timeRange: string;
  durationMin: number;
} {
  const s = parseDate(startTs);
  const e = parseDate(endTs);
  if (!s || !e) return { dateLabel: '—', timeRange: '—', durationMin: 0 };

  const dateLabel = new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(s);

  const fmtTime = (dt: Date) =>
    new Intl.DateTimeFormat('en-PH', {
      timeZone: 'Asia/Manila',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).format(dt);

  const durationMin = Math.max(0, Math.round((e.getTime() - s.getTime()) / 60_000));
  return {
    dateLabel,
    timeRange: `${fmtTime(s)} – ${fmtTime(e)}`,
    durationMin
  };
}

/**
 * Returns every 15-minute slot index in [startAt, endAt):
 * riderSlots/{riderUid}_{floor(epochMillis / 900000)}
 */
export function getSessionSlotIndices(startTs: any, endTs: any): number[] {
  const s = parseDate(startTs);
  const e = parseDate(endTs);
  if (!s || !e) return [];
  const startMs = s.getTime();
  const endMs = e.getTime();
  if (endMs <= startMs) return [];

  const indices: number[] = [];
  for (let t = startMs; t < endMs; t += SLOT_DURATION_MS) {
    indices.push(Math.floor(t / SLOT_DURATION_MS));
  }
  return indices;
}

export function getRiderSlotDocId(riderUid: string, slotIndex: number): string {
  return `${riderUid}_${slotIndex}`;
}

/**
 * Validates that input contains exactly one grapheme cluster and that it is an emoji
 * (not plain ASCII letters/digits/punctuation).
 */
export function isSingleEmoji(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;

  let graphemes: string[];
  if (typeof Intl !== 'undefined' && (Intl as any).Segmenter) {
    const Segmenter = (Intl as any).Segmenter;
    const seg = new Segmenter('en', { granularity: 'grapheme' });
    graphemes = Array.from(seg.segment(trimmed), (s: any) => s.segment);
  } else {
    graphemes = Array.from(trimmed);
  }

  if (graphemes.length !== 1) return false;
  const g = graphemes[0];

  // Reject pure ASCII alphanumeric/whitespace/punctuation
  if (/^[\x20-\x7E]+$/.test(g)) return false;

  return /(\p{Extended_Pictographic}|\p{Emoji_Presentation})/u.test(g);
}

export function hasAnyRewardValue(r?: Partial<ScheduleSessionRewards> | null): boolean {
  if (!r) return false;
  if ((Number(r.perDelivery) || 0) > 0) return true;
  if ((Number(r.streakEvery) || 0) > 0 && (Number(r.streakBonus) || 0) > 0) return true;
  if ((Number(r.completionTarget) || 0) > 0 && (Number(r.completionBonus) || 0) > 0) return true;
  if ((Number(r.minEarnings) || 0) > 0) return true;
  if ((Number(r.multiplier) || 0) > 1) return true;
  if ((Number(r.coins) || 0) > 0) return true;
  if ((Number(r.onlineBonus) || 0) > 0) return true;
  return false;
}

export function buildCleanRewardsPayload(
  draft: Partial<ScheduleSessionRewards>
): ScheduleSessionRewards | undefined {
  if (!hasAnyRewardValue(draft)) return undefined;

  const clean: ScheduleSessionRewards = {
    emoji: String(draft.emoji || '').trim()
  };

  if ((Number(draft.perDelivery) || 0) > 0) clean.perDelivery = Number(draft.perDelivery);
  if ((Number(draft.streakEvery) || 0) > 0 && (Number(draft.streakBonus) || 0) > 0) {
    clean.streakEvery = Math.round(Number(draft.streakEvery));
    clean.streakBonus = Number(draft.streakBonus);
  }
  if ((Number(draft.completionTarget) || 0) > 0 && (Number(draft.completionBonus) || 0) > 0) {
    clean.completionTarget = Math.round(Number(draft.completionTarget));
    clean.completionBonus = Number(draft.completionBonus);
  }
  if ((Number(draft.minEarnings) || 0) > 0) {
    clean.minEarnings = Number(draft.minEarnings);
  }
  if ((Number(draft.multiplier) || 0) > 1) {
    clean.multiplier = Math.round(Number(draft.multiplier) * 10) / 10;
  }
  if ((Number(draft.coins) || 0) > 0) {
    clean.coins = Math.round(Number(draft.coins));
  }
  if ((Number(draft.onlineBonus) || 0) > 0) {
    clean.onlineBonus = Number(draft.onlineBonus);
    clean.onlineMinPercent =
      Number(draft.onlineMinPercent) > 0 ? Math.min(100, Number(draft.onlineMinPercent)) : 80;
  } else if ((Number(draft.minEarnings) || 0) > 0 && Number(draft.onlineMinPercent) > 0) {
    clean.onlineMinPercent = Math.min(100, Number(draft.onlineMinPercent));
  }

  if (Array.isArray(draft.services) && draft.services.length > 0) {
    clean.services = draft.services as OrderServiceType[];
  }
  if (draft.note && draft.note.trim()) {
    clean.note = draft.note.trim();
  }

  return clean;
}

export function calculateSessionClaimRewards(params: {
  session: ScheduleSession;
  deliveries: number;
  earned: number;
  onlineMinutes: number;
}): {
  bonusTotal: number;
  breakdown: SessionClaimBreakdown;
} {
  const { session, deliveries, earned, onlineMinutes } = params;
  const r = session.rewards;
  const startD = parseDate(session.startAt);
  const endD = parseDate(session.endAt);
  const sessionDurationMin =
    startD && endD ? Math.max(0, Math.round((endD.getTime() - startD.getTime()) / 60_000)) : 0;

  const onlinePercent =
    sessionDurationMin > 0
      ? Math.min(100, Math.round((Math.max(0, onlineMinutes) / sessionDurationMin) * 1000) / 10)
      : 0;

  if (!r) {
    return {
      bonusTotal: 0,
      breakdown: {
        perDelivery: 0,
        streak: 0,
        completion: 0,
        minEarningsTopUp: 0,
        multiplierExtra: 0,
        onlineBonus: 0,
        coins: 0,
        recomputedDeliveries: deliveries,
        recomputedEarned: Math.round(earned * 100) / 100,
        onlineMinutes,
        onlinePercent
      }
    };
  }

  const requiredOnlinePct = r.onlineMinPercent && r.onlineMinPercent > 0 ? r.onlineMinPercent : 80;
  const stayedOnlineEnough = onlinePercent >= requiredOnlinePct;

  const perDelivery =
    (r.perDelivery || 0) > 0 ? Math.round(deliveries * Number(r.perDelivery) * 100) / 100 : 0;

  const streak =
    (r.streakEvery || 0) > 0 && (r.streakBonus || 0) > 0
      ? Math.round(Math.floor(deliveries / Number(r.streakEvery)) * Number(r.streakBonus) * 100) / 100
      : 0;

  const completion =
    (r.completionTarget || 0) > 0 &&
    (r.completionBonus || 0) > 0 &&
    deliveries >= Number(r.completionTarget)
      ? Number(r.completionBonus)
      : 0;

  const multiplierExtra =
    (r.multiplier || 0) > 1
      ? Math.round((Number(r.multiplier) - 1) * earned * 100) / 100
      : 0;

  const minEarningsTopUp =
    (r.minEarnings || 0) > 0 && stayedOnlineEnough && earned < Number(r.minEarnings)
      ? Math.round((Number(r.minEarnings) - earned) * 100) / 100
      : 0;

  const onlineBonus =
    (r.onlineBonus || 0) > 0 && stayedOnlineEnough ? Number(r.onlineBonus) : 0;

  const coins =
    (r.coins || 0) > 0 && (deliveries > 0 || onlineMinutes > 0) ? Math.round(Number(r.coins)) : 0;

  const bonusTotal =
    Math.round(
      (perDelivery + streak + completion + multiplierExtra + minEarningsTopUp + onlineBonus) * 100
    ) / 100;

  return {
    bonusTotal,
    breakdown: {
      perDelivery,
      streak,
      completion,
      minEarningsTopUp,
      multiplierExtra,
      onlineBonus,
      coins,
      recomputedDeliveries: deliveries,
      recomputedEarned: Math.round(earned * 100) / 100,
      onlineMinutes,
      onlinePercent
    }
  };
}

export function isWithinFivePercent(appValue: number, recomputedValue: number): boolean {
  const maxVal = Math.max(Math.abs(appValue), Math.abs(recomputedValue));
  if (maxVal === 0) return true;
  return Math.abs(appValue - recomputedValue) / maxVal <= 0.05;
}
