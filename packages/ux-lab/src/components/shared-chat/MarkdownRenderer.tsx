/**
 * MarkdownRenderer — Shared markdown rendering with entity highlighting + syntax highlighting.
 * Used by Embry Terminal and SPARTA Explorer chat.
 */
import { memo } from 'react';
import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/core';
import go from 'highlight.js/lib/languages/go';
import python from 'highlight.js/lib/languages/python';
import typescript from 'highlight.js/lib/languages/typescript';
import javascript from 'highlight.js/lib/languages/javascript';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import yaml from 'highlight.js/lib/languages/yaml';
import rust from 'highlight.js/lib/languages/rust';
import { FileText, Search } from 'lucide-react';
import { highlightWithSpans } from './highlightEntities';
import type { EntityType, EvidenceCaseSpan } from './types';

// Register languages once
hljs.registerLanguage('go', go);
hljs.registerLanguage('python', python);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('tsx', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('py', python);
hljs.registerLanguage('sh', bash);

interface MarkdownRendererProps {
  content: string;
  onEntityClick?: (entity: string, type: EntityType) => void;
  /** Deterministic spans from /memory /extract-entities. These take precedence over static fallback highlighting. */
  entitySpans?: EvidenceCaseSpan[];
  /** Legacy: cap tables at 3 rows with fade + workspace link (non-sidebar only) */
  teaserMode?: boolean;
  /** Gemini sidebar: full readable prose/tables on flat canvas */
  sidebarMode?: boolean;
  onOpenWorkspace?: () => void;
  tableRowCount?: number;
  /** Optional: convert filesystem paths to URLs for inline media (image=/path, clip=/path, audio=/path) */
  mediaUrl?: (path: string) => string;
}

function preprocessMedia(content: string, mediaUrl?: (path: string) => string): string {
  if (!content) return content;
  const toUrl = (path: string) => mediaUrl ? mediaUrl(path) : path;
  return content
    .replace(/(?:^|[\s|])image=(\S+)/gm, (_match, path) => `![image](${toUrl(path)})`)
    .replace(/(?:^|[\s|])clip=(\S+)/gm, (_match, path) => `![clip](${toUrl(path)})`)
    .replace(/(?:^|[\s|])audio=(\S+)/gm, (_match, path) => `![audio](${toUrl(path)})`);
}

function isVideo(src?: string): boolean {
  return !!src && /\.(mp4|webm|mov|mkv|avi)$/i.test(src);
}

function isAudio(src?: string): boolean {
  return !!src && /\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(src);
}

function textFromChildren(children: ReactNode): string {
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(textFromChildren).join('');
  return '';
}

function splitTranscriptLine(text: string): { meta: string; body: string; visual?: string } | null {
  const match = text.match(/^(\d{2}:\d{2}(?:\s*\([^)]*\))?)(?:\s*\[[^\]]+\])?\s*:\s*([\s\S]+)$/);
  if (!match) return null;
  const [, meta, rawBody] = match;
  const [body, visual] = rawBody.split(/\s+visual:\s*\d+\.\s*/i);
  return {
    meta: meta.trim(),
    body: body.trim(),
    visual: visual?.replace(/\s*\|+\s*$/, '').trim(),
  };
}

