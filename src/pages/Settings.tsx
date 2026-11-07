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
import type {
  PlatformSettings,
  OrderServiceType,
  PlatformVatConfig,
  DispatchSettings,
  DeliveryOptionType,
  ReceiptDesignConfig,
  CheckoutSettings
} from '../types';
import {
  VEHICLE_TYPES,
  SERVICES_BY_VEHICLE,
  DEFAULT_TAXI_RATES,
  DEFAULT_DISPATCH_SETTINGS,
  DEFAULT_RECEIPT_CONFIG,
  DEFAULT_CHECKOUT_SETTINGS,
  type VehicleType
} from '../constants';
import { ReceiptDesignerTab } from '../components/settings/ReceiptDesignerTab';
import { CheckoutMustTryTab } from '../components/settings/CheckoutMustTryTab';
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
  Layers,
  Receipt,
  Clock,
  Globe,
  Percent,
  Radio,
  Compass,
  Zap,
  Printer,
  Star
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

  // Taxes & Fees (VAT & Timezone) state
  const [vatEnabled, setVatEnabled] = useState(false);
  const [vatPercent, setVatPercent] = useState<number>(12);
  const [vatMode, setVatMode] = useState<'added' | 'included'>('added');
  const [vatBase, setVatBase] = useState<'total' | 'fees'>('total');
  const [timezone, setTimezone] = useState('Asia/Manila');
  const [sampleItems, setSampleItems] = useState<number>(350);
  const [sampleDelivery, setSampleDelivery] = useState<number>(49);
  const [sampleServiceFee, setSampleServiceFee] = useState<number>(15);
  const [confirmSaveVatModalOpen, setConfirmSaveVatModalOpen] = useState(false);
  const [savingTaxesAndFees, setSavingTaxesAndFees] = useState(false);

  // Dispatch Settings (settings/dispatch)
  const [dispatchSettings, setDispatchSettings] = useState<DispatchSettings>(DEFAULT_DISPATCH_SETTINGS);
  const [dispatchExists, setDispatchExists] = useState<boolean>(true);
  const [loadingDispatch, setLoadingDispatch] = useState<boolean>(true);
  const [savingDispatch, setSavingDispatch] = useState<boolean>(false);
  const [confirmSaveDispatchModalOpen, setConfirmSaveDispatchModalOpen] = useState<boolean>(false);

  // Sub-Tab Navigation
  type SettingsTab = 'general' | 'receipt' | 'checkout' | 'dispatch' | 'taxes' | 'services' | 'tools';
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general');

  // Receipt Designer (settings/receipt)
  const [receiptConfig, setReceiptConfig] = useState<ReceiptDesignConfig>(DEFAULT_RECEIPT_CONFIG);
  const [loadingReceipt, setLoadingReceipt] = useState<boolean>(true);

  // Checkout Settings (settings/checkout)
  const [checkoutSettings, setCheckoutSettings] = useState<CheckoutSettings>(DEFAULT_CHECKOUT_SETTINGS);
  const [loadingCheckout, setLoadingCheckout] = useState<boolean>(true);

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

          // VAT settings
          if (dt.vat) {
            setVatEnabled(Boolean(dt.vat.enabled));
            setVatPercent(dt.vat.percent ?? 12);
            setVatMode(dt.vat.mode || 'added');
            setVatBase(dt.vat.base || 'total');
          }

          // Platform timezone
          if (dt.timezone) {
            setTimezone(dt.timezone);
          }
        }

        // Fetch settings/dispatch
        try {
          setLoadingDispatch(true);
          const dRef = doc(db, 'settings', 'dispatch');
          const dSnap = await getDoc(dRef);
          if (dSnap.exists()) {
            const dt = dSnap.data();
            setDispatchSettings({
              defaultOption: dt.defaultOption || 'priority',
              options: {
                priority: {
                  label: dt.options?.priority?.label || 'Priority',
                  enabled: dt.options?.priority?.enabled !== false,
                  holdMinutes: 0,
                  maxBatch: 1,
                  endsWhenReady: true,
                  feeAdjustType: dt.options?.priority?.feeAdjustType || 'flat',
                  feeAdjustValue: Number(dt.options?.priority?.feeAdjustValue ?? 22)
                },
                standard: {
                  label: dt.options?.standard?.label || 'Standard',
                  enabled: dt.options?.standard?.enabled !== false,
                  holdMinutes: Number(dt.options?.standard?.holdMinutes ?? 5),
                  maxBatch: Math.max(2, Number(dt.options?.standard?.maxBatch ?? 3)),
                  endsWhenReady: dt.options?.standard?.endsWhenReady !== false,
                  feeAdjustType: dt.options?.standard?.feeAdjustType || 'flat',
                  feeAdjustValue: Number(dt.options?.standard?.feeAdjustValue ?? 0)
                },
                saver: {
                  label: dt.options?.saver?.label || 'Saver',
                  enabled: dt.options?.saver?.enabled !== false,
                  holdMinutes: Number(dt.options?.saver?.holdMinutes ?? 10),
                  maxBatch: Math.max(2, Number(dt.options?.saver?.maxBatch ?? 3)),
                  endsWhenReady: Boolean(dt.options?.saver?.endsWhenReady),
                  feeAdjustType: dt.options?.saver?.feeAdjustType || 'flat',
                  feeAdjustValue: Number(dt.options?.saver?.feeAdjustValue ?? -15)
                }
              },
              searchRadiusKm: Number(dt.searchRadiusKm ?? 5),
              waveSeconds: Number(dt.waveSeconds ?? 8),
              poolMaxPickupGapKm: Number(dt.poolMaxPickupGapKm ?? 1.5),
              poolMaxDropoffGapKm: Number(dt.poolMaxDropoffGapKm ?? 3),
              priorityHeadStartSeconds: Number(dt.priorityHeadStartSeconds ?? 10),
              priorityMaxBatch: Math.max(1, Number(dt.priorityMaxBatch ?? 4))
            });
            setDispatchExists(true);
          } else {
            setDispatchSettings(DEFAULT_DISPATCH_SETTINGS);
            setDispatchExists(false);
          }
        } catch (e) {
          console.warn('Failed to load settings/dispatch:', e);
        } finally {
          setLoadingDispatch(false);
        }

        // Fetch settings/receipt
        try {
          setLoadingReceipt(true);
          const rRef = doc(db, 'settings', 'receipt');
          const rSnap = await getDoc(rRef);
          if (rSnap.exists()) {
            const dt = rSnap.data();
            setReceiptConfig({
              brandLine: dt.brandLine || DEFAULT_RECEIPT_CONFIG.brandLine,
              headerLines: Array.isArray(dt.headerLines) ? dt.headerLines : DEFAULT_RECEIPT_CONFIG.headerLines,
              footerText: dt.footerText !== undefined ? dt.footerText : DEFAULT_RECEIPT_CONFIG.footerText,
              showOrderId: dt.showOrderId !== false,
              showOrderedAt: dt.showOrderedAt !== false,
              showCustomerName: dt.showCustomerName !== false,
              showNote: dt.showNote !== false,
              showSetChoices: dt.showSetChoices !== false,
              fontSize: dt.fontSize || DEFAULT_RECEIPT_CONFIG.fontSize,
              align: dt.align || DEFAULT_RECEIPT_CONFIG.align,
              separator: dt.separator || DEFAULT_RECEIPT_CONFIG.separator,
              merchantCopy: {
                enabled: dt.merchantCopy?.enabled !== false,
                title: dt.merchantCopy?.title || DEFAULT_RECEIPT_CONFIG.merchantCopy.title,
                showItemPrices: dt.merchantCopy?.showItemPrices !== false
              },
              customerCopy: {
                enabled: dt.customerCopy?.enabled !== false,
                title: dt.customerCopy?.title || DEFAULT_RECEIPT_CONFIG.customerCopy.title,
                showItemPrices: dt.customerCopy?.showItemPrices !== false
              }
            });
          }
        } catch (e) {
          console.warn('Failed to load settings/receipt:', e);
        } finally {
          setLoadingReceipt(false);
        }

        // Fetch settings/checkout
        try {
          setLoadingCheckout(true);
          const cRef = doc(db, 'settings', 'checkout');
          const cSnap = await getDoc(cRef);
          if (cSnap.exists()) {
            const dt = cSnap.data();
            setCheckoutSettings({
              mustTry: {
                enabled: dt.mustTry?.enabled !== false,
                title: dt.mustTry?.title || DEFAULT_CHECKOUT_SETTINGS.mustTry.title,
                description: dt.mustTry?.description || DEFAULT_CHECKOUT_SETTINGS.mustTry.description,
                maxItems: Number(dt.mustTry?.maxItems ?? DEFAULT_CHECKOUT_SETTINGS.mustTry.maxItems)
              }
            });
          }
        } catch (e) {
          console.warn('Failed to load settings/checkout:', e);
        } finally {
          setLoadingCheckout(false);
        }
      } catch (err) {
        showError(err);
      } finally {
        setLoading(false);
      }
    };

    fetchSettings();
  }, []);

  const handleCreateDefaultDispatch = async () => {
    try {
      setSavingDispatch(true);
      const dRef = doc(db, 'settings', 'dispatch');
      const payload = {
        ...DEFAULT_DISPATCH_SETTINGS,
        updatedAt: Timestamp.now(),
        updatedBy: adminProfile?.uid || 'admin'
      };
      await setDoc(dRef, payload);
      setDispatchSettings(DEFAULT_DISPATCH_SETTINGS);
      setDispatchExists(true);

      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        adminEmail: adminProfile?.email,
        action: 'CREATE_DEFAULT_DISPATCH_SETTINGS',
        entityType: 'settings',
        entityId: 'dispatch',
        details: 'Created initial default dispatch settings document (Priority +22, Standard 0, Saver -15, Radius 5km)'
      });

      showSuccess('Default dispatch settings created successfully.');
    } catch (err: any) {
      showError(err);
    } finally {
      setSavingDispatch(false);
    }
  };

  const handleConfirmSaveDispatch = async () => {
    try {
      setSavingDispatch(true);
      const dRef = doc(db, 'settings', 'dispatch');
      // Priority must keep holdMinutes 0 and maxBatch 1
      const payload: DispatchSettings = {
        defaultOption: dispatchSettings.defaultOption || 'priority',
        options: {
          priority: {
            ...dispatchSettings.options.priority,
            holdMinutes: 0,
            maxBatch: 1,
            endsWhenReady: true,
            feeAdjustValue: Number(dispatchSettings.options.priority.feeAdjustValue)
          },
          standard: {
            ...dispatchSettings.options.standard,
            holdMinutes: Math.max(1, Number(dispatchSettings.options.standard.holdMinutes) || 5),
            maxBatch: Math.max(2, Number(dispatchSettings.options.standard.maxBatch) || 3),
            endsWhenReady: dispatchSettings.options.standard.endsWhenReady !== false,
            feeAdjustValue: Number(dispatchSettings.options.standard.feeAdjustValue)
          },
          saver: {
            ...dispatchSettings.options.saver,
            holdMinutes: Math.max(1, Number(dispatchSettings.options.saver.holdMinutes) || 10),
            maxBatch: Math.max(2, Number(dispatchSettings.options.saver.maxBatch) || 3),
            endsWhenReady: Boolean(dispatchSettings.options.saver.endsWhenReady),
            feeAdjustValue: Number(dispatchSettings.options.saver.feeAdjustValue)
          }
        },
        searchRadiusKm: Math.max(1, Number(dispatchSettings.searchRadiusKm) || 5),
        waveSeconds: Math.max(1, Number(dispatchSettings.waveSeconds) || 8),
        poolMaxPickupGapKm: Math.max(0.1, Number(dispatchSettings.poolMaxPickupGapKm) || 1.5),
        poolMaxDropoffGapKm: Math.max(0.1, Number(dispatchSettings.poolMaxDropoffGapKm) || 3),
        priorityHeadStartSeconds: Math.max(0, Number(dispatchSettings.priorityHeadStartSeconds ?? 10)),
        priorityMaxBatch: Math.max(1, Number(dispatchSettings.priorityMaxBatch ?? 4)),
        updatedAt: Timestamp.now(),
        updatedBy: adminProfile?.uid || 'admin'
      };

      await setDoc(dRef, payload);
      setDispatchSettings(payload);
      setDispatchExists(true);
      setConfirmSaveDispatchModalOpen(false);

      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        adminEmail: adminProfile?.email,
        action: 'UPDATE_DISPATCH_SETTINGS',
        entityType: 'settings',
        entityId: 'dispatch',
        details: `Updated dispatch settings. Default: ${payload.defaultOption}, Radius: ${payload.searchRadiusKm}km, Wave: ${payload.waveSeconds}s, Priority: ${payload.options.priority.feeAdjustValue >= 0 ? '+' : ''}${payload.options.priority.feeAdjustValue}, Saver: ${payload.options.saver.feeAdjustValue}`
      });

      showSuccess('Dispatch settings saved successfully.');
    } catch (err: any) {
      showError(err);
    } finally {
      setSavingDispatch(false);
    }
  };

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

  // Save Taxes & Fees (VAT and Timezone) to Firestore
  const handleSaveTaxesAndFees = async () => {
    try {
      setSavingTaxesAndFees(true);
      const sRef = doc(db, 'settings', 'platform');
      const vatPayload: PlatformVatConfig = {
        enabled: Boolean(vatEnabled),
        percent: Number(vatPercent) || 0,
        mode: vatMode,
        base: vatBase
      };
      const cleanTimezone = timezone.trim() || 'Asia/Manila';

      await setDoc(
        sRef,
        {
          vat: vatPayload,
          timezone: cleanTimezone,
          updatedAt: Timestamp.now()
        },
        { merge: true }
      );

      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        adminEmail: adminProfile?.email,
        action: 'UPDATE_TAXES_AND_FEES',
        entityType: 'settings',
        entityId: 'platform',
        details: `Saved Taxes & Fees: VAT ${vatEnabled ? 'Enabled' : 'Disabled'} (${vatPercent}%, mode: ${vatMode}, base: ${vatBase}), Timezone: ${cleanTimezone}`
      });

      showSuccess('Taxes, VAT rules & platform timezone updated successfully.');
      setConfirmSaveVatModalOpen(false);
    } catch (err: any) {
      showError(err);
    } finally {
      setSavingTaxesAndFees(false);
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

      {/* Sub-Tab Navigation Bar */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 border-b border-gray-200 dark:border-zinc-800">
        {[
          { id: 'general' as const, label: 'General', icon: SettingsIcon },
          { id: 'receipt' as const, label: 'Print Receipt', icon: Printer },
          { id: 'checkout' as const, label: 'Checkout (Must Try!)', icon: Sparkles },
          { id: 'dispatch' as const, label: 'Dispatch', icon: Compass },
          { id: 'taxes' as const, label: 'Taxes & Fees', icon: Percent },
          { id: 'services' as const, label: 'Service Switches', icon: Layers },
          { id: 'tools' as const, label: 'Database & Tools', icon: Database },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = settingsTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSettingsTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-extrabold whitespace-nowrap transition-all ${
                isActive
                  ? 'bg-amber-400 text-black shadow-xs'
                  : 'text-gray-600 dark:text-zinc-400 hover:text-black dark:hover:text-white hover:bg-gray-100 dark:hover:bg-zinc-800'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* RECEIPT DESIGNER TAB */}
      {settingsTab === 'receipt' && (
        <ReceiptDesignerTab
          receiptConfig={receiptConfig}
          onConfigChange={setReceiptConfig}
          loading={loadingReceipt}
        />
      )}

      {/* CHECKOUT / MUST TRY! TAB */}
      {settingsTab === 'checkout' && (
        <CheckoutMustTryTab
          checkoutSettings={checkoutSettings}
          onSettingsChange={setCheckoutSettings}
          loading={loadingCheckout}
        />
      )}

      {/* GENERAL PLATFORM CONFIGURATION TAB */}
      {settingsTab === 'general' && (
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
      )}

      {/* TAXES & FEES TAB */}
      {settingsTab === 'taxes' && (
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-6 shadow-xs space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-gray-100 dark:border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-amber-400 text-black shadow-xs">
              <Receipt className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-base text-gray-900 dark:text-white">
                Taxes & Fees (VAT & Platform Timezone)
              </h3>
              <p className="text-xs text-gray-500 dark:text-zinc-400">
                Configure VAT rules, taxation base, customer checkout computation mode, and platform operating timezone. Saved in <code className="font-mono text-amber-600">settings/platform.vat</code> and <code className="font-mono text-amber-600">settings/platform.timezone</code>.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setConfirmSaveVatModalOpen(true)}
            disabled={savingTaxesAndFees}
            className="delivio-btn-yellow px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 self-start sm:self-auto shadow-xs"
          >
            {savingTaxesAndFees ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Taxes & Fees
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* VAT and Timezone Configuration Form */}
          <div className="lg:col-span-7 space-y-5">
            {/* VAT Toggle */}
            <div className="p-4 rounded-2xl border border-gray-200 dark:border-zinc-800 bg-gray-50/70 dark:bg-zinc-850 flex items-center justify-between">
              <div>
                <span className="font-bold text-xs text-gray-900 dark:text-white block">
                  Value-Added Tax (VAT) Status
                </span>
                <p className="text-[11px] text-gray-500">
                  Enable or disable VAT assessment on checkout across mobile & web customer apps.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setVatEnabled(!vatEnabled)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
                  vatEnabled
                    ? 'bg-emerald-500 text-white'
                    : 'bg-gray-300 dark:bg-zinc-700 text-gray-700 dark:text-zinc-300'
                }`}
              >
                {vatEnabled ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                <span>{vatEnabled ? 'VAT Enabled' : 'VAT Disabled'}</span>
              </button>
            </div>

            {/* VAT Rate and Computation Mode */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  VAT Percentage (%)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={vatPercent}
                    onChange={(e) => setVatPercent(Math.max(0, Number(e.target.value)))}
                    disabled={!vatEnabled}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold text-gray-900 dark:text-white disabled:opacity-50"
                  />
                  <Percent className="w-4 h-4 absolute right-3 top-3 text-gray-400 pointer-events-none" />
                </div>
                <span className="text-[10px] text-gray-400 mt-0.5 block">Standard Philippine rate is 12%</span>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Platform Operating Timezone
                </label>
                <div className="relative">
                  <select
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold text-gray-900 dark:text-white"
                  >
                    <option value="Asia/Manila">Asia/Manila (PHT, UTC+8)</option>
                    <option value="Asia/Singapore">Asia/Singapore (SGT, UTC+8)</option>
                    <option value="Asia/Tokyo">Asia/Tokyo (JST, UTC+9)</option>
                    <option value="UTC">UTC (Coordinated Universal Time)</option>
                    <option value="America/New_York">America/New_York (EST/EDT)</option>
                    <option value="America/Los_Angeles">America/Los_Angeles (PST/PDT)</option>
                  </select>
                </div>
                <span className="text-[10px] text-gray-400 mt-0.5 block">Used for merchant operating hours windows</span>
              </div>
            </div>

            {/* VAT Mode: Added vs Included */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-zinc-300 mb-2">
                VAT Mode (<code className="font-mono text-amber-600">settings/platform.vat.mode</code>)
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setVatMode('added')}
                  disabled={!vatEnabled}
                  className={`p-3.5 rounded-2xl border text-left transition-all ${
                    vatMode === 'added'
                      ? 'border-amber-400 bg-amber-50/50 dark:bg-amber-950/20 ring-2 ring-amber-400/40'
                      : 'border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-800 opacity-70'
                  } ${!vatEnabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-gray-900 dark:text-white">Added on top ("added")</span>
                    {vatMode === 'added' && <CheckCircle2 className="w-4 h-4 text-amber-500" />}
                  </div>
                  <p className="text-[11px] text-gray-500 mt-1">
                    VAT is computed and added on top of the taxable base. Customer pays Base + VAT.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setVatMode('included')}
                  disabled={!vatEnabled}
                  className={`p-3.5 rounded-2xl border text-left transition-all ${
                    vatMode === 'included'
                      ? 'border-amber-400 bg-amber-50/50 dark:bg-amber-950/20 ring-2 ring-amber-400/40'
                      : 'border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-800 opacity-70'
                  } ${!vatEnabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-gray-900 dark:text-white">Included in price ("included")</span>
                    {vatMode === 'included' && <CheckCircle2 className="w-4 h-4 text-amber-500" />}
                  </div>
                  <p className="text-[11px] text-gray-500 mt-1">
                    Display prices are VAT-inclusive. The VAT component is broken out without increasing the nominal total.
                  </p>
                </button>
              </div>
            </div>

            {/* VAT Base: Total vs Fees */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-zinc-300 mb-2">
                VAT Taxable Base (<code className="font-mono text-amber-600">settings/platform.vat.base</code>)
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setVatBase('total')}
                  disabled={!vatEnabled}
                  className={`p-3.5 rounded-2xl border text-left transition-all ${
                    vatBase === 'total'
                      ? 'border-amber-400 bg-amber-50/50 dark:bg-amber-950/20 ring-2 ring-amber-400/40'
                      : 'border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-800 opacity-70'
                  } ${!vatEnabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-gray-900 dark:text-white">Entire Order ("total")</span>
                    {vatBase === 'total' && <CheckCircle2 className="w-4 h-4 text-amber-500" />}
                  </div>
                  <p className="text-[11px] text-gray-500 mt-1">
                    Tax applies to full order amount: items subtotal + delivery fee + platform service fee.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setVatBase('fees')}
                  disabled={!vatEnabled}
                  className={`p-3.5 rounded-2xl border text-left transition-all ${
                    vatBase === 'fees'
                      ? 'border-amber-400 bg-amber-50/50 dark:bg-amber-950/20 ring-2 ring-amber-400/40'
                      : 'border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-800 opacity-70'
                  } ${!vatEnabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-gray-900 dark:text-white">Fees Only ("fees")</span>
                    {vatBase === 'fees' && <CheckCircle2 className="w-4 h-4 text-amber-500" />}
                  </div>
                  <p className="text-[11px] text-gray-500 mt-1">
                    Tax applies strictly to platform revenue (delivery fee + service fee). Merchant food/store items exempt.
                  </p>
                </button>
              </div>
            </div>
          </div>

          {/* Live Interactive Checkout Example Card */}
          <div className="lg:col-span-5 bg-amber-50/40 dark:bg-zinc-850 border border-amber-200 dark:border-zinc-700/60 rounded-3xl p-5 space-y-4 shadow-xs">
            <div className="flex items-center gap-2 pb-2 border-b border-amber-200/60 dark:border-zinc-700">
              <Sparkles className="w-4 h-4 text-amber-500" />
              <h4 className="font-extrabold text-xs uppercase tracking-wider text-gray-900 dark:text-white">
                Live Interactive Checkout Example
              </h4>
            </div>

            <p className="text-[11px] text-gray-500 dark:text-zinc-400">
              Simulate checkout totals in real-time based on active VAT settings:
            </p>

            {/* Test Simulation Inputs */}
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div>
                <label className="block text-[10px] font-semibold text-gray-500 uppercase mb-0.5">
                  Items (₱)
                </label>
                <input
                  type="number"
                  min="0"
                  step="10"
                  value={sampleItems}
                  onChange={(e) => setSampleItems(Math.max(0, Number(e.target.value)))}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 font-bold text-xs"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-gray-500 uppercase mb-0.5">
                  Delivery (₱)
                </label>
                <input
                  type="number"
                  min="0"
                  step="5"
                  value={sampleDelivery}
                  onChange={(e) => setSampleDelivery(Math.max(0, Number(e.target.value)))}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 font-bold text-xs"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-gray-500 uppercase mb-0.5">
                  Service (₱)
                </label>
                <input
                  type="number"
                  min="0"
                  step="5"
                  value={sampleServiceFee}
                  onChange={(e) => setSampleServiceFee(Math.max(0, Number(e.target.value)))}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 font-bold text-xs"
                />
              </div>
            </div>

            {/* Live Calculation Output Card */}
            {(() => {
              const vatRate = Math.max(0, Number(vatPercent) || 0);
              const sampleGoodsTotal = sampleItems + sampleDelivery + sampleServiceFee;
              let sampleVatAmount = 0;
              let sampleCustomerTotal = sampleGoodsTotal;
              const sampleTaxableBase = vatBase === 'total' ? sampleGoodsTotal : (sampleDelivery + sampleServiceFee);

              if (vatEnabled && vatRate > 0) {
                if (vatMode === 'added') {
                  sampleVatAmount = (sampleTaxableBase * vatRate) / 100;
                  sampleCustomerTotal = sampleGoodsTotal + sampleVatAmount;
                } else {
                  sampleVatAmount = sampleTaxableBase - (sampleTaxableBase / (1 + vatRate / 100));
                  sampleCustomerTotal = sampleGoodsTotal;
                }
              }

              return (
                <div className="bg-white dark:bg-zinc-900 border border-amber-200 dark:border-amber-900/60 rounded-2xl p-4 space-y-2 text-xs">
                  <div className="flex justify-between text-gray-600 dark:text-zinc-400">
                    <span>Cart Items Subtotal:</span>
                    <span>₱{sampleItems.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-gray-600 dark:text-zinc-400">
                    <span>Delivery Fee:</span>
                    <span>₱{sampleDelivery.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-gray-600 dark:text-zinc-400">
                    <span>Platform Service Fee:</span>
                    <span>₱{sampleServiceFee.toFixed(2)}</span>
                  </div>

                  <div className="pt-2 border-t border-gray-100 dark:border-zinc-800 flex justify-between font-semibold text-gray-700 dark:text-zinc-300">
                    <span>Subtotal Before VAT:</span>
                    <span>₱{sampleGoodsTotal.toFixed(2)}</span>
                  </div>

                  <div className="flex justify-between text-amber-900 dark:text-amber-400 font-medium">
                    <span>
                      VAT ({vatEnabled ? `${vatRate}%` : 'Disabled'} &bull;{' '}
                      {vatBase === 'total' ? 'Full order' : 'Fees only'} &bull;{' '}
                      {vatMode === 'added' ? 'Added' : 'Included'}):
                    </span>
                    <span className="font-bold">
                      {vatEnabled
                        ? (vatMode === 'added' ? `+₱${sampleVatAmount.toFixed(2)}` : `₱${sampleVatAmount.toFixed(2)} (incl.)`)
                        : '₱0.00'}
                    </span>
                  </div>

                  <div className="pt-2.5 border-t border-amber-300 dark:border-amber-800 flex justify-between items-baseline">
                    <span className="font-extrabold text-sm text-gray-900 dark:text-white">
                      Customer Pays:
                    </span>
                    <span className="font-black text-base text-amber-600">
                      ₱{sampleCustomerTotal.toFixed(2)}
                    </span>
                  </div>

                  <div className="pt-2 border-t border-dashed border-gray-200 dark:border-zinc-800 text-[11px] text-gray-400 space-y-0.5">
                    <div className="flex justify-between">
                      <span>Merchant Payout:</span>
                      <span>₱{sampleItems.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Platform + Delivery:</span>
                      <span>₱{(sampleDelivery + sampleServiceFee).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Government Tax Collected:</span>
                      <span>₱{sampleVatAmount.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      </div>
      )}

      {/* DISPATCH SETTINGS TAB */}
      {settingsTab === 'dispatch' && (
      <div id="dispatch-settings" className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-6 shadow-xs space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-gray-100 dark:border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-400 text-black shadow-xs">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-extrabold text-base text-gray-900 dark:text-white">
                  Dispatch & Order Batching Settings
                </h3>
                {dispatchExists ? (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800">
                    Active (settings/dispatch)
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-400 border border-amber-300 dark:border-amber-800">
                    Missing Document
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">
                Configure Priority, Standard, and Saver batching windows, fee adjustments, and driver pooling radii.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            {!dispatchExists && (
              <button
                type="button"
                onClick={handleCreateDefaultDispatch}
                disabled={savingDispatch}
                className="px-3.5 py-2 rounded-xl text-xs font-bold border border-amber-400 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/30 flex items-center gap-1.5 transition-colors"
              >
                {savingDispatch ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                Create default dispatch settings
              </button>
            )}
            <button
              type="button"
              onClick={() => setConfirmSaveDispatchModalOpen(true)}
              disabled={savingDispatch || loadingDispatch}
              className="delivio-btn-yellow px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs"
            >
              {savingDispatch ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Dispatch Settings
            </button>
          </div>
        </div>

        {/* Helper Explanatory Banner */}
        <div className="p-4 rounded-2xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/50 flex items-start gap-3">
          <Radio className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-extrabold text-xs text-amber-900 dark:text-amber-200 uppercase tracking-wider block">
              Dispatch Rules & Batching Engine
            </span>
            <p className="text-xs text-gray-700 dark:text-zinc-300 leading-relaxed">
              <strong>Priority</strong> = one rider, one booking. <strong>Standard</strong> = the order is held for up to holdMinutes after the merchant accepts it, and the hold ends early if the merchant marks it Ready. <strong>Saver</strong> = the order is held for the exact holdMinutes, even if the merchant marks it Ready. In both, if a compatible order is found the two go out together as a double booking immediately; otherwise the order goes out as a single booking when the hold ends. <em>maxBatch is the most orders one rider can carry (at least 2 for Standard and Saver; Priority stays 1).</em>
            </p>
          </div>
        </div>

        {/* Global Dispatch & Pool Limits (Search radius is managed on Merchant Partners / Drivers pages) */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-extrabold uppercase tracking-wider text-gray-700 dark:text-zinc-300 flex items-center gap-2">
              <Compass className="w-4 h-4 text-amber-500" />
              General Dispatch & Pool Parameters
            </h4>
            <div className="flex items-center gap-2">
              <label className="text-xs font-bold text-gray-600 dark:text-zinc-400">
                Default Option for Customers:
              </label>
              <select
                value={dispatchSettings.defaultOption}
                onChange={(e) =>
                  setDispatchSettings((prev) => ({
                    ...prev,
                    defaultOption: e.target.value as DeliveryOptionType
                  }))
                }
                className="px-3 py-1.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-black text-amber-600 focus:ring-2 focus:ring-amber-400"
              >
                <option value="priority">Priority Delivery</option>
                <option value="standard">Standard Delivery</option>
                <option value="saver">Saver Delivery</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-3.5 rounded-2xl bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-800">
              <label className="block text-[11px] font-extrabold uppercase text-gray-500 dark:text-zinc-400 mb-1">
                Wave Dispatch Interval
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="3"
                  max="60"
                  step="1"
                  value={dispatchSettings.waveSeconds}
                  onChange={(e) =>
                    setDispatchSettings((prev) => ({
                      ...prev,
                      waveSeconds: Number(e.target.value)
                    }))
                  }
                  className="w-full px-3 py-1.5 rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold text-gray-900 dark:text-white"
                />
                <span className="text-xs font-extrabold text-gray-500 dark:text-zinc-400">sec</span>
              </div>
              <span className="text-[10px] text-gray-400 mt-1 block">Default: 8 seconds</span>
            </div>

            <div className="p-3.5 rounded-2xl bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-800">
              <label className="block text-[11px] font-extrabold uppercase text-gray-500 dark:text-zinc-400 mb-1">
                Pool Max Pickup Gap
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0.1"
                  max="10"
                  step="0.1"
                  value={dispatchSettings.poolMaxPickupGapKm}
                  onChange={(e) =>
                    setDispatchSettings((prev) => ({
                      ...prev,
                      poolMaxPickupGapKm: Number(e.target.value)
                    }))
                  }
                  className="w-full px-3 py-1.5 rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold text-gray-900 dark:text-white"
                />
                <span className="text-xs font-extrabold text-gray-500 dark:text-zinc-400">km</span>
              </div>
              <span className="text-[10px] text-gray-400 mt-1 block">Default: 1.5 km</span>
            </div>

            <div className="p-3.5 rounded-2xl bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-800">
              <label className="block text-[11px] font-extrabold uppercase text-gray-500 dark:text-zinc-400 mb-1">
                Pool Max Dropoff Gap
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0.1"
                  max="15"
                  step="0.1"
                  value={dispatchSettings.poolMaxDropoffGapKm}
                  onChange={(e) =>
                    setDispatchSettings((prev) => ({
                      ...prev,
                      poolMaxDropoffGapKm: Number(e.target.value)
                    }))
                  }
                  className="w-full px-3 py-1.5 rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold text-gray-900 dark:text-white"
                />
                <span className="text-xs font-extrabold text-gray-500 dark:text-zinc-400">km</span>
              </div>
              <span className="text-[10px] text-gray-400 mt-1 block">Default: 3.0 km</span>
            </div>
          </div>
        </div>

        {/* Priority Rider Dispatch Configuration */}
        <div className="p-4 rounded-3xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-300 dark:border-amber-800/60 space-y-3">
          <div className="flex items-center gap-2">
            <Star className="w-4 h-4 text-amber-500 fill-amber-400" />
            <h4 className="text-xs font-black uppercase tracking-wider text-amber-950 dark:text-amber-200">
              Priority Rider Dispatch Settings
            </h4>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-3.5 rounded-2xl bg-white dark:bg-zinc-850 border border-amber-200 dark:border-amber-800/40">
              <label className="block text-[11px] font-extrabold uppercase text-gray-600 dark:text-zinc-300 mb-1">
                Priority Head Start Window
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  max="120"
                  step="1"
                  value={dispatchSettings.priorityHeadStartSeconds ?? 10}
                  onChange={(e) =>
                    setDispatchSettings((prev) => ({
                      ...prev,
                      priorityHeadStartSeconds: Number(e.target.value)
                    }))
                  }
                  className="w-full px-3 py-1.5 rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-black text-amber-600"
                />
                <span className="text-xs font-extrabold text-gray-500 dark:text-zinc-400">sec</span>
              </div>
              <span className="text-[10px] text-gray-500 mt-1 block">
                Priority riders are offered first, others start this many seconds later (default: 10s).
              </span>
            </div>

            <div className="p-3.5 rounded-2xl bg-white dark:bg-zinc-850 border border-amber-200 dark:border-amber-800/40">
              <label className="block text-[11px] font-extrabold uppercase text-gray-600 dark:text-zinc-300 mb-1">
                Priority Rider Max Batch
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  max="10"
                  step="1"
                  value={dispatchSettings.priorityMaxBatch ?? 4}
                  onChange={(e) =>
                    setDispatchSettings((prev) => ({
                      ...prev,
                      priorityMaxBatch: Math.max(1, Number(e.target.value))
                    }))
                  }
                  className="w-full px-3 py-1.5 rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-black text-amber-600"
                />
                <span className="text-xs font-extrabold text-gray-500 dark:text-zinc-400">orders</span>
              </div>
              <span className="text-[10px] text-gray-500 mt-1 block">
                Max batch capacity for priority riders on food/convenience double bookings (default: 4, min: 1).
              </span>
            </div>
          </div>

          <p className="text-[11px] text-amber-900 dark:text-amber-200/90 leading-relaxed bg-amber-100/60 dark:bg-amber-900/30 p-2.5 rounded-xl border border-amber-200 dark:border-amber-800/40">
            <strong>Helper text:</strong> a priority rider is offered every Delivio Food or Delivio Mart order anywhere in their registered city (ignoring the radius), nearest priority rider first, and can carry up to priorityMaxBatch orders in a double booking (minimum 1); every other service stays single.
          </p>
        </div>

        {/* Options Table / Cards: Priority, Standard, Saver */}
        <div className="space-y-3">
          <h4 className="text-xs font-extrabold uppercase tracking-wider text-gray-700 dark:text-zinc-300">
            Delivery Option Tiers
          </h4>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Priority Option */}
            <div className={`p-4 rounded-2xl border transition-all ${
              dispatchSettings.options.priority.enabled
                ? 'bg-amber-500/5 border-amber-300 dark:border-amber-800/80'
                : 'bg-gray-50 dark:bg-zinc-850 border-gray-200 dark:border-zinc-800 opacity-60'
            }`}>
              <div className="flex items-center justify-between pb-3 border-b border-gray-200 dark:border-zinc-700/60 mb-3">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500 ring-2 ring-amber-300 dark:ring-amber-900" />
                  <span className="font-black text-sm text-gray-900 dark:text-white">Priority</span>
                  {dispatchSettings.defaultOption === 'priority' && (
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-amber-400 text-black">
                      DEFAULT
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setDispatchSettings((prev) => ({
                      ...prev,
                      options: {
                        ...prev.options,
                        priority: {
                          ...prev.options.priority,
                          enabled: !prev.options.priority.enabled
                        }
                      }
                    }))
                  }
                  className={`text-xs font-extrabold px-2.5 py-1 rounded-lg ${
                    dispatchSettings.options.priority.enabled
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                      : 'bg-gray-200 text-gray-600 dark:bg-zinc-700 dark:text-zinc-300'
                  }`}
                >
                  {dispatchSettings.options.priority.enabled ? 'Enabled' : 'Disabled'}
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] font-bold text-gray-500 dark:text-zinc-400 mb-1">
                    Display Label
                  </label>
                  <input
                    type="text"
                    value={dispatchSettings.options.priority.label}
                    onChange={(e) =>
                      setDispatchSettings((prev) => ({
                        ...prev,
                        options: {
                          ...prev.options,
                          priority: { ...prev.options.priority, label: e.target.value }
                        }
                      }))
                    }
                    className="w-full px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white font-medium"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 dark:text-zinc-400 mb-1">
                      Hold Minutes
                    </label>
                    <input
                      type="number"
                      disabled
                      value={0}
                      className="w-full px-2.5 py-1 text-xs rounded-lg border border-gray-200 dark:border-zinc-800 bg-gray-100 dark:bg-zinc-900 text-gray-500 font-bold cursor-not-allowed"
                    />
                    <span className="text-[9px] text-gray-400 mt-0.5 block">Locked at 0</span>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 dark:text-zinc-400 mb-1">
                      Max Batch
                    </label>
                    <input
                      type="number"
                      disabled
                      value={1}
                      className="w-full px-2.5 py-1 text-xs rounded-lg border border-gray-200 dark:border-zinc-800 bg-gray-100 dark:bg-zinc-900 text-gray-500 font-bold cursor-not-allowed"
                    />
                    <span className="text-[9px] text-gray-400 mt-0.5 block">Locked at 1</span>
                  </div>
                </div>

                {/* Ends when ready */}
                <div className="p-2 rounded-xl bg-gray-100 dark:bg-zinc-800/60 border border-gray-200 dark:border-zinc-700 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-bold text-gray-700 dark:text-zinc-300 block">
                      Ends When Ready
                    </span>
                    <span className="text-[9px] text-gray-400">Immediate release</span>
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                    True
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 dark:text-zinc-400 mb-1">
                      Adjustment Type
                    </label>
                    <select
                      value={dispatchSettings.options.priority.feeAdjustType}
                      onChange={(e) =>
                        setDispatchSettings((prev) => ({
                          ...prev,
                          options: {
                            ...prev.options,
                            priority: {
                              ...prev.options.priority,
                              feeAdjustType: e.target.value as 'flat' | 'percent'
                            }
                          }
                        }))
                      }
                      className="w-full px-2 py-1 text-xs rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white font-semibold"
                    >
                      <option value="flat">₱ Flat</option>
                      <option value="percent">% Percent</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 dark:text-zinc-400 mb-1">
                      Fee Adjustment
                    </label>
                    <input
                      type="number"
                      value={dispatchSettings.options.priority.feeAdjustValue}
                      onChange={(e) =>
                        setDispatchSettings((prev) => ({
                          ...prev,
                          options: {
                            ...prev.options,
                            priority: {
                              ...prev.options.priority,
                              feeAdjustValue: Number(e.target.value)
                            }
                          }
                        }))
                      }
                      className="w-full px-2.5 py-1 text-xs rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-amber-600 font-black"
                    />
                    <span className="text-[9px] text-gray-400 mt-0.5 block">Default: +₱22</span>
                  </div>
                </div>

                <p className="text-[10px] text-gray-500 italic pt-1 border-t border-gray-200/60 dark:border-zinc-800">
                  Priority = one rider, one booking. No batching hold.
                </p>
              </div>
            </div>

            {/* Standard Option */}
            <div className={`p-4 rounded-2xl border transition-all ${
              dispatchSettings.options.standard.enabled
                ? 'bg-blue-500/5 border-blue-300 dark:border-blue-800/80'
                : 'bg-gray-50 dark:bg-zinc-850 border-gray-200 dark:border-zinc-800 opacity-60'
            }`}>
              <div className="flex items-center justify-between pb-3 border-b border-gray-200 dark:border-zinc-700/60 mb-3">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-500 ring-2 ring-blue-300 dark:ring-blue-900" />
                  <span className="font-black text-sm text-gray-900 dark:text-white">Standard</span>
                  {dispatchSettings.defaultOption === 'standard' && (
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-blue-500 text-white">
                      DEFAULT
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setDispatchSettings((prev) => ({
                      ...prev,
                      options: {
                        ...prev.options,
                        standard: {
                          ...prev.options.standard,
                          enabled: !prev.options.standard.enabled
                        }
                      }
                    }))
                  }
                  className={`text-xs font-extrabold px-2.5 py-1 rounded-lg ${
                    dispatchSettings.options.standard.enabled
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                      : 'bg-gray-200 text-gray-600 dark:bg-zinc-700 dark:text-zinc-300'
                  }`}
                >
                  {dispatchSettings.options.standard.enabled ? 'Enabled' : 'Disabled'}
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] font-bold text-gray-500 dark:text-zinc-400 mb-1">
                    Display Label
                  </label>
                  <input
                    type="text"
                    value={dispatchSettings.options.standard.label}
                    onChange={(e) =>
                      setDispatchSettings((prev) => ({
                        ...prev,
                        options: {
                          ...prev.options,
                          standard: { ...prev.options.standard, label: e.target.value }
                        }
                      }))
                    }
                    className="w-full px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white font-medium"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 dark:text-zinc-400 mb-1">
                      Hold Minutes
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="30"
                      value={dispatchSettings.options.standard.holdMinutes}
                      onChange={(e) =>
                        setDispatchSettings((prev) => ({
                          ...prev,
                          options: {
                            ...prev.options,
                            standard: {
                              ...prev.options.standard,
                              holdMinutes: Math.max(1, Number(e.target.value))
                            }
                          }
                        }))
                      }
                      className="w-full px-2.5 py-1 text-xs rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white font-bold"
                    />
                    <span className="text-[9px] text-gray-400 mt-0.5 block">Default: 5 mins</span>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 dark:text-zinc-400 mb-1">
                      Max Batch
                    </label>
                    <input
                      type="number"
                      min="2"
                      max="6"
                      value={dispatchSettings.options.standard.maxBatch}
                      onChange={(e) =>
                        setDispatchSettings((prev) => ({
                          ...prev,
                          options: {
                            ...prev.options,
                            standard: {
                              ...prev.options.standard,
                              maxBatch: Math.max(2, Number(e.target.value))
                            }
                          }
                        }))
                      }
                      className="w-full px-2.5 py-1 text-xs rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white font-bold"
                    />
                    <span className="text-[9px] text-gray-400 mt-0.5 block">Default: 3 (min 2)</span>
                  </div>
                </div>

                {/* Ends when ready */}
                <div className="p-2.5 rounded-xl bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-700/80 flex items-center justify-between">
                  <div>
                    <span className="text-[11px] font-bold text-gray-800 dark:text-zinc-200 block">
                      Ends When Ready
                    </span>
                    <span className="text-[9px] text-gray-400">Release hold early if merchant marks Ready</span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={dispatchSettings.options.standard.endsWhenReady !== false}
                      onChange={(e) =>
                        setDispatchSettings((prev) => ({
                          ...prev,
                          options: {
                            ...prev.options,
                            standard: {
                              ...prev.options.standard,
                              endsWhenReady: e.target.checked
                            }
                          }
                        }))
                      }
                      className="w-4 h-4 rounded text-amber-500 accent-amber-500"
                    />
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 dark:text-zinc-400 mb-1">
                      Adjustment Type
                    </label>
                    <select
                      value={dispatchSettings.options.standard.feeAdjustType}
                      onChange={(e) =>
                        setDispatchSettings((prev) => ({
                          ...prev,
                          options: {
                            ...prev.options,
                            standard: {
                              ...prev.options.standard,
                              feeAdjustType: e.target.value as 'flat' | 'percent'
                            }
                          }
                        }))
                      }
                      className="w-full px-2 py-1 text-xs rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white font-semibold"
                    >
                      <option value="flat">₱ Flat</option>
                      <option value="percent">% Percent</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 dark:text-zinc-400 mb-1">
                      Fee Adjustment
                    </label>
                    <input
                      type="number"
                      value={dispatchSettings.options.standard.feeAdjustValue}
                      onChange={(e) =>
                        setDispatchSettings((prev) => ({
                          ...prev,
                          options: {
                            ...prev.options,
                            standard: {
                              ...prev.options.standard,
                              feeAdjustValue: Number(e.target.value)
                            }
                          }
                        }))
                      }
                      className="w-full px-2.5 py-1 text-xs rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-blue-600 font-black"
                    />
                    <span className="text-[9px] text-gray-400 mt-0.5 block">Default: ₱0</span>
                  </div>
                </div>

                <p className="text-[10px] text-gray-600 dark:text-zinc-400 leading-relaxed pt-1 border-t border-gray-200/60 dark:border-zinc-800">
                  Standard: the order is held for up to {dispatchSettings.options.standard.holdMinutes} minutes after the merchant accepts it, and the hold ends early if the merchant marks it Ready.
                </p>
              </div>
            </div>

            {/* Saver Option */}
            <div className={`p-4 rounded-2xl border transition-all ${
              dispatchSettings.options.saver.enabled
                ? 'bg-emerald-500/5 border-emerald-300 dark:border-emerald-800/80'
                : 'bg-gray-50 dark:bg-zinc-850 border-gray-200 dark:border-zinc-800 opacity-60'
            }`}>
              <div className="flex items-center justify-between pb-3 border-b border-gray-200 dark:border-zinc-700/60 mb-3">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-emerald-300 dark:ring-emerald-900" />
                  <span className="font-black text-sm text-gray-900 dark:text-white">Saver</span>
                  {dispatchSettings.defaultOption === 'saver' && (
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-emerald-500 text-white">
                      DEFAULT
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setDispatchSettings((prev) => ({
                      ...prev,
                      options: {
                        ...prev.options,
                        saver: {
                          ...prev.options.saver,
                          enabled: !prev.options.saver.enabled
                        }
                      }
                    }))
                  }
                  className={`text-xs font-extrabold px-2.5 py-1 rounded-lg ${
                    dispatchSettings.options.saver.enabled
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                      : 'bg-gray-200 text-gray-600 dark:bg-zinc-700 dark:text-zinc-300'
                  }`}
                >
                  {dispatchSettings.options.saver.enabled ? 'Enabled' : 'Disabled'}
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] font-bold text-gray-500 dark:text-zinc-400 mb-1">
                    Display Label
                  </label>
                  <input
                    type="text"
                    value={dispatchSettings.options.saver.label}
                    onChange={(e) =>
                      setDispatchSettings((prev) => ({
                        ...prev,
                        options: {
                          ...prev.options,
                          saver: { ...prev.options.saver, label: e.target.value }
                        }
                      }))
                    }
                    className="w-full px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white font-medium"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 dark:text-zinc-400 mb-1">
                      Hold Minutes
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="45"
                      value={dispatchSettings.options.saver.holdMinutes}
                      onChange={(e) =>
                        setDispatchSettings((prev) => ({
                          ...prev,
                          options: {
                            ...prev.options,
                            saver: {
                              ...prev.options.saver,
                              holdMinutes: Math.max(1, Number(e.target.value))
                            }
                          }
                        }))
                      }
                      className="w-full px-2.5 py-1 text-xs rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white font-bold"
                    />
                    <span className="text-[9px] text-gray-400 mt-0.5 block">Default: 10 mins</span>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 dark:text-zinc-400 mb-1">
                      Max Batch
                    </label>
                    <input
                      type="number"
                      min="2"
                      max="6"
                      value={dispatchSettings.options.saver.maxBatch}
                      onChange={(e) =>
                        setDispatchSettings((prev) => ({
                          ...prev,
                          options: {
                            ...prev.options,
                            saver: {
                              ...prev.options.saver,
                              maxBatch: Math.max(2, Number(e.target.value))
                            }
                          }
                        }))
                      }
                      className="w-full px-2.5 py-1 text-xs rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white font-bold"
                    />
                    <span className="text-[9px] text-gray-400 mt-0.5 block">Default: 3 (min 2)</span>
                  </div>
                </div>

                {/* Ends when ready */}
                <div className="p-2.5 rounded-xl bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-700/80 flex items-center justify-between">
                  <div>
                    <span className="text-[11px] font-bold text-gray-800 dark:text-zinc-200 block">
                      Ends When Ready
                    </span>
                    <span className="text-[9px] text-gray-400">Fixed duration (even if merchant marks Ready)</span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(dispatchSettings.options.saver.endsWhenReady)}
                      onChange={(e) =>
                        setDispatchSettings((prev) => ({
                          ...prev,
                          options: {
                            ...prev.options,
                            saver: {
                              ...prev.options.saver,
                              endsWhenReady: e.target.checked
                            }
                          }
                        }))
                      }
                      className="w-4 h-4 rounded text-emerald-500 accent-emerald-500"
                    />
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 dark:text-zinc-400 mb-1">
                      Adjustment Type
                    </label>
                    <select
                      value={dispatchSettings.options.saver.feeAdjustType}
                      onChange={(e) =>
                        setDispatchSettings((prev) => ({
                          ...prev,
                          options: {
                            ...prev.options,
                            saver: {
                              ...prev.options.saver,
                              feeAdjustType: e.target.value as 'flat' | 'percent'
                            }
                          }
                        }))
                      }
                      className="w-full px-2 py-1 text-xs rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white font-semibold"
                    >
                      <option value="flat">₱ Flat</option>
                      <option value="percent">% Percent</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 dark:text-zinc-400 mb-1">
                      Fee Adjustment
                    </label>
                    <input
                      type="number"
                      value={dispatchSettings.options.saver.feeAdjustValue}
                      onChange={(e) =>
                        setDispatchSettings((prev) => ({
                          ...prev,
                          options: {
                            ...prev.options,
                            saver: {
                              ...prev.options.saver,
                              feeAdjustValue: Number(e.target.value)
                            }
                          }
                        }))
                      }
                      className="w-full px-2.5 py-1 text-xs rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-emerald-600 font-black"
                    />
                    <span className="text-[9px] text-gray-400 mt-0.5 block">Default: -₱15</span>
                  </div>
                </div>

                <p className="text-[10px] text-gray-600 dark:text-zinc-400 leading-relaxed pt-1 border-t border-gray-200/60 dark:border-zinc-800">
                  Saver: the order is held for the exact {dispatchSettings.options.saver.holdMinutes} minutes, even if the merchant marks it Ready.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
      )}

      {/* PLATFORM SERVICE SWITCHES TAB */}
      {settingsTab === 'services' && (
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
              { id: 'food' as OrderServiceType, label: 'Delivio Food', subtitle: 'Food Delivery', desc: 'Restaurant meals & drinks' },
              { id: 'convenience' as OrderServiceType, label: 'Delivio Mart', subtitle: 'Convenience Store', desc: 'Grocery & daily essentials' },
              { id: 'parcel' as OrderServiceType, label: 'Delivio Parcel', subtitle: 'Parcel Express', desc: 'Package courier services' },
              { id: 'pabili' as OrderServiceType, label: 'Delivio Pabili', subtitle: 'Pabili Service', desc: 'Custom buy errands' },
              { id: 'request_rider' as OrderServiceType, label: 'Delivio Instant', subtitle: 'Request a Rider (merchant button)', desc: 'Point-to-point dedicated driver' },
              { id: 'taxi' as OrderServiceType, label: 'Delivio Taxi', subtitle: 'Taxi Service', desc: 'Passenger ride-hailing & transit' }
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
                    <span className="font-extrabold text-xs text-gray-900 dark:text-white block">
                      {svc.label}
                    </span>
                    <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-400 block">
                      {svc.subtitle}
                    </span>
                    <span className="text-[10px] text-gray-400">{svc.desc}</span>
                  </div>

                  <span
                    className={`px-2.5 py-1 rounded-full text-[11px] font-bold shrink-0 ${
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
      )}

      {/* DATABASE & TOOLS TAB */}
      {settingsTab === 'tools' && (
      <>
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
      </>
      )}

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

      {/* Confirmation Modal for Taxes & Fees Save */}
      {confirmSaveVatModalOpen && (
        <ConfirmationModal
          isOpen={confirmSaveVatModalOpen}
          onClose={() => setConfirmSaveVatModalOpen(false)}
          onConfirm={handleSaveTaxesAndFees}
          title="Save Taxes & Platform Timezone Settings?"
          message={`Are you sure you want to update platform VAT to ${vatEnabled ? 'ENABLED' : 'DISABLED'} (${vatPercent}%, mode: ${vatMode}, base: ${vatBase}) and timezone to "${timezone}"? This affects checkout pricing and operational schedules.`}
          confirmLabel="Save Changes"
          reasonRequired={false}
          isDestructive={false}
        />
      )}

      {/* Confirmation Modal for Dispatch Settings Save */}
      {confirmSaveDispatchModalOpen && (
        <ConfirmationModal
          isOpen={confirmSaveDispatchModalOpen}
          onClose={() => setConfirmSaveDispatchModalOpen(false)}
          onConfirm={handleConfirmSaveDispatch}
          title="Save Dispatch & Batching Settings?"
          message={`Are you sure you want to save dispatch settings? Default option is set to "${dispatchSettings.defaultOption.toUpperCase()}". Priority will enforce 0 holdMinutes and maxBatch 1. Driver search radius is ${dispatchSettings.searchRadiusKm} km.`}
          confirmLabel="Save Dispatch Settings"
          reasonRequired={false}
          isDestructive={false}
        />
      )}
    </div>
  );
};
