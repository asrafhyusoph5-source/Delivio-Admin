import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  db,
  collection,
  query,
  getDocs,
  getDoc,
  setDoc,
  doc,
  updateDoc,
  orderBy,
  Timestamp,
  where
} from '../firebase';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { logAuditEvent } from '../utils/audit';
import { nowTs } from '../utils/date';
import { formatShopDisplayName } from '../utils/outletUtils';
import {
  DEFAULT_POS_TIMEZONE,
  resolvePosDateRange,
  getDateStrInTimeZone,
  parsePosOrderDoc,
  parsePosShiftDoc,
  parsePosLogDoc,
  formatPhp,
  runWithConcurrency
} from '../utils/posUtils';
import type { FraudFlag, Merchant, PosOrder, PosShift, PosLog } from '../types';
import {
  AlertOctagon,
  Search,
  CheckCircle,
  Plus,
  RefreshCw,
  FileText,
  User,
  Bike,
  Store,
  ShieldAlert,
  Loader2,
  Ban,
  SlidersHorizontal
} from 'lucide-react';
import { ConfirmationModal } from '../components/common/ConfirmationModal';

interface ComputedPosSuggestion extends FraudFlag {
  isComputedSuggestion: true;
  persistedInFirestore: boolean;
}

type DisplayFraudFlag = FraudFlag & {
  isComputedSuggestion?: boolean;
  persistedInFirestore?: boolean;
};

