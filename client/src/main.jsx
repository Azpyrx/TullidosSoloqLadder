import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import LetterGlitch from "./components/LetterGlitch.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <LetterGlitch
      glitchColors={["#2b4539", "#61dca3", "#61b3dc"]}
      glitchSpeed={50}
      centerVignette={false}
      outerVignette
      smooth
    />
    <App />
  </StrictMode>
);
