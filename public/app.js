'use strict';
/* ATV Manager — interface web (sans framework) */

const $app = document.getElementById('app');
const $modal = document.getElementById('modal');
const S = { devices: [], settings: { tailscale: { enabled: false }, ai: { enabled: false } }, levels: {}, version: '', subnets: [], pending: [], scanning: false, scanInfo: null, loaded: false };
let renderId = 0;

// ---------- Icônes (traits, 24×24)
const ICONS = {
  tv: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>',
  sliders: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  dash: '<path d="M8 12h8"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  alert: '<path d="M10.3 4.2 2.6 17.6A2 2 0 0 0 4.3 20.6h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4M12 17h.01"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.6-4.5L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.6 4.5L20 16"/><path d="M20 20v-4h-4"/>',
  shield: '<path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3z"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5M5 12h11"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 20a6.5 6.5 0 0 0-2.5-5.1"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 8.7-8.7M16 7l2.5 2.5M14 9l2 2"/>',
  home: '<path d="M4 11 12 4l8 7"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>',
  remote: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/><path d="m10 8.5 4 1.5-4 1.5z"/>',
  // Accessoires
  rc: '<rect x="8" y="2.5" width="8" height="19" rx="3"/><circle cx="12" cy="8" r="1.8"/><path d="M12 13h.01M12 16.5h.01"/>',
  bluetooth: '<path d="m7 7 10 10-5 4V3l5 4L7 17"/>',
  gamepad: '<path d="M7.5 7h9a4.5 4.5 0 0 1 4.4 5.5l-.9 4a2.6 2.6 0 0 1-4.4 1.2L14 16h-4l-1.6 1.7A2.6 2.6 0 0 1 4 16.5l-.9-4A4.5 4.5 0 0 1 7.5 7z"/><path d="M8 10.5v3M6.5 12h3M15.5 11h.01M17.5 13h.01"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/>',
  mouse: '<rect x="6" y="3" width="12" height="18" rx="6"/><path d="M12 7v4"/>',
  headphones: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/>',
  volume: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  usb: '<circle cx="12" cy="19" r="2"/><path d="M12 17V4M9.5 6.5 12 4l2.5 2.5M12 14l-4-2.5V9M12 12l4-2.5V7.5"/><circle cx="8" cy="8" r="1"/><path d="M15 5.5h2v2h-2z"/>',
  drive: '<rect x="3" y="13" width="18" height="7" rx="2"/><path d="M5 13 7.5 5h9L19 13"/><path d="M16 16.5h.01"/>',
  hdmi: '<path d="M3 8h18v5l-3 3H6l-3-3z"/><path d="M7 11h10"/>',
  wifi: '<path d="M2.5 9a14 14 0 0 1 19 0"/><path d="M5.5 12.5a9.5 9.5 0 0 1 13 0"/><path d="M8.7 15.8a5 5 0 0 1 6.6 0"/><path d="M12 19h.01"/>',
  ethernet: '<rect x="4" y="4" width="16" height="13" rx="2"/><path d="M8 17v3h8v-3M9 8v3M12 8v3M15 8v3"/>',
  battery: '<rect x="2.5" y="7" width="17" height="10" rx="2"/><path d="M22 11v2"/>',
  plug: '<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0z"/><path d="M12 17v4"/>',
};
const ic = (n) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ''}</svg>`;

// ---------- Utilitaires
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, root = $app) => root.querySelector(sel);
const $$ = (sel, root = $app) => [...root.querySelectorAll(sel)];
const fmtMb = (mb) => (mb >= 1024 ? `${(mb / 1024).toFixed(1).replace('.', ',')} Go` : `${Math.round(mb)} Mo`);
const fmtDate = (iso) => new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const ago = (ts) => {
  if (!ts) return 'jamais vue';
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return "vue à l'instant";
  if (m < 60) return `vue il y a ${m} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `vue il y a ${h} h` : `vue il y a ${Math.round(h / 24)} j`;
};
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;
const displayName = (d) => d.label || d.deviceName || `${d.brand || ''} ${d.model || ''}`.trim() || d.host;
const RISK = {
  safe: { label: 'Sans risque', dot: 'ok' },
  info: { label: 'À savoir', dot: 'note' },
  warn: { label: 'Déconseillé', dot: 'bad' },
  protected: { label: 'Essentielle', dot: '' },
  unknown: { label: 'Inconnue', dot: '' },
};

// ---------- Textes regroupés pour le futur sélecteur de langue FR/EN (CleanYourTV, lanceur d'origine)
const CYT_URL = 'https://github.com/Gathin23/cleanyourtv';
const TXT = {
  fr: {
    cytBadge: 'CleanYourTV',
    cytTip: "Proposé d'après la liste CleanYourTV",
    cytTipModel: (m) => `Proposé d'après la liste CleanYourTV pour le modèle ${m}`,
    cytNote: 'Note CleanYourTV :',
    cytModel: 'Modèle reconnu par CleanYourTV :',
    cytNoModel: 'Suggestions issues de CleanYourTV (aucun modèle exact reconnu)',
    cytHelp: 'Ces applis viennent de listes partagées par la communauté pour chaque modèle de TV. Tu gagnes des suggestions adaptées à ta TV ; vérifie quand même ce que tu perds avant de cocher.',
    cytCredit: 'Listes de paquets par modèle :',
    cytCreditBy: 'par Gathin (licence MIT)',
    // Remettre le lanceur d'origine
    homeTitle: "Écran d'accueil",
    homeDesc: "Si l'écran d'accueil ne marche plus ou ne plaît pas, remets celui d'origine (Google TV, Android TV ou celui du fabricant). Tu gagnes un accueil qui fonctionne à coup sûr ; tu retrouves aussi ses suggestions et publicités. Le lanceur installé reste disponible dans les applis.",
    homeBtn: "Remettre le lanceur d'origine",
    homeBusy: 'Remise en place…',
    homeConfirmTitle: "Remettre le lanceur d'origine ?",
    homeConfirm: "L'accueil d'origine (Google TV, Android TV ou celui du fabricant) redeviendra l'écran d'accueil. Le lanceur installé reste disponible dans les applis.",
    homeConfirmBtn: 'Remettre',
    homeOk: "Lanceur d'origine remis en place.",
    homeKo: "Le lanceur d'origine n'a pas pu être remis complètement.",
    homeNow: 'Bouton Accueil de la télécommande :',
    homeUnknown: 'non déterminé',
    homeOld: 'Fonction disponible après la mise à jour du serveur.',
    homeNames: { google: 'Google TV', atv: 'Android TV' },
    homeHist: "Lanceur d'origine remis",
    // Lanceur Plume (écran d'accueil)
    plumeTitle: 'Lanceur Plume',
    plumeMissing: "Installe Plume Launcher sur la TV, puis reviens ici pour l'utiliser comme écran d'accueil.",
    plumeRefresh: 'Actualiser',
    plumeDesc: "Le bouton Accueil de la télécommande ouvrira Plume. Tu gagnes un accueil simple, sans publicité. Tu perds les suggestions de l'accueil d'origine, qui reste installé en secours.",
    plumeA11y: "Plume reçoit un service d'accessibilité : c'est nécessaire pour intercepter le bouton Accueil.",
    plumeEnable: 'Utiliser Plume comme écran d\'accueil',
    plumeEnableBusy: 'Mise en place…',
    plumeActive: "Plume est l'écran d'accueil",
    plumeActiveDesc: "Le bouton Accueil ouvre Plume. Le lanceur d'origine est toujours installé et peut revenir à tout moment.",
    plumeNoGrant: "Le service d'accessibilité de Plume n'est pas actif : le bouton Accueil peut encore ouvrir l'accueil d'origine. Ouvre Plume une fois sur la TV, puis réessaie.",
    plumeRetry: 'Réessayer',
    plumeDisable: "Revenir à l'accueil d'origine",
    plumeDisableBusy: 'Retour en cours…',
    plumeDisableTitle: "Revenir à l'accueil d'origine ?",
    plumeDisableConfirm: "Le bouton Accueil rouvrira l'accueil d'origine (Google TV, Android TV ou celui du fabricant), avec ses suggestions et publicités. Plume reste installé : tu pourras le remettre ici.",
    plumeDisableBtn: 'Revenir',
    plumeOk: "C'est fait : le bouton Accueil ouvre Plume.",
    plumeTodo: 'Ouvre Plume une fois sur la TV pour terminer sa configuration, puis réessaie.',
    plumeUnsure: "Plume est activé, mais le bouton Accueil n'a pas pu être vérifié. Appuie dessus sur la TV pour contrôler.",
    plumeOff: "C'est fait : l'accueil d'origine est revenu.",
    plumeKo: "Plume n'a pas pu être réglé complètement.",
    plumeGone: "Plume n'est plus installé sur la TV.",
    plumeLog: 'Détail des opérations',
    plumeHistOn: "Plume activé comme écran d'accueil",
    plumeHistOff: 'Plume retiré, accueil d\'origine remis',
    plumeHistOk: 'Fait',
    plumeHistTodo: 'À terminer sur la TV',
    plumeHistKo: 'Incomplet',
    plumeHistEmpty: 'Aucun détail enregistré.',
    plumeErr: "Impossible de lire l'état de Plume sur la TV.",
    stockLabel: "Désactiver aussi l'accueil d'origine",
    stockDesc: "pour libérer le plus de mémoire. Sur certaines TV, un bouton de la télécommande peut ne plus rien faire. Réactivable depuis l'historique ou avec « Remettre le lanceur d'origine ».",
    stockOff: '(impossible sur cette TV)',
    stockRivals: 'Seront aussi désactivés, car ils reprendraient le bouton Accueil :',
    // Fire TV récente (Fire OS 8) : ajout par Tailscale en libre-service
    ftsTitle: 'Fire TV récente (Fire OS 8) : passe par Tailscale',
    ftsIntro: "Sur ces Fire TV, ATVM Connect est bloqué par Amazon. À la place, la Fire TV installe <b>Tailscale</b>, un réseau privé qui la relie à ce serveur, où qu'elle soit. Tu gagnes : la TV se gère à distance comme les autres. Tu perds : l'appli Tailscale reste installée et active sur la TV (un peu de mémoire).",
    ftsOff: "L'accès Tailscale n'est pas activé sur ce serveur : demande à l'administrateur de l'activer.",
    ftsOffAdmin: 'Pour la proposer, configure un client OAuth Tailscale dans <a href="#/settings">Réglages</a>.',
    ftsBefore: 'Avant de commencer : le <b>mode développeur</b> et le <b>Débogage ADB</b> doivent être activés sur la Fire TV.',
    ftsGuide: 'Voir le guide Fire TV',
    fts1Title: "Installe l'appli Tailscale",
    fts1Code: "Dans <b>Downloader</b>, tape ce code. Il installe l'appli <b>officielle</b> Tailscale :",
    fts1NoCode: "Installe l'appli <b>Tailscale</b> depuis l'Appstore Amazon (recherche « Tailscale »).",
    fts1After: 'Lance le téléchargement puis <b>Installer</b>.',
    fts2Title: 'Génère ta clé Tailscale',
    fts2Desc: 'Cette clé permet à la Fire TV de rejoindre le réseau de ce serveur, et rien d’autre.',
    fts2Btn: 'Générer ma clé Tailscale',
    fts2Busy: 'Création…',
    fts2Valid: (t) => `Valable 1 h (jusqu'à ${t}), une seule utilisation.`,
    fts2Once: 'Elle ne sera plus affichée : garde cette page ouverte ou copie-la maintenant.',
    fts2Copied: 'Clé copiée.',
    fts2Again: 'Générer une autre clé',
    fts2Busy409: "L'accès Tailscale n'est pas disponible pour le moment. Préviens l'administrateur.",
    ftsCheckLink: "Réglages › Vérifier les règles d'accès",
    fts2Busy429: 'Trop de clés créées (3 par heure) : réessaie un peu plus tard.',
    fts3Title: 'Entre la clé sur la TV',
    fts3Desc: "Ouvre Tailscale sur la TV, puis la roue crantée <b>Settings</b> › <b>Accounts</b> › menu <b>⋮</b> en haut à droite › <b>Use an auth key</b> (pas « Log in », qui sert à l'autre façon). Tape la clé, puis <b>Connect</b>.",
    fts3Tip: "<b>Le plus simple :</b> ouvre ce site sur ton téléphone, appuie sur <b>Copier</b>, puis dans l'appli <b>Amazon Fire TV</b> (télécommande du téléphone), touche l'icône clavier et colle la clé.",
    fts4Title: 'Autorise ce serveur',
    fts4Desc: "Dès que la TV est sur Tailscale, ce serveur s'y connecte et la fenêtre « Autoriser le débogage ? » s'affiche sur la TV : coche <b>Toujours autoriser</b> puis OK. Le suivi se met à jour tout seul ici.",
    ftsNone: 'Aucune demande en cours.',
    // Deux façons de relier la Fire TV à Tailscale
    ftsHowTitle: 'Relie la TV à Tailscale',
    ftsHowDesc: 'Deux façons, au choix :',
    ftsOptCode: "Plus simple : avec le code affiché par la TV (validation par l'administrateur)",
    ftsOptCodeDesc: "Tu gagnes : juste un code court à taper ici. Tu perds : l'administrateur doit le valider, ça peut prendre un peu de temps.",
    ftsOptKey: 'Avec une clé à entrer sur la TV',
    ftsOptKeyDesc: 'Tu gagnes : immédiat, sans attendre personne. Tu perds : une longue clé à entrer sur la TV (collable depuis ton téléphone).',
    // Option 2 : code affiché par la TV
    dc1: 'Ouvre Tailscale sur la TV et choisis <b>Log in</b> : un QR code s’affiche, avec un <b>code</b> en dessous.',
    dc2: "Tape ce code ici et envoie-le à l'administrateur :",
    dcLabel: 'Code affiché par la TV',
    dcSend: "Envoyer à l'administrateur",
    dcBusy: 'Envoi…',
    dcSent: "Code envoyé à l'administrateur.",
    dc3: "L'administrateur valide le code dans Tailscale. <b>Ça peut prendre un peu de temps</b> : il doit être disponible. Tu peux fermer cette page, le suivi ci-dessous reprendra quand tu reviendras.",
    dcErr400: 'Ce code ne ressemble pas à celui de la TV : vérifie-le (lettres et chiffres sous le QR code).',
    dcErr409: "Cette façon n'est pas disponible pour le moment. Préviens l'administrateur ou utilise la clé.",
    dcErr429: 'Trop de codes envoyés : réessaie un peu plus tard.',
    dcRow: (t) => `Code envoyé à ${t}`,
    dcBy: (n) => `par ${n}`,
    dcValidate: 'Valider',
    dcSt: {
      'waiting-admin': "En attente de validation par l'administrateur",
      'waiting-auth': 'Fenêtre d’autorisation affichée sur la TV : coche « Toujours autoriser » puis OK.',
      offline: 'La TV ne répond pas : vérifie que le Débogage ADB est activé.',
      done: 'TV ajoutée',
      expired: 'Expirée : sur la TV, refais « Log in » et envoie le nouveau code.',
      rejected: "Refusée par l'administrateur",
    },
    // Administrateur : codes Tailscale à valider
    tvwBanner: (n) => `${n} TV ${n > 1 ? 'attendent' : 'attend'} ta validation dans Tailscale`,
    tvwBannerDesc: 'Des personnes ont envoyé le code affiché par leur Fire TV.',
    tvwOpen: 'Voir les demandes',
    tvwTitle: 'TV à valider dans Tailscale',
    tvwIntro: "Chaque demande contient le code affiché par une Fire TV. Tu valides le code dans ta console Tailscale, puis tu rattaches l'appareil créé : ce serveur l'étiquette TV, l'isole (il ne voit que ce serveur) et s'y connecte.",
    tvwNone: 'Aucune TV en attente de validation.',
    tvwFrom: (n, t) => `Demande de ${n} · ${t}`,
    tvwSomeone: "quelqu'un",
    tvwCopy: 'Copier le code',
    tvwCopied: 'Code copié.',
    tvwStep1: 'Saisis ce code dans la console Tailscale :',
    tvwPath: 'Add device › Client device › Android › Input code',
    tvwConsole: 'Ouvrir la console Tailscale',
    tvwThen: 'puis',
    tvwStep2: "Une fois le code validé, choisis l'appareil créé :",
    tvwPick: "J'ai validé : choisir l'appareil",
    tvwPickBusy: 'Recherche…',
    tvwNoCand: "Rien de nouveau pour l'instant, réessaie dans quelques secondes.",
    tvwRefresh: 'Actualiser',
    tvwAttach: 'Rattacher',
    tvwAttachBusy: 'Rattachement…',
    tvwCreated: (t) => `créé à ${t}`,
    tvwConfirmTitle: (n) => `Rattacher ${n} ?`,
    tvwConfirm: "<p>Cet appareil sera <b>étiqueté TV</b> et <b>isolé</b> : il ne pourra plus joindre que ce serveur sur ton réseau Tailscale, et sa clé n'expirera plus.</p><p><b>Ne choisis pas un téléphone ou un PC personnel</b> : il perdrait l'accès à tes autres appareils Tailscale.</p>",
    tvwConfirmBtn: 'Rattacher',
    tvwAttached: 'Appareil rattaché : la TV va demander l’autorisation de débogage.',
    tvwReject: 'Refuser',
    tvwRejectTitle: 'Refuser cette demande ?',
    tvwRejectDesc: (n) => `<p>${n} verra « Refusée » et devra recommencer. Rien n'est modifié dans Tailscale.</p>`,
    tvwRejected: 'Demande refusée.',
    tvwRecent: 'Suivi des autres demandes',
    // Réglages : notifications Gotify
    ntfTitle: 'Notifications',
    ntfLbl: 'Gotify',
    ntfOn: 'configuré',
    ntfDesc: "Reçois une notification sur ton téléphone quand quelqu'un attend ta validation (par exemple le code d'une Fire TV). Tu gagnes : pas besoin de surveiller le site. Tu perds : rien, mais il te faut un serveur <b>Gotify</b> et un jeton d'application créé dedans. Le jeton reste sur ce serveur et n'est jamais réaffiché.",
    ntfUrl: 'Adresse du serveur Gotify',
    ntfToken: "Jeton d'application",
    ntfKeep: 'Jeton enregistré, laisse vide pour le garder',
    ntfSave: 'Enregistrer',
    ntfSaved: 'Notifications enregistrées.',
    ntfTest: 'Envoyer un test',
    ntfTestBusy: 'Envoi…',
    ntfTestOk: 'Test envoyé : vérifie que le message est bien arrivé.',
    ntfDel: 'Désactiver',
    ntfDeleted: 'Notifications désactivées.',
    ntfNeedUrl: "Indique l'adresse et le jeton.",
    // Notifications : webhook (Home Assistant)
    whkLbl: 'Webhook (Home Assistant)',
    whkDesc: "Envoie les mêmes alertes à Home Assistant (ou tout outil qui reçoit un webhook). Tu gagnes : une notification sur l'appli Home Assistant, une lampe qui clignote… Tu perds : rien, mais il faut créer l'automatisation. L'adresse contient un identifiant secret : elle reste sur ce serveur et n'est jamais réaffichée.",
    whkHelp: "Dans Home Assistant › Automatisations, crée une automatisation avec le déclencheur <b>Webhook</b> (méthode POST, accès local). L'adresse ressemble à <span class=\"mono\">http://IP-de-HA:8123/api/webhook/xxxx</span>. Le corps reçu est <span class=\"mono\">{title, message, url}</span>.",
    whkUrl: 'Adresse du webhook',
    whkKeep: 'Adresse enregistrée, laisse vide pour la garder',
    whkNeed: "Indique l'adresse du webhook.",
    whkSaved: 'Webhook enregistré.',
    whkDel: 'Retirer',
    whkDeleted: 'Webhook retiré.',
    // Notifications : test de tous les canaux
    ntfTestLbl: 'Tester les notifications',
    ntfTestDesc: 'Envoie un message de test sur chaque canal configuré.',
    ntfRes: { ok: 'envoyé', absent: 'non configuré', erreur: "échec : vérifie l'adresse et que le serveur est joignable" },
    ntfResDot: { ok: 'ok', absent: '', erreur: 'bad' },
    ftsSt: {
      'waiting-device': 'En attente de la TV sur Tailscale…',
      'waiting-auth': 'Fenêtre d’autorisation affichée sur la TV : coche « Toujours autoriser » puis OK.',
      offline: 'La TV ne répond pas : vérifie que le Débogage ADB est activé.',
      done: 'TV ajoutée',
      expired: 'Clé expirée',
    },
    ftsKey: (t) => `Clé créée à ${t}`,
    ftsOpen: 'Ouvrir sa fiche',
    ftsPrompt: "Afficher la fenêtre d'autorisation sur la TV",
    ftsPromptBusy: 'Envoi…',
    ftsPrompted: 'Demande envoyée : regarde l’écran de la TV.',
    ftsAdded: (n) => `${n} est ajoutée.`,
    // Réglages : client OAuth Tailscale
    tsoTitle: 'Client OAuth Tailscale',
    tsoOn: 'configuré',
    tsoId: 'ID du client',
    tsoSecret: 'Secret du client',
    tsoKeep: 'Secret enregistré, laisse vide pour le garder',
    tsoKeepId: 'ID enregistré, laisse vide pour le garder',
    tsoHelp: "Permet à chacun d'ajouter sa Fire TV récente par Tailscale, sans passer par toi : le site crée des clés à usage unique valables 1 h. À créer dans la console Tailscale › Settings › <b>Trust credentials</b> (anciennement OAuth clients), avec uniquement les droits : <span class=\"mono\">Auth Keys</span> (écriture), <span class=\"mono\">Devices Core</span> (écriture), <span class=\"mono\">Policy File</span> (lecture), et l'étiquette <span class=\"mono\">tag:tvbox</span>. Le secret reste sur ce serveur et n'est jamais réaffiché.",
    tsoSave: 'Enregistrer le client',
    tsoSaved: 'Client OAuth enregistré.',
    tsoDel: 'Supprimer le client',
    tsoDeleted: 'Client OAuth supprimé.',
    tsoCheck: "Vérifier les règles d'accès",
    tsoCheckBusy: 'Vérification…',
    tsoCheckOk: "Règles d'accès correctes : les TV ajoutées par Tailscale ne voient que ce serveur.",
    tsoCheckKo: 'À corriger dans la console Tailscale :',
    // Proches : réinitialisation du mot de passe par l'administrateur
    rpwBtn: 'Réinitialiser le mot de passe',
    rpwConfirmTitle: (n) => `Réinitialiser le mot de passe de ${n} ?`,
    rpwConfirm: (n) => `<p><b>${n}</b> sera déconnecté partout ; un mot de passe provisoire va s'afficher une seule fois.</p><p class="sm t3">Tu gagnes : il retrouve l'accès à son compte. Tu perds : son ancien mot de passe ne marche plus.</p>`,
    rpwConfirmBtn: 'Réinitialiser',
    rpwTitle: 'Mot de passe provisoire',
    rpwLead: (n) => `Envoie ces informations à ${n}. Ce mot de passe ne sera plus jamais affiché : copie-le maintenant.`,
    rpwUser: 'Identifiant',
    rpwPwd: 'Mot de passe provisoire',
    rpwMust: 'À sa prochaine connexion, il devra choisir son propre mot de passe.',
    rpwCopy: 'Copier identifiant et mot de passe',
    rpwCopied: 'Identifiant et mot de passe copiés : envoie-les à ton proche.',
    rpwMsg: (url, u, p) => `Ton accès à ATV Manager a été réinitialisé.\nAdresse : ${url}\nIdentifiant : ${u}\nMot de passe provisoire : ${p}\nTu devras choisir ton propre mot de passe à la connexion.`,
    rpwTfaNote: 'Son compte a aussi la double authentification. S’il a perdu son téléphone, réinitialise-la aussi : il se connectera avec le seul mot de passe et pourra la réactiver.',
    rpwTfaBtn: 'Réinitialiser la double authentification',
    rpwTfaDone: 'Double authentification réinitialisée.',
    rpwClose: 'J’ai noté, fermer',
    // Changement de mot de passe obligatoire
    mcpTitle: 'Choisis ton mot de passe',
    mcpLead: 'Ton mot de passe a été réinitialisé par l’administrateur. Avant de continuer, remplace le mot de passe provisoire par un mot de passe à toi, que tu es seul à connaître.',
    mcpCurrent: 'Mot de passe provisoire',
    mcpNext: 'Nouveau mot de passe',
    mcpConfirm: 'Confirme le nouveau mot de passe',
    mcpSubmit: 'Enregistrer et continuer',
    mcpDone: 'Mot de passe enregistré. Bienvenue !',
    mcpLater: 'Se déconnecter',
  },
};
const T = TXT.fr;
// Nom lisible du composant qui reçoit le bouton Accueil (ex. com.google.android.apps.tv.launcherx/.home.HomeActivity)
const homeName = (comp) => {
  const c = String(comp || '').trim();
  if (!c) return '';
  if (/launcherx/i.test(c)) return T.homeNames.google;
  if (/tvlauncher|leanback/i.test(c)) return T.homeNames.atv;
  return c.split('/')[0];
};
const isCyt = (a) => a && a.source === 'CleanYourTV';
// Les notes CleanYourTV sont souvent en anglais : repérage simple (pas d'accent, mots anglais courants).
const looksEnglish = (s) => {
  const t = ` ${String(s || '').toLowerCase()} `;
  if (/[àâçéèêëîïôûùüœ]/.test(t)) return false;
  const en = (t.match(/\b(the|and|is|of|to|for|used|not|this|can|be|it|if|with|safe|remove|app|service|apps|may|will|you|your|disable|needed|required)\b/g) || []).length;
  const fr = (t.match(/\b(le|la|les|des|une|est|pour|et|du|sur|ta|ton|tes|pas|qui)\b/g) || []).length;
  return en > fr;
};
const cytCredit = () => `${T.cytCredit} <a href="${CYT_URL}" target="_blank" rel="noopener noreferrer">CleanYourTV</a> ${T.cytCreditBy}`;

