import React, { useState, useRef, useEffect } from 'react';
import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { ProfileDrawer } from './ProfileDrawer';
import { useAuth } from '../../context/AuthContext';
import { Loader2 } from 'lucide-react';

export const Layout: React.FC = () => {
  const { currentUser, adminProfile, loading } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileDrawerOpen, setProfileDrawerOpen] = useState(false);
  const location = useLocation();

  // Touch listener for swiping left to open profile drawer
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const handleTouchStart = (e: TouchEvent) => {
      touchStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY
      };
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (!touchStartRef.current) return;
      const deltaX = e.changedTouches[0].clientX - touchStartRef.current.x;
      const deltaY = e.changedTouches[0].clientY - touchStartRef.current.y;

      // Swiping left from right area or anywhere horizontally
      if (deltaX < -70 && Math.abs(deltaY) < 50) {
        setProfileDrawerOpen(true);
      }
      touchStartRef.current = null;
    };

    window.addEventListener('touchstart', handleTouchStart);
    window.addEventListener('touchend', handleTouchEnd);
    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 dark:bg-zinc-950 text-gray-900 dark:text-white">
        <div className="w-12 h-12 rounded-2xl bg-amber-400 flex items-center justify-center shadow-lg shadow-amber-400/30 mb-4 animate-bounce">
          <span className="font-black text-black text-2xl">D</span>
        </div>
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-600 dark:text-zinc-400">
          <Loader2 className="w-4 h-4 animate-spin text-amber-500" />
          <span>Verifying Delivio Admin credentials...</span>
        </div>
      </div>
    );
  }

  if (!currentUser || !adminProfile) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-950 text-gray-900 dark:text-zinc-100 flex transition-colors">
      {/* Sidebar */}
      <Sidebar
        collapsed={collapsed}
        setCollapsed={setCollapsed}
        mobileOpen={mobileOpen}
        setMobileOpen={setMobileOpen}
      />

      {/* Main Container */}
      <div
        className={`flex-1 flex flex-col min-w-0 transition-all duration-300 ${
          collapsed ? 'md:ml-20' : 'md:ml-64'
        }`}
      >
        <TopBar
          onToggleMobileMenu={() => setMobileOpen(!mobileOpen)}
          onOpenProfileDrawer={() => setProfileDrawerOpen(true)}
        />

        <main className="flex-1 p-4 md:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          <Outlet />
        </main>
      </div>

      {/* Profile Drawer */}
      <ProfileDrawer
        isOpen={profileDrawerOpen}
        onClose={() => setProfileDrawerOpen(false)}
      />
    </div>
  );
};
