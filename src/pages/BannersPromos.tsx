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
  const [linkCategory, setLinkCategory] = useState<'food' | 'convenience' | ''>('');
  const [linkMerchantId, setLinkMerchantId] = useState('');
  const [discountType, setDiscountType] = useState<'percent' | 'fixed'>('percent');
  const [discountValue, setDiscountValue] = useState<number>(10);
  const [minOrder, setMinOrder] = useState<number>(150);
  const [maxDiscount, setMaxDiscount] = useState<number>(100);
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
    setLinkCategory('food');
    setLinkMerchantId('');
    setDiscountType('percent');
    setDiscountValue(10);
    setMinOrder(150);
    setMaxDiscount(100);
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
    setLinkCategory('');
    setLinkMerchantId(req.merchantId || '');
    setDiscountType('percent');
    setDiscountValue(15);
    setMinOrder(200);
    setMaxDiscount(100);
    setPromoCode('');
    setStatus('active');
    setPriority(banners.length + 1);
    setBannerModalOpen(true);
  };

  // Save Banner
  const handleSaveBanner = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !imageUrl.trim()) return;

    try {
      setSavingBanner(true);
      const payload: Record<string, any> = {
        title: title.trim(),
        imageUrl: imageUrl.trim(),
        link: {
          merchantId: linkMerchantId || null,
          category: linkCategory || null
        },
        discount: {
          type: discountType,
          value: Number(discountValue),
          minOrder: Number(minOrder),
          maxDiscount: Number(maxDiscount),
          code: promoCode.trim().toUpperCase() || null
        },
        status,
        priority: Number(priority) || 1,
        target: 'all',
        startAt: new Date(startDate),
        endAt: new Date(endDate),
        updatedAt: Timestamp.now()
      };

      if (editingBanner) {
        const bRef = doc(db, 'banners', editingBanner.id);
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
                        setTitle(b.title);
                        setImageUrl(b.imageUrl);
                        setLinkCategory(b.link?.category || '');
                        setLinkMerchantId(b.link?.merchantId || '');
                        setDiscountType(b.discount?.type || 'percent');
                        setDiscountValue(b.discount?.value || 10);
                        setMinOrder(b.discount?.minOrder || 150);
                        setMaxDiscount(b.discount?.maxDiscount || 100);
                        setPromoCode(b.discount?.code || '');
                        setStatus(b.status);
                        setPriority(b.priority);
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
                  Image URL (Web image banner)
                </label>
                <input
                  type="url"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  required
                  placeholder="https://..."
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                />
                {imageUrl && (
                  <div className="mt-2 h-28 rounded-xl overflow-hidden border border-gray-200 bg-gray-100">
                    <img src={imageUrl} alt="Live preview" className="w-full h-full object-cover" />
                  </div>
                )}
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
                <span className="text-xs font-bold uppercase text-amber-900 dark:text-amber-300 block">
                  Voucher & Discount Rules
                </span>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-600 mb-1">
                      Discount Type
                    </label>
                    <select
                      value={discountType}
                      onChange={(e) => setDiscountType(e.target.value as any)}
                      className="w-full px-3 py-1.5 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800"
                    >
                      <option value="percent">Percentage (%)</option>
                      <option value="fixed">Fixed Pesos (₱)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-gray-600 mb-1">
                      Discount Value
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={discountValue}
                      onChange={(e) => setDiscountValue(Number(e.target.value))}
                      className="w-full px-3 py-1.5 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 font-bold"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-gray-600 mb-1">
                      Min Order Amount (₱)
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={minOrder}
                      onChange={(e) => setMinOrder(Number(e.target.value))}
                      className="w-full px-3 py-1.5 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-gray-600 mb-1">
                      Optional Promo Code
                    </label>
                    <input
                      type="text"
                      value={promoCode}
                      onChange={(e) => setPromoCode(e.target.value)}
                      placeholder="e.g. DELIVIO20"
                      className="w-full px-3 py-1.5 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 font-mono uppercase font-bold"
                    />
                  </div>
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
                    onChange={(e) => setStatus(e.target.value as any)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800"
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
                    className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setBannerModalOpen(false)}
                  className="px-4 py-2 text-xs font-bold text-gray-600 hover:bg-gray-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingBanner}
                  className="delivio-btn-yellow px-5 py-2 text-xs font-bold rounded-xl flex items-center gap-1.5"
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
