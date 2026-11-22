# ClimaStat — Analyse météo historique

Application web **sans backend et sans clé d'API** qui répond en langage clair à des questions du type :

> « À cette période de l'année, en moyenne, le temps est… La température en journée / en nuit est…
> Sur les 5 dernières années la tendance est… Les événements climatiques marquants sont… »

## Fonctionnement

1. **Recherche de lieu** via l'API de géocodage Open-Meteo (autocomplétion, monde entier).
2. **Téléchargement de l'historique** météo journalier (températures max/min/moyenne, précipitations,
   neige, code météo, vent) depuis l'[API historique Open-Meteo](https://open-meteo.com/en/docs/historical-weather-api)
   (réanalyses ERA5 / ERA5-Land, de 1950 à nos jours).
3. **Analyse et synthèse narrative** : moyennes et temps dominant autour de la date choisie (fenêtre de ±7 jours),
   tendance sur 5 ans (régression linéaire), tendance climatique globale, records et événements marquants.
4. **Graphiques** (Chart.js via CDN) :
   - évolution année par année pour la période de l'année choisie (avec tendance) ;
   - cycle annuel (températures et précipitations moyennes mensuelles) ;
   - température moyenne annuelle + tendance.

Les « événements marquants » incluent : records de chaleur / de froid absolus, jour le plus arrosé,
vent le plus fort, chute de neige record, plus longue vague de chaleur (≥ 30 °C consécutifs),
plus longue période de gel, année la plus chaude / la plus froide, ainsi que les records propres
à la fenêtre de 15 jours autour de la date choisie.

## Lancer l'application

Aucune installation nécessaire : ouvrez simplement `index.html` dans un navigateur.

En local (recommandé pour éviter tout blocage éventuel) :

```bash
python3 -m http.server 8080
# puis http://localhost:8080
```

ou

```bash
npx serve .
```

## Fichiers

| Fichier      | Rôle                                            |
|--------------|-------------------------------------------------|
| `index.html` | Page unique (structure et sections de résultat) |
| `style.css`  | Mise en page (responsive, sans framework)       |
| `app.js`     | Géocodage, requêtes API, analyses et graphiques |

## Sources de données

| Source | Rôle dans l'app |
|--------|-----------------|
| [Open-Meteo — API historique](https://open-meteo.com/en/docs/historical-weather-api) (réanalyses ERA5 / ERA5-Land) | Grille de référence mondiale, 1950 → J−7 |
| [Open-Meteo — API prévisions](https://open-meteo.com/en/docs), modèles **ARPEGE / AROME de Météo-France** | Prévisions des prochains jours (données Météo-France sans clé) |
| [NASA POWER](https://power.larc.nasa.gov/) | Source indépendante (1981 → J−8) pour la comparaison croisée des moyennes et de la tendance 5 ans ; activable via la case « Comparer NASA POWER » |

Concernant les données Météo-France « officielles » (meteo.data.gouv.fr et portail-api.meteofrance.fr) :
elles sont gratuites (Licence Ouverte / Etalab 2.0) mais n'offrent ni historique profond par API
(24 h glissantes pour les observations) ni en-têtes CORS fiables — un petit proxy serait nécessaire
pour les intégrer côté navigateur. L'app contourne cette limite en utilisant ARPEGE/AROME via Open-Meteo.

## Notes techniques

- Les appels se font directement depuis le navigateur : Open-Meteo et NASA POWER autorisent le CORS.
- Les données d'archive ont environ 5 à 7 jours de délai de publication (réanalyse ERA5) ;
  la date de fin est donc automatiquement ramenée à J−7 (J−8 pour NASA POWER).
- Le modèle de prévision ARPEGE n'assure qu'environ 4 à 5 jours de prévi fiable ; les jours
  supplémentaires éventuels sont ignorés.
- En cas de dépassement du quota horaire Open-Meteo (« Hourly API request limit exceeded »),
  l'app affiche un message explicatif ; l'historique de chaque lieu analysé est mis en cache
  dans `localStorage` pendant 24 h pour éviter tout re-téléchargement.
- Seuil « jour de pluie » : précipitations ≥ 1 mm/jour (constante `RAINY_MM` dans `app.js`).
- Seuils heatwave / gel : 30 °C et 0 °C (constantes `HEAT_THRESHOLD_C` / `FROST_THRESHOLD_C`).
