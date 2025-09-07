module.exports = {
    // Błędy ogólne
    fileTooBig: '❌ **Plik jest za duży!** Maksymalny rozmiar to 8MB.',
    userInfoError: '❌ **Błąd podczas pobierania informacji o użytkowniku.**',
    analysisError: '❌ **Wystąpił błąd podczas analizy zdjęcia**',
    roleError: '⚠️ **Błąd podczas przyznawania roli**',
    
    // Analiza w toku
    analysisStarted: '🔄 **Analizuję Twoje zdjęcie...**\n⏳ To może potrwać kilka sekund.\n📊 Preprocessing obrazu...',
    downloading: '🔄 **Analizuję Twoje zdjęcie...**\n⏳ Pobieranie obrazu...',
    preprocessing: '🔄 **Analizuję Twoje zdjęcie...**\n📊 Preprocessing obrazu...',
    ocr: '🔄 **Analizuję Twoje zdjęcie...**\n📖 Rozpoznawanie tekstu (OCR)...\n🔍 Szukam nicku...',
    
    // Wyniki negatywne
    nickNotFound: '❌ **Nie znaleziono Twojego nicku na zdjęciu**',
    nickRequiredTwice: '\n⚠️ **Wymagane:** Nick musi wystąpić co najmniej **dwa razy** na zdjęciu',
    nickFoundButNoScore: '❌ **Znaleziono nick, ale brak prawidłowego wyniku**',
    nickInFirstLines: '❌ **Wszystkie wystąpienia nicku w pierwszych {skipLines} liniach**\n⚠️ **Wyniki nie mogą być analizowane z pierwszych {skipLines} linii tekstu**',
    scoreInsufficient: '❌ **Wynik niewystarczający**\n🎯 **Twój wynik:** {score}\n📊 **Wymagane minimum:** {minimum}',
    
    // Wyniki pozytywne
    analysisSuccess: '✅ **Analiza zakończona pomyślnie!**\n🎯 **Wynik:** {score}\n🏆 **Przyznano rolę:** {role}',
    analysisAlreadyHasRole: '✅ **Analiza zakończona!**\n🎯 **Wynik:** {score}\nℹ️ **Już posiadasz wymaganą rolę**',
    
    // Informacje o loteriach
    dailyLottery: '\n\nBierzesz udział w loterii Daily.\n**Nie musisz nic robić!** Wyniki pojawią się na jednym z poniższych kanałów w stosownym czasie!\nhttps://discord.com/channels/1170323970692743240/1257784287864815677 https://discord.com/channels/1170323970692743240/1297845241256218664 https://discord.com/channels/1170323970692743240/1261921367935287398 https://discord.com/channels/1170323970692743240/1262153143630958762\n{lotteryInfo}',
    cxLottery: '\n\nBierzesz udział w loterii CX.\n**Nie musisz nic robić!** Wyniki pojawią się na jednym z poniższych kanałów w stosownym czasie!\nhttps://discord.com/channels/1170323970692743240/1257784287864815677 https://discord.com/channels/1170323970692743240/1297845241256218664 https://discord.com/channels/1170323970692743240/1261921367935287398 https://discord.com/channels/1170323970692743240/1262153143630958762\n{lotteryInfo}',
    
    // Dodatkowe informacje
    similarityMatch: '\n🔍 **Dopasowanie:** Nick znaleziony przez podobieństwo',
    
    // Blokowanie użytkowników z karą
    penaltyBlocked: '❌ **Udział w loteriach został zablokowany**\n⚠️ **Powód:** Uzbierałeś za dużo punktów kary\n🚫 **Nie możesz przesyłać zdjęć na kanały Daily oraz CX**'
};