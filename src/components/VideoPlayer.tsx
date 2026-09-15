import React, { useRef, useEffect, useState } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  Maximize,
  Download,
  FileDown,
  Layers,
  Sparkles,
  Type,
  Eye,
  EyeOff,
  Tv
} from 'lucide-react';
import { SubtitleSegment } from '../types';
import { convertSegmentsToSrt, convertSegmentsToVtt, downloadTextFile, extractYoutubeId } from '../utils/srtParser';

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

interface VideoPlayerProps {
  videoUrl: string;
  youtubeVideoId?: string | null;
  softsubVideoUrl?: string;
  segments: SubtitleSegment[];
  currentSegmentId: number | null;
  onTimeUpdate: (currentTime: number) => void;
  onSelectSegment: (segment: SubtitleSegment) => void;
  seekTime: number | null;
  videoTitle?: string;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  videoUrl,
  youtubeVideoId,
  softsubVideoUrl,
  segments,
  currentSegmentId,
  onTimeUpdate,
  onSelectSegment,
  seekTime,
  videoTitle
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const ytPlayerRef = useRef<any>(null);

  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [volume, setVolume] = useState<number>(1);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [useSoftsubStream, setUseSoftsubStream] = useState<boolean>(true);
  const [subtitleMode, setSubtitleMode] = useState<'korean' | 'english' | 'dual' | 'off'>('korean');
  const [subtitleSize, setSubtitleSize] = useState<'sm' | 'md' | 'lg'>('md');
  const [activeSegment, setActiveSegment] = useState<SubtitleSegment | null>(null);

  // Active YouTube ID if playing a YouTube video
  const activeYoutubeId = youtubeVideoId || extractYoutubeId(videoUrl);

  // Initialize and sync YouTube Iframe Player
  useEffect(() => {
    if (!activeYoutubeId) {
      if (ytPlayerRef.current) {
        try {
          ytPlayerRef.current.destroy();
        } catch {}
        ytPlayerRef.current = null;
      }
      return;
    }

    let isMounted = true;

    const setupPlayer = () => {
      if (!isMounted) return;
      if (!window.YT || !window.YT.Player) {
        setTimeout(setupPlayer, 150);
        return;
      }

      const targetEl = document.getElementById('yt-iframe-player-target');
      if (!targetEl) {
        setTimeout(setupPlayer, 100);
        return;
      }

      // If player already exists for this video ID, cue or load it
      if (ytPlayerRef.current && typeof ytPlayerRef.current.cueVideoById === 'function') {
        try {
          ytPlayerRef.current.cueVideoById(activeYoutubeId);
          return;
        } catch {}
      }

      try {
        ytPlayerRef.current = new window.YT.Player('yt-iframe-player-target', {
          width: '100%',
          height: '100%',
          videoId: activeYoutubeId,
          playerVars: {
            autoplay: 0,
            controls: 1,
            rel: 0,
            modestbranding: 1,
            playsinline: 1,
            enablejsapi: 1,
            cc_load_policy: 0,
            iv_load_policy: 3,
            hl: 'ko',
            ...(typeof window !== 'undefined' && window.location?.origin && window.location.origin !== 'null'
              ? { origin: window.location.origin }
              : {})
          },
          events: {
            onReady: (event: any) => {
              if (!isMounted) return;
              try {
                // Prevent YouTube's default native captions from displaying
                if (typeof event.target.unloadModule === 'function') {
                  event.target.unloadModule('captions');
                }
                if (typeof event.target.setOption === 'function') {
                  event.target.setOption('captions', 'track', {});
                }
              } catch {}
              const dur = event.target.getDuration();
              if (dur && !isNaN(dur)) setDuration(dur);
            },
            onStateChange: (event: any) => {
              if (!isMounted) return;
              if (event.data === 1) { // PLAYING
                setIsPlaying(true);
              } else if (event.data === 2 || event.data === 0) { // PAUSED or ENDED
                setIsPlaying(false);
              }
            }
          }
        });
      } catch (err) {
        console.error('Failed to create YouTube player:', err);
      }
    };

    setupPlayer();

    return () => {
      isMounted = false;
      if (ytPlayerRef.current) {
        try {
          ytPlayerRef.current.destroy();
        } catch {}
        ytPlayerRef.current = null;
      }
    };
  }, [activeYoutubeId]);

  // Periodic ticker for YouTube time tracking
  useEffect(() => {
    if (!activeYoutubeId) return;
    const interval = setInterval(() => {
      if (ytPlayerRef.current && typeof ytPlayerRef.current.getCurrentTime === 'function') {
        try {
          const t = ytPlayerRef.current.getCurrentTime();
          if (typeof t === 'number' && !isNaN(t)) {
            setCurrentTime(t);
            onTimeUpdate(t);
          }
          const dur = ytPlayerRef.current.getDuration();
          if (typeof dur === 'number' && !isNaN(dur) && dur > 0 && dur !== duration) {
            setDuration(dur);
          }
        } catch {}
      }
    }, 200);

    return () => clearInterval(interval);
  }, [activeYoutubeId, duration, onTimeUpdate]);

