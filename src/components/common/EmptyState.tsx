import React from 'react';
import { LucideIcon, Inbox } from 'lucide-react';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon = Inbox,
  title,
  description,
  action
}) => {
  return (
    <div className="flex flex-col items-center justify-center p-12 text-center bg-white dark:bg-zinc-900/50 border border-dashed border-gray-300 dark:border-zinc-800 rounded-2xl w-full">
      <div className="w-14 h-14 rounded-2xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 flex items-center justify-center mb-4">
        <Icon className="w-7 h-7" />
      </div>
      <h4 className="text-base font-bold text-gray-900 dark:text-white mb-1">{title}</h4>
      <p className="text-sm text-gray-500 dark:text-zinc-400 max-w-sm mb-5">{description}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="delivio-btn-yellow px-4 py-2 rounded-xl text-sm font-semibold shadow-xs"
        >
          {action.label}
        </button>
      )}
    </div>
  );
};
