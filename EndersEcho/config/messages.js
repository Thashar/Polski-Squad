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
    roleRankingTitle: '🎖️ Ranking roli: {roleName}',
    rankingStats: 'Statystyki',
    rankingStatsGlobal: 'Statystyki globalne',
    rankingPlayersCount: '👥 Liczba graczy: {count}',
    rankingServersCount: '🌍 Serwery: {count}',
    rankingTotalPlayers: '👥 Łącznie graczy: {count}',
    rankingHighestScore: '🏆 Najwyższy wynik: {score}',
    rankingPage: 'Strona {current} z {total}',
    rankingYourStats: '👤 Twoje statystyki',
    rankingYourScore: 'Wynik',
    rankingYourServerPos: 'Na serwerze',
    rankingYourGlobalPos: 'Globalnie',
    rankingNotInRanking: 'Nie jesteś jeszcze w rankingu.',
    chartTitle: '📈 Historia Rekordów',
    globalPlayerGrowthChartTitle: '📊 Przyrost Unikalnych Graczy',

    // Pozycja gracza w rankingu
    rankingPosition: 'Miejsce w rankingu: {pos}',
    rankingPositionNew: 'Miejsce w rankingu: {pos} (nowy w rankingu)',
    rankingPositionPromotion: 'Miejsce w rankingu: {pos} (Awans o +{change})',

    // /update — przetwarzanie (postęp krok po kroku)
    updateDownloading: '📥 Pobieranie obrazu...',
    updateComparingTemplate: '🔍 Analiza zgodności obrazu ze wzorcem...',
    updateRetryTemplate: '⏳ API przeciążone — ponawiam sprawdzanie wzorca (próba {attempt}/{total})...',
    updateExtractingData: '✅ Analiza OK — odczytuję dane rekordu...',
    updateRetryExtract: '⏳ API przeciążone — ponawiam odczytywanie danych (próba {attempt}/{total})...',
    updateSaving: '💾 Zapis danych...',
    updateNotImage: '❌ Załączony plik nie jest obrazem! Obsługiwane formaty: PNG, JPG, JPEG, GIF, BMP',
    updateFileTooLarge: '❌ Plik jest za duży! Maksymalny rozmiar: **{maxMB}MB**, twój plik: **{fileMB}MB**\n💡 **Tip:** Zmniejsz jakość obrazu lub użyj kompresji.',
    updateNoRequiredWords: '❌ Obraz nie zawiera odpowiedniego typu wyniku.\n💡 **Tip:** Upewnij się, że wysyłasz screen po zakończonym runie!',
    updateNoScore: '❌ Nie udało się wyodrębnić wyniku z obrazu.\n💡 **Sprawdź czy:**\n• Obraz zawiera słowo "Best" z wynikiem\n• Tekst jest czytelny\n• Wynik ma jednostkę (K/M/B/T/Q/Qi/Sx/Sp) lub jest dużą liczbą',
    updateSuccess: '✅ Twój wynik został pomyślnie zapisany i ogłoszony!',
    updateError: '❌ Wystąpił błąd podczas przetwarzania obrazu. Spróbuj ponownie.',
    updateAiOverloaded: '⚠️ Usługa AI jest aktualnie mocno obciążona. Spróbuj ponownie za chwilę.',

    // AI OCR
    aiOcrUnavailable: '⚠️ AI OCR niedostępny, używam tradycyjnego OCR...',
    fakePhotoDetected: '🚫 **WYKRYTO PODROBIONE ZDJĘCIE!**\n\nTwoje zdjęcie zostało zidentyfikowane jako sfałszowane lub zmodyfikowane. Wynik nie zostanie przyjęty.\n\n⚠️ Przerabianie screenshotów jest niedozwolone!',

    // Nowy rekord — ogłoszenie ephemeral
    newRecordConfirmed: '✅ **Nowy rekord został pobity i pozytywnie ogłoszony!**\n🏆 Gratulacje! Twój wynik został opublikowany dla wszystkich.',
    newRecordFallback: '🏆 **NOWY REKORD!**\n**Gracz:** {username}\n**Nowy rekord:** {score}\n**Poprzedni:** {previous}\n\n*Błąd wysyłania pełnego embed*',
    resultNotBeatenCrossServer: '❌ Nie pobito rekordu — masz już wyższy wynik (**{score}**) na serwerze **{guildName}**.',
    crossServerScoreRemovedNotice: '⚠️ Twój ostatni wynik **{score}** na serwerze **{oldGuildName}** nie będzie już widoczny w rankingu serwera.\nOd teraz figurujesz w rankingu na serwerze **{newGuildName}**.\nTwoja historia wyników została zachowana.',
    crossServerMigratedNotice: 'Wynik został zmigrowany\nWynik został przeniesiony z rankingu serwera **{oldGuildName}** na ranking serwera **{newGuildName}**.\nTwoja historia wyników została zachowana.',
    crossServerBossKeptField: 'Rekord globalny pozostał bez zmian',
    crossServerBossKeptValue: 'Twój najlepszy wynik **{score}** pozostaje na serwerze **{guildName}** — nie został przeniesiony. Tutaj ustawiłeś jedynie nowy rekord na tym bossie.',
    noRecordFallback: '❌ Nie pobito rekordu\n**Gracz:** {username}\n**Wynik:** {score}\n**Obecny rekord:** {current}\n\n*Błąd wysyłania embed z obrazem*',
    rankingImageCaption: '📎 **Oryginalny obraz wyniku:**',

    // Embed — wynik (bez rekordu)
    resultScore: 'Wynik z obrazu',
    resultNotBeaten: '❌ Nie pobito rekordu (obecny: {currentScore})',
    resultDifference: '**Różnica:** {diff}',
    resultDetailsField: 'Szczegóły wyniku',

    // Embed — nowy rekord
    recordTitle: '🏆 GRATULACJE!',
    recordDescription: '## {username} pobił swój rekord!',
    recordNewScore: '🏆 Wynik',
    recordProgress: '📈 Progres',
    recordRanking: '🏅 Pozycja',
    recordBossRanking: '👾 Pozycja (boss)',
    recordPromotionBy: 'awans o',
    recordNewEntry: 'nowy w rankingu',
    recordDateLabel: '📅 Data',
    recordPreviousRecordAgo: 'poprzedni rekord',
    recordAgo: 'temu',
    recordDateLocale: 'pl-PL',
    recordFollowerLabel: '🔔 SUBSKRYPCJE:',

    // Wieloembedowe ogłoszenie /update (nagłówki sekcji)
    globalRankingEmbedTitle: 'Ranking globalny',
    bossRankingEmbedTitle: 'Ranking bossa',
    systemInfoEmbedTitle: 'Analiza zgłoszenia',
    systemInfoAllGood: 'Zdjęcie zweryfikowane poprawnie.\nWynik zapisany w rankingu.',
    snippetPositionChange: 'Zmiana pozycji:',

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
    buttonPrev: 'Poprzednia',
    buttonNext: 'Następna',
    buttonMyPos: 'Moja pozycja',
    buttonServerPos: 'Pozycja serwera',
    buttonGlobal: 'Global',
    buttonServerRanking: 'Ranking Serwerów',
    buttonIndividualRanking: 'Ranking Indywidualny',
    buttonBack: 'Rankingi serwerów',
    guildRankingTitle: '🏛️ Ranking Serwerów',
    guildRankingFooter: 'Suma wyników top 30 graczy per serwer',
    guildRankingPlayers: 'graczy',
    guildRankingBest: 'najlepszy',

    // Role TOP
    topRoleUpdated: '🏆 Role TOP zostały zaktualizowane!',
    topRoleError: '❌ Błąd podczas aktualizacji ról TOP',
    topRoleAssigned: '✅ Przyznano rolę {roleName} użytkownikowi {username}',
    topRoleRemoved: '🗑️ Usunięto rolę {roleName} od {username}',

    // Global TOP snippet (pod wynikiem)
    globalSnippetTitle: '🌐 Zmiana w globalnym rankingu',
    bossSnippetTitle: '👾 Zmiana w rankingu bossa',

    // Global TOP10 cykliczny raport
    globalTop10ReportTitle: '🌐 TOP 10 Globalny',
    globalTop10BossField: '⚔️ Boss okresu',
    globalTop10Footer: 'Następny raport za 3 dni',
    globalTop10FooterBreak: 'Następny raport za 4 dni (przerwa)',
    globalTop10FooterNext: 'Następny raport za {days} dni',

    // /subscribe
    notifDescription: '🔔 Zarządzaj powiadomieniami o nowych rekordach graczy.',
    notifSetButton: 'Ustaw powiadomienie',
    notifRemoveButton: 'Usuń powiadomienie',
    notifSelectServer: '🌍 Wybierz serwer:',
    notifSelectServerPlaceholder: 'Wybierz serwer...',
    notifSelectPlayer: '👤 Wybierz gracza z rankingu:',
    notifSelectPlayerPlaceholder: 'Wybierz gracza...',
    notifNoPlayers: '📭 Brak graczy w rankingu tego serwera.',
    notifConfirmText: 'Czy chcesz otrzymywać powiadomienia gdy **{username}** z serwera **{guild}** pobije rekord?\n\nGdy to nastąpi, dostaniesz wiadomość prywatną z pełnym ogłoszeniem i zdjęciem.',
    notifConfirmYes: 'Tak, subskrybuj',
    notifConfirmNo: 'Anuluj',
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
    notifDmScoresEqual: '🎯 Wyniki równe!',

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
    commandError: '❌ Wystąpił błąd podczas przetwarzania komendy.',
    gatewayRateLimited: '⏱️ Zbyt wiele żądań. Spróbuj ponownie za{retry}.',
    gatewayNotEntitled: '🔒 Operacja nie jest dostępna dla tego serwera.',
    gatewayDefault: '❌ Żądanie odrzucone przez gateway.',

    // Blokada użytkownika
    userBlocked: '🚫 Twoje konto zostało zablokowane z powodu próby przesłania fałszywego zdjęcia. W celu odblokowania skontaktuj się z administratorem serwera.',

    // Dzienny limit
    dailyLimitExceeded: '❌ Osiągnąłeś dzienny limit **{limit}** użyć komend /update i /test. Spróbuj jutro.',

    // Cooldown /update
    updateCooldown: '⏱️ Musisz poczekać jeszcze **{time}** przed ponownym użyciem `/update`.',

    // /test — wymagania i weryfikacja
    testAiOcrRequired: '❌ Komenda `/test` wymaga włączonego AI OCR (`USE_ENDERSECHO_AI_OCR=true`).',
    analyzeBtn: 'Analizuj',

    // Rankingi ról
    roleRankingServerError: '❌ Nie można pobrać danych serwera.',
    roleRankingLimitReached: '❌ Osiągnięto limit **{max}** rankingów ról. Usuń istniejący przed dodaniem nowego.',
    roleRankingAdded: '✅ Dodano ranking dla roli **{roleName}**. Pojawi się w komendzie `/ranking` po wybraniu tego serwera.',
    roleRankingNoRankings: '⚠️ Brak skonfigurowanych rankingów ról na tym serwerze.',
    roleRankingEmpty: '📋 Brak graczy z rolą **{roleName}** w rankingu.',
    analyzeNoImage: '❌ Brak zdjęcia w raporcie.',
    analyzeError: '❌ Błąd analizy: {error}',

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
    limitCooldownLabel: 'Cooldown po użyciu (np. 5m, 1h, 1h30m)',
    limitCooldownPlaceholder: 'np. 5m',
    limitRemoved: '✅ Dzienny limit użyć został **usunięty** — brak ograniczeń.',
    limitInvalidValue: '❌ Podaj dodatnią liczbę całkowitą lub zostaw pole puste (brak limitu).',
    limitSet: '✅ Dzienny limit ustawiony na **{limit}** użycie(ia) komend /update i /test na użytkownika.',
    limitCooldownSet: '✅ Cooldown ustawiony na **{cooldown}**.',
    limitCooldownRemoved: '✅ Cooldown usunięty — brak ograniczenia czasu między użyciami.',
    limitCooldownInvalid: '❌ Nieprawidłowy format cooldownu. Użyj np. `5m`, `1h`, `1h30m`.',

    // Modal blokady użytkownika
    blockUserModalTitle: 'Zablokuj użytkownika',
    blockUserTimeLabel: 'Czas blokady (np. 1h, 7d, 30m)',

    // /achievements
    achievementsTitle: '🏆 Twoje Osiągnięcia',
    achievementsOverviewTitle: '📊 Przegląd Osiągnięć',
    achievementsEmpty: '❌ Nie masz jeszcze żadnych osiągnięć. Graj i bądź aktywny!',
    achievementsPage: 'Strona {current} z {total} • {count} odblokowanych z {total_ach}',
    achievementsUnlockedOf: '{count} z {total} odblokowanych',
    achievementsBtnUnlocked: '🏆 Odblokowane',
    achievementsBtnOverview: '📊 Podsumowanie',
    achievementsNewField: '🎉 Nowe osiągnięcia',
    blockUserTimePlaceholder: 'Zostaw puste dla blokady permanentnej',

    // /info
    infoPreview: '**Podgląd** — wiadomość zostanie wysłana na **{count}** serwer(ów):',
    infoSessionExpired: 'Sesja wygasła. Użyj `/info` ponownie.',

    // Brak konfiguracji
    notConfigured: '⚙️ EndersEcho nie jest jeszcze skonfigurowany na tym serwerze. Administrator musi użyć **/configure**.',

    // Embed odrzuconego screena
    reportTitle: '🚫 ANALIZA ODRZUCONA',
    reportFieldNick: '👤 Nick na serwerze',
    reportFieldServer: 'Serwer',
    reportFieldTime: '🕐 Czas',
    reportFieldReason: '⛔ Powód odrzucenia',
    reportFieldCurrentRecord: '📊 Aktualny rekord',
    reportFieldNoRecord: 'Brak rekordu',
    reportFieldAiDetails: '🔍 Szczegóły AI',
    reportReasonFakePhoto: '🔴 Wykryto podrobione / edytowane zdjęcie',
    reportReasonInvalidScreenshot: '🟡 Nie znaleziono ekranu Victory (ang. i jap.)',
    reportReasonNoRequiredWords: '🟡 Brak wymaganych słów Best/Total',
    reportReasonNotSimilar: '🟡 Zdjęcie nie pasuje do wzorca (komenda /update)',
    reportReasonInvalidScoreFormat: '🟠 Odczytany wynik nie posiada prawidłowej jednostki (K/M/B/T/Q/Qi/Sx/Sp)',
    reportReasonBestExceedsTotal: '🔴 Odczytany Best przekracza wartość Total',
    reportBtnApprove: 'Zatwierdź',
    reportBtnBlock: 'Zablokuj użytkownika',
    reportBtnAnalyze: 'Analizuj',
    analyzeConfirmQuestion: '🔍 Czy chcesz przeanalizować to zdjęcie i zapisać wynik dla tego gracza?\n\n⚠️ **Uwaga:** Przeanalizowanie nieprawidłowego zdjęcia może doprowadzić do halucynacji AI — wynik zostanie zmyślony, co zaburzy ranking.',
    analyzeConfirmYes: '✅ Tak, analizuj',
    analyzeConfirmNo: '❌ Nie, anuluj',
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
    analyzeResultBossRecord: '🎯 Nowy rekord na bossie!',
    analyzeResultNoRecord: 'Nie pobito rekordu',
    analyzeResultUnknown: 'nieznany',
    analyzeManualAnnouncement: '<@{userId}> Twój wynik został zweryfikowany manualnie przez administratora **{adminName}**.',
    analyzeFailNoRecordMessage: '❌ **{userName}** nie pobił rekordu',
    analyzeFailReasonField: 'Powód odrzucenia',

    // /ocr-on-off per-guild
    ocrBlockPerGuildEnabled: '🔒 Komendy **{commands}** wyłączone na serwerze **{serverName}**.',
    ocrBlockPerGuildDisabled: '🔓 Komendy **{commands}** włączone na serwerze **{serverName}**.',
    ocrGuildNotFound: '❌ Serwer nie znaleziony lub nie skonfigurowany.',

    // /configure — wspólne
    configureNotAdmin: '❌ Ta komenda jest dostępna tylko dla administratora serwera oraz moderatorów.',
    manageNotAdmin: '❌ Ta komenda jest dostępna tylko dla administratora serwera.',
    modInvalidId: '❌ Podaj prawidłowe ID użytkownika Discord (17–20 cyfr).',
    modAlreadyExists: '⚠️ Ten użytkownik jest już moderatorem gry na tym serwerze.',
    configureCancelled: '❌ Konfiguracja anulowana. Poprzednie ustawienia pozostają bez zmian.',
    configureTagTooLong: '❌ Tag może mieć maksymalnie 4 znaki.',
    configureTagEmpty: '❌ Tag nie może być pusty.',

    // Weryfikacja społeczności
    cvVoteButton: '⚠️ Zgłoś',
    cvReported: '⚠️ Zgłoszono',
    cvVoteAlreadyVoted: '⚠️ Już zgłosiłeś ten wynik.',
    cvVoteNotInRanking: '⚠️ Możesz głosować tylko jeśli jesteś w rankingu.',
    cvVoteSelf: '⚠️ Nie możesz zgłosić własnego wyniku.',
    cvVoteHeadAdminOnly: '⚠️ Ten wynik może zgłosić wyłącznie jego właściciel (tryb testowy CV).',
    cvVoteInvalid: '⚠️ Ta sesja głosowania jest nieaktywna.',
    cvVoteRegistered: '✅ Zgłoszenie zarejestrowane ({count}/{threshold}).',
    cvReportTitle: '🚨 Zgłoszenie przez społeczność',
    cvReportFieldUser: '👤 Użytkownik',
    cvReportFieldServer: 'Serwer',
    cvReportFieldScore: '🎯 Nowy wynik',
    cvReportFieldPrev: '📈 Poprzedni wynik',
    cvReportFieldBoss: '👾 Boss',
    cvReportFieldVotes: '📣 Zgłoszeń',
    cvReportFieldLink: '🔗 Link do wiadomości',
    cvReportBtnApprove: 'Zatwierdź',
    cvReportBtnRemove: 'Usuń rekord i osiągnięcia',
    cvReportBtnBlock: 'Zablokuj permanentnie + usuń rekord',
    cvAdminApproved: '✅ Zatwierdzone przez **{adminName}** — użytkownik odblokowany.',
    cvAdminRemoved: '🗑️ Rekord usunięty przez **{adminName}** — poprzedni wynik przywrócony.',
    cvAdminBlocked: '🔒 Użytkownik zablokowany permanentnie przez **{adminName}** — rekord usunięty.',
    cvUserBlocked: '🔒 Twój wynik zgłoszony przez społeczność. Możliwość przesyłania wyników zablokowana na 24h lub do weryfikacji przez administratora.',
    cvBtnStatusApproved: '✅ Zatwierdzone przez admina',
    cvBtnStatusRemoved: '🗑️ Usunięte przez admina',

    // Per-boss rekord (w embedzie ogłoszenia + w embedzie braku rekordu)
    bossRecordField: 'Rekord na bossie',
    bossRecordFirst: 'pierwszy wynik na tym bossie!',
    bossRecordUpdated: '👾 Nowy rekord na bossie',
    bossRecordOnlyStatus: '👾 Pobito rekord na bossie! Rekord globalny bez zmian (obecny: {currentScore})',
    unknownBossAccepted: '⚠️ Wynik zapamiętany — nazwa bossa nierozpoznana. Po weryfikacji przez admina wpis zostanie zaktualizowany lub usunięty z rankingu.',
    unknownBossRankingNotice: 'Wykryto **nową nazwę bossa**: *{bossName}*\nWynik **nie pojawi się w rankingu bossów** do czasu weryfikacji przez admina.\nPo weryfikacji: nazwa zostanie dodana jako alias lub wynik zostanie cofnięty do poprzedniego stanu.',
    unknownBossRankingField: 'Niezweryfikowana nazwa bossa',
    bossRecordOnlyConfirmed: '✅ **Nowy rekord na bossie ogłoszony!** 👾 Twój wynik na tym bossie został opublikowany.',
    bossRecordPublicTitle: '👾 Nowy Rekord Bossa!',

    // Ranking bossów / osiągnięć
    buttonBossRanking: 'Ranking Bossów',
    buttonAchRanking: 'Ranking Osiągnięć',
    bossRankingTitle: '👾 Ranking',
    bossRankingSelectTitle: '👾 Wybierz bossa',
    bossRankingSelectDesc: 'Wybierz bossa z listy aby zobaczyć globalny ranking.',
    bossRankingSelectPlaceholder: 'Wybierz bossa...',
    bossRankingNoBosses: '📭 Brak wyników bossów do wyświetlenia.\nGracze muszą wysyłać screeny przez `/update` aby pojawili się w rankingu.',
    bossRankingBackList: 'Lista bossów',
    bossRankingPlayers: 'graczy',

    // Panel bossów — zdjęcie
    bossCfgSetImg: 'Przypisz zdjęcie',
    bossCfgImgSelectBoss: 'Wybierz bossa do przypisania zdjęcia:',
    bossCfgImgSelectPlaceholder: 'Wybierz bossa...',
    bossCfgImgWaiting: '🖼️ Wyślij zdjęcie bossa jako wiadomość na tym kanale.\nObsługiwane formaty: jpg, png, gif, webp.\n\n⏳ Czekam **60 sekund**...',
    bossCfgImgSuccess: '✅ Zdjęcie przypisane do bossa **{bossName}**.',
    bossCfgImgTimeout: '⏱️ Upłynął czas oczekiwania na zdjęcie. Użyj przycisku ponownie.',
    bossCfgImgNoAttachment: '❌ Wiadomość nie zawiera zdjęcia.',
    bossCfgImgInvalidType: '❌ Nieobsługiwany format pliku. Użyj: jpg, png, gif, webp.',

    // /profile
    profileNotFound: '❌ Nie znaleziono gracza zawierającego "**{query}**" w żadnym rankingu.',
    profileMultipleResults: '🔍 Znaleziono **{count}** graczy. Wybierz gracza:',
    profileSelectPlaceholder: 'Wybierz gracza...',
    profileSearchLabel: 'Wpisz fragment nicku gracza',
    profileSearchTitle: '🔍 Szukaj gracza',
    profileExpired: '❌ Ta sesja profilu wygasła. Użyj `/profile` ponownie.',
    profileWrongUser: '❌ Możesz obsługiwać tylko swój własny profil.',
    profileNoData: '⚠️ Gracz nie ma żadnych danych w rankingu.',
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
    roleRankingTitle: '🎖️ Role Ranking: {roleName}',
    rankingStats: 'Statistics',
    rankingStatsGlobal: 'Global statistics',
    rankingPlayersCount: '👥 Players: {count}',
    rankingServersCount: '🌍 Servers: {count}',
    rankingTotalPlayers: '👥 Total players: {count}',
    rankingHighestScore: '🏆 Highest score: {score}',
    rankingPage: 'Page {current} of {total}',
    rankingYourStats: '👤 Your stats',
    rankingYourScore: 'Score',
    rankingYourServerPos: 'On server',
    rankingYourGlobalPos: 'Global',
    rankingNotInRanking: 'You are not in the ranking yet.',
    chartTitle: '📈 Score History',
    globalPlayerGrowthChartTitle: '📊 Unique Player Growth',

    // Player ranking position
    rankingPosition: 'Ranking position: {pos}',
    rankingPositionNew: 'Ranking position: {pos} (new entry)',
    rankingPositionPromotion: 'Ranking position: {pos} (promoted by +{change})',

    // /update — processing (step by step progress)
    updateDownloading: '📥 Downloading image...',
    updateComparingTemplate: '🔍 Checking image against template...',
    updateRetryTemplate: '⏳ API overloaded — retrying template check (attempt {attempt}/{total})...',
    updateExtractingData: '✅ Match confirmed — reading record data...',
    updateRetryExtract: '⏳ API overloaded — retrying data extraction (attempt {attempt}/{total})...',
    updateSaving: '💾 Saving data...',
    updateNotImage: '❌ The attached file is not an image! Supported formats: PNG, JPG, JPEG, GIF, BMP',
    updateFileTooLarge: '❌ File is too large! Maximum size: **{maxMB}MB**, your file: **{fileMB}MB**\n💡 **Tip:** Reduce image quality or use compression.',
    updateNoRequiredWords: '❌ The image does not contain a valid result screen.\n💡 **Tip:** Make sure you are submitting a screenshot from a completed run!',
    updateNoScore: '❌ Could not extract a score from the image.\n💡 **Check that:**\n• The image contains the word "Best" with a score\n• The text is readable\n• The score has a unit (K/M/B/T/Q/Qi/Sx/Sp) or is a large number',
    updateSuccess: '✅ Your score has been successfully saved and announced!',
    updateError: '❌ An error occurred while processing the image. Please try again.',
    updateAiOverloaded: '⚠️ The AI service is currently experiencing high demand. Please try again in a moment.',

    // AI OCR
    aiOcrUnavailable: '⚠️ AI OCR unavailable, falling back to traditional OCR...',
    fakePhotoDetected: '🚫 **FAKE PHOTO DETECTED!**\n\nYour image has been identified as falsified or modified. The score will not be accepted.\n\n⚠️ Editing screenshots is not allowed!',

    // New record — ephemeral announcement
    newRecordConfirmed: '✅ **New record set and announced!**\n🏆 Congratulations! Your score has been published for everyone.',
    newRecordFallback: '🏆 **NEW RECORD!**\n**Player:** {username}\n**New record:** {score}\n**Previous:** {previous}\n\n*Error sending full embed*',
    resultNotBeatenCrossServer: '❌ Record not beaten — you already have a higher score (**{score}**) on server **{guildName}**.',
    crossServerScoreRemovedNotice: '⚠️ Your last score **{score}** on server **{oldGuildName}** will no longer be visible in the server ranking.\nFrom now on you appear in the ranking on server **{newGuildName}**.\nYour score history has been preserved.',
    crossServerMigratedNotice: 'Your score has been migrated\nYour score has been moved from the ranking of server **{oldGuildName}** to the ranking of server **{newGuildName}**.\nYour score history has been preserved.',
    crossServerBossKeptField: 'Global record remains unchanged',
    crossServerBossKeptValue: 'Your best score **{score}** stays on server **{guildName}** — it was not moved. Here you only set a new record on this boss.',
    noRecordFallback: '❌ Record not beaten\n**Player:** {username}\n**Score:** {score}\n**Current record:** {current}\n\n*Error sending embed with image*',
    rankingImageCaption: '📎 **Original result image:**',

    // Embed — result (no record)
    resultScore: 'Score from image',
    resultNotBeaten: '❌ Record not beaten (current: {currentScore})',
    resultDifference: '**Difference:** {diff}',
    resultDetailsField: 'Score details',

    // Embed — new record
    recordTitle: '🏆 CONGRATULATIONS!',
    recordDescription: '## {username} broke their record!',
    recordNewScore: '🏆 Score',
    recordProgress: '📈 Progress',
    recordRanking: '🏅 Position',
    recordBossRanking: '👾 Position (boss)',
    recordPromotionBy: 'promoted by',
    recordNewEntry: 'new entry',
    recordDateLabel: '📅 Date',
    recordPreviousRecordAgo: 'previous record',
    recordAgo: 'ago',
    recordDateLocale: 'en-GB',
    recordFollowerLabel: '🔔 SUBSCRIPTIONS:',

    // Multi-embed /update announcement (section headers)
    globalRankingEmbedTitle: 'Global Ranking',
    bossRankingEmbedTitle: 'Boss Ranking',
    systemInfoEmbedTitle: 'Submission Analysis',
    systemInfoAllGood: 'Screenshot verified successfully.\nScore saved to the ranking.',
    snippetPositionChange: 'Position change:',

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
    buttonPrev: 'Previous',
    buttonNext: 'Next',
    buttonMyPos: 'My position',
    buttonServerPos: 'Server position',
    buttonGlobal: 'Global',
    buttonServerRanking: 'Server Ranking',
    buttonIndividualRanking: 'Individual Ranking',
    buttonBack: 'Server rankings',
    guildRankingTitle: '🏛️ Server Ranking',
    guildRankingFooter: 'Sum of top 30 players per server',
    guildRankingPlayers: 'players',
    guildRankingBest: 'best',

    // TOP roles
    topRoleUpdated: '🏆 TOP roles have been updated!',
    topRoleError: '❌ Error updating TOP roles',
    topRoleAssigned: '✅ Role {roleName} assigned to {username}',
    topRoleRemoved: '🗑️ Role {roleName} removed from {username}',

    // Global TOP snippet (under result)
    globalSnippetTitle: '🌐 Global Ranking Change',
    bossSnippetTitle: '👾 Boss Ranking Change',

    // Global TOP10 periodic report
    globalTop10ReportTitle: '🌐 Global TOP 10',
    globalTop10BossField: '⚔️ Boss of the period',
    globalTop10Footer: 'Next report in 3 days',
    globalTop10FooterBreak: 'Next report in 4 days (break)',
    globalTop10FooterNext: 'Next report in {days} days',

    // /subscribe
    notifDescription: '🔔 Manage notifications for player record breaks.',
    notifSetButton: 'Set notification',
    notifRemoveButton: 'Remove notification',
    notifSelectServer: '🌍 Select a server:',
    notifSelectServerPlaceholder: 'Choose a server...',
    notifSelectPlayer: '👤 Select a player from the ranking:',
    notifSelectPlayerPlaceholder: 'Choose a player...',
    notifNoPlayers: '📭 No players in this server\'s ranking.',
    notifConfirmText: 'Do you want to receive notifications when **{username}** from server **{guild}** breaks a record?\n\nYou will receive a private message with the full announcement and screenshot.',
    notifConfirmYes: 'Yes, subscribe',
    notifConfirmNo: 'Cancel',
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
    notifDmScoresEqual: '🎯 Scores are equal!',

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
    commandError: '❌ An error occurred while processing the command.',
    gatewayRateLimited: '⏱️ Too many requests. Try again in{retry}.',
    gatewayNotEntitled: '🔒 This operation is not available for this server.',
    gatewayDefault: '❌ Request rejected by the gateway.',

    // User block
    userBlocked: '🚫 Your account has been blocked due to submitting a fake screenshot. Contact a server administrator to appeal.',

    // Daily limit
    dailyLimitExceeded: '❌ You have reached the daily limit of **{limit}** uses of /update and /test. Try again tomorrow.',

    // Update cooldown
    updateCooldown: '⏱️ You must wait **{time}** more before using `/update` again.',

    // /test — requirements and verification
    testAiOcrRequired: '❌ The `/test` command requires AI OCR to be enabled (`USE_ENDERSECHO_AI_OCR=true`).',
    analyzeBtn: 'Analyze',

    // Role rankings
    roleRankingServerError: '❌ Unable to fetch server data.',
    roleRankingLimitReached: '❌ Reached the limit of **{max}** role rankings. Remove an existing one before adding a new one.',
    roleRankingAdded: '✅ Added ranking for role **{roleName}**. It will appear in the `/ranking` command when this server is selected.',
    roleRankingNoRankings: '⚠️ No role rankings configured on this server.',
    roleRankingEmpty: '📋 No players with role **{roleName}** in the ranking.',
    analyzeNoImage: '❌ No image found in the report.',
    analyzeError: '❌ Analysis error: {error}',

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
    limitCooldownLabel: 'Cooldown after use (e.g. 5m, 1h, 1h30m)',
    limitCooldownPlaceholder: 'e.g. 5m',
    limitRemoved: '✅ Daily usage limit has been **removed** — no restrictions.',
    limitInvalidValue: '❌ Enter a positive integer or leave the field empty (no limit).',
    limitSet: '✅ Daily limit set to **{limit}** use(s) of /update and /test per user.',
    limitCooldownSet: '✅ Cooldown set to **{cooldown}**.',
    limitCooldownRemoved: '✅ Cooldown removed — no time limit between uses.',
    limitCooldownInvalid: '❌ Invalid cooldown format. Use e.g. `5m`, `1h`, `1h30m`.',

    // User block modal
    blockUserModalTitle: 'Block user',
    blockUserTimeLabel: 'Block duration (e.g. 1h, 7d, 30m)',

    // /achievements
    achievementsTitle: '🏆 Your Achievements',
    achievementsOverviewTitle: '📊 Achievement Overview',
    achievementsEmpty: '❌ No achievements yet. Play and stay active!',
    achievementsPage: 'Page {current} of {total} • {count} unlocked of {total_ach}',
    achievementsUnlockedOf: '{count} of {total} unlocked',
    achievementsBtnUnlocked: '🏆 Unlocked',
    achievementsBtnOverview: '📊 Overview',
    achievementsNewField: '🎉 New achievements',
    blockUserTimePlaceholder: 'Leave empty for permanent block',

    // /info
    infoPreview: '**Preview** — message will be sent to **{count}** server(s):',
    infoSessionExpired: 'Session expired. Use `/info` again.',

    // Not configured
    notConfigured: '⚙️ EndersEcho is not configured yet on this server. An administrator must run **/configure**.',

    // Rejected screenshot embed
    reportTitle: '🚫 REJECTED ANALYSIS',
    reportFieldNick: '👤 Server Nickname',
    reportFieldServer: 'Server',
    reportFieldTime: '🕐 Time',
    reportFieldReason: '⛔ Rejection Reason',
    reportFieldCurrentRecord: '📊 Current Record',
    reportFieldNoRecord: 'No record',
    reportFieldAiDetails: '🔍 AI Details',
    reportReasonFakePhoto: '🔴 Fake or edited photo detected',
    reportReasonInvalidScreenshot: '🟡 Victory screen not found (EN/JP)',
    reportReasonNoRequiredWords: '🟡 Required words Best/Total not found',
    reportReasonNotSimilar: '🟡 Image does not match the template (/update)',
    reportReasonInvalidScoreFormat: '🟠 Extracted score has no valid unit (K/M/B/T/Q/Qi/Sx/Sp)',
    reportReasonBestExceedsTotal: '🔴 Extracted Best exceeds Total value',
    reportBtnApprove: 'Approve',
    reportBtnBlock: 'Block User',
    reportBtnAnalyze: 'Analyze',
    analyzeConfirmQuestion: '🔍 Do you want to analyze this image and save the result for this player?\n\n⚠️ **Warning:** Analyzing an invalid image may cause AI hallucinations — the score will be fabricated, which will distort the ranking.',
    analyzeConfirmYes: '✅ Yes, analyze',
    analyzeConfirmNo: '❌ No, cancel',
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
    analyzeResultBossRecord: '🎯 New boss record!',
    analyzeResultNoRecord: 'No record broken',
    analyzeResultUnknown: 'unknown',
    analyzeManualAnnouncement: '<@{userId}> Your score was manually verified by administrator **{adminName}**.',
    analyzeFailNoRecordMessage: '❌ **{userName}** did not beat the record',
    analyzeFailReasonField: 'Rejection reason',

    // /ocr-on-off per-guild
    ocrBlockPerGuildEnabled: '🔒 Commands **{commands}** disabled on server **{serverName}**.',
    ocrBlockPerGuildDisabled: '🔓 Commands **{commands}** enabled on server **{serverName}**.',
    ocrGuildNotFound: '❌ Server not found or not configured.',

    // /configure — common
    configureNotAdmin: '❌ This command is only available to server administrators and moderators.',
    manageNotAdmin: '❌ This command is only available to server administrators.',
    modInvalidId: '❌ Please provide a valid Discord user ID (17–20 digits).',
    modAlreadyExists: '⚠️ This user is already a game moderator on this server.',
    configureCancelled: '❌ Configuration cancelled. Previous settings remain unchanged.',
    configureTagTooLong: '❌ The tag can have a maximum of 4 characters.',
    configureTagEmpty: '❌ The tag cannot be empty.',

    // Community verification
    cvVoteButton: '⚠️ Report',
    cvReported: '⚠️ Reported',
    cvVoteAlreadyVoted: '⚠️ You have already reported this score.',
    cvVoteNotInRanking: '⚠️ Only players in the ranking can vote.',
    cvVoteSelf: '⚠️ You cannot report your own score.',
    cvVoteHeadAdminOnly: '⚠️ Only the record owner can report this score (CV test mode).',
    cvVoteInvalid: '⚠️ This voting session is no longer active.',
    cvVoteRegistered: '✅ Report registered ({count}/{threshold}).',
    cvReportTitle: '🚨 Community Report',
    cvReportFieldUser: '👤 User',
    cvReportFieldServer: 'Server',
    cvReportFieldScore: '🎯 New Score',
    cvReportFieldPrev: '📈 Previous Score',
    cvReportFieldBoss: '👾 Boss',
    cvReportFieldVotes: '📣 Reports',
    cvReportFieldLink: '🔗 Message Link',
    cvReportBtnApprove: 'Approve',
    cvReportBtnRemove: 'Remove Record & Achievements',
    cvReportBtnBlock: 'Permanent Ban + Remove Record',
    cvAdminApproved: '✅ Approved by **{adminName}** — user unblocked.',
    cvAdminRemoved: '🗑️ Record removed by **{adminName}** — previous score restored.',
    cvAdminBlocked: '🔒 User permanently blocked by **{adminName}** — record removed.',
    cvUserBlocked: '🔒 Your score has been reported by the community. Score submission blocked for 24h or until administrator review.',
    cvBtnStatusApproved: '✅ Approved by admin',
    cvBtnStatusRemoved: '🗑️ Removed by admin',

    // Per-boss record (in announcement embed + no-record embed)
    bossRecordField: 'Boss Record',
    bossRecordFirst: 'first score on this boss!',
    bossRecordUpdated: '👾 New Boss Record',
    bossRecordOnlyStatus: '👾 Boss record beaten! Global record unchanged (current: {currentScore})',
    unknownBossAccepted: '⚠️ Score noted — boss name unrecognized. After admin verification, the entry will be updated or removed from the ranking.',
    unknownBossRankingNotice: '**New boss name** detected: *{bossName}*\nThe score **won\'t appear in the boss ranking** until verified by an admin.\nAfter verification: the name will be added as an alias or the score will be reverted.',
    unknownBossRankingField: 'Unverified Boss Name',
    bossRecordOnlyConfirmed: '✅ **New boss record announced!** 👾 Your score on this boss has been published.',
    bossRecordPublicTitle: '👾 New Boss Record!',

    // Boss / achievement rankings
    buttonBossRanking: 'Boss Rankings',
    buttonAchRanking: 'Achievement Ranking',
    bossRankingTitle: '👾 Ranking',
    bossRankingSelectTitle: '👾 Select a Boss',
    bossRankingSelectDesc: 'Choose a boss from the list to view the global ranking.',
    bossRankingSelectPlaceholder: 'Choose a boss...',
    bossRankingNoBosses: '📭 No boss records to display yet.\nPlayers need to submit screenshots via `/update` to appear in the ranking.',
    bossRankingBackList: 'Boss list',
    bossRankingPlayers: 'players',

    // Boss config panel — image
    bossCfgSetImg: 'Set Image',
    bossCfgImgSelectBoss: 'Select a boss to assign an image:',
    bossCfgImgSelectPlaceholder: 'Select a boss...',
    bossCfgImgWaiting: '🖼️ Send the boss image as a message in this channel.\nSupported formats: jpg, png, gif, webp.\n\n⏳ Waiting **60 seconds**...',
    bossCfgImgSuccess: '✅ Image assigned to boss **{bossName}**.',
    bossCfgImgTimeout: '⏱️ Timed out waiting for an image. Use the button again.',
    bossCfgImgNoAttachment: '❌ Message contains no image attachment.',
    bossCfgImgInvalidType: '❌ Unsupported file type. Use: jpg, png, gif, webp.',

    // /profile
    profileNotFound: '❌ No player found containing "**{query}**" in any ranking.',
    profileMultipleResults: '🔍 Found **{count}** players. Select a player:',
    profileSelectPlaceholder: 'Select a player...',
    profileSearchLabel: 'Enter part of the player\'s nick',
    profileSearchTitle: '🔍 Search Player',
    profileExpired: '❌ This profile session has expired. Use `/profile` again.',
    profileWrongUser: '❌ You can only manage your own profile.',
    profileNoData: '⚠️ Player has no data in the ranking.',
};

module.exports = { pol, eng };
