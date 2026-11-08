import type { Dataset } from "@marqum/core";
import { useState } from "react";
import { cn } from "../lib/cn.ts";
import { childrenOf, visibleTopCategories } from "../lib/view.ts";
import { CategoryIcon } from "./category-icon.tsx";
import { Chip } from "./ui/controls.tsx";

/** Category grid (parent) → subcategory chips. Selection is the accent. */
export function CategoryPicker({
  ds,
  value,
  onChange,
  suggested,
}: {
  ds: Dataset;
  value: string | null;
  onChange: (id: string | null) => void;
  suggested?: string | null;
}) {
  const [showAll, setShowAll] = useState(false);
  const tops = showAll
    ? ds.categories.filter((c) => c.parent_id === null).sort((a, b) => a.sort - b.sort)
    : visibleTopCategories(ds);
  const current = value ? ds.categories.find((c) => c.id === value) : undefined;
  const parentId = current ? (current.parent_id ?? current.id) : null;
  const subs = parentId ? childrenOf(ds, parentId) : [];
  const hiddenCount =
    ds.categories.filter((c) => c.parent_id === null).length - visibleTopCategories(ds).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" role="listbox" aria-label="Category">
        {tops.map((c) => {
          const selected = parentId === c.id;
          const isSuggested = !value && suggested && (suggested === c.id || suggested.startsWith(`${c.id}.`));
          return (
            <button
              key={c.id}
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() => onChange(selected && value === c.id ? null : c.id)}
              className={cn(
                "flex flex-col items-center gap-1 rounded-control border px-1 py-3 text-xs transition-colors",
                selected
                  ? "border-accent bg-accent-soft text-accent-text"
                  : isSuggested
                    ? "border-dashed border-accent text-fg"
                    : "border-transparent bg-surface-2 text-fg hover:bg-surface-3",
              )}
            >
              <CategoryIcon name={c.icon} />
              <span className="w-full truncate text-center">{c.name}</span>
            </button>
          );
        })}
      </div>
      {subs.length > 0 ? (
        <fieldset className="flex flex-wrap gap-2" aria-label="Subcategory">
          {subs.map((s) => (
            <Chip
              key={s.id}
              selected={value === s.id}
              onClick={() => onChange(value === s.id ? (parentId ?? null) : s.id)}
            >
              {s.name}
            </Chip>
          ))}
        </fieldset>
      ) : null}
      {!showAll && hiddenCount > 0 ? (
        <button
          type="button"
          className="self-start text-sm text-accent-text"
          onClick={() => setShowAll(true)}
        >
          Show {hiddenCount} more categories
        </button>
      ) : null}
    </div>
  );
}
