import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { InputSection } from './components/InputSection';
import { PipelineTracker } from './components/PipelineTracker';
import { VideoPlayer } from './components/VideoPlayer';
import { SubtitleEditor } from './components/SubtitleEditor';
import { InfoModal } from './components/InfoModal';
import { SubtitleSegment, PipelineProgress, ServerStatus } from './types';
import { SAMPLE_SEGMENTS } from './data/sampleData';
import { extractYoutubeId } from './utils/srtParser';
import { CheckCircle2, AlertTriangle } from 'lucide-react';

export default function App() {
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const [isInfoOpen, setIsInfoOpen] = useState(false);

  // Pipeline state
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<PipelineProgress>({
    stage: 'idle',
    stageIndex: 0,
    totalStages: 5,
    percentage: 0,
    message: '준비 완료'
  });
  const [pipelineLogs, setPipelineLogs] = useState<string[]>([]);

  // Video & Subtitles State
  const [videoUrl, setVideoUrl] = useState<string>('/sample_tech_talk.mp4');
  const [youtubeVideoId, setYoutubeVideoId] = useState<string | null>(null);
  const [softsubVideoUrl, setSoftsubVideoUrl] = useState<string>('/sample_softsub.mp4');
  const [videoTitle, setVideoTitle] = useState<string>('AI & Future Technology Panel Discussion');
  const [segments, setSegments] = useState<SubtitleSegment[]>(SAMPLE_SEGMENTS);

  // Video Player Sync
  const [currentSegmentId, setCurrentSegmentId] = useState<number | null>(null);
  const [seekTime, setSeekTime] = useState<number | null>(null);
  const [isRemuxing, setIsRemuxing] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Show toast utility
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  // Fetch server status on mount
  useEffect(() => {
    fetch('/api/status')
      .then((r) => r.json())
      .then((data: ServerStatus) => setServerStatus(data))
      .catch((err) => console.error('Status fetch failed:', err));
  }, []);

  // Keyboard shortcuts (Space to toggle play when not focused on textarea/input)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      if (e.code === 'Space') {
        e.preventDefault();
        // Dispatched inside VideoPlayer
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Update current active segment based on video time
  const handleTimeUpdate = useCallback(
    (currentTime: number) => {
      const active = segments.find(
        (s) => currentTime >= s.start && currentTime <= s.end
      );
      setCurrentSegmentId(active ? active.id : null);
    },
    [segments]
  );

  // Jump to segment start time
  const handleSeek = (seconds: number) => {
    setSeekTime(seconds);
    // Reset seekTime briefly so consecutive seeks to same time trigger
    setTimeout(() => setSeekTime(null), 100);
  };

  // Run full pipeline
  const handleStartPipeline = async (params: {
    youtubeUrl?: string;
    directUrl?: string;
    mediaFile?: File | null;
    useSample?: boolean;
    model?: string;
    cookiesText?: string;
  }) => {
    setIsProcessing(true);
    setPipelineLogs([]);

    // Immediately update player with user's selected input
    if (params.youtubeUrl) {
      const ytId = extractYoutubeId(params.youtubeUrl);
      setYoutubeVideoId(ytId);
      setVideoUrl(params.youtubeUrl);
      setSoftsubVideoUrl('');
      setVideoTitle(ytId ? `YouTube 영상 (${ytId})` : 'YouTube 영상');
    } else if (params.useSample) {
      setYoutubeVideoId(null);
      setVideoUrl('/sample_tech_talk.mp4');
      setSoftsubVideoUrl('/sample_softsub.mp4');
      setVideoTitle('AI & Future Technology Panel Discussion');
    } else if (params.mediaFile) {
      setYoutubeVideoId(null);
      setVideoUrl(URL.createObjectURL(params.mediaFile));
      setSoftsubVideoUrl('');
      setVideoTitle(params.mediaFile.name);
    } else if (params.directUrl) {
      setYoutubeVideoId(null);
      setVideoUrl(params.directUrl);
      setSoftsubVideoUrl('');
      setVideoTitle('직접 URL 영상');
    }

    // Step 1: Downloading
    setProgress({
      stage: 'downloading',
      stageIndex: 1,
      totalStages: 5,
      percentage: 20,
      message: '[1/5] 영상 준비 및 분석 중...'
    });

    try {
      const formData = new FormData();
      if (params.mediaFile) {
        formData.append('mediaFile', params.mediaFile);
      }
      if (params.youtubeUrl) formData.append('youtubeUrl', params.youtubeUrl);
      if (params.directUrl) formData.append('directUrl', params.directUrl);
      if (params.useSample) formData.append('useSample', 'true');
      if (params.model) formData.append('model', params.model);
      if (params.cookiesText) formData.append('cookiesText', params.cookiesText);

      // Advance stage timers for UX feedback while server is processing
      const timer1 = setTimeout(() => {
        setProgress((prev) => ({
          ...prev,
          stage: 'extracting_audio',
          stageIndex: 2,
          percentage: 40,
          message: '[2/5] 오디오 추출 및 스트리밍 동기화 중...'
        }));
      }, 1500);

      const timer2 = setTimeout(() => {
        setProgress((prev) => ({
          ...prev,
          stage: 'transcribing',
          stageIndex: 3,
          percentage: 60,
          message: '[3/5] Whisper 음성 인식 수행 중 (whisper-large-v3-turbo)...'
        }));
      }, 3500);

      const timer3 = setTimeout(() => {
        setProgress((prev) => ({
          ...prev,
          stage: 'translating',
          stageIndex: 4,
          percentage: 80,
          message: '[4/5] AI 방송 전문 한국어 번역 및 자막 다듬는 중...'
        }));
      }, 6000);

      const response = await fetch('/api/pipeline/process', {
        method: 'POST',
        body: formData
      });

      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || '파이프라인 처리에 실패했습니다.');
      }

      // Step 5: Completed
      setProgress({
        stage: 'completed',
        stageIndex: 5,
        totalStages: 5,
        percentage: 100,
        message: '🎉 모든 파이프라인 완료! 영상 자막이 생성되었습니다.'
      });

      if (data.logs) setPipelineLogs(data.logs);
      if (data.youtubeVideoId) {
        setYoutubeVideoId(data.youtubeVideoId);
      } else if (data.videoUrl && extractYoutubeId(data.videoUrl)) {
        setYoutubeVideoId(extractYoutubeId(data.videoUrl));
      }
      if (data.videoUrl) setVideoUrl(data.videoUrl);
      setSoftsubVideoUrl(data.softsubVideoUrl || '');
      if (data.videoTitle) setVideoTitle(data.videoTitle);
      if (data.segments && data.segments.length > 0) {
        setSegments(data.segments);
      }

      showToast(`성공: 총 ${data.segments?.length || 0}개의 자막 구간이 생성되었습니다!`);
    } catch (err: any) {
      console.error('Pipeline error:', err);
      setProgress({
        stage: 'error',
        stageIndex: 0,
        totalStages: 5,
        percentage: 0,
        message: '오류 발생',
        error: err.message
      });
      showToast(`오류: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Re-mux video with edited subtitles
  const handleRemuxVideo = async () => {
    setIsRemuxing(true);
    try {
      const res = await fetch('/api/subtitles/remux', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoPath: videoUrl,
          segments
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || '재합성에 실패했습니다.');
      }

      if (data.softsubVideoUrl) {
        setSoftsubVideoUrl(data.softsubVideoUrl);
      }
      showToast('FFmpeg 소프트자막이 영상에 즉시 재합성되었습니다!');
    } catch (err: any) {
      console.error('Remux error:', err);
      showToast(`재합성 실패: ${err.message}`);
    } finally {
      setIsRemuxing(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans selection:bg-red-500/20 selection:text-red-900">
      {/* Top Header */}
      <Header status={serverStatus} onOpenInfo={() => setIsInfoOpen(true)} />

      {/* Main Workspace */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 space-y-6">
        {/* Toast Alert */}
        {toastMessage && (
          <div className="fixed bottom-6 right-6 z-50 bg-white border border-slate-200 text-slate-900 px-4 py-3 rounded-xl shadow-xl flex items-center gap-2.5 text-xs font-medium animate-in fade-in slide-in-from-bottom-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>{toastMessage}</span>
          </div>
        )}

        {/* Input & Options Section */}
        <InputSection
          onStartPipeline={handleStartPipeline}
          isProcessing={isProcessing}
        />

        {/* Pipeline Stage Tracker */}
        {(isProcessing || progress.stageIndex > 0) && (
          <PipelineTracker progress={progress} logs={pipelineLogs} />
        )}

        {/* Video Player & Subtitle Editor Split View */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Video Player (5 cols on xl, 6 on lg) */}
          <div className="lg:col-span-6 xl:col-span-5 space-y-4 min-w-0">
            <VideoPlayer
              videoUrl={videoUrl}
              youtubeVideoId={youtubeVideoId}
              softsubVideoUrl={softsubVideoUrl}
              segments={segments}
              currentSegmentId={currentSegmentId}
              onTimeUpdate={handleTimeUpdate}
              onSelectSegment={(seg) => handleSeek(seg.start)}
              seekTime={seekTime}
              videoTitle={videoTitle}
            />
          </div>

          {/* Right Column: Interactive Subtitle & Script Editor (7 cols on xl, 6 on lg) */}
          <div className="lg:col-span-6 xl:col-span-7 min-w-0">
            <SubtitleEditor
              segments={segments}
              currentSegmentId={currentSegmentId}
              onUpdateSegments={setSegments}
              onSeek={handleSeek}
              onRemuxVideo={handleRemuxVideo}
              isRemuxing={isRemuxing}
            />
          </div>
        </div>
      </main>

      {/* Info Guide Modal */}
      <InfoModal isOpen={isInfoOpen} onClose={() => setIsInfoOpen(false)} />
    </div>
  );
}
