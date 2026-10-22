import React, { useState, useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import {
  db,
  collection,
  query,
  limit,
  getDocs,
  doc,
  writeBatch,
  updateDoc,
  Timestamp
} from '../firebase';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { logAuditEvent } from '../utils/audit';
import { formatTimestamp, formatRelativeTime } from '../utils/date';
import type { MerchantApplication, RiderApplication } from '../types';
import {
  FileCheck,
  Store,
  Bike,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Clock,
  Eye,
  MapPin,
  ExternalLink,
  Loader2,
  Filter,
  X,
  Phone,
  Mail,
  FileText
} from 'lucide-react';
import { ConfirmationModal } from '../components/common/ConfirmationModal';
import { TableSkeleton } from '../components/common/SkeletonLoader';

const APP_STATUSES = ['Pending', 'Under Review', 'Needs Info', 'Approved', 'Rejected'];

export const Applications: React.FC = () => {
  const { adminProfile } = useAuth();
  const { showSuccess, showError } = useToast();

  const [activeTab, setActiveTab] = useState<'merchants' | 'riders'>('merchants');
  const [statusFilter, setStatusFilter] = useState<string>('Pending');
  const [loading, setLoading] = useState(true);

  const [merchantApps, setMerchantApps] = useState<MerchantApplication[]>([]);
  const [riderApps, setRiderApps] = useState<RiderApplication[]>([]);

  // Selected for review detail modal
  const [selectedMerchantApp, setSelectedMerchantApp] = useState<MerchantApplication | null>(null);
  const [selectedRiderApp, setSelectedRiderApp] = useState<RiderApplication | null>(null);

  // Document preview lightbox
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  // Action modals
  const [actionType, setActionType] = useState<'reject' | 'needs_info' | null>(null);
  const [actionReason, setActionReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  // Mini map ref for merchant location preview
  const merchantMapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);

  // Fetch applications
  const fetchApplications = async () => {
    try {
      setLoading(true);

      // Merchant Applications
      const mSnap = await getDocs(query(collection(db, 'merchantApplications'), limit(150)));
      const mList: MerchantApplication[] = [];
      mSnap.forEach((d) => {
        const dt = d.data();
        mList.push({
          id: d.id,
          uid: dt.uid || d.id,
          businessName: dt.businessName || dt.name || 'Store',
          ownerName: dt.ownerName || '',
          email: dt.email || '',
          phone: dt.phone || '',
          businessType: dt.businessType || 'food',
          cityId: dt.cityId || '',
          address: dt.address || '',
          lat: Number(dt.lat) || 0,
          lng: Number(dt.lng) || 0,
          logoUrl: dt.logoUrl,
          storePhotoUrl: dt.storePhotoUrl,
          documents: dt.documents || [],
          status: dt.status || 'Pending',
          reviewNote: dt.reviewNote,
          reviewedBy: dt.reviewedBy,
          reviewedAt: dt.reviewedAt,
          createdAt: dt.createdAt
        });
      });
      mList.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setMerchantApps(mList);

      // Rider Applications
      const rSnap = await getDocs(query(collection(db, 'riderApplications'), limit(150)));
      const rList: RiderApplication[] = [];
      rSnap.forEach((d) => {
        const dt = d.data();
        rList.push({
          id: d.id,
          uid: dt.uid || d.id,
          name: dt.name || 'Rider',
          email: dt.email || '',
          phone: dt.phone || '',
          cityId: dt.cityId || '',
          vehicleType: dt.vehicleType || 'Motorcycle',
          vehicleModel: dt.vehicleModel,
          plate: dt.plate || '',
          selfieUrl: dt.selfieUrl,
          documents: dt.documents || [],
          status: dt.status || 'Pending',
          reviewNote: dt.reviewNote,
          reviewedBy: dt.reviewedBy,
          reviewedAt: dt.reviewedAt,
          createdAt: dt.createdAt
        });
      });
      rList.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setRiderApps(rList);
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchApplications();
  }, []);

  // Map preview for merchant location
  useEffect(() => {
    if (!selectedMerchantApp || !merchantMapRef.current) return;

    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    const lat = selectedMerchantApp.lat || 9.7392;
    const lng = selectedMerchantApp.lng || 118.7353;

    const map = L.map(merchantMapRef.current, {
      center: [lat, lng],
      zoom: 15,
      zoomControl: false
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap'
    }).addTo(map);

    if (selectedMerchantApp.lat && selectedMerchantApp.lng) {
      L.marker([lat, lng])
        .bindTooltip(selectedMerchantApp.businessName, { permanent: true })
        .addTo(map);
    }

    mapInstanceRef.current = map;

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [selectedMerchantApp]);

  // Merchant Approve (One Batch)
  const handleApproveMerchant = async (app: MerchantApplication) => {
    try {
      const batch = writeBatch(db);
      const uid = app.uid || app.id;
      const now = Timestamp.now();

      // 1. set users/{uid}
      const userRef = doc(db, 'users', uid);
      batch.set(
        userRef,
        {
          role: 'merchant',
          email: app.email,
          name: app.ownerName || app.businessName,
          phone: app.phone,
          status: 'active',
          walletBalance: 0,
          createdAt: now
        },
        { merge: true }
      );

      // 2. set merchants/{uid}
      const merchRef = doc(db, 'merchants', uid);
      batch.set(merchRef, {
        name: app.businessName,
        ownerName: app.ownerName,
        email: app.email,
        phone: app.phone,
        type: app.businessType || 'food',
        typeLocked: true,
        cityId: app.cityId,
        status: 'active',
        isOpen: false,
        ownerUid: uid,
        cuisineTags: [],
        address: app.address,
        lat: app.lat,
        lng: app.lng,
        logoUrl: app.logoUrl || '',
        bannerUrl: app.storePhotoUrl || '',
        commissionRate: 15,
        createdAt: now
      });

      // 3. update application status "Approved"
      const appRef = doc(db, 'merchantApplications', app.id);
      batch.update(appRef, {
        status: 'Approved',
        reviewedBy: adminProfile?.name || 'Administrator',
        reviewedAt: now
      });

      await batch.commit();

      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        action: 'APPROVE_MERCHANT_APPLICATION',
        entityType: 'merchantApplication',
        entityId: app.id,
        details: `Approved merchant application for ${app.businessName} (UID: ${uid})`
      });

      showSuccess(`Merchant ${app.businessName} approved! Account and store created.`);
      setSelectedMerchantApp(null);
      fetchApplications();
    } catch (err: any) {
      showError(err);
    }
  };

  // Rider Approve (One Batch)
  const handleApproveRider = async (app: RiderApplication) => {
    try {
      const batch = writeBatch(db);
      const uid = app.uid || app.id;
      const now = Timestamp.now();
      const riderCode = `DLV-R-${Math.floor(100000 + Math.random() * 900000)}`;

      // 1. set users/{uid}
      const userRef = doc(db, 'users', uid);
      batch.set(
        userRef,
        {
          role: 'rider',
          email: app.email,
          name: app.name,
          phone: app.phone,
          status: 'active',
          walletBalance: 0,
          createdAt: now
        },
        { merge: true }
      );

      // 2. set riders/{uid}
      const riderRef = doc(db, 'riders', uid);
      batch.set(riderRef, {
        name: app.name,
        email: app.email,
        phone: app.phone,
        photoUrl: app.selfieUrl || '',
        riderCode,
        status: 'active',
        cityId: app.cityId,
        vehicleType: app.vehicleType || 'Motorcycle',
        plate: app.plate || '',
        vehicleModel: app.vehicleModel || '',
        allowedServices: ['food', 'convenience', 'parcel', 'pabili', 'request_rider'],
        activeServices: ['food', 'convenience', 'parcel', 'pabili', 'request_rider'],
        isOnline: false,
        coins: 0,
        walletBalance: 0,
        cashRemitted: 0,
        rating: 5,
        createdAt: now
      });

      // 3. set application "Approved"
      const appRef = doc(db, 'riderApplications', app.id);
      batch.update(appRef, {
        status: 'Approved',
        reviewedBy: adminProfile?.name || 'Administrator',
        reviewedAt: now
      });

      await batch.commit();

      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        action: 'APPROVE_RIDER_APPLICATION',
        entityType: 'riderApplication',
        entityId: app.id,
        details: `Approved rider application for ${app.name} (Code: ${riderCode})`
      });

      showSuccess(`Rider ${app.name} approved with ID ${riderCode}!`);
      setSelectedRiderApp(null);
      fetchApplications();
    } catch (err: any) {
      showError(err);
    }
  };

  // Reject / Needs Info action handler
  const handleRejectOrNeedsInfo = async (reason: string) => {
    const isMerchant = activeTab === 'merchants';
    const currentApp = isMerchant ? selectedMerchantApp : selectedRiderApp;
    if (!currentApp || !actionType) return;

    try {
      setActionLoading(true);
      const colName = isMerchant ? 'merchantApplications' : 'riderApplications';
      const appRef = doc(db, colName, currentApp.id);
      const newStatus = actionType === 'reject' ? 'Rejected' : 'Needs Info';

      await updateDoc(appRef, {
        status: newStatus,
        reviewNote: reason,
        reviewedBy: adminProfile?.name || 'Administrator',
        reviewedAt: Timestamp.now()
      });

      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        action: `${newStatus.toUpperCase()}_APPLICATION`,
        entityType: colName,
        entityId: currentApp.id,
        details: `Application set to ${newStatus}. Note: ${reason}`
      });

      showSuccess(`Application marked as ${newStatus}.`);
      setActionType(null);
      setSelectedMerchantApp(null);
      setSelectedRiderApp(null);
      fetchApplications();
    } catch (err: any) {
      showError(err);
    } finally {
      setActionLoading(false);
    }
  };

  // Status counters
  const counts = useMemo(() => {
    const list = activeTab === 'merchants' ? merchantApps : riderApps;
    const c: Record<string, number> = {
      all: list.length,
      Pending: 0,
      'Under Review': 0,
      'Needs Info': 0,
      Approved: 0,
      Rejected: 0
    };
    list.forEach((a) => {
      if (c[a.status] !== undefined) c[a.status]++;
    });
    return c;
  }, [activeTab, merchantApps, riderApps]);

  const filteredList = useMemo(() => {
    const list = activeTab === 'merchants' ? merchantApps : riderApps;
    if (statusFilter === 'all') return list;
    return list.filter((a) => a.status === statusFilter);
  }, [activeTab, merchantApps, riderApps, statusFilter]);

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">
            Partner Applications
          </h1>
          <p className="text-sm text-gray-500 dark:text-zinc-400 mt-0.5">
            Review applicant identities, business permits, government IDs, and approve into real
            accounts.
          </p>
        </div>

        {/* Tab switch */}
        <div className="flex items-center p-1 rounded-xl bg-gray-200 dark:bg-zinc-800">
          <button
            onClick={() => {
              setActiveTab('merchants');
              setStatusFilter('Pending');
            }}
            className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 transition-all ${
              activeTab === 'merchants'
                ? 'bg-white dark:bg-zinc-900 text-gray-900 dark:text-white shadow-xs'
                : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            <Store className="w-4 h-4 text-amber-500" />
            <span>Merchants</span>
          </button>
          <button
            onClick={() => {
              setActiveTab('riders');
              setStatusFilter('Pending');
            }}
            className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 transition-all ${
              activeTab === 'riders'
                ? 'bg-white dark:bg-zinc-900 text-gray-900 dark:text-white shadow-xs'
                : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            <Bike className="w-4 h-4 text-blue-500" />
            <span>Riders</span>
          </button>
        </div>
      </div>

      {/* Status Filter Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {['Pending', 'Under Review', 'Needs Info', 'Approved', 'Rejected', 'all'].map((st) => (
          <button
            key={st}
            onClick={() => setStatusFilter(st)}
            className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all flex items-center gap-2 ${
              statusFilter === st
                ? 'bg-amber-400 text-black shadow-xs font-black'
                : 'bg-white dark:bg-zinc-900 text-gray-600 dark:text-zinc-400 border border-gray-200 dark:border-zinc-800 hover:bg-gray-50'
            }`}
          >
            <span className="capitalize">{st === 'all' ? 'All Applications' : st}</span>
            <span
              className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                statusFilter === st
                  ? 'bg-black/15 text-black'
                  : 'bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-400'
              }`}
            >
              {counts[st] || 0}
            </span>
          </button>
        ))}
      </div>

      {/* Applications List */}
      {loading ? (
        <TableSkeleton rows={6} cols={5} />
      ) : filteredList.length === 0 ? (
        <div className="p-12 text-center bg-white dark:bg-zinc-900 border border-dashed border-gray-200 dark:border-zinc-800 rounded-2xl">
          <FileCheck className="w-10 h-10 text-gray-300 mx-auto mb-2" />
          <h4 className="font-bold text-gray-900 dark:text-white text-sm">
            No {statusFilter === 'all' ? '' : statusFilter} Applications
          </h4>
          <p className="text-xs text-gray-400 mt-1">
            New submissions from the customer or partner onboarding apps will appear here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {activeTab === 'merchants'
            ? (filteredList as MerchantApplication[]).map((app) => (
                <div
                  key={app.id}
                  onClick={() => setSelectedMerchantApp(app)}
                  className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-5 shadow-xs hover:border-amber-400 dark:hover:border-amber-500 cursor-pointer transition-all flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <span className="capitalize px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300">
                        {app.businessType}
                      </span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          app.status === 'Approved'
                            ? 'bg-emerald-100 text-emerald-800'
                            : app.status === 'Rejected'
                            ? 'bg-red-100 text-red-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {app.status}
                      </span>
                    </div>

                    <h4 className="font-bold text-base text-gray-900 dark:text-white mb-1">
                      {app.businessName}
                    </h4>
                    <p className="text-xs text-gray-500 mb-2">Owner: {app.ownerName}</p>

                    <div className="text-xs text-gray-400 space-y-1 mb-4">
                      <div className="flex items-center gap-1.5">
                        <Phone className="w-3.5 h-3.5" />
                        <span>{app.phone}</span>
                      </div>
                      <div className="flex items-center gap-1.5 truncate">
                        <MapPin className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{app.address || 'Location on map'}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t border-gray-100 dark:border-zinc-800 text-xs">
                    <span className="text-gray-400">{formatRelativeTime(app.createdAt)}</span>
                    <span className="font-bold text-amber-600 flex items-center gap-1">
                      Review Docs &rarr;
                    </span>
                  </div>
                </div>
              ))
            : (filteredList as RiderApplication[]).map((app) => (
                <div
                  key={app.id}
                  onClick={() => setSelectedRiderApp(app)}
                  className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-5 shadow-xs hover:border-amber-400 dark:hover:border-amber-500 cursor-pointer transition-all flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300">
                        {app.vehicleType}
                      </span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          app.status === 'Approved'
                            ? 'bg-emerald-100 text-emerald-800'
                            : app.status === 'Rejected'
                            ? 'bg-red-100 text-red-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {app.status}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-12 h-12 rounded-xl bg-amber-400 text-black font-extrabold flex items-center justify-center shrink-0 overflow-hidden">
                        {app.selfieUrl ? (
                          <img
                            src={app.selfieUrl}
                            alt={app.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span>{app.name.charAt(0)}</span>
                        )}
                      </div>
                      <div>
                        <h4 className="font-bold text-base text-gray-900 dark:text-white">
                          {app.name}
                        </h4>
                        <p className="text-xs text-gray-500 font-mono">
                          Plate: {app.plate || 'Pending Plate'}
                        </p>
                      </div>
                    </div>

                    <div className="text-xs text-gray-400 space-y-1 mb-4">
                      <div className="flex items-center gap-1.5">
                        <Phone className="w-3.5 h-3.5" />
                        <span>{app.phone}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Mail className="w-3.5 h-3.5" />
                        <span>{app.email}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t border-gray-100 dark:border-zinc-800 text-xs">
                    <span className="text-gray-400">{formatRelativeTime(app.createdAt)}</span>
                    <span className="font-bold text-amber-600 flex items-center gap-1">
                      Review Docs &rarr;
                    </span>
                  </div>
                </div>
              ))}
        </div>
      )}

      {/* Review Modal: Merchant Application */}
      {selectedMerchantApp && (
        <div className="fixed inset-0 z-50 overflow-hidden flex justify-end bg-black/60 backdrop-blur-xs">
          <div
            className="w-full max-w-2xl bg-white dark:bg-zinc-950 border-l border-gray-200 dark:border-zinc-800 shadow-2xl flex flex-col h-full animate-in slide-in-from-right duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-5 border-b border-gray-200 dark:border-zinc-800 flex items-center justify-between">
              <div>
                <h3 className="font-extrabold text-xl text-gray-900 dark:text-white">
                  {selectedMerchantApp.businessName}
                </h3>
                <p className="text-xs text-gray-400">
                  Applied on {formatTimestamp(selectedMerchantApp.createdAt)}
                </p>
              </div>
              <button
                onClick={() => setSelectedMerchantApp(null)}
                className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              {/* Status Header */}
              <div className="flex items-center justify-between p-3.5 rounded-xl bg-gray-50 dark:bg-zinc-900 text-xs">
                <div>
                  <span className="text-gray-400 uppercase font-bold text-[10px]">
                    Application State
                  </span>
                  <div className="font-black text-sm text-gray-900 dark:text-white">
                    {selectedMerchantApp.status}
                  </div>
                </div>
                {selectedMerchantApp.reviewNote && (
                  <div className="text-right max-w-xs text-red-600 font-semibold">
                    Note: {selectedMerchantApp.reviewNote}
                  </div>
                )}
              </div>

              {/* Applicant Info */}
              <div className="p-4 rounded-xl border border-gray-200 dark:border-zinc-800 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-gray-500">Business Owner:</span>
                  <span className="font-bold text-gray-900 dark:text-white">
                    {selectedMerchantApp.ownerName}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Business Type:</span>
                  <span className="font-bold capitalize text-amber-600">
                    {selectedMerchantApp.businessType}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Phone:</span>
                  <a
                    href={`tel:${selectedMerchantApp.phone}`}
                    className="font-bold text-amber-600 hover:underline"
                  >
                    {selectedMerchantApp.phone}
                  </a>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Email:</span>
                  <span className="font-semibold text-gray-900 dark:text-white">
                    {selectedMerchantApp.email}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Address:</span>
                  <span className="font-medium text-gray-700 dark:text-zinc-300 max-w-xs text-right">
                    {selectedMerchantApp.address || '—'}
                  </span>
                </div>
              </div>

              {/* Map Coordinates Preview */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">
                  Store Pin Coordinates
                </label>
                <div
                  ref={merchantMapRef}
                  className="h-48 w-full rounded-2xl border border-gray-200 dark:border-zinc-800 overflow-hidden shadow-xs"
                />
              </div>

              {/* Document Previews */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">
                  Uploaded Permits & Photos (Click to inspect)
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {selectedMerchantApp.logoUrl && (
                    <div
                      onClick={() => setPreviewImageUrl(selectedMerchantApp.logoUrl || '')}
                      className="p-3 rounded-xl border border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-900 cursor-pointer hover:border-amber-400 transition-all text-xs text-center"
                    >
                      <div className="h-28 rounded-lg overflow-hidden mb-2 bg-gray-200">
                        <img
                          src={selectedMerchantApp.logoUrl}
                          alt="Logo"
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <span className="font-bold text-gray-800 dark:text-zinc-200">Store Logo</span>
                    </div>
                  )}

                  {selectedMerchantApp.storePhotoUrl && (
                    <div
                      onClick={() => setPreviewImageUrl(selectedMerchantApp.storePhotoUrl || '')}
                      className="p-3 rounded-xl border border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-900 cursor-pointer hover:border-amber-400 transition-all text-xs text-center"
                    >
                      <div className="h-28 rounded-lg overflow-hidden mb-2 bg-gray-200">
                        <img
                          src={selectedMerchantApp.storePhotoUrl}
                          alt="Store Photo"
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <span className="font-bold text-gray-800 dark:text-zinc-200">Storefront</span>
                    </div>
                  )}

                  {(selectedMerchantApp.documents || []).map((docItem, idx) => (
                    <div
                      key={idx}
                      onClick={() => setPreviewImageUrl(docItem.url)}
                      className="p-3 rounded-xl border border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-900 cursor-pointer hover:border-amber-400 transition-all text-xs text-center"
                    >
                      <div className="h-28 rounded-lg overflow-hidden mb-2 bg-gray-200">
                        <img
                          src={docItem.url}
                          alt={docItem.title}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <span className="font-bold text-gray-800 dark:text-zinc-200 truncate block">
                        {docItem.title || `Document #${idx + 1}`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Footer Action Bar */}
            {selectedMerchantApp.status !== 'Approved' && (
              <div className="p-5 border-t border-gray-200 dark:border-zinc-800 flex items-center justify-between gap-3 bg-gray-50 dark:bg-zinc-900">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setActionType('reject')}
                    className="px-4 py-2 rounded-xl border border-red-300 text-red-600 text-xs font-bold hover:bg-red-50"
                  >
                    Reject
                  </button>
                  <button
                    onClick={() => setActionType('needs_info')}
                    className="px-4 py-2 rounded-xl border border-amber-300 text-amber-700 text-xs font-bold hover:bg-amber-50"
                  >
                    Needs Info
                  </button>
                </div>

                <button
                  onClick={() => handleApproveMerchant(selectedMerchantApp)}
                  className="delivio-btn-yellow px-6 py-2.5 rounded-xl text-xs font-black shadow-md shadow-amber-400/20"
                >
                  Approve Application
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Review Modal: Rider Application */}
      {selectedRiderApp && (
        <div className="fixed inset-0 z-50 overflow-hidden flex justify-end bg-black/60 backdrop-blur-xs">
          <div
            className="w-full max-w-2xl bg-white dark:bg-zinc-950 border-l border-gray-200 dark:border-zinc-800 shadow-2xl flex flex-col h-full animate-in slide-in-from-right duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-5 border-b border-gray-200 dark:border-zinc-800 flex items-center justify-between">
              <div>
                <h3 className="font-extrabold text-xl text-gray-900 dark:text-white">
                  {selectedRiderApp.name}
                </h3>
                <p className="text-xs text-gray-400">
                  Applied on {formatTimestamp(selectedRiderApp.createdAt)}
                </p>
              </div>
              <button
                onClick={() => setSelectedRiderApp(null)}
                className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              <div className="flex items-center justify-between p-3.5 rounded-xl bg-gray-50 dark:bg-zinc-900 text-xs">
                <div>
                  <span className="text-gray-400 uppercase font-bold text-[10px]">
                    Application State
                  </span>
                  <div className="font-black text-sm text-gray-900 dark:text-white">
                    {selectedRiderApp.status}
                  </div>
                </div>
                {selectedRiderApp.reviewNote && (
                  <div className="text-right max-w-xs text-red-600 font-semibold">
                    Note: {selectedRiderApp.reviewNote}
                  </div>
                )}
              </div>

              {/* Applicant Info */}
              <div className="p-4 rounded-xl border border-gray-200 dark:border-zinc-800 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-gray-500">Applicant:</span>
                  <span className="font-bold text-gray-900 dark:text-white">
                    {selectedRiderApp.name}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Vehicle Type:</span>
                  <span className="font-bold text-gray-900 dark:text-white">
                    {selectedRiderApp.vehicleType}{' '}
                    {selectedRiderApp.vehicleModel ? `(${selectedRiderApp.vehicleModel})` : ''}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Plate Number:</span>
                  <span className="font-mono font-bold text-gray-900 dark:text-white">
                    {selectedRiderApp.plate || 'N/A'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Phone:</span>
                  <a
                    href={`tel:${selectedRiderApp.phone}`}
                    className="font-bold text-amber-600 hover:underline"
                  >
                    {selectedRiderApp.phone}
                  </a>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Email:</span>
                  <span className="font-semibold text-gray-900 dark:text-white">
                    {selectedRiderApp.email}
                  </span>
                </div>
              </div>

              {/* Document Previews */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">
                  Selfie & Driver Documents (Click to inspect)
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {selectedRiderApp.selfieUrl && (
                    <div
                      onClick={() => setPreviewImageUrl(selectedRiderApp.selfieUrl || '')}
                      className="p-3 rounded-xl border border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-900 cursor-pointer hover:border-amber-400 transition-all text-xs text-center"
                    >
                      <div className="h-32 rounded-lg overflow-hidden mb-2 bg-gray-200">
                        <img
                          src={selectedRiderApp.selfieUrl}
                          alt="Selfie"
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <span className="font-bold text-gray-800 dark:text-zinc-200">
                        Rider Photo / Selfie
                      </span>
                    </div>
                  )}

                  {(selectedRiderApp.documents || []).map((docItem, idx) => (
                    <div
                      key={idx}
                      onClick={() => setPreviewImageUrl(docItem.url)}
                      className="p-3 rounded-xl border border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-900 cursor-pointer hover:border-amber-400 transition-all text-xs text-center"
                    >
                      <div className="h-32 rounded-lg overflow-hidden mb-2 bg-gray-200">
                        <img
                          src={docItem.url}
                          alt={docItem.title}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <span className="font-bold text-gray-800 dark:text-zinc-200 truncate block">
                        {docItem.title || `Document #${idx + 1}`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Footer Action Bar */}
            {selectedRiderApp.status !== 'Approved' && (
              <div className="p-5 border-t border-gray-200 dark:border-zinc-800 flex items-center justify-between gap-3 bg-gray-50 dark:bg-zinc-900">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setActionType('reject')}
                    className="px-4 py-2 rounded-xl border border-red-300 text-red-600 text-xs font-bold hover:bg-red-50"
                  >
                    Reject
                  </button>
                  <button
                    onClick={() => setActionType('needs_info')}
                    className="px-4 py-2 rounded-xl border border-amber-300 text-amber-700 text-xs font-bold hover:bg-amber-50"
                  >
                    Needs Info
                  </button>
                </div>

                <button
                  onClick={() => handleApproveRider(selectedRiderApp)}
                  className="delivio-btn-yellow px-6 py-2.5 rounded-xl text-xs font-black shadow-md shadow-amber-400/20"
                >
                  Approve Application
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Document Lightbox */}
      {previewImageUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
          onClick={() => setPreviewImageUrl(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh]">
            <img
              src={previewImageUrl}
              alt="Document preview"
              className="max-h-[85vh] max-w-full rounded-2xl object-contain shadow-2xl"
            />
            <button
              onClick={() => setPreviewImageUrl(null)}
              className="absolute -top-10 right-0 text-white font-bold text-sm bg-black/50 px-3 py-1 rounded-full"
            >
              Close Preview [ESC]
            </button>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Reject / Needs Info */}
      {actionType && (
        <ConfirmationModal
          isOpen={Boolean(actionType)}
          onClose={() => setActionType(null)}
          onConfirm={handleRejectOrNeedsInfo}
          title={
            actionType === 'reject'
              ? 'Reject Partner Application'
              : 'Request Additional Information'
          }
          message={
            actionType === 'reject'
              ? 'Please specify a clear reason for rejecting this application (e.g., fraudulent documents, expired license, duplicate store).'
              : 'Please specify the exact missing or unclear information required from the applicant.'
          }
          confirmLabel={actionType === 'reject' ? 'Confirm Rejection' : 'Submit Note to Applicant'}
          reasonRequired={true}
          reasonPlaceholder="Enter comprehensive review note..."
          isDestructive={actionType === 'reject'}
        />
      )}
    </div>
  );
};
