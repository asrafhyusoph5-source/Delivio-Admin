/**
 * Utility for Delivio Admin Order Numbers:
 * Rule: Show "#<orderNumber>" (fallback: "#" plus the last 6 characters of the document ID)
 * everywhere an order ID appears, including search by order number.
 */

export interface OrderNumberLike {
  orderNumber?: string | number | null;
  id?: string | null;
}

/**
 * Returns formatted order number string e.g. "#10294" or "#d3a9f1"
 */
export function formatOrderNumber(order?: OrderNumberLike | string | null): string {
  if (!order) return '#------';
  if (typeof order === 'string') {
    const clean = order.trim().replace(/^#+/, '');
    if (!clean) return '#------';
    return `#${clean}`;
  }
  const num = order.orderNumber !== undefined && order.orderNumber !== null ? String(order.orderNumber).trim() : '';
  if (num) {
    return `#${num.replace(/^#+/, '')}`;
  }
  if (order.id) {
    const idStr = String(order.id).trim().replace(/^#+/, '');
    const fallback = idStr.length > 6 ? idStr.slice(-6) : idStr;
    return `#${fallback}`;
  }
  return '#------';
}

/**
 * Checks whether an order matches a search query by order number, full doc ID, or 6-char fallback
 */
export function matchesOrderSearch(order: OrderNumberLike, queryText: string): boolean {
  if (!queryText) return true;
  const q = queryText.toLowerCase().trim().replace(/^#+/, '');
  if (!q) return true;

  const num = String(order.orderNumber || '').toLowerCase().replace(/^#+/, '');
  const id = String(order.id || '').toLowerCase().replace(/^#+/, '');
  const idLast6 = id.length > 6 ? id.slice(-6) : id;

  return num.includes(q) || id.includes(q) || idLast6.includes(q);
}
