/**
 * PP Neue Montreal (display face). Its licence forbids redistribution, so the files live in the
 * gitignored `src/fonts/licensed/` folder. The eager glob resolves to {} when they're absent and the
 * display stack falls back to Geist.
 */
const files = import.meta.glob<string>("./licensed/*.woff2", {
  eager: true,
  query: "?url",
  import: "default",
});

function weightOf(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("thin")) return "100";
  if (n.includes("light")) return "300";
  if (n.includes("medium")) return "500";
  if (n.includes("semibold")) return "600";
  if (n.includes("bold")) return "700";
  if (n.includes("book")) return "400";
  return "400";
}

export function registerDisplayFont(): void {
  const entries = Object.entries(files).filter(([name]) => !/italic/i.test(name));
  if (entries.length === 0 || typeof document === "undefined") return;
  const css = entries
    .map(
      ([name, url]) =>
        `@font-face{font-family:"PP Neue Montreal";src:url("${url}") format("woff2");font-weight:${weightOf(name)};font-style:normal;font-display:swap}`,
    )
    .join("\n");
  const style = document.createElement("style");
  style.dataset.font = "display";
  style.textContent = css;
  document.head.appendChild(style);
}
