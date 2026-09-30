// 사진 크게 보기(디자인 참고 05: 격자는 잘라 보여도 상세는 원본 비율 그대로). 좌우 이동·Esc 닫기·원래 위치로 가는 링크.
// 클래스 lightbox는 밴드 레이어의 Esc 닫기가 건너뛰는 표식이다.
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../../components/Icon";

export interface LightboxItem {
  url: string;
  /** 한 줄 설명(어디의 사진인지) */
  caption: string;
  /** 원래 위치로(글·댓글·프로필) 또는 온라인 원본 */
  links?: { label: string; onClick?(): void; href?: string }[];
  /** 부가 표기(축소본, 여러 곳에서 쓰임 등) */
  note?: string;
}

export function Lightbox({ items, index, onIndex, onClose }: { items: LightboxItem[]; index: number; onIndex(i: number): void; onClose(): void }) {
  const cur = items[index];
  const n = items.length;
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      } else if (e.key === "ArrowLeft" && n > 1) onIndex((index - 1 + n) % n);
      else if (e.key === "ArrowRight" && n > 1) onIndex((index + 1) % n);
    };
    window.addEventListener("keydown", on, true);
    return () => window.removeEventListener("keydown", on, true);
  }, [index, n, onIndex, onClose]);
  if (!cur) return null;
  // 레이어·서랍의 transform 안에 갇히지 않도록 문서 맨 위에 띄운다
  return createPortal(
    <div className="lightbox al-lightbox" role="dialog" aria-modal="true" aria-label="사진 크게 보기" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <figure className="al-lb-figure">
        <img src={cur.url} alt={cur.caption} />
        <figcaption>
          <span className="al-lb-count">
            {index + 1} / {n}
          </span>
          <span className="al-lb-caption">{cur.caption}</span>
          {cur.note ? <span className="al-lb-note">{cur.note}</span> : null}
          {cur.links?.map((l) =>
            l.href ? (
              <a key={l.label} href={l.href} target="_blank" rel="noreferrer">
                {l.label}
              </a>
            ) : (
              <button key={l.label} type="button" className="ui-link" onClick={l.onClick}>
                {l.label}
              </button>
            ),
          )}
        </figcaption>
      </figure>
      {n > 1 ? (
        <>
          <button type="button" className="al-lb-nav is-prev" aria-label="이전 사진" onClick={() => onIndex((index - 1 + n) % n)}>
            <Icon name="back" size={26} />
          </button>
          <button type="button" className="al-lb-nav is-next" aria-label="다음 사진" onClick={() => onIndex((index + 1) % n)}>
            <Icon name="back" size={26} />
          </button>
        </>
      ) : null}
      <button type="button" className="band-layer-close" aria-label="닫기" onClick={onClose} autoFocus>
        <Icon name="close" size={26} />
      </button>
    </div>,
    document.body,
  );
}
