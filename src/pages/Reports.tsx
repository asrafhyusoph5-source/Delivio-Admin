import React, { useState, useEffect, useMemo } from 'react';
import {
  db,
  collection,
  query,
  limit,
  getDocs,
  Timestamp
} from '../firebase';
import { useCity } from '../context/CityContext';
import { useToast } from '../context/ToastContext';
import { exportToCsv } from '../utils/exportCsv';
import { formatTimestamp } from '../utils/date';
import type { Order } from '../types';
import {
  BarChart3,
  Calendar,
  Download,
  TrendingUp,
  DollarSign,
  Percent,
  AlertTriangle,
  Award,
  Store,
  Bike,
  Wallet,
  CreditCard,
  Banknote
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from 'recharts';

export const Reports: React.FC = () => {
  const { selectedCityId, cities } = useCity();
  const { showError } = useToast();

  const [dateRange, setDateRange] = useState<'today' | '7days' | '30days' | 'all'>('30days');
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch orders
  useEffect(() => {
    const fetchOrders = async () => {
      try {
        setLoading(true);
        const q = query(collection(db, 'orders'), limit(400));
        const snap = await getDocs(q);
        const list: Order[] = [];
        snap.forEach((d) => {
          const dt = d.data();
          list.push({
            id: d.id,
            orderNumber: dt.orderNumber || d.id.substring(0, 8),
            serviceType: dt.serviceType,
            customerId: dt.customerId,
            customerName: dt.customerName,
            merchantId: dt.merchantId,
            merchantName: dt.merchantName,
            riderId: dt.riderId,
            riderName: dt.riderName,
            riderEarning: dt.riderEarning,
            status: dt.status,
            statusHistory: dt.statusHistory || [],
            fees: dt.fees || { subtotal: 0, deliveryFee: 0, serviceFee: 0, discount: 0, total: 0 },
            paymentMethod: dt.paymentMethod,
            cityId: dt.cityId,
            cancelReason: dt.cancelReason,
            createdAt: dt.createdAt
          });
        });
        setOrders(list);
      } catch (err) {
        showError(err);
      } finally {
        setLoading(false);
      }
    };

    fetchOrders();
  }, []);

  // Filter orders by date range and city
  const filteredOrders = useMemo(() => {
    const now = Date.now();
    return orders.filter((o) => {
      if (selectedCityId !== 'all' && o.cityId && o.cityId !== selectedCityId) {
        return false;
      }
      if (dateRange !== 'all') {
        const orderTime = o.createdAt?.seconds ? o.createdAt.seconds * 1000 : 0;
        if (dateRange === 'today') {
          const startOfDay = new Date().setHours(0, 0, 0, 0);
          if (orderTime < startOfDay) return false;
        } else if (dateRange === '7days') {
          if (now - orderTime > 7 * 24 * 3600 * 1000) return false;
        } else if (dateRange === '30days') {
          if (now - orderTime > 30 * 24 * 3600 * 1000) return false;
        }
      }
      return true;
    });
  }, [orders, selectedCityId, dateRange]);

  // Aggregate Metrics
  const metrics = useMemo(() => {
    let totalDeliveredRevenue = 0;
    let totalPlatformCommission = 0;
    let deliveredCount = 0;
    let cancelledCount = 0;

    const cancellationReasonsMap: Record<string, number> = {};
    const merchantMap: Record<string, { name: string; orders: number; revenue: number }> = {};
    const riderMap: Record<string, { name: string; completed: number; earnings: number }> = {};
    const paymentMap: Record<string, { name: string; revenue: number; count: number; color: string }> = {
      cod: { name: 'Cash on Delivery (COD)', revenue: 0, count: 0, color: '#10B981' },
      wallet: { name: 'Delivio Wallet', revenue: 0, count: 0, color: '#FFC107' },
      online: { name: 'Paid Online', revenue: 0, count: 0, color: '#3B82F6' },
      other: { name: 'Other Methods', revenue: 0, count: 0, color: '#8B5CF6' }
    };

    filteredOrders.forEach((o) => {
      const pm = (o.paymentMethod || o.payment?.method || 'cod').toLowerCase();
      const pKey = pm === 'cod' ? 'cod' : pm === 'wallet' ? 'wallet' : pm === 'online' ? 'online' : 'other';

      if (o.status === 'Delivered') {
        const tot = Number(o.fees?.total || 0);
        const sFee = Number(o.fees?.serviceFee || 0);
        const sub = Number(o.fees?.subtotal || 0);

        totalDeliveredRevenue += tot;
        totalPlatformCommission += sFee + sub * 0.15;
        deliveredCount++;

        // Track payment method revenue
        paymentMap[pKey].revenue += tot;
        paymentMap[pKey].count += 1;

        // Merchant ranking
        if (o.merchantId || o.merchantName) {
          const mKey = o.merchantId || o.merchantName || 'Unknown';
          if (!merchantMap[mKey]) {
            merchantMap[mKey] = { name: o.merchantName || mKey, orders: 0, revenue: 0 };
          }
          merchantMap[mKey].orders++;
          merchantMap[mKey].revenue += tot;
        }

        // Rider ranking
        if (o.riderId || o.riderName) {
          const rKey = o.riderId || o.riderName || 'Unknown';
          if (!riderMap[rKey]) {
            riderMap[rKey] = { name: o.riderName || rKey, completed: 0, earnings: 0 };
          }
          riderMap[rKey].completed++;
          riderMap[rKey].earnings += Number(o.riderEarning?.net || 0);
        }
      } else if (o.status === 'Cancelled' || o.status === 'Rejected') {
        cancelledCount++;
        const rsn = o.cancelReason || 'Unspecified';
        cancellationReasonsMap[rsn] = (cancellationReasonsMap[rsn] || 0) + 1;
      }
    });

    const merchantRankings = Object.values(merchantMap)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    const riderRankings = Object.values(riderMap)
      .sort((a, b) => b.completed - a.completed)
      .slice(0, 5);

    const cancellationChartData = Object.entries(cancellationReasonsMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const paymentChartData = [
      {
        name: 'COD',
        label: 'Cash on Delivery',
        revenue: paymentMap.cod.revenue,
        count: paymentMap.cod.count,
        color: '#10B981'
      },
      {
        name: 'Delivio Wallet',
        label: 'Delivio Wallet',
        revenue: paymentMap.wallet.revenue,
        count: paymentMap.wallet.count,
        color: '#FFC107'
      },
      {
        name: 'Paid Online',
        label: 'Paid Online',
        revenue: paymentMap.online.revenue,
        count: paymentMap.online.count,
        color: '#3B82F6'
      }
    ];

    if (paymentMap.other.revenue > 0) {
      paymentChartData.push({
        name: 'Other',
        label: 'Other Methods',
        revenue: paymentMap.other.revenue,
        count: paymentMap.other.count,
        color: '#8B5CF6'
      });
    }

    return {
      totalOrders: filteredOrders.length,
      deliveredCount,
      cancelledCount,
      totalDeliveredRevenue,
      totalPlatformCommission,
      merchantRankings,
      riderRankings,
      cancellationChartData,
      paymentMap,
      paymentChartData
    };
  }, [filteredOrders]);

  const handleExportCsv = () => {
    const rows = filteredOrders.map((o) => ({
      OrderNumber: o.orderNumber,
      Service: o.serviceType,
      Status: o.status,
      Customer: o.customerName,
      Merchant: o.merchantName || '',
      Rider: o.riderName || '',
      Total: o.fees?.total || 0,
      ServiceFee: o.fees?.serviceFee || 0,
      PaymentMethod: o.paymentMethod || 'cod',
      CancelReason: o.cancelReason || '',
      Date: formatTimestamp(o.createdAt)
    }));
    exportToCsv(`delivio_report_${dateRange}_${new Date().toISOString().slice(0, 10)}`, rows);
  };

  const COLORS = ['#FFC107', '#3B82F6', '#10B981', '#EC4899', '#8B5CF6'];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">
            Financial & Performance Reports
          </h1>
          <p className="text-sm text-gray-500 dark:text-zinc-400 mt-0.5">
            Aggregated revenue metrics, commission breakdown, cancellation insights, and rankings.
          </p>
        </div>

        <div className="flex items-center gap-3 self-start sm:self-auto">
          {/* Date Range Picker */}
          <div className="flex p-1 rounded-xl bg-gray-200 dark:bg-zinc-800">
            {(['today', '7days', '30days', 'all'] as const).map((r) => (
              <button
                key={r}
                onClick={() => setDateRange(r)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-all ${
                  dateRange === r
                    ? 'bg-white dark:bg-zinc-900 text-gray-900 dark:text-white shadow-xs'
                    : 'text-gray-500 hover:text-gray-900'
                }`}
              >
                {r === '7days' ? 'Last 7d' : r === '30days' ? 'Last 30d' : r}
              </button>
            ))}
          </div>

          <button
            onClick={handleExportCsv}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs font-bold text-gray-700 dark:text-zinc-300 hover:bg-gray-50 shadow-xs"
          >
            <Download className="w-4 h-4" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 shadow-xs">
          <span className="text-xs font-bold uppercase tracking-wider text-gray-400">
            Delivered Orders
          </span>
          <div className="text-2xl font-black text-gray-900 dark:text-white mt-2">
            {metrics.deliveredCount}{' '}
            <span className="text-xs text-gray-400 font-semibold">/ {metrics.totalOrders} total</span>
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 shadow-xs">
          <span className="text-xs font-bold uppercase tracking-wider text-gray-400">
            Gross Delivered Sales
          </span>
          <div className="text-2xl font-black text-emerald-600 mt-2">
            ₱{metrics.totalDeliveredRevenue.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 shadow-xs">
          <span className="text-xs font-bold uppercase tracking-wider text-gray-400">
            Net Commission
          </span>
          <div className="text-2xl font-black text-amber-600 mt-2">
            ₱{metrics.totalPlatformCommission.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 shadow-xs">
          <span className="text-xs font-bold uppercase tracking-wider text-gray-400">
            Cancellation Volume
          </span>
          <div className="text-2xl font-black text-red-600 mt-2">
            {metrics.cancelledCount}{' '}
            <span className="text-xs font-semibold text-gray-400">
              ({metrics.totalOrders ? ((metrics.cancelledCount / metrics.totalOrders) * 100).toFixed(1) : 0}%)
            </span>
          </div>
        </div>
      </div>

      {/* Revenue by Payment Method Section */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-6 shadow-xs space-y-5">
        <div>
          <h3 className="font-extrabold text-base text-gray-900 dark:text-white flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-amber-500" />
            Revenue by Payment Method
          </h3>
          <p className="text-xs text-gray-400 mt-0.5">
            Breakdown of delivered gross sales and order volume across Cash on Delivery, Delivio Wallet, and Online payments.
          </p>
        </div>

        {/* 3 Metric Cards for Payment Methods */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* COD */}
          <div className="p-4 rounded-2xl bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/50">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                <Banknote className="w-4 h-4 text-emerald-600" /> Cash on Delivery (COD)
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300">
                {metrics.paymentMap.cod.count} orders
              </span>
            </div>
            <div className="text-2xl font-black text-emerald-700 dark:text-emerald-400 mt-2">
              ₱{metrics.paymentMap.cod.revenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <p className="text-[11px] text-emerald-600/80 dark:text-emerald-400/70 mt-1">
              {metrics.totalDeliveredRevenue > 0
                ? ((metrics.paymentMap.cod.revenue / metrics.totalDeliveredRevenue) * 100).toFixed(1)
                : 0}
              % of total delivered sales
            </p>
          </div>

          {/* Delivio Wallet */}
          <div className="p-4 rounded-2xl bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                <Wallet className="w-4 h-4 text-amber-600" /> Delivio Wallet
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-300">
                {metrics.paymentMap.wallet.count} orders
              </span>
            </div>
            <div className="text-2xl font-black text-amber-700 dark:text-amber-400 mt-2">
              ₱{metrics.paymentMap.wallet.revenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <p className="text-[11px] text-amber-600/80 dark:text-amber-400/70 mt-1">
              {metrics.totalDeliveredRevenue > 0
                ? ((metrics.paymentMap.wallet.revenue / metrics.totalDeliveredRevenue) * 100).toFixed(1)
                : 0}
              % of total delivered sales
            </p>
          </div>

          {/* Paid Online */}
          <div className="p-4 rounded-2xl bg-blue-50/60 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/50">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-blue-800 dark:text-blue-300 flex items-center gap-1.5">
                <CreditCard className="w-4 h-4 text-blue-600" /> Paid Online
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/60 text-blue-800 dark:text-blue-300">
                {metrics.paymentMap.online.count} orders
              </span>
            </div>
            <div className="text-2xl font-black text-blue-700 dark:text-blue-400 mt-2">
              ₱{metrics.paymentMap.online.revenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <p className="text-[11px] text-blue-600/80 dark:text-blue-400/70 mt-1">
              {metrics.totalDeliveredRevenue > 0
                ? ((metrics.paymentMap.online.revenue / metrics.totalDeliveredRevenue) * 100).toFixed(1)
                : 0}
              % of total delivered sales
            </p>
          </div>
        </div>

        {/* Revenue Distribution Bar Chart */}
        {metrics.totalDeliveredRevenue > 0 && (
          <div className="pt-2">
            <div className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={metrics.paymentChartData}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) => `₱${v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v}`}
                  />
                  <Tooltip
                    formatter={(val: any) => [`₱${Number(val).toLocaleString()}`, 'Delivered Sales']}
                    contentStyle={{
                      backgroundColor: '#18181b',
                      borderRadius: '10px',
                      color: '#fff',
                      fontSize: '11px'
                    }}
                  />
                  <Bar dataKey="revenue" radius={[6, 6, 0, 0]}>
                    {metrics.paymentChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* Cancellation Reasons Breakdown Chart */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-6 shadow-xs">
        <h3 className="font-extrabold text-base text-gray-900 dark:text-white mb-1">
          Top Cancellation Causes
        </h3>
        <p className="text-xs text-gray-400 mb-4">
          Analysis of driver, merchant, and customer failure reasons during this period.
        </p>

        {metrics.cancellationChartData.length === 0 ? (
          <div className="py-8 text-center text-xs text-gray-400">
            No cancelled orders in this date range.
          </div>
        ) : (
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={metrics.cancellationChartData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                <YAxis dataKey="name" type="category" width={160} tick={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#18181b',
                    borderRadius: '10px',
                    color: '#fff',
                    fontSize: '11px'
                  }}
                />
                <Bar dataKey="count" fill="#EF4444" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Rankings: Top Merchants & Top Riders */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Merchant Rankings */}
        <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-6 shadow-xs">
          <div className="flex items-center gap-2 mb-4">
            <Store className="w-5 h-5 text-amber-500" />
            <h3 className="font-extrabold text-base text-gray-900 dark:text-white">
              Top Merchant Partners by Revenue
            </h3>
          </div>

          <div className="space-y-3">
            {metrics.merchantRankings.length === 0 ? (
              <div className="py-6 text-center text-xs text-gray-400">No merchant sales recorded.</div>
            ) : (
              metrics.merchantRankings.map((m, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-3 rounded-2xl bg-gray-50 dark:bg-zinc-850 text-xs"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-full bg-amber-400 text-black font-black flex items-center justify-center text-[10px]">
                      #{idx + 1}
                    </span>
                    <div>
                      <div className="font-bold text-gray-900 dark:text-white">{m.name}</div>
                      <div className="text-[10px] text-gray-400">{m.orders} delivered orders</div>
                    </div>
                  </div>
                  <div className="font-black text-amber-600 text-sm">
                    ₱{m.revenue.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Rider Rankings */}
        <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-6 shadow-xs">
          <div className="flex items-center gap-2 mb-4">
            <Bike className="w-5 h-5 text-emerald-500" />
            <h3 className="font-extrabold text-base text-gray-900 dark:text-white">
              Top Performing Fleet Riders
            </h3>
          </div>

          <div className="space-y-3">
            {metrics.riderRankings.length === 0 ? (
              <div className="py-6 text-center text-xs text-gray-400">No rider completions recorded.</div>
            ) : (
              metrics.riderRankings.map((r, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-3 rounded-2xl bg-gray-50 dark:bg-zinc-850 text-xs"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-full bg-emerald-500 text-white font-black flex items-center justify-center text-[10px]">
                      #{idx + 1}
                    </span>
                    <div>
                      <div className="font-bold text-gray-900 dark:text-white">{r.name}</div>
                      <div className="text-[10px] text-gray-400">{r.completed} trips completed</div>
                    </div>
                  </div>
                  <div className="font-black text-emerald-600 text-sm">
                    ₱{r.earnings.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
