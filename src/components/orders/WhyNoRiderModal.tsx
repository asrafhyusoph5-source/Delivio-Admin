import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  X,
  RefreshCw,
  Search,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  MapPin,
  Car,
  Zap,
  ShieldAlert
} from 'lucide-react';
import { db, collection, doc, getDoc, getDocs } from '../../firebase';
import { haversineKm } from '../merchants/CustomerVisibilityCheckPanel';
import { parseDate } from '../../utils/date';
import { formatOrderNumber } from '../../utils/orderNumber';
import { resolveOrderMerchantDisplay } from '../../utils/outletUtils';
import { SERVICE_LABELS, SERVICES_BY_VEHICLE, VEHICLE_LABELS, type VehicleType } from '../../constants';
import type { Order, OrderServiceType, Rider, Merchant, City } from '../../types';

interface WhyNoRiderModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: Order;
  merchantsById: Record<string, Merchant>;
  cities: City[];
}

interface RiderDiagnosticCheck {
  key:
    | 'online'
    | 'locationAge'
    | 'riderService'
    | 'allowedTaxi'
    | 'activeOnlineNotExcluded'
    | 'cityService'
    | 'platformService'
    | 'notBusy'
    | 'vehicleType'
    | 'distance';
  label: string;
  pass: boolean;
  detail: string;
  failReason: string;
}

interface EvaluatedRider {
  rider: Rider;
  normalizedVehicle: VehicleType;
  checks: RiderDiagnosticCheck[];
  firstFailing: RiderDiagnosticCheck | null;
  allPass: boolean;
  distanceKm: number | null;
  locationAgeMs: number | null;
}

const TERMINAL_ORDER_STATUSES = new Set(['Delivered', 'Completed', 'Cancelled', 'Rejected']);

function normalizeVehicleType(raw?: string | null): VehicleType {
  const val = (raw || 'motorcycle').toLowerCase().trim();
  if (val === 'tricycle') return 'tricycle';
  if (val === 'car4' || val === 'car' || val === '4-seater car') return 'car4';
  if (val === 'car8' || val === 'van' || val === '8-seater car') return 'car8';
  return 'motorcycle';
}

