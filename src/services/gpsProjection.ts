import * as THREE from 'three';
import { GPSCoord, ProjectedPoint, HighwayRoute } from '../types';

/**
 * Calculates great-circle distance between two GPS coordinates in miles using Haversine formula.
 */
export function haversineDistanceMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8; // Radius of the Earth in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export interface ProjectedRoute {
  points: ProjectedPoint[];
  curve: THREE.CatmullRomCurve3;
  totalLengthWorldUnits: number;
  totalMiles: number;
  totalMeters: number;
  originLat: number;
  originLon: number;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

/**
 * Translates GPS coordinates (lat, lon, elevation) into a continuous 3D coordinate space.
 * 
 * 1 Three.js unit = 1 real-world meter:
 * - X corresponds to East (+X) / West (-X) in meters
 * - Z corresponds to North (-Z) / South (+Z) in meters
 * - Y corresponds to Elevation (+Y) in meters
 * 
 * This ensures exact 1:1 physical velocity: at 40 MPH, you move 17.88 m/s (~4 car lengths/sec);
 * at 140 MPH, you move 62.58 m/s (~14 car lengths/sec), and in 1 real-world hour you travel exactly 140 miles.
 */
export function projectRouteTo3D(route: HighwayRoute): ProjectedRoute {
  const waypoints = route.waypoints;
  if (!waypoints || waypoints.length < 2) {
    throw new Error('A route must have at least 2 waypoints.');
  }

  const originLat = waypoints[0].lat;
  const originLon = waypoints[0].lon;
  const latRad = (originLat * Math.PI) / 180;

  // Earth metrics (meters per degree)
  const METERS_PER_DEG_LAT = 111132;
  const METERS_PER_DEG_LON = 111132 * Math.cos(latRad);

  // 1 unit = 1 real-world meter
  const WORLD_SCALE = 1.0;
  // Natural elevation in meters (clamped grade)
  const ELEVATION_SCALE = 1.0;

  let cumulativeDistanceMiles = 0;
  const rawPoints: { x: number; y: number; z: number; dist: number; wp: GPSCoord }[] = [];

  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i];
    if (i > 0) {
      cumulativeDistanceMiles += haversineDistanceMiles(
        waypoints[i - 1].lat,
        waypoints[i - 1].lon,
        wp.lat,
        wp.lon
      );
    }

    const dLon = wp.lon - originLon;
    const dLat = wp.lat - originLat;

    // Easting (meters)
    const eastMeters = dLon * METERS_PER_DEG_LON;
    // Northing (meters) - in Three.js -Z is forward/north
    const northMeters = dLat * METERS_PER_DEG_LAT;

    const x = eastMeters * WORLD_SCALE;
    const z = -northMeters * WORLD_SCALE;
    const y = ((wp.elevation ?? 20) - (waypoints[0].elevation ?? 20)) * ELEVATION_SCALE;

    rawPoints.push({ x, y, z, dist: cumulativeDistanceMiles, wp });
  }

  const totalMiles = cumulativeDistanceMiles > 0 ? cumulativeDistanceMiles : route.totalMiles;
  const totalMeters = totalMiles * 1609.344;

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const projectedPoints: ProjectedPoint[] = rawPoints.map((pt) => {
    minX = Math.min(minX, pt.x);
    maxX = Math.max(maxX, pt.x);
    minZ = Math.min(minZ, pt.z);
    maxZ = Math.max(maxZ, pt.z);

    return {
      x: pt.x,
      y: pt.y,
      z: pt.z,
      lat: pt.wp.lat,
      lon: pt.wp.lon,
      elevation: pt.wp.elevation ?? 50,
      distanceFromStartMiles: pt.dist,
      progress: totalMiles > 0 ? pt.dist / totalMiles : 0,
      name: pt.wp.name,
      state: pt.wp.state,
      biome: pt.wp.biome ?? 'midwest_plains',
    };
  });

  // Build smooth 3D Catmull-Rom spline curve through the 3D waypoints in meters
  const vectors = projectedPoints.map((p) => new THREE.Vector3(p.x, p.y, p.z));
  const curve = new THREE.CatmullRomCurve3(vectors, false, 'centripetal', 0.15);
  const totalLengthWorldUnits = curve.getLength();

  return {
    points: projectedPoints,
    curve,
    totalLengthWorldUnits,
    totalMiles,
    totalMeters,
    originLat,
    originLon,
    bounds: { minX, maxX, minZ, maxZ },
  };
}

/**
 * Given normalized highway progress t [0, 1], get current state, city, and elevation.
 */
export function getRouteLocationAtProgress(
  projectedRoute: ProjectedRoute,
  progress: number
): {
  city: string;
  state: string;
  biome: 'eastern_forest' | 'midwest_plains' | 'rockies' | 'desert' | 'pacific_coast';
  lat: number;
  lon: number;
  elevationFeet: number;
  currentMile: number;
} {
  const pts = projectedRoute.points;
  const clampedProgress = Math.max(0, Math.min(1, progress));
  const targetMile = clampedProgress * projectedRoute.totalMiles;

  // Find surrounding waypoints
  let idx = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    if (targetMile >= pts[i].distanceFromStartMiles && targetMile <= pts[i + 1].distanceFromStartMiles) {
      idx = i;
      break;
    }
  }

  const p0 = pts[idx];
  const p1 = pts[Math.min(pts.length - 1, idx + 1)];
  const segmentSpan = Math.max(0.001, p1.distanceFromStartMiles - p0.distanceFromStartMiles);
  const ratio = Math.max(0, Math.min(1, (targetMile - p0.distanceFromStartMiles) / segmentSpan));

  const lat = p0.lat + (p1.lat - p0.lat) * ratio;
  const lon = p0.lon + (p1.lon - p0.lon) * ratio;
  const elevationMeters = p0.elevation + (p1.elevation - p0.elevation) * ratio;
  const elevationFeet = Math.round(elevationMeters * 3.28084);

  const activeWp = ratio < 0.5 ? p0 : p1;

  return {
    city: activeWp.name ?? 'US Interstate',
    state: activeWp.state ?? 'USA',
    biome: activeWp.biome,
    lat,
    lon,
    elevationFeet,
    currentMile: Math.round(targetMile),
  };
}
