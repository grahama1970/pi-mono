/**
 * MarkdownRenderer — Shared markdown rendering with entity highlighting + syntax highlighting.
 * Used by Embry Terminal and SPARTA Explorer chat.
 */
import { memo } from 'react';
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
import { highlightEntities } from './highlightEntities';
import type { EntityType } from './types';

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
}

export const MarkdownRenderer = memo(function MarkdownRenderer({ content, onEntityClick }: MarkdownRendererProps) {
  const hl = (text: string) => highlightEntities(text, onEntityClick);

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => (
          <p style={{ margin: '4px 0' }}>
            {typeof children === 'string' ? hl(children) : children}
          </p>
        ),
        strong: ({ children }) => (
          <strong style={{ fontWeight: 700, color: '#f8fafc' }}>
            {typeof children === 'string' ? hl(children) : children}
          </strong>
        ),
        li: ({ children }) => (
          <li style={{ margin: '2px 0' }}>
            {typeof children === 'string' ? hl(children) : children}
          </li>
        ),
        code: ({ className, children }) => {
          const lang = className?.replace('language-', '') || '';
          const text = String(children).replace(/\n$/, '');
          if (!className) {
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
        table: ({ children }) => (
          <div style={{ margin: '12px 0', overflow: 'hidden', background: '#0b1220', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8 }}>
            <table style={{ width: '100%', fontSize: 13, fontFamily: 'var(--font-mono, monospace)', borderCollapse: 'collapse' }}>{children}</table>
          </div>
        ),
        th: ({ children }) => (
          <th style={{
            padding: '8px 12px', textAlign: 'left', fontSize: 10, fontWeight: 600,
            color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5,
            background: '#0b1220', borderBottom: '1px solid rgba(255,255,255,0.1)',
          }}>
            {children}
          </th>
        ),
        td: ({ children }) => {
          const text = String(children || '');
          let color = '#e2e8f0';
          if (text.includes('✅') || text.includes('Pass')) color = '#00ff88';
          else if (text.includes('❌') || text.includes('Fail')) color = '#ff4444';
          else if (text.includes('⚠️') || text.includes('Warn')) color = '#ffaa00';
          return (
            <td style={{
              padding: '6px 12px', color, fontSize: 12,
              borderBottom: '1px solid rgba(255,255,255,0.04)',
            }}>
              {typeof children === 'string' ? hl(children) : children}
            </td>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
});
