import React, { useEffect, useMemo, useState } from 'react';
import {
  db,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  setDoc,
  updateDoc,
  query,
  limit,
  increment,
  Timestamp
} from '../firebase';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { logAuditEvent } from '../utils/audit';
import { nowTs, dateToTs, formatTimestamp, formatRelativeTime, parseDate } from '../utils/date';
import {
  releaseOrderFromRiderTransaction,
  cancelOrderWithRefundTransaction,
  computeNextMerchantOpening
} from '../utils/orderActions';
import { SERVICE_LABELS } from '../constants';
import { ConfirmationModal } from '../components/common/ConfirmationModal';
import type { OrderReport, OrderReportStatus, Merchant, Rider } from '../types';
import {
  AlertTriangle,
  Store,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  ShoppingBag,
  User,
  Car,
  CreditCard,
  FileText,
  Ban,
  Send,
  ShieldAlert,
  Loader2,
  X,
  Search,
  Calendar,
  Filter
} from 'lucide-react';

type ReportTab = 'close_restaurant' | 'cr_cancellation';
type ForceCloseDuration = '1h' | '3h' | 'next_opening' | 'until_reopen';

function getServiceLabel(svc?: string): string {
  if (!svc) return 'Unknown';
  const key = svc.toLowerCase() as keyof typeof SERVICE_LABELS;
  return SERVICE_LABELS[key] || svc;
}

function getPhtDateKey(ts: any): string {
  const d = parseDate(ts);
  if (!d) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
}

function getStatusBadgeClass(status: OrderReportStatus | string): string {
  switch (status) {
    case 'Pending':
      return 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800';
    case 'Reviewing':
      return 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800';
    case 'Resolved':
      return 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800';
    case 'Rejected':
      return 'bg-red-100 text-red-800 border-red-300 dark:bg-red-950/60 dark:text-red-300 dark:border-red-800';
    case 'Auto':
    default:
      return 'bg-gray-100 text-gray-700 border-gray-300 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700';
  }
}

