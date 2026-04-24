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

// Free-exploration altitude envelope. Lower = closer to individual pins,
// higher = full world overview. Drag pans the centre; wheel changes height.
const HEIGHT_MIN = 14;   // zoomed into a cluster fan
const HEIGHT_MAX = 82;   // full global ink-wash view
const HEIGHT_DEFAULT = 68;

// At any given height, camera is centred over (cx, cz) but pushed slightly
// south so the world is tilted ~20° off vertical (reads as "map-like" but
// still has depth). tilt = height * TILT_RATIO.
const TILT_RATIO = 0.42;

// Horizontal pan bounds keep the user on-planet. The plane is 200×100 and
// we want to be able to park the camera over any edge without flying off.
const PAN_X_LIMIT = 108;
const PAN_Z_LIMIT = 58;

// World-FOV envelope. Narrows as we zoom in for the Hitchcock dolly feel.
const FOV_AT_MAX_HEIGHT = 42;
const FOV_AT_MIN_HEIGHT = 32;

// Level 3: low-angle chrome orbit (unchanged from V10).
const ORBIT_HEIGHT = 5.5;
const ORBIT_RADIUS = 9;
const DESTINATION_FOV = 28;

// Dolly tuning — lower numbers = slower, more cinematic.
// Free-mode damp is faster so drag feels responsive; locked-mode damp is
// slower so programmatic transitions still feel cinematic.
const CAM_DAMP_POS_FREE = 8.0;
const CAM_DAMP_POS_LOCKED = 3.0;
const CAM_DAMP_LOOK = 6.0;
const CAM_DAMP_FOV = 3.0;

// Drag → world-unit scaling. At max height, a 1px drag moves the view by
// this many world-units; at min height the factor is roughly a quarter.
const DRAG_UNITS_PER_PX_AT_MAX = 0.18;
const DRAG_UNITS_PER_PX_AT_MIN = 0.035;

// Wheel sensitivity (height delta per pixel of scroll).
const WHEEL_UNITS_PER_DELTA = 0.08;

// Friction: how quickly drag momentum decays (per second).
const VELOCITY_DAMP = 4.5;

// Auto-active cluster thresholds.
// When the camera centre is within this world-unit distance of a cluster
// centroid AND zoom level >= threshold, that cluster becomes active.
const CLUSTER_SNAP_RADIUS = 24;
const CLUSTER_ZOOM_THRESHOLD = 0.35;

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

  uniform sampler2D uCoastMask;
  uniform float uHasCoast;      // 1.0 if coast mask loaded

  // Camera-proximity reveal: fades ink-wash intensity up as the viewer
  // approaches a cluster centroid so the world feels like it "grows" out
  // of the paper into dense topography when you pan closer.
  uniform float uProximity;     // 0..1 global nearness factor

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

  // World-XZ → equirectangular UV.
  vec2 worldToUv(vec2 worldXZ) {
    return vec2(
      0.5 + worldXZ.x / uWorldW,
      0.5 + worldXZ.y / uWorldH
    );
  }

  // Sample decoded Mapbox Terrain-RGB at world coordinate. Returns height in
  // [0, 1] normalised by uMaxElevation. Clamped to 0 below sea level so
  // ocean doesn't create negative ridges.
  float sampleGlobalDem(vec2 worldXZ) {
    vec2 uv = worldToUv(worldXZ);
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
    vec3 c = texture2D(uHeightMap, uv).rgb;
    float m = -10000.0 + (c.r * 65536.0 + c.g * 256.0 + c.b) * 255.0 * 0.1;
    return clamp(m / uMaxElevation, 0.0, 1.0);
  }

  // Natural Earth land/ocean mask (0 ocean .. 1 land, feathered).
  float sampleLand(vec2 worldXZ) {
    if (uHasCoast < 0.5) return 1.0;
    vec2 uv = worldToUv(worldXZ);
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
    return texture2D(uCoastMask, uv).r;
  }

  void main() {
    // Ocean is deep void-black; we lerp up to ink-wash only inside the
    // land mask so coastlines form a clean graphic boundary.
    vec3 voidCol = vec3(0.004, 0.006, 0.010);
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

    // NASA-style ink density: amplify low-altitude terrain so even rolling
    // highlands register as a wash, while peaks go brilliant white.
    float dem = pow(topo, 0.78);
    float ridge = smoothstep(0.15, 0.85, dem);
    col = mix(col, uInk, ridge * 0.55);

    // Crisp contour band — ink-bleed effect on big mountains.
    float band = 1.0 - smoothstep(0.0, 0.04, abs(fract(dem * 10.0) - 0.5));
    col = mix(col, uInk * 1.35, band * 0.28 * ridge);

    // Edge ink strokes along steep gradients (Himalayas, Andes, Alps).
    float edge = smoothstep(0.015, 0.07, grad);
    col = mix(col, uHotInk, edge * 0.42);

    // Fine rice-paper grain only on land.
    col += vnoise(vWorldXZ * 7.0) * 0.035;

    // ---- cluster hotspots (blooms only at the anchor points)
    for (int i = 0; i < 12; i++) {
      if (i >= uHotspotCount) break;
      vec2 h = uHotspots[i];
      float heat = uHotspotHeat[i];
      float d = length(vWorldXZ - h);
      float falloff = exp(-d * d * 0.012);
      float pulse = 0.5 + 0.5 * sin(uTime * 1.1 + float(i) * 1.7);
      float coldBleed = falloff * 0.10 * (0.5 + 0.5 * pulse);
      float hotBleed  = falloff * 0.45 * heat;
      col = mix(col, uHotInk, clamp(coldBleed + hotBleed, 0.0, 0.7));
    }

    // ---- coastline gate: land reveals the ink-wash, ocean stays void.
    float land = sampleLand(vWorldXZ);
    // Slight coast-glow just inland of the border for graphic punch.
    float coastEdge = land * (1.0 - land) * 4.0;
    col = mix(col, uHotInk * 0.6, coastEdge * 0.25);
    // Gate the whole land layer against the mask.
    col = mix(voidCol, col, land);

    // Proximity glow: where the camera is near, lift the ink contrast a
    // touch so it feels like topography "grows" under the viewer.
    col = mix(col, col * 1.18 + uInk * 0.05, uProximity * land);

    // Soft radial vignette anchored at world origin so the edges of the
    // plane fall off consistently regardless of camera zoom.
    vec2 uv = (vUv - 0.5) * 2.0;
    float r = length(uv);
    col *= mix(1.0, 0.5, smoothstep(0.8, 1.6, r));

    // Global exposure clamp so cluster-zoom doesn't blow out the bloom pass.
    col *= 0.82;

    gl_FragColor = vec4(col, 1.0);
  }
