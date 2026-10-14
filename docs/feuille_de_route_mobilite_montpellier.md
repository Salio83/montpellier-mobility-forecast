# Feuille de route : projet data « Mobilité à Montpellier »

Projet personnel pour renforcer le CV sur le profil data analyst / profil hybride data + logiciel.
Données : API Open Data Montpellier Méditerranée Métropole (format NGSI-LD).
Portail : https://portail-api.montpellier.fr — contact : opendata3m@montpellier3m.fr — licence Apache 2.0.

Dernière mise à jour : 13/10/2026

## Objectifs

1. **Projet A** : analyse de l'usage des vélos et des piétons (éco-compteurs, Vélomagg).
2. **Projet B** : outil de prévision de disponibilité (parkings, vélos) avec un modèle de machine learning, présenté sur une carte interactive.

Les deux projets partagent le même dépôt, la même base de données et la même collecte. Ordre : A puis B.

## Ce que l'API fournit

| Jeu de données | Temps réel | Historique |
|---|---|---|
| Vélomagg (BikeHireDockingStation) | oui | oui (nombre de vélos disponibles) |
| Parkings en ouvrage (OffStreetParking) | oui | oui (places disponibles) |
| Éco-compteurs vélo et piéton (EcoCounter) | oui (description et localisation) | oui (intensité) |
| Conteneurs à verre (WasteContainer) | oui | seulement les conteneurs équipés de capteurs : à écarter |

Notes :
- Utiliser les endpoints NGSI-LD (`/ngsi-ld/v1/...`). Les anciens endpoints restent disponibles seulement jusqu'au **31/12/2026**.
- La profondeur et la fréquence des historiques sont **à vérifier** (étape 0). Rien n'est supposé ici.

## Planning indicatif (environ 2 mois, en parallèle des cours)

| Étape | Durée | Période visée |
|---|---|---|
| 0. Explorer l'API | 1 à 2 jours | semaine du 13/10 |
| 1. Socle technique + collecte | 1 semaine | fin octobre |
| 2. Projet A : analyse | 2 à 3 semaines | novembre |
| 3. Projet B : modèle de prévision | 3 à 4 semaines | fin novembre à décembre |
| 4. Carte interactive + déploiement | 1 à 2 semaines | décembre à janvier |
| 5. Finalisation et CV | quelques jours | janvier |

Repère école : fiche de stage Poly+ à remplir au plus tard vers le **12 mars 2027**. Le projet doit être présentable avant les candidatures de fin d'hiver.

---

## Étape 0 : explorer l'API (1 à 2 jours)

- [ ] Appeler la liste des éco-compteurs (`type=EcoCounter`) et noter les champs disponibles.
- [ ] Appeler l'historique d'un éco-compteur (`/ngsi-ld/v1/temporal/entities/{id}`) : noter la **période couverte**, la **fréquence** (5 min, heure, jour), le volume par requête (pagination, limites).
- [ ] Idem pour une station Vélomagg et pour un parking.
- [ ] Noter le taux de valeurs manquantes et les compteurs ou stations visiblement en panne.
- [ ] Lire les conditions d'utilisation du portail et prévoir une cadence de requêtes raisonnable.
- [ ] Rédiger une note « constat » (10 lignes) dans le dépôt : ce qui existe réellement.

**Décision à prendre :**
- Historique long (plusieurs mois ou années) : l'utiliser directement pour A et B.
- Historique court : lancer la collecte maison (étape 1) sans attendre, elle servira à B.

## Étape 1 : socle technique et collecte (1 semaine)

- [ ] Créer le dépôt Git avec la structure : `ingestion/`, `analysis/`, `models/`, `app/`, `docs/`, `docker-compose.yml`, `README.md`.
- [ ] PostgreSQL + PostGIS dans Docker Compose.
- [ ] Schéma : tables de description (stations, parkings, compteurs avec coordonnées) et tables de mesures (identifiant, horodatage, valeur, date de collecte).
- [ ] Script d'ingestion Python : récupérer, stocker les données **brutes** puis les charger dans les tables propres.
- [ ] Planifier la collecte temps réel (cron ou GitHub Actions) à une fréquence adaptée à la mise à jour de l'API.
- [ ] Journaliser les erreurs et gérer les échecs d'appel (nouvelle tentative, pas de doublons).
- [ ] Documenter dans le README comment lancer le projet en une commande.

**Livrable :** `docker compose up` démarre la base et la collecte.

## Étape 2 : Projet A, analyse de l'usage vélo et piéton (2 à 3 semaines)

