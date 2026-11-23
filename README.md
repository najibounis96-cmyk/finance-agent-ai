# Aster Intelligence Lab

Application indépendante de l’ERP Antigravity, avec un assistant général universel, des agents financiers spécialisés, une bibliothèque locale généraliste et un agent de build.

## Prérequis

- Node.js 20+
- [Ollama](https://ollama.com/) installé
- Un modèle Ollama installé

Modèle ouvert spécialisé finance proposé :

```powershell
ollama pull hf.co/QuantFactory/finance-Llama3-8B-GGUF:Q4_K_M
```

Il demande plusieurs gigaoctets de mémoire et peut être lent sur un ordinateur modeste ; vérifiez la licence et les conditions du modèle avant tout usage commercial. Modèle généraliste plus léger pour essayer l’application :

```powershell
ollama pull qwen2.5:3b
```

L’application sélectionne automatiquement le modèle Finance Llama lorsqu’il est installé. Pour choisir un autre modèle par défaut, définir la variable d’environnement `OLLAMA_MODEL` avant de lancer le serveur. Le menu permet également de changer de modèle.

## Démarrer

Sous Windows, double-cliquer sur `Lancer Aster Finance Lab.cmd`, puis ouvrir `http://127.0.0.1:5173`. Le démarrage de développement lance automatiquement `ollama serve` si Ollama est installé mais ne répond pas. Ou démarrer depuis PowerShell :

```powershell
npm install
npm run dev
```

Ouvrir `http://127.0.0.1:5173`. Pour produire et servir la version compilée :

```powershell
npm run build
npm run preview
```

## Agents

- **Entreprise** : aide au diagnostic des états, marges, trésorerie, financement, stratégie et risques.
- **Marchés** : explique valorisation, actions, obligations et scénarios. Le panneau « Données & sources » permet de consulter le dernier cours retourné par Yahoo Finance (symbole comme `AAPL`, `EURUSD=X` ou `^GSPC`) et de rechercher des articles via Google Actualités. Les résultats peuvent être ajoutés au contexte de la prochaine analyse ; l’assistant doit les traiter comme des éléments non vérifiés, pas comme des instructions.
- **Portefeuille** : aide à explorer diversification, concentrations, exposition au risque, budget, dette et finances personnelles ; ne fournit pas de conseil personnalisé.
- **Bibliothèque universelle** : le serveur télécharge des résultats RSS Google Actualités sur l’actualité générale, la géopolitique, la science, la technologie, la culture, la santé, l’environnement, l’éducation, le travail et l’économie au démarrage puis toutes les six heures. Les agents récupèrent automatiquement quelques extraits correspondant à la question. La page Bibliothèque permet de rechercher, consulter, ajouter des sources et examiner des documents. Dans le chat, le bouton **+** accepte des fichiers texte, CSV/JSON/code, PDF avec texte sélectionnable, images PNG/JPEG/WebP et les fichiers pris en charge d’un dossier. Les documents texte et PDF peuvent être enregistrés dans la bibliothèque locale.
- **Agent de build** : génère une proposition pour un seul fichier à la fois. Il n’exécute aucune commande et ne modifie aucun fichier avant que l’utilisateur clique sur « Appliquer ». Les fichiers modifiables restent dans `workspaces/<projet>/`.

Les appels d’IA vont au serveur Ollama de la machine (`127.0.0.1:11434`). Le serveur de l’application écoute lui aussi uniquement sur l’interface de loopback. Les conversations restent locales, mais les symboles et recherches sont transmis à Yahoo Finance et Google Actualités. La synchronisation de la bibliothèque contacte Google Actualités. Les documents importés et le cache de bibliothèque sont stockés localement en clair dans `data/finance-library.json`; ne les utilisez pas pour des données sensibles. Les images sont transmises à Ollama et nécessitent un modèle compatible vision. Les PDF sont lus localement dans le navigateur par PDF.js ; les PDF scannés sans couche texte ne sont pas analysés. Les limites d’import sont de 10 pièces par message, 24 000 caractères de texte, 20 pages par PDF et 4 Mo par image (8 Mo d’images au total). Les cotations Yahoo sont non contractuelles et peuvent être différées : aucun flux temps réel n’est garanti. Les articles et la base de connaissances ne sont ni exhaustifs, ni audités, ni un modèle universel entraîné ; vérifiez les sources et les analyses. Aucun conseil financier personnalisé ni rendement n’est garanti.

## Limites de sécurité du prototype

Le serveur local protège le bac à sable de build contre les chemins traversant son dossier, mais toute personne ou tout logiciel ayant accès à l’application sur le même compte Windows peut utiliser les projets de ce bac à sable. Ne placez pas de secrets ou de données financières confidentielles dans les conversations ou les projets.
