const pol = {
    // Ogólne
    channelNotAllowed: '❌ Ta komenda jest dostępna tylko na określonym kanale!',
    noPermissionAdmin: '❌ Nie masz uprawnień do używania tej komendy. Wymagane: **Administrator**',

    // Ranking — wybór
    rankingSelectPrompt: '📊 **Wybierz ranking do wyświetlenia:**',
    rankingGlobalTitle: '🌐 Ranking Globalny',
    globalButtonLabel: '🌐 Global',

    // Ranking — błędy / stany
    rankingEmpty: '📊 Ranking jest pusty! Użyj `/update` z obrazem wyniku aby dodać swój wynik.',
    rankingError: '❌ Wystąpił błąd podczas wczytywania rankingu.',
    rankingExpired: '❌ Ta sesja rankingu wygasła. Użyj `/ranking` ponownie.',
    rankingWrongUser: '❌ Możesz obsługiwać tylko swój własny ranking.',
    noDataOnPage: '⚠️ Brak danych do wyświetlenia na tej stronie',

    // Ranking — embed
    rankingTitle: '🏆 Ranking Graczy',
    rankingStats: 'Statystyki',
    rankingPlayersCount: '👥 Liczba graczy: {count}',
    rankingHighestScore: '🏆 Najwyższy wynik: {score}',
    rankingPage: 'Strona {current} z {total}',

    // Pozycja gracza w rankingu
    rankingPosition: 'Miejsce w rankingu: {pos}',
    rankingPositionNew: 'Miejsce w rankingu: {pos} (nowy w rankingu)',
    rankingPositionPromotion: 'Miejsce w rankingu: {pos} (Awans o +{change})',

    // /update — przetwarzanie
    updateProcessing: '🔄 Analizuję obraz i wynik... To może chwilę potrwać.',
    updateNotImage: '❌ Załączony plik nie jest obrazem! Obsługiwane formaty: PNG, JPG, JPEG, GIF, BMP',
    updateFileTooLarge: '❌ Plik jest za duży! Maksymalny rozmiar: **{maxMB}MB**, twój plik: **{fileMB}MB**\n💡 **Tip:** Zmniejsz jakość obrazu lub użyj kompresji.',
    updateNoRequiredWords: '❌ Obraz nie zawiera odpowiedniego typu wyniku.\n💡 **Tip:** Upewnij się, że wysyłasz screen po zakończonym runie!',
    updateNoScore: '❌ Nie udało się wyodrębnić wyniku z obrazu.\n💡 **Sprawdź czy:**\n• Obraz zawiera słowo "Best" z wynikiem\n• Tekst jest czytelny\n• Wynik ma jednostkę (K/M/B/T/Q/S) lub jest dużą liczbą',
    updateSuccess: '✅ Twój wynik został pomyślnie zapisany i ogłoszony!',
    updateError: '❌ Wystąpił błąd podczas przetwarzania obrazu. Spróbuj ponownie.',

    // AI OCR
    aiOcrUnavailable: '⚠️ AI OCR niedostępny, używam tradycyjnego OCR...',
    fakePhotoDetected: '🚫 **WYKRYTO PODROBIONE ZDJĘCIE!**\n\nTwoje zdjęcie zostało zidentyfikowane jako sfałszowane lub zmodyfikowane. Wynik nie zostanie przyjęty.\n\n⚠️ Przerabianie screenshotów jest niedozwolone!',
    invalidScreenshot: '❌ Niepoprawny screenshot. Upewnij się, że zdjęcie zawiera ekran po zakończeniu walki Ender\'s Echo!',

    // Nowy rekord — ogłoszenie ephemeral
    newRecordConfirmed: '✅ **Nowy rekord został pobity i pozytywnie ogłoszony!**\n🏆 Gratulacje! Twój wynik został opublikowany dla wszystkich.',
    newRecordFallback: '🏆 **NOWY REKORD!**\n**Gracz:** {username}\n**Nowy rekord:** {score}\n**Poprzedni:** {previous}\n\n*Błąd wysyłania pełnego embed*',
    noRecordFallback: '❌ Nie pobito rekordu\n**Gracz:** {username}\n**Wynik:** {score}\n**Obecny rekord:** {current}\n\n*Błąd wysyłania embed z obrazem*',
    rankingImageCaption: '📎 **Oryginalny obraz wyniku:**',

    // Embed — wynik (bez rekordu)
    resultTitle: '📊 Wynik przeanalizowany',
    resultPlayer: 'Gracz',
    resultScore: 'Wynik z obrazu',
    resultStatus: 'Status',
    resultNotBeaten: '❌ Nie pobito rekordu (obecny: {currentScore})',
    resultDifference: '**Różnica:** {diff}',

    // Embed — nowy rekord
    recordTitle: '🎉 Nowy rekord!',
    recordDescription: 'Gratulacje dla **{username}**!',
    recordNewScore: '🏆 Nowy wynik',
    recordDate: '📅 Data',
    recordStatus: '🎯 Status',
    recordSaved: '✅ Wynik zapisany do rankingu!',
    recordRanking: '📊 Ranking',
    recordBoss: '👹 Boss',

    // /remove
    playerNotInRanking: '❌ Gracz {tag} nie był w rankingu tego serwera.',
    playerRemovedSuccess: '✅ Gracz {tag} został pomyślnie usunięty z rankingu. Role TOP zostały zaktualizowane.',
    playerRemoveError: '❌ Wystąpił błąd podczas usuwania gracza z rankingu.',

    // /ocr-debug
    ocrDebugStatus: '🔍 **Szczegółowe logowanie OCR:** {status}',
    ocrDebugEnabled: '✅ Włączone',
    ocrDebugDisabled: '❌ Wyłączone',
    ocrDebugOn: '🔍 **Szczegółowe logowanie OCR:** ✅ Włączone',
    ocrDebugOff: '🔇 **Szczegółowe logowanie OCR:** ❌ Wyłączone',

    // Przyciski nawigacji
    buttonFirst: '⏪ Pierwsza',
    buttonPrev: '◀️ Poprzednia',
    buttonNext: 'Następna ▶️',
    buttonLast: 'Ostatnia ⏩',

    // Role TOP
    topRoleUpdated: '🏆 Role TOP zostały zaktualizowane!',
    topRoleError: '❌ Błąd podczas aktualizacji ról TOP',
    topRoleAssigned: '✅ Przyznano rolę {roleName} użytkownikowi {username}',
    topRoleRemoved: '🗑️ Usunięto rolę {roleName} od {username}',

    // Wspólne
    unknownBoss: 'Nieznany',
    unknownBossLabel: 'Nieznany boss',
    generalError: '❌ Wystąpił błąd podczas przetwarzania komendy.',
};

