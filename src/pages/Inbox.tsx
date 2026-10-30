import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  db,
  collection,
  query,
  where,
  limit,
  getDocs,
  addDoc,
  deleteDoc,
  doc,
  Timestamp
} from '../firebase';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { logAuditEvent } from '../utils/audit';
import { formatTimestamp, formatRelativeTime } from '../utils/date';
import type { Rider, UserProfile, InboxCategory, InboxMessage, InboxLink } from '../types';
import { ConfirmationModal } from '../components/common/ConfirmationModal';
import {
  Mail,
  Send,
  Users,
  User,
  UserCheck,
  Car,
  Search,
  Filter,
  Trash2,
  Image as ImageIcon,
  Link as LinkIcon,
  Store,
  ShoppingBag,
  ExternalLink,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Inbox as InboxIcon,
  X,
  Sparkles,
  Tag,
  ShieldAlert,
  Wallet,
  Clock,
  Eye
} from 'lucide-react';

type SendToTarget =
  | 'all_customers'
  | 'one_customer'
  | 'all_riders'
  | 'one_rider'
  | 'all_merchants'
  | 'one_merchant';
type LinkType = 'none' | 'merchant' | 'category_food' | 'category_convenience';

interface MerchantOption {
  id: string;
  businessName: string;
  email?: string;
  type: string;
  cityId?: string;
}

