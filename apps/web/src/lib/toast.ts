import { createStore } from "./store.ts";

export interface Toast {
  id: number;
  tone: "neutral" | "error" | "warn" | "success";
  title: string;
  detail?: string;
  action?: { label: string; run: () => void };
}

export const toasts = createStore<Toast[]>([]);
let next = 1;

export function toast(t: Omit<Toast, "id">, ms = t.tone === "error" ? 8000 : 4500): number {
  const id = next++;
  toasts.set((list) => [...list.slice(-2), { ...t, id }]);
  setTimeout(() => dismissToast(id), ms);
  return id;
}

export function dismissToast(id: number): void {
  toasts.set((list) => list.filter((t) => t.id !== id));
}
