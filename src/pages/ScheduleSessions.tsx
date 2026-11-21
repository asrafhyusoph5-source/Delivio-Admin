import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  db,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  onSnapshot,
  query,
  where,
  limit,
  runTransaction,
  writeBatch,
  increment,
  deleteField,
  Timestamp
} from '../firebase';
import { useAuth } from '../context/AuthContext';
import { useCity } from '../context/CityContext';
import { useToast } from '../context/ToastContext';
import { logAuditEvent } from '../utils/audit';
import { nowTs, dateToTs, formatTimestamp, parseDate } from '../utils/date';
import { ALL_SERVICES, SERVICE_LABELS, VEHICLE_TYPES, VEHICLE_LABELS } from '../constants';
import {
  SESSION_REWARD_EMOJI_PICKS,
  WEEKDAY_OPTIONS,
  generate15MinOptions,
  formatTimeDisplay12h,
  getTodayPhtDateStr,
  addDaysPhtDateStr,
  getPhtWeekdayIndex,
  makePhtTimestampDate,
  extractPhtDateAndTime,
  formatPhtWindow,
  getSessionSlotIndices,
  getRiderSlotDocId,
  isSingleEmoji,
  hasAnyRewardValue,
  buildCleanRewardsPayload,
  calculateSessionClaimRewards,
  isWithinFivePercent
} from '../utils/scheduleUtils';
import { ConfirmationModal } from '../components/common/ConfirmationModal';
import type {
  ScheduleSession,
  ScheduleBooking,
  ScheduleSessionRewards,
  SessionClaim,
  SessionClaimBreakdown,
  Rider,
  City,
  OrderServiceType
} from '../types';
import {
  CalendarClock,
  Plus,
  Users,
  Clock,
  MapPin,
  Sparkles,
  CheckCircle2,
  XCircle,
  Loader2,
  Trash2,
  UserPlus,
  Edit3,
  Ban,
  Lock,
  Unlock,
  RefreshCw,
  Award,
  Coins,
  Wallet,
  X,
  AlertTriangle,
  Zap,
  Car
} from 'lucide-react';

type ScheduleTab = 'upcoming' | 'live' | 'past' | 'claims';

interface RecomputedClaimResult {
  deliveries: number;
  earned: number;
  matchesWithin5Pct: boolean;
  deliveriesDiffPct: number;
  earnedDiffPct: number;
}

const START_TIME_OPTIONS = generate15MinOptions(false);
const END_TIME_OPTIONS = generate15MinOptions(true);

function diffPercent(a: number, b: number): number {
  const maxV = Math.max(Math.abs(a), Math.abs(b));
  if (maxV === 0) return 0;
  return Math.round((Math.abs(a - b) / maxV) * 1000) / 10;
}

