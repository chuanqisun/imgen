import { xml } from "@codemirror/lang-xml";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, minimalSetup } from "codemirror";

import "./code-editor-element.css";
import { formatXml } from "./xml-format";

export function defineCodeEditorElement() {
  customElements.define("code-editor-element", CodeEditorElement);
}

export class CodeEditorElement extends HTMLElement {
  static observedAttributes = ["value"];

  private editorView: EditorView | null = null;

  connectedCallback() {
    this.editorView = new EditorView({
      extensions: [
        minimalSetup,
        oneDark,
        xml(),
        EditorView.lineWrapping,
        EditorView.focusChangeEffect.of((state, focusing) => {
          if (focusing) return null;
          const value = state.doc.toString();
          this.value = value;

          const formattedValue = formatXml(value);
          this.dispatchEvent(new CustomEvent("change", { detail: formattedValue }));
          return null;
        }),
      ],
      parent: this,
    });

    if (this.hasAttribute("value")) {
      this.value = this.getAttribute("value") ?? "";
    }
  }

  attributeChangedCallback(name: string, _oldValue: string, newValue: string) {
    if (name === "value") {
      const prettyXml = formatXml(newValue);
      this.value = prettyXml;
    }
  }

  set value(value: string) {
    setTimeout(() => {
      const prettyXml = formatXml(value);
      this.editorView?.dispatch({
        changes: {
          from: 0,
          to: this.editorView.state.doc.length,
          insert: prettyXml,
        },
      });
    });
  }

  get value() {
    return this.editorView?.state.doc.toString() ?? "";
  }

  appendText(text: string) {
    const length = this.editorView?.state.doc.length ?? 0;
    this.editorView?.dispatch({
      changes: {
        from: length,
        to: length,
        insert: text,
      },
    });
  }
}
