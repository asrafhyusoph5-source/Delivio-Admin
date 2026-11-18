import type {
  PosOrder,
  PosOrderItem,
  PosOrderPayment,
  PosOrderRefund,
  PosPaymentMethod,
  PosShift,
  PosLog,
  PosTeamMember,
  PosSettingsMain
} from '../types';

export const DEFAULT_POS_TIMEZONE = 'Asia/Manila';

export function safePosNumber(val: unknown, fallback = 0): number {
  if (typeof val === 'number') {
    return Number.isFinite(val) ? val : fallback;
  }
  if (typeof val === 'string') {
    const cleaned = val.trim().replace(/[₱,\s]/g, '');
    if (!cleaned) return fallback;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

export function safePosNullableNumber(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') {
    return Number.isFinite(val) ? val : null;
  }
  if (typeof val === 'string') {
    const cleaned = val.trim().replace(/[₱,\s]/g, '');
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function safePosString(val: unknown, fallback = ''): string {
  if (typeof val === 'string') return val.trim();
  if (typeof val === 'number' && Number.isFinite(val)) return String(val);
  return fallback;
}

export function safePosBool(val: unknown, fallback = false): boolean {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') {
    const lower = val.trim().toLowerCase();
    if (lower === 'true' || lower === '1' || lower === 'yes') return true;
    if (lower === 'false' || lower === '0' || lower === 'no') return false;
  }
  if (typeof val === 'number') return val !== 0;
  return fallback;
}

export function safePosDate(val: unknown): Date | null {
  if (!val) return null;
  try {
    if (val instanceof Date) {
      return isNaN(val.getTime()) ? null : val;
    }
    if (typeof (val as { toDate?: () => Date }).toDate === 'function') {
      const d = (val as { toDate: () => Date }).toDate();
      return d instanceof Date && !isNaN(d.getTime()) ? d : null;
    }
    if (typeof val === 'object' && val !== null && 'seconds' in val) {
      const sec = safePosNumber((val as { seconds: unknown }).seconds, NaN);
      if (Number.isFinite(sec)) {
        const ms = sec < 1e11 ? sec * 1000 : sec;
        const d = new Date(ms);
        return isNaN(d.getTime()) ? null : d;
      }
    }
    if (typeof val === 'number' && Number.isFinite(val)) {
      const ms = val > 0 && val < 1e11 ? val * 1000 : val;
      const d = new Date(ms);
      return isNaN(d.getTime()) ? null : d;
    }
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (!trimmed) return null;
      const d = new Date(trimmed);
      return isNaN(d.getTime()) ? null : d;
    }
  } catch {
    return null;
  }
  return null;
}

export function getDateStrInTimeZone(date: Date, timeZone: string = DEFAULT_POS_TIMEZONE): string {
  const tz = timeZone || DEFAULT_POS_TIMEZONE;
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(date);
  } catch {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: DEFAULT_POS_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(date);
    } catch {
      return date.toISOString().slice(0, 10);
    }
  }
}

export function shiftDateStr(yyyyMmDd: string, deltaDays: number): string {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  if (!y || !m || !d) return yyyyMmDd;
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays, 12, 0, 0));
  return dt.toISOString().slice(0, 10);
}

function getTimeZoneOffsetMs(utcRefMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(utcRefMs));
  const map: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== 'literal') {
      map[p.type] = Number(p.value);
    }
  }
  const hour = map.hour === 24 ? 0 : (map.hour || 0);
  const zonedAsUtc = Date.UTC(
    map.year || 1970,
    (map.month || 1) - 1,
    map.day || 1,
    hour,
    map.minute || 0,
    map.second || 0,
    0
  );
  return zonedAsUtc - utcRefMs;
}

export function zonedWallClockToDate(
  yyyyMmDd: string,
  hour: number,
  minute: number,
  second: number,
  ms: number,
  timeZone: string = DEFAULT_POS_TIMEZONE
): Date {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  if (!y || !m || !d) return new Date();
  const tz = timeZone || DEFAULT_POS_TIMEZONE;
  const utcGuess = Date.UTC(y, m - 1, d, hour, minute, second, ms);
  try {
    const offset1 = getTimeZoneOffsetMs(utcGuess, tz);
    const candidate = utcGuess - offset1;
    const offset2 = getTimeZoneOffsetMs(candidate, tz);
    return new Date(utcGuess - offset2);
  } catch {
    // Fallback to UTC+8 (Asia/Manila)
    return new Date(utcGuess - 8 * 60 * 60 * 1000);
  }
}

export type PosDateRangePreset = 'today' | 'yesterday' | '7days' | '30days' | 'custom';

