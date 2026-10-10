// Avis d'enseignants fictifs — données de démonstration (mock). Les noms sont inventés ; reliability.ts tire
// dans cette banque des avis dont la note correspond à l'indice du trajet.
import type { Text } from "./discoveries";

export const TEACHERS: { name: string; role: Text }[] = [
  { name: "Mme Garcia", role: { en: "4th grade teacher", fr: "Professeure des écoles, CM1" } },
  { name: "M. Fabre", role: { en: "History teacher, middle school", fr: "Prof d'histoire-géo, collège" } },
  { name: "Mme Roux", role: { en: "Science teacher, middle school", fr: "Prof de SVT, collège" } },
  { name: "M. Benali", role: { en: "Physics teacher, high school", fr: "Prof de physique-chimie, lycée" } },
  { name: "Mme Vidal", role: { en: "5th grade teacher", fr: "Professeure des écoles, CM2" } },
  { name: "M. Martinez", role: { en: "PE teacher, middle school", fr: "Prof d'EPS, collège" } },
  { name: "Mme Lacombe", role: { en: "Art teacher, high school", fr: "Prof d'arts plastiques, lycée" } },
  { name: "M. Durand", role: { en: "French teacher, middle school", fr: "Prof de français, collège" } },
  { name: "Mme Nguyen", role: { en: "3rd grade teacher", fr: "Professeure des écoles, CE2" } },
  { name: "M. Pujol", role: { en: "Occitan teacher, high school", fr: "Prof d'occitan, lycée" } },
];

export const REVIEW_BANK: { rating: number[]; needsTransfer?: boolean; direct?: boolean; text: Text }[] = [
  {
    rating: [5],
    direct: true,
    text: {
      en: "Direct train, no change: ideal with 25 pupils. We were on time both ways and the controller was very kind to the class.",
      fr: "Train direct, aucune correspondance : idéal avec 25 élèves. À l'heure à l'aller comme au retour, et le contrôleur a été adorable avec la classe.",
    },
  },
  {
    rating: [5, 4],
    text: {
      en: "Booked the group fare three weeks ahead, everything went smoothly. A whole carriage was reserved for us.",
      fr: "Tarif groupe réservé trois semaines avant, tout s'est très bien passé. Une voiture entière nous était réservée.",
    },
  },
  {
    rating: [5, 4],
    text: {
      en: "The kids loved watching the landscape go by. I'd prepared a little quiz on the stations we passed — a hit.",
      fr: "Les enfants ont adoré regarder défiler le paysage. J'avais préparé un petit quiz sur les gares traversées, gros succès.",
    },
  },
  {
    rating: [4],
    text: {
      en: "Reliable overall. Five minutes late on the way back, nothing serious. Plan a margin before the end of the school day.",
      fr: "Fiable dans l'ensemble. Cinq minutes de retard au retour, rien de grave. Prévoyez une marge avant la sortie des classes.",
    },
  },
  {
    rating: [4, 3],
    needsTransfer: true,
    text: {
      en: "The change went fine thanks to the 15-minute margin, but counting 28 pupils on a platform is stressful. Assign one adult per group.",
      fr: "La correspondance s'est bien passée grâce aux 15 minutes de marge, mais compter 28 élèves sur un quai, c'est stressant. Un adulte par groupe.",
    },
  },
  {
    rating: [4],
    text: {
      en: "Clean, quiet train in the morning. On the way back it was busier, we had to split the class across two carriages.",
      fr: "Train propre et calme le matin. Au retour c'était plus chargé, on a dû répartir la classe sur deux voitures.",
    },
  },
  {
    rating: [3],
    text: {
      en: "Average. 12 minutes late on the way there, so we cut the guided tour short. The return was on time.",
      fr: "Mitigé. 12 minutes de retard à l'aller, on a dû raccourcir la visite guidée. Le retour était à l'heure.",
    },
  },
  {
    rating: [3, 2],
    needsTransfer: true,
    text: {
      en: "We missed the connection by two minutes and waited almost an hour for the next one. Parents were waiting at school…",
      fr: "Correspondance ratée à deux minutes près, presque une heure d'attente pour le suivant. Les parents attendaient devant l'école…",
    },
  },
  {
    rating: [3],
    text: {
      en: "Fine, but the station has no shelter for a group: in the rain with 30 children it's long. Bring raincoats.",
      fr: "Correct, mais la gare n'a pas d'abri pour un groupe : sous la pluie avec 30 enfants, c'est long. Prévoyez les K-way.",
    },
  },
  {
    rating: [2],
    text: {
      en: "Train cancelled the day before, replaced by a coach. SNCF warned us in time but we had to redo the whole schedule.",
      fr: "Train supprimé la veille, remplacé par un car. La SNCF nous a prévenus à temps mais il a fallu refaire tout le planning.",
    },
  },
  {
    rating: [2, 1],
    text: {
      en: "40 minutes late on the return, no information on the platform. I wouldn't do it again on a Friday afternoon.",
      fr: "40 minutes de retard au retour, aucune info sur le quai. Je ne le referai pas un vendredi après-midi.",
    },
  },
  {
    rating: [5, 4],
    text: {
      en: "Third year we've done this outing. Never a problem, and it costs far less than chartering a coach.",
      fr: "Troisième année qu'on fait cette sortie. Jamais de souci, et bien moins cher que d'affréter un car.",
    },
  },
  {
    rating: [4, 3],
    text: {
      en: "Good trip. Tip: the front of the train is emptier, gather the class at the head of the platform.",
      fr: "Bon trajet. Astuce : l'avant du train est plus vide, regroupez la classe en tête de quai.",
    },
  },
];