Questions à fixer avant de coder (exemples, à adapter) :
- Quels sont les pics de passage dans la journée ? Différence semaine / week-end ?
- Quelle saisonnalité (mois, vacances, jours fériés) ?
- Quelle influence de la pluie et de la température ?
- Quelles stations Vélomagg se vident ou se remplissent le plus, et à quelles heures ?

Tâches :
- [ ] Nettoyage : valeurs manquantes, zéros anormaux (compteur en panne), doublons, fuseau horaire et changement d'heure.
- [ ] Ajouter une source météo ouverte (par exemple Open-Meteo ou Météo-France, à vérifier) et noter la source.
- [ ] Requêtes SQL d'agrégation (par heure, jour, mois) avec jointures et fonctions de fenêtrage.
- [ ] Analyse en Python (pandas) ou en R, avec graphiques lisibles.
- [ ] Indicateurs de fiabilité : part de données manquantes par compteur.
- [ ] Rapport (notebook propre ou `docs/analyse.md`) : questions, méthode, résultats, **limites**.
- [ ] Un tableau de bord simple (Power BI / Tableau Public, ou Streamlit / Shiny) pour présenter les résultats.

**Livrable :** rapport + tableau de bord, publiés dans le dépôt.

## Étape 3 : Projet B, modèle de prévision (3 à 4 semaines)

- [ ] Choisir **une seule cible** au départ (par exemple les places libres d'un parking à +30 minutes), puis généraliser.
- [ ] Construire une **référence simple** : moyenne à la même heure et le même jour de la semaine sur les semaines passées.
- [ ] Variables : heure, jour de la semaine, jours fériés et vacances, météo, valeurs récentes (retards de 15 min, 1 h, 24 h).
- [ ] Modèles à comparer : régression linéaire, forêt aléatoire, gradient boosting (LightGBM ou XGBoost).
- [ ] Évaluation : découpage **dans le temps** (entraînement sur le passé, test sur le futur), pas de mélange aléatoire. Métrique : MAE, comparée à la référence.
- [ ] Analyser les cas où le modèle échoue (jours exceptionnels, événements).
- [ ] Enregistrer le modèle avec sa version, ses paramètres et ses résultats.
- [ ] Journal de décisions (`docs/decisions.md`) : pourquoi cette cible, ces variables, ce modèle.

**Livrable :** un modèle qui bat (ou non, à documenter honnêtement) la référence simple, avec un rapport d'évaluation.

## Étape 4 : carte interactive et déploiement (1 à 2 semaines)

- [ ] Application Streamlit (ou page web avec Leaflet) : carte des stations, parkings et compteurs.
- [ ] Afficher l'état actuel et la prévision à +30 minutes (avec la date de mise à jour).
- [ ] Filtres : type d'équipement, zone.
- [ ] Gérer l'indisponibilité de l'API (message clair, dernières valeurs connues).
- [ ] Déployer avec Docker Compose (si hébergement possible, mettre un lien public).
- [ ] Captures d'écran dans le README.

**Livrable :** application démontrable en entretien.

## Étape 5 : finalisation et CV

- [ ] README final : objectif, architecture (schéma), données et licence, résultats, limites, instructions.
- [ ] Nettoyer le code, ajouter quelques tests (ingestion, calcul des variables).
- [ ] Mettre le dépôt GitHub en ordre et l'épingler sur le profil.
- [ ] Ajouter au CV **uniquement quand c'est terminé et en ligne**, en précisant « projet personnel ».
- [ ] Préparer 3 questions d'entretien sur le projet : pourquoi ce modèle, comment as-tu évalué, quelles limites.

Exemple de ligne de CV (à ajuster aux résultats réels) :
> Mobilité à Montpellier (projet personnel) — pipeline de collecte (Python, PostgreSQL/PostGIS, Docker), analyse de l'usage vélo et piéton, modèle de prévision de disponibilité et carte interactive, à partir de l'open data de la Métropole.

## Risques et parades

| Risque | Parade |
|---|---|
| Historique trop court | Collecte maison dès l'étape 1 |
| Données manquantes ou capteurs en panne | Indicateurs de fiabilité, filtrage documenté |
| API qui change (migration NGSI-LD) | N'utiliser que les nouveaux endpoints |
| Projet trop ambitieux | Une seule cible pour le modèle, généraliser seulement ensuite |
| Manque de temps (cours) | Livrer A seul si besoin : il est déjà présentable |

## Suivi

| Date | Avancement | Prochaine action |
|---|---|---|
| | | |
