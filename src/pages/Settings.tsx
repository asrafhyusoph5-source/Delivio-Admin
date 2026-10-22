import React, { useState, useEffect } from 'react';
import {
  db,
  doc,
  getDoc,
  setDoc,
  getDocs,
  collection,
  writeBatch,
  Timestamp
} from '../firebase';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useCity } from '../context/CityContext';
import { logAuditEvent } from '../utils/audit';
import type { PlatformSettings } from '../types';
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
  Server
} from 'lucide-react';
import { ConfirmationModal } from '../components/common/ConfirmationModal';

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

  // Initialize DB state
  const [initDbModalOpen, setInitDbModalOpen] = useState(false);
  const [initializingDb, setInitializingDb] = useState(false);
  const [initSummary, setInitSummary] = useState<string[]>([]);

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
        updatedAt: Timestamp.now()
      };

      await setDoc(sRef, payload, { merge: true });

      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        action: 'UPDATE_PLATFORM_SETTINGS',
        entityType: 'settings',
        entityId: 'platform',
        details: `Saved platform settings. Maintenance mode: ${maintenance ? 'ON' : 'OFF'}`
      });

      showSuccess('Platform settings updated successfully.');
    } catch (err: any) {
      showError(err);
    } finally {
      setSavingSettings(false);
    }
  };

  // Initialize Database:
  // "only where the collection is empty:
  // cities/puerto-princesa, deliveryRates/puerto-princesa (defaults),
  // tierConfig documents with IDs bronze, silver, gold, platinum
  // (Bronze 500/200, Silver 650/500, Gold 850/700, Platinum 1000/1000 rides/coins),
  // and settings/platform."
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
          riderCommissionPercent: 80,
          surcharges: {
            peak: { enabled: false, multiplier: 1.2 },
            night: { enabled: false, flat: 25 }
          },
          createdAt: Timestamp.now()
        });
        summary.push('Created deliveryRates/puerto-princesa with default rates');
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
          createdAt: Timestamp.now()
        });
        summary.push('Created settings/platform');
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
          General platform properties, customer support helplines, maintenance mode, and database bootstrappers.
        </p>
      </div>

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
                  When enabled, mobile client apps (Delivio, Delivio Partner, Delivio Rider) will display a maintenance advisory screen and disable new orders.
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
            Clicking this button checks if the platform collections are empty and safely creates default initial documents without overwriting existing data:
          </p>

          <ul className="text-xs text-gray-600 dark:text-zinc-300 space-y-1.5 list-disc pl-4 font-mono">
            <li>cities/puerto-princesa</li>
            <li>deliveryRates/puerto-princesa</li>
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
    </div>
  );
};