function formatAgeDuration(ageMs: number): string {
  const sec = Math.max(0, Math.floor(ageMs / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  if (min < 60) return remSec > 0 ? `${min}m ${remSec}s` : `${min}m`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  if (hr < 24) return remMin > 0 ? `${hr}h ${remMin}m` : `${hr}h`;
  const days = Math.floor(hr / 24);
  return `${days}d`;
}

export const WhyNoRiderModal: React.FC<WhyNoRiderModalProps> = ({
  isOpen,
  onClose,
  order,
  merchantsById,
  cities
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [riders, setRiders] = useState<Rider[]>([]);
  const [activeOrdersByRiderId, setActiveOrdersByRiderId] = useState<
    Record<string, { id: string; orderNumber?: string; status: string }>
  >({});
  const [freshMerchant, setFreshMerchant] = useState<Merchant | null>(null);
  const [freshCity, setFreshCity] = useState<City | null>(null);
  const [globalRadiusKm, setGlobalRadiusKm] = useState<number>(5);
  const [taxiRadiusKm, setTaxiRadiusKm] = useState<number | null>(null);
  const [locationMaxAgeMinutes, setLocationMaxAgeMinutes] = useState<number>(5);
  const [platformServiceOn, setPlatformServiceOn] = useState<boolean>(true);
  const [platformTaxiVehicles, setPlatformTaxiVehicles] = useState<Record<string, boolean>>({
    motorcycle: true,
    tricycle: true,
    car4: true,
    car8: true
  });
  const [evaluatedAtMs, setEvaluatedAtMs] = useState<number>(() => Date.now());

  const [searchQuery, setSearchQuery] = useState('');
  const [resultFilter, setResultFilter] = useState<'all' | 'failing' | 'passing'>('all');

  const serviceType: OrderServiceType = (order.serviceType || 'food') as OrderServiceType;
  const serviceLabel = SERVICE_LABELS[serviceType] || serviceType;
  const isMerchantService =
    serviceType === 'food' || serviceType === 'convenience' || serviceType === 'request_rider';
  const mId = isMerchantService ? order.merchantId || order.sourceMerchantId || '' : '';

  const runDiagnostics = useCallback(async () => {
    if (!isOpen) return;
    try {
      setLoading(true);
      setError(null);

      const [ridersSnap, ordersSnap, dispatchSnap, platformSnap, merchantSnap] = await Promise.all([
        getDocs(collection(db, 'riders')),
        getDocs(collection(db, 'orders')),
        getDoc(doc(db, 'settings', 'dispatch')),
        getDoc(doc(db, 'settings', 'platform')),
        mId ? getDoc(doc(db, 'merchants', mId)) : Promise.resolve(null)
      ]);

      const riderList: Rider[] = [];
      ridersSnap.forEach((d) => {
        const dt = d.data();
        riderList.push({
          id: d.id,
          name: dt.name || 'Driver',
          email: dt.email || '',
          phone: dt.phone || '',
          photoUrl: dt.photoUrl || '',
          riderCode: dt.riderCode || d.id.substring(0, 8),
          status: dt.status || 'active',
          cityId: dt.cityId,
          vehicleType: dt.vehicleType || 'motorcycle',
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

      let gRadius = 5;
      let tRadius: number | null = null;
      let maxAgeMin = 5;
      if (dispatchSnap.exists()) {
        const dData = dispatchSnap.data();
        if (typeof dData.searchRadiusKm === 'number' && dData.searchRadiusKm > 0) {
          gRadius = Number(dData.searchRadiusKm);
        }
        if (typeof dData.taxiSearchRadiusKm === 'number' && dData.taxiSearchRadiusKm > 0) {
          tRadius = Number(dData.taxiSearchRadiusKm);
        }
        const cfgAgeMin = Number(
          dData.riderLocationMaxAgeMinutes ?? dData.locationMaxAgeMinutes ?? 0
        );
        const cfgAgeSec = Number(dData.riderLocationMaxAgeSeconds ?? dData.locationMaxAgeSeconds ?? 0);
        if (cfgAgeMin > 0) {
          maxAgeMin = cfgAgeMin;
        } else if (cfgAgeSec > 0) {
          maxAgeMin = cfgAgeSec / 60;
        }
      }

      let pServiceOn = true;
      let pTaxiVehicles: Record<string, boolean> = {
        motorcycle: true,
        tricycle: true,
        car4: true,
        car8: true
      };
      if (platformSnap.exists()) {
        const pData = platformSnap.data();
        pServiceOn = pData.services?.[serviceType] !== false;
        if (pData.taxiVehicles && typeof pData.taxiVehicles === 'object') {
          pTaxiVehicles = {
            motorcycle: pData.taxiVehicles.motorcycle !== false,
            tricycle: pData.taxiVehicles.tricycle !== false,
            car4: pData.taxiVehicles.car4 !== false,
            car8: pData.taxiVehicles.car8 !== false
          };
        }
      }

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

      const targetCityId = order.cityId || loadedMerchant?.cityId || '';
      let loadedCity: City | null = cities.find((c) => c.id === targetCityId) || null;
      if (!loadedCity && targetCityId) {
        const cSnap = await getDoc(doc(db, 'cities', targetCityId));
        if (cSnap.exists()) {
          loadedCity = { id: cSnap.id, ...cSnap.data() } as City;
        }
      }

      setRiders(riderList);
      setActiveOrdersByRiderId(activeMap);
      setGlobalRadiusKm(gRadius);
      setTaxiRadiusKm(tRadius);
      setLocationMaxAgeMinutes(maxAgeMin);
      setPlatformServiceOn(pServiceOn);
      setPlatformTaxiVehicles(pTaxiVehicles);
      setFreshMerchant(loadedMerchant);
      setFreshCity(loadedCity);
      setEvaluatedAtMs(Date.now());
    } catch (err: any) {
      setError(err?.message || 'Failed to load rider diagnostics.');
    } finally {
      setLoading(false);
    }
  }, [isOpen, order.id, order.cityId, serviceType, mId, merchantsById, cities]);

  useEffect(() => {
    if (isOpen) {
      runDiagnostics();
    }
  }, [isOpen, runDiagnostics]);

  const contextSummary = useMemo(() => {
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

    const specialEnabled =
      isMerchantService &&
      Boolean(merchant?.specialRadius?.enabled && Number(merchant.specialRadius.radiusKm) > 0);
    const usesTaxiRadius = serviceType === 'taxi' && taxiRadiusKm !== null && taxiRadiusKm > 0;
    const effectiveRadiusKm = specialEnabled
      ? Number(merchant!.specialRadius!.radiusKm)
      : usesTaxiRadius
      ? Number(taxiRadiusKm)
      : globalRadiusKm;

    const targetCityId = order.cityId || merchant?.cityId || '';
    const cityObj = freshCity || cities.find((c) => c.id === targetCityId) || null;

    const mergedMerchantsMap =
      merchant && mId ? { ...merchantsById, [mId]: merchant } : merchantsById;
    const locationDisplayName = isMerchantService
      ? resolveOrderMerchantDisplay(order, mergedMerchantsMap, true) ||
        order.pickup?.label ||
        order.pickup?.address ||
        'Merchant'
      : order.pickup?.label || order.pickup?.address || 'Pickup Location';

    const orderVehicle = order.vehicleType ? normalizeVehicleType(order.vehicleType) : null;

    return {
      merchant,
      locationDisplayName,
      pickupLat,
      pickupLng,
      hasPickupCoords,
      pickupPointLabel: isMerchantService ? 'merchant' : 'pickup',
      specialEnabled,
      usesTaxiRadius,
      effectiveRadiusKm,
      radiusKindLabel: specialEnabled ? 'special' : usesTaxiRadius ? 'taxi' : 'global',
      radiusHeaderLabel: specialEnabled
        ? 'Special Radius'
        : usesTaxiRadius
        ? 'Taxi Radius'
        : 'Global Radius',
      targetCityId,
      cityObj,
      orderVehicle
    };
  }, [
    isMerchantService,
    serviceType,
    freshMerchant,
    freshCity,
    mId,
    merchantsById,
    order,
    globalRadiusKm,
    taxiRadiusKm,
    cities
  ]);

  const evaluatedRiders: EvaluatedRider[] = useMemo(() => {
    const maxAgeMs = locationMaxAgeMinutes * 60 * 1000;
    const {
      pickupLat,
      pickupLng,
      hasPickupCoords,
      pickupPointLabel,
      effectiveRadiusKm,
      radiusKindLabel,
      targetCityId,
      cityObj,
      orderVehicle
    } = contextSummary;

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

    const rawOrderVehicleLower = String(order.vehicleType || '').trim().toLowerCase();

    const list: EvaluatedRider[] = riders.map((rider) => {
      const vType = normalizeVehicleType(rider.vehicleType);
      const rawRiderVehicleLower = String(rider.vehicleType || '').trim().toLowerCase();
      const isExcluded = excludedSet.has(rider.id);

      const rLat = Number(rider.location?.lat);
      const rLng = Number(rider.location?.lng);
      const hasRiderCoords =
        Number.isFinite(rLat) && Number.isFinite(rLng) && rLat !== 0 && rLng !== 0;
      const locDate = parseDate(rider.location?.updatedAt);
      const ageMs = locDate ? Math.max(0, evaluatedAtMs - locDate.getTime()) : null;

      // City check (reused across services)
      let cityServicePass = false;
      let cityServiceFailReason = '';
      let cityServiceDetail = '';
      if (!targetCityId || !cityObj) {
        cityServiceFailReason = targetCityId
          ? `Order city "${targetCityId}" not found`
          : isMerchantService
          ? 'Order & merchant have no cityId assigned'
          : 'Order has no cityId assigned';
      } else if (cityObj.status === 'inactive') {
        cityServiceFailReason = `City "${cityObj.name}" is inactive`;
      } else if (cityObj.services?.[serviceType] === false) {
        cityServiceFailReason = `${serviceLabel} is OFF in ${cityObj.name}`;
      } else if (rider.cityId && rider.cityId !== targetCityId) {
        const rCityName = cities.find((c) => c.id === rider.cityId)?.name || rider.cityId;
        cityServiceFailReason = `Rider city (${rCityName}) differs from order city (${cityObj.name})`;
      } else {
        cityServicePass = true;
        cityServiceDetail = `${cityObj.name} (${serviceLabel} ON)`;
      }

      // Distance check (reused across services)
      const distKm =
        hasPickupCoords && hasRiderCoords
          ? haversineKm(rLat, rLng, pickupLat, pickupLng)
          : null;
      const distancePass = distKm !== null && distKm <= effectiveRadiusKm;
      let distanceFailReason = '';
      if (!hasPickupCoords) {
        distanceFailReason = isMerchantService
          ? 'Merchant coordinates are missing (0, 0)'
          : 'Pickup coordinates are missing (0, 0)';
      } else if (!hasRiderCoords || distKm === null) {
        distanceFailReason = 'Cannot measure distance without rider GPS coordinates';
      } else if (distKm > effectiveRadiusKm) {
        distanceFailReason = `${distKm.toFixed(2)} km from ${pickupPointLabel} (exceeds ${effectiveRadiusKm} km ${radiusKindLabel})`;
      }

      let checks: RiderDiagnosticCheck[];

      if (serviceType === 'taxi') {
        // 1. allowedServices contains taxi
        const allowedList = Array.isArray(rider.allowedServices)
          ? rider.allowedServices.map((s) => String(s).trim().toLowerCase())
          : null;
        const allowedHasTaxi = Boolean(allowedList && allowedList.includes('taxi'));
        const allowedFailReason = !allowedList
          ? 'Rider has no allowedServices configured'
          : 'allowedServices does not contain taxi';

        // 2. vehicleType equals order's vehicleType (ignoring capitals)
        const validTaxiVehicles = new Set(['motorcycle', 'tricycle', 'car4', 'car8']);
        const riderVehicleSupported = validTaxiVehicles.has(rawRiderVehicleLower);
        const matchesOrderVehicle = rawOrderVehicleLower
          ? rawRiderVehicleLower === rawOrderVehicleLower
          : riderVehicleSupported;
        const taxiVehiclePass = riderVehicleSupported && matchesOrderVehicle;
        let taxiVehicleFailReason = '';
        if (!riderVehicleSupported) {
          taxiVehicleFailReason = `Driver vehicleType "${rider.vehicleType || 'missing'}" is not a valid taxi vehicle`;
        } else if (!matchesOrderVehicle) {
          taxiVehicleFailReason = `Driver vehicleType "${rider.vehicleType || 'missing'}" does not match order "${order.vehicleType}"`;
        }

        // 3. Rider is active, online, and not excluded
        const isActive = rider.status === 'active';
        const isOnline = Boolean(rider.isOnline);
        const statusOnlineNotExcludedPass = isActive && isOnline && !isExcluded;
        let statusOnlineFailReason = '';
        if (!isActive) {
          statusOnlineFailReason = `Driver is not active (status: ${rider.status || 'unknown'})`;
        } else if (!isOnline) {
          statusOnlineFailReason = 'Driver is offline (isOnline is false)';
        } else if (isExcluded) {
          statusOnlineFailReason = 'Driver is excluded on this order (excludeRiderIds)';
        }

        checks = [
          {
            key: 'allowedTaxi',
            label: 'allowedServices has taxi',
            pass: allowedHasTaxi,
            detail: allowedHasTaxi
              ? `Allowed (${allowedList!.join(', ')})`
              : allowedFailReason,
            failReason: allowedFailReason
          },
          {
            key: 'vehicleType',
            label: 'vehicleType matches order',
            pass: taxiVehiclePass,
            detail: taxiVehiclePass
              ? `${rider.vehicleType || vType}${rawOrderVehicleLower ? ` == ${order.vehicleType}` : ''}`
              : taxiVehicleFailReason,
            failReason: taxiVehicleFailReason
          },
          {
            key: 'activeOnlineNotExcluded',
            label: 'Active, online & not excluded',
            pass: statusOnlineNotExcludedPass,
            detail: statusOnlineNotExcludedPass
              ? 'Active, online & eligible'
              : statusOnlineFailReason,
            failReason: statusOnlineFailReason
          },
          {
            key: 'cityService',
            label: 'City taxi service ON',
            pass: cityServicePass,
            detail: cityServicePass ? cityServiceDetail : cityServiceFailReason,
            failReason: cityServiceFailReason
          },
          {
            key: 'distance',
            label: `Distance to pickup (${effectiveRadiusKm} km)`,
            pass: distancePass,
            detail:
              distKm !== null
                ? `${distKm.toFixed(2)} km / ${effectiveRadiusKm} km`
                : distanceFailReason,
            failReason: distanceFailReason
          }
        ];
      } else {
        // 1. Online & not excluded check
        const onlinePass =
          rider.status === 'active' && Boolean(rider.isOnline) && !isExcluded;
        const onlineFailReason =
          rider.status !== 'active'
            ? `Driver account is ${rider.status || 'inactive'}`
            : !rider.isOnline
            ? 'Driver is offline (isOnline is false)'
            : 'Driver is excluded on this order (excludeRiderIds)';

        // 2. Location age check
        const locationPass =
          hasRiderCoords && locDate !== null && ageMs !== null && ageMs <= maxAgeMs;
        let locationFailReason = '';
        if (!hasRiderCoords) {
          locationFailReason = 'Missing rider GPS coordinates';
        } else if (!locDate || ageMs === null) {
          locationFailReason = 'Missing location timestamp (updatedAt)';
        } else if (ageMs > maxAgeMs) {
          locationFailReason = `Location is stale (${formatAgeDuration(ageMs)} ago; limit ${locationMaxAgeMinutes}m)`;
        }

        // 3. Service on for the rider
        const allowedArr = Array.isArray(rider.allowedServices)
          ? rider.allowedServices.map((s) => String(s).trim().toLowerCase())
          : null;
        const activeArr = Array.isArray(rider.activeServices)
          ? rider.activeServices.map((s) => String(s).trim().toLowerCase())
          : null;
        const allowedHasService = allowedArr ? allowedArr.includes(serviceType) : true;
        const activeHasService = activeArr
          ? activeArr.includes(serviceType)
          : (SERVICES_BY_VEHICLE[vType] || []).includes(serviceType);
        const riderServicePass = allowedHasService && activeHasService;
        const riderServiceFailReason = !allowedHasService
          ? `${serviceLabel} not allowed for rider (allowedServices)`
          : `Rider turned OFF ${serviceLabel} (activeServices)`;

        // 5. Service on for the platform
        const platformPass = platformServiceOn;
        const platformFailReason = `Platform-wide ${serviceLabel} service is OFF (settings/platform)`;

        // 6. Busy with another order
        const activeAssigned = activeOrdersByRiderId[rider.id];
        const hasCurrentOrder = Boolean(rider.currentOrderId && rider.currentOrderId !== order.id);
        const notBusyPass = !activeAssigned && !hasCurrentOrder;
        let notBusyFailReason = '';
        if (activeAssigned) {
          notBusyFailReason = `Busy on order #${activeAssigned.orderNumber || activeAssigned.id.slice(0, 8)} (${activeAssigned.status})`;
        } else if (hasCurrentOrder) {
          notBusyFailReason = `Busy with currentOrderId (${rider.currentOrderId})`;
        }

        // 7. Vehicle type
        const supportsServiceVehicle = (SERVICES_BY_VEHICLE[vType] || []).includes(serviceType);
        const matchesRequestedVehicle = !orderVehicle || orderVehicle === vType;
        const vehiclePass = supportsServiceVehicle && matchesRequestedVehicle;
        const vehicleLabel = VEHICLE_LABELS[vType] || rider.vehicleType || 'Unknown';
        let vehicleFailReason = '';
        if (!supportsServiceVehicle) {
          vehicleFailReason = `${vehicleLabel} cannot serve ${serviceLabel}`;
        } else if (!matchesRequestedVehicle) {
          vehicleFailReason = `${vehicleLabel} does not match requested ${VEHICLE_LABELS[orderVehicle!]}`;
        }

        checks = [
          {
            key: 'online',
            label: 'Online',
            pass: onlinePass,
            detail: onlinePass ? 'Online' : onlineFailReason,
            failReason: onlineFailReason
          },
          {
            key: 'locationAge',
            label: 'Location age',
            pass: locationPass,
            detail:
              hasRiderCoords && ageMs !== null
                ? `${formatAgeDuration(ageMs)} ago (max ${locationMaxAgeMinutes}m)`
                : locationFailReason,
            failReason: locationFailReason
          },
          {
            key: 'riderService',
            label: 'Service (Rider)',
            pass: riderServicePass,
            detail: riderServicePass ? `${serviceLabel} ON` : riderServiceFailReason,
            failReason: riderServiceFailReason
          },
          {
            key: 'cityService',
            label: 'Service (City)',
            pass: cityServicePass,
            detail: cityServicePass ? cityServiceDetail : cityServiceFailReason,
            failReason: cityServiceFailReason
          },
          {
            key: 'platformService',
            label: 'Service (Platform)',
            pass: platformPass,
            detail: platformPass ? `${serviceLabel} ON` : platformFailReason,
            failReason: platformFailReason
          },
          {
            key: 'notBusy',
            label: 'Busy check',
            pass: notBusyPass,
            detail: notBusyPass ? 'Free' : notBusyFailReason,
            failReason: notBusyFailReason
          },
          {
            key: 'vehicleType',
            label: 'Vehicle type',
            pass: vehiclePass,
            detail: vehiclePass ? vehicleLabel : vehicleFailReason,
            failReason: vehicleFailReason
          },
          {
            key: 'distance',
            label: `Distance (${effectiveRadiusKm} km ${radiusKindLabel})`,
            pass: distancePass,
            detail:
              distKm !== null
                ? `${distKm.toFixed(2)} km / ${effectiveRadiusKm} km`
                : distanceFailReason,
            failReason: distanceFailReason
          }
        ];
      }

      const firstFailing = checks.find((c) => !c.pass) || null;

      return {
        rider,
        normalizedVehicle: vType,
        checks,
        firstFailing,
        allPass: !firstFailing,
        distanceKm: distKm,
        locationAgeMs: ageMs
      };
    });

    // Sort: eligible first, then online, then closest distance, then name
    list.sort((a, b) => {
      if (a.allPass !== b.allPass) return a.allPass ? -1 : 1;
      if (a.rider.isOnline !== b.rider.isOnline) return a.rider.isOnline ? -1 : 1;
      const dA = a.distanceKm ?? Number.POSITIVE_INFINITY;
      const dB = b.distanceKm ?? Number.POSITIVE_INFINITY;
      if (dA !== dB) return dA - dB;
      return a.rider.name.localeCompare(b.rider.name);
    });

    return list;
  }, [
    riders,
    activeOrdersByRiderId,
    contextSummary,
    locationMaxAgeMinutes,
    platformServiceOn,
    serviceType,
    serviceLabel,
    isMerchantService,
    evaluatedAtMs,
    order.id,
    order.vehicleType,
    order.excludeRiderIds,
    order.riderRequest,
    cities
  ]);

  const passingCount = useMemo(
    () => evaluatedRiders.filter((r) => r.allPass).length,
    [evaluatedRiders]
  );
  const failingCount = evaluatedRiders.length - passingCount;

  const filteredRiders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return evaluatedRiders.filter((item) => {
      if (resultFilter === 'passing' && !item.allPass) return false;
      if (resultFilter === 'failing' && item.allPass) return false;
      if (q) {
        const nameMatch = (item.rider.name || '').toLowerCase().includes(q);
        const codeMatch = (item.rider.riderCode || '').toLowerCase().includes(q);
        const phoneMatch = (item.rider.phone || '').toLowerCase().includes(q);
        if (!nameMatch && !codeMatch && !phoneMatch) return false;
      }
      return true;
    });
  }, [evaluatedRiders, resultFilter, searchQuery]);

  if (!isOpen) return null;

  const requestedTaxiVehicleDisabled =
    serviceType === 'taxi' &&
    contextSummary.orderVehicle &&
    platformTaxiVehicles[contextSummary.orderVehicle] === false;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-5 bg-black/60 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-5xl max-h-[92vh] bg-white dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-gray-200 dark:border-zinc-800 flex flex-wrap items-start justify-between gap-3 bg-white dark:bg-zinc-950">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-amber-100 text-amber-900 dark:bg-amber-950/70 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                <Zap className="w-3.5 h-3.5 text-amber-600" />
                <span>Why no rider?</span>
              </span>
              <h2 className="text-base sm:text-lg font-extrabold text-gray-900 dark:text-white font-mono">
                {formatOrderNumber(order)}
              </h2>
              <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-gray-100 dark:bg-zinc-800 text-gray-800 dark:text-zinc-200 border border-gray-200 dark:border-zinc-700">
                {serviceLabel}
              </span>
              {order.vehicleType && (
                <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/50 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                  {VEHICLE_LABELS[normalizeVehicleType(order.vehicleType)] || order.vehicleType}
                </span>
              )}
              {order.riderRequest?.status ? (
                <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                  riderRequest: {order.riderRequest.status}
                </span>
              ) : (
                <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                  Status: {order.status}
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 dark:text-zinc-400">
              {isMerchantService ? 'Merchant' : 'Pickup'}:{' '}
              <strong className="text-gray-800 dark:text-zinc-200">
                {contextSummary.locationDisplayName}
              </strong>
              {' · '}
              City: <strong className="text-gray-800 dark:text-zinc-200">{contextSummary.cityObj?.name || contextSummary.targetCityId || 'Missing'}</strong>
              {' · '}
              Radius: <strong className="text-gray-800 dark:text-zinc-200 tabular-nums">{contextSummary.effectiveRadiusKm} km</strong> ({contextSummary.radiusHeaderLabel})
              {!contextSummary.hasPickupCoords && (
                <span className="ml-2 text-red-600 dark:text-red-400 font-bold">
                  · {isMerchantService ? 'Missing merchant coordinates!' : 'Missing pickup coordinates!'}
                </span>
              )}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={runDiagnostics}
              disabled={loading}
              className="px-3 py-1.5 rounded-xl border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-bold text-gray-700 dark:text-zinc-200 hover:bg-gray-50 dark:hover:bg-zinc-800 flex items-center gap-1.5 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-zinc-800"
              aria-label="Close diagnostics"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Summary & Filters Toolbar */}
        <div className="px-4 sm:px-5 py-3 border-b border-gray-100 dark:border-zinc-800 bg-gray-50/70 dark:bg-zinc-900/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => setResultFilter('all')}
              className={`px-3 py-1.5 rounded-lg font-bold tabular-nums transition-colors ${
                resultFilter === 'all'
                  ? 'bg-gray-900 text-white dark:bg-white dark:text-black'
                  : 'bg-white dark:bg-zinc-800 text-gray-700 dark:text-zinc-300 border border-gray-200 dark:border-zinc-700'
              }`}
            >
              All Riders ({evaluatedRiders.length})
            </button>
            <button
              type="button"
              onClick={() => setResultFilter('failing')}
              className={`px-3 py-1.5 rounded-lg font-bold tabular-nums transition-colors ${
                resultFilter === 'failing'
                  ? 'bg-red-600 text-white'
                  : 'bg-white dark:bg-zinc-800 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-900/60'
              }`}
            >
              Failing ({failingCount})
            </button>
            <button
              type="button"
              onClick={() => setResultFilter('passing')}
              className={`px-3 py-1.5 rounded-lg font-bold tabular-nums transition-colors ${
                resultFilter === 'passing'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-white dark:bg-zinc-800 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900/60'
              }`}
            >
              Eligible / All PASS ({passingCount})
            </button>
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

        {/* Platform/City Global Alert if selected service is off */}
        {(!platformServiceOn ||
          requestedTaxiVehicleDisabled ||
          !contextSummary.cityObj ||
          contextSummary.cityObj.status === 'inactive' ||
          contextSummary.cityObj.services?.[serviceType] === false) &&
          !loading && (
            <div className="mx-4 sm:mx-5 mt-3 p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 flex items-start gap-2 text-xs text-red-700 dark:text-red-300">
              <ShieldAlert className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-extrabold">Service-level block detected: </span>
                {!platformServiceOn
                  ? `${serviceLabel} (${serviceType}) is turned OFF platform-wide in settings/platform.`
                  : requestedTaxiVehicleDisabled
                  ? `${VEHICLE_LABELS[contextSummary.orderVehicle!]} is turned OFF under Taxi vehicles in settings/platform.`
                  : !contextSummary.cityObj
                  ? `Order/merchant city (${contextSummary.targetCityId || 'none'}) does not exist.`
                  : contextSummary.cityObj.status === 'inactive'
                  ? `City "${contextSummary.cityObj.name}" is inactive.`
                  : `${serviceLabel} (${serviceType}) is turned OFF in ${contextSummary.cityObj.name}.`}
              </div>
            </div>
          )}

        {/* Riders Checklist Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3">
          {loading ? (
            <div className="py-16 flex flex-col items-center justify-center gap-2 text-xs text-gray-500">
              <Loader2 className="w-6 h-6 animate-spin text-amber-500" />
              <span>Evaluating every rider against driver dispatch checks...</span>
            </div>
          ) : error ? (
            <div className="p-4 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : filteredRiders.length === 0 ? (
            <div className="py-14 text-center text-xs text-gray-400">
              No riders match the current filter.
            </div>
          ) : (
            filteredRiders.map(({ rider, normalizedVehicle, checks, firstFailing, allPass, distanceKm }) => {
              const cityLabel =
                cities.find((c) => c.id === rider.cityId)?.name || rider.cityId || 'No city';

              return (
                <div
                  key={rider.id}
                  className={`rounded-xl border p-3.5 space-y-2.5 transition-colors ${
                    allPass
                      ? 'border-emerald-200 dark:border-emerald-900/70 bg-emerald-50/30 dark:bg-emerald-950/10'
                      : 'border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900'
                  }`}
                >
                  {/* Rider Top Row */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-extrabold text-sm text-gray-900 dark:text-white">
                          {rider.name}
                        </span>
                        <span className="font-mono text-[11px] text-gray-500 dark:text-zinc-400">
                          {rider.riderCode}
                        </span>
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-600 dark:text-zinc-300">
                          <Car className="w-3 h-3 text-gray-400" />
                          {VEHICLE_LABELS[normalizedVehicle] || rider.vehicleType}
                        </span>
                        <span className="inline-flex items-center gap-1 text-[11px] text-gray-500 dark:text-zinc-400">
                          <MapPin className="w-3 h-3 text-gray-400" />
                          {cityLabel}
                        </span>
                        {rider.phone && (
                          <span className="text-[11px] font-mono text-gray-400">{rider.phone}</span>
                        )}
                      </div>

                      {/* First failing reason in RED (or eligible confirmation) */}
                      {firstFailing ? (
                        <p className="mt-1 text-xs font-bold text-red-600 dark:text-red-400 flex items-center gap-1.5">
                          <XCircle className="w-3.5 h-3.5 shrink-0" />
                          <span>First failing reason: {firstFailing.failReason}</span>
                        </p>
                      ) : (
                        <p className="mt-1 text-xs font-bold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                          <span>All checks PASS — rider is eligible for this order</span>
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0 text-xs tabular-nums">
                      {distanceKm !== null && (
                        <span className="px-2 py-0.5 rounded-md bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-zinc-300 font-bold">
                          {distanceKm.toFixed(2)} km
                        </span>
                      )}
                      <span
                        className={`px-2 py-0.5 rounded-md font-extrabold ${
                          allPass
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                            : 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300'
                        }`}
                      >
                        {allPass ? 'PASS' : 'FAIL'}
                      </span>
                    </div>
                  </div>

                  {/* Individual Checks Grid (each explicitly PASS or FAIL) */}
                  <div
                    className={`grid grid-cols-1 sm:grid-cols-2 ${
                      checks.length === 5 ? 'lg:grid-cols-5' : 'lg:grid-cols-4'
                    } gap-2 pt-1`}
                  >
                    {checks.map((chk) => (
                      <div
                        key={chk.key}
                        className={`px-2.5 py-2 rounded-lg border text-[11px] flex items-start justify-between gap-2 ${
                          chk.pass
                            ? 'bg-gray-50/80 dark:bg-zinc-950/50 border-gray-200/80 dark:border-zinc-800'
                            : 'bg-red-50/60 dark:bg-red-950/20 border-red-200 dark:border-red-900/60'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="font-bold text-gray-800 dark:text-zinc-200 truncate">
                            {chk.label}
                          </div>
                          <div
                            className={`text-[10px] truncate tabular-nums ${
                              chk.pass
                                ? 'text-gray-500 dark:text-zinc-400'
                                : 'text-red-600 dark:text-red-400 font-medium'
                            }`}
                            title={chk.detail}
                          >
                            {chk.detail}
                          </div>
                        </div>
                        <span
                          className={`text-[10px] font-extrabold shrink-0 px-1.5 py-0.5 rounded ${
                            chk.pass
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300'
                              : 'bg-red-100 text-red-700 dark:bg-red-950/70 dark:text-red-300'
                          }`}
                        >
                          {chk.pass ? 'PASS' : 'FAIL'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
