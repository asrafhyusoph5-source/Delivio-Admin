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
import type { City, DeliveryRatesConfig, ServiceRates, OrderServiceType } from '../types';
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
  Sparkles
} from 'lucide-react';
import { ConfirmationModal } from '../components/common/ConfirmationModal';

const ALL_SERVICES: OrderServiceType[] = [
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

  // Selected Service sub-tab for rates config
  const [activeServiceTab, setActiveServiceTab] = useState<OrderServiceType>('food');

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

  // Fee Calculator States
  const [calcService, setCalcService] = useState<OrderServiceType>('food');
  const [calcDistance, setCalcDistance] = useState<number>(4.5);
  const [calcHour, setCalcHour] = useState<number>(12); // 0-23
  const [calcIsNight, setCalcIsNight] = useState<boolean>(false);
  const [calcIsPeak, setCalcIsPeak] = useState<boolean>(false);

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

  // Fetch Delivery Rates for active city
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
            riderCommissionPercent: dt.riderCommissionPercent ?? 80,
            surcharges: dt.surcharges || {
              peak: { enabled: false, multiplier: 1.2 },
              night: { enabled: false, flat: 25 }
            }
          });
        } else {
          // Provide default template
          setRatesConfig({
            id: activeCityId,
            food: { ...DEFAULT_SERVICE_RATES },
            convenience: { ...DEFAULT_SERVICE_RATES },
            parcel: { ...DEFAULT_SERVICE_RATES, baseFare: 40, perKm: 10 },
            pabili: { ...DEFAULT_SERVICE_RATES, baseFare: 60, serviceFee: 20 },
            request_rider: { ...DEFAULT_SERVICE_RATES, baseFare: 50 },
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

  // Update rates locally in state
  const updateServiceRateField = (
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

  // Save Rates to Firestore
  const handleSaveDeliveryRates = async () => {
    if (!ratesConfig || !activeCityId) return;
    try {
      setSavingRates(true);
      const rateRef = doc(db, 'deliveryRates', activeCityId);
      const payload = {
        ...ratesConfig,
        updatedAt: Timestamp.now()
      };

      await setDoc(rateRef, payload);

      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        action: 'UPDATE_DELIVERY_RATES',
        entityType: 'deliveryRates',
        entityId: activeCityId,
        details: `Saved delivery rates for city ${activeCityId}`
      });

      showSuccess('Delivery rates & surcharges saved.');
      setConfirmSaveRatesModal(false);
    } catch (err: any) {
      showError(err);
    } finally {
      setSavingRates(false);
    }
  };

  // Fee Calculator calculation
  const calculatedFee = useMemo(() => {
    if (!ratesConfig) return { baseFare: 0, distanceFee: 0, serviceFee: 0, surcharges: 0, totalDeliveryFee: 0, grandTotal: 0, riderCut: 0 };
    const rates = ratesConfig[calcService] || DEFAULT_SERVICE_RATES;

    const baseFare = Number(rates.baseFare) || 0;
    const includedKm = Number(rates.includedKm) || 0;
    const perKm = Number(rates.perKm) || 0;
    const serviceFee = Number(rates.serviceFee) || 0;

    const extraKm = Math.max(0, calcDistance - includedKm);
    const distanceFee = extraKm * perKm;
    let deliverySubtotal = baseFare + distanceFee;

    // Apply min/max
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
    const riderCommission = ratesConfig.riderCommissionPercent ?? 80;
    const riderCut = (totalDeliveryFee * riderCommission) / 100;

    return {
      baseFare,
      distanceFee,
      serviceFee,
      surcharges: surchargeTotal,
      totalDeliveryFee,
      grandTotal,
      riderCut
    };
  }, [ratesConfig, calcService, calcDistance, calcIsPeak, calcIsNight]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">
            Delivery Rates & Operational Cities
          </h1>
          <p className="text-sm text-gray-500 dark:text-zinc-400 mt-0.5">
            Configure base fares, distance tiers, rider commissions, and peak/night surcharges by city.
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

      {/* Main Grid: Rates Configuration & Live Fee Calculator */}
      {ratesConfig && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Rates Form */}
          <div className="lg:col-span-2 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-5 shadow-xs space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-100 dark:border-zinc-800 pb-4">
              <div>
                <h3 className="font-extrabold text-base text-gray-900 dark:text-white">
                  Rates for {cities.find((c) => c.id === activeCityId)?.name || activeCityId}
                </h3>
                <p className="text-xs text-gray-500">
                  Configure base fare, per km additions, and rider commission.
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
              {ALL_SERVICES.map((srv) => (
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
                  onChange={(e) => updateServiceRateField('baseFare', Number(e.target.value))}
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
                  onChange={(e) => updateServiceRateField('includedKm', Number(e.target.value))}
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
                  onChange={(e) => updateServiceRateField('perKm', Number(e.target.value))}
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
                  onChange={(e) => updateServiceRateField('minFee', Number(e.target.value))}
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
                  onChange={(e) => updateServiceRateField('maxFee', Number(e.target.value))}
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
                  onChange={(e) => updateServiceRateField('serviceFee', Number(e.target.value))}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold text-amber-600"
                />
              </div>
            </div>

            {/* Rider Commission & Surcharges Section */}
            <div className="pt-4 border-t border-gray-100 dark:border-zinc-800 space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-zinc-300 mb-1">
                  Rider Commission Share (% of delivery fee paid to rider)
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
                {/* Peak Hours Surcharge */}
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

                {/* Night Flat Surcharge */}
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

          {/* Fee Simulator / Calculator */}
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-5 shadow-xs space-y-5">
            <div className="flex items-center gap-2">
              <Calculator className="w-5 h-5 text-amber-500" />
              <h3 className="font-bold text-base text-gray-900 dark:text-white">
                Interactive Fee Simulator
              </h3>
            </div>

            <p className="text-xs text-gray-500 dark:text-zinc-400">
              Test fare calculation logic live with distance & surcharge inputs:
            </p>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block uppercase font-semibold text-gray-500 mb-1">Service</label>
                <select
                  value={calcService}
                  onChange={(e) => setCalcService(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white capitalize"
                >
                  {ALL_SERVICES.map((s) => (
                    <option key={s} value={s}>
                      {s.replace('_', ' ')}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block uppercase font-semibold text-gray-500 mb-1">
                  Trip Distance ({calcDistance} km)
                </label>
                <input
                  type="range"
                  min="0.5"
                  max="30"
                  step="0.5"
                  value={calcDistance}
                  onChange={(e) => setCalcDistance(Number(e.target.value))}
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
                <span>₱{calculatedFee.baseFare.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-amber-900 dark:text-amber-300">
                <span>Distance Fee:</span>
                <span>₱{calculatedFee.distanceFee.toFixed(2)}</span>
              </div>
              {calculatedFee.surcharges > 0 && (
                <div className="flex justify-between text-amber-900 dark:text-amber-300 font-bold">
                  <span>Surcharges:</span>
                  <span>+₱{calculatedFee.surcharges.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-amber-900 dark:text-amber-300">
                <span>Service Fee:</span>
                <span>₱{calculatedFee.serviceFee.toFixed(2)}</span>
              </div>
              <div className="pt-2 border-t border-amber-200 dark:border-amber-900 flex justify-between font-black text-sm text-gray-900 dark:text-white">
                <span>Customer Delivery Fee:</span>
                <span className="text-amber-600">₱{calculatedFee.grandTotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-bold text-emerald-600 text-xs pt-1">
                <span>Estimated Rider Payout ({ratesConfig.riderCommissionPercent}%):</span>
                <span>₱{calculatedFee.riderCut.toFixed(2)}</span>
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
          onConfirm={handleSaveDeliveryRates}
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
