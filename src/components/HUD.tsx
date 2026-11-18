import React, { useState, useEffect } from 'react';
import { HighwayRoute, ScavengedWeapon, TownStop, VehicleTelemetry, CameraViewMode } from '../types';
import { ALL_ROUTES } from '../data/routes';
import { USMinimap } from './USMinimap';
import {
  Compass,
  Gauge,
  Volume2,
  VolumeX,
  Camera,
  Sun,
  Moon,
  Zap,
  Code,
  ChevronDown,
  ChevronUp,
  MapPin,
  Mountain,
  Navigation,
  AlertTriangle,
  CornerUpRight,
  RotateCcw,
  Map,
  X,
  Check,
  ArrowRight,
  ArrowLeftRight,
  BedDouble,
  Briefcase,
  Search,
} from 'lucide-react';

interface HUDProps {
  telemetry: VehicleTelemetry | null;
  activeRoute: HighwayRoute;
  onSelectRoute: (route: HighwayRoute) => void;
  onJumpProgress: (progress: number) => void;
  onCameraChange: (mode: CameraViewMode) => void;
  activeCameraMode: CameraViewMode;
  onTimeOfDayChange: (hour: number) => void;
  currentTimeOfDay: number;
  dayCycle: number;
  onToggleCruise: () => void;
  isCruiseActive: boolean;
  onToggleAudio: () => void;
  isAudioMuted: boolean;
  onOpenCodeModal: () => void;
  onOpenStorage: () => void;
  storageCounts: {
    passengersUsed: number;
    maxPassengers: number;
    trunkUsed: number;
    maxTrunkItems: number;
  };
  onControlInput: (action: 'forward' | 'backward' | 'left' | 'right' | 'boost' | 'brake', active: boolean) => void;
  onTakeExit?: () => void;
  onReturnToMainRoute?: () => void;
  onTurnAround?: () => void;
  townPrompt: TownStop | null;
  townStopMenu: TownStop | null;
  scavengedWeapon: ScavengedWeapon | null;
  scavengeFeedback: { stored: boolean; message: string } | null;
  promptScavengesRemaining: number;
  stopMenuScavengesRemaining: number;
  maxScavengesPerDay: number;
  onAcceptTownStay: () => void;
  onPromptScavenge: () => void;
  onDeclineTownStay: () => void;
  onTownScavenge: () => void;
  onStoreScavengedWeapon: () => void;
  onTownSleep: () => void;
  onTownLeave: () => void;
}

function formatClockHour(hour: number): string {
  const normalized = ((hour % 24) + 24) % 24;
  const h = Math.floor(normalized);
  const m = Math.round((normalized - h) * 60) % 60;
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12} ${period}` : `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

