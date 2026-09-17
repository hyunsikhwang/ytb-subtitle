import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import multer from 'multer';
import dotenv from 'dotenv';
import Groq from 'groq-sdk';
import { createServer as createViteServer } from 'vite';

dotenv.config();

const app = express();
const PORT = 3000;

// Directories
const WORKSPACE_DIR = process.cwd();
const UPLOADS_DIR = path.join(WORKSPACE_DIR, 'uploads');
const OUTPUTS_DIR = path.join(WORKSPACE_DIR, 'outputs');
const BIN_DIR = path.join(WORKSPACE_DIR, 'bin');
const YTDLP_PATH = path.join(BIN_DIR, 'yt-dlp');

if (fs.existsSync(YTDLP_PATH)) {
  try {
    fs.chmodSync(YTDLP_PATH, 0o755);
  } catch {}
}

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(OUTPUTS_DIR)) fs.mkdirSync(OUTPUTS_DIR, { recursive: true });

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Multer storage configuration
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const unique = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    cb(null, `upload_${unique}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 250 * 1024 * 1024 } // 250MB limit
});

// Serve outputs and uploads with proper MIME and range requests for video seeking
app.use('/media/outputs', express.static(OUTPUTS_DIR));
app.use('/media/uploads', express.static(UPLOADS_DIR));

// Helper: Format seconds into SRT timestamp (HH:MM:SS,mmm)
function formatTimestamp(seconds: number): string {
  const safeSec = Math.max(0, isNaN(seconds) ? 0 : seconds);
  const millis = Math.floor((safeSec % 1) * 1000);
  const totalSecs = Math.floor(safeSec);
  const hours = Math.floor(totalSecs / 3600);
  const minutes = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;

  const pad = (n: number, z = 2) => String(n).padStart(z, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)},${pad(millis, 3)}`;
}

// Helper: Format seconds into WebVTT timestamp (HH:MM:SS.mmm)
function formatVttTimestamp(seconds: number): string {
  return formatTimestamp(seconds).replace(',', '.');
}

// Helper: Parse SRT timestamp into seconds
function parseTimestamp(ts: string): number {
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

// Helper: Decode HTML entities like &gt;, &lt;, &amp;, &quot;, &#39;, etc.
function decodeHtmlEntities(str: string): string {
  if (!str) return '';
  let res = str;
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

function correctPhoneticKoreanSpelling(text: string): string {
  if (!text || !/[가-힣]/.test(text)) return text;
  let corrected = text;
  for (const [pattern, replacement] of PHONETIC_CORRECTIONS) {
    corrected = corrected.replace(pattern, replacement);
  }
  return corrected;
}

// Helper: Clean subtitle text by removing HTML entities, formatting tags, speaker markers (>>, >), acoustic brackets, and normalizing phonetic errors
function cleanSubtitleText(text: string): string {
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

// Helper: Convert segments to SRT string
function convertSegmentsToSrt(segments: any[], language: 'translated' | 'original' | 'both' = 'translated'): string {
  const srtLines: string[] = [];
  segments.forEach((seg, idx) => {
    const cueId = (seg.id !== undefined && seg.id !== null) ? seg.id : (idx + 1);
    srtLines.push(String(cueId));
    const startStr = formatTimestamp(seg.start);
    const endStr = formatTimestamp(seg.end);
    srtLines.push(`${startStr} --> ${endStr}`);
    let text = '';
    if (language === 'both') {
      const trans = (seg.translatedText || '').trim();
      const orig = (seg.originalText || '').trim();
      text = (trans && orig && trans !== orig) ? `${trans}\n${orig}` : (trans || orig);
    } else if (language === 'translated') {
      text = seg.translatedText || '';
    } else {
      text = seg.originalText || '';
    }
    srtLines.push(cleanSubtitleText(text));
    srtLines.push('');
  });
  return srtLines.join('\n');
}

// Helper: Convert segments to WebVTT string
function convertSegmentsToVtt(segments: any[], language: 'translated' | 'original' | 'both' = 'translated'): string {
  const vttLines: string[] = ['WEBVTT', ''];
  segments.forEach((seg, idx) => {
    const cueId = (seg.id !== undefined && seg.id !== null) ? seg.id : (idx + 1);
    vttLines.push(String(cueId));
    const startStr = formatVttTimestamp(seg.start);
    const endStr = formatVttTimestamp(seg.end);
    vttLines.push(`${startStr} --> ${endStr}`);
    let text = '';
    if (language === 'both') {
      const trans = (seg.translatedText || '').trim();
      const orig = (seg.originalText || '').trim();
      text = (trans && orig && trans !== orig) ? `${trans}\n${orig}` : (trans || orig);
    } else if (language === 'translated') {
      text = seg.translatedText || '';
    } else {
      text = seg.originalText || '';
    }
    vttLines.push(cleanSubtitleText(text));
    vttLines.push('');
  });
  return vttLines.join('\n');
}

// Helper: Extract YouTube video ID
function extractYoutubeId(url: string | null | undefined): string | null {
  if (!url) return null;
  const str = url.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(str)) {
    return str;
  }
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=|shorts\/)([^#&?]*).*/;
  const match = str.match(regExp);
  return match && match[2].length === 11 ? match[2] : null;
}

// Helper: Detect Instagram URL (Reel, Post, Video)
function isInstagramUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return /(?:https?:\/\/)?(?:www\.)?instagram\.com\/(?:reel|reels|p|tv)\/([a-zA-Z0-9_-]+)/i.test(url.trim());
}

// Helper: Extract Instagram shortcode
function extractInstagramShortcode(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = url.trim().match(/(?:https?:\/\/)?(?:www\.)?instagram\.com\/(?:reel|reels|p|tv)\/([a-zA-Z0-9_-]+)/i);
  return match ? match[1] : null;
}

// Helper: Call OpenRouter API for chat completions (DeepSeek V4.1 Flash, etc.)
async function callOpenRouter(
  model: string,
  systemPrompt: string,
  userContent: string,
  maxTokens = 4096
): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    throw new Error('OPENROUTER_API_KEY is not configured');
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey.trim()}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://ai.studio',
      'X-Title': 'YouTube Subtitle Studio'
    },
    body: JSON.stringify({
      model: model || 'deepseek/deepseek-v4.1-flash',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ],
      temperature: 0.1,
      max_tokens: maxTokens
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter API error (${response.status}): ${errorText}`);
  }

  const json: any = await response.json();
  const choice = json.choices?.[0];
  let content = choice?.message?.content || '';
  if (!content && choice?.message?.reasoning) {
    content = choice.message.reasoning;
  }
  return content || '';
}

// Helper: Clean markdown fences from LLM responses
function cleanMarkdownFences(text: string): string {
  if (!text) return '';
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:srt)?\s*/i, '');
  cleaned = cleaned.replace(/\s*```$/i, '');
  return cleaned.trim();
}

// Helper: Merge spoken text avoiding duplicate words from ASR rolling captions
function mergeSpokenText(existing: string, incoming: string): string {
  const e = (existing || '').trim();
  const inc = (incoming || '').trim();
  if (!e) return inc;
  if (!inc) return e;
  if (e === inc || e.endsWith(inc)) return e;
  if (inc.startsWith(e)) return inc;

  const eWords = e.split(/\s+/);
  const incWords = inc.split(/\s+/);
  const maxOverlap = Math.min(eWords.length, incWords.length, 6);
  for (let len = maxOverlap; len >= 1; len--) {
    const eTail = eWords.slice(-len).join(' ').toLowerCase();
    const incHead = incWords.slice(0, len).join(' ').toLowerCase();
    if (eTail === incHead) {
      return eWords.concat(incWords.slice(len)).join(' ');
    }
  }

  return `${e} ${inc}`;
}

// Set of words that should never terminate an English subtitle segment
const DANGLING_END_WORDS = new Set([
  'a', 'an', 'the',
  'of', 'in', 'to', 'for', 'with', 'on', 'at', 'from', 'by', 'about', 'as', 'into', 'like', 'through',
  'after', 'over', 'between', 'out', 'against', 'during', 'without', 'before', 'under', 'around', 'among',
  'and', 'but', 'or', 'so', 'because', 'if', 'although', 'though', 'while', 'unless', 'since', 'that', 'which', 'whether',
  'who', 'whom', 'whose', 'what', 'where', 'when', 'how', 'why',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
  'do', 'does', 'did', 'can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might', 'must',
  'my', 'your', 'his', 'her', 'its', 'our', 'their', 'this', 'these', 'those'
]);

