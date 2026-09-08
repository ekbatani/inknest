import { describe, expect, it } from "bun:test";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { autocompletion, CompletionContext } from "@codemirror/autocomplete";
import { createLivePreviewExtension } from "../extensions/live-preview-extension";
import {
  createMarkdownLspExtension,
  createWorkspaceHeadingCompletionSource,
} from "../extensions/markdown-lsp-extension";

describe("Editor Extensions", () => {
  it("should create live preview extension cleanly", () => {
    const extension = createLivePreviewExtension();
    expect(extension).toBeDefined();

    const state = EditorState.create({
      doc: "# Heading 1\n\nSome **bold** text and *italic*.\n\n- [ ] Task item",
      extensions: [markdown(), extension],
    });

    expect(state.doc.toString()).toContain("# Heading 1");
  });

  it("should create markdown LSP extension cleanly", () => {
    const lspExt = createMarkdownLspExtension({
      noteId: "test-note",
      workspaceNotes: [{ id: "n1", slug: "n1", title: "Note 1" }],
    });
    expect(lspExt).toBeDefined();

    const state = EditorState.create({
      doc: "# Header\n\n[Link](#header)",
      extensions: [markdown(), lspExt],
    });

    expect(state.doc.length > 0).toBe(true);
  });

  it("should not crash with Config merge conflict when combined with autocompletion", () => {
    const lspExt = createMarkdownLspExtension({
      noteId: "test-note",
      workspaceNotes: [{ id: "n1", slug: "n1", title: "Note 1" }],
    });

    const completionSource = createWorkspaceHeadingCompletionSource("test-note", [
      { id: "n1", slug: "n1", title: "Note 1" },
    ]);

    let state: EditorState | null = null;
    let createError: Error | null = null;
    try {
      state = EditorState.create({
        doc: "# Header\n\n[Link](#header)",
        extensions: [
          markdown(),
          autocompletion({
            override: [completionSource],
          }),
          lspExt,
        ],
      });
    } catch (err) {
      createError = err as Error;
    }

    expect(createError).toBeNull();
    expect(state).toBeDefined();
  });

  it("should not trigger heading completion when user writes a standard H2 heading", async () => {
    const source = createWorkspaceHeadingCompletionSource("test-note", [
      { id: "n1", slug: "n1", title: "Note 1" },
    ]);

    const docWithH2 = "# Title\n## ";
    const stateH2 = EditorState.create({
      doc: docWithH2,
      extensions: [markdown()],
    });

    const contextH2 = new CompletionContext(stateH2, docWithH2.length, false);
    const resultH2 = await source(contextH2);

    expect(resultH2).toBeNull();
  });
});
