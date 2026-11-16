import React, { useState } from 'react';
import {
  Activity,
  Search,
  Wrench,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ShieldAlert
} from 'lucide-react';
import { db, collection, doc, getDocs, writeBatch, Timestamp } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { logAuditEvent } from '../../utils/audit';
import { ConfirmationModal } from '../common/ConfirmationModal';

const TOP_LEVEL_COLLECTIONS = [
  'orders',
  'walletTransactions',
  'walletTransfers',
  'supportTickets',
  'inbox',
  'cashRemittances',
  'merchantPayouts',
  'riders',
  'merchants',
  'reviews',
  'orderChats'
] as const;

const SCALAR_DATE_FIELDS = [
  'createdAt',
  'updatedAt',
  'deliveredAt',
  'completedAt',
  'cancelledAt',
  'acceptedAt',
  'readyAt',
  'rejectedAt',
  'refundedAt',
  'walletRefundedAt',
  'scheduledFor',
  'closedUntil',
  'expiresAt',
  'lastMessageAt'
] as const;

const MIN_TS_SECONDS = -62135596800;
const MAX_TS_SECONDS = 253402300799;

interface FieldScanIssue {
  collectionLabel: string;
  field: string;
  badDocCount: number;
  fixableDocCount: number;
  unparseableDocCount: number;
  sampleDocIds: string[];
  sampleKinds: string[];
}

interface UnparseableEntry {
  collectionLabel: string;
  docId: string;
  docPath: string;
  field: string;
  rawPreview: string;
}

interface PendingDocFix {
  pathSegments: string[];
  collectionLabel: string;
  docId: string;
  payload: Record<string, any>;
  fixedFieldNames: string[];
}

interface ScanReport {
  scannedCollections: number;
  scannedDocs: number;
  totalBadDocs: number;
  totalBadFieldHits: number;
  totalFixableDocs: number;
  issues: FieldScanIssue[];
  pendingFixes: PendingDocFix[];
  unparseableEntries: UnparseableEntry[];
}

interface FixResultSummary {
  fixedDocsCount: number;
  fixedFieldsCount: number;
  untouchedList: UnparseableEntry[];
}

function describeValueKind(val: any): string {
  if (val instanceof Date) return 'Date';
  if (Array.isArray(val)) return 'array';
  if (val === null) return 'null';
  const t = typeof val;
  if (t === 'number') return Number.isFinite(val) ? 'number' : 'NaN/Inf';
  if (t === 'string') return 'string';
  if (t === 'boolean') return 'boolean';
  if (t === 'object') {
    if (typeof val.seconds === 'number' || typeof val._seconds === 'number') {
      return 'plain {seconds}';
    }
    return 'object';
  }
  return t;
}

function formatRawPreview(val: any): string {
  try {
    if (typeof val === 'string') return `"${val.slice(0, 60)}"`;
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
    if (val instanceof Date) return `Date(${val.toString().slice(0, 40)})`;
    return JSON.stringify(val).slice(0, 80);
  } catch {
    return String(val).slice(0, 60);
  }
}

