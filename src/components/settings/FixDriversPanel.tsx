import React, { useState } from 'react';
import {
  collection,
  db,
  doc,
  getDocs,
  writeBatch
} from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { logAuditEvent } from '../../utils/audit';
import { nowTs } from '../../utils/date';
import { SERVICES_BY_VEHICLE, VEHICLE_LABELS, type VehicleType } from '../../constants';
import type { OrderServiceType } from '../../types';
import { ConfirmationModal } from '../common/ConfirmationModal';
import {
  Car,
  CheckCircle2,
  Loader2,
  Search,
  Wrench,
  AlertTriangle
} from 'lucide-react';

const VALID_VEHICLE_TYPES: VehicleType[] = ['motorcycle', 'tricycle', 'car4', 'car8'];

interface DriverFixRow {
  riderId: string;
  name: string;
  riderCode: string;
  rawVehicleType: unknown;
  proposedVehicleType: VehicleType;
  vehicleNeedsFix: boolean;
  rawAllowedServices: unknown;
  proposedAllowedServices: OrderServiceType[];
  allowedNeedsFix: boolean;
  proposedActiveServices: OrderServiceType[];
  reasons: string[];
}

export function normalizeDriverVehicleType(raw: unknown): {
  validStrict: boolean;
  normalized: VehicleType;
} {
  if (typeof raw !== 'string') {
    return { validStrict: false, normalized: 'motorcycle' };
  }
  const trimmedLower = raw.trim().toLowerCase();
  const isStrictValid =
    raw === trimmedLower && VALID_VEHICLE_TYPES.includes(raw as VehicleType);

  let normalized: VehicleType = 'motorcycle';
  if (trimmedLower === 'tricycle') {
    normalized = 'tricycle';
  } else if (
    trimmedLower === 'car4' ||
    trimmedLower === 'car' ||
    trimmedLower === '4-seater car' ||
    trimmedLower === '4-seater'
  ) {
    normalized = 'car4';
  } else if (
    trimmedLower === 'car8' ||
    trimmedLower === 'van' ||
    trimmedLower === '8-seater car' ||
    trimmedLower === '8-seater'
  ) {
    normalized = 'car8';
  } else if (
    trimmedLower === 'motorcycle' ||
    trimmedLower === 'motorbike' ||
    trimmedLower === 'motor' ||
    trimmedLower === 'bike'
  ) {
    normalized = 'motorcycle';
  }

  return { validStrict: isStrictValid, normalized };
}

export function evaluateDriverServicesRule(
  rawAllowed: unknown,
  rawActive: unknown,
  vehicleType: VehicleType
): {
  allowedNeedsFix: boolean;
  proposedAllowed: OrderServiceType[];
  proposedActive: OrderServiceType[];
  reasonList: string[];
} {
  const ruleAllowed = SERVICES_BY_VEHICLE[vehicleType];
  const reasons: string[] = [];

  if (!Array.isArray(rawAllowed)) {
    reasons.push('allowedServices missing or invalid');
    const fallbackAllowed = [...ruleAllowed];
    const cleanActive = Array.isArray(rawActive)
      ? ruleAllowed.filter((srv) =>
          rawActive.some((item) => typeof item === 'string' && item.trim().toLowerCase() === srv)
        )
      : [...fallbackAllowed];
    return {
      allowedNeedsFix: true,
      proposedAllowed: fallbackAllowed,
      proposedActive: cleanActive.length > 0 ? cleanActive : [...fallbackAllowed],
      reasonList: reasons
    };
  }

  const seen = new Set<string>();
  let hasDisallowed = false;
  let hasNonNormalized = false;
  let hasDuplicates = false;

  for (const item of rawAllowed) {
    if (typeof item !== 'string') {
      hasNonNormalized = true;
      continue;
    }
    const clean = item.trim().toLowerCase();
    if (item !== clean) {
      hasNonNormalized = true;
    }
    if (seen.has(clean)) {
      hasDuplicates = true;
      continue;
    }
    seen.add(clean);
    if (!ruleAllowed.includes(clean as OrderServiceType)) {
      hasDisallowed = true;
    }
  }

  let proposedAllowed = ruleAllowed.filter((srv) => seen.has(srv));
  const wasEmpty = rawAllowed.length === 0;
  if (wasEmpty) {
    reasons.push('allowedServices is empty');
    proposedAllowed = [...ruleAllowed];
  } else if (proposedAllowed.length === 0) {
    reasons.push(`No valid services for ${vehicleType} (${ruleAllowed.join(', ')})`);
    proposedAllowed = [...ruleAllowed];
  }

  if (hasDisallowed) {
    reasons.push(`Contains service(s) disallowed for ${vehicleType}`);
  }
  if (hasNonNormalized) {
    reasons.push('Service key format needs lowercase normalization');
  }
  if (hasDuplicates) {
    reasons.push('Duplicate service entries');
  }

  const activeList = Array.isArray(rawActive) ? rawActive : [];
  const activeHasInvalid =
    Array.isArray(rawActive) &&
    activeList.some(
      (item) => typeof item !== 'string' || !proposedAllowed.includes(item.trim().toLowerCase() as OrderServiceType)
    );
  const proposedActive = Array.isArray(rawActive)
    ? proposedAllowed.filter((srv) =>
        activeList.some((item) => typeof item === 'string' && item.trim().toLowerCase() === srv)
      )
    : [...proposedAllowed];

  if (activeHasInvalid) {
    reasons.push('activeServices out of sync with vehicle rule');
  }

  const allowedNeedsFix =
    wasEmpty ||
    hasDisallowed ||
    hasNonNormalized ||
    hasDuplicates ||
    activeHasInvalid ||
    proposedAllowed.length === 0;

  return {
    allowedNeedsFix,
    proposedAllowed,
    proposedActive,
    reasonList: reasons
  };
}

