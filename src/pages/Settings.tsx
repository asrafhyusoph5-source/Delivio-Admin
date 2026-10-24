import React, { useState, useEffect } from 'react';
import {
  db,
  doc,
  getDoc,
  setDoc,
  getDocs,
  collection,
  writeBatch,
  Timestamp,
  deleteDoc
} from '../firebase';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useCity } from '../context/CityContext';
import { logAuditEvent } from '../utils/audit';
import type { PlatformSettings, OrderServiceType } from '../types';
import {
  VEHICLE_TYPES,
  SERVICES_BY_VEHICLE,
  DEFAULT_TAXI_RATES,
  type VehicleType
} from '../constants';
import {
  Settings as SettingsIcon,
  Shield,
  Phone,
  Mail,
  AlertTriangle,
  Database,
  CheckCircle2,
  Save,
  Loader2,
  Sparkles,
  Server,
  Search,
  Trash2,
  User,
  Wallet,
  BookOpen,
  Copy,
  Check,
  Car,
  ToggleLeft,
  ToggleRight,
  ArrowRight,
  RefreshCw,
  SlidersHorizontal,
  Layers
} from 'lucide-react';
import { ConfirmationModal } from '../components/common/ConfirmationModal';

interface MigrationPreviewData {
  totalRiders: number;
  ridersNeedingVehicleType: number;
  ridersNeedingTaxi: number;
  ridersNeedingTrimming: number;
  needsPlatformServices: boolean;
  needsPlatformTaxiVehicles: boolean;
  ratesDocsToUpdate: string[];
}

