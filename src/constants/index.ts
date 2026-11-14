import { OrderServiceType, DispatchSettings, RiderPayConfig, ReceiptDesignConfig, CheckoutSettings } from '../types';

export type VehicleType = 'motorcycle' | 'tricycle' | 'car4' | 'car8';

export interface VehicleTypeConfig {
  id: VehicleType;
  name: string;
  shortLabel: string;
  defaultSeats: number;
  badgeColor: string;
  iconName: string;
}

export const VEHICLE_TYPES: VehicleTypeConfig[] = [
  {
    id: 'motorcycle',
    name: 'Motorcycle',
    shortLabel: 'Motorcycle',
    defaultSeats: 1,
    badgeColor: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700',
    iconName: 'Bike'
  },
  {
    id: 'tricycle',
    name: 'Tricycle',
    shortLabel: 'Tricycle',
    defaultSeats: 3,
    badgeColor: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-amber-300 dark:border-amber-700',
    iconName: 'Car'
  },
  {
    id: 'car4',
    name: '4-Seater Car',
    shortLabel: '4-Seater',
    defaultSeats: 4,
    badgeColor: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border-blue-300 dark:border-blue-700',
    iconName: 'Car'
  },
  {
    id: 'car8',
    name: '8-Seater Car',
    shortLabel: '8-Seater',
    defaultSeats: 8,
    badgeColor: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300 border-purple-300 dark:border-purple-700',
    iconName: 'Bus'
  }
];

export const VEHICLE_LABELS: Record<VehicleType, string> = {
  motorcycle: 'Motorcycle',
  tricycle: 'Tricycle',
  car4: '4-Seater Car',
  car8: '8-Seater Car'
};

export const SERVICES_BY_VEHICLE: Record<VehicleType, OrderServiceType[]> = {
  motorcycle: ['food', 'convenience', 'parcel', 'pabili', 'request_rider', 'taxi'],
  tricycle: ['parcel', 'taxi'],
  car4: ['parcel', 'taxi'],
  car8: ['parcel', 'taxi']
};

export const SERVICE_LABELS: Record<OrderServiceType, string> = {
  food: 'Delivio Food',
  convenience: 'Delivio Mart',
  parcel: 'Delivio Parcel',
  pabili: 'Delivio Pabili',
  request_rider: 'Delivio Instant',
  taxi: 'Delivio Taxi'
};

export const SERVICE_NAMES = SERVICE_LABELS;

export const SERVICE_SUBTITLES: Record<OrderServiceType, string> = {
  food: 'Food Delivery',
  convenience: 'Convenience Store',
  parcel: 'Parcel Express',
  pabili: 'Pabili Service',
  request_rider: 'Request a Rider (merchant button)',
  taxi: 'Taxi Service'
};

export const ALL_SERVICES: { id: OrderServiceType; label: string; subtitle: string; description: string }[] = [
  { id: 'food', label: 'Delivio Food', subtitle: 'Food Delivery', description: 'Restaurant food and meal deliveries' },
  { id: 'convenience', label: 'Delivio Mart', subtitle: 'Convenience Store', description: 'Grocery and convenience store delivery' },
  { id: 'parcel', label: 'Delivio Parcel', subtitle: 'Parcel Express', description: 'Package pickup and courier express delivery' },
  { id: 'pabili', label: 'Delivio Pabili', subtitle: 'Pabili Service', description: 'Custom errand and buying assistance service' },
  { id: 'request_rider', label: 'Delivio Instant', subtitle: 'Request a Rider (merchant button)', description: 'Point-to-point dedicated merchant driver dispatch' },
  { id: 'taxi', label: 'Delivio Taxi', subtitle: 'Taxi Service', description: 'Passenger ride-hailing and transit' }
];

export const DEFAULT_TAXI_RATES: Record<VehicleType, {
  enabled: boolean;
  baseFare: number;
  includedKm: number;
  perKm: number;
  minFare: number;
  perStopFee: number;
  serviceFeeType?: 'flat' | 'percent';
  serviceFee: number;
  serviceFeeMin?: number;
  serviceFeeMax?: number;
  commissionPercent: number;
}> = {
  motorcycle: {
    enabled: true,
    baseFare: 40,
    includedKm: 2,
    perKm: 10,
    minFare: 50,
    perStopFee: 15,
    serviceFeeType: 'flat',
    serviceFee: 5,
    commissionPercent: 15
  },
  tricycle: {
    enabled: true,
    baseFare: 30,
    includedKm: 2,
    perKm: 8,
    minFare: 40,
    perStopFee: 10,
    serviceFeeType: 'flat',
    serviceFee: 5,
    commissionPercent: 15
  },
  car4: {
    enabled: true,
    baseFare: 60,
    includedKm: 2,
    perKm: 15,
    minFare: 80,
    perStopFee: 20,
    serviceFeeType: 'flat',
    serviceFee: 10,
    commissionPercent: 15
  },
  car8: {
    enabled: true,
    baseFare: 80,
    includedKm: 2,
    perKm: 18,
    minFare: 100,
    perStopFee: 25,
    serviceFeeType: 'flat',
    serviceFee: 10,
    commissionPercent: 15
  }
};

