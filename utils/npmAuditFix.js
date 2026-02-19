const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const execAsync = promisify(exec);

/**
 * Automatyczna naprawa problemów z npm (vulnerabilities, deprecated packages)
 * Wykonuje npm audit fix jeśli AUTO_NPM_FIX=true w .env
 *
 * Zabezpieczenia:
 * - Backup package.json i package-lock.json przed naprawą
 * - Weryfikacja krytycznych pakietów (discord.js) po naprawie
 * - Automatyczny rollback jeśli naprawa złamała zależności
 */
class NpmAuditFix {
    constructor(logger) {
        this.logger = logger;
        this.backupDir = path.join(process.cwd(), '.npm-fix-backup');

        // Krytyczne pakiety które muszą działać po naprawie
        // Sprawdzamy czy kluczowe exporty istnieją
        this.criticalPackages = [
            {
                name: 'discord.js',
                verify: () => {
                    const djs = require('discord.js');
                    if (!djs.GatewayIntentBits || !djs.GatewayIntentBits.Guilds) {
                        throw new Error('GatewayIntentBits.Guilds nie istnieje');
                    }
                    if (!djs.Client) {
                        throw new Error('Client nie istnieje');
                    }
                    return true;
                }
            }
        ];
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
     * Sprawdza czy istnieje package-lock.json
     */
    hasPackageLock() {
        return fs.existsSync('./package-lock.json');
    }

    /**
     * Tworzy backup package.json i package-lock.json
     */
    createBackup() {
        try {
            if (!fs.existsSync(this.backupDir)) {
                fs.mkdirSync(this.backupDir, { recursive: true });
            }

            if (fs.existsSync('./package.json')) {
                fs.copyFileSync('./package.json', path.join(this.backupDir, 'package.json'));
            }
            if (fs.existsSync('./package-lock.json')) {
                fs.copyFileSync('./package-lock.json', path.join(this.backupDir, 'package-lock.json'));
            }

            this.logger.info('💾 Backup package.json i package-lock.json utworzony');
            return true;
        } catch (error) {
            this.logger.error(`Błąd tworzenia backupu: ${error.message}`);
            return false;
        }
    }

    /**
     * Przywraca backup i reinstaluje pakiety
     */
    async restoreBackup() {
        try {
            const pkgBackup = path.join(this.backupDir, 'package.json');
            const lockBackup = path.join(this.backupDir, 'package-lock.json');

            if (fs.existsSync(pkgBackup)) {
                fs.copyFileSync(pkgBackup, './package.json');
            }
            if (fs.existsSync(lockBackup)) {
                fs.copyFileSync(lockBackup, './package-lock.json');
            }

            this.logger.info('🔄 Przywrócono backup - reinstalacja pakietów...');
            await execAsync('npm install 2>&1', {
                timeout: 180000,
                maxBuffer: 10 * 1024 * 1024
            });

            this.logger.success('✅ Rollback zakończony - pakiety przywrócone');
            return true;
        } catch (error) {
            this.logger.error(`❌ Błąd rollbacku: ${error.message}`);
            this.logger.error('⚠️ RĘCZNIE uruchom: git checkout package.json package-lock.json && npm install');
            return false;
        }
    }

    /**
     * Czyści pliki backupu
     */
    cleanupBackup() {
        try {
            if (fs.existsSync(this.backupDir)) {
                fs.rmSync(this.backupDir, { recursive: true });
            }
        } catch (error) {
            // Ignoruj błędy czyszczenia
        }
    }

    /**
     * Weryfikuje czy krytyczne pakiety nadal działają po naprawie
     * Czyści cache require aby sprawdzić aktualny stan node_modules
     */
    verifyCriticalPackages() {
        const failures = [];

        for (const pkg of this.criticalPackages) {
            try {
                // Wyczyść cache require dla tego pakietu
                const resolvedPath = require.resolve(pkg.name);
                Object.keys(require.cache).forEach(key => {
                    if (key.includes(`node_modules/${pkg.name}`)) {
                        delete require.cache[key];
                    }
                });

                pkg.verify();
            } catch (error) {
                failures.push({ name: pkg.name, error: error.message });
            }
        }

        return failures;
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

            return this.parseAuditJson(stdout);
        } catch (error) {
            // npm audit zwraca exit code > 0 gdy są vulnerabilities
            if (error.stdout) {
                const result = this.parseAuditJson(error.stdout);
                if (result) return result;
            }

            // Fallback - parsuj tekstowe wyjście
            try {
                const { stdout: textOutput } = await execAsync('npm audit 2>&1', {
                    timeout: 60000,
                    maxBuffer: 10 * 1024 * 1024
                });

                const vulnMatch = textOutput.match(/(\d+)\s+vulnerabilit/);
                return {
                    success: true,
                    total: vulnMatch ? parseInt(vulnMatch[1]) : 0,
                    info: 0, low: 0, moderate: 0, high: 0, critical: 0
                };
            } catch (fallbackError) {
                return { success: false, total: 0, error: error.message };
            }
        }
    }

    /**
     * Parsuje JSON z npm audit
     */
    parseAuditJson(jsonString) {
        try {
            const report = JSON.parse(jsonString);
            const metadata = report.metadata || {};
            const vulnerabilities = metadata.vulnerabilities || {};

            return {
                success: true,
                total: Object.values(vulnerabilities).reduce((sum, count) => sum + count, 0),
                info: vulnerabilities.info || 0,
                low: vulnerabilities.low || 0,
                moderate: vulnerabilities.moderate || 0,
                high: vulnerabilities.high || 0,
                critical: vulnerabilities.critical || 0
            };
        } catch (error) {
            return null;
        }
    }

