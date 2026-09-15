export interface SubtitleSegment {
  id: number;
  start: number; // in seconds, e.g. 1.25
  end: number;   // in seconds, e.g. 4.80
  startTime: string; // "00:00:01,250"
  endTime: string;   // "00:00:04,800"
  originalText: string;
  translatedText: string;
}

export type PipelineStage = 
  | 'idle'
  | 'downloading'
  | 'extracting_audio'
  | 'transcribing'
  | 'translating'
  | 'synthesizing'
  | 'completed'
  | 'error';

export interface PipelineProgress {
  stage: PipelineStage;
  stageIndex: number; // 0 to 5
  totalStages: number;
  percentage: number;
  message: string;
  details?: string;
  error?: string;
}

export interface VideoMetadata {
  id: string;
  title: string;
  sourceType: 'youtube' | 'upload' | 'sample' | 'url';
  originalUrl?: string;
  videoUrl: string;
  audioUrl?: string;
  softsubVideoUrl?: string;
  duration?: number;
}

export interface TranslationSettings {
  model: 'deepseek/deepseek-v4.1-flash' | 'openai/gpt-oss-20b' | 'llama-3.3-70b-versatile' | 'llama-3.1-8b-instant';
  systemPromptPreset: 'broadcast' | 'natural' | 'literal' | 'technical';
  customSystemPrompt?: string;
  dualSubtitles: boolean;
}

export interface ServerStatus {
  hasGroqKey: boolean;
  hasOpenRouterKey: boolean;
  activeEngine: 'openrouter' | 'groq' | 'demo';
  availableModels: string[];
}
