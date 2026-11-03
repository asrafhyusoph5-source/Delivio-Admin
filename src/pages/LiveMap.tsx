import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import L from 'leaflet';
import {
  db,
  collection,
  query,
  where,
  onSnapshot,
  doc,
  updateDoc
} from '../firebase';
import { useCity } from '../context/CityContext';
import { useToast } from '../context/ToastContext';
import type { Rider, Merchant, UserProfile, Order } from '../types';
import {
  VEHICLE_TYPES,
  VEHICLE_LABELS,
  type VehicleType
} from '../constants';
import {
  Car,
  Store,
  User,
  Route,
  Phone,
  ExternalLink,
  Mail,
  X,
  Star,
  Clock,
  Layers,
  Info
} from 'lucide-react';
import { formatRelativeTime } from '../utils/date';

// Visual configuration for each vehicle type marker
const VEHICLE_MARKER_STYLES: Record<
  VehicleType,
  { bg: string; border: string; label: string; svgPath: string }
> = {
  motorcycle: {
    bg: '#10b981', // emerald-500
    border: '#059669',
    label: 'Motorcycle',
    // Bike / motorcycle icon SVG
    svgPath: 'M5.5 17.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm13 0a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-10-3.5h7l2-4.5H12L9.5 12'
  },
  tricycle: {
    bg: '#f59e0b', // amber-500
    border: '#d97706',
    label: 'Tricycle',
    // Rickshaw / tricycle 3-wheel style
    svgPath: 'M3 17a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm16.5 0a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM6 14h5l3-6H8L5 12'
  },
  car4: {
    bg: '#3b82f6', // blue-500
    border: '#2563eb',
    label: '4-Seater Car',
    // Compact car icon
    svgPath: 'M5 16h14a2 2 0 0 0 2-2v-3.5L18 6H6L3 10.5V14a2 2 0 0 0 2 2Zm2 2a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm10 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z'
  },
  car8: {
    bg: '#8b5cf6', // purple-500
    border: '#7c3aed',
    label: '8-Seater Car',
    // Larger van/bus icon
    svgPath: 'M4 17h16a1 1 0 0 0 1-1V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a1 1 0 0 0 1 1Zm3 2a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm10 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM4 8h16M4 12h16'
  }
};

