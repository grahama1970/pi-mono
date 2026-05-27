import { Copy, FilePlus2, Search, Trash2, X } from "lucide-react";
import { EMBRY } from "../../common/EmbryStyle";
import { useRegisterAction } from "../../../hooks/useRegisterAction";

export type DagExplorerItem = {
  id: string;
  title: string;
  subtitle: string;
  status: string;
  kind: "source" | "draft";
  nodeCount: number;
  edgeCount: number;
  active: boolean;
  deletable: boolean;
};

export function DagExplorerPane({
  items,
  search,
  onSearchChange,
  onSelect,
  onAdd,
  onDuplicate,
  onClose,
  onDelete,
}: {
  items: DagExplorerItem[];
  search: string;
  onSearchChange: (value: string) => void;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onDuplicate: (id: string) => void;
  onClose: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  useRegisterAction("scillm:dag-explorer:add", { app: "scillm", action: "SCILLM_DAG_EXPLORER_ADD", label: "Add DAG", description: "Create and persist a new local draft DAG." });
  useRegisterAction("scillm:dag-explorer:search", { app: "scillm", action: "SCILLM_DAG_EXPLORER_SEARCH", label: "Search DAGs", description: "Filter open DAGs in the explorer." });
  useRegisterAction("scillm:dag-explorer:item", { app: "scillm", action: "SCILLM_DAG_EXPLORER_SELECT", label: "Select DAG", description: "Open a DAG from the explorer." });
  useRegisterAction("scillm:dag-explorer:duplicate", { app: "scillm", action: "SCILLM_DAG_EXPLORER_DUPLICATE", label: "Duplicate DAG", description: "Clone a DAG into a persisted local draft." });
  useRegisterAction("scillm:dag-explorer:close", { app: "scillm", action: "SCILLM_DAG_EXPLORER_CLOSE", label: "Close DAG", description: "Close a DAG from the current explorer session." });
  useRegisterAction("scillm:dag-explorer:delete", { app: "scillm", action: "SCILLM_DAG_EXPLORER_DELETE", label: "Delete DAG", description: "Delete a persisted local draft DAG." });

  const normalizedSearch = search.trim().toLowerCase();
  const visibleItems = normalizedSearch
    ? items.filter((item) => `${item.title} ${item.subtitle} ${item.status} ${item.kind}`.toLowerCase().includes(normalizedSearch))
    : items;

  return (
    <aside className="scillm-dag-explorer" data-qid="scillm:dag-explorer" aria-label="DAG explorer">
      <div className="scillm-dag-explorer__header">
        <div>
          <div className="scillm-dag-explorer__eyebrow">DAGs</div>
          <h2>Explorer</h2>
        </div>
        <button
          type="button"
          className="scillm-dag-explorer__icon-button"
          data-qid="scillm:dag-explorer:add"
          data-qs-action="SCILLM_DAG_EXPLORER_ADD"
          title="Create a new local draft DAG"
          onClick={onAdd}
        >
          <FilePlus2 size={15} />
        </button>
      </div>

      <label className="scillm-dag-explorer__search">
        <Search size={14} color={EMBRY.dim} />
        <input
          data-qid="scillm:dag-explorer:search"
          data-qs-action="SCILLM_DAG_EXPLORER_SEARCH"
          title="Search DAGs"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search DAGs"
          aria-label="Search DAGs"
        />
      </label>

      <div className="scillm-dag-explorer__list" role="list">
        {visibleItems.length ? visibleItems.map((item) => (
          <article
            key={item.id}
            className={item.active ? "scillm-dag-explorer__item scillm-dag-explorer__item--active" : "scillm-dag-explorer__item"}
            role="listitem"
          >
            <button
              type="button"
              className="scillm-dag-explorer__select"
              data-qid={`scillm:dag-explorer:item:${item.id}`}
              data-qs-action="SCILLM_DAG_EXPLORER_SELECT"
              title={`Open ${item.title}`}
              onClick={() => onSelect(item.id)}
            >
              <span className={`scillm-dag-explorer__kind scillm-dag-explorer__kind--${item.kind}`}>{item.kind}</span>
              <strong>{item.title}</strong>
              <span>{item.subtitle}</span>
              <small>{item.nodeCount} nodes · {item.edgeCount} edges · {item.status}</small>
            </button>
            <div className="scillm-dag-explorer__actions" aria-label={`Actions for ${item.title}`}>
              <button
                type="button"
                data-qid={`scillm:dag-explorer:duplicate:${item.id}`}
                data-qs-action="SCILLM_DAG_EXPLORER_DUPLICATE"
                title="Duplicate DAG"
                onClick={() => onDuplicate(item.id)}
              >
                <Copy size={13} />
              </button>
              <button
                type="button"
                data-qid={`scillm:dag-explorer:close:${item.id}`}
                data-qs-action="SCILLM_DAG_EXPLORER_CLOSE"
                title="Close DAG"
                onClick={() => onClose(item.id)}
              >
                <X size={13} />
              </button>
              <button
                type="button"
                data-qid={`scillm:dag-explorer:delete:${item.id}`}
                data-qs-action="SCILLM_DAG_EXPLORER_DELETE"
                title={item.deletable ? "Delete local DAG" : "Source DAG delete is disabled because it is backed by phase evidence."}
                disabled={!item.deletable}
                onClick={() => onDelete(item.id)}
              >
                <Trash2 size={13} />
              </button>
            </div>
          </article>
        )) : (
          <div className="scillm-dag-explorer__empty">
            <strong>No open DAGs</strong>
            <span>Create a local draft DAG or clear the search.</span>
          </div>
        )}
      </div>
    </aside>
  );
}
