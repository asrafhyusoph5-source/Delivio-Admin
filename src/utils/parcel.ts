import type { Order, OrderStatus, ParcelVehicleType } from '../types';

export const PARCEL_STATUS_ORDER: OrderStatus[] = [
  'Placed Order',
  'Rider is on the way to sender',
  'Arrived at sender',
  'Rider is on the way to recipient',
  'Arrived at recipient',
  'Delivered'
];

/**
 * Parcel status progression is strictly forward-only, one step at a time.
 * Returns the immediate next status in PARCEL_STATUS_ORDER, or null if none applies.
 */
export function getNextParcelStatus(currentStatus?: string | null): OrderStatus | null {
  if (!currentStatus) return PARCEL_STATUS_ORDER[0];
  const idx = PARCEL_STATUS_ORDER.indexOf(currentStatus as OrderStatus);
  if (idx === -1) return null;
  if (idx >= PARCEL_STATUS_ORDER.length - 1) return null;
  return PARCEL_STATUS_ORDER[idx + 1];
}

export function normalizeParcelVehicle(raw?: string | null): ParcelVehicleType {
  const val = String(raw || '').trim().toLowerCase();
  if (
    val === 'sedan' ||
    val === 'car' ||
    val === 'car4' ||
    val === 'car8' ||
    val === '4-seater car' ||
    val === '8-seater car'
  ) {
    return 'sedan';
  }
  return 'motorcycle';
}

export function getParcelVehicleLabel(raw?: string | null): string {
  return normalizeParcelVehicle(raw) === 'sedan' ? 'Sedan' : 'Motorcycle';
}

export function isRiderVehicleEligibleForParcel(
  riderVehicleRaw: string | null | undefined,
  orderVehicleRaw: string | null | undefined
): boolean {
  const orderVehicle = normalizeParcelVehicle(orderVehicleRaw);
  const riderVal = String(riderVehicleRaw || '').trim().toLowerCase();
  if (orderVehicle === 'sedan') {
    return (
      riderVal === 'car4' ||
      riderVal === 'car8' ||
      riderVal === 'car' ||
      riderVal === 'van' ||
      riderVal === '4-seater car' ||
      riderVal === '8-seater car' ||
      riderVal === 'sedan'
    );
  }
  return riderVal === 'motorcycle' || riderVal === 'motorbike' || riderVal === 'motor';
}

export function getParcelFeePayer(order: Partial<Order>): 'sender' | 'recipient' | null {
  const raw = String(order.feePayer || order.parcel?.feePayer || '').trim().toLowerCase();
  if (raw === 'sender') return 'sender';
  if (raw === 'recipient') return 'recipient';
  return null;
}

export function isCashlessOrderPayment(order: Partial<Order>): boolean {
  const method = String(order.paymentMethod || order.payment?.method || 'cod')
    .trim()
    .toLowerCase();
  return method === 'wallet' || method === 'online';
}

export interface ParcelCashRuleSummary {
  isCashless: boolean;
  paymentMethod: string;
  feePayer: 'sender' | 'recipient' | null;
  cashToCollect: number;
  expectedStage: 'pickup' | 'dropoff' | null;
  pickupStepLabel: string;
  dropoffStepLabel: string;
  collectedAmount: number;
  isCollected: boolean;
  collectedStage: 'pickup' | 'dropoff' | null;
}

export function getOrderCashCollectedAmount(order: Partial<Order>): number {
  if (isCashlessOrderPayment(order)) return 0;

  if (typeof order.codCollected === 'number' && order.codCollected > 0) {
    return Number(order.codCollected);
  }

  if (typeof order.cashCollected === 'number' && order.cashCollected > 0) {
    return Number(order.cashCollected);
  }

  const stage = String(order.cashCollectedStage || '').trim().toLowerCase();
  const hasStageCollection =
    (stage === 'pickup' || stage === 'dropoff') && order.cashCollected !== false;

  if (order.cashCollected === true || hasStageCollection) {
    return Math.max(0, Number(order.cashToCollect ?? order.codAmount ?? order.fees?.total ?? 0));
  }

  return 0;
}

export function getParcelCashRuleSummary(order: Partial<Order>): ParcelCashRuleSummary {
  const method = String(order.paymentMethod || order.payment?.method || 'cod')
    .trim()
    .toLowerCase();
  const isCashless = isCashlessOrderPayment(order);
  const feePayer = getParcelFeePayer(order);
  const cashToCollect = isCashless
    ? 0
    : Math.max(0, Number(order.cashToCollect ?? order.codAmount ?? order.fees?.total ?? 0));

  const rawStage = String(order.cashCollectedStage || '').trim().toLowerCase();
  const collectedStage: 'pickup' | 'dropoff' | null =
    rawStage === 'pickup' ? 'pickup' : rawStage === 'dropoff' ? 'dropoff' : null;
  const collectedAmount = getOrderCashCollectedAmount(order);
  const isCollected = !isCashless && (collectedAmount > 0 || order.cashCollected === true);

  if (isCashless) {
    return {
      isCashless: true,
      paymentMethod: method,
      feePayer,
      cashToCollect: 0,
      expectedStage: null,
      pickupStepLabel: 'No Cash Collected',
      dropoffStepLabel: 'No Cash Collected',
      collectedAmount: 0,
      isCollected: false,
      collectedStage: null
    };
  }

  if (feePayer === 'recipient') {
    return {
      isCashless: false,
      paymentMethod: method,
      feePayer: 'recipient',
      cashToCollect,
      expectedStage: 'dropoff',
      pickupStepLabel: 'No Cash Collected',
      dropoffStepLabel: `Collect ₱${cashToCollect.toFixed(2)} at DROP-OFF`,
      collectedAmount,
      isCollected,
      collectedStage: collectedStage || (isCollected ? 'dropoff' : null)
    };
  }

  return {
    isCashless: false,
    paymentMethod: method,
    feePayer: feePayer || 'sender',
    cashToCollect,
    expectedStage: 'pickup',
    pickupStepLabel: `Collect ₱${cashToCollect.toFixed(2)} at PICKUP`,
    dropoffStepLabel: 'No Cash Collected',
    collectedAmount,
    isCollected,
    collectedStage: collectedStage || (isCollected ? 'pickup' : null)
  };
}