function tryConvertToTimestamp(val: any): Timestamp | null {
  if (val instanceof Timestamp) return val;
  if (val === null || val === undefined) return null;

  try {
    if (val instanceof Date) {
      const ms = val.getTime();
      if (!Number.isFinite(ms)) return null;
      const sec = Math.floor(ms / 1000);
      if (sec < MIN_TS_SECONDS || sec > MAX_TS_SECONDS) return null;
      return Timestamp.fromDate(val);
    }

    if (typeof val === 'number') {
      if (!Number.isFinite(val)) return null;
      // Treat |val| >= 1e11 as milliseconds, smaller values as seconds
      const ms = Math.abs(val) >= 1e11 ? Math.trunc(val) : Math.round(val * 1000);
      const sec = Math.floor(ms / 1000);
      if (sec < MIN_TS_SECONDS || sec > MAX_TS_SECONDS) return null;
      return Timestamp.fromMillis(ms);
    }

    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (!trimmed || !/\d/.test(trimmed)) return null;
      if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
        const num = Number(trimmed);
        return tryConvertToTimestamp(num);
      }
      const parsedMs = Date.parse(trimmed);
      if (Number.isNaN(parsedMs)) return null;
      const sec = Math.floor(parsedMs / 1000);
      if (sec < MIN_TS_SECONDS || sec > MAX_TS_SECONDS) return null;
      return Timestamp.fromDate(new Date(parsedMs));
    }

    if (typeof val === 'object' && !Array.isArray(val)) {
      const rawSec =
        typeof val.seconds === 'number'
          ? val.seconds
          : typeof val._seconds === 'number'
          ? val._seconds
          : null;
      if (rawSec !== null && Number.isFinite(rawSec)) {
        const rawNano =
          typeof val.nanoseconds === 'number'
            ? val.nanoseconds
            : typeof val._nanoseconds === 'number'
            ? val._nanoseconds
            : 0;
        const sec = Math.trunc(rawSec);
        const nano = Math.min(999999999, Math.max(0, Math.trunc(rawNano || 0)));
        if (sec < MIN_TS_SECONDS || sec > MAX_TS_SECONDS) return null;
        return new Timestamp(sec, nano);
      }
    }
  } catch {
    return null;
  }

  return null;
}