export const Settings: React.FC = () => {
  const { adminProfile } = useAuth();
  const { showSuccess, showError } = useToast();
  const { refreshCities } = useCity();

  const [platformName, setPlatformName] = useState('Delivio');
  const [supportPhone, setSupportPhone] = useState('+63 917 123 4567');
  const [supportEmail, setSupportEmail] = useState('support@delivio.ph');
  const [maintenance, setMaintenance] = useState(false);
  const [defaultCommissionRate, setDefaultCommissionRate] = useState<number>(15);
  const [savingSettings, setSavingSettings] = useState(false);
  const [loading, setLoading] = useState(true);

  // Platform Service Switches
  const [platformServices, setPlatformServices] = useState<Record<OrderServiceType, boolean>>({
    food: true,
    convenience: true,
    parcel: true,
    pabili: true,
    request_rider: true,
    taxi: true
  });

  const [platformTaxiVehicles, setPlatformTaxiVehicles] = useState<Record<VehicleType, boolean>>({
    motorcycle: true,
    tricycle: true,
    car4: true,
    car8: true
  });

  // Initialize DB state
  const [initDbModalOpen, setInitDbModalOpen] = useState(false);
  const [initializingDb, setInitializingDb] = useState(false);
  const [initSummary, setInitSummary] = useState<string[]>([]);

  // Migration to Drivers & Taxi state
  const [migrationPreviewOpen, setMigrationPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [migrationRunning, setMigrationRunning] = useState(false);
  const [migrationPreview, setMigrationPreview] = useState<MigrationPreviewData | null>(null);
  const [migrationSummary, setMigrationSummary] = useState<string[]>([]);

  // Wallet Directory Tool state
  const [directorySearchInput, setDirectorySearchInput] = useState('');
  const [searchingDirectory, setSearchingDirectory] = useState(false);
  const [directoryEntry, setDirectoryEntry] = useState<{
    id: string;
    uid: string;
    name?: string;
    email?: string;
    phone?: string;
    role?: string;
    status?: string;
    updatedAt?: any;
    userData?: any;
  } | null>(null);
  const [directorySearchedId, setDirectorySearchedId] = useState<string | null>(null);
  const [directoryNotFound, setDirectoryNotFound] = useState(false);
  const [deleteDirectoryModalOpen, setDeleteDirectoryModalOpen] = useState(false);
  const [deletingDirectoryEntry, setDeletingDirectoryEntry] = useState(false);
  const [copiedDocId, setCopiedDocId] = useState(false);

  // Helper to derive document ID ("email_{email}" and "phone_63XXXXXXXXXX")
  const deriveDirectoryDocId = (input: string): string => {
    const raw = input.trim();
    if (raw.startsWith('email_') || raw.startsWith('phone_')) {
      return raw;
    }
    if (raw.includes('@')) {
      return `email_${raw.toLowerCase()}`;
    }
    const digits = raw.replace(/\D/g, '');
    if (digits.startsWith('63') && digits.length === 12) {
      return `phone_${digits}`;
    }
    if (digits.startsWith('09') && digits.length === 11) {
      return `phone_63${digits.slice(1)}`;
    }
    if (digits.startsWith('9') && digits.length === 10) {
      return `phone_63${digits}`;
    }
    return `phone_${digits || raw}`;
  };

  const handleSearchDirectory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!directorySearchInput.trim()) {
      showError('Please enter an exact email or phone number to look up.');
      return;
    }

    try {
      setSearchingDirectory(true);
      setDirectoryEntry(null);
      setDirectoryNotFound(false);

      const docId = deriveDirectoryDocId(directorySearchInput);
      setDirectorySearchedId(docId);

      let docRef = doc(db, 'walletDirectory', docId);
      let snap = await getDoc(docRef);

      if (!snap.exists() && docId.startsWith('phone_')) {
        const rawDigits = directorySearchInput.replace(/\D/g, '');
        if (rawDigits && `phone_${rawDigits}` !== docId) {
          const altRef = doc(db, 'walletDirectory', `phone_${rawDigits}`);
          const altSnap = await getDoc(altRef);
          if (altSnap.exists()) {
            docRef = altRef;
            snap = altSnap;
            setDirectorySearchedId(`phone_${rawDigits}`);
          }
        }
      }

      if (snap.exists()) {
        const dt = snap.data();
        const ownerUid = dt.uid || dt.ownerUid || dt.userId || '';

        let userData = null;
        if (ownerUid) {
          try {
            const userSnap = await getDoc(doc(db, 'users', ownerUid));
            if (userSnap.exists()) {
              userData = userSnap.data();
            }
          } catch (e) {
            console.error('Failed to load owner user profile:', e);
          }
        }

        setDirectoryEntry({
          id: snap.id,
          uid: ownerUid,
          name: dt.name || userData?.name,
          email: dt.email || userData?.email,
          phone: dt.phone || userData?.phone,
          role: dt.role || userData?.role,
          status: dt.status || userData?.status,
          updatedAt: dt.updatedAt || dt.createdAt,
          userData
        });
      } else {
        setDirectoryNotFound(true);
      }
    } catch (err: any) {
      showError(err);
    } finally {
      setSearchingDirectory(false);
    }
  };

  const handleDeleteDirectoryEntry = async (reason?: string) => {
    if (!directoryEntry) return;
    try {
      setDeletingDirectoryEntry(true);
      const targetDocId = directoryEntry.id;
      await deleteDoc(doc(db, 'walletDirectory', targetDocId));

      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        adminEmail: adminProfile?.email,
        action: 'DELETE_WALLET_DIRECTORY_ENTRY',
        entityType: 'walletDirectory',
        entityId: targetDocId,
        details: `Deleted wallet directory entry ${targetDocId} (Owner: ${directoryEntry.uid || 'N/A'}). Reason: ${reason || 'Manual deletion'}`,
        oldValue: directoryEntry,
        reason: reason
      });

      showSuccess(`Wallet directory entry "${targetDocId}" successfully deleted.`);
      setDirectoryEntry(null);
      setDirectorySearchedId(null);
      setDeleteDirectoryModalOpen(false);
    } catch (err: any) {
      showError(err);
    } finally {
      setDeletingDirectoryEntry(false);
    }
  };

  // Fetch settings/platform
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        setLoading(true);
        const sRef = doc(db, 'settings', 'platform');
        const snap = await getDoc(sRef);
        if (snap.exists()) {
          const dt = snap.data();
          setPlatformName(dt.platformName || 'Delivio');
          setSupportPhone(dt.supportPhone || '+63 917 123 4567');
          setSupportEmail(dt.supportEmail || 'support@delivio.ph');
          setMaintenance(Boolean(dt.maintenance));
          setDefaultCommissionRate(dt.defaultCommissionRate ?? 15);

          // Platform services
          if (dt.services) {
            setPlatformServices({
              food: dt.services.food !== false,
              convenience: dt.services.convenience !== false,
              parcel: dt.services.parcel !== false,
              pabili: dt.services.pabili !== false,
              request_rider: dt.services.request_rider !== false,
              taxi: dt.services.taxi !== false
            });
          }

          // Platform taxi vehicles
          if (dt.taxiVehicles) {
            setPlatformTaxiVehicles({
              motorcycle: dt.taxiVehicles.motorcycle !== false,
              tricycle: dt.taxiVehicles.tricycle !== false,
              car4: dt.taxiVehicles.car4 !== false,
              car8: dt.taxiVehicles.car8 !== false
            });
          }
        }
      } catch (err) {
        showError(err);
      } finally {
        setLoading(false);
      }
    };

    fetchSettings();
  }, []);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSavingSettings(true);
      const sRef = doc(db, 'settings', 'platform');
      const payload = {
        platformName: platformName.trim(),
        supportPhone: supportPhone.trim(),
        supportEmail: supportEmail.trim(),
        maintenance,
        defaultCommissionRate: Number(defaultCommissionRate),
        services: platformServices,
        taxiVehicles: platformTaxiVehicles,
        updatedAt: Timestamp.now()
      };

      await setDoc(sRef, payload, { merge: true });

      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        action: 'UPDATE_PLATFORM_SETTINGS',
        entityType: 'settings',
        entityId: 'platform',
        details: `Saved platform settings. Maintenance: ${maintenance ? 'ON' : 'OFF'}. Taxi active: ${platformServices.taxi}`
      });

      showSuccess('Platform settings & service switches updated successfully.');
    } catch (err: any) {
      showError(err);
    } finally {
      setSavingSettings(false);
    }
  };

  // Toggle single platform service
  const togglePlatformService = (svc: OrderServiceType) => {
    setPlatformServices((prev) => ({
      ...prev,
      [svc]: !prev[svc]
    }));
  };

  // Toggle taxi vehicle type
  const toggleTaxiVehicle = (vt: VehicleType) => {
    setPlatformTaxiVehicles((prev) => ({
      ...prev,
      [vt]: !prev[vt]
    }));
  };

  // 1. Prepare Migration Preview
  const handleOpenMigrationPreview = async () => {
    try {
      setPreviewLoading(true);

      // Check drivers (riders collection)
      const ridersSnap = await getDocs(collection(db, 'riders'));
      let ridersNeedingVehicleType = 0;
      let ridersNeedingTaxi = 0;
      let ridersNeedingTrimming = 0;

      const validVehicles = ['motorcycle', 'tricycle', 'car4', 'car8'];

      ridersSnap.forEach((d) => {
        const dt = d.data();
        const vtype = dt.vehicleType;
        if (!vtype || !validVehicles.includes(vtype)) {
          ridersNeedingVehicleType++;
        }
        const effectiveVType: VehicleType = (vtype && validVehicles.includes(vtype)) ? vtype : 'motorcycle';
        const allowed = dt.allowedServices || [];
        const active = dt.activeServices || [];

        if (!allowed.includes('taxi') || !active.includes('taxi')) {
          ridersNeedingTaxi++;
        }

        const validServices = SERVICES_BY_VEHICLE[effectiveVType];
        const hasInvalidAllowed = allowed.some((s: string) => !validServices.includes(s as OrderServiceType));
        const hasInvalidActive = active.some((s: string) => !validServices.includes(s as OrderServiceType));
        if (effectiveVType !== 'motorcycle' && (hasInvalidAllowed || hasInvalidActive)) {
          ridersNeedingTrimming++;
        }
      });

      // Check settings/platform
      const sRef = doc(db, 'settings', 'platform');
      const sSnap = await getDoc(sRef);
      const sData = sSnap.exists() ? sSnap.data() : {};
      const needsPlatformServices = !sData.services;
      const needsPlatformTaxiVehicles = !sData.taxiVehicles;

      // Check deliveryRates documents
      const ratesSnap = await getDocs(collection(db, 'deliveryRates'));
      const ratesDocsToUpdate: string[] = [];
      ratesSnap.forEach((d) => {
        const rData = d.data();
        if (!rData.rideRates) {
          ratesDocsToUpdate.push(d.id);
        }
      });

      setMigrationPreview({
        totalRiders: ridersSnap.size,
        ridersNeedingVehicleType,
        ridersNeedingTaxi,
        ridersNeedingTrimming,
        needsPlatformServices,
        needsPlatformTaxiVehicles,
        ratesDocsToUpdate
      });

      setMigrationPreviewOpen(true);
    } catch (err: any) {
      showError(err);
    } finally {
      setPreviewLoading(false);
    }
  };

  // 2. Execute Migration: Safe to Repeat
  const handleExecuteMigration = async () => {
    try {
      setMigrationRunning(true);
      const summary: string[] = [];
      const validVehicles: VehicleType[] = ['motorcycle', 'tricycle', 'car4', 'car8'];

      // A. Migrate riders collection
      const ridersSnap = await getDocs(collection(db, 'riders'));
      let updatedRidersCount = 0;

      for (const d of ridersSnap.docs) {
        const dt = d.data();
        let vType: VehicleType = dt.vehicleType;
        if (!vType || !validVehicles.includes(vType)) {
          vType = 'motorcycle';
        }

        const allowedSet = new Set<string>(dt.allowedServices || []);
        const activeSet = new Set<string>(dt.activeServices || []);

        // Add taxi to allowed and active services
        allowedSet.add('taxi');
        activeSet.add('taxi');

        // For non-motorcycles, keep only services valid for the vehicle
        const validServices = SERVICES_BY_VEHICLE[vType];
        const finalAllowed = Array.from(allowedSet).filter((s) =>
          validServices.includes(s as OrderServiceType)
        );
        const finalActive = Array.from(activeSet).filter((s) =>
          validServices.includes(s as OrderServiceType)
        );

        await setDoc(
          doc(db, 'riders', d.id),
          {
            vehicleType: vType,
            allowedServices: finalAllowed,
            activeServices: finalActive,
            updatedAt: Timestamp.now()
          },
          { merge: true }
        );
        updatedRidersCount++;
      }
      summary.push(`Verified & updated ${updatedRidersCount} driver profile(s) with vehicle types and Taxi service.`);

      // B. Create settings/platform.services and settings/platform.taxiVehicles with every value true if missing (merge)
      const sRef = doc(db, 'settings', 'platform');
      const sSnap = await getDoc(sRef);
      const existingData = sSnap.exists() ? sSnap.data() : {};

      const mergedServices = {
        food: existingData.services?.food ?? true,
        convenience: existingData.services?.convenience ?? true,
        parcel: existingData.services?.parcel ?? true,
        pabili: existingData.services?.pabili ?? true,
        request_rider: existingData.services?.request_rider ?? true,
        taxi: existingData.services?.taxi ?? true
      };

      const mergedTaxiVehicles = {
        motorcycle: existingData.taxiVehicles?.motorcycle ?? true,
        tricycle: existingData.taxiVehicles?.tricycle ?? true,
        car4: existingData.taxiVehicles?.car4 ?? true,
        car8: existingData.taxiVehicles?.car8 ?? true
      };

      await setDoc(
        sRef,
        {
          services: mergedServices,
          taxiVehicles: mergedTaxiVehicles,
          updatedAt: Timestamp.now()
        },
        { merge: true }
      );
      setPlatformServices(mergedServices);
      setPlatformTaxiVehicles(mergedTaxiVehicles);
      summary.push('Configured settings/platform.services and taxiVehicles.');

      // C. For each deliveryRates document, add rideRates if missing with required test values
      const ratesSnap = await getDocs(collection(db, 'deliveryRates'));
      let ratesUpdated = 0;

      if (ratesSnap.empty) {
        // If empty, create puerto-princesa
        const ppRateRef = doc(db, 'deliveryRates', 'puerto-princesa');
        await setDoc(
          ppRateRef,
          {
            id: 'puerto-princesa',
            rideRates: DEFAULT_TAXI_RATES,
            createdAt: Timestamp.now()
          },
          { merge: true }
        );
        ratesUpdated++;
      } else {
        for (const rDoc of ratesSnap.docs) {
          const rData = rDoc.data();
          if (!rData.rideRates) {
            await setDoc(
              doc(db, 'deliveryRates', rDoc.id),
              {
                rideRates: DEFAULT_TAXI_RATES,
                updatedAt: Timestamp.now()
              },
              { merge: true }
            );
            ratesUpdated++;
          }
        }
      }
      summary.push(`Verified ${ratesSnap.size || 1} city rate documents (${ratesUpdated} backfilled with default Taxi rideRates).`);

      // D. Write an auditLogs entry
      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        adminEmail: adminProfile?.email,
        action: 'MIGRATE_DRIVERS_AND_TAXI',
        entityType: 'system',
        entityId: 'migration_drivers_taxi',
        details: `Ran migration to Drivers & Taxi: Updated ${updatedRidersCount} drivers, merged platform service switches, updated ${ratesUpdated} deliveryRates doc(s).`
      });

      setMigrationSummary(summary);
      setMigrationPreviewOpen(false);
      showSuccess('Migration to Drivers & Taxi completed successfully.');
    } catch (err: any) {
      showError(err);
    } finally {
      setMigrationRunning(false);
    }
  };

  // Initialize Database:
  const handleInitializeDatabase = async () => {
    try {
      setInitializingDb(true);
      const summary: string[] = [];

      // 1. Check cities collection
      const citiesSnap = await getDocs(collection(db, 'cities'));
      if (citiesSnap.empty) {
        const ppCityRef = doc(db, 'cities', 'puerto-princesa');
        await setDoc(ppCityRef, {
          name: 'Puerto Princesa',
          province: 'Palawan',
          status: 'active',
          center: { lat: 9.7392, lng: 118.7353 },
          radiusKm: 15,
          createdAt: Timestamp.now()
        });
        summary.push('Created cities/puerto-princesa');
      } else {
        summary.push('cities collection is already populated (skipped)');
      }

      // 2. Check deliveryRates
      const ratesSnap = await getDocs(collection(db, 'deliveryRates'));
      if (ratesSnap.empty) {
        const ppRateRef = doc(db, 'deliveryRates', 'puerto-princesa');
        const defaultServiceRates = {
          baseFare: 45,
          includedKm: 2,
          perKm: 12,
          minFee: 45,
          maxFee: 350,
          serviceFee: 10
        };
        await setDoc(ppRateRef, {
          id: 'puerto-princesa',
          food: { ...defaultServiceRates },
          convenience: { ...defaultServiceRates },
          parcel: { ...defaultServiceRates, baseFare: 40, perKm: 10 },
          pabili: { ...defaultServiceRates, baseFare: 60, serviceFee: 20 },
          request_rider: { ...defaultServiceRates, baseFare: 50 },
          rideRates: DEFAULT_TAXI_RATES,
          riderCommissionPercent: 80,
          surcharges: {
            peak: { enabled: false, multiplier: 1.2 },
            night: { enabled: false, flat: 25 }
          },
          createdAt: Timestamp.now()
        });
        summary.push('Created deliveryRates/puerto-princesa with delivery & taxi rates');
      } else {
        summary.push('deliveryRates collection is already populated (skipped)');
      }

      // 3. Check tierConfig
      const tcSnap = await getDocs(collection(db, 'tierConfig'));
      if (tcSnap.empty) {
        const batch = writeBatch(db);
        const tiers = [
          { id: 'bronze', name: 'Bronze', ridesRequired: 500, coins: 200, sortOrder: 1 },
          { id: 'silver', name: 'Silver', ridesRequired: 650, coins: 500, sortOrder: 2 },
          { id: 'gold', name: 'Gold', ridesRequired: 850, coins: 700, sortOrder: 3 },
          { id: 'platinum', name: 'Platinum', ridesRequired: 1000, coins: 1000, sortOrder: 4 }
        ];
        tiers.forEach((t) => {
          batch.set(doc(db, 'tierConfig', t.id), t);
        });
        await batch.commit();
        summary.push('Created tierConfig documents (bronze, silver, gold, platinum)');
      } else {
        summary.push('tierConfig collection is already populated (skipped)');
      }

      // 4. settings/platform
      const sRef = doc(db, 'settings', 'platform');
      const sSnap = await getDoc(sRef);
      if (!sSnap.exists()) {
        await setDoc(sRef, {
          platformName: 'Delivio',
          supportPhone: '+63 917 123 4567',
          supportEmail: 'support@delivio.ph',
          maintenance: false,
          defaultCommissionRate: 15,
          services: {
            food: true,
            convenience: true,
            parcel: true,
            pabili: true,
            request_rider: true,
            taxi: true
          },
          taxiVehicles: {
            motorcycle: true,
            tricycle: true,
            car4: true,
            car8: true
          },
          createdAt: Timestamp.now()
        });
        summary.push('Created settings/platform with all services active');
      } else {
        summary.push('settings/platform already exists (skipped)');
      }

      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        action: 'INITIALIZE_DATABASE',
        entityType: 'system',
        entityId: 'init',
        details: summary.join('; ')
      });

      setInitSummary(summary);
      showSuccess('Database initialization completed.');
      await refreshCities();
    } catch (err: any) {
      showError(err);
    } finally {
      setInitializingDb(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">
          Platform System Settings
        </h1>
        <p className="text-sm text-gray-500 dark:text-zinc-400 mt-0.5">
          General platform properties, service switches, taxi vehicle toggles, migration tools, and database maintenance.
        </p>
      </div>

      {/* Main Settings Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Settings Form */}
        <div className="lg:col-span-2 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-6 shadow-xs space-y-6">
          <div className="flex items-center gap-2 pb-3 border-b border-gray-100 dark:border-zinc-800">
            <SettingsIcon className="w-5 h-5 text-amber-500" />
            <h3 className="font-extrabold text-base text-gray-900 dark:text-white">
              Platform Configuration
            </h3>
          </div>

          <form onSubmit={handleSaveSettings} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Platform Name
                </label>
                <input
                  type="text"
                  value={platformName}
                  onChange={(e) => setPlatformName(e.target.value)}
                  required
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-gray-900 dark:text-white font-bold"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Default Merchant Commission (%)
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={defaultCommissionRate}
                  onChange={(e) => setDefaultCommissionRate(Number(e.target.value))}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-amber-600 font-bold"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Support Phone Hotline
                </label>
                <input
                  type="text"
                  value={supportPhone}
                  onChange={(e) => setSupportPhone(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Support Email
                </label>
                <input
                  type="email"
                  value={supportEmail}
                  onChange={(e) => setSupportEmail(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-gray-900 dark:text-white"
                />
              </div>
            </div>

            {/* Maintenance Mode Toggle */}
            <div className="p-4 rounded-2xl border border-gray-200 dark:border-zinc-800 bg-gray-50/70 dark:bg-zinc-850 flex items-center justify-between">
              <div>
                <span className="font-bold text-xs text-gray-900 dark:text-white block">
                  System Maintenance Mode
                </span>
                <p className="text-[11px] text-gray-500 max-w-md">
                  When enabled, mobile client apps (Delivio, Delivio Partner, Delivio Driver) will display a maintenance advisory screen and disable new orders.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setMaintenance(!maintenance)}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
                  maintenance
                    ? 'bg-red-600 text-white'
                    : 'bg-gray-200 text-gray-700 dark:bg-zinc-700 dark:text-zinc-200'
                }`}
              >
                {maintenance ? 'Maintenance ACTIVE' : 'Operational (Normal)'}
              </button>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={savingSettings}
                className="delivio-btn-yellow px-6 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 shadow-xs"
              >
                {savingSettings && <Loader2 className="w-4 h-4 animate-spin" />}
                <Save className="w-4 h-4" /> Save Platform Settings
              </button>
            </div>
          </form>
        </div>

        {/* Database Initialization Panel */}
        <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-6 shadow-xs space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-gray-100 dark:border-zinc-800">
            <Database className="w-5 h-5 text-amber-500" />
            <h3 className="font-extrabold text-base text-gray-900 dark:text-white">
              Database Seeder
            </h3>
          </div>

          <p className="text-xs text-gray-500 leading-relaxed">
            Checks if platform collections are empty and safely creates default initial documents without overwriting existing data:
          </p>

          <ul className="text-xs text-gray-600 dark:text-zinc-300 space-y-1.5 list-disc pl-4 font-mono">
            <li>cities/puerto-princesa</li>
            <li>deliveryRates/puerto-princesa (with rideRates)</li>
            <li>tierConfig (bronze, silver, gold, platinum)</li>
            <li>settings/platform</li>
          </ul>

          <button
            onClick={() => setInitDbModalOpen(true)}
            className="w-full delivio-btn-yellow py-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-md shadow-amber-400/20"
          >
            <Sparkles className="w-4 h-4" /> Initialize Database
          </button>

          {initSummary.length > 0 && (
            <div className="p-3.5 rounded-2xl bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-800 text-[11px] space-y-1">
              <span className="font-bold text-gray-700 dark:text-zinc-300 block mb-1">
                Last Run Result:
              </span>
              {initSummary.map((item, idx) => (
                <div key={idx} className="flex items-start gap-1.5 text-gray-600 dark:text-zinc-400">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Service Types & Platform Switches Panel */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-6 shadow-xs space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-gray-100 dark:border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-400 text-black">
              <SlidersHorizontal className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-base text-gray-900 dark:text-white">
                Platform Service Switches & Taxi Vehicles
              </h3>
              <p className="text-xs text-gray-500 dark:text-zinc-400">
                Turn core delivery and ride-hailing services on/off platform-wide. Saved in <code className="font-mono text-amber-600">settings/platform.services</code> and <code className="font-mono text-amber-600">settings/platform.taxiVehicles</code>.
              </p>
            </div>
          </div>

          <button
            onClick={handleSaveSettings}
            disabled={savingSettings}
            className="delivio-btn-yellow px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 self-start sm:self-auto"
          >
            <Save className="w-4 h-4" /> Save Service Switches
          </button>
        </div>

        {/* 1. Core Services Toggles */}
        <div>
          <h4 className="text-xs font-extrabold uppercase tracking-wider text-gray-500 dark:text-zinc-400 mb-3">
            Core Delivio Services (<code className="font-mono text-amber-600">settings/platform.services</code>)
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {[
              { id: 'food' as OrderServiceType, label: 'Food Delivery', desc: 'Restaurant meals & drinks' },
              { id: 'convenience' as OrderServiceType, label: 'Convenience', desc: 'Grocery & store orders' },
              { id: 'parcel' as OrderServiceType, label: 'Parcel Express', desc: 'Package courier services' },
              { id: 'pabili' as OrderServiceType, label: 'Pabili Service', desc: 'Custom buy errands' },
              { id: 'request_rider' as OrderServiceType, label: 'Request Driver', desc: 'Dedicated driver dispatch' },
              { id: 'taxi' as OrderServiceType, label: 'Taxi Service', desc: 'Passenger ride-hailing & transit' }
            ].map((svc) => {
              const isEnabled = platformServices[svc.id] !== false;
              return (
                <div
                  key={svc.id}
                  onClick={() => togglePlatformService(svc.id)}
                  className={`p-3.5 rounded-2xl border cursor-pointer transition-all flex items-center justify-between ${
                    isEnabled
                      ? 'bg-amber-50/50 dark:bg-amber-950/20 border-amber-300 dark:border-amber-800/60'
                      : 'bg-gray-50 dark:bg-zinc-850 border-gray-200 dark:border-zinc-800 opacity-60'
                  }`}
                >
                  <div>
                    <span className="font-bold text-xs text-gray-900 dark:text-white block">
                      {svc.label}
                    </span>
                    <span className="text-[11px] text-gray-500">{svc.desc}</span>
                  </div>

                  <span
                    className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
                      isEnabled
                        ? 'bg-emerald-500 text-white'
                        : 'bg-gray-300 dark:bg-zinc-700 text-gray-700 dark:text-zinc-300'
                    }`}
                  >
                    {isEnabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* 2. Taxi Vehicles Toggles */}
        <div>
          <h4 className="text-xs font-extrabold uppercase tracking-wider text-gray-500 dark:text-zinc-400 mb-3">
            Taxi Fleet Availability by Vehicle Type (<code className="font-mono text-amber-600">settings/platform.taxiVehicles</code>)
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            {VEHICLE_TYPES.map((vt) => {
              const isEnabled = platformTaxiVehicles[vt.id] !== false;
              return (
                <div
                  key={vt.id}
                  onClick={() => toggleTaxiVehicle(vt.id)}
                  className={`p-3.5 rounded-2xl border cursor-pointer transition-all flex items-center justify-between ${
                    isEnabled
                      ? 'bg-blue-50/50 dark:bg-blue-950/20 border-blue-300 dark:border-blue-800/60'
                      : 'bg-gray-50 dark:bg-zinc-850 border-gray-200 dark:border-zinc-800 opacity-60'
                  }`}
                >
                  <div>
                    <span className="font-bold text-xs text-gray-900 dark:text-white block">
                      {vt.name}
                    </span>
                    <span className="text-[11px] text-gray-500">{vt.defaultSeats} Passenger Seats</span>
                  </div>

                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      isEnabled
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-300 dark:bg-zinc-700 text-gray-700 dark:text-zinc-300'
                    }`}
                  >
                    {isEnabled ? 'Active' : 'Off'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Migration to Drivers & Taxi Panel */}
      <div className="bg-gradient-to-r from-amber-500/10 via-amber-400/5 to-transparent dark:from-amber-950/20 dark:via-zinc-900 border border-amber-200 dark:border-amber-900/40 rounded-3xl p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-2xl bg-amber-400 text-black shrink-0">
              <Car className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-extrabold text-base text-gray-900 dark:text-white">
                Migrate to Drivers & Taxi
              </h3>
              <p className="text-xs text-gray-600 dark:text-zinc-400 mt-0.5 max-w-2xl">
                Safely upgrades all driver documents in <code className="font-mono text-amber-700 dark:text-amber-300">riders</code> with valid vehicle types and the Taxi service. Backfills platform switches and city <code className="font-mono text-amber-700 dark:text-amber-300">rideRates</code>. Safe to repeat at any time.
              </p>
            </div>
          </div>

          <button
            onClick={handleOpenMigrationPreview}
            disabled={previewLoading || migrationRunning}
            className="delivio-btn-yellow px-5 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-sm shrink-0"
          >
            {previewLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            <span>Preview & Migrate</span>
          </button>
        </div>

        {migrationSummary.length > 0 && (
          <div className="p-4 rounded-2xl bg-white dark:bg-zinc-900 border border-amber-200 dark:border-zinc-800 text-xs space-y-2 mt-2">
            <span className="font-bold text-gray-900 dark:text-white block flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              Migration Results Summary:
            </span>
            {migrationSummary.map((item, idx) => (
              <div key={idx} className="flex items-start gap-2 text-gray-600 dark:text-zinc-300 pl-2">
                <span className="text-amber-500 font-bold">&bull;</span>
                <span>{item}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Wallet Directory Tool Panel */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-6 shadow-xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-gray-100 dark:border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-400 text-black">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-base text-gray-900 dark:text-white">
                Wallet Directory Inspector
              </h3>
              <p className="text-xs text-gray-400">
                Inspect document routing in <code className="font-mono text-amber-600 bg-amber-50 dark:bg-amber-950/40 px-1 rounded">walletDirectory</code> by exact email or phone number.
              </p>
            </div>
          </div>
          <span className="text-[11px] font-semibold text-gray-400">
            Internal routing lookup
          </span>
        </div>

        {/* Search Form */}
        <form onSubmit={handleSearchDirectory} className="space-y-3">
          <label className="block text-xs font-semibold text-gray-700 dark:text-zinc-300">
            Search Identifier (Email or Phone Number)
          </label>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 relative">
              <Search className="w-4 h-4 absolute left-3.5 top-3 text-gray-400" />
              <input
                type="text"
                value={directorySearchInput}
                onChange={(e) => setDirectorySearchInput(e.target.value)}
                placeholder="e.g. user@example.com or 09171234567 or email_... / phone_639..."
                className="w-full pl-9 pr-4 py-2.5 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-amber-400 font-medium"
              />
            </div>
            <button
              type="submit"
              disabled={searchingDirectory}
              className="delivio-btn-yellow px-5 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-xs shrink-0"
            >
              {searchingDirectory ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              <span>Inspect Directory</span>
            </button>
          </div>
          <p className="text-[11px] text-gray-400">
            Maps to documents formatted as <span className="font-mono text-gray-600 dark:text-zinc-400">email_{'{email}'}</span> or <span className="font-mono text-gray-600 dark:text-zinc-400">phone_63XXXXXXXXXX</span>.
          </p>
        </form>

        {/* Not Found Advisory */}
        {directoryNotFound && (
          <div className="p-4 rounded-2xl bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-800 text-xs text-gray-600 dark:text-zinc-400 flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold text-gray-900 dark:text-white block mb-0.5">
                No Entry Found
              </span>
              <span>
                No document matches ID <code className="font-mono text-amber-600 font-bold">{directorySearchedId}</code> in <code className="font-mono">walletDirectory</code>. This identifier is unallocated.
              </span>
            </div>
          </div>
        )}

        {/* Found Directory Entry Display */}
        {directoryEntry && (
          <div className="p-5 rounded-2xl bg-amber-50/40 dark:bg-zinc-850 border border-amber-200 dark:border-zinc-700 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-amber-100 dark:border-zinc-750">
              <div>
                <span className="text-[10px] uppercase font-extrabold text-amber-700 dark:text-amber-400 tracking-wider">
                  Document ID in walletDirectory
                </span>
                <div className="font-mono font-bold text-sm text-gray-900 dark:text-white flex items-center gap-2 mt-0.5">
                  <span>{directoryEntry.id}</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(directoryEntry.id);
                      setCopiedDocId(true);
                      setTimeout(() => setCopiedDocId(false), 2000);
                    }}
                    className="p-1 text-gray-400 hover:text-gray-600"
                    title="Copy Document ID"
                  >
                    {copiedDocId ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setDeleteDirectoryModalOpen(true)}
                className="px-3.5 py-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-xs transition-colors self-start sm:self-auto"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Entry</span>
              </button>
            </div>

            {/* Owner Details */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800">
                <span className="text-[10px] text-gray-400 uppercase font-bold block mb-1">
                  Owner UID
                </span>
                <span className="font-mono font-bold text-gray-900 dark:text-white truncate block">
                  {directoryEntry.uid || '—'}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800">
                <span className="text-[10px] text-gray-400 uppercase font-bold block mb-1">
                  Owner Name
                </span>
                <span className="font-bold text-gray-900 dark:text-white truncate block">
                  {directoryEntry.name || 'Unknown'}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800">
                <span className="text-[10px] text-gray-400 uppercase font-bold block mb-1">
                  Registered Email
                </span>
                <span className="font-semibold text-gray-900 dark:text-white truncate block">
                  {directoryEntry.email || '—'}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800">
                <span className="text-[10px] text-gray-400 uppercase font-bold block mb-1">
                  Registered Phone
                </span>
                <span className="font-semibold text-gray-900 dark:text-white truncate block">
                  {directoryEntry.phone || '—'}
                </span>
              </div>
            </div>

            {directoryEntry.userData && (
              <div className="p-3 rounded-xl bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 text-[11px] flex items-center justify-between text-gray-500">
                <span>Account Role: <strong className="text-gray-900 dark:text-white capitalize">{directoryEntry.userData.role || 'customer'}</strong></span>
                <span>Account Status: <strong className="text-gray-900 dark:text-white capitalize">{directoryEntry.userData.status || 'active'}</strong></span>
                <span>Wallet Balance: <strong className="text-amber-600 font-mono">₱{Number(directoryEntry.userData.walletBalance || 0).toFixed(2)}</strong></span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Migration Preview Modal */}
      {migrationPreviewOpen && migrationPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-lg bg-white dark:bg-zinc-900 rounded-3xl p-6 shadow-2xl border border-gray-200 dark:border-zinc-800 space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-2xl bg-amber-400 text-black">
                <Car className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-extrabold text-lg text-gray-900 dark:text-white">
                  Migration Preview
                </h3>
                <p className="text-xs text-gray-500">
                  Review planned updates before applying them to Firestore.
                </p>
              </div>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3.5 rounded-2xl bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-800 space-y-2">
                <span className="font-bold text-gray-900 dark:text-white block">
                  1. Drivers Collection (riders)
                </span>
                <ul className="space-y-1 text-gray-600 dark:text-zinc-300 list-disc pl-4">
                  <li>Total drivers inspected: <strong>{migrationPreview.totalRiders}</strong></li>
                  <li>Missing vehicleType: <strong>{migrationPreview.ridersNeedingVehicleType}</strong> (will set to &ldquo;motorcycle&rdquo;)</li>
                  <li>Needing &ldquo;taxi&rdquo; in allowed/active services: <strong>{migrationPreview.ridersNeedingTaxi}</strong></li>
                  <li>Non-motorcycle drivers with invalid services: <strong>{migrationPreview.ridersNeedingTrimming}</strong> (will trim to vehicle limits)</li>
                </ul>
              </div>

              <div className="p-3.5 rounded-2xl bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-800 space-y-2">
                <span className="font-bold text-gray-900 dark:text-white block">
                  2. Platform Service Switches
                </span>
                <ul className="space-y-1 text-gray-600 dark:text-zinc-300 list-disc pl-4">
                  <li>services document missing: <strong>{migrationPreview.needsPlatformServices ? 'Yes (will create)' : 'No (already configured)'}</strong></li>
                  <li>taxiVehicles document missing: <strong>{migrationPreview.needsPlatformTaxiVehicles ? 'Yes (will create)' : 'No (already configured)'}</strong></li>
                </ul>
              </div>

              <div className="p-3.5 rounded-2xl bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-800 space-y-2">
                <span className="font-bold text-gray-900 dark:text-white block">
                  3. City Rates & Fares (deliveryRates)
                </span>
                <p className="text-gray-600 dark:text-zinc-300">
                  {migrationPreview.ratesDocsToUpdate.length > 0 ? (
                    <>Will backfill default <code>rideRates</code> in <strong>{migrationPreview.ratesDocsToUpdate.length}</strong> city document(s): {migrationPreview.ratesDocsToUpdate.join(', ')}</>
                  ) : (
                    <>All city rate documents already contain Taxi <code>rideRates</code>.</>
                  )}
                </p>
              </div>
            </div>

            <div className="flex gap-3 justify-end pt-2">
              <button
                type="button"
                onClick={() => setMigrationPreviewOpen(false)}
                className="px-4 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 text-xs font-bold text-gray-700 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteMigration}
                disabled={migrationRunning}
                className="delivio-btn-yellow px-5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 shadow-xs"
              >
                {migrationRunning && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>Confirm & Run Migration</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Database Init */}
      {initDbModalOpen && (
        <ConfirmationModal
          isOpen={initDbModalOpen}
          onClose={() => setInitDbModalOpen(false)}
          onConfirm={handleInitializeDatabase}
          title="Initialize Delivio Database?"
          message="This will check cities, deliveryRates, tierConfig, and settings/platform. It only creates defaults for empty collections and will never overwrite existing documents."
          confirmLabel="Run Initializer"
          reasonRequired={false}
          isDestructive={false}
        />
      )}

      {/* Confirmation Modal for Deleting Wallet Directory Entry */}
      {deleteDirectoryModalOpen && directoryEntry && (
        <ConfirmationModal
          isOpen={deleteDirectoryModalOpen}
          onClose={() => setDeleteDirectoryModalOpen(false)}
          onConfirm={handleDeleteDirectoryEntry}
          title={`Delete Wallet Directory Entry "${directoryEntry.id}"?`}
          message={`Are you sure you want to delete this document from walletDirectory? This will unlink the identifier (${directoryEntry.email || directoryEntry.phone || directoryEntry.id}) from owner UID ${directoryEntry.uid}. This operation cannot be undone.`}
          confirmLabel="Delete Directory Entry"
          reasonRequired={true}
          isDestructive={true}
        />
      )}
    </div>
  );
};
