export const astanaBounds = { south: 50.95, north: 51.35, west: 71.15, east: 71.75 };
export function inAstana(lat: number, lng: number) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= astanaBounds.south && lat <= astanaBounds.north && lng >= astanaBounds.west && lng <= astanaBounds.east;
}
export function isAstana(city: string) { return ['астана', 'astana', 'нур-султан', 'nur-sultan'].includes(city.trim().toLowerCase()); }
