import MarkdownIt from "markdown-it";
import { CancellationTokenSource, type Diagnostic } from "vscode-languageserver-protocol";
import {
  createLanguageService,
  githubSlugifier,
  DiagnosticLevel,
  type DiagnosticOptions,
  type ILogger,
  type IMdLanguageService,
  type IMdParser,
  LogLevel,
} from "vscode-markdown-languageservice";
import type { WikiLinkTarget } from "@/lib/markdown/wiki";
import {
  InkestWorkspaceAdapter,
  createNoteUri,
} from "./workspace-adapter";

export interface WorkspaceHeadingSymbol {
  noteId: string;
  noteTitle: string;
  headingText: string;
  anchorId: string;
  level: number;
}

export const defaultDiagnosticOptions: DiagnosticOptions = {
  validateReferences: DiagnosticLevel.warning,
  validateFragmentLinks: DiagnosticLevel.warning,
  validateFileLinks: DiagnosticLevel.warning,
  validateMarkdownFileLinkFragments: DiagnosticLevel.warning,
  validateUnusedLinkDefinitions: DiagnosticLevel.hint,
  validateDuplicateLinkDefinitions: DiagnosticLevel.warning,
  ignoreLinks: ["http://*", "https://*", "mailto:*"],
};

/**
 * High-level Inkest semantic Markdown Language Service.
 * Bundles VS Code's Markdown Language Service with an in-memory Inkest workspace adapter.
 */
export class InkestMarkdownLanguageService {
  readonly workspace: InkestWorkspaceAdapter;
  readonly service: IMdLanguageService;

  constructor() {
    this.workspace = new InkestWorkspaceAdapter();

    const mdIt = new MarkdownIt({ html: true });
    const parser: IMdParser = {
      slugifier: githubSlugifier,
      async tokenize(document) {
        return mdIt.parse(document.getText(), {});
      },
    };

    const logger: ILogger = {
      level: LogLevel.Off,
      log() {},
    };

    this.service = createLanguageService({
      workspace: this.workspace,
      parser,
      logger,
    });
  }

  /**
   * Synchronizes known notes and active document content in the workspace.
   */
  syncWorkspace(
    notes: WikiLinkTarget[],
    activeNote?: { id: string; content: string }
  ): void {
    this.workspace.syncWorkspaceNotes(notes, activeNote);
  }

  /**
   * Computes diagnostics (e.g. broken header links, missing local files, duplicate definitions).
   */
  async computeDiagnostics(
    noteId: string,
    content: string,
    options: DiagnosticOptions = defaultDiagnosticOptions
  ): Promise<Diagnostic[]> {
    const uri = createNoteUri(noteId);
    const doc = this.workspace.setDocument(uri, content);

    const cts = new CancellationTokenSource();
    try {
      return await this.service.computeDiagnostics(doc, options, cts.token);
    } finally {
      cts.dispose();
    }
  }

  /**
   * Retrieves all Markdown heading symbols in the active note.
   */
  async getDocumentHeadings(noteId: string, content: string) {
    const uri = createNoteUri(noteId);
    const doc = this.workspace.setDocument(uri, content);

    const cts = new CancellationTokenSource();
    try {
      const symbols = await this.service.getDocumentSymbols(
        doc,
        { includeLinkDefinitions: false },
        cts.token
      );
      return symbols;
    } finally {
      cts.dispose();
    }
  }

  /**
   * Retrieves all heading symbols across all markdown notes in the workspace.
   */
  async getWorkspaceHeadings(query = ""): Promise<WorkspaceHeadingSymbol[]> {
    const cts = new CancellationTokenSource();
    try {
      const symbols = await this.service.getWorkspaceSymbols(query, cts.token);
      const results: WorkspaceHeadingSymbol[] = [];

      for (const sym of symbols) {
        const docUri = sym.location.uri;
        const parts = docUri.split("/");
        const fileName = parts[parts.length - 1] || "";
        const noteId = decodeURIComponent(fileName.replace(/\.md$/, ""));

        const rawName = sym.name;
        const match = rawName.match(/^(#+)\s*(.*)$/);
        const level = match ? match[1].length : 1;
        const headingText = match ? match[2].trim() : rawName.trim();
        const slug = githubSlugifier.fromHeading(headingText).value;

        results.push({
          noteId,
          noteTitle: noteId,
          headingText,
          anchorId: slug,
          level,
        });
      }

      return results;
    } finally {
      cts.dispose();
    }
  }

  /**
   * Calculates rename text edits when a heading or link is renamed.
   */
  async getRenameEdits(
    noteId: string,
    content: string,
    line: number,
    character: number,
    newName: string
  ) {
    const uri = createNoteUri(noteId);
    const doc = this.workspace.setDocument(uri, content);

    const cts = new CancellationTokenSource();
    try {
      return await this.service.getRenameEdit(
        doc,
        { line, character },
        newName,
        cts.token
      );
    } finally {
      cts.dispose();
    }
  }

  dispose(): void {
    this.service.dispose();
    this.workspace.dispose();
  }
}

// Global singleton instance for easy client/worker reuse
let globalService: InkestMarkdownLanguageService | null = null;

export function getMarkdownLanguageService(): InkestMarkdownLanguageService {
  if (!globalService) {
    globalService = new InkestMarkdownLanguageService();
  }
  return globalService;
}