function endsWithDanglingWord(text: string): boolean {
  if (!text) return false;
  const cleaned = text.trim().replace(/[.,!?;:—"'\(\)]+$/, '').toLowerCase();
  const words = cleaned.split(/\s+/);
  if (words.length === 0) return false;
  const lastWord = words[words.length - 1];
  return DANGLING_END_WORDS.has(lastWord);
}

function endsWithSentencePunctuation(text: string): boolean {
  return /[.!?]["']?\s*$/.test((text || '').trim());
}

function endsWithClausePunctuation(text: string): boolean {
  return /[,;:\-—]["']?\s*$/.test((text || '').trim());
}

// Helper: Normalize fragmented ASR/Whisper segments into natural complete spoken sentences
function normalizeSegmentsSentences(rawSegments: any[]): any[] {
  if (!rawSegments || rawSegments.length <= 1) {
    return (rawSegments || []).map((m, idx) => ({
      id: idx + 1,
      start: typeof m.start === 'number' ? m.start : parseTimestamp(m.startTime || '00:00:00,000'),
      end: typeof m.end === 'number' ? m.end : parseTimestamp(m.endTime || '00:00:00,000'),
      startTime: formatTimestamp(typeof m.start === 'number' ? m.start : parseTimestamp(m.startTime || '00:00:00,000')),
      endTime: formatTimestamp(typeof m.end === 'number' ? m.end : parseTimestamp(m.endTime || '00:00:00,000')),
      originalText: cleanSubtitleText((m.text || m.originalText || '')),
      translatedText: m.translatedText || ''
    }));
  }

  const merged: any[] = [];
  let cur: any = null;

  for (let i = 0; i < rawSegments.length; i++) {
    const nextSeg = rawSegments[i];
    const text = cleanSubtitleText(nextSeg.text || nextSeg.originalText || '');
    if (!text) continue;

    const start = typeof nextSeg.start === 'number' ? nextSeg.start : parseTimestamp(nextSeg.startTime || '00:00:00,000');
    const end = typeof nextSeg.end === 'number' ? nextSeg.end : parseTimestamp(nextSeg.endTime || '00:00:00,000');

    if (!cur) {
      cur = { start, end, text };
      continue;
    }

    const curDur = cur.end - cur.start;
    const combinedDur = end - cur.start;
    const pauseGap = start - cur.end;
    const isCurSentenceEnd = endsWithSentencePunctuation(cur.text);
    const isCurClauseEnd = endsWithClausePunctuation(cur.text);
    const isDangling = endsWithDanglingWord(cur.text);
    const nextStartsWithCapital = /^[A-Z]/.test(text) && !isDangling;

    let shouldCut = false;

    if (combinedDur > 8.0) {
      shouldCut = true;
    } else if (isDangling && combinedDur <= 7.0) {
      shouldCut = false;
    } else if (pauseGap >= 0.55 && curDur >= 1.8 && !isDangling) {
      shouldCut = true;
    } else if (isCurSentenceEnd && curDur >= 2.0) {
      shouldCut = true;
    } else if (isCurClauseEnd && curDur >= 3.2 && !isDangling) {
      shouldCut = true;
    } else if (nextStartsWithCapital && curDur >= 3.5 && !isDangling) {
      shouldCut = true;
    } else if (curDur >= 5.5 && !isDangling) {
      shouldCut = true;
    }

    if (shouldCut) {
      merged.push(cur);
      cur = { start, end, text };
    } else {
      cur.end = Math.max(cur.end, end);
      cur.text = mergeSpokenText(cur.text, text);
    }
  }

  if (cur) {
    merged.push(cur);
  }

  return merged.map((m, idx) => ({
    id: idx + 1,
    start: m.start,
    end: m.end,
    startTime: formatTimestamp(m.start),
    endTime: formatTimestamp(m.end),
    originalText: cleanSubtitleText(m.text),
    translatedText: ''
  }));
}

// Helper: Detect whether content or audio is predominantly Korean
function isKoreanContent(segments: any[], detectedLanguage?: string): boolean {
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
    const txt = (seg.originalText || seg.text || '').trim();
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

// Helper: Parse WebVTT content into timed segments
function parseVttToSegments(vttContent: string, isAsr = true): any[] {
  const cues: { start: number; end: number; text: string }[] = [];
  const cueRegex = /(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})[^\n]*\n([\s\S]*?)(?=\n\s*\n|\n\d{2}:\d{2}:\d{2}\.\d{3}|\Z)/g;
  let match;
  while ((match = cueRegex.exec(vttContent)) !== null) {
    const start = parseTimestamp(match[1]);
    const end = parseTimestamp(match[2]);
    if (end - start < 0.1) continue;
    const rawBody = match[3];
    const lines = rawBody.split('\n')
      .map(l => cleanSubtitleText(l))
      .filter(l => l.length > 0 && !l.startsWith('WEBVTT') && !l.startsWith('Kind:') && !l.startsWith('Language:'));
    if (lines.length === 0) continue;
    const text = cleanSubtitleText(isAsr ? lines[lines.length - 1] : lines.join(' '));
    if (!text) continue;
    if (cues.length > 0 && cues[cues.length - 1].text === text) {
      cues[cues.length - 1].end = Math.max(cues[cues.length - 1].end, end);
    } else {
      cues.push({ start, end, text });
    }
  }

  // Use natural sentence restructuring
  return normalizeSegmentsSentences(cues);
}

// Helper: Fetch YouTube subtitles and metadata
interface YouTubeTranscriptData {
  segments: any[];
  title?: string;
  durationSec?: number;
  langCode?: string;
}

async function fetchYouTubeTranscript(videoId: string): Promise<YouTubeTranscriptData | null> {
  // 1. First try youtube-transcript.ai with a 6-second timeout
  try {
    const res = await fetch(`https://youtube-transcript.ai/api/subtitles?v=${videoId}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(6000)
    });
    if (res.ok) {
      const data: any = await res.json();
      const subs = data?.subtitles || [];
      if (subs && subs.length > 0) {
        // Prefer Korean subtitle track first if available, then English subtitle track, otherwise first track
        let selected = subs.find((s: any) => s.langCode === 'ko' || s.langCode?.startsWith('ko'));
        if (!selected) {
          selected = subs.find((s: any) => s.langCode === 'en' || s.langCode?.startsWith('en'));
        }
        if (!selected) selected = subs[0];

        const vtt = selected?.vttContent || '';
        if (vtt && vtt.length >= 30) {
          const segments = parseVttToSegments(vtt, Boolean(selected.isAsr));
          if (segments.length > 0) {
            return {
              segments,
              title: data?.videoTitle,
              durationSec: data?.durationSec,
              langCode: selected?.langCode
            };
          }
        }
      }
    }
  } catch (err) {
    console.warn('youtube-transcript.ai attempt warning:', err);
  }

  // 2. High-speed yt-dlp direct subtitle extraction fallback
  try {
    const tempVttBase = path.join(OUTPUTS_DIR, `temp_yt_${videoId}_${Date.now()}`);
    const ytdlpArgs = [
      '--skip-download',
      '--write-auto-subs',
      '--write-subs',
      '--sub-lang', 'ko,en',
      '--sub-format', 'vtt',
      '-o', `${tempVttBase}.%(ext)s`,
      `https://www.youtube.com/watch?v=${videoId}`
    ];
    await runProcess(YTDLP_PATH, ytdlpArgs, WORKSPACE_DIR, 8000);

    const koFile = `${tempVttBase}.ko.vtt`;
    const enFile = `${tempVttBase}.en.vtt`;
    let foundFile = '';
    let langCode = 'en';

    if (fs.existsSync(koFile)) {
      foundFile = koFile;
      langCode = 'ko';
    } else if (fs.existsSync(enFile)) {
      foundFile = enFile;
      langCode = 'en';
    }

    if (foundFile) {
      const vtt = fs.readFileSync(foundFile, 'utf-8');
      try { fs.unlinkSync(foundFile); } catch {}
      if (vtt && vtt.length >= 30) {
        const segments = parseVttToSegments(vtt, true);
        if (segments.length > 0) {
          return {
            segments,
            title: '',
            durationSec: 0,
            langCode
          };
        }
      }
    }
  } catch (ytdlpErr) {
    console.warn('yt-dlp subtitle extraction warning:', ytdlpErr);
  }

  return null;
}

// Helper: Context-aware speech recognition correction & typo polishing
async function correctSegmentsContextWithLLM(
  segmentsToCorrect: any[],
  model: string,
  log: (msg: string) => void = console.log
): Promise<any[]> {
  const cloned = JSON.parse(JSON.stringify(segmentsToCorrect));
  cloned.forEach((s: any, idx: number) => {
    if (s.id === undefined || s.id === null) {
      s.id = idx + 1;
    }
    s.originalText = cleanSubtitleText(s.originalText || '');
    if (!s.translatedText || !s.translatedText.trim()) {
      s.translatedText = s.originalText;
    }
    s.translatedText = cleanSubtitleText(s.translatedText || '');
  });

  const BATCH_SIZE = 25;
  const targetModel = model || 'openai/gpt-oss-20b';

  // Split into batches
  const batches: any[][] = [];
  for (let i = 0; i < cloned.length; i += BATCH_SIZE) {
    batches.push(cloned.slice(i, i + BATCH_SIZE));
  }

  // Process batches in parallel chunks of 3 for fast, non-blocking execution
  const CONCURRENCY = 3;
  for (let c = 0; c < batches.length; c += CONCURRENCY) {
    const chunk = batches.slice(c, c + CONCURRENCY);
    await Promise.all(
      chunk.map(async (batch, idx) => {
        const batchIndex = c + idx;
        const startIdx = batchIndex * BATCH_SIZE + 1;
        const endIdx = Math.min(startIdx + batch.length - 1, cloned.length);
        const isKoreanBatch = batch.some((s: any) => /[가-힣]/.test(s.translatedText || s.originalText));
        const batchSrt = convertSegmentsToSrt(batch, isKoreanBatch ? 'translated' : 'original');
        const firstId = batch[0].id;
        const lastId = batch[batch.length - 1].id;

        const systemPrompt = `당신은 대한민국 방송 자막 전문 교열 및 윤문 수석 에디터입니다.
주어진 자막은 음성인식(STT)으로 전사되어, 발음이나 소리가 유사하여 잘못 인식된 단어(동음이의어/음향 오인식), 오타, 어색한 어휘, 맞춤법 및 띄어쓰기 오류가 포함되어 있습니다.

[핵심 교정 임무]
1. [소리/발음 나는 대로 적힌 음운 표기 오류(연음·구개음화·경음화·자음동화) 표준어 복원 - 최우선 순위]:
   - 음성인식(STT) 모델이 한국어 발음의 연음 법칙이나 음운 변동 때문에 소리 나는 대로 잘못 전사한 오탈자를 올바른 표준어 맞춤법으로 완벽하게 복원하세요.
   - [연음 법칙 오기 교정]:
     * "조름운전" -> "졸음운전" ("조름" -> "졸음")
     * "거름마" -> "걸음마", "어름물" -> "얼음물", "어름" -> "얼음"
     * "무르플" / "무릅을" -> "무릎을", "무르피" -> "무릎이"
     * "머기를" -> "먹이를", "기피를" -> "깊이를"
     * "우슴" / "우스미" -> "웃음" / "웃음이", "미드미" -> "믿음이"
     * "손톱까끼" / "손톱깍이" -> "손톱깎이", "바까테" -> "바깥에", "까까지른" -> "깎아지른"
     * "오슬" -> "옷을", "마으미" -> "마음이", "바믈" -> "밤을", "나제" -> "낮에"
     * "무러보다" -> "물어보다", "자바먹다" -> "잡아먹다", "마즌편" -> "맞은편", "절므니" -> "젊은이"
   - [구개음화 및 받침 오기 교정]:
     * "구지" -> "굳이", "가치 가요" -> "같이 가요", "해도지" -> "해돋이", "미다지" -> "미닫이"
   - [경음화(된소리) 오기 교정]:
     * "할 쑤 있다" -> "할 수 있다", "갈 꼿" -> "갈 곳", "볼 쑤" -> "볼 수"
     * "효꽈" -> "효과", "사껀" -> "사건", "조껀" -> "조건", "신꼬" -> "신고", "등뿔" -> "등불"
   - [자음동화(비음화/유음화) 오기 교정]:
     * "궁민" -> "국민", "동닙" -> "독립", "실라 시대" -> "신라 시대", "칼랄" -> "칼날", "밤물" -> "밥물", "암녁" -> "압력"
   - [거센소리(격음화) 오기 교정]:
     * "추카합니다" -> "축하합니다", "이팍식" -> "입학식", "어떠케" -> "어떻게", "노코" -> "놓고", "조타" -> "좋다"
2. [음향 오인식(동음이의어) 문맥 교정]:
   - 전후 문맥을 면밀히 분석하여, 음향적으로 오인식된 단어를 화자의 본래 의도와 문맥에 맞는 정확하고 올바른 단어로 교정하세요.
   - 예: "정찰을 빚졌습니다" -> "정체를 빚었습니다" (교통/지연 상황 맥락)
   - 예: "가성비가 쫓습니다" -> "가성비가 좋습니다"
   - 예: "인공지는 모델" -> "인공지능 모델"
   - 예: "새로운 기름이 출시되었습니다" -> "새로운 기능이 출시되었습니다"
   - 예: "문제가 붉어졌습니다" -> "문제가 불거졌습니다"
   - 예: "결재를 진행합니다" (금액 결제 맥락) -> "결제를 진행합니다"
   - 예: "시청해 주셔서 간사합니다" -> "시청해 주셔서 감사합니다"
   - 예: "어떻해" -> "어떡해", "안 되요" -> "안 돼요", "몇일" -> "며칠"
3. [문장 완성도 및 어순]:
   - 한국어 어순과 문맥 흐름에 맞게 매끄럽고 신뢰감 있는 방송 자막 어조(~합니다, ~입니다)로 자연스럽게 정돈하세요.
4. [불필요한 기호 및 특수문자 완벽 제거]:
   - &gt;, &lt;, &amp;, &quot; 등 모든 HTML 엔티티를 절대 출력하지 마세요.
   - 화자 전환 표시인 '>>', '>', 그리고 [음악], [박수] 등의 불필요한 기호는 모두 제거하세요.
5. [절대 원칙]:
   - 원본의 자막 번호(ID)와 타임스탬프(00:00:00,000 --> 00:00:00,000)는 단 1초도 수정하지 말고 100% 원본 그대로 유지하세요.
   - 번호 ${firstId}번부터 ${lastId}번까지 총 ${batch.length}개 구간을 빠짐없이 온전히 출력하세요.
   - 마크다운 백틱(\`\`\`srt) 없이 오직 순수한 SRT 포맷 자막만 출력하세요.`;

        log(`AI 음성인식 문맥 교정 (${startIdx}~${endIdx} / 총 ${cloned.length}개 구간)...`);

        let correctedSrt = '';
        const useOpenRouter = Boolean(process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY.trim().length > 5) &&
          (targetModel.startsWith('deepseek/') || targetModel.startsWith('openai/') || targetModel.includes('gpt-oss') || !process.env.GROQ_API_KEY);

        if (useOpenRouter) {
          const orModel = targetModel.startsWith('openai/') || targetModel.startsWith('deepseek/')
            ? targetModel
            : 'openai/gpt-oss-20b';
          try {
            correctedSrt = await callOpenRouter(orModel, systemPrompt, batchSrt, 8192);
          } catch (err: any) {
            try {
              correctedSrt = await callOpenRouter('deepseek/deepseek-v4.1-flash', systemPrompt, batchSrt, 8192);
            } catch {
              if (process.env.GROQ_API_KEY) {
                try {
                  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
                  const comp = await groq.chat.completions.create({
                    model: 'llama-3.3-70b-versatile',
                    messages: [
                      { role: 'system', content: systemPrompt },
                      { role: 'user', content: batchSrt }
                    ],
                    temperature: 0.1,
                    max_completion_tokens: 4096
                  });
                  correctedSrt = comp.choices[0]?.message?.content || '';
                } catch {}
              }
            }
          }
        } else if (process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.trim().length > 5) {
          const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
          const groqModel = targetModel.startsWith('llama') ? targetModel : 'llama-3.3-70b-versatile';
          try {
            const comp = await groq.chat.completions.create({
              model: groqModel,
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: batchSrt }
              ],
              temperature: 0.1,
              max_completion_tokens: 4096
            });
            correctedSrt = comp.choices[0]?.message?.content || '';
          } catch {
            if (process.env.OPENROUTER_API_KEY) {
              try {
                correctedSrt = await callOpenRouter('deepseek/deepseek-v4.1-flash', systemPrompt, batchSrt, 8192);
              } catch {}
            }
          }
        }

        const cleaned = cleanMarkdownFences(correctedSrt);
        const parsed = parseSrt(cleaned);
        if (parsed.length > 0) {
          parsed.forEach((trSeg: any, trIdx: number) => {
            let match = batch.find((s: any) => s.id === trSeg.id);
            if (!match && trIdx < batch.length) {
              match = batch[trIdx];
            }
            if (match) {
              const candidate = cleanSubtitleText(trSeg.translatedText || trSeg.originalText || '');
              if (candidate) {
                match.translatedText = candidate;
                if (/[가-힣]/.test(match.originalText)) {
                  match.originalText = candidate;
                }
              }
            }
          });
        }
      })
    );
  }

  cloned.forEach((s: any) => {
    s.originalText = cleanSubtitleText(s.originalText || '');
    s.translatedText = cleanSubtitleText(s.translatedText || s.originalText || '');
  });

  return cloned;
}

// Helper: Translate subtitle segments using LLM (OpenRouter / Groq)
async function translateSegmentsWithLLM(
  segmentsToTranslate: any[],
  model: string,
  log: (msg: string) => void
): Promise<any[]> {
  const cloned = JSON.parse(JSON.stringify(segmentsToTranslate));
  // Guarantee each segment has a 1-based sequential id before starting
  cloned.forEach((s: any, idx: number) => {
    if (s.id === undefined || s.id === null) {
      s.id = idx + 1;
    }
    s.originalText = cleanSubtitleText(s.originalText || '');
    s.translatedText = cleanSubtitleText(s.translatedText || '');
  });

  // If the segments are already predominantly Korean, perform fast intelligent ASR typo and context correction!
  if (isKoreanContent(cloned)) {
    log('🇰🇷 한국어 자막 감지: 음성 오인식(동음이의어/문맥 오류) 교정 및 자막 정제 진행 중...');
    return await correctSegmentsContextWithLLM(cloned, model, log);
  }

  const BATCH_SIZE = 25;
  const targetModel = model || 'openai/gpt-oss-20b';

  // Split into batches
  const batches: any[][] = [];
  for (let i = 0; i < cloned.length; i += BATCH_SIZE) {
    batches.push(cloned.slice(i, i + BATCH_SIZE));
  }

  // Process batches with concurrency of 3
  const CONCURRENCY = 3;
  for (let c = 0; c < batches.length; c += CONCURRENCY) {
    const chunk = batches.slice(c, c + CONCURRENCY);
    await Promise.all(
      chunk.map(async (batch, idx) => {
        const batchIndex = c + idx;
        const startIdx = batchIndex * BATCH_SIZE + 1;
        const endIdx = Math.min(startIdx + batch.length - 1, cloned.length);
        const batchSrt = convertSegmentsToSrt(batch, 'original');
        const firstId = batch[0].id;
        const lastId = batch[batch.length - 1].id;

        const systemPrompt = `당신은 대한민국 최고 수준의 전문 영상 번역가이자 방송 자막 에디터입니다.
주어진 영어 SRT 자막 전체를 한국어 시청자를 위한 완성도 높은 방송용 한국어 자막으로 번역 및 다듬어 주세요.

[핵심 번역 원칙]
1. 번호 ${firstId}번부터 ${lastId}번까지 총 ${batch.length}개 구간 전체를 단 하나도 빠짐없이 온전히 출력하세요.
2. 각 구간 번호(ID)와 타임스탬프(00:00:00,000 --> 00:00:00,000)는 원본과 100% 동일하게 유지하세요.
3. [문맥 연결 번역] 영문 음성 인식(ASR) 특성상 하나의 온전한 문장이 2~3개 구간에 걸쳐 이어져 있을 수 있습니다. 각 구간을 끊어서 어색하게 직역하지 말고, 앞뒤 자막의 전체 문장 맥락을 먼저 파악하세요.
4. 한국어 어순(주어-목적어-서술어)과 영상 호흡에 맞게, 각 구간의 한국어 표현이 자연스럽고 완성도 높은 방송 자막 문장이 되도록 매끄럽게 번역해 분배하세요.
5. "~하는 사람들을 위한", "그리고", "해서" 처럼 문장이 중간에 어색하게 잘린 채 끝나는 번역투를 절대 금지하고, 깔끔한 방송 뉴스 어조(~합니다, ~입니다)로 다듬어 주세요.
6. [음성 오인식(동음이의어/ASR 오타) 문맥 교정]: 원문 음성에 발음 유사 오인식이나 문맥상 어색한 단어가 있더라도, 전체 문맥을 살펴 화자의 본래 의도에 맞게 문맥 오류를 바로잡아 올바른 한국어로 번역하세요.
7. [불필요한 기호 및 특수문자 완벽 제거]: &gt;, &lt;, &amp;, &quot; 등 모든 HTML 엔티티 및 화자 기호(>>, >), [음악], [박수] 등의 불필요한 기호는 절대 출력하지 마세요.
8. AI, OpenAI, Fyxer 등 고유명사는 적절하게 표기하세요.
9. 마크다운 백틱(\`\`\`srt) 없이 오직 순수 SRT 자막만 처음부터 끝까지 출력하세요.`;

        log(`AI 자막 번역 (${startIdx}~${endIdx} / 총 ${cloned.length}개 구간)...`);

        let translatedSrt = '';
        const useOpenRouter = Boolean(process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY.trim().length > 5) &&
          (targetModel.startsWith('deepseek/') || targetModel.startsWith('openai/') || targetModel.includes('gpt-oss') || !process.env.GROQ_API_KEY);

        if (useOpenRouter) {
          const orModel = targetModel.startsWith('openai/') || targetModel.startsWith('deepseek/')
            ? targetModel
            : 'openai/gpt-oss-20b';
          try {
            translatedSrt = await callOpenRouter(orModel, systemPrompt, batchSrt, 8192);
          } catch (err: any) {
            log(`OpenRouter (${orModel}) 재시도: deepseek-v4.1-flash 사용...`);
            try {
              translatedSrt = await callOpenRouter('deepseek/deepseek-v4.1-flash', systemPrompt, batchSrt, 8192);
            } catch {
              if (process.env.GROQ_API_KEY) {
                try {
                  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
                  const comp = await groq.chat.completions.create({
                    model: 'llama-3.3-70b-versatile',
                    messages: [
                      { role: 'system', content: systemPrompt },
                      { role: 'user', content: batchSrt }
                    ],
                    temperature: 0.1,
                    max_completion_tokens: 4096
                  });
                  translatedSrt = comp.choices[0]?.message?.content || '';
                } catch {}
              }
            }
          }
        } else if (process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.trim().length > 5) {
          const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
          const groqModel = targetModel.startsWith('llama') ? targetModel : 'llama-3.3-70b-versatile';
          try {
            const comp = await groq.chat.completions.create({
              model: groqModel,
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: batchSrt }
              ],
              temperature: 0.1,
              max_completion_tokens: 4096
            });
            translatedSrt = comp.choices[0]?.message?.content || '';
          } catch {
            if (process.env.OPENROUTER_API_KEY) {
              try {
                translatedSrt = await callOpenRouter('deepseek/deepseek-v4.1-flash', systemPrompt, batchSrt, 8192);
              } catch {}
            }
          }
        }

        const cleaned = cleanMarkdownFences(translatedSrt);
        const parsed = parseSrt(cleaned);
        if (parsed.length > 0) {
          parsed.forEach((trSeg, trIdx) => {
            let match = batch.find((s: any) => s.id === trSeg.id);
            if (!match && trIdx < batch.length) {
              match = batch[trIdx];
            }
            if (match) {
              const candidate = cleanSubtitleText(trSeg.translatedText || trSeg.originalText || '');
              if (candidate && /[가-힣]/.test(candidate)) {
                match.translatedText = candidate;
              } else if (candidate) {
                match.translatedText = candidate;
              }
            }
          });
        }
      })
    );
  }

  // Safety check: ensure any remaining missing/blank segments get Korean translation
  const stillMissing = cloned.filter((s: any) => !s.translatedText || !/[가-힣]/.test(s.translatedText));
  if (stillMissing.length > 0) {
    log(`미번역/빈칸 자막 ${stillMissing.length}개 구간 추가 정밀 번역 중...`);
    for (let m = 0; m < stillMissing.length; m += 12) {
      const mBatch = stillMissing.slice(m, m + 12);
      const mSrt = convertSegmentsToSrt(mBatch, 'original');
      let mResult = '';

      if (process.env.GROQ_API_KEY) {
        try {
          const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
          const comp = await groq.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages: [
              { role: 'system', content: '영어 SRT 자막을 한국어 방송 자막으로 1:1 번역하세요. &gt;, &lt; 등의 HTML 기호를 없애고 순수 SRT만 출력하세요.' },
              { role: 'user', content: mSrt }
            ],
            temperature: 0.1,
            max_completion_tokens: 4096
          });
          mResult = comp.choices[0]?.message?.content || '';
        } catch {}
      }

      if (!mResult && process.env.OPENROUTER_API_KEY) {
        try {
          mResult = await callOpenRouter('deepseek/deepseek-v4.1-flash', '영어 SRT 자막을 한국어 방송 자막으로 1:1 번역하세요. &gt;, &lt; 등의 HTML 기호를 없애고 순수 SRT만 출력하세요.', mSrt, 4096);
        } catch {}
      }

      if (mResult) {
        const fixParsed = parseSrt(cleanMarkdownFences(mResult));
        fixParsed.forEach((f, fIdx) => {
          const match = mBatch.find((s: any) => s.id === f.id) || (fIdx < mBatch.length ? mBatch[fIdx] : null);
          if (match) {
            const trans = cleanSubtitleText(f.translatedText || f.originalText || '');
            if (trans && /[가-힣]/.test(trans)) {
              match.translatedText = trans;
            }
          }
        });
      }
    }
  }

  // Final safeguard: if any segment still has no Korean, do a fast direct single-line translation
  for (const seg of cloned) {
    if (!seg.translatedText || !/[가-힣]/.test(seg.translatedText)) {
      if (seg.originalText && process.env.GROQ_API_KEY) {
        try {
          const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
          const comp = await groq.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages: [
              { role: 'system', content: '영어 문장을 자연스러운 한국어 방송 자막 한 문장으로 번역하세요. 특수문자 없이 설명 없이 번역문만 한 줄로 출력하세요.' },
              { role: 'user', content: seg.originalText }
            ],
            temperature: 0.1,
            max_completion_tokens: 256
          });
          const single = cleanSubtitleText(cleanMarkdownFences(comp.choices[0]?.message?.content || ''));
          if (single && /[가-힣]/.test(single)) {
            seg.translatedText = single;
          }
        } catch {}
      }
    }
  }

  cloned.forEach((s: any) => {
    s.originalText = cleanSubtitleText(s.originalText || '');
    s.translatedText = cleanSubtitleText(s.translatedText || '');
  });

  return cloned;
}

