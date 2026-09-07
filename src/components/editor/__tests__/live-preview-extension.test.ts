import { describe, expect, it } from "bun:test";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { createLivePreviewExtension } from "../extensions/live-preview-extension";
import { createMarkdownLspExtension } from "../extensions/markdown-lsp-extension";

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
});
