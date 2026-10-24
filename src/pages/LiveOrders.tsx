import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import L from 'leaflet';
import {
  db,
  collection,
  query,
  limit,
  onSnapshot,
  doc,
  updateDoc,
  getDoc,
  arrayUnion,
  Timestamp,
  runTransaction,
  increment
} from '../firebase';
import { useCity } from '../context/CityContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { logAuditEvent } from '../utils/audit';
import { exportToCsv } from '../utils/exportCsv';
import { formatTimestamp, formatRelativeTime } from '../utils/date';
import type { Order, OrderStatus, OrderServiceType } from '../types';
import {
  VEHICLE_TYPES,
  VEHICLE_LABELS,
  type VehicleType
} from '../constants';
import {
  Search,
  Filter,
  Download,
  LayoutGrid,
  List,
  Clock,
  Phone,
  User,
  Store,
  Car,
  AlertTriangle,
  RotateCcw,
  Ban,
  CheckCircle2,
  X,
  MapPin,
  ExternalLink,
  Loader2,
  ChevronRight,
  Wallet,
  CreditCard,
  Banknote,
  Truck,
  ChevronDown,
  Calendar,
  Navigation
} from 'lucide-react';
import { ConfirmationModal } from '../components/common/ConfirmationModal';

export const FulfillmentChip: React.FC<{ order: Order }> = ({ order }) => {
  if (order.serviceType === 'taxi') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 dark:bg-amber-950/70 dark:text-amber-300 border border-amber-300 dark:border-amber-700 whitespace-nowrap">
        <Car className="w-3 h-3 text-amber-600 shrink-0" />
        <span>Ride Hailing</span>
      </span>
    );
  }

  const isScheduled = Boolean(order.scheduledFor || (order as any).isScheduled || order.fulfillmentType === 'scheduled');
  const isPickup = Boolean(order.isPickup || order.fulfillmentType === 'pickup' || (order.serviceType as any) === 'pickup');

  if (isScheduled) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-900 dark:bg-purple-950/70 dark:text-purple-300 border border-purple-300 dark:border-purple-800 whitespace-nowrap">
        <Clock className="w-3 h-3 text-purple-600 shrink-0" />
        <span>Scheduled{order.scheduledFor ? ` (${formatTimestamp(order.scheduledFor)})` : ''}</span>
      </span>
    );
  }

  if (isPickup) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 dark:bg-amber-950/70 dark:text-amber-300 border border-amber-300 dark:border-amber-700 whitespace-nowrap">
        <Store className="w-3 h-3 text-amber-700 shrink-0" />
        <span>Pick Up</span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800 whitespace-nowrap">
      <Car className="w-3 h-3 text-blue-600 shrink-0" />
      <span>Delivery</span>
    </span>
  );
};

