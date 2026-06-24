import { useState, useEffect, useCallback } from "react";

function b64Encode(text: string, urlSafe: boolean): string {
  const bytes = new TextEncoder().encode(text);
  const binStr = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  let r = btoa(binStr);
  if (urlSafe) {
    r = r.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  }
  return r;
}

function b64Decode(text: string): string | null {
  try {
    let base64 = text.trim().replace(/-/g, "+").replace(/_/g, "/");
    base64 += "=".repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

export function Base64Tool() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [mode, setMode] = useState<"encode" | "decode">("encode");
  const [urlSafe, setUrlSafe] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!input) {
      setOutput("");
      setError(null);
      return;
    }
    if (mode === "encode") {
      setOutput(b64Encode(input, urlSafe));
      setError(null);
    } else {
      const result = b64Decode(input);
      if (result === null) {
        setOutput("");
        setError("Invalid base64 input");
      } else {
        setOutput(result);
        setError(null);
      }
    }
  }, [input, mode, urlSafe]);

  const handleCopy = useCallback(() => {
    if (!output) return;
    navigator.clipboard.writeText(output).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [output]);

  const textareaStyle = {
    background: "var(--color-base)",
    borderColor: "var(--color-border)",
    color: "var(--color-text-primary)",
  };

  return (
    <div className="flex flex-col gap-2 p-2">
      {/* Mode toggle */}
      <div className="flex gap-1">
        {(["encode", "decode"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className="flex-1 h-7 text-[11px] border rounded-[4px] capitalize transition-colors"
            style={{
              background: mode === m ? "var(--color-accent)20" : "transparent",
              color: mode === m ? "var(--color-accent)" : "var(--color-text-muted)",
              borderColor: mode === m ? "var(--color-accent)40" : "var(--color-border)",
            }}
          >
            {m}
          </button>
        ))}
      </div>

      {/* URL-safe checkbox */}
      <label className="flex items-center gap-1.5 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={urlSafe}
          onChange={(e) => setUrlSafe(e.target.checked)}
          className="accent-[var(--color-accent)]"
        />
        <span className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
          URL-safe (- and _)
        </span>
      </label>

      {/* Input label */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-muted)" }}>
          Input
        </span>
        <span className="text-[10px]" style={{ color: "var(--color-text-disabled)" }}>
          {input.length} chars
        </span>
      </div>

      {/* Input textarea */}
      <textarea
        rows={4}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        className="w-full resize-none font-mono text-[11px] p-2 rounded border outline-none"
        style={textareaStyle}
      />

      {/* Output label */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-muted)" }}>
          Output
        </span>
        <span className="text-[10px]" style={{ color: "var(--color-text-disabled)" }}>
          {output.length} chars
        </span>
      </div>

      {/* Error or output */}
      {error !== null ? (
        <p className="text-[11px]" style={{ color: "var(--color-dead)" }}>
          {error}
        </p>
      ) : (
        <textarea
          rows={4}
          readOnly
          value={output}
          className="w-full resize-none font-mono text-[11px] p-2 rounded border outline-none"
          style={{ ...textareaStyle, background: "var(--color-elevated)" }}
        />
      )}

      {/* Copy button */}
      <div className="flex justify-end">
        <button
          onClick={handleCopy}
          disabled={!output}
          className="text-[11px] px-2 py-0.5 rounded border transition-colors disabled:opacity-40"
          style={{
            borderColor: "var(--color-border)",
            color: copied ? "var(--color-live)" : "var(--color-text-muted)",
          }}
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
    </div>
  );
}
