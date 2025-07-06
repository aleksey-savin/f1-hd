import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { $generateHtmlFromNodes } from "@lexical/html";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { ListNode, ListItemNode } from "@lexical/list";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getRoot } from "lexical";
import { $generateNodesFromDOM } from "@lexical/html";

import ToolbarPlugin from "./ToolbarPlugin";
import "./editor.css";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { useEffect, useState } from "react";

const theme = {
  root: "form-control p-0 border-0",
  paragraph: "mb-2",
  text: {
    bold: "fw-bold",
    italic: "fst-italic",
    underline: "text-decoration-underline",
    strikethrough: "text-decoration-line-through",
  },
  heading: {
    h1: "h1",
    h2: "h2",
    h3: "h3",
  },
  list: {
    ul: "ps-3",
    ol: "list-decimal ps-3",
    listitem: "mb-1",
  },
  quote: "blockquote border-start border-4 border-secondary ps-3 ms-3 my-3",
};

function UpdatePlugin({ description, initialContent }) {
  const [editor] = useLexicalComposerContext();
  const [isFirstRender, setIsFirstRender] = useState(true);

  useEffect(() => {
    if (isFirstRender && initialContent) {
      editor.update(() => {
        const parser = new DOMParser();
        const dom = parser.parseFromString(initialContent, "text/html");
        const nodes = $generateNodesFromDOM(editor, dom);
        const root = $getRoot();
        root.clear();
        nodes.forEach((node) => root.append(node));
      });
      setIsFirstRender(false);
    }
  }, [editor, initialContent, isFirstRender]);

  useEffect(() => {
    if (!isFirstRender && description) {
      editor.update(() => {
        const parser = new DOMParser();
        const dom = parser.parseFromString(description, "text/html");
        const nodes = $generateNodesFromDOM(editor, dom);
        const root = $getRoot();
        root.clear();
        nodes.forEach((node) => root.append(node));
      });
    }
  }, [editor, description, isFirstRender]);

  return null;
}

const Editor = ({
  changeHandler,
  placeholder = "",
  description = "",
  selectedTemplate = null,
}) => {
  const initialConfig = {
    namespace: "TicketEditor",
    theme,
    onError: (error) => {
      console.error(error);
    },
    editorState: undefined,
    nodes: [ListNode, ListItemNode],
  };

  const onChange = (editorState, editor) => {
    editorState.read(() => {
      const html = $generateHtmlFromNodes(editor, null);
      changeHandler(html);
    });
  };

  const initialContent = selectedTemplate?.description || description;
  const [templateDescription, setTemplateDescription] = useState(null);

  useEffect(() => {
    if (selectedTemplate?.description) {
      setTemplateDescription(selectedTemplate.description);
      changeHandler(selectedTemplate.description);
    }
  }, [selectedTemplate]);

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className="editor-container">
        <div className="editor-toolbar">
          <ToolbarPlugin />
        </div>
        <div className="editor-body">
          <RichTextPlugin
            contentEditable={<ContentEditable className="editor-input" />}
            placeholder={
              <div className="editor-placeholder">{placeholder}</div>
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
        </div>
        <UpdatePlugin
          description={templateDescription}
          initialContent={initialContent}
        />
        <HistoryPlugin />
        <ListPlugin />
        <OnChangePlugin onChange={onChange} />
      </div>
    </LexicalComposer>
  );
};

export default Editor;