`;

interface WorldBaseProps {
  hotspotsRef: React.MutableRefObject<
    { position: THREE.Vector2; heat: number }[]
  >;
  proximityRef: React.MutableRefObject<number>;
}

function useAsyncTexture(url: string): THREE.Texture | null {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    let cancelled = false;
    const loader = new THREE.TextureLoader();
    loader.load(
      url,
      (t) => {
        if (cancelled) {
          t.dispose();
          return;
        }
        t.wrapS = THREE.ClampToEdgeWrapping;
        t.wrapT = THREE.ClampToEdgeWrapping;
        t.minFilter = THREE.LinearFilter;
        t.magFilter = THREE.LinearFilter;
        t.generateMipmaps = false;
        t.colorSpace = THREE.NoColorSpace;
        t.needsUpdate = true;
        setTex(t);
      },
      undefined,
      () => {
        // 404 or network — silently fall back to procedural noise.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [url]);
  useEffect(() => {
    return () => {
      tex?.dispose();
    };
  }, [tex]);
  return tex;
}

function WorldBase({ hotspotsRef, proximityRef }: WorldBaseProps) {
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);
  const demTex = useAsyncTexture("/destinations/_global/terrain.png");
  const coastTex = useAsyncTexture("/destinations/_global/coast.png");

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uHotspotCount: { value: 0 },
      uHotspots: {
        value: Array.from({ length: 12 }, () => new THREE.Vector2(0, 0)),
      },
      uHotspotHeat: { value: new Float32Array(12) },
      uPaper: { value: new THREE.Color("#05060a") },
      uInk: { value: new THREE.Color("#d4d8e0") },
      uHotInk: { value: new THREE.Color("#ffffff") },
      uWorldW: { value: WORLD_W },
      uWorldH: { value: WORLD_H },
      uHeightMap: { value: null as THREE.Texture | null },
      uHasDem: { value: 0 },
      uMaxElevation: { value: 8000 },
      uCoastMask: { value: null as THREE.Texture | null },
      uHasCoast: { value: 0 },
      uProximity: { value: 0 },
    }),
    [],
  );

  useEffect(() => {
    uniforms.uHeightMap.value = demTex;
    uniforms.uHasDem.value = demTex ? 1 : 0;
    if (materialRef.current) materialRef.current.uniformsNeedUpdate = true;
  }, [demTex, uniforms]);

  useEffect(() => {
    uniforms.uCoastMask.value = coastTex;
    uniforms.uHasCoast.value = coastTex ? 1 : 0;
    if (materialRef.current) materialRef.current.uniformsNeedUpdate = true;
  }, [coastTex, uniforms]);

  useFrame((_, dt) => {
    const u = uniforms;
    u.uTime.value += dt;
    u.uProximity.value = proximityRef.current;
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

// Simple 2D spring used to expand labels from the centroid to their radial
// target. One spring per pin keeps the layout organic without a costly
// collision solver.
interface Spring2D {
  x: number;
  z: number;
  vx: number;
  vz: number;
}
const LABEL_STIFFNESS = 18;
const LABEL_DAMP = 6;

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
  const labelGroupRef = useRef<THREE.Group | null>(null);
  const hairlineRef = useRef<THREE.Mesh | null>(null);
  const springRef = useRef<Spring2D>({ x: 0, z: 0, vx: 0, vz: 0 });

  // Radial outward unit vector (from centroid to slot) — used to offset
  // the HTML label so it never overlaps neighbours.
  const radial = useMemo<[number, number]>(() => {
    const dx = slotPos[0] - centroid[0];
    const dz = slotPos[1] - centroid[1];
    const l = Math.hypot(dx, dz) || 1;
    return [dx / l, dz / l];
  }, [slotPos, centroid]);

  // Radial "rest" position for the label, in world units from the pin.
  const labelRest = useMemo<[number, number]>(() => {
    const offset = 2.6;
    return [radial[0] * offset, radial[1] * offset];
  }, [radial]);

  const anchorY = 2.6 + (isSelected ? 0.6 : 0);
  // Hairline tether runs vertically from label base down to peak marker.
  const hairlineHeight = 1.0;

  useFrame((_, dt) => {
    const r = clusterRevealRef.current;
    if (groupRef.current) {
      groupRef.current.scale.setScalar(0.001 + r * 0.999);
    }
    if (htmlRef.current) {
      const base = r * 0.9;
      const boost = isHovered || isSelected ? r * 0.1 : 0;
      htmlRef.current.style.opacity = String(base + boost);
    }

    // --- label spring
    // Target is 0 (collapsed on centroid) when cluster is hidden and
    // labelRest (radial) when revealed. Integrate with simple
    // spring-damper dynamics so the labels "pop out" organically.
    const targetX = r * labelRest[0];
    const targetZ = r * labelRest[1];
    const s = springRef.current;
    const dx = targetX - s.x;
    const dz = targetZ - s.z;
    const ax = dx * LABEL_STIFFNESS - s.vx * LABEL_DAMP;
    const az = dz * LABEL_STIFFNESS - s.vz * LABEL_DAMP;
    const stepDt = Math.min(dt, 1 / 30);
    s.vx += ax * stepDt;
    s.vz += az * stepDt;
    s.x += s.vx * stepDt;
    s.z += s.vz * stepDt;

    if (labelGroupRef.current) {
      labelGroupRef.current.position.x = s.x;
      labelGroupRef.current.position.z = s.z;
    }

    if (leaderRef.current) {
      const m = leaderRef.current.material as THREE.MeshBasicMaterial;
      m.opacity = r * 0.45;
      // Update leader line to match the current spring-relaxed label pos.
      const len = Math.hypot(s.x, s.z);
      const yaw = -Math.atan2(s.z, s.x);
      leaderRef.current.position.set(s.x / 2, anchorY + 0.4, s.z / 2);
      leaderRef.current.rotation.y = yaw;
      leaderRef.current.scale.x = Math.max(0.0001, len / 2.6); // normalise against unit length
    }
    if (hairlineRef.current) {
      const m = hairlineRef.current.material as THREE.MeshBasicMaterial;
      m.opacity = r * 0.65;
    }
  });

  return (
    <group ref={groupRef}>
      {/* Radial leader line: pin peak → label base (spring-animated). */}
      {/* Base geometry is a unit-length x-oriented rod; we scale X to the */}
      {/* current label distance each frame. 0.5px-thin for brutalist look. */}
      <mesh
        ref={leaderRef}
        position={[labelRest[0] / 2, anchorY + 0.4, labelRest[1] / 2]}
        rotation={[0, -Math.atan2(labelRest[1], labelRest[0]), 0]}
      >
        <boxGeometry args={[2.6, 0.01, 0.01]} />
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

      {/* Label + its own vertical hairline, translated each frame by the spring. */}
      <group ref={labelGroupRef}>
        {/* Vertical hairline lead: thin white line from ground up to the */}
        {/* label, so floating HTML text feels anchored to a precise 3D */}
        {/* coordinate rather than floating in space. */}
        <mesh
          ref={hairlineRef}
          position={[0, anchorY + 0.4 + hairlineHeight / 2, 0]}
        >
          <boxGeometry args={[0.008, hairlineHeight, 0.008]} />
          <meshBasicMaterial
            color="#ffffff"
            transparent
            opacity={0}
            toneMapped={false}
          />
        </mesh>

        <Html
          position={[0, anchorY + 0.4 + hairlineHeight + 0.3, 0]}
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
  revealRef,
}: {
  cluster: ClusterDef;
  heat: number; // 0..1
  onClick: () => void;
  revealRef: React.MutableRefObject<number>;
}) {
  const [cLng, cLat] = cluster.center;
  const [cx, cz] = equirectToWorld(cLng, cLat);
  const ringMatRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const dotMatRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const pulseMeshRef = useRef<THREE.Mesh | null>(null);
  const pulseMatRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const htmlRef = useRef<HTMLDivElement | null>(null);
  const time = useRef(0);

  useFrame((_, dt) => {
    time.current += dt;
    const pulse = 0.5 + 0.5 * Math.sin(time.current * 1.4);
    const r = revealRef.current;
    if (ringMatRef.current) {
      ringMatRef.current.opacity = (0.55 + heat * 0.45) * r;
    }
    if (dotMatRef.current) {
      dotMatRef.current.opacity = r;
    }
    if (pulseMeshRef.current && pulseMatRef.current) {
      const s = 1 + pulse * 0.5 + heat * 0.4;
      pulseMeshRef.current.scale.set(s, s, s);
      pulseMatRef.current.opacity =
        (0.15 + heat * 0.35) * (1 - pulse * 0.3) * r;
    }
    if (htmlRef.current) {
      htmlRef.current.style.opacity = String(r);
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
        <meshBasicMaterial
          ref={dotMatRef}
          color="#ffffff"
          transparent
          opacity={1}
          toneMapped={false}
        />
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
        <div
          ref={htmlRef}
          className="text-white mix-blend-difference font-mono text-[10px] tracking-[0.3em] uppercase whitespace-nowrap leading-tight text-center"
        >
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
    if (!groupRef.current) return;
    const r = worldRevealRef.current;
    groupRef.current.visible = r > 0.01;
    // subtle scale-out as we leave the world view; individual
    // materials handle their own opacity fade.
    const s = 0.55 + r * 0.5;
    groupRef.current.scale.setScalar(s);
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
            revealRef={worldRevealRef}
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

// ---------------------------------------------------------------- free-view camera

type ViewMode = "world" | "cluster" | "destination";

// Shared, mutable free-exploration state. The user's drag/wheel input
// writes into this ref; DollyRig reads from it and integrates friction
// every frame. Also used by the shader proximity uniform and picker's
// "nearest cluster" readout so the whole UI flows from one source of
// truth.
interface FreeView {
  centerX: number;
  centerZ: number;
  height: number;
  // Momentum (world units / second). Decays at VELOCITY_DAMP/sec.
  velX: number;
  velZ: number;
  // Soft target from programmatic fly-to (click on anchor). When non-null,
  // the rig eases centre/height toward these and clears them once close.
  targetX: number | null;
  targetZ: number | null;
  targetH: number | null;
}

function createFreeView(): FreeView {
  return {
    centerX: 0,
    centerZ: 4,
    height: HEIGHT_DEFAULT,
    velX: 0,
    velZ: 0,
    targetX: null,
    targetZ: null,
    targetH: null,
  };
}

interface LockedTarget {
  active: boolean;
  orbitCenter: THREE.Vector3;
  orbitRadius: number;
  orbitHeight: number;
  fov: number;
}

function heightToZoom01(h: number): number {
  return THREE.MathUtils.clamp(
    (HEIGHT_MAX - h) / (HEIGHT_MAX - HEIGHT_MIN),
    0,
    1,
  );
}

function zoomToDragScale(h: number): number {
  const t = heightToZoom01(h);
  return THREE.MathUtils.lerp(
    DRAG_UNITS_PER_PX_AT_MAX,
    DRAG_UNITS_PER_PX_AT_MIN,
    t,
  );
}

function DollyRig({
  freeViewRef,
  lockedRef,
}: {
  freeViewRef: React.MutableRefObject<FreeView>;
  lockedRef: React.MutableRefObject<LockedTarget>;
}) {
  const { camera } = useThree();
  const cam = camera as THREE.PerspectiveCamera;
  const currentLook = useRef(new THREE.Vector3(0, 0, 4));
  const orbitAngle = useRef(0);
  const desiredPos = useMemo(() => new THREE.Vector3(), []);
  const desiredLook = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    const v = freeViewRef.current;
    cam.position.set(v.centerX, v.height, v.centerZ + v.height * TILT_RATIO);
    cam.fov = FOV_AT_MAX_HEIGHT;
    cam.updateProjectionMatrix();
    cam.lookAt(v.centerX, 0, v.centerZ);
  }, [cam, freeViewRef]);

  useFrame((_, dt) => {
    const locked = lockedRef.current;
    const view = freeViewRef.current;

    // Integrate friction on the free-view regardless of mode so momentum
    // doesn't freeze when we briefly lock for a click.
    if (!locked.active) {
      view.centerX += view.velX * dt;
      view.centerZ += view.velZ * dt;
      const damp = Math.exp(-VELOCITY_DAMP * dt);
      view.velX *= damp;
      view.velZ *= damp;

      // Ease toward soft fly-to target when present.
      if (view.targetX != null && view.targetZ != null) {
        view.centerX = THREE.MathUtils.damp(
          view.centerX,
          view.targetX,
          4.5,
          dt,
        );
        view.centerZ = THREE.MathUtils.damp(
          view.centerZ,
          view.targetZ,
          4.5,
          dt,
        );
        const dxT = view.centerX - view.targetX;
        const dzT = view.centerZ - view.targetZ;
        if (Math.hypot(dxT, dzT) < 0.3) {
          view.targetX = null;
          view.targetZ = null;
        }
      }
      if (view.targetH != null) {
        view.height = THREE.MathUtils.damp(view.height, view.targetH, 4.5, dt);
        if (Math.abs(view.height - view.targetH) < 0.3) view.targetH = null;
      }

      // Clamp pan + height so the user can't fly off the map.
      view.centerX = THREE.MathUtils.clamp(
        view.centerX,
        -PAN_X_LIMIT,
        PAN_X_LIMIT,
      );
      view.centerZ = THREE.MathUtils.clamp(
        view.centerZ,
        -PAN_Z_LIMIT,
        PAN_Z_LIMIT,
      );
      view.height = THREE.MathUtils.clamp(
        view.height,
        HEIGHT_MIN,
        HEIGHT_MAX,
      );
    }

    if (locked.active) {
      orbitAngle.current += dt * 0.18;
      const a = orbitAngle.current;
      desiredPos.set(
        locked.orbitCenter.x + Math.cos(a) * locked.orbitRadius,
        locked.orbitCenter.y + locked.orbitHeight,
        locked.orbitCenter.z + Math.sin(a) * locked.orbitRadius,
      );
      desiredLook.copy(locked.orbitCenter);
    } else {
      const tilt = view.height * TILT_RATIO;
      desiredPos.set(view.centerX, view.height, view.centerZ + tilt);
      desiredLook.set(view.centerX, 0, view.centerZ);
    }

    const dampPos = locked.active ? CAM_DAMP_POS_LOCKED : CAM_DAMP_POS_FREE;
    cam.position.x = THREE.MathUtils.damp(
      cam.position.x,
      desiredPos.x,
      dampPos,
      dt,
    );
    cam.position.y = THREE.MathUtils.damp(
      cam.position.y,
      desiredPos.y,
      dampPos,
      dt,
    );
    cam.position.z = THREE.MathUtils.damp(
      cam.position.z,
      desiredPos.z,
      dampPos,
      dt,
    );
    currentLook.current.x = THREE.MathUtils.damp(
      currentLook.current.x,
      desiredLook.x,
      CAM_DAMP_LOOK,
      dt,
    );
    currentLook.current.y = THREE.MathUtils.damp(
      currentLook.current.y,
      desiredLook.y,
      CAM_DAMP_LOOK,
      dt,
    );
    currentLook.current.z = THREE.MathUtils.damp(
      currentLook.current.z,
      desiredLook.z,
      CAM_DAMP_LOOK,
      dt,
    );

    const zoom = heightToZoom01(view.height);
    const freeFov = THREE.MathUtils.lerp(
      FOV_AT_MAX_HEIGHT,
      FOV_AT_MIN_HEIGHT,
      zoom,
    );
    const targetFov = locked.active ? locked.fov : freeFov;
    const newFov = THREE.MathUtils.damp(cam.fov, targetFov, CAM_DAMP_FOV, dt);
    if (Math.abs(newFov - cam.fov) > 0.001) {
      cam.fov = newFov;
      cam.updateProjectionMatrix();
    }
    cam.lookAt(currentLook.current);
  });

  return null;
}

// ---------------------------------------------------------------- semantic zoom sync

// Continuously derives `worldReveal` / `clusterReveal` / `proximity` from
// the free camera height + distance to the nearest cluster. Writes them
// into refs so shaders, labels, lines, and the UI picker can all read
// them per-frame without triggering React re-renders.
function SemanticZoomSync({
  freeViewRef,
  worldRevealRef,
  clusterRevealRef,
  proximityRef,
  nearestClusterRef,
  onActiveCluster,
  lockedRef,
}: {
  freeViewRef: React.MutableRefObject<FreeView>;
  worldRevealRef: React.MutableRefObject<number>;
  clusterRevealRef: React.MutableRefObject<number>;
  proximityRef: React.MutableRefObject<number>;
  nearestClusterRef: React.MutableRefObject<{
    id: ClusterId | null;
    dist: number;
  }>;
  onActiveCluster: (id: ClusterId | null) => void;
  lockedRef: React.MutableRefObject<LockedTarget>;
}) {
  // Memoise cluster centroids in world units so we don't recompute each
  // frame.
  const centroids = useMemo(
    () =>
      CLUSTERS.map((c) => {
        const [x, z] = equirectToWorld(c.center[0], c.center[1]);
        return { id: c.id as ClusterId, x, z };
      }),
    [],
  );

  const lastReportedRef = useRef<ClusterId | null>(null);

  useFrame((_, dt) => {
    const v = freeViewRef.current;
    // Height → zoom01 (0 = far, 1 = close).
    const zoom = heightToZoom01(v.height);

    // Nearest cluster to camera centre.
    let bestId: ClusterId | null = null;
    let bestDist = Infinity;
    for (const c of centroids) {
      const dx = c.x - v.centerX;
      const dz = c.z - v.centerZ;
      const d = Math.hypot(dx, dz);
      if (d < bestDist) {
        bestDist = d;
        bestId = c.id;
      }
    }
    nearestClusterRef.current = { id: bestId, dist: bestDist };

    // Proximity uniform — 1 only when close to a cluster AND zoomed in.
    const nearness = 1 - THREE.MathUtils.smoothstep(bestDist, 4, 28);
    const proximity = nearness * zoom;
    proximityRef.current = THREE.MathUtils.damp(
      proximityRef.current,
      proximity,
      4.0,
      dt,
    );

    // World reveal: shows cluster anchors (1 when far, 0 when close).
    const worldTarget = lockedRef.current.active ? 0 : 1 - zoom;
    worldRevealRef.current = THREE.MathUtils.damp(
      worldRevealRef.current,
      worldTarget,
      6.0,
      dt,
    );

    // Cluster reveal: shows individual pins (1 when close, 0 when far OR
    // no cluster is currently "active"). We also require proximity so
    // zooming in over open ocean doesn't spawn ghost pins.
    const activeProx = bestDist < CLUSTER_SNAP_RADIUS ? 1 : 0;
    const clusterTarget =
      lockedRef.current.active || (zoom > CLUSTER_ZOOM_THRESHOLD && activeProx)
        ? 1
        : 0;
    clusterRevealRef.current = THREE.MathUtils.damp(
      clusterRevealRef.current,
      clusterTarget,
      5.0,
      dt,
    );

    // Auto-activate the nearest cluster once we're zoomed in; deactivate
    // when we zoom back out. Only fire React updates when the id flips.
    const shouldActivate =
      !lockedRef.current.active &&
      zoom > CLUSTER_ZOOM_THRESHOLD &&
      bestDist < CLUSTER_SNAP_RADIUS
        ? bestId
        : null;
    if (shouldActivate !== lastReportedRef.current) {
      lastReportedRef.current = shouldActivate;
      onActiveCluster(shouldActivate);
    }
  });
  return null;
}

// ---------------------------------------------------------------- free-drag + wheel controls

// Attaches pointer + wheel listeners to the canvas's parent <div> and
// mutates the freeView ref. Returns a dragState ref so components can tell
// when the user is actively panning (useful for suppressing click handlers
// that should only fire on tap, not on release-after-drag).
function useFreeControls(
  containerRef: React.RefObject<HTMLDivElement>,
  freeViewRef: React.MutableRefObject<FreeView>,
  lockedRef: React.MutableRefObject<LockedTarget>,
) {
  const isDraggingRef = useRef(false);
  const moveAccumRef = useRef(0); // total pixel distance this gesture

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let pointerId: number | null = null;
    let lastX = 0;
    let lastY = 0;
    let lastTime = 0;

    const onPointerDown = (e: PointerEvent) => {
      if (lockedRef.current.active) return;
      // Only primary pointer / left button.
      if (e.button !== undefined && e.button !== 0) return;
      pointerId = e.pointerId;
      lastX = e.clientX;
      lastY = e.clientY;
      lastTime = performance.now();
      isDraggingRef.current = true;
      moveAccumRef.current = 0;
      // Intentionally NOT setPointerCapture: R3F's raycaster relies on
      // pointerdown/up firing on the canvas element to trigger mesh
      // onClick. Capturing would hijack the gesture. Move events come
      // from window so they're captured globally anyway.
      freeViewRef.current.velX = 0;
      freeViewRef.current.velZ = 0;
      freeViewRef.current.targetX = null;
      freeViewRef.current.targetZ = null;
      freeViewRef.current.targetH = null;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (pointerId !== e.pointerId) return;
      if (!isDraggingRef.current) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      const now = performance.now();
      const dt = Math.max(1, now - lastTime) / 1000;
      lastX = e.clientX;
      lastY = e.clientY;
      lastTime = now;
      moveAccumRef.current += Math.hypot(dx, dy);

      const view = freeViewRef.current;
      const scale = zoomToDragScale(view.height);
      // Screen-right drag moves the world's centre LEFT (classic map-drag).
      // Screen-down drag moves the centre UP (in world-z, decreasing z).
      const worldDX = -dx * scale;
      const worldDZ = -dy * scale;
      view.centerX += worldDX;
      view.centerZ += worldDZ;
      view.velX = worldDX / dt;
      view.velZ = worldDZ / dt;
      // Immediately clamp so fast drags don't overshoot and snap back.
      view.centerX = Math.max(-PAN_X_LIMIT, Math.min(PAN_X_LIMIT, view.centerX));
      view.centerZ = Math.max(-PAN_Z_LIMIT, Math.min(PAN_Z_LIMIT, view.centerZ));
    };

    const onPointerUp = (e: PointerEvent) => {
      if (pointerId !== e.pointerId) return;
      isDraggingRef.current = false;
      pointerId = null;
    };

    const onWheel = (e: WheelEvent) => {
      if (lockedRef.current.active) return;
      e.preventDefault();
      const view = freeViewRef.current;
      view.height += e.deltaY * WHEEL_UNITS_PER_DELTA;
      view.height = Math.max(HEIGHT_MIN, Math.min(HEIGHT_MAX, view.height));
      view.targetH = null; // user override
    };

    el.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      el.removeEventListener("wheel", onWheel);
    };
  }, [containerRef, freeViewRef, lockedRef]);

  return { isDraggingRef, moveAccumRef };
}

// ---------------------------------------------------------------- root

export default function V11UnifiedMap() {
  const index = useDestinationIndex();

  // --- state
  // The three "modes" are now derived from camera state, not stored.
  // Only two pieces of React state remain: the locked selection (if the
  // user has clicked into a destination orbit) and the auto-active
  // cluster (written by SemanticZoomSync based on nearest + zoom).
  const [activeCluster, setActiveCluster] = useState<ClusterId | null>(null);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [hoveredSlug, setHoveredSlug] = useState<string | null>(null);
  const [hoveredCluster, setHoveredCluster] = useState<ClusterId | null>(null);
  // Live readout of the camera's nearest cluster (for the UI picker).
  const [nearestLabel, setNearestLabel] = useState<{
    id: ClusterId | null;
    name: string;
  }>({ id: null, name: "Global view" });

  const mode: ViewMode = selectedSlug
    ? "destination"
    : activeCluster
      ? "cluster"
      : "world";

  const roughnessTex = useMemo(() => makeRoughness(256), []);
  useEffect(() => () => roughnessTex.dispose(), [roughnessTex]);

  // World hotspots correspond to cluster centroids (not per-destination).
  const hotspotsRef = useRef<{ position: THREE.Vector2; heat: number }[]>(
    CLUSTERS.map((c) => {
      const [cx, cz] = equirectToWorld(c.center[0], c.center[1]);
      return { position: new THREE.Vector2(cx, cz), heat: 0 };
    }),
  );

  useEffect(() => {
    hotspotsRef.current = CLUSTERS.map((c) => {
      const [cx, cz] = equirectToWorld(c.center[0], c.center[1]);
      return {
        position: new THREE.Vector2(cx, cz),
        heat:
          activeCluster === c.id
            ? 0.3
            : hoveredCluster === c.id
              ? 0.55
              : 0.14,
      };
    });
  }, [activeCluster, hoveredCluster]);

  // Refs driven by SemanticZoomSync every frame.
  const worldRevealRef = useRef(1);
  const clusterRevealRef = useRef(0);
  const proximityRef = useRef(0);
  const nearestClusterRef = useRef<{ id: ClusterId | null; dist: number }>({
    id: null,
    dist: Infinity,
  });

  // Free-exploration view: drag + wheel mutate this directly.
  const freeViewRef = useRef<FreeView>(createFreeView());
  // Locked destination orbit (null when free).
  const lockedRef = useRef<LockedTarget>({
    active: false,
    orbitCenter: new THREE.Vector3(),
    orbitRadius: ORBIT_RADIUS,
    orbitHeight: ORBIT_HEIGHT,
    fov: DESTINATION_FOV,
  });

  // Canvas container for attaching drag/wheel listeners.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { isDraggingRef, moveAccumRef } = useFreeControls(
    containerRef,
    freeViewRef,
    lockedRef,
  );

  // Cluster pin slots — computed per active cluster.
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

  // ---- transitions (soft fly-to; user can still drag away)

  const flyTo = useCallback(
    (opts: { x?: number; z?: number; h?: number }) => {
      const v = freeViewRef.current;
      if (opts.x != null) v.targetX = opts.x;
      if (opts.z != null) v.targetZ = opts.z;
      if (opts.h != null) v.targetH = opts.h;
      // Flying-to cancels momentum.
      v.velX = 0;
      v.velZ = 0;
    },
    [],
  );

  const goWorld = useCallback(() => {
    lockedRef.current.active = false;
    setSelectedSlug(null);
    setActiveCluster(null);
    setHoveredSlug(null);
    flyTo({ x: 0, z: 4, h: HEIGHT_DEFAULT });
  }, [flyTo]);

  const goCluster = useCallback(
    (id: ClusterId) => {
      const cluster = getCluster(id);
      if (!cluster) return;
      const [cx, cz] = equirectToWorld(cluster.center[0], cluster.center[1]);
      // Pick a target height that frames the cluster's fan comfortably.
      const fan = Math.max(6, clusterFanRadius(cluster));
      const h = THREE.MathUtils.clamp(fan * 2.4, 18, 34);
      lockedRef.current.active = false;
      setSelectedSlug(null);
      setHoveredSlug(null);
      // setActiveCluster is handled by SemanticZoomSync once we arrive.
      flyTo({ x: cx, z: cz, h });
    },
    [flyTo],
  );

  const goDestination = useCallback(
    (slug: string) => {
      const cluster = clusterForSlug(slug);
      if (!cluster) return;
      const slots = computeClusterPinSlots(cluster);
      const slot = slots[slug];
      if (!slot) return;
      const [x, z] = slot;
      setActiveCluster(cluster.id);
      setSelectedSlug(slug);
      setHoveredSlug(null);
      // Engage orbit lock.
      lockedRef.current = {
        active: true,
        orbitCenter: new THREE.Vector3(x, 1.5, z),
        orbitRadius: ORBIT_RADIUS,
        orbitHeight: ORBIT_HEIGHT,
        fov: DESTINATION_FOV,
      };
      // Also teleport the free-view so that when we un-lock later, the
      // map is already centred on the destination.
      freeViewRef.current.centerX = x;
      freeViewRef.current.centerZ = z;
      freeViewRef.current.height = 18;
      freeViewRef.current.targetX = null;
      freeViewRef.current.targetZ = null;
      freeViewRef.current.targetH = null;
      freeViewRef.current.velX = 0;
      freeViewRef.current.velZ = 0;
    },
    [],
  );

  const handleBack = useCallback(() => {
    if (mode === "destination") {
      // Exit orbit; land back at cluster-level altitude.
      lockedRef.current.active = false;
      setSelectedSlug(null);
      if (activeCluster) {
        const cluster = getCluster(activeCluster);
        if (cluster) {
          const [cx, cz] = equirectToWorld(
            cluster.center[0],
            cluster.center[1],
          );
          flyTo({ x: cx, z: cz, h: 22 });
        }
      }
    } else if (mode === "cluster") {
      goWorld();
    }
  }, [mode, activeCluster, goWorld, flyTo]);

  // Sync nearest-cluster label for the UI.
  const nameForCluster = useCallback(
    (id: ClusterId | null) => {
      if (!id) return "Global view";
      const c = getCluster(id);
      return c ? c.name : "Global view";
    },
    [],
  );
  useEffect(() => {
    const iv = setInterval(() => {
      const nr = nearestClusterRef.current;
      const v = freeViewRef.current;
      const zoomed = heightToZoom01(v.height) > CLUSTER_ZOOM_THRESHOLD;
      const id =
        zoomed && nr.dist < CLUSTER_SNAP_RADIUS * 1.8 ? nr.id : null;
      setNearestLabel((prev) =>
        prev.id === id ? prev : { id, name: nameForCluster(id) },
      );
    }, 160);
    return () => clearInterval(iv);
  }, [nameForCluster]);

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
        : "Drag the World.";
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
        : "Friction-panned globe. Ink ridges are real Mapbox DEM over Natural Earth coastlines. Scroll to dive; terrain grows where you hover.";

  const pickerPlaceholder =
    mode === "destination"
      ? nearestLabel.name
      : nearestLabel.id
        ? `Near · ${nearestLabel.name}`
        : "Global view · drag to explore";

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
        ref={containerRef}
        className="absolute inset-0 select-none"
        style={{
          background:
            "radial-gradient(circle at 50% 30%, #05070c 0%, #020304 60%, #000 100%)",
          cursor: mode === "destination" ? "default" : "grab",
          touchAction: "none",
        }}
      >
        <Canvas
          camera={{
            position: [0, HEIGHT_DEFAULT, HEIGHT_DEFAULT * TILT_RATIO + 4],
            fov: FOV_AT_MAX_HEIGHT,
            near: 0.1,
            far: 400,
          }}
          dpr={[1, 2]}
          gl={{ antialias: true, alpha: false }}
          onCreated={({ gl, scene }) => {
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.toneMappingExposure = 0.88;
            gl.outputColorSpace = THREE.SRGBColorSpace;
            scene.background = new THREE.Color("#020304");
          }}
        >
          <fog attach="fog" args={["#020304", 48, 220]} />
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

          <WorldBase
            hotspotsRef={hotspotsRef}
            proximityRef={proximityRef}
          />

          <SemanticZoomSync
            freeViewRef={freeViewRef}
            worldRevealRef={worldRevealRef}
            clusterRevealRef={clusterRevealRef}
            proximityRef={proximityRef}
            nearestClusterRef={nearestClusterRef}
            onActiveCluster={(id) => {
              setActiveCluster((prev) => (prev === id ? prev : id));
              if (!id) {
                setHoveredSlug(null);
              }
            }}
            lockedRef={lockedRef}
          />

          {/* Cluster anchors — always rendered; their group opacity */}
          {/* cross-fades with worldRevealRef, so they softly retreat as */}
          {/* the user zooms in rather than popping off. */}
          <WorldAnchors
            hoveredCluster={hoveredCluster}
            onPick={(id) => {
              // If user barely dragged this was a real click → fly-to.
              if (moveAccumRef.current < 4) goCluster(id);
              moveAccumRef.current = 0;
            }}
            onHover={(id) => setHoveredCluster(id)}
            onUnhover={(id) =>
              setHoveredCluster((h) => (h === id ? null : h))
            }
            worldRevealRef={worldRevealRef}
          />

          {/* Active cluster: fanned pins + constellation lines + islands */}
          {activeClusterDef && (
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
                    onSelect={() => {
                      if (moveAccumRef.current < 4) goDestination(slug);
                      moveAccumRef.current = 0;
                    }}
                    roughnessTex={roughnessTex}
                  />
                );
              })}
            </>
          )}

          <DollyRig freeViewRef={freeViewRef} lockedRef={lockedRef} />

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
              <Vignette darkness={0.6} offset={0.3} />
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
          label={nearestLabel.id ? "Nearest region" : "Exploration"}
          placeholder={pickerPlaceholder}
          anchor="bottom-left"
        />
      </div>
    </ExplorationShell>
  );
}
