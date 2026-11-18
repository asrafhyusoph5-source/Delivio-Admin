import React, { useState, useEffect, useMemo } from 'react';
import {
  db,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  getDoc,
  doc,
  Timestamp
} from '../../firebase';
import { formatTimestamp, formatRelativeTime } from '../../utils/date';
import {
  DEFAULT_POS_TIMEZONE,
  PosDateRangePreset,
  resolvePosDateRange,
  getDateStrInTimeZone,
  parsePosOrderDoc,
  parsePosShiftDoc,
  parsePosLogDoc,
  parsePosTeamMemberDoc,
  parsePosSettingsDoc,
  isCountingPosSale,
  calcPosItemSales,
  splitPosOrderPayments,
  formatPhp
} from '../../utils/posUtils';
import type {
  Merchant,
  PosOrder,
  PosShift,
  PosLog,
  PosTeamMember,
  PosSettingsMain
} from '../../types';
import {
  Receipt,
  CreditCard,
  Banknote,
  Smartphone,
  Clock,
  Users,
  ShieldCheck,
  Loader2,
  Calendar,
  ShoppingBag,
  RotateCw,
  AlertTriangle,
  Percent
} from 'lucide-react';

interface MerchantPosTabProps {
  merchant: Merchant;
  platformTimezone?: string;
}

