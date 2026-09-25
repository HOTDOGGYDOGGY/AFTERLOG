// 빌드 때 정해지는 값. 테스트 빌드는 가짜 밴드 서버(localhost)를 허용한다.
declare const __AL_BAND_ORIGINS__: string[];
declare const __AL_MIN_DELAY_MS__: number;
declare const __AL_COLLECTOR_VERSION__: string;
declare const __AL_PAGE_TIMEOUT_MS__: number;

export const BAND_ORIGINS: string[] = typeof __AL_BAND_ORIGINS__ !== "undefined" ? __AL_BAND_ORIGINS__ : ["https://band.us", "https://www.band.us"];
/** 추가 로딩·페이지 이동 사이 최소 대기(명세 8.3: 1.5~3초). 테스트 빌드만 짧다 */
export const MIN_DELAY_MS: number = typeof __AL_MIN_DELAY_MS__ !== "undefined" ? __AL_MIN_DELAY_MS__ : 1500;
export const COLLECTOR_VERSION: string = typeof __AL_COLLECTOR_VERSION__ !== "undefined" ? __AL_COLLECTOR_VERSION__ : "0.0.0-dev";

export const LIMITS = {
  /** 일시적인 오류 재시도: 원 시도 후 최대 3회 */
  maxRetries: 3,
  /** 같은 종류의 오류가 연속으로 이만큼 나면 자동 일시정지 */
  sameErrorPause: 3,
  /** 목록에서 새 글이 안 나오는 스크롤 횟수 → 끝 확인 불가 */
  emptyRoundsToStop: 3,
  maxListRounds: 400,
  /** 첨부 동시 처리 */
  assetConcurrency: 2,
  /** 한 과제의 점유 시간(이 시간이 지나면 멈춘 것으로 보고 다시 대기열로) */
  leaseMs: 3 * 60 * 1000,
  pageTimeoutMs: typeof __AL_PAGE_TIMEOUT_MS__ !== "undefined" ? __AL_PAGE_TIMEOUT_MS__ : 25_000,
};
