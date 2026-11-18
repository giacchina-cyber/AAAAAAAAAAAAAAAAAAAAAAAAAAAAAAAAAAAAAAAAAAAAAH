import React, { useState } from 'react';
import { X, Copy, Check, Download, ExternalLink, Code } from 'lucide-react';

interface StandaloneExportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const StandaloneExportModal: React.FC<StandaloneExportModalProps> = ({ isOpen, onClose }) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopy = async () => {
    try {
      const res = await fetch('/standalone.html');
      const text = await res.text();
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  const handleDownload = async () => {
    try {
      const res = await fetch('/standalone.html');
      const text = await res.text();
      const blob = new Blob([text], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'us_highway_3d_simulator.html';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // fallback
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/90 pointer-events-auto">
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-6 text-slate-200">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400">
            <Code className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">Standalone Single HTML File</h2>
            <p className="text-xs text-slate-400">
              Complete, self-contained Three.js simulation with vanilla JavaScript in a single file
            </p>
          </div>
        </div>

        <div className="bg-slate-950 rounded-xl p-4 border border-slate-800 text-xs font-mono text-slate-300 space-y-2 max-h-56 overflow-y-auto">
          <p className="text-amber-400 font-bold">Included in the standalone HTML:</p>
          <ul className="list-disc pl-5 space-y-1 text-slate-400">
            <li>Three.js r128 loaded via CDN (no bundler/Node needed)</li>
            <li>Curated real-life GPS coordinates (NYC to LA via Interstate 80 & 15)</li>
            <li>GPS to 3D Cartesian Equirectangular projection with elevation scaling</li>
            <li>Continuous 3D ribbon highway mesh with asphalt texture & yellow/white road markings</li>
            <li>Procedural 3D stylized sports car avatar with rotating wheels, headlights & taillights</li>
            <li>Smooth 3rd-person follow camera with exponential lerp damping</li>
            <li>Full keyboard driving controls ('W' / Up Arrow to drive, 'S' / Down to brake, 'A' / 'D' to steer lanes)</li>
            <li>Live telemetry HUD with digital speedometer (MPH), GPS coords, and mile markers</li>
          </ul>
        </div>

        <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-800">
          <a
            href="/standalone.html"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-sky-400 hover:text-sky-300 font-semibold"
          >
            <ExternalLink className="w-3.5 h-3.5" /> Open in New Tab
          </a>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 transition flex items-center gap-1.5"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-slate-300" />}
              {copied ? 'Copied to Clipboard!' : 'Copy Code'}
            </button>

            <button
              onClick={handleDownload}
              className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition flex items-center gap-1.5 shadow-lg"
            >
              <Download className="w-4 h-4" /> Download .html
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