function previewText(text: string, maxLength = 92): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trim()}...`;
}

const WATCH_ENTITY_PATTERNS: Array<{ name: string; type: 'character' | 'actor' | 'place' | 'work'; pattern: RegExp }> = [
  { name: 'Bad Santa', type: 'work', pattern: /\bBad Santa\b/gi },
  { name: 'Willie', type: 'character', pattern: /\bWillie\b/gi },
  { name: 'Billy Bob Thornton', type: 'actor', pattern: /\bBilly Bob Thornton\b/gi },
  { name: 'Marcus', type: 'character', pattern: /\bMarcus\b/gi },
  { name: 'Tony Cox', type: 'actor', pattern: /\bTony Cox\b/gi },
  { name: 'The Kid', type: 'character', pattern: /\bThe Kid\b/gi },
  { name: 'Brett Kelly', type: 'actor', pattern: /\bBrett Kelly\b/gi },
  { name: 'Sue', type: 'character', pattern: /\bSue\b/gi },
  { name: 'Lauren Graham', type: 'actor', pattern: /\bLauren Graham\b/gi },
  { name: 'Gin', type: 'character', pattern: /\bGin\b/gi },
  { name: 'Bernie Mac', type: 'actor', pattern: /\bBernie Mac\b/gi },
  { name: 'Lois', type: 'character', pattern: /\bLois\b/gi },
  { name: 'Lauren Tom', type: 'actor', pattern: /\bLauren Tom\b/gi },
  { name: 'Bob Chipeska', type: 'character', pattern: /\bBob Chipeska\b/gi },
  { name: 'John Ritter', type: 'actor', pattern: /\bJohn Ritter\b/gi },
  { name: 'Santa Claus', type: 'character', pattern: /\bSanta Claus\b/gi },
  { name: 'Santa', type: 'character', pattern: /\bSanta\b/gi },
  { name: 'Mall', type: 'place', pattern: /\bmall\b/gi },
  { name: 'Store', type: 'place', pattern: /\bstore\b/gi },
]

function renderWatchEntityText(text: string): ReactNode {
  const matches: Array<{ start: number; end: number; name: string; type: 'character' | 'actor' | 'place' | 'work'; text: string }> = []
  for (const entity of WATCH_ENTITY_PATTERNS) {
    for (const match of text.matchAll(entity.pattern)) {
      if (typeof match.index !== 'number' || !match[0]) continue
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        name: entity.name,
        type: entity.type,
        text: match[0],
      })
    }
  }
  matches.sort((a, b) => a.start - b.start || b.end - a.end)
  const accepted: typeof matches = []
  let cursor = -1
  for (const match of matches) {
    if (match.start < cursor) continue
    accepted.push(match)
    cursor = match.end
  }
  if (accepted.length === 0) return text

  const nodes: ReactNode[] = []
  let offset = 0
  accepted.forEach((match, index) => {
    if (match.start > offset) nodes.push(text.slice(offset, match.start))
    nodes.push(
      <button
        key={`${match.name}-${match.start}-${index}`}
        type="button"
        className="watch-chat-entity-pivot"
        data-qid="watch:chat:entity-pivot"
        data-entity-type={match.type}
        data-domain-status="verified"
        title={`Verified movie-domain term: ${match.name}`}
        onClick={(event) => {
          event.stopPropagation()
          window.dispatchEvent(new CustomEvent('watch:entity-filter', { detail: { entity: match.name, type: match.type } }))
        }}
      >
        {match.text}
      </button>,
    )
    offset = match.end
  })
  if (offset < text.length) nodes.push(text.slice(offset))
  return nodes
}

export const MarkdownRenderer = memo(function MarkdownRenderer({ content, onEntityClick, entitySpans = [], teaserMode = false, sidebarMode = false, onOpenWorkspace, tableRowCount, mediaUrl }: MarkdownRendererProps) {
  const processedContent = preprocessMedia(content, mediaUrl);
  let searchOffset = 0;

  const hl = (text: string) => {
    if (sidebarMode) return renderWatchEntityText(text);
    if (!entitySpans.length) return text;

    // /extract-entities spans are authoritative and are indexed against the
    // full source text. ReactMarkdown renders smaller text nodes, so project
    // those deterministic spans into each text node without re-parsing text.
    const start = processedContent.indexOf(text, searchOffset);
    if (start < 0) return text;
    const end = start + text.length;
    searchOffset = end;
    const localSpans = entitySpans
      .filter((span): span is EvidenceCaseSpan & { span: [number, number] } => (
        Array.isArray(span.span)
        && span.span.length === 2
        && span.span[0] >= start
        && span.span[1] <= end
      ))
      .map((span) => ({
        ...span,
        span: [span.span[0] - start, span.span[1] - start] as [number, number],
      }));
    return highlightWithSpans(text, localSpans, onEntityClick);
  };

  return (
    <div className={sidebarMode ? 'chat-prose chat-prose--sidebar' : 'chat-prose'}>
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => (
          <p>
            {typeof children === 'string' ? hl(children) : children}
          </p>
        ),
        strong: ({ children }) => (
          <strong>
            {typeof children === 'string' ? hl(children) : children}
          </strong>
        ),
        h1: ({ children }) => <h1>{children}</h1>,
        h2: ({ children }) => <h2>{children}</h2>,
        h3: ({ children }) => <h3>{children}</h3>,
        h4: ({ children }) => <h4>{children}</h4>,
        ul: ({ children }) => <ul>{children}</ul>,
        ol: ({ children }) => <ol>{children}</ol>,
        li: ({ children }) => {
          if (sidebarMode) {
            const transcript = splitTranscriptLine(textFromChildren(children));
            if (transcript) {
              return (
                <li className="chat-prose__transcript-row">
                  <details className="chat-prose__evidence-card">
                    <summary className="chat-prose__evidence-summary">
                      <span className="chat-prose__transcript-meta">{transcript.meta}</span>
                      <span className="chat-prose__evidence-preview">{previewText(transcript.body)}</span>
                      <span className="chat-prose__evidence-actions" title="View evidence" aria-label="View evidence">
                        <FileText size={14} strokeWidth={1.8} aria-hidden="true" />
                        <Search size={13} strokeWidth={1.8} aria-hidden="true" />
                      </span>
                    </summary>
                    <span className="chat-prose__transcript-text">{transcript.body}</span>
                    {transcript.visual ? (
                      <span className="chat-prose__transcript-visual">{transcript.visual}</span>
                    ) : null}
                  </details>
                </li>
              );
            }
          }
          return (
            <li>
              {typeof children === 'string' ? hl(children) : children}
            </li>
          );
        },
        code: ({ className, children }) => {
          const lang = className?.replace('language-', '') || '';
          const text = String(children).replace(/\n$/, '');
          if (!className) {
            if (sidebarMode) {
              return <code className="chat-prose__code">{text}</code>;
            }
            return (
              <code style={{
                fontFamily: 'var(--font-mono, monospace)', fontSize: 13,
                background: '#0b1220', padding: '2px 6px', borderRadius: 4, color: '#4a9eff',
              }}>
                {text}
              </code>
            );
          }
          let highlighted = text;
          try {
            highlighted = lang && hljs.getLanguage(lang)
              ? hljs.highlight(text, { language: lang }).value
              : hljs.highlightAuto(text).value;
          } catch { /* fallback */ }
          return (
            <div style={{ margin: '12px 0', overflow: 'hidden', background: '#0b1220', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8 }}>
              {lang && (
                <div style={{
                  padding: '6px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)',
                  fontSize: 11, fontFamily: 'var(--font-mono, monospace)', color: '#64748b', textTransform: 'uppercase',
                }}>
                  {lang}
                </div>
              )}
              <pre style={{ margin: 0, padding: 12, fontFamily: 'var(--font-mono, monospace)', fontSize: 13, color: '#e2e8f0', overflowX: 'auto', lineHeight: 1.5 }}>
                <code dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(highlighted) }} />
              </pre>
            </div>
          );
        },
        img: ({ src, alt, title }) => {
          if (isVideo(src)) {
            return (
              <video
                src={src}
                title={title ?? alt ?? ''}
                controls
                preload="metadata"
                className="chat-prose__video"
                style={{ maxWidth: '100%', borderRadius: 12, display: 'block', margin: '8px 0' }}
              />
            );
          }
          if (isAudio(src)) {
            return (
              <audio
                src={src}
                title={title ?? alt ?? ''}
                controls
                preload="none"
                className="chat-prose__audio"
                style={{ width: '100%', margin: '8px 0' }}
              />
            );
          }
          return (
            <>
              <img src={src} alt={alt ?? ''} title={title} loading="lazy" className="chat-prose__img" />
              {alt ? <span className="chat-prose__caption">{alt}</span> : null}
            </>
          );
        },
        table: ({ children }) => {
          const teaser = teaserMode && !sidebarMode;
          return (
            <div className={teaser ? 'chat-prose-table-teaser' : 'chat-prose-table'}>
              <table>{children}</table>
              {teaser && onOpenWorkspace ? (
                <button type="button" className="chat-prose-table-workspace-link" data-qid="chat:markdown-table:workspace" onClick={onOpenWorkspace}>
                  ↗ View all{tableRowCount ? ` ${tableRowCount}` : ''} rows in Workspace
                </button>
              ) : null}
            </div>
          );
        },
        th: ({ children }) => <th>{children}</th>,
        td: ({ children }) => (
          <td>{typeof children === 'string' ? hl(children) : children}</td>
        ),
      }}
    >
      {processedContent}
    </ReactMarkdown>
    </div>
  );
});
