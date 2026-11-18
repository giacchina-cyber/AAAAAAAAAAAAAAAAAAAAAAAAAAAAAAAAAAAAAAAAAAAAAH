import {
  PassengerSlot,
  TrunkItem,
  TrunkItemCategory,
  VehicleStorageSpec,
  VehicleStorageState,
  WeaponCategory,
} from '../types';

export const INTERSTATE_CRUISER_STORAGE_SPEC: VehicleStorageSpec = {
  vehicleId: 'interstate-cruiser',
  vehicleName: 'Interstate Muscle Cruiser',
  maxPassengers: 3,
  maxTrunkItems: 6,
  seatLabels: ['Front Passenger', 'Rear Left', 'Rear Right'],
};

const STORAGE_PERSIST_KEY = 'us_highway_vehicle_storage_v1';

export function createEmptyVehicleStorage(
  spec: VehicleStorageSpec = INTERSTATE_CRUISER_STORAGE_SPEC
): VehicleStorageState {
  return {
    spec: { ...spec, seatLabels: [...spec.seatLabels] },
    passengers: Array.from({ length: spec.maxPassengers }, () => null),
    trunk: Array.from({ length: spec.maxTrunkItems }, () => null),
  };
}

export function loadVehicleStorage(
  spec: VehicleStorageSpec = INTERSTATE_CRUISER_STORAGE_SPEC
): VehicleStorageState {
  const base = createEmptyVehicleStorage(spec);
  if (typeof window === 'undefined' || !window.localStorage) {
    return base;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_PERSIST_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<VehicleStorageState>;
    if (Array.isArray(parsed.passengers)) {
      for (let i = 0; i < spec.maxPassengers; i++) {
        const entry = parsed.passengers[i];
        if (entry && typeof entry.name === 'string' && entry.name.trim()) {
          base.passengers[i] = {
            id: typeof entry.id === 'string' ? entry.id : `pax-${i}-${Date.now()}`,
            name: entry.name.trim(),
            seatIndex: i,
            role: typeof entry.role === 'string' ? entry.role : undefined,
            destinationCity:
              typeof entry.destinationCity === 'string' ? entry.destinationCity : undefined,
            boardedAtMile:
              typeof entry.boardedAtMile === 'number' ? entry.boardedAtMile : undefined,
            notes: typeof entry.notes === 'string' ? entry.notes : undefined,
          };
        }
      }
    }
    if (Array.isArray(parsed.trunk)) {
      const validCategories: TrunkItemCategory[] = [
        'supply',
        'gear',
        'luggage',
        'tool',
        'cargo',
        'weapon',
        'misc',
      ];
      const validWeaponCategories: WeaponCategory[] = [
        'Pistol',
        'Assault Rifle',
        'Hunting Rifle',
        'Shotgun',
      ];
      for (let i = 0; i < spec.maxTrunkItems; i++) {
        const entry = parsed.trunk[i];
        if (entry && typeof entry.name === 'string' && entry.name.trim()) {
          const cat = validCategories.includes(entry.category as TrunkItemCategory)
            ? (entry.category as TrunkItemCategory)
            : 'cargo';
          const wCat = validWeaponCategories.includes(entry.weaponCategory as WeaponCategory)
            ? (entry.weaponCategory as WeaponCategory)
            : undefined;
          const dmg =
            typeof entry.damage === 'number' && Number.isFinite(entry.damage)
              ? Math.max(15, Math.min(95, Math.round(entry.damage)))
              : undefined;
          base.trunk[i] = {
            id: typeof entry.id === 'string' ? entry.id : `item-${i}-${Date.now()}`,
            name: entry.name.trim(),
            category: cat,
            slotIndex: i,
            notes: typeof entry.notes === 'string' ? entry.notes : undefined,
            addedAtMile:
              typeof entry.addedAtMile === 'number' ? entry.addedAtMile : undefined,
            weaponCategory: wCat,
            damage: dmg,
          };
        }
      }
    }
  } catch {
    return createEmptyVehicleStorage(spec);
  }
  return base;
}

export function saveVehicleStorage(storage: VehicleStorageState): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(
      STORAGE_PERSIST_KEY,
      JSON.stringify({
        passengers: storage.passengers,
        trunk: storage.trunk,
      })
    );
  } catch {
    // Ignore storage quota or private browsing errors
  }
}

export function getVehicleStorageCounts(storage: VehicleStorageState): {
  passengersUsed: number;
  maxPassengers: number;
  trunkUsed: number;
  maxTrunkItems: number;
} {
  return {
    passengersUsed: storage.passengers.filter((slot) => slot !== null).length,
    maxPassengers: storage.spec.maxPassengers,
    trunkUsed: storage.trunk.filter((slot) => slot !== null).length,
    maxTrunkItems: storage.spec.maxTrunkItems,
  };
}

