import * as THREE from 'three';
import { ProjectedRoute } from '../services/gpsProjection';
import { HighwayExit, TownStop } from '../types';

let cachedRoadGrainCanvas: HTMLCanvasElement | null = null;
let cachedShoulderGrainCanvas: HTMLCanvasElement | null = null;

function getGrainTile(baseRgb: [number, number, number], variance: number, cacheKey: 'road' | 'shoulder'): HTMLCanvasElement {
  if (cacheKey === 'road' && cachedRoadGrainCanvas) return cachedRoadGrainCanvas;
  if (cacheKey === 'shoulder' && cachedShoulderGrainCanvas) return cachedShoulderGrainCanvas;

  const tile = document.createElement('canvas');
  tile.width = 64;
  tile.height = 64;
  const tctx = tile.getContext('2d')!;
  const imgData = tctx.createImageData(64, 64);
  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    const grain = (Math.random() - 0.5) * variance;
    data[i] = Math.min(255, Math.max(0, baseRgb[0] + grain));
    data[i + 1] = Math.min(255, Math.max(0, baseRgb[1] + grain));
    data[i + 2] = Math.min(255, Math.max(0, baseRgb[2] + grain));
    data[i + 3] = 255;
  }
  tctx.putImageData(imgData, 0, 0);

  if (cacheKey === 'road') cachedRoadGrainCanvas = tile;
  else cachedShoulderGrainCanvas = tile;
  return tile;
}

/**
 * Creates a procedural asphalt texture with authentic US interstate highway markings:
 * - Double yellow center dividing lines
 * - White dashed lane lines (FHWA standard: 10 ft paint, 30 ft skip = 40 ft / 12.192 m period)
 * - Solid white outer edge fog lines
 * - Fast tiled aggregate asphalt grain (< 1ms generation)
 */
export function createHighwayTexture(renderer?: THREE.WebGLRenderer): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  // 1. Dark rich asphalt base with fast 64x64 tiled grain
  const grainPat = ctx.createPattern(getGrainTile([24, 27, 32], 18, 'road'), 'repeat');
  ctx.fillStyle = grainPat || '#181b20';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 2. Road shoulders (dark textured gravel edge)
  ctx.fillStyle = '#22252a';
  ctx.fillRect(0, 0, 18, canvas.height);
  ctx.fillRect(canvas.width - 18, 0, 18, canvas.height);

  // 3. Solid White Outer Edge Fog Lines (width 6px)
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(18, 0, 6, canvas.height);
  ctx.fillRect(canvas.width - 24, 0, 6, canvas.height);

  // 4. Double Yellow Center Line (US Interstate Standard)
  ctx.fillStyle = '#f59e0b'; // Reflective Highway Yellow
  const center = canvas.width / 2;
  const yellowWidth = 4;
  const yellowGap = 5;
  ctx.fillRect(center - yellowGap / 2 - yellowWidth, 0, yellowWidth, canvas.height);
  ctx.fillRect(center + yellowGap / 2, 0, yellowWidth, canvas.height);

  // 5. White Dashed Lane Dividers (3 lanes each direction)
  const leftOuter = 24;
  const leftInner = center - yellowGap / 2 - yellowWidth;
  const leftSpan = leftInner - leftOuter;
  const rightInner = center + yellowGap / 2 + yellowWidth;
  const rightOuter = canvas.width - 24;
  const rightSpan = rightOuter - rightInner;

  const laneDividers = [
    leftOuter + leftSpan / 3,
    leftOuter + (leftSpan * 2) / 3,
    rightInner + rightSpan / 3,
    rightInner + (rightSpan * 2) / 3,
  ];

  ctx.fillStyle = '#ffffff';
  const dashLength = 128; // 10 ft equivalent

  for (const divX of laneDividers) {
    ctx.fillRect(divX - 2, 0, 4, dashLength);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;

  if (renderer) {
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  }

  return texture;
}

export interface ExitRampSlice {
  leftEdge: number;
  rightEdge: number;
  centerOffset: number;
  width: number;
  slopeDs: number;
}

/**
 * Shared physical geometry for highway exit deceleration lanes and curving ramps.
 * - [exitMeters - 650, exitMeters - 350]: 300m smooth taper widening from right edge (+8.88m) to 6.6m lane (+15.48m)
 * - [exitMeters - 350, exitMeters]: 350m full parallel auxiliary exit lane (+8.88m to +15.48m, center +12.18m)
 * - [exitMeters, exitMeters + 950]: 950m sweeping right-hand off-ramp curve (up to +95m lateral diverge)
 */
export function getExitRampGeometryAtDistance(distMeters: number, exitMeters: number): ExitRampSlice {
  const halfRoad = 9.6;
  const innerEdge = halfRoad - 0.72; // 8.88m (flush with outer fog line on 3-lane side)
  const fullRampWidth = 6.6;

  const taperProgress = Math.max(0, Math.min(1, (distMeters - (exitMeters - 650)) / 300));
  const smoothTaper = taperProgress * taperProgress * (3 - 2 * taperProgress);

  const divergeLen = 950;
  const maxDivergeOffset = 95.0;
  const diverge = Math.max(0, (distMeters - exitMeters) / divergeLen);
  const divergeOffset = Math.pow(diverge, 1.7) * maxDivergeOffset;
  const slopeDs =
    distMeters > exitMeters
      ? ((1.7 * maxDivergeOffset) / divergeLen) * Math.pow(diverge, 0.7)
      : 0;

  const width = 0.6 + smoothTaper * (fullRampWidth - 0.6);
  const leftEdge = innerEdge + divergeOffset;
  const rightEdge = innerEdge + width + divergeOffset;
  const centerOffset = (leftEdge + rightEdge) * 0.5;

  return { leftEdge, rightEdge, centerOffset, width, slopeDs };
}

/**
 * Creates texture for auxiliary exit lane & curving off-ramp:
 * - Matching dark aggregate asphalt (#181b20)
 * - Left dashed white merge stripe (FHWA 12.192m cycle when uv repeats per STRIPE_CYCLE)
 * - Right solid white outer fog line + narrow shoulder edge
 */
export function createExitRampTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  const grainPat = ctx.createPattern(getGrainTile([24, 27, 32], 16, 'road'), 'repeat');
  ctx.fillStyle = grainPat || '#181b20';
  ctx.fillRect(0, 0, 256, 256);

  // Outer right dark shoulder edge
  ctx.fillStyle = '#22252a';
  ctx.fillRect(256 - 14, 0, 14, 256);

  // Solid White outer fog line (right)
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(256 - 21, 0, 6, 256);

  // Dashed white lane separation line (left merge edge)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(4, 0, 5, 85);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  return tex;
}