export const RiderReports: React.FC = () => {
  const { adminProfile } = useAuth();
  const { showSuccess, showError } = useToast();

  const [activeTab, setActiveTab] = useState<ReportTab>('close_restaurant');
  const [reports, setReports] = useState<OrderReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);

  // Close restaurant queue filter
  const [queueStatusFilter, setQueueStatusFilter] = useState<
    'all' | 'Pending' | 'Reviewing' | 'Resolved' | 'Rejected'
  >('all');
  const [queueSearch, setQueueSearch] = useState('');

  // CR cancellations filters
  const [crRiderFilter, setCrRiderFilter] = useState<string>('all');
  const [crServiceFilter, setCrServiceFilter] = useState<string>('all');
  const [crDateFilter, setCrDateFilter] = useState<string>('');
  const [crSearch, setCrSearch] = useState<string>('');

  // Enriched lookup info for selected report (rider falseReportCount, merchant, live order)
  const [selectedRiderInfo, setSelectedRiderInfo] = useState<Rider | null>(null);
  const [selectedOrderDoc, setSelectedOrderDoc] = useState<Record<string, any> | null>(null);
  const [selectedMerchantDoc, setSelectedMerchantDoc] = useState<Merchant | null>(null);
  const [platformTimezone, setPlatformTimezone] = useState<string>('Asia/Manila');

  // Action modals
  const [busyAction, setBusyAction] = useState(false);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [raiseFraudFlagOnReject, setRaiseFraudFlagOnReject] = useState(false);

  const [pabiliBlockDialogOpen, setPabiliBlockDialogOpen] = useState(false);
  const [forceCloseModalOpen, setForceCloseModalOpen] = useState(false);
  const [forceCloseDuration, setForceCloseDuration] = useState<ForceCloseDuration>('1h');

  const [followUpPromptReport, setFollowUpPromptReport] = useState<OrderReport | null>(null);

  const [cancelOrderModalOpen, setCancelOrderModalOpen] = useState(false);
  const [cancelReasonText, setCancelReasonText] = useState(
    'Merchant is closed (verified from rider report)'
  );
  const [cancelFault, setCancelFault] = useState<'merchant' | 'customer' | 'rider' | 'platform'>(
    'merchant'
  );
  const [refundToWallet, setRefundToWallet] = useState(true);

  const [redispatchModalOpen, setRedispatchModalOpen] = useState(false);

  const adminUid = adminProfile?.uid || 'admin';
  const adminName = adminProfile?.name || adminProfile?.email || 'Administrator';

  // Load platform timezone once
  useEffect(() => {
    getDoc(doc(db, 'settings', 'platform'))
      .then((snap) => {
        if (snap.exists() && snap.data()?.timezone) {
          setPlatformTimezone(String(snap.data().timezone));
        }
      })
      .catch(() => {});
  }, []);

  // Live listener on orderReports
  useEffect(() => {
    setLoading(true);
    const q = query(collection(db, 'orderReports'), limit(300));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: OrderReport[] = [];
        snap.forEach((d) => {
          const dt = d.data();
          list.push({
            id: d.id,
            type: dt.type === 'cr_cancellation' ? 'cr_cancellation' : 'close_restaurant',
            orderId: dt.orderId || '',
            orderNumber: dt.orderNumber || dt.orderId?.slice(0, 8)?.toUpperCase() || d.id,
            serviceType: dt.serviceType || 'food',
            merchantId: dt.merchantId || null,
            merchantName: dt.merchantName || null,
            branchName: dt.branchName || null,
            customerId: dt.customerId || null,
            customerName: dt.customerName || null,
            riderId: dt.riderId || '',
            riderName: dt.riderName || 'Driver',
            amount: Number(dt.amount) || 0,
            paymentMethod: dt.paymentMethod || 'cod',
            items: Array.isArray(dt.items) ? dt.items : [],
            status: dt.status || (dt.type === 'cr_cancellation' ? 'Auto' : 'Pending'),
            resolution: dt.resolution || null,
            note: dt.note || '',
            createdAt: dt.createdAt,
            acceptedAt: dt.acceptedAt,
            acceptedBy: dt.acceptedBy || null,
            acceptedByName: dt.acceptedByName || null,
            resolvedAt: dt.resolvedAt,
            resolvedBy: dt.resolvedBy || null,
            resolvedById: dt.resolvedById || null,
            forceCloseDurationLabel: dt.forceCloseDurationLabel || null,
            followUpOrderAction: dt.followUpOrderAction || null,
            updatedAt: dt.updatedAt
          });
        });

        // Sort newest first
        list.sort((a, b) => {
          const tA = parseDate(a.createdAt)?.getTime() || 0;
          const tB = parseDate(b.createdAt)?.getTime() || 0;
          return tB - tA;
        });

        setReports(list);
        setLoading(false);
      },
      (err) => {
        showError(err);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [showError]);

  const closeRestaurantReports = useMemo(
    () => reports.filter((r) => r.type === 'close_restaurant'),
    [reports]
  );

  const crCancellationReports = useMemo(
    () => reports.filter((r) => r.type === 'cr_cancellation'),
    [reports]
  );

  const pendingCloseCount = useMemo(
    () => closeRestaurantReports.filter((r) => r.status === 'Pending').length,
    [closeRestaurantReports]
  );

  const filteredCloseReports = useMemo(() => {
    const q = queueSearch.trim().toLowerCase();
    return closeRestaurantReports.filter((r) => {
      if (queueStatusFilter !== 'all' && r.status !== queueStatusFilter) return false;
      if (q) {
        const hay = [
          r.orderNumber,
          r.orderId,
          r.merchantName,
          r.branchName,
          r.riderName,
          r.customerName,
          r.note
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [closeRestaurantReports, queueStatusFilter, queueSearch]);

  const crRidersList = useMemo(() => {
    const map = new Map<string, string>();
    crCancellationReports.forEach((r) => {
      if (r.riderId) {
        map.set(r.riderId, r.riderName || r.riderId);
      }
    });
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [crCancellationReports]);

  const filteredCrReports = useMemo(() => {
    const q = crSearch.trim().toLowerCase();
    return crCancellationReports.filter((r) => {
      if (crRiderFilter !== 'all' && r.riderId !== crRiderFilter) return false;
      if (crServiceFilter !== 'all' && r.serviceType !== crServiceFilter) return false;
      if (crDateFilter && getPhtDateKey(r.createdAt) !== crDateFilter) return false;
      if (q) {
        const hay = [
          r.orderNumber,
          r.orderId,
          r.merchantName,
          r.riderName,
          r.customerName,
          r.note
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [crCancellationReports, crRiderFilter, crServiceFilter, crDateFilter, crSearch]);

  // Count per rider for filtered CR cancellations
  const crCountsByRider = useMemo(() => {
    const counts = new Map<string, { riderId: string; riderName: string; count: number }>();
    filteredCrReports.forEach((r) => {
      const key = r.riderId || 'unknown';
      const existing = counts.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        counts.set(key, {
          riderId: key,
          riderName: r.riderName || 'Unknown rider',
          count: 1
        });
      }
    });
    return Array.from(counts.values()).sort((a, b) => b.count - a.count);
  }, [filteredCrReports]);

  const selectedReport = useMemo(() => {
    const list =
      activeTab === 'close_restaurant' ? filteredCloseReports : filteredCrReports;
    if (selectedReportId) {
      const found = reports.find((r) => r.id === selectedReportId && r.type === activeTab);
      if (found) return found;
    }
    return list[0] || null;
  }, [activeTab, filteredCloseReports, filteredCrReports, reports, selectedReportId]);

  // Load supplementary order, rider, and merchant context for selected report
  useEffect(() => {
    let active = true;
    const loadContext = async () => {
      if (!selectedReport) {
        setSelectedRiderInfo(null);
        setSelectedOrderDoc(null);
        setSelectedMerchantDoc(null);
        return;
      }
      try {
        const [rSnap, oSnap, mSnap] = await Promise.all([
          selectedReport.riderId
            ? getDoc(doc(db, 'riders', selectedReport.riderId))
            : Promise.resolve(null),
          selectedReport.orderId
            ? getDoc(doc(db, 'orders', selectedReport.orderId))
            : Promise.resolve(null),
          selectedReport.merchantId
            ? getDoc(doc(db, 'merchants', selectedReport.merchantId))
            : Promise.resolve(null)
        ]);
        if (!active) return;

        setSelectedRiderInfo(
          rSnap && rSnap.exists() ? ({ id: rSnap.id, ...rSnap.data() } as Rider) : null
        );
        setSelectedOrderDoc(oSnap && oSnap.exists() ? { id: oSnap.id, ...oSnap.data() } : null);
        setSelectedMerchantDoc(
          mSnap && mSnap.exists() ? ({ id: mSnap.id, ...mSnap.data() } as Merchant) : null
        );
      } catch {
        // Ignore non-fatal detail lookup issues
      }
    };
    loadContext();
    return () => {
      active = false;
    };
  }, [selectedReport?.id, selectedReport?.riderId, selectedReport?.orderId, selectedReport?.merchantId]);

  // Action: Accept Pending Report -> Reviewing
  const handleAcceptReport = async (report: OrderReport) => {
    if (report.status !== 'Pending') return;
    try {
      setBusyAction(true);
      const now = nowTs();
      await updateDoc(doc(db, 'orderReports', report.id), {
        status: 'Reviewing',
        acceptedAt: now,
        acceptedBy: adminUid,
        acceptedByName: adminName,
        updatedAt: now
      });

      await logAuditEvent({
        adminId: adminUid,
        adminName,
        adminEmail: adminProfile?.email,
        action: 'ACCEPT_RIDER_REPORT',
        entityType: 'orderReports',
        entityId: report.id,
        details: `Accepted close-restaurant report for Order #${report.orderNumber} (${report.merchantName || 'No merchant'}) by ${report.riderName}`,
        oldValue: { status: 'Pending' },
        newValue: { status: 'Reviewing', acceptedByName: adminName }
      });

      setSelectedReportId(report.id);
      showSuccess(`Accepted report for Order #${report.orderNumber}. Reviewing details.`);
    } catch (err: any) {
      showError(err);
    } finally {
      setBusyAction(false);
    }
  };

  // Action: Reject Report (releases order, increments rider falseReportCount, optionally raises fraud flag)
  const handleOpenRejectModal = async (report: OrderReport) => {
    setSelectedReportId(report.id);
    setRejectReason('');
    let currentFalseCount =
      selectedReport?.id === report.id ? Number(selectedRiderInfo?.falseReportCount || 0) : 0;
    if (report.riderId && selectedReport?.id !== report.id) {
      try {
        const rSnap = await getDoc(doc(db, 'riders', report.riderId));
        if (rSnap.exists()) {
          currentFalseCount = Number(rSnap.data()?.falseReportCount || 0);
        }
      } catch {
        // Fallback to 0
      }
    }
    setRaiseFraudFlagOnReject(currentFalseCount + 1 >= 3);
    setRejectModalOpen(true);
  };

  const handleConfirmRejectReport = async () => {
    if (!selectedReport) return;
    try {
      setBusyAction(true);
      const now = nowTs();
      const noteClean = rejectReason.trim();

      // 1. Release order back to dispatch (onHold false, excludeRiderIds keeps reporting rider)
      if (selectedReport.orderId) {
        await releaseOrderFromRiderTransaction({
          orderId: selectedReport.orderId,
          riderId: selectedReport.riderId,
          mode: 'redispatch',
          historyNote: `Close-restaurant report rejected by Admin (${adminName})${noteClean ? `: ${noteClean}` : ''}. Order released to dispatch excluding reporting rider.`
        });
      }

      // 2. Mark report Rejected
      await updateDoc(doc(db, 'orderReports', selectedReport.id), {
        status: 'Rejected',
        resolution: 'rejected',
        resolvedAt: now,
        resolvedBy: adminName,
        resolvedById: adminUid,
        ...(noteClean ? { resolutionNote: noteClean } : {}),
        updatedAt: now
      });

      // 3. Increment rider falseReportCount & optionally create fraud flag
      let newFalseCount = Number(selectedRiderInfo?.falseReportCount || 0) + 1;
      if (selectedReport.riderId) {
        const riderRef = doc(db, 'riders', selectedReport.riderId);
        const rSnap = await getDoc(riderRef);
        const prevCount = rSnap.exists() ? Number(rSnap.data()?.falseReportCount || 0) : 0;
        newFalseCount = prevCount + 1;

        await updateDoc(riderRef, {
          falseReportCount: increment(1),
          lastFalseReportAt: now,
          updatedAt: now
        });

        if (raiseFraudFlagOnReject || newFalseCount >= 3) {
          const flagId = `flag_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
          await setDoc(doc(db, 'fraudFlags', flagId), {
            id: flagId,
            subjectType: 'driver',
            subjectId: selectedReport.riderId,
            subjectName: selectedReport.riderName,
            reason: `False close-restaurant report (${newFalseCount} total)`,
            status: 'open',
            note: `Order #${selectedReport.orderNumber}${selectedReport.merchantName ? ` (${selectedReport.merchantName})` : ''}. ${noteClean || 'Report rejected by admin.'}`,
            createdAt: now,
            createdBy: adminProfile?.email || adminName
          });
        }
      }

      await logAuditEvent({
        adminId: adminUid,
        adminName,
        adminEmail: adminProfile?.email,
        action: 'REJECT_RIDER_REPORT',
        entityType: 'orderReports',
        entityId: selectedReport.id,
        details: `Rejected close-restaurant report for Order #${selectedReport.orderNumber}; released order to dispatch; rider falseReportCount -> ${newFalseCount}${
          raiseFraudFlagOnReject || newFalseCount >= 3 ? ' (Fraud flag raised)' : ''
        }`,
        oldValue: { status: selectedReport.status },
        newValue: {
          status: 'Rejected',
          resolution: 'rejected',
          falseReportCount: newFalseCount
        },
        reason: noteClean || undefined
      });

      setRejectModalOpen(false);
      showSuccess(
        `Report rejected & Order #${selectedReport.orderNumber} released for redispatch.${
          raiseFraudFlagOnReject || newFalseCount >= 3 ? ' Fraud flag raised.' : ''
        }`
      );
    } catch (err: any) {
      showError(err);
    } finally {
      setBusyAction(false);
    }
  };

  // Trigger Force Close restaurant check (Pabili / no merchant guard)
  const handleTriggerForceClose = (report: OrderReport) => {
    const svc = String(selectedOrderDoc?.serviceType || report.serviceType || '').toLowerCase();
    const merchantId = selectedOrderDoc?.merchantId || report.merchantId;

    if (svc === 'pabili' || !merchantId) {
      setPabiliBlockDialogOpen(true);
      return;
    }
    setForceCloseDuration('1h');
    setForceCloseModalOpen(true);
  };

  const handleConfirmForceClose = async () => {
    if (!selectedReport) return;
    const merchantId = String(selectedOrderDoc?.merchantId || selectedReport.merchantId || '');
    if (!merchantId) {
      setForceCloseModalOpen(false);
      setPabiliBlockDialogOpen(true);
      return;
    }

    try {
      setBusyAction(true);
      const now = nowTs();
      const mRef = doc(db, 'merchants', merchantId);
      const mSnap = await getDoc(mRef);
      const mData = mSnap.exists() ? ({ id: mSnap.id, ...mSnap.data() } as Merchant) : selectedMerchantDoc;

      let targetDate: Date;
      let durationLabel = '';
      if (forceCloseDuration === '1h') {
        targetDate = new Date(Date.now() + 60 * 60 * 1000);
        durationLabel = '1 hour';
      } else if (forceCloseDuration === '3h') {
        targetDate = new Date(Date.now() + 3 * 60 * 60 * 1000);
        durationLabel = '3 hours';
      } else if (forceCloseDuration === 'next_opening') {
        const nextOpen = computeNextMerchantOpening(mData, platformTimezone);
        targetDate = nextOpen.date;
        durationLabel = `until next opening (${nextOpen.displayString})`;
      } else {
        targetDate = new Date('2100-01-01T00:00:00.000Z');
        durationLabel = 'until I reopen';
      }

      const closedUntilTs = dateToTs(targetDate);

      // Same fields as manual close in Merchants.tsx
      await updateDoc(mRef, {
        closedUntil: closedUntilTs,
        isOpen: false,
        updatedAt: now
      });

      await updateDoc(doc(db, 'orderReports', selectedReport.id), {
        status: 'Resolved',
        resolution: 'force_closed',
        resolvedAt: now,
        resolvedBy: adminName,
        resolvedById: adminUid,
        forceCloseDurationLabel: durationLabel,
        updatedAt: now
      });

      await logAuditEvent({
        adminId: adminUid,
        adminName,
        adminEmail: adminProfile?.email,
        action: 'FORCE_CLOSE_FROM_REPORT',
        entityType: 'merchant',
        entityId: merchantId,
        details: `Force closed merchant "${selectedReport.merchantName || merchantId}" (${durationLabel}) from Rider Report ${selectedReport.id} (Order #${selectedReport.orderNumber})`,
        oldValue: { closedUntil: mData?.closedUntil || null, isOpen: mData?.isOpen ?? true },
        newValue: { closedUntil: targetDate.toISOString(), isOpen: false }
      });

      const reportSnapshot = { ...selectedReport };
      setForceCloseModalOpen(false);
      showSuccess(
        `Force closed "${selectedReport.merchantName || 'Merchant'}" (${durationLabel}).`
      );
      // Force close does not cancel the order by itself: ask what to do with the order
      setFollowUpPromptReport(reportSnapshot);
    } catch (err: any) {
      showError(err);
    } finally {
      setBusyAction(false);
    }
  };

  // Open Cancel Order modal (either directly from Reviewing report OR from Force Close follow-up)
  const handleOpenCancelOrder = (report: OrderReport) => {
    setSelectedReportId(report.id);
    setCancelReasonText(
      report.note
        ? `Merchant closed: ${report.note}`
        : 'Merchant is closed (verified via rider report)'
    );
    setCancelFault('merchant');
    const methodLower = String(
      selectedOrderDoc?.paymentMethod ||
        selectedOrderDoc?.payment?.method ||
        report.paymentMethod ||
        ''
    ).toLowerCase();
    setRefundToWallet(methodLower === 'wallet');
    setCancelOrderModalOpen(true);
  };

  const handleConfirmCancelOrder = async () => {
    if (!selectedReport || !selectedReport.orderId) return;
    try {
      setBusyAction(true);
      const result = await cancelOrderWithRefundTransaction({
        orderId: selectedReport.orderId,
        cancelReason: cancelReasonText.trim() || 'Merchant is closed',
        cancelFault,
        refundToWallet,
        adminUid,
        adminName
      });

      const now = nowTs();
      const reportRef = doc(db, 'orderReports', selectedReport.id);
      if (selectedReport.status === 'Reviewing' || selectedReport.status === 'Pending') {
        await updateDoc(reportRef, {
          status: 'Resolved',
          resolution: 'cancelled',
          resolvedAt: now,
          resolvedBy: adminName,
          resolvedById: adminUid,
          updatedAt: now
        });
      } else {
        await updateDoc(reportRef, {
          followUpOrderAction: 'cancelled',
          updatedAt: now
        });
      }

      await logAuditEvent({
        adminId: adminUid,
        adminName,
        adminEmail: adminProfile?.email,
        action: 'CANCEL_ORDER_FROM_REPORT',
        entityType: 'order',
        entityId: selectedReport.orderId,
        details: `Cancelled Order #${result.orderNumber} from Rider Report ${selectedReport.id}.${
          result.refunded ? ` Refunded ₱${result.refundAmount.toFixed(2)} to customer wallet.` : ''
        }`,
        oldValue: { status: result.previousStatus },
        newValue: { status: 'Cancelled', walletRefunded: result.refunded }
      });

      setCancelOrderModalOpen(false);
      setFollowUpPromptReport(null);
      showSuccess(
        `Order #${result.orderNumber} cancelled.${
          result.refunded ? ` Refunded ₱${result.refundAmount.toFixed(2)} to wallet.` : ''
        }`
      );
    } catch (err: any) {
      showError(err);
    } finally {
      setBusyAction(false);
    }
  };

  const handleConfirmRedispatch = async (targetReport: OrderReport | null = selectedReport) => {
    if (!targetReport || !targetReport.orderId) return;
    try {
      setBusyAction(true);
      const { restoredStatus } = await releaseOrderFromRiderTransaction({
        orderId: targetReport.orderId,
        riderId: targetReport.riderId,
        mode: 'redispatch',
        historyNote: `Order redispatched by Admin (${adminName}) from Close-Restaurant report; reporting rider remains excluded.`
      });

      const now = nowTs();
      const reportRef = doc(db, 'orderReports', targetReport.id);
      if (targetReport.status === 'Reviewing' || targetReport.status === 'Pending') {
        await updateDoc(reportRef, {
          status: 'Resolved',
          resolution: 'redispatched',
          resolvedAt: now,
          resolvedBy: adminName,
          resolvedById: adminUid,
          updatedAt: now
        });
      } else {
        await updateDoc(reportRef, {
          followUpOrderAction: 'redispatched',
          updatedAt: now
        });
      }

      await logAuditEvent({
        adminId: adminUid,
        adminName,
        adminEmail: adminProfile?.email,
        action: 'REDISPATCH_FROM_REPORT',
        entityType: 'order',
        entityId: targetReport.orderId,
        details: `Redispatched Order #${targetReport.orderNumber} (onHold=false, status=${restoredStatus}, reporting rider ${targetReport.riderId} excluded) from Rider Report ${targetReport.id}.`,
        newValue: { onHold: false, holdReason: null, riderId: null, status: restoredStatus }
      });

      setRedispatchModalOpen(false);
      setFollowUpPromptReport(null);
      showSuccess(`Order #${targetReport.orderNumber} released to dispatch!`);
    } catch (err: any) {
      showError(err);
    } finally {
      setBusyAction(false);
    }
  };

  return (
    <div className="space-y-5 min-w-0 max-w-full">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-gray-900 dark:text-white tracking-tight flex items-center gap-2.5">
            <AlertTriangle className="w-6 h-6 text-amber-500 shrink-0" />
            <span>Rider Reports</span>
          </h1>
          <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">
            Review driver close-restaurant reports holding dispatch and inspect CR cancellation logs.
          </p>
        </div>

        {/* Two Primary Tabs */}
        <div className="flex flex-wrap items-center gap-2 bg-white dark:bg-zinc-900 p-1 rounded-2xl border border-gray-200 dark:border-zinc-800 w-full sm:w-auto">
          <button
            type="button"
            onClick={() => {
              setActiveTab('close_restaurant');
              setSelectedReportId(null);
            }}
            className={`flex-1 sm:flex-initial px-4 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-colors ${
              activeTab === 'close_restaurant'
                ? 'bg-gray-900 text-white dark:bg-amber-400 dark:text-black shadow-xs'
                : 'text-gray-600 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800'
            }`}
          >
            <Store className="w-3.5 h-3.5" />
            <span>Close restaurant</span>
            {pendingCloseCount > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-red-500 text-white tabular-nums">
                {pendingCloseCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('cr_cancellation');
              setSelectedReportId(null);
            }}
            className={`flex-1 sm:flex-initial px-4 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-colors ${
              activeTab === 'cr_cancellation'
                ? 'bg-gray-900 text-white dark:bg-amber-400 dark:text-black shadow-xs'
                : 'text-gray-600 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>CR cancellations</span>
            <span className="text-[11px] font-mono tabular-nums opacity-75">
              {crCancellationReports.length}
            </span>
          </button>
        </div>
      </div>

      {activeTab === 'close_restaurant' ? (
        /* ======================== CLOSE RESTAURANT TAB ======================== */
        <div className="space-y-4">
          {/* Filter Bar */}
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {(['all', 'Pending', 'Reviewing', 'Resolved', 'Rejected'] as const).map((st) => {
                const count =
                  st === 'all'
                    ? closeRestaurantReports.length
                    : closeRestaurantReports.filter((r) => r.status === st).length;
                return (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setQueueStatusFilter(st)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors tabular-nums ${
                      queueStatusFilter === st
                        ? 'bg-amber-400 text-black'
                        : 'bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-300 hover:bg-gray-200 dark:hover:bg-zinc-700'
                    }`}
                  >
                    {st === 'all' ? 'All' : st} ({count})
                  </button>
                );
              })}
            </div>

            <div className="relative w-full md:w-72">
              <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={queueSearch}
                onChange={(e) => setQueueSearch(e.target.value)}
                placeholder="Search order #, merchant, rider, note..."
                className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 text-xs text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-amber-400"
              />
            </div>
          </div>

          {/* Queue + Detail Two-Column Grid */}
          {loading ? (
            <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-12 text-center">
              <Loader2 className="w-7 h-7 animate-spin text-amber-500 mx-auto mb-2" />
              <p className="text-xs text-gray-500">Loading close-restaurant reports...</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
              {/* Left Queue List */}
              <div className="lg:col-span-5 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 dark:border-zinc-800 flex items-center justify-between">
                  <span className="text-xs font-extrabold uppercase tracking-wider text-gray-500 dark:text-zinc-400">
                    Queue ({filteredCloseReports.length})
                  </span>
                  <span className="text-[11px] text-gray-400">Newest first</span>
                </div>

                {filteredCloseReports.length === 0 ? (
                  <div className="p-10 text-center text-xs text-gray-400">
                    No close-restaurant reports match the filter.
                  </div>
                ) : (
                  <div className="divide-y divide-gray-100 dark:divide-zinc-800 max-h-[680px] overflow-y-auto">
                    {filteredCloseReports.map((rep) => {
                      const isSelected = selectedReport?.id === rep.id;
                      return (
                        <div
                          key={rep.id}
                          onClick={() => setSelectedReportId(rep.id)}
                          className={`p-4 cursor-pointer transition-colors space-y-2 ${
                            isSelected
                              ? 'bg-amber-50/80 dark:bg-amber-950/30 border-l-4 border-l-amber-400'
                              : 'hover:bg-gray-50 dark:hover:bg-zinc-800/50'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-mono text-xs font-extrabold text-gray-900 dark:text-white">
                                  #{rep.orderNumber}
                                </span>
                                <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-zinc-300">
                                  {getServiceLabel(rep.serviceType)}
                                </span>
                              </div>
                              <p className="text-xs font-bold text-gray-800 dark:text-zinc-200 mt-1 truncate">
                                {rep.merchantName || 'No merchant'}
                                {rep.branchName ? ` — ${rep.branchName}` : ''}
                              </p>
                            </div>

                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold border shrink-0 ${getStatusBadgeClass(
                                rep.status
                              )}`}
                            >
                              {rep.status}
                            </span>
                          </div>

                          <div className="flex items-center justify-between text-[11px] text-gray-500 dark:text-zinc-400">
                            <span className="truncate">Rider: {rep.riderName}</span>
                            <span className="shrink-0 tabular-nums">
                              {formatRelativeTime(rep.createdAt)}
                            </span>
                          </div>

                          {rep.note && (
                            <p className="text-xs text-gray-600 dark:text-zinc-300 line-clamp-2 bg-gray-50 dark:bg-zinc-950/60 px-2.5 py-1.5 rounded-lg border border-gray-100 dark:border-zinc-800">
                              “{rep.note}”
                            </p>
                          )}

                          {rep.status === 'Pending' && (
                            <div
                              className="flex flex-wrap items-center gap-2 pt-1"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                disabled={busyAction}
                                onClick={() => handleAcceptReport(rep)}
                                className="delivio-btn-yellow px-3 py-1.5 rounded-lg text-[11px] font-extrabold flex items-center gap-1 disabled:opacity-50"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>Accept</span>
                              </button>
                              <button
                                type="button"
                                disabled={busyAction}
                                onClick={() => handleOpenRejectModal(rep)}
                                className="px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 text-[11px] font-bold flex items-center gap-1 hover:bg-red-100 dark:hover:bg-red-950/70 disabled:opacity-50"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                                <span>Reject report</span>
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Right Detail Panel */}
              <div className="lg:col-span-7 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-4 sm:p-6 space-y-5 min-w-0">
                {!selectedReport ? (
                  <div className="py-16 text-center text-xs text-gray-400">
                    Select a report from the queue to view full details and take action.
                  </div>
                ) : selectedReport.status === 'Pending' ? (
                  /* Pending preview prompting Accept or Reject */
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-gray-100 dark:border-zinc-800">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-base font-extrabold text-gray-900 dark:text-white">
                            Order #{selectedReport.orderNumber}
                          </span>
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-[11px] font-extrabold border ${getStatusBadgeClass(
                              selectedReport.status
                            )}`}
                          >
                            Pending Review
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-zinc-400 mt-1">
                          Submitted by <strong>{selectedReport.riderName}</strong> ·{' '}
                          {formatTimestamp(selectedReport.createdAt)}
                        </p>
                      </div>
                    </div>

                    <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 space-y-2">
                      <p className="text-xs font-extrabold text-amber-900 dark:text-amber-300 flex items-center gap-1.5">
                        <Clock className="w-4 h-4 shrink-0" />
                        <span>Order is currently ON HOLD waiting for review</span>
                      </p>
                      <p className="text-xs text-amber-800/90 dark:text-amber-300/90">
                        Accept this report to inspect full details and force close, cancel, or
                        redispatch — or reject it as a false report to immediately release the order
                        to other riders.
                      </p>
                    </div>

                    {selectedReport.note && (
                      <div className="p-3.5 rounded-xl bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 block mb-1">
                          Rider’s Reason
                        </span>
                        <p className="text-sm font-medium text-gray-800 dark:text-zinc-200">
                          {selectedReport.note}
                        </p>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2.5 pt-2">
                      <button
                        type="button"
                        disabled={busyAction}
                        onClick={() => handleAcceptReport(selectedReport)}
                        className="delivio-btn-yellow px-4 py-2.5 rounded-xl text-xs font-extrabold flex items-center gap-1.5 disabled:opacity-50"
                      >
                        {busyAction ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <CheckCircle2 className="w-4 h-4" />
                        )}
                        <span>Accept</span>
                      </button>

                      <button
                        type="button"
                        disabled={busyAction}
                        onClick={() => handleOpenRejectModal(selectedReport)}
                        className="px-4 py-2.5 rounded-xl border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 text-xs font-bold flex items-center gap-1.5 hover:bg-red-100 dark:hover:bg-red-950/70 disabled:opacity-50"
                      >
                        <XCircle className="w-4 h-4" />
                        <span>Reject report</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Accepted (Reviewing) / Resolved / Rejected -> Full Details */
                  <div className="space-y-5">
                    <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-gray-100 dark:border-zinc-800">
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h2 className="text-lg font-extrabold text-gray-900 dark:text-white font-mono">
                            #{selectedReport.orderNumber}
                          </h2>
                          <span className="px-2 py-0.5 rounded-md text-xs font-bold bg-gray-100 dark:bg-zinc-800 text-gray-800 dark:text-zinc-200">
                            {getServiceLabel(selectedReport.serviceType)}
                          </span>
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-[11px] font-extrabold border ${getStatusBadgeClass(
                              selectedReport.status
                            )}`}
                          >
                            {selectedReport.status}
                          </span>
                          {selectedReport.resolution && (
                            <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-zinc-900 text-white dark:bg-zinc-700">
                              Resolution: {selectedReport.resolution}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-gray-500 dark:text-zinc-400 font-mono break-all">
                          Order ID: {selectedReport.orderId} · Report ID: {selectedReport.id}
                        </p>
                      </div>

                      <div className="text-right">
                        <p className="text-[11px] uppercase font-bold text-gray-400">Amount</p>
                        <p className="text-lg font-extrabold text-gray-900 dark:text-white tabular-nums">
                          ₱{Number(selectedReport.amount || 0).toFixed(2)}
                        </p>
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase text-gray-500 dark:text-zinc-400">
                          <CreditCard className="w-3 h-3" />
                          <span>{selectedReport.paymentMethod || 'cod'}</span>
                        </span>
                      </div>
                    </div>

                    {/* Key Parties Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="p-3.5 rounded-xl bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 space-y-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1">
                          <Store className="w-3 h-3" /> Merchant
                        </span>
                        <p className="text-xs font-extrabold text-gray-900 dark:text-white">
                          {selectedReport.merchantName || 'No merchant'}
                        </p>
                        {selectedReport.branchName && (
                          <p className="text-[11px] text-amber-700 dark:text-amber-400 font-semibold">
                            Branch: {selectedReport.branchName}
                          </p>
                        )}
                        {selectedReport.merchantId && (
                          <p className="text-[10px] font-mono text-gray-400 truncate">
                            {selectedReport.merchantId}
                          </p>
                        )}
                      </div>

                      <div className="p-3.5 rounded-xl bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 space-y-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1">
                          <User className="w-3 h-3" /> Customer
                        </span>
                        <p className="text-xs font-extrabold text-gray-900 dark:text-white">
                          {selectedReport.customerName || 'Customer'}
                        </p>
                        {selectedReport.customerId && (
                          <p className="text-[10px] font-mono text-gray-400 truncate">
                            {selectedReport.customerId}
                          </p>
                        )}
                      </div>

                      <div className="p-3.5 rounded-xl bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 space-y-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1">
                          <Car className="w-3 h-3" /> Reporting Rider
                        </span>
                        <p className="text-xs font-extrabold text-gray-900 dark:text-white">
                          {selectedReport.riderName}
                        </p>
                        <p className="text-[10px] font-mono text-gray-400 truncate">
                          {selectedReport.riderId}
                        </p>
                        {typeof selectedRiderInfo?.falseReportCount === 'number' &&
                          selectedRiderInfo.falseReportCount > 0 && (
                            <span className="inline-block px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300 text-[10px] font-bold">
                              False reports: {selectedRiderInfo.falseReportCount}
                            </span>
                          )}
                      </div>
                    </div>

                    {/* Rider Reason & Times */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="p-3.5 rounded-xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400 block mb-1">
                          Rider’s Reason
                        </span>
                        <p className="text-xs font-medium text-gray-900 dark:text-zinc-100">
                          {selectedReport.note || 'No additional note provided.'}
                        </p>
                      </div>

                      <div className="p-3.5 rounded-xl bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 space-y-1 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-gray-400">Reported:</span>
                          <span className="font-semibold text-gray-800 dark:text-zinc-200">
                            {formatTimestamp(selectedReport.createdAt)}
                          </span>
                        </div>
                        {selectedReport.acceptedAt && (
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-gray-400">Accepted:</span>
                            <span className="font-semibold text-gray-800 dark:text-zinc-200">
                              {selectedReport.acceptedByName || 'Admin'} ·{' '}
                              {formatTimestamp(selectedReport.acceptedAt)}
                            </span>
                          </div>
                        )}
                        {selectedReport.resolvedAt && (
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-gray-400">Resolved:</span>
                            <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                              {selectedReport.resolvedBy || 'Admin'} ·{' '}
                              {formatTimestamp(selectedReport.resolvedAt)}
                            </span>
                          </div>
                        )}
                        {selectedReport.forceCloseDurationLabel && (
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-gray-400">Closed for:</span>
                            <span className="font-bold text-gray-800 dark:text-zinc-200">
                              {selectedReport.forceCloseDurationLabel}
                            </span>
                          </div>
                        )}
                        {selectedReport.followUpOrderAction && (
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-gray-400">Follow-up order:</span>
                            <span className="font-bold text-gray-800 dark:text-zinc-200">
                              {selectedReport.followUpOrderAction}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Items List */}
                    <div className="rounded-xl border border-gray-200 dark:border-zinc-800 overflow-hidden">
                      <div className="px-3.5 py-2 bg-gray-50 dark:bg-zinc-950 border-b border-gray-200 dark:border-zinc-800 text-[11px] font-extrabold uppercase tracking-wider text-gray-500 dark:text-zinc-400 flex items-center gap-1.5">
                        <ShoppingBag className="w-3.5 h-3.5" />
                        <span>Order Items ({selectedReport.items.length})</span>
                      </div>
                      {selectedReport.items.length === 0 ? (
                        <div className="p-3.5 text-xs text-gray-400">No items listed.</div>
                      ) : (
                        <div className="divide-y divide-gray-100 dark:divide-zinc-800">
                          {selectedReport.items.map((item, idx) => (
                            <div
                              key={idx}
                              className="px-3.5 py-2 text-xs flex items-center justify-between gap-2"
                            >
                              <div className="min-w-0">
                                <span className="font-bold text-gray-900 dark:text-white">
                                  {item.qty || 1}× {item.name}
                                </span>
                                {item.variantLabel && (
                                  <span className="ml-2 text-[11px] text-gray-500 dark:text-zinc-400">
                                    ({item.variantLabel})
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Actions while Reviewing */}
                    {selectedReport.status === 'Reviewing' && (
                      <div className="pt-2 border-t border-gray-100 dark:border-zinc-800 space-y-3">
                        <p className="text-xs font-extrabold uppercase tracking-wider text-gray-500 dark:text-zinc-400">
                          Resolution Actions
                        </p>
                        <div className="flex flex-wrap items-center gap-2.5">
                          <button
                            type="button"
                            disabled={busyAction}
                            onClick={() => handleTriggerForceClose(selectedReport)}
                            className="px-4 py-2.5 rounded-xl bg-gray-900 hover:bg-black dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-black text-xs font-extrabold flex items-center gap-1.5 disabled:opacity-50"
                          >
                            <Store className="w-4 h-4" />
                            <span>Force close this restaurant</span>
                          </button>

                          <button
                            type="button"
                            disabled={busyAction}
                            onClick={() => handleOpenCancelOrder(selectedReport)}
                            className="px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-extrabold flex items-center gap-1.5 disabled:opacity-50"
                          >
                            <Ban className="w-4 h-4" />
                            <span>Cancel the order</span>
                          </button>

                          <button
                            type="button"
                            disabled={busyAction}
                            onClick={() => setRedispatchModalOpen(true)}
                            className="delivio-btn-yellow px-4 py-2.5 rounded-xl text-xs font-extrabold flex items-center gap-1.5 disabled:opacity-50"
                          >
                            <Send className="w-4 h-4" />
                            <span>Redispatch</span>
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Optional order follow-up if resolved as force_closed and order is still onHold */}
                    {selectedReport.status === 'Resolved' &&
                      selectedReport.resolution === 'force_closed' &&
                      selectedOrderDoc?.onHold && (
                        <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-bold text-amber-900 dark:text-amber-300">
                            Merchant was force closed, and Order #{selectedReport.orderNumber} is still on hold.
                          </span>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleOpenCancelOrder(selectedReport)}
                              className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-bold"
                            >
                              Cancel the order
                            </button>
                            <button
                              type="button"
                              onClick={() => setFollowUpPromptReport(selectedReport)}
                              className="delivio-btn-yellow px-3 py-1.5 rounded-lg text-xs font-bold"
                            >
                              Redispatch
                            </button>
                          </div>
                        </div>
                      )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* ======================== CR CANCELLATIONS TAB ======================== */
        <div className="space-y-4">
          {/* Filters */}
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-zinc-400 mb-1">
                Filter by Rider
              </label>
              <select
                value={crRiderFilter}
                onChange={(e) => setCrRiderFilter(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 text-xs font-semibold text-gray-900 dark:text-white"
              >
                <option value="all">All riders ({crRidersList.length})</option>
                {crRidersList.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-zinc-400 mb-1">
                Filter by Service
              </label>
              <select
                value={crServiceFilter}
                onChange={(e) => setCrServiceFilter(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 text-xs font-semibold text-gray-900 dark:text-white"
              >
                <option value="all">All services</option>
                {Object.entries(SERVICE_LABELS).map(([k, lbl]) => (
                  <option key={k} value={k}>
                    {lbl}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-zinc-400 mb-1">
                Filter by Date (PHT)
              </label>
              <div className="flex items-center gap-1.5">
                <div className="relative flex-1">
                  <Calendar className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="date"
                    value={crDateFilter}
                    onChange={(e) => setCrDateFilter(e.target.value)}
                    className="w-full pl-9 pr-2 py-2 rounded-xl border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 text-xs font-semibold text-gray-900 dark:text-white"
                  />
                </div>
                {crDateFilter && (
                  <button
                    type="button"
                    onClick={() => setCrDateFilter('')}
                    className="px-2.5 py-2 rounded-xl border border-gray-200 dark:border-zinc-700 text-xs font-bold text-gray-500 hover:text-gray-800 dark:hover:text-white"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-zinc-400 mb-1">
                Search
              </label>
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={crSearch}
                  onChange={(e) => setCrSearch(e.target.value)}
                  placeholder="Order #, merchant, note..."
                  className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 text-xs text-gray-900 dark:text-white"
                />
              </div>
            </div>
          </div>

          {/* Count per rider summary */}
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold uppercase tracking-wider text-gray-500 dark:text-zinc-400 flex items-center gap-1.5">
                <Filter className="w-3.5 h-3.5 text-amber-500" />
                <span>Count per rider ({crCountsByRider.length})</span>
              </span>
              <span className="text-xs text-gray-400 tabular-nums">
                {filteredCrReports.length} total cancellation(s)
              </span>
            </div>
            {crCountsByRider.length === 0 ? (
              <p className="text-xs text-gray-400">No CR cancellation records for current filters.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {crCountsByRider.map((entry) => (
                  <button
                    key={entry.riderId}
                    type="button"
                    onClick={() =>
                      setCrRiderFilter((prev) => (prev === entry.riderId ? 'all' : entry.riderId))
                    }
                    className={`px-3 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-2 transition-colors ${
                      crRiderFilter === entry.riderId
                        ? 'border-amber-400 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-300'
                        : 'border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-950 text-gray-700 dark:text-zinc-200 hover:border-gray-300'
                    }`}
                  >
                    <span>{entry.riderName}</span>
                    <span
                      className={`px-1.5 py-0.5 rounded-md text-[10px] font-extrabold tabular-nums ${
                        entry.count >= 3
                          ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
                          : 'bg-gray-200 text-gray-800 dark:bg-zinc-800 dark:text-zinc-200'
                      }`}
                    >
                      {entry.count}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Read-only CR Cancellations Table */}
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 dark:bg-zinc-850/60 uppercase font-bold text-gray-500 dark:text-zinc-400 border-b border-gray-200 dark:border-zinc-800">
                  <tr>
                    <th className="px-4 py-3">Order #</th>
                    <th className="px-4 py-3">Service</th>
                    <th className="px-4 py-3">Rider</th>
                    <th className="px-4 py-3">Merchant / Branch</th>
                    <th className="px-4 py-3">Customer</th>
                    <th className="px-4 py-3">Reason / Note</th>
                    <th className="px-4 py-3">Amount</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Logged At</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
                  {loading ? (
                    <tr>
                      <td colSpan={9} className="py-12 text-center text-gray-400">
                        <Loader2 className="w-5 h-5 animate-spin inline mr-2 text-amber-500" />
                        Loading CR cancellations...
                      </td>
                    </tr>
                  ) : filteredCrReports.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-12 text-center text-gray-400">
                        No CR cancellations match the current filters.
                      </td>
                    </tr>
                  ) : (
                    filteredCrReports.map((cr) => (
                      <tr key={cr.id} className="hover:bg-gray-50 dark:hover:bg-zinc-800/40">
                        <td className="px-4 py-3 font-mono font-bold text-gray-900 dark:text-white">
                          <div>#{cr.orderNumber}</div>
                          <div className="text-[10px] text-gray-400 truncate max-w-[120px]">
                            {cr.orderId}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-zinc-300">
                            {getServiceLabel(cr.serviceType)}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-semibold text-gray-900 dark:text-white">
                          {cr.riderName}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-gray-800 dark:text-zinc-200">
                            {cr.merchantName || '—'}
                          </div>
                          {cr.branchName && (
                            <div className="text-[10px] text-gray-400">{cr.branchName}</div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-700 dark:text-zinc-300">
                          {cr.customerName || '—'}
                        </td>
                        <td className="px-4 py-3 max-w-xs">
                          <p className="text-gray-700 dark:text-zinc-300 break-words">
                            {cr.note || '—'}
                          </p>
                        </td>
                        <td className="px-4 py-3 font-bold tabular-nums text-gray-900 dark:text-white">
                          ₱{Number(cr.amount || 0).toFixed(2)}
                          <div className="text-[10px] uppercase text-gray-400 font-medium">
                            {cr.paymentMethod}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold border ${getStatusBadgeClass(
                              cr.status
                            )}`}
                          >
                            {cr.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-500 dark:text-zinc-400 whitespace-nowrap">
                          {formatTimestamp(cr.createdAt)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Reject Report Modal (with False-Report / Fraud Flag Option) */}
      {rejectModalOpen && selectedReport && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs"
          onClick={() => !busyAction && setRejectModalOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl shadow-2xl p-6 space-y-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-red-100 text-red-600 dark:bg-red-950/60 dark:text-red-400">
                  <XCircle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-gray-900 dark:text-white">
                    Reject report for #{selectedReport.orderNumber}?
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-zinc-400">
                    Releases order to dispatch (excluding {selectedReport.riderName}) and increments
                    false-report count.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRejectModalOpen(false)}
                className="p-1 text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                Rejection note (optional)
              </label>
              <textarea
                rows={3}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="e.g. Merchant confirmed open via call..."
                className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-gray-900 dark:text-white"
              />
            </div>

            <label className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 cursor-pointer">
              <input
                type="checkbox"
                checked={raiseFraudFlagOnReject}
                onChange={(e) => setRaiseFraudFlagOnReject(e.target.checked)}
                className="mt-0.5 rounded border-gray-300 text-amber-500 focus:ring-amber-400"
              />
              <div className="text-xs">
                <span className="font-bold text-gray-900 dark:text-white flex items-center gap-1">
                  <ShieldAlert className="w-3.5 h-3.5 text-red-500" />
                  Raise fraud flag for this rider
                </span>
                <span className="text-[11px] text-gray-500 dark:text-zinc-400 block mt-0.5">
                  Current false reports: {selectedRiderInfo?.falseReportCount || 0} →{' '}
                  {(selectedRiderInfo?.falseReportCount || 0) + 1} (auto-flags at 3+).
                </span>
              </div>
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={busyAction}
                onClick={() => setRejectModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-gray-600 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busyAction}
                onClick={handleConfirmRejectReport}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-extrabold flex items-center gap-1.5 disabled:opacity-50"
              >
                {busyAction && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Reject & Release Order</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pabili / No Merchant Dialog */}
      {pabiliBlockDialogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs"
          onClick={() => setPabiliBlockDialogOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl shadow-2xl p-6 space-y-4"
          >
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-extrabold text-gray-900 dark:text-white">
                  Cannot close merchant
                </h3>
                <p className="text-sm text-gray-600 dark:text-zinc-300 mt-1">
                  Can't close because the service is Pabili.
                </p>
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setPabiliBlockDialogOpen(false)}
                className="delivio-btn-yellow px-4 py-2 rounded-xl text-xs font-extrabold"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Force Close Duration Modal */}
      {forceCloseModalOpen && selectedReport && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs"
          onClick={() => !busyAction && setForceCloseModalOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl shadow-2xl p-6 space-y-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-extrabold text-gray-900 dark:text-white">
                  Force close {selectedReport.merchantName || 'restaurant'}
                </h3>
                <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">
                  Choose how long the store stays manually closed (sets <code>closedUntil</code>{' '}
                  and <code>isOpen: false</code>).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setForceCloseModalOpen(false)}
                className="p-1 text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2">
              {(
                [
                  { id: '1h', label: '1 hour', desc: 'Reopens automatically 1 hour from now' },
                  { id: '3h', label: '3 hours', desc: 'Reopens automatically 3 hours from now' },
                  {
                    id: 'next_opening',
                    label: 'Until next opening',
                    desc: 'Uses the shop’s next scheduled opening hour'
                  },
                  {
                    id: 'until_reopen',
                    label: 'Until I reopen',
                    desc: 'Stays closed until manually reopened by an admin'
                  }
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setForceCloseDuration(opt.id)}
                  className={`w-full text-left p-3 rounded-xl border-2 transition-colors ${
                    forceCloseDuration === opt.id
                      ? 'border-amber-400 bg-amber-50/70 dark:bg-amber-950/30'
                      : 'border-gray-200 dark:border-zinc-800 hover:border-gray-300 dark:hover:border-zinc-700'
                  }`}
                >
                  <div className="text-xs font-extrabold text-gray-900 dark:text-white">
                    {opt.label}
                  </div>
                  <div className="text-[11px] text-gray-500 dark:text-zinc-400 mt-0.5">
                    {opt.desc}
                  </div>
                </button>
              ))}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={busyAction}
                onClick={() => setForceCloseModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-gray-600 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busyAction}
                onClick={handleConfirmForceClose}
                className="px-4 py-2 rounded-xl bg-gray-900 hover:bg-black dark:bg-amber-400 dark:text-black text-white text-xs font-extrabold flex items-center gap-1.5 disabled:opacity-50"
              >
                {busyAction && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Force Close Restaurant</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Follow-up Dialog after Force Close: "Cancel the order now or redispatch?" */}
      {followUpPromptReport && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs"
          onClick={() => !busyAction && setFollowUpPromptReport(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl shadow-2xl p-6 space-y-4"
          >
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-extrabold text-gray-900 dark:text-white">
                  Cancel the order now or redispatch?
                </h3>
                <p className="text-xs text-gray-500 dark:text-zinc-400 mt-1">
                  {followUpPromptReport.merchantName || 'The merchant'} has been force closed.
                  Order <strong>#{followUpPromptReport.orderNumber}</strong> is still on hold until
                  you cancel or redispatch it.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={busyAction}
                onClick={() => setFollowUpPromptReport(null)}
                className="px-3.5 py-2 rounded-xl text-xs font-bold text-gray-500 hover:bg-gray-100 dark:hover:bg-zinc-800"
              >
                Keep on hold
              </button>
              <button
                type="button"
                disabled={busyAction}
                onClick={() => handleConfirmRedispatch(followUpPromptReport)}
                className="delivio-btn-yellow px-4 py-2 rounded-xl text-xs font-extrabold flex items-center gap-1.5"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Redispatch</span>
              </button>
              <button
                type="button"
                disabled={busyAction}
                onClick={() => {
                  const target = followUpPromptReport;
                  setFollowUpPromptReport(null);
                  handleOpenCancelOrder(target);
                }}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-extrabold flex items-center gap-1.5"
              >
                <Ban className="w-3.5 h-3.5" />
                <span>Cancel the order</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Order Modal (reusing LiveOrders cancel & wallet refund routine) */}
      {cancelOrderModalOpen && selectedReport && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs"
          onClick={() => !busyAction && setCancelOrderModalOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl shadow-2xl p-6 space-y-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-extrabold text-gray-900 dark:text-white">
                  Cancel Order #{selectedReport.orderNumber}
                </h3>
                <p className="text-xs text-gray-500 dark:text-zinc-400">
                  Uses the standard Delivio cancel & wallet refund transaction.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCancelOrderModalOpen(false)}
                className="p-1 text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Cancel Fault
                </label>
                <select
                  value={cancelFault}
                  onChange={(e) => setCancelFault(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-semibold text-gray-900 dark:text-white"
                >
                  <option value="merchant">Merchant</option>
                  <option value="customer">Customer</option>
                  <option value="rider">Rider</option>
                  <option value="platform">Platform</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Reason
                </label>
                <textarea
                  rows={2}
                  value={cancelReasonText}
                  onChange={(e) => setCancelReasonText(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-gray-900 dark:text-white"
                />
              </div>

              {String(
                selectedOrderDoc?.paymentMethod ||
                  selectedOrderDoc?.payment?.method ||
                  selectedReport.paymentMethod ||
                  ''
              ).toLowerCase() === 'wallet' && (
                <label className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 cursor-pointer text-xs font-bold text-emerald-900 dark:text-emerald-300">
                  <input
                    type="checkbox"
                    checked={refundToWallet}
                    onChange={(e) => setRefundToWallet(e.target.checked)}
                    className="rounded border-gray-300 text-emerald-600"
                  />
                  <span>
                    Refund ₱{Number(selectedReport.amount || 0).toFixed(2)} to customer wallet
                  </span>
                </label>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={busyAction}
                onClick={() => setCancelOrderModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-gray-600 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-zinc-800"
              >
                Back
              </button>
              <button
                type="button"
                disabled={busyAction}
                onClick={handleConfirmCancelOrder}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-extrabold flex items-center gap-1.5 disabled:opacity-50"
              >
                {busyAction && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Confirm Cancel Order</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Redispatch Confirmation Modal */}
      {redispatchModalOpen && selectedReport && (
        <ConfirmationModal
          isOpen={redispatchModalOpen}
          onClose={() => setRedispatchModalOpen(false)}
          onConfirm={() => handleConfirmRedispatch(selectedReport)}
          title={`Redispatch Order #${selectedReport.orderNumber}?`}
          message={`This clears onHold and releases the order back to nearby riders while keeping ${selectedReport.riderName} in excludeRiderIds.`}
          confirmLabel="Redispatch"
          reasonRequired={false}
          isDestructive={false}
        />
      )}
    </div>
  );
};
