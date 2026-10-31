import React, { useState, useEffect, useMemo } from 'react';
import {
  db,
  collection,
  getDocs,
  doc,
  getDoc,
  updateDoc,
  writeBatch,
  Timestamp
} from '../firebase';
import { useCity } from '../context/CityContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { logAuditEvent } from '../utils/audit';
import type { City, Merchant, Rider, OrderServiceType } from '../types';
import { SERVICES_BY_VEHICLE, type VehicleType } from '../constants';
import {
  Layers,
  MapPin,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Info,
  Loader2,
  RefreshCw,
  Search,
  Bell,
  ShieldAlert,
  Power,
  Store,
  Car,
  Utensils,
  ShoppingBag,
  Package,
  Bike
} from 'lucide-react';
import { ConfirmationModal } from '../components/common/ConfirmationModal';

export interface CityServiceConfig {
  id: OrderServiceType;
  label: string;
  description: string;
  merchantType?: 'food' | 'convenience';
  icon: React.ComponentType<{ className?: string }>;
}

export const CITY_SERVICES_LIST: CityServiceConfig[] = [
  {
    id: 'food',
    label: 'Food Delivery',
    description: 'Hot meals & restaurant ordering',
    merchantType: 'food',
    icon: Utensils
  },
  {
    id: 'convenience',
    label: 'Convenience',
    description: 'Groceries & daily essentials',
    merchantType: 'convenience',
    icon: ShoppingBag
  },
  {
    id: 'parcel',
    label: 'Parcel Express',
    description: 'Package pickup and delivery',
    icon: Package
  },
  {
    id: 'pabili',
    label: 'Pabili Service',
    description: 'Errand and buying assistance',
    icon: Bike
  },
  {
    id: 'taxi',
    label: 'Taxi Service',
    description: 'Passenger rides & hailing',
    icon: Car
  }
];

interface ImpactModalState {
  city: City;
  service: CityServiceConfig;
  targetValue: boolean; // true to turn ON, false to turn OFF
  affectedMerchants: Merchant[];
  affectedRiders: Rider[];
  loadingImpact: boolean;
}

interface CityServicesMatrixProps {
  filterCityId?: string; // If set, only renders for this specific city (for Rates & Fares tab)
}

