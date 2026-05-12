const { createBotLogger } = require('../../utils/consoleLogger');
const logger = createBotLogger('EndersEcho');

// Paleta kolorów per klan — Discord dark-theme friendly
const CLAN_PALETTE = [
    '#5865F2', // Blurple
    '#F5A524', // Złoty
    '#3BA55D', // Zielony
    '#ED4245', // Czerwony
    '#9B84EC', // Fioletowy
    '#5DADE2', // Niebieski
    '#E67E22', // Pomarańczowy
];

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

function formatDateYear(isoString) {
    const d = new Date(isoString);
    return d.getFullYear();
}

function escapeXml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Buduje SVG path krzywej Catmull-Rom przez podane punkty
function buildCatmullRomPath(points) {
    if (points.length === 0) return '';
    if (points.length === 1) return `M ${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
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

// Buduje zamknięty path pod krzywą (do wypełnienia gradientem)
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

/**
 * Generuje wykres historii rekordów gracza z kolorami per klan/serwer.
 * @param {Array<{score:string, scoreValue:number, timestamp:string, bossName?:string, guildId?:string}>} history
 * @param {string} username
 * @param {string} chartTitle
 * @param {Object} guildTagMap  { guildId: 'PS' | 'CS' | ... }
 * @returns {Promise<Buffer|null>}
 */
async function generateScoreHistoryChart(history, username, chartTitle, guildTagMap = {}) {
    const sharp = require('sharp');

    const sorted = [...history].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    if (sorted.length < 2) return null;

    const W = 900, H = 330;
    const M = { top: 52, right: 32, bottom: 95, left: 85 };
    const cW = W - M.left - M.right;
    const cH = H - M.top - M.bottom;
    const baseY = M.top + cH;

    // Zakresy wartości
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

    const toX = (t) => M.left + (0.05 + 0.90 * (t - tMin) / tRange) * cW;
    const toY = (v) => M.top + cH - ((v - yMin) / (yMax - yMin)) * cH;

    // Punkty z informacją o klanie
    const pts = sorted.map(d => ({
        x: toX(new Date(d.timestamp).getTime()),
        y: toY(d.scoreValue),
        score: d.score,
        bossName: d.bossName || '',
        lbl: formatDateLabel(d.timestamp),
        guildId: d.guildId || '__single__',
        timestamp: d.timestamp,
    }));

    // Przypisz kolory do unikalnych guildId (w kolejności pierwszego wystąpienia)
    const guildOrder = [];
    for (const p of pts) {
        if (!guildOrder.includes(p.guildId)) guildOrder.push(p.guildId);
    }
    const guildColorMap = {};
    guildOrder.forEach((gid, i) => {
        guildColorMap[gid] = CLAN_PALETTE[i % CLAN_PALETTE.length];
    });

    const multiClan = guildOrder.length > 1;

    // Podziel punkty na kolejne segmenty tego samego klanu
    const segments = [];
    let seg = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
        if (pts[i].guildId === pts[i - 1].guildId) {
            seg.push(pts[i]);
        } else {
            segments.push({ guildId: pts[i - 1].guildId, points: seg });
            seg = [pts[i]];
        }
    }
    segments.push({ guildId: pts[pts.length - 1].guildId, points: seg });

    // Pozycje X przejść między klanami (midpoint między ostatnim pkt A i pierwszym pkt B)
    const transitions = [];
    for (let i = 1; i < segments.length; i++) {
        const prevLast = segments[i - 1].points[segments[i - 1].points.length - 1];
        const nextFirst = segments[i].points[0];
        transitions.push({
            x: (prevLast.x + nextFirst.x) / 2,
            fromGuildId: segments[i - 1].guildId,
            toGuildId: segments[i].guildId,
            toColor: guildColorMap[segments[i].guildId],
            toTag: guildTagMap[segments[i].guildId] || '—',
        });
    }

    // --- SVG defs: gradienty per klan ---
    const gradientDefs = guildOrder.map((gid, i) => {
        const color = guildColorMap[gid];
        return `<linearGradient id="areaGrad${i}" x1="0" y1="${M.top}" x2="0" y2="${baseY}" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="${color}" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
    </linearGradient>`;
    }).join('\n    ');

    // --- Linie siatki (poziome, przerywane) ---
    const gridLines = Array.from({ length: 5 }, (_, i) => {
        const v = yMin + (yMax - yMin) * (i / 4);
        const y = toY(v);
        const lbl = formatYLabel(v);
        return `<line x1="${M.left}" y1="${y.toFixed(1)}" x2="${W - M.right}" y2="${y.toFixed(1)}" stroke="#2B2D31" stroke-width="1" stroke-dasharray="3,4"/>
    <text x="${M.left - 10}" y="${(y + 4).toFixed(1)}" font-family="Arial,sans-serif" font-size="10" fill="#5C5F66" text-anchor="end">${lbl}</text>`;
    }).join('\n    ');

    // --- Wypełnienia gradient pod krzywymi ---
    const areaFills = segments.map(s => {
        const gradIdx = guildOrder.indexOf(s.guildId);
        const aPath = buildAreaPath(s.points, baseY);
        return `<path d="${escapeXml(aPath)}" fill="url(#areaGrad${gradIdx})"/>`;
    }).join('\n    ');

    // --- Linie krzywych per segment ---
    const curveLines = segments.map(s => {
        const color = guildColorMap[s.guildId];
        const lPath = buildCatmullRomPath(s.points);
        return `<path d="${escapeXml(lPath)}" stroke="${color}" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
    }).join('\n    ');

    // --- Łączniki między segmentami (przerywana linia na przejściu) ---
    const connectors = [];
    for (let i = 1; i < segments.length; i++) {
        const prev = segments[i - 1].points[segments[i - 1].points.length - 1];
        const next = segments[i].points[0];
        connectors.push(
            `<line x1="${prev.x.toFixed(1)}" y1="${prev.y.toFixed(1)}" x2="${next.x.toFixed(1)}" y2="${next.y.toFixed(1)}" stroke="#4E5058" stroke-width="1.5" stroke-dasharray="3,3"/>`
        );
    }
    const connectorsSvg = connectors.join('\n    ');

    // --- Markery przejść klanów (pionowa linia + badge) ---
    const transitionMarkers = transitions.map(t => {
        const tag = escapeXml(t.toTag);
        const color = t.toColor;
        const badgeW = Math.max(tag.length * 7 + 18, 30);
        const badgeX = (t.x - badgeW / 2).toFixed(1);
        const badgeY = baseY + 18;
        return [
            `<line x1="${t.x.toFixed(1)}" y1="${M.top}" x2="${t.x.toFixed(1)}" y2="${baseY}" stroke="${color}" stroke-width="1" stroke-dasharray="4,3" opacity="0.55"/>`,
            `<rect x="${badgeX}" y="${badgeY}" width="${badgeW}" height="17" rx="8.5" fill="${color}" opacity="0.92"/>`,
            `<text x="${t.x.toFixed(1)}" y="${(badgeY + 12).toFixed(1)}" font-family="Arial,sans-serif" font-size="9" fill="#FFFFFF" text-anchor="middle" font-weight="bold">${tag}</text>`,
        ].join('\n    ');
    }).join('\n    ');

    // --- Kropki z etykietami wyników (detekcja kolizji) ---
    const labelOffsets = pts.map(() => 12);
    for (let i = 1; i < pts.length; i++) {
        const prevLabelY = pts[i - 1].y - labelOffsets[i - 1];
        const desiredLabelY = pts[i].y - 12;
        if (Math.abs(desiredLabelY - prevLabelY) < 12) {
            const adjusted = Math.max(M.top - 8, Math.min(prevLabelY - 12, desiredLabelY));
            labelOffsets[i] = pts[i].y - adjusted;
        }
    }

    const dotsSvg = pts.map((p, idx) => {
        const color = guildColorMap[p.guildId];
        const labelY = (p.y - labelOffsets[idx]).toFixed(1);
        return [
            `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="#1E1F22" stroke="${color}" stroke-width="2"/>`,
            `<text x="${p.x.toFixed(1)}" y="${labelY}" font-family="Arial,sans-serif" font-size="9" fill="#B5BAC1" text-anchor="middle">${escapeXml(p.score)}</text>`,
        ].join('\n    ');
    }).join('\n    ');

    // --- Etykiety osi X (daty) ---
    const showStep = pts.length > 20 ? 3 : pts.length > 10 ? 2 : 1;
    const xLabels = pts
        .filter((_, i) => i % showStep === 0 || i === pts.length - 1)
        .map(p => `<text x="${p.x.toFixed(1)}" y="${(baseY + 15).toFixed(1)}" font-family="Arial,sans-serif" font-size="9" fill="#5C5F66" text-anchor="middle">${p.lbl}</text>`)
        .join('\n    ');

    // --- Legenda (dół wykresu) ---
    const legendY = H - 36;
    const legendItems = guildOrder.map((gid, i) => {
        const color = guildColorMap[gid];
        const tag = guildTagMap[gid] || '—';
        const guildPts = pts.filter(p => p.guildId === gid);
        const dateFrom = guildPts[0]?.lbl || '';
        const dateTo = guildPts[guildPts.length - 1]?.lbl || '';
        const dateRange = dateFrom === dateTo ? dateFrom : `${dateFrom} – ${dateTo}`;
        const itemW = (W - M.left - M.right) / guildOrder.length;
        const x = M.left + i * itemW;
        return [
            `<rect x="${x.toFixed(1)}" y="${legendY}" width="13" height="13" rx="3" fill="${color}"/>`,
            `<text x="${(x + 19).toFixed(1)}" y="${(legendY + 10).toFixed(1)}" font-family="Arial,sans-serif" font-size="11" fill="#E3E5E8" font-weight="bold">${escapeXml(tag)}</text>`,
            `<text x="${(x + 19).toFixed(1)}" y="${(legendY + 23).toFixed(1)}" font-family="Arial,sans-serif" font-size="9" fill="#5C5F66">${escapeXml(dateRange)}</text>`,
        ].join('\n    ');
    }).join('\n    ');

    // --- Separator legendy ---
    const legendSepY = legendY - 8;
    const legendSep = `<line x1="${M.left}" y1="${legendSepY}" x2="${W - M.right}" y2="${legendSepY}" stroke="#2B2D31" stroke-width="1"/>`;

    // --- Header ---
    const firstDate = formatDateLabel(sorted[0].timestamp);
    const lastDate = formatDateLabel(sorted[sorted.length - 1].timestamp);
    const year = formatDateYear(sorted[sorted.length - 1].timestamp);
    const headerRight = `${firstDate} – ${lastDate} ${year}`;

    // --- Ostatni punkt: duże koło wyróżnienia ---
    const lastPt = pts[pts.length - 1];
    const lastColor = guildColorMap[lastPt.guildId];
    const lastHighlight = `<circle cx="${lastPt.x.toFixed(1)}" cy="${lastPt.y.toFixed(1)}" r="6" fill="${lastColor}" opacity="0.25"/>`;

    const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    ${gradientDefs}
    <clipPath id="chartClip">
      <rect x="${M.left}" y="${M.top}" width="${cW}" height="${cH}"/>
    </clipPath>
  </defs>

  <!-- Tło -->
  <rect width="${W}" height="${H}" rx="10" fill="#1E1F22"/>

  <!-- Separator nagłówka -->
  <line x1="${M.left}" y1="${M.top - 10}" x2="${W - M.right}" y2="${M.top - 10}" stroke="#2B2D31" stroke-width="1"/>

  <!-- Nagłówek -->
  <text x="${M.left}" y="32" font-family="Arial,sans-serif" font-size="13" fill="#E3E5E8" font-weight="bold">${escapeXml(username)}</text>
  <text x="${W / 2}" y="32" font-family="Arial,sans-serif" font-size="13" fill="#FFFFFF" text-anchor="middle" font-weight="bold">${escapeXml(chartTitle)}</text>
  <text x="${W - M.right}" y="32" font-family="Arial,sans-serif" font-size="10" fill="#5C5F66" text-anchor="end">${escapeXml(headerRight)}</text>

  <!-- Siatka -->
  ${gridLines}

  <!-- Osie -->
  <line x1="${M.left}" y1="${M.top}" x2="${M.left}" y2="${baseY}" stroke="#2B2D31" stroke-width="1"/>
  <line x1="${M.left}" y1="${baseY}" x2="${W - M.right}" y2="${baseY}" stroke="#2B2D31" stroke-width="1"/>

  <!-- Wypełnienia gradient (pod klip) -->
  <g clip-path="url(#chartClip)">
    ${areaFills}
  </g>

  <!-- Linie krzywych + łączniki -->
  <g clip-path="url(#chartClip)">
    ${curveLines}
    ${connectorsSvg}
  </g>

  <!-- Markery przejść klanów -->
  ${multiClan ? transitionMarkers : ''}

  <!-- Wyróżnienie ostatniego punktu -->
  ${lastHighlight}

  <!-- Kropki i etykiety -->
  ${dotsSvg}

  <!-- Etykiety osi X -->
  ${xLabels}

  <!-- Separator legendy + legenda -->
  ${legendSep}
  ${legendItems}
</svg>`;

    return sharp(Buffer.from(svg)).png().toBuffer();
}

module.exports = { generateScoreHistoryChart };
