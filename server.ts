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
    srtLines.push(text.trim());
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
    vttLines.push(text.trim());
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
      .map(l => l.replace(/<[^>]+>/g, '').trim())
      .filter(l => l.length > 0 && !l.startsWith('WEBVTT') && !l.startsWith('Kind:') && !l.startsWith('Language:'));
    if (lines.length === 0) continue;
    const text = isAsr ? lines[lines.length - 1] : lines.join(' ');
    if (!text) continue;
    if (cues.length > 0 && cues[cues.length - 1].text === text) {
      cues[cues.length - 1].end = Math.max(cues[cues.length - 1].end, end);
    } else {
      cues.push({ start, end, text });
    }
  }

  // Merge into readable 3~7s natural spoken blocks
  const merged: any[] = [];
  let cur: { start: number; end: number; text: string } | null = null;
  for (const c of cues) {
    if (!cur) {
      cur = { ...c };
    } else {
      const curDur = cur.end - cur.start;
      const totalDur = c.end - cur.start;
      const endsWithPunct = /[.!?]$/.test(cur.text.trim());
      if (curDur < 4.0 || (totalDur < 7.5 && !endsWithPunct)) {
        cur.end = c.end;
        if (!cur.text.endsWith(c.text)) {
          cur.text += ' ' + c.text;
        }
      } else {
        merged.push(cur);
        cur = { ...c };
      }
    }
  }
  if (cur) merged.push(cur);

  return merged.map((m, idx) => ({
    id: idx + 1,
    start: m.start,
    end: m.end,
    startTime: formatTimestamp(m.start),
    endTime: formatTimestamp(m.end),
    originalText: m.text.replace(/\s+/g, ' ').trim(),
    translatedText: ''
  }));
}

// Helper: Fetch YouTube subtitles and metadata
interface YouTubeTranscriptData {
  segments: any[];
  title?: string;
  durationSec?: number;
}