export const Inbox: React.FC = () => {
  const [searchParams] = useSearchParams();
  const preselectedRiderId = searchParams.get('riderId') || '';
  const preselectedCustomerId = searchParams.get('customerId') || '';
  const preselectedMerchantId = searchParams.get('merchantId') || '';

  const { adminProfile } = useAuth();
  const { showSuccess, showError } = useToast();

  // Send to target selection
  const [sendTo, setSendTo] = useState<SendToTarget>(() => {
    if (preselectedMerchantId) return 'one_merchant';
    if (preselectedCustomerId) return 'one_customer';
    if (preselectedRiderId) return 'one_rider';
    return 'all_customers';
  });

  // Selected customer states
  const [customerSearchQuery, setCustomerSearchQuery] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<UserProfile | null>(null);
  const [isCustomerDropdownOpen, setIsCustomerDropdownOpen] = useState(false);
  const customerDropdownRef = useRef<HTMLDivElement>(null);

  // Selected driver states
  const [selectedRiderId, setSelectedRiderId] = useState(preselectedRiderId);

  // Selected merchant states
  const [selectedMerchantRecipient, setSelectedMerchantRecipient] = useState<MerchantOption | null>(null);
  const [merchantSearchQuery, setMerchantSearchQuery] = useState('');
  const [isMerchantDropdownOpen, setIsMerchantDropdownOpen] = useState(false);
  const merchantDropdownRef = useRef<HTMLDivElement>(null);

  // Form states
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState<InboxCategory>('promo');
  const [imageUrl, setImageUrl] = useState('');
  const [imageLoadError, setImageLoadError] = useState(false);

  // Link target states
  const [linkType, setLinkType] = useState<LinkType>('none');
  const [selectedMerchantId, setSelectedMerchantId] = useState('');

  // UI / Modal states
  const [sending, setSending] = useState(false);
  const [confirmSendModalOpen, setConfirmSendModalOpen] = useState(false);
  const [deleteTargetMessage, setDeleteTargetMessage] = useState<InboxMessage | null>(null);

  // Preloaded data
  const [customers, setCustomers] = useState<UserProfile[]>([]);
  const [riders, setRiders] = useState<Rider[]>([]);
  const [merchants, setMerchants] = useState<MerchantOption[]>([]);
  const [sentMessages, setSentMessages] = useState<InboxMessage[]>([]);
  const [loadingInitial, setLoadingInitial] = useState(true);

  // List filter states
  const [audienceFilter, setAudienceFilter] = useState<'all' | 'customers' | 'drivers' | 'merchants'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [searchLogQuery, setSearchLogQuery] = useState('');

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        customerDropdownRef.current &&
        !customerDropdownRef.current.contains(e.target as Node)
      ) {
        setIsCustomerDropdownOpen(false);
      }
      if (
        merchantDropdownRef.current &&
        !merchantDropdownRef.current.contains(e.target as Node)
      ) {
        setIsMerchantDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fetch initial data (No composite queries: sorted in code)
  const fetchData = async () => {
    try {
      setLoadingInitial(true);

      // 1. Fetch Customers: users where role == 'customer'
      const custQuery = query(
        collection(db, 'users'),
        where('role', '==', 'customer'),
        limit(500)
      );
      const custSnap = await getDocs(custQuery);
      const custList: UserProfile[] = [];
      custSnap.forEach((d) => {
        custList.push({ uid: d.id, ...(d.data() as any) });
      });
      // Sort in code by name or email
      custList.sort((a, b) => (a.name || a.email || '').localeCompare(b.name || b.email || ''));
      setCustomers(custList);

      // Check preselected customer
      if (preselectedCustomerId) {
        const found = custList.find((c) => c.uid === preselectedCustomerId);
        if (found) setSelectedCustomer(found);
      }

      // 2. Fetch Drivers: riders collection
      const riderSnap = await getDocs(query(collection(db, 'riders'), limit(200)));
      const riderList: Rider[] = [];
      riderSnap.forEach((d) => {
        riderList.push({ id: d.id, ...(d.data() as any) });
      });
      riderList.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      setRiders(riderList);

      // 3. Fetch Merchants for Action Link picker and recipient targeting
      const merchantSnap = await getDocs(query(collection(db, 'merchants'), limit(250)));
      const merchantList: MerchantOption[] = [];
      merchantSnap.forEach((d) => {
        const data = d.data();
        merchantList.push({
          id: d.id,
          businessName: data.name || data.businessName || 'Merchant',
          email: data.email || data.ownerEmail || '',
          type: data.type || 'food',
          cityId: data.cityId
        });
      });
      merchantList.sort((a, b) => a.businessName.localeCompare(b.businessName));
      setMerchants(merchantList);

      // Check preselected merchant
      if (preselectedMerchantId) {
        const found = merchantList.find((m) => m.id === preselectedMerchantId);
        if (found) setSelectedMerchantRecipient(found);
      }

      // 4. Fetch Sent Inbox messages (No composite queries: sort in code)
      const inboxSnap = await getDocs(query(collection(db, 'inbox'), limit(300)));
      const msgList: InboxMessage[] = [];
      inboxSnap.forEach((d) => {
        msgList.push({ id: d.id, ...(d.data() as any) });
      });
      // Sort in code by createdAt descending
      msgList.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setSentMessages(msgList);
    } catch (err) {
      showError(err);
    } finally {
      setLoadingInitial(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Filtered customers for type-ahead registered email search (in code)
  const filteredCustomers = useMemo(() => {
    const q = customerSearchQuery.trim().toLowerCase();
    if (!q) {
      return customers.slice(0, 15);
    }
    return customers
      .filter((c) => {
        const emailMatch = c.email?.toLowerCase().includes(q);
        const nameMatch = c.name?.toLowerCase().includes(q);
        const phoneMatch = c.phone?.includes(q);
        const uidMatch = c.uid.toLowerCase().includes(q);
        return emailMatch || nameMatch || phoneMatch || uidMatch;
      })
      .slice(0, 15);
  }, [customers, customerSearchQuery]);

  // Filtered merchants for type-ahead picker by shop name or email (in code)
  const filteredMerchantRecipients = useMemo(() => {
    const q = merchantSearchQuery.trim().toLowerCase();
    if (!q) {
      return merchants.slice(0, 15);
    }
    return merchants
      .filter((m) => {
        const nameMatch = m.businessName.toLowerCase().includes(q);
        const emailMatch = m.email?.toLowerCase().includes(q);
        const idMatch = m.id.toLowerCase().includes(q);
        return nameMatch || emailMatch || idMatch;
      })
      .slice(0, 15);
  }, [merchants, merchantSearchQuery]);

  // Selected Driver object
  const selectedRider = useMemo(() => {
    return riders.find((r) => r.id === selectedRiderId) || null;
  }, [riders, selectedRiderId]);

  // Recipient description for confirm dialog and logs
  const getRecipientSummary = () => {
    switch (sendTo) {
      case 'all_customers':
        return {
          title: 'All Delivio Customers',
          audience: 'all_customers',
          details: 'Broadcast message to every registered customer account.'
        };
      case 'one_customer':
        return {
          title: selectedCustomer
            ? `${selectedCustomer.name} (${selectedCustomer.email})`
            : 'Single Customer',
          audience: null,
          details: `Direct message to customer ${selectedCustomer?.name || 'UID: ' + selectedCustomer?.uid}.`
        };
      case 'all_riders':
        return {
          title: 'All Fleet Drivers',
          audience: 'all_riders',
          details: 'Broadcast message to every active driver in the fleet.'
        };
      case 'one_rider':
        return {
          title: selectedRider
            ? `${selectedRider.name} (${selectedRider.riderCode || selectedRider.id})`
            : 'Single Driver',
          audience: null,
          details: `Direct dispatch to driver ${selectedRider?.name || selectedRiderId}.`
        };
      case 'all_merchants':
        return {
          title: 'All Partner Merchants',
          audience: 'all_merchants',
          details: 'Broadcast message to every registered partner store.'
        };
      case 'one_merchant':
        return {
          title: selectedMerchantRecipient
            ? `${selectedMerchantRecipient.businessName} (${selectedMerchantRecipient.email || selectedMerchantRecipient.id})`
            : 'Single Merchant',
          audience: null,
          details: `Direct message to merchant store ${selectedMerchantRecipient?.businessName || selectedMerchantRecipient?.id}.`
        };
    }
  };

  // Pre-validate before opening confirm dialog
  const handleInitiateSend = (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim()) {
      showError('Please enter a message title.');
      return;
    }
    if (!body.trim()) {
      showError('Please enter the message body content.');
      return;
    }

    if (sendTo === 'one_customer' && !selectedCustomer) {
      showError('Please search and select a target customer by email.');
      return;
    }

    if (sendTo === 'one_rider' && !selectedRiderId) {
      showError('Please select a target driver from the fleet list.');
      return;
    }

    if (sendTo === 'one_merchant' && !selectedMerchantRecipient) {
      showError('Please search and select a partner merchant by shop name or email.');
      return;
    }

    if (linkType === 'merchant' && !selectedMerchantId) {
      showError('Please select a merchant store for the action link.');
      return;
    }

    setConfirmSendModalOpen(true);
  };

  // Perform Firestore write
  const handleConfirmSend = async () => {
    try {
      setSending(true);

      // Format link payload
      let linkPayload: InboxLink | null = null;
      if (linkType === 'merchant' && selectedMerchantId) {
        linkPayload = {
          merchantId: selectedMerchantId,
          category: null
        };
      } else if (linkType === 'category_food') {
        linkPayload = {
          merchantId: null,
          category: 'food'
        };
      } else if (linkType === 'category_convenience') {
        linkPayload = {
          merchantId: null,
          category: 'convenience'
        };
      }

      // Prepare payload matching exact user specification:
      // inbox/{id} {title, body, category, imageUrl, link {merchantId, category}, audience, customerId, riderId, merchantId, createdAt, createdBy, createdByName}
      // using null for unused fields
      const now = Timestamp.now();
      const payload: Record<string, any> = {
        title: title.trim(),
        body: body.trim(),
        category,
        imageUrl: imageUrl.trim() ? imageUrl.trim() : null,
        link: linkPayload,
        audience:
          sendTo === 'all_customers'
            ? 'all_customers'
            : sendTo === 'all_riders'
            ? 'all_riders'
            : sendTo === 'all_merchants'
            ? 'all_merchants'
            : null,
        customerId: sendTo === 'one_customer' ? selectedCustomer?.uid || null : null,
        riderId: sendTo === 'one_rider' ? selectedRiderId || null : null,
        merchantId: sendTo === 'one_merchant' ? selectedMerchantRecipient?.id || null : null,
        createdAt: now,
        createdBy: adminProfile?.uid || 'admin',
        createdByName: adminProfile?.name || 'Administrator',
        // Auxiliary metadata for convenient UI rendering
        customerName: sendTo === 'one_customer' ? selectedCustomer?.name || null : null,
        customerEmail: sendTo === 'one_customer' ? selectedCustomer?.email || null : null,
        riderName: sendTo === 'one_rider' ? selectedRider?.name || null : null,
        merchantName: sendTo === 'one_merchant' ? selectedMerchantRecipient?.businessName || null : null,
        merchantEmail: sendTo === 'one_merchant' ? selectedMerchantRecipient?.email || null : null,
        sentBy: adminProfile?.name || 'Administrator',
        sentById: adminProfile?.uid || 'admin'
      };

      const docRef = await addDoc(collection(db, 'inbox'), payload);

      const recipientInfo = getRecipientSummary();
      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        adminEmail: adminProfile?.email,
        action: 'SEND_INBOX_MESSAGE',
        entityType: 'inbox',
        entityId: docRef.id,
        details: `Dispatched [${category.toUpperCase()}] message "${title.trim()}" to ${recipientInfo.title}`
      });

      showSuccess(`Message dispatched to ${recipientInfo.title}!`);

      // Reset form
      setTitle('');
      setBody('');
      setImageUrl('');
      setImageLoadError(false);
      setLinkType('none');
      setSelectedMerchantId('');
      if (sendTo === 'one_customer') {
        setSelectedCustomer(null);
        setCustomerSearchQuery('');
      }
      if (sendTo === 'one_merchant') {
        setSelectedMerchantRecipient(null);
        setMerchantSearchQuery('');
      }

      setConfirmSendModalOpen(false);

      // Prepend to local sent list
      setSentMessages((prev) => [
        {
          id: docRef.id,
          ...payload
        } as InboxMessage,
        ...prev
      ]);
    } catch (err: any) {
      showError(err);
    } finally {
      setSending(false);
    }
  };

  // Delete sent message action
  const handleDeleteMessage = async (reason: string) => {
    if (!deleteTargetMessage) return;
    try {
      await deleteDoc(doc(db, 'inbox', deleteTargetMessage.id));

      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        adminEmail: adminProfile?.email,
        action: 'DELETE_INBOX_MESSAGE',
        entityType: 'inbox',
        entityId: deleteTargetMessage.id,
        details: `Deleted inbox message "${deleteTargetMessage.title}" (ID: ${deleteTargetMessage.id}). Reason: ${reason || 'Admin removed broadcast'}`,
        reason: reason || 'Admin deleted message'
      });

      setSentMessages((prev) => prev.filter((m) => m.id !== deleteTargetMessage.id));
      showSuccess('Inbox message removed successfully.');
      setDeleteTargetMessage(null);
    } catch (err: any) {
      showError(err);
    }
  };

  // Filtered Sent list in code (No composite query)
  const filteredSentMessages = useMemo(() => {
    return sentMessages.filter((msg) => {
      // 1. Audience filter
      if (audienceFilter === 'customers') {
        const isCust = msg.audience === 'all_customers' || Boolean(msg.customerId);
        if (!isCust) return false;
      } else if (audienceFilter === 'drivers') {
        const isRider = msg.audience === 'all_riders' || Boolean(msg.riderId);
        if (!isRider) return false;
      } else if (audienceFilter === 'merchants') {
        const isMerchant = msg.audience === 'all_merchants' || Boolean(msg.merchantId);
        if (!isMerchant) return false;
      }

      // 2. Category filter
      if (categoryFilter !== 'all') {
        if (msg.category !== categoryFilter) return false;
      }

      // 3. Search query
      if (searchLogQuery.trim()) {
        const q = searchLogQuery.toLowerCase().trim();
        const titleMatch = msg.title?.toLowerCase().includes(q);
        const bodyMatch = msg.body?.toLowerCase().includes(q);
        const custMatch =
          msg.customerName?.toLowerCase().includes(q) ||
          msg.customerEmail?.toLowerCase().includes(q) ||
          msg.customerId?.toLowerCase().includes(q);
        const riderMatch =
          msg.riderName?.toLowerCase().includes(q) ||
          msg.riderId?.toLowerCase().includes(q);
        const merchantMatch =
          msg.merchantName?.toLowerCase().includes(q) ||
          msg.merchantEmail?.toLowerCase().includes(q) ||
          msg.merchantId?.toLowerCase().includes(q);
        if (!titleMatch && !bodyMatch && !custMatch && !riderMatch && !merchantMatch) {
          return false;
        }
      }

      return true;
    });
  }, [sentMessages, audienceFilter, categoryFilter, searchLogQuery]);

  // Category Badge Helper
  const getCategoryBadge = (cat: string) => {
    switch (cat) {
      case 'update':
        return 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800';
      case 'promo':
        return 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 border-purple-200 dark:border-purple-800';
      case 'order':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border-blue-200 dark:border-blue-800';
      case 'wallet':
        return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
      case 'safety':
        return 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300 border-red-200 dark:border-red-800';
      case 'system':
        return 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700';
      case 'admin':
        return 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border-amber-200 dark:border-amber-800';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-zinc-800 dark:text-zinc-300 border-gray-200 dark:border-zinc-700';
    }
  };

  // Recipient pill helper
  const renderRecipientPill = (msg: InboxMessage) => {
    if (msg.audience === 'all_customers') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
          <Users className="w-3 h-3" /> All Customers
        </span>
      );
    }
    if (msg.customerId) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
          <User className="w-3 h-3" />
          Customer: {msg.customerName || msg.customerEmail || msg.customerId.slice(0, 8)}
        </span>
      );
    }
    if (msg.audience === 'all_riders') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
          <Car className="w-3 h-3" /> All Drivers
        </span>
      );
    }
    if (msg.riderId) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
          <Car className="w-3 h-3" /> Driver: {msg.riderName || msg.riderId.slice(0, 8)}
        </span>
      );
    }
    if (msg.audience === 'all_merchants') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-50 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
          <Store className="w-3 h-3" /> All Merchants
        </span>
      );
    }
    if (msg.merchantId) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-50 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300 border border-orange-200 dark:border-orange-800">
          <Store className="w-3 h-3" />
          Merchant: {msg.merchantName || msg.merchantEmail || msg.merchantId.slice(0, 8)}
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 text-gray-600">
        Direct Message
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight flex items-center gap-2.5">
            <Mail className="w-7 h-7 text-amber-500" />
            <span>Inbox Dispatch Center</span>
          </h1>
          <p className="text-sm text-gray-500 dark:text-zinc-400 mt-1">
            Broadcast promotional updates, order notices, safety alerts, and direct messages to customers and drivers.
          </p>
        </div>

        {/* Counter chips */}
        <div className="flex items-center gap-2">
          <span className="px-3 py-1.5 rounded-xl text-xs font-bold bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 text-gray-700 dark:text-zinc-300 shadow-2xs">
            {sentMessages.length} Messages Dispatched
          </span>
        </div>
      </div>

      {/* Main Grid: Left = Compose, Right = Sent History */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* COMPOSE FORM CARD (5 cols) */}
        <div className="lg:col-span-5 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-5 sm:p-6 shadow-xs space-y-5">
          <div className="flex items-center justify-between pb-3 border-b border-gray-100 dark:border-zinc-800">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-amber-500" />
              <h2 className="font-extrabold text-base text-gray-900 dark:text-white">
                Compose Message
              </h2>
            </div>
            <span className="text-[11px] font-medium text-gray-400">
              Instant in-app notice
            </span>
          </div>

          <form onSubmit={handleInitiateSend} className="space-y-4">
            {/* 1. Send To Selector (4 options) */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-zinc-300 mb-1.5">
                Send To <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                {/* All Customers */}
                <button
                  type="button"
                  onClick={() => {
                    setSendTo('all_customers');
                    setSelectedCustomer(null);
                  }}
                  className={`p-2.5 rounded-2xl text-left border transition-all flex flex-col gap-1 ${
                    sendTo === 'all_customers'
                      ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-500 shadow-xs ring-1 ring-amber-400'
                      : 'bg-gray-50 dark:bg-zinc-800/60 border-gray-200 dark:border-zinc-800 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-xs font-bold text-gray-900 dark:text-white">
                    <Users className="w-4 h-4 text-blue-500" />
                    <span>All Customers</span>
                  </div>
                  <span className="text-[10px] text-gray-500 dark:text-zinc-400">
                    audience: all_customers
                  </span>
                </button>

                {/* One Customer */}
                <button
                  type="button"
                  onClick={() => setSendTo('one_customer')}
                  className={`p-2.5 rounded-2xl text-left border transition-all flex flex-col gap-1 ${
                    sendTo === 'one_customer'
                      ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-500 shadow-xs ring-1 ring-amber-400'
                      : 'bg-gray-50 dark:bg-zinc-800/60 border-gray-200 dark:border-zinc-800 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-xs font-bold text-gray-900 dark:text-white">
                    <UserCheck className="w-4 h-4 text-sky-500" />
                    <span>One Customer</span>
                  </div>
                  <span className="text-[10px] text-gray-500 dark:text-zinc-400 truncate">
                    {selectedCustomer ? selectedCustomer.email : 'Search by email'}
                  </span>
                </button>

                {/* All Drivers */}
                <button
                  type="button"
                  onClick={() => {
                    setSendTo('all_riders');
                    setSelectedRiderId('');
                  }}
                  className={`p-2.5 rounded-2xl text-left border transition-all flex flex-col gap-1 ${
                    sendTo === 'all_riders'
                      ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-500 shadow-xs ring-1 ring-amber-400'
                      : 'bg-gray-50 dark:bg-zinc-800/60 border-gray-200 dark:border-zinc-800 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-xs font-bold text-gray-900 dark:text-white">
                    <Car className="w-4 h-4 text-amber-500" />
                    <span>All Drivers</span>
                  </div>
                  <span className="text-[10px] text-gray-500 dark:text-zinc-400">
                    audience: all_riders
                  </span>
                </button>

                {/* One Driver */}
                <button
                  type="button"
                  onClick={() => setSendTo('one_rider')}
                  className={`p-2.5 rounded-2xl text-left border transition-all flex flex-col gap-1 ${
                    sendTo === 'one_rider'
                      ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-500 shadow-xs ring-1 ring-amber-400'
                      : 'bg-gray-50 dark:bg-zinc-800/60 border-gray-200 dark:border-zinc-800 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-xs font-bold text-gray-900 dark:text-white">
                    <Car className="w-4 h-4 text-emerald-500" />
                    <span>One Driver</span>
                  </div>
                  <span className="text-[10px] text-gray-500 dark:text-zinc-400 truncate">
                    {selectedRider ? selectedRider.name : 'Pick from fleet'}
                  </span>
                </button>

                {/* All Merchants */}
                <button
                  type="button"
                  onClick={() => {
                    setSendTo('all_merchants');
                    setSelectedMerchantRecipient(null);
                  }}
                  className={`p-2.5 rounded-2xl text-left border transition-all flex flex-col gap-1 ${
                    sendTo === 'all_merchants'
                      ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-500 shadow-xs ring-1 ring-amber-400'
                      : 'bg-gray-50 dark:bg-zinc-800/60 border-gray-200 dark:border-zinc-800 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-xs font-bold text-gray-900 dark:text-white">
                    <Store className="w-4 h-4 text-purple-500" />
                    <span>All Merchants</span>
                  </div>
                  <span className="text-[10px] text-gray-500 dark:text-zinc-400">
                    audience: all_merchants
                  </span>
                </button>

                {/* One Merchant */}
                <button
                  type="button"
                  onClick={() => setSendTo('one_merchant')}
                  className={`p-2.5 rounded-2xl text-left border transition-all flex flex-col gap-1 ${
                    sendTo === 'one_merchant'
                      ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-500 shadow-xs ring-1 ring-amber-400'
                      : 'bg-gray-50 dark:bg-zinc-800/60 border-gray-200 dark:border-zinc-800 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-xs font-bold text-gray-900 dark:text-white">
                    <Store className="w-4 h-4 text-orange-500" />
                    <span>One Merchant</span>
                  </div>
                  <span className="text-[10px] text-gray-500 dark:text-zinc-400 truncate">
                    {selectedMerchantRecipient ? selectedMerchantRecipient.businessName : 'Pick store'}
                  </span>
                </button>
              </div>
            </div>

            {/* Recipient Picker: One Customer */}
            {sendTo === 'one_customer' && (
              <div className="p-3 rounded-2xl bg-sky-50/60 dark:bg-sky-950/20 border border-sky-200 dark:border-sky-900/40 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-sky-950 dark:text-sky-300 flex items-center gap-1.5">
                    <UserCheck className="w-4 h-4 text-sky-600" />
                    <span>Target Customer (Registered Email)</span>
                  </label>
                  {selectedCustomer && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCustomer(null);
                        setCustomerSearchQuery('');
                      }}
                      className="text-[11px] font-bold text-red-600 hover:underline flex items-center gap-1"
                    >
                      <X className="w-3 h-3" /> Change
                    </button>
                  )}
                </div>

                {selectedCustomer ? (
                  <div className="p-2.5 rounded-xl bg-white dark:bg-zinc-850 border border-sky-200 dark:border-sky-800 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-sky-100 dark:bg-sky-900 text-sky-800 dark:text-sky-200 font-bold flex items-center justify-center shrink-0 text-xs">
                        {selectedCustomer.name?.charAt(0) || 'C'}
                      </div>
                      <div className="min-w-0">
                        <div className="font-bold text-xs text-gray-900 dark:text-white truncate">
                          {selectedCustomer.name}
                        </div>
                        <div className="text-[11px] text-sky-700 dark:text-sky-300 font-mono truncate">
                          {selectedCustomer.email}
                        </div>
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-300 shrink-0">
                      Selected
                    </span>
                  </div>
                ) : (
                  <div className="relative" ref={customerDropdownRef}>
                    <div className="relative">
                      <Search className="w-4 h-4 absolute left-3 top-2.5 text-gray-400" />
                      <input
                        type="text"
                        value={customerSearchQuery}
                        onChange={(e) => {
                          setCustomerSearchQuery(e.target.value);
                          setIsCustomerDropdownOpen(true);
                        }}
                        onFocus={() => setIsCustomerDropdownOpen(true)}
                        placeholder="Type customer email (e.g. user@gmail.com)..."
                        className="w-full pl-9 pr-4 py-2 rounded-xl text-xs border border-sky-300 dark:border-sky-800 bg-white dark:bg-zinc-900 text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-sky-400"
                      />
                    </div>

                    {/* Type-ahead Dropdown List */}
                    {isCustomerDropdownOpen && (
                      <div className="absolute left-0 right-0 top-full mt-1 max-h-52 overflow-y-auto bg-white dark:bg-zinc-850 border border-gray-200 dark:border-zinc-700 rounded-xl shadow-xl z-20 py-1 divide-y divide-gray-100 dark:divide-zinc-800">
                        {filteredCustomers.length === 0 ? (
                          <div className="p-3 text-center text-xs text-gray-400">
                            No customers found matching "{customerSearchQuery}".
                          </div>
                        ) : (
                          filteredCustomers.map((cust) => (
                            <button
                              key={cust.uid}
                              type="button"
                              onClick={() => {
                                setSelectedCustomer(cust);
                                setIsCustomerDropdownOpen(false);
                                setCustomerSearchQuery('');
                              }}
                              className="w-full text-left p-2.5 hover:bg-sky-50 dark:hover:bg-zinc-800 flex items-center justify-between gap-2 transition-colors"
                            >
                              <div className="min-w-0">
                                <div className="font-bold text-xs text-gray-900 dark:text-white truncate">
                                  {cust.name || 'Unnamed Customer'}
                                </div>
                                <div className="text-[11px] text-sky-600 dark:text-sky-400 font-mono truncate">
                                  {cust.email}
                                </div>
                              </div>
                              <span className="text-[10px] text-gray-400 font-mono shrink-0">
                                UID: {cust.uid.slice(0, 6)}
                              </span>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Recipient Picker: One Driver */}
            {sendTo === 'one_rider' && (
              <div className="p-3 rounded-2xl bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 space-y-1.5">
                <label className="block text-xs font-bold text-amber-950 dark:text-amber-300">
                  Select Target Driver <span className="text-red-500">*</span>
                </label>
                <select
                  value={selectedRiderId}
                  onChange={(e) => setSelectedRiderId(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-amber-300 dark:border-amber-800 bg-white dark:bg-zinc-900 text-gray-900 dark:text-white"
                >
                  <option value="">-- Choose Fleet Driver --</option>
                  {riders.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.riderCode || r.id.slice(0, 6)}) • {r.vehicleType || 'Motorcycle'} • {r.phone || 'No phone'}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Recipient Picker: One Merchant */}
            {sendTo === 'one_merchant' && (
              <div className="p-3 rounded-2xl bg-orange-50/60 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-900/40 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-orange-950 dark:text-orange-300 flex items-center gap-1.5">
                    <Store className="w-4 h-4 text-orange-600" />
                    <span>Target Partner Merchant (Shop Name or Email)</span>
                  </label>
                  {selectedMerchantRecipient && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedMerchantRecipient(null);
                        setMerchantSearchQuery('');
                      }}
                      className="text-[11px] font-bold text-red-600 hover:underline flex items-center gap-1"
                    >
                      <X className="w-3 h-3" /> Change
                    </button>
                  )}
                </div>

                {selectedMerchantRecipient ? (
                  <div className="p-2.5 rounded-xl bg-white dark:bg-zinc-850 border border-orange-200 dark:border-orange-800 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200 font-bold flex items-center justify-center shrink-0 text-xs">
                        <Store className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-bold text-xs text-gray-900 dark:text-white truncate">
                          {selectedMerchantRecipient.businessName}
                        </div>
                        <div className="text-[11px] text-orange-700 dark:text-orange-300 font-mono truncate">
                          {selectedMerchantRecipient.email || `Store ID: ${selectedMerchantRecipient.id}`}
                        </div>
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-100 text-orange-800 dark:bg-orange-900/60 dark:text-orange-300 shrink-0 capitalize">
                      {selectedMerchantRecipient.type}
                    </span>
                  </div>
                ) : (
                  <div className="relative" ref={merchantDropdownRef}>
                    <div className="relative">
                      <Search className="w-4 h-4 absolute left-3 top-2.5 text-gray-400" />
                      <input
                        type="text"
                        value={merchantSearchQuery}
                        onChange={(e) => {
                          setMerchantSearchQuery(e.target.value);
                          setIsMerchantDropdownOpen(true);
                        }}
                        onFocus={() => setIsMerchantDropdownOpen(true)}
                        placeholder="Search store by shop name, email, or store ID..."
                        className="w-full pl-9 pr-4 py-2 rounded-xl text-xs border border-orange-300 dark:border-orange-800 bg-white dark:bg-zinc-900 text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-orange-400"
                      />
                    </div>

                    {/* Type-ahead Dropdown List */}
                    {isMerchantDropdownOpen && (
                      <div className="absolute left-0 right-0 top-full mt-1 max-h-52 overflow-y-auto bg-white dark:bg-zinc-850 border border-gray-200 dark:border-zinc-700 rounded-xl shadow-xl z-20 py-1 divide-y divide-gray-100 dark:divide-zinc-800">
                        {filteredMerchantRecipients.length === 0 ? (
                          <div className="p-3 text-center text-xs text-gray-400">
                            No merchants found matching "{merchantSearchQuery}".
                          </div>
                        ) : (
                          filteredMerchantRecipients.map((m) => (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => {
                                setSelectedMerchantRecipient(m);
                                setIsMerchantDropdownOpen(false);
                                setMerchantSearchQuery('');
                              }}
                              className="w-full text-left p-2.5 hover:bg-orange-50 dark:hover:bg-zinc-800 flex items-center justify-between gap-2 transition-colors"
                            >
                              <div className="min-w-0">
                                <div className="font-bold text-xs text-gray-900 dark:text-white truncate">
                                  {m.businessName}
                                </div>
                                <div className="text-[11px] text-orange-600 dark:text-orange-400 font-mono truncate">
                                  {m.email || 'No email on profile'}
                                </div>
                              </div>
                              <span className="text-[10px] text-gray-400 font-mono shrink-0">
                                ID: {m.id.slice(0, 6)}
                              </span>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* 2. Category */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-zinc-300 mb-1">
                Category
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as InboxCategory)}
                className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white font-medium"
              >
                <option value="update">Platform / Account Update (update)</option>
                <option value="order">Order Coordination (order)</option>
                <option value="wallet">Wallet & Payments (wallet)</option>
                <option value="promo">Promo & Deals (promo)</option>
                <option value="system">System Notification (system)</option>
                <option value="admin">Admin Notice (admin)</option>
                <option value="safety">Safety & Weather Advisory (safety)</option>
              </select>
            </div>

            {/* 3. Title */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-zinc-300 mb-1">
                Message Title <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                placeholder="e.g. Weekend Flash Sale! 20% off all deliveries"
                className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold text-gray-900 dark:text-white placeholder:font-normal"
              />
            </div>

            {/* 4. Body */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-zinc-300 mb-1">
                Message Content <span className="text-red-500">*</span>
              </label>
              <textarea
                rows={3}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                required
                placeholder="Write your announcement, instructions, or notification details..."
                className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-gray-900 dark:text-white leading-relaxed"
              />
            </div>

            {/* 5. Optional Image URL with Live Preview */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-zinc-300 flex items-center gap-1.5">
                  <ImageIcon className="w-3.5 h-3.5 text-gray-400" />
                  <span>Optional Image Banner URL</span>
                </label>
                {imageUrl && (
                  <button
                    type="button"
                    onClick={() => {
                      setImageUrl('');
                      setImageLoadError(false);
                    }}
                    className="text-[11px] text-gray-400 hover:text-red-500"
                  >
                    Clear Image
                  </button>
                )}
              </div>
              <input
                type="url"
                value={imageUrl}
                onChange={(e) => {
                  setImageUrl(e.target.value);
                  setImageLoadError(false);
                }}
                placeholder="https://images.unsplash.com/... or uploaded photo link"
                className="w-full px-3.5 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-gray-900 dark:text-white font-mono placeholder:font-sans"
              />

              {/* Live Preview of Image */}
              {imageUrl.trim() && (
                <div className="p-2 rounded-2xl border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800/50 space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] font-bold text-gray-500">
                    <span className="flex items-center gap-1">
                      <Eye className="w-3 h-3 text-amber-500" /> Live Banner Preview
                    </span>
                  </div>
                  {imageLoadError ? (
                    <div className="p-4 rounded-xl bg-red-50 dark:bg-red-950/30 text-red-600 text-xs text-center border border-red-200 dark:border-red-900">
                      Unable to load image from URL. Please check the link.
                    </div>
                  ) : (
                    <div className="relative rounded-xl overflow-hidden aspect-video max-h-40 bg-zinc-900">
                      <img
                        src={imageUrl}
                        alt="Preview"
                        onError={() => setImageLoadError(true)}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 6. Optional Action Link (Merchant Picker or Category) */}
            <div className="space-y-2 pt-2 border-t border-gray-100 dark:border-zinc-800">
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-zinc-300">
                Optional Action Link
              </label>

              {/* Link Type Selector */}
              <div className="grid grid-cols-2 gap-1.5 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setLinkType('none');
                    setSelectedMerchantId('');
                  }}
                  className={`py-1.5 px-2 rounded-xl font-bold border transition-all text-center ${
                    linkType === 'none'
                      ? 'bg-gray-200 dark:bg-zinc-700 text-gray-900 dark:text-white border-transparent'
                      : 'bg-white dark:bg-zinc-800 text-gray-600 dark:text-zinc-400 border-gray-200 dark:border-zinc-700'
                  }`}
                >
                  No Link
                </button>
                <button
                  type="button"
                  onClick={() => setLinkType('merchant')}
                  className={`py-1.5 px-2 rounded-xl font-bold border transition-all text-center flex items-center justify-center gap-1 ${
                    linkType === 'merchant'
                      ? 'delivio-btn-yellow border-amber-500 shadow-2xs'
                      : 'bg-white dark:bg-zinc-800 text-gray-600 dark:text-zinc-400 border-gray-200 dark:border-zinc-700'
                  }`}
                >
                  <Store className="w-3.5 h-3.5" /> Merchant
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLinkType('category_food');
                    setSelectedMerchantId('');
                  }}
                  className={`py-1.5 px-2 rounded-xl font-bold border transition-all text-center flex items-center justify-center gap-1 ${
                    linkType === 'category_food'
                      ? 'delivio-btn-yellow border-amber-500 shadow-2xs'
                      : 'bg-white dark:bg-zinc-800 text-gray-600 dark:text-zinc-400 border-gray-200 dark:border-zinc-700'
                  }`}
                >
                  <ShoppingBag className="w-3.5 h-3.5" /> Food
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLinkType('category_convenience');
                    setSelectedMerchantId('');
                  }}
                  className={`py-1.5 px-2 rounded-xl font-bold border transition-all text-center flex items-center justify-center gap-1 ${
                    linkType === 'category_convenience'
                      ? 'delivio-btn-yellow border-amber-500 shadow-2xs'
                      : 'bg-white dark:bg-zinc-800 text-gray-600 dark:text-zinc-400 border-gray-200 dark:border-zinc-700'
                  }`}
                >
                  <Store className="w-3.5 h-3.5" /> Convenience
                </button>
              </div>

              {/* Merchant Picker Dropdown */}
              {linkType === 'merchant' && (
                <div className="pt-1">
                  <select
                    value={selectedMerchantId}
                    onChange={(e) => setSelectedMerchantId(e.target.value)}
                    required
                    className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                  >
                    <option value="">-- Choose Merchant Store --</option>
                    {merchants.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.businessName} ({m.type === 'food' ? 'Food & Resto' : 'Convenience Store'})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Submit Button (Opens confirmation dialog) */}
            <button
              type="submit"
              className="w-full delivio-btn-yellow py-3 rounded-2xl text-xs font-extrabold flex items-center justify-center gap-2 shadow-lg shadow-amber-400/20 active:scale-[0.99] transition-transform"
            >
              <Send className="w-4 h-4" />
              <span>Review & Dispatch Message</span>
            </button>
          </form>
        </div>

        {/* SENT MESSAGES LOG & FILTERS (7 cols) */}
        <div className="lg:col-span-7 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-5 sm:p-6 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-gray-100 dark:border-zinc-800">
            <div>
              <h2 className="font-extrabold text-base text-gray-900 dark:text-white flex items-center gap-2">
                <InboxIcon className="w-5 h-5 text-amber-500" />
                <span>Dispatched Messages Log</span>
              </h2>
              <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">
                History of in-app messages delivered to customers, drivers, and partner merchants.
              </p>
            </div>
            <span className="text-xs font-bold text-gray-400 self-start sm:self-auto">
              {filteredSentMessages.length} shown
            </span>
          </div>

          {/* Filter Bar: Recipient filter, Category filter & Search input */}
          <div className="space-y-2.5">
            {/* Top row: Audience tabs & Category dropdown */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Audience Filter Tabs */}
              <div className="flex rounded-xl bg-gray-100 dark:bg-zinc-800 p-1 text-xs font-bold">
                <button
                  type="button"
                  onClick={() => setAudienceFilter('all')}
                  className={`px-3 py-1 rounded-lg transition-all ${
                    audienceFilter === 'all'
                      ? 'bg-white dark:bg-zinc-700 text-gray-900 dark:text-white shadow-2xs'
                      : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
                  }`}
                >
                  All ({sentMessages.length})
                </button>
                <button
                  type="button"
                  onClick={() => setAudienceFilter('customers')}
                  className={`px-3 py-1 rounded-lg transition-all ${
                    audienceFilter === 'customers'
                      ? 'bg-white dark:bg-zinc-700 text-gray-900 dark:text-white shadow-2xs'
                      : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
                  }`}
                >
                  Customers
                </button>
                <button
                  type="button"
                  onClick={() => setAudienceFilter('drivers')}
                  className={`px-3 py-1 rounded-lg transition-all ${
                    audienceFilter === 'drivers'
                      ? 'bg-white dark:bg-zinc-700 text-gray-900 dark:text-white shadow-2xs'
                      : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
                  }`}
                >
                  Drivers
                </button>
                <button
                  type="button"
                  onClick={() => setAudienceFilter('merchants')}
                  className={`px-3 py-1 rounded-lg transition-all ${
                    audienceFilter === 'merchants'
                      ? 'bg-white dark:bg-zinc-700 text-gray-900 dark:text-white shadow-2xs'
                      : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
                  }`}
                >
                  Merchants
                </button>
              </div>

              {/* Category Filter */}
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="px-3 py-1.5 text-xs rounded-xl border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-700 dark:text-zinc-300 font-semibold"
              >
                <option value="all">All Categories</option>
                <option value="update">Update</option>
                <option value="order">Order</option>
                <option value="wallet">Wallet</option>
                <option value="promo">Promo</option>
                <option value="system">System</option>
                <option value="admin">Admin</option>
                <option value="safety">Safety</option>
              </select>
            </div>

            {/* Search Input (Filters in code) */}
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3.5 top-2.5 text-gray-400" />
              <input
                type="text"
                value={searchLogQuery}
                onChange={(e) => setSearchLogQuery(e.target.value)}
                placeholder="Search messages by title, content, customer or driver name..."
                className="w-full pl-9 pr-4 py-2 text-xs rounded-xl border border-gray-200 dark:border-zinc-800 bg-gray-50/60 dark:bg-zinc-800/60 text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-amber-400"
              />
            </div>
          </div>

          {/* Messages List */}
          <div className="space-y-3 max-h-[640px] overflow-y-auto pr-1">
            {loadingInitial ? (
              <div className="p-12 text-center text-xs text-gray-400 flex flex-col items-center gap-2">
                <Loader2 className="w-6 h-6 animate-spin text-amber-500" />
                <span>Loading messages history...</span>
              </div>
            ) : filteredSentMessages.length === 0 ? (
              <div className="p-12 text-center text-xs text-gray-400 border border-dashed border-gray-200 dark:border-zinc-800 rounded-3xl">
                <InboxIcon className="w-8 h-8 mx-auto text-gray-300 mb-2" />
                <p className="font-bold text-gray-700 dark:text-zinc-300">No dispatched messages found</p>
                <p className="text-[11px] mt-1">Try clearing your search query or audience filter.</p>
              </div>
            ) : (
              filteredSentMessages.map((msg) => (
                <div
                  key={msg.id}
                  className="p-4 rounded-2xl border border-gray-100 dark:border-zinc-800 bg-gray-50/70 dark:bg-zinc-850/60 text-xs space-y-2.5 hover:border-gray-200 transition-colors"
                >
                  {/* Top Bar: Badges + Timestamp + Delete */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {/* Category Badge */}
                      <span
                        className={`capitalize px-2 py-0.5 rounded-md text-[10px] font-bold border ${getCategoryBadge(
                          msg.category
                        )}`}
                      >
                        {msg.category}
                      </span>

                      {/* Recipient Pill */}
                      {renderRecipientPill(msg)}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        title={formatTimestamp(msg.createdAt)}
                        className="text-[10px] text-gray-400 flex items-center gap-1"
                      >
                        <Clock className="w-3 h-3" />
                        {formatRelativeTime(msg.createdAt)}
                      </span>

                      {/* Delete Action button */}
                      <button
                        onClick={() => setDeleteTargetMessage(msg)}
                        title="Delete Message"
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Title & Body */}
                  <div>
                    <h3 className="font-bold text-gray-900 dark:text-white text-sm">
                      {msg.title}
                    </h3>
                    <p className="text-gray-700 dark:text-zinc-300 mt-1 whitespace-pre-wrap leading-relaxed">
                      {msg.body}
                    </p>
                  </div>

                  {/* Optional Image thumbnail in sent list */}
                  {msg.imageUrl && (
                    <div className="rounded-xl overflow-hidden max-h-32 bg-zinc-900 border border-gray-200 dark:border-zinc-700 w-fit">
                      <img
                        src={msg.imageUrl}
                        alt="Message attachment"
                        className="h-28 w-auto object-cover"
                      />
                    </div>
                  )}

                  {/* Optional Link Chip */}
                  {msg.link && (
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 text-[11px] font-bold border border-amber-200/60 dark:border-amber-900/40">
                      <ExternalLink className="w-3 h-3" />
                      {msg.link.merchantId ? (
                        <span>
                          Store Link:{' '}
                          {merchants.find((m) => m.id === msg.link?.merchantId)?.businessName ||
                            `Merchant ID ${msg.link.merchantId}`}
                        </span>
                      ) : msg.link.category ? (
                        <span>
                          Category: {msg.link.category === 'food' ? 'Food & Restaurants' : 'Convenience'}
                        </span>
                      ) : (
                        <span>Action Link</span>
                      )}
                    </div>
                  )}

                  {/* Footer: Sender */}
                  <div className="pt-2 border-t border-gray-200/60 dark:border-zinc-800 flex items-center justify-between text-[11px] text-gray-400">
                    <span>
                      Dispatched by: <strong>{msg.createdByName || msg.sentBy || 'Admin'}</strong>
                    </span>
                    <span className="font-mono text-[10px]">ID: {msg.id.slice(0, 10)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* CONFIRM SEND MODAL (Dialog showing who receives it) */}
      {confirmSendModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div
            className="w-full max-w-lg bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl shadow-2xl p-6 overflow-hidden space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                  <Send className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-lg text-gray-900 dark:text-white">
                    Confirm Message Dispatch
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-zinc-400">
                    Review target audience and message details before sending.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setConfirmSendModalOpen(false)}
                disabled={sending}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Target Audience Highlight Box */}
            <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800/80 space-y-1">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-amber-800 dark:text-amber-300 block">
                Target Recipient
              </span>
              <div className="text-sm font-extrabold text-amber-950 dark:text-amber-200 flex items-center gap-2">
                {sendTo.includes('customer') ? (
                  <Users className="w-4 h-4 text-amber-600" />
                ) : (
                  <Car className="w-4 h-4 text-amber-600" />
                )}
                <span>{getRecipientSummary().title}</span>
              </div>
              <p className="text-xs text-amber-800/80 dark:text-amber-300/80">
                {getRecipientSummary().details}
              </p>
            </div>

            {/* Message Preview Card */}
            <div className="p-4 rounded-2xl border border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-850/50 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span
                  className={`capitalize px-2 py-0.5 rounded-md text-[10px] font-bold border ${getCategoryBadge(
                    category
                  )}`}
                >
                  {category}
                </span>
                <span className="text-[11px] text-gray-400">Preview</span>
              </div>

              <h4 className="font-bold text-gray-900 dark:text-white text-sm">{title}</h4>
              <p className="text-gray-600 dark:text-zinc-300 whitespace-pre-wrap">{body}</p>

              {imageUrl && (
                <div className="rounded-xl overflow-hidden aspect-video max-h-36 bg-zinc-900 mt-2">
                  <img src={imageUrl} alt="Attachment" className="w-full h-full object-cover" />
                </div>
              )}

              {linkType !== 'none' && (
                <div className="pt-2 border-t border-gray-200 dark:border-zinc-700/60 flex items-center gap-1.5 text-[11px] font-bold text-amber-600 dark:text-amber-400">
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>
                    Action Link:{' '}
                    {linkType === 'merchant'
                      ? merchants.find((m) => m.id === selectedMerchantId)?.businessName || 'Store'
                      : linkType === 'category_food'
                      ? 'Food Category'
                      : 'Convenience Category'}
                  </span>
                </div>
              )}
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmSendModalOpen(false)}
                disabled={sending}
                className="px-4 py-2.5 rounded-xl text-xs font-bold text-gray-600 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmSend}
                disabled={sending}
                className="delivio-btn-yellow px-6 py-2.5 rounded-xl text-xs font-extrabold flex items-center gap-2 shadow-md shadow-amber-400/20 disabled:opacity-50"
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                <span>Confirm & Send Now</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRM DELETE MODAL */}
      {deleteTargetMessage && (
        <ConfirmationModal
          isOpen={Boolean(deleteTargetMessage)}
          onClose={() => setDeleteTargetMessage(null)}
          onConfirm={handleDeleteMessage}
          title="Delete Inbox Message"
          message={`Are you sure you want to permanently delete message "${deleteTargetMessage.title}"? This cannot be undone and will be logged in audit records.`}
          confirmLabel="Delete Message"
          reasonRequired={false}
          reasonPlaceholder="Specify optional reason for deleting this message..."
          isDestructive={true}
        />
      )}
    </div>
  );
};
