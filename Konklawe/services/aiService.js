const Anthropic = require('@anthropic-ai/sdk');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Konklawe');

/**
 * AI Service - Obsługa generowania haseł i podpowiedzi przez Anthropic API
 */
class AIService {
    constructor(config) {
        this.config = config;

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
     * Generuje hasło przez AI
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
                        content: 'Gramy w grę w zgadywanie haseł. Wymyśl TYLKO JEDNO SŁOWO - trudne hasło do odgadnięcia. WAŻNE: Odpowiedz WYŁĄCZNIE jednym słowem, bez żadnych dodatkowych słów, znaków interpunkcyjnych czy wyjaśnień. Hasło może być wyszukane. Hasło musi być prawdziwe, nie może być słowem, które nie istnieje.'
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

            const prompt = `Gramy w grę w zgadywanie haseł, hasło to "${password}". Napisz podpowiedź która sprawi, że hasło wciąż będzie trudne do odgadnięcia, ale będzie bardzo delikatnym nakierowaniem na nie. Podpowiedź może zawierać od jednego do pięciu słów, powinna być maksymalnie jednym zdaniem. Poprzednie podpowiedzi to:
${hintsText}
Pamiętaj, że nowa podpowiedź nie może być podobna do poprzednich.`;

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
