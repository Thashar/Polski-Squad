const fs = require('fs').promises;
const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');
const store = require('../../utils/jsonStore');
const logger = createBotLogger('Stalker');

const HISTORY_PATH = path.join(__dirname, '../data/equipment_history.json');
const MAX_DAYS = 365;

async function loadHistory() {
    try {
        return await store.getOrLoad(HISTORY_PATH, () => ({}));
    } catch {
        return {};
    }
}

async function saveHistory(data) {
    await fs.mkdir(path.join(__dirname, '../data'), { recursive: true });
    await store.set(HISTORY_PATH, data);
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

/**
 * Punkty kontrolne krzywej Catmull-Rom dla każdego odcinka — wspólne dla linii i dla
 * wypełnienia pod nią, żeby oba rysunki szły dokładnie tą samą trasą.
 *
 * Odstępstwo od czystego Catmull-Roma: styczna liczona z SĄSIADÓW sprawia, że **poziomy
 * odcinek zaczyna się unosić jeszcze zanim faktycznie wzrośnie** — a przy ilościach corów
 * plateau jest normą (gracz przez tydzień nie zbiera, potem skacze). Gdy sąsiedni odcinek
 * jest poziomy, styczna liczona jest z NASZEGO odcinka, więc płaski fragment zostaje
 * idealnie płaski, a przejście w górę jest ostre. Zaokrąglenie zostaje wszędzie tam,
 * gdzie plateau nie ma.
 */
function catmullRomControlPoints(points) {
    const segments = [];
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = i > 0 ? points[i - 1] : points[i];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = i < points.length - 2 ? points[i + 2] : points[i + 1];

        // selfFlat ma pierwszeństwo: odcinek bez zmiany ilości musi być idealnie poziomy
        // na CAŁEJ długości. Bez tego ostatni odcinek plateau wyginał się w dół tuż przed
        // wzrostem (styczna w p2 liczona z p3, czyli już z rosnącego fragmentu).
        const selfFlat = p1.y === p2.y;
        const prevFlat = i > 0 && p0.y === p1.y;
        const nextFlat = i < points.length - 2 && p2.y === p3.y;

        const cp1y = selfFlat ? p1.y : (prevFlat ? p1.y + (p2.y - p1.y) / 3 : p1.y + (p2.y - p0.y) / 6);
        const cp2y = selfFlat ? p2.y : (nextFlat ? p2.y - (p2.y - p1.y) / 3 : p2.y - (p3.y - p1.y) / 6);

        // Punkty kontrolne w poziomie trzymamy wewnątrz odcinka — inaczej krzywa potrafi
        // się cofnąć i zrobić pętelkę przy nierównych odstępach między pomiarami
        const clampX = (x) => Math.max(p1.x, Math.min(p2.x, x));
        segments.push({
            cp1x: clampX(prevFlat ? p1.x + (p2.x - p1.x) / 3 : p1.x + (p2.x - p0.x) / 6),
            cp1y,
            cp2x: clampX(nextFlat ? p2.x - (p2.x - p1.x) / 3 : p2.x - (p3.x - p1.x) / 6),
            cp2y,
            x: p2.x,
            y: p2.y,
        });
    }
    return segments;
}

function segmentsToCurve(segments) {
    return segments
        .map(s => ` C ${s.cp1x.toFixed(1)},${s.cp1y.toFixed(1)} ${s.cp2x.toFixed(1)},${s.cp2y.toFixed(1)} ${s.x.toFixed(1)},${s.y.toFixed(1)}`)
        .join('');
}

