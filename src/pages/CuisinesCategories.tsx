import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  db,
  collection,
  getDocs,
  doc,
  getDoc,
  setDoc,
  writeBatch,
  Timestamp
} from '../firebase';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { logAuditEvent } from '../utils/audit';
import type {
  MainCategoryItem,
  MainCategoriesDoc,
  Merchant,
  ConvenienceColumnsCount,
  AppDesignerSettings
} from '../types';
import {
  DEFAULT_FOOD_CATEGORIES,
  DEFAULT_CONVENIENCE_CATEGORIES,
  MAX_CATEGORIES_PER_GROUP,
  isOthersCategory,
  normalizeCategoryList,
  slugifyCategoryName,
  loadOrInitMainCategories,
  merchantUsesCategory,
  categoryMatchesTag
} from '../utils/mainCategories';
import { ConfirmationModal } from '../components/common/ConfirmationModal';
import {
  Utensils,
  ShoppingBag,
  GripVertical,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Lock,
  Loader2,
  Image as ImageIcon,
  ArrowUp,
  ArrowDown,
  X,
  Search,
  MoreHorizontal,
  Smartphone,
  ChevronDown,
  ChevronUp,
  Undo2,
  LayoutGrid,
  Pencil
} from 'lucide-react';

type DesignerTab = 'categories' | 'layout';
type GroupKey = 'food' | 'convenience';
type ImageStatus = 'loading' | 'ok' | 'error';

interface SampleMartProduct {
  id: string;
  name: string;
  size: string;
  price: number;
  salePrice?: number;
  bgClass: string;
  svg: React.ReactNode;
}

const SAMPLE_MART_PRODUCTS: SampleMartProduct[] = [
  {
    id: 'p1',
    name: 'Fresh Full Cream Milk',
    size: '1 L',
    price: 145,
    salePrice: 55, // round((145 - 55) / 145 * 100) = 62 -> -62%
    bgClass: 'bg-sky-50 dark:bg-sky-950/40',
    svg: (
      <svg viewBox="0 0 64 64" className="w-12 h-12" aria-hidden="true">
        <rect x="20" y="16" width="24" height="38" rx="3" fill="#ffffff" stroke="#0284c7" strokeWidth="2.5" />
        <polygon points="20,16 32,7 44,16" fill="#e0f2fe" stroke="#0284c7" strokeWidth="2.5" strokeLinejoin="round" />
        <rect x="24" y="25" width="16" height="14" rx="2" fill="#38bdf8" opacity="0.35" />
        <circle cx="32" cy="32" r="4" fill="#0284c7" />
      </svg>
    )
  },
  {
    id: 'p2',
    name: 'Crunchy Potato Chips',
    size: '160 g',
    price: 88,
    salePrice: 66, // -25%
    bgClass: 'bg-amber-50 dark:bg-amber-950/40',
    svg: (
      <svg viewBox="0 0 64 64" className="w-12 h-12" aria-hidden="true">
        <rect x="18" y="10" width="28" height="44" rx="5" fill="#fbbf24" stroke="#b45309" strokeWidth="2.5" />
        <ellipse cx="32" cy="32" rx="8" ry="10" fill="#fef3c7" stroke="#d97706" strokeWidth="2" />
        <path d="M18 16h28M18 48h28" stroke="#b45309" strokeWidth="2" />
      </svg>
    )
  },
  {
    id: 'p3',
    name: 'Vitamin C + Zinc Caps',
    size: '30 pcs',
    price: 210,
    bgClass: 'bg-orange-50 dark:bg-orange-950/40',
    svg: (
      <svg viewBox="0 0 64 64" className="w-12 h-12" aria-hidden="true">
        <rect x="23" y="10" width="18" height="7" rx="2" fill="#ea580c" />
        <rect x="20" y="17" width="24" height="37" rx="5" fill="#fff7ed" stroke="#ea580c" strokeWidth="2.5" />
        <circle cx="32" cy="35" r="8" fill="#fb923c" />
        <path d="M32 30v10M27 35h10" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    )
  },
  {
    id: 'p4',
    name: 'Sparkling Mineral Water',
    size: '500 ml',
    price: 40,
    salePrice: 28, // -30%
    bgClass: 'bg-cyan-50 dark:bg-cyan-950/40',
    svg: (
      <svg viewBox="0 0 64 64" className="w-12 h-12" aria-hidden="true">
        <rect x="27" y="8" width="10" height="5" rx="1.5" fill="#0891b2" />
        <path d="M25 13h14l3 9v28a4 4 0 0 1-4 4H26a4 4 0 0 1-4-4V22l3-9z" fill="#ecfeff" stroke="#0891b2" strokeWidth="2.5" />
        <rect x="22" y="29" width="20" height="12" fill="#22d3ee" opacity="0.45" />
      </svg>
    )
  },
  {
    id: 'p5',
    name: 'Brioche Loaf Bread',
    size: '400 g',
    price: 95,
    bgClass: 'bg-yellow-50 dark:bg-yellow-950/40',
    svg: (
      <svg viewBox="0 0 64 64" className="w-12 h-12" aria-hidden="true">
        <path d="M14 28c0-9 8-15 18-15s18 6 18 15v19a5 5 0 0 1-5 5H19a5 5 0 0 1-5-5V28z" fill="#fde68a" stroke="#b45309" strokeWidth="2.5" />
        <path d="M22 25c2-4 6-6 10-6M34 25c2-3 5-5 8-5" stroke="#d97706" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    )
  },
  {
    id: 'p6',
    name: 'Dark Chocolate Bar',
    size: '90 g',
    price: 120,
    salePrice: 78, // -35%
    bgClass: 'bg-stone-100 dark:bg-zinc-800',
    svg: (
      <svg viewBox="0 0 64 64" className="w-12 h-12" aria-hidden="true">
        <rect x="17" y="11" width="30" height="42" rx="3" fill="#78350f" stroke="#451a03" strokeWidth="2.5" />
        <path d="M17 25h30M17 39h30M32 11v42" stroke="#92400e" strokeWidth="2" />
      </svg>
    )
  }
];

const parseConvenienceColumns = (val: unknown): ConvenienceColumnsCount => {
  const num = Number(val);
  if (num === 1 || num === 2 || num === 3) return num;
  return 2;
};

const ColumnIllustration: React.FC<{ cols: ConvenienceColumnsCount; selected: boolean }> = ({
  cols,
  selected
}) => {
  const cardBg = selected ? 'bg-amber-400/90 dark:bg-amber-400' : 'bg-gray-200 dark:bg-zinc-700';
  const textBar = selected ? 'bg-amber-300/70 dark:bg-amber-500/60' : 'bg-gray-200 dark:bg-zinc-700';

  const count = cols === 1 ? 2 : cols === 2 ? 4 : 6;
  const gridClass = cols === 1 ? 'grid-cols-1' : cols === 2 ? 'grid-cols-2' : 'grid-cols-3';

  return (
    <div className="w-20 h-20 rounded-xl border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 p-2 flex flex-col justify-center shrink-0">
      <div className={`grid ${gridClass} gap-1.5`}>
        {Array.from({ length: count }).map((_, idx) => (
          <div key={idx} className="space-y-1">
            <div className={`${cols === 1 ? 'h-4' : 'h-4.5'} rounded-xs ${cardBg}`} />
            {cols === 1 && <div className={`h-1.5 w-3/4 rounded-xs ${textBar}`} />}
          </div>
        ))}
      </div>
    </div>
  );
};

