// V11 — Constellation Navigation.
//
// A three-level editorial map:
//
//   world      top-down real-DEM ink-wash canvas with a handful of pulsing
//              cluster "anchors" (one per region, no individual destinations).
//   cluster    the camera dolly-zooms into a region: FOV narrows while the
//              camera drops, so the region grows while individual pins fan
//              out around the centroid on a ring, connected by thin white
//              brutalist constellation lines.
//   destination    pre-existing Liquid Chrome orbit + decoded Mapbox
//              Terrain-RGB island (GPU lerp reveal).
//
// This replaces the previous flat "hover → bloom" design, which didn't scale
// past the 9-way Alpine cluster (pins collapsed into one world unit).

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import { Environment, Html, Line } from "@react-three/drei";
import {
  Bloom,
  EffectComposer,
  Noise,
  Vignette,
} from "@react-three/postprocessing";
import { BlendFunction } from "postprocessing";
import * as THREE from "three";

import ExplorationShell from "./shared/ExplorationShell";
import DestinationPicker from "./shared/DestinationPicker";
import {
  CLUSTERS,
  ClusterDef,
  ClusterId,
  clusterForSlug,
  getCluster,
} from "./shared/clusters";
import {
  DestinationIndexEntry,
  DestinationManifest,
  useDestinationIndex,
} from "./shared/destinationManifest";

// ---------------------------------------------------------------- constants

// World spans 200×100 Three-units. Equirectangular: 1 unit ≈ 1.8° lng/lat.
const WORLD_W = 200;
const WORLD_H = 100;

const ISLAND_SIZE = 12;
const ISLAND_SEGMENTS = 256;

// V10 used 3.2 over a 10-unit plane. V11 island scale ×1.5 for the expanded
// bbox.
const ISLAND_DISPLACEMENT = 4.8;

// Valley-floor → peak envelope, same decoding as V10.
const BASE_HEIGHT = 1000;
const HEIGHT_RANGE = 6000;

// ---- camera tuning

// Level 1: top-down world overview.
const WORLD_CAM = {
  position: new THREE.Vector3(0, 70, 34),
  lookAt: new THREE.Vector3(0, 0, 4),
  fov: 42,
};

// Level 3: low-angle chrome orbit.
const ORBIT_HEIGHT = 5.5;
const ORBIT_RADIUS = 9;
const DESTINATION_FOV = 28;

// Dolly tuning — lower numbers = slower, more cinematic.
const CAM_DAMP_POS = 3.0;
const CAM_DAMP_LOOK = 3.5;
const CAM_DAMP_FOV = 3.0;

// Reveal lerp (per-frame @60fps).
const REVEAL_LERP = 0.08;

// ---------------------------------------------------------------- helpers

function equirectToWorld(lng: number, lat: number): [number, number] {
  const x = (lng / 180) * (WORLD_W / 2);
  const z = -(lat / 90) * (WORLD_H / 2);
  return [x, z];
}

// How far, in world units, the fanned pins orbit the cluster centroid.
// Keeps small clusters (1–3 destinations) punchy without flinging single
// pins to the horizon, while still giving the 9-way Alps plenty of breathing
// room.
function clusterFanRadius(cluster: ClusterDef): number {
  const n = cluster.slugs.length;
  if (n === 1) return 0;
  if (n === 2) return 5;
  if (n === 3) return 6;
  // boundsRadiusDeg is in degrees; at our world scale 1 deg ≈ 0.56 units,
  // so 1.8x makes a 4° cluster span ~13 units diameter.
  return Math.max(6, cluster.boundsRadiusDeg * 1.8);
}

// Pin slot positions: a fan around the cluster centroid. Used whenever mode
// is "cluster" or "destination" so labels never collapse. World mode hides
// the pins entirely.
function computeClusterPinSlots(
  cluster: ClusterDef,
): Record<string, [number, number]> {
  const [cLng, cLat] = cluster.center;
  const [cx, cz] = equirectToWorld(cLng, cLat);
  const n = cluster.slugs.length;
  if (n === 1) return { [cluster.slugs[0]]: [cx, cz] };
  const fanRadius = clusterFanRadius(cluster);
  const out: Record<string, [number, number]> = {};
  for (let i = 0; i < n; i++) {
    // Start at top (−Z), clockwise.
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    out[cluster.slugs[i]] = [
      cx + Math.cos(a) * fanRadius,
      cz + Math.sin(a) * fanRadius,
    ];
  }
  return out;
}

// Minimum spanning tree over a list of 2D points (Prim's). Returns edge pairs
// as indexes into the input array. Used by <ConstellationLines>.
function minimumSpanningTree(points: [number, number][]): [number, number][] {
  const n = points.length;
  if (n < 2) return [];
  const inTree = new Array<boolean>(n).fill(false);
  const edges: [number, number][] = [];
  inTree[0] = true;
  for (let iter = 0; iter < n - 1; iter++) {
    let bestDist = Infinity;
    let bestFrom = -1;
    let bestTo = -1;
    for (let i = 0; i < n; i++) {
      if (!inTree[i]) continue;
      for (let j = 0; j < n; j++) {
        if (inTree[j]) continue;
        const dx = points[i][0] - points[j][0];
        const dy = points[i][1] - points[j][1];
        const d = dx * dx + dy * dy;
        if (d < bestDist) {
          bestDist = d;
          bestFrom = i;
          bestTo = j;
        }
      }
    }
    if (bestTo < 0) break;
    inTree[bestTo] = true;
    edges.push([bestFrom, bestTo]);
  }
  return edges;
}

// ---------------------------------------------------------------- world shader (DEM + ink wash)

const WORLD_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec2 vWorldXZ;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldXZ = world.xz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

