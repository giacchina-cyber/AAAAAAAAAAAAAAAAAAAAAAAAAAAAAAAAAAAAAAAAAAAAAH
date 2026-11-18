export interface GPSCoord {
  lat: number;
  lon: number;
  elevation?: number; // meters above sea level
  name?: string;
  state?: string;
  biome?: 'eastern_forest' | 'midwest_plains' | 'rockies' | 'desert' | 'pacific_coast';
}

export interface HighwayExit {
  id: string;
  exitNumber: string;
  mileMarker: number; // Mile along parent route where the exit fork begins
  name: string; // e.g. "I-75 South"
  destinationCity: string; // e.g. "Cincinnati / Atlanta"
  destination?: string;
  branchRouteId: string; // ID of the route this exit branches into
  targetRouteId?: string;
  branchHighwayCode: string;
  highwayCode?: string;
  side: 'right' | 'left';
  signHeader?: string;
  targetMileMarker?: number; // Mile marker on target route to enter at
  returnMileMarker?: number; // Where it can rejoin the parent route
}

export interface TownStop {
  id: string;
  name: string;
  state: string;
  mileMarker: number; // Mile along route where the city/town entry is located
  lat: number;
  lon: number;
  type: 'city' | 'town';
}

export interface HighwayRoute {
  id: string;
  name: string;
  subtitle: string;
  highwayCode: string;
  totalMiles: number;
  waypoints: GPSCoord[];
  originName: string;
  destName: string;
  isDetour?: boolean;
  detourWarning?: string;
  parentRouteId?: string;
  exits?: HighwayExit[];
  towns?: TownStop[];
}

export interface ProjectedPoint {
  x: number;
  y: number;
  z: number;
  lat: number;
  lon: number;
  elevation: number;
  distanceFromStartMiles: number;
  progress: number; // 0 to 1
  name?: string;
  state?: string;
  biome: 'eastern_forest' | 'midwest_plains' | 'rockies' | 'desert' | 'pacific_coast';
}

export interface UpcomingExitTelemetry {
  id?: string;
  exitNumber: string;
  name?: string;
  destination: string;
  destinationCity?: string;
  branchHighwayCode?: string;
  highwayCode: string;
  distanceMiles: number;
  mileMarker?: number;
  canTakeExit?: boolean;
  isTakingExit?: boolean;
}

export interface VehicleTelemetry {
  speedMph: number;
  maxSpeedMph: number;
  currentMile: number;
  totalMiles: number;
  currentLat: number;
  currentLon: number;
  currentElevationFeet: number;
  currentState: string;
  currentCity: string;
  currentBiome: string;
  highwayName: string;
  progressPercent: number;
  timeOfDayHours: number; // 0 - 24
  gear: string;
  rpm: number;
  laneOffset: number; // -1 to 1 (left to right lanes)
  isBoosting: boolean;
  cruiseControl: boolean;
  cruiseTargetSpeedMph?: number;
  travelMultiplier: number;
  driveDirection: 1 | -1;
  isTurningAround?: boolean;
  isDetour: boolean;
  detourWarning?: string;
  upcomingExit?: UpcomingExitTelemetry | null;
  isTownPaused?: boolean;
}

export type CameraViewMode = 'chase' | 'driver' | 'cinematic' | 'drone' | 'overhead';

export type TrunkItemCategory = 'supply' | 'gear' | 'luggage' | 'tool' | 'cargo' | 'weapon' | 'misc';

export type WeaponCategory = 'Pistol' | 'Assault Rifle' | 'Hunting Rifle' | 'Shotgun';

export interface ScavengedWeapon {
  id: string;
  name: string;
  category: WeaponCategory;
  damage: number; // 15 - 95
}

export interface PassengerSlot {
  id: string;
  name: string;
  seatIndex: number; // 0 = Front Passenger, 1 = Rear Left, 2 = Rear Right
  role?: string;
  destinationCity?: string;
  boardedAtMile?: number;
  notes?: string;
}

export interface TrunkItem {
  id: string;
  name: string;
  category: TrunkItemCategory;
  slotIndex: number; // 0..5
  notes?: string;
  addedAtMile?: number;
  weaponCategory?: WeaponCategory;
  damage?: number;
}

export interface VehicleStorageSpec {
  vehicleId: string;
  vehicleName: string;
  maxPassengers: number;
  maxTrunkItems: number;
  seatLabels: string[];
}

export interface VehicleStorageState {
  spec: VehicleStorageSpec;
  passengers: (PassengerSlot | null)[];
  trunk: (TrunkItem | null)[];
}

