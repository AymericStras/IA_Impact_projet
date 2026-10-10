/**
 * Every user-facing string of the web app. Assistant messages themselves come
 * from the server (`ConversationResponse.assistant_message`); only chrome,
 * labels, controls and client-side error texts live here.
 */
export const fr = {
  app: {
    brand: "liO",
    title: "Assistant de voyage pédagogique",
    /** Title shown in the navy header (« V3 — Occitanie en train » identity). */
    headerTitle: "Préparer une sortie scolaire",
    pageTitle: "liO — Assistant de voyage pédagogique",
    pageDescription:
      "Décrivez votre sortie scolaire par écrit ou à la voix : l'assistant recueille les cinq informations nécessaires à la préparation de l'itinéraire.",
    help: "Aide",
    skipToComposer: "Aller à la zone de saisie",
    newConversation: "Nouvelle conversation",
    voiceLink: "Version vocale",
    voiceLinkLabel: "Passer à la version vocale",
  },
  demo: {
    badge: "Mode démo",
    tooltip: "Réponses simulées, sans modèle d'IA",
    description:
      "Mode démo : les réponses sont simulées par un script, sans modèle d'IA ni serveur.",
  },
  help: {
    title: "Comment décrire votre projet",
    intro:
      "Expliquez votre sortie comme vous le feriez à un collègue, par écrit ou à la voix. L'assistant recueille cinq informations, puis vous demande de les confirmer.",
    items: [
      {
        label: "Nombre de participants",
        hint: "élèves et accompagnateurs compris, par exemple « 27 élèves et 3 accompagnateurs »",
      },
      {
        label: "Gare de départ",
        hint: "la gare ou la ville d'où vous partez, par exemple « au départ de Toulouse Matabiau »",
      },
      {
        label: "Départ",
        hint: "date et heure, par exemple « le 12 novembre vers 8 h »",
      },
      {
        label: "Retour",
        hint: "date et heure, par exemple « retour avant 17 h »",
      },
      {
        label: "Matière ou thème",
        hint: "par exemple « professeur d'histoire » ou « le Moyen Âge »",
      },
    ],
    voiceLink: "Vous préférez parler ? Essayer la version vocale",
    privacy:
      "Aucune autre information n'est demandée ni conservée : ni budget, ni nom d'établissement.",
    example:
      "Exemple : « Bonjour, je voudrais organiser une sortie le 12 novembre au départ de Toulouse Matabiau. J'ai 27 élèves et 3 accompagnateurs, on partirait vers 8 h et on rentrerait avant 17 h. Je suis professeur d'histoire, on travaille sur le Moyen Âge. »",
    close: "Fermer",
  },
  conversation: {
    heading: "Conversation",
    logLabel: "Historique de la conversation",
    assistantName: "Assistant liO",
    you: "Vous",
    sourceAudio: "Message dicté",
    sourceEdit: "Modification depuis le panneau",
    typing: "L'assistant rédige une réponse…",
    liveRegionLabel: "Dernière réponse de l'assistant",
    scrollToBottom: "Revenir en bas",
  },
  composer: {
    label: "Votre message",
    placeholder: "Écrivez votre message…",
    placeholderShort: "Votre message…",
    hint: "Entrée pour envoyer, Maj + Entrée pour un saut de ligne",
    send: "Envoyer",
    sending: "Envoi en cours…",
    microphone: "Dicter un message",
    counter: (length: number, max: number) =>
      `${length.toLocaleString("fr-FR")} / ${max.toLocaleString("fr-FR")} caractères`,
    limitReached: (max: number) => `Limite de ${max.toLocaleString("fr-FR")} caractères atteinte`,
    microphoneUnsupported:
      "La dictée vocale n'est pas disponible dans ce navigateur. Vous pouvez écrire votre message.",
  },
  voice: {
    title: "Dictée vocale",
    requesting: "Autorisation du micro en cours…",
    recording: "Enregistrement en cours",
    recordingHint: "Parlez naturellement, puis arrêtez l'enregistrement.",
    stop: "Arrêter",
    cancel: "Annuler",
    uploading: "Transcription en cours…",
    maxDurationReached: (seconds: number) =>
      `Durée maximale atteinte (${seconds >= 60 && seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds} s`}), enregistrement arrêté.`,
    tooLarge: "L'enregistrement est trop volumineux. Réenregistrez un message plus court.",
    permissionDenied:
      "L'accès au micro a été refusé. Vous pouvez autoriser le micro dans votre navigateur ou écrire votre message.",
    noMicrophone: "Aucun micro n'a été détecté. Vous pouvez écrire votre message.",
    unsupported:
      "L'enregistrement audio n'est pas pris en charge par ce navigateur. Vous pouvez écrire votre message.",
    emptyRecording: "L'enregistrement est vide. Réessayez en parlant un peu plus longtemps.",
    uploadFailed: "La transcription a échoué.",
    retryUpload: "Réessayer la transcription",
    reRecord: "Réenregistrer",
    writeInstead: "Écrire à la place",
    elapsed: (seconds: number) => `${seconds} s`,
    timerLabel: "Durée de l'enregistrement",
  },
  transcription: {
    title: "Vérifiez la transcription",
    hint: "Corrigez le texte si nécessaire avant de l'envoyer.",
    label: "Texte transcrit",
    send: "Envoyer",
    reRecord: "Réenregistrer",
    cancel: "Annuler",
    demoNotice: "Transcription simulée (mode démo).",
  },
  panel: {
    title: "Votre projet",
    subtitle: "Les informations recueillies pour préparer l'itinéraire.",
    progress: (known: number, total: number) => `${known} / ${total} informations`,
    progressComplete: (total: number) => `${total} / ${total} informations · complet`,
    toggleShow: "Afficher le détail",
    toggleHide: "Masquer le détail",
    missing: "À préciser",
    known: "Renseigné",
    edit: "Modifier",
    save: "Enregistrer",
    cancel: "Annuler",
    saving: "Enregistrement…",
    clarificationPending: "Une précision est attendue",
    editingLabel: (label: string) => `Modifier : ${label}`,
    updated: "Mis à jour",
  },
  fields: {
    participants_count: {
      label: "Participants",
      description: "Élèves et accompagnateurs compris",
      inputLabel: "Nombre total de participants",
      unit: (n: number) => (n > 1 ? `${n} participants` : `${n} participant`),
      breakdown: (students: number | null, accompanying: number | null) => {
        const parts: string[] = [];
        if (students !== null) parts.push(students > 1 ? `${students} élèves` : `${students} élève`);
        if (accompanying !== null) {
          parts.push(
            accompanying > 1 ? `${accompanying} accompagnateurs` : `${accompanying} accompagnateur`,
          );
        }
        return parts.join(" et ");
      },
      studentsOnly: (students: number) =>
        `${students} élèves — nombre d'accompagnateurs à préciser`,
    },
    departure_station: {
      label: "Gare de départ",
      description: "La gare ou la ville de départ",
      inputLabel: "Gare de départ",
      placeholder: "ex. Toulouse Matabiau",
    },
    departure: {
      label: "Départ",
      description: "Date, heure et contrainte",
      dateLabel: "Date de départ",
      timeLabel: "Heure de départ",
      constraintLabel: "Contrainte horaire du départ",
    },
    return: {
      label: "Retour",
      description: "Date, heure et contrainte",
      dateLabel: "Date de retour",
      timeLabel: "Heure de retour",
      constraintLabel: "Contrainte horaire du retour",
    },
    teaching_type: {
      label: "Matière ou thème",
      description: "L'un des deux suffit",
      subjectLabel: "Matière",
      themeLabel: "Thème",
      subjectPlaceholder: "ex. Histoire",
      themePlaceholder: "ex. Moyen Âge",
    },
  },
  constraints: {
    exact: "à",
    approximate: "vers",
    earliest: "à partir de",
    latest: "au plus tard à",
  },
  dateTime: {
    timeMissing: "heure à préciser",
    dateMissing: "date à préciser",
  },
  confirmation: {
    title: "Vérification avant transmission",
    message:
      "Vérifiez le récapitulatif dans « Votre projet », puis confirmez pour transmettre ces informations.",
    edit: "Modifier",
    confirm: "Confirmer et continuer",
    confirming: "Confirmation…",
    confirmedTitle: "Projet confirmé",
    confirmedMessage: "Voici les informations transmises au module de planification.",
    stillEditable: "Vous pouvez encore modifier une information : une nouvelle confirmation vous sera demandée.",
    jsonTitle: "JSON transmis",
    jsonShow: "Afficher le JSON transmis",
    jsonHide: "Masquer le JSON transmis",
    jsonCopy: "Copier",
    jsonCopied: "Copié",
    jsonHint:
      "Charge utile versionnée transmise au module de planification (schema_version 1.1).",
  },
  states: {
    COLLECTING: "Collecte des informations",
    ASKING_USER: "Précision demandée",
    AWAITING_CONFIRMATION: "En attente de votre confirmation",
    EDITING: "Modification en cours",
    CONFIRMED: "Projet confirmé",
    HANDOFF: "Transmis au module de planification",
  },
  errors: {
    title: "Une erreur est survenue",
    retry: "Réessayer",
    dismiss: "Fermer",
    network: "Impossible de joindre le serveur. Vérifiez votre connexion puis réessayez.",
    generic: "Désolé, je n'ai pas pu traiter votre demande. Pouvez-vous réessayer ?",
    provider: "Désolé, je n'ai pas pu traiter votre message. Pouvez-vous réessayer ?",
    staleVersion:
      "Les informations ont changé entre-temps. Le projet a été rechargé : vérifiez-le avant de modifier à nouveau.",
    rateLimited: "Trop de demandes en peu de temps. Patientez quelques instants avant de réessayer.",
    notFound: "Cette conversation n'existe plus. Une nouvelle conversation a été ouverte.",
    initFailed: "Impossible de démarrer la conversation.",
    exportUnavailable: "Le JSON n'est disponible qu'après confirmation.",
    copyFailed: "La copie n'a pas fonctionné. Sélectionnez le texte manuellement.",
  },
  loading: {
    conversation: "Chargement de la conversation…",
  },
  /**
   * Journey after confirmation (docs/PLANNER_CONTRACT.md). Only chrome and labels: stage
   * messages, reasons, adjustment labels, notices and booking messages come from the server.
   */
  journey: {
    sectionLabel: "Propositions et réservation",
    noticesLabel: "À savoir sur ces propositions",
    loading: "Chargement des propositions…",
    interrupted:
      "La recherche de propositions est interrompue : confirmez à nouveau vos informations pour la relancer.",
    /** Pointer from the confirmed card to the journey, which may be below the fold. */
    continue: "Voir la suite : propositions de sortie",
    restart: "Relancer la recherche",
    restarting: "Recherche…",
    editRequest: "Modifier ma demande",
    start: {
      title: "Propositions de sortie",
      message:
        "Vos informations sont confirmées. Lancez la recherche pour voir des destinations, des activités et des itinéraires.",
      action: "Rechercher des propositions",
      pending: "Recherche…",
    },
    scenario: {
      toggle: "Scénario de test",
      hint: "Outil de test de la simulation : choisissez la situation à reproduire à la prochaine recherche.",
      searchLabel: "Recherche",
      bookingLabel: "Réservation",
      search: {
        auto: "Automatique",
        adjustments: "Ajustements proposés",
        no_match: "Aucun résultat",
        error: "Erreur technique",
      },
      booking: {
        confirmed: "Confirmée",
        refused: "Refusée une fois",
        error: "Erreur technique",
      },
    },
    stages: {
      destinations: "Destinations proposées",
      itineraries: "Itinéraires possibles",
      adjustments: "Ajustements possibles",
      no_match: "Aucune proposition",
      review: "Vérification avant réservation",
      booking_pending: "Demande de réservation envoyée",
      booked: "Réservation confirmée",
      booking_refused: "Réservation non confirmée",
      closed: "Sortie clôturée",
    },
    destinations: {
      listLabel: "Destinations",
      changeTitle: "Choisir une autre destination",
      change: "Changer de destination",
      back: "Revenir à l'étape en cours",
      current: "Destination actuelle",
      travel: (duration: string) => `${duration} de trajet`,
      station: (station: string) => `Gare d'arrivée : ${station}`,
      departureStations: (stations: string) => `Gares de départ possibles : ${stations}`,
      places: "Lieux",
      walk: (minutes: number) => `${minutes} min à pied de la gare`,
      activities: "Activités",
      activitiesHint: "Cochez les activités souhaitées. Sans activité cochée, la première est retenue.",
      choose: "Choisir cette destination",
      choosing: "Recherche des itinéraires…",
    },
    itinerary: {
      listLabel: "Itinéraires",
      outbound: "Aller",
      return: "Retour",
      to: "vers",
      activities: "Activités sur place",
      activityTime: (start: string, end: string) => `${start} – ${end}`,
      freeTime: (duration: string) => `Temps libre sur place : ${duration}`,
      participants: (count: number) => (count > 1 ? `${count} participants` : `${count} participant`),
      checks: "Vérifications",
      checkOk: "Vérifié",
      checkFailed: "Non vérifié",
      choose: "Choisir cet itinéraire",
      choosing: "Sélection…",
    },
    adjustments: {
      reasonTitle: "Pourquoi rien ne convient tel quel",
      consent: "Rien n'est modifié tant que vous n'avez pas accepté un ajustement.",
      listLabel: "Ajustements proposés",
      becomes: "devient",
      unlocks: (count: number) => (count > 1 ? `${count} itinéraires possibles` : `${count} itinéraire possible`),
      accept: "Accepter cet ajustement",
      accepting: "Application…",
      otherDestination: "Choisir une autre destination",
    },
    noMatch: {
      hint: "La recherche a bien fonctionné : il ne s'agit pas d'une erreur technique.",
      otherDestination: "Choisir une autre destination",
    },
    review: {
      notBooked: "Rien n'est réservé pour l'instant.",
      submit: "Envoyer la demande de réservation",
      submitting: "Envoi de la demande…",
      otherItinerary: "Choisir un autre itinéraire",
    },
    pending: {
      reference: (reference: string) => `Référence : ${reference}`,
      waiting: "Réponse du service de réservation en attente…",
      check: "Vérifier la réponse",
      checking: "Vérification…",
    },
    refused: {
      alternatives: "Autres itinéraires possibles",
    },
    travelFile: {
      title: "Dossier de voyage",
      loading: "Préparation du dossier de voyage…",
      reference: (reference: string) => `Référence : ${reference}`,
      schedule: "Déroulé de la journée",
      places: "Lieux",
      safety: "Conseils de sécurité",
      contacts: "Contacts utiles",
      links: "Liens officiels",
      print: "Imprimer le dossier",
    },
    feedback: {
      title: "Votre retour d'expérience",
      ratingLegend: "Note globale",
      rating: (rating: number) => `${rating} sur 5`,
      commentLabel: "Commentaire (facultatif)",
      submit: "Envoyer mon avis",
      submitting: "Envoi…",
      given: (rating: number) => `Votre note : ${rating} sur 5`,
    },
  },
} as const;

export type Fr = typeof fr;
