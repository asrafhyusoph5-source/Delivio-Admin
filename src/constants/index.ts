import { OrderServiceType } from '../types';

export const FOOD_CATEGORIES = [
  'Fast Food',
  'Filipino',
  'Asian',
  'Pizza & Pasta',
  'Burgers & Sandwiches',
  'Milk Tea & Coffee',
  'Desserts & Pastries',
  'Halal',
  'Healthy & Vegetarian',
  'Bar & Beverages'
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
  serviceFee: number;
  commissionPercent: number;
}> = {
  motorcycle: {
    enabled: true,
    baseFare: 40,
    includedKm: 2,
    perKm: 10,
    minFare: 50,
    perStopFee: 15,
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
    serviceFee: 10,
    commissionPercent: 15
  }
};
