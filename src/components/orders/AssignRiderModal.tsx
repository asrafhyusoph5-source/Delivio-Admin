import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  X,
  Search,
  Car,
  MapPin,
  Phone,
  CheckCircle2,
  Loader2,
  UserCheck,
  AlertTriangle
} from 'lucide-react';
import {
  db,
  collection,
  doc,
  getDoc,
  getDocs,
  writeBatch,
  arrayUnion
} from '../../firebase';
import { haversineKm } from '../merchants/CustomerVisibilityCheckPanel';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { logAuditEvent } from '../../utils/audit';
import { nowTs, arrayNowTs } from '../../utils/date';
import { formatOrderNumber } from '../../utils/orderNumber';
import { resolveOrderMerchantDisplay } from '../../utils/outletUtils';
import {
  normalizeParcelVehicle,
  getParcelVehicleLabel,
  isRiderVehicleEligibleForParcel
} from '../../utils/parcel';
import {
  SERVICE_LABELS,
  SERVICES_BY_VEHICLE,
  VEHICLE_LABELS,
  VEHICLE_TYPES,
  type VehicleType
} from '../../constants';
import type { Order, OrderServiceType, OrderStatus, Rider, Merchant, City } from '../../types';

interface AssignRiderModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: Order;
  merchantsById: Record<string, Merchant>;
  cities: City[];
  onAssigned?: (updatedFields: Partial<Order>) => void;
}

const TERMINAL_ORDER_STATUSES = new Set(['Delivered', 'Completed', 'Cancelled', 'Rejected']);

export function getAcceptedStatusForService(serviceType: OrderServiceType): OrderStatus {
  switch (serviceType) {
    case 'taxi':
      return 'Driver is on the way';
    case 'parcel':
      return 'Rider is on the way to sender';
    case 'pabili':
      return 'Rider is on the way to vendor';
    case 'food':
    case 'convenience':
    case 'request_rider':
    default:
      return 'Rider is on the way';
  }
}

function normalizeVehicleLower(raw?: string | null): VehicleType | null {
  if (!raw) return null;
  const val = raw.trim().toLowerCase();
  if (val === 'motorcycle' || val === 'tricycle' || val === 'car4' || val === 'car8') {
    return val;
  }
  if (val === 'car' || val === '4-seater car') return 'car4';
  if (val === 'van' || val === '8-seater car') return 'car8';
  if (val === 'motorbike' || val === 'motor') return 'motorcycle';
  return null;
}

interface CandidateRiderItem {
  rider: Rider;
  normalizedVehicle: VehicleType;
  eligible: boolean;
  ineligibleReason: string | null;
  distanceKm: number | null;
}