async function api(path, { method = 'GET', body } = {}) {
  let res;
  const post = method !== 'GET';
  try {
    res = await fetch(path, { method, credentials: 'same-origin', headers: post ? { 'Content-Type': 'application/json' } : {}, body: post ? JSON.stringify(body || {}) : undefined });
  } catch {
    throw new Error("Le serveur ATV Manager ne répond pas. Vérifie qu'il est bien lancé.");
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    S.user = null;
    S.loaded = false;
    showAuth('login');
  }
  if (!res.ok) throw Object.assign(new Error(data.error || `Erreur ${res.status}`), { data, status: res.status });
  return data;
}
const isAdmin = () => S.user && S.user.role === 'admin';

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind === 'error' ? 'err' : ''}`;
  el.innerHTML = `${ic(kind === 'error' ? 'alert' : 'check')}<span>${esc(msg)}</span>`;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), kind === 'error' ? 7000 : 4000);
}

function busy(btn, on, label) {
  if (!btn) return;
  if (on) {
    btn.dataset.html = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spin" aria-hidden="true"></span>${esc(label || 'Patiente…')}`;
  } else {
    btn.disabled = false;
    if (btn.dataset.html) btn.innerHTML = btn.dataset.html;
  }
}

// Fenêtre de confirmation : résout true si confirmé
function confirmBox({ title, html = '', confirm = 'Confirmer', danger = false, requireCheck = '' }) {
  return new Promise((resolve) => {
    $modal.innerHTML = `
      <form method="dialog" class="dlg">
        <h2>${esc(title)}</h2>
        ${html}
        ${requireCheck ? `<label class="check"><input type="checkbox" id="m-check"><span>${esc(requireCheck)}</span></label>` : ''}
        <div class="dlg-actions">
          <button class="btn" value="cancel">Annuler</button>
          <button class="btn ${danger ? 'danger' : 'primary'}" value="ok" id="m-ok" ${requireCheck ? 'disabled' : ''}>${esc(confirm)}</button>
        </div>
      </form>`;
    const chk = $modal.querySelector('#m-check');
    if (chk) chk.addEventListener('change', () => { $modal.querySelector('#m-ok').disabled = !chk.checked; });
    $modal.onclose = () => resolve($modal.returnValue === 'ok');
    $modal.returnValue = '';
    $modal.showModal();
  });
}

function promptBox({ title, label, value = '', placeholder = '' }) {
  return new Promise((resolve) => {
    $modal.innerHTML = `
      <form method="dialog" class="dlg">
        <h2>${esc(title)}</h2>
        <label class="field">${esc(label)}<input class="input lg" type="text" id="m-input" maxlength="60" value="${esc(value)}" placeholder="${esc(placeholder)}"></label>
        <div class="dlg-actions">
          <button class="btn" value="cancel">Annuler</button>
          <button class="btn primary" value="ok">Enregistrer</button>
        </div>
      </form>`;
    const input = $modal.querySelector('#m-input');
    $modal.onclose = () => resolve($modal.returnValue === 'ok' ? input.value.trim() : null);
    $modal.returnValue = '';
    $modal.showModal();
    input.select();
  });
}

async function loadState() {
  const st = await api('/api/state');
  Object.assign(S, { features: st.features || {}, pendingAgents: st.pendingAgents || [], user: st.user, devices: st.devices, settings: st.settings || S.settings, levels: st.levels, version: st.version, subnets: st.subnets, tsCodesWaiting: Number(st.tailscaleCodesWaiting) || 0, loaded: true });
  if (S.user && S.user.mustChangePassword) { showMustChange(); throw Object.assign(new Error(T.mcpTitle), { mustChange: true }); }
  drawChrome();
}

// ---------- Navigation (barre latérale + barre d'onglets mobile)
const NAV = [
  { tab: 'devices', href: '#/', label: 'Appareils', icon: 'tv' },
  { tab: 'guide', href: '#/guide', label: 'Connexion', icon: 'link' },
  { tab: 'settings', href: '#/settings', label: 'Réglages', icon: 'sliders' },
];
let currentTab = 'devices';
let currentDevice = '';

function drawChrome() {
  const items = NAV.map((n) => `<a href="${n.href}" class="${n.tab === currentTab ? 'active' : ''}">${ic(n.icon)}<span>${n.tab === 'settings' && !isAdmin() ? 'Compte' : n.label}</span></a>`).join('');
  document.getElementById('nav-side').innerHTML = items;
  document.getElementById('nav-bottom').innerHTML = items;
  document.getElementById('side-devices').innerHTML = S.devices.length
    ? `<div class="side-label">Mes TV</div>${S.devices.map((d) => `<a href="#/tv/${encodeURIComponent(d.id)}" class="${d.id === currentDevice ? 'active' : ''}"><span class="dot ${Date.now() - (d.lastSeen || 0) < 6e5 ? 'ok' : ''}"></span><span>${esc(displayName(d))}</span></a>`).join('')}`
    : '';
  document.getElementById('side-foot').innerHTML = S.user ? `
    <div class="me">
      <span class="avatar" aria-hidden="true">${esc((S.user.name || S.user.username).charAt(0).toUpperCase())}</span>
      <span class="who"><b>${esc(S.user.name)}</b><span>${isAdmin() ? 'Administrateur' : 'Invité'}</span></span>
      <button class="btn quiet sm" data-logout title="Se déconnecter" aria-label="Se déconnecter">${ic('logout')}</button>
    </div>
    <span class="t3">Version ${esc(S.version)}</span>
    <span class="t3 credit">${cytCredit()}</span>` : '';
}

async function logout() {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* déjà déconnecté */ }
  S.user = null;
  S.loaded = false;
  S.devices = [];
  showAuth('login');
}
document.addEventListener('click', (e) => { if (e.target.closest('[data-logout]')) logout(); });

// ---------- Routage
const routes = [
  [/^\/?$/, viewDevices, 'devices'],
  [/^\/guide\/?$/, viewGuide, 'guide'],
  [/^\/settings\/?$/, viewSettings, 'settings'],
  [/^\/add\/?$/, viewAddRemote, 'devices'],
  [/^\/tailscale-codes\/?$/, viewTsCodes, 'devices'],
  [/^\/tv\/([^/]+)\/level\/([123])\/?$/, viewOptimize, 'devices'],
  [/^\/tv\/([^/]+)\/remote\/?$/, viewRemote, 'devices'],
  [/^\/tv\/([^/]+)\/?$/, viewDevice, 'devices'],
];

// Page qui garde des ressources ouvertes (dépannage : vidéo, session) : libérées au changement de page
let pageCleanup = null;

