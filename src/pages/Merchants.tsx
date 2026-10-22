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
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  Timestamp,
  writeBatch
} from '../firebase';
import { useCity } from '../context/CityContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { logAuditEvent, logEditHistory } from '../utils/audit';
import { exportToCsv } from '../utils/exportCsv';
import { formatTimestamp, formatRelativeTime } from '../utils/date';
import type { Merchant, MenuItem, MenuCategory, Order, ChangeRequest, EditHistoryEntry } from '../types';
import {
  Search,
  Store,
  MapPin,
  Phone,
  Mail,
  DollarSign,
  Percent,
  CheckCircle2,
  AlertTriangle,
  X,
  Edit,
  Trash2,
  Plus,
  Loader2,
  Download,
  Power,
  RotateCw,
  ShoppingBag,
  ExternalLink,
  Layers,
  FileCheck
} from 'lucide-react';
import { ConfirmationModal } from '../components/common/ConfirmationModal';
import { TableSkeleton } from '../components/common/SkeletonLoader';

export const Merchants: React.FC = () => {
  const [searchParams] = useSearchParams();
  const initialSearch = searchParams.get('search') || '';

  const { selectedCityId, cities } = useCity();
  const { adminProfile } = useAuth();
  const { showSuccess, showError } = useToast();

  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [typeFilter, setTypeFilter] = useState<'all' | 'food' | 'convenience'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'suspended'>('all');
  const [openFilter, setOpenFilter] = useState<'all' | 'open' | 'closed'>('all');

  // Selected Merchant for detail
  const [selectedMerchant, setSelectedMerchant] = useState<Merchant | null>(null);
  const [activeTab, setActiveTab] = useState<'details' | 'status' | 'location' | 'menu' | 'orders' | 'changes' | 'history'>('details');

  // Details Edit State
  const [shopName, setShopName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [description, setDescription] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [bannerUrl, setBannerUrl] = useState('');
  const [commissionRate, setCommissionRate] = useState<number>(15);
  const [savingDetails, setSavingDetails] = useState(false);

  // Menu Categories & Items
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [loadingMenu, setLoadingMenu] = useState(false);

  // Add / Edit Item Modal
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [itemName, setItemName] = useState('');
  const [itemPrice, setItemPrice] = useState<number>(0);
  const [itemDesc, setItemDesc] = useState('');
  const [itemImageUrl, setItemImageUrl] = useState('');
  const [itemCategory, setItemCategory] = useState('');
  const [itemAvailable, setItemAvailable] = useState(true);
  const [savingItem, setSavingItem] = useState(false);

  // Bulk Price Modal
  const [bulkPriceModalOpen, setBulkPriceModalOpen] = useState(false);
  const [bulkMode, setBulkMode] = useState<'percent' | 'fixed'>('percent');
  const [bulkValue, setBulkValue] = useState<number>(10);
  const [bulkDirection, setBulkDirection] = useState<'increase' | 'decrease'>('increase');
  const [applyingBulk, setApplyingBulk] = useState(false);

  // Orders, Earnings & Payouts
  const [merchantOrders, setMerchantOrders] = useState<Order[]>([]);
  const [payouts, setPayouts] = useState<any[]>([]);
  const [creatingPayout, setCreatingPayout] = useState(false);
  const [payoutAmount, setPayoutAmount] = useState<number>(0);

  // Change Requests
  const [changeRequests, setChangeRequests] = useState<ChangeRequest[]>([]);
  const [rejectChangeModalOpen, setRejectChangeModalOpen] = useState(false);
  const [targetChangeRequest, setTargetChangeRequest] = useState<ChangeRequest | null>(null);

  // Edit History
  const [editHistory, setEditHistory] = useState<EditHistoryEntry[]>([]);

  // Location Tab Leaflet Map Ref
  const locationMapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const [locLat, setLocLat] = useState<number>(9.7392);
  const [locLng, setLocLng] = useState<number>(118.7353);
  const [locAddress, setLocAddress] = useState<string>('');
  const [nominatimSearch, setNominatimSearch] = useState('');
  const [searchingNominatim, setSearchingNominatim] = useState(false);
  const [nominatimResults, setNominatimResults] = useState<any[]>([]);
  const [savingLocation, setSavingLocation] = useState(false);

  // 1. Fetch Merchants
  const fetchMerchants = async () => {
    try {
      setLoading(true);
      const q = query(collection(db, 'merchants'), limit(200));
      const snap = await getDocs(q);
      const list: Merchant[] = [];
      snap.forEach((d) => {
        const dt = d.data();
        list.push({
          id: d.id,
          name: dt.name || 'Store',
          ownerName: dt.ownerName || '',
          email: dt.email || '',
          phone: dt.phone || '',
          type: dt.type || 'food',
          typeLocked: dt.typeLocked,
          status: dt.status || 'active',
          isOpen: Boolean(dt.isOpen),
          ownerUid: dt.ownerUid,
          cityId: dt.cityId,
          cuisineTags: dt.cuisineTags || [],
          address: dt.address || '',
          lat: Number(dt.lat) || 0,
          lng: Number(dt.lng) || 0,
          logoUrl: dt.logoUrl,
          bannerUrl: dt.bannerUrl,
          description: dt.description || '',
          commissionRate: dt.commissionRate ?? 15,
          createdAt: dt.createdAt
        });
      });
      list.sort((a, b) => a.name.localeCompare(b.name));
      setMerchants(list);
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMerchants();
  }, []);

  // Sync selected merchant fields when selected
  useEffect(() => {
    if (!selectedMerchant) return;
    setShopName(selectedMerchant.name || '');
    setOwnerName(selectedMerchant.ownerName || '');
    setPhone(selectedMerchant.phone || '');
    setEmail(selectedMerchant.email || '');
    setDescription(selectedMerchant.description || '');
    setLogoUrl(selectedMerchant.logoUrl || '');
    setBannerUrl(selectedMerchant.bannerUrl || '');
    setCommissionRate(selectedMerchant.commissionRate ?? 15);
    setLocLat(selectedMerchant.lat || 9.7392);
    setLocLng(selectedMerchant.lng || 118.7353);
    setLocAddress(selectedMerchant.address || '');

    // Fetch Menu
    fetchMenuData(selectedMerchant.id);
    // Fetch Orders & Payouts
    fetchOrdersAndPayouts(selectedMerchant.id);
    // Fetch Change Requests
    fetchChangeRequests(selectedMerchant.id);
    // Fetch Edit History
    fetchEditHistory(selectedMerchant.id);
  }, [selectedMerchant]);

  // Fetch Menu Categories & Items
  const fetchMenuData = async (merchantId: string) => {
    try {
      setLoadingMenu(true);
      // Categories
      const catRef = collection(db, 'merchants', merchantId, 'categories');
      const catSnap = await getDocs(catRef);
      const catList: MenuCategory[] = [];
      catSnap.forEach((d) => catList.push({ id: d.id, ...d.data() } as MenuCategory));
      setCategories(catList);

      // Items
      const itemsRef = collection(db, 'merchants', merchantId, 'items');
      const itemsSnap = await getDocs(itemsRef);
      const itemsList: MenuItem[] = [];
      itemsSnap.forEach((d) => {
        const dt = d.data();
        itemsList.push({
          id: d.id,
          categoryId: dt.categoryId,
          name: dt.name || 'Item',
          price: Number(dt.price) || 0,
          description: dt.description || '',
          imageUrl: dt.imageUrl || '',
          available: dt.available !== false,
          createdAt: dt.createdAt
        });
      });
      setMenuItems(itemsList);
    } catch (err) {
      console.error('Failed to load menu:', err);
    } finally {
      setLoadingMenu(false);
    }
  };

  // Fetch Orders and Payouts
  const fetchOrdersAndPayouts = async (merchantId: string) => {
    try {
      const q = query(collection(db, 'orders'), where('merchantId', '==', merchantId), limit(200));
      const snap = await getDocs(q);
      const ords: Order[] = [];
      snap.forEach((d) => {
        const dt = d.data();
        ords.push({
          id: d.id,
          orderNumber: dt.orderNumber || d.id.substring(0, 8),
          serviceType: dt.serviceType,
          customerId: dt.customerId,
          customerName: dt.customerName,
          merchantId: dt.merchantId,
          merchantName: dt.merchantName,
          status: dt.status,
          statusHistory: dt.statusHistory || [],
          fees: dt.fees || { subtotal: 0, deliveryFee: 0, serviceFee: 0, discount: 0, total: 0 },
          paymentMethod: dt.paymentMethod,
          createdAt: dt.createdAt
        });
      });
      ords.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setMerchantOrders(ords);

      // Payouts from merchantPayouts collection
      const pRef = collection(db, 'merchantPayouts');
      const pSnap = await getDocs(query(pRef, where('merchantId', '==', merchantId), limit(50)));
      const pList: any[] = [];
      pSnap.forEach((d) => pList.push({ id: d.id, ...d.data() }));
      pList.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setPayouts(pList);
    } catch (err) {
      console.error('Failed to load orders/payouts:', err);
    }
  };

  // Fetch Change Requests
  const fetchChangeRequests = async (merchantId: string) => {
    try {
      const q = query(collection(db, 'changeRequests'), where('merchantId', '==', merchantId), limit(50));
      const snap = await getDocs(q);
      const list: ChangeRequest[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as ChangeRequest));
      setChangeRequests(list);
    } catch (err) {
      console.error('Failed to load change requests:', err);
    }
  };

  // Fetch Edit History
  const fetchEditHistory = async (merchantId: string) => {
    try {
      const q = query(collection(db, 'editHistory'), where('entityId', '==', merchantId), limit(50));
      const snap = await getDocs(q);
      const list: EditHistoryEntry[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as EditHistoryEntry));
      list.sort((a, b) => (b.at?.seconds || 0) - (a.at?.seconds || 0));
      setEditHistory(list);
    } catch (err) {
      console.error('Failed to load edit history:', err);
    }
  };

  // Location Tab Leaflet Map with draggable marker & Nominatim search
  useEffect(() => {
    if (activeTab !== 'location' || !selectedMerchant || !locationMapRef.current) return;

    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    const lat = locLat || 9.7392;
    const lng = locLng || 118.7353;

    const map = L.map(locationMapRef.current, {
      center: [lat, lng],
      zoom: 15,
      zoomControl: false
    });

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap'
    }).addTo(map);

    const marker = L.marker([lat, lng], { draggable: true }).addTo(map);
    marker.on('dragend', () => {
      const pos = marker.getLatLng();
      setLocLat(pos.lat);
      setLocLng(pos.lng);
    });

    markerRef.current = marker;
    mapInstanceRef.current = map;

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [activeTab, selectedMerchant]);

  // Nominatim Search (countrycodes=ph)
  const handleNominatimSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nominatimSearch.trim()) return;
    try {
      setSearchingNominatim(true);
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&countrycodes=ph&q=${encodeURIComponent(
          nominatimSearch.trim()
        )}`
      );
      const data = await res.json();
      setNominatimResults(data || []);
    } catch (err) {
      showError('Failed to search address on OpenStreetMap');
    } finally {
      setSearchingNominatim(false);
    }
  };

  const selectNominatimResult = (res: any) => {
    const lat = parseFloat(res.lat);
    const lng = parseFloat(res.lon);
    setLocLat(lat);
    setLocLng(lng);
    setLocAddress(res.display_name);
    setNominatimResults([]);

    if (mapInstanceRef.current && markerRef.current) {
      mapInstanceRef.current.flyTo([lat, lng], 16);
      markerRef.current.setLatLng([lat, lng]);
    }
  };

  // Save Location
  const handleSaveLocation = async () => {
    if (!selectedMerchant) return;
    try {
      setSavingLocation(true);
      const mRef = doc(db, 'merchants', selectedMerchant.id);
      await updateDoc(mRef, {
        address: locAddress,
        lat: locLat,
        lng: locLng,
        updatedAt: Timestamp.now()
      });

      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        action: 'UPDATE_MERCHANT_LOCATION',
        entityType: 'merchant',
        entityId: selectedMerchant.id,
        details: `Updated coordinates to [${locLat}, ${locLng}], Address: ${locAddress}`
      });

      showSuccess('Store location updated.');
      setSelectedMerchant((prev) =>
        prev ? { ...prev, address: locAddress, lat: locLat, lng: locLng } : null
      );
    } catch (err: any) {
      showError(err);
    } finally {
      setSavingLocation(false);
    }
  };

  // Save Details
  const handleSaveDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMerchant) return;
    try {
      setSavingDetails(true);
      const mRef = doc(db, 'merchants', selectedMerchant.id);
      const updates: Record<string, any> = {
        name: shopName.trim(),
        ownerName: ownerName.trim(),
        phone: phone.trim(),
        email: email.trim(),
        description: description.trim(),
        logoUrl: logoUrl.trim(),
        bannerUrl: bannerUrl.trim(),
        commissionRate: Number(commissionRate) || 15,
        updatedAt: Timestamp.now()
      };

      await updateDoc(mRef, updates);

      // Track edit history
      const old = selectedMerchant;
      for (const key of ['name', 'ownerName', 'phone', 'email', 'commissionRate'] as const) {
        if ((old[key] as any) !== (updates[key] as any)) {
          await logEditHistory({
            entityType: 'merchant',
            entityId: selectedMerchant.id,
            field: key,
            oldValue: old[key],
            newValue: updates[key],
            editedBy: adminProfile?.uid || 'admin',
            editedByName: adminProfile?.name || 'Administrator'
          });
        }
      }

      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        action: 'EDIT_MERCHANT_DETAILS',
        entityType: 'merchant',
        entityId: selectedMerchant.id,
        details: `Updated details for store ${shopName}`
      });

      showSuccess('Merchant details saved.');
      setSelectedMerchant((prev) => (prev ? { ...prev, ...updates } : null));
      setMerchants((prev) =>
        prev.map((m) => (m.id === selectedMerchant.id ? { ...m, ...updates } : m))
      );
    } catch (err: any) {
      showError(err);
    } finally {
      setSavingDetails(false);
    }
  };

  // Suspend / Restore Merchant
  const handleToggleSuspend = async () => {
    if (!selectedMerchant) return;
    try {
      const isSuspended = selectedMerchant.status === 'suspended';
      const newStatus = isSuspended ? 'active' : 'suspended';

      const batch = writeBatch(db);
      const mRef = doc(db, 'merchants', selectedMerchant.id);
      batch.update(mRef, {
        status: newStatus,
        isOpen: isSuspended ? selectedMerchant.isOpen : false,
        updatedAt: Timestamp.now()
      });

      if (selectedMerchant.ownerUid || selectedMerchant.id) {
        const uRef = doc(db, 'users', selectedMerchant.ownerUid || selectedMerchant.id);
        batch.update(uRef, { status: newStatus });
      }

      await batch.commit();

      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        action: isSuspended ? 'RESTORE_MERCHANT' : 'SUSPEND_MERCHANT',
        entityType: 'merchant',
        entityId: selectedMerchant.id,
        details: `${isSuspended ? 'Restored' : 'Suspended'} merchant ${selectedMerchant.name}`
      });

      showSuccess(`Merchant marked as ${newStatus}.`);
      setSelectedMerchant((prev) =>
        prev
          ? {
              ...prev,
              status: newStatus,
              isOpen: isSuspended ? prev.isOpen : false
            }
          : null
      );
      setMerchants((prev) =>
        prev.map((m) =>
          m.id === selectedMerchant.id
            ? {
                ...m,
                status: newStatus,
                isOpen: isSuspended ? m.isOpen : false
              }
            : m
        )
      );
    } catch (err: any) {
      showError(err);
    }
  };

  // Open / Close Toggle
  const handleToggleOpenClose = async () => {
    if (!selectedMerchant) return;
    try {
      const newOpenState = !selectedMerchant.isOpen;
      const mRef = doc(db, 'merchants', selectedMerchant.id);
      await updateDoc(mRef, {
        isOpen: newOpenState,
        updatedAt: Timestamp.now()
      });

      showSuccess(`Store is now ${newOpenState ? 'OPEN' : 'CLOSED'}`);
      setSelectedMerchant((prev) => (prev ? { ...prev, isOpen: newOpenState } : null));
      setMerchants((prev) =>
        prev.map((m) => (m.id === selectedMerchant.id ? { ...m, isOpen: newOpenState } : m))
      );
    } catch (err: any) {
      showError(err);
    }
  };

  // Business Type Switch
  const handleChangeBusinessType = async (newType: 'food' | 'convenience') => {
    if (!selectedMerchant || selectedMerchant.type === newType) return;
    try {
      const mRef = doc(db, 'merchants', selectedMerchant.id);
      await updateDoc(mRef, {
        type: newType,
        updatedAt: Timestamp.now()
      });

      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        action: 'CHANGE_MERCHANT_TYPE',
        entityType: 'merchant',
        entityId: selectedMerchant.id,
        details: `Changed business type to ${newType}`
      });

      showSuccess(`Business type changed to ${newType}.`);
      setSelectedMerchant((prev) => (prev ? { ...prev, type: newType } : null));
      setMerchants((prev) =>
        prev.map((m) => (m.id === selectedMerchant.id ? { ...m, type: newType } : m))
      );
    } catch (err: any) {
      showError(err);
    }
  };

  // Menu: Add / Edit Item
  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMerchant) return;
    try {
      setSavingItem(true);
      const itemsCol = collection(db, 'merchants', selectedMerchant.id, 'items');

      if (editingItem) {
        // Edit
        const itemDoc = doc(db, 'merchants', selectedMerchant.id, 'items', editingItem.id);
        await updateDoc(itemDoc, {
          name: itemName.trim(),
          price: Number(itemPrice) || 0,
          description: itemDesc.trim(),
          imageUrl: itemImageUrl.trim(),
          categoryId: itemCategory,
          available: itemAvailable,
          updatedAt: Timestamp.now()
        });
        showSuccess('Item updated.');
      } else {
        // Add
        await addDoc(itemsCol, {
          name: itemName.trim(),
          price: Number(itemPrice) || 0,
          description: itemDesc.trim(),
          imageUrl: itemImageUrl.trim(),
          categoryId: itemCategory,
          available: itemAvailable,
          createdAt: Timestamp.now()
        });
        showSuccess('Item created.');
      }

      setItemModalOpen(false);
      fetchMenuData(selectedMerchant.id);
    } catch (err: any) {
      showError(err);
    } finally {
      setSavingItem(false);
    }
  };

  // Delete Item
  const handleDeleteItem = async (itemId: string) => {
    if (!selectedMerchant) return;
    if (!confirm('Are you sure you want to delete this menu item?')) return;
    try {
      const itemDoc = doc(db, 'merchants', selectedMerchant.id, 'items', itemId);
      await deleteDoc(itemDoc);
      showSuccess('Item deleted.');
      fetchMenuData(selectedMerchant.id);
    } catch (err: any) {
      showError(err);
    }
  };

  // Bulk Price Change
  const handleApplyBulkPrice = async () => {
    if (!selectedMerchant || !menuItems.length) return;
    try {
      setApplyingBulk(true);
      const batch = writeBatch(db);

      menuItems.forEach((item) => {
        let newPrice = item.price;
        if (bulkMode === 'percent') {
          const factor = bulkDirection === 'increase' ? 1 + bulkValue / 100 : 1 - bulkValue / 100;
          newPrice = Math.max(1, Math.round(item.price * factor));
        } else {
          newPrice =
            bulkDirection === 'increase'
              ? item.price + bulkValue
              : Math.max(1, item.price - bulkValue);
        }

        const itemRef = doc(db, 'merchants', selectedMerchant.id, 'items', item.id);
        batch.update(itemRef, { price: newPrice });
      });

      await batch.commit();

      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        action: 'BULK_PRICE_CHANGE',
        entityType: 'merchant',
        entityId: selectedMerchant.id,
        details: `Bulk adjusted ${menuItems.length} menu items by ${bulkDirection} of ${bulkValue}${bulkMode === 'percent' ? '%' : ' PHP'}`
      });

      showSuccess(`Applied bulk price changes to ${menuItems.length} items.`);
      setBulkPriceModalOpen(false);
      fetchMenuData(selectedMerchant.id);
    } catch (err: any) {
      showError(err);
    } finally {
      setApplyingBulk(false);
    }
  };

  // Create Payout Request
  const handleCreatePayout = async () => {
    if (!selectedMerchant || payoutAmount <= 0) return;
    try {
      setCreatingPayout(true);
      const pRef = collection(db, 'merchantPayouts');
      await addDoc(pRef, {
        merchantId: selectedMerchant.id,
        merchantName: selectedMerchant.name,
        amount: Number(payoutAmount),
        status: 'Pending',
        createdAt: Timestamp.now()
      });

      showSuccess('Payout request generated.');
      setPayoutAmount(0);
      fetchOrdersAndPayouts(selectedMerchant.id);
    } catch (err: any) {
      showError(err);
    } finally {
      setCreatingPayout(false);
    }
  };

  // Mark Payout as Paid
  const handleMarkPayoutPaid = async (payoutId: string) => {
    try {
      const pRef = doc(db, 'merchantPayouts', payoutId);
      await updateDoc(pRef, {
        status: 'Paid',
        paidAt: Timestamp.now(),
        paidBy: adminProfile?.name || 'Admin'
      });
      showSuccess('Payout marked as Paid.');
      if (selectedMerchant) fetchOrdersAndPayouts(selectedMerchant.id);
    } catch (err: any) {
      showError(err);
    }
  };

  // Change Requests: Approve
  const handleApproveChange = async (req: ChangeRequest) => {
    if (!selectedMerchant) return;
    try {
      const mRef = doc(db, 'merchants', selectedMerchant.id);
      const batch = writeBatch(db);

      if (req.kind === 'type') {
        batch.update(mRef, { type: req.newValue });
      } else if (req.kind === 'shopName') {
        batch.update(mRef, { name: req.newValue });
      } else if (req.kind === 'email') {
        batch.update(mRef, { email: req.newValue });
      }

      const reqRef = doc(db, 'changeRequests', req.id);
      batch.update(reqRef, {
        status: 'Approved',
        reviewedBy: adminProfile?.name || 'Admin',
        reviewedAt: Timestamp.now()
      });

      await batch.commit();

      showSuccess('Change request approved and applied.');
      fetchChangeRequests(selectedMerchant.id);
      fetchMerchants();
    } catch (err: any) {
      showError(err);
    }
  };

  // Change Requests: Reject
  const handleRejectChange = async (reason: string) => {
    if (!targetChangeRequest) return;
    try {
      const reqRef = doc(db, 'changeRequests', targetChangeRequest.id);
      await updateDoc(reqRef, {
        status: 'Rejected',
        rejectReason: reason,
        reviewedBy: adminProfile?.name || 'Admin',
        reviewedAt: Timestamp.now()
      });
      showSuccess('Change request rejected.');
      if (selectedMerchant) fetchChangeRequests(selectedMerchant.id);
    } catch (err: any) {
      showError(err);
    }
  };

  // Financials Calculation for merchant
  const financials = useMemo(() => {
    let grossSubtotal = 0;
    merchantOrders.forEach((o) => {
      if (o.status === 'Delivered') {
        grossSubtotal += Number(o.fees?.subtotal || 0);
      }
    });
    const commRate = selectedMerchant?.commissionRate ?? 15;
    const commission = (grossSubtotal * commRate) / 100;
    const netEarnings = grossSubtotal - commission;

    return { grossSubtotal, commission, netEarnings };
  }, [merchantOrders, selectedMerchant]);

  // Filter list
  const filteredMerchants = useMemo(() => {
    return merchants.filter((m) => {
      if (selectedCityId !== 'all' && m.cityId && m.cityId !== selectedCityId) return false;
      if (typeFilter !== 'all' && m.type !== typeFilter) return false;
      if (statusFilter !== 'all' && m.status !== statusFilter) return false;
      if (openFilter === 'open' && !m.isOpen) return false;
      if (openFilter === 'closed' && m.isOpen) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const n = (m.name || '').toLowerCase();
        const o = (m.ownerName || '').toLowerCase();
        const p = (m.phone || '').toLowerCase();
        if (!n.includes(q) && !o.includes(q) && !p.includes(q)) return false;
      }
      return true;
    });
  }, [merchants, selectedCityId, typeFilter, statusFilter, openFilter, searchQuery]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">
            Merchant Partners
          </h1>
          <p className="text-sm text-gray-500 dark:text-zinc-400 mt-0.5">
            Manage restaurant & store profiles, live availability, catalog menus, and payouts.
          </p>
        </div>

        <button
          onClick={() => {
            const rows = filteredMerchants.map((m) => ({
              ID: m.id,
              Name: m.name,
              Owner: m.ownerName,
              Phone: m.phone,
              Type: m.type,
              Status: m.status,
              IsOpen: m.isOpen ? 'Open' : 'Closed',
              CommissionRate: m.commissionRate
            }));
            exportToCsv(`delivio_merchants_${new Date().toISOString().slice(0, 10)}`, rows);
          }}
          className="flex items-center gap-2 px-3.5 py-2 rounded-xl border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-gray-700 dark:text-zinc-300 hover:bg-gray-50 text-xs font-bold shadow-xs self-start sm:self-auto"
        >
          <Download className="w-4 h-4" />
          <span>Export Merchants</span>
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
              placeholder="Search store name, owner, phone..."
              className="w-full pl-9 pr-4 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-amber-400"
            />
          </div>

          <div>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as any)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-amber-400"
            >
              <option value="all">All Types</option>
              <option value="food">Food Delivery</option>
              <option value="convenience">Convenience Store</option>
            </select>
          </div>

          <div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-amber-400"
            >
              <option value="all">All Statuses</option>
              <option value="active">Active Only</option>
              <option value="suspended">Suspended</option>
            </select>
          </div>

          <div>
            <select
              value={openFilter}
              onChange={(e) => setOpenFilter(e.target.value as any)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-amber-400"
            >
              <option value="all">All Open/Closed</option>
              <option value="open">Open Now</option>
              <option value="closed">Closed Now</option>
            </select>
          </div>
        </div>
      </div>

      {/* Merchants Table */}
      {loading ? (
        <TableSkeleton rows={8} cols={6} />
      ) : (
        <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 dark:bg-zinc-850/60 uppercase font-bold text-gray-500 dark:text-zinc-400 border-b border-gray-200 dark:border-zinc-800">
                <tr>
                  <th className="px-4 py-3.5">Store / Business</th>
                  <th className="px-4 py-3.5">Owner & Contact</th>
                  <th className="px-4 py-3.5">Type</th>
                  <th className="px-4 py-3.5">Live Status</th>
                  <th className="px-4 py-3.5">Commission</th>
                  <th className="px-4 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-zinc-800 font-medium">
                {filteredMerchants.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-12 text-gray-400 text-xs">
                      No matching merchants found.
                    </td>
                  </tr>
                ) : (
                  filteredMerchants.map((m) => (
                    <tr
                      key={m.id}
                      onClick={() => setSelectedMerchant(m)}
                      className="hover:bg-amber-50/50 dark:hover:bg-zinc-800/50 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 font-bold flex items-center justify-center shrink-0 overflow-hidden">
                            {m.logoUrl ? (
                              <img
                                src={m.logoUrl}
                                alt={m.name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <Store className="w-5 h-5 text-amber-600" />
                            )}
                          </div>
                          <div>
                            <div className="font-bold text-gray-900 dark:text-white">{m.name}</div>
                            <div className="text-[10px] text-gray-400 truncate max-w-[180px]">
                              {m.address || 'No address set'}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-gray-900 dark:text-white">
                          {m.ownerName || '—'}
                        </div>
                        <div className="text-[11px] text-gray-400">{m.phone}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="capitalize px-2 py-0.5 rounded-md text-[10px] font-bold bg-gray-100 dark:bg-zinc-800 text-gray-800 dark:text-zinc-200">
                          {m.type}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`w-2 h-2 rounded-full ${
                              m.status === 'suspended'
                                ? 'bg-red-500'
                                : m.isOpen
                                ? 'bg-emerald-500'
                                : 'bg-gray-400'
                            }`}
                          />
                          <span className="font-bold">
                            {m.status === 'suspended'
                              ? 'Suspended'
                              : m.isOpen
                              ? 'Open'
                              : 'Closed'}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-bold text-amber-600">
                        {m.commissionRate || 15}%
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedMerchant(m);
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

      {/* Selected Merchant Detail Drawer */}
      {selectedMerchant && (
        <div className="fixed inset-0 z-50 overflow-hidden flex justify-end bg-black/60 backdrop-blur-xs">
          <div
            className="w-full max-w-3xl bg-white dark:bg-zinc-950 border-l border-gray-200 dark:border-zinc-800 shadow-2xl flex flex-col h-full animate-in slide-in-from-right duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-5 border-b border-gray-200 dark:border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-amber-100 dark:bg-amber-950 text-amber-800 font-bold flex items-center justify-center overflow-hidden shrink-0">
                  {selectedMerchant.logoUrl ? (
                    <img
                      src={selectedMerchant.logoUrl}
                      alt={selectedMerchant.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Store className="w-6 h-6 text-amber-600" />
                  )}
                </div>
                <div>
                  <h3 className="font-extrabold text-lg text-gray-900 dark:text-white flex items-center gap-2">
                    {selectedMerchant.name}
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        selectedMerchant.isOpen
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-gray-100 text-gray-700'
                      }`}
                    >
                      {selectedMerchant.isOpen ? 'Open' : 'Closed'}
                    </span>
                  </h3>
                  <p className="text-xs text-gray-400">ID: {selectedMerchant.id}</p>
                </div>
              </div>

              <button
                onClick={() => setSelectedMerchant(null)}
                className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Navigation Tabs */}
            <div className="flex border-b border-gray-200 dark:border-zinc-800 px-5 pt-2 overflow-x-auto">
              {[
                { id: 'details', label: 'Details' },
                { id: 'status', label: 'Status & Type' },
                { id: 'location', label: 'Location Map' },
                { id: 'menu', label: `Menu (${menuItems.length})` },
                { id: 'orders', label: 'Orders & Payouts' },
                { id: 'changes', label: `Change Requests (${changeRequests.length})` },
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
                        Shop Name
                      </label>
                      <input
                        type="text"
                        value={shopName}
                        onChange={(e) => setShopName(e.target.value)}
                        required
                        className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-gray-900 dark:text-white"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                        Owner Name
                      </label>
                      <input
                        type="text"
                        value={ownerName}
                        onChange={(e) => setOwnerName(e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-gray-900 dark:text-white"
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
                        Platform Commission Rate (%)
                      </label>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={commissionRate}
                        onChange={(e) => setCommissionRate(Number(e.target.value))}
                        className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-gray-900 dark:text-white font-bold text-amber-600"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                      Store Email Address
                    </label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-gray-900 dark:text-white"
                    />
                    <div className="mt-1.5 p-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 flex items-start gap-1.5 text-[11px] text-amber-800 dark:text-amber-300">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
                      <span>This does not change the merchant's login email.</span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                      Store Description
                    </label>
                    <textarea
                      rows={2}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                        Logo Image URL
                      </label>
                      <input
                        type="url"
                        value={logoUrl}
                        onChange={(e) => setLogoUrl(e.target.value)}
                        placeholder="https://..."
                        className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-gray-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                        Store Banner Image URL
                      </label>
                      <input
                        type="url"
                        value={bannerUrl}
                        onChange={(e) => setBannerUrl(e.target.value)}
                        placeholder="https://..."
                        className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-gray-900 dark:text-white"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end pt-2">
                    <button
                      type="submit"
                      disabled={savingDetails}
                      className="delivio-btn-yellow px-5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2"
                    >
                      {savingDetails && <Loader2 className="w-4 h-4 animate-spin" />}
                      Save Store Details
                    </button>
                  </div>
                </form>
              )}

              {/* TAB 2: STATUS & TYPE */}
              {activeTab === 'status' && (
                <div className="space-y-6">
                  {/* Open / Close Switch */}
                  <div className="p-4 rounded-2xl bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 flex items-center justify-between">
                    <div>
                      <div className="font-bold text-sm text-gray-900 dark:text-white">
                        Store Open / Closed Switch
                      </div>
                      <p className="text-xs text-gray-500">
                        When closed, customers cannot place active orders from this merchant.
                      </p>
                    </div>
                    <button
                      onClick={handleToggleOpenClose}
                      className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-colors ${
                        selectedMerchant.isOpen
                          ? 'bg-emerald-600 text-white'
                          : 'bg-gray-300 dark:bg-zinc-700 text-gray-800 dark:text-zinc-200'
                      }`}
                    >
                      <Power className="w-4 h-4" />
                      {selectedMerchant.isOpen ? 'Open Now' : 'Closed'}
                    </button>
                  </div>

                  {/* Business Type Switch */}
                  <div className="p-4 rounded-2xl bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 space-y-3">
                    <div>
                      <div className="font-bold text-sm text-gray-900 dark:text-white">
                        Business Type Selection
                      </div>
                      <p className="text-xs text-gray-500">
                        Current categorization: <strong>{selectedMerchant.type}</strong>
                      </p>
                    </div>

                    <div className="flex gap-3">
                      <button
                        onClick={() => handleChangeBusinessType('food')}
                        className={`flex-1 py-2.5 rounded-xl text-xs font-bold border transition-all ${
                          selectedMerchant.type === 'food'
                            ? 'delivio-btn-yellow border-amber-500'
                            : 'bg-white dark:bg-zinc-800 border-gray-200'
                        }`}
                      >
                        Food & Restaurant
                      </button>
                      <button
                        onClick={() => handleChangeBusinessType('convenience')}
                        className={`flex-1 py-2.5 rounded-xl text-xs font-bold border transition-all ${
                          selectedMerchant.type === 'convenience'
                            ? 'delivio-btn-yellow border-amber-500'
                            : 'bg-white dark:bg-zinc-800 border-gray-200'
                        }`}
                      >
                        Convenience / Grocery
                      </button>
                    </div>

                    <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
                      <span>
                        Notice: Changing the business type may require reviewing existing menu
                        categories and catalog listings.
                      </span>
                    </div>
                  </div>

                  {/* Suspend / Restore */}
                  <div className="p-4 rounded-2xl border border-red-200 dark:border-red-900/60 bg-red-50/50 dark:bg-red-950/20 flex items-center justify-between">
                    <div>
                      <div className="font-bold text-sm text-red-900 dark:text-red-300">
                        Suspend Merchant Operations
                      </div>
                      <p className="text-xs text-red-700/80 dark:text-red-400/80">
                        Suspending marks store and owner account as suspended and closes the store.
                      </p>
                    </div>
                    <button
                      onClick={handleToggleSuspend}
                      className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
                        selectedMerchant.status === 'suspended'
                          ? 'bg-emerald-600 text-white'
                          : 'bg-red-600 text-white hover:bg-red-700'
                      }`}
                    >
                      {selectedMerchant.status === 'suspended'
                        ? 'Restore Merchant'
                        : 'Suspend Merchant'}
                    </button>
                  </div>
                </div>
              )}

              {/* TAB 3: LOCATION MAP */}
              {activeTab === 'location' && (
                <div className="space-y-4">
                  {/* Address Search */}
                  <form onSubmit={handleNominatimSearch} className="flex gap-2">
                    <input
                      type="text"
                      value={nominatimSearch}
                      onChange={(e) => setNominatimSearch(e.target.value)}
                      placeholder="Search address in Philippines via Nominatim..."
                      className="flex-1 px-3.5 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                    />
                    <button
                      type="submit"
                      disabled={searchingNominatim}
                      className="delivio-btn-yellow px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5"
                    >
                      {searchingNominatim && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      Search Pin
                    </button>
                  </form>

                  {/* Search results list */}
                  {nominatimResults.length > 0 && (
                    <div className="border border-gray-200 dark:border-zinc-800 rounded-xl overflow-hidden divide-y divide-gray-100 dark:divide-zinc-800 text-xs">
                      {nominatimResults.map((r, i) => (
                        <div
                          key={i}
                          onClick={() => selectNominatimResult(r)}
                          className="p-2.5 hover:bg-amber-50 dark:hover:bg-zinc-800 cursor-pointer text-gray-800 dark:text-zinc-200"
                        >
                          {r.display_name}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Map */}
                  <div
                    ref={locationMapRef}
                    className="h-72 w-full rounded-2xl border border-gray-200 dark:border-zinc-800 overflow-hidden shadow-xs"
                  />

                  <div>
                    <label className="block text-xs font-semibold uppercase text-gray-500 mb-1">
                      Store Address String
                    </label>
                    <input
                      type="text"
                      value={locAddress}
                      onChange={(e) => setLocAddress(e.target.value)}
                      className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                    />
                  </div>

                  <div className="flex justify-between items-center pt-2">
                    <div className="text-xs text-gray-400 font-mono">
                      Coordinates: {locLat.toFixed(6)}, {locLng.toFixed(6)}
                    </div>
                    <button
                      onClick={handleSaveLocation}
                      disabled={savingLocation}
                      className="delivio-btn-yellow px-5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-1.5"
                    >
                      {savingLocation && <Loader2 className="w-4 h-4 animate-spin" />}
                      Save Store Pin
                    </button>
                  </div>
                </div>
              )}

              {/* TAB 4: MENU */}
              {activeTab === 'menu' && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-gray-500">
                        {menuItems.length} Products
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setBulkPriceModalOpen(true)}
                        className="px-3 py-1.5 rounded-xl border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs font-bold text-gray-700 dark:text-zinc-300 hover:bg-gray-50"
                      >
                        Bulk Price Change
                      </button>
                      <button
                        onClick={() => {
                          setEditingItem(null);
                          setItemName('');
                          setItemPrice(0);
                          setItemDesc('');
                          setItemImageUrl('');
                          setItemCategory(categories[0]?.id || '');
                          setItemAvailable(true);
                          setItemModalOpen(true);
                        }}
                        className="delivio-btn-yellow px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 shadow-xs"
                      >
                        <Plus className="w-3.5 h-3.5" /> Add Menu Item
                      </button>
                    </div>
                  </div>

                  {/* Menu Items Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {menuItems.map((item) => (
                      <div
                        key={item.id}
                        className="p-3.5 rounded-xl border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex gap-3 text-xs shadow-xs"
                      >
                        <div className="w-16 h-16 rounded-xl bg-gray-100 dark:bg-zinc-800 shrink-0 overflow-hidden flex items-center justify-center">
                          {item.imageUrl ? (
                            <img
                              src={item.imageUrl}
                              alt={item.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <ShoppingBag className="w-6 h-6 text-gray-400" />
                          )}
                        </div>

                        <div className="flex-1 flex flex-col justify-between">
                          <div>
                            <div className="flex justify-between items-start">
                              <h5 className="font-bold text-gray-900 dark:text-white">
                                {item.name}
                              </h5>
                              <span className="font-extrabold text-amber-600">
                                ₱{Number(item.price).toFixed(2)}
                              </span>
                            </div>
                            <p className="text-[11px] text-gray-400 line-clamp-1 mt-0.5">
                              {item.description}
                            </p>
                          </div>

                          <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-zinc-800">
                            <span
                              className={`text-[10px] font-bold ${
                                item.available ? 'text-emerald-600' : 'text-red-500'
                              }`}
                            >
                              {item.available ? 'In Stock' : 'Unavailable'}
                            </span>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => {
                                  setEditingItem(item);
                                  setItemName(item.name);
                                  setItemPrice(item.price);
                                  setItemDesc(item.description || '');
                                  setItemImageUrl(item.imageUrl || '');
                                  setItemCategory(item.categoryId || '');
                                  setItemAvailable(item.available);
                                  setItemModalOpen(true);
                                }}
                                className="p-1 text-gray-400 hover:text-amber-600"
                              >
                                <Edit className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleDeleteItem(item.id)}
                                className="p-1 text-gray-400 hover:text-red-600"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* TAB 5: ORDERS & EARNINGS */}
              {activeTab === 'orders' && (
                <div className="space-y-6">
                  {/* Financials Overview Cards */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="p-3.5 rounded-xl bg-gray-50 dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800">
                      <span className="text-[10px] uppercase font-bold text-gray-400">
                        Gross Goods Subtotal
                      </span>
                      <div className="text-base font-black text-gray-900 dark:text-white mt-1">
                        ₱{financials.grossSubtotal.toFixed(2)}
                      </div>
                    </div>
                    <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200">
                      <span className="text-[10px] uppercase font-bold text-amber-800 dark:text-amber-300">
                        Platform Comm. ({selectedMerchant.commissionRate}%)
                      </span>
                      <div className="text-base font-black text-amber-600 mt-1">
                        ₱{financials.commission.toFixed(2)}
                      </div>
                    </div>
                    <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200">
                      <span className="text-[10px] uppercase font-bold text-emerald-800 dark:text-emerald-300">
                        Net Merchant Payout
                      </span>
                      <div className="text-base font-black text-emerald-600 mt-1">
                        ₱{financials.netEarnings.toFixed(2)}
                      </div>
                    </div>
                  </div>

                  {/* Create Payout Generator */}
                  <div className="p-4 rounded-2xl bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 space-y-3">
                    <span className="text-xs font-bold uppercase text-gray-700 dark:text-zinc-300 block">
                      Generate Merchant Remittance Payout
                    </span>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        value={payoutAmount}
                        onChange={(e) => setPayoutAmount(Number(e.target.value))}
                        placeholder="Amount in PHP"
                        className="flex-1 px-3.5 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                      />
                      <button
                        onClick={handleCreatePayout}
                        disabled={creatingPayout || payoutAmount <= 0}
                        className="delivio-btn-yellow px-4 py-2 rounded-xl text-xs font-bold"
                      >
                        Create Payout
                      </button>
                    </div>

                    {/* Payouts list */}
                    <div className="space-y-1.5 pt-2">
                      {payouts.map((p) => (
                        <div
                          key={p.id}
                          className="flex items-center justify-between p-2.5 rounded-xl bg-white dark:bg-zinc-850 text-xs border border-gray-100 dark:border-zinc-800"
                        >
                          <div>
                            <span className="font-bold text-gray-900 dark:text-white">
                              ₱{Number(p.amount).toFixed(2)}
                            </span>
                            <span className="text-gray-400 ml-2">
                              {formatTimestamp(p.createdAt)}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                p.status === 'Paid'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-amber-100 text-amber-800'
                              }`}
                            >
                              {p.status}
                            </span>
                            {p.status === 'Pending' && (
                              <button
                                onClick={() => handleMarkPayoutPaid(p.id)}
                                className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-bold text-[11px]"
                              >
                                Mark as paid
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 6: CHANGE REQUESTS */}
              {activeTab === 'changes' && (
                <div className="space-y-3">
                  {changeRequests.length === 0 ? (
                    <div className="p-8 text-center text-xs text-gray-400">
                      No change requests on file for this merchant.
                    </div>
                  ) : (
                    changeRequests.map((req) => (
                      <div
                        key={req.id}
                        className="p-4 rounded-xl border border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-900 text-xs space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold uppercase text-amber-600">
                            Requested Change: {req.kind}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              req.status === 'Pending'
                                ? 'bg-amber-100 text-amber-800'
                                : req.status === 'Approved'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-red-100 text-red-800'
                            }`}
                          >
                            {req.status}
                          </span>
                        </div>
                        <p className="text-gray-700 dark:text-zinc-300">
                          Proposed value: <strong>{String(req.newValue)}</strong> (Old:{' '}
                          <span className="line-through">{String(req.oldValue)}</span>)
                        </p>
                        {req.status === 'Pending' && (
                          <div className="flex justify-end gap-2 pt-2">
                            <button
                              onClick={() => {
                                setTargetChangeRequest(req);
                                setRejectChangeModalOpen(true);
                              }}
                              className="px-3 py-1.5 rounded-xl border border-red-300 text-red-600 text-xs font-bold"
                            >
                              Reject
                            </button>
                            <button
                              onClick={() => handleApproveChange(req)}
                              className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold"
                            >
                              Approve & Apply
                            </button>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* TAB 7: EDIT HISTORY */}
              {activeTab === 'history' && (
                <div className="space-y-2">
                  {editHistory.length === 0 ? (
                    <div className="p-8 text-center text-xs text-gray-400">
                      No profile modification logs.
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
                          Changed from "{String(entry.oldValue || '—')}" to "
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

      {/* Add / Edit Menu Item Modal */}
      {itemModalOpen && selectedMerchant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-6 shadow-2xl">
            <h3 className="font-bold text-base text-gray-900 dark:text-white mb-4">
              {editingItem ? 'Edit Menu Item' : 'Add New Item'}
            </h3>

            <form onSubmit={handleSaveItem} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Item Name
                </label>
                <input
                  type="text"
                  value={itemName}
                  onChange={(e) => setItemName(e.target.value)}
                  required
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Price (PHP)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={itemPrice}
                  onChange={(e) => setItemPrice(Number(e.target.value))}
                  required
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white font-bold"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Description
                </label>
                <textarea
                  rows={2}
                  value={itemDesc}
                  onChange={(e) => setItemDesc(e.target.value)}
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Image URL
                </label>
                <input
                  type="url"
                  value={itemImageUrl}
                  onChange={(e) => setItemImageUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="availCheck"
                  checked={itemAvailable}
                  onChange={(e) => setItemAvailable(e.target.checked)}
                  className="w-4 h-4 rounded-sm text-amber-500"
                />
                <label htmlFor="availCheck" className="text-xs font-semibold text-gray-700">
                  Item is available for ordering
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setItemModalOpen(false)}
                  className="px-4 py-2 text-xs font-bold text-gray-600 hover:bg-gray-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingItem}
                  className="delivio-btn-yellow px-5 py-2 text-xs font-bold rounded-xl flex items-center gap-1.5"
                >
                  {savingItem && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Save Item
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk Price Change Modal */}
      {bulkPriceModalOpen && selectedMerchant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-sm bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-6 shadow-2xl">
            <h3 className="font-bold text-base text-gray-900 dark:text-white mb-3">
              Bulk Adjust Menu Prices
            </h3>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold uppercase text-gray-500 mb-1">
                  Adjustment Type
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setBulkMode('percent')}
                    className={`flex-1 py-2 rounded-xl font-bold border ${
                      bulkMode === 'percent'
                        ? 'delivio-btn-yellow border-amber-500'
                        : 'bg-gray-50 dark:bg-zinc-800'
                    }`}
                  >
                    Percentage (%)
                  </button>
                  <button
                    onClick={() => setBulkMode('fixed')}
                    className={`flex-1 py-2 rounded-xl font-bold border ${
                      bulkMode === 'fixed'
                        ? 'delivio-btn-yellow border-amber-500'
                        : 'bg-gray-50 dark:bg-zinc-800'
                    }`}
                  >
                    Fixed Amount (₱)
                  </button>
                </div>
              </div>

              <div>
                <label className="block font-semibold uppercase text-gray-500 mb-1">
                  Direction
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setBulkDirection('increase')}
                    className={`flex-1 py-2 rounded-xl font-bold border ${
                      bulkDirection === 'increase'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-gray-50 dark:bg-zinc-800'
                    }`}
                  >
                    Increase (+)
                  </button>
                  <button
                    onClick={() => setBulkDirection('decrease')}
                    className={`flex-1 py-2 rounded-xl font-bold border ${
                      bulkDirection === 'decrease'
                        ? 'bg-red-600 text-white'
                        : 'bg-gray-50 dark:bg-zinc-800'
                    }`}
                  >
                    Decrease (-)
                  </button>
                </div>
              </div>

              <div>
                <label className="block font-semibold uppercase text-gray-500 mb-1">
                  Amount / Value
                </label>
                <input
                  type="number"
                  min="1"
                  value={bulkValue}
                  onChange={(e) => setBulkValue(Number(e.target.value))}
                  className="w-full px-3.5 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 font-bold"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setBulkPriceModalOpen(false)}
                  className="px-4 py-2 font-bold text-gray-600 hover:bg-gray-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleApplyBulkPrice}
                  disabled={applyingBulk}
                  className="delivio-btn-yellow px-5 py-2 font-bold rounded-xl flex items-center gap-1.5"
                >
                  {applyingBulk && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Apply to All
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reject Change Request Modal */}
      {rejectChangeModalOpen && targetChangeRequest && (
        <ConfirmationModal
          isOpen={rejectChangeModalOpen}
          onClose={() => setRejectChangeModalOpen(false)}
          onConfirm={handleRejectChange}
          title="Reject Merchant Change Request"
          message={`Are you sure you want to reject the request to change ${targetChangeRequest.kind}?`}
          confirmLabel="Reject Request"
          reasonRequired={true}
          reasonPlaceholder="Specify reason for rejection..."
          isDestructive={true}
        />
      )}
    </div>
  );
};
