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
import type { WalletTransfer } from '../types';
import {
  ArrowLeftRight,
  Search,
  Filter,
  Download,
  Calendar,
  DollarSign,
  TrendingUp,
  AlertTriangle,
  QrCode,
  Send,
  User,
  Clock,
  ChevronDown,
  Loader2,
  Copy,
  Check,
  Sparkles,
  ArrowUpRight,
  ArrowDownLeft,
  X,
  ShieldAlert
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts';

export const WalletTransfers: React.FC = () => {
  const { showError, showSuccess } = useToast();

  const [transfers, setTransfers] = useState<WalletTransfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [limitCount, setLimitCount] = useState(50);
  const [hasMore, setHasMore] = useState(true);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | '7days' | '30days'>('all');
  const [minAmount, setMinAmount] = useState<string>('');
  const [methodFilter, setMethodFilter] = useState<string>('all');
  const [largeOnly, setLargeOnly] = useState(false);

  // Selected Transfer for Detail Modal
  const [selectedTransfer, setSelectedTransfer] = useState<WalletTransfer | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Fetch transfers with limit
  const fetchTransfers = async (currentLimit: number, isLoadMore = false) => {
    try {
      if (isLoadMore) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }

      const transfersRef = collection(db, 'walletTransfers');
      const q = query(transfersRef, limit(currentLimit));
      const snap = await getDocs(q);

      const list: WalletTransfer[] = [];
      snap.forEach((d) => {
        const dt = d.data();
        list.push({
          id: d.id,
          reference: dt.reference || d.id.substring(0, 10).toUpperCase(),
          fromUid: dt.fromUid || '',
          fromName: dt.fromName || 'Unknown Sender',
          fromEmail: dt.fromEmail || '',
          fromPhone: dt.fromPhone || '',
          toUid: dt.toUid || '',
          toName: dt.toName || 'Unknown Recipient',
          toEmail: dt.toEmail || '',
          toPhone: dt.toPhone || '',
          amount: Number(dt.amount || 0),
          note: dt.note || '',
          method: dt.method || 'send',
          status: dt.status || 'completed',
          createdAt: dt.createdAt
        });
      });

      // Sort in code (newest first)
      list.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

      setTransfers(list);
      setHasMore(snap.docs.length >= currentLimit);
    } catch (err: any) {
      showError(err);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    fetchTransfers(limitCount);
  }, [limitCount]);

  const handleLoadMore = () => {
    setLimitCount((prev) => prev + 50);
  };

  // Filtered transfers
  const filteredTransfers = useMemo(() => {
    const now = Date.now();
    const minVal = minAmount ? parseFloat(minAmount) : 0;

    return transfers.filter((t) => {
      // 1. Min Amount Filter
      if (minVal > 0 && t.amount < minVal) {
        return false;
      }

      // 2. Large Only (> ₱5,000)
      if (largeOnly && t.amount <= 5000) {
        return false;
      }

      // 3. Method Filter
      if (methodFilter !== 'all' && t.method.toLowerCase() !== methodFilter.toLowerCase()) {
        return false;
      }

      // 4. Date Filter
      if (dateFilter !== 'all') {
        const tTime = t.createdAt?.seconds ? t.createdAt.seconds * 1000 : 0;
        if (dateFilter === 'today') {
          const startOfDay = new Date().setHours(0, 0, 0, 0);
          if (tTime < startOfDay) return false;
        } else if (dateFilter === '7days') {
          if (now - tTime > 7 * 24 * 3600 * 1000) return false;
        } else if (dateFilter === '30days') {
          if (now - tTime > 30 * 24 * 3600 * 1000) return false;
        }
      }

      // 5. Search Query by Customer Name, Email, or UID
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const fName = (t.fromName || '').toLowerCase();
        const fEmail = (t.fromEmail || '').toLowerCase();
        const fUid = (t.fromUid || '').toLowerCase();
        const tName = (t.toName || '').toLowerCase();
        const tEmail = (t.toEmail || '').toLowerCase();
        const tUid = (t.toUid || '').toLowerCase();
        const ref = (t.reference || t.id || '').toLowerCase();
        const note = (t.note || '').toLowerCase();

        if (
          !fName.includes(q) &&
          !fEmail.includes(q) &&
          !fUid.includes(q) &&
          !tName.includes(q) &&
          !tEmail.includes(q) &&
          !tUid.includes(q) &&
          !ref.includes(q) &&
          !note.includes(q)
        ) {
          return false;
        }
      }

      return true;
    });
  }, [transfers, searchQuery, dateFilter, minAmount, methodFilter, largeOnly]);

  // Aggregate Metrics & Total Sent Per Day
  const { totalVolume, totalCount, largeCount, todayVolume, dailyChartData } = useMemo(() => {
    let vol = 0;
    let large = 0;
    let todayVol = 0;
    const startOfToday = new Date().setHours(0, 0, 0, 0);

    const dayMap: Record<string, { date: string; total: number; count: number }> = {};

    filteredTransfers.forEach((t) => {
      vol += t.amount;
      if (t.amount > 5000) {
        large += 1;
      }

      const tTime = t.createdAt?.seconds ? t.createdAt.seconds * 1000 : 0;
      if (tTime >= startOfToday) {
        todayVol += t.amount;
      }

      // Day map grouping
      if (t.createdAt?.seconds) {
        const d = new Date(t.createdAt.seconds * 1000);
        const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        if (!dayMap[dateStr]) {
          dayMap[dateStr] = { date: dateStr, total: 0, count: 0 };
        }
        dayMap[dateStr].total += t.amount;
        dayMap[dateStr].count += 1;
      }
    });

    // Sort chart data chronologically (up to last 14 days)
    const chartList = Object.values(dayMap).slice(0, 14).reverse();

    return {
      totalVolume: vol,
      totalCount: filteredTransfers.length,
      largeCount: large,
      todayVolume: todayVol,
      dailyChartData: chartList
    };
  }, [filteredTransfers]);

  // CSV Export
  const handleExportCsv = () => {
    const rows = filteredTransfers.map((t) => ({
      Reference: t.reference || t.id,
      Time: formatTimestamp(t.createdAt),
      Amount: t.amount,
      IsLargeTransfer: t.amount > 5000 ? 'YES' : 'NO',
      Method: t.method.toUpperCase(),
      FromName: t.fromName,
      FromUID: t.fromUid,
      FromEmail: t.fromEmail || '',
      ToName: t.toName,
      ToUID: t.toUid,
      ToEmail: t.toEmail || '',
      Note: t.note || ''
    }));

    exportToCsv(`delivio_wallet_transfers_${new Date().toISOString().slice(0, 10)}`, rows);
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight flex items-center gap-3">
            <div className="p-2 rounded-2xl bg-amber-400 text-black shadow-md shadow-amber-400/20">
              <ArrowLeftRight className="w-6 h-6" />
            </div>
            <span>Wallet Transfers Oversight</span>
          </h1>
          <p className="text-sm text-gray-500 dark:text-zinc-400 mt-1">
            Audit peer-to-peer customer wallet transactions, send/QR transfers, and high-value movements.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleExportCsv}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-gray-700 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-800 text-xs font-bold shadow-xs transition-colors"
          >
            <Download className="w-4 h-4" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Metric KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 shadow-xs">
          <span className="text-xs font-bold uppercase tracking-wider text-gray-400">
            Total Transferred
          </span>
          <div className="text-2xl font-black text-gray-900 dark:text-white mt-1.5">
            ₱{totalVolume.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <span className="text-[11px] text-gray-400 font-medium">
            Across {totalCount} transfers
          </span>
        </div>

        <div className="p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 shadow-xs">
          <span className="text-xs font-bold uppercase tracking-wider text-gray-400">
            Transferred Today
          </span>
          <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1.5">
            ₱{todayVolume.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <span className="text-[11px] text-gray-400 font-medium">
            Since 12:00 AM
          </span>
        </div>

        <div className="p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-gray-400">
              Large Transfers (&gt;₱5k)
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
              Over ₱5,000
            </span>
          </div>
          <div className="text-2xl font-black text-amber-600 dark:text-amber-400 mt-1.5">
            {largeCount}
          </div>
          <span className="text-[11px] text-gray-400 font-medium">
            High-value transfer alerts
          </span>
        </div>

        <div className="p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 shadow-xs">
          <span className="text-xs font-bold uppercase tracking-wider text-gray-400">
            Average Amount
          </span>
          <div className="text-2xl font-black text-blue-600 dark:text-blue-400 mt-1.5">
            ₱{totalCount > 0 ? (totalVolume / totalCount).toFixed(2) : '0.00'}
          </div>
          <span className="text-[11px] text-gray-400 font-medium">
            Per transfer transaction
          </span>
        </div>
      </div>

      {/* Daily Volume Breakdown Chart (Total Sent per Day) */}
      {dailyChartData.length > 0 && (
        <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-6 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-extrabold text-base text-gray-900 dark:text-white flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-amber-500" />
                Total Sent Per Day (Daily Transfer Volume)
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">
                Aggregated daily volume of funds sent between customer wallets
              </p>
            </div>
            <span className="text-xs font-bold text-gray-400">
              {dailyChartData.length} active days
            </span>
          </div>

          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyChartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#88888820" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(val) => `₱${val}`} />
                <Tooltip
                  formatter={(val: any) => [`₱${Number(val).toLocaleString()}`, 'Total Sent']}
                  labelStyle={{ fontWeight: 'bold' }}
                  contentStyle={{
                    backgroundColor: '#18181b',
                    borderColor: '#27272a',
                    borderRadius: '12px',
                    color: '#fff',
                    fontSize: '12px'
                  }}
                />
                <Bar dataKey="total" fill="#f59e0b" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-4 shadow-xs space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 items-center">
          {/* Customer Search by Name or Email or UID */}
          <div className="lg:col-span-4 relative">
            <Search className="w-4 h-4 absolute left-3.5 top-3 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search sender, recipient, email, reference..."
              className="w-full pl-9 pr-4 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-amber-400"
            />
          </div>

          {/* Date Filter */}
          <div className="lg:col-span-2">
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value as any)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-amber-400 font-medium"
            >
              <option value="all">All Dates</option>
              <option value="today">Today</option>
              <option value="7days">Last 7 Days</option>
              <option value="30days">Last 30 Days</option>
            </select>
          </div>

          {/* Amount Over X Filter */}
          <div className="lg:col-span-2 relative">
            <span className="absolute left-3 top-2 text-xs font-bold text-gray-400">₱&gt;</span>
            <input
              type="number"
              value={minAmount}
              onChange={(e) => setMinAmount(e.target.value)}
              placeholder="Amount over X..."
              className="w-full pl-8 pr-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-amber-400"
            />
          </div>

          {/* Method Filter */}
          <div className="lg:col-span-2">
            <select
              value={methodFilter}
              onChange={(e) => setMethodFilter(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-amber-400 font-medium"
            >
              <option value="all">All Methods</option>
              <option value="send">Direct Send</option>
              <option value="qr">QR Code</option>
            </select>
          </div>

          {/* Quick toggle: Large Transfer (>₱5,000) */}
          <div className="lg:col-span-2 flex items-center">
            <button
              onClick={() => setLargeOnly(!largeOnly)}
              className={`w-full py-2 px-3 rounded-xl text-xs font-bold transition-all border flex items-center justify-center gap-1.5 ${
                largeOnly
                  ? 'bg-amber-400 text-black border-amber-500 shadow-sm'
                  : 'bg-gray-50 dark:bg-zinc-800 text-gray-600 dark:text-zinc-300 border-gray-200 dark:border-zinc-700 hover:bg-gray-100'
              }`}
            >
              <AlertTriangle className={`w-3.5 h-3.5 ${largeOnly ? 'text-black' : 'text-amber-500'}`} />
              <span>&gt; ₱5,000 Only</span>
            </button>
          </div>
        </div>
      </div>

      {/* Transfers Table */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-50 dark:bg-zinc-850/60 uppercase font-bold text-gray-500 dark:text-zinc-400 border-b border-gray-200 dark:border-zinc-800">
              <tr>
                <th className="px-4 py-3.5">Time</th>
                <th className="px-4 py-3.5">Reference</th>
                <th className="px-4 py-3.5">From (Sender)</th>
                <th className="px-4 py-3.5">To (Recipient)</th>
                <th className="px-4 py-3.5">Method</th>
                <th className="px-4 py-3.5">Amount</th>
                <th className="px-4 py-3.5">Note</th>
                <th className="px-4 py-3.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-zinc-800 font-medium">
              {loading ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-gray-400 text-xs">
                    <Loader2 className="w-5 h-5 animate-spin mx-auto text-amber-500 mb-2" />
                    Loading wallet transfers...
                  </td>
                </tr>
              ) : filteredTransfers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-gray-400 text-xs">
                    No wallet transfers found matching the criteria.
                  </td>
                </tr>
              ) : (
                filteredTransfers.map((t) => {
                  const isLarge = t.amount > 5000;
                  return (
                    <tr
                      key={t.id}
                      onClick={() => setSelectedTransfer(t)}
                      className={`cursor-pointer transition-colors ${
                        isLarge
                          ? 'bg-amber-50/60 hover:bg-amber-100/60 dark:bg-amber-950/20 dark:hover:bg-amber-950/40 border-l-4 border-l-amber-500'
                          : 'hover:bg-gray-50 dark:hover:bg-zinc-800/50'
                      }`}
                    >
                      {/* Time */}
                      <td className="px-4 py-3 text-gray-500 dark:text-zinc-400 whitespace-nowrap">
                        <div className="font-semibold text-gray-900 dark:text-white">
                          {formatTimestamp(t.createdAt)}
                        </div>
                        <div className="text-[10px] text-gray-400">
                          {formatRelativeTime(t.createdAt)}
                        </div>
                      </td>

                      {/* Reference */}
                      <td className="px-4 py-3 font-mono font-bold text-gray-900 dark:text-white whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          <span>{t.reference || t.id.substring(0, 8).toUpperCase()}</span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              copyToClipboard(t.reference || t.id, t.id);
                            }}
                            className="p-1 text-gray-400 hover:text-gray-600 rounded"
                            title="Copy Reference"
                          >
                            {copiedId === t.id ? (
                              <Check className="w-3 h-3 text-emerald-500" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                      </td>

                      {/* From: Sender */}
                      <td className="px-4 py-3">
                        <div className="font-bold text-gray-900 dark:text-white flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                          <span>{t.fromName}</span>
                        </div>
                        {t.fromEmail && (
                          <div className="text-[10px] text-gray-400">{t.fromEmail}</div>
                        )}
                        <div className="text-[10px] font-mono text-gray-400 truncate max-w-[120px]">
                          UID: {t.fromUid}
                        </div>
                      </td>

                      {/* To: Recipient */}
                      <td className="px-4 py-3">
                        <div className="font-bold text-gray-900 dark:text-white flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                          <span>{t.toName}</span>
                        </div>
                        {t.toEmail && (
                          <div className="text-[10px] text-gray-400">{t.toEmail}</div>
                        )}
                        <div className="text-[10px] font-mono text-gray-400 truncate max-w-[120px]">
                          UID: {t.toUid}
                        </div>
                      </td>

                      {/* Method */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        {t.method.toLowerCase() === 'qr' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-900 dark:bg-purple-950 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                            <QrCode className="w-3 h-3 text-purple-600" />
                            <span>QR Code</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                            <Send className="w-3 h-3 text-blue-600" />
                            <span>Direct Send</span>
                          </span>
                        )}
                      </td>

                      {/* Amount & Large Transfer Highlight */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className={`font-black text-sm ${isLarge ? 'text-amber-600 dark:text-amber-400 font-extrabold' : 'text-gray-900 dark:text-white'}`}>
                            ₱{Number(t.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                          {isLarge && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-amber-400 text-black shadow-xs">
                              <Sparkles className="w-2.5 h-2.5" /> Large
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Note */}
                      <td className="px-4 py-3 max-w-[180px] truncate text-gray-600 dark:text-zinc-400">
                        {t.note ? `"${t.note}"` : <span className="text-gray-300 dark:text-zinc-600">—</span>}
                      </td>

                      {/* Action */}
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedTransfer(t);
                          }}
                          className="px-2.5 py-1 rounded-lg text-xs font-bold text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40 transition-colors"
                        >
                          Details &rarr;
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Load More Button */}
        {hasMore && !loading && (
          <div className="p-4 border-t border-gray-100 dark:border-zinc-800 text-center">
            <button
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="px-5 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-xs font-bold text-gray-800 dark:text-zinc-200 transition-colors inline-flex items-center gap-2"
            >
              {loadingMore ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-amber-500" />
                  <span>Loading more transfers...</span>
                </>
              ) : (
                <>
                  <ChevronDown className="w-4 h-4 text-gray-500" />
                  <span>Load More (Current limit: {limitCount})</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Transfer Detail Modal */}
      {selectedTransfer && (
        <div className="fixed inset-0 z-50 overflow-hidden flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div
            className="w-full max-w-lg bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="p-5 border-b border-gray-100 dark:border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-amber-400 text-black">
                  <ArrowLeftRight className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-base text-gray-900 dark:text-white">
                    Wallet Transfer Details
                  </h3>
                  <p className="font-mono text-xs text-gray-400">
                    Ref #{selectedTransfer.reference || selectedTransfer.id}
                  </p>
                </div>
              </div>

              <button
                onClick={() => setSelectedTransfer(null)}
                className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-zinc-200 rounded-xl"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-4 text-xs">
              {/* Highlight Banner if > ₱5,000 */}
              {selectedTransfer.amount > 5000 && (
                <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-900 dark:text-amber-200 flex items-center gap-2.5">
                  <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
                  <div>
                    <span className="font-extrabold text-xs block">Large Transfer Flag (&gt; ₱5,000)</span>
                    <span className="text-[11px] text-amber-700 dark:text-amber-300/80">
                      High-value peer transfer audited under financial compliance oversight.
                    </span>
                  </div>
                </div>
              )}

              {/* Amount Display */}
              <div className="p-4 rounded-2xl bg-gray-50 dark:bg-zinc-800/50 border border-gray-100 dark:border-zinc-800 text-center">
                <span className="text-gray-400 text-[11px] uppercase font-bold tracking-wider">
                  Transferred Amount
                </span>
                <div className="text-3xl font-black text-gray-900 dark:text-white mt-1">
                  ₱{Number(selectedTransfer.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className="mt-2 flex items-center justify-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300">
                    Method: {selectedTransfer.method.toUpperCase()}
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                    Status: {selectedTransfer.status || 'Completed'}
                  </span>
                </div>
              </div>

              {/* Sender & Recipient Cards */}
              <div className="grid grid-cols-2 gap-3">
                {/* Sender */}
                <div className="p-3 rounded-2xl bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/40 space-y-1">
                  <div className="flex items-center gap-1.5 text-blue-700 dark:text-blue-300 font-bold uppercase text-[10px]">
                    <ArrowUpRight className="w-3.5 h-3.5" /> Sender (From)
                  </div>
                  <div className="font-bold text-gray-900 dark:text-white">
                    {selectedTransfer.fromName}
                  </div>
                  {selectedTransfer.fromEmail && (
                    <div className="text-gray-500 text-[11px]">{selectedTransfer.fromEmail}</div>
                  )}
                  {selectedTransfer.fromPhone && (
                    <div className="text-gray-400 text-[10px]">{selectedTransfer.fromPhone}</div>
                  )}
                  <div className="text-[10px] font-mono text-gray-400 pt-1 border-t border-blue-100 dark:border-blue-900/30 truncate">
                    UID: {selectedTransfer.fromUid}
                  </div>
                </div>

                {/* Recipient */}
                <div className="p-3 rounded-2xl bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/40 space-y-1">
                  <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300 font-bold uppercase text-[10px]">
                    <ArrowDownLeft className="w-3.5 h-3.5" /> Recipient (To)
                  </div>
                  <div className="font-bold text-gray-900 dark:text-white">
                    {selectedTransfer.toName}
                  </div>
                  {selectedTransfer.toEmail && (
                    <div className="text-gray-500 text-[11px]">{selectedTransfer.toEmail}</div>
                  )}
                  {selectedTransfer.toPhone && (
                    <div className="text-gray-400 text-[10px]">{selectedTransfer.toPhone}</div>
                  )}
                  <div className="text-[10px] font-mono text-gray-400 pt-1 border-t border-emerald-100 dark:border-emerald-900/30 truncate">
                    UID: {selectedTransfer.toUid}
                  </div>
                </div>
              </div>

              {/* Note and Timestamp */}
              <div className="space-y-2 p-3 rounded-2xl bg-gray-50 dark:bg-zinc-800/40 border border-gray-100 dark:border-zinc-800 text-[11px]">
                <div className="flex justify-between">
                  <span className="text-gray-400">Transfer Time:</span>
                  <span className="font-semibold text-gray-900 dark:text-white">
                    {formatTimestamp(selectedTransfer.createdAt)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Reference:</span>
                  <span className="font-mono font-bold text-gray-900 dark:text-white">
                    {selectedTransfer.reference || selectedTransfer.id}
                  </span>
                </div>
                {selectedTransfer.note && (
                  <div className="pt-2 border-t border-gray-200 dark:border-zinc-700">
                    <span className="text-gray-400 block mb-0.5">Transfer Note:</span>
                    <p className="italic text-gray-800 dark:text-zinc-200 font-medium">
                      "{selectedTransfer.note}"
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-gray-100 dark:border-zinc-800 flex justify-end">
              <button
                onClick={() => setSelectedTransfer(null)}
                className="px-4 py-2 rounded-xl bg-gray-200 dark:bg-zinc-800 text-gray-800 dark:text-zinc-200 text-xs font-bold hover:bg-gray-300 dark:hover:bg-zinc-700 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
