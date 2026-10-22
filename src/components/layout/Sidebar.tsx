import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  MapPin,
  ShoppingBag,
  Users,
  Store,
  Bike,
  FileCheck,
  Coins,
  Ticket,
  Mail,
  Award,
  BarChart3,
  ShieldAlert,
  Settings,
  ChevronLeft,
  ChevronRight,
  Sparkles
} from 'lucide-react';
import { useBadgeCounts } from '../../context/BadgeCountsContext';

interface SidebarProps {
  collapsed: boolean;
  setCollapsed: (val: boolean) => void;
  mobileOpen: boolean;
  setMobileOpen: (val: boolean) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  collapsed,
  setCollapsed,
  mobileOpen,
  setMobileOpen
}) => {
  const {
    totalPendingAppsCount,
    pendingPromoRequestsCount,
    pendingTierEventsCount,
    pendingChangeRequestsCount
  } = useBadgeCounts();

  const navItems = [
    { name: 'Dashboard', path: '/', icon: LayoutDashboard },
    { name: 'Live Map', path: '/map', icon: MapPin },
    { name: 'Live Orders', path: '/orders', icon: ShoppingBag },
    { name: 'Customers', path: '/customers', icon: Users },
    {
      name: 'Merchants',
      path: '/merchants',
      icon: Store,
      badge: pendingChangeRequestsCount > 0 ? pendingChangeRequestsCount : undefined,
      badgeColor: 'bg-amber-500'
    },
    { name: 'Riders', path: '/riders', icon: Bike },
    {
      name: 'Applications',
      path: '/applications',
      icon: FileCheck,
      badge: totalPendingAppsCount > 0 ? totalPendingAppsCount : undefined,
      badgeColor: 'bg-red-500'
    },
    { name: 'Delivery Rates', path: '/rates', icon: Coins },
    {
      name: 'Banners & Promos',
      path: '/banners',
      icon: Ticket,
      badge: pendingPromoRequestsCount > 0 ? pendingPromoRequestsCount : undefined,
      badgeColor: 'bg-purple-500'
    },
    { name: 'Inbox', path: '/inbox', icon: Mail },
    {
      name: 'Tiers & Coins',
      path: '/tiers',
      icon: Award,
      badge: pendingTierEventsCount > 0 ? pendingTierEventsCount : undefined,
      badgeColor: 'bg-amber-500'
    },
    { name: 'Reports', path: '/reports', icon: BarChart3 },
    { name: 'Audit Log', path: '/audit', icon: ShieldAlert },
    { name: 'Settings', path: '/settings', icon: Settings },
  ];

  return (
    <>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={`fixed top-0 bottom-0 left-0 z-40 flex flex-col bg-white dark:bg-zinc-950 border-r border-gray-200 dark:border-zinc-800 transition-all duration-300 ease-in-out md:translate-x-0 ${
          mobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full md:translate-x-0'
        } ${collapsed ? 'w-20' : 'w-64'}`}
      >
        {/* Brand Header */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-gray-100 dark:border-zinc-850">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-10 h-10 rounded-xl bg-amber-400 flex items-center justify-center shrink-0 shadow-md shadow-amber-400/30">
              <span className="font-extrabold text-black text-xl tracking-tighter">D</span>
            </div>
            {!collapsed && (
              <div className="flex flex-col">
                <span className="font-extrabold text-base tracking-tight text-gray-900 dark:text-white leading-tight flex items-center gap-1.5">
                  Delivio <span className="text-amber-500 font-black">Admin</span>
                </span>
                <span className="text-[10px] uppercase font-bold tracking-wider text-amber-600 dark:text-amber-400">
                  Control Center
                </span>
              </div>
            )}
          </div>

          <button
            onClick={() => setCollapsed(!collapsed)}
            className="hidden md:flex p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors"
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>

        {/* Navigation list */}
        <div className="flex-1 overflow-y-auto py-3 px-3 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === '/'}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  `group relative flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium text-sm transition-all duration-150 ${
                    isActive
                      ? 'bg-amber-400 text-black font-semibold shadow-sm shadow-amber-400/20'
                      : 'text-gray-600 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-900 hover:text-gray-900 dark:hover:text-zinc-100'
                  } ${collapsed ? 'justify-center px-0' : ''}`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon
                      className={`w-5 h-5 shrink-0 ${
                        isActive
                          ? 'text-black'
                          : 'text-gray-400 group-hover:text-gray-700 dark:text-zinc-500 dark:group-hover:text-zinc-300'
                      }`}
                    />
                    {!collapsed && <span className="truncate">{item.name}</span>}

                    {/* Badge */}
                    {item.badge !== undefined && (
                      <span
                        className={`ml-auto shrink-0 px-2 py-0.5 text-xs font-bold text-white rounded-full ${
                          item.badgeColor || 'bg-amber-500'
                        } ${collapsed ? 'absolute top-1 right-2 w-4 h-4 p-0 flex items-center justify-center text-[10px]' : ''}`}
                      >
                        {item.badge}
                      </span>
                    )}

                    {/* Tooltip in collapsed state */}
                    {collapsed && (
                      <div className="absolute left-full ml-3 px-2.5 py-1 bg-zinc-900 text-white text-xs rounded-md shadow-md opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50">
                        {item.name}
                        {item.badge !== undefined && ` (${item.badge})`}
                      </div>
                    )}
                  </>
                )}
              </NavLink>
            );
          })}
        </div>

        {/* Sidebar Footer info */}
        {!collapsed && (
          <div className="p-4 m-3 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-900/40">
            <div className="flex items-center gap-2 text-xs font-bold text-amber-900 dark:text-amber-300 mb-1">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              <span>Realtime Live Platform</span>
            </div>
            <p className="text-[11px] text-amber-800/80 dark:text-amber-400/80 leading-snug">
              Connected to Delivio Customer, Partner & Rider apps.
            </p>
          </div>
        )}
      </aside>
    </>
  );
};
