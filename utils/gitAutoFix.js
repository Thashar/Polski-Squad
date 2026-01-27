const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

/**
 * Automatyczna naprawa problemów z git (divergent branches, konflikty)
 * Wykonuje hard reset do origin/main jeśli AUTO_GIT_FIX=true w .env
 *
 * UWAGA: NIE używa "git clean" - nie usuwa niesledzonych plików (data/, temp/, etc.)
 */
class GitAutoFix {
    constructor(logger) {
        this.logger = logger;
    }

    /**
     * Sprawdza czy jesteśmy w repozytorium git
     */
    async isGitRepo() {
        try {
            await execAsync('git rev-parse --git-dir');
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Pobiera status repozytorium
     */
    async getStatus() {
        try {
            const { stdout } = await execAsync('git status --porcelain');
            return {
                hasChanges: stdout.trim().length > 0,
                output: stdout
            };
        } catch (error) {
            this.logger.error(`Błąd sprawdzania statusu git: ${error.message}`);
            return { hasChanges: false, output: '' };
        }
    }

    /**
     * Sprawdza czy są divergent branches
     */
    async hasDivergentBranches() {
        try {
            await execAsync('git fetch origin');
            const { stdout: localCommit } = await execAsync('git rev-parse HEAD');
            const { stdout: remoteCommit } = await execAsync('git rev-parse origin/main');

            if (localCommit.trim() !== remoteCommit.trim()) {
                // Sprawdź czy są różnice
                const { stdout: behind } = await execAsync('git rev-list HEAD..origin/main --count');
                const { stdout: ahead } = await execAsync('git rev-list origin/main..HEAD --count');

                return {
                    diverged: parseInt(behind) > 0 || parseInt(ahead) > 0,
                    behind: parseInt(behind),
                    ahead: parseInt(ahead)
                };
            }

            return { diverged: false, behind: 0, ahead: 0 };
        } catch (error) {
            this.logger.warn(`Nie można sprawdzić divergent branches: ${error.message}`);
            return { diverged: false, behind: 0, ahead: 0 };
        }
    }

    /**
     * Wykonuje hard reset do origin/main
     * UWAGA: NIE usuwa niesledzonych plików - tylko resetuje śledzone pliki do stanu remote
     */
    async hardReset() {
        try {
            this.logger.info('🔄 Wykonuję hard reset do origin/main...');

            // Fetch latest changes
            await execAsync('git fetch origin');
            this.logger.info('✅ Pobrano najnowsze zmiany z origin');

            // Hard reset - nadpisuje TYLKO śledzone pliki
            await execAsync('git reset --hard origin/main');
            this.logger.success('✅ Hard reset wykonany - śledzone pliki zsynchronizowane z remote');
            this.logger.info('ℹ️  Nieśledzone pliki (data/, temp/, .env) pozostały nietknięte');

            return true;
        } catch (error) {
            this.logger.error(`❌ Błąd podczas hard reset: ${error.message}`);
            return false;
        }
    }

    /**
     * Główna funkcja naprawy git
     */
    async autoFix() {
        // Sprawdź czy jesteśmy w repo git
        if (!await this.isGitRepo()) {
            this.logger.warn('⚠️ Nie wykryto repozytorium git - pomijam auto-fix');
            return false;
        }

        this.logger.info('🔍 Sprawdzam status repozytorium git...');

        // Sprawdź status
        const status = await this.getStatus();
        if (status.hasChanges) {
            this.logger.warn('⚠️ Wykryto lokalne zmiany w śledzonych plikach');
        }

        // Sprawdź divergent branches
        const divergence = await this.hasDivergentBranches();
        if (divergence.diverged) {
            this.logger.warn(`⚠️ Wykryto rozbieżne gałęzie:`);
            this.logger.warn(`   - Lokalne commity do przodu: ${divergence.ahead}`);
            this.logger.warn(`   - Zdalne commity do tyłu: ${divergence.behind}`);
            this.logger.info('🔧 Rozpoczynam automatyczną naprawę...');

            return await this.hardReset();
        } else {
            this.logger.success('✅ Repozytorium git jest zsynchronizowane');
            return true;
        }
    }
}

module.exports = GitAutoFix;
