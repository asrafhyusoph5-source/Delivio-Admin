import React from 'react';

export const CardSkeleton: React.FC<{ count?: number; className?: string }> = ({ count = 1, className = '' }) => {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={`bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-5 animate-pulse ${className}`}
        >
          <div className="flex items-center justify-between mb-4">
            <div className="h-4 bg-gray-200 dark:bg-zinc-800 rounded-md w-1/3"></div>
            <div className="h-8 w-8 bg-gray-200 dark:bg-zinc-800 rounded-full"></div>
          </div>
          <div className="h-8 bg-gray-300 dark:bg-zinc-700 rounded-lg w-2/3 mb-2"></div>
          <div className="h-3 bg-gray-200 dark:bg-zinc-800 rounded-md w-1/2"></div>
        </div>
      ))}
    </>
  );
};

export const TableSkeleton: React.FC<{ rows?: number; cols?: number }> = ({ rows = 5, cols = 5 }) => {
  return (
    <div className="w-full bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl overflow-hidden p-4 animate-pulse">
      <div className="h-10 bg-gray-100 dark:bg-zinc-800 rounded-xl mb-4"></div>
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex gap-4 items-center">
            {Array.from({ length: cols }).map((_, c) => (
              <div
                key={c}
                className="h-7 bg-gray-200 dark:bg-zinc-800/60 rounded-md flex-1"
              ></div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};