export function resolvePosDateRange(
  preset: PosDateRangePreset,
  timeZone: string = DEFAULT_POS_TIMEZONE,
  customStartStr?: string,
  customEndStr?: string
): { start: Date; end: Date; startStr: string; endStr: string } {
  const todayStr = getDateStrInTimeZone(new Date(), timeZone);
  let startStr = todayStr;
  let endStr = todayStr;

  if (preset === 'today') {
    startStr = todayStr;
    endStr = todayStr;
  } else if (preset === 'yesterday') {
    const yStr = shiftDateStr(todayStr, -1);
    startStr = yStr;
    endStr = yStr;
  } else if (preset === '7days') {
    startStr = shiftDateStr(todayStr, -6);
    endStr = todayStr;
  } else if (preset === '30days') {
    startStr = shiftDateStr(todayStr, -29);
    endStr = todayStr;
  } else {
    startStr = customStartStr && /^\d{4}-\d{2}-\d{2}$/.test(customStartStr) ? customStartStr : todayStr;
    endStr = customEndStr && /^\d{4}-\d{2}-\d{2}$/.test(customEndStr) ? customEndStr : startStr;
    if (startStr > endStr) {
      const tmp = startStr;
      startStr = endStr;
      endStr = tmp;
    }
  }

  return {
    start: zonedWallClockToDate(startStr, 0, 0, 0, 0, timeZone),
    end: zonedWallClockToDate(endStr, 23, 59, 59, 999, timeZone),
    startStr,
    endStr
  };
}

export function normalizePosPaymentMethod(raw: unknown): PosPaymentMethod {
  const s = safePosString(raw).toLowerCase();
  if (s === 'cash') return 'cash';
  if (s === 'gcash') return 'gcash';
  if (s === 'maya' || s === 'paymaya') return 'maya';
  if (s === 'card' || s === 'credit_card' || s === 'debit_card') return 'card';
  return 'other';
}

export function parsePosOrderDoc(id: string, rawData: unknown): PosOrder | null {
  try {
    if (!rawData || typeof rawData !== 'object') return null;
    const d = rawData as Record<string, unknown>;

    const rawItems = Array.isArray(d.items) ? d.items : [];
    const items: PosOrderItem[] = [];
    for (const item of rawItems) {
      try {
        if (!item || typeof item !== 'object') continue;
        const it = item as Record<string, unknown>;
        const name = safePosString(it.name, 'Unnamed item');
        const variantLabel = safePosString(it.variantLabel);
        const unitPrice = Math.max(0, safePosNumber(it.unitPrice, 0));
        const qty = Math.max(0, safePosNumber(it.qty, 1));
        const voided = safePosBool(it.voided, false);
        items.push({
          name,
          ...(variantLabel ? { variantLabel } : {}),
          unitPrice,
          qty,
          voided
        });
      } catch {
        // skip bad item
      }
    }

    const rawPayments = Array.isArray(d.payments) ? d.payments : [];
    const payments: PosOrderPayment[] = [];
    for (const p of rawPayments) {
      try {
        if (!p || typeof p !== 'object') continue;
        const pm = p as Record<string, unknown>;
        const amount = Math.max(0, safePosNumber(pm.amount, 0));
        payments.push({
          method: normalizePosPaymentMethod(pm.method),
          amount
        });
      } catch {
        // skip bad payment
      }
    }

    let refund: PosOrderRefund | null = null;
    if (d.refund && typeof d.refund === 'object') {
      const rf = d.refund as Record<string, unknown>;
      const rfAmt = Math.max(0, safePosNumber(rf.amount, 0));
      const rfReason = safePosString(rf.reason, '');
      const rfAt = safePosDate(rf.at);
      if (rfAmt > 0 || rfReason || rfAt) {
        refund = {
          amount: rfAmt,
          reason: rfReason,
          at: rfAt
        };
      }
    }

    const rawStatus = safePosString(d.status, 'open').toLowerCase();
    const rawType = safePosString(d.type, 'dine_in').toLowerCase();

    return {
      id,
      type: rawType || 'dine_in',
      status: rawStatus || 'open',
      items,
      subtotal: safePosNumber(d.subtotal, 0),
      discountTotal: Math.max(0, safePosNumber(d.discountTotal, 0)),
      serviceCharge: Math.max(0, safePosNumber(d.serviceCharge, 0)),
      vatAmount: Math.max(0, safePosNumber(d.vatAmount, 0)),
      total: safePosNumber(d.total, 0),
      payments,
      tip: Math.max(0, safePosNumber(d.tip, 0)),
      cashierName: safePosString(d.cashierName, '—'),
      shiftId: safePosString(d.shiftId, ''),
      refund,
      paidAt: safePosDate(d.paidAt),
      createdAt: safePosDate(d.createdAt)
    };
  } catch {
    return null;
  }
}

export function parsePosShiftDoc(id: string, rawData: unknown): PosShift | null {
  try {
    if (!rawData || typeof rawData !== 'object') return null;
    const d = rawData as Record<string, unknown>;
    return {
      id,
      cashierName: safePosString(d.cashierName, 'Unknown cashier'),
      openedAt: safePosDate(d.openedAt),
      closedAt: safePosDate(d.closedAt),
      openingCash: safePosNumber(d.openingCash, 0),
      closingCash: safePosNullableNumber(d.closingCash),
      expectedCash: safePosNullableNumber(d.expectedCash),
      variance: safePosNullableNumber(d.variance),
      status: safePosString(d.status, d.closedAt ? 'closed' : 'open').toLowerCase()
    };
  } catch {
    return null;
  }
}