/**
 * Creates striped gore chevron texture for the highway/ramp split wedge
 */
export function createGoreChevronTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#181b20';
  ctx.fillRect(0, 0, 128, 128);

  ctx.strokeStyle = '#f8fafc';
  ctx.lineWidth = 7;
  for (let y = -128; y < 256; y += 32) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(64, y + 32);
    ctx.lineTo(128, y);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Creates textured shoulder gravel
 */
export function createShoulderTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const grainPat = ctx.createPattern(getGrainTile([42, 45, 50], 35, 'shoulder'), 'repeat');
  ctx.fillStyle = grainPat || '#2a2d32';
  ctx.fillRect(0, 0, 128, 128);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Creates an authentic 2-panel Interstate highway interchange gantry:
 * - Left sign: Main route through lanes (e.g. I-80 WEST • LOS ANGELES / KEEP LEFT)
 * - Right sign: Exit ramp declaration (e.g. EXIT 64: I-75 SOUTH • CINCINNATI / RIGHT LANE)
 */
export function createInterchangeGantrySign(
  mainCode: string,
  mainDest: string,
  exitNum: string,
  exitCode: string,
  exitDest: string
): THREE.Group {
  const gantryGroup = new THREE.Group();

  const steelMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    metalness: 0.85,
    roughness: 0.25,
  });

  // Pillars on shoulders (span 29.4m to clear 19.2m 6-lane highway + 6.6m exit lane)
  const pillarGeo = new THREE.CylinderGeometry(0.24, 0.30, 8.8, 8);
  const leftPillar = new THREE.Mesh(pillarGeo, steelMat);
  leftPillar.position.set(-12.6, 4.4, 0);
  gantryGroup.add(leftPillar);

  const rightPillar = new THREE.Mesh(pillarGeo, steelMat);
  rightPillar.position.set(16.8, 4.4, 0);
  gantryGroup.add(rightPillar);

  // Overhead beam
  const beamGeo = new THREE.BoxGeometry(30.6, 0.55, 0.55);
  const beam = new THREE.Mesh(beamGeo, steelMat);
  beam.position.set(2.1, 8.5, 0);
  gantryGroup.add(beam);

  // --- Left Sign: Main Route Continuation ---
  const leftCanvas = document.createElement('canvas');
  leftCanvas.width = 512;
  leftCanvas.height = 256;
  const lctx = leftCanvas.getContext('2d')!;

  lctx.fillStyle = '#15803d'; // Federal Highway Green
  lctx.fillRect(0, 0, 512, 256);
  lctx.strokeStyle = '#ffffff';
  lctx.lineWidth = 10;
  lctx.strokeRect(10, 10, 492, 236);

  lctx.fillStyle = '#ffffff';
  lctx.textAlign = 'center';
  lctx.font = 'bold 36px sans-serif';
  lctx.fillText(mainCode, 256, 65, 460);
  lctx.font = 'bold 38px sans-serif';
  lctx.fillText(mainDest.toUpperCase(), 256, 135, 460);
  lctx.font = '26px sans-serif';
  lctx.fillStyle = '#38bdf8';
  lctx.fillText('THRU TRAFFIC • KEEP LEFT', 256, 200, 460);

  const leftSignTex = new THREE.CanvasTexture(leftCanvas);
  leftSignTex.colorSpace = THREE.SRGBColorSpace;
  const leftSignMat = new THREE.MeshStandardMaterial({ map: leftSignTex, roughness: 0.3 });
  const leftSign = new THREE.Mesh(new THREE.BoxGeometry(7.2, 3.4, 0.15), leftSignMat);
  leftSign.position.set(3.8, 7.2, 0);
  gantryGroup.add(leftSign);

  // --- Right Sign: Exit Ramp Diverge ---
  const rightCanvas = document.createElement('canvas');
  rightCanvas.width = 512;
  rightCanvas.height = 256;
  const rctx = rightCanvas.getContext('2d')!;

  rctx.fillStyle = '#15803d';
  rctx.fillRect(0, 0, 512, 256);
  rctx.strokeStyle = '#ffffff';
  rctx.lineWidth = 10;
  rctx.strokeRect(10, 10, 492, 236);

  // Yellow Exit Header Plaque
  rctx.fillStyle = '#f59e0b';
  rctx.fillRect(20, 20, 472, 50);
  rctx.fillStyle = '#0f172a';
  rctx.textAlign = 'center';
  rctx.font = '900 32px sans-serif';
  rctx.fillText(`EXIT ${exitNum}`, 256, 56);

  rctx.fillStyle = '#ffffff';
  rctx.font = 'bold 38px sans-serif';
  rctx.fillText(exitCode, 256, 125, 460);
  rctx.font = 'bold 32px sans-serif';
  rctx.fillText(exitDest.toUpperCase(), 256, 175, 460);
  rctx.fillStyle = '#fef08a';
  rctx.font = 'bold 26px sans-serif';
  rctx.fillText('RIGHT LANE ONLY ↗', 256, 225, 460);

  const rightSignTex = new THREE.CanvasTexture(rightCanvas);
  rightSignTex.colorSpace = THREE.SRGBColorSpace;
  const rightSignMat = new THREE.MeshStandardMaterial({ map: rightSignTex, roughness: 0.3 });
  const rightSign = new THREE.Mesh(new THREE.BoxGeometry(7.0, 3.4, 0.15), rightSignMat);
  rightSign.position.set(12.0, 7.2, 0);
  gantryGroup.add(rightSign);

  return gantryGroup;
}

/**
 * Creates a roadside Interstate City/Town Limit sign + stylized roadside town/city building cluster.
 */
