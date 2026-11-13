import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Headphones,
  Search,
  Filter,
  CheckCircle2,
  Clock,
  AlertTriangle,
  User,
  ShoppingBag,
  Store,
  Car,
  Image as ImageIcon,
  Send,
  Camera,
  X,
  ExternalLink,
  Ban,
  RotateCcw,
  MessageSquare,
  ChevronRight,
  Loader2,
  Sparkles,
  Info,
  Check,
  Phone,
  Mail,
  MapPin,
  Maximize2,
  Layers,
  Split,
  PackageX,
  CheckSquare,
  Square,
  Truck,
  Users,
  ShieldAlert,
  ArrowRight,
  Building2
} from 'lucide-react';
import {
  db,
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  query,
  where,
  limit,
  onSnapshot,
  Timestamp,
  runTransaction,
  writeBatch,
  arrayUnion,
  increment
} from '../firebase';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useCity } from '../context/CityContext';
import {
  SUPPORT_TICKET_REASONS,
  SUPPORT_CANNED_REPLIES,
  DRIVER_SUPPORT_REASONS,
  DRIVER_CANNED_REPLIES
} from '../constants';
import { compressImageToDataUri } from '../utils/imageCompressor';
import { formatRelativeTime, formatTimestamp, parseDate } from '../utils/date';
import { formatOrderNumber, matchesOrderSearch } from '../utils/orderNumber';
import { getChainOptions, resolveOrderChainId, resolveOrderMerchantDisplay } from '../utils/outletUtils';
import type { SupportTicket, SupportTicketMessage, Order, SupportTicketStatus, Merchant } from '../types';