  // Sync external seek command (e.g. clicking subtitle card in editor)
  useEffect(() => {
    if (seekTime !== null) {
      if (activeYoutubeId && ytPlayerRef.current && typeof ytPlayerRef.current.seekTo === 'function') {
        try {
          ytPlayerRef.current.seekTo(seekTime, true);
          ytPlayerRef.current.playVideo();
          setIsPlaying(true);
          setCurrentTime(seekTime);
        } catch {}
      } else if (videoRef.current) {
        videoRef.current.currentTime = seekTime;
        setCurrentTime(seekTime);
        if (videoRef.current.paused) {
          videoRef.current.play().catch(() => {});
          setIsPlaying(true);
        }
      }
    }
  }, [seekTime, activeYoutubeId]);

  // Determine active segment based on currentTime
  useEffect(() => {
    const current = segments.find(
      (seg) => currentTime >= seg.start && currentTime <= seg.end
    );
    setActiveSegment(current || null);
  }, [currentTime, segments]);

  const togglePlay = () => {
    if (activeYoutubeId && ytPlayerRef.current) {
      try {
        if (isPlaying) {
          ytPlayerRef.current.pauseVideo();
          setIsPlaying(false);
        } else {
          ytPlayerRef.current.playVideo();
          setIsPlaying(true);
        }
      } catch {}
      return;
    }

    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play();
      setIsPlaying(true);
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };

  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    const time = videoRef.current.currentTime;
    setCurrentTime(time);
    onTimeUpdate(time);
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const targetTime = parseFloat(e.target.value);
    setCurrentTime(targetTime);
    if (activeYoutubeId && ytPlayerRef.current && typeof ytPlayerRef.current.seekTo === 'function') {
      try {
        ytPlayerRef.current.seekTo(targetTime, true);
      } catch {}
    } else if (videoRef.current) {
      videoRef.current.currentTime = targetTime;
    }
  };

  const skipSeconds = (seconds: number) => {
    const nextTime = Math.max(0, Math.min(duration || 9999, currentTime + seconds));
    setCurrentTime(nextTime);
    if (activeYoutubeId && ytPlayerRef.current && typeof ytPlayerRef.current.seekTo === 'function') {
      try {
        ytPlayerRef.current.seekTo(nextTime, true);
      } catch {}
    } else if (videoRef.current) {
      videoRef.current.currentTime = nextTime;
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseFloat(e.target.value);
    setVolume(vol);
    setIsMuted(vol === 0);
    if (activeYoutubeId && ytPlayerRef.current && typeof ytPlayerRef.current.setVolume === 'function') {
      try {
        ytPlayerRef.current.setVolume(Math.round(vol * 100));
        if (vol === 0) ytPlayerRef.current.mute();
        else ytPlayerRef.current.unMute();
      } catch {}
    } else if (videoRef.current) {
      videoRef.current.volume = vol;
      videoRef.current.muted = vol === 0;
    }
  };

  const toggleMute = () => {
    const nextMute = !isMuted;
    setIsMuted(nextMute);
    if (activeYoutubeId && ytPlayerRef.current) {
      try {
        if (nextMute) ytPlayerRef.current.mute();
        else ytPlayerRef.current.unMute();
      } catch {}
    } else if (videoRef.current) {
      videoRef.current.muted = nextMute;
    }
  };

  const handleRateChange = (rate: number) => {
    setPlaybackRate(rate);
    if (activeYoutubeId && ytPlayerRef.current && typeof ytPlayerRef.current.setPlaybackRate === 'function') {
      try {
        ytPlayerRef.current.setPlaybackRate(rate);
      } catch {}
    } else if (videoRef.current) {
      videoRef.current.playbackRate = rate;
    }
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  // Format seconds into MM:SS
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const activeVideoSrc = useSoftsubStream && softsubVideoUrl ? softsubVideoUrl : videoUrl;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs flex flex-col">
      {/* Video Container */}
      <div
        ref={containerRef}
        className="relative bg-black aspect-video flex items-center justify-center overflow-hidden group select-none"
      >
        {activeYoutubeId ? (
          <div key={activeYoutubeId} className="w-full h-full relative">
            <div id="yt-iframe-player-target" className="w-full h-full" />
          </div>
        ) : (
          <video
            ref={videoRef}
            src={activeVideoSrc}
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onClick={togglePlay}
            className="w-full h-full object-contain cursor-pointer"
            playsInline
          />
        )}

        {/* Custom High-Legibility Subtitle Overlay */}
        {subtitleMode !== 'off' && activeSegment && (
          <div className="absolute bottom-16 left-0 right-0 px-6 pointer-events-none flex flex-col items-center justify-center text-center z-20 transition-all">
            <div className="bg-black/85 backdrop-blur-sm px-4 py-2 rounded-xl border border-white/10 shadow-2xl max-w-[90%] leading-relaxed">
              {/* Korean Translation */}
              {(subtitleMode === 'korean' || subtitleMode === 'dual') && (
                <p
                  className={`font-semibold text-amber-300 drop-shadow-md tracking-tight ${
                    subtitleSize === 'sm'
                      ? 'text-sm'
                      : subtitleSize === 'md'
                      ? 'text-base sm:text-lg'
                      : 'text-lg sm:text-xl font-bold'
                  }`}
                >
                  {activeSegment.translatedText ? (
                    activeSegment.translatedText
                  ) : (
                    <span className="text-amber-200/70 italic text-sm">(한국어 번역 준비 중)</span>
                  )}
                </p>
              )}

              {/* Original English */}
              {(subtitleMode === 'english' || subtitleMode === 'dual') && (
                <p
                  className={`text-slate-200 mt-0.5 tracking-normal opacity-90 ${
                    subtitleSize === 'sm' ? 'text-xs' : subtitleSize === 'md' ? 'text-xs sm:text-sm' : 'text-sm sm:text-base'
                  }`}
                >
                  {activeSegment.originalText}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Play/Pause Overlay Indicator on click (Non-YouTube only to avoid interfering with iframe) */}
        {!activeYoutubeId && (
          <div
            onClick={togglePlay}
            className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black/10 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <div className="w-14 h-14 rounded-full bg-black/60 backdrop-blur border border-white/20 flex items-center justify-center text-white shadow-xl">
              {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 translate-x-0.5" />}
            </div>
          </div>
        )}

        {/* Bottom Control Bar */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-3 pt-6 flex flex-col gap-2 opacity-95 group-hover:opacity-100 transition-opacity z-10">
          {/* Scrubber Progress Bar */}
          <div className="flex items-center gap-2">
            <input
              type="range"
              min="0"
              max={duration || 100}
              step="0.05"
              value={currentTime}
              onChange={handleSeek}
              className="w-full h-1.5 bg-slate-700/80 rounded-lg appearance-none cursor-pointer accent-red-500 hover:h-2 transition-all"
            />
          </div>

          {/* Controls Row */}
          <div className="flex items-center justify-between text-white text-xs">
            <div className="flex items-center gap-3">
              {/* Play/Pause Button */}
              <button
                onClick={togglePlay}
                className="p-1.5 hover:text-red-400 transition-colors"
                title={isPlaying ? '일시정지 (Space)' : '재생 (Space)'}
              >
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </button>

              {/* Rewind / Fast-forward */}
              <button
                onClick={() => skipSeconds(-5)}
                className="p-1 hover:text-slate-300"
                title="5초 뒤로"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => skipSeconds(5)}
                className="p-1 hover:text-slate-300"
                title="5초 앞으로"
              >
                <RotateCw className="w-3.5 h-3.5" />
              </button>

              {/* Timestamp */}
              <span className="font-mono text-[11px] text-slate-300">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>

              {/* Volume */}
              <div className="flex items-center gap-1.5 group/vol">
                <button onClick={toggleMute} className="p-1 hover:text-slate-300">
                  {isMuted || volume === 0 ? (
                    <VolumeX className="w-4 h-4 text-red-400" />
                  ) : (
                    <Volume2 className="w-4 h-4" />
                  )}
                </button>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                  className="w-14 h-1 bg-slate-700 rounded appearance-none cursor-pointer accent-red-500"
                />
              </div>
            </div>

            {/* Right Controls: Subtitle Options, Speed, Fullscreen */}
            <div className="flex items-center gap-1.5 flex-shrink-0 whitespace-nowrap">
              {/* Subtitle Mode Toggle - Compact Icon & Badge Group */}
              <div
                className="flex items-center bg-slate-900/90 border border-slate-700/80 rounded-lg p-0.5 text-[10px] flex-shrink-0 whitespace-nowrap select-none"
                role="group"
                aria-label="자막 모드 선택"
              >
                <button
                  type="button"
                  onClick={() => setSubtitleMode('korean')}
                  className={`px-1.5 py-0.5 rounded flex items-center justify-center font-bold tracking-tight transition-colors whitespace-nowrap ${
                    subtitleMode === 'korean'
                      ? 'bg-red-600 text-white shadow-xs'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                  }`}
                  title="한국어 자막만 (KO)"
                >
                  KO
                </button>
                <button
                  type="button"
                  onClick={() => setSubtitleMode('dual')}
                  className={`px-1.5 py-0.5 rounded flex items-center gap-0.5 font-bold tracking-tight transition-colors whitespace-nowrap ${
                    subtitleMode === 'dual'
                      ? 'bg-amber-600 text-white shadow-xs'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                  }`}
                  title="한/영 동시 자막 (KO+EN)"
                >
                  <Layers className="w-3 h-3" />
                  <span>KO·EN</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSubtitleMode('english')}
                  className={`px-1.5 py-0.5 rounded flex items-center justify-center font-bold tracking-tight transition-colors whitespace-nowrap ${
                    subtitleMode === 'english'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                  }`}
                  title="영어 원문만 (EN)"
                >
                  EN
                </button>
                <button
                  type="button"
                  onClick={() => setSubtitleMode('off')}
                  className={`px-1.5 py-0.5 rounded flex items-center gap-0.5 font-bold tracking-tight transition-colors whitespace-nowrap ${
                    subtitleMode === 'off'
                      ? 'bg-slate-700 text-white shadow-xs'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                  }`}
                  title="자막 끄기 (OFF)"
                >
                  <EyeOff className="w-3 h-3" />
                  <span>OFF</span>
                </button>
              </div>

              {/* Subtitle font size selector */}
              <button
                onClick={() => {
                  if (subtitleSize === 'sm') setSubtitleSize('md');
                  else if (subtitleSize === 'md') setSubtitleSize('lg');
                  else setSubtitleSize('sm');
                }}
                className="p-1 hover:text-amber-400 transition-colors flex-shrink-0"
                title={`자막 크기: ${subtitleSize.toUpperCase()}`}
              >
                <Type className="w-3.5 h-3.5" />
              </button>

              {/* Playback Speed */}
              <div className="flex items-center gap-0.5 flex-shrink-0">
                {[1, 1.25, 1.5].map((rate) => (
                  <button
                    key={rate}
                    onClick={() => handleRateChange(rate)}
                    className={`px-1 py-0.5 rounded text-[10px] font-mono whitespace-nowrap ${
                      playbackRate === rate
                        ? 'bg-slate-700 text-amber-300 font-bold'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {rate}x
                  </button>
                ))}
              </div>

              {/* Fullscreen */}
              <button
                onClick={toggleFullscreen}
                className="p-1 hover:text-white transition-colors flex-shrink-0"
                title="전체화면"
              >
                <Maximize className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Video Bar Info & Quick Actions */}
      <div className="p-3.5 bg-white border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div>
          <div className="flex items-center gap-2">
            <h4 className="font-semibold text-slate-900 text-sm truncate max-w-xs sm:max-w-md">
              {videoTitle || '자막 영상'}
            </h4>
            {activeYoutubeId && (
              <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-bold tracking-tight inline-flex items-center gap-1">
                <Tv className="w-3 h-3" />
                YouTube 원본
              </span>
            )}
          </div>
          <p className="text-slate-500 text-[11px] mt-0.5">
            {activeYoutubeId ? `영상 ID: ${activeYoutubeId} · ` : ''}총 {segments.length}개 자막 구간
          </p>
        </div>

        {/* Download Buttons */}
        <div className="flex flex-wrap items-center gap-1.5">
          {softsubVideoUrl && (
            <a
              href={softsubVideoUrl}
              download="output_softsub.mp4"
              className="px-2.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium flex items-center gap-1.5 shadow-xs transition-all text-xs"
            >
              <Download className="w-3.5 h-3.5" />
              <span>MP4 다운로드</span>
            </a>
          )}

          <button
            onClick={() => {
              const srt = convertSegmentsToSrt(segments, 'translated');
              downloadTextFile('korean_subtitles.srt', srt);
            }}
            className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 font-medium border border-slate-200 flex items-center gap-1.5 transition-colors text-xs"
          >
            <FileDown className="w-3.5 h-3.5 text-amber-600" />
            <span>한국어 SRT</span>
          </button>

          <button
            onClick={() => {
              const srt = convertSegmentsToSrt(segments, 'original');
              downloadTextFile('original_english.srt', srt);
            }}
            className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium border border-slate-200 flex items-center gap-1.5 transition-colors text-xs"
          >
            <FileDown className="w-3.5 h-3.5 text-blue-600" />
            <span>영어 SRT</span>
          </button>

          <button
            onClick={() => {
              const vtt = convertSegmentsToVtt(segments, 'translated');
              downloadTextFile('subtitles.vtt', vtt);
            }}
            className="px-2 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium border border-slate-200 flex items-center gap-1.5 transition-colors text-xs"
          >
            <FileDown className="w-3.5 h-3.5 text-emerald-600" />
            <span>VTT</span>
          </button>
        </div>
      </div>
    </div>
  );
};

