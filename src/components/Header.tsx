import React from 'react';
import { Sparkles, Video, Cpu, Info, CheckCircle2, AlertCircle } from 'lucide-react';
import { ServerStatus } from '../types';

interface HeaderProps {
  status: ServerStatus | null;
  onOpenInfo: () => void;
}

export const Header: React.FC<HeaderProps> = ({ status, onOpenInfo }) => {
  return (
    <header className="bg-white border-b border-slate-200 text-slate-800 sticky top-0 z-30 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-red-600 via-rose-500 to-amber-500 flex items-center justify-center shadow-xs">
            <Video className="w-5 h-5 text-white" />
          </div>
          <div className="flex items-center gap-2">
            <h1 className="text-base font-bold tracking-tight text-slate-900">
              YouTube 자막 스튜디오
            </h1>
            <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200">
              Groq AI
            </span>
          </div>
        </div>

        {/* Engine status & Info */}
        <div className="flex items-center gap-2.5">
          {/* Active Engine Badge */}
          <div className="hidden sm:flex items-center gap-2 px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200 text-xs">
            <span className="font-medium text-slate-600">Whisper Turbo</span>
            <span className="text-slate-300">·</span>
            <span className="font-medium text-emerald-700">
              {status?.hasOpenRouterKey || status?.hasGroqKey ? 'GPT-OSS' : '데모'}
            </span>
            <span className={`w-1.5 h-1.5 rounded-full ${status?.hasOpenRouterKey ? 'bg-indigo-500' : status?.hasGroqKey ? 'bg-emerald-500' : 'bg-amber-500'}`} />
          </div>

          <button
            onClick={onOpenInfo}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs transition-colors font-medium border border-slate-200"
            title="파이프라인 안내"
          >
            <Info className="w-3.5 h-3.5 text-blue-600" />
            <span>도움말</span>
          </button>
        </div>
      </div>
    </header>
  );
};
