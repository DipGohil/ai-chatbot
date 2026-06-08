const LANG_LABELS = {
  python: "Python",
  py: "Python",
  javascript: "JavaScript",
  js: "JavaScript",
  typescript: "TypeScript",
  ts: "TypeScript",
  bash: "Bash",
  sh: "Shell",
  shell: "Shell",
  json: "JSON",
  html: "HTML",
  css: "CSS",
  sql: "SQL",
  java: "Java",
  go: "Go",
  rust: "Rust",
  cpp: "C++",
  c: "C",
};

const COPY_ICON =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

const CODE_ICON =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M16 18l6-6-6-6"/><path d="M8 6l-6 6 6 6"/></svg>';

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function formatInlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
}

function flushList(items, ordered) {
  if (items.length === 0) return "";
  const tag = ordered ? "ol" : "ul";
  const renderedItems = items
    .map((item) => `<li>${formatInlineMarkdown(item)}</li>`)
    .join("");
  items.length = 0;
  return `<${tag}>${renderedItems}</${tag}>`;
}

function parseTableCells(line) {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return null;

  let cells = trimmed.split("|").map((cell) => cell.trim());
  if (trimmed.startsWith("|")) cells = cells.slice(1);
  if (trimmed.endsWith("|")) cells = cells.slice(0, -1);

  return cells.length > 0 ? cells : null;
}

function isTableRow(line) {
  return parseTableCells(line) !== null;
}

function isTableSeparator(line) {
  const cells = parseTableCells(line);
  if (!cells) return false;
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function tableCellAlign(cell) {
  if (/^:-+:$/.test(cell)) return "center";
  if (/^-+:$/.test(cell)) return "right";
  return "left";
}

function renderTable(tableLines) {
  if (tableLines.length < 2) return null;

  const headerCells = parseTableCells(tableLines[0]);
  if (!headerCells) return null;

  const hasSeparator = isTableSeparator(tableLines[1]);
  const alignments = hasSeparator
    ? parseTableCells(tableLines[1]).map(tableCellAlign)
    : headerCells.map(() => "left");
  const bodyLines = hasSeparator ? tableLines.slice(2) : tableLines.slice(1);

  const alignAttr = (index) => {
    const align = alignments[index] ?? "left";
    return align === "left" ? "" : ` style="text-align:${align}"`;
  };

  const thead = `<thead><tr>${headerCells
    .map(
      (cell, index) =>
        `<th${alignAttr(index)}>${formatInlineMarkdown(cell)}</th>`
    )
    .join("")}</tr></thead>`;

  const bodyRows = bodyLines
    .filter((line) => isTableRow(line) && !isTableSeparator(line))
    .map((line) => parseTableCells(line))
    .filter(Boolean);

  const tbody =
    bodyRows.length > 0
      ? `<tbody>${bodyRows
          .map(
            (cells) =>
              `<tr>${cells
                .map(
                  (cell, index) =>
                    `<td${alignAttr(index)}>${formatInlineMarkdown(cell)}</td>`
                )
                .join("")}</tr>`
          )
          .join("")}</tbody>`
      : "";

  return `<div class="message__table-wrap"><table class="message__table">${thead}${tbody}</table></div>`;
}

function parseFenceOpen(line) {
  const match = line.trim().match(/^```([\w#+.:-]*)$/);
  return match ? match[1].toLowerCase() : null;
}

function isFenceClose(line) {
  return /^```\s*$/.test(line.trim());
}

function isHorizontalRule(line) {
  return /^(\*{3,}|-{3,}|_{3,})\s*$/.test(line.trim());
}

function formatLangLabel(lang) {
  if (!lang || lang === "text" || lang === "output") return "";
  return LANG_LABELS[lang] ?? lang.charAt(0).toUpperCase() + lang.slice(1);
}

function isStructuredCodeLang(lang) {
  return Boolean(lang) && lang !== "text" && lang !== "output";
}

function renderCopyButton(compact = false) {
  const label = compact
    ? ""
    : '<span class="md-copy__label">Copy</span>';
  return `<button type="button" class="md-copy${compact ? " md-copy--icon" : ""}" data-copy-code aria-label="Copy code">${COPY_ICON}${label}</button>`;
}

function renderCodeBlock(code, lang) {
  const escaped = escapeHtml(code.replace(/\n$/, ""));
  const label = formatLangLabel(lang);

  if (isStructuredCodeLang(lang)) {
    return `<div class="md-code"><div class="md-code__header"><span class="md-code__lang">${CODE_ICON}<span>${label}</span></span>${renderCopyButton()}</div><pre class="md-code__pre"><code>${escaped}</code></pre></div>`;
  }

  return `<div class="md-output">${renderCopyButton(true)}<pre class="md-output__pre"><code>${escaped}</code></pre></div>`;
}

export function formatMarkdown(text) {
  const lines = text.split("\n");
  const blocks = [];
  const unordered = [];
  const ordered = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trimEnd();
    const fenceLang = parseFenceOpen(line);

    if (fenceLang !== null || line.trim() === "```") {
      const lang = fenceLang ?? "";
      const codeLines = [];

      blocks.push(flushList(unordered, false), flushList(ordered, true));

      i += 1;
      while (i < lines.length && !isFenceClose(lines[i])) {
        codeLines.push(lines[i]);
        i += 1;
      }

      if (codeLines.length > 0 || lang) {
        blocks.push(renderCodeBlock(codeLines.join("\n"), lang));
      }
      continue;
    }

    if (isTableRow(line)) {
      const tableLines = [];
      while (i < lines.length && isTableRow(lines[i].trimEnd())) {
        tableLines.push(lines[i].trimEnd());
        i += 1;
      }
      i -= 1;

      blocks.push(flushList(unordered, false), flushList(ordered, true));
      const tableHtml = renderTable(tableLines);
      if (tableHtml) {
        blocks.push(tableHtml);
      } else {
        for (const tableLine of tableLines) {
          blocks.push(`<p>${formatInlineMarkdown(tableLine)}</p>`);
        }
      }
      continue;
    }

    if (isHorizontalRule(line)) {
      blocks.push(flushList(unordered, false), flushList(ordered, true));
      blocks.push('<hr class="message__hr" />');
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    const number = line.match(/^\s*\d+[.)]\s+(.+)$/);

    if (heading) {
      blocks.push(flushList(unordered, false), flushList(ordered, true));
      blocks.push(
        `<h${heading[1].length} class="message__heading">${formatInlineMarkdown(
          heading[2]
        )}</h${heading[1].length}>`
      );
      continue;
    }

    if (bullet) {
      blocks.push(flushList(ordered, true));
      unordered.push(bullet[1]);
      continue;
    }

    if (number) {
      blocks.push(flushList(unordered, false));
      ordered.push(number[1]);
      continue;
    }

    blocks.push(flushList(unordered, false), flushList(ordered, true));
    if (line.trim()) {
      blocks.push(`<p>${formatInlineMarkdown(line)}</p>`);
    } else {
      blocks.push("");
    }
  }

  blocks.push(flushList(unordered, false), flushList(ordered, true));
  return blocks.filter((block) => block !== "").join("");
}

export async function copyCodeFromButton(button) {
  const container = button.closest(".md-code, .md-output");
  const code = container?.querySelector("code");
  if (!code) return false;

  await navigator.clipboard.writeText(code.textContent);

  const label = button.querySelector(".md-copy__label");
  if (label) {
    const previous = label.textContent;
    label.textContent = "Copied!";
    button.classList.add("md-copy--done");
    setTimeout(() => {
      label.textContent = previous;
      button.classList.remove("md-copy--done");
    }, 1800);
  }

  return true;
}
