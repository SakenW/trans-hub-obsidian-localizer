# Trans-Hub Localizer

**Obsidian-Community-Plugins in deiner Sprache.**

[English](../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · **Deutsch** · [Français](README.fr.md) · [Español](README.es.md) · [Português (Brasil)](README.pt-BR.md) · [Русский](README.ru.md)

[![Release](https://img.shields.io/github/v/release/SakenW/trans-hub-obsidian-localizer)](https://github.com/SakenW/trans-hub-obsidian-localizer/releases) · **Desktop und Mobilgeräte** · **Kein KI-Modell und kein API-Key einzurichten**

Trans-Hub Localizer ist ein Obsidian-Plugin zur Übersetzung und Lokalisierung der Oberflächen von Community-Plugins. Es bewahrt erkannte mitgelieferte Übersetzungen, ergänzt fehlende Texte mit gemeinsam genutzten Übersetzungen und synchronisiert veröffentlichte Aktualisierungen automatisch. Standardmäßig werden Übersetzungen zur Laufzeit angewendet, ohne Plugin-Dateien zu verändern. Deine Notizen werden weder übersetzt noch hochgeladen.

[In Obsidian installieren](obsidian://show-plugin?id=trans-hub-plugin-localizer) · [Lokalisierungsfortschritt](https://trans-hub.net/ecosystems/obsidian) · [Feedback und Community](https://github.com/SakenW/Trans-Hub/discussions)

<!-- section: getting-started -->
## Erste Schritte

Erforderlich sind **Obsidian 1.11.4 oder neuer**, ein Trans-Hub-Konto und eine Netzwerkverbindung für Autorisierung und Synchronisierung. Desktop und Mobilgeräte werden unterstützt; erweiterte Datei-Kompatibilitätspatches sind nur auf dem Desktop verfügbar.

1. Installiere und aktiviere **Trans-Hub Localizer** unter **Einstellungen → Community-Plugins**.
2. Öffne die Plugin-Einstellungen und verbinde dein Trans-Hub-Konto. Du musst kein KI-Modell, Konto bei einem Modellanbieter oder API-Key konfigurieren.
3. Wähle die Zielsprache. Aktivierte Community-Plugins werden automatisch erkannt; du kannst einzelne Plugins von der Lokalisierung ausschließen.

Bereits veröffentlichte Übersetzungen werden wiederverwendet. Fehlende Inhalte werden automatisch zur Lokalisierung angefordert und nach der Verarbeitung im Hintergrund und Veröffentlichung synchronisiert. Bis Verarbeitung, Veröffentlichung oder Kompatibilitätsprüfung abgeschlossen sind, kann der Originaltext sichtbar bleiben.

Für eine manuelle Installation lade `main.js`, `manifest.json` und `styles.css` aus demselben [GitHub Release](https://github.com/SakenW/trans-hub-obsidian-localizer/releases) herunter und lege sie in `<vault-config-dir>/plugins/trans-hub-plugin-localizer/` ab. Mische keine Dateien verschiedener Versionen.

<!-- section: use-cases -->
## Wann es hilfreich ist

- Einstellungen, Befehle und Oberflächen von Community-Plugins in deine Sprache übersetzen.
- Gemeinsame Übersetzungen nutzen, ohne selbst ein KI-Modell oder einen API-Key einzurichten.
- Dieselbe Lösung auf Desktop und Smartphone nutzen und nach Plugin-Updates die Kompatibilität der Übersetzungen automatisch prüfen lassen.

<!-- section: capabilities -->
## Funktionen

| Funktion | Verhalten |
| --- | --- |
| Mitgelieferte Übersetzungen haben Vorrang | Erkannte Übersetzungen des installierten Plugins bleiben erhalten; fehlende Texte werden ergänzt. Nur ausdrücklich geprüfte Korrekturen dürfen den entsprechenden mitgelieferten Text ersetzen. |
| Gemeinsam genutzte Übersetzungen | Nutzer verwenden veröffentlichte Ergebnisse gemeinsam; fehlende Inhalte durchlaufen den gemeinsamen Lokalisierungsprozess. |
| Automatische Synchronisierung | Beim Start werden zunächst geprüfte Übersetzungen aus dem Cache wiederhergestellt. Während der Laufzeit wird nach Aktualisierungen gesucht. Neue Übersetzungen benötigen eine Netzwerkverbindung. |
| Kompatible Wiederverwendung nach Updates | Laufzeitübersetzungen können versionsübergreifend verwendet werden, wenn die einzelnen Einträge die Kompatibilitätsprüfung bestehen. Mehrdeutige oder inkompatible Einträge werden übersprungen. |
| Oberflächentexte | Unterstützt sicher erkennbare Namen, Beschreibungen, Einstellungen, Schaltflächen, Befehle, Meldungen, Optionen, Tooltips, Eingabehinweise, Beschriftungen für Barrierefreiheit und bestimmte dynamische Texte. |
| Plugin-README | Unterstützte Texte auf der Detailseite eines Community-Plugins können lokalisiert werden, wenn passende veröffentlichte README-Übersetzungen vorliegen. README-Texte werden getrennt von der eigentlichen Oberfläche gezählt. |

Je nach Anwendungsfall werden Quellidentität, Geltungsbereich, semantische Rolle, Format und dynamische Platzhalter geprüft. Eine vollständige Übersetzung jeder Oberfläche jedes Plugins wird nicht zugesichert.

<!-- section: languages -->
## Alle Sprachen, auch außerhalb der Vorauswahl

Wähle eine häufig verwendete Sprache oder gib eine andere Sprachkennung ein; regionale und Schriftvarianten bleiben erhalten. Ob eine Übersetzung verfügbar ist, hängt vom Verarbeitungs- und Veröffentlichungsstatus des angeforderten Inhalts ab.

Die Schnellauswahl umfasst **vereinfachtes Chinesisch, traditionelles Chinesisch, Englisch, Japanisch, Koreanisch, Deutsch, Französisch, Spanisch, brasilianisches Portugiesisch und Russisch**. Weitere Beispiele sind Italienisch (`it`), Arabisch (`ar`), Ukrainisch (`uk`) und Serbisch in lateinischer Schrift (`sr-Latn`). Verfügbarkeit und Qualität konkreter Übersetzungen hängen von den veröffentlichten Ergebnissen und den für die Sprache verfügbaren Verarbeitungsdiensten ab.

Gemeint sind die **Zielsprachen für andere Plugins**. Die Einstellungen des Localizers selbst sind derzeit auf vereinfachtem Chinesisch und Englisch verfügbar; für andere Sprachen wird Englisch verwendet. Die Sprachlinks oben wechseln ausschließlich die Sprache dieser README.

<!-- section: quality -->
## Übersetzungsqualität und unterstützter Umfang

Dieses Plugin richtet sich an die Oberflächen von Community-Plugins. Es übersetzt weder Notizen noch Webseiten und führt keine LLM-Übersetzung in Echtzeit auf deinem Gerät aus.

Die meisten Trans-Hub-Übersetzungen sind derzeit maschinell erstellt und nicht von Menschen korrekturgelesen. Das Plugin unterscheidet Übersetzungsquelle und Prüfstatus. Eine bestandene Quellen- und Kompatibilitätsprüfung bedeutet nicht, dass die sprachliche Richtigkeit von einem Menschen geprüft wurde.

Der Ablauf richtet sich an Community-Plugins, deren Identität und Version über das offizielle Obsidian-Verzeichnis und vertrauenswürdige Originalquellen verifiziert werden können. Eine Installation über BRAT, private Plugins oder beliebige lokale Änderungen erhalten nicht automatisch eine Kompatibilitätsgarantie. Der aktuelle Ablauf verwendet Englisch als Quellsprache.

Markdown-Editoren und Leseansichten für Notizen sowie Code, Skripte und bearbeitbare Inhalte sind ausgeschlossen. README-Lokalisierung ist auf die Detailseite des Community-Plugins beschränkt und aktiviert keine Übersetzung deiner Notizen.

<!-- section: privacy -->
## Datenschutz und optionale Datei-Patches

- Die lokale Analyse erkennt Plugin-Versionen und unterstützte Oberflächentexte. Erkannte Oberflächentexte und Notizen werden nicht hochgeladen.
- Anfragen enthalten Plugin-Identität, Version, Zielsprache, Abdeckungszahlen und kryptografische Prüfsummen. Kontoautorisierung und Übersetzungsdownloads benötigen Netzwerkzugriff.
- Zugangsdaten werden im sicheren Speicher von Obsidian abgelegt. Die serverseitige Verarbeitung beschreibt die [Datenschutzerklärung](https://trans-hub.net/zh-CN/legal/privacy).
- Standardmäßige Laufzeitlokalisierung verändert keine Plugin-Dateien. Beim Abschalten wird Laufzeittext zurückgesetzt, sofern er noch dem übersetzten Wert entspricht; spätere Änderungen anderer Plugins bleiben erhalten.

**Der erweiterte Kompatibilitätsmodus ist nur auf dem Desktop verfügbar und standardmäßig deaktiviert.** Patches müssen für jedes geeignete Plugin ausdrücklich angewendet werden. Sie ändern ausschließlich geprüfte statische Oberflächentexte, die an die exakte Version und das Artefakt gebunden sind, und speichern vorher Sicherung und Beleg. Eine Wiederherstellung erfolgt nur, solange die Datei noch der Prüfsumme nach dem Patch entspricht. Plugin-Updates und externe Änderungen bleiben erhalten und werden als Konflikte gemeldet. Lade das betroffene Plugin nach Anwendung oder Wiederherstellung eines Patches neu. Notizen werden niemals gepatcht.

<!-- section: faq -->
## Häufige Fragen

**Brauche ich einen API-Key?** Nein. Verbinde ein Trans-Hub-Konto; ein Modell oder API-Key muss nicht eingerichtet werden.

**Funktioniert es auf dem Smartphone?** Ja, Laufzeitlokalisierung unterstützt Mobilgeräte und Desktop. Datei-Kompatibilitätspatches gibt es nur auf dem Desktop.

**Warum bleibt mancher Text unübersetzt?** Die Übersetzung kann noch ausstehen, die Quelle nicht verifizierbar oder die Oberfläche nicht sicher erkennbar sein. Prüfe den Plugin-Status. Fehlende veröffentlichte Übersetzungen bedeuten nicht, dass die Sprache nicht unterstützt wird.

**Was passiert, wenn das Plugin meine Sprache bereits mitliefert?** Erkannte mitgelieferte Übersetzungen haben Vorrang. Gemeinsame Übersetzungen ergänzen Lücken; geprüfte Korrekturen sind eine gesonderte, ausdrückliche Ausnahme.

**Was passiert nach einem Plugin-Update?** Die Kompatibilität wird erneut geprüft. Wiederverwendbare Laufzeiteinträge bleiben aktiv; inkompatible warten auf aktualisierte Übersetzungen. Datei-Patches erfordern weiterhin eine exakte Übereinstimmung.

**Kann ich es offline nutzen?** Bereits zwischengespeicherte, geprüfte Übersetzungen können wiederverwendet werden. Autorisierung, Verarbeitung fehlender Inhalte und neue Downloads erfordern eine Netzwerkverbindung.

<!-- section: contribute -->
## Mitwirken und Hilfe erhalten

Hilf bei [Übersetzung, Korrekturlesen und Terminologiepflege](https://trans-hub.net/ecosystems/obsidian). Reproduzierbare Fehler gehören in [Issues](https://github.com/SakenW/trans-hub-obsidian-localizer/issues); Fragen und Vorschläge in [Discussions](https://github.com/SakenW/Trans-Hub/discussions).

Die [vereinfachte chinesische README](README.zh-CN.md) ist die Inhaltsvorlage für alle Sprachfassungen; Englisch ist der GitHub-Standardeinstieg. Regeln zur Synchronisierung stehen im [Leitfaden für Beiträge](../CONTRIBUTING.md).

<!-- section: build -->
## Build und Lizenz

Verwende Node.js 24 und pnpm 10.34.4:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm type-check
pnpm test
pnpm verify:public-copy
pnpm build
```

Release-Tags müssen mit `manifest.json`, `package.json` und `versions.json` übereinstimmen. Versionen unter `1.0.0` sind öffentliche Testversionen. Lizenziert unter [Apache-2.0](../LICENSE).
