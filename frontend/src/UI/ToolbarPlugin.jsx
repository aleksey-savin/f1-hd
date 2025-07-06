import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { FORMAT_TEXT_COMMAND } from "lexical";
import {
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
} from "@lexical/list";
import { Button, ButtonGroup, ButtonToolbar } from "react-bootstrap";

import {
  BiBold,
  BiItalic,
  BiUnderline,
  BiStrikethrough,
  BiListUl,
  BiListOl,
} from "react-icons/bi";

export default function ToolbarPlugin() {
  const [editor] = useLexicalComposerContext();

  const format = (type) => editor.dispatchCommand(FORMAT_TEXT_COMMAND, type);
  const insertList = (type) => {
    editor.dispatchCommand(
      type === "ol"
        ? INSERT_ORDERED_LIST_COMMAND
        : INSERT_UNORDERED_LIST_COMMAND,
      undefined,
    );
  };

  return (
    <ButtonToolbar className="editor-toolbar p-0 mb-2">
      <ButtonGroup size="sm" className="me-2">
        <Button variant="light" onClick={() => format("bold")}>
          <BiBold />
        </Button>
        <Button variant="light" onClick={() => format("italic")}>
          <BiItalic />
        </Button>
        <Button variant="light" onClick={() => format("underline")}>
          <BiUnderline />
        </Button>
        <Button variant="light" onClick={() => format("strikethrough")}>
          <BiStrikethrough />
        </Button>
      </ButtonGroup>
      <ButtonGroup size="sm" className="me-2">
        <Button variant="light" onClick={() => insertList("ul")}>
          <BiListUl />
        </Button>
        <Button variant="light" onClick={() => insertList("ol")}>
          <BiListOl />
        </Button>
      </ButtonGroup>
    </ButtonToolbar>
  );
}
