import { useEffect, useMemo, useRef } from "react";
import type { Block } from "../../lib/blockParser";
import { highlightCode } from "../../lib/codeHighlight";
import CodeLanguagePicker from "./CodeLanguagePicker";

interface Props {
  block: Block;
  registerRef: (id: string, el: HTMLDivElement | null) => void;
  onInput: (id: string, el: HTMLDivElement) => void;
  onKeyDown: (e: React.KeyboardEvent, block: Block) => void;
  onLanguageChange: (id: string, language: string) => void;
}

export default function CodeBlockView({
  block,
  registerRef,
  onInput,
  onKeyDown,
  onLanguageChange,
}: Props) {
  const editRef = useRef<HTMLDivElement | null>(null);

  const highlighted = useMemo(
    () => highlightCode(block.text, block.language),
    [block.text, block.language],
  );

  useEffect(() => {
    const el = editRef.current;
    if (!el || el.textContent === block.text) return;
    el.textContent = block.text;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.id]);

  const setRef = (el: HTMLDivElement | null) => {
    editRef.current = el;
    registerRef(block.id, el);
  };

  return (
    <div className="block block-code">
      <CodeLanguagePicker
        value={block.language ?? ""}
        onChange={(language) => onLanguageChange(block.id, language)}
      />
      <div className="code-block-body">
        <pre className="code-highlight" aria-hidden="true">
          <code dangerouslySetInnerHTML={{ __html: highlighted }} />
        </pre>
        <div
          className="block-edit be-code"
          contentEditable
          suppressContentEditableWarning
          ref={setRef}
          onInput={(e) => onInput(block.id, e.currentTarget)}
          onKeyDown={(e) => onKeyDown(e, block)}
        />
      </div>
    </div>
  );
}
