// 밴드 기록 꾸미기 기본값(원형). 해석은 src/renderers/band/style.ts
import type { DocStyle } from "./types";

/** 밴드 원형 기본값. 실제 밴드 글 상세 캡처(600px 상세창, 인장 40/34/24px)를 기준으로 잡았다 */
export function defaultDocStyle(): DocStyle {
  return {
    version: 1,
    documentTheme: "app",
    commentSkin: "band",
    avatar: {
      shape: "circle",
      radius: 10,
      sizes: { post: 40, comment: 34, reply: 24, profile: 96 },
      borderWidth: 0,
      borderColor: null,
      shadow: "none",
      fit: "cover",
      repeat: "every",
      fallback: "initial",
    },
    typography: {
      name: { size: 14, weight: 700 },
      desc: { size: 12 },
      body: { size: 15, lineHeight: 1.6 },
      comment: { size: 14, lineHeight: 1.55 },
      meta: { size: 12 },
    },
    colors: { background: null, surface: null, commentSurface: null, text: null, mention: null },
    comments: { replyIndent: 44, dividers: true, bubbleTail: "small", bubbleRadius: 14 },
  };
}

