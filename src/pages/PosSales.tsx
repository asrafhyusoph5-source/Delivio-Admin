import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
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
} from '../firebase';
import { useCity } from '../context/CityContext';
import { useToast } from '../context/ToastContext';
import { exportToCsv } from '../utils/exportCsv';
import { formatRelativeTime } from '../utils/date';
import { formatShopDisplayName, getChainOptions } from '../utils/outletUtils';
import {
  DEFAULT_POS_TIMEZONE,
  PosDateRangePreset,
  resolvePosDateRange,
  parsePosOrderDoc,
  isCountingPosSale,
  calcPosItemSales,
  splitPosOrderPayments,
  formatPhp,
  runWithConcurrency
} from '../utils/posUtils';
import type { Merchant, PosOrder } from '../types';
import {
  Store,
  Search,
  Download,
  RefreshCw,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronDown,
  ChevronRight,
  Building2,
  Receipt,
  CreditCard,
  Banknote,
  Smartphone,
  RotateCcw,
  Tag,
  ShoppingBag,
  Calendar,
  ExternalLink
} from 'lucide-react';

interface ShopPosMetrics {
  shop: Merchant;
  posUsed: boolean;
  ordersCount: number;
  itemSales: number;
  discounts: number;
  refunds: number;
  serviceCharge: number;
  vatAmount: number;
  tips: number;
  cash: number;
  eWallet: number;
  card: number;
  otherPayment: number;
  voids: number;
  avgOrder: number;
  lastSaleAt: Date | null;
  error?: boolean;
}

type SortKey =
  | 'name'
  | 'ordersCount'
  | 'itemSales'
  | 'discounts'
  | 'refunds'
  | 'cash'
  | 'eWallet'
  | 'card'
  | 'voids'
  | 'avgOrder'
  | 'lastSaleAt';

type DisplayRow =
  | {
      kind: 'chain';
      chainId: string;
      chainName: string;
      mainShop: Merchant;
      outlets: ShopPosMetrics[];
      totals: Omit<ShopPosMetrics, 'shop'>;
    }
  | {
      kind: 'single';
      metric: ShopPosMetrics;
    };

