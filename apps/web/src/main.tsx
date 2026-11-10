// Global CSS first: it declares the cascade-layer order before any theme stylesheet loads.
import "./styles/app.css";
import { Theme } from "@astryxdesign/core/theme";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";
import { defaultThemeSlug, themes } from "./astryx-themes.ts";
import { auth } from "./lib/auth.ts";

void auth.restore();

const el = document.getElementById("root");
if (el) {
  createRoot(el).render(
    <StrictMode>
      <Theme theme={themes[defaultThemeSlug]}>
        <App />
      </Theme>
    </StrictMode>,
  );
}
