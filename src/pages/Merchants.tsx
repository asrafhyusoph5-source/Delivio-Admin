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
  getDoc,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  Timestamp,
  writeBatch,
  runTransaction
} from '../firebase';
import { useCity } from '../context/CityContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { logAuditEvent, logEditHistory } from '../utils/audit';
import { exportToCsv } from '../utils/exportCsv';
import { formatTimestamp } from '../utils/date';
import type {
  Merchant,
  MenuItem,
  MenuCategory,
  MenuChoice,
  MenuSet,
  Order,
  ChangeRequest,
  EditHistoryEntry,
  WalletTransaction,
  MerchantWeeklyHours,
  MerchantOperatingDay
} from '../types';
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
  FileCheck,
  Wallet,
  Clock,
  Calendar,
  Link as LinkIcon,
  Unlink,
  ArrowUpRight,
  ArrowDownLeft,
  ArrowRightLeft,
  ShieldCheck,
  ShieldAlert,
  Ban,
  Play,
  Sun,
  Moon
} from 'lucide-react';
import { ConfirmationModal } from '../components/common/ConfirmationModal';
import { TableSkeleton } from '../components/common/SkeletonLoader';

export const DEFAULT_WEEKLY_HOURS: MerchantWeeklyHours = {
  monday: { open: '08:00', close: '22:00', isOpen: true, closed: false },
  tuesday: { open: '08:00', close: '22:00', isOpen: true, closed: false },
  wednesday: { open: '08:00', close: '22:00', isOpen: true, closed: false },
  thursday: { open: '08:00', close: '22:00', isOpen: true, closed: false },
  friday: { open: '08:00', close: '22:00', isOpen: true, closed: false },
  saturday: { open: '08:00', close: '22:00', isOpen: true, closed: false },
  sunday: { open: '08:00', close: '22:00', isOpen: true, closed: false }
};

export function parseDate(val: any): Date | null {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (typeof val.toDate === 'function') {
    try {
      const d = val.toDate();
      return isNaN(d.getTime()) ? null : d;
    } catch {
      return null;
    }
  }
  if (typeof val.toMillis === 'function') {
    return new Date(val.toMillis());
  }
  if (typeof val === 'number') return new Date(val);
  if (typeof val === 'string') {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }
  if (val && typeof val.seconds === 'number') {
    return new Date(val.seconds * 1000 + (val.nanoseconds ? val.nanoseconds / 1000000 : 0));
  }
  return null;
}

export function formatInPlatformTz(date: Date, platformTimezone: string = 'Asia/Manila'): string {
  const tz = platformTimezone || 'Asia/Manila';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

export function effectiveOpen(
  shop: Merchant,
  platformTimezone: string = 'Asia/Manila'
): {
  isOpen: boolean;
  reason: string;
  closedUntilDate?: Date | null;
  openUntilDate?: Date | null;
} {
  const now = new Date();
  const tz = platformTimezone || 'Asia/Manila';

  // 1. false if status != "active"
  if (shop.status !== 'active') {
    return { isOpen: false, reason: 'Suspended' };
  }

  // 2. false if closedUntil is set and now < closedUntil
  const closedUntilDate = parseDate(shop.closedUntil);
  if (closedUntilDate && now.getTime() < closedUntilDate.getTime()) {
    const isFarFuture = closedUntilDate.getFullYear() >= 2099;
    const formatted = isFarFuture ? '2100-01-01' : formatInPlatformTz(closedUntilDate, tz);
    return {
      isOpen: false,
      reason: `Closed manually until ${formatted}`,
      closedUntilDate
    };
  }

  // 3. false if isPaused and now < pauseUntilTime
  const pauseUntilDate = parseDate(shop.pauseUntilTime);
  if (shop.isPaused && pauseUntilDate && now.getTime() < pauseUntilDate.getTime()) {
    return {
      isOpen: false,
      reason: 'Paused'
    };
  }

  // 4. true if openUntil is set and now < openUntil
  const openUntilDate = parseDate(shop.openUntil);
  if (openUntilDate && now.getTime() < openUntilDate.getTime()) {
    return {
      isOpen: true,
      reason: `Open manually until ${formatInPlatformTz(openUntilDate, tz)}`,
      openUntilDate
    };
  }

  // 5. else if autoSchedule and hours exist, inside today's window (platform timezone, default "Asia/Manila"; overnight windows check yesterday)
  if (shop.autoSchedule && shop.hours) {
    let currentDayName = 'monday';
    let currentTimeStr = '12:00';

    try {
      const dayFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        weekday: 'long'
      });
      currentDayName = dayFormatter.format(now).toLowerCase();

      const timeFormatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
      currentTimeStr = timeFormatter.format(now);
    } catch {
      const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      currentDayName = days[now.getDay()];
      currentTimeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    }

    const daysOrder = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const currentDayIdx = daysOrder.indexOf(currentDayName);
    const prevDayIdx = (currentDayIdx + 6) % 7;
    const prevDayName = daysOrder[prevDayIdx];

    const todaySchedule = shop.hours[currentDayName];
    const yesterdaySchedule = shop.hours[prevDayName];

    let insideWindow = false;

    // Overnight window check from yesterday: if yesterday's window crossed midnight (close < open, e.g. 18:00 to 02:00)
    if (yesterdaySchedule && !yesterdaySchedule.closed && yesterdaySchedule.isOpen !== false) {
      const yOpen = yesterdaySchedule.open || '00:00';
      const yClose = yesterdaySchedule.close || '00:00';
      if (yClose < yOpen && currentTimeStr < yClose) {
        insideWindow = true;
      }
    }

    // Today's schedule check
    if (!insideWindow && todaySchedule && !todaySchedule.closed && todaySchedule.isOpen !== false) {
      const tOpen = todaySchedule.open || '08:00';
      const tClose = todaySchedule.close || '22:00';
      if (tClose > tOpen) {
        // Standard daytime window
        if (currentTimeStr >= tOpen && currentTimeStr < tClose) {
          insideWindow = true;
        }
      } else if (tClose < tOpen) {
        // Overnight window starting today
        if (currentTimeStr >= tOpen) {
          insideWindow = true;
        }
      }
    }

    if (insideWindow) {
      return {
        isOpen: true,
        reason: 'Open (Operating hours)'
      };
    } else {
      return {
        isOpen: false,
        reason: 'Outside hours'
      };
    }
  }

  // 6. else isOpen
  return {
    isOpen: Boolean(shop.isOpen),
    reason: shop.isOpen ? 'Open' : 'Closed manually'
  };
}

export const computeEffectiveMerchantOpen = effectiveOpen;

