import * as THREE from 'three';
import { HighwayRoute, HighwayExit, TownStop, VehicleTelemetry, CameraViewMode } from '../types';
import { projectRouteTo3D, getRouteLocationAtProgress, ProjectedRoute } from '../services/gpsProjection';
import { DynamicHighwayStreamer, DynamicHighwayFrame, getExitRampGeometryAtDistance } from './RoadGeometry';
import { createVehicleModel, VehicleController, CockpitNavData } from './VehicleModel';
import { buildRoadsideScenery, SceneryManager } from './SceneryGenerator';
import { getRouteById, ROUTE_NYC_TO_LA } from '../data/routes';

export class HighwaySceneEngine {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private timer: THREE.Timer;
  private animFrameId: number = 0;
  private fenceTimerId: number = 0;
  private isDisposed: boolean = false;
  private isSoftwareGl: boolean = false;

  // Reusable zero-GC math scratch objects
  private readonly _upVec = new THREE.Vector3(0, 1, 0);
  private _dirTan = new THREE.Vector3();
  private _dirBin = new THREE.Vector3();
  private _effTan = new THREE.Vector3();
  private _effTanNeg = new THREE.Vector3();
  private _effBin = new THREE.Vector3();
  private _effNrm = new THREE.Vector3();
  private _carPos = new THREE.Vector3();
  private _rotMat = new THREE.Matrix4();
  private _targetCamPos = new THREE.Vector3();
  private _targetLookAt = new THREE.Vector3();
  private _backward = new THREE.Vector3();
  private _camFwd = new THREE.Vector3();
  private readonly _driverEyeLocal = new THREE.Vector3(-0.34, 1.32, 0.02);
  private readonly _driverLookLocal = new THREE.Vector3(-0.34, 0.22, -24.0);
  private _driverEyeTemp = new THREE.Vector3();
  private _frameOut: DynamicHighwayFrame = {
    centerPoint: new THREE.Vector3(),
    tangent: new THREE.Vector3(0, 0, -1),
    binormal: new THREE.Vector3(1, 0, 0),
    normal: new THREE.Vector3(0, 1, 0),
  };

  // Telemetry throttle tracking
  private lastTelemetryEmitTime: number = 0;
  private lastTelemetryStateKey: string = '';
  private _cockpitExitData: NonNullable<CockpitNavData['upcomingExit']> = {
    exitNumber: '',
    branchHighwayCode: '',
    destination: '',
    distanceMiles: 0,
    canTakeExit: false,
    isTakingExit: false,
  };
  private _cockpitNavData: CockpitNavData = {
    routeId: '',
    highwayCode: '',
    routeName: '',
    waypoints: [],
    progress: 0,
    currentLat: 0,
    currentLon: 0,
    currentMile: 0,
    totalMiles: 0,
    city: '',
    state: '',
    driveDirection: 1,
    destName: '',
    originName: '',
    isDetour: false,
    upcomingExit: null,
  };

  // Route & Meshes
  private currentRoute: HighwayRoute;
  private projectedRoute: ProjectedRoute;
  private streamer: DynamicHighwayStreamer;
  private sceneryManager: SceneryManager | null = null;
  private vehicleController: VehicleController;
  private lastMainRoute: HighwayRoute = ROUTE_NYC_TO_LA;
  private lastMainRouteDistanceMeters: number = 0;
  private lastExitTakenTime: number = 0; // Cooldown timer to prevent accidental double triggering
  private activeUpcomingExit: HighwayExit | null = null;
  private committedExit: HighwayExit | null = null;
  private autoExitMerge: boolean = false;
  private rampLocalOffset: number = 0;
  private rampHeadingSlope: number = 0;
  private driveDirection: 1 | -1 = 1;
  private isTurningAround: boolean = false;
  private uTurnElapsed: number = 0;
  private readonly uTurnDuration: number = 0.85;
  private uTurnStartLane: number = 4.45;
  private uTurnFromDirection: 1 | -1 = 1;
  private isTownPaused: boolean = false;
  private townCooldownIds: Set<string> = new Set();

  // Environment & Lighting
  private sunLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  private groundPlane: THREE.Mesh;

  // 1:1 Real-World Travel Simulation State
  // At 210 MPH, in 3600 seconds (1 hour), travels exactly 210.00 miles.
  private currentDistanceMeters: number = 0; // Total meters traveled along route
  private speedMph: number = 0;
  private maxSpeedMph: number = 210;
  private progress: number = 0; // 0 to 1
  private laneOffset: number = 4.45; // Middle driving lane of 3 right-hand lanes (meters from centerline)
  private targetLaneOffset: number = 4.45;
  private steerAngle: number = 0;
  private isBoosting: boolean = false;
  private cruiseControl: boolean = false;
  private cruiseTargetSpeedMph: number = 70;
  private timeOfDayHours: number = 14; // 2:00 PM Afternoon default

  // Camera Settings
  private cameraMode: CameraViewMode = 'chase';
  private smoothedCamPos = new THREE.Vector3();
  private smoothedCamLook = new THREE.Vector3();

