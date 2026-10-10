import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ChatFailure, type CatalogPlace, type ChatAction, type ChatError } from "../api";
import { useI18n } from "../i18n";
import Trame from "./Trame";
import { MOBILE_QUERY } from "./MobileNav";
import { dictationSupported, useDictation } from "./useDictation";

type Message = { id: number; role: "user" | "assistant"; text: string } | { id: number; role: "error"; code: ChatError };

// Assistant flottant : une bulle en bas à droite qui ouvre une fenêtre de discussion.
// Les réponses viennent de POST /chat (modèle OpenAI côté backend, qui calcule les trajets avec le même moteur
// que /route) ; ses `actions` remontent à App, qui affiche l'itinéraire ou les lieux proposés sur la carte.
// Ouverture pilotée par l'application : sur mobile, c'est l'onglet « Assistant » de la barre du bas qui l'ouvre,
// et la discussion se loge dans le panneau coulissant du bas (`docked`) au lieu de flotter par-dessus.
// La conversation vit dans App (`messages`) : sur mobile comme sur ordinateur, elle survit à la fermeture.
type Props = {
  open: boolean;
  setOpen: (o: boolean | ((o: boolean) => boolean)) => void;
  docked?: boolean;
  catalog: CatalogPlace[];
  onActions: (actions: ChatAction[]) => void;
  messages: Message[];
  setMessages: (m: Message[] | ((m: Message[]) => Message[])) => void;
};
export type { Message as ChatMessage };
export default function ChatPanel({ open, setOpen, docked = false, catalog, onActions, messages, setMessages }: Props) {
  const { t } = useI18n();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // La dictée remplit le champ (à la suite de ce qui était déjà écrit) : on relit, on corrige, on envoie
  const dictation = useDictation((text) => {
    setDraft((d) => (d.trim() ? d.trimEnd() + " " + text : text));
    inputRef.current?.focus();
  });
  const listening = dictation.phase !== "idle";

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open, busy]);

  const { cancel: cancelDictation } = dictation;
  useEffect(() => {
    if (!open) return cancelDictation();
    // Sur téléphone, pas de focus d'office : le clavier recouvrirait la conversation dès l'ouverture
    if (!window.matchMedia(MOBILE_QUERY).matches) inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  async function ask(text: string) {
    text = text.trim();
    if (!text || busy) return;
    setDraft("");
    const mine: Message = { id: Date.now(), role: "user", text };
    // Historique envoyé : les échanges réussis seulement (une erreur affichée n'est pas un tour de parole)
    const history = [...messages, mine].flatMap((m) => (m.role === "error" ? [] : [{ role: m.role, content: m.text }]));
    setMessages((m) => [...m, mine]);
    setBusy(true);
    try {
      const { reply, actions } = await api.chat(history, catalog);
      setMessages((m) => [...m, { id: Date.now(), role: "assistant", text: reply }]);
      if (actions.length) onActions(actions);
    } catch (e) {
      setMessages((m) => [...m, { id: Date.now(), role: "error", code: e instanceof ChatFailure ? e.code : "network" }]);
    } finally {
      setBusy(false);
    }
  }
  function send(e: FormEvent) {
    e.preventDefault();
    ask(draft);
  }

  return (
    <>
      {open && (
        <section className={docked ? "chat-pop chat-dock" : "chat-pop"} role={docked ? "region" : "dialog"} aria-label={t.chatTitle}>
          <div className="hero hero-compact chat-head">
            <h1>{t.chatTitle}</h1>
            <button className="chat-close" onClick={() => setOpen(false)} aria-label={t.close}>
              ×
            </button>
            <Trame className="hero-trame" rows={2} columns={30} />
          </div>
          <div className="chat-list" ref={listRef} aria-live="polite">
            <p className="chat-msg bot">{t.chatWelcome}</p>
            {messages.length === 0 && (
              <div className="chat-suggest">
                {t.chatSuggestions.map((q) => (
                  <button key={q} type="button" onClick={() => ask(q)}>
                    {q}
                  </button>
                ))}
              </div>
            )}
            {messages.map((m) =>
              m.role === "error" ? (
                <p key={m.id} className="chat-msg bot error" role="alert">
                  {t.chatErrors[m.code]}
                </p>
              ) : (
                <p key={m.id} className={`chat-msg ${m.role === "user" ? "user" : "bot"}`}>
                  {m.text}
                </p>
              ),
            )}
            {busy && (
              <p className="chat-msg bot chat-typing" aria-label={t.chatTyping}>
                <span />
                <span />
                <span />
              </p>
            )}
          </div>
          {dictation.error && (
            <p className="chat-mic-error" role="alert">
              {t.micErrors[dictation.error]}
              <button type="button" onClick={dictation.clearError} aria-label={t.close}>
                ×
              </button>
            </p>
          )}
          {listening ? (
            <div className="chat-input chat-recording" role="group" aria-label={t.micStart}>
              <span className={dictation.phase === "recording" ? "chat-rec-dot live" : "chat-rec-dot"} aria-hidden="true" />
              <span className="chat-rec-label" role="status">
                {dictation.phase === "requesting" ? t.micRequesting : dictation.phase === "recording" ? t.micRecording : t.micTranscribing}
              </span>
              {dictation.phase === "recording" && (
                <span className="chat-rec-time">
                  {Math.floor(dictation.elapsed / 60)}:{String(dictation.elapsed % 60).padStart(2, "0")}
                </span>
              )}
              <button type="button" className="chat-rec-cancel" onClick={dictation.cancel} aria-label={t.micCancel}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" /></svg>
              </button>
              <button type="button" onClick={dictation.stop} disabled={dictation.phase !== "recording"} aria-label={t.micStop}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
              </button>
            </div>
          ) : (
            <form className="chat-input" onSubmit={send}>
              <input ref={inputRef} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t.chatPh} aria-label={t.chatPh} />
              {dictationSupported() && (
                <button type="button" className="chat-mic" onClick={dictation.start} disabled={busy} aria-label={t.micStart} title={t.micStart}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="9" y="3" width="6" height="11" rx="3" />
                    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                  </svg>
                </button>
              )}
              <button type="submit" disabled={!draft.trim() || busy} aria-label={t.chatSend}>
                {t.chatSend}
              </button>
            </form>
          )}
        </section>
      )}
      {!docked && (
      <button className={open ? "chat-fab open" : "chat-fab"} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={open ? t.close : t.chatOpen}>
        {open ? (
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z" /></svg>
        )}
      </button>
      )}
    </>
  );
}
