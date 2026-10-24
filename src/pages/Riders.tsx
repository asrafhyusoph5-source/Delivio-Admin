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
  Timestamp,
  runTransaction,
  getDoc
} from '../firebase';
import { useCity } from '../context/CityContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { logAuditEvent, logEditHistory } from '../utils/audit';
import { exportToCsv } from '../utils/exportCsv';
import { formatTimestamp, formatRelativeTime } from '../utils/date';
import type { Rider, Order, OrderServiceType, EditHistoryEntry, TierEvent, UserProfile, WalletTransaction } from '../types';
import {
  VehicleType,
  VEHICLE_TYPES,
  VEHICLE_LABELS,
  SERVICES_BY_VEHICLE,
  ALL_SERVICES
} from '../constants';
import {
  Search,
  Bike,
  Car,
  Bus,
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
  MinusCircle,
  Award,
  Link2,
  Unlink,
  User,
  Users,
  Wallet
} from 'lucide-react';
import { TableSkeleton } from '../components/common/SkeletonLoader';
import { ConfirmationModal } from '../components/common/ConfirmationModal';

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
  const [vehicleType, setVehicleType] = useState<VehicleType>('motorcycle');
  const [vehicleModel, setVehicleModel] = useState('');
  const [vehicleColor, setVehicleColor] = useState('');
  const [seats, setSeats] = useState<number>(1);
  const [plate, setPlate] = useState('');
  const [savingDetails, setSavingDetails] = useState(false);
  const [vehicleConfirmModalOpen, setVehicleConfirmModalOpen] = useState(false);
  const [pendingVehicleType, setPendingVehicleType] = useState<VehicleType | null>(null);

  // Orders & Earnings
  const [riderOrders, setRiderOrders] = useState<Order[]>([]);

  // Cash Remittance
  const [remitAmount, setRemitAmount] = useState<number>(0);
  const [remitNote, setRemitNote] = useState('');
  const [recordingRemittance, setRecordingRemittance] = useState(false);
  const [remittancesList, setRemittancesList] = useState<any[]>([]);

  // Wallet Cash-in & Adjust
  const [cashInAmount, setCashInAmount] = useState<number>(0);
  const [cashInNote, setCashInNote] = useState('');
  const [addingCash, setAddingCash] = useState(false);
  const [adjustAmount, setAdjustAmount] = useState<number>(0);
  const [adjustReason, setAdjustReason] = useState('');
  const [submittingAdjust, setSubmittingAdjust] = useState(false);
  const [adjustModalOpen, setAdjustModalOpen] = useState(false);
  const [walletTxns, setWalletTxns] = useState<any[]>([]);

  // Linked Customer & Merged Wallet
  const [linkedCustomer, setLinkedCustomer] = useState<UserProfile | null>(null);
  const [loadingLinkedCustomer, setLoadingLinkedCustomer] = useState(false);
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [customerSearchQuery, setCustomerSearchQuery] = useState('');
  const [allCustomers, setAllCustomers] = useState<UserProfile[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [selectedCandidateCustomer, setSelectedCandidateCustomer] = useState<UserProfile | null>(null);
  const [confirmMergeModalOpen, setConfirmMergeModalOpen] = useState(false);
  const [linking, setLinking] = useState(false);
  const [unlinkModalOpen, setUnlinkModalOpen] = useState(false);
  const [unlinkReason, setUnlinkReason] = useState('');
  const [unlinking, setUnlinking] = useState(false);

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
        const rawType = (dt.vehicleType || 'motorcycle').toLowerCase();
        const vType: VehicleType =
          rawType === 'tricycle'
            ? 'tricycle'
            : rawType === 'car4' || rawType === 'car' || rawType === '4-seater car'
            ? 'car4'
            : rawType === 'car8' || rawType === 'van' || rawType === '8-seater car'
            ? 'car8'
            : 'motorcycle';

        const defaultSeats = VEHICLE_TYPES.find((v) => v.id === vType)?.defaultSeats || 1;

        list.push({
          id: d.id,
          name: dt.name || 'Driver',
          email: dt.email || '',
          phone: dt.phone || '',
          photoUrl: dt.photoUrl || '',
          riderCode: dt.riderCode || d.id.substring(0, 8),
          status: dt.status || 'active',
          cityId: dt.cityId,
          vehicleType: vType,
          vehicleModel: dt.vehicleModel || '',
          vehicleColor: dt.vehicleColor || '',
          seats: Number(dt.seats) || defaultSeats,
          plate: dt.plate || '',
          allowedServices: dt.allowedServices || SERVICES_BY_VEHICLE[vType],
          activeServices: dt.activeServices || SERVICES_BY_VEHICLE[vType],
          isOnline: Boolean(dt.isOnline),
          location: dt.location,
          currentOrderId: dt.currentOrderId,
          coins: Number(dt.coins) || 0,
          walletBalance: Number(dt.walletBalance) || 0,
          cashRemitted: Number(dt.cashRemitted) || 0,
          rating: Number(dt.rating) || 5,
          ridesThisMonth: Number(dt.ridesThisMonth) || 0,
          linkedCustomerUid: dt.linkedCustomerUid || null,
          linkedCustomerEmail: dt.linkedCustomerEmail || null,
          linkedCustomerName: dt.linkedCustomerName || null,
          linkedAt: dt.linkedAt || null,
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
    const vType = (selectedRider.vehicleType as VehicleType) || 'motorcycle';
    const defaultSeats = VEHICLE_TYPES.find((v) => v.id === vType)?.defaultSeats || 1;
    setName(selectedRider.name || '');
    setPhone(selectedRider.phone || '');
    setEmail(selectedRider.email || '');
    setPhotoUrl(selectedRider.photoUrl || '');
    setRiderCode(selectedRider.riderCode || '');
    setCityId(selectedRider.cityId || '');
    setVehicleType(vType);
    setVehicleModel(selectedRider.vehicleModel || '');
    setVehicleColor(selectedRider.vehicleColor || '');
    setSeats(Number(selectedRider.seats) || defaultSeats);
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

      // 3. Wallet transactions (riderId and customerId if linked)
      let allTxns: any[] = [];
      const qTx = query(collection(db, 'walletTransactions'), where('riderId', '==', riderId), limit(50));
      const txSnap = await getDocs(qTx);
      txSnap.forEach((d) => allTxns.push({ id: d.id, ...d.data() }));

      // Find current rider object
      const riderObj = riders.find((r) => r.id === riderId) || selectedRider;
      if (riderObj?.linkedCustomerUid) {
        try {
          const qCustTx = query(
            collection(db, 'walletTransactions'),
            where('customerId', '==', riderObj.linkedCustomerUid),
            limit(50)
          );
          const custTxSnap = await getDocs(qCustTx);
          const seenIds = new Set(allTxns.map((t) => t.id));
          custTxSnap.forEach((d) => {
            if (!seenIds.has(d.id)) {
              allTxns.push({ id: d.id, ...d.data() });
            }
          });
        } catch (e) {
          console.error('Failed to load linked customer wallet transactions:', e);
        }
      }
      allTxns.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setWalletTxns(allTxns);

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

      // 6. Linked customer data if any
      if (riderObj?.linkedCustomerUid) {
        setLoadingLinkedCustomer(true);
        try {
          const custSnap = await getDoc(doc(db, 'users', riderObj.linkedCustomerUid));
          if (custSnap.exists()) {
            const cData = custSnap.data();
            setLinkedCustomer({
              uid: custSnap.id,
              role: cData.role || 'customer',
              email: cData.email || '',
              name: cData.name || 'Customer',
              phone: cData.phone || '',
              walletBalance: Number(cData.walletBalance || 0),
              status: cData.status || 'active'
            });
          } else {
            setLinkedCustomer(null);
          }
        } catch (e) {
          console.error('Failed to fetch linked customer:', e);
          setLinkedCustomer(null);
        } finally {
          setLoadingLinkedCustomer(false);
        }
      } else {
        setLinkedCustomer(null);
      }
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
      if (vehicleFilter !== 'all') {
        const vType = (r.vehicleType || 'motorcycle').toLowerCase();
        if (vType !== vehicleFilter.toLowerCase()) return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const n = (r.name || '').toLowerCase();
        const p = (r.phone || '').toLowerCase();
        const c = (r.riderCode || '').toLowerCase();
        const pl = (r.plate || '').toLowerCase();
        const m = (r.vehicleModel || '').toLowerCase();
        if (!n.includes(q) && !p.includes(q) && !c.includes(q) && !pl.includes(q) && !m.includes(q))
          return false;
      }
      return true;
    });
  }, [riders, selectedCityId, onlineFilter, statusFilter, vehicleFilter, searchQuery]);

  const onlineCount = useMemo(() => riders.filter((r) => r.isOnline).length, [riders]);

  // Filter registered customers for linking type-ahead
  const filteredCandidates = useMemo(() => {
    if (!customerSearchQuery.trim()) return allCustomers.slice(0, 10);
    const q = customerSearchQuery.toLowerCase().trim();
    return allCustomers
      .filter(
        (c) =>
          (c.email || '').toLowerCase().includes(q) ||
          (c.name || '').toLowerCase().includes(q) ||
          (c.phone || '').toLowerCase().includes(q)
      )
      .slice(0, 15);
  }, [allCustomers, customerSearchQuery]);

  // Handle vehicle type change request
  const handleSelectVehicleType = (newType: VehicleType) => {
    if (newType === vehicleType) return;
    setPendingVehicleType(newType);
    setVehicleConfirmModalOpen(true);
  };

  // Confirm vehicle type change and recompute services
  const confirmChangeVehicleType = async () => {
    if (!pendingVehicleType || !selectedRider) return;
    const newType = pendingVehicleType;
    const allowed = SERVICES_BY_VEHICLE[newType] || [];
    const active = (selectedRider.activeServices || []).filter((s) => allowed.includes(s));
    const defaultSeats = VEHICLE_TYPES.find((v) => v.id === newType)?.defaultSeats || 1;

    setVehicleType(newType);
    setSeats(defaultSeats);
    setVehicleConfirmModalOpen(false);

    try {
      const rRef = doc(db, 'riders', selectedRider.id);
      await updateDoc(rRef, {
        vehicleType: newType,
        allowedServices: allowed,
        activeServices: active,
        seats: defaultSeats,
        updatedAt: Timestamp.now()
      });

      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        action: 'CHANGE_DRIVER_VEHICLE_TYPE',
        entityType: 'rider',
        entityId: selectedRider.id,
        details: `Changed vehicle type to ${VEHICLE_LABELS[newType]} and recomputed allowed/active services.`
      });

      showSuccess(`Vehicle changed to ${VEHICLE_LABELS[newType]}. Services recomputed.`);
      setSelectedRider((prev) =>
        prev
          ? {
              ...prev,
              vehicleType: newType,
              allowedServices: allowed,
              activeServices: active,
              seats: defaultSeats
            }
          : null
      );
      setRiders((prev) =>
        prev.map((r) =>
          r.id === selectedRider.id
            ? {
                ...r,
                vehicleType: newType,
                allowedServices: allowed,
                activeServices: active,
                seats: defaultSeats
              }
            : r
        )
      );
    } catch (err: any) {
      showError(err);
    } finally {
      setPendingVehicleType(null);
    }
  };

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
        vehicleColor: vehicleColor.trim(),
        seats: Number(seats) || 1,
        plate: plate.trim(),
        updatedAt: Timestamp.now()
      };

      await updateDoc(rRef, updates);

      // Track edit history
      const old = selectedRider;
      for (const k of ['name', 'phone', 'email', 'vehicleType', 'plate', 'vehicleModel', 'vehicleColor'] as const) {
        if ((old[k as keyof Rider] as any) !== (updates[k as keyof typeof updates] as any)) {
          await logEditHistory({
            entityType: 'rider',
            entityId: selectedRider.id,
            field: k,
            oldValue: (old[k as keyof Rider] as any) || '',
            newValue: (updates[k as keyof typeof updates] as any) || '',
            editedBy: adminProfile?.uid || 'admin',
            editedByName: adminProfile?.name || 'Administrator'
          });
        }
      }

      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        action: 'EDIT_DRIVER_DETAILS',
        entityType: 'rider',
        entityId: selectedRider.id,
        details: `Updated driver profile for ${name}`
      });

      showSuccess('Driver details saved.');
      setSelectedRider((prev) => (prev ? { ...prev, ...updates } : null));
      setRiders((prev) => prev.map((r) => (r.id === selectedRider.id ? { ...r, ...updates } : r)));
    } catch (err: any) {
      showError(err);
    } finally {
      setSavingDetails(false);
    }
  };

  // Action: Suspend / Restore Driver
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

      showSuccess(`Driver marked as ${newStatus}.`);
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
        // Turning one off removes it from allowedServices AND removes it from activeServices
        allowed = allowed.filter((s) => s !== service);
        active = active.filter((s) => s !== service);
      } else {
        allowed.push(service);
      }

      const rRef = doc(db, 'riders', selectedRider.id);
      await updateDoc(rRef, {
        allowedServices: allowed,
        activeServices: active,
        updatedAt: Timestamp.now()
      });

      showSuccess(`Updated service status for ${selectedRider.name}.`);
      setSelectedRider((prev) =>
        prev ? { ...prev, allowedServices: allowed, activeServices: active } : null
      );
      setRiders((prev) =>
        prev.map((r) =>
          r.id === selectedRider.id ? { ...r, allowedServices: allowed, activeServices: active } : r
        )
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

  // Action: Open Link Modal and fetch registered customers
  const openLinkModal = async () => {
    setLinkModalOpen(true);
    setCustomerSearchQuery('');
    setSelectedCandidateCustomer(null);
    try {
      setLoadingCustomers(true);
      const qCust = query(collection(db, 'users'), where('role', '==', 'customer'), limit(150));
      const snap = await getDocs(qCust);
      const list: UserProfile[] = [];
      snap.forEach((d) => {
        const dt = d.data();
        list.push({
          uid: d.id,
          role: 'customer',
          email: dt.email || '',
          name: dt.name || 'Customer',
          phone: dt.phone || '',
          walletBalance: Number(dt.walletBalance || 0),
          status: dt.status || 'active'
        });
      });
      list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      setAllCustomers(list);
    } catch (err) {
      showError('Failed to load registered customers.');
    } finally {
      setLoadingCustomers(false);
    }
  };

  // Action: Confirm and Execute Wallet Link in ONE Transaction
  const handleConfirmLink = async () => {
    if (!selectedRider || !selectedCandidateCustomer) return;
    try {
      setLinking(true);

      // 1. Validate that the customer exists and has role "customer"
      const custDocRef = doc(db, 'users', selectedCandidateCustomer.uid);
      const custDocSnap = await getDoc(custDocRef);
      if (!custDocSnap.exists()) {
        throw new Error('Customer account does not exist.');
      }
      const custData = custDocSnap.data();
      if ((custData.role || '').toLowerCase() !== 'customer') {
        throw new Error(`Customer must have role "customer", found "${custData.role}".`);
      }

      // 2. Validate not linked to another rider (query riders where linkedCustomerUid == customerUid)
      const qCheck = query(
        collection(db, 'riders'),
        where('linkedCustomerUid', '==', selectedCandidateCustomer.uid)
      );
      const checkSnap = await getDocs(qCheck);
      const otherLinked = checkSnap.docs.filter((d) => d.id !== selectedRider.id);
      if (otherLinked.length > 0) {
        const otherData = otherLinked[0].data();
        throw new Error(
          `Customer ${selectedCandidateCustomer.email} is already linked to rider "${otherData.name || otherLinked[0].id}". A customer account cannot be linked to multiple riders.`
        );
      }

      // 3. ONE Transaction:
      // set riders/{rid} {linkedCustomerUid, linkedCustomerEmail, linkedCustomerName, linkedAt};
      // add riders.walletBalance into users/{cid}.walletBalance and set riders.walletBalance to 0;
      // write a walletTransactions entry type "merge" (riderId, customerId, amount);
      // write auditLogs.
      const riderRef = doc(db, 'riders', selectedRider.id);
      const now = Timestamp.now();
      const txnRef = doc(collection(db, 'walletTransactions'));

      let riderBal = 0;
      let custBal = 0;
      let mergedBal = 0;

      await runTransaction(db, async (transaction) => {
        const rSnap = await transaction.get(riderRef);
        if (!rSnap.exists()) throw new Error('Rider not found.');
        const cSnap = await transaction.get(custDocRef);
        if (!cSnap.exists()) throw new Error('Customer record not found.');

        riderBal = Number(rSnap.data()?.walletBalance || 0);
        custBal = Number(cSnap.data()?.walletBalance || 0);
        mergedBal = custBal + riderBal;

        // Set riders/{rid}
        transaction.update(riderRef, {
          linkedCustomerUid: selectedCandidateCustomer.uid,
          linkedCustomerEmail: selectedCandidateCustomer.email,
          linkedCustomerName: selectedCandidateCustomer.name,
          linkedAt: now,
          walletBalance: 0,
          updatedAt: now
        });

        // Add riders.walletBalance into users/{cid}.walletBalance and set riders.walletBalance to 0
        transaction.update(custDocRef, {
          walletBalance: mergedBal,
          updatedAt: now
        });

        // walletTransactions entry type "merge" (riderId, customerId, amount)
        transaction.set(txnRef, {
          type: 'merge',
          riderId: selectedRider.id,
          customerId: selectedCandidateCustomer.uid,
          amount: riderBal,
          note: `Merged rider wallet (₱${riderBal.toFixed(2)}) into shared customer account balance`,
          adminId: adminProfile?.uid || 'admin',
          adminName: adminProfile?.name || 'Administrator',
          balanceAfter: mergedBal,
          createdAt: now
        });
      });

      // Write auditLogs
      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        adminEmail: adminProfile?.email,
        action: 'LINK_RIDER_CUSTOMER_WALLET',
        entityType: 'rider',
        entityId: selectedRider.id,
        details: `Linked rider ${selectedRider.name} to customer account (${selectedCandidateCustomer.email}). Merged ₱${riderBal.toFixed(2)} into unified balance of ₱${mergedBal.toFixed(2)}.`,
        oldValue: { riderBalance: riderBal, customerBalance: custBal },
        newValue: { sharedBalance: mergedBal, linkedCustomerUid: selectedCandidateCustomer.uid }
      });

      showSuccess(`Rider and customer wallets merged successfully! Shared balance: ₱${mergedBal.toFixed(2)}.`);

      const updatedLinkedCustomer: UserProfile = {
        ...selectedCandidateCustomer,
        walletBalance: mergedBal
      };
      setLinkedCustomer(updatedLinkedCustomer);
      setSelectedRider((prev) =>
        prev
          ? {
              ...prev,
              linkedCustomerUid: selectedCandidateCustomer.uid,
              linkedCustomerEmail: selectedCandidateCustomer.email,
              linkedCustomerName: selectedCandidateCustomer.name,
              linkedAt: now,
              walletBalance: 0
            }
          : null
      );
      setRiders((prev) =>
        prev.map((r) =>
          r.id === selectedRider.id
            ? {
                ...r,
                linkedCustomerUid: selectedCandidateCustomer.uid,
                linkedCustomerEmail: selectedCandidateCustomer.email,
                linkedCustomerName: selectedCandidateCustomer.name,
                linkedAt: now,
                walletBalance: 0
              }
            : r
        )
      );

      setConfirmMergeModalOpen(false);
      setLinkModalOpen(false);
      setSelectedCandidateCustomer(null);
      fetchRiderSubData(selectedRider.id);
    } catch (err: any) {
      showError(err?.message || err);
    } finally {
      setLinking(false);
    }
  };

  // Action: Unlink Rider Wallet (reason required; balance stays on customer account)
  const handleUnlinkRider = async (customReason?: string) => {
    if (!selectedRider || !selectedRider.linkedCustomerUid) return;
    const reasonClean = (customReason || unlinkReason).trim();
    if (!reasonClean) {
      showError('A mandatory reason is required to unlink customer account.');
      return;
    }

    try {
      setUnlinking(true);
      const rRef = doc(db, 'riders', selectedRider.id);
      const prevCustEmail = selectedRider.linkedCustomerEmail;
      const prevCustUid = selectedRider.linkedCustomerUid;

      await updateDoc(rRef, {
        linkedCustomerUid: null,
        linkedCustomerEmail: null,
        linkedCustomerName: null,
        linkedAt: null,
        updatedAt: Timestamp.now()
      });

      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        action: 'UNLINK_RIDER_WALLET',
        entityType: 'rider',
        entityId: selectedRider.id,
        details: `Unlinked rider ${selectedRider.name} from customer (${prevCustEmail || prevCustUid}). Shared balance remains on customer account. Reason: ${reasonClean}`,
        reason: reasonClean
      });

      showSuccess('Rider unlinked from customer account. Balance remains on customer wallet.');
      setLinkedCustomer(null);
      setSelectedRider((prev) =>
        prev
          ? {
              ...prev,
              linkedCustomerUid: null,
              linkedCustomerEmail: null,
              linkedCustomerName: null,
              linkedAt: null
            }
          : null
      );
      setRiders((prev) =>
        prev.map((r) =>
          r.id === selectedRider.id
            ? {
                ...r,
                linkedCustomerUid: null,
                linkedCustomerEmail: null,
                linkedCustomerName: null,
                linkedAt: null
              }
            : r
        )
      );
      setUnlinkModalOpen(false);
      setUnlinkReason('');
      fetchRiderSubData(selectedRider.id);
    } catch (err: any) {
      showError(err?.message || err);
    } finally {
      setUnlinking(false);
    }
  };

  // Action: Add Cash to Wallet (ONE transaction)
  const handleAddWalletCash = async () => {
    if (!selectedRider || cashInAmount <= 0) return;
    try {
      setAddingCash(true);
      const now = Timestamp.now();
      const noteClean = cashInNote.trim() || 'Admin top-up';
      const txnRef = doc(collection(db, 'walletTransactions'));
      const isLinked = Boolean(selectedRider.linkedCustomerUid);

      let finalBal = 0;
      let oldBal = 0;

      if (isLinked && selectedRider.linkedCustomerUid) {
        // Change users/{cid}.walletBalance in ONE transaction
        const userRef = doc(db, 'users', selectedRider.linkedCustomerUid);
        await runTransaction(db, async (transaction) => {
          const uSnap = await transaction.get(userRef);
          oldBal = uSnap.exists() ? Number(uSnap.data()?.walletBalance || 0) : 0;
          finalBal = oldBal + Number(cashInAmount);

          transaction.update(userRef, {
            walletBalance: finalBal,
            updatedAt: now
          });

          // Every walletTransactions entry carries both riderId and customerId
          transaction.set(txnRef, {
            riderId: selectedRider.id,
            customerId: selectedRider.linkedCustomerUid,
            amount: Number(cashInAmount),
            type: 'cash_in',
            note: noteClean,
            adminId: adminProfile?.uid || 'admin',
            adminName: adminProfile?.name || 'Administrator',
            balanceAfter: finalBal,
            createdAt: now
          });
        });

        setLinkedCustomer((prev) => (prev ? { ...prev, walletBalance: finalBal } : null));
      } else {
        // Unlinked rider wallet
        const rRef = doc(db, 'riders', selectedRider.id);
        await runTransaction(db, async (transaction) => {
          const rSnap = await transaction.get(rRef);
          oldBal = rSnap.exists() ? Number(rSnap.data()?.walletBalance || 0) : 0;
          finalBal = oldBal + Number(cashInAmount);

          transaction.update(rRef, {
            walletBalance: finalBal,
            updatedAt: now
          });

          transaction.set(txnRef, {
            riderId: selectedRider.id,
            amount: Number(cashInAmount),
            type: 'cash_in',
            note: noteClean,
            adminId: adminProfile?.uid || 'admin',
            adminName: adminProfile?.name || 'Administrator',
            balanceAfter: finalBal,
            createdAt: now
          });
        });

        setSelectedRider((prev) => (prev ? { ...prev, walletBalance: finalBal } : null));
      }

      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        action: 'RIDER_WALLET_ADD_CASH',
        entityType: 'rider',
        entityId: selectedRider.id,
        details: `Credited ₱${Number(cashInAmount).toFixed(2)} to ${isLinked ? 'shared customer wallet (' + selectedRider.linkedCustomerEmail + ')' : 'rider wallet'}. Note: ${noteClean}`,
        oldValue: { walletBalance: oldBal },
        newValue: { walletBalance: finalBal }
      });

      showSuccess(`Added ₱${Number(cashInAmount).toFixed(2)} to wallet.`);
      setCashInAmount(0);
      setCashInNote('');
      fetchRiderSubData(selectedRider.id);
    } catch (err: any) {
      showError(err);
    } finally {
      setAddingCash(false);
    }
  };

  // Action: Adjust / Deduct from Wallet (ONE transaction)
  const handleAdjustWalletCash = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRider || adjustAmount <= 0) return;
    const reasonClean = adjustReason.trim();
    if (!reasonClean) {
      showError('A mandatory reason is required to adjust or deduct wallet balance.');
      return;
    }

    try {
      setSubmittingAdjust(true);
      const now = Timestamp.now();
      const txnRef = doc(collection(db, 'walletTransactions'));
      const isLinked = Boolean(selectedRider.linkedCustomerUid);

      let finalBal = 0;
      let oldBal = 0;

      if (isLinked && selectedRider.linkedCustomerUid) {
        const userRef = doc(db, 'users', selectedRider.linkedCustomerUid);
        await runTransaction(db, async (transaction) => {
          const uSnap = await transaction.get(userRef);
          oldBal = uSnap.exists() ? Number(uSnap.data()?.walletBalance || 0) : 0;
          if (adjustAmount > oldBal) {
            throw new Error(`Cannot deduct ₱${adjustAmount.toFixed(2)}. Shared balance is only ₱${oldBal.toFixed(2)}.`);
          }
          finalBal = oldBal - adjustAmount;

          transaction.update(userRef, {
            walletBalance: finalBal,
            updatedAt: now
          });

          // Every walletTransactions entry carries both riderId and customerId
          transaction.set(txnRef, {
            riderId: selectedRider.id,
            customerId: selectedRider.linkedCustomerUid,
            amount: -adjustAmount,
            type: 'adjustment',
            note: reasonClean,
            reason: reasonClean,
            adminId: adminProfile?.uid || 'admin',
            adminName: adminProfile?.name || 'Administrator',
            balanceAfter: finalBal,
            createdAt: now
          });
        });

        setLinkedCustomer((prev) => (prev ? { ...prev, walletBalance: finalBal } : null));
      } else {
        const rRef = doc(db, 'riders', selectedRider.id);
        await runTransaction(db, async (transaction) => {
          const rSnap = await transaction.get(rRef);
          oldBal = rSnap.exists() ? Number(rSnap.data()?.walletBalance || 0) : 0;
          if (adjustAmount > oldBal) {
            throw new Error(`Cannot deduct ₱${adjustAmount.toFixed(2)}. Rider balance is only ₱${oldBal.toFixed(2)}.`);
          }
          finalBal = oldBal - adjustAmount;

          transaction.update(rRef, {
            walletBalance: finalBal,
            updatedAt: now
          });

          transaction.set(txnRef, {
            riderId: selectedRider.id,
            amount: -adjustAmount,
            type: 'adjustment',
            note: reasonClean,
            reason: reasonClean,
            adminId: adminProfile?.uid || 'admin',
            adminName: adminProfile?.name || 'Administrator',
            balanceAfter: finalBal,
            createdAt: now
          });
        });

        setSelectedRider((prev) => (prev ? { ...prev, walletBalance: finalBal } : null));
      }

      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        action: 'RIDER_WALLET_ADJUST',
        entityType: 'rider',
        entityId: selectedRider.id,
        details: `Deducted ₱${Number(adjustAmount).toFixed(2)} from ${isLinked ? 'shared customer wallet' : 'rider wallet'}. Reason: ${reasonClean}`,
        oldValue: { walletBalance: oldBal },
        newValue: { walletBalance: finalBal },
        reason: reasonClean
      });

      showSuccess(`Deducted ₱${Number(adjustAmount).toFixed(2)} successfully.`);
      setAdjustAmount(0);
      setAdjustReason('');
      setAdjustModalOpen(false);
      fetchRiderSubData(selectedRider.id);
    } catch (err: any) {
      showError(err);
    } finally {
      setSubmittingAdjust(false);
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
            Driver Fleet Management
          </h1>
          <p className="text-sm text-gray-500 dark:text-zinc-400 mt-0.5">
            Active fleet: <strong>{onlineCount}</strong> online out of <strong>{riders.length}</strong> registered drivers.
          </p>
        </div>

        <button
          onClick={() => {
            const rows = filteredRiders.map((r) => ({
              DriverCode: r.riderCode,
              Name: r.name,
              Phone: r.phone,
              VehicleType: r.vehicleType,
              Model: r.vehicleModel,
              Color: r.vehicleColor,
              Seats: r.seats,
              Plate: r.plate,
              Status: r.status,
              IsOnline: r.isOnline ? 'Online' : 'Offline',
              WalletBalance: r.walletBalance,
              Coins: r.coins
            }));
            exportToCsv(`delivio_drivers_${new Date().toISOString().slice(0, 10)}`, rows);
          }}
          className="flex items-center gap-2 px-3.5 py-2 rounded-xl border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-gray-700 dark:text-zinc-300 hover:bg-gray-50 text-xs font-bold shadow-xs self-start sm:self-auto"
        >
          <Download className="w-4 h-4" />
          <span>Export Drivers</span>
        </button>
      </div>

      {/* Vehicle-Type Filter with Online / Total Count Chips */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setVehicleFilter('all')}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
            vehicleFilter === 'all'
              ? 'bg-amber-400 text-black shadow-xs font-extrabold'
              : 'bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 text-gray-700 dark:text-zinc-300 hover:bg-gray-50'
          }`}
        >
          <span>All Vehicles</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-black/10 dark:bg-white/10 font-bold">
            {onlineCount}/{riders.length}
          </span>
        </button>

        {VEHICLE_TYPES.map((v) => {
          const totalForV = riders.filter(
            (r) => (r.vehicleType || 'motorcycle').toLowerCase() === v.id
          ).length;
          const onlineForV = riders.filter(
            (r) => (r.vehicleType || 'motorcycle').toLowerCase() === v.id && r.isOnline
          ).length;

          return (
            <button
              key={v.id}
              onClick={() => setVehicleFilter(v.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                vehicleFilter === v.id
                  ? 'bg-amber-400 text-black shadow-xs font-extrabold'
                  : 'bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 text-gray-700 dark:text-zinc-300 hover:bg-gray-50'
              }`}
            >
              {v.id === 'motorcycle' && <Bike className="w-3.5 h-3.5" />}
              {v.id === 'tricycle' && <Car className="w-3.5 h-3.5" />}
              {v.id === 'car4' && <Car className="w-3.5 h-3.5" />}
              {v.id === 'car8' && <Bus className="w-3.5 h-3.5" />}
              <span>{v.name}</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-black/10 dark:bg-white/10 font-bold">
                {onlineForV}/{totalForV}
              </span>
            </button>
          );
        })}
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-4 shadow-xs">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3.5 top-3 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search driver name, phone, code, plate, model..."
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
              <option value="online">Online Drivers Only</option>
              <option value="offline">Offline</option>
            </select>
          </div>

          <div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
            >
              <option value="all">All statuses</option>
              <option value="active">Active Only</option>
              <option value="suspended">Suspended Only</option>
            </select>
          </div>
        </div>
      </div>

      {/* MOBILE VIEW: Driver Cards (phones) */}
      <div className="block md:hidden space-y-3">
        {loading ? (
          <TableSkeleton rows={4} cols={1} />
        ) : filteredRiders.length === 0 ? (
          <div className="p-8 text-center text-xs text-gray-400 bg-white dark:bg-zinc-900 rounded-2xl border border-gray-200 dark:border-zinc-800">
            No matching drivers found.
          </div>
        ) : (
          filteredRiders.map((r) => {
            const vConfig = VEHICLE_TYPES.find(
              (v) => v.id === (r.vehicleType || 'motorcycle').toLowerCase()
            );
            return (
              <div
                key={r.id}
                onClick={() => setSelectedRider(r)}
                className="p-4 rounded-2xl border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xs space-y-3 cursor-pointer hover:border-amber-400 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-amber-400 text-black font-extrabold flex items-center justify-center shrink-0 overflow-hidden shadow-xs">
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
                      <div className="text-[11px] text-gray-400 font-mono">{r.riderCode}</div>
                    </div>
                  </div>

                  <span
                    className={`text-[10px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1.5 ${
                      r.status === 'suspended'
                        ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                        : r.isOnline
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                        : 'bg-gray-100 text-gray-700 dark:bg-zinc-800 dark:text-zinc-400'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        r.status === 'suspended'
                          ? 'bg-red-500'
                          : r.isOnline
                          ? 'bg-emerald-500 animate-pulse'
                          : 'bg-gray-400'
                      }`}
                    />
                    {r.status === 'suspended' ? 'Suspended' : r.isOnline ? 'Online' : 'Offline'}
                  </span>
                </div>

                {/* Vehicle & Plate details */}
                <div className="p-2.5 rounded-xl bg-gray-50 dark:bg-zinc-850/60 border border-gray-100 dark:border-zinc-800 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded-md text-[10px] font-bold border flex items-center gap-1 ${
                        vConfig?.badgeColor || 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {vConfig?.id === 'motorcycle' && <Bike className="w-3 h-3" />}
                      {vConfig?.id === 'tricycle' && <Car className="w-3 h-3" />}
                      {vConfig?.id === 'car4' && <Car className="w-3 h-3" />}
                      {vConfig?.id === 'car8' && <Bus className="w-3 h-3" />}
                      {vConfig?.name || r.vehicleType}
                    </span>
                    {r.vehicleModel && (
                      <span className="text-gray-700 dark:text-zinc-300 font-medium">
                        {r.vehicleModel}
                      </span>
                    )}
                  </div>
                  <span className="font-mono font-bold text-gray-900 dark:text-white">
                    {r.plate || 'NO PLATE'}
                  </span>
                </div>

                {/* Footer: Balance & Manage */}
                <div className="flex items-center justify-between pt-1">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-gray-400 block">
                      Wallet Balance
                    </span>
                    <span className="text-sm font-extrabold text-emerald-600">
                      ₱{Number(r.walletBalance || 0).toFixed(2)}
                    </span>
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedRider(r);
                    }}
                    className="delivio-btn-yellow px-3.5 py-1.5 rounded-xl text-xs font-bold"
                  >
                    Manage Driver &rarr;
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* DESKTOP VIEW: Drivers Table */}
      <div className="hidden md:block">
        {loading ? (
          <TableSkeleton rows={8} cols={6} />
        ) : (
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 dark:bg-zinc-850/60 uppercase font-bold text-gray-500 dark:text-zinc-400 border-b border-gray-200 dark:border-zinc-800">
                  <tr>
                    <th className="px-4 py-3.5">Driver</th>
                    <th className="px-4 py-3.5">Contact</th>
                    <th className="px-4 py-3.5">Vehicle & Plate</th>
                    <th className="px-4 py-3.5">Fleet Status</th>
                    <th className="px-4 py-3.5">Wallet / Coins</th>
                    <th className="px-4 py-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-zinc-800 font-medium">
                  {filteredRiders.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-12 text-gray-400 text-xs">
                        No matching drivers found.
                      </td>
                    </tr>
                  ) : (
                    filteredRiders.map((r) => {
                      const vConfig = VEHICLE_TYPES.find(
                        (v) => v.id === (r.vehicleType || 'motorcycle').toLowerCase()
                      );
                      return (
                        <tr
                          key={r.id}
                          onClick={() => setSelectedRider(r)}
                          className="hover:bg-amber-50/50 dark:hover:bg-zinc-800/50 cursor-pointer transition-colors"
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-xl bg-amber-400 text-black font-extrabold flex items-center justify-center shrink-0 overflow-hidden shadow-xs">
                                {r.photoUrl ? (
                                  <img
                                    src={r.photoUrl}
                                    alt={r.name}
                                    className="w-full h-full object-cover"
                                  />
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
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`px-2 py-0.5 rounded-md text-[10px] font-bold border flex items-center gap-1 ${
                                  vConfig?.badgeColor || 'bg-gray-100 text-gray-800'
                                }`}
                              >
                                {vConfig?.id === 'motorcycle' && <Bike className="w-3 h-3" />}
                                {vConfig?.id === 'tricycle' && <Car className="w-3 h-3" />}
                                {vConfig?.id === 'car4' && <Car className="w-3 h-3" />}
                                {vConfig?.id === 'car8' && <Bus className="w-3 h-3" />}
                                {vConfig?.name || r.vehicleType}
                              </span>
                              {r.vehicleModel && (
                                <span className="text-gray-700 dark:text-zinc-300 font-semibold">
                                  {r.vehicleModel}
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-gray-400 font-mono mt-0.5 flex items-center gap-2">
                              <span>Plate: {r.plate || 'N/A'}</span>
                              {r.seats ? <span>• {r.seats} seats</span> : null}
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
                                {r.status === 'suspended'
                                  ? 'Suspended'
                                  : r.isOnline
                                  ? 'Online'
                                  : 'Offline'}
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
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Selected Driver Detail Drawer */}
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
                {
                  id: 'wallet',
                  label: selectedRider?.linkedCustomerUid
                    ? `Shared Wallet (₱${Number(linkedCustomer?.walletBalance ?? 0).toFixed(2)})`
                    : `Wallet (₱${Number(selectedRider?.walletBalance || 0).toFixed(2)})`
                },
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
                        onChange={(e) => handleSelectVehicleType(e.target.value as VehicleType)}
                        className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold text-gray-900 dark:text-white"
                      >
                        {VEHICLE_TYPES.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name} ({v.defaultSeats} {v.defaultSeats === 1 ? 'seat' : 'seats'})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                        Vehicle Model / Brand
                      </label>
                      <input
                        type="text"
                        value={vehicleModel}
                        onChange={(e) => setVehicleModel(e.target.value)}
                        placeholder="e.g. Honda Click 125i, Toyota Vios"
                        className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-gray-900 dark:text-white"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                        Vehicle Color
                      </label>
                      <input
                        type="text"
                        value={vehicleColor}
                        onChange={(e) => setVehicleColor(e.target.value)}
                        placeholder="e.g. Matte Black, White, Silver"
                        className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-gray-900 dark:text-white"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                        Seats Capacity
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="20"
                        value={seats}
                        onChange={(e) => setSeats(Number(e.target.value))}
                        className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-gray-900 dark:text-white font-bold"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                        Plate Number
                      </label>
                      <input
                        type="text"
                        value={plate}
                        onChange={(e) => setPlate(e.target.value)}
                        placeholder="e.g. ABC 1234"
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
                      <span>This does not change the driver's login email.</span>
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
                      Save Driver Details
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
                        Driver Operational Status
                      </div>
                      <p className="text-xs text-red-700/80 dark:text-red-400/80">
                        Suspending marks the driver and account as suspended and forces offline.
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
                      {selectedRider.status === 'suspended' ? 'Restore Driver' : 'Suspend Driver'}
                    </button>
                  </div>
                </div>
              )}

              {/* TAB 3: SERVICES */}
              {activeTab === 'services' && (() => {
                const currentVType = (
                  (selectedRider.vehicleType || 'motorcycle').toLowerCase() as VehicleType
                );
                const validServices = SERVICES_BY_VEHICLE[currentVType] || [];
                const vConfig = VEHICLE_TYPES.find((v) => v.id === currentVType);

                return (
                  <div className="space-y-4">
                    <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 text-xs text-amber-900 dark:text-amber-300 flex items-center justify-between">
                      <div>
                        Vehicle Capabilities:{' '}
                        <strong>{vConfig?.name || selectedRider.vehicleType}</strong>
                        <p className="text-[11px] text-amber-800/80 dark:text-amber-400/80 mt-0.5">
                          Toggles only control services valid for this vehicle. Disabling a service removes it from active trip dispatch.
                        </p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      {validServices.map((srv) => {
                        const isAllowed = (selectedRider.allowedServices || []).includes(srv);
                        const srvMeta = ALL_SERVICES.find((s) => s.id === srv);
                        return (
                          <div
                            key={srv}
                            className="flex items-center justify-between p-3.5 rounded-xl border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs shadow-xs"
                          >
                            <div>
                              <span className="font-bold uppercase tracking-wider text-gray-900 dark:text-zinc-100 block">
                                {srvMeta?.label || srv.replace('_', ' ')}
                              </span>
                              <span className="text-[11px] text-gray-400">
                                {srvMeta?.description || ''}
                              </span>
                            </div>

                            <button
                              onClick={() => handleToggleService(srv)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                                isAllowed
                                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                  : 'bg-gray-200 text-gray-600 dark:bg-zinc-800 dark:text-zinc-400'
                              }`}
                            >
                              {isAllowed ? 'Allowed' : 'Disabled'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

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
                <div className="space-y-5">
                  {/* Shared Wallet Status Banner */}
                  {selectedRider.linkedCustomerUid ? (
                    <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <span className="p-2 rounded-xl bg-amber-500 text-white font-bold">
                            <Link2 className="w-4 h-4" />
                          </span>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs uppercase font-extrabold text-amber-900 dark:text-amber-300">
                                Shared Wallet Active
                              </span>
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-200 dark:bg-amber-800 text-amber-900 dark:text-amber-100">
                                Unified Balance
                              </span>
                            </div>
                            <p className="text-[11px] text-amber-800/80 dark:text-amber-300/80">
                              Linked to customer: {selectedRider.linkedCustomerName || linkedCustomer?.name || 'Customer'} ({selectedRider.linkedCustomerEmail})
                            </p>
                          </div>
                        </div>

                        <button
                          onClick={() => {
                            setUnlinkReason('');
                            setUnlinkModalOpen(true);
                          }}
                          className="px-2.5 py-1 text-xs font-bold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg border border-red-200 dark:border-red-900 transition-colors"
                        >
                          Unlink
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-amber-200 dark:border-amber-900/40">
                        <div>
                          <span className="text-gray-500 dark:text-zinc-400 text-[11px]">Customer Name:</span>
                          <p className="font-bold text-gray-900 dark:text-white">
                            {selectedRider.linkedCustomerName || linkedCustomer?.name || 'Customer'}
                          </p>
                        </div>
                        <div>
                          <span className="text-gray-500 dark:text-zinc-400 text-[11px]">Customer Email:</span>
                          <p className="font-medium text-gray-700 dark:text-zinc-300 truncate">
                            {selectedRider.linkedCustomerEmail || linkedCustomer?.email}
                          </p>
                        </div>
                        <div>
                          <span className="text-gray-500 dark:text-zinc-400 text-[11px]">Contact Phone:</span>
                          <p className="font-medium text-gray-700 dark:text-zinc-300">
                            {linkedCustomer?.phone || 'N/A'}
                          </p>
                        </div>
                        <div>
                          <span className="text-gray-500 dark:text-zinc-400 text-[11px]">Linked Date:</span>
                          <p className="font-medium text-gray-700 dark:text-zinc-300">
                            {formatTimestamp(selectedRider.linkedAt)}
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 rounded-2xl bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs uppercase font-extrabold text-gray-700 dark:text-zinc-300">
                            Independent Rider Wallet
                          </span>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-200 dark:bg-zinc-800 text-gray-600 dark:text-zinc-400">
                            Not Linked
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">
                          Link to a registered customer account to share one unified wallet balance.
                        </p>
                      </div>
                      <button
                        onClick={openLinkModal}
                        className="delivio-btn-yellow px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs"
                      >
                        <Link2 className="w-3.5 h-3.5" />
                        <span>Link to customer account</span>
                      </button>
                    </div>
                  )}

                  {/* Wallet Balance Card */}
                  <div className="p-5 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-500 text-gray-950 shadow-md">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="p-2 bg-black/10 rounded-xl">
                          <Wallet className="w-5 h-5 text-gray-950" />
                        </div>
                        <span className="text-xs font-black uppercase tracking-wider text-gray-900/80">
                          {selectedRider.linkedCustomerUid ? 'Shared Wallet Balance' : 'Rider Wallet Balance'}
                        </span>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-black/15 text-gray-950">
                        {selectedRider.linkedCustomerUid ? 'Shared with Customer' : 'Rider Only'}
                      </span>
                    </div>

                    <div className="mt-4">
                      <div className="text-3xl font-black tracking-tight">
                        ₱{Number(
                          selectedRider.linkedCustomerUid
                            ? linkedCustomer?.walletBalance ?? 0
                            : selectedRider.walletBalance ?? 0
                        ).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                      <p className="text-xs text-gray-900/80 mt-1 font-medium">
                        {selectedRider.linkedCustomerUid ? (
                          <>Stored on customer account (<code className="font-mono bg-black/10 px-1 rounded">users/{selectedRider.linkedCustomerUid}.walletBalance</code>)</>
                        ) : (
                          <>Stored on rider document (<code className="font-mono bg-black/10 px-1 rounded">riders/{selectedRider.id}.walletBalance</code>)</>
                        )}
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-2 mt-5">
                      <button
                        onClick={() => {
                          setCashInAmount(0);
                          setCashInNote('');
                          // focus cash-in input or scroll
                          const el = document.getElementById('rider-cash-in-input');
                          if (el) el.focus();
                        }}
                        className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-gray-950 hover:bg-gray-900 text-white font-bold text-xs shadow-xs transition-colors"
                      >
                        <PlusCircle className="w-4 h-4 text-amber-400" />
                        <span>Add Cash</span>
                      </button>

                      <button
                        onClick={() => {
                          setAdjustAmount(0);
                          setAdjustReason('');
                          setAdjustModalOpen(true);
                        }}
                        className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-white/90 hover:bg-white text-gray-900 font-bold text-xs shadow-xs transition-colors"
                      >
                        <MinusCircle className="w-4 h-4 text-red-600" />
                        <span>Adjust / Deduct</span>
                      </button>
                    </div>
                  </div>

                  {/* Add Cash Section */}
                  <div className="p-4 rounded-2xl bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 space-y-3">
                    <span className="text-xs font-bold uppercase text-gray-700 dark:text-zinc-300 block">
                      Admin Cash Top-Up (Add Cash)
                    </span>
                    <div className="flex gap-2">
                      <input
                        id="rider-cash-in-input"
                        type="number"
                        min="1"
                        value={cashInAmount || ''}
                        onChange={(e) => setCashInAmount(Number(e.target.value))}
                        placeholder="Top-up Amount (₱)"
                        className="flex-1 px-3.5 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 font-bold text-gray-900 dark:text-white"
                      />
                      <input
                        type="text"
                        value={cashInNote}
                        onChange={(e) => setCashInNote(e.target.value)}
                        placeholder="Reason / Note (e.g. Counter deposit)"
                        className="flex-1 px-3.5 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                      />
                      <button
                        onClick={handleAddWalletCash}
                        disabled={addingCash || cashInAmount <= 0}
                        className="delivio-btn-yellow px-4 py-2 text-xs font-bold rounded-xl flex items-center gap-1.5"
                      >
                        {addingCash && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        Add Cash
                      </button>
                    </div>
                  </div>

                  {/* Wallet Activity Ledger */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase text-gray-500">
                        Wallet Activity & Ledger ({walletTxns.length})
                      </span>
                    </div>

                    {walletTxns.length === 0 ? (
                      <div className="p-6 text-center text-xs text-gray-400 bg-gray-50 dark:bg-zinc-900 rounded-xl border border-gray-100 dark:border-zinc-800">
                        No wallet transactions recorded.
                      </div>
                    ) : (
                      <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
                        {walletTxns.map((tx) => {
                          const isNegative = Number(tx.amount || 0) < 0;
                          return (
                            <div
                              key={tx.id}
                              className="flex items-center justify-between p-2.5 rounded-xl bg-gray-50 dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 text-xs"
                            >
                              <div className="flex items-center gap-2">
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                                    tx.type === 'merge'
                                      ? 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300'
                                      : isNegative
                                      ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                                      : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                  }`}
                                >
                                  {tx.type || 'cash_in'}
                                </span>
                                <div>
                                  <span className={`font-bold ${isNegative ? 'text-red-600' : 'text-emerald-600'}`}>
                                    {isNegative ? '' : '+'}₱{Math.abs(Number(tx.amount || 0)).toFixed(2)}
                                  </span>
                                  <p className="text-[11px] text-gray-500 truncate max-w-[200px]">
                                    {tx.note || tx.reason || 'Transaction'}
                                  </p>
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="text-[10px] text-gray-400">
                                  {formatTimestamp(tx.createdAt)}
                                </div>
                                {tx.balanceAfter !== undefined && (
                                  <div className="text-[10px] font-mono text-gray-500">
                                    Bal: ₱{Number(tx.balanceAfter).toFixed(2)}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
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
      {/* MODAL 1: LINK TO CUSTOMER ACCOUNT (Type-ahead search) */}
      {linkModalOpen && selectedRider && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div
            className="w-full max-w-lg bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl shadow-2xl p-6 overflow-hidden flex flex-col max-h-[85vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400">
                  <Link2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900 dark:text-white">
                    Link Rider to Customer Account
                  </h3>
                  <p className="text-xs text-gray-500">
                    Search registered customer accounts by email to create a shared wallet.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setLinkModalOpen(false)}
                className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-zinc-200 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Type-ahead search input */}
            <div className="relative mb-3">
              <Search className="w-4 h-4 absolute left-3.5 top-3 text-gray-400" />
              <input
                type="text"
                value={customerSearchQuery}
                onChange={(e) => setCustomerSearchQuery(e.target.value)}
                placeholder="Type customer email, name, or phone..."
                autoFocus
                className="w-full pl-9 pr-4 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-amber-400"
              />
            </div>

            {/* Candidate list */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-[220px]">
              {loadingCustomers ? (
                <div className="p-8 text-center text-xs text-gray-400 flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-amber-500" />
                  Loading registered customers...
                </div>
              ) : filteredCandidates.length === 0 ? (
                <div className="p-8 text-center text-xs text-gray-400">
                  No matching registered customers found.
                </div>
              ) : (
                filteredCandidates.map((cust) => (
                  <div
                    key={cust.uid}
                    onClick={() => {
                      setSelectedCandidateCustomer(cust);
                      setConfirmMergeModalOpen(true);
                    }}
                    className="p-3 rounded-xl border border-gray-200 dark:border-zinc-800 hover:border-amber-400 dark:hover:border-amber-500 bg-gray-50/60 dark:bg-zinc-850 cursor-pointer transition-all flex items-center justify-between group"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs text-gray-900 dark:text-white group-hover:text-amber-600 transition-colors">
                          {cust.name}
                        </span>
                        <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/60 px-1.5 py-0.2 rounded">
                          Bal: ₱{Number(cust.walletBalance || 0).toFixed(2)}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-gray-500 mt-0.5">
                        <span className="flex items-center gap-1 font-mono">
                          <Mail className="w-3 h-3" /> {cust.email}
                        </span>
                        {cust.phone && (
                          <span className="flex items-center gap-1">
                            <Phone className="w-3 h-3" /> {cust.phone}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="px-2.5 py-1 rounded-lg text-xs font-bold text-amber-600 bg-amber-50 dark:bg-amber-950/40 group-hover:bg-amber-500 group-hover:text-white transition-colors"
                    >
                      Select &rarr;
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="pt-3 border-t border-gray-100 dark:border-zinc-800 flex justify-end">
              <button
                type="button"
                onClick={() => setLinkModalOpen(false)}
                className="px-4 py-2 text-xs font-bold text-gray-600 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-xl"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: CONFIRM MERGE WALLETS MODAL */}
      {confirmMergeModalOpen && selectedRider && selectedCandidateCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div
            className="w-full max-w-md bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl shadow-2xl p-6 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-gray-900 dark:text-white">
                Confirm Shared Wallet Link
              </h3>
            </div>

            <p className="text-xs text-gray-600 dark:text-zinc-300 mb-4 leading-relaxed font-semibold">
              Both wallets will be merged into one shared balance on the customer account.
            </p>

            <div className="p-3.5 rounded-xl bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-800 space-y-2 text-xs mb-4">
              <div className="flex justify-between items-center">
                <span className="text-gray-500">Rider: {selectedRider.name}</span>
                <span className="font-bold text-gray-900 dark:text-white">
                  ₱{Number(selectedRider.walletBalance || 0).toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-500">Customer: {selectedCandidateCustomer.email}</span>
                <span className="font-bold text-gray-900 dark:text-white">
                  ₱{Number(selectedCandidateCustomer.walletBalance || 0).toFixed(2)}
                </span>
              </div>
              <div className="pt-2 border-t border-gray-200 dark:border-zinc-700 flex justify-between items-center text-sm font-extrabold text-amber-600">
                <span>New Shared Balance:</span>
                <span>
                  ₱{(Number(selectedRider.walletBalance || 0) + Number(selectedCandidateCustomer.walletBalance || 0)).toFixed(2)}
                </span>
              </div>
            </div>

            <p className="text-[11px] text-gray-500 mb-4">
              After merging, the rider's balance document will be set to ₱0 and the combined funds will be kept on the customer account. Future top-ups and adjustments update the shared balance for both users.
            </p>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmMergeModalOpen(false)}
                disabled={linking}
                className="px-4 py-2 text-xs font-bold text-gray-600 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-xl"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmLink}
                disabled={linking}
                className="delivio-btn-yellow px-5 py-2 text-xs font-bold rounded-xl flex items-center gap-2"
              >
                {linking && <Loader2 className="w-4 h-4 animate-spin" />}
                Confirm & Merge Wallets
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: ADJUST / DEDUCT WALLET MODAL */}
      {adjustModalOpen && selectedRider && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div
            className="w-full max-w-md bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl shadow-2xl p-6 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-red-100 text-red-600 dark:bg-red-950/60 dark:text-red-400">
                  <MinusCircle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900 dark:text-white">
                    Adjust / Deduct Balance
                  </h3>
                  <p className="text-xs text-gray-500">
                    {selectedRider.linkedCustomerUid ? 'Deducts from shared customer balance' : 'Deducts from rider wallet'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setAdjustModalOpen(false)}
                className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-zinc-200 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAdjustWalletCash} className="space-y-4">
              <div className="p-3 rounded-xl bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-800 text-xs flex justify-between">
                <span className="text-gray-500">Available Balance:</span>
                <span className="font-bold text-gray-900 dark:text-white">
                  ₱{Number(
                    selectedRider.linkedCustomerUid
                      ? linkedCustomer?.walletBalance ?? 0
                      : selectedRider.walletBalance ?? 0
                  ).toFixed(2)}
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Deduction Amount (₱) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={adjustAmount || ''}
                  onChange={(e) => setAdjustAmount(Number(e.target.value))}
                  required
                  placeholder="0.00"
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white font-bold"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Reason for Adjustment <span className="text-red-500">*</span>
                </label>
                <textarea
                  rows={2}
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  required
                  placeholder="Mandatory reason (e.g. overpayment correction, penalty, user dispute)..."
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAdjustModalOpen(false)}
                  disabled={submittingAdjust}
                  className="px-4 py-2 text-xs font-bold text-gray-600 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingAdjust || adjustAmount <= 0}
                  className="px-5 py-2 text-xs font-bold rounded-xl bg-red-600 hover:bg-red-700 text-white flex items-center gap-2 disabled:opacity-50"
                >
                  {submittingAdjust && <Loader2 className="w-4 h-4 animate-spin" />}
                  Confirm Deduction
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 4: UNLINK RIDER CONFIRMATION MODAL */}
      {unlinkModalOpen && selectedRider && (
        <ConfirmationModal
          isOpen={unlinkModalOpen}
          onClose={() => setUnlinkModalOpen(false)}
          onConfirm={async (reason) => {
            await handleUnlinkRider(reason);
          }}
          title={`Unlink Driver ${selectedRider.name}`}
          message={`Are you sure you want to unlink driver ${selectedRider.name} from customer account (${selectedRider.linkedCustomerEmail})? The shared balance will remain on the customer account. The driver's wallet balance will start at ₱0.`}
          confirmLabel="Unlink Account"
          reasonRequired={true}
          reasonPlaceholder="Specify mandatory reason for unlinking account..."
          isDestructive={true}
        />
      )}

      {/* MODAL 5: VEHICLE TYPE CHANGE CONFIRMATION */}
      {vehicleConfirmModalOpen && pendingVehicleType && selectedRider && (
        <ConfirmationModal
          isOpen={vehicleConfirmModalOpen}
          onClose={() => {
            setVehicleConfirmModalOpen(false);
            setPendingVehicleType(null);
          }}
          onConfirm={confirmChangeVehicleType}
          title={`Change Vehicle Type to ${VEHICLE_LABELS[pendingVehicleType]}`}
          message={`Changing vehicle type to ${VEHICLE_LABELS[pendingVehicleType]} will update vehicle capacity and automatically recompute allowed services and active services for driver ${selectedRider.name} to match vehicle capabilities (${SERVICES_BY_VEHICLE[pendingVehicleType].join(', ')}). Do you want to proceed?`}
          confirmLabel="Update Vehicle & Services"
          reasonRequired={false}
          isDestructive={false}
        />
      )}
    </div>
  );
};
