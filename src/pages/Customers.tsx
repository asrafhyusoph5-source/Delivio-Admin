import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import L from 'leaflet';
import {
  db,
  collection,
  query,
  where,
  limit,
  getDocs,
  doc,
  updateDoc,
  startAfter,
  Timestamp,
  arrayUnion,
  writeBatch,
  increment,
  runTransaction
} from '../firebase';
import { useCity } from '../context/CityContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { logAuditEvent, logEditHistory } from '../utils/audit';
import { exportToCsv } from '../utils/exportCsv';
import { formatTimestamp, formatRelativeTime } from '../utils/date';
import type { UserProfile, UserAddress, Order, EditHistoryEntry, WalletTransaction, Rider } from '../types';
import {
  Search,
  Filter,
  Users,
  ShieldAlert,
  ShieldCheck,
  UserX,
  UserCheck,
  Phone,
  Mail,
  MapPin,
  Clock,
  History,
  FileText,
  CreditCard,
  Edit,
  Download,
  X,
  Loader2,
  AlertTriangle,
  ArrowUpDown,
  ShoppingBag,
  ExternalLink,
  Wallet,
  PlusCircle,
  MinusCircle,
  ArrowDownLeft,
  ArrowUpRight,
  Receipt,
  CheckCircle2,
  Bike,
  Link2
} from 'lucide-react';
import { ConfirmationModal } from '../components/common/ConfirmationModal';
import { TableSkeleton } from '../components/common/SkeletonLoader';

