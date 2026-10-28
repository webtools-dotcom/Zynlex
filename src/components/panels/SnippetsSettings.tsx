/**
 * Settings → Snippets: the user's JavaScript, each one a command ("Snippet:
 * name") that runs in the active tab and can be bound or pinned like any other.
 */
import { useState } from "react";
import { X } from "lucide-react";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { useSnippetsStore } from "@/stores/snippets";

const input =
  "min-w-0 px-1.5 py-0.5 text-xs border rounded text-[var(--color-text-primary)] placeholder:text-[var(--color-text-disabled)] outline-none focus:border-[var(--color-accent)]";
const inputStyle = { background: "var(--color-elevated)", borderColor: "var(--color-border)" };
const code = `${input} w-full font-mono resize-y`;

export function SnippetsSettings() {
  const { snippets, add, update, remove } = useSnippetsStore();
  const [name, setName] = useState("");
  const [body, setBody] = useState("");

  return (
    <div>
      <span className="text-xs text-[var(--color-text-disabled)] block mb-2">
        JavaScript to run in the current tab from Ctrl+K, a shortcut or a toolbar pin. Errors show
        in the Console panel.
      </span>

      <div className="space-y-2">
        {snippets.map((s) => (
          <div key={s.id} className="space-y-1">
            <div className="flex items-center gap-1">
              <input
                aria-label="Snippet name"
                value={s.name}
                onChange={(e) => update(s.id, { name: e.target.value })}
                className={`${input} flex-1`}
                style={inputStyle}
              />
              <ConfirmButton
                onConfirm={() => remove(s.id)}
                title={`Remove ${s.name}`}
                className="w-5 h-5 flex items-center justify-center rounded text-[var(--color-text-disabled)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-hover)]"
              >
                <X size={12} />
              </ConfirmButton>
            </div>
            <textarea
              aria-label={`${s.name} code`}
              value={s.code}
              onChange={(e) => update(s.id, { code: e.target.value })}
              rows={3}
              spellCheck={false}
              className={code}
              style={inputStyle}
            />
          </div>
        ))}
      </div>

      <form
        className="space-y-1 mt-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim() || !body.trim()) return;
          add({ id: crypto.randomUUID(), name: name.trim(), code: body });
          setName("");
          setBody("");
        }}
      >
        <div className="flex items-center gap-1">
          <input
            aria-label="New snippet name"
            placeholder="name, e.g. Fill test login"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={`${input} flex-1`}
            style={inputStyle}
          />
          <button
            type="submit"
            className="px-2 py-0.5 text-xs rounded border whitespace-nowrap text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            style={inputStyle}
          >
            Add
          </button>
        </div>
        <textarea
          aria-label="New snippet code"
          placeholder={'document.querySelector("#email").value = "test@example.com"'}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          spellCheck={false}
          className={code}
          style={inputStyle}
        />
      </form>
    </div>
  );
}
