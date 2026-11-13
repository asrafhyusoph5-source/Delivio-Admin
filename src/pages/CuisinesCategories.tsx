import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  db,
  collection,
  getDocs,
  doc,
  setDoc,
  writeBatch,
  Timestamp
} from '../firebase';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { logAuditEvent } from '../utils/audit';
import type { MainCategoryItem, MainCategoriesDoc, Merchant } from '../types';
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
  LayoutGrid,
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
  X
} from 'lucide-react';

type GroupKey = 'food' | 'convenience';
type ImageStatus = 'loading' | 'ok' | 'error';

export const CuisinesCategories: React.FC = () => {
  const { adminProfile } = useAuth();
  const { showSuccess, showError } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedBanner, setSavedBanner] = useState(false);

  const [activeGroup, setActiveGroup] = useState<GroupKey>('food');
  const [foodCategories, setFoodCategories] = useState<MainCategoryItem[]>([]);
  const [convenienceCategories, setConvenienceCategories] = useState<MainCategoryItem[]>([]);
  const [persistedDoc, setPersistedDoc] = useState<MainCategoriesDoc | null>(null);

  // Loaded merchants to count how many shops use a category on delete & migrate on save
  const [merchants, setMerchants] = useState<Merchant[]>([]);

  // Image load state keyed by `${group}:${id}:${imageUrl}`
  const [imageStatuses, setImageStatuses] = useState<Record<string, ImageStatus>>({});

  // Track original name when user focuses a name field so blur creates clean aliases
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

  useEffect(() => {
    const init = async () => {
      try {
        setLoading(true);
        const [{ data }, mSnap] = await Promise.all([
          loadOrInitMainCategories(adminProfile?.name || adminProfile?.uid || 'Administrator', true),
          getDocs(collection(db, 'merchants'))
        ]);

        setFoodCategories(data.food);
        setConvenienceCategories(data.convenience);
        setPersistedDoc(data);

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

  const hasUnsavedChanges = useMemo(() => {
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
      // Restore original if cleared
      if (originalName) {
        setCurrentList((prev) =>
          prev.map((c) => (c.id === cat.id ? { ...c, name: originalName } : c))
        );
      }
      return;
    }

    // Check uniqueness
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
    showSuccess(`Added "${cleanName}". Click Save to publish changes.`);
  };

  // Reset active tab to defaults
  const handleResetToDefaults = () => {
    const defaults =
      activeGroup === 'food' ? DEFAULT_FOOD_CATEGORIES : DEFAULT_CONVENIENCE_CATEGORIES;
    setSavedBanner(false);
    if (activeGroup === 'food') {
      setFoodCategories(defaults.map((c) => ({ ...c, aliases: [...c.aliases] })));
    } else {
      setConvenienceCategories(defaults.map((c) => ({ ...c, aliases: [...c.aliases] })));
    }
    setResetModalOpen(false);
    showSuccess(
      `Reset ${activeGroup === 'food' ? 'Food' : 'Convenience'} categories to defaults. Click Save to apply.`
    );
  };

  // Save entire settings/mainCategories doc at once + migrate shops for any deleted categories
  const handleSave = async () => {
    // Validate unique names & valid URLs
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

    try {
      setSaving(true);

      // Ensure persisted old names are added to aliases if renamed right before clicking Save
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

      const now = Timestamp.now();
      const updatedBy = adminProfile?.name || adminProfile?.email || adminProfile?.uid || 'Administrator';

      const payload: MainCategoriesDoc = {
        food: finalFood,
        convenience: finalConvenience,
        updatedAt: now,
        updatedBy
      };

      await setDoc(doc(db, 'settings', 'mainCategories'), payload);

      // Migrate any shops using categories that were deleted compared to persistedDoc
      let movedShopsCount = 0;
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
          const matchedDeleted = deletedList.some((delCat) =>
            categoryMatchesTag(delCat, tag)
          );
          if (matchedDeleted) {
            touched = true;
          } else {
            remainingTags.push(tag);
          }
        });

        if (touched) {
          if (remainingTags.length === 0 || !remainingTags.some((t) => t.toLowerCase() === 'others')) {
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
          movedShopsCount > 0 ? `. Moved ${movedShopsCount} shop(s) from deleted categories to Others.` : ''
        }`
      });

      setFoodCategories(finalFood);
      setConvenienceCategories(finalConvenience);
      setPersistedDoc(payload);
      setSavedBanner(true);
      showSuccess(
        movedShopsCount > 0
          ? `Saved! Moved ${movedShopsCount} shop(s) to Others.`
          : 'Saved!'
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

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">
            Cuisines &amp; Categories
          </h1>
          <p className="text-sm text-gray-500 dark:text-zinc-400 mt-0.5">
            Configure the Food and Convenience category strips shown on the customer app home screen.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {savedBanner && !hasUnsavedChanges && (
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 dark:text-emerald-400 px-2">
              <CheckCircle2 className="w-4 h-4" />
              Saved
            </span>
          )}
          {hasUnsavedChanges && (
            <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 px-2">
              Unsaved changes
            </span>
          )}

          <button
            type="button"
            onClick={() => setResetModalOpen(true)}
            disabled={loading || saving}
            className="px-3.5 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-bold text-gray-700 dark:text-zinc-200 hover:bg-gray-50 dark:hover:bg-zinc-800 flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset to defaults</span>
          </button>

          <button
            type="button"
            onClick={handleOpenAddModal}
            disabled={loading || saving || currentList.length >= MAX_CATEGORIES_PER_GROUP}
            className="px-3.5 py-2 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/50 text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-50 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>+ Add category</span>
          </button>

          <button
            type="button"
            onClick={handleSave}
            disabled={loading || saving}
            className="delivio-btn-yellow px-5 py-2 rounded-xl text-xs font-extrabold flex items-center gap-2 shadow-xs whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            <span>Save Changes</span>
          </button>
        </div>
      </div>

      {/* Tabs: Food & Convenience */}
      <div className="flex items-center justify-between flex-wrap gap-3 border-b border-gray-200 dark:border-zinc-800 pb-3">
        <div className="flex items-center gap-2 p-1 bg-gray-100 dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-800">
          <button
            type="button"
            onClick={() => setActiveGroup('food')}
            className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors ${
              activeGroup === 'food'
                ? 'bg-white dark:bg-zinc-800 text-gray-900 dark:text-white shadow-xs'
                : 'text-gray-600 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            <Utensils className="w-3.5 h-3.5 text-amber-500" />
            <span>Food</span>
            <span className="text-[11px] font-mono tabular-nums text-gray-400">
              {foodCategories.length}/{MAX_CATEGORIES_PER_GROUP}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveGroup('convenience')}
            className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors ${
              activeGroup === 'convenience'
                ? 'bg-white dark:bg-zinc-800 text-gray-900 dark:text-white shadow-xs'
                : 'text-gray-600 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            <ShoppingBag className="w-3.5 h-3.5 text-amber-500" />
            <span>Convenience</span>
            <span className="text-[11px] font-mono tabular-nums text-gray-400">
              {convenienceCategories.length}/{MAX_CATEGORIES_PER_GROUP}
            </span>
          </button>
        </div>

        <div className="text-xs text-gray-500 dark:text-zinc-400 flex items-center gap-2">
          <span>{activePreviewCategories.length} active</span>
          <span aria-hidden="true">·</span>
          <span>Drag handles reorder items</span>
          <span aria-hidden="true">·</span>
          <span>Others stays pinned last</span>
        </div>
      </div>

      {loading ? (
        <div className="p-16 text-center bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl">
          <Loader2 className="w-8 h-8 animate-spin text-amber-500 mx-auto mb-3" />
          <p className="text-xs font-semibold text-gray-500">
            Loading category catalog from settings/mainCategories...
          </p>
        </div>
      ) : (
        <>
          {/* Live Preview Strip (Customer Home Row) */}
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <LayoutGrid className="w-4 h-4 text-amber-500" />
                <h2 className="text-xs font-extrabold uppercase tracking-wider text-gray-900 dark:text-white">
                  Customer Home Preview ({activeGroup === 'food' ? 'Delivio Food' : 'Delivio Mart'})
                </h2>
              </div>
              <span className="text-[11px] text-gray-500 dark:text-zinc-400">
                Live horizontal strip · Active categories only
              </span>
            </div>

            <div className="p-4 rounded-xl bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 overflow-x-auto">
              <div className="flex items-start gap-4 min-w-max">
                {activePreviewCategories.map((cat) => (
                  <div
                    key={`preview-${cat.id}`}
                    className="w-20 flex flex-col items-center text-center gap-1.5 shrink-0"
                  >
                    <div className="w-16 h-16 rounded-2xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 shadow-2xs flex items-center justify-center overflow-hidden p-1.5">
                      {cat.imageUrl ? (
                        <img
                          src={cat.imageUrl}
                          alt={cat.name}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-contain"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      ) : (
                        <ImageIcon className="w-6 h-6 text-gray-300" />
                      )}
                    </div>
                    <span className="text-[11px] font-bold text-gray-800 dark:text-zinc-200 leading-tight line-clamp-2">
                      {cat.name}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Reorderable Categories List */}
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
            <div className="divide-y divide-gray-100 dark:divide-zinc-800">
              {currentList.map((cat, index) => {
                const pinnedLast = isOthersCategory(cat);
                const imgStatus = getImageStatus(activeGroup, cat);
                const imgKey = getImgKey(activeGroup, cat.id, cat.imageUrl);
                const shopsUsingCount = merchants.filter(
                  (m) => m.type === activeGroup && merchantUsesCategory(m.cuisineTags, cat)
                ).length;

                return (
                  <div
                    key={cat.id}
                    draggable={!pinnedLast}
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
                    className={`p-4 flex flex-col lg:flex-row lg:items-center gap-4 transition-colors ${
                      dragOverId === cat.id
                        ? 'bg-amber-50/70 dark:bg-amber-950/30'
                        : pinnedLast
                        ? 'bg-gray-50/70 dark:bg-zinc-950/60'
                        : 'hover:bg-gray-50/60 dark:hover:bg-zinc-850/40'
                    } ${draggedId === cat.id ? 'opacity-50' : ''}`}
                  >
                    {/* Drag Handle & Order Controls */}
                    <div className="flex items-center gap-2 shrink-0">
                      <div
                        className={`p-1.5 rounded-lg ${
                          pinnedLast
                            ? 'text-gray-300 dark:text-zinc-700 cursor-not-allowed'
                            : 'text-gray-400 hover:text-gray-700 dark:hover:text-zinc-200 cursor-grab active:cursor-grabbing'
                        }`}
                        title={pinnedLast ? 'Others is pinned last' : 'Drag to reorder'}
                      >
                        {pinnedLast ? (
                          <Lock className="w-4 h-4" />
                        ) : (
                          <GripVertical className="w-4 h-4" />
                        )}
                      </div>

                      <span className="w-6 text-center font-mono tabular-nums text-xs font-bold text-gray-400">
                        {index + 1}
                      </span>

                      {!pinnedLast && (
                        <div className="flex flex-col gap-0.5">
                          <button
                            type="button"
                            onClick={() => handleMoveStep(cat.id, -1)}
                            disabled={index === 0}
                            className="p-0.5 text-gray-400 hover:text-gray-700 dark:hover:text-zinc-200 disabled:opacity-25"
                            title="Move up"
                          >
                            <ArrowUp className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleMoveStep(cat.id, 1)}
                            disabled={index >= currentList.length - 2}
                            className="p-0.5 text-gray-400 hover:text-gray-700 dark:hover:text-zinc-200 disabled:opacity-25"
                            title="Move down"
                          >
                            <ArrowDown className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Image Preview & URL Field */}
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="w-14 h-14 rounded-xl bg-gray-100 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 flex items-center justify-center overflow-hidden shrink-0 p-1 relative">
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
                            className={`w-full h-full object-contain ${
                              imgStatus === 'error' ? 'hidden' : 'block'
                            }`}
                          />
                        ) : null}
                        {(!cat.imageUrl.trim() || imgStatus === 'error') && (
                          <ImageIcon className="w-5 h-5 text-gray-400" />
                        )}
                      </div>

                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5">
                          {/* Category Name */}
                          <div className="md:col-span-4">
                            <label className="block text-[10px] font-bold uppercase text-gray-400 mb-0.5">
                              Name
                            </label>
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
                              className="w-full px-3 py-1.5 rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold text-gray-900 dark:text-white disabled:opacity-70 disabled:bg-gray-100 dark:disabled:bg-zinc-900"
                            />
                          </div>

                          {/* Image URL + Load Status Chip */}
                          <div className="md:col-span-8">
                            <div className="flex items-center justify-between mb-0.5">
                              <label className="block text-[10px] font-bold uppercase text-gray-400">
                                Image URL
                              </label>
                              {imgStatus === 'ok' ? (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                                  <CheckCircle2 className="w-3 h-3" />
                                  OK
                                </span>
                              ) : imgStatus === 'error' ? (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">
                                  <AlertCircle className="w-3 h-3" />
                                  Could not load
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-zinc-400">
                                  Checking...
                                </span>
                              )}
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
                          </div>
                        </div>

                        {/* Metadata line: id, shop count, aliases */}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500 dark:text-zinc-400">
                          <span>
                            ID: <code className="font-mono text-gray-700 dark:text-zinc-300">{cat.id}</code>
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="tabular-nums">
                            {shopsUsingCount} {shopsUsingCount === 1 ? 'shop' : 'shops'}
                          </span>
                          {pinnedLast && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-semibold text-amber-700 dark:text-amber-400">
                                Pinned last · Cannot be deleted or deactivated
                              </span>
                            </>
                          )}
                          {cat.aliases && cat.aliases.length > 0 && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="flex items-center gap-1.5 flex-wrap">
                                <span>Aliases:</span>
                                {cat.aliases.map((al) => (
                                  <span
                                    key={al}
                                    className="inline-flex items-center gap-1 text-gray-700 dark:text-zinc-200 font-medium"
                                  >
                                    <span>{al}</span>
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveAlias(cat.id, al)}
                                      className="text-gray-400 hover:text-red-500"
                                      title={`Remove alias "${al}"`}
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                  </span>
                                ))}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Active Switch & Delete */}
                    <div className="flex items-center justify-end gap-4 shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-gray-100 dark:border-zinc-800">
                      <label className="flex items-center gap-2 cursor-pointer select-none">
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
                        <span className="text-xs font-bold text-gray-700 dark:text-zinc-300 w-12">
                          {pinnedLast || cat.active !== false ? 'Active' : 'Hidden'}
                        </span>
                      </label>

                      <button
                        type="button"
                        onClick={() => handleRequestDelete(cat)}
                        disabled={pinnedLast}
                        title={
                          pinnedLast
                            ? 'Others cannot be deleted'
                            : `Delete "${cat.name}"`
                        }
                        className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-25 disabled:pointer-events-none transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
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
                  {newImageUrl.trim() && (
                    newImgStatus === 'ok' ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                        <CheckCircle2 className="w-3 h-3" /> OK
                      </span>
                    ) : newImgStatus === 'error' ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">
                        <AlertCircle className="w-3 h-3" /> Could not load
                      </span>
                    ) : null
                  )}
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
                  <div className="w-12 h-12 rounded-xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 flex items-center justify-center overflow-hidden p-1 shrink-0">
                    <img
                      src={newImageUrl.trim()}
                      alt="Preview"
                      referrerPolicy="no-referrer"
                      onLoad={() => setNewImgStatus('ok')}
                      onError={() => setNewImgStatus('error')}
                      className={`w-full h-full object-contain ${
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
                      ID will be: <code className="font-mono">{slugifyCategoryName(newName || 'category', currentList.map((c) => c.id))}</code>
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
          } will move to Others. Click Save Changes after confirming to persist updates to Firestore.`}
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
          title={`Reset ${activeGroup === 'food' ? 'Food' : 'Convenience'} categories to defaults?`}
          message={`This restores the default ${
            activeGroup === 'food' ? 'Food' : 'Convenience'
          } categories, names, order, and asset image URLs. Click Save Changes afterward to apply to Firestore.`}
          confirmLabel="Reset to Defaults"
          reasonRequired={false}
          isDestructive={true}
        />
      )}
    </div>
  );
};
