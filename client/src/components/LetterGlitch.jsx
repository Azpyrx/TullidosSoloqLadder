import { useEffect, useRef } from "react";
import "./LetterGlitch.css";

const DEFAULT_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ!@#$&*()-_+=/[]{};:<>.,0123456789";
const DEFAULT_COLORS = ["#2b4539", "#61dca3", "#61b3dc"];

function randomInt(max) {
  return Math.floor(Math.random() * max);
}

export default function LetterGlitch({
  className = "",
  glitchColors = DEFAULT_COLORS,
  glitchSpeed = 10,
  centerVignette = false,
  outerVignette = false,
  smooth = true,
  characters = DEFAULT_CHARS,
}) {
  const canvasRef = useRef(null);
  const frameRef = useRef(null);
  const lastMutationRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));

    let cols = 0;
    let rows = 0;
    let grid = [];
    const cell = 16;
    let lastTs = 0;
    const palette = Array.isArray(glitchColors) && glitchColors.length > 0 ? glitchColors : DEFAULT_COLORS;
    const sourceChars = String(characters || DEFAULT_CHARS);

    const pickChar = () => sourceChars[randomInt(sourceChars.length)] || "A";
    const pickColor = () => palette[randomInt(palette.length)] || DEFAULT_COLORS[0];
    const mutationInterval = Math.max(16, Number(glitchSpeed) || 50);

    const resize = () => {
      const w = Math.ceil(window.innerWidth);
      const h = Math.ceil(window.innerHeight);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      cols = Math.ceil(w / cell);
      rows = Math.ceil(h / cell);
      grid = Array.from({ length: rows }, () =>
        Array.from({ length: cols }, () => ({
          ch: pickChar(),
          alpha: 0.35 + Math.random() * 0.45,
          targetAlpha: 0.35 + Math.random() * 0.45,
          color: pickColor(),
        }))
      );
    };

    const draw = (ts) => {
      if (!lastTs) lastTs = ts;
      const dt = ts - lastTs;
      if (dt < 33) {
        frameRef.current = requestAnimationFrame(draw);
        return;
      }
      lastTs = ts;

      const w = canvas.width / dpr;
      const h = canvas.height / dpr;

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#070b12";
      ctx.fillRect(0, 0, w, h);

      ctx.shadowBlur = 0;
      ctx.shadowColor = "transparent";
      ctx.font = "600 11px 'IBM Plex Mono', Consolas, 'Courier New', monospace";
      ctx.textBaseline = "top";

      if (!lastMutationRef.current) lastMutationRef.current = ts;
      if (ts - lastMutationRef.current >= mutationInterval) {
        const mutateCount = Math.max(12, Math.floor((rows * cols) * 0.035));
        for (let i = 0; i < mutateCount; i += 1) {
          const r = randomInt(rows);
          const c = randomInt(cols);
          if (!grid[r] || !grid[r][c]) continue;
          const item = grid[r][c];
          item.ch = pickChar();
          item.color = pickColor();
          item.targetAlpha = 0.45 + Math.random() * 0.5;
        }
        lastMutationRef.current = ts;
      }

      const glitchBandY = Math.random() < 0.18 ? randomInt(rows) : -1;

      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          const item = grid[r][c];
          if (!item) continue;

          let x = c * cell + 2;
          const y = r * cell + 1;
          let alpha = item.alpha;

          if (glitchBandY !== -1 && Math.abs(r - glitchBandY) <= 1) {
            x += (Math.random() - 0.5) * 6;
            alpha = Math.min(0.95, alpha + 0.24);
          }

          if (!prefersReducedMotion && smooth) {
            item.alpha += (item.targetAlpha - item.alpha) * 0.11;
            if (item.targetAlpha - item.alpha < 0.01) {
              item.targetAlpha = 0.35 + Math.random() * 0.5;
            }
          } else {
            item.alpha = item.targetAlpha;
          }

          const useX = Math.round(x);
          const useY = Math.round(y);
          const clampedAlpha = Math.max(0.24, Math.min(0.95, alpha));
          ctx.fillStyle = item.color;
          ctx.globalAlpha = clampedAlpha;
          ctx.fillText(item.ch, useX, useY);
        }
      }

      ctx.globalAlpha = 1;

      if (centerVignette) {
        const center = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.6);
        center.addColorStop(0, "rgba(255, 255, 255, 0)");
        center.addColorStop(1, "rgba(0, 0, 0, 0.28)");
        ctx.fillStyle = center;
        ctx.fillRect(0, 0, w, h);
      }

      if (outerVignette) {
        const outer = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.72);
        outer.addColorStop(0, "rgba(0, 0, 0, 0)");
        outer.addColorStop(1, "rgba(0, 0, 0, 0.48)");
        ctx.fillStyle = outer;
        ctx.fillRect(0, 0, w, h);
      }

      frameRef.current = requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener("resize", resize);
    frameRef.current = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener("resize", resize);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [centerVignette, characters, glitchColors, glitchSpeed, outerVignette, smooth]);

  return <canvas ref={canvasRef} className={`letter-glitch-canvas ${className}`.trim()} />;
}
