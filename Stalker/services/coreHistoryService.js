const fs = require('fs').promises;
const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');
const logger = createBotLogger('Stalker');

const HISTORY_PATH = path.join(__dirname, '../data/equipment_history.json');
const MAX_DAYS = 365;

async function loadHistory() {
    try {
        return JSON.parse(await fs.readFile(HISTORY_PATH, 'utf8'));
    } catch {
        return {};
    }
}

async function saveHistory(data) {
    await fs.mkdir(path.join(__dirname, '../data'), { recursive: true });
    await fs.writeFile(HISTORY_PATH, JSON.stringify(data, null, 2));
}

function todayUTC() {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// Zapisuje/aktualizuje wpis dla bieżącego dnia użytkownika.
// Jeśli tego dnia już jest wpis, zachowuje max ilość per typ cora.
async function saveDailySnapshot(userId, items) {
    try {
        const history = await loadHistory();
        if (!history[userId]) history[userId] = [];

        const today = todayUTC();
        const existingIdx = history[userId].findIndex(e => e.date === today);

        if (existingIdx >= 0) {
            const existing = history[userId][existingIdx];
            for (const [coreName, qty] of Object.entries(items)) {
                if (existing.items[coreName] === undefined || qty > existing.items[coreName]) {
                    existing.items[coreName] = qty;
                }
            }
            existing.savedAt = new Date().toISOString();
        } else {
            history[userId].push({
                date: today,
                items: { ...items },
                savedAt: new Date().toISOString()
            });
        }

        // Usuń wpisy starsze niż MAX_DAYS
        const cutoff = new Date();
        cutoff.setUTCDate(cutoff.getUTCDate() - MAX_DAYS);
        const cutoffStr = `${cutoff.getUTCFullYear()}-${String(cutoff.getUTCMonth() + 1).padStart(2, '0')}-${String(cutoff.getUTCDate()).padStart(2, '0')}`;
        history[userId] = history[userId]
            .filter(e => e.date >= cutoffStr)
            .sort((a, b) => a.date.localeCompare(b.date));

        await saveHistory(history);
    } catch (error) {
        logger.error('[CORE-HISTORY] ❌ Błąd zapisu historii:', error);
    }
}

// SVG helpers

function escapeXml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function buildCatmullRomPath(points) {
    if (points.length === 0) return '';
    if (points.length === 1) return `M ${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
    let d = `M ${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = i > 0 ? points[i - 1] : points[i];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = i < points.length - 2 ? points[i + 2] : points[i + 1];
        const xMin = p1.x, xMax = p2.x;
        const cp1x = Math.max(xMin, Math.min(xMax, p1.x + (p2.x - p0.x) / 6)).toFixed(1);
        const cp1y = (p1.y + (p2.y - p0.y) / 6).toFixed(1);
        const cp2x = Math.max(xMin, Math.min(xMax, p2.x - (p3.x - p1.x) / 6)).toFixed(1);
        const cp2y = (p2.y - (p3.y - p1.y) / 6).toFixed(1);
        d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
    }
    return d;
}

function buildAreaPath(points, baseY) {
    if (points.length === 0) return '';
    if (points.length === 1) {
        return `M ${points[0].x.toFixed(1)},${baseY} L ${points[0].x.toFixed(1)},${points[0].y.toFixed(1)} L ${(points[0].x + 2).toFixed(1)},${baseY} Z`;
    }
    let d = `M ${points[0].x.toFixed(1)},${baseY} L ${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = i > 0 ? points[i - 1] : points[i];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = i < points.length - 2 ? points[i + 2] : points[i + 1];
        const cp1x = (p1.x + (p2.x - p0.x) / 6).toFixed(1);
        const cp1y = (p1.y + (p2.y - p0.y) / 6).toFixed(1);
        const cp2x = (p2.x - (p3.x - p1.x) / 6).toFixed(1);
        const cp2y = (p2.y - (p3.y - p1.y) / 6).toFixed(1);
        d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
    }
    d += ` L ${points[points.length - 1].x.toFixed(1)},${baseY} Z`;
    return d;
}

const MONTH_SHORT = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];

function buildMonthAxisSvg(tMin, tMax, toX, baseY) {
    const lines = [];
    const start = new Date(tMin);
    let cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    while (cur.getTime() < tMax) {
        const x = toX(cur.getTime());
        const monthIdx = cur.getUTCMonth();
        const label = monthIdx === 0
            ? `${MONTH_SHORT[monthIdx]} '${String(cur.getUTCFullYear()).slice(2)}`
            : MONTH_SHORT[monthIdx];
        lines.push(`<line x1="${x.toFixed(1)}" y1="${baseY}" x2="${x.toFixed(1)}" y2="${(baseY + 4).toFixed(1)}" stroke="#3C3F45" stroke-width="1"/>`);
        lines.push(`<text x="${x.toFixed(1)}" y="${(baseY + 14).toFixed(1)}" font-family="Arial,sans-serif" font-size="9" fill="#5C5F66" text-anchor="middle">${label}</text>`);
        cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
    }
    return lines.join('\n  ');
}

