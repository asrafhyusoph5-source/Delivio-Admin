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
import type { City, DeliveryRatesConfig, ServiceRates, OrderServiceType, DeliveryServiceType, TaxiVehicleRates } from '../types';
import {
  VEHICLE_TYPES,
  VEHICLE_LABELS,
  DEFAULT_TAXI_RATES,
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
  DollarSign
} from 'lucide-react';
import { ConfirmationModal } from '../components/common/ConfirmationModal';

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
  serviceFee: 10
};

export const DeliveryRates: React.FC = () => {
  const { cities, refreshCities } = useCity();
  const { adminProfile } = useAuth();
  const { showSuccess, showError } = useToast();

  const [activeCityId, setActiveCityId] = useState<string>('');
  const [loadingRates, setLoadingRates] = useState(false);
  const [ratesConfig, setRatesConfig] = useState<DeliveryRatesConfig | null>(null);

  // Tab between "Delivery Rates" and "Taxi Fares"
  const [activeMainTab, setActiveMainTab] = useState<'delivery' | 'taxi'>('delivery');

  // Selected Service sub-tab for Delivery Rates config
  const [activeServiceTab, setActiveServiceTab] = useState<DeliveryServiceType>('food');

  // Selected Vehicle sub-tab for Taxi Fares config
  const [activeVehicleTab, setActiveVehicleTab] = useState<VehicleType>('motorcycle');

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
  const [calcDeliveryDistance, setCalcDeliveryDistance] = useState<number>(4.5);
  const [calcIsNight, setCalcIsNight] = useState<boolean>(false);
  const [calcIsPeak, setCalcIsPeak] = useState<boolean>(false);

  // Taxi Fare Calculator States
  const [calcTaxiVehicle, setCalcTaxiVehicle] = useState<VehicleType>('motorcycle');
  const [calcTaxiDistance, setCalcTaxiDistance] = useState<number>(6.0);
  const [calcExtraStops, setCalcExtraStops] = useState<number>(0);
  const [calcTaxiTimeOfDay, setCalcTaxiTimeOfDay] = useState<'day' | 'peak' | 'night'>('day');

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

  // Fetch Delivery & Taxi Rates for active city
  useEffect(() => {
    if (!activeCityId) return;

    const fetchRates = async () => {
      try {
        setLoadingRates(true);
        const rateDocRef = doc(db, 'deliveryRates', activeCityId);
        const snap = await getDoc(rateDocRef);

        if (snap.exists()) {
          const dt = snap.data();
          setRatesConfig({
            id: snap.id,
            food: dt.food || { ...DEFAULT_SERVICE_RATES },
            convenience: dt.convenience || { ...DEFAULT_SERVICE_RATES },
            parcel: dt.parcel || { ...DEFAULT_SERVICE_RATES, baseFare: 40, perKm: 10 },
            pabili: dt.pabili || { ...DEFAULT_SERVICE_RATES, baseFare: 60, serviceFee: 20 },
            request_rider: dt.request_rider || { ...DEFAULT_SERVICE_RATES, baseFare: 50 },
            rideRates: dt.rideRates || { ...DEFAULT_TAXI_RATES },
            riderCommissionPercent: dt.riderCommissionPercent ?? 80,
            surcharges: dt.surcharges || {
              peak: { enabled: false, multiplier: 1.2 },
              night: { enabled: false, flat: 25 }
            }
          });
        } else {
          // Provide default template including DEFAULT_TAXI_RATES
          setRatesConfig({
            id: activeCityId,
            food: { ...DEFAULT_SERVICE_RATES },
            convenience: { ...DEFAULT_SERVICE_RATES },
            parcel: { ...DEFAULT_SERVICE_RATES, baseFare: 40, perKm: 10 },
            pabili: { ...DEFAULT_SERVICE_RATES, baseFare: 60, serviceFee: 20 },
            request_rider: { ...DEFAULT_SERVICE_RATES, baseFare: 50 },
            rideRates: { ...DEFAULT_TAXI_RATES },
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
    value: number
  ) => {
    if (!ratesConfig) return;
    setRatesConfig({
      ...ratesConfig,
      [activeServiceTab]: {
        ...ratesConfig[activeServiceTab],
        [field]: Number(value)
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
          [field]: field === 'enabled' ? Boolean(value) : Number(value)
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
        updatedAt: Timestamp.now()
      };

      await setDoc(rateRef, payload, { merge: true });

      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        action: 'UPDATE_DELIVERY_AND_TAXI_RATES',
        entityType: 'deliveryRates',
        entityId: activeCityId,
        details: `Saved rates & fares (Delivery & Taxi rideRates) for city ${activeCityId}`
      });

      showSuccess('Rates & Fares schedule saved successfully.');
      setConfirmSaveRatesModal(false);
    } catch (err: any) {
      showError(err);
    } finally {
      setSavingRates(false);
    }
  };

  // 1. Delivery Fee Simulator Calculation
  const calculatedDeliveryFee = useMemo(() => {
    if (!ratesConfig) return { baseFare: 0, distanceFee: 0, serviceFee: 0, surcharges: 0, totalDeliveryFee: 0, grandTotal: 0, driverCut: 0 };
    const rates = ratesConfig[calcService] || DEFAULT_SERVICE_RATES;

    const baseFare = Number(rates.baseFare) || 0;
    const includedKm = Number(rates.includedKm) || 0;
    const perKm = Number(rates.perKm) || 0;
    const serviceFee = Number(rates.serviceFee) || 0;

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
    const grandTotal = totalDeliveryFee + serviceFee;
    const driverCommission = ratesConfig.riderCommissionPercent ?? 80;
    const driverCut = (totalDeliveryFee * driverCommission) / 100;

    return {
      baseFare,
      distanceFee,
      serviceFee,
      surcharges: surchargeTotal,
      totalDeliveryFee,
      grandTotal,
      driverCut
    };
  }, [ratesConfig, calcService, calcDeliveryDistance, calcIsPeak, calcIsNight]);

  // 2. Taxi Fare Calculator Calculation
  const calculatedTaxiFare = useMemo(() => {
    const defaultV = DEFAULT_TAXI_RATES[calcTaxiVehicle];
    const vRates: TaxiVehicleRates = ratesConfig?.rideRates?.[calcTaxiVehicle] || defaultV;

    const baseFare = Number(vRates.baseFare) || 0;
    const includedKm = Number(vRates.includedKm) || 0;
    const perKm = Number(vRates.perKm) || 0;
    const minFare = Number(vRates.minFare) || 0;
    const perStopFee = Number(vRates.perStopFee) || 0;
    const serviceFee = Number(vRates.serviceFee) || 0;
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
    const subtotal = rideFare + stopFee;
    const total = subtotal + serviceFee;

    // Platform margin & Driver Net
    const platformMargin = (rideFare * (commissionPercent / 100)) + serviceFee;
    const driverNet = total - platformMargin;

    return {
      rideFare,
      stopFee,
      serviceFee,
      total,
      driverNet,
      platformMargin,
      commissionPercent
    };
  }, [ratesConfig, calcTaxiVehicle, calcTaxiDistance, calcExtraStops, calcTaxiTimeOfDay]);

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

      {/* Main Mode Tabs: Delivery Rates vs. Taxi Fares */}
      <div className="flex gap-3 border-b border-gray-200 dark:border-zinc-800 pb-2">
        <button
          onClick={() => setActiveMainTab('delivery')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-extrabold transition-all ${
            activeMainTab === 'delivery'
              ? 'bg-amber-400 text-black shadow-xs'
              : 'bg-white dark:bg-zinc-900 text-gray-600 dark:text-zinc-400 hover:bg-gray-100 border border-gray-200 dark:border-zinc-800'
          }`}
        >
          <Bike className="w-4 h-4" />
          <span>Delivery Rates</span>
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
          <span>Taxi Fares (Per Vehicle)</span>
        </button>
      </div>

      {/* 1. DELIVERY RATES SECTION */}
      {ratesConfig && activeMainTab === 'delivery' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Delivery Rates Form */}
          <div className="lg:col-span-2 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-5 shadow-xs space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-100 dark:border-zinc-800 pb-4">
              <div>
                <h3 className="font-extrabold text-base text-gray-900 dark:text-white">
                  Delivery Rates for {cities.find((c) => c.id === activeCityId)?.name || activeCityId}
                </h3>
                <p className="text-xs text-gray-500">
                  Configure base fare, per km additions, and driver commission.
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

              <div>
                <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Platform Service Fee (₱)
                </label>
                <input
                  type="number"
                  min="0"
                  value={ratesConfig[activeServiceTab]?.serviceFee || 0}
                  onChange={(e) => updateDeliveryRateField('serviceFee', Number(e.target.value))}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold text-amber-600"
                />
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
              <div className="flex justify-between text-amber-900 dark:text-amber-300">
                <span>Service Fee:</span>
                <span>₱{calculatedDeliveryFee.serviceFee.toFixed(2)}</span>
              </div>
              <div className="pt-2 border-t border-amber-200 dark:border-amber-900 flex justify-between font-black text-sm text-gray-900 dark:text-white">
                <span>Customer Delivery Fee:</span>
                <span className="text-amber-600">₱{calculatedDeliveryFee.grandTotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-bold text-emerald-600 text-xs pt-1">
                <span>Estimated Driver Payout ({ratesConfig.riderCommissionPercent}%):</span>
                <span>₱{calculatedDeliveryFee.driverCut.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. TAXI FARES SECTION */}
      {ratesConfig && activeMainTab === 'taxi' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Taxi Rates Form */}
          <div className="lg:col-span-2 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-5 shadow-xs space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-100 dark:border-zinc-800 pb-4">
              <div>
                <h3 className="font-extrabold text-base text-gray-900 dark:text-white">
                  Taxi Fares for {cities.find((c) => c.id === activeCityId)?.name || activeCityId}
                </h3>
                <p className="text-xs text-gray-500">
                  Saved in <code className="font-mono text-amber-600">deliveryRates/{'{cityId}'}.rideRates.{'{vehicleType}'}</code>
                </p>
              </div>

              <button
                onClick={() => setConfirmSaveRatesModal(true)}
                className="delivio-btn-yellow px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs self-start sm:self-auto"
              >
                <Save className="w-4 h-4" /> Save Taxi Fares
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
                        Enable Taxi Service for {VEHICLE_LABELS[activeVehicleTab]} in {cities.find((c) => c.id === activeCityId)?.name}
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

                    <div>
                      <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                        Platform Service Fee (₱)
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={currentVRates.serviceFee || 0}
                        onChange={(e) => updateTaxiRateField('serviceFee', Number(e.target.value))}
                        className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold text-amber-600"
                      />
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
                Taxi Fare Calculator
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
                <span>Platform Service Fee:</span>
                <span>₱{calculatedTaxiFare.serviceFee.toFixed(2)}</span>
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
