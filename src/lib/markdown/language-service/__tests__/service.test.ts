import { describe, expect, it } from "bun:test";
import { InkestMarkdownLanguageService } from "../service";

describe("InkestMarkdownLanguageService", () => {
  it("should extract document heading symbols", async () => {
    const lsp = new InkestMarkdownLanguageService();
    const markdown = `# Main Title\n\nSome text.\n\n## Sub Section\n\nMore text.\n\n### Deep Subsection`;

    const symbols = await lsp.getDocumentHeadings("test-doc", markdown);
    expect(symbols.length > 0).toBe(true);
    expect(symbols[0].name).toBe("# Main Title");
    expect(symbols[0].children?.[0]?.name).toBe("## Sub Section");

    lsp.dispose();
  });

  it("should detect broken anchor fragment links", async () => {
    const lsp = new InkestMarkdownLanguageService();
    const markdown = `# Existing Section\n\n[Valid link](#existing-section)\n\n[Broken link](#missing-section)`;

    const diagnostics = await lsp.computeDiagnostics("test-doc", markdown);
    expect(diagnostics.length > 0).toBe(true);
    const brokenDiag = diagnostics.find((d) => {
      const msg = typeof d.message === "string" ? d.message : d.message.value;
      return (
        msg.toLowerCase().includes("missing-section") ||
        d.code === "link.no-such-header-in-own-file"
      );
    });
    expect(brokenDiag).toBeDefined();

    lsp.dispose();
  });

  it("should index and return workspace headings across notes", async () => {
    const lsp = new InkestMarkdownLanguageService();
    lsp.syncWorkspace([
      { id: "note-1", slug: "note-1", title: "Project Alpha", excerpt: "Details" },
      { id: "note-2", slug: "note-2", title: "Architecture Guide", excerpt: "Guide" },
    ]);

    const headings = await lsp.getWorkspaceHeadings();
    expect(headings.length >= 2).toBe(true);
    expect(headings.some((h) => h.headingText === "Project Alpha")).toBe(true);
    expect(headings.some((h) => h.headingText === "Architecture Guide")).toBe(true);
    expect(headings.every((h) => h.level === 1)).toBe(true);

    lsp.dispose();
  });

  it("should calculate rename edits when renaming a header with references", async () => {
    const lsp = new InkestMarkdownLanguageService();
    const markdown = `# Introduction\n\nSee [the intro](#introduction) for background.`;
    
    // Position on line 0, char 3 ("# In[t]roduction")
    const renameEdit = await lsp.getRenameEdits("doc-rename", markdown, 0, 3, "Overview");
    expect(renameEdit).toBeDefined();

    // Edits update both the header definition AND the link reference!
    const edits = renameEdit?.documentChanges?.[0] && "edits" in renameEdit.documentChanges[0]
      ? renameEdit.documentChanges[0].edits
      : [];
    expect(edits.length).toBe(2);
    const firstEdit = edits[0] as { newText?: string } | undefined;
    const secondEdit = edits[1] as { newText?: string } | undefined;
    expect(firstEdit?.newText).toBe("Overview");
    expect(secondEdit?.newText).toBe("overview");

    lsp.dispose();
  });
});

