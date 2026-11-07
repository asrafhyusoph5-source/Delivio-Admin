import React, { useState } from 'react';
import { db, doc, setDoc, Timestamp } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { logAuditEvent } from '../../utils/audit';
import type { CheckoutSettings } from '../../types';
import { DEFAULT_CHECKOUT_SETTINGS } from '../../constants';
import { ConfirmationModal } from '../common/ConfirmationModal';
import {
  Sparkles,
  Save,
  ShoppingBag,
  Sliders,
  CheckCircle2,
  Plus,
  Loader2,
  Smartphone,
  Star,
  Flame,
  ArrowRight
} from 'lucide-react';

interface CheckoutMustTryTabProps {
  checkoutSettings: CheckoutSettings;
  onSettingsChange: (settings: CheckoutSettings) => void;
  loading: boolean;
}

const DESCRIPTION_SUGGESTIONS = [
  'Add a favorite from this shop to go with your order',
  'Customers love these. Grab one more before you check out!',
  'Pair your meal with a crowd favorite'
];

export const CheckoutMustTryTab: React.FC<CheckoutMustTryTabProps> = ({
  checkoutSettings,
  onSettingsChange,
  loading
}) => {
  const { adminProfile } = useAuth();
  const { showSuccess, showError } = useToast();

  const [saving, setSaving] = useState(false);
  const [confirmSaveOpen, setConfirmSaveOpen] = useState(false);

  const mustTry = checkoutSettings.mustTry || DEFAULT_CHECKOUT_SETTINGS.mustTry;

  const updateMustTry = <K extends keyof typeof mustTry>(key: K, value: (typeof mustTry)[K]) => {
    onSettingsChange({
      ...checkoutSettings,
      mustTry: {
        ...mustTry,
        [key]: value
      }
    });
  };

  const handleSaveCheckout = async () => {
    try {
      setSaving(true);
      const checkoutRef = doc(db, 'settings', 'checkout');
      const payload: CheckoutSettings = {
        mustTry: {
          enabled: Boolean(mustTry.enabled),
          title: mustTry.title?.trim() || 'Must try!',
          description: mustTry.description?.trim() || 'Add a favorite from this shop to go with your order',
          maxItems: Math.min(12, Math.max(1, Number(mustTry.maxItems) || 8))
        },
        updatedAt: Timestamp.now(),
        updatedBy: adminProfile?.email || 'admin'
      };

      await setDoc(checkoutRef, payload, { merge: true });

      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        adminEmail: adminProfile?.email || 'admin@delivio.ph',
        action: 'UPDATE_CHECKOUT_SETTINGS',
        entityType: 'settings',
        entityId: 'checkout',
        details: `Updated checkout Must Try recommendations (enabled: ${payload.mustTry.enabled}, maxItems: ${payload.mustTry.maxItems})`
      });

      showSuccess('Checkout Must Try settings saved successfully!');
    } catch (err: any) {
      showError(err);
    } finally {
      setSaving(false);
      setConfirmSaveOpen(false);
    }
  };

  const sampleItems = [
    {
      id: 'item-1',
      name: 'Garlic Butter Naan',
      price: 95,
      rating: 4.9,
      orders: '1.2k+ ordered',
      image: 'https://images.unsplash.com/photo-1601050690597-df0568f70950?w=200&auto=format&fit=crop&q=80'
    },
    {
      id: 'item-2',
      name: 'Crispy Calamari Rings',
      price: 185,
      rating: 4.8,
      orders: '850+ ordered',
      image: 'https://images.unsplash.com/photo-1599488615731-7e5c2823ff28?w=200&auto=format&fit=crop&q=80'
    },
    {
      id: 'item-3',
      name: 'Iced Brown Sugar Boba',
      price: 110,
      rating: 4.9,
      orders: '2.4k+ ordered',
      image: 'https://images.unsplash.com/photo-1558857563-b371033873b8?w=200&auto=format&fit=crop&q=80'
    },
    {
      id: 'item-4',
      name: 'Signature Cheesy Fries',
      price: 125,
      rating: 4.7,
      orders: '620+ ordered',
      image: 'https://images.unsplash.com/photo-1576107232684-1279f3908594?w=200&auto=format&fit=crop&q=80'
    }
  ];

  return (
    <div className="space-y-6">
      {/* Top Banner & Actions */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-2xl bg-amber-400 text-black shadow-xs shrink-0">
            <Sparkles className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-extrabold text-gray-900 dark:text-white">
                Checkout Settings &bull; Must Try! Recommendations
              </h2>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                settings/checkout.mustTry
              </span>
            </div>
            <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">
              Boost basket size and average order value by surfacing customer favorites directly at the checkout step.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setConfirmSaveOpen(true)}
          disabled={saving || loading}
          className="delivio-btn-yellow px-5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 shadow-xs self-start sm:self-auto"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Checkout Settings
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Controls Column */}
        <div className="lg:col-span-6 space-y-6">
          {/* Main Toggle and Fields */}
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-6 shadow-xs space-y-5">
            <div className="flex items-center justify-between p-4 rounded-2xl bg-gray-50 dark:bg-zinc-800/60 border border-gray-200 dark:border-zinc-700">
              <div>
                <span className="font-extrabold text-xs text-gray-900 dark:text-white block">
                  Enable "Must Try!" at Checkout
                </span>
                <span className="text-[11px] text-gray-500">
                  Renders the upsell card carousel in the Delivio mobile app checkout sheet.
                </span>
              </div>
              <button
                type="button"
                onClick={() => updateMustTry('enabled', !mustTry.enabled)}
                className={`px-4 py-2 rounded-xl text-xs font-extrabold transition-colors ${
                  mustTry.enabled
                    ? 'bg-emerald-500 text-white shadow-xs'
                    : 'bg-gray-300 dark:bg-zinc-700 text-gray-700 dark:text-zinc-300'
                }`}
              >
                {mustTry.enabled ? 'ACTIVE' : 'DISABLED'}
              </button>
            </div>

            {/* Title */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-zinc-400 mb-1">
                Section Title
              </label>
              <input
                type="text"
                value={mustTry.title}
                onChange={(e) => updateMustTry('title', e.target.value)}
                placeholder="Must try!"
                className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold text-gray-900 dark:text-white"
              />
              <span className="text-[11px] text-gray-400 mt-1 block">Default: "Must try!"</span>
            </div>

            {/* Description & One-tap Suggestions */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-zinc-400 mb-1">
                Description / Subtext
              </label>
              <textarea
                rows={2}
                value={mustTry.description}
                onChange={(e) => updateMustTry('description', e.target.value)}
                placeholder="Add a favorite from this shop to go with your order"
                className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-gray-900 dark:text-white"
              />

              {/* One-tap Suggestion Chips */}
              <div className="mt-2.5 space-y-1.5">
                <span className="text-[11px] font-bold text-gray-500 dark:text-zinc-400 flex items-center gap-1">
                  <Flame className="w-3.5 h-3.5 text-amber-500" /> One-tap Description Suggestions:
                </span>
                <div className="flex flex-col gap-1.5">
                  {DESCRIPTION_SUGGESTIONS.map((suggestion, idx) => {
                    const isSelected = mustTry.description === suggestion;
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => updateMustTry('description', suggestion)}
                        className={`text-left px-3 py-2 rounded-xl text-xs transition-colors flex items-center justify-between border ${
                          isSelected
                            ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-400 text-amber-900 dark:text-amber-200 font-bold'
                            : 'bg-gray-50 dark:bg-zinc-800/40 border-gray-200 dark:border-zinc-700/60 text-gray-600 dark:text-zinc-300 hover:border-amber-300'
                        }`}
                      >
                        <span>"{suggestion}"</span>
                        {isSelected ? (
                          <CheckCircle2 className="w-4 h-4 text-amber-600 shrink-0 ml-2" />
                        ) : (
                          <span className="text-[10px] text-amber-600 font-semibold shrink-0 ml-2">Use</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Max Items */}
            <div className="pt-2">
              <div className="flex justify-between items-center mb-1">
                <label className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-zinc-400">
                  Maximum Items Displayed
                </label>
                <span className="px-2.5 py-0.5 rounded-lg text-xs font-black bg-amber-400 text-black">
                  {mustTry.maxItems || 8} items
                </span>
              </div>
              <input
                type="range"
                min="1"
                max="12"
                step="1"
                value={mustTry.maxItems || 8}
                onChange={(e) => updateMustTry('maxItems', Number(e.target.value))}
                className="w-full accent-amber-500 cursor-pointer"
              />
              <div className="flex justify-between text-[11px] text-gray-400 mt-1">
                <span>1 item</span>
                <span>Default: 8 items</span>
                <span>Max: 12 items</span>
              </div>
            </div>
          </div>
        </div>

        {/* Live Mobile App Checkout Preview Column */}
        <div className="lg:col-span-6 sticky top-6 space-y-3">
          <div className="flex items-center gap-2 pb-1">
            <Smartphone className="w-4 h-4 text-amber-500" />
            <span className="font-extrabold text-xs uppercase tracking-wider text-gray-700 dark:text-zinc-300">
              Live Customer Checkout Preview (Mobile App)
            </span>
          </div>

          {/* Smartphone Frame Simulation */}
          <div className="bg-gray-900 rounded-[36px] p-3 shadow-2xl border-4 border-gray-800 max-w-sm mx-auto">
            {/* Phone Screen */}
            <div className="bg-white dark:bg-zinc-950 rounded-[28px] overflow-hidden text-gray-900 dark:text-white flex flex-col min-h-[480px]">
              {/* Phone Status Bar */}
              <div className="px-5 pt-3 pb-2 flex justify-between items-center text-[11px] font-bold text-gray-400 border-b border-gray-100 dark:border-zinc-900">
                <span>9:41</span>
                <span className="font-semibold">Checkout</span>
                <span>5G &bull; 100%</span>
              </div>

              {/* Order Cart Summary Mock */}
              <div className="p-4 border-b border-gray-100 dark:border-zinc-800 bg-gray-50/50 dark:bg-zinc-900/40">
                <div className="text-[11px] font-extrabold text-gray-400 uppercase tracking-wider">Order From</div>
                <div className="text-xs font-black mt-0.5">Palawan Seafood Grill</div>
                <div className="mt-1 flex justify-between text-xs text-gray-500">
                  <span>1x Seafood Paella Bowl</span>
                  <span className="font-bold text-gray-900 dark:text-white">₱245.00</span>
                </div>
              </div>

              {/* MUST TRY SECTION - LIVE PREVIEW */}
              <div className="p-4 flex-1">
                {mustTry.enabled ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Sparkles className="w-4 h-4 text-amber-500 fill-amber-400" />
                        <h4 className="font-black text-sm text-gray-900 dark:text-white">
                          {mustTry.title || 'Must try!'}
                        </h4>
                      </div>
                      <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 px-2 py-0.5 rounded-full">
                        Up to {mustTry.maxItems || 8}
                      </span>
                    </div>

                    <p className="text-[11px] text-gray-500 leading-snug">
                      {mustTry.description || 'Add a favorite from this shop to go with your order'}
                    </p>

                    {/* Horizontal Recommendation Cards */}
                    <div className="grid grid-cols-2 gap-2.5 pt-1">
                      {sampleItems.slice(0, Math.min(mustTry.maxItems || 8, 4)).map((item) => (
                        <div
                          key={item.id}
                          className="p-2.5 rounded-2xl border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex flex-col justify-between hover:shadow-md transition-shadow group"
                        >
                          <div>
                            <div className="aspect-video w-full rounded-xl overflow-hidden mb-2 bg-gray-100">
                              <img
                                src={item.image}
                                alt={item.name}
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                              />
                            </div>
                            <span className="font-bold text-xs line-clamp-1 block text-gray-900 dark:text-white">
                              {item.name}
                            </span>
                            <div className="flex items-center gap-1 text-[10px] text-gray-400 mt-0.5">
                              <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
                              <span>{item.rating}</span>
                              <span>&bull;</span>
                              <span>{item.orders}</span>
                            </div>
                          </div>

                          <div className="mt-2.5 flex items-center justify-between pt-1 border-t border-gray-100 dark:border-zinc-800">
                            <span className="text-xs font-black text-amber-600">
                              ₱{item.price.toFixed(2)}
                            </span>
                            <button
                              type="button"
                              className="px-2 py-1 rounded-lg bg-amber-400 text-black text-[10px] font-black flex items-center gap-0.5 shadow-xs hover:bg-amber-300"
                            >
                              <Plus className="w-3 h-3" /> Add
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="p-6 text-center text-gray-400 space-y-2 border-2 border-dashed border-gray-200 dark:border-zinc-800 rounded-2xl">
                    <ShoppingBag className="w-8 h-8 mx-auto opacity-30" />
                    <p className="text-xs font-semibold">Must Try! recommendations disabled.</p>
                    <p className="text-[10px] opacity-70">Enable above to preview the customer upsell widget.</p>
                  </div>
                )}
              </div>

              {/* Checkout Bottom Button Mock */}
              <div className="p-4 border-t border-gray-100 dark:border-zinc-900 bg-white dark:bg-zinc-950">
                <button
                  type="button"
                  disabled
                  className="w-full py-3 rounded-2xl bg-amber-400 text-black font-black text-xs flex items-center justify-center gap-2 opacity-90 cursor-default"
                >
                  <span>Place Order &bull; ₱245.00</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Save Confirmation Modal */}
      <ConfirmationModal
        isOpen={confirmSaveOpen}
        title="Save Checkout Must Try! Settings"
        message="This will update the recommendation heading, subtext, and item limits displayed on the customer mobile checkout screen."
        confirmLabel="Save Settings"
        onConfirm={handleSaveCheckout}
        onClose={() => setConfirmSaveOpen(false)}
        isDestructive={false}
      />
    </div>
  );
};
