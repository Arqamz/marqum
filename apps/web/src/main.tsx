import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/app.css";
import { App } from "./app.tsx";
import { registerDisplayFont } from "./fonts/display.ts";
import { auth } from "./lib/auth.ts";

registerDisplayFont();
void auth.restore();

const el = document.getElementById("root");
if (el) {
  createRoot(el).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
