import React, { useState, useEffect, useRef, useMemo } from 'react';
import L from 'leaflet';
import {
  db,
  collection,
  getDocs,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  Timestamp
} from '../firebase';
import { useCity } from '../context/CityContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { logAuditEvent } from '../utils/audit';
import type {
  City,
  DeliveryRatesConfig,
  ServiceRates,
  OrderServiceType,
  DeliveryServiceType,
  TaxiVehicleRates,
  RiderPayConfig,
  DispatchSettings,
  DeliveryOptionType
} from '../types';
import {
  VEHICLE_TYPES,
  VEHICLE_LABELS,
  DEFAULT_TAXI_RATES,
  DEFAULT_RIDER_PAY,
  DEFAULT_DISPATCH_SETTINGS,
  type VehicleType
} from '../constants';
import {
  Coins,
  MapPin,
  Plus,
  Edit,
  Power,
  Calculator,
  Save,
  Loader2,
  Check,
  AlertTriangle,
  X,
  Layers,
  Sparkles,
  Car,
  Bike,
  Clock,
  ShieldCheck,
  DollarSign,
  Percent,
  Wallet,
  HelpCircle,
  Navigation,
  Info,
  ArrowUpRight,
  UserCheck
} from 'lucide-react';
import { ConfirmationModal } from '../components/common/ConfirmationModal';
import { CityServicesMatrix } from './ServicesByCity';

const DELIVERY_SERVICES: DeliveryServiceType[] = [
  'food',
  'convenience',
  'parcel',
  'pabili',
  'request_rider'
];

const DEFAULT_SERVICE_RATES: ServiceRates = {
  baseFare: 45,
  includedKm: 2,
  perKm: 12,
  minFee: 45,
  maxFee: 350,
  serviceFeeType: 'flat',
  serviceFee: 10,
  serviceFeeMin: 0,
  serviceFeeMax: 0
};

