import { useEffect, useRef } from "react";

/**
 * Scrolling bar waveform fed by live levels from the offscreen recorder (via a runtime Port).
 * Purely visual: closing the popup disconnects the port and never affects the recording.
 */
export function Waveform({ live, paused }: { live: boolean; paused: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const history = useRef<number[]>([]);

  useEffect(() => {
    if (!live) return;
    let port: chrome.runtime.Port | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    const connect = () => {
      port = chrome.runtime.connect({ name: "levels" });
      port.onMessage.addListener((m: { type: string; level?: number; levels?: number[] }) => {
        if (m.type === "history" && m.levels) history.current = [...m.levels];
        else if (m.type === "level" && m.level != null) {
          history.current.push(m.level);
          if (history.current.length > 400) history.current.splice(0, 100);
        }
      });
      port.onDisconnect.addListener(() => {
        void chrome.runtime.lastError;
        if (!closed) retry = setTimeout(connect, 600);
      });
    };
    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      port?.disconnect();
    };
  }, [live]);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (c.width !== Math.round(w * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      const on = getComputedStyle(c).color;
      const off = getComputedStyle(document.documentElement).getPropertyValue("--wave-idle") || "#ddd";
      const barW = 3.5;
      const gap = 3;
      const n = Math.floor(w / (barW + gap));
      const hist = history.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      for (let i = 0; i < n; i++) {
        const v = hist[hist.length - n + i];
        const bh = Math.max(4, (v ?? 0.03) * h * 0.95);
        ctx.globalAlpha = paused && v != null ? 0.45 : 1;
        ctx.fillStyle = v == null ? off : on;
        ctx.beginPath();
        ctx.roundRect(i * (barW + gap), (h - bh) / 2, barW, bh, 2);
        ctx.fill();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [paused]);

  return (
    <div className="wave" aria-hidden>
      <canvas ref={canvas} />
    </div>
  );
}
