const Anthropic = require('@anthropic-ai/sdk');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Konklawe');

/**
 * AI Service - Obsługa generowania haseł i podpowiedzi przez Anthropic API
 */
class AIService {
    constructor(config, dataService) {
        this.config = config;
        this.dataService = dataService;

        // Anthropic API
        this.apiKey = process.env.KONKLAWE_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
        this.enabled = !!this.apiKey;

        if (this.enabled) {
            this.client = new Anthropic({ apiKey: this.apiKey });
            this.model = process.env.KONKLAWE_AI_MODEL || 'claude-3-haiku-20240307';
            logger.success('✅ AI Service aktywny - model: ' + this.model);
        } else {
            logger.warn('⚠️ AI Service wyłączony - brak KONKLAWE_ANTHROPIC_API_KEY lub ANTHROPIC_API_KEY');
        }
    }

    /**
     * Generuje hasło przez AI (stara metoda - jedno hasło)
     * @returns {Promise<string|null>} - Wygenerowane hasło lub null gdy błąd
     */
    async generatePassword() {
        if (!this.enabled) {
            logger.error('❌ AI Service nie jest dostępny');
            return null;
        }

        const maxRetries = 3;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                logger.info(`🤖 Generowanie hasła przez AI (próba ${attempt}/${maxRetries})...`);

                const response = await this.client.messages.create({
                    model: this.model,
                    max_tokens: 50,
                    messages: [{
                        role: 'user',
                        content: 'Gramy w grę w zgadywanie haseł. Wymyśl TYLKO JEDNO SŁOWO - trudne hasło do odgadnięcia. Hasło nie powinno być przesadnie długim słowem, max kilkanaście znaków. Hasło musi być rzeczownikiem. WAŻNE: Odpowiedz WYŁĄCZNIE jednym słowem, bez żadnych dodatkowych słów, znaków interpunkcyjnych czy wyjaśnień. Hasło powinno być wyszukane. Hasło musi być prawdziwe, nie może być słowem, które nie istnieje. Hasło powinno zawierać się w słowniku języka Polskiego.'
                    }]
                });

                const password = response.content[0].text.trim();

                // Walidacja - sprawdź czy to tylko jedno słowo
                if (password.includes(' ') || password.includes('\n')) {
                    logger.warn(`⚠️ AI zwróciło więcej niż jedno słowo: "${password}" - powtarzam zapytanie...`);
                    continue; // Próbuj ponownie
                }

                logger.success(`✅ AI wygenerowało hasło: ${password}`);
                return password;
            } catch (error) {
                logger.error(`❌ Błąd podczas generowania hasła przez AI (próba ${attempt}/${maxRetries}): ${error.message}`);

                // Jeśli to ostatnia próba, zwróć null
                if (attempt === maxRetries) {
                    return null;
                }
            }
        }

        // Jeśli wszystkie próby się wyczerpały
        logger.error('❌ Nie udało się wygenerować hasła po 3 próbach');
        return null;
    }

    /**
     * Generuje wiele haseł przez AI (nowa metoda)
     * @param {number} count - Liczba haseł do wygenerowania (domyślnie 3)
     * @returns {Promise<string[]|null>} - Tablica wygenerowanych haseł lub null gdy błąd
     */
    async generatePasswords(count = 3) {
        if (!this.enabled) {
            logger.error('❌ AI Service nie jest dostępny');
            return null;
        }

        try {
            logger.info(`🤖 Generowanie ${count} haseł przez AI...`);

            // Pobierz historię haseł (max 50)
            const gameHistory = this.dataService.loadGameHistory();
            const previousPasswords = gameHistory.completedGames
                .map(game => game.password)
                .slice(0, 50);

            const passwordsText = previousPasswords.length > 0
                ? `„${previousPasswords.join('", „')}"`
                : 'Brak poprzednich haseł';

            const prompt = `Gramy w grę w zgadywanie haseł. Wygeneruj DOKŁADNIE ${count} trudne hasła do odgadnięcia, każde w nowej linii.

WYMAGANIA:
1. Każde hasło musi być JEDNYM SŁOWEM (rzeczownikiem)
2. Maksymalnie kilkanaście znaków na słowo
3. Hasła muszą być prawdziwe (ze słownika języka polskiego)
4. Hasła powinny być wyszukane
5. ⛔ ZAKAZ używania znaków specjalnych: kropka, przecinek, myślnik, apostrof, cudzysłów itp.
6. ⛔ ABSOLUTNY ZAKAZ powtarzania tych haseł:
${passwordsText}

Odpowiedź TYLKO hasłami, każde w nowej linii, bez numeracji, bez dodatkowych słów.`;

            const response = await this.client.messages.create({
                model: this.model,
                max_tokens: 150,
                messages: [{
                    role: 'user',
                    content: prompt
                }]
            });

            const passwords = response.content[0].text
                .trim()
                .split('\n')
                .map(p => p.trim())
                .filter(p => p.length > 0 && !p.includes(' ') && !/[.,\-'"!?;:()]/.test(p))
                .slice(0, count);

            if (passwords.length < count) {
                logger.warn(`⚠️ AI wygenerowało tylko ${passwords.length}/${count} prawidłowych haseł`);
            }

            if (passwords.length === 0) {
                logger.error('❌ AI nie wygenerowało żadnych prawidłowych haseł');
                return null;
            }

            logger.success(`✅ AI wygenerowało ${passwords.length} haseł: ${passwords.join(', ')}`);
            return passwords;
        } catch (error) {
            logger.error(`❌ Błąd podczas generowania haseł przez AI: ${error.message}`);
            return null;
        }
    }

    /**
     * Generuje podpowiedź przez AI
     * @param {string} password - Hasło do którego generujemy podpowiedź
     * @param {Array<string>} previousHints - Poprzednie podpowiedzi
     * @returns {Promise<string|null>} - Wygenerowana podpowiedź lub null gdy błąd
     */
    async generateHint(password, previousHints = []) {
        if (!this.enabled) {
            logger.error('❌ AI Service nie jest dostępny');
            return null;
        }

        try {
            logger.info('🤖 Generowanie podpowiedzi przez AI...');

            const hintsText = previousHints.length > 0
                ? `„${previousHints.join('", „')}"`
                : 'Brak poprzednich podpowiedzi';

            const prompt = `Gramy w grę w zgadywanie haseł, hasło to "${password}". Napisz podpowiedź która sprawi, że hasło wciąż będzie trudne do odgadnięcia i po dodanej podpowiedzi odpowiedź nie będzie oczywista. Podpowiedź powinna być niebanalna. Podpowiedź może zawierać od jednego do sześciu słów, powinna być maksymalnie jednym zdaniem. UWAGA, NAJWAŻNIEJSZE! PODPOWIEDŹ nie może zawierać słowa "${password}" ani żadnych jego odmian. Poprzednie podpowiedzi to:
${hintsText}
Pamiętaj, że nowa podpowiedź nie może być podobna do poprzednich. Nie pisz podpowiedzi w " ".`;

            const response = await this.client.messages.create({
                model: this.model,
                max_tokens: 150,
                messages: [{
                    role: 'user',
                    content: prompt
                }]
            });

            const hint = response.content[0].text.trim();
            logger.success(`✅ AI wygenerowało podpowiedź: ${hint}`);
            return hint;
        } catch (error) {
            logger.error(`❌ Błąd podczas generowania podpowiedzi przez AI: ${error.message}`);
            return null;
        }
    }
}

module.exports = AIService;
