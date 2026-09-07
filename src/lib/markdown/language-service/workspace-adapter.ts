import { Emitter, type Event } from "vscode-languageserver-protocol";
import { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";
import type {
  FileStat,
  ITextDocument,
  IWorkspace,
} from "vscode-markdown-languageservice";
import type { WikiLinkTarget } from "@/lib/markdown/wiki";

export const INKEST_WORKSPACE_SCHEME = "inkest";
export const INKEST_WORKSPACE_ROOT = URI.parse(`${INKEST_WORKSPACE_SCHEME}:///notes`);

/**
 * Creates a canonical URI for an Inkest note given its identifier or slug.
 */
export function createNoteUri(noteIdOrSlug: string): URI {
  const safeId = encodeURIComponent(noteIdOrSlug.endsWith(".md") ? noteIdOrSlug : `${noteIdOrSlug}.md`);
  return URI.parse(`${INKEST_WORKSPACE_SCHEME}:///notes/${safeId}`);
}

/**
 * In-memory virtual workspace adapter for vscode-markdown-languageservice.
 * Bridges Inkest's database notes and active editor buffers into the VS Code Markdown Language Service.
 */
export class InkestWorkspaceAdapter implements IWorkspace {
  private readonly documents = new Map<string, ITextDocument>();
  private readonly documentVersions = new Map<string, number>();

  private readonly _onDidChange = new Emitter<ITextDocument>();
  private readonly _onDidCreate = new Emitter<ITextDocument>();
  private readonly _onDidDelete = new Emitter<URI>();

  readonly onDidChangeMarkdownDocument: Event<ITextDocument> = this._onDidChange.event;
  readonly onDidCreateMarkdownDocument: Event<ITextDocument> = this._onDidCreate.event;
  readonly onDidDeleteMarkdownDocument: Event<URI> = this._onDidDelete.event;

  get workspaceFolders(): readonly URI[] {
    return [INKEST_WORKSPACE_ROOT];
  }

  /**
   * Updates or registers a note in the workspace.
   */
  setDocument(uri: URI, content: string, version?: number): ITextDocument {
    const uriString = uri.toString();
    const currentVersion = version ?? (this.documentVersions.get(uriString) ?? 0) + 1;
    this.documentVersions.set(uriString, currentVersion);

    const isNew = !this.documents.has(uriString);
    const doc = TextDocument.create(uriString, "markdown", currentVersion, content);
    this.documents.set(uriString, doc);

    if (isNew) {
      this._onDidCreate.fire(doc);
    } else {
      this._onDidChange.fire(doc);
    }

    return doc;
  }

  /**
   * Deletes a note from the virtual workspace.
   */
  deleteDocument(uri: URI): void {
    const uriString = uri.toString();
    if (this.documents.delete(uriString)) {
      this.documentVersions.delete(uriString);
      this._onDidDelete.fire(uri);
    }
  }

  /**
   * Bulk synchronizes workspace notes metadata/targets.
   * If content is not known, sets a placeholder with note title heading.
   */
  syncWorkspaceNotes(
    targets: WikiLinkTarget[],
    activeNote?: { id: string; content: string }
  ): void {
    const currentUris = new Set<string>();

    for (const target of targets) {
      const uri = createNoteUri(target.slug || target.id);
      currentUris.add(uri.toString());

      // If this is the active note, use the live buffer content
      if (activeNote && (target.id === activeNote.id || target.slug === activeNote.id)) {
        this.setDocument(uri, activeNote.content);
      } else if (!this.documents.has(uri.toString())) {
        // Known note in workspace with basic heading stub so heading links resolve
        const stubContent = `# ${target.title}\n\n${target.excerpt ?? ""}`;
        this.setDocument(uri, stubContent);
      }
    }

    if (activeNote) {
      const activeUri = createNoteUri(activeNote.id);
      currentUris.add(activeUri.toString());
      this.setDocument(activeUri, activeNote.content);
    }
  }

  async getAllMarkdownDocuments(): Promise<Iterable<ITextDocument>> {
    return Array.from(this.documents.values());
  }

  hasMarkdownDocument(resource: URI): boolean {
    return this.documents.has(resource.toString());
  }

  async openMarkdownDocument(resource: URI): Promise<ITextDocument | undefined> {
    return this.documents.get(resource.toString());
  }

  async stat(resource: URI): Promise<FileStat | undefined> {
    const uriString = resource.toString();
    if (uriString === INKEST_WORKSPACE_ROOT.toString()) {
      return { isDirectory: true };
    }
    if (this.documents.has(uriString)) {
      return { isDirectory: false };
    }
    return undefined;
  }

  async readDirectory(resource: URI): Promise<Iterable<readonly [string, FileStat]>> {
    if (resource.toString() === INKEST_WORKSPACE_ROOT.toString()) {
      const results: Array<readonly [string, FileStat]> = [];
      for (const uriStr of this.documents.keys()) {
        const u = URI.parse(uriStr);
        const parts = u.path.split("/");
        const fileName = parts[parts.length - 1];
        if (fileName) {
          results.push([fileName, { isDirectory: false }]);
        }
      }
      return results;
    }
    return [];
  }

  dispose(): void {
    this._onDidChange.dispose();
    this._onDidCreate.dispose();
    this._onDidDelete.dispose();
    this.documents.clear();
    this.documentVersions.clear();
  }
}