export const ScheduleSessions: React.FC = () => {
  const { adminProfile } = useAuth();
  const { cities, selectedCityId } = useCity();
  const { showSuccess, showError } = useToast();

  const [activeTab, setActiveTab] = useState<ScheduleTab>('upcoming');
  const [sessions, setSessions] = useState<ScheduleSession[]>([]);
  const [claims, setClaims] = useState<SessionClaim[]>([]);
  const [riders, setRiders] = useState<Rider[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingClaims, setLoadingClaims] = useState(true);
  const [nowTickMs, setNowTickMs] = useState(() => Date.now());

  // Create / Edit Session Modal State
  const [formOpen, setFormOpen] = useState(false);
  const [editingSession, setEditingSession] = useState<ScheduleSession | null>(null);
  const [savingSession, setSavingSession] = useState(false);

  const [formTitle, setFormTitle] = useState('');
  const [formCityId, setFormCityId] = useState('');
  const [formDate, setFormDate] = useState(getTodayPhtDateStr());
  const [formStartTime, setFormStartTime] = useState('11:00');
  const [formEndTime, setFormEndTime] = useState('14:00');
  const [formSlots, setFormSlots] = useState<number>(10);
  const [formVehicleTypes, setFormVehicleTypes] = useState<string[]>([]);
  const [formBookingCloseMin, setFormBookingCloseMin] = useState<number>(30);
  const [formCancelCutoffMin, setFormCancelCutoffMin] = useState<number>(120);

  // Repeat options (Create only)
  const [repeatEnabled, setRepeatEnabled] = useState(false);
  const [repeatDays, setRepeatDays] = useState<number>(7);
  const [repeatWeekdays, setRepeatWeekdays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);

  // Rewards builder state
  const [rewardsEnabled, setRewardsEnabled] = useState(false);
  const [rewardEmoji, setRewardEmoji] = useState('⚡');
  const [rewardPerDelivery, setRewardPerDelivery] = useState<string>('');
  const [rewardStreakEvery, setRewardStreakEvery] = useState<string>('');
  const [rewardStreakBonus, setRewardStreakBonus] = useState<string>('');
  const [rewardCompletionTarget, setRewardCompletionTarget] = useState<string>('');
  const [rewardCompletionBonus, setRewardCompletionBonus] = useState<string>('');
  const [rewardMinEarnings, setRewardMinEarnings] = useState<string>('');
  const [rewardMultiplier, setRewardMultiplier] = useState<string>('');
  const [rewardCoins, setRewardCoins] = useState<string>('');
  const [rewardOnlineBonus, setRewardOnlineBonus] = useState<string>('');
  const [rewardOnlineMinPercent, setRewardOnlineMinPercent] = useState<string>('80');
  const [rewardServices, setRewardServices] = useState<OrderServiceType[]>([]);
  const [rewardNote, setRewardNote] = useState<string>('');

  // Selected Session Detail Modal
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [sessionBookings, setSessionBookings] = useState<ScheduleBooking[]>([]);
  const [loadingBookings, setLoadingBookings] = useState(false);
  const [addRiderId, setAddRiderId] = useState('');
  const [addingRider, setAddingRider] = useState(false);
  const [removingBooking, setRemovingBooking] = useState<ScheduleBooking | null>(null);
  const [cancelSessionTarget, setCancelSessionTarget] = useState<ScheduleSession | null>(null);

  // Claims tab state
  const [claimStatusFilter, setClaimStatusFilter] = useState<
    'Pending' | 'Settled' | 'Rejected' | 'all'
  >('Pending');
  const [recomputedByClaimId, setRecomputedByClaimId] = useState<
    Record<string, RecomputedClaimResult>
  >({});
  const [recomputingClaims, setRecomputingClaims] = useState(false);
  const [editedOnlineMinByClaimId, setEditedOnlineMinByClaimId] = useState<Record<string, number>>(
    {}
  );
  const [settlingClaimId, setSettlingClaimId] = useState<string | null>(null);
  const [autoSettlingClaims, setAutoSettlingClaims] = useState(false);
  const [rejectClaimTarget, setRejectClaimTarget] = useState<SessionClaim | null>(null);

  const adminUid = adminProfile?.uid || 'admin';
  const adminName = adminProfile?.name || adminProfile?.email || 'Administrator';

  const citiesMap = useMemo(() => {
    const map: Record<string, City> = {};
    cities.forEach((c) => {
      map[c.id] = c;
    });
    return map;
  }, [cities]);

  const ridersMap = useMemo(() => {
    const map: Record<string, Rider> = {};
    riders.forEach((r) => {
      map[r.id] = r;
    });
    return map;
  }, [riders]);

  // Keep live clock updated every 30s so upcoming/live/past tabs remain accurate
  useEffect(() => {
    const id = setInterval(() => setNowTickMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Live listener on scheduleSessions
  useEffect(() => {
    setLoadingSessions(true);
    const q = query(collection(db, 'scheduleSessions'), limit(300));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: ScheduleSession[] = [];
        snap.forEach((d) => {
          const dt = d.data();
          list.push({
            id: d.id,
            title: dt.title || '',
            cityId: dt.cityId || '',
            startAt: dt.startAt,
            endAt: dt.endAt,
            slots: Number(dt.slots) || 0,
            bookedCount: Number(dt.bookedCount) || 0,
            status: dt.status || 'open',
            vehicleTypes: Array.isArray(dt.vehicleTypes) ? dt.vehicleTypes : [],
            bookingCloseMin:
              typeof dt.bookingCloseMin === 'number' ? dt.bookingCloseMin : 30,
            cancelCutoffMin:
              typeof dt.cancelCutoffMin === 'number' ? dt.cancelCutoffMin : 120,
            ...(dt.rewards ? { rewards: dt.rewards } : {}),
            createdAt: dt.createdAt,
            createdBy: dt.createdBy,
            updatedAt: dt.updatedAt
          });
        });
        setSessions(list);
        setLoadingSessions(false);
      },
      (err) => {
        showError(err);
        setLoadingSessions(false);
      }
    );
    return () => unsub();
  }, [showError]);

  // Live listener on sessionClaims
  useEffect(() => {
    setLoadingClaims(true);
    const q = query(collection(db, 'sessionClaims'), limit(300));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: SessionClaim[] = [];
        snap.forEach((d) => {
          const dt = d.data();
          list.push({
            id: d.id,
            sessionId: dt.sessionId || '',
            riderId: dt.riderId || '',
            riderName: dt.riderName || 'Driver',
            status: dt.status || 'Pending',
            deliveries: Number(dt.deliveries) || 0,
            earned: Number(dt.earned) || 0,
            onlineMinutes: Number(dt.onlineMinutes) || 0,
            createdAt: dt.createdAt,
            settledAt: dt.settledAt,
            settledBy: dt.settledBy,
            bonusTotal: typeof dt.bonusTotal === 'number' ? dt.bonusTotal : undefined,
            breakdown: dt.breakdown,
            note: dt.note
          });
        });
        list.sort((a, b) => {
          const tA = parseDate(a.createdAt)?.getTime() || 0;
          const tB = parseDate(b.createdAt)?.getTime() || 0;
          return tB - tA;
        });
        setClaims(list);
        setLoadingClaims(false);
      },
      (err) => {
        showError(err);
        setLoadingClaims(false);
      }
    );
    return () => unsub();
  }, [showError]);

  // Load riders once for Add Rider picker & vehicle display
  useEffect(() => {
    getDocs(query(collection(db, 'riders'), limit(400)))
      .then((snap) => {
        const list: Rider[] = [];
        snap.forEach((d) => {
          const dt = d.data();
          list.push({
            id: d.id,
            name: dt.name || 'Driver',
            email: dt.email || '',
            phone: dt.phone || '',
            riderCode: dt.riderCode || d.id.slice(0, 6),
            status: dt.status || 'active',
            cityId: dt.cityId,
            vehicleType: dt.vehicleType || 'motorcycle',
            allowedServices: Array.isArray(dt.allowedServices) ? dt.allowedServices : [],
            activeServices: Array.isArray(dt.activeServices) ? dt.activeServices : [],
            isOnline: Boolean(dt.isOnline),
            coins: Number(dt.coins) || 0,
            walletBalance: Number(dt.walletBalance) || 0,
            linkedCustomerUid: dt.linkedCustomerUid || null
          });
        });
        list.sort((a, b) => a.name.localeCompare(b.name));
        setRiders(list);
      })
      .catch(() => {});
  }, []);

  const sessionsMap = useMemo(() => {
    const map: Record<string, ScheduleSession> = {};
    sessions.forEach((s) => {
      map[s.id] = s;
    });
    return map;
  }, [sessions]);

  const selectedSession = useMemo(
    () => (selectedSessionId ? sessionsMap[selectedSessionId] || null : null),
    [selectedSessionId, sessionsMap]
  );

  // Listen to selected session bookings
  useEffect(() => {
    if (!selectedSessionId) {
      setSessionBookings([]);
      return;
    }
    setLoadingBookings(true);
    const unsub = onSnapshot(
      collection(db, 'scheduleSessions', selectedSessionId, 'bookings'),
      (snap) => {
        const list: ScheduleBooking[] = [];
        snap.forEach((d) => {
          const dt = d.data();
          list.push({
            id: d.id,
            riderId: dt.riderId || d.id,
            riderName: dt.riderName || ridersMap[d.id]?.name || 'Driver',
            startAt: dt.startAt,
            endAt: dt.endAt,
            bookedAt: dt.bookedAt,
            vehicleType: dt.vehicleType || ridersMap[d.id]?.vehicleType
          });
        });
        list.sort((a, b) => {
          const tA = parseDate(a.bookedAt)?.getTime() || 0;
          const tB = parseDate(b.bookedAt)?.getTime() || 0;
          return tA - tB;
        });
        setSessionBookings(list);
        setLoadingBookings(false);
      },
      (err) => {
        showError(err);
        setLoadingBookings(false);
      }
    );
    return () => unsub();
  }, [selectedSessionId, ridersMap, showError]);

  // Partition sessions into Upcoming / Live / Past respecting city selector
  const { upcomingSessions, liveSessions, pastSessions } = useMemo(() => {
    const upcoming: ScheduleSession[] = [];
    const live: ScheduleSession[] = [];
    const past: ScheduleSession[] = [];

    sessions.forEach((s) => {
      if (selectedCityId !== 'all' && s.cityId !== selectedCityId) return;
      const startMs = parseDate(s.startAt)?.getTime() || 0;
      const endMs = parseDate(s.endAt)?.getTime() || 0;

      if (s.status === 'cancelled' || endMs <= nowTickMs) {
        past.push(s);
      } else if (startMs <= nowTickMs && endMs > nowTickMs) {
        live.push(s);
      } else {
        upcoming.push(s);
      }
    });

    upcoming.sort((a, b) => (parseDate(a.startAt)?.getTime() || 0) - (parseDate(b.startAt)?.getTime() || 0));
    live.sort((a, b) => (parseDate(a.startAt)?.getTime() || 0) - (parseDate(b.startAt)?.getTime() || 0));
    past.sort((a, b) => (parseDate(b.startAt)?.getTime() || 0) - (parseDate(a.startAt)?.getTime() || 0));

    return { upcomingSessions: upcoming, liveSessions: live, pastSessions: past };
  }, [sessions, selectedCityId, nowTickMs]);

  const pendingClaimsCount = useMemo(
    () => claims.filter((c) => c.status === 'Pending').length,
    [claims]
  );

  // Recompute claim numbers from orders collection for Pending claims
  const recomputePendingClaims = useCallback(async () => {
    const pendingList = claims.filter((c) => c.status === 'Pending');
    if (pendingList.length === 0) return;
    try {
      setRecomputingClaims(true);
      const uniqueRiderIds = Array.from(new Set(pendingList.map((c) => c.riderId).filter(Boolean)));
      const ordersByRider: Record<string, any[]> = {};

      await Promise.all(
        uniqueRiderIds.map(async (rId) => {
          const snap = await getDocs(
            query(collection(db, 'orders'), where('riderId', '==', rId), limit(300))
          );
          const list: any[] = [];
          snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
          ordersByRider[rId] = list;
        })
      );

      const nextMap: Record<string, RecomputedClaimResult> = {};
      pendingList.forEach((claim) => {
        const sess = sessionsMap[claim.sessionId];
        if (!sess) return;
        const startMs = parseDate(sess.startAt)?.getTime() || 0;
        const endMs = parseDate(sess.endAt)?.getTime() || 0;
        const allowedServices = sess.rewards?.services;

        let deliveries = 0;
        let earned = 0;

        (ordersByRider[claim.riderId] || []).forEach((ord) => {
          const st = String(ord.status || '').toLowerCase();
          if (st !== 'delivered' && st !== 'completed') return;
          const delDate =
            parseDate(ord.deliveredAt) || parseDate(ord.completedAt) || parseDate(ord.updatedAt) || parseDate(ord.createdAt);
          if (!delDate) return;
          const ms = delDate.getTime();
          if (ms < startMs || ms >= endMs) return;

          if (Array.isArray(allowedServices) && allowedServices.length > 0) {
            if (!allowedServices.includes(ord.serviceType)) return;
          }

          deliveries += 1;
          earned += Number(
            ord.riderEarning?.total ?? ord.riderEarning?.net ?? ord.riderEarning?.deliveryFee ?? 0
          );
        });

        earned = Math.round(earned * 100) / 100;
        const delMatch = isWithinFivePercent(claim.deliveries, deliveries);
        const earnMatch = isWithinFivePercent(claim.earned, earned);

        nextMap[claim.id] = {
          deliveries,
          earned,
          matchesWithin5Pct: delMatch && earnMatch,
          deliveriesDiffPct: diffPercent(claim.deliveries, deliveries),
          earnedDiffPct: diffPercent(claim.earned, earned)
        };
      });

      setRecomputedByClaimId(nextMap);
    } catch (err: any) {
      showError(err);
    } finally {
      setRecomputingClaims(false);
    }
  }, [claims, sessionsMap, showError]);

  useEffect(() => {
    if (activeTab === 'claims' && claims.length > 0 && sessions.length > 0) {
      recomputePendingClaims();
    }
  }, [activeTab, claims.length, sessions.length, recomputePendingClaims]);

  // Seed editable onlineMinutes whenever claims load
  useEffect(() => {
    setEditedOnlineMinByClaimId((prev) => {
      const next = { ...prev };
      let changed = false;
      claims.forEach((c) => {
        if (next[c.id] === undefined) {
          next[c.id] = c.onlineMinutes;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [claims]);

  // Draft rewards object for preview & save
  const draftRewardsObj: Partial<ScheduleSessionRewards> = useMemo(
    () => ({
      emoji: rewardEmoji,
      perDelivery: rewardPerDelivery ? Number(rewardPerDelivery) : undefined,
      streakEvery: rewardStreakEvery ? Number(rewardStreakEvery) : undefined,
      streakBonus: rewardStreakBonus ? Number(rewardStreakBonus) : undefined,
      completionTarget: rewardCompletionTarget ? Number(rewardCompletionTarget) : undefined,
      completionBonus: rewardCompletionBonus ? Number(rewardCompletionBonus) : undefined,
      minEarnings: rewardMinEarnings ? Number(rewardMinEarnings) : undefined,
      multiplier: rewardMultiplier ? Number(rewardMultiplier) : undefined,
      coins: rewardCoins ? Number(rewardCoins) : undefined,
      onlineBonus: rewardOnlineBonus ? Number(rewardOnlineBonus) : undefined,
      onlineMinPercent: rewardOnlineMinPercent ? Number(rewardOnlineMinPercent) : 80,
      services: rewardServices,
      note: rewardNote
    }),
    [
      rewardEmoji,
      rewardPerDelivery,
      rewardStreakEvery,
      rewardStreakBonus,
      rewardCompletionTarget,
      rewardCompletionBonus,
      rewardMinEarnings,
      rewardMultiplier,
      rewardCoins,
      rewardOnlineBonus,
      rewardOnlineMinPercent,
      rewardServices,
      rewardNote
    ]
  );

  // Repeat dates calculation
  const plannedDates = useMemo(() => {
    if (editingSession || !repeatEnabled) {
      return [formDate];
    }
    const count = Math.max(1, Math.min(31, Math.round(Number(repeatDays) || 1)));
    const dates: string[] = [];
    for (let i = 0; i < count; i++) {
      const dStr = addDaysPhtDateStr(formDate, i);
      const wd = getPhtWeekdayIndex(dStr);
      if (repeatWeekdays.length === 0 || repeatWeekdays.includes(wd)) {
        dates.push(dStr);
      }
    }
    return dates;
  }, [editingSession, repeatEnabled, formDate, repeatDays, repeatWeekdays]);

  const openNewSessionModal = () => {
    setEditingSession(null);
    setFormTitle('');
    setFormCityId(
      selectedCityId !== 'all' ? selectedCityId : cities[0]?.id || ''
    );
    setFormDate(getTodayPhtDateStr());
    setFormStartTime('11:00');
    setFormEndTime('14:00');
    setFormSlots(10);
    setFormVehicleTypes([]);
    setFormBookingCloseMin(30);
    setFormCancelCutoffMin(120);
    setRepeatEnabled(false);
    setRepeatDays(7);
    setRepeatWeekdays([0, 1, 2, 3, 4, 5, 6]);

    setRewardsEnabled(false);
    setRewardEmoji('⚡');
    setRewardPerDelivery('');
    setRewardStreakEvery('');
    setRewardStreakBonus('');
    setRewardCompletionTarget('');
    setRewardCompletionBonus('');
    setRewardMinEarnings('');
    setRewardMultiplier('');
    setRewardCoins('');
    setRewardOnlineBonus('');
    setRewardOnlineMinPercent('80');
    setRewardServices([]);
    setRewardNote('');

    setFormOpen(true);
  };

  const openEditSessionModal = (sess: ScheduleSession) => {
    setEditingSession(sess);
    setFormTitle(sess.title || '');
    setFormCityId(sess.cityId || cities[0]?.id || '');
    const startPht = extractPhtDateAndTime(sess.startAt);
    const endPht = extractPhtDateAndTime(sess.endAt);
    setFormDate(startPht.dateStr);
    setFormStartTime(startPht.hhmm);
    // Handle midnight rollover next day -> 24:00
    setFormEndTime(endPht.dateStr !== startPht.dateStr && endPht.hhmm === '00:00' ? '24:00' : endPht.hhmm);
    setFormSlots(sess.slots);
    setFormVehicleTypes(sess.vehicleTypes || []);
    setFormBookingCloseMin(sess.bookingCloseMin ?? 30);
    setFormCancelCutoffMin(sess.cancelCutoffMin ?? 120);
    setRepeatEnabled(false);

    if (sess.rewards && hasAnyRewardValue(sess.rewards)) {
      setRewardsEnabled(true);
      setRewardEmoji(sess.rewards.emoji || '⚡');
      setRewardPerDelivery(sess.rewards.perDelivery ? String(sess.rewards.perDelivery) : '');
      setRewardStreakEvery(sess.rewards.streakEvery ? String(sess.rewards.streakEvery) : '');
      setRewardStreakBonus(sess.rewards.streakBonus ? String(sess.rewards.streakBonus) : '');
      setRewardCompletionTarget(
        sess.rewards.completionTarget ? String(sess.rewards.completionTarget) : ''
      );
      setRewardCompletionBonus(
        sess.rewards.completionBonus ? String(sess.rewards.completionBonus) : ''
      );
      setRewardMinEarnings(sess.rewards.minEarnings ? String(sess.rewards.minEarnings) : '');
      setRewardMultiplier(sess.rewards.multiplier ? String(sess.rewards.multiplier) : '');
      setRewardCoins(sess.rewards.coins ? String(sess.rewards.coins) : '');
      setRewardOnlineBonus(sess.rewards.onlineBonus ? String(sess.rewards.onlineBonus) : '');
      setRewardOnlineMinPercent(
        sess.rewards.onlineMinPercent ? String(sess.rewards.onlineMinPercent) : '80'
      );
      setRewardServices(Array.isArray(sess.rewards.services) ? sess.rewards.services : []);
      setRewardNote(sess.rewards.note || '');
    } else {
      setRewardsEnabled(false);
      setRewardEmoji('⚡');
      setRewardPerDelivery('');
      setRewardStreakEvery('');
      setRewardStreakBonus('');
      setRewardCompletionTarget('');
      setRewardCompletionBonus('');
      setRewardMinEarnings('');
      setRewardMultiplier('');
      setRewardCoins('');
      setRewardOnlineBonus('');
      setRewardOnlineMinPercent('80');
      setRewardServices([]);
      setRewardNote('');
    }
    setFormOpen(true);
  };

  const handleSaveSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formCityId) {
      showError('Please choose a city.');
      return;
    }

    const slotsNum = Math.round(Number(formSlots) || 0);
    if (slotsNum < 1) {
      showError('Slots must be at least 1 rider.');
      return;
    }

    if (editingSession && editingSession.bookedCount > 0 && slotsNum < editingSession.bookedCount) {
      showError(`Slots cannot be lower than current bookings (${editingSession.bookedCount}).`);
      return;
    }

    const startDate = makePhtTimestampDate(formDate, formStartTime);
    const endDate = makePhtTimestampDate(formDate, formEndTime);
    if (!(endDate.getTime() > startDate.getTime())) {
      showError('End time must be after Start time.');
      return;
    }

    // Validate rewards if toggled ON
    let cleanRewards: ScheduleSessionRewards | undefined;
    if (rewardsEnabled) {
      if (!isSingleEmoji(rewardEmoji)) {
        showError('When rewards are enabled, enter exactly one emoji (e.g. ⚡ or 👑).');
        return;
      }
      if (rewardStreakEvery && !rewardStreakBonus) {
        showError('Enter a streak bonus amount for every Nth delivery.');
        return;
      }
      if (!rewardStreakEvery && rewardStreakBonus) {
        showError('Enter the streak interval N (every Nth delivery).');
        return;
      }
      if (rewardCompletionTarget && !rewardCompletionBonus) {
        showError('Enter a completion bonus amount.');
        return;
      }
      if (!rewardCompletionTarget && rewardCompletionBonus) {
        showError('Enter the completion delivery target N.');
        return;
      }
      if (rewardMultiplier && (Number(rewardMultiplier) < 1.1 || Number(rewardMultiplier) > 2.0)) {
        showError('Peak multiplier must be between x1.1 and x2.0.');
        return;
      }
      cleanRewards = buildCleanRewardsPayload(draftRewardsObj);
      if (!cleanRewards) {
        showError('Fill at least one reward below, or turn off "Add rewards".');
        return;
      }
    }

    try {
      setSavingSession(true);
      const now = nowTs();
      const closeMin = Math.max(0, Math.round(Number(formBookingCloseMin) || 0));
      const cutoffMin = Math.max(0, Math.round(Number(formCancelCutoffMin) || 0));

      if (editingSession) {
        const hasBookings = editingSession.bookedCount > 0;
        const updatePayload: Record<string, any> = {
          title: formTitle.trim(),
          cityId: formCityId,
          slots: slotsNum,
          vehicleTypes: formVehicleTypes,
          bookingCloseMin: closeMin,
          cancelCutoffMin: cutoffMin,
          updatedAt: now
        };

        if (!hasBookings) {
          updatePayload.startAt = dateToTs(startDate);
          updatePayload.endAt = dateToTs(endDate);
        }

        if (cleanRewards) {
          updatePayload.rewards = cleanRewards;
        } else {
          updatePayload.rewards = deleteField();
        }

        await updateDoc(doc(db, 'scheduleSessions', editingSession.id), updatePayload);
        await logAuditEvent({
          adminId: adminUid,
          adminName,
          adminEmail: adminProfile?.email,
          action: 'UPDATE_SCHEDULE_SESSION',
          entityType: 'scheduleSessions',
          entityId: editingSession.id,
          details: `Updated schedule session ${editingSession.title || editingSession.id} (${
            hasBookings ? 'times locked due to bookings' : `${formStartTime}-${formEndTime}`
          }, slots: ${slotsNum})`
        });

        showSuccess('Updated schedule session.');
        setFormOpen(false);
        return;
      }

      // Creating new session(s)
      if (plannedDates.length === 0) {
        showError('No matching dates found for the selected repeat weekdays.');
        return;
      }

      const batch = writeBatch(db);
      const createdIds: string[] = [];

      plannedDates.forEach((dStr) => {
        const sDt = makePhtTimestampDate(dStr, formStartTime);
        const eDt = makePhtTimestampDate(dStr, formEndTime);
        const ref = doc(collection(db, 'scheduleSessions'));
        createdIds.push(ref.id);

        const docPayload: Record<string, any> = {
          title: formTitle.trim(),
          cityId: formCityId,
          startAt: dateToTs(sDt),
          endAt: dateToTs(eDt),
          slots: slotsNum,
          bookedCount: 0,
          status: 'open',
          vehicleTypes: formVehicleTypes,
          bookingCloseMin: closeMin,
          cancelCutoffMin: cutoffMin,
          createdAt: now,
          createdBy: adminName
        };

        if (cleanRewards) {
          docPayload.rewards = cleanRewards;
        }

        batch.set(ref, docPayload);
      });

      await batch.commit();

      await logAuditEvent({
        adminId: adminUid,
        adminName,
        adminEmail: adminProfile?.email,
        action: 'CREATE_SCHEDULE_SESSIONS',
        entityType: 'scheduleSessions',
        entityId: createdIds[0],
        details: `Created ${createdIds.length} schedule session(s) in ${
          citiesMap[formCityId]?.name || formCityId
        } (${formStartTime}-${formEndTime}, slots: ${slotsNum}${
          cleanRewards ? `, rewards: ${cleanRewards.emoji}` : ''
        })`
      });

      showSuccess(`Created ${createdIds.length} schedule session${createdIds.length > 1 ? 's' : ''}!`);
      setFormOpen(false);
    } catch (err: any) {
      showError(err);
    } finally {
      setSavingSession(false);
    }
  };

  // Close or Reopen Session
  const handleToggleCloseSession = async (sess: ScheduleSession) => {
    if (sess.status === 'cancelled') return;
    const nextStatus = sess.status === 'open' ? 'closed' : 'open';
    try {
      await updateDoc(doc(db, 'scheduleSessions', sess.id), {
        status: nextStatus,
        updatedAt: nowTs()
      });
      await logAuditEvent({
        adminId: adminUid,
        adminName,
        adminEmail: adminProfile?.email,
        action: nextStatus === 'closed' ? 'CLOSE_SCHEDULE_SESSION' : 'REOPEN_SCHEDULE_SESSION',
        entityType: 'scheduleSessions',
        entityId: sess.id,
        details: `${nextStatus === 'closed' ? 'Closed' : 'Reopened'} schedule session ${
          sess.title || sess.id
        }`
      });
      showSuccess(nextStatus === 'closed' ? 'Session closed to new bookings.' : 'Session reopened.');
    } catch (err: any) {
      showError(err);
    }
  };

  // Add Rider to Session (writes booking + 15-min riderSlots locks + increments bookedCount)
  const handleAddRiderToSession = async () => {
    if (!selectedSession || !addRiderId) return;
    const rider = ridersMap[addRiderId];
    if (!rider) return;

    if (selectedSession.vehicleTypes.length > 0) {
      const rv = String(rider.vehicleType || '').toLowerCase();
      if (!selectedSession.vehicleTypes.includes(rv)) {
        showError(
          `${rider.name} drives ${VEHICLE_LABELS[rv as keyof typeof VEHICLE_LABELS] || rv}, which is not in this session's vehicle filter.`
        );
        return;
      }
    }

    const slotIndices = getSessionSlotIndices(selectedSession.startAt, selectedSession.endAt);
    if (slotIndices.length === 0) {
      showError('Invalid session time window.');
      return;
    }

    try {
      setAddingRider(true);
      const sessRef = doc(db, 'scheduleSessions', selectedSession.id);
      const bookingRef = doc(db, 'scheduleSessions', selectedSession.id, 'bookings', rider.id);
      const slotRefs = slotIndices.map((idx) =>
        doc(db, 'riderSlots', getRiderSlotDocId(rider.id, idx))
      );
      const now = nowTs();

      await runTransaction(db, async (tx) => {
        const sSnap = await tx.get(sessRef);
        if (!sSnap.exists()) throw new Error('Session not found.');
        const sData = sSnap.data();
        if (sData.status === 'cancelled') throw new Error('Cannot add rider to a cancelled session.');
        if ((Number(sData.bookedCount) || 0) >= (Number(sData.slots) || 0)) {
          throw new Error('Session is already full.');
        }

        const existingBooking = await tx.get(bookingRef);
        if (existingBooking.exists()) {
          throw new Error(`${rider.name} is already booked in this session.`);
        }

        for (const sRef of slotRefs) {
          const lockSnap = await tx.get(sRef);
          if (lockSnap.exists()) {
            const conflictSessId = lockSnap.data()?.sessionId;
            throw new Error(
              `${rider.name} already has a conflicting slot lock (session ${conflictSessId || 'another session'}).`
            );
          }
        }

        tx.set(bookingRef, {
          riderId: rider.id,
          riderName: rider.name,
          startAt: selectedSession.startAt,
          endAt: selectedSession.endAt,
          bookedAt: now,
          vehicleType: rider.vehicleType || 'motorcycle'
        });

        slotRefs.forEach((sRef) => {
          tx.set(sRef, {
            riderId: rider.id,
            sessionId: selectedSession.id
          });
        });

        tx.update(sessRef, {
          bookedCount: increment(1),
          updatedAt: now
        });
      });

      await logAuditEvent({
        adminId: adminUid,
        adminName,
        adminEmail: adminProfile?.email,
        action: 'ADD_RIDER_TO_SESSION',
        entityType: 'scheduleSessions',
        entityId: selectedSession.id,
        details: `Manually added rider ${rider.name} (${rider.id}) to session ${selectedSession.title || selectedSession.id}`
      });

      setAddRiderId('');
      showSuccess(`Added ${rider.name} to session.`);
    } catch (err: any) {
      showError(err);
    } finally {
      setAddingRider(false);
    }
  };

  // Remove Rider from Session (deletes booking + riderSlots + decrements bookedCount + inbox notice)
  const handleConfirmRemoveRider = async () => {
    if (!selectedSession || !removingBooking) return;
    const riderId = removingBooking.riderId || removingBooking.id;
    const slotIndices = getSessionSlotIndices(selectedSession.startAt, selectedSession.endAt);

    try {
      const sessRef = doc(db, 'scheduleSessions', selectedSession.id);
      const bookingRef = doc(db, 'scheduleSessions', selectedSession.id, 'bookings', riderId);
      const now = nowTs();

      await runTransaction(db, async (tx) => {
        const sSnap = await tx.get(sessRef);
        const curBooked = sSnap.exists() ? Number(sSnap.data()?.bookedCount || 0) : 0;

        tx.delete(bookingRef);
        slotIndices.forEach((idx) => {
          tx.delete(doc(db, 'riderSlots', getRiderSlotDocId(riderId, idx)));
        });
        if (sSnap.exists()) {
          tx.update(sessRef, {
            bookedCount: Math.max(0, curBooked - 1),
            updatedAt: now
          });
        }
      });

      const win = formatPhtWindow(selectedSession.startAt, selectedSession.endAt);
      await addDoc(collection(db, 'inbox'), {
        riderId,
        riderName: removingBooking.riderName,
        audience: 'single_rider',
        title: 'Schedule booking removed',
        body: `Your booking for ${selectedSession.title || 'Schedule Session'} (${win.dateLabel}, ${win.timeRange}) was removed by operations.`,
        category: 'alert',
        sentBy: adminName,
        createdAt: now
      });

      await logAuditEvent({
        adminId: adminUid,
        adminName,
        adminEmail: adminProfile?.email,
        action: 'REMOVE_RIDER_FROM_SESSION',
        entityType: 'scheduleSessions',
        entityId: selectedSession.id,
        details: `Removed rider ${removingBooking.riderName} (${riderId}) from session ${selectedSession.id}, freed ${slotIndices.length} slot locks, sent inbox notice.`
      });

      setRemovingBooking(null);
      showSuccess(`Removed ${removingBooking.riderName} and freed their slots.`);
    } catch (err: any) {
      showError(err);
    }
  };

  // Cancel Session (status cancelled, delete all bookings & slots, inbox notice to every rider)
  const handleConfirmCancelSession = async () => {
    if (!cancelSessionTarget) return;
    try {
      const sess = cancelSessionTarget;
      const bookingsSnap = await getDocs(
        collection(db, 'scheduleSessions', sess.id, 'bookings')
      );
      const slotIndices = getSessionSlotIndices(sess.startAt, sess.endAt);
      const win = formatPhtWindow(sess.startAt, sess.endAt);
      const now = nowTs();

      const batch = writeBatch(db);
      batch.update(doc(db, 'scheduleSessions', sess.id), {
        status: 'cancelled',
        bookedCount: 0,
        updatedAt: now
      });

      const bookedRiders: { riderId: string; riderName: string }[] = [];
      bookingsSnap.forEach((bDoc) => {
        const dt = bDoc.data();
        const rId = dt.riderId || bDoc.id;
        bookedRiders.push({ riderId: rId, riderName: dt.riderName || 'Driver' });
        batch.delete(bDoc.ref);
        slotIndices.forEach((idx) => {
          batch.delete(doc(db, 'riderSlots', getRiderSlotDocId(rId, idx)));
        });
      });

      await batch.commit();

      // Send each booked rider an inbox notice
      await Promise.all(
        bookedRiders.map((br) =>
          addDoc(collection(db, 'inbox'), {
            riderId: br.riderId,
            riderName: br.riderName,
            audience: 'single_rider',
            title: 'Schedule session cancelled',
            body: `The scheduled session ${sess.title ? `"${sess.title}" ` : ''}(${win.dateLabel}, ${win.timeRange}) has been cancelled. Your reserved time slots are now free.`,
            category: 'alert',
            sentBy: adminName,
            createdAt: now
          })
        )
      );

      await logAuditEvent({
        adminId: adminUid,
        adminName,
        adminEmail: adminProfile?.email,
        action: 'CANCEL_SCHEDULE_SESSION',
        entityType: 'scheduleSessions',
        entityId: sess.id,
        details: `Cancelled session ${sess.title || sess.id}; freed ${bookedRiders.length} booked rider(s) and notified each via inbox.`
      });

      setCancelSessionTarget(null);
      showSuccess(
        `Session cancelled and freed ${bookedRiders.length} rider booking(s).`
      );
    } catch (err: any) {
      showError(err);
    }
  };

  // Atomic Settle Claim (credits rider wallet once + grants tier coins + inbox notice + audit log)
  const settleSingleClaim = async (
    claim: SessionClaim,
    overrideOnlineMinutes?: number,
    overrideAdminLabel?: string
  ) => {
    const session = sessionsMap[claim.sessionId];
    if (!session) {
      throw new Error(`Session "${claim.sessionId}" not found for claim.`);
    }
    const recomp = recomputedByClaimId[claim.id];
    const usedDeliveries = recomp ? recomp.deliveries : claim.deliveries;
    const usedEarned = recomp ? recomp.earned : claim.earned;
    const usedOnlineMin =
      overrideOnlineMinutes !== undefined
        ? overrideOnlineMinutes
        : editedOnlineMinByClaimId[claim.id] ?? claim.onlineMinutes;

    const { bonusTotal, breakdown } = calculateSessionClaimRewards({
      session,
      deliveries: usedDeliveries,
      earned: usedEarned,
      onlineMinutes: usedOnlineMin
    });

    const now = nowTs();
    const actorName = overrideAdminLabel || adminName;
    const claimRef = doc(db, 'sessionClaims', claim.id);
    const riderRef = doc(db, 'riders', claim.riderId);

    // Pre-fetch rider doc so we know linkedCustomerUid if present
    const riderSnapPre = await getDoc(riderRef);
    const linkedCustomerUid = riderSnapPre.exists()
      ? riderSnapPre.data()?.linkedCustomerUid
      : null;

    await runTransaction(db, async (tx) => {
      const cSnap = await tx.get(claimRef);
      if (!cSnap.exists()) throw new Error('Claim document no longer exists.');
      if (cSnap.data()?.status !== 'Pending') {
        throw new Error('This claim has already been settled or rejected.');
      }

      const rSnap = await tx.get(riderRef);
      let userSnap = null;
      const userRef = linkedCustomerUid ? doc(db, 'users', linkedCustomerUid) : null;
      if (userRef) {
        userSnap = await tx.get(userRef);
      }

      // 1. Update claim status atomically
      tx.update(claimRef, {
        status: 'Settled',
        settledAt: now,
        settledBy: actorName,
        bonusTotal,
        onlineMinutes: usedOnlineMin,
        breakdown
      });

      // 2. Credit cash bonus to wallet (same routine as Quests.tsx)
      if (bonusTotal > 0) {
        const txnRef = doc(collection(db, 'walletTransactions'));
        if (userRef && userSnap) {
          const oldBal = userSnap.exists() ? Number(userSnap.data()?.walletBalance || 0) : 0;
          const newBal = oldBal + bonusTotal;
          if (userSnap.exists()) {
            tx.update(userRef, { walletBalance: newBal, updatedAt: now });
          } else {
            tx.set(userRef, { walletBalance: newBal, updatedAt: now }, { merge: true });
          }
          tx.set(txnRef, {
            riderId: claim.riderId,
            customerId: linkedCustomerUid,
            amount: bonusTotal,
            type: 'schedule_reward',
            sessionId: session.id,
            sessionTitle: session.title || 'Schedule Session',
            description: `Schedule Session Bonus: ${session.title || formatPhtWindow(session.startAt, session.endAt).timeRange}`,
            balanceAfter: newBal,
            createdAt: now,
            adminId: adminUid,
            adminName: actorName
          });
        } else {
          const oldBal = rSnap.exists() ? Number(rSnap.data()?.walletBalance || 0) : 0;
          const newBal = oldBal + bonusTotal;
          tx.update(riderRef, { walletBalance: newBal, updatedAt: now });
          tx.set(txnRef, {
            riderId: claim.riderId,
            amount: bonusTotal,
            type: 'schedule_reward',
            sessionId: session.id,
            sessionTitle: session.title || 'Schedule Session',
            description: `Schedule Session Bonus: ${session.title || formatPhtWindow(session.startAt, session.endAt).timeRange}`,
            balanceAfter: newBal,
            createdAt: now,
            adminId: adminUid,
            adminName: actorName
          });
        }
      }

      // 3. Grant tier coins (same pattern as TiersCoins.tsx)
      if (breakdown.coins > 0) {
        tx.update(riderRef, {
          coins: increment(breakdown.coins)
        });
        const coinTxnRef = doc(collection(db, 'coinTransactions'));
        tx.set(coinTxnRef, {
          riderId: claim.riderId,
          amount: breakdown.coins,
          type: 'schedule_reward',
          reason: `Schedule Session Attendance Coins (${session.title || session.id})`,
          adminId: adminUid,
          createdAt: now
        });
      }
    });

    // 4. Send rider inbox notice
    const win = formatPhtWindow(session.startAt, session.endAt);
    await addDoc(collection(db, 'inbox'), {
      riderId: claim.riderId,
      riderName: claim.riderName,
      audience: 'single_rider',
      title: 'Session rewards settled',
      body: `Your rewards for ${session.title || 'Schedule Session'} (${win.dateLabel}, ${win.timeRange}) are settled: ₱${bonusTotal.toFixed(2)} credited to wallet${
        breakdown.coins > 0 ? ` + ${breakdown.coins} tier coins` : ''
      }.`,
      category: 'promo',
      sentBy: actorName,
      createdAt: now
    });

    await logAuditEvent({
      adminId: adminUid,
      adminName: actorName,
      adminEmail: adminProfile?.email,
      action: 'SETTLE_SESSION_CLAIM',
      entityType: 'sessionClaims',
      entityId: claim.id,
      details: `Settled session claim for ${claim.riderName}: ₱${bonusTotal.toFixed(2)} wallet bonus, ${breakdown.coins} coins (${usedDeliveries} deliveries, ₱${usedEarned} earned, ${usedOnlineMin} online min)`
    });

    return { bonusTotal, coins: breakdown.coins };
  };

  const handleSettleClaim = async (claim: SessionClaim) => {
    try {
      setSettlingClaimId(claim.id);
      const res = await settleSingleClaim(claim);
      showSuccess(
        `Settled claim for ${claim.riderName}: ₱${res.bonusTotal.toFixed(2)}${
          res.coins > 0 ? ` + ${res.coins} coins` : ''
        }.`
      );
    } catch (err: any) {
      showError(err);
    } finally {
      setSettlingClaimId(null);
    }
  };

  const handleConfirmRejectClaim = async (note: string) => {
    if (!rejectClaimTarget) return;
    try {
      await updateDoc(doc(db, 'sessionClaims', rejectClaimTarget.id), {
        status: 'Rejected',
        note: note.trim(),
        settledAt: nowTs(),
        settledBy: adminName
      });

      await logAuditEvent({
        adminId: adminUid,
        adminName,
        adminEmail: adminProfile?.email,
        action: 'REJECT_SESSION_CLAIM',
        entityType: 'sessionClaims',
        entityId: rejectClaimTarget.id,
        details: `Rejected session claim for ${rejectClaimTarget.riderName}: ${note.trim()}`,
        reason: note.trim()
      });

      showSuccess(`Rejected claim for ${rejectClaimTarget.riderName}.`);
      setRejectClaimTarget(null);
    } catch (err: any) {
      showError(err);
    }
  };

  // Auto-settle all Pending claims whose recomputed deliveries & earnings match within 5%
  const handleAutoSettleMatchingClaims = async () => {
    const pendingList = claims.filter((c) => c.status === 'Pending');
    if (pendingList.length === 0) {
      showError('No pending claims to auto-settle.');
      return;
    }

    try {
      setAutoSettlingClaims(true);
      let settledCount = 0;
      let skippedCount = 0;

      for (const claim of pendingList) {
        const recomp = recomputedByClaimId[claim.id];
        const sess = sessionsMap[claim.sessionId];
        if (!sess || !recomp || !recomp.matchesWithin5Pct) {
          skippedCount += 1;
          continue;
        }
        try {
          await settleSingleClaim(claim, claim.onlineMinutes, 'Auto-Settle (Within 5%)');
          settledCount += 1;
        } catch {
          skippedCount += 1;
        }
      }

      if (settledCount > 0) {
        showSuccess(
          `Auto-settled ${settledCount} matching claim(s)${
            skippedCount > 0 ? ` (${skippedCount} skipped due to >5% mismatch)` : ''
          }.`
        );
      } else {
        showError(
          `No pending claims matched within 5% (${skippedCount} skipped). Review manually.`
        );
      }
    } catch (err: any) {
      showError(err);
    } finally {
      setAutoSettlingClaims(false);
    }
  };

  const filteredClaims = useMemo(() => {
    return claims.filter((c) => {
      if (claimStatusFilter !== 'all' && c.status !== claimStatusFilter) return false;
      const sess = sessionsMap[c.sessionId];
      if (selectedCityId !== 'all' && sess && sess.cityId !== selectedCityId) return false;
      return true;
    });
  }, [claims, claimStatusFilter, sessionsMap, selectedCityId]);

  const currentTabSessions =
    activeTab === 'upcoming'
      ? upcomingSessions
      : activeTab === 'live'
      ? liveSessions
      : pastSessions;

  // Render Rider Preview Card for the rewards builder
  const renderRiderPreviewCard = () => {
    const win = formatPhtWindow(
      makePhtTimestampDate(formDate, formStartTime),
      makePhtTimestampDate(formDate, formEndTime)
    );
    const previewCityName = citiesMap[formCityId]?.name || 'Select city';
    const previewEmoji = rewardsEnabled && rewardEmoji.trim() ? rewardEmoji.trim() : null;
    const clean = rewardsEnabled ? buildCleanRewardsPayload(draftRewardsObj) : undefined;

    return (
      <div className="rounded-2xl border border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-950 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-amber-600 dark:text-amber-400">
            Rider App Card Preview
          </span>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
            {formSlots || 0} slots open
          </span>
        </div>

        <div className="rounded-xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 p-3.5 space-y-2.5 shadow-xs">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              {previewEmoji && (
                <span className="text-2xl leading-none shrink-0">{previewEmoji}</span>
              )}
              <div className="min-w-0">
                <p className="text-sm font-extrabold text-gray-900 dark:text-white truncate">
                  {formTitle.trim() || `${previewCityName} Shift`}
                </p>
                <p className="text-xs font-semibold text-gray-500 dark:text-zinc-400">
                  {win.dateLabel} · {win.timeRange}
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="px-2 py-0.5 rounded-md bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-zinc-300 font-semibold">
              {previewCityName}
            </span>
            <span className="px-2 py-0.5 rounded-md bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-zinc-300 font-semibold">
              {formVehicleTypes.length === 0
                ? 'All vehicles'
                : formVehicleTypes
                    .map((v) => VEHICLE_LABELS[v as keyof typeof VEHICLE_LABELS] || v)
                    .join(', ')}
            </span>
          </div>

          {clean && (
            <div className="pt-2 border-t border-gray-100 dark:border-zinc-800 space-y-1.5">
              <div className="flex flex-wrap gap-1.5">
                {clean.perDelivery && (
                  <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300 text-[11px] font-bold">
                    +₱{clean.perDelivery}/delivery
                  </span>
                )}
                {clean.streakEvery && clean.streakBonus && (
                  <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300 text-[11px] font-bold">
                    Every {clean.streakEvery}th +₱{clean.streakBonus}
                  </span>
                )}
                {clean.completionTarget && clean.completionBonus && (
                  <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300 text-[11px] font-bold">
                    {clean.completionTarget} deliveries → +₱{clean.completionBonus}
                  </span>
                )}
                {clean.minEarnings && (
                  <span className="px-2 py-0.5 rounded-md bg-blue-100 text-blue-900 dark:bg-blue-950/60 dark:text-blue-300 text-[11px] font-bold">
                    Min ₱{clean.minEarnings} guaranteed
                  </span>
                )}
                {clean.multiplier && (
                  <span className="px-2 py-0.5 rounded-md bg-purple-100 text-purple-900 dark:bg-purple-950/60 dark:text-purple-300 text-[11px] font-bold">
                    x{clean.multiplier} rider pay
                  </span>
                )}
                {clean.onlineBonus && (
                  <span className="px-2 py-0.5 rounded-md bg-cyan-100 text-cyan-900 dark:bg-cyan-950/60 dark:text-cyan-300 text-[11px] font-bold">
                    +₱{clean.onlineBonus} ({clean.onlineMinPercent ?? 80}%+ online)
                  </span>
                )}
                {clean.coins && (
                  <span className="px-2 py-0.5 rounded-md bg-yellow-100 text-yellow-900 dark:bg-yellow-950/60 dark:text-yellow-300 text-[11px] font-bold">
                    +{clean.coins} tier coins
                  </span>
                )}
              </div>

              {clean.services && clean.services.length > 0 && (
                <p className="text-[11px] text-gray-500 dark:text-zinc-400">
                  Counts for:{' '}
                  <strong>
                    {clean.services.map((s) => SERVICE_LABELS[s] || s).join(', ')}
                  </strong>
                </p>
              )}
              {clean.note && (
                <p className="text-[11px] italic text-gray-500 dark:text-zinc-400">
                  {clean.note}
                </p>
              )}
            </div>
          )}

          <p className="text-[10px] text-gray-400">
            Booking closes {formBookingCloseMin}m before · Cancel/swap until {formCancelCutoffMin}m before
          </p>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5 min-w-0 max-w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-gray-900 dark:text-white tracking-tight flex items-center gap-2.5">
            <CalendarClock className="w-6 h-6 text-amber-500 shrink-0" />
            <span>Schedule Sessions</span>
          </h1>
          <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">
            Create rider shift blocks, manage slot bookings and rewards, and settle session claims.
          </p>
        </div>

        <button
          type="button"
          onClick={openNewSessionModal}
          className="delivio-btn-yellow px-4 py-2.5 rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 shadow-xs w-full sm:w-auto"
        >
          <Plus className="w-4 h-4" />
          <span>New session</span>
        </button>
      </div>

      {/* Four Primary Tabs */}
      <div className="flex flex-wrap items-center gap-2 bg-white dark:bg-zinc-900 p-1.5 rounded-2xl border border-gray-200 dark:border-zinc-800 w-full sm:w-fit">
        {(
          [
            { id: 'upcoming', label: 'Upcoming', count: upcomingSessions.length },
            { id: 'live', label: 'Live', count: liveSessions.length },
            { id: 'past', label: 'Past', count: pastSessions.length },
            { id: 'claims', label: 'Claims', count: pendingClaimsCount }
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-colors ${
              activeTab === tab.id
                ? 'bg-gray-900 text-white dark:bg-amber-400 dark:text-black shadow-xs'
                : 'text-gray-600 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800'
            }`}
          >
            <span>{tab.label}</span>
            <span
              className={`px-1.5 py-0.5 rounded-full text-[10px] font-extrabold tabular-nums ${
                tab.id === 'claims' && tab.count > 0
                  ? 'bg-amber-500 text-black'
                  : tab.id === 'live' && tab.count > 0
                  ? 'bg-emerald-500 text-white'
                  : 'bg-gray-200 dark:bg-zinc-800 text-gray-700 dark:text-zinc-300'
              }`}
            >
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {activeTab !== 'claims' ? (
        /* ======================== UPCOMING / LIVE / PAST SESSIONS ======================== */
        <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
          {loadingSessions ? (
            <div className="p-14 text-center">
              <Loader2 className="w-7 h-7 animate-spin text-amber-500 mx-auto mb-2" />
              <p className="text-xs text-gray-500">Loading schedule sessions...</p>
            </div>
          ) : currentTabSessions.length === 0 ? (
            <div className="p-14 text-center space-y-2">
              <CalendarClock className="w-10 h-10 text-gray-300 dark:text-zinc-700 mx-auto" />
              <p className="text-sm font-bold text-gray-700 dark:text-zinc-300">
                No {activeTab} sessions found
              </p>
              <p className="text-xs text-gray-400">
                Click &ldquo;New session&rdquo; to schedule a rider block.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-zinc-800">
              {currentTabSessions.map((sess) => {
                const win = formatPhtWindow(sess.startAt, sess.endAt);
                const cityName = citiesMap[sess.cityId]?.name || sess.cityId || 'City';
                const statusColors =
                  sess.status === 'open'
                    ? 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800'
                    : sess.status === 'closed'
                    ? 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800'
                    : 'bg-red-100 text-red-800 border-red-300 dark:bg-red-950/60 dark:text-red-300 dark:border-red-800';

                return (
                  <div
                    key={sess.id}
                    onClick={() => {
                      setSelectedSessionId(sess.id);
                      setAddRiderId('');
                    }}
                    className="p-4 sm:px-5 hover:bg-amber-50/50 dark:hover:bg-zinc-800/50 cursor-pointer transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 flex items-center justify-center text-lg shrink-0">
                        {sess.rewards?.emoji ? (
                          <span>{sess.rewards.emoji}</span>
                        ) : (
                          <CalendarClock className="w-5 h-5 text-amber-500" />
                        )}
                      </div>

                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-extrabold text-gray-900 dark:text-white">
                            {sess.title ? sess.title : `${cityName} Session`}
                          </span>
                          <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-zinc-300 flex items-center gap-1">
                            <MapPin className="w-3 h-3 text-amber-500" />
                            <span>{cityName}</span>
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase border ${statusColors}`}
                          >
                            {sess.status}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500 dark:text-zinc-400">
                          <span className="font-semibold text-gray-700 dark:text-zinc-200 flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5 text-amber-500" />
                            {win.dateLabel} · {win.timeRange}
                          </span>
                          <span>
                            {sess.vehicleTypes.length === 0
                              ? 'All vehicles'
                              : sess.vehicleTypes
                                  .map((v) => VEHICLE_LABELS[v as keyof typeof VEHICLE_LABELS] || v)
                                  .join(', ')}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0">
                      <div className="text-left sm:text-right">
                        <span className="text-[10px] font-bold uppercase text-gray-400 block">
                          Bookings
                        </span>
                        <span className="text-sm font-extrabold font-mono tabular-nums text-gray-900 dark:text-white">
                          {sess.bookedCount} / {sess.slots}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* ======================== CLAIMS TAB ======================== */
        <div className="space-y-4">
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {(['Pending', 'Settled', 'Rejected', 'all'] as const).map((st) => {
                const count =
                  st === 'all'
                    ? claims.length
                    : claims.filter((c) => c.status === st).length;
                return (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setClaimStatusFilter(st)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold tabular-nums transition-colors ${
                      claimStatusFilter === st
                        ? 'bg-amber-400 text-black'
                        : 'bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-300 hover:bg-gray-200'
                    }`}
                  >
                    {st === 'all' ? 'All' : st} ({count})
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={recomputingClaims}
                onClick={recomputePendingClaims}
                className="px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold text-gray-700 dark:text-zinc-200 flex items-center gap-1.5 disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${recomputingClaims ? 'animate-spin' : ''}`} />
                <span>Recompute Orders</span>
              </button>

              <button
                type="button"
                disabled={autoSettlingClaims || pendingClaimsCount === 0}
                onClick={handleAutoSettleMatchingClaims}
                className="delivio-btn-yellow px-4 py-2 rounded-xl text-xs font-extrabold flex items-center gap-1.5 disabled:opacity-40"
              >
                {autoSettlingClaims ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Zap className="w-3.5 h-3.5" />
                )}
                <span>Auto-settle</span>
              </button>
            </div>
          </div>

          {loadingClaims ? (
            <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-12 text-center">
              <Loader2 className="w-7 h-7 animate-spin text-amber-500 mx-auto mb-2" />
              <p className="text-xs text-gray-500">Loading session claims...</p>
            </div>
          ) : filteredClaims.length === 0 ? (
            <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-12 text-center text-xs text-gray-400">
              No {claimStatusFilter === 'all' ? '' : claimStatusFilter.toLowerCase()} session claims found.
            </div>
          ) : (
            <div className="space-y-3">
              {filteredClaims.map((claim) => {
                const sess = sessionsMap[claim.sessionId];
                const recomp = recomputedByClaimId[claim.id];
                const onlineMin = editedOnlineMinByClaimId[claim.id] ?? claim.onlineMinutes;
                const usedDeliveries = recomp ? recomp.deliveries : claim.deliveries;
                const usedEarned = recomp ? recomp.earned : claim.earned;

                const computed =
                  claim.status === 'Pending' && sess
                    ? calculateSessionClaimRewards({
                        session: sess,
                        deliveries: usedDeliveries,
                        earned: usedEarned,
                        onlineMinutes: onlineMin
                      })
                    : {
                        bonusTotal: claim.bonusTotal || 0,
                        breakdown: claim.breakdown
                      };

                const win = sess ? formatPhtWindow(sess.startAt, sess.endAt) : null;

                return (
                  <div
                    key={claim.id}
                    className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-4 sm:p-5 space-y-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          {sess?.rewards?.emoji && (
                            <span className="text-lg">{sess.rewards.emoji}</span>
                          )}
                          <h3 className="text-sm font-extrabold text-gray-900 dark:text-white">
                            {claim.riderName}
                          </h3>
                          <span className="text-[11px] font-mono text-gray-400">
                            {claim.riderId}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold border ${
                              claim.status === 'Settled'
                                ? 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300'
                                : claim.status === 'Rejected'
                                ? 'bg-red-100 text-red-800 border-red-300 dark:bg-red-950/60 dark:text-red-300'
                                : 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300'
                            }`}
                          >
                            {claim.status}
                          </span>
                          {recomp && claim.status === 'Pending' && (
                            <span
                              className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                                recomp.matchesWithin5Pct
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300'
                                  : 'bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/40 dark:text-red-300'
                              }`}
                            >
                              {recomp.matchesWithin5Pct
                                ? 'Matches within 5%'
                                : `Mismatch (${Math.max(recomp.deliveriesDiffPct, recomp.earnedDiffPct)}%)`}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 dark:text-zinc-400">
                          Session:{' '}
                          <strong className="text-gray-800 dark:text-zinc-200">
                            {sess?.title || claim.sessionId}
                          </strong>
                          {win ? ` · ${win.dateLabel} (${win.timeRange})` : ''}
                        </p>
                      </div>

                      <div className="text-right">
                        <span className="text-[10px] font-bold uppercase text-gray-400 block">
                          Calculated Bonus
                        </span>
                        <span className="text-lg font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums">
                          ₱{Number(computed.bonusTotal || 0).toFixed(2)}
                        </span>
                        {computed.breakdown && computed.breakdown.coins > 0 && (
                          <span className="block text-[11px] font-bold text-amber-600 dark:text-amber-400">
                            +{computed.breakdown.coins} tier coins
                          </span>
                        )}
                      </div>
                    </div>

                    {/* App-reported vs Recomputed Orders Comparison */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="p-3 rounded-xl bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 text-xs space-y-1">
                        <span className="text-[10px] font-bold uppercase text-gray-400 block">
                          Deliveries (App vs Orders)
                        </span>
                        <div className="flex items-baseline justify-between tabular-nums">
                          <span>
                            App: <strong>{claim.deliveries}</strong>
                          </span>
                          <span>
                            Orders:{' '}
                            <strong className="text-amber-600 dark:text-amber-400">
                              {recomp ? recomp.deliveries : '—'}
                            </strong>
                          </span>
                        </div>
                      </div>

                      <div className="p-3 rounded-xl bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 text-xs space-y-1">
                        <span className="text-[10px] font-bold uppercase text-gray-400 block">
                          Rider Pay Earned (App vs Orders)
                        </span>
                        <div className="flex items-baseline justify-between tabular-nums">
                          <span>
                            App: <strong>₱{claim.earned.toFixed(2)}</strong>
                          </span>
                          <span>
                            Orders:{' '}
                            <strong className="text-amber-600 dark:text-amber-400">
                              {recomp ? `₱${recomp.earned.toFixed(2)}` : '—'}
                            </strong>
                          </span>
                        </div>
                      </div>

                      <div className="p-3 rounded-xl bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 text-xs space-y-1">
                        <label className="text-[10px] font-bold uppercase text-gray-400 block">
                          Online Minutes ({computed.breakdown?.onlinePercent ?? 0}% of session)
                        </label>
                        {claim.status === 'Pending' ? (
                          <input
                            type="number"
                            min={0}
                            value={onlineMin}
                            onChange={(e) =>
                              setEditedOnlineMinByClaimId((prev) => ({
                                ...prev,
                                [claim.id]: Math.max(0, Number(e.target.value) || 0)
                              }))
                            }
                            className="w-full px-2.5 py-1 rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold text-gray-900 dark:text-white tabular-nums"
                          />
                        ) : (
                          <p className="font-bold text-gray-900 dark:text-white tabular-nums">
                            {claim.onlineMinutes} min
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Reward Breakdown */}
                    {computed.breakdown && (
                      <div className="p-3 rounded-xl bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200/80 dark:border-amber-900/50 flex flex-wrap gap-2 text-[11px]">
                        <span className="font-bold text-gray-700 dark:text-zinc-300">
                          Breakdown:
                        </span>
                        <span>Per-delivery: ₱{computed.breakdown.perDelivery.toFixed(2)}</span>
                        <span>· Streak: ₱{computed.breakdown.streak.toFixed(2)}</span>
                        <span>· Completion: ₱{computed.breakdown.completion.toFixed(2)}</span>
                        <span>· Min top-up: ₱{computed.breakdown.minEarningsTopUp.toFixed(2)}</span>
                        <span>· Multiplier: ₱{computed.breakdown.multiplierExtra.toFixed(2)}</span>
                        <span>· Online bonus: ₱{computed.breakdown.onlineBonus.toFixed(2)}</span>
                        <span>· Coins: {computed.breakdown.coins}</span>
                      </div>
                    )}

                    {claim.status === 'Pending' ? (
                      <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                        <button
                          type="button"
                          disabled={settlingClaimId === claim.id}
                          onClick={() => setRejectClaimTarget(claim)}
                          className="px-3.5 py-2 rounded-xl border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 text-xs font-bold flex items-center gap-1.5 disabled:opacity-50"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          <span>Reject</span>
                        </button>
                        <button
                          type="button"
                          disabled={settlingClaimId === claim.id || !sess}
                          onClick={() => handleSettleClaim(claim)}
                          className="delivio-btn-yellow px-4 py-2 rounded-xl text-xs font-extrabold flex items-center gap-1.5 disabled:opacity-50"
                        >
                          {settlingClaimId === claim.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Wallet className="w-3.5 h-3.5" />
                          )}
                          <span>Settle</span>
                        </button>
                      </div>
                    ) : (
                      <div className="text-[11px] text-gray-400 flex flex-wrap items-center justify-between gap-2">
                        <span>
                          {claim.status} by {claim.settledBy || 'Admin'} ·{' '}
                          {formatTimestamp(claim.settledAt)}
                        </span>
                        {claim.note && <span className="italic">Note: {claim.note}</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ======================== NEW / EDIT SESSION MODAL ======================== */}
      {formOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/60 backdrop-blur-xs"
          onClick={() => !savingSession && setFormOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-4xl max-h-[92vh] bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-gray-200 dark:border-zinc-800 flex items-center justify-between">
              <div>
                <h2 className="text-base font-extrabold text-gray-900 dark:text-white">
                  {editingSession ? 'Edit Schedule Session' : 'New Schedule Session'}
                </h2>
                <p className="text-xs text-gray-500 dark:text-zinc-400">
                  15-minute aligned shift slots stored in <code>scheduleSessions</code>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="p-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-white rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={handleSaveSession}
              className="flex-1 overflow-y-auto p-5 space-y-5"
            >
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                {/* Left Config Column */}
                <div className="lg:col-span-7 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                        Title (optional)
                      </label>
                      <input
                        type="text"
                        value={formTitle}
                        onChange={(e) => setFormTitle(e.target.value)}
                        placeholder="e.g. Lunch Peak"
                        className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-semibold text-gray-900 dark:text-white"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                        City *
                      </label>
                      <select
                        required
                        value={formCityId}
                        onChange={(e) => setFormCityId(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-semibold text-gray-900 dark:text-white"
                      >
                        <option value="">Select city...</option>
                        {cities.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Date & 15-min Start/End */}
                  {editingSession && editingSession.bookedCount > 0 && (
                    <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 text-xs font-bold text-amber-800 dark:text-amber-300">
                      This session already has {editingSession.bookedCount} booking(s) — times cannot
                      change. Cancel the session and create a new one if you need different hours.
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-bold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                        Date (PHT)
                      </label>
                      <input
                        type="date"
                        required
                        disabled={Boolean(editingSession && editingSession.bookedCount > 0)}
                        value={formDate}
                        onChange={(e) => setFormDate(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-semibold text-gray-900 dark:text-white disabled:opacity-50"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                        Start (15-min)
                      </label>
                      <select
                        disabled={Boolean(editingSession && editingSession.bookedCount > 0)}
                        value={formStartTime}
                        onChange={(e) => setFormStartTime(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-semibold text-gray-900 dark:text-white disabled:opacity-50"
                      >
                        {START_TIME_OPTIONS.map((t) => (
                          <option key={t} value={t}>
                            {formatTimeDisplay12h(t)}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                        End (15-min)
                      </label>
                      <select
                        disabled={Boolean(editingSession && editingSession.bookedCount > 0)}
                        value={formEndTime}
                        onChange={(e) => setFormEndTime(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-semibold text-gray-900 dark:text-white disabled:opacity-50"
                      >
                        {END_TIME_OPTIONS.map((t) => (
                          <option key={t} value={t}>
                            {formatTimeDisplay12h(t)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Slots & Cutoffs */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-bold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                        Slots (riders needed)
                      </label>
                      <input
                        type="number"
                        min={editingSession?.bookedCount ? Math.max(1, editingSession.bookedCount) : 1}
                        required
                        value={formSlots}
                        onChange={(e) => setFormSlots(Number(e.target.value))}
                        className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold text-gray-900 dark:text-white"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                        Booking closes (min before start)
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={formBookingCloseMin}
                        onChange={(e) => setFormBookingCloseMin(Number(e.target.value))}
                        className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold text-gray-900 dark:text-white"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                        Swap/cancel cutoff (min before start)
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={formCancelCutoffMin}
                        onChange={(e) => setFormCancelCutoffMin(Number(e.target.value))}
                        className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold text-gray-900 dark:text-white"
                      />
                    </div>
                  </div>

                  {/* Vehicle Types (optional, empty = all) */}
                  <div>
                    <label className="block text-xs font-bold uppercase text-gray-600 dark:text-zinc-400 mb-1.5">
                      Vehicle types (optional; empty means all)
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {VEHICLE_TYPES.map((vt) => {
                        const checked = formVehicleTypes.includes(vt.id);
                        return (
                          <button
                            key={vt.id}
                            type="button"
                            onClick={() =>
                              setFormVehicleTypes((prev) =>
                                prev.includes(vt.id)
                                  ? prev.filter((x) => x !== vt.id)
                                  : [...prev, vt.id]
                              )
                            }
                            className={`px-3 py-1.5 rounded-xl border text-xs font-bold transition-colors ${
                              checked
                                ? 'border-amber-400 bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300'
                                : 'border-gray-200 dark:border-zinc-700 text-gray-600 dark:text-zinc-300'
                            }`}
                          >
                            {vt.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Repeat options (Create mode only) */}
                  {!editingSession && (
                    <div className="p-3.5 rounded-xl bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 space-y-3">
                      <label className="flex items-center gap-2 text-xs font-extrabold text-gray-900 dark:text-white cursor-pointer">
                        <input
                          type="checkbox"
                          checked={repeatEnabled}
                          onChange={(e) => setRepeatEnabled(e.target.checked)}
                          className="rounded border-gray-300 text-amber-500"
                        />
                        <span>Create for the next N days</span>
                      </label>

                      {repeatEnabled && (
                        <div className="space-y-3">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500">Next</span>
                            <input
                              type="number"
                              min={1}
                              max={31}
                              value={repeatDays}
                              onChange={(e) => setRepeatDays(Number(e.target.value))}
                              className="w-20 px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold text-gray-900 dark:text-white"
                            />
                            <span className="text-xs text-gray-500">
                              days ({plannedDates.length} session{plannedDates.length === 1 ? '' : 's'} will be created)
                            </span>
                          </div>

                          <div className="flex flex-wrap gap-1.5">
                            {WEEKDAY_OPTIONS.map((wd) => {
                              const active = repeatWeekdays.includes(wd.dayIndex);
                              return (
                                <button
                                  key={wd.dayIndex}
                                  type="button"
                                  onClick={() =>
                                    setRepeatWeekdays((prev) =>
                                      prev.includes(wd.dayIndex)
                                        ? prev.filter((x) => x !== wd.dayIndex)
                                        : [...prev, wd.dayIndex]
                                    )
                                  }
                                  className={`px-2.5 py-1 rounded-lg border text-[11px] font-bold ${
                                    active
                                      ? 'border-amber-400 bg-amber-400 text-black'
                                      : 'border-gray-200 dark:border-zinc-700 text-gray-500'
                                  }`}
                                >
                                  {wd.short}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* REWARDS SECTION */}
                  <div className="p-4 rounded-2xl border border-gray-200 dark:border-zinc-800 space-y-4">
                    <label className="flex items-center justify-between cursor-pointer">
                      <span className="flex items-center gap-2 text-xs font-extrabold text-gray-900 dark:text-white">
                        <Sparkles className="w-4 h-4 text-amber-500" />
                        <span>Add rewards (optional)</span>
                      </span>
                      <input
                        type="checkbox"
                        checked={rewardsEnabled}
                        onChange={(e) => setRewardsEnabled(e.target.checked)}
                        className="rounded border-gray-300 text-amber-500 w-4 h-4"
                      />
                    </label>

                    {rewardsEnabled && (
                      <div className="space-y-4 pt-2 border-t border-gray-100 dark:border-zinc-800">
                        {/* Emoji (Required, single emoji) */}
                        <div>
                          <label className="block text-xs font-bold uppercase text-gray-600 dark:text-zinc-400 mb-1.5">
                            Emoji (required, exactly 1 emoji) *
                          </label>
                          <div className="flex flex-wrap items-center gap-2">
                            <input
                              type="text"
                              value={rewardEmoji}
                              onChange={(e) => setRewardEmoji(e.target.value)}
                              className="w-16 text-center text-lg px-2 py-1.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800"
                            />
                            <div className="flex flex-wrap gap-1.5">
                              {SESSION_REWARD_EMOJI_PICKS.map((em) => (
                                <button
                                  key={em}
                                  type="button"
                                  onClick={() => setRewardEmoji(em)}
                                  className={`w-9 h-9 rounded-xl border text-base flex items-center justify-center transition-colors ${
                                    rewardEmoji === em
                                      ? 'border-amber-400 bg-amber-100 dark:bg-amber-950/60'
                                      : 'border-gray-200 dark:border-zinc-700 hover:bg-gray-100 dark:hover:bg-zinc-800'
                                  }`}
                                >
                                  {em}
                                </button>
                              ))}
                            </div>
                          </div>
                          {!isSingleEmoji(rewardEmoji) && (
                            <p className="text-[11px] text-red-600 font-semibold mt-1">
                              Must be a single emoji character.
                            </p>
                          )}
                        </div>

                        {/* Individual Reward Fields */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                          <div>
                            <label className="block font-bold text-gray-600 dark:text-zinc-400 mb-1">
                              Per-delivery bonus (₱)
                            </label>
                            <input
                              type="number"
                              min={0}
                              step="any"
                              value={rewardPerDelivery}
                              onChange={(e) => setRewardPerDelivery(e.target.value)}
                              placeholder="e.g. 15"
                              className="w-full px-3 py-1.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                            />
                          </div>

                          <div>
                            <label className="block font-bold text-gray-600 dark:text-zinc-400 mb-1">
                              Guaranteed minimum earnings (₱)
                            </label>
                            <input
                              type="number"
                              min={0}
                              step="any"
                              value={rewardMinEarnings}
                              onChange={(e) => setRewardMinEarnings(e.target.value)}
                              placeholder="e.g. 500"
                              className="w-full px-3 py-1.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                            />
                          </div>

                          <div>
                            <label className="block font-bold text-gray-600 dark:text-zinc-400 mb-1">
                              Streak: every Nth delivery
                            </label>
                            <input
                              type="number"
                              min={1}
                              value={rewardStreakEvery}
                              onChange={(e) => setRewardStreakEvery(e.target.value)}
                              placeholder="e.g. 3"
                              className="w-full px-3 py-1.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                            />
                          </div>

                          <div>
                            <label className="block font-bold text-gray-600 dark:text-zinc-400 mb-1">
                              Streak bonus (+₱)
                            </label>
                            <input
                              type="number"
                              min={0}
                              step="any"
                              value={rewardStreakBonus}
                              onChange={(e) => setRewardStreakBonus(e.target.value)}
                              placeholder="e.g. 40"
                              className="w-full px-3 py-1.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                            />
                          </div>

                          <div>
                            <label className="block font-bold text-gray-600 dark:text-zinc-400 mb-1">
                              Completion target (N deliveries)
                            </label>
                            <input
                              type="number"
                              min={1}
                              value={rewardCompletionTarget}
                              onChange={(e) => setRewardCompletionTarget(e.target.value)}
                              placeholder="e.g. 8"
                              className="w-full px-3 py-1.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                            />
                          </div>

                          <div>
                            <label className="block font-bold text-gray-600 dark:text-zinc-400 mb-1">
                              Completion bonus (+₱)
                            </label>
                            <input
                              type="number"
                              min={0}
                              step="any"
                              value={rewardCompletionBonus}
                              onChange={(e) => setRewardCompletionBonus(e.target.value)}
                              placeholder="e.g. 120"
                              className="w-full px-3 py-1.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                            />
                          </div>

                          <div>
                            <label className="block font-bold text-gray-600 dark:text-zinc-400 mb-1">
                              Peak multiplier (x1.1 to x2.0)
                            </label>
                            <input
                              type="number"
                              min={1.1}
                              max={2.0}
                              step={0.1}
                              value={rewardMultiplier}
                              onChange={(e) => setRewardMultiplier(e.target.value)}
                              placeholder="e.g. 1.3"
                              className="w-full px-3 py-1.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                            />
                          </div>

                          <div>
                            <label className="block font-bold text-gray-600 dark:text-zinc-400 mb-1">
                              Tier coins for attending
                            </label>
                            <input
                              type="number"
                              min={0}
                              value={rewardCoins}
                              onChange={(e) => setRewardCoins(e.target.value)}
                              placeholder="e.g. 25"
                              className="w-full px-3 py-1.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                            />
                          </div>

                          <div>
                            <label className="block font-bold text-gray-600 dark:text-zinc-400 mb-1">
                              Online-time bonus (+₱)
                            </label>
                            <input
                              type="number"
                              min={0}
                              step="any"
                              value={rewardOnlineBonus}
                              onChange={(e) => setRewardOnlineBonus(e.target.value)}
                              placeholder="e.g. 100"
                              className="w-full px-3 py-1.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                            />
                          </div>

                          <div>
                            <label className="block font-bold text-gray-600 dark:text-zinc-400 mb-1">
                              Online threshold (% of session)
                            </label>
                            <input
                              type="number"
                              min={1}
                              max={100}
                              value={rewardOnlineMinPercent}
                              onChange={(e) => setRewardOnlineMinPercent(e.target.value)}
                              className="w-full px-3 py-1.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                            />
                          </div>
                        </div>

                        {/* Service Filter */}
                        <div>
                          <label className="block text-xs font-bold text-gray-600 dark:text-zinc-400 mb-1.5">
                            Service filter (optional; empty = all services)
                          </label>
                          <div className="flex flex-wrap gap-1.5">
                            {ALL_SERVICES.map((svc) => {
                              const active = rewardServices.includes(svc.id);
                              return (
                                <button
                                  key={svc.id}
                                  type="button"
                                  onClick={() =>
                                    setRewardServices((prev) =>
                                      prev.includes(svc.id)
                                        ? prev.filter((x) => x !== svc.id)
                                        : [...prev, svc.id]
                                    )
                                  }
                                  className={`px-2.5 py-1 rounded-lg border text-[11px] font-bold ${
                                    active
                                      ? 'border-amber-400 bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300'
                                      : 'border-gray-200 dark:border-zinc-700 text-gray-600 dark:text-zinc-400'
                                  }`}
                                >
                                  {svc.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-gray-600 dark:text-zinc-400 mb-1">
                            Reward note (optional)
                          </label>
                          <input
                            type="text"
                            value={rewardNote}
                            onChange={(e) => setRewardNote(e.target.value)}
                            placeholder="e.g. Stay online 80%+ in city center"
                            className="w-full px-3 py-1.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-gray-900 dark:text-white"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Right Live Rider Card Preview */}
                <div className="lg:col-span-5 lg:sticky lg:top-0">
                  {renderRiderPreviewCard()}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-zinc-800">
                <button
                  type="button"
                  disabled={savingSession}
                  onClick={() => setFormOpen(false)}
                  className="px-4 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 text-xs font-bold text-gray-700 dark:text-zinc-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingSession}
                  className="delivio-btn-yellow px-5 py-2 rounded-xl text-xs font-extrabold flex items-center gap-1.5 disabled:opacity-50"
                >
                  {savingSession && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>
                    {editingSession
                      ? 'Save Changes'
                      : plannedDates.length > 1
                      ? `Create ${plannedDates.length} Sessions`
                      : 'Create Session'}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================== SESSION DETAIL MODAL ======================== */}
      {selectedSession && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/60 backdrop-blur-xs"
          onClick={() => setSelectedSessionId(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-3xl max-h-[92vh] bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-gray-200 dark:border-zinc-800 flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  {selectedSession.rewards?.emoji && (
                    <span className="text-xl">{selectedSession.rewards.emoji}</span>
                  )}
                  <h2 className="text-base font-extrabold text-gray-900 dark:text-white">
                    {selectedSession.title ||
                      `${citiesMap[selectedSession.cityId]?.name || selectedSession.cityId} Session`}
                  </h2>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-zinc-300">
                    {selectedSession.status}
                  </span>
                </div>
                <p className="text-xs text-gray-500 dark:text-zinc-400">
                  {formatPhtWindow(selectedSession.startAt, selectedSession.endAt).dateLabel} ·{' '}
                  {formatPhtWindow(selectedSession.startAt, selectedSession.endAt).timeRange} ·{' '}
                  {citiesMap[selectedSession.cityId]?.name || selectedSession.cityId} ·{' '}
                  <strong className="font-mono">
                    {selectedSession.bookedCount} / {selectedSession.slots} booked
                  </strong>
                </p>
              </div>

              <button
                type="button"
                onClick={() => setSelectedSessionId(null)}
                className="p-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-white rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* Session Management Toolbar */}
              {selectedSession.status !== 'cancelled' && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openEditSessionModal(selectedSession)}
                    className="px-3.5 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold text-gray-700 dark:text-zinc-200 flex items-center gap-1.5"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>Edit session</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleToggleCloseSession(selectedSession)}
                    className="px-3.5 py-2 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 text-xs font-bold flex items-center gap-1.5"
                  >
                    {selectedSession.status === 'open' ? (
                      <>
                        <Lock className="w-3.5 h-3.5" />
                        <span>Close session</span>
                      </>
                    ) : (
                      <>
                        <Unlock className="w-3.5 h-3.5" />
                        <span>Reopen session</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setCancelSessionTarget(selectedSession)}
                    className="px-3.5 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold flex items-center gap-1.5"
                  >
                    <Ban className="w-3.5 h-3.5" />
                    <span>Cancel session</span>
                  </button>
                </div>
              )}

              {/* Add Rider Panel */}
              {selectedSession.status !== 'cancelled' &&
                selectedSession.bookedCount < selectedSession.slots && (
                  <div className="p-3.5 rounded-xl bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 flex flex-col sm:flex-row sm:items-center gap-2.5">
                    <div className="flex-1">
                      <select
                        value={addRiderId}
                        onChange={(e) => setAddRiderId(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-semibold text-gray-900 dark:text-white"
                      >
                        <option value="">Select a rider to add...</option>
                        {riders
                          .filter(
                            (r) =>
                              r.status === 'active' &&
                              !sessionBookings.some((b) => b.riderId === r.id)
                          )
                          .map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name} ({r.vehicleType || 'motorcycle'} · {r.riderCode})
                            </option>
                          ))}
                      </select>
                    </div>
                    <button
                      type="button"
                      disabled={!addRiderId || addingRider}
                      onClick={handleAddRiderToSession}
                      className="delivio-btn-yellow px-4 py-2 rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 disabled:opacity-40"
                    >
                      {addingRider ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <UserPlus className="w-3.5 h-3.5" />
                      )}
                      <span>Add rider</span>
                    </button>
                  </div>
                )}

              {/* Booked Riders List */}
              <div className="rounded-xl border border-gray-200 dark:border-zinc-800 overflow-hidden">
                <div className="px-4 py-2.5 bg-gray-50 dark:bg-zinc-950 border-b border-gray-200 dark:border-zinc-800 text-xs font-extrabold uppercase tracking-wider text-gray-500 dark:text-zinc-400 flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-amber-500" />
                  <span>Booked Riders ({sessionBookings.length})</span>
                </div>

                {loadingBookings ? (
                  <div className="p-8 text-center text-xs text-gray-400">
                    <Loader2 className="w-5 h-5 animate-spin inline mr-2 text-amber-500" />
                    Loading booked riders...
                  </div>
                ) : sessionBookings.length === 0 ? (
                  <div className="p-8 text-center text-xs text-gray-400">
                    No riders booked in this session yet.
                  </div>
                ) : (
                  <div className="divide-y divide-gray-100 dark:divide-zinc-800">
                    {sessionBookings.map((b) => {
                      const vType =
                        b.vehicleType || ridersMap[b.riderId]?.vehicleType || 'motorcycle';
                      return (
                        <div
                          key={b.id}
                          className="px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs"
                        >
                          <div>
                            <p className="font-bold text-gray-900 dark:text-white">{b.riderName}</p>
                            <p className="text-[11px] text-gray-500 dark:text-zinc-400">
                              {VEHICLE_LABELS[vType as keyof typeof VEHICLE_LABELS] || vType} ·
                              Booked {formatTimestamp(b.bookedAt)}
                            </p>
                          </div>

                          <button
                            type="button"
                            onClick={() => setRemovingBooking(b)}
                            className="px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 text-[11px] font-bold flex items-center gap-1 hover:bg-red-100"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Remove rider</span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Remove Rider Confirmation */}
      {removingBooking && (
        <ConfirmationModal
          isOpen={Boolean(removingBooking)}
          onClose={() => setRemovingBooking(null)}
          onConfirm={handleConfirmRemoveRider}
          title={`Remove ${removingBooking.riderName} from session?`}
          message="This deletes their booking and 15-minute slot locks, decrements bookedCount, and sends them an inbox notice."
          confirmLabel="Remove Rider"
          reasonRequired={false}
          isDestructive={true}
        />
      )}

      {/* Cancel Session Confirmation */}
      {cancelSessionTarget && (
        <ConfirmationModal
          isOpen={Boolean(cancelSessionTarget)}
          onClose={() => setCancelSessionTarget(null)}
          onConfirm={handleConfirmCancelSession}
          title="Cancel schedule session?"
          message={`This sets status to cancelled, deletes all ${cancelSessionTarget.bookedCount} rider booking(s) and their slot locks, and notifies every booked rider via inbox.`}
          confirmLabel="Cancel Session"
          reasonRequired={false}
          isDestructive={true}
        />
      )}

      {/* Reject Claim Confirmation */}
      {rejectClaimTarget && (
        <ConfirmationModal
          isOpen={Boolean(rejectClaimTarget)}
          onClose={() => setRejectClaimTarget(null)}
          onConfirm={handleConfirmRejectClaim}
          title={`Reject claim for ${rejectClaimTarget.riderName}?`}
          message="Provide a note explaining why this session claim is rejected."
          confirmLabel="Reject Claim"
          reasonRequired={true}
          reasonPlaceholder="e.g. Did not meet online hours or deliveries outside session window..."
          isDestructive={true}
        />
      )}
    </div>
  );
};
