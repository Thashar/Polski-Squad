const fs = require('fs').promises;
const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Szkolenia');

/**
 * Embedding Service - wyszukiwanie semantyczne w bazie wiedzy
 * Używa @xenova/transformers z modelem multilingual-e5-small
 * Indeks embeddingów przechowywany w pliku JSON (persistencja)
 */
class EmbeddingService {
    constructor() {
        this.indexFile = path.join(__dirname, '../data/embeddings_index.json');
        this.model = null;
        this.tokenizer = null;
        this.pipeline = null;
        this.ready = false;
        this.initializing = false;

        // Indeks: tablica { text, embedding, source }
        this.index = [];

        // Model wielojęzyczny - dobry dla polskiego
        this.modelName = 'Xenova/multilingual-e5-small';
    }

    /**
     * Inicjalizuj model embeddingów (ładowanie przy pierwszym użyciu)
     * Model pobierany jest przy pierwszym uruchomieniu (~130MB) i cache'owany lokalnie
     */
    async initialize() {
        if (this.ready || this.initializing) return;
        this.initializing = true;

        try {
            logger.info('Ładowanie modelu embeddingów...');
            const { pipeline } = await import('@xenova/transformers');

            this.pipeline = await pipeline('feature-extraction', this.modelName, {
                quantized: true // Używaj wersji kwantyzowanej (mniejsza, szybsza)
            });

            this.ready = true;
            logger.success('✅ Model embeddingów załadowany: ' + this.modelName);

            // Wczytaj istniejący indeks
            await this.loadIndex();
        } catch (error) {
            logger.error(`❌ Błąd ładowania modelu embeddingów: ${error.message}`);
            this.ready = false;
        } finally {
            this.initializing = false;
        }
    }

    /**
     * Poczekaj na gotowość modelu (max 60s)
     */
    async waitForReady(timeoutMs = 60000) {
        if (this.ready) return true;

        const start = Date.now();
        while (!this.ready && Date.now() - start < timeoutMs) {
            await new Promise(r => setTimeout(r, 500));
        }
        return this.ready;
    }

    /**
     * Generuj embedding dla tekstu
     * Prefix "query: " dla zapytań, "passage: " dla dokumentów (E5 convention)
     */
    async embed(text, isQuery = false) {
        if (!this.ready) return null;

        try {
            // E5 wymaga prefixu
            const prefixed = isQuery ? `query: ${text}` : `passage: ${text}`;

            const output = await this.pipeline(prefixed, {
                pooling: 'mean',
                normalize: true
            });

            // Konwertuj na zwykłą tablicę
            return Array.from(output.data);
        } catch (error) {
            logger.error(`❌ Błąd generowania embeddingu: ${error.message}`);
            return null;
        }
    }

    /**
     * Cosine similarity między dwoma wektorami
     */
    cosineSimilarity(a, b) {
        if (!a || !b || a.length !== b.length) return 0;

        let dot = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }

        const denom = Math.sqrt(normA) * Math.sqrt(normB);
        return denom === 0 ? 0 : dot / denom;
    }

    /**
     * Wyszukiwanie semantyczne - zwraca top K najlepiej dopasowanych fragmentów
     * @param {string} query - Zapytanie użytkownika
     * @param {number} topK - Ile wyników zwrócić
     * @param {number} threshold - Minimalny próg similarity (0-1)
     * @returns {Array<{text: string, score: number, source: string}>}
     */
    async search(query, topK = 10, threshold = 0.3) {
        if (!this.ready || this.index.length === 0) return [];

        const queryEmbedding = await this.embed(query, true);
        if (!queryEmbedding) return [];

        // Oblicz similarity dla każdego fragmentu
        const scored = this.index
            .map(item => ({
                text: item.text,
                source: item.source,
                score: this.cosineSimilarity(queryEmbedding, item.embedding)
            }))
            .filter(item => item.score >= threshold)
            .sort((a, b) => b.score - a.score)
            .slice(0, topK);

        return scored;
    }

    /**
     * Pełna reindeksacja bazy wiedzy
     * Dzieli pliki MD na sekcje i generuje embeddingi
     * @param {string[]} knowledgeDataArray - Tablica treści z plików wiedzy
     * @param {string[]} filePaths - Ścieżki plików (do identyfikacji źródła)
     * @param {Function|null} onProgress - Callback postępu: (processed, total) => void
     */
    async reindex(knowledgeDataArray, filePaths = [], onProgress = null) {
        if (!this.ready) {
            logger.warn('⚠️ Model embeddingów nie gotowy - pomijam reindeksację');
            return { count: 0, duration: 0 };
        }

        logger.info('Reindeksacja bazy wiedzy...');
        const startTime = Date.now();
        const newIndex = [];

        // Zbierz wszystkie sekcje do przetworzenia
        const allSections = [];
        for (let i = 0; i < knowledgeDataArray.length; i++) {
            const data = knowledgeDataArray[i];
            if (!data || !data.trim()) continue;

            const source = filePaths[i] || `file_${i}`;
            const sections = data.split(/\n\n+/).filter(s => s.trim().length > 0);

            for (const section of sections) {
                const { rating, cleanSection } = this.parseRating(section);
                if (rating <= -5) continue;
                if (cleanSection.trim().length < 10) continue;
                allSections.push({ cleanSection, source });
            }
        }

        const total = allSections.length;

        // Generuj embeddingi z postępem
        for (let i = 0; i < total; i++) {
            const { cleanSection, source } = allSections[i];

            const embedding = await this.embed(cleanSection, false);
            if (embedding) {
                newIndex.push({
                    text: cleanSection,
                    source: path.basename(source),
                    embedding
                });
            }

            // Raportuj postęp co 25 fragmentów lub na końcu
            if (onProgress && (i % 25 === 0 || i === total - 1)) {
                await onProgress(i + 1, total);
            }
        }

        this.index = newIndex;
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        logger.success(`✅ Reindeksacja zakończona: ${newIndex.length} fragmentów w ${duration}s`);

        // Zapisz indeks do pliku
        await this.saveIndex();

        return { count: newIndex.length, duration };
    }

    /**
     * Dodaj pojedynczy fragment do indeksu (przy dodawaniu nowej wiedzy)
     * @param {string} text - Treść fragmentu
     * @param {string} source - Identyfikator źródła
     */
    async addToIndex(text, source = 'live') {
        if (!this.ready) return;

        const cleanText = text.trim();
        if (cleanText.length < 10) return;

        const embedding = await this.embed(cleanText, false);
        if (embedding) {
            this.index.push({ text: cleanText, source, embedding });
            // Zapisz indeks co 10 nowych wpisów (throttle)
            if (this.index.length % 10 === 0) {
                await this.saveIndex();
            }
        }
    }

    /**
     * Parsuj rating z sekcji bazy wiedzy (taki sam format jak w aiChatService)
     */
    parseRating(section) {
        const match = section.match(/^(\[[\d-]+\s*\|\s*[^\]]+\]\s*)?\[([+-]+)\]\s*/);
        if (match) {
            const signs = match[2];
            const rating = signs[0] === '+' ? signs.length : -signs.length;
            const cleanSection = section.replace(/\[([+-]+)\]\s*/, '');
            return { rating, cleanSection };
        }
        return { rating: 0, cleanSection: section };
    }

    /**
     * Zapisz indeks do pliku JSON
     * Zapisuje embeddingi jako Float32 base64 dla oszczędności miejsca
     */
    async saveIndex() {
        try {
            await fs.mkdir(path.dirname(this.indexFile), { recursive: true });

            // Konwertuj embeddingi na base64 dla kompaktowości
            const serialized = this.index.map(item => ({
                text: item.text,
                source: item.source,
                embedding: Buffer.from(new Float32Array(item.embedding).buffer).toString('base64')
            }));

            await fs.writeFile(this.indexFile, JSON.stringify({
                model: this.modelName,
                count: serialized.length,
                updatedAt: new Date().toISOString(),
                items: serialized
            }, null, 2));

            logger.info(`💾 Indeks embeddingów zapisany: ${serialized.length} fragmentów`);
        } catch (error) {
            logger.error(`❌ Błąd zapisu indeksu embeddingów: ${error.message}`);
        }
    }

    /**
     * Wczytaj indeks z pliku JSON
     */
    async loadIndex() {
        try {
            const content = await fs.readFile(this.indexFile, 'utf8');
            const data = JSON.parse(content);

            // Sprawdź czy indeks pasuje do aktualnego modelu
            if (data.model !== this.modelName) {
                logger.warn(`⚠️ Indeks z innego modelu (${data.model}) - wymaga reindeksacji`);
                this.index = [];
                return;
            }

            // Dekoduj embeddingi z base64
            this.index = data.items.map(item => {
                const buf = Buffer.from(item.embedding, 'base64');
                const floats = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
                return {
                    text: item.text,
                    source: item.source,
                    embedding: Array.from(floats)
                };
            });

            logger.info(`📂 Wczytano indeks embeddingów: ${this.index.length} fragmentów (z ${data.updatedAt})`);
        } catch (error) {
            if (error.code === 'ENOENT') {
                logger.info('📂 Brak indeksu embeddingów - zostanie utworzony przy pierwszej reindeksacji');
            } else {
                logger.error(`❌ Błąd wczytywania indeksu embeddingów: ${error.message}`);
            }
            this.index = [];
        }
    }

    /**
     * Statystyki indeksu
     */
    getStats() {
        return {
            ready: this.ready,
            model: this.modelName,
            indexSize: this.index.length,
            memoryMB: this.index.length > 0
                ? ((this.index.length * this.index[0].embedding.length * 4) / (1024 * 1024)).toFixed(1)
                : '0'
        };
    }
}

module.exports = EmbeddingService;
