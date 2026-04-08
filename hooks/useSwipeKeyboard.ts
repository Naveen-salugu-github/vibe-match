"use client";

import { useEffect } from "react";

export function useSwipeKeyboard(onDir: (dir: "left" | "right") => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") onDir("right");
      if (e.key === "ArrowLeft") onDir("left");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDir]);
}
