import { db, doc, getDoc, setDoc, Timestamp } from '../firebase';
import type { MainCategoryItem, MainCategoriesDoc } from '../types';

const ASSET_BASE =
  'https://raw.githubusercontent.com/asrafhyusoph5-source/Delivio-Assets/main';

export const DEFAULT_FOOD_CATEGORIES: MainCategoryItem[] = [
  {
    id: 'dessert',
    name: 'Dessert',
    imageUrl: `${ASSET_BASE}/cat_dessert.png`,
    sortOrder: 0,
    active: true,
    aliases: []
  },
  {
    id: 'burgers',
    name: 'Burgers',
    imageUrl: `${ASSET_BASE}/cat_burgers.png`,
    sortOrder: 1,
    active: true,
    aliases: []
  },
  {
    id: 'pizza',
    name: 'Pizza',
    imageUrl: `${ASSET_BASE}/cat_pizza.png`,
    sortOrder: 2,
    active: true,
    aliases: []
  },
  {
    id: 'chicken',
    name: 'Chicken',
    imageUrl: `${ASSET_BASE}/cat_chicken.png`,
    sortOrder: 3,
    active: true,
    aliases: []
  },
  {
    id: 'drinks',
    name: 'Drinks',
    imageUrl: `${ASSET_BASE}/cat_drinks.png`,
    sortOrder: 4,
    active: true,
    aliases: []
  },
  {
    id: 'others',
    name: 'Others',
    imageUrl: `${ASSET_BASE}/cat_others.png`,
    sortOrder: 5,
    active: true,
    aliases: []
  }
];

export const DEFAULT_CONVENIENCE_CATEGORIES: MainCategoryItem[] = [
  {
    id: 'grocery-stores',
    name: 'Grocery Stores',
    imageUrl: `${ASSET_BASE}/cat_grocery.png`,
    sortOrder: 0,
    active: true,
    aliases: []
  },
  {
    id: 'pharmacies',
    name: 'Pharmacies',
    imageUrl: `${ASSET_BASE}/cat_pharmacies.png`,
    sortOrder: 1,
    active: true,
    aliases: []
  },
  {
    id: 'convenience-stores',
    name: 'Convenience Stores',
    imageUrl: `${ASSET_BASE}/cat_convenience_stores.png`,
    sortOrder: 2,
    active: true,
    aliases: []
  },
  {
    id: 'school-supplies',
    name: 'School Supplies',
    imageUrl: `${ASSET_BASE}/cat_school_supplies.png`,
    sortOrder: 3,
    active: true,
    aliases: []
  },
  {
    id: 'flowers',
    name: 'Flowers',
    imageUrl: `${ASSET_BASE}/cat_flowers.png`,
    sortOrder: 4,
    active: true,
    aliases: []
  },
  {
    id: 'pet-supplies',
    name: 'Pet Supplies',
    imageUrl: `${ASSET_BASE}/cat_pet_supplies.png`,
    sortOrder: 5,
    active: true,
    aliases: []
  },
  {
    id: 'beauty',
    name: 'Beauty',
    imageUrl: `${ASSET_BASE}/cat_beauty.png`,
    sortOrder: 6,
    active: true,
    aliases: []
  },
  {
    id: 'fresh-frozen',
    name: 'Fresh & Frozen',
    imageUrl: `${ASSET_BASE}/cat_fresh_frozen.png`,
    sortOrder: 7,
    active: true,
    aliases: []
  },
  {
    id: 'electronics',
    name: 'Electronics',
    imageUrl: `${ASSET_BASE}/cat_electronics.png`,
    sortOrder: 8,
    active: true,
    aliases: []
  },
  {
    id: 'others',
    name: 'Others',
    imageUrl: `${ASSET_BASE}/cat_others.png`,
    sortOrder: 9,
    active: true,
    aliases: []
  }
];

export const MAX_CATEGORIES_PER_GROUP = 24;

export function isOthersCategory(cat: Pick<MainCategoryItem, 'id' | 'name'>): boolean {
  return (
    cat.id.toLowerCase() === 'others' ||
    cat.name.trim().toLowerCase() === 'others'
  );
}

