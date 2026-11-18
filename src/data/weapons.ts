import { ScavengedWeapon, WeaponCategory } from '../types';

export interface WeaponTemplate {
  name: string;
  category: WeaponCategory;
  minDamage: number;
  maxDamage: number;
}

export const WEAPON_TEMPLATES: WeaponTemplate[] = [
  // Pistols (15 - 45)
  { name: '9mm Service Pistol', category: 'Pistol', minDamage: 15, maxDamage: 22 },
  { name: 'Compact .38 Revolver', category: 'Pistol', minDamage: 19, maxDamage: 27 },
  { name: '.45 Tactical Pistol', category: 'Pistol', minDamage: 25, maxDamage: 34 },
  { name: 'Heavy .357 Magnum', category: 'Pistol', minDamage: 33, maxDamage: 41 },
  { name: '.44 Chrome Revolver', category: 'Pistol', minDamage: 38, maxDamage: 45 },

  // Assault Rifles (40 - 70)
  { name: '5.56 Patrol Carbine', category: 'Assault Rifle', minDamage: 40, maxDamage: 49 },
  { name: 'Tactical M4 Rifle', category: 'Assault Rifle', minDamage: 46, maxDamage: 55 },
  { name: 'AK-Pattern 7.62 Rifle', category: 'Assault Rifle', minDamage: 52, maxDamage: 62 },
  { name: 'Spec-Ops Bullpup Rifle', category: 'Assault Rifle', minDamage: 56, maxDamage: 65 },
  { name: 'Heavy Battle Rifle', category: 'Assault Rifle', minDamage: 61, maxDamage: 70 },

  // Hunting Rifles (56 - 95)
  { name: 'Lever-Action .30-30 Rifle', category: 'Hunting Rifle', minDamage: 56, maxDamage: 66 },
  { name: 'Bolt-Action .308 Rifle', category: 'Hunting Rifle', minDamage: 68, maxDamage: 78 },
  { name: 'Scoped .30-06 Marksman', category: 'Hunting Rifle', minDamage: 76, maxDamage: 85 },
  { name: 'Long-Range .300 WinMag', category: 'Hunting Rifle', minDamage: 83, maxDamage: 91 },
  { name: '.338 Frontier Rifle', category: 'Hunting Rifle', minDamage: 88, maxDamage: 95 },

  // Shotguns (50 - 88)
  { name: 'Sawed-Off Double Barrel', category: 'Shotgun', minDamage: 50, maxDamage: 60 },
  { name: '12-Gauge Pump Shotgun', category: 'Shotgun', minDamage: 59, maxDamage: 69 },
  { name: 'Riot 12G Trench Gun', category: 'Shotgun', minDamage: 66, maxDamage: 76 },
  { name: 'Semi-Auto Combat Shotgun', category: 'Shotgun', minDamage: 73, maxDamage: 82 },
  { name: 'Heavy 10-Gauge Coach Gun', category: 'Shotgun', minDamage: 79, maxDamage: 88 },
];

export function rollScavengedWeapon(): ScavengedWeapon {
  const tpl = WEAPON_TEMPLATES[Math.floor(Math.random() * WEAPON_TEMPLATES.length)];
  const rawDamage =
    tpl.minDamage + Math.floor(Math.random() * (tpl.maxDamage - tpl.minDamage + 1));
  const damage = Math.max(15, Math.min(95, rawDamage));

  return {
    id: `wpn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: tpl.name,
    category: tpl.category,
    damage,
  };
}

export const MAX_SCAVENGES_PER_LOCATION_PER_DAY = 3;
const SCAVENGE_DAY_PERSIST_KEY = 'us_highway_scavenge_day_v1';

export interface ScavengeDayState {
  dayCycle: number;
  countsByLocation: Record<string, { day: number; count: number }>;
}

export function loadScavengeDayState(): ScavengeDayState {
  const fallback: ScavengeDayState = { dayCycle: 1, countsByLocation: {} };
  if (typeof window === 'undefined' || !window.localStorage) return fallback;
  try {
    const raw = window.localStorage.getItem(SCAVENGE_DAY_PERSIST_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<ScavengeDayState>;
    const dayCycle =
      typeof parsed.dayCycle === 'number' && parsed.dayCycle >= 1
        ? Math.floor(parsed.dayCycle)
        : 1;
    const countsByLocation: Record<string, { day: number; count: number }> = {};
    if (parsed.countsByLocation && typeof parsed.countsByLocation === 'object') {
      for (const [locId, entry] of Object.entries(parsed.countsByLocation)) {
        if (
          entry &&
          typeof entry.day === 'number' &&
          typeof entry.count === 'number'
        ) {
          countsByLocation[locId] = {
            day: Math.floor(entry.day),
            count: Math.max(0, Math.min(MAX_SCAVENGES_PER_LOCATION_PER_DAY, Math.floor(entry.count))),
          };
        }
      }
    }
    return { dayCycle, countsByLocation };
  } catch {
    return fallback;
  }
}

export function saveScavengeDayState(state: ScavengeDayState): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(SCAVENGE_DAY_PERSIST_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage quota or private browsing errors
  }
}

export function getLocationScavengesUsed(
  state: ScavengeDayState,
  locationId: string
): number {
  const entry = state.countsByLocation[locationId];
  if (!entry || entry.day !== state.dayCycle) return 0;
  return Math.min(MAX_SCAVENGES_PER_LOCATION_PER_DAY, Math.max(0, entry.count));
}

export function canScavengeLocation(
  state: ScavengeDayState,
  locationId: string
): boolean {
  return getLocationScavengesUsed(state, locationId) < MAX_SCAVENGES_PER_LOCATION_PER_DAY;
}

export function recordLocationScavenge(
  state: ScavengeDayState,
  locationId: string
): ScavengeDayState {
  const used = getLocationScavengesUsed(state, locationId);
  if (used >= MAX_SCAVENGES_PER_LOCATION_PER_DAY) return state;
  return {
    ...state,
    countsByLocation: {
      ...state.countsByLocation,
      [locationId]: {
        day: state.dayCycle,
        count: used + 1,
      },
    },
  };
}

export function advanceScavengeDayCycle(
  state: ScavengeDayState,
  days: number = 1
): ScavengeDayState {
  if (days <= 0) return state;
  return {
    dayCycle: state.dayCycle + days,
    countsByLocation: {},
  };
}

