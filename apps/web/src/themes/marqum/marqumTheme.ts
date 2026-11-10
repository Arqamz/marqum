import { defineTheme } from "@astryxdesign/core/theme";
import { stoneTheme } from "@astryxdesign/theme-stone/built";

/**
 * Stone, plus the two wallets' own brand colours (sampled from the SadaPay and NayaPay apps' launcher icons and
 * splash themes). Text on each fill is ≥4.5:1: deep teal on SadaPay mint, blackberry on NayaPay orange.
 * Fonts are self-hosted (src/styles/fonts.css), so no font request leaves the device.
 */
export const marqumTheme = defineTheme({
  name: "marqum",
  extends: stoneTheme,
  tokens: {
    "--font-family-body": '"Figtree Variable", Figtree, ui-sans-serif, system-ui, sans-serif',
    "--font-family-heading":
      '"Montserrat Variable", Montserrat, "Figtree Variable", ui-sans-serif, sans-serif',
    "--font-family-code": '"Geist Mono", ui-monospace, monospace',
    // A deep teal accent (Marqūm's own colour, between the two wallets' palettes) and clearer
    // money colours than Stone's muted ones: green = under / earned, red = over / spent.
    "--color-accent": ["#0b6e63", "#5fe0c8"],
    "--color-accent-muted": ["#0b6e6314", "#5fe0c824"],
    "--color-text-accent": ["#0b6e63", "#7ae8d3"],
    "--color-icon-accent": ["#0b6e63", "#7ae8d3"],
    "--color-on-accent": ["#ffffff", "#04231f"],
    "--color-success": ["#15803d", "#4ade80"],
    "--color-text-success": ["#15803d", "#6ee7a0"],
    "--color-icon-success": ["#15803d", "#6ee7a0"],
    "--color-success-muted": ["#15803d1a", "#4ade8026"],
    "--color-error": ["#c2352b", "#ff8f84"],
    "--color-text-error": ["#c2352b", "#ff9c92"],
    "--color-icon-error": ["#c2352b", "#ff9c92"],
    "--color-error-muted": ["#c2352b14", "#ff8f8424"],
    // Stone's red/green card fills are dusty (its dark red reads brown); real red and green tints instead.
    "--color-background-red": ["#fde3e0", "#5a1717"],
    "--color-background-green": ["#dcf5e3", "#0f4527"],
    "--color-warning": ["#b45309", "#fbbf24"],
    "--color-text-warning": ["#a14a07", "#fcd34d"],
    "--color-icon-warning": ["#b45309", "#fcd34d"],
  },
  localTokens: {
    "--brand-sadapay": ["#3eddbf", "#2ac6b0"],
    "--brand-sadapay-deep": ["#2ac6b0", "#1fa893"],
    "--brand-sadapay-ink": ["#06302a", "#04231f"],
    "--brand-sadapay-coral": ["#ff6c5a", "#ff8065"],
    "--brand-nayapay": ["#ff5018", "#ff5018"],
    "--brand-nayapay-deep": ["#e8430f", "#d93d0c"],
    "--brand-nayapay-ink": ["#2c1a28", "#2c1a28"],
  },
  components: {
    card: {
      "variant:sadapay": {
        backgroundColor: "var(--brand-sadapay)",
        color: "var(--brand-sadapay-ink)",
      },
      "variant:nayapay": {
        backgroundColor: "var(--brand-nayapay)",
        color: "var(--brand-nayapay-ink)",
      },
    },
  },
});
