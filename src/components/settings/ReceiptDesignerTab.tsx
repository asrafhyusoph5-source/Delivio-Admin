import React, { useState } from 'react';
import type { ReceiptDesignConfig } from '../../types';
import {
  Plus,
  Trash2,
  FileText,
  Sliders,
  Type,
  AlignLeft,
  AlignCenter,
  ShieldCheck,
  Loader2,
  Printer
} from 'lucide-react';

interface ReceiptDesignerTabProps {
  receiptConfig: ReceiptDesignConfig;
  onConfigChange: (config: ReceiptDesignConfig) => void;
  loading: boolean;
  previewRef?: React.RefObject<HTMLDivElement | null>;
}

export const ReceiptDesignerTab: React.FC<ReceiptDesignerTabProps> = ({
  receiptConfig,
  onConfigChange,
  loading,
  previewRef
}) => {
  const [paperWidth, setPaperWidth] = useState<'58mm' | '80mm'>('58mm');
  const [activePreviewCopy, setActivePreviewCopy] = useState<'merchant' | 'customer'>('merchant');

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

  // Separator line characters
  const getSeparatorString = (width: '58mm' | '80mm', style: 'dashes' | 'solid' | 'double') => {
    const charsCount = width === '58mm' ? 32 : 46;
    if (style === 'solid') return '─'.repeat(charsCount);
    if (style === 'double') return '═'.repeat(charsCount);
    return '-'.repeat(charsCount);
  };

  if (loading) {
    return (
      <div className="p-16 text-center bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl">
        <Loader2 className="w-8 h-8 animate-spin text-amber-500 mx-auto mb-3" />
        <p className="text-xs font-semibold text-gray-500">
          Loading thermal receipt settings...
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 min-w-0">
      {/* Mandatory Fixed Rule Callout */}
      <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-400/40 text-amber-900 dark:text-amber-200 flex items-start gap-3 min-w-0">
        <ShieldCheck className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="text-xs space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-extrabold uppercase tracking-wider text-amber-800 dark:text-amber-300">
              Fixed Platform Rules (Non-Editable)
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
              settings/receipt
            </span>
          </div>
          <p className="leading-relaxed">
            Thermal receipts <strong>never show tip, service fee, delivery fee, VAT, or grand total</strong>. Only <strong>Subtotal</strong> is printed to maintain privacy between merchant, customer, and driver payout rules.
          </p>
        </div>
      </div>

      {/* Two-Column Workspace: Controls & Live Thermal Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start min-w-0">
        {/* Controls Column */}
        <div className="lg:col-span-7 space-y-6 min-w-0">
          {/* General Branding & Header */}
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-4 sm:p-6 shadow-xs space-y-4 min-w-0">
            <h3 className="font-extrabold text-sm text-gray-900 dark:text-white flex items-center gap-2 border-b border-gray-100 dark:border-zinc-800 pb-3">
              <Type className="w-4 h-4 text-amber-500 shrink-0" />
              <span>Brand &amp; Header Information</span>
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
            <div className="space-y-2 pt-2 min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
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
                <div key={idx} className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-mono text-gray-400 w-5 shrink-0">#{idx + 1}</span>
                  <input
                    type="text"
                    value={line}
                    onChange={(e) => handleUpdateHeaderLine(idx, e.target.value)}
                    placeholder={`Header line ${idx + 1}`}
                    className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-gray-900 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={() => handleRemoveHeaderLine(idx)}
                    className="p-2 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/20 shrink-0"
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
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-4 sm:p-6 shadow-xs space-y-4 min-w-0">
            <h3 className="font-extrabold text-sm text-gray-900 dark:text-white flex items-center gap-2 border-b border-gray-100 dark:border-zinc-800 pb-3">
              <Sliders className="w-4 h-4 text-amber-500 shrink-0" />
              <span>Styling, Alignment &amp; Separators</span>
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
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-4 sm:p-6 shadow-xs space-y-4 min-w-0">
            <h3 className="font-extrabold text-sm text-gray-900 dark:text-white flex items-center gap-2 border-b border-gray-100 dark:border-zinc-800 pb-3">
              <FileText className="w-4 h-4 text-amber-500 shrink-0" />
              <span>Content Elements Visibility</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex items-center justify-between gap-3 p-3 rounded-2xl border border-gray-200 dark:border-zinc-800 hover:bg-gray-50/50 dark:hover:bg-zinc-800/40 cursor-pointer min-w-0">
                <div className="min-w-0">
                  <span className="text-xs font-bold text-gray-900 dark:text-white block">Order Number</span>
                  <span className="text-[10px] text-gray-400 block">Show #10842 at the top</span>
                </div>
                <input
                  type="checkbox"
                  checked={receiptConfig.showOrderId}
                  onChange={(e) => updateField('showOrderId', e.target.checked)}
                  className="rounded text-amber-500 focus:ring-amber-400 w-4 h-4 shrink-0"
                />
              </label>

              <label className="flex items-center justify-between gap-3 p-3 rounded-2xl border border-gray-200 dark:border-zinc-800 hover:bg-gray-50/50 dark:hover:bg-zinc-800/40 cursor-pointer min-w-0">
                <div className="min-w-0">
                  <span className="text-xs font-bold text-gray-900 dark:text-white block">Ordered Date &amp; Time</span>
                  <span className="text-[10px] text-gray-400 block">Print timestamp of order</span>
                </div>
                <input
                  type="checkbox"
                  checked={receiptConfig.showOrderedAt}
                  onChange={(e) => updateField('showOrderedAt', e.target.checked)}
                  className="rounded text-amber-500 focus:ring-amber-400 w-4 h-4 shrink-0"
                />
              </label>

              <label className="flex items-center justify-between gap-3 p-3 rounded-2xl border border-gray-200 dark:border-zinc-800 hover:bg-gray-50/50 dark:hover:bg-zinc-800/40 cursor-pointer min-w-0">
                <div className="min-w-0">
                  <span className="text-xs font-bold text-gray-900 dark:text-white block">Customer Name</span>
                  <span className="text-[10px] text-gray-400 block">Print customer name &amp; phone</span>
                </div>
                <input
                  type="checkbox"
                  checked={receiptConfig.showCustomerName}
                  onChange={(e) => updateField('showCustomerName', e.target.checked)}
                  className="rounded text-amber-500 focus:ring-amber-400 w-4 h-4 shrink-0"
                />
              </label>

              <label className="flex items-center justify-between gap-3 p-3 rounded-2xl border border-gray-200 dark:border-zinc-800 hover:bg-gray-50/50 dark:hover:bg-zinc-800/40 cursor-pointer min-w-0">
                <div className="min-w-0">
                  <span className="text-xs font-bold text-gray-900 dark:text-white block">Customer Note</span>
                  <span className="text-[10px] text-gray-400 block">Special prep or delivery notes</span>
                </div>
                <input
                  type="checkbox"
                  checked={receiptConfig.showNote}
                  onChange={(e) => updateField('showNote', e.target.checked)}
                  className="rounded text-amber-500 focus:ring-amber-400 w-4 h-4 shrink-0"
                />
              </label>

              <label className="flex items-center justify-between gap-3 p-3 rounded-2xl border border-gray-200 dark:border-zinc-800 hover:bg-gray-50/50 dark:hover:bg-zinc-800/40 cursor-pointer sm:col-span-2 min-w-0">
                <div className="min-w-0">
                  <span className="text-xs font-bold text-gray-900 dark:text-white block">Set Choices &amp; Modifiers</span>
                  <span className="text-[10px] text-gray-400 block">Print item customizations, add-ons, spice levels, and options</span>
                </div>
                <input
                  type="checkbox"
                  checked={receiptConfig.showSetChoices}
                  onChange={(e) => updateField('showSetChoices', e.target.checked)}
                  className="rounded text-amber-500 focus:ring-amber-400 w-4 h-4 shrink-0"
                />
              </label>
            </div>
          </div>

          {/* Merchant vs Customer Copy Configuration */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 min-w-0">
            {/* Merchant Copy */}
            <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-4 sm:p-5 shadow-xs space-y-3 min-w-0">
              <div className="flex items-center justify-between pb-2 border-b border-gray-100 dark:border-zinc-800">
                <span className="font-extrabold text-xs uppercase tracking-wider text-gray-900 dark:text-white">
                  Merchant Copy
                </span>
                <input
                  type="checkbox"
                  checked={receiptConfig.merchantCopy?.enabled}
                  onChange={(e) => updateMerchantCopy('enabled', e.target.checked)}
                  className="rounded text-amber-500 focus:ring-amber-400 w-4 h-4 shrink-0"
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
                  className="rounded text-amber-500 focus:ring-amber-400 w-4 h-4 shrink-0"
                />
              </label>
            </div>

            {/* Customer Copy */}
            <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-4 sm:p-5 shadow-xs space-y-3 min-w-0">
              <div className="flex items-center justify-between pb-2 border-b border-gray-100 dark:border-zinc-800">
                <span className="font-extrabold text-xs uppercase tracking-wider text-gray-900 dark:text-white">
                  Customer Copy
                </span>
                <input
                  type="checkbox"
                  checked={receiptConfig.customerCopy?.enabled}
                  onChange={(e) => updateCustomerCopy('enabled', e.target.checked)}
                  className="rounded text-amber-500 focus:ring-amber-400 w-4 h-4 shrink-0"
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
                  className="rounded text-amber-500 focus:ring-amber-400 w-4 h-4 shrink-0"
                />
              </label>
            </div>
          </div>
        </div>

        {/* Live Thermal Receipt Preview Column */}
        <div
          id="receipt-live-preview"
          ref={previewRef}
          className="lg:col-span-5 lg:sticky lg:top-40 space-y-3 min-w-0 scroll-mt-40"
        >
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-extrabold uppercase tracking-wider text-gray-500 dark:text-zinc-400 flex items-center gap-1.5">
              <Printer className="w-3.5 h-3.5 text-amber-500" />
              <span>Live Receipt Preview</span>
            </span>
            <span className="text-[11px] text-gray-400">{paperWidth} thermal</span>
          </div>

          {/* Preview Controls Bar */}
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-2.5 sm:p-3 shadow-xs flex flex-wrap items-center justify-between gap-2">
            {/* Paper Width Toggle */}
            <div className="flex items-center gap-1 bg-gray-100 dark:bg-zinc-800 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => setPaperWidth('58mm')}
                className={`px-3 py-1 rounded-lg text-xs font-extrabold whitespace-nowrap transition-colors ${
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
                className={`px-3 py-1 rounded-lg text-xs font-extrabold whitespace-nowrap transition-colors ${
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
                className={`px-2.5 py-1 rounded-lg text-xs font-bold whitespace-nowrap transition-colors ${
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
                className={`px-2.5 py-1 rounded-lg text-xs font-bold whitespace-nowrap transition-colors ${
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
          <div className="flex justify-center p-3 sm:p-4 bg-gray-200 dark:bg-zinc-950 rounded-3xl border border-gray-300 dark:border-zinc-800 min-w-0">
            <div
              className={`bg-[#fdfcf7] text-[#1a1a1a] shadow-xl p-4 sm:p-5 transition-all select-none border-t-8 border-t-amber-400 font-mono w-full min-w-0 ${
                paperWidth === '58mm' ? 'max-w-[290px]' : 'max-w-[370px]'
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
                <div className="text-base font-black tracking-widest uppercase mb-0.5 break-words">
                  {receiptConfig.brandLine || 'Delivio'}
                </div>

                {(receiptConfig.headerLines || []).map((line, i) => (
                  <div key={i} className="text-gray-700 font-semibold text-[11px] break-words">
                    {line}
                  </div>
                ))}

                {/* Copy Title */}
                <div className="mt-1 font-extrabold uppercase border-y border-dashed border-gray-400 py-1 tracking-wider text-[11px] break-words">
                  ***{' '}
                  {activePreviewCopy === 'merchant'
                    ? receiptConfig.merchantCopy?.title || "Merchant's Copy"
                    : receiptConfig.customerCopy?.title || "Customer's Copy"}{' '}
                  ***
                </div>
              </div>

              {/* Order Metadata */}
              <div className="mt-2 space-y-0.5 text-gray-800">
                {receiptConfig.showOrderId && (
                  <div className="flex justify-between gap-2 font-bold">
                    <span>ORDER:</span>
                    <span>#10842</span>
                  </div>
                )}
                {receiptConfig.showOrderedAt && (
                  <div className="flex justify-between gap-2 text-gray-600 text-[10px]">
                    <span>DATE:</span>
                    <span className="text-right">Nov 4, 2026 12:45 PM</span>
                  </div>
                )}
                {receiptConfig.showCustomerName && (
                  <div className="flex justify-between gap-2 text-gray-600 text-[10px]">
                    <span>CUST:</span>
                    <span className="text-right">Maria Santos</span>
                  </div>
                )}
                <div className="flex justify-between gap-2 text-gray-600 text-[10px]">
                  <span>MERCHANT:</span>
                  <span className="text-right">Palawan Grill Express</span>
                </div>
              </div>

              {/* Separator */}
              <div className="my-2 overflow-hidden whitespace-nowrap text-gray-500 font-mono tracking-tighter">
                {getSeparatorString(paperWidth, receiptConfig.separator)}
              </div>

              {/* Items List */}
              <div className="space-y-2">
                {/* Item 1 */}
                <div>
                  <div className="flex justify-between gap-2 font-bold">
                    <span>2x Crispy Sisig Special</span>
                    {((activePreviewCopy === 'merchant' && receiptConfig.merchantCopy?.showItemPrices) ||
                      (activePreviewCopy === 'customer' && receiptConfig.customerCopy?.showItemPrices)) && (
                      <span className="shrink-0">₱400.00</span>
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
                  <div className="flex justify-between gap-2 font-bold">
                    <span>1x Garlic Rice</span>
                    {((activePreviewCopy === 'merchant' && receiptConfig.merchantCopy?.showItemPrices) ||
                      (activePreviewCopy === 'customer' && receiptConfig.customerCopy?.showItemPrices)) && (
                      <span className="shrink-0">₱35.00</span>
                    )}
                  </div>
                </div>

                {/* Item 3 */}
                <div>
                  <div className="flex justify-between gap-2 font-bold">
                    <span>2x Calamansi Juice 500ml</span>
                    {((activePreviewCopy === 'merchant' && receiptConfig.merchantCopy?.showItemPrices) ||
                      (activePreviewCopy === 'customer' && receiptConfig.customerCopy?.showItemPrices)) && (
                      <span className="shrink-0">₱130.00</span>
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
                <div className="mt-2.5 p-1.5 bg-yellow-50 border border-yellow-200 rounded text-[10px] text-gray-700 break-words">
                  <span className="font-bold">NOTE: </span>
                  Extra calamansi &amp; spicy chili sauce on the side please!
                </div>
              )}

              {/* Separator */}
              <div className="my-2 overflow-hidden whitespace-nowrap text-gray-500 font-mono tracking-tighter">
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
              <div className="my-2 overflow-hidden whitespace-nowrap text-gray-500 font-mono tracking-tighter">
                {getSeparatorString(paperWidth, receiptConfig.separator)}
              </div>

              {/* Footer text */}
              {receiptConfig.footerText && (
                <div
                  className={`text-[10px] text-gray-600 break-words ${
                    receiptConfig.align === 'center' ? 'text-center' : 'text-left'
                  }`}
                >
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
    </div>
  );
};
