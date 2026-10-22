import React, { useState, useEffect, useMemo } from 'react';
import {
  db,
  collection,
  query,
  limit,
  getDocs,
  Timestamp
} from '../firebase';
import { useToast } from '../context/ToastContext';
import { exportToCsv } from '../utils/exportCsv';
import { formatTimestamp, formatRelativeTime } from '../utils/date';
import type { AuditLogEntry } from '../types';
import {
  ShieldAlert,
  Search,
  Filter,
  Download,
  Calendar,
  User,
  Activity,
  ChevronDown
} from 'lucide-react';
import { TableSkeleton } from '../components/common/SkeletonLoader';

export const AuditLog: React.FC = () => {
  const { showError } = useToast();

  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [entityFilter, setEntityFilter] = useState('all');
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  const fetchLogs = async () => {
    try {
      setLoading(true);
      const q = query(collection(db, 'auditLogs'), limit(200));
      const snap = await getDocs(q);
      const list: AuditLogEntry[] = [];
      snap.forEach((d) => {
        const dt = d.data();
        list.push({
          id: d.id,
          adminId: dt.adminId || '',
          adminName: dt.adminName || 'Admin',
          adminEmail: dt.adminEmail,
          action: dt.action || 'ACTION',
          entityType: dt.entityType || 'unknown',
          entityId: dt.entityId || '',
          details: dt.details || '',
          oldValue: dt.oldValue,
          newValue: dt.newValue,
          reason: dt.reason,
          timestamp: dt.timestamp
        });
      });
      list.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));
      setLogs(list);
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const filteredLogs = useMemo(() => {
    return logs.filter((l) => {
      if (entityFilter !== 'all' && l.entityType !== entityFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const a = (l.action || '').toLowerCase();
        const n = (l.adminName || '').toLowerCase();
        const d = (l.details || '').toLowerCase();
        const id = (l.entityId || '').toLowerCase();
        if (!a.includes(q) && !n.includes(q) && !d.includes(q) && !id.includes(q)) return false;
      }
      return true;
    });
  }, [logs, entityFilter, searchQuery]);

  const handleExportCsv = () => {
    const rows = filteredLogs.map((l) => ({
      Timestamp: formatTimestamp(l.timestamp),
      Admin: l.adminName,
      Action: l.action,
      EntityType: l.entityType,
      EntityID: l.entityId,
      Details: l.details || '',
      Reason: l.reason || ''
    }));
    exportToCsv(`delivio_audit_logs_${new Date().toISOString().slice(0, 10)}`, rows);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">
            Security & Operations Audit Trail
          </h1>
          <p className="text-sm text-gray-500 dark:text-zinc-400 mt-0.5">
            Immutable system audit logs tracking all administrative interventions, cancellations, and edits.
          </p>
        </div>

        <button
          onClick={handleExportCsv}
          className="flex items-center gap-2 px-3.5 py-2 rounded-xl border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs font-bold text-gray-700 dark:text-zinc-300 hover:bg-gray-50 shadow-xs self-start sm:self-auto"
        >
          <Download className="w-4 h-4" />
          <span>Export Audit Trail</span>
        </button>
      </div>

      {/* Filter toolbar */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-4 shadow-xs">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2 relative">
            <Search className="w-4 h-4 absolute left-3.5 top-3 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by admin name, action keyword, entity ID..."
              className="w-full pl-9 pr-4 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-amber-400"
            />
          </div>

          <div>
            <select
              value={entityFilter}
              onChange={(e) => setEntityFilter(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
            >
              <option value="all">All Entity Types</option>
              <option value="order">Order Actions</option>
              <option value="customer">Customer Accounts</option>
              <option value="merchant">Merchant Stores</option>
              <option value="rider">Rider Operations</option>
              <option value="merchantApplication">Merchant Applications</option>
              <option value="riderApplication">Rider Applications</option>
              <option value="deliveryRates">Delivery Rates</option>
              <option value="tierEvent">Tier Rewards</option>
              <option value="banner">Promotional Banners</option>
            </select>
          </div>
        </div>
      </div>

      {/* Audit Log Table */}
      {loading ? (
        <TableSkeleton rows={8} cols={5} />
      ) : (
        <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 dark:bg-zinc-850 uppercase font-bold text-gray-400 border-b border-gray-200 dark:border-zinc-800">
                <tr>
                  <th className="px-4 py-3.5">Timestamp</th>
                  <th className="px-4 py-3.5">Admin Operator</th>
                  <th className="px-4 py-3.5">Action</th>
                  <th className="px-4 py-3.5">Target Entity</th>
                  <th className="px-4 py-3.5">Action Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
                {filteredLogs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-12 text-gray-400">
                      No audit events found.
                    </td>
                  </tr>
                ) : (
                  filteredLogs.map((l) => {
                    const isExpanded = expandedLogId === l.id;
                    const hasValues = l.oldValue || l.newValue;

                    return (
                      <React.Fragment key={l.id}>
                        <tr
                          onClick={() => setExpandedLogId(isExpanded ? null : l.id || null)}
                          className="hover:bg-amber-50/50 dark:hover:bg-zinc-800/50 cursor-pointer transition-colors"
                        >
                          <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                            {formatTimestamp(l.timestamp)}
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-bold text-gray-900 dark:text-white">
                              {l.adminName}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-mono uppercase font-bold text-amber-600 bg-amber-50 dark:bg-zinc-800 px-2 py-0.5 rounded-md">
                              {l.action}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-semibold text-gray-800 dark:text-zinc-200">
                            <span className="capitalize">{l.entityType}</span>:{' '}
                            <span className="font-mono text-gray-400 text-[11px]">
                              {l.entityId}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-600 dark:text-zinc-300">
                            <div className="flex items-center justify-between">
                              <span className="truncate max-w-md">{l.details}</span>
                              {hasValues && (
                                <ChevronDown
                                  className={`w-3.5 h-3.5 text-gray-400 transition-transform ${
                                    isExpanded ? 'rotate-180' : ''
                                  }`}
                                />
                              )}
                            </div>
                          </td>
                        </tr>

                        {isExpanded && hasValues && (
                          <tr className="bg-gray-50/80 dark:bg-zinc-950/80">
                            <td colSpan={5} className="px-6 py-3 border-y border-gray-200 dark:border-zinc-800">
                              <div className="text-xs space-y-2">
                                {l.reason && (
                                  <div className="text-red-600 font-bold">
                                    Mandatory Reason: {l.reason}
                                  </div>
                                )}
                                <div className="grid grid-cols-2 gap-4 font-mono text-[11px]">
                                  <div className="p-2.5 rounded-xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 overflow-x-auto">
                                    <span className="text-[10px] text-gray-400 uppercase font-sans font-bold block mb-1">
                                      Before State (Old Value)
                                    </span>
                                    <pre className="text-gray-600 dark:text-zinc-400">
                                      {JSON.stringify(l.oldValue, null, 2)}
                                    </pre>
                                  </div>
                                  <div className="p-2.5 rounded-xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 overflow-x-auto">
                                    <span className="text-[10px] text-emerald-600 uppercase font-sans font-bold block mb-1">
                                      After State (New Value)
                                    </span>
                                    <pre className="text-emerald-700 dark:text-emerald-400">
                                      {JSON.stringify(l.newValue, null, 2)}
                                    </pre>
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
