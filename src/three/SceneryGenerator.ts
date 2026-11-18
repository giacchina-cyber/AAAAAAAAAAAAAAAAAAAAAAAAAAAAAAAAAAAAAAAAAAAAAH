import * as THREE from 'three';
import { ProjectedRoute } from '../services/gpsProjection';

export interface SceneryManager {
  group: THREE.Group;
  update: (time: number, carPos: THREE.Vector3, biome: string) => void;
  dispose: () => void;
}

/**
 * Creates an authentic green overhead interstate highway sign gantry spanning the road.
 */
export function createHighwayGantrySign(
  cityName: string,
  stateName: string,
  exitText: string = 'EXIT 14'
): THREE.Group {
  const gantryGroup = new THREE.Group();

  const steelMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    metalness: 0.8,
    roughness: 0.3,
  });

  const greenSignMat = new THREE.MeshStandardMaterial({
    color: 0x15803d, // Federal Highway Green
    roughness: 0.4,
    metalness: 0.1,
  });

  // Vertical steel truss pillars on left and right shoulders (road width 19.2m)
  const pillarGeo = new THREE.CylinderGeometry(0.22, 0.28, 7.8, 8);
  const leftPillar = new THREE.Mesh(pillarGeo, steelMat);
  leftPillar.position.set(-12.6, 3.9, 0);
  gantryGroup.add(leftPillar);

  const rightPillar = new THREE.Mesh(pillarGeo, steelMat);
  rightPillar.position.set(12.6, 3.9, 0);
  gantryGroup.add(rightPillar);

  // Horizontal steel truss beam
  const beamGeo = new THREE.BoxGeometry(26.2, 0.45, 0.45);
  const beam = new THREE.Mesh(beamGeo, steelMat);
  beam.position.set(0, 7.5, 0);
  gantryGroup.add(beam);

  // Main Interstate Guide Sign (Canvas Texture with clean text)
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#15803d';
  ctx.fillRect(0, 0, 512, 256);

  // White border
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 10;
  ctx.strokeRect(10, 10, 492, 236);

  // Text
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';

  ctx.font = 'bold 36px sans-serif';
  ctx.fillText(exitText.toUpperCase(), 256, 60);

  ctx.font = 'bold 44px sans-serif';
  ctx.fillText(cityName.toUpperCase().slice(0, 18), 256, 130);

  ctx.font = '32px sans-serif';
  ctx.fillText(`${stateName} • NEXT EXITS`, 256, 195);

  const signTex = new THREE.CanvasTexture(canvas);
  signTex.colorSpace = THREE.SRGBColorSpace;

  const signPlateMat = new THREE.MeshStandardMaterial({
    map: signTex,
    roughness: 0.35,
    metalness: 0.1,
  });

  const signGeo = new THREE.BoxGeometry(6.5, 3.0, 0.15);
  const signMesh = new THREE.Mesh(signGeo, signPlateMat);
  signMesh.position.set(0, 6.2, 0);
  gantryGroup.add(signMesh);

  return gantryGroup;
}

/**
 * Builds distant mountain horizon ranges, Midwest wind turbine farms,
 * and roadside vegetation.
 */