async function render() {
  const rid = ++renderId;
  if (pageCleanup) { const fn = pageCleanup; pageCleanup = null; fn(); }
  $app.classList.remove('wide');
  const hash = location.hash.replace(/^#/, '') || '/';
  const invite = /^\/invite\/([A-Za-z0-9]+)\/?$/.exec(hash);

  // Session : premier lancement, connexion ou inscription par invitation
  if (!S.user) {
    let st;
    try { st = await api('/api/auth/status'); } catch (e) { showAuth('login', '', e.message); return; }
    if (rid !== renderId) return;
    if (st.setup) { showAuth('setup'); return; }
    if (!st.user) { showAuth(invite ? 'register' : 'login', invite ? invite[1].toUpperCase() : ''); return; }
    S.user = st.user;
  }
  if (invite) { location.hash = '#/'; return; }
  if (S.user.mustChangePassword) { showMustChange(); return; }
  document.body.classList.remove('auth-mode');

  const [re, view, tab] = routes.find(([r]) => r.test(hash)) || routes[0];
  const args = (hash.match(re) || []).slice(1).map(decodeURIComponent);
  currentTab = tab;
  currentDevice = /^\/tv\//.test(hash) ? args[0] : '';
  drawChrome();
  document.querySelector('.actionbar')?.remove();
  window.scrollTo(0, 0);
  try {
    if (!S.loaded) await loadState();
    await view(rid, ...args);
  } catch (e) {
    if (rid !== renderId || e.mustChange) return;
    $app.innerHTML = `<div class="note warn">${ic('alert')}<div class="stack"><b>${esc(e.message)}</b><div><a class="btn sm" href="#/">Retour aux appareils</a></div></div></div>`;
  }
}
window.addEventListener('hashchange', render);

// =====================================================================
// Connexion, inscription, premier lancement
// =====================================================================
// Règles du mot de passe (vérifiées aussi côté serveur)
const PWD_RULES = [
  ['len', '8 caractères minimum', (p) => p.length >= 8],
  ['letter', '1 lettre', (p) => /[A-Za-z]/.test(p)],
  ['digit', '1 chiffre', (p) => /\d/.test(p)],
  ['special', '1 caractère spécial (! ? @ # - …)', (p) => /[^A-Za-z0-9]/.test(p)],
];
const PWD_RULES_HTML = `<ul class="pwd-rules" aria-live="polite">${PWD_RULES.map(([k, label]) => `<li data-rule="${k}">${ic('check')}<span>${label}</span></li>`).join('')}</ul>`;
const pwdValid = (p) => PWD_RULES.every(([, , test]) => test(p));
// Met à jour la liste des règles sous un champ mot de passe
function watchPassword(input, list) {
  if (!input || !list) return;
  const update = () => PWD_RULES.forEach(([k, , test]) => list.querySelector(`[data-rule="${k}"]`).classList.toggle('ok', test(input.value)));
  input.addEventListener('input', update);
  update();
}
function showAuth(mode, invite = '', message = '') {
  renderId++;
  document.body.classList.add('auth-mode');
  document.querySelector('.actionbar')?.remove();
  if ($modal.open) $modal.close();
  const T = {
    setup: { title: 'Bienvenue', lead: "Crée le compte administrateur. C'est lui qui ajoute les TV et invite tes proches.", submit: 'Créer le compte' },
    login: { title: 'Connexion', lead: 'Connecte-toi pour gérer tes TV.', submit: 'Se connecter' },
    register: { title: 'Créer un compte', lead: "Il te faut le code d'invitation envoyé par l'administrateur.", submit: 'Créer mon compte' },
  }[mode];
  const pwd = (name, label, auto) => `<label class="field">${label}<input class="input lg" type="password" name="${name}" autocomplete="${auto}" minlength="8" required></label>${name === 'password' && mode !== 'login' ? PWD_RULES_HTML : ''}`;
  $app.innerHTML = `
    <div class="auth">
      <div class="auth-brand"><img src="/icon.svg" alt="" width="40" height="40"><span>ATV Manager</span></div>
      <div class="panel auth-card">
        <div class="auth-head"><h1>${T.title}</h1><p class="t2 sm">${T.lead}</p></div>
        ${message ? `<div class="note warn">${ic('alert')}<div>${esc(message)}</div></div>` : ''}
        <form id="auth-form" class="auth-form" novalidate>
          ${mode === 'register' ? `<label class="field">Code d'invitation<input class="input lg mono" type="text" name="invite" value="${esc(invite)}" autocomplete="off" required style="text-transform:uppercase"></label>` : ''}
          ${mode !== 'login' ? '<label class="field">Prénom ou surnom<input class="input lg" type="text" name="name" maxlength="40" autocomplete="nickname"></label>' : ''}
          <label class="field">Identifiant<input class="input lg" type="text" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>
          ${pwd('password', 'Mot de passe', mode === 'login' ? 'current-password' : 'new-password')}
          ${mode !== 'login' ? pwd('confirm', 'Confirme le mot de passe', 'new-password') : ''}
          <p class="form-error" id="auth-error" role="alert" hidden></p>
          <button class="btn primary auth-submit" type="submit">${T.submit}</button>
        </form>
      </div>
      ${mode === 'login' ? `<p class="sm t2 auth-switch">Tu as reçu une invitation ? <a href="#" data-auth="register">Créer un compte</a></p>` : ''}
      ${mode === 'register' ? `<p class="sm t2 auth-switch">Déjà un compte ? <a href="#" data-auth="login">Se connecter</a></p>` : ''}
      ${mode !== 'login' ? '<p class="sm t3 auth-switch">Identifiant : 3 à 32 caractères, lettres, chiffres, point ou tiret.</p>' : ''}
    </div>`;

  $$('[data-auth]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); showAuth(a.dataset.auth); }));
  const form = $('#auth-form');
  form.querySelector('input:not([value=""]), input')?.focus();
  watchPassword(form.querySelector('input[name=password]'), form.querySelector('.pwd-rules'));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    const errBox = $('#auth-error');
    const showErr = (m) => { errBox.textContent = m; errBox.hidden = false; };
    errBox.hidden = true;
    if (!f.username || !f.password) return showErr('Remplis l’identifiant et le mot de passe.');
    if (mode !== 'login' && !pwdValid(f.password)) return showErr('Le mot de passe ne respecte pas toutes les règles indiquées.');
    if (mode !== 'login' && f.password !== f.confirm) return showErr('Les deux mots de passe ne correspondent pas.');
    const btn = form.querySelector('[type=submit]');
    busy(btn, true, 'Un instant…');
    try {
      const r = await api(`/api/auth/${mode}`, { method: 'POST', body: f });
      if (r.twoFactor) return showTwoFactor(r.ticket);
      authDone(r.user);
    } catch (e) {
      busy(btn, false);
      showErr(e.message);
    }
  });
}

// Écran bloquant : mot de passe provisoire à remplacer (posé par l'administrateur)
function showMustChange() {
  renderId++;
  document.body.classList.add('auth-mode');
  document.querySelector('.actionbar')?.remove();
  if ($modal.open) $modal.close();
  const pwd = (name, label, auto) => `<label class="field">${esc(label)}<input class="input lg" type="password" name="${name}" autocomplete="${auto}" minlength="8" required></label>`;
  $app.innerHTML = `
    <div class="auth">
      <div class="auth-brand"><img src="/icon.svg" alt="" width="40" height="40"><span>ATV Manager</span></div>
      <div class="panel auth-card">
        <div class="auth-head"><h1>${esc(T.mcpTitle)}</h1><p class="t2 sm">${esc(T.mcpLead)}</p></div>
        <p class="sm t2">Identifiant : <span class="mono">${esc(S.user.username)}</span></p>
        <form id="mcp-form" class="auth-form" novalidate>
          <input type="text" name="username" value="${esc(S.user.username)}" autocomplete="username" hidden>
          ${pwd('current', T.mcpCurrent, 'current-password')}
          ${pwd('next', T.mcpNext, 'new-password')}
          ${PWD_RULES_HTML}
          ${pwd('confirm', T.mcpConfirm, 'new-password')}
          <p class="form-error" id="mcp-error" role="alert" hidden></p>
          <button class="btn primary auth-submit" type="submit">${esc(T.mcpSubmit)}</button>
        </form>
      </div>
      <p class="sm t2 auth-switch"><a href="#" data-logout>${esc(T.mcpLater)}</a></p>
    </div>`;
  const form = $('#mcp-form');
  form.querySelector('input[name=current]').focus();
  watchPassword(form.querySelector('input[name=next]'), form.querySelector('.pwd-rules'));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    const errBox = $('#mcp-error');
    const showErr = (m) => { errBox.textContent = m; errBox.hidden = false; };
    errBox.hidden = true;
    if (!f.current) return showErr('Entre le mot de passe provisoire reçu.');
    if (!pwdValid(f.next)) return showErr('Le nouveau mot de passe ne respecte pas toutes les règles indiquées.');
    if (f.next !== f.confirm) return showErr('Les deux mots de passe ne correspondent pas.');
    if (f.next === f.current) return showErr('Choisis un mot de passe différent du provisoire.');
    const btn = form.querySelector('[type=submit]');
    busy(btn, true, 'Enregistrement…');
    try {
      await api('/api/account/password', { method: 'POST', body: { current: f.current, next: f.next } });
      S.user.mustChangePassword = false;
      S.loaded = false;
      toast(T.mcpDone);
      if (location.hash === '#/' || location.hash === '') render(); else location.hash = '#/';
    } catch (e) {
      busy(btn, false);
      showErr(e.message);
    }
  });
}

function authDone(user) {
  S.user = user;
  S.loaded = false;
  if (location.hash === '#/' || location.hash === '') render(); else location.hash = '#/';
}

// Seconde étape de connexion : code de l'application d'authentification ou code de secours
function showTwoFactor(ticket) {
  $app.innerHTML = `
    <div class="auth">
      <div class="auth-brand"><img src="/icon.svg" alt="" width="40" height="40"><span>ATV Manager</span></div>
      <div class="panel auth-card">
        <div class="auth-head"><h1>Vérification</h1><p class="t2 sm">Entre le code à 6 chiffres affiché par ton application d'authentification.</p></div>
        <form id="tfa-form" class="auth-form" novalidate>
          <label class="field">Code<input class="input lg mono code-input" type="text" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="12" required></label>
          <p class="form-error" id="tfa-error" role="alert" hidden></p>
          <button class="btn primary auth-submit" type="submit">Valider</button>
        </form>
        <p class="sm t3">Téléphone perdu ? Entre un de tes <b>codes de secours</b> (format ABCD-EFGH) dans le même champ.</p>
      </div>
      <p class="sm t2 auth-switch"><a href="#" id="tfa-back">Revenir à la connexion</a></p>
    </div>`;
  const form = $('#tfa-form');
  const input = form.querySelector('input');
  input.focus();
  $('#tfa-back').addEventListener('click', (e) => { e.preventDefault(); showAuth('login'); });
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const errBox = $('#tfa-error');
    errBox.hidden = true;
    const btn = form.querySelector('[type=submit]');
    busy(btn, true, 'Vérification…');
    try {
      const r = await api('/api/auth/2fa', { method: 'POST', body: { ticket, code: input.value } });
      authDone(r.user);
    } catch (e) {
      busy(btn, false);
      if (e.status === 401 && /expirée/.test(e.message)) return showAuth('login', '', e.message);
      errBox.textContent = e.message;
      errBox.hidden = false;
      input.select();
    }
  });
}

const crumbs = (items) => `<nav class="crumbs" aria-label="Fil d'Ariane">${items.map(([label, href]) => (href ? `<a href="${href}">${esc(label)}</a>` : `<span>${esc(label)}</span>`)).join(ic('chevron'))}</nav>`;

// =====================================================================
// Appareils
// =====================================================================
async function viewDevices(rid) {
  await loadState();
  if (rid !== renderId) return;
  drawDevices();
}

function drawDevices() {
  if (!isAdmin()) return drawSharedDevices();
  const ts = S.settings.tailscale.enabled;
  const info = S.scanInfo;
  const rows = [...S.pending.map(pendingRow), ...S.pendingAgents.map(pendingAgentRow), ...S.devices.map(deviceRow)];
  $app.innerHTML = `
    <div class="page-head">
      <div class="lead">
        <h1>Appareils</h1>
        <p class="t2 sm">${S.devices.length ? plural(S.devices.length, 'TV enregistrée') : 'Aucune TV enregistrée'} · réseau local${ts ? ' et Tailscale' : ''}</p>
      </div>
      <div class="form-row" style="gap:8px">
        ${S.devices.length ? `<button class="btn" id="audit-all">${ic('refresh')}Vérifier l'optimisation</button>` : ''}
        <a class="btn" href="#/add">${ic('link')}Ajouter à distance</a>
        <button class="btn primary" id="scan" ${S.scanning ? 'disabled' : ''}>${S.scanning ? '<span class="spin"></span>Recherche en cours…' : `${ic('search')}Rechercher les TV`}</button>
      </div>
    </div>
    ${S.tsCodesWaiting > 0 ? `<div class="note attn tvw-banner">${ic('alert')}<div class="tvw-banner-in"><div><b>${esc(T.tvwBanner(S.tsCodesWaiting))}</b><p class="sm t2">${T.tvwBannerDesc}</p></div><a class="btn primary" href="#/tailscale-codes">${T.tvwOpen}</a></div></div>` : ''}
    ${info && info.tailscale && info.tailscale.enabled && !info.tailscale.ok ? `<div class="note attn">${ic('info')}<div>${esc(info.tailscale.message)}</div></div>` : ''}
    ${rows.length ? `<div class="panel"><ul class="list">${rows.join('')}</ul></div>` : emptyPanel()}
    <div class="panel">
      <details class="disclose" style="border-top:0">
        <summary>${ic('chevron')}Ajouter une TV par son adresse IP</summary>
        <div class="body">
          <p class="sm">Si la recherche ne la trouve pas. L'adresse se lit dans les paramètres réseau de la TV.</p>
          <form id="manual" class="section" style="gap:14px">
            <div class="form-row">
              <label class="field">Adresse IP<input class="input lg mono" type="text" name="host" inputmode="decimal" placeholder="192.168.1.20" required></label>
              <label class="field narrow">Port<input class="input lg mono" type="number" name="port" value="5555" min="1" max="65535"></label>
            </div>
            <details class="disclose" style="border:1px solid var(--line);border-radius:6px">
              <summary>${ic('chevron')}Débogage sans fil (Android 11 et plus)</summary>
              <div class="body">
                <p class="sm">Sur la TV : Options pour les développeurs › Débogage sans fil › Associer avec un code. Mets le <b>port de connexion</b> plus haut, et ici le port et le code d'association.</p>
                <div class="form-row">
                  <label class="field">Port d'association<input class="input lg mono" type="number" name="pairPort" min="1" max="65535" placeholder="37123"></label>
                  <label class="field">Code à 6 chiffres<input class="input lg mono" type="text" name="pairCode" inputmode="numeric" maxlength="6" placeholder="123456"></label>
                </div>
              </div>
            </details>
            <div><button class="btn primary" type="submit">${ic('plus')}Connecter</button></div>
          </form>
        </div>
      </details>
    </div>
    ${S.devices.length ? '' : compatPanel()}`;

  $('#scan').addEventListener('click', doScan);
  $('#audit-all')?.addEventListener('click', async (e) => {
    busy(e.currentTarget, true, 'Vérification…');
    let ok = 0;
    let ko = 0;
    for (const d of S.devices) {
      try { await api(`/api/devices/${encodeURIComponent(d.id)}/audit`); ok++; } catch { ko++; }
    }
    await loadState();
    toast(ko ? `${plural(ok, 'TV vérifiée')}, ${ko} injoignable${ko > 1 ? 's' : ''}.` : `${plural(ok, 'TV vérifiée')}.`);
    if (currentTab === 'devices' && !currentDevice) drawDevices();
  });
  $('#scan-empty')?.addEventListener('click', doScan);
  $('#manual').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const btn = ev.target.querySelector('[type=submit]');
    busy(btn, true, 'Connexion…');
    try {
      handleConnect(await api('/api/connect', { method: 'POST', body: { host: f.get('host'), port: f.get('port'), pairPort: f.get('pairPort'), pairCode: f.get('pairCode') } }));
    } catch (e) { toast(e.message, 'error'); } finally { busy(btn, false); }
  });
  $$('[data-retry]').forEach((b) => b.addEventListener('click', async () => {
    const [host, port] = b.dataset.retry.split(':');
    busy(b, true, 'Connexion…');
    try { handleConnect(await api('/api/connect', { method: 'POST', body: { host, port } })); } catch (e) { toast(e.message, 'error'); busy(b, false); }
  }));
}

// Vue d'un invité : uniquement les TV que l'administrateur lui a partagées
function drawSharedDevices() {
  $app.innerHTML = `
    <div class="page-head"><div class="lead"><h1>Mes TV</h1><p class="t2 sm">${S.devices.length ? plural(S.devices.length, 'TV') : 'Aucune TV pour le moment'}</p></div>
      <a class="btn primary" href="#/add">${ic('plus')}Ajouter ma TV</a></div>
    ${S.devices.length || S.pendingAgents.length ? `<div class="panel"><ul class="list">${[...S.pendingAgents.map(pendingAgentRow), ...S.devices.map(deviceRow)].join('')}</ul></div>` : `
      <div class="panel empty">
        <h2>Ajoute ta TV</h2>
        <p>Installe l'appli ATVM Connect sur ta TV : elle se relie à ce site, depuis chez toi, sans rien configurer sur ta box. Compte 5 minutes.</p>
        <div class="form-row" style="justify-content:center"><a class="btn primary" href="#/add">Ajouter ma TV</a></div>
      </div>
      ${compatPanel()}`}`;
}

async function handleConnect(r) {
  if (r.state === 'device') {
    S.pending = S.pending.filter((p) => p.host !== r.device.host);
    toast(`${displayName(r.device)} est connectée.`);
    await loadState();
  } else {
    S.pending = [{ host: r.host, port: r.port, state: r.state }, ...S.pending.filter((x) => x.host !== r.host)];
    toast(r.state === 'unauthorized' ? "Accepte la demande d'autorisation sur l'écran de la TV, puis réessaie." : 'La TV ne répond pas à cette adresse.', r.state === 'unauthorized' ? '' : 'error');
  }
  if (currentTab === 'devices' && !currentDevice) drawDevices();
}

async function doScan() {
  S.scanning = true;
  drawDevices();
  try {
    const r = await api('/api/scan', { method: 'POST' });
    S.scanInfo = r;
    // "absent" : port 5555 ouvert mais pas un appareil ADB, on ne l'affiche pas
    S.pending = r.found.filter((f) => f.state === 'unauthorized' || f.state === 'offline');
    const ok = r.found.filter((f) => f.state === 'device').length;
    await loadState();
    toast(ok ? `${plural(ok, 'TV trouvée')}.` : S.pending.length ? 'Une TV attend ton autorisation.' : 'Aucune TV trouvée. Vérifie que le débogage est activé.');
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    S.scanning = false;
    if (currentTab === 'devices' && !currentDevice) drawDevices();
  }
}

const viaAgent = (d) => d.transport === 'agent';
const agentState = (d) => (!d.agent || !d.agent.online ? ['', 'hors ligne'] : d.agent.adb === 'ok' ? ['ok', 'en ligne'] : d.agent.adb === 'waiting' ? ['note', 'fenêtre d’autorisation affichée'] : ['note', 'débogage à autoriser']);

// Résumé du contrôle d'optimisation : [classe du point, libellé]
function auditLabel(a) {
  if (!a) return ['', 'Optimisation non vérifiée'];
  if (a.level === 0) return a.partial ? ['note', 'Optimisation partielle'] : ['', 'Non optimisée'];
  if (a.next === null || a.next === undefined) return ['ok', `Optimisée N${a.level} · maximum`];
  return [a.partial ? 'note' : 'ok', `Optimisée N${a.level}${a.partial ? ' (partiel)' : ''}`];
}

// Dépannage possible depuis la liste ? Pour ATVM Connect l'état est connu ; en ADB, la page de dépannage vérifie elle-même
function remoteBlocked(d) {
  if (!viaAgent(d)) return '';
  if (!d.agent || !d.agent.online) return "TV hors ligne : allume-la et ouvre l'appli ATVM Connect.";
  if (d.agent.adb !== 'ok') return 'Le débogage doit être autorisé sur la TV.';
  return '';
}

// La ligne entière mène à la fiche (lien étiré sur le nom) ; le bouton Dépannage est un lien séparé, au-dessus
function deviceRow(d) {
  const fresh = viaAgent(d) ? d.agent && d.agent.online && d.agent.adb === 'ok' : Date.now() - (d.lastSeen || 0) < 6e5;
  const model = [d.brand, d.model].filter(Boolean).join(' ');
  const name = displayName(d);
  const blocked = remoteBlocked(d);
  return `
    <li class="device-row">
      <div class="ico">${ic('tv')}</div>
      <div style="min-width:0">
        <a class="name stretch" href="#/tv/${encodeURIComponent(d.id)}">${esc(name)}</a>
        <div class="meta">${d.label || d.deviceName ? `<span>${esc(model)}</span>` : ''}${d.android ? `<span>Android ${esc(d.android)}</span>` : ''}${viaAgent(d) ? '<span>via ATVM Connect</span>' : `<span class="mono">${esc(d.host)}</span>${d.remote ? '<span>via Tailscale</span>' : ''}`}${d.userNames && d.userNames.length ? `<span>${viaAgent(d) ? 'Ajoutée par' : 'Partagée avec'} ${esc(d.userNames.join(', '))}</span>` : ''}</div>
      </div>
      <div class="side">
        <span class="status"><span class="dot ${viaAgent(d) ? agentState(d)[0] : fresh ? 'ok' : ''}"></span>${esc(viaAgent(d) ? agentState(d)[1] : ago(d.lastSeen))}</span>
        ${d.remote && !d.tsTagged ? '<span class="tag">Sans étiquette Tailscale</span>' : ''}
        <span class="tag"><span class="dot ${auditLabel(d.audit)[0]}"></span>${esc(auditLabel(d.audit)[1])}</span>
      </div>
      ${blocked
        ? `<button type="button" class="btn sm remote-btn" aria-disabled="true" data-remote-off="${esc(blocked)}" title="${esc(blocked)}" aria-label="Dépannage de ${esc(name)} indisponible. ${esc(blocked)}">${ic('remote')}<span>Dépannage</span></button>`
        : `<a class="btn sm remote-btn" href="#/tv/${encodeURIComponent(d.id)}/remote" title="Dépannage à distance" aria-label="Dépannage à distance de ${esc(name)}">${ic('remote')}<span>Dépannage</span></a>`}
      <span class="chev">${ic('chevron')}</span>
    </li>`;
}

// Bouton Dépannage indisponible : on explique pourquoi (l'infobulle ne s'affiche pas sur téléphone)
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-remote-off]');
  if (b) toast(b.dataset.remoteOff, 'error');
});

function pendingRow(p) {
  const unauth = p.state === 'unauthorized';
  const addr = `${p.host}:${p.port || 5555}`;
  return `
    <li class="pending-row">
      <div class="ico">${ic('tv')}</div>
      <div style="min-width:0">
        <div class="name"><b>${unauth ? 'Autorisation requise' : 'Ne répond pas'}</b> · <span class="mono t2">${esc(addr)}</span></div>
        <p class="sm t2">${unauth
          ? 'Sur la TV, accepte « Autoriser le débogage ? » en cochant « Toujours autoriser », puis réessaie.'
          : 'Le débogage semble bloqué : désactive-le puis réactive-le sur la TV, puis réessaie.'}</p>
      </div>
      <button class="btn sm" data-retry="${esc(addr)}">${ic('refresh')}Réessayer</button>
    </li>`;
}

function pendingAgentRow(a) {
  const st = !a.online ? ['', 'TV hors ligne'] : a.adb === 'waiting' ? ['note', 'fenêtre d’autorisation affichée sur la TV'] : a.adb === 'unavailable' ? ['bad', 'débogage désactivé sur la TV'] : ['note', 'débogage à autoriser sur la TV'];
  return `
    <li class="pending-row">
      <div class="ico">${ic('tv')}</div>
      <div style="min-width:0">
        <div class="name"><b>${esc(a.name)}</b> · <span class="t2">en attente${a.userName && isAdmin() ? ` · associée par ${esc(a.userName)}` : ''}</span></div>
        <p class="sm t2"><span class="status"><span class="dot ${st[0]}"></span>${esc(st[1])}</span>${a.message ? ` — ${esc(a.message)}` : ''}</p>
      </div>
      <button class="btn sm quiet" data-revoke-agent="${esc(a.id)}">Retirer</button>
    </li>`;
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-revoke-agent]');
  if (!b) return;
  if (!(await confirmBox({ title: 'Retirer cette association ?', html: "<p>La TV devra être associée à nouveau avec un code depuis ATVM Connect.</p>", confirm: 'Retirer', danger: true }))) return;
  try {
    await api(`/api/agent/${encodeURIComponent(b.dataset.revokeAgent)}/revoke`, { method: 'POST' });
    await loadState();
    if (currentTab === 'devices' && !currentDevice) drawDevices();
    toast('Association retirée.');
  } catch (err) { toast(err.message, 'error'); }
});

function emptyPanel() {
  return `
    <div class="panel empty">
      <h2>Aucune TV pour l'instant</h2>
      <p>Active le débogage sur ta TV (environ 2 minutes, une seule fois), puis lance la recherche.</p>
      <div class="form-row" style="justify-content:center"><a class="btn primary" href="#/guide">Voir le guide de connexion</a><button class="btn" id="scan-empty">${ic('search')}Rechercher</button></div>
    </div>`;
}

function compatPanel() {
  return `
    <section class="section">
      <div class="section-head"><h2>Compatibilité</h2></div>
      <div class="panel compat">
        <div>
          <div class="status"><span class="dot ok"></span><b style="color:var(--text)">Compatible : Android TV et Google TV</b></div>
          <p class="sm t2">TV Sony, TCL, Philips (gammes Android), Xiaomi, Nokia… et les boîtiers et clés : Chromecast avec Google TV, Fire TV Stick, Xiaomi TV Stick et Mi Box, Nvidia Shield, boîtiers Android.</p>
          <p class="sm t3">Hisense, Toshiba et Philips vendent aussi des modèles sous d'autres systèmes : vérifie celui de ta TV dans ses paramètres.</p>
        </div>
        <div>
          <div class="status"><span class="dot bad"></span><b style="color:var(--text)">Non compatible</b></div>
          <table>
            <tr><td>Tizen</td><td>Samsung</td></tr>
            <tr><td>webOS</td><td>LG</td></tr>
            <tr><td>VIDAA</td><td>Hisense, certaines Toshiba</td></tr>
          </table>
          <p class="sm t3">Astuce : sur ces TV, branche une clé ou un boîtier Android TV et optimise-le avec ATV Manager.</p>
        </div>
      </div>
    </section>`;
}

// =====================================================================
// Une TV
// =====================================================================
async function viewDevice(rid, id) {
  const d = S.devices.find((x) => x.id === id);
  if (!d) throw new Error("Cette TV n'est plus enregistrée.");
  if (rid !== renderId) return;
  const yes = `<span class="yes">${ic('check')}</span>`;
  const no = `<span class="no">${ic('dash')}</span>`;
  const L = S.levels;

  $app.innerHTML = `
    ${crumbs([['Appareils', '#/'], [displayName(d)]])}
    <div class="page-head">
      <div class="lead">
        <h1>${esc(displayName(d))}</h1>
        <p class="t2 sm">${esc([d.brand, d.model].filter(Boolean).join(' '))}${d.android ? ` · Android ${esc(d.android)}` : ''} · ${viaAgent(d) ? 'via ATVM Connect' : `<span class="mono">${esc(d.host)}</span>${d.remote ? ' · via Tailscale' : ''}`}</p>
      </div>
      <div class="head-actions">
        <a class="btn primary" href="#/tv/${encodeURIComponent(id)}/remote">${ic('remote')}Dépannage à distance</a>
        ${isAdmin() ? '<button class="btn" id="rename">Renommer</button>' : ''}
      </div>
    </div>

    <div class="panel"><div class="specs" id="specs">
      <div class="spec"><span class="k">État</span><span class="status"><span class="spin" style="width:12px;height:12px"></span>Connexion…</span></div>
      <div class="spec"><span class="k">Mémoire libre</span><span class="v t3">—</span></div>
      <div class="spec"><span class="k">Stockage libre</span><span class="v t3">—</span></div>
      <div class="spec"><span class="k">Allumée depuis</span><span class="v t3">—</span></div>
    </div></div>
    <div id="conn-error"></div>
    <a class="panel remote-cta" href="#/tv/${encodeURIComponent(id)}/remote">
      <span class="ico">${ic('remote')}</span>
      <span style="min-width:0"><b>Dépannage à distance</b><span class="sm t2">Voir l'écran de la TV en direct et la piloter avec une télécommande. La TV affiche « Accès à distance : dépannage en cours » pendant la session.</span></span>
      <span class="btn sm primary">Ouvrir</span>
    </a>
    <section class="section" id="audit"></section>
    <section class="section" id="apps-install"></section>
    ${isAdmin() && d.remote && !viaAgent(d) && !d.tsTagged ? `<div class="note attn" id="ts-isolate-box">${ic('alert')}<div class="stack"><span><b>TV Tailscale sans étiquette :</b> elle peut voir tout ton réseau Tailscale, et sa clé expirera dans quelques mois.</span><div><button class="btn sm" id="ts-isolate">Isoler cette TV (${esc(S.settings.tailscale.tag || 'tag:tvbox')}, clé sans expiration)</button></div></div></div>` : ''}

    <section class="section">
      <div class="section-head"><h2>Optimisation</h2><p>Chaque niveau inclut le précédent. Tout est réversible depuis l'historique.</p></div>
      <div class="panel compare-wrap">
        <table class="compare">
          <thead><tr><th></th>${[1, 2, 3].map((n) => `<th><div class="lvl"><b>N${n}</b><span>${esc(L[n]?.title || '')}</span></div></th>`).join('')}</tr></thead>
          <tbody>
            <tr><td>Animations accélérées<small>0,5x au lieu de 1x</small></td><td>${yes}</td><td>${yes}</td><td>${yes}</td></tr>
            <tr><td>Applis recompilées<small>démarrage plus rapide</small></td><td>${yes}</td><td>${yes}</td><td>${yes}</td></tr>
            <tr><td>Recherche Wi-Fi et Bluetooth en arrière-plan coupée</td><td>${yes}</td><td>${yes}</td><td>${yes}</td></tr>
            <tr><td>DNS anti-pub<small>en option</small></td><td>${yes}</td><td>${yes}</td><td>${yes}</td></tr>
            <tr><td>Télémétrie coupée</td><td>${yes}</td><td>${yes}</td><td>${yes}</td></tr>
            <tr><td>Applis inutiles désactivées<small>le seul gain de mémoire durable</small></td><td>${no}</td><td>${yes}</td><td>${yes}</td></tr>
            <tr><td>Nouveau lanceur<small>écran d'accueil sans publicité</small></td><td>${no}</td><td>${no}</td><td>${yes}</td></tr>
            <tr><td>Ce que tu perds</td><td class="sm t2">Rien de visible</td><td class="sm t2">Selon les applis</td><td class="sm t2">L'accueil d'origine</td></tr>
          </tbody>
          <tfoot><tr><td></td>${[1, 2, 3].map((n) => `<td><a class="btn sm ${n === 1 ? 'primary' : ''}" data-level href="#/tv/${encodeURIComponent(id)}/level/${n}">Configurer</a></td>`).join('')}</tr></tfoot>
        </table>
      </div>
      <div class="panel level-list">
        ${[
          [1, 'Animations, applis recompilées, recherches en arrière-plan coupées, télémétrie. DNS anti-pub en option.', 'Rien de visible.'],
          [2, 'Niveau 1 + applis inutiles désactivées.', 'Selon les applis choisies.'],
          [3, 'Niveau 2 + nouveau lanceur sans publicité.', "L'accueil d'origine."],
        ].map(([n, does, loses]) => `
          <a class="level-item" data-level href="#/tv/${encodeURIComponent(id)}/level/${n}">
            <span class="lvl-badge">N${n}</span>
            <span style="min-width:0"><b>${esc(L[n]?.title || '')}</b><span class="sm t2" style="display:block">${does}</span><span class="sm t3" style="display:block">Tu perds : ${loses}</span></span>
            <span class="t3">${ic('chevron')}</span>
          </a>`).join('')}
      </div>
    </section>

    <section class="section" id="plume" hidden></section>

    <section class="section" id="home-reset">
      <div class="panel">
        <div class="setting">
          <div><div class="lbl">${ic('home')}${esc(T.homeTitle)}</div><p class="desc">${esc(T.homeDesc)}</p></div>
          <button class="btn sm" id="reset-launcher">${ic('undo')}${esc(T.homeBtn)}</button>
          <div class="more" id="home-result" hidden></div>
        </div>
      </div>
    </section>

    <section class="section" id="reboot">
      <div class="panel">
        <div class="setting">
          <div><div class="lbl">${ic('refresh')}Redémarrage chaque semaine</div><p class="desc">Beaucoup de TV ne redémarrent jamais vraiment (veille rapide) : la mémoire se remplit au fil des jours et tout ralentit. ATV Manager la redémarre la nuit, jamais pendant que l'écran est allumé.${d.autoReboot && d.autoReboot.last ? ` Dernier redémarrage automatique : ${esc(fmtDate(d.autoReboot.last))}.` : ''}</p></div>
          <label class="switch"><input type="checkbox" id="rb-on" ${d.autoReboot && d.autoReboot.enabled ? 'checked' : ''} aria-label="Redémarrage chaque semaine"><span></span></label>
          <div class="more rb-when">
            <label class="sm">Le <select class="input" id="rb-day">${['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'].map((n, i) => `<option value="${i}" ${(d.autoReboot ? d.autoReboot.day : 1) === i ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
            <label class="sm">à <select class="input" id="rb-hour">${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${(d.autoReboot ? d.autoReboot.hour : 4) === h ? 'selected' : ''}>${h} h</option>`).join('')}</select></label>
            <button class="btn sm quiet" id="rb-now">${ic('refresh')}Redémarrer maintenant</button>
          </div>
        </div>
      </div>
    </section>

    <section class="section" id="accessories"></section>

    <section class="section" id="history"></section>

    ${isAdmin() ? '<section class="section" id="share"></section>' : ''}
    ${isAdmin() || viaAgent(d) ? `
    <div class="panel">
      <div class="setting">
        <div><div class="lbl">${viaAgent(d) ? 'Retirer cette TV' : 'Oublier cette TV'}</div><p class="desc">${viaAgent(d) ? "ATVM Connect est dissocié : pour la rajouter, il faudra un nouveau code. Les réglages de la TV ne changent pas." : 'Elle disparaît de la liste. Ses réglages ne changent pas et son historique est conservé.'}</p></div>
        <button class="btn danger sm" id="forget">${viaAgent(d) ? 'Retirer' : 'Oublier'}</button>
      </div>
    </div>` : ''}`;

  if (isAdmin()) adminDeviceControls(rid, d);
  $('#ts-isolate')?.addEventListener('click', async (e) => {
    if (!S.settings.tailscale.hasApiKey) { toast('Ajoute d’abord une clé API Tailscale dans Réglages.', 'error'); return; }
    busy(e.currentTarget, true, 'Isolation…');
    try {
      const r = await api(`/api/devices/${encodeURIComponent(d.id)}/ts-isolate`, { method: 'POST' });
      toast(`${r.name} : étiquette ${r.tag} posée, clé sans expiration.`);
      $('#ts-isolate-box')?.remove();
      await loadState();
    } catch (err) { toast(err.message, 'error'); busy(e.currentTarget, false); }
  });
  bindForget(d);
  bindResetLauncher(d);
  drawPlume(rid, d);
  bindReboot(d);
  drawHistory(rid, id);
  loadDeviceStats(rid, id);
}

function adminDeviceControls(rid, d) {
  const id = d.id;
  drawShare(rid, d);
  $('#rename').addEventListener('click', async () => {
    const label = await promptBox({ title: 'Renommer la TV', label: 'Nom affiché, par exemple « Salon »', value: d.label, placeholder: displayName(d) });
    if (label === null) return;
    try {
      await api(`/api/devices/${encodeURIComponent(id)}/rename`, { method: 'POST', body: { label } });
      await loadState();
      render();
    } catch (e) { toast(e.message, 'error'); }
  });
}

// Remettre le lanceur d'origine, à tout moment, sans passer par l'historique
function bindResetLauncher(d) {
  const btn = $('#reset-launcher');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    if (!(await confirmBox({ title: T.homeConfirmTitle, html: `<p>${esc(T.homeConfirm)}</p>`, confirm: T.homeConfirmBtn }))) return;
    const out = $('#home-result');
    const rid = renderId;
    busy(btn, true, T.homeBusy);
    out.hidden = true;
    let r;
    try {
      r = await api(`/api/devices/${encodeURIComponent(d.id)}/reset-launcher`, { method: 'POST' });
    } catch (e) {
      if (rid !== renderId) return;
      busy(btn, false);
      if (e.status === 404 && !(e.data && e.data.error && !/route/i.test(e.data.error))) { // route absente : ancien serveur
        out.innerHTML = `<div class="note attn">${ic('info')}<div>${esc(T.homeOld)}</div></div>`;
      } else {
        r = e.data && Array.isArray(e.data.log) ? { ok: false, ...e.data } : null;
        if (!r) out.innerHTML = `<div class="note warn">${ic('alert')}<div>${esc(e.message)}</div></div>`;
      }
      if (!r) { out.hidden = false; return; }
    }
    if (rid !== renderId) return;
    busy(btn, false);
    const log = Array.isArray(r.log) ? r.log : [];
    const ok = r.ok !== false && !log.some((l) => !l.ok);
    const name = homeName(r.home);
    out.innerHTML = `
      <div class="note ${ok ? '' : 'warn'}">${ic(ok ? 'check' : 'alert')}<div class="stack">
        <b>${esc(ok ? T.homeOk : T.homeKo)}</b>
        <span>${esc(T.homeNow)} <b class="${name && name === String(r.home).split('/')[0] ? 'mono' : ''}">${esc(name || T.homeUnknown)}</b>${name && name !== r.home ? ` <span class="mono sm t3 home-comp">${esc(r.home)}</span>` : ''}</span>
      </div></div>
      ${log.length ? `<ul class="log">${log.map((l) => `<li class="${l.ok ? '' : 'ko'}">${ic(l.ok ? 'check' : 'x')}<span>${esc(l.text)}</span></li>`).join('')}</ul>` : ''}`;
    out.hidden = false;
    toast(ok ? T.homeOk : T.homeKo, ok ? '' : 'error');
    // Rafraîchir l'état (audit) et l'historique
    drawHistory(rid, d.id);
    drawAudit(rid, d.id);
  });
}

// Lanceur Plume : l'utiliser comme écran d'accueil, ou revenir à l'accueil d'origine
async function drawPlume(rid, d, result = null) {
  const box = $('#plume');
  if (!box) return;
  const url = `/api/devices/${encodeURIComponent(d.id)}/plume`;
  let p;
  try {
    p = await api(url);
  } catch (e) {
    if (rid !== renderId) return;
    if (e.status === 404) { box.hidden = true; return; } // serveur sans cette fonction
    p = { error: e.message };
  }
  if (rid !== renderId) return;
  const head = (extra = '') => `<div class="lbl">${ic('home')}${esc(T.plumeTitle)}${p.installed && p.version ? ` <span class="mono sm t3 num">${esc(p.version)}</span>` : ''}${extra}</div>`;
  const refresh = `<button class="btn sm quiet" id="plume-refresh">${ic('refresh')}${esc(T.plumeRefresh)}</button>`;
  let body;
  if (p.error) {
    body = `<div class="setting"><div>${head()}<p class="desc">${esc(T.plumeErr)} ${esc(p.error)}</p></div>${refresh}</div>`;
  } else if (!p.installed) {
    body = `<div class="setting"><div>${head()}<p class="desc">${esc(T.plumeMissing)}</p></div>${refresh}</div>`;
  } else if (p.active) {
    body = `<div class="setting"><div>${head()}<p class="plume-state"><span class="tag"><span class="dot ${p.granted === false ? 'note' : 'ok'}"></span>${esc(T.plumeActive)}</span></p>${p.granted === false ? '' : `<p class="desc">${esc(T.plumeActiveDesc)}</p>`}</div>
      <button class="btn sm" id="plume-off">${ic('undo')}${esc(T.plumeDisable)}</button>
      <div class="more" id="plume-result"></div>
      ${p.granted === false || (result && result.homeOk === false) ? `<div class="more">${result ? '' : `<div class="note attn">${ic('info')}<div>${esc(T.plumeNoGrant)}</div></div>`}<div><button class="btn sm" id="plume-on">${ic('refresh')}${esc(T.plumeRetry)}</button></div></div>` : ''}</div>`;
  } else {
    body = `<div class="setting"><div>${head()}<p class="desc">${esc(T.plumeDesc)}</p><p class="desc">${esc(T.plumeA11y)}</p></div>
      <button class="btn sm primary" id="plume-on">${ic('home')}${esc(T.plumeEnable)}</button>
      <div class="more" id="plume-result"></div></div>`;
  }
  box.innerHTML = `<div class="panel">${body}</div>`;
  box.hidden = false;
  if (result) showPlumeResult(result);
  $('#plume-refresh')?.addEventListener('click', () => drawPlume(rid, d));
  const run = async (btn, action, busyLabel) => {
    busy(btn, true, busyLabel);
    let r;
    try {
      r = await api(url, { method: 'POST', body: { action } });
    } catch (e) {
      if (rid !== renderId) return;
      if (e.status === 409) { toast(T.plumeGone, 'error'); drawPlume(rid, d); return; }
      r = { ok: false, error: e.message, ...(e.data || {}) };
    }
    if (rid !== renderId) return;
    r.action = action;
    const ok = r.ok !== false;
    toast(!ok ? (r.error || T.plumeKo) : action === 'disable' ? T.plumeOff : r.homeOk === true ? T.plumeOk : r.homeOk === false ? T.plumeTodo : T.plumeUnsure, ok && r.homeOk !== false ? '' : 'error');
    drawPlume(rid, d, r);
    drawHistory(rid, d.id);
  };
  $('#plume-on')?.addEventListener('click', (e) => run(e.currentTarget, 'enable', T.plumeEnableBusy));
  $('#plume-off')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (!(await confirmBox({ title: T.plumeDisableTitle, html: `<p>${esc(T.plumeDisableConfirm)}</p>`, confirm: T.plumeDisableBtn }))) return;
    run(btn, 'disable', T.plumeDisableBusy);
  });
}

// Journal Plume : lignes texte ou { ok, text }
const plumeLines = (list) => (Array.isArray(list) ? list : []).map((l) => (typeof l === 'string' ? { ok: true, text: l } : { ok: !!l && l.ok !== false, text: l && l.text != null ? l.text : String(l) }));
const logList = (lines) => `<ul class="log">${lines.map((l) => `<li class="${l.ok ? '' : 'ko'}">${ic(l.ok ? 'check' : 'x')}<span>${esc(l.text)}</span></li>`).join('')}</ul>`;

// Entrée d'historique « Plume » (à part, comme le retour au lanceur d'origine)
function plumeHistItem(h, i) {
  const lines = plumeLines(Array.isArray(h.steps) && h.steps.length ? h.steps : h.log);
  const on = h.action === 'enable';
  const homeOk = h.plume ? h.plume.homeOk : null;
  const bad = lines.some((l) => !l.ok);
  const [dot, state] = bad ? ['bad', T.plumeHistKo] : on && homeOk === false ? ['note', T.plumeHistTodo] : ['ok', T.plumeHistOk];
  return `
        <details class="disclose" ${i === 0 ? 'style="border-top:0"' : ''}>
          <summary>${ic('chevron')}<span style="flex:1;display:flex;gap:10px;flex-wrap:wrap;align-items:center;color:var(--text)"><b>${esc(on ? T.plumeHistOn : T.plumeHistOff)}</b><span class="t2">${esc(fmtDate(h.at))}</span></span><span class="status"><span class="dot ${dot}"></span>${esc(state)}</span></summary>
          <div class="body">${lines.length ? logList(lines) : `<p class="sm t3">${esc(T.plumeHistEmpty)}</p>`}</div>
        </details>`;
}

// Résultat de la dernière action Plume, sous la carte (journal repliable)
function showPlumeResult(r) {
  const out = $('#plume-result');
  if (!out) return;
  const log = plumeLines(Array.isArray(r.steps) && r.steps.length ? r.steps : r.log);
  const ok = r.ok !== false;
  let kind; let msg;
  if (!ok) { kind = 'warn'; msg = r.error || T.plumeKo; }
  else if (r.action === 'disable') { kind = ''; msg = T.plumeOff; }
  else if (r.homeOk === true) { kind = ''; msg = T.plumeOk; }
  else if (r.homeOk === false) { kind = 'attn'; msg = T.plumeTodo; }
  else { kind = 'attn'; msg = T.plumeUnsure; }
  out.innerHTML = `
    <div class="note ${kind}">${ic(kind ? (kind === 'warn' ? 'alert' : 'info') : 'check')}<div><b>${esc(msg)}</b></div></div>
    ${log.length ? `<details class="disclose plume-log"><summary>${ic('chevron')}${esc(T.plumeLog)}</summary><div class="body">${logList(log)}</div></details>` : ''}`;
}

// Redémarrage hebdomadaire (enregistré à chaque changement) et redémarrage immédiat
function bindReboot(d) {
  const save = async () => {
    try {
      const r = await api(`/api/devices/${encodeURIComponent(d.id)}/auto-reboot`, { method: 'POST', body: { enabled: $('#rb-on').checked, day: Number($('#rb-day').value), hour: Number($('#rb-hour').value) } });
      d.autoReboot = r.autoReboot;
      toast(r.autoReboot.enabled ? 'Redémarrage chaque semaine activé.' : 'Redémarrage chaque semaine désactivé.');
    } catch (e) { toast(e.message, 'error'); }
  };
  ['#rb-on', '#rb-day', '#rb-hour'].forEach((s) => $(s)?.addEventListener('change', save));
  $('#rb-now')?.addEventListener('click', async (e) => {
    if (!(await confirmBox({ title: 'Redémarrer la TV maintenant ?', html: '<p>L’écran s’éteint une à deux minutes. Si quelqu’un regarde la TV, préviens-le avant.</p>', confirm: 'Redémarrer' }))) return;
    busy(e.currentTarget, true, 'Redémarrage…');
    try { toast((await api(`/api/devices/${encodeURIComponent(d.id)}/reboot`, { method: 'POST' })).message); } catch (err) { toast(err.message, 'error'); }
    busy(e.currentTarget, false);
  });
}

function bindForget(d) {
  $('#forget')?.addEventListener('click', async () => {
    const agent = viaAgent(d);
    if (!(await confirmBox({ title: agent ? 'Retirer cette TV ?' : 'Oublier cette TV ?', html: agent ? "<p>L'appli ATVM Connect de la TV sera dissociée.</p>" : '<p>Elle réapparaîtra au prochain scan si le débogage est toujours actif.</p>', confirm: agent ? 'Retirer' : 'Oublier', danger: true }))) return;
    try {
      await api(`/api/devices/${encodeURIComponent(d.id)}/forget`, { method: 'POST' });
      await loadState();
      location.hash = '#/';
    } catch (e) { toast(e.message, 'error'); }
  });
}

// Partage de la TV avec les comptes invités
async function drawShare(rid, d) {
  let users = [];
  try { users = (await api('/api/admin/users')).users.filter((u) => u.role !== 'admin'); } catch { return; }
  if (rid !== renderId) return;
  const box = $('#share');
  if (!box) return;
  const shared = new Set(d.users || []);
  box.innerHTML = `
    <div class="section-head"><h2>Partage</h2><p>Les proches cochés voient cette TV et peuvent l'optimiser.</p></div>
    <div class="panel">
      ${users.length ? `
        <div class="share-list">${users.map((u) => `
          <label class="check share-item"><input type="checkbox" value="${esc(u.id)}" ${shared.has(u.id) ? 'checked' : ''}><span><b>${esc(u.name)}</b> <span class="t3 mono">${esc(u.username)}</span></span></label>`).join('')}
        </div>
        <div class="share-foot"><button class="btn sm primary" id="share-save">Enregistrer le partage</button></div>`
      : `<p class="panel-pad sm t2">Aucun proche n'a encore de compte. Crée une invitation dans <a href="#/settings">Réglages</a>.</p>`}
    </div>`;
  $('#share-save', box)?.addEventListener('click', async (e) => {
    const ids = $$('input[type=checkbox]:checked', box).map((c) => c.value);
    busy(e.currentTarget, true, 'Enregistrement…');
    try {
      const r = await api(`/api/devices/${encodeURIComponent(d.id)}/share`, { method: 'POST', body: { users: ids } });
      d.users = r.device.users;
      toast(ids.length ? `TV partagée avec ${plural(ids.length, 'personne')}.` : 'Partage retiré.');
    } catch (err) { toast(err.message, 'error'); }
    busy(e.currentTarget, false);
  });
}

async function loadDeviceStats(rid, id) {
  try {
    const { stats: s } = await api(`/api/devices/${encodeURIComponent(id)}`);
    if (rid !== renderId) return;
    const pct = (free, total) => (total ? Math.max(0, Math.min(100, 100 - Math.round((free / total) * 100))) : 0);
    $('#specs').innerHTML = `
      <div class="spec"><span class="k">État</span><span class="status" style="font-size:15px;color:var(--text)"><span class="dot ok"></span>Connectée</span></div>
      <div class="spec"><span class="k">Mémoire libre</span><span class="v">${fmtMb(s.ramFreeMb)} <small>/ ${fmtMb(s.ramTotalMb)}</small></span><div class="bar"><i style="width:${pct(s.ramFreeMb, s.ramTotalMb)}%"></i></div></div>
      <div class="spec"><span class="k">Stockage libre</span><span class="v">${fmtMb(s.diskFreeMb)} <small>/ ${fmtMb(s.diskTotalMb)}</small></span><div class="bar"><i style="width:${pct(s.diskFreeMb, s.diskTotalMb)}%"></i></div></div>
      <div class="spec"><span class="k">Allumée depuis</span><span class="v">${String(s.uptimeH).replace('.', ',')} <small>h</small></span></div>`;
    drawAudit(rid, id);
    drawInstall(rid, id);
    drawAccessories(rid, id);
  } catch (e) {
    if (rid !== renderId) return;
    $('#specs').querySelector('.spec').innerHTML = `<span class="k">État</span><span class="status" style="font-size:15px;color:var(--text)"><span class="dot bad"></span>Injoignable</span>`;
    $('#conn-error').innerHTML = `<div class="note warn">${ic('alert')}<div class="stack"><span>${esc(e.message)}</span><div class="form-row"><button class="btn sm" id="retry">${ic('refresh')}Réessayer</button><a class="btn sm quiet" href="#/guide">Aide à la connexion</a></div></div></div>`;
    $('#retry').addEventListener('click', render);
    $$('[data-level]').forEach((b) => b.setAttribute('aria-disabled', 'true'));
  }
}

// Contrôle de l'optimisation réelle de la TV, avec la prochaine amélioration possible
async function drawAudit(rid, id) {
  const box = $('#audit');
  if (!box) return;
  box.innerHTML = `<div class="section-head"><h2>État de l'optimisation</h2></div><div class="panel panel-pad"><span class="status"><span class="spin" style="width:12px;height:12px"></span>Vérification de la TV…</span></div>`;
  let a;
  try { a = await api(`/api/devices/${encodeURIComponent(id)}/audit`); } catch (e) { if (rid === renderId) box.innerHTML = ''; return; }
  if (rid !== renderId) return;
  const c = a.checks;
  const [dot, label] = auditLabel({ level: a.level, partial: a.partial, next: a.next ? a.next.level : null });
  const row = (ok, title, detail) => `<li class="${ok ? '' : 'ko'}">${ic(ok ? 'check' : 'x')}<span><b>${title}</b>${detail ? ` <span class="t2">${detail}</span>` : ''}</span></li>`;
  const left = (x) => (x.left.length ? ` — encore actives : ${esc(x.left.slice(0, 4).join(', '))}${x.left.length > 4 ? ` et ${x.left.length - 4} autre${x.left.length - 4 > 1 ? 's' : ''}` : ''}` : '');
  box.innerHTML = `
    <div class="section-head"><h2>État de l'optimisation</h2><p>Vérifié le ${esc(fmtDate(a.at))}</p></div>
    <div class="panel">
      <div class="setting">
        <div><div class="lbl"><span class="status" style="font-size:15px;color:var(--text)"><span class="dot ${dot}"></span>${esc(label)}</span></div>
        <p class="desc">Lu directement sur la TV, même si elle a été optimisée autrement qu'avec ATV Manager.</p></div>
      </div>
      <div class="panel-pad" style="border-top:1px solid var(--line)">
        <ul class="log">
          ${c.animations.skipped ? `<li>${ic('info')}<span><b>Animations conservées</b> <span class="t2">Fire TV : les modifier rendrait ses paramètres inaccessibles</span></span></li>` : row(c.animations.ok, 'Animations accélérées', c.animations.ok ? '' : `(actuellement ${esc(c.animations.values[0])}x)`)}
          ${c.telemetry.total ? row(c.telemetry.done === c.telemetry.total, 'Télémétrie coupée', `${c.telemetry.done}/${c.telemetry.total}${left(c.telemetry)}`) : ''}
          ${c.safe.total ? row(c.safe.done === c.safe.total, 'Applis inutiles sans risque désactivées', `${c.safe.done}/${c.safe.total}${left(c.safe)}`) : ''}
          ${c.optional.total ? `<li>${ic('info')}<span><b>Applis « à savoir »</b> <span class="t2">${c.optional.done}/${c.optional.total} désactivées, à ton choix selon tes usages</span></span></li>` : ''}
          ${row(c.launcher.alternative, 'Lanceur', c.launcher.alternative ? `: ${esc(c.launcher.name)}` : ": écran d'accueil d'origine")}
        </ul>
      </div>
    </div>
    ${a.next
      ? `<div class="note attn">${ic('info')}<div class="stack"><span><b>Une meilleure optimisation est disponible.</b> ${esc(a.next.text)}</span><div><a class="btn sm primary" href="#/tv/${encodeURIComponent(id)}/level/${a.next.level}">Passer au niveau ${a.next.level}</a></div></div></div>`
      : `<div class="note">${ic('check')}<div><b>Optimisation maximale.</b> Rien de plus à faire sur cette TV${c.optional.total > c.optional.done ? ` (il reste ${c.optional.total - c.optional.done} appli${c.optional.total - c.optional.done > 1 ? 's' : ''} « à savoir », à désactiver seulement si tu ne t'en sers pas)` : ''}.</div></div>`}`;
  // Repère du niveau actuel dans le tableau comparatif
  $$('.compare thead th').forEach((th, i) => { if (i === a.level && a.level > 0) th.querySelector('.lvl span').textContent += ' · actuel'; });
}

// Applis proposées par l'administrateur : installation APK ou fiche du store ouverte sur la TV
async function drawInstall(rid, id) {
  const box = $('#apps-install');
  if (!box) return;
  let apps;
  try { apps = (await api(`/api/devices/${encodeURIComponent(id)}/apps`)).apps; } catch { return; }
  if (rid !== renderId) return;
  if (!apps.length) {
    box.innerHTML = isAdmin() ? `<div class="section-head"><h2>Applis à installer</h2></div><p class="panel panel-pad sm t2">Aucune appli proposée pour l'instant. Ajoute-en dans <a href="#/settings">Réglages › Applis proposées</a>.</p>` : '';
    return;
  }
  box.innerHTML = `
    <div class="section-head"><h2>Applis à installer</h2><p>Proposées par l'administrateur.</p></div>
    <div class="panel">${apps.map((a) => `
      <div class="invite-row">
        <div style="min-width:0"><b>${esc(a.name)}</b> ${a.installed === true ? '<span class="tag"><span class="dot ok"></span>Installée</span>' : a.installed === false ? '<span class="tag">Non installée</span>' : ''}
          ${a.desc ? `<div class="sm t2">${esc(a.desc)}</div>` : ''}
          ${a.downloaderCode ? `<div class="sm t3">Ou dans Downloader, code <span class="mono">${esc(a.downloaderCode)}</span></div>` : ''}</div>
        <button class="btn sm ${a.installed ? 'quiet' : 'primary'}" data-app-install="${esc(a.id)}">${a.apkUrl ? (a.installed ? 'Réinstaller' : 'Installer') : 'Ouvrir sur le store de la TV'}</button>
      </div>`).join('')}
    </div>`;
  $$('[data-app-install]', box).forEach((b) => b.addEventListener('click', async () => {
    busy(b, true, 'En cours…');
    try {
      const r = await api(`/api/devices/${encodeURIComponent(id)}/apps/${encodeURIComponent(b.dataset.appInstall)}/install`, { method: 'POST' });
      toast(r.message);
      drawInstall(renderId, id);
    } catch (e) { toast(e.message, 'error'); busy(b, false); }
  }));
}

// ---------- Accessoires : ce qui est branché ou appairé sur la TV (lecture seule)
const ACC_KIND = {
  remote: ['rc', 'Télécommande'],
  gamepad: ['gamepad', 'Manette'],
  keyboard: ['keyboard', 'Clavier'],
  mouse: ['mouse', 'Souris'],
  audio: ['headphones', 'Casque ou enceinte'],
  input: ['rc', "Périphérique d'entrée"],
  phone: ['bluetooth', 'Téléphone'],
  computer: ['bluetooth', 'Ordinateur'],
  storage: ['drive', 'Stockage USB'],
  camera: ['usb', 'Caméra'],
  network: ['ethernet', 'Adaptateur réseau'],
  usb: ['usb', 'Périphérique USB'],
};
const ACC_VIA = { bluetooth: 'Bluetooth', usb: 'USB', ir: 'Infrarouge' };
const CEC_KIND = { player: 'Lecteur ou box', audio: 'Barre de son ou ampli', recorder: 'Enregistreur', tuner: 'Décodeur', switch: 'Commutateur HDMI', processor: 'Processeur vidéo', other: 'Appareil HDMI' };
const AUDIO_OUT = { speaker: 'Haut-parleurs de la TV', hdmi: 'HDMI', hdmi_arc: 'HDMI ARC', hdmi_earc: 'HDMI eARC', bluetooth: 'Bluetooth', spdif: 'Sortie optique', usb: 'USB', headphone: 'Casque filaire', line: 'Sortie ligne' };
const VOL_STATE = { MOUNTED: ['ok', 'Prête'], CHECKING: ['note', 'Vérification…'], UNMOUNTED: ['', 'Non montée'], UNMOUNTABLE: ['bad', 'Illisible'], EJECTING: ['note', 'Retrait…'], FORMATTING: ['note', 'Formatage…'], REMOVED: ['', 'Retirée'], BAD_REMOVAL: ['bad', 'Retirée sans éjection'] };
const WIFI_SIGNAL = { excellent: ['ok', 'Signal excellent'], good: ['ok', 'Bon signal'], fair: ['note', 'Signal moyen'], weak: ['bad', 'Signal faible'] };

const accTag = (dot, label) => `<span class="tag">${dot !== null ? `<span class="dot ${dot}"></span>` : ''}${esc(label)}</span>`;
const accBattery = (b) => (b === null || b === undefined ? '' : `<span class="tag${b <= 20 ? ' low' : ''}" title="Batterie">${ic('battery')}${b} %</span>`);
const accItem = (icon, name, detail, tags = '') => `
  <li class="acc-item">
    <span class="ico">${ic(icon)}</span>
    <span class="main"><b>${esc(name)}</b>${detail ? `<span class="sm t2">${esc(detail)}</span>` : ''}</span>
    ${tags ? `<span class="tags">${tags}</span>` : ''}
  </li>`;
const accGroup = (icon, title, items, extra = '') => `
  <div class="acc-group">${ic(icon)}<span>${esc(title)}</span>${extra ? `<span class="t3">· ${esc(extra)}</span>` : ''}</div>
  <ul class="acc-list">${items.join('')}</ul>`;
const accNone = (text) => `<li class="acc-none">${esc(text)}</li>`;

function accessoriesHtml(a) {
  const groups = [];
  if (a.bluetooth) {
    const bt = a.bluetooth;
    const items = bt.devices.map((d) => {
      const [icon, kind] = ACC_KIND[d.kind] || ['bluetooth', 'Appareil Bluetooth'];
      return accItem(icon, d.name, `${kind}${d.tech === 'LE' ? ' · Bluetooth basse consommation' : ''}`,
        accTag(d.connected ? 'ok' : '', d.connected ? 'Connecté' : 'Appairé, déconnecté') + accBattery(d.battery));
    });
    if (!items.length) items.push(accNone(bt.enabled ? 'Aucun appareil appairé.' : 'Bluetooth désactivé : aucun appareil ne peut se connecter.'));
    groups.push(accGroup('bluetooth', 'Bluetooth', items, bt.enabled ? '' : 'désactivé'));
  }
  if (a.inputs && a.inputs.length) {
    groups.push(accGroup('rc', 'Télécommandes et périphériques', a.inputs.map((i) => {
      const [icon, kind] = ACC_KIND[i.kind] || ACC_KIND.input;
      const detail = i.via === 'ir' ? i.detail : [kind !== i.name ? kind : '', ACC_VIA[i.via], i.detail].filter(Boolean).join(' · ');
      return accItem(icon, i.name, detail, accBattery(i.battery));
    })));
  }
  if (a.usb) {
    const items = [
      ...a.usb.volumes.map((v) => {
        const [dot, st] = VOL_STATE[v.state] || ['', v.state || 'État inconnu'];
        const space = v.totalMb ? `${fmtMb(v.freeMb)} libres sur ${fmtMb(v.totalMb)}` : '';
        return accItem('drive', v.name, [v.sd ? 'Carte SD' : 'Clé ou disque USB', v.fs, space].filter(Boolean).join(' · '), accTag(dot, st));
      }),
      ...a.usb.devices.map((d) => {
        const [icon, kind] = ACC_KIND[d.kind] || ACC_KIND.usb;
        return accItem(icon, d.name, kind !== d.name ? kind : '', accTag('ok', 'Branché'));
      }),
    ];
    if (!items.length) items.push(accNone('Aucune clé, aucun disque ni périphérique USB branché.'));
    groups.push(accGroup('usb', 'USB', items));
  }
  if (a.audio || a.hdmi) {
    const items = [];
    const h = a.hdmi;
    if (a.audio && a.audio.active.length) {
      const others = a.audio.outputs.filter((o) => !a.audio.active.includes(o)).map((o) => AUDIO_OUT[o] || o);
      const tags = (h && h.arc ? accTag('ok', 'ARC actif') : '') + (h && h.systemAudio ? accTag('ok', "Volume géré par l'ampli") : '');
      items.push(accItem('volume', a.audio.active.map((o) => AUDIO_OUT[o] || o).join(' + '), `Sortie audio actuelle${others.length ? ` · aussi disponible : ${others.join(', ')}` : ''}`, tags));
    }
    if (h) {
      for (const d of h.devices) {
        items.push(accItem(d.kind === 'audio' ? 'volume' : 'hdmi', d.name, [CEC_KIND[d.kind] || CEC_KIND.other, d.port ? `HDMI ${d.port}` : ''].filter(Boolean).join(' · '),
          d.on === null ? '' : accTag(d.on ? 'ok' : '', d.on ? 'Allumé' : 'En veille')));
      }
      if (!h.devices.length) items.push(accNone(h.cec === false ? `Aucun appareil HDMI-CEC détecté (barre de son, box, console…)${h.arcPort ? `. L'ARC se branche sur l'entrée HDMI ${h.arcPort}.` : '.'}` : 'Aucun appareil HDMI-CEC détecté.'));
    }
    if (items.length) groups.push(accGroup('hdmi', 'Son et HDMI', items));
  }
  if (a.network) {
    const n = a.network;
    if (n.type === 'wifi') {
      const sig = WIFI_SIGNAL[n.signal];
      groups.push(accGroup('wifi', 'Réseau', [accItem('wifi', n.ssid || 'Wi-Fi', ['Wi-Fi', n.band, n.linkMbps ? `${n.linkMbps} Mb/s` : ''].filter(Boolean).join(' · '), sig ? accTag(sig[0], sig[1]) : '')]));
    } else if (n.type === 'ethernet') {
      groups.push(accGroup('ethernet', 'Réseau', [accItem('ethernet', 'Câble Ethernet', 'Connexion filaire', accTag('ok', 'Connecté'))]));
    }
  }
  if (!groups.length) return `<div class="panel panel-pad sm t2">Aucun accessoire détecté sur cette TV.</div>`;
  return `<div class="panel acc">${groups.join('')}</div>`;
}

async function drawAccessories(rid, id, btn) {
  const box = $('#accessories');
  if (!box) return;
  const head = (sub) => `<div class="section-head"><h2>Accessoires</h2><div class="acc-head">${sub ? `<span class="sm t3">${esc(sub)}</span>` : ''}<button class="btn sm" id="acc-refresh">${ic('refresh')}Actualiser</button></div></div>`;
  if (btn) busy(btn, true, 'Lecture…');
  else box.innerHTML = `${head('')}<div class="panel panel-pad"><span class="status"><span class="spin" style="width:12px;height:12px"></span>Lecture des accessoires…</span></div>`;
  let html;
  try {
    const a = await api(`/api/devices/${encodeURIComponent(id)}/accessories`);
    html = head(`Lu le ${fmtDate(a.at)}`) + accessoriesHtml(a);
  } catch (e) {
    html = `${head('')}<div class="note warn">${ic('alert')}<div>${esc(e.message)}</div></div>`;
  }
  if (rid !== renderId) return;
  box.innerHTML = html;
  $('#acc-refresh', box).addEventListener('click', (e) => drawAccessories(rid, id, e.currentTarget));
}

async function drawHistory(rid, id) {
  let hist = [];
  try { hist = (await api(`/api/devices/${encodeURIComponent(id)}/history`)).history; } catch { return; }
  if (rid !== renderId) return;
  const box = $('#history');
  if (!box) return;
  const active = hist.filter((h) => !h.restored && h.type !== 'reset-launcher' && h.type !== 'plume');
  box.innerHTML = `
    <div class="section-head"><h2>Historique</h2>${active.length ? `<button class="btn sm" id="restore-all">${ic('undo')}Tout restaurer</button>` : ''}</div>
    <div class="panel">
      ${hist.length ? hist.map((h, i) => (h.type === 'plume' ? plumeHistItem(h, i) : h.type === 'reset-launcher' ? `
        <details class="disclose" ${i === 0 ? 'style="border-top:0"' : ''}>
          <summary>${ic('chevron')}<span style="flex:1;display:flex;gap:10px;flex-wrap:wrap;align-items:center;color:var(--text)"><b>${esc(T.homeHist)}</b><span class="t2">${esc(fmtDate(h.at))}</span>${h.home && h.home.after ? `<span class="t2">${esc(T.homeNow)} ${esc(homeName(h.home.after))}</span>` : ''}</span><span class="status"><span class="dot ${h.log.some((l) => !l.ok) ? 'bad' : 'ok'}"></span>${h.log.some((l) => !l.ok) ? 'Incomplet' : 'Fait'}</span></summary>
          <div class="body"><ul class="log">${h.log.map((l) => `<li class="${l.ok ? '' : 'ko'}">${ic(l.ok ? 'check' : 'x')}<span>${esc(l.text)}</span></li>`).join('')}</ul></div>
        </details>` : `
        <details class="disclose" ${i === 0 ? 'style="border-top:0"' : ''}>
          <summary>${ic('chevron')}<span style="flex:1;display:flex;gap:10px;flex-wrap:wrap;align-items:center;color:var(--text)"><b>N${h.level}</b><span class="t2">${esc(fmtDate(h.at))}</span><span class="t2">${plural(h.apps.length, 'appli')}</span>${h.ramBefore != null && h.ramAfter != null ? `<span class="t3 num">${fmtMb(h.ramBefore)} → ${fmtMb(h.ramAfter)}</span>` : ''}</span><span class="status"><span class="dot ${h.restored ? '' : 'accent'}"></span>${h.restored ? 'Restauré' : 'Actif'}</span></summary>
          <div class="body">
            <ul class="log">${h.log.map((l) => `<li class="${l.ok ? '' : 'ko'}">${ic(l.ok ? 'check' : 'x')}<span>${esc(l.text)}</span></li>`).join('')}</ul>
            ${!h.restored && h.apps.length ? `<div class="section" style="gap:8px"><span class="sm t3">Réactiver une seule appli</span><div class="form-row">${h.apps.map((p) => `<button class="btn sm mono" data-reenable="${esc(h.id)}|${esc(p)}">${esc(p)}</button>`).join('')}</div></div>` : ''}
            ${!h.restored ? `<div><button class="btn sm" data-restore="${esc(h.id)}">${ic('undo')}Annuler cette optimisation</button></div>` : `<p class="sm t3">Restauré le ${esc(fmtDate(h.restoredAt))}.</p>`}
          </div>
        </details>`)).join('') : '<p class="panel-pad t2 sm">Aucune optimisation pour le moment.</p>'}
    </div>`;

  const doRestore = async (btn, body, title) => {
    if (!(await confirmBox({ title, html: "<p>Les applis désactivées sont réactivées et les réglages d'origine remis.</p>", confirm: 'Restaurer' }))) return;
    busy(btn, true, 'Restauration…');
    try {
      const r = await api(`/api/devices/${encodeURIComponent(id)}/restore`, { method: 'POST', body });
      const ko = r.log.filter((l) => !l.ok).length;
      toast(ko ? `Restauration terminée, ${plural(ko, 'erreur')}.` : 'Restauration terminée.', ko ? 'error' : '');
      drawHistory(renderId, id);
    } catch (e) { toast(e.message, 'error'); busy(btn, false); }
  };
  $('#restore-all', box)?.addEventListener('click', (e) => doRestore(e.currentTarget, { snapshot: 'all' }, 'Tout restaurer ?'));
  $$('[data-restore]', box).forEach((b) => b.addEventListener('click', () => doRestore(b, { snapshot: b.dataset.restore }, 'Annuler cette optimisation ?')));
  $$('[data-reenable]', box).forEach((b) => b.addEventListener('click', async () => {
    const [snapshot, pkg] = b.dataset.reenable.split('|');
    busy(b, true, '…');
    try {
      await api(`/api/devices/${encodeURIComponent(id)}/restore`, { method: 'POST', body: { snapshot, pkg } });
      toast(`${pkg} réactivée.`);
      drawHistory(renderId, id);
    } catch (e) { toast(e.message, 'error'); busy(b, false); }
  }));
}

// =====================================================================
// Optimisation d'un niveau
// =====================================================================
async function viewOptimize(rid, id, levelStr) {
  const level = Number(levelStr);
  const d = S.devices.find((x) => x.id === id);
  if (!d) throw new Error("Cette TV n'est plus enregistrée.");
  const st = { plan: null, mode: 'recommended', sel: new Set(), bg: new Set(), launcher: null, disableStock: false, dns: false, reclaim: false, q: '', filter: 'all' };
  const L = S.levels[level] || {};
  const head = () => `
    ${crumbs([['Appareils', '#/'], [displayName(d), `#/tv/${encodeURIComponent(id)}`], [`Niveau ${level}`]])}
    <div class="page-head"><div class="lead"><h1>Niveau ${level} · ${esc(L.title || '')}</h1><p class="t2 sm">${esc(L.summary || '')}</p></div></div>`;

  const load = async () => {
    $app.innerHTML = `${head()}<div class="panel loading"><div class="spin"></div><p>Analyse de ${esc(displayName(d))}…</p><p class="sm t3">Mesure de la mémoire utilisée par chaque appli, jusqu'à 30 secondes.</p></div>`;
    const plan = await api(`/api/devices/${encodeURIComponent(id)}/plan?level=${level}&mode=${st.mode}`);
    if (rid !== renderId) return;
    // Premier chargement : sélection recommandée. Ensuite (changement de mode) : on garde les choix.
    const prev = st.plan ? st.sel : null;
    const prevBg = st.plan ? st.bg : null;
    st.plan = plan;
    st.sel = new Set(plan.apps.filter((a) => !a.disabled && !a.locked && (prev ? prev.has(a.pkg) : a.checked)).map((a) => a.pkg));
    st.bg = new Set((plan.background || []).filter((b) => !b.restricted && (prevBg ? prevBg.has(b.pkg) : b.checked)).map((b) => b.pkg));
    draw();
  };

  const selected = () => st.plan.apps.filter((a) => st.sel.has(a.pkg));
  // Stockage récupérable : applis déjà désactivées + celles cochées pour ce niveau
  const reclaimMb = () => ((st.plan.storage && st.plan.storage.disabledMb) || 0) + selected().reduce((s, a) => s + (a.disabled ? 0 : a.updMb || 0), 0);
  const lossy = (a) => a.risk !== 'safe' && a.level !== 1;

  const draw = () => {
    const p = st.plan;
    const anim = p.settingsChanges[0];
    $app.innerHTML = `
      ${head()}
      ${cytLine(p)}
      <section class="section">
        <div class="section-head"><h2>Réglages et nettoyage</h2><p>Mémoire libre actuellement : <b class="num">${p.ramFreeMb != null ? fmtMb(p.ramFreeMb) : '?'}</b></p></div>
        <div class="panel panel-pad">
          <ul class="log">
            <li>${ic('check')}<span>${p.animSkipped ? 'Animations conservées (Fire TV : nécessaire pour accéder à ses paramètres)' : anim ? `Animations accélérées : ${esc(anim.from)}x → ${esc(anim.to)}x` : 'Animations déjà à 0,5x'}</span></li>
            <li>${ic('check')}<span>Applis recompilées en arrière-plan : elles démarrent plus vite (quelques minutes, la TV peut ralentir pendant ce temps)</span></li>
            <li>${ic('check')}<span>${p.scanChanges && p.scanChanges.length ? 'Recherche Wi-Fi et Bluetooth en arrière-plan coupée (les télécommandes ne sont pas concernées)' : 'Recherche Wi-Fi et Bluetooth en arrière-plan déjà coupée'}</span></li>
            <li>${ic('check')}<span>Caches vidés et applis en arrière-plan fermées, sans toucher à tes données. <span class="t3">Effet immédiat mais temporaire : Android relance une partie des applis.</span></span></li>
          </ul>
          ${p.dns ? `<div class="dns-opt">${p.dns.active ? `<p class="sm">${ic('check')} DNS anti-pub déjà actif (${esc(p.dns.name)}).</p>` : !p.dns.available ? '<p class="sm t3">DNS anti-pub : demande Android 9 ou plus récent.</p>' : `
            <label class="check"><input type="checkbox" id="dns" ${st.dns ? 'checked' : ''}><span><b>DNS anti-pub (${esc(p.dns.name)})</b><br><span class="t2">Bloque la plupart des pubs et des pisteurs dans les applis et sur l'accueil, sans rien installer. Les pubs YouTube passent quand même. Si une appli (IPTV, streaming) se met à mal fonctionner, annule-le depuis l'historique.${p.dns.other ? ` Remplace le DNS privé actuel (${esc(p.dns.other)}).` : ''}</span></span></label>`}</div>` : ''}
        </div>
      </section>

      <section class="section">
        <div class="section-head"><h2>${level === 1 ? 'Télémétrie' : 'Applis à désactiver'}</h2><p>${level === 1 ? 'Seuls les services qui envoient des statistiques sont coupés.' : st.mode === 'recommended' ? 'Les applis sans risque sont pré-cochées. Décoche ce que tu veux garder.' : 'Toutes les applis de la TV. Les applis essentielles sont verrouillées.'}</p></div>
        <div class="panel">
          <div class="toolbar">
            ${level >= 2 ? `<div class="seg" role="group" aria-label="Mode de sélection"><button data-mode="recommended" class="${st.mode === 'recommended' ? 'on' : ''}">Recommandé</button><button data-mode="manual" class="${st.mode === 'manual' ? 'on' : ''}">Manuel</button></div>` : ''}
            <div class="search grow">${ic('search')}<input class="input" type="search" id="q" placeholder="Rechercher une appli" value="${esc(st.q)}"></div>
            <select class="input" id="filter" style="width:auto">
              <option value="all">Toutes</option>
              <option value="sel">Sélectionnées</option>
              <option value="safe">Sans risque</option>
              <option value="info">À savoir</option>
              <option value="warn">Déconseillées</option>
            </select>
          </div>
          <div id="apps"></div>
        </div>
      </section>

      ${level >= 2 && p.background && p.background.length ? `
      <section class="section">
        <div class="section-head"><h2>Applis gardées : arrière-plan</h2><p>Elles marchent normalement quand tu les ouvres, mais ne tournent plus en cachette.</p></div>
        <div class="panel">${p.background.map((b) => `
          <label class="check bg-row ${b.restricted ? 'is-off' : ''}"><input type="checkbox" data-bg="${esc(b.pkg)}" ${b.restricted ? 'checked disabled' : st.bg.has(b.pkg) ? 'checked' : ''}><span><b>${esc(b.name)}</b>${b.memMb ? ` <span class="t3 num">${fmtMb(b.memMb)}</span>` : ''}${b.restricted ? ' <span class="tag">Déjà bloquée</span>' : ''}${b.why ? `<br><span class="t2 sm">${esc(b.why)}</span>` : ''}</span></label>`).join('')}
        </div>
      </section>` : ''}

      ${level >= 2 && p.storage && p.storage.sdk >= 29 ? `
      <section class="section">
        <div class="section-head"><h2>Stockage</h2></div>
        <div class="panel panel-pad">
          <label class="check"><input type="checkbox" id="reclaim" ${st.reclaim ? 'checked' : ''}><span><b>Récupérer la place des applis désactivées (environ <span id="reclaim-mb">${fmtMb(reclaimMb())}</span>)</b><br><span class="t2">Elles reviennent à leur version d'usine : leurs mises à jour sont supprimées. Si tu en réactives une, le Play Store la remettra à jour. Utile surtout quand le stockage est presque plein.</span></span></label>
        </div>
      </section>` : ''}

      ${level >= 3 ? launcherSection(p.launcher) : ''}
      <div class="note">${ic('undo')}<div>Rien n'est supprimé : chaque appli se réactive depuis l'historique de la TV, en un clic.</div></div>`;

    $('#filter').value = st.filter;
    drawApps();

    let bar = document.querySelector('.actionbar');
    if (!bar) { bar = document.createElement('div'); bar.className = 'actionbar'; document.body.appendChild(bar); }
    updateBar();

    $$('[data-mode]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.mode === st.mode) return;
      st.mode = b.dataset.mode;
      load().catch((e) => toast(e.message, 'error'));
    }));
    $('#q').addEventListener('input', (e) => { st.q = e.target.value; drawApps(); });
    $('#filter').addEventListener('change', (e) => { st.filter = e.target.value; drawApps(); });
    $$('input[name=launcher]').forEach((r) => r.addEventListener('change', () => {
      st.launcher = r.value || null;
      $$('.choice').forEach((el) => el.classList.toggle('on', !!el.querySelector('input[name=launcher]')?.checked));
      $('#stock-row').hidden = !st.launcher;
      updateBar();
    }));
    $('#disable-stock')?.addEventListener('change', (e) => { st.disableStock = e.target.checked; updateBar(); });
    $('#dns')?.addEventListener('change', (e) => { st.dns = e.target.checked; });
    $('#reclaim')?.addEventListener('change', (e) => { st.reclaim = e.target.checked; });
    $$('[data-bg]').forEach((c) => c.addEventListener('change', () => { if (c.checked) st.bg.add(c.dataset.bg); else st.bg.delete(c.dataset.bg); }));
    $$('[data-install]').forEach((b) => b.addEventListener('click', async (e) => {
      e.preventDefault();
      busy(b, true, b.dataset.apk ? 'Installation…' : 'Ouverture…');
      try {
        const r = await api(`/api/devices/${encodeURIComponent(id)}/open-store`, { method: 'POST', body: { pkg: b.dataset.install } });
        if (r.mode === 'apk') { toast('Lanceur installé sur la TV.'); await load(); return; }
        toast('Le Play Store est ouvert sur la TV : installe le lanceur, puis appuie sur « Actualiser ».');
      } catch (err) { toast(err.message, 'error'); }
      busy(b, false);
    }));
    $('#refresh-launchers')?.addEventListener('click', () => load().catch((e) => toast(e.message, 'error')));
  };

  const drawApps = () => {
    const q = st.q.trim().toLowerCase();
    const order = (a) => ({ safe: 0, info: 1, warn: 2, unknown: 3, protected: 4 }[a.risk] ?? 5);
    const list = st.plan.apps.filter((a) => {
      if (q && !`${a.name} ${a.pkg}`.toLowerCase().includes(q)) return false;
      if (st.filter === 'sel') return st.sel.has(a.pkg);
      if (st.filter !== 'all') return a.risk === st.filter;
      return true;
    });
    const groups = new Map();
    for (const a of list) {
      const g = a.level === 1 ? 'Télémétrie' : a.category || 'Autres';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(a);
    }
    const box = $('#apps');
    box.innerHTML = list.length
      ? [...groups.entries()].map(([g, items]) => `<div class="app-group">${esc(g)} · ${items.length}</div>${items.sort((a, b) => order(a) - order(b) || b.memMb - a.memMb).map(appRow).join('')}`).join('')
        + (st.mode === 'manual' ? `<div class="list-foot">${ic('lock')} Les applis essentielles au fonctionnement de la TV sont verrouillées.</div>` : '')
      : `<p class="list-foot">${st.plan.apps.length ? 'Aucune appli ne correspond à ce filtre.' : 'Aucune appli concernée sur cette TV.'}</p>`;
    $$('input[type=checkbox]', box).forEach((c) => c.addEventListener('change', () => {
      c.checked ? st.sel.add(c.value) : st.sel.delete(c.value);
      c.closest('.app-row').classList.toggle('sel', c.checked);
      updateBar();
    }));
  };

  // En tête du plan : modèle reconnu par CleanYourTV, ou suggestions sans modèle exact. Rien si l'ancien serveur ne fournit pas ces champs.
  const cytLine = (p) => {
    const c = p.cleanyourtv || null;
    const any = (p.apps || []).some(isCyt);
    if (!(c && c.model) && !any) return '';
    const url = c && /^https:\/\//.test(c.url || '') ? c.url : CYT_URL;
    const txt = c && c.model ? `${T.cytModel} <b>${esc(c.model)}</b>` : T.cytNoModel;
    return `<div class="note cyt">${ic('info')}<div class="stack"><span>${txt}</span><span class="sm t2">${esc(T.cytHelp)} <a href="${esc(url)}" target="_blank" rel="noopener noreferrer">CleanYourTV</a></span></div></div>`;
  };

  const cytBadge = (a) => isCyt(a)
    ? ` <span class="tag cyt" title="${esc(a.sourceModel ? T.cytTipModel(a.sourceModel) : T.cytTip)}">${T.cytBadge}</span>`
    : '';
  const whyText = (a) => (isCyt(a) && a.why && looksEnglish(a.why) ? `<span class="t3">${T.cytNote}</span> <span lang="en">${esc(a.why)}</span>` : esc(a.why));

  const appRow = (a) => {
    const r = RISK[a.risk] || RISK.unknown;
    const on = st.sel.has(a.pkg);
    const off = a.disabled || a.locked;
    return `
      <label class="app-row ${on ? 'sel' : ''} ${a.disabled ? 'done' : ''} ${a.locked ? 'locked' : ''}">
        <input type="checkbox" value="${esc(a.pkg)}" ${on ? 'checked' : ''} ${off ? 'disabled' : ''}>
        <div style="min-width:0">
          <div class="nm">${esc(a.name)}${cytBadge(a)}</div>
          ${a.name !== a.pkg ? `<div class="pkg">${esc(a.pkg)}</div>` : ''}
          <p class="why">${whyText(a)}${a.loss && !a.locked && a.risk !== 'safe' ? ` <span class="loss"><b>Perte :</b> ${esc(a.loss)}</span>` : ''}</p>
        </div>
        <div class="risk">${a.disabled ? `<span class="dot"></span>Déjà désactivée` : a.locked ? `${ic('lock')}${r.label}` : `<span class="dot ${r.dot}"></span>${r.label}`}</div>
        <div class="mem">${a.memMb ? fmtMb(a.memMb) : '<span class="t3">—</span>'}</div>
      </label>`;
  };

  const launcherSection = (l) => {
    if (!l) return '';
    const choice = (pkg, title, desc, badge, enabled, extra = '') => `
      <label class="choice ${st.launcher === pkg || (!pkg && !st.launcher) ? 'on' : ''} ${enabled ? '' : 'off'}">
        <input type="radio" name="launcher" value="${esc(pkg)}" ${(st.launcher || '') === pkg ? 'checked' : ''} ${enabled ? '' : 'disabled'}>
        <div style="min-width:0" class="section" ><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b>${title}</b>${badge}</div><p class="sm t2">${desc}</p>${extra}</div>
        <span></span>
      </label>`;
    const opts = l.options.map((o) => choice(
      o.pkg, esc(o.name), esc(o.why),
      o.current ? '<span class="tag">Actuel</span>' : o.installed ? '<span class="tag">Installé</span>' : '<span class="tag">Non installé</span>',
      o.installed,
      `${launcherMeta(o)}${launcherShots(o)}${o.installed ? '' : `<div><button type="button" class="btn sm" data-install="${esc(o.pkg)}"${o.apk ? ' data-apk="1"' : ''}>Installer sur la TV</button></div>`}`,
    )).join('');
    const others = l.others.map((c) => {
      const pkg = c.split('/')[0];
      return choice(pkg, `<span class="mono">${esc(pkg)}</span>`, 'Autre lanceur déjà installé sur la TV.', '<span class="tag">Installé</span>', true);
    }).join('');
    const sd = l.stockDisable || { allowed: true, why: '', rivals: [] };
    if (sd.allowed === false) st.disableStock = false;
    const rivals = sd.allowed !== false && sd.rivals && sd.rivals.length
      ? `<span class="sm t2" style="display:block;margin-top:4px">${esc(T.stockRivals)} ${sd.rivals.map((p) => `<span class="mono">${esc(p)}</span>`).join(', ')}</span>` : '';
    const stockRow = sd.allowed === false
      ? `<div id="stock-row" class="note" ${st.launcher ? '' : 'hidden'}>${ic('info')}<div class="stack">
          <label class="check is-off"><input type="checkbox" id="disable-stock" disabled><span><b>${esc(T.stockLabel)}</b> <span class="t3">${esc(T.stockOff)}</span></span></label>
          ${sd.why ? `<span class="sm t2">${esc(sd.why)}</span>` : ''}</div></div>`
      : `<div id="stock-row" class="note warn" ${st.launcher ? '' : 'hidden'}>${ic('alert')}
          <label class="check"><input type="checkbox" id="disable-stock" ${st.disableStock ? 'checked' : ''}><span><b>${esc(T.stockLabel)}</b> ${esc(T.stockDesc)}${rivals}</span></label>
        </div>`;
    return `
      <section class="section">
        <div class="section-head"><h2>Lanceur</h2><button class="btn sm quiet" id="refresh-launchers">${ic('refresh')}Actualiser</button></div>
        <p class="sm t2" style="margin-top:-4px">Accueil actuel : <b>${esc(l.stockName)}</b>. Le lanceur choisi devient l'écran d'accueil par défaut. Captures publiées par les développeurs sur Google Play (clique pour agrandir).</p>
        ${l.fireTv ? `<div class="note attn">${ic('info')}<div><b>Fire TV :</b> Amazon empêche de remplacer durablement l'écran d'accueil (le bouton Accueil rouvre celui d'Amazon). Tu peux installer un lanceur et l'ouvrir comme une appli.</div></div>` : ''}
        <div class="panel">
          ${choice('', "Garder l'accueil actuel", 'Applique seulement le niveau 2.', '', true)}
          ${opts}${others}
        </div>
        ${stockRow}
      </section>`;
  };

  const launcherMeta = (o) => {
    const bits = [o.price, o.rating ? `${String(o.rating.toFixed(1)).replace('.', ',')} / 5 sur Google Play` : o.apk ? 'Hors Play Store, installé directement' : ''].filter(Boolean);
    return bits.length ? `<p class="sm t3">${esc(bits.join(' · '))}${o.source ? ` · <a href="${esc(o.source)}" target="_blank" rel="noopener noreferrer">Code source</a>` : ''}</p>` : '';
  };
  const launcherShots = (o) => (o.shots && o.shots.length
    ? `<div class="shots">${o.shots.map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer"><img src="${esc(u)}" loading="lazy" alt="${esc(o.name)} : capture ${i + 1}"></a>`).join('')}</div>`
    : '');

  const updateBar = () => {
    const bar = document.querySelector('.actionbar');
    if (!bar || !st.plan) return;
    const rmb = $('#reclaim-mb');
    if (rmb) rmb.textContent = fmtMb(reclaimMb());
    const sel = selected();
    const mem = Math.round(sel.reduce((s, a) => s + (a.memMb || 0), 0));
    const losses = sel.filter(lossy).length;
    bar.innerHTML = `
      <div class="inner">
        <div class="figures">
          <div class="figure"><span class="k">Applis</span><span class="v">${sel.length}</span></div>
          <div class="figure"><span class="k">Mémoire estimée</span><span class="v">${fmtMb(mem)}</span></div>
          <div class="figure"><span class="k">Fonctions perdues</span><span class="v ${losses ? 'bad' : ''}">${losses}</span></div>
        </div>
        <button class="btn primary" id="apply">Appliquer le niveau ${level}</button>
      </div>`;
    bar.querySelector('#apply').addEventListener('click', doApply);
  };

  const doApply = async () => {
    const sel = selected();
    const lost = sel.filter(lossy);
    const risky = sel.filter((a) => a.risk === 'warn' || a.risk === 'unknown');
    const html = `
      <p>${`${sel.length} appli${sel.length > 1 ? 's' : ''} désactivée${sel.length > 1 ? 's' : ''}`}, animations accélérées, caches vidés${st.launcher ? ', lanceur remplacé' : ''}.</p>
      ${lost.length ? `<div class="panel panel-pad" style="padding:12px 14px"><span class="sm t3">Ce que tu perds</span><ul class="log" style="margin-top:6px">${lost.map((a) => `<li class="ko">${ic('x')}<span><b>${esc(a.name)}</b> · ${esc(a.loss || 'fonction inconnue')}</span></li>`).join('')}</ul></div>` : ''}
      ${st.disableStock ? `<div class="note warn">${ic('alert')}<div>L'accueil d'origine sera désactivé.</div></div>` : ''}
      <p class="sm">Tout reste réversible depuis l'historique.</p>`;
    const ok = await confirmBox({
      title: `Appliquer le niveau ${level} ?`, html, confirm: 'Appliquer',
      requireCheck: risky.length || st.disableStock ? "J'ai lu les avertissements et je veux continuer." : '',
    });
    if (!ok) return;
    const btn = document.querySelector('#apply');
    busy(btn, true, 'Optimisation en cours…');
    try {
      const r = await api(`/api/devices/${encodeURIComponent(id)}/apply`, {
        method: 'POST',
        body: { level, apps: sel.map((a) => a.pkg), allowWarn: risky.length > 0, dns: st.dns, background: [...st.bg], reclaim: st.reclaim, launcher: st.launcher ? { pkg: st.launcher, disableStock: st.disableStock } : null },
      });
      drawResult(r.snapshot, r.audit);
    } catch (e) {
      toast(e.message, 'error');
      busy(btn, false);
    }
  };

  const drawResult = (snap, audit) => {
    document.querySelector('.actionbar')?.remove();
    const ko = snap.log.filter((l) => !l.ok).length;
    const has = snap.ramBefore != null && snap.ramAfter != null;
    const gain = has ? snap.ramAfter - snap.ramBefore : 0;
    $app.innerHTML = `
      ${crumbs([['Appareils', '#/'], [displayName(d), `#/tv/${encodeURIComponent(id)}`], [`Niveau ${level}`]])}
      <div class="page-head"><div class="lead"><h1>${ko ? `Niveau ${level} appliqué, ${plural(ko, 'étape')} en échec` : `Niveau ${level} appliqué`}</h1><p class="t2 sm">${esc(displayName(d))} · ${esc(fmtDate(snap.at))}</p></div></div>
      ${has ? `<div class="panel"><div class="specs" style="grid-template-columns:repeat(3,minmax(0,1fr))">
        <div class="spec"><span class="k">Mémoire libre avant</span><span class="v">${fmtMb(snap.ramBefore)}</span></div>
        <div class="spec"><span class="k">Juste après</span><span class="v">${fmtMb(snap.ramAfter)}</span></div>
        <div class="spec"><span class="k">Différence</span><span class="v" style="color:${gain >= 0 ? 'var(--ok)' : 'var(--bad)'}">${gain >= 0 ? '+' : '−'}${fmtMb(Math.abs(gain))}</span></div>
      </div></div>
      <p class="sm t3" style="margin-top:-14px">La TV relance certains services juste après : le gain réel se voit mieux après quelques minutes ou un redémarrage.</p>` : ''}
      <section class="section"><div class="section-head"><h2>Détail</h2></div>
        <div class="panel panel-pad"><ul class="log">${snap.log.map((l) => `<li class="${l.ok ? '' : 'ko'}">${ic(l.ok ? 'check' : 'x')}<span>${esc(l.text)}</span></li>`).join('')}</ul></div>
      </section>
      ${audit ? `<div class="note ${audit.next ? 'attn' : ''}">${ic(audit.next ? 'info' : 'check')}<div><b>Niveau atteint : ${esc(auditLabel({ level: audit.level, partial: audit.partial, next: audit.next ? audit.next.level : null })[1])}.</b> ${audit.next ? `Prochaine étape possible : ${esc(audit.next.text)}` : 'Rien de plus à faire.'}</div></div>` : ''}
      <div><a class="btn primary" href="#/tv/${encodeURIComponent(id)}">Retour à la TV</a></div>`;
  };

  await load();
}

// =====================================================================
// Ajouter une TV à distance avec l'appli ATVM Connect
// =====================================================================
let pairTimer = null;
// =====================================================================
// Dépannage à distance : écran en direct (vidéo, ou images si le navigateur ne décode pas la vidéo) + télécommande
const PAD = [
  ['power', '⏻', 'Veille'], ['settings', '⚙', 'Paramètres'], ['recent', '▤', 'Applis récentes'],
  ['back', '↩', 'Retour'], ['home', '⌂', 'Accueil'], ['menu', '☰', 'Menu'],
  ['voldown', '🔉', 'Volume −'], ['mute', '🔇', 'Muet'], ['volup', '🔊', 'Volume +'],
  ['rewind', '⏪', 'Retour rapide'], ['playpause', '⏯', 'Lecture / pause'], ['forward', '⏩', 'Avance rapide'],
];
const PAD_KEYS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'ok', Escape: 'back', Backspace: 'back', Home: 'home', '+': 'volup', '-': 'voldown', ' ': 'playpause' };

async function viewRemote(rid, id) {
  const d = S.devices.find((x) => x.id === id);
  if (!d) throw new Error("Cette TV n'est plus enregistrée.");
  const base = `/api/devices/${encodeURIComponent(id)}/remote`;
  const canVideo = typeof window.VideoDecoder === 'function';
  // Page en pleine largeur : l'écran de la TV prend toute la place disponible
  $app.classList.add('wide');

  $app.innerHTML = `
    ${crumbs([['Appareils', '#/'], [displayName(d), `#/tv/${encodeURIComponent(id)}`], ['Dépannage']])}
    <div class="page-head"><div class="lead"><h1>Dépannage à distance</h1>
      <p class="t2 sm">Tant que cette page est ouverte, la TV affiche le bandeau « Accès à distance : dépannage en cours ».</p></div></div>
    <div class="remote-grid">
      <div class="panel screen-panel">
        <div class="screen-box" id="rv-box">
          <canvas id="rv-canvas" hidden></canvas><img id="rv-img" alt="Écran de la TV" hidden>
          <div class="screen-msg" id="rv-msg"><span class="spin"></span><span>Connexion à la TV…</span></div>
        </div>
        <div class="screen-bar">
          <div class="seg" role="group" aria-label="Affichage">
            <button data-mode="video" ${canVideo ? '' : 'disabled title="Ton navigateur ne sait pas décoder la vidéo ici (il faut une adresse en https)."'}>Vidéo</button>
            <button data-mode="images">Images</button>
          </div>
          <span class="sm t3" id="rv-info"></span>
          <button class="btn sm quiet" id="rv-full">Plein écran</button>
        </div>
      </div>
      <div class="panel pad">
        <div class="dpad">
          <span></span><button class="btn" data-key="up" aria-label="Haut">▲</button><span></span>
          <button class="btn" data-key="left" aria-label="Gauche">◀</button><button class="btn primary ok" data-key="ok">OK</button><button class="btn" data-key="right" aria-label="Droite">▶</button>
          <span></span><button class="btn" data-key="down" aria-label="Bas">▼</button><span></span>
        </div>
        <div class="pad-keys">${PAD.map(([k, label, title]) => `<button class="btn" data-key="${k}" title="${esc(title)}" aria-label="${esc(title)}">${label}</button>`).join('')}</div>
        <form class="pad-text" id="rv-text">
          <input class="input" name="t" placeholder="Texte à taper sur la TV" autocomplete="off" maxlength="500">
          <button class="btn sm">Envoyer</button>
        </form>
        <p class="sm t3">Clavier : flèches, Entrée = OK, Échap = Retour, Début = Accueil, +/− = volume, Espace = pause. Un clic sur l'écran appuie à cet endroit.</p>
        <p class="sm t3">Écran noir ? Les applis protégées (Orange TV, Netflix, Disney+…) interdisent la capture : appuie sur Accueil.</p>
      </div>
    </div>`;

  let alive = true;
  let mode = canVideo ? 'video' : 'images';
  let ws = null;
  let decoder = null;
  const canvas = $('#rv-canvas');
  const img = $('#rv-img');
  const msg = (text, spin = false) => {
    const el = $('#rv-msg');
    if (!el) return;
    el.hidden = !text;
    el.innerHTML = text ? `${spin ? '<span class="spin"></span>' : ''}<span>${esc(text)}</span>` : '';
  };
  const info = (t) => { const el = $('#rv-info'); if (el) el.textContent = t; };

  // Session : ouvre le bandeau sur la TV, puis le garde affiché tant que la page est ouverte
  try { await api(`${base}/start`, { method: 'POST' }); } catch (e) { if (rid === renderId) msg(e.message); return; }
  if (rid !== renderId) { fetch(`${base}/stop`, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: '{}' }); return; }
  const beat = setInterval(() => api(`${base}/start`, { method: 'POST' }).catch(() => {}), 30000);
  const stopSession = () => fetch(`${base}/stop`, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
  window.addEventListener('pagehide', stopSession);

  // --- Vidéo : flux H.264 (scrcpy) décodé par le navigateur
  function stopVideo() {
    if (ws) { ws.onclose = null; ws.close(); ws = null; }
    if (decoder && decoder.state !== 'closed') decoder.close();
    decoder = null;
  }
  function startVideo() {
    stopVideo();
    msg('Démarrage de la vidéo…', true);
    let config = null;
    let codec = '';
    let waitKey = true;
    let frames = 0;
    let lastInfo = performance.now();
    const ctx = canvas.getContext('2d');
    decoder = new VideoDecoder({
      output: (frame) => {
        if (canvas.width !== frame.displayWidth) { canvas.width = frame.displayWidth; canvas.height = frame.displayHeight; }
        ctx.drawImage(frame, 0, 0);
        frame.close();
        if (canvas.hidden) { canvas.hidden = false; img.hidden = true; msg(''); }
        frames += 1;
        const now = performance.now();
        if (now - lastInfo > 2000) { info(`Vidéo · ${Math.round((frames * 1000) / (now - lastInfo))} images/s`); frames = 0; lastInfo = now; }
      },
      error: () => { if (alive && mode === 'video') fallback('Le navigateur n’arrive pas à décoder la vidéo de cette TV.'); },
    });
    const sock = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${base}/video`);
    ws = sock;
    sock.binaryType = 'arraybuffer';
    sock.onmessage = (e) => {
      if (typeof e.data === 'string') {
        const m = JSON.parse(e.data);
        if (m.type === 'error') fallback(m.message);
        else if (m.type === 'meta' && m.codec !== 'h264') fallback('Format vidéo non pris en charge.');
        return;
      }
      const u8 = new Uint8Array(e.data);
      const flags = u8[0];
      const data = u8.subarray(1);
      if (flags & 1) {
        config = data.slice();
        // Profil et niveau lus dans le SPS (octets qui suivent l'en-tête NAL 0x67)
        const i = config.findIndex((b, k) => k > 2 && (b & 0x1f) === 7 && config[k - 1] === 1 && config[k - 2] === 0);
        const hex = (b) => b.toString(16).padStart(2, '0');
        const c = i > 0 ? `avc1.${hex(config[i + 1])}${hex(config[i + 2])}${hex(config[i + 3])}` : 'avc1.42e01f';
        if (c !== codec) { codec = c; decoder.configure({ codec, optimizeForLatency: true }); }
        waitKey = true;
        return;
      }
      if (!codec || decoder.state !== 'configured') return;
      const key = (flags & 2) !== 0;
      if (waitKey && !key) return;
      waitKey = false;
      let chunk = data;
      if (key && config) { chunk = new Uint8Array(config.length + data.length); chunk.set(config); chunk.set(data, config.length); }
      decoder.decode(new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp: Math.round(performance.now() * 1000), data: chunk }));
    };
    sock.onclose = () => { if (alive && mode === 'video' && ws === sock) fallback('La vidéo s’est arrêtée.'); };
  }
  function fallback(reason) {
    stopVideo();
    toast(`${reason} Passage en mode images.`, 'error');
    setMode('images');
  }

  // --- Images : une capture d'écran après l'autre
  let shotLoop = 0;
  async function startImages() {
    const loop = ++shotLoop;
    let url = '';
    msg('Capture de l’écran…', true);
    while (alive && mode === 'images' && loop === shotLoop) {
      const t0 = performance.now();
      try {
        const res = await fetch(`${base}/screen`, { credentials: 'same-origin' });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Erreur ${res.status}`);
        const blob = await res.blob();
        if (!alive || loop !== shotLoop) break;
        if (url) URL.revokeObjectURL(url);
        url = URL.createObjectURL(blob);
        img.src = url;
        img.hidden = false;
        canvas.hidden = true;
        msg('');
        info(`Images · ${((performance.now() - t0) / 1000).toFixed(1).replace('.', ',')} s par image`);
        await new Promise((r) => setTimeout(r, 700));
      } catch (e) {
        msg(e.message);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
    if (url) URL.revokeObjectURL(url);
  }

  function setMode(m) {
    mode = m;
    $$('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
    if (m === 'video') { shotLoop += 1; startVideo(); } else { stopVideo(); startImages(); }
  }
  $$('[data-mode]').forEach((b) => b.addEventListener('click', () => { if (b.dataset.mode !== mode) setMode(b.dataset.mode); }));

  // --- Télécommande
  async function press(key, btn) {
    if (key === 'power' && !(await confirmBox({ title: 'Mettre la TV en veille ?', html: '<p>La TV s’éteint : il faudra peut-être la rallumer sur place.</p>', confirm: 'Mettre en veille' }))) return;
    btn?.classList.add('pressed');
    try { await api(`${base}/key`, { method: 'POST', body: { key } }); } catch (e) { toast(e.message, 'error'); }
    btn?.classList.remove('pressed');
  }
  $$('[data-key]').forEach((b) => b.addEventListener('click', () => press(b.dataset.key, b)));
  const onKey = (e) => {
    if (e.target.closest && e.target.closest('input, textarea, select') || e.ctrlKey || e.altKey || e.metaKey) return;
    const k = PAD_KEYS[e.key];
    if (!k) return;
    e.preventDefault();
    press(k, $(`[data-key="${k}"]`));
  };
  document.addEventListener('keydown', onKey);
  $('#rv-text').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = e.currentTarget.elements.t;
    try { await api(`${base}/text`, { method: 'POST', body: { text: input.value } }); input.value = ''; } catch (err) { toast(err.message, 'error'); }
  });
  // Appui à l'endroit cliqué sur l'écran
  // (l'image est centrée dans son cadre : on retire les éventuelles bandes noires)
  [canvas, img].forEach((el) => el.addEventListener('click', (e) => {
    const r = el.getBoundingClientRect();
    const iw = el === canvas ? canvas.width : img.naturalWidth;
    const ih = el === canvas ? canvas.height : img.naturalHeight;
    if (!iw || !ih) return;
    const scale = Math.min(r.width / iw, r.height / ih);
    const x = (e.clientX - r.left - (r.width - iw * scale) / 2) / (iw * scale);
    const y = (e.clientY - r.top - (r.height - ih * scale) / 2) / (ih * scale);
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    api(`${base}/tap`, { method: 'POST', body: { x, y } }).catch((err) => toast(err.message, 'error'));
  }));
  $('#rv-full').addEventListener('click', () => { const box = $('#rv-box'); if (document.fullscreenElement) document.exitFullscreen(); else box.requestFullscreen?.(); });

  pageCleanup = () => {
    alive = false;
    shotLoop += 1;
    clearInterval(beat);
    stopVideo();
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('pagehide', stopSession);
    stopSession();
  };
  setMode(mode);
}

async function viewAddRemote(rid) {
  clearInterval(pairTimer);
  stopFts();
  const known = new Set(S.devices.map((d) => d.id));
  const apk = `${location.host}/connect.apk`;
  $app.innerHTML = `
    ${crumbs([['Appareils', '#/'], ['Ajouter à distance']])}
    <div class="page-head"><div class="lead"><h1>Ajouter une TV à distance</h1><p class="t2 sm">Pour une TV qui n'est pas sur le même réseau que le serveur, par exemple chez un proche. L'appli <b>ATVM Connect</b> relie la TV à ce site, sans rien configurer sur la box.</p></div></div>
    <div class="note attn" style="margin-bottom:16px">${ic("info")}<div><b>Fire TV récentes (Fire OS 8) :</b> ATVM Connect ne fonctionne pas, Amazon bloque le débogage depuis la TV elle-même. Pour ces modèles, la Fire TV doit rejoindre ton réseau Tailscale (ou être sur le même réseau que ce serveur) : voir plus bas, « Fire TV récente ».</div></div>
    <div class="panel">
      <ol class="steps">
        <li><div><h3>Installe ATVM Connect</h3>
          <p>Sur la TV, installe l'appli <b>Downloader</b> depuis le Play Store, ouvre-la et tape ${S.features.downloaderCode ? 'ce code' : 'cette adresse'} :</p>
          ${S.features.downloaderCode ? `<div class="pair-code mono">${esc(S.features.downloaderCode)}</div><p class="sm t3">ou l'adresse <span class="mono">${esc(apk)}</span></p>` : `<div class="copy-line"><span class="mono">${esc(apk)}</span><button class="btn sm" data-copyline="${esc(`https://${apk}`)}">${ic('copy')}Copier</button></div>`}
          <p>Lance le téléchargement puis <b>Installer</b>. Si Android le demande, autorise Downloader à installer des applis.</p></div></li>
        <li><div><h3>Ouvre ATVM Connect et suis ses instructions</h3>
          <p>L'appli vérifie si le <b>mode développeur</b> et le <b>débogage</b> sont actifs. Sinon, elle ouvre directement le bon écran des paramètres et explique quoi faire : 7 appuis sur « Build », puis activer « Débogage USB » et « Débogage réseau ». Plus besoin de chercher dans les menus.</p>
          <p>Ensuite, ATVM Connect fait apparaître la fenêtre « Autoriser le débogage ? » : coche <b>Toujours autoriser</b> et valide (le bouton sélectionné au départ est souvent « Annuler »).</p></div></li>
        <li><div><h3>Entre le code dans l'appli</h3>
          <p>À la dernière étape, ATVM Connect demande ce code : elle se relie toute seule à ce serveur, aucune adresse à taper. La TV apparaît alors automatiquement ici et dans <a href="#/">${isAdmin() ? 'Appareils' : 'Mes TV'}</a>.</p>
          <div id="pair-box"><button class="btn primary" id="pair-gen">Générer un code</button></div></div></li>
      </ol>
    </div>
    ${ftsSection()}
    ${S.features.tailscale ? `
    <div class="panel">
      <details class="disclose" style="border-top:0">
        <summary>${ic('chevron')}Autre méthode : Tailscale (avancé)</summary>
        <div class="body">
          <p>Si la TV utilise déjà Tailscale, ou si ATVM Connect ne fonctionne pas sur ce modèle.</p>
          <ol>
            <li>Sur la TV : active le débogage (<a href="#/guide">guide</a>), installe <b>Tailscale</b> depuis le Play Store et ouvre-le.</li>
            <li>Choisis <b>Log in</b> : la TV affiche un <b>code</b>. Envoie-le à l'administrateur d'ATV Manager.</li>
            <li>L'administrateur saisit le code dans sa console Tailscale (Add device › Input code), lance la recherche dans ATV Manager, isole la TV et te la partage.</li>
          </ol>
        </div>
      </details>
    </div>` : ''}
    <div class="note">${ic('shield')}<div>ATVM Connect ne fait rien tout seul : il exécute uniquement les optimisations que tu lances ici, et tu peux le retirer à tout moment depuis la fiche de la TV.</div></div>`;

  $$('[data-copyline]').forEach((b) => b.addEventListener('click', () => copyText(b.dataset.copyline, 'Adresse copiée.')));
  bindFts(rid);
  $('#pair-gen').addEventListener('click', async (e) => {
    busy(e.currentTarget, true, 'Création…');
    try {
      const r = await api('/api/agent/pair-code', { method: 'POST' });
      if (rid !== renderId) return;
      const end = Date.now() + r.expiresIn * 1000;
      const box = $('#pair-box');
      const tick = async () => {
        if (rid !== renderId) { clearInterval(pairTimer); return; }
        const left = Math.max(0, Math.round((end - Date.now()) / 1000));
        const t = box.querySelector('.pair-left');
        if (t) t.textContent = left ? `Valable encore ${left >= 60 ? `${Math.floor(left / 60)} min ${String(left % 60).padStart(2, '0')} s` : `${left} s`}` : 'Code expiré';
        if (!left) { clearInterval(pairTimer); box.innerHTML = `<button class="btn primary" id="pair-gen2">Générer un nouveau code</button>`; $('#pair-gen2').addEventListener('click', () => viewAddRemote(rid)); return; }
        // Toutes les 3 s : la TV est-elle arrivée ?
        if (left % 3 === 0) {
          try {
            const st = await api('/api/state');
            const fresh = st.devices.find((d) => !known.has(d.id) && d.transport === 'agent');
            if (fresh && rid === renderId) {
              clearInterval(pairTimer);
              S.devices = st.devices;
              toast(`${displayName(fresh)} est associée.`);
              location.hash = `#/tv/${encodeURIComponent(fresh.id)}`;
            }
          } catch { /* on réessaie au prochain tour */ }
        }
      };
      box.innerHTML = `<div class="pair-code mono" aria-label="Code d'association">${esc(r.code.replace(/(\d{3})(\d{3})/, '$1 $2'))}</div><p class="sm t3 pair-left"></p><p class="sm t2"><span class="spin" style="width:12px;height:12px;display:inline-block;vertical-align:-1px"></span> En attente de la TV…</p>`;
      tick();
      pairTimer = setInterval(tick, 1000);
    } catch (err) { toast(err.message, 'error'); busy(e.currentTarget, false); }
  });
}

