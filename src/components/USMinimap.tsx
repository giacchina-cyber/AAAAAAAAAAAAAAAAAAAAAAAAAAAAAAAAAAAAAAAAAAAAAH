import React, { useMemo, useState } from 'react';
import { ZoomIn, ZoomOut, RotateCcw, Crosshair, Layers } from 'lucide-react';
import { HighwayRoute, TownStop, VehicleTelemetry } from '../types';
import { ALL_ROUTES } from '../data/routes';
import { haversineDistanceMiles } from '../services/gpsProjection';

interface USMinimapProps {
  route: HighwayRoute;
  telemetry: VehicleTelemetry | null;
  onWaypointClick?: (progress: number) => void;
  onSelectRoute?: (route: HighwayRoute) => void;
}

const ZOOM_LEVELS = [1, 2.5, 5, 10] as const;

/**
 * A vector representation of the US lower-48 map showing the route path(s),
 * highway exits, live vehicle marker, all-routes toggle filter, and zoom
 * controls centered on the closest upcoming exit.
 */
export const USMinimap: React.FC<USMinimapProps> = ({
  route,
  telemetry,
  onWaypointClick,
  onSelectRoute,
}) => {
  const [zoomIndex, setZoomIndex] = useState<number>(0);
  const [showAllRoutes, setShowAllRoutes] = useState<boolean>(false);
  const [hoveredRouteId, setHoveredRouteId] = useState<string | null>(null);
  const [hoveredTownId, setHoveredTownId] = useState<string | null>(null);

  const mapWidth = 320;
  const mapHeight = 170;

  // Lon/Lat to SVG XY projection
  const minLon = -124.8;
  const maxLon = -66.9;
  const minLat = 24.5;
  const maxLat = 49.0;

  const projectToSvg = (lat: number, lon: number): [number, number] => {
    const x = ((lon - minLon) / (maxLon - minLon)) * (mapWidth - 24) + 12;
    const y = ((maxLat - lat) / (maxLat - minLat)) * (mapHeight - 24) + 12;
    return [x, y];
  };

  // Precompute cumulative mileage & projected exit/town markers along active route
  const { routeTotalMiles, projectedExits, projectedTowns } = useMemo(() => {
    const wpMiles: number[] = [0];
    for (let i = 1; i < route.waypoints.length; i++) {
      wpMiles.push(
        wpMiles[i - 1] +
          haversineDistanceMiles(
            route.waypoints[i - 1].lat,
            route.waypoints[i - 1].lon,
            route.waypoints[i].lat,
            route.waypoints[i].lon
          )
      );
    }
    const total = wpMiles[wpMiles.length - 1] > 0 ? wpMiles[wpMiles.length - 1] : route.totalMiles;

    const getCoordAtMile = (mile: number): { lat: number; lon: number } => {
      const clamped = Math.max(0, Math.min(total, mile));
      for (let i = 0; i < wpMiles.length - 1; i++) {
        const m0 = wpMiles[i];
        const m1 = wpMiles[i + 1];
        if (clamped >= m0 && clamped <= m1) {
          const span = Math.max(0.0001, m1 - m0);
          const t = (clamped - m0) / span;
          const w0 = route.waypoints[i];
          const w1 = route.waypoints[i + 1];
          return {
            lat: w0.lat + (w1.lat - w0.lat) * t,
            lon: w0.lon + (w1.lon - w0.lon) * t,
          };
        }
      }
      const last = route.waypoints[route.waypoints.length - 1];
      return { lat: last.lat, lon: last.lon };
    };

    const exits = (route.exits ?? []).map((exit) => {
      const coord = getCoordAtMile(exit.mileMarker);
      const [x, y] = projectToSvg(coord.lat, coord.lon);
      return {
        exit,
        x,
        y,
      };
    });

    const towns = (route.towns ?? []).map((town) => {
      const [x, y] = projectToSvg(town.lat, town.lon);
      return {
        town,
        x,
        y,
      };
    });

    return { routeTotalMiles: total, projectedExits: exits, projectedTowns: towns };
  }, [route]);

  // Precompute SVG paths for all routes in the network
  const allRoutePaths = useMemo(() => {
    return ALL_ROUTES.map((r) => {
      const d = r.waypoints
        .map((wp, index) => {
          const [x, y] = projectToSvg(wp.lat, wp.lon);
          return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
        })
        .join(' ');
      const midWp = r.waypoints[Math.floor(r.waypoints.length / 2)];
      const [midX, midY] = midWp ? projectToSvg(midWp.lat, midWp.lon) : [0, 0];
      return {
        route: r,
        pathData: d,
        midX,
        midY,
      };
    });
  }, []);

  // Build memoized SVG path & key waypoint dots for active route
  const { pathData, waypointDots } = useMemo(() => {
    const d = route.waypoints
      .map((wp, index) => {
        const [x, y] = projectToSvg(wp.lat, wp.lon);
        return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');

    const dots: { index: number; x: number; y: number; name?: string; isStart: boolean; isEnd: boolean; progress: number }[] = [];
    const lastIdx = route.waypoints.length - 1;
    route.waypoints.forEach((wp, i) => {
      if (i === 0 || i === lastIdx || i % 6 === 0) {
        const [wx, wy] = projectToSvg(wp.lat, wp.lon);
        dots.push({
          index: i,
          x: wx,
          y: wy,
          name: wp.name,
          isStart: i === 0,
          isEnd: i === lastIdx,
          progress: lastIdx > 0 ? i / lastIdx : 0,
        });
      }
    });

    return { pathData: d, waypointDots: dots };
  }, [route]);

  // Current car marker position
  let carPos: [number, number] = [0, 0];
  if (telemetry) {
    carPos = projectToSvg(telemetry.currentLat, telemetry.currentLon);
  } else if (route.waypoints.length > 0) {
    carPos = projectToSvg(route.waypoints[0].lat, route.waypoints[0].lon);
  }

  // Determine closest upcoming exit from current mileage & travel direction
  const currentMile = telemetry?.currentMile ?? 0;
  const driveDir = telemetry?.driveDirection ?? 1;
  const closestUpcomingExit = useMemo(() => {
    if (projectedExits.length === 0) return null;
    const upcoming = projectedExits
      .filter((item) =>
        driveDir === 1
          ? item.exit.mileMarker >= currentMile - 0.35
          : item.exit.mileMarker <= currentMile + 0.35
      )
      .sort((a, b) =>
        driveDir === 1
          ? a.exit.mileMarker - b.exit.mileMarker
          : b.exit.mileMarker - a.exit.mileMarker
      );
    if (upcoming.length > 0) return upcoming[0];
    return driveDir === 1 ? projectedExits[projectedExits.length - 1] : projectedExits[0];
  }, [projectedExits, currentMile, driveDir]);

  const closestUpcomingTown = useMemo(() => {
    if (projectedTowns.length === 0) return null;
    const upcoming = projectedTowns
      .filter((item) =>
        driveDir === 1
          ? item.town.mileMarker >= currentMile - 0.25
          : item.town.mileMarker <= currentMile + 0.25
      )
      .sort((a, b) =>
        driveDir === 1
          ? a.town.mileMarker - b.town.mileMarker
          : b.town.mileMarker - a.town.mileMarker
      );
    return upcoming.length > 0 ? upcoming[0] : null;
  }, [projectedTowns, currentMile, driveDir]);

  // Compute viewBox for active zoom level
  const zoomScale = ZOOM_LEVELS[zoomIndex];
  const invScale = 1 / zoomScale;
  const vw = mapWidth / zoomScale;
  const vh = mapHeight / zoomScale;

  let vx = 0;
  let vy = 0;
  if (zoomScale > 1) {
    let cx = carPos[0];
    let cy = carPos[1];
    if (closestUpcomingExit) {
      const dx = Math.abs(closestUpcomingExit.x - carPos[0]);
      const dy = Math.abs(closestUpcomingExit.y - carPos[1]);
      if (dx <= vw * 0.55 && dy <= vh * 0.55) {
        cx = (carPos[0] + closestUpcomingExit.x) / 2;
        cy = (carPos[1] + closestUpcomingExit.y) / 2;
      } else {
        cx = closestUpcomingExit.x;
        cy = closestUpcomingExit.y;
      }
    }
    vx = Math.max(-8, Math.min(mapWidth - vw + 8, cx - vw / 2));
    vy = Math.max(-8, Math.min(mapHeight - vh + 8, cy - vh / 2));
  }

  const upcomingDistMiles = closestUpcomingExit
    ? Math.max(0, Math.round((closestUpcomingExit.exit.mileMarker - currentMile) * driveDir * 10) / 10)
    : null;

  const hoveredRoute = useMemo(
    () => (hoveredRouteId ? ALL_ROUTES.find((r) => r.id === hoveredRouteId) ?? null : null),
    [hoveredRouteId]
  );

  const hoveredTown: TownStop | null = useMemo(
    () => (hoveredTownId ? projectedTowns.find((t) => t.town.id === hoveredTownId)?.town ?? null : null),
    [hoveredTownId, projectedTowns]
  );

  return (
    <div className="relative bg-slate-900/90 border border-slate-700/80 rounded-xl p-2.5 shadow-xl select-none">
      <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-slate-800 text-xs">
        <span className="font-semibold text-slate-200 flex items-center gap-1.5 truncate">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 shrink-0"></span>
          <span className="truncate">TRANSCONTINENTAL RADAR</span>
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {closestUpcomingExit && (
            <button
              onClick={() => setZoomIndex((prev) => (prev >= 2 ? 0 : 2))}
              className={`px-1.5 py-0.5 rounded text-[10px] font-bold border transition flex items-center gap-1 cursor-pointer ${
                zoomIndex > 0
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50 hover:bg-emerald-500/30'
                  : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
              }`}
              title="Zoom map to closest upcoming exit"
            >
              <Crosshair className="w-3 h-3" />
              Exit
            </button>
          )}
          <button
            onClick={() => setZoomIndex((prev) => Math.max(0, prev - 1))}
            disabled={zoomIndex === 0}
            className="p-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-35 disabled:pointer-events-none text-slate-200 border border-slate-700 transition cursor-pointer"
            title="Zoom out map"
            aria-label="Zoom out map"
          >
            <ZoomOut className="w-3 h-3" />
          </button>
          <span className="text-[10px] font-mono font-bold text-amber-400 min-w-[28px] text-center">
            {zoomScale}x
          </span>
          <button
            onClick={() => setZoomIndex((prev) => Math.min(ZOOM_LEVELS.length - 1, prev + 1))}
            disabled={zoomIndex === ZOOM_LEVELS.length - 1}
            className="p-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-35 disabled:pointer-events-none text-slate-200 border border-slate-700 transition cursor-pointer"
            title="Zoom in map"
            aria-label="Zoom in map"
          >
            <ZoomIn className="w-3 h-3" />
          </button>
          {zoomIndex > 0 && (
            <button
              onClick={() => setZoomIndex(0)}
              className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition cursor-pointer"
              title="Reset map zoom"
              aria-label="Reset map zoom"
            >
              <RotateCcw className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Map Route Filter Toolbar */}
      <div className="flex items-center justify-between gap-2 pt-1.5 pb-0.5 text-[10px]">
        <button
          type="button"
          onClick={() => setShowAllRoutes((prev) => !prev)}
          aria-pressed={showAllRoutes}
          className={`px-2 py-0.5 rounded font-bold border transition flex items-center gap-1 cursor-pointer ${
            showAllRoutes
              ? 'bg-sky-500/20 text-sky-300 border-sky-400/60 hover:bg-sky-500/30'
              : 'bg-slate-800/90 text-slate-300 border-slate-700 hover:bg-slate-700'
          }`}
          title={showAllRoutes ? 'Show only active route on radar' : 'Show all US highway routes on radar'}
        >
          <Layers className="w-3 h-3" />
          <span>{showAllRoutes ? `All Routes (${ALL_ROUTES.length})` : 'Show All Routes'}</span>
        </button>

        {showAllRoutes ? (
          <div className="flex items-center gap-2 text-[9px] text-slate-400 font-semibold truncate">
            {hoveredRoute ? (
              <span className="text-sky-300 font-bold truncate">
                {hoveredRoute.highwayCode} ({hoveredRoute.totalMiles} mi)
              </span>
            ) : (
              <>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-0.5 bg-amber-400 inline-block rounded"></span>Active
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-0.5 bg-sky-400 inline-block rounded"></span>Primary
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-0.5 bg-purple-400 inline-block rounded"></span>Branch
                </span>
              </>
            )}
          </div>
        ) : (
          <span className="text-[9px] text-slate-500 font-mono truncate">
            {route.highwayCode} Only
          </span>
        )}
      </div>

      <svg
        viewBox={`${vx.toFixed(2)} ${vy.toFixed(2)} ${vw.toFixed(2)} ${vh.toFixed(2)}`}
        className="w-full h-auto mt-1 rounded bg-slate-950/60"
        style={{ aspectRatio: `${mapWidth}/${mapHeight}` }}
      >
        <defs>
          <clipPath id="us-landmass-clip">
            <path d="M 12.4 15.7 L 19 17.1 L 23.1 18.4 L 24.5 21.1 L 23.9 15 L 22.4 12 L 56.7 12 L 118.1 12 L 163.6 12 L 163.6 9.9 L 172.5 14.1 L 182.2 17.7 L 192.2 18 L 179.2 25.1 L 187.9 26.4 L 200.6 21.2 L 203.2 26.7 L 218.8 27 L 216.9 30.8 L 207.3 31.1 L 204.5 32.6 L 200.1 38.7 L 205.5 34.2 L 201.9 41.3 L 200.7 47.5 L 202.1 54.4 L 203.7 56 L 208 53 L 208.1 43 L 210.1 36.4 L 216.8 31.3 L 223.5 35.5 L 221.3 43.9 L 226.7 41.6 L 228.7 47.9 L 225.5 51.7 L 223.4 55.5 L 232.3 56.7 L 240.6 52.9 L 246.7 48.4 L 245.8 46.2 L 253.3 46.3 L 258.9 45 L 259.7 40.5 L 267.9 35.8 L 275 35.8 L 284.5 35.8 L 286.6 34 L 292.2 26.9 L 296.1 21.2 L 301.9 22.4 L 303.5 26.3 L 306.1 34.8 L 307.7 36.9 L 301.4 39.7 L 290.9 43.8 L 289 49.8 L 286.9 51.6 L 291.2 53.4 L 292.4 55.7 L 285 56.8 L 282.2 59.4 L 272 61.1 L 271.8 62.2 L 271.8 64.4 L 267.1 72 L 264 69.2 L 266.3 74.9 L 261.6 82.8 L 259.9 78.1 L 261.6 84.2 L 263.9 93.9 L 258.8 97.5 L 251.5 102.3 L 241.6 108.8 L 236.7 113.1 L 233.9 118.4 L 233.9 123.1 L 235.9 130 L 238.4 134.5 L 240.9 144.9 L 240.1 150.4 L 238.7 154.1 L 235.4 154.1 L 231.8 148.2 L 226.8 138.5 L 227 131.5 L 218.8 125.5 L 213.7 127.1 L 204.5 123 L 199.9 123.7 L 193 124 L 194.1 130.9 L 186.8 130.6 L 178.1 127.9 L 170.2 126.7 L 165.4 129.4 L 157.4 134.8 L 153.6 138.3 L 153.4 148.8 L 147.7 148.8 L 141.3 140.1 L 134.2 129 L 129.3 126.4 L 121.9 131.2 L 116.5 127.9 L 105.6 114.7 L 96.8 114.6 L 96.8 117.3 L 92.5 117.3 L 82.3 117.3 L 63.2 110.4 L 51.3 110.1 L 45.6 102.9 L 37.3 98.9 L 34.1 98.7 L 31.9 92.7 L 26.7 85.8 L 23.7 78.9 L 17.5 71.9 L 14 63 L 15.1 55.2 L 13.2 48.6 L 15.8 38 L 15.8 28.4 L 14.3 20.9 Z" />
          </clipPath>
        </defs>

        {/* Continental USA Landmass Silhouette */}
        <path
          d="M 12.4 15.7 L 19 17.1 L 23.1 18.4 L 24.5 21.1 L 23.9 15 L 22.4 12 L 56.7 12 L 118.1 12 L 163.6 12 L 163.6 9.9 L 172.5 14.1 L 182.2 17.7 L 192.2 18 L 179.2 25.1 L 187.9 26.4 L 200.6 21.2 L 203.2 26.7 L 218.8 27 L 216.9 30.8 L 207.3 31.1 L 204.5 32.6 L 200.1 38.7 L 205.5 34.2 L 201.9 41.3 L 200.7 47.5 L 202.1 54.4 L 203.7 56 L 208 53 L 208.1 43 L 210.1 36.4 L 216.8 31.3 L 223.5 35.5 L 221.3 43.9 L 226.7 41.6 L 228.7 47.9 L 225.5 51.7 L 223.4 55.5 L 232.3 56.7 L 240.6 52.9 L 246.7 48.4 L 245.8 46.2 L 253.3 46.3 L 258.9 45 L 259.7 40.5 L 267.9 35.8 L 275 35.8 L 284.5 35.8 L 286.6 34 L 292.2 26.9 L 296.1 21.2 L 301.9 22.4 L 303.5 26.3 L 306.1 34.8 L 307.7 36.9 L 301.4 39.7 L 290.9 43.8 L 289 49.8 L 286.9 51.6 L 291.2 53.4 L 292.4 55.7 L 285 56.8 L 282.2 59.4 L 272 61.1 L 271.8 62.2 L 271.8 64.4 L 267.1 72 L 264 69.2 L 266.3 74.9 L 261.6 82.8 L 259.9 78.1 L 261.6 84.2 L 263.9 93.9 L 258.8 97.5 L 251.5 102.3 L 241.6 108.8 L 236.7 113.1 L 233.9 118.4 L 233.9 123.1 L 235.9 130 L 238.4 134.5 L 240.9 144.9 L 240.1 150.4 L 238.7 154.1 L 235.4 154.1 L 231.8 148.2 L 226.8 138.5 L 227 131.5 L 218.8 125.5 L 213.7 127.1 L 204.5 123 L 199.9 123.7 L 193 124 L 194.1 130.9 L 186.8 130.6 L 178.1 127.9 L 170.2 126.7 L 165.4 129.4 L 157.4 134.8 L 153.6 138.3 L 153.4 148.8 L 147.7 148.8 L 141.3 140.1 L 134.2 129 L 129.3 126.4 L 121.9 131.2 L 116.5 127.9 L 105.6 114.7 L 96.8 114.6 L 96.8 117.3 L 92.5 117.3 L 82.3 117.3 L 63.2 110.4 L 51.3 110.1 L 45.6 102.9 L 37.3 98.9 L 34.1 98.7 L 31.9 92.7 L 26.7 85.8 L 23.7 78.9 L 17.5 71.9 L 14 63 L 15.1 55.2 L 13.2 48.6 L 15.8 38 L 15.8 28.4 L 14.3 20.9 Z"
          fill="#1e293b"
          stroke="#475569"
          strokeWidth={1.2 * invScale}
          strokeLinejoin="round"
        />

        {/* Subtle regional divider hints clipped inside the US outline */}
        <g clipPath="url(#us-landmass-clip)" opacity={0.55}>
          <line x1="60" y1="12" x2="60" y2="155" stroke="#334155" strokeWidth={0.7 * invScale} strokeDasharray={`${2 * invScale},${3 * invScale}`} />
          <line x1="118" y1="12" x2="118" y2="155" stroke="#334155" strokeWidth={0.7 * invScale} strokeDasharray={`${2 * invScale},${3 * invScale}`} />
          <line x1="176" y1="12" x2="176" y2="155" stroke="#334155" strokeWidth={0.7 * invScale} strokeDasharray={`${2 * invScale},${3 * invScale}`} />
          <line x1="234" y1="12" x2="234" y2="155" stroke="#334155" strokeWidth={0.7 * invScale} strokeDasharray={`${2 * invScale},${3 * invScale}`} />
          <line x1="12" y1="54" x2="310" y2="54" stroke="#334155" strokeWidth={0.7 * invScale} strokeDasharray={`${2 * invScale},${3 * invScale}`} />
          <line x1="12" y1="92" x2="310" y2="92" stroke="#334155" strokeWidth={0.7 * invScale} strokeDasharray={`${2 * invScale},${3 * invScale}`} />
        </g>

        {/* Network Overlay: All Other US Routes (when filter is toggled ON) */}
        {showAllRoutes &&
          allRoutePaths
            .filter((item) => item.route.id !== route.id)
            .map(({ route: r, pathData: d }) => {
              const isHovered = hoveredRouteId === r.id;
              const baseStroke = r.isDetour
                ? isHovered
                  ? '#d8b4fe'
                  : '#a855f7'
                : isHovered
                ? '#7dd3fc'
                : '#38bdf8';
              return (
                <g
                  key={r.id}
                  className={onSelectRoute ? 'cursor-pointer' : undefined}
                  onMouseEnter={() => setHoveredRouteId(r.id)}
                  onMouseLeave={() => setHoveredRouteId((prev) => (prev === r.id ? null : prev))}
                  onClick={() => onSelectRoute?.(r)}
                >
                  <title>{`${r.highwayCode}: ${r.name} (${r.totalMiles.toLocaleString()} mi)${onSelectRoute ? ' — Click to switch' : ''}`}</title>
                  <path
                    d={d}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={7 * invScale}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d={d}
                    fill="none"
                    stroke={baseStroke}
                    strokeOpacity={isHovered ? 0.95 : r.isDetour ? 0.45 : 0.55}
                    strokeWidth={(isHovered ? 2.4 : r.isDetour ? 1.3 : 1.6) * invScale}
                    strokeDasharray={r.isDetour ? `${3.2 * invScale},${2.2 * invScale}` : undefined}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </g>
              );
            })}

        {/* Full Highway Route Path (Dark background guide) */}
        <path d={pathData} fill="none" stroke="#475569" strokeWidth={4 * invScale} strokeLinecap="round" strokeLinejoin="round" />
        {/* Active glowing highway route line */}
        <path d={pathData} fill="none" stroke="#f59e0b" strokeWidth={2.2 * invScale} strokeLinecap="round" strokeLinejoin="round" />

        {/* Key Waypoint Dots */}
        {waypointDots.map((dot) => (
          <g
            key={dot.index}
            className="cursor-pointer"
            onClick={() => onWaypointClick?.(dot.progress)}
          >
            <title>{dot.name ?? `Waypoint ${dot.index}`}</title>
            <circle
              cx={dot.x}
              cy={dot.y}
              r={(dot.isStart || dot.isEnd ? 4.5 : 2.1) * invScale}
              fill={dot.isStart ? '#10b981' : dot.isEnd ? '#ef4444' : '#94a3b8'}
              stroke="#0f172a"
              strokeWidth={1 * invScale}
            />
          </g>
        ))}

        {/* Cities & Towns along the Route */}
        {projectedTowns.map(({ town, x, y }) => {
          const isUpcoming = closestUpcomingTown?.town.id === town.id;
          const isHovered = hoveredTownId === town.id;
          const isCity = town.type === 'city';
          const showLabel = isHovered || (zoomScale >= 2.5 && (isCity || isUpcoming)) || zoomScale >= 5;
          const placeBelow = y - vy < vh * 0.25;
          const placeLeft = vx + vw - x < vw * 0.35;
          const labelY = placeBelow ? 11 : -7;
          const labelX = placeLeft ? -5 : 5;
          const anchor = placeLeft ? 'end' : 'start';

          return (
            <g
              key={town.id}
              transform={`translate(${x}, ${y}) scale(${invScale})`}
              className="cursor-pointer"
              onMouseEnter={() => setHoveredTownId(town.id)}
              onMouseLeave={() => setHoveredTownId((prev) => (prev === town.id ? null : prev))}
              onClick={() => {
                if (!onWaypointClick || routeTotalMiles <= 0) return;
                const jumpMile = Math.max(0, Math.min(routeTotalMiles, town.mileMarker - 0.35 * driveDir));
                onWaypointClick(jumpMile / routeTotalMiles);
              }}
            >
              <title>{`${town.name}, ${town.state} (${isCity ? 'City' : 'Town'} • Mile ${town.mileMarker}) — Click to drive in`}</title>
              {(isUpcoming || isHovered) && (
                <circle r={isCity ? 6.8 : 5.4} fill="none" stroke="#f59e0b" strokeWidth="1.2" opacity="0.9" />
              )}
              <circle
                r={isCity ? (isHovered ? 4.0 : 3.2) : (isHovered ? 3.1 : 2.3)}
                fill={isCity ? '#fbbf24' : '#f8fafc'}
                stroke="#0f172a"
                strokeWidth="1"
              />
              {showLabel && (
                <g transform={`translate(${labelX}, ${labelY})`}>
                  <text
                    textAnchor={anchor}
                    fontSize="7.5"
                    fontWeight="800"
                    fontFamily="sans-serif"
                    fill={isCity ? '#fde68a' : '#f1f5f9'}
                    stroke="#020617"
                    strokeWidth="2.4"
                    paintOrder="stroke"
                  >
                    {`${town.name}, ${town.state}`}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {/* Highway Exit Markers */}
        {projectedExits.map(({ exit, x, y }) => {
          const isClosest = closestUpcomingExit?.exit.id === exit.id;
          const placeBelow = y - vy < vh * 0.25;
          const placeLeft = vx + vw - x < vw * 0.35;
          const labelY = placeBelow ? 14 : -11;
          const labelX = placeLeft ? -6 : 6;
          const anchor = placeLeft ? 'end' : 'start';

          return (
            <g
              key={exit.id}
              transform={`translate(${x}, ${y}) scale(${invScale})`}
              className="cursor-pointer"
              onClick={() => {
                if (!onWaypointClick || routeTotalMiles <= 0) return;
                const jumpMile = Math.max(0, Math.min(routeTotalMiles, exit.mileMarker - 0.8 * driveDir));
                onWaypointClick(jumpMile / routeTotalMiles);
              }}
            >
              <title>{`Exit ${exit.exitNumber}: ${exit.branchHighwayCode} (${exit.destinationCity}) • Mile ${exit.mileMarker}`}</title>
              {isClosest && (
                <circle r="8.5" fill="none" stroke="#34d399" strokeWidth="1.5" opacity="0.85" />
              )}
              <rect
                x={isClosest ? -3.5 : -2.2}
                y={isClosest ? -3.5 : -2.2}
                width={isClosest ? 7 : 4.4}
                height={isClosest ? 7 : 4.4}
                rx="1.5"
                fill={isClosest ? '#10b981' : '#334155'}
                stroke={isClosest ? '#ecfdf5' : '#94a3b8'}
                strokeWidth="1"
              />
              {(isClosest || zoomScale >= 5) && (
                <g transform={`translate(${labelX}, ${labelY})`}>
                  <text
                    textAnchor={anchor}
                    fontSize="8.5"
                    fontWeight="800"
                    fontFamily="monospace"
                    fill="#ecfdf5"
                    stroke="#020617"
                    strokeWidth="2.5"
                    paintOrder="stroke"
                  >
                    {`EX ${exit.exitNumber} • ${exit.branchHighwayCode}`}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {/* Moving Vehicle Live Marker */}
        {carPos[0] > 0 && (
          <g transform={`translate(${carPos[0]}, ${carPos[1]}) scale(${invScale})`}>
            <circle r="7" fill="none" stroke="#38bdf8" strokeWidth="1.5" opacity="0.8" />
            <circle r="3.5" fill="#38bdf8" stroke="#ffffff" strokeWidth="1.2" />
          </g>
        )}
      </svg>

      {hoveredTown ? (
        <div className="flex items-center justify-between text-[10px] mt-1 px-1 gap-2">
          <span className="text-amber-300 font-bold truncate">
            {hoveredTown.type === 'city' ? 'City' : 'Town'}: {hoveredTown.name}, {hoveredTown.state}
          </span>
          <span className="text-slate-300 font-mono font-bold shrink-0">
            Mile {hoveredTown.mileMarker}
          </span>
        </div>
      ) : closestUpcomingExit ? (
        <div className="flex items-center justify-between text-[10px] mt-1 px-1 gap-2">
          <span className="text-emerald-300 font-bold truncate">
            Next Exit {closestUpcomingExit.exit.exitNumber} ({closestUpcomingExit.exit.branchHighwayCode})
          </span>
          <span className="text-amber-300 font-mono font-bold shrink-0">
            {upcomingDistMiles !== null && upcomingDistMiles > 0
              ? `in ${upcomingDistMiles} mi`
              : `Mile ${closestUpcomingExit.exit.mileMarker}`}
          </span>
        </div>
      ) : closestUpcomingTown ? (
        <div className="flex items-center justify-between text-[10px] mt-1 px-1 gap-2">
          <span className="text-amber-200 font-bold truncate">
            Next Stop: {closestUpcomingTown.town.name}, {closestUpcomingTown.town.state}
          </span>
          <span className="text-amber-300 font-mono font-bold shrink-0">
            {Math.max(0, Math.round((closestUpcomingTown.town.mileMarker - currentMile) * driveDir * 10) / 10)} mi
          </span>
        </div>
      ) : (
        <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1 px-1">
          <span className="text-emerald-400 font-semibold">{route.originName.split(',')[0]}</span>
          <span className="text-slate-500 font-mono">{route.highwayCode}</span>
          <span className="text-rose-400 font-semibold">{route.destName.split(',')[0]}</span>
        </div>
      )}
    </div>
  );
};