export const FixDriversPanel: React.FC = () => {
  const { adminProfile } = useAuth();
  const { showSuccess, showError } = useToast();

  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [totalScanned, setTotalScanned] = useState(0);
  const [rows, setRows] = useState<DriverFixRow[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [resultMessage, setResultMessage] = useState<string | null>(null);

  const handleScanDrivers = async () => {
    try {
      setScanning(true);
      setResultMessage(null);
      const snap = await getDocs(collection(db, 'riders'));
      const flagged: DriverFixRow[] = [];

      snap.forEach((d) => {
        const dt = d.data();
        const { validStrict, normalized } = normalizeDriverVehicleType(dt.vehicleType);
        const vehicleNeedsFix = !validStrict;

        const {
          allowedNeedsFix,
          proposedAllowed,
          proposedActive,
          reasonList
        } = evaluateDriverServicesRule(dt.allowedServices, dt.activeServices, normalized);

        const allReasons: string[] = [];
        if (vehicleNeedsFix) {
          if (dt.vehicleType === undefined || dt.vehicleType === null || dt.vehicleType === '') {
            allReasons.push('Missing vehicleType');
          } else if (
            typeof dt.vehicleType === 'string' &&
            VALID_VEHICLE_TYPES.includes(dt.vehicleType.trim().toLowerCase() as VehicleType)
          ) {
            allReasons.push(`vehicleType "${dt.vehicleType}" is not lowercase`);
          } else {
            allReasons.push(`Invalid vehicleType "${String(dt.vehicleType)}"`);
          }
        }
        allReasons.push(...reasonList);

        if (vehicleNeedsFix || allowedNeedsFix) {
          flagged.push({
            riderId: d.id,
            name: dt.name || 'Unnamed Driver',
            riderCode: dt.riderCode || d.id.slice(0, 8),
            rawVehicleType: dt.vehicleType,
            proposedVehicleType: normalized,
            vehicleNeedsFix,
            rawAllowedServices: dt.allowedServices,
            proposedAllowedServices: proposedAllowed,
            allowedNeedsFix,
            proposedActiveServices: proposedActive,
            reasons: allReasons
          });
        }
      });

      flagged.sort((a, b) => a.name.localeCompare(b.name));
      setTotalScanned(snap.size);
      setRows(flagged);
      setScanned(true);
    } catch (err: any) {
      showError(err);
    } finally {
      setScanning(false);
    }
  };

  const handleApplyFixes = async () => {
    if (rows.length === 0) return;
    try {
      setApplying(true);
      const chunkSize = 400;
      const now = nowTs();

      for (let i = 0; i < rows.length; i += chunkSize) {
        const batch = writeBatch(db);
        const chunk = rows.slice(i, i + chunkSize);

        for (const row of chunk) {
          const rRef = doc(db, 'riders', row.riderId);
          batch.update(rRef, {
            vehicleType: row.proposedVehicleType,
            allowedServices: row.proposedAllowedServices,
            activeServices: row.proposedActiveServices,
            updatedAt: now
          });
        }
        await batch.commit();
      }

      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        adminEmail: adminProfile?.email,
        action: 'FIX_DRIVERS',
        entityType: 'rider',
        entityId: 'bulk_drivers',
        details: `Normalized vehicleType and allowedServices for ${rows.length} driver(s) out of ${totalScanned} scanned.`,
        newValue: rows.slice(0, 50).map((r) => ({
          riderId: r.riderId,
          vehicleType: r.proposedVehicleType,
          allowedServices: r.proposedAllowedServices
        }))
      });

      const msg = `Fixed ${rows.length} driver profile${rows.length === 1 ? '' : 's'} (of ${totalScanned} scanned).`;
      setResultMessage(msg);
      showSuccess(msg);
      setConfirmOpen(false);
      await handleScanDrivers();
    } catch (err: any) {
      showError(err);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-6 shadow-xs space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-2xl bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 shrink-0">
            <Car className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-extrabold text-base text-gray-900 dark:text-white">
              Fix drivers
            </h3>
            <p className="text-xs text-gray-600 dark:text-zinc-400 mt-0.5 max-w-2xl">
              Scans all <code className="font-mono text-amber-700 dark:text-amber-300">riders</code> for non-lowercase or invalid <code className="font-mono text-amber-700 dark:text-amber-300">vehicleType</code> (must be <code className="font-mono">motorcycle</code>, <code className="font-mono">tricycle</code>, <code className="font-mono">car4</code>, or <code className="font-mono">car8</code>) and ensures <code className="font-mono text-amber-700 dark:text-amber-300">allowedServices</code> obeys the vehicle rule.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleScanDrivers}
            disabled={scanning || applying}
            className="px-4 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:bg-gray-50 dark:hover:bg-zinc-700 text-gray-800 dark:text-zinc-200 text-xs font-bold flex items-center justify-center gap-2 shadow-xs disabled:opacity-50 whitespace-nowrap"
          >
            {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            <span>{scanned ? 'Re-scan drivers' : 'Fix drivers'}</span>
          </button>

          {rows.length > 0 && (
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              disabled={applying || scanning}
              className="delivio-btn-yellow px-4 py-2.5 rounded-xl text-xs font-extrabold flex items-center justify-center gap-2 shadow-xs disabled:opacity-50 whitespace-nowrap"
            >
              {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wrench className="w-4 h-4" />}
              <span>Apply fixes ({rows.length})</span>
            </button>
          )}
        </div>
      </div>

      {scanned && (
        rows.length === 0 ? (
          <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 text-xs font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>
              All {totalScanned} driver{totalScanned === 1 ? '' : 's'} have valid lowercase vehicleType values and matching allowedServices.
            </span>
          </div>
        ) : (
          <div className="border border-gray-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
            <div className="px-4 py-2.5 bg-amber-50/70 dark:bg-amber-950/30 border-b border-gray-200 dark:border-zinc-800 flex items-center justify-between text-xs">
              <span className="font-bold text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                Found {rows.length} driver{rows.length === 1 ? '' : 's'} needing normalization (out of {totalScanned} scanned)
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 dark:bg-zinc-850/60 uppercase font-bold text-gray-500 dark:text-zinc-400 border-b border-gray-200 dark:border-zinc-800">
                  <tr>
                    <th className="px-4 py-3">Driver</th>
                    <th className="px-4 py-3">Current</th>
                    <th className="px-4 py-3">Issues Detected</th>
                    <th className="px-4 py-3">Proposed Fix</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
                  {rows.map((row) => (
                    <tr key={row.riderId} className="hover:bg-gray-50/70 dark:hover:bg-zinc-800/40 align-top">
                      <td className="px-4 py-3">
                        <div className="font-bold text-gray-900 dark:text-white">{row.name}</div>
                        <div className="text-[10px] font-mono text-gray-400">
                          {row.riderCode} · {row.riderId}
                        </div>
                      </td>
                      <td className="px-4 py-3 space-y-1">
                        <div>
                          <span className="text-[10px] font-bold uppercase text-gray-400 mr-1">vehicleType:</span>
                          <code className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300">
                            {row.rawVehicleType === undefined || row.rawVehicleType === null || row.rawVehicleType === ''
                              ? '(empty)'
                              : String(row.rawVehicleType)}
                          </code>
                        </div>
                        <div>
                          <span className="text-[10px] font-bold uppercase text-gray-400 mr-1">allowedServices:</span>
                          <code className="font-mono text-[11px] text-gray-700 dark:text-zinc-300 break-all">
                            {Array.isArray(row.rawAllowedServices)
                              ? row.rawAllowedServices.length > 0
                                ? `[${row.rawAllowedServices.join(', ')}]`
                                : '[]'
                              : '(missing / not array)'}
                          </code>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <ul className="space-y-1">
                          {row.reasons.map((r, idx) => (
                            <li
                              key={idx}
                              className="text-[11px] font-semibold text-amber-800 dark:text-amber-300"
                            >
                              • {r}
                            </li>
                          ))}
                        </ul>
                      </td>
                      <td className="px-4 py-3 space-y-1">
                        <div>
                          <span className="text-[10px] font-bold uppercase text-gray-400 mr-1">vehicleType:</span>
                          <code className="font-mono text-[11px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300">
                            {row.proposedVehicleType}
                          </code>
                          <span className="text-[10px] text-gray-400 ml-1">
                            ({VEHICLE_LABELS[row.proposedVehicleType]})
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] font-bold uppercase text-gray-400 mr-1">allowedServices:</span>
                          <code className="font-mono text-[11px] font-bold text-emerald-700 dark:text-emerald-300 break-all">
                            [{row.proposedAllowedServices.join(', ')}]
                          </code>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      {resultMessage && (
        <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 text-xs font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{resultMessage}</span>
        </div>
      )}

      {confirmOpen && (
        <ConfirmationModal
          isOpen={confirmOpen}
          onClose={() => !applying && setConfirmOpen(false)}
          onConfirm={handleApplyFixes}
          title={`Fix ${rows.length} driver profile${rows.length === 1 ? '' : 's'}?`}
          message={`This will update ${rows.length} document(s) in riders with lowercase vehicleType (motorcycle, tricycle, car4, car8), enforce the vehicle rule on allowedServices and activeServices, and record an auditLogs entry.`}
          confirmLabel={applying ? 'Applying...' : `Confirm & Fix (${rows.length})`}
          reasonRequired={false}
          isDestructive={false}
        />
      )}
    </div>
  );
};