// Fire TV récente (Fire OS 8) : la TV rejoint Tailscale avec une clé générée ici, puis le serveur s'y connecte
let ftsTimer = null;
const FTS_LIVE = new Set(['waiting-device', 'waiting-admin', 'waiting-auth', 'offline']);
const FTS_DOT = { 'waiting-device': 'accent', 'waiting-admin': 'accent', 'waiting-auth': 'note', offline: 'bad', done: 'ok', expired: '', rejected: 'bad' };
const FTS_SPIN = new Set(['waiting-device', 'waiting-admin']);
function stopFts() { clearInterval(ftsTimer); ftsTimer = null; }
// Heure lisible (accepte une date ISO, des millisecondes ou des secondes)
function hhmm(v) {
  const n = typeof v === 'number' && v < 1e12 ? v * 1000 : v;
  const d = new Date(n);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function ftsSection() {
  if (!S.features.tailscaleSelfService) {
    return `<section class="section"><div class="section-head"><h2>${T.ftsTitle}</h2></div>
      <div class="note">${ic('info')}<div>${T.ftsOff}${isAdmin() ? ` ${T.ftsOffAdmin}` : ''}</div></div></section>`;
  }
  const code = S.features.tailscaleDownloaderCode;
  const way = ftsWay();
  const opt = (v, title, desc) => `<label class="choice fts-way ${way === v ? 'on' : ''}"><input type="radio" name="fts-way" value="${v}" ${way === v ? 'checked' : ''}><div><b>${title}</b><p class="sm t2">${desc}</p></div></label>`;
  return `<section class="section" id="fts">
    <div class="section-head"><h2>${T.ftsTitle}</h2></div>
    <p class="t2">${T.ftsIntro}</p>
    <div class="note attn">${ic('info')}<div>${T.ftsBefore} <a href="#/guide" data-guide-go="firetv">${T.ftsGuide}</a></div></div>
    <div class="panel">
      <ol class="steps">
        <li><div><h3>${T.fts1Title}</h3>
          <p>${code ? T.fts1Code : T.fts1NoCode}</p>
          ${code ? `<div class="pair-code mono">${esc(code)}</div><p>${T.fts1After}</p>` : ''}</div></li>
        <li><div><h3>${T.ftsHowTitle}</h3><p>${T.ftsHowDesc}</p>
          <div class="fts-ways" role="radiogroup" aria-label="${esc(T.ftsHowTitle)}">
            ${opt('code', T.ftsOptCode, T.ftsOptCodeDesc)}
            ${opt('key', T.ftsOptKey, T.ftsOptKeyDesc)}
          </div>
          <div class="fts-way-body" id="fts-way-code" ${way === 'code' ? '' : 'hidden'}>
            <ol class="fts-sub">
              <li><p>${T.dc1}</p></li>
              <li><p>${T.dc2}</p>
                <form id="dc-form" class="form-row dc-form">
                  <label class="field">${T.dcLabel}<input class="input lg mono dc-input" type="text" name="code" required maxlength="40" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
                  <button class="btn primary" type="submit">${T.dcSend}</button>
                </form>
                <div id="dc-err"></div></li>
              <li><p>${T.dc3}</p></li>
            </ol>
          </div>
          <div class="fts-way-body" id="fts-way-key" ${way === 'key' ? '' : 'hidden'}>
            <ol class="fts-sub">
              <li><p><b>${T.fts2Title}.</b> ${T.fts2Desc}</p>
                <div id="fts-key"><button class="btn primary" id="fts-gen" type="button">${ic('lock')}${T.fts2Btn}</button></div><div id="fts-err"></div></li>
              <li><p><b>${T.fts3Title}.</b> ${T.fts3Desc}</p></li>
            </ol>
          </div></div></li>
        <li><div><h3>${T.fts4Title}</h3><p>${T.fts4Desc}</p>
          <div id="fts-list" class="fts-list" aria-live="polite"></div></div></li>
      </ol>
    </div>
  </section>`;
}

// Façon choisie (code ou clé), retenue sur cet appareil
function ftsWay() {
  let v = '';
  try { v = localStorage.getItem('atvm.ftsWay') || ''; } catch { /* stockage indisponible */ }
  return v === 'code' || v === 'key' ? v : (isAdmin() ? 'key' : 'code');
}

// Demande (clé ou code) ramenée à une forme commune
function ftsItem(kind, p) {
  return {
    kind,
    id: String(kind === 'key' ? p.keyId : p.id),
    st: String((kind === 'key' ? p.state : p.status) || ''),
    name: p.name || '',
    deviceId: p.deviceId || '',
    createdAt: p.createdAt,
    userName: p.userName || '',
    code: p.code || '',
  };
}

function ftsRow(x, { validate = true } = {}) {
  const label = (x.kind === 'code' ? T.dcSt : T.ftsSt)[x.st] || x.st;
  let action = '';
  if (x.st === 'done' && x.deviceId) action = `<a class="btn sm" href="#/tv/${encodeURIComponent(x.deviceId)}">${T.ftsOpen}</a>`;
  else if (x.st === 'waiting-auth' || x.st === 'offline') action = `<button class="btn primary" data-fts-prompt="${esc(x.id)}" data-kind="${x.kind}">${ic('remote')}${T.ftsPrompt}</button>`;
  else if (x.st === 'waiting-admin' && validate && isAdmin()) action = `<a class="btn sm primary" href="#/tailscale-codes">${T.dcValidate}</a>`;
  const wait = FTS_SPIN.has(x.st) ? '<span class="spin" aria-hidden="true"></span>' : `<span class="dot ${FTS_DOT[x.st] || ''}"></span>`;
  const sub = [
    x.name ? `<span class="mono">${esc(x.name)}</span>` : '',
    esc(x.kind === 'code' ? T.dcRow(whenShort(x.createdAt)) : T.ftsKey(whenShort(x.createdAt))),
    x.userName && isAdmin() ? esc(T.dcBy(x.userName)) : '',
  ].filter(Boolean).join(' · ');
  return `<div class="fts-row">${wait}<div class="fts-txt"><div>${x.st === 'done' ? `<b>${esc(label)}</b>` : esc(label)}</div>
    <div class="sm t3">${sub}</div></div>${action}</div>`;
}

// Heure seule si c'est aujourd'hui, sinon jour et heure
function whenShort(v) {
  const n = typeof v === 'number' && v < 1e12 ? v * 1000 : v;
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return '';
  if (d.toDateString() === new Date().toDateString()) return hhmm(v);
  return `${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} ${hhmm(v)}`;
}

// Relance la fenêtre « Autoriser le débogage ? » sur la TV
async function ftsPrompt(b, after) {
  busy(b, true, T.ftsPromptBusy);
  const base = b.dataset.kind === 'code' ? '/api/tailscale/devicecode' : '/api/tailscale/pending';
  try {
    await api(`${base}/${encodeURIComponent(b.dataset.ftsPrompt)}/prompt`, { method: 'POST' });
    toast(T.ftsPrompted);
    after();
  } catch (err) { toast(err.message, 'error'); busy(b, false); }
}

// Liste des demandes par code (tableau vide si le serveur ne connaît pas encore cette route)
async function dcList() {
  try {
    const r = await api('/api/tailscale/devicecode');
    return Array.isArray(r) ? r : [];
  } catch (err) {
    if (err.status === 404) return [];
    throw err;
  }
}

function bindFts(rid) {
  $$('[data-guide-go]').forEach((a) => a.addEventListener('click', () => { guideKey = a.dataset.guideGo; }));
  if (!S.features.tailscaleSelfService || !$('#fts-list')) return;
  pageCleanup = stopFts;
  const seen = new Map();
  let first = true;
  let last = '';
  const poll = async () => {
    if (rid !== renderId) { stopFts(); return; }
    if (document.hidden && !first) return;
    const [keys, codes] = await Promise.all([
      api('/api/tailscale/pending').then((r) => (Array.isArray(r) ? r : [])).catch(() => null),
      dcList().catch(() => null),
    ]);
    if (rid !== renderId || (keys === null && codes === null)) return;
    let list = [...(keys || []).map((p) => ftsItem('key', p)), ...(codes || []).map((p) => ftsItem('code', p))];
    list = list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 6);
    list.forEach((x) => {
      const k = `${x.kind}:${x.id}`;
      const before = seen.get(k);
      if (!first && before && before !== x.st) {
        if (x.st === 'done') toast(T.ftsAdded(x.name || 'La TV'));
        else if (x.st === 'rejected') toast(T.dcSt.rejected, 'error');
      }
      seen.set(k, x.st);
    });
    first = false;
    const html = list.length ? list.map((x) => ftsRow(x)).join('') : `<p class="sm t3">${T.ftsNone}</p>`;
    if (html !== last) { $('#fts-list').innerHTML = html; last = html; }
    const live = list.some((x) => FTS_LIVE.has(x.st));
    if (live && !ftsTimer) ftsTimer = setInterval(poll, 5000);
    if (!live && ftsTimer) stopFts();
  };
  const repoll = () => { last = ''; poll(); };
  $('#fts-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-fts-prompt]');
    if (b) ftsPrompt(b, repoll);
  });

  // Choix entre le code de la TV et la clé
  $$('input[name="fts-way"]').forEach((r) => r.addEventListener('change', () => {
    const v = r.value;
    try { localStorage.setItem('atvm.ftsWay', v); } catch { /* stockage indisponible */ }
    $$('.fts-way').forEach((l) => l.classList.toggle('on', l.querySelector('input').checked));
    $('#fts-way-code').hidden = v !== 'code';
    $('#fts-way-key').hidden = v !== 'key';
  }));

  // Option 2 : envoi du code affiché par la TV
  $('#dc-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const input = ev.target.elements.code;
    const code = input.value.trim();
    if (!code) return;
    const btn = ev.target.querySelector('[type=submit]');
    const out = $('#dc-err');
    busy(btn, true, T.dcBusy);
    try {
      await api('/api/tailscale/devicecode', { method: 'POST', body: { code } });
      if (rid !== renderId) return;
      input.value = '';
      out.innerHTML = '';
      toast(T.dcSent);
      busy(btn, false);
      repoll();
      $('#fts-list').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
      const fallback = { 400: T.dcErr400, 409: T.dcErr409, 429: T.dcErr429 }[err.status];
      const msg = err.data && err.data.error ? err.message : fallback || err.message;
      out.innerHTML = `<div class="note warn" style="margin-top:10px">${ic('alert')}<div>${esc(msg)}</div></div>`;
      busy(btn, false);
      input.focus();
    }
  });

  // Option 1 : clé à usage unique
  const gen = async (e) => {
    const btn = e.currentTarget;
    busy(btn, true, T.fts2Busy);
    try {
      const r = await api('/api/tailscale/authkey', { method: 'POST' });
      if (rid !== renderId) return;
      const box = $('#fts-key');
      box.innerHTML = `<div class="copy-line fts-key"><span class="mono">${esc(r.key)}</span><button class="btn sm" id="fts-copy" type="button">${ic('copy')}Copier</button></div>
        <div class="note fts-tip">${ic('keyboard')}<div>${T.fts3Tip}</div></div>
        <p class="sm t2">${esc(T.fts2Valid(hhmm(r.expiresAt)))} ${T.fts2Once}</p>
        <div><button class="btn sm quiet" id="fts-gen" type="button">${T.fts2Again}</button></div>`;
      if ($('#fts-err')) $('#fts-err').innerHTML = '';
      $('#fts-copy').addEventListener('click', () => copyText(r.key, T.fts2Copied));
      $('#fts-gen').addEventListener('click', gen);
      $('#fts-copy').focus();
      poll();
    } catch (err) {
      const msg = err.data && err.data.error ? err.message : err.status === 429 ? T.fts2Busy429 : err.status === 409 ? T.fts2Busy409 : err.message;
      toast(msg, 'error');
      busy(btn, false);
      // Clé refusée (accès indisponible ou règles Tailscale qui n'isolent pas les TV) : l'administrateur va vérifier
      const out = $('#fts-err');
      if (out) out.innerHTML = err.status === 409 ? `<div class="note warn" style="margin-top:10px">${ic('alert')}<div class="stack"><span>${esc(msg)}</span>${isAdmin() ? `<div><a class="btn sm" href="#/settings">${ic('shield')}${T.ftsCheckLink}</a></div>` : ''}</div></div>` : '';
    }
  };
  $('#fts-gen').addEventListener('click', gen);
  poll();
}

