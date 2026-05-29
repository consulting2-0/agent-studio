---
description: Lint SOMA vault — pokreće deterministički scripts/lint-vault.mjs pa daje prioritizovan savet
---

Pokreni deterministički vault linter i protumači rezultat. NIŠTA ne menjaj, ne briši.

1. Pokreni u shell-u: `node scripts/lint-vault.mjs`
   (read-only; skenira ../agent-studio-vault, preskače skills/, ignoriše code blokove). Ako padne, prijavi grešku i STANI.
2. Prikaži tabelu iz izveštaja koji je skript vratio.
3. Dodaj kratak prioritizovan savet prema system/vault-standard.md: šta je visoka vrednost, šta je buka (npr. single-use tagovi koji su zapravo legitimni, ili stvari u skills/ koje su izuzete §0), šta srediti prvo. Ne predlaži bulk izmene — folder po folder.