export const Support: React.FC = () => {
  const { adminProfile } = useAuth();
  const { showSuccess, showError } = useToast();
  const { selectedCityId } = useCity();
  const navigate = useNavigate();

  // Audience toggle: Customers vs Drivers
  const [supportAudience, setSupportAudience] = useState<'customer' | 'rider'>('customer');

  // Tickets state
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);

  // Filters
  const [activeReasonTab, setActiveReasonTab] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'in_progress' | 'resolved'>('all');
  const [serviceFilter, setServiceFilter] = useState<string>('all');
  const [chainFilter, setChainFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [merchantsById, setMerchantsById] = useState<Record<string, Merchant>>({});
  const [ordersLookupByKey, setOrdersLookupByKey] = useState<Record<string, Order>>({});

  // Selected Ticket Details & Order
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
  const [relatedOrder, setRelatedOrder] = useState<Order | null>(null);
  const [loadingOrder, setLoadingOrder] = useState(false);

  // Split Delivery Child Orders live tracking
  const [splitChildOrders, setSplitChildOrders] = useState<Order[]>([]);
  const [loadingChildOrder, setLoadingChildOrder] = useState(false);
  const [cancellingChildId, setCancellingChildId] = useState<string | null>(null);

  // Split Delivery Modal
  const [splitModalOpen, setSplitModalOpen] = useState(false);
  const [ridersNeeded, setRidersNeeded] = useState<number>(2);
  const [itemAssignments, setItemAssignments] = useState<Record<number, number>>({});
  const [splitRiderFee, setSplitRiderFee] = useState<number>(45);
  const [splittingDelivery, setSplittingDelivery] = useState(false);

  // Chat thread
  const [messages, setMessages] = useState<SupportTicketMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [attachedImageData, setAttachedImageData] = useState<string | null>(null);
  const [compressingImage, setCompressingImage] = useState(false);
  const [sendingReply, setSendingReply] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Modals & Panels
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [resolveModalOpen, setResolveModalOpen] = useState(false);
  const [resolutionNote, setResolutionNote] = useState('');
  const [resolving, setResolving] = useState(false);
  const [accepting, setAccepting] = useState(false);

  // Cancel / Refund Modal for Order
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelReasonPicker, setCancelReasonPicker] = useState('Customer request via Support');
  const [cancelNote, setCancelNote] = useState('');
  const [cancelFault, setCancelFault] = useState<'customer' | 'merchant' | 'rider' | 'platform'>('platform');
  const [refundToWallet, setRefundToWallet] = useState(true);
  const [cancellingOrder, setCancellingOrder] = useState(false);

  // Standalone Refund Modal
  const [refundModalOpen, setRefundModalOpen] = useState(false);
  const [refundAmount, setRefundAmount] = useState<number>(0);
  const [refundReason, setRefundReason] = useState('');
  const [processingRefund, setProcessingRefund] = useState(false);

  // 1. Listen to supportTickets (limit 200, sorted in code)
  useEffect(() => {
    setLoading(true);
    const qTickets = query(collection(db, 'supportTickets'), limit(200));
    const unsubscribe = onSnapshot(
      qTickets,
      (snapshot) => {
        const list: SupportTicket[] = [];
        snapshot.forEach((d) => {
          const dt = d.data();
          const isDriver = dt.reporterType === 'rider' || Boolean(dt.riderId && !dt.customerId);
          list.push({
            id: d.id,
            reporterType: isDriver ? 'rider' : 'customer',
            riderId: dt.riderId,
            riderName: dt.riderName || (isDriver ? 'Driver' : undefined),
            riderPhone: dt.riderPhone,
            title: dt.title || (isDriver ? `Driver Report #${d.id.slice(0, 6)}` : `Ticket #${d.id.slice(0, 6)}`),
            reason: dt.reason || 'Other',
            reasonLabel: dt.reasonLabel,
            status: dt.status || 'open',
            customerId: dt.customerId || '',
            customerName: dt.customerName || (isDriver ? undefined : 'Customer'),
            customerEmail: dt.customerEmail,
            customerPhone: dt.customerPhone,
            orderId: dt.orderId,
            orderNumber: dt.orderNumber,
            batchId: dt.batchId,
            serviceType: dt.serviceType,
            splitItems: dt.splitItems || [],
            splitChildOrderId: dt.splitChildOrderId,
            unreadByAdmin: Boolean(dt.unreadByAdmin),
            unreadByCustomer: Boolean(dt.unreadByCustomer),
            unreadByRider: Boolean(dt.unreadByRider),
            lastMessageAt: dt.lastMessageAt || dt.createdAt,
            lastMessagePreview: dt.lastMessagePreview,
            acceptedAt: dt.acceptedAt,
            acceptedBy: dt.acceptedBy,
            resolvedAt: dt.resolvedAt,
            resolvedBy: dt.resolvedBy,
            resolution: dt.resolution,
            createdAt: dt.createdAt,
            updatedAt: dt.updatedAt
          });
        });

        // Sort in code by lastMessageAt or createdAt desc (no composite query required)
        list.sort((a, b) => {
          const tA = parseDate(a.lastMessageAt || a.createdAt)?.getTime() || 0;
          const tB = parseDate(b.lastMessageAt || b.createdAt)?.getTime() || 0;
          return tB - tA;
        });

        setTickets(list);
        setLoading(false);

        // Keep selected ticket in sync
        if (selectedTicketId) {
          const updated = list.find((t) => t.id === selectedTicketId);
          if (updated) setSelectedTicket(updated);
        }
      },
      (err) => {
        showError(err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [selectedTicketId]);

  // Load merchants & recent orders lookup for chain filtering and outlet display
  useEffect(() => {
    const loadMerchantsAndOrders = async () => {
      try {
        const [mSnap, oSnap] = await Promise.all([
          getDocs(query(collection(db, 'merchants'), limit(300))),
          getDocs(query(collection(db, 'orders'), limit(250)))
        ]);
        const mMap: Record<string, Merchant> = {};
        mSnap.forEach((d) => {
          const dt = d.data();
          mMap[d.id] = {
            id: d.id,
            name: dt.name || 'Store',
            ownerName: dt.ownerName || '',
            email: dt.email || '',
            phone: dt.phone || '',
            type: dt.type || 'food',
            status: dt.status || 'active',
            isOpen: Boolean(dt.isOpen),
            address: dt.address || '',
            lat: Number(dt.lat) || 0,
            lng: Number(dt.lng) || 0,
            commissionRate: dt.commissionRate ?? 15,
            chainId: dt.chainId,
            chainName: dt.chainName,
            isBranch: dt.isBranch,
            branchName: dt.branchName,
            branchCode: dt.branchCode
          };
        });
        setMerchantsById(mMap);

        const oMap: Record<string, Order> = {};
        oSnap.forEach((d) => {
          const ord = { id: d.id, ...d.data() } as Order;
          oMap[d.id] = ord;
          if (ord.orderNumber) oMap[ord.orderNumber] = ord;
        });
        setOrdersLookupByKey(oMap);
      } catch (err) {
        console.warn('Could not load merchants/orders lookup for support:', err);
      }
    };
    loadMerchantsAndOrders();
  }, []);

  const chainOptions = useMemo(() => getChainOptions(Object.values(merchantsById)), [merchantsById]);

  const resolveTicketOrder = (t: SupportTicket): Partial<Order> | null => {
    if (t.orderId && ordersLookupByKey[t.orderId]) return ordersLookupByKey[t.orderId];
    if (t.orderNumber && ordersLookupByKey[t.orderNumber]) return ordersLookupByKey[t.orderNumber];
    if (t.merchantId || t.merchantName || t.branchName || t.branchCode || t.chainId) {
      return {
        merchantId: t.merchantId || undefined,
        merchantName: t.merchantName || undefined,
        branchName: t.branchName,
        branchCode: t.branchCode,
        chainId: t.chainId
      };
    }
    return null;
  };

  // Audience splits
  const customerTickets = useMemo(() => tickets.filter((t) => t.reporterType !== 'rider'), [tickets]);
  const driverTickets = useMemo(() => tickets.filter((t) => t.reporterType === 'rider'), [tickets]);
  const currentAudienceTickets = supportAudience === 'rider' ? driverTickets : customerTickets;

  const openCustomerTicketsCount = useMemo(
    () => customerTickets.filter((t) => t.status === 'open').length,
    [customerTickets]
  );
  const openDriverTicketsCount = useMemo(
    () => driverTickets.filter((t) => t.status === 'open').length,
    [driverTickets]
  );

  // Auto-select first ticket in current audience if none or wrong audience selected
  useEffect(() => {
    if (currentAudienceTickets.length > 0) {
      if (!selectedTicket || selectedTicket.reporterType !== supportAudience) {
        setSelectedTicketId(currentAudienceTickets[0].id);
        setSelectedTicket(currentAudienceTickets[0]);
      }
    } else {
      setSelectedTicketId(null);
      setSelectedTicket(null);
    }
  }, [supportAudience, tickets]);

  // 2. Listen to messages for the selected ticket
  useEffect(() => {
    if (!selectedTicketId) {
      setMessages([]);
      return;
    }

    setLoadingMessages(true);
    const msgsCol = collection(db, 'supportTickets', selectedTicketId, 'messages');
    const qMsgs = query(msgsCol, limit(100));

    const unsubMsgs = onSnapshot(
      qMsgs,
      (snapshot) => {
        const mList: SupportTicketMessage[] = [];
        snapshot.forEach((d) => {
          const dt = d.data();
          mList.push({
            id: d.id,
            senderType: dt.senderType || 'customer',
            senderId: dt.senderId || '',
            senderName: dt.senderName,
            text: dt.text || '',
            imageData: dt.imageData || null,
            createdAt: dt.createdAt
          });
        });

        // Sort by createdAt asc for conversational order
        mList.sort((a, b) => {
          const tA = parseDate(a.createdAt)?.getTime() || 0;
          const tB = parseDate(b.createdAt)?.getTime() || 0;
          return tA - tB;
        });

        setMessages(mList);
        setLoadingMessages(false);
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 100);
      },
      (err) => {
        console.error('Error fetching ticket messages:', err);
        setLoadingMessages(false);
      }
    );

    // Mark as read by admin when opened
    const ticketDoc = doc(db, 'supportTickets', selectedTicketId);
    updateDoc(ticketDoc, { unreadByAdmin: false }).catch(() => {});

    return () => unsubMsgs();
  }, [selectedTicketId]);

  // 3. Fetch related order when selected ticket changes
  useEffect(() => {
    if (!selectedTicket?.orderId && !selectedTicket?.orderNumber) {
      setRelatedOrder(null);
      return;
    }

    const loadOrder = async () => {
      try {
        setLoadingOrder(true);
        if (selectedTicket.orderId) {
          const oSnap = await getDoc(doc(db, 'orders', selectedTicket.orderId));
          if (oSnap.exists()) {
            setRelatedOrder({ id: oSnap.id, ...oSnap.data() } as Order);
            setLoadingOrder(false);
            return;
          }
        }
        // Fallback by orderNumber
        if (selectedTicket.orderNumber) {
          const qOrder = query(collection(db, 'orders'), limit(1));
          const snaps = await getDocs(qOrder);
          let found: Order | null = null;
          snaps.forEach((d) => {
            const dt = d.data();
            if (dt.orderNumber === selectedTicket.orderNumber) {
              found = { id: d.id, ...dt } as Order;
            }
          });
          setRelatedOrder(found);
        }
      } catch (err) {
        console.warn('Could not load related order:', err);
      } finally {
        setLoadingOrder(false);
      }
    };

    loadOrder();
  }, [selectedTicket?.orderId, selectedTicket?.orderNumber]);

  // 4. Listen to child orders live status (if split delivery created)
  useEffect(() => {
    const parentOrderId = relatedOrder?.id || selectedTicket?.orderId;
    if (!parentOrderId) {
      setSplitChildOrders([]);
      return;
    }

    setLoadingChildOrder(true);
    // Listen to all child orders created from this parent order
    const qSplit = query(
      collection(db, 'orders'),
      where('splitOf', '==', parentOrderId)
    );

    const unsubSplit = onSnapshot(
      qSplit,
      (snap) => {
        const list: Order[] = [];
        snap.forEach((d) => {
          list.push({ id: d.id, ...d.data() } as Order);
        });
        list.sort((a, b) => (Number(a.seq) || 2) - (Number(b.seq) || 2));
        setSplitChildOrders(list);
        setLoadingChildOrder(false);
      },
      (err) => {
        console.warn('Error loading split child orders:', err);
        setLoadingChildOrder(false);
      }
    );

    return () => unsubSplit();
  }, [relatedOrder?.id, selectedTicket?.orderId, relatedOrder?.splitOut, selectedTicket?.splitChildOrderId]);

  // Reason counts per audience
  const customerReasonCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    SUPPORT_TICKET_REASONS.forEach((r) => {
      counts[r] = 0;
    });
    customerTickets.forEach((t) => {
      if (counts[t.reason] !== undefined) {
        counts[t.reason]++;
      } else {
        counts['Other'] = (counts['Other'] || 0) + 1;
      }
    });
    return counts;
  }, [customerTickets]);

  const driverReasonCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    DRIVER_SUPPORT_REASONS.forEach((r) => {
      counts[r.id] = 0;
    });
    driverTickets.forEach((t) => {
      const match = DRIVER_SUPPORT_REASONS.find(
        (r) => r.id === t.reason || r.label === t.reason || r.id === t.reasonLabel || r.label === t.reasonLabel
      );
      if (match) {
        counts[match.id]++;
      } else {
        counts['other'] = (counts['other'] || 0) + 1;
      }
    });
    return counts;
  }, [driverTickets]);

  // Filtered tickets list for active audience
  const filteredTickets = useMemo(() => {
    return currentAudienceTickets.filter((t) => {
      // Reason filter
      if (activeReasonTab !== 'all') {
        if (supportAudience === 'customer') {
          if (t.reason !== activeReasonTab) return false;
        } else {
          const match = DRIVER_SUPPORT_REASONS.find((r) => r.id === activeReasonTab);
          const matches =
            t.reason === activeReasonTab ||
            (match && t.reason === match.label) ||
            t.reasonLabel === activeReasonTab ||
            (match && t.reasonLabel === match.label);
          if (!matches) return false;
        }
      }

      // Status filter
      if (statusFilter !== 'all') {
        if (statusFilter === 'open' && t.status !== 'open') return false;
        if (statusFilter === 'in_progress' && t.status !== 'accepted' && t.status !== 'in_progress') return false;
        if (statusFilter === 'resolved' && t.status !== 'resolved') return false;
      }

      // Service filter
      if (serviceFilter !== 'all') {
        const srv = (t.serviceType || relatedOrder?.serviceType || '').toLowerCase();
        if (srv !== serviceFilter.toLowerCase()) return false;
      }

      // Chain filter
      if (chainFilter !== 'all') {
        const ord = resolveTicketOrder(t);
        const ticketChainId = ord ? resolveOrderChainId(ord, merchantsById) : null;
        if (ticketChainId !== chainFilter) return false;
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesTitle = t.title.toLowerCase().includes(q);
        const matchesReason = (t.reason || '').toLowerCase().includes(q);
        const matchesReasonLabel = (t.reasonLabel || '').toLowerCase().includes(q);
        const matchesCustomer = (t.customerName || '').toLowerCase().includes(q);
        const matchesRider = (t.riderName || '').toLowerCase().includes(q);
        const matchesEmail = (t.customerEmail || '').toLowerCase().includes(q);
        const matchesOrder = matchesOrderSearch({ orderNumber: t.orderNumber, id: t.orderId }, searchQuery);
        const matchesBatch = (t.batchId || '').toLowerCase().includes(q);
        const matchesId = t.id.toLowerCase().includes(q);
        const ord = resolveTicketOrder(t);
        const mDisplay = ord ? resolveOrderMerchantDisplay(ord, merchantsById, true).toLowerCase() : '';
        const matchesMerchant = mDisplay.includes(q);

        if (
          !matchesTitle &&
          !matchesReason &&
          !matchesReasonLabel &&
          !matchesCustomer &&
          !matchesRider &&
          !matchesEmail &&
          !matchesOrder &&
          !matchesBatch &&
          !matchesId &&
          !matchesMerchant
        ) {
          return false;
        }
      }
      return true;
    });
  }, [
    currentAudienceTickets,
    activeReasonTab,
    statusFilter,
    serviceFilter,
    chainFilter,
    searchQuery,
    supportAudience,
    relatedOrder,
    merchantsById,
    ordersLookupByKey
  ]);

  // Combined Chain Totals & Per-Outlet Breakdown for Support
  const selectedChainTicketStats = useMemo(() => {
    if (chainFilter === 'all') return null;
    const chain = chainOptions.find((c) => c.chainId === chainFilter);
    const byOutlet = new Map<string, { label: string; total: number; open: number }>();

    if (chain) {
      chain.outlets.forEach((o) => {
        byOutlet.set(o.id, {
          label: o.branchName ? `${o.branchName}${o.branchCode ? ` (${o.branchCode})` : ''}` : o.name,
          total: 0,
          open: 0
        });
      });
    }

    let totalTickets = 0;
    let openTickets = 0;

    filteredTickets.forEach((t) => {
      totalTickets += 1;
      if (t.status === 'open') openTickets += 1;
      const ord = resolveTicketOrder(t);
      const mId = ord?.merchantId || 'unknown';
      if (!byOutlet.has(mId)) {
        byOutlet.set(mId, {
          label: ord ? resolveOrderMerchantDisplay(ord, merchantsById, true) : mId,
          total: 0,
          open: 0
        });
      }
      const entry = byOutlet.get(mId)!;
      entry.total += 1;
      if (t.status === 'open') entry.open += 1;
    });

    return {
      chainName: chain?.chainName || 'Chain',
      totalTickets,
      openTickets,
      outlets: Array.from(byOutlet.values())
    };
  }, [chainFilter, chainOptions, filteredTickets, merchantsById, ordersLookupByKey]);

  // Helper to get friendly reason label
  const getTicketReasonDisplay = (ticket: SupportTicket) => {
    if (ticket.reporterType === 'rider') {
      const match = DRIVER_SUPPORT_REASONS.find(
        (r) => r.id === ticket.reason || r.label === ticket.reason || r.id === ticket.reasonLabel
      );
      return match ? match.label : ticket.reasonLabel || ticket.reason;
    }
    return ticket.reason;
  };

  // Determine if Split Delivery button is available
  const canSplitDelivery = useMemo(() => {
    if (!selectedTicket) return false;
    // food and convenience only
    const srv = (selectedTicket.serviceType || relatedOrder?.serviceType || '').toLowerCase();
    if (srv !== 'food' && srv !== 'convenience') return false;
    // only on an accepted ticket
    if (selectedTicket.status !== 'accepted' && selectedTicket.status !== 'in_progress') return false;
    // tickets with reason cant_fit_bag or too_big
    const r = (selectedTicket.reason || '').toLowerCase();
    const rLabel = (selectedTicket.reasonLabel || '').toLowerCase();
    const isSplitReason =
      r === 'cant_fit_bag' ||
      r === 'too_big' ||
      r.includes('bag') ||
      r.includes('heavy') ||
      r.includes('big') ||
      rLabel.includes('bag') ||
      rLabel.includes('heavy');
    if (!isSplitReason) return false;
    // not already split
    const splitOut = relatedOrder?.splitOut as any;
    if (
      selectedTicket.splitChildOrderId ||
      (selectedTicket as any).splitChildOrderIds?.length > 0 ||
      splitOut?.children?.length > 0 ||
      splitOut?.childOrderId
    ) {
      return false;
    }
    return true;
  }, [selectedTicket, relatedOrder]);

  // Candidate items available to split
  const candidateItems = useMemo(() => {
    if (relatedOrder?.items && relatedOrder.items.length > 0) {
      return relatedOrder.items;
    }
    if (selectedTicket?.splitItems && selectedTicket.splitItems.length > 0) {
      return selectedTicket.splitItems;
    }
    return [];
  }, [relatedOrder, selectedTicket]);

  // Open Split Delivery modal and preselect items
  const handleOpenSplitModal = () => {
    if (!selectedTicket) return;

    setRidersNeeded(2);
    const initialAssignments: Record<number, number> = {};

    if (selectedTicket.splitItems && selectedTicket.splitItems.length > 0 && candidateItems.length > 0) {
      const reportedNames = selectedTicket.splitItems.map((i: any) => (i.name || '').toLowerCase().trim());
      candidateItems.forEach((item, idx) => {
        if (reportedNames.includes((item.name || '').toLowerCase().trim())) {
          initialAssignments[idx] = 2; // Hand over to Rider 2
        } else {
          initialAssignments[idx] = 1; // Keep with Rider 1 (current)
        }
      });
      // If none matched, assign the first item to Rider 2
      if (!Object.values(initialAssignments).includes(2) && candidateItems.length > 0) {
        initialAssignments[0] = 2;
      }
    } else {
      // Default: assign item 0 to Rider 2, rest to Rider 1
      candidateItems.forEach((_, idx) => {
        initialAssignments[idx] = idx === 0 ? 2 : 1;
      });
    }

    setItemAssignments(initialAssignments);

    // Default rider fee: parent riderFeeEstimate total || deliveryFee || 45
    const defaultFee =
      relatedOrder?.riderFeeEstimate?.total ||
      relatedOrder?.fees?.deliveryFee ||
      45;
    setSplitRiderFee(Number(defaultFee) > 0 ? Number(defaultFee) : 45);
    setSplitModalOpen(true);
  };

  // Confirm and Execute Split Delivery in ONE atomic batch
  const handleExecuteSplitDelivery = async () => {
    if (!selectedTicket || !relatedOrder) {
      showError('Unable to split delivery: Order details not found.');
      return;
    }

    if (candidateItems.length === 0) {
      showError('No items available on order to split.');
      return;
    }

    // Verify that every extra rider (from 2 up to ridersNeeded) has at least 1 item assigned
    for (let seq = 2; seq <= ridersNeeded; seq++) {
      const extraItems = candidateItems.filter((_, idx) => (itemAssignments[idx] ?? 1) === seq);
      if (extraItems.length === 0) {
        showError(`Please assign at least one item to Rider ${seq}.`);
        return;
      }
    }

    try {
      setSplittingDelivery(true);
      const now = Timestamp.now();
      const adminName = adminProfile?.name || 'Delivio Support';
      const adminId = adminProfile?.uid || 'admin';
      const parentNum = relatedOrder.orderNumber || selectedTicket.orderNumber || relatedOrder.id.slice(0, 6);

      const batch = writeBatch(db);
      const childSummaryList: any[] = [];
      const childOrderIds: string[] = [];

      // 1. Create N - 1 child orders (seq 2 to ridersNeeded)
      for (let seq = 2; seq <= ridersNeeded; seq++) {
        const assignedItems = candidateItems.filter((_, idx) => (itemAssignments[idx] ?? 1) === seq);
        const childOrderRef = doc(collection(db, 'orders'));
        const childOrderId = childOrderRef.id;
        const childOrderNum = `${parentNum}-R${seq}`;

        const childOrderData = {
          orderNumber: childOrderNum,
          merchantName: relatedOrder.merchantName || '',
          branchName: relatedOrder.branchName || null,
          branchCode: relatedOrder.branchCode || null,
          chainId: relatedOrder.chainId || null,
          customerName: relatedOrder.customerName || selectedTicket.customerName || 'Customer',
          customerPhone: relatedOrder.customerPhone || selectedTicket.customerPhone || '',
          cityId: relatedOrder.cityId || selectedCityId || '',
          serviceType: relatedOrder.serviceType || selectedTicket.serviceType || 'food',
          pickup: relatedOrder.pickup || (relatedOrder.merchantAddress ? { address: relatedOrder.merchantAddress } : null),
          dropoff: relatedOrder.dropoff || null,
          fulfillment: 'delivery',
          fulfillmentType: 'delivery',
          items: assignedItems,
          status: relatedOrder.status || 'Merchant accepted',
          statusHistory: [
            {
              status: relatedOrder.status || 'Merchant accepted',
              at: now,
              note: `Split child order for Rider ${seq} of ${ridersNeeded} created from #${parentNum} by Support (${adminName})`
            }
          ],
          customerId: null,
          merchantId: null,
          sourceCustomerId: relatedOrder.customerId || selectedTicket.customerId || null,
          sourceMerchantId: relatedOrder.merchantId || null,
          riderId: null,
          riderName: null,
          riderPhone: null,
          isSplitChild: true,
          seq: seq,
          splitOf: relatedOrder.id,
          excludeRiderIds: relatedOrder.riderId
            ? [relatedOrder.riderId]
            : selectedTicket.riderId
            ? [selectedTicket.riderId]
            : [],
          deliveryOption: 'priority',
          dispatch: {
            option: 'priority',
            holdMinutes: 0,
            maxBatch: 1,
            poolable: false,
            searchRadiusKm: relatedOrder.searchRadiusKm || 5
          },
          fees: {
            subtotal: 0,
            deliveryFee: Number(relatedOrder.fees?.deliveryFee || 0),
            serviceFee: 0,
            discount: 0,
            total: 0
          },
          paymentMethod: 'split',
          paymentStatus: 'paid',
          noCash: true,
          cashToCollect: 0,
          riderFeeFixed: Number(splitRiderFee) || 45,
          createdAt: now,
          updatedAt: now
        };

        batch.set(childOrderRef, childOrderData);
        childSummaryList.push({
          orderId: childOrderId,
          items: assignedItems,
          seq: seq
        });
        childOrderIds.push(childOrderId);
      }

      // 2. Update parent order with splitOut
      const parentOrderRef = doc(db, 'orders', relatedOrder.id);
      batch.update(parentOrderRef, {
        splitOut: {
          count: ridersNeeded,
          children: childSummaryList,
          at: now,
          by: adminName
        },
        updatedAt: now
      });

      // 3. Add system message in ticket conversation thread
      const sysMsgRef = doc(collection(db, 'supportTickets', selectedTicket.id, 'messages'));
      batch.set(sysMsgRef, {
        senderType: 'system',
        senderId: 'system',
        senderName: 'System',
        text: `${ridersNeeded - 1} extra rider(s) dispatched for split delivery (${ridersNeeded} riders total).`,
        createdAt: now
      });

      // 4. Create inbox notice for customer stating how many riders are delivering
      const customerTargetId = relatedOrder.customerId || selectedTicket.customerId;
      if (customerTargetId) {
        const inboxRef = doc(collection(db, 'inbox'));
        batch.set(inboxRef, {
          customerId: customerTargetId,
          category: 'order',
          title: `${ridersNeeded} riders are delivering your order`,
          body: `Due to the size of your order #${parentNum}, ${ridersNeeded} riders are delivering your items safely and promptly. Only the first rider collects cash. Other riders show No Cash Collected.`,
          imageUrl: null,
          link: null,
          createdAt: now,
          createdBy: adminId,
          createdByName: adminName
        });
      }

      // 5. Link child orders on supportTickets/{id}
      const ticketRef = doc(db, 'supportTickets', selectedTicket.id);
      batch.update(ticketRef, {
        splitChildOrderIds: childOrderIds,
        splitChildOrderId: childOrderIds[0],
        lastMessageAt: now,
        lastMessagePreview: `Split delivery: ${ridersNeeded} riders dispatched`,
        updatedAt: now
      });

      await batch.commit();

      setSplitModalOpen(false);
      showSuccess(`Split delivery initiated! ${ridersNeeded - 1} child order(s) dispatched for extra riders.`);
    } catch (err: any) {
      showError(err);
    } finally {
      setSplittingDelivery(false);
    }
  };

  // Cancel Single Child Order (allowed before a rider accepts)
  const handleCancelSingleSplitChild = async (childOrder: Order) => {
    if (!childOrder || !selectedTicket) return;
    if (childOrder.riderId) {
      showError('Cannot cancel split delivery: A driver has already accepted this order.');
      return;
    }

    try {
      setCancellingChildId(childOrder.id);
      const now = Timestamp.now();
      const adminName = adminProfile?.name || 'Delivio Support';
      const batch = writeBatch(db);

      // 1. Cancel this child order
      const childRef = doc(db, 'orders', childOrder.id);
      batch.update(childRef, {
        status: 'Cancelled',
        cancelReason: 'Split delivery cancelled by admin',
        cancelledBy: 'admin',
        updatedAt: now
      });

      // 2. Update parent order splitOut children list
      if (relatedOrder?.id) {
        const parentRef = doc(db, 'orders', relatedOrder.id);
        const existingSplit = relatedOrder.splitOut as any;
        if (existingSplit && Array.isArray(existingSplit.children)) {
          const remaining = existingSplit.children.filter((c: any) => c.orderId !== childOrder.id);
          if (remaining.length === 0) {
            batch.update(parentRef, {
              splitOut: null,
              updatedAt: now
            });
          } else {
            batch.update(parentRef, {
              splitOut: {
                ...existingSplit,
                count: remaining.length + 1,
                children: remaining,
                updatedAt: now
              },
              updatedAt: now
            });
          }
        }
      }

      // 3. Post system chat message
      const sysMsgRef = doc(collection(db, 'supportTickets', selectedTicket.id, 'messages'));
      batch.set(sysMsgRef, {
        senderType: 'system',
        senderId: 'system',
        senderName: 'System',
        text: `Split delivery child order for Rider ${childOrder.seq || 2} (#${childOrder.orderNumber || childOrder.id.slice(0, 6)}) was cancelled by ${adminName}.`,
        createdAt: now
      });

      await batch.commit();
      showSuccess(`Split delivery for Rider ${childOrder.seq || 2} cancelled.`);
    } catch (err: any) {
      showError(err);
    } finally {
      setCancellingChildId(null);
    }
  };

  // Accept Ticket
  const handleAcceptTicket = async () => {
    if (!selectedTicket) return;
    try {
      setAccepting(true);
      const ticketRef = doc(db, 'supportTickets', selectedTicket.id);
      const adminName = adminProfile?.name || 'Delivio Support';
      const now = Timestamp.now();

      await updateDoc(ticketRef, {
        status: 'accepted',
        acceptedAt: now,
        acceptedBy: adminName,
        updatedAt: now
      });

      // Add a system announcement message in thread
      const msgsCol = collection(db, 'supportTickets', selectedTicket.id, 'messages');
      await addDoc(msgsCol, {
        senderType: 'system',
        senderId: adminProfile?.uid || 'admin',
        senderName: 'System',
        text: `Ticket accepted by ${adminName}. Support specialist has joined the conversation.`,
        createdAt: now
      });

      setSelectedTicket((prev) =>
        prev ? { ...prev, status: 'accepted', acceptedAt: now, acceptedBy: adminName } : null
      );
      showSuccess(`Ticket accepted by ${adminName}. Chat is now unlocked.`);
    } catch (err: any) {
      showError(err);
    } finally {
      setAccepting(false);
    }
  };

  // Image Upload & Compression (< 300 KB)
  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setCompressingImage(true);
      const compressedDataUri = await compressImageToDataUri(file);
      setAttachedImageData(compressedDataUri);
      showSuccess('Photo attached (compressed to <300 KB).');
    } catch (err: any) {
      showError(err.message || 'Failed to process photo.');
    } finally {
      setCompressingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Send Reply
  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicket) return;
    const trimmed = replyText.trim();
    if (!trimmed && !attachedImageData) return;

    try {
      setSendingReply(true);
      const msgsCol = collection(db, 'supportTickets', selectedTicket.id, 'messages');
      const now = Timestamp.now();
      const adminName = adminProfile?.name || 'Delivio Admin';
      const adminId = adminProfile?.uid || 'admin';

      await addDoc(msgsCol, {
        senderType: 'admin',
        senderId: adminId,
        senderName: adminName,
        text: trimmed,
        imageData: attachedImageData || null,
        createdAt: now
      });

      // Update ticket
      const ticketRef = doc(db, 'supportTickets', selectedTicket.id);
      const previewText = trimmed || (attachedImageData ? '📷 Photo attachment' : '');
      const isDriverTicket = selectedTicket.reporterType === 'rider';

      await updateDoc(ticketRef, {
        lastMessageAt: now,
        lastMessagePreview: previewText,
        unreadByAdmin: false,
        unreadByCustomer: !isDriverTicket,
        unreadByRider: isDriverTicket,
        status: selectedTicket.status === 'open' ? 'accepted' : selectedTicket.status,
        updatedAt: now
      });

      setReplyText('');
      setAttachedImageData(null);
    } catch (err: any) {
      showError(err);
    } finally {
      setSendingReply(false);
    }
  };

  // Resolve Ticket
  const handleResolveTicket = async () => {
    if (!selectedTicket) return;
    const note = resolutionNote.trim();
    if (!note) {
      showError('Please provide a resolution note.');
      return;
    }

    try {
      setResolving(true);
      const now = Timestamp.now();
      const adminName = adminProfile?.name || 'Delivio Support';
      const adminId = adminProfile?.uid || 'admin';

      const ticketRef = doc(db, 'supportTickets', selectedTicket.id);
      await updateDoc(ticketRef, {
        status: 'resolved',
        resolvedAt: now,
        resolvedBy: adminName,
        resolution: note,
        lastMessageAt: now,
        lastMessagePreview: `Resolved: ${note}`,
        unreadByAdmin: false,
        updatedAt: now
      });

      // Add system message into ticket messages thread
      const msgsCol = collection(db, 'supportTickets', selectedTicket.id, 'messages');
      await addDoc(msgsCol, {
        senderType: 'system',
        senderId: adminId,
        senderName: 'System',
        text: `Ticket resolved by ${adminName}. Resolution Note: "${note}"`,
        createdAt: now
      });

      // Create an inbox message for customer or driver
      const inboxCol = collection(db, 'inbox');
      if (selectedTicket.reporterType === 'rider' && selectedTicket.riderId) {
        await addDoc(inboxCol, {
          riderId: selectedTicket.riderId,
          category: 'order',
          title: 'Your driver report was resolved',
          body: note,
          imageUrl: null,
          riderName: selectedTicket.riderName || 'Driver',
          createdAt: now,
          createdBy: adminId,
          createdByName: adminName
        });
      } else if (selectedTicket.customerId) {
        await addDoc(inboxCol, {
          customerId: selectedTicket.customerId,
          category: 'order',
          title: 'Your report was resolved',
          body: note,
          imageUrl: null,
          link: selectedTicket.orderId ? { merchantId: null, category: null } : null,
          customerName: selectedTicket.customerName,
          customerEmail: selectedTicket.customerEmail || null,
          createdAt: now,
          createdBy: adminId,
          createdByName: adminName
        });
      }

      setSelectedTicket((prev) =>
        prev
          ? {
              ...prev,
              status: 'resolved',
              resolvedAt: now,
              resolvedBy: adminName,
              resolution: note
            }
          : null
      );
      setResolveModalOpen(false);
      setResolutionNote('');
      showSuccess('Ticket marked as resolved and notification dispatched.');
    } catch (err: any) {
      showError(err);
    } finally {
      setResolving(false);
    }
  };

  // Cancel Order from Support
  const handleExecuteCancelOrder = async () => {
    if (!relatedOrder) return;
    try {
      setCancellingOrder(true);
      const fullReason = cancelNote.trim()
        ? `${cancelReasonPicker}: ${cancelNote.trim()}`
        : cancelReasonPicker;

      const willRefund =
        refundToWallet &&
        (relatedOrder.paymentMethod || relatedOrder.payment?.method || '').toLowerCase() === 'wallet' &&
        !relatedOrder.walletRefunded;

      const orderRef = doc(db, 'orders', relatedOrder.id);
      const customerId = relatedOrder.customerId;
      const userRef = doc(db, 'users', customerId);
      const now = Timestamp.now();
      const adminName = adminProfile?.name || 'Delivio Support';

      await runTransaction(db, async (transaction) => {
        const orderSnap = await transaction.get(orderRef);
        if (!orderSnap.exists()) throw new Error('Order not found.');
        const orderData = orderSnap.data();

        if (willRefund) {
          const userSnap = await transaction.get(userRef);
          const currentBal = userSnap.exists() ? userSnap.data().walletBalance || 0 : 0;
          const refundAmt = Number(orderData.fees?.total || relatedOrder.fees?.total || 0);
          const newBal = currentBal + refundAmt;

          transaction.update(orderRef, {
            status: 'Cancelled',
            cancelReason: fullReason,
            cancelFault,
            cancelledBy: 'admin',
            walletRefunded: true,
            paymentStatus: 'Refunded',
            statusHistory: arrayUnion({
              status: 'Cancelled',
              at: now,
              note: `Cancelled by Support (${adminName}): ${fullReason}. Refunded ₱${refundAmt.toFixed(2)} to customer wallet.`
            }),
            updatedAt: now
          });

          if (userSnap.exists()) {
            transaction.update(userRef, {
              walletBalance: increment(refundAmt),
              updatedAt: now
            });
          } else {
            transaction.set(userRef, { walletBalance: refundAmt, updatedAt: now }, { merge: true });
          }

          const txnRef = doc(collection(db, 'walletTransactions'));
          transaction.set(txnRef, {
            customerId,
            orderId: relatedOrder.id,
            orderNumber: orderData.orderNumber || relatedOrder.orderNumber,
            type: 'refund',
            amount: refundAmt,
            note: `Refund for cancelled order #${orderData.orderNumber || relatedOrder.orderNumber}`,
            reason: fullReason,
            adminId: adminProfile?.uid || 'admin',
            adminName,
            balanceAfter: newBal,
            createdAt: now
          });
        } else {
          transaction.update(orderRef, {
            status: 'Cancelled',
            cancelReason: fullReason,
            cancelFault,
            cancelledBy: 'admin',
            statusHistory: arrayUnion({
              status: 'Cancelled',
              at: now,
              note: `Cancelled by Support (${adminName}): ${fullReason} (Fault: ${cancelFault})`
            }),
            updatedAt: now
          });
        }
      });

      // Post notice into ticket thread
      if (selectedTicket) {
        const msgsCol = collection(db, 'supportTickets', selectedTicket.id, 'messages');
        await addDoc(msgsCol, {
          senderType: 'system',
          senderId: adminProfile?.uid || 'admin',
          senderName: 'System',
          text: `Order #${relatedOrder.orderNumber} was CANCELLED by Support.${
            willRefund ? ` ₱${Number(relatedOrder.fees?.total || 0).toFixed(2)} refunded to customer wallet.` : ''
          }`,
          createdAt: now
        });
      }

      setRelatedOrder((prev) => (prev ? { ...prev, status: 'Cancelled', cancelReason: fullReason } : null));
      setCancelModalOpen(false);
      showSuccess(`Order #${relatedOrder.orderNumber} cancelled successfully.`);
    } catch (err: any) {
      showError(err);
    } finally {
      setCancellingOrder(false);
    }
  };

  // Issue Direct Customer Wallet Refund from Support
  const handleExecuteWalletRefund = async () => {
    if (!relatedOrder && !selectedTicket) return;
    const cid = selectedTicket?.customerId || relatedOrder?.customerId;
    if (!cid || refundAmount <= 0) {
      showError('Please enter a valid refund amount.');
      return;
    }

    try {
      setProcessingRefund(true);
      const now = Timestamp.now();
      const adminName = adminProfile?.name || 'Delivio Support';
      const adminId = adminProfile?.uid || 'admin';
      const userRef = doc(db, 'users', cid);
      let balanceAfter = 0;

      await runTransaction(db, async (t) => {
        const uSnap = await t.get(userRef);
        const currentBal = uSnap.exists() ? Number(uSnap.data().walletBalance || 0) : 0;
        balanceAfter = currentBal + refundAmount;

        if (uSnap.exists()) {
          t.update(userRef, {
            walletBalance: increment(refundAmount),
            updatedAt: now
          });
        } else {
          t.set(userRef, { walletBalance: refundAmount, updatedAt: now }, { merge: true });
        }

        const txnRef = doc(collection(db, 'walletTransactions'));
        t.set(txnRef, {
          customerId: cid,
          orderId: relatedOrder?.id || selectedTicket?.orderId,
          orderNumber: relatedOrder?.orderNumber || selectedTicket?.orderNumber,
          type: 'refund',
          amount: refundAmount,
          note: `Support Wallet Refund: ${refundReason.trim() || 'Dispute settlement'}`,
          adminId,
          adminName,
          balanceAfter,
          createdAt: now
        });
      });

      // Post update into ticket chat
      if (selectedTicket) {
        const msgsCol = collection(db, 'supportTickets', selectedTicket.id, 'messages');
        await addDoc(msgsCol, {
          senderType: 'system',
          senderId: adminId,
          senderName: 'System',
          text: `₱${refundAmount.toFixed(2)} refunded to customer's Delivio Wallet. Note: ${refundReason.trim() || 'Dispute credit'}`,
          createdAt: now
        });

        const inboxCol = collection(db, 'inbox');
        await addDoc(inboxCol, {
          customerId: cid,
          category: 'wallet',
          title: 'Wallet updated',
          body: `₱${refundAmount.toFixed(2)} was added to your Delivio Wallet (${refundReason.trim() || 'Support refund'})`,
          imageUrl: null,
          createdAt: now,
          createdBy: adminId,
          createdByName: adminName
        });
      }

      setRefundModalOpen(false);
      setRefundAmount(0);
      setRefundReason('');
      showSuccess(`Refund of ₱${refundAmount.toFixed(2)} credited to customer wallet.`);
    } catch (err: any) {
      showError(err);
    } finally {
      setProcessingRefund(false);
    }
  };

  // Demo Ticket Generator (helps immediately test driver reports & split delivery)
  const handleCreateDemoTicket = async () => {
    try {
      const now = Timestamp.now();
      const sampleOrderNum = `DLV-${Math.floor(100000 + Math.random() * 900000)}`;

      if (supportAudience === 'rider') {
        // Create demo Driver report for bulky food items
        const sampleDriverId = 'rider_sample_456';
        const sampleRiderName = 'Angelo Bautista (Motorcycle)';
        const sampleBatchId = `B-${Math.floor(1000 + Math.random() * 9000)}`;

        // Also create a sample parent order so split delivery works immediately!
        const orderRef = doc(collection(db, 'orders'));
        await addDoc(collection(db, 'orders'), {
          orderNumber: sampleOrderNum,
          serviceType: 'food',
          fulfillmentType: 'delivery',
          status: 'Ready',
          statusHistory: [{ status: 'Ready', at: now, note: 'Order ready for dispatch' }],
          customerId: 'demo_customer_123',
          customerName: 'Maria Santos',
          customerPhone: '+63 917 555 4321',
          merchantId: 'merchant_sample_88',
          merchantName: 'Shakey’s Pizza Parlor',
          merchantAddress: 'Session Road, Baguio City',
          riderId: sampleDriverId,
          riderName: sampleRiderName,
          riderPhone: '+63 918 888 1234',
          cityId: selectedCityId || 'baguio',
          deliveryOption: 'standard',
          fees: {
            subtotal: 1450,
            deliveryFee: 65,
            serviceFee: 15,
            discount: 0,
            total: 1530
          },
          riderFeeEstimate: {
            pickupFee: 15,
            bookingFee: 45,
            total: 60
          },
          items: [
            { id: '1', name: 'Grand Slam Party Pizza 28" Giant', qty: 2, price: 620 },
            { id: '2', name: 'Crispy Fried Chicken Box (12 pcs)', qty: 1, price: 540 },
            { id: '3', name: '2L Soda Bottled Drinks (Pack of 3)', qty: 1, price: 290 }
          ],
          paymentMethod: 'wallet',
          paymentStatus: 'paid',
          createdAt: now,
          updatedAt: now
        });

        const newTicketDoc = await addDoc(collection(db, 'supportTickets'), {
          reporterType: 'rider',
          riderId: sampleDriverId,
          riderName: sampleRiderName,
          riderPhone: '+63 918 888 1234',
          orderNumber: sampleOrderNum,
          batchId: sampleBatchId,
          serviceType: 'food',
          reason: 'cant_fit_bag',
          reasonLabel: "Can't fit on my bag",
          title: `Can't fit on my bag - Order #${sampleOrderNum}`,
          status: 'open',
          splitItems: [
            { name: 'Grand Slam Party Pizza 28" Giant', qty: 2, price: 620 }
          ],
          unreadByAdmin: true,
          unreadByRider: false,
          lastMessageAt: now,
          lastMessagePreview: "The two 28-inch pizza boxes can't fit into my insulated delivery box. Requesting a split dispatch.",
          createdAt: now,
          updatedAt: now
        });

        // Add driver opening message
        const msgsCol = collection(db, 'supportTickets', newTicketDoc.id, 'messages');
        await addDoc(msgsCol, {
          senderType: 'rider',
          senderId: sampleDriverId,
          senderName: sampleRiderName,
          text: `Good day Delivio Ops! I am at Shakey's to pick up Order #${sampleOrderNum} (Batch #${sampleBatchId}). The merchant prepared two 28" giant pizza boxes that cannot fit into my delivery bag along with the chicken box. Can we please split this delivery with another rider?`,
          imageData: null,
          createdAt: now
        });

        setSelectedTicketId(newTicketDoc.id);
        showSuccess(`Sample Driver report created (Can't fit on bag).`);
      } else {
        // Customer sample ticket
        const reasons = SUPPORT_TICKET_REASONS;
        const randomReason = reasons[Math.floor(Math.random() * reasons.length)];

        const newTicketDoc = await addDoc(collection(db, 'supportTickets'), {
          reporterType: 'customer',
          title: `${randomReason} - #${sampleOrderNum}`,
          reason: randomReason,
          status: 'open',
          customerId: adminProfile?.uid || 'demo_customer_123',
          customerName: 'Juan Dela Cruz',
          customerEmail: 'juan.delacruz@example.com',
          customerPhone: '+63 917 123 4567',
          orderNumber: sampleOrderNum,
          serviceType: 'food',
          unreadByAdmin: true,
          unreadByCustomer: false,
          lastMessageAt: now,
          lastMessagePreview: `Hi Delivio, I am reporting an issue: ${randomReason}. Please assist.`,
          createdAt: now,
          updatedAt: now
        });

        const msgsCol = collection(db, 'supportTickets', newTicketDoc.id, 'messages');
        await addDoc(msgsCol, {
          senderType: 'customer',
          senderId: 'demo_customer_123',
          senderName: 'Juan Dela Cruz',
          text: `Hi Delivio Support! I ordered earlier today (Order #${sampleOrderNum}), but I have a concern regarding: ${randomReason}. Could you please check?`,
          imageData: null,
          createdAt: now
        });

        setSelectedTicketId(newTicketDoc.id);
        showSuccess(`Sample Customer ticket created (${randomReason}).`);
      }
    } catch (err: any) {
      showError(err);
    }
  };

  return (
    <div className="space-y-4">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-amber-400 flex items-center justify-center text-black shadow-md shadow-amber-400/20">
              <Headphones className="w-5 h-5" />
            </div>
            <span>Support Inbox</span>
          </h1>
          <p className="text-xs text-gray-500 dark:text-zinc-400 mt-1">
            Resolve customer disputes and driver reports, coordinate live chats, split bulky deliveries, and issue refunds.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleCreateDemoTicket}
            className="delivio-btn-yellow px-3.5 py-2 text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-xs"
          >
            <Sparkles className="w-4 h-4" />
            <span>Create Sample {supportAudience === 'rider' ? 'Driver Report' : 'Customer Ticket'}</span>
          </button>
        </div>
      </div>

      {/* AUDIENCE SWITCHER: CUSTOMERS | DRIVERS */}
      <div className="flex items-center justify-between bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 p-1.5 rounded-2xl shadow-xs">
        <div className="flex items-center gap-1.5 w-full sm:w-auto">
          <button
            onClick={() => {
              setSupportAudience('customer');
              setActiveReasonTab('all');
            }}
            className={`flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs font-extrabold flex items-center justify-center gap-2 transition-all ${
              supportAudience === 'customer'
                ? 'bg-amber-400 text-black shadow-xs'
                : 'text-gray-600 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800'
            }`}
          >
            <User className="w-4 h-4" />
            <span>Customers</span>
            <span
              className={`px-1.5 py-0.5 rounded-full text-[10px] font-black ${
                openCustomerTicketsCount > 0
                  ? 'bg-red-500 text-white'
                  : supportAudience === 'customer'
                  ? 'bg-black/15 text-black'
                  : 'bg-gray-200 dark:bg-zinc-700 text-gray-600 dark:text-zinc-300'
              }`}
            >
              {customerTickets.length}
            </span>
          </button>

          <button
            onClick={() => {
              setSupportAudience('rider');
              setActiveReasonTab('all');
            }}
            className={`flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs font-extrabold flex items-center justify-center gap-2 transition-all ${
              supportAudience === 'rider'
                ? 'bg-amber-400 text-black shadow-xs'
                : 'text-gray-600 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800'
            }`}
          >
            <Car className="w-4 h-4" />
            <span>Drivers</span>
            <span
              className={`px-1.5 py-0.5 rounded-full text-[10px] font-black ${
                openDriverTicketsCount > 0
                  ? 'bg-red-500 text-white'
                  : supportAudience === 'rider'
                  ? 'bg-black/15 text-black'
                  : 'bg-gray-200 dark:bg-zinc-700 text-gray-600 dark:text-zinc-300'
              }`}
            >
              {driverTickets.length}
            </span>
          </button>
        </div>

        <div className="hidden sm:flex items-center gap-3 text-xs text-gray-400 px-3">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            <strong>{openCustomerTicketsCount + openDriverTicketsCount}</strong> Open tickets requiring attention
          </span>
        </div>
      </div>

      {/* Main Console Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 min-h-[750px]">
        {/* LEFT COLUMN: TICKET LIST & FILTERS (5 cols) */}
        <div className="lg:col-span-5 flex flex-col bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl overflow-hidden shadow-xs">
          {/* Reason Tabs with Counts */}
          <div className="p-3 border-b border-gray-100 dark:border-zinc-800 bg-gray-50/50 dark:bg-zinc-850/50">
            <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">
              <span>{supportAudience === 'rider' ? 'Driver Report Reasons' : 'Customer Report Reasons'}</span>
              <span>{filteredTickets.length} matches</span>
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none text-xs">
              <button
                onClick={() => setActiveReasonTab('all')}
                className={`px-3 py-1.5 rounded-xl font-bold whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                  activeReasonTab === 'all'
                    ? 'bg-amber-400 text-black shadow-2xs'
                    : 'bg-white dark:bg-zinc-800 text-gray-600 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-zinc-700 border border-gray-200 dark:border-zinc-700'
                }`}
              >
                <span>All Reasons</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-black/10 dark:bg-white/10">
                  {currentAudienceTickets.length}
                </span>
              </button>

              {supportAudience === 'customer'
                ? SUPPORT_TICKET_REASONS.map((r) => {
                    const count = customerReasonCounts[r] || 0;
                    return (
                      <button
                        key={r}
                        onClick={() => setActiveReasonTab(r)}
                        className={`px-3 py-1.5 rounded-xl font-bold whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                          activeReasonTab === r
                            ? 'bg-amber-400 text-black shadow-2xs'
                            : 'bg-white dark:bg-zinc-800 text-gray-600 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-zinc-700 border border-gray-200 dark:border-zinc-700'
                        }`}
                      >
                        <span>{r}</span>
                        {count > 0 && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-red-500 text-white font-extrabold">
                            {count}
                          </span>
                        )}
                      </button>
                    );
                  })
                : DRIVER_SUPPORT_REASONS.map((r) => {
                    const count = driverReasonCounts[r.id] || 0;
                    return (
                      <button
                        key={r.id}
                        onClick={() => setActiveReasonTab(r.id)}
                        className={`px-3 py-1.5 rounded-xl font-bold whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                          activeReasonTab === r.id
                            ? 'bg-amber-400 text-black shadow-2xs'
                            : 'bg-white dark:bg-zinc-800 text-gray-600 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-zinc-700 border border-gray-200 dark:border-zinc-700'
                        }`}
                      >
                        <span>{r.label}</span>
                        {count > 0 && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-red-500 text-white font-extrabold">
                            {count}
                          </span>
                        )}
                      </button>
                    );
                  })}
            </div>
          </div>

          {/* Search & Secondary Dropdowns */}
          <div className="p-3 border-b border-gray-100 dark:border-zinc-800 space-y-2.5">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3.5 top-2.5 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  supportAudience === 'rider'
                    ? 'Search driver name, batch #, order #, reason...'
                    : 'Search ticket title, customer name, order #...'
                }
                className="w-full pl-9 pr-4 py-2 text-xs rounded-xl border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 text-gray-900 dark:text-white"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="px-3 py-1.5 rounded-xl border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white font-medium"
              >
                <option value="all">All Statuses</option>
                <option value="open">Open</option>
                <option value="in_progress">In Progress</option>
                <option value="resolved">Resolved</option>
              </select>

              <select
                value={serviceFilter}
                onChange={(e) => setServiceFilter(e.target.value)}
                className="px-3 py-1.5 rounded-xl border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white font-medium"
              >
                <option value="all">All Services</option>
                <option value="food">Delivio Food</option>
                <option value="convenience">Delivio Mart</option>
                <option value="parcel">Delivio Parcel</option>
                <option value="pabili">Delivio Pabili</option>
                <option value="request_rider">Delivio Instant</option>
                <option value="taxi">Delivio Taxi</option>
              </select>

              <select
                value={chainFilter}
                onChange={(e) => setChainFilter(e.target.value)}
                className="px-3 py-1.5 rounded-xl border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white font-semibold"
              >
                <option value="all">All Chains</option>
                {chainOptions.map((c) => (
                  <option key={c.chainId} value={c.chainId}>
                    {c.chainName} ({c.outlets.length})
                  </option>
                ))}
              </select>
            </div>

            {selectedChainTicketStats && (
              <div className="p-2.5 rounded-xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 space-y-1.5 text-[11px]">
                <div className="flex items-center justify-between font-bold text-amber-900 dark:text-amber-200">
                  <span className="flex items-center gap-1">
                    <Building2 className="w-3.5 h-3.5 text-amber-600" />
                    <span>{selectedChainTicketStats.chainName}</span>
                  </span>
                  <span>
                    {selectedChainTicketStats.totalTickets} tickets ({selectedChainTicketStats.openTickets} open)
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {selectedChainTicketStats.outlets.map((ob, i) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 rounded-lg bg-white dark:bg-zinc-900 border border-amber-200/70 dark:border-zinc-700 text-[10px] font-semibold text-gray-700 dark:text-zinc-300"
                    >
                      {ob.label}: <strong>{ob.total}</strong> ({ob.open} open)
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Ticket Items List */}
          <div className="flex-1 overflow-y-auto divide-y divide-gray-100 dark:divide-zinc-800/80">
            {loading ? (
              <div className="p-12 text-center text-xs text-gray-400 flex flex-col items-center justify-center gap-2">
                <Loader2 className="w-6 h-6 animate-spin text-amber-500" />
                <span>Loading {supportAudience === 'rider' ? 'driver' : 'customer'} tickets...</span>
              </div>
            ) : filteredTickets.length === 0 ? (
              <div className="p-12 text-center text-xs text-gray-400 space-y-2">
                <MessageSquare className="w-8 h-8 text-gray-300 dark:text-zinc-700 mx-auto" />
                <p className="font-bold text-gray-600 dark:text-zinc-400">
                  No {supportAudience === 'rider' ? 'driver' : 'customer'} tickets found
                </p>
                <p className="text-[11px] text-gray-400">
                  Try adjusting the reason filter, search query, or status selector.
                </p>
              </div>
            ) : (
              filteredTickets.map((ticket) => {
                const isSelected = ticket.id === selectedTicketId;
                const isUnread = Boolean(ticket.unreadByAdmin);
                const ticketDate = parseDate(ticket.lastMessageAt || ticket.createdAt);
                const isDriverReport = ticket.reporterType === 'rider';

                return (
                  <div
                    key={ticket.id}
                    onClick={() => {
                      setSelectedTicketId(ticket.id);
                      setSelectedTicket(ticket);
                    }}
                    className={`p-3.5 transition-all cursor-pointer relative flex gap-3 ${
                      isSelected
                        ? 'bg-amber-50/70 dark:bg-amber-950/20 border-l-4 border-l-amber-500'
                        : 'hover:bg-gray-50/70 dark:hover:bg-zinc-850/50'
                    }`}
                  >
                    {/* Unread indicator dot */}
                    {isUnread && (
                      <span
                        className="w-2.5 h-2.5 rounded-full bg-red-500 ring-2 ring-white dark:ring-zinc-900 shrink-0 mt-1"
                        title="Unread message by admin"
                      />
                    )}

                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-extrabold text-xs text-gray-900 dark:text-white truncate flex items-center gap-1.5">
                          {isDriverReport ? (
                            <Truck className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                          ) : (
                            <User className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                          )}
                          <span className="truncate">{ticket.title}</span>
                        </span>
                        <span className="text-[10px] font-mono text-gray-400 shrink-0">
                          {ticketDate ? formatRelativeTime(ticketDate) : ''}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span className="px-2 py-0.5 rounded-md font-bold bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300 text-[10px]">
                          {getTicketReasonDisplay(ticket)}
                        </span>

                        {ticket.status === 'open' && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-extrabold bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300">
                            Open
                          </span>
                        )}
                        {(ticket.status === 'accepted' || ticket.status === 'in_progress') && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-extrabold bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300">
                            In Progress
                          </span>
                        )}
                        {ticket.status === 'resolved' && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-extrabold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                            Resolved
                          </span>
                        )}

                        {(ticket.orderNumber || ticket.orderId) && (
                          <span className="text-gray-400 font-mono text-[10px]">
                            {formatOrderNumber({ orderNumber: ticket.orderNumber, id: ticket.orderId })}
                          </span>
                        )}

                        {ticket.batchId && (
                          <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300">
                            Batch: #{ticket.batchId}
                          </span>
                        )}

                        {ticket.splitChildOrderId && (
                          <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-500 text-black flex items-center gap-0.5">
                            <Split className="w-2.5 h-2.5" />
                            Split active
                          </span>
                        )}
                      </div>

                      <div className="text-[11px] text-gray-500 dark:text-zinc-400 flex items-center justify-between pt-0.5 gap-2">
                        <span className="truncate">
                          {isDriverReport ? (
                            <>Driver: <strong>{ticket.riderName || 'Assigned Driver'}</strong></>
                          ) : (
                            <>Customer: <strong>{ticket.customerName || 'Customer'}</strong></>
                          )}
                        </span>
                        {(() => {
                          const ord = resolveTicketOrder(ticket);
                          const mDisp = ord ? resolveOrderMerchantDisplay(ord, merchantsById, true) : '';
                          return mDisp ? (
                            <span className="text-[10px] font-bold text-amber-700 dark:text-amber-400 truncate max-w-[160px]" title={mDisp}>
                              {mDisp}
                            </span>
                          ) : null;
                        })()}
                      </div>

                      {ticket.lastMessagePreview && (
                        <p className="text-[11px] text-gray-400 dark:text-zinc-500 truncate pt-0.5">
                          {ticket.lastMessagePreview}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: ACTIVE TICKET DETAIL, CHAT & ORDER PANEL (7 cols) */}
        <div className="lg:col-span-7 flex flex-col bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl overflow-hidden shadow-xs">
          {!selectedTicket ? (
            <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-gray-400">
              <div className="w-16 h-16 rounded-3xl bg-gray-100 dark:bg-zinc-800 flex items-center justify-center mb-3">
                <Headphones className="w-8 h-8 text-gray-400" />
              </div>
              <h3 className="font-bold text-base text-gray-700 dark:text-zinc-300">
                Select a Support Ticket
              </h3>
              <p className="text-xs text-gray-400 max-w-sm mt-1">
                Choose a ticket from the left list to review customer reports or driver inquiries, chat in real-time, view order details, and coordinate solutions.
              </p>
            </div>
          ) : (
            <div className="flex-1 flex flex-col h-full">
              {/* Ticket Header & Primary Action Bar */}
              <div className="p-4 border-b border-gray-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase flex items-center gap-1 ${
                        selectedTicket.reporterType === 'rider'
                          ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300'
                          : 'bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-300'
                      }`}
                    >
                      {selectedTicket.reporterType === 'rider' ? <Car className="w-3 h-3" /> : <User className="w-3 h-3" />}
                      <span>{selectedTicket.reporterType === 'rider' ? 'Driver Report' : 'Customer Report'}</span>
                    </span>

                    <h2 className="font-extrabold text-base text-gray-900 dark:text-white truncate">
                      {selectedTicket.title}
                    </h2>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                        selectedTicket.status === 'open'
                          ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                          : selectedTicket.status === 'resolved'
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                          : 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                      }`}
                    >
                      {selectedTicket.status}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500 dark:text-zinc-400 mt-1">
                    <span>Reason: <strong className="text-gray-900 dark:text-white">{getTicketReasonDisplay(selectedTicket)}</strong></span>
                    <span>•</span>
                    {selectedTicket.reporterType === 'rider' ? (
                      <span>Driver: <strong>{selectedTicket.riderName || 'Driver'}</strong></span>
                    ) : (
                      <span>Customer: <strong>{selectedTicket.customerName || 'Customer'}</strong></span>
                    )}

                    {(selectedTicket.orderNumber || selectedTicket.orderId) && (
                      <>
                        <span>•</span>
                        <span className="font-mono text-amber-600 font-bold">
                          Order {formatOrderNumber({ orderNumber: selectedTicket.orderNumber, id: selectedTicket.orderId })}
                        </span>
                      </>
                    )}

                    {selectedTicket.batchId && (
                      <>
                        <span>•</span>
                        <span className="font-mono text-purple-600 font-bold">
                          Batch #{selectedTicket.batchId}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {/* Split Delivery Button: food and convenience only, only on accepted ticket with cant_fit_bag or too_big */}
                  {canSplitDelivery && (
                    <button
                      onClick={handleOpenSplitModal}
                      className="px-3.5 py-1.5 rounded-xl border border-amber-400 bg-amber-400 text-black hover:bg-amber-300 text-xs font-black flex items-center gap-1.5 shadow-xs transition-colors"
                      title="Split this bulky order across two riders"
                    >
                      <Split className="w-3.5 h-3.5" />
                      <span>Split Delivery</span>
                    </button>
                  )}

                  {selectedTicket.status === 'open' && (
                    <button
                      onClick={handleAcceptTicket}
                      disabled={accepting}
                      className="delivio-btn-yellow px-3.5 py-1.5 text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-xs"
                    >
                      {accepting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                      <span>Accept Ticket</span>
                    </button>
                  )}

                  {selectedTicket.status !== 'resolved' && (
                    <button
                      onClick={() => setResolveModalOpen(true)}
                      className="px-3.5 py-1.5 rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100 text-xs font-bold flex items-center gap-1.5 transition-colors"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Resolve</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Resolved Banner if ticket is resolved */}
              {selectedTicket.status === 'resolved' && (
                <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border-b border-emerald-200 dark:border-emerald-900/60 flex items-start gap-2.5 text-xs text-emerald-900 dark:text-emerald-200">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-bold">
                      Ticket Resolved by {selectedTicket.resolvedBy || 'Support'}
                    </p>
                    <p className="text-[11px] text-emerald-800/80 dark:text-emerald-300/80 mt-0.5">
                      Resolution Note: {selectedTicket.resolution || 'Resolved with reporter.'}
                    </p>
                  </div>
                </div>
              )}

              {/* Middle Section: Chat thread & Order Quick-Panel */}
              <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-[460px]">
                {/* Chat Thread (Scrollable) */}
                <div className="flex-1 flex flex-col overflow-hidden bg-gray-50/50 dark:bg-zinc-950/30">
                  <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {loadingMessages ? (
                      <div className="py-12 flex flex-col items-center justify-center gap-2 text-gray-400 text-xs">
                        <Loader2 className="w-5 h-5 animate-spin text-amber-500" />
                        <span>Loading conversation...</span>
                      </div>
                    ) : messages.length === 0 ? (
                      <div className="py-12 text-center text-xs text-gray-400">
                        No messages yet in this ticket thread.
                      </div>
                    ) : (
                      messages.map((msg) => {
                        const isAdmin = msg.senderType === 'admin';
                        const isSystem = msg.senderType === 'system';
                        const isRider = msg.senderType === 'rider';
                        const msgTime = parseDate(msg.createdAt);

                        if (isSystem) {
                          return (
                            <div key={msg.id} className="flex justify-center my-2">
                              <span className="px-3 py-1 rounded-full text-[10px] font-bold bg-gray-200/80 dark:bg-zinc-800 text-gray-700 dark:text-zinc-300 flex items-center gap-1.5 shadow-2xs">
                                <Info className="w-3.5 h-3.5 text-amber-500" />
                                {msg.text}
                              </span>
                            </div>
                          );
                        }

                        return (
                          <div
                            key={msg.id}
                            className={`flex flex-col ${isAdmin ? 'items-end' : 'items-start'}`}
                          >
                            <span className="text-[10px] text-gray-400 mb-0.5 px-1 font-semibold flex items-center gap-1">
                              {isAdmin ? (
                                'Delivio Support'
                              ) : isRider ? (
                                <>
                                  <span className="px-1.5 py-0.2 rounded font-extrabold bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300">
                                    Driver
                                  </span>
                                  <span>{msg.senderName || selectedTicket.riderName || 'Driver'}</span>
                                </>
                              ) : (
                                msg.senderName || selectedTicket.customerName || 'Customer'
                              )}
                              {msgTime && ` • ${formatRelativeTime(msgTime)}`}
                            </span>

                            <div
                              className={`max-w-[85%] rounded-2xl p-3 text-xs shadow-2xs space-y-2 ${
                                isAdmin
                                  ? 'bg-amber-400 text-black rounded-tr-xs'
                                  : 'bg-white dark:bg-zinc-800 text-gray-900 dark:text-white border border-gray-200 dark:border-zinc-700/80 rounded-tl-xs'
                              }`}
                            >
                              {msg.text && (
                                <p className="leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                              )}

                              {/* Photo attachment (Base64 data URI) */}
                              {msg.imageData && (
                                <div className="rounded-xl overflow-hidden border border-black/10 dark:border-white/10 relative group">
                                  <img
                                    src={msg.imageData}
                                    alt="Ticket attachment"
                                    className="max-h-60 w-auto rounded-lg object-contain bg-black/5 cursor-pointer hover:opacity-90 transition-opacity"
                                    onClick={() => setLightboxImage(msg.imageData || null)}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => setLightboxImage(msg.imageData || null)}
                                    className="absolute bottom-2 right-2 p-1.5 rounded-lg bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                                    title="Click to enlarge"
                                  >
                                    <Maximize2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                    <div ref={messagesEndRef} />
                  </div>

                  {/* Reply Input Area */}
                  <div className="p-3 border-t border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
                    {selectedTicket.status === 'open' ? (
                      <div className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 flex items-center justify-between gap-3 text-xs">
                        <div className="flex items-center gap-2 text-amber-900 dark:text-amber-200">
                          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                          <span>
                            Accept this ticket to reply and coordinate with the{' '}
                            {selectedTicket.reporterType === 'rider' ? 'driver' : 'customer'}.
                          </span>
                        </div>
                        <button
                          onClick={handleAcceptTicket}
                          disabled={accepting}
                          className="delivio-btn-yellow px-3.5 py-1.5 text-xs font-bold rounded-xl shrink-0"
                        >
                          {accepting ? 'Accepting...' : 'Accept Ticket'}
                        </button>
                      </div>
                    ) : selectedTicket.status === 'resolved' ? (
                      <div className="p-3 rounded-2xl bg-gray-50 dark:bg-zinc-800/40 text-center text-xs text-gray-400">
                        This ticket is marked as resolved and closed. Chat is read-only.
                      </div>
                    ) : (
                      <form onSubmit={handleSendReply} className="space-y-2">
                        {/* Canned Replies Toolbar */}
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-[10px] font-bold uppercase text-gray-400 shrink-0">
                            Canned Replies:
                          </span>
                          <select
                            onChange={(e) => {
                              if (e.target.value) {
                                setReplyText((prev) => (prev ? `${prev}\n${e.target.value}` : e.target.value));
                                e.target.value = '';
                              }
                            }}
                            className="px-2.5 py-1 text-xs rounded-xl border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 text-gray-700 dark:text-zinc-300 flex-1 truncate"
                          >
                            <option value="">
                              Select a quick response for {selectedTicket.reporterType === 'rider' ? 'driver' : 'customer'}...
                            </option>
                            {(selectedTicket.reporterType === 'rider'
                              ? DRIVER_CANNED_REPLIES
                              : SUPPORT_CANNED_REPLIES
                            ).map((cr, idx) => (
                              <option key={idx} value={cr}>
                                {cr}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Image Preview */}
                        {attachedImageData && (
                          <div className="relative inline-block border border-amber-300 dark:border-amber-700 rounded-xl overflow-hidden p-1 bg-amber-50/50">
                            <img
                              src={attachedImageData}
                              alt="To send"
                              className="h-16 w-16 object-cover rounded-lg"
                            />
                            <button
                              type="button"
                              onClick={() => setAttachedImageData(null)}
                              className="absolute top-1 right-1 p-0.5 rounded-full bg-black/70 text-white hover:bg-black"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        )}

                        {/* Text and Actions */}
                        <div className="flex items-end gap-2">
                          <input
                            type="file"
                            ref={fileInputRef}
                            accept="image/*"
                            onChange={handlePhotoSelect}
                            className="hidden"
                          />
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={compressingImage || sendingReply}
                            className="p-2.5 rounded-xl border border-gray-200 dark:border-zinc-700 text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
                            title="Attach Photo (auto-compressed to <300 KB)"
                          >
                            {compressingImage ? (
                              <Loader2 className="w-4 h-4 animate-spin text-amber-500" />
                            ) : (
                              <Camera className="w-4 h-4" />
                            )}
                          </button>

                          <textarea
                            value={replyText}
                            onChange={(e) => setReplyText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSendReply(e);
                              }
                            }}
                            placeholder={`Reply to ${selectedTicket.reporterType === 'rider' ? 'driver' : 'customer'}...`}
                            rows={2}
                            className="flex-1 px-3.5 py-2 text-xs rounded-xl border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 text-gray-900 dark:text-white resize-none"
                          />

                          <button
                            type="submit"
                            disabled={sendingReply || (!replyText.trim() && !attachedImageData)}
                            className="delivio-btn-yellow p-2.5 rounded-xl text-black font-bold flex items-center justify-center disabled:opacity-40"
                            title="Send reply"
                          >
                            {sendingReply ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Send className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                </div>

                {/* ORDER & DRIVER REPORT PANEL (Right sub-pane) */}
                <div className="w-full md:w-84 border-t md:border-t-0 md:border-l border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-y-auto p-4 space-y-4 text-xs">
                  <div className="flex items-center justify-between pb-2 border-b border-gray-100 dark:border-zinc-800">
                    <span className="font-extrabold uppercase text-[11px] text-gray-500 tracking-wider flex items-center gap-1.5">
                      <ShoppingBag className="w-3.5 h-3.5 text-amber-500" />
                      Order & Dispatch Panel
                    </span>
                    {relatedOrder && (
                      <button
                        onClick={() => navigate(`/orders?search=${encodeURIComponent(relatedOrder.orderNumber || relatedOrder.id)}`)}
                        className="text-[11px] font-bold text-amber-600 hover:text-amber-700 dark:text-amber-400 flex items-center gap-1"
                      >
                        <span>Open in Orders</span>
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    )}
                  </div>

                  {/* Bulky / Uncarryable Items Alert (Driver flagged) */}
                  {selectedTicket.splitItems && selectedTicket.splitItems.length > 0 && (
                    <div className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 space-y-2">
                      <div className="flex items-center gap-2 text-amber-900 dark:text-amber-200 font-extrabold text-xs">
                        <PackageX className="w-4 h-4 text-amber-600 shrink-0" />
                        <span>Items Driver Cannot Carry:</span>
                      </div>
                      <div className="space-y-1">
                        {selectedTicket.splitItems.map((item: any, idx: number) => (
                          <div
                            key={idx}
                            className="flex justify-between items-center text-[11px] bg-white/70 dark:bg-zinc-900/60 p-2 rounded-xl border border-amber-200 dark:border-amber-900/60"
                          >
                            <span className="font-bold text-gray-900 dark:text-white">
                              {item.qty || 1}x {item.name}
                            </span>
                            {item.price && (
                              <span className="font-mono text-gray-600 dark:text-zinc-400">
                                ₱{Number(item.price).toFixed(2)}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                      {canSplitDelivery && (
                        <button
                          onClick={handleOpenSplitModal}
                          className="w-full mt-1.5 py-1.5 text-xs font-bold delivio-btn-yellow rounded-xl flex items-center justify-center gap-1.5 shadow-xs"
                        >
                          <Split className="w-3.5 h-3.5" />
                          <span>Split delivery</span>
                        </button>
                      )}
                    </div>
                  )}

                  {/* Active Split Child Orders Status List */}
                  {splitChildOrders.length > 0 && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-extrabold uppercase tracking-wider text-indigo-700 dark:text-indigo-300 flex items-center gap-1">
                          <Split className="w-3.5 h-3.5 text-indigo-500" />
                          Split Delivery ({splitChildOrders.length + 1} Riders Total)
                        </span>
                        <span className="text-[10px] font-bold text-gray-400">
                          {splitChildOrders.length} extra child order(s)
                        </span>
                      </div>

                      {splitChildOrders.map((child, idx) => {
                        const childSeq = child.seq || idx + 2;
                        const canCancel = !child.riderId && child.status !== 'Cancelled';
                        return (
                          <div
                            key={child.id}
                            className="p-3.5 rounded-2xl bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900 space-y-2 text-[11px]"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-extrabold text-indigo-900 dark:text-indigo-200 flex items-center gap-1.5">
                                <span className="w-5 h-5 rounded-full bg-indigo-200 dark:bg-indigo-800 text-indigo-900 dark:text-white flex items-center justify-center text-[10px] font-black">
                                  {childSeq}
                                </span>
                                Rider {childSeq}
                              </span>
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono text-[10px] font-extrabold px-1.5 py-0.5 rounded bg-indigo-200 dark:bg-indigo-900 text-indigo-900 dark:text-indigo-200">
                                  #{child.orderNumber || child.id.slice(0, 6)}
                                </span>
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/60 text-indigo-800 dark:text-indigo-200">
                                  {child.status}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center justify-between">
                              <span className="text-gray-500">Assigned Driver:</span>
                              {child.riderName ? (
                                <span className="font-bold text-gray-900 dark:text-white flex items-center gap-1">
                                  <Car className="w-3 h-3 text-indigo-500" />
                                  {child.riderName}
                                </span>
                              ) : child.status === 'Cancelled' ? (
                                <span className="text-red-500 font-bold">Cancelled</span>
                              ) : (
                                <span className="text-amber-600 dark:text-amber-400 font-bold animate-pulse">
                                  Dispatch searching riders...
                                </span>
                              )}
                            </div>

                            <div className="flex items-center justify-between">
                              <span className="text-gray-500">Rider Pay (Fixed):</span>
                              <span className="font-mono font-bold text-emerald-600">
                                ₱{Number(child.riderFeeFixed || 45).toFixed(2)}
                              </span>
                            </div>

                            <div className="flex items-center justify-between">
                              <span className="text-gray-500">Cash Collection:</span>
                              <span className="font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded text-[10px]">
                                No Cash Collected
                              </span>
                            </div>

                            {/* Assigned Items */}
                            {child.items && child.items.length > 0 && (
                              <div className="pt-1.5 border-t border-indigo-100 dark:border-indigo-900/60">
                                <span className="text-[10px] uppercase font-bold text-gray-400">
                                  Handed-Over Items:
                                </span>
                                <div className="mt-1 space-y-0.5">
                                  {child.items.map((it: any, i: number) => (
                                    <div key={i} className="text-gray-700 dark:text-zinc-300">
                                      • {it.qty}x {it.name}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Cancel button per child before a rider accepts */}
                            {canCancel && (
                              <button
                                onClick={() => handleCancelSingleSplitChild(child)}
                                disabled={cancellingChildId === child.id}
                                className="w-full mt-2 py-1.5 px-2.5 rounded-xl border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 hover:bg-red-100 text-[11px] font-bold flex items-center justify-center gap-1.5"
                              >
                                {cancellingChildId === child.id ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Ban className="w-3.5 h-3.5" />
                                )}
                                <span>Cancel Rider {childSeq} Delivery</span>
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {loadingOrder ? (
                    <div className="py-8 text-center text-xs text-gray-400 flex items-center justify-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-amber-500" />
                      <span>Loading order details...</span>
                    </div>
                  ) : !relatedOrder ? (
                    <div className="p-4 rounded-2xl bg-gray-50 dark:bg-zinc-850 text-center text-gray-400 space-y-2">
                      <p>No linked order record found for this ticket.</p>
                      {(selectedTicket.orderNumber || selectedTicket.orderId) && (
                        <p className="font-mono text-gray-600 dark:text-zinc-400">
                          Order Number: {formatOrderNumber({ orderNumber: selectedTicket.orderNumber, id: selectedTicket.orderId })}
                        </p>
                      )}
                      <button
                        onClick={() => {
                          setRefundAmount(0);
                          setRefundReason(`Support compensation for ticket #${selectedTicket.id}`);
                          setRefundModalOpen(true);
                        }}
                        className="delivio-btn-yellow px-3 py-1.5 text-xs font-bold rounded-xl mt-2 w-full"
                      >
                        Issue Goodwill Wallet Refund
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {/* Order Status & Batch */}
                      <div className="p-3 rounded-2xl bg-gray-50 dark:bg-zinc-850/60 border border-gray-100 dark:border-zinc-800 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-bold text-gray-900 dark:text-white">
                            {formatOrderNumber(relatedOrder)}
                          </span>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300">
                            {relatedOrder.status}
                          </span>
                        </div>

                        <div className="flex items-center justify-between text-[11px] text-gray-400">
                          <span className="capitalize">Service: <strong>{relatedOrder.serviceType}</strong></span>
                          {(selectedTicket.batchId || relatedOrder.batchId) && (
                            <span className="font-mono text-purple-600 dark:text-purple-400 font-bold">
                              Batch: #{selectedTicket.batchId || relatedOrder.batchId}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Stops: Pickup and Dropoff */}
                      <div className="space-y-2 text-[11px] p-3 rounded-2xl bg-gray-50/70 dark:bg-zinc-850/40 border border-gray-100 dark:border-zinc-800">
                        <span className="text-gray-400 font-bold uppercase text-[10px] tracking-wider block">
                          Route Stops
                        </span>

                        {/* Pickup */}
                        <div className="flex items-start gap-2">
                          <div className="w-5 h-5 rounded-md bg-emerald-100 dark:bg-emerald-950 text-emerald-600 flex items-center justify-center shrink-0 mt-0.5 font-black text-[10px]">
                            P
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-gray-900 dark:text-white truncate">
                              {resolveOrderMerchantDisplay(relatedOrder, merchantsById, true) || relatedOrder.merchantName || 'Pickup Location'}
                            </p>
                            <p className="text-[10px] text-gray-400 truncate">
                              {relatedOrder.pickup?.address || relatedOrder.merchantAddress || 'Merchant premises'}
                            </p>
                          </div>
                        </div>

                        {/* Dropoff */}
                        <div className="flex items-start gap-2">
                          <div className="w-5 h-5 rounded-md bg-amber-100 dark:bg-amber-950 text-amber-600 flex items-center justify-center shrink-0 mt-0.5 font-black text-[10px]">
                            D
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-gray-900 dark:text-white truncate">
                              {relatedOrder.customerName || selectedTicket.customerName || 'Customer'}
                            </p>
                            <p className="text-[10px] text-gray-400 truncate">
                              {relatedOrder.dropoff?.address || 'Customer destination'}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Driver Info */}
                      {(relatedOrder.riderName || selectedTicket.riderName) && (
                        <div className="space-y-1 text-[11px] p-2.5 rounded-xl border border-gray-100 dark:border-zinc-800">
                          <span className="text-gray-400 font-bold uppercase text-[10px]">Assigned Driver</span>
                          <div className="font-bold text-gray-900 dark:text-white flex items-center gap-1.5">
                            <Car className="w-3.5 h-3.5 text-amber-500" />
                            <span>{relatedOrder.riderName || selectedTicket.riderName}</span>
                          </div>
                          {(relatedOrder.riderPhone || selectedTicket.riderPhone) && (
                            <div className="text-gray-500 flex items-center gap-1.5 text-[10px]">
                              <Phone className="w-3 h-3" />
                              <span>{relatedOrder.riderPhone || selectedTicket.riderPhone}</span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Customer Info */}
                      <div className="space-y-1 text-[11px] p-2.5 rounded-xl border border-gray-100 dark:border-zinc-800">
                        <span className="text-gray-400 font-bold uppercase text-[10px]">Customer</span>
                        <div className="font-bold text-gray-900 dark:text-white flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5 text-blue-500" />
                          <span>{relatedOrder.customerName || selectedTicket.customerName}</span>
                        </div>
                        {(relatedOrder.customerPhone || selectedTicket.customerPhone) && (
                          <div className="text-gray-500 flex items-center gap-1.5 text-[10px]">
                            <Phone className="w-3 h-3" />
                            <span>{relatedOrder.customerPhone || selectedTicket.customerPhone}</span>
                          </div>
                        )}
                      </div>

                      {/* Items Ordered List */}
                      {relatedOrder.items && relatedOrder.items.length > 0 && (
                        <div className="space-y-1.5 pt-2 border-t border-gray-100 dark:border-zinc-800">
                          <span className="text-gray-400 font-bold uppercase text-[10px]">
                            Items Ordered ({relatedOrder.items.length})
                          </span>
                          <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                            {relatedOrder.items.map((item, idx) => (
                              <div
                                key={idx}
                                className="flex justify-between items-start py-1 border-b border-gray-100/60 dark:border-zinc-800/60 text-[11px]"
                              >
                                <div>
                                  <span className="font-bold text-gray-900 dark:text-white">
                                    {item.qty}x {item.name}
                                  </span>
                                </div>
                                <span className="font-bold font-mono text-gray-700 dark:text-zinc-300">
                                  ₱{Number(item.price * item.qty).toFixed(2)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Fees Breakdown */}
                      <div className="p-3 rounded-2xl bg-gray-50 dark:bg-zinc-850/60 space-y-1 text-[11px]">
                        <div className="flex justify-between">
                          <span className="text-gray-500">Subtotal</span>
                          <span className="font-mono">₱{Number(relatedOrder.fees?.subtotal || 0).toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Delivery Fee</span>
                          <span className="font-mono">₱{Number(relatedOrder.fees?.deliveryFee || 0).toFixed(2)}</span>
                        </div>
                        {Number(relatedOrder.fees?.serviceFee || 0) > 0 && (
                          <div className="flex justify-between">
                            <span className="text-gray-500">Service Fee</span>
                            <span className="font-mono">₱{Number(relatedOrder.fees?.serviceFee || 0).toFixed(2)}</span>
                          </div>
                        )}
                        {(relatedOrder.lateTip || (relatedOrder.fees as any)?.lateTip) && (
                          <div className="flex justify-between text-amber-600 font-bold">
                            <span>Late Tip</span>
                            <span className="font-mono">+₱{Number(relatedOrder.lateTip || (relatedOrder.fees as any)?.lateTip || 0).toFixed(2)}</span>
                          </div>
                        )}
                        {Number(relatedOrder.fees?.discount || 0) > 0 && (
                          <div className="flex justify-between text-emerald-600">
                            <span>Discount</span>
                            <span className="font-mono">-₱{Number(relatedOrder.fees?.discount || 0).toFixed(2)}</span>
                          </div>
                        )}
                        <div className="flex justify-between pt-1 border-t border-gray-200 dark:border-zinc-700 font-extrabold text-xs text-gray-900 dark:text-white">
                          <span>Total</span>
                          <span className="font-mono text-amber-600">₱{Number(relatedOrder.fees?.total || 0).toFixed(2)}</span>
                        </div>
                        <div className="text-[10px] text-gray-400 pt-0.5">
                          Payment: <strong className="uppercase">{relatedOrder.paymentMethod}</strong> ({relatedOrder.paymentStatus || 'Paid'})
                        </div>
                      </div>

                      {/* Action Buttons: Cancel Order & Wallet Refund */}
                      <div className="space-y-2 pt-2 border-t border-gray-100 dark:border-zinc-800">
                        {relatedOrder.status !== 'Cancelled' && (
                          <button
                            type="button"
                            onClick={() => {
                              setCancelReasonPicker('Dispute resolved via Support');
                              setCancelNote('');
                              setCancelFault('platform');
                              setRefundToWallet(true);
                              setCancelModalOpen(true);
                            }}
                            className="w-full py-2 px-3 text-xs font-bold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-xl hover:bg-red-100 transition-colors flex items-center justify-center gap-1.5"
                          >
                            <Ban className="w-3.5 h-3.5" />
                            <span>Cancel Order</span>
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => {
                            setRefundAmount(Number(relatedOrder.fees?.total || 0));
                            setRefundReason(`Support resolution for ticket #${selectedTicket.id}`);
                            setRefundModalOpen(true);
                          }}
                          className="w-full py-2 px-3 text-xs font-bold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 rounded-xl hover:bg-amber-100 transition-colors flex items-center justify-center gap-1.5"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Direct Customer Wallet Refund</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* MODAL 1: SPLIT DELIVERY DISPATCH MODAL */}
      {splitModalOpen && selectedTicket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-6 shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100 dark:border-zinc-800">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-amber-400 flex items-center justify-center text-black font-extrabold shadow-sm">
                  <Split className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-base text-gray-900 dark:text-white">
                    Split Delivery with Several Riders
                  </h3>
                  <p className="text-xs text-gray-500">
                    Dispatch extra riders with Priority delivery for items exceeding vehicle capacity.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSplitModalOpen(false)}
                className="p-1.5 rounded-xl text-gray-400 hover:text-gray-700 dark:hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Note on Cash Collection */}
            <div className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800/80 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <p className="font-extrabold text-[12px]">Cash Collection Rule</p>
                <p className="text-[11px] leading-relaxed text-amber-900 dark:text-amber-200 font-semibold">
                  Only the first rider collects cash. Other riders show No Cash Collected.
                </p>
              </div>
            </div>

            {/* Riders Needed Selector (2 to 5, default 2) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-zinc-300">
                  Riders Needed:
                </label>
                <span className="text-[11px] text-gray-500 font-semibold">
                  Rider 1 is current driver ({relatedOrder?.riderName || selectedTicket.riderName || 'Assigned'})
                </span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {[2, 3, 4, 5].map((num) => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => {
                      setRidersNeeded(num);
                      // If any item was assigned to a rider beyond num, cap it to num
                      setItemAssignments((prev) => {
                        const next = { ...prev };
                        Object.keys(next).forEach((k) => {
                          const idx = Number(k);
                          if (next[idx] > num) {
                            next[idx] = num;
                          }
                        });
                        return next;
                      });
                    }}
                    className={`py-2 px-3 rounded-2xl border text-xs font-extrabold flex flex-col items-center justify-center transition-all ${
                      ridersNeeded === num
                        ? 'bg-amber-400 text-black border-amber-500 shadow-xs'
                        : 'bg-white dark:bg-zinc-800 border-gray-200 dark:border-zinc-700 text-gray-700 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-750'
                    }`}
                  >
                    <span>{num} Riders</span>
                    <span className="text-[10px] font-normal opacity-80">
                      {num === 2 ? '1 extra rider' : `${num - 1} extra riders`}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Item Assignment Grid */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-zinc-300">
                  Item Assignment Grid:
                </label>
                <span className="text-[11px] font-semibold text-gray-500">
                  Assign each handed-over item to Rider 2{ridersNeeded > 2 ? `, Rider 3...` : ''}
                </span>
              </div>

              <div className="max-h-56 overflow-y-auto space-y-2 border border-gray-200 dark:border-zinc-800 rounded-2xl p-2.5 bg-gray-50/50 dark:bg-zinc-850/50">
                {candidateItems.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-4">No items found on order.</p>
                ) : (
                  candidateItems.map((item, idx) => {
                    const assignedRider = itemAssignments[idx] ?? 1;
                    return (
                      <div
                        key={idx}
                        className="p-2.5 rounded-xl border bg-white dark:bg-zinc-800 border-gray-200 dark:border-zinc-750 flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow-2xs"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-bold text-gray-900 dark:text-white truncate">
                            {item.qty || 1}x {item.name}
                          </div>
                          {item.price && (
                            <div className="font-mono text-[11px] text-gray-500">
                              ₱{Number(item.price * (item.qty || 1)).toFixed(2)}
                            </div>
                          )}
                        </div>

                        {/* Rider Assignment Options */}
                        <div className="flex items-center gap-1 shrink-0 flex-wrap">
                          <button
                            type="button"
                            onClick={() => setItemAssignments((prev) => ({ ...prev, [idx]: 1 }))}
                            className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-all ${
                              assignedRider === 1
                                ? 'bg-zinc-900 text-white dark:bg-white dark:text-black shadow-2xs'
                                : 'bg-gray-100 dark:bg-zinc-700 text-gray-600 dark:text-zinc-300 hover:bg-gray-200 dark:hover:bg-zinc-650'
                            }`}
                          >
                            Rider 1 (Current)
                          </button>
                          {Array.from({ length: ridersNeeded - 1 }, (_, i) => i + 2).map((rNum) => (
                            <button
                              key={rNum}
                              type="button"
                              onClick={() => setItemAssignments((prev) => ({ ...prev, [idx]: rNum }))}
                              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${
                                assignedRider === rNum
                                  ? 'bg-amber-400 text-black font-extrabold shadow-2xs ring-1 ring-amber-500'
                                  : 'bg-gray-100 dark:bg-zinc-700 text-gray-600 dark:text-zinc-300 hover:bg-gray-200 dark:hover:bg-zinc-650'
                              }`}
                            >
                              Rider {rNum}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Assignment Summary Pills */}
              <div className="flex flex-wrap gap-2 pt-1">
                <span className="px-2.5 py-0.5 rounded-lg text-[10px] font-bold bg-gray-100 text-gray-700 dark:bg-zinc-800 dark:text-zinc-300">
                  Rider 1 (Current): {candidateItems.filter((_, idx) => (itemAssignments[idx] ?? 1) === 1).length} item(s)
                </span>
                {Array.from({ length: ridersNeeded - 1 }, (_, i) => i + 2).map((rNum) => {
                  const count = candidateItems.filter((_, idx) => (itemAssignments[idx] ?? 1) === rNum).length;
                  return (
                    <span
                      key={rNum}
                      className={`px-2.5 py-0.5 rounded-lg text-[10px] font-bold border ${
                        count > 0
                          ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border-emerald-300'
                          : 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400 border-red-300'
                      }`}
                    >
                      Rider {rNum}: {count} item(s) {count === 0 && '⚠ Need ≥ 1 item'}
                    </span>
                  );
                })}
              </div>
            </div>

            {/* Rider Fee input */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-1">
                Fixed Payout per Extra Rider (₱):
              </label>
              <input
                type="number"
                min="20"
                step="5"
                value={splitRiderFee}
                onChange={(e) => setSplitRiderFee(Number(e.target.value))}
                className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white font-bold"
              />
              <p className="text-[10px] text-gray-400 mt-1">
                Each extra rider (Riders 2..{ridersNeeded}) receives this fixed fee.
              </p>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => setSplitModalOpen(false)}
                className="px-4 py-2 text-xs font-bold text-gray-600 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-xl"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteSplitDelivery}
                disabled={splittingDelivery}
                className="delivio-btn-yellow px-5 py-2 text-xs font-extrabold rounded-xl flex items-center gap-1.5 shadow-sm disabled:opacity-50"
              >
                {splittingDelivery && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Confirm & Dispatch {ridersNeeded - 1} Extra Rider(s)</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: RESOLVE TICKET MODAL */}
      {resolveModalOpen && selectedTicket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-emerald-100 dark:bg-emerald-950/60 flex items-center justify-center text-emerald-600">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-base text-gray-900 dark:text-white">
                  Resolve Support Ticket
                </h3>
                <p className="text-xs text-gray-500">
                  Ticket #{selectedTicket.id.slice(0, 8)} ({selectedTicket.reporterType === 'rider' ? 'Driver Report' : 'Customer'})
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-semibold text-gray-700 dark:text-zinc-300">
                Resolution Note <span className="text-red-500">*</span>
              </label>
              <textarea
                value={resolutionNote}
                onChange={(e) => setResolutionNote(e.target.value)}
                placeholder="Explain the outcome (e.g. 'Customer provided delivery proof, refund processed', 'Secondary driver dispatched', etc.)"
                rows={3}
                className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white resize-none"
              />
              <p className="text-[11px] text-gray-400">
                This note will be logged in the audit trail, sent to the {selectedTicket.reporterType === 'rider' ? "driver's" : "customer's"} inbox, and mark the conversation as resolved.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => setResolveModalOpen(false)}
                className="px-4 py-2 text-xs font-bold text-gray-600 dark:text-zinc-400 hover:bg-gray-100 rounded-xl"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleResolveTicket}
                disabled={resolving || !resolutionNote.trim()}
                className="px-5 py-2 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5 disabled:opacity-50"
              >
                {resolving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Confirm Resolution</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: CANCEL ORDER MODAL */}
      {cancelModalOpen && relatedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-red-100 dark:bg-red-950/60 flex items-center justify-center text-red-600">
                <Ban className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-base text-gray-900 dark:text-white">
                  Cancel Order #{relatedOrder.orderNumber}
                </h3>
                <p className="text-xs text-gray-500">
                  Total: ₱{Number(relatedOrder.fees?.total || 0).toFixed(2)} • {relatedOrder.serviceType}
                </p>
              </div>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Reason Preset
                </label>
                <select
                  value={cancelReasonPicker}
                  onChange={(e) => setCancelReasonPicker(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                >
                  <option value="Customer dispute via Support">Customer dispute via Support</option>
                  <option value="Driver cannot fulfill order">Driver cannot fulfill order</option>
                  <option value="Merchant store closed">Merchant store closed</option>
                  <option value="Out of stock items">Out of stock items</option>
                  <option value="Severe delivery delay">Severe delivery delay</option>
                  <option value="Customer unreachable">Customer unreachable</option>
                  <option value="Other support reason">Other support reason</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Cancellation Fault Assignment
                </label>
                <select
                  value={cancelFault}
                  onChange={(e) => setCancelFault(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                >
                  <option value="platform">Platform / Operations Fault</option>
                  <option value="merchant">Merchant Store Fault</option>
                  <option value="rider">Rider / Driver Fault</option>
                  <option value="customer">Customer Fault</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Additional Details
                </label>
                <input
                  type="text"
                  value={cancelNote}
                  onChange={(e) => setCancelNote(e.target.value)}
                  placeholder="Optional context..."
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                />
              </div>

              {(relatedOrder.paymentMethod || '').toLowerCase() === 'wallet' && (
                <label className="flex items-center gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={refundToWallet}
                    onChange={(e) => setRefundToWallet(e.target.checked)}
                    className="w-4 h-4 rounded text-amber-500"
                  />
                  <span className="font-semibold text-amber-900 dark:text-amber-200">
                    Automatically refund ₱{Number(relatedOrder.fees?.total || 0).toFixed(2)} to Customer Wallet
                  </span>
                </label>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => setCancelModalOpen(false)}
                className="px-4 py-2 text-xs font-bold text-gray-600 dark:text-zinc-400 hover:bg-gray-100 rounded-xl"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleExecuteCancelOrder}
                disabled={cancellingOrder}
                className="px-5 py-2 text-xs font-bold rounded-xl bg-red-600 hover:bg-red-700 text-white flex items-center gap-1.5"
              >
                {cancellingOrder && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Confirm Cancellation</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: DIRECT WALLET REFUND MODAL */}
      {refundModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-amber-100 dark:bg-amber-950/60 flex items-center justify-center text-amber-600">
                <RotateCcw className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-base text-gray-900 dark:text-white">
                  Issue Customer Wallet Refund
                </h3>
                <p className="text-xs text-gray-500">
                  Recipient: {selectedTicket?.customerName || relatedOrder?.customerName || 'Customer'}
                </p>
              </div>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Refund Amount (PHP) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  min="1"
                  step="0.5"
                  value={refundAmount || ''}
                  onChange={(e) => setRefundAmount(Number(e.target.value))}
                  placeholder="0.00"
                  className="w-full px-3.5 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white font-bold"
                />
              </div>

              <div>
                <label className="block font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Reason / Compensation Note
                </label>
                <input
                  type="text"
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  placeholder="e.g. Missing burger refunded, late delivery courtesy credit"
                  className="w-full px-3.5 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => setRefundModalOpen(false)}
                className="px-4 py-2 text-xs font-bold text-gray-600 dark:text-zinc-400 hover:bg-gray-100 rounded-xl"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteWalletRefund}
                disabled={processingRefund || refundAmount <= 0}
                className="delivio-btn-yellow px-5 py-2 text-xs font-bold rounded-xl flex items-center gap-1.5 disabled:opacity-50"
              >
                {processingRefund && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Credit Wallet</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 5: LIGHTBOX ENLARGE PHOTO */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md cursor-pointer"
          onClick={() => setLightboxImage(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh] overflow-hidden rounded-2xl bg-black">
            <button
              onClick={() => setLightboxImage(null)}
              className="absolute top-3 right-3 p-2 rounded-full bg-black/60 text-white hover:bg-black/90 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
            <img
              src={lightboxImage}
              alt="Enlarged view"
              className="w-full h-full max-h-[85vh] object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}
    </div>
  );
};