export const DataHealthCheckPanel: React.FC = () => {
  const { adminProfile } = useAuth();
  const { showSuccess, showError } = useToast();

  const [scanning, setScanning] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [confirmFixOpen, setConfirmFixOpen] = useState(false);
  const [report, setReport] = useState<ScanReport | null>(null);
  const [lastFixResult, setLastFixResult] = useState<FixResultSummary | null>(null);

  const runHealthScan = async (preserveFixBanner: boolean = false) => {
    try {
      setScanning(true);
      if (!preserveFixBanner) {
        setLastFixResult(null);
      }

      const issueMap = new Map<
        string,
        {
          collectionLabel: string;
          field: string;
          badDocIds: Set<string>;
          fixableDocIds: Set<string>;
          unparseableDocIds: Set<string>;
          kinds: Set<string>;
        }
      >();

      const pendingFixes: PendingDocFix[] = [];
      const unparseableEntries: UnparseableEntry[] = [];
      const badDocPathSet = new Set<string>();
      let scannedDocs = 0;
      let totalBadFieldHits = 0;

      const recordIssue = (
        collectionLabel: string,
        field: string,
        docId: string,
        docPath: string,
        val: any,
        fixable: boolean
      ) => {
        badDocPathSet.add(docPath);
        totalBadFieldHits++;
        const key = `${collectionLabel}::${field}`;
        let entry = issueMap.get(key);
        if (!entry) {
          entry = {
            collectionLabel,
            field,
            badDocIds: new Set<string>(),
            fixableDocIds: new Set<string>(),
            unparseableDocIds: new Set<string>(),
            kinds: new Set<string>()
          };
          issueMap.set(key, entry);
        }
        entry.badDocIds.add(docId);
        if (fixable) {
          entry.fixableDocIds.add(docId);
        } else {
          entry.unparseableDocIds.add(docId);
        }
        entry.kinds.add(describeValueKind(val));
      };

      const inspectDoc = (
        collectionLabel: string,
        docId: string,
        pathSegments: string[],
        data: Record<string, any>
      ) => {
        scannedDocs++;
        const docPath = pathSegments.join('/');
        const fixPayload: Record<string, any> = {};
        const fixedFieldNames: string[] = [];

        // 1. Scalar date fields
        for (const field of SCALAR_DATE_FIELDS) {
          if (!Object.prototype.hasOwnProperty.call(data, field)) continue;
          const val = data[field];
          if (val === null || val === undefined) continue;
          if (val instanceof Timestamp) continue;

          const converted = tryConvertToTimestamp(val);
          if (converted) {
            fixPayload[field] = converted;
            fixedFieldNames.push(field);
            recordIssue(collectionLabel, field, docId, docPath, val, true);
          } else {
            recordIssue(collectionLabel, field, docId, docPath, val, false);
            unparseableEntries.push({
              collectionLabel,
              docId,
              docPath,
              field,
              rawPreview: formatRawPreview(val)
            });
          }
        }

        // 2. statusHistory[].at (present on orders or any doc with statusHistory array)
        if (Array.isArray(data.statusHistory) && data.statusHistory.length > 0) {
          let hasAnyBadHistoryEntry = false;
          let historyFixable = false;
          const nextHistory = data.statusHistory.map((item: any, idx: number) => {
            if (!item || typeof item !== 'object') return item;
            const atVal = item.at;
            if (atVal === null || atVal === undefined || atVal instanceof Timestamp) {
              return item;
            }
            hasAnyBadHistoryEntry = true;
            const converted = tryConvertToTimestamp(atVal);
            if (converted) {
              historyFixable = true;
              recordIssue(collectionLabel, 'statusHistory[].at', docId, docPath, atVal, true);
              return { ...item, at: converted };
            } else {
              recordIssue(
                collectionLabel,
                'statusHistory[].at',
                docId,
                docPath,
                atVal,
                false
              );
              unparseableEntries.push({
                collectionLabel,
                docId,
                docPath,
                field: `statusHistory[${idx}].at`,
                rawPreview: formatRawPreview(atVal)
              });
              return item;
            }
          });

          if (hasAnyBadHistoryEntry && historyFixable) {
            fixPayload.statusHistory = nextHistory;
            fixedFieldNames.push('statusHistory[].at');
          }
        }

        if (fixedFieldNames.length > 0) {
          pendingFixes.push({
            pathSegments,
            collectionLabel,
            docId,
            payload: fixPayload,
            fixedFieldNames
          });
        }
      };

      // Fetch all top-level collections in parallel
      const topSnaps = await Promise.all(
        TOP_LEVEL_COLLECTIONS.map((colName) => getDocs(collection(db, colName)))
      );

      let supportTicketIds: string[] = [];

      TOP_LEVEL_COLLECTIONS.forEach((colName, idx) => {
        const snap = topSnaps[idx];
        snap.forEach((d) => {
          const dt = d.data() || {};
          inspectDoc(colName, d.id, [colName, d.id], dt);
          if (colName === 'supportTickets') {
            supportTicketIds.push(d.id);
          }
        });
      });

      // Fetch supportTickets/{ticketId}/messages subcollections in batches
      const SUB_CONCURRENCY = 15;
      for (let i = 0; i < supportTicketIds.length; i += SUB_CONCURRENCY) {
        const chunk = supportTicketIds.slice(i, i + SUB_CONCURRENCY);
        const msgSnaps = await Promise.all(
          chunk.map((tid) => getDocs(collection(db, 'supportTickets', tid, 'messages')))
        );
        chunk.forEach((tid, idx) => {
          msgSnaps[idx].forEach((mDoc) => {
            inspectDoc(
              'supportTickets/messages',
              `${tid}/${mDoc.id}`,
              ['supportTickets', tid, 'messages', mDoc.id],
              mDoc.data() || {}
            );
          });
        });
      }

      const issues: FieldScanIssue[] = Array.from(issueMap.values())
        .map((it) => ({
          collectionLabel: it.collectionLabel,
          field: it.field,
          badDocCount: it.badDocIds.size,
          fixableDocCount: it.fixableDocIds.size,
          unparseableDocCount: it.unparseableDocIds.size,
          sampleDocIds: Array.from(it.badDocIds).slice(0, 5),
          sampleKinds: Array.from(it.kinds)
        }))
        .sort((a, b) => {
          const colCmp = a.collectionLabel.localeCompare(b.collectionLabel);
          if (colCmp !== 0) return colCmp;
          return b.badDocCount - a.badDocCount;
        });

      const nextReport: ScanReport = {
        scannedCollections: TOP_LEVEL_COLLECTIONS.length + 1, // + supportTickets/messages
        scannedDocs,
        totalBadDocs: badDocPathSet.size,
        totalBadFieldHits,
        totalFixableDocs: pendingFixes.length,
        issues,
        pendingFixes,
        unparseableEntries
      };

      setReport(nextReport);
      if (!preserveFixBanner) {
        if (issues.length === 0) {
          showSuccess(`Data health check complete: ${scannedDocs} documents scanned, all timestamps valid.`);
        } else {
          showSuccess(
            `Scanned ${scannedDocs} documents: found ${badDocPathSet.size} doc(s) with non-Timestamp date fields.`
          );
        }
      }
    } catch (err: any) {
      showError(err);
    } finally {
      setScanning(false);
    }
  };

  const handleConfirmFixAll = async () => {
    if (!report || report.pendingFixes.length === 0) {
      setConfirmFixOpen(false);
      return;
    }

    try {
      setFixing(true);
      const fixes = report.pendingFixes;
      const CHUNK_SIZE = 400;
      let totalFieldsUpdated = 0;
      const colCounts = new Map<string, number>();

      for (let i = 0; i < fixes.length; i += CHUNK_SIZE) {
        const slice = fixes.slice(i, i + CHUNK_SIZE);
        const batch = writeBatch(db);
        slice.forEach((f) => {
          const ref = doc(db, ...(f.pathSegments as [string, ...string[]]));
          batch.update(ref, f.payload);
          totalFieldsUpdated += f.fixedFieldNames.length;
          colCounts.set(f.collectionLabel, (colCounts.get(f.collectionLabel) || 0) + 1);
        });
        await batch.commit();
      }

      const breakdown = Array.from(colCounts.entries())
        .map(([col, cnt]) => `${col}: ${cnt}`)
        .join(', ');

      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        adminEmail: adminProfile?.email,
        action: 'DATA_HEALTH_CHECK_FIX',
        entityType: 'system',
        entityId: 'dataHealthCheck',
        details: `Converted non-Timestamp date fields to Firestore Timestamps across ${fixes.length} doc(s) (${totalFieldsUpdated} field(s)): ${breakdown}. Unparseable entries left untouched: ${report.unparseableEntries.length}.`
      });

      const untouchedCopy = [...report.unparseableEntries];
      setLastFixResult({
        fixedDocsCount: fixes.length,
        fixedFieldsCount: totalFieldsUpdated,
        untouchedList: untouchedCopy
      });

      setConfirmFixOpen(false);
      showSuccess(`Fixed ${fixes.length} document(s) (${totalFieldsUpdated} date field(s)).`);
      await runHealthScan(true);
    } catch (err: any) {
      showError(err);
    } finally {
      setFixing(false);
    }
  };

  return (
    <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-6 shadow-xs space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-2xl bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 shrink-0">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-extrabold text-base text-gray-900 dark:text-white">
              Data health check
            </h3>
            <p className="text-xs text-gray-600 dark:text-zinc-400 mt-0.5 max-w-2xl">
              Scans <code className="font-mono text-amber-700 dark:text-amber-300">orders</code>,{' '}
              <code className="font-mono text-amber-700 dark:text-amber-300">walletTransactions</code>,{' '}
              <code className="font-mono text-amber-700 dark:text-amber-300">walletTransfers</code>,{' '}
              <code className="font-mono text-amber-700 dark:text-amber-300">supportTickets</code> +{' '}
              <code className="font-mono text-amber-700 dark:text-amber-300">messages</code>,{' '}
              <code className="font-mono text-amber-700 dark:text-amber-300">inbox</code>,{' '}
              <code className="font-mono text-amber-700 dark:text-amber-300">cashRemittances</code>,{' '}
              <code className="font-mono text-amber-700 dark:text-amber-300">merchantPayouts</code>,{' '}
              <code className="font-mono text-amber-700 dark:text-amber-300">riders</code>,{' '}
              <code className="font-mono text-amber-700 dark:text-amber-300">merchants</code>,{' '}
              <code className="font-mono text-amber-700 dark:text-amber-300">reviews</code>, and{' '}
              <code className="font-mono text-amber-700 dark:text-amber-300">orderChats</code> for date fields stored as numbers, strings, or non-Timestamp objects.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => runHealthScan(false)}
            disabled={scanning || fixing}
            className="px-4 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:bg-gray-50 dark:hover:bg-zinc-700 text-gray-800 dark:text-zinc-200 text-xs font-bold flex items-center justify-center gap-2 shadow-xs disabled:opacity-50 whitespace-nowrap"
          >
            {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            <span>{report ? 'Re-run Data health check' : 'Data health check'}</span>
          </button>

          {report && report.totalFixableDocs > 0 && (
            <button
              type="button"
              onClick={() => setConfirmFixOpen(true)}
              disabled={fixing || scanning}
              className="delivio-btn-yellow px-4 py-2.5 rounded-xl text-xs font-extrabold flex items-center justify-center gap-2 shadow-xs disabled:opacity-50 whitespace-nowrap"
            >
              {fixing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wrench className="w-4 h-4" />}
              <span>Fix all ({report.totalFixableDocs})</span>
            </button>
          )}
        </div>
      </div>

      {lastFixResult && (
        <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 text-xs text-emerald-800 dark:text-emerald-300 space-y-1.5">
          <div className="font-bold flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>
              Fixed {lastFixResult.fixedDocsCount} {lastFixResult.fixedDocsCount === 1 ? 'document' : 'documents'} ({lastFixResult.fixedFieldsCount} date {lastFixResult.fixedFieldsCount === 1 ? 'field' : 'fields'}) and wrote an auditLogs entry.
              {lastFixResult.untouchedList.length > 0 &&
                ` ${lastFixResult.untouchedList.length} unparseable value(s) were left untouched.`}
            </span>
          </div>
        </div>
      )}

      {report && (
        <div className="space-y-4">
          {/* Metrics bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="p-3 rounded-2xl bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800">
              <div className="text-[10px] font-bold uppercase text-gray-500">Docs scanned</div>
              <div className="text-base font-extrabold text-gray-900 dark:text-white tabular-nums mt-0.5">
                {report.scannedDocs.toLocaleString()}
              </div>
            </div>
            <div className="p-3 rounded-2xl bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800">
              <div className="text-[10px] font-bold uppercase text-gray-500">Docs with bad dates</div>
              <div
                className={`text-base font-extrabold tabular-nums mt-0.5 ${
                  report.totalBadDocs > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'
                }`}
              >
                {report.totalBadDocs.toLocaleString()}
              </div>
            </div>
            <div className="p-3 rounded-2xl bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800">
              <div className="text-[10px] font-bold uppercase text-gray-500">Fixable docs</div>
              <div className="text-base font-extrabold text-gray-900 dark:text-white tabular-nums mt-0.5">
                {report.totalFixableDocs.toLocaleString()}
              </div>
            </div>
            <div className="p-3 rounded-2xl bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800">
              <div className="text-[10px] font-bold uppercase text-gray-500">Unknown / untouched</div>
              <div
                className={`text-base font-extrabold tabular-nums mt-0.5 ${
                  report.unparseableEntries.length > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'
                }`}
              >
                {report.unparseableEntries.length.toLocaleString()}
              </div>
            </div>
          </div>

          {report.issues.length === 0 ? (
            <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 text-xs font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>All {report.scannedDocs.toLocaleString()} scanned documents hold valid Firestore Timestamps across every checked date field.</span>
            </div>
          ) : (
            <div className="border border-gray-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-50 dark:bg-zinc-850/60 uppercase font-bold text-gray-500 dark:text-zinc-400 border-b border-gray-200 dark:border-zinc-800">
                    <tr>
                      <th className="px-4 py-3">Collection</th>
                      <th className="px-4 py-3">Field</th>
                      <th className="px-4 py-3">Found Types</th>
                      <th className="px-4 py-3 text-right">Non-Timestamp Docs</th>
                      <th className="px-4 py-3">Sample Doc IDs</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
                    {report.issues.map((issue) => (
                      <tr
                        key={`${issue.collectionLabel}::${issue.field}`}
                        className="hover:bg-gray-50/70 dark:hover:bg-zinc-800/40"
                      >
                        <td className="px-4 py-2.5 font-mono font-bold text-gray-900 dark:text-white">
                          {issue.collectionLabel}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-amber-700 dark:text-amber-300 font-semibold">
                          {issue.field}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {issue.sampleKinds.map((k) => (
                              <span
                                key={k}
                                className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-zinc-800 text-[10px] font-bold text-gray-700 dark:text-zinc-300"
                              >
                                {k}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-extrabold text-gray-900 dark:text-white tabular-nums">
                          {issue.badDocCount}
                          {issue.unparseableDocCount > 0 && (
                            <span className="ml-1.5 text-[10px] text-red-600 dark:text-red-400">
                              ({issue.unparseableDocCount} unknown)
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-wrap gap-1 max-w-md">
                            {issue.sampleDocIds.map((id) => (
                              <span
                                key={id}
                                className="px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 font-mono text-[10px] text-amber-800 dark:text-amber-300"
                              >
                                {id}
                              </span>
                            ))}
                            {issue.badDocCount > issue.sampleDocIds.length && (
                              <span className="text-[10px] text-gray-400 self-center">
                                +{issue.badDocCount - issue.sampleDocIds.length} more
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Untouched / Unparseable formats list */}
          {report.unparseableEntries.length > 0 && (
            <div className="p-4 rounded-2xl bg-red-50/70 dark:bg-red-950/20 border border-red-200 dark:border-red-900/60 space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-extrabold text-red-700 dark:text-red-300">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span>
                  Unknown date formats (left untouched by Fix all — {report.unparseableEntries.length})
                </span>
              </div>
              <div className="max-h-56 overflow-y-auto border border-red-200/80 dark:border-red-900/50 rounded-xl bg-white dark:bg-zinc-900 divide-y divide-red-100 dark:divide-red-900/30 text-[11px]">
                {report.unparseableEntries.map((u, idx) => (
                  <div
                    key={`${u.docPath}::${u.field}::${idx}`}
                    className="px-3 py-2 flex flex-wrap items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-bold text-gray-900 dark:text-white">
                        {u.collectionLabel}
                      </span>
                      <span className="font-mono text-gray-500">{u.docId}</span>
                      <span className="font-mono text-amber-700 dark:text-amber-300 font-semibold">
                        .{u.field}
                      </span>
                    </div>
                    <span className="font-mono text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 px-2 py-0.5 rounded">
                      {u.rawPreview}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {lastFixResult &&
            lastFixResult.untouchedList.length > 0 &&
            report.unparseableEntries.length === 0 && (
              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>
                  {lastFixResult.untouchedList.length} unknown date value(s) from the prior run were left untouched.
                </span>
              </div>
            )}
        </div>
      )}

      {confirmFixOpen && report && (
        <ConfirmationModal
          isOpen={confirmFixOpen}
          onClose={() => setConfirmFixOpen(false)}
          onConfirm={handleConfirmFixAll}
          title="Convert non-Timestamp dates to Firestore Timestamps?"
          message={`This will convert convertible numbers, valid date strings, and timestamp objects to Firestore Timestamps across ${report.totalFixableDocs} document(s) in batches of 400 and write an auditLogs entry.${report.unparseableEntries.length > 0 ? ` ${report.unparseableEntries.length} unparseable value(s) will be left untouched.` : ''}`}
          confirmLabel={fixing ? 'Fixing...' : `Fix all (${report.totalFixableDocs})`}
          reasonRequired={false}
          isDestructive={false}
        />
      )}
    </div>
  );
};
