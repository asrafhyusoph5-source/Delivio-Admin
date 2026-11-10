import React from 'react';
import { X, Download, ZoomIn } from 'lucide-react';

interface ImageLightboxModalProps {
  imageUrl: string | null;
  onClose: () => void;
  title?: string;
}

export const ImageLightboxModal: React.FC<ImageLightboxModalProps> = ({
  imageUrl,
  onClose,
  title = 'Chat Image'
}) => {
  if (!imageUrl) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="relative max-w-4xl max-h-[90vh] bg-zinc-950 border border-zinc-800 rounded-3xl p-3 sm:p-4 shadow-2xl flex flex-col items-center overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Bar */}
        <div className="w-full flex items-center justify-between pb-2 mb-2 border-b border-zinc-800 text-zinc-300">
          <div className="flex items-center gap-2">
            <ZoomIn className="w-4 h-4 text-amber-400" />
            <span className="text-xs font-bold">{title}</span>
          </div>

          <div className="flex items-center gap-2">
            <a
              href={imageUrl}
              download="chat-photo.jpg"
              className="p-1.5 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
              title="Download Image"
            >
              <Download className="w-4 h-4" />
            </a>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
              title="Close (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Image Preview */}
        <div className="max-h-[80vh] overflow-auto flex items-center justify-center rounded-2xl bg-black/40">
          <img
            src={imageUrl}
            alt={title}
            className="max-h-[75vh] w-auto max-w-full object-contain rounded-xl shadow-lg"
          />
        </div>
      </div>
    </div>
  );
};
