import React, { useState, useEffect, useMemo } from 'react';
import {
  db,
  collection,
  query,
  getDocs,
  orderBy,
  limit,
  doc,
  getDoc,
  writeBatch,
  deleteDoc
} from '../firebase';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import type { ChatThread, ChatMessage, Order } from '../types';
import {
  isOrderChatOpen,
  isOrderChatDeletedAfter24h,
  formatExpireAtDate,
  formatMessageTime
} from '../utils/chatUtils';
import {
  deleteChatThread,
  cleanupExpiredChats,
  cleanupExpiredThreadData
} from '../utils/chatCleanup';
import { ImageLightboxModal } from '../components/chat/ImageLightboxModal';
import { ConfirmationModal } from '../components/common/ConfirmationModal';
import {
  MessageSquare,
  Search,
  Store,
  Car,
  Trash2,
  Clock,
  AlertCircle,
  CheckCircle2,
  Filter,
  User,
  Shield,
  Loader2,
  RefreshCw,
  Eye,
  Calendar,
  Lock,
  ChevronRight
} from 'lucide-react';

export const Chats: React.FC = () => {
  const { adminProfile, isFullAdmin } = useAuth();
  const { showSuccess, showError } = useToast();

  const role = adminProfile?.adminRole || (adminProfile?.role === 'admin' ? 'admin' : 'support');
  const isFinance = role === 'finance';

  const [loading, setLoading] = useState(true);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [channelFilter, setChannelFilter] = useState<'all' | 'merchant' | 'rider'>('all');
  const [merchantFilter, setMerchantFilter] = useState<string>('all');
  const [driverFilter, setDriverFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'closed'>('all');

  // Messages of the selected thread
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [selectedThreadOrder, setSelectedThreadOrder] = useState<Order | null>(null);

  // Lightbox
  const [zoomImage, setZoomImage] = useState<string | null>(null);

  // Delete single chat modal
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [threadToDelete, setThreadToDelete] = useState<ChatThread | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Delete all expired chats modal
  const [cleanupModalOpen, setCleanupModalOpen] = useState(false);
  const [cleaningUp, setCleaningUp] = useState(false);

  // Fetch the 100 most recent threads
  const fetchThreads = async () => {
    if (isFinance) return;

    try {
      setLoading(true);
      let list: ChatThread[] = [];

      try {
        // 100 most recent threads (orderBy lastMessageAt descending)
        const q = query(
          collection(db, 'orderChats'),
          orderBy('lastMessageAt', 'desc'),
          limit(100)
        );
        const snap = await getDocs(q);
        snap.forEach((d) => {
          const dt = d.data();
          list.push({
            id: d.id,
            orderId: dt.orderId || '',
            orderNumber: dt.orderNumber || '',
            channel: dt.channel || (d.id.includes('_merchant') ? 'merchant' : 'rider'),
            customerId: dt.customerId || '',
            customerName: dt.customerName || 'Customer',
            merchantId: dt.merchantId || null,
            merchantName: dt.merchantName || null,
            riderId: dt.riderId || null,
            riderName: dt.riderName || null,
            createdAt: dt.createdAt,
            lastMessageAt: dt.lastMessageAt,
            lastMessageText: dt.lastMessageText || '',
            lastSenderRole: dt.lastSenderRole || 'customer',
            customerReadAt: dt.customerReadAt,
            partnerReadAt: dt.partnerReadAt,
            expireAt: dt.expireAt
          });
        });
      } catch (orderErr) {
        // Fallback without orderBy if index is still indexing
        console.debug('Falling back to client-side sort for orderChats:', orderErr);
        const fallbackSnap = await getDocs(collection(db, 'orderChats'));
        fallbackSnap.forEach((d) => {
          const dt = d.data();
          list.push({
            id: d.id,
            orderId: dt.orderId || '',
            orderNumber: dt.orderNumber || '',
            channel: dt.channel || (d.id.includes('_merchant') ? 'merchant' : 'rider'),
            customerId: dt.customerId || '',
            customerName: dt.customerName || 'Customer',
            merchantId: dt.merchantId || null,
            merchantName: dt.merchantName || null,
            riderId: dt.riderId || null,
            riderName: dt.riderName || null,
            createdAt: dt.createdAt,
            lastMessageAt: dt.lastMessageAt,
            lastMessageText: dt.lastMessageText || '',
            lastSenderRole: dt.lastSenderRole || 'customer',
            customerReadAt: dt.customerReadAt,
            partnerReadAt: dt.partnerReadAt,
            expireAt: dt.expireAt
          });
        });

        list.sort((a, b) => {
          const tA = a.lastMessageAt?.toMillis ? a.lastMessageAt.toMillis() : (a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0);
          const tB = b.lastMessageAt?.toMillis ? b.lastMessageAt.toMillis() : (b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0);
          return tB - tA;
        });

        if (list.length > 100) {
          list = list.slice(0, 100);
        }
      }

      // Filter out any expired threads (expireAt < now) and delete them from Firestore
      const nowMs = Date.now();
      const activeList: ChatThread[] = [];
      const expiredThreadDocs: string[] = [];

      for (const t of list) {
        let isExpired = false;
        if (t.expireAt) {
          const tExpMs = t.expireAt.toMillis ? t.expireAt.toMillis() : new Date(t.expireAt).getTime();
          if (!isNaN(tExpMs) && tExpMs < nowMs) {
            isExpired = true;
          }
        }
        if (!isExpired) {
          activeList.push(t);
        } else {
          expiredThreadDocs.push(t.id);
        }
      }

      if (expiredThreadDocs.length > 0) {
        const batch = writeBatch(db);
        expiredThreadDocs.forEach((id) => batch.delete(doc(db, 'orderChats', id)));
        batch.commit().catch(() => {});
      }

      setThreads(activeList);
      if (activeList.length > 0 && !selectedThreadId) {
        setSelectedThreadId(activeList[0].id);
      }

      // Background automatic cleanup of expired chats that belong to the signed-in user
      // (queries chatMessages where expireAt < now, batch deletes, deletes thread if expired, throttled to 30 mins)
      cleanupExpiredThreadData(activeList).catch(() => {});
    } catch (err: any) {
      showError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchThreads();
  }, [isFinance]);

  // When selectedThreadId changes, fetch messages and associated order for status check
  useEffect(() => {
    if (!selectedThreadId) {
      setMessages([]);
      setSelectedThreadOrder(null);
      return;
    }

    const currentThread = threads.find((t) => t.id === selectedThreadId);
    if (!currentThread) return;

    const fetchThreadDetails = async () => {
      try {
        setLoadingMessages(true);

        // Fetch associated order if orderId exists
        if (currentThread.orderId) {
          try {
            const orderSnap = await getDoc(doc(db, 'orders', currentThread.orderId));
            if (orderSnap.exists()) {
              setSelectedThreadOrder({ id: orderSnap.id, ...orderSnap.data() } as Order);
            } else {
              setSelectedThreadOrder(null);
            }
          } catch {
            setSelectedThreadOrder(null);
          }
        }

        // Fetch messages subcollection
        const msgRef = collection(db, 'orderChats', currentThread.id, 'chatMessages');
        const snap = await getDocs(msgRef);
        const list: ChatMessage[] = [];
        const expiredMsgRefs: any[] = [];
        const nowMs = Date.now();

        snap.forEach((d) => {
          const dt = d.data();
          let isExpired = false;
          if (dt.expireAt) {
            const expMs = dt.expireAt.toMillis ? dt.expireAt.toMillis() : new Date(dt.expireAt).getTime();
            if (!isNaN(expMs) && expMs < nowMs) {
              isExpired = true;
            }
          }

          if (isExpired) {
            expiredMsgRefs.push(d.ref);
          } else {
            list.push({
              id: d.id,
              senderId: dt.senderId || '',
              senderRole: dt.senderRole || 'customer',
              type: dt.type || 'text',
              text: dt.text || '',
              image: dt.image || '',
              source: dt.source,
              createdAt: dt.createdAt,
              expireAt: dt.expireAt
            });
          }
        });

        // Delete any expired messages from Firestore immediately
        if (expiredMsgRefs.length > 0) {
          const batch = writeBatch(db);
          expiredMsgRefs.forEach((ref) => batch.delete(ref));
          batch.commit().catch(() => {});
        }

        // Sort on device by createdAt ascending
        list.sort((a, b) => {
          const tA = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
          const tB = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
          return tA - tB;
        });

        setMessages(list);

        // Background cleanup for this opened chat thread
        cleanupExpiredThreadData([{ id: currentThread.id, expireAt: currentThread.expireAt }]).catch(() => {});
      } catch (err: any) {
        showError(err);
      } finally {
        setLoadingMessages(false);
      }
    };

    fetchThreadDetails();
  }, [selectedThreadId, threads]);

  // Distinct merchant and driver options for filters
  const uniqueMerchants = useMemo(() => {
    const map = new Map<string, string>();
    threads.forEach((t) => {
      if (t.merchantId && t.merchantName) {
        map.set(t.merchantId, t.merchantName);
      } else if (t.merchantName) {
        map.set(t.merchantName, t.merchantName);
      }
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [threads]);

  const uniqueDrivers = useMemo(() => {
    const map = new Map<string, string>();
    threads.forEach((t) => {
      if (t.riderId && t.riderName) {
        map.set(t.riderId, t.riderName);
      } else if (t.riderName) {
        map.set(t.riderName, t.riderName);
      }
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [threads]);

  // Filtered threads list
  const filteredThreads = useMemo(() => {
    return threads.filter((t) => {
      // 1. Channel filter
      if (channelFilter !== 'all' && t.channel !== channelFilter) return false;

      // 2. Merchant filter
      if (merchantFilter !== 'all') {
        if (t.merchantId !== merchantFilter && t.merchantName !== merchantFilter) return false;
      }

      // 3. Driver filter
      if (driverFilter !== 'all') {
        if (t.riderId !== driverFilter && t.riderName !== driverFilter) return false;
      }

      // 4. Status filter (heuristic based on order or expireAt / terminal status)
      if (statusFilter !== 'all') {
        const isOpen = t.orderStatus ? isOrderChatOpen(t.orderStatus) : true;
        if (statusFilter === 'open' && !isOpen) return false;
        if (statusFilter === 'closed' && isOpen) return false;
      }

      // 5. Search by order number or customer / merchant / rider name
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const numStr = String(t.orderNumber || '').toLowerCase();
        const idStr = t.id.toLowerCase();
        const custStr = (t.customerName || '').toLowerCase();
        const mStr = (t.merchantName || '').toLowerCase();
        const rStr = (t.riderName || '').toLowerCase();

        if (
          !numStr.includes(q) &&
          !idStr.includes(q) &&
          !custStr.includes(q) &&
          !mStr.includes(q) &&
          !rStr.includes(q)
        ) {
          return false;
        }
      }

      return true;
    });
  }, [threads, channelFilter, merchantFilter, driverFilter, statusFilter, searchQuery]);

  // Action: Delete Single Chat
  const handleDeleteChat = async () => {
    if (!threadToDelete) return;
    try {
      setDeleting(true);
      await deleteChatThread(threadToDelete.id, adminProfile);
      showSuccess(`Chat thread "${threadToDelete.id}" and messages deleted permanently.`);
      setDeleteModalOpen(false);
      setThreadToDelete(null);
      fetchThreads();
    } catch (err: any) {
      showError(err);
    } finally {
      setDeleting(false);
    }
  };

  // Action: Delete All Expired Chats Now
  const handleCleanupExpired = async () => {
    try {
      setCleaningUp(true);
      const res = await cleanupExpiredChats(300, adminProfile);
      showSuccess(
        `Cleanup complete: ${res.deletedThreads} expired thread(s) and ${res.deletedMessages} message(s) removed.`
      );
      setCleanupModalOpen(false);
      fetchThreads();
    } catch (err: any) {
      showError(err);
    } finally {
      setCleaningUp(false);
    }
  };

  // Finance Access Guard
  if (isFinance) {
    return (
      <div className="p-12 max-w-lg mx-auto text-center space-y-4 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl shadow-sm mt-12">
        <div className="w-14 h-14 rounded-2xl bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400 flex items-center justify-center mx-auto">
          <Lock className="w-7 h-7" />
        </div>
        <h2 className="text-lg font-extrabold text-gray-900 dark:text-white">
          Access Restricted
        </h2>
        <p className="text-xs text-gray-500 dark:text-zinc-400">
          Staff with the <strong>Finance</strong> role do not have permission to view customer, merchant, and rider order chat logs. Please contact a full administrator if you need access.
        </p>
      </div>
    );
  }

  const selectedThread = threads.find((t) => t.id === selectedThreadId);
  const isSelectedChatOpen = selectedThreadOrder ? isOrderChatOpen(selectedThreadOrder.status) : true;
  const isSelectedChatExpired24h = selectedThreadOrder ? isOrderChatDeletedAfter24h(selectedThreadOrder) : false;

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-gray-900 dark:text-white flex items-center gap-2.5">
            <MessageSquare className="w-6 h-6 text-amber-500" />
            <span>Order Chat Monitoring</span>
          </h1>
          <p className="text-xs text-gray-500 dark:text-zinc-400 mt-1">
            Real-time read-only oversight of customer-merchant and customer-driver conversations. Chats are deleted automatically 10 days after the last message.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={fetchThreads}
            disabled={loading}
            className="p-2.5 rounded-2xl border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-gray-700 dark:text-zinc-300 hover:bg-gray-50 text-xs font-bold transition-all shadow-2xs"
            title="Refresh conversations"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-amber-500' : ''}`} />
          </button>

          {/* Full Admin Only: Delete all expired chats now */}
          {isFullAdmin && (
            <button
              type="button"
              onClick={() => setCleanupModalOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-2xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition-all shadow-xs"
            >
              <Trash2 className="w-4 h-4" />
              <span>Delete All Expired Chats Now</span>
            </button>
          )}
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="p-4 rounded-3xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 shadow-xs space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Search by Order Number */}
          <div className="relative w-full lg:w-80">
            <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by order #, customer, merchant, driver..."
              className="w-full pl-9 pr-4 py-2 rounded-xl border border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-850 text-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>

          {/* Quick Channel Filter */}
          <div className="flex items-center gap-1.5 p-1 bg-gray-100 dark:bg-zinc-800 rounded-2xl overflow-x-auto w-fit">
            {[
              { id: 'all' as const, label: 'All Channels', icon: MessageSquare },
              { id: 'merchant' as const, label: 'Merchant', icon: Store },
              { id: 'rider' as const, label: 'Driver', icon: Car }
            ].map((c) => {
              const Icon = c.icon;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setChannelFilter(c.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                    channelFilter === c.id
                      ? 'bg-amber-400 text-black shadow-xs'
                      : 'text-gray-600 dark:text-zinc-400 hover:text-black dark:hover:text-white'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{c.label}</span>
                </button>
              );
            })}
          </div>

          {/* Quick Status Filter */}
          <div className="flex items-center gap-1.5 p-1 bg-gray-100 dark:bg-zinc-800 rounded-2xl w-fit">
            {[
              { id: 'all' as const, label: 'All Status' },
              { id: 'open' as const, label: 'Open' },
              { id: 'closed' as const, label: 'Closed' }
            ].map((st) => (
              <button
                key={st.id}
                type="button"
                onClick={() => setStatusFilter(st.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  statusFilter === st.id
                    ? 'bg-gray-900 text-white dark:bg-white dark:text-zinc-900 shadow-xs'
                    : 'text-gray-600 dark:text-zinc-400 hover:text-gray-900'
                }`}
              >
                {st.label}
              </button>
            ))}
          </div>
        </div>

        {/* Secondary Filter Row: Merchant & Driver Dropdowns */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-gray-100 dark:border-zinc-800 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            {/* Merchant dropdown */}
            <div className="flex items-center gap-1.5">
              <Store className="w-3.5 h-3.5 text-gray-400" />
              <select
                value={merchantFilter}
                onChange={(e) => setMerchantFilter(e.target.value)}
                className="px-2.5 py-1.5 rounded-xl border border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-850 text-xs font-semibold text-gray-800 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-amber-400"
              >
                <option value="all">All Merchants</option>
                {uniqueMerchants.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Driver dropdown */}
            <div className="flex items-center gap-1.5">
              <Car className="w-3.5 h-3.5 text-gray-400" />
              <select
                value={driverFilter}
                onChange={(e) => setDriverFilter(e.target.value)}
                className="px-2.5 py-1.5 rounded-xl border border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-850 text-xs font-semibold text-gray-800 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-amber-400"
              >
                <option value="all">All Drivers</option>
                {uniqueDrivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="text-gray-500 font-semibold">
            Showing {filteredThreads.length} conversation(s)
          </div>
        </div>
      </div>

      {/* Main Split Pane: Left = Threads List (100 most recent), Right = Selected Thread Details */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN: Thread List */}
        <div className="lg:col-span-5 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl shadow-xs overflow-hidden flex flex-col max-h-[750px]">
          <div className="p-4 border-b border-gray-100 dark:border-zinc-800 flex items-center justify-between bg-gray-50/60 dark:bg-zinc-850/60">
            <span className="font-extrabold text-xs text-gray-700 dark:text-zinc-300 uppercase tracking-wider">
              Recent Threads ({filteredThreads.length})
            </span>
            <span className="text-[11px] text-gray-400 font-medium">Sorted by latest message</span>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-gray-100 dark:divide-zinc-800">
            {loading ? (
              <div className="p-12 text-center">
                <Loader2 className="w-6 h-6 animate-spin text-amber-500 mx-auto mb-2" />
                <p className="text-xs text-gray-400">Loading chat threads...</p>
              </div>
            ) : filteredThreads.length === 0 ? (
              <div className="p-10 text-center space-y-2 text-xs text-gray-400">
                <MessageSquare className="w-8 h-8 text-gray-300 dark:text-zinc-700 mx-auto" />
                <p className="font-bold text-gray-700 dark:text-zinc-300">No conversations found</p>
                <p className="text-[11px]">Try adjusting your search query or filters.</p>
              </div>
            ) : (
              filteredThreads.map((t) => {
                const isSelected = selectedThreadId === t.id;
                const isMerchantChannel = t.channel === 'merchant';

                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelectedThreadId(t.id)}
                    className={`w-full text-left p-4 transition-all flex flex-col space-y-2 hover:bg-gray-50/80 dark:hover:bg-zinc-850/50 ${
                      isSelected
                        ? 'bg-amber-50/70 dark:bg-amber-950/20 border-l-4 border-amber-500'
                        : ''
                    }`}
                  >
                    {/* Top row: Order #, Channel Pill, Timestamp */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-mono font-black text-xs text-gray-900 dark:text-white bg-gray-100 dark:bg-zinc-800 px-2 py-0.5 rounded-lg">
                          #{t.orderNumber || t.orderId.slice(0, 8)}
                        </span>

                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold ${
                            isMerchantChannel
                              ? 'bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-300'
                              : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                          }`}
                        >
                          {isMerchantChannel ? <Store className="w-3 h-3" /> : <Car className="w-3 h-3" />}
                          <span>{isMerchantChannel ? 'Merchant' : 'Driver'}</span>
                        </span>
                      </div>

                      <span className="text-[10px] font-medium text-gray-400 shrink-0">
                        {formatMessageTime(t.lastMessageAt || t.createdAt)}
                      </span>
                    </div>

                    {/* Parties Names */}
                    <div className="text-xs font-bold text-gray-800 dark:text-zinc-200 truncate">
                      <span>{t.customerName || 'Customer'}</span>
                      <span className="text-gray-400 mx-1">↔</span>
                      <span>{isMerchantChannel ? t.merchantName || 'Store' : t.riderName || 'Driver'}</span>
                    </div>

                    {/* Last message preview */}
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <p className="text-gray-500 dark:text-zinc-400 truncate text-[11px] font-normal">
                        <span className="font-semibold text-gray-600 dark:text-zinc-300 mr-1">
                          {t.lastSenderRole}:
                        </span>
                        {t.lastMessageText || 'No messages'}
                      </p>

                      <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
                    </div>

                    {/* Deletes on line */}
                    <div className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">
                      Deletes on {formatExpireAtDate(t.expireAt)}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: Selected Conversation Stream */}
        <div className="lg:col-span-7 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl shadow-xs overflow-hidden flex flex-col min-h-[600px] max-h-[750px]">
          {!selectedThread ? (
            <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-gray-400 space-y-3">
              <MessageSquare className="w-12 h-12 text-gray-300 dark:text-zinc-700" />
              <h4 className="text-sm font-bold text-gray-800 dark:text-zinc-200">
                Select a conversation
              </h4>
              <p className="text-xs max-w-sm">
                Choose an order chat thread from the left to view the live message stream, photos, and expiration details.
              </p>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="p-4 border-b border-gray-100 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-3 bg-gray-50/70 dark:bg-zinc-850/60">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-2xl bg-amber-400 text-black shadow-xs">
                    {selectedThread.channel === 'merchant' ? (
                      <Store className="w-5 h-5" />
                    ) : (
                      <Car className="w-5 h-5" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-black text-sm text-gray-900 dark:text-white">
                        Order #{selectedThread.orderNumber}
                      </span>

                      {/* Open or Closed chip */}
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                          isSelectedChatOpen
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800'
                            : 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                        }`}
                      >
                        {isSelectedChatOpen ? 'Open' : 'Closed'}
                      </span>
                    </div>

                    <p className="text-xs font-bold text-gray-700 dark:text-zinc-300 mt-0.5">
                      {selectedThread.customerName || 'Customer'}
                      <span className="text-gray-400 mx-1">↔</span>
                      {selectedThread.channel === 'merchant'
                        ? selectedThread.merchantName || 'Store'
                        : selectedThread.riderName || 'Driver'}
                    </p>

                    <div className="flex items-center gap-2 text-[10px] text-gray-500 dark:text-zinc-400 mt-0.5">
                      <span className="font-mono">Thread: {selectedThread.id}</span>
                      <span>•</span>
                      <span className="text-amber-600 dark:text-amber-400 font-medium">
                        Deletes on {formatExpireAtDate(selectedThread.expireAt)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Full Admin Delete Chat Button */}
                {isFullAdmin && (
                  <button
                    type="button"
                    onClick={() => {
                      setThreadToDelete(selectedThread);
                      setDeleteModalOpen(true);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-rose-300 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400 text-xs font-bold hover:bg-rose-100 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete this chat</span>
                  </button>
                )}
              </div>

              {/* Notice Banners */}
              {isSelectedChatExpired24h && (
                <div className="p-3 bg-zinc-100 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700 text-xs text-zinc-700 dark:text-zinc-300 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-zinc-500 shrink-0" />
                  <span>This conversation was deleted after 24 hours.</span>
                </div>
              )}

              {!isSelectedChatOpen && !isSelectedChatExpired24h && (
                <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-900 text-xs text-amber-900 dark:text-amber-200 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>This chat is closed because the order is complete. Chat history is preserved as read-only.</span>
                </div>
              )}

              {/* Messages Stream */}
              <div className="flex-1 p-5 space-y-3 overflow-y-auto bg-gray-50/40 dark:bg-zinc-950/40">
                {loadingMessages ? (
                  <div className="p-12 text-center">
                    <Loader2 className="w-6 h-6 animate-spin text-amber-500 mx-auto mb-2" />
                    <p className="text-xs text-gray-400">Loading conversation history...</p>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="p-12 text-center text-xs text-gray-400">
                    No messages recorded in this conversation.
                  </div>
                ) : (
                  messages.map((m) => {
                    const isCustomer = m.senderRole === 'customer';
                    const isMerchant = m.senderRole === 'merchant';
                    const isRider = m.senderRole === 'rider';

                    return (
                      <div
                        key={m.id}
                        className={`flex flex-col ${
                          isCustomer ? 'items-start' : 'items-end'
                        } text-xs space-y-1`}
                      >
                        {/* Sender Label */}
                        <div className="flex items-center gap-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider px-1">
                          {isCustomer && <User className="w-3 h-3 text-blue-500" />}
                          {isMerchant && <Store className="w-3 h-3 text-amber-500" />}
                          {isRider && <Car className="w-3 h-3 text-emerald-500" />}
                          <span>
                            {isCustomer
                              ? `Customer (${selectedThread.customerName || 'Customer'})`
                              : isMerchant
                              ? `Merchant (${selectedThread.merchantName || 'Store'})`
                              : `Driver (${selectedThread.riderName || 'Driver'})`}
                          </span>
                          <span>•</span>
                          <span>{formatMessageTime(m.createdAt)}</span>
                        </div>

                        {/* Bubble */}
                        <div
                          className={`p-3 rounded-2xl max-w-sm sm:max-w-md shadow-2xs ${
                            isCustomer
                              ? 'bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 text-gray-900 dark:text-white'
                              : 'bg-amber-400 text-black font-medium'
                          }`}
                        >
                          {m.type === 'image' && m.image ? (
                            <div className="space-y-1">
                              <button
                                type="button"
                                onClick={() => setZoomImage(m.image || null)}
                                className="block rounded-xl overflow-hidden hover:opacity-95 transition-opacity"
                              >
                                <img
                                  src={m.image}
                                  alt="Chat attachment"
                                  className="max-h-56 w-auto rounded-xl object-cover"
                                />
                              </button>
                              <span className="text-[10px] text-gray-500 dark:text-zinc-400 block italic">
                                Tap photo to enlarge {m.source ? `(${m.source})` : ''}
                              </span>
                            </div>
                          ) : (
                            <p className="whitespace-pre-wrap break-words">{m.text}</p>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Bottom status bar */}
              <div className="p-3 border-t border-gray-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-center text-[11px] text-gray-400 flex items-center justify-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-amber-500" />
                <span>Admin Monitoring Mode (Read-Only) • Retained for 10 days</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Image Lightbox Modal */}
      <ImageLightboxModal
        imageUrl={zoomImage}
        onClose={() => setZoomImage(null)}
        title={selectedThread ? `Order #${selectedThread.orderNumber} Chat Photo` : 'Chat Photo'}
      />

      {/* Confirmation Modal: Delete Single Chat */}
      {deleteModalOpen && threadToDelete && (
        <ConfirmationModal
          isOpen={deleteModalOpen}
          onClose={() => {
            setDeleteModalOpen(false);
            setThreadToDelete(null);
          }}
          onConfirm={handleDeleteChat}
          title={`Delete Chat Thread "${threadToDelete.id}"?`}
          message={`Are you sure you want to permanently delete this chat thread and all its messages? This action cannot be undone and will be recorded in the audit log.`}
          confirmLabel="Delete Chat"
          reasonRequired={false}
          isDestructive={true}
        />
      )}

      {/* Confirmation Modal: Cleanup Expired Chats */}
      {cleanupModalOpen && (
        <ConfirmationModal
          isOpen={cleanupModalOpen}
          onClose={() => setCleanupModalOpen(false)}
          onConfirm={handleCleanupExpired}
          title="Delete All Expired Chats Now?"
          message="This will search for all chat threads with expireAt in the past and permanently delete their messages first, then thread documents (up to 300 documents). This action will be recorded in audit logs."
          confirmLabel="Clean Up Expired Chats"
          reasonRequired={false}
          isDestructive={true}
        />
      )}
    </div>
  );
};
