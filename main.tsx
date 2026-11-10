import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { FitStage } from "./components/fit-stage";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <FitStage />
  </StrictMode>,
);