/**
 * Generuje wykres historii danego typu cora dla gracza.
 * @param {string} userId
 * @param {string} coreName
 * @param {string} username  - nick do wyświetlenia w nagłówku
 * @returns {Promise<Buffer|null>}
 */
async function generateCoreHistoryChart(userId, coreName, username) {
    try {
        const sharp = require('sharp');
        const history = await loadHistory();
        const userHistory = history[userId] || [];

        const cutoff = new Date();
        cutoff.setUTCDate(cutoff.getUTCDate() - 365);
        const cutoffStr = `${cutoff.getUTCFullYear()}-${String(cutoff.getUTCMonth() + 1).padStart(2, '0')}-${String(cutoff.getUTCDate()).padStart(2, '0')}`;

        const entries = userHistory
            .filter(e => e.date >= cutoffStr && e.items[coreName] !== undefined)
            .map(e => ({
                date: e.date,
                qty: e.items[coreName],
                ts: Date.UTC(...e.date.split('-').map((v, i) => i === 1 ? Number(v) - 1 : Number(v)))
            }))
            .sort((a, b) => a.ts - b.ts);

        if (entries.length < 2) return null;

        const W = 900, H = 280;
        const M = { top: 52, right: 32, bottom: 50, left: 80 };
        const cW = W - M.left - M.right;
        const cH = H - M.top - M.bottom;
        const baseY = M.top + cH;

        const values = entries.map(e => e.qty);
        const minVal = Math.min(...values);
        const maxVal = Math.max(...values);
        const valRange = maxVal - minVal || 1;
        const yMin = Math.max(0, minVal - valRange * 0.15);
        const yMax = maxVal + valRange * 0.30;

        const tMin = entries[0].ts;
        const tMax = entries[entries.length - 1].ts;
        const tRange = tMax - tMin || 1;

        const toX = (t) => M.left + (0.05 + 0.90 * (t - tMin) / tRange) * cW;
        const toY = (v) => M.top + cH - ((v - yMin) / (yMax - yMin)) * cH;

        const color = '#5865F2';

        const pts = entries.map(e => ({
            x: toX(e.ts),
            y: toY(e.qty),
            qty: e.qty,
        }));

        // Linie siatki poziomej
        const gridLines = Array.from({ length: 5 }, (_, i) => {
            const v = yMin + (yMax - yMin) * (i / 4);
            const y = toY(v);
            const lbl = Math.round(v).toLocaleString('pl-PL');
            return `<line x1="${M.left}" y1="${y.toFixed(1)}" x2="${W - M.right}" y2="${y.toFixed(1)}" stroke="#2B2D31" stroke-width="1" stroke-dasharray="3,4"/>
    <text x="${M.left - 10}" y="${(y + 4).toFixed(1)}" font-family="Arial,sans-serif" font-size="10" fill="#5C5F66" text-anchor="end">${escapeXml(lbl)}</text>`;
        }).join('\n    ');

        const linePath = buildCatmullRomPath(pts);
        const areaPath = buildAreaPath(pts, baseY);

        // Detekcja kolizji etykiet
        const labelOffsets = pts.map(() => 14);
        for (let i = 1; i < pts.length; i++) {
            const prevLabelY = pts[i - 1].y - labelOffsets[i - 1];
            const desiredLabelY = pts[i].y - 14;
            if (Math.abs(desiredLabelY - prevLabelY) < 12) {
                const adjusted = Math.max(M.top - 8, Math.min(prevLabelY - 12, desiredLabelY));
                labelOffsets[i] = pts[i].y - adjusted;
            }
        }

        const dotsSvg = pts.map((p, idx) => {
            const labelY = (p.y - labelOffsets[idx]).toFixed(1);
            return [
                `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="#1E1F22" stroke="${color}" stroke-width="2"/>`,
                `<text x="${p.x.toFixed(1)}" y="${labelY}" font-family="Arial,sans-serif" font-size="9" fill="#B5BAC1" text-anchor="middle">${escapeXml(p.qty.toLocaleString('pl-PL'))}</text>`,
            ].join('\n    ');
        }).join('\n    ');

        const lastPt = pts[pts.length - 1];
        const lastHighlight = `<circle cx="${lastPt.x.toFixed(1)}" cy="${lastPt.y.toFixed(1)}" r="6" fill="${color}" opacity="0.25"/>`;

        const fmtDate = (dateStr) => {
            const [y, m, d] = dateStr.split('-');
            return `${d}.${m}.${y}`;
        };
        const headerRight = `${fmtDate(entries[0].date)} – ${fmtDate(entries[entries.length - 1].date)}`;

        const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="coreGrad" x1="0" y1="${M.top}" x2="0" y2="${baseY}" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="${color}" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="chartClip">
      <rect x="${M.left}" y="${M.top}" width="${cW}" height="${cH}"/>
    </clipPath>
  </defs>

  <rect width="${W}" height="${H}" rx="10" fill="#1E1F22"/>

  <line x1="${M.left}" y1="${M.top - 10}" x2="${W - M.right}" y2="${M.top - 10}" stroke="#2B2D31" stroke-width="1"/>

  <text x="${M.left}" y="32" font-family="Arial,sans-serif" font-size="13" fill="#E3E5E8" font-weight="bold">${escapeXml(username)}</text>
  <text x="${W / 2}" y="32" font-family="Arial,sans-serif" font-size="13" fill="#FFFFFF" text-anchor="middle" font-weight="bold">Historia ${escapeXml(coreName)}</text>
  <text x="${W - M.right}" y="32" font-family="Arial,sans-serif" font-size="10" fill="#5C5F66" text-anchor="end">${escapeXml(headerRight)}</text>

  ${gridLines}

  <line x1="${M.left}" y1="${M.top}" x2="${M.left}" y2="${baseY}" stroke="#2B2D31" stroke-width="1"/>
  <line x1="${M.left}" y1="${baseY}" x2="${W - M.right}" y2="${baseY}" stroke="#2B2D31" stroke-width="1"/>

  <g clip-path="url(#chartClip)">
    <path d="${escapeXml(areaPath)}" fill="url(#coreGrad)"/>
  </g>

  <g clip-path="url(#chartClip)">
    <path d="${escapeXml(linePath)}" stroke="${color}" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  </g>

  ${lastHighlight}

  ${dotsSvg}

  ${buildMonthAxisSvg(tMin, tMax, toX, baseY)}
</svg>`;

        return await sharp(Buffer.from(svg)).png().toBuffer();
    } catch (error) {
        logger.error('[CORE-HISTORY] ❌ Błąd generowania wykresu:', error);
        return null;
    }
}

module.exports = { saveDailySnapshot, generateCoreHistoryChart };
