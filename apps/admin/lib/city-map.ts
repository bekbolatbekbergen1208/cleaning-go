import type { MapPoint } from '../components/maps/astana-map';

const centers: Record<string, MapPoint> = {
  'астана': { latitude: 51.1282, longitude: 71.4304 },
  'нур-султан': { latitude: 51.1282, longitude: 71.4304 },
  'алматы': { latitude: 43.2383, longitude: 76.9455 },
  'актау': { latitude: 43.6511, longitude: 51.1575 },
  'атырау': { latitude: 47.1164, longitude: 51.8837 },
  'шымкент': { latitude: 42.3155, longitude: 69.5869 },
  'караганда': { latitude: 49.8047, longitude: 73.1094 },
  'актобе': { latitude: 50.2839, longitude: 57.1669 },
  'тараз': { latitude: 42.8996, longitude: 71.3653 },
  'павлодар': { latitude: 52.2873, longitude: 76.9674 },
  'костанай': { latitude: 53.2144, longitude: 63.6246 },
  'кызылорда': { latitude: 44.8479, longitude: 65.5092 },
  'семей': { latitude: 50.4111, longitude: 80.2275 },
  'оскемен': { latitude: 49.9565, longitude: 82.6119 },
  'усть-каменогорск': { latitude: 49.9565, longitude: 82.6119 },
  'орал': { latitude: 51.2333, longitude: 51.3667 },
  'уральск': { latitude: 51.2333, longitude: 51.3667 },
  'петропавловск': { latitude: 54.8753, longitude: 69.1628 },
  'туркестан': { latitude: 43.2973, longitude: 68.2518 },
  'талдыкорган': { latitude: 45.0156, longitude: 78.3739 },
  'кокшетау': { latitude: 53.2833, longitude: 69.3833 },
};

export function cityCenter(city: string): MapPoint {
  return centers[city.trim().toLowerCase()] ?? { latitude: 51.1282, longitude: 71.4304 };
}
