import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { MotionProvider } from "./components/motion-provider";
import "./styles/app.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MotionProvider>
      <App />
    </MotionProvider>
  </StrictMode>,
);