export function createTownWelcomeCluster(town: TownStop): THREE.Group {
  const townGroup = new THREE.Group();
  const isCity = town.type === 'city';

  // --- 1. Green Highway City/Town Limit Billboard on right shoulder ---
  const postMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.75, roughness: 0.3 });
  const postGeo = new THREE.CylinderGeometry(0.1, 0.12, 4.0, 6);

  const leftPost = new THREE.Mesh(postGeo, postMat);
  leftPost.position.set(11.6, 2.0, 0);
  townGroup.add(leftPost);

  const rightPost = new THREE.Mesh(postGeo, postMat);
  rightPost.position.set(14.8, 2.0, 0);
  townGroup.add(rightPost);

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#15803d';
  ctx.fillRect(0, 0, 512, 256);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 10;
  ctx.strokeRect(10, 10, 492, 236);

  ctx.fillStyle = isCity ? '#f59e0b' : '#e2e8f0';
  ctx.fillRect(22, 22, 468, 46);
  ctx.fillStyle = '#0f172a';
  ctx.textAlign = 'center';
  ctx.font = '900 28px sans-serif';
  ctx.fillText(isCity ? 'CITY LIMIT • SERVICES AHEAD' : 'TOWN LIMIT • SERVICES AHEAD', 256, 54);

  ctx.fillStyle = '#ffffff';
  ctx.font = '900 44px sans-serif';
  ctx.fillText(`${town.name.toUpperCase()}`, 256, 130, 456);

  ctx.fillStyle = '#fde68a';
  ctx.font = 'bold 30px sans-serif';
  ctx.fillText(`${town.state} • MILE ${Math.round(town.mileMarker)}`, 256, 182, 456);

  ctx.fillStyle = '#cbd5e1';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText('LODGING & FUEL AVAILABLE', 256, 224, 456);

  const signTex = new THREE.CanvasTexture(canvas);
  signTex.colorSpace = THREE.SRGBColorSpace;
  const signMat = new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.35 });
  const signBoard = new THREE.Mesh(new THREE.BoxGeometry(4.4, 2.2, 0.14), signMat);
  signBoard.position.set(13.2, 3.3, 0.1);
  townGroup.add(signBoard);

  // --- 2. Stylized Roadside Town / City Skyline Buildings off right shoulder ---
  const buildingCount = isCity ? 7 : 4;
  const palette = isCity ? [0x334155, 0x475569, 0x1e293b, 0x3b4963] : [0x475569, 0x57534e, 0x3f3f46, 0x64748b];

  for (let i = 0; i < buildingCount; i++) {
    const w = isCity ? 7 + (i % 3) * 2.5 : 6 + (i % 2) * 2;
    const d = isCity ? 8 + (i % 2) * 3 : 6 + (i % 2) * 2;
    const h = isCity ? 10 + ((i * 7) % 16) : 4.2 + ((i * 3) % 4);
    const xPos = 22 + (i % 2) * 11;
    const zPos = -24 - i * 22;

    const bMat = new THREE.MeshStandardMaterial({
      color: palette[i % palette.length],
      roughness: 0.8,
      metalness: 0.15,
    });
    const bMesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bMat);
    bMesh.position.set(xPos, h * 0.5 - 0.2, zPos);
    townGroup.add(bMesh);

    const winMat = new THREE.MeshStandardMaterial({
      color: 0xfef08a,
      emissive: 0xf59e0b,
      emissiveIntensity: 0.55,
      roughness: 0.3,
    });
    const winMesh = new THREE.Mesh(new THREE.BoxGeometry(0.15, h * 0.55, d * 0.65), winMat);
    winMesh.position.set(xPos - w * 0.5 - 0.05, h * 0.55, zPos);
    townGroup.add(winMesh);
  }

  return townGroup;
}

export interface DynamicHighwayFrame {
  centerPoint: THREE.Vector3;
  tangent: THREE.Vector3;
  binormal: THREE.Vector3;
  normal: THREE.Vector3;
}

/**
 * High-performance dynamic highway streamer:
 * Renders the highway ribbon from 200m behind the vehicle to 3,800m ahead into the horizon.
 * Also dynamically generates physical branching exit ramps when approaching real highway exits.
 */
export class DynamicHighwayStreamer {
  public group: THREE.Group = new THREE.Group();

  private roadMesh: THREE.Mesh;
  private shoulderMesh: THREE.Mesh;
  private exitRampMesh: THREE.Mesh;
  private goreMesh: THREE.Mesh;
  private delineatorMesh: THREE.InstancedMesh;
  private mileMarkerMesh: THREE.InstancedMesh;
  private exitGantryGroup: THREE.Group = new THREE.Group();
  private townLandmarkGroup: THREE.Group = new THREE.Group();

  private roadGeo: THREE.BufferGeometry;
  private shoulderGeo: THREE.BufferGeometry;
  private exitRampGeo: THREE.BufferGeometry;
  private goreGeo: THREE.BufferGeometry;

  private roadPositions: Float32Array;
  private roadNormals: Float32Array;
  private roadUvs: Float32Array;

  private shoulderPositions: Float32Array;
  private shoulderNormals: Float32Array;
  private shoulderUvs: Float32Array;

  // Exit ramp buffer: 80 slices
  private readonly RAMP_SLICES = 80;
  private exitRampPositions: Float32Array;
  private exitRampNormals: Float32Array;
  private exitRampUvs: Float32Array;

  // Painted gore wedge buffer: 14 slices
  private readonly GORE_SLICES = 14;
  private gorePositions: Float32Array;
  private goreNormals: Float32Array;
  private goreUvs: Float32Array;

  private readonly NUM_SLICES = 160;
  private readonly ROAD_WIDTH = 19.2;      // 19.2m 6-lane interstate (3 lanes per side)
  private readonly SHOULDER_WIDTH = 2.4;   // 2.4m shoulders
  private readonly STRIPE_CYCLE = 12.192;  // 40 ft FHWA dash cycle (10ft stripe, 30ft skip)
  private readonly VIEW_BACK = 200;        // 200m behind
  private readonly VIEW_AHEAD = 3800;      // 3800m ahead
  private readonly DELIN_SPACING = 35;     // 35m between delineators
  private readonly MAX_DELIN = 240;        // 120 per side

  private dummy = new THREE.Object3D();
  private upVector = new THREE.Vector3(0, 1, 0);

  // Reusable zero-GC math scratch buffers
  private _carCenter = new THREE.Vector3();
  private _carTangent = new THREE.Vector3();
  private _carBinormal = new THREE.Vector3();
  private _carNormal = new THREE.Vector3();
  private _pt = new THREE.Vector3();
  private _tan = new THREE.Vector3();
  private _bin = new THREE.Vector3();
  private _nrm = new THREE.Vector3();
  private _gTanNeg = new THREE.Vector3();
  private _gRotMat = new THREE.Matrix4();

  // Stationary cache to avoid redundant buffer uploads when stopped
  private lastStreamDist = -1;
  private lastStreamRoute: ProjectedRoute | null = null;
  private lastStreamDir: 1 | -1 = 1;
  private lastStreamUTurn = false;
  private lastStreamExitId: string | null = null;
  private lastStreamTownId: string | null = null;
  private cachedFrame: DynamicHighwayFrame = {
    centerPoint: new THREE.Vector3(),
    tangent: new THREE.Vector3(0, 0, -1),
    binormal: new THREE.Vector3(1, 0, 0),
    normal: new THREE.Vector3(0, 1, 0),
  };