export const AssignRiderModal: React.FC<AssignRiderModalProps> = ({
  isOpen,
  onClose,
  order,
  merchantsById,
  cities,
  onAssigned
}) => {
  const { adminProfile } = useAuth();
  const { showSuccess, showError } = useToast();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [riders, setRiders] = useState<Rider[]>([]);
  const [activeOrdersByRiderId, setActiveOrdersByRiderId] = useState<
    Record<string, { id: string; orderNumber?: string; status: string }>
  >({});
  const [freshMerchant, setFreshMerchant] = useState<Merchant | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRiderId, setSelectedRiderId] = useState<string | null>(null);

  const serviceType: OrderServiceType = (order.serviceType || 'food') as OrderServiceType;
  const serviceLabel = SERVICE_LABELS[serviceType] || serviceType;
  const acceptedStatus = getAcceptedStatusForService(serviceType);
  const isMerchantService =
    serviceType === 'food' || serviceType === 'convenience' || serviceType === 'request_rider';
  const mId = isMerchantService ? order.merchantId || order.sourceMerchantId || '' : '';

  const loadCandidates = useCallback(async () => {
    if (!isOpen) return;
    try {
      setLoading(true);
      setError(null);
      setSelectedRiderId(null);

      const [ridersSnap, ordersSnap, merchantSnap] = await Promise.all([
        getDocs(collection(db, 'riders')),
        getDocs(collection(db, 'orders')),
        mId ? getDoc(doc(db, 'merchants', mId)) : Promise.resolve(null)
      ]);

      const riderList: Rider[] = [];
      ridersSnap.forEach((d) => {
        const dt = d.data();
        const vNorm = normalizeVehicleLower(dt.vehicleType) || 'motorcycle';
        riderList.push({
          id: d.id,
          name: dt.name || 'Driver',
          email: dt.email || '',
          phone: dt.phone || '',
          photoUrl: dt.photoUrl || '',
          riderCode: dt.riderCode || d.id.substring(0, 8),
          status: dt.status || 'active',
          cityId: dt.cityId,
          vehicleType: dt.vehicleType || vNorm,
          vehicleModel: dt.vehicleModel || '',
          vehicleColor: dt.vehicleColor || '',
          seats: Number(dt.seats) || 1,
          plate: dt.plate || '',
          allowedServices: Array.isArray(dt.allowedServices) ? dt.allowedServices : undefined,
          activeServices: Array.isArray(dt.activeServices) ? dt.activeServices : undefined,
          isOnline: Boolean(dt.isOnline),
          location: dt.location,
          currentOrderId: dt.currentOrderId || null,
          priorityRider: Boolean(dt.priorityRider)
        } as Rider);
      });

      const activeMap: Record<string, { id: string; orderNumber?: string; status: string }> = {};
      ordersSnap.forEach((d) => {
        if (d.id === order.id) return;
        const dt = d.data();
        const rId = dt.riderId;
        const st = dt.status || 'Placed Order';
        if (rId && !TERMINAL_ORDER_STATUSES.has(st)) {
          activeMap[rId] = {
            id: d.id,
            orderNumber: dt.orderNumber,
            status: st
          };
        }
      });

      let loadedMerchant: Merchant | null = null;
      if (merchantSnap && merchantSnap.exists()) {
        const md = merchantSnap.data();
        loadedMerchant = {
          id: merchantSnap.id,
          name: md.name || 'Store',
          ownerName: md.ownerName || '',
          email: md.email || '',
          phone: md.phone || '',
          type: md.type || 'food',
          status: md.status || 'active',
          isOpen: Boolean(md.isOpen),
          cityId: md.cityId,
          address: md.address || '',
          lat: Number(md.lat) || 0,
          lng: Number(md.lng) || 0,
          commissionRate: md.commissionRate ?? 15,
          specialRadius: md.specialRadius,
          chainId: md.chainId,
          chainName: md.chainName,
          isBranch: md.isBranch,
          branchName: md.branchName,
          branchCode: md.branchCode
        };
      } else if (mId && merchantsById[mId]) {
        loadedMerchant = merchantsById[mId];
      }

      setRiders(riderList);
      setActiveOrdersByRiderId(activeMap);
      setFreshMerchant(loadedMerchant);
    } catch (err: any) {
      setError(err?.message || 'Failed to load online riders.');
    } finally {
      setLoading(false);
    }
  }, [isOpen, order.id, mId, merchantsById]);

  useEffect(() => {
    if (isOpen) {
      loadCandidates();
    }
  }, [isOpen, loadCandidates]);

  const evaluated = useMemo(() => {
    const merchant = isMerchantService ? freshMerchant || (mId ? merchantsById[mId] : undefined) : undefined;
    const pickupLat = isMerchantService
      ? Number(merchant?.lat) || Number(order.pickup?.lat) || 0
      : Number(order.pickup?.lat) || 0;
    const pickupLng = isMerchantService
      ? Number(merchant?.lng) || Number(order.pickup?.lng) || 0
      : Number(order.pickup?.lng) || 0;
    const hasPickupCoords =
      Number.isFinite(pickupLat) &&
      Number.isFinite(pickupLng) &&
      pickupLat !== 0 &&
      pickupLng !== 0;

    const targetCityId = order.cityId || merchant?.cityId || '';
    const orderVehicleRaw = String(order.vehicleType || '').trim().toLowerCase();
    const excludedSet = new Set<string>(
      [
        ...(Array.isArray(order.excludeRiderIds) ? order.excludeRiderIds : []),
        ...(Array.isArray((order.riderRequest as any)?.excludedRiderIds)
          ? (order.riderRequest as any).excludedRiderIds
          : []),
        ...(Array.isArray((order.riderRequest as any)?.declinedRiderIds)
          ? (order.riderRequest as any).declinedRiderIds
          : [])
      ].map(String)
    );

    const onlineOnly = riders.filter((r) => Boolean(r.isOnline));

    const items: CandidateRiderItem[] = onlineOnly.map((rider) => {
      const normalizedVehicle = normalizeVehicleLower(rider.vehicleType) || 'motorcycle';
      const rawRiderVehicle = String(rider.vehicleType || '').trim().toLowerCase();

      const rLat = Number(rider.location?.lat);
      const rLng = Number(rider.location?.lng);
      const hasRiderCoords =
        Number.isFinite(rLat) && Number.isFinite(rLng) && rLat !== 0 && rLng !== 0;
      const distKm =
        hasPickupCoords && hasRiderCoords
          ? haversineKm(rLat, rLng, pickupLat, pickupLng)
          : null;

      let reason: string | null = null;
      const activeAssigned = activeOrdersByRiderId[rider.id];
      const hasCurrentOrder = Boolean(rider.currentOrderId && rider.currentOrderId !== order.id);
      const allowedArr = Array.isArray(rider.allowedServices)
        ? rider.allowedServices.map((s) => String(s).trim().toLowerCase())
        : [];
      const supportsVehicleService = (SERVICES_BY_VEHICLE[normalizedVehicle] || []).includes(
        serviceType
      );

      if (rider.status !== 'active') {
        reason = `Status is "${rider.status}"`;
      } else if (excludedSet.has(rider.id)) {
        reason = 'Excluded from this order';
      } else if (activeAssigned) {
        reason = `Busy on #${activeAssigned.orderNumber || activeAssigned.id.slice(0, 8)}`;
      } else if (hasCurrentOrder) {
        reason = 'Busy with another active order';
      } else if (targetCityId && rider.cityId && rider.cityId !== targetCityId) {
        reason = 'Different city';
      } else if (
        serviceType === 'parcel' &&
        !isRiderVehicleEligibleForParcel(normalizedVehicle, order.vehicleType)
      ) {
        const parcelLabel = getParcelVehicleLabel(order.vehicleType);
        reason =
          normalizeParcelVehicle(order.vehicleType) === 'sedan'
            ? `Parcel Sedan requires 4-wheel (car4) or 8-seater car (car8)`
            : `Parcel ${parcelLabel} requires motorcycle`;
      } else if (!supportsVehicleService) {
        reason = `${VEHICLE_LABELS[normalizedVehicle]} cannot take ${serviceLabel}`;
      } else if (!allowedArr.includes(serviceType)) {
        reason = `allowedServices missing ${serviceType}`;
      } else if (
        serviceType === 'taxi' &&
        orderVehicleRaw &&
        rawRiderVehicle !== orderVehicleRaw
      ) {
        reason = `Vehicle ${rawRiderVehicle || 'unknown'} ≠ ${orderVehicleRaw}`;
      }

      return {
        rider,
        normalizedVehicle,
        eligible: !reason,
        ineligibleReason: reason,
        distanceKm: distKm
      };
    });

    items.sort((a, b) => {
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
      const dA = a.distanceKm ?? Number.POSITIVE_INFINITY;
      const dB = b.distanceKm ?? Number.POSITIVE_INFINITY;
      if (dA !== dB) return dA - dB;
      return a.rider.name.localeCompare(b.rider.name);
    });

    const mergedMerchantsMap =
      merchant && mId ? { ...merchantsById, [mId]: merchant } : merchantsById;
    const pickupLabel = isMerchantService
      ? resolveOrderMerchantDisplay(order, mergedMerchantsMap, true) ||
        order.pickup?.label ||
        order.pickup?.address ||
        'Merchant'
      : order.pickup?.label || order.pickup?.address || 'Pickup';

    return {
      pickupLabel,
      eligibleRiders: items.filter((i) => i.eligible),
      ineligibleCount: items.filter((i) => !i.eligible).length,
      totalOnline: items.length
    };
  }, [
    riders,
    activeOrdersByRiderId,
    freshMerchant,
    isMerchantService,
    mId,
    merchantsById,
    order,
    serviceType,
    serviceLabel
  ]);

  const visibleEligibleRiders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return evaluated.eligibleRiders;
    return evaluated.eligibleRiders.filter(
      ({ rider }) =>
        (rider.name || '').toLowerCase().includes(q) ||
        (rider.riderCode || '').toLowerCase().includes(q) ||
        (rider.phone || '').toLowerCase().includes(q)
    );
  }, [evaluated.eligibleRiders, searchQuery]);

  const handleConfirmAssign = async () => {
    if (!selectedRiderId || order.onHold) return;
    const chosen = evaluated.eligibleRiders.find((c) => c.rider.id === selectedRiderId);
    if (!chosen) return;

    const { rider, normalizedVehicle } = chosen;
    const defaultSeats =
      VEHICLE_TYPES.find((v) => v.id === normalizedVehicle)?.defaultSeats || 1;
    const vehicleInfo = {
      type: normalizedVehicle,
      vehicleType: normalizedVehicle,
      model: rider.vehicleModel || '',
      color: rider.vehicleColor || '',
      plate: rider.plate || '',
      seats: Number(rider.seats) || defaultSeats
    };

    try {
      setSubmitting(true);
      const now = nowTs();
      const batch = writeBatch(db);
      const orderRef = doc(db, 'orders', order.id);

      const orderUpdate: Record<string, any> = {
        riderId: rider.id,
        riderName: rider.name || 'Driver',
        riderPhone: rider.phone || '',
        riderPhotoUrl: rider.photoUrl || null,
        riderVehicle: vehicleInfo,
        status: acceptedStatus,
        acceptedAt: now,
        updatedAt: now,
        statusHistory: arrayUnion({
          status: acceptedStatus,
          at: arrayNowTs(),
          note: `Manually assigned to ${rider.name} by Admin (${adminProfile?.name || 'Operations'})`
        })
      };

      if (serviceType === 'request_rider' || order.riderRequest) {
        orderUpdate['riderRequest.status'] = 'Accepted';
        orderUpdate['riderRequest.acceptedAt'] = now;
      }

      batch.update(orderRef, orderUpdate);
      batch.update(doc(db, 'riders', rider.id), {
        currentOrderId: order.id,
        updatedAt: now
      });

      await batch.commit();

      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        adminEmail: adminProfile?.email,
        action: 'MANUAL_ASSIGN_RIDER',
        entityType: 'order',
        entityId: order.id,
        details: `Manually assigned rider ${rider.name} (${rider.id}) to ${serviceLabel} order #${formatOrderNumber(order)} and set status to "${acceptedStatus}".`,
        oldValue: {
          riderId: order.riderId || null,
          status: order.status
        },
        newValue: {
          riderId: rider.id,
          riderName: rider.name,
          status: acceptedStatus
        }
      });

      showSuccess(
        `Assigned ${rider.name} to ${formatOrderNumber(order)} (${acceptedStatus}).`
      );

      onAssigned?.({
        riderId: rider.id,
        riderName: rider.name,
        riderPhone: rider.phone,
        riderPhotoUrl: rider.photoUrl || null,
        riderVehicle: vehicleInfo,
        status: acceptedStatus,
        ...(serviceType === 'request_rider' || order.riderRequest
          ? { riderRequest: { ...(order.riderRequest || {}), status: 'Accepted' } }
          : {})
      });
      onClose();
    } catch (err: any) {
      showError(err);
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-5 bg-black/60 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[90vh] bg-white dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-gray-200 dark:border-zinc-800 flex items-start justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-100 text-emerald-900 dark:bg-emerald-950/70 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                <UserCheck className="w-3.5 h-3.5 text-emerald-600" />
                <span>Assign rider manually</span>
              </span>
              <h2 className="text-base font-extrabold text-gray-900 dark:text-white font-mono">
                {formatOrderNumber(order)}
              </h2>
              <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-gray-100 dark:bg-zinc-800 text-gray-800 dark:text-zinc-200 border border-gray-200 dark:border-zinc-700">
                {serviceLabel}
              </span>
              {(order.vehicleType || serviceType === 'parcel') && (
                <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/50 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                  {serviceType === 'parcel'
                    ? getParcelVehicleLabel(order.vehicleType)
                    : order.vehicleType}
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 dark:text-zinc-400">
              Pickup: <strong className="text-gray-800 dark:text-zinc-200">{evaluated.pickupLabel}</strong>
              {' · '}
              Sets status to <strong className="text-emerald-700 dark:text-emerald-400">{acceptedStatus}</strong>
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-zinc-800"
            aria-label="Close manual assignment"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search & Count bar */}
        <div className="px-4 sm:px-5 py-3 border-b border-gray-100 dark:border-zinc-800 bg-gray-50/70 dark:bg-zinc-900/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="text-xs text-gray-600 dark:text-zinc-300 font-semibold">
            Showing <strong className="text-emerald-700 dark:text-emerald-400">{evaluated.eligibleRiders.length}</strong> eligible online rider{evaluated.eligibleRiders.length === 1 ? '' : 's'}
            {evaluated.ineligibleCount > 0 && (
              <span className="text-gray-400 ml-1">
                ({evaluated.ineligibleCount} online ineligible)
              </span>
            )}
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search rider name, code, phone..."
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-amber-400"
            />
          </div>
        </div>

        {/* On Hold Warning */}
        {order.onHold && (
          <div className="mx-4 sm:mx-5 mt-3 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              <strong>Order is ON HOLD</strong> ({order.holdReason || 'close_restaurant'}). Resolve the Rider Report before assigning a rider.
            </span>
          </div>
        )}

        {/* Riders List */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-2.5">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-xs text-gray-500">
              <Loader2 className="w-6 h-6 animate-spin text-amber-500" />
              <span>Checking eligible online riders...</span>
            </div>
          ) : error ? (
            <div className="p-4 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : visibleEligibleRiders.length === 0 ? (
            <div className="py-12 text-center space-y-1.5">
              <p className="text-xs font-bold text-gray-700 dark:text-zinc-300">
                No eligible online riders found for this {serviceLabel} order.
              </p>
              <p className="text-[11px] text-gray-400 max-w-md mx-auto">
                Riders must be active, online, not excluded or busy on another order, and have <code className="font-mono">{serviceType}</code> in <code className="font-mono">allowedServices</code>
                {serviceType === 'taxi' && order.vehicleType ? ` with vehicleType "${order.vehicleType}"` : ''}
                {serviceType === 'parcel'
                  ? ` with ${normalizeParcelVehicle(order.vehicleType) === 'sedan' ? '4-wheel (car4) or 8-seater (car8) car' : 'motorcycle'}`
                  : ''}.
              </p>
            </div>
          ) : (
            visibleEligibleRiders.map(({ rider, normalizedVehicle, distanceKm }) => {
              const isSelected = selectedRiderId === rider.id;
              const cityLabel =
                cities.find((c) => c.id === rider.cityId)?.name || rider.cityId || 'No city';

              return (
                <button
                  key={rider.id}
                  type="button"
                  onClick={() => setSelectedRiderId(rider.id)}
                  className={`w-full text-left p-3.5 rounded-xl border transition-all flex items-center justify-between gap-3 ${
                    isSelected
                      ? 'border-amber-500 bg-amber-50/70 dark:bg-amber-950/30 ring-1 ring-amber-400'
                      : 'border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-gray-300 dark:hover:border-zinc-700'
                  }`}
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-extrabold text-sm text-gray-900 dark:text-white">
                        {rider.name}
                      </span>
                      <span className="font-mono text-[11px] text-gray-500 dark:text-zinc-400">
                        {rider.riderCode}
                      </span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                        Online
                      </span>
                    </div>
                    <div className="flex items-center gap-3 flex-wrap text-[11px] text-gray-500 dark:text-zinc-400">
                      <span className="inline-flex items-center gap-1 font-semibold text-gray-700 dark:text-zinc-300">
                        <Car className="w-3 h-3 text-gray-400" />
                        {VEHICLE_LABELS[normalizedVehicle] || rider.vehicleType}
                        {rider.plate ? ` (${rider.plate})` : ''}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-gray-400" />
                        {cityLabel}
                      </span>
                      {rider.phone && (
                        <span className="inline-flex items-center gap-1 font-mono">
                          <Phone className="w-3 h-3 text-gray-400" />
                          {rider.phone}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 shrink-0">
                    {distanceKm !== null && (
                      <span className="px-2 py-0.5 rounded-md bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-zinc-300 text-xs font-bold tabular-nums">
                        {distanceKm.toFixed(2)} km
                      </span>
                    )}
                    <span
                      className={`w-5 h-5 rounded-full flex items-center justify-center border ${
                        isSelected
                          ? 'bg-amber-500 border-amber-500 text-black'
                          : 'border-gray-300 dark:border-zinc-700'
                      }`}
                    >
                      {isSelected && <CheckCircle2 className="w-3.5 h-3.5" />}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-4 sm:p-5 border-t border-gray-200 dark:border-zinc-800 bg-gray-50/70 dark:bg-zinc-900/60 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 rounded-xl border border-gray-200 dark:border-zinc-700 text-xs font-bold text-gray-700 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirmAssign}
            disabled={!selectedRiderId || submitting || loading || Boolean(order.onHold)}
            className="delivio-btn-yellow px-4 py-2 rounded-xl text-xs font-extrabold flex items-center gap-1.5 disabled:opacity-50"
          >
            {submitting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <UserCheck className="w-3.5 h-3.5" />
            )}
            <span>Assign Rider</span>
          </button>
        </div>
      </div>
    </div>
  );
};
