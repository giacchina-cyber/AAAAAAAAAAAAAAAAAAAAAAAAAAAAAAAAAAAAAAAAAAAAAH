import * as THREE from 'three';

export interface CockpitNavData {
  routeId: string;
  highwayCode: string;
  routeName: string;
  waypoints: Array<{ lat: number; lon: number }>;
  exits?: Array<{ exitNumber: string; mileMarker: number }>;
  towns?: Array<{ name: string; state: string; mileMarker: number; lat: number; lon: number; type: 'city' | 'town' }>;
  progress: number; // 0..1
  currentLat: number;
  currentLon: number;
  currentMile: number;
  totalMiles: number;
  city: string;
  state: string;
  driveDirection: 1 | -1;
  destName: string;
  originName: string;
  isDetour?: boolean;
  upcomingExit?: {
    exitNumber: string;
    branchHighwayCode: string;
    destination: string;
    distanceMiles: number;
    canTakeExit: boolean;
    isTakingExit: boolean;
  } | null;
}

export interface VehicleController {
  group: THREE.Group;
  updateWheelRotation: (distanceTraveled: number, steerAngle: number) => void;
  updateCockpitDisplay: (
    speedMph: number,
    rpm: number,
    gear: string,
    isBoosting: boolean,
    nav?: CockpitNavData
  ) => void;
  setBraking: (isBraking: boolean) => void;
  setHeadlights: (on: boolean) => void;
  setBoosting: (boosting: boolean) => void;
  setFirstPersonMode: (enabled: boolean) => void;
  headlightLeft: THREE.SpotLight;
  headlightRight: THREE.SpotLight;
}

// Lower-48 US coastline outline in [0..320] x [0..170] SVG projection space (matches USMinimap.tsx)
const US_OUTLINE_COORDS: ReadonlyArray<readonly [number, number]> = [
  [12.4, 15.7], [19, 17.1], [23.1, 18.4], [24.5, 21.1], [23.9, 15], [22.4, 12],
  [56.7, 12], [118.1, 12], [163.6, 12], [163.6, 9.9], [172.5, 14.1], [182.2, 17.7],
  [192.2, 18], [179.2, 25.1], [187.9, 26.4], [200.6, 21.2], [203.2, 26.7], [218.8, 27],
  [216.9, 30.8], [207.3, 31.1], [204.5, 32.6], [200.1, 38.7], [205.5, 34.2], [201.9, 41.3],
  [200.7, 47.5], [202.1, 54.4], [203.7, 56], [208, 53], [208.1, 43], [210.1, 36.4],
  [216.8, 31.3], [223.5, 35.5], [221.3, 43.9], [226.7, 41.6], [228.7, 47.9], [225.5, 51.7],
  [223.4, 55.5], [232.3, 56.7], [240.6, 52.9], [246.7, 48.4], [245.8, 46.2], [253.3, 46.3],
  [258.9, 45], [259.7, 40.5], [267.9, 35.8], [275, 35.8], [284.5, 35.8], [286.6, 34],
  [292.2, 26.9], [296.1, 21.2], [301.9, 22.4], [303.5, 26.3], [306.1, 34.8], [307.7, 36.9],
  [301.4, 39.7], [290.9, 43.8], [289, 49.8], [286.9, 51.6], [291.2, 53.4], [292.4, 55.7],
  [285, 56.8], [282.2, 59.4], [272, 61.1], [271.8, 62.2], [271.8, 64.4], [267.1, 72],
  [264, 69.2], [266.3, 74.9], [261.6, 82.8], [259.9, 78.1], [261.6, 84.2], [263.9, 93.9],
  [258.8, 97.5], [251.5, 102.3], [241.6, 108.8], [236.7, 113.1], [233.9, 118.4], [233.9, 123.1],
  [235.9, 130], [238.4, 134.5], [240.9, 144.9], [240.1, 150.4], [238.7, 154.1], [235.4, 154.1],
  [231.8, 148.2], [226.8, 138.5], [227, 131.5], [218.8, 125.5], [213.7, 127.1], [204.5, 123],
  [199.9, 123.7], [193, 124], [194.1, 130.9], [186.8, 130.6], [178.1, 127.9], [170.2, 126.7],
  [165.4, 129.4], [157.4, 134.8], [153.6, 138.3], [153.4, 148.8], [147.7, 148.8], [141.3, 140.1],
  [134.2, 129], [129.3, 126.4], [121.9, 131.2], [116.5, 127.9], [105.6, 114.7], [96.8, 114.6],
  [96.8, 117.3], [92.5, 117.3], [82.3, 117.3], [63.2, 110.4], [51.3, 110.1], [45.6, 102.9],
  [37.3, 98.9], [34.1, 98.7], [31.9, 92.7], [26.7, 85.8], [23.7, 78.9], [17.5, 71.9],
  [14, 63], [15.1, 55.2], [13.2, 48.6], [15.8, 38], [15.8, 28.4], [14.3, 20.9],
];

/**
 * Creates a stylish, procedural 3D vehicle avatar composed of 10+ distinct parts:
 * - Aerodynamic muscle cruiser chassis
 * - Sleek cabin greenhouse with tinted glass
 * - Front chrome bumper & hood scoop
 * - Front & rear wheels with distinct alloy rims and rubber tires
 * - Front dual headlights with real SpotLights illuminating the highway ribbon
 * - Rear LED tail bar with dynamic brake brightening
 * - Dual exhaust tips with animated boost glow
 */
