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
import { ExportDateModal } from '../components/common/ExportDateModal';
import { formatTimestamp } from '../utils/date';
import { getChainOptions, resolveOrderChainId, resolveOrderMerchantDisplay } from '../utils/outletUtils';
import type { Order, Merchant } from '../types';
import {
  VEHICLE_TYPES,
  VEHICLE_LABELS,
  SERVICE_LABELS,
  type VehicleType
} from '../constants';
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
  Car,
  Wallet,
  CreditCard,
  Banknote,
  Layers,
  Building2
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
  const [chainFilter, setChainFilter] = useState<string>('all');
  const [orders, setOrders] = useState<Order[]>([]);
  const [merchantsById, setMerchantsById] = useState<Record<string, Merchant>>({});
  const [loading, setLoading] = useState(true);

  // Fetch orders & merchants
  useEffect(() => {
    const fetchOrders = async () => {
      try {
        setLoading(true);
        const [snap, mSnap] = await Promise.all([
          getDocs(query(collection(db, 'orders'), limit(400))),
          getDocs(query(collection(db, 'merchants'), limit(300)))
        ]);

        const mMap: Record<string, Merchant> = {};
        mSnap.forEach((d) => {
          const dt = d.data();
          mMap[d.id] = {
            id: d.id,
            name: dt.name || 'Store',
            ownerName: dt.ownerName || '',
            email: dt.email || '',
            phone: dt.phone || '',
            type: dt.type || 'food',
            status: dt.status || 'active',
            isOpen: Boolean(dt.isOpen),
            address: dt.address || '',
            lat: Number(dt.lat) || 0,
            lng: Number(dt.lng) || 0,
            commissionRate: dt.commissionRate ?? 15,
            chainId: dt.chainId,
            chainName: dt.chainName,
            isBranch: dt.isBranch,
            branchName: dt.branchName,
            branchCode: dt.branchCode
          };
        });
        setMerchantsById(mMap);

        const list: Order[] = [];
        snap.forEach((d) => {
          const dt = d.data();
          list.push({
            id: d.id,
            orderNumber: dt.orderNumber || d.id.substring(0, 8),
            serviceType: dt.serviceType,
            vehicleType: dt.vehicleType,
            customerId: dt.customerId,
            customerName: dt.customerName,
            merchantId: dt.merchantId,
            merchantName: dt.merchantName,
            branchName: dt.branchName,
            branchCode: dt.branchCode,
            chainId: dt.chainId,
            riderId: dt.riderId,
            riderName: dt.riderName,
            riderVehicle: dt.riderVehicle,
            riderEarning: dt.riderEarning,
            status: dt.status,
            statusHistory: dt.statusHistory || [],
            fees: {
              subtotal: dt.fees?.subtotal || 0,
              deliveryFee: dt.fees?.deliveryFee || 0,
              serviceFee: dt.fees?.serviceFee || 0,
              discount: dt.fees?.discount || 0,
              tip: dt.fees?.tip || 0,
              total: dt.fees?.total || 0
            },
            isPickup: Boolean(dt.isPickup || dt.fulfillmentType === 'pickup' || dt.serviceType === 'pickup'),
            fulfillmentType: dt.fulfillmentType,
            scheduledFor: dt.scheduledFor,
            paymentMethod: dt.paymentMethod,
            payment: dt.payment,
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

  const chainOptions = useMemo(() => getChainOptions(Object.values(merchantsById)), [merchantsById]);

  // Filter orders by date range, city, and chain
  const filteredOrders = useMemo(() => {
    const now = Date.now();
    return orders.filter((o) => {
      if (selectedCityId !== 'all' && o.cityId && o.cityId !== selectedCityId) {
        return false;
      }
      if (chainFilter !== 'all') {
        const orderChainId = resolveOrderChainId(o, merchantsById);
        if (orderChainId !== chainFilter) return false;
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
  }, [orders, selectedCityId, dateRange, chainFilter, merchantsById]);

  // Aggregate Metrics
  const metrics = useMemo(() => {
    let totalDeliveredRevenue = 0;
    let totalPlatformCommission = 0;
    let deliveredCount = 0;
    let cancelledCount = 0;

    const cancellationReasonsMap: Record<string, number> = {};
    const merchantMap: Record<string, { name: string; orders: number; revenue: number }> = {};
    const driverMap: Record<string, { name: string; completed: number; earnings: number }> = {};
    const paymentMap: Record<string, { name: string; revenue: number; count: number; color: string }> = {
      cod: { name: 'Cash on Delivery (COD)', revenue: 0, count: 0, color: '#10B981' },
      wallet: { name: 'Delivio Wallet', revenue: 0, count: 0, color: '#FFC107' },
      online: { name: 'Paid Online', revenue: 0, count: 0, color: '#3B82F6' },
      other: { name: 'Other Methods', revenue: 0, count: 0, color: '#8B5CF6' }
    };

    // Orders and revenue by service type
    const serviceMap: Record<string, { name: string; orders: number; revenue: number; color: string }> = {
      food: { name: 'Delivio Food', orders: 0, revenue: 0, color: '#FFC107' },
      convenience: { name: 'Delivio Mart', orders: 0, revenue: 0, color: '#3B82F6' },
      parcel: { name: 'Delivio Parcel', orders: 0, revenue: 0, color: '#10B981' },
      pabili: { name: 'Delivio Pabili', orders: 0, revenue: 0, color: '#EC4899' },
      request_rider: { name: 'Delivio Instant', orders: 0, revenue: 0, color: '#8B5CF6' },
      taxi: { name: 'Delivio Taxi', orders: 0, revenue: 0, color: '#0EA5E9' }
    };

    // Taxi orders & revenue by vehicle type
    const taxiVehicleMap: Record<VehicleType, { name: string; orders: number; revenue: number; color: string }> = {
      motorcycle: { name: 'Motorcycle', orders: 0, revenue: 0, color: '#10B981' },
      tricycle: { name: 'Tricycle', orders: 0, revenue: 0, color: '#F59E0B' },
      car4: { name: '4-Seater Car', orders: 0, revenue: 0, color: '#3B82F6' },
      car8: { name: '8-Seater Car', orders: 0, revenue: 0, color: '#8B5CF6' }
    };

    filteredOrders.forEach((o) => {
      const pm = (o.paymentMethod || o.payment?.method || 'cod').toLowerCase();
      const pKey = pm === 'cod' ? 'cod' : pm === 'wallet' ? 'wallet' : pm === 'online' ? 'online' : 'other';
      const svc = o.serviceType || 'food';

      if (serviceMap[svc]) {
        serviceMap[svc].orders++;
      }

      if (svc === 'taxi') {
        const vtype = (o.vehicleType || o.riderVehicle?.vehicleType || 'motorcycle') as VehicleType;
        const validV: VehicleType = ['motorcycle', 'tricycle', 'car4', 'car8'].includes(vtype) ? vtype : 'motorcycle';
        taxiVehicleMap[validV].orders++;
      }

      if (o.status === 'Delivered' || o.status === 'Completed') {
        const tip = Number(o.fees?.tip || 0);
        const tot = Math.max(0, Number(o.fees?.total || 0) - tip);
        const sFee = Number(o.fees?.serviceFee || 0);
        const sub = Number(o.fees?.subtotal || 0);

        totalDeliveredRevenue += tot;
        totalPlatformCommission += sFee + sub * 0.15;
        deliveredCount++;

        // Track payment method revenue
        paymentMap[pKey].revenue += tot;
        paymentMap[pKey].count += 1;

        if (serviceMap[svc]) {
          serviceMap[svc].revenue += tot;
        }

        if (svc === 'taxi') {
          const vtype = (o.vehicleType || o.riderVehicle?.vehicleType || 'motorcycle') as VehicleType;
          const validV: VehicleType = ['motorcycle', 'tricycle', 'car4', 'car8'].includes(vtype) ? vtype : 'motorcycle';
          taxiVehicleMap[validV].revenue += tot;
        }

        // Merchant ranking
        if (o.merchantId || o.merchantName) {
          const mKey = o.merchantId || o.merchantName || 'Unknown';
          if (!merchantMap[mKey]) {
            merchantMap[mKey] = {
              name: resolveOrderMerchantDisplay(o, merchantsById, true) || o.merchantName || mKey,
              orders: 0,
              revenue: 0
            };
          }
          merchantMap[mKey].orders++;
          merchantMap[mKey].revenue += tot;
        }

        // Driver ranking
        if (o.riderId || o.riderName) {
          const rKey = o.riderId || o.riderName || 'Unknown';
          if (!driverMap[rKey]) {
            driverMap[rKey] = { name: o.riderName || rKey, completed: 0, earnings: 0 };
          }
          driverMap[rKey].completed++;
          driverMap[rKey].earnings += Number(o.riderEarning?.net || 0);
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

    const driverRankings = Object.values(driverMap)
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

    const serviceChartData = Object.values(serviceMap);
    const taxiVehicleChartData = Object.values(taxiVehicleMap);

    return {
      totalOrders: filteredOrders.length,
      deliveredCount,
      cancelledCount,
      totalDeliveredRevenue,
      totalPlatformCommission,
      merchantRankings,
      driverRankings,
      cancellationChartData,
      paymentMap,
      paymentChartData,
      serviceChartData,
      taxiVehicleChartData
    };
  }, [filteredOrders, merchantsById]);

  // Combined Chain Totals & Per-Outlet Breakdown
  const chainBreakdown = useMemo(() => {
    if (chainOptions.length === 0) return null;
    const targetChain = chainFilter !== 'all' ? chainOptions.find((c) => c.chainId === chainFilter) : null;

    if (targetChain) {
      const byOutlet = new Map<string, { label: string; orders: number; delivered: number; revenue: number; commission: number }>();
      targetChain.outlets.forEach((o) => {
        byOutlet.set(o.id, {
          label: `${o.name}${o.branchName ? ` - ${o.branchName}` : ''}${o.branchCode ? ` (${o.branchCode})` : ''}`,
          orders: 0,
          delivered: 0,
          revenue: 0,
          commission: 0
        });
      });

      let totalOrders = 0;
      let totalDelivered = 0;
      let totalRevenue = 0;
      let totalComm = 0;

      filteredOrders.forEach((o) => {
        totalOrders += 1;
        const isDeliv = o.status === 'Delivered' || o.status === 'Completed';
        const tip = Number(o.fees?.tip || 0);
        const tot = Math.max(0, Number(o.fees?.total || 0) - tip);
        const comm = Number(o.fees?.serviceFee || 0) + Number(o.fees?.subtotal || 0) * ((merchantsById[o.merchantId || '']?.commissionRate ?? 15) / 100);

        if (isDeliv) {
          totalDelivered += 1;
          totalRevenue += tot;
          totalComm += comm;
        }

        const key = o.merchantId || 'unknown';
        if (!byOutlet.has(key)) {
          byOutlet.set(key, {
            label: resolveOrderMerchantDisplay(o, merchantsById, true) || key,
            orders: 0,
            delivered: 0,
            revenue: 0,
            commission: 0
          });
        }
        const entry = byOutlet.get(key)!;
        entry.orders += 1;
        if (isDeliv) {
          entry.delivered += 1;
          entry.revenue += tot;
          entry.commission += comm;
        }
      });

      return {
        mode: 'single_chain' as const,
        chainName: targetChain.chainName,
        totalOrders,
        totalDelivered,
        totalRevenue,
        totalComm,
        rows: Array.from(byOutlet.values())
      };
    }

    // Overview across all chains when filter is 'all'
    const chainsSummary = chainOptions.map((c) => {
      const outletIds = new Set(c.outlets.map((o) => o.id));
      let ordersCount = 0;
      let delivered = 0;
      let revenue = 0;
      filteredOrders.forEach((o) => {
        const cId = resolveOrderChainId(o, merchantsById);
        if (cId === c.chainId || (o.merchantId && outletIds.has(o.merchantId))) {
          ordersCount += 1;
          if (o.status === 'Delivered' || o.status === 'Completed') {
            delivered += 1;
            revenue += Math.max(0, Number(o.fees?.total || 0) - Number(o.fees?.tip || 0));
          }
        }
      });
      return {
        chainId: c.chainId,
        chainName: c.chainName,
        outletCount: c.outlets.length,
        ordersCount,
        delivered,
        revenue
      };
    });

    return {
      mode: 'all_chains' as const,
      chainsSummary
    };
  }, [chainOptions, chainFilter, filteredOrders, merchantsById]);

  const [exportModalOpen, setExportModalOpen] = useState(false);

  const handleExportCsvWithDateFilter = (startDate?: string, endDate?: string) => {
    let list = [...orders];
    if (startDate) {
      const startMs = new Date(`${startDate}T00:00:00`).getTime();
      list = list.filter((o) => {
        const t = o.createdAt?.toMillis ? o.createdAt.toMillis() : new Date(o.createdAt || 0).getTime();
        return t >= startMs;
      });
    }
    if (endDate) {
      const endMs = new Date(`${endDate}T23:59:59`).getTime();
      list = list.filter((o) => {
        const t = o.createdAt?.toMillis ? o.createdAt.toMillis() : new Date(o.createdAt || 0).getTime();
        return t <= endMs;
      });
    } else if (!startDate && !endDate) {
      list = filteredOrders;
    }

    const rows = list.map((o) => ({
      OrderNumber: o.orderNumber,
      Fulfillment: o.serviceType === 'taxi' ? 'Delivio Taxi Ride' : o.isPickup ? 'Pick Up' : o.scheduledFor ? 'Scheduled' : 'Delivery',
      Service: SERVICE_LABELS[o.serviceType] || o.serviceType,
      VehicleType: o.vehicleType || o.riderVehicle?.vehicleType || '',
      Status: o.status,
      Customer: o.customerName,
      Merchant: resolveOrderMerchantDisplay(o, merchantsById, true) || o.merchantName || '',
      BranchName: o.branchName || merchantsById[o.merchantId || '']?.branchName || '',
      BranchCode: o.branchCode || merchantsById[o.merchantId || '']?.branchCode || '',
      ChainId: resolveOrderChainId(o, merchantsById) || '',
      Driver: o.isPickup ? 'No driver (Pick Up)' : o.riderName || '',
      Tip: o.fees?.tip || 0,
      TotalDue: o.fees?.total || 0,
      TotalSalesExclTip: Math.max(0, (o.fees?.total || 0) - (o.fees?.tip || 0)),
      ServiceFee: o.fees?.serviceFee || 0,
      PaymentMethod: o.paymentMethod || 'cod',
      CancelReason: o.cancelReason || '',
      Date: formatTimestamp(o.createdAt)
    }));
    exportToCsv(`delivio_report_${dateRange}_${new Date().toISOString().slice(0, 10)}`, rows);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">
            Financial & Performance Reports
          </h1>
          <p className="text-sm text-gray-500 dark:text-zinc-400 mt-0.5">
            Aggregated revenue metrics, service breakdowns, taxi fleet analytics, and driver earnings.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 self-start sm:self-auto">
          {/* Chain Filter */}
          {chainOptions.length > 0 && (
            <select
              value={chainFilter}
              onChange={(e) => setChainFilter(e.target.value)}
              className="px-3 py-2 rounded-xl border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs font-bold text-gray-800 dark:text-zinc-200 focus:outline-hidden focus:ring-2 focus:ring-amber-400"
            >
              <option value="all">All Merchants &amp; Chains</option>
              {chainOptions.map((c) => (
                <option key={c.chainId} value={c.chainId}>
                  Chain: {c.chainName} ({c.outlets.length} outlets)
                </option>
              ))}
            </select>
          )}

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
            onClick={() => setExportModalOpen(true)}
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
            Delivered / Completed
          </span>
          <div className="text-2xl font-black text-gray-900 dark:text-white mt-2">
            {metrics.deliveredCount}{' '}
            <span className="text-xs text-gray-400 font-semibold">/ {metrics.totalOrders} total</span>
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 shadow-xs">
          <span className="text-xs font-bold uppercase tracking-wider text-gray-400">
            Gross Completed Sales (excl. tips)
          </span>
          <div className="text-2xl font-black text-emerald-600 mt-2">
            ₱{metrics.totalDeliveredRevenue.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 shadow-xs">
          <span className="text-xs font-bold uppercase tracking-wider text-gray-400">
            Net Platform Commission
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

      {/* Combined Chain Totals & Per-Outlet Breakdown */}
      {chainBreakdown && (
        <div className="bg-white dark:bg-zinc-900 border border-amber-200 dark:border-amber-900/50 rounded-3xl p-6 shadow-xs space-y-4">
          {chainBreakdown.mode === 'single_chain' ? (
            <>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-gray-100 dark:border-zinc-800">
                <div className="flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-amber-500" />
                  <div>
                    <h3 className="font-extrabold text-base text-gray-900 dark:text-white">
                      Chain Combined Report: {chainBreakdown.chainName}
                    </h3>
                    <p className="text-xs text-gray-400">
                      Combined totals ({chainBreakdown.totalOrders} orders, {chainBreakdown.totalDelivered} delivered, ₱{chainBreakdown.totalRevenue.toFixed(2)} gross) &amp; per-outlet breakdown.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setChainFilter('all')}
                  className="text-xs font-bold text-amber-600 hover:underline self-start sm:self-auto"
                >
                  Show all chains
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-50 dark:bg-zinc-850/60 uppercase font-bold text-gray-500 border-b border-gray-100 dark:border-zinc-800">
                    <tr>
                      <th className="px-4 py-2.5">Outlet</th>
                      <th className="px-4 py-2.5">Total Orders</th>
                      <th className="px-4 py-2.5">Delivered</th>
                      <th className="px-4 py-2.5">Gross Sales</th>
                      <th className="px-4 py-2.5">Est. Commission</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
                    {chainBreakdown.rows.map((r, i) => (
                      <tr key={i} className="hover:bg-gray-50 dark:hover:bg-zinc-800/40">
                        <td className="px-4 py-2.5 font-bold text-gray-900 dark:text-white">{r.label}</td>
                        <td className="px-4 py-2.5">{r.orders}</td>
                        <td className="px-4 py-2.5">{r.delivered}</td>
                        <td className="px-4 py-2.5 font-bold text-emerald-600">₱{r.revenue.toFixed(2)}</td>
                        <td className="px-4 py-2.5 font-bold text-amber-600">₱{r.commission.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 pb-2 border-b border-gray-100 dark:border-zinc-800">
                <Building2 className="w-5 h-5 text-amber-500" />
                <div>
                  <h3 className="font-extrabold text-base text-gray-900 dark:text-white">
                    Multi-Outlet Chains Summary
                  </h3>
                  <p className="text-xs text-gray-400">
                    Combined totals per chain. Click a chain to inspect its per-outlet breakdown.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {chainBreakdown.chainsSummary.map((c) => (
                  <button
                    key={c.chainId}
                    type="button"
                    onClick={() => setChainFilter(c.chainId)}
                    className="p-3.5 rounded-2xl bg-gray-50 dark:bg-zinc-850 hover:bg-amber-50 dark:hover:bg-zinc-800 border border-gray-200 dark:border-zinc-800 text-left transition-colors flex items-center justify-between"
                  >
                    <div>
                      <div className="font-bold text-xs text-gray-900 dark:text-white">
                        {c.chainName} ({c.outletCount} outlets)
                      </div>
                      <div className="text-[11px] text-gray-400 mt-0.5">
                        {c.delivered} delivered / {c.ordersCount} total orders
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-black text-emerald-600 text-xs">₱{c.revenue.toFixed(2)}</div>
                      <div className="text-[10px] text-amber-600 font-bold">Breakdown &rarr;</div>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Service Type & Taxi Fleet Performance Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Orders & Revenue by Service Type */}
        <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-gray-100 dark:border-zinc-800">
            <div>
              <h3 className="font-extrabold text-base text-gray-900 dark:text-white flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-amber-500" />
                Orders & Revenue by Service Type
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">
                Breakdown of demand across Delivery and Taxi ride-hailing services.
              </p>
            </div>
          </div>

          <div className="space-y-3">
            {metrics.serviceChartData.map((s) => (
              <div
                key={s.name}
                className="p-3.5 rounded-2xl bg-gray-50 dark:bg-zinc-850 flex items-center justify-between text-xs"
              >
                <div className="flex items-center gap-3">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                  <div>
                    <span className="font-bold text-gray-900 dark:text-white block">{s.name}</span>
                    <span className="text-[11px] text-gray-400">{s.orders} total order(s)</span>
                  </div>
                </div>
                <div className="text-right">
                  <span className="font-extrabold text-gray-900 dark:text-white block">
                    ₱{s.revenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <span className="text-[10px] text-gray-400">Delivered sales</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Taxi Performance by Vehicle Type */}
        <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-gray-100 dark:border-zinc-800">
            <div>
              <h3 className="font-extrabold text-base text-gray-900 dark:text-white flex items-center gap-2">
                <Car className="w-5 h-5 text-blue-500" />
                Delivio Taxi by Vehicle Type
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">
                Passenger rides and revenue split by motorcycle, tricycle, and cars.
              </p>
            </div>
          </div>

          <div className="space-y-3">
            {metrics.taxiVehicleChartData.map((v) => (
              <div
                key={v.name}
                className="p-3.5 rounded-2xl bg-gray-50 dark:bg-zinc-850 flex items-center justify-between text-xs"
              >
                <div className="flex items-center gap-3">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: v.color }} />
                  <div>
                    <span className="font-bold text-gray-900 dark:text-white block">{v.name}</span>
                    <span className="text-[11px] text-gray-400">{v.orders} taxi trip(s) booked</span>
                  </div>
                </div>
                <div className="text-right">
                  <span className="font-extrabold text-blue-600 dark:text-blue-400 block">
                    ₱{v.revenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <span className="text-[10px] text-gray-400">Completed fares</span>
                </div>
              </div>
            ))}
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

      {/* Rankings: Top Merchants & Top Drivers */}
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

        {/* Driver Rankings */}
        <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-6 shadow-xs">
          <div className="flex items-center gap-2 mb-4">
            <Car className="w-5 h-5 text-emerald-500" />
            <h3 className="font-extrabold text-base text-gray-900 dark:text-white">
              Top Performing Fleet Drivers
            </h3>
          </div>

          <div className="space-y-3">
            {metrics.driverRankings.length === 0 ? (
              <div className="py-6 text-center text-xs text-gray-400">No driver completions recorded.</div>
            ) : (
              metrics.driverRankings.map((r, idx) => (
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

      {/* Export Reports Date Filter Modal */}
      {exportModalOpen && (
        <ExportDateModal
          isOpen={exportModalOpen}
          onClose={() => setExportModalOpen(false)}
          title="Export Financial & Performance Report"
          description="Filter orders included in the analytical report by order date or export current period."
          totalRecords={orders.length}
          onExport={handleExportCsvWithDateFilter}
        />
      )}
    </div>
  );
};
