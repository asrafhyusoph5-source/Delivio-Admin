export type UserRole = 'customer' | 'merchant' | 'rider' | 'admin' | 'subadmin';
export type AdminRole = 'support' | 'finance' | 'admin';
export type UserStatus = 'active' | 'blocked' | 'suspended';

export interface StaffInvite {
  id?: string;
  email: string;
  adminRole: AdminRole;
  invitedBy: string;
  createdAt: any;
}

export interface UserLocation {
  lat: number;
  lng: number;
  updatedAt?: any;
}

export interface UserProfile {
  uid: string;
  role: UserRole | string;
  adminRole?: AdminRole;
  email: string;
  name: string;
  phone?: string;
  photoUrl?: string;
  status?: UserStatus;
  walletBalance?: number;
  linkedRiderId?: string | null;
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

export type OrderServiceType = 'food' | 'convenience' | 'parcel' | 'pabili' | 'request_rider' | 'taxi';

export type OrderStatus =
  | 'Placed Order'
  | 'Preparing'
  | 'Ready'
  | 'Rider is on the way'
  | 'On another delivery'
  | 'Driver is on the way'
  | 'Driver arrived'
  | 'On trip'
  | 'Delivered'
  | 'Completed'
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
  id?: string;
  name: string;
  qty: number;
  price: number;
  basePrice?: number;
  selections?: any[];
  selectedSets?: any;
  notes?: string;
  [key: string]: any;
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
  tip?: number;
  lateTip?: number;
}

export interface Order {
  id: string;
  orderNumber?: string;
  serviceType: OrderServiceType;
  fulfillmentType?: 'delivery' | 'pickup' | 'scheduled' | string;
  isPickup?: boolean;
  scheduledFor?: any;
  lateTip?: number;
  deliveryOption?: DeliveryOptionType | string;
  holdUntil?: any;
  holdMinutes?: number;
  batchId?: string | null;
  bookingRank?: number;
  batchTotalBookings?: number;
  splitOf?: string | null;
  splitOut?: {
    count?: number;
    children?: { orderId: string; items: any[]; seq: number }[];
    childOrderId?: string;
    items?: any[];
    at: any;
    by: string;
  } | string | null;
  isSplitChild?: boolean;
  seq?: number;
  noCash?: boolean;
  excludeRiderIds?: string[];
  sourceCustomerId?: string | null;
  sourceMerchantId?: string | null;
  riderFeeFixed?: number;
  dispatch?: any;
  searchRadiusKm?: number;
  riderFeeEstimate?: {
    pickupFee?: number;
    bookingFee?: number;
    specialRadiusExtra?: number;
    total?: number;
    [key: string]: any;
  };
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
  riderVehicle?: {
    type?: string;
    vehicleType?: string;
    model?: string;
    color?: string;
    plate?: string;
    seats?: number;
  } | null;
  vehicleType?: string;
  stops?: OrderLocationPoint[];
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
    total?: number;
    lateTip?: number;
    pickupFee?: number;
    bookingFee?: number;
    specialRadiusExtra?: number;
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
  editedByMerchant?: boolean;
  isEditedByMerchant?: boolean;
  editNote?: string;
  isReady?: boolean;
  originalItems?: OrderItem[];
  originalTotal?: number;
  originalFees?: OrderFees;
  walletAdjustDue?: number;
  walletAdjustApplied?: boolean;
  walletAdjustAppliedAt?: any;
  createdAt?: any;
  updatedAt?: any;
  pickedUpAt?: any;
  deliveredAt?: any;
}

