// Curated cluster manifest used by V11's three-level constellation navigation.
//
// The 20 destinations collapse into ~6 "nebulae" on the world map. Each
// cluster has a centroid (used for world anchors and as the camera target
// during the dolly-zoom), a bounds radius (how far out the camera pulls the
// fanned-out pins), and the list of destination slugs it contains.
//
// Coordinates are approximate seed lng/lat — exact enough for the stylised
// world view, which intentionally doesn't line up 1:1 with satellite.

export type ClusterId =
  | "alps"
  | "himalaya"
  | "japan"
  | "north-america"
  | "patagonia"
  | "iceland"
  | "oceania"
  | "mediterranean";

export interface ClusterDef {
  id: ClusterId;
  name: string;
  subtitle: string;
  center: [number, number]; // [lng, lat]
  boundsRadiusDeg: number; // used for framing + fan-out scaling
  slugs: string[];
}

// NOTE: ordering matters. The list is rendered as-is in the overview UI.
export const CLUSTERS: ClusterDef[] = [
  {
    id: "alps",
    name: "Alps",
    subtitle: "FR · CH · IT · AT",
    center: [9.5, 46.2],
    boundsRadiusDeg: 4.0,
    slugs: [
      "chamonix",
      "zermatt",
      "verbier",
      "val-disere",
      "tour-du-mont-blanc",
      "haute-route",
      "st-anton",
      "lech-zurs",
      "cortina-dampezzo",
    ],
  },
  {
    id: "himalaya",
    name: "Himalaya",
    subtitle: "NP · CN",
    center: [91.0, 28.2],
    boundsRadiusDeg: 8.0,
    slugs: ["annapurna-circuit", "everest-base-camp", "yubeng-village"],
  },
  {
    id: "japan",
    name: "Japan",
    subtitle: "Honshū · Hokkaidō",
    center: [138.0, 37.5],
    boundsRadiusDeg: 6.5,
    slugs: ["hakuba", "niseko", "kumano-kodo"],
  },
  {
    id: "mediterranean",
    name: "Mediterranean",
    subtitle: "Corsica",
    center: [9.2, 42.2],
    boundsRadiusDeg: 2.0,
    slugs: ["gr20"],
  },
  {
    id: "north-america",
    name: "North America",
    subtitle: "Coast Range",
    center: [-122.9, 50.1],
    boundsRadiusDeg: 2.0,
    slugs: ["whistler"],
  },
  {
    id: "iceland",
    name: "Iceland",
    subtitle: "Highlands",
    center: [-19.0, 64.0],
    boundsRadiusDeg: 2.0,
    slugs: ["laugavegur-trail"],
  },
  {
    id: "patagonia",
    name: "Patagonia",
    subtitle: "Chile",
    center: [-73.0, -51.0],
    boundsRadiusDeg: 2.0,
    slugs: ["torres-del-paine"],
  },
  {
    id: "oceania",
    name: "Oceania",
    subtitle: "Fiordland",
    center: [167.9, -44.6],
    boundsRadiusDeg: 2.0,
    slugs: ["milford-track"],
  },
];

export function clusterForSlug(slug: string): ClusterDef | null {
  return CLUSTERS.find((c) => c.slugs.includes(slug)) ?? null;
}

export function getCluster(id: ClusterId): ClusterDef | null {
  return CLUSTERS.find((c) => c.id === id) ?? null;
}
