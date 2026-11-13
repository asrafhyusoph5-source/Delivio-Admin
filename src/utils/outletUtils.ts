import {
  db,
  collection,
  doc,
  getDocs,
  query,
  where,
  writeBatch,
  Timestamp
} from '../firebase';
import type { Merchant, Order } from '../types';

/**
 * Menu matching key per Outlets Data Contract:
 * lowercased, trimmed, with repeated spaces collapsed.
 */
export function normalizeMenuMatchKey(text: string | null | undefined): string {
  return (text || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Normalizes a branch code to uppercase A-Z, 0-9 (max 10 chars).
 */
export function normalizeBranchCode(code: string | null | undefined): string {
  return (code || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 10);
}

export function isValidBranchCode(code: string): boolean {
  return /^[A-Z0-9]{2,10}$/.test(code);
}

export function isValidBranchName(name: string): boolean {
  const len = name.trim().length;
  return len >= 2 && len <= 40;
}

/**
 * Formats shop display name according to contract:
 * - Standard display name: "<name> - <branchName>" (or just name if branchName empty)
 * - With code (admin views): "<name> - <branchName> (CODE)"
 */
export function formatShopDisplayName(
  shop: {
    name?: string | null;
    merchantName?: string | null;
    branchName?: string | null;
    branchCode?: string | null;
  } | null | undefined,
  includeCode: boolean = false
): string {
  if (!shop) return 'Store';
  const baseName = (shop.name || shop.merchantName || 'Store').trim();
  const branchName = (shop.branchName || '').trim();
  const branchCode = (shop.branchCode || '').trim();

  let display = branchName ? `${baseName} - ${branchName}` : baseName;
  if (includeCode && branchCode) {
    display = `${display} (${branchCode})`;
  }
  return display;
}

/**
 * Resolves the display name of an order's merchant using order snapshots first,
 * falling back to the merchants lookup map if needed.
 */
export function resolveOrderMerchantDisplay(
  order: Partial<Order> & { [key: string]: any },
  merchantsById?: Record<string, Merchant>,
  includeCode: boolean = true
): string {
  const merchant = order.merchantId && merchantsById ? merchantsById[order.merchantId] : undefined;
  const name = order.merchantName || merchant?.name || '';
  const branchName = order.branchName ?? merchant?.branchName ?? '';
  const branchCode = order.branchCode ?? merchant?.branchCode ?? '';

  if (!name) return '';
  return formatShopDisplayName(
    { name, branchName, branchCode },
    includeCode
  );
}

/**
 * Resolves chainId from an order snapshot or fallback merchant record.
 */
export function resolveOrderChainId(
  order: Partial<Order> & { [key: string]: any },
  merchantsById?: Record<string, Merchant>
): string | null {
  if (order.chainId) return order.chainId;
  if (order.merchantId && merchantsById) {
    return merchantsById[order.merchantId]?.chainId || null;
  }
  return null;
}

export interface ChainOption {
  chainId: string;
  chainName: string;
  outlets: Merchant[];
  mainShop?: Merchant;
}

/**
 * Extracts distinct chains from the merchants list.
 * A chain exists when merchants have chainId set (and/or 2+ outlets).
 */
export function getChainOptions(merchants: Merchant[]): ChainOption[] {
  const byChain = new Map<string, Merchant[]>();
  merchants.forEach((m) => {
    if (m.chainId) {
      const arr = byChain.get(m.chainId) || [];
      arr.push(m);
      byChain.set(m.chainId, arr);
    }
  });

  const result: ChainOption[] = [];
  byChain.forEach((outlets, chainId) => {
    const sorted = [...outlets].sort((a, b) => {
      const aMain = a.isBranch === false || a.id === chainId ? 0 : 1;
      const bMain = b.isBranch === false || b.id === chainId ? 0 : 1;
      if (aMain !== bMain) return aMain - bMain;
      return (a.branchName || a.name).localeCompare(b.branchName || b.name);
    });
    const mainShop = sorted.find((o) => o.isBranch === false || o.id === chainId) || sorted[0];
    const chainName = mainShop?.chainName || mainShop?.name || 'Chain';
    result.push({
      chainId,
      chainName,
      outlets: sorted,
      mainShop
    });
  });

  return result.sort((a, b) => a.chainName.localeCompare(b.chainName));
}

/**
 * Queries Firestore to check if branchCode is unique inside the given chainId.
 */
export async function checkBranchCodeUniqueInChain(
  chainId: string,
  branchCode: string,
  excludeShopId?: string
): Promise<boolean> {
  const normalized = normalizeBranchCode(branchCode);
  if (!normalized) return false;

  const q = query(
    collection(db, 'merchants'),
    where('chainId', '==', chainId),
    where('branchCode', '==', normalized)
  );
  const snap = await getDocs(q);
  for (const d of snap.docs) {
    if (excludeShopId && d.id === excludeShopId) continue;
    return false;
  }
  return true;
}

/**
 * Copies categories, category classes (subcategories), menu groups (menus),
 * products, and option sets from sourceMerchantId to targetMerchantId
 * using Push Menu matching rules (lowercased, trimmed, collapsed spaces; NOT stock).
 */
export async function copyMerchantMenu(
  sourceMerchantId: string,
  targetMerchantId: string
): Promise<{
  categoriesCopied: number;
  subcategoriesCopied: number;
  menusCopied: number;
  itemsCopied: number;
}> {
  if (!sourceMerchantId || !targetMerchantId || sourceMerchantId === targetMerchantId) {
    return { categoriesCopied: 0, subcategoriesCopied: 0, menusCopied: 0, itemsCopied: 0 };
  }

  const now = Timestamp.now();

  // Fetch source collections
  const [srcCatSnap, srcSubSnap, srcMenuSnap, srcItemSnap] = await Promise.all([
    getDocs(collection(db, 'merchants', sourceMerchantId, 'categories')),
    getDocs(collection(db, 'merchants', sourceMerchantId, 'subcategories')),
    getDocs(collection(db, 'merchants', sourceMerchantId, 'menus')),
    getDocs(collection(db, 'merchants', sourceMerchantId, 'items'))
  ]);

  // Fetch existing target collections (for matching by key if target already has entries)
  const [tgtCatSnap, tgtSubSnap, tgtMenuSnap, tgtItemSnap] = await Promise.all([
    getDocs(collection(db, 'merchants', targetMerchantId, 'categories')),
    getDocs(collection(db, 'merchants', targetMerchantId, 'subcategories')),
    getDocs(collection(db, 'merchants', targetMerchantId, 'menus')),
    getDocs(collection(db, 'merchants', targetMerchantId, 'items'))
  ]);

  // Build batch queue (chunked at 400 writes max per batch)
  const operations: Array<{ ref: any; data: Record<string, any> }> = [];

  // 1. Categories
  const tgtCatByKey = new Map<string, string>();
  tgtCatSnap.forEach((d) => {
    const dt = d.data();
    const k = normalizeMenuMatchKey(dt.name || d.id);
    if (k) tgtCatByKey.set(k, d.id);
  });

  let categoriesCopied = 0;
  srcCatSnap.forEach((d) => {
    const dt = d.data();
    const k = normalizeMenuMatchKey(dt.name || d.id);
    if (!k || tgtCatByKey.has(k)) return;
    const newRef = doc(collection(db, 'merchants', targetMerchantId, 'categories'));
    tgtCatByKey.set(k, newRef.id);
    operations.push({
      ref: newRef,
      data: {
        name: dt.name || d.id,
        sortOrder: typeof dt.sortOrder === 'number' ? dt.sortOrder : 0,
        createdAt: now,
        updatedAt: now
      }
    });
    categoriesCopied++;
  });

  // 2. Category Classes (subcategories)
  const tgtSubByKey = new Map<string, { id: string; name: string }>();
  tgtSubSnap.forEach((d) => {
    const dt = d.data();
    const k = normalizeMenuMatchKey(dt.name);
    if (k) tgtSubByKey.set(k, { id: d.id, name: dt.name || '' });
  });

  const subIdMap = new Map<string, { id: string; name: string }>();
  let subcategoriesCopied = 0;
  srcSubSnap.forEach((d) => {
    const dt = d.data();
    const k = normalizeMenuMatchKey(dt.name);
    const existing = k ? tgtSubByKey.get(k) : undefined;
    if (existing) {
      subIdMap.set(d.id, existing);
      return;
    }
    const newRef = doc(collection(db, 'merchants', targetMerchantId, 'subcategories'));
    const entry = { id: newRef.id, name: (dt.name || '').trim() };
    if (k) tgtSubByKey.set(k, entry);
    subIdMap.set(d.id, entry);
    operations.push({
      ref: newRef,
      data: {
        name: entry.name,
        sortOrder: typeof dt.sortOrder === 'number' ? dt.sortOrder : 0,
        createdAt: now,
        updatedAt: now
      }
    });
    subcategoriesCopied++;
  });

  // 3. Menu Groups (menus)
  const tgtMenuByKey = new Map<string, string>();
  tgtMenuSnap.forEach((d) => {
    const dt = d.data();
    const k = normalizeMenuMatchKey(dt.name);
    if (k) tgtMenuByKey.set(k, d.id);
  });

  const menuIdMap = new Map<string, string>();
  let menusCopied = 0;
  srcMenuSnap.forEach((d) => {
    const dt = d.data();
    const k = normalizeMenuMatchKey(dt.name);
    const existingId = k ? tgtMenuByKey.get(k) : undefined;
    if (existingId) {
      menuIdMap.set(d.id, existingId);
      return;
    }
    const newRef = doc(collection(db, 'merchants', targetMerchantId, 'menus'));
    if (k) tgtMenuByKey.set(k, newRef.id);
    menuIdMap.set(d.id, newRef.id);
    operations.push({
      ref: newRef,
      data: {
        name: (dt.name || 'Menu').trim(),
        active: dt.active !== false,
        sortOrder: typeof dt.sortOrder === 'number' ? dt.sortOrder : 0,
        schedule: dt.schedule || null,
        createdAt: now,
        updatedAt: now
      }
    });
    menusCopied++;
  });

  // 4. Products (items + option sets; NOT stock / out-of-stock state)
  const tgtItemByKey = new Map<string, string>();
  tgtItemSnap.forEach((d) => {
    const dt = d.data();
    const k = normalizeMenuMatchKey(dt.name);
    if (k) tgtItemByKey.set(k, d.id);
  });

  let itemsCopied = 0;
  srcItemSnap.forEach((d) => {
    const dt = d.data();
    const k = normalizeMenuMatchKey(dt.name);
    if (!k) return;

    // Resolve mapped subcategoryId
    let mappedSubId: string | null = null;
    let mappedSubName: string | null = dt.subcategoryName || null;
    if (dt.subcategoryId && subIdMap.has(dt.subcategoryId)) {
      const m = subIdMap.get(dt.subcategoryId)!;
      mappedSubId = m.id;
      mappedSubName = m.name || mappedSubName;
    } else if (dt.subcategoryName) {
      const subMatch = tgtSubByKey.get(normalizeMenuMatchKey(dt.subcategoryName));
      if (subMatch) {
        mappedSubId = subMatch.id;
        mappedSubName = subMatch.name;
      }
    }

    // Resolve mapped menuIds
    const mappedMenuIds: string[] = Array.isArray(dt.menuIds)
      ? dt.menuIds.map((oldId: string) => menuIdMap.get(oldId)).filter(Boolean) as string[]
      : [];

    // Copy option sets cleanly (do not copy out-of-stock state)
    const copiedSets = Array.isArray(dt.sets)
      ? dt.sets.map((s: any, sIdx: number) => {
          const setName =
            (typeof s.name === 'string' && s.name.trim()) ||
            (typeof s.customName === 'string' && s.customName.trim()) ||
            (typeof s.subcategoryName === 'string' && s.subcategoryName.trim()) ||
            'Options';
          return {
            id: s.id || `set_${sIdx}_${Date.now().toString(36)}`,
            name: setName,
            customName: setName,
            subcategoryId: null,
            subcategoryName: null,
            required: Boolean(s.required),
            minSelect: typeof s.minSelect === 'number' ? s.minSelect : s.required ? 1 : 0,
            maxSelect: Math.max(1, Number(s.maxSelect) || 1),
            sortOrder: typeof s.sortOrder === 'number' ? s.sortOrder : sIdx,
            choices: Array.isArray(s.choices)
              ? s.choices.map((c: any, cIdx: number) => ({
                  id: c.id || `c_${sIdx}_${cIdx}_${Date.now().toString(36)}`,
                  name: c.name || 'Choice',
                  price: Math.max(0, Number(c.price) || 0),
                  available: true
                }))
              : []
          };
        })
      : [];

    const existingItemId = tgtItemByKey.get(k);
    const targetItemRef = existingItemId
      ? doc(db, 'merchants', targetMerchantId, 'items', existingItemId)
      : doc(collection(db, 'merchants', targetMerchantId, 'items'));

    const itemPayload: Record<string, any> = {
      name: (dt.name || 'Item').trim(),
      price: Number(dt.price) || 0,
      description: dt.description || '',
      imageUrl: dt.imageUrl || '',
      categoryId: dt.categoryId || null,
      subcategoryId: mappedSubId,
      subcategoryName: mappedSubName,
      customName: dt.customName || null,
      itemSize: dt.itemSize || null,
      availability: dt.availability || null,
      menuIds: mappedMenuIds,
      available: true, // Push Menu does NOT copy out-of-stock state
      hasSets: copiedSets.length > 0,
      sets: copiedSets,
      updatedAt: now
    };
    if (!existingItemId) {
      itemPayload.createdAt = now;
    }

    operations.push({ ref: targetItemRef, data: itemPayload });
    if (!existingItemId) {
      tgtItemByKey.set(k, targetItemRef.id);
    }
    itemsCopied++;
  });

  // Commit in chunks of 400 operations
  for (let i = 0; i < operations.length; i += 400) {
    const chunk = operations.slice(i, i + 400);
    const batch = writeBatch(db);
    chunk.forEach((op) => batch.set(op.ref, op.data, { merge: true }));
    await batch.commit();
  }

  return {
    categoriesCopied,
    subcategoriesCopied,
    menusCopied,
    itemsCopied
  };
}