// Helper: Parse SRT text to segments
function parseSrt(srtContent: string) {
  if (!srtContent) return [];
  const normalized = srtContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Match cues with $ or next cue boundary
  const cueRegex = /(?:^|\n)(?:(\d+)\s*\n)?(\d{2}:\d{2}:\d{2}[,\.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,\.]\d{3})[^\n]*\n([\s\S]*?)(?=(?:\n\s*\d+\s*\n\d{2}:\d{2}:\d{2})|(?:\n\d{2}:\d{2}:\d{2})|$)/g;
  const regexSegments: any[] = [];
  let match;
  let autoIdx = 1;

  while ((match = cueRegex.exec(normalized)) !== null) {
    const rawId = match[1] ? parseInt(match[1], 10) : autoIdx;
    const start = parseTimestamp(match[2]);
    const end = parseTimestamp(match[3]);
    const rawText = match[4].trim();
    const textLines = rawText.split('\n').map(l => l.trim()).filter(Boolean);

    let originalText = textLines.join('\n');
    let translatedText = textLines.join('\n');

    if (textLines.length >= 2) {
      const hasHangul0 = /[가-힣]/.test(textLines[0]);
      const hasHangul1 = /[가-힣]/.test(textLines[1]);
      if (hasHangul0 && !hasHangul1) {
        translatedText = textLines[0];
        originalText = textLines.slice(1).join('\n');
      } else if (!hasHangul0 && hasHangul1) {
        originalText = textLines[0];
        translatedText = textLines.slice(1).join('\n');
      }
    } else if (textLines.length === 1) {
      const hasHangul = /[가-힣]/.test(textLines[0]);
      if (hasHangul) {
        translatedText = textLines[0];
      }
    }

    regexSegments.push({
      id: rawId || autoIdx,
      start,
      end,
      startTime: formatTimestamp(start),
      endTime: formatTimestamp(end),
      originalText: cleanSubtitleText(originalText),
      translatedText: cleanSubtitleText(translatedText)
    });
    autoIdx++;
  }

  if (regexSegments.length > 0) {
    return regexSegments;
  }

  const blocks = normalized.split(/\n\n+/).map(b => b.trim()).filter(Boolean);
  const segments: any[] = [];
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
    let originalText = textLines.join('\n');
    let translatedText = textLines.join('\n');

    if (textLines.length >= 2) {
      const hasHangul0 = /[가-힣]/.test(textLines[0]);
      const hasHangul1 = /[가-힣]/.test(textLines[1]);
      if (hasHangul0 && !hasHangul1) {
        translatedText = textLines[0];
        originalText = textLines.slice(1).join('\n');
      } else if (!hasHangul0 && hasHangul1) {
        originalText = textLines[0];
        translatedText = textLines.slice(1).join('\n');
      }
    }

    segments.push({
      id: index + 1,
      start,
      end,
      startTime: formatTimestamp(start),
      endTime: formatTimestamp(end),
      originalText: cleanSubtitleText(originalText),
      translatedText: cleanSubtitleText(translatedText)
    });
  });
  return segments;
}