  // Cached active exit gantry key & town landmark key
  private currentGantryKey: string | null = null;
  private currentTownKey: string | null = null;

  constructor(renderer?: THREE.WebGLRenderer) {
    const numSlices = this.NUM_SLICES;
    const numVerts = (numSlices + 1) * 2;
    const numIndices = numSlices * 6;

    // --- 1. Road Geometry Buffers ---
    this.roadPositions = new Float32Array(numVerts * 3);
    this.roadNormals = new Float32Array(numVerts * 3);
    this.roadUvs = new Float32Array(numVerts * 2);

    const roadIndices = new Uint32Array(numIndices);
    for (let i = 0; i < numSlices; i++) {
      const base = i * 2;
      const idx = i * 6;
      roadIndices[idx] = base;
      roadIndices[idx + 1] = base + 1;
      roadIndices[idx + 2] = base + 2;
      roadIndices[idx + 3] = base + 1;
      roadIndices[idx + 4] = base + 3;
      roadIndices[idx + 5] = base + 2;
    }

    this.roadGeo = new THREE.BufferGeometry();
    this.roadGeo.setAttribute('position', new THREE.BufferAttribute(this.roadPositions, 3));
    this.roadGeo.setAttribute('normal', new THREE.BufferAttribute(this.roadNormals, 3));
    this.roadGeo.setAttribute('uv', new THREE.BufferAttribute(this.roadUvs, 2));
    this.roadGeo.setIndex(new THREE.BufferAttribute(roadIndices, 1));

    const roadMat = new THREE.MeshStandardMaterial({
      map: createHighwayTexture(renderer),
      roughness: 0.82,
      metalness: 0.12,
    });
    this.roadMesh = new THREE.Mesh(this.roadGeo, roadMat);
    this.roadMesh.receiveShadow = true;
    this.roadMesh.frustumCulled = false;
    this.group.add(this.roadMesh);

    // --- 2. Shoulder Geometry Buffers ---
    const shoulderVerts = (numSlices + 1) * 4;
    const shoulderIndicesCount = numSlices * 12;
    this.shoulderPositions = new Float32Array(shoulderVerts * 3);
    this.shoulderNormals = new Float32Array(shoulderVerts * 3);
    this.shoulderUvs = new Float32Array(shoulderVerts * 2);

    const shoulderIndices = new Uint32Array(shoulderIndicesCount);
    for (let i = 0; i < numSlices; i++) {
      const base = i * 4;
      const idx = i * 12;
      shoulderIndices[idx] = base;
      shoulderIndices[idx + 1] = base + 1;
      shoulderIndices[idx + 2] = base + 4;
      shoulderIndices[idx + 3] = base + 1;
      shoulderIndices[idx + 4] = base + 5;
      shoulderIndices[idx + 5] = base + 4;

      shoulderIndices[idx + 6] = base + 2;
      shoulderIndices[idx + 7] = base + 3;
      shoulderIndices[idx + 8] = base + 6;
      shoulderIndices[idx + 9] = base + 3;
      shoulderIndices[idx + 10] = base + 7;
      shoulderIndices[idx + 11] = base + 6;
    }

    this.shoulderGeo = new THREE.BufferGeometry();
    this.shoulderGeo.setAttribute('position', new THREE.BufferAttribute(this.shoulderPositions, 3));
    this.shoulderGeo.setAttribute('normal', new THREE.BufferAttribute(this.shoulderNormals, 3));
    this.shoulderGeo.setAttribute('uv', new THREE.BufferAttribute(this.shoulderUvs, 2));
    this.shoulderGeo.setIndex(new THREE.BufferAttribute(shoulderIndices, 1));

    const shoulderMat = new THREE.MeshStandardMaterial({
      map: createShoulderTexture(),
      roughness: 0.94,
      metalness: 0.05,
    });
    this.shoulderMesh = new THREE.Mesh(this.shoulderGeo, shoulderMat);
    this.shoulderMesh.receiveShadow = true;
    this.shoulderMesh.frustumCulled = false;
    this.group.add(this.shoulderMesh);

    // --- 3. Branching Exit Ramp Geometry ---
    const rampVerts = (this.RAMP_SLICES + 1) * 2;
    const rampIndicesCount = this.RAMP_SLICES * 6;
    this.exitRampPositions = new Float32Array(rampVerts * 3);
    this.exitRampNormals = new Float32Array(rampVerts * 3);
    this.exitRampUvs = new Float32Array(rampVerts * 2);

    const rampIndices = new Uint32Array(rampIndicesCount);
    for (let i = 0; i < this.RAMP_SLICES; i++) {
      const base = i * 2;
      const idx = i * 6;
      rampIndices[idx] = base;
      rampIndices[idx + 1] = base + 1;
      rampIndices[idx + 2] = base + 2;
      rampIndices[idx + 3] = base + 1;
      rampIndices[idx + 4] = base + 3;
      rampIndices[idx + 5] = base + 2;
    }

    this.exitRampGeo = new THREE.BufferGeometry();
    this.exitRampGeo.setAttribute('position', new THREE.BufferAttribute(this.exitRampPositions, 3));
    this.exitRampGeo.setAttribute('normal', new THREE.BufferAttribute(this.exitRampNormals, 3));
    this.exitRampGeo.setAttribute('uv', new THREE.BufferAttribute(this.exitRampUvs, 2));
    this.exitRampGeo.setIndex(new THREE.BufferAttribute(rampIndices, 1));

    const rampMat = new THREE.MeshStandardMaterial({
      map: createExitRampTexture(),
      roughness: 0.85,
      metalness: 0.1,
    });
    this.exitRampMesh = new THREE.Mesh(this.exitRampGeo, rampMat);
    this.exitRampMesh.receiveShadow = true;
    this.exitRampMesh.frustumCulled = false;
    this.exitRampMesh.visible = false;
    this.group.add(this.exitRampMesh);

    // --- 3b. Painted Gore Chevron Wedge ---
    const goreVerts = (this.GORE_SLICES + 1) * 2;
    const goreIndicesCount = this.GORE_SLICES * 6;
    this.gorePositions = new Float32Array(goreVerts * 3);
    this.goreNormals = new Float32Array(goreVerts * 3);
    this.goreUvs = new Float32Array(goreVerts * 2);
    const goreIndices = new Uint32Array(goreIndicesCount);
    for (let i = 0; i < this.GORE_SLICES; i++) {
      const base = i * 2;
      const idx = i * 6;
      goreIndices[idx] = base;
      goreIndices[idx + 1] = base + 1;
      goreIndices[idx + 2] = base + 2;
      goreIndices[idx + 3] = base + 1;
      goreIndices[idx + 4] = base + 3;
      goreIndices[idx + 5] = base + 2;
    }
    this.goreGeo = new THREE.BufferGeometry();
    this.goreGeo.setAttribute('position', new THREE.BufferAttribute(this.gorePositions, 3));
    this.goreGeo.setAttribute('normal', new THREE.BufferAttribute(this.goreNormals, 3));
    this.goreGeo.setAttribute('uv', new THREE.BufferAttribute(this.goreUvs, 2));
    this.goreGeo.setIndex(new THREE.BufferAttribute(goreIndices, 1));
    const goreMat = new THREE.MeshStandardMaterial({
      map: createGoreChevronTexture(),
      roughness: 0.85,
      metalness: 0.08,
    });
    this.goreMesh = new THREE.Mesh(this.goreGeo, goreMat);
    this.goreMesh.receiveShadow = true;
    this.goreMesh.frustumCulled = false;
    this.goreMesh.visible = false;
    this.group.add(this.goreMesh);

    // Gantry Sign & Town Landmark containers
    this.group.add(this.exitGantryGroup);
    this.townLandmarkGroup.visible = false;
    this.group.add(this.townLandmarkGroup);

    // --- 4. Delineator Posts ---
    const delinGeo = new THREE.CylinderGeometry(0.08, 0.08, 1.3, 6);
    const delinMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0x94a3b8,
      emissiveIntensity: 0.6,
      roughness: 0.2,
    });
    this.delineatorMesh = new THREE.InstancedMesh(delinGeo, delinMat, this.MAX_DELIN);
    this.delineatorMesh.castShadow = false;
    this.delineatorMesh.frustumCulled = false;
    this.group.add(this.delineatorMesh);

    // --- 5. Interstate Mile Marker Posts ---
    const markerGeo = new THREE.BoxGeometry(0.35, 1.2, 0.08);
    const markerMat = new THREE.MeshStandardMaterial({
      color: 0x15803d,
      emissive: 0x166534,
      emissiveIntensity: 0.3,
      roughness: 0.3,
    });
    this.mileMarkerMesh = new THREE.InstancedMesh(markerGeo, markerMat, 10);
    this.mileMarkerMesh.castShadow = false;
    this.mileMarkerMesh.frustumCulled = false;
    this.group.add(this.mileMarkerMesh);
  }

  /**
   * Updates the road ribbon, branching exit ramp, and roadside assets around the vehicle's current distance.
   */
  public update(
    currentDistanceMeters: number,
    projectedRoute: ProjectedRoute,
    activeExit?: HighwayExit | null,
    mainCode?: string,
    mainDest?: string,
    driveDirection: 1 | -1 = 1,
    isTurningAround: boolean = false,
    activeTown?: TownStop | null
  ): DynamicHighwayFrame {
    const totalMeters = projectedRoute.totalMeters;
    const curve = projectedRoute.curve;
    const clampedDist = Math.max(0, Math.min(totalMeters, currentDistanceMeters));
    const exitId = activeExit ? activeExit.id : null;
    const townId = activeTown ? activeTown.id : null;

    // Fast path when stationary and route/direction/exit/town unchanged
    if (
      this.lastStreamRoute === projectedRoute &&
      Math.abs(clampedDist - this.lastStreamDist) < 0.005 &&
      this.lastStreamDir === driveDirection &&
      this.lastStreamUTurn === isTurningAround &&
      this.lastStreamExitId === exitId &&
      this.lastStreamTownId === townId
    ) {
      return this.cachedFrame;
    }

    this.lastStreamRoute = projectedRoute;
    this.lastStreamDist = clampedDist;
    this.lastStreamDir = driveDirection;
    this.lastStreamUTurn = isTurningAround;
    this.lastStreamExitId = exitId;
    this.lastStreamTownId = townId;

    const carT = clampedDist / totalMeters;
    const carU = curve.getUtoTmapping(carT, 0);
    curve.getPoint(carU, this._carCenter);
    curve.getTangent(carU, this._carTangent).normalize();
    this._carBinormal.crossVectors(this._carTangent, this.upVector).normalize();
    this._carNormal.crossVectors(this._carBinormal, this._carTangent).normalize();

    const carCenter = this._carCenter;

    // Stream window:
    // - Forward (+1): [current - 200m, current + 3800m]
    // - Opposite (-1): [current - 3800m, current + 200m]
    // - During 180° U-turn: symmetric [current - 2000m, current + 2000m] so both horizons stay rendered
    const backSpan = isTurningAround ? 2000 : driveDirection === 1 ? this.VIEW_BACK : this.VIEW_AHEAD;
    const aheadSpan = isTurningAround ? 2000 : driveDirection === 1 ? this.VIEW_AHEAD : this.VIEW_BACK;
    const startDist = Math.max(0, clampedDist - backSpan);
    const endDist = Math.min(totalMeters, clampedDist + aheadSpan);
    const span = Math.max(10, endDist - startDist);

    const halfRoad = this.ROAD_WIDTH / 2;
    const shoulderW = this.SHOULDER_WIDTH;

    for (let i = 0; i <= this.NUM_SLICES; i++) {
      const sliceFraction = i / this.NUM_SLICES;
      const sliceDist = startDist + sliceFraction * span;
      const sliceT = Math.max(0, Math.min(1, sliceDist / totalMeters));

      const sliceU = curve.getUtoTmapping(sliceT, 0);
      curve.getPoint(sliceU, this._pt);
      curve.getTangent(sliceU, this._tan).normalize();
      this._bin.crossVectors(this._tan, this.upVector).normalize();
      this._nrm.crossVectors(this._bin, this._tan).normalize();

      // Relative to vehicle center
      const relX = this._pt.x - carCenter.x;
      const relY = this._pt.y - carCenter.y;
      const relZ = this._pt.z - carCenter.z;

      // Road Left & Right
      const rIdx = i * 6;
      const lX = relX - this._bin.x * halfRoad;
      const lY = relY - this._bin.y * halfRoad + this._nrm.y * 0.05;
      const lZ = relZ - this._bin.z * halfRoad;

      const rX = relX + this._bin.x * halfRoad;
      const rY = relY + this._bin.y * halfRoad + this._nrm.y * 0.05;
      const rZ = relZ + this._bin.z * halfRoad;

      this.roadPositions[rIdx] = lX;
      this.roadPositions[rIdx + 1] = lY;
      this.roadPositions[rIdx + 2] = lZ;

      this.roadPositions[rIdx + 3] = rX;
      this.roadPositions[rIdx + 4] = rY;
      this.roadPositions[rIdx + 5] = rZ;

      this.roadNormals[rIdx] = this._nrm.x;
      this.roadNormals[rIdx + 1] = this._nrm.y;
      this.roadNormals[rIdx + 2] = this._nrm.z;
      this.roadNormals[rIdx + 3] = this._nrm.x;
      this.roadNormals[rIdx + 4] = this._nrm.y;
      this.roadNormals[rIdx + 5] = this._nrm.z;

      const v = sliceDist / this.STRIPE_CYCLE;
      const uvIdx = i * 4;
      this.roadUvs[uvIdx] = 0;
      this.roadUvs[uvIdx + 1] = v;
      this.roadUvs[uvIdx + 2] = 1;
      this.roadUvs[uvIdx + 3] = v;

      // Shoulders
      const sIdx = i * 12;
      const sUvIdx = i * 8;

      const olX = lX - this._bin.x * shoulderW;
      const olY = lY - this._bin.y * shoulderW - 0.03;
      const olZ = lZ - this._bin.z * shoulderW;

      const orX = rX + this._bin.x * shoulderW;
      const orY = rY + this._bin.y * shoulderW - 0.03;
      const orZ = rZ + this._bin.z * shoulderW;

      this.shoulderPositions[sIdx] = olX;
      this.shoulderPositions[sIdx + 1] = olY;
      this.shoulderPositions[sIdx + 2] = olZ;

      this.shoulderPositions[sIdx + 3] = lX;
      this.shoulderPositions[sIdx + 4] = lY - 0.01;
      this.shoulderPositions[sIdx + 5] = lZ;

      this.shoulderPositions[sIdx + 6] = rX;
      this.shoulderPositions[sIdx + 7] = rY - 0.01;
      this.shoulderPositions[sIdx + 8] = rZ;

      this.shoulderPositions[sIdx + 9] = orX;
      this.shoulderPositions[sIdx + 10] = orY;
      this.shoulderPositions[sIdx + 11] = orZ;

      for (let n = 0; n < 4; n++) {
        const nOffset = sIdx + n * 3;
        this.shoulderNormals[nOffset] = this._nrm.x;
        this.shoulderNormals[nOffset + 1] = this._nrm.y;
        this.shoulderNormals[nOffset + 2] = this._nrm.z;
      }

      const sV = sliceDist * 0.2;
      this.shoulderUvs[sUvIdx] = 0;
      this.shoulderUvs[sUvIdx + 1] = sV;
      this.shoulderUvs[sUvIdx + 2] = 1;
      this.shoulderUvs[sUvIdx + 3] = sV;
      this.shoulderUvs[sUvIdx + 4] = 0;
      this.shoulderUvs[sUvIdx + 5] = sV;
      this.shoulderUvs[sUvIdx + 6] = 1;
      this.shoulderUvs[sUvIdx + 7] = sV;
    }

    (this.roadGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.roadGeo.attributes.normal as THREE.BufferAttribute).needsUpdate = true;
    (this.roadGeo.attributes.uv as THREE.BufferAttribute).needsUpdate = true;

    (this.shoulderGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.shoulderGeo.attributes.normal as THREE.BufferAttribute).needsUpdate = true;
    (this.shoulderGeo.attributes.uv as THREE.BufferAttribute).needsUpdate = true;

    // --- Dynamic Exit Ramp, Gore Wedge & Gantry Generation ---
    if (activeExit) {
      const exitMeters = activeExit.mileMarker * 1609.344;
      const rampStartDist = driveDirection === 1 ? exitMeters - 650 : exitMeters - 950;
      const rampEndDist = driveDirection === 1 ? exitMeters + 950 : exitMeters + 650;

      // Check if exit ramp is within current streaming view
      if (rampEndDist >= startDist && rampStartDist <= endDist) {
        this.exitRampMesh.visible = true;
        const rampSpan = rampEndDist - rampStartDist;

        for (let j = 0; j <= this.RAMP_SLICES; j++) {
          const frac = j / this.RAMP_SLICES;
          const rDist = rampStartDist + frac * rampSpan;
          const rT = Math.max(0, Math.min(1, rDist / totalMeters));

          const rU = curve.getUtoTmapping(rT, 0);
          curve.getPoint(rU, this._pt);
          curve.getTangent(rU, this._tan).normalize();
          if (rDist > totalMeters) {
            this._pt.addScaledVector(this._tan, rDist - totalMeters);
          } else if (rDist < 0) {
            this._pt.addScaledVector(this._tan, rDist);
          }
          this._bin.crossVectors(this._tan, this.upVector).normalize();
          this._nrm.crossVectors(this._bin, this._tan).normalize();

          const rRelX = this._pt.x - carCenter.x;
          const rRelY = this._pt.y - carCenter.y;
          const rRelZ = this._pt.z - carCenter.z;

          const signedOffsetFromExit = (rDist - exitMeters) * driveDirection;
          const slice = getExitRampGeometryAtDistance(exitMeters + signedOffsetFromExit, exitMeters);

          // Keep left-to-right vertex ordering aligned with increasing rDist so triangles stay upward-facing
          const minB = driveDirection === 1 ? slice.leftEdge : -slice.rightEdge;
          const maxB = driveDirection === 1 ? slice.rightEdge : -slice.leftEdge;

          const idx = j * 6;
          this.exitRampPositions[idx] = rRelX + this._bin.x * minB;
          this.exitRampPositions[idx + 1] = rRelY + this._nrm.y * 0.065;
          this.exitRampPositions[idx + 2] = rRelZ + this._bin.z * minB;

          this.exitRampPositions[idx + 3] = rRelX + this._bin.x * maxB;
          this.exitRampPositions[idx + 4] = rRelY + this._nrm.y * 0.065;
          this.exitRampPositions[idx + 5] = rRelZ + this._bin.z * maxB;

          this.exitRampNormals[idx] = this._nrm.x; this.exitRampNormals[idx + 1] = this._nrm.y; this.exitRampNormals[idx + 2] = this._nrm.z;
          this.exitRampNormals[idx + 3] = this._nrm.x; this.exitRampNormals[idx + 4] = this._nrm.y; this.exitRampNormals[idx + 5] = this._nrm.z;

          const v = rDist / this.STRIPE_CYCLE;
          const uvIdx = j * 4;
          this.exitRampUvs[uvIdx] = driveDirection === 1 ? 0 : 1; this.exitRampUvs[uvIdx + 1] = v;
          this.exitRampUvs[uvIdx + 2] = driveDirection === 1 ? 1 : 0; this.exitRampUvs[uvIdx + 3] = v;
        }

        (this.exitRampGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
        (this.exitRampGeo.attributes.normal as THREE.BufferAttribute).needsUpdate = true;
        (this.exitRampGeo.attributes.uv as THREE.BufferAttribute).needsUpdate = true;

        // Painted Gore Chevron Wedge at diverge [0..160m past gore in travel direction]
        const goreStart = driveDirection === 1 ? exitMeters : exitMeters - 160;
        const goreEnd = driveDirection === 1 ? exitMeters + 160 : exitMeters;
        if (goreEnd >= startDist && goreStart <= endDist) {
          this.goreMesh.visible = true;
          const goreSpan = goreEnd - goreStart;
          for (let g = 0; g <= this.GORE_SLICES; g++) {
            const gDist = goreStart + (g / this.GORE_SLICES) * goreSpan;
            const gT = Math.max(0, Math.min(1, gDist / totalMeters));
            const gU = curve.getUtoTmapping(gT, 0);
            curve.getPoint(gU, this._pt);
            curve.getTangent(gU, this._tan).normalize();
            if (gDist > totalMeters) this._pt.addScaledVector(this._tan, gDist - totalMeters);
            else if (gDist < 0) this._pt.addScaledVector(this._tan, gDist);
            this._bin.crossVectors(this._tan, this.upVector).normalize();
            this._nrm.crossVectors(this._bin, this._tan).normalize();

            const gRelX = this._pt.x - carCenter.x;
            const gRelY = this._pt.y - carCenter.y;
            const gRelZ = this._pt.z - carCenter.z;

            const signedOffsetFromExit = (gDist - exitMeters) * driveDirection;
            const slice = getExitRampGeometryAtDistance(exitMeters + signedOffsetFromExit, exitMeters);
            const goreMinB = driveDirection === 1 ? halfRoad - 0.72 : -slice.leftEdge;
            const goreMaxB = driveDirection === 1 ? slice.leftEdge : -(halfRoad - 0.72);

            const idx = g * 6;
            this.gorePositions[idx] = gRelX + this._bin.x * goreMinB;
            this.gorePositions[idx + 1] = gRelY + this._nrm.y * 0.056;
            this.gorePositions[idx + 2] = gRelZ + this._bin.z * goreMinB;

            this.gorePositions[idx + 3] = gRelX + this._bin.x * goreMaxB;
            this.gorePositions[idx + 4] = gRelY + this._nrm.y * 0.056;
            this.gorePositions[idx + 5] = gRelZ + this._bin.z * goreMaxB;

            this.goreNormals[idx] = this._nrm.x; this.goreNormals[idx + 1] = this._nrm.y; this.goreNormals[idx + 2] = this._nrm.z;
            this.goreNormals[idx + 3] = this._nrm.x; this.goreNormals[idx + 4] = this._nrm.y; this.goreNormals[idx + 5] = this._nrm.z;

            const gv = Math.abs(gDist - exitMeters) / 14.0;
            const guv = g * 4;
            this.goreUvs[guv] = 0; this.goreUvs[guv + 1] = gv;
            this.goreUvs[guv + 2] = 1; this.goreUvs[guv + 3] = gv;
          }
          (this.goreGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
          (this.goreGeo.attributes.normal as THREE.BufferAttribute).needsUpdate = true;
          (this.goreGeo.attributes.uv as THREE.BufferAttribute).needsUpdate = true;
        } else {
          this.goreMesh.visible = false;
        }

        // Position Overhead Interchange Gantry Sign at 160m before diverge (oriented toward travel direction)
        const gantryDist = exitMeters - 160 * driveDirection;
        if (gantryDist >= startDist && gantryDist <= endDist && gantryDist >= 0 && gantryDist <= totalMeters) {
          const gT = gantryDist / totalMeters;
          const gU = curve.getUtoTmapping(gT, 0);
          curve.getPoint(gU, this._pt);
          curve.getTangent(gU, this._tan).normalize().multiplyScalar(driveDirection);
          this._bin.crossVectors(this._tan, this.upVector).normalize();
          this._nrm.crossVectors(this._bin, this._tan).normalize();

          const routeMainCode = mainCode || 'I-80 WEST';
          const routeMainDest = mainDest || 'THRU TRAFFIC';
          const gantryKey = `${activeExit.id}:${routeMainCode}`;

          if (this.currentGantryKey !== gantryKey) {
            this.currentGantryKey = gantryKey;
            while (this.exitGantryGroup.children.length > 0) {
              this.exitGantryGroup.remove(this.exitGantryGroup.children[0]);
            }
            const gantrySign = createInterchangeGantrySign(
              routeMainCode,
              routeMainDest,
              activeExit.exitNumber,
              activeExit.branchHighwayCode || activeExit.highwayCode || '',
              activeExit.destinationCity || activeExit.destination || ''
            );
            this.exitGantryGroup.add(gantrySign);
          }

          this.exitGantryGroup.position.set(
            this._pt.x - carCenter.x,
            this._pt.y - carCenter.y,
            this._pt.z - carCenter.z
          );
          this._gTanNeg.copy(this._tan).negate();
          this._gRotMat.makeBasis(this._bin, this._nrm, this._gTanNeg);
          this.exitGantryGroup.quaternion.setFromRotationMatrix(this._gRotMat);
          this.exitGantryGroup.visible = true;
        } else {
          this.exitGantryGroup.visible = false;
        }
      } else {
        this.exitRampMesh.visible = false;
        this.goreMesh.visible = false;
        this.exitGantryGroup.visible = false;
      }
    } else {
      this.exitRampMesh.visible = false;
      this.goreMesh.visible = false;
      this.exitGantryGroup.visible = false;
    }

    // --- Dynamic Roadside Town/City Welcome Sign & Buildings ---
    if (activeTown && !isTurningAround) {
      const townDist = activeTown.mileMarker * 1609.344;
      if (townDist >= startDist && townDist <= endDist && townDist >= 0 && townDist <= totalMeters) {
        const tT = townDist / totalMeters;
        const tU = curve.getUtoTmapping(tT, 0);
        curve.getPoint(tU, this._pt);
        curve.getTangent(tU, this._tan).normalize().multiplyScalar(driveDirection);
        this._bin.crossVectors(this._tan, this.upVector).normalize();
        this._nrm.crossVectors(this._bin, this._tan).normalize();

        const townKey = `${activeTown.id}:${driveDirection}`;
        if (this.currentTownKey !== townKey) {
          this.currentTownKey = townKey;
          while (this.townLandmarkGroup.children.length > 0) {
            this.townLandmarkGroup.remove(this.townLandmarkGroup.children[0]);
          }
          this.townLandmarkGroup.add(createTownWelcomeCluster(activeTown));
        }

        // Shift laterally clear if an exit ramp widens on the right side near the town
        let extraLateral = 0;
        if (activeExit) {
          const exitM = activeExit.mileMarker * 1609.344;
          const signedFromExit = (townDist - exitM) * driveDirection;
          if (signedFromExit >= -650 && signedFromExit <= 950) {
            extraLateral = Math.max(0, getExitRampGeometryAtDistance(exitM + signedFromExit, exitM).rightEdge - 9.0);
          }
        }

        this.townLandmarkGroup.position.set(
          this._pt.x - carCenter.x + this._bin.x * extraLateral,
          this._pt.y - carCenter.y,
          this._pt.z - carCenter.z + this._bin.z * extraLateral
        );
        this._gTanNeg.copy(this._tan).negate();
        this._gRotMat.makeBasis(this._bin, this._nrm, this._gTanNeg);
        this.townLandmarkGroup.quaternion.setFromRotationMatrix(this._gRotMat);
        this.townLandmarkGroup.visible = true;
      } else {
        this.townLandmarkGroup.visible = false;
      }
    } else {
      this.townLandmarkGroup.visible = false;
    }

    // --- Update Roadside Delineators ---
    let delinIdx = 0;
    const firstDelinDist = Math.floor(startDist / this.DELIN_SPACING) * this.DELIN_SPACING;
    const maxDelinHalf = this.MAX_DELIN / 2;
    const activeExitMeters = activeExit ? activeExit.mileMarker * 1609.344 : -999999;

    for (let k = 0; k < maxDelinHalf; k++) {
      const dDist = firstDelinDist + k * this.DELIN_SPACING;
      if (dDist >= 0 && dDist <= totalMeters && dDist <= endDist) {
        const dT = dDist / totalMeters;
        const dU = curve.getUtoTmapping(dT, 0);
        curve.getPoint(dU, this._pt);
        curve.getTangent(dU, this._tan).normalize();
        this._bin.crossVectors(this._tan, this.upVector).normalize();

        const relDX = this._pt.x - carCenter.x;
        const relDY = this._pt.y - carCenter.y;
        const relDZ = this._pt.z - carCenter.z;

        const signedOffset = (dDist - activeExitMeters) * driveDirection;
        const inRampZone = activeExit && signedOffset >= -650 && signedOffset <= 950;
        const rampOutward = inRampZone
          ? getExitRampGeometryAtDistance(activeExitMeters + signedOffset, activeExitMeters).rightEdge + 0.9
          : halfRoad + 0.9;

        const leftPostOffset = driveDirection === -1 ? rampOutward : halfRoad + 0.9;
        const rightPostOffset = driveDirection === 1 ? rampOutward : halfRoad + 0.9;

        // -rBin delineator post
        this.dummy.position.set(
          relDX - this._bin.x * leftPostOffset,
          relDY + 0.65,
          relDZ - this._bin.z * leftPostOffset
        );
        this.dummy.scale.set(1, 1, 1);
        this.dummy.updateMatrix();
        this.delineatorMesh.setMatrixAt(delinIdx++, this.dummy.matrix);

        // +rBin delineator post
        this.dummy.position.set(
          relDX + this._bin.x * rightPostOffset,
          relDY + 0.65,
          relDZ + this._bin.z * rightPostOffset
        );
        this.dummy.scale.set(1, 1, 1);
        this.dummy.updateMatrix();
        this.delineatorMesh.setMatrixAt(delinIdx++, this.dummy.matrix);
      } else {
        this.dummy.position.set(0, -9999, 0);
        this.dummy.updateMatrix();
        this.delineatorMesh.setMatrixAt(delinIdx++, this.dummy.matrix);
        this.delineatorMesh.setMatrixAt(delinIdx++, this.dummy.matrix);
      }
    }
    this.delineatorMesh.instanceMatrix.needsUpdate = true;

    // --- Update Interstate Mile Markers ---
    const MILE_METERS = 1609.344;
    const firstMile = Math.floor(startDist / MILE_METERS);
    for (let m = 0; m < 10; m++) {
      const mDist = (firstMile + m) * MILE_METERS;
      if (mDist >= startDist && mDist <= endDist && mDist <= totalMeters) {
        const mT = mDist / totalMeters;
        const mU = curve.getUtoTmapping(mT, 0);
        curve.getPoint(mU, this._pt);
        curve.getTangent(mU, this._tan).normalize();
        this._bin.crossVectors(this._tan, this.upVector).normalize();

        const signedM = (mDist - activeExitMeters) * driveDirection;
        let markerOffset = halfRoad + 1.8;
        if (activeExit && signedM >= -650 && signedM <= 950) {
          markerOffset = getExitRampGeometryAtDistance(activeExitMeters + signedM, activeExitMeters).rightEdge + 1.8;
        }

        this.dummy.position.set(
          (this._pt.x - carCenter.x) + this._bin.x * markerOffset * driveDirection,
          (this._pt.y - carCenter.y) + 0.7,
          (this._pt.z - carCenter.z) + this._bin.z * markerOffset * driveDirection
        );
        this.dummy.quaternion.setFromAxisAngle(this.upVector, Math.atan2(this._tan.x * driveDirection, this._tan.z * driveDirection));
        this.dummy.scale.set(1, 1, 1);
        this.dummy.updateMatrix();
        this.mileMarkerMesh.setMatrixAt(m, this.dummy.matrix);
      } else {
        this.dummy.position.set(0, -9999, 0);
        this.dummy.updateMatrix();
        this.mileMarkerMesh.setMatrixAt(m, this.dummy.matrix);
      }
    }
    this.mileMarkerMesh.instanceMatrix.needsUpdate = true;

    this.cachedFrame.centerPoint.copy(this._carCenter);
    this.cachedFrame.tangent.copy(this._carTangent);
    this.cachedFrame.binormal.copy(this._carBinormal);
    this.cachedFrame.normal.copy(this._carNormal);
    return this.cachedFrame;
  }

  public dispose() {
    this.roadGeo.dispose();
    this.shoulderGeo.dispose();
    this.exitRampGeo.dispose();
    this.goreGeo.dispose();
    this.delineatorMesh.geometry.dispose();
    this.mileMarkerMesh.geometry.dispose();
  }
}
