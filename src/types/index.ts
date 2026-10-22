export type UserRole = 'customer' | 'merchant' | 'rider' | 'admin';
export type UserStatus = 'active' | 'blocked' | 'suspended';

export interface UserLocation {
  lat: number;
  lng: number;
  updatedAt?: any;
}

export interface UserProfile {
  uid: string;
  role: UserRole | string;
  email: string;
  name: string;
  phone?: string;
  photoUrl?: string;
  status?: UserStatus;
  walletBalance?: number;
  location?: UserLocation;
  adminNote?: string;
  cityId?: string;
  createdAt?: any;
  updatedAt?: any;
}

export interface UserAddress {
  id: string;
  label?: string;
  address: string;
  details?: string;
  lat?: number;
  lng?: number;
  isDefault?: boolean;
}

export type OrderServiceType = 'food' | 'convenience' | 'parcel' | 'pabili' | 'request_rider';

export type OrderStatus =
  | 'Placed Order'
  | 'Preparing'
  | 'Ready'
  | 'Rider is on the way'
  | 'Delivered'
  | 'Rejected'
  | 'Cancelled'
  | 'Rider is on the way to sender'
  | 'Arrived at sender'
  | 'Rider is on the way to recipient'
  | 'Arrived at recipient'
  | 'Rider is on the way to vendor'
  | 'Arrived at vendor';

export interface OrderStatusHistoryItem {
  status: OrderStatus | string;
  at: any;
  note?: string;
}

export interface OrderItem {
  name: string;
  qty: number;
  price: number;
  notes?: string;
}

export interface OrderLocationPoint {
  label?: string;
  address: string;
  area?: string;
  lat: number;
  lng: number;
  contactName?: string;
  contactPhone?: string;
}

export interface OrderFees {
  subtotal: number;
  deliveryFee: number;
  serviceFee: number;
  discount: number;
  total: number;
}

export interface Order {
  id: string;
  orderNumber?: string;
  serviceType: OrderServiceType;
  customerId: string;
  customerName: string;
  customerPhone?: string;
  merchantId?: string;
  merchantName?: string;
  merchantPhone?: string;
  merchantAddress?: string;
  riderId?: string | null;
  riderName?: string | null;
  riderPhone?: string | null;
  riderPhotoUrl?: string | null;
  riderLocation?: UserLocation | null;
  riderStep?: string | null;
  riderRequest?: {
    status?: string;
    acceptedAt?: any;
    [key: string]: any;
  };
  riderEarning?: {
    deliveryFee: number;
    commissionPercent: number;
    tip: number;
    net: number;
  };
  status: OrderStatus;
  statusHistory: OrderStatusHistoryItem[];
  items?: OrderItem[];
  pickup?: OrderLocationPoint;
  dropoff?: OrderLocationPoint;
  parcel?: {
    itemType?: string;
    recipientName?: string;
    recipientPhone?: string;
    weightKg?: number;
    notes?: string;
  };
  pabili?: {
    storeName?: string;
    estimatedCost?: number;
    shoppingList?: string;
  };
  finalReceiptTotal?: number;
  fees: OrderFees;
  paymentMethod: 'cod' | 'online' | 'merchant' | 'wallet' | string;
  paymentStatus?: string;
  paymentProvider?: string;
  payment?: {
    method?: string;
    provider?: string;
    status?: string;
    [key: string]: any;
  };
  cashToCollect?: number;
  codAmount?: number;
  codCollected?: number;
  walletRefunded?: boolean;
  cityId?: string;
  cancelReason?: string;
  cancelFault?: 'customer' | 'merchant' | 'rider' | 'platform';
  cancelledBy?: string;
  rejectReason?: string;
  createdAt?: any;
  updatedAt?: any;
  pickedUpAt?: any;
  deliveredAt?: any;
}

export interface WalletTransaction {
  id?: string;
  customerId?: string;
  riderId?: string;
  type: 'cash_in' | 'adjustment' | 'refund' | 'order_payment' | string;
  amount: number;
  note?: string;
  reason?: string;
  adminId?: string;
  adminName?: string;
  balanceAfter?: number;
  orderId?: string;
  orderNumber?: string;
  createdAt?: any;
}

export interface Merchant {
  id: string;
  name: string;
  ownerName: string;
  email: string;
  phone: string;
  type: 'food' | 'convenience';
  typeLocked?: boolean;
  status: 'active' | 'suspended';
  isOpen: boolean;
  ownerUid?: string;
  cityId?: string;
  cuisineTags?: string[];
  address: string;
  lat: number;
  lng: number;
  logoUrl?: string;
  bannerUrl?: string;
  description?: string;
  commissionRate: number; // e.g. 15 for 15%
  rating?: number;
  totalOrders?: number;
  createdAt?: any;
}

export interface MenuItem {
  id: string;
  categoryId?: string;
  name: string;
  price: number;
  description?: string;
  imageUrl?: string;
  available: boolean;
  createdAt?: any;
}

export interface MenuCategory {
  id: string;
  name: string;
  sortOrder?: number;
}

