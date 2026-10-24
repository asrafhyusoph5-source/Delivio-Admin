import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Menu,
  Search,
  Bell,
  Sun,
  Moon,
  MapPin,
  ChevronDown,
  Check,
  AlertCircle,
  FileCheck,
  Store,
  Tag,
  ExternalLink
} from 'lucide-react';
import { useCity } from '../../context/CityContext';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { useBadgeCounts } from '../../context/BadgeCountsContext';
import { db, doc, updateDoc } from '../../firebase';
import { formatRelativeTime } from '../../utils/date';

interface TopBarProps {
  onToggleMobileMenu: () => void;
  onOpenProfileDrawer: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  onToggleMobileMenu,
  onOpenProfileDrawer
}) => {
  const { cities, selectedCityId, setSelectedCityId } = useCity();
  const { theme, toggleTheme } = useTheme();
  const { adminProfile } = useAuth();
  const {
    unreadNotificationsCount,
    recentUnreadNotifications,
    totalPendingAppsCount,
    pendingPromoRequestsCount,
    pendingChangeRequestsCount
  } = useBadgeCounts();

  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [showNotifications, setShowNotifications] = useState(false);
  const [cityDropdownOpen, setCityDropdownOpen] = useState(false);

  const notificationsRef = useRef<HTMLDivElement>(null);
  const cityDropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdowns when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        notificationsRef.current &&
        !notificationsRef.current.contains(event.target as Node)
      ) {
        setShowNotifications(false);
      }
      if (
        cityDropdownRef.current &&
        !cityDropdownRef.current.contains(event.target as Node)
      ) {
        setCityDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleGlobalSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    // Default search routing to Live Orders or Customers
    const q = searchQuery.trim();
    // If numeric or starts with order prefix, route to orders
    if (/^\d+$/.test(q) || q.toLowerCase().startsWith('dlv-') || q.toLowerCase().startsWith('ord-')) {
      navigate(`/orders?search=${encodeURIComponent(q)}`);
    } else {
      // Default to search in orders first
      navigate(`/orders?search=${encodeURIComponent(q)}`);
    }
  };

  const markNotificationRead = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await updateDoc(doc(db, 'adminNotifications', id), { read: true });
    } catch (err) {
      console.error('Failed to mark notification read:', err);
    }
  };

  const totalAlerts =
    unreadNotificationsCount +
    totalPendingAppsCount +
    pendingPromoRequestsCount +
    pendingChangeRequestsCount;

  const currentCityName =
    selectedCityId === 'all'
      ? 'All Cities'
      : cities.find((c) => c.id === selectedCityId)?.name || 'Select City';

  return (
    <header className="sticky top-0 z-30 h-16 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-md border-b border-gray-200 dark:border-zinc-800 px-4 flex items-center justify-between gap-4">
      {/* Left section: mobile hamburger & City selector */}
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleMobileMenu}
          className="md:hidden p-2 text-gray-600 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-xl"
          aria-label="Toggle menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Global City Selector */}
        <div className="relative" ref={cityDropdownRef}>
          <button
            onClick={() => setCityDropdownOpen(!cityDropdownOpen)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-gray-200 dark:border-zinc-800 bg-gray-50/80 dark:bg-zinc-900/80 hover:bg-gray-100 dark:hover:bg-zinc-850 text-xs md:text-sm font-semibold text-gray-800 dark:text-zinc-200 transition-colors"
          >
            <MapPin className="w-4 h-4 text-amber-500" />
            <span className="max-w-[120px] md:max-w-[180px] truncate">{currentCityName}</span>
            <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
          </button>

          {cityDropdownOpen && (
            <div className="absolute left-0 mt-2 w-56 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl shadow-xl py-1.5 z-50 animate-in fade-in zoom-in-95 duration-150">
              <div className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-zinc-500 border-b border-gray-100 dark:border-zinc-800">
                Filter Platform By City
              </div>
              <button
                onClick={() => {
                  setSelectedCityId('all');
                  setCityDropdownOpen(false);
                }}
                className={`w-full text-left px-3.5 py-2 text-sm flex items-center justify-between hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors ${
                  selectedCityId === 'all'
                    ? 'font-bold text-amber-600 dark:text-amber-400 bg-amber-50/60 dark:bg-amber-950/20'
                    : 'text-gray-700 dark:text-zinc-300'
                }`}
              >
                <span>All Cities (Global)</span>
                {selectedCityId === 'all' && <Check className="w-4 h-4 text-amber-500" />}
              </button>

              <div className="max-h-60 overflow-y-auto py-1">
                {cities.map((city) => (
                  <button
                    key={city.id}
                    onClick={() => {
                      setSelectedCityId(city.id);
                      setCityDropdownOpen(false);
                    }}
                    className={`w-full text-left px-3.5 py-2 text-sm flex items-center justify-between hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors ${
                      selectedCityId === city.id
                        ? 'font-bold text-amber-600 dark:text-amber-400 bg-amber-50/60 dark:bg-amber-950/20'
                        : 'text-gray-700 dark:text-zinc-300'
                    }`}
                  >
                    <div className="flex flex-col">
                      <span>{city.name}</span>
                      {city.province && (
                        <span className="text-[10px] text-gray-400 dark:text-zinc-500">
                          {city.province}
                        </span>
                      )}
                    </div>
                    {selectedCityId === city.id && <Check className="w-4 h-4 text-amber-500" />}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Center: Global Search */}
      <form
        onSubmit={handleGlobalSearch}
        className="hidden sm:flex items-center flex-1 max-w-md relative"
      >
        <Search className="w-4 h-4 absolute left-3.5 text-gray-400 pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Global search: Order #, name, phone, email..."
          className="w-full pl-9 pr-4 py-2 text-sm rounded-xl border border-gray-200 dark:border-zinc-800 bg-gray-50/70 dark:bg-zinc-900/70 text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-hidden focus:ring-2 focus:ring-amber-400 transition-all"
        />
      </form>

      {/* Right section: Notifications, Theme toggle, Profile avatar */}
      <div className="flex items-center gap-2">
        {/* Notifications Bell */}
        <div className="relative" ref={notificationsRef}>
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            className="relative p-2 text-gray-600 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-xl transition-colors"
            title="Notifications"
          >
            <Bell className="w-5 h-5" />
            {totalAlerts > 0 && (
              <span className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center animate-pulse">
                {totalAlerts > 9 ? '9+' : totalAlerts}
              </span>
            )}
          </button>

          {/* Notifications Dropdown */}
          {showNotifications && (
            <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl shadow-2xl py-2 z-50 animate-in fade-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100 dark:border-zinc-800">
                <div className="font-bold text-sm text-gray-900 dark:text-white flex items-center gap-2">
                  <span>Notifications</span>
                  {totalAlerts > 0 && (
                    <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                      {totalAlerts} pending
                    </span>
                  )}
                </div>
                <button
                  onClick={() => {
                    setShowNotifications(false);
                    navigate('/notifications');
                  }}
                  className="text-xs text-amber-600 dark:text-amber-400 font-semibold hover:underline flex items-center gap-1"
                >
                  View All <ExternalLink className="w-3 h-3" />
                </button>
              </div>

              {/* Actionable alerts cards */}
              <div className="p-2 space-y-1.5 max-h-80 overflow-y-auto">
                {totalPendingAppsCount > 0 && (
                  <div
                    onClick={() => {
                      setShowNotifications(false);
                      navigate('/applications');
                    }}
                    className="flex items-start gap-3 p-2.5 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200/50 dark:border-red-900/30 cursor-pointer hover:bg-red-100/60 transition-colors"
                  >
                    <FileCheck className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                    <div className="flex-1 text-xs">
                      <p className="font-bold text-red-900 dark:text-red-300">
                        {totalPendingAppsCount} Application(s) Pending Review
                      </p>
                      <p className="text-red-700/80 dark:text-red-400/80 mt-0.5">
                        New merchant and driver applications waiting for approval.
                      </p>
                    </div>
                  </div>
                )}

                {pendingChangeRequestsCount > 0 && (
                  <div
                    onClick={() => {
                      setShowNotifications(false);
                      navigate('/merchants');
                    }}
                    className="flex items-start gap-3 p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200/50 dark:border-amber-900/30 cursor-pointer hover:bg-amber-100/60 transition-colors"
                  >
                    <Store className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                    <div className="flex-1 text-xs">
                      <p className="font-bold text-amber-900 dark:text-amber-300">
                        {pendingChangeRequestsCount} Merchant Change Request(s)
                      </p>
                      <p className="text-amber-700/80 dark:text-amber-400/80 mt-0.5">
                        Shop name, email, or category changes pending.
                      </p>
                    </div>
                  </div>
                )}

                {pendingPromoRequestsCount > 0 && (
                  <div
                    onClick={() => {
                      setShowNotifications(false);
                      navigate('/banners');
                    }}
                    className="flex items-start gap-3 p-2.5 rounded-xl bg-purple-50 dark:bg-purple-950/30 border border-purple-200/50 dark:border-purple-900/30 cursor-pointer hover:bg-purple-100/60 transition-colors"
                  >
                    <Tag className="w-5 h-5 text-purple-500 shrink-0 mt-0.5" />
                    <div className="flex-1 text-xs">
                      <p className="font-bold text-purple-900 dark:text-purple-300">
                        {pendingPromoRequestsCount} Promo Request(s)
                      </p>
                      <p className="text-purple-700/80 dark:text-purple-400/80 mt-0.5">
                        Partner requested promotions waiting for banner creation.
                      </p>
                    </div>
                  </div>
                )}

                {/* Firestore adminNotifications */}
                {recentUnreadNotifications.map((notif) => (
                  <div
                    key={notif.id}
                    onClick={() => {
                      setShowNotifications(false);
                      navigate('/notifications');
                    }}
                    className="flex items-start justify-between gap-2 p-2.5 rounded-xl bg-gray-50 dark:bg-zinc-800/60 hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                  >
                    <div className="flex items-start gap-2.5">
                      <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs font-semibold text-gray-900 dark:text-white">
                          {notif.title}
                        </p>
                        <p className="text-[11px] text-gray-500 dark:text-zinc-400 line-clamp-1">
                          {notif.message}
                        </p>
                        <span className="text-[10px] text-gray-400">
                          {formatRelativeTime(notif.createdAt)}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={(e) => markNotificationRead(notif.id, e)}
                      title="Mark as read"
                      className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-zinc-200 rounded-md"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}

                {totalAlerts === 0 && (
                  <div className="text-center py-6 text-gray-400 text-xs">
                    No unread notifications
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Theme Toggle Button */}
        <button
          onClick={toggleTheme}
          className="p-2 text-gray-600 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-xl transition-colors"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? (
            <Sun className="w-5 h-5 text-amber-400" />
          ) : (
            <Moon className="w-5 h-5 text-gray-600" />
          )}
        </button>

        {/* Admin Avatar button */}
        <button
          onClick={onOpenProfileDrawer}
          className="flex items-center gap-2 p-1 pl-1.5 rounded-xl hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors"
          title="Open admin profile"
        >
          <div className="w-8 h-8 rounded-xl bg-amber-400 text-black font-bold text-xs flex items-center justify-center overflow-hidden border border-amber-500/30">
            {adminProfile?.photoUrl ? (
              <img
                src={adminProfile.photoUrl}
                alt={adminProfile.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <span>{adminProfile?.name?.charAt(0)?.toUpperCase() || 'A'}</span>
            )}
          </div>
          <span className="hidden lg:block text-xs font-bold text-gray-800 dark:text-zinc-200 max-w-[100px] truncate">
            {adminProfile?.name || 'Admin'}
          </span>
        </button>
      </div>
    </header>
  );
};
