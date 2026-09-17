import React from 'react';
import { X, CheckCircle2, ShieldAlert, Cpu, Sparkles, Terminal, FileCode2 } from 'lucide-react';

interface InfoModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const InfoModal: React.FC<InfoModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto text-slate-800">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-red-100 text-red-600 flex items-center justify-center">
              <Sparkles className="w-4 h-4" />
            </div>
            <h2 className="text-sm font-bold text-slate-900">
              파이프라인 안내
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 5 Stages Explanation */}
        <div className="space-y-2 text-xs">
          <h3 className="font-semibold text-slate-800 text-xs">
            처리 단계
          </h3>
          <div className="space-y-1.5">
            <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200">
              <p className="font-semibold text-slate-900">1. 영상 준비</p>
              <p className="text-slate-600 mt-0.5">
                YouTube 및 Instagram(릴스/게시물) 링크 또는 사용자 업로드 영상/음성을 준비합니다.
              </p>
            </div>
            <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200">
              <p className="font-semibold text-slate-900">2. 오디오 추출</p>
              <p className="text-slate-600 mt-0.5">
                FFmpeg 초경량 64k MP3로 고효율 오디오를 신속히 추출합니다.
              </p>
            </div>
            <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200">
              <p className="font-semibold text-slate-900">3. Whisper 음성 인식</p>
              <p className="text-slate-600 mt-0.5">
                Whisper Turbo 모델을 통해 밀리초 단위의 정확한 타임스탬프와 영문 스크립트를 추출합니다.
              </p>
            </div>
            <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200">
              <p className="font-semibold text-slate-900">4. AI 번역</p>
              <p className="text-slate-600 mt-0.5">
                방송 뉴스 전문 프롬프트를 적용하여 자연스러운 한국어 자막을 생성합니다.
              </p>
            </div>
            <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200">
              <p className="font-semibold text-slate-900">5. 자막 합성</p>
              <p className="text-slate-600 mt-0.5">
                소프트자막(mov_text) 스트림으로 1초 이내에 합성하며, 편집기에서 수정 즉시 재합성할 수 있습니다.
              </p>
            </div>
          </div>
        </div>

        {/* API Key Info */}
        <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-xs space-y-1">
          <div className="flex items-center gap-1.5 text-blue-800 font-semibold">
            <Cpu className="w-3.5 h-3.5" />
            <span>API 키</span>
          </div>
          <p className="text-slate-600 leading-relaxed text-[11px]">
            <code className="text-blue-900 font-mono font-medium">OPENROUTER_API_KEY</code>(DeepSeek V4.1 Flash 번역) 및 <code className="text-blue-900 font-mono font-medium">GROQ_API_KEY</code>(Whisper 음성 인식)를 등록해 사용할 수 있습니다.
          </p>
        </div>

        {/* Footer close */}
        <div className="flex justify-end pt-1">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold transition-colors shadow-xs"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
};
