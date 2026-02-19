const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

/**
 * Automatyczna naprawa problemów z npm (vulnerabilities, deprecated packages)
 * Wykonuje npm audit fix jeśli AUTO_NPM_FIX=true w .env
 *
 * Obsługuje:
 * - npm audit fix (bezpieczne aktualizacje)
 * - npm audit fix --force (wymuszenie jeśli zwykły fix nie pomoże, opcjonalne)
 * - Raportowanie wyników
 */
class NpmAuditFix {
    constructor(logger) {
        this.logger = logger;
    }

    /**
     * Sprawdza czy npm jest dostępny
     */
    async isNpmAvailable() {
        try {
            const { stdout } = await execAsync('npm --version');
            return { available: true, version: stdout.trim() };
        } catch (error) {
            return { available: false, version: null };
        }
    }

    /**
     * Sprawdza czy istnieje package-lock.json (wymagany dla npm audit)
     */
    async hasPackageLock() {
        try {
            const fs = require('fs');
            return fs.existsSync('./package-lock.json');
        } catch (error) {
            return false;
        }
    }

    /**
     * Uruchamia npm audit i parsuje wyniki
     */
    async getAuditReport() {
        try {
            const { stdout } = await execAsync('npm audit --json 2>/dev/null', {
                timeout: 60000,
                maxBuffer: 10 * 1024 * 1024
            });

            const report = JSON.parse(stdout);
            const metadata = report.metadata || {};
            const vulnerabilities = metadata.vulnerabilities || {};

            const total = Object.values(vulnerabilities).reduce((sum, count) => sum + count, 0);

            return {
                success: true,
                total,
                info: vulnerabilities.info || 0,
                low: vulnerabilities.low || 0,
                moderate: vulnerabilities.moderate || 0,
                high: vulnerabilities.high || 0,
                critical: vulnerabilities.critical || 0
            };
        } catch (error) {
            // npm audit zwraca exit code > 0 gdy są vulnerabilities
            if (error.stdout) {
                try {
                    const report = JSON.parse(error.stdout);
                    const metadata = report.metadata || {};
                    const vulnerabilities = metadata.vulnerabilities || {};

                    const total = Object.values(vulnerabilities).reduce((sum, count) => sum + count, 0);

                    return {
                        success: true,
                        total,
                        info: vulnerabilities.info || 0,
                        low: vulnerabilities.low || 0,
                        moderate: vulnerabilities.moderate || 0,
                        high: vulnerabilities.high || 0,
                        critical: vulnerabilities.critical || 0
                    };
                } catch (parseError) {
                    // Nie udało się sparsować JSON - spróbuj tekstowo
                }
            }

            // Fallback - parsuj tekstowe wyjście
            try {
                const { stdout: textOutput } = await execAsync('npm audit 2>&1', {
                    timeout: 60000,
                    maxBuffer: 10 * 1024 * 1024
                });

                const vulnMatch = textOutput.match(/(\d+)\s+vulnerabilit/);
                const total = vulnMatch ? parseInt(vulnMatch[1]) : 0;

                return {
                    success: true,
                    total,
                    info: 0,
                    low: 0,
                    moderate: 0,
                    high: 0,
                    critical: 0,
                    rawOutput: textOutput.substring(0, 500)
                };
            } catch (fallbackError) {
                return {
                    success: false,
                    total: 0,
                    error: error.message
                };
            }
        }
    }

    /**
     * Formatuje raport vulnerabilities do czytelnego stringa
     */
    formatVulnReport(report) {
        const parts = [];
        if (report.critical > 0) parts.push(`${report.critical} krytycznych`);
        if (report.high > 0) parts.push(`${report.high} wysokich`);
        if (report.moderate > 0) parts.push(`${report.moderate} średnich`);
        if (report.low > 0) parts.push(`${report.low} niskich`);
        if (report.info > 0) parts.push(`${report.info} informacyjnych`);
        return parts.length > 0 ? parts.join(', ') : 'brak szczegółów';
    }

    /**
     * Wykonuje npm audit fix (bezpieczne aktualizacje)
     */
    async runAuditFix() {
        this.logger.info('🔧 Uruchamiam npm audit fix...');

        let output = '';

        try {
            const { stdout, stderr } = await execAsync('npm audit fix 2>&1', {
                timeout: 120000,
                maxBuffer: 10 * 1024 * 1024
            });
            output = (stdout || '') + (stderr || '');
        } catch (error) {
            // npm audit fix zwraca exit code > 0 gdy nie wszystko naprawił
            // ale to nie znaczy że całkowicie się nie udało
            output = (error.stdout || '') + (error.stderr || '');

            // Jeśli brak jakiegokolwiek outputu - prawdziwy błąd
            if (!output.trim()) {
                this.logger.error(`Błąd npm audit fix: ${error.message}`);
                return { success: false, error: error.message };
            }
        }

        // Parsuj wynik niezależnie od exit code
        const fixedMatch = output.match(/fixed\s+(\d+)\s+of\s+(\d+)/i);
        const addedMatch = output.match(/added\s+(\d+)/);
        const removedMatch = output.match(/removed\s+(\d+)/);
        const changedMatch = output.match(/changed\s+(\d+)/);

        return {
            success: true,
            fixed: fixedMatch ? parseInt(fixedMatch[1]) : 0,
            totalBefore: fixedMatch ? parseInt(fixedMatch[2]) : 0,
            added: addedMatch ? parseInt(addedMatch[1]) : 0,
            removed: removedMatch ? parseInt(removedMatch[1]) : 0,
            changed: changedMatch ? parseInt(changedMatch[1]) : 0,
            output: output.substring(0, 1000)
        };
    }

