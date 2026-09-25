// 공통 셸: 상단바(48px) + 플랫폼 전환줄(40px). 프로젝트·플랫폼 전환·프로젝트 저장·설정만 공통으로 담당하고,
// 기록 화면의 배치는 각 플랫폼 모듈이 정한다(명세 v1.2 27.1). 모듈별 버튼(실행취소·꾸미기·내보내기 등)은
// 슬롯에 포털로 넣는다: 활성 모듈만 넣으므로 숨은 모듈의 버튼·단축키가 섞이지 않는다.
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../../components/Icon";
import { MenuButton, type MenuItem } from "../../components/Menu";
import { PLATFORMS, STATUS_LABEL, platformOf, type PlatformId } from "./platforms";
import type { AppThemeMode } from "./useAppTheme";

export interface ShellSlots {
  status: HTMLElement | null;
  actions: HTMLElement | null;
  primary: HTMLElement | null;
  platformTools: HTMLElement | null;
}

const SlotCtx = createContext<ShellSlots>({ status: null, actions: null, primary: null, platformTools: null });

/** 활성 모듈이 상단바 슬롯에 자기 버튼을 넣는다 */
export function ShellSlot({ name, children }: { name: keyof ShellSlots; children: ReactNode }) {
  const slots = useContext(SlotCtx);
  const el = slots[name];
  return el ? createPortal(children, el) : null;
}

export interface ShellProps {
  platform: PlatformId;
  onPlatform(p: PlatformId): void;
  projectTitle: string | null;
  onOpenProjects(): void;
  onHome(): void;
  saveItems: () => MenuItem[];
  canSave: boolean;
  themeMode: AppThemeMode;
  onThemeMode(m: AppThemeMode): void;
  children: ReactNode;
}

const THEME_LABEL: Record<AppThemeMode, string> = { dark: "다크", light: "라이트", system: "시스템 설정 따름" };

export function Shell(p: ShellProps) {
  const [slots, setSlots] = useState<ShellSlots>({ status: null, actions: null, primary: null, platformTools: null });
  // 슬롯 ref 콜백은 한 번만 만든다(매번 새 함수면 null→요소로 다시 불려 상태가 계속 바뀜)
  const refs = useMemo(() => {
    const make = (k: keyof ShellSlots) => (el: HTMLElement | null) => {
      if (el) setSlots((s) => (s[k] === el ? s : { ...s, [k]: el }));
    };
    return { status: make("status"), actions: make("actions"), primary: make("primary"), platformTools: make("platformTools") };
  }, []);
  const ref = (k: keyof ShellSlots) => refs[k];
  const cur = platformOf(p.platform);
  return (
    <SlotCtx.Provider value={slots}>
      <div className={`app-shell platform-${p.platform}`}>
        <header className="topbar">
          <button type="button" className="brand" onClick={p.onHome} title="처음 화면(현재 플랫폼의 첫 화면)">
            AFTERLOG
          </button>
          <button type="button" className="project-switch" onClick={p.onOpenProjects} aria-haspopup="dialog" title="프로젝트 보관함 열기">
            <span className="ellipsis">{p.projectTitle ?? "프로젝트 없음"}</span>
            <Icon name="chevronDown" size={14} />
          </button>
          <span className="topbar-status" ref={ref("status")} />
          <span className="spacer" />
          <div className="topbar-actions" ref={ref("actions")} />
          <MenuButton className="ui-btn topbar-save" label="프로젝트 저장" title="프로젝트 파일(.afterlog)로 저장" items={p.saveItems}>
            <Icon name="download" size={16} />
            <span className="hide-narrow">프로젝트 저장</span>
          </MenuButton>
          <div className="topbar-primary" ref={ref("primary")} />
          <MenuButton
            className="ui-icon-btn"
            label="설정"
            align="right"
            items={() => [
              ...(["dark", "light", "system"] as const).map((m) => ({ label: `화면 테마: ${THEME_LABEL[m]}`, checked: p.themeMode === m, onSelect: () => p.onThemeMode(m) })),
              { separator: true, label: "" },
              { label: "수집 확장 받기 (밴드 여러 글 저장)", onSelect: () => window.open("./afterlog-collector.zip", "_blank", "noopener") },
            ]}
          >
            <Icon name="settings" size={18} />
          </MenuButton>
        </header>
        <nav className="platform-bar" aria-label="플랫폼">
          <div className="platform-tabs" role="tablist">
            {PLATFORMS.map((m) => (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={m.id === p.platform}
                title={`${m.longLabel} · ${STATUS_LABEL[m.status]} — ${m.support}`}
                onClick={() => p.onPlatform(m.id)}
              >
                {m.label}
                {m.status !== "native" ? <span className={`tab-badge is-${m.status}`}>{m.status === "legacy" ? "기존" : STATUS_LABEL[m.status]}</span> : null}
              </button>
            ))}
          </div>
          <MenuButton
            className="ui-btn platform-compact"
            label="플랫폼 선택"
            items={() => PLATFORMS.map((m) => ({ label: `${m.longLabel} · ${STATUS_LABEL[m.status]}`, checked: m.id === p.platform, onSelect: () => p.onPlatform(m.id) }))}
          >
            {cur.label}
            <Icon name="chevronDown" size={14} />
          </MenuButton>
          <span className="spacer" />
          <div className="platform-tools" ref={ref("platformTools")} />
        </nav>
        <div className="shell-body">{p.children}</div>
      </div>
    </SlotCtx.Provider>
  );
}
