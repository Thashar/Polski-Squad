module.exports = {
    // Oryginalne wiadomości przypomnienia
    reminderMessage: (timeMessage, userMentions) => 
        `# <a:X_Uwaga:1297531538186965003> PRZYPOMNIENIE O BOSSIE <a:X_Uwaga:1297531538186965003>\n${timeMessage}\n\n${userMentions}`,
    
    // Formatowanie czasu do deadline
    formatTimeMessage: (timeUntilDeadline) => {
        if (timeUntilDeadline.totalMinutes > 0) {
            if (timeUntilDeadline.hours > 0) {
                return `<a:X_Uwaga2:1297532628395622440> **Pozostały czas na zbicie bossa: ${timeUntilDeadline.hours}h ${timeUntilDeadline.minutes}min** <a:X_Uwaga2:1297532628395622440>`;
            } else {
                return `<a:X_Uwaga2:1297532628395622440> **Pozostały czas na zbicie bossa: ${timeUntilDeadline.minutes}min** <a:X_Uwaga2:1297532628395622440>`;
            }
        } else {
            return `<a:X_Uwaga2:1297532628395622440> **Czas na zbicie bossa już minął!** <a:X_Uwaga2:1297532628395622440>`;
        }
    },
    
    // Wiadomości błędów
    errors: {
        noPermission: 'Nie masz uprawnień do używania tej komendy!',
        noImage: 'Musisz załączyć obraz do analizy!',
        invalidImage: 'Nieprawidłowy format obrazu. Obsługiwane formaty: PNG, JPG, JPEG',
        ocrError: 'Wystąpił błąd podczas analizy obrazu. Spróbuj ponownie.',
        userNotFound: 'Nie znaleziono użytkownika.',
        invalidPoints: 'Nieprawidłowa liczba punktów.',
        databaseError: 'Wystąpił błąd bazy danych.',
        unknownError: 'Wystąpił nieznany błąd. Spróbuj ponownie.'
    }
};