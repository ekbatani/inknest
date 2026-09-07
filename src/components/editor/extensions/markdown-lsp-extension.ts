import { linter, type Diagnostic as CmDiagnostic } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import type { Text } from "@codemirror/state";
import { autocompletion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import type { WikiLinkTarget } from "@/lib/markdown/wiki";
import {
  getMarkdownLanguageService,
  type WorkspaceHeadingSymbol,
} from "@/lib/markdown/language-service/service";

function lspPositionToOffset(doc: Text, pos: { line: number; character: number }): number {
  if (pos.line >= doc.lines) {
    return doc.length;
  }
  const line = doc.line(pos.line + 1);
  return Math.min(line.from + pos.character, line.to);
}

export interface MarkdownLspExtensionOptions {
  noteId?: string;
  workspaceNotes?: WikiLinkTarget[];
  onDiagnostics?: (diagnostics: CmDiagnostic[]) => void;
  debounceMs?: number;
}

/**
 * Creates a CodeMirror 6 extension that integrates Microsoft's vscode-markdown-languageservice.
 * Provides:
 * - Real-time diagnostics (e.g. broken header anchors, dead local links)
 * - Workspace heading completions triggered by typing `##`
 */
export function createMarkdownLspExtension(options: MarkdownLspExtensionOptions = {}): Extension {
  const { noteId = "active-note", workspaceNotes = [], onDiagnostics, debounceMs = 500 } = options;

  const lspLinter = linter(
    async (view) => {
      const service = getMarkdownLanguageService();
      if (workspaceNotes.length > 0) {
        service.syncWorkspace(workspaceNotes, {
          id: noteId,
          content: view.state.doc.toString(),
        });
      }

      const content = view.state.doc.toString();
      const lspDiagnostics = await service.computeDiagnostics(noteId, content);

      const cmDiagnostics: CmDiagnostic[] = [];

      for (const diag of lspDiagnostics) {
        const from = lspPositionToOffset(view.state.doc, diag.range.start);
        const to = lspPositionToOffset(view.state.doc, diag.range.end);

        // Ensure valid range
        if (from <= to && to <= view.state.doc.length) {
          const messageStr =
            typeof diag.message === "string"
              ? diag.message
              : diag.message.value;

          cmDiagnostics.push({
            from,
            to: from === to ? Math.min(from + 1, view.state.doc.length) : to,
            severity: diag.severity === 1 ? "error" : "warning",
            message: messageStr,
            source: "VSCode-Markdown-LSP",
          });
        }
      }

      onDiagnostics?.(cmDiagnostics);
      return cmDiagnostics;
    },
    { delay: debounceMs }
  );

  const headingCompletion = autocompletion({
    override: [
      async (context: CompletionContext): Promise<CompletionResult | null> => {
        // Trigger workspace heading completion on ##
        const match = context.matchBefore(/##[\w\s\u0600-\u06FF\-]*/);
        if (!match && !context.explicit) {
          return null;
        }

        const query = match ? match.text.slice(2).trim().toLowerCase() : "";
        const service = getMarkdownLanguageService();
        if (workspaceNotes.length > 0) {
          service.syncWorkspace(workspaceNotes);
        }

        const headings: WorkspaceHeadingSymbol[] = await service.getWorkspaceHeadings(query);

        if (headings.length === 0) {
          return null;
        }

        return {
          from: match ? match.from : context.pos,
          options: headings.map((h) => ({
            label: `## ${h.headingText}`,
            detail: h.noteTitle,
            type: "text",
            boost: 99,
            apply: (view, completion, from, to) => {
              // If note is current note, insert local anchor link; else cross-note link
              const isCurrent = h.noteId === noteId;
              const linkText = isCurrent
                ? `[${h.headingText}](#${h.anchorId})`
                : `[[${h.noteTitle}#${h.headingText}]]`;
              view.dispatch({
                changes: { from, to, insert: linkText },
              });
            },
          })),
        };
      },
    ],
  });

  return [lspLinter, headingCompletion];
}
