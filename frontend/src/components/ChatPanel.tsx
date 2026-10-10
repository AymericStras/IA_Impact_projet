import { useI18n } from "../i18n";
import Trame from "./Trame";

// Emplacement réservé : le chatbot sera branché ici plus tard.
export default function ChatPanel() {
  const { t } = useI18n();
  return (
    <>
      <div className="hero hero-compact">
        <h1>{t.chatTitle}</h1>
        <Trame className="hero-trame" rows={2} columns={30} />
      </div>
      <section className="panel-body">
        <p className="hint">{t.chatSoon}</p>
      </section>
    </>
  );
}