export interface Rider {
  id: string;
  name: string;
  email: string;
  phone: string;
  photoUrl?: string;
  riderCode: string;
  status: 'active' | 'suspended';
  cityId?: string;
  vehicleType?: string;
  vehicleModel?: string;
  plate?: string;
  allowedServices: OrderServiceType[];
  activeServices: OrderServiceType[];
  isOnline: boolean;
  location?: UserLocation;
  currentOrderId?: string | null;
  coins?: number;
  walletBalance?: number;
  cashRemitted?: number;
  rating?: number;
  ridesThisMonth?: number;
  createdAt?: any;
}

export interface City {
  id: string;
  name: string;
  province?: string;
  status: 'active' | 'inactive';
  center: {
    lat: number;
    lng: number;
  };
  radiusKm: number;
  createdAt?: any;
}

export interface ServiceRates {
  baseFare: number;
  includedKm: number;
  perKm: number;
  minFee: number;
  maxFee: number;
  serviceFee: number;
}

export interface DeliveryRatesConfig {
  id: string; // cityId
  food: ServiceRates;
  convenience: ServiceRates;
  parcel: ServiceRates;
  pabili: ServiceRates;
  request_rider: ServiceRates;
  riderCommissionPercent: number;
  surcharges: {
    peak: {
      enabled: boolean;
      multiplier: number;
    };
    night: {
      enabled: boolean;
      flat: number;
    };
  };
  updatedAt?: any;
}

export interface ApplicationDocument {
  title: string;
  url: string;
}

export interface MerchantApplication {
  id: string;
  uid: string;
  businessName: string;
  ownerName: string;
  email: string;
  phone: string;
  businessType: 'food' | 'convenience';
  cityId: string;
  address: string;
  lat: number;
  lng: number;
  logoUrl?: string;
  storePhotoUrl?: string;
  documents?: ApplicationDocument[];
  status: 'Pending' | 'Under Review' | 'Needs Info' | 'Approved' | 'Rejected';
  reviewNote?: string;
  reviewedBy?: string;
  reviewedAt?: any;
  createdAt?: any;
}

export interface RiderApplication {
  id: string;
  uid: string;
  name: string;
  email: string;
  phone: string;
  cityId: string;
  vehicleType: string;
  vehicleModel?: string;
  plate: string;
  selfieUrl?: string;
  documents?: ApplicationDocument[];
  status: 'Pending' | 'Under Review' | 'Needs Info' | 'Approved' | 'Rejected';
  reviewNote?: string;
  reviewedBy?: string;
  reviewedAt?: any;
  createdAt?: any;
}

export interface Banner {
  id: string;
  title: string;
  imageUrl: string;
  link: {
    merchantId?: string;
    category?: 'food' | 'convenience' | '';
  };
  discount?: {
    type: 'percent' | 'fixed';
    value: number;
    minOrder?: number;
    maxDiscount?: number;
    code?: string;
  };
  status: 'active' | 'draft' | 'expired';
  priority: number;
  target?: 'all' | string;
  startAt?: any;
  endAt?: any;
  createdAt?: any;
}

export interface PromoRequest {
  id: string;
  merchantId: string;
  merchantName?: string;
  title: string;
  description: string;
  imageUrl?: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  rejectReason?: string;
  createdAt?: any;
}

export interface ChangeRequest {
  id: string;
  merchantId: string;
  merchantName?: string;
  kind: 'type' | 'shopName' | 'email';
  oldValue: any;
  newValue: any;
  status: 'Pending' | 'Approved' | 'Rejected';
  reason?: string;
  createdAt?: any;
}

export interface TierConfig {
  id: string; // bronze, silver, gold, platinum
  name: string;
  ridesRequired: number;
  coins: number;
  sortOrder: number;
}

export interface TierEvent {
  id: string;
  riderId: string;
  riderName?: string;
  riderCode?: string;
  tier: string;
  coins: number;
  month: string;
  status: 'Pending' | 'Credited';
  creditedAt?: any;
  createdAt?: any;
}

export interface AdminNotification {
  id: string;
  type: 'tier_reached' | 'incident' | 'sos' | 'application' | 'general';
  title: string;
  message: string;
  orderId?: string;
  riderId?: string;
  merchantId?: string;
  read: boolean;
  createdAt?: any;
}

export interface AuditLogEntry {
  id?: string;
  adminId: string;
  adminName: string;
  adminEmail?: string;
  action: string;
  entityType: string;
  entityId: string;
  details?: string;
  oldValue?: any;
  newValue?: any;
  reason?: string;
  timestamp: any;
}

export interface EditHistoryEntry {
  id?: string;
  entityType: 'customer' | 'merchant' | 'rider' | string;
  entityId: string;
  field: string;
  oldValue: any;
  newValue: any;
  editedBy: string;
  editedByName: string;
  at: any;
}

export interface PlatformSettings {
  platformName: string;
  supportPhone: string;
  supportEmail: string;
  maintenance: boolean;
  defaultCommissionRate?: number;
  updatedAt?: any;
}
