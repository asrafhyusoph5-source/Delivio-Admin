import {
  db,
  collection,
  doc,
  runTransaction,
  arrayUnion,
  increment
} from '../firebase';
import { nowTs, arrayNowTs } from './date';
import type { Merchant, OrderServiceType } from '../types';

export type OrderReleaseMode = 'cr_cancellation' | 'close_restaurant' | 'redispatch';

/**
 * Returns the exact status an order returns to when released from a rider before pickup
 * per contract:
 * - "Placed Order" for parcel, pabili, taxi, instant (request_rider)
 * - Unchanged "Preparing" or "Ready" for food and convenience (defaults to "Ready" if isReady else "Preparing")
 */
export function getPreRiderOrderStatus(orderData: {
  serviceType?: OrderServiceType | string;
  status?: string;
  isReady?: boolean;
}): string {
  const svc = String(orderData.serviceType || 'food').toLowerCase();
  if (svc === 'parcel' || svc === 'pabili' || svc === 'taxi' || svc === 'request_rider') {
    return 'Placed Order';
  }
  const current = String(orderData.status || '');
  if (current === 'Preparing' || current === 'Ready') {
    return current;
  }
  return orderData.isReady ? 'Ready' : 'Preparing';
}

/**
 * Releases an order from a rider in a single Firestore transaction per CONTRACT:
 * - sets riderId, riderName, riderPhone, riderPhotoUrl, riderStep, riderVehicle, and batchId to null
 * - sets status back to the status before the rider
 * - adds riderId to excludeRiderIds (arrayUnion)
 * - sets onHold / holdReason / holdReportId according to mode
 */
export async function releaseOrderFromRiderTransaction(params: {
  orderId: string;
  riderId?: string | null;
  mode: OrderReleaseMode;
  holdReportId?: string | null;
  historyNote: string;
}): Promise<{ previousStatus: string; restoredStatus: string; orderData: Record<string, any> }> {
  const { orderId, riderId, mode, holdReportId, historyNote } = params;
  const orderRef = doc(db, 'orders', orderId);
  const now = nowTs();
  const histAt = arrayNowTs();

  return runTransaction(db, async (transaction) => {
    const orderSnap = await transaction.get(orderRef);
    if (!orderSnap.exists()) {
      throw new Error(`Order "${orderId}" not found.`);
    }
    const orderData = orderSnap.data() || {};
    const previousStatus = String(orderData.status || 'Placed Order');
    const restoredStatus = getPreRiderOrderStatus(orderData);
    const svc = String(orderData.serviceType || 'food').toLowerCase();

    const updatePayload: Record<string, any> = {
      riderId: null,
      riderName: null,
      riderPhone: null,
      riderPhotoUrl: null,
      riderStep: null,
      riderVehicle: null,
      batchId: null,
      status: restoredStatus,
      updatedAt: now
    };

    if (riderId) {
      updatePayload.excludeRiderIds = arrayUnion(riderId);
    }

    if (mode === 'close_restaurant') {
      updatePayload.onHold = true;
      updatePayload.holdReason = 'close_restaurant';
      updatePayload.holdReportId = holdReportId || null;
    } else {
      updatePayload.onHold = false;
      updatePayload.holdReason = null;
      updatePayload.holdReportId = null;
      if (svc === 'request_rider' && orderData.riderRequest) {
        updatePayload['riderRequest.status'] = 'Searching';
      }
    }

    if (historyNote) {
      updatePayload.statusHistory = arrayUnion({
        status: restoredStatus,
        at: histAt,
        note: historyNote
      });
    }

    transaction.update(orderRef, updatePayload);
    return { previousStatus, restoredStatus, orderData };
  });
}

/**
 * Shared admin cancel + wallet refund transaction (matches LiveOrders handleCancelOrder).
 * Also clears any onHold / holdReason / holdReportId flags on the order.
 */