export const PosSales: React.FC = () => {
  const navigate = useNavigate();
  const { selectedCityId } = useCity();
  const { showError } = useToast();

  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [platformTimezone, setPlatformTimezone] = useState<string>(DEFAULT_POS_TIMEZONE);
  const [loadingMerchants, setLoadingMerchants] = useState<boolean>(true);

  // Filters
  const [preset, setPreset] = useState<PosDateRangePreset>('today');
  const [customStart, setCustomStart] = useState<string>(() => {
    const r = resolvePosDateRange('today', DEFAULT_POS_TIMEZONE);
    return r.startStr;
  });
  const [customEnd, setCustomEnd] = useState<string>(() => {
    const r = resolvePosDateRange('today', DEFAULT_POS_TIMEZONE);
    return r.endStr;
  });
  const [chainFilter, setChainFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [expandedChainIds, setExpandedChainIds] = useState<Record<string, boolean>>({});

  // Sorting
  const [sortKey, setSortKey] = useState<SortKey>('itemSales');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // POS Data & Progress
  const [shopMetrics, setShopMetrics] = useState<ShopPosMetrics[]>([]);
  const [loadingPos, setLoadingPos] = useState<boolean>(false);
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [refreshNonce, setRefreshNonce] = useState<number>(0);

  const loadSeqRef = useRef<number>(0);

  // Initial load: merchants & settings/platform timezone
  useEffect(() => {
    let active = true;
    const initLoad = async () => {
      try {
        setLoadingMerchants(true);
        const [mSnap, platformSnap] = await Promise.all([
          getDocs(collection(db, 'merchants')),
          getDoc(doc(db, 'settings', 'platform'))
        ]);

        if (!active) return;

        if (platformSnap.exists()) {
          const tz = platformSnap.data()?.timezone;
          if (typeof tz === 'string' && tz.trim()) {
            setPlatformTimezone(tz.trim());
          }
        }

        const list: Merchant[] = [];
        mSnap.forEach((d) => {
          const dt = d.data() || {};
          list.push({
            id: d.id,
            name: dt.name || 'Store',
            ownerName: dt.ownerName || '',
            email: dt.email || '',
            phone: dt.phone || '',
            type: dt.type === 'convenience' ? 'convenience' : 'food',
            status: dt.status || 'active',
            isOpen: Boolean(dt.isOpen),
            cityId: dt.cityId || '',
            address: dt.address || '',
            lat: Number(dt.lat) || 0,
            lng: Number(dt.lng) || 0,
            logoUrl: dt.logoUrl,
            commissionRate: dt.commissionRate ?? 15,
            chainId: dt.chainId || undefined,
            chainName: dt.chainName || undefined,
            isBranch: dt.isBranch,
            branchName: dt.branchName || '',
            branchCode: dt.branchCode || '',
            branchSetupDone: dt.branchSetupDone
          });
        });
        list.sort((a, b) => a.name.localeCompare(b.name));
        setMerchants(list);
      } catch (err) {
        if (active) showError(err);
      } finally {
        if (active) setLoadingMerchants(false);
      }
    };
    initLoad();
    return () => {
      active = false;
    };
  }, []);

  const chainOptions = useMemo(() => getChainOptions(merchants), [merchants]);

  const activeDateRange = useMemo(
    () => resolvePosDateRange(preset, platformTimezone, customStart, customEnd),
    [preset, platformTimezone, customStart, customEnd]
  );

  // Target shops scoped by global City selector before querying Firestore
  const cityScopedMerchants = useMemo(() => {
    if (selectedCityId === 'all') return merchants;
    return merchants.filter((m) => m.cityId === selectedCityId);
  }, [merchants, selectedCityId]);

  // Fetch POS orders for each shop with concurrency 5
  useEffect(() => {
    if (loadingMerchants) return;
    const seq = ++loadSeqRef.current;

    if (cityScopedMerchants.length === 0) {
      setShopMetrics([]);
      setProgress({ done: 0, total: 0 });
      setLoadingPos(false);
      return;
    }

    const fetchAllPos = async () => {
      setLoadingPos(true);
      setProgress({ done: 0, total: cityScopedMerchants.length });

      const startTs = Timestamp.fromDate(activeDateRange.start);
      const endTs = Timestamp.fromDate(activeDateRange.end);

      const results = await runWithConcurrency(
        cityScopedMerchants,
        5,
        async (shop): Promise<ShopPosMetrics> => {
          try {
            const posOrdersCol = collection(db, 'merchants', shop.id, 'posOrders');
            const rangeQ = query(
              posOrdersCol,
              where('paidAt', '>=', startTs),
              where('paidAt', '<=', endTs)
            );
            const latestQ = query(posOrdersCol, orderBy('createdAt', 'desc'), limit(1));

            const [rangeSnap, latestSnap] = await Promise.all([
              getDocs(rangeQ),
              getDocs(latestQ)
            ]);

            const parsedRangeOrders: PosOrder[] = [];
            rangeSnap.forEach((d) => {
              const parsed = parsePosOrderDoc(d.id, d.data());
              if (parsed) parsedRangeOrders.push(parsed);
            });

            let latestOrder: PosOrder | null = null;
            if (!latestSnap.empty) {
              const d = latestSnap.docs[0];
              latestOrder = parsePosOrderDoc(d.id, d.data());
            }

            let ordersCount = 0;
            let itemSales = 0;
            let discounts = 0;
            let refunds = 0;
            let serviceCharge = 0;
            let vatAmount = 0;
            let tips = 0;
            let cash = 0;
            let eWallet = 0;
            let card = 0;
            let otherPayment = 0;
            let voids = 0;
            let lastSaleMs = 0;

            for (const o of parsedRangeOrders) {
              const st = o.status.toLowerCase();
              if (st === 'voided') {
                voids += 1;
              }
              if (Array.isArray(o.items)) {
                for (const it of o.items) {
                  if (it.voided) voids += 1;
                }
              }

              if (!isCountingPosSale(o)) continue;

              ordersCount += 1;
              itemSales += calcPosItemSales(o);
              discounts += o.discountTotal;
              refunds += o.refund ? o.refund.amount : 0;
              serviceCharge += o.serviceCharge;
              vatAmount += o.vatAmount;
              tips += o.tip;

              const split = splitPosOrderPayments(o);
              cash += split.cash;
              eWallet += split.eWallet;
              card += split.card;
              otherPayment += split.other;

              if (o.paidAt) {
                const t = o.paidAt.getTime();
                if (t > lastSaleMs) lastSaleMs = t;
              }
            }

            if (latestOrder && isCountingPosSale(latestOrder) && latestOrder.paidAt) {
              const t = latestOrder.paidAt.getTime();
              if (t > lastSaleMs) lastSaleMs = t;
            }

            const posUsed =
              !latestSnap.empty || parsedRangeOrders.length > 0 || lastSaleMs > 0;
            const avgOrder = ordersCount > 0 ? itemSales / ordersCount : 0;

            return {
              shop,
              posUsed,
              ordersCount,
              itemSales,
              discounts,
              refunds,
              serviceCharge,
              vatAmount,
              tips,
              cash,
              eWallet,
              card,
              otherPayment,
              voids,
              avgOrder,
              lastSaleAt: lastSaleMs > 0 ? new Date(lastSaleMs) : null
            };
          } catch {
            return {
              shop,
              posUsed: false,
              ordersCount: 0,
              itemSales: 0,
              discounts: 0,
              refunds: 0,
              serviceCharge: 0,
              vatAmount: 0,
              tips: 0,
              cash: 0,
              eWallet: 0,
              card: 0,
              otherPayment: 0,
              voids: 0,
              avgOrder: 0,
              lastSaleAt: null,
              error: true
            };
          }
        },
        (done, total) => {
          if (loadSeqRef.current === seq) {
            setProgress({ done, total });
          }
        }
      );

      if (loadSeqRef.current === seq) {
        setShopMetrics(results);
        setLoadingPos(false);
      }
    };

    fetchAllPos();
  }, [
    loadingMerchants,
    cityScopedMerchants,
    activeDateRange.start.getTime(),
    activeDateRange.end.getTime(),
    refreshNonce
  ]);

  // Filter rows by chain & search
  const filteredMetrics = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return shopMetrics.filter((m) => {
      const s = m.shop;
      if (chainFilter === 'chains_only' && !s.chainId) return false;
      if (chainFilter === 'single_only' && s.chainId) return false;
      if (
        chainFilter !== 'all' &&
        chainFilter !== 'chains_only' &&
        chainFilter !== 'single_only' &&
        s.chainId !== chainFilter
      ) {
        return false;
      }

      if (q) {
        const displayName = formatShopDisplayName(s, true).toLowerCase();
        const match =
          displayName.includes(q) ||
          s.name.toLowerCase().includes(q) ||
          (s.branchName || '').toLowerCase().includes(q) ||
          (s.branchCode || '').toLowerCase().includes(q) ||
          (s.chainName || '').toLowerCase().includes(q) ||
          s.id.toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [shopMetrics, chainFilter, searchQuery]);

  // Platform summary cards (from filtered metrics)
  const summary = useMemo(() => {
    let shopsUsingPos = 0;
    let totalOrders = 0;
    let totalItemSales = 0;
    let totalDiscounts = 0;
    let totalRefunds = 0;
    let totalCash = 0;
    let totalEWallet = 0;
    let totalCard = 0;
    let totalVat = 0;
    let totalServiceCharge = 0;
    let totalTips = 0;
    let totalVoids = 0;

    for (const m of filteredMetrics) {
      if (m.posUsed) shopsUsingPos += 1;
      totalOrders += m.ordersCount;
      totalItemSales += m.itemSales;
      totalDiscounts += m.discounts;
      totalRefunds += m.refunds;
      totalCash += m.cash;
      totalEWallet += m.eWallet;
      totalCard += m.card;
      totalVat += m.vatAmount;
      totalServiceCharge += m.serviceCharge;
      totalTips += m.tips;
      totalVoids += m.voids;
    }

    return {
      shopsUsingPos,
      totalShops: filteredMetrics.length,
      totalOrders,
      totalItemSales,
      totalDiscounts,
      totalRefunds,
      totalCash,
      totalEWallet,
      totalCard,
      totalVat,
      totalServiceCharge,
      totalTips,
      totalVoids
    };
  }, [filteredMetrics]);

  // Group into chains + singles (like Merchants.tsx) and sort
  const displayRows = useMemo(() => {
    const compareMetric = (
      a: Omit<ShopPosMetrics, 'shop'> & { sortName: string },
      b: Omit<ShopPosMetrics, 'shop'> & { sortName: string }
    ): number => {
      let cmp = 0;
      if (sortKey === 'name') {
        cmp = a.sortName.localeCompare(b.sortName);
      } else if (sortKey === 'lastSaleAt') {
        const at = a.lastSaleAt ? a.lastSaleAt.getTime() : 0;
        const bt = b.lastSaleAt ? b.lastSaleAt.getTime() : 0;
        cmp = at - bt;
      } else {
        cmp = (a[sortKey] as number) - (b[sortKey] as number);
      }
      return sortDir === 'asc' ? cmp : -cmp;
    };

    const byChain = new Map<string, ShopPosMetrics[]>();
    const singles: ShopPosMetrics[] = [];

    for (const item of filteredMetrics) {
      if (item.shop.chainId) {
        const arr = byChain.get(item.shop.chainId) || [];
        arr.push(item);
        byChain.set(item.shop.chainId, arr);
      } else {
        singles.push(item);
      }
    }

    const rows: DisplayRow[] = [];

    byChain.forEach((outlets, chainId) => {
      if (outlets.length === 1) {
        rows.push({ kind: 'single', metric: outlets[0] });
        return;
      }

      const sortedOutlets = [...outlets].sort((a, b) =>
        compareMetric(
          { ...a, sortName: formatShopDisplayName(a.shop, true) },
          { ...b, sortName: formatShopDisplayName(b.shop, true) }
        )
      );

      const mainShopMetric =
        sortedOutlets.find((o) => o.shop.id === chainId || o.shop.isBranch === false) ||
        sortedOutlets[0];

      let ordersCount = 0;
      let itemSales = 0;
      let discounts = 0;
      let refunds = 0;
      let serviceCharge = 0;
      let vatAmount = 0;
      let tips = 0;
      let cash = 0;
      let eWallet = 0;
      let card = 0;
      let otherPayment = 0;
      let voids = 0;
      let posUsed = false;
      let maxLastSaleMs = 0;

      for (const o of sortedOutlets) {
        if (o.posUsed) posUsed = true;
        ordersCount += o.ordersCount;
        itemSales += o.itemSales;
        discounts += o.discounts;
        refunds += o.refunds;
        serviceCharge += o.serviceCharge;
        vatAmount += o.vatAmount;
        tips += o.tips;
        cash += o.cash;
        eWallet += o.eWallet;
        card += o.card;
        otherPayment += o.otherPayment;
        voids += o.voids;
        if (o.lastSaleAt && o.lastSaleAt.getTime() > maxLastSaleMs) {
          maxLastSaleMs = o.lastSaleAt.getTime();
        }
      }

      rows.push({
        kind: 'chain',
        chainId,
        chainName: mainShopMetric.shop.chainName || mainShopMetric.shop.name,
        mainShop: mainShopMetric.shop,
        outlets: sortedOutlets,
        totals: {
          posUsed,
          ordersCount,
          itemSales,
          discounts,
          refunds,
          serviceCharge,
          vatAmount,
          tips,
          cash,
          eWallet,
          card,
          otherPayment,
          voids,
          avgOrder: ordersCount > 0 ? itemSales / ordersCount : 0,
          lastSaleAt: maxLastSaleMs > 0 ? new Date(maxLastSaleMs) : null
        }
      });
    });

    for (const s of singles) {
      rows.push({ kind: 'single', metric: s });
    }

    rows.sort((a, b) => {
      const aNorm =
        a.kind === 'chain'
          ? { ...a.totals, sortName: a.chainName }
          : { ...a.metric, sortName: formatShopDisplayName(a.metric.shop, true) };
      const bNorm =
        b.kind === 'chain'
          ? { ...b.totals, sortName: b.chainName }
          : { ...b.metric, sortName: formatShopDisplayName(b.metric.shop, true) };
      return compareMetric(aNorm, bNorm);
    });

    return rows;
  }, [filteredMetrics, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
  };

  const renderSortIcon = (key: SortKey) => {
    if (sortKey !== key) return <ArrowUpDown className="w-3 h-3 opacity-40" />;
    return sortDir === 'asc' ? (
      <ArrowUp className="w-3 h-3 text-amber-500" />
    ) : (
      <ArrowDown className="w-3 h-3 text-amber-500" />
    );
  };

  const handleExportCsv = () => {
    const csvRows = filteredMetrics.map((m) => ({
      Shop: formatShopDisplayName(m.shop, true),
      ShopId: m.shop.id,
      Chain: m.shop.chainName || '',
      BranchCode: m.shop.branchCode || '',
      PosUsed: m.posUsed ? 'Yes' : 'No',
      Orders: m.ordersCount,
      ItemSales: m.itemSales.toFixed(2),
      Discounts: m.discounts.toFixed(2),
      Refunds: m.refunds.toFixed(2),
      Cash: m.cash.toFixed(2),
      EWallet: m.eWallet.toFixed(2),
      Card: m.card.toFixed(2),
      ServiceCharge: m.serviceCharge.toFixed(2),
      VAT: m.vatAmount.toFixed(2),
      Tips: m.tips.toFixed(2),
      Voids: m.voids,
      AvgOrder: m.avgOrder.toFixed(2),
      LastSale: m.lastSaleAt ? m.lastSaleAt.toISOString() : 'Never'
    }));
    exportToCsv(
      `delivio_pos_sales_${activeDateRange.startStr}_to_${activeDateRange.endStr}.csv`,
      csvRows
    );
  };

  const progressPct =
    progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight flex items-center gap-2.5">
            <span>POS Sales</span>
            <span className="text-xs font-extrabold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
              Read-Only
            </span>
          </h1>
          <p className="text-sm text-gray-500 dark:text-zinc-400 mt-0.5">
            In-store Delivio POS sales across shops ({platformTimezone} day boundaries: {activeDateRange.startStr} to {activeDateRange.endStr}).
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setRefreshNonce((n) => n + 1)}
            disabled={loadingPos || loadingMerchants}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-gray-700 dark:text-zinc-200 hover:bg-gray-50 dark:hover:bg-zinc-800 text-xs font-bold transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingPos ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>

          <button
            type="button"
            onClick={handleExportCsv}
            disabled={filteredMetrics.length === 0}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-400 hover:bg-amber-500 text-black text-xs font-bold shadow-xs transition-colors disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Filters & Range Controls */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-4 shadow-xs space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Date Range Chips */}
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
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  preset === chip.id
                    ? 'bg-amber-400 text-black shadow-xs'
                    : 'bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-300 hover:bg-gray-200 dark:hover:bg-zinc-700'
                }`}
              >
                {chip.label}
              </button>
            ))}

            {preset === 'custom' && (
              <div className="flex items-center gap-2 ml-0 sm:ml-2 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-gray-400" />
                  <input
                    type="date"
                    value={customStart}
                    onChange={(e) => setCustomStart(e.target.value)}
                    className="px-2.5 py-1.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-semibold text-gray-900 dark:text-white"
                  />
                </div>
                <span className="text-xs text-gray-400">to</span>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="px-2.5 py-1.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-semibold text-gray-900 dark:text-white"
                />
              </div>
            )}
          </div>

          {/* Chain Filter + Search */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
            <select
              value={chainFilter}
              onChange={(e) => setChainFilter(e.target.value)}
              className="px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-semibold text-gray-900 dark:text-white"
            >
              <option value="all">All Shops &amp; Chains</option>
              <option value="chains_only">Chains Only</option>
              <option value="single_only">Single Shops Only</option>
              {chainOptions.map((c) => (
                <option key={c.chainId} value={c.chainId}>
                  {c.chainName} ({c.outlets.length} outlets)
                </option>
              ))}
            </select>

            <div className="relative min-w-[220px]">
              <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search shop, branch, code..."
                className="w-full pl-8 pr-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
          </div>
        </div>

        {/* Concurrency Loading Progress Bar */}
        {(loadingMerchants || loadingPos) && (
          <div className="pt-2 border-t border-gray-100 dark:border-zinc-800 space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-semibold text-gray-600 dark:text-zinc-300">
              <span>
                {loadingMerchants
                  ? 'Loading shops list...'
                  : `Scanning POS orders across shops (${progress.done} / ${progress.total})...`}
              </span>
              <span className="tabular-nums font-bold text-amber-600 dark:text-amber-400">
                {loadingMerchants ? '...' : `${progressPct}%`}
              </span>
            </div>
            <div className="w-full h-2 rounded-full bg-gray-100 dark:bg-zinc-800 overflow-hidden">
              <div
                className="h-full bg-amber-400 rounded-full transition-all duration-200"
                style={{ width: `${loadingMerchants ? 15 : Math.max(4, progressPct)}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3.5">
        <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-xs font-bold text-gray-500 dark:text-zinc-400 mb-1.5">
            <span>Shops Using POS</span>
            <Store className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-black text-gray-900 dark:text-white tabular-nums">
            {summary.shopsUsingPos}
            <span className="text-xs font-semibold text-gray-400 ml-1">
              / {summary.totalShops}
            </span>
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-xs font-bold text-gray-500 dark:text-zinc-400 mb-1.5">
            <span>POS Orders</span>
            <ShoppingBag className="w-4 h-4 text-blue-500" />
          </div>
          <div className="text-2xl font-black text-gray-900 dark:text-white tabular-nums">
            {summary.totalOrders.toLocaleString()}
          </div>
          {summary.totalVoids > 0 && (
            <div className="text-[11px] text-gray-400 mt-0.5 tabular-nums">
              {summary.totalVoids} voided
            </div>
          )}
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-xs font-bold text-gray-500 dark:text-zinc-400 mb-1.5">
            <span>Item Sales</span>
            <Receipt className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 tabular-nums">
            {formatPhp(summary.totalItemSales)}
          </div>
          <div className="text-[10px] text-gray-400 mt-0.5 truncate" title="Subtotal minus discounts (excludes VAT, service charge, tips)">
            Excl. VAT {formatPhp(summary.totalVat)} · SC {formatPhp(summary.totalServiceCharge)} · Tips {formatPhp(summary.totalTips)}
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-xs font-bold text-gray-500 dark:text-zinc-400 mb-1.5">
            <span>Discounts</span>
            <Tag className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-black text-gray-900 dark:text-white tabular-nums">
            {formatPhp(summary.totalDiscounts)}
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-xs font-bold text-gray-500 dark:text-zinc-400 mb-1.5">
            <span>Refunds</span>
            <RotateCcw className="w-4 h-4 text-rose-500" />
          </div>
          <div className="text-2xl font-black text-rose-600 dark:text-rose-400 tabular-nums">
            {formatPhp(summary.totalRefunds)}
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-xs font-bold text-gray-500 dark:text-zinc-400 mb-1.5">
            <span>Payment Split</span>
            <CreditCard className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="space-y-1 text-[11px] font-semibold tabular-nums">
            <div className="flex items-center justify-between text-gray-700 dark:text-zinc-200">
              <span className="flex items-center gap-1"><Banknote className="w-3 h-3 text-emerald-500" /> Cash</span>
              <span>{formatPhp(summary.totalCash)}</span>
            </div>
            <div className="flex items-center justify-between text-gray-700 dark:text-zinc-200">
              <span className="flex items-center gap-1"><Smartphone className="w-3 h-3 text-blue-500" /> E-Wallet</span>
              <span>{formatPhp(summary.totalEWallet)}</span>
            </div>
            <div className="flex items-center justify-between text-gray-700 dark:text-zinc-200">
              <span className="flex items-center gap-1"><CreditCard className="w-3 h-3 text-purple-500" /> Card</span>
              <span>{formatPhp(summary.totalCard)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Sortable Per-Shop Table */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-50 dark:bg-zinc-850/60 uppercase font-bold text-gray-500 dark:text-zinc-400 border-b border-gray-200 dark:border-zinc-800">
              <tr>
                <th className="px-4 py-3.5">
                  <button type="button" onClick={() => handleSort('name')} className="inline-flex items-center gap-1 hover:text-gray-900 dark:hover:text-white">
                    <span>Shop</span>
                    {renderSortIcon('name')}
                  </button>
                </th>
                <th className="px-3 py-3.5 text-right">
                  <button type="button" onClick={() => handleSort('ordersCount')} className="inline-flex items-center justify-end gap-1 hover:text-gray-900 dark:hover:text-white">
                    <span>Orders</span>
                    {renderSortIcon('ordersCount')}
                  </button>
                </th>
                <th className="px-3 py-3.5 text-right">
                  <button type="button" onClick={() => handleSort('itemSales')} className="inline-flex items-center justify-end gap-1 hover:text-gray-900 dark:hover:text-white">
                    <span>Item Sales</span>
                    {renderSortIcon('itemSales')}
                  </button>
                </th>
                <th className="px-3 py-3.5 text-right">
                  <button type="button" onClick={() => handleSort('discounts')} className="inline-flex items-center justify-end gap-1 hover:text-gray-900 dark:hover:text-white">
                    <span>Discounts</span>
                    {renderSortIcon('discounts')}
                  </button>
                </th>
                <th className="px-3 py-3.5 text-right">
                  <button type="button" onClick={() => handleSort('refunds')} className="inline-flex items-center justify-end gap-1 hover:text-gray-900 dark:hover:text-white">
                    <span>Refunds</span>
                    {renderSortIcon('refunds')}
                  </button>
                </th>
                <th className="px-3 py-3.5 text-right">
                  <button type="button" onClick={() => handleSort('cash')} className="inline-flex items-center justify-end gap-1 hover:text-gray-900 dark:hover:text-white">
                    <span>Cash</span>
                    {renderSortIcon('cash')}
                  </button>
                </th>
                <th className="px-3 py-3.5 text-right">
                  <button type="button" onClick={() => handleSort('eWallet')} className="inline-flex items-center justify-end gap-1 hover:text-gray-900 dark:hover:text-white">
                    <span>E-Wallet</span>
                    {renderSortIcon('eWallet')}
                  </button>
                </th>
                <th className="px-3 py-3.5 text-right">
                  <button type="button" onClick={() => handleSort('card')} className="inline-flex items-center justify-end gap-1 hover:text-gray-900 dark:hover:text-white">
                    <span>Card</span>
                    {renderSortIcon('card')}
                  </button>
                </th>
                <th className="px-3 py-3.5 text-right">
                  <button type="button" onClick={() => handleSort('voids')} className="inline-flex items-center justify-end gap-1 hover:text-gray-900 dark:hover:text-white">
                    <span>Voids</span>
                    {renderSortIcon('voids')}
                  </button>
                </th>
                <th className="px-3 py-3.5 text-right">
                  <button type="button" onClick={() => handleSort('avgOrder')} className="inline-flex items-center justify-end gap-1 hover:text-gray-900 dark:hover:text-white">
                    <span>Avg Order</span>
                    {renderSortIcon('avgOrder')}
                  </button>
                </th>
                <th className="px-4 py-3.5 text-right">
                  <button type="button" onClick={() => handleSort('lastSaleAt')} className="inline-flex items-center justify-end gap-1 hover:text-gray-900 dark:hover:text-white">
                    <span>Last Sale</span>
                    {renderSortIcon('lastSaleAt')}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-zinc-800 font-medium">
              {displayRows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="text-center py-12 text-gray-400 text-xs">
                    {loadingMerchants || loadingPos
                      ? 'Loading POS sales data...'
                      : 'No shops match your current filters.'}
                  </td>
                </tr>
              ) : (
                displayRows.map((row) => {
                  if (row.kind === 'chain') {
                    const isExpanded =
                      Boolean(expandedChainIds[row.chainId]) ||
                      (chainFilter !== 'all' &&
                        chainFilter !== 'chains_only' &&
                        chainFilter !== 'single_only') ||
                      Boolean(searchQuery.trim());

                    return (
                      <React.Fragment key={`chain-${row.chainId}`}>
                        <tr
                          onClick={() =>
                            setExpandedChainIds((prev) => ({
                              ...prev,
                              [row.chainId]: !prev[row.chainId]
                            }))
                          }
                          className="bg-amber-50/40 dark:bg-zinc-850/70 hover:bg-amber-50 dark:hover:bg-zinc-800/80 cursor-pointer transition-colors"
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2.5">
                              <span className="p-1 rounded-lg bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 shrink-0">
                                {isExpanded ? (
                                  <ChevronDown className="w-3.5 h-3.5" />
                                ) : (
                                  <ChevronRight className="w-3.5 h-3.5" />
                                )}
                              </span>
                              <Building2 className="w-4 h-4 text-amber-600 shrink-0" />
                              <div>
                                <div className="font-extrabold text-gray-900 dark:text-white flex items-center gap-1.5 flex-wrap">
                                  <span>{row.chainName}</span>
                                  <span className="px-1.5 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-400 text-black">
                                    {row.outlets.length} outlets
                                  </span>
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-3 text-right font-extrabold tabular-nums">
                            {row.totals.ordersCount}
                          </td>
                          <td className="px-3 py-3 text-right font-extrabold text-emerald-700 dark:text-emerald-400 tabular-nums">
                            {formatPhp(row.totals.itemSales)}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums text-gray-600 dark:text-zinc-300">
                            {formatPhp(row.totals.discounts)}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums text-rose-600 dark:text-rose-400">
                            {formatPhp(row.totals.refunds)}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums">
                            {formatPhp(row.totals.cash)}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums">
                            {formatPhp(row.totals.eWallet)}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums">
                            {formatPhp(row.totals.card)}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums text-gray-500">
                            {row.totals.voids}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums">
                            {formatPhp(row.totals.avgOrder)}
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap text-gray-500 dark:text-zinc-400">
                            {row.totals.lastSaleAt ? formatRelativeTime(row.totals.lastSaleAt) : 'Never'}
                          </td>
                        </tr>

                        {isExpanded &&
                          row.outlets.map((m) => (
                            <tr
                              key={m.shop.id}
                              onClick={() =>
                                navigate(`/merchants?search=${encodeURIComponent(m.shop.id)}&tab=pos`)
                              }
                              className="bg-gray-50/40 dark:bg-zinc-900/40 hover:bg-amber-50/60 dark:hover:bg-zinc-800/60 cursor-pointer transition-colors"
                            >
                              <td className="px-4 py-3 pl-11">
                                <div className="flex items-center gap-2">
                                  <div className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                                  <span className="font-bold text-gray-900 dark:text-white">
                                    {formatShopDisplayName(m.shop, true)}
                                  </span>
                                  <ExternalLink className="w-3 h-3 text-gray-400 shrink-0" />
                                </div>
                              </td>
                              <td className="px-3 py-3 text-right font-bold tabular-nums">
                                {m.ordersCount}
                              </td>
                              <td className="px-3 py-3 text-right font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                                {formatPhp(m.itemSales)}
                              </td>
                              <td className="px-3 py-3 text-right tabular-nums text-gray-600 dark:text-zinc-300">
                                {formatPhp(m.discounts)}
                              </td>
                              <td className="px-3 py-3 text-right tabular-nums text-rose-600 dark:text-rose-400">
                                {formatPhp(m.refunds)}
                              </td>
                              <td className="px-3 py-3 text-right tabular-nums">
                                {formatPhp(m.cash)}
                              </td>
                              <td className="px-3 py-3 text-right tabular-nums">
                                {formatPhp(m.eWallet)}
                              </td>
                              <td className="px-3 py-3 text-right tabular-nums">
                                {formatPhp(m.card)}
                              </td>
                              <td className="px-3 py-3 text-right tabular-nums text-gray-500">
                                {m.voids}
                              </td>
                              <td className="px-3 py-3 text-right tabular-nums">
                                {formatPhp(m.avgOrder)}
                              </td>
                              <td className="px-4 py-3 text-right whitespace-nowrap text-gray-500 dark:text-zinc-400">
                                {m.lastSaleAt ? formatRelativeTime(m.lastSaleAt) : 'Never'}
                              </td>
                            </tr>
                          ))}
                      </React.Fragment>
                    );
                  }

                  const m = row.metric;
                  return (
                    <tr
                      key={m.shop.id}
                      onClick={() =>
                        navigate(`/merchants?search=${encodeURIComponent(m.shop.id)}&tab=pos`)
                      }
                      className="hover:bg-amber-50/50 dark:hover:bg-zinc-800/50 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 font-bold flex items-center justify-center shrink-0 overflow-hidden">
                            {m.shop.logoUrl ? (
                              <img
                                src={m.shop.logoUrl}
                                alt={m.shop.name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <Store className="w-4 h-4 text-amber-600" />
                            )}
                          </div>
                          <div>
                            <div className="font-bold text-gray-900 dark:text-white flex items-center gap-1.5">
                              <span>{formatShopDisplayName(m.shop, true)}</span>
                              <ExternalLink className="w-3 h-3 text-gray-400 shrink-0" />
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right font-bold tabular-nums">
                        {m.ordersCount}
                      </td>
                      <td className="px-3 py-3 text-right font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                        {formatPhp(m.itemSales)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-gray-600 dark:text-zinc-300">
                        {formatPhp(m.discounts)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-rose-600 dark:text-rose-400">
                        {formatPhp(m.refunds)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {formatPhp(m.cash)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {formatPhp(m.eWallet)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {formatPhp(m.card)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-gray-500">
                        {m.voids}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {formatPhp(m.avgOrder)}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap text-gray-500 dark:text-zinc-400">
                        {m.lastSaleAt ? formatRelativeTime(m.lastSaleAt) : 'Never'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