// Fragment: if a global DEM texture is bound, decode Terrain-RGB and render
// as ink-wash ridges. Else fall back to procedural FBM (so the view still
// works before/without the pipeline artefact).
const WORLD_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  varying vec2 vWorldXZ;

  uniform float uTime;
  uniform int   uHotspotCount;
  uniform vec2  uHotspots[12];
  uniform float uHotspotHeat[12];
  uniform vec3  uPaper;
  uniform vec3  uInk;
  uniform vec3  uHotInk;
  uniform float uWorldW;
  uniform float uWorldH;

  uniform sampler2D uHeightMap;
  uniform float uHasDem;        // 1.0 if DEM loaded, 0.0 otherwise
  uniform float uMaxElevation;  // metres

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p){
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f*f*(3.0-2.0*f);
    return mix(mix(hash(i), hash(i+vec2(1,0)), u.x),
               mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
  }
  float fbm(vec2 p){
    float a = 0.5, r = 0.0;
    for(int i=0;i<5;i++){ r += a*vnoise(p); p *= 2.03; a *= 0.5; }
    return r;
  }

  // Sample decoded Mapbox Terrain-RGB at world coordinate. Returns height in
  // [0, 1] normalised by uMaxElevation. Clamped to 0 below sea level so
  // ocean doesn't create negative ridges.
  float sampleGlobalDem(vec2 worldXZ) {
    vec2 uv = vec2(
      0.5 + worldXZ.x / uWorldW,
      0.5 + worldXZ.y / uWorldH
    );
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
    vec3 c = texture2D(uHeightMap, uv).rgb;
    float m = -10000.0 + (c.r * 65536.0 + c.g * 256.0 + c.b) * 255.0 * 0.1;
    return clamp(m / uMaxElevation, 0.0, 1.0);
  }

  void main() {
    vec3 col = uPaper;

    // ---- elevation layer (DEM preferred, FBM fallback)
    float topo;
    float grad;
    if (uHasDem > 0.5) {
      topo = sampleGlobalDem(vWorldXZ);
      // Finite-difference gradient from 4-tap neighbours (avoids the
      // GL_OES_standard_derivatives extension dance). eps is in world units.
      float eps = 1.2;
      float hL = sampleGlobalDem(vWorldXZ + vec2(-eps, 0.0));
      float hR = sampleGlobalDem(vWorldXZ + vec2( eps, 0.0));
      float hD = sampleGlobalDem(vWorldXZ + vec2(0.0, -eps));
      float hU = sampleGlobalDem(vWorldXZ + vec2(0.0,  eps));
      grad = length(vec2(hR - hL, hU - hD));
    } else {
      vec2 p = vWorldXZ * 0.035;
      topo = fbm(p + vec2(13.1, 7.3));
      grad = 0.0;
    }

    // Broad ridge shading: anything above "highland" threshold gets inked.
    float ridge = smoothstep(0.22, 0.9, topo);
    col = mix(col, uInk, ridge * 0.35);

    // Crisp contour band — ink-bleed effect on big mountains.
    float band = 1.0 - smoothstep(0.0, 0.045, abs(fract(topo * 8.0) - 0.5));
    col = mix(col, uInk * 1.25, band * 0.22 * ridge);

    // Edge ink strokes along steep gradients.
    float edge = smoothstep(0.02, 0.08, grad);
    col = mix(col, uHotInk, edge * 0.28);

    // Fine rice-paper grain.
    col += vnoise(vWorldXZ * 7.0) * 0.04;

    // ---- cluster hotspots (blooms only at the anchor points)
    for (int i = 0; i < 12; i++) {
      if (i >= uHotspotCount) break;
      vec2 h = uHotspots[i];
      float heat = uHotspotHeat[i];
      float d = length(vWorldXZ - h);
      float falloff = exp(-d * d * 0.012);
      float pulse = 0.5 + 0.5 * sin(uTime * 1.1 + float(i) * 1.7);
      float coldBleed = falloff * 0.14 * (0.5 + 0.5 * pulse);
      float hotBleed  = falloff * 0.5 * heat;
      col = mix(col, uHotInk, clamp(coldBleed + hotBleed, 0.0, 0.7));
    }

    // Soft radial vignette anchored at world origin so the edges of the
    // plane fall off consistently regardless of camera zoom.
    vec2 uv = (vUv - 0.5) * 2.0;
    float r = length(uv);
    col *= mix(1.0, 0.35, smoothstep(0.7, 1.4, r));

    // Global exposure clamp so cluster-zoom doesn't blow out the bloom pass.
    col *= 0.75;

    gl_FragColor = vec4(col, 1.0);
  }
`;

interface WorldBaseProps {
  hotspotsRef: React.MutableRefObject<
    { position: THREE.Vector2; heat: number }[]
  >;
}

function WorldBase({ hotspotsRef }: WorldBaseProps) {
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);

  // Optional global DEM (falls back to FBM if missing).
  const [demTex, setDemTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    let cancelled = false;
    const loader = new THREE.TextureLoader();
    loader.load(
      "/destinations/_global/terrain.png",
      (tex) => {
        if (cancelled) {
          tex.dispose();
          return;
        }
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        tex.colorSpace = THREE.NoColorSpace;
        tex.needsUpdate = true;
        setDemTex(tex);
      },
      undefined,
      () => {
        // 404 or network — silently fall back to procedural FBM.
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    return () => {
      demTex?.dispose();
    };
  }, [demTex]);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uHotspotCount: { value: 0 },
      uHotspots: {
        value: Array.from({ length: 12 }, () => new THREE.Vector2(0, 0)),
      },
      uHotspotHeat: { value: new Float32Array(12) },
      uPaper: { value: new THREE.Color("#060608") },
      uInk: { value: new THREE.Color("#c4c8d0") },
      uHotInk: { value: new THREE.Color("#ffffff") },
      uWorldW: { value: WORLD_W },
      uWorldH: { value: WORLD_H },
      uHeightMap: { value: null as THREE.Texture | null },
      uHasDem: { value: 0 },
      uMaxElevation: { value: 8000 },
    }),
    [],
  );

  // Bind DEM if/when it arrives. Rebinding after material creation is cheap.
  useEffect(() => {
    uniforms.uHeightMap.value = demTex;
    uniforms.uHasDem.value = demTex ? 1 : 0;
    if (materialRef.current) materialRef.current.uniformsNeedUpdate = true;
  }, [demTex, uniforms]);

  useFrame((_, dt) => {
    const u = uniforms;
    u.uTime.value += dt;
    const list = hotspotsRef.current;
    u.uHotspotCount.value = Math.min(12, list.length);
    for (let i = 0; i < Math.min(12, list.length); i++) {
      (u.uHotspots.value[i] as THREE.Vector2).copy(list[i].position);
      u.uHotspotHeat.value[i] = list[i].heat;
    }
    if (materialRef.current) {
      materialRef.current.uniformsNeedUpdate = true;
    }
  });

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, -0.001, 0]}
      receiveShadow={false}
    >
      <planeGeometry args={[WORLD_W, WORLD_H, 1, 1]} />
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        vertexShader={WORLD_VERT}
        fragmentShader={WORLD_FRAG}
      />
    </mesh>
  );
}

// ---------------------------------------------------------------- island shader (unchanged from previous pass)

const ISLAND_VERT_HEADER = /* glsl */ `
varying float vMask;
varying float vReveal;
uniform sampler2D uHeightMap;
uniform float uDisplacement;
uniform float uPlaneSize;
uniform float uReveal;
uniform float uBaseHeight;
uniform float uHeightRange;

float _dec(vec2 uvIn){
  vec3 c = texture2D(uHeightMap, uvIn).rgb;
  return -10000.0 + (c.r*65536.0 + c.g*256.0 + c.b) * 255.0 * 0.1;
}
float sampleH(vec2 uvIn){
  float m = _dec(uvIn);
  return max(0.0, (m - uBaseHeight) / uHeightRange);
}
`;

const ISLAND_FRAG_HEADER = /* glsl */ `
varying float vMask;
varying float vReveal;
uniform vec3 uInkColor;
`;

const ISLAND_BEGIN_REPLACE = /* glsl */ `
float _hC = sampleH(uv);
vec2 _d = uv - 0.5;
float _r = length(_d) * 2.0;
float _mask = 1.0 - smoothstep(0.55, 0.95, _r);
vMask = _mask;
vReveal = uReveal;
vec3 transformed = vec3(position);
transformed += normal * _hC * uDisplacement * _mask * uReveal;
`;

function islandNormalReplace(texWidth: number) {
  return /* glsl */ `
float _s = 1.0 / ${texWidth.toFixed(1)};
vec2 _dN = uv - 0.5;
float _rN = length(_dN) * 2.0;
float _maskN = 1.0 - smoothstep(0.55, 0.95, _rN);
float _hL = sampleH(uv - vec2(_s,0.0));
float _hR = sampleH(uv + vec2(_s,0.0));
float _hD = sampleH(uv - vec2(0.0,_s));
float _hU = sampleH(uv + vec2(0.0,_s));
float _du = (_hR - _hL) / (2.0 * _s);
float _dv = (_hU - _hD) / (2.0 * _s);
float _slope = uDisplacement / uPlaneSize * _maskN * uReveal;
vec3 objectNormal = normalize(vec3(-_du * _slope, -_dv * _slope, 1.0));
#ifdef USE_TANGENT
  vec3 objectTangent = vec3(tangent.xyz);
#endif
`;
}

const ISLAND_FRAG_OUTPUT_REPLACE = /* glsl */ `
vec3 _cold = uInkColor;
outgoingLight = mix(_cold, outgoingLight, smoothstep(0.0, 0.6, vReveal));
float _alpha = mix(0.0, diffuseColor.a, vReveal);
gl_FragColor = vec4(outgoingLight, _alpha * (vMask * vMask));
`;

// ---------------------------------------------------------------- procedural roughness

function makeRoughness(size: number): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const s = Math.sin((x * 12.9898 + y * 78.233) * 0.5) * 43758.5453;
      const n = s - Math.floor(s);
      const g = Math.floor(130 + n * 100);
      const i = (y * size + x) * 4;
      data[i] = g;
      data[i + 1] = g;
      data[i + 2] = g;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 2;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------- island terrain

interface IslandTerrainProps {
  heightTex: THREE.Texture;
  roughnessTex: THREE.Texture;
  texWidth: number;
  revealRef: React.MutableRefObject<number>;
}

function IslandTerrain({
  heightTex,
  roughnessTex,
  texWidth,
  revealRef,
}: IslandTerrainProps) {
  useMemo(() => {
    heightTex.colorSpace = THREE.NoColorSpace;
    heightTex.wrapS = THREE.ClampToEdgeWrapping;
    heightTex.wrapT = THREE.ClampToEdgeWrapping;
    heightTex.minFilter = THREE.LinearFilter;
    heightTex.magFilter = THREE.LinearFilter;
    heightTex.generateMipmaps = false;
    heightTex.needsUpdate = true;
    return null;
  }, [heightTex]);

  const material = useMemo(() => {
    const mat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color("#8d959c"),
      metalness: 1.0,
      roughness: 0.18,
      roughnessMap: roughnessTex,
      clearcoat: 1.0,
      clearcoatRoughness: 0.18,
      envMapIntensity: 0.55,
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
    });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uHeightMap = { value: heightTex };
      shader.uniforms.uDisplacement = { value: ISLAND_DISPLACEMENT };
      shader.uniforms.uPlaneSize = { value: ISLAND_SIZE };
      shader.uniforms.uReveal = { value: 0 };
      shader.uniforms.uBaseHeight = { value: BASE_HEIGHT };
      shader.uniforms.uHeightRange = { value: HEIGHT_RANGE };
      shader.uniforms.uInkColor = { value: new THREE.Color("#0a0b0d") };

      shader.vertexShader = ISLAND_VERT_HEADER + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <beginnormal_vertex>",
        islandNormalReplace(texWidth),
      );
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        ISLAND_BEGIN_REPLACE,
      );
      shader.fragmentShader = ISLAND_FRAG_HEADER + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <output_fragment>",
        ISLAND_FRAG_OUTPUT_REPLACE,
      );
      mat.userData.shader = shader;
    };
    return mat;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texWidth, heightTex, roughnessTex]);

  useFrame(() => {
    const shader = (
      material.userData as {
        shader?: { uniforms: Record<string, { value: unknown }> };
      }
    ).shader;
    if (shader?.uniforms?.uReveal) {
      shader.uniforms.uReveal.value = revealRef.current;
    }
  });

  useEffect(() => () => material.dispose(), [material]);

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={3}>
      <planeGeometry
        args={[ISLAND_SIZE, ISLAND_SIZE, ISLAND_SEGMENTS, ISLAND_SEGMENTS]}
      />
      <primitive object={material} attach="material" />
    </mesh>
  );
}

function LazyIsland({
  slug,
  revealRef,
  roughnessTex,
}: {
  slug: string;
  revealRef: React.MutableRefObject<number>;
  roughnessTex: THREE.Texture;
}) {
  const [manifest, setManifest] = useState<DestinationManifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/destinations/${slug}/manifest.json`, { cache: "force-cache" })
      .then((r) => {
        if (!r.ok) throw new Error(`manifest ${r.status}`);
        return r.json() as Promise<DestinationManifest>;
      })
      .then((m) => {
        if (!cancelled) setManifest(m);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (error || !manifest) return null;
  const terrainUrl = `/destinations/${slug}/${manifest.dem.image.path}`;
  return (
    <Suspense fallback={null}>
      <LoadedIsland
        manifest={manifest}
        terrainUrl={terrainUrl}
        roughnessTex={roughnessTex}
        revealRef={revealRef}
      />
    </Suspense>
  );
}

function LoadedIsland({
  manifest,
  terrainUrl,
  roughnessTex,
  revealRef,
}: {
  manifest: DestinationManifest;
  terrainUrl: string;
  roughnessTex: THREE.Texture;
  revealRef: React.MutableRefObject<number>;
}) {
  const heightTex = useLoader(THREE.TextureLoader, terrainUrl);
  return (
    <IslandTerrain
      heightTex={heightTex}
      roughnessTex={roughnessTex}
      texWidth={manifest.dem.image.width}
      revealRef={revealRef}
    />
  );
}

// ---------------------------------------------------------------- cluster pin (fanned-out with leader line)

interface ClusterPinProps {
  entry: DestinationIndexEntry;
  slotPos: [number, number]; // world-unit fanned position
  centroid: [number, number];
  revealRef: React.MutableRefObject<number>; // island reveal (0..1)
  clusterRevealRef: React.MutableRefObject<number>; // cluster-mode reveal (0..1)
  isHovered: boolean;
  isSelected: boolean;
  onHover: () => void;
  onUnhover: () => void;
  onSelect: () => void;
}

function ClusterPin({
  entry,
  slotPos,
  centroid,
  revealRef,
  clusterRevealRef,
  isHovered,
  isSelected,
  onHover,
  onUnhover,
  onSelect,
}: ClusterPinProps) {
  const groupRef = useRef<THREE.Group | null>(null);
  const htmlRef = useRef<HTMLDivElement | null>(null);
  const leaderRef = useRef<THREE.Mesh | null>(null);

  // Radial outward unit vector (from centroid to slot) — used to offset
  // the HTML label so it never overlaps neighbours.
  const radial = useMemo<[number, number]>(() => {
    const dx = slotPos[0] - centroid[0];
    const dz = slotPos[1] - centroid[1];
    const l = Math.hypot(dx, dz) || 1;
    return [dx / l, dz / l];
  }, [slotPos, centroid]);

  useFrame(() => {
    const r = clusterRevealRef.current;
    if (groupRef.current) {
      // Pins scale in from 0 as we dolly into the cluster.
      groupRef.current.scale.setScalar(0.001 + r * 0.999);
    }
    if (htmlRef.current) {
      // Label fades in with cluster reveal, then boosts on hover/select.
      const base = r * 0.9;
      const boost = isHovered || isSelected ? r * 0.1 : 0;
      htmlRef.current.style.opacity = String(base + boost);
    }
    if (leaderRef.current) {
      const m = leaderRef.current.material as THREE.MeshBasicMaterial;
      m.opacity = r * 0.55;
    }
  });

  const anchorY = 2.6 + (isSelected ? 0.6 : 0);
  const labelOffset = 2.6; // world-unit radial push
  const labelX = radial[0] * labelOffset;
  const labelZ = radial[1] * labelOffset;
  const leaderLen = Math.hypot(labelX, labelZ);
  // Three.js Y-rotation: local +X maps to world (cos α, 0, -sin α).
  // Solve for world direction (radial[0], 0, radial[1]) → α = -atan2(radial[1], radial[0]).
  const leaderYaw = -Math.atan2(radial[1], radial[0]);

  return (
    <group ref={groupRef}>
      {/* leader line: ring → label position (rotated to point radially) */}
      <mesh
        ref={leaderRef}
        position={[labelX / 2, anchorY + 0.4, labelZ / 2]}
        rotation={[0, leaderYaw, 0]}
      >
        <boxGeometry args={[leaderLen, 0.015, 0.015]} />
        <meshBasicMaterial
          color="#ffffff"
          transparent
          opacity={0}
          toneMapped={false}
        />
      </mesh>

      {/* vertical tether */}
      <mesh position={[0, anchorY / 2, 0]}>
        <boxGeometry args={[0.04, anchorY, 0.04]} />
        <meshBasicMaterial color="#ffffff" toneMapped={false} />
      </mesh>

      {/* ground ring */}
      <mesh
        position={[0, 0.02, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerOver={(e) => {
          e.stopPropagation();
          onHover();
        }}
        onPointerOut={() => onUnhover()}
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
      >
        <ringGeometry args={[0.35, 0.55, 32]} />
        <meshBasicMaterial
          color={isSelected || isHovered ? "#ffffff" : "#c4c8d0"}
          transparent
          opacity={isHovered || isSelected ? 1 : 0.55}
          toneMapped={false}
        />
      </mesh>

      {/* peak marker */}
      <mesh position={[0, anchorY, 0]}>
        <sphereGeometry args={[0.12, 16, 16]} />
        <meshBasicMaterial color="#ffffff" toneMapped={false} />
      </mesh>

      {/* brutalist html label offset radially outward */}
      <Html
        position={[labelX, anchorY + 0.6, labelZ]}
        center
        distanceFactor={12}
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        <div
          ref={htmlRef}
          className="text-white mix-blend-difference font-mono text-[10px] tracking-[0.3em] uppercase whitespace-nowrap leading-tight text-center"
        >
          <div className="font-semibold">{entry.name}</div>
          <div className="h-px bg-white/70 my-1" />
          <div className="opacity-70">{entry.country}</div>
        </div>
      </Html>
    </group>
  );
}

// ---------------------------------------------------------------- destination node

interface DestinationNodeProps {
  entry: DestinationIndexEntry;
  slotPos: [number, number];
  centroid: [number, number];
  showIsland: boolean; // destination mode
  isHovered: boolean;
  isSelected: boolean;
  clusterRevealRef: React.MutableRefObject<number>;
  onHover: () => void;
  onUnhover: () => void;
  onSelect: () => void;
  roughnessTex: THREE.Texture;
}

function DestinationNode({
  entry,
  slotPos,
  centroid,
  showIsland,
  isHovered,
  isSelected,
  clusterRevealRef,
  onHover,
  onUnhover,
  onSelect,
  roughnessTex,
}: DestinationNodeProps) {
  const revealRef = useRef(0);
  // Once the destination is selected, start loading the heightmap. Cache
  // loaded terrains across re-selection by keeping terrainRequested sticky.
  const [terrainRequested, setTerrainRequested] = useState(false);
  useEffect(() => {
    if (isSelected && !terrainRequested) setTerrainRequested(true);
  }, [isSelected, terrainRequested]);

  useFrame(() => {
    // Reveal island only when in destination mode on this slug.
    const target = showIsland && isSelected ? 1 : 0;
    revealRef.current = THREE.MathUtils.lerp(
      revealRef.current,
      target,
      REVEAL_LERP,
    );
  });

  const [x, z] = slotPos;

  return (
    <group position={[x, 0, z]}>
      <ClusterPin
        entry={entry}
        slotPos={slotPos}
        centroid={centroid}
        revealRef={revealRef}
        clusterRevealRef={clusterRevealRef}
        isHovered={isHovered}
        isSelected={isSelected}
        onHover={onHover}
        onUnhover={onUnhover}
        onSelect={onSelect}
      />
      {terrainRequested && (
        <LazyIsland
          slug={entry.slug}
          revealRef={revealRef}
          roughnessTex={roughnessTex}
        />
      )}
    </group>
  );
}

// ---------------------------------------------------------------- world anchors (cluster level)

function WorldAnchor({
  cluster,
  heat,
  onClick,
}: {
  cluster: ClusterDef;
  heat: number; // 0..1
  onClick: () => void;
}) {
  const [cLng, cLat] = cluster.center;
  const [cx, cz] = equirectToWorld(cLng, cLat);
  const ringMatRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const pulseMeshRef = useRef<THREE.Mesh | null>(null);
  const pulseMatRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const time = useRef(0);

  useFrame((_, dt) => {
    time.current += dt;
    const pulse = 0.5 + 0.5 * Math.sin(time.current * 1.4);
    if (ringMatRef.current) {
      ringMatRef.current.opacity = 0.55 + heat * 0.45;
    }
    if (pulseMeshRef.current && pulseMatRef.current) {
      const s = 1 + pulse * 0.5 + heat * 0.4;
      pulseMeshRef.current.scale.set(s, s, s);
      pulseMatRef.current.opacity = (0.15 + heat * 0.35) * (1 - pulse * 0.3);
    }
  });

  return (
    <group position={[cx, 0.05, cz]}>
      {/* hitbox + outer halo */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
      >
        <ringGeometry args={[1.3, 1.55, 48]} />
        <meshBasicMaterial
          ref={ringMatRef}
          color="#ffffff"
          transparent
          opacity={0.55}
          toneMapped={false}
        />
      </mesh>
      {/* inner dot */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.35, 32]} />
        <meshBasicMaterial color="#ffffff" toneMapped={false} />
      </mesh>
      {/* animated pulse ring */}
      <mesh ref={pulseMeshRef} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.4, 1.55, 48]} />
        <meshBasicMaterial
          ref={pulseMatRef}
          color="#ffffff"
          transparent
          opacity={0.25}
          toneMapped={false}
        />
      </mesh>
      {/* brutalist label + count */}
      <Html
        position={[0, 2.5, 0]}
        center
        distanceFactor={14}
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        <div className="text-white mix-blend-difference font-mono text-[10px] tracking-[0.3em] uppercase whitespace-nowrap leading-tight text-center">
          <div className="font-semibold">{cluster.name}</div>
          <div className="h-px bg-white/70 my-1" />
          <div className="opacity-70">
            {cluster.subtitle} · {cluster.slugs.length}
          </div>
        </div>
      </Html>
    </group>
  );
}

function WorldAnchors({
  hoveredCluster,
  onPick,
  onHover,
  onUnhover,
  worldRevealRef,
}: {
  hoveredCluster: ClusterId | null;
  onPick: (id: ClusterId) => void;
  onHover: (id: ClusterId) => void;
  onUnhover: (id: ClusterId) => void;
  worldRevealRef: React.MutableRefObject<number>;
}) {
  const groupRef = useRef<THREE.Group | null>(null);
  useFrame(() => {
    if (groupRef.current) {
      const r = worldRevealRef.current;
      groupRef.current.visible = r > 0.02;
      // slight scale-out as we leave the world view.
      const s = 0.4 + r * 0.6;
      groupRef.current.scale.setScalar(s);
    }
  });

  return (
    <group ref={groupRef}>
      {CLUSTERS.map((c) => (
        <group
          key={c.id}
          onPointerOver={(e) => {
            e.stopPropagation();
            onHover(c.id);
          }}
          onPointerOut={() => onUnhover(c.id)}
        >
          <WorldAnchor
            cluster={c}
            heat={hoveredCluster === c.id ? 1 : 0}
            onClick={() => onPick(c.id)}
          />
        </group>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------- constellation lines

function ConstellationLines({
  points,
  clusterRevealRef,
}: {
  points: [number, number][]; // world XZ
  clusterRevealRef: React.MutableRefObject<number>;
}) {
  const edges = useMemo(() => minimumSpanningTree(points), [points]);
  const linesData = useMemo(
    () =>
      edges.map(([a, b]) => {
        const p0 = new THREE.Vector3(points[a][0], 0.04, points[a][1]);
        const p1 = new THREE.Vector3(points[b][0], 0.04, points[b][1]);
        return [p0, p1] as [THREE.Vector3, THREE.Vector3];
      }),
    [edges, points],
  );

  const groupRef = useRef<THREE.Group | null>(null);
  useFrame(() => {
    if (!groupRef.current) return;
    const r = clusterRevealRef.current;
    groupRef.current.traverse((obj) => {
      const m = (obj as THREE.Mesh).material as
        | THREE.Material
        | THREE.Material[]
        | undefined;
      if (!m) return;
      const apply = (mat: THREE.Material) => {
        (mat as THREE.Material & { opacity?: number; transparent?: boolean }).opacity =
          r * 0.9;
        (mat as THREE.Material & { transparent?: boolean }).transparent = true;
      };
      if (Array.isArray(m)) m.forEach(apply);
      else apply(m);
    });
  });

  if (linesData.length === 0) return null;

  return (
    <group ref={groupRef}>
      {linesData.map((pts, i) => (
        <Line
          key={i}
          points={pts}
          color="#ffffff"
          lineWidth={0.9}
          transparent
          opacity={0}
          toneMapped={false}
        />
      ))}
    </group>
  );
}

// ---------------------------------------------------------------- dolly rig

type ViewMode = "world" | "cluster" | "destination";

interface DollyTarget {
  position: THREE.Vector3;
  lookAt: THREE.Vector3;
  fov: number;
  orbit: boolean;
  orbitCenter: THREE.Vector3;
  orbitRadius: number;
  orbitHeight: number;
}

function DollyRig({
  targetRef,
}: {
  targetRef: React.MutableRefObject<DollyTarget>;
}) {
  const { camera } = useThree();
  const cam = camera as THREE.PerspectiveCamera;
  const currentLook = useRef(new THREE.Vector3().copy(WORLD_CAM.lookAt));
  const orbitAngle = useRef(0);
  const desiredPos = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    cam.position.copy(WORLD_CAM.position);
    cam.fov = WORLD_CAM.fov;
    cam.updateProjectionMatrix();
    cam.lookAt(WORLD_CAM.lookAt);
  }, [cam]);

  useFrame((_, dt) => {
    const t = targetRef.current;
    if (t.orbit) {
      orbitAngle.current += dt * 0.18;
      const a = orbitAngle.current;
      desiredPos.set(
        t.orbitCenter.x + Math.cos(a) * t.orbitRadius,
        t.orbitCenter.y + t.orbitHeight,
        t.orbitCenter.z + Math.sin(a) * t.orbitRadius,
      );
    } else {
      desiredPos.copy(t.position);
    }

    // Frame-rate independent critically-damped smoothing.
    cam.position.x = THREE.MathUtils.damp(
      cam.position.x,
      desiredPos.x,
      CAM_DAMP_POS,
      dt,
    );
    cam.position.y = THREE.MathUtils.damp(
      cam.position.y,
      desiredPos.y,
      CAM_DAMP_POS,
      dt,
    );
    cam.position.z = THREE.MathUtils.damp(
      cam.position.z,
      desiredPos.z,
      CAM_DAMP_POS,
      dt,
    );
    currentLook.current.x = THREE.MathUtils.damp(
      currentLook.current.x,
      t.lookAt.x,
      CAM_DAMP_LOOK,
      dt,
    );
    currentLook.current.y = THREE.MathUtils.damp(
      currentLook.current.y,
      t.lookAt.y,
      CAM_DAMP_LOOK,
      dt,
    );
    currentLook.current.z = THREE.MathUtils.damp(
      currentLook.current.z,
      t.lookAt.z,
      CAM_DAMP_LOOK,
      dt,
    );
    const newFov = THREE.MathUtils.damp(cam.fov, t.fov, CAM_DAMP_FOV, dt);
    if (Math.abs(newFov - cam.fov) > 0.001) {
      cam.fov = newFov;
      cam.updateProjectionMatrix();
    }
    cam.lookAt(currentLook.current);
  });

  return null;
}

// ---------------------------------------------------------------- mode reveals

// Tiny helper component: writes the current mode-reveal (world/cluster) into
// a ref every frame for any consumers that need per-frame access (labels,
// lines, etc).
function ModeRevealSync({
  mode,
  worldRevealRef,
  clusterRevealRef,
}: {
  mode: ViewMode;
  worldRevealRef: React.MutableRefObject<number>;
  clusterRevealRef: React.MutableRefObject<number>;
}) {
  const worldTarget = mode === "world" ? 1 : 0;
  const clusterTarget = mode === "cluster" || mode === "destination" ? 1 : 0;
  useFrame((_, dt) => {
    worldRevealRef.current = THREE.MathUtils.damp(
      worldRevealRef.current,
      worldTarget,
      3.5,
      dt,
    );
    clusterRevealRef.current = THREE.MathUtils.damp(
      clusterRevealRef.current,
      clusterTarget,
      3.5,
      dt,
    );
  });
  return null;
}

// ---------------------------------------------------------------- root

export default function V11UnifiedMap() {
  const index = useDestinationIndex();

  // Three-level state machine.
  const [mode, setMode] = useState<ViewMode>("world");
  const [activeCluster, setActiveCluster] = useState<ClusterId | null>(null);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [hoveredSlug, setHoveredSlug] = useState<string | null>(null);
  const [hoveredCluster, setHoveredCluster] = useState<ClusterId | null>(null);

  const roughnessTex = useMemo(() => makeRoughness(256), []);
  useEffect(() => () => roughnessTex.dispose(), [roughnessTex]);

  // World hotspots correspond to cluster centroids (not per-destination).
  const hotspotsRef = useRef<{ position: THREE.Vector2; heat: number }[]>(
    CLUSTERS.map((c) => {
      const [cx, cz] = equirectToWorld(c.center[0], c.center[1]);
      return { position: new THREE.Vector2(cx, cz), heat: 0 };
    }),
  );

  // Sync hotspot heat with current state every frame via a small component.
  useEffect(() => {
    hotspotsRef.current = CLUSTERS.map((c) => {
      const [cx, cz] = equirectToWorld(c.center[0], c.center[1]);
      // Active-cluster heat is intentionally moderate — at cluster zoom the
      // hotspot sits directly under the camera and would otherwise flood
      // the viewport with bloom. Cold hotspots stay faint on world view.
      return {
        position: new THREE.Vector2(cx, cz),
        heat:
          activeCluster === c.id
            ? 0.25
            : hoveredCluster === c.id
              ? 0.55
              : 0.12,
      };
    });
  }, [activeCluster, hoveredCluster]);

  // Mode-reveal refs (animated by ModeRevealSync inside the Canvas).
  const worldRevealRef = useRef(1);
  const clusterRevealRef = useRef(0);

  // DollyTarget, mutated on transitions, read by DollyRig.
  const camTargetRef = useRef<DollyTarget>({
    position: WORLD_CAM.position.clone(),
    lookAt: WORLD_CAM.lookAt.clone(),
    fov: WORLD_CAM.fov,
    orbit: false,
    orbitCenter: new THREE.Vector3(),
    orbitRadius: ORBIT_RADIUS,
    orbitHeight: ORBIT_HEIGHT,
  });

  // Cluster pin slots — lazily computed per active cluster.
  const activeSlots = useMemo<Record<string, [number, number]>>(() => {
    if (!activeCluster) return {};
    const cluster = getCluster(activeCluster);
    return cluster ? computeClusterPinSlots(cluster) : {};
  }, [activeCluster]);

  const activeClusterDef = useMemo(
    () => (activeCluster ? getCluster(activeCluster) : null),
    [activeCluster],
  );
  const activeCentroid = useMemo<[number, number]>(() => {
    if (!activeClusterDef) return [0, 0];
    return equirectToWorld(
      activeClusterDef.center[0],
      activeClusterDef.center[1],
    );
  }, [activeClusterDef]);

  const activeSlotPoints = useMemo<[number, number][]>(
    () =>
      activeClusterDef
        ? activeClusterDef.slugs
            .map((s) => activeSlots[s])
            .filter((p): p is [number, number] => Array.isArray(p))
        : [],
    [activeClusterDef, activeSlots],
  );

  // ---- transitions

  const goWorld = useCallback(() => {
    setMode("world");
    setActiveCluster(null);
    setSelectedSlug(null);
    setHoveredSlug(null);
    camTargetRef.current = {
      position: WORLD_CAM.position.clone(),
      lookAt: WORLD_CAM.lookAt.clone(),
      fov: WORLD_CAM.fov,
      orbit: false,
      orbitCenter: new THREE.Vector3(),
      orbitRadius: ORBIT_RADIUS,
      orbitHeight: ORBIT_HEIGHT,
    };
  }, []);

  const goCluster = useCallback((id: ClusterId) => {
    const cluster = getCluster(id);
    if (!cluster) return;
    const [cx, cz] = equirectToWorld(cluster.center[0], cluster.center[1]);
    // Dolly compression: FOV narrows (42 → 28) while the camera drops so
    // the whole fan fits the frame. Apparent subject size holds roughly
    // constant — the classic Vertigo effect.
    //
    // Pull-back distance is proportional to the fan radius: at our 28° FOV
    // the camera needs to sit ~3x the fan radius back so the outermost
    // pin + label stays comfortably inside the viewport.
    const fan = clusterFanRadius(cluster);
    const pull = Math.max(18, fan * 3.2);
    setMode("cluster");
    setActiveCluster(id);
    setSelectedSlug(null);
    setHoveredSlug(null);
    camTargetRef.current = {
      position: new THREE.Vector3(cx, pull * 0.9, cz + pull),
      lookAt: new THREE.Vector3(cx, 1.0, cz),
      fov: 28,
      orbit: false,
      orbitCenter: new THREE.Vector3(cx, 0, cz),
      orbitRadius: ORBIT_RADIUS,
      orbitHeight: ORBIT_HEIGHT,
    };
  }, []);

  const goDestination = useCallback(
    (slug: string) => {
      const cluster = clusterForSlug(slug);
      if (!cluster) return;
      // Ensure we're locked onto that cluster (supports direct picker jumps).
      if (activeCluster !== cluster.id) setActiveCluster(cluster.id);
      setMode("destination");
      setSelectedSlug(slug);
      setHoveredSlug(null);

      const slots = computeClusterPinSlots(cluster);
      const slot = slots[slug];
      if (!slot) return;
      const [x, z] = slot;
      camTargetRef.current = {
        position: new THREE.Vector3(x + ORBIT_RADIUS, ORBIT_HEIGHT, z + ORBIT_RADIUS),
        lookAt: new THREE.Vector3(x, 1.5, z),
        fov: DESTINATION_FOV,
        orbit: true,
        orbitCenter: new THREE.Vector3(x, 1.5, z),
        orbitRadius: ORBIT_RADIUS,
        orbitHeight: ORBIT_HEIGHT,
      };
    },
    [activeCluster],
  );

  // Back-button target depends on current mode.
  const handleBack = useCallback(() => {
    if (mode === "destination" && activeCluster) {
      goCluster(activeCluster);
    } else if (mode === "cluster") {
      goWorld();
    }
  }, [mode, activeCluster, goCluster, goWorld]);

  // Escape key as a convenience.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleBack]);

  // Picker → selecting a destination always jumps to destination mode. We
  // also automatically set the activeCluster from its slug.
  const handlePickerSelect = useCallback(
    (slug: string) => {
      goDestination(slug);
    },
    [goDestination],
  );

  const selectedEntry = selectedSlug
    ? index.find((d) => d.slug === selectedSlug) ?? null
    : null;

  // Labels/content for the overlay title.
  const headlineTop =
    mode === "destination" && selectedEntry
      ? selectedEntry.name
      : mode === "cluster" && activeClusterDef
        ? activeClusterDef.name
        : "One Canvas.";
  const headlineBottom =
    mode === "destination" && selectedEntry
      ? selectedEntry.country
      : mode === "cluster" && activeClusterDef
        ? `${activeClusterDef.subtitle} · ${activeClusterDef.slugs.length}`
        : `${index.length} Chromes.`;

  const blurb =
    mode === "destination"
      ? "GPU lerp blends the ink-wash world into full Mapbox Terrain-RGB as the camera orbits a low-angle pass."
      : mode === "cluster"
        ? "Dolly into the constellation. Thin white edges trace the minimum spanning tree of the region; pick a vertex to drop into its liquid-chrome massif."
        : "Six nebulae across the hemispheres. Click one to dolly in, fan out its destinations, and fly deeper when ready.";

  return (
    <ExplorationShell
      index={11}
      title="Constellation"
      subtitle={
        mode === "destination" && selectedEntry
          ? selectedEntry.name
          : mode === "cluster" && activeClusterDef
            ? activeClusterDef.name
            : `${index.length} destinations`
      }
      chipColor="#000000"
      chipText="#ffffff"
      backBg="rgba(10,10,10,0.85)"
    >
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 50% 30%, #0b0c10 0%, #050506 60%, #000 100%)",
        }}
      >
        <Canvas
          camera={{
            position: [WORLD_CAM.position.x, WORLD_CAM.position.y, WORLD_CAM.position.z],
            fov: WORLD_CAM.fov,
            near: 0.1,
            far: 400,
          }}
          dpr={[1, 2]}
          gl={{ antialias: true, alpha: false }}
          onCreated={({ gl, scene }) => {
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.toneMappingExposure = 0.85;
            gl.outputColorSpace = THREE.SRGBColorSpace;
            scene.background = new THREE.Color("#030305");
          }}
        >
          <fog attach="fog" args={["#030305", 40, 180]} />
          <ambientLight intensity={0.05} />
          <directionalLight position={[20, 40, 20]} intensity={0.2} />

          {/* Environment map only matters once an island is revealed */}
          {/* (destination mode). Gating the preset on mode removes the */}
          {/* skydome bleed that was washing out cluster view. */}
          {mode === "destination" && (
            <Suspense fallback={null}>
              <Environment
                preset="night"
                background={false}
                environmentIntensity={0.35}
              />
            </Suspense>
          )}

          <WorldBase hotspotsRef={hotspotsRef} />

          <ModeRevealSync
            mode={mode}
            worldRevealRef={worldRevealRef}
            clusterRevealRef={clusterRevealRef}
          />

          {/* World-level cluster anchors (only during world mode) */}
          {mode === "world" && (
            <WorldAnchors
              hoveredCluster={hoveredCluster}
              onPick={(id) => goCluster(id)}
              onHover={(id) => setHoveredCluster(id)}
              onUnhover={(id) =>
                setHoveredCluster((h) => (h === id ? null : h))
              }
              worldRevealRef={worldRevealRef}
            />
          )}

          {/* Active cluster: fanned pins + constellation lines + islands */}
          {activeClusterDef &&
            (mode === "cluster" || mode === "destination") && (
              <>
                <ConstellationLines
                  points={activeSlotPoints}
                  clusterRevealRef={clusterRevealRef}
                />
                {activeClusterDef.slugs.map((slug) => {
                  const entry = index.find((d) => d.slug === slug);
                  const slot = activeSlots[slug];
                  if (!entry || !slot) return null;
                  return (
                    <DestinationNode
                      key={slug}
                      entry={entry}
                      slotPos={slot}
                      centroid={activeCentroid}
                      showIsland={mode === "destination"}
                      isHovered={hoveredSlug === slug}
                      isSelected={selectedSlug === slug}
                      clusterRevealRef={clusterRevealRef}
                      onHover={() => setHoveredSlug(slug)}
                      onUnhover={() =>
                        setHoveredSlug((s) => (s === slug ? null : s))
                      }
                      onSelect={() => goDestination(slug)}
                      roughnessTex={roughnessTex}
                    />
                  );
                })}
              </>
            )}

          <DollyRig targetRef={camTargetRef} />

          {mode === "destination" && (
            <EffectComposer multisampling={0}>
              <Bloom
                luminanceThreshold={0.9}
                luminanceSmoothing={0.2}
                mipmapBlur
                intensity={0.4}
              />
              <Noise
                premultiply
                blendFunction={BlendFunction.ADD}
                opacity={0.05}
              />
              <Vignette darkness={0.75} offset={0.2} />
            </EffectComposer>
          )}
          {mode !== "destination" && (
            <EffectComposer multisampling={0}>
              <Vignette darkness={0.6} offset={0.25} />
            </EffectComposer>
          )}
        </Canvas>

        {/* top-left title block */}
        <div className="absolute top-16 left-8 z-[5] pointer-events-none max-w-[560px]">
          <div className="font-mono text-[10px] tracking-[0.4em] uppercase text-white/50">
            11 / 11 — Constellation Navigation
          </div>
          <h2 className="font-serif text-5xl md:text-6xl text-white mt-3 leading-[0.85] tracking-tight uppercase">
            {headlineTop}
            <br />
            <span className="text-white/70">{headlineBottom}</span>
          </h2>
          <div className="mt-6 max-w-md text-white/60 text-sm leading-relaxed">
            {blurb}
          </div>

          {mode !== "world" && (
            <button
              type="button"
              onClick={handleBack}
              className="mt-5 pointer-events-auto font-mono text-[10px] tracking-[0.3em] uppercase text-white/60 hover:text-white border border-white/25 hover:border-white px-3 py-1.5 transition-colors"
            >
              {mode === "destination"
                ? `← ${activeClusterDef ? activeClusterDef.name : "Cluster"}`
                : "← World"}
            </button>
          )}
        </div>

        {/* bottom-right telemetry */}
        <div className="absolute bottom-10 right-8 z-[5] font-mono text-[10px] tracking-[0.3em] uppercase text-white/40 text-right">
          {mode === "world" && (
            <>
              global-dem · ink-wash
              <br />
              {CLUSTERS.length} clusters · esc-back
            </>
          )}
          {mode === "cluster" && (
            <>
              dolly-zoom · mst-edges
              <br />
              {activeClusterDef?.slugs.length ?? 0} destinations
            </>
          )}
          {mode === "destination" && (
            <>
              orbit · terrain-rgb
              <br />
              gpu-lerp reveal
            </>
          )}
        </div>

        {/* picker — available in all modes; jumps straight to destination */}
        <DestinationPicker
          index={index}
          currentSlug={selectedSlug}
          onPick={(slug) => handlePickerSelect(slug)}
          label="Destination"
          placeholder="World view · select to fly"
          anchor="bottom-left"
        />
      </div>
    </ExplorationShell>
  );
}
