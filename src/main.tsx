import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { MiniPlayer } from "./components/MiniPlayer";
import { VideoWindow } from "./components/VideoWindow";
import { BannerWindow } from "./components/BannerWindow";
import "./index.css";

const params = new URLSearchParams(window.location.search);
const isMini = params.get("mini") === "true";
const isVideo = params.get("video") === "true";
const isBanner = params.get("banner") === "true";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isVideo ? (
      <VideoWindow />
    ) : isBanner ? (
      <BannerWindow />
    ) : isMini ? (
      <MiniPlayer />
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
