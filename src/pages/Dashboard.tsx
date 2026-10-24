import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  db,
  collection,
  query,
  limit,
  getDocs,
  onSnapshot,
  where
} from '../firebase';
import { useCity } from '../context/CityContext';
import { useBadgeCounts } from '../context/BadgeCountsContext';
import type { Order, Merchant, UserProfile } from '../types';
import { VEHICLE_TYPES, VEHICLE_LABELS, type VehicleType } from '../constants';
import {
  ShoppingBag,
  DollarSign,
  Percent,
  Users,
  Store,
  Car,
  Clock,
  AlertTriangle,
  ArrowUpRight,
  TrendingUp,
  ShieldAlert,
  Award,
  FileCheck,
  RefreshCw,
  Layers
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import { CardSkeleton } from '../components/common/SkeletonLoader';
import { formatRelativeTime } from '../utils/date';

export const Dashboard: React.FC = () => {
  const { selectedCityId, cities } = useCity();
  const { totalPendingAppsCount, pendingTierEventsCount } = useBadgeCounts();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<Order[]>([]);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [customersCount, setCustomersCount] = useState(0);
  const [onlineRidersCount, setOnlineRidersCount] = useState(0);
  const [activeOrders, setActiveOrders] = useState<Order[]>([]);
  const [recentIncidents, setRecentIncidents] = useState<any[]>([]);

  // 1. Fetch on-demand data (Orders, Merchants, Customers)
  const fetchDashboardData = async () => {
    try {
      setLoading(true);

      // Orders (recent up to 300)
      const ordersRef = collection(db, 'orders');
      const ordersSnap = await getDocs(query(ordersRef, limit(300)));
      const ordersList: Order[] = [];
      ordersSnap.forEach((docSnap) => {
        const d = docSnap.data();
        ordersList.push({
          id: docSnap.id,
          orderNumber: d.orderNumber || docSnap.id.substring(0, 8).toUpperCase(),
          serviceType: d.serviceType || 'food',
          vehicleType: d.vehicleType,
          customerId: d.customerId || '',
          customerName: d.customerName || 'Customer',
          merchantId: d.merchantId,
          merchantName: d.merchantName,
          riderId: d.riderId,
          riderName: d.riderName,
          riderVehicle: d.riderVehicle,
          status: d.status || 'Placed Order',
          statusHistory: d.statusHistory || [],
          items: d.items || [],
          fees: {
            subtotal: d.fees?.subtotal || 0,
            deliveryFee: d.fees?.deliveryFee || 0,
            serviceFee: d.fees?.serviceFee || 0,
            discount: d.fees?.discount || 0,
            tip: d.fees?.tip || 0,
            total: d.fees?.total || 0
          },
          isPickup: Boolean(d.isPickup || d.fulfillmentType === 'pickup' || d.serviceType === 'pickup'),
          fulfillmentType: d.fulfillmentType,
          scheduledFor: d.scheduledFor,
          paymentMethod: d.paymentMethod || 'cod',
          cityId: d.cityId || '',
          cancelReason: d.cancelReason,
          cancelFault: d.cancelFault,
          createdAt: d.createdAt,
          deliveredAt: d.deliveredAt
        });
      });
      // Sort in JS newest first
      ordersList.sort((a, b) => {
        const tA = a.createdAt?.seconds ? a.createdAt.seconds * 1000 : 0;
        const tB = b.createdAt?.seconds ? b.createdAt.seconds * 1000 : 0;
        return tB - tA;
      });
      setOrders(ordersList);

      // Merchants
      const merchRef = collection(db, 'merchants');
      const merchSnap = await getDocs(query(merchRef, limit(200)));
      const merchList: Merchant[] = [];
      merchSnap.forEach((docSnap) => {
        const d = docSnap.data();
        merchList.push({
          id: docSnap.id,
          name: d.name || 'Merchant',
          ownerName: d.ownerName || '',
          email: d.email || '',
          phone: d.phone || '',
          type: d.type || 'food',
          status: d.status || 'active',
          isOpen: Boolean(d.isOpen),
          cityId: d.cityId || '',
          address: d.address || '',
          lat: d.lat || 0,
          lng: d.lng || 0,
          commissionRate: d.commissionRate ?? 15
        });
      });
      setMerchants(merchList);

      // Customers count query
      const custRef = collection(db, 'users');
      const custSnap = await getDocs(query(custRef, where('role', '==', 'customer'), limit(300)));
      setCustomersCount(custSnap.size);

    } catch (err) {
      console.error('Error loading dashboard data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  // 2. Real-time Listeners (Online drivers, Active orders, Safety Alerts)
  useEffect(() => {
    const qRiders = query(collection(db, 'riders'), where('isOnline', '==', true));
    const unsubRiders = onSnapshot(qRiders, (snap) => {
      let count = 0;
      snap.forEach((d) => {
        const data = d.data();
        if (selectedCityId === 'all' || data.cityId === selectedCityId) {
          count++;
        }
      });
      setOnlineRidersCount(count);
    });

    const qOrders = query(collection(db, 'orders'));
    const unsubOrders = onSnapshot(qOrders, (snap) => {
      const active: Order[] = [];
      snap.forEach((d) => {
        const data = d.data();
        const st = data.status;
        if (st !== 'Delivered' && st !== 'Completed' && st !== 'Rejected' && st !== 'Cancelled') {
          active.push({
            id: d.id,
            orderNumber: data.orderNumber || d.id.substring(0, 8),
            serviceType: data.serviceType || 'food',
            vehicleType: data.vehicleType,
            riderId: data.riderId,
            riderName: data.riderName,
            status: data.status,
            createdAt: data.createdAt,
            cityId: data.cityId || '',
            fees: data.fees,
            isPickup: Boolean(data.isPickup || data.fulfillmentType === 'pickup' || data.serviceType === 'pickup'),
            fulfillmentType: data.fulfillmentType,
            customerName: data.customerName || 'Customer',
            merchantName: data.merchantName
          } as Order);
        }
      });
      setActiveOrders(active);
    });

    const qNotifs = query(collection(db, 'adminNotifications'), limit(20));
    const unsubNotifs = onSnapshot(qNotifs, (snap) => {
      const inc: any[] = [];
      snap.forEach((d) => {
        const dt = d.data();
        if (dt.type === 'sos' || dt.type === 'incident') {
          inc.push({ id: d.id, ...dt });
        }
      });
      setRecentIncidents(inc.slice(0, 5));
    });

    return () => {
      unsubRiders();
      unsubOrders();
      unsubNotifs();
    };
  }, [selectedCityId]);

  // City filtered data
  const filteredOrders = useMemo(() => {
    if (selectedCityId === 'all') return orders;
    return orders.filter((o) => o.cityId === selectedCityId);
  }, [orders, selectedCityId]);

  const filteredMerchants = useMemo(() => {
    if (selectedCityId === 'all') return merchants;
    return merchants.filter((m) => m.cityId === selectedCityId);
  }, [merchants, selectedCityId]);

  const filteredActiveOrders = useMemo(() => {
    if (selectedCityId === 'all') return activeOrders;
    return activeOrders.filter((o) => o.cityId === selectedCityId);
  }, [activeOrders, selectedCityId]);

  // KPIs Calculations
  const kpis = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let ordersTodayCount = 0;
    let deliveredRevenue = 0;
    let platformCommission = 0;
    let totalDeliveryTimeMin = 0;
    let deliveredCount = 0;
    let cancelledCount = 0;

    filteredOrders.forEach((o) => {
      const orderDate = o.createdAt?.seconds ? new Date(o.createdAt.seconds * 1000) : null;
      if (orderDate && orderDate >= today) {
        ordersTodayCount++;
      }

      if (o.status === 'Delivered' || o.status === 'Completed') {
        const tip = Number(o.fees?.tip) || 0;
        const tot = Math.max(0, (Number(o.fees?.total) || 0) - tip);
        const sFee = Number(o.fees?.serviceFee) || 0;
        const sub = Number(o.fees?.subtotal) || 0;
        deliveredRevenue += tot;
        platformCommission += sFee + sub * 0.15;
        deliveredCount++;

        if (o.deliveredAt?.seconds && o.createdAt?.seconds) {
          const diffMin = (o.deliveredAt.seconds - o.createdAt.seconds) / 60;
          if (diffMin > 0 && diffMin < 300) {
            totalDeliveryTimeMin += diffMin;
          }
        }
      }

      if (o.status === 'Cancelled' || o.status === 'Rejected') {
        cancelledCount++;
      }
    });

    const avgDeliveryTime = deliveredCount > 0 ? Math.round(totalDeliveryTimeMin / deliveredCount) : 28;
    const cancellationRate =
      filteredOrders.length > 0
        ? ((cancelledCount / filteredOrders.length) * 100).toFixed(1)
        : '0.0';

    const openMerchantsCount = filteredMerchants.filter((m) => m.isOpen).length;

    return {
      ordersTodayCount,
      deliveredRevenue,
      platformCommission,
      customersCount,
      openMerchantsCount,
      onlineRidersCount,
      avgDeliveryTime,
      cancellationRate
    };
  }, [filteredOrders, filteredMerchants, customersCount, onlineRidersCount]);

  // 14 Days Orders Chart data
  const ordersPerDayData = useMemo(() => {
    const daysMap: Record<string, { date: string; orders: number; revenue: number }> = {};
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      daysMap[key] = { date: key, orders: 0, revenue: 0 };
    }

    filteredOrders.forEach((o) => {
      if (o.createdAt?.seconds) {
        const d = new Date(o.createdAt.seconds * 1000);
        const key = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        if (daysMap[key]) {
          daysMap[key].orders++;
          if (o.status === 'Delivered' || o.status === 'Completed') {
            const tip = Number(o.fees?.tip) || 0;
            daysMap[key].revenue += Math.max(0, (Number(o.fees?.total) || 0) - tip);
          }
        }
      }
    });

    return Object.values(daysMap);
  }, [filteredOrders]);

  // Orders by service type including taxi
  const serviceTypeData = useMemo(() => {
    const counts: Record<string, number> = {
      food: 0,
      convenience: 0,
      parcel: 0,
      pabili: 0,
      request_rider: 0,
      taxi: 0
    };
    filteredOrders.forEach((o) => {
      const t = o.serviceType || 'food';
      counts[t] = (counts[t] || 0) + 1;
    });

    return [
      { name: 'Food', value: counts.food, color: '#FFC107' },
      { name: 'Convenience', value: counts.convenience, color: '#3B82F6' },
      { name: 'Parcel', value: counts.parcel, color: '#10B981' },
      { name: 'Pabili', value: counts.pabili, color: '#EC4899' },
      { name: 'Request Driver', value: counts.request_rider, color: '#8B5CF6' },
      { name: 'Taxi Service', value: counts.taxi, color: '#0EA5E9' }
    ];
  }, [filteredOrders]);

  // Taxi breakdown by vehicle type
  const taxiVehicleData = useMemo(() => {
    const vCounts: Record<VehicleType, { orders: number; revenue: number }> = {
      motorcycle: { orders: 0, revenue: 0 },
      tricycle: { orders: 0, revenue: 0 },
      car4: { orders: 0, revenue: 0 },
      car8: { orders: 0, revenue: 0 }
    };

    filteredOrders.forEach((o) => {
      if (o.serviceType === 'taxi') {
        const vtype = (o.vehicleType || o.riderVehicle?.vehicleType || 'motorcycle') as VehicleType;
        const validVType: VehicleType = ['motorcycle', 'tricycle', 'car4', 'car8'].includes(vtype)
          ? vtype
          : 'motorcycle';

        vCounts[validVType].orders++;
        if (o.status === 'Delivered' || o.status === 'Completed') {
          vCounts[validVType].revenue += Number(o.fees?.total || 0);
        }
      }
    });

    return VEHICLE_TYPES.map((v) => ({
      id: v.id,
      name: v.name,
      orders: vCounts[v.id].orders,
      revenue: vCounts[v.id].revenue,
      badgeColor: v.badgeColor
    }));
  }, [filteredOrders]);

  // Orders by city data
  const ordersByCityData = useMemo(() => {
    const cityMap: Record<string, number> = {};
    orders.forEach((o) => {
      const cId = o.cityId || 'unknown';
      const cName = cities.find((c) => c.id === cId)?.name || cId;
      cityMap[cName] = (cityMap[cName] || 0) + 1;
    });
    return Object.entries(cityMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }, [orders, cities]);

  // Orders waiting for driver over 5 minutes
  const waitingOrdersOver5Min = useMemo(() => {
    const nowSec = Math.floor(Date.now() / 1000);
    return filteredActiveOrders.filter((o) => {
      const isPick = Boolean(o.isPickup || o.fulfillmentType === 'pickup' || (o.serviceType as any) === 'pickup');
      if (isPick) return false;
      const noDriver = !o.riderId;
      const isPending = o.status === 'Placed Order' || o.status === 'Preparing';
      if (noDriver && isPending && o.createdAt?.seconds) {
        return nowSec - o.createdAt.seconds > 300; // > 5 minutes
      }
      return false;
    });
  }, [filteredActiveOrders]);

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">
            Dashboard Overview
          </h1>
          <p className="text-sm text-gray-500 dark:text-zinc-400 mt-1">
            Realtime operations monitoring, driver dispatch, and platform performance metrics.
          </p>
        </div>

        <button
          onClick={fetchDashboardData}
          disabled={loading}
          className="self-start sm:self-auto flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-gray-700 dark:text-zinc-300 hover:bg-gray-50 text-sm font-semibold transition-colors shadow-xs"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-amber-500' : ''}`} />
          Refresh Stats
        </button>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {loading ? (
          <CardSkeleton count={8} />
        ) : (
          <>
            {/* Orders Today */}
            <div className="bg-white dark:bg-zinc-900 border border-gray-200/80 dark:border-zinc-800 rounded-2xl p-5 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-zinc-400">
                  Orders Today
                </span>
                <div className="p-2 rounded-xl bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-400">
                  <ShoppingBag className="w-5 h-5" />
                </div>
              </div>
              <div className="text-2xl font-black text-gray-900 dark:text-white mt-3">
                {kpis.ordersTodayCount}
              </div>
              <div className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 font-semibold mt-1">
                <TrendingUp className="w-3.5 h-3.5" />
                <span>Active volume today</span>
              </div>
            </div>

            {/* Total Delivered Revenue */}
            <div className="bg-white dark:bg-zinc-900 border border-gray-200/80 dark:border-zinc-800 rounded-2xl p-5 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-zinc-400">
                  Gross Completed Sales
                </span>
                <div className="p-2 rounded-xl bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-400">
                  <DollarSign className="w-5 h-5" />
                </div>
              </div>
              <div className="text-2xl font-black text-gray-900 dark:text-white mt-3">
                ₱{kpis.deliveredRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className="text-xs text-gray-500 dark:text-zinc-400 mt-1">
                Total completed sales
              </div>
            </div>

            {/* Platform Commission */}
            <div className="bg-white dark:bg-zinc-900 border border-gray-200/80 dark:border-zinc-800 rounded-2xl p-5 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-zinc-400">
                  Platform Comm.
                </span>
                <div className="p-2 rounded-xl bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-400">
                  <Percent className="w-5 h-5" />
                </div>
              </div>
              <div className="text-2xl font-black text-gray-900 dark:text-white mt-3">
                ₱{kpis.platformCommission.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className="text-xs text-gray-500 dark:text-zinc-400 mt-1">
                Net margin
              </div>
            </div>

            {/* Active Online Drivers */}
            <div className="bg-white dark:bg-zinc-900 border border-gray-200/80 dark:border-zinc-800 rounded-2xl p-5 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-zinc-400">
                  Online Drivers
                </span>
                <div className="p-2 rounded-xl bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-400">
                  <Car className="w-5 h-5" />
                </div>
              </div>
              <div className="text-2xl font-black text-gray-900 dark:text-white mt-3">
                {kpis.onlineRidersCount}
              </div>
              <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-semibold mt-1">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>Live fleet broadcast</span>
              </div>
            </div>

            {/* Registered Customers */}
            <div className="bg-white dark:bg-zinc-900 border border-gray-200/80 dark:border-zinc-800 rounded-2xl p-5 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-zinc-400">
                  Total Customers
                </span>
                <div className="p-2 rounded-xl bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-400">
                  <Users className="w-5 h-5" />
                </div>
              </div>
              <div className="text-2xl font-black text-gray-900 dark:text-white mt-3">
                {kpis.customersCount}
              </div>
              <div className="text-xs text-gray-500 dark:text-zinc-400 mt-1">
                Active customer base
              </div>
            </div>

            {/* Open Merchants */}
            <div className="bg-white dark:bg-zinc-900 border border-gray-200/80 dark:border-zinc-800 rounded-2xl p-5 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-zinc-400">
                  Open Stores
                </span>
                <div className="p-2 rounded-xl bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-400">
                  <Store className="w-5 h-5" />
                </div>
              </div>
              <div className="text-2xl font-black text-gray-900 dark:text-white mt-3">
                {kpis.openMerchantsCount}
              </div>
              <div className="text-xs text-gray-500 dark:text-zinc-400 mt-1">
                Stores currently accepting orders
              </div>
            </div>

            {/* Average Delivery Time */}
            <div className="bg-white dark:bg-zinc-900 border border-gray-200/80 dark:border-zinc-800 rounded-2xl p-5 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-zinc-400">
                  Avg Trip / Delivery
                </span>
                <div className="p-2 rounded-xl bg-teal-100 text-teal-800 dark:bg-teal-950/60 dark:text-teal-400">
                  <Clock className="w-5 h-5" />
                </div>
              </div>
              <div className="text-2xl font-black text-gray-900 dark:text-white mt-3">
                {kpis.avgDeliveryTime} <span className="text-sm font-semibold text-gray-500">mins</span>
              </div>
              <div className="text-xs text-gray-500 dark:text-zinc-400 mt-1">
                Order creation to completion
              </div>
            </div>

            {/* Cancellation Rate */}
            <div className="bg-white dark:bg-zinc-900 border border-gray-200/80 dark:border-zinc-800 rounded-2xl p-5 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-zinc-400">
                  Cancellation Rate
                </span>
                <div className="p-2 rounded-xl bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-400">
                  <AlertTriangle className="w-5 h-5" />
                </div>
              </div>
              <div className="text-2xl font-black text-gray-900 dark:text-white mt-3">
                {kpis.cancellationRate}%
              </div>
              <div className="text-xs text-gray-500 dark:text-zinc-400 mt-1">
                Rejected or cancelled orders
              </div>
            </div>
          </>
        )}
      </div>

      {/* Live Alerts & Action Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Waiting for driver > 5 mins */}
        <div className="bg-white dark:bg-zinc-900 border border-amber-300 dark:border-amber-900/60 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-red-500 animate-ping" />
              <h3 className="font-bold text-gray-900 dark:text-white text-sm">
                Orders Waiting For Driver (&gt;5m)
              </h3>
            </div>
            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300">
              {waitingOrdersOver5Min.length}
            </span>
          </div>

          <p className="text-xs text-gray-500 dark:text-zinc-400 mb-4">
            Orders unassigned for over 5 minutes requiring dispatcher action.
          </p>

          <div className="space-y-2 max-h-48 overflow-y-auto">
            {waitingOrdersOver5Min.length === 0 ? (
              <div className="text-center py-6 text-xs text-gray-400">
                All active orders currently matched with drivers.
              </div>
            ) : (
              waitingOrdersOver5Min.map((ord) => (
                <div
                  key={ord.id}
                  onClick={() => navigate(`/orders?search=${ord.orderNumber}`)}
                  className="p-3 rounded-xl bg-amber-50/70 dark:bg-zinc-800/80 border border-amber-200 dark:border-zinc-700 flex items-center justify-between hover:bg-amber-100/70 transition-colors cursor-pointer"
                >
                  <div>
                    <span className="font-bold text-xs text-gray-900 dark:text-white">
                      #{ord.orderNumber}
                    </span>
                    <p className="text-[11px] text-gray-600 dark:text-zinc-400">
                      {ord.customerName} • {ord.merchantName || ord.serviceType}
                    </p>
                  </div>
                  <span className="text-[11px] text-red-600 font-bold">
                    {formatRelativeTime(ord.createdAt)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Pending Applications & Change Requests */}
        <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-5 shadow-xs">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-gray-900 dark:text-white text-sm flex items-center gap-2">
              <FileCheck className="w-4 h-4 text-amber-500" />
              Onboarding & Changes
            </h3>
            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
              {totalPendingAppsCount} pending
            </span>
          </div>

          <p className="text-xs text-gray-500 dark:text-zinc-400 mb-4">
            Partner and driver submissions waiting for compliance review.
          </p>

          <div className="space-y-2">
            <div
              onClick={() => navigate('/applications')}
              className="p-3 rounded-xl bg-gray-50 dark:bg-zinc-850 hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <Store className="w-4 h-4 text-amber-500" />
                <span className="text-xs font-semibold text-gray-800 dark:text-zinc-200">
                  Merchant & Driver Applications
                </span>
              </div>
              <span className="text-xs font-bold text-amber-600">
                {totalPendingAppsCount} waiting <ArrowUpRight className="w-3 h-3 inline" />
              </span>
            </div>

            <div
              onClick={() => navigate('/tiers')}
              className="p-3 rounded-xl bg-gray-50 dark:bg-zinc-850 hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <Award className="w-4 h-4 text-purple-500" />
                <span className="text-xs font-semibold text-gray-800 dark:text-zinc-200">
                  Tier Coin Rewards Pending
                </span>
              </div>
              <span className="text-xs font-bold text-purple-600">
                {pendingTierEventsCount} to credit <ArrowUpRight className="w-3 h-3 inline" />
              </span>
            </div>
          </div>
        </div>

        {/* SOS & Incident Alerts */}
        <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-5 shadow-xs">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-gray-900 dark:text-white text-sm flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-red-500" />
              SOS & Incident Alerts
            </h3>
            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300">
              {recentIncidents.length}
            </span>
          </div>

          <p className="text-xs text-gray-500 dark:text-zinc-400 mb-4">
            Critical safety, road incidents, or emergency notifications.
          </p>

          <div className="space-y-2 max-h-48 overflow-y-auto">
            {recentIncidents.length === 0 ? (
              <div className="text-center py-6 text-xs text-gray-400">
                No active SOS or safety incident reports. All clear.
              </div>
            ) : (
              recentIncidents.map((inc) => (
                <div
                  key={inc.id}
                  onClick={() => navigate('/notifications')}
                  className="p-2.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 cursor-pointer hover:bg-red-100/60 transition-colors"
                >
                  <p className="text-xs font-bold text-red-900 dark:text-red-300">
                    {inc.title || 'Safety Emergency'}
                  </p>
                  <p className="text-[11px] text-red-700/80 dark:text-red-400/80 line-clamp-1">
                    {inc.message}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Charts Section: 14-Day Orders, Orders by Service Type */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 14-Day Orders Area Chart */}
        <div className="lg:col-span-2 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-5 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-gray-900 dark:text-white text-base">
                Order Volume Trend (Last 14 Days)
              </h3>
              <p className="text-xs text-gray-500 dark:text-zinc-400">
                Daily completed and active orders count
              </p>
            </div>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={ordersPerDayData}>
                <defs>
                  <linearGradient id="orderGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#FFC107" stopOpacity={0.6} />
                    <stop offset="95%" stopColor="#FFC107" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#18181b',
                    borderRadius: '12px',
                    border: '1px solid #3f3f46',
                    color: '#fff',
                    fontSize: '12px'
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="orders"
                  stroke="#FFC107"
                  strokeWidth={3}
                  fillOpacity={1}
                  fill="url(#orderGrad)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Orders by Service Type Donut Chart */}
        <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-5 shadow-xs">
          <h3 className="font-bold text-gray-900 dark:text-white text-base mb-1">
            Orders by Service
          </h3>
          <p className="text-xs text-gray-500 dark:text-zinc-400 mb-4">
            Distribution across Delivery and Taxi services
          </p>

          <div className="h-48 w-full flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={serviceTypeData}
                  cx="50%"
                  cy="50%"
                  innerRadius={45}
                  outerRadius={70}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {serviceTypeData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#18181b',
                    borderRadius: '10px',
                    border: 'none',
                    color: '#fff',
                    fontSize: '11px'
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-2 gap-2 mt-2">
            {serviceTypeData.map((item) => (
              <div key={item.name} className="flex items-center gap-2 text-xs">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                <span className="text-gray-600 dark:text-zinc-400 truncate">{item.name}:</span>
                <span className="font-bold text-gray-900 dark:text-white">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Taxi Fleet by Vehicle Type Breakdown */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-bold text-gray-900 dark:text-white text-base flex items-center gap-2">
              <Car className="w-5 h-5 text-amber-500" />
              Taxi Service by Vehicle Type
            </h3>
            <p className="text-xs text-gray-500 dark:text-zinc-400">
              Trip volume and gross passenger ride revenue by vehicle class
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          {taxiVehicleData.map((v) => (
            <div
              key={v.id}
              className="p-4 rounded-xl border border-gray-100 dark:border-zinc-800 bg-gray-50/70 dark:bg-zinc-850 space-y-2"
            >
              <div className="flex items-center justify-between">
                <span className="font-extrabold text-xs text-gray-900 dark:text-white">
                  {v.name}
                </span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${v.badgeColor}`}>
                  {v.orders} trips
                </span>
              </div>
              <div className="text-xl font-black text-gray-900 dark:text-white">
                ₱{v.revenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <span className="text-[11px] text-gray-500 block">
                Total passenger fares
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Orders by City Bar Chart */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-5 shadow-xs">
        <h3 className="font-bold text-gray-900 dark:text-white text-base mb-1">
          Orders by City
        </h3>
        <p className="text-xs text-gray-500 dark:text-zinc-400 mb-4">
          Geographic breakdown across operational coverage zones
        </p>

        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={ordersByCityData}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#18181b',
                  borderRadius: '12px',
                  border: '1px solid #3f3f46',
                  color: '#fff',
                  fontSize: '12px'
                }}
              />
              <Bar dataKey="count" fill="#FFC107" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};