/**
 * Ensures "Others" exists, is active, is pinned last, and all items have sequential sortOrder (0..n-1).
 */
export function normalizeCategoryList(
  items: MainCategoryItem[],
  fallbackDefaults: MainCategoryItem[]
): MainCategoryItem[] {
  const source = Array.isArray(items) && items.length > 0 ? items : fallbackDefaults;
  const nonOthers: MainCategoryItem[] = [];
  let othersCat: MainCategoryItem | null = null;

  const sorted = [...source].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  sorted.forEach((item) => {
    const clean: MainCategoryItem = {
      id: String(item.id || '').trim() || slugifyCategoryName(item.name || 'category', []),
      name: String(item.name || '').trim() || 'Category',
      imageUrl: String(item.imageUrl || '').trim(),
      sortOrder: Number(item.sortOrder ?? 0),
      active: item.active !== false,
      aliases: Array.isArray(item.aliases)
        ? Array.from(new Set(item.aliases.map((a) => String(a).trim()).filter(Boolean)))
        : []
    };

    if (isOthersCategory(clean)) {
      othersCat = {
        ...clean,
        id: 'others',
        name: 'Others',
        active: true
      };
    } else {
      nonOthers.push(clean);
    }
  });

  if (!othersCat) {
    const defaultOthers =
      fallbackDefaults.find((d) => isOthersCategory(d)) || {
        id: 'others',
        name: 'Others',
        imageUrl: `${ASSET_BASE}/cat_others.png`,
        sortOrder: nonOthers.length,
        active: true,
        aliases: []
      };
    othersCat = { ...defaultOthers, aliases: [...(defaultOthers.aliases || [])] };
  }

  const combined = [...nonOthers, othersCat];
  return combined.map((c, idx) => ({
    ...c,
    sortOrder: idx
  }));
}