export const HUD: React.FC<HUDProps> = ({
  telemetry,
  activeRoute,
  onSelectRoute,
  onJumpProgress,
  onCameraChange,
  activeCameraMode,
  onTimeOfDayChange,
  currentTimeOfDay,
  dayCycle,
  onToggleCruise,
  isCruiseActive,
  onToggleAudio,
  isAudioMuted,
  onOpenCodeModal,
  onOpenStorage,
  storageCounts,
  onControlInput,
  onTakeExit,
  onReturnToMainRoute,
  onTurnAround,
  townPrompt,
  townStopMenu,
  scavengedWeapon,
  scavengeFeedback,
  promptScavengesRemaining,
  stopMenuScavengesRemaining,
  maxScavengesPerDay,
  onAcceptTownStay,
  onPromptScavenge,
  onDeclineTownStay,
  onTownScavenge,
  onStoreScavengedWeapon,
  onTownSleep,
  onTownLeave,
}) => {
  const [isDockCollapsed, setIsDockCollapsed] = useState(false);
  const [showMinimap, setShowMinimap] = useState(true);
  const [isRouteMenuOpen, setIsRouteMenuOpen] = useState(false);
  const [warpMileInput, setWarpMileInput] = useState('');
  const [isDetourAlertDismissed, setIsDetourAlertDismissed] = useState(false);
  const [hiddenExitId, setHiddenExitId] = useState<string | null>(null);

  const upcomingExitId = telemetry?.upcomingExit?.id ?? null;

  useEffect(() => {
    setIsDetourAlertDismissed(false);
  }, [activeRoute.id]);

  useEffect(() => {
    if (!upcomingExitId) {
      setHiddenExitId(null);
      return;
    }
    setHiddenExitId(null);
    const timer = window.setTimeout(() => {
      setHiddenExitId(upcomingExitId);
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [upcomingExitId, activeRoute.id]);

  useEffect(() => {
    if (!isRouteMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsRouteMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isRouteMenuOpen]);

  const speed = telemetry ? telemetry.speedMph : 0;
  const currentCity = telemetry ? telemetry.currentCity : activeRoute.originName;
  const currentState = telemetry ? telemetry.currentState : 'NY';
  const elevation = telemetry ? telemetry.currentElevationFeet : 15;
  const lat = telemetry ? telemetry.currentLat : activeRoute.waypoints[0].lat;
  const lon = telemetry ? telemetry.currentLon : activeRoute.waypoints[0].lon;
  const progressPercent = telemetry ? telemetry.progressPercent : 0;
  const currentMile = telemetry ? telemetry.currentMile : 0;
  const totalMiles = telemetry ? telemetry.totalMiles : activeRoute.totalMiles;

  const handleWarpToMile = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseFloat(warpMileInput);
    if (Number.isNaN(parsed) || totalMiles <= 0) return;
    const clampedMile = Math.max(0, Math.min(totalMiles, parsed));
    onJumpProgress(clampedMile / totalMiles);
    setWarpMileInput('');
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  };

  const primaryRoutes = ALL_ROUTES.filter((r) => !r.isDetour);
  const detourRoutes = ALL_ROUTES.filter((r) => r.isDetour);

  // Biome display name
  const getBiomeBadge = (biome?: string) => {
    switch (biome) {
      case 'eastern_forest':
        return { label: 'Eastern Forest / Poconos', color: 'bg-emerald-950/80 text-emerald-300 border-emerald-700/60' };
      case 'midwest_plains':
        return { label: 'Midwest Great Plains', color: 'bg-amber-950/80 text-amber-300 border-amber-700/60' };
      case 'rockies':
        return { label: 'Rocky Mountains Continental Divide', color: 'bg-cyan-950/80 text-cyan-300 border-cyan-700/60' };
      case 'desert':
        return { label: 'Mojave & Red Rock Desert', color: 'bg-orange-950/80 text-orange-300 border-orange-700/60' };
      case 'pacific_coast':
        return { label: 'California Pacific Coast', color: 'bg-blue-950/80 text-blue-300 border-blue-700/60' };
      default:
        return { label: 'US Highway Corridor', color: 'bg-slate-800 text-slate-300 border-slate-600' };
    }
  };

  const biomeInfo = getBiomeBadge(telemetry?.currentBiome);

  return (
    <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-4 overflow-hidden select-none font-sans">
      {/* 1. TOP HEADER BAR: Route & Real GPS Telemetry */}
      <div className="flex items-start justify-between gap-4 pointer-events-auto">
        {/* Left: Waypoint & Real GPS Coordinates */}
        <div className="bg-slate-900/90 border border-slate-700/80 rounded-2xl p-4 shadow-2xl max-w-md">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold tracking-wide bg-amber-500 text-slate-950">
              {activeRoute.highwayCode}
            </span>
            {telemetry?.driveDirection === -1 && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-black tracking-wide bg-sky-500/20 text-sky-300 border border-sky-400/50 flex items-center gap-1">
                <ArrowLeftRight className="w-3 h-3" />
                RETURN → {activeRoute.originName.split(',')[0]}
              </span>
            )}
            <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${biomeInfo.color}`}>
              {biomeInfo.label}
            </span>
          </div>

          <div className="flex items-baseline gap-2">
            <h1 className="text-xl font-black text-white tracking-tight flex items-center gap-2">
              <MapPin className="w-5 h-5 text-rose-400 shrink-0" />
              <span>{currentCity}</span>
            </h1>
            <span className="text-sm font-bold text-slate-400">({currentState})</span>
          </div>

          {/* GPS Coordinates & Elevation */}
          <div className="grid grid-cols-3 gap-2 mt-2 pt-2 border-t border-slate-800 text-xs">
            <div>
              <div className="text-[10px] text-slate-500 font-medium">GPS LATITUDE</div>
              <div className="font-mono font-bold text-slate-200">{lat.toFixed(4)}° N</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500 font-medium">GPS LONGITUDE</div>
              <div className="font-mono font-bold text-slate-200">{Math.abs(lon).toFixed(4)}° W</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500 font-medium flex items-center gap-1">
                <Mountain className="w-3 h-3 text-cyan-400" /> ELEVATION
              </div>
              <div className="font-mono font-bold text-cyan-300">{elevation.toLocaleString()} FT</div>
            </div>
          </div>

          {/* Mileage & Progress Bar */}
          <div className="mt-3">
            <div className="flex justify-between text-[11px] font-semibold mb-1">
              <span className="text-slate-400">
                MILE <span className="text-white font-mono">{currentMile.toLocaleString()}</span> / {totalMiles.toLocaleString()} MI
              </span>
              <span className="text-amber-400 font-mono">{progressPercent.toFixed(1)}%</span>
            </div>
            <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden p-0.5">
              <div
                className="h-full bg-gradient-to-r from-amber-500 via-emerald-400 to-sky-400 rounded-full transition-all duration-300"
                style={{ width: `${Math.min(100, Math.max(1, progressPercent))}%` }}
              />
            </div>
          </div>
        </div>

        {/* Right: US Minimap & Quick Actions */}
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <button
              onClick={onOpenStorage}
              className="px-3 py-1.5 rounded-xl bg-slate-900/90 border border-slate-700/80 text-xs font-semibold text-slate-100 hover:bg-slate-800 hover:border-amber-400/70 transition shadow-lg flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
              title="Open Vehicle Storage (Press I)"
            >
              <Briefcase className="w-3.5 h-3.5 text-amber-400" />
              <span>Storage</span>
              <span className="font-mono text-[11px] text-slate-300 tabular-nums">
                {storageCounts.passengersUsed}/{storageCounts.maxPassengers} · {storageCounts.trunkUsed}/{storageCounts.maxTrunkItems}
              </span>
            </button>

            <button
              onClick={() => setIsRouteMenuOpen(true)}
              className="px-3 py-1.5 rounded-xl bg-slate-900/90 border border-amber-500/50 text-xs font-bold text-amber-300 hover:bg-slate-800 hover:border-amber-400 transition shadow-lg flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Map className="w-3.5 h-3.5 text-amber-400" />
              Routes
            </button>

            <button
              onClick={() => setShowMinimap(!showMinimap)}
              className="px-3 py-1.5 rounded-xl bg-slate-900/90 border border-slate-700/80 text-xs font-semibold text-slate-200 hover:bg-slate-800 transition shadow-lg flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Navigation className="w-3.5 h-3.5 text-amber-400" />
              {showMinimap ? 'Hide Radar' : 'Show Radar'}
            </button>

            <button
              onClick={onOpenCodeModal}
              className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 border border-indigo-500 text-xs font-bold text-white hover:from-indigo-500 hover:to-blue-500 transition shadow-lg flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Code className="w-3.5 h-3.5" />
              Single HTML Code
            </button>
          </div>

          {showMinimap && (
            <div className="w-72 sm:w-80">
              <USMinimap
                route={activeRoute}
                telemetry={telemetry}
                onWaypointClick={(progress) => onJumpProgress(progress)}
                onSelectRoute={onSelectRoute}
              />
            </div>
          )}
        </div>
      </div>

      {/* 2. REAL HIGHWAY INTERCHANGE / DETOUR ALERTS */}
      {telemetry?.isDetour && !isDetourAlertDismissed && (
        <div className="self-center my-2 pointer-events-auto bg-amber-950/95 border-2 border-amber-500/90 rounded-2xl px-5 py-3 shadow-2xl flex items-center gap-4 max-w-xl">
          <AlertTriangle className="w-6 h-6 text-amber-400 shrink-0 animate-bounce" />
          <div className="flex-1">
            <div className="text-[10px] font-black tracking-widest text-amber-300 uppercase">⚠️ HIGHWAY DETOUR ACTIVE</div>
            <div className="text-xs sm:text-sm font-bold text-white">
              {telemetry.detourWarning || `Driving off the main Coast-to-Coast route on ${activeRoute.highwayCode}`}
            </div>
            <div className="text-[11px] text-amber-200/80 mt-0.5">Explore this regional highway or return anytime to resume your coast-to-coast journey.</div>
          </div>
          {onReturnToMainRoute && (
            <button
              onClick={onReturnToMainRoute}
              className="px-3.5 py-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-black text-xs rounded-xl shadow-lg transition flex items-center gap-1.5 cursor-pointer shrink-0"
              title="Return to Main Route (Key R)"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reroute [R]
            </button>
          )}
          <button
            onClick={() => setIsDetourAlertDismissed(true)}
            className="p-1.5 rounded-lg text-amber-200/80 hover:text-white hover:bg-amber-900/80 transition cursor-pointer shrink-0"
            title="Dismiss alert"
            aria-label="Close detour alert"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {telemetry?.upcomingExit && telemetry.upcomingExit.id !== hiddenExitId && (
        <div className="self-center my-2 pointer-events-auto bg-emerald-950/95 border-2 border-emerald-400 rounded-2xl px-5 py-3 shadow-2xl flex items-center gap-4 max-w-xl">
          <div className="flex flex-col items-center justify-center bg-emerald-800 border border-emerald-300 px-3 py-1.5 rounded-xl shrink-0">
            <span className="text-[9px] font-black text-emerald-200 tracking-wider">EXIT</span>
            <span className="text-lg font-black text-white font-mono leading-none">{telemetry.upcomingExit.exitNumber}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-black bg-amber-400 text-slate-950 px-2 py-0.5 rounded font-mono">
                {telemetry.upcomingExit.highwayCode}
              </span>
              <span className="text-sm font-black text-white truncate">
                {telemetry.upcomingExit.destination}
              </span>
            </div>
            <div className="text-xs text-emerald-200 mt-1 flex items-center gap-2">
              <span className="font-bold text-emerald-300 font-mono">
                {telemetry.upcomingExit.isTakingExit
                  ? 'EXITING • CURVING ON RAMP'
                  : telemetry.upcomingExit.distanceMiles > 0.1
                  ? `${telemetry.upcomingExit.distanceMiles} MILES`
                  : 'EXIT LANE OPEN'}
              </span>
              <span className="text-slate-300 text-[11px]">
                {telemetry.upcomingExit.isTakingExit
                  ? '• Press [E] to jump immediately'
                  : '• Merge right into exit lane or press [E]'}
              </span>
            </div>
          </div>
          {onTakeExit && (
            <button
              onClick={onTakeExit}
              className="px-3.5 py-2 bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-black text-xs rounded-xl shadow-lg transition flex items-center gap-1.5 cursor-pointer shrink-0"
              title="Take this Highway Exit (Key E)"
            >
              <CornerUpRight className="w-4 h-4" />
              Take Exit [E]
            </button>
          )}
        </div>
      )}

      {/* 2b. CITY / TOWN ENTRY "STAY THE NIGHT" PROMPT */}
      {townPrompt && !townStopMenu && (
        <div className="self-center my-2 pointer-events-auto bg-slate-900/95 border-2 border-amber-400 rounded-2xl px-5 py-3.5 shadow-2xl flex items-center gap-4 max-w-xl">
          <div className="p-2.5 rounded-xl bg-amber-500/20 border border-amber-400/50 text-amber-300 shrink-0">
            <BedDouble className="w-6 h-6" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-black tracking-widest uppercase text-amber-400">
              {townPrompt.type === 'city' ? 'Entering City' : 'Entering Town'} • Mile {townPrompt.mileMarker}
            </div>
            <div className="text-sm sm:text-base font-black text-white truncate">
              {townPrompt.name}, {townPrompt.state}
            </div>
            <div className="text-xs font-semibold text-slate-200 mt-0.5">
              Stay the night?
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onAcceptTownStay}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs rounded-xl shadow-lg transition cursor-pointer whitespace-nowrap shrink-0"
            >
              Yes
            </button>
            <button
              onClick={onPromptScavenge}
              disabled={promptScavengesRemaining <= 0}
              title={
                promptScavengesRemaining <= 0
                  ? `Scavenged ${maxScavengesPerDay}/${maxScavengesPerDay} times here on Day ${dayCycle}`
                  : `Scavenge (${promptScavengesRemaining}/${maxScavengesPerDay} left today)`
              }
              className="px-3.5 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 disabled:text-slate-500 disabled:border disabled:border-slate-700 text-slate-950 font-black text-xs rounded-xl shadow-lg transition flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed whitespace-nowrap shrink-0 tabular-nums"
            >
              <Search className="w-3.5 h-3.5" />
              {promptScavengesRemaining > 0
                ? `Scavenge (${promptScavengesRemaining}/${maxScavengesPerDay})`
                : `Scavenge (0/${maxScavengesPerDay})`}
            </button>
            <button
              onClick={onDeclineTownStay}
              className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 font-bold text-xs rounded-xl transition cursor-pointer whitespace-nowrap shrink-0"
            >
              No
            </button>
          </div>
        </div>
      )}

      {/* 3. ERGONOMIC COLLAPSIBLE BOTTOM DOCK (Per Three.js Guidelines) */}
      <div className="w-full flex flex-col items-center pointer-events-auto mb-2">
        {/* Collapse / Expand Toggle Button */}
        <button
          onClick={() => setIsDockCollapsed(!isDockCollapsed)}
          className="mb-1.5 px-3 py-1 bg-slate-900/90 hover:bg-slate-800 border border-slate-700/80 rounded-full text-[11px] font-semibold text-slate-300 transition shadow-lg flex items-center gap-1.5"
        >
          {isDockCollapsed ? (
            <>
              <ChevronUp className="w-3.5 h-3.5 text-amber-400" /> Show Controls (H)
            </>
          ) : (
            <>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> Zen Mode / Hide (H)
            </>
          )}
        </button>

        {/* The Main Control Dock */}
        {!isDockCollapsed && (
          <div className="w-full max-w-6xl bg-slate-900/95 border border-slate-700/90 rounded-2xl p-3.5 shadow-2xl text-slate-200 overflow-hidden">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3.5 items-center">
              
              {/* Column A: Digital Speedometer & Gear Display */}
              <div className="md:col-span-3 min-w-0 flex items-center gap-3 bg-slate-950/80 border border-slate-800 rounded-xl p-2.5">
                {/* Speed Gauge Circle */}
                <div className="relative w-16 h-16 flex items-center justify-center shrink-0">
                  <svg className="w-full h-full -rotate-90">
                    <circle cx="32" cy="32" r="26" stroke="#334155" strokeWidth="4" fill="none" />
                    <circle
                      cx="32"
                      cy="32"
                      r="26"
                      stroke={speed > 210 ? '#38bdf8' : '#f59e0b'}
                      strokeWidth="4"
                      fill="none"
                      strokeDasharray="163"
                      strokeDashoffset={163 - (Math.min(280, speed) / 280) * 163}
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute text-center">
                    <span className="text-xl font-black font-mono text-white leading-none">{speed}</span>
                    <span className="block text-[8px] font-bold text-amber-400 -mt-0.5">MPH</span>
                  </div>
                </div>

                {/* Telemetry info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400 font-semibold">GEAR</span>
                    <span className="font-mono font-bold text-amber-400 text-sm">{telemetry?.gear ?? 'D1'}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs mt-0.5">
                    <span className="text-slate-400 font-semibold">RPM</span>
                    <span className="font-mono text-slate-300 text-xs">{telemetry?.rpm ?? 800}</span>
                  </div>
                  <button
                    onClick={onToggleCruise}
                    className="flex items-center justify-between text-xs mt-1 w-full hover:bg-slate-800/80 p-1 -mx-1 rounded transition text-left cursor-pointer group"
                    title="Toggle Cruise Control (Press Q)"
                  >
                    <span className="text-slate-400 font-semibold group-hover:text-slate-200 flex items-center gap-1.5">
                      CRUISE <kbd className="px-1 py-0.2 bg-slate-800 text-[10px] rounded text-emerald-400 font-mono border border-slate-700">Q</kbd>
                    </span>
                    <span className={`font-mono text-xs font-bold px-1.5 py-0.5 rounded transition ${isCruiseActive ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50 shadow-sm' : 'text-slate-500'}`}>
                      {isCruiseActive ? `${telemetry?.cruiseTargetSpeedMph ?? 70} MPH` : 'OFF'}
                    </span>
                  </button>
                </div>
              </div>

              {/* Column B: Active Route Menu Trigger & Mile Marker Warp */}
              <div className="md:col-span-5 min-w-0 flex flex-col gap-2">
                {/* Active Route Summary + Pop-up Menu Trigger */}
                <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 bg-slate-950/80 border border-slate-800 rounded-xl">
                  <div className="min-w-0 flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-[10px] font-black text-amber-300 font-mono shrink-0">
                      {activeRoute.highwayCode}
                    </span>
                    <span className="text-xs font-bold text-slate-100 truncate">
                      {activeRoute.name}
                    </span>
                  </div>
                  <button
                    onClick={() => setIsRouteMenuOpen(true)}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600/80 text-[11px] font-bold text-amber-300 transition flex items-center gap-1 shrink-0 cursor-pointer"
                  >
                    <Map className="w-3 h-3" />
                    Change Route
                  </button>
                </div>

                {/* Mile Marker Warp Input & Fast-Travel Scrub Bar */}
                <form onSubmit={handleWarpToMile} className="flex items-center gap-2 text-xs">
                  <div className="flex items-center gap-1 bg-slate-950/90 border border-slate-700/80 rounded-lg px-1.5 py-0.5 shrink-0">
                    <input
                      type="number"
                      min={0}
                      max={Math.round(totalMiles)}
                      step="any"
                      value={warpMileInput}
                      onChange={(e) => setWarpMileInput(e.target.value)}
                      placeholder={`0–${Math.round(totalMiles)} mi`}
                      aria-label="Warp to mile marker"
                      className="w-20 bg-transparent text-xs font-mono text-white placeholder-slate-500 focus:outline-none px-1 py-0.5"
                    />
                    <button
                      type="submit"
                      className="px-2 py-0.5 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-[11px] transition cursor-pointer"
                      title="Warp to specific mile marker"
                    >
                      Warp
                    </button>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="0.5"
                    value={progressPercent}
                    onChange={(e) => onJumpProgress(parseFloat(e.target.value) / 100)}
                    className="w-full accent-amber-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
                    title="Scrub route progress"
                  />
                </form>
              </div>

              {/* Column C: Camera & Environment Presets */}
              <div className="md:col-span-4 min-w-0 flex flex-col gap-2">
                {/* Camera Modes */}
                <div className="flex items-center justify-between gap-1.5 text-[11px] font-semibold">
                  <span className="text-slate-400 flex items-center gap-1">
                    <Camera className="w-3.5 h-3.5" /> Cam:
                  </span>
                  <div className="flex gap-1">
                    {(['chase', 'driver', 'drone', 'overhead'] as CameraViewMode[]).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => onCameraChange(mode)}
                        className={`px-2 py-0.5 rounded capitalize transition ${
                          activeCameraMode === mode
                            ? 'bg-sky-500 text-white font-bold'
                            : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                        }`}
                      >
                        {mode === 'overhead' ? 'Top' : mode}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Quick Action Buttons (Cruise, U-Turn, Audio, Day/Night) */}
                <div className="flex items-center justify-between gap-1.5">
                  <button
                    onClick={onToggleCruise}
                    className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-bold border transition flex items-center justify-center gap-1 cursor-pointer ${
                      isCruiseActive
                        ? 'bg-emerald-600 text-white border-emerald-500 shadow-md ring-2 ring-emerald-400/40'
                        : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                    }`}
                    title="Toggle Cruise Control (Press Q)"
                  >
                    <Gauge className="w-3.5 h-3.5 text-emerald-300" />
                    <span>Cruise</span>
                    <kbd className={`px-1 py-0.2 text-[9px] rounded font-mono ${isCruiseActive ? 'bg-emerald-700 text-emerald-100' : 'bg-slate-700 text-slate-300'}`}>Q</kbd>
                    <span className={`text-[10px] font-extrabold ${isCruiseActive ? 'text-emerald-200' : 'text-slate-400'}`}>
                      {isCruiseActive ? `${telemetry?.cruiseTargetSpeedMph ?? 70}M` : 'OFF'}
                    </span>
                  </button>

                  {onTurnAround && (
                    <button
                      onClick={onTurnAround}
                      disabled={telemetry?.isTurningAround}
                      className={`py-1.5 px-2 rounded-lg text-xs font-bold border transition flex items-center justify-center gap-1 cursor-pointer disabled:opacity-60 ${
                        telemetry?.driveDirection === -1
                          ? 'bg-sky-600 text-white border-sky-400 shadow-md'
                          : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700'
                      }`}
                      title="Turn Around / Opposite Direction (Press U)"
                    >
                      <ArrowLeftRight className={`w-3.5 h-3.5 ${telemetry?.isTurningAround ? 'animate-spin' : ''}`} />
                      <kbd className={`px-1 py-0.2 text-[9px] rounded font-mono ${telemetry?.driveDirection === -1 ? 'bg-sky-700 text-sky-100' : 'bg-slate-700 text-slate-300'}`}>U</kbd>
                    </button>
                  )}

                  <button
                    onClick={onToggleAudio}
                    className={`py-1.5 px-2 rounded-lg text-xs font-bold border transition flex items-center justify-center cursor-pointer ${
                      !isAudioMuted
                        ? 'bg-amber-600 text-white border-amber-500'
                        : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
                    }`}
                    title={isAudioMuted ? 'Unmute Engine Sound (Press M)' : 'Mute Engine Sound (Press M)'}
                  >
                    {!isAudioMuted ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                  </button>

                  {/* Day / Sunset / Night Toggle */}
                  <button
                    onClick={() => {
                      const norm = ((currentTimeOfDay % 24) + 24) % 24;
                      const nextHour = norm >= 7 && norm < 17 ? 18.5 : norm >= 17 && norm < 20 ? 23 : 14;
                      onTimeOfDayChange(nextHour);
                    }}
                    className="py-1.5 px-2 rounded-lg text-xs font-bold bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700 transition flex items-center gap-1 cursor-pointer shrink-0"
                    title="Change Time of Day"
                  >
                    {currentTimeOfDay >= 7 && currentTimeOfDay < 17 ? (
                      <Sun className="w-3.5 h-3.5 text-amber-400" />
                    ) : (currentTimeOfDay >= 17 && currentTimeOfDay < 20) || (currentTimeOfDay >= 5 && currentTimeOfDay < 7) ? (
                      <Sun className="w-3.5 h-3.5 text-orange-400" />
                    ) : (
                      <Moon className="w-3.5 h-3.5 text-indigo-300" />
                    )}
                    <span className="font-mono text-[10px] text-slate-300 tabular-nums">
                      D{dayCycle} · {formatClockHour(currentTimeOfDay)}
                    </span>
                  </button>
                </div>
              </div>

            </div>

            {/* Mobile / Touch Drive Controls for instant responsiveness */}
            <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                <span className="font-semibold text-slate-300">Controls:</span>
                <kbd className="px-1.5 py-0.5 bg-slate-800 rounded font-mono text-[10px] text-amber-400">W</kbd> Gas
                <kbd className="px-1.5 py-0.5 bg-slate-800 rounded font-mono text-[10px] text-rose-400">S</kbd> Brake
                <kbd className="px-1.5 py-0.5 bg-slate-800 rounded font-mono text-[10px] text-slate-300">A/D</kbd> Steer
                <kbd className="px-1.5 py-0.5 bg-slate-800 rounded font-mono text-[10px] text-emerald-400">Q</kbd> Cruise
                <kbd className="px-1.5 py-0.5 bg-slate-800 rounded font-mono text-[10px] text-sky-300">U</kbd> U-Turn
                <kbd className="px-1.5 py-0.5 bg-slate-800 rounded font-mono text-[10px] text-sky-400">Shift</kbd> Nitro
                <kbd className="px-1.5 py-0.5 bg-slate-800 rounded font-mono text-[10px] text-indigo-400">C</kbd> Camera
                <kbd className="px-1.5 py-0.5 bg-slate-800 rounded font-mono text-[10px] text-amber-300">I</kbd> Storage
              </div>

              {/* Touch drive buttons for easy mobile or click testing */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  onMouseDown={() => onControlInput('left', true)}
                  onMouseUp={() => onControlInput('left', false)}
                  onTouchStart={() => onControlInput('left', true)}
                  onTouchEnd={() => onControlInput('left', false)}
                  className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 rounded text-xs font-bold text-slate-200 active:bg-amber-600 cursor-pointer"
                >
                  ◀ Left
                </button>
                <button
                  onMouseDown={() => onControlInput('forward', true)}
                  onMouseUp={() => onControlInput('forward', false)}
                  onTouchStart={() => onControlInput('forward', true)}
                  onTouchEnd={() => onControlInput('forward', false)}
                  className="px-3.5 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded text-xs font-bold active:bg-amber-600 cursor-pointer"
                >
                  ▲ Gas
                </button>
                <button
                  onMouseDown={() => onControlInput('backward', true)}
                  onMouseUp={() => onControlInput('backward', false)}
                  onTouchStart={() => onControlInput('backward', true)}
                  onTouchEnd={() => onControlInput('backward', false)}
                  className="px-3 py-1 bg-slate-800 hover:bg-slate-700 rounded text-xs font-bold text-rose-400 active:bg-rose-600 cursor-pointer"
                >
                  ▼ Brake
                </button>
                <button
                  onMouseDown={() => onControlInput('right', true)}
                  onMouseUp={() => onControlInput('right', false)}
                  onTouchStart={() => onControlInput('right', true)}
                  onTouchEnd={() => onControlInput('right', false)}
                  className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 rounded text-xs font-bold text-slate-200 active:bg-amber-600 cursor-pointer"
                >
                  Right ▶
                </button>
                {onTurnAround && (
                  <button
                    onClick={onTurnAround}
                    disabled={telemetry?.isTurningAround}
                    className={`px-2.5 py-1 rounded text-xs font-bold transition flex items-center gap-1 cursor-pointer disabled:opacity-60 ${
                      telemetry?.driveDirection === -1
                        ? 'bg-sky-600 text-white ring-1 ring-sky-400/50'
                        : 'bg-slate-800 hover:bg-slate-700 text-sky-300'
                    }`}
                    title="Turn Around / Opposite Direction (Press U)"
                  >
                    <ArrowLeftRight className="w-3 h-3" />
                    <span>{telemetry?.isTurningAround ? 'Turning...' : 'U-Turn [U]'}</span>
                  </button>
                )}
                <button
                  onClick={onToggleCruise}
                  className={`px-3 py-1 rounded text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
                    isCruiseActive
                      ? 'bg-emerald-600 text-white shadow-md ring-2 ring-emerald-400/40'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                  }`}
                  title="Toggle Cruise Control (Press Q)"
                >
                  <Gauge className="w-3.5 h-3.5 text-emerald-300" />
                  <span>Cruise [Q]</span>
                  <span className={`font-mono text-[10px] ${isCruiseActive ? 'text-emerald-100 font-extrabold' : 'text-slate-500'}`}>
                    {isCruiseActive ? `${telemetry?.cruiseTargetSpeedMph ?? 70}M` : 'OFF'}
                  </span>
                </button>
                <button
                  onMouseDown={() => onControlInput('boost', true)}
                  onMouseUp={() => onControlInput('boost', false)}
                  onTouchStart={() => onControlInput('boost', true)}
                  onTouchEnd={() => onControlInput('boost', false)}
                  className="px-2.5 py-1 bg-sky-600 hover:bg-sky-500 text-white rounded text-xs font-bold active:bg-sky-700 flex items-center gap-1 cursor-pointer"
                >
                  <Zap className="w-3 h-3" /> Nitro
                </button>
              </div>
            </div>

          </div>
        )}
      </div>

      {/* 4. ROUTE SELECTION POP-UP MENU */}
      {isRouteMenuOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/90 pointer-events-auto"
          onClick={() => setIsRouteMenuOpen(false)}
        >
          <div
            className="relative w-full max-w-2xl max-h-[85vh] overflow-y-auto bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-6 text-slate-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-4 pb-4 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400">
                  <Compass className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-black text-white">Select Highway Route</h2>
                  <p className="text-xs text-slate-400">
                    Choose a coast-to-coast corridor or jump directly onto a regional highway branch.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsRouteMenuOpen(false)}
                className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
                aria-label="Close route menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mt-5 space-y-5">
              {/* Primary Highways */}
              <div>
                <div className="text-[11px] font-black tracking-widest uppercase text-amber-400 mb-2.5">
                  Primary US Highways
                </div>
                <div className="grid grid-cols-1 gap-2.5">
                  {primaryRoutes.map((route) => {
                    const isActive = activeRoute.id === route.id;
                    return (
                      <button
                        key={route.id}
                        onClick={() => {
                          onSelectRoute(route);
                          setIsRouteMenuOpen(false);
                        }}
                        className={`w-full text-left p-3.5 rounded-xl border transition flex items-center justify-between gap-3 cursor-pointer ${
                          isActive
                            ? 'bg-amber-500/15 border-amber-400 shadow-lg'
                            : 'bg-slate-950/70 border-slate-800 hover:border-slate-600 hover:bg-slate-800/60'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="px-2 py-0.5 rounded text-[11px] font-black bg-amber-500 text-slate-950 font-mono">
                              {route.highwayCode}
                            </span>
                            <span className="font-bold text-sm text-white">{route.name}</span>
                            {route.exits && route.exits.length > 0 && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-950 text-emerald-300 border border-emerald-700/60">
                                {route.exits.length} Exits
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-400 mt-1 flex items-center gap-1.5 flex-wrap">
                            <span>{route.originName}</span>
                            <ArrowRight className="w-3 h-3 text-slate-500" />
                            <span>{route.destName}</span>
                            <span className="text-slate-600">•</span>
                            <span className="font-mono text-slate-300">{route.totalMiles.toLocaleString()} mi</span>
                          </div>
                        </div>
                        {isActive && (
                          <span className="px-2.5 py-1 rounded-lg bg-amber-500 text-slate-950 text-[11px] font-black flex items-center gap-1 shrink-0">
                            <Check className="w-3.5 h-3.5" /> Active
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Branch / Detour Highways */}
              <div>
                <div className="text-[11px] font-black tracking-widest uppercase text-sky-400 mb-2.5">
                  Regional Branches & Interstate Detours
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {detourRoutes.map((route) => {
                    const isActive = activeRoute.id === route.id;
                    return (
                      <button
                        key={route.id}
                        onClick={() => {
                          onSelectRoute(route);
                          setIsRouteMenuOpen(false);
                        }}
                        className={`w-full text-left p-3 rounded-xl border transition flex flex-col justify-between gap-2 cursor-pointer ${
                          isActive
                            ? 'bg-sky-500/15 border-sky-400 shadow-lg'
                            : 'bg-slate-950/70 border-slate-800 hover:border-slate-600 hover:bg-slate-800/60'
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="px-2 py-0.5 rounded text-[10px] font-black bg-sky-500/20 text-sky-300 border border-sky-500/40 font-mono">
                              {route.highwayCode}
                            </span>
                            <div className="flex items-center gap-1.5">
                              {route.exits && route.exits.length > 0 && (
                                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-950 text-emerald-300 border border-emerald-700/60">
                                  {route.exits.length} Exits
                                </span>
                              )}
                              <span className="text-[11px] font-mono text-slate-400">
                                {route.totalMiles.toLocaleString()} mi
                              </span>
                            </div>
                          </div>
                          <div className="font-bold text-xs text-white mt-1.5">{route.name}</div>
                          <div className="text-[11px] text-slate-400 mt-0.5">{route.subtitle}</div>
                        </div>
                        {isActive && (
                          <div className="text-[10px] font-black text-sky-300 flex items-center gap-1">
                            <Check className="w-3 h-3" /> Currently Driving
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5. TOWN STOP OVERNIGHT MENU */}
      {townStopMenu && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-slate-950/80 pointer-events-auto">
          <div className="w-full max-w-md bg-slate-900 border-2 border-amber-500/80 rounded-2xl shadow-2xl p-6 text-slate-200">
            <div className="flex items-start justify-between gap-3 pb-4 border-b border-slate-800">
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-3 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-400 shrink-0">
                  <BedDouble className="w-6 h-6" />
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] font-black tracking-widest uppercase text-amber-400">
                    {townStopMenu.type === 'city' ? 'City Stopover' : 'Town Stopover'} · Mile {townStopMenu.mileMarker}
                  </div>
                  <h2 className="text-xl font-black text-white truncate">
                    {townStopMenu.name}, {townStopMenu.state}
                  </h2>
                </div>
              </div>
              <button
                type="button"
                onClick={onOpenStorage}
                className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 tabular-nums"
              >
                <Briefcase className="w-3.5 h-3.5 text-amber-400" />
                Trunk {storageCounts.trunkUsed}/{storageCounts.maxTrunkItems}
              </button>
            </div>

            <p className="text-sm text-slate-300 mt-4">
              You have pulled into {townStopMenu.name}. Rest up for 8 hours, scavenge for weapons to store in your car, or head straight back out to the highway.
            </p>

            <div className="mt-2.5 flex items-center justify-between text-xs text-slate-400 tabular-nums">
              <span>Day {dayCycle}</span>
              <span className={stopMenuScavengesRemaining > 0 ? 'text-emerald-400 font-semibold' : 'text-slate-400 font-semibold'}>
                Scavenges left here today: {stopMenuScavengesRemaining}/{maxScavengesPerDay}
              </span>
            </div>

            {stopMenuScavengesRemaining <= 0 && !scavengedWeapon && (
              <div className="mt-3 px-3 py-2.5 rounded-xl bg-slate-950/70 border border-slate-800 text-xs text-slate-400">
                Daily scavenge limit reached ({maxScavengesPerDay}/{maxScavengesPerDay}) for {townStopMenu.name} on Day {dayCycle}. Return on a new day to scavenge here again.
              </div>
            )}

            {scavengedWeapon && (
              <div className="mt-4 bg-slate-950/80 border border-slate-700 rounded-xl p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-emerald-400">
                      {scavengedWeapon.category}
                    </div>
                    <div className="text-base font-bold text-white truncate">
                      {scavengedWeapon.name}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[11px] text-slate-400">Damage</div>
                    <div className="text-lg font-black font-mono text-amber-400 tabular-nums leading-tight">
                      {scavengedWeapon.damage}
                    </div>
                  </div>
                </div>

                <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-400 transition-all"
                    style={{ width: `${Math.min(100, Math.max(15, scavengedWeapon.damage))}%` }}
                  />
                </div>

                {scavengeFeedback ? (
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span
                      className={`font-semibold ${
                        scavengeFeedback.stored ? 'text-emerald-400' : 'text-rose-300'
                      }`}
                    >
                      {scavengeFeedback.message}
                    </span>
                    {!scavengeFeedback.stored && (
                      <button
                        type="button"
                        onClick={onOpenStorage}
                        className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 font-semibold cursor-pointer whitespace-nowrap shrink-0"
                      >
                        Manage Trunk
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={onStoreScavengedWeapon}
                      disabled={storageCounts.trunkUsed >= storageCounts.maxTrunkItems}
                      className="px-3.5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-bold text-xs transition cursor-pointer disabled:cursor-not-allowed whitespace-nowrap shrink-0"
                    >
                      {storageCounts.trunkUsed >= storageCounts.maxTrunkItems
                        ? `Trunk Full (${storageCounts.maxTrunkItems}/${storageCounts.maxTrunkItems})`
                        : 'Store in Trunk'}
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="mt-5 flex flex-col gap-2.5">
              <button
                onClick={onTownSleep}
                className="w-full py-3 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-sm shadow-lg transition flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Moon className="w-4 h-4" />
                Sleep for 8 hours
              </button>
              <button
                onClick={onTownScavenge}
                disabled={stopMenuScavengesRemaining <= 0}
                className="w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 disabled:border disabled:border-slate-700 text-white font-bold text-sm shadow-lg transition flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed whitespace-nowrap shrink-0 tabular-nums"
              >
                <Search className="w-4 h-4" />
                {stopMenuScavengesRemaining <= 0
                  ? `Scavenge Limit Reached (0/${maxScavengesPerDay})`
                  : scavengedWeapon
                  ? `Scavenge Again (${stopMenuScavengesRemaining}/${maxScavengesPerDay} left)`
                  : `Scavenge (${stopMenuScavengesRemaining}/${maxScavengesPerDay} left)`}
              </button>
              <button
                onClick={onTownLeave}
                className="w-full py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-white border border-slate-600 font-bold text-sm transition flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
              >
                <ArrowRight className="w-4 h-4" />
                Leave
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
