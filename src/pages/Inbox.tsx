import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  db,
  collection,
  query,
  limit,
  getDocs,
  addDoc,
  Timestamp
} from '../firebase';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { logAuditEvent } from '../utils/audit';
import { formatTimestamp, formatRelativeTime } from '../utils/date';
import type { Rider } from '../types';
import {
  Mail,
  Send,
  Users,
  User,
  ShieldAlert,
  Tag,
  AlertCircle,
  Bell,
  CheckCircle2,
  Loader2,
  Inbox as InboxIcon
} from 'lucide-react';

export const Inbox: React.FC = () => {
  const [searchParams] = useSearchParams();
  const preselectedRiderId = searchParams.get('riderId') || '';

  const { adminProfile } = useAuth();
  const { showSuccess, showError } = useToast();

  const [audience, setAudience] = useState<'all_riders' | 'single_rider'>(
    preselectedRiderId ? 'single_rider' : 'all_riders'
  );
  const [selectedRiderId, setSelectedRiderId] = useState(preselectedRiderId);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState<'admin' | 'order' | 'promo' | 'safety' | 'system'>('admin');
  const [sending, setSending] = useState(false);

  const [riders, setRiders] = useState<Rider[]>([]);
  const [sentMessages, setSentMessages] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  // Fetch Riders & Sent Messages
  const fetchData = async () => {
    try {
      setLoadingHistory(true);
      // Riders
      const rSnap = await getDocs(query(collection(db, 'riders'), limit(150)));
      const rList: Rider[] = [];
      rSnap.forEach((d) => rList.push({ id: d.id, ...d.data() } as Rider));
      rList.sort((a, b) => a.name.localeCompare(b.name));
      setRiders(rList);

      // Sent inbox messages
      const iSnap = await getDocs(query(collection(db, 'inbox'), limit(100)));
      const iList: any[] = [];
      iSnap.forEach((d) => iList.push({ id: d.id, ...d.data() }));
      iList.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setSentMessages(iList);
    } catch (err) {
      showError(err);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !body.trim()) return;
    if (audience === 'single_rider' && !selectedRiderId) {
      showError('Please select a target rider');
      return;
    }

    try {
      setSending(true);
      const targetRider = riders.find((r) => r.id === selectedRiderId);

      const payload = {
        audience,
        riderId: audience === 'single_rider' ? selectedRiderId : null,
        riderName: audience === 'single_rider' ? targetRider?.name || 'Rider' : 'All Fleet Riders',
        title: title.trim(),
        body: body.trim(),
        category,
        sentBy: adminProfile?.name || 'Administrator',
        sentById: adminProfile?.uid,
        createdAt: Timestamp.now()
      };

      const inboxCol = collection(db, 'inbox');
      await addDoc(inboxCol, payload);

      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        action: 'SEND_INBOX_BROADCAST',
        entityType: 'inbox',
        entityId: audience,
        details: `Sent ${category} message "${title}" to ${audience === 'all_riders' ? 'All Riders' : targetRider?.name}`
      });

      showSuccess(`Message dispatched to ${audience === 'all_riders' ? 'all riders' : targetRider?.name}.`);
      setTitle('');
      setBody('');
      fetchData();
    } catch (err: any) {
      showError(err);
    } finally {
      setSending(false);
    }
  };

  const getCategoryBadge = (cat: string) => {
    switch (cat) {
      case 'safety':
        return 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300';
      case 'promo':
        return 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300';
      case 'order':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300';
      default:
        return 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">
          Fleet Dispatcher Inbox
        </h1>
        <p className="text-sm text-gray-500 dark:text-zinc-400 mt-0.5">
          Broadcast push alerts, weather advisories, schedule bonuses, and direct communications to riders.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Compose Form */}
        <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-6 shadow-xs space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <Mail className="w-5 h-5 text-amber-500" />
            <h3 className="font-extrabold text-base text-gray-900 dark:text-white">
              Compose Announcement
            </h3>
          </div>

          <form onSubmit={handleSendMessage} className="space-y-4">
            {/* Audience selection */}
            <div>
              <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1.5">
                Target Audience
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setAudience('all_riders')}
                  className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all flex items-center justify-center gap-1.5 ${
                    audience === 'all_riders'
                      ? 'delivio-btn-yellow border-amber-500'
                      : 'bg-gray-50 dark:bg-zinc-800 border-gray-200'
                  }`}
                >
                  <Users className="w-4 h-4" /> All Active Riders
                </button>
                <button
                  type="button"
                  onClick={() => setAudience('single_rider')}
                  className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all flex items-center justify-center gap-1.5 ${
                    audience === 'single_rider'
                      ? 'delivio-btn-yellow border-amber-500'
                      : 'bg-gray-50 dark:bg-zinc-800 border-gray-200'
                  }`}
                >
                  <User className="w-4 h-4" /> Specific Rider
                </button>
              </div>
            </div>

            {/* If single rider, rider picker */}
            {audience === 'single_rider' && (
              <div>
                <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Select Target Rider
                </label>
                <select
                  value={selectedRiderId}
                  onChange={(e) => setSelectedRiderId(e.target.value)}
                  required
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                >
                  <option value="">-- Choose Rider --</option>
                  {riders.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.riderCode}) - {r.phone}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Category */}
            <div>
              <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                Category
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as any)}
                className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
              >
                <option value="admin">Admin Notice</option>
                <option value="order">Order Coordination</option>
                <option value="promo">Promo & Incentives</option>
                <option value="safety">Safety / Weather Warning</option>
                <option value="system">System Notification</option>
              </select>
            </div>

            {/* Title */}
            <div>
              <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                Title
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                placeholder="e.g. Heavy Rain Alert / Peak Incentives Active"
                className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-gray-900 dark:text-white"
              />
            </div>

            {/* Body */}
            <div>
              <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                Message Body
              </label>
              <textarea
                rows={4}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                required
                placeholder="Type instructions, precautions, or announcement message..."
                className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-gray-900 dark:text-white"
              />
            </div>

            <button
              type="submit"
              disabled={sending}
              className="w-full delivio-btn-yellow py-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-md shadow-amber-400/20 disabled:opacity-50"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Dispatch Message
            </button>
          </form>
        </div>

        {/* Sent Messages History */}
        <div className="lg:col-span-2 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-6 shadow-xs flex flex-col">
          <div className="flex items-center justify-between pb-3 mb-4 border-b border-gray-100 dark:border-zinc-800">
            <h3 className="font-extrabold text-base text-gray-900 dark:text-white flex items-center gap-2">
              <InboxIcon className="w-5 h-5 text-amber-500" />
              Dispatched Broadcast Log
            </h3>
            <span className="text-xs text-gray-400">{sentMessages.length} messages sent</span>
          </div>

          <div className="flex-1 overflow-y-auto space-y-3 max-h-[600px] pr-1">
            {sentMessages.length === 0 ? (
              <div className="p-12 text-center text-xs text-gray-400">
                No fleet messages sent yet.
              </div>
            ) : (
              sentMessages.map((msg) => (
                <div
                  key={msg.id}
                  className="p-4 rounded-2xl border border-gray-100 dark:border-zinc-800 bg-gray-50/70 dark:bg-zinc-850/60 text-xs space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className={`capitalize px-2 py-0.5 rounded-md text-[10px] font-bold ${getCategoryBadge(
                          msg.category
                        )}`}
                      >
                        {msg.category}
                      </span>
                      <h4 className="font-bold text-gray-900 dark:text-white text-sm">
                        {msg.title}
                      </h4>
                    </div>
                    <span className="text-gray-400 text-[10px]">
                      {formatRelativeTime(msg.createdAt)}
                    </span>
                  </div>

                  <p className="text-gray-700 dark:text-zinc-300 leading-relaxed whitespace-pre-wrap">
                    {msg.body}
                  </p>

                  <div className="flex items-center justify-between pt-2 border-t border-gray-200/60 dark:border-zinc-800 text-[11px] text-gray-400">
                    <span>
                      To: <strong>{msg.riderName || 'All Riders'}</strong>
                    </span>
                    <span>Sent by: {msg.sentBy || 'Admin'}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
