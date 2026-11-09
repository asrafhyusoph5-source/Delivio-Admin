import React, { useState, useEffect } from 'react';
import {
  db,
  collection,
  query,
  getDocs,
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
import type { FraudFlag } from '../types';
import {
  AlertOctagon,
  Search,
  Filter,
  CheckCircle,
  Clock,
  UserX,
  Plus,
  RefreshCw,
  FileText,
  User,
  Bike,
  ShieldAlert,
  Loader2,
  Copy,
  ExternalLink,
  Ban
} from 'lucide-react';
import { ConfirmationModal } from '../components/common/ConfirmationModal';

export const FraudFlags: React.FC = () => {
  const { adminProfile, isFullAdmin } = useAuth();
  const { showSuccess, showError } = useToast();

  const [flags, setFlags] = useState<FraudFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'dismissed'>('open');
  const [subjectFilter, setSubjectFilter] = useState<'all' | 'customer' | 'driver'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Note Modal
  const [selectedFlagForNote, setSelectedFlagForNote] = useState<FraudFlag | null>(null);
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  // Manual Flag Modal
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newSubjectType, setNewSubjectType] = useState<'customer' | 'driver'>('customer');
  const [newSubjectId, setNewSubjectId] = useState('');
  const [newReason, setNewReason] = useState('Repeated cancellations');
  const [newNote, setNewNote] = useState('');
  const [creatingFlag, setCreatingFlag] = useState(false);

  // Suspend Modal
  const [suspendModalOpen, setSuspendModalOpen] = useState(false);
  const [flagToSuspend, setFlagToSuspend] = useState<FraudFlag | null>(null);
  const [suspending, setSuspending] = useState(false);

  // Auto-Scan State
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

  useEffect(() => {
    fetchFlags();
  }, []);

  // Automated detection scan
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

      // Existing flags map to avoid dupes
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
            const payload: FraudFlag = {
              id: flagId,
              subjectType: 'customer',
              subjectId: cid,
              reason: reasonKey,
              status: 'open',
              note: `Automated detection: Account has ${info.count} cancelled orders. Customer name: ${info.name || 'Unknown'}.`,
              createdAt: Timestamp.now(),
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
      highTransfersSnap.forEach((d) => {
        const dt = d.data();
        const sender = dt.senderUid || dt.senderId || dt.fromUid;
        if (sender) {
          const reasonKey = `Unusually high wallet transfer (₱${dt.amount?.toLocaleString()})`;
          const key = `customer_${sender}_${reasonKey}`;
          if (!existingKeySet.has(key)) {
            const flagId = `flag_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
            const payload: FraudFlag = {
              id: flagId,
              subjectType: 'customer',
              subjectId: sender,
              reason: reasonKey,
              status: 'open',
              note: `Automated detection: Single transfer of ₱${dt.amount} to ${dt.recipientPhone || dt.recipientEmail || 'recipient'}. Reference: ${d.id}`,
              createdAt: Timestamp.now(),
              createdBy: adminProfile?.email || 'system_detector'
            };
            setDoc(doc(db, 'fraudFlags', flagId), payload);
            existingKeySet.add(key);
            detectedCount++;
          }
        }
      });

      await fetchFlags();
      if (detectedCount > 0) {
        showSuccess(`Scan complete. Detected and flagged ${detectedCount} suspicious activity instance(s).`);
      } else {
        showSuccess('Scan complete. No new suspicious accounts detected.');
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
      showError('Please provide the Customer or Driver ID / UID.');
      return;
    }
    try {
      setCreatingFlag(true);
      const flagId = `flag_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const payload: FraudFlag = {
        id: flagId,
        subjectType: newSubjectType,
        subjectId: newSubjectId.trim(),
        reason: newReason.trim(),
        status: 'open',
        note: newNote.trim(),
        createdAt: Timestamp.now(),
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

  // Toggle status dismiss / reopen
  const handleToggleStatus = async (flag: FraudFlag) => {
    try {
      const newStatus = flag.status === 'open' ? 'dismissed' : 'open';
      await updateDoc(doc(db, 'fraudFlags', flag.id), {
        status: newStatus,
        updatedAt: Timestamp.now()
      });

      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        adminEmail: adminProfile?.email,
        action: newStatus === 'dismissed' ? 'DISMISS_FRAUD_FLAG' : 'REOPEN_FRAUD_FLAG',
        entityType: 'fraudFlags',
        entityId: flag.id,
        details: `Updated fraud flag status to ${newStatus}`
      });

      showSuccess(`Flag marked as ${newStatus}.`);
      setFlags((prev) =>
        prev.map((f) => (f.id === flag.id ? { ...f, status: newStatus } : f))
      );
    } catch (err: any) {
      showError(err);
    }
  };

  // Save note
  const handleSaveNote = async () => {
    if (!selectedFlagForNote) return;
    try {
      setSavingNote(true);
      await updateDoc(doc(db, 'fraudFlags', selectedFlagForNote.id), {
        note: noteText.trim(),
        updatedAt: Timestamp.now()
      });

      showSuccess('Flag note updated.');
      setFlags((prev) =>
        prev.map((f) => (f.id === selectedFlagForNote.id ? { ...f, note: noteText.trim() } : f))
      );
      setSelectedFlagForNote(null);
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
        // Suspend in users collection
        await updateDoc(doc(db, 'users', subId), {
          status: 'suspended',
          suspendedAt: Timestamp.now(),
          suspendedReason: reason || flagToSuspend.reason
        });
      } else {
        // Driver: suspend in riders collection and users collection if exists
        await updateDoc(doc(db, 'riders', subId), {
          status: 'suspended',
          suspendedAt: Timestamp.now(),
          suspendedReason: reason || flagToSuspend.reason
        });
        try {
          await updateDoc(doc(db, 'users', subId), {
            status: 'suspended',
            suspendedAt: Timestamp.now(),
            suspendedReason: reason || flagToSuspend.reason
          });
        } catch (e) {
          // It may only be in riders collection
        }
      }

      // Add audit note to flag
      const updatedNote = `${flagToSuspend.note ? flagToSuspend.note + '\n' : ''}[${new Date().toLocaleDateString()}] Account suspended by ${adminProfile?.email}. Reason: ${reason || flagToSuspend.reason}`;
      await updateDoc(doc(db, 'fraudFlags', flagToSuspend.id), {
        note: updatedNote,
        accountSuspended: true
      });

      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        adminEmail: adminProfile?.email,
        action: 'SUSPEND_FRAUD_ACCOUNT',
        entityType: subType === 'customer' ? 'users' : 'riders',
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

  const filteredFlags = flags.filter((f) => {
    if (statusFilter !== 'all' && f.status !== statusFilter) return false;
    if (subjectFilter !== 'all' && f.subjectType !== subjectFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchId = f.subjectId.toLowerCase().includes(q);
      const matchReason = f.reason.toLowerCase().includes(q);
      const matchNote = (f.note || '').toLowerCase().includes(q);
      if (!matchId && !matchReason && !matchNote) return false;
    }
    return true;
  });

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
              {flags.filter((f) => f.status === 'open').length} Open
            </span>
          </div>
          <p className="text-sm text-gray-500 dark:text-zinc-400 mt-0.5">
            Monitor customers and drivers with repeated cancellations, failed payments, or very high wallet transfers.
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
            placeholder="Search by User / Driver ID, reason, or notes..."
            className="w-full pl-9 pr-4 py-2 rounded-xl border border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-850 text-xs text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
        </div>
      </div>

      {/* Flags List */}
      {loading ? (
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
                          isDriver
                            ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400'
                            : 'bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-400'
                        }`}
                      >
                        {isDriver ? <Bike className="w-3 h-3" /> : <User className="w-3 h-3" />}
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

                      <span className="text-xs font-mono font-semibold text-gray-700 dark:text-zinc-300">
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
                      <span>Flagged: {flag.createdAt?.toDate ? flag.createdAt.toDate().toLocaleString() : 'N/A'}</span>
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
                Flag Customer or Driver
              </h3>
            </div>

            <form onSubmit={handleCreateFlag} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-zinc-300 mb-1">
                  Subject Type
                </label>
                <div className="grid grid-cols-2 gap-2">
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
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-zinc-300 mb-1">
                  {newSubjectType === 'customer' ? 'Customer UID' : 'Driver / Rider ID'}
                </label>
                <input
                  type="text"
                  required
                  value={newSubjectId}
                  onChange={(e) => setNewSubjectId(e.target.value)}
                  placeholder="e.g. u12345 or r_98765"
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
                  placeholder="Document relevant order IDs, suspicious transfer patterns, etc."
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
