import { SubtitleSegment } from '../types';

/**
 * Convert seconds float to SRT timestamp string "HH:MM:SS,mmm"
 */
export function formatTimestamp(seconds: number): string {
  const safeSec = Math.max(0, isNaN(seconds) ? 0 : seconds);
  const millis = Math.floor((safeSec % 1) * 1000);
  const totalSecs = Math.floor(safeSec);
  const hours = Math.floor(totalSecs / 3600);
  const minutes = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;

  const pad = (n: number, z = 2) => String(n).padStart(z, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)},${pad(millis, 3)}`;
}

/**
 * Convert seconds float to WebVTT timestamp string "HH:MM:SS.mmm"
 */
export function formatVttTimestamp(seconds: number): string {
  return formatTimestamp(seconds).replace(',', '.');
}

/**
 * Parse timestamp string "HH:MM:SS,mmm" or "MM:SS.mmm" into seconds
 */
export function parseTimestamp(ts: string): number {
  if (!ts) return 0;
  const cleaned = ts.trim().replace(',', '.');
  const parts = cleaned.split(':');
  if (parts.length === 3) {
    const hours = parseFloat(parts[0]) || 0;
    const minutes = parseFloat(parts[1]) || 0;
    const seconds = parseFloat(parts[2]) || 0;
    return hours * 3600 + minutes * 60 + seconds;
  } else if (parts.length === 2) {
    const minutes = parseFloat(parts[0]) || 0;
    const seconds = parseFloat(parts[1]) || 0;
    return minutes * 60 + seconds;
  }
  return parseFloat(cleaned) || 0;
}

/**
 * Convert list of subtitle segments to valid SRT string
 */
export function convertSegmentsToSrt(
  segments: SubtitleSegment[],
  mode: 'translated' | 'original' | 'both' = 'translated'
): string {
  const srtLines: string[] = [];

  segments.forEach((seg, idx) => {
    const cueId = (seg.id !== undefined && seg.id !== null) ? seg.id : (idx + 1);
    srtLines.push(String(cueId));
    const startStr = seg.startTime || formatTimestamp(seg.start);
    const endStr = seg.endTime || formatTimestamp(seg.end);
    srtLines.push(`${startStr} --> ${endStr}`);

    let text = '';
    if (mode === 'translated') {
      text = seg.translatedText || '';
    } else if (mode === 'original') {
      text = seg.originalText || '';
    } else {
      // dual
      const trans = (seg.translatedText || '').trim();
      const orig = (seg.originalText || '').trim();
      if (trans && orig && trans !== orig) {
        text = `${trans}\n${orig}`;
      } else {
        text = trans || orig;
      }
    }

    srtLines.push(text.trim());
    srtLines.push('');
  });

  return srtLines.join('\n');
}

/**
 * Convert list of subtitle segments to valid WebVTT string
 */
export function convertSegmentsToVtt(
  segments: SubtitleSegment[],
  mode: 'translated' | 'original' | 'both' = 'translated'
): string {
  const vttLines: string[] = ['WEBVTT', ''];

  segments.forEach((seg, idx) => {
    const cueId = (seg.id !== undefined && seg.id !== null) ? seg.id : (idx + 1);
    vttLines.push(String(cueId));
    const startStr = formatVttTimestamp(seg.start);
    const endStr = formatVttTimestamp(seg.end);
    vttLines.push(`${startStr} --> ${endStr}`);

    let text = '';
    if (mode === 'translated') {
      text = seg.translatedText || '';
    } else if (mode === 'original') {
      text = seg.originalText || '';
    } else {
      const trans = (seg.translatedText || '').trim();
      const orig = (seg.originalText || '').trim();
      if (trans && orig && trans !== orig) {
        text = `${trans}\n${orig}`;
      } else {
        text = trans || orig;
      }
    }

    vttLines.push(text.trim());
    vttLines.push('');
  });

  return vttLines.join('\n');
}

/**
 * Parse an SRT text block into SubtitleSegment objects
 */
export function parseSrt(srtContent: string): SubtitleSegment[] {
  if (!srtContent) return [];
  const normalized = srtContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalized.split(/\n\n+/).map(b => b.trim()).filter(Boolean);

  const segments: SubtitleSegment[] = [];

  blocks.forEach((block, index) => {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return;

    let timeLineIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('-->')) {
        timeLineIdx = i;
        break;
      }
    }

    if (timeLineIdx === -1) return;

    const timeLine = lines[timeLineIdx];
    const [startRaw, endRaw] = timeLine.split('-->').map(s => s.trim());
    const start = parseTimestamp(startRaw);
    const end = parseTimestamp(endRaw);

    const textLines = lines.slice(timeLineIdx + 1);
    const text = textLines.join('\n');
    const hasHangul = /[가-힣]/.test(text);

    segments.push({
      id: index + 1,
      start,
      end,
      startTime: formatTimestamp(start),
      endTime: formatTimestamp(end),
      originalText: text,
      translatedText: hasHangul ? text : '',
    });
  });

  return segments;
}

/**
 * Remove markdown codeblocks (```srt ... ```) from LLM output
 */
export function cleanMarkdownFences(text: string): string {
  if (!text) return '';
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:srt)?\s*/i, '');
  cleaned = cleaned.replace(/\s*```$/i, '');
  return cleaned.trim();
}

/**
 * Trigger browser file download
 */
export function downloadTextFile(filename: string, content: string, mimeType = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Extract YouTube video ID from various URL formats
 */
export function extractYoutubeId(url: string | null | undefined): string | null {
  if (!url) return null;
  const str = url.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(str)) {
    return str;
  }
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=|shorts\/)([^#&?]*).*/;
  const match = str.match(regExp);
  return match && match[2].length === 11 ? match[2] : null;
}