// =====================================================================
// Administrateur : TV à valider dans Tailscale (code affiché par la TV)
// =====================================================================
const TS_CONSOLE = 'https://console.tailscale.com/admin/machines';
let tvwTimer = null;
function stopTvw() { clearInterval(tvwTimer); tvwTimer = null; }

async function viewTsCodes(rid) {
  stopTvw();
  await loadState();
  if (rid !== renderId) return;
  if (!isAdmin()) { location.hash = '#/add'; return; }
  $app.innerHTML = `
    ${crumbs([['Appareils', '#/'], [T.tvwTitle]])}
    <div class="page-head"><div class="lead"><h1>${T.tvwTitle}</h1><p class="t2 sm">${T.tvwIntro}</p></div></div>
    <div id="tvw-list" class="tvw-list" aria-live="polite"><div class="panel panel-pad"><span class="spin" aria-hidden="true"></span></div></div>
    <section class="section" id="tvw-other" hidden>
      <div class="section-head"><h2>${T.tvwRecent}</h2></div>
      <div id="tvw-other-list" class="fts-list" style="margin-top:0"></div>
    </section>`;
  pageCleanup = stopTvw;
  const box = $('#tvw-list');
  let lastOther = '';
  const card = (p) => {
    const who = p.userName || T.tvwSomeone;
    return `<div class="panel tvw-card" data-id="${esc(p.id)}" data-who="${esc(who)}">
      <div class="tvw-head"><span class="spin" aria-hidden="true"></span><div class="tvw-who"><b>${esc(T.tvwFrom(who, whenShort(p.createdAt)))}</b></div>
        <button class="btn sm danger" type="button" data-reject>${ic('x')}${T.tvwReject}</button></div>
      <ol class="steps">
        <li><div><h3>${T.tvwStep1}</h3>
          <div class="tvw-code"><span class="pair-code mono">${esc(p.code)}</span><button class="btn sm" type="button" data-copy>${ic('copy')}${T.tvwCopy}</button></div>
          <div class="tvw-console"><a class="btn" href="${TS_CONSOLE}" target="_blank" rel="noopener noreferrer">${ic('external')}${T.tvwConsole}</a>
          <span class="sm t2">${T.tvwThen} <span class="mono">${esc(T.tvwPath)}</span></span></div></div></li>
        <li><div><h3>${T.tvwStep2}</h3>
          <div class="tvw-cands"><button class="btn primary" type="button" data-pick>${ic('search')}${T.tvwPick}</button></div></div></li>
      </ol>
    </div>`;
  };
  const cands = (list) => {
    if (!list.length) {
      return `<div class="note">${ic('info')}<div class="stack"><span>${T.tvwNoCand}</span><div><button class="btn sm" type="button" data-pick>${ic('refresh')}${T.tvwRefresh}</button></div></div></div>`;
    }
    return `<ul class="list tvw-cand-list">${list.map((c) => {
      const host = c.hostname || c.name || c.tsId;
      const meta = [c.name && c.name !== c.hostname ? `<span class="mono">${esc(c.name)}</span>` : '', esc(c.os || ''), c.created ? esc(T.tvwCreated(whenShort(c.created))) : '', Array.isArray(c.addresses) && c.addresses[0] ? `<span class="mono">${esc(c.addresses[0])}</span>` : ''].filter(Boolean).join(' · ');
      return `<li class="tvw-cand"><div class="tvw-cand-txt"><div class="mono tvw-host">${esc(host)}</div><div class="sm t3">${meta}</div></div>
        <button class="btn sm primary" type="button" data-attach="${esc(c.tsId)}" data-host="${esc(host)}">${T.tvwAttach}</button></li>`;
    }).join('')}</ul>
    <div><button class="btn sm quiet" type="button" data-pick>${ic('refresh')}${T.tvwRefresh}</button></div>`;
  };
  const poll = async () => {
    if (rid !== renderId) { stopTvw(); return; }
    let all;
    try { all = await dcList(); } catch (err) { if (!box.querySelector('.tvw-card')) box.innerHTML = `<div class="note warn">${ic('alert')}<div>${esc(err.message)}</div></div>`; return; }
    if (rid !== renderId) return;
    const items = all.map((p) => ({ ...p, id: String(p.id) })).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const waiting = items.filter((p) => p.status === 'waiting-admin');
    S.tsCodesWaiting = waiting.length;
    // Cartes : on ajoute ou retire sans toucher à celles en cours (liste d'appareils ouverte)
    const ids = new Set(waiting.map((p) => p.id));
    $$('.tvw-card', box).forEach((c) => { if (!ids.has(c.dataset.id)) c.remove(); });
    if (!waiting.length) box.innerHTML = `<div class="panel panel-pad tvw-empty"><span class="dot ok"></span><span>${T.tvwNone}</span></div>`;
    else {
      box.querySelector('.tvw-empty')?.remove();
      box.querySelector(':scope > .panel-pad')?.remove();
      box.querySelector(':scope > .note')?.remove();
      waiting.forEach((p) => { if (!$$('.tvw-card', box).some((c) => c.dataset.id === p.id)) box.insertAdjacentHTML('beforeend', card(p)); });
    }
    const other = items.filter((p) => p.status !== 'waiting-admin').reverse().slice(0, 8);
    $('#tvw-other').hidden = !other.length;
    const html = other.map((p) => ftsRow(ftsItem('code', p), { validate: false })).join('');
    if (html !== lastOther) { $('#tvw-other-list').innerHTML = html; lastOther = html; }
  };
  const byId = (el) => el.closest('.tvw-card');
  box.addEventListener('click', async (e) => {
    const c = byId(e.target);
    if (!c) return;
    const id = c.dataset.id;
    const url = `/api/tailscale/devicecode/${encodeURIComponent(id)}`;
    if (e.target.closest('[data-copy]')) { copyText(c.querySelector('.pair-code').textContent, T.tvwCopied); return; }
    const pick = e.target.closest('[data-pick]');
    if (pick) {
      busy(pick, true, T.tvwPickBusy);
      try {
        const list = await api(`${url}/candidates`);
        c.querySelector('.tvw-cands').innerHTML = cands(Array.isArray(list) ? list : []);
        c.querySelector('.tvw-cands [data-attach], .tvw-cands [data-pick]')?.focus();
      } catch (err) { toast(err.message, 'error'); busy(pick, false); }
      return;
    }
    const att = e.target.closest('[data-attach]');
    if (att) {
      const ok = await confirmBox({ title: T.tvwConfirmTitle(att.dataset.host), html: T.tvwConfirm, confirm: T.tvwConfirmBtn });
      if (!ok) return;
      busy(att, true, T.tvwAttachBusy);
      try {
        await api(`${url}/attach`, { method: 'POST', body: { tsId: att.dataset.attach } });
        toast(T.tvwAttached);
        poll();
      } catch (err) { toast(err.message, 'error'); busy(att, false); }
      return;
    }
    const rej = e.target.closest('[data-reject]');
    if (rej) {
      const ok = await confirmBox({ title: T.tvwRejectTitle, html: T.tvwRejectDesc(esc(c.dataset.who)), confirm: T.tvwReject, danger: true });
      if (!ok) return;
      busy(rej, true, T.dcBusy);
      try {
        await api(`${url}/reject`, { method: 'POST' });
        toast(T.tvwRejected);
        poll();
      } catch (err) { toast(err.message, 'error'); busy(rej, false); }
    }
  });
  $('#tvw-other-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-fts-prompt]');
    if (b) ftsPrompt(b, () => { lastOther = ''; poll(); });
  });
  await poll();
  tvwTimer = setInterval(() => { if (!document.hidden) poll(); }, 5000);
}