export const Customers: React.FC = () => {
  const [searchParams] = useSearchParams();
  const initialSearch = searchParams.get('search') || '';

  const { selectedCityId, cities } = useCity();
  const { adminProfile } = useAuth();
  const { showSuccess, showError } = useToast();

  const [customers, setCustomers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [lastVisibleDoc, setLastVisibleDoc] = useState<any>(null);
  const [hasMore, setHasMore] = useState(false);

  // Filters
  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'blocked'>('all');

  // Selected customer for detail drawer
  const [selectedCustomer, setSelectedCustomer] = useState<UserProfile | null>(null);
  const [customerAddresses, setCustomerAddresses] = useState<UserAddress[]>([]);
  const [customerOrders, setCustomerOrders] = useState<Order[]>([]);
  const [customerWalletTxns, setCustomerWalletTxns] = useState<WalletTransaction[]>([]);
  const [loadingWallet, setLoadingWallet] = useState(false);
  const [customerEditHistory, setCustomerEditHistory] = useState<EditHistoryEntry[]>([]);
  const [historySortAsc, setHistorySortAsc] = useState(false);
  const [linkedRider, setLinkedRider] = useState<Rider | null>(null);
  const [unlinkModalOpen, setUnlinkModalOpen] = useState(false);
  const [unlinkReason, setUnlinkReason] = useState('');
  const [unlinking, setUnlinking] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'wallet' | 'transactions' | 'history' | 'location'>('overview');

  // Add Cash Modal
  const [addCashModalOpen, setAddCashModalOpen] = useState(false);
  const [addCashAmount, setAddCashAmount] = useState('');
  const [addCashNote, setAddCashNote] = useState('');
  const [submittingCashIn, setSubmittingCashIn] = useState(false);

  // Adjust / Deduct Modal
  const [adjustModalOpen, setAdjustModalOpen] = useState(false);
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [submittingAdjust, setSubmittingAdjust] = useState(false);

  // Edit Customer Modal
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editAdminNote, setEditAdminNote] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Block / Restore confirmation
  const [blockModalOpen, setBlockModalOpen] = useState(false);
  const [customerToToggle, setCustomerToToggle] = useState<UserProfile | null>(null);

  // Customer Location Leaflet map ref
  const customerMapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);

  // 1. Fetch Customers
  const fetchCustomers = async (isLoadMore = false) => {
    try {
      if (isLoadMore) setLoadingMore(true);
      else setLoading(true);

      const usersRef = collection(db, 'users');
      let q = query(usersRef, where('role', '==', 'customer'), limit(50));

      if (isLoadMore && lastVisibleDoc) {
        q = query(usersRef, where('role', '==', 'customer'), startAfter(lastVisibleDoc), limit(50));
      }

      const snap = await getDocs(q);
      const list: UserProfile[] = [];
      snap.forEach((d) => {
        const data = d.data();
        list.push({
          uid: d.id,
          role: 'customer',
          email: data.email || '',
          name: data.name || 'Unnamed Customer',
          phone: data.phone || '',
          photoUrl: data.photoUrl,
          status: data.status || 'active',
          walletBalance: data.walletBalance || 0,
          location: data.location,
          adminNote: data.adminNote || '',
          cityId: data.cityId,
          createdAt: data.createdAt
        });
      });

      // Sort in JS newest first
      list.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

      if (isLoadMore) {
        setCustomers((prev) => [...prev, ...list]);
      } else {
        setCustomers(list);
      }

      const lastDoc = snap.docs[snap.docs.length - 1];
      setLastVisibleDoc(lastDoc || null);
      setHasMore(snap.docs.length === 50);
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    fetchCustomers();
  }, []);

  // 2. Fetch Customer sub-details when selected
  useEffect(() => {
    if (!selectedCustomer) return;

    // A. Fetch Addresses
    const fetchAddresses = async () => {
      try {
        const addrRef = collection(db, 'users', selectedCustomer.uid, 'addresses');
        const snap = await getDocs(addrRef);
        const addrs: UserAddress[] = [];
        snap.forEach((d) => {
          const dt = d.data();
          addrs.push({
            id: d.id,
            label: dt.label || 'Home',
            address: dt.address || '',
            details: dt.details,
            lat: dt.lat,
            lng: dt.lng,
            isDefault: dt.isDefault
          });
        });
        setCustomerAddresses(addrs);
      } catch (err) {
        console.error('Failed to load customer addresses:', err);
      }
    };

    // B. Fetch Orders for this customer
    const fetchOrders = async () => {
      try {
        const ordersRef = collection(db, 'orders');
        const q = query(ordersRef, where('customerId', '==', selectedCustomer.uid), limit(100));
        const snap = await getDocs(q);
        const ords: Order[] = [];
        snap.forEach((d) => {
          const dt = d.data();
          ords.push({
            id: d.id,
            orderNumber: dt.orderNumber || d.id.substring(0, 8),
            serviceType: dt.serviceType || 'food',
            customerId: dt.customerId,
            customerName: dt.customerName,
            merchantName: dt.merchantName,
            status: dt.status,
            statusHistory: dt.statusHistory || [],
            fees: dt.fees || { subtotal: 0, deliveryFee: 0, serviceFee: 0, discount: 0, total: 0 },
            paymentMethod: dt.paymentMethod || 'cod',
            payment: dt.payment,
            paymentStatus: dt.paymentStatus,
            walletRefunded: dt.walletRefunded,
            createdAt: dt.createdAt,
            updatedAt: dt.updatedAt
          });
        });
        ords.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        setCustomerOrders(ords);
      } catch (err) {
        console.error('Failed to load customer orders:', err);
      }
    };

    // C. Fetch Wallet Transactions
    const fetchWalletTxns = async () => {
      try {
        setLoadingWallet(true);
        const txRef = collection(db, 'walletTransactions');
        const q = query(txRef, where('customerId', '==', selectedCustomer.uid), limit(100));
        const snap = await getDocs(q);
        const list: WalletTransaction[] = [];
        snap.forEach((d) => {
          const dt = d.data();
          list.push({
            id: d.id,
            customerId: dt.customerId,
            type: dt.type || 'cash_in',
            amount: Number(dt.amount || 0),
            note: dt.note || '',
            reason: dt.reason || '',
            adminId: dt.adminId,
            adminName: dt.adminName,
            balanceAfter: dt.balanceAfter,
            orderId: dt.orderId,
            orderNumber: dt.orderNumber,
            createdAt: dt.createdAt
          });
        });
        list.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        setCustomerWalletTxns(list);
      } catch (err) {
        console.error('Failed to load wallet transactions:', err);
      } finally {
        setLoadingWallet(false);
      }
    };

    // D. Fetch Edit History
    const fetchEditHistory = async () => {
      try {
        const historyRef = collection(db, 'editHistory');
        const q = query(historyRef, where('entityId', '==', selectedCustomer.uid), limit(50));
        const snap = await getDocs(q);
        const entries: EditHistoryEntry[] = [];
        snap.forEach((d) => {
          const dt = d.data();
          entries.push({
            id: d.id,
            entityType: dt.entityType || 'customer',
            entityId: dt.entityId,
            field: dt.field,
            oldValue: dt.oldValue,
            newValue: dt.newValue,
            editedBy: dt.editedBy,
            editedByName: dt.editedByName,
            at: dt.at
          });
        });
        entries.sort((a, b) => (b.at?.seconds || 0) - (a.at?.seconds || 0));
        setCustomerEditHistory(entries);
      } catch (err) {
        console.error('Failed to load edit history:', err);
      }
    };

    // E. Fetch Linked Rider (query riders where linkedCustomerUid == uid)
    const fetchLinkedRider = async () => {
      try {
        const ridersRef = collection(db, 'riders');
        const q = query(ridersRef, where('linkedCustomerUid', '==', selectedCustomer.uid), limit(1));
        const snap = await getDocs(q);
        if (!snap.empty) {
          const d = snap.docs[0];
          const dt = d.data();
          setLinkedRider({
            id: d.id,
            name: dt.name || 'Rider',
            email: dt.email || '',
            phone: dt.phone || '',
            riderCode: dt.riderCode || d.id.substring(0, 8),
            status: dt.status || 'active',
            vehicleType: dt.vehicleType || 'Motorcycle',
            vehicleModel: dt.vehicleModel || '',
            plate: dt.plate || '',
            allowedServices: dt.allowedServices || [],
            activeServices: dt.activeServices || [],
            isOnline: Boolean(dt.isOnline),
            coins: dt.coins || 0,
            walletBalance: dt.walletBalance || 0,
            cashRemitted: dt.cashRemitted || 0,
            linkedCustomerUid: dt.linkedCustomerUid,
            linkedCustomerEmail: dt.linkedCustomerEmail,
            linkedCustomerName: dt.linkedCustomerName,
            linkedAt: dt.linkedAt,
            createdAt: dt.createdAt
          });
        } else {
          setLinkedRider(null);
        }
      } catch (err) {
        console.error('Failed to load linked rider:', err);
        setLinkedRider(null);
      }
    };

    fetchAddresses();
    fetchOrders();
    fetchWalletTxns();
    fetchEditHistory();
    fetchLinkedRider();
  }, [selectedCustomer]);

  // Merged Wallet History (walletTransactions + wallet-paid orders + refunds)
  const mergedWalletHistory = useMemo(() => {
    if (!selectedCustomer) return [];

    const items: Array<{
      id: string;
      type: 'cash_in' | 'adjustment' | 'refund' | 'order_payment' | string;
      amount: number;
      title: string;
      note?: string;
      adminName?: string;
      balanceAfter?: number;
      createdAt: any;
      orderNumber?: string;
    }> = [];

    const seenOrderRefunds = new Set<string>();
    const seenOrderPayments = new Set<string>();

    customerWalletTxns.forEach((tx) => {
      if (tx.orderId && tx.type === 'refund') seenOrderRefunds.add(tx.orderId);
      if (tx.orderId && tx.type === 'order_payment') seenOrderPayments.add(tx.orderId);

      let title = 'Wallet Transaction';
      if (tx.type === 'cash_in') title = 'Cash In / Top-Up';
      else if (tx.type === 'adjustment') title = 'Balance Deduction / Adjustment';
      else if (tx.type === 'refund') title = `Refund ${tx.orderNumber ? '#' + tx.orderNumber : ''}`;
      else if (tx.type === 'order_payment') title = `Order Payment ${tx.orderNumber ? '#' + tx.orderNumber : ''}`;

      items.push({
        id: tx.id || Math.random().toString(),
        type: tx.type,
        amount: tx.amount,
        title,
        note: tx.note || tx.reason,
        adminName: tx.adminName,
        balanceAfter: tx.balanceAfter,
        createdAt: tx.createdAt,
        orderNumber: tx.orderNumber
      });
    });

    // Merge customer's wallet-paid orders
    customerOrders.forEach((ord) => {
      const isWallet = ord.paymentMethod === 'wallet' || ord.payment?.method === 'wallet';
      if (isWallet && !seenOrderPayments.has(ord.id)) {
        items.push({
          id: `order-pay-${ord.id}`,
          type: 'order_payment',
          amount: -Math.abs(Number(ord.fees?.total || 0)),
          title: `Paid Order #${ord.orderNumber}`,
          note: `${ord.merchantName || ord.serviceType} • Status: ${ord.status}`,
          createdAt: ord.createdAt,
          orderNumber: ord.orderNumber
        });
      }

      // If order has walletRefunded true and not already in walletTransactions
      if (ord.walletRefunded && !seenOrderRefunds.has(ord.id)) {
        items.push({
          id: `order-ref-${ord.id}`,
          type: 'refund',
          amount: Math.abs(Number(ord.fees?.total || 0)),
          title: `Refund for Order #${ord.orderNumber}`,
          note: `Order cancelled & refunded to wallet`,
          createdAt: ord.updatedAt || ord.createdAt,
          orderNumber: ord.orderNumber
        });
      }
    });

    items.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    return items;
  }, [customerWalletTxns, customerOrders, selectedCustomer]);

  // Action: Add Cash to Customer Wallet (Runs in ONE transaction)
  const handleAddCash = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer) return;
    const amountNum = parseFloat(addCashAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      showError('Please enter a valid amount greater than 0.');
      return;
    }

    try {
      setSubmittingCashIn(true);
      const userRef = doc(db, 'users', selectedCustomer.uid);
      const now = Timestamp.now();
      const noteClean = addCashNote.trim() || 'Admin cash deposit';
      const txnRef = doc(collection(db, 'walletTransactions'));

      let finalBal = 0;
      let oldBal = 0;

      await runTransaction(db, async (transaction) => {
        const userSnap = await transaction.get(userRef);
        oldBal = userSnap.exists() ? Number(userSnap.data()?.walletBalance || 0) : 0;
        finalBal = oldBal + amountNum;

        if (userSnap.exists()) {
          transaction.update(userRef, {
            walletBalance: finalBal,
            updatedAt: now
          });
        } else {
          transaction.set(
            userRef,
            {
              walletBalance: finalBal,
              role: 'customer',
              email: selectedCustomer.email,
              name: selectedCustomer.name,
              status: 'active',
              updatedAt: now
            },
            { merge: true }
          );
        }

        const txnData: any = {
          customerId: selectedCustomer.uid,
          type: 'cash_in',
          amount: amountNum,
          note: noteClean,
          adminId: adminProfile?.uid || 'admin',
          adminName: adminProfile?.name || 'Administrator',
          balanceAfter: finalBal,
          createdAt: now
        };
        if (linkedRider?.id) {
          txnData.riderId = linkedRider.id;
        }
        transaction.set(txnRef, txnData);
      });

      // Write auditLogs and editHistory
      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        adminEmail: adminProfile?.email,
        action: 'WALLET_ADD_CASH',
        entityType: 'customer',
        entityId: selectedCustomer.uid,
        details: `Credited ₱${amountNum.toFixed(2)} cash to ${linkedRider ? 'shared ' : ''}customer wallet (${selectedCustomer.name}). Note: ${noteClean}`,
        oldValue: { walletBalance: oldBal },
        newValue: { walletBalance: finalBal },
        reason: noteClean
      });

      await logEditHistory({
        entityType: 'customer',
        entityId: selectedCustomer.uid,
        field: 'walletBalance',
        oldValue: oldBal,
        newValue: finalBal,
        editedBy: adminProfile?.uid || 'admin',
        editedByName: adminProfile?.name || 'Administrator'
      });

      showSuccess(`Successfully credited ₱${amountNum.toFixed(2)} to ${selectedCustomer.name}'s wallet.`);

      // Update state
      setSelectedCustomer((prev) => (prev ? { ...prev, walletBalance: finalBal } : null));
      setCustomers((prev) =>
        prev.map((c) => (c.uid === selectedCustomer.uid ? { ...c, walletBalance: finalBal } : c))
      );
      setCustomerWalletTxns((prev) => [
        {
          id: txnRef.id,
          customerId: selectedCustomer.uid,
          riderId: linkedRider?.id,
          type: 'cash_in',
          amount: amountNum,
          note: noteClean,
          adminId: adminProfile?.uid || 'admin',
          adminName: adminProfile?.name || 'Administrator',
          balanceAfter: finalBal,
          createdAt: now
        },
        ...prev
      ]);

      setAddCashAmount('');
      setAddCashNote('');
      setAddCashModalOpen(false);
    } catch (err: any) {
      showError(err);
    } finally {
      setSubmittingCashIn(false);
    }
  };

  // Action: Adjust / Deduct from Customer Wallet (Runs in ONE transaction)
  const handleAdjustDeduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer) return;
    const amountNum = parseFloat(adjustAmount);
    const reasonClean = adjustReason.trim();

    if (isNaN(amountNum) || amountNum <= 0) {
      showError('Please enter a valid deduction amount greater than 0.');
      return;
    }
    if (!reasonClean) {
      showError('A mandatory reason is required to adjust or deduct wallet balance.');
      return;
    }

    try {
      setSubmittingAdjust(true);
      const userRef = doc(db, 'users', selectedCustomer.uid);
      const now = Timestamp.now();
      const txnRef = doc(collection(db, 'walletTransactions'));

      let finalBal = 0;
      let oldBal = 0;

      await runTransaction(db, async (transaction) => {
        const userSnap = await transaction.get(userRef);
        oldBal = userSnap.exists() ? Number(userSnap.data()?.walletBalance || 0) : 0;
        if (amountNum > oldBal) {
          throw new Error(
            `Cannot deduct ₱${amountNum.toFixed(2)}. Customer balance is only ₱${oldBal.toFixed(2)} (balance cannot go below 0).`
          );
        }
        finalBal = oldBal - amountNum;

        transaction.update(userRef, {
          walletBalance: finalBal,
          updatedAt: now
        });

        const txnData: any = {
          customerId: selectedCustomer.uid,
          type: 'adjustment',
          amount: -amountNum,
          note: reasonClean,
          reason: reasonClean,
          adminId: adminProfile?.uid || 'admin',
          adminName: adminProfile?.name || 'Administrator',
          balanceAfter: finalBal,
          createdAt: now
        };
        if (linkedRider?.id) {
          txnData.riderId = linkedRider.id;
        }
        transaction.set(txnRef, txnData);
      });

      // Write auditLogs and editHistory entries
      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        adminEmail: adminProfile?.email,
        action: 'WALLET_ADJUST_DEDUCT',
        entityType: 'customer',
        entityId: selectedCustomer.uid,
        details: `Deducted/adjusted ₱${amountNum.toFixed(2)} from ${linkedRider ? 'shared ' : ''}${selectedCustomer.name}'s wallet. Reason: ${reasonClean}`,
        oldValue: { walletBalance: oldBal },
        newValue: { walletBalance: finalBal },
        reason: reasonClean
      });

      await logEditHistory({
        entityType: 'customer',
        entityId: selectedCustomer.uid,
        field: 'walletBalance',
        oldValue: oldBal,
        newValue: finalBal,
        editedBy: adminProfile?.uid || 'admin',
        editedByName: adminProfile?.name || 'Administrator'
      });

      showSuccess(`Successfully deducted ₱${amountNum.toFixed(2)}.`);

      // Update state
      setSelectedCustomer((prev) => (prev ? { ...prev, walletBalance: finalBal } : null));
      setCustomers((prev) =>
        prev.map((c) => (c.uid === selectedCustomer.uid ? { ...c, walletBalance: finalBal } : c))
      );
      setCustomerWalletTxns((prev) => [
        {
          id: txnRef.id,
          customerId: selectedCustomer.uid,
          riderId: linkedRider?.id,
          type: 'adjustment',
          amount: -amountNum,
          note: reasonClean,
          reason: reasonClean,
          adminId: adminProfile?.uid || 'admin',
          adminName: adminProfile?.name || 'Administrator',
          balanceAfter: finalBal,
          createdAt: now
        },
        ...prev
      ]);

      setAdjustAmount('');
      setAdjustReason('');
      setAdjustModalOpen(false);
    } catch (err: any) {
      showError(err);
    } finally {
      setSubmittingAdjust(false);
    }
  };

  // Action: Unlink Rider from Customer (Reason required; balance stays on customer account)
  const handleUnlinkRider = async (customReason?: string) => {
    if (!linkedRider || !selectedCustomer) return;
    const reasonClean = (customReason || unlinkReason).trim();
    if (!reasonClean) {
      showError('A mandatory reason is required to unlink rider account.');
      return;
    }
    try {
      setUnlinking(true);
      const rRef = doc(db, 'riders', linkedRider.id);
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
        entityId: linkedRider.id,
        details: `Unlinked rider ${linkedRider.name} from customer ${selectedCustomer.name} (${selectedCustomer.email}). Reason: ${reasonClean}. Shared balance remains with customer account.`,
        reason: reasonClean
      });

      showSuccess(`Rider ${linkedRider.name} unlinked. Balance remains on customer account.`);
      setLinkedRider(null);
      setUnlinkModalOpen(false);
      setUnlinkReason('');
    } catch (err: any) {
      showError(err);
    } finally {
      setUnlinking(false);
    }
  };

  // 3. Location Leaflet map for customer
  useEffect(() => {
    if (activeTab !== 'location' || !selectedCustomer || !customerMapRef.current) return;

    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    const lat = selectedCustomer.location?.lat || 9.7392;
    const lng = selectedCustomer.location?.lng || 118.7353;

    const map = L.map(customerMapRef.current, {
      center: [lat, lng],
      zoom: 14,
      zoomControl: false
    });

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap'
    }).addTo(map);

    if (selectedCustomer.location?.lat && selectedCustomer.location?.lng) {
      L.marker([lat, lng])
        .bindTooltip(`${selectedCustomer.name}'s Last Known Position`, { permanent: true })
        .addTo(map);
    }

    mapInstanceRef.current = map;

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [activeTab, selectedCustomer]);

  // Filter in JavaScript
  const filteredCustomers = useMemo(() => {
    return customers.filter((c) => {
      if (selectedCityId !== 'all' && c.cityId && c.cityId !== selectedCityId) {
        return false;
      }
      if (statusFilter !== 'all' && c.status !== statusFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const n = (c.name || '').toLowerCase();
        const p = (c.phone || '').toLowerCase();
        const e = (c.email || '').toLowerCase();
        if (!n.includes(q) && !p.includes(q) && !e.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [customers, selectedCityId, statusFilter, searchQuery]);

  // Block / Restore Action
  const handleToggleBlock = async (reason: string) => {
    if (!customerToToggle) return;
    try {
      const isBlocking = customerToToggle.status !== 'blocked';
      const newStatus = isBlocking ? 'blocked' : 'active';
      const userRef = doc(db, 'users', customerToToggle.uid);

      await updateDoc(userRef, {
        status: newStatus,
        statusReason: reason,
        updatedAt: Timestamp.now()
      });

      // Write Audit log
      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        adminEmail: adminProfile?.email,
        action: isBlocking ? 'BLOCK_CUSTOMER' : 'RESTORE_CUSTOMER',
        entityType: 'customer',
        entityId: customerToToggle.uid,
        details: `${isBlocking ? 'Blocked' : 'Restored'} customer ${customerToToggle.name}. Reason: ${reason}`,
        oldValue: { status: customerToToggle.status },
        newValue: { status: newStatus },
        reason
      });

      showSuccess(`Customer ${customerToToggle.name} is now ${newStatus}.`);

      // Update local state
      setCustomers((prev) =>
        prev.map((c) => (c.uid === customerToToggle.uid ? { ...c, status: newStatus } : c))
      );
      if (selectedCustomer?.uid === customerToToggle.uid) {
        setSelectedCustomer((prev) => (prev ? { ...prev, status: newStatus } : null));
      }
    } catch (err: any) {
      showError(err);
    }
  };

  // Open Edit Customer Modal
  const openEditModal = (c: UserProfile) => {
    setEditName(c.name || '');
    setEditPhone(c.phone || '');
    setEditEmail(c.email || '');
    setEditAdminNote(c.adminNote || '');
    setEditModalOpen(true);
  };

  // Save Customer Edits
  const handleSaveCustomerEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer) return;
    try {
      setSavingEdit(true);
      const userRef = doc(db, 'users', selectedCustomer.uid);
      const old = selectedCustomer;

      const updates: Record<string, any> = {
        name: editName.trim(),
        phone: editPhone.trim(),
        email: editEmail.trim(),
        adminNote: editAdminNote.trim(),
        updatedAt: Timestamp.now()
      };

      await updateDoc(userRef, updates);

      // Track individual field changes in editHistory
      const fieldsToCheck: ('name' | 'phone' | 'email' | 'adminNote')[] = [
        'name',
        'phone',
        'email',
        'adminNote'
      ];
      for (const f of fieldsToCheck) {
        if ((old[f] || '') !== updates[f]) {
          await logEditHistory({
            entityType: 'customer',
            entityId: selectedCustomer.uid,
            field: f,
            oldValue: old[f] || '',
            newValue: updates[f],
            editedBy: adminProfile?.uid || 'admin',
            editedByName: adminProfile?.name || 'Administrator'
          });
        }
      }

      // Write Audit Log
      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        adminEmail: adminProfile?.email,
        action: 'EDIT_CUSTOMER',
        entityType: 'customer',
        entityId: selectedCustomer.uid,
        details: `Edited customer profile for ${selectedCustomer.name}`,
        oldValue: { name: old.name, phone: old.phone, email: old.email, adminNote: old.adminNote },
        newValue: updates
      });

      showSuccess('Customer profile updated.');
      setSelectedCustomer((prev) => (prev ? { ...prev, ...updates } : null));
      setCustomers((prev) =>
        prev.map((c) => (c.uid === selectedCustomer.uid ? { ...c, ...updates } : c))
      );
      setEditModalOpen(false);
    } catch (err: any) {
      showError(err);
    } finally {
      setSavingEdit(false);
    }
  };

  // Cancel active order from customer drawer
  const handleCancelOrderForCustomer = async (orderId: string, orderNumber: string) => {
    try {
      const orderRef = doc(db, 'orders', orderId);
      const now = Timestamp.now();
      await updateDoc(orderRef, {
        status: 'Cancelled',
        cancelReason: 'Cancelled via customer admin profile',
        cancelFault: 'customer',
        cancelledBy: 'admin',
        statusHistory: arrayUnion({
          status: 'Cancelled',
          at: now,
          note: `Cancelled by Admin from Customer Profile (${adminProfile?.name})`
        }),
        updatedAt: now
      });

      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        adminEmail: adminProfile?.email,
        action: 'CANCEL_ORDER_FROM_CUSTOMER',
        entityType: 'order',
        entityId: orderId,
        details: `Cancelled active order #${orderNumber} directly from customer profile.`
      });

      showSuccess(`Order #${orderNumber} cancelled.`);
      setCustomerOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, status: 'Cancelled' } : o))
      );
    } catch (err: any) {
      showError(err);
    }
  };

  // CSV export for customer list
  const handleExportCustomersCsv = () => {
    const rows = filteredCustomers.map((c) => ({
      ID: c.uid,
      Name: c.name,
      Email: c.email,
      Phone: c.phone || '',
      Status: c.status || 'active',
      WalletBalance: c.walletBalance || 0,
      Registered: formatTimestamp(c.createdAt)
    }));
    exportToCsv(`delivio_customers_${new Date().toISOString().slice(0, 10)}`, rows);
  };

  // CSV export for customer's transaction history
  const handleExportCustomerTransactions = () => {
    if (!customerOrders.length) return;
    const rows = customerOrders.map((o) => ({
      OrderNumber: o.orderNumber,
      Service: o.serviceType,
      Status: o.status,
      Merchant: o.merchantName || '',
      TotalAmount: o.fees?.total || 0,
      PaymentMethod: o.paymentMethod,
      Date: formatTimestamp(o.createdAt)
    }));
    exportToCsv(`${selectedCustomer?.name || 'customer'}_transactions`, rows);
  };

  const sortedEditHistory = useMemo(() => {
    const list = [...customerEditHistory];
    if (historySortAsc) {
      return list.sort((a, b) => (a.at?.seconds || 0) - (b.at?.seconds || 0));
    }
    return list.sort((a, b) => (b.at?.seconds || 0) - (a.at?.seconds || 0));
  }, [customerEditHistory, historySortAsc]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">
            Customer Directory
          </h1>
          <p className="text-sm text-gray-500 dark:text-zinc-400 mt-0.5">
            Manage user accounts, delivery locations, transaction activity, and audit trails.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleExportCustomersCsv}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-gray-700 dark:text-zinc-300 hover:bg-gray-50 text-xs font-bold shadow-xs transition-colors"
          >
            <Download className="w-4 h-4" />
            <span>Export Customers</span>
          </button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-4 shadow-xs">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2 relative">
            <Search className="w-4 h-4 absolute left-3.5 top-3 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by customer name, phone number, email..."
              className="w-full pl-9 pr-4 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-amber-400"
            />
          </div>

          <div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-amber-400"
            >
              <option value="all">All Statuses</option>
              <option value="active">Active Accounts</option>
              <option value="blocked">Blocked Accounts</option>
            </select>
          </div>
        </div>
      </div>

      {/* Customer Table */}
      {loading ? (
        <TableSkeleton rows={8} cols={6} />
      ) : (
        <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 dark:bg-zinc-850/60 uppercase font-bold text-gray-500 dark:text-zinc-400 border-b border-gray-200 dark:border-zinc-800">
                <tr>
                  <th className="px-4 py-3.5">Customer</th>
                  <th className="px-4 py-3.5">Contact Details</th>
                  <th className="px-4 py-3.5">Status</th>
                  <th className="px-4 py-3.5">Wallet</th>
                  <th className="px-4 py-3.5">Registered</th>
                  <th className="px-4 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-zinc-800 font-medium">
                {filteredCustomers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-12 text-gray-400 text-xs">
                      No matching customers found.
                    </td>
                  </tr>
                ) : (
                  filteredCustomers.map((cust) => (
                    <tr
                      key={cust.uid}
                      onClick={() => setSelectedCustomer(cust)}
                      className="hover:bg-amber-50/50 dark:hover:bg-zinc-800/50 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-blue-100 dark:bg-blue-950/50 text-blue-800 dark:text-blue-300 font-bold flex items-center justify-center shrink-0">
                            {cust.photoUrl ? (
                              <img
                                src={cust.photoUrl}
                                alt={cust.name}
                                className="w-full h-full object-cover rounded-xl"
                              />
                            ) : (
                              <span>{cust.name.charAt(0)}</span>
                            )}
                          </div>
                          <div>
                            <div className="font-bold text-gray-900 dark:text-white">
                              {cust.name}
                            </div>
                            <div className="text-[10px] text-gray-400 font-mono">
                              UID: {cust.uid.substring(0, 8)}...
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-gray-900 dark:text-zinc-200">{cust.email}</div>
                        <div className="text-[11px] text-gray-400">{cust.phone || 'No phone'}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            cust.status === 'blocked'
                              ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                              : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                          }`}
                        >
                          {cust.status === 'blocked' ? 'Blocked' : 'Active'}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-bold text-gray-900 dark:text-white">
                        ₱{Number(cust.walletBalance || 0).toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                        {formatRelativeTime(cust.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div
                          className="flex items-center justify-end gap-1.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() => {
                              setSelectedCustomer(cust);
                              openEditModal(cust);
                            }}
                            className="p-1.5 text-gray-500 hover:text-amber-600 rounded-lg"
                            title="Edit customer"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => {
                              setCustomerToToggle(cust);
                              setBlockModalOpen(true);
                            }}
                            className={`p-1.5 rounded-lg ${
                              cust.status === 'blocked'
                                ? 'text-emerald-600 hover:bg-emerald-50'
                                : 'text-red-500 hover:bg-red-50'
                            }`}
                            title={cust.status === 'blocked' ? 'Restore customer' : 'Block customer'}
                          >
                            {cust.status === 'blocked' ? (
                              <UserCheck className="w-4 h-4" />
                            ) : (
                              <UserX className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Load More Button */}
          {hasMore && (
            <div className="p-4 border-t border-gray-100 dark:border-zinc-800 flex justify-center">
              <button
                onClick={() => fetchCustomers(true)}
                disabled={loadingMore}
                className="delivio-btn-yellow px-5 py-2 rounded-xl text-xs font-bold flex items-center gap-2"
              >
                {loadingMore && <Loader2 className="w-4 h-4 animate-spin" />}
                Load More Customers
              </button>
            </div>
          )}
        </div>
      )}

      {/* Customer Detail Drawer */}
      {selectedCustomer && (
        <div className="fixed inset-0 z-50 overflow-hidden flex justify-end bg-black/60 backdrop-blur-xs">
          <div
            className="w-full max-w-2xl bg-white dark:bg-zinc-950 border-l border-gray-200 dark:border-zinc-800 shadow-2xl flex flex-col h-full animate-in slide-in-from-right duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drawer Header */}
            <div className="p-5 border-b border-gray-200 dark:border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 font-extrabold text-xl flex items-center justify-center">
                  {selectedCustomer.photoUrl ? (
                    <img
                      src={selectedCustomer.photoUrl}
                      alt={selectedCustomer.name}
                      className="w-full h-full object-cover rounded-2xl"
                    />
                  ) : (
                    <span>{selectedCustomer.name.charAt(0)}</span>
                  )}
                </div>
                <div>
                  <h3 className="font-extrabold text-lg text-gray-900 dark:text-white flex items-center gap-2">
                    {selectedCustomer.name}
                    <span
                      className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${
                        selectedCustomer.status === 'blocked'
                          ? 'bg-red-100 text-red-800'
                          : 'bg-emerald-100 text-emerald-800'
                      }`}
                    >
                      {selectedCustomer.status}
                    </span>
                  </h3>
                  <p className="text-xs text-gray-400 font-mono">UID: {selectedCustomer.uid}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => openEditModal(selectedCustomer)}
                  className="delivio-btn-yellow px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 shadow-xs"
                >
                  <Edit className="w-3.5 h-3.5" /> Edit Profile
                </button>
                <button
                  onClick={() => setSelectedCustomer(null)}
                  className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-zinc-200 rounded-lg"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Drawer Tabs */}
            <div className="flex border-b border-gray-200 dark:border-zinc-800 px-5 pt-2">
              {[
                { id: 'overview', label: 'Overview' },
                { id: 'wallet', label: `Wallet (₱${Number(selectedCustomer.walletBalance || 0).toFixed(2)})` },
                { id: 'transactions', label: `Orders (${customerOrders.length})` },
                { id: 'history', label: `Edit History (${customerEditHistory.length})` },
                { id: 'location', label: 'Saved Location' }
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`pb-3 text-xs font-bold border-b-2 mr-5 transition-colors ${
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
              {/* TAB 1: OVERVIEW */}
              {activeTab === 'overview' && (
                <div className="space-y-6">
                  {/* Basic Contacts */}
                  <div className="p-4 rounded-2xl bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 space-y-2.5 text-xs">
                    <div className="flex justify-between items-center">
                      <span className="text-gray-500">Email:</span>
                      <span className="font-semibold text-gray-900 dark:text-white">
                        {selectedCustomer.email}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-500">Contact Phone:</span>
                      <a
                        href={`tel:${selectedCustomer.phone}`}
                        className="font-bold text-amber-600 dark:text-amber-400 hover:underline flex items-center gap-1"
                      >
                        <Phone className="w-3.5 h-3.5" />
                        {selectedCustomer.phone || 'N/A'}
                      </a>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-500">Wallet Balance:</span>
                      <span className="font-bold text-emerald-600 text-sm">
                        ₱{Number(selectedCustomer.walletBalance || 0).toFixed(2)}
                      </span>
                    </div>
                  </div>

                  {/* Linked Rider Card (query riders where linkedCustomerUid == uid) */}
                  {linkedRider ? (
                    <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="p-2 rounded-xl bg-amber-500 text-white font-bold">
                            <Bike className="w-4 h-4" />
                          </span>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs uppercase font-extrabold text-amber-900 dark:text-amber-300">
                                Linked Rider Account
                              </span>
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-200 dark:bg-amber-800 text-amber-900 dark:text-amber-100">
                                Shared Wallet Active
                              </span>
                            </div>
                            <p className="text-[11px] text-amber-800/80 dark:text-amber-300/80">
                              Both accounts share one unified wallet balance
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
                          <span className="text-gray-500 dark:text-zinc-400 text-[11px]">Rider Name:</span>
                          <p className="font-bold text-gray-900 dark:text-white">{linkedRider.name}</p>
                        </div>
                        <div>
                          <span className="text-gray-500 dark:text-zinc-400 text-[11px]">Rider Code:</span>
                          <p className="font-bold font-mono text-gray-900 dark:text-white">{linkedRider.riderCode}</p>
                        </div>
                        <div>
                          <span className="text-gray-500 dark:text-zinc-400 text-[11px]">Email:</span>
                          <p className="font-medium text-gray-700 dark:text-zinc-300 truncate">{linkedRider.email}</p>
                        </div>
                        <div>
                          <span className="text-gray-500 dark:text-zinc-400 text-[11px]">Phone:</span>
                          <p className="font-medium text-gray-700 dark:text-zinc-300">{linkedRider.phone || 'N/A'}</p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="p-3.5 rounded-2xl bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 flex items-center justify-between text-xs text-gray-500">
                      <div className="flex items-center gap-2">
                        <Bike className="w-4 h-4 text-gray-400" />
                        <span>No rider account linked to this customer.</span>
                      </div>
                    </div>
                  )}

                  {/* Internal Admin Note */}
                  <div className="p-4 rounded-2xl bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40">
                    <span className="text-xs font-bold uppercase tracking-wider text-amber-900 dark:text-amber-300 block mb-1">
                      Internal Admin Notes
                    </span>
                    <p className="text-xs text-amber-800/90 dark:text-amber-300/80 leading-relaxed">
                      {selectedCustomer.adminNote || 'No internal remarks noted for this customer.'}
                    </p>
                  </div>

                  {/* Customer Saved Addresses */}
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">
                      Saved Delivery Addresses ({customerAddresses.length})
                    </h4>
                    <div className="space-y-2">
                      {customerAddresses.length === 0 ? (
                        <div className="p-3 rounded-xl bg-gray-50 dark:bg-zinc-900 text-xs text-gray-400 text-center">
                          No saved addresses recorded in users/{selectedCustomer.uid}/addresses
                        </div>
                      ) : (
                        customerAddresses.map((addr) => (
                          <div
                            key={addr.id}
                            className="p-3 rounded-xl bg-gray-50 dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 text-xs"
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-bold text-gray-900 dark:text-white">
                                {addr.label}
                              </span>
                              {addr.isDefault && (
                                <span className="text-[10px] font-bold text-amber-600 uppercase">
                                  Default
                                </span>
                              )}
                            </div>
                            <p className="text-gray-600 dark:text-zinc-400">{addr.address}</p>
                            {addr.details && (
                              <p className="text-[11px] text-gray-400 italic mt-0.5">
                                Unit/Landmark: {addr.details}
                              </p>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Block / Restore Button */}
                  <div className="pt-4 border-t border-gray-100 dark:border-zinc-850">
                    <button
                      onClick={() => {
                        setCustomerToToggle(selectedCustomer);
                        setBlockModalOpen(true);
                      }}
                      className={`w-full py-2.5 rounded-xl text-xs font-bold transition-colors ${
                        selectedCustomer.status === 'blocked'
                          ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                          : 'bg-red-50 hover:bg-red-100 text-red-600 dark:bg-red-950/40 dark:text-red-400 border border-red-200 dark:border-red-900'
                      }`}
                    >
                      {selectedCustomer.status === 'blocked'
                        ? 'Restore Customer Account'
                        : 'Block Customer from Ordering'}
                    </button>
                  </div>
                </div>
              )}

              {/* TAB: WALLET MANAGEMENT & HISTORY */}
              {activeTab === 'wallet' && (
                <div className="space-y-6">
                  {/* Shared Wallet Badge if linked */}
                  {linkedRider && (
                    <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-300 dark:border-amber-700 flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <span className="p-1.5 rounded-xl bg-amber-500 text-white font-bold">
                          <Link2 className="w-4 h-4" />
                        </span>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-black text-amber-900 dark:text-amber-200 uppercase tracking-wide">
                              Shared Wallet Active
                            </span>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-200 dark:bg-amber-800 text-amber-900 dark:text-amber-100">
                              Linked with {linkedRider.name}
                            </span>
                          </div>
                          <p className="text-[11px] text-amber-800 dark:text-amber-300 mt-0.5">
                            Rider ({linkedRider.email}) and Customer share this identical balance. Top-ups & deductions update both accounts.
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          setUnlinkReason('');
                          setUnlinkModalOpen(true);
                        }}
                        className="text-xs font-bold text-red-600 dark:text-red-400 hover:underline px-2.5 py-1.5 rounded-lg border border-red-200 dark:border-red-900"
                      >
                        Unlink
                      </button>
                    </div>
                  )}

                  {/* Wallet Balance Hero Card */}
                  <div className="p-5 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-500 text-gray-950 shadow-md">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="p-2 bg-black/10 rounded-xl">
                          <Wallet className="w-5 h-5 text-gray-950" />
                        </div>
                        <span className="text-xs font-black uppercase tracking-wider text-gray-900/80">
                          Delivio Customer Wallet
                        </span>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-black/15 text-gray-950">
                        Realtime Balance
                      </span>
                    </div>

                    <div className="mt-4">
                      <div className="text-3xl font-black tracking-tight">
                        ₱{Number(selectedCustomer.walletBalance || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                      <p className="text-xs text-gray-900/80 mt-1 font-medium">
                        Stored in <code className="font-mono bg-black/10 px-1 rounded">users/{selectedCustomer.uid}.walletBalance</code>
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-2 mt-5">
                      <button
                        onClick={() => {
                          setAddCashAmount('');
                          setAddCashNote('');
                          setAddCashModalOpen(true);
                        }}
                        className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-gray-950 hover:bg-gray-900 text-white font-bold text-xs shadow-xs transition-colors"
                      >
                        <PlusCircle className="w-4 h-4 text-amber-400" />
                        <span>Add Cash</span>
                      </button>

                      <button
                        onClick={() => {
                          setAdjustAmount('');
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

                  {/* Wallet History List */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-zinc-400">
                        Wallet Activity & Ledger ({mergedWalletHistory.length})
                      </h4>
                      {mergedWalletHistory.length > 0 && (
                        <button
                          onClick={() => {
                            const rows = mergedWalletHistory.map((item) => ({
                              ID: item.id,
                              Type: item.type,
                              Title: item.title,
                              Amount: item.amount,
                              BalanceAfter: item.balanceAfter ?? '',
                              Note: item.note || '',
                              Admin: item.adminName || '',
                              Date: formatTimestamp(item.createdAt)
                            }));
                            exportToCsv(`${selectedCustomer.name}_wallet_history`, rows);
                          }}
                          className="text-xs text-amber-600 font-bold flex items-center gap-1 hover:underline"
                        >
                          <Download className="w-3.5 h-3.5" /> Export Ledger
                        </button>
                      )}
                    </div>

                    {loadingWallet ? (
                      <div className="py-8 flex justify-center text-xs text-gray-400 items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin text-amber-500" />
                        <span>Loading wallet ledger...</span>
                      </div>
                    ) : mergedWalletHistory.length === 0 ? (
                      <div className="p-8 text-center text-xs text-gray-400 rounded-2xl bg-gray-50 dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800">
                        No wallet transactions or wallet orders found for this customer.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {mergedWalletHistory.map((tx) => {
                          const isPositive = tx.amount > 0;
                          return (
                            <div
                              key={tx.id}
                              className="p-3.5 rounded-xl bg-gray-50 dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 text-xs flex items-start justify-between gap-3"
                            >
                              <div className="flex items-start gap-3">
                                <div
                                  className={`p-2 rounded-xl shrink-0 mt-0.5 ${
                                    tx.type === 'cash_in'
                                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                      : tx.type === 'refund'
                                      ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                                      : tx.type === 'adjustment'
                                      ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                                      : 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300'
                                  }`}
                                >
                                  {tx.type === 'cash_in' && <ArrowDownLeft className="w-4 h-4" />}
                                  {tx.type === 'adjustment' && <ArrowUpRight className="w-4 h-4" />}
                                  {tx.type === 'refund' && <CheckCircle2 className="w-4 h-4" />}
                                  {tx.type === 'order_payment' && <Receipt className="w-4 h-4" />}
                                </div>

                                <div className="space-y-0.5">
                                  <div className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
                                    <span>{tx.title}</span>
                                    <span
                                      className={`text-[9px] uppercase px-1.5 py-0.2 rounded font-extrabold ${
                                        tx.type === 'cash_in'
                                          ? 'bg-emerald-100 text-emerald-800'
                                          : tx.type === 'refund'
                                          ? 'bg-blue-100 text-blue-800'
                                          : tx.type === 'adjustment'
                                          ? 'bg-amber-100 text-amber-800'
                                          : 'bg-gray-200 text-gray-800 dark:bg-zinc-800 dark:text-zinc-200'
                                      }`}
                                    >
                                      {tx.type}
                                    </span>
                                  </div>
                                  {tx.note && (
                                    <p className="text-[11px] text-gray-600 dark:text-zinc-400">
                                      {tx.note}
                                    </p>
                                  )}
                                  <div className="flex items-center gap-2 text-[10px] text-gray-400 pt-0.5">
                                    <span>{formatTimestamp(tx.createdAt)}</span>
                                    {tx.adminName && <span>• Admin: {tx.adminName}</span>}
                                    {tx.balanceAfter !== undefined && (
                                      <span>• Balance after: ₱{Number(tx.balanceAfter).toFixed(2)}</span>
                                    )}
                                  </div>
                                </div>
                              </div>

                              <div className="text-right shrink-0">
                                <div
                                  className={`text-sm font-black font-mono ${
                                    isPositive
                                      ? 'text-emerald-600 dark:text-emerald-400'
                                      : 'text-red-600 dark:text-red-400'
                                  }`}
                                >
                                  {isPositive ? '+' : ''}₱{Math.abs(tx.amount).toFixed(2)}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 3: TRANSACTIONS / ORDERS */}
              {activeTab === 'transactions' && (
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-gray-500">
                      Total Orders: {customerOrders.length}
                    </span>
                    <button
                      onClick={handleExportCustomerTransactions}
                      className="text-xs text-amber-600 font-bold flex items-center gap-1 hover:underline"
                    >
                      <Download className="w-3.5 h-3.5" /> Export Orders
                    </button>
                  </div>

                  <div className="space-y-2.5">
                    {customerOrders.length === 0 ? (
                      <div className="p-8 text-center text-xs text-gray-400">
                        No orders recorded for this customer.
                      </div>
                    ) : (
                      customerOrders.map((ord) => {
                        const isActive =
                          ord.status !== 'Delivered' &&
                          ord.status !== 'Cancelled' &&
                          ord.status !== 'Rejected';

                        return (
                          <div
                            key={ord.id}
                            className="p-3.5 rounded-xl bg-gray-50 dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 text-xs space-y-1.5"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-mono font-bold text-gray-900 dark:text-white">
                                #{ord.orderNumber}
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  ord.status === 'Delivered'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : ord.status === 'Cancelled'
                                    ? 'bg-red-100 text-red-800'
                                    : 'bg-amber-100 text-amber-800'
                                }`}
                              >
                                {ord.status}
                              </span>
                            </div>

                            <div className="flex justify-between text-gray-600 dark:text-zinc-400">
                              <span>{ord.merchantName || ord.serviceType}</span>
                              <span className="font-bold text-gray-900 dark:text-white">
                                ₱{Number(ord.fees?.total || 0).toFixed(2)}
                              </span>
                            </div>

                            <div className="flex justify-between items-center text-[11px] text-gray-400 pt-1">
                              <span>{formatTimestamp(ord.createdAt)}</span>
                              {isActive && (
                                <button
                                  onClick={() =>
                                    handleCancelOrderForCustomer(ord.id, ord.orderNumber || ord.id)
                                  }
                                  className="text-red-500 font-bold hover:underline"
                                >
                                  Cancel Active Order
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {/* TAB 3: EDIT HISTORY */}
              {activeTab === 'history' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-gray-500">
                      Modifications Log ({customerEditHistory.length})
                    </span>
                    <button
                      onClick={() => setHistorySortAsc(!historySortAsc)}
                      className="flex items-center gap-1 text-xs text-amber-600 font-bold hover:underline"
                    >
                      <ArrowUpDown className="w-3.5 h-3.5" />
                      {historySortAsc ? 'Oldest First' : 'Newest First'}
                    </button>
                  </div>

                  <div className="space-y-2">
                    {sortedEditHistory.length === 0 ? (
                      <div className="p-8 text-center text-xs text-gray-400">
                        No profile edit history recorded.
                      </div>
                    ) : (
                      sortedEditHistory.map((entry, idx) => (
                        <div
                          key={idx}
                          className="p-3 rounded-xl bg-gray-50 dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 text-xs space-y-1"
                        >
                          <div className="flex justify-between items-center">
                            <span className="font-bold uppercase text-amber-600 text-[10px]">
                              Field: {entry.field}
                            </span>
                            <span className="text-gray-400 text-[10px]">
                              {formatTimestamp(entry.at)}
                            </span>
                          </div>
                          <div className="text-gray-600 dark:text-zinc-300">
                            Changed from{' '}
                            <span className="line-through text-red-500">
                              "{String(entry.oldValue || 'none')}"
                            </span>{' '}
                            to{' '}
                            <span className="font-bold text-emerald-600">
                              "{String(entry.newValue)}"
                            </span>
                          </div>
                          <div className="text-[10px] text-gray-400">
                            Edited by {entry.editedByName}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* TAB 4: LOCATION MAP */}
              {activeTab === 'location' && (
                <div className="space-y-3">
                  <div
                    ref={customerMapRef}
                    className="h-72 w-full rounded-2xl border border-gray-200 dark:border-zinc-800 overflow-hidden shadow-xs"
                  />
                  <div className="p-3 rounded-xl bg-gray-50 dark:bg-zinc-900 text-xs space-y-1">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Latitude:</span>
                      <span className="font-mono text-gray-800 dark:text-zinc-200">
                        {selectedCustomer.location?.lat || 'N/A'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Longitude:</span>
                      <span className="font-mono text-gray-800 dark:text-zinc-200">
                        {selectedCustomer.location?.lng || 'N/A'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Last Active Coordinates:</span>
                      <span className="font-semibold text-gray-800 dark:text-zinc-200">
                        {formatRelativeTime(selectedCustomer.location?.updatedAt)}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Edit Customer Profile Modal */}
      {editModalOpen && selectedCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-lg text-gray-900 dark:text-white">
                Edit Customer Details
              </h3>
              <button
                onClick={() => setEditModalOpen(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveCustomerEdit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Customer Name
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  required
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Phone Number
                </label>
                <input
                  type="text"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Profile Email
                </label>
                <input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-gray-900 dark:text-white"
                />
                <div className="mt-1.5 p-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 flex items-start gap-1.5 text-[11px] text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
                  <span>This does not change the customer's login email.</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Internal Operations Note
                </label>
                <textarea
                  rows={2}
                  value={editAdminNote}
                  onChange={(e) => setEditAdminNote(e.target.value)}
                  placeholder="Notes visible only to admin operators..."
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditModalOpen(false)}
                  disabled={savingEdit}
                  className="px-4 py-2 text-xs font-bold text-gray-600 hover:bg-gray-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="delivio-btn-yellow px-5 py-2 text-xs font-bold rounded-xl flex items-center gap-2 disabled:opacity-50"
                >
                  {savingEdit && <Loader2 className="w-4 h-4 animate-spin" />}
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Cash to Customer Wallet Modal */}
      {addCashModalOpen && selectedCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 rounded-xl">
                  <PlusCircle className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-lg text-gray-900 dark:text-white">
                  Add Cash to Customer Wallet
                </h3>
              </div>
              <button
                onClick={() => setAddCashModalOpen(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-gray-500 mb-4">
              Directly credit cash into <span className="font-bold text-gray-900 dark:text-white">{selectedCustomer.name}</span>'s wallet.
              Current balance: <span className="font-bold text-emerald-600">₱{Number(selectedCustomer.walletBalance || 0).toFixed(2)}</span>
            </p>

            <form onSubmit={handleAddCash} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Amount to Deposit (PHP) <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-2.5 font-bold text-gray-400 text-sm">₱</span>
                  <input
                    type="number"
                    min="1"
                    step="0.01"
                    value={addCashAmount}
                    onChange={(e) => setAddCashAmount(e.target.value)}
                    placeholder="0.00"
                    required
                    className="w-full pl-8 pr-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm font-bold text-gray-900 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Note / Reference Description
                </label>
                <textarea
                  rows={2}
                  value={addCashNote}
                  onChange={(e) => setAddCashNote(e.target.value)}
                  placeholder="e.g. Cash payment received at office, bank transfer ref #..."
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAddCashModalOpen(false)}
                  disabled={submittingCashIn}
                  className="px-4 py-2 text-xs font-bold text-gray-600 hover:bg-gray-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingCashIn}
                  className="delivio-btn-yellow px-5 py-2 text-xs font-bold rounded-xl flex items-center gap-2 disabled:opacity-50"
                >
                  {submittingCashIn && <Loader2 className="w-4 h-4 animate-spin" />}
                  Confirm Cash In
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Adjust / Deduct Customer Wallet Modal */}
      {adjustModalOpen && selectedCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300 rounded-xl">
                  <MinusCircle className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-lg text-gray-900 dark:text-white">
                  Adjust / Deduct Customer Wallet
                </h3>
              </div>
              <button
                onClick={() => setAdjustModalOpen(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 mb-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-xs text-amber-800 dark:text-amber-300">
              Current Available Balance:{' '}
              <span className="font-extrabold text-sm">
                ₱{Number(selectedCustomer.walletBalance || 0).toFixed(2)}
              </span>
              <p className="text-[11px] mt-1 text-amber-700 dark:text-amber-400">
                Wallet deductions cannot take the balance below ₱0.00. A valid operational reason is required.
              </p>
            </div>

            <form onSubmit={handleAdjustDeduct} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Amount to Deduct (PHP) <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-2.5 font-bold text-gray-400 text-sm">₱</span>
                  <input
                    type="number"
                    min="0.01"
                    max={Number(selectedCustomer.walletBalance || 0)}
                    step="0.01"
                    value={adjustAmount}
                    onChange={(e) => setAdjustAmount(e.target.value)}
                    placeholder="0.00"
                    required
                    className="w-full pl-8 pr-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm font-bold text-gray-900 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Reason for Deduction <span className="text-red-500">*</span>
                </label>
                <textarea
                  rows={2}
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  required
                  placeholder="e.g. Reversing incorrect top-up, dispute resolution, fee penalty..."
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAdjustModalOpen(false)}
                  disabled={submittingAdjust}
                  className="px-4 py-2 text-xs font-bold text-gray-600 hover:bg-gray-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingAdjust || parseFloat(adjustAmount) > Number(selectedCustomer.walletBalance || 0)}
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

      {/* Block / Restore Confirmation Modal */}
      {blockModalOpen && customerToToggle && (
        <ConfirmationModal
          isOpen={blockModalOpen}
          onClose={() => setBlockModalOpen(false)}
          onConfirm={handleToggleBlock}
          title={
            customerToToggle.status === 'blocked'
              ? `Restore ${customerToToggle.name}`
              : `Block ${customerToToggle.name}`
          }
          message={
            customerToToggle.status === 'blocked'
              ? `Are you sure you want to unblock ${customerToToggle.name}? The customer will regain full access to place delivery orders.`
              : `Blocking will immediately prevent ${customerToToggle.name} from placing new orders on Delivio.`
          }
          confirmLabel={
            customerToToggle.status === 'blocked' ? 'Restore Customer' : 'Block Customer'
          }
          reasonRequired={true}
          reasonPlaceholder="Specify reason (e.g. repeated fraudulent orders, chargebacks, user request)..."
          isDestructive={customerToToggle.status !== 'blocked'}
        />
      )}

      {/* Unlink Rider Confirmation Modal */}
      {unlinkModalOpen && linkedRider && selectedCustomer && (
        <ConfirmationModal
          isOpen={unlinkModalOpen}
          onClose={() => setUnlinkModalOpen(false)}
          onConfirm={async (reason) => {
            await handleUnlinkRider(reason);
          }}
          title={`Unlink Rider ${linkedRider.name}`}
          message={`Are you sure you want to unlink rider ${linkedRider.name} from customer ${selectedCustomer.name}? The shared wallet balance will remain on the customer account (${selectedCustomer.email}). The rider's wallet balance will be separate.`}
          confirmLabel="Unlink Rider Account"
          reasonRequired={true}
          reasonPlaceholder="State mandatory reason for unlinking (e.g. driver switched phone, account split, admin audit)..."
          isDestructive={true}
        />
      )}
    </div>
  );
};
