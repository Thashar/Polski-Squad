#!/bin/bash

# 🤖 Automatyczny merge zmian Claude do main
# Użycie: ./merge.sh

set -e  # Zatrzymaj przy błędzie

echo "🔍 Szukam najnowszego brancha Claude..."

# Pobierz najnowszy branch zaczynający się od 'claude/'
CLAUDE_BRANCH=$(git branch -a | grep 'remotes/origin/claude/' | sed 's/remotes\/origin\///' | tail -1 | xargs)

if [ -z "$CLAUDE_BRANCH" ]; then
    echo "❌ Nie znaleziono brancha Claude!"
    echo "ℹ️  Upewnij się, że Claude wypushował zmiany."
    exit 1
fi

echo "✅ Znaleziono branch: $CLAUDE_BRANCH"
echo ""

# Pokaż co się zmieniło
echo "📋 Zmienione pliki:"
git diff --name-status main.."origin/$CLAUDE_BRANCH" | head -20
echo ""

# Potwierdź
read -p "🤔 Mergować ten branch do main? (y/N): " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Anulowano merge."
    exit 0
fi

echo "🔄 Mergowanie do main..."

# Przełącz się na main
git checkout main

# Pobierz najnowsze zmiany
git pull origin main

# Zmerguj branch Claude
git merge "$CLAUDE_BRANCH" --no-edit

# Wypchnij na GitHub
echo "🚀 Wysyłanie na GitHub..."
git push origin main

# Usuń zdalny branch Claude (opcjonalnie)
read -p "🗑️  Usunąć branch $CLAUDE_BRANCH? (Y/n): " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]] || [[ -z $REPLY ]]; then
    git push origin --delete "$CLAUDE_BRANCH" 2>/dev/null || echo "ℹ️  Branch już usunięty lub brak uprawnień"
    git branch -d "$CLAUDE_BRANCH" 2>/dev/null || echo "ℹ️  Lokalny branch nie istnieje"
fi

echo ""
echo "✅ ============================================"
echo "✅ MERGE ZAKOŃCZONY POMYŚLNIE!"
echo "✅ ============================================"
echo ""
echo "🔄 Teraz zrestartuj bota na serwerze:"
echo ""
echo "   Dla bota Kontroler:"
echo "   pm2 restart kontroler"
echo ""
echo "   Lub wszystkie boty:"
echo "   pm2 restart all"
echo ""
