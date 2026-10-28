# ATV Manager

Optimise et allège ton **Android TV** depuis un navigateur : PC, Android ou iPhone.

> **Uniquement pour les TV et boîtiers Android TV / Google TV.**
> Pas compatible avec **Tizen** (Samsung), **webOS** (LG) ni **VIDAA** (Hisense, certaines Toshiba).
> Certaines marques vendent les deux systèmes : vérifie celui de ta TV. Sur une TV incompatible, un boîtier ou une clé Android TV fonctionne.

## Fonctionnalités

- **Guide de connexion** pas à pas (mode développeur, débogage) selon le type de TV.
- **Recherche automatique** des TV sur le réseau local. Une TV reste reconnue même quand son adresse IP change.
- **Noms clairs** pour chaque appareil (marque, modèle, nom personnalisé).
- **Optimisation en 3 niveaux**, avec les gains et les pertes affichés avant d'appliquer :
  - **N1 léger** : animations accélérées, caches vidés, applis en arrière-plan fermées, télémétrie coupée ;
  - **N2 moyen** : N1 + désactivation des applis inutiles (mode recommandé ou manuel, niveau de risque pour chaque appli) ;
  - **N3 avancé** : N2 + changement de lanceur.
- **Contrôle de l'optimisation** : ATV Manager lit l'état réel de chaque TV (même optimisée ailleurs), affiche le niveau atteint et propose la prochaine amélioration possible.
- **Tout est réversible** : les applis sont désactivées pour l'utilisateur (`pm disable-user`), jamais supprimées. On peut annuler une optimisation ou réactiver une seule appli depuis l'historique.
- **Comptes** : le premier compte créé est administrateur. Il invite des proches avec un lien à usage unique et choisit les TV que chacun peut voir et optimiser.
- **Double authentification optionnelle** (TOTP : Google Authenticator, 2FAS, Aegis…) avec codes de secours. L'administrateur peut la réinitialiser si un proche perd son téléphone.
- **Options désactivées par défaut** : accès à distance par Tailscale (réservé aux utilisateurs avertis) et agent IA (prochaine version, avec ton propre agent : aucune clé n'est fournie).

## Comment ça marche

ATV Manager parle aux TV avec **ADB**, sur le réseau local. Le serveur doit donc tourner **chez toi**, sur le même réseau que tes TV : un NAS, un mini-PC, un Raspberry Pi ou ton PC. L'interface s'ouvre ensuite depuis n'importe quel navigateur (PC, Android, iPhone).

Pour gérer la TV d'un proche à distance, deux possibilités : l'appli **ATVM Connect** (la plus simple, voir plus bas), ou faire rejoindre à sa TV ton réseau **Tailscale**. Tailscale est **obligatoire pour les Fire TV récentes (Fire OS 8)**, sur lesquelles ATVM Connect ne peut pas fonctionner.


## Accès à distance par Tailscale (obligatoire pour les Fire TV Fire OS 8)

[Tailscale](https://tailscale.com) crée un réseau privé chiffré entre ton serveur et les TV de tes proches, sans ouvrir de port sur leur box. Le serveur joint alors la TV comme si elle était chez toi. L'offre gratuite (Personal) suffit. Chaque personne qui héberge son propre ATV Manager crée **son propre** réseau Tailscale.

**1. Le serveur**
1. Crée un compte sur tailscale.com, puis installe Tailscale sur la machine qui fait tourner ATV Manager (sur Unraid : plugin Tailscale ; sur Linux : `curl -fsSL https://tailscale.com/install.sh | sh` puis `tailscale up`).
2. En Docker, monte le socket du démon : `-v /var/run/tailscale:/var/run/tailscale:ro`.
3. Dans ATV Manager, **Réglages → Accès à distance par Tailscale** : active l'option. L'étiquette par défaut des TV est `tag:tvbox`.

**2. Les règles d'accès (à faire une fois)**

Dans la console Tailscale, onglet **Access controls**, isole les TV : elles ne doivent rien pouvoir joindre, et seul le serveur doit pouvoir joindre leur port ADB. Exemple, si ton serveur porte l'étiquette `tag:atvm` :

```json
{
  "tagOwners": {
    "tag:tvbox": ["autogroup:admin"],
    "tag:atvm":  ["autogroup:admin"]
  },
  "grants": [
    { "src": ["autogroup:member"], "dst": ["*"], "ip": ["*"] },
    { "src": ["tag:atvm"], "dst": ["tag:tvbox"], "ip": ["tcp:5555"] }
  ]
}
```

Aucune règle n'a `tag:tvbox` en source : une TV ne peut donc rien ouvrir sur ton réseau, même si elle est compromise. Adapte la première ligne à tes propres règles.

**3. Chaque TV (Fire TV ou autre)**
1. Dans la console Tailscale, **Settings → Keys → Generate auth key** : coche **Pre-approved** et **Tags → `tag:tvbox`**. La clé peut servir une seule fois ou plusieurs fois.
2. Sur la TV, active le mode développeur et le débogage (guide « Connecter une TV » dans l'appli), puis installe **Tailscale** depuis l'Amazon Appstore ou le Play Store.
3. Dans Tailscale, menu **⋮ → Use an auth key** (ou « Utiliser une clé d'authentification ») : colle la clé. Tu peux aussi te connecter avec ton compte puis appliquer l'étiquette `tag:tvbox` dans la console.
4. Dans la console, sur la nouvelle machine : **Disable key expiry**, pour qu'elle ne se déconnecte pas au bout de 6 mois.
5. Dans ATV Manager, lance **Rechercher** : la TV apparaît avec la mention « via Tailscale ». Accepte « Autoriser le débogage ? » sur la TV (cochée « Toujours autoriser »).

Ensuite, la TV reste joignable tant qu'elle est allumée et que Tailscale tourne (l'appli démarre toute seule avec la TV).


## Gérer une TV à distance avec ATVM Connect

Pour une TV qui n'est pas sur le même réseau que le serveur (par exemple chez un proche), l'appli **ATVM Connect** s'installe sur la TV et ouvre une connexion **sortante** vers ATV Manager. Il n'y a aucun port à ouvrir sur la box et pas besoin de Tailscale.

1. Installe ATVM Connect avec l'appli **Downloader** : tape l'adresse de ton ATV Manager suivie de `/connect.apk` (par exemple `atvm.exemple.fr/connect.apk`).
2. Ouvre ATVM Connect : elle vérifie le mode développeur et le débogage, ouvre directement le bon écran des paramètres et explique quoi faire. Une appli ne peut pas activer le débogage elle-même (Android le réserve au système).
3. ATVM Connect se connecte à l'ADB local de la TV, ce qui fait apparaître « Autoriser le débogage ? » : coche « Toujours autoriser » et accepte. L'appli vérifie que l'accès fonctionne avant de passer à la suite.
4. Dans ATV Manager, ouvre « Ajouter à distance » et génère un code à 6 chiffres, puis entre-le dans ATVM Connect.

Aucune adresse n'est à taper : c'est le serveur qui a généré le code qui l'accepte. L'appli essaie d'abord le serveur fixé à la compilation (variable de dépôt `ATVM_DEFAULT_SERVER`, pour les TV à distance), puis cherche ATV Manager sur le réseau local (port 8420).

La TV apparaît dans la liste de la personne qui a généré le code. ATVM Connect exécute uniquement les actions lancées depuis ATV Manager, via l'ADB local de la TV (`127.0.0.1:5555`). On peut la retirer à tout moment depuis la fiche de la TV.

**Fire TV sous Fire OS 8 (Fire TV Stick 4K / 4K Max récents, Fire TV Cube 3e génération…) : ATVM Connect ne fonctionne pas.** Amazon bloque toute connexion ADB qui part de la TV elle-même (`127.0.0.1` comme l'adresse Wi-Fi de la TV) : la fenêtre « Autoriser le débogage ? » ne s'affiche jamais. Vérifié sur un Fire TV Stick 4K Max (Fire OS 8.1.8.5) : la TV répond à une connexion venue d'un autre appareil du réseau, jamais à elle-même. Pour ces modèles, la connexion doit venir **d'une autre machine** :

- **chez toi** : le serveur ATV Manager (NAS, mini-PC…) sur le même réseau que la Fire TV, avec « Rechercher » ou l'ajout par adresse IP ;
- **chez un proche** : la Fire TV rejoint ton réseau **Tailscale** (appli Tailscale de l'Amazon Appstore), et le serveur s'y connecte comme une TV du réseau local.

Les autres Android TV et Google TV ne sont pas concernées.

**Mise à jour automatique** (ATVM Connect 0.10.0 et plus) : à chaque connexion, puis toutes les 6 heures, le serveur compare la version de l’appli avec la dernière disponible. Si elle est plus ancienne, la TV télécharge `/connect.apk` et s’installe elle-même par son ADB local, sans rien demander, puis redémarre. Version proposée : celle indiquée dans `data/connect.json` (`{"version": "0.10.0"}`) quand une APK est posée dans `data/connect.apk`, sinon la dernière release GitHub. La nouvelle APK doit être signée avec la même clé.

Le code source de l'appli est dans `agent/` (Kotlin). L'APK est compilée par GitHub Actions : un tag `connect-vX.Y.Z` publie une release. Pour signer tes propres versions, ajoute les secrets `ATVM_KEYSTORE_B64` (PKCS12 en base64, alias `atvm`) et `ATVM_KEYSTORE_PASSWORD`.

## Lancer avec Docker

```bash
git clone https://github.com/BenRlc18/atv-manager.git
cd atv-manager
docker build -t atv-manager .
docker run -d --name atv-manager --network host \
  -v /chemin/vers/data:/data \
  --restart unless-stopped atv-manager
```

Ouvre ensuite `http://IP-DE-LA-MACHINE:8420` et **crée tout de suite le compte administrateur** : tant qu'il n'existe pas, la première personne qui ouvre la page peut le créer.

`--network host` est nécessaire pour que la recherche voie les TV du réseau local. Le dossier `data` doit appartenir à l'utilisateur 1000 (celui du conteneur).

Sur iPhone et Android, « Ajouter à l'écran d'accueil » l'installe comme une appli.

### Variables d'environnement

| Variable | Rôle | Défaut |
|---|---|---|
| `PORT` | Port de l'interface | `8420` |
| `SCAN_SUBNETS` | Réseaux à scanner, par exemple `192.168.1.0/24` | détection automatique |
| `ANDROID_ADB_SERVER_PORT` | Port du serveur ADB interne (5038 dans l'image Docker, pour ne pas entrer en conflit avec un autre adb) | `5037` |
| `AGENT_APK_URL` | Lien de l'APK ATVM Connect si aucune APK n'est posée dans `data/connect.apk` | release GitHub publique |
| `DOWNLOADER_CODE` | Code court Downloader (go.aftvnews.com) affiché pour installer ATVM Connect | aucun |
| `TAILSCALE_SOCKET` | Socket du démon Tailscale (option Tailscale) | `/var/run/tailscale/tailscaled.sock` |

Pour l'option Tailscale en Docker, monte le socket : `-v /var/run/tailscale:/var/run/tailscale:ro`.

## Lancer sans Docker

Il faut Node.js 18 ou plus et `adb` (Android platform-tools) dans le PATH.

```bash
npm start
```

## Sécurité

- ATV Manager peut modifier des TV. Si tu l'ouvres sur internet, passe par un reverse proxy en **HTTPS**.
- L'inscription se fait uniquement par invitation (lien valable 7 jours, une seule utilisation).
- Mots de passe de 8 caractères minimum avec 1 lettre, 1 chiffre et 1 caractère spécial, hachés (scrypt), les sessions sont des cookies `HttpOnly`, et les tentatives de connexion sont limitées.
- Double authentification optionnelle pour chaque compte, avec 8 codes de secours à usage unique.
- Un invité ne voit que les TV que l'administrateur lui a partagées. Il ne peut ni scanner le réseau ni ajouter d'appareil.

## Contribuer au catalogue

Les applis proposées au niveau 2 sont dans `server/catalog.json`, avec un niveau de risque, la raison et ce qu'on perd. Les applis essentielles sont dans `protected` et ne peuvent pas être désactivées.

## Licence

MIT

## Crédits / Sources tierces

- Les listes de paquets par modèle proviennent du projet **CleanYourTV** de Gathin (https://github.com/Gathin23/cleanyourtv), licence MIT. Elles sont importées dans `server/cleanyourtv.json` par `node tools/import-cleanyourtv.js <clone de CleanYourTV>` (projet, commit et date d'import sont notés dans le fichier) ; la licence d'origine est reprise dans `server/third_party/cleanyourtv-LICENSE`.
- ATV Manager s'en sert pour reconnaître le modèle de la TV et suggérer, au niveau 2, des applis absentes de son propre catalogue. Ces suggestions portent la mention « CleanYourTV » et la note d'origine (en anglais). Le catalogue d'ATV Manager reste prioritaire, et les applis que CleanYourTV garde sur un modèle ne sont jamais proposées pour ce modèle.

## APK personnalisée pour ton serveur

L'APK publique est **générique** : elle trouve ATV Manager sur le réseau local, ou demande l'adresse du serveur. Pour que tes proches n'aient **que le code à taper**, compile ta propre APK avec ton serveur intégré (variable de dépôt `ATVM_DEFAULT_SERVER`, par exemple dans un dépôt privé) et dépose-la dans `data/connect.apk` : ATV Manager la sert alors sur `/connect.apk`. Signe-la avec la même clé que l'APK publique pour pouvoir passer de l'une à l'autre sans désinstaller.

## Dépannage à distance

Sur la fiche d’une TV, « Dépannage à distance » affiche son écran en direct et une télécommande (croix, OK, retour, accueil, volume, saisie de texte, appui à l’écran). Ça marche en ADB direct (réseau local, Tailscale) comme à travers ATVM Connect.

- **Vidéo** : ATV Manager envoie [scrcpy-server](https://github.com/Genymobile/scrcpy) 3.1 (Apache 2.0, dans `server/vendor/`) sur la TV et relaie son flux H.264, décodé par le navigateur (WebCodecs, donc en https ou sur localhost). Environ 20 images/s pour 1 à 3 Mbit/s.
- **Images** : à défaut, une capture d’écran après l’autre (réduite en JPEG par ATVM Connect).
- **Bandeau** : tant que la page est ouverte, la TV affiche « Accès à distance : dépannage en cours » (ATVM Connect 0.11.0 et plus ; sur une TV en ADB direct, ATV Manager installe ATVM Connect pour l’afficher). Il disparaît seul 90 s après la fermeture de la page.
- Les applis protégées (Netflix, Disney+…) apparaissent en noir : c’est voulu par Android.
