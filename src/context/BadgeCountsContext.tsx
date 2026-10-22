import React, { createContext, useContext, useEffect, useState } from 'react';
import { db, collection, query, where, onSnapshot } from '../firebase';
import { useAuth } from './AuthContext';
import type { AdminNotification } from '../types';

interface BadgeCountsContextType {
  pendingMerchantAppsCount: number;
  pendingRiderAppsCount: number;
  totalPendingAppsCount: number;
  unreadNotificationsCount: number;
  pendingPromoRequestsCount: number;
  pendingChangeRequestsCount: number;
  pendingTierEventsCount: number;
  activeOrdersCount: number;
  onlineRidersCount: number;
  recentUnreadNotifications: AdminNotification[];
}

const BadgeCountsContext = createContext<BadgeCountsContextType | undefined>(undefined);

export const BadgeCountsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentUser, adminProfile } = useAuth();

  const [pendingMerchantAppsCount, setPendingMerchantAppsCount] = useState(0);
  const [pendingRiderAppsCount, setPendingRiderAppsCount] = useState(0);
  const [unreadNotificationsCount, setUnreadNotificationsCount] = useState(0);
  const [pendingPromoRequestsCount, setPendingPromoRequestsCount] = useState(0);
  const [pendingChangeRequestsCount, setPendingChangeRequestsCount] = useState(0);
  const [pendingTierEventsCount, setPendingTierEventsCount] = useState(0);
  const [activeOrdersCount, setActiveOrdersCount] = useState(0);
  const [onlineRidersCount, setOnlineRidersCount] = useState(0);
  const [recentUnreadNotifications, setRecentUnreadNotifications] = useState<AdminNotification[]>([]);

  useEffect(() => {
    if (!currentUser || !adminProfile) {
      return;
    }

    // 1. Pending merchant applications
    const qMerchantApps = query(
      collection(db, 'merchantApplications'),
      where('status', '==', 'Pending')
    );
    const unsubMerchantApps = onSnapshot(
      qMerchantApps,
      (snap) => {
        setPendingMerchantAppsCount(snap.size);
      },
      (err) => console.error('Error listening to merchant applications:', err)
    );

    // 2. Pending rider applications
    const qRiderApps = query(
      collection(db, 'riderApplications'),
      where('status', '==', 'Pending')
    );
    const unsubRiderApps = onSnapshot(
      qRiderApps,
      (snap) => {
        setPendingRiderAppsCount(snap.size);
      },
      (err) => console.error('Error listening to rider applications:', err)
    );

    // 3. Admin notifications where read == false
    const qNotifications = query(
      collection(db, 'adminNotifications'),
      where('read', '==', false)
    );
    const unsubNotifications = onSnapshot(
      qNotifications,
      (snap) => {
        setUnreadNotificationsCount(snap.size);
        const list: AdminNotification[] = [];
        snap.forEach((d) => {
          const data = d.data();
          list.push({
            id: d.id,
            type: data.type || 'general',
            title: data.title || 'Notification',
            message: data.message || '',
            orderId: data.orderId,
            riderId: data.riderId,
            merchantId: data.merchantId,
            read: false,
            createdAt: data.createdAt
          });
        });
        setRecentUnreadNotifications(list.slice(0, 5));
      },
      (err) => console.error('Error listening to notifications:', err)
    );

    // 4. Promo requests where status == 'Pending'
    const qPromo = query(
      collection(db, 'promoRequests'),
      where('status', '==', 'Pending')
    );
    const unsubPromo = onSnapshot(
      qPromo,
      (snap) => {
        setPendingPromoRequestsCount(snap.size);
      },
      (err) => console.error('Error listening to promo requests:', err)
    );

    // 5. Change requests where status == 'Pending'
    const qChange = query(
      collection(db, 'changeRequests'),
      where('status', '==', 'Pending')
    );
    const unsubChange = onSnapshot(
      qChange,
      (snap) => {
        setPendingChangeRequestsCount(snap.size);
      },
      (err) => console.error('Error listening to change requests:', err)
    );

    // 6. Tier events where status == 'Pending'
    const qTier = query(
      collection(db, 'tierEvents'),
      where('status', '==', 'Pending')
    );
    const unsubTier = onSnapshot(
      qTier,
      (snap) => {
        setPendingTierEventsCount(snap.size);
      },
      (err) => console.error('Error listening to tier events:', err)
    );

    // 7. Online riders where isOnline == true
    const qRiders = query(
      collection(db, 'riders'),
      where('isOnline', '==', true)
    );
    const unsubRiders = onSnapshot(
      qRiders,
      (snap) => {
        setOnlineRidersCount(snap.size);
      },
      (err) => console.error('Error listening to online riders:', err)
    );

    return () => {
      unsubMerchantApps();
      unsubRiderApps();
      unsubNotifications();
      unsubPromo();
      unsubChange();
      unsubTier();
      unsubRiders();
    };
  }, [currentUser, adminProfile]);

  return (
    <BadgeCountsContext.Provider
      value={{
        pendingMerchantAppsCount,
        pendingRiderAppsCount,
        totalPendingAppsCount: pendingMerchantAppsCount + pendingRiderAppsCount,
        unreadNotificationsCount,
        pendingPromoRequestsCount,
        pendingChangeRequestsCount,
        pendingTierEventsCount,
        activeOrdersCount,
        onlineRidersCount,
        recentUnreadNotifications
      }}
    >
      {children}
    </BadgeCountsContext.Provider>
  );
};

export const useBadgeCounts = () => {
  const context = useContext(BadgeCountsContext);
  if (!context) {
    throw new Error('useBadgeCounts must be used within a BadgeCountsProvider');
  }
  return context;
};
