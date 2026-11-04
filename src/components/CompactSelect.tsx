"use client";

import { createPortal } from "react-dom";
import { useEffect, useId, useRef, useState } from "react";

export interface SelectOption { value: string; label: string }

/** App-owned popup avoids Android's full-screen native select dialog. */
export default function CompactSelect({ label, value, options, onChange, active = false }: {
  label: string; value: string; options: SelectOption[]; onChange: (value: string) => void; active?: boolean;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const [focused, setFocused] = useState(0);
  const typeahead = useRef({ text: "", at: 0 });
  const close = () => { setPosition(null); trigger.current?.focus(); };
  const open = () => {
    const rect = trigger.current!.getBoundingClientRect();
    const viewport = window.visualViewport;
    const bottom = (viewport?.height ?? innerHeight) + (viewport?.offsetTop ?? 0);
    const spaceBelow = bottom - rect.bottom - 8;
    const above = spaceBelow < 160 && rect.top > spaceBelow;
    const height = Math.max(36, Math.min(240, options.length * 36 + 8, above ? rect.top - 12 : spaceBelow));
    const width = Math.min(Math.max(rect.width, 176), innerWidth - 16);
    setFocused(Math.max(0, options.findIndex((option) => option.value === value)));
    setPosition({ top: above ? rect.top - height - 4 : rect.bottom + 4, left: Math.max(8, Math.min(rect.left, innerWidth - width - 8)), width, height });
  };
  useEffect(() => {
    if (!position) return;
    menu.current?.focus();
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setPosition(null);
    };
    const dismiss = (event: Event) => { if (event.type === "scroll" && event.target instanceof Node && menu.current?.contains(event.target)) return; setPosition(null); };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    window.visualViewport?.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
      window.visualViewport?.removeEventListener("resize", dismiss);
    };
  }, [position]);
  useEffect(() => {
    menu.current?.querySelector(`[data-index="${focused}"]`)?.scrollIntoView({ block: "nearest" });
  }, [focused, position]);
  const choose = (next: string) => { close(); onChange(next); };
  return <>
    <button ref={trigger} type="button" role="combobox" aria-label={label} aria-haspopup="listbox" aria-expanded={Boolean(position)} aria-controls={position ? id : undefined}
      title={options.find((option) => option.value === value)?.label}
      data-active={active} data-value={value} className="vault-select flex items-center justify-between gap-1 text-left"
      onClick={() => position ? close() : open()} onKeyDown={(event) => {
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) { event.preventDefault(); open(); }
      }}>
      <span className="min-w-0 truncate">{options.find((option) => option.value === value)?.label ?? "Select"}</span>
      <span aria-hidden="true" className="shrink-0 text-neutral-400">⌄</span>
    </button>
    {position && createPortal(<div ref={menu} id={id} role="listbox" aria-label={label} tabIndex={-1} aria-activedescendant={`${id}-${focused}`} className="vault-select-menu"
      style={{ top: position.top, left: position.left, width: position.width, maxHeight: position.height }}
      onScroll={(event) => event.stopPropagation()} onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); close(); }
        else if (event.key === "Tab") { close(); }
        else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(options[focused].value); }
        else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault(); setFocused((current) => event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
        } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
          const text = (event.timeStamp - typeahead.current.at < 700 ? typeahead.current.text : "") + event.key.toLowerCase();
          typeahead.current = { text, at: event.timeStamp };
          const index = options.findIndex((option) => option.label.toLowerCase().startsWith(text));
          if (index >= 0) setFocused(index);
        }
      }}>
      {options.map((option, index) => <div key={option.value} id={`${id}-${index}`} role="option" aria-selected={option.value === value} data-value={option.value} data-index={index}
        className={`vault-select-option ${index === focused ? "is-focused" : ""}`} onPointerMove={(event) => { if (event.pointerType === "mouse") setFocused(index); }} onClick={() => choose(option.value)}>
        <span className="min-w-0 break-words">{option.label}</span><span aria-hidden="true">{option.value === value ? "✓" : ""}</span>
      </div>)}
    </div>, document.body)}
  </>;
}
