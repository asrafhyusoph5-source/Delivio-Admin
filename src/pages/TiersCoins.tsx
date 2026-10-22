import React, { useState, useEffect } from 'react';
import {
  db,
  collection,
  query,
  limit,
  getDocs,
  doc,
  setDoc,
  updateDoc,
  increment,
  writeBatch,
  where,
  Timestamp
} from '../firebase';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { logAuditEvent } from '../utils/audit';
import { formatTimestamp, formatRelativeTime } from '../utils/date';
import type { TierConfig, TierEvent, Rider } from '../types';
import {
  Award,
  Coins,
  CheckCircle2,
  Clock,
  Edit,
  Save,
  Loader2,
  User,
  Shield,
  Sparkles,
  ArrowRight
} from 'lucide-react';
import { ConfirmationModal } from '../components/common/ConfirmationModal';

export const TiersCoins: React.FC = () => {
  const { adminProfile } = useAuth();
  const { showSuccess, showError } = useToast();

  const [tierConfigs, setTierConfigs] = useState<TierConfig[]>([]);
  const [pendingTierEvents, setPendingTierEvents] = useState<TierEvent[]>([]);
  const [creditedTierEvents, setCreditedTierEvents] = useState<TierEvent[]>([]);
  const [loading, setLoading] = useState(true);

  // Editing Tier Modal
  const [editingTier, setEditingTier] = useState<TierConfig | null>(null);
  const [tierName, setTierName] = useState('');
  const [ridesRequired, setRidesRequired] = useState<number>(500);
  const [coinsReward, setCoinsReward] = useState<number>(200);
  const [savingTier, setSavingTier] = useState(false);

  // Credit coin execution
  const [creditingEvent, setCreditingEvent] = useState<TierEvent | null>(null);
  const [confirmCreditModal, setConfirmCreditModal] = useState(false);
  const [processingCredit, setProcessingCredit] = useState(false);

  // Fetch TierConfig and TierEvents
  const fetchData = async () => {
    try {
      setLoading(true);
      // TierConfig
      const tcSnap = await getDocs(collection(db, 'tierConfig'));
      const tcList: TierConfig[] = [];
      tcSnap.forEach((d) => {
        const dt = d.data();
        tcList.push({
          id: d.id,
          name: dt.name || d.id,
          ridesRequired: Number(dt.ridesRequired) || 0,
          coins: Number(dt.coins) || 0,
          sortOrder: Number(dt.sortOrder) || 0
        });
      });
      tcList.sort((a, b) => a.sortOrder - b.sortOrder);
      setTierConfigs(tcList);

      // TierEvents
      const teSnap = await getDocs(query(collection(db, 'tierEvents'), limit(150)));
      const pending: TierEvent[] = [];
      const credited: TierEvent[] = [];

      teSnap.forEach((d) => {
        const dt = d.data();
        const ev: TierEvent = {
          id: d.id,
          riderId: dt.riderId,
          riderName: dt.riderName || 'Rider',
          riderCode: dt.riderCode,
          tier: dt.tier,
          coins: Number(dt.coins) || 0,
          month: dt.month,
          status: dt.status || 'Pending',
          creditedAt: dt.creditedAt,
          createdAt: dt.createdAt
        };
        if (ev.status === 'Pending') pending.push(ev);
        else credited.push(ev);
      });

      pending.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      credited.sort((a, b) => (b.creditedAt?.seconds || 0) - (a.creditedAt?.seconds || 0));

      setPendingTierEvents(pending);
      setCreditedTierEvents(credited);
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Save TierConfig
  const handleSaveTierConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTier) return;
    try {
      setSavingTier(true);
      const tcRef = doc(db, 'tierConfig', editingTier.id);
      const updates = {
        name: tierName.trim(),
        ridesRequired: Number(ridesRequired),
        coins: Number(coinsReward)
      };

      await updateDoc(tcRef, updates);

      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        action: 'EDIT_TIER_CONFIG',
        entityType: 'tierConfig',
        entityId: editingTier.id,
        details: `Updated tier ${tierName}: ${ridesRequired} rides, ${coinsReward} coins`
      });

      showSuccess(`Tier ${tierName} configuration updated.`);
      setEditingTier(null);
      fetchData();
    } catch (err: any) {
      showError(err);
    } finally {
      setSavingTier(false);
    }
  };

  // "Credit coins" runs one batch:
  // increment riders.coins, create a coinTransactions document {riderId, amount, type "tier_reward", reason, adminId, createdAt},
  // set the tierEvent status "Credited" with creditedAt, and mark matching adminNotifications read.
  const handleCreditCoinsBatch = async () => {
    if (!creditingEvent) return;
    try {
      setProcessingCredit(true);
      const batch = writeBatch(db);
      const now = Timestamp.now();

      // 1. increment riders.coins
      const riderRef = doc(db, 'riders', creditingEvent.riderId);
      batch.update(riderRef, {
        coins: increment(creditingEvent.coins)
      });

      // 2. create coinTransactions doc
      const coinTxnCol = collection(db, 'coinTransactions');
      const newTxnRef = doc(coinTxnCol);
      batch.set(newTxnRef, {
        riderId: creditingEvent.riderId,
        amount: creditingEvent.coins,
        type: 'tier_reward',
        reason: `${creditingEvent.tier} Tier Milestone Reward (${creditingEvent.month})`,
        adminId: adminProfile?.uid || 'admin',
        createdAt: now
      });

      // 3. set tierEvent status "Credited" with creditedAt
      const eventRef = doc(db, 'tierEvents', creditingEvent.id);
      batch.update(eventRef, {
        status: 'Credited',
        creditedAt: now,
        creditedBy: adminProfile?.name || 'Administrator'
      });

      // 4. mark matching adminNotifications as read
      const notifsSnap = await getDocs(
        query(
          collection(db, 'adminNotifications'),
          where('riderId', '==', creditingEvent.riderId),
          limit(20)
        )
      );
      notifsSnap.forEach((nDoc) => {
        const nd = nDoc.data();
        if (nd.type === 'tier_reached' && !nd.read) {
          batch.update(nDoc.ref, { read: true });
        }
      });

      await batch.commit();

      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        action: 'CREDIT_TIER_COINS',
        entityType: 'tierEvent',
        entityId: creditingEvent.id,
        details: `Credited ${creditingEvent.coins} coins to rider ${creditingEvent.riderName} for tier ${creditingEvent.tier}`
      });

      showSuccess(`Successfully credited ${creditingEvent.coins} coins to ${creditingEvent.riderName}!`);
      setConfirmCreditModal(false);
      setCreditingEvent(null);
      fetchData();
    } catch (err: any) {
      showError(err);
    } finally {
      setProcessingCredit(false);
    }
  };

  const getTierColor = (tier: string) => {
    switch (tier?.toLowerCase()) {
      case 'platinum':
        return 'from-cyan-500 to-blue-600 text-white';
      case 'gold':
        return 'from-amber-400 to-amber-600 text-black';
      case 'silver':
        return 'from-gray-300 to-gray-500 text-white';
      default:
        return 'from-amber-700 to-amber-900 text-white'; // Bronze
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">
          Rider Tiers & Coin Rewards
        </h1>
        <p className="text-sm text-gray-500 dark:text-zinc-400 mt-0.5">
          Configure tier qualifications and approve pending loyalty reward distributions.
        </p>
      </div>

      {/* Tier Configurations Cards */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-bold uppercase tracking-wider text-gray-400">
            Platform Tier Levels
          </span>
          <span className="text-xs text-gray-400">
            Rider level thresholds & milestone coin rewards
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {tierConfigs.map((tc) => (
            <div
              key={tc.id}
              className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-5 shadow-xs flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div
                    className={`px-3 py-1 rounded-xl text-xs font-black uppercase tracking-wider bg-gradient-to-r ${getTierColor(
                      tc.id
                    )} shadow-xs`}
                  >
                    {tc.name}
                  </div>
                  <button
                    onClick={() => {
                      setEditingTier(tc);
                      setTierName(tc.name);
                      setRidesRequired(tc.ridesRequired);
                      setCoinsReward(tc.coins);
                    }}
                    className="p-1.5 text-gray-400 hover:text-amber-600 rounded-lg"
                    title="Edit tier rules"
                  >
                    <Edit className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-1 my-3">
                  <div className="text-2xl font-black text-gray-900 dark:text-white">
                    {tc.ridesRequired}{' '}
                    <span className="text-xs font-semibold text-gray-400">rides/mo</span>
                  </div>
                  <div className="text-xs font-bold text-amber-600 flex items-center gap-1">
                    <Coins className="w-3.5 h-3.5" />
                    <span>+{tc.coins} Coins Bonus</span>
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-gray-100 dark:border-zinc-800 text-[11px] text-gray-400">
                Tier ID: <span className="font-mono">{tc.id}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Pending Rewards Queue */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-6 shadow-xs space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-gray-100 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <Award className="w-5 h-5 text-amber-500" />
            <h3 className="font-extrabold text-base text-gray-900 dark:text-white">
              Pending Tier Event Approvals
            </h3>
            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800">
              {pendingTierEvents.length} awaiting credit
            </span>
          </div>
        </div>

        <div className="space-y-3">
          {pendingTierEvents.length === 0 ? (
            <div className="p-8 text-center text-xs text-gray-400">
              No pending tier events. All qualified rider coin rewards have been credited.
            </div>
          ) : (
            pendingTierEvents.map((ev) => (
              <div
                key={ev.id}
                className="p-4 rounded-2xl border border-amber-200 dark:border-zinc-800 bg-amber-50/50 dark:bg-zinc-850 flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between shadow-xs"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="font-bold text-sm text-gray-900 dark:text-white">
                      {ev.riderName}
                    </h4>
                    {ev.riderCode && (
                      <span className="text-xs font-mono text-gray-400">({ev.riderCode})</span>
                    )}
                    <span className="capitalize px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-200 text-amber-900">
                      {ev.tier} Tier
                    </span>
                  </div>

                  <p className="text-xs text-gray-600 dark:text-zinc-300 mt-1">
                    Achieved in <strong>{ev.month}</strong> • Milestone Award:{' '}
                    <strong className="text-amber-600 font-extrabold">{ev.coins} Coins</strong>
                  </p>
                  <span className="text-[10px] text-gray-400 mt-1 block">
                    Logged {formatTimestamp(ev.createdAt)}
                  </span>
                </div>

                <button
                  onClick={() => {
                    setCreditingEvent(ev);
                    setConfirmCreditModal(true);
                  }}
                  className="delivio-btn-yellow px-5 py-2 rounded-xl text-xs font-black shadow-xs flex items-center gap-1.5 self-end sm:self-auto"
                >
                  <Sparkles className="w-3.5 h-3.5" /> Credit Coins Now
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Credited History Log */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-6 shadow-xs">
        <h3 className="font-bold text-base text-gray-900 dark:text-white mb-3">
          Recently Credited Tier Rewards
        </h3>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-50 dark:bg-zinc-850 uppercase font-bold text-gray-400 border-b border-gray-200 dark:border-zinc-800">
              <tr>
                <th className="px-4 py-3">Rider</th>
                <th className="px-4 py-3">Tier</th>
                <th className="px-4 py-3">Coins Awarded</th>
                <th className="px-4 py-3">Period</th>
                <th className="px-4 py-3">Credited On</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
              {creditedTierEvents.slice(0, 15).map((ev) => (
                <tr key={ev.id}>
                  <td className="px-4 py-3 font-semibold text-gray-900 dark:text-white">
                    {ev.riderName}
                  </td>
                  <td className="px-4 py-3 uppercase font-bold text-amber-600">{ev.tier}</td>
                  <td className="px-4 py-3 font-bold text-emerald-600">+{ev.coins}</td>
                  <td className="px-4 py-3 text-gray-500">{ev.month}</td>
                  <td className="px-4 py-3 text-gray-400">{formatTimestamp(ev.creditedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Tier Config Modal */}
      {editingTier && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-sm bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-6 shadow-2xl">
            <h3 className="font-bold text-base text-gray-900 dark:text-white mb-4">
              Edit Tier: {editingTier.name}
            </h3>

            <form onSubmit={handleSaveTierConfig} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Tier Display Name
                </label>
                <input
                  type="text"
                  value={tierName}
                  onChange={(e) => setTierName(e.target.value)}
                  required
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Rides Required per Month
                </label>
                <input
                  type="number"
                  min="1"
                  value={ridesRequired}
                  onChange={(e) => setRidesRequired(Number(e.target.value))}
                  required
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 font-bold"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Coin Reward Allocation
                </label>
                <input
                  type="number"
                  min="0"
                  value={coinsReward}
                  onChange={(e) => setCoinsReward(Number(e.target.value))}
                  required
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 font-bold text-amber-600"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingTier(null)}
                  className="px-4 py-2 text-xs font-bold text-gray-600 hover:bg-gray-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingTier}
                  className="delivio-btn-yellow px-5 py-2 text-xs font-bold rounded-xl flex items-center gap-1.5"
                >
                  {savingTier && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Save Tier Rules
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Credit Coins Confirmation Modal */}
      {confirmCreditModal && creditingEvent && (
        <ConfirmationModal
          isOpen={confirmCreditModal}
          onClose={() => setConfirmCreditModal(false)}
          onConfirm={handleCreditCoinsBatch}
          title={`Credit ${creditingEvent.coins} Coins to ${creditingEvent.riderName}?`}
          message={`This runs an atomic batch write to increment the rider's coins balance, record the coin transaction, update the tier milestone status, and mark notifications as resolved.`}
          confirmLabel="Execute Credit Batch"
          reasonRequired={false}
          isDestructive={false}
        />
      )}
    </div>
  );
};