export async function cancelOrderWithRefundTransaction(params: {
  orderId: string;
  cancelReason: string;
  cancelFault: 'customer' | 'merchant' | 'rider' | 'platform';
  refundToWallet: boolean;
  adminUid: string;
  adminName: string;
}): Promise<{
  refunded: boolean;
  refundAmount: number;
  orderNumber: string;
  previousStatus: string;
}> {
  const { orderId, cancelReason, cancelFault, refundToWallet, adminUid, adminName } = params;
  const orderRef = doc(db, 'orders', orderId);
  const now = nowTs();
  const histAt = arrayNowTs();

  return runTransaction(db, async (transaction) => {
    const orderSnap = await transaction.get(orderRef);
    if (!orderSnap.exists()) {
      throw new Error(`Order "${orderId}" not found.`);
    }
    const orderData = orderSnap.data() || {};
    const previousStatus = String(orderData.status || '');
    const orderNumber = String(orderData.orderNumber || orderId.substring(0, 8).toUpperCase());
    const customerId = String(orderData.customerId || '');
    const methodLower = String(
      orderData.paymentMethod || orderData.payment?.method || ''
    ).toLowerCase();
    const willRefund = refundToWallet && methodLower === 'wallet' && !orderData.walletRefunded;
    const refundAmount = Number(orderData.fees?.total ?? orderData.amount ?? 0);

    if (willRefund && customerId) {
      const userRef = doc(db, 'users', customerId);
      const userSnap = await transaction.get(userRef);
      const currentBal = userSnap.exists() ? Number(userSnap.data()?.walletBalance || 0) : 0;
      const newBal = currentBal + refundAmount;

      transaction.update(orderRef, {
        status: 'Cancelled',
        cancelReason,
        cancelFault,
        cancelledBy: 'admin',
        cancelledAt: now,
        onHold: false,
        holdReason: null,
        holdReportId: null,
        walletRefunded: true,
        paymentStatus: 'Refunded',
        refundedAt: now,
        walletRefundedAt: now,
        statusHistory: arrayUnion({
          status: 'Cancelled',
          at: histAt,
          note: `Cancelled by Admin (${adminName}): ${cancelReason} (Fault: ${cancelFault}). Refunded ₱${refundAmount.toFixed(2)} to customer wallet.`
        }),
        updatedAt: now
      });

      if (userSnap.exists()) {
        transaction.update(userRef, {
          walletBalance: increment(refundAmount),
          updatedAt: now
        });
      } else {
        transaction.set(
          userRef,
          {
            walletBalance: refundAmount,
            updatedAt: now
          },
          { merge: true }
        );
      }

      const txnRef = doc(collection(db, 'walletTransactions'));
      transaction.set(txnRef, {
        customerId,
        orderId,
        orderNumber,
        type: 'refund',
        amount: refundAmount,
        note: `Refund for cancelled order #${orderNumber}`,
        reason: cancelReason,
        adminId: adminUid,
        adminName,
        balanceAfter: newBal,
        refundedAt: now,
        createdAt: now
      });

      return { refunded: true, refundAmount, orderNumber, previousStatus };
    }

    transaction.update(orderRef, {
      status: 'Cancelled',
      cancelReason,
      cancelFault,
      cancelledBy: 'admin',
      cancelledAt: now,
      onHold: false,
      holdReason: null,
      holdReportId: null,
      statusHistory: arrayUnion({
        status: 'Cancelled',
        at: histAt,
        note: `Cancelled by Admin (${adminName}): ${cancelReason} (Fault: ${cancelFault})`
      }),
      updatedAt: now
    });

    return { refunded: false, refundAmount: 0, orderNumber, previousStatus };
  });
}

/**
 * Mirrors Merchants.tsx getNextOpeningDate so manual force close from Rider Reports
 * sets closedUntil identically to Merchants page manual close.
 */
export function computeNextMerchantOpening(
  shop?: Partial<Merchant> | null,
  platformTimezone: string = 'Asia/Manila'
): { date: Date; isoString: string; displayString: string } {
  const fallbackISO = '2100-01-01T00:00:00.000Z';
  const fallbackDate = new Date(fallbackISO);
  const fallbackDisplay = 'until reopened';

  if (!shop || !shop.autoSchedule || !shop.hours) {
    return { date: fallbackDate, isoString: fallbackISO, displayString: fallbackDisplay };
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

  const todaySchedule = shop.hours[currentDayName];
  if (
    todaySchedule &&
    !todaySchedule.closed &&
    todaySchedule.isOpen !== false &&
    todaySchedule.open &&
    currentTimeStr < todaySchedule.open
  ) {
    const iso = `${String(currentYear).padStart(4, '0')}-${String(currentMonth).padStart(2, '0')}-${String(currentDayOfMonth).padStart(2, '0')}T${todaySchedule.open}:00+08:00`;
    const parsed = new Date(iso);
    return {
      date: isNaN(parsed.getTime()) ? fallbackDate : parsed,
      isoString: iso,
      displayString: `Today at ${todaySchedule.open}`
    };
  }

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
      const parsed = new Date(iso);
      const capitalizedDay = nextDayName.charAt(0).toUpperCase() + nextDayName.slice(1);
      return {
        date: isNaN(parsed.getTime()) ? fallbackDate : parsed,
        isoString: iso,
        displayString: offset === 1 ? `Tomorrow at ${sched.open}` : `${capitalizedDay} at ${sched.open}`
      };
    }
  }

  return { date: fallbackDate, isoString: fallbackISO, displayString: fallbackDisplay };
}