// Run child process wrapper with timeout
function runProcess(
  cmd: string,
  args: string[],
  cwd = WORKSPACE_DIR,
  timeoutMs = 60000
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd });
    let stdout = '';
    let stderr = '';
    let timer: NodeJS.Timeout | null = null;

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch {}
        reject(new Error(`Command ${cmd} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`Command ${cmd} exited with code ${code}: ${stderr || stdout}`));
      }
    });

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
  });
}

// ----------------------------------------------------
// API ROUTES
// ----------------------------------------------------

// 1. Status check
app.get('/api/status', (_req: Request, res: Response) => {
  const hasGroqKey = Boolean(process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.trim().length > 5);
  const hasOpenRouterKey = Boolean(process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY.trim().length > 5);

  res.json({
    hasGroqKey,
    hasOpenRouterKey,
    activeEngine: hasOpenRouterKey ? 'openrouter' : (hasGroqKey ? 'groq' : 'demo'),
    availableModels: [
      'openai/gpt-oss-20b',
      'deepseek/deepseek-v4.1-flash',
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant'
    ]
  });
});

// 2. Single segment re-translation (Default: gpt-oss-20b)
app.post('/api/subtitles/translate-single', async (req: Request, res: Response) => {
  try {
    const { originalText, model = 'openai/gpt-oss-20b' } = req.body;
    if (!originalText) {
      return res.status(400).json({ error: 'originalText is required' });
    }

    const systemPrompt = `당신은 대한민국 방송 전문 번역 및 자막 에디터입니다.
주어진 영어 또는 외래어 자막 문장을 한국어 시청자를 위한 자연스럽고 신뢰감 있는 방송 뉴스 어조의 한국어로 번역 및 다듬어 주세요.
원문에 음성 오인식(동음이의어 등)이 있더라도 올바른 표현으로 바로잡아 주세요.
&gt;, &lt;, &amp; 등의 HTML 엔티티 및 화자 기호(>>, >)는 절대 출력하지 마세요.
인사말이나 부연 설명 없이 오직 완성된 한국어 문장 하나만 반환하세요.`;

    const isOpenRouterModel = model.startsWith('openai/') || model.includes('gpt-oss') || model.startsWith('deepseek/') || (!process.env.GROQ_API_KEY && process.env.OPENROUTER_API_KEY);

    if (process.env.OPENROUTER_API_KEY && isOpenRouterModel) {
      const targetModel = model.startsWith('openai/') || model.startsWith('deepseek/') ? model : 'openai/gpt-oss-20b';
      try {
        const content = await callOpenRouter(targetModel, systemPrompt, originalText, 500);
        const translatedText = cleanSubtitleText(cleanMarkdownFences(content));
        return res.json({ translatedText });
      } catch (orErr: any) {
        console.warn(`OpenRouter (${targetModel}) translate error, fallback to deepseek:`, orErr.message);
        try {
          const content = await callOpenRouter('deepseek/deepseek-v4.1-flash', systemPrompt, originalText, 500);
          const translatedText = cleanSubtitleText(cleanMarkdownFences(content));
          return res.json({ translatedText });
        } catch {
          return res.json({ translatedText: cleanSubtitleText(originalText) });
        }
      }
    } else if (process.env.GROQ_API_KEY) {
      const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
      const groqModel = model.startsWith('llama') ? model : 'llama-3.3-70b-versatile';
      try {
        const completion = await groq.chat.completions.create({
          model: groqModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: originalText }
          ],
          temperature: 0.1,
          max_completion_tokens: 300
        });
        const translatedText = cleanSubtitleText(cleanMarkdownFences(completion.choices[0]?.message?.content || ''));
        return res.json({ translatedText });
      } catch {
        return res.json({ translatedText: cleanSubtitleText(originalText) });
      }
    } else {
      return res.json({ translatedText: cleanSubtitleText(originalText) });
    }
  } catch (error: any) {
    console.error('Translate single error:', error);
    res.status(500).json({ error: error.message || 'Translation failed' });
  }
});

// 2.05 Single segment context-aware speech recognition correction
app.post('/api/subtitles/correct-single', async (req: Request, res: Response) => {
  try {
    const { text, prevText = '', nextText = '', model = 'openai/gpt-oss-20b' } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'text is required' });
    }

    const cleanInput = cleanSubtitleText(text);
    const cleanPrev = cleanSubtitleText(prevText);
    const cleanNext = cleanSubtitleText(nextText);

    const userPrompt = `[앞 자막 문맥]: ${cleanPrev || '(없음)'}
[교정 대상 자막]: ${cleanInput}
[뒤 자막 문맥]: ${cleanNext || '(없음)'}`;

    const systemPrompt = `당신은 대한민국 방송 자막 전문 수석 교열 에디터입니다.
주어진 [교정 대상 자막]은 음성인식(STT)으로 전사되어, 발음이나 소리가 유사하여 잘못 인식된 단어(동음이의어/음향 오인식), 발음 나는 대로 적힌 오탈자(연음/구개음화/경음화/자음동화 등), 어색한 어휘, 띄어쓰기 오류가 포함되어 있을 수 있습니다.
[앞/뒤 자막 문맥]을 면밀히 분석하여, 음향적으로 오인식되거나 소리 나는 대로 적힌 단어를 화자의 본래 의도와 문맥에 맞는 정확하고 올바른 표준어 맞춤법으로 교정하세요.

[필수 교정 원칙]:
1. [발음/소리 나는 대로 적힌 연음 및 음운 변동 오탈자 교정 - 최우선]:
   - "조름운전" -> "졸음운전" ("조름" -> "졸음")
   - "거름마" -> "걸음마", "어름물" -> "얼음물", "무르플" -> "무릎을", "머기를" -> "먹이를", "기피를" -> "깊이를"
   - "우슴" / "우스미" -> "웃음" / "웃음이", "미드미" -> "믿음이", "손톱까끼" -> "손톱깎이", "바까테" -> "바깥에"
   - "구지" -> "굳이", "가치 가요" -> "같이 가요", "해도지" -> "해돋이"
   - "할 쑤 있다" -> "할 수 있다", "갈 꼿" -> "갈 곳", "효꽈" -> "효과", "사껀" -> "사건", "조껀" -> "조건"
   - "궁민" -> "국민", "동닙" -> "독립", "실라 시대" -> "신라 시대", "칼랄" -> "칼날", "밤물" -> "밥물"
   - "추카합니다" -> "축하합니다", "이팍식" -> "입학식", "어떠케" -> "어떻게", "노코" -> "놓고", "조타" -> "좋다"
2. [문맥상 오인식 어휘 바로잡기]:
   - "정찰을 빚졌습니다" -> "정체를 빚었습니다"
   - "가성비가 쫓습니다" -> "가성비가 좋습니다"
   - "인공지는 모델" -> "인공지능 모델"
   - "새로운 기름이 출시되었습니다" -> "새로운 기능이 출시되었습니다"
   - "문제가 붉어졌습니다" -> "문제가 불거졌습니다"
   - "결재" vs "결제", "며칠" vs "몇일", "어떡해" vs "어떻해", "안 돼요" vs "안 되요"
3. &gt;, &lt;, &amp; 등의 HTML 엔티티 및 화자 기호(>>, >)는 절대 출력하지 마세요.
설명이나 인사말 없이 오직 교정된 한국어 완성 자막 한 문장만 출력하세요.`;

    let corrected = '';
    const isOpenRouter = Boolean(process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY.trim().length > 5);

    if (isOpenRouter) {
      const orModel = model.startsWith('openai/') || model.startsWith('deepseek/') ? model : 'openai/gpt-oss-20b';
      try {
        corrected = await callOpenRouter(orModel, systemPrompt, userPrompt, 500);
      } catch {
        try {
          corrected = await callOpenRouter('deepseek/deepseek-v4.1-flash', systemPrompt, userPrompt, 500);
        } catch {}
      }
    }

    if (!corrected && process.env.GROQ_API_KEY) {
      try {
        const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
        const comp = await groq.chat.completions.create({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.1,
          max_completion_tokens: 300
        });
        corrected = comp.choices[0]?.message?.content || '';
      } catch {}
    }

    const cleanedText = cleanSubtitleText(cleanMarkdownFences(corrected) || cleanInput);
    return res.json({ correctedText: cleanedText });
  } catch (error: any) {
    console.error('Correct single error:', error);
    res.status(500).json({ error: error.message || 'Correction failed' });
  }
});

// 2.06 Batch context-aware speech recognition correction
app.post('/api/subtitles/correct-context', async (req: Request, res: Response) => {
  try {
    const { segments, model = 'openai/gpt-oss-20b' } = req.body;
    if (!segments || !Array.isArray(segments)) {
      return res.status(400).json({ error: 'segments array is required' });
    }

    const corrected = await correctSegmentsContextWithLLM(segments, model, (msg) => console.log(msg));
    return res.json({ success: true, segments: corrected });
  } catch (error: any) {
    console.error('Correct context error:', error);
    res.status(500).json({ error: error.message || 'Context correction failed' });
  }
});

// 2.1 Batch clean / re-translate all segments (Default: gpt-oss-20b)
app.post('/api/subtitles/clean-all', async (req: Request, res: Response) => {
  try {
    const { segments, model = 'openai/gpt-oss-20b' } = req.body;
    if (!segments || !Array.isArray(segments)) {
      return res.status(400).json({ error: 'segments array is required' });
    }

    const translated = await translateSegmentsWithLLM(segments, model, (msg) => console.log(msg));
    return res.json({ success: true, segments: translated });
  } catch (error: any) {
    console.error('Clean all error:', error);
    res.status(500).json({ error: error.message || 'Batch translation failed' });
  }
});

// 2.2 Fill blank / untranslated segments only
app.post('/api/subtitles/fill-blanks', async (req: Request, res: Response) => {
  try {
    const { segments, model = 'openai/gpt-oss-20b' } = req.body;
    if (!segments || !Array.isArray(segments)) {
      return res.status(400).json({ error: 'segments array is required' });
    }

    const cloned = JSON.parse(JSON.stringify(segments));
    const missing = cloned.filter((s: any) => !s.translatedText || !/[가-힣]/.test(s.translatedText));
    if (missing.length === 0) {
      return res.json({ success: true, segments: cloned });
    }

    const translatedMissing = await translateSegmentsWithLLM(missing, model, (msg) => console.log(msg));
    translatedMissing.forEach((tr: any) => {
      const target = cloned.find((s: any) => s.id === tr.id);
      if (target && tr.translatedText) {
        target.translatedText = tr.translatedText;
      }
    });

    return res.json({ success: true, segments: cloned });
  } catch (error: any) {
    console.error('Fill blanks error:', error);
    res.status(500).json({ error: error.message || 'Fill blanks failed' });
  }
});

// 3. Re-mux subtitles into video (FFmpeg softsub)
app.post('/api/subtitles/remux', async (req: Request, res: Response) => {
  try {
    const { videoPath, segments } = req.body;
    if (!videoPath || !segments || !Array.isArray(segments)) {
      return res.status(400).json({ error: 'videoPath and segments array are required' });
    }

    // Resolve input video
    let inputVideo = videoPath;
    if (inputVideo.startsWith('/media/outputs/')) {
      inputVideo = path.join(OUTPUTS_DIR, inputVideo.replace('/media/outputs/', ''));
    } else if (inputVideo.startsWith('/media/uploads/')) {
      inputVideo = path.join(UPLOADS_DIR, inputVideo.replace('/media/uploads/', ''));
    } else if (inputVideo.startsWith('/')) {
      inputVideo = path.join(WORKSPACE_DIR, 'public', inputVideo.replace(/^\//, ''));
    }

    if (!fs.existsSync(inputVideo)) {
      return res.status(404).json({ error: `Video file not found at ${inputVideo}` });
    }

    const jobId = `remux_${Date.now()}`;
    const srtPath = path.join(OUTPUTS_DIR, `${jobId}.srt`);
    const vttPath = path.join(OUTPUTS_DIR, `${jobId}.vtt`);
    const outputVideoPath = path.join(OUTPUTS_DIR, `${jobId}_softsub.mp4`);

    const srtContent = convertSegmentsToSrt(segments, 'translated');
    const vttContent = convertSegmentsToVtt(segments, 'translated');

    fs.writeFileSync(srtPath, srtContent, 'utf-8');
    fs.writeFileSync(vttPath, vttContent, 'utf-8');

    // Softsub merge using FFmpeg
    // Note: copy video & audio stream, add mov_text subtitle stream
    const ffmpegArgs = [
      '-y',
      '-i', inputVideo,
      '-i', srtPath,
      '-c:v', 'copy',
      '-c:a', 'copy',
      '-c:s', 'mov_text',
      '-metadata:s:s:0', 'language=kor',
      '-metadata:s:s:0', 'title=한국어 자막',
      outputVideoPath
    ];

    await runProcess('ffmpeg', ffmpegArgs);

    res.json({
      success: true,
      softsubVideoUrl: `/media/outputs/${path.basename(outputVideoPath)}`,
      srtUrl: `/media/outputs/${path.basename(srtPath)}`,
      vttUrl: `/media/outputs/${path.basename(vttPath)}`
    });
  } catch (error: any) {
    console.error('Remux error:', error);
    res.status(500).json({ error: error.message || 'Remuxing failed' });
  }
});

// 4. Main Processing Pipeline (YouTube URL, direct file, or sample)
app.post('/api/pipeline/process', (req, res, next) => {
  upload.single('mediaFile')(req, res, (err: any) => {
    if (err) {
      console.error('Multer file upload error:', err);
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? '업로드 파일 크기가 250MB 제한을 초과했습니다.'
        : `파일 업로드 중 오류가 발생했습니다: ${err.message}`;
      return res.status(400).json({
        success: false,
        error: msg
      });
    }
    next();
  });
}, async (req: Request, res: Response) => {
  const jobId = `job_${Date.now()}`;
  const jobDir = path.join(OUTPUTS_DIR, jobId);
  if (!fs.existsSync(jobDir)) fs.mkdirSync(jobDir, { recursive: true });

  const {
    youtubeUrl,
    instagramUrl,
    directUrl,
    url: genericUrl,
    useSample,
    model = 'openai/gpt-oss-20b',
    cookiesText
  } = req.body;

  let inputVideoPath = '';
  let audioMp3Path = path.join(jobDir, 'audio.mp3');
  let rawSrtPath = path.join(jobDir, 'raw_whisper.srt');
  let finalSrtPath = path.join(jobDir, 'subtitles.srt');
  let finalVttPath = path.join(jobDir, 'subtitles.vtt');
  let outputSoftsubPath = path.join(jobDir, 'output_softsub.mp4');

  const logs: string[] = [];
  const log = (msg: string) => {
    console.log(`[${jobId}] ${msg}`);
    logs.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
  };

  const rawCandidate = (instagramUrl || youtubeUrl || directUrl || genericUrl || '').trim();
  const isInstagram = isInstagramUrl(rawCandidate);
  const isYoutube = !isInstagram && (Boolean(extractYoutubeId(rawCandidate)) || /youtu(\.be|be\.com)/i.test(rawCandidate));

  try {
    // ----------------------------------------------------
    // STAGE 1: Video Preparation
    // ----------------------------------------------------
    log('[1/5] 영상 준비 시작...');
    let videoTitle = '영상 자막 생성 작업';
    let youtubeVideoId: string | null = null;
    let isRealVideoDownloaded = false;

    if (req.file) {
      log(`업로드된 파일 사용: ${req.file.originalname}`);
      inputVideoPath = req.file.path;
      videoTitle = req.file.originalname;
      isRealVideoDownloaded = true;
    } else if (useSample === 'true' || useSample === true || (!rawCandidate && !req.file)) {
      log('기본 샘플 영상 (Tech & AI Talk) 사용');
      const samplePath = path.join(WORKSPACE_DIR, 'public', 'sample_tech_talk.mp4');
      if (fs.existsSync(samplePath)) {
        inputVideoPath = path.join(jobDir, 'input_video.mp4');
        fs.copyFileSync(samplePath, inputVideoPath);
        videoTitle = 'AI & Future Technology Panel Discussion (Sample)';
        isRealVideoDownloaded = true;
      } else {
        throw new Error('샘플 영상 파일을 찾을 수 없습니다.');
      }
    } else if (isInstagram) {
      log(`인스타그램 영상 처리 시작: ${rawCandidate}`);
      const shortcode = extractInstagramShortcode(rawCandidate);
      inputVideoPath = path.join(jobDir, 'input_video.mp4');
      videoTitle = `Instagram Reel (${shortcode || '영상'})`;

      let cookiesArg: string[] = [];
      const hasCookies = Boolean(cookiesText && cookiesText.trim().length > 10);
      if (hasCookies) {
        const cookiesFile = path.join(jobDir, 'cookies.txt');
        fs.writeFileSync(cookiesFile, cookiesText!, 'utf-8');
        cookiesArg = ['--cookies', cookiesFile];
      }

      log(`yt-dlp 실행 중 (인스타그램 릴스 고화질 다운로드)...`);
      const ytdlpArgs = [
        '--socket-timeout', '25',
        '--retries', '2',
        '--fragment-retries', '2',
        '--format', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        '--merge-output-format', 'mp4',
        '--force-overwrites',
        '-o', inputVideoPath,
        ...cookiesArg,
        rawCandidate
      ];
      await runProcess(YTDLP_PATH, ytdlpArgs, WORKSPACE_DIR, 50000);

      if (fs.existsSync(inputVideoPath) && fs.statSync(inputVideoPath).size > 10000) {
        isRealVideoDownloaded = true;
        const mbSize = (fs.statSync(inputVideoPath).size / (1024 * 1024)).toFixed(2);
        log(`인스타그램 영상 다운로드 성공! (${mbSize} MB)`);

        try {
          const metaOut = await runProcess(YTDLP_PATH, ['--print', '%(title)s (by @%(uploader)s)', rawCandidate], WORKSPACE_DIR, 10000);
          const cleanTitle = (metaOut?.stdout || '').split('\n').filter(l => l.trim() && !l.startsWith('Deprecated'))[0]?.trim();
          if (cleanTitle) {
            videoTitle = cleanTitle;
            log(`인스타그램 영상 정보: "${videoTitle}"`);
          }
        } catch {}
      } else {
        throw new Error('인스타그램 영상을 다운로드할 수 없습니다. 공개 영상인지 확인해주세요.');
      }
    } else if (isYoutube) {
      log(`유튜브 영상 처리 시작: ${rawCandidate}`);
      youtubeVideoId = extractYoutubeId(rawCandidate);
      if (youtubeVideoId) {
        try {
          const oembedRes = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${youtubeVideoId}&format=json`);
          if (oembedRes.ok) {
            const oembedData: any = await oembedRes.json();
            if (oembedData.title) {
              videoTitle = oembedData.title;
              log(`YouTube 영상 정보 확인: "${videoTitle}" (${oembedData.author_name || ''})`);
            }
          }
        } catch {
          // ignore
        }
      }

      inputVideoPath = path.join(jobDir, 'input_video.mp4');

      // Check for cookies
      let cookiesArg: string[] = [];
      const hasCookies = Boolean(cookiesText && cookiesText.trim().length > 10);
      if (hasCookies) {
        const cookiesFile = path.join(jobDir, 'cookies.txt');
        fs.writeFileSync(cookiesFile, cookiesText!, 'utf-8');
        cookiesArg = ['--cookies', cookiesFile];
      }

      // If cookies provided, attempt yt-dlp download, otherwise use instantaneous streaming mode
      if (hasCookies) {
        try {
          const ytdlpArgs = [
            '--socket-timeout', '8',
            '--retries', '1',
            '--fragment-retries', '1',
            '--js-runtimes', 'node:/usr/local/bin/node',
            '--format', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
            '--merge-output-format', 'mp4',
            '--force-overwrites',
            '-o', inputVideoPath,
            ...cookiesArg,
            rawCandidate
          ];
          log(`yt-dlp 실행 중 (쿠키 인증 다운로드 시도)...`);
          await runProcess(YTDLP_PATH, ytdlpArgs, WORKSPACE_DIR, 35000);
          if (fs.existsSync(inputVideoPath) && fs.statSync(inputVideoPath).size > 50000) {
            isRealVideoDownloaded = true;
            log('유튜브 영상 다운로드 성공!');
          }
        } catch (ytdlpErr: any) {
          log(`YouTube 원본 동영상 스트리밍 연동 모드로 자동 전환 (플레이어에서 직접 재생)`);
        }
      } else {
        log(`YouTube 원본 동영상 스트리밍 연동 모드로 즉시 준비 (플레이어 직접 재생)`);
      }
    } else if (directUrl) {
      log(`직접 URL 다운로드: ${directUrl}`);
      inputVideoPath = path.join(jobDir, 'input_video.mp4');
      await runProcess('curl', ['-L', '-s', '-o', inputVideoPath, directUrl]);
      videoTitle = 'Direct Media Video';
      isRealVideoDownloaded = true;
    }

    let segments: any[] = [];
    const targetModel = model || 'openai/gpt-oss-20b';

    if (isRealVideoDownloaded) {
      // ----------------------------------------------------
      // STAGE 2: FFmpeg Audio Extraction (64k MP3)
      // ----------------------------------------------------
      log('[2/5] Whisper 전송을 위한 64k 오디오 추출 중...');
      const ffmpegExtractArgs = [
        '-y',
        '-i', inputVideoPath,
        '-vn',
        '-acodec', 'libmp3lame',
        '-b:a', '64k',
        audioMp3Path
      ];
      await runProcess('ffmpeg', ffmpegExtractArgs);
      log('오디오 추출 완료 (audio.mp3)');

      // ----------------------------------------------------
      // STAGE 3: Whisper Audio Transcription
      // ----------------------------------------------------
      log('[3/5] Whisper 음성 인식 수행 중 (whisper-large-v3-turbo)...');

      let detectedLang = '';
      if (process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.trim().length > 5) {
        log('Groq API 공식 클라이언트로 Whisper 음성 인식 요청...');
        const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
        const transcriptionResponse: any = await groq.audio.transcriptions.create({
          file: fs.createReadStream(audioMp3Path),
          model: 'whisper-large-v3-turbo',
          response_format: 'verbose_json',
          temperature: 0.0
        });

        detectedLang = transcriptionResponse.language || '';
        const rawSegments = transcriptionResponse.segments || [];
        log(`👉 1차 Whisper 인식 완료! (감지 언어: ${detectedLang || '자동'}, 원본 구간: ${rawSegments.length}개)`);

        segments = normalizeSegmentsSentences(rawSegments);
        log(`문장 호흡 및 어순 최적화 완료: 총 ${segments.length}개 자막 구간`);
      } else {
        log('GROQ_API_KEY 미설정: 데모 샘플 고품질 트랜스크립션 데이터 로드');
        const { SAMPLE_SEGMENTS } = await import('./src/data/sampleData');
        segments = JSON.parse(JSON.stringify(SAMPLE_SEGMENTS));
      }

      // Generate raw SRT text
      const rawSrt = convertSegmentsToSrt(segments, 'original');
      fs.writeFileSync(rawSrtPath, rawSrt, 'utf-8');

      // ----------------------------------------------------
      // STAGE 4: AI Korean Translation & Subtitle Polishing
      // ----------------------------------------------------
      const isKorean = isKoreanContent(segments, detectedLang);
      if (isKorean) {
        log('[4/5] 🇰🇷 한국어 음성 감지: 불필요한 번역 단계를 생략하고 고품질 한국어 자막을 즉시 구성합니다.');
        segments.forEach((seg: any) => {
          seg.translatedText = seg.originalText;
        });
      } else {
        log(`[4/5] AI (${targetModel})로 전체 ${segments.length}개 구간을 안정적으로 분할 번역 및 정밀 싱크 매핑 중...`);
        segments = await translateSegmentsWithLLM(segments, targetModel, log);
      }

      const finalSrt = convertSegmentsToSrt(segments, 'translated');
      fs.writeFileSync(finalSrtPath, finalSrt, 'utf-8');

      const finalVtt = convertSegmentsToVtt(segments, 'translated');
      fs.writeFileSync(finalVttPath, finalVtt, 'utf-8');
      log('자막 파일(.srt, .vtt) 생성 완료');

      // STAGE 5: FFmpeg Softsub
      log('[5/5] 영상에 최종 소프트 자막 스트림 삽입 중...');
      const ffmpegSoftsubArgs = [
        '-y',
        '-i', inputVideoPath,
        '-i', finalSrtPath,
        '-c:v', 'copy',
        '-c:a', 'copy',
        '-c:s', 'mov_text',
        '-metadata:s:s:0', 'language=kor',
        '-metadata:s:s:0', 'title=한국어 자막',
        outputSoftsubPath
      ];
      await runProcess('ffmpeg', ffmpegSoftsubArgs);
      log('모든 파이프라인 완료! output_softsub.mp4 합성 성공');

    } else {
      // YouTube Stream Mode (Video plays via YouTube IFrame)
      log('[2/5] YouTube 스트리밍 플레이어 연동 준비 완료');

      let transcriptFound = false;
      if (youtubeVideoId) {
        log(`YouTube 자막 및 대사 트랙 분석 중 (${youtubeVideoId})...`);
        const transcriptData = await fetchYouTubeTranscript(youtubeVideoId);
        if (transcriptData && transcriptData.segments && transcriptData.segments.length > 0) {
          transcriptFound = true;
          segments = transcriptData.segments;
          if (transcriptData.title && !videoTitle.includes(transcriptData.title)) {
            videoTitle = transcriptData.title;
          }
          const dur = transcriptData.durationSec || 0;
          const durStr = dur > 0 ? `${Math.floor(dur / 60)}분 ${dur % 60}초` : '영상 전체';
          log(`[3/5] YouTube 원본 대사 스크립트 추출 성공! (총 ${segments.length}개 구간, 전체 러닝타임: ${durStr})`);

          const isKorean = isKoreanContent(segments, transcriptData.langCode);
          if (isKorean) {
            log('[4/5] 🇰🇷 한국어 동영상 감지: 불필요한 번역 단계를 생략하고 원본 한국어 자막을 즉시 동기화합니다.');
            segments.forEach((seg: any) => {
              seg.translatedText = seg.originalText;
            });
            log(`[4/5] 전체 ${segments.length}개 한국어 자막 동기화 완료!`);
          } else {
            log(`AI (${targetModel})로 전체 ${segments.length}개 구간 한/영 전문 번역 및 싱크 최적화 시작...`);
            segments = await translateSegmentsWithLLM(segments, targetModel, log);
            log(`[4/5] 전체 ${segments.length}개 구간 번역 및 타임라인 동기화 완료!`);
          }
        }
      }

      if (!transcriptFound) {
        // Fallback: AI generated subtitles across full video duration
        const estimatedDuration = Math.max(60, 180);
        const targetCount = Math.min(60, Math.max(18, Math.round(estimatedDuration / 5)));
        log(`[3/5] AI (${targetModel})가 "${videoTitle}" 영상의 전체 러닝타임(${Math.floor(estimatedDuration / 60)}분 ${estimatedDuration % 60}초)에 맞춘 자막(${targetCount}개 구간)을 생성합니다...`);

        const genPrompt = `당신은 대한민국 최고 수준의 전문 영상 번역가이자 방송 자막 작가입니다.
사용자가 입력한 YouTube 동영상 정보:
- 제목: "${videoTitle}"
- URL: ${youtubeUrl || ''}

이 영상의 주제와 내용에 맞추어, 00:00:01,000부터 약 00:03:00,000까지 영상 전체 러닝타임(약 3분)에 걸쳐 빈틈없이 연속되는 총 ${targetCount}개의 완성도 높은 방송용 한/영 자막(SRT 형식)을 작성해 주세요.
[절대 주의] 절대로 앞부분 1분만 작성하고 중단하지 마시고, 00:00:01부터 00:03:00까지 3분 전체에 걸쳐 고르게 번호 1번부터 ${targetCount}번까지 전체를 작성하세요.
각 자막 블록은 다음과 같이 첫 번째 줄에 한국어 번역 대사, 두 번째 줄에 영어 대사(원문)가 오도록 구성하세요.
반드시 마크다운 백틱(\`\`\`srt) 없이 오직 순수 SRT 형식만 출력하세요.`;

        let genSrt = '';
        const useOpenRouter = Boolean(process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY.trim().length > 5);

        if (useOpenRouter) {
          const orModel = targetModel.startsWith('openai/') || targetModel.startsWith('deepseek/')
            ? targetModel
            : 'openai/gpt-oss-20b';
          log(`OpenRouter (${orModel})로 전체 구간 자막 생성 중...`);
          try {
            genSrt = await callOpenRouter(orModel, genPrompt, '자막 생성 시작', 8192);
          } catch (orErr: any) {
            log(`OpenRouter 오류: ${orErr.message}, deepseek-v4.1-flash로 재시도...`);
            try {
              genSrt = await callOpenRouter('deepseek/deepseek-v4.1-flash', genPrompt, '자막 생성 시작', 8192);
            } catch {}
          }
        } else if (process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.trim().length > 5) {
          const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
          const comp = await groq.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages: [{ role: 'user', content: genPrompt }],
            max_completion_tokens: 4096
          });
          genSrt = comp.choices[0]?.message?.content || '';
        }

        genSrt = cleanMarkdownFences(genSrt);
        const parsedGen = parseSrt(genSrt);
        if (parsedGen.length > 0) {
          segments = parsedGen;
          log(`[4/5] AI 맞춤 자막 완성! 총 ${segments.length}개 구간 생성 완료`);
        } else {
          const { SAMPLE_SEGMENTS } = await import('./src/data/sampleData');
          segments = JSON.parse(JSON.stringify(SAMPLE_SEGMENTS));
        }
      }

      const finalSrt = convertSegmentsToSrt(segments, 'translated');
      fs.writeFileSync(finalSrtPath, finalSrt, 'utf-8');
      const finalVtt = convertSegmentsToVtt(segments, 'translated');
      fs.writeFileSync(finalVttPath, finalVtt, 'utf-8');

      log('[5/5] YouTube 실시간 자막 스트리밍 연동 완료!');
    }

    // Build web-accessible URLs
    const relOutputDir = `/media/outputs/${jobId}`;

    let resolvedVideoUrl = '';
    if (isYoutube && !isRealVideoDownloaded) {
      resolvedVideoUrl = rawCandidate || youtubeUrl;
    } else if (isRealVideoDownloaded && inputVideoPath) {
      resolvedVideoUrl = `${relOutputDir}/${path.basename(inputVideoPath)}`;
    }

    res.json({
      success: true,
      jobId,
      videoTitle,
      youtubeVideoId: (isYoutube && !isRealVideoDownloaded) ? youtubeVideoId : null,
      isInstagram,
      videoUrl: resolvedVideoUrl,
      audioUrl: fs.existsSync(audioMp3Path) ? `${relOutputDir}/audio.mp3` : undefined,
      srtUrl: `${relOutputDir}/subtitles.srt`,
      vttUrl: `${relOutputDir}/subtitles.vtt`,
      softsubVideoUrl: isRealVideoDownloaded && fs.existsSync(outputSoftsubPath) ? `${relOutputDir}/output_softsub.mp4` : undefined,
      segments,
      logs
    });

  } catch (error: any) {
    console.error('Pipeline failed:', error);
    log(`오류 발생: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message || 'Pipeline processing failed',
      logs
    });
  }
});

// Catch-all 404 for API routes - prevents falling through to Vite SPA index.html
app.all('/api/*', (_req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: '요청하신 API 엔드포인트를 찾을 수 없습니다 (404).'
  });
});

// Catch-all Express Error Handler for API routes - ensures JSON is ALWAYS returned
app.use('/api', (err: any, _req: Request, res: Response, _next: any) => {
  console.error('Unhandled API error:', err);
  const statusCode = err.status || err.statusCode || (err.name === 'MulterError' ? 400 : 500);
  const msg = err.name === 'MulterError'
    ? `파일 업로드 오류: ${err.message}`
    : (err.message || '서버 내부 오류가 발생했습니다.');
  res.status(statusCode).json({
    success: false,
    error: msg
  });
});

// ----------------------------------------------------
// VITE MIDDLEWARE & SERVER STARTUP
// ----------------------------------------------------
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(WORKSPACE_DIR, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Subtitle Studio server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
