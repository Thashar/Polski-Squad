module.exports = {
    // Ogólne komunikaty
    channelNotAllowed: "❌ Ta komenda jest dostępna tylko na określonym kanale!",
    
    // Komunikaty rankingu
    rankingEmpty: "📊 Ranking jest pusty! Użyj `/update` z obrazem wyniku aby dodać swój wynik.",
    rankingError: "❌ Wystąpił błąd podczas wczytywania rankingu.",
    rankingExpired: "❌ Ta sesja rankingu wygasła. Użyj `/ranking` ponownie.",
    rankingWrongUser: "❌ Możesz obsługiwać tylko swój własny ranking.",
    
    // Komunikaty aktualizacji wyniku
    updateProcessing: "🔄 Analizuję obraz i wynik... To może chwilę potrwać.",
    updateNotImage: "❌ Załączony plik nie jest obrazem! Obsługiwane formaty: PNG, JPG, JPEG, GIF, BMP",
    updateNoRequiredWords: "❌ Obraz nie zawiera odpowiedniego typu wyniku.\n💡 **Tip:** Upewnij się, że wysyłasz screen po zakończonym runie!",
    updateNoScore: "❌ Nie udało się wyodrębnić wyniku z obrazu.\n💡 **Sprawdź czy:**\n• Obraz zawiera słowo \"Best\" z wynikiem\n• Tekst jest czytelny\n• Wynik ma jednostkę (K/M/B/T/Q/S) lub jest dużą liczbą",
    updateSuccess: "✅ Twój wynik został pomyślnie zapisany i ogłoszony!",
    updateError: "❌ Wystąpił błąd podczas przetwarzania obrazu. Spróbuj ponownie.",
    
    // Embedy
    rankingTitle: "🏆 Ranking Graczy",
    rankingStats: "Statystyki",
    rankingPlayersCount: "👥 Liczba graczy: {count}",
    rankingHighestScore: "🏆 Najwyższy wynik: {score}",
    rankingPage: "Strona {current} z {total}",
    
    resultTitle: "📊 Wynik przeanalizowany",
    resultPlayer: "Gracz",
    resultScore: "Wynik z obrazu",
    resultStatus: "Status",
    resultNotBeaten: "❌ Nie pobito rekordu (obecny: {currentScore})",
    
    recordTitle: "🎉 Nowy rekord!",
    recordDescription: "Gratulacje dla **{username}**!",
    recordNewScore: "🏆 Nowy wynik",
    recordDate: "📅 Data",
    recordStatus: "🎯 Status",
    recordSaved: "✅ Wynik zapisany do rankingu!",
    
    // Przyciski
    buttonFirst: "⏪ Pierwsza",
    buttonPrev: "◀️ Poprzednia",
    buttonNext: "Następna ▶️",
    buttonLast: "Ostatnia ⏩",
    
    // Role TOP
    topRoleUpdated: "🏆 Role TOP zostały zaktualizowane!",
    topRoleError: "❌ Błąd podczas aktualizacji ról TOP",
    topRoleAssigned: "✅ Przyznano rolę {roleName} użytkownikowi {username}",
    topRoleRemoved: "🗑️ Usunięto rolę {roleName} od {username}"
};