    /**
     * Sprawdza zdeprecjonowane pakiety
     */
    async getDeprecatedPackages() {
        try {
            const { stdout } = await execAsync('npm outdated --json 2>/dev/null', {
                timeout: 60000,
                maxBuffer: 10 * 1024 * 1024
            });

            const outdated = JSON.parse(stdout || '{}');
            const count = Object.keys(outdated).length;
            return { success: true, count, packages: outdated };
        } catch (error) {
            // npm outdated zwraca exit code 1 gdy są outdated packages
            if (error.stdout) {
                try {
                    const outdated = JSON.parse(error.stdout || '{}');
                    const count = Object.keys(outdated).length;
                    return { success: true, count, packages: outdated };
                } catch (parseError) {
                    // Ignoruj
                }
            }
            return { success: false, count: 0 };
        }
    }

    /**
     * Główna funkcja naprawy npm
     * @param {Object} options - Opcje
     * @param {boolean} options.force - Czy wymusić fix (npm audit fix --force)
     */
    async autoFix(options = {}) {
        const { force = false } = options;

        // Sprawdź npm
        const npm = await this.isNpmAvailable();
        if (!npm.available) {
            this.logger.warn('⚠️ npm nie jest dostępny - pomijam auto-fix');
            return false;
        }

        // Sprawdź package-lock.json
        if (!await this.hasPackageLock()) {
            this.logger.warn('⚠️ Brak package-lock.json - pomijam npm audit');
            return false;
        }

        this.logger.info(`🔍 Sprawdzam vulnerabilities npm (v${npm.version})...`);

        // Sprawdź vulnerabilities
        const auditBefore = await this.getAuditReport();

        if (!auditBefore.success) {
            this.logger.warn(`⚠️ Nie udało się sprawdzić vulnerabilities: ${auditBefore.error || 'nieznany błąd'}`);
            return false;
        }

        if (auditBefore.total === 0) {
            this.logger.success('✅ Brak vulnerabilities npm');
            return true;
        }

        // Są vulnerabilities - pokaż raport
        this.logger.warn(`⚠️ Wykryto ${auditBefore.total} vulnerabilities: ${this.formatVulnReport(auditBefore)}`);

        // Uruchom naprawę
        const fixResult = await this.runAuditFix();

        if (!fixResult.success) {
            this.logger.error(`❌ npm audit fix nie powiódł się: ${fixResult.error}`);

            if (force) {
                this.logger.info('🔧 Próbuję npm audit fix --force...');
                try {
                    await execAsync('npm audit fix --force 2>&1', {
                        timeout: 180000,
                        maxBuffer: 10 * 1024 * 1024
                    });
                    this.logger.success('✅ npm audit fix --force zakończone');
                } catch (forceError) {
                    // npm audit fix --force też może zwrócić exit code > 0
                    const forceOutput = (forceError.stdout || '') + (forceError.stderr || '');
                    if (forceOutput.trim()) {
                        this.logger.success('✅ npm audit fix --force zakończone');
                    } else {
                        this.logger.error(`❌ npm audit fix --force nie powiódł się: ${forceError.message}`);
                        return false;
                    }
                }
            } else {
                return false;
            }
        }

        // Sprawdź wynik po naprawie
        const auditAfter = await this.getAuditReport();

        if (auditAfter.success && auditAfter.total === 0) {
            this.logger.success('✅ Wszystkie vulnerabilities naprawione!');
        } else if (auditAfter.success) {
            const fixed = auditBefore.total - auditAfter.total;
            if (fixed > 0) {
                this.logger.success(`✅ Naprawiono ${fixed}/${auditBefore.total} vulnerabilities`);
                this.logger.warn(`⚠️ Pozostało ${auditAfter.total}: ${this.formatVulnReport(auditAfter)}`);
                this.logger.info('ℹ️  Pozostałe wymagają ręcznej aktualizacji lub npm audit fix --force');
            } else {
                this.logger.warn(`⚠️ Nie udało się naprawić automatycznie (${auditAfter.total} vulnerabilities)`);
                this.logger.info('ℹ️  Spróbuj: npm audit fix --force lub ręcznie zaktualizuj pakiety');
            }
        }

        // Podsumowanie zmian w pakietach
        if (fixResult.added || fixResult.removed || fixResult.changed) {
            const changes = [];
            if (fixResult.added) changes.push(`+${fixResult.added} dodanych`);
            if (fixResult.removed) changes.push(`-${fixResult.removed} usuniętych`);
            if (fixResult.changed) changes.push(`~${fixResult.changed} zmienionych`);
            this.logger.info(`📦 Zmiany w pakietach: ${changes.join(', ')}`);
        }

        return true;
    }
}

module.exports = NpmAuditFix;
