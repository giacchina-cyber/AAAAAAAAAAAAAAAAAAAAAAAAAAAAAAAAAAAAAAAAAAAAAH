/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { HighwaySceneEngine } from './three/HighwayScene';
import { ROUTE_NYC_TO_LA } from './data/routes';
import {
  HighwayRoute,
  ScavengedWeapon,
  TownStop,
  VehicleStorageState,
  VehicleTelemetry,
  CameraViewMode,
} from './types';
import {
  advanceScavengeDayCycle,
  canScavengeLocation,
  getLocationScavengesUsed,
  loadScavengeDayState,
  MAX_SCAVENGES_PER_LOCATION_PER_DAY,
  recordLocationScavenge,
  rollScavengedWeapon,
  saveScavengeDayState,
  ScavengeDayState,
} from './data/weapons';
import { HUD } from './components/HUD';
import { StandaloneExportModal } from './components/StandaloneExportModal';
import { VehicleStorageModal } from './components/VehicleStorageModal';
import {
  addItemToTrunk,
  clearVehiclePassengers,
  clearVehicleTrunk,
  getVehicleStorageCounts,
  loadVehicleStorage,
  removeItemFromTrunk,
  removePassengerFromVehicle,
  saveVehicleStorage,
} from './utils/vehicleStorage';

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<HighwaySceneEngine | null>(null);
  const sleepTimerRef = useRef<number | null>(null);
  const townPromptRef = useRef<TownStop | null>(null);

  const [activeRoute, setActiveRoute] = useState<HighwayRoute>(ROUTE_NYC_TO_LA);
  const [telemetry, setTelemetry] = useState<VehicleTelemetry | null>(null);
  const [cameraMode, setCameraMode] = useState<CameraViewMode>('chase');
  const [timeOfDay, setTimeOfDay] = useState<number>(14);
  const [isCruiseActive, setIsCruiseActive] = useState<boolean>(false);
  const [isAudioMuted, setIsAudioMuted] = useState<boolean>(true);
  const [isCodeModalOpen, setIsCodeModalOpen] = useState<boolean>(false);
  const [townPrompt, setTownPrompt] = useState<TownStop | null>(null);
  const [townStopMenu, setTownStopMenu] = useState<TownStop | null>(null);
  const [scavengedWeapon, setScavengedWeapon] = useState<ScavengedWeapon | null>(null);
  const [scavengeFeedback, setScavengeFeedback] = useState<{ stored: boolean; message: string } | null>(null);
  const [isSleepingBlackout, setIsSleepingBlackout] = useState<boolean>(false);
  const [isStorageOpen, setIsStorageOpen] = useState<boolean>(false);
  const [scavengeDayState, setScavengeDayState] = useState<ScavengeDayState>(() =>
    loadScavengeDayState()
  );
  const [vehicleStorage, setVehicleStorage] = useState<VehicleStorageState>(() =>
    loadVehicleStorage()
  );

  townPromptRef.current = townPrompt;

  useEffect(() => {
    saveVehicleStorage(vehicleStorage);
  }, [vehicleStorage]);

  useEffect(() => {
    saveScavengeDayState(scavengeDayState);
  }, [scavengeDayState]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.code === 'KeyI' && !isSleepingBlackout) {
        setIsStorageOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isSleepingBlackout]);

  const clearTownState = useCallback(() => {
    if (sleepTimerRef.current !== null) {
      window.clearTimeout(sleepTimerRef.current);
      sleepTimerRef.current = null;
    }
    setTownPrompt(null);
    setTownStopMenu(null);
    setScavengedWeapon(null);
    setScavengeFeedback(null);
    setIsSleepingBlackout(false);
  }, []);

  // Initialize Three.js simulation once
  useEffect(() => {
    if (!canvasMountRef.current) return;

    const engine = new HighwaySceneEngine(canvasMountRef.current, ROUTE_NYC_TO_LA);
    engineRef.current = engine;

    engine.onTelemetryUpdate = (data: VehicleTelemetry) => {
      setTelemetry(data);
      setIsCruiseActive(data.cruiseControl);
      const activePrompt = townPromptRef.current;
      if (activePrompt && Math.abs(data.currentMile - activePrompt.mileMarker) > 1.2) {
        setTownPrompt(null);
      }
    };

    engine.onRouteChanged = (newRoute: HighwayRoute) => {
      setActiveRoute(newRoute);
      clearTownState();
    };

    engine.onTownEntered = (town: TownStop) => {
      setTownPrompt(town);
    };

    return () => {
      if (sleepTimerRef.current !== null) {
        window.clearTimeout(sleepTimerRef.current);
        sleepTimerRef.current = null;
      }
      engine.dispose();
      engineRef.current = null;
    };
  }, [clearTownState]);

  // Handlers for HUD interaction
  const handleSelectRoute = useCallback((route: HighwayRoute) => {
    clearTownState();
    setActiveRoute(route);
    engineRef.current?.setRoute(route);
  }, [clearTownState]);

  const handleJumpProgress = useCallback((progress: number) => {
    clearTownState();
    engineRef.current?.jumpToProgress(progress);
  }, [clearTownState]);

  const handleCameraChange = useCallback((mode: CameraViewMode) => {
    setCameraMode(mode);
    engineRef.current?.setCameraMode(mode);
  }, []);

  const handleTimeOfDayChange = useCallback((hour: number) => {
    const prevNorm = ((timeOfDay % 24) + 24) % 24;
    const nextNorm = ((hour % 24) + 24) % 24;
    if (nextNorm < prevNorm) {
      setScavengeDayState((prev) => advanceScavengeDayCycle(prev, 1));
    }
    setTimeOfDay(nextNorm);
    engineRef.current?.setTimeOfDay(nextNorm);
  }, [timeOfDay]);

  const handleToggleCruise = useCallback(() => {
    if (engineRef.current) {
      const active = engineRef.current.toggleCruiseControl();
      setIsCruiseActive(active);
    }
  }, []);

  const handleToggleAudio = useCallback(() => {
    if (engineRef.current) {
      const isUnmuted = engineRef.current.toggleAudio();
      setIsAudioMuted(!isUnmuted);
    }
  }, []);

  const handleControlInput = useCallback((action: 'forward' | 'backward' | 'left' | 'right' | 'boost' | 'brake', active: boolean) => {
    engineRef.current?.setControlInput(action, active);
  }, []);

  const handleTakeExit = useCallback(() => {
    if (engineRef.current) {
      const exit = engineRef.current.findUpcomingExit();
      if (exit) {
        engineRef.current.initiateExit(exit);
      }
    }
  }, []);

  const handleReturnToMainRoute = useCallback(() => {
    if (engineRef.current) {
      engineRef.current.returnToMainRoute();
    }
  }, []);

  const handleTurnAround = useCallback(() => {
    engineRef.current?.turnAround();
  }, []);

  const handleAcceptTownStay = useCallback(() => {
    if (!townPrompt) return;
    const town = townPrompt;
    setTownPrompt(null);
    setScavengedWeapon(null);
    setScavengeFeedback(null);
    setTownStopMenu(town);
    engineRef.current?.setTownStayPaused(true);
  }, [townPrompt]);

  const handlePromptScavenge = useCallback(() => {
    if (!townPrompt) return;
    if (!canScavengeLocation(scavengeDayState, townPrompt.id)) return;
    const town = townPrompt;
    setTownPrompt(null);
    setTownStopMenu(town);
    setScavengeDayState((prev) => recordLocationScavenge(prev, town.id));
    setScavengedWeapon(rollScavengedWeapon());
    setScavengeFeedback(null);
    engineRef.current?.setTownStayPaused(true);
  }, [townPrompt, scavengeDayState]);

  const handleDeclineTownStay = useCallback(() => {
    setTownPrompt(null);
  }, []);

  const handleTownScavenge = useCallback(() => {
    if (!townStopMenu) return;
    if (!canScavengeLocation(scavengeDayState, townStopMenu.id)) return;
    setScavengeDayState((prev) => recordLocationScavenge(prev, townStopMenu.id));
    setScavengedWeapon(rollScavengedWeapon());
    setScavengeFeedback(null);
  }, [townStopMenu, scavengeDayState]);

  const handleStoreScavengedWeapon = useCallback(() => {
    if (!scavengedWeapon || !townStopMenu || scavengeFeedback?.stored) return;
    const mile = Math.round((telemetry?.currentMile ?? townStopMenu.mileMarker) * 10) / 10;
    const res = addItemToTrunk(vehicleStorage, {
      name: scavengedWeapon.name,
      category: 'weapon',
      weaponCategory: scavengedWeapon.category,
      damage: scavengedWeapon.damage,
      addedAtMile: mile,
    });
    if (res.added) {
      setVehicleStorage(res.storage);
      setScavengeFeedback({
        stored: true,
        message: `Stored in Trunk Bay ${res.added.slotIndex + 1}`,
      });
    } else {
      setScavengeFeedback({
        stored: false,
        message: res.error ?? 'Trunk is full (6/6).',
      });
    }
  }, [scavengedWeapon, townStopMenu, scavengeFeedback, telemetry, vehicleStorage]);

  const handleTownSleep = useCallback(() => {
    if (!townStopMenu) return;
    const town = townStopMenu;
    const rawHours = timeOfDay + 8;
    const daysAdvanced = Math.floor(rawHours / 24);
    const nextHour = ((rawHours % 24) + 24) % 24;
    setTownStopMenu(null);
    setScavengedWeapon(null);
    setScavengeFeedback(null);
    setIsSleepingBlackout(true);
    if (sleepTimerRef.current !== null) {
      window.clearTimeout(sleepTimerRef.current);
    }
    sleepTimerRef.current = window.setTimeout(() => {
      sleepTimerRef.current = null;
      engineRef.current?.exitTownToRoad(town, 8);
      setTimeOfDay(nextHour);
      if (daysAdvanced > 0) {
        setScavengeDayState((prev) => advanceScavengeDayCycle(prev, daysAdvanced));
      }
      setIsSleepingBlackout(false);
    }, 3000);
  }, [townStopMenu, timeOfDay]);

  const handleTownLeave = useCallback(() => {
    if (!townStopMenu) return;
    const town = townStopMenu;
    setTownStopMenu(null);
    setScavengedWeapon(null);
    setScavengeFeedback(null);
    engineRef.current?.exitTownToRoad(town, 0);
  }, [townStopMenu]);

  const handleRemovePassenger = useCallback((seatIndex: number) => {
    setVehicleStorage((prev) => removePassengerFromVehicle(prev, seatIndex));
  }, []);

  const handleClearPassengers = useCallback(() => {
    setVehicleStorage((prev) => clearVehiclePassengers(prev));
  }, []);

  const handleRemoveTrunkItem = useCallback((slotIndex: number) => {
    setVehicleStorage((prev) => removeItemFromTrunk(prev, slotIndex));
  }, []);

  const handleClearTrunk = useCallback(() => {
    setVehicleStorage((prev) => clearVehicleTrunk(prev));
  }, []);

  const storageCounts = getVehicleStorageCounts(vehicleStorage);
  const promptScavengesUsed = townPrompt
    ? getLocationScavengesUsed(scavengeDayState, townPrompt.id)
    : 0;
  const stopMenuScavengesUsed = townStopMenu
    ? getLocationScavengesUsed(scavengeDayState, townStopMenu.id)
    : 0;

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-slate-950 font-sans">
      {/* 1. Dedicated WebGL Mount Container */}
      <div
        ref={canvasMountRef}
        className="absolute inset-0 z-0 w-full h-full"
      />

      {/* 2. Interactive HUD Overlay */}
      <HUD
        telemetry={telemetry}
        activeRoute={activeRoute}
        onSelectRoute={handleSelectRoute}
        onJumpProgress={handleJumpProgress}
        onCameraChange={handleCameraChange}
        activeCameraMode={cameraMode}
        onTimeOfDayChange={handleTimeOfDayChange}
        currentTimeOfDay={timeOfDay}
        dayCycle={scavengeDayState.dayCycle}
        onToggleCruise={handleToggleCruise}
        isCruiseActive={isCruiseActive}
        onToggleAudio={handleToggleAudio}
        isAudioMuted={isAudioMuted}
        onOpenCodeModal={() => setIsCodeModalOpen(true)}
        onOpenStorage={() => setIsStorageOpen(true)}
        storageCounts={storageCounts}
        onControlInput={handleControlInput}
        onTakeExit={handleTakeExit}
        onReturnToMainRoute={handleReturnToMainRoute}
        onTurnAround={handleTurnAround}
        townPrompt={townPrompt}
        townStopMenu={townStopMenu}
        scavengedWeapon={scavengedWeapon}
        scavengeFeedback={scavengeFeedback}
        promptScavengesRemaining={Math.max(
          0,
          MAX_SCAVENGES_PER_LOCATION_PER_DAY - promptScavengesUsed
        )}
        stopMenuScavengesRemaining={Math.max(
          0,
          MAX_SCAVENGES_PER_LOCATION_PER_DAY - stopMenuScavengesUsed
        )}
        maxScavengesPerDay={MAX_SCAVENGES_PER_LOCATION_PER_DAY}
        onAcceptTownStay={handleAcceptTownStay}
        onPromptScavenge={handlePromptScavenge}
        onDeclineTownStay={handleDeclineTownStay}
        onTownScavenge={handleTownScavenge}
        onStoreScavengedWeapon={handleStoreScavengedWeapon}
        onTownSleep={handleTownSleep}
        onTownLeave={handleTownLeave}
      />

      {/* 3. Standalone HTML Export Modal */}
      <StandaloneExportModal
        isOpen={isCodeModalOpen}
        onClose={() => setIsCodeModalOpen(false)}
      />

      {/* 3b. Vehicle Storage Modal (3 Passengers / 6 Trunk Items) */}
      <VehicleStorageModal
        isOpen={isStorageOpen}
        onClose={() => setIsStorageOpen(false)}
        storage={vehicleStorage}
        onRemovePassenger={handleRemovePassenger}
        onClearPassengers={handleClearPassengers}
        onRemoveTrunkItem={handleRemoveTrunkItem}
        onClearTrunk={handleClearTrunk}
      />

      {/* 4. Full-Screen 3-Second Sleep Blackout */}
      {isSleepingBlackout && (
        <div
          className="fixed inset-0 z-50 bg-black pointer-events-auto"
          aria-label="Sleeping for 8 hours"
        />
      )}
    </div>
  );
}