export const DeliveryRates: React.FC = () => {
  const { cities, refreshCities } = useCity();
  const { adminProfile } = useAuth();
  const { showSuccess, showError } = useToast();

  const [activeCityId, setActiveCityId] = useState<string>('');
  const [loadingRates, setLoadingRates] = useState(false);
  const [ratesConfig, setRatesConfig] = useState<DeliveryRatesConfig | null>(null);

  // Tab between "Customer Delivery Rates", "Taxi Fares", "Rider Pay", and "City Services"
  const [activeMainTab, setActiveMainTab] = useState<'delivery' | 'taxi' | 'riderPay' | 'services'>('delivery');

  // Selected Service sub-tab for Delivery Rates config
  const [activeServiceTab, setActiveServiceTab] = useState<DeliveryServiceType>('food');

  // Selected Vehicle sub-tab for Taxi Fares config
  const [activeVehicleTab, setActiveVehicleTab] = useState<VehicleType>('motorcycle');

  // Dispatch Settings for delivery option previews
  const [dispatchSettings, setDispatchSettings] = useState<DispatchSettings>(DEFAULT_DISPATCH_SETTINGS);

  // Add / Edit City Modal
  const [cityModalOpen, setCityModalOpen] = useState(false);
  const [editingCity, setEditingCity] = useState<City | null>(null);
  const [cityName, setCityName] = useState('');
  const [cityProvince, setCityProvince] = useState('');
  const [cityLat, setCityLat] = useState<number>(9.7392);
  const [cityLng, setCityLng] = useState<number>(118.7353);
  const [cityRadiusKm, setCityRadiusKm] = useState<number>(15);
  const [cityStatus, setCityStatus] = useState<'active' | 'inactive'>('active');
  const [savingCity, setSavingCity] = useState(false);

  // Delivery Fee Simulator States
  const [calcService, setCalcService] = useState<DeliveryServiceType>('food');
  const [calcItemSubtotal, setCalcItemSubtotal] = useState<number>(350);
  const [calcDeliveryDistance, setCalcDeliveryDistance] = useState<number>(4.5);
  const [calcIsNight, setCalcIsNight] = useState<boolean>(false);
  const [calcIsPeak, setCalcIsPeak] = useState<boolean>(false);

  // Taxi Fare Calculator States
  const [calcTaxiVehicle, setCalcTaxiVehicle] = useState<VehicleType>('motorcycle');
  const [calcTaxiDistance, setCalcTaxiDistance] = useState<number>(6.0);
  const [calcExtraStops, setCalcExtraStops] = useState<number>(0);
  const [calcTaxiTimeOfDay, setCalcTaxiTimeOfDay] = useState<'day' | 'peak' | 'night'>('day');

  // Rider Pay Calculator States
  const [calcRiderPayMode, setCalcRiderPayMode] = useState<'single' | 'double' | 'triple'>('single');
  const [calcRiderPickupDist, setCalcRiderPickupDist] = useState<number>(1.2);
  const [calcRiderOrder1Dist, setCalcRiderOrder1Dist] = useState<number>(3.5);
  const [calcRiderOrder2Dist, setCalcRiderOrder2Dist] = useState<number>(4.0);
  const [calcRiderOrder3Dist, setCalcRiderOrder3Dist] = useState<number>(2.8);

  // Confirm save rates modal
  const [confirmSaveRatesModal, setConfirmSaveRatesModal] = useState(false);
  const [savingRates, setSavingRates] = useState(false);

  // Leaflet map refs for City picker
  const cityMapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);

  // Auto-select first city
  useEffect(() => {
    if (cities.length && !activeCityId) {
      setActiveCityId(cities[0].id);
    }
  }, [cities, activeCityId]);

  // Fetch Global Dispatch Settings
  useEffect(() => {
    const fetchDispatchSettings = async () => {
      try {
        const snap = await getDoc(doc(db, 'settings', 'dispatch'));
        if (snap.exists()) {
          setDispatchSettings(snap.data() as DispatchSettings);
        }
      } catch (e) {
        console.error('Error fetching dispatch settings:', e);
      }
    };
    fetchDispatchSettings();
  }, []);

  // Fetch Delivery & Taxi Rates & Rider Pay for active city
  useEffect(() => {
    if (!activeCityId) return;

    const fetchRates = async () => {
      try {
        setLoadingRates(true);
        const rateDocRef = doc(db, 'deliveryRates', activeCityId);
        const snap = await getDoc(rateDocRef);

        if (snap.exists()) {
          const dt = snap.data();
          const svcs = dt.services || {};
          setRatesConfig({
            id: snap.id,
            food: svcs.food || dt.food || { ...DEFAULT_SERVICE_RATES },
            convenience: svcs.convenience || dt.convenience || { ...DEFAULT_SERVICE_RATES },
            parcel: svcs.parcel || dt.parcel || { ...DEFAULT_SERVICE_RATES, baseFare: 40, perKm: 10 },
            pabili: svcs.pabili || dt.pabili || { ...DEFAULT_SERVICE_RATES, baseFare: 60, serviceFee: 20 },
            request_rider: svcs.request_rider || dt.request_rider || { ...DEFAULT_SERVICE_RATES, baseFare: 50 },
            services: {
              food: svcs.food || dt.food || { ...DEFAULT_SERVICE_RATES },
              convenience: svcs.convenience || dt.convenience || { ...DEFAULT_SERVICE_RATES },
              parcel: svcs.parcel || dt.parcel || { ...DEFAULT_SERVICE_RATES, baseFare: 40, perKm: 10 },
              pabili: svcs.pabili || dt.pabili || { ...DEFAULT_SERVICE_RATES, baseFare: 60, serviceFee: 20 },
              request_rider: svcs.request_rider || dt.request_rider || { ...DEFAULT_SERVICE_RATES, baseFare: 50 }
            },
            rideRates: dt.rideRates || { ...DEFAULT_TAXI_RATES },
            riderPay: dt.riderPay || { ...DEFAULT_RIDER_PAY },
            riderCommissionPercent: dt.riderCommissionPercent ?? 80,
            surcharges: dt.surcharges || {
              peak: { enabled: false, multiplier: 1.2 },
              night: { enabled: false, flat: 25 }
            }
          });
        } else {
          // Provide default template including DEFAULT_TAXI_RATES and DEFAULT_RIDER_PAY
          setRatesConfig({
            id: activeCityId,
            food: { ...DEFAULT_SERVICE_RATES },
            convenience: { ...DEFAULT_SERVICE_RATES },
            parcel: { ...DEFAULT_SERVICE_RATES, baseFare: 40, perKm: 10 },
            pabili: { ...DEFAULT_SERVICE_RATES, baseFare: 60, serviceFee: 20 },
            request_rider: { ...DEFAULT_SERVICE_RATES, baseFare: 50 },
            services: {
              food: { ...DEFAULT_SERVICE_RATES },
              convenience: { ...DEFAULT_SERVICE_RATES },
              parcel: { ...DEFAULT_SERVICE_RATES, baseFare: 40, perKm: 10 },
              pabili: { ...DEFAULT_SERVICE_RATES, baseFare: 60, serviceFee: 20 },
              request_rider: { ...DEFAULT_SERVICE_RATES, baseFare: 50 }
            },
            rideRates: { ...DEFAULT_TAXI_RATES },
            riderPay: { ...DEFAULT_RIDER_PAY },
            riderCommissionPercent: 80,
            surcharges: {
              peak: { enabled: false, multiplier: 1.2 },
              night: { enabled: false, flat: 25 }
            }
          });
        }
      } catch (err) {
        showError(err);
      } finally {
        setLoadingRates(false);
      }
    };

    fetchRates();
  }, [activeCityId]);

  // Leaflet map setup for City Center & Radius Picker
  useEffect(() => {
    if (!cityModalOpen || !cityMapRef.current) return;

    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    const lat = cityLat || 9.7392;
    const lng = cityLng || 118.7353;

    const map = L.map(cityMapRef.current, {
      center: [lat, lng],
      zoom: 12,
      zoomControl: false
    });

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap'
    }).addTo(map);

    const marker = L.marker([lat, lng], { draggable: true }).addTo(map);
    const circle = L.circle([lat, lng], {
      radius: (cityRadiusKm || 15) * 1000,
      color: '#FFC107',
      fillColor: '#FFC107',
      fillOpacity: 0.1
    }).addTo(map);

    marker.on('drag', () => {
      const pos = marker.getLatLng();
      circle.setLatLng(pos);
    });

    marker.on('dragend', () => {
      const pos = marker.getLatLng();
      setCityLat(pos.lat);
      setCityLng(pos.lng);
      circle.setLatLng(pos);
    });

    map.on('click', (e) => {
      marker.setLatLng(e.latlng);
      circle.setLatLng(e.latlng);
      setCityLat(e.latlng.lat);
      setCityLng(e.latlng.lng);
    });

    markerRef.current = marker;
    circleRef.current = circle;
    mapInstanceRef.current = map;

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [cityModalOpen]);

  // Sync radius circle on radiusKm change
  useEffect(() => {
    if (circleRef.current) {
      circleRef.current.setRadius((cityRadiusKm || 15) * 1000);
    }
  }, [cityRadiusKm]);

  // Save or Add City
  const handleSaveCity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cityName.trim()) return;
    try {
      setSavingCity(true);
      const cityId = editingCity
        ? editingCity.id
        : cityName.toLowerCase().replace(/[^a-z0-9]/g, '-');

      const cityData = {
        name: cityName.trim(),
        province: cityProvince.trim(),
        status: cityStatus,
        center: { lat: cityLat, lng: cityLng },
        radiusKm: Number(cityRadiusKm) || 15,
        updatedAt: Timestamp.now()
      };

      const cityRef = doc(db, 'cities', cityId);
      await setDoc(cityRef, cityData, { merge: true });

      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        action: editingCity ? 'EDIT_CITY' : 'CREATE_CITY',
        entityType: 'city',
        entityId: cityId,
        details: `${editingCity ? 'Edited' : 'Created'} city ${cityName}`
      });

      showSuccess(`City ${cityName} saved successfully.`);
      setCityModalOpen(false);
      await refreshCities();
      setActiveCityId(cityId);
    } catch (err: any) {
      showError(err);
    } finally {
      setSavingCity(false);
    }
  };

  // Toggle City Enabled / Disabled
  const handleToggleCityStatus = async (city: City) => {
    try {
      const newStatus = city.status === 'active' ? 'inactive' : 'active';
      const cRef = doc(db, 'cities', city.id);
      await updateDoc(cRef, { status: newStatus });

      showSuccess(`City ${city.name} marked as ${newStatus}.`);
      await refreshCities();
    } catch (err: any) {
      showError(err);
    }
  };

  // Update delivery service rate field
  const updateDeliveryRateField = (
    field: keyof ServiceRates,
    value: any
  ) => {
    if (!ratesConfig) return;
    const currentServiceRates = ratesConfig[activeServiceTab] || DEFAULT_SERVICE_RATES;
    const updatedRates: ServiceRates = {
      ...currentServiceRates,
      [field]: field === 'serviceFeeType' ? value : Number(value)
    };

    setRatesConfig({
      ...ratesConfig,
      [activeServiceTab]: updatedRates,
      services: {
        ...(ratesConfig.services || {}),
        [activeServiceTab]: updatedRates
      }
    });
  };

  // Update taxi vehicle rate field
  const updateTaxiRateField = (
    field: keyof TaxiVehicleRates,
    value: any
  ) => {
    if (!ratesConfig) return;
    const currentRideRates = ratesConfig.rideRates || DEFAULT_TAXI_RATES;
    const currentVehicleRates = currentRideRates[activeVehicleTab] || DEFAULT_TAXI_RATES[activeVehicleTab];

    setRatesConfig({
      ...ratesConfig,
      rideRates: {
        ...currentRideRates,
        [activeVehicleTab]: {
          ...currentVehicleRates,
          [field]: field === 'enabled' ? Boolean(value) : field === 'serviceFeeType' ? value : Number(value)
        }
      }
    });
  };

  // Update Rider Pay Single or Pickup field
  const updateRiderPayField = (
    tier: 'single' | 'pickup',
    field: string,
    value: any
  ) => {
    if (!ratesConfig) return;
    const currentPay = ratesConfig.riderPay || DEFAULT_RIDER_PAY;
    setRatesConfig({
      ...ratesConfig,
      riderPay: {
        ...currentPay,
        [tier]: {
          ...currentPay[tier],
          [field]: Math.max(0, Number(value))
        }
      }
    });
  };

  // Update Rider Pay Double sub-tier field (first, second, third)
  const updateRiderPayDoubleField = (
    subtier: 'first' | 'second' | 'third',
    field: string,
    value: any
  ) => {
    if (!ratesConfig) return;
    const currentPay = ratesConfig.riderPay || DEFAULT_RIDER_PAY;
    setRatesConfig({
      ...ratesConfig,
      riderPay: {
        ...currentPay,
        double: {
          ...currentPay.double,
          [subtier]: {
            ...currentPay.double[subtier],
            [field]: Math.max(0, Number(value))
          }
        }
      }
    });
  };

  // Save Rates to Firestore
  const handleSaveRates = async () => {
    if (!ratesConfig || !activeCityId) return;
    try {
      setSavingRates(true);
      const rateRef = doc(db, 'deliveryRates', activeCityId);
      const payload = {
        ...ratesConfig,
        services: {
          food: ratesConfig.food,
          convenience: ratesConfig.convenience,
          parcel: ratesConfig.parcel,
          pabili: ratesConfig.pabili,
          request_rider: ratesConfig.request_rider
        },
        food: ratesConfig.food,
        convenience: ratesConfig.convenience,
        parcel: ratesConfig.parcel,
        pabili: ratesConfig.pabili,
        request_rider: ratesConfig.request_rider,
        rideRates: ratesConfig.rideRates,
        riderPay: ratesConfig.riderPay || DEFAULT_RIDER_PAY,
        updatedAt: Timestamp.now()
      };

      await setDoc(rateRef, payload, { merge: true });

      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        action: 'UPDATE_DELIVERY_AND_TAXI_RATES',
        entityType: 'deliveryRates',
        entityId: activeCityId,
        details: `Saved rates & fares (services, rideRates & riderPay) for city ${activeCityId}`
      });

      showSuccess('Rates & Fares schedule saved successfully.');
      setConfirmSaveRatesModal(false);
    } catch (err: any) {
      showError(err);
    } finally {
      setSavingRates(false);
    }
  };

  // Rider Pay Memo Calculation
  const calculatedRiderPay = useMemo(() => {
    const payConfig = ratesConfig?.riderPay || DEFAULT_RIDER_PAY;
    const pickupFare = payConfig.pickup.minFare + Math.max(0, calcRiderPickupDist - payConfig.pickup.freeKm) * payConfig.pickup.perKmExtra;

    let booking1Fare = 0;
    let booking2Fare = 0;
    let booking3Fare = 0;

    if (calcRiderPayMode === 'single') {
      booking1Fare = payConfig.single.minFare + Math.max(0, calcRiderOrder1Dist - payConfig.single.includedKm) * payConfig.single.perKmExtra;
    } else {
      // First booking uses double.first
      booking1Fare = payConfig.double.first.minFare + Math.max(0, calcRiderOrder1Dist - payConfig.double.first.includedKm) * payConfig.double.first.perKmExtra;
      // Second booking uses double.second
      booking2Fare = payConfig.double.second.minFare + Math.max(0, calcRiderOrder2Dist - payConfig.double.second.includedKm) * payConfig.double.second.perKmExtra;
      if (calcRiderPayMode === 'triple') {
        // Third booking uses double.third
        booking3Fare = payConfig.double.third.minFare + Math.max(0, calcRiderOrder3Dist - payConfig.double.third.includedKm) * payConfig.double.third.perKmExtra;
      }
    }

    const totalBookings = booking1Fare + booking2Fare + booking3Fare;
    const totalRiderPay = pickupFare + totalBookings;
    const orderCount = calcRiderPayMode === 'single' ? 1 : calcRiderPayMode === 'double' ? 2 : 3;
    const avgPerBooking = totalRiderPay / orderCount;

    return {
      pickupFare,
      booking1Fare,
      booking2Fare,
      booking3Fare,
      totalBookings,
      totalRiderPay,
      orderCount,
      avgPerBooking,
      payConfig
    };
  }, [ratesConfig, calcRiderPayMode, calcRiderPickupDist, calcRiderOrder1Dist, calcRiderOrder2Dist, calcRiderOrder3Dist]);

  // 1. Delivery Fee Simulator Calculation (Percent applies to items subtotal + delivery fee)
  const calculatedDeliveryFee = useMemo(() => {
    if (!ratesConfig) {
      return {
        baseFare: 0,
        distanceFee: 0,
        serviceFee: 0,
        feeType: 'flat',
        feeBreakdownNote: '',
        surcharges: 0,
        totalDeliveryFee: 0,
        itemsSubtotal: calcItemSubtotal,
        grandTotal: 0,
        driverCut: 0,
        platformMargin: 0
      };
    }
    const rates = ratesConfig[calcService] || DEFAULT_SERVICE_RATES;

    const baseFare = Number(rates.baseFare) || 0;
    const includedKm = Number(rates.includedKm) || 0;
    const perKm = Number(rates.perKm) || 0;
    const extraKm = Math.max(0, calcDeliveryDistance - includedKm);
    const distanceFee = extraKm * perKm;
    let deliverySubtotal = baseFare + distanceFee;

    if (rates.minFee && deliverySubtotal < rates.minFee) deliverySubtotal = rates.minFee;
    if (rates.maxFee && deliverySubtotal > rates.maxFee) deliverySubtotal = rates.maxFee;

    let surchargeTotal = 0;
    if (calcIsPeak && ratesConfig.surcharges?.peak?.enabled) {
      const mult = ratesConfig.surcharges.peak.multiplier || 1.2;
      surchargeTotal += deliverySubtotal * (mult - 1);
    }
    if (calcIsNight && ratesConfig.surcharges?.night?.enabled) {
      surchargeTotal += ratesConfig.surcharges.night.flat || 25;
    }

    const totalDeliveryFee = deliverySubtotal + surchargeTotal;

    // Service Fee calculation: Flat or Percent (applies to items subtotal + delivery fee)
    let calculatedServiceFee = 0;
    let feeBreakdownNote = '';
    const feeType = rates.serviceFeeType || 'flat';
    const rawFeeVal = Number(rates.serviceFee) || 0;

    if (feeType === 'percent') {
      const baseForPercent = calcItemSubtotal + totalDeliveryFee;
      calculatedServiceFee = (baseForPercent * rawFeeVal) / 100;
      feeBreakdownNote = `${rawFeeVal}% of (₱${calcItemSubtotal.toFixed(2)} items + ₱${totalDeliveryFee.toFixed(2)} delivery = ₱${baseForPercent.toFixed(2)})`;
      if (rates.serviceFeeMin && calculatedServiceFee < rates.serviceFeeMin) {
        calculatedServiceFee = rates.serviceFeeMin;
        feeBreakdownNote += ` (bounded by min ₱${rates.serviceFeeMin})`;
      }
      if (rates.serviceFeeMax && rates.serviceFeeMax > 0 && calculatedServiceFee > rates.serviceFeeMax) {
        calculatedServiceFee = rates.serviceFeeMax;
        feeBreakdownNote += ` (capped by max ₱${rates.serviceFeeMax})`;
      }
    } else {
      calculatedServiceFee = rawFeeVal;
      feeBreakdownNote = `Flat ₱${rawFeeVal.toFixed(2)}`;
    }

    const grandTotal = calcItemSubtotal + totalDeliveryFee + calculatedServiceFee;
    const driverCommission = ratesConfig.riderCommissionPercent ?? 80;
    const driverCut = (totalDeliveryFee * driverCommission) / 100;
    const platformMargin = (totalDeliveryFee - driverCut) + calculatedServiceFee;

    return {
      baseFare,
      distanceFee,
      serviceFee: calculatedServiceFee,
      feeType,
      feeBreakdownNote,
      surcharges: surchargeTotal,
      totalDeliveryFee,
      itemsSubtotal: calcItemSubtotal,
      grandTotal,
      driverCut,
      platformMargin
    };
  }, [ratesConfig, calcService, calcDeliveryDistance, calcIsPeak, calcIsNight, calcItemSubtotal]);

  // 2. Taxi Fare Calculator Calculation (Percent applies to ride fare + stop fee)
  const calculatedTaxiFare = useMemo(() => {
    const defaultV = DEFAULT_TAXI_RATES[calcTaxiVehicle];
    const vRates: TaxiVehicleRates = ratesConfig?.rideRates?.[calcTaxiVehicle] || defaultV;

    const baseFare = Number(vRates.baseFare) || 0;
    const includedKm = Number(vRates.includedKm) || 0;
    const perKm = Number(vRates.perKm) || 0;
    const minFare = Number(vRates.minFare) || 0;
    const perStopFee = Number(vRates.perStopFee) || 0;
    const commissionPercent = Number(vRates.commissionPercent) ?? 15;

    // Distance calculation
    const extraKm = Math.max(0, calcTaxiDistance - includedKm);
    const distanceFare = baseFare + (extraKm * perKm);

    // Apply minimum fare
    let rideFare = Math.max(minFare, distanceFare);

    // Time of day multiplier simulation
    if (calcTaxiTimeOfDay === 'peak') {
      rideFare = rideFare * 1.2;
    } else if (calcTaxiTimeOfDay === 'night') {
      rideFare = rideFare + 30; // night diff
    }

    const stopFee = Math.max(0, calcExtraStops) * perStopFee;
    const rideSubtotal = rideFare + stopFee;

    // Service Fee: Flat or Percent
    let calculatedServiceFee = 0;
    let feeBreakdownNote = '';
    const feeType = vRates.serviceFeeType || 'flat';
    const rawFeeVal = Number(vRates.serviceFee) || 0;

    if (feeType === 'percent') {
      calculatedServiceFee = (rideSubtotal * rawFeeVal) / 100;
      feeBreakdownNote = `${rawFeeVal}% of ride fare (₱${rideSubtotal.toFixed(2)})`;
      if (vRates.serviceFeeMin && calculatedServiceFee < vRates.serviceFeeMin) {
        calculatedServiceFee = vRates.serviceFeeMin;
        feeBreakdownNote += ` (min ₱${vRates.serviceFeeMin})`;
      }
      if (vRates.serviceFeeMax && vRates.serviceFeeMax > 0 && calculatedServiceFee > vRates.serviceFeeMax) {
        calculatedServiceFee = vRates.serviceFeeMax;
        feeBreakdownNote += ` (max ₱${vRates.serviceFeeMax})`;
      }
    } else {
      calculatedServiceFee = rawFeeVal;
      feeBreakdownNote = `Flat ₱${rawFeeVal.toFixed(2)}`;
    }

    const total = rideSubtotal + calculatedServiceFee;

    // Platform margin & Driver Net
    const platformRideCommission = (rideFare * (commissionPercent / 100));
    const platformMargin = platformRideCommission + calculatedServiceFee;
    const driverNet = total - platformMargin;

    return {
      rideFare,
      stopFee,
      serviceFee: calculatedServiceFee,
      feeType,
      feeBreakdownNote,
      total,
      driverNet,
      platformMargin,
      commissionPercent
    };
  }, [ratesConfig, calcTaxiVehicle, calcTaxiDistance, calcExtraStops, calcTaxiTimeOfDay]);

  // 3. Delivery Option Previews (settings/dispatch adjustment preview on base fee)
  const deliveryOptionPreviews = useMemo(() => {
    const dSettings = dispatchSettings || DEFAULT_DISPATCH_SETTINGS;
    const baseFee = calculatedDeliveryFee.totalDeliveryFee;

    const calcFee = (opt: typeof dSettings.options.priority) => {
      if (opt.feeAdjustType === 'percent') {
        const adjusted = baseFee * (1 + (Number(opt.feeAdjustValue) || 0) / 100);
        return Math.max(0, Math.round(adjusted));
      }
      return Math.max(0, baseFee + (Number(opt.feeAdjustValue) || 0));
    };

    return {
      priority: {
        config: dSettings.options.priority,
        fee: calcFee(dSettings.options.priority),
        diff: dSettings.options.priority.feeAdjustValue
      },
      standard: {
        config: dSettings.options.standard,
        fee: calcFee(dSettings.options.standard),
        diff: dSettings.options.standard.feeAdjustValue
      },
      saver: {
        config: dSettings.options.saver,
        fee: calcFee(dSettings.options.saver),
        diff: dSettings.options.saver.feeAdjustValue
      }
    };
  }, [dispatchSettings, calculatedDeliveryFee]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">
            Rates & Fares
          </h1>
          <p className="text-sm text-gray-500 dark:text-zinc-400 mt-0.5">
            Configure delivery fees, taxi fares per vehicle, driver commissions, and interactive fare calculators by city.
          </p>
        </div>

        <button
          onClick={() => {
            setEditingCity(null);
            setCityName('');
            setCityProvince('');
            setCityLat(9.7392);
            setCityLng(118.7353);
            setCityRadiusKm(15);
            setCityStatus('active');
            setCityModalOpen(true);
          }}
          className="delivio-btn-yellow px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" /> Add Coverage City
        </button>
      </div>

      {/* Cities Selector & Status Bar */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-4 shadow-xs">
        <span className="text-xs font-bold uppercase tracking-wider text-gray-400 block mb-3">
          Configured Operational Cities
        </span>

        <div className="flex flex-wrap gap-2.5">
          {cities.map((city) => {
            const isSelected = activeCityId === city.id;
            return (
              <div
                key={city.id}
                onClick={() => setActiveCityId(city.id)}
                className={`p-3 rounded-xl border flex items-center gap-3 cursor-pointer transition-all ${
                  isSelected
                    ? 'border-amber-400 bg-amber-50/70 dark:bg-amber-950/30 text-amber-950 dark:text-amber-200 shadow-xs'
                    : 'border-gray-200 dark:border-zinc-800 hover:bg-gray-50 dark:hover:bg-zinc-800 text-gray-800 dark:text-zinc-300'
                }`}
              >
                <MapPin className="w-4 h-4 text-amber-500" />
                <div>
                  <div className="font-bold text-xs">{city.name}</div>
                  <div className="text-[10px] text-gray-400">
                    Radius: {city.radiusKm || 15} km • {city.status}
                  </div>
                </div>

                <div className="flex items-center gap-1 ml-2" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => {
                      setEditingCity(city);
                      setCityName(city.name);
                      setCityProvince(city.province || '');
                      setCityLat(city.center?.lat || 9.7392);
                      setCityLng(city.center?.lng || 118.7353);
                      setCityRadiusKm(city.radiusKm || 15);
                      setCityStatus(city.status);
                      setCityModalOpen(true);
                    }}
                    className="p-1 text-gray-400 hover:text-amber-600 rounded-md"
                    title="Edit city center & boundary"
                  >
                    <Edit className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleToggleCityStatus(city)}
                    className={`p-1 rounded-md ${
                      city.status === 'active'
                        ? 'text-emerald-600 hover:bg-emerald-50'
                        : 'text-gray-400 hover:bg-gray-100'
                    }`}
                    title={city.status === 'active' ? 'Active' : 'Disabled'}
                  >
                    <Power className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main Mode Tabs: Customer Delivery Rates vs. Rider Pay vs. Taxi Fares */}
      <div className="flex flex-wrap gap-2.5 border-b border-gray-200 dark:border-zinc-800 pb-2">
        <button
          onClick={() => setActiveMainTab('delivery')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-extrabold transition-all ${
            activeMainTab === 'delivery'
              ? 'bg-amber-400 text-black shadow-xs'
              : 'bg-white dark:bg-zinc-900 text-gray-600 dark:text-zinc-400 hover:bg-gray-100 border border-gray-200 dark:border-zinc-800'
          }`}
        >
          <Bike className="w-4 h-4" />
          <span>Customer Delivery Rates</span>
        </button>

        <button
          onClick={() => setActiveMainTab('riderPay')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-extrabold transition-all ${
            activeMainTab === 'riderPay'
              ? 'bg-amber-400 text-black shadow-xs'
              : 'bg-white dark:bg-zinc-900 text-gray-600 dark:text-zinc-400 hover:bg-gray-100 border border-gray-200 dark:border-zinc-800'
          }`}
        >
          <Wallet className="w-4 h-4" />
          <span>Rider Pay</span>
        </button>

        <button
          onClick={() => setActiveMainTab('taxi')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-extrabold transition-all ${
            activeMainTab === 'taxi'
              ? 'bg-amber-400 text-black shadow-xs'
              : 'bg-white dark:bg-zinc-900 text-gray-600 dark:text-zinc-400 hover:bg-gray-100 border border-gray-200 dark:border-zinc-800'
          }`}
        >
          <Car className="w-4 h-4" />
          <span>Delivio Taxi Fares (Per Vehicle)</span>
        </button>

        <button
          onClick={() => setActiveMainTab('services')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-extrabold transition-all ${
            activeMainTab === 'services'
              ? 'bg-amber-400 text-black shadow-xs'
              : 'bg-white dark:bg-zinc-900 text-gray-600 dark:text-zinc-400 hover:bg-gray-100 border border-gray-200 dark:border-zinc-800'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>City Services</span>
        </button>
      </div>

      {/* 1. CUSTOMER DELIVERY RATES SECTION */}
      {ratesConfig && activeMainTab === 'delivery' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Delivery Rates Form */}
          <div className="lg:col-span-2 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-5 shadow-xs space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-100 dark:border-zinc-800 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-extrabold text-base text-gray-900 dark:text-white">
                    Customer Delivery Rates for {cities.find((c) => c.id === activeCityId)?.name || activeCityId}
                  </h3>
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300">
                    Customer Fee
                  </span>
                </div>
                <p className="text-xs text-gray-500">
                  Customer-facing delivery pricing schedule (base fare, distance per km, and platform fees). For courier compensation, see the <strong>Rider Pay</strong> tab.
                </p>
              </div>

              <button
                onClick={() => setConfirmSaveRatesModal(true)}
                className="delivio-btn-yellow px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs self-start sm:self-auto"
              >
                <Save className="w-4 h-4" /> Save Rate Schedule
              </button>
            </div>

            {/* Service sub-tabs */}
            <div className="flex gap-2 overflow-x-auto pb-1">
              {DELIVERY_SERVICES.map((srv) => (
                <button
                  key={srv}
                  onClick={() => setActiveServiceTab(srv)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold capitalize transition-all ${
                    activeServiceTab === srv
                      ? 'bg-amber-400 text-black shadow-xs font-black'
                      : 'bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-400 hover:bg-gray-200'
                  }`}
                >
                  {srv.replace('_', ' ')}
                </button>
              ))}
            </div>

            {/* Rate Inputs */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Base Fare (₱)
                </label>
                <input
                  type="number"
                  min="0"
                  value={ratesConfig[activeServiceTab]?.baseFare || 0}
                  onChange={(e) => updateDeliveryRateField('baseFare', Number(e.target.value))}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Included Distance (km)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={ratesConfig[activeServiceTab]?.includedKm || 0}
                  onChange={(e) => updateDeliveryRateField('includedKm', Number(e.target.value))}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Per Additional Km (₱)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={ratesConfig[activeServiceTab]?.perKm || 0}
                  onChange={(e) => updateDeliveryRateField('perKm', Number(e.target.value))}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Minimum Fee (₱)
                </label>
                <input
                  type="number"
                  min="0"
                  value={ratesConfig[activeServiceTab]?.minFee || 0}
                  onChange={(e) => updateDeliveryRateField('minFee', Number(e.target.value))}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Maximum Fee (₱)
                </label>
                <input
                  type="number"
                  min="0"
                  value={ratesConfig[activeServiceTab]?.maxFee || 0}
                  onChange={(e) => updateDeliveryRateField('maxFee', Number(e.target.value))}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold text-gray-900 dark:text-white"
                />
              </div>

              {/* Platform Service Fee Configuration */}
              <div className="sm:col-span-2 p-3.5 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/50 dark:bg-amber-950/20 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-amber-900 dark:text-amber-300">
                      Platform Service Fee
                    </label>
                    <p className="text-[11px] text-amber-700/80 dark:text-amber-400/80">
                      Charged to customer. If percent, applies to items subtotal + delivery fee.
                    </p>
                  </div>
                  <div className="inline-flex rounded-lg border border-amber-300 dark:border-amber-800 p-0.5 bg-white dark:bg-zinc-900">
                    <button
                      type="button"
                      onClick={() => updateDeliveryRateField('serviceFeeType', 'flat')}
                      className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${
                        (ratesConfig[activeServiceTab]?.serviceFeeType || 'flat') === 'flat'
                          ? 'bg-amber-500 text-white shadow-xs'
                          : 'text-gray-600 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white'
                      }`}
                    >
                      Flat ₱
                    </button>
                    <button
                      type="button"
                      onClick={() => updateDeliveryRateField('serviceFeeType', 'percent')}
                      className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${
                        ratesConfig[activeServiceTab]?.serviceFeeType === 'percent'
                          ? 'bg-amber-500 text-white shadow-xs'
                          : 'text-gray-600 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white'
                      }`}
                    >
                      Percent %
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                      {ratesConfig[activeServiceTab]?.serviceFeeType === 'percent' ? 'Fee Rate (%)' : 'Flat Fee (₱)'}
                    </label>
                    <input
                      type="number"
                      min="0"
                      step={ratesConfig[activeServiceTab]?.serviceFeeType === 'percent' ? '0.1' : '1'}
                      value={ratesConfig[activeServiceTab]?.serviceFee || 0}
                      onChange={(e) => updateDeliveryRateField('serviceFee', Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold text-amber-600"
                    />
                  </div>

                  {ratesConfig[activeServiceTab]?.serviceFeeType === 'percent' && (
                    <>
                      <div>
                        <label className="block text-[11px] font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                          Min Fee Cap (₱) <span className="text-gray-400 lowercase">(optional)</span>
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={ratesConfig[activeServiceTab]?.serviceFeeMin || 0}
                          onChange={(e) => updateDeliveryRateField('serviceFeeMin', Number(e.target.value))}
                          placeholder="e.g. 5"
                          className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold text-gray-900 dark:text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                          Max Fee Cap (₱) <span className="text-gray-400 lowercase">(0 = no cap)</span>
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={ratesConfig[activeServiceTab]?.serviceFeeMax || 0}
                          onChange={(e) => updateDeliveryRateField('serviceFeeMax', Number(e.target.value))}
                          placeholder="0"
                          className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold text-gray-900 dark:text-white"
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Driver Commission & Surcharges Section */}
            <div className="pt-4 border-t border-gray-100 dark:border-zinc-800 space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-zinc-300 mb-1">
                  Driver Commission Share (% of delivery fee paid to driver)
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="50"
                    max="95"
                    value={ratesConfig.riderCommissionPercent ?? 80}
                    onChange={(e) =>
                      setRatesConfig({
                        ...ratesConfig,
                        riderCommissionPercent: Number(e.target.value)
                      })
                    }
                    className="flex-1 accent-amber-500"
                  />
                  <span className="font-black text-sm text-gray-900 dark:text-white w-12 text-right">
                    {ratesConfig.riderCommissionPercent ?? 80}%
                  </span>
                </div>
              </div>

              {/* Surcharges */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <div className="p-4 rounded-xl border border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-850 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-gray-900 dark:text-white">
                      Peak Hours Multiplier
                    </span>
                    <input
                      type="checkbox"
                      checked={Boolean(ratesConfig.surcharges?.peak?.enabled)}
                      onChange={(e) =>
                        setRatesConfig({
                          ...ratesConfig,
                          surcharges: {
                            ...ratesConfig.surcharges,
                            peak: {
                              ...ratesConfig.surcharges.peak,
                              enabled: e.target.checked
                            }
                          }
                        })
                      }
                      className="w-4 h-4 rounded-sm text-amber-500"
                    />
                  </div>
                  <input
                    type="number"
                    step="0.05"
                    min="1.0"
                    max="2.5"
                    value={ratesConfig.surcharges?.peak?.multiplier || 1.2}
                    onChange={(e) =>
                      setRatesConfig({
                        ...ratesConfig,
                        surcharges: {
                          ...ratesConfig.surcharges,
                          peak: {
                            ...ratesConfig.surcharges.peak,
                            multiplier: Number(e.target.value)
                          }
                        }
                      })
                    }
                    disabled={!ratesConfig.surcharges?.peak?.enabled}
                    className="w-full px-3 py-1.5 rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold disabled:opacity-40"
                  />
                </div>

                <div className="p-4 rounded-xl border border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-850 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-gray-900 dark:text-white">
                      Night Time Flat Surcharge (₱)
                    </span>
                    <input
                      type="checkbox"
                      checked={Boolean(ratesConfig.surcharges?.night?.enabled)}
                      onChange={(e) =>
                        setRatesConfig({
                          ...ratesConfig,
                          surcharges: {
                            ...ratesConfig.surcharges,
                            night: {
                              ...ratesConfig.surcharges.night,
                              enabled: e.target.checked
                            }
                          }
                        })
                      }
                      className="w-4 h-4 rounded-sm text-amber-500"
                    />
                  </div>
                  <input
                    type="number"
                    min="0"
                    value={ratesConfig.surcharges?.night?.flat || 25}
                    onChange={(e) =>
                      setRatesConfig({
                        ...ratesConfig,
                        surcharges: {
                          ...ratesConfig.surcharges,
                          night: {
                            ...ratesConfig.surcharges.night,
                            flat: Number(e.target.value)
                          }
                        }
                      })
                    }
                    disabled={!ratesConfig.surcharges?.night?.enabled}
                    className="w-full px-3 py-1.5 rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold disabled:opacity-40"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Delivery Fee Simulator */}
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-5 shadow-xs space-y-5">
            <div className="flex items-center gap-2">
              <Calculator className="w-5 h-5 text-amber-500" />
              <h3 className="font-bold text-base text-gray-900 dark:text-white">
                Delivery Fee Simulator
              </h3>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block uppercase font-semibold text-gray-500 mb-1">Service</label>
                <select
                  value={calcService}
                  onChange={(e) => setCalcService(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white capitalize"
                >
                  {DELIVERY_SERVICES.map((s) => (
                    <option key={s} value={s}>
                      {s.replace('_', ' ')}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block uppercase font-semibold text-gray-500 mb-1">
                  Cart Items Subtotal (₱)
                </label>
                <input
                  type="number"
                  min="0"
                  step="10"
                  value={calcItemSubtotal}
                  onChange={(e) => setCalcItemSubtotal(Math.max(0, Number(e.target.value)))}
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block uppercase font-semibold text-gray-500 mb-1">
                  Trip Distance ({calcDeliveryDistance} km)
                </label>
                <input
                  type="range"
                  min="0.5"
                  max="30"
                  step="0.5"
                  value={calcDeliveryDistance}
                  onChange={(e) => setCalcDeliveryDistance(Number(e.target.value))}
                  className="w-full accent-amber-500"
                />
              </div>

              <div className="space-y-1.5 pt-1">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={calcIsPeak}
                    onChange={(e) => setCalcIsPeak(e.target.checked)}
                    className="w-4 h-4 rounded-sm text-amber-500"
                  />
                  <span className="text-xs font-semibold text-gray-700 dark:text-zinc-300">
                    Simulate Peak Demand Surge
                  </span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={calcIsNight}
                    onChange={(e) => setCalcIsNight(e.target.checked)}
                    className="w-4 h-4 rounded-sm text-amber-500"
                  />
                  <span className="text-xs font-semibold text-gray-700 dark:text-zinc-300">
                    Simulate Late Night Delivery (10PM - 5AM)
                  </span>
                </label>
              </div>
            </div>

            {/* Calculated Breakdown Card */}
            <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 space-y-2 text-xs">
              <div className="flex justify-between text-gray-700 dark:text-zinc-300">
                <span>Items Subtotal:</span>
                <span className="font-semibold">₱{calculatedDeliveryFee.itemsSubtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-amber-900 dark:text-amber-300">
                <span>Base Fare:</span>
                <span>₱{calculatedDeliveryFee.baseFare.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-amber-900 dark:text-amber-300">
                <span>Distance Fee:</span>
                <span>₱{calculatedDeliveryFee.distanceFee.toFixed(2)}</span>
              </div>
              {calculatedDeliveryFee.surcharges > 0 && (
                <div className="flex justify-between text-amber-900 dark:text-amber-300 font-bold">
                  <span>Surcharges:</span>
                  <span>+₱{calculatedDeliveryFee.surcharges.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-amber-900 dark:text-amber-300 font-semibold pt-1 border-t border-amber-200/60 dark:border-amber-900/40">
                <span>Delivery Fee Subtotal:</span>
                <span>₱{calculatedDeliveryFee.totalDeliveryFee.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-amber-900 dark:text-amber-300">
                <span>
                  Platform Service Fee{' '}
                  <span className="text-[10px] text-amber-700 dark:text-amber-400 block sm:inline">
                    ({calculatedDeliveryFee.feeBreakdownNote})
                  </span>
                </span>
                <span className="font-bold">₱{calculatedDeliveryFee.serviceFee.toFixed(2)}</span>
              </div>

              <div className="pt-2 border-t border-amber-200 dark:border-amber-900 flex justify-between font-black text-sm text-gray-900 dark:text-white">
                <span>Total Customer Pays:</span>
                <span className="text-amber-600">₱{calculatedDeliveryFee.grandTotal.toFixed(2)}</span>
              </div>

              <div className="pt-2 border-t border-amber-200 dark:border-amber-900 space-y-1">
                <div className="flex justify-between font-bold text-emerald-600 text-xs">
                  <span>Driver Payout ({ratesConfig.riderCommissionPercent}% of delivery):</span>
                  <span>₱{calculatedDeliveryFee.driverCut.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-[11px] text-gray-600 dark:text-zinc-400">
                  <span>Platform Margin (retained delivery + fee):</span>
                  <span className="font-bold text-gray-900 dark:text-white">₱{calculatedDeliveryFee.platformMargin.toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* Delivery Option Price Previews (Priority / Standard / Saver) */}
            <div className="p-4 rounded-2xl bg-white dark:bg-zinc-850 border border-gray-200 dark:border-zinc-700/80 space-y-3 text-xs">
              <div className="flex items-center justify-between pb-2 border-b border-gray-100 dark:border-zinc-700">
                <span className="font-extrabold text-[11px] uppercase tracking-wider text-gray-700 dark:text-zinc-300 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                  Option Price Preview (settings/dispatch)
                </span>
                <span className="text-[10px] text-gray-400 font-semibold">
                  Base Fee: ₱{calculatedDeliveryFee.totalDeliveryFee.toFixed(2)}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-300 dark:border-amber-800">
                  <span className="block font-black text-xs text-amber-700 dark:text-amber-400">Priority</span>
                  <span className="block font-black text-sm text-gray-900 dark:text-white mt-0.5">
                    ₱{deliveryOptionPreviews.priority.fee.toFixed(2)}
                  </span>
                  <span className="block text-[9px] font-bold text-amber-600 mt-0.5">
                    {deliveryOptionPreviews.priority.diff >= 0 ? `+₱${deliveryOptionPreviews.priority.diff}` : `-₱${Math.abs(deliveryOptionPreviews.priority.diff)}`}
                  </span>
                  <span className="block text-[8px] text-gray-400 mt-1">Direct (0m hold)</span>
                </div>

                <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-300 dark:border-blue-800">
                  <span className="block font-black text-xs text-blue-700 dark:text-blue-400">Standard</span>
                  <span className="block font-black text-sm text-gray-900 dark:text-white mt-0.5">
                    ₱{deliveryOptionPreviews.standard.fee.toFixed(2)}
                  </span>
                  <span className="block text-[9px] font-bold text-blue-600 mt-0.5">
                    {deliveryOptionPreviews.standard.diff === 0 ? 'Base' : `${deliveryOptionPreviews.standard.diff >= 0 ? '+' : ''}₱${deliveryOptionPreviews.standard.diff}`}
                  </span>
                  <span className="block text-[8px] text-gray-400 mt-1">Batch 2 (5m hold)</span>
                </div>

                <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-300 dark:border-emerald-800">
                  <span className="block font-black text-xs text-emerald-700 dark:text-emerald-400">Saver</span>
                  <span className="block font-black text-sm text-gray-900 dark:text-white mt-0.5">
                    ₱{deliveryOptionPreviews.saver.fee.toFixed(2)}
                  </span>
                  <span className="block text-[9px] font-bold text-emerald-600 mt-0.5">
                    {deliveryOptionPreviews.saver.diff <= 0 ? `-₱${Math.abs(deliveryOptionPreviews.saver.diff)}` : `+₱${deliveryOptionPreviews.saver.diff}`}
                  </span>
                  <span className="block text-[8px] text-gray-400 mt-1">Batch 3 (10m hold)</span>
                </div>
              </div>

              <div className="pt-2 border-t border-dashed border-gray-200 dark:border-zinc-700 text-[10px] text-gray-500 dark:text-zinc-400 flex items-start gap-1.5">
                <Info className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                <span>
                  <strong>Customer Delivery Fee:</strong> What the customer pays on checkout. <strong>Rider Pay:</strong> The actual compensation paid to the driver per booking + pickup, managed in the Rider Pay tab.
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. RIDER PAY SECTION */}
      {ratesConfig && activeMainTab === 'riderPay' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Rider Pay Configuration Form */}
          <div className="lg:col-span-2 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-5 shadow-xs space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-100 dark:border-zinc-800 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-extrabold text-base text-gray-900 dark:text-white">
                    Rider Pay Rates for {cities.find((c) => c.id === activeCityId)?.name || activeCityId}
                  </h3>
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                    Courier Earnings
                  </span>
                </div>
                <p className="text-xs text-gray-500">
                  Saved in <code className="font-mono text-amber-600">deliveryRates/{'{cityId}'}.riderPay</code>. Governs driver compensation for single & batched deliveries.
                </p>
              </div>

              <button
                onClick={() => setConfirmSaveRatesModal(true)}
                disabled={savingRates}
                className="delivio-btn-yellow px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs self-start sm:self-auto"
              >
                {savingRates ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save Rider Pay
              </button>
            </div>

            {/* Explanatory Rule Banner */}
            <div className="p-4 rounded-2xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/60 flex items-start gap-3">
              <HelpCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="space-y-1.5 text-xs text-gray-700 dark:text-zinc-300">
                <span className="font-black text-amber-900 dark:text-amber-200 block uppercase tracking-wider">
                  How Rider Pay is Calculated
                </span>
                <p className="leading-relaxed">
                  A booking pays <strong>minFare + max(0, km - includedKm) &times; perKmExtra</strong> with <strong>km</strong> = road distance merchant to customer.
                </p>
                <p className="leading-relaxed">
                  The pickup fee is paid once per batch: <strong>minFare + max(0, km - freeKm) &times; perKmExtra</strong> with <strong>km</strong> = road distance from the rider at accept time to the first merchant.
                </p>
                <div className="pt-1 text-[11px] text-amber-800 dark:text-amber-400 font-bold flex items-center gap-1">
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  <span>"Customer delivery fee" (rates above) is what the user pays &ne; "Rider pay" (guaranteed driver payout).</span>
                </div>
              </div>
            </div>

            {/* 1. Single Booking Tier */}
            <div className="p-4 rounded-2xl bg-gray-50/70 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-800 space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-gray-200 dark:border-zinc-700/60">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-amber-400 text-black">
                    <UserCheck className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="font-black text-xs uppercase tracking-wider text-gray-900 dark:text-white">
                      Single Booking Pay (riderPay.single)
                    </h4>
                    <p className="text-[11px] text-gray-400">
                      Applied when an order is completed alone (Priority or non-batched delivery)
                    </p>
                  </div>
                </div>
                <span className="text-[10px] font-bold text-gray-400">Defaults: 35 / 2km / ₱8</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-gray-600 dark:text-zinc-400 mb-1">
                    Minimum Fare (₱)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={ratesConfig.riderPay?.single?.minFare ?? 35}
                    onChange={(e) => updateRiderPayField('single', 'minFare', e.target.value)}
                    className="w-full px-3 py-1.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-black text-gray-900 dark:text-white"
                  />
                  <span className="text-[10px] text-gray-400 mt-0.5 block">Default: ₱35</span>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-gray-600 dark:text-zinc-400 mb-1">
                    Included Distance (km)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={ratesConfig.riderPay?.single?.includedKm ?? 2}
                    onChange={(e) => updateRiderPayField('single', 'includedKm', e.target.value)}
                    className="w-full px-3 py-1.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-black text-gray-900 dark:text-white"
                  />
                  <span className="text-[10px] text-gray-400 mt-0.5 block">Default: 2 km</span>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-gray-600 dark:text-zinc-400 mb-1">
                    Extra per Km (₱/km)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={ratesConfig.riderPay?.single?.perKmExtra ?? 8}
                    onChange={(e) => updateRiderPayField('single', 'perKmExtra', e.target.value)}
                    className="w-full px-3 py-1.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-black text-amber-600"
                  />
                  <span className="text-[10px] text-gray-400 mt-0.5 block">Default: ₱8/km</span>
                </div>
              </div>
            </div>

            {/* 2. Batched Bookings Tier (Double & Triple+) */}
            <div className="p-4 rounded-2xl bg-gray-50/70 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-800 space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-gray-200 dark:border-zinc-700/60">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-blue-500 text-white">
                    <Layers className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="font-black text-xs uppercase tracking-wider text-gray-900 dark:text-white">
                      Batched Bookings Pay (riderPay.double)
                    </h4>
                    <p className="text-[11px] text-gray-400">
                      Tiered payout per booking when 2 or more orders are grouped in a single trip
                    </p>
                  </div>
                </div>
                <span className="text-[10px] font-bold text-gray-400">Multi-drop batching</span>
              </div>

              {/* 1st Booking */}
              <div className="p-3 rounded-xl bg-white dark:bg-zinc-800/80 border border-gray-200 dark:border-zinc-700/70 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-xs text-gray-900 dark:text-white flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-blue-500" />
                    1st Booking in Batch (double.first)
                  </span>
                  <span className="text-[10px] text-gray-400 font-semibold">Defaults: 35 / 2km / ₱8</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 dark:text-zinc-400 mb-0.5">Min Fare (₱)</label>
                    <input
                      type="number"
                      value={ratesConfig.riderPay?.double?.first?.minFare ?? 35}
                      onChange={(e) => updateRiderPayDoubleField('first', 'minFare', e.target.value)}
                      className="w-full px-2.5 py-1 text-xs rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-850 font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 dark:text-zinc-400 mb-0.5">Included Km</label>
                    <input
                      type="number"
                      step="0.5"
                      value={ratesConfig.riderPay?.double?.first?.includedKm ?? 2}
                      onChange={(e) => updateRiderPayDoubleField('first', 'includedKm', e.target.value)}
                      className="w-full px-2.5 py-1 text-xs rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-850 font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 dark:text-zinc-400 mb-0.5">Extra per Km (₱)</label>
                    <input
                      type="number"
                      step="0.5"
                      value={ratesConfig.riderPay?.double?.first?.perKmExtra ?? 8}
                      onChange={(e) => updateRiderPayDoubleField('first', 'perKmExtra', e.target.value)}
                      className="w-full px-2.5 py-1 text-xs rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-850 font-bold text-blue-600"
                    />
                  </div>
                </div>
              </div>

              {/* 2nd Booking */}
              <div className="p-3 rounded-xl bg-white dark:bg-zinc-800/80 border border-gray-200 dark:border-zinc-700/70 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-xs text-gray-900 dark:text-white flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    2nd Booking in Batch (double.second)
                  </span>
                  <span className="text-[10px] text-gray-400 font-semibold">Defaults: 25 / 2km / ₱6</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 dark:text-zinc-400 mb-0.5">Min Fare (₱)</label>
                    <input
                      type="number"
                      value={ratesConfig.riderPay?.double?.second?.minFare ?? 25}
                      onChange={(e) => updateRiderPayDoubleField('second', 'minFare', e.target.value)}
                      className="w-full px-2.5 py-1 text-xs rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-850 font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 dark:text-zinc-400 mb-0.5">Included Km</label>
                    <input
                      type="number"
                      step="0.5"
                      value={ratesConfig.riderPay?.double?.second?.includedKm ?? 2}
                      onChange={(e) => updateRiderPayDoubleField('second', 'includedKm', e.target.value)}
                      className="w-full px-2.5 py-1 text-xs rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-850 font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 dark:text-zinc-400 mb-0.5">Extra per Km (₱)</label>
                    <input
                      type="number"
                      step="0.5"
                      value={ratesConfig.riderPay?.double?.second?.perKmExtra ?? 6}
                      onChange={(e) => updateRiderPayDoubleField('second', 'perKmExtra', e.target.value)}
                      className="w-full px-2.5 py-1 text-xs rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-850 font-bold text-emerald-600"
                    />
                  </div>
                </div>
              </div>

              {/* 3rd & Later Booking */}
              <div className="p-3 rounded-xl bg-white dark:bg-zinc-800/80 border border-gray-200 dark:border-zinc-700/70 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-xs text-gray-900 dark:text-white flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-purple-500" />
                    3rd & Any Later Booking (double.third)
                  </span>
                  <span className="text-[10px] text-gray-400 font-semibold">Defaults: 20 / 2km / ₱5</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 dark:text-zinc-400 mb-0.5">Min Fare (₱)</label>
                    <input
                      type="number"
                      value={ratesConfig.riderPay?.double?.third?.minFare ?? 20}
                      onChange={(e) => updateRiderPayDoubleField('third', 'minFare', e.target.value)}
                      className="w-full px-2.5 py-1 text-xs rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-850 font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 dark:text-zinc-400 mb-0.5">Included Km</label>
                    <input
                      type="number"
                      step="0.5"
                      value={ratesConfig.riderPay?.double?.third?.includedKm ?? 2}
                      onChange={(e) => updateRiderPayDoubleField('third', 'includedKm', e.target.value)}
                      className="w-full px-2.5 py-1 text-xs rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-850 font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 dark:text-zinc-400 mb-0.5">Extra per Km (₱)</label>
                    <input
                      type="number"
                      step="0.5"
                      value={ratesConfig.riderPay?.double?.third?.perKmExtra ?? 5}
                      onChange={(e) => updateRiderPayDoubleField('third', 'perKmExtra', e.target.value)}
                      className="w-full px-2.5 py-1 text-xs rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-850 font-bold text-purple-600"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* 3. Pickup Fee Tier */}
            <div className="p-4 rounded-2xl bg-gray-50/70 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-800 space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-gray-200 dark:border-zinc-700/60">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-amber-400 text-black">
                    <Navigation className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="font-black text-xs uppercase tracking-wider text-gray-900 dark:text-white">
                      Batch Pickup Fee (riderPay.pickup)
                    </h4>
                    <p className="text-[11px] text-gray-400">
                      Paid once per batch: rider acceptance point &rarr; first merchant store
                    </p>
                  </div>
                </div>
                <span className="text-[10px] font-bold text-gray-400">Defaults: 10 / 1km free / ₱6</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-gray-600 dark:text-zinc-400 mb-1">
                    Base / Min Pickup Fare (₱)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={ratesConfig.riderPay?.pickup?.minFare ?? 10}
                    onChange={(e) => updateRiderPayField('pickup', 'minFare', e.target.value)}
                    className="w-full px-3 py-1.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-black text-gray-900 dark:text-white"
                  />
                  <span className="text-[10px] text-gray-400 mt-0.5 block">Default: ₱10</span>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-gray-600 dark:text-zinc-400 mb-1">
                    Free Pickup Distance (km)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={ratesConfig.riderPay?.pickup?.freeKm ?? 1}
                    onChange={(e) => updateRiderPayField('pickup', 'freeKm', e.target.value)}
                    className="w-full px-3 py-1.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-black text-gray-900 dark:text-white"
                  />
                  <span className="text-[10px] text-gray-400 mt-0.5 block">Default: 1 km</span>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-gray-600 dark:text-zinc-400 mb-1">
                    Extra per Km (₱/km)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={ratesConfig.riderPay?.pickup?.perKmExtra ?? 6}
                    onChange={(e) => updateRiderPayField('pickup', 'perKmExtra', e.target.value)}
                    className="w-full px-3 py-1.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-black text-amber-600"
                  />
                  <span className="text-[10px] text-gray-400 mt-0.5 block">Default: ₱6/km</span>
                </div>
              </div>
            </div>
          </div>

          {/* Interactive Rider Pay Calculator */}
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-5 shadow-xs space-y-5">
            <div className="flex items-center gap-2">
              <Calculator className="w-5 h-5 text-amber-500" />
              <h3 className="font-bold text-base text-gray-900 dark:text-white">
                Rider Pay Calculator
              </h3>
            </div>

            <div className="space-y-4 text-xs">
              {/* Batch Mode Selector */}
              <div>
                <label className="block uppercase font-bold text-gray-500 mb-1.5">
                  Trip Batch Type
                </label>
                <div className="grid grid-cols-3 gap-1.5 p-1 bg-gray-100 dark:bg-zinc-800 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setCalcRiderPayMode('single')}
                    className={`py-1.5 rounded-lg font-bold text-xs transition-all ${
                      calcRiderPayMode === 'single'
                        ? 'bg-amber-400 text-black shadow-xs'
                        : 'text-gray-600 dark:text-zinc-400 hover:text-black dark:hover:text-white'
                    }`}
                  >
                    Single (1)
                  </button>
                  <button
                    type="button"
                    onClick={() => setCalcRiderPayMode('double')}
                    className={`py-1.5 rounded-lg font-bold text-xs transition-all ${
                      calcRiderPayMode === 'double'
                        ? 'bg-amber-400 text-black shadow-xs'
                        : 'text-gray-600 dark:text-zinc-400 hover:text-black dark:hover:text-white'
                    }`}
                  >
                    Double (2)
                  </button>
                  <button
                    type="button"
                    onClick={() => setCalcRiderPayMode('triple')}
                    className={`py-1.5 rounded-lg font-bold text-xs transition-all ${
                      calcRiderPayMode === 'triple'
                        ? 'bg-amber-400 text-black shadow-xs'
                        : 'text-gray-600 dark:text-zinc-400 hover:text-black dark:hover:text-white'
                    }`}
                  >
                    Triple (3)
                  </button>
                </div>
              </div>

              {/* Pickup Distance */}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="uppercase font-bold text-gray-500">
                    Pickup Distance ({calcRiderPickupDist} km)
                  </label>
                  <span className="text-[10px] text-gray-400">Rider &rarr; 1st Shop</span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="10"
                  step="0.1"
                  value={calcRiderPickupDist}
                  onChange={(e) => setCalcRiderPickupDist(Number(e.target.value))}
                  className="w-full accent-amber-500"
                />
              </div>

              {/* Order 1 Distance */}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="uppercase font-bold text-gray-500">
                    Order 1 Distance ({calcRiderOrder1Dist} km)
                  </label>
                  <span className="text-[10px] text-gray-400">Shop 1 &rarr; Customer 1</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="20"
                  step="0.5"
                  value={calcRiderOrder1Dist}
                  onChange={(e) => setCalcRiderOrder1Dist(Number(e.target.value))}
                  className="w-full accent-amber-500"
                />
              </div>

              {/* Order 2 Distance (if double or triple) */}
              {(calcRiderPayMode === 'double' || calcRiderPayMode === 'triple') && (
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="uppercase font-bold text-gray-500">
                      Order 2 Distance ({calcRiderOrder2Dist} km)
                    </label>
                    <span className="text-[10px] text-gray-400">Shop 2 &rarr; Customer 2</span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="20"
                    step="0.5"
                    value={calcRiderOrder2Dist}
                    onChange={(e) => setCalcRiderOrder2Dist(Number(e.target.value))}
                    className="w-full accent-blue-500"
                  />
                </div>
              )}

              {/* Order 3 Distance (if triple) */}
              {calcRiderPayMode === 'triple' && (
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="uppercase font-bold text-gray-500">
                      Order 3 Distance ({calcRiderOrder3Dist} km)
                    </label>
                    <span className="text-[10px] text-gray-400">Shop 3 &rarr; Customer 3</span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="20"
                    step="0.5"
                    value={calcRiderOrder3Dist}
                    onChange={(e) => setCalcRiderOrder3Dist(Number(e.target.value))}
                    className="w-full accent-purple-500"
                  />
                </div>
              )}
            </div>

            {/* Calculated Breakdown Card */}
            <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 space-y-2.5 text-xs">
              <span className="font-extrabold text-[11px] uppercase tracking-wider text-amber-900 dark:text-amber-200 block pb-1 border-b border-amber-200/60 dark:border-amber-900/40">
                Courier Payout Breakdown ({calcRiderPayMode.toUpperCase()})
              </span>

              <div className="flex justify-between text-gray-700 dark:text-zinc-300">
                <span>Batch Pickup Fee ({calcRiderPickupDist} km):</span>
                <span className="font-bold text-gray-900 dark:text-white">₱{calculatedRiderPay.pickupFare.toFixed(2)}</span>
              </div>

              <div className="flex justify-between text-gray-700 dark:text-zinc-300">
                <span>Booking 1 Fare ({calcRiderOrder1Dist} km):</span>
                <span className="font-bold text-gray-900 dark:text-white">₱{calculatedRiderPay.booking1Fare.toFixed(2)}</span>
              </div>

              {(calcRiderPayMode === 'double' || calcRiderPayMode === 'triple') && (
                <div className="flex justify-between text-gray-700 dark:text-zinc-300">
                  <span>Booking 2 Fare ({calcRiderOrder2Dist} km):</span>
                  <span className="font-bold text-gray-900 dark:text-white">₱{calculatedRiderPay.booking2Fare.toFixed(2)}</span>
                </div>
              )}

              {calcRiderPayMode === 'triple' && (
                <div className="flex justify-between text-gray-700 dark:text-zinc-300">
                  <span>Booking 3 Fare ({calcRiderOrder3Dist} km):</span>
                  <span className="font-bold text-gray-900 dark:text-white">₱{calculatedRiderPay.booking3Fare.toFixed(2)}</span>
                </div>
              )}

              <div className="pt-2 border-t border-amber-300 dark:border-amber-800 flex justify-between font-black text-sm text-gray-900 dark:text-white">
                <span>Rider Batch Total:</span>
                <span className="text-amber-600 text-base">₱{calculatedRiderPay.totalRiderPay.toFixed(2)}</span>
              </div>

              <div className="p-2.5 rounded-xl bg-white/70 dark:bg-zinc-900/80 border border-amber-200 dark:border-amber-900/40 flex justify-between items-center text-xs">
                <span className="font-bold text-gray-600 dark:text-zinc-400">
                  Average Pay per Booking ({calculatedRiderPay.orderCount}):
                </span>
                <span className="font-black text-emerald-600">
                  ₱{calculatedRiderPay.avgPerBooking.toFixed(2)} / order
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. TAXI FARES SECTION */}
      {ratesConfig && activeMainTab === 'taxi' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Taxi Rates Form */}
          <div className="lg:col-span-2 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-5 shadow-xs space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-100 dark:border-zinc-800 pb-4">
              <div>
                <h3 className="font-extrabold text-base text-gray-900 dark:text-white">
                  Delivio Taxi Fares for {cities.find((c) => c.id === activeCityId)?.name || activeCityId}
                </h3>
                <p className="text-xs text-gray-500">
                  Saved in <code className="font-mono text-amber-600">deliveryRates/{'{cityId}'}.rideRates.{'{vehicleType}'}</code>
                </p>
              </div>

              <button
                onClick={() => setConfirmSaveRatesModal(true)}
                className="delivio-btn-yellow px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs self-start sm:self-auto"
              >
                <Save className="w-4 h-4" /> Save Delivio Taxi Fares
              </button>
            </div>

            {/* Vehicle sub-tabs */}
            <div className="flex gap-2 overflow-x-auto pb-1">
              {VEHICLE_TYPES.map((vt) => {
                const currentVRates = ratesConfig.rideRates?.[vt.id] || DEFAULT_TAXI_RATES[vt.id];
                const isEnabled = currentVRates.enabled !== false;

                return (
                  <button
                    key={vt.id}
                    onClick={() => setActiveVehicleTab(vt.id)}
                    className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
                      activeVehicleTab === vt.id
                        ? 'bg-amber-400 text-black shadow-xs font-black'
                        : 'bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-400 hover:bg-gray-200'
                    }`}
                  >
                    <span>{vt.name}</span>
                    <span
                      className={`w-2 h-2 rounded-full ${
                        isEnabled ? 'bg-emerald-500' : 'bg-gray-400'
                      }`}
                    />
                  </button>
                );
              })}
            </div>

            {/* Selected Vehicle Settings */}
            {(() => {
              const currentVRates: TaxiVehicleRates =
                ratesConfig.rideRates?.[activeVehicleTab] || DEFAULT_TAXI_RATES[activeVehicleTab];

              return (
                <div className="space-y-5">
                  {/* Enabled toggle banner */}
                  <div className="p-3.5 rounded-xl border border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-850 flex items-center justify-between">
                    <div>
                      <span className="font-bold text-xs text-gray-900 dark:text-white block">
                        Enable Delivio Taxi for {VEHICLE_LABELS[activeVehicleTab]} in {cities.find((c) => c.id === activeCityId)?.name}
                      </span>
                      <span className="text-[11px] text-gray-500">
                        When disabled, customers in this city cannot book {VEHICLE_LABELS[activeVehicleTab]} rides.
                      </span>
                    </div>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={currentVRates.enabled !== false}
                        onChange={(e) => updateTaxiRateField('enabled', e.target.checked)}
                        className="w-4 h-4 rounded-sm text-amber-500"
                      />
                      <span className="text-xs font-bold text-gray-700 dark:text-zinc-200">
                        {currentVRates.enabled !== false ? 'Active' : 'Disabled'}
                      </span>
                    </label>
                  </div>

                  {/* 8 Fare Fields */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                        Base Fare (₱)
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={currentVRates.baseFare || 0}
                        onChange={(e) => updateTaxiRateField('baseFare', Number(e.target.value))}
                        className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold text-gray-900 dark:text-white"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                        Included Distance (km)
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        value={currentVRates.includedKm || 0}
                        onChange={(e) => updateTaxiRateField('includedKm', Number(e.target.value))}
                        className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold text-gray-900 dark:text-white"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                        Per Additional Km (₱)
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        value={currentVRates.perKm || 0}
                        onChange={(e) => updateTaxiRateField('perKm', Number(e.target.value))}
                        className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold text-gray-900 dark:text-white"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                        Minimum Fare (₱)
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={currentVRates.minFare || 0}
                        onChange={(e) => updateTaxiRateField('minFare', Number(e.target.value))}
                        className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold text-gray-900 dark:text-white"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                        Per Extra Stop Fee (₱)
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={currentVRates.perStopFee || 0}
                        onChange={(e) => updateTaxiRateField('perStopFee', Number(e.target.value))}
                        className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold text-gray-900 dark:text-white"
                      />
                    </div>

                    {/* Platform Service Fee Configuration */}
                    <div className="sm:col-span-2 p-3.5 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/50 dark:bg-amber-950/20 space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div>
                          <label className="block text-xs font-bold uppercase tracking-wider text-amber-900 dark:text-amber-300">
                            Platform Service Fee
                          </label>
                          <p className="text-[11px] text-amber-700/80 dark:text-amber-400/80">
                            Charged to rider. If percent, applies to ride fare + extra stop fees.
                          </p>
                        </div>
                        <div className="inline-flex rounded-lg border border-amber-300 dark:border-amber-800 p-0.5 bg-white dark:bg-zinc-900">
                          <button
                            type="button"
                            onClick={() => updateTaxiRateField('serviceFeeType', 'flat')}
                            className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${
                              (currentVRates.serviceFeeType || 'flat') === 'flat'
                                ? 'bg-amber-500 text-white shadow-xs'
                                : 'text-gray-600 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white'
                            }`}
                          >
                            Flat ₱
                          </button>
                          <button
                            type="button"
                            onClick={() => updateTaxiRateField('serviceFeeType', 'percent')}
                            className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${
                              currentVRates.serviceFeeType === 'percent'
                                ? 'bg-amber-500 text-white shadow-xs'
                                : 'text-gray-600 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white'
                            }`}
                          >
                            Percent %
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <label className="block text-[11px] font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                            {currentVRates.serviceFeeType === 'percent' ? 'Fee Rate (%)' : 'Flat Fee (₱)'}
                          </label>
                          <input
                            type="number"
                            min="0"
                            step={currentVRates.serviceFeeType === 'percent' ? '0.1' : '1'}
                            value={currentVRates.serviceFee || 0}
                            onChange={(e) => updateTaxiRateField('serviceFee', Number(e.target.value))}
                            className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold text-amber-600"
                          />
                        </div>

                        {currentVRates.serviceFeeType === 'percent' && (
                          <>
                            <div>
                              <label className="block text-[11px] font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                                Min Fee Cap (₱) <span className="text-gray-400 lowercase">(optional)</span>
                              </label>
                              <input
                                type="number"
                                min="0"
                                value={currentVRates.serviceFeeMin || 0}
                                onChange={(e) => updateTaxiRateField('serviceFeeMin', Number(e.target.value))}
                                placeholder="e.g. 5"
                                className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold text-gray-900 dark:text-white"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                                Max Fee Cap (₱) <span className="text-gray-400 lowercase">(0 = no cap)</span>
                              </label>
                              <input
                                type="number"
                                min="0"
                                value={currentVRates.serviceFeeMax || 0}
                                onChange={(e) => updateTaxiRateField('serviceFeeMax', Number(e.target.value))}
                                placeholder="0"
                                className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold text-gray-900 dark:text-white"
                              />
                            </div>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                        Platform Commission Share (%)
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min="0"
                          max="50"
                          value={currentVRates.commissionPercent ?? 15}
                          onChange={(e) => updateTaxiRateField('commissionPercent', Number(e.target.value))}
                          className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold text-gray-900 dark:text-white"
                        />
                        <span className="text-xs text-gray-400 font-bold">%</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Interactive Taxi Fare Calculator */}
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-5 shadow-xs space-y-5">
            <div className="flex items-center gap-2">
              <Calculator className="w-5 h-5 text-amber-500" />
              <h3 className="font-bold text-base text-gray-900 dark:text-white">
                Delivio Taxi Fare Calculator
              </h3>
            </div>

            <p className="text-xs text-gray-500 dark:text-zinc-400">
              Simulate taxi ride fares across vehicles, extra stops, and time of day:
            </p>

            <div className="space-y-3.5 text-xs">
              <div>
                <label className="block uppercase font-semibold text-gray-500 mb-1">
                  City
                </label>
                <select
                  value={activeCityId}
                  onChange={(e) => setActiveCityId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                >
                  {cities.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block uppercase font-semibold text-gray-500 mb-1">
                  Vehicle Type
                </label>
                <select
                  value={calcTaxiVehicle}
                  onChange={(e) => setCalcTaxiVehicle(e.target.value as VehicleType)}
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                >
                  {VEHICLE_TYPES.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} ({v.defaultSeats} seats)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block uppercase font-semibold text-gray-500 mb-1">
                  Estimated Distance ({calcTaxiDistance} km)
                </label>
                <input
                  type="range"
                  min="1"
                  max="50"
                  step="0.5"
                  value={calcTaxiDistance}
                  onChange={(e) => setCalcTaxiDistance(Number(e.target.value))}
                  className="w-full accent-amber-500"
                />
              </div>

              <div>
                <label className="block uppercase font-semibold text-gray-500 mb-1">
                  Extra Stops Along Route: {calcExtraStops}
                </label>
                <div className="flex gap-2">
                  {[0, 1, 2, 3, 4].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setCalcExtraStops(n)}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-bold border ${
                        calcExtraStops === n
                          ? 'bg-amber-400 text-black border-amber-400'
                          : 'bg-gray-100 dark:bg-zinc-800 border-gray-200 dark:border-zinc-700 text-gray-700 dark:text-zinc-300'
                      }`}
                    >
                      {n === 0 ? 'None' : `+${n}`}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block uppercase font-semibold text-gray-500 mb-1">
                  Time of Day
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {[
                    { id: 'day', label: 'Day Regular' },
                    { id: 'peak', label: 'Peak Rush (+20%)' },
                    { id: 'night', label: 'Late Night (+₱30)' }
                  ].map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setCalcTaxiTimeOfDay(t.id as any)}
                      className={`py-1.5 px-2 rounded-lg text-[11px] font-bold border transition-colors ${
                        calcTaxiTimeOfDay === t.id
                          ? 'bg-amber-400 text-black border-amber-400'
                          : 'bg-gray-50 dark:bg-zinc-850 border-gray-200 dark:border-zinc-700 text-gray-700 dark:text-zinc-300'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Calculated Breakdown Card */}
            <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 space-y-2 text-xs">
              <div className="flex justify-between text-amber-900 dark:text-amber-300">
                <span>Ride Fare:</span>
                <span>₱{calculatedTaxiFare.rideFare.toFixed(2)}</span>
              </div>
              {calculatedTaxiFare.stopFee > 0 && (
                <div className="flex justify-between text-amber-900 dark:text-amber-300">
                  <span>Extra Stop Fee ({calcExtraStops}):</span>
                  <span>+₱{calculatedTaxiFare.stopFee.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-amber-900 dark:text-amber-300">
                <span>
                  Platform Service Fee{' '}
                  <span className="text-[10px] text-amber-700 dark:text-amber-400 block sm:inline">
                    ({calculatedTaxiFare.feeBreakdownNote})
                  </span>
                </span>
                <span className="font-bold">₱{calculatedTaxiFare.serviceFee.toFixed(2)}</span>
              </div>
              <div className="pt-2 border-t border-amber-200 dark:border-amber-900 flex justify-between font-black text-sm text-gray-900 dark:text-white">
                <span>Total Customer Fare:</span>
                <span className="text-amber-600 font-extrabold">₱{calculatedTaxiFare.total.toFixed(2)}</span>
              </div>

              <div className="pt-2 border-t border-amber-200 dark:border-amber-900 space-y-1">
                <div className="flex justify-between font-bold text-emerald-600 text-xs">
                  <span>Driver Net Payout:</span>
                  <span>₱{calculatedTaxiFare.driverNet.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-[11px] text-gray-500 dark:text-zinc-400">
                  <span>Platform Margin ({calculatedTaxiFare.commissionPercent}% + fee):</span>
                  <span>₱{calculatedTaxiFare.platformMargin.toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. CITY SERVICES TAB */}
      {activeMainTab === 'services' && (
        <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-6 shadow-xs space-y-5">
          <div className="border-b border-gray-100 dark:border-zinc-800 pb-3">
            <h3 className="font-extrabold text-base text-gray-900 dark:text-white flex items-center gap-2">
              <Layers className="w-5 h-5 text-amber-500" />
              <span>
                Operational Services for {cities.find((c) => c.id === activeCityId)?.name || activeCityId}
              </span>
            </h3>
            <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">
              Manage city-level service availability for Delivio Food, Delivio Mart, Delivio Parcel, Delivio Pabili, Delivio Instant, and Delivio Taxi. Toggling off a service automatically closes affected stores and locks driver dispatches in this city.
            </p>
          </div>

          <CityServicesMatrix filterCityId={activeCityId} />
        </div>
      )}

      {/* Add / Edit City Modal */}
      {cityModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-6 shadow-2xl">
            <h3 className="font-bold text-lg text-gray-900 dark:text-white mb-4">
              {editingCity ? `Edit Coverage City: ${editingCity.name}` : 'Add New Operational City'}
            </h3>

            <form onSubmit={handleSaveCity} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                    City Name
                  </label>
                  <input
                    type="text"
                    value={cityName}
                    onChange={(e) => setCityName(e.target.value)}
                    required
                    placeholder="e.g. Puerto Princesa"
                    className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                    Province
                  </label>
                  <input
                    type="text"
                    value={cityProvince}
                    onChange={(e) => setCityProvince(e.target.value)}
                    placeholder="e.g. Palawan"
                    className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Delivery Radius ({cityRadiusKm} km)
                </label>
                <input
                  type="range"
                  min="3"
                  max="50"
                  value={cityRadiusKm}
                  onChange={(e) => setCityRadiusKm(Number(e.target.value))}
                  className="w-full accent-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Set City Center on Map (Click or drag pin)
                </label>
                <div
                  ref={cityMapRef}
                  className="h-56 w-full rounded-xl border border-gray-300 dark:border-zinc-700 overflow-hidden"
                />
                <div className="text-[11px] text-gray-400 font-mono mt-1">
                  Center coordinates: {cityLat.toFixed(5)}, {cityLng.toFixed(5)}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCityModalOpen(false)}
                  className="px-4 py-2 text-xs font-bold text-gray-600 hover:bg-gray-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingCity}
                  className="delivio-btn-yellow px-5 py-2 text-xs font-bold rounded-xl flex items-center gap-1.5"
                >
                  {savingCity && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Save City Configuration
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirmation Modal to Save Rates */}
      {confirmSaveRatesModal && (
        <ConfirmationModal
          isOpen={confirmSaveRatesModal}
          onClose={() => setConfirmSaveRatesModal(false)}
          onConfirm={handleSaveRates}
          title="Confirm Rate Schedule Updates"
          message={`Are you sure you want to save the new rate schedule for ${cities.find((c) => c.id === activeCityId)?.name}? This takes effect immediately on all new customer orders in this city.`}
          confirmLabel="Save & Apply Rates"
          reasonRequired={false}
          isDestructive={false}
        />
      )}
    </div>
  );
};
