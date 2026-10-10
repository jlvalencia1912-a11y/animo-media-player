import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { MiniPlayer } from "./components/MiniPlayer";
import "./index.css";

const isMini =
  new URLSearchParams(window.location.search).get("mini") === "true";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{isMini ? <MiniPlayer /> : <App />}</React.StrictMode>,
);
