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
  Bike
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

    filteredOrders.forEach((o) => {
      if (o.status === 'Delivered') {
        const tot = Number(o.fees?.total || 0);
        const sFee = Number(o.fees?.serviceFee || 0);
        const sub = Number(o.fees?.subtotal || 0);

        totalDeliveredRevenue += tot;
        totalPlatformCommission += sFee + sub * 0.15;
        deliveredCount++;

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

    return {
      totalOrders: filteredOrders.length,
      deliveredCount,
      cancelledCount,
      totalDeliveredRevenue,
      totalPlatformCommission,
      merchantRankings,
      riderRankings,
      cancellationChartData
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
