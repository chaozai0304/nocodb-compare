# nocodb-compare

Plateforme **diff de schéma + exécution de mise à niveau** pour NocoDB.

Compare une base _Source_ (production) et une base _Target_ (staging), génère un plan exécutable, exporte en JSONL, puis applique (avec dry-run).

**Langues :** [English](README.md) · [简体中文](README.zh-CN.md) · Français (ici)

---

## Fonctionnalités

- Comparaison de schéma (tables / colonnes)
- Génération d’un plan de mise à niveau
- Sélection des étapes
- Dry-run / Apply
- Export en **JSONL** (1 appel API par ligne)
- Import & exécution d’un plan (JSON/JSONL)
- Script CLI pour serveur / CI

> Remarque : l’implémentation actuelle cible principalement **NocoDB Meta API v2**.

---

## Démarrage rapide (Docker)

- `docker build -t nocodb-compare:latest .`
- `docker run -d --name nocodb-compare -p 5175:5175 -v "$PWD/data:/data" --restart unless-stopped nocodb-compare:latest`

Ouvrir :
- http://localhost:5175/

---

## Connexion

Identifiants par défaut (uniquement au premier démarrage) :
- utilisateur : `admin`
- mot de passe : `ChangeMe123!`

Variables d’environnement :
- `INIT_USERNAME`
- `INIT_PASSWORD`

Après connexion, vous pouvez modifier utilisateur/mot de passe via le menu en haut à droite.

---

## Stockage

Par défaut, les fichiers sensibles sont stockés sous :
- `~/.nocodb-compare/config.json`
- `~/.nocodb-compare/auth.json`

Vous pouvez définir :
- `CONFIG_FILE=/data/config.json`
- `AUTH_FILE=/data/auth.json`

---

## Polices (open-source)

L’UI web embarque des polices open-source (via `@fontsource/*`) :

- Inter — SIL Open Font License 1.1
- Noto Sans SC — SIL Open Font License 1.1

---

## Licence

MIT — voir [LICENSE](LICENSE).