export const FraudFlags: React.FC = () => {
  const { adminProfile, isFullAdmin } = useAuth();
  const { showSuccess, showError } = useToast();

  const [flags, setFlags] = useState<FraudFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'dismissed'>('open');
  const [subjectFilter, setSubjectFilter] = useState<'all' | 'customer' | 'driver' | 'merchant'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Computed POS Fraud Signals (7-day window, computed on page)
  const [cashVarianceThreshold, setCashVarianceThreshold] = useState<number>(200);
  const [priceOverrideThreshold, setPriceOverrideThreshold] = useState<number>(5);
  const [computingPosSignals, setComputingPosSignals] = useState<boolean>(false);
  const [posSignalsProgress, setPosSignalsProgress] = useState<{ done: number; total: number }>({
    done: 0,
    total: 0
  });
  const [rawPosSnapshots, setRawPosSnapshots] = useState<
    {
      shop: Merchant;
      orders: PosOrder[];
      shifts: PosShift[];
      logs: PosLog[];
    }[]
  >([]);
  const [posTimezone, setPosTimezone] = useState<string>(DEFAULT_POS_TIMEZONE);
  const posScanSeqRef = useRef<number>(0);

  // Note Modal
  const [selectedFlagForNote, setSelectedFlagForNote] = useState<DisplayFraudFlag | null>(null);
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  // Manual Flag Modal
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newSubjectType, setNewSubjectType] = useState<'customer' | 'driver' | 'merchant'>('customer');
  const [newSubjectId, setNewSubjectId] = useState('');
  const [newReason, setNewReason] = useState('Repeated cancellations');
  const [newNote, setNewNote] = useState('');
  const [creatingFlag, setCreatingFlag] = useState(false);

  // Suspend Modal
  const [suspendModalOpen, setSuspendModalOpen] = useState(false);
  const [flagToSuspend, setFlagToSuspend] = useState<DisplayFraudFlag | null>(null);
  const [suspending, setSuspending] = useState(false);

  // Auto-Scan State (Customers)
  const [scanning, setScanning] = useState(false);

  const fetchFlags = async () => {
    try {
      setLoading(true);
      const q = query(collection(db, 'fraudFlags'), orderBy('createdAt', 'desc'));
      const snap = await getDocs(q);
      const items: FraudFlag[] = [];
      snap.forEach((d) => {
        items.push({ id: d.id, ...d.data() } as FraudFlag);
      });
      setFlags(items);
    } catch (err: any) {
      showError(err);
    } finally {
      setLoading(false);
    }
  };

  // Load 7-day POS snapshots per merchant (5 at a time) for on-page fraud signal calculation
  const computeMerchantPosSnapshots = async () => {
    const seq = ++posScanSeqRef.current;
    try {
      setComputingPosSignals(true);
      const [mSnap, platformSnap] = await Promise.all([
        getDocs(collection(db, 'merchants')),
        getDoc(doc(db, 'settings', 'platform'))
      ]);
      if (posScanSeqRef.current !== seq) return;

      const tz =
        (platformSnap.exists() && typeof platformSnap.data()?.timezone === 'string'
          ? platformSnap.data()!.timezone.trim()
          : '') || DEFAULT_POS_TIMEZONE;
      setPosTimezone(tz);

      const merchants: Merchant[] = [];
      mSnap.forEach((d) => {
        const dt = d.data() || {};
        merchants.push({
          id: d.id,
          name: dt.name || 'Store',
          ownerName: dt.ownerName || '',
          email: dt.email || '',
          phone: dt.phone || '',
          type: dt.type === 'convenience' ? 'convenience' : 'food',
          status: dt.status || 'active',
          isOpen: Boolean(dt.isOpen),
          cityId: dt.cityId || '',
          address: dt.address || '',
          lat: Number(dt.lat) || 0,
          lng: Number(dt.lng) || 0,
          commissionRate: dt.commissionRate ?? 15,
          chainId: dt.chainId || undefined,
          chainName: dt.chainName || undefined,
          isBranch: dt.isBranch,
          branchName: dt.branchName || '',
          branchCode: dt.branchCode || ''
        });
      });

      const range7d = resolvePosDateRange('7days', tz);
      const startTs = Timestamp.fromDate(range7d.start);
      const startMs = range7d.start.getTime();

      setPosSignalsProgress({ done: 0, total: merchants.length });

      const snapshots = await runWithConcurrency(
        merchants,
        5,
        async (shop) => {
          try {
            const [ordersRes, shiftsRes, logsRes] = await Promise.allSettled([
              getDocs(
                query(
                  collection(db, 'merchants', shop.id, 'posOrders'),
                  where('createdAt', '>=', startTs)
                )
              ),
              getDocs(
                query(
                  collection(db, 'merchants', shop.id, 'posShifts'),
                  where('openedAt', '>=', startTs)
                )
              ),
              getDocs(
                query(
                  collection(db, 'merchants', shop.id, 'posLogs'),
                  where('at', '>=', startTs)
                )
              )
            ]);

            const orders: PosOrder[] = [];
            if (ordersRes.status === 'fulfilled') {
              ordersRes.value.forEach((d) => {
                const parsed = parsePosOrderDoc(d.id, d.data());
                if (parsed && (!parsed.createdAt || parsed.createdAt.getTime() >= startMs)) {
                  orders.push(parsed);
                }
              });
            }

            const shifts: PosShift[] = [];
            if (shiftsRes.status === 'fulfilled') {
              shiftsRes.value.forEach((d) => {
                const parsed = parsePosShiftDoc(d.id, d.data());
                if (parsed) shifts.push(parsed);
              });
            }

            const logs: PosLog[] = [];
            if (logsRes.status === 'fulfilled') {
              logsRes.value.forEach((d) => {
                const parsed = parsePosLogDoc(d.id, d.data());
                if (parsed) logs.push(parsed);
              });
            }

            return { shop, orders, shifts, logs };
          } catch {
            return { shop, orders: [], shifts: [], logs: [] };
          }
        },
        (done, total) => {
          if (posScanSeqRef.current === seq) {
            setPosSignalsProgress({ done, total });
          }
        }
      );

      if (posScanSeqRef.current === seq) {
        setRawPosSnapshots(snapshots);
      }
    } catch (err) {
      console.warn('Could not compute POS fraud signals:', err);
    } finally {
      if (posScanSeqRef.current === seq) {
        setComputingPosSignals(false);
      }
    }
  };

  useEffect(() => {
    fetchFlags();
    computeMerchantPosSnapshots();
  }, []);

  // Recompute suggestions live whenever snapshots, thresholds, or persisted flags change
  const computedPosSuggestions = useMemo<ComputedPosSuggestion[]>(() => {
    const persistedById = new Map<string, FraudFlag>();
    for (const f of flags) {
      persistedById.set(f.id, f);
    }

    const safeVarThreshold = Math.max(0, Number(cashVarianceThreshold) || 0);
    const safeOverrideThreshold = Math.max(1, Number(priceOverrideThreshold) || 5);
    const out: ComputedPosSuggestion[] = [];

    for (const snap of rawPosSnapshots) {
      const shop = snap.shop;
      const shopLabel = formatShopDisplayName(shop, true);

      // Signal 1: Void rate > 10% of POS orders in 7 days
      const totalOrders = snap.orders.length;
      const voidedOrders = snap.orders.filter(
        (o) => o.status.toLowerCase() === 'voided'
      ).length;
      if (totalOrders > 0 && voidedOrders / totalOrders > 0.1) {
        const pct = ((voidedOrders / totalOrders) * 100).toFixed(1);
        const flagId = `pos_${shop.id}_void_rate`;
        const existing = persistedById.get(flagId);
        out.push({
          id: flagId,
          subjectType: 'merchant',
          subjectId: shop.id,
          subjectName: shopLabel,
          reason: `POS high void rate: ${pct}% (${voidedOrders} of ${totalOrders} orders in 7 days)`,
          status: existing?.status || 'open',
          note: existing?.note || `Shop: ${shopLabel}. Exceeds 10% void rate threshold over last 7 days.`,
          createdAt: existing?.createdAt || null,
          updatedAt: existing?.updatedAt,
          createdBy: existing?.createdBy || 'POS Signal Detector',
          isComputedSuggestion: true,
          persistedInFirestore: Boolean(existing)
        });
      }

      // Signal 2: 3 or more refunds in one day
      const orderRefundsByDay = new Map<string, number>();
      for (const o of snap.orders) {
        if (o.status.toLowerCase() === 'refunded' || (o.refund && o.refund.amount > 0)) {
          const refDate = o.refund?.at || o.paidAt || o.createdAt;
          if (refDate) {
            const dayKey = getDateStrInTimeZone(refDate, posTimezone);
            orderRefundsByDay.set(dayKey, (orderRefundsByDay.get(dayKey) || 0) + 1);
          }
        }
      }
      const logRefundsByDay = new Map<string, number>();
      for (const l of snap.logs) {
        if (l.type.toLowerCase() === 'refund' && l.at) {
          const dayKey = getDateStrInTimeZone(l.at, posTimezone);
          logRefundsByDay.set(dayKey, (logRefundsByDay.get(dayKey) || 0) + 1);
        }
      }
      const allRefundDays = new Set<string>([
        ...Array.from(orderRefundsByDay.keys()),
        ...Array.from(logRefundsByDay.keys())
      ]);
      let worstRefundDay = '';
      let worstRefundCount = 0;
      allRefundDays.forEach((day) => {
        const count = Math.max(
          orderRefundsByDay.get(day) || 0,
          logRefundsByDay.get(day) || 0
        );
        if (count >= 3 && count > worstRefundCount) {
          worstRefundCount = count;
          worstRefundDay = day;
        }
      });
      if (worstRefundCount >= 3) {
        const flagId = `pos_${shop.id}_refunds_day`;
        const existing = persistedById.get(flagId);
        out.push({
          id: flagId,
          subjectType: 'merchant',
          subjectId: shop.id,
          subjectName: shopLabel,
          reason: `POS multiple refunds in one day (${worstRefundCount} refunds on ${worstRefundDay})`,
          status: existing?.status || 'open',
          note: existing?.note || `Shop: ${shopLabel}. Reached 3+ POS refunds in a single day.`,
          createdAt: existing?.createdAt || null,
          updatedAt: existing?.updatedAt,
          createdBy: existing?.createdBy || 'POS Signal Detector',
          isComputedSuggestion: true,
          persistedInFirestore: Boolean(existing)
        });
      }

      // Signal 3: Shift with cash variance beyond threshold (default ₱200)
      const breachingShifts = snap.shifts.filter(
        (sh) => sh.variance !== null && Math.abs(sh.variance) > safeVarThreshold
      );
      if (breachingShifts.length > 0) {
        const maxShift = breachingShifts.reduce((best, cur) =>
          Math.abs(cur.variance || 0) > Math.abs(best.variance || 0) ? cur : best
        );
        const flagId = `pos_${shop.id}_cash_variance`;
        const existing = persistedById.get(flagId);
        const absVar = Math.abs(maxShift.variance || 0);
        out.push({
          id: flagId,
          subjectType: 'merchant',
          subjectId: shop.id,
          subjectName: shopLabel,
          reason: `POS shift cash variance ${formatPhp(absVar)} exceeds ${formatPhp(safeVarThreshold)}`,
          status: existing?.status || 'open',
          note:
            existing?.note ||
            `Shop: ${shopLabel}. ${breachingShifts.length} shift(s) exceeded ${formatPhp(safeVarThreshold)} cash variance (Cashier: ${maxShift.cashierName}).`,
          createdAt: existing?.createdAt || null,
          updatedAt: existing?.updatedAt,
          createdBy: existing?.createdBy || 'POS Signal Detector',
          isComputedSuggestion: true,
          persistedInFirestore: Boolean(existing)
        });
      }

      // Signal 4: Many price overrides
      const priceOverrides = snap.logs.filter(
        (l) => l.type.toLowerCase() === 'price_override'
      );
      if (priceOverrides.length >= safeOverrideThreshold) {
        const flagId = `pos_${shop.id}_price_overrides`;
        const existing = persistedById.get(flagId);
        out.push({
          id: flagId,
          subjectType: 'merchant',
          subjectId: shop.id,
          subjectName: shopLabel,
          reason: `Many POS price overrides (${priceOverrides.length} in last 7 days)`,
          status: existing?.status || 'open',
          note:
            existing?.note ||
            `Shop: ${shopLabel}. Recorded ${priceOverrides.length} price override log entries in the last 7 days.`,
          createdAt: existing?.createdAt || null,
          updatedAt: existing?.updatedAt,
          createdBy: existing?.createdBy || 'POS Signal Detector',
          isComputedSuggestion: true,
          persistedInFirestore: Boolean(existing)
        });
      }
    }

    return out;
  }, [rawPosSnapshots, flags, cashVarianceThreshold, priceOverrideThreshold, posTimezone]);

  // Combine persisted flags + computed POS suggestions (deduped by id)
  const combinedFlags = useMemo<DisplayFraudFlag[]>(() => {
    const map = new Map<string, DisplayFraudFlag>();
    for (const f of flags) {
      map.set(f.id, { ...f, persistedInFirestore: true });
    }
    for (const s of computedPosSuggestions) {
      map.set(s.id, s);
    }
    return Array.from(map.values());
  }, [flags, computedPosSuggestions]);

  // Automated detection scan (customers / high transfers)
  const handleRunDetectionScan = async () => {
    try {
      setScanning(true);
      let detectedCount = 0;

      // 1. Detect customers with repeated cancellations (3+ cancelled orders)
      const cancelledOrdersSnap = await getDocs(
        query(collection(db, 'orders'), where('status', '==', 'cancelled'))
      );
      const customerCancelCounts: Record<string, { count: number; name?: string }> = {};
      cancelledOrdersSnap.forEach((d) => {
        const data = d.data();
        const cid = data.customerId || data.userId;
        if (cid) {
          customerCancelCounts[cid] = customerCancelCounts[cid] || { count: 0, name: data.customerName };
          customerCancelCounts[cid].count++;
        }
      });

      const existingFlagsSnap = await getDocs(collection(db, 'fraudFlags'));
      const existingKeySet = new Set<string>();
      existingFlagsSnap.forEach((d) => {
        const dt = d.data();
        existingKeySet.add(`${dt.subjectType}_${dt.subjectId}_${dt.reason}`);
      });

      for (const [cid, info] of Object.entries(customerCancelCounts)) {
        if (info.count >= 3) {
          const reasonKey = `Repeated order cancellations (${info.count} times)`;
          const key = `customer_${cid}_${reasonKey}`;
          if (!existingKeySet.has(key)) {
            const flagId = `flag_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
            const payload = {
              id: flagId,
              subjectType: 'customer' as const,
              subjectId: cid,
              reason: reasonKey,
              status: 'open' as const,
              note: `Automated detection: Account has ${info.count} cancelled orders. Customer name: ${info.name || 'Unknown'}.`,
              createdAt: nowTs(),
              createdBy: adminProfile?.email || 'system_detector'
            };
            await setDoc(doc(db, 'fraudFlags', flagId), payload);
            existingKeySet.add(key);
            detectedCount++;
          }
        }
      }

      // 2. High wallet transfers (> ₱5,000)
      const highTransfersSnap = await getDocs(
        query(collection(db, 'walletTransfers'), where('amount', '>=', 5000))
      );
      for (const d of highTransfersSnap.docs) {
        const dt = d.data();
        const sender = dt.senderUid || dt.senderId || dt.fromUid;
        if (sender) {
          const reasonKey = `Unusually high wallet transfer (₱${dt.amount?.toLocaleString()})`;
          const key = `customer_${sender}_${reasonKey}`;
          if (!existingKeySet.has(key)) {
            const flagId = `flag_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
            const payload = {
              id: flagId,
              subjectType: 'customer' as const,
              subjectId: sender,
              reason: reasonKey,
              status: 'open' as const,
              note: `Automated detection: Single transfer of ₱${dt.amount} to ${dt.recipientPhone || dt.recipientEmail || 'recipient'}. Reference: ${d.id}`,
              createdAt: nowTs(),
              createdBy: adminProfile?.email || 'system_detector'
            };
            await setDoc(doc(db, 'fraudFlags', flagId), payload);
            existingKeySet.add(key);
            detectedCount++;
          }
        }
      }

      await Promise.all([fetchFlags(), computeMerchantPosSnapshots()]);
      if (detectedCount > 0) {
        showSuccess(`Scan complete. Detected and flagged ${detectedCount} suspicious activity instance(s).`);
      } else {
        showSuccess('Scan complete. Refreshed POS & account signals.');
      }
    } catch (err: any) {
      showError(err);
    } finally {
      setScanning(false);
    }
  };

  // Create manual flag
  const handleCreateFlag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubjectId.trim()) {
      showError('Please provide the Subject ID / UID.');
      return;
    }
    try {
      setCreatingFlag(true);
      const flagId = `flag_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const payload = {
        id: flagId,
        subjectType: newSubjectType,
        subjectId: newSubjectId.trim(),
        reason: newReason.trim(),
        status: 'open' as const,
        note: newNote.trim(),
        createdAt: nowTs(),
        createdBy: adminProfile?.email || 'admin'
      };

      await setDoc(doc(db, 'fraudFlags', flagId), payload);

      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        adminEmail: adminProfile?.email,
        action: 'CREATE_FRAUD_FLAG',
        entityType: 'fraudFlags',
        entityId: flagId,
        details: `Created fraud flag for ${newSubjectType} ID ${newSubjectId}. Reason: ${newReason}`
      });

      showSuccess('Fraud flag created successfully.');
      setCreateModalOpen(false);
      setNewSubjectId('');
      setNewNote('');
      await fetchFlags();
    } catch (err: any) {
      showError(err);
    } finally {
      setCreatingFlag(false);
    }
  };

  // Toggle status dismiss / reopen (persists computed POS suggestions if not yet saved)
  const handleToggleStatus = async (flag: DisplayFraudFlag) => {
    try {
      const newStatus = flag.status === 'open' ? 'dismissed' : 'open';
      const now = nowTs();
      if (flag.persistedInFirestore) {
        await updateDoc(doc(db, 'fraudFlags', flag.id), {
          status: newStatus,
          updatedAt: now
        });
      } else {
        await setDoc(
          doc(db, 'fraudFlags', flag.id),
          {
            id: flag.id,
            subjectType: flag.subjectType,
            subjectId: flag.subjectId,
            ...(flag.subjectName ? { subjectName: flag.subjectName } : {}),
            reason: flag.reason,
            status: newStatus,
            note: flag.note || '',
            createdAt: now,
            updatedAt: now,
            createdBy: adminProfile?.email || 'POS Signal Detector'
          },
          { merge: true }
        );
      }

      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        adminEmail: adminProfile?.email,
        action: newStatus === 'dismissed' ? 'DISMISS_FRAUD_FLAG' : 'REOPEN_FRAUD_FLAG',
        entityType: 'fraudFlags',
        entityId: flag.id,
        details: `Updated ${flag.subjectType} fraud flag (${flag.subjectId}) status to ${newStatus}`
      });

      showSuccess(`Flag marked as ${newStatus}.`);
      await fetchFlags();
    } catch (err: any) {
      showError(err);
    }
  };

  // Save note (persists computed POS suggestions if not yet saved)
  const handleSaveNote = async () => {
    if (!selectedFlagForNote) return;
    try {
      setSavingNote(true);
      const trimmedNote = noteText.trim();
      const now = nowTs();
      if (selectedFlagForNote.persistedInFirestore) {
        await updateDoc(doc(db, 'fraudFlags', selectedFlagForNote.id), {
          note: trimmedNote,
          updatedAt: now
        });
      } else {
        await setDoc(
          doc(db, 'fraudFlags', selectedFlagForNote.id),
          {
            id: selectedFlagForNote.id,
            subjectType: selectedFlagForNote.subjectType,
            subjectId: selectedFlagForNote.subjectId,
            ...(selectedFlagForNote.subjectName
              ? { subjectName: selectedFlagForNote.subjectName }
              : {}),
            reason: selectedFlagForNote.reason,
            status: selectedFlagForNote.status,
            note: trimmedNote,
            createdAt: now,
            updatedAt: now,
            createdBy: adminProfile?.email || 'POS Signal Detector'
          },
          { merge: true }
        );
      }

      showSuccess('Flag note updated.');
      setSelectedFlagForNote(null);
      await fetchFlags();
    } catch (err: any) {
      showError(err);
    } finally {
      setSavingNote(false);
    }
  };

  // Suspend account
  const handleConfirmSuspend = async (reason?: string) => {
    if (!flagToSuspend) return;
    if (!isFullAdmin) {
      showError('Permission denied: Only full admins can suspend accounts.');
      return;
    }

    try {
      setSuspending(true);
      const subId = flagToSuspend.subjectId;
      const subType = flagToSuspend.subjectType;

      if (subType === 'customer') {
        await updateDoc(doc(db, 'users', subId), {
          status: 'suspended',
          suspendedAt: nowTs(),
          suspendedReason: reason || flagToSuspend.reason
        });
      } else if (subType === 'merchant') {
        await updateDoc(doc(db, 'merchants', subId), {
          status: 'suspended',
          suspendedAt: nowTs(),
          suspendedReason: reason || flagToSuspend.reason
        });
      } else {
        await updateDoc(doc(db, 'riders', subId), {
          status: 'suspended',
          suspendedAt: nowTs(),
          suspendedReason: reason || flagToSuspend.reason
        });
        try {
          await updateDoc(doc(db, 'users', subId), {
            status: 'suspended',
            suspendedAt: nowTs(),
            suspendedReason: reason || flagToSuspend.reason
          });
        } catch {
          // May only be in riders collection
        }
      }

      const updatedNote = `${flagToSuspend.note ? flagToSuspend.note + '\n' : ''}[${new Date().toLocaleDateString()}] Account suspended by ${adminProfile?.email}. Reason: ${reason || flagToSuspend.reason}`;
      await setDoc(
        doc(db, 'fraudFlags', flagToSuspend.id),
        {
          id: flagToSuspend.id,
          subjectType: flagToSuspend.subjectType,
          subjectId: flagToSuspend.subjectId,
          reason: flagToSuspend.reason,
          status: flagToSuspend.status,
          note: updatedNote,
          accountSuspended: true,
          updatedAt: nowTs(),
          createdAt: flagToSuspend.createdAt || nowTs(),
          createdBy: flagToSuspend.createdBy || adminProfile?.email || 'admin'
        },
        { merge: true }
      );

      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        adminEmail: adminProfile?.email,
        action: 'SUSPEND_FRAUD_ACCOUNT',
        entityType:
          subType === 'customer' ? 'users' : subType === 'merchant' ? 'merchants' : 'riders',
        entityId: subId,
        details: `Suspended ${subType} account for fraud flag ${flagToSuspend.id}. Reason: ${reason || flagToSuspend.reason}`,
        reason: reason || flagToSuspend.reason
      });

      showSuccess(`${subType.toUpperCase()} account ${subId} has been SUSPENDED.`);
      setSuspendModalOpen(false);
      setFlagToSuspend(null);
      await fetchFlags();
    } catch (err: any) {
      showError(err);
    } finally {
      setSuspending(false);
    }
  };

  const filteredFlags = combinedFlags.filter((f) => {
    if (statusFilter !== 'all' && f.status !== statusFilter) return false;
    if (subjectFilter !== 'all' && f.subjectType !== subjectFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchId = f.subjectId.toLowerCase().includes(q);
      const matchName = (f.subjectName || '').toLowerCase().includes(q);
      const matchReason = f.reason.toLowerCase().includes(q);
      const matchNote = (f.note || '').toLowerCase().includes(q);
      if (!matchId && !matchName && !matchReason && !matchNote) return false;
    }
    return true;
  });

  const openCount = combinedFlags.filter((f) => f.status === 'open').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl md:text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">
              Fraud & Risk Flags
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-400">
              {openCount} Open
            </span>
          </div>
          <p className="text-sm text-gray-500 dark:text-zinc-400 mt-0.5">
            Monitor customers, drivers, and merchant POS anomaly signals (void rates, refunds, cash variance, price overrides).
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            type="button"
            onClick={handleRunDetectionScan}
            disabled={scanning}
            className="flex items-center gap-2 px-3.5 py-2 rounded-2xl bg-gray-100 dark:bg-zinc-800 text-gray-800 dark:text-zinc-200 hover:bg-gray-200 dark:hover:bg-zinc-700 text-xs font-bold transition-all shadow-xs disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${scanning ? 'animate-spin' : ''}`} />
            <span>{scanning ? 'Scanning...' : 'Run Detection Scan'}</span>
          </button>

          <button
            type="button"
            onClick={() => setCreateModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-2xl bg-amber-400 text-black hover:bg-amber-500 text-xs font-bold transition-all shadow-xs"
          >
            <Plus className="w-4 h-4" />
            <span>Flag Account</span>
          </button>
        </div>
      </div>

      {/* Merchant POS Signal Thresholds Panel (computed on page over last 7 days) */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-4 shadow-xs space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <div className="p-2 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 shrink-0">
              <SlidersHorizontal className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-gray-900 dark:text-white">
                  Merchant POS Signal Rules (Last 7 Days)
                </h3>
                {computingPosSignals ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-600 dark:text-amber-400">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Checking {posSignalsProgress.done}/{posSignalsProgress.total} shops...
                  </span>
                ) : (
                  <span className="text-[11px] text-gray-500 dark:text-zinc-400">
                    {computedPosSuggestions.filter((s) => s.status === 'open').length} open POS signal(s) across {rawPosSnapshots.length} shops
                  </span>
                )}
              </div>
              <p className="text-[11px] text-gray-500 dark:text-zinc-400 mt-0.5">
                Flags void rate &gt; 10% (7d), 3+ refunds in one day, shift cash variance beyond threshold, or excessive price overrides.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap text-xs">
            <label className="flex items-center gap-1.5 font-bold text-gray-700 dark:text-zinc-300">
              <span>Cash variance threshold (₱):</span>
              <input
                type="number"
                min={0}
                step={50}
                value={cashVarianceThreshold}
                onChange={(e) => setCashVarianceThreshold(Math.max(0, Number(e.target.value)))}
                className="w-24 px-2.5 py-1.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-extrabold text-gray-900 dark:text-white tabular-nums"
              />
            </label>

            <label className="flex items-center gap-1.5 font-bold text-gray-700 dark:text-zinc-300">
              <span>Min price overrides (7d):</span>
              <input
                type="number"
                min={1}
                step={1}
                value={priceOverrideThreshold}
                onChange={(e) => setPriceOverrideThreshold(Math.max(1, Number(e.target.value) || 1))}
                className="w-16 px-2.5 py-1.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-extrabold text-gray-900 dark:text-white tabular-nums"
              />
            </label>

            <button
              type="button"
              onClick={computeMerchantPosSnapshots}
              disabled={computingPosSignals}
              className="px-3 py-1.5 rounded-xl border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 hover:bg-gray-100 text-xs font-bold text-gray-700 dark:text-zinc-200 flex items-center gap-1.5 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${computingPosSignals ? 'animate-spin' : ''}`} />
              <span>Recheck POS</span>
            </button>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-4 shadow-xs space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Status Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
            {[
              { id: 'open' as const, label: 'Open Flags' },
              { id: 'dismissed' as const, label: 'Dismissed' },
              { id: 'all' as const, label: 'All History' }
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  statusFilter === tab.id
                    ? 'bg-amber-400 text-black shadow-xs'
                    : 'text-gray-600 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Subject Filter */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 font-semibold">Subject:</span>
            <select
              value={subjectFilter}
              onChange={(e) => setSubjectFilter(e.target.value as any)}
              className="px-3 py-1.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold text-gray-900 dark:text-white"
            >
              <option value="all">All Subjects</option>
              <option value="customer">Customers Only</option>
              <option value="driver">Drivers Only</option>
              <option value="merchant">Merchants Only (POS)</option>
            </select>
          </div>
        </div>

        {/* Search Input */}
        <div className="relative">
          <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by User / Driver / Shop ID, shop name, reason, or notes..."
            className="w-full pl-9 pr-4 py-2 rounded-xl border border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-850 text-xs text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
        </div>
      </div>

      {/* Flags List */}
      {loading && combinedFlags.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 bg-white dark:bg-zinc-900 rounded-3xl border border-gray-200 dark:border-zinc-800">
          <Loader2 className="w-8 h-8 animate-spin text-amber-500 mb-3" />
          <p className="text-xs text-gray-500 font-semibold">Loading fraud flags...</p>
        </div>
      ) : filteredFlags.length === 0 ? (
        <div className="text-center p-12 bg-white dark:bg-zinc-900 rounded-3xl border border-gray-200 dark:border-zinc-800">
          <ShieldAlert className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
          <h3 className="text-sm font-bold text-gray-900 dark:text-white">No Fraud Flags Found</h3>
          <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
            {statusFilter === 'open'
              ? 'No open risk flags. You can run a detection scan or manually flag suspicious activities.'
              : 'No matching records for current filters.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {filteredFlags.map((flag) => {
            const isDriver = flag.subjectType === 'driver';
            const isMerchant = flag.subjectType === 'merchant';
            const isOpen = flag.status === 'open';

            return (
              <div
                key={flag.id}
                className={`p-5 rounded-3xl border transition-all ${
                  isOpen
                    ? 'bg-white dark:bg-zinc-900 border-rose-200 dark:border-rose-900/40 shadow-xs'
                    : 'bg-gray-50/70 dark:bg-zinc-900/40 border-gray-200 dark:border-zinc-800 opacity-75'
                }`}
              >
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                  {/* Subject and Reason */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-extrabold uppercase tracking-wider ${
                          isMerchant
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300'
                            : isDriver
                            ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400'
                            : 'bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-400'
                        }`}
                      >
                        {isMerchant ? (
                          <Store className="w-3 h-3" />
                        ) : isDriver ? (
                          <Bike className="w-3 h-3" />
                        ) : (
                          <User className="w-3 h-3" />
                        )}
                        {flag.subjectType}
                      </span>

                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${
                          isOpen
                            ? 'bg-rose-500 text-white'
                            : 'bg-gray-200 dark:bg-zinc-700 text-gray-600 dark:text-zinc-300'
                        }`}
                      >
                        {flag.status}
                      </span>

                      {flag.isComputedSuggestion && (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                          POS Suggestion
                        </span>
                      )}

                      {flag.subjectName && (
                        <span className="text-xs font-bold text-gray-900 dark:text-white">
                          {flag.subjectName}
                        </span>
                      )}

                      <span className="text-xs font-mono font-semibold text-gray-500 dark:text-zinc-400">
                        ID: {flag.subjectId}
                      </span>
                    </div>

                    <div className="flex items-baseline gap-2">
                      <AlertOctagon className={`w-4 h-4 flex-shrink-0 ${isOpen ? 'text-rose-600' : 'text-gray-400'}`} />
                      <h4 className="text-sm font-extrabold text-gray-900 dark:text-white">
                        {flag.reason}
                      </h4>
                    </div>

                    {flag.note && (
                      <div className="p-3 bg-gray-50 dark:bg-zinc-800 rounded-2xl border border-gray-100 dark:border-zinc-700 text-xs text-gray-600 dark:text-zinc-300 whitespace-pre-line">
                        <span className="font-bold text-gray-900 dark:text-white block mb-0.5">Admin Notes:</span>
                        {flag.note}
                      </div>
                    )}

                    <div className="text-[11px] text-gray-400 flex items-center gap-3">
                      <span>
                        Flagged:{' '}
                        {flag.createdAt?.toDate
                          ? flag.createdAt.toDate().toLocaleString()
                          : flag.isComputedSuggestion
                          ? 'Live (Last 7 days)'
                          : 'N/A'}
                      </span>
                      <span>By: {flag.createdBy || 'System'}</span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-wrap md:flex-col md:items-end justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedFlagForNote(flag);
                        setNoteText(flag.note || '');
                      }}
                      className="px-3 py-1.5 rounded-xl border border-gray-200 dark:border-zinc-700 text-xs font-bold text-gray-700 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-zinc-800 transition-all flex items-center gap-1.5"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>{flag.note ? 'Edit Note' : 'Add Note'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleToggleStatus(flag)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                        isOpen
                          ? 'bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-zinc-300 hover:bg-gray-200'
                          : 'bg-amber-400 text-black hover:bg-amber-500'
                      }`}
                    >
                      <CheckCircle className="w-3.5 h-3.5" />
                      <span>{isOpen ? 'Dismiss Flag' : 'Reopen Flag'}</span>
                    </button>

                    {/* Suspend account button (allowed only for full admin) */}
                    <button
                      type="button"
                      disabled={!isFullAdmin}
                      title={!isFullAdmin ? 'Only full admins can suspend accounts' : 'Suspend account'}
                      onClick={() => {
                        setFlagToSuspend(flag);
                        setSuspendModalOpen(true);
                      }}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                        isFullAdmin
                          ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 hover:bg-rose-100'
                          : 'opacity-40 cursor-not-allowed bg-gray-100 dark:bg-zinc-800 text-gray-400'
                      }`}
                    >
                      <Ban className="w-3.5 h-3.5" />
                      <span>Suspend Account</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Manual Flag Modal */}
      {createModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-3xl p-6 border border-gray-200 dark:border-zinc-800 shadow-xl space-y-4">
            <div className="flex items-center gap-2 pb-2 border-b border-gray-100 dark:border-zinc-800">
              <ShieldAlert className="w-5 h-5 text-rose-500" />
              <h3 className="font-extrabold text-base text-gray-900 dark:text-white">
                Flag Customer, Driver, or Merchant
              </h3>
            </div>

            <form onSubmit={handleCreateFlag} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-zinc-300 mb-1">
                  Subject Type
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setNewSubjectType('customer')}
                    className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all ${
                      newSubjectType === 'customer'
                        ? 'bg-purple-100 border-purple-300 text-purple-900 dark:bg-purple-950 dark:border-purple-800 dark:text-purple-200'
                        : 'border-gray-200 dark:border-zinc-700 text-gray-600'
                    }`}
                  >
                    Customer
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewSubjectType('driver')}
                    className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all ${
                      newSubjectType === 'driver'
                        ? 'bg-blue-100 border-blue-300 text-blue-900 dark:bg-blue-950 dark:border-blue-800 dark:text-blue-200'
                        : 'border-gray-200 dark:border-zinc-700 text-gray-600'
                    }`}
                  >
                    Driver
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewSubjectType('merchant')}
                    className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all ${
                      newSubjectType === 'merchant'
                        ? 'bg-amber-100 border-amber-300 text-amber-900 dark:bg-amber-950 dark:border-amber-800 dark:text-amber-200'
                        : 'border-gray-200 dark:border-zinc-700 text-gray-600'
                    }`}
                  >
                    Merchant
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-zinc-300 mb-1">
                  {newSubjectType === 'customer'
                    ? 'Customer UID'
                    : newSubjectType === 'merchant'
                    ? 'Merchant / Shop ID'
                    : 'Driver / Rider ID'}
                </label>
                <input
                  type="text"
                  required
                  value={newSubjectId}
                  onChange={(e) => setNewSubjectId(e.target.value)}
                  placeholder="e.g. u12345, r_98765, or shopId"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-mono text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-zinc-300 mb-1">
                  Reason for Flag
                </label>
                <select
                  value={newReason}
                  onChange={(e) => setNewReason(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold text-gray-900 dark:text-white"
                >
                  <option value="Repeated cancellations">Repeated cancellations</option>
                  <option value="Many failed payments">Many failed payments</option>
                  <option value="Very high wallet transfers">Very high wallet transfers</option>
                  <option value="POS cash variance or excessive voids">POS cash variance or excessive voids</option>
                  <option value="Fake order / Location spoofing">Fake order / Location spoofing</option>
                  <option value="Abusive behavior / Policy violation">Abusive behavior / Policy violation</option>
                  <option value="Other suspicious activity">Other suspicious activity</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-zinc-300 mb-1">
                  Internal Notes & Evidence
                </label>
                <textarea
                  rows={3}
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="Document relevant order IDs, POS shift variance, suspicious patterns..."
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-gray-900 dark:text-white"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCreateModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-gray-200 dark:border-zinc-700 text-xs font-bold text-gray-700 dark:text-zinc-300 hover:bg-gray-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingFlag}
                  className="px-5 py-2 rounded-xl bg-amber-400 text-black hover:bg-amber-500 text-xs font-bold shadow-xs flex items-center gap-1.5 disabled:opacity-50"
                >
                  {creatingFlag && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Save Flag</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Note Modal */}
      {selectedFlagForNote && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-3xl p-6 border border-gray-200 dark:border-zinc-800 shadow-xl space-y-4">
            <h3 className="font-extrabold text-base text-gray-900 dark:text-white">
              Flag Note for {selectedFlagForNote.subjectType} {selectedFlagForNote.subjectId}
            </h3>

            <textarea
              rows={4}
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Add internal notes, investigation details, or resolutions..."
              className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-400"
            />

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setSelectedFlagForNote(null)}
                className="px-4 py-2 rounded-xl border border-gray-200 dark:border-zinc-700 text-xs font-bold text-gray-700 dark:text-zinc-300 hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveNote}
                disabled={savingNote}
                className="px-5 py-2 rounded-xl bg-amber-400 text-black hover:bg-amber-500 text-xs font-bold shadow-xs flex items-center gap-1.5 disabled:opacity-50"
              >
                {savingNote && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Save Note</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Suspend */}
      {suspendModalOpen && flagToSuspend && (
        <ConfirmationModal
          isOpen={suspendModalOpen}
          onClose={() => {
            setSuspendModalOpen(false);
            setFlagToSuspend(null);
          }}
          onConfirm={handleConfirmSuspend}
          title={`Suspend ${flagToSuspend.subjectType.toUpperCase()} Account?`}
          message={`Are you sure you want to suspend ${flagToSuspend.subjectType} ${flagToSuspend.subjectId}? This will immediately block login and prevent new bookings or orders.`}
          confirmLabel="Suspend Account"
          reasonRequired={true}
          isDestructive={true}
        />
      )}
    </div>
  );
};
