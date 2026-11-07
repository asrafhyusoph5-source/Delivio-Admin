import React, { useState, useEffect, useMemo } from 'react';
import {
  db,
  collection,
  query,
  where,
  limit,
  getDocs,
  getDoc,
  doc,
  setDoc,
  updateDoc,
  Timestamp,
  runTransaction
} from '../firebase';
import { useAuth } from '../context/AuthContext';
import { useCity } from '../context/CityContext';
import { useToast } from '../context/ToastContext';
import { logAuditEvent } from '../utils/audit';
import type {
  Quest,
  QuestGoal,
  QuestClaim,
  QuestMetric,
  QuestStatus,
  QuestClaimStatus,
  OrderServiceType,
  Rider
} from '../types';
import {
  Trophy,
  Plus,
  Edit,
  Trash2,
  Copy,
  Clock,
  Calendar,
  DollarSign,
  TrendingUp,
  Search,
  RefreshCw,
  Loader2,
  X,
  Award,
  Zap,
  Users,
  Layers,
  Sparkles,
  RotateCw
} from 'lucide-react';
import { ConfirmationModal } from '../components/common/ConfirmationModal';
import { TableSkeleton } from '../components/common/SkeletonLoader';
import { ALL_SERVICES } from '../constants';

const SERVICE_LABEL_MAP: Record<string, string> = {
  food: 'Delivio Food',
  convenience: 'Delivio Mart',
  parcel: 'Delivio Parcel',
  pabili: 'Delivio Pabili',
  request_rider: 'Delivio Instant',
  taxi: 'Delivio Taxi'
};

// Format Date in Philippine Time (Asia/Manila UTC+8)
export const formatPHT = (ts: any): string => {
  if (!ts) return 'N/A';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  if (isNaN(d.getTime())) return 'N/A';
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(d);
};

export const formatPHTDateOnly = (ts: any): string => {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  if (isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
};

// Create Date from Philippine YYYY-MM-DD and HH:mm
export const makePHTDate = (dateStr: string, timeStr: string = '00:00'): Date => {
  return new Date(`${dateStr}T${timeStr}:00+08:00`);
};

// Check if a timestamp falls within a Philippine daily hour window "HH:mm"
export const isWithinPHTHours = (date: Date, hourFrom?: string, hourTo?: string): boolean => {
  if (!hourFrom || !hourTo) return true;
  const parts = new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date);
  const hour = parts.find((p) => p.type === 'hour')?.value || '00';
  const minute = parts.find((p) => p.type === 'minute')?.value || '00';
  const curTime = `${hour}:${minute}`;
  return curTime >= hourFrom && curTime <= hourTo;
};

