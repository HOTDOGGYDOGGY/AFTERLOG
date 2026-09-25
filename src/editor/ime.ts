/** 한글 조합 중인 입력 개수. 조합 중에는 자동 저장·재렌더링으로 글자가 깨지지 않게 미룬다. */
export const ime = { composing: 0 };

/** 마지막으로 커서가 있던 텍스트 블록 위치 (항목 나누기에 사용) */
export const caret: { entryId: string | null; blockIndex: number; offset: number } = { entryId: null, blockIndex: -1, offset: 0 };
