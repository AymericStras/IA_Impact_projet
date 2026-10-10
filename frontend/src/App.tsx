import { useEffect, useState } from "react";
import { useI18n } from "./i18n";
import NetworkExplorer from "./NetworkExplorer";
import SchoolPlanner from "./components/SchoolPlanner";
import "./school.css";

export default function App() {
  const [network, setNetwork] = useState(false);
  const { setLocale } = useI18n();
  useEffect(() => { setLocale("fr"); }, []);
  return network ? <><button className="network-back" onClick={() => setNetwork(false)}>← Revenir à ma sortie scolaire</button><NetworkExplorer /></> : <SchoolPlanner onNetwork={() => setNetwork(true)} />;
}