// =====================================================================
// Guide de connexion
// =====================================================================
const GUIDES = {
  googletv: {
    label: 'Google TV',
    hint: 'Chromecast avec Google TV, TV Sony, TCL, Philips ou Hisense récentes.',
    dev: ['Paramètres', 'Système', 'À propos', "Build de l'OS Android TV"],
    debug: ['Paramètres', 'Système', 'Options pour les développeurs', 'Débogage USB'],
    ip: ['Paramètres', 'Réseau et Internet', 'ton réseau', 'Adresse IP'],
  },
  androidtv: {
    label: 'Android TV',
    hint: 'Philips, Sony, Xiaomi Mi Box et TV Stick, Nvidia Shield.',
    dev: ['Paramètres', "Préférences de l'appareil", 'À propos', 'Build'],
    debug: ['Paramètres', "Préférences de l'appareil", 'Options pour les développeurs', 'Débogage USB'],
    ip: ['Paramètres', 'Réseau et Internet', 'ton réseau', 'Adresse IP'],
    note: 'Sur certaines Philips et Sony, ces menus sont rangés dans « Paramètres Android » ou « Tous les paramètres ».',
  },
  firetv: {
    label: 'Fire TV',
    hint: 'Fire TV Stick, Fire TV Cube, TV avec Fire TV intégré (Amazon).',
    dev: ['Paramètres', 'Ma Fire TV', 'À propos', 'nom de ta Fire TV (ex. « Fire TV Stick 4K »)'],
    debug: ['Paramètres', 'Ma Fire TV', 'Options pour les développeurs', 'Débogage ADB'],
    ip: ['Paramètres', 'Ma Fire TV', 'À propos', 'Réseau', 'Adresse IP'],
    note: "Sur une Fire TV, ATV Manager ne modifie jamais les animations (sinon ses paramètres deviennent inaccessibles). Si la fenêtre « Autoriser le débogage ? » n'apparaît pas, désactive puis réactive « Débogage ADB » et patiente quelques secondes. Fire TV récentes (Fire OS 8) : l'appli ATVM Connect ne fonctionne pas, Amazon bloquant le débogage depuis la TV elle-même. Il faut que ce serveur soit sur le même réseau que la Fire TV, ou que la Fire TV rejoigne Tailscale.",
  },
  box: {
    label: 'Boîtier Android',
    hint: 'Boîtiers génériques vendus sur AliExpress, Amazon…',
    dev: ['Paramètres', "Préférences de l'appareil", 'À propos', 'Build'],
    debug: ['Paramètres', "Préférences de l'appareil", 'Options pour les développeurs', 'Débogage USB'],
    ip: ['Paramètres', 'Réseau et Internet', 'ton réseau', 'Adresse IP'],
    note: 'Sur beaucoup de boîtiers, le débogage réseau est déjà actif : essaie directement la recherche.',
  },
};
let guideKey = 'googletv';
const menuPath = (items) => `<span class="menu-path">${items.map((i) => `<span>${esc(i)}</span>`).join('<i>›</i>')}</span>`;

