'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Share2 } from 'lucide-react';
import type { GraphPath } from '@app-starter/shared';

const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false });

const COLORS = {
  source: '#0ea5e9',
  person: '#10b981',
  event: '#f59e0b',
  concept: '#8b5cf6',
} as const;

const LABEL_COLOR = '#64748b';
const LINK_LABEL_COLOR = '#94a3b8';

interface GraphNode {
  id: string;
  label: string;
  color: string;
  x?: number;
  y?: number;
}

interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  predicate: string;
}

function colorForType(type: string | undefined): string {
  const t = type?.toUpperCase();
  if (t === 'SOURCE') return COLORS.source;
  if (t === 'ACTOR' || t === 'PERSON') return COLORS.person;
  if (t === 'EVENT') return COLORS.event;
  return COLORS.concept;
}

function truncate(label: string): string {
  return label.length > 28 ? `${label.slice(0, 27)}…` : label;
}

function endpoint(value: string | GraphNode): GraphNode | null {
  return typeof value === 'object' && value !== null ? value : null;
}

const LEGEND: { label: string; color: string }[] = [
  { label: 'Source', color: COLORS.source },
  { label: 'Person', color: COLORS.person },
  { label: 'Event', color: COLORS.event },
  { label: 'Concept', color: COLORS.concept },
];

export function WhyGraph({ paths, height = 260 }: { paths: GraphPath[]; height?: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  const data = useMemo(() => {
    const nodes = new Map<string, GraphNode>();
    const links: GraphLink[] = [];
    for (const path of paths.slice(0, 30)) {
      if (!nodes.has(path.source)) {
        nodes.set(path.source, {
          id: path.source,
          label: path.source,
          color: colorForType(path.sourceType),
        });
      }
      if (!nodes.has(path.target)) {
        nodes.set(path.target, {
          id: path.target,
          label: path.target,
          color: colorForType(path.targetType),
        });
      }
      links.push({ source: path.source, target: path.target, predicate: path.predicate });
    }
    return { nodes: Array.from(nodes.values()), links };
  }, [paths]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () => setWidth(Math.floor(element.getBoundingClientRect().width));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [paths.length]);

  if (paths.length === 0) return null;

  const drawNode = (node: unknown, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const n = node as GraphNode;
    const x = n.x ?? 0;
    const y = n.y ?? 0;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, 2 * Math.PI);
    ctx.fillStyle = n.color;
    ctx.fill();
    const fontSize = Math.min(Math.max(10 / globalScale, 3), 12);
    ctx.font = `${fontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(truncate(n.label), x, y + 7);
  };

  const drawLink = (link: unknown, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const l = link as GraphLink;
    const source = endpoint(l.source);
    const target = endpoint(l.target);
    if (!source || !target || source.x === undefined || target.x === undefined) return;
    const midX = (source.x + target.x) / 2;
    const midY = ((source.y ?? 0) + (target.y ?? 0)) / 2;
    const fontSize = Math.min(Math.max(8 / globalScale, 2.5), 10);
    ctx.font = `${fontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = LINK_LABEL_COLOR;
    ctx.fillText(l.predicate.replace(/_/g, ' '), midX, midY);
  };

  return (
    <div className="overflow-hidden rounded-lg border bg-background">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-3 py-2">
        <div className="flex items-center gap-2 text-xs font-medium">
          <Share2 className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
          <span>Why this answer</span>
        </div>
        <ul className="ml-auto flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
          {LEGEND.map((item) => (
            <li key={item.label} className="flex items-center gap-1">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: item.color }}
                aria-hidden="true"
              />
              {item.label}
            </li>
          ))}
        </ul>
      </div>
      <div ref={containerRef} className="w-full" style={{ height }}>
        {width > 0 && (
          <ForceGraph2D
            graphData={data}
            width={width}
            height={height}
            nodeLabel="label"
            nodeCanvasObject={drawNode}
            linkLabel="predicate"
            linkColor={() => 'rgba(148, 163, 184, 0.6)'}
            linkDirectionalArrowLength={3.5}
            linkDirectionalArrowRelPos={1}
            linkCanvasObjectMode="after"
            linkCanvasObject={drawLink}
            cooldownTicks={80}
            enableZoomInteraction={data.nodes.length >= 6}
          />
        )}
      </div>
    </div>
  );
}