export const LiveMap: React.FC = () => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const cityCircleRef = useRef<L.Circle | null>(null);
  const layerGroupsRef = useRef<{
    riders: L.LayerGroup;
    merchants: L.LayerGroup;
    customers: L.LayerGroup;
    routes: L.LayerGroup;
    batchGroup: L.LayerGroup;
  }>({
    riders: L.layerGroup(),
    merchants: L.layerGroup(),
    customers: L.layerGroup(),
    routes: L.layerGroup(),
    batchGroup: L.layerGroup()
  });

  const { selectedCity, selectedCityId } = useCity();
  const { showSuccess, showError } = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const batchIdParam = searchParams.get('batchId') || '';
  const [selectedBatchId, setSelectedBatchId] = useState<string>(batchIdParam);

  useEffect(() => {
    if (batchIdParam) {
      setSelectedBatchId(batchIdParam);
    }
  }, [batchIdParam]);

  // Layer Visibility Toggles
  const [showRiders, setShowRiders] = useState(true);
  const [showMerchants, setShowMerchants] = useState(true);
  const [showCustomers, setShowCustomers] = useState(true);
  const [showRoutes, setShowRoutes] = useState(true);

  // Vehicle Type Filter for Drivers on Map
  const [selectedVehicleType, setSelectedVehicleType] = useState<'all' | VehicleType>('all');

  // Live Data States
  const [riders, setRiders] = useState<Rider[]>([]);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [customers, setCustomers] = useState<UserProfile[]>([]);
  const [activeOrders, setActiveOrders] = useState<Order[]>([]);

  // Selected Marker for the slide-in drawer
  const [selectedEntity, setSelectedEntity] = useState<{
    type: 'rider' | 'merchant' | 'customer';
    data: any;
  } | null>(null);

  // 1. Initialize Leaflet Map once
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const defaultCenter: L.LatLngExpression = [9.7392, 118.7353];
    const map = L.map(mapContainerRef.current, {
      center: defaultCenter,
      zoom: 13,
      zoomControl: false
    });

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19
    }).addTo(map);

    // Add layer groups to map
    layerGroupsRef.current.riders.addTo(map);
    layerGroupsRef.current.merchants.addTo(map);
    layerGroupsRef.current.customers.addTo(map);
    layerGroupsRef.current.routes.addTo(map);
    layerGroupsRef.current.batchGroup.addTo(map);

    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // 2. Real-time Listeners with onSnapshot
  useEffect(() => {
    // A. Online drivers
    const qRiders = query(collection(db, 'riders'), where('isOnline', '==', true));
    const unsubRiders = onSnapshot(
      qRiders,
      (snap) => {
        const list: Rider[] = [];
        snap.forEach((d) => {
          const dt = d.data();
          list.push({
            id: d.id,
            name: dt.name || 'Driver',
            email: dt.email || '',
            phone: dt.phone || '',
            photoUrl: dt.photoUrl,
            riderCode: dt.riderCode || d.id.substring(0, 8),
            status: dt.status || 'active',
            cityId: dt.cityId,
            vehicleType: (dt.vehicleType as VehicleType) || 'motorcycle',
            vehicleModel: dt.vehicleModel || '',
            vehicleColor: dt.vehicleColor || '',
            seats: dt.seats || (dt.vehicleType === 'motorcycle' ? 1 : dt.vehicleType === 'tricycle' ? 3 : dt.vehicleType === 'car8' ? 8 : 4),
            plate: dt.plate || '',
            allowedServices: dt.allowedServices || [],
            activeServices: dt.activeServices || [],
            isOnline: Boolean(dt.isOnline),
            location: dt.location,
            currentOrderId: dt.currentOrderId,
            coins: dt.coins || 0,
            walletBalance: dt.walletBalance || 0,
            cashRemitted: dt.cashRemitted || 0,
            rating: dt.rating || 5,
            ridesThisMonth: dt.ridesThisMonth || 0
          });
        });
        setRiders(list);
      },
      (err) => console.error('Map drivers listener error:', err)
    );

    // B. Merchants
    const qMerchants = query(collection(db, 'merchants'));
    const unsubMerchants = onSnapshot(
      qMerchants,
      (snap) => {
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
            status: dt.status || 'active',
            isOpen: Boolean(dt.isOpen),
            cityId: dt.cityId,
            address: dt.address || '',
            lat: Number(dt.lat) || 0,
            lng: Number(dt.lng) || 0,
            logoUrl: dt.logoUrl,
            bannerUrl: dt.bannerUrl,
            commissionRate: dt.commissionRate ?? 15,
            rating: dt.rating || 5
          });
        });
        setMerchants(list);
      },
      (err) => console.error('Map merchants listener error:', err)
    );

    // C. Customers with location
    const qCustomers = query(collection(db, 'users'), where('role', '==', 'customer'));
    const unsubCustomers = onSnapshot(
      qCustomers,
      (snap) => {
        const list: UserProfile[] = [];
        snap.forEach((d) => {
          const dt = d.data();
          if (dt.location && dt.location.lat && dt.location.lng) {
            list.push({
              uid: d.id,
              role: 'customer',
              email: dt.email || '',
              name: dt.name || 'Customer',
              phone: dt.phone || '',
              photoUrl: dt.photoUrl,
              status: dt.status || 'active',
              location: dt.location,
              cityId: dt.cityId
            });
          }
        });
        setCustomers(list);
      },
      (err) => console.error('Map customers listener error:', err)
    );

    // D. Active orders for routes
    const qOrders = query(collection(db, 'orders'));
    const unsubOrders = onSnapshot(
      qOrders,
      (snap) => {
        const list: Order[] = [];
        snap.forEach((d) => {
          const dt = d.data();
          const st = dt.status;
          if (st !== 'Delivered' && st !== 'Completed' && st !== 'Rejected' && st !== 'Cancelled') {
            list.push({
              id: d.id,
              orderNumber: dt.orderNumber || d.id.substring(0, 8).toUpperCase(),
              serviceType: dt.serviceType || 'food',
              vehicleType: dt.vehicleType,
              customerId: dt.customerId,
              customerName: dt.customerName || 'Customer',
              customerPhone: dt.customerPhone,
              merchantId: dt.merchantId,
              merchantName: dt.merchantName,
              riderId: dt.riderId,
              riderName: dt.riderName,
              riderPhone: dt.riderPhone,
              riderLocation: dt.riderLocation,
              status: dt.status,
              statusHistory: dt.statusHistory || [],
              fees: dt.fees || { subtotal: 0, deliveryFee: 0, serviceFee: 0, discount: 0, total: 0 },
              paymentMethod: dt.paymentMethod || 'cod',
              pickup: dt.pickup,
              dropoff: dt.dropoff,
              stops: dt.stops,
              cityId: dt.cityId,
              batchId: dt.batchId,
              bookingRank: dt.bookingRank,
              batchTotalBookings: dt.batchTotalBookings,
              deliveryOption: dt.deliveryOption,
              createdAt: dt.createdAt
            });
          }
        });
        setActiveOrders(list);
      },
      (err) => console.error('Map active orders listener error:', err)
    );

    return () => {
      unsubRiders();
      unsubMerchants();
      unsubCustomers();
      unsubOrders();
    };
  }, []);

  // 3. Filter by City
  const filteredRidersByCity = useMemo(() => {
    if (selectedCityId === 'all') return riders;
    return riders.filter((r) => r.cityId === selectedCityId);
  }, [riders, selectedCityId]);

  // Online counts per vehicle type
  const onlineCountsPerVehicle = useMemo(() => {
    const counts: Record<VehicleType, number> = {
      motorcycle: 0,
      tricycle: 0,
      car4: 0,
      car8: 0
    };
    filteredRidersByCity.forEach((r) => {
      const vtype = (r.vehicleType as VehicleType) || 'motorcycle';
      if (counts[vtype] !== undefined) {
        counts[vtype]++;
      } else {
        counts.motorcycle++;
      }
    });
    return counts;
  }, [filteredRidersByCity]);

  // Filtered riders after vehicle type selection
  const filteredRiders = useMemo(() => {
    if (selectedVehicleType === 'all') return filteredRidersByCity;
    return filteredRidersByCity.filter((r) => {
      const vtype = (r.vehicleType as VehicleType) || 'motorcycle';
      return vtype === selectedVehicleType;
    });
  }, [filteredRidersByCity, selectedVehicleType]);

  const filteredMerchants = useMemo(() => {
    if (selectedCityId === 'all') return merchants;
    return merchants.filter((m) => m.cityId === selectedCityId);
  }, [merchants, selectedCityId]);

  const filteredCustomers = useMemo(() => {
    if (selectedCityId === 'all') return customers;
    return customers.filter((c) => c.cityId === selectedCityId);
  }, [customers, selectedCityId]);

  const filteredActiveOrders = useMemo(() => {
    if (selectedCityId === 'all') return activeOrders;
    return activeOrders.filter((o) => o.cityId === selectedCityId);
  }, [activeOrders, selectedCityId]);

  // Available batches in current view
  const availableBatches = useMemo(() => {
    const map = new Map<string, Order[]>();
    filteredActiveOrders.forEach((o) => {
      if (o.batchId) {
        const arr = map.get(o.batchId) || [];
        arr.push(o);
        map.set(o.batchId, arr);
      }
    });
    return Array.from(map.entries()).map(([bId, bOrders]) => {
      bOrders.sort((a, b) => Number(a.bookingRank || 1) - Number(b.bookingRank || 1));
      return {
        batchId: bId,
        orders: bOrders,
        riderName: bOrders[0]?.riderName || 'Unassigned',
        riderPhone: bOrders[0]?.riderPhone,
        riderLocation: bOrders[0]?.riderLocation
      };
    });
  }, [filteredActiveOrders]);

  const currentBatch = useMemo(() => {
    if (!selectedBatchId) return null;
    return availableBatches.find((b) => b.batchId === selectedBatchId) || null;
  }, [availableBatches, selectedBatchId]);

  // 4. Update Map view on City Change
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (cityCircleRef.current) {
      cityCircleRef.current.remove();
      cityCircleRef.current = null;
    }

    if (selectedCity && selectedCity.center) {
      const lat = selectedCity.center.lat;
      const lng = selectedCity.center.lng;
      const radiusM = (selectedCity.radiusKm || 15) * 1000;

      map.flyTo([lat, lng], 13, { duration: 1 });

      const circle = L.circle([lat, lng], {
        radius: radiusM,
        color: '#FFC107',
        fillColor: '#FFC107',
        fillOpacity: 0.08,
        weight: 2,
        dashArray: '4, 8'
      }).addTo(map);

      cityCircleRef.current = circle;
    }
  }, [selectedCity]);

  // 5. Render Layers to Leaflet
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // Clear previous layers
    layerGroupsRef.current.riders.clearLayers();
    layerGroupsRef.current.merchants.clearLayers();
    layerGroupsRef.current.customers.clearLayers();
    layerGroupsRef.current.routes.clearLayers();

    // A. Drivers per vehicle type
    if (showRiders) {
      filteredRiders.forEach((rider) => {
        if (!rider.location?.lat || !rider.location?.lng) return;
        const isBusy = Boolean(rider.currentOrderId);
        const vtype = (rider.vehicleType as VehicleType) || 'motorcycle';
        const vStyle = VEHICLE_MARKER_STYLES[vtype] || VEHICLE_MARKER_STYLES.motorcycle;

        const iconHtml = `
          <div class="relative flex items-center justify-center w-9 h-9 rounded-full border-2 border-white shadow-lg text-white font-bold cursor-pointer transform hover:scale-110 transition-transform" style="background-color: ${vStyle.bg};">
            <svg class="w-5 h-5 fill-none stroke-current" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
              <path d="${vStyle.svgPath}" />
            </svg>
            <span class="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full border-2 border-white ${
              isBusy ? 'bg-amber-400' : 'bg-emerald-300'
            }" title="${isBusy ? 'On Trip / Busy' : 'Online & Available'}"></span>
          </div>
        `;

        const divIcon = L.divIcon({
          html: iconHtml,
          className: 'delivio-driver-marker',
          iconSize: [36, 36],
          iconAnchor: [18, 18]
        });

        const marker = L.marker([rider.location.lat, rider.location.lng], { icon: divIcon });
        marker.on('click', () => {
          setSelectedEntity({ type: 'rider', data: rider });
        });
        marker.addTo(layerGroupsRef.current.riders);
      });
    }

    // B. Merchants
    if (showMerchants) {
      filteredMerchants.forEach((m) => {
        if (!m.lat || !m.lng) return;
        const isSuspended = m.status === 'suspended';
        const bgClass = isSuspended ? 'bg-red-500' : m.isOpen ? 'bg-emerald-600' : 'bg-gray-400';

        const iconHtml = `
          <div class="flex items-center justify-center w-8 h-8 rounded-xl ${bgClass} border-2 border-white shadow-md text-white cursor-pointer hover:scale-110 transition-transform">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 21v-7.5a.75.75 0 0 1 .75-.75h3a.75.75 0 0 1 .75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 0 0 3.75-.614A2.993 2.993 0 0 0 9 9.35c.828 0 1.579-.336 2.125-.879.546.543 1.297.879 2.125.879s1.579-.336 2.125-.879a2.993 2.993 0 0 0 2.125.879c.828 0 1.579-.336 2.125-.879a3.001 3.001 0 0 0 3.75.614M3.75 9.35V5.25A2.25 2.25 0 0 1 6 3h12a2.25 2.25 0 0 1 2.25 2.25v4.1" />
            </svg>
          </div>
        `;

        const divIcon = L.divIcon({
          html: iconHtml,
          className: 'delivio-merchant-marker',
          iconSize: [32, 32],
          iconAnchor: [16, 16]
        });

        const marker = L.marker([m.lat, m.lng], { icon: divIcon });
        marker.on('click', () => {
          setSelectedEntity({ type: 'merchant', data: m });
        });
        marker.addTo(layerGroupsRef.current.merchants);
      });
    }

    // C. Customers
    if (showCustomers) {
      filteredCustomers.forEach((c) => {
        if (!c.location?.lat || !c.location?.lng) return;
        const iconHtml = `
          <div class="flex items-center justify-center w-7 h-7 rounded-full bg-blue-500 border-2 border-white shadow-md text-white cursor-pointer hover:scale-110 transition-transform">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
            </svg>
          </div>
        `;
        const divIcon = L.divIcon({
          html: iconHtml,
          className: 'delivio-customer-marker',
          iconSize: [28, 28],
          iconAnchor: [14, 14]
        });
        const marker = L.marker([c.location.lat, c.location.lng], { icon: divIcon });
        marker.on('click', () => {
          setSelectedEntity({ type: 'customer', data: c });
        });
        marker.addTo(layerGroupsRef.current.customers);
      });
    }

    // D. Active Order Routes
    if (showRoutes) {
      filteredActiveOrders.forEach((o) => {
        // If a specific batch is selected, suppress individual routes for batched orders to avoid clutter
        if (selectedBatchId && o.batchId === selectedBatchId) return;

        if (o.pickup?.lat && o.pickup?.lng && o.dropoff?.lat && o.dropoff?.lng) {
          const latlngs: L.LatLngExpression[] = [
            [o.pickup.lat, o.pickup.lng],
            [o.dropoff.lat, o.dropoff.lng]
          ];
          const polyline = L.polyline(latlngs, {
            color: o.serviceType === 'taxi' ? '#3b82f6' : '#FFB300',
            weight: 3,
            dashArray: '6, 8',
            opacity: 0.85
          });
          polyline.bindTooltip(
            `Order #${o.orderNumber}: ${o.customerName} (${o.serviceType === 'taxi' ? 'Taxi' : 'Delivery'})`,
            { sticky: true }
          );
          polyline.addTo(layerGroupsRef.current.routes);
        }
      });
    }

    // E. Planned Batch Route (Green pins M1, M2... and Red pins C1, C2...)
    layerGroupsRef.current.batchGroup.clearLayers();
    if (currentBatch && currentBatch.orders.length > 0) {
      const waypoints: L.LatLngExpression[] = [];

      // Rider initial location if known
      if (currentBatch.riderLocation?.lat && currentBatch.riderLocation?.lng) {
        waypoints.push([currentBatch.riderLocation.lat, currentBatch.riderLocation.lng]);
      }

      // 1. Pickups: Green numbered merchant pins (M1, M2...)
      currentBatch.orders.forEach((ord, idx) => {
        if (ord.pickup?.lat && ord.pickup?.lng) {
          waypoints.push([ord.pickup.lat, ord.pickup.lng]);
          const greenIcon = L.divIcon({
            html: `
              <div class="flex items-center justify-center w-8 h-8 rounded-full bg-emerald-600 text-white font-black text-xs border-2 border-white shadow-xl cursor-pointer ring-3 ring-emerald-400">
                M${idx + 1}
              </div>
            `,
            className: 'delivio-batch-merchant-pin',
            iconSize: [32, 32],
            iconAnchor: [16, 16]
          });
          const marker = L.marker([ord.pickup.lat, ord.pickup.lng], { icon: greenIcon });
          marker.bindTooltip(
            `Pickup M${idx + 1}: ${ord.merchantName || ord.pickup?.address || 'Merchant'} (Order #${ord.orderNumber})`,
            { permanent: true, direction: 'top', className: 'font-bold text-xs' }
          );
          marker.on('click', () => {
            setSelectedEntity({
              type: 'merchant',
              data: { name: ord.merchantName || 'Merchant', address: ord.pickup?.address || '' }
            });
          });
          marker.addTo(layerGroupsRef.current.batchGroup);
        }
      });

      // 2. Drop-offs: Red numbered customer pins (C1, C2...)
      currentBatch.orders.forEach((ord, idx) => {
        if (ord.dropoff?.lat && ord.dropoff?.lng) {
          waypoints.push([ord.dropoff.lat, ord.dropoff.lng]);
          const redIcon = L.divIcon({
            html: `
              <div class="flex items-center justify-center w-8 h-8 rounded-full bg-red-600 text-white font-black text-xs border-2 border-white shadow-xl cursor-pointer ring-3 ring-red-400">
                C${idx + 1}
              </div>
            `,
            className: 'delivio-batch-customer-pin',
            iconSize: [32, 32],
            iconAnchor: [16, 16]
          });
          const marker = L.marker([ord.dropoff.lat, ord.dropoff.lng], { icon: redIcon });
          marker.bindTooltip(
            `Drop-off C${idx + 1}: ${ord.customerName} - ${ord.dropoff?.address || 'Customer'} (Order #${ord.orderNumber})`,
            { permanent: true, direction: 'bottom', className: 'font-bold text-xs' }
          );
          marker.on('click', () => {
            setSelectedEntity({
              type: 'customer',
              data: { name: ord.customerName, address: ord.dropoff?.address || '', phone: ord.customerPhone }
            });
          });
          marker.addTo(layerGroupsRef.current.batchGroup);
        }
      });

      // 3. Planned Route Polyline
      if (waypoints.length >= 2) {
        const polyline = L.polyline(waypoints, {
          color: '#7c3aed',
          weight: 5,
          opacity: 0.95,
          dashArray: '10, 6'
        });
        polyline.bindTooltip(
          `Batch #${currentBatch.batchId} Planned Route (${currentBatch.orders.length} bookings, ${currentBatch.orders.length * 2} stops)`,
          { sticky: true }
        );
        polyline.addTo(layerGroupsRef.current.batchGroup);

        // Auto zoom and pan to fit planned batch route
        if (mapInstanceRef.current) {
          mapInstanceRef.current.fitBounds(L.latLngBounds(waypoints), {
            padding: [60, 60],
            maxZoom: 15
          });
        }
      }
    }
  }, [
    filteredRiders,
    filteredMerchants,
    filteredCustomers,
    filteredActiveOrders,
    showRiders,
    showMerchants,
    showCustomers,
    showRoutes,
    currentBatch,
    selectedBatchId
  ]);

  // Quick Action: Suspend / Unsuspend Driver
  const handleToggleRiderSuspend = async (rider: Rider) => {
    try {
      const isCurrentlySuspended = rider.status === 'suspended';
      const newStatus = isCurrentlySuspended ? 'active' : 'suspended';

      // Update riders/{uid} and users/{uid}
      await updateDoc(doc(db, 'riders', rider.id), {
        status: newStatus,
        isOnline: isCurrentlySuspended ? rider.isOnline : false
      });
      await updateDoc(doc(db, 'users', rider.id), {
        status: newStatus
      });

      showSuccess(`Driver ${rider.name} marked as ${newStatus}`);
      setSelectedEntity((prev) =>
        prev && prev.data.id === rider.id
          ? { ...prev, data: { ...prev.data, status: newStatus } }
          : null
      );
    } catch (err: any) {
      showError(err);
    }
  };

  return (
    <div className="relative h-[calc(100vh-6.5rem)] w-full rounded-2xl overflow-hidden border border-gray-200 dark:border-zinc-800 shadow-sm flex">
      {/* Top Floating Controls */}
      <div className="absolute top-4 left-4 right-4 sm:right-auto z-20 flex flex-col gap-2 max-w-full">
        {/* Main Layer Toggles Toolbar */}
        <div className="flex flex-wrap items-center gap-2 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md p-2 rounded-2xl border border-gray-200 dark:border-zinc-800 shadow-xl text-xs font-semibold">
          {/* Drivers toggle */}
          <button
            onClick={() => setShowRiders(!showRiders)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl transition-all ${
              showRiders
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400'
            }`}
          >
            <Car className="w-3.5 h-3.5" />
            <span>Drivers ({filteredRidersByCity.length})</span>
          </button>

          {/* Merchants toggle */}
          <button
            onClick={() => setShowMerchants(!showMerchants)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl transition-all ${
              showMerchants
                ? 'bg-amber-500 text-black shadow-xs'
                : 'bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400'
            }`}
          >
            <Store className="w-3.5 h-3.5" />
            <span>Merchants ({filteredMerchants.length})</span>
          </button>

          {/* Customers toggle */}
          <button
            onClick={() => setShowCustomers(!showCustomers)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl transition-all ${
              showCustomers
                ? 'bg-blue-500 text-white shadow-xs'
                : 'bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400'
            }`}
          >
            <User className="w-3.5 h-3.5" />
            <span>Customers ({filteredCustomers.length})</span>
          </button>

          {/* Routes toggle */}
          <button
            onClick={() => setShowRoutes(!showRoutes)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl transition-all ${
              showRoutes
                ? 'bg-purple-500 text-white shadow-xs'
                : 'bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400'
            }`}
          >
            <Route className="w-3.5 h-3.5" />
            <span>Routes ({filteredActiveOrders.length})</span>
          </button>

          {/* Batch Selector Dropdown */}
          <div className="flex items-center gap-1.5 pl-1">
            <span className="text-gray-300 dark:text-zinc-700">|</span>
            <div className="flex items-center gap-1">
              <Layers className="w-3.5 h-3.5 text-purple-600" />
              <select
                value={selectedBatchId}
                onChange={(e) => {
                  const val = e.target.value;
                  setSelectedBatchId(val);
                  if (val) {
                    setSearchParams({ batchId: val });
                  } else {
                    searchParams.delete('batchId');
                    setSearchParams(searchParams);
                  }
                }}
                className="bg-purple-50 dark:bg-purple-950/60 text-purple-950 dark:text-purple-200 border border-purple-300 dark:border-purple-800 text-xs font-bold rounded-xl px-2.5 py-1.5 focus:outline-hidden focus:ring-2 focus:ring-purple-400"
              >
                <option value="">All Routes (Normal View)</option>
                {availableBatches.map((b) => (
                  <option key={b.batchId} value={b.batchId}>
                    Batch #{b.batchId.slice(-6)} ({b.orders.length} bookings • {b.riderName})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Vehicle-Type Filter Chips (Only shown when Drivers layer is enabled) */}
        {showRiders && (
          <div className="flex flex-wrap items-center gap-1.5 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-md px-3 py-1.5 rounded-2xl border border-gray-200 dark:border-zinc-800 shadow-md text-xs">
            <span className="text-[11px] font-bold text-gray-500 dark:text-zinc-400 mr-1 flex items-center gap-1">
              <Layers className="w-3 h-3" /> Vehicle:
            </span>

            <button
              onClick={() => setSelectedVehicleType('all')}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                selectedVehicleType === 'all'
                  ? 'bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900 shadow-xs'
                  : 'bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-300 hover:bg-gray-200 dark:hover:bg-zinc-700'
              }`}
            >
              All ({filteredRidersByCity.length})
            </button>

            {VEHICLE_TYPES.map((v) => {
              const count = onlineCountsPerVehicle[v.id] || 0;
              const isSelected = selectedVehicleType === v.id;
              const vStyle = VEHICLE_MARKER_STYLES[v.id];

              return (
                <button
                  key={v.id}
                  onClick={() => setSelectedVehicleType(v.id)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all border ${
                    isSelected
                      ? 'bg-white dark:bg-zinc-800 text-gray-900 dark:text-white shadow-xs'
                      : 'bg-gray-50 dark:bg-zinc-850/80 text-gray-600 dark:text-zinc-400 hover:bg-gray-100 border-transparent'
                  }`}
                  style={{
                    borderColor: isSelected ? vStyle.bg : 'transparent'
                  }}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full inline-block"
                    style={{ backgroundColor: vStyle.bg }}
                  />
                  <span>{v.shortLabel}</span>
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-gray-200 dark:bg-zinc-700 text-gray-700 dark:text-zinc-300">
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Map Legend (Bottom-Left) */}
      <div className="absolute bottom-4 left-4 z-20 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md p-3 rounded-2xl border border-gray-200 dark:border-zinc-800 shadow-xl text-xs max-w-xs">
        <div className="flex items-center gap-1 font-bold text-gray-700 dark:text-zinc-200 text-[11px] mb-2 uppercase tracking-wider">
          <Info className="w-3.5 h-3.5 text-amber-500" />
          <span>Map Legend</span>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
          <div className="flex items-center gap-1.5 text-gray-600 dark:text-zinc-400">
            <span className="w-3 h-3 rounded-full bg-emerald-500 border border-white shrink-0" />
            <span>Motorcycle</span>
          </div>
          <div className="flex items-center gap-1.5 text-gray-600 dark:text-zinc-400">
            <span className="w-3 h-3 rounded-full bg-amber-500 border border-white shrink-0" />
            <span>Tricycle</span>
          </div>
          <div className="flex items-center gap-1.5 text-gray-600 dark:text-zinc-400">
            <span className="w-3 h-3 rounded-full bg-blue-500 border border-white shrink-0" />
            <span>4-Seater Car</span>
          </div>
          <div className="flex items-center gap-1.5 text-gray-600 dark:text-zinc-400">
            <span className="w-3 h-3 rounded-full bg-purple-500 border border-white shrink-0" />
            <span>8-Seater Car</span>
          </div>
          <div className="flex items-center gap-1.5 text-gray-600 dark:text-zinc-400">
            <span className="w-3 h-3 rounded-md bg-emerald-600 border border-white shrink-0" />
            <span>Merchant</span>
          </div>
          <div className="flex items-center gap-1.5 text-gray-600 dark:text-zinc-400">
            <span className="w-3 h-3 rounded-full bg-blue-500 border border-white shrink-0" />
            <span>Customer</span>
          </div>
        </div>
      </div>

      {/* Floating Planned Batch Route Card when a batch is active */}
      {currentBatch && (
        <div className="absolute top-20 right-4 z-20 w-80 sm:w-96 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md rounded-2xl border border-purple-300 dark:border-purple-800 shadow-2xl p-4 text-xs space-y-3 animate-in slide-in-from-right duration-200">
          <div className="flex items-center justify-between border-b border-gray-100 dark:border-zinc-800 pb-2.5">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-purple-600 text-white shadow-xs">
                <Route className="w-4 h-4" />
              </div>
              <div>
                <h4 className="font-extrabold text-sm text-purple-950 dark:text-purple-200">
                  Planned Batch Route
                </h4>
                <span className="font-mono text-[11px] text-gray-500">
                  Batch #{currentBatch.batchId}
                </span>
              </div>
            </div>
            <button
              onClick={() => {
                setSelectedBatchId('');
                searchParams.delete('batchId');
                setSearchParams(searchParams);
              }}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors"
              title="Close Batch Route View"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Rider summary */}
          <div className="flex items-center justify-between p-2.5 rounded-xl bg-purple-50/70 dark:bg-purple-950/40 text-[11px]">
            <div className="flex items-center gap-1.5 font-bold text-gray-900 dark:text-white">
              <Car className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              <span>{currentBatch.riderName}</span>
            </div>
            <span className="text-gray-500 font-mono">{currentBatch.riderPhone || 'In transit'}</span>
          </div>

          {/* Planned Sequence */}
          <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
            <div className="text-[10px] uppercase font-bold text-gray-400">
              Sequence of Stops ({currentBatch.orders.length * 2} total):
            </div>
            {/* Merchant pickups M1, M2 */}
            {currentBatch.orders.map((ord, idx) => (
              <div
                key={`m-${ord.id}`}
                className="flex items-start gap-2 p-2 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200/60 dark:border-emerald-800/60"
              >
                <span className="w-5 h-5 rounded-full bg-emerald-600 text-white font-black text-[10px] flex items-center justify-center shrink-0 shadow-2xs">
                  M{idx + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 block">
                    Pickup M{idx + 1} (#{ord.orderNumber})
                  </span>
                  <p className="text-[11px] font-medium text-gray-900 dark:text-white truncate">
                    {ord.merchantName || ord.pickup?.address || 'Pickup Point'}
                  </p>
                </div>
              </div>
            ))}
            {/* Customer dropoffs C1, C2 */}
            {currentBatch.orders.map((ord, idx) => (
              <div
                key={`c-${ord.id}`}
                className="flex items-start gap-2 p-2 rounded-xl bg-red-50/70 dark:bg-red-950/30 border border-red-200/60 dark:border-red-800/60"
              >
                <span className="w-5 h-5 rounded-full bg-red-600 text-white font-black text-[10px] flex items-center justify-center shrink-0 shadow-2xs">
                  C{idx + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <span className="text-[10px] font-bold text-red-700 dark:text-red-400 block">
                    Drop-off C{idx + 1} (#{ord.orderNumber})
                  </span>
                  <p className="text-[11px] font-medium text-gray-900 dark:text-white truncate">
                    {ord.customerName} - {ord.dropoff?.address || 'Customer destination'}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Quick buttons */}
          <div className="pt-2 border-t border-gray-100 dark:border-zinc-800 flex items-center gap-2">
            <button
              onClick={() => navigate('/orders')}
              className="flex-1 py-1.5 rounded-xl border border-gray-200 dark:border-zinc-800 font-bold text-gray-700 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors text-center"
            >
              View Orders
            </button>
            <button
              onClick={() => {
                const waypoints: L.LatLngExpression[] = [];
                currentBatch.orders.forEach((o) => {
                  if (o.pickup?.lat && o.pickup?.lng) waypoints.push([o.pickup.lat, o.pickup.lng]);
                  if (o.dropoff?.lat && o.dropoff?.lng) waypoints.push([o.dropoff.lat, o.dropoff.lng]);
                });
                if (mapInstanceRef.current && waypoints.length > 0) {
                  mapInstanceRef.current.fitBounds(L.latLngBounds(waypoints), { padding: [60, 60] });
                }
              }}
              className="flex-1 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold transition-colors text-center shadow-xs"
            >
              Center Route
            </button>
          </div>
        </div>
      )}

      {/* Map Element */}
      <div ref={mapContainerRef} className="h-full w-full z-10" />

      {/* Slide-in Detail Panel on marker click */}
      {selectedEntity && (
        <div className="absolute top-0 right-0 bottom-0 z-30 w-full sm:w-96 bg-white dark:bg-zinc-950 border-l border-gray-200 dark:border-zinc-800 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200 overflow-hidden">
          {/* Panel Header */}
          <div className="p-4 border-b border-gray-100 dark:border-zinc-850 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase font-extrabold tracking-wider px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/60 text-amber-900 dark:text-amber-300">
                {selectedEntity.type === 'rider' ? 'Driver' : selectedEntity.type}
              </span>
              <span className="text-xs text-gray-400">Live Telemetry</span>
            </div>
            <button
              onClick={() => setSelectedEntity(null)}
              className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-zinc-200 rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Panel Content based on Entity */}
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {/* DRIVER DETAILS */}
            {selectedEntity.type === 'rider' && (() => {
              const r: Rider = selectedEntity.data;
              const activeOrder = activeOrders.find((o) => o.riderId === r.id);
              const vtype = (r.vehicleType as VehicleType) || 'motorcycle';
              const vStyle = VEHICLE_MARKER_STYLES[vtype] || VEHICLE_MARKER_STYLES.motorcycle;
              const vehicleLabel = VEHICLE_LABELS[vtype] || 'Motorcycle';

              return (
                <>
                  <div className="flex items-center gap-3">
                    <div className="w-14 h-14 rounded-2xl bg-amber-400 text-black font-extrabold text-lg flex items-center justify-center overflow-hidden shrink-0 shadow-md">
                      {r.photoUrl ? (
                        <img src={r.photoUrl} alt={r.name} className="w-full h-full object-cover" />
                      ) : (
                        <span>{r.name.charAt(0)}</span>
                      )}
                    </div>
                    <div>
                      <h4 className="font-extrabold text-base text-gray-900 dark:text-white">
                        {r.name}
                      </h4>
                      <p className="text-xs font-mono text-gray-500 dark:text-zinc-400">
                        ID: {r.riderCode}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            r.status === 'suspended'
                              ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                              : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                          }`}
                        >
                          {r.status}
                        </span>
                        <span className="flex items-center text-xs font-bold text-amber-500">
                          <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400 mr-0.5" />
                          {r.rating || 5.0}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Vehicle & Contact Info */}
                  <div className="p-3.5 rounded-xl bg-gray-50 dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 space-y-2 text-xs">
                    <div className="flex justify-between items-center">
                      <span className="text-gray-500">Vehicle Type:</span>
                      <span
                        className="font-bold px-2 py-0.5 rounded text-white text-[11px]"
                        style={{ backgroundColor: vStyle.bg }}
                      >
                        {vehicleLabel}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Vehicle Model:</span>
                      <span className="font-bold text-gray-900 dark:text-white">
                        {r.vehicleModel || 'N/A'} {r.vehicleColor ? `(${r.vehicleColor})` : ''}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Seats:</span>
                      <span className="font-bold text-gray-900 dark:text-white">
                        {r.seats ?? (vtype === 'motorcycle' ? 1 : vtype === 'tricycle' ? 3 : vtype === 'car8' ? 8 : 4)} passengers
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Plate Number:</span>
                      <span className="font-bold font-mono text-gray-900 dark:text-white">
                        {r.plate || 'N/A'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-500">Phone:</span>
                      <a
                        href={`tel:${r.phone}`}
                        className="font-bold text-amber-600 dark:text-amber-400 hover:underline flex items-center gap-1"
                      >
                        <Phone className="w-3 h-3" />
                        {r.phone || 'N/A'}
                      </a>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Last GPS Ping:</span>
                      <span className="font-semibold text-gray-700 dark:text-zinc-300">
                        {formatRelativeTime(r.location?.updatedAt)}
                      </span>
                    </div>
                  </div>

                  {/* Enabled Services Badges */}
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                      Allowed Services
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {(r.allowedServices || []).map((s) => (
                        <span
                          key={s}
                          className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-amber-50 dark:bg-zinc-850 text-amber-900 dark:text-amber-300 border border-amber-200/60 dark:border-zinc-700"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Active Order if any */}
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                      Current Live Assignment
                    </label>
                    {activeOrder ? (
                      <div className="p-3.5 rounded-xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-300 dark:border-amber-900/60 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-xs text-gray-900 dark:text-white">
                            #{activeOrder.orderNumber}
                          </span>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-200 text-amber-900">
                            {activeOrder.status}
                          </span>
                        </div>
                        <p className="text-xs text-gray-600 dark:text-zinc-300">
                          {activeOrder.serviceType === 'taxi'
                            ? `Taxi: ${activeOrder.pickup?.address || 'Pickup'} → ${activeOrder.dropoff?.address || 'Drop-off'}`
                            : `${activeOrder.merchantName} → ${activeOrder.customerName}`}
                        </p>
                        <button
                          onClick={() => navigate(`/orders?search=${activeOrder.orderNumber}`)}
                          className="text-xs text-amber-600 dark:text-amber-400 font-bold hover:underline flex items-center gap-1 mt-1"
                        >
                          View order details <ExternalLink className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <div className="p-3 rounded-xl bg-gray-50 dark:bg-zinc-900 text-xs text-gray-400 text-center">
                        Driver is currently waiting for assignment (Available).
                      </div>
                    )}
                  </div>

                  {/* Earnings & Remittance */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 rounded-xl bg-gray-50 dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800">
                      <span className="text-[10px] uppercase font-bold text-gray-400">
                        Cash Remitted
                      </span>
                      <div className="text-base font-extrabold text-gray-900 dark:text-white mt-1">
                        ₱{Number(r.cashRemitted || 0).toFixed(2)}
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-gray-50 dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800">
                      <span className="text-[10px] uppercase font-bold text-gray-400">
                        Wallet Balance
                      </span>
                      <div className="text-base font-extrabold text-emerald-600 dark:text-emerald-400 mt-1">
                        ₱{Number(r.walletBalance || 0).toFixed(2)}
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="pt-2 space-y-2">
                    <button
                      onClick={() => handleToggleRiderSuspend(r)}
                      className={`w-full py-2.5 rounded-xl text-xs font-bold transition-colors ${
                        r.status === 'suspended'
                          ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                          : 'bg-red-50 hover:bg-red-100 dark:bg-red-950/40 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900'
                      }`}
                    >
                      {r.status === 'suspended' ? 'Unsuspend Driver' : 'Suspend Driver Account'}
                    </button>

                    <div className="flex gap-2">
                      <button
                        onClick={() => navigate(`/inbox?riderId=${r.id}`)}
                        className="flex-1 py-2 px-3 rounded-xl border border-gray-300 dark:border-zinc-700 hover:bg-gray-50 dark:hover:bg-zinc-850 text-xs font-bold text-gray-700 dark:text-zinc-200 flex items-center justify-center gap-1.5"
                      >
                        <Mail className="w-3.5 h-3.5" /> Message
                      </button>
                      <button
                        onClick={() => navigate(`/riders?search=${r.name}`)}
                        className="flex-1 py-2 px-3 rounded-xl delivio-btn-yellow text-xs font-bold flex items-center justify-center gap-1.5"
                      >
                        <ExternalLink className="w-3.5 h-3.5" /> Full Profile
                      </button>
                    </div>
                  </div>
                </>
              );
            })()}

            {/* MERCHANT DETAILS */}
            {selectedEntity.type === 'merchant' && (() => {
              const m: Merchant = selectedEntity.data;
              return (
                <>
                  <div className="flex items-center gap-3">
                    <div className="w-14 h-14 rounded-2xl bg-amber-100 text-amber-800 font-extrabold text-lg flex items-center justify-center overflow-hidden shrink-0 shadow-md">
                      {m.logoUrl ? (
                        <img src={m.logoUrl} alt={m.name} className="w-full h-full object-cover" />
                      ) : (
                        <Store className="w-7 h-7 text-amber-600" />
                      )}
                    </div>
                    <div>
                      <h4 className="font-extrabold text-base text-gray-900 dark:text-white">
                        {m.name}
                      </h4>
                      <p className="text-xs text-gray-500 dark:text-zinc-400">
                        Owner: {m.ownerName || 'N/A'}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            m.isOpen
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                              : 'bg-gray-200 text-gray-800 dark:bg-zinc-800 dark:text-zinc-300'
                          }`}
                        >
                          {m.isOpen ? 'Open Now' : 'Closed'}
                        </span>
                        <span className="text-xs font-semibold uppercase text-gray-400">
                          {m.type}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-gray-50 dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Address:</span>
                      <span className="font-semibold text-gray-800 dark:text-zinc-200 text-right max-w-[200px]">
                        {m.address || 'N/A'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-500">Phone:</span>
                      <a
                        href={`tel:${m.phone}`}
                        className="font-bold text-amber-600 dark:text-amber-400 hover:underline flex items-center gap-1"
                      >
                        <Phone className="w-3 h-3" />
                        {m.phone || 'N/A'}
                      </a>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Commission Rate:</span>
                      <span className="font-bold text-amber-600">
                        {m.commissionRate || 15}%
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={() => navigate(`/merchants?search=${m.name}`)}
                    className="w-full delivio-btn-yellow py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5"
                  >
                    Manage Store & Menu
                  </button>
                </>
              );
            })()}

            {/* CUSTOMER DETAILS */}
            {selectedEntity.type === 'customer' && (() => {
              const c: UserProfile = selectedEntity.data;
              return (
                <>
                  <div className="flex items-center gap-3">
                    <div className="w-14 h-14 rounded-2xl bg-blue-100 text-blue-800 font-extrabold text-lg flex items-center justify-center overflow-hidden shrink-0 shadow-md">
                      {c.photoUrl ? (
                        <img src={c.photoUrl} alt={c.name} className="w-full h-full object-cover" />
                      ) : (
                        <User className="w-7 h-7 text-blue-600" />
                      )}
                    </div>
                    <div>
                      <h4 className="font-extrabold text-base text-gray-900 dark:text-white">
                        {c.name}
                      </h4>
                      <p className="text-xs text-gray-500 dark:text-zinc-400">{c.email}</p>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 mt-1">
                        Customer
                      </span>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-gray-50 dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 space-y-2 text-xs">
                    <div className="flex justify-between items-center">
                      <span className="text-gray-500">Phone:</span>
                      <a
                        href={`tel:${c.phone}`}
                        className="font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                      >
                        <Phone className="w-3 h-3" />
                        {c.phone || 'N/A'}
                      </a>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Last Active Ping:</span>
                      <span className="font-semibold text-gray-800 dark:text-zinc-200">
                        {formatRelativeTime(c.location?.updatedAt)}
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={() => navigate(`/customers?search=${c.name}`)}
                    className="w-full delivio-btn-yellow py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5"
                  >
                    View Customer Profile & History
                  </button>
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
};
