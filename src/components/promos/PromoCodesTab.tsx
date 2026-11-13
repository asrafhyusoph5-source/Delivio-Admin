import React, { useState, useEffect, useMemo } from 'react';
import {
  db,
  collection,
  getDocs,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  Timestamp
} from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { logAuditEvent } from '../../utils/audit';
import type { PromoCode, PromoRedemption, OrderServiceType } from '../../types';
import { SERVICE_NAMES } from '../../constants';
import { formatShopDisplayName } from '../../utils/outletUtils';
import {
  Ticket,
  Plus,
  Edit,
  Trash2,
  CheckCircle2,
  XCircle,
  Search,
  Filter,
  Loader2,
  Receipt,
  Store,
  Eye,
  EyeOff,
  Copy,
  DollarSign,
  Tag,
  Check,
  Calendar,
  AlertCircle,
  ExternalLink,
  Sparkles
} from 'lucide-react';
import { ConfirmationModal } from '../common/ConfirmationModal';

export interface PromoCodesTabProps {
  embeddedMerchantId?: string;
  embeddedMerchantName?: string;
}

export const PromoCodesTab: React.FC<PromoCodesTabProps> = ({
  embeddedMerchantId,
  embeddedMerchantName
}) => {
  const { adminProfile, isFullAdmin } = useAuth();
  const { showSuccess, showError } = useToast();

  const [codes, setCodes] = useState<PromoCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  // Source filter (All, Platform, Merchant)
  const [sourceFilter, setSourceFilter] = useState<'all' | 'platform' | 'merchant'>(
    embeddedMerchantId ? 'merchant' : 'all'
  );
  // Merchant name filter
  const [merchantNameFilter, setMerchantNameFilter] = useState<string>('all');

  // Merchants directory for lookup and picker
  const [merchantsList, setMerchantsList] = useState<{ id: string; name: string }[]>([]);
  const [merchantsMap, setMerchantsMap] = useState<Record<string, { id: string; name: string }>>({});

  // Feedback on copying code
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Create / Edit Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [codeName, setCodeName] = useState('');
  const [codeSource, setCodeSource] = useState<'platform' | 'merchant'>(
    embeddedMerchantId ? 'merchant' : 'platform'
  );
  const [voucherMerchantId, setVoucherMerchantId] = useState<string>(embeddedMerchantId || '');
  const [voucherTitle, setVoucherTitle] = useState('');
  const [voucherVisibility, setVoucherVisibility] = useState<'public' | 'hidden'>('public');

  const [active, setActive] = useState(true);
  const [type, setType] = useState<'percent' | 'fixed'>('percent');
  const [value, setValue] = useState<number>(10);
  const [minSubtotal, setMinSubtotal] = useState<number>(150);
  const [usageLimit, setUsageLimit] = useState<number | ''>(500);
  const [perUserLimit, setPerUserLimit] = useState<number>(1);
  const [hasExpiry, setHasExpiry] = useState(true);
  const [expiryDate, setExpiryDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().split('T')[0];
  });
  const [selectedServices, setSelectedServices] = useState<OrderServiceType[]>([
    'food',
    'convenience',
    'parcel',
    'pabili',
    'request_rider',
    'taxi'
  ]);
  const [saving, setSaving] = useState(false);

  // Redemptions History Modal
  const [viewingRedemptionsCode, setViewingRedemptionsCode] = useState<string | null>(null);
  const [viewingRedemptionsTitle, setViewingRedemptionsTitle] = useState<string>('');
  const [viewingRedemptionsMerchant, setViewingRedemptionsMerchant] = useState<string>('');
  const [viewingTotalDiscount, setViewingTotalDiscount] = useState<number>(0);
  const [redemptions, setRedemptions] = useState<PromoRedemption[]>([]);
  const [loadingRedemptions, setLoadingRedemptions] = useState(false);

  // Delete confirmation
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [codeToDelete, setCodeToDelete] = useState<PromoCode | null>(null);

  const fetchPromoCodes = async () => {
    try {
      setLoading(true);

      // 1. Fetch merchants directory for lookup
      const mSnap = await getDocs(collection(db, 'merchants'));
      const mMap: Record<string, { id: string; name: string }> = {};
      const mArr: { id: string; name: string }[] = [];
      mSnap.forEach((d) => {
        const dt = d.data();
        const rawName = dt.businessName || dt.name || d.id;
        const name = formatShopDisplayName(
          { name: rawName, branchName: dt.branchName, branchCode: dt.branchCode },
          true
        );
        mMap[d.id] = { id: d.id, name };
        mArr.push({ id: d.id, name });
      });
      mArr.sort((a, b) => a.name.localeCompare(b.name));
      setMerchantsMap(mMap);
      setMerchantsList(mArr);

      // 2. Fetch promoCodes collection
      const snap = await getDocs(collection(db, 'promoCodes'));
      const items: PromoCode[] = [];
      snap.forEach((d) => {
        const dt = d.data();
        const mId = dt.merchantId || null;
        const isMerchant = dt.source === 'merchant' || Boolean(mId);
        const mName = (mId && mMap[mId] ? mMap[mId].name : null) || dt.merchantName || null;

        items.push({
          id: d.id,
          code: d.id,
          active: Boolean(dt.active),
          type: dt.type || 'percent',
          value: Number(dt.value ?? 0),
          minSubtotal: Number(dt.minSubtotal ?? 0),
          expiresAt: dt.expiresAt || null,
          usageLimit: dt.usageLimit != null ? Number(dt.usageLimit) : null,
          perUserLimit: Number(dt.perUserLimit ?? 1),
          usedCount: Number(dt.usedCount ?? dt.uses ?? 0),
          services: Array.isArray(dt.services) ? dt.services : ['food', 'convenience'],
          source: isMerchant ? 'merchant' : 'platform',
          merchantId: mId,
          merchantName: mName,
          title: dt.title || (isMerchant ? (dt.name || `${mName || 'Shop'} Voucher`) : ''),
          visibility: dt.visibility || 'public',
          uses: Number(dt.uses ?? dt.usedCount ?? 0),
          totalDiscount: Number(dt.totalDiscount ?? 0)
        });
      });

      // Sort: active first, then code
      items.sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0) || a.code.localeCompare(b.code));
      setCodes(items);
    } catch (err: any) {
      showError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPromoCodes();
  }, [embeddedMerchantId]);

  const handleCopyCode = (code: string) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(code);
    }
    setCopiedCode(code);
    showSuccess(`Copied "${code}" to clipboard!`);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const handleOpenCreate = () => {
    setIsEditing(false);
    setCodeName('');
    setCodeSource(embeddedMerchantId ? 'merchant' : 'platform');
    setVoucherMerchantId(embeddedMerchantId || (merchantsList[0]?.id || ''));
    setVoucherTitle('');
    setVoucherVisibility('public');
    setActive(true);
    setType('percent');
    setValue(15);
    setMinSubtotal(150);
    setUsageLimit(500);
    setPerUserLimit(1);
    setHasExpiry(true);
    const d = new Date();
    d.setDate(d.getDate() + 30);
    setExpiryDate(d.toISOString().split('T')[0]);
    setSelectedServices(['food', 'convenience', 'parcel', 'pabili', 'request_rider', 'taxi']);
    setModalOpen(true);
  };

  const handleOpenEdit = (p: PromoCode) => {
    setIsEditing(true);
    setCodeName(p.code);
    setCodeSource(p.source === 'merchant' ? 'merchant' : 'platform');
    setVoucherMerchantId(p.merchantId || embeddedMerchantId || '');
    setVoucherTitle(p.title || '');
    setVoucherVisibility((p.visibility as 'public' | 'hidden') || 'public');
    setActive(p.active);
    setType(p.type);
    setValue(p.value);
    setMinSubtotal(p.minSubtotal);
    setUsageLimit(p.usageLimit != null ? p.usageLimit : '');
    setPerUserLimit(p.perUserLimit ?? 1);
    if (p.expiresAt) {
      setHasExpiry(true);
      const expDate = p.expiresAt.toDate ? p.expiresAt.toDate() : new Date(p.expiresAt);
      setExpiryDate(expDate.toISOString().split('T')[0]);
    } else {
      setHasExpiry(false);
    }
    setSelectedServices((p.services || []) as OrderServiceType[]);
    setModalOpen(true);
  };

  const handleToggleService = (svc: OrderServiceType) => {
    setSelectedServices((prev) =>
      prev.includes(svc) ? prev.filter((s) => s !== svc) : [...prev, svc]
    );
  };

  const handleSavePromoCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = codeName.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    if (!cleanCode) {
      showError('Please enter a valid code (uppercase letters, numbers, underscores).');
      return;
    }

    const isMerchant = codeSource === 'merchant';
    const targetMerchantId = embeddedMerchantId || voucherMerchantId;

    if (isMerchant && !targetMerchantId) {
      showError('Please select a merchant for this merchant voucher.');
      return;
    }

    if (Number(value) <= 0) {
      showError('Discount value must be greater than zero.');
      return;
    }
    if (type === 'percent' && value > 100) {
      showError('Percentage discount cannot exceed 100%.');
      return;
    }
    if (selectedServices.length === 0) {
      showError('Select at least one applicable Delivio service.');
      return;
    }

    try {
      setSaving(true);
      let expiresTimestamp: Timestamp | null = null;
      if (hasExpiry && expiryDate) {
        expiresTimestamp = Timestamp.fromDate(new Date(`${expiryDate}T23:59:59`));
      }

      const targetMerchantName = isMerchant
        ? (embeddedMerchantName || (targetMerchantId ? merchantsMap[targetMerchantId]?.name : null) || 'Merchant Voucher')
        : null;

      const payload: Record<string, any> = {
        active,
        type,
        value: Number(value),
        minSubtotal: Number(minSubtotal) || 0,
        expiresAt: expiresTimestamp,
        usageLimit: usageLimit === '' ? null : Number(usageLimit),
        perUserLimit: Math.max(1, Number(perUserLimit) || 1),
        services: selectedServices,
        source: isMerchant ? 'merchant' : 'platform',
        updatedAt: Timestamp.now()
      };

      if (isMerchant) {
        payload.merchantId = targetMerchantId;
        payload.merchantName = targetMerchantName;
        payload.title = voucherTitle.trim() || `${targetMerchantName} Voucher`;
        payload.visibility = voucherVisibility;
      } else {
        payload.merchantId = null;
        payload.merchantName = null;
        payload.title = null;
        payload.visibility = 'public';
      }

      if (!isEditing) {
        await setDoc(doc(db, 'promoCodes', cleanCode), {
          ...payload,
          uses: 0,
          usedCount: 0,
          totalDiscount: 0,
          createdAt: Timestamp.now(),
          createdBy: adminProfile?.email || 'admin'
        });

        await logAuditEvent({
          adminId: adminProfile?.uid || 'admin',
          adminName: adminProfile?.name || 'Administrator',
          adminEmail: adminProfile?.email,
          action: isMerchant ? 'CREATE_MERCHANT_VOUCHER' : 'CREATE_PROMO_CODE',
          entityType: 'promoCodes',
          entityId: cleanCode,
          details: `Created ${isMerchant ? `merchant voucher for ${targetMerchantName}` : 'platform promo code'} "${cleanCode}" (${type === 'percent' ? `${value}% off` : `₱${value} off`})`
        });

        showSuccess(`${isMerchant ? 'Merchant voucher' : 'Promo code'} "${cleanCode}" created successfully.`);
      } else {
        await updateDoc(doc(db, 'promoCodes', cleanCode), payload);

        await logAuditEvent({
          adminId: adminProfile?.uid || 'admin',
          adminName: adminProfile?.name || 'Administrator',
          adminEmail: adminProfile?.email,
          action: isMerchant ? 'UPDATE_MERCHANT_VOUCHER' : 'UPDATE_PROMO_CODE',
          entityType: 'promoCodes',
          entityId: cleanCode,
          details: `Updated ${isMerchant ? 'merchant voucher' : 'promo code'} "${cleanCode}"`
        });

        showSuccess(`${isMerchant ? 'Merchant voucher' : 'Promo code'} "${cleanCode}" updated.`);
      }

      setModalOpen(false);
      fetchPromoCodes();
    } catch (err: any) {
      showError(err);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (p: PromoCode) => {
    try {
      const newActive = !p.active;
      await updateDoc(doc(db, 'promoCodes', p.code), {
        active: newActive,
        updatedAt: Timestamp.now()
      });
      showSuccess(
        `${p.source === 'merchant' ? 'Merchant voucher' : 'Promo code'} "${p.code}" ${
          newActive ? 'activated' : 'deactivated'
        }.`
      );
      setCodes((prev) =>
        prev.map((c) => (c.code === p.code ? { ...c, active: newActive } : c))
      );
    } catch (err: any) {
      showError(err);
    }
  };

  const handleDeleteCode = async () => {
    if (!codeToDelete) return;
    try {
      await deleteDoc(doc(db, 'promoCodes', codeToDelete.code));

      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        adminEmail: adminProfile?.email,
        action: 'DELETE_PROMO_CODE',
        entityType: 'promoCodes',
        entityId: codeToDelete.code,
        details: `Deleted ${codeToDelete.source === 'merchant' ? 'merchant voucher' : 'promo code'} "${codeToDelete.code}"`
      });

      showSuccess(`"${codeToDelete.code}" deleted permanently.`);
      setDeleteModalOpen(false);
      setCodeToDelete(null);
      setCodes((prev) => prev.filter((c) => c.code !== codeToDelete.code));
    } catch (err: any) {
      showError(err);
    }
  };

  const handleViewRedemptions = async (
    code: string,
    title?: string,
    merchant?: string,
    initialTotalDiscount?: number
  ) => {
    try {
      setViewingRedemptionsCode(code);
      setViewingRedemptionsTitle(title || '');
      setViewingRedemptionsMerchant(merchant || '');
      setViewingTotalDiscount(initialTotalDiscount || 0);
      setLoadingRedemptions(true);

      const q = query(
        collection(db, 'promoRedemptions'),
        where('code', '==', code)
      );
      const snap = await getDocs(q);
      const list: PromoRedemption[] = [];
      let sumDiscount = 0;
      snap.forEach((d) => {
        const dt = d.data();
        const disc = Number(dt.discount ?? 0);
        sumDiscount += disc;
        list.push({
          id: d.id,
          code: dt.code,
          customerId: dt.customerId,
          orderId: dt.orderId,
          discount: disc,
          createdAt: dt.createdAt
        });
      });
      list.sort((a, b) => {
        const tA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
        const tB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
        return tB - tA;
      });
      setRedemptions(list);
      setViewingTotalDiscount(sumDiscount || initialTotalDiscount || 0);

      // Auto-sync computed totalDiscount and uses to promoCodes if changed
      if (sumDiscount > 0) {
        await updateDoc(doc(db, 'promoCodes', code), {
          totalDiscount: sumDiscount,
          uses: list.length,
          usedCount: list.length
        }).catch(() => {});
        setCodes((prev) =>
          prev.map((c) =>
            c.code === code ? { ...c, totalDiscount: sumDiscount, uses: list.length, usedCount: list.length } : c
          )
        );
      }
    } catch (err: any) {
      showError(err);
    } finally {
      setLoadingRedemptions(false);
    }
  };

  // Distinct merchants that have vouchers
  const merchantsWithVouchers = useMemo(() => {
    const counts: Record<string, { id: string; name: string; count: number }> = {};
    codes.forEach((c) => {
      if (c.merchantId) {
        if (!counts[c.merchantId]) {
          counts[c.merchantId] = {
            id: c.merchantId,
            name: c.merchantName || merchantsMap[c.merchantId]?.name || c.merchantId,
            count: 0
          };
        }
        counts[c.merchantId].count++;
      }
    });
    return Object.values(counts).sort((a, b) => a.name.localeCompare(b.name));
  }, [codes, merchantsMap]);

  // Scoped / Filtered codes list
  const filteredCodes = useMemo(() => {
    return codes.filter((c) => {
      // 1. Embedded merchant scope:
      if (embeddedMerchantId) {
        if (c.merchantId !== embeddedMerchantId) return false;
      } else {
        // 2. Source filter: All, Platform, Merchant
        if (sourceFilter === 'platform') {
          if (c.source === 'merchant' || c.merchantId) return false;
        } else if (sourceFilter === 'merchant') {
          if (c.source !== 'merchant' && !c.merchantId) return false;
        }

        // 3. Merchant Name filter (when source is All or Merchant)
        if (merchantNameFilter !== 'all') {
          if (c.merchantId !== merchantNameFilter) return false;
        }
      }

      // 4. Status filter:
      if (statusFilter === 'active' && !c.active) return false;
      if (statusFilter === 'inactive' && c.active) return false;

      // 5. Search query:
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchCode = c.code.toLowerCase().includes(q);
        const matchTitle = (c.title || '').toLowerCase().includes(q);
        const matchMerchant = (c.merchantName || '').toLowerCase().includes(q);
        if (!matchCode && !matchTitle && !matchMerchant) return false;
      }

      return true;
    });
  }, [
    codes,
    embeddedMerchantId,
    sourceFilter,
    merchantNameFilter,
    statusFilter,
    searchQuery
  ]);

  // Overall counts
  const allCount = codes.length;
  const platformCount = codes.filter((c) => c.source !== 'merchant' && !c.merchantId).length;
  const merchantCount = codes.filter((c) => c.source === 'merchant' || Boolean(c.merchantId)).length;

  return (
    <div className="space-y-6">
      {/* Top action bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-extrabold text-gray-900 dark:text-white flex items-center gap-2">
            {embeddedMerchantId ? (
              <>
                <Store className="w-5 h-5 text-amber-500" />
                <span>Shop Vouchers - {embeddedMerchantName || 'Merchant'}</span>
              </>
            ) : (
              <>
                <Ticket className="w-5 h-5 text-amber-500" />
                <span>Promo Codes & Merchant Vouchers</span>
              </>
            )}
          </h2>
          <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">
            {embeddedMerchantId
              ? `Manage custom store discount vouchers, visibility, and track customer redemptions for this merchant.`
              : `Configure platform checkout discount codes (no merchantId) and store merchant vouchers (source "merchant").`}
          </p>
        </div>

        <button
          type="button"
          onClick={handleOpenCreate}
          className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-amber-400 text-black hover:bg-amber-500 text-xs font-bold transition-all shadow-xs self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>{embeddedMerchantId ? 'New Shop Voucher' : 'Create Code / Voucher'}</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-4 shadow-xs space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Source Filter: All, Platform, Merchant (shown on global view) */}
          {!embeddedMerchantId && (
            <div className="flex items-center gap-1.5 p-1 bg-gray-100 dark:bg-zinc-800/80 rounded-2xl w-fit">
              <button
                type="button"
                onClick={() => {
                  setSourceFilter('all');
                  setMerchantNameFilter('all');
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                  sourceFilter === 'all'
                    ? 'bg-amber-400 text-black shadow-xs'
                    : 'text-gray-600 dark:text-zinc-400 hover:text-gray-900'
                }`}
              >
                <span>All</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-black/10 dark:bg-white/10">
                  {allCount}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setSourceFilter('platform');
                  setMerchantNameFilter('all');
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                  sourceFilter === 'platform'
                    ? 'bg-amber-400 text-black shadow-xs'
                    : 'text-gray-600 dark:text-zinc-400 hover:text-gray-900'
                }`}
              >
                <Ticket className="w-3.5 h-3.5" />
                <span>Platform</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-black/10 dark:bg-white/10">
                  {platformCount}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setSourceFilter('merchant')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                  sourceFilter === 'merchant'
                    ? 'bg-amber-400 text-black shadow-xs'
                    : 'text-gray-600 dark:text-zinc-400 hover:text-gray-900'
                }`}
              >
                <Store className="w-3.5 h-3.5" />
                <span>Merchant</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-black/10 dark:bg-white/10">
                  {merchantCount}
                </span>
              </button>
            </div>
          )}

          {/* Status Filter */}
          <div className="flex items-center gap-1.5 overflow-x-auto">
            {[
              { id: 'all' as const, label: 'All Status' },
              { id: 'active' as const, label: 'Active Only' },
              { id: 'inactive' as const, label: 'Inactive' }
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  statusFilter === tab.id
                    ? 'bg-gray-900 text-white dark:bg-white dark:text-zinc-900 shadow-xs'
                    : 'text-gray-600 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Secondary Row: Merchant Filter Dropdown & Search Input */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-gray-100 dark:border-zinc-800">
          {!embeddedMerchantId && (sourceFilter === 'all' || sourceFilter === 'merchant') ? (
            <div className="flex items-center gap-2 flex-1 max-w-sm">
              <Store className="w-4 h-4 text-gray-400 shrink-0" />
              <select
                value={merchantNameFilter}
                onChange={(e) => setMerchantNameFilter(e.target.value)}
                className="w-full px-3 py-1.5 rounded-xl border border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-850 text-xs font-bold text-gray-800 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-amber-400"
              >
                <option value="all">Filter by Merchant: All Merchants</option>
                {merchantsWithVouchers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.count} voucher{m.count !== 1 ? 's' : ''})
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="text-xs text-gray-500 font-semibold">
              Showing {filteredCodes.length} {embeddedMerchantId ? 'voucher(s)' : 'item(s)'}
            </div>
          )}

          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search code, title, or shop..."
              className="w-full pl-9 pr-4 py-1.5 rounded-xl border border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-850 text-xs font-mono text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>
        </div>
      </div>

      {/* Grid of Codes & Vouchers */}
      {loading ? (
        <div className="p-12 text-center bg-white dark:bg-zinc-900 rounded-3xl border border-gray-200 dark:border-zinc-800">
          <Loader2 className="w-8 h-8 animate-spin text-amber-500 mx-auto mb-2" />
          <p className="text-xs text-gray-500">Loading codes and vouchers...</p>
        </div>
      ) : filteredCodes.length === 0 ? (
        <div className="p-12 text-center bg-white dark:bg-zinc-900 rounded-3xl border border-gray-200 dark:border-zinc-800 space-y-3">
          {sourceFilter === 'merchant' || embeddedMerchantId ? (
            <Store className="w-10 h-10 text-gray-300 mx-auto" />
          ) : (
            <Ticket className="w-10 h-10 text-gray-300 mx-auto" />
          )}
          <h4 className="text-sm font-bold text-gray-900 dark:text-white">
            {embeddedMerchantId
              ? 'No Vouchers Found for this Shop'
              : 'No Promo Codes or Vouchers Found'}
          </h4>
          <p className="text-xs text-gray-500 max-w-sm mx-auto">
            {embeddedMerchantId
              ? 'Create custom store discount vouchers for this merchant to incentivize customer orders.'
              : 'Try clearing your filters or create a new platform promo code or merchant voucher.'}
          </p>
          <button
            type="button"
            onClick={handleOpenCreate}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-400 text-black text-xs font-bold hover:bg-amber-500 transition-all shadow-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{embeddedMerchantId ? 'Add First Voucher' : 'Create Promo Code'}</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredCodes.map((p) => {
            const isMerchant = p.source === 'merchant' || Boolean(p.merchantId);
            const isExpired =
              p.expiresAt &&
              (p.expiresAt.toMillis ? p.expiresAt.toMillis() : new Date(p.expiresAt).getTime()) < Date.now();
            const isLimitReached = p.usageLimit != null && p.usedCount >= p.usageLimit;
            const usesCount = p.uses ?? p.usedCount ?? 0;
            const totalDisc = p.totalDiscount ?? 0;

            return (
              <div
                key={p.code}
                className={`p-5 rounded-3xl border transition-all space-y-4 flex flex-col justify-between ${
                  p.active && !isExpired && !isLimitReached
                    ? 'bg-white dark:bg-zinc-900 border-gray-200 dark:border-zinc-800 shadow-xs hover:border-amber-400'
                    : 'bg-gray-50/70 dark:bg-zinc-900/40 border-gray-200 dark:border-zinc-800 opacity-75'
                }`}
              >
                <div className="space-y-3">
                  {/* Badge & Source Indicator */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {isMerchant ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-violet-100 text-violet-800 dark:bg-violet-950/80 dark:text-violet-300 border border-violet-200 dark:border-violet-900">
                            <Store className="w-3 h-3" />
                            <span>Merchant Voucher</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-blue-100 text-blue-800 dark:bg-blue-950/80 dark:text-blue-300 border border-blue-200 dark:border-blue-900">
                            <Ticket className="w-3 h-3" />
                            <span>Platform Code</span>
                          </span>
                        )}

                        {/* Visibility (for merchant vouchers) */}
                        {isMerchant && (
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold ${
                              p.visibility === 'hidden'
                                ? 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                                : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                            }`}
                          >
                            {p.visibility === 'hidden' ? (
                              <>
                                <EyeOff className="w-3 h-3" />
                                <span>Hidden</span>
                              </>
                            ) : (
                              <>
                                <Eye className="w-3 h-3" />
                                <span>Public</span>
                              </>
                            )}
                          </span>
                        )}
                      </div>

                      {/* Merchant name (if merchant voucher) */}
                      {isMerchant && (
                        <div className="flex items-center gap-1 text-xs font-extrabold text-gray-900 dark:text-white truncate">
                          <Store className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                          <span className="truncate">
                            {p.merchantName || (p.merchantId ? merchantsMap[p.merchantId]?.name : 'Shop')}
                          </span>
                        </div>
                      )}

                      {/* Title */}
                      {p.title && (
                        <p className="text-xs font-bold text-gray-700 dark:text-zinc-300 truncate">
                          {p.title}
                        </p>
                      )}
                    </div>

                    {/* Status Pill */}
                    <div className="shrink-0">
                      {isExpired ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400">
                          Expired
                        </span>
                      ) : isLimitReached ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-400">
                          Exhausted
                        </span>
                      ) : p.active ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                          Active
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-gray-200 text-gray-700 dark:bg-zinc-800 dark:text-zinc-400">
                          Disabled
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Code & Copy button + Discount Value */}
                  <div className="flex items-center justify-between gap-2 p-2.5 rounded-2xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200/80 dark:border-amber-900/50">
                    <button
                      type="button"
                      onClick={() => handleCopyCode(p.code)}
                      title="Click to copy code"
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white dark:bg-zinc-850 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-300 font-mono font-black text-sm tracking-wider hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors"
                    >
                      <span>{p.code}</span>
                      {copiedCode === p.code ? (
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="w-3.5 h-3.5 text-amber-600 opacity-60 hover:opacity-100" />
                      )}
                    </button>

                    <div className="text-right">
                      <span className="text-lg font-black text-gray-900 dark:text-white">
                        {p.type === 'percent' ? `${p.value}% OFF` : `₱${p.value} OFF`}
                      </span>
                      {p.minSubtotal > 0 && (
                        <span className="block text-[10px] font-semibold text-gray-500">
                          min. ₱{p.minSubtotal}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Metrics Box: Uses, Total Discount, Per-User limit */}
                  <div className="grid grid-cols-2 gap-2 p-2.5 rounded-2xl bg-gray-50 dark:bg-zinc-850/60 border border-gray-100 dark:border-zinc-800 text-xs">
                    <div>
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">
                        Uses / Limit
                      </span>
                      <span className="font-extrabold text-gray-900 dark:text-white">
                        {usesCount}
                        <span className="text-gray-400 font-normal">
                          {p.usageLimit != null ? ` / ${p.usageLimit}` : ' / ∞'}
                        </span>
                      </span>
                    </div>

                    <div>
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">
                        Total Discount
                      </span>
                      <span className="font-extrabold text-emerald-600 dark:text-emerald-400">
                        ₱{totalDisc.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>

                  {/* Expiry & Per-User details */}
                  <div className="space-y-1 text-xs text-gray-500">
                    <div className="flex items-center justify-between text-[11px]">
                      <span>Per-user limit:</span>
                      <span className="font-bold text-gray-700 dark:text-zinc-300">
                        {p.perUserLimit ?? 1} claim(s)
                      </span>
                    </div>
                    {p.expiresAt && (
                      <div className="flex items-center justify-between text-[11px]">
                        <span>Expires on:</span>
                        <span className="font-bold text-gray-700 dark:text-zinc-300">
                          {p.expiresAt.toDate
                            ? p.expiresAt.toDate().toLocaleDateString()
                            : new Date(p.expiresAt).toLocaleDateString()}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Applicable Services tags */}
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">
                      Services
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {p.services.map((svc) => (
                        <span
                          key={svc}
                          className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-zinc-300"
                        >
                          {(SERVICE_NAMES as Record<string, string>)[svc] || svc}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Bottom actions */}
                <div className="pt-3 border-t border-gray-100 dark:border-zinc-800 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      handleViewRedemptions(
                        p.code,
                        p.title,
                        p.merchantName || (p.merchantId ? merchantsMap[p.merchantId]?.name : undefined),
                        p.totalDiscount
                      )
                    }
                    className="text-xs font-bold text-amber-600 dark:text-amber-400 hover:underline flex items-center gap-1.5"
                  >
                    <Receipt className="w-3.5 h-3.5" />
                    <span>Redemptions ({usesCount})</span>
                  </button>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleToggleActive(p)}
                      title={p.active ? 'Deactivate' : 'Activate'}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-zinc-200 transition-colors"
                    >
                      {p.active ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                      ) : (
                        <XCircle className="w-4 h-4 text-gray-400" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleOpenEdit(p)}
                      title="Edit Voucher / Code"
                      className="p-1.5 rounded-lg text-gray-400 hover:text-amber-500 transition-colors"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCodeToDelete(p);
                        setDeleteModalOpen(true);
                      }}
                      title="Delete Voucher / Code"
                      className="p-1.5 rounded-lg text-gray-400 hover:text-rose-500 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create / Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-lg bg-white dark:bg-zinc-900 rounded-3xl p-6 border border-gray-200 dark:border-zinc-800 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-2 border-b border-gray-100 dark:border-zinc-800">
              <div className="flex items-center gap-2">
                {codeSource === 'merchant' ? (
                  <Store className="w-5 h-5 text-amber-500" />
                ) : (
                  <Ticket className="w-5 h-5 text-amber-500" />
                )}
                <h3 className="font-extrabold text-base text-gray-900 dark:text-white">
                  {isEditing
                    ? `Edit ${codeSource === 'merchant' ? 'Merchant Voucher' : 'Promo Code'} "${codeName}"`
                    : embeddedMerchantId
                    ? `New Shop Voucher for ${embeddedMerchantName || 'Merchant'}`
                    : 'Create Promo Code or Voucher'}
                </h3>
              </div>
            </div>

            <form onSubmit={handleSavePromoCode} className="space-y-4">
              {/* Type Switcher: Platform Promo vs Merchant Voucher (only if not embedded) */}
              {!embeddedMerchantId && !isEditing && (
                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-zinc-300 mb-1.5">
                    Source / Category <span className="text-red-500">*</span>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setCodeSource('platform')}
                      className={`p-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 transition-all ${
                        codeSource === 'platform'
                          ? 'bg-amber-400 text-black border-amber-500 shadow-xs'
                          : 'border-gray-200 dark:border-zinc-700 text-gray-600 dark:text-zinc-400'
                      }`}
                    >
                      <Ticket className="w-4 h-4" />
                      <span>Platform Promo</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setCodeSource('merchant')}
                      className={`p-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 transition-all ${
                        codeSource === 'merchant'
                          ? 'bg-amber-400 text-black border-amber-500 shadow-xs'
                          : 'border-gray-200 dark:border-zinc-700 text-gray-600 dark:text-zinc-400'
                      }`}
                    >
                      <Store className="w-4 h-4" />
                      <span>Merchant Voucher</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Merchant Voucher Specific Fields */}
              {codeSource === 'merchant' && (
                <div className="p-3.5 rounded-2xl border border-violet-200 dark:border-violet-900/60 bg-violet-50/50 dark:bg-violet-950/20 space-y-3">
                  <div className="flex items-center gap-2 text-violet-900 dark:text-violet-300 font-extrabold text-xs">
                    <Store className="w-4 h-4 text-violet-600" />
                    <span>Merchant Details</span>
                  </div>

                  {!embeddedMerchantId && (
                    <div>
                      <label className="block text-[11px] font-bold text-gray-700 dark:text-zinc-300 mb-1">
                        Select Merchant <span className="text-red-500">*</span>
                      </label>
                      <select
                        required
                        disabled={isEditing}
                        value={voucherMerchantId}
                        onChange={(e) => setVoucherMerchantId(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold text-gray-900 dark:text-white disabled:opacity-60"
                      >
                        <option value="">-- Choose Partner Merchant --</option>
                        {merchantsList.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name} ({m.id})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div>
                    <label className="block text-[11px] font-bold text-gray-700 dark:text-zinc-300 mb-1">
                      Voucher Title (Headline)
                    </label>
                    <input
                      type="text"
                      value={voucherTitle}
                      onChange={(e) => setVoucherTitle(e.target.value)}
                      placeholder="e.g. 20% Off Weekend Feast or ₱50 Off First Order"
                      className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold text-gray-900 dark:text-white placeholder-gray-400"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-gray-700 dark:text-zinc-300 mb-1">
                      Storefront Visibility
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setVoucherVisibility('public')}
                        className={`p-2 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                          voucherVisibility === 'public'
                            ? 'bg-emerald-500 text-white border-emerald-600'
                            : 'border-gray-200 dark:border-zinc-700 text-gray-600 dark:text-zinc-400'
                        }`}
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Public (In Store)</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setVoucherVisibility('hidden')}
                        className={`p-2 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                          voucherVisibility === 'hidden'
                            ? 'bg-purple-600 text-white border-purple-700'
                            : 'border-gray-200 dark:border-zinc-700 text-gray-600 dark:text-zinc-400'
                        }`}
                      >
                        <EyeOff className="w-3.5 h-3.5" />
                        <span>Hidden (Code Only)</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Code String */}
              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-zinc-300 mb-1">
                  Code String (Uppercase) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  disabled={isEditing}
                  value={codeName}
                  onChange={(e) => setCodeName(e.target.value.toUpperCase())}
                  placeholder={codeSource === 'merchant' ? 'e.g. JOLLIBEE50' : 'e.g. DELIVIO50'}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-mono font-bold text-gray-900 dark:text-white uppercase disabled:opacity-50"
                />
              </div>

              {/* Discount Type and Value */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-zinc-300 mb-1">
                    Discount Type
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setType('percent')}
                      className={`py-2 px-2 rounded-xl text-xs font-bold border transition-all text-center ${
                        type === 'percent'
                          ? 'bg-amber-400 text-black border-amber-500'
                          : 'border-gray-200 dark:border-zinc-700 text-gray-600'
                      }`}
                    >
                      Percent (%)
                    </button>
                    <button
                      type="button"
                      onClick={() => setType('fixed')}
                      className={`py-2 px-2 rounded-xl text-xs font-bold border transition-all text-center ${
                        type === 'fixed'
                          ? 'bg-amber-400 text-black border-amber-500'
                          : 'border-gray-200 dark:border-zinc-700 text-gray-600'
                      }`}
                    >
                      Fixed (₱)
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-zinc-300 mb-1">
                    {type === 'percent' ? 'Discount Percentage (%)' : 'Discount Amount (₱)'}
                  </label>
                  <input
                    type="number"
                    min="1"
                    max={type === 'percent' ? 100 : 5000}
                    required
                    value={value}
                    onChange={(e) => setValue(Number(e.target.value))}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold text-gray-900 dark:text-white"
                  />
                </div>
              </div>

              {/* Minimum Subtotal & Per-User Limit */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-zinc-300 mb-1">
                    Minimum Order Subtotal (₱)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={minSubtotal}
                    onChange={(e) => setMinSubtotal(Number(e.target.value))}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold text-gray-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-zinc-300 mb-1">
                    Per-User Limit (Claims/User)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={perUserLimit}
                    onChange={(e) => setPerUserLimit(Number(e.target.value))}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold text-gray-900 dark:text-white"
                  />
                </div>
              </div>

              {/* Usage Limit (Total Pool) */}
              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-zinc-300 mb-1">
                  Total Usage Limit (leave blank for unlimited)
                </label>
                <input
                  type="number"
                  min="1"
                  placeholder="Unlimited"
                  value={usageLimit}
                  onChange={(e) => setUsageLimit(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-gray-900 dark:text-white"
                />
              </div>

              {/* Expiry Date */}
              <div className="p-3.5 rounded-2xl border border-gray-200 dark:border-zinc-800 bg-gray-50/70 dark:bg-zinc-850 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-gray-900 dark:text-white">
                    Set Expiration Date
                  </span>
                  <input
                    type="checkbox"
                    checked={hasExpiry}
                    onChange={(e) => setHasExpiry(e.target.checked)}
                    className="w-4 h-4 accent-amber-500"
                  />
                </div>
                {hasExpiry && (
                  <input
                    type="date"
                    min={new Date().toISOString().split('T')[0]}
                    value={expiryDate}
                    onChange={(e) => setExpiryDate(e.target.value)}
                    required={hasExpiry}
                    className="w-full px-3 py-1.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold text-gray-900 dark:text-white"
                  />
                )}
              </div>

              {/* Services Multi-Select */}
              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-zinc-300 mb-1.5">
                  Applicable Services
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      'food',
                      'convenience',
                      'parcel',
                      'pabili',
                      'request_rider',
                      'taxi'
                    ] as OrderServiceType[]
                  ).map((svc) => {
                    const isChecked = selectedServices.includes(svc);
                    return (
                      <button
                        key={svc}
                        type="button"
                        onClick={() => handleToggleService(svc)}
                        className={`p-2 rounded-xl text-left border text-xs font-bold transition-all flex items-center justify-between ${
                          isChecked
                            ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-500 text-amber-950 dark:text-amber-200'
                            : 'border-gray-200 dark:border-zinc-800 text-gray-500 hover:border-gray-300'
                        }`}
                      >
                        <span>{(SERVICE_NAMES as Record<string, string>)[svc] || svc}</span>
                        {isChecked && <CheckCircle2 className="w-3.5 h-3.5 text-amber-600" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Active Toggle */}
              <div className="flex items-center justify-between p-3 rounded-2xl border border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-850">
                <span className="text-xs font-bold text-gray-900 dark:text-white">Active Status</span>
                <button
                  type="button"
                  onClick={() => setActive(!active)}
                  className={`px-3 py-1 rounded-xl text-xs font-bold transition-all ${
                    active ? 'bg-emerald-500 text-white' : 'bg-gray-300 text-gray-700'
                  }`}
                >
                  {active ? 'Active' : 'Disabled'}
                </button>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-gray-200 dark:border-zinc-700 text-xs font-bold text-gray-700 dark:text-zinc-300 hover:bg-gray-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 rounded-xl bg-amber-400 text-black hover:bg-amber-500 text-xs font-bold shadow-xs flex items-center gap-1.5 disabled:opacity-50"
                >
                  {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{isEditing ? 'Save Changes' : codeSource === 'merchant' ? 'Create Voucher' : 'Create Promo Code'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Redemptions Modal */}
      {viewingRedemptionsCode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-lg bg-white dark:bg-zinc-900 rounded-3xl p-6 border border-gray-200 dark:border-zinc-800 shadow-xl space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-start justify-between pb-3 border-b border-gray-100 dark:border-zinc-800">
              <div>
                <div className="flex items-center gap-2">
                  <Receipt className="w-5 h-5 text-amber-500" />
                  <h3 className="font-extrabold text-base text-gray-900 dark:text-white font-mono">
                    {viewingRedemptionsCode}
                  </h3>
                </div>
                {viewingRedemptionsTitle && (
                  <p className="text-xs font-bold text-gray-600 dark:text-zinc-300 mt-0.5">
                    {viewingRedemptionsTitle}
                  </p>
                )}
                {viewingRedemptionsMerchant && (
                  <p className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1 mt-0.5">
                    <Store className="w-3 h-3" />
                    <span>{viewingRedemptionsMerchant}</span>
                  </p>
                )}
              </div>

              <div className="text-right">
                <span className="block text-xs font-extrabold text-emerald-600 dark:text-emerald-400">
                  Total Discount: ₱{viewingTotalDiscount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span className="text-[11px] font-bold text-gray-400">
                  {redemptions.length} claim(s)
                </span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {loadingRedemptions ? (
                <div className="p-8 text-center">
                  <Loader2 className="w-6 h-6 animate-spin text-amber-500 mx-auto mb-2" />
                  <p className="text-xs text-gray-500">Loading redemptions history...</p>
                </div>
              ) : redemptions.length === 0 ? (
                <div className="p-8 text-center text-xs text-gray-500 space-y-1">
                  <Receipt className="w-8 h-8 text-gray-300 mx-auto mb-1" />
                  <p className="font-bold">No redemptions recorded yet.</p>
                  <p className="text-[11px]">When customers redeem this coupon at checkout, transactions will appear here.</p>
                </div>
              ) : (
                redemptions.map((r) => (
                  <div
                    key={r.id}
                    className="p-3 rounded-2xl border border-gray-100 dark:border-zinc-800 bg-gray-50/60 dark:bg-zinc-850/60 text-xs space-y-1.5"
                  >
                    <div className="flex items-center justify-between font-mono font-bold">
                      <span className="text-gray-900 dark:text-white">Order: {r.orderId}</span>
                      <span className="text-emerald-600 dark:text-emerald-400 font-extrabold">
                        -₱{r.discount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-gray-500 text-[11px]">
                      <span>Customer: {r.customerId}</span>
                      <span>
                        {r.createdAt?.toDate ? r.createdAt.toDate().toLocaleString() : 'N/A'}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="pt-2 border-t border-gray-100 dark:border-zinc-800 flex justify-end">
              <button
                type="button"
                onClick={() => setViewingRedemptionsCode(null)}
                className="px-4 py-2 rounded-xl bg-gray-100 dark:bg-zinc-800 text-xs font-bold text-gray-800 dark:text-zinc-200 hover:bg-gray-200"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteModalOpen && codeToDelete && (
        <ConfirmationModal
          isOpen={deleteModalOpen}
          onClose={() => {
            setDeleteModalOpen(false);
            setCodeToDelete(null);
          }}
          onConfirm={handleDeleteCode}
          title={`Delete ${codeToDelete.source === 'merchant' ? 'Voucher' : 'Promo Code'} "${codeToDelete.code}"?`}
          message={`Are you sure you want to permanently delete "${codeToDelete.code}"? Customers will no longer be able to claim or apply this discount.`}
          confirmLabel="Delete Permanently"
          reasonRequired={false}
          isDestructive={true}
        />
      )}
    </div>
  );
};
