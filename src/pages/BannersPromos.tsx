import React, { useState, useEffect, useMemo } from 'react';
import {
  db,
  collection,
  query,
  limit,
  getDocs,
  doc,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  Timestamp
} from '../firebase';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { logAuditEvent } from '../utils/audit';
import { formatTimestamp, formatRelativeTime } from '../utils/date';
import type { Banner, PromoRequest, Merchant } from '../types';
import {
  Ticket,
  Tag,
  Plus,
  Edit,
  Trash2,
  Eye,
  CheckCircle2,
  XCircle,
  Smartphone,
  ExternalLink,
  Loader2,
  ArrowUp,
  ArrowDown,
  Sparkles,
  Percent,
  Calendar
} from 'lucide-react';
import { ConfirmationModal } from '../components/common/ConfirmationModal';

export const BannersPromos: React.FC = () => {
  const { adminProfile } = useAuth();
  const { showSuccess, showError } = useToast();

  const [banners, setBanners] = useState<Banner[]>([]);
  const [promoRequests, setPromoRequests] = useState<PromoRequest[]>([]);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [loading, setLoading] = useState(true);

  // Active sub-tab: 'banners' | 'requests'
  const [activeTab, setActiveTab] = useState<'banners' | 'requests'>('banners');

  // Banner Create / Edit Modal
  const [bannerModalOpen, setBannerModalOpen] = useState(false);
  const [editingBanner, setEditingBanner] = useState<Banner | null>(null);
  const [title, setTitle] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageError, setImageError] = useState(false);

  const [linkCategory, setLinkCategory] = useState<'food' | 'convenience' | ''>('');
  const [linkMerchantId, setLinkMerchantId] = useState('');
  const [hasDiscount, setHasDiscount] = useState(false);
  const [discountType, setDiscountType] = useState<'percent' | 'fixed'>('percent');
  const [discountValue, setDiscountValue] = useState<number>(10);
  const [minOrder, setMinOrder] = useState<number>(0);
  const [maxDiscount, setMaxDiscount] = useState<number>(0);
  const [promoCode, setPromoCode] = useState('');
  const [status, setStatus] = useState<'active' | 'draft' | 'expired'>('active');
  const [priority, setPriority] = useState<number>(1);
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(
    new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10)
  );
  const [savingBanner, setSavingBanner] = useState(false);

  // Approved promo request ID to update if banner created from promo request
  const [associatedPromoRequestId, setAssociatedPromoRequestId] = useState<string | null>(null);

  // Reject Promo Request Modal
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [targetPromoRequest, setTargetPromoRequest] = useState<PromoRequest | null>(null);

  // Delete banner confirmation
  const [deleteBannerModalOpen, setDeleteBannerModalOpen] = useState(false);
  const [bannerToDelete, setBannerToDelete] = useState<Banner | null>(null);

  // Preload and verify image whenever imageUrl changes while modal is open
  useEffect(() => {
    if (!bannerModalOpen) {
      return;
    }
    const trimmed = imageUrl.trim();
    if (!trimmed) {
      setImageLoaded(false);
      setImageLoading(false);
      setImageError(false);
      return;
    }
    if (!trimmed.startsWith('https://')) {
      setImageLoaded(false);
      setImageLoading(false);
      setImageError(true);
      return;
    }

    setImageLoading(true);
    setImageLoaded(false);
    setImageError(false);

    let active = true;
    const img = new Image();
    img.onload = () => {
      if (!active) return;
      setImageLoading(false);
      setImageLoaded(true);
      setImageError(false);
    };
    img.onerror = () => {
      if (!active) return;
      setImageLoading(false);
      setImageLoaded(false);
      setImageError(true);
    };
    img.src = trimmed;

    return () => {
      active = false;
      img.onload = null;
      img.onerror = null;
    };
  }, [imageUrl, bannerModalOpen]);

  // Fetch Banners, PromoRequests, Merchants
  const fetchData = async () => {
    try {
      setLoading(true);
      // Banners
      const bSnap = await getDocs(query(collection(db, 'banners'), limit(100)));
      const bList: Banner[] = [];
      bSnap.forEach((d) => {
        const dt = d.data();
        bList.push({
          id: d.id,
          title: dt.title || '',
          imageUrl: dt.imageUrl || '',
          link: dt.link || {},
          discount: dt.discount,
          status: dt.status || 'active',
          priority: Number(dt.priority) || 1,
          target: dt.target || 'all',
          startAt: dt.startAt,
          endAt: dt.endAt,
          createdAt: dt.createdAt
        });
      });
      bList.sort((a, b) => (b.priority || 0) - (a.priority || 0));
      setBanners(bList);

      // Promo Requests
      const pSnap = await getDocs(query(collection(db, 'promoRequests'), limit(50)));
      const pList: PromoRequest[] = [];
      pSnap.forEach((d) => {
        const dt = d.data();
        pList.push({
          id: d.id,
          merchantId: dt.merchantId,
          merchantName: dt.merchantName,
          title: dt.title || '',
          description: dt.description || '',
          imageUrl: dt.imageUrl,
          status: dt.status || 'Pending',
          rejectReason: dt.rejectReason,
          createdAt: dt.createdAt
        });
      });
      pList.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setPromoRequests(pList);

      // Merchants for linking
      const mSnap = await getDocs(query(collection(db, 'merchants'), limit(100)));
      const mList: Merchant[] = [];
      mSnap.forEach((d) => mList.push({ id: d.id, ...d.data() } as Merchant));
      setMerchants(mList);
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Open banner modal for new banner
  const handleOpenNewBanner = () => {
    setEditingBanner(null);
    setAssociatedPromoRequestId(null);
    setTitle('');
    setImageUrl('');
    setImageLoaded(false);
    setImageLoading(false);
    setImageError(false);
    setLinkCategory('');
    setLinkMerchantId('');
    setHasDiscount(false);
    setDiscountType('percent');
    setDiscountValue(10);
    setMinOrder(0);
    setMaxDiscount(0);
    setPromoCode('');
    setStatus('active');
    setPriority(banners.length + 1);
    setStartDate(new Date().toISOString().slice(0, 10));
    setEndDate(new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10));
    setBannerModalOpen(true);
  };

  // Open banner modal from promo request approval
  const handleApprovePromoRequest = (req: PromoRequest) => {
    setEditingBanner(null);
    setAssociatedPromoRequestId(req.id);
    setTitle(req.title || 'Merchant Special Promo');
    setImageUrl(req.imageUrl || '');
    setImageLoaded(false);
    setImageLoading(false);
    setImageError(false);
    setLinkCategory('');
    setLinkMerchantId(req.merchantId || '');
    setHasDiscount(true);
    setDiscountType('percent');
    setDiscountValue(15);
    setMinOrder(200);
    setMaxDiscount(100);
    setPromoCode('');
    setStatus('active');
    setPriority(banners.length + 1);
    setStartDate(new Date().toISOString().slice(0, 10));
    setEndDate(new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10));
    setBannerModalOpen(true);
  };

  // Save Banner with strict validation and sanitization
  const handleSaveBanner = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      showError('Banner title is required.');
      return;
    }

    const trimmedUrl = imageUrl.trim();
    if (!trimmedUrl) {
      showError('Image URL is required.');
      return;
    }

    // 1. imageUrl must be https and load in the preview before publishing
    if (!trimmedUrl.startsWith('https://')) {
      showError('Image URL must start with https://');
      return;
    }

    if (!imageLoaded) {
      showError('Banner image must load in the preview before publishing.');
      return;
    }

    // 2. status is "active", "draft", or "expired" in lowercase
    const rawStatus = (status || 'active').toLowerCase();
    const validStatus: 'active' | 'draft' | 'expired' =
      rawStatus === 'draft' ? 'draft' : rawStatus === 'expired' ? 'expired' : 'active';

    // 3. priority is a number
    const numPriority = Number(priority) || 0;

    // 4. omit link.category or link.merchantId when empty (never save null inside link)
    const linkObj: { category?: 'food' | 'convenience'; merchantId?: string } = {};
    if (linkCategory && linkCategory.trim()) {
      linkObj.category = linkCategory.trim() as 'food' | 'convenience';
    }
    if (linkMerchantId && linkMerchantId.trim()) {
      linkObj.merchantId = linkMerchantId.trim();
    }

    // 5. discount validation & omission
    // - omit discount entirely when no discount is set
    // - discount.type is exactly "percent" or "fixed"
    // - value, minOrder, maxDiscount are numbers
    // - A percent discount must be between 1 and 100
    let discountObj: {
      type: 'percent' | 'fixed';
      value: number;
      minOrder: number;
      maxDiscount: number;
      code?: string;
    } | undefined = undefined;

    if (hasDiscount) {
      const type: 'percent' | 'fixed' = discountType === 'fixed' ? 'fixed' : 'percent';
      const numValue = Number(discountValue);

      if (isNaN(numValue) || numValue <= 0) {
        showError('Discount value must be a valid number greater than 0.');
        return;
      }

      if (type === 'percent') {
        if (numValue < 1 || numValue > 100) {
          showError('A percent discount must be between 1 and 100.');
          return;
        }
      }

      const numMinOrder = Number(minOrder) || 0;
      const numMaxDiscount = Number(maxDiscount) || 0;

      discountObj = {
        type,
        value: numValue,
        minOrder: numMinOrder,
        maxDiscount: numMaxDiscount
      };

      if (promoCode.trim()) {
        discountObj.code = promoCode.trim().toUpperCase();
      }
    }

    // 6. startAt and endAt are Timestamps
    let startTimestamp: Timestamp;
    let endTimestamp: Timestamp;

    try {
      const sDate = startDate ? new Date(startDate + 'T00:00:00') : new Date();
      startTimestamp = Timestamp.fromDate(!isNaN(sDate.getTime()) ? sDate : new Date());
    } catch {
      startTimestamp = Timestamp.now();
    }

    try {
      const eDate = endDate ? new Date(endDate + 'T23:59:59') : new Date(Date.now() + 30 * 24 * 3600 * 1000);
      endTimestamp = Timestamp.fromDate(!isNaN(eDate.getTime()) ? eDate : new Date(Date.now() + 30 * 24 * 3600 * 1000));
    } catch {
      endTimestamp = Timestamp.fromDate(new Date(Date.now() + 30 * 24 * 3600 * 1000));
    }

    try {
      setSavingBanner(true);
      const payload: Record<string, any> = {
        title: trimmedTitle,
        imageUrl: trimmedUrl,
        link: linkObj,
        status: validStatus,
        priority: numPriority,
        target: 'all',
        startAt: startTimestamp,
        endAt: endTimestamp,
        updatedAt: Timestamp.now()
      };

      // Only set discount if discount is set
      if (discountObj !== undefined) {
        payload.discount = discountObj;
      }

      if (editingBanner) {
        const bRef = doc(db, 'banners', editingBanner.id);
        // If discount was removed, delete the field in Firestore
        if (discountObj === undefined) {
          payload.discount = deleteField();
        }
        await updateDoc(bRef, payload);
        showSuccess('Banner updated.');
      } else {
        payload.createdAt = Timestamp.now();
        const bCol = collection(db, 'banners');
        await addDoc(bCol, payload);
        showSuccess('Banner published.');
      }

      // If created from promo request, mark request as approved
      if (associatedPromoRequestId) {
        const pRef = doc(db, 'promoRequests', associatedPromoRequestId);
        await updateDoc(pRef, {
          status: 'Approved',
          approvedBy: adminProfile?.name || 'Administrator',
          approvedAt: Timestamp.now()
        });

        // Automatic notice in inbox for the merchant
        const matchedReq = promoRequests.find((r) => r.id === associatedPromoRequestId);
        const mId = linkMerchantId || matchedReq?.merchantId;
        if (mId) {
          await addDoc(collection(db, 'inbox'), {
            merchantId: mId,
            merchantName: matchedReq?.merchantName || null,
            category: 'update',
            title: 'Promo Request Approved',
            body: `Your promotional campaign "${title}" has been approved and published to the customer banner carousel!`,
            audience: null,
            customerId: null,
            riderId: null,
            imageUrl: imageUrl.trim() || null,
            link: { merchantId: mId, category: null },
            createdAt: Timestamp.now(),
            createdBy: adminProfile?.uid || 'admin',
            createdByName: adminProfile?.name || 'Administrator'
          });
        }
      }

      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        action: editingBanner ? 'EDIT_BANNER' : 'CREATE_BANNER',
        entityType: 'banner',
        entityId: editingBanner?.id || 'new',
        details: `${editingBanner ? 'Updated' : 'Created'} promotional banner "${title}"`
      });

      setBannerModalOpen(false);
      fetchData();
    } catch (err: any) {
      showError(err);
    } finally {
      setSavingBanner(false);
    }
  };

  // Delete Banner
  const handleDeleteBanner = async () => {
    if (!bannerToDelete) return;
    try {
      await deleteDoc(doc(db, 'banners', bannerToDelete.id));
      showSuccess('Banner deleted.');
      setDeleteBannerModalOpen(false);
      fetchData();
    } catch (err: any) {
      showError(err);
    }
  };

  // Reject Promo Request
  const handleRejectPromo = async (reason: string) => {
    if (!targetPromoRequest) return;
    try {
      const pRef = doc(db, 'promoRequests', targetPromoRequest.id);
      await updateDoc(pRef, {
        status: 'Rejected',
        rejectReason: reason,
        rejectedBy: adminProfile?.name || 'Administrator',
        rejectedAt: Timestamp.now()
      });

      // Automatic notice in inbox for the merchant
      if (targetPromoRequest.merchantId) {
        await addDoc(collection(db, 'inbox'), {
          merchantId: targetPromoRequest.merchantId,
          merchantName: targetPromoRequest.merchantName || null,
          category: 'update',
          title: 'Promo Request Rejected',
          body: `Your promotional campaign request "${targetPromoRequest.title}" was rejected.${reason ? ` Reason: ${reason}` : ''}`,
          audience: null,
          customerId: null,
          riderId: null,
          imageUrl: targetPromoRequest.imageUrl || null,
          link: { merchantId: targetPromoRequest.merchantId, category: null },
          createdAt: Timestamp.now(),
          createdBy: adminProfile?.uid || 'admin',
          createdByName: adminProfile?.name || 'Administrator'
        });
      }

      showSuccess('Promo request rejected.');
      setRejectModalOpen(false);
      fetchData();
    } catch (err: any) {
      showError(err);
    }
  };

  // Priority adjustment
  const handleMovePriority = async (banner: Banner, direction: 'up' | 'down') => {
    try {
      const newPrio = direction === 'up' ? banner.priority + 1 : Math.max(1, banner.priority - 1);
      const bRef = doc(db, 'banners', banner.id);
      await updateDoc(bRef, { priority: newPrio });
      setBanners((prev) =>
        prev
          .map((b) => (b.id === banner.id ? { ...b, priority: newPrio } : b))
          .sort((a, b) => b.priority - a.priority)
      );
    } catch (err: any) {
      showError(err);
    }
  };

  const pendingRequests = useMemo(
    () => promoRequests.filter((p) => p.status === 'Pending'),
    [promoRequests]
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">
            Banners & Promotional Campaigns
          </h1>
          <p className="text-sm text-gray-500 dark:text-zinc-400 mt-0.5">
            Manage app home carousel carousels, customer vouchers, and partner merchant promo requests.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <div className="flex p-1 rounded-xl bg-gray-200 dark:bg-zinc-800">
            <button
              onClick={() => setActiveTab('banners')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'banners'
                  ? 'bg-white dark:bg-zinc-900 text-gray-900 dark:text-white shadow-xs'
                  : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              Active Banners ({banners.length})
            </button>
            <button
              onClick={() => setActiveTab('requests')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                activeTab === 'requests'
                  ? 'bg-white dark:bg-zinc-900 text-gray-900 dark:text-white shadow-xs'
                  : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              <span>Partner Requests</span>
              {pendingRequests.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-purple-500 text-white font-bold">
                  {pendingRequests.length}
                </span>
              )}
            </button>
          </div>

          {activeTab === 'banners' && (
            <button
              onClick={handleOpenNewBanner}
              className="delivio-btn-yellow px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs"
            >
              <Plus className="w-4 h-4" /> New Banner
            </button>
          )}
        </div>
      </div>

      {activeTab === 'banners' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Banners List */}
          <div className="lg:col-span-2 space-y-4">
            {banners.length === 0 ? (
              <div className="p-12 text-center bg-white dark:bg-zinc-900 border border-dashed border-gray-200 dark:border-zinc-800 rounded-2xl">
                <Ticket className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                <h4 className="font-bold text-gray-900 dark:text-white text-sm">
                  No Banners Created
                </h4>
                <p className="text-xs text-gray-400 mt-1">
                  Click 'New Banner' above to launch promotional carousel cards.
                </p>
              </div>
            ) : (
              banners.map((b) => (
                <div
                  key={b.id}
                  className="p-4 rounded-2xl border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between shadow-xs"
                >
                  <div className="flex items-center gap-3 w-full sm:w-auto">
                    <div className="w-24 h-14 rounded-xl bg-gray-100 dark:bg-zinc-800 shrink-0 overflow-hidden shadow-inner">
                      <img
                        src={b.imageUrl}
                        alt={b.title}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-sm text-gray-900 dark:text-white">
                          {b.title}
                        </h4>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            b.status === 'active'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {b.status}
                        </span>
                      </div>

                      <div className="text-xs text-gray-400 mt-1 flex flex-wrap items-center gap-2">
                        {b.discount && (
                          <span className="font-semibold text-amber-600">
                            {b.discount.type === 'percent'
                              ? `${b.discount.value}% OFF`
                              : `₱${b.discount.value} OFF`}
                            {b.discount.code ? ` (Code: ${b.discount.code})` : ''}
                          </span>
                        )}
                        <span>•</span>
                        <span>Priority: {b.priority}</span>
                      </div>
                    </div>
                  </div>

                  {/* Actions & Reordering */}
                  <div className="flex items-center gap-1 self-end sm:self-auto">
                    <button
                      onClick={() => handleMovePriority(b, 'up')}
                      className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100"
                      title="Move up in carousel"
                    >
                      <ArrowUp className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleMovePriority(b, 'down')}
                      className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100"
                      title="Move down in carousel"
                    >
                      <ArrowDown className="w-4 h-4" />
                    </button>

                    <button
                      onClick={() => {
                        setEditingBanner(b);
                        setAssociatedPromoRequestId(null);
                        setTitle(b.title || '');
                        setImageUrl(b.imageUrl || '');
                        setImageLoaded(false);
                        setImageLoading(false);
                        setImageError(false);
                        setLinkCategory(b.link?.category || '');
                        setLinkMerchantId(b.link?.merchantId || '');
                        const hasDisc = !!b.discount && (b.discount.value !== undefined && b.discount.value !== null);
                        setHasDiscount(hasDisc);
                        setDiscountType(b.discount?.type === 'fixed' ? 'fixed' : 'percent');
                        setDiscountValue(Number(b.discount?.value) || 10);
                        setMinOrder(Number(b.discount?.minOrder) || 0);
                        setMaxDiscount(Number(b.discount?.maxDiscount) || 0);
                        setPromoCode(b.discount?.code || '');
                        const validStatus = (['active', 'draft', 'expired'].includes(b.status?.toLowerCase())
                          ? b.status.toLowerCase()
                          : 'active') as 'active' | 'draft' | 'expired';
                        setStatus(validStatus);
                        setPriority(Number(b.priority) || 1);
                        if (b.startAt) {
                          const sDate = b.startAt.toDate ? b.startAt.toDate() : new Date(b.startAt);
                          setStartDate(!isNaN(sDate.getTime()) ? sDate.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));
                        } else {
                          setStartDate(new Date().toISOString().slice(0, 10));
                        }
                        if (b.endAt) {
                          const eDate = b.endAt.toDate ? b.endAt.toDate() : new Date(b.endAt);
                          setEndDate(!isNaN(eDate.getTime()) ? eDate.toISOString().slice(0, 10) : new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10));
                        } else {
                          setEndDate(new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10));
                        }
                        setBannerModalOpen(true);
                      }}
                      className="p-1.5 text-gray-400 hover:text-amber-600 rounded-lg hover:bg-amber-50"
                      title="Edit banner"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => {
                        setBannerToDelete(b);
                        setDeleteBannerModalOpen(true);
                      }}
                      className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50"
                      title="Delete banner"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Phone Mockup Live Carousel Preview */}
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-5 shadow-xs flex flex-col items-center">
            <div className="flex items-center gap-2 mb-4 self-start">
              <Smartphone className="w-4 h-4 text-amber-500" />
              <h3 className="font-bold text-sm text-gray-900 dark:text-white">
                Live Customer App Mockup
              </h3>
            </div>

            {/* Mock phone frame */}
            <div className="w-64 h-[440px] rounded-[36px] border-4 border-gray-800 bg-gray-50 dark:bg-zinc-950 p-3 shadow-2xl relative overflow-hidden flex flex-col">
              {/* Speaker notch */}
              <div className="w-20 h-3.5 bg-gray-800 rounded-full mx-auto mb-3" />

              {/* App bar mock */}
              <div className="flex items-center justify-between text-[10px] font-bold text-gray-800 dark:text-zinc-200 mb-3 px-1">
                <span>Deliver to: Home ▾</span>
                <span className="w-5 h-5 rounded-full bg-amber-400 text-black flex items-center justify-center font-bold">
                  D
                </span>
              </div>

              {/* Mock Carousel */}
              <div className="space-y-1">
                <span className="text-[9px] font-bold uppercase text-gray-400 tracking-wider">
                  Featured Offers
                </span>
                <div className="h-28 rounded-2xl overflow-hidden bg-amber-400 relative shadow-sm">
                  {banners.length > 0 ? (
                    <img
                      src={banners[0].imageUrl}
                      alt="Banner Preview"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xs font-bold text-black">
                      Delivio Deals
                    </div>
                  )}
                  {banners.length > 0 && banners[0].discount && (
                    <div className="absolute bottom-2 left-2 bg-black/75 backdrop-blur-xs text-white text-[9px] font-bold px-2 py-0.5 rounded-md">
                      {banners[0].discount.type === 'percent'
                        ? `${banners[0].discount.value}% OFF`
                        : `₱${banners[0].discount.value} OFF`}
                    </div>
                  )}
                </div>
              </div>

              {/* Mock Service icons */}
              <div className="grid grid-cols-4 gap-1.5 mt-3 text-center">
                {['Food', 'Mart', 'Parcel', 'Pabili'].map((s) => (
                  <div key={s} className="p-1 rounded-xl bg-white dark:bg-zinc-900 text-[8px] font-bold">
                    {s}
                  </div>
                ))}
              </div>

              <div className="mt-auto pb-1 text-center text-[9px] text-gray-400">
                Interactive customer banner feed
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* PROMO REQUESTS FROM MERCHANTS */
        <div className="space-y-4">
          {promoRequests.length === 0 ? (
            <div className="p-12 text-center bg-white dark:bg-zinc-900 border border-dashed border-gray-200 dark:border-zinc-800 rounded-2xl">
              <Tag className="w-10 h-10 text-gray-300 mx-auto mb-2" />
              <h4 className="font-bold text-gray-900 dark:text-white text-sm">
                No Partner Promo Requests
              </h4>
              <p className="text-xs text-gray-400 mt-1">
                Merchant partners can submit campaign requests from their partner app.
              </p>
            </div>
          ) : (
            promoRequests.map((req) => (
              <div
                key={req.id}
                className="p-5 rounded-2xl border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex flex-col md:flex-row gap-4 items-start md:items-center justify-between shadow-xs"
              >
                <div className="flex items-start gap-4">
                  {req.imageUrl ? (
                    <div className="w-20 h-20 rounded-xl bg-gray-100 shrink-0 overflow-hidden">
                      <img
                        src={req.imageUrl}
                        alt={req.title}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ) : (
                    <div className="w-20 h-20 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center shrink-0">
                      <Tag className="w-8 h-8" />
                    </div>
                  )}

                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-bold text-base text-gray-900 dark:text-white">
                        {req.title}
                      </h4>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          req.status === 'Approved'
                            ? 'bg-emerald-100 text-emerald-800'
                            : req.status === 'Rejected'
                            ? 'bg-red-100 text-red-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {req.status}
                      </span>
                    </div>

                    <p className="text-xs font-semibold text-amber-600 mt-0.5">
                      Merchant: {req.merchantName || req.merchantId}
                    </p>
                    <p className="text-xs text-gray-500 mt-1 max-w-lg">{req.description}</p>
                    <span className="text-[10px] text-gray-400 mt-2 block">
                      Submitted {formatTimestamp(req.createdAt)}
                    </span>
                  </div>
                </div>

                {req.status === 'Pending' && (
                  <div className="flex items-center gap-2 self-end md:self-auto">
                    <button
                      onClick={() => {
                        setTargetPromoRequest(req);
                        setRejectModalOpen(true);
                      }}
                      className="px-4 py-2 rounded-xl border border-red-300 text-red-600 text-xs font-bold hover:bg-red-50"
                    >
                      Reject
                    </button>
                    <button
                      onClick={() => handleApprovePromoRequest(req)}
                      className="delivio-btn-yellow px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs"
                    >
                      <Sparkles className="w-3.5 h-3.5" /> Approve & Create Banner
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Banner Create / Edit Modal */}
      {bannerModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <h3 className="font-extrabold text-lg text-gray-900 dark:text-white mb-4">
              {editingBanner ? 'Edit Promotional Banner' : 'Create & Publish New Banner'}
            </h3>

            <form onSubmit={handleSaveBanner} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Banner Title
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  placeholder="e.g. 20% Off Weekend Meals"
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Image URL (Must begin with https://)
                </label>
                <input
                  type="url"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  required
                  placeholder="https://example.com/banner.jpg"
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                />
                <div className="mt-2">
                  <div className="h-32 rounded-xl overflow-hidden border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 flex items-center justify-center relative">
                    {imageLoading && (
                      <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-zinc-400">
                        <Loader2 className="w-4 h-4 animate-spin text-amber-500" />
                        <span>Verifying & loading image preview...</span>
                      </div>
                    )}
                    {!imageLoading && imageError && (
                      <div className="p-3 text-center text-xs text-red-500 font-semibold flex flex-col items-center gap-1">
                        <XCircle className="w-5 h-5 text-red-500" />
                        <span>
                          {!imageUrl.trim().startsWith('https://')
                            ? 'Image URL must start with https://'
                            : 'Failed to load image preview. Verify the link is valid and accessible.'}
                        </span>
                      </div>
                    )}
                    {!imageLoading && !imageError && imageLoaded && (
                      <img
                        src={imageUrl.trim()}
                        alt="Live preview"
                        className="w-full h-full object-cover"
                      />
                    )}
                    {!imageLoading && !imageError && !imageLoaded && !imageUrl.trim() && (
                      <span className="text-xs text-gray-400">Enter a secure https:// image URL above</span>
                    )}
                  </div>
                  {imageLoaded && (
                    <p className="mt-1.5 text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Image verified & preview loaded successfully
                    </p>
                  )}
                  {imageUrl.trim() && !imageUrl.trim().startsWith('https://') && (
                    <p className="mt-1.5 text-[11px] text-red-500 font-semibold flex items-center gap-1">
                      <XCircle className="w-3.5 h-3.5" /> URL must use secure https:// protocol
                    </p>
                  )}
                </div>
              </div>

              {/* Destination Link */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                    Link To Category
                  </label>
                  <select
                    value={linkCategory}
                    onChange={(e) => {
                      setLinkCategory(e.target.value as any);
                      if (e.target.value) setLinkMerchantId('');
                    }}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                  >
                    <option value="">None / Specific Merchant</option>
                    <option value="food">All Food Merchants</option>
                    <option value="convenience">All Convenience Marts</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                    Or Specific Merchant
                  </label>
                  <select
                    value={linkMerchantId}
                    onChange={(e) => {
                      setLinkMerchantId(e.target.value);
                      if (e.target.value) setLinkCategory('');
                    }}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                  >
                    <option value="">None / Category Link</option>
                    {merchants.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Discount Details */}
              <div className="p-4 rounded-2xl bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/60 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase text-amber-900 dark:text-amber-300">
                    Voucher & Discount Rules
                  </span>
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-gray-700 dark:text-zinc-300 select-none">
                    <input
                      type="checkbox"
                      checked={hasDiscount}
                      onChange={(e) => setHasDiscount(e.target.checked)}
                      className="rounded text-amber-500 focus:ring-amber-400 h-4 w-4"
                    />
                    <span>Attach Discount Voucher</span>
                  </label>
                </div>

                {!hasDiscount ? (
                  <p className="text-xs text-gray-500 dark:text-zinc-400">
                    No discount attached. This banner will be saved without a discount voucher.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div>
                      <label className="block text-[11px] font-semibold text-gray-600 dark:text-zinc-400 mb-1">
                        Discount Type
                      </label>
                      <select
                        value={discountType}
                        onChange={(e) => setDiscountType(e.target.value as 'percent' | 'fixed')}
                        className="w-full px-3 py-1.5 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white font-medium"
                      >
                        <option value="percent">Percentage (%)</option>
                        <option value="fixed">Fixed Pesos (₱)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-gray-600 dark:text-zinc-400 mb-1">
                        {discountType === 'percent' ? 'Discount Value (1 - 100%)' : 'Discount Value (₱)'}
                      </label>
                      <input
                        type="number"
                        min={discountType === 'percent' ? 1 : 1}
                        max={discountType === 'percent' ? 100 : undefined}
                        value={discountValue}
                        onChange={(e) => setDiscountValue(Number(e.target.value))}
                        className="w-full px-3 py-1.5 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 font-bold text-gray-900 dark:text-white"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-gray-600 dark:text-zinc-400 mb-1">
                        Min Order Amount (₱)
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={minOrder}
                        onChange={(e) => setMinOrder(Number(e.target.value))}
                        className="w-full px-3 py-1.5 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-gray-600 dark:text-zinc-400 mb-1">
                        Max Discount Cap (₱)
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={maxDiscount}
                        onChange={(e) => setMaxDiscount(Number(e.target.value))}
                        className="w-full px-3 py-1.5 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                      />
                    </div>

                    <div className="col-span-2">
                      <label className="block text-[11px] font-semibold text-gray-600 dark:text-zinc-400 mb-1">
                        Optional Promo Code
                      </label>
                      <input
                        type="text"
                        value={promoCode}
                        onChange={(e) => setPromoCode(e.target.value)}
                        placeholder="e.g. DELIVIO20"
                        className="w-full px-3 py-1.5 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 font-mono uppercase font-bold text-gray-900 dark:text-white"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Schedule Dates (Timestamps) */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1 flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-gray-400" /> Start Date
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    required
                    className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1 flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-gray-400" /> End Date
                  </label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    required
                    className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                  />
                </div>
              </div>

              {/* Status and Priority */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                    Publish Status
                  </label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value.toLowerCase() as 'active' | 'draft' | 'expired')}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                  >
                    <option value="active">Active (Visible)</option>
                    <option value="draft">Draft (Hidden)</option>
                    <option value="expired">Expired</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                    Carousel Priority
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={priority}
                    onChange={(e) => setPriority(Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setBannerModalOpen(false)}
                  className="px-4 py-2 text-xs font-bold text-gray-600 hover:bg-gray-100 dark:text-zinc-400 dark:hover:bg-zinc-800 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingBanner || !imageLoaded}
                  className={`px-5 py-2 text-xs font-bold rounded-xl flex items-center gap-1.5 transition-all ${
                    savingBanner || !imageLoaded
                      ? 'bg-gray-300 dark:bg-zinc-700 text-gray-500 cursor-not-allowed'
                      : 'delivio-btn-yellow'
                  }`}
                  title={!imageLoaded ? 'Image preview must load successfully before publishing' : 'Save and publish banner'}
                >
                  {savingBanner && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Publish Banner
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reject Promo Request Confirmation Modal */}
      {rejectModalOpen && targetPromoRequest && (
        <ConfirmationModal
          isOpen={rejectModalOpen}
          onClose={() => setRejectModalOpen(false)}
          onConfirm={handleRejectPromo}
          title="Reject Merchant Promo Request"
          message={`Are you sure you want to decline ${targetPromoRequest.title}?`}
          confirmLabel="Reject Request"
          reasonRequired={true}
          reasonPlaceholder="Specify reason for decline (e.g. improper imagery, discount unviable)..."
          isDestructive={true}
        />
      )}

      {/* Delete Banner Confirmation */}
      {deleteBannerModalOpen && bannerToDelete && (
        <ConfirmationModal
          isOpen={deleteBannerModalOpen}
          onClose={() => setDeleteBannerModalOpen(false)}
          onConfirm={handleDeleteBanner}
          title="Delete Promotional Banner"
          message={`Remove banner "${bannerToDelete.title}" from the customer carousel?`}
          confirmLabel="Delete Banner"
          reasonRequired={false}
          isDestructive={true}
        />
      )}
    </div>
  );
};
