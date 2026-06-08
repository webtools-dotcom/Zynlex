import { useState, useEffect, useCallback } from "react";

interface JwtParsed {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signature: string;
  algorithm: string;
}

function b64urlDecode(str: string): string {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  base64 += "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(base64);
  return decodeURIComponent(
    Array.from(binary, (c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join("")
  );
}

function decodeJwt(raw: string): JwtParsed | null {
  const trimmed = raw.trim();
  const parts = trimmed.split(".");
  if (parts.length !== 3) return null;

  try {
    const header = JSON.parse(b64urlDecode(parts[0]));
    const payload = JSON.parse(b64urlDecode(parts[1]));
    return {
      header,
      payload,
      signature: parts[2],
      algorithm: String(header.alg ?? "unknown"),
    };
  } catch {
    return null;
  }
}

function formatExpiry(exp: unknown): { expired: boolean; label: string; date: string } | null {
  if (typeof exp !== "number") return null;
  const expMs = exp * 1000;
  const diff = expMs - Date.now();
  const absDiff = Math.abs(diff);
  const dateStr = new Date(expMs).toLocaleString();

  let label: string;
  if (absDiff < 60_000) {
    label = `${Math.round(absDiff / 1000)}s`;
  } else if (absDiff < 3_600_000) {
    const m = Math.floor(absDiff / 60_000);
    const s = Math.round((absDiff % 60_000) / 1000);
    label = `${m}m ${s}s`;
  } else if (absDiff < 86_400_000) {
    const h = Math.floor(absDiff / 3_600_000);
    const m = Math.floor((absDiff % 3_600_000) / 60_000);
    label = `${h}h ${m}m`;
  } else {
    const d = Math.floor(absDiff / 86_400_000);
    const h = Math.floor((absDiff % 86_400_000) / 3_600_000);
    label = `${d}d ${h}h`;
  }

  return {
    expired: diff < 0,
    label: diff < 0 ? `Expired ${label} ago` : `Expires in ${label}`,
    date: dateStr,
  };
}

export function JwtDecoder() {
  const [token, setToken] = useState("");
  const [parsed, setParsed] = useState<JwtParsed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [headerOpen, setHeaderOpen] = useState(false);
  const [payloadOpen, setPayloadOpen] = useState(true);

  useEffect(() => {
    if (!token.trim()) {
      setParsed(null);
      setError(null);
      return;
    }
    const timer = setTimeout(() => {
      const result = decodeJwt(token);
      if (result) {
        setParsed(result);
        setError(null);
      } else {
        setParsed(null);
        setError("Invalid JWT — expected 3 dot-separated base64url-encoded parts");
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [token]);

  const handlePaste = useCallback(() => {
    navigator.clipboard.readText().then((t) => setToken(t.trim()));
  }, []);

  const expiry = parsed ? formatExpiry(parsed.payload.exp) : null;

  return (
    <div className="flex flex-col gap-2 p-2">
      <div className="flex justify-end">
        <button
          onClick={handlePaste}
          className="text-[10px] px-2 py-0.5 rounded border text-[var(--xevo-text-muted)] hover:text-[var(--xevo-text)] hover:bg-[var(--xevo-hover)] transition-colors"
          style={{ borderColor: "var(--xevo-border)" }}
        >
          Paste
        </button>
      </div>

      <textarea
        rows={5}
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="Paste JWT token here or press Paste ↑"
        className="w-full resize-none font-mono text-[11px] p-2 rounded border outline-none"
        style={{
          background: "var(--xevo-content-bg)",
          borderColor: "var(--xevo-border)",
          color: "var(--xevo-text)",
        }}
      />

      {error !== null && (
        <p className="text-[11px] px-1" style={{ color: "var(--xevo-danger)" }}>
          {error}
        </p>
      )}

      {parsed && (
        <>
          <span
            className="inline-block self-start px-2 py-0.5 rounded font-mono text-[10px]"
            style={{
              background: "var(--xevo-modal-bg)",
              border: "1px solid var(--xevo-border)",
              color: "var(--xevo-text-muted)",
            }}
          >
            ALG: {parsed.algorithm}
          </span>

          {/* Header */}
          <div>
            <button
              onClick={() => setHeaderOpen(!headerOpen)}
              className="text-[10px] font-semibold tracking-widest uppercase w-full text-left py-1"
              style={{ color: "var(--xevo-text-muted)" }}
            >
              {headerOpen ? "▾ HEADER" : "▸ HEADER"}
            </button>
            {headerOpen && (
              <div className="flex flex-col">
                {Object.entries(parsed.header).map(([key, val]) => (
                  <div
                    key={key}
                    className="flex gap-1.5 py-0.5 border-b"
                    style={{ borderColor: "var(--xevo-border)" }}
                  >
                    <span
                      className="text-[11px] font-mono min-w-[60px] flex-shrink-0"
                      style={{ color: "var(--xevo-accent)" }}
                    >
                      {key}
                    </span>
                    <span
                      className="text-[11px] font-mono break-all"
                      style={{ color: "var(--xevo-text-muted)" }}
                    >
                      {typeof val === "object" ? JSON.stringify(val) : String(val)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Payload */}
          <div>
            <button
              onClick={() => setPayloadOpen(!payloadOpen)}
              className="text-[10px] font-semibold tracking-widest uppercase w-full text-left py-1"
              style={{ color: "var(--xevo-text-muted)" }}
            >
              {payloadOpen ? "▾ PAYLOAD" : "▸ PAYLOAD"}
            </button>
            {payloadOpen && (
              <div className="flex flex-col">
                {expiry && (
                  <div
                    className="w-full rounded p-2 mb-2"
                    style={{
                      border: `1px solid ${expiry.expired ? "var(--xevo-danger)" : "var(--xevo-success)"}40`,
                      background: `${expiry.expired ? "var(--xevo-danger)" : "var(--xevo-success)"}08`,
                    }}
                  >
                    <p
                      className="text-[11px]"
                      style={{
                        color: expiry.expired ? "var(--xevo-danger)" : "var(--xevo-success)",
                      }}
                    >
                      {expiry.expired ? "✕ " : "✓ "}{expiry.label}
                    </p>
                    <p className="text-[10px] mt-0.5" style={{ color: "var(--xevo-text-muted)" }}>
                      {expiry.date}
                    </p>
                  </div>
                )}
                {Object.entries(parsed.payload).map(([key, val]) => (
                  <div
                    key={key}
                    className="flex gap-1.5 py-0.5 border-b"
                    style={{ borderColor: "var(--xevo-border)" }}
                  >
                    <span
                      className="text-[11px] font-mono min-w-[60px] flex-shrink-0"
                      style={{ color: "var(--xevo-accent)" }}
                    >
                      {key}
                    </span>
                    <span
                      className="text-[11px] font-mono break-all"
                      style={{ color: "var(--xevo-text-muted)" }}
                    >
                      {typeof val === "object" ? JSON.stringify(val) : String(val)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Signature note */}
          <p className="text-[10px] px-1 mt-1" style={{ color: "var(--xevo-text-faint)" }}>
            Signature not verified — XEVO does not validate JWT signatures.
          </p>
        </>
      )}
    </div>
  );
}