  // Input Keys
  private keys: { [key: string]: boolean } = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    boost: false,
    brake: false,
  };

  // Telemetry, Route Change & Town Arrival Callbacks
  public onTelemetryUpdate?: (telemetry: VehicleTelemetry) => void;
  public onRouteChanged?: (route: HighwayRoute) => void;
  public onTownEntered?: (town: TownStop) => void;

  // Web Audio Synth for Engine Sounds
  private audioCtx: AudioContext | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private isAudioMuted: boolean = true;

  constructor(container: HTMLElement, initialRoute: HighwayRoute) {
    this.container = container;
    this.currentRoute = initialRoute;
    this.timer = new THREE.Timer();
    this.timer.connect(document);

    // 1. Detect Software WebGL
    this.isSoftwareGl = (() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    // 2. Setup Three.js Renderer with Mipmapping
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
      alpha: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);

    // 3. Scene & Extended Horizon Camera (50,000 unit far clip)
    this.scene = new THREE.Scene();
    const skyColor = new THREE.Color(0x60a5fa);
    this.scene.background = skyColor;
    this.scene.fog = new THREE.Fog(skyColor, 3500, 38000);

    this.camera = new THREE.PerspectiveCamera(
      60,
      container.clientWidth / container.clientHeight,
      0.3,
      50000
    );

    // 4. Studio Lighting & Sunlight
    this.hemiLight = new THREE.HemisphereLight(0xdff0ff, 0x4a4538, 1.25);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfffaed, 2.8);
    this.sunLight.position.set(180, 380, 140);
    this.sunLight.castShadow = !this.isSoftwareGl;
    if (!this.isSoftwareGl) {
      this.sunLight.shadow.mapSize.width = 1024;
      this.sunLight.shadow.mapSize.height = 1024;
      this.sunLight.shadow.camera.near = 10;
      this.sunLight.shadow.camera.far = 900;
      const d = 80;
      this.sunLight.shadow.camera.left = -d;
      this.sunLight.shadow.camera.right = d;
      this.sunLight.shadow.camera.top = d;
      this.sunLight.shadow.camera.bottom = -d;
      this.sunLight.shadow.bias = -0.0005;
      this.sunLight.shadow.normalBias = 0.02;
    }
    this.scene.add(this.sunLight);

    // 5. Extended Horizon Ground Plane
    const groundGeo = new THREE.PlaneGeometry(60000, 60000);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x1f2e1f,
      roughness: 0.96,
      metalness: 0.04,
    });
    this.groundPlane = new THREE.Mesh(groundGeo, groundMat);
    this.groundPlane.rotation.x = -Math.PI / 2;
    this.groundPlane.position.y = -0.3;
    this.groundPlane.receiveShadow = true;
    this.groundPlane.frustumCulled = false;
    this.scene.add(this.groundPlane);

    // 6. Build Route & Dynamic Streamer
    this.projectedRoute = projectRouteTo3D(this.currentRoute);
    this.streamer = new DynamicHighwayStreamer(this.renderer);
    this.scene.add(this.streamer.group);

    // 7. Add 3D Vehicle Avatar
    this.vehicleController = createVehicleModel();
    this.scene.add(this.vehicleController.group);

    // 8. Distant Mountain Scenery
    this.sceneryManager = buildRoadsideScenery(this.projectedRoute);
    this.scene.add(this.sceneryManager.group);

    // Initial vehicle placement & immediate road visibility
    this.currentDistanceMeters = 0;
    this.updateHighwayAndVehicle(0, 0);
    this.initCameraPosition();

    // Pre-compile shaders on hardware GPU so initial render is instantaneous
    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    // 9. Event Listeners & Loop
    window.addEventListener('resize', this.onWindowResize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);

    // Start render loop
    this.tick();
  }

  public setRoute(newRoute: HighwayRoute) {
    this.currentRoute = newRoute;
    this.projectedRoute = projectRouteTo3D(newRoute);
    this.currentDistanceMeters = 0;
    this.progress = 0;
    this.speedMph = 0;
    this.driveDirection = 1;
    this.isTurningAround = false;
    this.laneOffset = 4.45;
    this.targetLaneOffset = 4.45;
    this.committedExit = null;
    this.autoExitMerge = false;
    this.rampLocalOffset = 0;
    this.rampHeadingSlope = 0;
    this.isTownPaused = false;
    this.markNearbyTownsInCooldown(0, 0.45);

    if (this.sceneryManager) {
      this.scene.remove(this.sceneryManager.group);
      this.sceneryManager.dispose();
      this.sceneryManager = buildRoadsideScenery(this.projectedRoute);
      this.scene.add(this.sceneryManager.group);
    }

    this.activeUpcomingExit = this.findUpcomingExit();
    this.updateHighwayAndVehicle(0, 0);
    this.initCameraPosition();
    this.onRouteChanged?.(this.currentRoute);
  }

  public turnAround() {
    if (this.isTurningAround) return;
    this.isTurningAround = true;
    this.uTurnElapsed = 0;
    this.uTurnFromDirection = this.driveDirection;
    this.uTurnStartLane = this.laneOffset;
    this.committedExit = null;
    this.autoExitMerge = false;
    this.rampLocalOffset = 0;
    this.rampHeadingSlope = 0;
  }

  public findUpcomingExit(): HighwayExit | null {
    if (this.committedExit) return this.committedExit;
    if (!this.currentRoute.exits || this.currentRoute.exits.length === 0) return null;
    const currentMile = this.currentDistanceMeters / 1609.344;
    let closestExit: HighwayExit | null = null;
    let closestAbsDist = Infinity;
    for (const exit of this.currentRoute.exits) {
      const distMilesAhead = (exit.mileMarker - currentMile) * this.driveDirection;
      // Announce exit within 2.5 miles ahead, and keep active through the 0.45 mi curve-off zone
      if (distMilesAhead > -0.45 && distMilesAhead <= 2.5) {
        const absDist = Math.abs(distMilesAhead);
        if (absDist < closestAbsDist) {
          closestAbsDist = absDist;
          closestExit = exit;
        }
      }
    }
    return closestExit;
  }

  private markNearbyTownsInCooldown(mile: number, radiusMiles: number) {
    this.townCooldownIds.clear();
    for (const town of this.currentRoute.towns ?? []) {
      if (Math.abs(mile - town.mileMarker) <= radiusMiles) {
        this.townCooldownIds.add(town.id);
      }
    }
  }

  private findNearbyTown(rangeAheadMiles: number = 0.85, rangeBehindMiles: number = 0.25): TownStop | null {
    const towns = this.currentRoute.towns;
    if (!towns || towns.length === 0) return null;
    const currentMile = this.currentDistanceMeters / 1609.344;
    let closest: TownStop | null = null;
    let closestDist = Infinity;
    for (const town of towns) {
      const signedAhead = (town.mileMarker - currentMile) * this.driveDirection;
      if (signedAhead >= -rangeBehindMiles && signedAhead <= rangeAheadMiles) {
        const absDist = Math.abs(signedAhead);
        if (absDist < closestDist) {
          closestDist = absDist;
          closest = town;
        }
      }
    }
    return closest;
  }

  public setTownStayPaused(paused: boolean) {
    this.isTownPaused = paused;
    if (paused) {
      this.speedMph = 0;
      this.cruiseControl = false;
      this.isBoosting = false;
      this.keys.forward = false;
      this.keys.backward = false;
      this.keys.left = false;
      this.keys.right = false;
      this.keys.boost = false;
      this.keys.brake = false;
      this.vehicleController.setBraking(false);
      this.vehicleController.setBoosting(false);
    }
  }

  public exitTownToRoad(town: TownStop, sleepHours: number = 0) {
    if (sleepHours > 0) {
      this.setTimeOfDay((this.timeOfDayHours + sleepHours) % 24);
    }
    const totalMiles = Math.max(0.2, this.projectedRoute.totalMiles);
    const roadMile = Math.max(0.05, Math.min(totalMiles - 0.05, town.mileMarker + 0.65 * this.driveDirection));
    this.progress = roadMile / totalMiles;
    this.currentDistanceMeters = this.progress * this.projectedRoute.totalMeters;
    this.speedMph = 0;
    this.cruiseControl = false;
    this.isBoosting = false;
    this.isTurningAround = false;
    this.laneOffset = 4.45;
    this.targetLaneOffset = 4.45;
    this.committedExit = null;
    this.autoExitMerge = false;
    this.rampLocalOffset = 0;
    this.rampHeadingSlope = 0;
    this.isTownPaused = false;
    this.townCooldownIds.add(town.id);
    this.keys.forward = false;
    this.keys.backward = false;
    this.keys.left = false;
    this.keys.right = false;
    this.keys.boost = false;
    this.keys.brake = false;
    this.activeUpcomingExit = this.findUpcomingExit();
    this.updateHighwayAndVehicle(0, 0);
    this.initCameraPosition();
  }

  public initiateExit(exit: HighwayExit) {
    if (this.isTurningAround) return;
    if (this.committedExit && this.committedExit.id === exit.id) {
      this.takeExit(exit);
      return;
    }
    const exitMeters = exit.mileMarker * 1609.344;
    const signedDist = (this.currentDistanceMeters - exitMeters) * this.driveDirection;
    if (signedDist >= -750 && signedDist < 0) {
      // Smoothly merge right into the rendered auxiliary exit lane and curve off naturally
      this.autoExitMerge = true;
      return;
    }
    this.takeExit(exit);
  }

  public takeExit(exit: HighwayExit) {
    const routeId = exit.branchRouteId || exit.targetRouteId || '';
    const branch = getRouteById(routeId);
    if (!branch) return;

    // Record main route position if branching from a primary highway corridor
    if (!this.currentRoute.isDetour) {
      this.lastMainRoute = this.currentRoute;
      this.lastMainRouteDistanceMeters = this.currentDistanceMeters;
    }

    const currentSpeed = this.speedMph;
    this.currentRoute = branch;
    this.projectedRoute = projectRouteTo3D(branch);
    const targetMile = exit.targetMileMarker ?? exit.returnMileMarker;
    this.currentDistanceMeters =
      targetMile !== undefined
        ? Math.min(this.projectedRoute.totalMeters - 500, Math.max(30, targetMile * 1609.344))
        : 30;
    this.progress = this.currentDistanceMeters / this.projectedRoute.totalMeters;
    // Maintain natural highway speed into the new route
    this.speedMph = Math.min(85, Math.max(35, currentSpeed));
    this.driveDirection = 1;
    this.isTurningAround = false;
    this.laneOffset = 4.45;
    this.targetLaneOffset = 4.45;
    this.committedExit = null;
    this.autoExitMerge = false;
    this.rampLocalOffset = 0;
    this.rampHeadingSlope = 0;
    this.lastExitTakenTime = performance.now();
    this.isTownPaused = false;
    this.markNearbyTownsInCooldown(this.currentDistanceMeters / 1609.344, 0.45);

    // Rebuild scenery for new branch region
    if (this.sceneryManager) {
      this.scene.remove(this.sceneryManager.group);
      this.sceneryManager.dispose();
      this.sceneryManager = buildRoadsideScenery(this.projectedRoute);
      this.scene.add(this.sceneryManager.group);
    }

    this.activeUpcomingExit = null;
    this.updateHighwayAndVehicle(0, 0);
    this.initCameraPosition();
    this.onRouteChanged?.(this.currentRoute);
  }

  public returnToMainRoute() {
    const returnRoute = this.lastMainRoute || ROUTE_NYC_TO_LA;
    this.currentRoute = returnRoute;
    this.projectedRoute = projectRouteTo3D(returnRoute);
    // Return to main route slightly past the exit interchange (+450m) so we don't immediately trigger it again
    this.currentDistanceMeters = Math.min(
      this.projectedRoute.totalMeters - 1000,
      this.lastMainRouteDistanceMeters + 450
    );
    this.progress = this.currentDistanceMeters / this.projectedRoute.totalMeters;
    this.speedMph = 65;
    this.driveDirection = 1;
    this.isTurningAround = false;
    this.laneOffset = 4.45;
    this.targetLaneOffset = 4.45;
    this.committedExit = null;
    this.autoExitMerge = false;
    this.rampLocalOffset = 0;
    this.rampHeadingSlope = 0;
    this.lastExitTakenTime = performance.now();
    this.isTownPaused = false;
    this.markNearbyTownsInCooldown(this.currentDistanceMeters / 1609.344, 0.45);

    if (this.sceneryManager) {
      this.scene.remove(this.sceneryManager.group);
      this.sceneryManager.dispose();
      this.sceneryManager = buildRoadsideScenery(this.projectedRoute);
      this.scene.add(this.sceneryManager.group);
    }

    this.updateHighwayAndVehicle(0, 0);
    this.initCameraPosition();
    this.onRouteChanged?.(this.currentRoute);
  }

  private initCameraPosition() {
    if (this.cameraMode === 'driver') {
      this.vehicleController.group.updateMatrixWorld();
      this.smoothedCamPos.copy(this._driverEyeLocal).applyMatrix4(this.vehicleController.group.matrixWorld);
      this.smoothedCamLook.copy(this._driverLookLocal).applyMatrix4(this.vehicleController.group.matrixWorld);
      this.camera.fov = 68;
      this.camera.updateProjectionMatrix();
      this.camera.position.copy(this.smoothedCamPos);
      this.camera.lookAt(this.smoothedCamLook);
      return;
    }
    const carPos = this.vehicleController.group.position;
    this._camFwd.set(0, 0, -1).applyQuaternion(this.vehicleController.group.quaternion).normalize();
    this.smoothedCamPos.copy(carPos).addScaledVector(this._camFwd, -5.6);
    this.smoothedCamPos.y += 1.85;
    this.smoothedCamLook.copy(carPos).addScaledVector(this._camFwd, 25);
    this.smoothedCamLook.y += 1.15;
    this.camera.position.copy(this.smoothedCamPos);
    this.camera.lookAt(this.smoothedCamLook);
  }

  /**
   * Updates dynamic highway streamer, vehicle transform, and scenery around current position.
   */
  private updateHighwayAndVehicle(delta: number, distanceMovedMeters: number): DynamicHighwayFrame {
    // 1. Update dynamic highway ribbon buffer around current distance
    const frame = this.streamer.update(
      this.currentDistanceMeters,
      this.projectedRoute,
      this.activeUpcomingExit,
      this.currentRoute.highwayCode,
      this.currentRoute.destName,
      this.driveDirection,
      this.isTurningAround,
      this.findNearbyTown()
    );

    // 2. Position vehicle avatar relative to stream origin (driver-oriented basis, zero-GC)
    const activeDir = this.isTurningAround ? this.uTurnFromDirection : this.driveDirection;
    this._dirTan.copy(frame.tangent).multiplyScalar(activeDir);
    this._dirBin.copy(frame.binormal).multiplyScalar(activeDir);

    if (this.isTurningAround) {
      const rawT = Math.min(1, this.uTurnElapsed / this.uTurnDuration);
      const s = rawT * rawT * (3 - 2 * rawT);
      const turnAngle = s * Math.PI;
      const latAlongOldBin = THREE.MathUtils.lerp(this.uTurnStartLane, -4.45, s);
      this._carPos.copy(this._dirBin).multiplyScalar(latAlongOldBin).addScaledVector(frame.normal, 0.02);

      // Sweep smoothly left across the double-yellow centerline into opposite carriageway
      this._effTan
        .copy(this._dirTan)
        .multiplyScalar(Math.cos(turnAngle))
        .addScaledVector(this._dirBin, -Math.sin(turnAngle))
        .normalize();
    } else {
      this._carPos.copy(this._dirBin).multiplyScalar(this.laneOffset).addScaledVector(frame.normal, 0.02);

      if (this.rampHeadingSlope > 0.0001) {
        this._effTan.copy(this._dirTan).addScaledVector(this._dirBin, this.rampHeadingSlope).normalize();
      } else {
        this._effTan.copy(this._dirTan);
      }
    }

    this.vehicleController.group.position.copy(this._carPos);
    this._effBin.crossVectors(this._effTan, this._upVec).normalize();
    this._effNrm.crossVectors(this._effBin, this._effTan).normalize();

    this._effTanNeg.copy(this._effTan).negate();
    this._rotMat.makeBasis(this._effBin, this._effNrm, this._effTanNeg);
    this.vehicleController.group.quaternion.setFromRotationMatrix(this._rotMat);

    if (Math.abs(this.steerAngle) > 0.01) {
      this.vehicleController.group.rotateY(this.steerAngle * 0.4);
      this.vehicleController.group.rotateZ(-this.steerAngle * 0.06);
    }

    // 3. Wheel rotation: angular displacement = distance / wheel radius (r = 0.38m)
    this.vehicleController.updateWheelRotation(distanceMovedMeters, this.steerAngle);

    // 4. Center ground plane & sunlight on car
    this.groundPlane.position.x = this._carPos.x;
    this.groundPlane.position.z = this._carPos.z;
    this.sunLight.position.set(this._carPos.x + 180, this._carPos.y + 380, this._carPos.z + 140);
    this.sunLight.target.position.copy(this._carPos);
    this.sunLight.target.updateMatrixWorld();

    this._frameOut.centerPoint.copy(frame.centerPoint);
    this._frameOut.tangent.copy(this._effTan);
    this._frameOut.binormal.copy(this._effBin);
    this._frameOut.normal.copy(this._effNrm);
    return this._frameOut;
  }

  /**
   * Visceral 3rd-person follow camera with ground parallax, dynamic FOV, and high-speed road vibration.
   */
  private updateCamera(delta: number, frame: DynamicHighwayFrame) {
    const carPos = this.vehicleController.group.position;
    const tangent = frame.tangent;
    const binormal = frame.binormal;

    // Dynamic FOV outside cockpit; locked constant 68° in driver mode so interior roof & full wheel stay static at all speeds
    const speedRatio = Math.min(1.0, this.speedMph / this.maxSpeedMph);
    if (this.cameraMode === 'driver') {
      if (this.camera.fov !== 68) {
        this.camera.fov = 68;
        this.camera.updateProjectionMatrix();
      }
    } else {
      const targetFov = 60 + speedRatio * 18 + (this.isBoosting ? 8 : 0);
      this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 4.0, delta);
      this.camera.updateProjectionMatrix();
    }

    if (this.cameraMode === 'chase') {
      this._backward.copy(tangent).negate();
      const chaseDistance = 5.5 + speedRatio * 1.5;
      const chaseHeight = 1.85 + speedRatio * 0.35;
      const lookAheadDistance = 22 + speedRatio * 35;

      this._targetCamPos.copy(carPos).addScaledVector(this._backward, chaseDistance);
      this._targetCamPos.y += chaseHeight;

      this._targetLookAt.copy(carPos).addScaledVector(tangent, lookAheadDistance);
      this._targetLookAt.y += 1.15;
    } else if (this.cameraMode === 'driver') {
      this.vehicleController.group.updateMatrixWorld();
      this._driverEyeTemp.copy(this._driverEyeLocal);
      if (this.speedMph > 65) {
        const shake = Math.min(0.003, ((this.speedMph - 65) / 215) * 0.003);
        this._driverEyeTemp.y += (Math.random() - 0.5) * shake;
      }
      this._targetCamPos.copy(this._driverEyeTemp).applyMatrix4(this.vehicleController.group.matrixWorld);
      this._targetLookAt.copy(this._driverLookLocal).applyMatrix4(this.vehicleController.group.matrixWorld);

      // Lock camera directly in driver's seat so roof, steering wheel & hood stay static and crisp
      this.smoothedCamPos.copy(this._targetCamPos);
      this.smoothedCamLook.copy(this._targetLookAt);
      this.camera.position.copy(this.smoothedCamPos);
      this.camera.lookAt(this.smoothedCamLook);
      return;
    } else if (this.cameraMode === 'drone') {
      this._targetCamPos.copy(carPos).addScaledVector(binormal, 16).addScaledVector(tangent, -5);
      this._targetCamPos.y += 6.5;

      this._targetLookAt.copy(carPos);
      this._targetLookAt.y += 1.4;
    } else {
      // Overhead
      this._targetCamPos.copy(carPos);
      this._targetCamPos.y += 50;
      this._targetLookAt.copy(carPos).addScaledVector(tangent, 15);
    }

    // High-speed tactile road vibration (speeds > 65 MPH)
    if (this.speedMph > 65) {
      const shakeIntensity = Math.min(0.045, ((this.speedMph - 65) / 100) * 0.025);
      this._targetCamPos.x += (Math.random() - 0.5) * shakeIntensity;
      this._targetCamPos.y += (Math.random() - 0.5) * shakeIntensity;
    }

    // Smooth exponential damping
    this.smoothedCamPos.x = THREE.MathUtils.damp(this.smoothedCamPos.x, this._targetCamPos.x, 9.0, delta);
    this.smoothedCamPos.y = THREE.MathUtils.damp(this.smoothedCamPos.y, this._targetCamPos.y, 9.0, delta);
    this.smoothedCamPos.z = THREE.MathUtils.damp(this.smoothedCamPos.z, this._targetCamPos.z, 9.0, delta);

    this.smoothedCamLook.x = THREE.MathUtils.damp(this.smoothedCamLook.x, this._targetLookAt.x, 11.0, delta);
    this.smoothedCamLook.y = THREE.MathUtils.damp(this.smoothedCamLook.y, this._targetLookAt.y, 11.0, delta);
    this.smoothedCamLook.z = THREE.MathUtils.damp(this.smoothedCamLook.z, this._targetLookAt.z, 11.0, delta);

    this.camera.position.copy(this.smoothedCamPos);
    this.camera.lookAt(this.smoothedCamLook);
  }

  public setTimeOfDay(hour: number) {
    this.timeOfDayHours = (hour + 24) % 24;
    const sunAngle = ((this.timeOfDayHours - 6) / 24) * (2 * Math.PI);
    const sunHeight = Math.sin(sunAngle);

    if (sunHeight > 0.05) {
      // Daytime / Golden Hour
      const isSunset = this.timeOfDayHours > 17 && this.timeOfDayHours < 20;
      const skyHex = isSunset ? 0xfdba74 : 0x60a5fa;
      const fogHex = isSunset ? 0xfed7aa : 0x93c5fd;

      this.scene.background = new THREE.Color(skyHex);
      if (this.scene.fog instanceof THREE.Fog) {
        this.scene.fog.color.setHex(fogHex);
      }
      this.sunLight.intensity = isSunset ? 2.2 : 2.8;
      this.sunLight.color.setHex(isSunset ? 0xffedd5 : 0xfffaed);
      this.hemiLight.intensity = 1.2;
      this.vehicleController.setHeadlights(false);
    } else {
      // Nighttime
      const nightHex = 0x060810;
      this.scene.background = new THREE.Color(nightHex);
      if (this.scene.fog instanceof THREE.Fog) {
        this.scene.fog.color.setHex(nightHex);
      }
      this.sunLight.intensity = 0.2;
      this.hemiLight.intensity = 0.25;
      this.vehicleController.setHeadlights(true);
    }
  }

  public setCameraMode(mode: CameraViewMode) {
    this.cameraMode = mode;
    this.vehicleController.setFirstPersonMode(mode === 'driver');
    if (mode === 'driver') {
      this.camera.fov = 68;
      this.camera.updateProjectionMatrix();
    }
  }

  public setCruiseControl(active: boolean, targetSpeed?: number) {
    this.cruiseControl = active;
    if (active) {
      this.cruiseTargetSpeedMph = targetSpeed ?? (this.speedMph >= 25 ? Math.min(this.maxSpeedMph, Math.round(this.speedMph)) : 70);
    }
  }

  public toggleCruiseControl(): boolean {
    this.cruiseControl = !this.cruiseControl;
    if (this.cruiseControl) {
      // Lock to current speed if already driving (>= 25 MPH), or set to 70 MPH highway speed
      this.cruiseTargetSpeedMph = this.speedMph >= 25 ? Math.min(this.maxSpeedMph, Math.round(this.speedMph)) : 70;
    }
    return this.cruiseControl;
  }

  public setControlInput(action: 'forward' | 'backward' | 'left' | 'right' | 'boost' | 'brake', state: boolean) {
    if (this.isTownPaused && state) return;
    this.keys[action] = state;
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) {
      return;
    }
    if (this.isTownPaused) {
      return;
    }
    if (['ArrowUp', 'KeyW'].includes(e.code)) this.keys.forward = true;
    if (['ArrowDown', 'KeyS'].includes(e.code)) this.keys.backward = true;
    if (['ArrowLeft', 'KeyA'].includes(e.code)) this.keys.left = true;
    if (['ArrowRight', 'KeyD'].includes(e.code)) this.keys.right = true;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.keys.boost = true;
    if (e.code === 'Space') this.keys.brake = true;
    // Press 'Q' to toggle Cruise Control
    if (e.code === 'KeyQ') {
      this.toggleCruiseControl();
    }
    // Press 'U' to turn around and drive in the opposite direction
    if (e.code === 'KeyU') {
      this.turnAround();
    }
    // Press 'E' to take upcoming highway exit (auto-merges if in approach zone, completes if on ramp)
    if (e.code === 'KeyE' && !this.isTurningAround) {
      if (this.committedExit) {
        this.takeExit(this.committedExit);
      } else if (this.activeUpcomingExit) {
        const exitDistMeters = Math.abs(this.activeUpcomingExit.mileMarker * 1609.344 - this.currentDistanceMeters);
        if (exitDistMeters <= 800) {
          this.initiateExit(this.activeUpcomingExit);
        }
      }
    }
    // Press 'R' when in detour to return to main coast-to-coast route
    if (e.code === 'KeyR' && this.currentRoute.isDetour) {
      this.returnToMainRoute();
    }
    if (e.code === 'KeyC') {
      const modes: CameraViewMode[] = ['chase', 'driver', 'drone', 'overhead'];
      const nextIdx = (modes.indexOf(this.cameraMode) + 1) % modes.length;
      this.setCameraMode(modes[nextIdx]);
    }
    if (e.code === 'KeyM') {
      this.toggleAudio();
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (['ArrowUp', 'KeyW'].includes(e.code)) this.keys.forward = false;
    if (['ArrowDown', 'KeyS'].includes(e.code)) this.keys.backward = false;
    if (['ArrowLeft', 'KeyA'].includes(e.code)) this.keys.left = false;
    if (['ArrowRight', 'KeyD'].includes(e.code)) this.keys.right = false;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.keys.boost = false;
    if (e.code === 'Space') this.keys.brake = false;
  };

  private onWindowResize = () => {
    if (!this.container || this.isDisposed) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  /**
   * Main Simulation Loop
   */
  private tick = () => {
    if (this.isDisposed) return;

    this.timer.update();
    const delta = Math.min(0.06, this.timer.getDelta());
    const elapsedTime = this.timer.getElapsed();

    // 1. Process Accelerate / Brake / Steering Inputs
    const isBraking = !this.isTownPaused && (this.keys.backward || this.keys.brake);
    const isSteeringLeft = !this.isTownPaused && this.keys.left;
    const isSteeringRight = !this.isTownPaused && this.keys.right;
    this.isBoosting = !this.isTownPaused && this.keys.boost;

    // Disengage Cruise Control if player taps the brake (standard automotive safety)
    if (isBraking && this.cruiseControl) {
      this.cruiseControl = false;
    }

    // Top speed calculation: 210 MPH normal, 280 MPH with Nitro
    const topSpeed = this.isBoosting ? 280 : this.maxSpeedMph;
    const accelRate = this.isBoosting ? 105 : 55;
    const brakeRate = 105;
    const naturalDecel = 14;

    if (this.isTownPaused) {
      this.speedMph = 0;
      this.cruiseControl = false;
      this.isBoosting = false;
    } else if (this.keys.forward) {
      // Manual gas accelerates up to active topSpeed, or coasts gently back to 210 MPH if nitro released
      if (this.speedMph <= topSpeed) {
        this.speedMph = Math.min(topSpeed, this.speedMph + accelRate * delta);
      } else {
        this.speedMph = Math.max(topSpeed, this.speedMph - 24 * delta);
      }
    } else if (isBraking) {
      this.speedMph = Math.max(0, this.speedMph - brakeRate * delta);
    } else if (this.cruiseControl) {
      // Cruise Control active: smoothly maintain locked target speed
      if (this.speedMph < this.cruiseTargetSpeedMph) {
        this.speedMph = Math.min(this.cruiseTargetSpeedMph, this.speedMph + 45 * delta);
      } else if (this.speedMph > this.cruiseTargetSpeedMph) {
        this.speedMph = Math.max(this.cruiseTargetSpeedMph, this.speedMph - naturalDecel * delta);
      }
    } else {
      this.speedMph = Math.max(0, this.speedMph - naturalDecel * delta);
    }

    this.vehicleController.setBraking(isBraking);
    this.vehicleController.setBoosting(this.isBoosting && this.speedMph > 40);

    // Steering, Lane Shift & U-Turn Maneuver
    const laneShiftSpeed = 7.8;
    let targetSteer = 0;
    let distanceMovedMeters = 0;

    if (this.isTownPaused) {
      distanceMovedMeters = 0;
    } else if (this.isTurningAround) {
      this.uTurnElapsed += delta;
      const rawT = Math.min(1, this.uTurnElapsed / this.uTurnDuration);
      const s = rawT * rawT * (3 - 2 * rawT);
      const turnAngle = s * Math.PI;

      if (this.speedMph > 65) {
        this.speedMph = Math.max(55, this.speedMph - 45 * delta);
      }
      if (this.speedMph > 0.05) {
        const speedMps = this.speedMph * 0.44704;
        distanceMovedMeters = speedMps * delta;
        this.currentDistanceMeters += distanceMovedMeters * Math.cos(turnAngle) * this.uTurnFromDirection;
        this.currentDistanceMeters = Math.max(0, Math.min(this.projectedRoute.totalMeters, this.currentDistanceMeters));
        this.progress = this.currentDistanceMeters / this.projectedRoute.totalMeters;
      }
      this.steerAngle = THREE.MathUtils.damp(this.steerAngle, 0.35, 10.0, delta);

      if (rawT >= 1) {
        this.isTurningAround = false;
        this.driveDirection = this.uTurnFromDirection === 1 ? -1 : 1;
        this.laneOffset = 4.45;
        this.targetLaneOffset = 4.45;
        this.steerAngle = 0;
      }
    } else {
      if (this.committedExit) {
        // Phase 2: Naturally curving along the sweeping exit ramp off the main highway
        const exitMeters = this.committedExit.mileMarker * 1609.344;
        const signedDist = (this.currentDistanceMeters - exitMeters) * this.driveDirection;
        const rampGeom = getExitRampGeometryAtDistance(exitMeters + signedDist, exitMeters);

        if (isSteeringLeft) {
          this.rampLocalOffset = Math.max(-2.0, this.rampLocalOffset - laneShiftSpeed * 0.65 * delta);
          targetSteer = 0.25;
        } else if (isSteeringRight) {
          this.rampLocalOffset = Math.min(2.0, this.rampLocalOffset + laneShiftSpeed * 0.65 * delta);
          targetSteer = -0.25;
        } else {
          this.rampLocalOffset = THREE.MathUtils.damp(this.rampLocalOffset, 0, 2.5, delta);
        }

        this.laneOffset = rampGeom.centerOffset + this.rampLocalOffset;
        this.targetLaneOffset = this.laneOffset;
        this.rampHeadingSlope = THREE.MathUtils.damp(this.rampHeadingSlope, rampGeom.slopeDs, 6.0, delta);
        this.steerAngle = THREE.MathUtils.damp(this.steerAngle, targetSteer - Math.min(0.22, rampGeom.slopeDs * 0.8), 8.0, delta);
      } else {
        // Phase 1: Main highway driving (3 lanes each side) & auxiliary exit lane merge zone
        const maxLeftLaneOffset = 8.4;
        let maxRightLaneOffset = 8.4;
        let activeRampGeom: ReturnType<typeof getExitRampGeometryAtDistance> | null = null;

        if (this.activeUpcomingExit) {
          const exitMeters = this.activeUpcomingExit.mileMarker * 1609.344;
          const signedDist = (this.currentDistanceMeters - exitMeters) * this.driveDirection;
          if (signedDist >= -650 && signedDist <= 40) {
            activeRampGeom = getExitRampGeometryAtDistance(exitMeters + signedDist, exitMeters);
            maxRightLaneOffset = Math.max(8.4, activeRampGeom.rightEdge - 1.25);
          }
        }

        if (isSteeringLeft) {
          this.autoExitMerge = false;
          this.targetLaneOffset = Math.max(-maxLeftLaneOffset, this.targetLaneOffset - laneShiftSpeed * delta);
          targetSteer = 0.35;
        } else if (isSteeringRight) {
          this.targetLaneOffset = Math.min(maxRightLaneOffset, this.targetLaneOffset + laneShiftSpeed * delta);
          targetSteer = -0.35;
        } else if (this.autoExitMerge && activeRampGeom) {
          const desiredExitLaneCenter = Math.max(8.4, activeRampGeom.centerOffset);
          this.targetLaneOffset = Math.min(
            maxRightLaneOffset,
            Math.min(desiredExitLaneCenter, this.targetLaneOffset + laneShiftSpeed * 1.1 * delta)
          );
          if (this.targetLaneOffset < desiredExitLaneCenter - 0.15) {
            targetSteer = -0.22;
          }
        } else if (this.targetLaneOffset > maxRightLaneOffset) {
          this.targetLaneOffset = maxRightLaneOffset;
        }

        this.laneOffset = THREE.MathUtils.damp(this.laneOffset, this.targetLaneOffset, 8.5, delta);
        this.steerAngle = THREE.MathUtils.damp(this.steerAngle, targetSteer, 10.0, delta);
        this.rampHeadingSlope = THREE.MathUtils.damp(this.rampHeadingSlope, 0, 8.0, delta);
      }

      // -----------------------------------------------------------------
      // 2. STRICT 1:1 REAL-WORLD TRAVEL TIME PHYSICS
      // At 140 miles per hour, in 1 real-world hour (3600 seconds), travels exactly 140 miles!
      // At 40 miles per hour, moves 17.88 m/s (~4 car lengths per second).
      // -----------------------------------------------------------------
      if (this.speedMph > 0.05) {
        // 1 MPH = 0.44704 m/s = (1609.344 meters / 3600 seconds)
        const speedMps = this.speedMph * 0.44704;
        distanceMovedMeters = speedMps * delta;

        this.currentDistanceMeters += distanceMovedMeters * this.driveDirection;
        if (this.currentDistanceMeters >= this.projectedRoute.totalMeters) {
          this.currentDistanceMeters = this.projectedRoute.totalMeters;
          this.speedMph = 0; // Destination reached
          this.cruiseControl = false;
        } else if (this.currentDistanceMeters <= 0) {
          this.currentDistanceMeters = 0;
          this.speedMph = 0; // Origin reached
          this.cruiseControl = false;
        }
        this.progress = this.currentDistanceMeters / this.projectedRoute.totalMeters;
      }
    }

    // 3. Check 2-Phase Physical Exit Ramp Progression
    const activeExit = this.isTurningAround ? null : this.findUpcomingExit();
    this.activeUpcomingExit = activeExit;
    const now = performance.now();

    if (this.committedExit) {
      const exitForkMeters = this.committedExit.mileMarker * 1609.344;
      const signedBeyond = (this.currentDistanceMeters - exitForkMeters) * this.driveDirection;
      if (signedBeyond >= 480) {
        this.takeExit(this.committedExit);
        this.animFrameId = requestAnimationFrame(this.tick);
        return;
      }
    } else if (activeExit) {
      const exitForkMeters = activeExit.mileMarker * 1609.344;
      const signedBeyond = (this.currentDistanceMeters - exitForkMeters) * this.driveDirection;
      // Commit onto the curving ramp once the vehicle crosses the gore split while merged into the exit lane
      if (
        now - this.lastExitTakenTime > 5000 &&
        signedBeyond >= 0 &&
        signedBeyond <= 120 &&
        this.laneOffset >= 8.9
      ) {
        const rampGeom = getExitRampGeometryAtDistance(exitForkMeters + signedBeyond, exitForkMeters);
        this.committedExit = activeExit;
        this.autoExitMerge = false;
        this.rampLocalOffset = Math.max(-2.0, Math.min(2.0, this.laneOffset - rampGeom.centerOffset));
      }
    } else {
      this.autoExitMerge = false;
    }

    // 3b. Check City / Town Entry Prompt Detection
    if (!this.isTownPaused && !this.isTurningAround && !this.committedExit) {
      const routeTowns = this.currentRoute.towns;
      if (routeTowns && routeTowns.length > 0) {
        const currentMileForTown = this.currentDistanceMeters / 1609.344;
        for (const town of routeTowns) {
          const distFromTown = Math.abs(currentMileForTown - town.mileMarker);
          if (this.townCooldownIds.has(town.id) && distFromTown > 0.8) {
            this.townCooldownIds.delete(town.id);
          }
          if (
            this.speedMph > 1.0 &&
            distFromTown <= 0.22 &&
            !this.townCooldownIds.has(town.id)
          ) {
            this.townCooldownIds.add(town.id);
            this.onTownEntered?.(town);
            break;
          }
        }
      }
    }

    // 4. Update Vehicle, Highway Streamer & Live Cockpit Displays
    const frame = this.updateHighwayAndVehicle(delta, distanceMovedMeters);
    const loc = getRouteLocationAtProgress(this.projectedRoute, this.progress);

    if (this.cameraMode === 'driver') {
      const liveRpm = 800 + (this.speedMph % 38) * 105;
      const liveGear = this.speedMph < 5 ? 'N' : `D${Math.min(8, Math.floor(this.speedMph / 35) + 1)}`;
      const nav = this._cockpitNavData;
      nav.routeId = this.currentRoute.id;
      nav.highwayCode = this.currentRoute.highwayCode;
      nav.routeName = this.currentRoute.name;
      nav.waypoints = this.currentRoute.waypoints;
      nav.exits = this.currentRoute.exits;
      nav.towns = this.currentRoute.towns;
      nav.progress = this.progress;
      nav.currentLat = loc.lat;
      nav.currentLon = loc.lon;
      nav.currentMile = this.currentDistanceMeters / 1609.344;
      nav.totalMiles = this.projectedRoute.totalMiles;
      nav.city = loc.city;
      nav.state = loc.state;
      nav.driveDirection = this.driveDirection;
      nav.destName = this.currentRoute.destName;
      nav.originName = this.currentRoute.originName;
      nav.isDetour = !!this.currentRoute.isDetour;
      if (activeExit) {
        const signedRemM = (activeExit.mileMarker * 1609.344 - this.currentDistanceMeters) * this.driveDirection;
        this._cockpitExitData.exitNumber = activeExit.exitNumber;
        this._cockpitExitData.branchHighwayCode = activeExit.branchHighwayCode || activeExit.highwayCode || '';
        this._cockpitExitData.destination = activeExit.destinationCity || activeExit.destination || '';
        this._cockpitExitData.distanceMiles = Math.max(0, signedRemM / 1609.344);
        this._cockpitExitData.canTakeExit = Math.abs(signedRemM) <= 750;
        this._cockpitExitData.isTakingExit = !!this.committedExit || this.autoExitMerge;
        nav.upcomingExit = this._cockpitExitData;
      } else {
        nav.upcomingExit = null;
      }
      this.vehicleController.updateCockpitDisplay(
        this.speedMph,
        liveRpm,
        liveGear,
        this.isBoosting && this.speedMph > 40,
        nav
      );
    }

    // 5. Update Scenery
    if (this.sceneryManager) {
      this.sceneryManager.update(elapsedTime, this.vehicleController.group.position, loc.biome);
    }

    // 6. Update Camera
    this.updateCamera(delta, frame);

    // 7. Update Web Audio Engine Sound
    this.updateAudioPitch();

    // 8. Broadcast Telemetry to HUD (throttled ~15Hz for smooth React UI, immediate on discrete state change)
    if (this.onTelemetryUpdate) {
      const stateKey = `${this.currentRoute.id}|${this.driveDirection}|${this.isTurningAround}|${this.isTownPaused}|${activeExit?.id ?? ''}|${this.committedExit?.id ?? ''}|${this.autoExitMerge}|${this.cruiseControl}|${this.isBoosting}`;
      if (stateKey !== this.lastTelemetryStateKey || now - this.lastTelemetryEmitTime >= 65) {
        this.lastTelemetryStateKey = stateKey;
        this.lastTelemetryEmitTime = now;
        const currentMileExact = this.currentDistanceMeters / 1609.344;
        const rpm = 800 + (this.speedMph % 38) * 105;
        const gear = this.speedMph < 5 ? 'N' : `D${Math.min(8, Math.floor(this.speedMph / 35) + 1)}`;
        const signedRemainingMeters = activeExit
          ? (activeExit.mileMarker * 1609.344 - this.currentDistanceMeters) * this.driveDirection
          : 0;

        this.onTelemetryUpdate({
          speedMph: Math.round(this.speedMph),
          maxSpeedMph: this.maxSpeedMph,
          currentMile: Math.round(currentMileExact * 10) / 10,
          totalMiles: this.projectedRoute.totalMiles,
          currentLat: Number(loc.lat.toFixed(4)),
          currentLon: Number(loc.lon.toFixed(4)),
          currentElevationFeet: loc.elevationFeet,
          currentState: loc.state,
          currentCity: loc.city,
          currentBiome: loc.biome,
          highwayName: this.currentRoute.highwayCode,
          progressPercent: Math.min(100, Math.round(this.progress * 1000) / 10),
          timeOfDayHours: this.timeOfDayHours,
          gear,
          rpm: Math.round(rpm),
          laneOffset: this.laneOffset,
          isBoosting: this.isBoosting,
          cruiseControl: this.cruiseControl,
          cruiseTargetSpeedMph: this.cruiseTargetSpeedMph,
          travelMultiplier: 1, // Strict 1:1 real-world travel
          driveDirection: this.driveDirection,
          isTurningAround: this.isTurningAround,
          isTownPaused: this.isTownPaused,
          isDetour: !!this.currentRoute.isDetour,
          detourWarning: this.currentRoute.detourWarning,
          upcomingExit: activeExit ? {
            id: activeExit.id,
            exitNumber: activeExit.exitNumber,
            highwayCode: activeExit.branchHighwayCode || activeExit.highwayCode || '',
            branchHighwayCode: activeExit.branchHighwayCode || activeExit.highwayCode || '',
            destination: activeExit.destinationCity || activeExit.destination || '',
            destinationCity: activeExit.destinationCity || activeExit.destination || '',
            distanceMiles: Math.max(0, Math.round((signedRemainingMeters / 1609.344) * 10) / 10),
            mileMarker: activeExit.mileMarker,
            canTakeExit: Math.abs(signedRemainingMeters) <= 750,
            isTakingExit: !!this.committedExit || this.autoExitMerge,
          } : null,
        });
      }
    }

    // 9. Render Scene (pace software WebGL with GPU fence sync so main thread never starves)
    this.renderer.render(this.scene, this.camera);
    this.scheduleNextTick();
  };

  private scheduleNextTick() {
    if (this.isDisposed) return;
    if (!this.isSoftwareGl) {
      this.animFrameId = requestAnimationFrame(this.tick);
      return;
    }

    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (!gl || typeof gl.fenceSync !== 'function') {
      this.fenceTimerId = window.setTimeout(this.tick, 80);
      return;
    }
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.isDisposed) {
        if (sync) gl.deleteSync(sync);
        return;
      }
      const state = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
      if (state === gl.UNSIGNALED) {
        this.fenceTimerId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.fenceTimerId = window.setTimeout(this.tick, 80);
      }
    };
    this.fenceTimerId = window.setTimeout(poll, 5);
  }

  public toggleAudio(): boolean {
    if (!this.audioCtx) {
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioCtx = new AudioCtxClass();

      this.engineOsc = this.audioCtx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.setValueAtTime(65, this.audioCtx.currentTime);

      this.engineGain = this.audioCtx.createGain();
      this.engineGain.gain.setValueAtTime(0.04, this.audioCtx.currentTime);

      const filter = this.audioCtx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(450, this.audioCtx.currentTime);

      this.engineOsc.connect(filter);
      filter.connect(this.engineGain);
      this.engineGain.connect(this.audioCtx.destination);
      this.engineOsc.start();
    }

    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }

    this.isAudioMuted = !this.isAudioMuted;
    if (this.engineGain) {
      this.engineGain.gain.setValueAtTime(this.isAudioMuted ? 0 : 0.04, this.audioCtx.currentTime);
    }
    return !this.isAudioMuted;
  }

  private updateAudioPitch() {
    if (!this.engineOsc || !this.audioCtx || this.isAudioMuted) return;
    const baseFreq = 55;
    const speedPitch = (this.speedMph / 210) * 165;
    const boostPitch = this.isBoosting ? 50 : 0;
    this.engineOsc.frequency.setTargetAtTime(
      baseFreq + speedPitch + boostPitch,
      this.audioCtx.currentTime,
      0.05
    );
  }

  public jumpToProgress(targetProgress: number) {
    this.progress = Math.max(0, Math.min(0.999, targetProgress));
    this.currentDistanceMeters = this.progress * this.projectedRoute.totalMeters;
    this.isTurningAround = false;
    this.isTownPaused = false;
    this.townCooldownIds.clear();
    this.committedExit = null;
    this.autoExitMerge = false;
    this.rampLocalOffset = 0;
    this.rampHeadingSlope = 0;
    this.activeUpcomingExit = this.findUpcomingExit();
    this.updateHighwayAndVehicle(0, 0);
    this.initCameraPosition();
  }

  public dispose() {
    this.isDisposed = true;
    cancelAnimationFrame(this.animFrameId);
    window.clearTimeout(this.fenceTimerId);
    this.timer.dispose();
    window.removeEventListener('resize', this.onWindowResize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);

    if (this.audioCtx) {
      this.audioCtx.close();
    }

    this.streamer.dispose();
    if (this.sceneryManager) {
      this.sceneryManager.dispose();
    }
    this.renderer.dispose();

    if (this.renderer.domElement && this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  }
}
