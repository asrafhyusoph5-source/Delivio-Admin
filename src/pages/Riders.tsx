import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  db,
  collection,
  query,
  where,
  limit,
  getDocs,
  doc,
  updateDoc,
  addDoc,
  increment,
  writeBatch,
  Timestamp
} from '../firebase';
import { useCity } from '../context/CityContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { logAuditEvent, logEditHistory } from '../utils/audit';
import { exportToCsv } from '../utils/exportCsv';
import { formatTimestamp, formatRelativeTime } from '../utils/date';
import type { Rider, Order, OrderServiceType, EditHistoryEntry, TierEvent } from '../types';
import {
  Search,
  Bike,
  Phone,
  Mail,
  Shield,
  Star,
  DollarSign,
  Coins,
  Send,
  History,
  CheckCircle2,
  AlertTriangle,
  X,
  Edit,
  Loader2,
  Download,
  PlusCircle,
  Award
} from 'lucide-react';
import { TableSkeleton } from '../components/common/SkeletonLoader';
import { ConfirmationModal } from '../components/common/ConfirmationModal';

const ALL_SERVICES: OrderServiceType[] = [
  'food',
  'convenience',
  'parcel',
  'pabili',
  'request_rider'
];

export const Riders: React.FC = () => {
  const [searchParams] = useSearchParams();
  const initialSearch = searchParams.get('search') || '';

  const { selectedCityId, cities } = useCity();
  const { adminProfile } = useAuth();
  const { showSuccess, showError } = useToast();

  const [riders, setRiders] = useState<Rider[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [onlineFilter, setOnlineFilter] = useState<'all' | 'online' | 'offline'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'suspended'>('all');
  const [vehicleFilter, setVehicleFilter] = useState<string>('all');

  // Selected Rider & Tabs
  const [selectedRider, setSelectedRider] = useState<Rider | null>(null);
  const [activeTab, setActiveTab] = useState<
    'details' | 'status' | 'services' | 'orders' | 'cash' | 'wallet' | 'tiers' | 'inbox' | 'history'
  >('details');

  // Edit details form state
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [riderCode, setRiderCode] = useState('');
  const [cityId, setCityId] = useState('');
  const [vehicleType, setVehicleType] = useState('Motorcycle');
  const [vehicleModel, setVehicleModel] = useState('');
  const [plate, setPlate] = useState('');
  const [savingDetails, setSavingDetails] = useState(false);

  // Orders & Earnings
  const [riderOrders, setRiderOrders] = useState<Order[]>([]);

  // Cash Remittance
  const [remitAmount, setRemitAmount] = useState<number>(0);
  const [remitNote, setRemitNote] = useState('');
  const [recordingRemittance, setRecordingRemittance] = useState(false);
  const [remittancesList, setRemittancesList] = useState<any[]>([]);

  // Wallet Cash-in
  const [cashInAmount, setCashInAmount] = useState<number>(0);
  const [cashInNote, setCashInNote] = useState('');
  const [addingCash, setAddingCash] = useState(false);
  const [walletTxns, setWalletTxns] = useState<any[]>([]);

  // Tiers
  const [tierEvents, setTierEvents] = useState<TierEvent[]>([]);

  // Direct Inbox Message
  const [msgTitle, setMsgTitle] = useState('');
  const [msgBody, setMsgBody] = useState('');
  const [msgCategory, setMsgCategory] = useState<'admin' | 'order' | 'promo' | 'safety' | 'system'>('admin');
  const [sendingMsg, setSendingMsg] = useState(false);

  // Edit History
  const [editHistory, setEditHistory] = useState<EditHistoryEntry[]>([]);

  // 1. Fetch Riders
  const fetchRiders = async () => {
    try {
      setLoading(true);
      const snap = await getDocs(query(collection(db, 'riders'), limit(200)));
      const list: Rider[] = [];
      snap.forEach((d) => {
        const dt = d.data();
        list.push({
          id: d.id,
          name: dt.name || 'Rider',
          email: dt.email || '',
          phone: dt.phone || '',
          photoUrl: dt.photoUrl || '',
          riderCode: dt.riderCode || d.id.substring(0, 8),
          status: dt.status || 'active',
          cityId: dt.cityId,
          vehicleType: dt.vehicleType || 'Motorcycle',
          vehicleModel: dt.vehicleModel || '',
          plate: dt.plate || '',
          allowedServices: dt.allowedServices || ALL_SERVICES,
          activeServices: dt.activeServices || ALL_SERVICES,
          isOnline: Boolean(dt.isOnline),
          location: dt.location,
          currentOrderId: dt.currentOrderId,
          coins: Number(dt.coins) || 0,
          walletBalance: Number(dt.walletBalance) || 0,
          cashRemitted: Number(dt.cashRemitted) || 0,
          rating: Number(dt.rating) || 5,
          ridesThisMonth: Number(dt.ridesThisMonth) || 0,
          createdAt: dt.createdAt
        });
      });
      list.sort((a, b) => a.name.localeCompare(b.name));
      setRiders(list);
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRiders();
  }, []);

  // Sync rider details when selected
  useEffect(() => {
    if (!selectedRider) return;
    setName(selectedRider.name || '');
    setPhone(selectedRider.phone || '');
    setEmail(selectedRider.email || '');
    setPhotoUrl(selectedRider.photoUrl || '');
    setRiderCode(selectedRider.riderCode || '');
    setCityId(selectedRider.cityId || '');
    setVehicleType(selectedRider.vehicleType || 'Motorcycle');
    setVehicleModel(selectedRider.vehicleModel || '');
    setPlate(selectedRider.plate || '');

    fetchRiderSubData(selectedRider.id);
  }, [selectedRider]);

  const fetchRiderSubData = async (riderId: string) => {
    try {
      // 1. Orders
      const qOrders = query(collection(db, 'orders'), where('riderId', '==', riderId), limit(150));
      const ordSnap = await getDocs(qOrders);
      const ords: Order[] = [];
      ordSnap.forEach((d) => {
        const dt = d.data();
        ords.push({
          id: d.id,
          orderNumber: dt.orderNumber || d.id.substring(0, 8),
          serviceType: dt.serviceType,
          customerId: dt.customerId,
          customerName: dt.customerName,
          status: dt.status,
          statusHistory: dt.statusHistory || [],
          fees: dt.fees || { subtotal: 0, deliveryFee: 0, serviceFee: 0, discount: 0, total: 0 },
          riderEarning: dt.riderEarning,
          codCollected: dt.codCollected || 0,
          paymentMethod: dt.paymentMethod,
          createdAt: dt.createdAt
        });
      });
      ords.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setRiderOrders(ords);

      // 2. Remittances
      const qRemit = query(collection(db, 'cashRemittances'), where('riderId', '==', riderId), limit(50));
      const remitSnap = await getDocs(qRemit);
      const remits: any[] = [];
      remitSnap.forEach((d) => remits.push({ id: d.id, ...d.data() }));
      remits.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setRemittancesList(remits);

      // 3. Wallet transactions
      const qTx = query(collection(db, 'walletTransactions'), where('riderId', '==', riderId), limit(50));
      const txSnap = await getDocs(qTx);
      const txns: any[] = [];
      txSnap.forEach((d) => txns.push({ id: d.id, ...d.data() }));
      txns.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setWalletTxns(txns);

      // 4. Tier events
      const qTier = query(collection(db, 'tierEvents'), where('riderId', '==', riderId), limit(50));
      const tierSnap = await getDocs(qTier);
      const tiers: TierEvent[] = [];
      tierSnap.forEach((d) => tiers.push({ id: d.id, ...d.data() } as TierEvent));
      setTierEvents(tiers);

      // 5. Edit History
      const qHist = query(collection(db, 'editHistory'), where('entityId', '==', riderId), limit(50));
      const histSnap = await getDocs(qHist);
      const hList: EditHistoryEntry[] = [];
      histSnap.forEach((d) => hList.push({ id: d.id, ...d.data() } as EditHistoryEntry));
      hList.sort((a, b) => (b.at?.seconds || 0) - (a.at?.seconds || 0));
      setEditHistory(hList);
    } catch (err) {
      console.error('Failed to load rider sub data:', err);
    }
  };

  // Filter riders
  const filteredRiders = useMemo(() => {
    return riders.filter((r) => {
      if (selectedCityId !== 'all' && r.cityId && r.cityId !== selectedCityId) return false;
      if (onlineFilter === 'online' && !r.isOnline) return false;
      if (onlineFilter === 'offline' && r.isOnline) return false;
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (vehicleFilter !== 'all' && r.vehicleType !== vehicleFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const n = (r.name || '').toLowerCase();
        const p = (r.phone || '').toLowerCase();
        const c = (r.riderCode || '').toLowerCase();
        if (!n.includes(q) && !p.includes(q) && !c.includes(q)) return false;
      }
      return true;
    });
  }, [riders, selectedCityId, onlineFilter, statusFilter, vehicleFilter, searchQuery]);

  const onlineCount = useMemo(() => riders.filter((r) => r.isOnline).length, [riders]);

  // Action: Save Details
  const handleSaveDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRider) return;
    try {
      setSavingDetails(true);
      const rRef = doc(db, 'riders', selectedRider.id);
      const updates = {
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim(),
        photoUrl: photoUrl.trim(),
        riderCode: riderCode.trim(),
        cityId,
        vehicleType,
        vehicleModel: vehicleModel.trim(),
        plate: plate.trim(),
        updatedAt: Timestamp.now()
      };

      await updateDoc(rRef, updates);

      // Track edit history
      const old = selectedRider;
      for (const k of ['name', 'phone', 'email', 'vehicleType', 'plate'] as const) {
        if ((old[k] as any) !== (updates[k] as any)) {
          await logEditHistory({
            entityType: 'rider',
            entityId: selectedRider.id,
            field: k,
            oldValue: old[k],
            newValue: updates[k],
            editedBy: adminProfile?.uid || 'admin',
            editedByName: adminProfile?.name || 'Administrator'
          });
        }
      }

      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        action: 'EDIT_RIDER_DETAILS',
        entityType: 'rider',
        entityId: selectedRider.id,
        details: `Updated rider profile for ${name}`
      });

      showSuccess('Rider details saved.');
      setSelectedRider((prev) => (prev ? { ...prev, ...updates } : null));
      setRiders((prev) => prev.map((r) => (r.id === selectedRider.id ? { ...r, ...updates } : r)));
    } catch (err: any) {
      showError(err);
    } finally {
      setSavingDetails(false);
    }
  };

  // Action: Suspend / Restore Rider
  const handleToggleSuspend = async () => {
    if (!selectedRider) return;
    try {
      const isSuspended = selectedRider.status === 'suspended';
      const newStatus = isSuspended ? 'active' : 'suspended';

      const batch = writeBatch(db);
      const rRef = doc(db, 'riders', selectedRider.id);
      const uRef = doc(db, 'users', selectedRider.id);

      batch.update(rRef, {
        status: newStatus,
        isOnline: isSuspended ? selectedRider.isOnline : false
      });
      batch.update(uRef, { status: newStatus });

      await batch.commit();

      showSuccess(`Rider marked as ${newStatus}.`);
      setSelectedRider((prev) =>
        prev ? { ...prev, status: newStatus, isOnline: isSuspended ? prev.isOnline : false } : null
      );
      setRiders((prev) =>
        prev.map((r) =>
          r.id === selectedRider.id
            ? { ...r, status: newStatus, isOnline: isSuspended ? r.isOnline : false }
            : r
        )
      );
    } catch (err: any) {
      showError(err);
    }
  };

  // Action: Toggle Allowed Services
  const handleToggleService = async (service: OrderServiceType) => {
    if (!selectedRider) return;
    try {
      let allowed = [...(selectedRider.allowedServices || [])];
      let active = [...(selectedRider.activeServices || [])];

      if (allowed.includes(service)) {
        // Remove service from both
        allowed = allowed.filter((s) => s !== service);
        active = active.filter((s) => s !== service);
      } else {
        allowed.push(service);
        active.push(service);
      }

      const rRef = doc(db, 'riders', selectedRider.id);
      await updateDoc(rRef, {
        allowedServices: allowed,
        activeServices: active,
        updatedAt: Timestamp.now()
      });

      showSuccess(`Updated enabled services for ${selectedRider.name}.`);
      setSelectedRider((prev) =>
        prev ? { ...prev, allowedServices: allowed, activeServices: active } : null
      );
    } catch (err: any) {
      showError(err);
    }
  };

  // Action: Record Remittance (Batch)
  const handleRecordRemittance = async () => {
    if (!selectedRider || remitAmount <= 0) return;
    try {
      setRecordingRemittance(true);
      const batch = writeBatch(db);

      const remitCol = collection(db, 'cashRemittances');
      const newRemitRef = doc(remitCol);

      batch.set(newRemitRef, {
        riderId: selectedRider.id,
        riderName: selectedRider.name,
        amount: Number(remitAmount),
        note: remitNote.trim(),
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        createdAt: Timestamp.now()
      });

      const rRef = doc(db, 'riders', selectedRider.id);
      batch.update(rRef, {
        cashRemitted: increment(Number(remitAmount))
      });

      await batch.commit();

      showSuccess(`Recorded remittance of ₱${remitAmount.toFixed(2)}.`);
      setRemitAmount(0);
      setRemitNote('');
      fetchRiders();
      fetchRiderSubData(selectedRider.id);
    } catch (err: any) {
      showError(err);
    } finally {
      setRecordingRemittance(false);
    }
  };

  // Action: Add Cash to Wallet (Batch)
  const handleAddWalletCash = async () => {
    if (!selectedRider || cashInAmount <= 0) return;
    try {
      setAddingCash(true);
      const batch = writeBatch(db);
      const newBal = (selectedRider.walletBalance || 0) + Number(cashInAmount);

      const txCol = collection(db, 'walletTransactions');
      const newTxRef = doc(txCol);

      batch.set(newTxRef, {
        riderId: selectedRider.id,
        amount: Number(cashInAmount),
        type: 'cash_in',
        note: cashInNote.trim() || 'Admin top-up',
        adminId: adminProfile?.uid || 'admin',
        balanceAfter: newBal,
        createdAt: Timestamp.now()
      });

      const rRef = doc(db, 'riders', selectedRider.id);
      batch.update(rRef, {
        walletBalance: increment(Number(cashInAmount))
      });

      await batch.commit();

      showSuccess(`Added ₱${cashInAmount.toFixed(2)} to rider wallet.`);
      setCashInAmount(0);
      setCashInNote('');
      fetchRiders();
      fetchRiderSubData(selectedRider.id);
    } catch (err: any) {
      showError(err);
    } finally {
      setAddingCash(false);
    }
  };

  // Action: Send Direct Inbox Message
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRider || !msgTitle.trim() || !msgBody.trim()) return;
    try {
      setSendingMsg(true);
      const inboxRef = collection(db, 'inbox');
      await addDoc(inboxRef, {
        riderId: selectedRider.id,
        riderName: selectedRider.name,
        audience: 'single_rider',
        title: msgTitle.trim(),
        body: msgBody.trim(),
        category: msgCategory,
        sentBy: adminProfile?.name || 'Administrator',
        createdAt: Timestamp.now()
      });

      showSuccess(`Dispatched message to ${selectedRider.name}.`);
      setMsgTitle('');
      setMsgBody('');
    } catch (err: any) {
      showError(err);
    } finally {
      setSendingMsg(false);
    }
  };

  // Financial calculations
  const totalNetEarnings = useMemo(() => {
    return riderOrders.reduce((acc, o) => acc + (Number(o.riderEarning?.net) || 0), 0);
  }, [riderOrders]);

  const totalCodCollected = useMemo(() => {
    return riderOrders.reduce((acc, o) => acc + (Number(o.codCollected) || 0), 0);
  }, [riderOrders]);

  const outstandingCash = Math.max(0, totalCodCollected - (selectedRider?.cashRemitted || 0));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">
            Rider Fleet Management
          </h1>
          <p className="text-sm text-gray-500 dark:text-zinc-400 mt-0.5">
            Active fleet: <strong>{onlineCount}</strong> online out of <strong>{riders.length}</strong> registered riders.
          </p>
        </div>

        <button
          onClick={() => {
            const rows = filteredRiders.map((r) => ({
              RiderCode: r.riderCode,
              Name: r.name,
              Phone: r.phone,
              Vehicle: r.vehicleType,
              Plate: r.plate,
              Status: r.status,
              IsOnline: r.isOnline ? 'Online' : 'Offline',
              WalletBalance: r.walletBalance,
              Coins: r.coins
            }));
            exportToCsv(`delivio_riders_${new Date().toISOString().slice(0, 10)}`, rows);
          }}
          className="flex items-center gap-2 px-3.5 py-2 rounded-xl border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-gray-700 dark:text-zinc-300 hover:bg-gray-50 text-xs font-bold shadow-xs self-start sm:self-auto"
        >
          <Download className="w-4 h-4" />
          <span>Export Riders</span>
        </button>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-4 shadow-xs">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3.5 top-3 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search rider name, phone, DLV code..."
              className="w-full pl-9 pr-4 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-amber-400"
            />
          </div>

          <div>
            <select
              value={onlineFilter}
              onChange={(e) => setOnlineFilter(e.target.value as any)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
            >
              <option value="all">All Telemetry States</option>
              <option value="online">Online Riders Only</option>
              <option value="offline">Offline</option>
            </select>
          </div>

          <div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
            >
              <option value="all">All Account Statuses</option>
              <option value="active">Active Accounts</option>
              <option value="suspended">Suspended Accounts</option>
            </select>
          </div>

          <div>
            <select
              value={vehicleFilter}
              onChange={(e) => setVehicleFilter(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
            >
              <option value="all">All Vehicle Types</option>
              <option value="Motorcycle">Motorcycle</option>
              <option value="Bicycle">Bicycle</option>
              <option value="Car">Car / Sedan</option>
              <option value="Van">Van / MPV</option>
            </select>
          </div>
        </div>
      </div>

      {/* Riders Table */}
      {loading ? (
        <TableSkeleton rows={8} cols={6} />
      ) : (
        <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 dark:bg-zinc-850/60 uppercase font-bold text-gray-500 dark:text-zinc-400 border-b border-gray-200 dark:border-zinc-800">
                <tr>
                  <th className="px-4 py-3.5">Rider</th>
                  <th className="px-4 py-3.5">Contact</th>
                  <th className="px-4 py-3.5">Vehicle</th>
                  <th className="px-4 py-3.5">Fleet Status</th>
                  <th className="px-4 py-3.5">Wallet / Coins</th>
                  <th className="px-4 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-zinc-800 font-medium">
                {filteredRiders.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-12 text-gray-400 text-xs">
                      No matching riders found.
                    </td>
                  </tr>
                ) : (
                  filteredRiders.map((r) => (
                    <tr
                      key={r.id}
                      onClick={() => setSelectedRider(r)}
                      className="hover:bg-amber-50/50 dark:hover:bg-zinc-800/50 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-amber-400 text-black font-extrabold flex items-center justify-center shrink-0 overflow-hidden">
                            {r.photoUrl ? (
                              <img src={r.photoUrl} alt={r.name} className="w-full h-full object-cover" />
                            ) : (
                              <span>{r.name.charAt(0)}</span>
                            )}
                          </div>
                          <div>
                            <div className="font-bold text-gray-900 dark:text-white flex items-center gap-1.5">
                              {r.name}
                              <span className="flex items-center text-[10px] text-amber-500 font-bold">
                                <Star className="w-3 h-3 fill-amber-400" /> {r.rating || 5}
                              </span>
                            </div>
                            <div className="text-[10px] text-gray-400 font-mono">
                              {r.riderCode}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-gray-900 dark:text-zinc-200">{r.phone}</div>
                        <div className="text-[10px] text-gray-400">{r.email}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-gray-900 dark:text-white">
                          {r.vehicleType}
                        </div>
                        <div className="text-[10px] text-gray-400 font-mono">
                          Plate: {r.plate || 'N/A'}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`w-2 h-2 rounded-full ${
                              r.isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-gray-400'
                            }`}
                          />
                          <span className="font-bold">
                            {r.status === 'suspended' ? 'Suspended' : r.isOnline ? 'Online' : 'Offline'}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-bold text-emerald-600">
                          ₱{Number(r.walletBalance || 0).toFixed(2)}
                        </div>
                        <div className="text-[10px] text-amber-500 font-bold">
                          {r.coins || 0} Coins
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedRider(r);
                          }}
                          className="px-2.5 py-1 rounded-lg text-xs font-bold text-amber-600 dark:text-amber-400 hover:bg-amber-50 transition-colors"
                        >
                          Manage &rarr;
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Selected Rider Detail Drawer */}
      {selectedRider && (
        <div className="fixed inset-0 z-50 overflow-hidden flex justify-end bg-black/60 backdrop-blur-xs">
          <div
            className="w-full max-w-3xl bg-white dark:bg-zinc-950 border-l border-gray-200 dark:border-zinc-800 shadow-2xl flex flex-col h-full animate-in slide-in-from-right duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-5 border-b border-gray-200 dark:border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-amber-400 text-black font-extrabold text-xl flex items-center justify-center overflow-hidden shrink-0">
                  {selectedRider.photoUrl ? (
                    <img src={selectedRider.photoUrl} alt={selectedRider.name} className="w-full h-full object-cover" />
                  ) : (
                    <span>{selectedRider.name.charAt(0)}</span>
                  )}
                </div>
                <div>
                  <h3 className="font-extrabold text-lg text-gray-900 dark:text-white flex items-center gap-2">
                    {selectedRider.name}
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        selectedRider.isOnline
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-gray-100 text-gray-700'
                      }`}
                    >
                      {selectedRider.isOnline ? 'Online' : 'Offline'}
                    </span>
                  </h3>
                  <p className="text-xs text-gray-400 font-mono">Code: {selectedRider.riderCode}</p>
                </div>
              </div>

              <button
                onClick={() => setSelectedRider(null)}
                className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Navigation Tabs */}
            <div className="flex border-b border-gray-200 dark:border-zinc-800 px-5 pt-2 overflow-x-auto">
              {[
                { id: 'details', label: 'Details' },
                { id: 'status', label: 'Status' },
                { id: 'services', label: 'Services' },
                { id: 'orders', label: `Orders (${riderOrders.length})` },
                { id: 'cash', label: 'Cash Collection' },
                { id: 'wallet', label: 'Wallet & Cash-In' },
                { id: 'tiers', label: 'Tiers & Coins' },
                { id: 'inbox', label: 'Send Message' },
                { id: 'history', label: 'Edit History' }
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`pb-3 text-xs font-bold border-b-2 mr-5 whitespace-nowrap transition-colors ${
                    activeTab === tab.id
                      ? 'border-amber-500 text-amber-600 dark:text-amber-400'
                      : 'border-transparent text-gray-500 hover:text-gray-900 dark:hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab Contents */}
            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              {/* TAB 1: DETAILS */}
              {activeTab === 'details' && (
                <form onSubmit={handleSaveDetails} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                        Full Name
                      </label>
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                        className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-gray-900 dark:text-white"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                        Rider ID / Code
                      </label>
                      <input
                        type="text"
                        value={riderCode}
                        onChange={(e) => setRiderCode(e.target.value)}
                        required
                        className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-mono text-gray-900 dark:text-white"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                        Contact Phone
                      </label>
                      <input
                        type="text"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-gray-900 dark:text-white"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                        Assigned City
                      </label>
                      <select
                        value={cityId}
                        onChange={(e) => setCityId(e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-gray-900 dark:text-white"
                      >
                        <option value="">Select City</option>
                        {cities.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                        Vehicle Type
                      </label>
                      <select
                        value={vehicleType}
                        onChange={(e) => setVehicleType(e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-gray-900 dark:text-white"
                      >
                        <option value="Motorcycle">Motorcycle</option>
                        <option value="Bicycle">Bicycle</option>
                        <option value="Car">Car</option>
                        <option value="Van">Van</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                        Plate Number
                      </label>
                      <input
                        type="text"
                        value={plate}
                        onChange={(e) => setPlate(e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-mono text-gray-900 dark:text-white"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                      Email Address
                    </label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-gray-900 dark:text-white"
                    />
                    <div className="mt-1.5 p-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 flex items-start gap-1.5 text-[11px] text-amber-800 dark:text-amber-300">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
                      <span>This does not change the rider's login email.</span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                      Photo URL
                    </label>
                    <input
                      type="url"
                      value={photoUrl}
                      onChange={(e) => setPhotoUrl(e.target.value)}
                      placeholder="https://..."
                      className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-gray-900 dark:text-white"
                    />
                  </div>

                  <div className="flex justify-end pt-2">
                    <button
                      type="submit"
                      disabled={savingDetails}
                      className="delivio-btn-yellow px-5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2"
                    >
                      {savingDetails && <Loader2 className="w-4 h-4 animate-spin" />}
                      Save Rider Details
                    </button>
                  </div>
                </form>
              )}

              {/* TAB 2: STATUS */}
              {activeTab === 'status' && (
                <div className="space-y-4">
                  <div className="p-4 rounded-2xl border border-red-200 dark:border-red-900/60 bg-red-50/50 dark:bg-red-950/20 flex items-center justify-between">
                    <div>
                      <div className="font-bold text-sm text-red-900 dark:text-red-300">
                        Rider Operational Status
                      </div>
                      <p className="text-xs text-red-700/80 dark:text-red-400/80">
                        Suspending marks the rider and account as suspended and forces isOnline to false.
                      </p>
                    </div>
                    <button
                      onClick={handleToggleSuspend}
                      className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
                        selectedRider.status === 'suspended'
                          ? 'bg-emerald-600 text-white'
                          : 'bg-red-600 text-white hover:bg-red-700'
                      }`}
                    >
                      {selectedRider.status === 'suspended' ? 'Restore Rider' : 'Suspend Rider'}
                    </button>
                  </div>
                </div>
              )}

              {/* TAB 3: SERVICES */}
              {activeTab === 'services' && (
                <div className="space-y-4">
                  <p className="text-xs text-gray-500">
                    Control which services this rider is qualified and eligible to receive on the road:
                  </p>

                  <div className="space-y-2">
                    {ALL_SERVICES.map((srv) => {
                      const isAllowed = (selectedRider.allowedServices || []).includes(srv);
                      return (
                        <div
                          key={srv}
                          className="flex items-center justify-between p-3.5 rounded-xl border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs"
                        >
                          <span className="font-bold uppercase tracking-wider text-gray-800 dark:text-zinc-200">
                            {srv.replace('_', ' ')}
                          </span>
                          <button
                            onClick={() => handleToggleService(srv)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                              isAllowed
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                : 'bg-gray-200 text-gray-600 dark:bg-zinc-800 dark:text-zinc-400'
                            }`}
                          >
                            {isAllowed ? 'Enabled' : 'Disabled'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* TAB 4: ORDERS & EARNINGS */}
              {activeTab === 'orders' && (
                <div className="space-y-4">
                  <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 flex items-center justify-between">
                    <div>
                      <span className="text-xs uppercase font-bold text-amber-800 dark:text-amber-300">
                        Total Net Rider Earnings
                      </span>
                      <div className="text-xl font-black text-amber-600 mt-1">
                        ₱{totalNetEarnings.toFixed(2)}
                      </div>
                    </div>

                    <button
                      onClick={() => {
                        const rows = riderOrders.map((o) => ({
                          OrderNumber: o.orderNumber,
                          Service: o.serviceType,
                          Status: o.status,
                          Customer: o.customerName,
                          NetEarning: o.riderEarning?.net || 0,
                          CODCollected: o.codCollected || 0,
                          Date: formatTimestamp(o.createdAt)
                        }));
                        exportToCsv(`${selectedRider.name}_orders`, rows);
                      }}
                      className="delivio-btn-yellow px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1"
                    >
                      <Download className="w-3.5 h-3.5" /> Export Orders
                    </button>
                  </div>

                  <div className="space-y-2">
                    {riderOrders.map((ord) => (
                      <div
                        key={ord.id}
                        className="p-3 rounded-xl border border-gray-100 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-900 flex justify-between text-xs"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-gray-900 dark:text-white">
                              #{ord.orderNumber}
                            </span>
                            <span className="capitalize px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-gray-200 dark:bg-zinc-800">
                              {ord.serviceType}
                            </span>
                          </div>
                          <p className="text-[11px] text-gray-500 mt-0.5">
                            Customer: {ord.customerName}
                          </p>
                        </div>
                        <div className="text-right">
                          <span className="font-bold text-emerald-600">
                            +₱{Number(ord.riderEarning?.net || 0).toFixed(2)}
                          </span>
                          <div className="text-[10px] text-gray-400">
                            {formatRelativeTime(ord.createdAt)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* TAB 5: CASH COLLECTION */}
              {activeTab === 'cash' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="p-3.5 rounded-xl bg-gray-50 dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 text-xs">
                      <span className="text-gray-500 uppercase text-[10px] font-bold">
                        COD Collected
                      </span>
                      <div className="text-base font-bold text-gray-900 dark:text-white mt-1">
                        ₱{totalCodCollected.toFixed(2)}
                      </div>
                    </div>
                    <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 text-xs">
                      <span className="text-emerald-800 dark:text-emerald-300 uppercase text-[10px] font-bold">
                        Cash Remitted
                      </span>
                      <div className="text-base font-bold text-emerald-600 mt-1">
                        ₱{Number(selectedRider.cashRemitted || 0).toFixed(2)}
                      </div>
                    </div>
                    <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 text-xs">
                      <span className="text-red-800 dark:text-red-300 uppercase text-[10px] font-bold">
                        Outstanding Cash
                      </span>
                      <div className="text-base font-bold text-red-600 mt-1">
                        ₱{outstandingCash.toFixed(2)}
                      </div>
                    </div>
                  </div>

                  {/* Record Remittance */}
                  <div className="p-4 rounded-2xl bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 space-y-3">
                    <span className="text-xs font-bold uppercase text-gray-700 dark:text-zinc-300 block">
                      Record In-Person Remittance
                    </span>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        min="1"
                        value={remitAmount}
                        onChange={(e) => setRemitAmount(Number(e.target.value))}
                        placeholder="Remitted Amount (₱)"
                        className="flex-1 px-3.5 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 font-bold text-gray-900 dark:text-white"
                      />
                      <input
                        type="text"
                        value={remitNote}
                        onChange={(e) => setRemitNote(e.target.value)}
                        placeholder="Receipt / Reference #"
                        className="flex-1 px-3.5 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                      />
                      <button
                        onClick={handleRecordRemittance}
                        disabled={recordingRemittance || remitAmount <= 0}
                        className="delivio-btn-yellow px-4 py-2 text-xs font-bold rounded-xl"
                      >
                        Record
                      </button>
                    </div>

                    {/* Past Remittances */}
                    <div className="space-y-1.5 pt-2">
                      {remittancesList.map((rm) => (
                        <div
                          key={rm.id}
                          className="flex items-center justify-between p-2 rounded-xl bg-white dark:bg-zinc-850 text-xs"
                        >
                          <div>
                            <span className="font-bold text-gray-900 dark:text-white">
                              ₱{Number(rm.amount).toFixed(2)}
                            </span>
                            <span className="text-gray-400 ml-2">
                              {formatTimestamp(rm.createdAt)}
                            </span>
                          </div>
                          <span className="text-gray-400 text-[11px]">{rm.note || 'Cash'}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 6: WALLET & CASH-IN */}
              {activeTab === 'wallet' && (
                <div className="space-y-4">
                  <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 flex justify-between items-center">
                    <div>
                      <span className="text-xs uppercase font-bold text-emerald-800 dark:text-emerald-300">
                        Current Rider Wallet Balance
                      </span>
                      <div className="text-2xl font-black text-emerald-600 mt-1">
                        ₱{Number(selectedRider.walletBalance || 0).toFixed(2)}
                      </div>
                    </div>
                  </div>

                  {/* Add Cash */}
                  <div className="p-4 rounded-2xl bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 space-y-3">
                    <span className="text-xs font-bold uppercase text-gray-700 dark:text-zinc-300 block">
                      Admin Cash Top-Up (Add Cash)
                    </span>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        min="1"
                        value={cashInAmount}
                        onChange={(e) => setCashInAmount(Number(e.target.value))}
                        placeholder="Top-up Amount (₱)"
                        className="flex-1 px-3.5 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 font-bold text-gray-900 dark:text-white"
                      />
                      <input
                        type="text"
                        value={cashInNote}
                        onChange={(e) => setCashInNote(e.target.value)}
                        placeholder="Reason (e.g. Over-the-counter deposit)"
                        className="flex-1 px-3.5 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                      />
                      <button
                        onClick={handleAddWalletCash}
                        disabled={addingCash || cashInAmount <= 0}
                        className="delivio-btn-yellow px-4 py-2 text-xs font-bold rounded-xl"
                      >
                        Add Cash
                      </button>
                    </div>

                    {/* Txn History */}
                    <div className="space-y-1.5 pt-2">
                      {walletTxns.map((tx) => (
                        <div
                          key={tx.id}
                          className="flex items-center justify-between p-2 rounded-xl bg-white dark:bg-zinc-850 text-xs"
                        >
                          <div>
                            <span className="font-bold text-emerald-600">
                              +₱{Number(tx.amount).toFixed(2)}
                            </span>
                            <span className="text-gray-400 ml-2">
                              {formatTimestamp(tx.createdAt)}
                            </span>
                          </div>
                          <span className="text-gray-400 text-[11px]">{tx.note}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 7: TIERS & COINS */}
              {activeTab === 'tiers' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200">
                      <span className="text-xs uppercase font-bold text-amber-800 dark:text-amber-300">
                        Coin Balance
                      </span>
                      <div className="text-2xl font-black text-amber-600 mt-1">
                        {selectedRider.coins || 0} Coins
                      </div>
                    </div>
                    <div className="p-4 rounded-2xl bg-purple-50 dark:bg-purple-950/30 border border-purple-200">
                      <span className="text-xs uppercase font-bold text-purple-800 dark:text-purple-300">
                        Rides Completed This Month
                      </span>
                      <div className="text-2xl font-black text-purple-600 mt-1">
                        {selectedRider.ridesThisMonth || 0}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <span className="text-xs font-bold uppercase text-gray-500">
                      Tier Milestones & Events
                    </span>
                    {tierEvents.map((te) => (
                      <div
                        key={te.id}
                        className="p-3 rounded-xl border border-gray-100 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-900 text-xs flex justify-between"
                      >
                        <div>
                          <span className="font-bold uppercase text-amber-600">
                            Tier: {te.tier}
                          </span>
                          <p className="text-[11px] text-gray-400">Month: {te.month}</p>
                        </div>
                        <div className="text-right">
                          <span className="font-bold">{te.coins} Coins</span>
                          <div className="text-[10px] text-emerald-600 font-bold">{te.status}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* TAB 8: INBOX */}
              {activeTab === 'inbox' && (
                <form onSubmit={handleSendMessage} className="space-y-3">
                  <p className="text-xs text-gray-500">
                    Send a push notification and inbox message directly to {selectedRider.name}'s
                    Delivio Rider app:
                  </p>

                  <div>
                    <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                      Message Category
                    </label>
                    <select
                      value={msgCategory}
                      onChange={(e) => setMsgCategory(e.target.value as any)}
                      className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                    >
                      <option value="admin">Admin Notice</option>
                      <option value="order">Order Coordination</option>
                      <option value="promo">Promo & Bonus</option>
                      <option value="safety">Safety Advisory</option>
                      <option value="system">System Notification</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                      Title
                    </label>
                    <input
                      type="text"
                      value={msgTitle}
                      onChange={(e) => setMsgTitle(e.target.value)}
                      required
                      placeholder="e.g. Schedule Update / Safety Reminder"
                      className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                      Message Body
                    </label>
                    <textarea
                      rows={4}
                      value={msgBody}
                      onChange={(e) => setMsgBody(e.target.value)}
                      required
                      placeholder="Type message content..."
                      className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                    />
                  </div>

                  <div className="flex justify-end pt-2">
                    <button
                      type="submit"
                      disabled={sendingMsg}
                      className="delivio-btn-yellow px-5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2"
                    >
                      {sendingMsg ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Send className="w-4 h-4" />
                      )}
                      Send Message
                    </button>
                  </div>
                </form>
              )}

              {/* TAB 9: EDIT HISTORY */}
              {activeTab === 'history' && (
                <div className="space-y-2">
                  {editHistory.length === 0 ? (
                    <div className="p-8 text-center text-xs text-gray-400">
                      No modifications logged for this rider.
                    </div>
                  ) : (
                    editHistory.map((entry, i) => (
                      <div
                        key={i}
                        className="p-3 rounded-xl bg-gray-50 dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 text-xs"
                      >
                        <div className="flex justify-between items-center mb-1">
                          <span className="font-bold uppercase text-amber-600 text-[10px]">
                            {entry.field}
                          </span>
                          <span className="text-gray-400 text-[10px]">
                            {formatTimestamp(entry.at)}
                          </span>
                        </div>
                        <div className="text-gray-700 dark:text-zinc-300">
                          Changed from "{String(entry.oldValue || 'none')}" to "
                          {String(entry.newValue)}"
                        </div>
                        <div className="text-[10px] text-gray-400 mt-1">
                          By: {entry.editedByName}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
