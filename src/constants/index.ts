import { OrderServiceType } from '../types';

export const FOOD_CATEGORIES = [
  'Dessert',
  'Burgers',
  'Pizza',
  'Chicken',
  'Drinks',
  'Others'
] as const;

export type FoodCategory = typeof FOOD_CATEGORIES[number];

export const CONVENIENCE_CATEGORIES = [
  'Snacks & Confectionery',
  'Beverages',
  'Dairy & Cold Cuts',
  'Instant & Canned Goods',
  'Bakery',
  'Personal Care & Toiletries',
  'Household & Cleaning',
  'Baby & Child Care',
  'Health & Pharmacy',
  'Groceries & Pantry'
] as const;

export type ConvenienceCategory = typeof CONVENIENCE_CATEGORIES[number];

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

export const ALL_SERVICES: { id: OrderServiceType; label: string; description: string }[] = [
  { id: 'food', label: 'Food Delivery', description: 'Restaurant food and meals' },
  { id: 'convenience', label: 'Convenience', description: 'Grocery and convenience store delivery' },
  { id: 'parcel', label: 'Parcel Express', description: 'Package pickup and delivery' },
  { id: 'pabili', label: 'Pabili Service', description: 'Custom errand and buying service' },
  { id: 'request_rider', label: 'Request Driver', description: 'Point-to-point dedicated driver' },
  { id: 'taxi', label: 'Taxi Service', description: 'Passenger ride-hailing and transit' }
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

