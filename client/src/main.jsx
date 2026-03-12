import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import Squares from "./components/Squares.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Squares direction="diagonal" speed={0.4} squareSize={50} />
    <App />
  </StrictMode>
);
