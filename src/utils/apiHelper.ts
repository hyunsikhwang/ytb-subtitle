/**
 * Safe API request helper to prevent "Unexpected token '<', <!... is not valid JSON"
 * and extract actionable error messages even when Nginx, Cloud Run, or Express return HTML.
 */

export interface SafeApiResponse<T = any> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

export async function safeFetchJson<T = any>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<SafeApiResponse<T>> {
  try {
    const response = await fetch(input, init);
    const contentType = response.headers.get('content-type') || '';
    let parsedData: any = null;

    if (contentType.includes('application/json')) {
      try {
        parsedData = await response.json();
      } catch {
        parsedData = null;
      }
    }

    if (!response.ok) {
      if (parsedData && parsedData.error) {
        return {
          ok: false,
          status: response.status,
          data: parsedData,
          error: parsedData.error
        };
      }

      // If response is HTML or text, extract human-readable error
      const rawText = await response.text().catch(() => '');
      let errorMsg = `서버 오류 (${response.status})`;

      if (response.status === 504 || rawText.includes('504 Gateway') || /time-?out/i.test(rawText)) {
        errorMsg = '서버 처리 시간이 초과되었습니다 (504 Gateway Timeout). 영상 길이를 줄이거나 잠시 후 다시 시도해 주세요.';
      } else if (response.status === 502 || rawText.includes('502 Bad Gateway')) {
        errorMsg = '서버와 일시적으로 연결할 수 없습니다 (502 Bad Gateway). 잠시 후 다시 시도해 주세요.';
      } else if (response.status === 413 || rawText.includes('413') || /too large/i.test(rawText)) {
        errorMsg = '업로드 파일 크기가 서버 제한을 초과했습니다 (최대 250MB).';
      } else if (response.status === 404) {
        errorMsg = '요청하신 서버 엔드포인트를 찾을 수 없습니다 (404).';
      } else if (response.status === 400 && rawText) {
        errorMsg = rawText.length < 200 ? rawText : '잘못된 요청 형식입니다 (400).';
      } else {
        errorMsg = response.statusText ? `${errorMsg}: ${response.statusText}` : `${errorMsg}: 처리에 실패했습니다.`;
      }

      return {
        ok: false,
        status: response.status,
        error: errorMsg
      };
    }

    if (!parsedData) {
      // If 200 OK but not JSON
      const rawText = await response.text().catch(() => '');
      if (rawText.startsWith('<!doctype') || rawText.startsWith('<!DOCTYPE') || rawText.includes('<html')) {
        return {
          ok: false,
          status: response.status,
          error: '서버 응답이 JSON 형식이 아닙니다 (Vite SPA 또는 HTML 응답 수신).'
        };
      }
      return {
        ok: false,
        status: response.status,
        error: '서버로부터 유효하지 않은 응답 데이터를 받았습니다.'
      };
    }

    if (parsedData.success === false) {
      return {
        ok: false,
        status: response.status,
        data: parsedData,
        error: parsedData.error || '작업 처리에 실패했습니다.'
      };
    }

    return {
      ok: true,
      status: response.status,
      data: parsedData
    };
  } catch (err: any) {
    console.error('safeFetchJson network error:', err);
    return {
      ok: false,
      status: 0,
      error: err.message || '네트워크 통신 오류가 발생했습니다.'
    };
  }
}
