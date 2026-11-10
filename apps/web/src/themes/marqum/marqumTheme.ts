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
    "--font-family-heading": '"Montserrat Variable", Montserrat, "Figtree Variable", ui-sans-serif, sans-serif',
    "--font-family-code": '"Geist Mono", ui-monospace, monospace',
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
