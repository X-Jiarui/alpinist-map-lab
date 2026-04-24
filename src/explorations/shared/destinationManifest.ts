// Type + loader shared by the data-driven V10 view. The on-disk shape is
// produced by `pipeline/alpinist_pipeline.py`.

import { useEffect, useState } from "react";

export interface DestinationBBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface DestinationTrail {
  type: "LineString";
  coordinates: [number, number][];
}

export interface DestinationHotel {
  lng: number;
  lat: number;
  name: string;
  stars?: number | null;
}

export interface DestinationManifest {
  slug: string;
  name: string;
  country: string;
  category: "trekking" | "skiing";
  seed: { lng: number; lat: number };
  bbox: {
    raw: DestinationBBox;
    padded: DestinationBBox;
    expanded?: DestinationBBox;
    expand_factor?: number;
  };
  camera: { center: [number, number]; zoom: number };
  dem: {
    source: "mapbox.terrain-rgb";
    zoom: number;
    tile_size: number;
    tiles: { z: number; x: number; y: number }[];
    tile_grid: { x_min: number; y_min: number; x_max: number; y_max: number };
    image: {
      path: string;
      encoding: "mapbox-terrain-rgb";
      bounds: DestinationBBox;
      width: number;
      height: number;
    };
  };
  trails: DestinationTrail[];
  hotels: DestinationHotel[];
  generated_at: number;
}

export interface DestinationIndexEntry {
  slug: string;
  name: string;
  country: string;
  category: "trekking" | "skiing";
}

export type ManifestState =
  | { status: "loading" }
  | { status: "ready"; manifest: DestinationManifest; terrainUrl: string }
  | { status: "error"; error: string };

export function useDestinationManifest(slug: string): ManifestState {
  const [state, setState] = useState<ManifestState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    const base = `/destinations/${slug}`;
    fetch(`${base}/manifest.json`, { cache: "force-cache" })
      .then((r) => {
        if (!r.ok) throw new Error(`manifest ${r.status}`);
        return r.json() as Promise<DestinationManifest>;
      })
      .then((manifest) => {
        if (cancelled) return;
        const terrainUrl = `${base}/${manifest.dem.image.path}`;
        setState({ status: "ready", manifest, terrainUrl });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : "failed to load manifest";
        setState({ status: "error", error: message });
      });

    return () => {
      cancelled = true;
    };
  }, [slug]);

  return state;
}

export function useDestinationIndex(): DestinationIndexEntry[] {
  const [index, setIndex] = useState<DestinationIndexEntry[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch("/destinations/index.json", { cache: "force-cache" })
      .then((r) => (r.ok ? (r.json() as Promise<DestinationIndexEntry[]>) : []))
      .then((arr) => {
        if (!cancelled) setIndex(arr);
      })
      .catch(() => {
        if (!cancelled) setIndex([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return index;
}
