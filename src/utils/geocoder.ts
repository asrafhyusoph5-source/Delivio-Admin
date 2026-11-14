/**
 * Builds a concise human-readable address string from a geocoder (Nominatim) result:
 * 1. road and house number
 * 2. barangay or suburb or neighbourhood
 * 3. city or town or municipality
 * 4. province
 * Removes empty and duplicate parts (case-insensitive), keeps at most 4 parts,
 * and falls back to a trimmed display_name only when nothing else exists.
 */
export function formatGeocoderAddress(result: any): string {
  const addr = result?.address && typeof result.address === 'object' ? result.address : {};

  const road = typeof addr.road === 'string' ? addr.road.trim() : '';
  const houseNumber = typeof addr.house_number === 'string' ? addr.house_number.trim() : '';
  const streetPart = [houseNumber, road].filter(Boolean).join(' ').trim();

  const barangayPart = (
    (typeof addr.barangay === 'string' && addr.barangay) ||
    (typeof addr.suburb === 'string' && addr.suburb) ||
    (typeof addr.neighbourhood === 'string' && addr.neighbourhood) ||
    ''
  ).trim();

  const cityPart = (
    (typeof addr.city === 'string' && addr.city) ||
    (typeof addr.town === 'string' && addr.town) ||
    (typeof addr.municipality === 'string' && addr.municipality) ||
    ''
  ).trim();

  const provincePart = (
    (typeof addr.province === 'string' && addr.province) ||
    (typeof addr.state === 'string' && addr.state) ||
    ''
  ).trim();

  const rawParts = [streetPart, barangayPart, cityPart, provincePart];
  const seen = new Set<string>();
  const uniqueParts: string[] = [];

  for (const part of rawParts) {
    if (!part) continue;
    const key = part.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueParts.push(part);
    if (uniqueParts.length >= 4) break;
  }

  if (uniqueParts.length > 0) {
    return uniqueParts.join(', ');
  }

  return typeof result?.display_name === 'string' ? result.display_name.trim() : '';
}

/**
 * Reverse geocodes coordinates using Nominatim and builds the standardized address string.
 */
export async function reverseGeocodePin(lat: number, lng: number): Promise<string> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/reverse?format=json&addressdetails=1&lat=${encodeURIComponent(
      String(lat)
    )}&lon=${encodeURIComponent(String(lng))}`
  );
  if (!res.ok) {
    throw new Error('Failed to reverse geocode coordinates');
  }
  const data = await res.json();
  return formatGeocoderAddress(data);
}
