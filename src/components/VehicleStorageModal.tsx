import React, { useState, useEffect } from 'react';
import {
  TrunkItemCategory,
  VehicleStorageState,
} from '../types';
import { getVehicleStorageCounts } from '../utils/vehicleStorage';
import {
  Briefcase,
  Package,
  Trash2,
  Users,
  X,
} from 'lucide-react';

interface VehicleStorageModalProps {
  isOpen: boolean;
  onClose: () => void;
  storage: VehicleStorageState;
  onRemovePassenger: (seatIndex: number) => void;
  onClearPassengers: () => void;
  onRemoveTrunkItem: (slotIndex: number) => void;
  onClearTrunk: () => void;
}

const CATEGORY_LABELS: Record<TrunkItemCategory, string> = {
  supply: 'Supply',
  gear: 'Gear',
  luggage: 'Luggage',
  tool: 'Tool',
  cargo: 'Cargo',
  weapon: 'Weapon',
  misc: 'Misc',
};

export const VehicleStorageModal: React.FC<VehicleStorageModalProps> = ({
  isOpen,
  onClose,
  storage,
  onRemovePassenger,
  onClearPassengers,
  onRemoveTrunkItem,
  onClearTrunk,
}) => {
  const [activeTab, setActiveTab] = useState<'passengers' | 'trunk'>('passengers');

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const counts = getVehicleStorageCounts(storage);

  const handleSelectSchematicSeat = () => {
    setActiveTab('passengers');
  };

  const handleSelectSchematicBay = () => {
    setActiveTab('trunk');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/90 pointer-events-auto"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-4xl max-h-[88vh] overflow-y-auto bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-6 text-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            <h2 className="text-lg font-bold text-white tracking-tight">
              Vehicle Storage
            </h2>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 mt-1 tabular-nums">
              <span>{storage.spec.vehicleName}</span>
              <span aria-hidden="true">·</span>
              <span>
                Passengers {counts.passengersUsed} / {counts.maxPassengers}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Trunk {counts.trunkUsed} / {counts.maxTrunkItems}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
            aria-label="Close vehicle storage"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Workspace Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mt-5">
          {/* Left Column: Vehicle Cabin & Trunk Schematic */}
          <div className="lg:col-span-4 flex flex-col justify-between bg-slate-950/60 border border-slate-800 rounded-xl p-4">
            <div>
              <div className="text-xs font-semibold text-slate-300 mb-3">
                Cabin &amp; Trunk Layout
              </div>

              {/* Stylized Top-Down Car Frame */}
              <div className="mx-auto max-w-[230px] border border-slate-700 rounded-3xl p-3 bg-slate-900/80">
                <div className="text-[11px] text-center text-slate-500 font-medium mb-2">
                  Front Hood
                </div>

                {/* Front Row: Driver + Seat 0 */}
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div className="rounded-lg border border-sky-500/40 bg-sky-950/40 px-2 py-2.5 text-center">
                    <div className="text-[11px] font-semibold text-sky-300">Driver</div>
                    <div className="text-[10px] text-slate-400">You</div>
                  </div>
                  <button
                    type="button"
                    onClick={handleSelectSchematicSeat}
                    className={`rounded-lg border px-2 py-2.5 text-center transition-colors cursor-pointer ${
                      storage.passengers[0]
                        ? 'border-amber-400/70 bg-amber-500/15 text-amber-200'
                        : 'border-dashed border-slate-700 bg-slate-950/60 text-slate-400 hover:border-slate-500'
                    }`}
                  >
                    <div className="text-[11px] font-semibold truncate">
                      {storage.passengers[0] ? storage.passengers[0].name : 'Front Seat'}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {storage.passengers[0] ? 'Occupied' : 'Open'}
                    </div>
                  </button>
                </div>

                {/* Rear Row: Seat 1 + Seat 2 */}
                <div className="grid grid-cols-2 gap-2 pb-3 mb-3 border-b border-slate-800">
                  {[1, 2].map((seatIdx) => {
                    const occupant = storage.passengers[seatIdx];
                    return (
                      <button
                        key={seatIdx}
                        type="button"
                        onClick={handleSelectSchematicSeat}
                        className={`rounded-lg border px-2 py-2.5 text-center transition-colors cursor-pointer ${
                          occupant
                            ? 'border-amber-400/70 bg-amber-500/15 text-amber-200'
                            : 'border-dashed border-slate-700 bg-slate-950/60 text-slate-400 hover:border-slate-500'
                        }`}
                      >
                        <div className="text-[11px] font-semibold truncate">
                          {occupant ? occupant.name : seatIdx === 1 ? 'Rear Left' : 'Rear Right'}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {occupant ? 'Occupied' : 'Open'}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Trunk Grid: 6 Cargo Bays */}
                <div className="text-[11px] text-slate-400 font-medium mb-1.5 flex items-center justify-between tabular-nums">
                  <span>Trunk Bays</span>
                  <span>
                    {counts.trunkUsed}/{counts.maxTrunkItems}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {storage.trunk.map((item, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={handleSelectSchematicBay}
                      title={
                        item
                          ? item.damage !== undefined
                            ? `${item.name} (${item.weaponCategory ?? 'Weapon'} · ${item.damage} DMG)`
                            : `${item.name} (${CATEGORY_LABELS[item.category]})`
                          : `Empty Bay ${idx + 1}`
                      }
                      className={`h-11 rounded-md border px-1 text-center flex flex-col items-center justify-center transition-colors cursor-pointer ${
                        item
                          ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-200'
                          : 'border-dashed border-slate-700 bg-slate-950/60 text-slate-500 hover:border-slate-500'
                      }`}
                    >
                      <span className="text-[10px] font-mono tabular-nums">
                        #{idx + 1}
                      </span>
                      <span className="text-[9px] truncate max-w-full px-0.5">
                        {item ? item.name : 'Empty'}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-800 text-xs text-slate-400 space-y-1">
              <div>Select a section on the layout to view cabin seats or trunk bays.</div>
              <div className="text-slate-500">
                Capacity: 3 passengers, 6 trunk items.
              </div>
            </div>
          </div>

          {/* Right Column: Segmented Section Tabs & Management */}
          <div className="lg:col-span-8 flex flex-col">
            {/* Segmented Control */}
            <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
              <div className="inline-flex items-center gap-1 p-1 bg-slate-950 border border-slate-800 rounded-lg">
                <button
                  type="button"
                  onClick={() => setActiveTab('passengers')}
                  className={`px-3.5 py-2 text-xs font-semibold rounded-md transition-colors flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer ${
                    activeTab === 'passengers'
                      ? 'bg-amber-500 text-slate-950'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  <Users className="w-3.5 h-3.5" />
                  <span>Passengers</span>
                  <span className="font-mono tabular-nums">
                    {counts.passengersUsed}/{counts.maxPassengers}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('trunk')}
                  className={`px-3.5 py-2 text-xs font-semibold rounded-md transition-colors flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer ${
                    activeTab === 'trunk'
                      ? 'bg-amber-500 text-slate-950'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  <Briefcase className="w-3.5 h-3.5" />
                  <span>Trunk Cargo</span>
                  <span className="font-mono tabular-nums">
                    {counts.trunkUsed}/{counts.maxTrunkItems}
                  </span>
                </button>
              </div>

              {activeTab === 'passengers' && counts.passengersUsed > 0 && (
                <button
                  type="button"
                  onClick={onClearPassengers}
                  className="px-3 py-2 rounded-lg text-xs font-semibold text-slate-300 hover:text-rose-300 hover:bg-slate-800 border border-slate-700 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  Clear Passengers
                </button>
              )}
              {activeTab === 'trunk' && counts.trunkUsed > 0 && (
                <button
                  type="button"
                  onClick={onClearTrunk}
                  className="px-3 py-2 rounded-lg text-xs font-semibold text-slate-300 hover:text-rose-300 hover:bg-slate-800 border border-slate-700 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  Empty Trunk
                </button>
              )}
            </div>

            {/* PASSENGERS PANEL */}
            {activeTab === 'passengers' && (
              <div className="flex flex-col gap-4">
                <div className="border border-slate-800 rounded-xl divide-y divide-slate-800 bg-slate-950/40">
                  {storage.passengers.map((occupant, seatIdx) => {
                    const seatLabel = storage.spec.seatLabels[seatIdx] ?? `Seat ${seatIdx + 1}`;
                    return (
                      <div
                        key={seatIdx}
                        className="flex items-center justify-between gap-4 px-4 py-3.5"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 text-xs text-slate-400">
                            <span className="font-mono tabular-nums text-slate-500">
                              0{seatIdx + 1}.
                            </span>
                            <span className="font-medium text-slate-300">{seatLabel}</span>
                            {occupant?.boardedAtMile !== undefined && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono tabular-nums">
                                  Boarded MI {occupant.boardedAtMile}
                                </span>
                              </>
                            )}
                          </div>
                          {occupant ? (
                            <div className="mt-0.5 flex flex-wrap items-baseline gap-2">
                              <span className="text-sm font-semibold text-white truncate">
                                {occupant.name}
                              </span>
                              {occupant.destinationCity && (
                                <span className="text-xs text-slate-400">
                                  To {occupant.destinationCity}
                                </span>
                              )}
                            </div>
                          ) : (
                            <div className="text-xs text-slate-500 mt-0.5">
                              Seat available
                            </div>
                          )}
                        </div>

                        {occupant && (
                          <button
                            type="button"
                            onClick={() => onRemovePassenger(seatIdx)}
                            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-950/70 hover:text-rose-200 border border-slate-700 hover:border-rose-600/60 text-xs font-semibold text-slate-300 transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Remove
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* TRUNK CARGO PANEL */}
            {activeTab === 'trunk' && (
              <div className="flex flex-col gap-4">
                {/* 6 Trunk Bays List */}
                <div className="border border-slate-800 rounded-xl divide-y divide-slate-800 bg-slate-950/40">
                  {storage.trunk.map((item, bayIdx) => (
                    <div
                      key={bayIdx}
                      className="flex items-center justify-between gap-4 px-4 py-2.5"
                    >
                      <div className="min-w-0 flex-1 flex items-center gap-3">
                        <Package
                          className={`w-4 h-4 shrink-0 ${
                            item ? 'text-emerald-400' : 'text-slate-600'
                          }`}
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-xs text-slate-400">
                            <span className="font-mono tabular-nums text-slate-500">
                              Bay {bayIdx + 1}
                            </span>
                            {item && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="text-slate-300">
                                  {item.weaponCategory ?? CATEGORY_LABELS[item.category]}
                                </span>
                                {item.damage !== undefined && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="font-mono font-semibold text-amber-300 tabular-nums">
                                      DMG {item.damage}
                                    </span>
                                  </>
                                )}
                                {item.addedAtMile !== undefined && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="font-mono tabular-nums">
                                      MI {item.addedAtMile}
                                    </span>
                                  </>
                                )}
                              </>
                            )}
                          </div>
                          {item ? (
                            <div className="mt-0.5 flex flex-wrap items-baseline gap-2">
                              <span className="text-sm font-semibold text-white truncate">
                                {item.name}
                              </span>
                              {item.notes && (
                                <span className="text-xs text-slate-400 truncate">
                                  {item.notes}
                                </span>
                              )}
                            </div>
                          ) : (
                            <div className="text-xs text-slate-500 mt-0.5">
                              Empty trunk bay
                            </div>
                          )}
                        </div>
                      </div>

                      {item && (
                        <button
                          type="button"
                          onClick={() => onRemoveTrunkItem(bayIdx)}
                          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-950/70 hover:text-rose-200 border border-slate-700 hover:border-rose-600/60 text-xs font-semibold text-slate-300 transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