export const MerchantPosTab: React.FC<MerchantPosTabProps> = ({
  merchant,
  platformTimezone = DEFAULT_POS_TIMEZONE
}) => {
  const tz = platformTimezone || DEFAULT_POS_TIMEZONE;

  const [preset, setPreset] = useState<PosDateRangePreset>('7days');
  const [customStart, setCustomStart] = useState<string>(() => resolvePosDateRange('7days', tz).startStr);
  const [customEnd, setCustomEnd] = useState<string>(() => resolvePosDateRange('7days', tz).endStr);

  const [orders, setOrders] = useState<PosOrder[]>([]);
  const [shifts, setShifts] = useState<PosShift[]>([]);
  const [logs, setLogs] = useState<PosLog[]>([]);
  const [team, setTeam] = useState<PosTeamMember[]>([]);
  const [posSettings, setPosSettings] = useState<PosSettingsMain | null>(null);

  const [loadingOrders, setLoadingOrders] = useState<boolean>(true);
  const [loadingMeta, setLoadingMeta] = useState<boolean>(true);
  const [refreshNonce, setRefreshNonce] = useState<number>(0);

  const activeRange = useMemo(
    () => resolvePosDateRange(preset, tz, customStart, customEnd),
    [preset, tz, customStart, customEnd]
  );

  // Load range-based POS orders
  useEffect(() => {
    let active = true;
    const loadOrders = async () => {
      try {
        setLoadingOrders(true);
        const startTs = Timestamp.fromDate(activeRange.start);
        const endTs = Timestamp.fromDate(activeRange.end);

        const q = query(
          collection(db, 'merchants', merchant.id, 'posOrders'),
          where('paidAt', '>=', startTs),
          where('paidAt', '<=', endTs)
        );
        const snap = await getDocs(q);
        if (!active) return;

        const parsed: PosOrder[] = [];
        snap.forEach((d) => {
          const item = parsePosOrderDoc(d.id, d.data());
          if (item) parsed.push(item);
        });
        parsed.sort((a, b) => (b.paidAt?.getTime() || 0) - (a.paidAt?.getTime() || 0));
        setOrders(parsed);
      } catch (err) {
        console.warn('Error loading POS orders for shop:', err);
        if (active) setOrders([]);
      } finally {
        if (active) setLoadingOrders(false);
      }
    };
    loadOrders();
    return () => {
      active = false;
    };
  }, [merchant.id, activeRange.start.getTime(), activeRange.end.getTime(), refreshNonce]);

  // Load shifts, activity logs, team (names + roles only, never PINs), and tax settings
  useEffect(() => {
    let active = true;
    const loadPosMetadata = async () => {
      try {
        setLoadingMeta(true);

        const shiftsPromise = getDocs(
          query(collection(db, 'merchants', merchant.id, 'posShifts'), orderBy('openedAt', 'desc'), limit(40))
        ).catch(() => getDocs(query(collection(db, 'merchants', merchant.id, 'posShifts'), limit(40))));

        const logsPromise = getDocs(
          query(collection(db, 'merchants', merchant.id, 'posLogs'), orderBy('at', 'desc'), limit(80))
        ).catch(() => getDocs(query(collection(db, 'merchants', merchant.id, 'posLogs'), limit(80))));

        const settingsPromise = getDoc(doc(db, 'merchants', merchant.id, 'posSettings', 'main'));

        // Check possible read-only POS team subcollections cleanly; strictly strip PIN fields
        const teamCollections = ['posTeam', 'posStaff', 'posUsers'] as const;
        const teamPromises = teamCollections.map((colName) =>
          getDocs(collection(db, 'merchants', merchant.id, colName))
        );

        const [shiftsRes, logsRes, settingsRes, ...teamResults] = await Promise.allSettled([
          shiftsPromise,
          logsPromise,
          settingsPromise,
          ...teamPromises
        ]);

        if (!active) return;

        if (shiftsRes.status === 'fulfilled') {
          const parsedShifts: PosShift[] = [];
          shiftsRes.value.forEach((d) => {
            const s = parsePosShiftDoc(d.id, d.data());
            if (s) parsedShifts.push(s);
          });
          parsedShifts.sort((a, b) => (b.openedAt?.getTime() || 0) - (a.openedAt?.getTime() || 0));
          setShifts(parsedShifts);
        } else {
          setShifts([]);
        }

        if (logsRes.status === 'fulfilled') {
          const parsedLogs: PosLog[] = [];
          logsRes.value.forEach((d) => {
            const l = parsePosLogDoc(d.id, d.data());
            if (
              l &&
              ['void', 'refund', 'discount', 'price_override'].includes(l.type.toLowerCase())
            ) {
              parsedLogs.push(l);
            }
          });
          parsedLogs.sort((a, b) => (b.at?.getTime() || 0) - (a.at?.getTime() || 0));
          setLogs(parsedLogs);
        } else {
          setLogs([]);
        }

        if (settingsRes.status === 'fulfilled' && settingsRes.value.exists()) {
          setPosSettings(parsePosSettingsDoc(settingsRes.value.data()));
        } else {
          setPosSettings(null);
        }

        const teamMap = new Map<string, PosTeamMember>();
        for (const res of teamResults) {
          if (res.status === 'fulfilled' && !res.value.empty) {
            res.value.forEach((d) => {
              const member = parsePosTeamMemberDoc(d.id, d.data());
              if (member && !teamMap.has(member.id)) {
                teamMap.set(member.id, member);
              }
            });
          }
        }
        setTeam(Array.from(teamMap.values()).sort((a, b) => a.name.localeCompare(b.name)));
      } finally {
        if (active) setLoadingMeta(false);
      }
    };

    loadPosMetadata();
    return () => {
      active = false;
    };
  }, [merchant.id, refreshNonce]);

  // Derived analytics from range POS orders
  const analytics = useMemo(() => {
    const countingOrders = orders.filter(isCountingPosSale);

    let ordersCount = 0;
    let itemSales = 0;
    let discounts = 0;
    let refunds = 0;
    let serviceCharge = 0;
    let vatAmount = 0;
    let tips = 0;

    const payments = { cash: 0, gcash: 0, maya: 0, card: 0, other: 0 };
    const orderTypes = {
      dine_in: { count: 0, itemSales: 0 },
      take_out: { count: 0, itemSales: 0 },
      other: { count: 0, itemSales: 0 }
    };

    const dailyMap = new Map<
      string,
      {
        day: string;
        orders: number;
        itemSales: number;
        discounts: number;
        refunds: number;
        serviceCharge: number;
        vatAmount: number;
        tips: number;
      }
    >();

    const topItemsMap = new Map<
      string,
      { label: string; qty: number; revenue: number }
    >();

    for (const o of countingOrders) {
      const iSales = calcPosItemSales(o);
      ordersCount += 1;
      itemSales += iSales;
      discounts += o.discountTotal;
      refunds += o.refund ? o.refund.amount : 0;
      serviceCharge += o.serviceCharge;
      vatAmount += o.vatAmount;
      tips += o.tip;

      const split = splitPosOrderPayments(o);
      payments.cash += split.cash;
      payments.gcash += split.gcash;
      payments.maya += split.maya;
      payments.card += split.card;
      payments.other += split.other;

      const ot = o.type.toLowerCase();
      if (ot === 'dine_in') {
        orderTypes.dine_in.count += 1;
        orderTypes.dine_in.itemSales += iSales;
      } else if (ot === 'take_out') {
        orderTypes.take_out.count += 1;
        orderTypes.take_out.itemSales += iSales;
      } else {
        orderTypes.other.count += 1;
        orderTypes.other.itemSales += iSales;
      }

      if (o.paidAt) {
        const dayKey = getDateStrInTimeZone(o.paidAt, tz);
        const prev = dailyMap.get(dayKey) || {
          day: dayKey,
          orders: 0,
          itemSales: 0,
          discounts: 0,
          refunds: 0,
          serviceCharge: 0,
          vatAmount: 0,
          tips: 0
        };
        prev.orders += 1;
        prev.itemSales += iSales;
        prev.discounts += o.discountTotal;
        prev.refunds += o.refund ? o.refund.amount : 0;
        prev.serviceCharge += o.serviceCharge;
        prev.vatAmount += o.vatAmount;
        prev.tips += o.tip;
        dailyMap.set(dayKey, prev);
      }

      for (const it of o.items) {
        if (it.voided) continue;
        const label = it.variantLabel ? `${it.name} (${it.variantLabel})` : it.name;
        const prevItem = topItemsMap.get(label) || { label, qty: 0, revenue: 0 };
        prevItem.qty += it.qty;
        prevItem.revenue += it.unitPrice * it.qty;
        topItemsMap.set(label, prevItem);
      }
    }

    const dailyRows = Array.from(dailyMap.values()).sort((a, b) => b.day.localeCompare(a.day));
    const topItems = Array.from(topItemsMap.values())
      .sort((a, b) => b.revenue - a.revenue || b.qty - a.qty)
      .slice(0, 15);

    return {
      ordersCount,
      itemSales,
      discounts,
      refunds,
      serviceCharge,
      vatAmount,
      tips,
      payments,
      orderTypes,
      dailyRows,
      topItems
    };
  }, [orders, tz]);

  const filteredLogs = useMemo(() => {
    const sMs = activeRange.start.getTime();
    const eMs = activeRange.end.getTime();
    return logs.filter((l) => {
      if (!l.at) return true;
      const t = l.at.getTime();
      return t >= sMs && t <= eMs;
    });
  }, [logs, activeRange.start.getTime(), activeRange.end.getTime()]);

  return (
    <div className="space-y-6 text-xs">
      {/* Header & Range Controls */}
      <div className="p-4 rounded-2xl bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h4 className="font-extrabold text-sm text-gray-900 dark:text-white flex items-center gap-2">
              <Receipt className="w-4 h-4 text-amber-500" />
              <span>Delivio POS Overview</span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-200 dark:bg-zinc-800 text-gray-700 dark:text-zinc-300">
                Read-Only
              </span>
            </h4>
            <p className="text-[11px] text-gray-500 dark:text-zinc-400">
              {activeRange.startStr} to {activeRange.endStr} ({tz})
            </p>
          </div>
          <button
            type="button"
            onClick={() => setRefreshNonce((n) => n + 1)}
            disabled={loadingOrders || loadingMeta}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 font-bold text-gray-700 dark:text-zinc-200 hover:bg-gray-100 self-start sm:self-auto"
          >
            <RotateCw className={`w-3.5 h-3.5 ${loadingOrders || loadingMeta ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {(
            [
              { id: 'today', label: 'Today' },
              { id: 'yesterday', label: 'Yesterday' },
              { id: '7days', label: 'Last 7 days' },
              { id: '30days', label: 'Last 30 days' },
              { id: 'custom', label: 'Custom' }
            ] as const
          ).map((chip) => (
            <button
              key={chip.id}
              type="button"
              onClick={() => setPreset(chip.id)}
              className={`px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all ${
                preset === chip.id
                  ? 'bg-amber-400 text-black shadow-xs'
                  : 'bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 text-gray-600 dark:text-zinc-300'
              }`}
            >
              {chip.label}
            </button>
          ))}

          {preset === 'custom' && (
            <div className="flex items-center gap-1.5 ml-1 flex-wrap">
              <Calendar className="w-3.5 h-3.5 text-gray-400" />
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="px-2 py-1 rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-[11px]"
              />
              <span className="text-gray-400">to</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="px-2 py-1 rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-[11px]"
              />
            </div>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      {loadingOrders ? (
        <div className="py-10 flex items-center justify-center gap-2 text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin text-amber-500" />
          <span>Loading POS sales for selected range...</span>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3.5 rounded-2xl border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
              <span className="text-[10px] font-bold uppercase text-gray-400 block">POS Orders</span>
              <span className="text-xl font-black text-gray-900 dark:text-white tabular-nums">
                {analytics.ordersCount}
              </span>
            </div>
            <div className="p-3.5 rounded-2xl border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
              <span className="text-[10px] font-bold uppercase text-gray-400 block">Item Sales</span>
              <span className="text-xl font-black text-emerald-600 dark:text-emerald-400 tabular-nums">
                {formatPhp(analytics.itemSales)}
              </span>
            </div>
            <div className="p-3.5 rounded-2xl border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
              <span className="text-[10px] font-bold uppercase text-gray-400 block">Discounts</span>
              <span className="text-xl font-black text-gray-900 dark:text-white tabular-nums">
                {formatPhp(analytics.discounts)}
              </span>
            </div>
            <div className="p-3.5 rounded-2xl border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
              <span className="text-[10px] font-bold uppercase text-gray-400 block">Refunds</span>
              <span className="text-xl font-black text-rose-600 dark:text-rose-400 tabular-nums">
                {formatPhp(analytics.refunds)}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 p-3 rounded-2xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/70 dark:border-amber-900/50 text-[11px]">
            <div>
              <span className="text-gray-500 dark:text-zinc-400 block">Service Charge (Separate)</span>
              <span className="font-extrabold text-gray-900 dark:text-white tabular-nums">
                {formatPhp(analytics.serviceCharge)}
              </span>
            </div>
            <div>
              <span className="text-gray-500 dark:text-zinc-400 block">VAT Amount (Separate)</span>
              <span className="font-extrabold text-gray-900 dark:text-white tabular-nums">
                {formatPhp(analytics.vatAmount)}
              </span>
            </div>
            <div>
              <span className="text-gray-500 dark:text-zinc-400 block">Tips (Separate)</span>
              <span className="font-extrabold text-gray-900 dark:text-white tabular-nums">
                {formatPhp(analytics.tips)}
              </span>
            </div>
          </div>

          {/* Payment Methods & Order Types */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-2xl border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 space-y-2.5">
              <h5 className="font-extrabold text-gray-900 dark:text-white uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                <CreditCard className="w-3.5 h-3.5 text-amber-500" />
                <span>Payment Methods</span>
              </h5>
              <div className="space-y-1.5 tabular-nums">
                {[
                  { label: 'Cash', val: analytics.payments.cash, icon: Banknote },
                  { label: 'GCash', val: analytics.payments.gcash, icon: Smartphone },
                  { label: 'Maya', val: analytics.payments.maya, icon: Smartphone },
                  { label: 'Card', val: analytics.payments.card, icon: CreditCard },
                  { label: 'Other', val: analytics.payments.other, icon: CreditCard }
                ].map((row) => {
                  const Icon = row.icon;
                  return (
                    <div
                      key={row.label}
                      className="flex items-center justify-between py-1 border-b border-gray-100 dark:border-zinc-800 last:border-0"
                    >
                      <span className="flex items-center gap-1.5 text-gray-600 dark:text-zinc-300">
                        <Icon className="w-3.5 h-3.5 text-gray-400" />
                        {row.label}
                      </span>
                      <span className="font-bold text-gray-900 dark:text-white">
                        {formatPhp(row.val)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="p-4 rounded-2xl border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 space-y-2.5">
              <h5 className="font-extrabold text-gray-900 dark:text-white uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                <ShoppingBag className="w-3.5 h-3.5 text-amber-500" />
                <span>Order Types</span>
              </h5>
              <div className="space-y-2 tabular-nums">
                {[
                  { label: 'Dine-In', data: analytics.orderTypes.dine_in },
                  { label: 'Take-Out', data: analytics.orderTypes.take_out },
                  ...(analytics.orderTypes.other.count > 0
                    ? [{ label: 'Other', data: analytics.orderTypes.other }]
                    : [])
                ].map((ot) => (
                  <div
                    key={ot.label}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-gray-50 dark:bg-zinc-850"
                  >
                    <div>
                      <span className="font-bold text-gray-900 dark:text-white block">
                        {ot.label}
                      </span>
                      <span className="text-[11px] text-gray-500">
                        {ot.data.count} {ot.data.count === 1 ? 'order' : 'orders'}
                      </span>
                    </div>
                    <span className="font-extrabold text-emerald-600 dark:text-emerald-400">
                      {formatPhp(ot.data.itemSales)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Day-by-Day Sales Breakdown */}
          <div className="rounded-2xl border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-zinc-800 font-extrabold text-gray-900 dark:text-white uppercase tracking-wider text-[11px]">
              Day-by-Day Sales Breakdown
            </div>
            {analytics.dailyRows.length === 0 ? (
              <div className="p-6 text-center text-gray-400">
                No paid POS orders found for this date range.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[11px]">
                  <thead className="bg-gray-50 dark:bg-zinc-850 uppercase font-bold text-gray-500">
                    <tr>
                      <th className="px-4 py-2.5">Date</th>
                      <th className="px-3 py-2.5 text-right">Orders</th>
                      <th className="px-3 py-2.5 text-right">Item Sales</th>
                      <th className="px-3 py-2.5 text-right">Discounts</th>
                      <th className="px-3 py-2.5 text-right">Refunds</th>
                      <th className="px-3 py-2.5 text-right">SC</th>
                      <th className="px-3 py-2.5 text-right">VAT</th>
                      <th className="px-4 py-2.5 text-right">Tips</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-zinc-800 tabular-nums">
                    {analytics.dailyRows.map((row) => (
                      <tr key={row.day}>
                        <td className="px-4 py-2.5 font-bold text-gray-900 dark:text-white">
                          {row.day}
                        </td>
                        <td className="px-3 py-2.5 text-right font-bold">{row.orders}</td>
                        <td className="px-3 py-2.5 text-right font-bold text-emerald-600 dark:text-emerald-400">
                          {formatPhp(row.itemSales)}
                        </td>
                        <td className="px-3 py-2.5 text-right text-gray-600 dark:text-zinc-300">
                          {formatPhp(row.discounts)}
                        </td>
                        <td className="px-3 py-2.5 text-right text-rose-600 dark:text-rose-400">
                          {formatPhp(row.refunds)}
                        </td>
                        <td className="px-3 py-2.5 text-right text-gray-500">
                          {formatPhp(row.serviceCharge)}
                        </td>
                        <td className="px-3 py-2.5 text-right text-gray-500">
                          {formatPhp(row.vatAmount)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-500">
                          {formatPhp(row.tips)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Top Items */}
          <div className="rounded-2xl border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-zinc-800 font-extrabold text-gray-900 dark:text-white uppercase tracking-wider text-[11px]">
              Top Selling POS Items
            </div>
            {analytics.topItems.length === 0 ? (
              <div className="p-6 text-center text-gray-400">No items sold in this period.</div>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-zinc-800">
                {analytics.topItems.map((it, idx) => (
                  <div key={it.label} className="px-4 py-2.5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-5 h-5 rounded-md bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 font-extrabold text-[10px] flex items-center justify-center shrink-0">
                        {idx + 1}
                      </span>
                      <span className="font-bold text-gray-900 dark:text-white truncate">
                        {it.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 shrink-0 tabular-nums">
                      <span className="text-gray-500">{it.qty} sold</span>
                      <span className="font-extrabold text-gray-900 dark:text-white">
                        {formatPhp(it.revenue)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Shifts, Activity Log, Team & Tax Settings */}
      {loadingMeta ? (
        <div className="py-8 flex items-center justify-center gap-2 text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin text-amber-500" />
          <span>Loading shifts, POS logs, team, and tax settings...</span>
        </div>
      ) : (
        <>
          {/* Shifts List */}
          <div className="rounded-2xl border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-zinc-800 font-extrabold text-gray-900 dark:text-white uppercase tracking-wider text-[11px] flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-amber-500" />
              <span>POS Shifts ({shifts.length})</span>
            </div>
            {shifts.length === 0 ? (
              <div className="p-6 text-center text-gray-400">No POS shifts recorded yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[11px]">
                  <thead className="bg-gray-50 dark:bg-zinc-850 uppercase font-bold text-gray-500">
                    <tr>
                      <th className="px-4 py-2.5">Cashier</th>
                      <th className="px-3 py-2.5">Opened</th>
                      <th className="px-3 py-2.5">Closed</th>
                      <th className="px-3 py-2.5 text-right">Expected Cash</th>
                      <th className="px-3 py-2.5 text-right">Closing Cash</th>
                      <th className="px-3 py-2.5 text-right">Variance</th>
                      <th className="px-4 py-2.5 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-zinc-800 tabular-nums">
                    {shifts.map((sh) => {
                      const hasVarianceAlert =
                        sh.variance !== null && Math.abs(sh.variance) > 200;
                      return (
                        <tr key={sh.id}>
                          <td className="px-4 py-2.5 font-bold text-gray-900 dark:text-white">
                            {sh.cashierName}
                          </td>
                          <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">
                            {sh.openedAt ? formatTimestamp(sh.openedAt) : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">
                            {sh.closedAt ? formatTimestamp(sh.closedAt) : 'Open'}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            {sh.expectedCash !== null ? formatPhp(sh.expectedCash) : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            {sh.closingCash !== null ? formatPhp(sh.closingCash) : '—'}
                          </td>
                          <td
                            className={`px-3 py-2.5 text-right font-bold ${
                              hasVarianceAlert
                                ? 'text-rose-600 dark:text-rose-400'
                                : 'text-gray-700 dark:text-zinc-300'
                            }`}
                          >
                            {sh.variance !== null
                              ? `${sh.variance >= 0 ? '+' : ''}${formatPhp(sh.variance)}`
                              : '—'}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                sh.status === 'open'
                                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                  : 'bg-gray-100 text-gray-700 dark:bg-zinc-800 dark:text-zinc-300'
                              }`}
                            >
                              {sh.status}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Activity Log: void, refund, discount, price_override */}
          <div className="rounded-2xl border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-zinc-800 font-extrabold text-gray-900 dark:text-white uppercase tracking-wider text-[11px] flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
              <span>Sensitive Activity Log ({filteredLogs.length})</span>
            </div>
            {filteredLogs.length === 0 ? (
              <div className="p-6 text-center text-gray-400">
                No voids, refunds, discounts, or price overrides logged in this range.
              </div>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-zinc-800 max-h-80 overflow-y-auto">
                {filteredLogs.map((log) => (
                  <div key={log.id} className="p-3.5 flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                          {log.type.replace('_', ' ')}
                        </span>
                        <span className="font-bold text-gray-900 dark:text-white">
                          By {log.byName}
                        </span>
                        {log.approvedBy && (
                          <span className="text-[11px] text-emerald-700 dark:text-emerald-400 font-semibold">
                            · Approved by {log.approvedBy}
                          </span>
                        )}
                      </div>
                      <p className="text-gray-600 dark:text-zinc-300">
                        {log.reason || <span className="italic text-gray-400">No reason recorded</span>}
                      </p>
                      <span className="text-[10px] text-gray-400 block">
                        {log.at ? `${formatTimestamp(log.at)} (${formatRelativeTime(log.at)})` : '—'}
                      </span>
                    </div>
                    <span className="font-extrabold text-gray-900 dark:text-white tabular-nums shrink-0">
                      {formatPhp(log.amount)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Read-only POS Team & Tax Settings */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-2xl border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 space-y-2.5">
              <div className="flex items-center justify-between">
                <h5 className="font-extrabold text-gray-900 dark:text-white uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-amber-500" />
                  <span>POS Team (Read-Only)</span>
                </h5>
                <span className="text-[10px] text-gray-400">Names &amp; roles only</span>
              </div>
              {team.length === 0 ? (
                <p className="text-gray-400 py-3">No POS team members found.</p>
              ) : (
                <div className="divide-y divide-gray-100 dark:divide-zinc-800">
                  {team.map((member) => (
                    <div key={member.id} className="py-2 flex items-center justify-between">
                      <div>
                        <span className="font-bold text-gray-900 dark:text-white block">
                          {member.name}
                        </span>
                        <span className="text-[10px] text-gray-400 uppercase">{member.role}</span>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          member.active
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                            : 'bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-zinc-400'
                        }`}
                      >
                        {member.active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-4 rounded-2xl border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 space-y-2.5">
              <div className="flex items-center justify-between">
                <h5 className="font-extrabold text-gray-900 dark:text-white uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                  <Percent className="w-3.5 h-3.5 text-amber-500" />
                  <span>POS Tax Settings (Read-Only)</span>
                </h5>
                <ShieldCheck className="w-3.5 h-3.5 text-gray-400" />
              </div>
              {!posSettings ? (
                <p className="text-gray-400 py-3">No POS tax configuration saved yet.</p>
              ) : (
                <div className="space-y-1.5">
                  <div className="flex justify-between py-1 border-b border-gray-100 dark:border-zinc-800">
                    <span className="text-gray-500">VAT Enabled</span>
                    <span className="font-bold text-gray-900 dark:text-white">
                      {posSettings.vatEnabled ? 'Yes' : 'No'}
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-gray-100 dark:border-zinc-800">
                    <span className="text-gray-500">VAT Rate</span>
                    <span className="font-bold text-gray-900 dark:text-white tabular-nums">
                      {posSettings.vatPercent}% ({posSettings.vatMode})
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-gray-100 dark:border-zinc-800">
                    <span className="text-gray-500">Service Charge</span>
                    <span className="font-bold text-gray-900 dark:text-white tabular-nums">
                      {posSettings.serviceChargeEnabled
                        ? `${posSettings.serviceChargePercent}%`
                        : 'Disabled'}
                    </span>
                  </div>
                  {posSettings.tin && (
                    <div className="flex justify-between py-1">
                      <span className="text-gray-500">TIN</span>
                      <span className="font-mono font-bold text-gray-900 dark:text-white">
                        {posSettings.tin}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