export function createVehicleModel(): VehicleController {
  const group = new THREE.Group();
  group.name = 'PlayerVehicle';

  // Materials (lightweight PBR MeshStandardMaterial avoids extra full-scene transmission render pass)
  const bodyPaintMat = new THREE.MeshStandardMaterial({
    color: 0x1e3a8a, // Deep Metallic Royal Blue
    roughness: 0.16,
    metalness: 0.82,
  });

  const chromeMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    roughness: 0.12,
    metalness: 0.92,
  });

  const darkTrimMat = new THREE.MeshStandardMaterial({
    color: 0x111827,
    roughness: 0.7,
    metalness: 0.2,
  });

  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.08,
    metalness: 0.75,
    transparent: true,
    opacity: 0.88,
  });

  const tireMat = new THREE.MeshStandardMaterial({
    color: 0x1f242b,
    roughness: 0.85,
    metalness: 0.05,
  });

  const rimMat = new THREE.MeshStandardMaterial({
    color: 0xd1d5db,
    roughness: 0.25,
    metalness: 0.85,
  });

  const headlightLensMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xffffff,
    emissiveIntensity: 1.5,
    roughness: 0.1,
  });

  const taillightMat = new THREE.MeshStandardMaterial({
    color: 0x991b1b,
    emissive: 0xef4444,
    emissiveIntensity: 0.8,
    roughness: 0.2,
  });

  // 1. Lower Chassis & Floorpan
  const lowerChassisGeo = new THREE.BoxGeometry(2.1, 0.45, 4.4);
  const lowerChassis = new THREE.Mesh(lowerChassisGeo, darkTrimMat);
  lowerChassis.position.set(0, 0.45, 0);
  lowerChassis.castShadow = true;
  group.add(lowerChassis);

  // 2. Main Body Shell (Sleek aerodynamic contours)
  const mainBodyGeo = new THREE.BoxGeometry(2.0, 0.55, 4.2);
  const mainBody = new THREE.Mesh(mainBodyGeo, bodyPaintMat);
  mainBody.position.set(0, 0.75, 0.05);
  mainBody.castShadow = true;
  group.add(mainBody);

  // Front hood scoop / nose cone
  const noseGeo = new THREE.BoxGeometry(1.9, 0.35, 1.2);
  const nose = new THREE.Mesh(noseGeo, bodyPaintMat);
  nose.position.set(0, 0.7, -1.6);
  nose.rotation.x = 0.06;
  nose.castShadow = true;
  group.add(nose);

  // 3. Cabin Greenhouse (Roof & Pillars)
  const cabinGeo = new THREE.BoxGeometry(1.65, 0.65, 2.1);
  const cabin = new THREE.Mesh(cabinGeo, glassMat);
  cabin.position.set(0, 1.22, 0.15);
  cabin.castShadow = true;
  group.add(cabin);

  // Roof cap
  const roofGeo = new THREE.BoxGeometry(1.6, 0.12, 1.8);
  const roof = new THREE.Mesh(roofGeo, bodyPaintMat);
  roof.position.set(0, 1.55, 0.15);
  roof.castShadow = true;
  group.add(roof);

  // 3b. Side Mirrors & Hood Power Bulge (visible in both exterior & steering-wheel view)
  const mirrorGeo = new THREE.BoxGeometry(0.18, 0.1, 0.14);
  const leftMirror = new THREE.Mesh(mirrorGeo, bodyPaintMat);
  leftMirror.position.set(-1.05, 1.04, -0.68);
  group.add(leftMirror);

  const rightMirror = new THREE.Mesh(mirrorGeo, bodyPaintMat);
  rightMirror.position.set(1.05, 1.04, -0.68);
  group.add(rightMirror);

  const hoodScoopGeo = new THREE.BoxGeometry(0.55, 0.05, 0.95);
  const hoodScoop = new THREE.Mesh(hoodScoopGeo, darkTrimMat);
  hoodScoop.position.set(0, 1.035, -1.25);
  group.add(hoodScoop);

  // 3c. Driver Cockpit Interior & Animated Steering Wheel (shown in steering-wheel driver mode)
  const cockpitGroup = new THREE.Group();
  cockpitGroup.visible = false;
  group.add(cockpitGroup);

  const interiorTrimMat = new THREE.MeshStandardMaterial({
    color: 0x202836,
    roughness: 0.72,
    metalness: 0.14,
  });

  const lowerDashMat = new THREE.MeshStandardMaterial({
    color: 0x151b26,
    roughness: 0.84,
    metalness: 0.08,
  });

  const doorPanelMat = new THREE.MeshStandardMaterial({
    color: 0x242d3d,
    roughness: 0.68,
    metalness: 0.16,
  });

  const leatherMat = new THREE.MeshStandardMaterial({
    color: 0x121822,
    roughness: 0.58,
    metalness: 0.12,
  });

  const headlinerMat = new THREE.MeshStandardMaterial({
    color: 0x1a212e,
    roughness: 0.92,
    metalness: 0.04,
  });

  const satinAlumMat = new THREE.MeshStandardMaterial({
    color: 0xcbd5e1,
    roughness: 0.22,
    metalness: 0.85,
  });

  const wheelMarkerMat = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    emissive: 0xd97706,
    emissiveIntensity: 0.4,
    roughness: 0.38,
  });

  // Procedural Live Digital Gauge Cluster CanvasTexture (512x192 crisp backlit display)
  const clusterCanvas = document.createElement('canvas');
  clusterCanvas.width = 512;
  clusterCanvas.height = 192;
  const cCtx = clusterCanvas.getContext('2d')!;
  const clusterTex = new THREE.CanvasTexture(clusterCanvas);
  clusterTex.colorSpace = THREE.SRGBColorSpace;
  const clusterScreenMat = new THREE.MeshBasicMaterial({ map: clusterTex, toneMapped: false });

  let lastDispMph = -1;
  let lastDispGear = '';
  let lastDispRpmBucket = -1;
  let lastDispBoost = false;

  const drawGaugeCluster = (speedMph: number, rpm: number, gear: string, isBoosting: boolean) => {
    const intMph = Math.max(0, Math.round(speedMph));
    const rpmClamped = Math.max(800, Math.min(8000, rpm));
    const rpmBucket = Math.round(rpmClamped / 250);
    if (intMph === lastDispMph && gear === lastDispGear && rpmBucket === lastDispRpmBucket && isBoosting === lastDispBoost) {
      return;
    }
    lastDispMph = intMph;
    lastDispGear = gear;
    lastDispRpmBucket = rpmBucket;
    lastDispBoost = isBoosting;

    cCtx.fillStyle = '#050b16';
    cCtx.fillRect(0, 0, 512, 192);

    // Outer frame glow
    cCtx.strokeStyle = isBoosting ? '#38bdf8' : '#1e3a5f';
    cCtx.lineWidth = 4;
    cCtx.strokeRect(4, 4, 504, 184);

    // Left RPM gauge track + active sweep
    const rpmRatio = (rpmClamped - 800) / 7200;
    cCtx.beginPath();
    cCtx.arc(106, 98, 58, Math.PI * 0.78, Math.PI * 2.22);
    cCtx.strokeStyle = '#1e293b';
    cCtx.lineWidth = 12;
    cCtx.stroke();

    cCtx.beginPath();
    cCtx.arc(106, 98, 58, Math.PI * 0.78, Math.PI * (0.78 + 1.44 * rpmRatio));
    cCtx.strokeStyle = rpmRatio > 0.8 ? '#ef4444' : '#f59e0b';
    cCtx.lineWidth = 12;
    cCtx.stroke();

    cCtx.fillStyle = '#f8fafc';
    cCtx.font = 'bold 25px monospace';
    cCtx.textAlign = 'center';
    cCtx.fillText(`${(rpmClamped / 1000).toFixed(1)}k`, 106, 104);
    cCtx.fillStyle = '#94a3b8';
    cCtx.font = 'bold 14px monospace';
    cCtx.fillText('RPM', 106, 128);

    // Center Gear & Mode Readout
    cCtx.fillStyle = '#0b162b';
    cCtx.fillRect(194, 24, 124, 132);
    cCtx.strokeStyle = isBoosting ? '#38bdf8' : '#334155';
    cCtx.lineWidth = 2.5;
    cCtx.strokeRect(194, 24, 124, 132);

    cCtx.fillStyle = isBoosting ? '#38bdf8' : '#34d399';
    cCtx.font = 'bold 42px monospace';
    cCtx.fillText(gear, 256, 78);
    cCtx.fillStyle = isBoosting ? '#38bdf8' : '#94a3b8';
    cCtx.font = 'bold 16px monospace';
    cCtx.fillText(isBoosting ? 'NITRO' : 'DRIVE', 256, 110);
    cCtx.fillStyle = '#38bdf8';
    cCtx.font = 'bold 13px monospace';
    cCtx.fillText('CRUISE OS', 256, 138);

    // Right Speedometer gauge track + active sweep
    const speedRatio = Math.min(1, intMph / 280);
    cCtx.beginPath();
    cCtx.arc(406, 98, 58, Math.PI * 0.78, Math.PI * 2.22);
    cCtx.strokeStyle = '#1e293b';
    cCtx.lineWidth = 12;
    cCtx.stroke();

    if (speedRatio > 0.005) {
      cCtx.beginPath();
      cCtx.arc(406, 98, 58, Math.PI * 0.78, Math.PI * (0.78 + 1.44 * speedRatio));
      cCtx.strokeStyle = isBoosting ? '#38bdf8' : '#22d3ee';
      cCtx.lineWidth = 12;
      cCtx.stroke();
    }

    cCtx.fillStyle = '#ffffff';
    cCtx.font = 'bold 34px monospace';
    cCtx.fillText(String(intMph), 406, 105);
    cCtx.fillStyle = '#38bdf8';
    cCtx.font = 'bold 14px monospace';
    cCtx.fillText('MPH', 406, 130);

    clusterTex.needsUpdate = true;
  };
  drawGaugeCluster(0, 800, 'N', false);

  // Procedural Live Center Infotainment GPS Navigation Map CanvasTexture (512x264)
  const infoCanvas = document.createElement('canvas');
  infoCanvas.width = 512;
  infoCanvas.height = 264;
  const iCtx = infoCanvas.getContext('2d')!;
  const infoTex = new THREE.CanvasTexture(infoCanvas);
  infoTex.colorSpace = THREE.SRGBColorSpace;
  const infoScreenMat = new THREE.MeshBasicMaterial({ map: infoTex, toneMapped: false });

  let lastNavKey = '';
  const drawNavDisplay = (nav?: CockpitNavData) => {
    const exit = nav?.upcomingExit;
    const navKey = nav
      ? `${nav.routeId}|${Math.round(nav.currentMile * 10)}|${nav.city}|${nav.state}|${nav.driveDirection}|${exit?.exitNumber ?? ''}|${exit ? Math.round(exit.distanceMiles * 10) : -1}|${!!exit?.canTakeExit}|${!!exit?.isTakingExit}|${!!nav.isDetour}`
      : 'INIT';
    if (navKey === lastNavKey) return;
    lastNavKey = navKey;

    const W = 512;
    const H = 264;
    iCtx.fillStyle = '#060f1d';
    iCtx.fillRect(0, 0, W, H);

    // Subtle radar grid inside map viewport (y = 38..190)
    iCtx.strokeStyle = '#11223a';
    iCtx.lineWidth = 1;
    for (let gx = 48; gx < W; gx += 64) {
      iCtx.beginPath(); iCtx.moveTo(gx, 38); iCtx.lineTo(gx, 190); iCtx.stroke();
    }
    for (let gy = 64; gy < 190; gy += 42) {
      iCtx.beginPath(); iCtx.moveTo(0, gy); iCtx.lineTo(W, gy); iCtx.stroke();
    }

    // Helper: project GPS lat/lon -> SVG [320x170] -> InfoCanvas Map Region [18..494, 42..186]
    const svgToMapX = (sx: number) => 20 + (sx / 320) * 472;
    const svgToMapY = (sy: number) => 42 + (sy / 170) * 144;
    const gpsToMap = (lat: number, lon: number): [number, number] => {
      const sx = ((lon - (-124.8)) / (-66.9 - (-124.8))) * (320 - 24) + 12;
      const sy = ((49.0 - lat) / (49.0 - 24.5)) * (170 - 24) + 12;
      return [svgToMapX(sx), svgToMapY(sy)];
    };

    // Draw Continental US Silhouette
    iCtx.beginPath();
    US_OUTLINE_COORDS.forEach(([sx, sy], idx) => {
      const mx = svgToMapX(sx);
      const my = svgToMapY(sy);
      if (idx === 0) iCtx.moveTo(mx, my);
      else iCtx.lineTo(mx, my);
    });
    iCtx.closePath();
    iCtx.fillStyle = '#16243a';
    iCtx.fill();
    iCtx.strokeStyle = '#334155';
    iCtx.lineWidth = 2;
    iCtx.stroke();

    if (nav && nav.waypoints.length >= 2) {
      // Full remaining route polyline
      iCtx.beginPath();
      nav.waypoints.forEach((wp, idx) => {
        const [mx, my] = gpsToMap(wp.lat, wp.lon);
        if (idx === 0) iCtx.moveTo(mx, my);
        else iCtx.lineTo(mx, my);
      });
      iCtx.strokeStyle = '#38bdf8';
      iCtx.lineWidth = 4;
      iCtx.lineJoin = 'round';
      iCtx.lineCap = 'round';
      iCtx.stroke();

      // Highlight active progress up to player GPS marker in glowing amber
      const maxIdx = Math.min(nav.waypoints.length - 1, Math.floor(nav.progress * (nav.waypoints.length - 1)));
      const [carX, carY] = gpsToMap(nav.currentLat, nav.currentLon);
      iCtx.beginPath();
      for (let k = 0; k <= maxIdx; k++) {
        const [mx, my] = gpsToMap(nav.waypoints[k].lat, nav.waypoints[k].lon);
        if (k === 0) iCtx.moveTo(mx, my);
        else iCtx.lineTo(mx, my);
      }
      iCtx.lineTo(carX, carY);
      iCtx.strokeStyle = '#f59e0b';
      iCtx.lineWidth = 5;
      iCtx.stroke();

      // Origin & Destination pins
      const [oX, oY] = gpsToMap(nav.waypoints[0].lat, nav.waypoints[0].lon);
      const lastWp = nav.waypoints[nav.waypoints.length - 1];
      const [dX, dY] = gpsToMap(lastWp.lat, lastWp.lon);
      iCtx.fillStyle = '#22c55e';
      iCtx.beginPath(); iCtx.arc(oX, oY, 5, 0, Math.PI * 2); iCtx.fill();
      iCtx.fillStyle = '#ef4444';
      iCtx.beginPath(); iCtx.arc(dX, dY, 5, 0, Math.PI * 2); iCtx.fill();

      // Highway Exit pins along route corridor
      if (nav.exits && nav.totalMiles > 0) {
        const wps = nav.waypoints;
        for (let ei = 0; ei < nav.exits.length; ei++) {
          const ex = nav.exits[ei];
          const frac = Math.max(0, Math.min(1, ex.mileMarker / nav.totalMiles));
          const sIdx = frac * (wps.length - 1);
          const w0 = Math.min(wps.length - 1, Math.floor(sIdx));
          const w1 = Math.min(wps.length - 1, w0 + 1);
          const lt = wps[w0].lat + (wps[w1].lat - wps[w0].lat) * (sIdx - w0);
          const ln = wps[w0].lon + (wps[w1].lon - wps[w0].lon) * (sIdx - w0);
          const [exX, exY] = gpsToMap(lt, ln);
          const isNext = exit?.exitNumber === ex.exitNumber;
          iCtx.fillStyle = isNext ? '#fde047' : '#10b981';
          const sz = isNext ? 5 : 3.5;
          iCtx.beginPath();
          iCtx.moveTo(exX, exY - sz);
          iCtx.lineTo(exX + sz, exY);
          iCtx.lineTo(exX, exY + sz);
          iCtx.lineTo(exX - sz, exY);
          iCtx.closePath();
          iCtx.fill();
        }
      }

      // Towns & Cities along active route
      if (nav.towns && nav.towns.length > 0) {
        let nextTown: (typeof nav.towns)[number] | null = null;
        let minAhead = Infinity;
        for (let ti = 0; ti < nav.towns.length; ti++) {
          const t = nav.towns[ti];
          const [tx, ty] = gpsToMap(t.lat, t.lon);
          const isCity = t.type === 'city';
          iCtx.fillStyle = isCity ? '#fef08a' : '#e2e8f0';
          iCtx.strokeStyle = '#0f172a';
          iCtx.lineWidth = 1.5;
          iCtx.beginPath();
          iCtx.arc(tx, ty, isCity ? 4.2 : 2.8, 0, Math.PI * 2);
          iCtx.fill();
          iCtx.stroke();

          const ahead = (t.mileMarker - nav.currentMile) * nav.driveDirection;
          if (ahead >= -0.25 && ahead < minAhead) {
            minAhead = ahead;
            nextTown = t;
          }
        }
        if (nextTown) {
          const [ntx, nty] = gpsToMap(nextTown.lat, nextTown.lon);
          iCtx.strokeStyle = '#fb923c';
          iCtx.lineWidth = 1.6;
          iCtx.beginPath();
          iCtx.arc(ntx, nty, 7, 0, Math.PI * 2);
          iCtx.stroke();
          iCtx.font = 'bold 11px sans-serif';
          iCtx.fillStyle = '#fed7aa';
          iCtx.textAlign = ntx > W * 0.72 ? 'right' : 'left';
          iCtx.fillText(nextTown.name, ntx + (ntx > W * 0.72 ? -9 : 9), Math.max(54, nty - 4));
          iCtx.textAlign = 'left';
        }
      }

      // Glowing Player Vehicle GPS Beacon
      iCtx.fillStyle = 'rgba(56, 189, 248, 0.35)';
      iCtx.beginPath(); iCtx.arc(carX, carY, 13, 0, Math.PI * 2); iCtx.fill();
      iCtx.fillStyle = '#38bdf8';
      iCtx.beginPath(); iCtx.arc(carX, carY, 7, 0, Math.PI * 2); iCtx.fill();
      iCtx.strokeStyle = '#ffffff';
      iCtx.lineWidth = 2.5;
      iCtx.stroke();

      // Top-Right City/State Location Overlay Pill inside Map
      const locText = `${nav.city}, ${nav.state}`;
      iCtx.font = 'bold 14px sans-serif';
      const locW = Math.min(230, iCtx.measureText(locText).width + 20);
      iCtx.fillStyle = 'rgba(6, 15, 29, 0.86)';
      iCtx.fillRect(W - locW - 10, 44, locW, 24);
      iCtx.strokeStyle = '#334155';
      iCtx.lineWidth = 1.5;
      iCtx.strokeRect(W - locW - 10, 44, locW, 24);
      iCtx.fillStyle = '#f8fafc';
      iCtx.textAlign = 'right';
      iCtx.fillText(locText, W - 18, 61);
      iCtx.textAlign = 'left';
    }

    // Top Nav Header Strip (0..38)
    iCtx.fillStyle = '#0f172a';
    iCtx.fillRect(0, 0, W, 38);
    iCtx.fillStyle = '#1e293b';
    iCtx.fillRect(0, 37, W, 2);

    const code = nav ? nav.highwayCode : 'INTERSTATE GPS';
    iCtx.fillStyle = '#f59e0b';
    iCtx.fillRect(8, 6, 118, 26);
    iCtx.fillStyle = '#090d16';
    iCtx.font = 'bold 15px monospace';
    iCtx.textAlign = 'center';
    iCtx.fillText(code.slice(0, 12), 67, 24);

    iCtx.textAlign = 'left';
    iCtx.fillStyle = '#e2e8f0';
    iCtx.font = 'bold 14px sans-serif';
    const dirLabel = nav?.driveDirection === -1 ? 'REV' : 'FWD';
    const routeTitle = nav ? nav.routeName : 'Live Interstate Route';
    iCtx.fillText(routeTitle.slice(0, 22), 136, 24);

    iCtx.textAlign = 'right';
    iCtx.fillStyle = nav?.driveDirection === -1 ? '#f43f5e' : '#38bdf8';
    iCtx.font = 'bold 14px monospace';
    const mileStr = nav ? `${dirLabel} • MI ${Math.round(nav.currentMile)}/${Math.round(nav.totalMiles)}` : 'GPS READY';
    iCtx.fillText(mileStr, W - 10, 24);

    // Bottom Turn-by-Turn Next Exit / Destination Strip (190..264)
    if (exit) {
      iCtx.fillStyle = exit.isTakingExit ? '#064e3b' : '#063d2c';
      iCtx.fillRect(0, 190, W, 74);
      iCtx.fillStyle = exit.canTakeExit ? '#34d399' : '#10b981';
      iCtx.fillRect(0, 190, W, 3);

      // Exit badge
      iCtx.fillStyle = '#f59e0b';
      iCtx.fillRect(10, 202, 108, 48);
      iCtx.fillStyle = '#090d16';
      iCtx.textAlign = 'center';
      iCtx.font = 'bold 12px monospace';
      iCtx.fillText('NEXT EXIT', 64, 219);
      iCtx.font = 'bold 21px monospace';
      iCtx.fillText(`#${exit.exitNumber}`, 64, 243);

      // Branch route + destination
      iCtx.textAlign = 'left';
      iCtx.fillStyle = '#ffffff';
      iCtx.font = 'bold 19px sans-serif';
      const title = `${exit.branchHighwayCode} → ${exit.destination}`;
      iCtx.fillText(title.slice(0, 25), 130, 224);

      iCtx.fillStyle = exit.canTakeExit ? '#fde047' : '#a7f3d0';
      iCtx.font = 'bold 14px monospace';
      const prompt = exit.isTakingExit
        ? 'EXITING ONTO RAMP...'
        : exit.canTakeExit
        ? 'MERGE RIGHT OR PRESS [E]'
        : `APPROACHING INTERCHANGE`;
      iCtx.fillText(prompt, 130, 248);

      // Distance countdown
      iCtx.textAlign = 'right';
      iCtx.fillStyle = '#ffffff';
      iCtx.font = 'bold 26px monospace';
      iCtx.fillText(`${exit.distanceMiles.toFixed(1)}`, W - 12, 226);
      iCtx.fillStyle = '#6ee7b7';
      iCtx.font = 'bold 13px monospace';
      iCtx.fillText('MILES', W - 12, 247);
    } else {
      iCtx.fillStyle = '#0f172a';
      iCtx.fillRect(0, 190, W, 74);
      iCtx.fillStyle = nav?.isDetour ? '#a855f7' : '#38bdf8';
      iCtx.fillRect(0, 190, W, 3);

      iCtx.textAlign = 'left';
      iCtx.fillStyle = nav?.isDetour ? '#d8b4fe' : '#38bdf8';
      iCtx.font = 'bold 13px monospace';
      const sub = nav?.isDetour ? 'DETOUR ACTIVE • PRESS [R] TO REJOIN' : 'FOLLOW ACTIVE INTERSTATE CORRIDOR';
      iCtx.fillText(sub, 14, 214);

      iCtx.fillStyle = '#ffffff';
      iCtx.font = 'bold 20px sans-serif';
      const targetName = nav
        ? nav.driveDirection === -1
          ? `TO: ${nav.originName}`
          : `TO: ${nav.destName}`
        : 'NAV ACTIVE • 68°F';
      iCtx.fillText(targetName.slice(0, 28), 14, 244);

      if (nav) {
        const remMiles = Math.max(
          0,
          Math.round(nav.driveDirection === -1 ? nav.currentMile : nav.totalMiles - nav.currentMile)
        );
        iCtx.textAlign = 'right';
        iCtx.fillStyle = '#f59e0b';
        iCtx.font = 'bold 22px monospace';
        iCtx.fillText(`${remMiles} MI`, W - 14, 232);
        iCtx.fillStyle = '#94a3b8';
        iCtx.font = 'bold 12px monospace';
        iCtx.fillText('REMAINING', W - 14, 250);
      }
    }
    iCtx.textAlign = 'left';
    infoTex.needsUpdate = true;
  };
  drawNavDisplay();

  // First-person exterior hood shell (replaces mainBody in driver view so the cabin cavity is hollow)
  const fpHood = new THREE.Mesh(new THREE.BoxGeometry(1.98, 0.48, 1.24), bodyPaintMat);
  fpHood.position.set(0, 0.77, -1.44);
  cockpitGroup.add(fpHood);

  // Sculpted interior cabin floorpan liner & side door cards
  const cabinFloor = new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.04, 1.22), lowerDashMat);
  cabinFloor.position.set(0, 0.68, -0.26);
  cockpitGroup.add(cabinFloor);

  const doorGeo = new THREE.BoxGeometry(0.10, 0.46, 1.28);
  const leftDoor = new THREE.Mesh(doorGeo, doorPanelMat);
  leftDoor.position.set(-0.92, 0.89, -0.26);
  cockpitGroup.add(leftDoor);

  const rightDoor = new THREE.Mesh(doorGeo, doorPanelMat);
  rightDoor.position.set(0.92, 0.89, -0.26);
  cockpitGroup.add(rightDoor);

  const doorTrimGeo = new THREE.BoxGeometry(0.03, 0.028, 1.05);
  const leftDoorTrim = new THREE.Mesh(doorTrimGeo, satinAlumMat);
  leftDoorTrim.position.set(-0.865, 1.03, -0.32);
  cockpitGroup.add(leftDoorTrim);

  const rightDoorTrim = new THREE.Mesh(doorTrimGeo, satinAlumMat);
  rightDoorTrim.position.set(0.865, 1.03, -0.32);
  cockpitGroup.add(rightDoorTrim);

  const armrestGeo = new THREE.BoxGeometry(0.10, 0.08, 0.65);
  const leftArmrest = new THREE.Mesh(armrestGeo, leatherMat);
  leftArmrest.position.set(-0.84, 0.88, -0.24);
  cockpitGroup.add(leftArmrest);

  const rightArmrest = new THREE.Mesh(armrestGeo, leatherMat);
  rightArmrest.position.set(0.84, 0.88, -0.24);
  cockpitGroup.add(rightArmrest);

  // Static interior headliner roof extending back behind driver eye (Z = +0.34 to -0.88)
  const interiorRoof = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.10, 1.22), headlinerMat);
  interiorRoof.position.set(0, 1.62, -0.27);
  cockpitGroup.add(interiorRoof);

  // Windshield top visor trim, sun visors & central rearview mirror
  const headerLip = new THREE.Mesh(new THREE.BoxGeometry(1.70, 0.045, 0.08), leatherMat);
  headerLip.position.set(0, 1.565, -0.87);
  cockpitGroup.add(headerLip);

  const visorGeo = new THREE.BoxGeometry(0.42, 0.025, 0.14);
  const leftVisor = new THREE.Mesh(visorGeo, headlinerMat);
  leftVisor.position.set(-0.42, 1.555, -0.76);
  leftVisor.rotation.x = 0.08;
  cockpitGroup.add(leftVisor);

  const rightVisor = new THREE.Mesh(visorGeo, headlinerMat);
  rightVisor.position.set(0.42, 1.555, -0.76);
  rightVisor.rotation.x = 0.08;
  cockpitGroup.add(rightVisor);

  const mirrorStem = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.06, 0.03), leatherMat);
  mirrorStem.position.set(0.05, 1.535, -0.84);
  cockpitGroup.add(mirrorStem);

  const rearViewMirror = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.055, 0.035), interiorTrimMat);
  rearViewMirror.position.set(0.05, 1.49, -0.82);
  cockpitGroup.add(rearViewMirror);

  // Left & Right A-pillars connecting dashboard edges up to roof header
  const aPillarGeo = new THREE.BoxGeometry(0.065, 0.62, 0.08);
  const leftAPillar = new THREE.Mesh(aPillarGeo, headlinerMat);
  leftAPillar.position.set(-0.84, 1.30, -0.89);
  leftAPillar.rotation.x = 0.22;
  cockpitGroup.add(leftAPillar);

  const rightAPillar = new THREE.Mesh(aPillarGeo, headlinerMat);
  rightAPillar.position.set(0.84, 1.30, -0.89);
  rightAPillar.rotation.x = 0.22;
  cockpitGroup.add(rightAPillar);

  // Multi-Tier Sculpted Dashboard (recessed forward at Z = -0.78..-1.04 so displays & vents mount proudly without clipping)
  const upperDashDeck = new THREE.Mesh(new THREE.BoxGeometry(1.74, 0.075, 0.26), interiorTrimMat);
  upperDashDeck.position.set(0, 1.075, -0.91);
  cockpitGroup.add(upperDashDeck);

  const dashTrimRibbon = new THREE.Mesh(new THREE.BoxGeometry(1.70, 0.016, 0.016), satinAlumMat);
  dashTrimRibbon.position.set(0, 1.032, -0.771);
  cockpitGroup.add(dashTrimRibbon);

  const lowerDashBulkhead = new THREE.Mesh(new THREE.BoxGeometry(1.74, 0.30, 0.14), lowerDashMat);
  lowerDashBulkhead.position.set(0, 0.89, -0.86);
  cockpitGroup.add(lowerDashBulkhead);

  // Driver Instrument Cluster shifted left of steering wheel (-0.645) and angled slightly toward driver for 100% visibility
  const clusterGroup = new THREE.Group();
  clusterGroup.position.set(-0.645, 1.160, -0.742);
  clusterGroup.rotation.y = 0.24;
  cockpitGroup.add(clusterGroup);

  const clusterBackPlate = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.114, 0.02), leatherMat);
  clusterBackPlate.position.set(0, 0, -0.016);
  clusterGroup.add(clusterBackPlate);

  const clusterTopHood = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.018, 0.075), leatherMat);
  clusterTopHood.position.set(0, 0.060, 0.012);
  clusterGroup.add(clusterTopHood);

  const clusterSideGeo = new THREE.BoxGeometry(0.022, 0.114, 0.065);
  const clusterLeftCheek = new THREE.Mesh(clusterSideGeo, leatherMat);
  clusterLeftCheek.position.set(-0.140, 0, 0.010);
  clusterGroup.add(clusterLeftCheek);

  const clusterRightCheek = new THREE.Mesh(clusterSideGeo, leatherMat);
  clusterRightCheek.position.set(0.140, 0, 0.010);
  clusterGroup.add(clusterRightCheek);

  const clusterScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.246, 0.092), clusterScreenMat);
  clusterScreen.position.set(0, 0, 0.002);
  clusterGroup.add(clusterScreen);

  // Center Infotainment GPS Nav Display (flush/un-angled parallel to dash so it never clips)
  const infoGroup = new THREE.Group();
  infoGroup.position.set(0.11, 1.08, -0.740);
  cockpitGroup.add(infoGroup);

  const infoMountNeck = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.07, 0.040), lowerDashMat);
  infoMountNeck.position.set(0, 0, -0.028);
  infoGroup.add(infoMountNeck);

  const infoBezel = new THREE.Mesh(new THREE.BoxGeometry(0.37, 0.20, 0.022), leatherMat);
  infoGroup.add(infoBezel);
  const infoScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.175), infoScreenMat);
  infoScreen.position.z = 0.013;
  infoGroup.add(infoScreen);

  // Air Conditioning Vents (spaced clear of left-mounted cluster & center infotainment screen)
  const ventGeo = new THREE.BoxGeometry(0.095, 0.044, 0.016);
  [-0.44, 0.42, 0.68].forEach((vx) => {
    const vent = new THREE.Mesh(ventGeo, lowerDashMat);
    vent.position.set(vx, 1.072, -0.771);
    cockpitGroup.add(vent);
    const louver = new THREE.Mesh(new THREE.BoxGeometry(0.082, 0.008, 0.018), satinAlumMat);
    louver.position.set(vx, 1.072, -0.761);
    cockpitGroup.add(louver);
  });

  // Center Console Tunnel, Chrome Rails & Sport Gear Shifter
  const centerTunnel = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.24, 0.96), lowerDashMat);
  centerTunnel.position.set(0.06, 0.78, -0.36);
  cockpitGroup.add(centerTunnel);

  const consoleTopTrim = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.02, 0.72), interiorTrimMat);
  consoleTopTrim.position.set(0.06, 0.905, -0.40);
  cockpitGroup.add(consoleTopTrim);

  const shifterBoot = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.045, 0.065, 12), leatherMat);
  shifterBoot.position.set(0.04, 0.945, -0.52);
  cockpitGroup.add(shifterBoot);

  const shifterKnob = new THREE.Mesh(new THREE.SphereGeometry(0.030, 12, 10), satinAlumMat);
  shifterKnob.position.set(0.04, 0.985, -0.52);
  cockpitGroup.add(shifterKnob);

  // Steering Column Shroud & Control Stalks
  const columnGeo = new THREE.CylinderGeometry(0.036, 0.044, 0.26, 12);
  columnGeo.rotateX(Math.PI / 2 - 0.26);
  const steeringColumn = new THREE.Mesh(columnGeo, lowerDashMat);
  steeringColumn.position.set(-0.34, 1.10, -0.72);
  cockpitGroup.add(steeringColumn);

  const leftStalk = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.012, 0.014), leatherMat);
  leftStalk.position.set(-0.41, 1.125, -0.66);
  leftStalk.rotation.z = 0.16;
  cockpitGroup.add(leftStalk);

  const rightStalk = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.012, 0.014), leatherMat);
  rightStalk.position.set(-0.27, 1.125, -0.66);
  rightStalk.rotation.z = -0.16;
  cockpitGroup.add(rightStalk);

  // Steering Wheel Pivot Group (full 360° rim unobstructed, rotates smoothly with A/D steering)
  const steeringWheelTiltGroup = new THREE.Group();
  steeringWheelTiltGroup.position.set(-0.34, 1.13, -0.61);
  steeringWheelTiltGroup.rotation.x = 0.26;
  cockpitGroup.add(steeringWheelTiltGroup);

  const steeringWheelSpinGroup = new THREE.Group();
  steeringWheelTiltGroup.add(steeringWheelSpinGroup);

  // Contoured outer leather wheel rim (0.112m radius)
  const wheelRim = new THREE.Mesh(new THREE.TorusGeometry(0.112, 0.0155, 12, 32), leatherMat);
  steeringWheelSpinGroup.add(wheelRim);

  // 12-o'clock top centering marker stripe
  const topStripe = new THREE.Mesh(new THREE.BoxGeometry(0.020, 0.032, 0.034), wheelMarkerMat);
  topStripe.position.set(0, 0.112, 0);
  steeringWheelSpinGroup.add(topStripe);

  // Sculpted airbag hub + brushed aluminum 3-spokes
  const hubMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.038, 0.026, 16), leatherMat);
  hubMesh.rotation.x = Math.PI / 2;
  steeringWheelSpinGroup.add(hubMesh);

  const hubEmblem = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.030, 12), satinAlumMat);
  hubEmblem.rotation.x = Math.PI / 2;
  steeringWheelSpinGroup.add(hubEmblem);

  const sideSpokes = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.018, 0.014), satinAlumMat);
  sideSpokes.position.set(0, -0.008, -0.004);
  steeringWheelSpinGroup.add(sideSpokes);

  const bottomSpoke = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.095, 0.014), satinAlumMat);
  bottomSpoke.position.set(0, -0.058, -0.004);
  steeringWheelSpinGroup.add(bottomSpoke);

  // 4. Rear Spoiler / Wing
  const spoilerStrutGeo = new THREE.BoxGeometry(0.08, 0.35, 0.2);
  const leftStrut = new THREE.Mesh(spoilerStrutGeo, darkTrimMat);
  leftStrut.position.set(-0.75, 1.15, 1.9);
  group.add(leftStrut);

  const rightStrut = new THREE.Mesh(spoilerStrutGeo, darkTrimMat);
  rightStrut.position.set(0.75, 1.15, 1.9);
  group.add(rightStrut);

  const wingGeo = new THREE.BoxGeometry(1.9, 0.08, 0.4);
  const wing = new THREE.Mesh(wingGeo, bodyPaintMat);
  wing.position.set(0, 1.33, 1.92);
  wing.rotation.x = -0.1;
  wing.castShadow = true;
  group.add(wing);

  // 5. Front Grille & Splitter
  const grilleGeo = new THREE.BoxGeometry(1.6, 0.28, 0.15);
  const grille = new THREE.Mesh(grilleGeo, darkTrimMat);
  grille.position.set(0, 0.58, -2.18);
  group.add(grille);

  const splitterGeo = new THREE.BoxGeometry(2.05, 0.08, 0.3);
  const splitter = new THREE.Mesh(splitterGeo, darkTrimMat);
  splitter.position.set(0, 0.32, -2.15);
  group.add(splitter);

  // 6. Wheels (4 Wheels with Hubs & Tires)
  const wheelRadius = 0.42;
  const wheelWidth = 0.32;
  const tireGeo = new THREE.CylinderGeometry(wheelRadius, wheelRadius, wheelWidth, 16);
  tireGeo.rotateZ(Math.PI / 2);

  const rimGeo = new THREE.CylinderGeometry(wheelRadius * 0.65, wheelRadius * 0.65, wheelWidth + 0.02, 12);
  rimGeo.rotateZ(Math.PI / 2);

  function createWheel(): { pivotGroup: THREE.Group; spinMesh: THREE.Group } {
    const pivot = new THREE.Group();
    const spin = new THREE.Group();

    const tireMesh = new THREE.Mesh(tireGeo, tireMat);
    tireMesh.castShadow = true;
    spin.add(tireMesh);

    const rimMesh = new THREE.Mesh(rimGeo, rimMat);
    spin.add(rimMesh);

    // Subtle 5-spoke hub cap
    const spokeGeo = new THREE.BoxGeometry(wheelWidth + 0.03, wheelRadius * 1.1, 0.06);
    const spoke1 = new THREE.Mesh(spokeGeo, chromeMat);
    const spoke2 = spoke1.clone();
    spoke2.rotation.x = Math.PI / 3;
    const spoke3 = spoke1.clone();
    spoke3.rotation.x = (2 * Math.PI) / 3;
    spin.add(spoke1, spoke2, spoke3);

    pivot.add(spin);
    return { pivotGroup: pivot, spinMesh: spin };
  }

  // Front Wheels (Steerable)
  const frontLeftWheel = createWheel();
  frontLeftWheel.pivotGroup.position.set(-1.08, wheelRadius, -1.35);
  group.add(frontLeftWheel.pivotGroup);

  const frontRightWheel = createWheel();
  frontRightWheel.pivotGroup.position.set(1.08, wheelRadius, -1.35);
  group.add(frontRightWheel.pivotGroup);

  // Rear Wheels
  const rearLeftWheel = createWheel();
  rearLeftWheel.pivotGroup.position.set(-1.08, wheelRadius, 1.35);
  group.add(rearLeftWheel.pivotGroup);

  const rearRightWheel = createWheel();
  rearRightWheel.pivotGroup.position.set(1.08, wheelRadius, 1.35);
  group.add(rearRightWheel.pivotGroup);

  // 7. Headlights (3D Lens Meshes + Single Wide Forward SpotLight for Fast Fragment Shading)
  const headlightGeo = new THREE.BoxGeometry(0.35, 0.14, 0.1);
  const leftLightMesh = new THREE.Mesh(headlightGeo, headlightLensMat);
  leftLightMesh.position.set(-0.7, 0.72, -2.13);
  group.add(leftLightMesh);

  const rightLightMesh = new THREE.Mesh(headlightGeo, headlightLensMat);
  rightLightMesh.position.set(0.7, 0.72, -2.13);
  group.add(rightLightMesh);

  const spotLeft = new THREE.SpotLight(0xfff7e6, 0, 85, Math.PI / 4, 0.45, 1.4);
  spotLeft.position.set(0, 0.85, -2.2);
  const targetLeft = new THREE.Object3D();
  targetLeft.position.set(0, 0.1, -48);
  group.add(targetLeft);
  spotLeft.target = targetLeft;
  group.add(spotLeft);
  const spotRight = spotLeft;

  // 8. Rear Tail Light Lightbar
  const taillightGeo = new THREE.BoxGeometry(1.8, 0.12, 0.08);
  const taillightMesh = new THREE.Mesh(taillightGeo, taillightMat);
  taillightMesh.position.set(0, 0.85, 2.15);
  group.add(taillightMesh);

  // 9. Dual Exhaust Pipes & Nitro Glow
  const exhaustGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.35, 12);
  exhaustGeo.rotateX(Math.PI / 2);
  const leftExhaust = new THREE.Mesh(exhaustGeo, chromeMat);
  leftExhaust.position.set(-0.55, 0.35, 2.18);
  group.add(leftExhaust);

  const rightExhaust = new THREE.Mesh(exhaustGeo, chromeMat);
  rightExhaust.position.set(0.55, 0.35, 2.18);
  group.add(rightExhaust);

  // Nitro flames (hidden by default)
  const flameGeo = new THREE.ConeGeometry(0.12, 0.8, 8);
  flameGeo.rotateX(-Math.PI / 2);
  const flameMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.9 });
  const leftFlame = new THREE.Mesh(flameGeo, flameMat);
  leftFlame.position.set(-0.55, 0.35, 2.65);
  leftFlame.visible = false;
  group.add(leftFlame);

  const rightFlame = new THREE.Mesh(flameGeo, flameMat);
  rightFlame.position.set(0.55, 0.35, 2.65);
  rightFlame.visible = false;
  group.add(rightFlame);

  // Ground Contact Shadow Disk
  const shadowGeo = new THREE.PlaneGeometry(2.6, 5.2);
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = 128;
  shadowCanvas.height = 128;
  const sCtx = shadowCanvas.getContext('2d')!;
  const grad = sCtx.createRadialGradient(64, 64, 10, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,0.7)');
  grad.addColorStop(0.6, 'rgba(0,0,0,0.3)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  sCtx.fillStyle = grad;
  sCtx.fillRect(0, 0, 128, 128);
  const shadowTex = new THREE.CanvasTexture(shadowCanvas);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: shadowTex,
    transparent: true,
    depthWrite: false,
    opacity: 0.75,
  });
  const shadowPlane = new THREE.Mesh(shadowGeo, shadowMat);
  shadowPlane.rotation.x = -Math.PI / 2;
  shadowPlane.position.y = 0.04;
  group.add(shadowPlane);

  return {
    group,
    headlightLeft: spotLeft,
    headlightRight: spotRight,
    updateWheelRotation: (distanceTraveled: number, steerAngle: number) => {
      // Rotate spin mesh based on distance
      const spinAngle = distanceTraveled / wheelRadius;
      frontLeftWheel.spinMesh.rotation.x = spinAngle;
      frontRightWheel.spinMesh.rotation.x = spinAngle;
      rearLeftWheel.spinMesh.rotation.x = spinAngle;
      rearRightWheel.spinMesh.rotation.x = spinAngle;

      // Pivot front wheels left/right
      frontLeftWheel.pivotGroup.rotation.y = steerAngle;
      frontRightWheel.pivotGroup.rotation.y = steerAngle;

      // Turn cockpit steering wheel smoothly with steering input
      steeringWheelSpinGroup.rotation.z = steerAngle * 2.4;
    },
    updateCockpitDisplay: (
      speedMph: number,
      rpm: number,
      gear: string,
      isBoosting: boolean,
      nav?: CockpitNavData
    ) => {
      if (cockpitGroup.visible) {
        drawGaugeCluster(speedMph, rpm, gear, isBoosting);
        drawNavDisplay(nav);
      }
    },
    setBraking: (isBraking: boolean) => {
      taillightMat.emissiveIntensity = isBraking ? 2.8 : 0.8;
      taillightMat.color.setHex(isBraking ? 0xff0000 : 0x991b1b);
    },
    setHeadlights: (on: boolean) => {
      spotLeft.intensity = on ? 4.5 : 0;
      spotRight.intensity = on ? 4.5 : 0;
      headlightLensMat.emissiveIntensity = on ? 2.0 : 0.2;
    },
    setBoosting: (boosting: boolean) => {
      leftFlame.visible = boosting;
      rightFlame.visible = boosting;
      if (boosting) {
        const flicker = 0.8 + Math.random() * 0.4;
        leftFlame.scale.set(flicker, flicker, flicker * (1.2 + Math.random() * 0.4));
        rightFlame.scale.set(flicker, flicker, flicker * (1.2 + Math.random() * 0.4));
      }
    },
    setFirstPersonMode: (enabled: boolean) => {
      mainBody.visible = !enabled;
      cabin.visible = !enabled;
      roof.visible = !enabled;
      cockpitGroup.visible = enabled;
    },
  };
}
