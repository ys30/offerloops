import { useState, useEffect, useRef } from "react";
import { fetchIndustries } from "../api";

interface Industry { industry: string; total: number; last_24h: number; last_7d: number }

interface Props {
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  disabled?: boolean;
  placeholder?: string;
}

export default function IndustryMultiSelect({ selected, onChange, disabled, placeholder = "All industries" }: Props) {
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchIndustries().then(data => setIndustries(data.sort((a, b) => b.total - a.total))).catch(() => {});
  }, []);

  // Close on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  function toggle(ind: string) {
    const next = new Set(selected);
    if (next.has(ind)) next.delete(ind); else next.add(ind);
    onChange(next);
  }

  function label() {
    if (selected.size === 0) return placeholder;
    if (selected.size === 1) return Array.from(selected)[0];
    if (selected.size <= 3) return Array.from(selected).join(", ");
    return `${Array.from(selected).slice(0, 2).join(", ")} +${selected.size - 2} more`;
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(v => !v)}
        style={{
          width: "100%", padding: "7px 9px", border: "1px solid #cbd5e1",
          borderRadius: 6, fontSize: 12, background: "#fff",
          cursor: disabled ? "default" : "pointer",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          color: selected.size === 0 ? "#94a3b8" : "#1e293b",
          textAlign: "left",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
          {label()}
        </span>
        <span style={{ marginLeft: 6, fontSize: 10, color: "#94a3b8", flexShrink: 0 }}>
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 300,
          background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10,
          boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
          minWidth: 280, maxHeight: 340, overflowY: "auto", padding: "8px 0",
        }}>
          {/* Quick actions */}
          <div style={{ display: "flex", gap: 6, padding: "4px 10px 8px", borderBottom: "1px solid #f1f5f9" }}>
            <button onClick={() => onChange(new Set(industries.map(i => i.industry)))} style={tinyBtn}>
              Select all
            </button>
            <button onClick={() => onChange(new Set())} style={tinyBtn}>Clear</button>
            <span style={{ fontSize: 11, color: "#94a3b8", alignSelf: "center", marginLeft: "auto" }}>
              {selected.size} selected
            </span>
          </div>

          {/* Industry list */}
          {industries.map(({ industry, total, last_24h }) => (
            <label
              key={industry}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "6px 12px", cursor: "pointer",
                background: selected.has(industry) ? "#eff6ff" : "transparent",
                borderLeft: selected.has(industry) ? "3px solid #2563eb" : "3px solid transparent",
              }}
            >
              <input
                type="checkbox"
                checked={selected.has(industry)}
                onChange={() => toggle(industry)}
                style={{ accentColor: "#2563eb", flexShrink: 0 }}
              />
              <span style={{ flex: 1, fontSize: 12, fontWeight: selected.has(industry) ? 600 : 400, color: "#1e293b" }}>
                {industry}
              </span>
              <span style={{ fontSize: 11, color: "#94a3b8" }}>{total.toLocaleString()}</span>
              {last_24h > 0 && (
                <span style={{ fontSize: 10, color: "#16a34a", fontWeight: 600 }}>+{last_24h}</span>
              )}
            </label>
          ))}

          <div style={{ padding: "8px 10px 4px", borderTop: "1px solid #f1f5f9", marginTop: 4, textAlign: "right" }}>
            <button onClick={() => setOpen(false)} style={{ ...tinyBtn, background: "#2563eb", color: "#fff", border: "none" }}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const tinyBtn: React.CSSProperties = {
  padding: "3px 8px", fontSize: 11, fontWeight: 600,
  border: "1px solid #e2e8f0", borderRadius: 4,
  cursor: "pointer", background: "#f8fafc", color: "#334155",
};