export const CuisinesCategories: React.FC = () => {
  const { adminProfile } = useAuth();
  const { showSuccess, showError } = useToast();

  const [activeTab, setActiveTab] = useState<DesignerTab>('categories');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedBanner, setSavedBanner] = useState(false);

  // Categories state
  const [activeGroup, setActiveGroup] = useState<GroupKey>('food');
  const [foodCategories, setFoodCategories] = useState<MainCategoryItem[]>([]);
  const [convenienceCategories, setConvenienceCategories] = useState<MainCategoryItem[]>([]);
  const [persistedDoc, setPersistedDoc] = useState<MainCategoriesDoc | null>(null);
  const [categorySearch, setCategorySearch] = useState('');

  // App layout state (settings/appDesigner)
  const [convenienceColumns, setConvenienceColumns] = useState<ConvenienceColumnsCount>(2);
  const [persistedColumns, setPersistedColumns] = useState<ConvenienceColumnsCount>(2);

  // Merchants for category shop count chips & delete migration
  const [merchants, setMerchants] = useState<Merchant[]>([]);

  // Image load statuses
  const [imageStatuses, setImageStatuses] = useState<Record<string, ImageStatus>>({});

  // Menu & Edit URL panel state
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [editingImageId, setEditingImageId] = useState<string | null>(null);

  // Mobile preview collapse state
  const [mobilePreviewOpen, setMobilePreviewOpen] = useState(false);

  // Alias tracking on name blur
  const focusOriginalNameRef = useRef<Record<string, string>>({});

  // Drag & drop state
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // Add Category Modal
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newImageUrl, setNewImageUrl] = useState('');
  const [newImgStatus, setNewImgStatus] = useState<ImageStatus>('loading');

  // Delete Category Confirmation
  const [deleteTarget, setDeleteTarget] = useState<{
    cat: MainCategoryItem;
    shopCount: number;
  } | null>(null);

  // Reset to Defaults Confirmation
  const [resetModalOpen, setResetModalOpen] = useState(false);

  // Close "..." dropdown when clicking outside
  useEffect(() => {
    if (!openMenuId) return;
    const handleDocClick = () => setOpenMenuId(null);
    document.addEventListener('click', handleDocClick);
    return () => document.removeEventListener('click', handleDocClick);
  }, [openMenuId]);

  useEffect(() => {
    const init = async () => {
      try {
        setLoading(true);
        const actor = adminProfile?.name || adminProfile?.uid || 'Administrator';
        const [{ data }, designerSnap, mSnap] = await Promise.all([
          loadOrInitMainCategories(actor, true),
          getDoc(doc(db, 'settings', 'appDesigner')),
          getDocs(collection(db, 'merchants'))
        ]);

        setFoodCategories(data.food);
        setConvenienceCategories(data.convenience);
        setPersistedDoc(data);

        let initialCols: ConvenienceColumnsCount = 2;
        if (designerSnap.exists()) {
          initialCols = parseConvenienceColumns(designerSnap.data().convenienceColumns);
        } else {
          const initialDesigner: AppDesignerSettings = {
            convenienceColumns: 2,
            updatedAt: Timestamp.now(),
            updatedBy: actor
          };
          await setDoc(doc(db, 'settings', 'appDesigner'), initialDesigner);
        }
        setConvenienceColumns(initialCols);
        setPersistedColumns(initialCols);

        const mList: Merchant[] = [];
        mSnap.forEach((d) => {
          const dt = d.data();
          mList.push({
            id: d.id,
            name: dt.name || 'Shop',
            type: dt.type === 'convenience' ? 'convenience' : 'food',
            cuisineTags: Array.isArray(dt.cuisineTags) ? dt.cuisineTags : [],
            ownerName: dt.ownerName || '',
            email: dt.email || '',
            phone: dt.phone || '',
            status: dt.status || 'active',
            isOpen: Boolean(dt.isOpen),
            address: dt.address || '',
            lat: Number(dt.lat) || 0,
            lng: Number(dt.lng) || 0,
            commissionRate: dt.commissionRate ?? 15
          });
        });
        setMerchants(mList);
      } catch (err: any) {
        showError(err);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  const currentList = activeGroup === 'food' ? foodCategories : convenienceCategories;
  const setCurrentList = (updater: (prev: MainCategoryItem[]) => MainCategoryItem[]) => {
    setSavedBanner(false);
    const defaults =
      activeGroup === 'food' ? DEFAULT_FOOD_CATEGORIES : DEFAULT_CONVENIENCE_CATEGORIES;
    if (activeGroup === 'food') {
      setFoodCategories((prev) => normalizeCategoryList(updater(prev), defaults));
    } else {
      setConvenienceCategories((prev) => normalizeCategoryList(updater(prev), defaults));
    }
  };

  const hasCategoryChanges = useMemo(() => {
    if (!persistedDoc) return false;
    const norm = (arr: MainCategoryItem[]) =>
      arr.map((c) => ({
        id: c.id,
        name: c.name.trim(),
        imageUrl: c.imageUrl.trim(),
        sortOrder: c.sortOrder,
        active: c.active,
        aliases: c.aliases || []
      }));
    return (
      JSON.stringify(norm(foodCategories)) !== JSON.stringify(norm(persistedDoc.food)) ||
      JSON.stringify(norm(convenienceCategories)) !==
        JSON.stringify(norm(persistedDoc.convenience))
    );
  }, [foodCategories, convenienceCategories, persistedDoc]);

  const hasLayoutChanges = convenienceColumns !== persistedColumns;
  const hasUnsavedChanges = hasCategoryChanges || hasLayoutChanges;

  const filteredList = useMemo(() => {
    const q = categorySearch.trim().toLowerCase();
    if (!q) return currentList;
    return currentList.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q) ||
        (c.aliases || []).some((a) => a.toLowerCase().includes(q))
    );
  }, [currentList, categorySearch]);

  const getImgKey = (group: GroupKey, id: string, url: string) => `${group}:${id}:${url}`;

  const getImageStatus = (group: GroupKey, cat: MainCategoryItem): ImageStatus => {
    if (!cat.imageUrl.trim()) return 'error';
    return imageStatuses[getImgKey(group, cat.id, cat.imageUrl)] || 'loading';
  };

  // Drag & Drop handlers (keeps "Others" pinned last)
  const handleDragStart = (e: React.DragEvent, cat: MainCategoryItem) => {
    if (isOthersCategory(cat)) {
      e.preventDefault();
      return;
    }
    setDraggedId(cat.id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', cat.id);
  };

  const handleDragOver = (e: React.DragEvent, targetCat: MainCategoryItem) => {
    e.preventDefault();
    if (!draggedId || draggedId === targetCat.id || isOthersCategory(targetCat)) return;
    setDragOverId(targetCat.id);
  };

  const handleDrop = (e: React.DragEvent, targetCat: MainCategoryItem) => {
    e.preventDefault();
    setDragOverId(null);
    if (!draggedId || draggedId === targetCat.id || isOthersCategory(targetCat)) {
      setDraggedId(null);
      return;
    }

    setCurrentList((prev) => {
      const nonOthers = prev.filter((c) => !isOthersCategory(c));
      const others = prev.filter((c) => isOthersCategory(c));

      const fromIdx = nonOthers.findIndex((c) => c.id === draggedId);
      const toIdx = nonOthers.findIndex((c) => c.id === targetCat.id);
      if (fromIdx === -1 || toIdx === -1) return prev;

      const reordered = [...nonOthers];
      const [moved] = reordered.splice(fromIdx, 1);
      reordered.splice(toIdx, 0, moved);

      return [...reordered, ...others].map((c, idx) => ({ ...c, sortOrder: idx }));
    });
    setDraggedId(null);
  };

  const handleMoveStep = (catId: string, direction: -1 | 1) => {
    setCurrentList((prev) => {
      const nonOthers = prev.filter((c) => !isOthersCategory(c));
      const others = prev.filter((c) => isOthersCategory(c));
      const idx = nonOthers.findIndex((c) => c.id === catId);
      const nextIdx = idx + direction;
      if (idx === -1 || nextIdx < 0 || nextIdx >= nonOthers.length) return prev;

      const copy = [...nonOthers];
      const [item] = copy.splice(idx, 1);
      copy.splice(nextIdx, 0, item);
      return [...copy, ...others].map((c, i) => ({ ...c, sortOrder: i }));
    });
  };

  // Renaming keeps id and adds old name to aliases on blur
  const handleNameFocus = (cat: MainCategoryItem) => {
    focusOriginalNameRef.current[`${activeGroup}:${cat.id}`] = cat.name.trim();
  };

  const handleNameBlur = (cat: MainCategoryItem) => {
    const key = `${activeGroup}:${cat.id}`;
    const originalName = (focusOriginalNameRef.current[key] || '').trim();
    const newTrimmed = cat.name.trim();

    if (!newTrimmed) {
      if (originalName) {
        setCurrentList((prev) =>
          prev.map((c) => (c.id === cat.id ? { ...c, name: originalName } : c))
        );
      }
      return;
    }

    const duplicate = currentList.some(
      (c) => c.id !== cat.id && c.name.trim().toLowerCase() === newTrimmed.toLowerCase()
    );
    if (duplicate) {
      showError(`Category name "${newTrimmed}" already exists in ${activeGroup}.`);
      if (originalName) {
        setCurrentList((prev) =>
          prev.map((c) => (c.id === cat.id ? { ...c, name: originalName } : c))
        );
      }
      return;
    }

    if (originalName && originalName.toLowerCase() !== newTrimmed.toLowerCase()) {
      setCurrentList((prev) =>
        prev.map((c) => {
          if (c.id !== cat.id) return c;
          const nextAliases = Array.from(
            new Set([
              ...(c.aliases || []).filter(
                (a) => a.trim().toLowerCase() !== newTrimmed.toLowerCase()
              ),
              originalName
            ])
          );
          return { ...c, name: newTrimmed, aliases: nextAliases };
        })
      );
      focusOriginalNameRef.current[key] = newTrimmed;
    }
  };

  const handleRemoveAlias = (catId: string, aliasToRemove: string) => {
    setCurrentList((prev) =>
      prev.map((c) =>
        c.id === catId
          ? { ...c, aliases: (c.aliases || []).filter((a) => a !== aliasToRemove) }
          : c
      )
    );
  };

  // Delete category click -> count matching shops & show confirmation
  const handleRequestDelete = (cat: MainCategoryItem) => {
    if (isOthersCategory(cat)) return;
    const count = merchants.filter(
      (m) => m.type === activeGroup && merchantUsesCategory(m.cuisineTags, cat)
    ).length;
    setDeleteTarget({ cat, shopCount: count });
  };

  const handleConfirmDelete = () => {
    if (!deleteTarget) return;
    const targetId = deleteTarget.cat.id;
    setCurrentList((prev) => prev.filter((c) => c.id !== targetId));
    if (editingImageId === targetId) setEditingImageId(null);
    setDeleteTarget(null);
  };

  // Add Category Modal handlers
  const handleOpenAddModal = () => {
    if (currentList.length >= MAX_CATEGORIES_PER_GROUP) {
      showError(`Maximum of ${MAX_CATEGORIES_PER_GROUP} categories reached for ${activeGroup}.`);
      return;
    }
    setNewName('');
    setNewImageUrl('');
    setNewImgStatus('error');
    setAddModalOpen(true);
  };

  const handleAddCategory = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = newName.trim();
    const cleanUrl = newImageUrl.trim();

    if (!cleanName) {
      showError('Please enter a category name.');
      return;
    }
    if (cleanName.toLowerCase() === 'others') {
      showError('"Others" is already reserved as the pinned fallback category.');
      return;
    }
    if (currentList.length >= MAX_CATEGORIES_PER_GROUP) {
      showError(`Maximum ${MAX_CATEGORIES_PER_GROUP} categories allowed per group.`);
      return;
    }
    const duplicate = currentList.some(
      (c) => c.name.trim().toLowerCase() === cleanName.toLowerCase()
    );
    if (duplicate) {
      showError(`"${cleanName}" already exists in this group.`);
      return;
    }
    if (!cleanUrl.startsWith('https://')) {
      showError('Image URL must start with https://');
      return;
    }

    const existingIds = currentList.map((c) => c.id);
    const id = slugifyCategoryName(cleanName, existingIds);

    const newItem: MainCategoryItem = {
      id,
      name: cleanName,
      imageUrl: cleanUrl,
      sortOrder: Math.max(0, currentList.length - 1),
      active: true,
      aliases: []
    };

    setCurrentList((prev) => {
      const nonOthers = prev.filter((c) => !isOthersCategory(c));
      const others = prev.filter((c) => isOthersCategory(c));
      return [...nonOthers, newItem, ...others];
    });

    setAddModalOpen(false);
    showSuccess(`Added "${cleanName}". Click Save changes to publish.`);
  };

  // Discard all unsaved changes back to persisted Firestore state
  const handleDiscardChanges = () => {
    if (persistedDoc) {
      setFoodCategories(persistedDoc.food.map((c) => ({ ...c, aliases: [...(c.aliases || [])] })));
      setConvenienceCategories(
        persistedDoc.convenience.map((c) => ({ ...c, aliases: [...(c.aliases || [])] }))
      );
    }
    setConvenienceColumns(persistedColumns);
    setEditingImageId(null);
    setSavedBanner(false);
    showSuccess('Discarded unsaved changes.');
  };

  // Reset active tab/group to defaults
  const handleResetToDefaults = () => {
    setSavedBanner(false);
    if (activeTab === 'layout') {
      setConvenienceColumns(2);
      setResetModalOpen(false);
      showSuccess('Reset Shop layout to 2 columns (default). Click Save changes to apply.');
      return;
    }

    const defaults =
      activeGroup === 'food' ? DEFAULT_FOOD_CATEGORIES : DEFAULT_CONVENIENCE_CATEGORIES;
    if (activeGroup === 'food') {
      setFoodCategories(defaults.map((c) => ({ ...c, aliases: [...c.aliases] })));
    } else {
      setConvenienceCategories(defaults.map((c) => ({ ...c, aliases: [...c.aliases] })));
    }
    setEditingImageId(null);
    setResetModalOpen(false);
    showSuccess(
      `Reset ${activeGroup === 'food' ? 'Food' : 'Convenience'} categories to defaults. Click Save changes to apply.`
    );
  };

  // Save categories (settings/mainCategories) and/or layout (settings/appDesigner)
  const handleSave = async () => {
    if (hasCategoryChanges) {
      for (const [groupName, list] of [
        ['Food', foodCategories] as const,
        ['Convenience', convenienceCategories] as const
      ]) {
        const seen = new Set<string>();
        for (const c of list) {
          const clean = c.name.trim();
          if (!clean) {
            showError(`All ${groupName} categories must have a name.`);
            return;
          }
          if (seen.has(clean.toLowerCase())) {
            showError(`Duplicate category "${clean}" found in ${groupName}.`);
            return;
          }
          seen.add(clean.toLowerCase());
          if (!c.imageUrl.trim().startsWith('https://')) {
            showError(`Category "${clean}" (${groupName}) must have an https:// image URL.`);
            return;
          }
        }
      }
    }

    try {
      setSaving(true);
      const now = Timestamp.now();
      const updatedBy =
        adminProfile?.name || adminProfile?.email || adminProfile?.uid || 'Administrator';

      let movedShopsCount = 0;

      if (hasCategoryChanges) {
        const finalizeGroup = (
          list: MainCategoryItem[],
          prevPersisted: MainCategoryItem[] | undefined,
          defaults: MainCategoryItem[]
        ) => {
          const updated = list.map((c) => {
            const oldEntry = prevPersisted?.find((p) => p.id === c.id);
            const cleanName = c.name.trim();
            let aliases = [...(c.aliases || [])];
            if (
              oldEntry &&
              oldEntry.name.trim() &&
              oldEntry.name.trim().toLowerCase() !== cleanName.toLowerCase()
            ) {
              aliases.push(oldEntry.name.trim());
            }
            aliases = Array.from(
              new Set(
                aliases
                  .map((a) => a.trim())
                  .filter((a) => a && a.toLowerCase() !== cleanName.toLowerCase())
              )
            );
            return {
              ...c,
              name: cleanName,
              imageUrl: c.imageUrl.trim(),
              aliases
            };
          });
          return normalizeCategoryList(updated, defaults);
        };

        const finalFood = finalizeGroup(
          foodCategories,
          persistedDoc?.food,
          DEFAULT_FOOD_CATEGORIES
        );
        const finalConvenience = finalizeGroup(
          convenienceCategories,
          persistedDoc?.convenience,
          DEFAULT_CONVENIENCE_CATEGORIES
        );

        const payload: MainCategoriesDoc = {
          food: finalFood,
          convenience: finalConvenience,
          updatedAt: now,
          updatedBy
        };

        await setDoc(doc(db, 'settings', 'mainCategories'), payload);

        // Migrate shops whose categories were deleted
        const deletedByGroup: Record<GroupKey, MainCategoryItem[]> = {
          food: (persistedDoc?.food || []).filter(
            (oldCat) => !isOthersCategory(oldCat) && !finalFood.some((f) => f.id === oldCat.id)
          ),
          convenience: (persistedDoc?.convenience || []).filter(
            (oldCat) =>
              !isOthersCategory(oldCat) && !finalConvenience.some((f) => f.id === oldCat.id)
          )
        };

        const shopUpdates: { id: string; nextTags: string[] }[] = [];
        merchants.forEach((m) => {
          const deletedList = deletedByGroup[m.type];
          if (!deletedList || deletedList.length === 0) return;
          const currentTags = Array.isArray(m.cuisineTags) ? m.cuisineTags : [];
          if (currentTags.length === 0) return;

          let touched = false;
          const remainingTags: string[] = [];

          currentTags.forEach((tag) => {
            const matchedDeleted = deletedList.some((delCat) => categoryMatchesTag(delCat, tag));
            if (matchedDeleted) {
              touched = true;
            } else {
              remainingTags.push(tag);
            }
          });

          if (touched) {
            if (
              remainingTags.length === 0 ||
              !remainingTags.some((t) => t.toLowerCase() === 'others')
            ) {
              remainingTags.push('Others');
            }
            shopUpdates.push({ id: m.id, nextTags: Array.from(new Set(remainingTags)) });
          }
        });

        if (shopUpdates.length > 0) {
          const CHUNK = 400;
          for (let i = 0; i < shopUpdates.length; i += CHUNK) {
            const slice = shopUpdates.slice(i, i + CHUNK);
            const batch = writeBatch(db);
            slice.forEach((u) => {
              batch.update(doc(db, 'merchants', u.id), {
                cuisineTags: u.nextTags,
                updatedAt: now
              });
            });
            await batch.commit();
          }
          movedShopsCount = shopUpdates.length;

          const updateMap = new Map(shopUpdates.map((u) => [u.id, u.nextTags]));
          setMerchants((prev) =>
            prev.map((m) =>
              updateMap.has(m.id) ? { ...m, cuisineTags: updateMap.get(m.id)! } : m
            )
          );
        }

        await logAuditEvent({
          adminId: adminProfile?.uid || 'admin',
          adminName: adminProfile?.name || 'Administrator',
          adminEmail: adminProfile?.email,
          action: 'UPDATE_MAIN_CATEGORIES',
          entityType: 'settings',
          entityId: 'mainCategories',
          details: `Saved settings/mainCategories (Food: ${finalFood.length}, Convenience: ${finalConvenience.length})${
            movedShopsCount > 0
              ? `. Moved ${movedShopsCount} shop(s) from deleted categories to Others.`
              : ''
          }`
        });

        setFoodCategories(finalFood);
        setConvenienceCategories(finalConvenience);
        setPersistedDoc(payload);
      }

      if (hasLayoutChanges) {
        const layoutPayload: AppDesignerSettings = {
          convenienceColumns,
          updatedAt: now,
          updatedBy
        };
        await setDoc(doc(db, 'settings', 'appDesigner'), layoutPayload, { merge: true });
        await logAuditEvent({
          adminId: adminProfile?.uid || 'admin',
          adminName: adminProfile?.name || 'Administrator',
          adminEmail: adminProfile?.email,
          action: 'UPDATE_APP_DESIGNER_LAYOUT',
          entityType: 'settings',
          entityId: 'appDesigner',
          details: `Updated Delivio Mart product grid to ${convenienceColumns} column(s)`
        });
        setPersistedColumns(convenienceColumns);
      }

      setSavedBanner(true);
      showSuccess(
        movedShopsCount > 0
          ? `Saved changes! Moved ${movedShopsCount} shop(s) to Others.`
          : 'Saved changes!'
      );
    } catch (err: any) {
      showError(err);
    } finally {
      setSaving(false);
    }
  };

  const activePreviewCategories = useMemo(
    () => currentList.filter((c) => c.active !== false),
    [currentList]
  );

  // Shared phone preview card for Customer App Category Strip
  const renderPhonePreview = () => (
    <div className="mx-auto w-full max-w-[300px] rounded-[2.25rem] border-[6px] border-gray-900 dark:border-zinc-700 bg-white dark:bg-zinc-950 shadow-xl overflow-hidden">
      {/* Phone Top Notch / Speaker */}
      <div className="bg-gray-900 dark:bg-zinc-800 px-5 py-2 flex items-center justify-between text-[10px] font-bold text-white">
        <span className="tabular-nums">9:41</span>
        <div className="w-14 h-3 rounded-full bg-black/70" />
        <span>5G</span>
      </div>

      {/* App Header */}
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
              {activeGroup === 'food' ? 'Delivio Food' : 'Delivio Mart'}
            </p>
            <h3 className="text-sm font-extrabold text-gray-900 dark:text-white">
              Browse Categories
            </h3>
          </div>
          <span className="text-[10px] font-semibold text-gray-400 tabular-nums">
            {activePreviewCategories.length} active
          </span>
        </div>

        {/* Horizontal Strip / Grid Preview */}
        <div className="grid grid-cols-3 gap-2.5 max-h-[340px] overflow-y-auto pr-0.5">
          {activePreviewCategories.map((cat) => (
            <div
              key={`phone-${cat.id}`}
              className="flex flex-col items-center text-center gap-1.5"
            >
              <div className="w-14 h-14 rounded-full bg-gray-100 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 flex items-center justify-center overflow-hidden p-1.5 shadow-2xs">
                {cat.imageUrl.trim() ? (
                  <img
                    src={cat.imageUrl.trim()}
                    alt={cat.name}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-contain rounded-full"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <ImageIcon className="w-5 h-5 text-gray-400" />
                )}
              </div>
              <span className="text-[10px] font-bold text-gray-800 dark:text-zinc-200 leading-tight line-clamp-2">
                {cat.name}
              </span>
            </div>
          ))}
        </div>

        {activePreviewCategories.length === 0 && (
          <div className="py-8 text-center text-xs text-gray-400">
            No active categories
          </div>
        )}
      </div>

      {/* Home Bar */}
      <div className="py-2.5 flex justify-center border-t border-gray-100 dark:border-zinc-900">
        <div className="w-20 h-1 rounded-full bg-gray-300 dark:bg-zinc-700" />
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Sticky Header Toolbar */}
      <div className="sticky top-0 z-20 -mx-4 px-4 sm:-mx-6 sm:px-6 py-3.5 bg-gray-50/95 dark:bg-zinc-950/95 backdrop-blur-md border-b border-gray-200 dark:border-zinc-800">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-xl sm:text-2xl font-extrabold text-gray-900 dark:text-white tracking-tight">
                  App Designer
                </h1>
                {hasUnsavedChanges ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-700 dark:text-amber-400">
                    <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                    <span>Unsaved changes</span>
                  </span>
                ) : savedBanner ? (
                  <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Saved</span>
                  </span>
                ) : null}
              </div>
              <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">
                Design customer app home categories and Delivio Mart product grid layout.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setResetModalOpen(true)}
              disabled={loading || saving}
              className="px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-bold text-gray-700 dark:text-zinc-200 hover:bg-gray-50 dark:hover:bg-zinc-800 flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-50 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset to defaults</span>
            </button>

            <button
              type="button"
              onClick={handleDiscardChanges}
              disabled={loading || saving || !hasUnsavedChanges}
              className="px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-bold text-gray-700 dark:text-zinc-200 hover:bg-gray-50 dark:hover:bg-zinc-800 flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-40 transition-colors"
            >
              <Undo2 className="w-3.5 h-3.5" />
              <span>Discard</span>
            </button>

            <button
              type="button"
              onClick={handleSave}
              disabled={loading || saving || !hasUnsavedChanges}
              className="delivio-btn-yellow px-4 py-2 rounded-xl text-xs font-extrabold flex items-center gap-1.5 shadow-xs whitespace-nowrap shrink-0 disabled:opacity-40"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              <span>Save changes</span>
            </button>
          </div>
        </div>

        {/* Two Primary Tabs: Categories & Shop layout */}
        <div className="flex items-center gap-2 mt-3 pt-2.5 border-t border-gray-200/70 dark:border-zinc-800/80">
          <button
            type="button"
            onClick={() => setActiveTab('categories')}
            className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 whitespace-nowrap transition-colors ${
              activeTab === 'categories'
                ? 'bg-gray-900 text-white dark:bg-amber-400 dark:text-black shadow-xs'
                : 'text-gray-600 dark:text-zinc-400 hover:bg-gray-200/60 dark:hover:bg-zinc-800'
            }`}
          >
            <Utensils className="w-3.5 h-3.5" />
            <span>Categories</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('layout')}
            className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 whitespace-nowrap transition-colors ${
              activeTab === 'layout'
                ? 'bg-gray-900 text-white dark:bg-amber-400 dark:text-black shadow-xs'
                : 'text-gray-600 dark:text-zinc-400 hover:bg-gray-200/60 dark:hover:bg-zinc-800'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            <span>Shop layout</span>
            <span className="text-[11px] font-mono tabular-nums opacity-75">
              {convenienceColumns} col
            </span>
          </button>
        </div>
      </div>

      {loading ? (
        <div className="p-16 text-center bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl">
          <Loader2 className="w-8 h-8 animate-spin text-amber-500 mx-auto mb-3" />
          <p className="text-xs font-semibold text-gray-500">
            Loading App Designer settings...
          </p>
        </div>
      ) : activeTab === 'categories' ? (
        /* ======================== CATEGORIES TAB ======================== */
        <div className="space-y-4">
          {/* Switch (Food / Convenience), Search box, + Add category */}
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center gap-2 p-1 bg-gray-100 dark:bg-zinc-800 rounded-xl border border-gray-200 dark:border-zinc-700 w-fit">
              <button
                type="button"
                onClick={() => {
                  setActiveGroup('food');
                  setEditingImageId(null);
                  setOpenMenuId(null);
                }}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-2 whitespace-nowrap transition-colors ${
                  activeGroup === 'food'
                    ? 'bg-white dark:bg-zinc-900 text-gray-900 dark:text-white shadow-xs'
                    : 'text-gray-600 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                <Utensils className="w-3.5 h-3.5 text-amber-500" />
                <span>Food</span>
                <span className="text-[11px] font-mono tabular-nums text-gray-500 dark:text-zinc-400">
                  {foodCategories.length}/{MAX_CATEGORIES_PER_GROUP}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveGroup('convenience');
                  setEditingImageId(null);
                  setOpenMenuId(null);
                }}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-2 whitespace-nowrap transition-colors ${
                  activeGroup === 'convenience'
                    ? 'bg-white dark:bg-zinc-900 text-gray-900 dark:text-white shadow-xs'
                    : 'text-gray-600 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                <ShoppingBag className="w-3.5 h-3.5 text-amber-500" />
                <span>Convenience</span>
                <span className="text-[11px] font-mono tabular-nums text-gray-500 dark:text-zinc-400">
                  {convenienceCategories.length}/{MAX_CATEGORIES_PER_GROUP}
                </span>
              </button>
            </div>

            <div className="flex flex-1 md:max-w-md items-center gap-2">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={categorySearch}
                  onChange={(e) => setCategorySearch(e.target.value)}
                  placeholder="Search categories or aliases..."
                  className="w-full pl-8 pr-8 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-gray-900 dark:text-white"
                />
                {categorySearch && (
                  <button
                    type="button"
                    onClick={() => setCategorySearch('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    title="Clear search"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={handleOpenAddModal}
                disabled={currentList.length >= MAX_CATEGORIES_PER_GROUP}
                className="delivio-btn-yellow px-3.5 py-2 rounded-xl text-xs font-extrabold flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-50"
              >
                <Plus className="w-4 h-4" />
                <span>Add category</span>
              </button>
            </div>
          </div>

          {/* Mobile Collapsed Preview Toggle */}
          <div className="lg:hidden bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
            <button
              type="button"
              onClick={() => setMobilePreviewOpen((prev) => !prev)}
              className="w-full px-4 py-3 flex items-center justify-between text-xs font-extrabold text-gray-900 dark:text-white"
            >
              <span className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-amber-500" />
                <span>Preview ({activeGroup === 'food' ? 'Delivio Food' : 'Delivio Mart'})</span>
              </span>
              {mobilePreviewOpen ? (
                <ChevronUp className="w-4 h-4 text-gray-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-gray-400" />
              )}
            </button>
            {mobilePreviewOpen && (
              <div className="p-4 pt-1 border-t border-gray-100 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-950/60">
                {renderPhonePreview()}
              </div>
            )}
          </div>

          {/* Split Content: Compact List (Left) + Sticky Phone Preview (Right) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Compact Reorderable List */}
            <div className="lg:col-span-8 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl overflow-visible">
              <div className="px-4 py-2.5 border-b border-gray-100 dark:border-zinc-800 flex items-center justify-between text-[11px] font-semibold text-gray-500 dark:text-zinc-400">
                <span>
                  {filteredList.length} {filteredList.length === 1 ? 'category' : 'categories'}
                  {categorySearch.trim() ? ' matching filter' : ''}
                </span>
                <span>Drag handle to reorder · Others stays pinned last</span>
              </div>

              {filteredList.length === 0 ? (
                <div className="p-10 text-center text-xs text-gray-400">
                  No categories match &ldquo;{categorySearch.trim()}&rdquo;.
                </div>
              ) : (
                <div className="divide-y divide-gray-100 dark:divide-zinc-800">
                  {filteredList.map((cat) => {
                    const realIndex = currentList.findIndex((c) => c.id === cat.id);
                    const pinnedLast = isOthersCategory(cat);
                    const imgStatus = getImageStatus(activeGroup, cat);
                    const imgKey = getImgKey(activeGroup, cat.id, cat.imageUrl);
                    const shopsUsingCount = merchants.filter(
                      (m) => m.type === activeGroup && merchantUsesCategory(m.cuisineTags, cat)
                    ).length;
                    const isEditingUrl = editingImageId === cat.id;
                    const isMenuOpen = openMenuId === cat.id;

                    return (
                      <div
                        key={cat.id}
                        draggable={!pinnedLast && !categorySearch.trim()}
                        onDragStart={(e) => handleDragStart(e, cat)}
                        onDragOver={(e) => handleDragOver(e, cat)}
                        onDragLeave={() => {
                          if (dragOverId === cat.id) setDragOverId(null);
                        }}
                        onDrop={(e) => handleDrop(e, cat)}
                        onDragEnd={() => {
                          setDraggedId(null);
                          setDragOverId(null);
                        }}
                        className={`transition-colors ${
                          dragOverId === cat.id
                            ? 'bg-amber-50/80 dark:bg-amber-950/30'
                            : pinnedLast
                            ? 'bg-gray-50/70 dark:bg-zinc-950/50'
                            : 'hover:bg-gray-50/60 dark:hover:bg-zinc-800/40'
                        } ${draggedId === cat.id ? 'opacity-50' : ''}`}
                      >
                        {/* Single-Line Category Row */}
                        <div className="px-3.5 py-2.5 flex items-center gap-2.5 sm:gap-3">
                          {/* Drag Handle (+ Up/Down arrows on small screens) */}
                          <div className="flex items-center gap-1 shrink-0">
                            <div
                              className={`p-1 rounded-md ${
                                pinnedLast
                                  ? 'text-gray-300 dark:text-zinc-700 cursor-not-allowed'
                                  : 'text-gray-400 hover:text-gray-700 dark:hover:text-zinc-200 cursor-grab active:cursor-grabbing'
                              }`}
                              title={pinnedLast ? 'Others stays pinned last' : 'Drag to reorder'}
                            >
                              {pinnedLast ? (
                                <Lock className="w-4 h-4" />
                              ) : (
                                <GripVertical className="w-4 h-4" />
                              )}
                            </div>

                            {!pinnedLast && (
                              <div className="flex flex-col md:hidden">
                                <button
                                  type="button"
                                  onClick={() => handleMoveStep(cat.id, -1)}
                                  disabled={realIndex <= 0}
                                  className="p-0.5 text-gray-400 hover:text-gray-700 dark:hover:text-zinc-200 disabled:opacity-25"
                                  title="Move up"
                                >
                                  <ArrowUp className="w-3 h-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleMoveStep(cat.id, 1)}
                                  disabled={realIndex >= currentList.length - 2}
                                  className="p-0.5 text-gray-400 hover:text-gray-700 dark:hover:text-zinc-200 disabled:opacity-25"
                                  title="Move down"
                                >
                                  <ArrowDown className="w-3 h-3" />
                                </button>
                              </div>
                            )}
                          </div>

                          {/* 48 px Round Image */}
                          <button
                            type="button"
                            onClick={() => setEditingImageId(isEditingUrl ? null : cat.id)}
                            title="Edit image URL"
                            className="w-12 h-12 rounded-full bg-gray-100 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 flex items-center justify-center overflow-hidden shrink-0 p-1 hover:ring-2 hover:ring-amber-400 transition-all"
                          >
                            {cat.imageUrl.trim() ? (
                              <img
                                key={imgKey}
                                src={cat.imageUrl.trim()}
                                alt={cat.name}
                                referrerPolicy="no-referrer"
                                onLoad={() =>
                                  setImageStatuses((prev) => ({ ...prev, [imgKey]: 'ok' }))
                                }
                                onError={() =>
                                  setImageStatuses((prev) => ({ ...prev, [imgKey]: 'error' }))
                                }
                                className={`w-full h-full object-contain rounded-full ${
                                  imgStatus === 'error' ? 'hidden' : 'block'
                                }`}
                              />
                            ) : null}
                            {(!cat.imageUrl.trim() || imgStatus === 'error') && (
                              <ImageIcon className="w-5 h-5 text-gray-400" />
                            )}
                          </button>

                          {/* Inline Category Name */}
                          <div className="flex-1 min-w-0">
                            <input
                              type="text"
                              value={cat.name}
                              disabled={pinnedLast}
                              onFocus={() => handleNameFocus(cat)}
                              onBlur={() => handleNameBlur(cat)}
                              onChange={(e) => {
                                const val = e.target.value;
                                setCurrentList((prev) =>
                                  prev.map((item) =>
                                    item.id === cat.id ? { ...item, name: val } : item
                                  )
                                );
                              }}
                              aria-label={`Category name for ${cat.id}`}
                              className="w-full px-2.5 py-1.5 rounded-lg border border-transparent hover:border-gray-300 focus:border-amber-400 focus:bg-white dark:hover:border-zinc-700 dark:focus:bg-zinc-800 bg-transparent text-xs font-bold text-gray-900 dark:text-white disabled:opacity-75 disabled:hover:border-transparent transition-colors truncate"
                            />
                          </div>

                          {/* "N shops" Chip */}
                          <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold tabular-nums bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-zinc-300 whitespace-nowrap shrink-0">
                            {shopsUsingCount} {shopsUsingCount === 1 ? 'shop' : 'shops'}
                          </span>

                          {/* Active Switch */}
                          <label
                            className="inline-flex items-center cursor-pointer select-none shrink-0"
                            title={
                              pinnedLast
                                ? 'Others stays active'
                                : cat.active !== false
                                ? 'Active (visible in customer app)'
                                : 'Hidden in customer app'
                            }
                          >
                            <input
                              type="checkbox"
                              checked={pinnedLast ? true : cat.active !== false}
                              disabled={pinnedLast}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setCurrentList((prev) =>
                                  prev.map((item) =>
                                    item.id === cat.id ? { ...item, active: checked } : item
                                  )
                                );
                              }}
                              className="sr-only peer"
                            />
                            <div className="w-9 h-5 bg-gray-300 dark:bg-zinc-700 rounded-full peer peer-checked:bg-emerald-500 peer-disabled:opacity-60 relative transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4" />
                          </label>

                          {/* "..." Actions Menu */}
                          <div className="relative shrink-0">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenMenuId(isMenuOpen ? null : cat.id);
                              }}
                              aria-label={`Actions for ${cat.name}`}
                              className="p-1.5 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 dark:text-zinc-400 dark:hover:text-white dark:hover:bg-zinc-800 transition-colors"
                            >
                              <MoreHorizontal className="w-4 h-4" />
                            </button>

                            {isMenuOpen && (
                              <div
                                onClick={(e) => e.stopPropagation()}
                                className="absolute right-0 mt-1.5 w-44 rounded-xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 shadow-lg py-1 z-30"
                              >
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingImageId(isEditingUrl ? null : cat.id);
                                    setOpenMenuId(null);
                                  }}
                                  className="w-full px-3 py-2 text-left text-xs font-semibold text-gray-700 dark:text-zinc-200 hover:bg-gray-50 dark:hover:bg-zinc-800 flex items-center gap-2"
                                >
                                  <Pencil className="w-3.5 h-3.5 text-amber-500" />
                                  <span>{isEditingUrl ? 'Close image editor' : 'Edit image URL'}</span>
                                </button>

                                <button
                                  type="button"
                                  disabled={pinnedLast}
                                  onClick={() => {
                                    setOpenMenuId(null);
                                    handleRequestDelete(cat);
                                  }}
                                  className="w-full px-3 py-2 text-left text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-40 disabled:pointer-events-none flex items-center gap-2"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  <span>{pinnedLast ? 'Pinned (locked)' : 'Delete'}</span>
                                </button>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Inline "Edit image URL" Panel */}
                        {isEditingUrl && (
                          <div className="px-4 pb-3.5 pt-2 bg-gray-50/90 dark:bg-zinc-950/60 border-t border-gray-100 dark:border-zinc-800 space-y-3">
                            <div className="flex flex-col sm:flex-row sm:items-center gap-3.5">
                              {/* Larger Preview */}
                              <div className="w-20 h-20 rounded-2xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 flex items-center justify-center overflow-hidden p-1.5 shrink-0">
                                {cat.imageUrl.trim() ? (
                                  <img
                                    key={`big-${imgKey}`}
                                    src={cat.imageUrl.trim()}
                                    alt={cat.name}
                                    referrerPolicy="no-referrer"
                                    onLoad={() =>
                                      setImageStatuses((prev) => ({ ...prev, [imgKey]: 'ok' }))
                                    }
                                    onError={() =>
                                      setImageStatuses((prev) => ({ ...prev, [imgKey]: 'error' }))
                                    }
                                    className={`w-full h-full object-contain ${
                                      imgStatus === 'error' ? 'hidden' : 'block'
                                    }`}
                                  />
                                ) : null}
                                {(!cat.imageUrl.trim() || imgStatus === 'error') && (
                                  <ImageIcon className="w-7 h-7 text-gray-400" />
                                )}
                              </div>

                              <div className="flex-1 min-w-0 space-y-1.5">
                                <div className="flex items-center justify-between gap-2">
                                  <label className="text-[11px] font-bold uppercase text-gray-500 dark:text-zinc-400">
                                    Image URL (https://)
                                  </label>
                                  <div className="flex items-center gap-2">
                                    {imgStatus === 'ok' ? (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                                        <CheckCircle2 className="w-3 h-3" />
                                        OK
                                      </span>
                                    ) : imgStatus === 'error' ? (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">
                                        <AlertCircle className="w-3 h-3" />
                                        Could not load
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-200 text-gray-700 dark:bg-zinc-800 dark:text-zinc-300">
                                        Checking...
                                      </span>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => setEditingImageId(null)}
                                      className="p-1 text-gray-400 hover:text-gray-700 dark:hover:text-zinc-200 rounded"
                                      title="Close"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>

                                <input
                                  type="url"
                                  value={cat.imageUrl}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setCurrentList((prev) =>
                                      prev.map((item) =>
                                        item.id === cat.id ? { ...item, imageUrl: val } : item
                                      )
                                    );
                                  }}
                                  placeholder="https://..."
                                  className="w-full px-3 py-1.5 rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-mono text-gray-800 dark:text-zinc-200"
                                />

                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500 dark:text-zinc-400">
                                  <span>
                                    ID: <code className="font-mono">{cat.id}</code>
                                  </span>
                                  <span>·</span>
                                  <span className="tabular-nums">
                                    {shopsUsingCount} {shopsUsingCount === 1 ? 'shop' : 'shops'}
                                  </span>
                                  {cat.aliases && cat.aliases.length > 0 && (
                                    <>
                                      <span>·</span>
                                      <span className="flex items-center gap-1.5 flex-wrap">
                                        <span>Aliases:</span>
                                        {cat.aliases.map((al) => (
                                          <span
                                            key={al}
                                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-200/70 dark:bg-zinc-800 text-gray-700 dark:text-zinc-200 font-medium"
                                          >
                                            <span>{al}</span>
                                            <button
                                              type="button"
                                              onClick={() => handleRemoveAlias(cat.id, al)}
                                              className="text-gray-400 hover:text-red-500"
                                              title={`Remove alias "${al}"`}
                                            >
                                              <X className="w-2.5 h-2.5" />
                                            </button>
                                          </span>
                                        ))}
                                      </span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Sticky Phone Preview (Desktop Right Column) */}
            <div className="hidden lg:block lg:col-span-4 lg:sticky lg:top-36 space-y-2.5">
              <div className="flex items-center justify-between px-1">
                <span className="text-xs font-extrabold uppercase tracking-wider text-gray-500 dark:text-zinc-400 flex items-center gap-1.5">
                  <Smartphone className="w-3.5 h-3.5 text-amber-500" />
                  <span>Live App Preview</span>
                </span>
                <span className="text-[11px] text-gray-400">Active categories only</span>
              </div>
              {renderPhonePreview()}
            </div>
          </div>
        </div>
      ) : (
        /* ======================== SHOP LAYOUT TAB ======================== */
        <div className="space-y-6">
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-extrabold text-gray-900 dark:text-white">
                  Convenience shop product grid
                </h2>
                <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">
                  Applies to Delivio Mart (convenience) shop pages only.
                </p>
              </div>
              <span className="text-[11px] font-mono text-gray-400">
                settings/appDesigner.convenienceColumns
              </span>
            </div>

            {/* 3 Option Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {(
                [
                  {
                    cols: 1 as ConvenienceColumnsCount,
                    title: '1 column',
                    subtitle: 'Full-width cards with extra room for item details'
                  },
                  {
                    cols: 2 as ConvenienceColumnsCount,
                    title: '2 columns',
                    subtitle: 'Balanced grid for everyday grocery & mart browsing'
                  },
                  {
                    cols: 3 as ConvenienceColumnsCount,
                    title: '3 columns',
                    subtitle: 'Compact catalog showing more products per screen'
                  }
                ] as const
              ).map((opt) => {
                const selected = convenienceColumns === opt.cols;
                return (
                  <button
                    key={opt.cols}
                    type="button"
                    onClick={() => {
                      setConvenienceColumns(opt.cols);
                      setSavedBanner(false);
                    }}
                    className={`p-4 rounded-2xl border-2 text-left flex items-center gap-4 transition-all ${
                      selected
                        ? 'border-amber-400 bg-amber-50/70 dark:bg-amber-950/30 shadow-sm'
                        : 'border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-gray-300 dark:hover:border-zinc-700'
                    }`}
                  >
                    <ColumnIllustration cols={opt.cols} selected={selected} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-extrabold text-gray-900 dark:text-white">
                          {opt.title}
                        </span>
                        {selected && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-400 text-black">
                            Selected
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 dark:text-zinc-400 mt-1 leading-snug">
                        {opt.subtitle}
                      </p>
                      {opt.cols === 2 && (
                        <span className="inline-block mt-1.5 text-[10px] font-bold text-amber-700 dark:text-amber-400">
                          Recommended default
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Live Product Grid Preview */}
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-amber-500" />
                <h3 className="text-sm font-extrabold text-gray-900 dark:text-white">
                  Live Storefront Preview ({convenienceColumns}{' '}
                  {convenienceColumns === 1 ? 'column' : 'columns'})
                </h3>
              </div>
              <span className="text-xs text-gray-500 dark:text-zinc-400">
                Sample Delivio Mart products with active price drops
              </span>
            </div>

            <div className="mx-auto max-w-md rounded-3xl border-4 border-gray-900 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-950 p-4 shadow-lg">
              {/* Mock Store Header */}
              <div className="flex items-center justify-between pb-3 mb-3 border-b border-gray-200 dark:border-zinc-800">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                    Delivio Mart
                  </p>
                  <p className="text-xs font-extrabold text-gray-900 dark:text-white">
                    Fresh Basket Grocer
                  </p>
                </div>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                  Open now
                </span>
              </div>

              {/* Dynamic 1 | 2 | 3 Column Grid */}
              <div
                className={`grid gap-2.5 ${
                  convenienceColumns === 1
                    ? 'grid-cols-1'
                    : convenienceColumns === 2
                    ? 'grid-cols-2'
                    : 'grid-cols-3'
                }`}
              >
                {SAMPLE_MART_PRODUCTS.map((prod) => {
                  const hasSale =
                    typeof prod.salePrice === 'number' &&
                    prod.salePrice > 0 &&
                    prod.salePrice < prod.price;
                  const discountPct = hasSale
                    ? Math.round(((prod.price - prod.salePrice!) / prod.price) * 100)
                    : 0;

                  return (
                    <div
                      key={prod.id}
                      className={`rounded-xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 overflow-hidden shadow-2xs ${
                        convenienceColumns === 1 ? 'flex items-center gap-3 p-2.5' : 'p-2 flex flex-col'
                      }`}
                    >
                      <div
                        className={`relative rounded-lg ${prod.bgClass} flex items-center justify-center shrink-0 ${
                          convenienceColumns === 1 ? 'w-20 h-20' : 'w-full h-24 mb-2'
                        }`}
                      >
                        {prod.svg}
                        {hasSale && (
                          <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-md bg-rose-600 text-white text-[10px] font-extrabold tabular-nums">
                            -{discountPct}%
                          </span>
                        )}
                      </div>

                      <div className="min-w-0 flex-1 flex flex-col justify-between">
                        <div>
                          <p
                            className={`font-bold text-gray-900 dark:text-white leading-snug ${
                              convenienceColumns === 3
                                ? 'text-[11px] line-clamp-2'
                                : 'text-xs line-clamp-2'
                            }`}
                          >
                            {prod.name}
                          </p>
                          <p className="text-[10px] text-gray-400 mt-0.5">{prod.size}</p>
                        </div>

                        <div className="mt-1.5 flex items-baseline gap-1.5 flex-wrap tabular-nums">
                          {hasSale ? (
                            <>
                              <span className="text-xs font-extrabold text-rose-600 dark:text-rose-400">
                                ₱{prod.salePrice}
                              </span>
                              <span className="text-[10px] text-gray-400 line-through">
                                ₱{prod.price}
                              </span>
                            </>
                          ) : (
                            <span className="text-xs font-extrabold text-gray-900 dark:text-white">
                              ₱{prod.price}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Category Modal */}
      {addModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl border border-gray-200 dark:border-zinc-800 shadow-2xl p-6 space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-extrabold text-gray-900 dark:text-white">
                  Add {activeGroup === 'food' ? 'Food' : 'Convenience'} Category
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Inserted before Others ({currentList.length}/{MAX_CATEGORIES_PER_GROUP} used)
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAddModalOpen(false)}
                className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddCategory} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400 mb-1">
                  Category Name (unique)
                </label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={activeGroup === 'food' ? 'e.g. Seafood' : 'e.g. Hardware'}
                  required
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-zinc-400">
                    Image URL (https://)
                  </label>
                  {newImageUrl.trim() &&
                    (newImgStatus === 'ok' ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                        <CheckCircle2 className="w-3 h-3" /> OK
                      </span>
                    ) : newImgStatus === 'error' ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">
                        <AlertCircle className="w-3 h-3" /> Could not load
                      </span>
                    ) : null)}
                </div>
                <input
                  type="url"
                  value={newImageUrl}
                  onChange={(e) => {
                    setNewImageUrl(e.target.value);
                    setNewImgStatus('loading');
                  }}
                  placeholder="https://raw.githubusercontent.com/..."
                  required
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-mono text-gray-900 dark:text-white"
                />
              </div>

              {newImageUrl.trim() && (
                <div className="p-3 rounded-xl bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 flex items-center justify-center overflow-hidden p-1 shrink-0">
                    <img
                      src={newImageUrl.trim()}
                      alt="Preview"
                      referrerPolicy="no-referrer"
                      onLoad={() => setNewImgStatus('ok')}
                      onError={() => setNewImgStatus('error')}
                      className={`w-full h-full object-contain rounded-full ${
                        newImgStatus === 'error' ? 'hidden' : 'block'
                      }`}
                    />
                    {newImgStatus === 'error' && (
                      <ImageIcon className="w-5 h-5 text-gray-400" />
                    )}
                  </div>
                  <div className="text-xs text-gray-600 dark:text-zinc-300">
                    <span className="font-bold block">{newName.trim() || 'Category preview'}</span>
                    <span className="text-[11px] text-gray-400">
                      ID will be:{' '}
                      <code className="font-mono">
                        {slugifyCategoryName(
                          newName || 'category',
                          currentList.map((c) => c.id)
                        )}
                      </code>
                    </span>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAddModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 text-xs font-bold text-gray-700 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-zinc-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="delivio-btn-yellow px-4 py-2 rounded-xl text-xs font-bold"
                >
                  Add Category
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Category Confirmation */}
      {deleteTarget && (
        <ConfirmationModal
          isOpen={Boolean(deleteTarget)}
          onClose={() => setDeleteTarget(null)}
          onConfirm={handleConfirmDelete}
          title={`Delete category "${deleteTarget.cat.name}"?`}
          message={`${deleteTarget.shopCount} ${
            deleteTarget.shopCount === 1 ? 'shop' : 'shops'
          } will move to Others. Click Save changes after confirming to persist updates to Firestore.`}
          confirmLabel="Delete Category"
          reasonRequired={false}
          isDestructive={true}
        />
      )}

      {/* Reset to Defaults Confirmation */}
      {resetModalOpen && (
        <ConfirmationModal
          isOpen={resetModalOpen}
          onClose={() => setResetModalOpen(false)}
          onConfirm={handleResetToDefaults}
          title={
            activeTab === 'layout'
              ? 'Reset Shop layout to 2 columns?'
              : `Reset ${activeGroup === 'food' ? 'Food' : 'Convenience'} categories to defaults?`
          }
          message={
            activeTab === 'layout'
              ? 'This sets Delivio Mart convenience shop grid back to the recommended 2 columns. Click Save changes afterward to apply to Firestore.'
              : `This restores the default ${
                  activeGroup === 'food' ? 'Food' : 'Convenience'
                } categories, names, order, and asset image URLs. Click Save changes afterward to apply to Firestore.`
          }
          confirmLabel="Reset to Defaults"
          reasonRequired={false}
          isDestructive={true}
        />
      )}
    </div>
  );
};

export const AppDesigner = CuisinesCategories;
