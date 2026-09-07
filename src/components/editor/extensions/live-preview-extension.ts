import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { EditorState, Extension, Range } from "@codemirror/state";

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean, readonly pos: number) {
    super();
  }

  eq(other: CheckboxWidget): boolean {
    return this.checked === other.checked && this.pos === other.pos;
  }

  toDOM(view: EditorView): HTMLElement {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = this.checked;
    input.className = "cm-live-checkbox cursor-pointer inline-block mx-1.5 align-middle accent-primary h-4 w-4 rounded";

    input.addEventListener("click", (e) => {
      e.stopPropagation();
      const currentChecked = this.checked;
      const targetText = currentChecked ? "[ ]" : "[x]";

      view.dispatch({
        changes: {
          from: this.pos,
          to: this.pos + 3,
          insert: targetText,
        },
      });
    });

    return input;
  }
}

function selectionOverlaps(state: EditorState, from: number, to: number): boolean {
  for (const range of state.selection.ranges) {
    // Add 1 char padding so cursor adjacent to the marker still reveals it
    if (range.from <= to + 1 && range.to >= from - 1) {
      return true;
    }
  }
  return false;
}

function buildLivePreviewDecorations(view: EditorView): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  const state = view.state;
  const tree = syntaxTree(state);

  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter(node) {
        const name = node.name;
        const nodeFrom = node.from;
        const nodeTo = node.to;

        // 1. Headings (e.g. ATXHeading1, ATXHeading2, ATXHeading3)
        if (name.startsWith("ATXHeading")) {
          const levelMatch = name.match(/ATXHeading([1-6])/);
          const level = levelMatch ? parseInt(levelMatch[1], 10) : 1;
          const line = state.doc.lineAt(nodeFrom);

          // If cursor is not on this line, apply live preview heading styling
          const isCursorOnLine = selectionOverlaps(state, line.from, line.to);
          if (!isCursorOnLine) {
            // Find the HeaderMark (the `#` symbols)
            const firstChild = node.node.firstChild;
            if (firstChild && firstChild.name === "HeaderMark") {
              const markEnd = Math.min(firstChild.to + 1, line.to); // Include the trailing space
              decorations.push(
                Decoration.replace({}).range(firstChild.from, markEnd)
              );
            }

            const headingClass =
              level === 1
                ? "cm-live-h1 font-bold text-2xl tracking-tight leading-snug"
                : level === 2
                ? "cm-live-h2 font-semibold text-xl tracking-tight leading-snug"
                : level === 3
                ? "cm-live-h3 font-semibold text-lg leading-normal"
                : "cm-live-h font-medium text-base leading-normal";

            decorations.push(
              Decoration.line({
                class: headingClass,
              }).range(line.from)
            );
          }
          return;
        }

        // 2. Bold / StrongEmphasis (**text** or __text__)
        if (name === "StrongEmphasis") {
          if (!selectionOverlaps(state, nodeFrom, nodeTo)) {
            // Replace opening and closing markers (** or __)
            if (nodeTo - nodeFrom >= 4) {
              decorations.push(Decoration.replace({}).range(nodeFrom, nodeFrom + 2));
              decorations.push(
                Decoration.mark({ class: "cm-live-bold font-bold" }).range(
                  nodeFrom + 2,
                  nodeTo - 2
                )
              );
              decorations.push(Decoration.replace({}).range(nodeTo - 2, nodeTo));
            }
          }
          return;
        }

        // 3. Italic / Emphasis (*text* or _text_)
        if (name === "Emphasis") {
          if (!selectionOverlaps(state, nodeFrom, nodeTo)) {
            if (nodeTo - nodeFrom >= 2) {
              decorations.push(Decoration.replace({}).range(nodeFrom, nodeFrom + 1));
              decorations.push(
                Decoration.mark({ class: "cm-live-italic italic" }).range(
                  nodeFrom + 1,
                  nodeTo - 1
                )
              );
              decorations.push(Decoration.replace({}).range(nodeTo - 1, nodeTo));
            }
          }
          return;
        }

        // 4. Strikethrough (~~text~~)
        if (name === "Strikethrough") {
          if (!selectionOverlaps(state, nodeFrom, nodeTo)) {
            if (nodeTo - nodeFrom >= 4) {
              decorations.push(Decoration.replace({}).range(nodeFrom, nodeFrom + 2));
              decorations.push(
                Decoration.mark({ class: "cm-live-strike line-through opacity-75" }).range(
                  nodeFrom + 2,
                  nodeTo - 2
                )
              );
              decorations.push(Decoration.replace({}).range(nodeTo - 2, nodeTo));
            }
          }
          return;
        }

        // 5. Inline Code (`code`)
        if (name === "InlineCode") {
          if (!selectionOverlaps(state, nodeFrom, nodeTo)) {
            if (nodeTo - nodeFrom >= 2) {
              decorations.push(Decoration.replace({}).range(nodeFrom, nodeFrom + 1));
              decorations.push(
                Decoration.mark({
                  class:
                    "cm-live-inline-code bg-muted/60 text-primary px-1.5 py-0.5 rounded font-mono text-sm",
                }).range(nodeFrom + 1, nodeTo - 1)
              );
              decorations.push(Decoration.replace({}).range(nodeTo - 1, nodeTo));
            }
          }
          return;
        }

        // 6. Interactive Task Checklist ([ ] or [x])
        if (name === "TaskMarker") {
          const markerText = state.doc.sliceString(nodeFrom, nodeTo);
          const isChecked = markerText.toLowerCase().includes("x");
          decorations.push(
            Decoration.replace({
              widget: new CheckboxWidget(isChecked, nodeFrom),
            }).range(nodeFrom, nodeTo)
          );
          return;
        }

        // 7. Horizontal Rule (---, ***, ___)
        if (name === "HorizontalRule") {
          const line = state.doc.lineAt(nodeFrom);
          if (!selectionOverlaps(state, line.from, line.to)) {
            decorations.push(
              Decoration.line({
                class: "cm-live-hr border-b border-border my-3 block",
              }).range(line.from)
            );
          }
          return;
        }
      },
    });
  }

  // CodeMirror requires decorations to be sorted by from ascending
  decorations.sort((a, b) => a.from - b.from || (a.value.startSide ?? 0) - (b.value.startSide ?? 0));
  return Decoration.set(decorations);
}

const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildLivePreviewDecorations(view);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet
      ) {
        this.decorations = buildLivePreviewDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);

/**
 * CodeMirror 6 Live-Preview (in-place WYSIWYG) extension.
 * Seamlessly collapses Markdown tokens (#, **, *, ~~, `) into formatted typography
 * when the cursor is away, and smoothly expands to raw markdown when the cursor enters.
 */
export function createLivePreviewExtension(): Extension {
  return [livePreviewPlugin];
}
