# Trans-Hub Localizer

**Retrouvez les extensions communautaires Obsidian dans votre langue.**

[English](../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · **Français** · [Español](README.es.md) · [Português (Brasil)](README.pt-BR.md) · [Русский](README.ru.md)

[![Release](https://img.shields.io/github/v/release/SakenW/trans-hub-obsidian-localizer)](https://github.com/SakenW/trans-hub-obsidian-localizer/releases) · **Ordinateur et mobile** · **Aucun modèle d’IA ni clé API à configurer**

Trans-Hub Localizer est une extension Obsidian qui traduit et localise les interfaces des extensions communautaires. Elle préserve les traductions intégrées détectées, complète les textes manquants grâce aux traductions partagées et synchronise automatiquement les mises à jour publiées. Par défaut, les traductions sont appliquées à l’exécution, sans modifier les fichiers des extensions. Vos notes ne sont ni traduites ni téléversées.

[Installer dans Obsidian](obsidian://show-plugin?id=trans-hub-plugin-localizer) · [Suivre la localisation](https://trans-hub.net/ecosystems/obsidian) · [Retours et communauté](https://github.com/SakenW/Trans-Hub/discussions)

<!-- section: getting-started -->
## Premiers pas

Vous avez besoin d’**Obsidian 1.11.4 ou ultérieur**, d’un compte Trans-Hub et d’une connexion réseau pour l’autorisation et la synchronisation. Les ordinateurs et appareils mobiles sont pris en charge ; les correctifs avancés de compatibilité des fichiers sont réservés à la version de bureau.

1. Installez et activez **Trans-Hub Localizer** dans **Paramètres → Extensions communautaires**.
2. Ouvrez ses paramètres et connectez votre compte Trans-Hub. Aucun modèle d’IA, compte de fournisseur de modèles ou clé API n’est à configurer.
3. Confirmez la langue cible. Les extensions communautaires activées sont détectées automatiquement ; vous pouvez exclure celles que vous ne souhaitez pas localiser.

Les traductions déjà publiées sont réutilisées. Les contenus manquants font automatiquement l’objet d’une demande de localisation, puis sont synchronisés après traitement en arrière-plan et publication. Le texte peut rester dans sa langue d’origine pendant le traitement, la publication ou les vérifications de compatibilité.

Pour une installation manuelle, téléchargez `main.js`, `manifest.json` et `styles.css` depuis la même [version GitHub](https://github.com/SakenW/trans-hub-obsidian-localizer/releases), puis placez-les dans `<vault-config-dir>/plugins/trans-hub-plugin-localizer/`. Ne mélangez pas les fichiers de versions différentes.

<!-- section: use-cases -->
## Dans quels cas l’utiliser

- Traduire les paramètres, commandes et interfaces des extensions communautaires dans votre langue.
- Réutiliser des traductions partagées sans configurer vous-même un modèle d’IA ou une clé API.
- Utiliser la même solution sur ordinateur et téléphone, avec vérification automatique de la compatibilité des traductions après les mises à jour des extensions.

<!-- section: capabilities -->
## Fonctionnalités

| Fonctionnalité | Comportement |
| --- | --- |
| Priorité aux traductions intégrées | Préserve les traductions détectées dans l’extension installée et complète les textes manquants. Seules des corrections explicitement révisées peuvent remplacer le texte intégré correspondant. |
| Traductions partagées | Les utilisateurs réutilisent les résultats publiés ; les contenus manquants suivent le processus commun de localisation. |
| Synchronisation automatique | Au démarrage, restaure d’abord les traductions validées en cache, puis recherche des mises à jour pendant l’exécution. Les nouvelles traductions nécessitent une connexion réseau. |
| Réutilisation compatible après mise à jour | Les traductions à l’exécution peuvent être réutilisées entre versions si chaque entrée passe les vérifications de compatibilité. Les entrées ambiguës ou incompatibles sont ignorées. |
| Textes d’interface | Prend en charge les noms, descriptions, paramètres, boutons, commandes, notifications, options, infobulles, indications de saisie, libellés d’accessibilité et certains textes dynamiques identifiables sans risque. |
| README des extensions | Les textes pris en charge sur la page de détails d’une extension communautaire peuvent être localisés si des traductions README publiées correspondantes sont disponibles. Leur couverture est comptabilisée séparément de celle de l’interface principale. |

Selon le contexte, les vérifications portent sur l’identité de la source, la portée, le rôle sémantique, le format et les paramètres dynamiques. La traduction intégrale de toutes les interfaces de toutes les extensions n’est pas garantie.

<!-- section: languages -->
## Toutes les langues, au-delà des choix prédéfinis

Choisissez une langue courante ou saisissez un autre identifiant de langue en conservant les variantes régionales et d’écriture. La disponibilité des traductions dépend de l’état de traitement et de publication du contenu demandé.

Les choix rapides comprennent le **chinois simplifié, le chinois traditionnel, l’anglais, le japonais, le coréen, l’allemand, le français, l’espagnol, le portugais brésilien et le russe**. Vous pouvez aussi demander, par exemple, l’italien (`it`), l’arabe (`ar`), l’ukrainien (`uk`) ou le serbe en alphabet latin (`sr-Latn`). La disponibilité et la qualité des traductions dépendent des résultats publiés et des services de traitement disponibles pour la langue demandée.

Il s’agit des **langues de traduction des autres extensions**. Les paramètres du Localizer lui-même sont actuellement disponibles en chinois simplifié et en anglais ; les autres langues utilisent l’anglais. Les liens en haut de page changent uniquement la langue de ce README.

<!-- section: quality -->
## Qualité et périmètre

Cette extension cible les interfaces des extensions communautaires. Elle ne traduit ni les notes ni les pages web et n’effectue pas de traduction LLM en temps réel sur votre appareil.

La plupart des traductions Trans-Hub sont actuellement générées automatiquement et n’ont pas été relues par une personne. L’extension distingue la provenance des traductions et leur statut de révision. La validation de la source et de la compatibilité ne signifie pas que l’exactitude linguistique a été vérifiée par une personne.

Ce processus concerne les extensions communautaires dont l’identité et la version peuvent être vérifiées dans le répertoire officiel Obsidian et auprès de sources originales fiables. Une installation via BRAT, une extension privée ou des modifications locales arbitraires ne bénéficient pas automatiquement d’une garantie de compatibilité. Le processus actuel utilise l’anglais comme langue source.

Les éditeurs Markdown et vues de lecture des notes, le code, les scripts et les contenus modifiables sont exclus. La localisation des README se limite à la page de détails des extensions communautaires ; elle n’active pas la traduction de vos notes.

<!-- section: privacy -->
## Confidentialité et correctifs de fichiers facultatifs

- L’analyse locale identifie les versions des extensions et les textes d’interface pris en charge. Les textes analysés et les notes ne sont pas téléversés.
- Les requêtes contiennent l’identité de l’extension, sa version, la langue cible, des décomptes de couverture et des empreintes cryptographiques. L’autorisation du compte et le téléchargement des traductions nécessitent un accès réseau.
- Les identifiants utilisent le stockage sécurisé d’Obsidian. Consultez la [politique de confidentialité](https://trans-hub.net/zh-CN/legal/privacy) pour le traitement côté serveur.
- Par défaut, la localisation à l’exécution ne modifie aucun fichier d’extension. Sa désactivation restaure les textes qui correspondent encore à la valeur traduite et préserve les modifications ultérieures apportées par d’autres extensions.

**Le mode de compatibilité avancé est réservé aux ordinateurs et désactivé par défaut.** Vous devez appliquer explicitement un correctif à chaque extension admissible. Il ne modifie que des textes d’interface statiques validés, liés à la version et à l’artefact exacts, après enregistrement d’une sauvegarde et d’un justificatif. La restauration n’a lieu que si le fichier correspond encore à l’empreinte obtenue après le correctif. Les mises à jour et modifications externes sont préservées et signalées comme conflits. Rechargez l’extension concernée après application ou restauration d’un correctif. Les notes ne sont jamais modifiées par ces correctifs.

<!-- section: faq -->
## Questions fréquentes

**Faut-il une clé API ?** Non. Connectez un compte Trans-Hub ; aucun modèle ni clé API n’est à configurer.

**Cela fonctionne-t-il sur téléphone ?** Oui, la localisation à l’exécution prend en charge les appareils mobiles et les ordinateurs. Les correctifs de fichiers sont uniquement disponibles sur ordinateur.

**Pourquoi certains textes restent-ils non traduits ?** La traduction peut être en attente, la source impossible à vérifier ou l’interface impossible à identifier sans risque. Consultez l’état de l’extension. L’absence de traduction publiée ne signifie pas que la langue n’est pas prise en charge.

**Et si l’extension propose déjà ma langue ?** Les traductions intégrées détectées sont prioritaires. Les traductions partagées complètent les manques ; les corrections révisées constituent une exception distincte et explicite.

**Que se passe-t-il après une mise à jour de l’extension ?** La compatibilité est revérifiée. Les entrées réutilisables restent actives ; les autres attendent des traductions actualisées. Les correctifs de fichiers exigent toujours une correspondance exacte.

**Puis-je l’utiliser hors ligne ?** Vous pouvez réutiliser les traductions déjà validées et mises en cache. L’autorisation, le traitement des contenus manquants et les nouveaux téléchargements nécessitent une connexion réseau.

<!-- section: contribute -->
## Contribuer et obtenir de l’aide

Participez à la [traduction, à la relecture et à la maintenance terminologique](https://trans-hub.net/ecosystems/obsidian). Signalez les problèmes reproductibles dans les [Issues](https://github.com/SakenW/trans-hub-obsidian-localizer/issues) et posez vos questions ou suggestions dans les [Discussions](https://github.com/SakenW/Trans-Hub/discussions).

Le [README en chinois simplifié](README.zh-CN.md) est la référence de contenu pour toutes les langues ; l’anglais est l’entrée par défaut sur GitHub. Consultez les [consignes de contribution](../CONTRIBUTING.md) pour synchroniser les traductions.

<!-- section: build -->
## Compilation et licence

Utilisez Node.js 24 et pnpm 10.34.4 :

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm type-check
pnpm test
pnpm verify:public-copy
pnpm build
```

Les tags de version doivent correspondre à `manifest.json`, `package.json` et `versions.json`. Les versions antérieures à `1.0.0` sont des versions de test publiques. Licence [Apache-2.0](../LICENSE).