export const SUPPORT_TICKET_REASONS = [
  'Missing Order',
  'Not My Order',
  'I Did Not Receive My Order',
  'Wrong or Damaged Items',
  'Order Is Late',
  'Rider or Driver Issue',
  'Payment or Refund Problem',
  'Other'
] as const;

export type SupportTicketReason = typeof SUPPORT_TICKET_REASONS[number];

export const SUPPORT_CANNED_REPLIES = [
  'Hello! I am reviewing your order details and escalating this with the driver and merchant right now.',
  'We have processed a full wallet refund for your order. The funds are now available in your Delivio Wallet.',
  'We sincerely apologize for the delay. The driver is currently in transit to your drop-off location.',
  'Thank you for providing the photos. We are issuing a credit for the missing/damaged items.',
  'We have contacted the store and driver regarding your report. Your issue is being addressed immediately.',
  'Your order has been cancelled and any paid amount has been returned to your wallet balance.',
  'Thank you for reaching out to Delivio Support. This report has been investigated and resolved.'
];

export const DRIVER_SUPPORT_REASONS = [
  { id: 'cant_fit_bag', label: "Can't fit on my bag" },
  { id: 'too_big', label: 'Order is too big or heavy' },
  { id: 'accident', label: 'Accident' },
  { id: 'wrong_items', label: 'Wrong or missing items' },
  { id: 'merchant_wait', label: 'Merchant is taking too long' },
  { id: 'merchant_closed', label: 'Merchant is closed' },
  { id: 'customer_unreachable', label: 'Customer unreachable' },
  { id: 'vehicle_breakdown', label: 'Vehicle breakdown' },
  { id: 'safety', label: 'Safety concern' },
  { id: 'other', label: 'Other' }
] as const;

export type DriverSupportReasonId = typeof DRIVER_SUPPORT_REASONS[number]['id'];

export const DRIVER_CANNED_REPLIES = [
  'Hello! We are reviewing your driver report and order items right now.',
  'We are splitting this delivery. Another rider is being dispatched to carry the excess items.',
  'Your safety is our top priority. Please stay in a secure area while we coordinate with dispatch.',
  'We have logged the merchant preparation delay and updated the customer.',
  'We are attempting to call the customer directly from operations. Please stand by.',
  'The order has been re-dispatched to another partner without affecting your performance record.',
  'Thank you for your report and diligence. This ticket has been resolved.'
];

export const DEFAULT_DISPATCH_SETTINGS: DispatchSettings = {
  defaultOption: 'priority',
  options: {
    priority: {
      label: 'Priority',
      enabled: true,
      holdMinutes: 0,
      maxBatch: 1,
      endsWhenReady: true,
      feeAdjustType: 'flat',
      feeAdjustValue: 22
    },
    standard: {
      label: 'Standard',
      enabled: true,
      holdMinutes: 5,
      maxBatch: 3,
      endsWhenReady: true,
      feeAdjustType: 'flat',
      feeAdjustValue: 0
    },
    saver: {
      label: 'Saver',
      enabled: true,
      holdMinutes: 10,
      maxBatch: 3,
      endsWhenReady: false,
      feeAdjustType: 'flat',
      feeAdjustValue: -15
    }
  },
  searchRadiusKm: 5,
  waveSeconds: 8,
  poolMaxPickupGapKm: 1.5,
  poolMaxDropoffGapKm: 3,
  priorityHeadStartSeconds: 10,
  priorityMaxBatch: 4,
  martBatching: false
};

export const DEFAULT_RIDER_PAY: RiderPayConfig = {
  single: {
    minFare: 35,
    includedKm: 2,
    perKmExtra: 8
  },
  double: {
    first: {
      minFare: 35,
      includedKm: 2,
      perKmExtra: 8
    },
    second: {
      minFare: 25,
      includedKm: 2,
      perKmExtra: 6
    },
    third: {
      minFare: 20,
      includedKm: 2,
      perKmExtra: 5
    }
  },
  pickup: {
    minFare: 10,
    freeKm: 1,
    perKmExtra: 6
  }
};

export const DEFAULT_RECEIPT_CONFIG: ReceiptDesignConfig = {
  brandLine: 'Delivio',
  headerLines: ['Official Delivery Receipt', 'Thank you for supporting local!'],
  footerText: 'For customer support, reach us via in-app help or support@delivio.ph',
  showOrderId: true,
  showOrderedAt: true,
  showCustomerName: true,
  showNote: true,
  showSetChoices: true,
  fontSize: 'medium',
  align: 'center',
  separator: 'dashes',
  merchantCopy: {
    enabled: true,
    title: "Merchant's Copy",
    showItemPrices: true
  },
  customerCopy: {
    enabled: true,
    title: "Customer's Copy",
    showItemPrices: true
  }
};

export const DEFAULT_CHECKOUT_SETTINGS: CheckoutSettings = {
  mustTry: {
    enabled: true,
    title: 'Must try!',
    description: 'Add a favorite from this shop to go with your order',
    maxItems: 8
  }
};



