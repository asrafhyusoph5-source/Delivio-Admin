import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import {
  db,
  collection,
  doc,
  writeBatch,
  updateDoc,
  Timestamp
} from '../../firebase';
import { useToast } from '../../context/ToastContext';
import { logAuditEvent } from '../../utils/audit';
import {
  checkBranchCodeUniqueInChain,
  copyMerchantMenu,
  formatShopDisplayName,
  isValidBranchCode,
  isValidBranchName,
  normalizeBranchCode
} from '../../utils/outletUtils';
import type {
  City,
  Merchant,
  MerchantOperatingDay,
  MerchantWeeklyHours,
  UserProfile
} from '../../types';
import {
  Building2,
  Clock,
  Copy,
  Info,
  Loader2,
  MapPin,
  Search,
  Store,
  X
} from 'lucide-react';

interface AddOutletModalProps {
  isOpen: boolean;
  onClose: () => void;
  mainShop: Merchant;
  chainOutlets: Merchant[];
  cities: City[];
  defaultWeeklyHours: MerchantWeeklyHours;
  adminProfile: UserProfile | null;
  onSuccess: (createdOutlet: Merchant, updatedMainShop?: Merchant) => void;
}

export const AddOutletModal: React.FC<AddOutletModalProps> = ({
  isOpen,
  onClose,
  mainShop,
  chainOutlets,
  cities,
  defaultWeeklyHours,
  adminProfile,
  onSuccess
}) => {
  const { showError, showSuccess } = useToast();
  const isFirstOutlet = !mainShop.chainId;

  // Main shop branch fields (first time a shop gets an outlet)
  const [mainBranchName, setMainBranchName] = useState(mainShop.branchName || 'Main Branch');
  const [mainBranchCode, setMainBranchCode] = useState(mainShop.branchCode || 'MAIN');

  // New outlet fields
  const [letMerchantSet, setLetMerchantSet] = useState(false);
  const [branchName, setBranchName] = useState('');
  const [branchCode, setBranchCode] = useState('');
  const [displayName, setDisplayName] = useState(mainShop.name || '');
  const [phone, setPhone] = useState('');
  const [cityId, setCityId] = useState(mainShop.cityId || '');
  const [address, setAddress] = useState('');
  const [lat, setLat] = useState<number>(mainShop.lat || 9.7392);
  const [lng, setLng] = useState<number>(mainShop.lng || 118.7353);
  const [commissionRate, setCommissionRate] = useState<number>(mainShop.commissionRate ?? 15);
  const [copyHours, setCopyHours] = useState(true);
  const [customAutoSchedule, setCustomAutoSchedule] = useState<boolean>(Boolean(mainShop.autoSchedule));
  const [customHours, setCustomHours] = useState<MerchantWeeklyHours>(
    mainShop.hours ? JSON.parse(JSON.stringify(mainShop.hours)) : JSON.parse(JSON.stringify(defaultWeeklyHours))
  );
  const [copyMenuFromId, setCopyMenuFromId] = useState<string>(mainShop.id);

  // Map & search
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const [addrSearch, setAddrSearch] = useState('');
  const [searchingAddr, setSearchingAddr] = useState(false);
  const [addrResults, setAddrResults] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);

  // Initialize Leaflet pin map inside modal
  useEffect(() => {
    if (!isOpen || !mapContainerRef.current) return;

    const timer = setTimeout(() => {
      if (!mapContainerRef.current) return;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }

      const initLat = lat || 9.7392;
      const initLng = lng || 118.7353;

      const map = L.map(mapContainerRef.current, {
        center: [initLat, initLng],
        zoom: 15,
        zoomControl: false
      });

      L.control.zoom({ position: 'bottomright' }).addTo(map);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap'
      }).addTo(map);

      const marker = L.marker([initLat, initLng], { draggable: true }).addTo(map);
      marker.on('dragend', () => {
        const pos = marker.getLatLng();
        setLat(pos.lat);
        setLng(pos.lng);
      });

      map.on('click', (e: L.LeafletMouseEvent) => {
        marker.setLatLng(e.latlng);
        setLat(e.latlng.lat);
        setLng(e.latlng.lng);
      });

      markerRef.current = marker;
      mapInstanceRef.current = map;
      map.invalidateSize();
    }, 100);

    return () => {
      clearTimeout(timer);
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [isOpen]);

  const handleSearchAddress = async () => {
    if (!addrSearch.trim()) return;
    try {
      setSearchingAddr(true);
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&countrycodes=ph&q=${encodeURIComponent(
          addrSearch.trim()
        )}`
      );
      const data = await res.json();
      setAddrResults(data || []);
    } catch {
      showError('Failed to search address on OpenStreetMap.');
    } finally {
      setSearchingAddr(false);
    }
  };

  const handleSelectAddress = (res: any) => {
    const newLat = parseFloat(res.lat);
    const newLng = parseFloat(res.lon);
    setLat(newLat);
    setLng(newLng);
    setAddress(res.display_name || '');
    setAddrResults([]);
    if (mapInstanceRef.current && markerRef.current) {
      mapInstanceRef.current.flyTo([newLat, newLng], 16);
      markerRef.current.setLatLng([newLat, newLng]);
    }
  };

  const handleCityChange = (newCityId: string) => {
    setCityId(newCityId);
    const cityObj = cities.find((c) => c.id === newCityId);
    if (cityObj?.center?.lat && cityObj?.center?.lng && !address.trim()) {
      setLat(cityObj.center.lat);
      setLng(cityObj.center.lng);
      if (mapInstanceRef.current && markerRef.current) {
        mapInstanceRef.current.flyTo([cityObj.center.lat, cityObj.center.lng], 14);
        markerRef.current.setLatLng([cityObj.center.lat, cityObj.center.lng]);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const resolvedChainId = mainShop.id;
    const resolvedOwnerUid = mainShop.ownerUid || mainShop.id;
    const cleanDisplayName = displayName.trim() || mainShop.name;
    const cleanPhone = phone.trim();
    const cleanAddress = address.trim();

    if (!cleanDisplayName) {
      showError('Shop display name is required.');
      return;
    }

    if (!cleanAddress) {
      showError('Address is required for the new outlet.');
      return;
    }

    const cleanMainBranchName = mainBranchName.trim();
    const cleanMainBranchCode = normalizeBranchCode(mainBranchCode);

    if (isFirstOutlet) {
      if (!isValidBranchName(cleanMainBranchName)) {
        showError('Main shop branch name must be 2 to 40 characters.');
        return;
      }
      if (!isValidBranchCode(cleanMainBranchCode)) {
        showError('Main shop branch code must be 2 to 10 letters and numbers (A-Z, 0-9).');
        return;
      }
    }

    const cleanBranchName = letMerchantSet ? '' : branchName.trim();
    const cleanBranchCode = letMerchantSet ? '' : normalizeBranchCode(branchCode);

    if (!letMerchantSet) {
      if (!isValidBranchName(cleanBranchName)) {
        showError('Branch name must be 2 to 40 characters.');
        return;
      }
      if (!isValidBranchCode(cleanBranchCode)) {
        showError('Branch code must be 2 to 10 letters and numbers (A-Z, 0-9).');
        return;
      }
      if (isFirstOutlet && cleanBranchCode === cleanMainBranchCode) {
        showError('New outlet branch code must be different from the main shop branch code.');
        return;
      }
    }

    try {
      setSaving(true);

      // Query uniqueness check in Firestore on chainId + branchCode
      if (!letMerchantSet) {
        const isUnique = await checkBranchCodeUniqueInChain(resolvedChainId, cleanBranchCode);
        if (!isUnique) {
          showError(`Branch code "${cleanBranchCode}" is already used in this chain.`);
          setSaving(false);
          return;
        }
      }
      if (isFirstOutlet) {
        const isMainUnique = await checkBranchCodeUniqueInChain(
          resolvedChainId,
          cleanMainBranchCode,
          mainShop.id
        );
        if (!isMainUnique) {
          showError(`Main shop branch code "${cleanMainBranchCode}" is already used in this chain.`);
          setSaving(false);
          return;
        }
      }

      const now = Timestamp.now();
      const batch = writeBatch(db);
      let updatedMainShop: Merchant | undefined;

      if (isFirstOutlet) {
        const mainRef = doc(db, 'merchants', mainShop.id);
        const mainUpdate = {
          chainId: resolvedChainId,
          chainName: mainShop.name,
          ownerUid: resolvedOwnerUid,
          isBranch: false,
          branchName: cleanMainBranchName,
          branchCode: cleanMainBranchCode,
          branchSetupDone: true,
          updatedAt: now
        };
        batch.update(mainRef, mainUpdate);
        updatedMainShop = {
          ...mainShop,
          ...mainUpdate
        };
      }

      const newOutletRef = doc(collection(db, 'merchants'));
      const newOutletPayload: Record<string, any> = {
        chainId: resolvedChainId,
        chainName: mainShop.chainName || mainShop.name,
        ownerUid: resolvedOwnerUid,
        isBranch: true,
        branchName: cleanBranchName,
        branchCode: cleanBranchCode,
        branchSetupDone: !letMerchantSet,
        name: cleanDisplayName,
        ownerName: mainShop.ownerName || '',
        email: mainShop.email || '',
        phone: cleanPhone,
        lat: Number(lat) || mainShop.lat || 9.7392,
        lng: Number(lng) || mainShop.lng || 118.7353,
        address: cleanAddress,
        cityId: cityId || mainShop.cityId || '',
        type: mainShop.type || 'food',
        typeLocked: Boolean(mainShop.typeLocked),
        status: 'active',
        isOpen: true,
        commissionRate: Number.isFinite(Number(commissionRate)) ? Number(commissionRate) : (mainShop.commissionRate ?? 15),
        walletBalance: 0,
        closedUntil: null,
        logoUrl: mainShop.logoUrl || '',
        bannerUrl: mainShop.bannerUrl || '',
        description: mainShop.description || '',
        hours: copyHours ? (mainShop.hours || defaultWeeklyHours) : customHours,
        autoSchedule: copyHours ? Boolean(mainShop.autoSchedule) : customAutoSchedule,
        createdAt: now,
        updatedAt: now
      };

      batch.set(newOutletRef, newOutletPayload);
      await batch.commit();

      // Copy menu if requested (products, options, category classes, menu groups; NOT stock)
      let menuCopySummary = '';
      if (copyMenuFromId && copyMenuFromId !== 'none') {
        const copyRes = await copyMerchantMenu(copyMenuFromId, newOutletRef.id);
        menuCopySummary = ` (copied ${copyRes.itemsCopied} items, ${copyRes.menusCopied} menu groups, ${copyRes.subcategoriesCopied} category classes)`;
      }

      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        adminEmail: adminProfile?.email,
        action: 'CREATE_OUTLET',
        entityType: 'merchant',
        entityId: newOutletRef.id,
        details: `Added outlet ${formatShopDisplayName({
          name: cleanDisplayName,
          branchName: cleanBranchName,
          branchCode: cleanBranchCode
        }, true)} under chain ${mainShop.name} (${resolvedChainId})${menuCopySummary}`
      });

      const createdOutlet: Merchant = {
        id: newOutletRef.id,
        ...newOutletPayload
      } as Merchant;

      showSuccess(`Outlet created successfully${menuCopySummary}.`);
      onSuccess(createdOutlet, updatedMainShop);
      onClose();
    } catch (err: any) {
      showError(err);
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div
        className="w-full max-w-3xl max-h-[92vh] flex flex-col bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-gray-100 dark:border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-400 text-black">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-base text-gray-900 dark:text-white">
                {isFirstOutlet ? `Add First Outlet for ${mainShop.name}` : `Add New Outlet to ${mainShop.name}`}
              </h3>
              <p className="text-xs text-gray-500 dark:text-zinc-400">
                Chain ID: <code className="font-mono text-amber-600">{mainShop.id}</code>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
          {/* Shared Login Notice */}
          <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/60 flex items-start gap-2.5 text-blue-900 dark:text-blue-200">
            <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
            <span className="font-medium leading-relaxed">
              The owner's login (email and password) is shared. No new account is created.
            </span>
          </div>

          {/* First-time Main Shop Branch Info */}
          {isFirstOutlet && (
            <div className="p-4 rounded-xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 space-y-3">
              <div>
                <h4 className="font-extrabold text-xs uppercase tracking-wider text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
                  <Store className="w-3.5 h-3.5 text-amber-600" />
                  <span>Main Shop Branch Setup (First Outlet)</span>
                </h4>
                <p className="text-[11px] text-amber-800/80 dark:text-amber-300/80 mt-0.5">
                  Because this is the first outlet for <strong>{mainShop.name}</strong>, please assign the branch name and code for the existing main shop.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold uppercase text-gray-700 dark:text-zinc-300 mb-1">
                    Main Shop Branch Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={mainBranchName}
                    onChange={(e) => setMainBranchName(e.target.value)}
                    minLength={2}
                    maxLength={40}
                    required
                    placeholder="e.g. Palawan Main"
                    className="w-full px-3 py-2 rounded-xl border border-amber-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase text-gray-700 dark:text-zinc-300 mb-1">
                    Main Shop Branch Code <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={mainBranchCode}
                    onChange={(e) => setMainBranchCode(normalizeBranchCode(e.target.value))}
                    maxLength={10}
                    required
                    placeholder="e.g. MAIN"
                    className="w-full px-3 py-2 rounded-xl border border-amber-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white font-mono uppercase font-bold"
                  />
                </div>
              </div>
            </div>
          )}

          {/* New Outlet Identity */}
          <div className="p-4 rounded-xl bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-800 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-gray-200 dark:border-zinc-800">
              <h4 className="font-extrabold text-xs uppercase tracking-wider text-gray-800 dark:text-zinc-200">
                New Outlet Details
              </h4>
              <label className="flex items-center gap-2 cursor-pointer text-[11px] font-bold text-gray-700 dark:text-zinc-300 select-none">
                <input
                  type="checkbox"
                  checked={letMerchantSet}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setLetMerchantSet(checked);
                    if (checked) {
                      setBranchName('');
                      setBranchCode('');
                    }
                  }}
                  className="w-4 h-4 rounded-sm accent-amber-500"
                />
                <span>Let the merchant set branch name &amp; code</span>
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Branch Name {!letMerchantSet && <span className="text-red-500">*</span>}
                </label>
                <input
                  type="text"
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  disabled={letMerchantSet}
                  required={!letMerchantSet}
                  minLength={2}
                  maxLength={40}
                  placeholder={letMerchantSet ? 'Merchant will complete setup' : 'e.g. Palawan Rizal'}
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Branch Code {!letMerchantSet && <span className="text-red-500">*</span>}
                </label>
                <input
                  type="text"
                  value={branchCode}
                  onChange={(e) => setBranchCode(normalizeBranchCode(e.target.value))}
                  disabled={letMerchantSet}
                  required={!letMerchantSet}
                  maxLength={10}
                  placeholder={letMerchantSet ? 'Pending merchant setup' : 'e.g. RZL01 (A-Z, 0-9)'}
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white font-mono uppercase font-bold disabled:opacity-50"
                />
                <span className="text-[10px] text-gray-400 mt-0.5 block">
                  2–10 uppercase letters &amp; digits; must be unique in chain.
                </span>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Shop Display Name (Brand) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required
                  placeholder="e.g. Jollibee"
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white font-bold"
                />
                <span className="text-[10px] text-gray-400 mt-0.5 block">
                  Preview: <strong>{formatShopDisplayName({ name: displayName, branchName: letMerchantSet ? '' : branchName, branchCode: letMerchantSet ? '' : branchCode }, true)}</strong>
                </span>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Outlet Phone
                </label>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="e.g. 0917..."
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  City
                </label>
                <select
                  value={cityId}
                  onChange={(e) => handleCityChange(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white font-medium"
                >
                  <option value="">Select City</option>
                  {cities.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Commission Rate (%)
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  value={commissionRate}
                  onChange={(e) => setCommissionRate(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-amber-600 font-bold"
                />
              </div>
            </div>
          </div>

          {/* Address & Map Pin */}
          <div className="p-4 rounded-xl bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-800 space-y-3">
            <h4 className="font-extrabold text-xs uppercase tracking-wider text-gray-800 dark:text-zinc-200 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-amber-500" />
              <span>Address &amp; Map Pin</span>
            </h4>

            <div>
              <label className="block text-[11px] font-bold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                Outlet Street Address <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                required
                placeholder="Complete street address / landmark"
                className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
              />
            </div>

            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-gray-400" />
                <input
                  type="text"
                  value={addrSearch}
                  onChange={(e) => setAddrSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleSearchAddress();
                    }
                  }}
                  placeholder="Search OpenStreetMap Philippines..."
                  className="w-full pl-8 pr-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                />
              </div>
              <button
                type="button"
                onClick={handleSearchAddress}
                disabled={searchingAddr}
                className="px-3.5 py-2 rounded-xl bg-zinc-800 dark:bg-zinc-700 text-white font-bold hover:bg-zinc-700"
              >
                {searchingAddr ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Locate'}
              </button>
            </div>

            {addrResults.length > 0 && (
              <div className="max-h-28 overflow-y-auto divide-y divide-gray-100 dark:divide-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-900">
                {addrResults.map((r, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => handleSelectAddress(r)}
                    className="w-full text-left px-3 py-2 hover:bg-amber-50 dark:hover:bg-zinc-800 text-[11px]"
                  >
                    {r.display_name}
                  </button>
                ))}
              </div>
            )}

            <div
              ref={mapContainerRef}
              className="w-full h-48 rounded-xl overflow-hidden border border-gray-200 dark:border-zinc-700 bg-gray-100 dark:bg-zinc-800"
            />
            <div className="grid grid-cols-2 gap-3 text-[11px]">
              <div>
                <span className="text-gray-400 font-semibold">Latitude:</span>{' '}
                <span className="font-mono font-bold text-gray-800 dark:text-zinc-200">{lat.toFixed(6)}</span>
              </div>
              <div>
                <span className="text-gray-400 font-semibold">Longitude:</span>{' '}
                <span className="font-mono font-bold text-gray-800 dark:text-zinc-200">{lng.toFixed(6)}</span>
              </div>
            </div>
          </div>

          {/* Business Hours */}
          <div className="p-4 rounded-xl bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-800 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-amber-500" />
                <span className="font-extrabold text-xs uppercase tracking-wider text-gray-800 dark:text-zinc-200">
                  Business Hours
                </span>
              </div>
              <label className="flex items-center gap-2 cursor-pointer font-bold text-gray-700 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={copyHours}
                  onChange={(e) => setCopyHours(e.target.checked)}
                  className="w-4 h-4 rounded-sm accent-amber-500"
                />
                <span>Copy hours from main shop</span>
              </label>
            </div>

            {!copyHours && (
              <div className="space-y-2 pt-2 border-t border-gray-200 dark:border-zinc-800">
                <label className="flex items-center gap-2 cursor-pointer text-[11px] font-semibold">
                  <input
                    type="checkbox"
                    checked={customAutoSchedule}
                    onChange={(e) => setCustomAutoSchedule(e.target.checked)}
                    className="w-4 h-4 rounded-sm accent-amber-500"
                  />
                  <span>Enable Auto-Schedule</span>
                </label>
                {[
                  { k: 'monday', label: 'Monday' },
                  { k: 'tuesday', label: 'Tuesday' },
                  { k: 'wednesday', label: 'Wednesday' },
                  { k: 'thursday', label: 'Thursday' },
                  { k: 'friday', label: 'Friday' },
                  { k: 'saturday', label: 'Saturday' },
                  { k: 'sunday', label: 'Sunday' }
                ].map(({ k, label }) => {
                  const dayData: MerchantOperatingDay = customHours[k] || {
                    open: '08:00',
                    close: '22:00',
                    isOpen: true,
                    closed: false
                  };
                  const isClosed = Boolean(dayData.closed || dayData.isOpen === false);
                  return (
                    <div key={k} className="flex items-center justify-between gap-2 py-1 border-b border-gray-100 dark:border-zinc-800 last:border-0">
                      <label className="flex items-center gap-2 w-28 font-semibold">
                        <input
                          type="checkbox"
                          checked={!isClosed}
                          onChange={(e) =>
                            setCustomHours((prev) => ({
                              ...prev,
                              [k]: { ...dayData, closed: !e.target.checked, isOpen: e.target.checked }
                            }))
                          }
                          className="w-3.5 h-3.5 accent-amber-500"
                        />
                        <span>{label}</span>
                      </label>
                      {!isClosed ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="time"
                            value={dayData.open || '08:00'}
                            onChange={(e) =>
                              setCustomHours((prev) => ({
                                ...prev,
                                [k]: { ...dayData, open: e.target.value }
                              }))
                            }
                            className="px-2 py-1 rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 font-mono"
                          />
                          <span>—</span>
                          <input
                            type="time"
                            value={dayData.close || '22:00'}
                            onChange={(e) =>
                              setCustomHours((prev) => ({
                                ...prev,
                                [k]: { ...dayData, close: e.target.value }
                              }))
                            }
                            className="px-2 py-1 rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 font-mono"
                          />
                        </div>
                      ) : (
                        <span className="text-gray-400 italic">Closed</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Copy Menu From Outlet */}
          <div className="p-4 rounded-xl bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-800 space-y-2">
            <label className="flex items-center gap-1.5 font-extrabold text-xs uppercase tracking-wider text-gray-800 dark:text-zinc-200">
              <Copy className="w-4 h-4 text-amber-500" />
              <span>Copy the menu from</span>
            </label>
            <select
              value={copyMenuFromId}
              onChange={(e) => setCopyMenuFromId(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white font-semibold"
            >
              {chainOutlets.map((o) => (
                <option key={o.id} value={o.id}>
                  {formatShopDisplayName(o, true)} {o.id === mainShop.id ? '(Main)' : ''}
                </option>
              ))}
              <option value="none">Do not copy menu (start with empty catalog)</option>
            </select>
            <p className="text-[11px] text-gray-500 dark:text-zinc-400">
              Copies products, option sets, category classes, and menu groups using Push Menu matching rules (all items start in stock; stock flags are not copied).
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100 dark:border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 text-gray-700 dark:text-zinc-300 font-bold hover:bg-gray-50 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="delivio-btn-yellow px-5 py-2 rounded-xl font-extrabold flex items-center gap-2 shadow-xs"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>Create Outlet</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface EditOutletModalProps {
  isOpen: boolean;
  outlet: Merchant | null;
  chainId: string;
  adminProfile: UserProfile | null;
  onClose: () => void;
  onSuccess: (updatedOutlet: Merchant) => void;
}

export const EditOutletModal: React.FC<EditOutletModalProps> = ({
  isOpen,
  outlet,
  chainId,
  adminProfile,
  onClose,
  onSuccess
}) => {
  const { showError, showSuccess } = useToast();

  const [branchName, setBranchName] = useState('');
  const [branchCode, setBranchCode] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [lat, setLat] = useState<number>(9.7392);
  const [lng, setLng] = useState<number>(118.7353);
  const [status, setStatus] = useState<'active' | 'suspended'>('active');
  const [commissionRate, setCommissionRate] = useState<number>(15);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (outlet) {
      setBranchName(outlet.branchName || '');
      setBranchCode(outlet.branchCode || '');
      setPhone(outlet.phone || '');
      setAddress(outlet.address || '');
      setLat(outlet.lat || 9.7392);
      setLng(outlet.lng || 118.7353);
      setStatus(outlet.status === 'suspended' ? 'suspended' : 'active');
      setCommissionRate(outlet.commissionRate ?? 15);
    }
  }, [outlet]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!outlet) return;

    const cleanBranchName = branchName.trim();
    const cleanBranchCode = normalizeBranchCode(branchCode);

    if (!isValidBranchName(cleanBranchName)) {
      showError('Branch name must be 2 to 40 characters.');
      return;
    }
    if (!isValidBranchCode(cleanBranchCode)) {
      showError('Branch code must be 2 to 10 letters and numbers (A-Z, 0-9).');
      return;
    }

    try {
      setSaving(true);
      const isUnique = await checkBranchCodeUniqueInChain(chainId, cleanBranchCode, outlet.id);
      if (!isUnique) {
        showError(`Branch code "${cleanBranchCode}" is already used in this chain.`);
        setSaving(false);
        return;
      }

      const updates: Record<string, any> = {
        branchName: cleanBranchName,
        branchCode: cleanBranchCode,
        branchSetupDone: true,
        phone: phone.trim(),
        address: address.trim(),
        lat: Number(lat) || outlet.lat || 0,
        lng: Number(lng) || outlet.lng || 0,
        status,
        ...(status === 'suspended' ? { isOpen: false } : {}),
        commissionRate: Number(commissionRate) || 15,
        updatedAt: Timestamp.now()
      };

      await updateDoc(doc(db, 'merchants', outlet.id), updates);

      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        adminEmail: adminProfile?.email,
        action: 'EDIT_OUTLET',
        entityType: 'merchant',
        entityId: outlet.id,
        details: `Updated outlet ${formatShopDisplayName({
          name: outlet.name,
          branchName: cleanBranchName,
          branchCode: cleanBranchCode
        }, true)} (status: ${status}, commission: ${updates.commissionRate}%)`
      });

      const updatedOutlet: Merchant = {
        ...outlet,
        ...updates
      } as Merchant;

      showSuccess('Outlet updated.');
      onSuccess(updatedOutlet);
      onClose();
    } catch (err: any) {
      showError(err);
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen || !outlet) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div
        className="w-full max-w-lg bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-gray-100 dark:border-zinc-800 flex items-center justify-between">
          <div>
            <h3 className="font-extrabold text-base text-gray-900 dark:text-white">
              Edit Outlet: {formatShopDisplayName(outlet, true)}
            </h3>
            <p className="text-xs text-gray-500">ID: {outlet.id}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                Branch Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={branchName}
                onChange={(e) => setBranchName(e.target.value)}
                required
                minLength={2}
                maxLength={40}
                className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                Branch Code <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={branchCode}
                onChange={(e) => setBranchCode(normalizeBranchCode(e.target.value))}
                required
                maxLength={10}
                className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white font-mono uppercase font-bold"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                Phone
              </label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                Commission Rate (%)
              </label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={commissionRate}
                onChange={(e) => setCommissionRate(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-amber-600 font-bold"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase text-gray-600 dark:text-zinc-400 mb-1">
              Address
            </label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              required
              className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                Latitude
              </label>
              <input
                type="number"
                step="any"
                value={lat}
                onChange={(e) => setLat(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 font-mono text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                Longitude
              </label>
              <input
                type="number"
                step="any"
                value={lng}
                onChange={(e) => setLng(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 font-mono text-gray-900 dark:text-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase text-gray-600 dark:text-zinc-400 mb-1">
              Status
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as 'active' | 'suspended')}
              className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white font-bold"
            >
              <option value="active">Active</option>
              <option value="suspended">Suspended (Deactivated)</option>
            </select>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 text-gray-700 dark:text-zinc-300 font-bold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="delivio-btn-yellow px-5 py-2 rounded-xl font-extrabold flex items-center gap-2"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>Save Changes</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
