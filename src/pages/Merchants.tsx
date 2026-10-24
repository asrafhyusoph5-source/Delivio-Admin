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
import { formatTimestamp } from '../utils/date';
import type { Merchant, MenuItem, MenuCategory, Order, ChangeRequest, EditHistoryEntry } from '../types';
import { FOOD_CATEGORIES, CONVENIENCE_CATEGORIES } from '../constants';
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
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
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
  const [activeCategoryTab, setActiveCategoryTab] = useState<string>('all');

  // Items needing a category & bulk reassign
  const [selectedNeedingCategoryIds, setSelectedNeedingCategoryIds] = useState<string[]>([]);
  const [bulkReassignTarget, setBulkReassignTarget] = useState<string>('');
  const [bulkReassigning, setBulkReassigning] = useState(false);

  // Business Type Change Warning & Review Categories Modal
  const [typeWarningModalOpen, setTypeWarningModalOpen] = useState(false);
  const [pendingNewType, setPendingNewType] = useState<'food' | 'convenience' | null>(null);
  const [reviewCategoriesModalOpen, setReviewCategoriesModalOpen] = useState(false);
  const [itemsToReview, setItemsToReview] = useState<MenuItem[]>([]);
  const [reviewAssignments, setReviewAssignments] = useState<Record<string, string>>({});
  const [reviewBulkCategory, setReviewBulkCategory] = useState<string>('');
  const [savingCategoryReview, setSavingCategoryReview] = useState(false);

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

  // Recompute merchants/{id}.cuisineTags: distinct categoryName values of available items
  const recomputeMerchantCuisineTags = async (merchantId: string, currentItems: MenuItem[]) => {
    try {
      const availableItems = currentItems.filter((i) => i.available !== false);
      const tags = Array.from(
        new Set(availableItems.map((i) => i.categoryId).filter(Boolean))
      ) as string[];

      const mRef = doc(db, 'merchants', merchantId);
      await updateDoc(mRef, {
        cuisineTags: tags,
        updatedAt: Timestamp.now()
      });

      setSelectedMerchant((prev) =>
        prev && prev.id === merchantId ? { ...prev, cuisineTags: tags } : prev
      );
      setMerchants((prev) =>
        prev.map((m) => (m.id === merchantId ? { ...m, cuisineTags: tags } : m))
      );
      return tags;
    } catch (err) {
      console.error('Failed to recompute cuisineTags:', err);
    }
  };

  // Business Type Switch - Step 1: Warning prompt
  const handleChangeBusinessType = (newType: 'food' | 'convenience') => {
    if (!selectedMerchant || selectedMerchant.type === newType) return;
    setPendingNewType(newType);
    setTypeWarningModalOpen(true);
  };

  // Business Type Switch - Step 2: Confirmation & check items outside new category list
  const confirmChangeBusinessType = async () => {
    if (!selectedMerchant || !pendingNewType) return;
    const newType = pendingNewType;
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

      setSelectedMerchant((prev) => (prev ? { ...prev, type: newType } : null));
      setMerchants((prev) =>
        prev.map((m) => (m.id === selectedMerchant.id ? { ...m, type: newType } : m))
      );
      setTypeWarningModalOpen(false);

      // Check items outside new type's allowed category list
      const targetCategoryList =
        newType === 'food' ? FOOD_CATEGORIES : CONVENIENCE_CATEGORIES;
      const invalidItems = menuItems.filter(
        (item) => !item.categoryId || !(targetCategoryList as readonly string[]).includes(item.categoryId)
      );

      if (invalidItems.length > 0) {
        setItemsToReview(invalidItems);
        const initialMap: Record<string, string> = {};
        invalidItems.forEach((it) => {
          initialMap[it.id] = targetCategoryList[0];
        });
        setReviewAssignments(initialMap);
        setReviewBulkCategory(targetCategoryList[0]);
        setReviewCategoriesModalOpen(true);
      } else {
        await recomputeMerchantCuisineTags(selectedMerchant.id, menuItems);
        showSuccess(`Business type changed to ${newType}. All categories match!`);
      }
    } catch (err: any) {
      showError(err);
    }
  };

  // Save Category Review after Business Type Change
  const handleSaveCategoryReview = async () => {
    if (!selectedMerchant || itemsToReview.length === 0) return;
    try {
      setSavingCategoryReview(true);
      const batch = writeBatch(db);

      const updatedItems = menuItems.map((item) => {
        if (reviewAssignments[item.id]) {
          const itemDoc = doc(db, 'merchants', selectedMerchant.id, 'items', item.id);
          const newCategory = reviewAssignments[item.id];
          batch.update(itemDoc, {
            categoryId: newCategory,
            updatedAt: Timestamp.now()
          });
          return { ...item, categoryId: newCategory };
        }
        return item;
      });

      await batch.commit();
      setMenuItems(updatedItems);
      await recomputeMerchantCuisineTags(selectedMerchant.id, updatedItems);

      showSuccess(`Reassigned ${itemsToReview.length} item(s) to new category catalog.`);
      setReviewCategoriesModalOpen(false);
      setItemsToReview([]);
    } catch (err: any) {
      showError(err);
    } finally {
      setSavingCategoryReview(false);
    }
  };

  // Bulk Reassign items needing category
  const handleBulkReassignNeedingCategory = async () => {
    if (!selectedMerchant || !bulkReassignTarget || selectedNeedingCategoryIds.length === 0) return;
    try {
      setBulkReassigning(true);
      const batch = writeBatch(db);

      const updatedItems = menuItems.map((item) => {
        if (selectedNeedingCategoryIds.includes(item.id)) {
          const itemDoc = doc(db, 'merchants', selectedMerchant.id, 'items', item.id);
          batch.update(itemDoc, {
            categoryId: bulkReassignTarget,
            updatedAt: Timestamp.now()
          });
          return { ...item, categoryId: bulkReassignTarget };
        }
        return item;
      });

      await batch.commit();
      setMenuItems(updatedItems);
      await recomputeMerchantCuisineTags(selectedMerchant.id, updatedItems);

      showSuccess(`Reassigned ${selectedNeedingCategoryIds.length} item(s) to ${bulkReassignTarget}.`);
      setSelectedNeedingCategoryIds([]);
    } catch (err: any) {
      showError(err);
    } finally {
      setBulkReassigning(false);
    }
  };

  // Menu: Add / Edit Item
  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMerchant) return;
    try {
      setSavingItem(true);
      const itemsCol = collection(db, 'merchants', selectedMerchant.id, 'items');
      let updatedItems: MenuItem[] = [];

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
        updatedItems = menuItems.map((i) =>
          i.id === editingItem.id
            ? {
                ...i,
                name: itemName.trim(),
                price: Number(itemPrice) || 0,
                description: itemDesc.trim(),
                imageUrl: itemImageUrl.trim(),
                categoryId: itemCategory,
                available: itemAvailable
              }
            : i
        );
        showSuccess('Item updated.');
      } else {
        // Add
        const newDocRef = await addDoc(itemsCol, {
          name: itemName.trim(),
          price: Number(itemPrice) || 0,
          description: itemDesc.trim(),
          imageUrl: itemImageUrl.trim(),
          categoryId: itemCategory,
          available: itemAvailable,
          createdAt: Timestamp.now()
        });
        const newItem: MenuItem = {
          id: newDocRef.id,
          name: itemName.trim(),
          price: Number(itemPrice) || 0,
          description: itemDesc.trim(),
          imageUrl: itemImageUrl.trim(),
          categoryId: itemCategory,
          available: itemAvailable,
          createdAt: Timestamp.now()
        };
        updatedItems = [...menuItems, newItem];
        showSuccess('Item created.');
      }

      setMenuItems(updatedItems);
      await recomputeMerchantCuisineTags(selectedMerchant.id, updatedItems);
      setItemModalOpen(false);
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
      const updatedItems = menuItems.filter((i) => i.id !== itemId);
      setMenuItems(updatedItems);
      await recomputeMerchantCuisineTags(selectedMerchant.id, updatedItems);
      showSuccess('Item deleted.');
    } catch (err: any) {
      showError(err);
    }
  };

  // Toggle item availability (In Stock / Unavailable)
  const handleToggleItemAvailability = async (item: MenuItem) => {
    if (!selectedMerchant) return;
    try {
      const newAvail = !item.available;
      const itemDoc = doc(db, 'merchants', selectedMerchant.id, 'items', item.id);
      await updateDoc(itemDoc, {
        available: newAvail,
        updatedAt: Timestamp.now()
      });
      const updatedItems = menuItems.map((i) =>
        i.id === item.id ? { ...i, available: newAvail } : i
      );
      setMenuItems(updatedItems);
      await recomputeMerchantCuisineTags(selectedMerchant.id, updatedItems);
      showSuccess(`${item.name} is now ${newAvail ? 'In Stock' : 'Unavailable'}.`);
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

  const availableCategoriesForFilter = useMemo(() => {
    if (typeFilter === 'food') return FOOD_CATEGORIES;
    if (typeFilter === 'convenience') return CONVENIENCE_CATEGORIES;
    return Array.from(new Set([...FOOD_CATEGORIES, ...CONVENIENCE_CATEGORIES]));
  }, [typeFilter]);

  // Filter list
  const filteredMerchants = useMemo(() => {
    return merchants.filter((m) => {
      if (selectedCityId !== 'all' && m.cityId && m.cityId !== selectedCityId) return false;
      if (typeFilter !== 'all' && m.type !== typeFilter) return false;
      if (categoryFilter !== 'all') {
        if (!m.cuisineTags || !m.cuisineTags.includes(categoryFilter)) return false;
      }
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
  }, [merchants, selectedCityId, typeFilter, categoryFilter, statusFilter, openFilter, searchQuery]);

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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
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
              onChange={(e) => {
                setTypeFilter(e.target.value as any);
                setCategoryFilter('all');
              }}
              className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-amber-400"
            >
              <option value="all">All Types</option>
              <option value="food">Food Delivery</option>
              <option value="convenience">Convenience Store</option>
            </select>
          </div>

          <div>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-amber-400 font-medium"
            >
              <option value="all">All Categories</option>
              {availableCategoriesForFilter.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
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
              {activeTab === 'menu' && (() => {
                const merchantAllowedCategories: readonly string[] =
                  selectedMerchant.type === 'food' ? FOOD_CATEGORIES : CONVENIENCE_CATEGORIES;
                const itemsNeedingCategory = menuItems.filter(
                  (i) => !i.categoryId || !merchantAllowedCategories.includes(i.categoryId)
                );

                // Category counts
                const countsMap: Record<string, number> = {};
                merchantAllowedCategories.forEach((c) => {
                  countsMap[c] = 0;
                });
                menuItems.forEach((i) => {
                  if (i.categoryId && merchantAllowedCategories.includes(i.categoryId)) {
                    countsMap[i.categoryId] = (countsMap[i.categoryId] || 0) + 1;
                  }
                });

                // Display items based on category tab filter
                const displayedItems = menuItems.filter((item) => {
                  if (activeCategoryTab === 'all') return true;
                  if (activeCategoryTab === 'needing_category') {
                    return !item.categoryId || !merchantAllowedCategories.includes(item.categoryId);
                  }
                  return item.categoryId === activeCategoryTab;
                });

                return (
                  <div className="space-y-4">
                    {/* Category Counts & Filter Bar */}
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs font-bold text-gray-700 dark:text-zinc-300">
                          Menu Categories ({selectedMerchant.type === 'food' ? 'Food & Restaurant' : 'Convenience Store'} Catalog)
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
                              setItemCategory(merchantAllowedCategories[0]);
                              setItemAvailable(true);
                              setItemModalOpen(true);
                            }}
                            className="delivio-btn-yellow px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 shadow-xs"
                          >
                            <Plus className="w-3.5 h-3.5" /> Add Menu Item
                          </button>
                        </div>
                      </div>

                      {/* Category Chips with Counts */}
                      <div className="flex flex-wrap gap-1.5 p-2 rounded-xl bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-800">
                        <button
                          onClick={() => setActiveCategoryTab('all')}
                          className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                            activeCategoryTab === 'all'
                              ? 'bg-amber-400 text-black shadow-xs'
                              : 'bg-white dark:bg-zinc-800 text-gray-600 dark:text-zinc-400 hover:text-gray-900'
                          }`}
                        >
                          All ({menuItems.length})
                        </button>

                        {merchantAllowedCategories.map((cat) => (
                          <button
                            key={cat}
                            onClick={() => setActiveCategoryTab(cat)}
                            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                              activeCategoryTab === cat
                                ? 'bg-amber-400 text-black shadow-xs'
                                : 'bg-white dark:bg-zinc-800 text-gray-600 dark:text-zinc-400 hover:text-gray-900'
                            }`}
                          >
                            <span>{cat}</span>
                            <span
                              className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                                activeCategoryTab === cat
                                  ? 'bg-black/20 text-black'
                                  : 'bg-gray-100 dark:bg-zinc-700 text-gray-500 dark:text-zinc-300'
                              }`}
                            >
                              {countsMap[cat] || 0}
                            </span>
                          </button>
                        ))}

                        {itemsNeedingCategory.length > 0 && (
                          <button
                            onClick={() => setActiveCategoryTab('needing_category')}
                            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                              activeCategoryTab === 'needing_category'
                                ? 'bg-red-500 text-white shadow-xs'
                                : 'bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800'
                            }`}
                          >
                            <AlertTriangle className="w-3 h-3" />
                            <span>Needs Category ({itemsNeedingCategory.length})</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Items Needing a Category Alert & Bulk Reassign Box */}
                    {itemsNeedingCategory.length > 0 && (
                      <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 space-y-3">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                            <h4 className="font-bold text-xs text-amber-900 dark:text-amber-200">
                              Items needing a category ({itemsNeedingCategory.length} item{itemsNeedingCategory.length > 1 ? 's' : ''})
                            </h4>
                          </div>
                          <span className="text-[11px] text-amber-800/80 dark:text-amber-300/80">
                            Items without a valid {selectedMerchant.type} category will not properly group in mobile apps.
                          </span>
                        </div>

                        {/* Bulk Reassign Controls */}
                        <div className="flex flex-wrap items-center gap-2 p-2.5 rounded-xl bg-white dark:bg-zinc-900 border border-amber-200 dark:border-amber-900/60">
                          <button
                            onClick={() => {
                              if (selectedNeedingCategoryIds.length === itemsNeedingCategory.length) {
                                setSelectedNeedingCategoryIds([]);
                              } else {
                                setSelectedNeedingCategoryIds(itemsNeedingCategory.map((i) => i.id));
                              }
                            }}
                            className="text-xs font-bold px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 text-gray-700 dark:text-zinc-300 hover:bg-gray-100"
                          >
                            {selectedNeedingCategoryIds.length === itemsNeedingCategory.length
                              ? 'Deselect All'
                              : `Select All (${itemsNeedingCategory.length})`}
                          </button>

                          <div className="flex-1 min-w-[180px]">
                            <select
                              value={bulkReassignTarget}
                              onChange={(e) => setBulkReassignTarget(e.target.value)}
                              className="w-full px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                            >
                              <option value="">-- Choose Category to Reassign --</option>
                              {merchantAllowedCategories.map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                            </select>
                          </div>

                          <button
                            onClick={handleBulkReassignNeedingCategory}
                            disabled={
                              bulkReassigning ||
                              !bulkReassignTarget ||
                              selectedNeedingCategoryIds.length === 0
                            }
                            className="delivio-btn-yellow px-4 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 disabled:opacity-50"
                          >
                            {bulkReassigning && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                            Bulk Reassign ({selectedNeedingCategoryIds.length})
                          </button>
                        </div>

                        {/* Checkbox list of items needing category */}
                        <div className="max-h-48 overflow-y-auto space-y-1 divide-y divide-amber-200/50 dark:divide-amber-900/40 text-xs">
                          {itemsNeedingCategory.map((item) => {
                            const isChecked = selectedNeedingCategoryIds.includes(item.id);
                            return (
                              <div
                                key={item.id}
                                className="flex items-center justify-between py-1.5 px-2 hover:bg-amber-100/50 dark:hover:bg-amber-900/20 rounded-lg cursor-pointer"
                                onClick={() => {
                                  setSelectedNeedingCategoryIds((prev) =>
                                    prev.includes(item.id)
                                      ? prev.filter((id) => id !== item.id)
                                      : [...prev, item.id]
                                  );
                                }}
                              >
                                <div className="flex items-center gap-2">
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={() => {}}
                                    className="w-4 h-4 rounded-sm text-amber-500"
                                  />
                                  <span className="font-semibold text-gray-900 dark:text-white">
                                    {item.name}
                                  </span>
                                  <span className="text-[11px] text-gray-400">
                                    (Current: {item.categoryId || 'None'})
                                  </span>
                                </div>
                                <span className="font-mono font-bold text-amber-700 dark:text-amber-400">
                                  ₱{Number(item.price).toFixed(2)}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Menu Items Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {displayedItems.length === 0 ? (
                        <div className="col-span-2 p-8 text-center text-xs text-gray-400 bg-gray-50 dark:bg-zinc-850 rounded-2xl border border-gray-200 dark:border-zinc-800">
                          No menu items found in this category filter.
                        </div>
                      ) : (
                        displayedItems.map((item) => (
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
                                <div className="flex justify-between items-start gap-1">
                                  <div>
                                    <h5 className="font-bold text-gray-900 dark:text-white leading-tight">
                                      {item.name}
                                    </h5>
                                    <span
                                      className={`inline-block mt-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
                                        item.categoryId && merchantAllowedCategories.includes(item.categoryId)
                                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                                          : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                                      }`}
                                    >
                                      {item.categoryId || 'No Category'}
                                    </span>
                                  </div>
                                  <span className="font-extrabold text-amber-600 shrink-0">
                                    ₱{Number(item.price).toFixed(2)}
                                  </span>
                                </div>
                                {item.description && (
                                  <p className="text-[11px] text-gray-400 line-clamp-1 mt-1">
                                    {item.description}
                                  </p>
                                )}
                              </div>

                              <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-zinc-800 mt-2">
                                <button
                                  onClick={() => handleToggleItemAvailability(item)}
                                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full transition-colors cursor-pointer ${
                                    item.available
                                      ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300'
                                      : 'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-950/60 dark:text-red-300'
                                  }`}
                                  title="Click to toggle availability & update cuisine tags"
                                >
                                  {item.available ? '● In Stock' : '○ Unavailable'}
                                </button>
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => {
                                      setEditingItem(item);
                                      setItemName(item.name);
                                      setItemPrice(item.price);
                                      setItemDesc(item.description || '');
                                      setItemImageUrl(item.imageUrl || '');
                                      setItemCategory(item.categoryId || merchantAllowedCategories[0]);
                                      setItemAvailable(item.available);
                                      setItemModalOpen(true);
                                    }}
                                    className="p-1 text-gray-400 hover:text-amber-600 rounded-md hover:bg-gray-100 dark:hover:bg-zinc-800"
                                    title="Edit Item"
                                  >
                                    <Edit className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => handleDeleteItem(item.id)}
                                    className="p-1 text-gray-400 hover:text-red-600 rounded-md hover:bg-gray-100 dark:hover:bg-zinc-800"
                                    title="Delete Item"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                );
              })()}

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

              <div>
                <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Category ({selectedMerchant.type === 'food' ? 'Food & Restaurant' : 'Convenience'} Catalog)
                </label>
                <select
                  value={itemCategory}
                  onChange={(e) => setItemCategory(e.target.value)}
                  required
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white font-medium"
                >
                  <option value="">-- Select Category --</option>
                  {(selectedMerchant.type === 'food' ? FOOD_CATEGORIES : CONVENIENCE_CATEGORIES).map(
                    (cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    )
                  )}
                </select>
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

      {/* Business Type Change Warning Modal */}
      {typeWarningModalOpen && pendingNewType && selectedMerchant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white dark:bg-zinc-900 border border-amber-300 dark:border-amber-800 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-950 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <h3 className="font-bold text-base text-gray-900 dark:text-white">
                  Change Merchant Business Type?
                </h3>
                <p className="text-xs text-gray-500">
                  Switching from {selectedMerchant.type.toUpperCase()} to {pendingNewType.toUpperCase()}
                </p>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-xs text-amber-900 dark:text-amber-200 leading-relaxed border border-amber-200 dark:border-amber-900">
              Changing the business type will shift this merchant to the{' '}
              <strong>{pendingNewType === 'food' ? 'Food Categories' : 'Convenience Categories'}</strong>{' '}
              catalog. Any existing menu items outside this list will need to be reassigned in the next step to appear properly in mobile customer apps.
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setTypeWarningModalOpen(false);
                  setPendingNewType(null);
                }}
                className="px-4 py-2 text-xs font-bold text-gray-600 hover:bg-gray-100 dark:text-zinc-400 dark:hover:bg-zinc-800 rounded-xl"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmChangeBusinessType}
                className="delivio-btn-yellow px-5 py-2 text-xs font-bold rounded-xl"
              >
                Proceed & Review Categories
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Review Categories Modal */}
      {reviewCategoriesModalOpen && selectedMerchant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-xl max-h-[90vh] flex flex-col bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden">
            <div className="p-5 border-b border-gray-100 dark:border-zinc-800 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-base text-gray-900 dark:text-white">
                  Review Menu Categories
                </h3>
                <p className="text-xs text-gray-500">
                  Reassign items to fit the {selectedMerchant.type === 'food' ? 'Food & Restaurant' : 'Convenience Store'} category list.
                </p>
              </div>
              <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800">
                {itemsToReview.length} item{itemsToReview.length > 1 ? 's' : ''} to reassign
              </span>
            </div>

            {/* Bulk tool bar */}
            <div className="p-4 bg-gray-50 dark:bg-zinc-850 border-b border-gray-100 dark:border-zinc-800 flex items-center gap-2 text-xs">
              <span className="font-bold text-gray-600 dark:text-zinc-400">Bulk Assign All:</span>
              <select
                value={reviewBulkCategory}
                onChange={(e) => setReviewBulkCategory(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
              >
                {(selectedMerchant.type === 'food' ? FOOD_CATEGORIES : CONVENIENCE_CATEGORIES).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  if (!reviewBulkCategory) return;
                  const updated: Record<string, string> = {};
                  itemsToReview.forEach((it) => {
                    updated[it.id] = reviewBulkCategory;
                  });
                  setReviewAssignments(updated);
                }}
                className="px-3 py-1.5 rounded-lg bg-gray-200 dark:bg-zinc-700 font-bold hover:bg-gray-300 text-gray-800 dark:text-zinc-200"
              >
                Apply to All Items
              </button>
            </div>

            {/* Item list */}
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              {itemsToReview.map((item) => (
                <div
                  key={item.id}
                  className="p-3 rounded-xl border border-gray-200 dark:border-zinc-800 bg-gray-50/50 dark:bg-zinc-800/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                >
                  <div>
                    <div className="font-bold text-gray-900 dark:text-white">{item.name}</div>
                    <div className="text-[11px] text-gray-400">
                      Current / Previous: <span className="text-red-500 font-medium">{item.categoryId || 'None'}</span>
                    </div>
                  </div>

                  <div className="w-full sm:w-64">
                    <label className="block text-[10px] uppercase font-bold text-gray-400 mb-0.5">
                      New Category
                    </label>
                    <select
                      value={reviewAssignments[item.id] || ''}
                      onChange={(e) =>
                        setReviewAssignments((prev) => ({ ...prev, [item.id]: e.target.value }))
                      }
                      className="w-full px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                    >
                      {(selectedMerchant.type === 'food' ? FOOD_CATEGORIES : CONVENIENCE_CATEGORIES).map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-gray-100 dark:border-zinc-800 flex justify-end gap-2 bg-gray-50 dark:bg-zinc-850">
              <button
                type="button"
                onClick={() => setReviewCategoriesModalOpen(false)}
                className="px-4 py-2 text-xs font-bold text-gray-600 hover:bg-gray-100 dark:text-zinc-400 dark:hover:bg-zinc-800 rounded-xl"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveCategoryReview}
                disabled={savingCategoryReview}
                className="delivio-btn-yellow px-5 py-2 text-xs font-bold rounded-xl flex items-center gap-1.5"
              >
                {savingCategoryReview && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Save & Update Categories
              </button>
            </div>
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
