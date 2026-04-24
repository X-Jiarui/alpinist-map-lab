import type { Feature, FeatureCollection, LineString, Point } from "geojson";

export const YUBENG_CENTER: [number, number] = [98.7667, 28.4333];
export const YUBENG_ZOOM = 13;
export const YUBENG_PITCH = 65;
export const YUBENG_BEARING = 28;

export interface MockHotel {
  id: string;
  name: string;
  nameZh?: string;
  pricePerNight: number;
  currency: string;
  rating: number;
  coordinates: [number, number];
  description: string;
}

export const MOCK_HOTELS: MockHotel[] = [
  {
    id: "trailside-hostel",
    name: "Trailside Hostel",
    nameZh: "雨崩驿栈",
    pricePerNight: 65,
    currency: "¥",
    rating: 4.6,
    coordinates: [98.7632, 28.4368],
    description: "Bunk-style rooms 4 minutes from the Sacred Waterfall trailhead.",
  },
  {
    id: "meili-snow-lodge",
    name: "Meili Snow Lodge",
    nameZh: "梅里雪山小屋",
    pricePerNight: 180,
    currency: "¥",
    rating: 4.9,
    coordinates: [98.7712, 28.4298],
    description: "Boutique timber lodge with panoramic Kawagarbo views.",
  },
];

const TRAIL_COORDS: [number, number][] = [
  [98.7601, 28.4392],
  [98.7626, 28.4378],
  [98.7652, 28.4362],
  [98.7679, 28.4348],
  [98.7697, 28.4335],
  [98.7718, 28.4319],
  [98.7739, 28.4301],
  [98.7755, 28.4284],
  [98.7766, 28.4266],
  [98.7772, 28.4248],
];

export const TRAIL_FEATURE: Feature<LineString> = {
  type: "Feature",
  properties: {
    name: "Sacred Waterfall Trail",
    nameZh: "神瀑步道",
    distanceKm: 3.6,
    elevationGainM: 420,
  },
  geometry: {
    type: "LineString",
    coordinates: TRAIL_COORDS,
  },
};

export const TRAIL_GEOJSON: FeatureCollection<LineString> = {
  type: "FeatureCollection",
  features: [TRAIL_FEATURE],
};

export const HOTEL_GEOJSON: FeatureCollection<Point> = {
  type: "FeatureCollection",
  features: MOCK_HOTELS.map((h) => ({
    type: "Feature",
    properties: {
      id: h.id,
      name: h.name,
      price: h.pricePerNight,
      currency: h.currency,
    },
    geometry: { type: "Point", coordinates: h.coordinates },
  })),
};

export function buildLngLatGrid(
  centerLng: number,
  centerLat: number,
  stepDeg = 0.01,
  extentDeg = 0.1,
): FeatureCollection<LineString> {
  const features: Feature<LineString>[] = [];
  const minLng = centerLng - extentDeg;
  const maxLng = centerLng + extentDeg;
  const minLat = centerLat - extentDeg;
  const maxLat = centerLat + extentDeg;

  for (let lng = minLng; lng <= maxLng + 1e-9; lng += stepDeg) {
    features.push({
      type: "Feature",
      properties: { axis: "meridian" },
      geometry: {
        type: "LineString",
        coordinates: [
          [lng, minLat],
          [lng, maxLat],
        ],
      },
    });
  }
  for (let lat = minLat; lat <= maxLat + 1e-9; lat += stepDeg) {
    features.push({
      type: "Feature",
      properties: { axis: "parallel" },
      geometry: {
        type: "LineString",
        coordinates: [
          [minLng, lat],
          [maxLng, lat],
        ],
      },
    });
  }
  return { type: "FeatureCollection", features };
}

export const EXPLORATIONS = [
  { id: "v1", slug: "v1", title: "Plaster Diorama", subtitle: "Minimalist Clay", palette: ["#F7F7F5", "#0A0A0A", "#FF3300"] },
  { id: "v2", slug: "v2", title: "Contour Data Poster", subtitle: "Topology Art", palette: ["#0B0C10", "#66FCF1", "#D4AF37"] },
  { id: "v3", slug: "v3", title: "Obsidian & Gold", subtitle: "Luxury Wireframe", palette: ["#000000", "#FFD700", "#1a1000"] },
  { id: "v4", slug: "v4", title: "Synthwave Grid", subtitle: "Retro-Futuristic", palette: ["#1a0033", "#FF00FF", "#00FFFF"] },
  { id: "v5", slug: "v5", title: "Paper Cut-out", subtitle: "Tactile Laser-Cut", palette: ["#E7D3B0", "#9CAF88", "#D9A577"] },
  { id: "v6", slug: "v6", title: "Ink Wash 山水", subtitle: "Modern Shanshui", palette: ["#F9F6F0", "#1a1a1a", "#8B0000"] },
  { id: "v7", slug: "v7", title: "Deep Ocean Blueprint", subtitle: "Cyanotype", palette: ["#003366", "#FFFFFF", "#00AAFF"] },
  { id: "v8", slug: "v8", title: "Thermal Vision", subtitle: "Predator Drone", palette: ["#2d0066", "#FF8C00", "#FFFF00"] },
  { id: "v9", slug: "v9", title: "Ethereal Pastel", subtitle: "Dreamy Frosted", palette: ["#E6D7FF", "#D9F2E6", "#FFD7E6"] },
  { id: "v10", slug: "v10", title: "Liquid Chrome", subtitle: "Pure WebGL", palette: ["#0a0a0a", "#cfd4da", "#ffffff"] },
  { id: "v11", slug: "v11", title: "Unified Geo-Art", subtitle: "Micro ↔ Macro", palette: ["#050506", "#6b7280", "#ffffff"] },
] as const;
