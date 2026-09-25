// 앱 전체에서 쓰는 선형 아이콘 한 벌(로컬 번들, 24px 격자, 1.6 선). 이모지·문자 기호와 섞지 않는다.
import type { SVGProps } from "react";

const PATHS = {
  smile: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-3.5-7.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01",
  comment: "M4 5h16v11H9l-5 4V5Z",
  close: "M6 6l12 12M18 6 6 18",
  back: "M15 5l-7 7 7 7",
  more: "M12 5h.01M12 12h.01M12 19h.01",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5-2 4 4",
  undo: "M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3",
  redo: "m15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h3",
  chevronDown: "m6 9 6 6 6-6",
  image: "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15.5 9h.01",
  download: "M12 4v11m0 0-4-4m4 4 4-4M5 20h14",
  upload: "M12 20V9m0 0-4 4m4-4 4 4M5 4h14",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2-1.2L14.5 3h-4l-.4 2.6a7.5 7.5 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7.5 7.5 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z",
  brush: "M14 4l6 6-8.5 8.5a3 3 0 0 1-4.2 0L7 18a3 3 0 0 1 0-4.2L14 4ZM4 20c1.5 0 3-.5 3-2",
  edit: "M4 20h4L19 9l-4-4L4 16v4Zm9-13 4 4",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  source: "M8 7 3 12l5 5M16 7l5 5-5 5M14 4l-4 16",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0",
  users: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 9a6 6 0 0 1 12 0M16 4.5a3.5 3.5 0 0 1 0 6.5M21 20a6 6 0 0 0-4-5.6",
  chat: "M4 5h16v10H13l-4 4v-4H4V5Z",
  list: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  folder: "M3 6h6l2 2h10v11H3V6Z",
  plus: "M12 5v14M5 12h14",
  heart: "M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z",
  paperclip: "M20 11.5 12.5 19a5 5 0 0 1-7-7L13 4.5a3.3 3.3 0 0 1 4.7 4.7L10.3 16.6a1.7 1.7 0 0 1-2.4-2.4L14.5 7.6",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-11v6m0-9h.01",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0-15v2m0 16v2M4.2 4.2l1.4 1.4m12.8 12.8 1.4 1.4M2 12h2m16 0h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  moon: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z",
  menu: "M4 7h16M4 12h16M4 17h16",
  drag: "M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="ui-icon"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