export function buildRoadsideScenery(projectedRoute: ProjectedRoute): SceneryManager {
  const group = new THREE.Group();
  group.name = 'Scenery';

  // 1. Distant Mountain Horizon Vista Ring (Placed at 3,000m - 8,000m around the player)
  const mountainGroup = new THREE.Group();
  const mountainGeo = new THREE.ConeGeometry(900, 1600, 7);
  const mesaGeo = new THREE.BoxGeometry(1600, 700, 900);

  const mountainMat = new THREE.MeshStandardMaterial({
    color: 0x1e3a2b, // Dynamically tinted per biome
    roughness: 0.92,
    metalness: 0.08,
    flatShading: true,
  });

  const desertMat = new THREE.MeshStandardMaterial({
    color: 0x9a3412, // Red sandstone
    roughness: 0.85,
    metalness: 0.1,
    flatShading: true,
  });

  const mountainMesh = new THREE.InstancedMesh(mountainGeo, mountainMat, 60);
  mountainMesh.frustumCulled = false;
  const mesaMesh = new THREE.InstancedMesh(mesaGeo, desertMat, 40);
  mesaMesh.frustumCulled = false;

  const dummy = new THREE.Object3D();
  for (let i = 0; i < 60; i++) {
    const angle = (i / 60) * Math.PI * 2;
    const dist = 3800 + ((i * 47) % 2500);
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;
    const scale = 1.0 + ((i * 13) % 10) * 0.15;

    dummy.position.set(x, 500 * scale, z);
    dummy.scale.set(scale * 1.5, scale * 2.2, scale * 1.5);
    dummy.rotation.y = i * 1.4;
    dummy.updateMatrix();
    mountainMesh.setMatrixAt(i, dummy.matrix);
  }
  mountainMesh.instanceMatrix.needsUpdate = true;
  mountainGroup.add(mountainMesh);

  for (let i = 0; i < 40; i++) {
    const angle = (i / 40) * Math.PI * 2 + 0.3;
    const dist = 4200 + ((i * 53) % 2200);
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;
    const scale = 1.0 + ((i * 17) % 8) * 0.15;

    dummy.position.set(x, 280 * scale, z);
    dummy.scale.set(scale * 1.8, scale * 1.2, scale * 1.8);
    dummy.rotation.y = i * 0.8;
    dummy.updateMatrix();
    mesaMesh.setMatrixAt(i, dummy.matrix);
  }
  mesaMesh.instanceMatrix.needsUpdate = true;
  mountainGroup.add(mesaMesh);
  group.add(mountainGroup);

  // 2. Midwest Wind Turbines (turning blades in the distance)
  const turbineGroup = new THREE.Group();
  const turbineTowerGeo = new THREE.CylinderGeometry(0.6, 1.2, 50, 8);
  const turbineMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.3, metalness: 0.2 });
  const bladeGeo = new THREE.BoxGeometry(0.7, 20, 0.15);
  const turbineBlades: THREE.Group[] = [];

  for (let i = 0; i < 20; i++) {
    const angle = (i / 20) * Math.PI * 2;
    const dist = 800 + ((i * 37) % 1200);
    const tx = Math.cos(angle) * dist;
    const tz = Math.sin(angle) * dist;

    const turbine = new THREE.Group();
    turbine.position.set(tx, 0, tz);

    const tower = new THREE.Mesh(turbineTowerGeo, turbineMat);
    tower.position.y = 25;
    turbine.add(tower);

    const rotorGroup = new THREE.Group();
    rotorGroup.position.set(0, 50, 2);

    for (let b = 0; b < 3; b++) {
      const blade = new THREE.Mesh(bladeGeo, turbineMat);
      blade.position.y = 10;
      const bladeHolder = new THREE.Group();
      bladeHolder.rotation.z = (b * (2 * Math.PI)) / 3;
      bladeHolder.add(blade);
      rotorGroup.add(bladeHolder);
    }

    turbine.add(rotorGroup);
    turbineGroup.add(turbine);
    turbineBlades.push(rotorGroup);
  }
  group.add(turbineGroup);

  let lastBiome = '';
  return {
    group,
    update: (_time: number, _carPos: THREE.Vector3, biome: string) => {
      // Only animate wind turbine rotors when visible
      if (biome === 'midwest_plains') {
        for (let i = 0; i < turbineBlades.length; i++) {
          turbineBlades[i].rotation.z += 0.02 + (i % 3) * 0.005;
        }
      }

      if (biome === lastBiome) return;
      lastBiome = biome;

      if (biome === 'desert') {
        mountainMesh.visible = false;
        mesaMesh.visible = true;
        turbineGroup.visible = false;
      } else if (biome === 'rockies') {
        mountainMesh.visible = true;
        mountainMat.color.setHex(0x475569);
        mesaMesh.visible = false;
        turbineGroup.visible = false;
      } else if (biome === 'midwest_plains') {
        mountainMesh.visible = false;
        mesaMesh.visible = false;
        turbineGroup.visible = true;
      } else {
        mountainMesh.visible = true;
        mountainMat.color.setHex(0x1e3a2b);
        mesaMesh.visible = false;
        turbineGroup.visible = false;
      }
    },
    dispose: () => {
      mountainGeo.dispose();
      mesaGeo.dispose();
      turbineTowerGeo.dispose();
      bladeGeo.dispose();
      mountainMat.dispose();
      desertMat.dispose();
      turbineMat.dispose();
    },
  };
}
