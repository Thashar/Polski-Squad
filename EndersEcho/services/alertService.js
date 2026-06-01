const fs = require('fs').promises;
const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('EndersEcho');

const ALERT_TYPES = ['ocrRate', 'pendingCv', 'dailyCost'];
const ALERT_DEBOUNCE_MS = 60 * 60 * 1000; // 1 godzina

class AlertService {
    constructor(dataDir) {
        this._dataFile = path.join(dataDir, 'alert_config.json');
        this._thresholds = {
            ocrRate: 80,    // min % — alert gdy poniżej
            pendingCv: 3,   // max   — alert gdy powyżej
            dailyCost: 5.0, // max $ — alert gdy powyżej
        };
        this._active = {}; // type → { triggeredAt, value, acknowledged }
        this._lastSent = {}; // type → timestamp (debounce wysyłki)
    }

    async load() {
        try {
            const raw = await fs.readFile(this._dataFile, 'utf8');
            const data = JSON.parse(raw);
            if (data.thresholds) {
                this._thresholds = { ...this._thresholds, ...data.thresholds };
            }
            if (data.active) {
                this._active = data.active;
            }
            logger.info(`AlertService: wczytano progi — OCR<${this._thresholds.ocrRate}% / CV>${this._thresholds.pendingCv} / koszt>$${this._thresholds.dailyCost}`);
        } catch {
            // Brak pliku — domyślne wartości
        }
    }

    async _persist() {
        await fs.mkdir(path.dirname(this._dataFile), { recursive: true });
        await fs.writeFile(this._dataFile, JSON.stringify({
            thresholds: this._thresholds,
            active: this._active,
        }, null, 2), 'utf8');
    }

    getThresholds() {
        return { ...this._thresholds };
    }

    async setThreshold(type, value) {
        if (!ALERT_TYPES.includes(type)) return false;
        this._thresholds[type] = value;
        await this._persist();
        logger.info(`AlertService: próg "${type}" ustawiony na ${value}`);
        return true;
    }

    getActiveAlerts() {
        return { ...this._active };
    }

    getActiveAlertCount() {
        return Object.values(this._active).filter(a => a && !a.acknowledged).length;
    }

    async acknowledgeAlert(type) {
        if (this._active[type]) {
            this._active[type].acknowledged = true;
            await this._persist();
            return true;
        }
        return false;
    }

    async acknowledgeAll() {
        let changed = false;
        for (const type of Object.keys(this._active)) {
            if (!this._active[type].acknowledged) {
                this._active[type].acknowledged = true;
                changed = true;
            }
        }
        if (changed) await this._persist();
        return changed;
    }

    /**
     * Sprawdza wartości, aktualizuje aktywne alerty.
     * @returns {string[]} typy nowych alertów (do wysłania powiadomień)
     */
    async check(ocrRate, pendingCv, dailyCost) {
        const newAlerts = [];
        const now = Date.now();

        const checks = [
            { type: 'ocrRate',   value: ocrRate,   triggered: ocrRate > 0 && ocrRate < this._thresholds.ocrRate },
            { type: 'pendingCv', value: pendingCv,  triggered: pendingCv > this._thresholds.pendingCv },
            { type: 'dailyCost', value: dailyCost,  triggered: dailyCost > this._thresholds.dailyCost },
        ];

        let changed = false;
        for (const { type, value, triggered } of checks) {
            if (triggered) {
                const lastSent = this._lastSent[type] || 0;
                const existing = this._active[type];
                const isNewOrAcked = !existing || existing.acknowledged;
                const canSend = now - lastSent > ALERT_DEBOUNCE_MS;

                if (isNewOrAcked) {
                    this._active[type] = { triggeredAt: new Date().toISOString(), value, acknowledged: false };
                    if (canSend) {
                        this._lastSent[type] = now;
                        newAlerts.push(type);
                    }
                    changed = true;
                }
            } else {
                if (this._active[type]) {
                    delete this._active[type];
                    changed = true;
                }
            }
        }

        if (changed) await this._persist();
        return newAlerts;
    }

    describeAlert(type, value) {
        const t = this._thresholds;
        switch (type) {
            case 'ocrRate':
                return `🔴 **OCR Rate** poniżej progu: **${typeof value === 'number' ? value.toFixed(1) : '?'}%** *(próg: <${t.ocrRate}%)*`;
            case 'pendingCv':
                return `🟡 **Oczekujące weryfikacje CV**: **${value ?? '?'}** *(próg: >${t.pendingCv})*`;
            case 'dailyCost':
                return `💸 **Koszt AI** przekroczył limit: **$${typeof value === 'number' ? value.toFixed(4) : '?'}** *(próg: >$${t.dailyCost})*`;
            default:
                return `⚠️ Alert: ${type} = ${value}`;
        }
    }

    describeThreshold(type) {
        const t = this._thresholds;
        switch (type) {
            case 'ocrRate':   return { label: 'Min. OCR Rate (%)',       current: `${t.ocrRate}%`,  unit: '%',  direction: 'min' };
            case 'pendingCv': return { label: 'Max oczekujących CV',      current: `${t.pendingCv}`, unit: '',   direction: 'max' };
            case 'dailyCost': return { label: 'Max koszt AI/dzień (USD)', current: `$${t.dailyCost}`,unit: '$',  direction: 'max' };
            default:          return { label: type, current: String(t[type] ?? '?'), unit: '', direction: 'max' };
        }
    }
}

module.exports = AlertService;