const eng = {
    // General
    channelNotAllowed: '❌ This command is only available in the designated channel!',
    noPermissionAdmin: '❌ You do not have permission to use this command. Required: **Administrator**',

    // Ranking — selection
    rankingSelectPrompt: '📊 **Select a ranking to display:**',
    rankingGlobalTitle: '🌐 Global Ranking',
    globalButtonLabel: '🌐 Global',

    // Ranking — errors / states
    rankingEmpty: '📊 The ranking is empty! Use `/update` with a result screenshot to add your score.',
    rankingError: '❌ An error occurred while loading the ranking.',
    rankingExpired: '❌ This ranking session has expired. Use `/ranking` again.',
    rankingWrongUser: '❌ You can only interact with your own ranking.',
    noDataOnPage: '⚠️ No data to display on this page',

    // Ranking — embed
    rankingTitle: '🏆 Player Ranking',
    rankingStats: 'Statistics',
    rankingPlayersCount: '👥 Players: {count}',
    rankingHighestScore: '🏆 Highest score: {score}',
    rankingPage: 'Page {current} of {total}',

    // Player ranking position
    rankingPosition: 'Ranking position: {pos}',
    rankingPositionNew: 'Ranking position: {pos} (new entry)',
    rankingPositionPromotion: 'Ranking position: {pos} (promoted by +{change})',

    // /update — processing
    updateProcessing: '🔄 Analysing image and result... This may take a moment.',
    updateNotImage: '❌ The attached file is not an image! Supported formats: PNG, JPG, JPEG, GIF, BMP',
    updateFileTooLarge: '❌ File is too large! Maximum size: **{maxMB}MB**, your file: **{fileMB}MB**\n💡 **Tip:** Reduce image quality or use compression.',
    updateNoRequiredWords: '❌ The image does not contain a valid result screen.\n💡 **Tip:** Make sure you are submitting a screenshot from a completed run!',
    updateNoScore: '❌ Could not extract a score from the image.\n💡 **Check that:**\n• The image contains the word "Best" with a score\n• The text is readable\n• The score has a unit (K/M/B/T/Q/S) or is a large number',
    updateSuccess: '✅ Your score has been successfully saved and announced!',
    updateError: '❌ An error occurred while processing the image. Please try again.',

    // AI OCR
    aiOcrUnavailable: '⚠️ AI OCR unavailable, falling back to traditional OCR...',
    fakePhotoDetected: '🚫 **FAKE PHOTO DETECTED!**\n\nYour image has been identified as falsified or modified. The score will not be accepted.\n\n⚠️ Editing screenshots is not allowed!',
    invalidScreenshot: '❌ Invalid screenshot. Make sure the image shows the end-of-run screen for Ender\'s Echo!',

    // New record — ephemeral announcement
    newRecordConfirmed: '✅ **New record set and announced!**\n🏆 Congratulations! Your score has been published for everyone.',
    newRecordFallback: '🏆 **NEW RECORD!**\n**Player:** {username}\n**New record:** {score}\n**Previous:** {previous}\n\n*Error sending full embed*',
    noRecordFallback: '❌ Record not beaten\n**Player:** {username}\n**Score:** {score}\n**Current record:** {current}\n\n*Error sending embed with image*',
    rankingImageCaption: '📎 **Original result image:**',

    // Embed — result (no record)
    resultTitle: '📊 Result Analysed',
    resultPlayer: 'Player',
    resultScore: 'Score from image',
    resultStatus: 'Status',
    resultNotBeaten: '❌ Record not beaten (current: {currentScore})',
    resultDifference: '**Difference:** {diff}',

    // Embed — new record
    recordTitle: '🎉 New Record!',
    recordDescription: 'Congratulations to **{username}**!',
    recordNewScore: '🏆 New score',
    recordDate: '📅 Date',
    recordStatus: '🎯 Status',
    recordSaved: '✅ Score saved to the ranking!',
    recordRanking: '📊 Ranking',
    recordBoss: '👹 Boss',

    // /remove
    playerNotInRanking: '❌ Player {tag} was not in the ranking of this server.',
    playerRemovedSuccess: '✅ Player {tag} has been successfully removed from the ranking. TOP roles have been updated.',
    playerRemoveError: '❌ An error occurred while removing the player from the ranking.',

    // /ocr-debug
    ocrDebugStatus: '🔍 **Detailed OCR logging:** {status}',
    ocrDebugEnabled: '✅ Enabled',
    ocrDebugDisabled: '❌ Disabled',
    ocrDebugOn: '🔍 **Detailed OCR logging:** ✅ Enabled',
    ocrDebugOff: '🔇 **Detailed OCR logging:** ❌ Disabled',

    // Navigation buttons
    buttonFirst: '⏪ First',
    buttonPrev: '◀️ Previous',
    buttonNext: 'Next ▶️',
    buttonLast: 'Last ⏩',

    // TOP roles
    topRoleUpdated: '🏆 TOP roles have been updated!',
    topRoleError: '❌ Error updating TOP roles',
    topRoleAssigned: '✅ Role {roleName} assigned to {username}',
    topRoleRemoved: '🗑️ Role {roleName} removed from {username}',

    // Common
    unknownBoss: 'Unknown',
    unknownBossLabel: 'Unknown boss',
    generalError: '❌ An error occurred while processing the command.',
};

module.exports = { pol, eng };
