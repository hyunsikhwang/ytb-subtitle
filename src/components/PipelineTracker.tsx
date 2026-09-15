import React, { useState } from 'react';
import {
  CheckCircle2,
  Loader2,
  Clock,
  Terminal,
  ChevronDown,
  ChevronUp,
  Download,
  Music,
  FileText,
  Languages,
  Film
} from 'lucide-react';
import { PipelineProgress } from '../types';

interface PipelineTrackerProps {
  progress: PipelineProgress;
  logs: string[];
}

const STAGES = [
  { id: 1, title: '영상 준비', desc: '다운로드/업로드', icon: Download },
  { id: 2, title: '오디오 추출', desc: '64k MP3', icon: Music },
  { id: 3, title: '음성 인식', desc: 'Whisper Turbo', icon: FileText },
  { id: 4, title: 'AI 번역', desc: '한국어 번역', icon: Languages },
  { id: 5, title: '자막 합성', desc: 'Softsub MP4', icon: Film },
];

export const PipelineTracker: React.FC<PipelineTrackerProps> = ({
  progress,
  logs
}) => {
  const [showLogs, setShowLogs] = useState(false);

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-red-600 animate-pulse" />
          <h3 className="text-xs font-bold text-slate-900 tracking-wide">
            진행 상태 ({progress.stageIndex}/5)
          </h3>
        </div>
        <div className="text-xs text-slate-500 font-mono">
          {progress.message || '진행 중'}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden border border-slate-200">
        <div
          className="h-full bg-gradient-to-r from-red-500 via-rose-500 to-amber-500 transition-all duration-500 ease-out"
          style={{ width: `${Math.max(5, (progress.stageIndex / 5) * 100)}%` }}
        />
      </div>

      {/* 5 Stages Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 pt-0.5">
        {STAGES.map((stg) => {
          const isCompleted = progress.stageIndex > stg.id || progress.stage === 'completed';
          const isCurrent = progress.stageIndex === stg.id && progress.stage !== 'completed';
          const Icon = stg.icon;

          return (
            <div
              key={stg.id}
              className={`p-2.5 rounded-xl border transition-all ${
                isCompleted
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                  : isCurrent
                  ? 'bg-red-50 border-red-300 text-red-800 shadow-xs'
                  : 'bg-slate-50 border-slate-200 text-slate-400'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1">
                  <Icon className="w-3.5 h-3.5" />
                  <span className="text-[11px] font-semibold">{stg.id}단계</span>
                </div>
                {isCompleted ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                ) : isCurrent ? (
                  <Loader2 className="w-3.5 h-3.5 text-red-600 animate-spin" />
                ) : (
                  <Clock className="w-3 h-3 text-slate-400" />
                )}
              </div>
              <p className="text-xs font-semibold truncate text-slate-900">{stg.title}</p>
              <p className="text-[10px] text-slate-500 truncate">{stg.desc}</p>
            </div>
          );
        })}
      </div>

      {/* Logs Accordion */}
      {logs.length > 0 && (
        <div className="pt-1.5 border-t border-slate-200">
          <button
            onClick={() => setShowLogs(!showLogs)}
            className="flex items-center justify-between w-full text-xs text-slate-500 hover:text-slate-800 font-medium"
          >
            <div className="flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5 text-slate-400" />
              <span>로그 ({logs.length})</span>
            </div>
            {showLogs ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>

          {showLogs && (
            <div className="mt-2 p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-[11px] font-mono text-emerald-400 max-h-40 overflow-y-auto space-y-1">
              {logs.map((lg, i) => (
                <div key={i} className="leading-relaxed">
                  {lg}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