export function parsePosLogDoc(id: string, rawData: unknown): PosLog | null {
  try {
    if (!rawData || typeof rawData !== 'object') return null;
    const d = rawData as Record<string, unknown>;
    return {
      id,
      type: safePosString(d.type, 'other').toLowerCase(),
      amount: safePosNumber(d.amount, 0),
      reason: safePosString(d.reason, ''),
      byName: safePosString(d.byName, '—'),
      approvedBy: safePosString(d.approvedBy, ''),
      at: safePosDate(d.at)
    };
  } catch {
    return null;
  }
}

/**
 * Strictly extracts ONLY display metadata (name, role, active).
 * Never reads, stores, or forwards any PIN/passcode field.
 */
export function parsePosTeamMemberDoc(id: string, rawData: unknown): PosTeamMember | null {
  try {
    if (!rawData || typeof rawData !== 'object') return null;
    const d = rawData as Record<string, unknown>;
    const name = safePosString(d.name || d.displayName || d.fullName, '');
    if (!name) return null;
    const role = safePosString(d.role || d.position, 'cashier');
    const active = d.active === undefined ? true : safePosBool(d.active, true);
    return {
      id,
      name,
      role,
      active
    };
  } catch {
    return null;
  }
}

export function parsePosSettingsDoc(rawData: unknown): PosSettingsMain | null {
  try {
    if (!rawData || typeof rawData !== 'object') return null;
    const d = rawData as Record<string, unknown>;
    const taxObj =
      d.tax && typeof d.tax === 'object' ? (d.tax as Record<string, unknown>) : d;
    const scObj =
      d.serviceCharge && typeof d.serviceCharge === 'object'
        ? (d.serviceCharge as Record<string, unknown>)
        : d;

    const vatEnabled = safePosBool(
      taxObj.vatEnabled ?? taxObj.enabled ?? d.vatRegistered ?? d.taxEnabled,
      false
    );
    const vatPercent = safePosNumber(
      taxObj.vatPercent ?? taxObj.vatRate ?? taxObj.taxRate ?? taxObj.rate ?? d.vatRate,
      12
    );
    const vatMode = safePosString(
      taxObj.vatMode ?? taxObj.mode ?? taxObj.taxMode ?? (vatEnabled ? 'included' : 'none'),
      'included'
    );
    const serviceChargeEnabled = safePosBool(
      scObj.serviceChargeEnabled ?? scObj.enabled ?? false,
      false
    );
    const serviceChargePercent = safePosNumber(
      scObj.serviceChargePercent ?? scObj.rate ?? scObj.percent ?? d.serviceChargeRate,
      0
    );
    const tin = safePosString(d.tin || taxObj.tin, '');
    const taxLabel = safePosString(taxObj.label || taxObj.taxType || d.taxType, '');

    return {
      vatEnabled,
      vatPercent,
      vatMode,
      serviceChargeEnabled,
      serviceChargePercent,
      ...(tin ? { tin } : {}),
      ...(taxLabel ? { taxLabel } : {})
    };
  } catch {
    return null;
  }
}

export function isCountingPosSale(order: PosOrder): boolean {
  const st = order.status.toLowerCase();
  return (st === 'paid' || st === 'refunded') && Boolean(order.paidAt);
}

export function calcPosItemSales(order: PosOrder): number {
  return order.subtotal - order.discountTotal;
}

export function splitPosOrderPayments(order: PosOrder): {
  cash: number;
  gcash: number;
  maya: number;
  eWallet: number;
  card: number;
  other: number;
} {
  let cash = 0;
  let gcash = 0;
  let maya = 0;
  let card = 0;
  let other = 0;

  for (const p of order.payments) {
    const amt = safePosNumber(p.amount, 0);
    if (amt <= 0) continue;
    if (p.method === 'cash') cash += amt;
    else if (p.method === 'gcash') gcash += amt;
    else if (p.method === 'maya') maya += amt;
    else if (p.method === 'card') card += amt;
    else other += amt;
  }

  return {
    cash,
    gcash,
    maya,
    eWallet: gcash + maya,
    card,
    other
  };
}

export function formatPhp(amount: number): string {
  const val = Number.isFinite(amount) ? amount : 0;
  return `₱${val.toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

export function isValidHttpsUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('https://')) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

export async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  onProgress?: (completed: number, total: number) => void
): Promise<R[]> {
  const total = items.length;
  if (total === 0) {
    onProgress?.(0, 0);
    return [];
  }
  const results = new Array<R>(total);
  let nextIndex = 0;
  let completed = 0;
  const limitCount = Math.max(1, Math.min(concurrency, total));

  const runWorker = async () => {
    while (nextIndex < total) {
      const idx = nextIndex++;
      results[idx] = await worker(items[idx], idx);
      completed++;
      onProgress?.(completed, total);
    }
  };

  await Promise.all(Array.from({ length: limitCount }, () => runWorker()));
  return results;
}
