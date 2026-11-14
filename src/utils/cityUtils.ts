import type { City } from '../types';

/**
 * Normalizes a city id or name for matching by removing capitals, spaces, dashes,
 * and the standalone word "city".
 */
export function normalizeCityKey(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/\bcity\b/gi, '')
    .replace(/[\s\-_]+/g, '')
    .trim();
}

/**
 * Checks whether a cityId string matches an existing document ID in the cities collection.
 */
export function isExistingCityId(cityId: string | null | undefined, cities: City[]): boolean {
  const clean = (cityId || '').trim();
  if (!clean) return false;
  return cities.some((c) => c.id === clean);
}

/**
 * Finds the matching City document by comparing each city's id and name against value,
 * ignoring capitals, spaces, dashes, and the word "City".
 */
export function findMatchingCity(value: string | null | undefined, cities: City[]): City | null {
  const clean = (value || '').trim();
  if (!clean || cities.length === 0) return null;

  const exactId = cities.find((c) => c.id === clean);
  if (exactId) return exactId;

  const target = normalizeCityKey(clean);
  if (!target) return null;

  return (
    cities.find(
      (c) => normalizeCityKey(c.id) === target || normalizeCityKey(c.name) === target
    ) || null
  );
}
