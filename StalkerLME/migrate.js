/**
 * Skrypt migracji danych do nowej struktury plików
 *
 * Uruchom:  node migrate.js
 *
 * Ten skrypt przeniesie dane z:
 *   - data/phase1_results.json
 *   - data/phase2_results.json
 *
 * Do nowej struktury:
 *   - data/phases/guild_<id>/phase1/2025/week-40_clan1.json
 *   - data/phases/guild_<id>/phase2/2025/week-40_clan1.json
 *
 * Stare pliki zostaną zachowane jako .backup
 */

const path = require('path');
const DatabaseService = require('./services/databaseService');
const { createBotLogger } = require('../utils/consoleLogger');

const logger = createBotLogger('MIGRATION');

async function main() {
    logger.info('');
    logger.info('╔══════════════════════════════════════════════════════════╗');
    logger.info('║         MIGRACJA DO NOWEJ STRUKTURY PLIKÓW              ║');
    logger.info('╚══════════════════════════════════════════════════════════╝');
    logger.info('');

    // Załaduj konfigurację
    const config = require('./config/config.json');

    // Utwórz instancję DatabaseService
    const databaseService = new DatabaseService(config);

    // Wykonaj migrację
    const result = await databaseService.migrateToSplitFiles();

    if (result.success) {
        logger.info('');
        logger.info('╔══════════════════════════════════════════════════════════╗');
        logger.info('║                  MIGRACJA ZAKOŃCZONA                     ║');
        logger.info('╚══════════════════════════════════════════════════════════╝');
        logger.info('');
        logger.info(`✅ Zmigrowano ${result.phase1Count} plików Phase 1`);
        logger.info(`✅ Zmigrowano ${result.phase2Count} plików Phase 2`);

        if (result.errors > 0) {
            logger.warn(`⚠️  Błędy podczas migracji: ${result.errors}`);
        }

        logger.info('');
        logger.info('📁 Nowa struktura katalogów:');
        logger.info('   data/phases/guild_<id>/phase1/2025/week-40_clan1.json');
        logger.info('   data/phases/guild_<id>/phase2/2025/week-40_clan1.json');
        logger.info('');
        logger.info('💾 Stare pliki zachowane jako:');
        logger.info('   data/phase1_results.json.backup');
        logger.info('   data/phase2_results.json.backup');
        logger.info('');
        logger.info('✅ Możesz teraz uruchomić bota - będzie używał nowej struktury!');
        logger.info('');

        process.exit(0);
    } else {
        logger.error('');
        logger.error('╔══════════════════════════════════════════════════════════╗');
        logger.error('║              BŁĄD MIGRACJI                               ║');
        logger.error('╚══════════════════════════════════════════════════════════╝');
        logger.error('');
        logger.error(`❌ ${result.error}`);
        logger.error('');

        process.exit(1);
    }
}

main().catch(error => {
    logger.error('❌ Nieoczekiwany błąd:', error);
    process.exit(1);
});
