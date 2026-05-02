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
    rankingStatsGlobal: 'Statystyki globalne',
    rankingPlayersCount: '👥 Liczba graczy: {count}',
    rankingServersCount: '🌍 Serwery: {count}',
    rankingHighestScore: '🏆 Najwyższy wynik: {score}',
    rankingPage: 'Strona {current} z {total}',
    rankingYourStats: '👤 Twoje statystyki',
    rankingYourScore: 'Wynik',
    rankingYourServerPos: 'Na serwerze',
    rankingYourGlobalPos: 'Globalnie',
    rankingNotInRanking: 'Nie jesteś jeszcze w rankingu.',

    // Pozycja gracza w rankingu
    rankingPosition: 'Miejsce w rankingu: {pos}',
    rankingPositionNew: 'Miejsce w rankingu: {pos} (nowy w rankingu)',
    rankingPositionPromotion: 'Miejsce w rankingu: {pos} (Awans o +{change})',

    // /update — przetwarzanie (postęp krok po kroku)
    updateDownloading: '📥 Pobieranie obrazu...',
    updateComparingTemplate: '🔍 Analiza zgodności obrazu ze wzorcem...',
    updateExtractingData: '✅ Analiza OK — odczytuję dane rekordu...',
    updateSaving: '💾 Zapis danych...',
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
    recordTitle: '🏆 GRATULACJE!',
    recordDescription: '## {username} pobił swój rekord!',
    recordNewScore: '🏆 Wynik',
    recordProgress: '📈 Progres',
    recordRanking: '🏅 Pozycja',
    recordPromotionBy: 'awans o',
    recordNewEntry: 'nowy w rankingu',
    recordDateLabel: '📅 Data',
    recordPreviousRecordAgo: 'poprzedni rekord',
    recordAgo: 'temu',
    recordDateLocale: 'pl-PL',
    recordBoss: '👹 Boss',
    recordFollowerLabel: '🔔 SUBSKRYPCJE:',

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
    buttonPrev: '◀️ Poprzednia',
    buttonNext: 'Następna ▶️',
    buttonMyPos: '🎯 Moja pozycja',
    buttonGlobal: '🌐 Global',
    buttonServerRanking: '🏛️ Ranking Serwerów',
    buttonIndividualRanking: '👤 Ranking Indywidualny',
    buttonBack: '↩️ Wybór serwerów',
    guildRankingTitle: '🏛️ Ranking Serwerów',
    guildRankingFooter: 'Suma wyników top 30 graczy per serwer',

    // Role TOP
    topRoleUpdated: '🏆 Role TOP zostały zaktualizowane!',
    topRoleError: '❌ Błąd podczas aktualizacji ról TOP',
    topRoleAssigned: '✅ Przyznano rolę {roleName} użytkownikowi {username}',
    topRoleRemoved: '🗑️ Usunięto rolę {roleName} od {username}',

    // Global Top 3 notification
    globalTop3Title: '🌐 ZMIANA W TOP 3 GLOBALNYM!',
    globalTop3Description: '## {username} jest teraz {medal} #{position} w globalnym rankingu!',
    globalTop3Server: '🌍 Serwer',
    globalTop3GlobalPosition: '🌐 Pozycja globalna',
    globalTop3EnteredTop3: 'wejście do Top 3',
    globalTop3PositionImproved: 'awans z #{prevPos}',
    globalTop3PodiumLabel: '🏅 Aktualne podium',

    // /subscribe
    notifDescription: '🔔 Zarządzaj powiadomieniami o nowych rekordach graczy.',
    notifSetButton: '🔔 Ustaw powiadomienie',
    notifRemoveButton: '🔕 Usuń powiadomienie',
    notifSelectServer: '🌍 Wybierz serwer:',
    notifSelectServerPlaceholder: 'Wybierz serwer...',
    notifSelectPlayer: '👤 Wybierz gracza z rankingu:',
    notifSelectPlayerPlaceholder: 'Wybierz gracza...',
    notifNoPlayers: '📭 Brak graczy w rankingu tego serwera.',
    notifConfirmText: 'Czy chcesz otrzymywać powiadomienia gdy **{username}** z serwera **{guild}** pobije rekord?\n\nGdy to nastąpi, dostaniesz wiadomość prywatną z pełnym ogłoszeniem i zdjęciem.',
    notifConfirmYes: '✅ Tak, subskrybuj',
    notifConfirmNo: '❌ Anuluj',
    notifSuccess: '✅ **Powiadomienie ustawione!**\nGdy **{username}** pobije rekord na serwerze **{guild}**, dostaniesz wiadomość prywatną.',
    notifAlreadySet: '⚠️ Już subskrybujesz powiadomienia dla **{username}** z serwera **{guild}**.',
    notifCancelled: '❌ Anulowano.',
    notifRemoveTitle: '🔕 Usuń powiadomienie — wybierz osobę:',
    notifRemoveSelectPlaceholder: 'Wybierz kogo usunąć...',
    notifRemoveSuccess: '✅ Usunięto powiadomienie dla **{username}** z serwera **{guild}**.',
    notifRemoveNone: '📭 Nie masz żadnych ustawionych powiadomień.',
    notifDmFooter: '👁️ Obserwujesz tego gracza — powiadomienie subskrypcyjne',
    notifDmBrokeRecord: 'pobił swój rekord!',
    notifDmField1Name: '📊 Twój aktualny wynik:',
    notifDmField2Name: 'Porównanie do Twoich wyników:',
    notifDmBeatYourRecord: '🚨 Pobił Twój rekord o {diff}',
    notifDmMissingToRecord: '✅ Brakuje {diff} do Twojego rekordu',
    notifDmNoSubscriberRecord: '📊 Nie masz jeszcze wyniku na tym serwerze',

    // /block-ocr
    ocrBlocked: '🚫 **Analiza zdjęć jest tymczasowo zablokowana.**\nZostaniesz powiadomiony gdy zostanie wznowiona.',
    ocrBlockEnabled: '🔒 **Analiza OCR zablokowana** — komendy {commands} są teraz wyłączone na wszystkich serwerach.',
    ocrBlockDisabled: '🔓 **Analiza OCR odblokowana** — komendy {commands} są teraz dostępne.',
    ocrResumedTitle: '✅ Analiza zdjęć wznowiona!',
    ocrResumedDescription: 'Komendy {commands} są ponownie dostępne. Możesz przesyłać screeny wyników.',

    // Wspólne
    unknownBoss: 'Nieznany',
    unknownBossLabel: 'Nieznany boss',
    generalError: '❌ Wystąpił błąd podczas przetwarzania komendy.',

    // Uprawnienia
    noPermission: 'Brak uprawnień do tej komendy.',

    // Blokada użytkownika
    userBlocked: '🚫 Twoje konto zostało zablokowane z powodu próby przesłania fałszywego zdjęcia. W celu odblokowania skontaktuj się z administratorem serwera.',

    // Dzienny limit
    dailyLimitExceeded: '❌ Osiągnąłeś dzienny limit **{limit}** użyć komend /update i /test. Spróbuj jutro.',

    // Cooldown /update
    updateCooldown: '⏱️ Musisz poczekać jeszcze **{time}** przed ponownym użyciem `/update`.',

    // /test — wymagania i weryfikacja
    testAiOcrRequired: '❌ Komenda `/test` wymaga włączonego AI OCR (`USE_ENDERSECHO_AI_OCR=true`).',
    testNotSimilarTitle: '❌ Zdjęcie nie pasuje do wzorca',
    testNotSimilarDescription: 'AI uznało, że przesłany screenshot nie przedstawia ekranu wyników bossa.',
    testNotSimilarReasonLabel: '🔍 Powód odrzucenia',
    analyzeBtn: 'Analizuj',

    // Rankingi ról
    roleRankingServerError: '❌ Nie można pobrać danych serwera.',
    roleRankingLimitReached: '❌ Osiągnięto limit **{max}** rankingów ról. Usuń istniejący przed dodaniem nowego.',
    roleRankingAdded: '✅ Dodano ranking dla roli **{roleName}**. Pojawi się w komendzie `/ranking` po wybraniu tego serwera.',
    roleRankingNoRankings: '⚠️ Brak skonfigurowanych rankingów ról na tym serwerze.',

    // /unblock
    unblockTitle: '🔒 Zablokowani użytkownicy OCR',
    unblockNoBlocked: '✅ Brak zablokowanych użytkowników.',
    unblockSuccess: '✅ Odblokowano użytkownika **{username}**.',
    unblockNotFound: '⚠️ Użytkownik nie był zablokowany.',

    // Zatwierdzenie screena
    approveSuccess: '✅ Zatwierdzone przez **{adminName}**',

    // Modal /limit (Ustaw limity)
    limitModalTitle: 'Ustaw limity /update i /test',
    limitModalLabel: 'Limit dzienny (puste = brak limitu)',
    limitModalPlaceholder: 'np. 3',
    limitCooldownLabel: 'Cooldown po użyciu (np. 5m, 1h, 1h30m — puste = brak)',
    limitCooldownPlaceholder: 'np. 5m',
    limitRemoved: '✅ Dzienny limit użyć został **usunięty** — brak ograniczeń.',
    limitInvalidValue: '❌ Podaj dodatnią liczbę całkowitą lub zostaw pole puste (brak limitu).',
    limitSet: '✅ Dzienny limit ustawiony na **{limit}** użycie(ia) komend /update i /test na użytkownika.',
    limitCooldownSet: '✅ Cooldown ustawiony na **{cooldown}**.',
    limitCooldownRemoved: '✅ Cooldown usunięty — brak ograniczenia czasu między użyciami.',
    limitCooldownInvalid: '❌ Nieprawidłowy format cooldownu. Użyj np. `5m`, `1h`, `1h30m`.',

    // Modal blokady użytkownika
    blockUserModalTitle: 'Zablokuj użytkownika',
    blockUserTimeLabel: 'Czas blokady (np. 1h, 7d, 30m) — puste = permanentnie',
    blockUserTimePlaceholder: 'Zostaw puste dla blokady permanentnej',

    // /info
    infoPreview: '**Podgląd** — wiadomość zostanie wysłana na **{count}** serwer(ów):',
    infoSessionExpired: 'Sesja wygasła. Użyj `/info` ponownie.',

    // Brak konfiguracji
    notConfigured: '⚙️ EndersEcho nie jest jeszcze skonfigurowany na tym serwerze. Administrator musi użyć **/configure**.',

    // Embed odrzuconego screena
    reportTitle: '⚠️ Odrzucony screen',
    reportFieldNick: 'Nick na serwerze',
    reportFieldServer: 'Serwer',
    reportFieldTime: 'Czas',
    reportFieldReason: 'Powód odrzucenia',
    reportFieldAiDetails: '🔍 Szczegóły AI',
    reportReasonFakePhoto: '🔴 Wykryto podrobione / edytowane zdjęcie',
    reportReasonInvalidScreenshot: '🟡 Nie znaleziono ekranu Victory (ang. i jap.)',
    reportReasonNoRequiredWords: '🟡 Brak wymaganych słów Best/Total',
    reportReasonNotSimilar: '🟡 Zdjęcie nie pasuje do wzorca (komenda /update)',
    reportReasonInvalidScoreFormat: '🟠 Odczytany wynik nie posiada prawidłowej jednostki (K/M/B/T/Q/Qi/Sx)',
    reportReasonBestExceedsTotal: '🔴 Odczytany Best przekracza wartość Total',
    reportBtnApprove: 'Zatwierdź',
    reportBtnBlock: 'Zablokuj użytkownika',
    reportBtnAnalyze: 'Analizuj',
    reportActionField: 'Akcja wykonana na serwerze {serverName}',
    reportActionBy: 'Kto',
    reportActionWhat: 'Akcja',
    reportActionWhen: 'Kiedy',
    reportActionApproved: 'Zatwierdzono',
    reportActionBlocked: 'Zablokowano ({duration})',
    reportActionAnalyzed: 'Uruchomiono Analizuj',
    analyzeResultFail: '❌ Analizowano przez **{adminName}** — nie udało się odczytać danych: {error}',
    analyzeResultSuccess: '✅ Analizowano przez **{adminName}** — Boss: **{bossName}** | Wynik: **{score}** | {result}',
    analyzeResultNewRecord: '🏆 Nowy rekord!',
    analyzeResultNoRecord: 'Nie pobito rekordu',
    analyzeResultUnknown: 'nieznany',
    analyzeManualAnnouncement: '<@{userId}> Twój wynik został zweryfikowany manualnie przez administratora **{adminName}**.',

    // /ocr-on-off per-guild
    ocrBlockPerGuildEnabled: '🔒 Komendy **{commands}** wyłączone na serwerze **{serverName}**.',
    ocrBlockPerGuildDisabled: '🔓 Komendy **{commands}** włączone na serwerze **{serverName}**.',
    ocrGuildNotFound: '❌ Serwer nie znaleziony lub nie skonfigurowany.',

    // /configure — wspólne
    configureNotAdmin: '❌ Wymagane uprawnienie **Administrator** do konfiguracji bota.',
    configureSaved: '✅ Konfiguracja została zapisana! Bot jest teraz aktywny na tym serwerze.\n\n⚠️ Komendy `/update` i `/test` są domyślnie **wyłączone**. Skontaktuj się z @Thashar w celu odblokowania komend do analizy.',
    configureCancelled: '❌ Konfiguracja anulowana. Poprzednie ustawienia pozostają bez zmian.',
    configureTagTooLong: '❌ Tag może mieć maksymalnie 4 znaki.',
    configureTagEmpty: '❌ Tag nie może być pusty.',
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
    rankingStatsGlobal: 'Global statistics',
    rankingPlayersCount: '👥 Players: {count}',
    rankingServersCount: '🌍 Servers: {count}',
    rankingHighestScore: '🏆 Highest score: {score}',
    rankingPage: 'Page {current} of {total}',
    rankingYourStats: '👤 Your stats',
    rankingYourScore: 'Score',
    rankingYourServerPos: 'On server',
    rankingYourGlobalPos: 'Global',
    rankingNotInRanking: 'You are not in the ranking yet.',

    // Player ranking position
    rankingPosition: 'Ranking position: {pos}',
    rankingPositionNew: 'Ranking position: {pos} (new entry)',
    rankingPositionPromotion: 'Ranking position: {pos} (promoted by +{change})',

    // /update — processing (step by step progress)
    updateDownloading: '📥 Downloading image...',
    updateComparingTemplate: '🔍 Checking image against template...',
    updateExtractingData: '✅ Match confirmed — reading record data...',
    updateSaving: '💾 Saving data...',
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
    recordTitle: '🏆 CONGRATULATIONS!',
    recordDescription: '## {username} broke their record!',
    recordNewScore: '🏆 Score',
    recordProgress: '📈 Progress',
    recordRanking: '🏅 Position',
    recordPromotionBy: 'promoted by',
    recordNewEntry: 'new entry',
    recordDateLabel: '📅 Date',
    recordPreviousRecordAgo: 'previous record',
    recordAgo: 'ago',
    recordDateLocale: 'en-GB',
    recordBoss: '👹 Boss',
    recordFollowerLabel: '🔔 SUBSCRIPTIONS:',

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
    buttonPrev: '◀️ Previous',
    buttonNext: 'Next ▶️',
    buttonMyPos: '🎯 My position',
    buttonGlobal: '🌐 Global',
    buttonServerRanking: '🏛️ Server Ranking',
    buttonIndividualRanking: '👤 Individual Ranking',
    buttonBack: '↩️ Server selection',
    guildRankingTitle: '🏛️ Server Ranking',
    guildRankingFooter: 'Sum of top 30 players per server',

    // TOP roles
    topRoleUpdated: '🏆 TOP roles have been updated!',
    topRoleError: '❌ Error updating TOP roles',
    topRoleAssigned: '✅ Role {roleName} assigned to {username}',
    topRoleRemoved: '🗑️ Role {roleName} removed from {username}',

    // Global Top 3 notification
    globalTop3Title: '🌐 GLOBAL TOP 3 CHANGE!',
    globalTop3Description: '## {username} is now {medal} #{position} in the global ranking!',
    globalTop3Server: '🌍 Server',
    globalTop3GlobalPosition: '🌐 Global Position',
    globalTop3EnteredTop3: 'entered Top 3',
    globalTop3PositionImproved: 'promoted from #{prevPos}',
    globalTop3PodiumLabel: '🏅 Current podium',

    // /subscribe
    notifDescription: '🔔 Manage notifications for player record breaks.',
    notifSetButton: '🔔 Set notification',
    notifRemoveButton: '🔕 Remove notification',
    notifSelectServer: '🌍 Select a server:',
    notifSelectServerPlaceholder: 'Choose a server...',
    notifSelectPlayer: '👤 Select a player from the ranking:',
    notifSelectPlayerPlaceholder: 'Choose a player...',
    notifNoPlayers: '📭 No players in this server\'s ranking.',
    notifConfirmText: 'Do you want to receive notifications when **{username}** from server **{guild}** breaks a record?\n\nYou will receive a private message with the full announcement and screenshot.',
    notifConfirmYes: '✅ Yes, subscribe',
    notifConfirmNo: '❌ Cancel',
    notifSuccess: '✅ **Notification set!**\nWhenever **{username}** breaks a record on server **{guild}**, you will receive a private message.',
    notifAlreadySet: '⚠️ You are already subscribed to notifications for **{username}** from server **{guild}**.',
    notifCancelled: '❌ Cancelled.',
    notifRemoveTitle: '🔕 Remove notification — select a player:',
    notifRemoveSelectPlaceholder: 'Choose who to unsubscribe...',
    notifRemoveSuccess: '✅ Removed notification for **{username}** from server **{guild}**.',
    notifRemoveNone: '📭 You have no notifications set.',
    notifDmFooter: '👁️ You are following this player — subscription notification',
    notifDmBrokeRecord: 'broke their record!',
    notifDmField1Name: '📊 Your current score:',
    notifDmField2Name: 'Comparison to your score:',
    notifDmBeatYourRecord: '🚨 Beat your record by {diff}',
    notifDmMissingToRecord: '✅ {diff} away from your record',
    notifDmNoSubscriberRecord: '📊 You have no score on this server yet',

    // /block-ocr
    ocrBlocked: '🚫 **Screenshot analysis is temporarily blocked.**\nYou will be notified when it resumes.',
    ocrBlockEnabled: '🔒 **OCR analysis blocked** — commands {commands} are now disabled on all servers.',
    ocrBlockDisabled: '🔓 **OCR analysis unblocked** — commands {commands} are now available.',
    ocrResumedTitle: '✅ Screenshot analysis resumed!',
    ocrResumedDescription: 'Commands {commands} are available again. You can submit result screenshots.',

    // Common
    unknownBoss: 'Unknown',
    unknownBossLabel: 'Unknown boss',
    generalError: '❌ An error occurred while processing the command.',

    // Permissions
    noPermission: 'You do not have permission to use this command.',

    // User block
    userBlocked: '🚫 Your account has been blocked due to submitting a fake screenshot. Contact a server administrator to appeal.',

    // Daily limit
    dailyLimitExceeded: '❌ You have reached the daily limit of **{limit}** uses of /update and /test. Try again tomorrow.',

    // Update cooldown
    updateCooldown: '⏱️ You must wait **{time}** more before using `/update` again.',

    // /test — requirements and verification
    testAiOcrRequired: '❌ The `/test` command requires AI OCR to be enabled (`USE_ENDERSECHO_AI_OCR=true`).',
    testNotSimilarTitle: '❌ Screenshot does not match the template',
    testNotSimilarDescription: 'The AI determined that the submitted screenshot does not show a boss result screen.',
    testNotSimilarReasonLabel: '🔍 Rejection reason',
    analyzeBtn: 'Analyze',

    // Role rankings
    roleRankingServerError: '❌ Unable to fetch server data.',
    roleRankingLimitReached: '❌ Reached the limit of **{max}** role rankings. Remove an existing one before adding a new one.',
    roleRankingAdded: '✅ Added ranking for role **{roleName}**. It will appear in the `/ranking` command when this server is selected.',
    roleRankingNoRankings: '⚠️ No role rankings configured on this server.',

    // /unblock
    unblockTitle: '🔒 Blocked OCR Users',
    unblockNoBlocked: '✅ No blocked users.',
    unblockSuccess: '✅ Unblocked user **{username}**.',
    unblockNotFound: '⚠️ User was not blocked.',

    // Screen approval
    approveSuccess: '✅ Approved by **{adminName}**',

    // /limit modal (Set limits)
    limitModalTitle: 'Set /update and /test limits',
    limitModalLabel: 'Daily limit (empty = no limit)',
    limitModalPlaceholder: 'e.g. 3',
    limitCooldownLabel: 'Cooldown after use (e.g. 5m, 1h, 1h30m — empty = none)',
    limitCooldownPlaceholder: 'e.g. 5m',
    limitRemoved: '✅ Daily usage limit has been **removed** — no restrictions.',
    limitInvalidValue: '❌ Enter a positive integer or leave the field empty (no limit).',
    limitSet: '✅ Daily limit set to **{limit}** use(s) of /update and /test per user.',
    limitCooldownSet: '✅ Cooldown set to **{cooldown}**.',
    limitCooldownRemoved: '✅ Cooldown removed — no time limit between uses.',
    limitCooldownInvalid: '❌ Invalid cooldown format. Use e.g. `5m`, `1h`, `1h30m`.',

    // User block modal
    blockUserModalTitle: 'Block user',
    blockUserTimeLabel: 'Block duration (e.g. 1h, 7d, 30m) — empty = permanent',
    blockUserTimePlaceholder: 'Leave empty for permanent block',

    // /info
    infoPreview: '**Preview** — message will be sent to **{count}** server(s):',
    infoSessionExpired: 'Session expired. Use `/info` again.',

    // Not configured
    notConfigured: '⚙️ EndersEcho is not configured yet on this server. An administrator must run **/configure**.',

    // Rejected screenshot embed
    reportTitle: '⚠️ Rejected Screenshot',
    reportFieldNick: 'Server Nickname',
    reportFieldServer: 'Server',
    reportFieldTime: 'Time',
    reportFieldReason: 'Rejection Reason',
    reportFieldAiDetails: '🔍 AI Details',
    reportReasonFakePhoto: '🔴 Fake or edited photo detected',
    reportReasonInvalidScreenshot: '🟡 Victory screen not found (EN/JP)',
    reportReasonNoRequiredWords: '🟡 Required words Best/Total not found',
    reportReasonNotSimilar: '🟡 Image does not match the template (/update)',
    reportReasonInvalidScoreFormat: '🟠 Extracted score has no valid unit (K/M/B/T/Q/Qi/Sx)',
    reportReasonBestExceedsTotal: '🔴 Extracted Best exceeds Total value',
    reportBtnApprove: 'Approve',
    reportBtnBlock: 'Block User',
    reportBtnAnalyze: 'Analyze',
    reportActionField: 'Action taken on server {serverName}',
    reportActionBy: 'By',
    reportActionWhat: 'Action',
    reportActionWhen: 'When',
    reportActionApproved: 'Approved',
    reportActionBlocked: 'Blocked ({duration})',
    reportActionAnalyzed: 'Analyze triggered',
    analyzeResultFail: '❌ Analyzed by **{adminName}** — failed to read data: {error}',
    analyzeResultSuccess: '✅ Analyzed by **{adminName}** — Boss: **{bossName}** | Score: **{score}** | {result}',
    analyzeResultNewRecord: '🏆 New record!',
    analyzeResultNoRecord: 'No record broken',
    analyzeResultUnknown: 'unknown',
    analyzeManualAnnouncement: '<@{userId}> Your score was manually verified by administrator **{adminName}**.',

    // /ocr-on-off per-guild
    ocrBlockPerGuildEnabled: '🔒 Commands **{commands}** disabled on server **{serverName}**.',
    ocrBlockPerGuildDisabled: '🔓 Commands **{commands}** enabled on server **{serverName}**.',
    ocrGuildNotFound: '❌ Server not found or not configured.',

    // /configure — common
    configureNotAdmin: '❌ **Administrator** permission required to configure the bot.',
    configureSaved: '✅ Configuration saved! The bot is now active on this server.\n\n⚠️ Commands `/update` and `/test` are **disabled** by default. Contact @Thashar to unlock the analysis commands.',
    configureCancelled: '❌ Configuration cancelled. Previous settings remain unchanged.',
    configureTagTooLong: '❌ The tag can have a maximum of 4 characters.',
    configureTagEmpty: '❌ The tag cannot be empty.',
};

module.exports = { pol, eng };
