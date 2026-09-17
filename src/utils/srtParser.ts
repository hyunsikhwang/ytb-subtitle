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
 * Decode HTML entities like &gt;, &lt;, &amp;, &quot;, &#39;, etc.
 */
export function decodeHtmlEntities(str: string): string {
  if (!str) return '';
  let res = str;
  // Multiple passes in case of double-escaped entities like &amp;gt;
  for (let i = 0; i < 2; i++) {
    res = res
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;|&#039;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  }
  return res;
}

/**
 * Korean phonetic & liaison misspelling normalization rules.
 * Corrects errors where STT / ASR transcribes phonetically (sound-as-written)
 * instead of standard Korean orthography (e.g., '조름운전' -> '졸음운전', '구지' -> '굳이', '할 쑤' -> '할 수').
 */
const PHONETIC_CORRECTIONS: Array<[RegExp, string]> = [
  // 1. 연음 법칙 (Liaison) 소리 나는 대로 표기된 오류
  [/\b조름운전(자)?\b/g, '졸음운전$1'],
  [/\b조름\b/g, '졸음'],
  [/\b거름마\b/g, '걸음마'],
  [/\b어름물\b/g, '얼음물'],
  [/\b어름\b/g, '얼음'],
  [/\b우스미\b/g, '웃음이'],
  [/\b우슴\b/g, '웃음'],
  [/\b미드미\b/g, '믿음이'],
  [/\b무르플\b/g, '무릎을'],
  [/\b무르피\b/g, '무릎이'],
  [/\b무릅을\b/g, '무릎을'],
  [/\b무릅이\b/g, '무릎이'],
  [/\b머기를\b/g, '먹이를'],
  [/\b머기\b/g, '먹이'],
  [/\b기피를\b/g, '깊이를'],
  [/\b기피가\b/g, '깊이가'],
  [/\b손톱까끼\b/g, '손톱깎이'],
  [/\b손톱깍이\b/g, '손톱깎이'],
  [/\b바까테\b/g, '바깥에'],
  [/\b바까트로\b/g, '바깥으로'],
  [/\b까까지른\b/g, '깎아지른'],
  [/\b오슬\b/g, '옷을'],
  [/\b마으미\b/g, '마음이'],
  [/\b바믈\b/g, '밤을'],
  [/\b나제\b/g, '낮에'],
  [/\b무러보다\b/g, '물어보다'],
  [/\b무러보/g, '물어보'],
  [/\b자바먹/g, '잡아먹'],
  [/\b마즌편\b/g, '맞은편'],
  [/\b절므니\b/g, '젊은이'],
  [/\b놀라우미\b/g, '놀라움이'],
  [/\b다름질\b/g, '달음질'],

  // 2. 구개음화 및 받침 표기 오류
  [/\b구지\b/g, '굳이'],
  [/\b해도지\b/g, '해돋이'],
  [/\b미다지\b/g, '미닫이'],
  [/\b가치\s+(가요|가자|가|있|보|들|하|걸어)/g, '같이 $1'],

  // 3. 거센소리되기 (격음화) 소리 나는 대로 표기된 오류
  [/\b추카(해|합|드|함|한)/g, '축하$1'],
  [/\b추카\b/g, '축하'],
  [/\b이팍식\b/g, '입학식'],
  [/\b노코\b/g, '놓고'],
  [/\b조타\b/g, '좋다'],
  [/\b조은\b/g, '좋은'],
  [/\b조아(서|요|해|진)/g, '좋아$1'],
  [/\b어떠케\b/g, '어떻게'],
  [/\b어떻해\b/g, '어떡해'],
  [/\b그래때요\b/g, '그랬대요'],

  // 4. 된소리되기 (경음화) 소리 나는 대로 표기된 오류
  [/\b할\s*쑤\b/g, '할 수'],
  [/\b갈\s*꼿\b/g, '갈 곳'],
  [/\b볼\s*쑤\b/g, '볼 수'],
  [/\b올\s*쑤\b/g, '올 수'],
  [/\b알\s*쑤\b/g, '알 수'],
  [/\b있\s*쑤\b/g, '있 수'],
  [/\b신꼬\b/g, '신고'],
  [/\b국쑤\b/g, '국수'],
  [/\b등뿔\b/g, '등불'],
  [/\b문꼬리\b/g, '문고리'],
  [/\b효꽈\b/g, '효과'],
  [/\b사껀\b/g, '사건'],
  [/\b조껀\b/g, '조건'],

  // 5. 비음화 / 유음화 / 자음동화 소리 나는 대로 표기된 오류
  [/\b궁민(여러분|연금|투표|소득|기본권|주권|건강)?\b/g, '국민$1'],
  [/\b동닙\b/g, '독립'],
  [/\b실라\s*(시대|왕국|삼국|경주)?\b/g, '신라 $1'],
  [/\b칼랄\b/g, '칼날'],
  [/\b심니\b/g, '십리'],
  [/\b암녁\b/g, '압력'],

  // 6. 기타 STT 빈출 맞춤법 및 문맥 혼동 어휘
  [/\b문제가\s+붉어졌/g, '문제가 불거졌'],
  [/\b문제들이\s+붉어졌/g, '문제들이 불거졌'],
  [/\b가성비가\s+쫓/g, '가성비가 좋'],
  [/\b인공지는\b/g, '인공지능'],
  [/\b새로운\s+기름이\s+출시/g, '새로운 기능이 출시'],
  [/\b간사합니다\b/g, '감사합니다'],
  [/\b안\s*되요\b/g, '안 돼요'],
  [/\b뵈요\b/g, '봬요'],
  [/\b몇일\b/g, '며칠'],
  [/\b금액\s+결재\b/g, '금액 결제'],
  [/\b카드\s+결재\b/g, '카드 결제'],
  [/\b어줍잖/g, '어쭙잖'],
  [/\b널부러/g, '널브러'],
  [/\b희안하/g, '희한하'],
  [/\b오뚜기\b/g, '오뚝이']
];

export function correctPhoneticKoreanSpelling(text: string): string {
  if (!text || !/[가-힣]/.test(text)) return text;
  let corrected = text;
  for (const [pattern, replacement] of PHONETIC_CORRECTIONS) {
    corrected = corrected.replace(pattern, replacement);
  }
  return corrected;
}

/**
 * Clean subtitle text by removing HTML entities, formatting tags, speaker turn markers (>>, >),
 * acoustic bracket tags ([Music], [Applause], etc.), and normalizing phonetic misspellings.
 */
export function cleanSubtitleText(text: string): string {
  if (!text) return '';
  let cleaned = decodeHtmlEntities(text);

  // Remove HTML / WebVTT formatting tags e.g. <c>, </c>, <v Speaker>, <b>, </i>, <font>, etc.
  cleaned = cleaned.replace(/<[^>]+>/g, ' ');

  // Remove speaker change markers and stray arrows commonly inserted by YouTube ASR
  cleaned = cleaned.replace(/^\s*(?:>>+|>|&gt;&gt;|&gt;)\s*/g, '');
  cleaned = cleaned.replace(/\s*(?:>>+|>|&gt;&gt;|&gt;)\s*/g, ' ');

  // Any remaining stray &gt; or &lt; or &amp;
  cleaned = cleaned.replace(/&gt;?/gi, '').replace(/&lt;?/gi, '').replace(/&amp;/gi, '&');

  // Remove acoustic event brackets like [Music], [Applause], [음악], [박수], (Laughter), etc.
  cleaned = cleaned.replace(/\[\s*(?:Music|Applause|Laughter|Cheering|Sigh|Gasp|음악|박수|환호|웃음|기침|효과음|소음)\s*\]/gi, '');
  cleaned = cleaned.replace(/\(\s*(?:Music|Applause|Laughter|음악|박수|웃음|효과음)\s*\)/gi, '');

  // Normalize whitespace
  cleaned = cleaned.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();

  // Normalize phonetic & liaison errors if Korean
  if (/[가-힣]/.test(cleaned)) {
    cleaned = correctPhoneticKoreanSpelling(cleaned);
  }

  return cleaned;
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

    srtLines.push(cleanSubtitleText(text));
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

    vttLines.push(cleanSubtitleText(text));
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
    const rawText = textLines.join('\n');
    const text = cleanSubtitleText(rawText);
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

/**
 * Detect whether URL is an Instagram Reel, Post, or Video
 */
export function isInstagramUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return /(?:https?:\/\/)?(?:www\.)?instagram\.com\/(?:reel|reels|p|tv)\/([a-zA-Z0-9_-]+)/i.test(url.trim());
}

/**
 * Extract Instagram shortcode from URL
 */
export function extractInstagramShortcode(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = url.trim().match(/(?:https?:\/\/)?(?:www\.)?instagram\.com\/(?:reel|reels|p|tv)\/([a-zA-Z0-9_-]+)/i);
  return match ? match[1] : null;
}

/**
 * Detect whether segments are predominantly Korean
 */
export function isKoreanContent(segments: SubtitleSegment[], detectedLanguage?: string): boolean {
  if (detectedLanguage) {
    const lang = detectedLanguage.toLowerCase().trim();
    if (lang === 'ko' || lang === 'kor' || lang === 'korean' || lang.startsWith('ko-')) {
      return true;
    }
  }

  if (!segments || segments.length === 0) return false;

  let hangulCount = 0;
  let latinCount = 0;
  let totalValidSegments = 0;
  let hangulSegments = 0;

  for (const seg of segments) {
    const txt = (seg.originalText || '').trim();
    if (!txt) continue;
    totalValidSegments++;
    const hangulMatches = txt.match(/[\uAC00-\uD7A3\u1100-\u11FF]/g);
    const latinMatches = txt.match(/[a-zA-Z]/g);

    const hLen = hangulMatches ? hangulMatches.length : 0;
    const lLen = latinMatches ? latinMatches.length : 0;
    hangulCount += hLen;
    latinCount += lLen;

    if (hLen >= 2 && hLen >= lLen * 0.3) {
      hangulSegments++;
    }
  }

  if (totalValidSegments === 0) return false;
  return (hangulSegments / totalValidSegments > 0.35) || (hangulCount > 20 && hangulCount > latinCount * 0.5);
}