export interface WalletTransaction {
  id?: string;
  customerId?: string;
  riderId?: string;
  merchantId?: string;
  type: 'cash_in' | 'adjustment' | 'refund' | 'order_payment' | 'merge' | 'transfer_sent' | 'transfer_received' | string;
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

export interface WalletTransfer {
  id: string;
  reference?: string;
  fromUid: string;
  fromName: string;
  fromEmail?: string;
  fromPhone?: string;
  toUid: string;
  toName: string;
  toEmail?: string;
  toPhone?: string;
  amount: number;
  note?: string;
  method: 'send' | 'qr' | string;
  status?: string;
  createdAt?: any;
}

export interface WalletDirectoryEntry {
  id: string; // "email_{email}" or "phone_63XXXXXXXXXX"
  uid: string;
  name?: string;
  email?: string;
  phone?: string;
  role?: string;
  updatedAt?: any;
}

export interface MerchantOperatingDay {
  open: string;
  close: string;
  isOpen?: boolean;
  closed?: boolean;
}

export type MerchantWeeklyHours = Record<string, MerchantOperatingDay>;

export interface Merchant {
  id: string;
  name: string;
  businessName?: string;
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
  walletBalance?: number;
  linkedCustomerUid?: string | null;
  linkedCustomerEmail?: string | null;
  linkedCustomerName?: string | null;
  linkedAt?: any;
  hours?: MerchantWeeklyHours;
  autoSchedule?: boolean;
  isPaused?: boolean;
  pauseUntilTime?: any;
  closedUntil?: any;
  openUntil?: any;
  specialRadius?: MerchantSpecialRadius;
  locationChangedAt?: any;
  createdAt?: any;
}

export interface MerchantSpecialRadius {
  enabled: boolean;
  radiusKm: number;
  customerExtraFee: number; // ₱
  riderExtraFee: number; // ₱
  updatedAt?: any;
  updatedBy?: string;
}

export interface MenuChoice {
  id: string;
  name: string;
  price: number;
  available: boolean;
}

export interface MenuSet {
  id: string;
  name: string;
  required: boolean;
  minSelect?: number;
  maxSelect: number;
  sortOrder: number;
  choices: MenuChoice[];
  customName?: string | boolean | null;
  subcategoryId?: string | null;
  subcategoryName?: string | null;
}

export interface Subcategory {
  id: string;
  name: string;
  sortOrder?: number;
  createdAt?: any;
  updatedAt?: any;
}

export interface MerchantMenuSchedule {
  days: number[]; // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  start: string;  // e.g. "08:00"
  end: string;    // e.g. "22:00"
}

export interface MerchantMenu {
  id: string;
  name: string;
  active: boolean;
  sortOrder: number;
  schedule?: MerchantMenuSchedule | null;
  createdAt?: any;
  updatedAt?: any;
  [key: string]: any;
}

export interface MenuItem {
  id: string;
  categoryId?: string;
  subcategoryId?: string | null;
  subcategoryName?: string | null;
  customName?: string | null;
  name: string;
  price: number;
  description?: string;
  imageUrl?: string;
  available: boolean;
  hasSets?: boolean;
  sets?: MenuSet[];
  menuIds?: string[];
  createdAt?: any;
  updatedAt?: any;
  [key: string]: any;
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
  vehicleColor?: string;
  seats?: number;
  plate?: string;
  documents?: {
    vehiclePhotoUrl?: string;
    franchiseUrl?: string;
    [key: string]: any;
  } | ApplicationDocument[] | any;
  allowedServices: OrderServiceType[];
  activeServices: OrderServiceType[];
  isOnline: boolean;
  location?: UserLocation;
  currentOrderId?: string | null;
  coins?: number;
  walletBalance?: number;
  cashRemitted?: number;
  rating?: number;
  priorityRider?: boolean;
  ridesThisMonth?: number;
  linkedCustomerUid?: string | null;
  linkedCustomerEmail?: string | null;
  linkedCustomerName?: string | null;
  linkedAt?: any;
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
  services?: Record<string, boolean>; // e.g. { food: true, convenience: true, parcel: true, pabili: true, taxi: true }
  servicesUpdatedAt?: any;
  servicesUpdatedBy?: string;
  createdAt?: any;
}

export interface Review {
  id: string;
  orderId?: string;
  orderNumber?: string;
  customerId?: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  customerPhotoUrl?: string;
  merchantId?: string;
  merchantName?: string;
  riderId?: string;
  riderName?: string;
  ratingMerchant?: number;
  ratingRider?: number;
  rating?: number;
  commentMerchant?: string;
  commentRider?: string;
  comment?: string;
  notes?: string;
  tags?: string[];
  createdAt?: any;
}

export interface OfferLogEntry {
  id: string;
  orderId?: string;
  serviceType?: string;
  status?: 'accepted' | 'declined' | 'missed' | 'cancelled' | 'canceled' | 'rejected' | string;
  action?: string;
  distanceKm?: number;
  fareAmount?: number;
  rejectionReason?: string;
  cancellationReason?: string;
  timestamp?: any;
  createdAt?: any;
}

export type ServiceFeeType = 'flat' | 'percent';

export interface ServiceRates {
  baseFare: number;
  includedKm: number;
  perKm: number;
  minFee: number;
  maxFee: number;
  serviceFeeType?: ServiceFeeType; // 'flat' | 'percent'
  serviceFee: number; // amount or percent
  serviceFeeMin?: number; // optional percent min
  serviceFeeMax?: number; // optional percent max
}

export interface TaxiVehicleFareConfig {
  enabled: boolean;
  baseFare: number;
  includedKm: number;
  perKm: number;
  minFare: number;
  perStopFee: number;
  serviceFeeType?: ServiceFeeType; // 'flat' | 'percent'
  serviceFee: number; // amount or percent
  serviceFeeMin?: number; // optional percent min
  serviceFeeMax?: number; // optional percent max
  commissionPercent: number;
}

export type TaxiVehicleRates = TaxiVehicleFareConfig;

export type DeliveryServiceType = 'food' | 'convenience' | 'parcel' | 'pabili' | 'request_rider';

export interface DeliveryRatesConfig {
  id: string; // cityId
  food: ServiceRates;
  convenience: ServiceRates;
  parcel: ServiceRates;
  pabili: ServiceRates;
  request_rider: ServiceRates;
  services?: Record<string, ServiceRates>;
  rideRates?: Record<string, TaxiVehicleFareConfig>;
  riderPay?: RiderPayConfig;
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

export interface RiderPayFareTier {
  minFare: number;
  includedKm: number;
  perKmExtra: number;
}

export interface RiderPayPickupTier {
  minFare: number;
  freeKm: number;
  perKmExtra: number;
}

export interface RiderPayConfig {
  single: RiderPayFareTier;
  double: {
    first: RiderPayFareTier;
    second: RiderPayFareTier;
    third: RiderPayFareTier;
  };
  pickup: RiderPayPickupTier;
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
  vehicleColor?: string;
  seats?: number;
  plate: string;
  selfieUrl?: string;
  documents?: {
    vehiclePhotoUrl?: string;
    franchiseUrl?: string;
    [key: string]: any;
  } | ApplicationDocument[] | any;
  riderCode?: string;
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
  kind: 'type' | 'shopName' | 'email' | 'location' | string;
  oldValue: any;
  newValue: any;
  requestedValue?: any;
  status: 'Pending' | 'Approved' | 'Rejected';
  reason?: string;
  rejectReason?: string;
  reviewedBy?: string;
  reviewedAt?: any;
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

export interface PlatformVatConfig {
  enabled: boolean;
  percent: number;
  mode: 'added' | 'included';
  base: 'total' | 'fees';
}

export interface PlatformSettings {
  platformName: string;
  supportPhone: string;
  supportEmail: string;
  maintenance: boolean;
  defaultCommissionRate?: number;
  services?: Record<string, boolean>;
  taxiVehicles?: Record<string, boolean>;
  vat?: PlatformVatConfig;
  timezone?: string;
  scheduledReleaseLeadMinutes?: number;
  updatedAt?: any;
}

export type InboxCategory = 'update' | 'order' | 'wallet' | 'promo' | 'system' | 'admin' | 'safety';

export interface InboxLink {
  merchantId?: string | null;
  category?: 'food' | 'convenience' | null;
}

export interface InboxMessage {
  id: string;
  title: string;
  body: string;
  category: InboxCategory;
  imageUrl?: string | null;
  link?: InboxLink | null;
  audience?: 'all_customers' | 'all_riders' | 'all_merchants' | null;
  customerId?: string | null;
  riderId?: string | null;
  merchantId?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  riderName?: string | null;
  merchantName?: string | null;
  merchantEmail?: string | null;
  createdAt: any;
  createdBy?: string | null;
  createdByName?: string | null;
  sentBy?: string | null;
  sentById?: string | null;
  sendAt?: any;
}

export type SupportTicketStatus = 'open' | 'accepted' | 'in_progress' | 'resolved';

export interface SupportTicket {
  id: string;
  reporterType?: 'customer' | 'rider';
  riderId?: string;
  riderName?: string;
  riderPhone?: string;
  title: string;
  reason: string;
  reasonLabel?: string;
  status: SupportTicketStatus;
  customerId?: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  orderId?: string;
  orderNumber?: string;
  batchId?: string;
  serviceType?: OrderServiceType | string;
  splitItems?: any[];
  splitChildOrderId?: string;
  unreadByAdmin?: boolean;
  unreadByCustomer?: boolean;
  unreadByRider?: boolean;
  lastMessageAt?: any;
  lastMessagePreview?: string;
  acceptedAt?: any;
  acceptedBy?: string;
  resolvedAt?: any;
  resolvedBy?: string;
  resolution?: string;
  createdAt: any;
  updatedAt?: any;
}

export interface SupportTicketMessage {
  id: string;
  senderType: 'admin' | 'customer' | 'rider' | 'system';
  senderId: string;
  senderName?: string;
  text: string;
  imageData?: string | null;
  createdAt: any;
}

export interface RiderReview {
  id: string;
  orderId?: string;
  orderNumber?: string;
  merchantId?: string;
  merchantName?: string;
  riderId: string;
  riderName?: string;
  riderCode?: string;
  rating: number; // 1 to 5
  ratingMerchant?: number;
  comment?: string;
  commentMerchant?: string;
  waitDurationMinutes?: number;
  tags?: string[];
  createdAt: any;
}

export type DeliveryOptionType = 'priority' | 'standard' | 'saver';

export interface DispatchOptionConfig {
  label: string;
  enabled: boolean;
  holdMinutes: number; // priority 0, standard 5, saver 10
  maxBatch: number; // priority 1, standard 3, saver 3
  feeAdjustType: 'flat' | 'percent';
  feeAdjustValue: number; // priority +22, standard 0, saver -15
  endsWhenReady?: boolean; // Priority: true, Standard: true, Saver: false
}

export interface DispatchSettings {
  defaultOption: DeliveryOptionType;
  options: {
    priority: DispatchOptionConfig;
    standard: DispatchOptionConfig;
    saver: DispatchOptionConfig;
  };
  searchRadiusKm: number; // default 5
  waveSeconds: number; // default 8
  poolMaxPickupGapKm: number; // default 1.5
  poolMaxDropoffGapKm: number; // default 3
  priorityHeadStartSeconds?: number; // default 10
  priorityMaxBatch?: number; // default 4
  updatedAt?: any;
  updatedBy?: string;
}

export interface ReceiptCopyConfig {
  enabled: boolean;
  title: string; // "Merchant's Copy", "Customer's Copy"
  showItemPrices: boolean;
}

export interface ReceiptDesignConfig {
  brandLine: string; // default "Delivio"
  headerLines: string[]; // 0 to 3 extra lines
  footerText: string;
  showOrderId: boolean;
  showOrderedAt: boolean;
  showCustomerName: boolean;
  showNote: boolean;
  showSetChoices: boolean;
  fontSize: 'small' | 'medium' | 'large';
  align: 'center' | 'left';
  separator: 'dashes' | 'solid' | 'double';
  merchantCopy: ReceiptCopyConfig;
  customerCopy: ReceiptCopyConfig;
  updatedAt?: any;
  updatedBy?: string;
}

export interface MustTryCheckoutConfig {
  enabled: boolean;
  title: string; // default "Must try!"
  description: string; // default "Add a favorite from this shop to go with your order"
  maxItems: number; // default 8, max 12
}

export interface CheckoutSettings {
  mustTry: MustTryCheckoutConfig;
  updatedAt?: any;
  updatedBy?: string;
}

export type QuestMetric = 'deliveries' | 'earnings';
export type QuestStatus = 'draft' | 'active' | 'ended' | 'cancelled';
export type QuestClaimStatus = 'Pending' | 'Credited' | 'Not achieved' | 'Rejected';

export interface QuestGoal {
  target: number; // e.g. 18 deliveries or ₱2500 earnings
  reward: number; // e.g. ₱75 bonus
}

export interface Quest {
  id: string;
  title: string;
  description: string;
  status: QuestStatus;
  startAt: any; // Timestamp (Philippine time)
  endAt: any; // Timestamp (Philippine time)
  metric: QuestMetric; // 'deliveries' | 'earnings'
  hourFrom?: string; // "HH:mm" optional daily window
  hourTo?: string; // "HH:mm"
  services?: OrderServiceType[]; // empty = all
  cityIds: string[];
  vehicleTypes?: string[]; // empty = all
  riderIds?: string[]; // empty = all
  minAcceptanceRate?: number | null; // percent or null
  maxNoShows?: number | null; // number or null
  goals: QuestGoal[]; // sorted ascending by target
  totalPaid?: number; // total reward credited (₱)
  createdAt: any;
  createdBy?: string;
  updatedAt?: any;
}

export interface QuestClaim {
  id: string;
  questId: string;
  questTitle: string;
  riderId: string;
  riderName?: string;
  riderPhone?: string;
  cityId?: string;
  claimedTarget: number;
  claimedReward: number;
  achievedValue?: number;
  status: QuestClaimStatus;
  verifiedValues?: {
    deliveries?: number;
    earnings?: number;
    acceptanceRate?: number;
    noShows?: number;
    eligible?: boolean;
    computedReward?: number;
    verifiedTarget?: number;
  };
  verifiedAt?: any;
  verifiedBy?: string;
  creditedAt?: any;
  creditedBy?: string;
  note?: string;
  createdAt: any;
  updatedAt?: any;
}

export interface BestSellerItem {
  id: string;
  name: string;
  qty: number;
  revenue: number;
  categoryId?: string;
}

export interface MerchantBestSellers {
  items: BestSellerItem[];
  orderCount: number;
  last30DaysOrderCount: number;
  recomputedAt: any;
  recomputedBy?: string;
}

export interface FraudFlag {
  id: string;
  subjectType: 'customer' | 'driver';
  subjectId: string;
  reason: string;
  status: 'open' | 'dismissed';
  note?: string;
  createdAt: any;
  createdBy: string;
  subjectName?: string;
  subjectEmail?: string;
  subjectPhone?: string;
}

export interface PromoCode {
  id?: string;
  code: string;
  active: boolean;
  type: 'percent' | 'fixed';
  value: number;
  minSubtotal: number;
  expiresAt?: any;
  usageLimit?: number | null;
  perUserLimit?: number;
  usedCount: number;
  services: (OrderServiceType | string)[];
  lastRedemptionId?: string;
  createdAt?: any;
  createdBy?: string;
  source?: 'platform' | 'merchant';
  merchantId?: string | null;
  merchantName?: string | null;
  title?: string;
  visibility?: 'public' | 'hidden' | string;
  uses?: number;
  totalDiscount?: number;
}

export interface PromoRedemption {
  id: string;
  code: string;
  customerId: string;
  orderId: string;
  discount: number;
  createdAt: any;
}

export interface DriverDocumentItem {
  id: string;
  type: 'license' | 'or_cr' | 'nbi' | 'insurance' | 'barangay' | 'drug_test' | 'other';
  title: string;
  documentNumber?: string;
  expiryDate?: string; // YYYY-MM-DD
  fileUrl?: string;
  verified?: boolean;
  notes?: string;
  updatedAt?: any;
}

export type ChatChannel = 'merchant' | 'rider';
export type ChatSenderRole = 'customer' | 'merchant' | 'rider';
export type ChatMessageType = 'text' | 'image';

export interface ChatThread {
  id: string; // chatId: "{orderId}_merchant" or "{orderId}_rider_{riderUid}"
  orderId: string;
  orderNumber: string | number;
  channel: ChatChannel;
  customerId: string;
  customerName: string; // first name only
  merchantId?: string | null;
  merchantName?: string | null;
  riderId?: string | null;
  riderName?: string | null;
  createdAt: any;
  lastMessageAt: any;
  lastMessageText: string;
  lastSenderRole: ChatSenderRole;
  customerReadAt?: any;
  partnerReadAt?: any;
  expireAt: any;
  [key: string]: any;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderRole: ChatSenderRole;
  type: ChatMessageType;
  text?: string;
  image?: string; // JPEG data URI string, max 400000 characters
  source?: 'camera' | 'gallery';
  createdAt: any;
  expireAt: any;
  [key: string]: any;
}



