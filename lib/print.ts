"use client";

export interface PrintRequest {
  title: string;
  filename?: string;
  labelMode?: boolean;
}

export interface PrintPreviewPayload {
  title: string;
  filename: string;
  html: string;
  labelMode: boolean;
}

type PreviewHandler = (payload: PrintPreviewPayload) => void;

let previewHandler: PreviewHandler | null = null;

export function registerPrintPreviewHandler(handler: PreviewHandler | null) {
  previewHandler = handler;
}

export function capturePrintableHtml(labelMode = false): string {
  if (typeof document === "undefined") return "";
  const selector = labelMode ? "[data-print-labels]" : "[data-print-area]";
  const el = document.querySelector(selector);
  if (!el) return "";
  return el.innerHTML;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function collectInlineStyles(): Promise<string> {
  if (typeof document === "undefined") return "";
  const parts: string[] = [];

  const styleNodes = Array.from(document.querySelectorAll("style"));
  for (const node of styleNodes) {
    if (node.textContent) {
      parts.push(node.textContent);
    }
  }

  const linkNodes = Array.from(
    document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')
  );
  const fetched = await Promise.all(
    linkNodes.map(async (link) => {
      try {
        const res = await fetch(link.href, { cache: "force-cache" });
        if (!res.ok) return "";
        return await res.text();
      } catch {
        return "";
      }
    })
  );

  for (const css of fetched) {
    if (css) parts.push(css);
  }

  return parts.join("\n");
}

export async function buildStandalonePrintHtml(
  payload: PrintPreviewPayload
): Promise<string> {
  const styles = await collectInlineStyles();
  const safeTitle = escapeHtml(payload.title);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle} — BCAS Library</title>
  <style>
${styles}
    body {
      background: #f1f5f9;
      margin: 0;
      padding: 24px 16px;
      color: #0f172a;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .standalone-toolbar {
      max-width: 960px;
      margin: 0 auto 16px auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 12px 16px;
    }
    .standalone-paper {
      max-width: 960px;
      margin: 0 auto;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 28px 32px;
      box-shadow: 0 4px 20px rgba(15, 23, 42, 0.06);
    }
    .standalone-btn {
      background: #047857;
      color: #ffffff;
      border: none;
      border-radius: 8px;
      padding: 8px 16px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }
    .standalone-btn:hover {
      background: #065f46;
    }
    @media print {
      body {
        background: #ffffff !important;
        padding: 0 !important;
      }
      .standalone-toolbar {
        display: none !important;
      }
      .standalone-paper {
        max-width: none !important;
        border: none !important;
        border-radius: 0 !important;
        box-shadow: none !important;
        padding: 0 !important;
      }
    }
  </style>
</head>
<body>
  <div class="standalone-toolbar no-print">
    <div>
      <strong style="font-size:14px;color:#0f172a;">BCAS Library — ${safeTitle}</strong>
      <div style="font-size:12px;color:#64748b;">Use your browser Print dialog to print on paper or Save as PDF.</div>
    </div>
    <button type="button" class="standalone-btn" onclick="window.print()">Print / Save as PDF</button>
  </div>
  <div class="standalone-paper">
    <div class="print-preview-sheet" data-label-mode="${payload.labelMode ? "true" : "false"}">
      ${payload.html}
    </div>
  </div>
  <script>
    window.addEventListener("load", function () {
      setTimeout(function () {
        try { window.print(); } catch (e) {}
      }, 250);
    });
  </script>
</body>
</html>`;
}

export function openPrintPreview(options: PrintRequest): boolean {
  const html = capturePrintableHtml(!!options.labelMode);
  if (!html || !previewHandler) return false;

  previewHandler({
    title: options.title,
    filename:
      options.filename ??
      `${options.title.toLowerCase().replace(/[^a-z0-9]+/g, "_")}.html`,
    html,
    labelMode: !!options.labelMode,
  });
  return true;
}

/**
 * Triggers native browser printing when allowed; if inside a sandboxed preview
 * iframe that silently blocks `window.print()` (never firing `beforeprint`),
 * automatically opens the in-app Print Preview modal instead.
 */
export function requestPrint(options: PrintRequest): void {
  if (typeof window === "undefined") return;

  const labelMode = !!options.labelMode;
  const html = capturePrintableHtml(labelMode);
  const payload: PrintPreviewPayload = {
    title: options.title,
    filename:
      options.filename ??
      `${options.title.toLowerCase().replace(/[^a-z0-9]+/g, "_")}.html`,
    html,
    labelMode,
  };

  if (labelMode) {
    document.body.classList.add("print-label-mode");
  }

  let beforePrintFired = false;
  let cleanedUp = false;

  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (labelMode) {
      document.body.classList.remove("print-label-mode");
    }
    window.removeEventListener("beforeprint", onBeforePrint);
    window.removeEventListener("afterprint", onAfterPrint);
  };

  const onBeforePrint = () => {
    beforePrintFired = true;
  };

  const onAfterPrint = () => {
    cleanup();
  };

  window.addEventListener("beforeprint", onBeforePrint);
  window.addEventListener("afterprint", onAfterPrint);

  try {
    window.print();
  } catch {
    cleanup();
    if (html && previewHandler) {
      previewHandler(payload);
    }
    return;
  }

  // In sandboxed iframes without allow-modals, `window.print()` is ignored
  // silently without firing `beforeprint` or blocking execution.
  window.setTimeout(() => {
    if (!beforePrintFired) {
      cleanup();
      if (html && previewHandler) {
        previewHandler(payload);
      }
    }
  }, 150);
}
