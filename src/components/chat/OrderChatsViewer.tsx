import React, { useState, useEffect } from 'react';
import {
  db,
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  writeBatch,
  deleteDoc
} from '../../firebase';
import type { Order, ChatThread, ChatMessage } from '../../types';
import {
  isOrderChatOpen,
  isOrderChatDeletedAfter24h,
  formatExpireAtDate,
  formatMessageTime
} from '../../utils/chatUtils';
import { deleteChatThread, cleanupExpiredThreadData } from '../../utils/chatCleanup';
import { ImageLightboxModal } from './ImageLightboxModal';
import { ConfirmationModal } from '../common/ConfirmationModal';
import { useToast } from '../../context/ToastContext';
import {
  MessageSquare,
  Store,
  Car,
  Clock,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Calendar,
  User,
  Shield,
  Loader2,
  Inbox
} from 'lucide-react';

interface OrderChatsViewerProps {
  order: Order;
  isFullAdmin: boolean;
  adminProfile?: any;
}

export const OrderChatsViewer: React.FC<OrderChatsViewerProps> = ({
  order,
  isFullAdmin,
  adminProfile
}) => {
  const { showSuccess, showError } = useToast();

  const [loading, setLoading] = useState(true);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);

  // Messages for currently selected thread
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  // Lightbox
  const [zoomImage, setZoomImage] = useState<string | null>(null);

  // Delete modal
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [threadToDelete, setThreadToDelete] = useState<ChatThread | null>(null);
  const [deleting, setDeleting] = useState(false);

  const isDelivioInstant = order.serviceType === 'request_rider';
  const isOpen = isOrderChatOpen(order.status);
  const isExpired24h = isOrderChatDeletedAfter24h(order);

  // Fetch threads for this order
  const fetchThreads = async () => {
    if (isDelivioInstant) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      // Query orderChats where orderId == order.id
      const q = query(
        collection(db, 'orderChats'),
        where('orderId', '==', order.id)
      );
      const snap = await getDocs(q);
      const list: ChatThread[] = [];

      snap.forEach((d) => {
        const dt = d.data();
        list.push({
          id: d.id,
          orderId: dt.orderId || order.id,
          orderNumber: dt.orderNumber || order.orderNumber,
          channel: dt.channel || (d.id.includes('_merchant') ? 'merchant' : 'rider'),
          customerId: dt.customerId || order.customerId,
          customerName: dt.customerName || (order.customerName ? order.customerName.split(' ')[0] : 'Customer'),
          merchantId: dt.merchantId || order.merchantId,
          merchantName: dt.merchantName || order.merchantName,
          riderId: dt.riderId || order.riderId,
          riderName: dt.riderName || order.riderName,
          createdAt: dt.createdAt,
          lastMessageAt: dt.lastMessageAt,
          lastMessageText: dt.lastMessageText || '',
          lastSenderRole: dt.lastSenderRole || 'customer',
          customerReadAt: dt.customerReadAt,
          partnerReadAt: dt.partnerReadAt,
          expireAt: dt.expireAt
        });
      });

      // Also check standard doc paths if not returned by query
      const merchantChatId = `${order.id}_merchant`;
      const riderChatId = order.riderId ? `${order.id}_rider_${order.riderId}` : null;

      const hasMerchantThread = list.some((t) => t.id === merchantChatId || t.channel === 'merchant');
      const hasRiderThread = list.some((t) => t.channel === 'rider');

      // If merchant thread doc exists directly
      if (!hasMerchantThread) {
        try {
          const directMerchantSnap = await getDoc(doc(db, 'orderChats', merchantChatId));
          if (directMerchantSnap.exists()) {
            const dt = directMerchantSnap.data();
            list.push({
              id: directMerchantSnap.id,
              orderId: dt.orderId || order.id,
              orderNumber: dt.orderNumber || order.orderNumber,
              channel: 'merchant',
              customerId: dt.customerId || order.customerId,
              customerName: dt.customerName || (order.customerName ? order.customerName.split(' ')[0] : 'Customer'),
              merchantId: dt.merchantId || order.merchantId,
              merchantName: dt.merchantName || order.merchantName,
              riderId: null,
              riderName: null,
              createdAt: dt.createdAt,
              lastMessageAt: dt.lastMessageAt,
              lastMessageText: dt.lastMessageText || '',
              lastSenderRole: dt.lastSenderRole || 'customer',
              customerReadAt: dt.customerReadAt,
              partnerReadAt: dt.partnerReadAt,
              expireAt: dt.expireAt
            });
          }
        } catch {
          // ignore
        }
      }

      // If rider thread doc exists directly
      if (!hasRiderThread && riderChatId) {
        try {
          const directRiderSnap = await getDoc(doc(db, 'orderChats', riderChatId));
          if (directRiderSnap.exists()) {
            const dt = directRiderSnap.data();
            list.push({
              id: directRiderSnap.id,
              orderId: dt.orderId || order.id,
              orderNumber: dt.orderNumber || order.orderNumber,
              channel: 'rider',
              customerId: dt.customerId || order.customerId,
              customerName: dt.customerName || (order.customerName ? order.customerName.split(' ')[0] : 'Customer'),
              merchantId: null,
              merchantName: null,
              riderId: dt.riderId || order.riderId,
              riderName: dt.riderName || order.riderName,
              createdAt: dt.createdAt,
              lastMessageAt: dt.lastMessageAt,
              lastMessageText: dt.lastMessageText || '',
              lastSenderRole: dt.lastSenderRole || 'customer',
              customerReadAt: dt.customerReadAt,
              partnerReadAt: dt.partnerReadAt,
              expireAt: dt.expireAt
            });
          }
        } catch {
          // ignore
        }
      }

      // Filter out any expired threads (expireAt < now) and delete from Firestore
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
      if (activeList.length > 0) {
        setSelectedThreadId((prev) => (prev && activeList.some((t) => t.id === prev) ? prev : activeList[0].id));
      } else {
        setSelectedThreadId(null);
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
  }, [order.id]);

  // Fetch messages for selected thread
  useEffect(() => {
    if (!selectedThreadId) {
      setMessages([]);
      return;
    }

    const currentThread = threads.find((t) => t.id === selectedThreadId);

    const fetchMessages = async () => {
      try {
        setLoadingMessages(true);
        const msgRef = collection(db, 'orderChats', selectedThreadId, 'chatMessages');
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

        // When the chat screen opens, run cleanup on this opened thread
        cleanupExpiredThreadData([{ id: selectedThreadId, expireAt: currentThread?.expireAt }]).catch(() => {});
      } catch (err: any) {
        showError(err);
      } finally {
        setLoadingMessages(false);
      }
    };

    fetchMessages();
  }, [selectedThreadId, threads]);

  const handleDeleteCurrentChat = async () => {
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

  // If Delivio Instant
  if (isDelivioInstant) {
    return (
      <div className="p-8 text-center bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl space-y-2">
        <MessageSquare className="w-10 h-10 text-gray-300 dark:text-zinc-600 mx-auto" />
        <h4 className="text-sm font-bold text-gray-900 dark:text-white">
          Delivio Instant (Request a Rider) Order
        </h4>
        <p className="text-xs text-gray-500 dark:text-zinc-400 max-w-md mx-auto">
          No chat exists for Delivio Instant orders, because they are merchant point-to-point dispatches with no customer profile.
        </p>
      </div>
    );
  }

  const selectedThread = threads.find((t) => t.id === selectedThreadId);

  return (
    <div className="space-y-4">
      {/* 24h Conversation Deleted Banner */}
      {isExpired24h && (
        <div className="p-4 rounded-2xl bg-zinc-100 dark:bg-zinc-850 border border-zinc-300 dark:border-zinc-700 text-xs text-zinc-700 dark:text-zinc-300 flex items-center gap-2.5">
          <Clock className="w-4 h-4 text-zinc-500 shrink-0" />
          <span>This conversation was deleted after 24 hours.</span>
        </div>
      )}

      {/* Closed Banner */}
      {!isOpen && !isExpired24h && (
        <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-xs text-amber-900 dark:text-amber-200 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
          <span>This chat is closed because the order is complete. Conversation is read-only.</span>
        </div>
      )}

      {/* Thread Selector Tabs */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Customer - Merchant Thread Button */}
        {(() => {
          const mThread = threads.find((t) => t.channel === 'merchant');
          const isSelected = selectedThread?.channel === 'merchant';
          return (
            <button
              type="button"
              onClick={() => mThread && setSelectedThreadId(mThread.id)}
              disabled={!mThread}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-2xl text-xs font-bold border transition-all ${
                isSelected
                  ? 'bg-amber-400 text-black border-amber-500 shadow-xs'
                  : mThread
                  ? 'bg-white dark:bg-zinc-900 border-gray-200 dark:border-zinc-800 text-gray-700 dark:text-zinc-300 hover:border-amber-300'
                  : 'bg-gray-100 dark:bg-zinc-850 border-dashed border-gray-300 dark:border-zinc-700 text-gray-400 opacity-60 cursor-not-allowed'
              }`}
            >
              <Store className="w-3.5 h-3.5 text-amber-600" />
              <span>Customer - Merchant</span>
              {mThread ? (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-black/10 dark:bg-white/10 font-mono">
                  {mThread.lastSenderRole}
                </span>
              ) : (
                <span className="text-[10px] text-gray-400 italic">No messages</span>
              )}
            </button>
          );
        })()}

        {/* Customer - Driver Thread(s) */}
        {(() => {
          const riderThreads = threads.filter((t) => t.channel === 'rider');
          if (riderThreads.length === 0) {
            return (
              <div className="flex items-center gap-2 px-3.5 py-2 rounded-2xl text-xs font-bold border border-dashed border-gray-300 dark:border-zinc-700 bg-gray-100 dark:bg-zinc-850 text-gray-400 opacity-60">
                <Car className="w-3.5 h-3.5 text-emerald-600" />
                <span>Customer - Driver</span>
                <span className="text-[10px] text-gray-400 italic">No messages</span>
              </div>
            );
          }

          return riderThreads.map((rThread, idx) => {
            const isSelected = selectedThread?.id === rThread.id;
            return (
              <button
                key={rThread.id}
                type="button"
                onClick={() => setSelectedThreadId(rThread.id)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-2xl text-xs font-bold border transition-all ${
                  isSelected
                    ? 'bg-amber-400 text-black border-amber-500 shadow-xs'
                    : 'bg-white dark:bg-zinc-900 border-gray-200 dark:border-zinc-800 text-gray-700 dark:text-zinc-300 hover:border-amber-300'
                }`}
              >
                <Car className="w-3.5 h-3.5 text-emerald-600" />
                <span>
                  Customer - {rThread.riderName || (riderThreads.length > 1 ? `Driver #${idx + 1}` : 'Driver')}
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-black/10 dark:bg-white/10 font-mono">
                  {rThread.lastSenderRole}
                </span>
              </button>
            );
          });
        })()}
      </div>

      {/* Main Conversation Container */}
      {loading ? (
        <div className="p-12 text-center bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl">
          <Loader2 className="w-6 h-6 animate-spin text-amber-500 mx-auto mb-2" />
          <p className="text-xs text-gray-500">Loading order conversations...</p>
        </div>
      ) : !selectedThread ? (
        <div className="p-10 text-center bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl space-y-2">
          <MessageSquare className="w-8 h-8 text-gray-300 dark:text-zinc-600 mx-auto" />
          <h4 className="text-xs font-bold text-gray-800 dark:text-zinc-200">
            No active chat thread yet
          </h4>
          <p className="text-[11px] text-gray-500 max-w-sm mx-auto">
            When the customer, merchant, or assigned driver exchange in-app messages regarding Order #{order.orderNumber}, the live message log will appear here.
          </p>
        </div>
      ) : (
        <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl shadow-xs overflow-hidden flex flex-col">
          {/* Thread Header */}
          <div className="p-4 border-b border-gray-100 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-3 bg-gray-50/70 dark:bg-zinc-850/60">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-amber-400 text-black">
                {selectedThread.channel === 'merchant' ? (
                  <Store className="w-4 h-4" />
                ) : (
                  <Car className="w-4 h-4" />
                )}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-extrabold text-sm text-gray-900 dark:text-white">
                    {selectedThread.channel === 'merchant'
                      ? `Customer (${selectedThread.customerName || 'Customer'}) ↔ Merchant (${selectedThread.merchantName || 'Store'})`
                      : `Customer (${selectedThread.customerName || 'Customer'}) ↔ Driver (${selectedThread.riderName || 'Rider'})`}
                  </span>

                  {/* Open / Closed Chip */}
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                      isOpen
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800'
                        : 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                    }`}
                  >
                    {isOpen ? 'Open' : 'Closed'}
                  </span>
                </div>

                <div className="flex items-center gap-3 text-[11px] text-gray-500 dark:text-zinc-400 mt-0.5">
                  <span className="font-mono">Thread ID: {selectedThread.id}</span>
                  <span>•</span>
                  <span className="font-medium text-amber-600 dark:text-amber-400">
                    Deletes on {formatExpireAtDate(selectedThread.expireAt)}
                  </span>
                </div>
              </div>
            </div>

            {/* Admin Delete Chat Thread button */}
            {isFullAdmin && (
              <button
                type="button"
                onClick={() => {
                  setThreadToDelete(selectedThread);
                  setDeleteModalOpen(true);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-rose-300 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400 text-xs font-bold hover:bg-rose-100 transition-colors"
                title="Full admin only: permanently delete this conversation"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete this chat</span>
              </button>
            )}
          </div>

          {/* Messages Stream */}
          <div className="p-4 space-y-3 min-h-[220px] max-h-[380px] overflow-y-auto bg-gray-50/30 dark:bg-zinc-950/30">
            {loadingMessages ? (
              <div className="p-8 text-center">
                <Loader2 className="w-5 h-5 animate-spin text-amber-500 mx-auto mb-1" />
                <span className="text-xs text-gray-400">Loading messages...</span>
              </div>
            ) : messages.length === 0 ? (
              <div className="p-8 text-center text-xs text-gray-400">
                No messages recorded in this thread yet.
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
                    {/* Sender Role Label */}
                    <div className="flex items-center gap-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider px-1">
                      {isCustomer && <User className="w-3 h-3 text-blue-500" />}
                      {isMerchant && <Store className="w-3 h-3 text-amber-500" />}
                      {isRider && <Car className="w-3 h-3 text-emerald-500" />}
                      <span>
                        {isCustomer
                          ? `Customer (${selectedThread.customerName || 'Customer'})`
                          : isMerchant
                          ? `Merchant (${selectedThread.merchantName || 'Store'})`
                          : `Driver (${selectedThread.riderName || 'Rider'})`}
                      </span>
                      <span>•</span>
                      <span>{formatMessageTime(m.createdAt)}</span>
                    </div>

                    {/* Bubble Content: Text or Image */}
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
                              className="max-h-48 w-auto rounded-xl object-cover"
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

          {/* Read-Only Notice at Bottom */}
          <div className="p-3 border-t border-gray-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-center text-[11px] text-gray-400 flex items-center justify-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-amber-500" />
            <span>Admin Oversight Mode (Read-Only) • Real-time synchronization active</span>
          </div>
        </div>
      )}

      {/* Image Lightbox Modal */}
      <ImageLightboxModal
        imageUrl={zoomImage}
        onClose={() => setZoomImage(null)}
        title={`Order #${order.orderNumber} Attachment`}
      />

      {/* Delete Chat Confirmation Modal */}
      {deleteModalOpen && threadToDelete && (
        <ConfirmationModal
          isOpen={deleteModalOpen}
          onClose={() => {
            setDeleteModalOpen(false);
            setThreadToDelete(null);
          }}
          onConfirm={handleDeleteCurrentChat}
          title={`Delete Chat Thread "${threadToDelete.id}"?`}
          message={`Are you sure you want to permanently delete this chat thread and all its messages? This action cannot be undone and will be logged in audit records.`}
          confirmLabel="Delete Chat Permanently"
          reasonRequired={false}
          isDestructive={true}
        />
      )}
    </div>
  );
};
