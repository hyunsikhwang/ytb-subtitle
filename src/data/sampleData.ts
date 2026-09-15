import { SubtitleSegment } from '../types';

export const SAMPLE_SEGMENTS: SubtitleSegment[] = [
  {
    id: 1,
    start: 0.5,
    end: 4.8,
    startTime: '00:00:00,500',
    endTime: '00:00:04,800',
    originalText: "Today we are discussing the next frontier of artificial intelligence with leading researchers.",
    translatedText: "오늘 우리는 주요 연구원들과 함께 인공지능의 차세대 개척 분야에 대해 논의해 봅니다."
  },
  {
    id: 2,
    start: 5.2,
    end: 9.6,
    startTime: '00:00:05,200',
    endTime: '00:00:09,600',
    originalText: "OpenAI and Sam Altman have emphasized the accelerating transition toward autonomous reasoning models.",
    translatedText: "OpenAI와 샘 올트먼은 자율 추론 모델로의 전환이 가속화되고 있음을 강조했습니다."
  },
  {
    id: 3,
    start: 10.1,
    end: 14.5,
    startTime: '00:00:10,100',
    endTime: '00:00:14,500',
    originalText: "What makes these new architectures different is their ability to think step-by-step before answering.",
    translatedText: "새로운 아키텍처의 차별점은 답변하기 전 단계별로 심층 사고할 수 있는 능력에 있습니다."
  },
  {
    id: 4,
    start: 15.0,
    end: 19.8,
    startTime: '00:00:15,000',
    endTime: '00:00:19,800',
    originalText: "Anthropic and Claude have also introduced remarkable capabilities in constitutional safety and code synthesis.",
    translatedText: "Anthropic의 Claude 역시 헌법적 안전성과 코드 합성 분야에서 괄목할 만한 역량을 선보였습니다."
  },
  {
    id: 5,
    start: 20.3,
    end: 24.9,
    startTime: '00:00:20,300',
    endTime: '00:00:24,900',
    originalText: "Groq's LPU inference engines are delivering ultra-fast token generation, changing real-time voice and video pipelines.",
    translatedText: "Groq의 LPU 추론 엔진은 초고속 토큰 생성을 통해 실시간 음성 및 영상 파이프라인의 패러다임을 바꾸고 있습니다."
  },
  {
    id: 6,
    start: 25.4,
    end: 30.2,
    startTime: '00:00:25,400',
    endTime: '00:00:30,200',
    originalText: "By combining Whisper audio extraction with specialized LLM translation, we achieve broadcaster-level accuracy.",
    translatedText: "Whisper 음성 추출과 전문 LLM 번역을 결합하여 방송 뉴스 수준의 정밀한 자막을 구현할 수 있습니다."
  },
  {
    id: 7,
    start: 30.8,
    end: 36.5,
    startTime: '00:00:30,800',
    endTime: '00:00:36,500',
    originalText: "Every timestamp is preserved to the exact millisecond while translating contextual nuances cleanly.",
    translatedText: "문맥의 뉘앙스를 깔끔하게 전달하는 동시에 모든 타임스탬프를 1밀리초 단위까지 온전히 보존합니다."
  },
  {
    id: 8,
    start: 37.1,
    end: 42.0,
    startTime: '00:00:37,100',
    endTime: '00:00:42,000',
    originalText: "Users can now edit any segment directly, fine-tune subtitle timing, and instantly re-mux into the final video.",
    translatedText: "이제 사용자는 구간별 스크립트를 직접 편집하고 타이밍을 미세 조정한 뒤 최종 영상으로 즉시 재합성할 수 있습니다."
  },
  {
    id: 9,
    start: 42.6,
    end: 48.0,
    startTime: '00:00:42,600',
    endTime: '00:00:48,000',
    originalText: "This marks a dramatic breakthrough in automated international media localization.",
    translatedText: "이는 글로벌 미디어의 현지화 자동화에 있어 비약적인 기술적 도약으로 평가받고 있습니다."
  },
  {
    id: 10,
    start: 48.5,
    end: 55.0,
    startTime: '00:00:48,500',
    endTime: '00:00:55,000',
    originalText: "Thank you for watching, and stay tuned for more developments in AI subtitle generation.",
    translatedText: "시청해 주셔서 감사드리며, AI 자막 생성 기술의 향후 발전 소식도 계속 전해드리겠습니다."
  }
];

export const PROMPT_SAMPLE_YOUTUBE_URL = "https://www.youtube.com/watch?v=ctWJw8sQghk";
