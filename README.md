# Aster Finance Lab

Application indépendante de l’ERP Antigravity, avec deux agents de conversation financière et un agent de build local.

## Prérequis

- Node.js 20+
- [Ollama](https://ollama.com/) installé et démarré
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

Sous Windows, double-cliquer sur `Lancer Aster Finance Lab.cmd`, puis ouvrir `http://127.0.0.1:5173`. Ou démarrer depuis PowerShell :

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
- **Agent de build** : génère une proposition pour un seul fichier à la fois. Il n’exécute aucune commande et ne modifie aucun fichier avant que l’utilisateur clique sur « Appliquer ». Les fichiers modifiables restent dans `workspaces/<projet>/`.

Les appels d’IA vont au serveur Ollama de la machine (`127.0.0.1:11434`). Le serveur de l’application écoute lui aussi uniquement sur l’interface de loopback. Les conversations restent locales, mais les symboles demandés sont envoyés à Yahoo Finance et les recherches textuelles à Google Actualités ; ces fournisseurs externes peuvent recevoir ces requêtes. Les cotations sont fournies sans garantie, peuvent être différées, indisponibles ou soumises aux conditions du fournisseur : l’application n’est pas un flux boursier contractuel en temps réel. Les liens de recherche renvoient à Google Actualités ; vérifiez l’article original, sa date et son éditeur avant d’utiliser une information. Les réponses d’un modèle local peuvent être inexactes : vérifier les chiffres, les hypothèses, les dates et les sources. Aucun conseil financier personnalisé ni rendement n’est garanti.

## Limites de sécurité du prototype

Le serveur local protège le bac à sable de build contre les chemins traversant son dossier, mais toute personne ou tout logiciel ayant accès à l’application sur le même compte Windows peut utiliser les projets de ce bac à sable. Ne placez pas de secrets ou de données financières confidentielles dans les conversations ou les projets.
