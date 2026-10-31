import React from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ToastProvider } from './context/ToastContext';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider } from './context/AuthContext';
import { CityProvider } from './context/CityContext';
import { BadgeCountsProvider } from './context/BadgeCountsContext';
import { Layout } from './components/layout/Layout';

// Pages
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { LiveMap } from './pages/LiveMap';
import { LiveOrders } from './pages/LiveOrders';
import { Customers } from './pages/Customers';
import { WalletTransfers } from './pages/WalletTransfers';
import { Merchants } from './pages/Merchants';
import { Riders } from './pages/Riders';
import { Applications } from './pages/Applications';
import { DeliveryRates } from './pages/DeliveryRates';
import { BannersPromos } from './pages/BannersPromos';
import { Inbox } from './pages/Inbox';
import { TiersCoins } from './pages/TiersCoins';
import { Notifications } from './pages/Notifications';
import { Reports } from './pages/Reports';
import { AuditLog } from './pages/AuditLog';
import { Settings } from './pages/Settings';
import { ServicesByCity } from './pages/ServicesByCity';

export default function App() {
  return (
    <ToastProvider>
      <ThemeProvider>
        <AuthProvider>
          <CityProvider>
            <BadgeCountsProvider>
              <HashRouter>
                <Routes>
                  {/* Public Authentication */}
                  <Route path="/login" element={<Login />} />

                  {/* Protected Master Console */}
                  <Route path="/" element={<Layout />}>
                    <Route index element={<Dashboard />} />
                    <Route path="map" element={<LiveMap />} />
                    <Route path="orders" element={<LiveOrders />} />
                    <Route path="customers" element={<Customers />} />
                    <Route path="wallet-transfers" element={<WalletTransfers />} />
                    <Route path="merchants" element={<Merchants />} />
                    <Route path="riders" element={<Riders />} />
                    <Route path="applications" element={<Applications />} />
                    <Route path="rates" element={<DeliveryRates />} />
                    <Route path="services-by-city" element={<ServicesByCity />} />
                    <Route path="banners" element={<BannersPromos />} />
                    <Route path="inbox" element={<Inbox />} />
                    <Route path="tiers" element={<TiersCoins />} />
                    <Route path="notifications" element={<Notifications />} />
                    <Route path="reports" element={<Reports />} />
                    <Route path="audit" element={<AuditLog />} />
                    <Route path="settings" element={<Settings />} />
                  </Route>

                  {/* Fallback */}
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </HashRouter>
            </BadgeCountsProvider>
          </CityProvider>
        </AuthProvider>
      </ThemeProvider>
    </ToastProvider>
  );
}