export function hasAvailableSeat(storage: VehicleStorageState): boolean {
  return storage.passengers.some((slot) => slot === null);
}

export function hasAvailableTrunkSpace(storage: VehicleStorageState): boolean {
  return storage.trunk.some((slot) => slot === null);
}

export interface AddPassengerInput {
  name: string;
  role?: string;
  destinationCity?: string;
  boardedAtMile?: number;
  notes?: string;
}

export function addPassengerToVehicle(
  storage: VehicleStorageState,
  input: AddPassengerInput,
  preferredSeatIndex?: number
): { storage: VehicleStorageState; added: PassengerSlot | null; error?: string } {
  const trimmedName = input.name.trim();
  if (!trimmedName) {
    return { storage, added: null, error: 'Passenger name is required.' };
  }

  let targetIndex = -1;
  if (
    preferredSeatIndex !== undefined &&
    preferredSeatIndex >= 0 &&
    preferredSeatIndex < storage.spec.maxPassengers &&
    storage.passengers[preferredSeatIndex] === null
  ) {
    targetIndex = preferredSeatIndex;
  } else {
    targetIndex = storage.passengers.findIndex((slot) => slot === null);
  }

  if (targetIndex === -1) {
    return {
      storage,
      added: null,
      error: `All ${storage.spec.maxPassengers} passenger seats are occupied.`,
    };
  }

  const newPassenger: PassengerSlot = {
    id: `pax-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: trimmedName,
    seatIndex: targetIndex,
    role: input.role?.trim() || undefined,
    destinationCity: input.destinationCity?.trim() || undefined,
    boardedAtMile: input.boardedAtMile,
    notes: input.notes?.trim() || undefined,
  };

  const nextPassengers = [...storage.passengers];
  nextPassengers[targetIndex] = newPassenger;

  return {
    storage: { ...storage, passengers: nextPassengers },
    added: newPassenger,
  };
}

export function removePassengerFromVehicle(
  storage: VehicleStorageState,
  seatIndex: number
): VehicleStorageState {
  if (seatIndex < 0 || seatIndex >= storage.passengers.length) return storage;
  if (storage.passengers[seatIndex] === null) return storage;
  const nextPassengers = [...storage.passengers];
  nextPassengers[seatIndex] = null;
  return { ...storage, passengers: nextPassengers };
}

export function clearVehiclePassengers(storage: VehicleStorageState): VehicleStorageState {
  return {
    ...storage,
    passengers: Array.from({ length: storage.spec.maxPassengers }, () => null),
  };
}

export interface AddTrunkItemInput {
  name: string;
  category?: TrunkItemCategory;
  notes?: string;
  addedAtMile?: number;
  weaponCategory?: WeaponCategory;
  damage?: number;
}

export function addItemToTrunk(
  storage: VehicleStorageState,
  input: AddTrunkItemInput,
  preferredSlotIndex?: number
): { storage: VehicleStorageState; added: TrunkItem | null; error?: string } {
  const trimmedName = input.name.trim();
  if (!trimmedName) {
    return { storage, added: null, error: 'Item name is required.' };
  }

  let targetIndex = -1;
  if (
    preferredSlotIndex !== undefined &&
    preferredSlotIndex >= 0 &&
    preferredSlotIndex < storage.spec.maxTrunkItems &&
    storage.trunk[preferredSlotIndex] === null
  ) {
    targetIndex = preferredSlotIndex;
  } else {
    targetIndex = storage.trunk.findIndex((slot) => slot === null);
  }

  if (targetIndex === -1) {
    return {
      storage,
      added: null,
      error: `Trunk is full (${storage.spec.maxTrunkItems}/${storage.spec.maxTrunkItems} items).`,
    };
  }

  const newItem: TrunkItem = {
    id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: trimmedName,
    category: input.category ?? 'cargo',
    slotIndex: targetIndex,
    notes: input.notes?.trim() || undefined,
    addedAtMile: input.addedAtMile,
    weaponCategory: input.weaponCategory,
    damage:
      input.damage !== undefined
        ? Math.max(15, Math.min(95, Math.round(input.damage)))
        : undefined,
  };

  const nextTrunk = [...storage.trunk];
  nextTrunk[targetIndex] = newItem;

  return {
    storage: { ...storage, trunk: nextTrunk },
    added: newItem,
  };
}

export function removeItemFromTrunk(
  storage: VehicleStorageState,
  slotIndex: number
): VehicleStorageState {
  if (slotIndex < 0 || slotIndex >= storage.trunk.length) return storage;
  if (storage.trunk[slotIndex] === null) return storage;
  const nextTrunk = [...storage.trunk];
  nextTrunk[slotIndex] = null;
  return { ...storage, trunk: nextTrunk };
}

export function clearVehicleTrunk(storage: VehicleStorageState): VehicleStorageState {
  return {
    ...storage,
    trunk: Array.from({ length: storage.spec.maxTrunkItems }, () => null),
  };
}
