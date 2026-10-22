import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  db,
  collection,
  query,
  limit,
  getDocs,
  doc,
  updateDoc,
  writeBatch
} from '../firebase';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { formatTimestamp, formatRelativeTime } from '../utils/date';
import type { AdminNotification } from '../types';
import {
  Bell,
  ShieldAlert,
  Award,
  AlertTriangle,
  Check,
  CheckCheck,
  ExternalLink,
  Bike,
  ShoppingBag,
  Filter
} from 'lucide-react';

export const Notifications: React.FC = () => {
  const { adminProfile } = useAuth();
  const { showSuccess, showError } = useToast();
  const navigate = useNavigate();

  const [notifications, setNotifications] = useState<AdminNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<string>('all');

  const fetchNotifications = async () => {
    try {
      setLoading(true);
      const q = query(collection(db, 'adminNotifications'), limit(150));
      const snap = await getDocs(q);
      const list: AdminNotification[] = [];
      snap.forEach((d) => {
        const dt = d.data();
        list.push({
          id: d.id,
          type: dt.type || 'general',
          title: dt.title || 'Notification',
          message: dt.message || '',
          orderId: dt.orderId,
          riderId: dt.riderId,
          merchantId: dt.merchantId,
          read: Boolean(dt.read),
          createdAt: dt.createdAt
        });
      });
      list.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setNotifications(list);
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotifications();
  }, []);

  const markAsRead = async (id: string) => {
    try {
      await updateDoc(doc(db, 'adminNotifications', id), { read: true });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n))
      );
      showSuccess('Marked as read');
    } catch (err) {
      showError(err);
    }
  };

  const markAllAsRead = async () => {
    try {
      const unread = notifications.filter((n) => !n.read);
      if (!unread.length) return;

      const batch = writeBatch(db);
      unread.forEach((n) => {
        batch.update(doc(db, 'adminNotifications', n.id), { read: true });
      });
      await batch.commit();

      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      showSuccess('All notifications marked as read.');
    } catch (err) {
      showError(err);
    }
  };

  const filtered = notifications.filter((n) => {
    if (filterType === 'all') return true;
    if (filterType === 'unread') return !n.read;
    return n.type === filterType;
  });

  const getIcon = (type: string) => {
    switch (type) {
      case 'sos':
      case 'incident':
        return <ShieldAlert className="w-5 h-5 text-red-500" />;
      case 'tier_reached':
        return <Award className="w-5 h-5 text-amber-500" />;
      default:
        return <AlertTriangle className="w-5 h-5 text-blue-500" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">
            Notifications Center
          </h1>
          <p className="text-sm text-gray-500 dark:text-zinc-400 mt-0.5">
            Emergency SOS triggers, rider incidents, and automated milestone alerts.
          </p>
        </div>

        <button
          onClick={markAllAsRead}
          className="flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs font-bold text-gray-700 dark:text-zinc-300 hover:bg-gray-50 shadow-xs self-start sm:self-auto"
        >
          <CheckCheck className="w-4 h-4 text-emerald-500" />
          <span>Mark All Read</span>
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {['all', 'unread', 'sos', 'incident', 'tier_reached', 'general'].map((f) => (
          <button
            key={f}
            onClick={() => setFilterType(f)}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${
              filterType === f
                ? 'bg-amber-400 text-black shadow-xs font-black'
                : 'bg-white dark:bg-zinc-900 text-gray-600 dark:text-zinc-400 border border-gray-200 dark:border-zinc-800'
            }`}
          >
            {f.replace('_', ' ')}
          </button>
        ))}
      </div>

      {/* Notifications List */}
      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="p-12 text-center bg-white dark:bg-zinc-900 border border-dashed border-gray-200 dark:border-zinc-800 rounded-3xl">
            <Bell className="w-10 h-10 text-gray-300 mx-auto mb-2" />
            <h4 className="font-bold text-gray-900 dark:text-white text-sm">
              No notifications matching filter
            </h4>
          </div>
        ) : (
          filtered.map((item) => (
            <div
              key={item.id}
              className={`p-5 rounded-2xl border transition-all flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between ${
                item.read
                  ? 'bg-white dark:bg-zinc-900 border-gray-200 dark:border-zinc-800 opacity-80'
                  : 'bg-amber-50/60 dark:bg-zinc-850 border-amber-300 dark:border-amber-900/60 shadow-xs'
              }`}
            >
              <div className="flex items-start gap-3.5">
                <div className="p-2.5 rounded-xl bg-gray-100 dark:bg-zinc-800 shrink-0 mt-0.5">
                  {getIcon(item.type)}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="font-bold text-sm text-gray-900 dark:text-white">
                      {item.title}
                    </h4>
                    {!item.read && (
                      <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                    )}
                    <span className="capitalize text-[10px] uppercase font-bold text-gray-400">
                      {item.type.replace('_', ' ')}
                    </span>
                  </div>

                  <p className="text-xs text-gray-600 dark:text-zinc-300 mt-1 max-w-xl">
                    {item.message}
                  </p>

                  <div className="flex items-center gap-4 mt-2 text-[11px] text-gray-400">
                    <span>{formatRelativeTime(item.createdAt)}</span>
                    {item.orderId && (
                      <button
                        onClick={() => navigate(`/orders?search=${item.orderId}`)}
                        className="text-amber-600 dark:text-amber-400 font-bold hover:underline flex items-center gap-1"
                      >
                        <ShoppingBag className="w-3 h-3" /> View Order
                      </button>
                    )}
                    {item.riderId && (
                      <button
                        onClick={() => navigate(`/riders?search=${item.riderId}`)}
                        className="text-amber-600 dark:text-amber-400 font-bold hover:underline flex items-center gap-1"
                      >
                        <Bike className="w-3 h-3" /> View Rider
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {!item.read && (
                <button
                  onClick={() => markAsRead(item.id)}
                  className="px-3 py-1.5 rounded-xl border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold text-gray-700 dark:text-zinc-200 hover:bg-gray-100 flex items-center gap-1 self-end sm:self-auto shrink-0"
                >
                  <Check className="w-3.5 h-3.5" /> Mark Read
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