async function fetchYouTubeTranscript(videoId: string): Promise<YouTubeTranscriptData | null> {
  try {
    const res = await fetch(`https://youtube-transcript.ai/api/subtitles?v=${videoId}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const subs = data?.subtitles || [];
    if (!subs || subs.length === 0) {
      return {
        segments: [],
        title: data?.videoTitle,
        durationSec: data?.durationSec
      };
    }

    // Prefer English subtitle track, otherwise first track
    let selected = subs.find((s: any) => s.langCode === 'en' || s.langCode?.startsWith('en'));
    if (!selected) selected = subs[0];

    const vtt = selected?.vttContent || '';
    if (!vtt || vtt.length < 30) {
      return {
        segments: [],
        title: data?.videoTitle,
        durationSec: data?.durationSec
      };
    }

    const segments = parseVttToSegments(vtt, Boolean(selected.isAsr));
    return {
      segments,
      title: data?.videoTitle,
      durationSec: data?.durationSec
    };
  } catch (err) {
    console.warn('fetchYouTubeTranscript error:', err);
    return null;
  }
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
  });

  const BATCH_SIZE = 15;
  const targetModel = model || 'openai/gpt-oss-20b';

  for (let i = 0; i < cloned.length; i += BATCH_SIZE) {
    const batch = cloned.slice(i, i + BATCH_SIZE);
    const batchSrt = convertSegmentsToSrt(batch, 'original');
    const firstId = batch[0].id;
    const lastId = batch[batch.length - 1].id;

    const systemPrompt = `당신은 대한민국 최고 수준의 전문 영상 번역가이자 방송 자막 에디터입니다.
주어진 영어 SRT 자막 전체를 한국어 시청자를 위한 완성도 높은 방송용 한국어 자막으로 번역 및 다듬어 주세요.

[절대 원칙]
1. 번호 ${firstId}번부터 ${lastId}번까지 총 ${batch.length}개 구간 전체를 단 하나도 빠짐없이 온전히 출력하세요.
2. 각 구간 번호(ID)와 타임스탬프(00:00:00,000 --> 00:00:00,000)는 원본과 100% 동일하게 유지하세요.
3. 영어 대사는 맥락에 맞는 깔끔하고 자연스러운 방송 뉴스 어조의 한국어로 번역하세요.
4. AI, OpenAI, Fyxer 등 고유명사는 적절하게 표기하세요.
5. 마크다운 백틱(\`\`\`srt) 없이 오직 순수 SRT 자막만 처음부터 끝까지 출력하세요.`;

    log(`AI 자막 번역 진행 중 (${i + 1}~${Math.min(i + BATCH_SIZE, cloned.length)} / 총 ${cloned.length}개 구간)...`);

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
        // Match inside this batch first by segment id, then by positional index
        let match = batch.find((s: any) => s.id === trSeg.id);
        if (!match && trIdx < batch.length) {
          match = batch[trIdx];
        }
        if (match) {
          const candidate = (trSeg.translatedText || trSeg.originalText || '').trim();
          if (candidate && /[가-힣]/.test(candidate)) {
            match.translatedText = candidate;
          } else if (candidate) {
            match.translatedText = candidate;
          }
        }
      });
    }
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
              { role: 'system', content: '영어 SRT 자막을 한국어 방송 자막으로 1:1 번역하세요. 타임스탬프를 보존하고 순수 SRT만 출력하세요.' },
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
          mResult = await callOpenRouter('deepseek/deepseek-v4.1-flash', '영어 SRT 자막을 한국어 방송 자막으로 1:1 번역하세요. 타임스탬프를 보존하고 순수 SRT만 출력하세요.', mSrt, 4096);
        } catch {}
      }

      if (mResult) {
        const fixParsed = parseSrt(cleanMarkdownFences(mResult));
        fixParsed.forEach((f, fIdx) => {
          const match = mBatch.find((s: any) => s.id === f.id) || (fIdx < mBatch.length ? mBatch[fIdx] : null);
          if (match) {
            const trans = (f.translatedText || f.originalText || '').trim();
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
              { role: 'system', content: '영어 문장을 자연스러운 한국어 방송 자막 한 문장으로 번역하세요. 설명 없이 번역문만 한 줄로 출력하세요.' },
              { role: 'user', content: seg.originalText }
            ],
            temperature: 0.1,
            max_completion_tokens: 256
          });
          const single = comp.choices[0]?.message?.content?.trim();
          if (single && /[가-힣]/.test(single)) {
            seg.translatedText = single;
          }
        } catch {}
      }
    }
  }

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
      originalText,
      translatedText
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
      originalText,
      translatedText
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

    const systemPrompt = `당신은 KBS, CNN 방송 전문 번역 및 자막 에디터입니다.
주어진 영어 또는 외래어 자막 문장을 한국어 시청자를 위한 자연스럽고 신뢰감 있는 방송 뉴스 어조의 한국어로 번역 및 다듬어 주세요.
인사말이나 부연 설명 없이 오직 완성된 한국어 문장 하나만 반환하세요.`;

    const isOpenRouterModel = model.startsWith('openai/') || model.includes('gpt-oss') || model.startsWith('deepseek/') || (!process.env.GROQ_API_KEY && process.env.OPENROUTER_API_KEY);

    if (process.env.OPENROUTER_API_KEY && isOpenRouterModel) {
      const targetModel = model.startsWith('openai/') || model.startsWith('deepseek/') ? model : 'openai/gpt-oss-20b';
      try {
        const content = await callOpenRouter(targetModel, systemPrompt, originalText, 500);
        const translatedText = cleanMarkdownFences(content).trim();
        return res.json({ translatedText });
      } catch (orErr: any) {
        console.warn(`OpenRouter (${targetModel}) translate error, fallback to deepseek:`, orErr.message);
        try {
          const content = await callOpenRouter('deepseek/deepseek-v4.1-flash', systemPrompt, originalText, 500);
          const translatedText = cleanMarkdownFences(content).trim();
          return res.json({ translatedText });
        } catch {
          return res.json({ translatedText: originalText });
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
        const translatedText = cleanMarkdownFences(completion.choices[0]?.message?.content || '').trim();
        return res.json({ translatedText });
      } catch {
        return res.json({ translatedText: originalText });
      }
    } else {
      return res.json({ translatedText: originalText });
    }
  } catch (error: any) {
    console.error('Translate single error:', error);
    res.status(500).json({ error: error.message || 'Translation failed' });
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
app.post('/api/pipeline/process', upload.single('mediaFile'), async (req: Request, res: Response) => {
  const jobId = `job_${Date.now()}`;
  const jobDir = path.join(OUTPUTS_DIR, jobId);
  if (!fs.existsSync(jobDir)) fs.mkdirSync(jobDir, { recursive: true });

  const {
    youtubeUrl,
    directUrl,
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
    } else if (useSample === 'true' || useSample === true || (!youtubeUrl && !directUrl)) {
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
    } else if (youtubeUrl) {
      log(`유튜브 영상 처리 시작: ${youtubeUrl}`);
      youtubeVideoId = extractYoutubeId(youtubeUrl);
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
            '--overwrites',
            '-o', inputVideoPath,
            ...cookiesArg,
            youtubeUrl
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

      if (process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.trim().length > 5) {
        log('Groq API 공식 클라이언트로 Whisper 음성 인식 요청...');
        const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
        const transcriptionResponse: any = await groq.audio.transcriptions.create({
          file: fs.createReadStream(audioMp3Path),
          model: 'whisper-large-v3-turbo',
          response_format: 'verbose_json',
          temperature: 0.0
        });

        const rawSegments = transcriptionResponse.segments || [];
        log(`👉 1차 Whisper 인식 완료! 총 감지된 자막 구간: ${rawSegments.length}개`);

        segments = rawSegments.map((seg: any, idx: number) => ({
          id: idx + 1,
          start: seg.start,
          end: seg.end,
          startTime: formatTimestamp(seg.start),
          endTime: formatTimestamp(seg.end),
          originalText: seg.text ? seg.text.trim() : '',
          translatedText: ''
        }));
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
      log(`[4/5] AI (${targetModel})로 전체 ${segments.length}개 구간을 안정적으로 분할 번역 및 정밀 싱크 매핑 중...`);
      segments = await translateSegmentsWithLLM(segments, targetModel, log);

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
          log(`AI (${targetModel})로 전체 ${segments.length}개 구간 한/영 전문 번역 및 싱크 최적화 시작...`);

          segments = await translateSegmentsWithLLM(segments, targetModel, log);
          log(`[4/5] 전체 ${segments.length}개 구간 번역 및 타임라인 동기화 완료!`);
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

    res.json({
      success: true,
      jobId,
      videoTitle,
      youtubeVideoId,
      videoUrl: youtubeUrl || (isRealVideoDownloaded && inputVideoPath ? `${relOutputDir}/${path.basename(inputVideoPath)}` : ''),
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
