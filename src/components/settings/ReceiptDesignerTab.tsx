import React, { useState } from 'react';
import { db, doc, setDoc, Timestamp } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { logAuditEvent } from '../../utils/audit';
import type { ReceiptDesignConfig } from '../../types';
import { DEFAULT_RECEIPT_CONFIG } from '../../constants';
import { ConfirmationModal } from '../common/ConfirmationModal';
import {
  Printer,
  Save,
  RotateCcw,
  Check,
  AlertCircle,
  Plus,
  Trash2,
  FileText,
  Sliders,
  Type,
  AlignLeft,
  AlignCenter,
  ShieldCheck,
  Loader2
} from 'lucide-react';

interface ReceiptDesignerTabProps {
  receiptConfig: ReceiptDesignConfig;
  onConfigChange: (config: ReceiptDesignConfig) => void;
  loading: boolean;
}

export const ReceiptDesignerTab: React.FC<ReceiptDesignerTabProps> = ({
  receiptConfig,
  onConfigChange,
  loading
}) => {
  const { adminProfile } = useAuth();
  const { showSuccess, showError } = useToast();

  const [paperWidth, setPaperWidth] = useState<'58mm' | '80mm'>('58mm');
  const [activePreviewCopy, setActivePreviewCopy] = useState<'merchant' | 'customer'>('merchant');
  const [saving, setSaving] = useState(false);
  const [confirmSaveOpen, setConfirmSaveOpen] = useState(false);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);

  // Field change helpers
  const updateField = <K extends keyof ReceiptDesignConfig>(key: K, value: ReceiptDesignConfig[K]) => {
    onConfigChange({
      ...receiptConfig,
      [key]: value
    });
  };

  const updateMerchantCopy = <K extends keyof ReceiptDesignConfig['merchantCopy']>(
    key: K,
    value: ReceiptDesignConfig['merchantCopy'][K]
  ) => {
    onConfigChange({
      ...receiptConfig,
      merchantCopy: {
        ...receiptConfig.merchantCopy,
        [key]: value
      }
    });
  };

  const updateCustomerCopy = <K extends keyof ReceiptDesignConfig['customerCopy']>(
    key: K,
    value: ReceiptDesignConfig['customerCopy'][K]
  ) => {
    onConfigChange({
      ...receiptConfig,
      customerCopy: {
        ...receiptConfig.customerCopy,
        [key]: value
      }
    });
  };

  const handleAddHeaderLine = () => {
    const current = receiptConfig.headerLines || [];
    if (current.length >= 3) return;
    onConfigChange({
      ...receiptConfig,
      headerLines: [...current, `Header Line ${current.length + 1}`]
    });
  };

  const handleUpdateHeaderLine = (index: number, val: string) => {
    const next = [...(receiptConfig.headerLines || [])];
    next[index] = val;
    onConfigChange({
      ...receiptConfig,
      headerLines: next
    });
  };

  const handleRemoveHeaderLine = (index: number) => {
    const next = (receiptConfig.headerLines || []).filter((_, i) => i !== index);
    onConfigChange({
      ...receiptConfig,
      headerLines: next
    });
  };

  const handleSaveReceipt = async () => {
    try {
      setSaving(true);
      const receiptRef = doc(db, 'settings', 'receipt');
      const payload: ReceiptDesignConfig = {
        brandLine: receiptConfig.brandLine.trim() || 'Delivio',
        headerLines: (receiptConfig.headerLines || []).map(l => l.trim()).filter(Boolean).slice(0, 3),
        footerText: receiptConfig.footerText.trim(),
        showOrderId: Boolean(receiptConfig.showOrderId),
        showOrderedAt: Boolean(receiptConfig.showOrderedAt),
        showCustomerName: Boolean(receiptConfig.showCustomerName),
        showNote: Boolean(receiptConfig.showNote),
        showSetChoices: Boolean(receiptConfig.showSetChoices),
        fontSize: receiptConfig.fontSize || 'medium',
        align: receiptConfig.align || 'center',
        separator: receiptConfig.separator || 'dashes',
        merchantCopy: {
          enabled: Boolean(receiptConfig.merchantCopy?.enabled),
          title: receiptConfig.merchantCopy?.title?.trim() || "Merchant's Copy",
          showItemPrices: Boolean(receiptConfig.merchantCopy?.showItemPrices)
        },
        customerCopy: {
          enabled: Boolean(receiptConfig.customerCopy?.enabled),
          title: receiptConfig.customerCopy?.title?.trim() || "Customer's Copy",
          showItemPrices: Boolean(receiptConfig.customerCopy?.showItemPrices)
        },
        updatedAt: Timestamp.now(),
        updatedBy: adminProfile?.email || 'admin'
      };

      await setDoc(receiptRef, payload, { merge: true });

      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        adminEmail: adminProfile?.email || 'admin@delivio.ph',
        action: 'UPDATE_RECEIPT_SETTINGS',
        entityType: 'settings',
        entityId: 'receipt',
        details: `Saved print receipt design (Separator: ${payload.separator}, Font: ${payload.fontSize}, Paper: ${paperWidth})`
      });

      showSuccess('Receipt design settings saved successfully!');
    } catch (err: any) {
      showError(err);
    } finally {
      setSaving(false);
      setConfirmSaveOpen(false);
    }
  };

  const handleResetToDefault = () => {
    onConfigChange(DEFAULT_RECEIPT_CONFIG);
    setConfirmResetOpen(false);
    showSuccess('Receipt settings reset to default values. Click "Save Receipt Settings" to persist.');
  };

  // Separator line characters
  const getSeparatorString = (width: '58mm' | '80mm', style: 'dashes' | 'solid' | 'double') => {
    const charsCount = width === '58mm' ? 32 : 46;
    if (style === 'solid') return '─'.repeat(charsCount);
    if (style === 'double') return '═'.repeat(charsCount);
    return '-'.repeat(charsCount);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Actions */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-2xl bg-amber-400 text-black shadow-xs shrink-0">
            <Printer className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-extrabold text-gray-900 dark:text-white">
                Receipt Designer (POS & Bluetooth Thermal)
              </h2>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                settings/receipt
              </span>
            </div>
            <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">
              Customize thermal slip layout, header lines, copy titles, line separators, and merchant vs customer copy visibility.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setConfirmResetOpen(true)}
            disabled={saving || loading}
            className="px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 text-xs font-bold text-gray-700 dark:text-zinc-200 hover:bg-gray-100 dark:hover:bg-zinc-800 flex items-center gap-1.5 transition-colors"
          >
            <RotateCcw className="w-4 h-4 text-gray-500" />
            Reset to default
          </button>

          <button
            type="button"
            onClick={() => setConfirmSaveOpen(true)}
            disabled={saving || loading}
            className="delivio-btn-yellow px-5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 shadow-xs"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Receipt Settings
          </button>
        </div>
      </div>

      {/* Mandatory Fixed Rule Callout */}
      <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-400/40 text-amber-900 dark:text-amber-200 flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="text-xs space-y-1">
          <span className="font-extrabold uppercase tracking-wider block text-amber-800 dark:text-amber-300">
            Fixed Platform Rules (Non-Editable)
          </span>
          <p className="leading-relaxed">
            Thermal receipts <strong>never show tip, service fee, delivery fee, VAT, or grand total</strong>. Only <strong>Subtotal</strong> is printed to maintain privacy between merchant, customer, and driver payout rules.
          </p>
        </div>
      </div>

      {/* Two-Column Workspace: Controls & Live Thermal Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Controls Column */}
        <div className="lg:col-span-7 space-y-6">
          {/* General Branding & Header */}
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-6 shadow-xs space-y-4">
            <h3 className="font-extrabold text-sm text-gray-900 dark:text-white flex items-center gap-2 border-b border-gray-100 dark:border-zinc-800 pb-3">
              <Type className="w-4 h-4 text-amber-500" />
              Brand & Header Information
            </h3>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-zinc-400 mb-1">
                Brand Line (Top Banner)
              </label>
              <input
                type="text"
                value={receiptConfig.brandLine}
                onChange={(e) => updateField('brandLine', e.target.value)}
                placeholder="Delivio"
                className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold text-gray-900 dark:text-white"
              />
              <span className="text-[11px] text-gray-400 mt-1 block">Default: Delivio</span>
            </div>

            {/* Extra Header Lines (0 to 3) */}
            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-zinc-400">
                  Extra Header Lines ({receiptConfig.headerLines?.length || 0}/3)
                </label>
                {(receiptConfig.headerLines?.length || 0) < 3 && (
                  <button
                    type="button"
                    onClick={handleAddHeaderLine}
                    className="text-xs font-bold text-amber-600 dark:text-amber-400 hover:underline flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add line
                  </button>
                )}
              </div>

              {(receiptConfig.headerLines || []).map((line, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="text-xs font-mono text-gray-400 w-4">#{idx + 1}</span>
                  <input
                    type="text"
                    value={line}
                    onChange={(e) => handleUpdateHeaderLine(idx, e.target.value)}
                    placeholder={`Header line ${idx + 1}`}
                    className="flex-1 px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-gray-900 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={() => handleRemoveHeaderLine(idx)}
                    className="p-2 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/20"
                    title="Remove line"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
              {(receiptConfig.headerLines?.length || 0) === 0 && (
                <p className="text-xs text-gray-400 italic">No extra header lines configured (0 of 3).</p>
              )}
            </div>

            {/* Footer Text */}
            <div className="pt-2">
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-zinc-400 mb-1">
                Footer Text
              </label>
              <textarea
                rows={2}
                value={receiptConfig.footerText}
                onChange={(e) => updateField('footerText', e.target.value)}
                placeholder="For support, contact support@delivio.ph"
                className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-gray-900 dark:text-white"
              />
            </div>
          </div>

          {/* Typography, Alignment & Separators */}
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-6 shadow-xs space-y-4">
            <h3 className="font-extrabold text-sm text-gray-900 dark:text-white flex items-center gap-2 border-b border-gray-100 dark:border-zinc-800 pb-3">
              <Sliders className="w-4 h-4 text-amber-500" />
              Styling, Alignment & Separators
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Font Size */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-zinc-400 mb-1.5">
                  Font Size
                </label>
                <div className="grid grid-cols-3 gap-1.5 p-1 bg-gray-100 dark:bg-zinc-800 rounded-xl">
                  {(['small', 'medium', 'large'] as const).map((size) => (
                    <button
                      key={size}
                      type="button"
                      onClick={() => updateField('fontSize', size)}
                      className={`py-1.5 text-xs font-bold capitalize rounded-lg transition-colors ${
                        receiptConfig.fontSize === size
                          ? 'bg-amber-400 text-black shadow-xs'
                          : 'text-gray-600 dark:text-zinc-400 hover:text-black dark:hover:text-white'
                      }`}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>

              {/* Text Alignment */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-zinc-400 mb-1.5">
                  Header Align
                </label>
                <div className="grid grid-cols-2 gap-1.5 p-1 bg-gray-100 dark:bg-zinc-800 rounded-xl">
                  <button
                    type="button"
                    onClick={() => updateField('align', 'center')}
                    className={`py-1.5 text-xs font-bold flex items-center justify-center gap-1 rounded-lg transition-colors ${
                      receiptConfig.align === 'center'
                        ? 'bg-amber-400 text-black shadow-xs'
                        : 'text-gray-600 dark:text-zinc-400 hover:text-black dark:hover:text-white'
                    }`}
                  >
                    <AlignCenter className="w-3.5 h-3.5" /> Center
                  </button>
                  <button
                    type="button"
                    onClick={() => updateField('align', 'left')}
                    className={`py-1.5 text-xs font-bold flex items-center justify-center gap-1 rounded-lg transition-colors ${
                      receiptConfig.align === 'left'
                        ? 'bg-amber-400 text-black shadow-xs'
                        : 'text-gray-600 dark:text-zinc-400 hover:text-black dark:hover:text-white'
                    }`}
                  >
                    <AlignLeft className="w-3.5 h-3.5" /> Left
                  </button>
                </div>
              </div>

              {/* Separator Style */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-zinc-400 mb-1.5">
                  Divider Style
                </label>
                <div className="grid grid-cols-3 gap-1.5 p-1 bg-gray-100 dark:bg-zinc-800 rounded-xl">
                  {(['dashes', 'solid', 'double'] as const).map((sep) => (
                    <button
                      key={sep}
                      type="button"
                      onClick={() => updateField('separator', sep)}
                      className={`py-1.5 text-xs font-bold capitalize rounded-lg transition-colors ${
                        receiptConfig.separator === sep
                          ? 'bg-amber-400 text-black shadow-xs'
                          : 'text-gray-600 dark:text-zinc-400 hover:text-black dark:hover:text-white'
                      }`}
                    >
                      {sep === 'dashes' ? '---' : sep === 'solid' ? '───' : '═══'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Section Visibility Switches */}
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-6 shadow-xs space-y-4">
            <h3 className="font-extrabold text-sm text-gray-900 dark:text-white flex items-center gap-2 border-b border-gray-100 dark:border-zinc-800 pb-3">
              <FileText className="w-4 h-4 text-amber-500" />
              Content Elements Visibility
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex items-center justify-between p-3 rounded-2xl border border-gray-200 dark:border-zinc-800 hover:bg-gray-50/50 dark:hover:bg-zinc-800/40 cursor-pointer">
                <div>
                  <span className="text-xs font-bold text-gray-900 dark:text-white block">Order Number</span>
                  <span className="text-[10px] text-gray-400">Show #10842 at the top</span>
                </div>
                <input
                  type="checkbox"
                  checked={receiptConfig.showOrderId}
                  onChange={(e) => updateField('showOrderId', e.target.checked)}
                  className="rounded text-amber-500 focus:ring-amber-400 w-4 h-4"
                />
              </label>

              <label className="flex items-center justify-between p-3 rounded-2xl border border-gray-200 dark:border-zinc-800 hover:bg-gray-50/50 dark:hover:bg-zinc-800/40 cursor-pointer">
                <div>
                  <span className="text-xs font-bold text-gray-900 dark:text-white block">Ordered Date & Time</span>
                  <span className="text-[10px] text-gray-400">Print timestamp of order</span>
                </div>
                <input
                  type="checkbox"
                  checked={receiptConfig.showOrderedAt}
                  onChange={(e) => updateField('showOrderedAt', e.target.checked)}
                  className="rounded text-amber-500 focus:ring-amber-400 w-4 h-4"
                />
              </label>

              <label className="flex items-center justify-between p-3 rounded-2xl border border-gray-200 dark:border-zinc-800 hover:bg-gray-50/50 dark:hover:bg-zinc-800/40 cursor-pointer">
                <div>
                  <span className="text-xs font-bold text-gray-900 dark:text-white block">Customer Name</span>
                  <span className="text-[10px] text-gray-400">Print customer name & phone</span>
                </div>
                <input
                  type="checkbox"
                  checked={receiptConfig.showCustomerName}
                  onChange={(e) => updateField('showCustomerName', e.target.checked)}
                  className="rounded text-amber-500 focus:ring-amber-400 w-4 h-4"
                />
              </label>

              <label className="flex items-center justify-between p-3 rounded-2xl border border-gray-200 dark:border-zinc-800 hover:bg-gray-50/50 dark:hover:bg-zinc-800/40 cursor-pointer">
                <div>
                  <span className="text-xs font-bold text-gray-900 dark:text-white block">Customer Note</span>
                  <span className="text-[10px] text-gray-400">Special prep or delivery notes</span>
                </div>
                <input
                  type="checkbox"
                  checked={receiptConfig.showNote}
                  onChange={(e) => updateField('showNote', e.target.checked)}
                  className="rounded text-amber-500 focus:ring-amber-400 w-4 h-4"
                />
              </label>

              <label className="flex items-center justify-between p-3 rounded-2xl border border-gray-200 dark:border-zinc-800 hover:bg-gray-50/50 dark:hover:bg-zinc-800/40 cursor-pointer sm:col-span-2">
                <div>
                  <span className="text-xs font-bold text-gray-900 dark:text-white block">Set Choices & Modifiers</span>
                  <span className="text-[10px] text-gray-400">Print item customizations, add-ons, spice levels, and options</span>
                </div>
                <input
                  type="checkbox"
                  checked={receiptConfig.showSetChoices}
                  onChange={(e) => updateField('showSetChoices', e.target.checked)}
                  className="rounded text-amber-500 focus:ring-amber-400 w-4 h-4"
                />
              </label>
            </div>
          </div>

          {/* Merchant vs Customer Copy Configuration */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Merchant Copy */}
            <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-5 shadow-xs space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-gray-100 dark:border-zinc-800">
                <span className="font-extrabold text-xs uppercase tracking-wider text-gray-900 dark:text-white">
                  Merchant Copy
                </span>
                <input
                  type="checkbox"
                  checked={receiptConfig.merchantCopy?.enabled}
                  onChange={(e) => updateMerchantCopy('enabled', e.target.checked)}
                  className="rounded text-amber-500 focus:ring-amber-400 w-4 h-4"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-500 mb-1">Copy Title</label>
                <input
                  type="text"
                  value={receiptConfig.merchantCopy?.title}
                  onChange={(e) => updateMerchantCopy('title', e.target.value)}
                  placeholder="Merchant's Copy"
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold text-gray-900 dark:text-white"
                />
              </div>

              <label className="flex items-center justify-between pt-1 cursor-pointer">
                <span className="text-xs text-gray-600 dark:text-zinc-300">Show item prices</span>
                <input
                  type="checkbox"
                  checked={receiptConfig.merchantCopy?.showItemPrices}
                  onChange={(e) => updateMerchantCopy('showItemPrices', e.target.checked)}
                  className="rounded text-amber-500 focus:ring-amber-400 w-4 h-4"
                />
              </label>
            </div>

            {/* Customer Copy */}
            <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-5 shadow-xs space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-gray-100 dark:border-zinc-800">
                <span className="font-extrabold text-xs uppercase tracking-wider text-gray-900 dark:text-white">
                  Customer Copy
                </span>
                <input
                  type="checkbox"
                  checked={receiptConfig.customerCopy?.enabled}
                  onChange={(e) => updateCustomerCopy('enabled', e.target.checked)}
                  className="rounded text-amber-500 focus:ring-amber-400 w-4 h-4"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-500 mb-1">Copy Title</label>
                <input
                  type="text"
                  value={receiptConfig.customerCopy?.title}
                  onChange={(e) => updateCustomerCopy('title', e.target.value)}
                  placeholder="Customer's Copy"
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold text-gray-900 dark:text-white"
                />
              </div>

              <label className="flex items-center justify-between pt-1 cursor-pointer">
                <span className="text-xs text-gray-600 dark:text-zinc-300">Show item prices</span>
                <input
                  type="checkbox"
                  checked={receiptConfig.customerCopy?.showItemPrices}
                  onChange={(e) => updateCustomerCopy('showItemPrices', e.target.checked)}
                  className="rounded text-amber-500 focus:ring-amber-400 w-4 h-4"
                />
              </label>
            </div>
          </div>
        </div>

        {/* Live Thermal Receipt Preview Column */}
        <div className="lg:col-span-5 sticky top-6 space-y-3">
          {/* Preview Controls Bar */}
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-3 shadow-xs flex items-center justify-between gap-2">
            {/* Paper Width Toggle */}
            <div className="flex items-center gap-1 bg-gray-100 dark:bg-zinc-800 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => setPaperWidth('58mm')}
                className={`px-3 py-1 rounded-lg text-xs font-extrabold transition-colors ${
                  paperWidth === '58mm'
                    ? 'bg-amber-400 text-black shadow-xs'
                    : 'text-gray-500 hover:text-black dark:hover:text-white'
                }`}
              >
                58 mm
              </button>
              <button
                type="button"
                onClick={() => setPaperWidth('80mm')}
                className={`px-3 py-1 rounded-lg text-xs font-extrabold transition-colors ${
                  paperWidth === '80mm'
                    ? 'bg-amber-400 text-black shadow-xs'
                    : 'text-gray-500 hover:text-black dark:hover:text-white'
                }`}
              >
                80 mm
              </button>
            </div>

            {/* Copy Selector */}
            <div className="flex items-center gap-1 bg-gray-100 dark:bg-zinc-800 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => setActivePreviewCopy('merchant')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors ${
                  activePreviewCopy === 'merchant'
                    ? 'bg-white dark:bg-zinc-700 text-amber-600 dark:text-amber-400 shadow-xs'
                    : 'text-gray-500 hover:text-black dark:hover:text-white'
                }`}
              >
                Merchant
              </button>
              <button
                type="button"
                onClick={() => setActivePreviewCopy('customer')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors ${
                  activePreviewCopy === 'customer'
                    ? 'bg-white dark:bg-zinc-700 text-amber-600 dark:text-amber-400 shadow-xs'
                    : 'text-gray-500 hover:text-black dark:hover:text-white'
                }`}
              >
                Customer
              </button>
            </div>
          </div>

          {/* Thermal Paper Realistic Container */}
          <div className="flex justify-center p-4 bg-gray-200 dark:bg-zinc-950 rounded-3xl border border-gray-300 dark:border-zinc-800">
            <div
              className={`bg-[#fdfcf7] text-[#1a1a1a] shadow-xl p-5 transition-all select-none border-t-8 border-t-amber-400 font-mono ${
                paperWidth === '58mm' ? 'w-[290px]' : 'w-[370px]'
              } ${
                receiptConfig.fontSize === 'small'
                  ? 'text-[11px] leading-[15px]'
                  : receiptConfig.fontSize === 'large'
                  ? 'text-[13px] leading-[18px]'
                  : 'text-[12px] leading-[16px]'
              }`}
              style={{
                boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)'
              }}
            >
              {/* Receipt Header */}
              <div className={receiptConfig.align === 'center' ? 'text-center' : 'text-left'}>
                <div className="text-base font-black tracking-widest uppercase mb-0.5">
                  {receiptConfig.brandLine || 'Delivio'}
                </div>

                {(receiptConfig.headerLines || []).map((line, i) => (
                  <div key={i} className="text-gray-700 font-semibold text-[11px]">
                    {line}
                  </div>
                ))}

                {/* Copy Title */}
                <div className="mt-1 font-extrabold uppercase border-y border-dashed border-gray-400 py-1 tracking-wider text-[11px]">
                  *** {activePreviewCopy === 'merchant'
                    ? (receiptConfig.merchantCopy?.title || "Merchant's Copy")
                    : (receiptConfig.customerCopy?.title || "Customer's Copy")} ***
                </div>
              </div>

              {/* Order Metadata */}
              <div className="mt-2 space-y-0.5 text-gray-800">
                {receiptConfig.showOrderId && (
                  <div className="flex justify-between font-bold">
                    <span>ORDER:</span>
                    <span>#10842</span>
                  </div>
                )}
                {receiptConfig.showOrderedAt && (
                  <div className="flex justify-between text-gray-600 text-[10px]">
                    <span>DATE:</span>
                    <span>Nov 4, 2026 12:45 PM</span>
                  </div>
                )}
                {receiptConfig.showCustomerName && (
                  <div className="flex justify-between text-gray-600 text-[10px]">
                    <span>CUST:</span>
                    <span>Maria Santos</span>
                  </div>
                )}
                <div className="flex justify-between text-gray-600 text-[10px]">
                  <span>MERCHANT:</span>
                  <span>Palawan Grill Express</span>
                </div>
              </div>

              {/* Separator */}
              <div className="my-2 overflow-hidden text-gray-500 font-mono tracking-tighter">
                {getSeparatorString(paperWidth, receiptConfig.separator)}
              </div>

              {/* Items List */}
              <div className="space-y-2">
                {/* Item 1 */}
                <div>
                  <div className="flex justify-between font-bold">
                    <span>2x Crispy Sisig Special</span>
                    {((activePreviewCopy === 'merchant' && receiptConfig.merchantCopy?.showItemPrices) ||
                      (activePreviewCopy === 'customer' && receiptConfig.customerCopy?.showItemPrices)) && (
                      <span>₱400.00</span>
                    )}
                  </div>
                  {receiptConfig.showSetChoices && (
                    <div className="pl-3 text-[10px] text-gray-600">
                      <div>&bull; Spicy level: Extra Hot</div>
                      <div>&bull; Add-on: Raw Egg (+₱20.00)</div>
                    </div>
                  )}
                </div>

                {/* Item 2 */}
                <div>
                  <div className="flex justify-between font-bold">
                    <span>1x Garlic Rice</span>
                    {((activePreviewCopy === 'merchant' && receiptConfig.merchantCopy?.showItemPrices) ||
                      (activePreviewCopy === 'customer' && receiptConfig.customerCopy?.showItemPrices)) && (
                      <span>₱35.00</span>
                    )}
                  </div>
                </div>

                {/* Item 3 */}
                <div>
                  <div className="flex justify-between font-bold">
                    <span>2x Calamansi Juice 500ml</span>
                    {((activePreviewCopy === 'merchant' && receiptConfig.merchantCopy?.showItemPrices) ||
                      (activePreviewCopy === 'customer' && receiptConfig.customerCopy?.showItemPrices)) && (
                      <span>₱130.00</span>
                    )}
                  </div>
                  {receiptConfig.showSetChoices && (
                    <div className="pl-3 text-[10px] text-gray-600">
                      <div>&bull; Less Sugar (50%)</div>
                    </div>
                  )}
                </div>
              </div>

              {/* Special Note */}
              {receiptConfig.showNote && (
                <div className="mt-2.5 p-1.5 bg-yellow-50 border border-yellow-200 rounded text-[10px] text-gray-700">
                  <span className="font-bold">NOTE: </span>
                  Extra calamansi & spicy chili sauce on the side please!
                </div>
              )}

              {/* Separator */}
              <div className="my-2 overflow-hidden text-gray-500 font-mono tracking-tighter">
                {getSeparatorString(paperWidth, receiptConfig.separator)}
              </div>

              {/* Subtotal Only - Strict Delivio Fixed POS Rule */}
              <div className="space-y-1">
                <div className="flex justify-between font-black text-sm">
                  <span>SUBTOTAL</span>
                  <span>₱565.00</span>
                </div>
                <div className="text-[9px] text-gray-500 text-center italic">
                  * Fixed POS Policy: Only Subtotal is displayed on receipt slips. *
                </div>
              </div>

              {/* Separator */}
              <div className="my-2 overflow-hidden text-gray-500 font-mono tracking-tighter">
                {getSeparatorString(paperWidth, receiptConfig.separator)}
              </div>

              {/* Footer text */}
              {receiptConfig.footerText && (
                <div className={`text-[10px] text-gray-600 ${receiptConfig.align === 'center' ? 'text-center' : 'text-left'}`}>
                  {receiptConfig.footerText}
                </div>
              )}

              {/* Cut line / barcode mock */}
              <div className="mt-4 pt-3 border-t border-dashed border-gray-400 text-center text-[9px] text-gray-400">
                ═══════ CUT HERE ═══════
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Save Confirmation Modal */}
      <ConfirmationModal
        isOpen={confirmSaveOpen}
        title="Save Thermal Receipt Settings"
        message="This will update the thermal receipt layout and printing configuration across all connected merchant bluetooth printers and POS stations."
        confirmLabel="Save Settings"
        onConfirm={handleSaveReceipt}
        onClose={() => setConfirmSaveOpen(false)}
        isDestructive={false}
      />

      {/* Reset Confirmation Modal */}
      <ConfirmationModal
        isOpen={confirmResetOpen}
        title="Reset Receipt Settings"
        message="Are you sure you want to revert all receipt design controls back to platform default values?"
        confirmLabel="Reset to Default"
        isDestructive={true}
        onConfirm={handleResetToDefault}
        onClose={() => setConfirmResetOpen(false)}
      />
    </div>
  );
};
