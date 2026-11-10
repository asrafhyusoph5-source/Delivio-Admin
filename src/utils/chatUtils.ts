import type { Order } from '../types';

/**
 * A chat is "open" while the order status is NOT Delivered, Completed, Cancelled, or Rejected (case-insensitive).
 */
export function isOrderChatOpen(orderStatus?: string): boolean {
  if (!orderStatus) return true;
  const s = orderStatus.trim().toLowerCase();
  return s !== 'delivered' && s !== 'completed' && s !== 'cancelled' && s !== 'rejected';
}

/**
 * Hide the whole chat 24 hours after the order closed (use the final status time from statusHistory, otherwise updatedAt).
 */
export function isOrderChatDeletedAfter24h(order?: Order | null): boolean {
  if (!order) return false;
  if (isOrderChatOpen(order.status)) return false;

  // Order is closed. Check when it reached final status:
  let closedTimeMs: number | null = null;

  if (Array.isArray(order.statusHistory) && order.statusHistory.length > 0) {
    // Find latest terminal status entry
    for (let i = order.statusHistory.length - 1; i >= 0; i--) {
      const entry = order.statusHistory[i];
      const s = (entry.status || '').trim().toLowerCase();
      if (s === 'delivered' || s === 'completed' || s === 'cancelled' || s === 'rejected') {
        if (entry.at) {
          closedTimeMs = entry.at.toMillis ? entry.at.toMillis() : new Date(entry.at).getTime();
          break;
        }
      }
    }
  }

  if (!closedTimeMs && order.updatedAt) {
    closedTimeMs = order.updatedAt.toMillis ? order.updatedAt.toMillis() : new Date(order.updatedAt).getTime();
  }

  if (!closedTimeMs && order.createdAt) {
    closedTimeMs = order.createdAt.toMillis ? order.createdAt.toMillis() : new Date(order.createdAt).getTime();
  }

  if (!closedTimeMs) return false;

  const nowMs = Date.now();
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
  return nowMs - closedTimeMs > TWENTY_FOUR_HOURS;
}

/**
 * Formats expireAt timestamp into "Nov 19, 2026, 6:12 PM"
 */
export function formatExpireAtDate(expireAt: any): string {
  if (!expireAt) return 'in 10 days';
  try {
    const d = expireAt.toDate ? expireAt.toDate() : new Date(expireAt);
    if (isNaN(d.getTime())) return 'in 10 days';
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  } catch {
    return 'in 10 days';
  }
}

/**
 * Formats message timestamp cleanly
 */
export function formatMessageTime(timestamp: any): string {
  if (!timestamp) return '';
  try {
    const d = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    const isToday =
      d.getDate() === now.getDate() &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear();

    if (isToday) {
      return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    }
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  } catch {
    return '';
  }
}

/**
 * Resize image according to CHAT DATA CONTRACT:
 * Longest side 1024px, JPEG quality 60, target 250 KB or less;
 * if still over 350 KB reduce quality again.
 */
export async function resizePhotoForChat(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('Failed to load image for resizing'));
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        const maxSide = 1024;

        if (width > maxSide || height > maxSide) {
          if (width > height) {
            height = Math.round((height * maxSide) / width);
            width = maxSide;
          } else {
            width = Math.round((width * maxSide) / height);
            height = maxSide;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to create canvas context'));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);

        let quality = 0.6;
        let dataUri = canvas.toDataURL('image/jpeg', quality);

        // If dataUri > 350KB (approx 470,000 base64 chars), reduce quality
        if (dataUri.length > 350000) {
          quality = 0.45;
          dataUri = canvas.toDataURL('image/jpeg', quality);
        }
        if (dataUri.length > 380000) {
          quality = 0.35;
          dataUri = canvas.toDataURL('image/jpeg', quality);
        }

        resolve(dataUri);
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
}
