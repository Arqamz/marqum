import { Grid } from "@astryxdesign/core/Grid";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import type { Dataset } from "@marqum/core";
import type { Category } from "@marqum/schema";
import { Plus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { cn } from "../lib/cn.ts";
import { enqueue } from "../lib/commands.ts";
import { CATEGORY_ICONS, CategoryIcon } from "./category-icon.tsx";
import { Button } from "./ui/button.tsx";
import { ConfirmButton } from "./ui/confirm-button.tsx";
import { Chip } from "./ui/controls.tsx";

/** What still uses a category ("12 transactions, 1 rule"); empty = it can be deleted. */
export function categoryUses(ds: Dataset, id: string): string {
  const n = (k: number, what: string) => (k ? `${k} ${what}${k === 1 ? "" : "s"}` : "");
  return [
    n(ds.transactions.filter((t) => !t.deleted && t.category_id === id).length, "transaction"),
    n(ds.categories.filter((c) => !c.deleted && c.parent_id === id).length, "subcategory"),
    n(ds.rules.filter((r) => !r.deleted && r.category_id === id).length, "rule"),
    n(ds.recurring.filter((r) => !r.deleted && r.category_id === id).length, "fixed charge"),
    n(
      ds.counterparties.filter((c) => !c.deleted && c.default_category_id === id).length,
      "counterparty default",
    ),
  ]
    .filter(Boolean)
    .join(", ");
}

/** A new id: "pets" at the top, "food.snacks" under food (ids carry their parent), unique. */
function newCategoryId(ds: Dataset, name: string, parentId: string | null): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "category";
  const base = parentId ? `${parentId}.${slug}` : slug;
  let id = base;
  for (let i = 2; ds.categories.some((c) => c.id === id); i++) id = `${base}-${i}`;
  return id;
}

const ICON_NAMES = Object.keys(CATEGORY_ICONS).filter((k) => k !== "home");

/**
 * Add, rename, re-icon or delete one category. `parentId` is fixed when creating: a category's id carries its
 * parent, so subcategories can't move between parents.
 */
export function CategoryEditor({
  ds,
  category,
  parentId,
  onDone,
  onEdit,
}: {
  ds: Dataset;
  /** undefined = a new category */
  category: Category | undefined;
  parentId: string | null;
  onDone: () => void;
  /** open another category (a subcategory, or a new one under this) */
  onEdit: (next: { category?: Category; parentId: string | null }) => void;
}) {
  const parent = parentId ? ds.categories.find((c) => c.id === parentId) : undefined;
  const [name, setName] = useState(category?.name ?? "");
  const [icon, setIcon] = useState(category?.icon ?? parent?.icon ?? "circle");
  const subs = category
    ? ds.categories.filter((c) => !c.deleted && c.parent_id === category.id).sort((a, b) => a.sort - b.sort)
    : [];
  const uses = category ? categoryUses(ds, category.id) : "";
  const clash = ds.categories.some(
    (c) =>
      !c.deleted &&
      c.id !== category?.id &&
      c.parent_id === parentId &&
      c.name.trim().toLowerCase() === name.trim().toLowerCase(),
  );
  const ok = name.trim().length > 0 && !clash;
  const save = () => {
    if (!ok) return;
    const siblings = ds.categories.filter((c) => c.parent_id === parentId);
    void enqueue("upsertCategory", {
      category_id: category?.id ?? newCategoryId(ds, name.trim(), parentId),
      parent_id: parentId,
      name: name.trim(),
      icon,
      wallet_hint: category?.wallet_hint ?? parent?.wallet_hint ?? null,
      nature: category?.nature ?? parent?.nature ?? "variable",
      hidden: category?.hidden ?? false,
      sort: category?.sort ?? Math.max(0, ...siblings.map((c) => c.sort)) + 1,
      budget: category?.budget ?? null,
    });
    onDone();
  };
  return (
    <VStack
      as="form"
      gap={4}
      data-testid="category-editor"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        save();
      }}
    >
      <TextInput
        label={parent ? `Name (under ${parent.name})` : "Name"}
        value={name}
        onChange={setName}
        placeholder={parent ? "Snacks" : "Pets"}
        {...(clash ? { description: "There's already one with that name" } : {})}
        width="100%"
      />
      <VStack gap={2}>
        <Text type="label">Icon</Text>
        <Grid columns={{ minWidth: 44, max: 8 }} gap={2} role="listbox" aria-label="Icon">
          {ICON_NAMES.map((k) => (
            <button
              key={k}
              type="button"
              role="option"
              aria-selected={icon === k}
              aria-label={k}
              onClick={() => setIcon(k)}
              className={cn(
                "flex h-11 items-center justify-center rounded-control border transition-colors",
                icon === k
                  ? "border-accent bg-accent text-accent-fg"
                  : "border-transparent bg-surface-2 text-fg hover:bg-surface-3",
              )}
            >
              <CategoryIcon name={k} />
            </button>
          ))}
        </Grid>
      </VStack>
      {category && !parentId ? (
        <VStack gap={2}>
          <Text type="label">Subcategories</Text>
          <HStack gap={2} wrap="wrap">
            {subs.map((s) => (
              <Chip
                key={s.id}
                selected={false}
                onClick={() => onEdit({ category: s, parentId: category.id })}
              >
                {s.name}
              </Chip>
            ))}
            <Chip
              selected={false}
              icon={<Plus aria-hidden />}
              onClick={() => onEdit({ parentId: category.id })}
            >
              Add
            </Chip>
          </HStack>
        </VStack>
      ) : null}
      <Button type="submit" variant="primary" size="lg" disabled={!ok}>
        {category
          ? name.trim() && name.trim() !== category.name
            ? `Rename ${category.name} to ${name.trim()}`
            : `Save ${category.name}`
          : name.trim()
            ? `Add ${name.trim()}${parent ? ` under ${parent.name}` : ""}`
            : "Add category"}
      </Button>
      {category ? (
        uses ? (
          <Text type="supporting">{`Used by ${uses}. Hide it instead of deleting (the switch in the list).`}</Text>
        ) : (
          <ConfirmButton
            label={`Delete ${category.name}`}
            confirm={`Tap again: delete ${category.name}`}
            onConfirm={() => {
              void enqueue("deleteCategory", { category_id: category.id });
              onDone();
            }}
          />
        )
      ) : null}
      <Button variant="ghost" onClick={onDone}>
        Cancel
      </Button>
    </VStack>
  );
}
