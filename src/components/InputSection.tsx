import React, { useState, useRef } from 'react';
import {
  Youtube,
  Upload,
  PlayCircle,
  Settings2,
  Sparkles,
  Link2,
  FileVideo,
  ChevronDown,
  ChevronUp,
  KeyRound,
  Zap,
  Check
} from 'lucide-react';
import { PROMPT_SAMPLE_YOUTUBE_URL } from '../data/sampleData';

interface InputSectionProps {
  onStartPipeline: (params: {
    youtubeUrl?: string;
    directUrl?: string;
    mediaFile?: File | null;
    useSample?: boolean;
    model?: string;
    cookiesText?: string;
  }) => void;
  isProcessing: boolean;
}

export const InputSection: React.FC<InputSectionProps> = ({
  onStartPipeline,
  isProcessing
}) => {
  const [activeTab, setActiveTab] = useState<'youtube' | 'upload' | 'sample'>('youtube');
  const [youtubeUrl, setYoutubeUrl] = useState<string>(PROMPT_SAMPLE_YOUTUBE_URL);
  const [directUrl, setDirectUrl] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>('openai/gpt-oss-20b');
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
  const [cookiesText, setCookiesText] = useState<string>('');
  const [isDragOver, setIsDragOver] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setSelectedFile(e.dataTransfer.files[0]);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (activeTab === 'youtube') {
      if (!youtubeUrl.trim()) return;
      onStartPipeline({
        youtubeUrl: youtubeUrl.trim(),
        model: selectedModel,
        cookiesText: cookiesText.trim()
      });
    } else if (activeTab === 'upload') {
      if (!selectedFile) return;
      onStartPipeline({
        mediaFile: selectedFile,
        model: selectedModel
      });
    } else {
      onStartPipeline({
        useSample: true,
        model: selectedModel
      });
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
      {/* Tabs */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-3 mb-4">
        <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl border border-slate-200">
          <button
            type="button"
            onClick={() => setActiveTab('youtube')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'youtube'
                ? 'bg-red-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/70'
            }`}
          >
            <Youtube className="w-4 h-4" />
            <span>YouTube</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('upload')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'upload'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/70'
            }`}
          >
            <Upload className="w-4 h-4" />
            <span>파일 업로드</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('sample')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'sample'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/70'
            }`}
          >
            <PlayCircle className="w-4 h-4" />
            <span>샘플 영상</span>
          </button>
        </div>

        {/* Preset quick buttons */}
        <div className="hidden md:flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setActiveTab('youtube');
              setYoutubeUrl(PROMPT_SAMPLE_YOUTUBE_URL);
            }}
            className="text-[11px] text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-2.5 py-1 rounded-md border border-slate-200 transition-colors flex items-center gap-1.5 font-medium"
            title="OpenAI 대담 샘플 링크"
          >
            <Zap className="w-3 h-3 text-amber-500" />
            <span>샘플 URL</span>
          </button>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Tab 1: YouTube */}
        {activeTab === 'youtube' && (
          <div className="space-y-2.5">
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                <Youtube className="w-5 h-5 text-red-500" />
              </div>
              <input
                type="text"
                value={youtubeUrl}
                onChange={(e) => setYoutubeUrl(e.target.value)}
                placeholder="YouTube 영상 링크 입력 (https://...)"
                className="w-full pl-11 pr-20 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-500 transition-all font-mono"
                disabled={isProcessing}
              />
              {youtubeUrl && (
                <button
                  type="button"
                  onClick={() => setYoutubeUrl('')}
                  className="absolute inset-y-0 right-3 flex items-center text-xs text-slate-400 hover:text-slate-600 font-medium"
                >
                  지우기
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span>샘플:</span>
              <button
                type="button"
                onClick={() => setYoutubeUrl(PROMPT_SAMPLE_YOUTUBE_URL)}
                className="text-red-600 hover:underline font-mono font-medium"
              >
                ctWJw8sQghk (OpenAI 대담)
              </button>
            </div>
          </div>
        )}

        {/* Tab 2: File Upload */}
        {activeTab === 'upload' && (
          <div className="space-y-3">
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-all ${
                isDragOver
                  ? 'border-blue-500 bg-blue-50/50'
                  : selectedFile
                  ? 'border-emerald-500 bg-emerald-50/50'
                  : 'border-slate-300 hover:border-slate-400 bg-slate-50'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="video/mp4,video/webm,video/quicktime,audio/mp3,audio/wav,audio/m4a,audio/ogg"
                onChange={handleFileChange}
                className="hidden"
                disabled={isProcessing}
              />

              {selectedFile ? (
                <div className="flex flex-col items-center gap-1.5">
                  <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center">
                    <FileVideo className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{selectedFile.name}</p>
                    <p className="text-xs text-slate-500">
                      {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB · 다른 파일 선택
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-1.5">
                  <div className="w-10 h-10 rounded-xl bg-slate-200 text-slate-600 flex items-center justify-center">
                    <Upload className="w-5 h-5" />
                  </div>
                  <p className="text-xs font-semibold text-slate-700">
                    영상 또는 오디오 파일 선택 (또는 드래그)
                  </p>
                  <p className="text-[11px] text-slate-400">최대 250MB (MP4, WebM, MP3 등)</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 3: Sample Demo */}
        {activeTab === 'sample' && (
          <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-slate-700 space-y-1">
            <div className="flex items-center gap-1.5 text-emerald-800 font-semibold text-xs">
              <PlayCircle className="w-4 h-4" />
              <span>OpenAI 대담 데모 영상 (60초)</span>
            </div>
            <p className="text-slate-600 text-[11px]">
              다운로드 없이 음성 인식, 번역 및 자막 편집 기능을 즉시 테스트할 수 있습니다.
            </p>
          </div>
        )}

        {/* Model Selection & Advanced Options */}
        <div className="pt-2 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-600 flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              모델:
            </span>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="bg-white border border-slate-300 text-slate-800 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 font-medium shadow-2xs"
              disabled={isProcessing}
            >
              <option value="openai/gpt-oss-20b">GPT-OSS (기본)</option>
              <option value="deepseek/deepseek-v4.1-flash">DeepSeek V4.1 Flash</option>
              <option value="llama-3.3-70b-versatile">Llama 3.3 70B</option>
              <option value="llama-3.1-8b-instant">Llama 3.1 8B</option>
            </select>
          </div>

          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 transition-colors font-medium"
          >
            <Settings2 className="w-3.5 h-3.5" />
            <span>쿠키 설정</span>
            {showAdvanced ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Advanced Accordion */}
        {showAdvanced && (
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2 text-xs text-slate-700">
            <div className="flex items-center gap-1.5 font-medium text-slate-800">
              <KeyRound className="w-3.5 h-3.5 text-amber-600" />
              <span>YouTube 쿠키 (선택)</span>
            </div>
            <textarea
              value={cookiesText}
              onChange={(e) => setCookiesText(e.target.value)}
              placeholder="차단 발생 시 브라우저의 cookies.txt 내용을 입력하세요"
              rows={2}
              className="w-full bg-white border border-slate-300 rounded-lg p-2 text-xs font-mono text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
            />
          </div>
        )}

        {/* Submit Button */}
        <div className="pt-1 flex items-center justify-end">
          <button
            type="submit"
            disabled={isProcessing || (activeTab === 'upload' && !selectedFile)}
            className={`w-full sm:w-auto px-5 py-2.5 rounded-xl text-xs font-bold text-white shadow-sm flex items-center justify-center gap-2 transition-all ${
              isProcessing
                ? 'bg-slate-300 cursor-not-allowed text-slate-500'
                : 'bg-red-600 hover:bg-red-700 active:scale-[0.98]'
            }`}
          >
            {isProcessing ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>처리 중...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5 text-amber-200" />
                <span>자막 생성</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};
