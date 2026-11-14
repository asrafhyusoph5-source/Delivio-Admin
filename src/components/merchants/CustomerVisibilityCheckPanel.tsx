import React, { useState, useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import type { City, Merchant } from '../../types';
import { effectiveOpen } from '../../pages/Merchants';
import { findMatchingCity } from '../../utils/cityUtils';
import {
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  MapPin,
  Clock,
  Navigation,
  Map as MapIcon,
  Wrench,
  Loader2
} from 'lucide-react';

interface CustomerVisibilityCheckPanelProps {
  merchant: Merchant;
  cities: City[];
  platformServices: Record<string, boolean>;
  platformTimezone: string;
  globalDispatchRadiusKm: number;
  onFixCity?: (matchedCity: City) => Promise<void> | void;
  fixingCity?: boolean;
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export const CustomerVisibilityCheckPanel: React.FC<CustomerVisibilityCheckPanelProps> = ({
  merchant,
  cities,
  platformServices,
  platformTimezone,
  globalDispatchRadiusKm,
  onFixCity,
  fixingCity = false
}) => {
  const cityObj = useMemo(
    () => cities.find((c) => c.id === merchant.cityId),
    [cities, merchant.cityId]
  );
  const isCitySavedAsText = Boolean(merchant.cityId && cities.length > 0 && !cityObj);
  const matchedFixCity = useMemo(
    () => (isCitySavedAsText ? findMatchingCity(merchant.cityId, cities) : null),
    [isCitySavedAsText, merchant.cityId, cities]
  );

  const defaultTestCoords = useMemo(() => {
    if (cityObj?.center?.lat && cityObj?.center?.lng) {
      return { lat: Number(cityObj.center.lat), lng: Number(cityObj.center.lng) };
    }
    return { lat: 9.7392, lng: 118.7353 };
  }, [cityObj]);

  const [testLat, setTestLat] = useState<number>(defaultTestCoords.lat);
  const [testLng, setTestLng] = useState<number>(defaultTestCoords.lng);
  const [showMapPicker, setShowMapPicker] = useState(false);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const testMarkerRef = useRef<L.Marker | null>(null);

  // Reset test location to city center when switching merchants
  useEffect(() => {
    setTestLat(defaultTestCoords.lat);
    setTestLng(defaultTestCoords.lng);
  }, [merchant.id, defaultTestCoords.lat, defaultTestCoords.lng]);

  const hasValidCoords = useMemo(
    () =>
      Number.isFinite(merchant.lat) &&
      Number.isFinite(merchant.lng) &&
      merchant.lat !== 0 &&
      merchant.lng !== 0,
    [merchant.lat, merchant.lng]
  );

  const effectiveRadiusKm = useMemo(() => {
    if (merchant.specialRadius?.enabled && Number(merchant.specialRadius.radiusKm) > 0) {
      return Number(merchant.specialRadius.radiusKm);
    }
    return globalDispatchRadiusKm || 5;
  }, [merchant.specialRadius, globalDispatchRadiusKm]);

  // Interactive test location map
  useEffect(() => {
    if (!showMapPicker || !mapContainerRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [testLat, testLng],
      zoom: 13
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    // Draw shop marker and radius circle if shop has coordinates
    if (hasValidCoords) {
      const shopIcon = L.divIcon({
        html: `<div class="w-4 h-4 rounded-full bg-amber-500 border-2 border-white shadow-md"></div>`,
        className: 'shop-pin-preview',
        iconSize: [16, 16],
        iconAnchor: [8, 8]
      });
      L.marker([merchant.lat, merchant.lng], { icon: shopIcon })
        .bindTooltip(`Shop: ${merchant.name || 'Merchant'}`)
        .addTo(map);

      L.circle([merchant.lat, merchant.lng], {
        radius: effectiveRadiusKm * 1000,
        color: '#f59e0b',
        fillColor: '#f59e0b',
        fillOpacity: 0.1,
        weight: 1.5
      }).addTo(map);
    }

    const testIcon = L.divIcon({
      html: `<div class="w-5 h-5 rounded-full bg-blue-600 border-2 border-white shadow-lg"></div>`,
      className: 'customer-test-pin',
      iconSize: [20, 20],
      iconAnchor: [10, 10]
    });

    const marker = L.marker([testLat, testLng], { icon: testIcon, draggable: true }).addTo(map);
    marker.bindTooltip('Test Customer Location (drag or click map)');

    marker.on('dragend', () => {
      const pos = marker.getLatLng();
      setTestLat(Number(pos.lat.toFixed(6)));
      setTestLng(Number(pos.lng.toFixed(6)));
    });

    map.on('click', (e: L.LeafletMouseEvent) => {
      const newLat = Number(e.latlng.lat.toFixed(6));
      const newLng = Number(e.latlng.lng.toFixed(6));
      marker.setLatLng([newLat, newLng]);
      setTestLat(newLat);
      setTestLng(newLng);
    });

    mapInstanceRef.current = map;
    testMarkerRef.current = marker;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
      testMarkerRef.current = null;
    };
  }, [showMapPicker, merchant.id, hasValidCoords, merchant.lat, merchant.lng, effectiveRadiusKm]);

  // Keep test marker synced when preset buttons / inputs change coordinates
  useEffect(() => {
    if (testMarkerRef.current && mapInstanceRef.current) {
      testMarkerRef.current.setLatLng([testLat, testLng]);
    }
  }, [testLat, testLng]);

  // Evaluate all 7 customer visibility rules
  const evaluation = useMemo(() => {
    const serviceLabel = merchant.type === 'convenience' ? 'Delivio Mart' : 'Delivio Food';

    const statusPass = merchant.status === 'active';
    const statusFailReason = `Shop status is "${merchant.status || 'inactive'}" (must be active)`;

    let cityPass = false;
    let cityDetail = '';
    let cityFailReason = '';
    if (!merchant.cityId) {
      cityFailReason = 'Shop has no city assigned';
    } else if (!cityObj) {
      cityFailReason = `City "${merchant.cityId}" does not exist`;
    } else if (cityObj.status === 'inactive') {
      cityFailReason = `City "${cityObj.name}" is inactive`;
    } else if (cityObj.services?.[merchant.type] === false) {
      cityFailReason = `${serviceLabel} service is turned off in ${cityObj.name}`;
    } else {
      cityPass = true;
      cityDetail = `${cityObj.name} (${serviceLabel} ON)`;
    }

    const typeServicePass = platformServices[merchant.type] !== false;
    const typeServiceFailReason = `Platform-wide ${serviceLabel} service is turned off`;

    const coordsPass = hasValidCoords;
    const coordsFailReason = 'Latitude and longitude are missing (0, 0)';

    const distanceKm = hasValidCoords
      ? haversineKm(testLat, testLng, merchant.lat, merchant.lng)
      : null;
    const radiusTypeLabel = merchant.specialRadius?.enabled ? 'special radius' : 'global radius';
    const radiusPass = distanceKm !== null && distanceKm <= effectiveRadiusKm;
    const radiusFailReason = !hasValidCoords
      ? 'Cannot check delivery distance without shop coordinates'
      : `Test location is ${distanceKm!.toFixed(2)} km away (exceeds ${effectiveRadiusKm} km ${radiusTypeLabel})`;

    const hasNamePass = Boolean(merchant.name && merchant.name.trim().length > 0);
    const hasNameFailReason = 'Shop name is empty';

    // Rule 6/7: Open or Closed check (does NOT hide the shop from customers)
    const openEval = effectiveOpen(merchant, platformTimezone, true, cityObj?.name);
    const isOpenNow = openEval.isOpen && merchant.status === 'active';

    const hidingRules = [
      {
        key: 'status',
        label: 'Status active',
        pass: statusPass,
        detail: statusPass ? 'Active' : statusFailReason,
        failReason: statusFailReason
      },
      {
        key: 'city',
        label: 'City exists with its service on',
        pass: cityPass,
        detail: cityPass ? cityDetail : cityFailReason,
        failReason: cityFailReason
      },
      {
        key: 'service',
        label: 'Business type service on',
        pass: typeServicePass,
        detail: typeServicePass ? `${serviceLabel} enabled` : typeServiceFailReason,
        failReason: typeServiceFailReason
      },
      {
        key: 'coords',
        label: 'Lat and lng present',
        pass: coordsPass,
        detail: coordsPass
          ? `${merchant.lat.toFixed(5)}, ${merchant.lng.toFixed(5)}`
          : coordsFailReason,
        failReason: coordsFailReason
      },
      {
        key: 'radius',
        label: `Inside delivery radius (${effectiveRadiusKm} km ${merchant.specialRadius?.enabled ? 'special' : 'global'})`,
        pass: radiusPass,
        detail:
          distanceKm !== null
            ? `${distanceKm.toFixed(2)} km from test location (limit ${effectiveRadiusKm} km)`
            : radiusFailReason,
        failReason: radiusFailReason
      },
      {
        key: 'name',
        label: 'Has a name',
        pass: hasNamePass,
        detail: hasNamePass ? merchant.name.trim() : hasNameFailReason,
        failReason: hasNameFailReason
      }
    ];

    const firstFailing = hidingRules.find((r) => !r.pass) || null;

    return {
      hidingRules,
      firstFailing,
      isVisible: !firstFailing,
      isOpenNow,
      openReason: openEval.reason,
      distanceKm
    };
  }, [
    merchant,
    cityObj,
    platformServices,
    platformTimezone,
    hasValidCoords,
    testLat,
    testLng,
    effectiveRadiusKm
  ]);

  return (
    <div className="p-4 rounded-2xl border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-gray-100 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          {evaluation.isVisible ? (
            <Eye className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <EyeOff className="w-4 h-4 text-red-600 dark:text-red-400" />
          )}
          <h4 className="text-xs font-extrabold uppercase tracking-wider text-gray-900 dark:text-white">
            Will customers see this shop?
          </h4>
        </div>

        <div className="flex items-center gap-2 text-xs font-bold">
          {evaluation.isVisible ? (
            <span className="text-emerald-700 dark:text-emerald-400">
              Visible ({evaluation.isOpenNow ? 'Open' : 'Closed'})
            </span>
          ) : (
            <span className="text-red-600 dark:text-red-400">Hidden from customers</span>
          )}
        </div>
      </div>

      {/* First failing rule or visible confirmation */}
      {evaluation.firstFailing ? (
        <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/70 flex items-start gap-2 text-xs text-red-800 dark:text-red-300">
          <XCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-extrabold">Hidden because: </span>
            <span>{evaluation.firstFailing.failReason}</span>
          </div>
        </div>
      ) : (
        <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/70 flex items-start gap-2 text-xs text-emerald-800 dark:text-emerald-300">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-extrabold">Visible to customers at test location</span>
            <span className="text-emerald-700 dark:text-emerald-400 ml-1">
              · Shown as <strong>{evaluation.isOpenNow ? 'Open' : 'Closed'}</strong> ({evaluation.openReason})
            </span>
          </div>
        </div>
      )}

      {/* Test Location Picker */}
      <div className="p-3 rounded-xl bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-gray-700 dark:text-zinc-300">
            <Navigation className="w-3.5 h-3.5 text-blue-500" />
            <span>Test Customer Location</span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {cityObj?.center && (
              <button
                type="button"
                onClick={() => {
                  setTestLat(Number(cityObj.center.lat));
                  setTestLng(Number(cityObj.center.lng));
                  if (mapInstanceRef.current) {
                    mapInstanceRef.current.setView([cityObj.center.lat, cityObj.center.lng], 13);
                  }
                }}
                className="px-2.5 py-1 rounded-lg bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 text-[11px] font-semibold text-gray-700 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-zinc-800"
              >
                City Center ({cityObj.name})
              </button>
            )}
            {hasValidCoords && (
              <button
                type="button"
                onClick={() => {
                  setTestLat(Number(merchant.lat));
                  setTestLng(Number(merchant.lng));
                  if (mapInstanceRef.current) {
                    mapInstanceRef.current.setView([merchant.lat, merchant.lng], 14);
                  }
                }}
                className="px-2.5 py-1 rounded-lg bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 text-[11px] font-semibold text-gray-700 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-zinc-800"
              >
                Shop Location
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowMapPicker((v) => !v)}
              className="px-2.5 py-1 rounded-lg bg-amber-100 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-800 text-[11px] font-bold text-amber-900 dark:text-amber-300 flex items-center gap-1"
            >
              <MapIcon className="w-3 h-3" />
              <span>{showMapPicker ? 'Hide Map' : 'Pick on Map'}</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label className="block text-[10px] font-bold uppercase text-gray-400 mb-0.5">
              Test Latitude
            </label>
            <input
              type="number"
              step="0.000001"
              value={testLat}
              onChange={(e) => setTestLat(Number(e.target.value) || 0)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-mono tabular-nums text-gray-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase text-gray-400 mb-0.5">
              Test Longitude
            </label>
            <input
              type="number"
              step="0.000001"
              value={testLng}
              onChange={(e) => setTestLng(Number(e.target.value) || 0)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-mono tabular-nums text-gray-900 dark:text-white"
            />
          </div>
        </div>

        {showMapPicker && (
          <div className="space-y-1.5">
            <div
              ref={mapContainerRef}
              className="w-full h-48 rounded-xl overflow-hidden border border-gray-200 dark:border-zinc-800 z-0"
            />
            <p className="text-[10px] text-gray-500 flex items-center gap-2">
              <MapPin className="w-3 h-3 text-blue-500" />
              <span>Blue pin: Test customer location (click map or drag). Amber circle: Shop delivery radius ({effectiveRadiusKm} km).</span>
            </p>
          </div>
        )}
      </div>

      {/* Rules Checklist */}
      <div className="divide-y divide-gray-100 dark:divide-zinc-800 border border-gray-100 dark:border-zinc-800 rounded-xl overflow-hidden text-xs">
        {evaluation.hidingRules.map((rule) => (
          <div
            key={rule.key}
            className="px-3.5 py-2.5 flex items-center justify-between gap-3 bg-white dark:bg-zinc-900"
          >
            <div className="flex items-center gap-2 min-w-0">
              {rule.pass ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
              ) : (
                <XCircle className="w-4 h-4 text-red-500 shrink-0" />
              )}
              <div className="min-w-0">
                <span className="font-bold text-gray-900 dark:text-white block">
                  {rule.label}
                </span>
                <span className="text-[11px] text-gray-500 dark:text-zinc-400 block truncate">
                  {rule.detail}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {rule.key === 'city' && !rule.pass && isCitySavedAsText && onFixCity && (
                <button
                  type="button"
                  disabled={fixingCity || !matchedFixCity}
                  onClick={() => matchedFixCity && onFixCity(matchedFixCity)}
                  title={
                    matchedFixCity
                      ? `Fix cityId to "${matchedFixCity.id}" (${matchedFixCity.name})`
                      : 'No matching city found in cities collection'
                  }
                  className="px-2.5 py-1 rounded-lg bg-amber-400 hover:bg-amber-500 text-black text-[11px] font-extrabold flex items-center gap-1 shadow-2xs disabled:opacity-50"
                >
                  {fixingCity ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Wrench className="w-3 h-3" />
                  )}
                  <span>Fix</span>
                </button>
              )}
              <span
                className={`text-[11px] font-extrabold ${
                  rule.pass
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-red-600 dark:text-red-400'
                }`}
              >
                {rule.pass ? 'PASS' : 'FAIL'}
              </span>
            </div>
          </div>
        ))}

        {/* Rule 7: Open or Closed (informational — does not hide shop) */}
        <div className="px-3.5 py-2.5 flex items-center justify-between gap-3 bg-gray-50/70 dark:bg-zinc-950/60">
          <div className="flex items-center gap-2 min-w-0">
            {evaluation.isOpenNow ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            ) : (
              <Clock className="w-4 h-4 text-amber-500 shrink-0" />
            )}
            <div className="min-w-0">
              <span className="font-bold text-gray-900 dark:text-white block">
                Not manually closed or outside hours
              </span>
              <span className="text-[11px] text-gray-500 dark:text-zinc-400 block truncate">
                {evaluation.openReason} · Does not hide shop
              </span>
            </div>
          </div>

          <span
            className={`text-[11px] font-extrabold shrink-0 ${
              evaluation.isOpenNow
                ? 'text-emerald-700 dark:text-emerald-400'
                : 'text-amber-700 dark:text-amber-400'
            }`}
          >
            {evaluation.isOpenNow ? 'Open' : 'Closed'}
          </span>
        </div>
      </div>
    </div>
  );
};