export function getNextOpeningDate(
  shop: Merchant,
  platformTimezone: string = 'Asia/Manila'
): { isoString: string; displayString: string } {
  const fallbackISO = '2100-01-01T00:00:00.000Z';
  const fallbackDisplay = '2100-01-01';

  if (!shop.autoSchedule || !shop.hours) {
    return { isoString: fallbackISO, displayString: fallbackDisplay };
  }

  const tz = platformTimezone || 'Asia/Manila';
  const now = new Date();

  let currentDayName = 'monday';
  let currentTimeStr = '12:00';
  let currentYear = now.getFullYear();
  let currentMonth = now.getMonth() + 1;
  let currentDayOfMonth = now.getDate();

  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(now);

    for (const p of parts) {
      if (p.type === 'weekday') currentDayName = p.value.toLowerCase();
      if (p.type === 'year') currentYear = parseInt(p.value, 10);
      if (p.type === 'month') currentMonth = parseInt(p.value, 10);
      if (p.type === 'day') currentDayOfMonth = parseInt(p.value, 10);
      if (p.type === 'hour') currentTimeStr = p.value + ':';
      if (p.type === 'minute') currentTimeStr += p.value;
    }
  } catch {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    currentDayName = days[now.getDay()];
    currentTimeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  }

  const daysOrder = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const currentDayIdx = daysOrder.indexOf(currentDayName);

  // Check today first (if current time is before today's open time)
  const todaySchedule = shop.hours[currentDayName];
  if (
    todaySchedule &&
    !todaySchedule.closed &&
    todaySchedule.isOpen !== false &&
    todaySchedule.open &&
    currentTimeStr < todaySchedule.open
  ) {
    const iso = `${String(currentYear).padStart(4, '0')}-${String(currentMonth).padStart(2, '0')}-${String(currentDayOfMonth).padStart(2, '0')}T${todaySchedule.open}:00+08:00`;
    return {
      isoString: iso,
      displayString: `Today at ${todaySchedule.open}`
    };
  }

  // Look ahead across the next 7 days
  for (let offset = 1; offset <= 7; offset++) {
    const nextDayIdx = (currentDayIdx + offset) % 7;
    const nextDayName = daysOrder[nextDayIdx];
    const sched = shop.hours[nextDayName];
    if (sched && !sched.closed && sched.isOpen !== false && sched.open) {
      const d = new Date(now.getTime() + offset * 86400000);
      let y = d.getFullYear();
      let m = d.getMonth() + 1;
      let dayNum = d.getDate();
      try {
        const parts = new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          year: 'numeric',
          month: 'numeric',
          day: 'numeric'
        }).formatToParts(d);
        for (const p of parts) {
          if (p.type === 'year') y = parseInt(p.value, 10);
          if (p.type === 'month') m = parseInt(p.value, 10);
          if (p.type === 'day') dayNum = parseInt(p.value, 10);
        }
      } catch {}

      const iso = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}T${sched.open}:00+08:00`;
      const capitalizedDay = nextDayName.charAt(0).toUpperCase() + nextDayName.slice(1);
      return {
        isoString: iso,
        displayString: offset === 1 ? `Tomorrow at ${sched.open}` : `${capitalizedDay} at ${sched.open}`
      };
    }
  }

  return { isoString: fallbackISO, displayString: fallbackDisplay };
}

export const Merchants: React.FC = () => {
  const [searchParams] = useSearchParams();
  const initialSearch = searchParams.get('search') || '';

  const { selectedCityId, cities } = useCity();
  const { adminProfile } = useAuth();
  const { showSuccess, showError } = useToast();

  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [loading, setLoading] = useState(true);

  // Platform Timezone
  const [platformTimezone, setPlatformTimezone] = useState('Asia/Manila');

  // Filters
  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [typeFilter, setTypeFilter] = useState<'all' | 'food' | 'convenience'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'suspended'>('all');
  const [openFilter, setOpenFilter] = useState<'all' | 'open' | 'closed'>('all');

  // Selected Merchant for detail
  const [selectedMerchant, setSelectedMerchant] = useState<Merchant | null>(null);
  const [activeTab, setActiveTab] = useState<'details' | 'status' | 'location' | 'menu' | 'orders' | 'changes' | 'history' | 'wallet'>('details');

  // Operating Hours & AutoSchedule
  const [merchantHours, setMerchantHours] = useState<MerchantWeeklyHours>(DEFAULT_WEEKLY_HOURS);
  const [merchantAutoSchedule, setMerchantAutoSchedule] = useState<boolean>(false);
  const [savingHours, setSavingHours] = useState<boolean>(false);

  // Merchant Wallet & Customer Linking State
  const [merchantWalletTxns, setMerchantWalletTxns] = useState<WalletTransaction[]>([]);
  const [loadingWalletTxns, setLoadingWalletTxns] = useState(false);
  const [linkedCustomer, setLinkedCustomer] = useState<{
    uid: string;
    email: string;
    name: string;
    walletBalance: number;
  } | null>(null);
  const [loadingLinkedCustomer, setLoadingLinkedCustomer] = useState(false);

  // Cash In Modal
  const [cashInModalOpen, setCashInModalOpen] = useState(false);
  const [cashInAmount, setCashInAmount] = useState<number>(0);
  const [cashInNote, setCashInNote] = useState('');
  const [addingCash, setAddingCash] = useState(false);

  // Adjust / Deduct Modal
  const [adjustModalOpen, setAdjustModalOpen] = useState(false);
  const [adjustType, setAdjustType] = useState<'add' | 'deduct'>('add');
  const [adjustAmount, setAdjustAmount] = useState<number>(0);
  const [adjustReason, setAdjustReason] = useState('');
  const [submittingAdjust, setSubmittingAdjust] = useState(false);

  // Link to Customer Account Modal
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [customerSearchQuery, setCustomerSearchQuery] = useState('');
  const [allCustomers, setAllCustomers] = useState<any[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [selectedCandidateCustomer, setSelectedCandidateCustomer] = useState<any | null>(null);
  const [confirmLinkModalOpen, setConfirmLinkModalOpen] = useState(false);
  const [linking, setLinking] = useState(false);

  // Unlink Modal
  const [unlinkModalOpen, setUnlinkModalOpen] = useState(false);
  const [unlinkReason, setUnlinkReason] = useState('');
  const [unlinking, setUnlinking] = useState(false);

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
  const [itemSets, setItemSets] = useState<MenuSet[]>([]);
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
          walletBalance: Number(dt.walletBalance || 0),
          linkedCustomerUid: dt.linkedCustomerUid || null,
          linkedCustomerEmail: dt.linkedCustomerEmail || null,
          linkedCustomerName: dt.linkedCustomerName || null,
          linkedAt: dt.linkedAt || null,
          hours: dt.hours,
          autoSchedule: Boolean(dt.autoSchedule),
          isPaused: Boolean(dt.isPaused),
          pauseUntilTime: dt.pauseUntilTime,
          closedUntil: dt.closedUntil || null,
          openUntil: dt.openUntil || null,
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
    // Load platform timezone
    const fetchPlatformSettings = async () => {
      try {
        const snap = await getDoc(doc(db, 'settings', 'platform'));
        if (snap.exists() && snap.data().timezone) {
          setPlatformTimezone(snap.data().timezone);
        }
      } catch (err) {
        console.warn('Could not load platform timezone:', err);
      }
    };
    fetchPlatformSettings();
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

    // Initialize Hours & AutoSchedule
    setMerchantHours(selectedMerchant.hours || DEFAULT_WEEKLY_HOURS);
    setMerchantAutoSchedule(Boolean(selectedMerchant.autoSchedule));

    // Fetch Wallet Data
    fetchMerchantWallet(selectedMerchant);

    // Fetch Menu
    fetchMenuData(selectedMerchant.id);
    // Fetch Orders & Payouts
    fetchOrdersAndPayouts(selectedMerchant.id);
    // Fetch Change Requests
    fetchChangeRequests(selectedMerchant.id);
    // Fetch Edit History
    fetchEditHistory(selectedMerchant.id);
  }, [selectedMerchant]);

  // Fetch Merchant Wallet and linked customer
  const fetchMerchantWallet = async (merchant: Merchant) => {
    try {
      setLoadingWalletTxns(true);
      if (merchant.linkedCustomerUid) {
        setLoadingLinkedCustomer(true);
        const uSnap = await getDoc(doc(db, 'users', merchant.linkedCustomerUid));
        if (uSnap.exists()) {
          const uDt = uSnap.data();
          setLinkedCustomer({
            uid: uSnap.id,
            email: uDt.email || merchant.linkedCustomerEmail || '',
            name: uDt.name || merchant.linkedCustomerName || 'Customer',
            walletBalance: Number(uDt.walletBalance || 0)
          });
        } else {
          setLinkedCustomer(null);
        }
        setLoadingLinkedCustomer(false);
      } else {
        setLinkedCustomer(null);
      }

      const qTxn = query(
        collection(db, 'walletTransactions'),
        where('merchantId', '==', merchant.id),
        limit(100)
      );
      const snap = await getDocs(qTxn);
      const list: WalletTransaction[] = [];
      snap.forEach((d) => {
        const dt = d.data();
        list.push({
          id: d.id,
          merchantId: dt.merchantId,
          customerId: dt.customerId,
          type: dt.type || 'credit',
          amount: Number(dt.amount || 0),
          note: dt.note || '',
          adminId: dt.adminId || '',
          adminName: dt.adminName || '',
          balanceAfter: Number(dt.balanceAfter || 0),
          createdAt: dt.createdAt
        });
      });
      list.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setMerchantWalletTxns(list);
    } catch (err) {
      console.error('Failed to load merchant wallet transactions:', err);
    } finally {
      setLoadingWalletTxns(false);
    }
  };

  // 1. Add Cash to Merchant Wallet (In One Transaction)
  const handleAddCash = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMerchant || cashInAmount <= 0) {
      showError('Please enter a valid cash amount.');
      return;
    }

    try {
      setAddingCash(true);
      const isLinked = Boolean(selectedMerchant.linkedCustomerUid);
      const now = Timestamp.now();
      const txnRef = doc(collection(db, 'walletTransactions'));
      const adminId = adminProfile?.uid || 'admin';
      const adminName = adminProfile?.name || 'Administrator';
      const note = cashInNote.trim() || `Cash added by admin (${adminName})`;
      let balanceAfter = 0;

      await runTransaction(db, async (t) => {
        if (isLinked) {
          const custRef = doc(db, 'users', selectedMerchant.linkedCustomerUid!);
          const cSnap = await t.get(custRef);
          if (!cSnap.exists()) throw new Error('Linked customer account not found.');
          const currentBal = Number(cSnap.data().walletBalance || 0);
          balanceAfter = currentBal + cashInAmount;

          t.update(custRef, {
            walletBalance: balanceAfter,
            updatedAt: now
          });

          t.set(txnRef, {
            merchantId: selectedMerchant.id,
            customerId: selectedMerchant.linkedCustomerUid,
            type: 'credit',
            amount: cashInAmount,
            note,
            adminId,
            adminName,
            balanceAfter,
            createdAt: now
          });
        } else {
          const mRef = doc(db, 'merchants', selectedMerchant.id);
          const mSnap = await t.get(mRef);
          if (!mSnap.exists()) throw new Error('Merchant record not found.');
          const currentBal = Number(mSnap.data().walletBalance || 0);
          balanceAfter = currentBal + cashInAmount;

          t.update(mRef, {
            walletBalance: balanceAfter,
            updatedAt: now
          });

          t.set(txnRef, {
            merchantId: selectedMerchant.id,
            type: 'credit',
            amount: cashInAmount,
            note,
            adminId,
            adminName,
            balanceAfter,
            createdAt: now
          });
        }
      });

      await logAuditEvent({
        adminId,
        adminName,
        adminEmail: adminProfile?.email,
        action: 'ADD_MERCHANT_WALLET_CASH',
        entityType: 'merchant',
        entityId: selectedMerchant.id,
        details: `Added ₱${cashInAmount.toFixed(2)} to ${
          isLinked ? `shared customer wallet (${selectedMerchant.linkedCustomerEmail})` : 'merchant wallet'
        }. New balance: ₱${balanceAfter.toFixed(2)}`
      });

      showSuccess(`Successfully added ₱${cashInAmount.toFixed(2)}.`);
      setCashInAmount(0);
      setCashInNote('');
      setCashInModalOpen(false);

      if (isLinked) {
        setLinkedCustomer((prev) => prev ? { ...prev, walletBalance: balanceAfter } : null);
      } else {
        setSelectedMerchant((prev) => prev ? { ...prev, walletBalance: balanceAfter } : null);
        setMerchants((prev) => prev.map((m) => m.id === selectedMerchant.id ? { ...m, walletBalance: balanceAfter } : m));
      }
      fetchMerchantWallet(selectedMerchant);
    } catch (err: any) {
      showError(err);
    } finally {
      setAddingCash(false);
    }
  };

  // 2. Adjust / Deduct Merchant Wallet Balance (In One Transaction)
  const handleAdjustBalance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMerchant || adjustAmount <= 0) {
      showError('Please enter a valid adjustment amount.');
      return;
    }
    if (!adjustReason.trim()) {
      showError('Please provide a reason for this adjustment.');
      return;
    }

    try {
      setSubmittingAdjust(true);
      const isLinked = Boolean(selectedMerchant.linkedCustomerUid);
      const now = Timestamp.now();
      const txnRef = doc(collection(db, 'walletTransactions'));
      const adminId = adminProfile?.uid || 'admin';
      const adminName = adminProfile?.name || 'Administrator';
      const isDeduct = adjustType === 'deduct';
      const effectiveAmount = isDeduct ? -adjustAmount : adjustAmount;
      let balanceAfter = 0;

      await runTransaction(db, async (t) => {
        if (isLinked) {
          const custRef = doc(db, 'users', selectedMerchant.linkedCustomerUid!);
          const cSnap = await t.get(custRef);
          if (!cSnap.exists()) throw new Error('Linked customer account not found.');
          const currentBal = Number(cSnap.data().walletBalance || 0);
          balanceAfter = currentBal + effectiveAmount;

          t.update(custRef, {
            walletBalance: balanceAfter,
            updatedAt: now
          });

          t.set(txnRef, {
            merchantId: selectedMerchant.id,
            customerId: selectedMerchant.linkedCustomerUid,
            type: isDeduct ? 'debit' : 'adjust',
            amount: adjustAmount,
            note: `${isDeduct ? 'Deducted / adjusted' : 'Adjusted'} by admin (${adminName}): ${adjustReason.trim()}`,
            adminId,
            adminName,
            balanceAfter,
            createdAt: now
          });
        } else {
          const mRef = doc(db, 'merchants', selectedMerchant.id);
          const mSnap = await t.get(mRef);
          if (!mSnap.exists()) throw new Error('Merchant record not found.');
          const currentBal = Number(mSnap.data().walletBalance || 0);
          balanceAfter = currentBal + effectiveAmount;

          t.update(mRef, {
            walletBalance: balanceAfter,
            updatedAt: now
          });

          t.set(txnRef, {
            merchantId: selectedMerchant.id,
            type: isDeduct ? 'debit' : 'adjust',
            amount: adjustAmount,
            note: `${isDeduct ? 'Deducted / adjusted' : 'Adjusted'} by admin (${adminName}): ${adjustReason.trim()}`,
            adminId,
            adminName,
            balanceAfter,
            createdAt: now
          });
        }
      });

      await logAuditEvent({
        adminId,
        adminName,
        adminEmail: adminProfile?.email,
        action: 'ADJUST_MERCHANT_WALLET',
        entityType: 'merchant',
        entityId: selectedMerchant.id,
        reason: adjustReason.trim(),
        details: `${isDeduct ? 'Deducted' : 'Added'} ₱${adjustAmount.toFixed(2)} on ${
          isLinked ? `shared customer wallet (${selectedMerchant.linkedCustomerEmail})` : 'merchant wallet'
        }. Balance after: ₱${balanceAfter.toFixed(2)}`
      });

      showSuccess(`Wallet balance adjusted by ₱${effectiveAmount.toFixed(2)}.`);
      setAdjustAmount(0);
      setAdjustReason('');
      setAdjustModalOpen(false);

      if (isLinked) {
        setLinkedCustomer((prev) => prev ? { ...prev, walletBalance: balanceAfter } : null);
      } else {
        setSelectedMerchant((prev) => prev ? { ...prev, walletBalance: balanceAfter } : null);
        setMerchants((prev) => prev.map((m) => m.id === selectedMerchant.id ? { ...m, walletBalance: balanceAfter } : m));
      }
      fetchMerchantWallet(selectedMerchant);
    } catch (err: any) {
      showError(err);
    } finally {
      setSubmittingAdjust(false);
    }
  };

  // 3. Open Link Customer Modal & fetch customers
  const handleOpenLinkModal = async () => {
    setLinkModalOpen(true);
    setCustomerSearchQuery('');
    setSelectedCandidateCustomer(null);
    try {
      setLoadingCustomers(true);
      const qCust = query(collection(db, 'users'), where('role', '==', 'customer'), limit(150));
      const snap = await getDocs(qCust);
      const list: any[] = [];
      snap.forEach((d) => {
        const dt = d.data();
        list.push({
          uid: d.id,
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

  // 4. Confirm Link Customer in ONE Transaction
  const handleConfirmLink = async () => {
    if (!selectedMerchant || !selectedCandidateCustomer) return;
    try {
      setLinking(true);

      // Validate customer exists and has role customer
      const custDocRef = doc(db, 'users', selectedCandidateCustomer.uid);
      const custDocSnap = await getDoc(custDocRef);
      if (!custDocSnap.exists()) {
        throw new Error('Customer account does not exist.');
      }
      const custData = custDocSnap.data();
      if ((custData.role || '').toLowerCase() !== 'customer') {
        throw new Error(`Customer must have role "customer", found "${custData.role}".`);
      }

      // Validate not linked to another merchant
      const qCheck = query(
        collection(db, 'merchants'),
        where('linkedCustomerUid', '==', selectedCandidateCustomer.uid)
      );
      const checkSnap = await getDocs(qCheck);
      const otherLinked = checkSnap.docs.filter((d) => d.id !== selectedMerchant.id);
      if (otherLinked.length > 0) {
        const otherData = otherLinked[0].data();
        throw new Error(
          `Customer ${selectedCandidateCustomer.email} is already linked to merchant "${otherData.name || otherLinked[0].id}". A customer account cannot be linked to multiple merchants.`
        );
      }

      const mRef = doc(db, 'merchants', selectedMerchant.id);
      const now = Timestamp.now();
      const txnRef = doc(collection(db, 'walletTransactions'));
      const adminId = adminProfile?.uid || 'admin';
      const adminName = adminProfile?.name || 'Administrator';
      let merchantBal = 0;
      let custBal = 0;
      let mergedBal = 0;

      await runTransaction(db, async (t) => {
        const mSnap = await t.get(mRef);
        if (!mSnap.exists()) throw new Error('Merchant record not found.');
        const cSnap = await t.get(custDocRef);
        if (!cSnap.exists()) throw new Error('Customer record not found.');

        merchantBal = Number(mSnap.data().walletBalance || 0);
        custBal = Number(cSnap.data().walletBalance || 0);
        mergedBal = custBal + merchantBal;

        t.update(mRef, {
          linkedCustomerUid: selectedCandidateCustomer.uid,
          linkedCustomerEmail: selectedCandidateCustomer.email,
          linkedCustomerName: selectedCandidateCustomer.name,
          linkedAt: now,
          walletBalance: 0,
          updatedAt: now
        });

        t.update(custDocRef, {
          walletBalance: mergedBal,
          updatedAt: now
        });

        t.set(txnRef, {
          merchantId: selectedMerchant.id,
          customerId: selectedCandidateCustomer.uid,
          type: 'merge',
          amount: merchantBal,
          note: `Merged merchant wallet (₱${merchantBal.toFixed(2)}) into customer account ${selectedCandidateCustomer.email}`,
          adminId,
          adminName,
          balanceAfter: mergedBal,
          createdAt: now
        });
      });

      await logAuditEvent({
        adminId,
        adminName,
        adminEmail: adminProfile?.email,
        action: 'LINK_MERCHANT_WALLET',
        entityType: 'merchant',
        entityId: selectedMerchant.id,
        details: `Linked merchant to customer ${selectedCandidateCustomer.email}. Merged balance ₱${merchantBal.toFixed(2)} into customer wallet (new shared balance: ₱${mergedBal.toFixed(2)}).`
      });

      showSuccess(`Merchant successfully linked to customer ${selectedCandidateCustomer.email}!`);
      setConfirmLinkModalOpen(false);
      setLinkModalOpen(false);

      const updatedMerchant: Merchant = {
        ...selectedMerchant,
        linkedCustomerUid: selectedCandidateCustomer.uid,
        linkedCustomerEmail: selectedCandidateCustomer.email,
        linkedCustomerName: selectedCandidateCustomer.name,
        linkedAt: now,
        walletBalance: 0
      };
      setSelectedMerchant(updatedMerchant);
      setMerchants((prev) => prev.map((m) => m.id === selectedMerchant.id ? updatedMerchant : m));
      fetchMerchantWallet(updatedMerchant);
    } catch (err: any) {
      showError(err);
    } finally {
      setLinking(false);
    }
  };

  // 5. Unlink Customer Shared Wallet (Requires reason)
  const handleUnlinkCustomer = async () => {
    if (!selectedMerchant || !unlinkReason.trim()) {
      showError('Please provide a reason for unlinking.');
      return;
    }
    try {
      setUnlinking(true);
      const mRef = doc(db, 'merchants', selectedMerchant.id);
      const adminId = adminProfile?.uid || 'admin';
      const adminName = adminProfile?.name || 'Administrator';
      const prevEmail = selectedMerchant.linkedCustomerEmail;

      await updateDoc(mRef, {
        linkedCustomerUid: null,
        linkedCustomerEmail: null,
        linkedCustomerName: null,
        linkedAt: null,
        updatedAt: Timestamp.now()
      });

      await logAuditEvent({
        adminId,
        adminName,
        adminEmail: adminProfile?.email,
        action: 'UNLINK_MERCHANT_WALLET',
        entityType: 'merchant',
        entityId: selectedMerchant.id,
        reason: unlinkReason.trim(),
        details: `Unlinked shared wallet customer account ${prevEmail}. Reason: ${unlinkReason.trim()}`
      });

      showSuccess('Merchant shared wallet unlinked successfully.');
      setUnlinkModalOpen(false);
      setUnlinkReason('');

      const updatedMerchant: Merchant = {
        ...selectedMerchant,
        linkedCustomerUid: null,
        linkedCustomerEmail: null,
        linkedCustomerName: null,
        linkedAt: null
      };
      setSelectedMerchant(updatedMerchant);
      setMerchants((prev) => prev.map((m) => m.id === selectedMerchant.id ? updatedMerchant : m));
      setLinkedCustomer(null);
      fetchMerchantWallet(updatedMerchant);
    } catch (err: any) {
      showError(err);
    } finally {
      setUnlinking(false);
    }
  };

  // 6. Save Operating Hours & AutoSchedule
  const handleSaveOperatingHours = async () => {
    if (!selectedMerchant) return;
    try {
      setSavingHours(true);
      const mRef = doc(db, 'merchants', selectedMerchant.id);
      await updateDoc(mRef, {
        hours: merchantHours,
        autoSchedule: Boolean(merchantAutoSchedule),
        updatedAt: Timestamp.now()
      });

      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        adminEmail: adminProfile?.email,
        action: 'UPDATE_MERCHANT_HOURS',
        entityType: 'merchant',
        entityId: selectedMerchant.id,
        details: `Updated operating hours & autoSchedule (${merchantAutoSchedule ? 'ON' : 'OFF'}) for ${selectedMerchant.name}`
      });

      showSuccess('Operating hours and autoSchedule schedule saved.');
      setSelectedMerchant((prev) => prev ? { ...prev, hours: merchantHours, autoSchedule: merchantAutoSchedule } : null);
      setMerchants((prev) => prev.map((m) => m.id === selectedMerchant.id ? { ...m, hours: merchantHours, autoSchedule: merchantAutoSchedule } : m));
    } catch (err: any) {
      showError(err);
    } finally {
      setSavingHours(false);
    }
  };

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
        const hasSetsVal = Boolean(dt.hasSets || (dt.sets && dt.sets.length > 0));
        itemsList.push({
          id: d.id,
          categoryId: dt.categoryId,
          name: dt.name || 'Item',
          price: Number(dt.price) || 0,
          description: dt.description || '',
          imageUrl: dt.imageUrl || '',
          available: dt.available !== false,
          hasSets: hasSetsVal,
          sets: dt.sets || [],
          createdAt: dt.createdAt,
          updatedAt: dt.updatedAt
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

  // Force Close (closedUntil = next opening or 2100-01-01)
  const handleForceCloseMerchant = async (merchantToClose: Merchant) => {
    try {
      const nextOpening = getNextOpeningDate(merchantToClose, platformTimezone);
      const closedUntilVal = nextOpening.isoString;
      const mRef = doc(db, 'merchants', merchantToClose.id);
      await updateDoc(mRef, {
        closedUntil: closedUntilVal,
        isOpen: false,
        updatedAt: Timestamp.now()
      });

      const adminId = adminProfile?.uid || 'admin';
      const adminName = adminProfile?.name || 'Administrator';

      await logAuditEvent({
        adminId,
        adminName,
        adminEmail: adminProfile?.email,
        action: 'MERCHANT_FORCE_CLOSE',
        entityType: 'merchant',
        entityId: merchantToClose.id,
        details: `Force closed merchant "${merchantToClose.name}" until ${nextOpening.displayString} (${closedUntilVal})`,
        oldValue: { closedUntil: merchantToClose.closedUntil || null, isOpen: merchantToClose.isOpen },
        newValue: { closedUntil: closedUntilVal, isOpen: false }
      });

      setMerchants((prev) =>
        prev.map((m) =>
          m.id === merchantToClose.id
            ? { ...m, closedUntil: closedUntilVal, isOpen: false }
            : m
        )
      );
      if (selectedMerchant && selectedMerchant.id === merchantToClose.id) {
        setSelectedMerchant((prev) =>
          prev ? { ...prev, closedUntil: closedUntilVal, isOpen: false } : null
        );
      }

      showSuccess(`Force closed "${merchantToClose.name}" until ${nextOpening.displayString}.`);
    } catch (err: any) {
      showError(err);
    }
  };

  // Reopen (closedUntil null)
  const handleReopenMerchant = async (merchantToReopen: Merchant) => {
    try {
      const mRef = doc(db, 'merchants', merchantToReopen.id);
      await updateDoc(mRef, {
        closedUntil: null,
        isOpen: true,
        updatedAt: Timestamp.now()
      });

      const adminId = adminProfile?.uid || 'admin';
      const adminName = adminProfile?.name || 'Administrator';

      await logAuditEvent({
        adminId,
        adminName,
        adminEmail: adminProfile?.email,
        action: 'MERCHANT_REOPEN',
        entityType: 'merchant',
        entityId: merchantToReopen.id,
        details: `Reopened merchant "${merchantToReopen.name}" (cleared closedUntil, set isOpen true)`,
        oldValue: { closedUntil: merchantToReopen.closedUntil || null, isOpen: merchantToReopen.isOpen },
        newValue: { closedUntil: null, isOpen: true }
      });

      setMerchants((prev) =>
        prev.map((m) =>
          m.id === merchantToReopen.id
            ? { ...m, closedUntil: null, isOpen: true }
            : m
        )
      );
      if (selectedMerchant && selectedMerchant.id === merchantToReopen.id) {
        setSelectedMerchant((prev) =>
          prev ? { ...prev, closedUntil: null, isOpen: true } : null
        );
      }

      showSuccess(`Reopened "${merchantToReopen.name}". Store is now available.`);
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

      // Validate sets if any
      const sanitizedSets: MenuSet[] = [];
      for (let sIdx = 0; sIdx < itemSets.length; sIdx++) {
        const s = itemSets[sIdx];
        const sName = (s.name || '').trim();
        if (!sName) {
          showError(`Option Set #${sIdx + 1} requires a name.`);
          setSavingItem(false);
          return;
        }
        if (!s.choices || s.choices.length === 0) {
          showError(`Option Set "${sName}" must have at least one choice.`);
          setSavingItem(false);
          return;
        }
        const validChoices: MenuChoice[] = [];
        for (let cIdx = 0; cIdx < s.choices.length; cIdx++) {
          const c = s.choices[cIdx];
          const cName = (c.name || '').trim();
          if (!cName) {
            showError(`Choice #${cIdx + 1} in set "${sName}" requires a name.`);
            setSavingItem(false);
            return;
          }
          const price = Math.max(0, Number(c.price) || 0);
          validChoices.push({
            id: c.id || `c_${sIdx}_${cIdx}_${Date.now().toString(36)}`,
            name: cName,
            price,
            available: c.available !== false
          });
        }
        sanitizedSets.push({
          id: s.id || `set_${sIdx}_${Date.now().toString(36)}`,
          name: sName,
          required: Boolean(s.required),
          maxSelect: Math.max(1, Number(s.maxSelect) || 1),
          sortOrder: typeof s.sortOrder === 'number' ? s.sortOrder : sIdx,
          choices: validChoices
        });
      }
      const hasSets = sanitizedSets.length > 0;

      if (editingItem) {
        // Edit - never overwrite sets/hasSets unless modified via form
        const itemDoc = doc(db, 'merchants', selectedMerchant.id, 'items', editingItem.id);
        const updatePayload: Record<string, any> = {
          name: itemName.trim(),
          price: Number(itemPrice) || 0,
          description: itemDesc.trim(),
          imageUrl: itemImageUrl.trim(),
          categoryId: itemCategory,
          available: itemAvailable,
          hasSets,
          sets: sanitizedSets,
          updatedAt: Timestamp.now()
        };
        await updateDoc(itemDoc, updatePayload);
        updatedItems = menuItems.map((i) =>
          i.id === editingItem.id
            ? {
                ...i,
                name: itemName.trim(),
                price: Number(itemPrice) || 0,
                description: itemDesc.trim(),
                imageUrl: itemImageUrl.trim(),
                categoryId: itemCategory,
                available: itemAvailable,
                hasSets,
                sets: sanitizedSets
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
          hasSets,
          sets: sanitizedSets,
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
          hasSets,
          sets: sanitizedSets,
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

      // Automatic inbox notice to merchant
      try {
        await addDoc(collection(db, 'inbox'), {
          title: `Change Request Approved: ${req.kind}`,
          body: `Your request to update ${req.kind} has been approved and applied. (New value: ${req.newValue})`,
          category: 'update',
          imageUrl: null,
          link: null,
          audience: null,
          customerId: null,
          riderId: null,
          merchantId: req.merchantId || selectedMerchant.id,
          merchantName: selectedMerchant.name || null,
          createdAt: Timestamp.now(),
          createdBy: adminProfile?.uid || 'admin',
          createdByName: adminProfile?.name || 'Administrator'
        });
      } catch (inboxErr) {
        console.warn('Failed to send inbox notice for change request approval:', inboxErr);
      }

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

      // Automatic inbox notice to merchant
      try {
        await addDoc(collection(db, 'inbox'), {
          title: `Change Request Rejected: ${targetChangeRequest.kind}`,
          body: `Your request to update ${targetChangeRequest.kind} was rejected by administration. Reason: ${reason || 'Does not comply with platform policy'}`,
          category: 'update',
          imageUrl: null,
          link: null,
          audience: null,
          customerId: null,
          riderId: null,
          merchantId: targetChangeRequest.merchantId || selectedMerchant?.id,
          merchantName: selectedMerchant?.name || null,
          createdAt: Timestamp.now(),
          createdBy: adminProfile?.uid || 'admin',
          createdByName: adminProfile?.name || 'Administrator'
        });
      } catch (inboxErr) {
        console.warn('Failed to send inbox notice for change request rejection:', inboxErr);
      }

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
      const eff = effectiveOpen(m, platformTimezone);
      if (openFilter === 'open' && !eff.isOpen) return false;
      if (openFilter === 'closed' && eff.isOpen) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const n = (m.name || '').toLowerCase();
        const o = (m.ownerName || '').toLowerCase();
        const p = (m.phone || '').toLowerCase();
        if (!n.includes(q) && !o.includes(q) && !p.includes(q)) return false;
      }
      return true;
    });
  }, [merchants, selectedCityId, typeFilter, categoryFilter, statusFilter, openFilter, searchQuery, platformTimezone]);

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
            const rows = filteredMerchants.map((m) => {
              const eff = effectiveOpen(m, platformTimezone);
              return {
                ID: m.id,
                Name: m.name,
                Owner: m.ownerName,
                Phone: m.phone,
                Type: m.type,
                Status: m.status,
                EffectiveStatus: eff.isOpen ? 'Open' : 'Closed',
                EffectiveReason: eff.reason,
                CommissionRate: m.commissionRate
              };
            });
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
                        {(() => {
                          const eff = effectiveOpen(m, platformTimezone);
                          const isSuspended = m.status === 'suspended';
                          return (
                            <div className="flex flex-col gap-0.5">
                              <div className="flex items-center gap-1.5" title={eff.reason}>
                                <span
                                  className={`w-2 h-2 rounded-full shrink-0 ${
                                    isSuspended
                                      ? 'bg-red-500'
                                      : eff.isOpen
                                      ? 'bg-emerald-500'
                                      : 'bg-gray-400'
                                  }`}
                                />
                                <span
                                  className={`font-bold ${
                                    isSuspended
                                      ? 'text-red-600 dark:text-red-400'
                                      : eff.isOpen
                                      ? 'text-emerald-700 dark:text-emerald-400'
                                      : 'text-gray-700 dark:text-zinc-300'
                                  }`}
                                >
                                  {isSuspended ? 'Suspended' : eff.isOpen ? 'Open' : 'Closed'}
                                </span>
                              </div>
                              <span
                                className="text-[10px] text-gray-500 dark:text-zinc-400 truncate max-w-[200px]"
                                title={eff.reason}
                              >
                                {eff.reason}
                              </span>
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3 font-bold text-amber-600">
                        {m.commissionRate || 15}%
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {(() => {
                            const isForceClosed = Boolean(
                              m.closedUntil &&
                              parseDate(m.closedUntil) &&
                              new Date().getTime() < parseDate(m.closedUntil)!.getTime()
                            );
                            if (isForceClosed) {
                              return (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleReopenMerchant(m);
                                  }}
                                  title="Clear closedUntil and reopen this merchant"
                                  className="px-2 py-1 rounded-lg text-[11px] font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 hover:bg-emerald-100 transition-colors"
                                >
                                  Reopen
                                </button>
                              );
                            }
                            return (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleForceCloseMerchant(m);
                                }}
                                title="Force close until next opening or 2100-01-01"
                                className="px-2 py-1 rounded-lg text-[11px] font-bold bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300 dark:border-amber-800 hover:bg-amber-100 transition-colors"
                              >
                                Force close
                              </button>
                            );
                          })()}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedMerchant(m);
                            }}
                            className="px-2.5 py-1 rounded-lg text-xs font-bold text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40 transition-colors"
                          >
                            Manage &rarr;
                          </button>
                        </div>
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
                  <h3 className="font-extrabold text-lg text-gray-900 dark:text-white flex items-center gap-2 flex-wrap">
                    <span>{selectedMerchant.name}</span>
                    {(() => {
                      const eff = effectiveOpen(selectedMerchant, platformTimezone);
                      return (
                        <span
                          title={eff.reason}
                          className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1.5 ${
                            eff.isOpen
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300'
                              : 'bg-gray-100 text-gray-700 dark:bg-zinc-800 dark:text-zinc-300 border border-gray-300'
                          }`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${eff.isOpen ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                          <span>{eff.isOpen ? 'Open' : 'Closed'}</span>
                          <span className="font-normal opacity-80">({eff.reason})</span>
                        </span>
                      );
                    })()}
                  </h3>
                  <p className="text-xs text-gray-400">ID: {selectedMerchant.id}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {(() => {
                  const isForceClosed = Boolean(
                    selectedMerchant.closedUntil &&
                    parseDate(selectedMerchant.closedUntil) &&
                    new Date().getTime() < parseDate(selectedMerchant.closedUntil)!.getTime()
                  );
                  if (isForceClosed) {
                    return (
                      <button
                        type="button"
                        onClick={() => handleReopenMerchant(selectedMerchant)}
                        className="px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5 shadow-xs transition-colors"
                      >
                        <Play className="w-3.5 h-3.5" />
                        <span>Reopen</span>
                      </button>
                    );
                  }
                  return (
                    <button
                      type="button"
                      onClick={() => handleForceCloseMerchant(selectedMerchant)}
                      className="px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white flex items-center gap-1.5 shadow-xs transition-colors"
                    >
                      <Ban className="w-3.5 h-3.5" />
                      <span>Force close</span>
                    </button>
                  );
                })()}

                <button
                  onClick={() => setSelectedMerchant(null)}
                  className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Navigation Tabs */}
            <div className="flex border-b border-gray-200 dark:border-zinc-800 px-5 pt-2 overflow-x-auto">
              {[
                { id: 'details', label: 'Details' },
                { id: 'status', label: 'Status & Hours' },
                { id: 'wallet', label: 'Wallet' },
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

              {/* TAB 2: STATUS & OPERATING HOURS */}
              {activeTab === 'status' && (
                <div className="space-y-6">
                  {/* Effective Live Status Indicator Card */}
                  {(() => {
                    const eff = effectiveOpen(selectedMerchant, platformTimezone);
                    const isForceClosed = Boolean(
                      selectedMerchant.closedUntil &&
                      parseDate(selectedMerchant.closedUntil) &&
                      new Date().getTime() < parseDate(selectedMerchant.closedUntil)!.getTime()
                    );
                    const nextOpening = getNextOpeningDate(selectedMerchant, platformTimezone);

                    return (
                      <div className="space-y-3">
                        <div
                          className={`p-4 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                            eff.isOpen
                              ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-800'
                              : 'bg-gray-50 dark:bg-zinc-900 border-gray-200 dark:border-zinc-800'
                          }`}
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span
                                className={`w-3 h-3 rounded-full ${
                                  eff.isOpen ? 'bg-emerald-500 animate-pulse' : 'bg-gray-400'
                                }`}
                              />
                              <span className="font-extrabold text-sm text-gray-900 dark:text-white">
                                Effective Status: {eff.isOpen ? 'OPEN FOR ORDERS' : 'CLOSED TO CUSTOMERS'}
                              </span>
                            </div>
                            <p className="text-xs text-gray-600 dark:text-zinc-400">
                              Reason: <strong className="text-gray-900 dark:text-white">{eff.reason}</strong> (Timezone: <code className="font-mono text-amber-600">{platformTimezone}</code>)
                            </p>
                          </div>

                          <span
                            className={`self-start sm:self-auto px-3 py-1 rounded-full text-xs font-bold ${
                              eff.isOpen
                                ? 'bg-emerald-600 text-white'
                                : 'bg-gray-200 dark:bg-zinc-700 text-gray-800 dark:text-zinc-200'
                            }`}
                          >
                            {eff.isOpen ? 'Active Online' : 'Offline / Closed'}
                          </span>
                        </div>

                        {/* Force Close & Reopen Override Controls */}
                        <div className="p-4 rounded-2xl bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div>
                            <div className="font-bold text-xs text-amber-950 dark:text-amber-200 flex items-center gap-1.5">
                              <ShieldAlert className="w-4 h-4 text-amber-600" />
                              <span>Admin Override Availability</span>
                            </div>
                            <p className="text-[11px] text-amber-800/90 dark:text-amber-300 mt-0.5">
                              {isForceClosed ? (
                                <span>
                                  Store is currently Force Closed until <strong>{eff.closedUntilDate ? formatInPlatformTz(eff.closedUntilDate, platformTimezone) : 'reopen'}</strong>.
                                </span>
                              ) : (
                                <span>
                                  Force close sets <code>closedUntil</code> to next scheduled opening (<strong>{nextOpening.displayString}</strong>) or <strong>2100-01-01</strong> if unscheduled.
                                </span>
                              )}
                            </p>
                          </div>

                          <div className="flex items-center gap-2">
                            {isForceClosed ? (
                              <button
                                type="button"
                                onClick={() => handleReopenMerchant(selectedMerchant)}
                                className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5 shadow-xs transition-colors"
                              >
                                <Play className="w-3.5 h-3.5" />
                                <span>Reopen</span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleForceCloseMerchant(selectedMerchant)}
                                className="px-4 py-2 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white flex items-center gap-1.5 shadow-xs transition-colors"
                              >
                                <Ban className="w-3.5 h-3.5" />
                                <span>Force close</span>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Weekly Operating Hours & AutoSchedule Editor */}
                  <div className="p-4 rounded-2xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-gray-100 dark:border-zinc-800">
                      <div>
                        <div className="font-bold text-sm text-gray-900 dark:text-white flex items-center gap-2">
                          <Clock className="w-4 h-4 text-amber-500" />
                          <span>Weekly Operating Hours & Auto-Schedule</span>
                        </div>
                        <p className="text-xs text-gray-500">
                          Automatically opens and closes the store based on weekly time windows in {platformTimezone}.
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={handleSaveOperatingHours}
                        disabled={savingHours}
                        className="delivio-btn-yellow px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 self-start sm:self-auto"
                      >
                        {savingHours ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Clock className="w-3.5 h-3.5" />}
                        <span>Save Schedule</span>
                      </button>
                    </div>

                    {/* AutoSchedule Toggle */}
                    <div className="flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-zinc-850 border border-gray-200 dark:border-zinc-800">
                      <div>
                        <span className="font-bold text-xs text-gray-900 dark:text-white block">
                          Enable Auto-Schedule Mode
                        </span>
                        <span className="text-[11px] text-gray-500">
                          When turned on, store availability strictly follows the day schedules below (overnight windows supported).
                        </span>
                      </div>
                      <input
                        type="checkbox"
                        checked={merchantAutoSchedule}
                        onChange={(e) => setMerchantAutoSchedule(e.target.checked)}
                        className="w-5 h-5 rounded-md accent-amber-500 cursor-pointer"
                      />
                    </div>

                    {/* Schedule Grid: Monday - Sunday */}
                    <div className="space-y-2">
                      {[
                        { dayKey: 'monday', label: 'Monday' },
                        { dayKey: 'tuesday', label: 'Tuesday' },
                        { dayKey: 'wednesday', label: 'Wednesday' },
                        { dayKey: 'thursday', label: 'Thursday' },
                        { dayKey: 'friday', label: 'Friday' },
                        { dayKey: 'saturday', label: 'Saturday' },
                        { dayKey: 'sunday', label: 'Sunday' }
                      ].map(({ dayKey, label }) => {
                        const dayData: MerchantOperatingDay = merchantHours[dayKey] || {
                          open: '08:00',
                          close: '22:00',
                          isOpen: true,
                          closed: false
                        };
                        const isDayClosed = Boolean(dayData.closed || dayData.isOpen === false);

                        const updateDayField = (field: 'open' | 'close' | 'closed', val: any) => {
                          setMerchantHours((prev) => ({
                            ...prev,
                            [dayKey]: {
                              ...(prev[dayKey] || { open: '08:00', close: '22:00' }),
                              [field]: val,
                              ...(field === 'closed' ? { isOpen: !val } : {})
                            }
                          }));
                        };

                        return (
                          <div
                            key={dayKey}
                            className={`p-2.5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs transition-colors ${
                              isDayClosed
                                ? 'bg-gray-50/60 dark:bg-zinc-850/60 border-gray-200 dark:border-zinc-800 opacity-60'
                                : 'bg-white dark:bg-zinc-900 border-gray-200 dark:border-zinc-800'
                            }`}
                          >
                            <div className="flex items-center gap-3 sm:w-32">
                              <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={!isDayClosed}
                                  onChange={(e) => updateDayField('closed', !e.target.checked)}
                                  className="w-4 h-4 rounded-sm accent-amber-500"
                                />
                                <span className="font-bold text-gray-900 dark:text-white">
                                  {label}
                                </span>
                              </label>
                            </div>

                            <div className="flex items-center gap-2 flex-1 justify-end">
                              {!isDayClosed ? (
                                <>
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[11px] text-gray-400">Open:</span>
                                    <input
                                      type="time"
                                      value={dayData.open || '08:00'}
                                      onChange={(e) => updateDayField('open', e.target.value)}
                                      className="px-2 py-1 rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 font-mono text-xs"
                                    />
                                  </div>
                                  <span className="text-gray-400">—</span>
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[11px] text-gray-400">Close:</span>
                                    <input
                                      type="time"
                                      value={dayData.close || '22:00'}
                                      onChange={(e) => updateDayField('close', e.target.value)}
                                      className="px-2 py-1 rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 font-mono text-xs"
                                    />
                                  </div>
                                  {dayData.close && dayData.open && dayData.close < dayData.open && (
                                    <span className="text-[10px] font-bold text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950 px-1.5 py-0.5 rounded">
                                      Overnight
                                    </span>
                                  )}
                                </>
                              ) : (
                                <span className="text-gray-400 italic text-[11px] py-1">
                                  Closed all day
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Manual Open / Close Switch */}
                  <div className="p-4 rounded-2xl bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 flex items-center justify-between">
                    <div>
                      <div className="font-bold text-sm text-gray-900 dark:text-white">
                        Manual Open / Closed Override Switch
                      </div>
                      <p className="text-xs text-gray-500">
                        When manually closed or autoSchedule is off, controls store availability.
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
                      {selectedMerchant.isOpen ? 'Manual: Open' : 'Manual: Closed'}
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

              {/* TAB: WALLET & SHARED ACCOUNT */}
              {activeTab === 'wallet' && (
                <div className="space-y-6">
                  {/* Balance & Linking Status Banner */}
                  <div className="p-5 rounded-3xl bg-gradient-to-br from-amber-50 via-white to-amber-50/40 dark:from-zinc-900 dark:via-zinc-900 dark:to-zinc-850 border border-amber-200 dark:border-zinc-800 shadow-xs space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <Wallet className="w-5 h-5 text-amber-500" />
                          <h4 className="font-extrabold text-sm text-gray-900 dark:text-white uppercase tracking-wider">
                            {selectedMerchant.linkedCustomerUid ? 'Shared Delivio Wallet' : 'Merchant Wallet Balance'}
                          </h4>
                          {selectedMerchant.linkedCustomerUid ? (
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300">
                              Shared with Customer
                            </span>
                          ) : (
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-zinc-400">
                              Direct Merchant Account
                            </span>
                          )}
                        </div>

                        <div className="flex items-baseline gap-2">
                          <span className="text-3xl font-black text-gray-900 dark:text-white">
                            ₱
                            {selectedMerchant.linkedCustomerUid
                              ? (linkedCustomer ? linkedCustomer.walletBalance : 0).toFixed(2)
                              : (selectedMerchant.walletBalance || 0).toFixed(2)}
                          </span>
                          <span className="text-xs text-gray-400 font-semibold">Available Funds</span>
                        </div>
                      </div>

                      {/* Top-up and Adjust Action Buttons */}
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setCashInAmount(0);
                            setCashInNote('');
                            setCashInModalOpen(true);
                          }}
                          className="delivio-btn-yellow px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs"
                        >
                          <Plus className="w-4 h-4" />
                          <span>Add Cash</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setAdjustAmount(0);
                            setAdjustReason('');
                            setAdjustType('deduct');
                            setAdjustModalOpen(true);
                          }}
                          className="px-4 py-2.5 rounded-xl text-xs font-bold border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-200 hover:bg-gray-50 flex items-center gap-1.5 shadow-xs"
                        >
                          <Edit className="w-4 h-4 text-amber-500" />
                          <span>Adjust / Deduct</span>
                        </button>
                      </div>
                    </div>

                    {/* Customer Account Linking Card */}
                    <div className="p-4 rounded-2xl border border-gray-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-850/80 space-y-3">
                      {selectedMerchant.linkedCustomerUid ? (
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div className="flex items-start gap-3">
                            <div className="p-2.5 rounded-xl bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 shrink-0">
                              <LinkIcon className="w-4 h-4" />
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-xs text-gray-900 dark:text-white">
                                  Linked to Customer Account: {selectedMerchant.linkedCustomerEmail}
                                </span>
                                <span className="text-[10px] text-gray-400">
                                  ({selectedMerchant.linkedCustomerName || 'Customer'})
                                </span>
                              </div>
                              <p className="text-[11px] text-gray-500 mt-0.5">
                                Wallet is unified across store merchant operations and personal customer ordering. Top-ups and deductions affect the shared customer account balance.
                              </p>
                              {selectedMerchant.linkedAt && (
                                <p className="text-[10px] text-gray-400 mt-0.5">
                                  Linked on: {formatTimestamp(selectedMerchant.linkedAt)}
                                </p>
                              )}
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              setUnlinkReason('');
                              setUnlinkModalOpen(true);
                            }}
                            className="px-3 py-1.5 rounded-xl border border-red-300 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 text-xs font-bold flex items-center gap-1.5 self-start sm:self-auto shrink-0 transition-colors"
                          >
                            <Unlink className="w-3.5 h-3.5" />
                            <span>Unlink Account</span>
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div>
                            <span className="font-bold text-xs text-gray-900 dark:text-white block">
                              Link to Registered Customer Account
                            </span>
                            <p className="text-[11px] text-gray-500">
                              Merge store wallet balance into an existing Delivio customer account to enable a single unified wallet.
                            </p>
                          </div>

                          <button
                            type="button"
                            onClick={handleOpenLinkModal}
                            className="delivio-btn-yellow px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shrink-0 self-start sm:self-auto"
                          >
                            <LinkIcon className="w-3.5 h-3.5" />
                            <span>Link to Customer</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Wallet Transactions History Table */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="font-bold text-xs uppercase tracking-wider text-gray-700 dark:text-zinc-300">
                        Wallet Transaction History ({merchantWalletTxns.length})
                      </h4>
                      <button
                        type="button"
                        onClick={() => fetchMerchantWallet(selectedMerchant)}
                        className="text-xs text-amber-600 font-semibold hover:underline flex items-center gap-1"
                      >
                        <RotateCw className="w-3 h-3" /> Refresh
                      </button>
                    </div>

                    {loadingWalletTxns ? (
                      <div className="py-8 text-center text-xs text-gray-400">
                        <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-amber-500" />
                        Loading transaction ledger...
                      </div>
                    ) : merchantWalletTxns.length === 0 ? (
                      <div className="p-8 text-center text-xs text-gray-400 rounded-2xl border border-dashed border-gray-200 dark:border-zinc-800">
                        No recorded wallet transactions found for this merchant.
                      </div>
                    ) : (
                      <div className="border border-gray-200 dark:border-zinc-800 rounded-2xl overflow-hidden shadow-xs">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-gray-50 dark:bg-zinc-850/60 uppercase font-bold text-gray-500 dark:text-zinc-400 border-b border-gray-200 dark:border-zinc-800">
                            <tr>
                              <th className="px-4 py-3">Date / Time</th>
                              <th className="px-4 py-3">Type</th>
                              <th className="px-4 py-3">Amount</th>
                              <th className="px-4 py-3">Balance After</th>
                              <th className="px-4 py-3">Details / Note</th>
                              <th className="px-4 py-3">Admin</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 dark:divide-zinc-800 font-medium">
                            {merchantWalletTxns.map((tx) => (
                              <tr key={tx.id} className="hover:bg-gray-50 dark:hover:bg-zinc-800/40">
                                <td className="px-4 py-3 whitespace-nowrap text-gray-500">
                                  {formatTimestamp(tx.createdAt)}
                                </td>
                                <td className="px-4 py-3">
                                  <span
                                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                      tx.type === 'credit'
                                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                        : tx.type === 'merge'
                                        ? 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300'
                                        : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                                    }`}
                                  >
                                    {tx.type}
                                  </span>
                                </td>
                                <td
                                  className={`px-4 py-3 font-bold whitespace-nowrap ${
                                    tx.type === 'debit' ? 'text-red-600' : 'text-emerald-600'
                                  }`}
                                >
                                  {tx.type === 'debit' ? '-' : '+'}₱{Number(tx.amount || 0).toFixed(2)}
                                </td>
                                <td className="px-4 py-3 font-bold text-gray-900 dark:text-white whitespace-nowrap">
                                  ₱{Number(tx.balanceAfter || 0).toFixed(2)}
                                </td>
                                <td className="px-4 py-3 text-gray-600 dark:text-zinc-300 max-w-xs truncate">
                                  {tx.note || '—'}
                                </td>
                                <td className="px-4 py-3 text-gray-500 text-[11px] whitespace-nowrap">
                                  {tx.adminName || 'Admin'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
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
                              setItemSets([]);
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
                                    <div className="flex items-center gap-1 flex-wrap mt-0.5">
                                      <span
                                        className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
                                          item.categoryId && merchantAllowedCategories.includes(item.categoryId)
                                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                                            : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                                        }`}
                                      >
                                        {item.categoryId || 'No Category'}
                                      </span>
                                      {(item.hasSets || (item.sets && item.sets.length > 0)) && (
                                        <span
                                          className="inline-block text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-purple-100 text-purple-800 dark:bg-purple-950/70 dark:text-purple-300 border border-purple-200 dark:border-purple-800"
                                          title={`${item.sets?.length || 0} option set(s)`}
                                        >
                                          Set {item.sets?.length ? `(${item.sets.length})` : ''}
                                        </span>
                                      )}
                                    </div>
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
                                      setItemSets(
                                        item.sets && Array.isArray(item.sets)
                                          ? JSON.parse(JSON.stringify(item.sets))
                                          : []
                                      );
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
          <div className="w-full max-w-xl max-h-[90vh] flex flex-col bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden">
            <div className="p-5 border-b border-gray-100 dark:border-zinc-800 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-base text-gray-900 dark:text-white">
                  {editingItem ? 'Edit Menu Item' : 'Add New Item'}
                </h3>
                <p className="text-xs text-gray-500">
                  Configure item pricing, description, category, and customization sets.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setItemModalOpen(false)}
                className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveItem} className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
              <div>
                <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Item Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={itemName}
                  onChange={(e) => setItemName(e.target.value)}
                  required
                  placeholder="e.g. Delivio Special Burger"
                  className="w-full px-3.5 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                    Base Price (PHP) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={itemPrice}
                    onChange={(e) => setItemPrice(Number(e.target.value))}
                    required
                    className="w-full px-3.5 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white font-bold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                    Category ({selectedMerchant.type === 'food' ? 'Food & Restaurant' : 'Convenience'}) <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={itemCategory}
                    onChange={(e) => setItemCategory(e.target.value)}
                    required
                    className="w-full px-3.5 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white font-medium"
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
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Description
                </label>
                <textarea
                  rows={2}
                  value={itemDesc}
                  onChange={(e) => setItemDesc(e.target.value)}
                  placeholder="Short description of ingredients, flavor, or serving size..."
                  className="w-full px-3.5 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
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
                  className="w-full px-3.5 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="availCheck"
                  checked={itemAvailable}
                  onChange={(e) => setItemAvailable(e.target.checked)}
                  className="w-4 h-4 rounded-sm text-amber-500"
                />
                <label htmlFor="availCheck" className="font-semibold text-gray-700 dark:text-zinc-300">
                  Item is available for ordering (In Stock)
                </label>
              </div>

              {/* Customization & Option Sets Editor */}
              <div className="pt-3 border-t border-gray-200 dark:border-zinc-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-gray-900 dark:text-white">
                      Customization & Option Sets ({itemSets.length})
                    </label>
                    <p className="text-[11px] text-gray-400">
                      Configure choices (e.g. Drink, Side, Flavor). Bulk price adjustments apply to base price only.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const newSet: MenuSet = {
                        id: `set_${Date.now().toString(36)}`,
                        name: '',
                        required: false,
                        maxSelect: 1,
                        sortOrder: itemSets.length,
                        choices: [
                          { id: `c_${Date.now().toString(36)}_1`, name: '', price: 0, available: true }
                        ]
                      };
                      setItemSets((prev) => [...prev, newSet]);
                    }}
                    className="px-2.5 py-1 rounded-xl text-xs font-bold bg-amber-400 hover:bg-amber-500 text-black flex items-center gap-1 shadow-2xs transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Set</span>
                  </button>
                </div>

                {itemSets.length === 0 ? (
                  <div className="p-3 text-center text-[11px] text-gray-400 bg-gray-50 dark:bg-zinc-800/40 rounded-xl border border-dashed border-gray-200 dark:border-zinc-700">
                    No sets added. This item has no selectable options (customer orders base item).
                  </div>
                ) : (
                  <div className="space-y-3">
                    {itemSets.map((s, sIdx) => (
                      <div
                        key={s.id || sIdx}
                        className="p-3.5 rounded-2xl border border-gray-200 dark:border-zinc-800 bg-gray-50/80 dark:bg-zinc-850/60 space-y-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 space-y-2">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-gray-200 dark:bg-zinc-700 text-gray-700 dark:text-zinc-300">
                                Set #{sIdx + 1}
                              </span>
                              <input
                                type="text"
                                value={s.name}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setItemSets((prev) =>
                                    prev.map((item, idx) =>
                                      idx === sIdx ? { ...item, name: val } : item
                                    )
                                  );
                                }}
                                placeholder="Set Name (e.g. Choose Size, Drink, Flavor)"
                                className="flex-1 px-2.5 py-1 rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold text-gray-900 dark:text-white"
                                required
                              />
                            </div>

                            <div className="flex flex-wrap items-center gap-4 text-[11px] text-gray-600 dark:text-zinc-400">
                              <label className="flex items-center gap-1.5 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={Boolean(s.required)}
                                  onChange={(e) => {
                                    const val = e.target.checked;
                                    setItemSets((prev) =>
                                      prev.map((item, idx) =>
                                        idx === sIdx ? { ...item, required: val } : item
                                      )
                                    );
                                  }}
                                  className="w-3.5 h-3.5 rounded text-amber-500"
                                />
                                <span>Required choice</span>
                              </label>

                              <div className="flex items-center gap-1.5">
                                <span>Max select:</span>
                                <input
                                  type="number"
                                  min="1"
                                  value={s.maxSelect || 1}
                                  onChange={(e) => {
                                    const val = Math.max(1, Number(e.target.value) || 1);
                                    setItemSets((prev) =>
                                      prev.map((item, idx) =>
                                        idx === sIdx ? { ...item, maxSelect: val } : item
                                      )
                                    );
                                  }}
                                  className="w-14 px-2 py-0.5 rounded border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold text-center"
                                />
                              </div>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              setItemSets((prev) => prev.filter((_, idx) => idx !== sIdx));
                            }}
                            className="p-1 text-gray-400 hover:text-red-500 rounded-md"
                            title="Delete Set"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>

                        {/* Choices list for this set */}
                        <div className="space-y-1.5 pt-2 border-t border-gray-200/60 dark:border-zinc-800">
                          <div className="text-[10px] font-bold uppercase text-gray-400">
                            Choices / Options ({s.choices.length})
                          </div>
                          {s.choices.map((c, cIdx) => (
                            <div
                              key={c.id || cIdx}
                              className="flex items-center gap-2 p-1.5 rounded-lg bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-750"
                            >
                              <input
                                type="text"
                                value={c.name}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setItemSets((prev) =>
                                    prev.map((item, idx) => {
                                      if (idx !== sIdx) return item;
                                      const newChoices = [...item.choices];
                                      newChoices[cIdx] = { ...newChoices[cIdx], name: val };
                                      return { ...item, choices: newChoices };
                                    })
                                  );
                                }}
                                placeholder="Choice name (e.g. Regular, Spicy)"
                                className="flex-1 px-2 py-1 rounded border border-gray-200 dark:border-zinc-700 bg-transparent text-xs text-gray-900 dark:text-white"
                                required
                              />

                              <div className="flex items-center gap-1">
                                <span className="text-[11px] text-gray-400">₱</span>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.5"
                                  value={c.price}
                                  onChange={(e) => {
                                    const val = Math.max(0, Number(e.target.value) || 0);
                                    setItemSets((prev) =>
                                      prev.map((item, idx) => {
                                        if (idx !== sIdx) return item;
                                        const newChoices = [...item.choices];
                                        newChoices[cIdx] = { ...newChoices[cIdx], price: val };
                                        return { ...item, choices: newChoices };
                                      })
                                    );
                                  }}
                                  placeholder="0"
                                  className="w-16 px-2 py-1 rounded border border-gray-200 dark:border-zinc-700 bg-transparent text-xs font-bold text-gray-900 dark:text-white"
                                />
                                {Number(c.price) === 0 ? (
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                                    Free
                                  </span>
                                ) : null}
                              </div>

                              <label
                                className="flex items-center gap-1 text-[11px] text-gray-500 cursor-pointer ml-1"
                                title="Available in stock"
                              >
                                <input
                                  type="checkbox"
                                  checked={c.available !== false}
                                  onChange={(e) => {
                                    const val = e.target.checked;
                                    setItemSets((prev) =>
                                      prev.map((item, idx) => {
                                        if (idx !== sIdx) return item;
                                        const newChoices = [...item.choices];
                                        newChoices[cIdx] = { ...newChoices[cIdx], available: val };
                                        return { ...item, choices: newChoices };
                                      })
                                    );
                                  }}
                                  className="w-3.5 h-3.5 rounded text-amber-500"
                                />
                                <span className="hidden sm:inline">In stock</span>
                              </label>

                              <button
                                type="button"
                                disabled={s.choices.length <= 1}
                                onClick={() => {
                                  setItemSets((prev) =>
                                    prev.map((item, idx) => {
                                      if (idx !== sIdx) return item;
                                      return {
                                        ...item,
                                        choices: item.choices.filter((_, ci) => ci !== cIdx)
                                      };
                                    })
                                  );
                                }}
                                className="p-1 text-gray-400 hover:text-red-500 disabled:opacity-30"
                                title="Remove Choice"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}

                          <button
                            type="button"
                            onClick={() => {
                              setItemSets((prev) =>
                                prev.map((item, idx) => {
                                  if (idx !== sIdx) return item;
                                  return {
                                    ...item,
                                    choices: [
                                      ...item.choices,
                                      {
                                        id: `c_${idx}_${item.choices.length + 1}_${Date.now().toString(36)}`,
                                        name: '',
                                        price: 0,
                                        available: true
                                      }
                                    ]
                                  };
                                })
                              );
                            }}
                            className="text-[11px] font-bold text-amber-600 hover:text-amber-700 dark:text-amber-400 flex items-center gap-1 pt-1"
                          >
                            <Plus className="w-3 h-3" />
                            <span>Add Choice to Set</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => setItemModalOpen(false)}
                  className="px-4 py-2 text-xs font-bold text-gray-600 hover:bg-gray-100 dark:text-zinc-400 dark:hover:bg-zinc-800 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingItem}
                  className="delivio-btn-yellow px-5 py-2 text-xs font-bold rounded-xl flex items-center gap-1.5"
                >
                  {savingItem && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Save Menu Item
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

      {/* Add Cash to Wallet Modal */}
      {cashInModalOpen && selectedMerchant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100 dark:border-zinc-800">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-amber-400 text-black">
                  <Plus className="w-4 h-4" />
                </div>
                <h3 className="font-extrabold text-base text-gray-900 dark:text-white">
                  Add Cash to Wallet
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setCashInModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-zinc-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddCash} className="space-y-4 pt-4">
              <p className="text-xs text-gray-500">
                Top-up merchant wallet for <strong>{selectedMerchant.name}</strong>
                {selectedMerchant.linkedCustomerUid && (
                  <span className="text-emerald-600 font-semibold block mt-0.5">
                    (Crediting shared customer account: {selectedMerchant.linkedCustomerEmail})
                  </span>
                )}.
              </p>

              <div>
                <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Cash Amount (₱)
                </label>
                <input
                  type="number"
                  min="1"
                  step="0.5"
                  required
                  value={cashInAmount || ''}
                  onChange={(e) => setCashInAmount(Number(e.target.value))}
                  placeholder="e.g. 500"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm font-bold text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Internal Note / Reference
                </label>
                <input
                  type="text"
                  value={cashInNote}
                  onChange={(e) => setCashInNote(e.target.value)}
                  placeholder="e.g. Over-the-counter deposit / promo credit"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-gray-900 dark:text-white"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCashInModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-gray-600 hover:bg-gray-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addingCash || cashInAmount <= 0}
                  className="delivio-btn-yellow px-5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs"
                >
                  {addingCash && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>Confirm Add Cash</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Adjust / Deduct Wallet Modal */}
      {adjustModalOpen && selectedMerchant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100 dark:border-zinc-800">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-amber-400 text-black">
                  <Edit className="w-4 h-4" />
                </div>
                <h3 className="font-extrabold text-base text-gray-900 dark:text-white">
                  Adjust Wallet Balance
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setAdjustModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-zinc-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAdjustBalance} className="space-y-4 pt-4">
              <div className="flex rounded-xl border border-gray-200 dark:border-zinc-700 p-1 bg-gray-50 dark:bg-zinc-800">
                <button
                  type="button"
                  onClick={() => setAdjustType('deduct')}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    adjustType === 'deduct'
                      ? 'bg-red-600 text-white shadow-xs'
                      : 'text-gray-600 dark:text-zinc-400'
                  }`}
                >
                  Deduct / Debit (-)
                </button>
                <button
                  type="button"
                  onClick={() => setAdjustType('add')}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    adjustType === 'add'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'text-gray-600 dark:text-zinc-400'
                  }`}
                >
                  Add / Credit (+)
                </button>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Adjustment Amount (₱)
                </label>
                <input
                  type="number"
                  min="1"
                  step="0.5"
                  required
                  value={adjustAmount || ''}
                  onChange={(e) => setAdjustAmount(Number(e.target.value))}
                  placeholder="e.g. 100"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm font-bold text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Adjustment Reason <span className="text-red-500">*</span>
                </label>
                <textarea
                  rows={2}
                  required
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  placeholder="Reason for manual balance adjustment..."
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAdjustModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-gray-600 hover:bg-gray-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingAdjust || adjustAmount <= 0 || !adjustReason.trim()}
                  className="delivio-btn-yellow px-5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs"
                >
                  {submittingAdjust && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>Execute Adjustment</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Link to Registered Customer Modal */}
      {linkModalOpen && selectedMerchant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-lg bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100 dark:border-zinc-800">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-amber-400 text-black">
                  <LinkIcon className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-extrabold text-base text-gray-900 dark:text-white">
                    Link Merchant to Customer Account
                  </h3>
                  <p className="text-xs text-gray-500">
                    Search registered customer by email or name to unify wallet balances.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setLinkModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-zinc-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Type-ahead search input */}
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-3 text-gray-400" />
              <input
                type="text"
                value={customerSearchQuery}
                onChange={(e) => setCustomerSearchQuery(e.target.value)}
                placeholder="Type customer registered email or name..."
                className="w-full pl-9 pr-4 py-2.5 text-xs rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white"
              />
            </div>

            {/* Candidates List */}
            <div className="border border-gray-200 dark:border-zinc-800 rounded-2xl max-h-60 overflow-y-auto divide-y divide-gray-100 dark:divide-zinc-800 text-xs">
              {loadingCustomers ? (
                <div className="p-8 text-center text-gray-400">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-amber-500" />
                  Loading customers...
                </div>
              ) : (() => {
                const q = customerSearchQuery.trim().toLowerCase();
                const filtered = allCustomers.filter(
                  (c) =>
                    !q ||
                    (c.email || '').toLowerCase().includes(q) ||
                    (c.name || '').toLowerCase().includes(q)
                );

                if (filtered.length === 0) {
                  return (
                    <div className="p-6 text-center text-gray-400">
                      No matching registered customer account found.
                    </div>
                  );
                }

                return filtered.slice(0, 10).map((cust) => (
                  <div
                    key={cust.uid}
                    onClick={() => {
                      setSelectedCandidateCustomer(cust);
                      setConfirmLinkModalOpen(true);
                    }}
                    className="p-3 hover:bg-amber-50/70 dark:hover:bg-zinc-800/60 cursor-pointer flex items-center justify-between transition-colors"
                  >
                    <div>
                      <div className="font-bold text-gray-900 dark:text-white flex items-center gap-1.5">
                        <span>{cust.name}</span>
                        <span className="text-[10px] text-gray-400">({cust.email})</span>
                      </div>
                      <div className="text-[11px] text-gray-500">
                        UID: <span className="font-mono">{cust.uid.substring(0, 10)}...</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="font-bold text-emerald-600 block">
                        ₱{(cust.walletBalance || 0).toFixed(2)}
                      </span>
                      <span className="text-[10px] text-gray-400">Wallet balance</span>
                    </div>
                  </div>
                ));
              })()}
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setLinkModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-gray-600 hover:bg-gray-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal to Execute Link & Merge */}
      {confirmLinkModalOpen && selectedCandidateCustomer && selectedMerchant && (
        <ConfirmationModal
          isOpen={confirmLinkModalOpen}
          onClose={() => setConfirmLinkModalOpen(false)}
          onConfirm={handleConfirmLink}
          title="Confirm Linking & Wallet Balance Merge"
          message={`Link merchant "${selectedMerchant.name}" to customer account "${selectedCandidateCustomer.email}"? In one atomic transaction, the merchant wallet balance (₱${(selectedMerchant.walletBalance || 0).toFixed(2)}) will be merged into the customer wallet (current balance: ₱${(selectedCandidateCustomer.walletBalance || 0).toFixed(2)}), resetting merchant wallet to ₱0.00. Both will share this wallet.`}
          confirmLabel={linking ? 'Linking...' : 'Confirm & Merge Wallet'}
          reasonRequired={false}
          isDestructive={false}
        />
      )}

      {/* Confirmation Modal to Unlink Customer (Requires Reason) */}
      {unlinkModalOpen && selectedMerchant && (
        <ConfirmationModal
          isOpen={unlinkModalOpen}
          onClose={() => setUnlinkModalOpen(false)}
          onConfirm={(reason) => {
            setUnlinkReason(reason || '');
            handleUnlinkCustomer();
          }}
          title="Unlink Customer Shared Wallet?"
          message={`Are you sure you want to unlink customer account "${selectedMerchant.linkedCustomerEmail}" from this merchant? Future wallet top-ups will no longer be shared with this customer. The customer will keep their existing wallet balance.`}
          confirmLabel={unlinking ? 'Unlinking...' : 'Unlink Shared Wallet'}
          reasonRequired={true}
          reasonPlaceholder="Provide the administrative reason for unlinking..."
          isDestructive={true}
        />
      )}
    </div>
  );
};
