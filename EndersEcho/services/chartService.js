const { createBotLogger } = require('../../utils/consoleLogger');
const logger = createBotLogger('EndersEcho');

const SCORE_UNITS = [
    { name: 'Sx', value: 1e21 },
    { name: 'Qi', value: 1e18 },
    { name: 'Q',  value: 1e15 },
    { name: 'T',  value: 1e12 },
    { name: 'B',  value: 1e9  },
    { name: 'M',  value: 1e6  },
    { name: 'K',  value: 1e3  },
];

function formatYLabel(value) {
    for (const u of SCORE_UNITS) {
        if (value >= u.value) {
            const v = value / u.value;
            return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}${u.name}`;
        }
    }
    return Math.round(value).toString();
}

function formatDateLabel(isoString) {
    const d = new Date(isoString);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${day}.${month}`;
}

function escapeXml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function buildCatmullRom(points) {
    if (points.length < 2) return '';
    let d = `M ${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
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
    return d;
}

/**
 * Generuje wykres historii rekordów gracza w EndersEcho.
 * @param {Array<{score: string, scoreValue: number, timestamp: string}>} history
 * @param {string} username
 * @param {string} chartTitle
 * @returns {Promise<Buffer|null>}
 */
async function generateScoreHistoryChart(history, username, chartTitle) {
    const sharp = require('sharp');

    const sorted = [...history].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    if (sorted.length < 2) return null;

    const W = 800, H = 280;
    const M = { top: 45, right: 30, bottom: 50, left: 80 };
    const cW = W - M.left - M.right;
    const cH = H - M.top - M.bottom;

    const values = sorted.map(d => d.scoreValue);
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const valRange = maxVal - minVal || 1;
    const yMin = Math.max(0, minVal - valRange * 0.15);
    const yMax = maxVal + valRange * 0.30;

    const timestamps = sorted.map(d => new Date(d.timestamp).getTime());
    const tMin = timestamps[0];
    const tMax = timestamps[timestamps.length - 1];
    const tRange = tMax - tMin || 1;

    // 5% padding po obu stronach żeby skrajne punkty nie leżały na osiach
    const toX = (t) => M.left + (0.05 + 0.90 * (t - tMin) / tRange) * cW;
    const toY = (v) => M.top + cH - ((v - yMin) / (yMax - yMin)) * cH;

    const pts = sorted.map(d => ({
        x: toX(new Date(d.timestamp).getTime()),
        y: toY(d.scoreValue),
        score: d.score,
        lbl: formatDateLabel(d.timestamp),
    }));

    const lineColor = '#5865F2';
    const linePath = buildCatmullRom(pts);

    // 5 poziomych linii siatki z etykietami jednostek
    const gridLines = Array.from({ length: 5 }, (_, i) => {
        const v = yMin + (yMax - yMin) * (i / 4);
        const y = toY(v);
        const lbl = formatYLabel(v);
        return `<line x1="${M.left}" y1="${y.toFixed(1)}" x2="${W - M.right}" y2="${y.toFixed(1)}" stroke="#393C43" stroke-width="1"/>
    <text x="${M.left - 8}" y="${(y + 4).toFixed(1)}" font-family="Arial,sans-serif" font-size="10" fill="#72767D" text-anchor="end">${lbl}</text>`;
    }).join('\n    ');

    // Etykiety X — przy wielu punktach pomijaj co 2-3
    const showStep = pts.length > 20 ? 3 : pts.length > 10 ? 2 : 1;
    const xLabels = pts
        .filter((_, i) => i % showStep === 0 || i === pts.length - 1)
        .map(p => `<text x="${p.x.toFixed(1)}" y="${(M.top + cH + 18).toFixed(1)}" font-family="Arial,sans-serif" font-size="9" fill="#72767D" text-anchor="middle">${p.lbl}</text>`)
        .join('\n    ');

    // Detekcja kolizji etykiet wartości nad kropkami
    const labelOffsets = pts.map(() => 8);
    for (let i = 1; i < pts.length; i++) {
        const prevLabelY = pts[i - 1].y - labelOffsets[i - 1];
        const desiredLabelY = pts[i].y - 8;
        if (Math.abs(desiredLabelY - prevLabelY) < 11) {
            const newLabelY = Math.max(M.top - 10, Math.min(prevLabelY - 11, desiredLabelY));
            labelOffsets[i] = pts[i].y - newLabelY;
        }
    }

    const dotsSvg = pts.map((p, idx) =>
        `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" fill="#2B2D31" stroke="${lineColor}" stroke-width="1.5"/>
    <text x="${p.x.toFixed(1)}" y="${(p.y - labelOffsets[idx]).toFixed(1)}" font-family="Arial,sans-serif" font-size="9" fill="#B5BAC1" text-anchor="middle">${escapeXml(p.score)}</text>`
    ).join('\n    ');

    const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" rx="8" fill="#2B2D31"/>
  <text x="${M.left}" y="28" font-family="Arial,sans-serif" font-size="12" fill="#B5BAC1" font-weight="bold">${escapeXml(username)}</text>
  <text x="${W / 2}" y="28" font-family="Arial,sans-serif" font-size="13" fill="#FFFFFF" text-anchor="middle" font-weight="bold">${escapeXml(chartTitle)}</text>
  ${gridLines}
  <line x1="${M.left}" y1="${M.top}" x2="${M.left}" y2="${M.top + cH}" stroke="#393C43" stroke-width="1"/>
  <line x1="${M.left}" y1="${M.top + cH}" x2="${W - M.right}" y2="${M.top + cH}" stroke="#393C43" stroke-width="1"/>
  <path d="${linePath}" stroke="${lineColor}" stroke-width="2.5" fill="none"/>
  ${dotsSvg}
  ${xLabels}
</svg>`;

    return sharp(Buffer.from(svg)).png().toBuffer();
}

module.exports = { generateScoreHistoryChart };