export function slugifyCategoryName(name: string, existingIds: string[]): string {
  const base =
    name
      .toLowerCase()
      .trim()
      .replace(/&/g, ' ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'category';

  if (!existingIds.includes(base)) return base;
  let counter = 2;
  while (existingIds.includes(`${base}-${counter}`)) {
    counter++;
  }
  return `${base}-${counter}`;
}

export function getDefaultMainCategoriesDoc(updatedBy?: string): MainCategoriesDoc {
  return {
    food: DEFAULT_FOOD_CATEGORIES.map((c) => ({ ...c, aliases: [...c.aliases] })),
    convenience: DEFAULT_CONVENIENCE_CATEGORIES.map((c) => ({ ...c, aliases: [...c.aliases] })),
    updatedAt: Timestamp.now(),
    updatedBy: updatedBy || 'System'
  };
}

/**
 * Loads settings/mainCategories from Firestore.
 * If the document does not exist, creates it from defaults on first open and returns it.
 */
export async function loadOrInitMainCategories(
  updatedBy?: string,
  createIfMissing: boolean = true
): Promise<{ data: MainCategoriesDoc; created: boolean }> {
  const docRef = doc(db, 'settings', 'mainCategories');
  const snap = await getDoc(docRef);

  if (!snap.exists()) {
    const defaults = getDefaultMainCategoriesDoc(updatedBy);
    if (createIfMissing) {
      await setDoc(docRef, defaults);
    }
    return { data: defaults, created: createIfMissing };
  }

  const raw = snap.data();
  const food = normalizeCategoryList(raw.food || [], DEFAULT_FOOD_CATEGORIES);
  const convenience = normalizeCategoryList(
    raw.convenience || [],
    DEFAULT_CONVENIENCE_CATEGORIES
  );

  return {
    data: {
      food,
      convenience,
      updatedAt: raw.updatedAt,
      updatedBy: raw.updatedBy
    },
    created: false
  };
}

/**
 * Normalizes a category name, id, or alias for comparison: lowercase, trim, collapse spaces.
 */
export function normalizeCategoryMatchKey(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Checks if a tag or value matches a given category (by id, name, or aliases).
 */
export function categoryMatchesTag(cat: MainCategoryItem, tag: string): boolean {
  const cleanTag = normalizeCategoryMatchKey(tag);
  if (!cleanTag) return false;
  if (normalizeCategoryMatchKey(cat.id) === cleanTag) return true;
  if (normalizeCategoryMatchKey(cat.name) === cleanTag) return true;
  if (Array.isArray(cat.aliases)) {
    return cat.aliases.some((al) => normalizeCategoryMatchKey(al) === cleanTag);
  }
  return false;
}

/**
 * Checks whether a merchant has any tag matching a specific category.
 */
export function merchantUsesCategory(
  cuisineTags: string[] | undefined,
  cat: MainCategoryItem
): boolean {
  if (!Array.isArray(cuisineTags) || cuisineTags.length === 0) return false;
  return cuisineTags.some((tag) => categoryMatchesTag(cat, tag));
}

/**
 * Resolves a merchant's stored cuisineTags against active categories of its type.
 * Returns the matched canonical category names (or ['Others'] if none match).
 */
export function resolveMerchantActiveCategories(
  cuisineTags: string[] | undefined,
  groupCategories: MainCategoryItem[]
): { matchedNames: string[]; isFallbackOthers: boolean } {
  const activeCats = groupCategories.filter((c) => c.active !== false);
  const tags = Array.isArray(cuisineTags) ? cuisineTags : [];

  const matched = new Set<string>();
  tags.forEach((tag) => {
    const found = activeCats.find((c) => categoryMatchesTag(c, tag));
    if (found) {
      matched.add(found.name);
    }
  });

  if (matched.size === 0) {
    return { matchedNames: [], isFallbackOthers: true };
  }

  return { matchedNames: Array.from(matched), isFallbackOthers: false };
}

/**
 * Returns active categories for a shop's type in App Designer sortOrder with "Others" last.
 */
export function getActiveMainCategoriesForType(
  categoriesDoc: MainCategoriesDoc,
  type: 'food' | 'convenience'
): MainCategoryItem[] {
  const fallbackDefaults =
    type === 'convenience' ? DEFAULT_CONVENIENCE_CATEGORIES : DEFAULT_FOOD_CATEGORIES;
  const rawList =
    type === 'convenience' ? categoriesDoc.convenience : categoriesDoc.food;
  const normalized = normalizeCategoryList(rawList, fallbackDefaults);
  return normalized.filter((c) => c.active !== false);
}

/**
 * Finds an active category matching rawValue by normalized id, name, or aliases.
 */
export function findMatchingActiveCategory(
  rawValue: unknown,
  activeCategories: MainCategoryItem[]
): MainCategoryItem | null {
  const key = normalizeCategoryMatchKey(rawValue);
  if (!key) return null;
  return activeCategories.find((cat) => categoryMatchesTag(cat, key)) || null;
}

/**
 * Resolves an item's category / categoryId against active categories of the shop's type.
 * Unmatched items fall back to "Others" while preserving the old value for display.
 */
export function resolveItemMainCategory(
  item: { category?: unknown; categoryId?: unknown },
  activeCategories: MainCategoryItem[]
): {
  matched: boolean;
  category: MainCategoryItem;
  rawOldValue: string;
} {
  const rawCategory = typeof item.category === 'string' ? item.category.trim() : '';
  const rawCategoryId = typeof item.categoryId === 'string' ? item.categoryId.trim() : '';
  const rawOldValue = rawCategory || rawCategoryId;

  const matchedCat =
    findMatchingActiveCategory(rawCategoryId, activeCategories) ||
    findMatchingActiveCategory(rawCategory, activeCategories);

  const othersCategory =
    activeCategories.find((c) => isOthersCategory(c)) || {
      id: 'others',
      name: 'Others',
      imageUrl: `${ASSET_BASE}/cat_others.png`,
      sortOrder: activeCategories.length,
      active: true,
      aliases: []
    };

  return {
    matched: Boolean(matchedCat),
    category: matchedCat || othersCategory,
    rawOldValue
  };
}

