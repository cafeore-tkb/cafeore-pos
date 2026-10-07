import { BarChart3, Coffee, LayoutGrid, SlidersHorizontal } from "lucide-react";
import React from "react";
import type { ControlViewMode } from "./ControlWorkspace";

export type NavTab = "control" | "bays" | "beans" | "analytics";

interface SidebarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  controlViewMode: ControlViewMode;
  onSelectControlViewMode: (mode: ControlViewMode) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  controlViewMode,
  onSelectControlViewMode,
}) => {
  const navItems: { id: NavTab; label: string; icon: React.ReactNode }[] = [
    {
      id: "control",
      label: "管制盤",
      icon: <SlidersHorizontal className="h-5 w-5" />,
    },
    {
      id: "bays",
      label: "ドリッパー",
      icon: <LayoutGrid className="h-5 w-5" />,
    },
    {
      id: "beans",
      label: "豆キュー",
      icon: <Coffee className="h-5 w-5" />,
    },
    {
      id: "analytics",
      label: "実績",
      icon: <BarChart3 className="h-5 w-5" />,
    },
  ];

  return (
    <aside className="z-10 flex w-[82px] shrink-0 select-none flex-col items-center border-[#e2e8f0] border-r bg-white py-2">
      <div className="flex w-full flex-col items-center">
        <nav className="mt-1 flex w-full flex-col items-center gap-1 px-1.5">
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <React.Fragment key={item.id}>
                <button
                  id={`nav-tab-${item.id}`}
                  onClick={() => onSelectTab(item.id)}
                  className={`flex min-h-[48px] w-full touch-manipulation flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1.5 transition-all ${
                    isActive
                      ? "bg-[#0f172a] text-white shadow-xs"
                      : "text-slate-500 hover:bg-[#f8fafc] hover:text-slate-800"
                  }`}
                  title={item.label}
                >
                  <div>{item.icon}</div>
                  <span className="font-medium text-[10px] leading-tight tracking-tight">
                    {item.label}
                  </span>
                </button>
                {item.id === "control" && (
                  <div
                    className="grid w-full gap-1 rounded-xl bg-slate-200 p-1"
                    role="group"
                    aria-label="管制盤の表示切替"
                  >
                    {(["current", "new", "c", "d"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        aria-pressed={controlViewMode === mode}
                        onClick={() => onSelectControlViewMode(mode)}
                        className={`min-h-[44px] touch-manipulation rounded-lg font-black text-[12px] transition-colors ${controlViewMode === mode ? "bg-slate-950 text-white shadow-sm" : "bg-white text-slate-600"}`}
                      >
                        {mode === "current"
                          ? "A"
                          : mode === "new"
                            ? "B"
                            : mode.toUpperCase()}
                      </button>
                    ))}
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </nav>
      </div>
    </aside>
  );
};