async function viewGuide() {
  const g = GUIDES[guideKey];
  $app.innerHTML = `
    <div class="page-head"><div class="lead"><h1>Connecter une TV</h1><p class="t2 sm">À faire une seule fois par TV, avec sa télécommande. Environ 2 minutes.</p></div></div>
    ${compatPanel()}
    <section class="section">
      <div class="section-head">
        <h2>Étapes</h2>
        <div class="seg" role="group" aria-label="Type d'appareil">${Object.entries(GUIDES).map(([k, v]) => `<button data-guide="${k}" class="${k === guideKey ? 'on' : ''}">${esc(v.label)}</button>`).join('')}</div>
      </div>
      <p class="sm t3" style="margin-top:-4px">${esc(g.hint)}</p>
      <div class="panel">
        <ol class="steps">
          <li><div><h3>Active le mode développeur</h3><p>Va dans</p>${menuPath(g.dev)}<p>puis appuie <b>7 fois</b> sur OK sur cette dernière ligne, jusqu'au message « Vous êtes maintenant développeur ».</p></div></li>
          <li><div><h3>Active le débogage</h3>${menuPath(g.debug)}<p>Active-le. S'il existe aussi <b>Débogage réseau</b> ou <b>Débogage ADB via le réseau</b>, active-le également.</p></div></li>
          <li><div><h3>Note l'adresse de la TV</h3>${menuPath(g.ip)}<p>Elle ressemble à <span class="mono">192.168.1.20</span>. Utile si la recherche ne trouve pas la TV.</p></div></li>
          <li><div><h3>Lance la recherche</h3><p>Dans <a href="#/">Appareils</a>, appuie sur « Rechercher les TV ». Sur la TV, la fenêtre « Autoriser le débogage ? » s'affiche : coche <b>Toujours autoriser</b> et valide.</p></div></li>
        </ol>
        ${g.note ? `<div style="padding:0 20px 18px"><div class="note">${ic('info')}<div>${esc(g.note)}</div></div></div>` : ''}
        <details class="disclose">
          <summary>${ic('chevron')}Android 11 et plus : débogage sans fil</summary>
          <div class="body">
            <p>Certaines TV récentes utilisent le <b>débogage sans fil</b> avec un code d'association.</p>
            <ol>
              <li>Sur la TV : ${menuPath(['Options pour les développeurs', 'Débogage sans fil'])} active-le.</li>
              <li>Choisis « Associer l'appareil avec un code » : la TV affiche une adresse <span class="mono">IP:port</span> et un code à 6 chiffres.</li>
              <li>Dans Appareils › « Ajouter une TV par son adresse IP » › « Débogage sans fil », entre l'IP, le port de connexion, puis le port et le code d'association.</li>
            </ol>
          </div>
        </details>
        <details class="disclose">
          <summary>${ic('chevron')}La TV n'est pas trouvée</summary>
          <div class="body">
            <ul>
              <li>La TV et la machine qui fait tourner ATV Manager doivent être sur le <b>même réseau</b> (pas de réseau invité).</li>
              <li>Après un redémarrage, certaines TV coupent le débogage réseau : réactive-le.</li>
              <li>Si tu as refusé l'autorisation, désactive puis réactive le débogage pour revoir la fenêtre.</li>
              <li>Essaie l'ajout par adresse IP avec l'adresse notée à l'étape 3.</li>
            </ul>
          </div>
        </details>
      </div>
    </section>
    <div class="note">${ic('shield')}<div><b>Conseil sécurité.</b> Une fois la TV optimisée, tu peux désactiver le débogage. Réactive-le seulement pour revenir en arrière ou ré-optimiser.</div></div>`;
  $$('[data-guide]').forEach((b) => b.addEventListener('click', () => { guideKey = b.dataset.guide; viewGuide(); }));
}

// =====================================================================
// Réglages
// =====================================================================
const accountSection = () => `
  <section class="section">
    <div class="section-head"><h2>Mon compte</h2></div>
    <div class="panel">
      <div class="setting">
        <div><div class="lbl">${esc(S.user.name)} <span class="tag">${isAdmin() ? 'Administrateur' : 'Invité'}</span></div><p class="desc">Identifiant : <span class="mono">${esc(S.user.username)}</span></p></div>
        <button class="btn sm" data-logout>${ic('logout')}Se déconnecter</button>
      </div>
      <div class="setting">
        <div><div class="lbl">Mot de passe</div><p class="desc">8 caractères minimum, avec 1 lettre, 1 chiffre et 1 caractère spécial.</p></div>
        <button class="btn sm" id="change-pwd">Changer</button>
      </div>
      <div class="setting">
        <div>
          <div class="lbl">Double authentification <span class="status"><span class="dot ${S.user.twoFactor ? 'ok' : ''}"></span>${S.user.twoFactor ? 'Activée' : 'Désactivée'}</span></div>
          <p class="desc">${S.user.twoFactor
            ? `Un code de ton application d'authentification est demandé à chaque connexion. Codes de secours restants : <b>${S.user.recoveryLeft}</b>.`
            : "Optionnel. Ajoute un code à 6 chiffres (Google Authenticator, 2FAS, Aegis…) en plus du mot de passe."}</p>
        </div>
        <button class="btn sm ${S.user.twoFactor ? '' : 'primary'}" id="tfa-toggle">${S.user.twoFactor ? 'Désactiver' : 'Activer'}</button>
      </div>
    </div>
  </section>`;

// Activation de la double authentification : QR code, vérification, codes de secours
async function enableTwoFactor() {
  let setup;
  try { setup = await api('/api/account/2fa/setup', { method: 'POST' }); } catch (e) { toast(e.message, 'error'); return; }
  let qr = '';
  try {
    const q = window.qrcode(0, 'M');
    q.addData(setup.uri);
    q.make();
    qr = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  } catch { /* sans QR, la clé reste saisissable à la main */ }
  const key = setup.secret.match(/.{1,4}/g).join(' ');
  $modal.innerHTML = `
    <form class="dlg" id="tfa-setup">
      <h2>Activer la double authentification</h2>
      <ol class="tfa-steps">
        <li>Ouvre ton application d'authentification et <b>scanne ce QR code</b>.${qr ? `<div class="qr">${qr}</div>` : ''}
          <span class="sm t2">Ou entre la clé à la main : <span class="mono secret">${esc(key)}</span></span>
          <a class="sm" href="${esc(setup.uri)}">Sur ce téléphone : ouvrir dans l'application</a></li>
        <li>Entre le code à 6 chiffres qu'elle affiche.
          <input class="input lg mono code-input" type="text" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required></li>
      </ol>
      <p class="form-error" id="tfa-setup-error" role="alert" hidden></p>
      <div class="dlg-actions"><button class="btn" type="button" id="tfa-cancel">Annuler</button><button class="btn primary" type="submit">Activer</button></div>
    </form>`;
  $modal.onclose = null;
  $modal.showModal();
  const form = $modal.querySelector('#tfa-setup');
  $modal.querySelector('#tfa-cancel').addEventListener('click', () => $modal.close());
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const errBox = $modal.querySelector('#tfa-setup-error');
    const btn = form.querySelector('[type=submit]');
    busy(btn, true, 'Vérification…');
    try {
      const r = await api('/api/account/2fa/enable', { method: 'POST', body: { code: form.code.value } });
      showRecovery(r.recovery);
    } catch (e) {
      busy(btn, false);
      errBox.textContent = e.message;
      errBox.hidden = false;
    }
  });
}

function showRecovery(codes) {
  $modal.innerHTML = `
    <div class="dlg">
      <h2>Double authentification activée</h2>
      <p>Garde ces <b>codes de secours</b> en lieu sûr (gestionnaire de mots de passe, papier). Chacun permet de te connecter une fois si tu perds ton téléphone. Ils ne seront plus affichés.</p>
      <div class="recovery mono">${codes.map((c) => `<span>${esc(c)}</span>`).join('')}</div>
      <div class="dlg-actions">
        <button class="btn" type="button" id="rec-copy">${ic('copy')}Copier</button>
        <button class="btn primary" type="button" id="rec-done">J'ai noté mes codes</button>
      </div>
    </div>`;
  $modal.querySelector('#rec-copy').addEventListener('click', () => copyText(codes.join('\n'), 'Codes copiés.'));
  $modal.querySelector('#rec-done').addEventListener('click', async () => {
    $modal.close();
    await loadState();
    viewSettings(renderId);
  });
}

async function disableTwoFactor() {
  $modal.innerHTML = `
    <form class="dlg" id="tfa-off">
      <h2>Désactiver la double authentification ?</h2>
      <p>Seul ton mot de passe sera demandé à la connexion. Tes codes de secours ne fonctionneront plus.</p>
      <label class="field">Mot de passe<input class="input lg" type="password" name="password" autocomplete="current-password" required></label>
      <p class="form-error" id="tfa-off-error" role="alert" hidden></p>
      <div class="dlg-actions"><button class="btn" type="button" id="tfa-off-cancel">Annuler</button><button class="btn danger" type="submit">Désactiver</button></div>
    </form>`;
  $modal.onclose = null;
  $modal.showModal();
  const form = $modal.querySelector('#tfa-off');
  $modal.querySelector('#tfa-off-cancel').addEventListener('click', () => $modal.close());
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = form.querySelector('[type=submit]');
    busy(btn, true, '…');
    try {
      await api('/api/account/2fa/disable', { method: 'POST', body: { password: form.password.value } });
      $modal.close();
      toast('Double authentification désactivée.');
      await loadState();
      viewSettings(renderId);
    } catch (e) {
      busy(btn, false);
      const errBox = $modal.querySelector('#tfa-off-error');
      errBox.textContent = e.message;
      errBox.hidden = false;
    }
  });
}

function bindAccount() {
  $('#tfa-toggle')?.addEventListener('click', () => (S.user.twoFactor ? disableTwoFactor() : enableTwoFactor()));
  $('#change-pwd')?.addEventListener('click', () => {
    $modal.innerHTML = `
      <form class="dlg" id="pwd-form">
        <h2>Changer le mot de passe</h2>
        <label class="field">Mot de passe actuel<input class="input lg" type="password" name="current" autocomplete="current-password" required></label>
        <label class="field">Nouveau mot de passe<input class="input lg" type="password" name="next" autocomplete="new-password" minlength="8" required></label>
        ${PWD_RULES_HTML}
        <label class="field">Confirme le nouveau mot de passe<input class="input lg" type="password" name="confirm" autocomplete="new-password" minlength="8" required></label>
        <p class="form-error" id="pwd-error" role="alert" hidden></p>
        <div class="dlg-actions"><button class="btn" type="button" id="pwd-cancel">Annuler</button><button class="btn primary" type="submit">Enregistrer</button></div>
      </form>`;
    $modal.onclose = null;
    $modal.showModal();
    const form = $modal.querySelector('#pwd-form');
    const errBox = $modal.querySelector('#pwd-error');
    $modal.querySelector('#pwd-cancel').addEventListener('click', () => $modal.close());
    watchPassword(form.querySelector('input[name=next]'), form.querySelector('.pwd-rules'));
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = Object.fromEntries(new FormData(form));
      if (!pwdValid(f.next)) { errBox.textContent = 'Le nouveau mot de passe ne respecte pas toutes les règles indiquées.'; errBox.hidden = false; return; }
      if (f.next !== f.confirm) { errBox.textContent = 'Les deux mots de passe ne correspondent pas.'; errBox.hidden = false; return; }
      const btn = form.querySelector('[type=submit]');
      busy(btn, true, 'Enregistrement…');
      try {
        await api('/api/account/password', { method: 'POST', body: { current: f.current, next: f.next } });
        $modal.close();
        toast('Mot de passe modifié.');
      } catch (e) {
        busy(btn, false);
        errBox.textContent = e.message;
        errBox.hidden = false;
      }
    });
  });
}

// Proches : comptes et invitations (administrateur)
async function drawPeople(rid) {
  let data;
  try { data = await api('/api/admin/users'); } catch { return; }
  if (rid !== renderId) return;
  const box = $('#people');
  if (!box) return;
  const link = (code) => `${location.origin}/#/invite/${code}`;
  box.innerHTML = `
    <div class="section-head"><h2>Proches</h2><p>Invite des proches : chacun voit seulement les TV que tu lui partages.</p></div>
    <div class="panel">
      <form class="toolbar" id="invite-form" style="border-bottom:1px solid var(--line)">
        <input class="input grow" type="text" name="note" maxlength="60" placeholder="Pour qui ? (par exemple « Maman »)">
        <button class="btn sm primary" type="submit">${ic('plus')}Créer une invitation</button>
      </form>
      ${data.invites.length ? `<div class="app-group">Invitations en attente · valables 7 jours, une seule utilisation</div>
        ${data.invites.map((i) => `
          <div class="invite-row">
            <div style="min-width:0"><b>${esc(i.note || 'Invitation')}</b><div class="mono t2 invite-link">${esc(link(i.code))}</div><span class="sm t3">Expire le ${esc(fmtDate(i.expiresAt))}</span></div>
            <div class="form-row" style="gap:6px;flex-wrap:nowrap"><button class="btn sm" data-copy="${esc(link(i.code))}">${ic('copy')}Copier</button><button class="btn sm quiet" data-revoke="${esc(i.code)}">Annuler</button></div>
          </div>`).join('')}` : ''}
      <div class="app-group">Comptes · ${data.users.length}</div>
      ${data.users.map((u) => `
        <div class="invite-row">
          <div style="min-width:0"><b>${esc(u.name)}</b> <span class="mono t3">${esc(u.username)}</span>${u.twoFactor ? ' <span class="tag">2FA</span>' : ''}<div class="sm t3">${u.role === 'admin' ? 'Administrateur' : 'Invité'} · créé le ${esc(fmtDate(u.createdAt))}</div></div>
          ${u.id === S.user.id ? '<span class="sm t3">C’est toi</span>' : `<div class="form-row user-actions"><button class="btn sm" data-resetpwd="${esc(u.id)}" data-name="${esc(u.name)}">${ic('key')}${esc(T.rpwBtn)}</button>${u.twoFactor ? `<button class="btn sm quiet" data-reset2fa="${esc(u.id)}" data-name="${esc(u.name)}">Réinitialiser la 2FA</button>` : ''}<button class="btn sm danger" data-deluser="${esc(u.id)}" data-name="${esc(u.name)}">Supprimer</button></div>`}
        </div>`).join('')}
    </div>`;

  $('#invite-form', box).addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = ev.target.querySelector('[type=submit]');
    busy(btn, true, 'Création…');
    try {
      const r = await api('/api/admin/invites', { method: 'POST', body: { note: new FormData(ev.target).get('note') } });
      await copyText(link(r.invite.code), 'Invitation créée et lien copié : envoie-le à ton proche.');
      drawPeople(renderId);
    } catch (e) { toast(e.message, 'error'); busy(btn, false); }
  });
  $$('[data-copy]', box).forEach((b) => b.addEventListener('click', () => copyText(b.dataset.copy, 'Lien copié.')));
  $$('[data-revoke]', box).forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/admin/invites/${encodeURIComponent(b.dataset.revoke)}/revoke`, { method: 'POST' }); drawPeople(renderId); } catch (e) { toast(e.message, 'error'); }
  }));
  $$('[data-resetpwd]', box).forEach((b) => b.addEventListener('click', () => resetUserPassword(b.dataset.resetpwd, b.dataset.name)));
  $$('[data-reset2fa]', box).forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmBox({ title: `Réinitialiser la 2FA de ${b.dataset.name} ?`, html: '<p>À utiliser s’il a perdu son téléphone et ses codes de secours. Il se connectera avec son seul mot de passe et pourra réactiver la 2FA.</p>', confirm: 'Réinitialiser' }))) return;
    try { await api(`/api/admin/users/${encodeURIComponent(b.dataset.reset2fa)}/reset-2fa`, { method: 'POST' }); toast('Double authentification réinitialisée.'); drawPeople(renderId); } catch (e) { toast(e.message, 'error'); }
  }));
  $$('[data-deluser]', box).forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmBox({ title: `Supprimer le compte de ${b.dataset.name} ?`, html: '<p>Il ne pourra plus se connecter et perdra l’accès aux TV partagées. Les TV ne sont pas modifiées.</p>', confirm: 'Supprimer', danger: true }))) return;
    try { await api(`/api/admin/users/${encodeURIComponent(b.dataset.deluser)}/delete`, { method: 'POST' }); toast('Compte supprimé.'); drawPeople(renderId); } catch (e) { toast(e.message, 'error'); }
  }));
}

// Action administrateur sur un compte : route /api/admin/users/…, sinon /api/users/… (selon la version du serveur)
async function userAction(id, action) {
  const tail = `${encodeURIComponent(id)}/${action}`;
  try {
    return await api(`/api/admin/users/${tail}`, { method: 'POST' });
  } catch (e) {
    if (e.status === 404 && e.data && e.data.error === 'Route inconnue.') return api(`/api/users/${tail}`, { method: 'POST' });
    throw e;
  }
}

async function resetUserPassword(id, name) {
  if (!(await confirmBox({ title: T.rpwConfirmTitle(name), html: T.rpwConfirm(esc(name)), confirm: T.rpwConfirmBtn, danger: true }))) return;
  let r;
  try { r = await userAction(id, 'reset-password'); } catch (e) { toast(e.message, 'error'); return; }
  const msg = T.rpwMsg(location.origin, r.username, r.password);
  $modal.innerHTML = `
    <form method="dialog" class="dlg">
      <h2>${esc(T.rpwTitle)}</h2>
      <p>${esc(T.rpwLead(name))}</p>
      <div class="cred-box">
        <div class="cred-row"><span class="sm t3">${esc(T.rpwUser)}</span><span class="mono cred-val">${esc(r.username)}</span></div>
        <div class="cred-row"><span class="sm t3">${esc(T.rpwPwd)}</span><span class="mono cred-val">${esc(r.password)}</span></div>
      </div>
      <p class="sm t2">${esc(T.rpwMust)}</p>
      <div><button class="btn primary" type="button" id="rpw-copy">${ic('copy')}${esc(T.rpwCopy)}</button></div>
      ${r.twoFactor ? `<div class="note" id="rpw-tfa">${ic('alert')}<div class="stack"><span class="sm">${esc(T.rpwTfaNote)}</span><div><button class="btn sm" type="button" id="rpw-tfa-btn">${esc(T.rpwTfaBtn)}</button></div></div></div>` : ''}
      <div class="dlg-actions"><button class="btn" value="ok">${esc(T.rpwClose)}</button></div>
    </form>`;
  $modal.onclose = () => drawPeople(renderId);
  $modal.returnValue = '';
  $modal.showModal();
  $modal.querySelector('#rpw-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(msg); toast(T.rpwCopied); } catch {
      // Presse-papiers indisponible (HTTP) : on sélectionne le texte à copier à la main
      const ta = document.createElement('textarea');
      ta.className = 'input mono cred-text'; ta.readOnly = true; ta.rows = 5; ta.value = msg;
      $modal.querySelector('#rpw-copy').replaceWith(ta);
      ta.focus(); ta.select();
    }
  });
  $modal.querySelector('#rpw-tfa-btn')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    busy(btn, true, 'Réinitialisation…');
    try {
      await userAction(id, 'reset-2fa');
      $modal.querySelector('#rpw-tfa').innerHTML = `${ic('check')}<div class="sm">${esc(T.rpwTfaDone)}</div>`;
    } catch (e) {
      if (e.status === 404) { $modal.querySelector('#rpw-tfa').remove(); return; }
      busy(btn, false);
      toast(e.message, 'error');
    }
  });
}

async function drawAppsAdmin(rid) {
  let apps;
  try { apps = (await api('/api/apps')).apps; } catch { return; }
  if (rid !== renderId) return;
  const box = $('#apps-admin');
  if (!box) return;
  box.innerHTML = `
    <div class="section-head"><h2>Applis proposées</h2><p>Elles apparaissent sur la fiche de chaque TV, prêtes à installer.</p></div>
    <div class="panel">
      ${apps.map((a) => `
        <div class="invite-row">
          <div style="min-width:0"><b>${esc(a.name)}</b><div class="sm t3 mono" style="overflow-wrap:anywhere">${esc(a.apkUrl ? `APK : ${a.apkUrl}` : `Store : ${a.pkg}`)}${a.downloaderCode ? ` · Downloader ${esc(a.downloaderCode)}` : ''}</div></div>
          <button class="btn sm danger" data-app-del="${esc(a.id)}">Retirer</button>
        </div>`).join('')}
      <form id="app-form" class="panel-pad section" style="gap:12px;${apps.length ? 'border-top:1px solid var(--line)' : ''}">
        <div class="form-row">
          <label class="field">Nom<input class="input lg" name="name" maxlength="60" placeholder="Plex" required></label>
          <label class="field">Identifiant Play Store<input class="input lg mono" name="pkg" placeholder="com.plexapp.android"></label>
        </div>
        <label class="field">Description (optionnelle)<input class="input lg" name="desc" maxlength="200" placeholder="Pour regarder les films et séries du serveur"></label>
        <div class="form-row">
          <label class="field">Lien APK (optionnel)<input class="input lg mono" name="apkUrl" placeholder="https://…/appli.apk"></label>
          <label class="field narrow" style="flex-basis:160px">Code Downloader<input class="input lg mono" name="downloaderCode" inputmode="numeric" placeholder="12345"></label>
        </div>
        <p class="sm t3">Avec un lien APK, l'appli s'installe directement sur la TV. Sinon, sa fiche s'ouvre sur le store de la TV (Play Store, ou Appstore sur Fire TV) et il suffit de choisir « Installer ».</p>
        <div><button class="btn primary" type="submit">${ic('plus')}Ajouter l'appli</button></div>
      </form>
    </div>`;
  $('#app-form', box).addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = ev.target.querySelector('[type=submit]');
    busy(btn, true, 'Ajout…');
    try {
      await api('/api/admin/apps', { method: 'POST', body: Object.fromEntries(new FormData(ev.target)) });
      toast('Appli ajoutée.');
      drawAppsAdmin(renderId);
    } catch (e) { toast(e.message, 'error'); busy(btn, false); }
  });
  $$('[data-app-del]', box).forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/admin/apps/${encodeURIComponent(b.dataset.appDel)}/delete`, { method: 'POST' }); drawAppsAdmin(renderId); } catch (e) { toast(e.message, 'error'); }
  }));
}

