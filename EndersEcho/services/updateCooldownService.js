const fs = require('fs').promises;
const path = require('path');

const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minut

class UpdateCooldownService {
    constructor(config) {
        this.filePath = path.join(config.ranking.dataDir, 'update_cooldowns.json');
        this._cooldowns = new Map(); // userId -> { expiresAt, cooldownMs, lastSetAt }
        this._cooldownDurationMs = DEFAULT_COOLDOWN_MS;
    }

    async load() {
        try {
            const raw = await fs.readFile(this.filePath, 'utf8');
            const data = JSON.parse(raw);
            const now = Date.now();
            if (typeof data.cooldownDurationMs === 'number') {
                this._cooldownDurationMs = data.cooldownDurationMs;
                for (const [userId, val] of Object.entries(data.cooldowns || {})) {
                    if (typeof val === 'number') {
                        // Stary format: samo expiresAt — migruj do nowego
                        if (val > now) {
                            this._cooldowns.set(userId, {
                                expiresAt: val,
                                cooldownMs: this._cooldownDurationMs,
                                lastSetAt: val - this._cooldownDurationMs,
                            });
                        }
                    } else if (val && typeof val === 'object' && val.expiresAt > now) {
                        this._cooldowns.set(userId, val);
                    }
                }
            } else {
                // Najstarszy format: { userId: expiresAt } — migracja
                this._cooldownDurationMs = DEFAULT_COOLDOWN_MS;
                for (const [userId, expiresAt] of Object.entries(data)) {
                    if (typeof expiresAt === 'number' && expiresAt > now) {
                        this._cooldowns.set(userId, {
                            expiresAt,
                            cooldownMs: this._cooldownDurationMs,
                            lastSetAt: expiresAt - this._cooldownDurationMs,
                        });
                    }
                }
            }
        } catch {
            // Plik nie istnieje — zaczynamy od zera
        }
    }

    async save() {
        const now = Date.now();
        const cooldowns = {};
        for (const [userId, entry] of this._cooldowns) {
            if (entry.expiresAt > now) cooldowns[userId] = entry;
        }
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        await fs.writeFile(this.filePath, JSON.stringify({
            cooldownDurationMs: this._cooldownDurationMs,
            cooldowns
        }, null, 2), 'utf8');
    }

    // Zwraca pozostały czas w ms, lub null jeśli brak cooldownu
    getRemainingMs(userId) {
        const entry = this._cooldowns.get(userId);
        if (!entry) return null;
        const remaining = entry.expiresAt - Date.now();
        if (remaining <= 0) {
            this._cooldowns.delete(userId);
            return null;
        }
        return remaining;
    }

    // Ustawia cooldown z logiką podwajania:
    // Jeśli od poprzedniego setCooldown minęło <= 3x poprzedniego cooldownu → podwój.
    // Jeśli minęło więcej → reset do bazy (_cooldownDurationMs).
    async setCooldown(userId) {
        const now = Date.now();
        const entry = this._cooldowns.get(userId);
        const base = this._cooldownDurationMs;

        let newCooldownMs;
        if (entry && entry.lastSetAt) {
            const timeSinceLastSet = now - entry.lastSetAt;
            const windowMs = 3 * entry.cooldownMs;
            newCooldownMs = timeSinceLastSet <= windowMs
                ? entry.cooldownMs * 2
                : base;
        } else {
            newCooldownMs = base;
        }

        this._cooldowns.set(userId, {
            expiresAt: now + newCooldownMs,
            cooldownMs: newCooldownMs,
            lastSetAt: now,
        });
        await this.save().catch(() => {});
        return newCooldownMs;
    }

    // Usuwa cooldown użytkownika (np. gdy błąd po stronie AI, nie wina użytkownika)
    async clearCooldown(userId) {
        this._cooldowns.delete(userId);
        await this.save().catch(() => {});
    }

    // Zwraca aktualny efektywny cooldown danego usera (lub bazę jeśli brak wpisu)
    getUserCooldownMs(userId) {
        const entry = this._cooldowns.get(userId);
        return entry ? entry.cooldownMs : this._cooldownDurationMs;
    }

    getCooldownDuration() {
        return this._cooldownDurationMs;
    }

    async setCooldownDuration(ms) {
        this._cooldownDurationMs = (ms !== null && ms > 0) ? ms : DEFAULT_COOLDOWN_MS;
        await this.save().catch(() => {});
    }
}

function formatCooldownTime(ms) {
    const totalSeconds = Math.ceil(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes > 0 && seconds > 0) return `${minutes} min ${seconds} s`;
    if (minutes > 0) return `${minutes} min`;
    return `${seconds} s`;
}

// Formatuje ms na czytelny string, np. "5m", "1h", "1h 30m"
function formatCooldownDuration(ms) {
    if (!ms) return '—';
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    return `${m}m`;
}

module.exports = { UpdateCooldownService, formatCooldownTime, formatCooldownDuration };
