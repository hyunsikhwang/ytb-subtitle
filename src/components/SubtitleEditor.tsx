import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Search,
  Replace,
  Plus,
  Trash2,
  Play,
  Sparkles,
  RefreshCw,
  Clock,
  Split,
  FileCheck2,
  Check,
  AlertCircle,
  Film
} from 'lucide-react';
import { SubtitleSegment } from '../types';
import { formatTimestamp, parseTimestamp } from '../utils/srtParser';

interface SubtitleEditorProps {
  segments: SubtitleSegment[];
  currentSegmentId: number | null;
  onUpdateSegments: (newSegments: SubtitleSegment[]) => void;
  onSeek: (seconds: number) => void;
  onRemuxVideo: () => void;
  isRemuxing: boolean;
}

export const SubtitleEditor: React.FC<SubtitleEditorProps> = ({
  segments,
  currentSegmentId,
  onUpdateSegments,
  onSeek,
  onRemuxVideo,
  isRemuxing
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [findWord, setFindWord] = useState('');
  const [replaceWord, setReplaceWord] = useState('');
  const [translatingId, setTranslatingId] = useState<number | null>(null);
  const [isCleaningAll, setIsCleaningAll] = useState(false);
  const [isFillingBlanks, setIsFillingBlanks] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);

  const blankCount = useMemo(() => {
    return segments.filter((s) => !s.translatedText || !/[가-힣]/.test(s.translatedText)).length;
  }, [segments]);

  const activeCardRef = useRef<HTMLDivElement>(null);
  const listContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to active segment while video is playing
  useEffect(() => {
    if (autoScroll && activeCardRef.current && listContainerRef.current) {
      activeCardRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
      });
    }
  }, [currentSegmentId, autoScroll]);

  // Update a single segment field
  const handleFieldChange = (id: number, field: keyof SubtitleSegment, value: any) => {
    const updated = segments.map((seg) => {
      if (seg.id === id) {
        const next = { ...seg, [field]: value };
        if (field === 'start') {
          next.startTime = formatTimestamp(value);
        } else if (field === 'end') {
          next.endTime = formatTimestamp(value);
        }
        return next;
      }
      return seg;
    });
    onUpdateSegments(updated);
  };

  // Adjust timing with step
  const handleAdjustTime = (id: number, type: 'start' | 'end', delta: number) => {
    const updated = segments.map((seg) => {
      if (seg.id === id) {
        if (type === 'start') {
          const newStart = Math.max(0, parseFloat((seg.start + delta).toFixed(3)));
          return {
            ...seg,
            start: newStart,
            startTime: formatTimestamp(newStart)
          };
        } else {
          const newEnd = Math.max(seg.start + 0.1, parseFloat((seg.end + delta).toFixed(3)));
          return {
            ...seg,
            end: newEnd,
            endTime: formatTimestamp(newEnd)
          };
        }
      }
      return seg;
    });
    onUpdateSegments(updated);
  };

  // AI Re-translate single segment
  const handleTranslateSingle = async (seg: SubtitleSegment) => {
    setTranslatingId(seg.id);
    try {
      const res = await fetch('/api/subtitles/translate-single', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalText: seg.originalText,
          model: 'openai/gpt-oss-20b'
        })
      });
      const data = await res.json();
      if (data.translatedText) {
        handleFieldChange(seg.id, 'translatedText', data.translatedText);
      }
    } catch (err) {
      console.error('Failed to translate single line:', err);
    } finally {
      setTranslatingId(null);
    }
  };

  // AI Clean & re-translate all segments with gpt-oss-20b
  const handleCleanAll = async () => {
    if (isCleaningAll || segments.length === 0) return;
    setIsCleaningAll(true);
    try {
      const res = await fetch('/api/subtitles/clean-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          segments,
          model: 'openai/gpt-oss-20b'
        })
      });
      const data = await res.json();
      if (data.success && data.segments) {
        onUpdateSegments(data.segments);
      }
    } catch (err) {
      console.error('Failed to clean all subtitles:', err);
    } finally {
      setIsCleaningAll(false);
    }
  };

  // Fill only blank/untranslated segments
  const handleFillBlanks = async () => {
    if (isFillingBlanks || blankCount === 0) return;
    setIsFillingBlanks(true);
    try {
      const res = await fetch('/api/subtitles/fill-blanks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          segments,
          model: 'openai/gpt-oss-20b'
        })
      });
      const data = await res.json();
      if (data.success && data.segments) {
        onUpdateSegments(data.segments);
      }
    } catch (err) {
      console.error('Failed to fill blank subtitles:', err);
    } finally {
      setIsFillingBlanks(false);
    }
  };

  // Add new segment after an existing one
  const handleAddSegment = (afterId?: number) => {
    let insertIndex = segments.length;
    let newStart = 0;
    let newEnd = 3;

    if (afterId !== undefined) {
      const idx = segments.findIndex((s) => s.id === afterId);
      if (idx !== -1) {
        insertIndex = idx + 1;
        newStart = segments[idx].end + 0.2;
        newEnd = newStart + 3.0;
      }
    } else if (segments.length > 0) {
      newStart = segments[segments.length - 1].end + 0.2;
      newEnd = newStart + 3.0;
    }

    const newSeg: SubtitleSegment = {
      id: Date.now(),
      start: newStart,
      end: newEnd,
      startTime: formatTimestamp(newStart),
      endTime: formatTimestamp(newEnd),
      originalText: 'New subtitle dialogue',
      translatedText: '새로운 한국어 자막'
    };

    const newSegments = [...segments];
    newSegments.splice(insertIndex, 0, newSeg);
    // Re-index
    const reindexed = newSegments.map((s, idx) => ({ ...s, id: idx + 1 }));
    onUpdateSegments(reindexed);
  };

  // Delete segment
  const handleDeleteSegment = (id: number) => {
    const filtered = segments.filter((s) => s.id !== id);
    const reindexed = filtered.map((s, idx) => ({ ...s, id: idx + 1 }));
    onUpdateSegments(reindexed);
  };

  // Split segment
  const handleSplitSegment = (seg: SubtitleSegment) => {
    const midTime = parseFloat(((seg.start + seg.end) / 2).toFixed(3));
    const words = seg.originalText.split(' ');
    const half = Math.ceil(words.length / 2);
    const orig1 = words.slice(0, half).join(' ');
    const orig2 = words.slice(half).join(' ');

    const transWords = seg.translatedText.split(' ');
    const transHalf = Math.ceil(transWords.length / 2);
    const trans1 = transWords.slice(0, transHalf).join(' ');
    const trans2 = transWords.slice(transHalf).join(' ');

    const seg1: SubtitleSegment = {
      ...seg,
      end: midTime,
      endTime: formatTimestamp(midTime),
      originalText: orig1,
      translatedText: trans1
    };

    const seg2: SubtitleSegment = {
      id: Date.now(),
      start: midTime,
      end: seg.end,
      startTime: formatTimestamp(midTime),
      endTime: seg.endTime,
      originalText: orig2 || '...',
      translatedText: trans2 || '...'
    };

    const idx = segments.findIndex((s) => s.id === seg.id);
    const newSegments = [...segments];
    newSegments.splice(idx, 1, seg1, seg2);
    const reindexed = newSegments.map((s, i) => ({ ...s, id: i + 1 }));
    onUpdateSegments(reindexed);
  };

  // Batch Replace
  const handleBatchReplace = () => {
    if (!findWord.trim()) return;
    const regex = new RegExp(findWord, 'gi');
    const updated = segments.map((seg) => ({
      ...seg,
      translatedText: seg.translatedText.replace(regex, replaceWord),
      originalText: seg.originalText.replace(regex, replaceWord)
    }));
    onUpdateSegments(updated);
    setShowFindReplace(false);
  };

  const filteredSegments = segments.filter((s) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      s.translatedText.toLowerCase().includes(q) ||
      s.originalText.toLowerCase().includes(q) ||
      s.startTime.includes(q)
    );
  });

  return (
    <div className="bg-white border border-slate-200 rounded-2xl flex flex-col h-full shadow-xs overflow-hidden">
      {/* Top Header */}
      <div className="p-3.5 border-b border-slate-200 bg-white flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-amber-100 text-amber-600 flex items-center justify-center">
            <FileCheck2 className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              자막 편집
              <span className="text-xs font-normal text-slate-500">({segments.length}개)</span>
              {blankCount > 0 ? (
                <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-rose-50 text-rose-600 border border-rose-200">
                  미번역 {blankCount}
                </span>
              ) : (
                <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 border border-emerald-200">
                  완역
                </span>
              )}
            </h3>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-1.5">
          {/* Fill Blanks Button (shown when any segments are missing Korean) */}
          {blankCount > 0 && (
            <button
              onClick={handleFillBlanks}
              disabled={isFillingBlanks}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                isFillingBlanks
                  ? 'bg-rose-100 text-rose-500 cursor-not-allowed'
                  : 'bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-300 shadow-xs active:scale-95 animate-pulse'
              }`}
              title="비어 있거나 한국어가 없는 구간만 AI로 즉시 번역하여 채웁니다"
            >
              <Sparkles className={`w-3.5 h-3.5 ${isFillingBlanks ? 'animate-spin text-rose-600' : 'text-rose-600'}`} />
              <span>{isFillingBlanks ? '채우는 중...' : `빈칸 자막 채우기 (${blankCount})`}</span>
            </button>
          )}

          {/* Batch AI Clean with gpt-oss-20b */}
          <button
            onClick={handleCleanAll}
            disabled={isCleaningAll || segments.length === 0}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all ${
              isCleaningAll
                ? 'bg-amber-100 text-amber-500 cursor-not-allowed'
                : 'bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 shadow-xs active:scale-95'
            }`}
            title="GPT-OSS로 전체 자막을 매끄러운 방송용 한국어로 재번역 및 클렌징"
          >
            <Sparkles className={`w-3.5 h-3.5 ${isCleaningAll ? 'animate-spin text-amber-600' : 'text-amber-600'}`} />
            <span>{isCleaningAll ? '클렌징 중...' : '전체 AI 재번역'}</span>
          </button>

          {/* Re-mux button */}
          <button
            onClick={onRemuxVideo}
            disabled={isRemuxing}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
              isRemuxing
                ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs active:scale-95'
            }`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRemuxing ? 'animate-spin' : ''}`} />
            <span>{isRemuxing ? '합성 중...' : '영상 재합성'}</span>
          </button>

          <button
            onClick={() => handleAddSegment()}
            className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 text-xs font-medium flex items-center gap-1 transition-colors"
          >
            <Plus className="w-3.5 h-3.5 text-amber-600" />
            <span>구간 추가</span>
          </button>
        </div>
      </div>

      {/* Search & Tool Bar */}
      <div className="px-3.5 py-2 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="자막 검색..."
            className="w-full bg-white border border-slate-300 rounded-lg pl-7 pr-3 py-1 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 font-sans"
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFindReplace(!showFindReplace)}
            className={`px-2 py-1 rounded-lg border text-xs flex items-center gap-1 transition-colors font-medium ${
              showFindReplace
                ? 'bg-amber-100 border-amber-300 text-amber-800'
                : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'
            }`}
          >
            <Replace className="w-3 h-3" />
            <span>바꾸기</span>
          </button>

          <label className="flex items-center gap-1 text-slate-600 cursor-pointer select-none font-medium">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="rounded bg-white border-slate-300 text-amber-600 focus:ring-0 w-3 h-3"
            />
            <span>자동 스크롤</span>
          </label>
        </div>
      </div>

      {/* Batch Find & Replace Bar */}
      {showFindReplace && (
        <div className="p-2.5 bg-amber-50/50 border-b border-amber-200 flex flex-wrap items-center gap-2 text-xs">
          <input
            type="text"
            value={findWord}
            onChange={(e) => setFindWord(e.target.value)}
            placeholder="찾을 단어"
            className="bg-white border border-slate-300 rounded-lg px-2.5 py-1 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
          />
          <input
            type="text"
            value={replaceWord}
            onChange={(e) => setReplaceWord(e.target.value)}
            placeholder="바꿀 단어"
            className="bg-white border border-slate-300 rounded-lg px-2.5 py-1 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
          />
          <button
            onClick={handleBatchReplace}
            className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-medium shadow-xs"
          >
            변경
          </button>
        </div>
      )}

      {/* Subtitles Scrollable List */}
      <div
        ref={listContainerRef}
        className="flex-1 overflow-y-auto p-3 space-y-2.5 divide-y divide-slate-200 bg-slate-50/30"
        style={{ maxHeight: 'calc(100vh - 420px)', minHeight: '380px' }}
      >
        {filteredSegments.length === 0 ? (
          <div className="text-center py-12 text-slate-400 text-xs">
            검색 결과가 없습니다.
          </div>
        ) : (
          filteredSegments.map((seg) => {
            const isActive = currentSegmentId === seg.id;
            return (
              <div
                key={seg.id}
                ref={isActive ? activeCardRef : null}
                className={`pt-2.5 first:pt-0 rounded-xl transition-all duration-200 ${
                  isActive
                    ? 'p-3 bg-amber-50/80 border border-amber-300 shadow-xs'
                    : 'p-2.5 bg-white hover:bg-slate-50 border border-slate-200/80'
                }`}
              >
                {/* Segment Header */}
                <div className="flex items-center justify-between mb-2 text-xs">
                  <div className="flex items-center gap-2">
                    {/* Jump/Play button */}
                    <button
                      onClick={() => onSeek(seg.start)}
                      className={`w-6 h-6 rounded-md flex items-center justify-center transition-colors ${
                        isActive
                          ? 'bg-amber-600 text-white font-bold shadow-xs'
                          : 'bg-slate-100 text-slate-600 hover:bg-red-600 hover:text-white'
                      }`}
                      title="이 구간 영상 재생"
                    >
                      <Play className="w-3 h-3 fill-current translate-x-0.5" />
                    </button>

                    <span className="font-mono font-bold text-slate-500 text-[11px]">
                      #{seg.id}
                    </span>

                    {/* Time editors with fine-tuning */}
                    <div className="flex items-center gap-1 font-mono text-[11px] bg-slate-50 px-2 py-0.5 rounded-lg border border-slate-200">
                      <Clock className="w-3 h-3 text-slate-400" />
                      <input
                        type="text"
                        value={seg.startTime}
                        onChange={(e) => {
                          const val = e.target.value;
                          handleFieldChange(seg.id, 'startTime', val);
                          handleFieldChange(seg.id, 'start', parseTimestamp(val));
                        }}
                        className="w-20 bg-transparent text-slate-800 focus:outline-none text-center font-medium"
                      />
                      <span className="text-slate-400">→</span>
                      <input
                        type="text"
                        value={seg.endTime}
                        onChange={(e) => {
                          const val = e.target.value;
                          handleFieldChange(seg.id, 'endTime', val);
                          handleFieldChange(seg.id, 'end', parseTimestamp(val));
                        }}
                        className="w-20 bg-transparent text-slate-800 focus:outline-none text-center font-medium"
                      />
                    </div>

                    {/* Time +/- 0.1s adjusters */}
                    <div className="hidden sm:flex items-center gap-0.5 text-[10px]">
                      <button
                        onClick={() => handleAdjustTime(seg.id, 'start', -0.1)}
                        className="px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200 font-mono"
                        title="시작 0.1초 앞당기기"
                      >
                        -0.1s
                      </button>
                      <button
                        onClick={() => handleAdjustTime(seg.id, 'end', 0.1)}
                        className="px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200 font-mono"
                        title="끝 0.1초 연장"
                      >
                        +0.1s
                      </button>
                    </div>
                  </div>

                  {/* Actions: AI Translate, Split, Add, Delete */}
                  <div className="flex items-center gap-1 text-[11px]">
                    <button
                      onClick={() => handleTranslateSingle(seg)}
                      disabled={translatingId === seg.id}
                      className="px-2 py-1 rounded bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 flex items-center gap-1 transition-colors font-medium"
                      title="AI로 이 구간 다시 번역"
                    >
                      <Sparkles className={`w-3 h-3 ${translatingId === seg.id ? 'animate-spin' : ''}`} />
                      <span className="hidden sm:inline">AI 번역</span>
                    </button>

                    <button
                      onClick={() => handleSplitSegment(seg)}
                      className="p-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-900 border border-slate-200"
                      title="구간 둘로 분할"
                    >
                      <Split className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={() => handleAddSegment(seg.id)}
                      className="p-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-900 border border-slate-200"
                      title="뒤에 새 구간 삽입"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={() => handleDeleteSegment(seg.id)}
                      className="p-1 rounded bg-slate-100 hover:bg-red-50 text-slate-500 hover:text-red-600 border border-slate-200 transition-colors"
                      title="구간 삭제"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Korean Translated Subtitle Textarea */}
                <div className="space-y-1.5">
                  <div>
                    <label className="text-[10px] uppercase font-bold tracking-wider text-amber-700 mb-0.5 block">
                      한국어 번역
                    </label>
                    <textarea
                      value={seg.translatedText}
                      onChange={(e) => handleFieldChange(seg.id, 'translatedText', e.target.value)}
                      rows={2}
                      className="w-full bg-amber-50/40 border border-amber-200 rounded-lg p-2 text-sm text-slate-900 font-medium leading-relaxed focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
                    />
                  </div>

                  {/* Original English Text */}
                  <div>
                    <label className="text-[10px] uppercase font-bold tracking-wider text-slate-500 mb-0.5 block">
                      원문 스크립트
                    </label>
                    <textarea
                      value={seg.originalText}
                      onChange={(e) => handleFieldChange(seg.id, 'originalText', e.target.value)}
                      rows={1}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg p-1.5 text-xs text-slate-600 font-normal leading-relaxed focus:outline-none focus:ring-2 focus:ring-slate-400/30 focus:border-slate-400"
                    />
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