async function copyText(text, okMsg) {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMsg);
  } catch {
    // Presse-papiers indisponible (HTTP sans HTTPS) : on affiche le lien à copier à la main
    await confirmBox({ title: 'Lien à envoyer', html: `<p>Copie ce lien et envoie-le :</p><input class="input lg mono" readonly value="${esc(text)}" onclick="this.select()">`, confirm: 'OK' });
  }
}

// Réglages : notifications Gotify et webhook (ni le jeton ni l'adresse du webhook ne sont renvoyés par le serveur)
function notifySection() {
  const n = (S.settings && S.settings.notify) || {};
  return `<section class="section" id="notify">
      <div class="section-head"><h2>${T.ntfTitle}</h2></div>
      <div class="panel">
        <form id="ntf-form" class="setting">
          <div>
            <div class="lbl">${ic('bell')}${T.ntfLbl} ${n.hasGotify ? `<span class="tag"><span class="dot ok"></span>${T.ntfOn}</span>` : ''}</div>
            <p class="desc">${T.ntfDesc}</p>
          </div>
          <div class="more">
            <div class="form-row">
              <label class="field">${T.ntfUrl}<input class="input lg mono" type="url" name="gotifyUrl" autocomplete="off" spellcheck="false" value="${esc(n.gotifyUrl || '')}" placeholder="https://gotify.exemple.fr"></label>
              <label class="field">${T.ntfToken}<input class="input lg mono" type="password" name="gotifyToken" autocomplete="new-password" spellcheck="false" placeholder="${n.hasGotify ? esc(T.ntfKeep) : 'A1b2C3d4E5f6G7h'}"></label>
            </div>
            <div class="form-row" style="gap:8px"><button class="btn sm primary" type="submit">${T.ntfSave}</button>${n.hasGotify ? `<button class="btn sm quiet" type="button" id="ntf-del">${T.ntfDel}</button>` : ''}</div>
          </div>
        </form>
        <form id="whk-form" class="setting">
          <div>
            <div class="lbl">${ic('link')}${T.whkLbl} ${n.hasWebhook ? `<span class="tag"><span class="dot ok"></span>${T.ntfOn}</span>` : ''}</div>
            <p class="desc">${T.whkDesc}</p>
          </div>
          <div class="more">
            <label class="field">${T.whkUrl}<input class="input lg mono" type="password" name="webhookUrl" autocomplete="off" spellcheck="false" placeholder="${n.hasWebhook ? esc(T.whkKeep) : 'http://192.168.1.10:8123/api/webhook/…'}"></label>
            <p class="sm t3">${T.whkHelp}</p>
            <div class="form-row" style="gap:8px"><button class="btn sm primary" type="submit">${T.ntfSave}</button>${n.hasWebhook ? `<button class="btn sm quiet" type="button" id="whk-del">${T.whkDel}</button>` : ''}</div>
          </div>
        </form>
        ${n.hasGotify || n.hasWebhook ? `<div class="setting">
          <div><div class="lbl">${ic('bell')}${T.ntfTestLbl}</div><p class="desc">${T.ntfTestDesc}</p>
            <ul class="ntf-results" id="ntf-results" aria-live="polite" hidden></ul></div>
          <button class="btn sm" type="button" id="ntf-test">${T.ntfTest}</button>
        </div>` : ''}
      </div>
    </section>`;
}

function bindNotify() {
  const form = $('#ntf-form');
  if (!form) return;
  const has = !!(S.settings.notify && S.settings.notify.hasGotify);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    const url = String(f.gotifyUrl || '').trim();
    const token = String(f.gotifyToken || '').trim();
    if (!url || (!has && !token)) { toast(T.ntfNeedUrl, 'error'); return; }
    const body = { notify: { gotifyUrl: url } };
    if (token) body.notify.gotifyToken = token;
    const btn = form.querySelector('[type=submit]');
    busy(btn, true, T.tsoCheckBusy);
    try {
      const r = await api('/api/settings', { method: 'POST', body });
      if (r.settings) S.settings = r.settings;
      toast(T.ntfSaved);
      viewSettings(renderId);
    } catch (e) { toast(e.message, 'error'); busy(btn, false); }
  });
  $('#ntf-test')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    busy(btn, true, T.ntfTestBusy);
    const out = $('#ntf-results');
    try {
      const r = await api('/api/notify/test', { method: 'POST' });
      const rows = [['gotify', T.ntfLbl], ['webhook', T.whkLbl]].map(([k, label]) => {
        const v = Object.prototype.hasOwnProperty.call(T.ntfRes, r[k]) ? r[k] : 'erreur';
        return `<li><span class="dot ${T.ntfResDot[v]}"></span><span><b>${esc(label)}</b> : ${esc(T.ntfRes[v])}</span></li>`;
      });
      out.innerHTML = rows.join('');
      out.hidden = false;
      if (r.gotify === 'ok' || r.webhook === 'ok') toast(T.ntfTestOk);
    } catch (e) { toast(e.message, 'error'); }
    busy(btn, false);
  });
  const whk = $('#whk-form');
  whk?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const url = String(new FormData(whk).get('webhookUrl') || '').trim();
    if (!url) { toast(T.whkNeed, 'error'); return; }
    const btn = whk.querySelector('[type=submit]');
    busy(btn, true, T.tsoCheckBusy);
    try {
      const r = await api('/api/settings', { method: 'POST', body: { notify: { webhookUrl: url } } });
      if (r.settings) S.settings = r.settings;
      toast(T.whkSaved);
      viewSettings(renderId);
    } catch (e) { toast(e.message, 'error'); busy(btn, false); }
  });
  $('#whk-del')?.addEventListener('click', async () => {
    try {
      const r = await api('/api/settings', { method: 'POST', body: { notify: { webhookUrl: '' } } });
      if (r.settings) S.settings = r.settings;
      toast(T.whkDeleted);
      viewSettings(renderId);
    } catch (e) { toast(e.message, 'error'); }
  });
  $('#ntf-del')?.addEventListener('click', async () => {
    try {
      const r = await api('/api/settings', { method: 'POST', body: { notify: { gotifyUrl: '', gotifyToken: '' } } });
      if (r.settings) S.settings = r.settings;
      toast(T.ntfDeleted);
      viewSettings(renderId);
    } catch (e) { toast(e.message, 'error'); }
  });
}

async function viewSettings(rid) {
  await loadState();
  if (rid !== renderId) return;
  if (!isAdmin()) {
    $app.innerHTML = `<div class="page-head"><div class="lead"><h1>Compte</h1></div></div>${accountSection()}<p class="sm t3 credit-line">${cytCredit()}</p>`;
    bindAccount();
    return;
  }
  const ts = S.settings.tailscale.enabled;
  $app.innerHTML = `
    <div class="page-head"><div class="lead"><h1>Réglages</h1><p class="t2 sm">Les options avancées sont désactivées par défaut.</p></div></div>

    <section class="section">
      <div class="section-head"><h2>Options</h2></div>
      <div class="panel">
        <div class="setting">
          <div>
            <div class="lbl">Accès à distance avec Tailscale <span class="tag">Avancé</span></div>
            <p class="desc">Gérer une TV qui n'est pas chez toi : parents, résidence secondaire…</p>
          </div>
          <div class="toggle"><input type="checkbox" id="ts-toggle" aria-label="Activer Tailscale" ${ts ? 'checked' : ''}><span></span></div>
          <div class="more">
            <div class="note warn">${ic('alert')}<div><b>Réservé aux personnes qui savent configurer Tailscale.</b> Mal réglé, il peut exposer ta TV ou ton réseau. Pour la TV de ton salon, tu n'en as pas besoin.</div></div>
            ${ts ? '' : `<label class="check"><input type="checkbox" id="ts-ack"><span>J'ai compris, je sais configurer Tailscale.</span></label>`}
            <div id="ts-status"></div>
            ${ts ? `<form id="ts-api" class="section" style="gap:10px">
              <div class="form-row">
                <label class="field">Clé API Tailscale (optionnelle)<input class="input lg mono" type="password" name="apiKey" autocomplete="off" placeholder="${S.settings.tailscale.hasApiKey ? 'Clé enregistrée, laisse vide pour la garder' : 'tskey-api-…'}"></label>
                <label class="field narrow" style="flex-basis:150px">Étiquette<input class="input lg mono" type="text" name="tag" value="${esc(S.settings.tailscale.tag || 'tag:tvbox')}"></label>
              </div>
              <p class="sm t3">Sert au bouton « Isoler » des TV Tailscale : pose l'étiquette et désactive l'expiration de la clé. À créer dans la console Tailscale (Settings › Keys), elle reste sur ce serveur.</p>
              <div class="form-row" style="gap:8px"><button class="btn sm primary" type="submit">Enregistrer</button>${S.settings.tailscale.hasApiKey ? '<button class="btn sm quiet" type="button" id="ts-api-del">Supprimer la clé</button>' : ''}</div>
            </form>
            <form id="ts-oauth" class="section ts-oauth" style="gap:10px">
              <div class="lbl">${T.tsoTitle} ${S.settings.tailscale.hasOAuth ? `<span class="tag"><span class="dot ok"></span>${T.tsoOn}</span>` : ''}</div>
              <p class="sm t3">${T.tsoHelp}</p>
              <div class="form-row">
                <label class="field">${T.tsoId}<input class="input lg mono" type="text" name="oauthClientId" autocomplete="off" spellcheck="false" value="${esc(S.settings.tailscale.oauthClientId || '')}" placeholder="${S.settings.tailscale.hasOAuth ? esc(T.tsoKeepId) : 'k123AbCdEf'}"></label>
                <label class="field">${T.tsoSecret}<input class="input lg mono" type="password" name="oauthClientSecret" autocomplete="new-password" spellcheck="false" placeholder="${S.settings.tailscale.hasOAuth ? esc(T.tsoKeep) : 'tskey-client-…'}"></label>
              </div>
              <div class="form-row" style="gap:8px"><button class="btn sm primary" type="submit">${T.tsoSave}</button>${S.settings.tailscale.hasOAuth ? `<button class="btn sm" type="button" id="ts-check">${ic('shield')}${T.tsoCheck}</button><button class="btn sm quiet" type="button" id="ts-oauth-del">${T.tsoDel}</button>` : ''}</div>
              <div id="ts-check-out"></div>
            </form>` : ''}
          </div>
        </div>
        <details class="disclose">
          <summary>${ic('chevron')}Comment utiliser Tailscale</summary>
          <div class="body">
            <ol>
              <li><b>C'est quoi ?</b> Un réseau privé entre tes appareils, comme un câble invisible entre ATV Manager et une TV ailleurs.</li>
              <li><b>Ce qu'il faut :</b> un compte Tailscale gratuit, Tailscale connecté sur la machine qui fait tourner ATV Manager, et l'appli Tailscale sur la TV (Play Store).</li>
              <li><b>Connecter la TV :</b> sur place, une fois, connecte Tailscale sur la TV avec le même compte et active le débogage.</li>
              <li><b>La sécuriser :</b> dans la console Tailscale, mets une étiquette à la TV (<span class="mono">tag:tv</span>), écris une règle d'accès pour qu'elle ne voie que toi, et désactive l'expiration de la clé.</li>
              <li><b>Dans ATV Manager :</b> lance la recherche. Les TV Tailscale sont signalées « via Tailscale », et celles sans étiquette sont repérées.</li>
            </ol>
          </div>
        </details>
        <div class="setting" style="border-top:1px solid var(--line)">
          <div>
            <div class="lbl">Agent IA <span class="tag">Bientôt</span></div>
            <p class="desc">Un assistant qui explique ce qu'il voit sur ta TV et propose des optimisations. Il restera désactivé par défaut : tu brancheras <b>ton propre agent</b> (MCP) ou un service compatible OpenAI (Ollama, LM Studio…). Aucune clé n'est fournie, et chaque action demandera ta confirmation.</p>
          </div>
          <div class="toggle"><input type="checkbox" disabled aria-label="Agent IA, bientôt disponible"><span></span></div>
        </div>
      </div>
    </section>

    ${notifySection()}

    <section class="section" id="people"></section>
    <section class="section" id="apps-admin"></section>

    ${accountSection()}

    <section class="section">
      <div class="section-head"><h2>Informations</h2></div>
      <div class="panel">
        <div class="setting"><div><div class="lbl">Sécurité</div><p class="desc">ATV Manager peut modifier des TV. Si tu l'ouvres sur internet, passe par HTTPS (reverse proxy) et n'envoie les invitations qu'à des personnes de confiance.</p></div></div>
        <table class="table" style="border-top:1px solid var(--line)">
          <tr><td class="t3" style="width:40%">Version</td><td class="mono">${esc(S.version)}</td></tr>
          <tr><td class="t3">TV enregistrées</td><td class="num">${S.devices.length}</td></tr>
          <tr><td class="t3">Crédits</td><td class="sm">${cytCredit()}</td></tr>
        </table>
      </div>
    </section>`;

  bindAccount();
  drawPeople(rid);
  drawAppsAdmin(rid);
  bindNotify();
  $('#ts-api')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.target));
    const body = { tailscale: { tag: f.tag } };
    if (f.apiKey.trim()) body.tailscale.apiKey = f.apiKey.trim();
    const btn = ev.target.querySelector('[type=submit]');
    busy(btn, true, 'Vérification…');
    try {
      const r = await api('/api/settings', { method: 'POST', body });
      S.settings = r.settings;
      toast(body.tailscale.apiKey ? 'Clé API vérifiée et enregistrée.' : 'Réglages enregistrés.');
      viewSettings(renderId);
    } catch (e) { toast(e.message, 'error'); busy(btn, false); }
  });
  $('#ts-oauth')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.target));
    const body = { tailscale: {} };
    if (f.oauthClientId.trim()) body.tailscale.oauthClientId = f.oauthClientId.trim();
    if (f.oauthClientSecret.trim()) body.tailscale.oauthClientSecret = f.oauthClientSecret.trim();
    if (!Object.keys(body.tailscale).length) return;
    const btn = ev.target.querySelector('[type=submit]');
    busy(btn, true, T.tsoCheckBusy);
    try {
      const r = await api('/api/settings', { method: 'POST', body });
      S.settings = r.settings;
      toast(T.tsoSaved);
      viewSettings(renderId);
    } catch (e) { toast(e.message, 'error'); busy(btn, false); }
  });
  $('#ts-oauth-del')?.addEventListener('click', async () => {
    try { const r = await api('/api/settings', { method: 'POST', body: { tailscale: { oauthClientId: '', oauthClientSecret: '' } } }); S.settings = r.settings; toast(T.tsoDeleted); viewSettings(renderId); } catch (e) { toast(e.message, 'error'); }
  });
  $('#ts-check')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    const out = $('#ts-check-out');
    busy(btn, true, T.tsoCheckBusy);
    try {
      const r = await api('/api/tailscale/check');
      const w = Array.isArray(r.warnings) ? r.warnings : [];
      out.innerHTML = r.ok && !w.length
        ? `<div class="note">${ic('check')}<div>${T.tsoCheckOk}</div></div>`
        : `<div class="note attn">${ic('alert')}<div class="stack"><b>${T.tsoCheckKo}</b>${w.length ? `<ul class="ts-warn">${w.map((x) => `<li>${esc(typeof x === 'string' ? x : x && x.message)}</li>`).join('')}</ul>` : ''}</div></div>`;
    } catch (e) { out.innerHTML = `<div class="note warn">${ic('alert')}<div>${esc(e.message)}</div></div>`; }
    busy(btn, false);
  });
  $('#ts-api-del')?.addEventListener('click', async () => {
    try { const r = await api('/api/settings', { method: 'POST', body: { tailscale: { apiKey: '' } } }); S.settings = r.settings; toast('Clé API supprimée.'); viewSettings(renderId); } catch (e) { toast(e.message, 'error'); }
  });
  const toggle = $('#ts-toggle');
  const status = (t) => {
    const box = $('#ts-status');
    if (!box || !t) return;
    box.innerHTML = t.ok
      ? `<div class="note">${ic('check')}<div>Tailscale est connecté : ${`${plural(t.peers, 'appareil')} Android`} sur ton réseau Tailscale.${t.untagged ? ` <b>${t.untagged} sans étiquette</b> : ${t.untagged > 1 ? 'ils peuvent' : 'il peut'} voir tout ton réseau Tailscale.` : ''}</div></div>`
      : `<div class="note attn">${ic('info')}<div>${esc(t.message)} Ouvre le guide ci-dessous.</div></div>`;
  };
  toggle.addEventListener('change', async () => {
    const want = toggle.checked;
    if (want && !$('#ts-ack')?.checked) {
      toggle.checked = false;
      toast("Coche d'abord « J'ai compris ».", 'error');
      return;
    }
    toggle.disabled = true;
    try {
      const r = await api('/api/settings', { method: 'POST', body: { tailscale: { enabled: want } } });
      S.settings = r.settings;
      toast(want ? 'Tailscale activé.' : 'Tailscale désactivé.');
      await viewSettings(renderId);
      if (want) status(r.tailscale);
    } catch (e) {
      toggle.checked = !want;
      toggle.disabled = false;
      toast(e.message, 'error');
    }
  });
  if (ts) api('/api/settings', { method: 'POST', body: {} }).then((r) => status(r.tailscale)).catch(() => {});
}

render();