export const Quests: React.FC = () => {
  const { adminProfile } = useAuth();
  const { selectedCityId } = useCity();
  const { showSuccess, showError } = useToast();

  const [activeTab, setActiveTab] = useState<'quests' | 'claims'>('quests');

  // Quests state
  const [quests, setQuests] = useState<Quest[]>([]);
  const [loadingQuests, setLoadingQuests] = useState(true);
  const [questSearch, setQuestSearch] = useState('');
  const [questStatusFilter, setQuestStatusFilter] = useState<'all' | QuestStatus>('all');

  // Claims state
  const [claims, setClaims] = useState<QuestClaim[]>([]);
  const [loadingClaims, setLoadingClaims] = useState(true);
  const [claimStatusFilter, setClaimStatusFilter] = useState<'all' | QuestClaimStatus>('all');
  const [claimQuestFilter, setClaimQuestFilter] = useState<string>('all');
  const [claimSearch, setClaimSearch] = useState('');

  // Auto-settle toggle & interval
  const [autoSettleEnabled, setAutoSettleEnabled] = useState(true);
  const [autoSettling, setAutoSettling] = useState(false);
  const [lastAutoSettleTime, setLastAutoSettleTime] = useState<Date | null>(null);

  // Scanning state
  const [scanningRiders, setScanningRiders] = useState(false);

  // Quest Form Modal
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingQuestId, setEditingQuestId] = useState<string | null>(null);
  const [isSubmittingQuest, setIsSubmittingQuest] = useState(false);

  // Quest Form fields
  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formStatus, setFormStatus] = useState<QuestStatus>('active');
  const [formMetric, setFormMetric] = useState<QuestMetric>('deliveries');
  const [formStartDate, setFormStartDate] = useState('');
  const [formStartTime, setFormStartTime] = useState('00:00');
  const [formEndDate, setFormEndDate] = useState('');
  const [formEndTime, setFormEndTime] = useState('23:59');
  const [formHourFrom, setFormHourFrom] = useState('');
  const [formHourTo, setFormHourTo] = useState('');
  const [formServices, setFormServices] = useState<OrderServiceType[]>([]);
  const [formCityIds, setFormCityIds] = useState<string[]>([]);
  const [formVehicleTypes, setFormVehicleTypes] = useState<string[]>([]);
  const [formMinAcceptanceRate, setFormMinAcceptanceRate] = useState<string>('');
  const [formMaxNoShows, setFormMaxNoShows] = useState<string>('');
  const [formGoals, setFormGoals] = useState<QuestGoal[]>([
    { target: 15, reward: 50 },
    { target: 18, reward: 75 },
    { target: 21, reward: 110 }
  ]);

  // Multi-day creation mode
  const [isMultiDay, setIsMultiDay] = useState(false);
  const [multiDayStartDate, setMultiDayStartDate] = useState('');
  const [multiDayEndDate, setMultiDayEndDate] = useState('');

  // Confirmation Modals
  const [actionConfirmOpen, setActionConfirmOpen] = useState(false);
  const [actionQuest, setActionQuest] = useState<Quest | null>(null);
  const [actionType, setActionType] = useState<'end' | 'cancel' | 'delete'>('end');

  // Claim Review / Credit Modal
  const [selectedClaimForReview, setSelectedClaimForReview] = useState<QuestClaim | null>(null);
  const [creditingClaim, setCreditingClaim] = useState(false);
  const [claimRejectReason, setClaimRejectReason] = useState('');

  // Fetch Quests
  const fetchQuests = async () => {
    try {
      setLoadingQuests(true);
      const qSnap = await getDocs(query(collection(db, 'quests'), limit(150)));
      const list: Quest[] = [];
      qSnap.forEach((d) => {
        const dt = d.data();
        list.push({
          id: d.id,
          title: dt.title || 'Untitled Quest',
          description: dt.description || '',
          status: dt.status || 'draft',
          startAt: dt.startAt,
          endAt: dt.endAt,
          metric: dt.metric || 'deliveries',
          hourFrom: dt.hourFrom || '',
          hourTo: dt.hourTo || '',
          services: dt.services || [],
          cityIds: dt.cityIds || [],
          vehicleTypes: dt.vehicleTypes || [],
          riderIds: dt.riderIds || [],
          minAcceptanceRate: dt.minAcceptanceRate ?? null,
          maxNoShows: dt.maxNoShows ?? null,
          goals: dt.goals || [],
          totalPaid: Number(dt.totalPaid || 0),
          createdAt: dt.createdAt,
          createdBy: dt.createdBy
        });
      });
      list.sort((a, b) => (b.startAt?.seconds || 0) - (a.startAt?.seconds || 0));
      setQuests(list);
    } catch (err) {
      showError(err);
    } finally {
      setLoadingQuests(false);
    }
  };

  // Fetch Claims
  const fetchClaims = async () => {
    try {
      setLoadingClaims(true);
      const cSnap = await getDocs(query(collection(db, 'questClaims'), limit(200)));
      const list: QuestClaim[] = [];
      cSnap.forEach((d) => {
        const dt = d.data();
        list.push({
          id: d.id,
          questId: dt.questId || '',
          questTitle: dt.questTitle || 'Quest',
          riderId: dt.riderId || '',
          riderName: dt.riderName || 'Rider',
          riderPhone: dt.riderPhone || '',
          cityId: dt.cityId || '',
          claimedTarget: Number(dt.claimedTarget || 0),
          claimedReward: Number(dt.claimedReward || 0),
          achievedValue: Number(dt.achievedValue || 0),
          status: dt.status || 'Pending',
          verifiedValues: dt.verifiedValues,
          verifiedAt: dt.verifiedAt,
          verifiedBy: dt.verifiedBy,
          creditedAt: dt.creditedAt,
          creditedBy: dt.creditedBy,
          note: dt.note || '',
          createdAt: dt.createdAt
        });
      });
      list.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setClaims(list);
    } catch (err) {
      showError(err);
    } finally {
      setLoadingClaims(false);
    }
  };

  useEffect(() => {
    fetchQuests();
    fetchClaims();
  }, [selectedCityId]);

  // Compute Total Paid across all quests
  const overallTotalPaid = useMemo(() => {
    return quests.reduce((sum, q) => sum + (q.totalPaid || 0), 0);
  }, [quests]);

  const activeQuestsCount = useMemo(() => {
    return quests.filter((q) => q.status === 'active').length;
  }, [quests]);

  const pendingClaimsCount = useMemo(() => {
    return claims.filter((c) => c.status === 'Pending').length;
  }, [claims]);

  // Filtered Quests
  const filteredQuests = useMemo(() => {
    return quests.filter((q) => {
      if (selectedCityId !== 'all' && q.cityIds?.length > 0 && !q.cityIds.includes(selectedCityId)) {
        return false;
      }
      if (questStatusFilter !== 'all' && q.status !== questStatusFilter) return false;
      if (questSearch.trim()) {
        const term = questSearch.toLowerCase().trim();
        const tMatch = q.title.toLowerCase().includes(term);
        const dMatch = q.description.toLowerCase().includes(term);
        if (!tMatch && !dMatch) return false;
      }
      return true;
    });
  }, [quests, selectedCityId, questStatusFilter, questSearch]);

  // Filtered Claims
  const filteredClaims = useMemo(() => {
    return claims.filter((c) => {
      if (selectedCityId !== 'all' && c.cityId && c.cityId !== selectedCityId) return false;
      if (claimStatusFilter !== 'all' && c.status !== claimStatusFilter) return false;
      if (claimQuestFilter !== 'all' && c.questId !== claimQuestFilter) return false;
      if (claimSearch.trim()) {
        const term = claimSearch.toLowerCase().trim();
        const rMatch = (c.riderName || '').toLowerCase().includes(term);
        const qMatch = (c.questTitle || '').toLowerCase().includes(term);
        const pMatch = (c.riderPhone || '').toLowerCase().includes(term);
        if (!rMatch && !qMatch && !pMatch) return false;
      }
      return true;
    });
  }, [claims, selectedCityId, claimStatusFilter, claimQuestFilter, claimSearch]);

  // Verification Helper: Recompute real driver result from orders and offerLog
  const verifyRiderQuestResult = async (quest: Quest, riderId: string) => {
    try {
      const qStart = quest.startAt?.toDate ? quest.startAt.toDate() : new Date(quest.startAt);
      const qEnd = quest.endAt?.toDate ? quest.endAt.toDate() : new Date(quest.endAt);

      const qOrders = query(
        collection(db, 'orders'),
        where('riderId', '==', riderId),
        limit(300)
      );
      const ordSnap = await getDocs(qOrders);

      let eligibleDeliveriesCount = 0;
      let eligibleEarningsSum = 0;

      ordSnap.forEach((d) => {
        const ord = d.data();
        const st = (ord.status || '').toLowerCase();
        if (st !== 'delivered' && st !== 'completed') return;

        const orderDate = ord.deliveredAt?.toDate
          ? ord.deliveredAt.toDate()
          : ord.createdAt?.toDate
          ? ord.createdAt.toDate()
          : new Date(ord.createdAt);

        if (orderDate < qStart || orderDate > qEnd) return;

        if (quest.services && quest.services.length > 0) {
          if (!quest.services.includes(ord.serviceType)) return;
        }

        if (quest.hourFrom && quest.hourTo) {
          if (!isWithinPHTHours(orderDate, quest.hourFrom, quest.hourTo)) return;
        }

        eligibleDeliveriesCount += 1;
        const earn = Number(ord.riderEarning?.total || ord.riderEarning?.net || ord.riderEarning?.deliveryFee || 0);
        eligibleEarningsSum += earn;
      });

      const qLog = query(
        collection(db, 'offerLog'),
        where('riderId', '==', riderId),
        limit(200)
      );
      const logSnap = await getDocs(qLog);
      let offersReceived = 0;
      let offersAccepted = 0;
      let noShowsCount = 0;

      logSnap.forEach((ld) => {
        const entry = ld.data();
        const entryDate = entry.createdAt?.toDate
          ? entry.createdAt.toDate()
          : new Date(entry.createdAt);
        if (entryDate >= qStart && entryDate <= qEnd) {
          offersReceived += 1;
          if (entry.status === 'accepted' || entry.accepted) offersAccepted += 1;
          if (entry.status === 'no_show' || entry.noShow) noShowsCount += 1;
        }
      });

      const acceptanceRate =
        offersReceived > 0 ? Math.round((offersAccepted / offersReceived) * 100) : 100;

      let eligible = true;
      if (quest.minAcceptanceRate !== null && quest.minAcceptanceRate !== undefined) {
        if (acceptanceRate < quest.minAcceptanceRate) eligible = false;
      }
      if (quest.maxNoShows !== null && quest.maxNoShows !== undefined) {
        if (noShowsCount > quest.maxNoShows) eligible = false;
      }

      const metricVal = quest.metric === 'deliveries' ? eligibleDeliveriesCount : eligibleEarningsSum;

      let verifiedTarget = 0;
      let computedReward = 0;
      const sortedGoals = [...(quest.goals || [])].sort((a, b) => a.target - b.target);

      for (const g of sortedGoals) {
        if (metricVal >= g.target) {
          verifiedTarget = g.target;
          computedReward = g.reward;
        }
      }

      if (computedReward === 0) eligible = false;

      return {
        deliveries: eligibleDeliveriesCount,
        earnings: Math.round(eligibleEarningsSum),
        acceptanceRate,
        noShows: noShowsCount,
        eligible,
        verifiedTarget,
        computedReward
      };
    } catch (e) {
      console.error('Failed to verify rider quest result:', e);
      return null;
    }
  };

  const handleVerifyClaim = async (claim: QuestClaim) => {
    const quest = quests.find((q) => q.id === claim.questId);
    if (!quest) {
      showError('Associated quest not found for this claim.');
      return;
    }
    try {
      const verified = await verifyRiderQuestResult(quest, claim.riderId);
      if (!verified) {
        showError('Could not compute verification metrics.');
        return;
      }

      const claimRef = doc(db, 'questClaims', claim.id);
      const updates: any = {
        verifiedValues: verified,
        verifiedAt: Timestamp.now(),
        verifiedBy: adminProfile?.name || adminProfile?.email || 'Admin',
        updatedAt: Timestamp.now()
      };

      await updateDoc(claimRef, updates);

      setClaims((prev) =>
        prev.map((c) => (c.id === claim.id ? { ...c, ...updates } : c))
      );

      showSuccess(
        `Verified: ${verified.deliveries} deliveries (₱${verified.earnings} earnings), Highest milestone: ₱${verified.computedReward}.`
      );
    } catch (err) {
      showError(err);
    }
  };

  const handleCreditClaim = async (claim: QuestClaim) => {
    const quest = quests.find((q) => q.id === claim.questId);
    if (!quest) {
      showError('Quest definition not found.');
      return;
    }
    const rewardToCredit =
      claim.verifiedValues?.computedReward && claim.verifiedValues.computedReward > 0
        ? claim.verifiedValues.computedReward
        : claim.claimedReward;

    if (rewardToCredit <= 0) {
      showError('Reward amount must be greater than ₱0.');
      return;
    }

    try {
      setCreditingClaim(true);
      const now = Timestamp.now();
      const adminName = adminProfile?.name || adminProfile?.email || 'Admin';

      const rRef = doc(db, 'riders', claim.riderId);
      const rSnap = await getDoc(rRef);
      const rData = rSnap.exists() ? rSnap.data() : null;
      const linkedCustomerUid = rData?.linkedCustomerUid;

      const claimRef = doc(db, 'questClaims', claim.id);
      const questRef = doc(db, 'quests', quest.id);
      const txnRef = doc(collection(db, 'walletTransactions'));

      await runTransaction(db, async (transaction) => {
        transaction.update(claimRef, {
          status: 'Credited',
          creditedAt: now,
          creditedBy: adminName,
          verifiedAt: now,
          verifiedBy: adminName,
          updatedAt: now
        });

        transaction.update(questRef, {
          totalPaid: (quest.totalPaid || 0) + rewardToCredit,
          updatedAt: now
        });

        if (linkedCustomerUid) {
          const userRef = doc(db, 'users', linkedCustomerUid);
          const uSnap = await transaction.get(userRef);
          const oldBal = uSnap.exists() ? Number(uSnap.data()?.walletBalance || 0) : 0;
          const newBal = oldBal + rewardToCredit;

          transaction.update(userRef, {
            walletBalance: newBal,
            updatedAt: now
          });

          transaction.set(txnRef, {
            riderId: claim.riderId,
            customerId: linkedCustomerUid,
            amount: rewardToCredit,
            type: 'quest_reward',
            questId: quest.id,
            questTitle: quest.title,
            description: `Quest Bonus: ${quest.title}`,
            balanceAfter: newBal,
            createdAt: now,
            adminId: adminProfile?.uid || 'admin',
            adminName
          });
        } else {
          const oldBal = rSnap.exists() ? Number(rData?.walletBalance || 0) : 0;
          const newBal = oldBal + rewardToCredit;

          transaction.update(rRef, {
            walletBalance: newBal,
            updatedAt: now
          });

          transaction.set(txnRef, {
            riderId: claim.riderId,
            amount: rewardToCredit,
            type: 'quest_reward',
            questId: quest.id,
            questTitle: quest.title,
            description: `Quest Bonus: ${quest.title}`,
            balanceAfter: newBal,
            createdAt: now,
            adminId: adminProfile?.uid || 'admin',
            adminName
          });
        }
      });

      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName,
        action: 'CREDIT_QUEST_REWARD',
        entityType: 'quest',
        entityId: quest.id,
        details: JSON.stringify({
          claimId: claim.id,
          riderId: claim.riderId,
          riderName: claim.riderName,
          rewardAmount: rewardToCredit,
          questTitle: quest.title
        })
      });

      setClaims((prev) =>
        prev.map((c) =>
          c.id === claim.id
            ? {
                ...c,
                status: 'Credited',
                creditedAt: now,
                creditedBy: adminName
              }
            : c
        )
      );

      setQuests((prev) =>
        prev.map((q) =>
          q.id === quest.id ? { ...q, totalPaid: (q.totalPaid || 0) + rewardToCredit } : q
        )
      );

      showSuccess(`Credited ₱${rewardToCredit} quest bonus to driver ${claim.riderName}.`);
      setSelectedClaimForReview(null);
    } catch (err) {
      showError(err);
    } finally {
      setCreditingClaim(false);
    }
  };

  const handleUpdateClaimStatus = async (
    claim: QuestClaim,
    newStatus: 'Not achieved' | 'Rejected',
    noteText: string
  ) => {
    try {
      const now = Timestamp.now();
      const adminName = adminProfile?.name || adminProfile?.email || 'Admin';

      await updateDoc(doc(db, 'questClaims', claim.id), {
        status: newStatus,
        note: noteText.trim() || undefined,
        verifiedAt: now,
        verifiedBy: adminName,
        updatedAt: now
      });

      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName,
        action: 'UPDATE_QUEST_CLAIM_STATUS',
        entityType: 'quest',
        entityId: claim.questId,
        details: JSON.stringify({
          claimId: claim.id,
          riderId: claim.riderId,
          newStatus,
          note: noteText
        })
      });

      setClaims((prev) =>
        prev.map((c) =>
          c.id === claim.id
            ? { ...c, status: newStatus, note: noteText, verifiedAt: now, verifiedBy: adminName }
            : c
        )
      );

      showSuccess(`Claim marked as "${newStatus}".`);
      setSelectedClaimForReview(null);
      setClaimRejectReason('');
    } catch (err) {
      showError(err);
    }
  };

  const runAutoSettle = async () => {
    if (autoSettling) return;
    try {
      setAutoSettling(true);
      const pending = claims.filter((c) => c.status === 'Pending');
      if (pending.length === 0) {
        setLastAutoSettleTime(new Date());
        return;
      }

      let settledCount = 0;

      for (const claim of pending) {
        const quest = quests.find((q) => q.id === claim.questId);
        if (!quest) continue;

        const verified = await verifyRiderQuestResult(quest, claim.riderId);
        if (verified && verified.eligible && verified.computedReward >= claim.claimedReward) {
          const rRef = doc(db, 'riders', claim.riderId);
          const rSnap = await getDoc(rRef);
          const rData = rSnap.exists() ? rSnap.data() : null;
          const linkedCustomerUid = rData?.linkedCustomerUid;
          const rewardToCredit = verified.computedReward;
          const now = Timestamp.now();
          const adminName = 'System Auto-Settle';

          const claimRef = doc(db, 'questClaims', claim.id);
          const questRef = doc(db, 'quests', quest.id);
          const txnRef = doc(collection(db, 'walletTransactions'));

          await runTransaction(db, async (transaction) => {
            transaction.update(claimRef, {
              status: 'Credited',
              verifiedValues: verified,
              verifiedAt: now,
              verifiedBy: adminName,
              creditedAt: now,
              creditedBy: adminName,
              updatedAt: now
            });

            transaction.update(questRef, {
              totalPaid: (quest.totalPaid || 0) + rewardToCredit,
              updatedAt: now
            });

            if (linkedCustomerUid) {
              const userRef = doc(db, 'users', linkedCustomerUid);
              const uSnap = await transaction.get(userRef);
              const oldBal = uSnap.exists() ? Number(uSnap.data()?.walletBalance || 0) : 0;
              const newBal = oldBal + rewardToCredit;
              transaction.update(userRef, { walletBalance: newBal, updatedAt: now });
              transaction.set(txnRef, {
                riderId: claim.riderId,
                customerId: linkedCustomerUid,
                amount: rewardToCredit,
                type: 'quest_reward',
                questId: quest.id,
                questTitle: quest.title,
                description: `Auto-Settled Quest Reward: ${quest.title}`,
                balanceAfter: newBal,
                createdAt: now,
                adminName
              });
            } else {
              const oldBal = rSnap.exists() ? Number(rData?.walletBalance || 0) : 0;
              const newBal = oldBal + rewardToCredit;
              transaction.update(rRef, { walletBalance: newBal, updatedAt: now });
              transaction.set(txnRef, {
                riderId: claim.riderId,
                amount: rewardToCredit,
                type: 'quest_reward',
                questId: quest.id,
                questTitle: quest.title,
                description: `Auto-Settled Quest Reward: ${quest.title}`,
                balanceAfter: newBal,
                createdAt: now,
                adminName
              });
            }
          });

          settledCount += 1;
        }
      }

      if (settledCount > 0) {
        showSuccess(`Auto-settled and credited ${settledCount} matching quest claim(s).`);
        await fetchClaims();
        await fetchQuests();
      }
      setLastAutoSettleTime(new Date());
    } catch (err) {
      console.warn('Auto-settle warning:', err);
    } finally {
      setAutoSettling(false);
    }
  };

  useEffect(() => {
    if (!autoSettleEnabled) return;

    if (claims.length > 0 && quests.length > 0) {
      runAutoSettle();
    }

    const intervalId = setInterval(() => {
      runAutoSettle();
    }, 10 * 60 * 1000);

    return () => clearInterval(intervalId);
  }, [autoSettleEnabled, claims.length, quests.length]);

  const handleScanEligibleRiders = async () => {
    try {
      setScanningRiders(true);
      const activeOrEndedQuests = quests.filter(
        (q) => q.status === 'active' || q.status === 'ended'
      );
      if (activeOrEndedQuests.length === 0) {
        showError('No active or ended quests found to scan.');
        return;
      }

      const rSnap = await getDocs(query(collection(db, 'riders'), limit(150)));
      const allRiders: Rider[] = [];
      rSnap.forEach((d) => allRiders.push({ id: d.id, ...d.data() } as any));

      let createdClaimsCount = 0;

      for (const quest of activeOrEndedQuests) {
        const candidates = allRiders.filter((r) => {
          if (quest.cityIds && quest.cityIds.length > 0 && r.cityId && !quest.cityIds.includes(r.cityId)) return false;
          if (quest.vehicleTypes && quest.vehicleTypes.length > 0 && r.vehicleType && !quest.vehicleTypes.includes(r.vehicleType))
            return false;
          return true;
        });

        for (const rider of candidates) {
          const existing = claims.find(
            (c) => c.questId === quest.id && c.riderId === rider.id
          );
          if (existing) continue;

          const verified = await verifyRiderQuestResult(quest, rider.id);
          if (verified && verified.eligible && verified.computedReward > 0) {
            const newClaimRef = doc(collection(db, 'questClaims'));
            await setDoc(newClaimRef, {
              questId: quest.id,
              questTitle: quest.title,
              riderId: rider.id,
              riderName: rider.name || 'Driver',
              riderPhone: rider.phone || '',
              cityId: rider.cityId || '',
              claimedTarget: verified.verifiedTarget,
              claimedReward: verified.computedReward,
              achievedValue: quest.metric === 'deliveries' ? verified.deliveries : verified.earnings,
              status: 'Pending',
              verifiedValues: verified,
              verifiedAt: Timestamp.now(),
              verifiedBy: 'System Scan',
              createdAt: Timestamp.now(),
              updatedAt: Timestamp.now()
            });
            createdClaimsCount += 1;
          }
        }
      }

      await fetchClaims();
      if (createdClaimsCount > 0) {
        showSuccess(
          `Scan completed: generated ${createdClaimsCount} new claim(s) for eligible riders.`
        );
      } else {
        showSuccess('Scan complete: all eligible riders already have claims recorded.');
      }
    } catch (err) {
      showError(err);
    } finally {
      setScanningRiders(false);
    }
  };

  const handleOpenCreateQuest = () => {
    setEditingQuestId(null);
    setIsMultiDay(false);
    const todayStr = formatPHTDateOnly(new Date());
    setFormTitle('Weekend Delivery Rush');
    setFormDescription('Hit the target deliveries this weekend to claim instant bonus cash!');
    setFormStatus('active');
    setFormMetric('deliveries');
    setFormStartDate(todayStr);
    setFormStartTime('00:00');
    setFormEndDate(todayStr);
    setFormEndTime('23:59');
    setFormHourFrom('');
    setFormHourTo('');
    setFormServices([]);
    setFormCityIds(selectedCityId !== 'all' ? [selectedCityId] : []);
    setFormVehicleTypes([]);
    setFormMinAcceptanceRate('');
    setFormMaxNoShows('');
    setFormGoals([
      { target: 15, reward: 50 },
      { target: 18, reward: 75 },
      { target: 21, reward: 110 }
    ]);
    setIsFormOpen(true);
  };

  const handleOpenEditQuest = (quest: Quest) => {
    setEditingQuestId(quest.id);
    setIsMultiDay(false);
    setFormTitle(quest.title);
    setFormDescription(quest.description || '');
    setFormStatus(quest.status);
    setFormMetric(quest.metric);
    setFormStartDate(formatPHTDateOnly(quest.startAt));
    setFormStartTime('00:00');
    setFormEndDate(formatPHTDateOnly(quest.endAt));
    setFormEndTime('23:59');
    setFormHourFrom(quest.hourFrom || '');
    setFormHourTo(quest.hourTo || '');
    setFormServices(quest.services || []);
    setFormCityIds(quest.cityIds || []);
    setFormVehicleTypes(quest.vehicleTypes || []);
    setFormMinAcceptanceRate(
      quest.minAcceptanceRate !== null && quest.minAcceptanceRate !== undefined
        ? String(quest.minAcceptanceRate)
        : ''
    );
    setFormMaxNoShows(
      quest.maxNoShows !== null && quest.maxNoShows !== undefined ? String(quest.maxNoShows) : ''
    );
    setFormGoals(quest.goals?.length ? [...quest.goals] : [{ target: 10, reward: 50 }]);
    setIsFormOpen(true);
  };

  const handleDuplicateQuest = (quest: Quest) => {
    setEditingQuestId(null);
    setIsMultiDay(false);
    const todayStr = formatPHTDateOnly(new Date());
    setFormTitle(`${quest.title} (Copy)`);
    setFormDescription(quest.description || '');
    setFormStatus('draft');
    setFormMetric(quest.metric);
    setFormStartDate(todayStr);
    setFormStartTime('00:00');
    setFormEndDate(todayStr);
    setFormEndTime('23:59');
    setFormHourFrom(quest.hourFrom || '');
    setFormHourTo(quest.hourTo || '');
    setFormServices(quest.services || []);
    setFormCityIds(quest.cityIds || []);
    setFormVehicleTypes(quest.vehicleTypes || []);
    setFormMinAcceptanceRate(
      quest.minAcceptanceRate !== null && quest.minAcceptanceRate !== undefined
        ? String(quest.minAcceptanceRate)
        : ''
    );
    setFormMaxNoShows(
      quest.maxNoShows !== null && quest.maxNoShows !== undefined ? String(quest.maxNoShows) : ''
    );
    setFormGoals(quest.goals?.length ? [...quest.goals] : [{ target: 10, reward: 50 }]);
    setIsFormOpen(true);
  };

  const handleAddGoal = () => {
    const lastTarget = formGoals[formGoals.length - 1]?.target || 10;
    const lastReward = formGoals[formGoals.length - 1]?.reward || 50;
    setFormGoals([
      ...formGoals,
      { target: lastTarget + 5, reward: lastReward + 40 }
    ]);
  };

  const handleRemoveGoal = (index: number) => {
    if (formGoals.length <= 1) {
      showError('A quest must have at least one goal level.');
      return;
    }
    setFormGoals(formGoals.filter((_, idx) => idx !== index));
  };

  const handleUpdateGoal = (index: number, field: 'target' | 'reward', val: number) => {
    const next = [...formGoals];
    next[index] = { ...next[index], [field]: val };
    setFormGoals(next);
  };

  const handleSubmitQuest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim()) {
      showError('Please enter a quest title.');
      return;
    }
    if (formGoals.length === 0) {
      showError('Please define at least one goal.');
      return;
    }

    const sortedGoals = [...formGoals].sort((a, b) => a.target - b.target);
    for (const g of sortedGoals) {
      if (g.target <= 0 || g.reward <= 0) {
        showError('Goal targets and rewards must be greater than zero.');
        return;
      }
    }

    try {
      setIsSubmittingQuest(true);
      const now = Timestamp.now();
      const adminName = adminProfile?.name || adminProfile?.email || 'Admin';

      if (isMultiDay && !editingQuestId) {
        if (!multiDayStartDate || !multiDayEndDate) {
          showError('Please select both start date and end date for multi-day quest generation.');
          setIsSubmittingQuest(false);
          return;
        }

        const start = new Date(multiDayStartDate);
        const end = new Date(multiDayEndDate);
        if (start > end) {
          showError('Start date cannot be after end date.');
          setIsSubmittingQuest(false);
          return;
        }

        const dates: string[] = [];
        const cur = new Date(start);
        while (cur <= end) {
          dates.push(cur.toISOString().split('T')[0]);
          cur.setDate(cur.getDate() + 1);
        }

        for (const dStr of dates) {
          const questStart = makePHTDate(dStr, formStartTime || '00:00');
          const questEnd = makePHTDate(dStr, formEndTime || '23:59');

          const newDocRef = doc(collection(db, 'quests'));
          await setDoc(newDocRef, {
            title: `${formTitle.trim()} (${dStr})`,
            description: formDescription.trim(),
            status: formStatus,
            startAt: Timestamp.fromDate(questStart),
            endAt: Timestamp.fromDate(questEnd),
            metric: formMetric,
            hourFrom: formHourFrom.trim() || undefined,
            hourTo: formHourTo.trim() || undefined,
            services: formServices,
            cityIds: formCityIds,
            vehicleTypes: formVehicleTypes,
            riderIds: [],
            minAcceptanceRate: formMinAcceptanceRate ? Number(formMinAcceptanceRate) : null,
            maxNoShows: formMaxNoShows ? Number(formMaxNoShows) : null,
            goals: sortedGoals,
            totalPaid: 0,
            createdAt: now,
            createdBy: adminName,
            updatedAt: now
          });
        }

        await logAuditEvent({
          adminId: adminProfile?.uid || 'admin',
          adminName,
          action: 'CREATE_MULTI_DAY_QUESTS',
          entityType: 'quest',
          entityId: 'multi_day_batch',
          details: JSON.stringify({
            title: formTitle,
            daysCount: dates.length,
            startDate: multiDayStartDate,
            endDate: multiDayEndDate
          })
        });

        showSuccess(`Generated ${dates.length} daily quest documents successfully.`);
      } else {
        const questStart = makePHTDate(formStartDate, formStartTime || '00:00');
        const questEnd = makePHTDate(formEndDate, formEndTime || '23:59');

        const questData: any = {
          title: formTitle.trim(),
          description: formDescription.trim(),
          status: formStatus,
          startAt: Timestamp.fromDate(questStart),
          endAt: Timestamp.fromDate(questEnd),
          metric: formMetric,
          hourFrom: formHourFrom.trim() || undefined,
          hourTo: formHourTo.trim() || undefined,
          services: formServices,
          cityIds: formCityIds,
          vehicleTypes: formVehicleTypes,
          minAcceptanceRate: formMinAcceptanceRate ? Number(formMinAcceptanceRate) : null,
          maxNoShows: formMaxNoShows ? Number(formMaxNoShows) : null,
          goals: sortedGoals,
          updatedAt: now
        };

        if (editingQuestId) {
          await updateDoc(doc(db, 'quests', editingQuestId), questData);
          await logAuditEvent({
            adminId: adminProfile?.uid || 'admin',
            adminName,
            action: 'UPDATE_QUEST',
            entityType: 'quest',
            entityId: editingQuestId,
            details: JSON.stringify(questData)
          });
          showSuccess('Quest updated successfully.');
        } else {
          questData.riderIds = [];
          questData.totalPaid = 0;
          questData.createdAt = now;
          questData.createdBy = adminName;

          const newDocRef = doc(collection(db, 'quests'));
          await setDoc(newDocRef, questData);

          await logAuditEvent({
            adminId: adminProfile?.uid || 'admin',
            adminName,
            action: 'CREATE_QUEST',
            entityType: 'quest',
            entityId: newDocRef.id,
            details: JSON.stringify(questData)
          });
          showSuccess('Quest created successfully.');
        }
      }

      setIsFormOpen(false);
      await fetchQuests();
    } catch (err) {
      showError(err);
    } finally {
      setIsSubmittingQuest(false);
    }
  };

  const handleOpenActionModal = (quest: Quest, type: 'end' | 'cancel' | 'delete') => {
    setActionQuest(quest);
    setActionType(type);
    setActionConfirmOpen(true);
  };

  const handleConfirmAction = async () => {
    if (!actionQuest) return;
    try {
      const now = Timestamp.now();
      const adminName = adminProfile?.name || adminProfile?.email || 'Admin';

      if (actionType === 'end') {
        await updateDoc(doc(db, 'quests', actionQuest.id), {
          status: 'ended',
          updatedAt: now
        });
        showSuccess(`Quest "${actionQuest.title}" ended.`);
      } else if (actionType === 'cancel') {
        await updateDoc(doc(db, 'quests', actionQuest.id), {
          status: 'cancelled',
          updatedAt: now
        });
        showSuccess(`Quest "${actionQuest.title}" cancelled.`);
      }

      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName,
        action: `SET_QUEST_STATUS_${actionType.toUpperCase()}`,
        entityType: 'quest',
        entityId: actionQuest.id,
        details: JSON.stringify({ status: actionType === 'end' ? 'ended' : 'cancelled' })
      });

      setActionConfirmOpen(false);
      setActionQuest(null);
      await fetchQuests();
    } catch (err) {
      showError(err);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-16">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-6 shadow-xs">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2.5 rounded-2xl bg-amber-400 text-black shadow-md shadow-amber-400/20">
              <Trophy className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-extrabold text-gray-900 dark:text-white tracking-tight">
                Driver Quests & Incentives
              </h1>
              <p className="text-xs text-gray-500 dark:text-zinc-400">
                Create milestone goals ladder, preview driver mobile cards, scan eligible riders, and settle reward bonuses.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Auto-Settle Switch */}
          <div className="flex items-center gap-2 px-3.5 py-2 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50">
            <button
              type="button"
              onClick={() => setAutoSettleEnabled(!autoSettleEnabled)}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden ${
                autoSettleEnabled ? 'bg-amber-500' : 'bg-gray-300 dark:bg-zinc-700'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                  autoSettleEnabled ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
            <div className="text-[11px] font-bold text-gray-800 dark:text-zinc-200">
              <span>Auto-settle (10m)</span>
              {lastAutoSettleTime && (
                <span className="block text-[9px] text-gray-400 font-normal">
                  Checked {lastAutoSettleTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </div>
          </div>

          {/* Scan Eligible Riders Button */}
          <button
            type="button"
            onClick={handleScanEligibleRiders}
            disabled={scanningRiders}
            className="px-4 py-2.5 rounded-2xl border border-gray-200 dark:border-zinc-800 hover:bg-gray-50 dark:hover:bg-zinc-800 text-gray-700 dark:text-zinc-300 text-xs font-bold flex items-center gap-2 shadow-xs transition-colors"
          >
            {scanningRiders ? (
              <Loader2 className="w-4 h-4 animate-spin text-amber-500" />
            ) : (
              <Users className="w-4 h-4 text-amber-500" />
            )}
            <span>Scan Eligible Riders</span>
          </button>

          {/* Create Quest Button */}
          <button
            type="button"
            onClick={handleOpenCreateQuest}
            className="delivio-btn-yellow px-4 py-2.5 rounded-2xl text-xs font-extrabold flex items-center gap-2 shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Create New Quest</span>
          </button>
        </div>
      </div>

      {/* Metric Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-gray-500 text-xs font-semibold mb-1">
            <span>Total Rewards Paid</span>
            <DollarSign className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-black text-emerald-600">
            ₱{Number(overallTotalPaid || 0).toLocaleString()}
          </div>
          <p className="text-[10px] text-gray-400 mt-0.5">Credited across all quests</p>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-gray-500 text-xs font-semibold mb-1">
            <span>Active Quests</span>
            <Zap className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-black text-gray-900 dark:text-white">
            {activeQuestsCount}
          </div>
          <p className="text-[10px] text-gray-400 mt-0.5">Multiple quests can run simultaneously</p>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-gray-500 text-xs font-semibold mb-1">
            <span>Pending Claims</span>
            <Clock className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-black text-amber-500">
            {pendingClaimsCount}
          </div>
          <p className="text-[10px] text-gray-400 mt-0.5">Awaiting verification or auto-settle</p>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-gray-500 text-xs font-semibold mb-1">
            <span>Total Quests Configured</span>
            <Award className="w-4 h-4 text-purple-500" />
          </div>
          <div className="text-2xl font-black text-gray-900 dark:text-white">
            {quests.length}
          </div>
          <p className="text-[10px] text-gray-400 mt-0.5">Philippine time (UTC+8) scheduled</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-zinc-800">
        <button
          type="button"
          onClick={() => setActiveTab('quests')}
          className={`px-5 py-3 text-xs font-extrabold border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'quests'
              ? 'border-amber-400 text-amber-600 dark:text-amber-400'
              : 'border-transparent text-gray-500 hover:text-gray-900 dark:hover:text-white'
          }`}
        >
          <Trophy className="w-4 h-4" />
          <span>Quests Management ({filteredQuests.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('claims')}
          className={`px-5 py-3 text-xs font-extrabold border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'claims'
              ? 'border-amber-400 text-amber-600 dark:text-amber-400'
              : 'border-transparent text-gray-500 hover:text-gray-900 dark:hover:text-white'
          }`}
        >
          <Clock className="w-4 h-4" />
          <span>Claims Queue</span>
          {pendingClaimsCount > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-400 text-black font-extrabold">
              {pendingClaimsCount}
            </span>
          )}
        </button>
      </div>

      {/* TAB 1: QUESTS MANAGEMENT */}
      {activeTab === 'quests' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-4 shadow-xs flex flex-col sm:flex-row gap-3 items-center justify-between">
            <div className="relative w-full sm:w-72">
              <Search className="w-4 h-4 absolute left-3.5 top-3 text-gray-400" />
              <input
                type="text"
                value={questSearch}
                onChange={(e) => setQuestSearch(e.target.value)}
                placeholder="Search quest title or description..."
                className="w-full pl-9 pr-4 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
              />
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <select
                value={questStatusFilter}
                onChange={(e) => setQuestStatusFilter(e.target.value as any)}
                className="px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white font-medium"
              >
                <option value="all">All Statuses</option>
                <option value="active">Active</option>
                <option value="draft">Draft</option>
                <option value="ended">Ended</option>
                <option value="cancelled">Cancelled</option>
              </select>

              <button
                type="button"
                onClick={fetchQuests}
                disabled={loadingQuests}
                className="p-2 rounded-xl border border-gray-200 dark:border-zinc-800 hover:bg-gray-50 dark:hover:bg-zinc-800 text-gray-600 dark:text-zinc-300"
                title="Refresh quests"
              >
                <RefreshCw className={`w-4 h-4 ${loadingQuests ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Quests List */}
          {loadingQuests ? (
            <TableSkeleton rows={4} cols={5} />
          ) : filteredQuests.length === 0 ? (
            <div className="p-12 text-center bg-white dark:bg-zinc-900 rounded-2xl border border-gray-200 dark:border-zinc-800 space-y-3">
              <Trophy className="w-8 h-8 text-gray-400 mx-auto" />
              <p className="text-xs text-gray-500">No quests match your selected criteria.</p>
              <button
                type="button"
                onClick={handleOpenCreateQuest}
                className="delivio-btn-yellow px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" /> Create Quest
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredQuests.map((quest) => {
                const isActive = quest.status === 'active';
                const isDraft = quest.status === 'draft';
                const isEnded = quest.status === 'ended';

                return (
                  <div
                    key={quest.id}
                    className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-5 shadow-xs flex flex-col justify-between hover:border-amber-400 transition-colors"
                  >
                    <div>
                      {/* Top Badges */}
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                            isActive
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                              : isDraft
                              ? 'bg-gray-100 text-gray-700 dark:bg-zinc-800 dark:text-zinc-300'
                              : isEnded
                              ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                              : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                          }`}
                        >
                          {quest.status}
                        </span>

                        <div className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-lg border border-emerald-200 dark:border-emerald-900/40">
                          <DollarSign className="w-3 h-3" />
                          <span>Paid: ₱{Number(quest.totalPaid || 0).toLocaleString()}</span>
                        </div>
                      </div>

                      {/* Title & Description */}
                      <h3 className="font-extrabold text-sm text-gray-900 dark:text-white mb-1">
                        {quest.title}
                      </h3>
                      {quest.description && (
                        <p className="text-xs text-gray-500 dark:text-zinc-400 line-clamp-2 mb-3">
                          {quest.description}
                        </p>
                      )}

                      {/* Quest Schedule & Criteria Details */}
                      <div className="space-y-1.5 py-2.5 border-t border-b border-gray-100 dark:border-zinc-800 text-[11px] text-gray-600 dark:text-zinc-400 font-medium">
                        <div className="flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                          <span>{formatPHT(quest.startAt)} — {formatPHT(quest.endAt)}</span>
                        </div>

                        {quest.hourFrom && quest.hourTo && (
                          <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                            <Clock className="w-3.5 h-3.5 shrink-0" />
                            <span>Daily Window: {quest.hourFrom} to {quest.hourTo} PHT</span>
                          </div>
                        )}

                        <div className="flex items-center gap-1.5">
                          <TrendingUp className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                          <span className="capitalize">Metric: <strong>{quest.metric}</strong></span>
                        </div>

                        {quest.services && quest.services.length > 0 && (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <Layers className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                            <span>Services: </span>
                            {quest.services.map((s) => (
                              <span
                                key={s}
                                className="px-1.5 py-0.2 rounded-md bg-gray-100 dark:bg-zinc-800 text-[10px] font-bold"
                              >
                                {SERVICE_LABEL_MAP[s] || s}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Goals Milestone Ladder Preview */}
                      <div className="mt-3">
                        <span className="text-[10px] uppercase font-bold text-gray-400 block mb-1.5">
                          Milestone Ladder ({quest.goals?.length || 0} levels)
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {quest.goals?.map((g, idx) => (
                            <span
                              key={idx}
                              className="px-2 py-1 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/40 text-[11px] font-bold text-gray-900 dark:text-white flex items-center gap-1 shadow-2xs"
                            >
                              <span>{g.target} {quest.metric === 'deliveries' ? 'trips' : '₱'}</span>
                              <span className="text-amber-600 dark:text-amber-400 font-extrabold">&rarr; +₱{g.reward}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Actions Toolbar */}
                    <div className="flex items-center justify-between pt-4 mt-4 border-t border-gray-100 dark:border-zinc-800">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleOpenEditQuest(quest)}
                          className="p-1.5 text-gray-500 hover:text-amber-600 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-lg text-xs font-bold"
                          title="Edit Quest"
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDuplicateQuest(quest)}
                          className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-lg text-xs font-bold"
                          title="Duplicate Quest"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {isActive && (
                          <button
                            type="button"
                            onClick={() => handleOpenActionModal(quest, 'end')}
                            className="px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/50 dark:hover:bg-blue-900/60 text-blue-700 dark:text-blue-400 text-[11px] font-bold"
                          >
                            End Quest
                          </button>
                        )}
                        {(isActive || isDraft) && (
                          <button
                            type="button"
                            onClick={() => handleOpenActionModal(quest, 'cancel')}
                            className="px-2.5 py-1 rounded-lg bg-red-50 hover:bg-red-100 dark:bg-red-950/50 dark:hover:bg-red-900/60 text-red-600 dark:text-red-400 text-[11px] font-bold"
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: CLAIMS QUEUE */}
      {activeTab === 'claims' && (
        <div className="space-y-4">
          {/* Claims Filter Toolbar */}
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-4 shadow-xs flex flex-col sm:flex-row gap-3 items-center justify-between">
            <div className="relative w-full sm:w-72">
              <Search className="w-4 h-4 absolute left-3.5 top-3 text-gray-400" />
              <input
                type="text"
                value={claimSearch}
                onChange={(e) => setClaimSearch(e.target.value)}
                placeholder="Search driver name or quest..."
                className="w-full pl-9 pr-4 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
              <select
                value={claimStatusFilter}
                onChange={(e) => setClaimStatusFilter(e.target.value as any)}
                className="px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white font-medium"
              >
                <option value="all">All Claims ({claims.length})</option>
                <option value="Pending">Pending ({pendingClaimsCount})</option>
                <option value="Credited">Credited</option>
                <option value="Not achieved">Not achieved</option>
                <option value="Rejected">Rejected</option>
              </select>

              <select
                value={claimQuestFilter}
                onChange={(e) => setClaimQuestFilter(e.target.value)}
                className="px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white font-medium max-w-xs truncate"
              >
                <option value="all">All Quests</option>
                {quests.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.title}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={fetchClaims}
                disabled={loadingClaims}
                className="p-2 rounded-xl border border-gray-200 dark:border-zinc-800 hover:bg-gray-50 dark:hover:bg-zinc-800 text-gray-600 dark:text-zinc-300"
                title="Refresh claims"
              >
                <RefreshCw className={`w-4 h-4 ${loadingClaims ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Claims Table */}
          {loadingClaims ? (
            <TableSkeleton rows={6} cols={6} />
          ) : filteredClaims.length === 0 ? (
            <div className="p-12 text-center bg-white dark:bg-zinc-900 rounded-2xl border border-gray-200 dark:border-zinc-800 text-gray-400 text-xs">
              No claims found matching filters.
            </div>
          ) : (
            <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl overflow-hidden shadow-xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-50 dark:bg-zinc-850/60 uppercase font-bold text-gray-500 dark:text-zinc-400 border-b border-gray-200 dark:border-zinc-800">
                    <tr>
                      <th className="px-4 py-3.5">Driver</th>
                      <th className="px-4 py-3.5">Quest</th>
                      <th className="px-4 py-3.5">Claimed Milestone</th>
                      <th className="px-4 py-3.5">Verified Result</th>
                      <th className="px-4 py-3.5">Status</th>
                      <th className="px-4 py-3.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-zinc-800 font-medium">
                    {filteredClaims.map((claim) => {
                      const verified = claim.verifiedValues;
                      return (
                        <tr
                          key={claim.id}
                          className="hover:bg-gray-50/50 dark:hover:bg-zinc-800/40 transition-colors"
                        >
                          <td className="px-4 py-3.5">
                            <div className="font-bold text-gray-900 dark:text-white">
                              {claim.riderName}
                            </div>
                            <div className="text-[10px] text-gray-400 font-mono">
                              {claim.riderPhone || claim.riderId}
                            </div>
                          </td>

                          <td className="px-4 py-3.5">
                            <div className="font-bold text-gray-800 dark:text-zinc-200">
                              {claim.questTitle}
                            </div>
                            <div className="text-[10px] text-gray-400">
                              Claimed: {formatPHT(claim.createdAt)}
                            </div>
                          </td>

                          <td className="px-4 py-3.5">
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-gray-900 dark:text-white">
                                {claim.claimedTarget} target
                              </span>
                              <span className="px-1.5 py-0.2 rounded-md bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-extrabold text-[10px]">
                                ₱{claim.claimedReward}
                              </span>
                            </div>
                          </td>

                          <td className="px-4 py-3.5">
                            {verified ? (
                              <div className="space-y-0.5">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-bold text-gray-900 dark:text-white">
                                    {verified.deliveries} trips (₱{verified.earnings})
                                  </span>
                                  {verified.eligible ? (
                                    <span className="text-[10px] font-extrabold text-emerald-600 bg-emerald-100 dark:bg-emerald-950 px-1.5 py-0.2 rounded-full">
                                      Milestone: ₱{verified.computedReward}
                                    </span>
                                  ) : (
                                    <span className="text-[10px] font-bold text-red-500 bg-red-100 dark:bg-red-950 px-1.5 py-0.2 rounded-full">
                                      Not met
                                    </span>
                                  )}
                                </div>
                                <div className="text-[10px] text-gray-400">
                                  Accept: {verified.acceptanceRate}% • No-shows: {verified.noShows}
                                </div>
                              </div>
                            ) : (
                              <span className="text-gray-400 italic">Not verified yet</span>
                            )}
                          </td>

                          <td className="px-4 py-3.5">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                                claim.status === 'Credited'
                                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                  : claim.status === 'Pending'
                                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                                  : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                              }`}
                            >
                              {claim.status}
                            </span>
                            {claim.creditedBy && (
                              <div className="text-[9px] text-gray-400 mt-0.5">
                                By {claim.creditedBy}
                              </div>
                            )}
                          </td>

                          <td className="px-4 py-3.5 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleVerifyClaim(claim)}
                                className="px-2.5 py-1 rounded-lg border border-gray-200 dark:border-zinc-700 hover:bg-gray-50 dark:hover:bg-zinc-800 text-gray-700 dark:text-zinc-300 font-bold text-[11px]"
                              >
                                Verify
                              </button>

                              {claim.status === 'Pending' && (
                                <button
                                  type="button"
                                  onClick={() => setSelectedClaimForReview(claim)}
                                  className="delivio-btn-yellow px-2.5 py-1 rounded-lg text-[11px] font-bold shadow-xs"
                                >
                                  Credit / Review &rarr;
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* CREATE / EDIT QUEST MODAL WITH LIVE RIDER PREVIEW */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div
            className="w-full max-w-5xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="p-5 border-b border-gray-200 dark:border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-amber-400 text-black shadow-xs">
                  <Trophy className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-gray-900 dark:text-white">
                    {editingQuestId ? 'Edit Quest' : 'Create New Quest'}
                  </h3>
                  <p className="text-xs text-gray-500">All dates and daily time windows follow Philippine Time (UTC+8).</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsFormOpen(false)}
                className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body: Left form, Right mobile preview */}
            <div className="grid grid-cols-1 lg:grid-cols-12 max-h-[80vh] overflow-y-auto">
              {/* Form Side (7 cols) */}
              <form onSubmit={handleSubmitQuest} className="lg:col-span-7 p-6 space-y-4 border-r border-gray-200 dark:border-zinc-800">
                {!editingQuestId && (
                  <div className="p-3.5 rounded-2xl bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/40 flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold text-gray-900 dark:text-white">
                        Create for several days
                      </div>
                      <div className="text-[11px] text-gray-500">
                        Generates one individual quest document per day over a date range.
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsMultiDay(!isMultiDay)}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden ${
                        isMultiDay ? 'bg-amber-500' : 'bg-gray-300 dark:bg-zinc-700'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                          isMultiDay ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                )}

                {/* Title & Status */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-gray-700 dark:text-zinc-300 uppercase mb-1">
                      Quest Title <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={formTitle}
                      onChange={(e) => setFormTitle(e.target.value)}
                      required
                      placeholder="e.g. Weekend Rush Bonus"
                      className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white font-bold"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-zinc-300 uppercase mb-1">
                      Status
                    </label>
                    <select
                      value={formStatus}
                      onChange={(e) => setFormStatus(e.target.value as any)}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white font-bold"
                    >
                      <option value="active">Active</option>
                      <option value="draft">Draft</option>
                      <option value="ended">Ended</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  </div>
                </div>

                {/* Description */}
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-zinc-300 uppercase mb-1">
                    Description / Driver Pitch
                  </label>
                  <textarea
                    rows={2}
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    placeholder="Hit consecutive food trips during lunch hours to earn cash rewards!"
                    className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                  />
                </div>

                {/* Metric & Services */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-zinc-300 uppercase mb-1">
                      Target Metric
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setFormMetric('deliveries')}
                        className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all ${
                          formMetric === 'deliveries'
                            ? 'bg-amber-400 text-black border-amber-400 font-extrabold shadow-xs'
                            : 'border-gray-200 dark:border-zinc-700 text-gray-600 dark:text-zinc-300'
                        }`}
                      >
                        Completed Trips
                      </button>
                      <button
                        type="button"
                        onClick={() => setFormMetric('earnings')}
                        className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all ${
                          formMetric === 'earnings'
                            ? 'bg-amber-400 text-black border-amber-400 font-extrabold shadow-xs'
                            : 'border-gray-200 dark:border-zinc-700 text-gray-600 dark:text-zinc-300'
                        }`}
                      >
                        Driver Earnings (₱)
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-zinc-300 uppercase mb-1">
                      Eligible Services (Empty = All)
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {ALL_SERVICES.map((srv) => {
                        const s = srv.id;
                        const isSelected = formServices.includes(s);
                        return (
                          <button
                            type="button"
                            key={s}
                            onClick={() => {
                              if (isSelected) {
                                setFormServices(formServices.filter((x) => x !== s));
                              } else {
                                setFormServices([...formServices, s]);
                              }
                            }}
                            className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-colors ${
                              isSelected
                                ? 'bg-black dark:bg-white text-white dark:text-black border-transparent font-extrabold'
                                : 'bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-400 border-transparent hover:bg-gray-200'
                            }`}
                          >
                            {srv.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Dates & Hours (Philippine Time) */}
                {isMultiDay ? (
                  <div className="p-3.5 rounded-xl bg-gray-50 dark:bg-zinc-850/60 border border-gray-200 dark:border-zinc-800 space-y-2">
                    <div className="text-xs font-bold text-gray-900 dark:text-white">
                      Date Range for Daily Quests
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] uppercase font-bold text-gray-500 mb-0.5">Start Date</label>
                        <input
                          type="date"
                          value={multiDayStartDate}
                          onChange={(e) => setMultiDayStartDate(e.target.value)}
                          required
                          className="w-full px-2.5 py-1.5 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white font-bold"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase font-bold text-gray-500 mb-0.5">End Date</label>
                        <input
                          type="date"
                          value={multiDayEndDate}
                          onChange={(e) => setMultiDayEndDate(e.target.value)}
                          required
                          className="w-full px-2.5 py-1.5 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white font-bold"
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 dark:text-zinc-300 uppercase mb-1">
                        Start At (Philippine Time)
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="date"
                          value={formStartDate}
                          onChange={(e) => setFormStartDate(e.target.value)}
                          required
                          className="w-full px-2.5 py-1.5 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white font-bold"
                        />
                        <input
                          type="time"
                          value={formStartTime}
                          onChange={(e) => setFormStartTime(e.target.value)}
                          className="w-24 px-2 py-1.5 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white font-mono"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-700 dark:text-zinc-300 uppercase mb-1">
                        End At (Philippine Time)
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="date"
                          value={formEndDate}
                          onChange={(e) => setFormEndDate(e.target.value)}
                          required
                          className="w-full px-2.5 py-1.5 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white font-bold"
                        />
                        <input
                          type="time"
                          value={formEndTime}
                          onChange={(e) => setFormEndTime(e.target.value)}
                          className="w-24 px-2 py-1.5 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white font-mono"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Optional Daily Window */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-zinc-300 uppercase mb-1">
                      Daily Window From (Optional)
                    </label>
                    <input
                      type="time"
                      value={formHourFrom}
                      onChange={(e) => setFormHourFrom(e.target.value)}
                      placeholder="HH:mm"
                      className="w-full px-3 py-1.5 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-zinc-300 uppercase mb-1">
                      Daily Window To (Optional)
                    </label>
                    <input
                      type="time"
                      value={formHourTo}
                      onChange={(e) => setFormHourTo(e.target.value)}
                      placeholder="HH:mm"
                      className="w-full px-3 py-1.5 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white font-mono"
                    />
                  </div>
                </div>

                {/* Constraints: Min Acceptance Rate & Max No Shows */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-zinc-300 uppercase mb-1">
                      Min Acceptance Rate % (Optional)
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={formMinAcceptanceRate}
                      onChange={(e) => setFormMinAcceptanceRate(e.target.value)}
                      placeholder="e.g. 85"
                      className="w-full px-3 py-1.5 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white font-bold"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-zinc-300 uppercase mb-1">
                      Max No-Shows Allowed (Optional)
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={formMaxNoShows}
                      onChange={(e) => setFormMaxNoShows(e.target.value)}
                      placeholder="e.g. 0 or 1"
                      className="w-full px-3 py-1.5 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white font-bold"
                    />
                  </div>
                </div>

                {/* Goals Ladder Editor */}
                <div className="pt-2 border-t border-gray-100 dark:border-zinc-800">
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-xs font-extrabold text-gray-900 dark:text-white uppercase tracking-wider">
                      Goals Ladder Levels ({formGoals.length})
                    </label>
                    <button
                      type="button"
                      onClick={handleAddGoal}
                      className="px-2.5 py-1 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 text-xs font-bold flex items-center gap-1 hover:bg-amber-200"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add Level
                    </button>
                  </div>

                  <div className="space-y-2">
                    {formGoals.map((goal, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-2 p-2 rounded-xl bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-700 text-xs"
                      >
                        <span className="w-6 text-center font-mono font-bold text-gray-400">
                          #{idx + 1}
                        </span>

                        <div className="flex-1">
                          <span className="text-[10px] text-gray-500 uppercase block">Target</span>
                          <input
                            type="number"
                            min="1"
                            value={goal.target}
                            onChange={(e) =>
                              handleUpdateGoal(idx, 'target', Number(e.target.value))
                            }
                            className="w-full px-2 py-1 rounded-lg border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 font-bold"
                          />
                        </div>

                        <div className="flex-1">
                          <span className="text-[10px] text-gray-500 uppercase block">Reward Bonus (₱)</span>
                          <input
                            type="number"
                            min="1"
                            value={goal.reward}
                            onChange={(e) =>
                              handleUpdateGoal(idx, 'reward', Number(e.target.value))
                            }
                            className="w-full px-2 py-1 rounded-lg border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 font-bold text-emerald-600"
                          />
                        </div>

                        <button
                          type="button"
                          onClick={() => handleRemoveGoal(idx)}
                          className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg mt-3"
                          title="Remove level"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-4">
                  <button
                    type="button"
                    onClick={() => setIsFormOpen(false)}
                    className="px-4 py-2 rounded-xl text-xs font-semibold text-gray-600 dark:text-zinc-300"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmittingQuest}
                    className="delivio-btn-yellow px-5 py-2.5 rounded-xl text-xs font-extrabold flex items-center gap-2 shadow-sm"
                  >
                    {isSubmittingQuest && <Loader2 className="w-4 h-4 animate-spin" />}
                    <span>{editingQuestId ? 'Update Quest' : isMultiDay ? 'Generate Daily Quests' : 'Save & Publish Quest'}</span>
                  </button>
                </div>
              </form>

              {/* Right Side: Live Rider Mobile App Preview (5 cols) */}
              <div className="lg:col-span-5 p-6 bg-gray-50 dark:bg-zinc-950 flex flex-col items-center justify-center">
                <div className="w-full max-w-[320px] rounded-[36px] p-3.5 bg-black border-4 border-gray-800 shadow-2xl space-y-3">
                  {/* Phone Notch */}
                  <div className="w-24 h-4 bg-gray-900 rounded-full mx-auto" />

                  {/* Rider Quest Card in App */}
                  <div className="bg-white dark:bg-zinc-900 rounded-2xl p-4 shadow-md space-y-3 border border-amber-300/40">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-xl bg-amber-400 text-black flex items-center justify-center font-extrabold shadow-xs">
                          <Trophy className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="text-[11px] font-black text-gray-900 dark:text-white leading-tight">
                            {formTitle || 'Weekend Delivery Rush'}
                          </div>
                          <div className="text-[9px] text-amber-600 dark:text-amber-400 font-bold">
                            {formMetric === 'deliveries' ? 'Trip Count Challenge' : 'Earnings Boost'}
                          </div>
                        </div>
                      </div>
                      <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                        LIVE
                      </span>
                    </div>

                    <p className="text-[10px] text-gray-500 leading-snug">
                      {formDescription || 'Complete target orders before time runs out to earn your bonus.'}
                    </p>

                    {/* Milestone ladder in mobile */}
                    <div className="space-y-1.5 pt-1">
                      {formGoals.map((g, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between p-2 rounded-xl bg-gray-50 dark:bg-zinc-800/60 border border-gray-100 dark:border-zinc-700/60 text-[10px]"
                        >
                          <div className="flex items-center gap-1.5 font-bold text-gray-800 dark:text-zinc-200">
                            <span className="w-4 h-4 rounded-full bg-amber-400 text-black flex items-center justify-center font-extrabold text-[9px]">
                              {idx + 1}
                            </span>
                            <span>
                              {g.target} {formMetric === 'deliveries' ? 'Trips' : '₱'}
                            </span>
                          </div>
                          <span className="font-extrabold text-emerald-600 dark:text-emerald-400 text-[11px]">
                            +₱{g.reward}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* Simulated Progress bar */}
                    <div className="pt-2">
                      <div className="flex justify-between text-[9px] font-bold text-gray-400 mb-1">
                        <span>Your Progress (Sample)</span>
                        <span className="text-gray-700 dark:text-zinc-200">12 / {formGoals[0]?.target || 15}</span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-gray-200 dark:bg-zinc-700 overflow-hidden">
                        <div className="h-full bg-amber-400 rounded-full" style={{ width: '65%' }} />
                      </div>
                    </div>

                    {/* Window badge */}
                    {formHourFrom && formHourTo && (
                      <div className="text-[9px] font-semibold text-center text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 py-1 rounded-lg">
                        Valid daily from {formHourFrom} to {formHourTo} PHT
                      </div>
                    )}
                  </div>

                  <div className="text-center text-[10px] text-gray-400">
                    Live mobile driver preview
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CLAIM REVIEW & CREDIT MODAL */}
      {selectedClaimForReview && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div
            className="w-full max-w-lg bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl shadow-2xl p-6 overflow-hidden animate-in fade-in zoom-in-95 duration-150 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-gray-200 dark:border-zinc-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-amber-400 text-black shadow-xs">
                  <Award className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-gray-900 dark:text-white">
                    Review & Credit Quest Claim
                  </h3>
                  <p className="text-xs text-gray-500">
                    Driver: {selectedClaimForReview.riderName} ({selectedClaimForReview.riderPhone})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedClaimForReview(null)}
                className="p-1 text-gray-400 hover:text-gray-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Side-by-side: Claimed vs Verified */}
            <div className="grid grid-cols-2 gap-3 p-3.5 rounded-2xl bg-gray-50 dark:bg-zinc-850/60 border border-gray-200 dark:border-zinc-700 text-xs">
              <div>
                <span className="text-[10px] font-bold text-gray-400 uppercase block mb-1">
                  Driver's Claim
                </span>
                <div className="font-extrabold text-gray-900 dark:text-white text-sm">
                  {selectedClaimForReview.claimedTarget} Target
                </div>
                <div className="text-emerald-600 font-extrabold text-base">
                  ₱{selectedClaimForReview.claimedReward}
                </div>
              </div>

              <div>
                <span className="text-[10px] font-bold text-gray-400 uppercase block mb-1">
                  Verified In System
                </span>
                {selectedClaimForReview.verifiedValues ? (
                  <>
                    <div className="font-extrabold text-gray-900 dark:text-white text-sm">
                      {selectedClaimForReview.verifiedValues.deliveries} trips (₱{selectedClaimForReview.verifiedValues.earnings})
                    </div>
                    <div className="text-emerald-600 font-extrabold text-base">
                      ₱{selectedClaimForReview.verifiedValues.computedReward}
                    </div>
                    <div className="text-[10px] text-gray-400 mt-1">
                      Acceptance: {selectedClaimForReview.verifiedValues.acceptanceRate}% • No-shows: {selectedClaimForReview.verifiedValues.noShows}
                    </div>
                  </>
                ) : (
                  <span className="text-gray-400 italic">Not recomputed yet</span>
                )}
              </div>
            </div>

            {/* Note text for reject or not achieved */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-zinc-300 uppercase mb-1">
                Admin Note / Audit Reason
              </label>
              <textarea
                rows={2}
                value={claimRejectReason}
                onChange={(e) => setClaimRejectReason(e.target.value)}
                placeholder="Optional notes for credit or required reason if rejected..."
                className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
              />
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-gray-100 dark:border-zinc-800">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    handleUpdateClaimStatus(
                      selectedClaimForReview,
                      'Not achieved',
                      claimRejectReason || 'Did not meet milestone requirement'
                    )
                  }
                  className="px-3 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-gray-700 dark:text-zinc-300 text-xs font-bold"
                >
                  Mark Not Achieved
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleUpdateClaimStatus(
                      selectedClaimForReview,
                      'Rejected',
                      claimRejectReason || 'Invalid claim submission'
                    )
                  }
                  className="px-3 py-2 rounded-xl bg-red-50 hover:bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-300 text-xs font-bold"
                >
                  Reject
                </button>
              </div>

              <button
                type="button"
                onClick={() => handleCreditClaim(selectedClaimForReview)}
                disabled={creditingClaim}
                className="delivio-btn-yellow px-5 py-2.5 rounded-xl text-xs font-extrabold flex items-center gap-2 shadow-xs"
              >
                {creditingClaim && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>
                  Confirm & Credit ₱
                  {selectedClaimForReview.verifiedValues?.computedReward ||
                    selectedClaimForReview.claimedReward}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ACTION CONFIRMATION MODAL (End / Cancel Quest) */}
      {actionConfirmOpen && actionQuest && (
        <ConfirmationModal
          isOpen={actionConfirmOpen}
          onClose={() => {
            setActionConfirmOpen(false);
            setActionQuest(null);
          }}
          onConfirm={handleConfirmAction}
          title={`${actionType === 'end' ? 'End' : 'Cancel'} Quest: ${actionQuest.title}?`}
          message={`Are you sure you want to ${
            actionType === 'end'
              ? 'end this quest? New deliveries will no longer count towards its goals ladder, and existing claims can be verified and settled.'
              : 'cancel this quest? The quest will be marked as cancelled immediately.'
          }`}
          confirmLabel={actionType === 'end' ? 'End Quest' : 'Cancel Quest'}
          reasonRequired={false}
          isDestructive={actionType === 'cancel'}
        />
      )}
    </div>
  );
};