    /**
     * Formatuje raport vulnerabilities
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
     * Uruchamia komendę npm i parsuje wynik (obsługuje exit code > 0)
     */
    async runNpmCommand(command, timeoutMs = 120000) {
        let output = '';

        try {
            const { stdout, stderr } = await execAsync(`${command} 2>&1`, {
                timeout: timeoutMs,
                maxBuffer: 10 * 1024 * 1024
            });
            output = (stdout || '') + (stderr || '');
        } catch (error) {
            output = (error.stdout || '') + (error.stderr || '');
            if (!output.trim()) {
                return { success: false, output: '', error: error.message };
            }
        }

        const addedMatch = output.match(/added\s+(\d+)/);
        const removedMatch = output.match(/removed\s+(\d+)/);
        const changedMatch = output.match(/changed\s+(\d+)/);

        return {
            success: true,
            output,
            added: addedMatch ? parseInt(addedMatch[1]) : 0,
            removed: removedMatch ? parseInt(removedMatch[1]) : 0,
            changed: changedMatch ? parseInt(changedMatch[1]) : 0
        };
    }

    /**
     * Loguje podsumowanie zmian w pakietach
     */
    logPackageChanges(result, prefix = '') {
        if (result.added || result.removed || result.changed) {
            const changes = [];
            if (result.added) changes.push(`+${result.added} dodanych`);
            if (result.removed) changes.push(`-${result.removed} usuniętych`);
            if (result.changed) changes.push(`~${result.changed} zmienionych`);
            this.logger.info(`📦 ${prefix}Zmiany w pakietach: ${changes.join(', ')}`);
        }
    }

    /**
     * Główna funkcja naprawy npm
     * @param {Object} options
     * @param {boolean} options.force - Czy eskalować do --force gdy zwykły fix nie pomoże
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
        if (!this.hasPackageLock()) {
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

        this.logger.warn(`⚠️ Wykryto ${auditBefore.total} vulnerabilities: ${this.formatVulnReport(auditBefore)}`);

        // Backup przed naprawą
        if (!this.createBackup()) {
            this.logger.warn('⚠️ Nie udało się utworzyć backupu - pomijam naprawę dla bezpieczeństwa');
            return false;
        }

        // === Krok 1: Bezpieczny npm audit fix ===
        this.logger.info('🔧 Uruchamiam npm audit fix...');
        const fixResult = await this.runNpmCommand('npm audit fix');

        if (fixResult.success) {
            this.logPackageChanges(fixResult);
        }

        // Weryfikacja po bezpiecznym fix
        let failures = this.verifyCriticalPackages();
        if (failures.length > 0) {
            this.logger.error(`❌ npm audit fix złamał pakiety: ${failures.map(f => f.name).join(', ')}`);
            this.logger.info('🔄 Przywracam backup...');
            await this.restoreBackup();
            this.cleanupBackup();
            return false;
        }

        // Sprawdź wynik po bezpiecznym fix
        const auditAfterSafe = await this.getAuditReport();

        if (auditAfterSafe.success && auditAfterSafe.total === 0) {
            this.logger.success('✅ Wszystkie vulnerabilities naprawione!');
            this.cleanupBackup();
            return true;
        }

        if (auditAfterSafe.success) {
            const fixedSafe = auditBefore.total - auditAfterSafe.total;
            if (fixedSafe > 0) {
                this.logger.success(`✅ Bezpieczny fix naprawił ${fixedSafe}/${auditBefore.total} vulnerabilities`);
            }
        }

        // === Krok 2: Force fix (jeśli włączony) ===
        if (!force || !auditAfterSafe.success || auditAfterSafe.total === 0) {
            if (!force && auditAfterSafe.total > 0) {
                this.logger.warn(`⚠️ Pozostało ${auditAfterSafe.total} vulnerabilities`);
                this.logger.info('ℹ️  Ustaw AUTO_NPM_FIX_FORCE=true aby spróbować --force');
            }
            this.cleanupBackup();
            return true;
        }

        this.logger.warn(`⚠️ Pozostało ${auditAfterSafe.total} vulnerabilities - próbuję --force...`);
        const forceResult = await this.runNpmCommand('npm audit fix --force', 180000);

        if (forceResult.success) {
            this.logPackageChanges(forceResult, '(--force) ');
        }

        // Weryfikacja po force fix - KRYTYCZNE
        failures = this.verifyCriticalPackages();
        if (failures.length > 0) {
            this.logger.error(`❌ --force złamał krytyczne pakiety: ${failures.map(f => `${f.name} (${f.error})`).join(', ')}`);
            this.logger.info('🔄 Automatyczny rollback...');
            await this.restoreBackup();

            // Weryfikacja po rollbacku
            const rollbackFailures = this.verifyCriticalPackages();
            if (rollbackFailures.length > 0) {
                this.logger.error('❌ Rollback nie przywrócił pakietów! Ręcznie uruchom: npm install');
            } else {
                this.logger.success('✅ Rollback udany - pakiety przywrócone do stanu sprzed --force');
            }

            this.cleanupBackup();
            return false;
        }

        // Sprawdź finalny wynik
        const auditFinal = await this.getAuditReport();
        if (auditFinal.success && auditFinal.total === 0) {
            this.logger.success('✅ Wszystkie vulnerabilities naprawione (--force)!');
        } else if (auditFinal.success) {
            const totalFixed = auditBefore.total - auditFinal.total;
            if (totalFixed > 0) {
                this.logger.success(`✅ Naprawiono ${totalFixed}/${auditBefore.total} vulnerabilities`);
            }
            this.logger.warn(`⚠️ Pozostało ${auditFinal.total}: ${this.formatVulnReport(auditFinal)}`);
        }

        this.cleanupBackup();
        return true;
    }
}

module.exports = NpmAuditFix;
