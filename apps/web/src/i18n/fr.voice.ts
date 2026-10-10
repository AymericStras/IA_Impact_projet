/**
 * Every user-facing string of the staged voice flow (`/vocal`).
 *
 * The assistant's questions and summaries come from the server
 * (`ConversationResponse.assistant_message`) and are rendered verbatim; only the chrome of
 * this route lives here. Constraint words, date helpers and the labels of the fields shared
 * with the classic chat are reused from `fr.ts` so both experiences speak with one voice.
 */
export const frVoice = {
  page: {
    title: "liO — Votre sortie pédagogique, à la voix",
    description:
      "Décrivez votre sortie scolaire en parlant : maintenez le bouton, parlez, puis vérifiez la fiche avant de confirmer.",
  },
  chrome: {
    brand: "liO",
    classicLink: "Discussion classique",
    classicLinkLabel: "Passer à la discussion classique",
    restart: "Recommencer",
    restartLabel: "Recommencer avec une nouvelle sortie",
    progress: (known: number, total: number) =>
      known > 1 ? `${known} informations sur ${total} renseignées` : `${known} information sur ${total} renseignée`,
    loading: "Chargement de votre sortie…",
    loadFailed: "Impossible de démarrer.",
    dismiss: "Fermer",
    retry: "Réessayer",
    demo: "Mode démo",
    demoShort: "Démo",
    demoDescription: "Mode démo : les réponses sont simulées par un script, sans modèle d'IA ni serveur.",
    stageRegion: "Étape en cours",
  },
  /** Announced through the polite live region when a stage is entered. */
  announce: {
    ask: "Question. Maintenez le bouton pour répondre à la voix, ou écrivez votre réponse.",
    listen: "Écoute en cours.",
    think: "Analyse de votre réponse en cours.",
    sheet: "Fiche de la sortie. Vérifiez les informations, complétez-les, puis confirmez.",
    done: "Sortie confirmée.",
  },
  /** Copy of the field added for this route; the other four labels come from `fr.fields`. */
  fields: {
    departure_station: {
      label: "Gare de départ",
      inputLabel: "Gare de départ",
      placeholder: "ex. Toulouse Matabiau",
    },
  },
  talk: {
    name: "Parler",
    stop: "Terminer",
    cancel: "Annuler",
    idleHint: "Maintenez pour parler, ou touchez pour démarrer",
    idleHintSheet: "Dites ce qui manque ou ce qu'il faut corriger",
    holdHint: "Relâchez pour terminer",
    toggleHint: "Touchez à nouveau pour terminer",
    cancelHint: "Relâchez pour annuler",
    keyboardHint: "Espace pour démarrer ou terminer, Échap pour annuler",
    busyHint: "Un instant…",
  },
  ask: {
    eyebrow: "Votre sortie pédagogique",
    fallbackQuestion: "Décrivez votre sortie.",
    example:
      "Par exemple : « 27 élèves et 3 accompagnateurs, au départ de Toulouse Matabiau, le 12 novembre vers 8 h, retour avant 17 h, sur le Moyen Âge. »",
    writeInstead: "Écrire à la place",
    seeSheet: "Voir la fiche",
  },
  text: {
    label: "Votre réponse",
    placeholder: "Écrivez votre réponse…",
    send: "Envoyer",
    cancel: "Annuler",
    hint: "Entrée pour envoyer, Maj + Entrée pour un saut de ligne",
  },
  listen: {
    heading: "Je vous écoute",
    requesting: "Autorisation du micro en cours…",
    recording: "Enregistrement en cours",
    cancelArmed: "Relâchez pour annuler : rien ne sera envoyé",
    timerLabel: "Durée de l'enregistrement",
    countdown: (seconds: number) =>
      seconds > 1 ? `Fin de l'enregistrement dans ${seconds} secondes` : `Fin de l'enregistrement dans ${seconds} seconde`,
    longHoldTip: "Astuce : un appui bref suffit, touchez à nouveau le bouton pour terminer.",
    levelLabel: "Niveau du micro",
    synthetic: "Micro simulé (mode démo).",
    cancel: "Annuler",
  },
  hints: {
    too_short: "Maintenez le bouton pendant que vous parlez.",
    cancelled: "Enregistrement annulé. Rien n'a été envoyé.",
    interrupted: "L'enregistrement a été interrompu. Rien n'a été envoyé.",
    empty_recording: "L'enregistrement est vide. Réessayez en parlant un peu plus longtemps.",
  },
  mic: {
    denied:
      "L'accès au micro a été refusé. Pour parler, autorisez le micro dans les réglages du site de votre navigateur, puis réessayez. Vous pouvez aussi écrire votre réponse.",
    no_microphone: "Aucun micro n'a été détecté. Vous pouvez écrire votre réponse.",
    unsupported: "L'enregistrement audio n'est pas pris en charge par ce navigateur. Vous pouvez écrire votre réponse.",
  },
  think: {
    heading: "Un instant…",
    stepsLabel: "Étapes de l'analyse",
    transcribing: "Transcription",
    understanding: "Compréhension",
    stepDone: "terminée",
    stepActive: "en cours",
    stepWaiting: "en attente",
    stepFailed: "interrompue",
    youSaid: "Vous avez dit",
    youWrote: "Vous avez écrit",
    errorTitle: "L'analyse n'a pas abouti",
    fallbackError: "Désolé, je n'ai pas pu traiter votre réponse. Pouvez-vous réessayer ?",
    retry: "Réessayer",
    retryNote: "Votre réponse est conservée : inutile de la répéter.",
    abandon: "Annuler",
  },
  problem: {
    title: "Une erreur est survenue",
    rerecordTitle: "Réessayer l'enregistrement",
    rerecordNote: "Maintenez le bouton pour enregistrer à nouveau, ou écrivez votre réponse.",
    restart: "Nouvelle sortie",
  },
  sheet: {
    heading: "Votre fiche de sortie",
    assistant: "Message de l'assistant",
    question: "Question de l'assistant",
    listLabel: "Les informations de la sortie",
    known: "Renseigné",
    missing: "À préciser",
    clarify: "À clarifier",
    edit: "Modifier",
    editLabel: (label: string) => `Modifier : ${label}`,
    save: "Enregistrer",
    saving: "Enregistrement…",
    cancel: "Annuler",
    confirm: "Confirmer",
    confirming: "Confirmation…",
    readyStatus: "Tout est renseigné. Vérifiez, puis confirmez.",
    missingStatus: (labels: string[]) => `Il manque : ${labels.join(", ")}`,
    clarifyStatus: (label: string) => `À clarifier : ${label}`,
    notReadyStatus: "La confirmation sera possible une fois la fiche vérifiée.",
    alreadyConfirmed: "Cette sortie est déjà confirmée.",
    backToConfirmation: "Voir la confirmation",
  },
  transcript: {
    title: "Vous avez dit",
    titleText: "Vous avez écrit",
    notSent: "Ce texte n'a pas encore été pris en compte.",
    correct: "Corriger le texte",
    write: "Écrire à la place",
    label: "Texte à envoyer",
    resend: "Envoyer le texte",
    cancel: "Annuler",
    demoNotice: "Transcription simulée (mode démo).",
  },
  done: {
    heading: "Sortie confirmée",
    fallbackMessage: "Les informations ont été transmises pour la préparation de l'itinéraire.",
    summaryLabel: "Informations transmises",
    jsonShow: "Voir le JSON transmis",
    jsonHide: "Masquer le JSON transmis",
    jsonLabel: "JSON transmis",
    jsonHint: (version: string) =>
      `Charge utile versionnée transmise au module de planification (schema_version ${version}).`,
    modify: "Modifier",
    newTrip: "Nouvelle sortie",
  },
} as const;

export type FrVoice = typeof frVoice;
