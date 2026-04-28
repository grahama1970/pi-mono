import type { ReactNode } from "react";
import "./JsonCodeBlock.css";

type JsonCodeBlockProps = {
  content: string;
  className?: string;
};

function renderJsonSyntax(content: string): ReactNode {
  const tokenPattern =
    /("(?:\\u[\dA-Fa-f]{4}|\\[^u]|[^\\"])*"(?=\s*:)|"(?:\\u[\dA-Fa-f]{4}|\\[^u]|[^\\"])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|\btrue\b|\bfalse\b|\bnull\b|[{}:,]|\[|\])/g;
  const nodes: ReactNode[] = [];
  let cursor = 0;

  for (const match of content.matchAll(tokenPattern)) {
    const token = match[0];
    const index = match.index ?? 0;
    if (index > cursor) nodes.push(content.slice(cursor, index));

    const tokenClass = token.startsWith("\"")
      ? /^\s*:/.test(content.slice(index + token.length)) ? "ux-json-code-block__key" : "ux-json-code-block__string"
      : token === "true" || token === "false"
        ? "ux-json-code-block__boolean"
        : token === "null"
          ? "ux-json-code-block__null"
          : /^-?\d/.test(token)
            ? "ux-json-code-block__number"
            : "ux-json-code-block__punctuation";

    nodes.push(
      <span key={`${index}-${token}`} className={tokenClass}>
        {token}
      </span>,
    );
    cursor = index + token.length;
  }

  if (cursor < content.length) nodes.push(content.slice(cursor));
  return nodes;
}

export function JsonCodeBlock({ content, className }: JsonCodeBlockProps) {
  return (
    <pre className={`ux-json-code-block${className ? ` ${className}` : ""}`}>
      {renderJsonSyntax(content)}
    </pre>
  );
}
