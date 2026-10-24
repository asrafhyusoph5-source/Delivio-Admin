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
  Server,
  Search,
  Trash2,
  User,
  Wallet,
  BookOpen,
  Copy,
  Check
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
    // Clean phone digits
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

      // If phone wasn't found with 63, try raw digits if different
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