export const ServiceChips: React.FC<{ order: Order }> = ({ order }) => {
  if (order.serviceType === 'taxi') {
    const vType = (order.vehicleType || order.riderVehicle?.vehicleType || 'motorcycle') as VehicleType;
    const vConfig = VEHICLE_TYPES.find((v) => v.id === vType);

    return (
      <div className="flex flex-wrap items-center gap-1">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-blue-600 text-white shadow-xs">
          <Car className="w-3 h-3" />
          <span>Taxi</span>
        </span>
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold border ${vConfig?.badgeColor || 'bg-gray-100 text-gray-800'}`}>
          {vConfig?.shortLabel || VEHICLE_LABELS[vType] || vType}
        </span>
      </div>
    );
  }

  return (
    <span className="capitalize px-2 py-0.5 rounded-md text-[10px] font-bold bg-gray-100 dark:bg-zinc-800 text-gray-800 dark:text-zinc-200">
      {order.serviceType.replace('_', ' ')}
    </span>
  );
};

export const PaymentChip: React.FC<{ order: Order }> = ({ order }) => {
  const method = (order.paymentMethod || order.payment?.method || 'cod').toLowerCase();
  const provider = order.paymentProvider || order.payment?.provider;
  const status =
    order.paymentStatus ||
    order.payment?.status ||
    (order.walletRefunded ? 'Refunded' : method === 'wallet' ? 'Paid' : 'Pending');
  const isRefunded = order.walletRefunded;

  if (method === 'wallet') {
    return (
      <div className="inline-flex flex-col gap-0.5 items-start">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 dark:bg-amber-950/70 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
          <Wallet className="w-3 h-3 text-amber-600 shrink-0" />
          <span>Delivio Wallet</span>
        </span>
        <span
          className={`text-[9px] font-semibold px-1 rounded ${
            isRefunded
              ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 font-bold'
              : 'text-gray-500 dark:text-zinc-400'
          }`}
        >
          {isRefunded ? 'Refunded' : status || 'Paid'}
        </span>
      </div>
    );
  }

  if (method === 'online') {
    return (
      <div className="inline-flex flex-col gap-0.5 items-start">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-900 dark:bg-blue-950/70 dark:text-blue-300 border border-blue-300 dark:border-blue-700">
          <CreditCard className="w-3 h-3 text-blue-600 shrink-0" />
          <span>Paid Online{provider ? ` (${provider})` : ''}</span>
        </span>
        <span className="text-[9px] font-semibold text-gray-500 dark:text-zinc-400 px-1">
          {status || 'Paid'}
        </span>
      </div>
    );
  }

  return (
    <div className="inline-flex flex-col gap-0.5 items-start">
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
        <Banknote className="w-3 h-3 text-emerald-600 shrink-0" />
        <span>COD</span>
      </span>
      <span className="text-[9px] font-semibold text-gray-500 dark:text-zinc-400 px-1">
        {order.codCollected ? 'Collected' : status || 'To Collect'}
      </span>
    </div>
  );
};

const EXACT_STATUSES: OrderStatus[] = [
  'Placed Order',
  'Preparing',
  'Ready',
  'Driver is on the way',
  'Driver arrived',
  'On trip',
  'Rider is on the way',
  'Rider is on the way to sender',
  'Arrived at sender',
  'Rider is on the way to vendor',
  'Arrived at vendor',
  'Rider is on the way to recipient',
  'Arrived at recipient',
  'Delivered',
  'Completed',
  'Cancelled',
  'Rejected'
];

export const LiveOrders: React.FC = () => {
  const [searchParams] = useSearchParams();
  const initialSearch = searchParams.get('search') || '';

  const { selectedCityId, cities } = useCity();
  const { adminProfile } = useAuth();
  const { showSuccess, showError } = useToast();

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'kanban' | 'table'>('table');

  // Filters
  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [serviceFilter, setServiceFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [paymentFilter, setPaymentFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | '7days'>('all');

  // Selected Order for Detail Drawer/Modal
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  // Cancellation Modal State
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelFault, setCancelFault] = useState<'customer' | 'merchant' | 'rider' | 'platform'>('customer');
  const [cancelReasonPicker, setCancelReasonPicker] = useState('Customer changed mind');
  const [cancelNote, setCancelNote] = useState('');
  const [refundToWallet, setRefundToWallet] = useState(true);
  const [cancelling, setCancelling] = useState(false);

  // Reassign Modal State
  const [reassignModalOpen, setReassignModalOpen] = useState(false);
  const [reassignReason, setReassignReason] = useState('');
  const [reassigning, setReassigning] = useState(false);

  // Mini map reference for order detail modal
  const miniMapContainerRef = useRef<HTMLDivElement>(null);
  const miniMapInstanceRef = useRef<L.Map | null>(null);

  // Live order snapshot
  useEffect(() => {
    setLoading(true);
    const q = query(collection(db, 'orders'), limit(300));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: Order[] = [];
        snapshot.forEach((d) => {
          const data = d.data();
          list.push({
            id: d.id,
            orderNumber: data.orderNumber || d.id.substring(0, 8).toUpperCase(),
            serviceType: data.serviceType || 'food',
            vehicleType: data.vehicleType,
            customerId: data.customerId || '',
            customerName: data.customerName || 'Customer',
            customerPhone: data.customerPhone,
            merchantId: data.merchantId,
            merchantName: data.merchantName,
            merchantPhone: data.merchantPhone,
            merchantAddress: data.merchantAddress,
            riderId: data.riderId,
            riderName: data.riderName,
            riderPhone: data.riderPhone,
            riderPhotoUrl: data.riderPhotoUrl,
            riderLocation: data.riderLocation,
            riderStep: data.riderStep,
            riderRequest: data.riderRequest,
            riderEarning: data.riderEarning,
            riderVehicle: data.riderVehicle,
            status: data.status || 'Placed Order',
            statusHistory: data.statusHistory || [],
            items: data.items || [],
            pickup: data.pickup,
            dropoff: data.dropoff,
            stops: data.stops,
            parcel: data.parcel,
            pabili: data.pabili,
            finalReceiptTotal: data.finalReceiptTotal,
            fees: {
              subtotal: data.fees?.subtotal || 0,
              deliveryFee: data.fees?.deliveryFee || 0,
              serviceFee: data.fees?.serviceFee || 0,
              discount: data.fees?.discount || 0,
              tip: data.fees?.tip || 0,
              total: data.fees?.total || 0
            },
            fulfillmentType: data.fulfillmentType,
            isPickup: Boolean(data.isPickup || data.fulfillmentType === 'pickup' || data.serviceType === 'pickup'),
            scheduledFor: data.scheduledFor,
            paymentMethod: data.paymentMethod || 'cod',
            paymentStatus: data.paymentStatus,
            paymentProvider: data.paymentProvider,
            payment: data.payment,
            cashToCollect: data.cashToCollect,
            codAmount: data.codAmount,
            codCollected: data.codCollected,
            walletRefunded: data.walletRefunded,
            cityId: data.cityId,
            cancelReason: data.cancelReason,
            cancelFault: data.cancelFault,
            cancelledBy: data.cancelledBy,
            rejectReason: data.rejectReason,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
            pickedUpAt: data.pickedUpAt,
            deliveredAt: data.deliveredAt
          });
        });

        // Sort in JavaScript newest first
        list.sort((a, b) => {
          const tA = a.createdAt?.seconds ? a.createdAt.seconds * 1000 : 0;
          const tB = b.createdAt?.seconds ? b.createdAt.seconds * 1000 : 0;
          return tB - tA;
        });

        setOrders(list);
        setLoading(false);

        // Keep selectedOrder in sync if open
        if (selectedOrder) {
          const updated = list.find((o) => o.id === selectedOrder.id);
          if (updated) setSelectedOrder(updated);
        }
      },
      (err) => {
        showError(err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [selectedOrder?.id]);

  // Set search if navigated with ?search=...
  useEffect(() => {
    if (initialSearch) {
      setSearchQuery(initialSearch);
    }
  }, [initialSearch]);

  const [fulfillmentFilter, setFulfillmentFilter] = useState<'all' | 'delivery' | 'pickup' | 'scheduled'>('all');

  // Upcoming scheduled orders
  const upcomingScheduledOrders = useMemo(() => {
    return orders
      .filter((o) => {
        const isSched = Boolean(o.scheduledFor || (o as any).isScheduled || o.fulfillmentType === 'scheduled');
        const isNotDone =
          o.status !== 'Delivered' &&
          o.status !== 'Completed' &&
          o.status !== 'Cancelled' &&
          o.status !== 'Rejected';
        return isSched && isNotDone;
      })
      .sort((a, b) => {
        const tA = a.scheduledFor?.seconds ? a.scheduledFor.seconds * 1000 : 0;
        const tB = b.scheduledFor?.seconds ? b.scheduledFor.seconds * 1000 : 0;
        return tA - tB;
      });
  }, [orders]);

  // Filtered Orders
  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      // 1. City Filter
      if (selectedCityId !== 'all' && order.cityId && order.cityId !== selectedCityId) {
        return false;
      }
      // 2. Service Type Filter
      if (serviceFilter !== 'all' && order.serviceType !== serviceFilter) {
        return false;
      }
      // 3. Status Filter
      if (statusFilter !== 'all') {
        if (statusFilter === 'Completed' || statusFilter === 'Delivered') {
          if (order.status !== 'Completed' && order.status !== 'Delivered') {
            return false;
          }
        } else if (order.status !== statusFilter) {
          return false;
        }
      }
      // 4. Fulfillment Filter
      if (fulfillmentFilter !== 'all') {
        const isSched = Boolean(order.scheduledFor || (order as any).isScheduled || order.fulfillmentType === 'scheduled');
        const isPick = Boolean(order.isPickup || order.fulfillmentType === 'pickup' || (order.serviceType as any) === 'pickup');
        if (fulfillmentFilter === 'scheduled' && !isSched) return false;
        if (fulfillmentFilter === 'pickup' && !isPick) return false;
        if (fulfillmentFilter === 'delivery' && (isSched || isPick)) return false;
      }
      // 5. Payment Method Filter
      if (paymentFilter !== 'all') {
        const pm = (order.paymentMethod || order.payment?.method || 'cod').toLowerCase();
        if (pm !== paymentFilter) {
          return false;
        }
      }
      // 6. Date Filter
      if (dateFilter !== 'all') {
        const orderTime = order.createdAt?.seconds ? order.createdAt.seconds * 1000 : 0;
        const now = Date.now();
        if (dateFilter === 'today') {
          const startOfDay = new Date().setHours(0, 0, 0, 0);
          if (orderTime < startOfDay) return false;
        } else if (dateFilter === '7days') {
          if (now - orderTime > 7 * 24 * 60 * 60 * 1000) return false;
        }
      }
      // 7. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const num = (order.orderNumber || '').toLowerCase();
        const cName = (order.customerName || '').toLowerCase();
        const cPhone = (order.customerPhone || '').toLowerCase();
        const mName = (order.merchantName || '').toLowerCase();
        const rName = (order.riderName || '').toLowerCase();
        if (
          !num.includes(q) &&
          !cName.includes(q) &&
          !cPhone.includes(q) &&
          !mName.includes(q) &&
          !rName.includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [orders, selectedCityId, serviceFilter, statusFilter, fulfillmentFilter, paymentFilter, dateFilter, searchQuery]);

  // Mini map rendering inside detail drawer
  useEffect(() => {
    if (!selectedOrder || !miniMapContainerRef.current) return;

    if (miniMapInstanceRef.current) {
      miniMapInstanceRef.current.remove();
      miniMapInstanceRef.current = null;
    }

    const pickupLat = selectedOrder.pickup?.lat;
    const pickupLng = selectedOrder.pickup?.lng;
    const dropoffLat = selectedOrder.dropoff?.lat;
    const dropoffLng = selectedOrder.dropoff?.lng;

    const centerLat = pickupLat || dropoffLat || 9.7392;
    const centerLng = pickupLng || dropoffLng || 118.7353;

    const map = L.map(miniMapContainerRef.current, {
      center: [centerLat, centerLng],
      zoom: 13,
      zoomControl: false
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap'
    }).addTo(map);

    const bounds: L.LatLngExpression[] = [];

    // Stop 1: Pickup pin in GREEN
    if (pickupLat && pickupLng) {
      bounds.push([pickupLat, pickupLng]);

      const greenPickupIcon = L.divIcon({
        html: `
          <div class="flex items-center justify-center w-7 h-7 rounded-full bg-emerald-600 text-white font-black text-xs border-2 border-white shadow-lg cursor-pointer">
            1
          </div>
        `,
        className: 'delivio-pickup-pin',
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      });

      L.marker([pickupLat, pickupLng], { icon: greenPickupIcon })
        .bindTooltip(`Pickup (Stop 1): ${selectedOrder.pickup?.address || 'Pickup Point'}`, { permanent: false })
        .addTo(map);
    }

    // Stop 2+: Red pins numbered 2, 3, 4...
    if (selectedOrder.stops && selectedOrder.stops.length > 0) {
      selectedOrder.stops.forEach((st, idx) => {
        if (st.lat && st.lng) {
          bounds.push([st.lat, st.lng]);
          const stopNum = idx + 2;
          const redStopIcon = L.divIcon({
            html: `
              <div class="flex items-center justify-center w-7 h-7 rounded-full bg-red-600 text-white font-black text-xs border-2 border-white shadow-lg cursor-pointer">
                ${stopNum}
              </div>
            `,
            className: `delivio-stop-pin-${stopNum}`,
            iconSize: [28, 28],
            iconAnchor: [14, 14]
          });

          L.marker([st.lat, st.lng], { icon: redStopIcon })
            .bindTooltip(`Stop ${stopNum}: ${st.address || 'Stop Location'}`, { permanent: false })
            .addTo(map);
        }
      });
    } else if (dropoffLat && dropoffLng) {
      // Default single dropoff is Stop 2
      bounds.push([dropoffLat, dropoffLng]);
      const redDropoffIcon = L.divIcon({
        html: `
          <div class="flex items-center justify-center w-7 h-7 rounded-full bg-red-600 text-white font-black text-xs border-2 border-white shadow-lg cursor-pointer">
            2
          </div>
        `,
        className: 'delivio-dropoff-pin',
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      });

      L.marker([dropoffLat, dropoffLng], { icon: redDropoffIcon })
        .bindTooltip(`Drop-off (Stop 2): ${selectedOrder.dropoff?.address || 'Destination'}`, { permanent: false })
        .addTo(map);
    }

    // Driver location if online & assigned
    if (selectedOrder.riderLocation?.lat && selectedOrder.riderLocation?.lng) {
      bounds.push([selectedOrder.riderLocation.lat, selectedOrder.riderLocation.lng]);
      const driverMarkerHtml = `
        <div class="flex items-center justify-center w-8 h-8 rounded-full bg-amber-500 text-black font-extrabold border-2 border-white shadow-lg">
          <svg class="w-4 h-4 fill-none stroke-current" stroke-width="2.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 18.75a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 0 1-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 0 0-3.213-9.193 2.056 2.056 0 0 0-1.58-.86H14.25M16.5 18.75h-2.25m0-11.25H4.125c-.621 0-1.125.504-1.125 1.125v7.5c0 .621.504 1.125 1.125 1.125h1.125m9.75-9.75h-7.5" />
          </svg>
        </div>
      `;
      const driverDivIcon = L.divIcon({
        html: driverMarkerHtml,
        className: 'delivio-driver-live-pin',
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      });

      L.marker([selectedOrder.riderLocation.lat, selectedOrder.riderLocation.lng], { icon: driverDivIcon })
        .bindTooltip(`Driver: ${selectedOrder.riderName || 'Assigned Driver'}`, { permanent: true })
        .addTo(map);
    }

    if (bounds.length > 1) {
      map.fitBounds(L.latLngBounds(bounds), { padding: [30, 30] });
      L.polyline(bounds, {
        color: selectedOrder.serviceType === 'taxi' ? '#3b82f6' : '#FFC107',
        weight: 3.5,
        dashArray: '5, 8'
      }).addTo(map);
    }

    miniMapInstanceRef.current = map;

    return () => {
      if (miniMapInstanceRef.current) {
        miniMapInstanceRef.current.remove();
        miniMapInstanceRef.current = null;
      }
    };
  }, [selectedOrder]);

  // Action 1: Cancel Order (supports taxi and all services)
  const handleCancelOrder = async () => {
    if (!selectedOrder) return;
    try {
      setCancelling(true);
      const fullReason = cancelNote.trim()
        ? `${cancelReasonPicker}: ${cancelNote.trim()}`
        : cancelReasonPicker;

      const willRefund =
        refundToWallet &&
        (selectedOrder.paymentMethod || selectedOrder.payment?.method || '').toLowerCase() === 'wallet' &&
        !selectedOrder.walletRefunded;

      const orderRef = doc(db, 'orders', selectedOrder.id);
      const customerId = selectedOrder.customerId;
      const userRef = doc(db, 'users', customerId);
      const now = Timestamp.now();

      await runTransaction(db, async (transaction) => {
        const orderSnap = await transaction.get(orderRef);
        if (!orderSnap.exists()) {
          throw new Error('Order not found');
        }
        const orderData = orderSnap.data();

        if (willRefund) {
          const userSnap = await transaction.get(userRef);
          const currentBal = userSnap.exists() ? userSnap.data().walletBalance || 0 : 0;
          const refundAmount = Number(orderData.fees?.total || selectedOrder.fees?.total || 0);
          const newBal = currentBal + refundAmount;

          transaction.update(orderRef, {
            status: 'Cancelled',
            cancelReason: fullReason,
            cancelFault: cancelFault,
            cancelledBy: 'admin',
            walletRefunded: true,
            paymentStatus: 'Refunded',
            statusHistory: arrayUnion({
              status: 'Cancelled',
              at: now,
              note: `Cancelled by Admin (${adminProfile?.name || 'Operations'}): ${fullReason} (Fault: ${cancelFault}). Refunded ₱${refundAmount.toFixed(2)} to customer wallet.`
            }),
            updatedAt: now
          });

          if (userSnap.exists()) {
            transaction.update(userRef, {
              walletBalance: increment(refundAmount),
              updatedAt: now
            });
          } else {
            transaction.set(
              userRef,
              {
                walletBalance: refundAmount,
                updatedAt: now
              },
              { merge: true }
            );
          }

          const txnRef = doc(collection(db, 'walletTransactions'));
          transaction.set(txnRef, {
            customerId,
            orderId: selectedOrder.id,
            orderNumber: orderData.orderNumber || selectedOrder.orderNumber,
            type: 'refund',
            amount: refundAmount,
            note: `Refund for cancelled order #${orderData.orderNumber || selectedOrder.orderNumber}`,
            reason: fullReason,
            adminId: adminProfile?.uid || 'admin',
            adminName: adminProfile?.name || 'Administrator',
            balanceAfter: newBal,
            createdAt: now
          });
        } else {
          transaction.update(orderRef, {
            status: 'Cancelled',
            cancelReason: fullReason,
            cancelFault: cancelFault,
            cancelledBy: 'admin',
            statusHistory: arrayUnion({
              status: 'Cancelled',
              at: now,
              note: `Cancelled by Admin (${adminProfile?.name || 'Operations'}): ${fullReason} (Fault: ${cancelFault})`
            }),
            updatedAt: now
          });
        }
      });

      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        adminEmail: adminProfile?.email,
        action: 'CANCEL_ORDER',
        entityType: 'order',
        entityId: selectedOrder.id,
        details: `Cancelled order #${selectedOrder.orderNumber}. Fault: ${cancelFault}. Reason: ${fullReason}${
          willRefund ? ' (Refunded to customer wallet)' : ''
        }`,
        oldValue: { status: selectedOrder.status },
        newValue: {
          status: 'Cancelled',
          cancelReason: fullReason,
          cancelFault,
          walletRefunded: willRefund
        }
      });

      showSuccess(
        `Order #${selectedOrder.orderNumber} successfully cancelled.${
          willRefund ? ' Refunded to customer wallet.' : ''
        }`
      );
      setCancelModalOpen(false);
      setSelectedOrder((prev) =>
        prev
          ? {
              ...prev,
              status: 'Cancelled',
              cancelReason: fullReason,
              walletRefunded: willRefund ? true : prev.walletRefunded
            }
          : null
      );
    } catch (err: any) {
      showError(err);
    } finally {
      setCancelling(false);
    }
  };

  // Action 2: Reassign Driver: Clears riderId, riderName, riderPhone, riderPhotoUrl, riderStep, and riderVehicle and sets status to "Placed Order"
  const handleReassignDriver = async () => {
    if (!selectedOrder) return;
    try {
      setReassigning(true);
      const orderRef = doc(db, 'orders', selectedOrder.id);
      const now = Timestamp.now();

      const updatePayload: Record<string, any> = {
        riderId: null,
        riderName: null,
        riderPhone: null,
        riderPhotoUrl: null,
        riderStep: null,
        riderVehicle: null,
        status: 'Placed Order',
        statusHistory: arrayUnion({
          status: 'Placed Order',
          at: now,
          note: `Driver unassigned & order reset to Placed Order by Admin (${adminProfile?.name || 'Operations'}): ${reassignReason || 'Manual dispatch unassignment'}`
        }),
        updatedAt: now
      };

      if (selectedOrder.serviceType === 'request_rider') {
        updatePayload['riderRequest.status'] = 'Searching';
      }

      await updateDoc(orderRef, updatePayload);

      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        adminEmail: adminProfile?.email,
        action: 'REASSIGN_DRIVER',
        entityType: 'order',
        entityId: selectedOrder.id,
        details: `Reassigned driver for order #${selectedOrder.orderNumber}. Previous driver: ${selectedOrder.riderName || 'None'}. Reason: ${reassignReason}`,
        oldValue: { riderId: selectedOrder.riderId, riderName: selectedOrder.riderName },
        newValue: { riderId: null, status: 'Placed Order' }
      });

      showSuccess(`Driver removed from Order #${selectedOrder.orderNumber}. Order reset to Placed Order.`);
      setReassignModalOpen(false);
    } catch (err: any) {
      showError(err);
    } finally {
      setReassigning(false);
    }
  };

  // Action 3: Mark Order Completed
  const handleMarkCompleted = async () => {
    if (!selectedOrder) return;
    try {
      const orderRef = doc(db, 'orders', selectedOrder.id);
      const now = Timestamp.now();
      await updateDoc(orderRef, {
        status: 'Completed',
        statusHistory: arrayUnion({
          status: 'Completed',
          at: now,
          note: `Marked as Completed by Admin (${adminProfile?.name || 'Operations'})`
        }),
        updatedAt: now,
        deliveredAt: now
      });

      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        adminEmail: adminProfile?.email,
        action: 'UPDATE_ORDER_STATUS',
        entityType: 'order',
        entityId: selectedOrder.id,
        details: `Marked order #${selectedOrder.orderNumber} as Completed.`,
        oldValue: { status: selectedOrder.status },
        newValue: { status: 'Completed' }
      });

      showSuccess(`Order #${selectedOrder.orderNumber} marked as Completed.`);
      setSelectedOrder((prev) => (prev ? { ...prev, status: 'Completed', deliveredAt: now } : null));
    } catch (err: any) {
      showError(err);
    }
  };

  // CSV Export
  const handleExportCsv = () => {
    const rows = filteredOrders.map((o) => ({
      OrderNumber: o.orderNumber,
      Fulfillment: o.serviceType === 'taxi' ? 'Taxi Ride' : o.isPickup ? 'Pick Up' : o.scheduledFor ? 'Scheduled' : 'Delivery',
      ScheduledFor: o.scheduledFor ? formatTimestamp(o.scheduledFor) : '',
      Service: o.serviceType,
      VehicleType: o.vehicleType || o.riderVehicle?.vehicleType || '',
      Status: o.status,
      Customer: o.customerName,
      CustomerPhone: o.customerPhone || '',
      Merchant: o.merchantName || '',
      Driver: o.isPickup ? 'No driver (Pick Up)' : o.riderName || 'Unassigned',
      DriverPhone: o.riderPhone || '',
      Tip: o.fees?.tip || 0,
      TotalFee: o.fees?.total || 0,
      Subtotal: o.fees?.subtotal || 0,
      DeliveryOrRideFee: o.fees?.deliveryFee || 0,
      PaymentMethod: o.paymentMethod || 'cod',
      PaymentStatus:
        o.paymentStatus ||
        (o.walletRefunded
          ? 'Refunded'
          : (o.paymentMethod || '').toLowerCase() === 'wallet'
          ? 'Paid'
          : 'Pending'),
      PaymentProvider: o.paymentProvider || o.payment?.provider || '',
      CashToCollect: o.cashToCollect ?? o.codAmount ?? 0,
      CODCollected: o.codCollected ?? 0,
      WalletRefunded: o.walletRefunded ? 'Yes' : 'No',
      City: cities.find((c) => c.id === o.cityId)?.name || o.cityId || '',
      Created: formatTimestamp(o.createdAt)
    }));
    exportToCsv(`delivio_orders_${new Date().toISOString().slice(0, 10)}`, rows);
  };

  const getStatusBadge = (st: string) => {
    switch (st) {
      case 'Delivered':
      case 'Completed':
        return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-300';
      case 'Cancelled':
      case 'Rejected':
        return 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300 border-red-300';
      case 'Placed Order':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border-blue-300';
      case 'Preparing':
      case 'Ready':
        return 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 border-purple-300';
      case 'On trip':
        return 'bg-cyan-100 text-cyan-800 dark:bg-cyan-950/60 dark:text-cyan-300 border-cyan-300';
      case 'Driver arrived':
      case 'Arrived at sender':
      case 'Arrived at vendor':
      case 'Arrived at recipient':
        return 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border-amber-300';
      default:
        return 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border-amber-300';
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Controls Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">
            Live Orders Management
          </h1>
          <p className="text-sm text-gray-500 dark:text-zinc-400 mt-0.5">
            Realtime monitoring, customer/driver dispatch coordination, Taxi rides, and exception handling.
          </p>
        </div>

        <div className="flex items-center gap-3 self-start md:self-auto">
          {/* View Mode Toggle */}
          <div className="flex items-center p-1 rounded-xl bg-gray-200 dark:bg-zinc-800">
            <button
              onClick={() => setViewMode('table')}
              className={`p-1.5 rounded-lg text-xs font-bold flex items-center gap-1 transition-all ${
                viewMode === 'table'
                  ? 'bg-white dark:bg-zinc-900 text-gray-900 dark:text-white shadow-xs'
                  : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              <List className="w-4 h-4" />
              <span>Table</span>
            </button>
            <button
              onClick={() => setViewMode('kanban')}
              className={`p-1.5 rounded-lg text-xs font-bold flex items-center gap-1 transition-all ${
                viewMode === 'kanban'
                  ? 'bg-white dark:bg-zinc-900 text-gray-900 dark:text-white shadow-xs'
                  : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              <LayoutGrid className="w-4 h-4" />
              <span>Kanban</span>
            </button>
          </div>

          {/* CSV Export */}
          <button
            onClick={handleExportCsv}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-gray-700 dark:text-zinc-300 hover:bg-gray-50 text-xs font-bold shadow-xs transition-colors"
          >
            <Download className="w-4 h-4" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Upcoming Scheduled Orders Alert / Panel */}
      {upcomingScheduledOrders.length > 0 && (
        <div className="bg-purple-50/70 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800/60 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-purple-600 text-white">
                <Calendar className="w-4 h-4" />
              </div>
              <h3 className="font-extrabold text-sm text-purple-950 dark:text-purple-200">
                Upcoming Scheduled Orders ({upcomingScheduledOrders.length})
              </h3>
            </div>
            <span className="text-[11px] font-semibold text-purple-700 dark:text-purple-400">
              Future fulfillment queue
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {upcomingScheduledOrders.slice(0, 6).map((schedOrder) => (
              <div
                key={schedOrder.id}
                onClick={() => setSelectedOrder(schedOrder)}
                className="bg-white dark:bg-zinc-900 p-3 rounded-xl border border-purple-200 dark:border-purple-900/50 shadow-xs hover:border-purple-400 dark:hover:border-purple-600 cursor-pointer transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-mono font-bold text-xs text-purple-900 dark:text-purple-300">
                      #{schedOrder.orderNumber}
                    </span>
                    <FulfillmentChip order={schedOrder} />
                  </div>
                  <div className="text-xs font-semibold text-gray-900 dark:text-white truncate">
                    {schedOrder.customerName}
                  </div>
                  <div className="text-[11px] text-gray-500 dark:text-zinc-400 truncate">
                    {schedOrder.merchantName || schedOrder.serviceType}
                  </div>
                </div>
                <div className="mt-2.5 pt-2 border-t border-gray-100 dark:border-zinc-800 flex items-center justify-between text-xs">
                  <span className="font-bold text-purple-700 dark:text-purple-400">
                    ₱{Number(schedOrder.fees?.total || 0).toFixed(2)}
                  </span>
                  <span className="text-[10px] text-gray-400">
                    {schedOrder.scheduledFor ? formatTimestamp(schedOrder.scheduledFor) : 'Scheduled'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-4 shadow-xs space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3">
          {/* Search bar */}
          <div className="lg:col-span-2 relative">
            <Search className="w-4 h-4 absolute left-3.5 top-3 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search order #, customer, merchant/stop, phone..."
              className="w-full pl-9 pr-4 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-amber-400"
            />
          </div>

          {/* Fulfillment Filter */}
          <div>
            <select
              value={fulfillmentFilter}
              onChange={(e) => setFulfillmentFilter(e.target.value as any)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-amber-400"
            >
              <option value="all">All Fulfillments</option>
              <option value="delivery">Delivery</option>
              <option value="pickup">Pick Up</option>
              <option value="scheduled">Scheduled</option>
            </select>
          </div>

          {/* Service Filter */}
          <div>
            <select
              value={serviceFilter}
              onChange={(e) => setServiceFilter(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-amber-400 font-semibold"
            >
              <option value="all">All Services</option>
              <option value="taxi">Taxi Service</option>
              <option value="food">Food Delivery</option>
              <option value="convenience">Convenience / Mart</option>
              <option value="parcel">Parcel Express</option>
              <option value="pabili">Pabili Service</option>
              <option value="request_rider">Request Driver</option>
            </select>
          </div>

          {/* Status Filter */}
          <div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-amber-400"
            >
              <option value="all">All Statuses</option>
              {EXACT_STATUSES.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </div>

          {/* Payment Method Filter */}
          <div>
            <select
              value={paymentFilter}
              onChange={(e) => setPaymentFilter(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-amber-400"
            >
              <option value="all">All Payment Methods</option>
              <option value="cod">COD (Cash on Delivery)</option>
              <option value="wallet">Delivio Wallet</option>
              <option value="online">Paid Online</option>
            </select>
          </div>

          {/* Date Filter */}
          <div>
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value as any)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-amber-400"
            >
              <option value="all">All Time</option>
              <option value="today">Today Only</option>
              <option value="7days">Last 7 Days</option>
            </select>
          </div>
        </div>
      </div>

      {/* Main Content: Table or Kanban */}
      {viewMode === 'table' ? (
        <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 dark:bg-zinc-850/60 uppercase font-bold text-gray-500 dark:text-zinc-400 border-b border-gray-200 dark:border-zinc-800">
                <tr>
                  <th className="px-4 py-3.5">Order #</th>
                  <th className="px-4 py-3.5">Fulfillment</th>
                  <th className="px-4 py-3.5">Service</th>
                  <th className="px-4 py-3.5">Status</th>
                  <th className="px-4 py-3.5">Customer</th>
                  <th className="px-4 py-3.5">Pickup / Start</th>
                  <th className="px-4 py-3.5">Driver</th>
                  <th className="px-4 py-3.5">Payment</th>
                  <th className="px-4 py-3.5">Tip</th>
                  <th className="px-4 py-3.5">Total Amount</th>
                  <th className="px-4 py-3.5">Created</th>
                  <th className="px-4 py-3.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-zinc-800 font-medium">
                {filteredOrders.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="text-center py-12 text-gray-400 text-xs">
                      No matching orders found.
                    </td>
                  </tr>
                ) : (
                  filteredOrders.map((order) => (
                    <tr
                      key={order.id}
                      onClick={() => setSelectedOrder(order)}
                      className="hover:bg-amber-50/50 dark:hover:bg-zinc-800/50 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3 font-mono font-bold text-gray-900 dark:text-white">
                        #{order.orderNumber}
                      </td>
                      <td className="px-4 py-3">
                        <FulfillmentChip order={order} />
                      </td>
                      <td className="px-4 py-3">
                        <ServiceChips order={order} />
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${getStatusBadge(
                            order.status
                          )}`}
                        >
                          {order.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-gray-900 dark:text-white">
                          {order.customerName}
                        </div>
                        {order.customerPhone && (
                          <div className="text-[10px] text-gray-400">{order.customerPhone}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-gray-900 dark:text-white">
                          {order.serviceType === 'taxi'
                            ? (order.pickup?.address || 'Pickup Pin')
                            : (order.merchantName || order.pickup?.label || 'Direct Pickup')}
                        </div>
                        <div className="text-[10px] text-gray-400 truncate max-w-[150px]">
                          {order.pickup?.address || '—'}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {order.isPickup || order.fulfillmentType === 'pickup' ? (
                          <span className="text-gray-400 dark:text-zinc-500 text-[11px] font-medium italic">
                            No driver (Pick Up)
                          </span>
                        ) : order.riderName ? (
                          <div className="flex items-center gap-1.5 font-semibold text-gray-900 dark:text-white">
                            <Car className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                            <span>{order.riderName}</span>
                          </div>
                        ) : (
                          <span className="text-amber-600 dark:text-amber-400 text-[11px] font-bold animate-pulse">
                            Unassigned
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <PaymentChip order={order} />
                      </td>
                      <td className="px-4 py-3 font-semibold text-gray-700 dark:text-zinc-300">
                        {Number(order.fees?.tip || 0) > 0 ? (
                          <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                            ₱{Number(order.fees?.tip).toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-gray-400">₱0.00</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-bold text-gray-900 dark:text-white">
                        ₱{Number(order.fees?.total || 0).toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-gray-500 dark:text-zinc-400 whitespace-nowrap">
                        {formatRelativeTime(order.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedOrder(order);
                          }}
                          className="px-2.5 py-1 rounded-lg text-xs font-bold text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40 transition-colors"
                        >
                          Details &rarr;
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Kanban View */
        <div className="flex gap-4 overflow-x-auto pb-4 pt-1">
          {['Placed Order', 'Preparing', 'Ready', 'Driver is on the way / Trip', 'Delivered / Completed', 'Cancelled'].map(
            (colStatus) => {
              const colOrders = filteredOrders.filter((o) => {
                if (colStatus === 'Delivered / Completed') {
                  return o.status === 'Delivered' || o.status === 'Completed';
                }
                if (colStatus === 'Driver is on the way / Trip') {
                  return (
                    o.status === 'Driver is on the way' ||
                    o.status === 'Driver arrived' ||
                    o.status === 'On trip' ||
                    o.status === 'Rider is on the way' ||
                    o.status.startsWith('Rider is on the way') ||
                    o.status.startsWith('Arrived')
                  );
                }
                return o.status === colStatus;
              });

              return (
                <div
                  key={colStatus}
                  className="w-80 shrink-0 bg-gray-100/70 dark:bg-zinc-900/70 rounded-2xl p-3 border border-gray-200 dark:border-zinc-800 flex flex-col max-h-[750px]"
                >
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-gray-200 dark:border-zinc-800">
                    <span className="font-bold text-xs uppercase tracking-wider text-gray-700 dark:text-zinc-300">
                      {colStatus}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-200">
                      {colOrders.length}
                    </span>
                  </div>

                  <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
                    {colOrders.map((ord) => (
                      <div
                        key={ord.id}
                        onClick={() => setSelectedOrder(ord)}
                        className="bg-white dark:bg-zinc-850 p-3.5 rounded-xl border border-gray-200 dark:border-zinc-750 shadow-xs hover:border-amber-400 dark:hover:border-amber-500 cursor-pointer transition-all"
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="font-mono font-bold text-xs text-gray-900 dark:text-white">
                            #{ord.orderNumber}
                          </span>
                          <ServiceChips order={ord} />
                        </div>
                        <p className="text-xs font-semibold text-gray-900 dark:text-zinc-100">
                          {ord.serviceType === 'taxi' ? `Taxi: ${ord.pickup?.address || 'Pickup'}` : ord.merchantName || ord.serviceType}
                        </p>
                        <p className="text-[11px] text-gray-500 dark:text-zinc-400 mb-2">
                          Customer: {ord.customerName}
                        </p>
                        <div className="pt-2 border-t border-gray-100 dark:border-zinc-800 space-y-1.5">
                          <div className="flex items-center justify-between">
                            <PaymentChip order={ord} />
                            <div className="text-right">
                              <span className="font-black text-amber-600 text-xs">
                                ₱{Number(ord.fees?.total || 0).toFixed(2)}
                              </span>
                              {Number(ord.fees?.tip || 0) > 0 && (
                                <div className="text-[10px] text-emerald-600 font-semibold">
                                  +₱{Number(ord.fees?.tip).toFixed(2)} tip
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="text-[10px] text-gray-500 flex justify-between">
                            <span>Driver:</span>
                            <span className="font-semibold text-gray-700 dark:text-zinc-300 truncate max-w-[120px]">
                              {ord.isPickup || ord.fulfillmentType === 'pickup'
                                ? 'No driver (Pick Up)'
                                : ord.riderName || 'Unassigned'}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            }
          )}
        </div>
      )}

      {/* Selected Order Detail Modal / Drawer */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/60 backdrop-blur-xs">
          <div className="h-full w-full max-w-2xl bg-white dark:bg-zinc-950 border-l border-gray-200 dark:border-zinc-800 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200 overflow-hidden">
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-gray-200 dark:border-zinc-800 flex items-center justify-between bg-white dark:bg-zinc-950">
              <div className="flex items-center gap-3">
                <span className="font-mono font-black text-lg text-gray-900 dark:text-white">
                  #{selectedOrder.orderNumber}
                </span>
                <ServiceChips order={selectedOrder} />
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold border ${getStatusBadge(
                    selectedOrder.status
                  )}`}
                >
                  {selectedOrder.status}
                </span>
              </div>

              <button
                onClick={() => setSelectedOrder(null)}
                className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-zinc-200 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Scrollable Body */}
            <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">
              {/* Order Status & Actions Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200/80 dark:border-amber-900/50">
                <div>
                  <span className="text-[10px] uppercase font-bold text-amber-700 dark:text-amber-400">
                    Current Dispatch Status
                  </span>
                  <div className="font-bold text-sm text-gray-900 dark:text-white">
                    {selectedOrder.status}
                  </div>
                  {selectedOrder.cancelReason && (
                    <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                      Reason: {selectedOrder.cancelReason}
                    </p>
                  )}
                </div>

                {/* Dispatch Actions buttons */}
                {selectedOrder.status !== 'Delivered' &&
                  selectedOrder.status !== 'Completed' &&
                  selectedOrder.status !== 'Cancelled' &&
                  selectedOrder.status !== 'Rejected' && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleMarkCompleted}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 shadow-xs transition-colors"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" /> Mark Completed
                      </button>
                      {!selectedOrder.isPickup && selectedOrder.fulfillmentType !== 'pickup' && (
                        <button
                          onClick={() => setReassignModalOpen(true)}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-white/90 text-gray-800 text-xs font-bold hover:bg-white shadow-xs transition-colors border border-gray-300 dark:border-zinc-700"
                        >
                          <RotateCcw className="w-3.5 h-3.5" /> Reassign Driver
                        </button>
                      )}
                      <button
                        onClick={() => {
                          const isWalletPaid =
                            (selectedOrder.paymentMethod || selectedOrder.payment?.method || '').toLowerCase() ===
                            'wallet';
                          setRefundToWallet(isWalletPaid);
                          setCancelModalOpen(true);
                        }}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-red-600 text-white text-xs font-bold hover:bg-red-700 shadow-xs transition-colors"
                      >
                        <Ban className="w-3.5 h-3.5" /> Cancel Order
                      </button>
                    </div>
                  )}
              </div>

              {/* Stakeholders Contact Cards: Customer, Merchant/Service, Driver */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* Customer */}
                <div className="p-3.5 rounded-xl bg-gray-50 dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 text-xs space-y-1">
                  <div className="flex items-center gap-1.5 text-gray-400 font-bold uppercase text-[10px]">
                    <User className="w-3.5 h-3.5 text-blue-500" /> Customer
                  </div>
                  <div className="font-bold text-gray-900 dark:text-white truncate">
                    {selectedOrder.customerName}
                  </div>
                  {selectedOrder.customerPhone ? (
                    <a
                      href={`tel:${selectedOrder.customerPhone}`}
                      className="text-amber-600 dark:text-amber-400 font-semibold hover:underline flex items-center gap-1 text-[11px]"
                    >
                      <Phone className="w-3 h-3" /> {selectedOrder.customerPhone}
                    </a>
                  ) : (
                    <div className="text-gray-400 text-[11px]">No phone listed</div>
                  )}
                </div>

                {/* Merchant or Service */}
                <div className="p-3.5 rounded-xl bg-gray-50 dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 text-xs space-y-1">
                  <div className="flex items-center gap-1.5 text-gray-400 font-bold uppercase text-[10px]">
                    <Store className="w-3.5 h-3.5 text-amber-500" />
                    <span>{selectedOrder.serviceType === 'taxi' ? 'Taxi Service' : 'Merchant'}</span>
                  </div>
                  <div className="font-bold text-gray-900 dark:text-white truncate">
                    {selectedOrder.serviceType === 'taxi'
                      ? 'Passenger Ride-Hailing'
                      : selectedOrder.merchantName || 'Direct Service'}
                  </div>
                  {selectedOrder.merchantPhone ? (
                    <a
                      href={`tel:${selectedOrder.merchantPhone}`}
                      className="text-amber-600 dark:text-amber-400 font-semibold hover:underline flex items-center gap-1 text-[11px]"
                    >
                      <Phone className="w-3 h-3" /> {selectedOrder.merchantPhone}
                    </a>
                  ) : (
                    <div className="text-gray-400 text-[11px]">
                      {selectedOrder.serviceType === 'taxi' ? 'Point-to-point transit' : 'No phone listed'}
                    </div>
                  )}
                </div>

                {/* Driver & Vehicle */}
                <div className="p-3.5 rounded-xl bg-gray-50 dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 text-xs space-y-1">
                  <div className="flex items-center gap-1.5 text-gray-400 font-bold uppercase text-[10px]">
                    <Car className="w-3.5 h-3.5 text-emerald-500" /> Assigned Driver
                  </div>
                  {selectedOrder.isPickup || selectedOrder.fulfillmentType === 'pickup' ? (
                    <div>
                      <div className="font-bold text-gray-900 dark:text-white">Store Pick Up</div>
                      <div className="text-gray-400 text-[11px]">No driver needed (Customer pickup)</div>
                    </div>
                  ) : (
                    <>
                      <div className="font-bold text-gray-900 dark:text-white truncate">
                        {selectedOrder.riderName || 'Unassigned'}
                      </div>
                      {selectedOrder.riderPhone ? (
                        <a
                          href={`tel:${selectedOrder.riderPhone}`}
                          className="text-amber-600 dark:text-amber-400 font-semibold hover:underline flex items-center gap-1 text-[11px]"
                        >
                          <Phone className="w-3 h-3" /> {selectedOrder.riderPhone}
                        </a>
                      ) : (
                        <div className="text-amber-600 text-[11px]">Searching for driver...</div>
                      )}
                      {(selectedOrder.riderVehicle || selectedOrder.vehicleType) && (
                        <div className="text-[10px] text-gray-500 dark:text-zinc-400 pt-0.5">
                          Vehicle: <strong className="text-gray-800 dark:text-zinc-200">
                            {VEHICLE_LABELS[(selectedOrder.vehicleType || selectedOrder.riderVehicle?.vehicleType) as VehicleType] || 'Motorcycle'}
                          </strong>
                          {selectedOrder.riderVehicle?.plate && ` • ${selectedOrder.riderVehicle.plate}`}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Route Map (Pickup = Green 1, Drop-off / Next Stops = Red 2, 3, 4...) */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-zinc-400 mb-2">
                  Trip Route Map
                </label>
                <div
                  ref={miniMapContainerRef}
                  className="h-60 w-full rounded-2xl border border-gray-200 dark:border-zinc-800 overflow-hidden shadow-xs"
                />

                {/* Route stops list */}
                <div className="mt-3 space-y-2">
                  {/* Stop 1: Pickup */}
                  <div className="p-3 rounded-xl bg-gray-50 dark:bg-zinc-900 flex items-start gap-3 border border-gray-200/60 dark:border-zinc-800">
                    <div className="w-6 h-6 rounded-full bg-emerald-600 text-white font-black text-xs flex items-center justify-center shrink-0 mt-0.5 shadow-xs">
                      1
                    </div>
                    <div className="flex-1 text-xs">
                      <span className="text-[10px] uppercase font-bold text-emerald-600 block">
                        Pickup Location
                      </span>
                      <p className="text-gray-900 dark:text-white font-medium">
                        {selectedOrder.pickup?.address || 'Pickup Point'}
                      </p>
                    </div>
                  </div>

                  {/* Stop 2: Dropoff (or first stop) */}
                  {selectedOrder.stops && selectedOrder.stops.length > 0 ? (
                    selectedOrder.stops.map((st, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-xl bg-gray-50 dark:bg-zinc-900 flex items-start gap-3 border border-gray-200/60 dark:border-zinc-800"
                      >
                        <div className="w-6 h-6 rounded-full bg-red-600 text-white font-black text-xs flex items-center justify-center shrink-0 mt-0.5 shadow-xs">
                          {idx + 2}
                        </div>
                        <div className="flex-1 text-xs">
                          <span className="text-[10px] uppercase font-bold text-red-600 block">
                            {idx === selectedOrder.stops!.length - 1 ? 'Final Destination' : `Stop ${idx + 2}`}
                          </span>
                          <p className="text-gray-900 dark:text-white font-medium">
                            {st.address || `Stop ${idx + 2}`}
                          </p>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="p-3 rounded-xl bg-gray-50 dark:bg-zinc-900 flex items-start gap-3 border border-gray-200/60 dark:border-zinc-800">
                      <div className="w-6 h-6 rounded-full bg-red-600 text-white font-black text-xs flex items-center justify-center shrink-0 mt-0.5 shadow-xs">
                        2
                      </div>
                      <div className="flex-1 text-xs">
                        <span className="text-[10px] uppercase font-bold text-red-600 block">
                          Drop-Off Destination
                        </span>
                        <p className="text-gray-900 dark:text-white font-medium">
                          {selectedOrder.dropoff?.address || 'Customer destination'}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Items / Goods / Specifications */}
              {selectedOrder.serviceType !== 'taxi' && (
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-zinc-400 mb-2">
                    Order Items & Goods
                  </label>
                  <div className="border border-gray-200 dark:border-zinc-800 rounded-xl overflow-hidden divide-y divide-gray-100 dark:divide-zinc-800">
                    {(selectedOrder.items || []).map((it, idx) => (
                      <div
                        key={idx}
                        className="p-3 flex items-center justify-between text-xs bg-white dark:bg-zinc-900"
                      >
                        <div>
                          <span className="font-bold text-gray-900 dark:text-white">
                            {it.qty}x {it.name}
                          </span>
                          {it.notes && (
                            <p className="text-[11px] text-gray-400 italic mt-0.5">Note: {it.notes}</p>
                          )}
                        </div>
                        <span className="font-bold text-gray-900 dark:text-white">
                          ₱{(Number(it.price || 0) * Number(it.qty || 1)).toFixed(2)}
                        </span>
                      </div>
                    ))}

                    {/* Parcel Details */}
                    {selectedOrder.parcel && (
                      <div className="p-3 bg-purple-50/50 dark:bg-purple-950/20 text-xs space-y-1">
                        <div className="font-bold text-purple-900 dark:text-purple-300">
                          Parcel Specifications:
                        </div>
                        <p className="text-purple-800 dark:text-purple-400">
                          Item: {selectedOrder.parcel.itemType || 'Package'} • Weight:{' '}
                          {selectedOrder.parcel.weightKg || 1}kg
                        </p>
                        <p className="text-purple-700 dark:text-purple-400">
                          Recipient: {selectedOrder.parcel.recipientName} (
                          {selectedOrder.parcel.recipientPhone})
                        </p>
                      </div>
                    )}

                    {/* Pabili Details */}
                    {selectedOrder.pabili && (
                      <div className="p-3 bg-pink-50/50 dark:bg-pink-950/20 text-xs space-y-1">
                        <div className="font-bold text-pink-900 dark:text-pink-300">
                          Pabili Shopping List:
                        </div>
                        <p className="text-pink-800 dark:text-pink-400">
                          Store: {selectedOrder.pabili.storeName || 'Any store'} • Estimated Budget: ₱
                          {selectedOrder.pabili.estimatedCost || 0}
                        </p>
                        <p className="text-pink-700 dark:text-pink-400 whitespace-pre-wrap">
                          {selectedOrder.pabili.shoppingList}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Financials & Payment Breakdown */}
              <div className="p-4 rounded-2xl bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 space-y-2 text-xs">
                {selectedOrder.serviceType !== 'taxi' && (
                  <div className="flex justify-between text-gray-500">
                    <span>Subtotal Goods</span>
                    <span>₱{Number(selectedOrder.fees?.subtotal || 0).toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-gray-500">
                  <span>{selectedOrder.serviceType === 'taxi' ? 'Ride Distance Fare' : 'Delivery Fee'}</span>
                  <span>₱{Number(selectedOrder.fees?.deliveryFee || 0).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-gray-500">
                  <span>Platform Service Fee</span>
                  <span>₱{Number(selectedOrder.fees?.serviceFee || 0).toFixed(2)}</span>
                </div>
                {Number(selectedOrder.fees?.discount || 0) > 0 && (
                  <div className="flex justify-between text-emerald-600 font-semibold">
                    <span>Voucher Discount</span>
                    <span>-₱{Number(selectedOrder.fees?.discount).toFixed(2)}</span>
                  </div>
                )}
                {Number(selectedOrder.fees?.tip || 0) > 0 && (
                  <div className="flex justify-between text-emerald-600 font-semibold">
                    <span>Driver Tip (Direct to Driver)</span>
                    <span>+₱{Number(selectedOrder.fees?.tip).toFixed(2)}</span>
                  </div>
                )}
                <div className="pt-2 border-t border-gray-200 dark:border-zinc-800 flex justify-between text-base font-black text-gray-900 dark:text-white">
                  <span>Total Due</span>
                  <span className="text-amber-600">
                    ₱{Number(selectedOrder.fees?.total || 0).toFixed(2)}
                  </span>
                </div>
                <div className="pt-2 border-t border-gray-200 dark:border-zinc-800 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Payment Method:</span>
                    <span className="font-bold uppercase text-gray-800 dark:text-zinc-200 flex items-center gap-1.5">
                      {selectedOrder.paymentMethod || 'COD'}
                      {selectedOrder.paymentProvider && (
                        <span className="text-[10px] lowercase text-gray-400 font-normal">
                          ({selectedOrder.paymentProvider})
                        </span>
                      )}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Payment Status:</span>
                    <span
                      className={`font-bold px-2 py-0.5 rounded text-[10px] uppercase ${
                        selectedOrder.walletRefunded
                          ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                          : selectedOrder.paymentStatus === 'Paid' ||
                            ((selectedOrder.paymentMethod || '').toLowerCase() === 'wallet' &&
                              !selectedOrder.walletRefunded)
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                          : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                      }`}
                    >
                      {selectedOrder.walletRefunded
                        ? 'Refunded'
                        : selectedOrder.paymentStatus ||
                          ((selectedOrder.paymentMethod || '').toLowerCase() === 'wallet'
                            ? 'Paid'
                            : 'Pending')}
                    </span>
                  </div>

                  {(selectedOrder.cashToCollect !== undefined ||
                    selectedOrder.codAmount !== undefined) && (
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500">Cash to Collect:</span>
                      <span className="font-extrabold text-amber-600">
                        ₱{Number(selectedOrder.cashToCollect ?? selectedOrder.codAmount ?? 0).toFixed(2)}
                      </span>
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">COD Collected:</span>
                    <span
                      className={`font-bold text-xs ${
                        Number(selectedOrder.codCollected || 0) > 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-gray-400'
                      }`}
                    >
                      ₱{Number(selectedOrder.codCollected || 0).toFixed(2)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Wallet Refunded:</span>
                    <span
                      className={`font-bold px-2 py-0.5 rounded text-[10px] uppercase ${
                        selectedOrder.walletRefunded
                          ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                          : 'bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-zinc-400'
                      }`}
                    >
                      {selectedOrder.walletRefunded ? 'Yes (Refunded)' : 'No'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Timeline from statusHistory */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-zinc-400 mb-2">
                  Full Order Timeline
                </label>
                <div className="space-y-3 relative pl-4 border-l-2 border-amber-300 dark:border-zinc-800 ml-2">
                  {(selectedOrder.statusHistory || []).map((sh, idx) => (
                    <div key={idx} className="relative">
                      <div className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-amber-500 border border-white" />
                      <div className="text-xs font-bold text-gray-900 dark:text-white">
                        {sh.status}
                      </div>
                      <div className="text-[11px] text-gray-400">{formatTimestamp(sh.at)}</div>
                      {sh.note && (
                        <p className="text-[11px] text-gray-600 dark:text-zinc-300 mt-0.5">
                          {sh.note}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Order Confirmation Modal */}
      {cancelModalOpen && selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 rounded-xl bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400">
                <Ban className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-lg text-gray-900 dark:text-white">
                Cancel Order #{selectedOrder.orderNumber}
              </h3>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Responsible Party (Fault) <span className="text-red-500">*</span>
                </label>
                <select
                  value={cancelFault}
                  onChange={(e) => setCancelFault(e.target.value as any)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-gray-900 dark:text-white font-medium"
                >
                  <option value="customer">Customer Fault</option>
                  <option value="merchant">Merchant Fault (Out of stock, closed)</option>
                  <option value="rider">Driver Fault (Vehicle breakdown, unresponsive)</option>
                  <option value="platform">Platform System Error</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Cancellation Reason Preset
                </label>
                <select
                  value={cancelReasonPicker}
                  onChange={(e) => setCancelReasonPicker(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-gray-900 dark:text-white font-medium"
                >
                  <option value="Customer requested cancellation">Customer requested cancellation</option>
                  <option value="Merchant unable to fulfill items">Merchant unable to fulfill items</option>
                  <option value="No drivers available in delivery zone">No drivers available in area</option>
                  <option value="Customer unreachable at address">Customer unreachable at address</option>
                  <option value="Suspected fraudulent order">Suspected fraudulent order</option>
                  <option value="Other">Other / Custom Reason</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Additional Internal Note
                </label>
                <textarea
                  rows={2}
                  value={cancelNote}
                  onChange={(e) => setCancelNote(e.target.value)}
                  placeholder="Provide supporting details for customer support records..."
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                />
              </div>

              {/* Wallet Refund Checkbox (for wallet-paid orders) */}
              {(selectedOrder.paymentMethod || selectedOrder.payment?.method || '').toLowerCase() ===
                'wallet' && (
                <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800">
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={refundToWallet}
                      onChange={(e) => setRefundToWallet(e.target.checked)}
                      disabled={selectedOrder.walletRefunded}
                      className="mt-0.5 rounded border-gray-300 text-amber-500 focus:ring-amber-400"
                    />
                    <div>
                      <span className="font-bold text-xs text-amber-900 dark:text-amber-200 block">
                        Refund to customer's wallet
                      </span>
                      <span className="text-[11px] text-amber-800/80 dark:text-amber-300/80">
                        {selectedOrder.walletRefunded
                          ? 'This order has already been refunded to the customer wallet.'
                          : `Automatically refund ₱${Number(
                              selectedOrder.fees?.total || 0
                            ).toFixed(2)} back to customer's Delivio Wallet.`}
                      </span>
                    </div>
                  </label>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCancelModalOpen(false)}
                  disabled={cancelling}
                  className="px-4 py-2 text-xs font-bold text-gray-600 dark:text-zinc-400 hover:bg-gray-100 rounded-xl"
                >
                  Keep Order Active
                </button>
                <button
                  type="button"
                  onClick={handleCancelOrder}
                  disabled={cancelling}
                  className="px-5 py-2 text-xs font-bold rounded-xl bg-red-600 hover:bg-red-700 text-white flex items-center gap-2"
                >
                  {cancelling && <Loader2 className="w-4 h-4 animate-spin" />}
                  Confirm Cancellation
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reassign Driver Modal */}
      {reassignModalOpen && selectedOrder && (
        <ConfirmationModal
          isOpen={reassignModalOpen}
          onClose={() => setReassignModalOpen(false)}
          onConfirm={handleReassignDriver}
          title={`Reassign Driver for #${selectedOrder.orderNumber}`}
          message={`This will clear ${selectedOrder.riderName || 'the assigned driver'} and vehicle details from this order and return it to 'Placed Order' for dispatch.`}
          confirmLabel="Unassign & Dispatch Again"
          reasonRequired={true}
          reasonPlaceholder="Specify reason for driver reassignment (e.g., driver idle, vehicle breakdown, wrong route)..."
          isDestructive={false}
        />
      )}
    </div>
  );
};