export const CityServicesMatrix: React.FC<CityServicesMatrixProps> = ({ filterCityId }) => {
  const { cities, refreshCities } = useCity();
  const { adminProfile } = useAuth();
  const { showSuccess, showError } = useToast();

  const [platformServices, setPlatformServices] = useState<Record<string, boolean>>({
    food: true,
    convenience: true,
    parcel: true,
    pabili: true,
    taxi: true
  });
  const [loadingPlatform, setLoadingPlatform] = useState(true);

  // Search / city filter
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilterService, setActiveFilterService] = useState<string>('all');

  // Impact Preview & Confirmation Modal
  const [impactModal, setImpactModal] = useState<ImpactModalState | null>(null);
  const [reasonInput, setReasonInput] = useState('');
  const [notifyAffected, setNotifyAffected] = useState(true);
  const [submittingChange, setSubmittingChange] = useState(false);

  // Fetch platform-level switch states from settings/platform
  const fetchPlatformSettings = async () => {
    try {
      setLoadingPlatform(true);
      const platSnap = await getDoc(doc(db, 'settings', 'platform'));
      if (platSnap.exists()) {
        const dt = platSnap.data();
        if (dt.services) {
          setPlatformServices({
            food: dt.services.food !== false,
            convenience: dt.services.convenience !== false,
            parcel: dt.services.parcel !== false,
            pabili: dt.services.pabili !== false,
            taxi: dt.services.taxi !== false
          });
        }
      }
    } catch (err) {
      console.error('Failed to load platform services:', err);
    } finally {
      setLoadingPlatform(false);
    }
  };

  useEffect(() => {
    fetchPlatformSettings();
  }, []);

  // Filtered cities list
  const displayCities = useMemo(() => {
    let list = cities;
    if (filterCityId && filterCityId !== 'all') {
      list = list.filter((c) => c.id === filterCityId);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.province && c.province.toLowerCase().includes(q)) ||
          c.id.toLowerCase().includes(q)
      );
    }
    return list;
  }, [cities, filterCityId, searchQuery]);

  // Handle clicking a switch to toggle a service for a city
  const handleInitiateToggle = async (city: City, service: CityServiceConfig) => {
    const currentCityVal = city.services?.[service.id] !== false;
    const targetVal = !currentCityVal;

    setImpactModal({
      city,
      service,
      targetValue: targetVal,
      affectedMerchants: [],
      affectedRiders: [],
      loadingImpact: true
    });
    setReasonInput('');
    setNotifyAffected(true);

    try {
      // 1. Fetch active merchants in this city
      const merchantsSnap = await getDocs(collection(db, 'merchants'));
      const activeCityMerchants: Merchant[] = [];
      merchantsSnap.forEach((docSnap) => {
        const m = { id: docSnap.id, ...docSnap.data() } as Merchant;
        if (m.cityId === city.id && m.status === 'active') {
          // Check if this merchant's type matches the service
          if (service.merchantType && m.type === service.merchantType) {
            activeCityMerchants.push(m);
          }
        }
      });

      // 2. Fetch active drivers in this city
      const ridersSnap = await getDocs(collection(db, 'riders'));
      const activeCityRiders: Rider[] = [];
      ridersSnap.forEach((docSnap) => {
        const r = { id: docSnap.id, ...docSnap.data() } as Rider;
        if (r.cityId === city.id && r.status === 'active') {
          // Check if driver provides this service (allowed, active, or vehicle compatible)
          const hasAllowed = Array.isArray(r.allowedServices) && r.allowedServices.includes(service.id);
          const hasActive = Array.isArray(r.activeServices) && r.activeServices.includes(service.id);
          const vType = (r.vehicleType || 'motorcycle') as VehicleType;
          const vAllowed = SERVICES_BY_VEHICLE[vType] || [];
          const isVehicleCapable = vAllowed.includes(service.id);

          if (hasAllowed || hasActive || isVehicleCapable) {
            activeCityRiders.push(r);
          }
        }
      });

      setImpactModal((prev) =>
        prev
          ? {
              ...prev,
              affectedMerchants: activeCityMerchants,
              affectedRiders: activeCityRiders,
              loadingImpact: false
            }
          : null
      );
    } catch (err: any) {
      console.error('Failed to compute impact preview:', err);
      showError('Failed to fetch impact preview. You can still confirm the change.');
      setImpactModal((prev) => (prev ? { ...prev, loadingImpact: false } : null));
    }
  };

  // Confirm and commit the service switch
  const handleConfirmToggle = async () => {
    if (!impactModal) return;
    const { city, service, targetValue, affectedMerchants, affectedRiders } = impactModal;

    try {
      setSubmittingChange(true);

      // 1. Dotted-path update on cities/{id}.services.<service>
      const cityRef = doc(db, 'cities', city.id);
      const dottedPath = `services.${service.id}`;
      const now = Timestamp.now();
      const adminName = adminProfile?.name || adminProfile?.email || 'Administrator';

      await updateDoc(cityRef, {
        [dottedPath]: targetValue,
        servicesUpdatedAt: now,
        servicesUpdatedBy: adminName
      });

      // 2. If notifyAffected is checked, create inbox messages in batches of up to 400
      if (notifyAffected) {
        const batchSize = 400;
        let currentBatch = writeBatch(db);
        let opCount = 0;

        const actionText = targetValue ? 'resumed' : 'temporarily paused';
        const actionHeader = targetValue ? 'Service Restored' : 'Service Paused';

        // Notify Merchants
        for (const m of affectedMerchants) {
          const inboxRef = doc(collection(db, 'inbox'));
          currentBatch.set(inboxRef, {
            title: `${service.label} ${actionHeader} in ${city.name}`,
            body: targetValue
              ? `Great news! ${service.label} service is now active in ${city.name}. Your store can now receive customer orders.`
              : `Notice: ${service.label} service has been ${actionText} in ${city.name}.${reasonInput.trim() ? ` Reason: ${reasonInput.trim()}` : ''} Your store has been automatically set to offline for customer orders.`,
            category: 'update',
            imageUrl: null,
            link: null,
            audience: null,
            customerId: null,
            riderId: null,
            merchantId: m.id,
            merchantName: m.name,
            createdAt: now,
            createdBy: adminProfile?.uid || 'admin',
            createdByName: adminName
          });

          opCount++;
          if (opCount >= batchSize) {
            await currentBatch.commit();
            currentBatch = writeBatch(db);
            opCount = 0;
          }
        }

        // Notify Drivers
        for (const r of affectedRiders) {
          const inboxRef = doc(collection(db, 'inbox'));
          currentBatch.set(inboxRef, {
            title: `${service.label} ${actionHeader} in ${city.name}`,
            body: targetValue
              ? `${service.label} orders and trips are now open again in ${city.name}. You may now accept offers for this service.`
              : `Notice: ${service.label} service is currently ${actionText} in ${city.name}.${reasonInput.trim() ? ` Reason: ${reasonInput.trim()}` : ''} Dispatch offers for this service are temporarily locked.`,
            category: 'update',
            imageUrl: null,
            link: null,
            audience: null,
            customerId: null,
            riderId: r.id,
            merchantId: null,
            riderName: r.name,
            createdAt: now,
            createdBy: adminProfile?.uid || 'admin',
            createdByName: adminName
          });

          opCount++;
          if (opCount >= batchSize) {
            await currentBatch.commit();
            currentBatch = writeBatch(db);
            opCount = 0;
          }
        }

        if (opCount > 0) {
          await currentBatch.commit();
        }
      }

      // 3. Write audit log
      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminName,
        adminEmail: adminProfile?.email,
        action: targetValue ? 'ENABLE_CITY_SERVICE' : 'DISABLE_CITY_SERVICE',
        entityType: 'city',
        entityId: city.id,
        details: `${targetValue ? 'Enabled' : 'Disabled'} ${service.label} in ${city.name}. Impacted: ${affectedMerchants.length} shops, ${affectedRiders.length} drivers.${reasonInput.trim() ? ` Reason: ${reasonInput.trim()}` : ''}`,
        reason: reasonInput.trim() || undefined
      });

      // 4. Refresh context and close modal
      await refreshCities();
      showSuccess(
        `${service.label} is now ${targetValue ? 'ENABLED' : 'DISABLED'} for ${city.name}.`
      );
      setImpactModal(null);
    } catch (err: any) {
      showError(err);
    } finally {
      setSubmittingChange(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Controls Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px]">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search city or province..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-xl text-xs border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mr-1">
              Filter:
            </span>
            <button
              onClick={() => setActiveFilterService('all')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                activeFilterService === 'all'
                  ? 'bg-amber-400 text-black shadow-xs font-black'
                  : 'bg-gray-100 dark:bg-zinc-850 text-gray-600 dark:text-zinc-400 hover:bg-gray-200'
              }`}
            >
              All Services
            </button>
            {CITY_SERVICES_LIST.map((srv) => (
              <button
                key={srv.id}
                onClick={() => setActiveFilterService(srv.id)}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                  activeFilterService === srv.id
                    ? 'bg-amber-400 text-black shadow-xs font-black'
                    : 'bg-gray-100 dark:bg-zinc-850 text-gray-600 dark:text-zinc-400 hover:bg-gray-200'
                }`}
              >
                {srv.label}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={() => {
            fetchPlatformSettings();
            refreshCities();
          }}
          className="px-3 py-2 rounded-xl text-xs font-bold bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 text-gray-700 dark:text-zinc-300 hover:bg-gray-50 flex items-center gap-1.5 self-start sm:self-auto"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh Matrix</span>
        </button>
      </div>

      {/* Global Platform Legend Card */}
      <div className="bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/60 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs">
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <h4 className="font-extrabold text-amber-950 dark:text-amber-200">
              Two-Layer Service Governance
            </h4>
            <p className="text-amber-800/90 dark:text-amber-300/80 mt-0.5 leading-relaxed">
              A service is <strong>Operative (Effective ON)</strong> only when both the{' '}
              <strong className="underline">Global Platform Switch</strong> (Settings &gt; Platform) and the{' '}
              <strong className="underline">City Switch</strong> are enabled. Disabling a city switch automatically closes affected merchant shops and locks dispatch offers for drivers in that city.
            </p>
          </div>
        </div>

        {/* Global Platform Switches Overview */}
        <div className="flex items-center gap-2 flex-wrap bg-white dark:bg-zinc-900 p-2.5 rounded-xl border border-amber-200 dark:border-amber-900/50">
          <span className="text-[10px] font-black uppercase tracking-wider text-gray-400 mr-1">
            Global:
          </span>
          {CITY_SERVICES_LIST.map((srv) => {
            const isGlobalOn = platformServices[srv.id] !== false;
            return (
              <span
                key={srv.id}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold ${
                  isGlobalOn
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                    : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                }`}
                title={`Platform global switch for ${srv.label}: ${isGlobalOn ? 'Active' : 'Turned OFF'}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${isGlobalOn ? 'bg-emerald-500' : 'bg-red-500'}`} />
                {srv.label.split(' ')[0]}
              </span>
            );
          })}
        </div>
      </div>

      {/* Main City-by-Service Matrix Table */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-gray-50/80 dark:bg-zinc-850/80 border-b border-gray-200 dark:border-zinc-800 text-[11px] font-extrabold uppercase text-gray-500 dark:text-zinc-400">
                <th className="py-3.5 px-4 min-w-[200px]">Coverage City</th>
                {CITY_SERVICES_LIST.filter(
                  (s) => activeFilterService === 'all' || activeFilterService === s.id
                ).map((srv) => {
                  const SrvIcon = srv.icon;
                  const isGlobalOn = platformServices[srv.id] !== false;
                  return (
                    <th key={srv.id} className="py-3.5 px-4 min-w-[170px]">
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-1.5 text-gray-900 dark:text-white font-extrabold">
                          <SrvIcon className="w-4 h-4 text-amber-500" />
                          <span>{srv.label}</span>
                        </div>
                        <div className="flex items-center gap-1 text-[10px] font-normal normal-case">
                          <span className="text-gray-400">Global:</span>
                          <span
                            className={`font-bold ${
                              isGlobalOn ? 'text-emerald-600' : 'text-red-500'
                            }`}
                          >
                            {isGlobalOn ? 'ON' : 'OFF'}
                          </span>
                        </div>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
              {displayCities.length === 0 ? (
                <tr>
                  <td
                    colSpan={CITY_SERVICES_LIST.length + 1}
                    className="py-12 text-center text-gray-400 text-xs"
                  >
                    No cities matching criteria.
                  </td>
                </tr>
              ) : (
                displayCities.map((city) => {
                  const cityServices = city.services || {};

                  return (
                    <tr
                      key={city.id}
                      className="hover:bg-gray-50/60 dark:hover:bg-zinc-850/40 transition-colors"
                    >
                      {/* City Info */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-xl bg-amber-100 dark:bg-amber-950/60 flex items-center justify-center text-amber-700 dark:text-amber-400 shrink-0 font-bold">
                            <MapPin className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="font-extrabold text-gray-900 dark:text-white text-sm flex items-center gap-1.5">
                              <span>{city.name}</span>
                              <span
                                className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                                  city.status === 'active'
                                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                    : 'bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-zinc-400'
                                }`}
                              >
                                {city.status}
                              </span>
                            </div>
                            <p className="text-[11px] text-gray-400">
                              {city.province ? `${city.province} • ` : ''}Radius: {city.radiusKm} km
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* Service Switches for this City */}
                      {CITY_SERVICES_LIST.filter(
                        (s) => activeFilterService === 'all' || activeFilterService === s.id
                      ).map((srv) => {
                        const isGlobalOn = platformServices[srv.id] !== false;
                        const isCityOn = cityServices[srv.id] !== false;
                        const isEffectiveOn = isGlobalOn && isCityOn;

                        return (
                          <td key={srv.id} className="py-3.5 px-4 align-middle">
                            <div className="flex flex-col gap-2">
                              {/* Switch Toggle */}
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[11px] font-bold text-gray-500 dark:text-zinc-400">
                                  City Switch:
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleInitiateToggle(city, srv)}
                                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 ${
                                    isCityOn ? 'bg-amber-500' : 'bg-gray-300 dark:bg-zinc-700'
                                  }`}
                                  role="switch"
                                  aria-checked={isCityOn}
                                  title={`Click to turn ${isCityOn ? 'OFF' : 'ON'} ${srv.label} in ${city.name}`}
                                >
                                  <span
                                    aria-hidden="true"
                                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                                      isCityOn ? 'translate-x-5' : 'translate-x-0'
                                    }`}
                                  />
                                </button>
                              </div>

                              {/* Effective Status Badge */}
                              <div className="flex items-center justify-between text-[11px]">
                                <span className="text-gray-400">Effective:</span>
                                <span
                                  className={`inline-flex items-center gap-1 font-extrabold px-2 py-0.5 rounded-full text-[10px] ${
                                    isEffectiveOn
                                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300'
                                      : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300 border border-red-300'
                                  }`}
                                >
                                  <span
                                    className={`w-1.5 h-1.5 rounded-full ${
                                      isEffectiveOn ? 'bg-emerald-500' : 'bg-red-500'
                                    }`}
                                  />
                                  <span>{isEffectiveOn ? 'ACTIVE' : 'OFF'}</span>
                                  {!isGlobalOn && (
                                    <span className="text-[9px] font-normal opacity-80">
                                      (Global off)
                                    </span>
                                  )}
                                </span>
                              </div>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Impact Preview & Confirmation Modal */}
      {impactModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-gray-200 dark:border-zinc-800 space-y-5 animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div
                  className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${
                    impactModal.targetValue
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                      : 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
                  }`}
                >
                  <Power className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-extrabold text-lg text-gray-900 dark:text-white">
                    {impactModal.targetValue ? 'Enable' : 'Disable'} {impactModal.service.label}?
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-zinc-400">
                    Target City: <strong>{impactModal.city.name}</strong>
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => !submittingChange && setImpactModal(null)}
                className="p-1.5 text-gray-400 hover:text-gray-600 rounded-xl"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            {/* Impact Preview Section */}
            <div className="bg-gray-50 dark:bg-zinc-850/60 rounded-2xl p-4 border border-gray-200 dark:border-zinc-800 space-y-3">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-gray-400 block">
                Impact Preview & Fleet Calculation
              </span>

              {impactModal.loadingImpact ? (
                <div className="py-6 flex flex-col items-center justify-center gap-2 text-gray-400 text-xs">
                  <Loader2 className="w-6 h-6 animate-spin text-amber-500" />
                  <span>Scanning active merchants and drivers in {impactModal.city.name}...</span>
                </div>
              ) : (
                <div className="space-y-2.5 text-xs">
                  {/* Merchants impacted */}
                  <div className="flex items-center justify-between p-2.5 rounded-xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800">
                    <div className="flex items-center gap-2">
                      <Store className="w-4 h-4 text-amber-500" />
                      <div>
                        <span className="font-bold text-gray-900 dark:text-white">
                          Partner Merchant Stores
                        </span>
                        <p className="text-[11px] text-gray-500">
                          {impactModal.service.merchantType
                            ? `Active ${impactModal.service.merchantType} stores in city`
                            : 'N/A for transport/errand services'}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`text-sm font-extrabold px-2.5 py-0.5 rounded-full ${
                        impactModal.affectedMerchants.length > 0
                          ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300'
                          : 'bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-zinc-400'
                      }`}
                    >
                      {impactModal.affectedMerchants.length} {impactModal.targetValue ? 'to restore' : 'will be closed'}
                    </span>
                  </div>

                  {/* Drivers impacted */}
                  <div className="flex items-center justify-between p-2.5 rounded-xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800">
                    <div className="flex items-center gap-2">
                      <Car className="w-4 h-4 text-blue-500" />
                      <div>
                        <span className="font-bold text-gray-900 dark:text-white">
                          Active Driver Fleet
                        </span>
                        <p className="text-[11px] text-gray-500">
                          Drivers authorized or equipped for {impactModal.service.label}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`text-sm font-extrabold px-2.5 py-0.5 rounded-full ${
                        impactModal.affectedRiders.length > 0
                          ? 'bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-300'
                          : 'bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-zinc-400'
                      }`}
                    >
                      {impactModal.affectedRiders.length} {impactModal.targetValue ? 'to restore' : 'will be locked'}
                    </span>
                  </div>

                  {!impactModal.targetValue && (
                    <div className="p-2.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 flex items-start gap-2 text-[11px] text-red-800 dark:text-red-300">
                      <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                      <span>
                        Turning off this switch immediately marks affected merchants as closed in customer feeds and stops order dispatches in <strong>{impactModal.city.name}</strong>. Turning it back on restores everything.
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Optional Reason Input */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-gray-700 dark:text-zinc-300">
                Reason / Internal Memo <span className="font-normal text-gray-400">(optional)</span>
              </label>
              <input
                type="text"
                placeholder="e.g. Typhoon warning, temporary depot closure, local holiday"
                value={reasonInput}
                onChange={(e) => setReasonInput(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            {/* Notification Checkbox */}
            <div className="p-3 rounded-xl bg-gray-50 dark:bg-zinc-850/60 border border-gray-200 dark:border-zinc-800 flex items-start gap-2.5">
              <input
                type="checkbox"
                id="notifyAffectedCheck"
                checked={notifyAffected}
                onChange={(e) => setNotifyAffected(e.target.checked)}
                className="w-4 h-4 rounded-md accent-amber-500 mt-0.5 cursor-pointer"
              />
              <label htmlFor="notifyAffectedCheck" className="text-xs cursor-pointer">
                <span className="font-bold text-gray-900 dark:text-white flex items-center gap-1.5">
                  <Bell className="w-3.5 h-3.5 text-amber-500" />
                  Notify affected merchants and drivers
                </span>
                <span className="text-[11px] text-gray-500 dark:text-zinc-400 block mt-0.5">
                  Writes targeted inbox notifications in batches of up to 400.
                </span>
              </label>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setImpactModal(null)}
                disabled={submittingChange}
                className="px-4 py-2.5 rounded-xl text-xs font-bold text-gray-600 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleConfirmToggle}
                disabled={submittingChange || impactModal.loadingImpact}
                className={`px-5 py-2.5 rounded-xl text-xs font-extrabold flex items-center gap-2 shadow-sm transition-all ${
                  impactModal.targetValue
                    ? 'bg-emerald-500 hover:bg-emerald-600 text-white'
                    : 'bg-red-500 hover:bg-red-600 text-white'
                }`}
              >
                {submittingChange ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Saving Changes...</span>
                  </>
                ) : (
                  <>
                    <Power className="w-4 h-4" />
                    <span>
                      Confirm {impactModal.targetValue ? 'Enable' : 'Disable'}
                    </span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export const ServicesByCity: React.FC = () => {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight flex items-center gap-2.5">
          <Layers className="w-7 h-7 text-amber-500" />
          <span>Services by City</span>
        </h1>
        <p className="text-sm text-gray-500 dark:text-zinc-400 mt-1">
          City-by-service operational matrix for Food, Convenience, Parcel Express, Pabili, and Taxi hailing.
        </p>
      </div>

      <CityServicesMatrix />
    </div>
  );
};
