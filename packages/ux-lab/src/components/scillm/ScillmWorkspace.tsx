import { useEffect, useMemo, useState } from "react";
import { Activity, GitBranch } from "lucide-react";
import { EMBRY } from "../common/EmbryStyle";
import { useRegisterAction } from "../../hooks/useRegisterAction";
import { ScillmDashboard } from "./ScillmDashboard";
import { ScillmDagPlanner } from "./ScillmDagPlanner";
import "./scillm-dashboard.css";

type ScillmWorkspaceTab = "monitor" | "dag-planner";

const TABS: Array<{
  id: ScillmWorkspaceTab;
  label: string;
  title: string;
  icon: typeof Activity;
}> = [
  {
    id: "monitor",
    label: "Monitor",
    title: "Inspect live scillm calls, provider health, jobs, and model-pool state",
    icon: Activity,
  },
  {
    id: "dag-planner",
    label: "DAG Viewer-Planner",
    title: "Review and amend the plan-iterate DAG viewer-editor evidence graph",
    icon: GitBranch,
  },
];

export function ScillmWorkspace({ initialTab }: { initialTab?: string }) {
  const requestedTab = useMemo<ScillmWorkspaceTab>(() => {
    return TABS.some((tab) => tab.id === initialTab) ? initialTab as ScillmWorkspaceTab : "monitor";
  }, [initialTab]);
  const [activeTab, setActiveTab] = useState<ScillmWorkspaceTab>(requestedTab);

  useEffect(() => {
    setActiveTab(requestedTab);
  }, [requestedTab]);

  useRegisterAction("scillm:workspace:tab", {
    app: "ux-lab",
    action: "SCILLM_WORKSPACE_SWITCH_TAB",
    label: "Switch scillm workspace tab",
    description: "Switch between the scillm monitor and DAG viewer-planner",
  });

  return (
    <div className="scillm-workspace" data-qid="scillm:workspace">
      <nav className="scillm-workspace__tabs" role="tablist" aria-label="scillm workspace tabs">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const selected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              data-qid={`scillm:workspace:tab:${tab.id}`}
              data-qs-action="SCILLM_WORKSPACE_SWITCH_TAB"
              title={tab.title}
              onClick={() => {
                setActiveTab(tab.id);
                window.location.hash = tab.id === "monitor" ? "scillm" : `scillm/${tab.id}`;
              }}
              className={`scillm-workspace__tab press-scale scillm-focus${selected ? " scillm-workspace__tab--active" : ""}`}
            >
              <Icon size={15} color={selected ? EMBRY.blue : EMBRY.dim} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="scillm-workspace__panel" role="tabpanel">
        {activeTab === "monitor" ? <ScillmDashboard /> : <ScillmDagPlanner />}
      </div>
    </div>
  );
}
