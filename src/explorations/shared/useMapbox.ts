import { useEffect, useRef, useState } from "react";
import type * as MBGL from "mapbox-gl";
import {
  YUBENG_BEARING,
  YUBENG_CENTER,
  YUBENG_PITCH,
  YUBENG_ZOOM,
} from "./mockData";

// mapboxgl is provided by the CDN script tag in index.html.
declare const mapboxgl: typeof import("mapbox-gl").default;

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;

export interface UseMapboxOptions {
  style: string | MBGL.StyleSpecification;
  pitch?: number;
  bearing?: number;
  zoom?: number;
  center?: [number, number];
  onStyleLoad?: (map: MBGL.Map) => void;
  /**
   * Layer id prefixes or ids to force-hide (labels, roads, etc.).
   * By default strips satellite/raster basemap + roads + labels.
   */
  hideLayers?: string[];
}

export const DEFAULT_HIDDEN = [
  "satellite",
  "poi-label",
  "transit-label",
  "road-label",
  "road-label-simple",
  "road-minor-label",
  "waterway-label",
  "natural-line-label",
  "natural-point-label",
  "airport-label",
  "country-label",
  "state-label",
  "place-label",
  "settlement-label",
  "settlement-subdivision-label",
];

export function hideLayersByIdOrPrefix(map: MBGL.Map, ids: string[]) {
  const style = map.getStyle();
  if (!style?.layers) return;
  for (const layer of style.layers) {
    for (const target of ids) {
      if (layer.id === target || layer.id.startsWith(target)) {
        try {
          map.setLayoutProperty(layer.id, "visibility", "none");
        } catch {
          /* skip */
        }
        break;
      }
    }
  }
}

export function useMapbox(opts: UseMapboxOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MBGL.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep callback in a ref so style changes don't retrigger map creation.
  const onStyleLoadRef = useRef(opts.onStyleLoad);
  onStyleLoadRef.current = opts.onStyleLoad;

  const hideLayersRef = useRef(opts.hideLayers);
  hideLayersRef.current = opts.hideLayers;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (typeof mapboxgl === "undefined") {
      setError("mapbox-gl failed to load from CDN.");
      return;
    }
    if (!MAPBOX_TOKEN) {
      setError("VITE_MAPBOX_TOKEN is not set.");
      return;
    }

    (mapboxgl as unknown as { accessToken: string }).accessToken = MAPBOX_TOKEN;

    const map = new mapboxgl.Map({
      container,
      style: opts.style,
      center: opts.center ?? YUBENG_CENTER,
      zoom: opts.zoom ?? YUBENG_ZOOM,
      pitch: opts.pitch ?? YUBENG_PITCH,
      bearing: opts.bearing ?? YUBENG_BEARING,
      attributionControl: false,
      antialias: true,
      failIfMajorPerformanceCaveat: false,
    });

    mapRef.current = map;

    let cancelled = false;
    const markReady = () => {
      if (cancelled) return;
      try {
        hideLayersByIdOrPrefix(map, [
          ...DEFAULT_HIDDEN,
          ...(hideLayersRef.current ?? []),
        ]);
        onStyleLoadRef.current?.(map);
        map.resize();
      } catch (e) {
        console.error(e);
      }
      setReady(true);
    };

    map.once("style.load", markReady);

    return () => {
      cancelled = true;
      map.remove();
      mapRef.current = null;
    };
    // We intentionally re-run only when the style reference changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.style]);

  return { containerRef, map: mapRef.current, ready, error };
}

export type { MBGL };
