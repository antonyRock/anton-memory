"use client";

import { useEffect, useRef } from "react";

type Node = {
  x: number;
  y: number;
  layer: number;
};

const GRID = 52;
const JITTER = 14;

function buildNodes(width: number, height: number): Node[] {
  const cols = Math.ceil(width / GRID) + 2;
  const rows = Math.ceil(height / GRID) + 2;
  const nodes: Node[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const layer = (row + col) % 2;
      nodes.push({
        x: col * GRID - GRID + (Math.random() - 0.5) * JITTER,
        y: row * GRID - GRID + (Math.random() - 0.5) * JITTER,
        layer
      });
    }
  }

  return nodes;
}

function drawWeb(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  nodes: Node[],
  offsetX: number,
  offsetY: number,
  layer: number,
  alpha: number
) {
  const layerNodes = nodes.filter((node) => node.layer === layer);
  const maxDistance = GRID * 1.45;

  ctx.strokeStyle = `rgba(255, 221, 45, ${alpha * 0.22})`;
  ctx.lineWidth = 1;

  for (let index = 0; index < layerNodes.length; index += 1) {
    const a = layerNodes[index];
    for (let inner = index + 1; inner < layerNodes.length; inner += 1) {
      const b = layerNodes[inner];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const distance = Math.hypot(dx, dy);
      if (distance > maxDistance) continue;
      const fade = 1 - distance / maxDistance;
      ctx.globalAlpha = alpha * fade * 0.7;
      ctx.beginPath();
      ctx.moveTo(a.x + offsetX, a.y + offsetY);
      ctx.lineTo(b.x + offsetX, b.y + offsetY);
      ctx.stroke();
    }
  }

  ctx.globalAlpha = alpha;
  ctx.fillStyle = `rgba(255, 221, 45, ${alpha * 0.55})`;
  for (const node of layerNodes) {
    ctx.beginPath();
    ctx.arc(node.x + offsetX, node.y + offsetY, 1.2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 1;
}

export function ObsidianBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const nodesRef = useRef<Node[]>([]);
  const mouseRef = useRef({ x: 0.5, y: 0.5 });
  const smoothRef = useRef({ x: 0.5, y: 0.5 });
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = parent.clientWidth;
      const height = parent.clientHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      nodesRef.current = buildNodes(width, height);
    };

    const render = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (!width || !height) return;

      smoothRef.current.x += (mouseRef.current.x - smoothRef.current.x) * 0.06;
      smoothRef.current.y += (mouseRef.current.y - smoothRef.current.y) * 0.06;

      const dx = (smoothRef.current.x - 0.5) * 28;
      const dy = (smoothRef.current.y - 0.5) * 28;

      ctx.clearRect(0, 0, width, height);
      drawWeb(ctx, width, height, nodesRef.current, dx * 0.35, dy * 0.35, 0, 0.22);
      drawWeb(ctx, width, height, nodesRef.current, dx * 0.75, dy * 0.75, 1, 0.14);

      frameRef.current = window.requestAnimationFrame(render);
    };

    const onMouseMove = (event: MouseEvent) => {
      mouseRef.current = {
        x: event.clientX / window.innerWidth,
        y: event.clientY / window.innerHeight
      };
    };

    const observer = new ResizeObserver(resize);
    if (canvas.parentElement) observer.observe(canvas.parentElement);

    resize();
    frameRef.current = window.requestAnimationFrame(render);
    window.addEventListener("mousemove", onMouseMove, { passive: true });

    return () => {
      observer.disconnect();
      window.removeEventListener("mousemove", onMouseMove);
      if (frameRef.current != null) window.cancelAnimationFrame(frameRef.current);
    };
  }, []);

  return <canvas aria-hidden className="obsidian-bg" ref={canvasRef} />;
}