function buildCatmullRomPath(points) {
    if (points.length === 0) return '';
    if (points.length === 1) return `M ${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
    return `M ${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}${segmentsToCurve(catmullRomControlPoints(points))}`;
}

function buildAreaPath(points, baseY) {
    if (points.length === 0) return '';
    if (points.length === 1) {
        return `M ${points[0].x.toFixed(1)},${baseY} L ${points[0].x.toFixed(1)},${points[0].y.toFixed(1)} L ${(points[0].x + 2).toFixed(1)},${baseY} Z`;
    }
    const d = `M ${points[0].x.toFixed(1)},${baseY} L ${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`
        + segmentsToCurve(catmullRomControlPoints(points));
    return `${d} L ${points[points.length - 1].x.toFixed(1)},${baseY} Z`;
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
 * @param {string} coreName  - nazwa w nagłówku wykresu (dla sumy: etykieta zbiorcza)
 * @param {string} username  - nick do wyświetlenia w nagłówku
 * @param {Function|null} valueFn - własne wyliczenie wartości z `items` snapshotu; `undefined`
 *   oznacza brak danych tego dnia (punkt pomijany). Domyślnie ilość pojedynczego cora —
 *   dzięki temu ranking „Suma Core" rysuje wykres tym samym kodem, podając sumę corów
 * @returns {Promise<Buffer|null>}
 */
async function generateCoreHistoryChart(userId, coreName, username, valueFn = null) {
    try {
        const sharp = require('sharp');
        const history = await loadHistory();
        const userHistory = history[userId] || [];

        const readQty = typeof valueFn === 'function' ? valueFn : (items => items[coreName]);

        const cutoff = new Date();
        cutoff.setUTCDate(cutoff.getUTCDate() - 365);
        const cutoffStr = `${cutoff.getUTCFullYear()}-${String(cutoff.getUTCMonth() + 1).padStart(2, '0')}-${String(cutoff.getUTCDate()).padStart(2, '0')}`;

        const entries = userHistory
            .filter(e => e.date >= cutoffStr && readQty(e.items) !== undefined)
            .map(e => ({
                date: e.date,
                qty: readQty(e.items),
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

/**
 * Paleta serii — kolory dobrane tak, żeby dało się je rozróżnić na ciemnym tle Discorda
 * i żeby sąsiednie pozycje rankingu nie dostawały zbliżonych odcieni.
 */
const SERIES_COLORS = [
    '#5865F2', '#57F287', '#FEE75C', '#EB459E', '#00B4D8',
    '#E67E22', '#9B59B6', '#1ABC9C', '#ED4245', '#95A5A6',
];

/**
 * Wykres porównawczy: jedna linia progresu na gracza (strona rankingu corów).
 *
 * W odróżnieniu od `generateCoreHistoryChart` NIE rysuje wypełnienia pod krzywą ani
 * etykiet przy każdym punkcie — przy dziesięciu seriach naraz jedno i drugie zlewa się
 * w nieczytelną plamę. Zamiast tego: cienkie linie, małe kropki, wartość tylko przy
 * ostatnim punkcie serii i legenda z kolorem, nickiem oraz aktualną ilością.
 *
 * @param {Array<{userId: string, name: string}>} players - gracze w kolejności rankingu
 * @param {string} coreName - nazwa w nagłówku
 * @param {Function|null} valueFn - jak w `generateCoreHistoryChart`
 * @returns {Promise<Buffer|null>} null, gdy nikt z podanych graczy nie ma historii
 */
async function generateCoreComparisonChart(players, coreName, valueFn = null) {
    try {
        const sharp = require('sharp');
        const history = await loadHistory();
        const readQty = typeof valueFn === 'function' ? valueFn : (items => items[coreName]);

        const cutoff = new Date();
        cutoff.setUTCDate(cutoff.getUTCDate() - 365);
        const cutoffStr = `${cutoff.getUTCFullYear()}-${String(cutoff.getUTCMonth() + 1).padStart(2, '0')}-${String(cutoff.getUTCDate()).padStart(2, '0')}`;

        const series = [];
        for (const [i, player] of (players || []).entries()) {
            const entries = (history[player.userId] || [])
                .filter(e => e.date >= cutoffStr && readQty(e.items) !== undefined)
                .map(e => ({
                    date: e.date,
                    qty: readQty(e.items),
                    ts: Date.UTC(...e.date.split('-').map((v, idx) => idx === 1 ? Number(v) - 1 : Number(v))),
                }))
                .sort((a, b) => a.ts - b.ts);
            // Gracz z jednym pomiarem nie ma progresu, ale jego punkt nadal niesie informację
            if (entries.length === 0) continue;
            series.push({ ...player, entries, color: SERIES_COLORS[i % SERIES_COLORS.length] });
        }

        if (series.length === 0) return null;

        const LEGEND_PER_ROW = 5;
        const legendRows = Math.ceil(series.length / LEGEND_PER_ROW);
        const W = 900;
        const M = { top: 52, right: 46, bottom: 50 + legendRows * 18, left: 80 };
        // Pole danych 4x wyższe — przy kilkunastu graczach linie leżały na sobie
        const HEIGHT_SCALE = 4;
        const cH = 148 * HEIGHT_SCALE;
        const H = M.top + cH + M.bottom;
        const cW = W - M.left - M.right;
        const baseY = M.top + cH;

        const allValues = series.flatMap(s => s.entries.map(e => e.qty));
        const minVal = Math.min(...allValues);
        const maxVal = Math.max(...allValues);
        const valRange = maxVal - minVal || 1;
        const yMin = Math.max(0, minVal - valRange * 0.15);
        const yMax = maxVal + valRange * 0.20;

        const allTs = series.flatMap(s => s.entries.map(e => e.ts));
        const tMin = Math.min(...allTs);
        const tMax = Math.max(...allTs);
        const tRange = tMax - tMin || 1;

        const toX = (t) => M.left + (0.05 + 0.90 * (t - tMin) / tRange) * cW;
        const toY = (v) => M.top + cH - ((v - yMin) / (yMax - yMin)) * cH;

        const gridLines = Array.from({ length: 5 }, (_, i) => {
            const v = yMin + (yMax - yMin) * (i / 4);
            const y = toY(v);
            const lbl = Math.round(v).toLocaleString('pl-PL');
            return `<line x1="${M.left}" y1="${y.toFixed(1)}" x2="${W - M.right}" y2="${y.toFixed(1)}" stroke="#2B2D31" stroke-width="1" stroke-dasharray="3,4"/>
    <text x="${M.left - 10}" y="${(y + 4).toFixed(1)}" font-family="Arial,sans-serif" font-size="10" fill="#5C5F66" text-anchor="end">${escapeXml(lbl)}</text>`;
        }).join('\n    ');

        // Etykiety ostatnich punktów rozsuwane w pionie — przy zbliżonych ilościach
        // nachodziłyby na siebie i nie dałoby się odczytać żadnej
        const endLabels = series
            .map(s => {
                const last = s.entries[s.entries.length - 1];
                return { y: toY(last.qty), x: toX(last.ts), qty: last.qty, color: s.color };
            })
            .sort((a, b) => a.y - b.y);
        for (let i = 1; i < endLabels.length; i++) {
            if (endLabels[i].y - endLabels[i - 1].y < 11) endLabels[i].y = endLabels[i - 1].y + 11;
        }

        const seriesSvg = series.map(s => {
            const pts = s.entries.map(e => ({ x: toX(e.ts), y: toY(e.qty) }));
            const linePath = buildCatmullRomPath(pts);
            const dots = pts.map(p =>
                `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2.5" fill="#1E1F22" stroke="${s.color}" stroke-width="1.5"/>`
            ).join('\n    ');
            const line = pts.length > 1
                ? `<path d="${escapeXml(linePath)}" stroke="${s.color}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
                : '';
            return `${line}\n    ${dots}`;
        }).join('\n    ');

        const endLabelsSvg = endLabels.map(l =>
            `<text x="${(l.x + 6).toFixed(1)}" y="${(l.y + 3).toFixed(1)}" font-family="Arial,sans-serif" font-size="9" fill="${l.color}" text-anchor="start">${escapeXml(l.qty.toLocaleString('pl-PL'))}</text>`
        ).join('\n    ');

        const colW = cW / LEGEND_PER_ROW;
        const legendSvg = series.map((s, i) => {
            const row = Math.floor(i / LEGEND_PER_ROW);
            const col = i % LEGEND_PER_ROW;
            const x = M.left + col * colW;
            const y = baseY + 34 + row * 18;
            const nick = s.name.length > 16 ? `${s.name.slice(0, 15)}…` : s.name;
            return `<rect x="${x.toFixed(1)}" y="${(y - 7).toFixed(1)}" width="9" height="9" rx="2" fill="${s.color}"/>
    <text x="${(x + 14).toFixed(1)}" y="${y.toFixed(1)}" font-family="Arial,sans-serif" font-size="9" fill="#B5BAC1">${escapeXml(nick)}</text>`;
        }).join('\n    ');

        const fmtDate = (dateStr) => {
            const [y, m, d] = dateStr.split('-');
            return `${d}.${m}.${y}`;
        };
        const firstDate = series.map(s => s.entries[0].date).sort()[0];
        const lastDate = series.map(s => s.entries[s.entries.length - 1].date).sort().pop();

        const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="cmpClip">
      <rect x="${M.left}" y="${M.top}" width="${cW}" height="${cH}"/>
    </clipPath>
  </defs>

  <rect width="${W}" height="${H}" rx="10" fill="#1E1F22"/>

  <line x1="${M.left}" y1="${M.top - 10}" x2="${W - M.right}" y2="${M.top - 10}" stroke="#2B2D31" stroke-width="1"/>

  <text x="${M.left}" y="32" font-family="Arial,sans-serif" font-size="13" fill="#E3E5E8" font-weight="bold">${escapeXml(`${series.length} graczy`)}</text>
  <text x="${W / 2}" y="32" font-family="Arial,sans-serif" font-size="13" fill="#FFFFFF" text-anchor="middle" font-weight="bold">Progres — ${escapeXml(coreName)}</text>
  <text x="${W - M.right}" y="32" font-family="Arial,sans-serif" font-size="10" fill="#5C5F66" text-anchor="end">${escapeXml(`${fmtDate(firstDate)} – ${fmtDate(lastDate)}`)}</text>

  ${gridLines}

  <line x1="${M.left}" y1="${M.top}" x2="${M.left}" y2="${baseY}" stroke="#2B2D31" stroke-width="1"/>
  <line x1="${M.left}" y1="${baseY}" x2="${W - M.right}" y2="${baseY}" stroke="#2B2D31" stroke-width="1"/>

  <g clip-path="url(#cmpClip)">
    ${seriesSvg}
  </g>

  ${endLabelsSvg}

  ${buildMonthAxisSvg(tMin, tMax, toX, baseY)}

  ${legendSvg}
</svg>`;

        return await sharp(Buffer.from(svg)).png().toBuffer();
    } catch (error) {
        logger.error('[CORE-HISTORY] ❌ Błąd generowania wykresu porównawczego:', error);
        return null;
    }
}

module.exports = { saveDailySnapshot, generateCoreHistoryChart, generateCoreComparisonChart };
