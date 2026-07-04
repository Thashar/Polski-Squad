const sharp = require('sharp');

/**
 * Generator grafik pozycji w globalnym rankingu (thumbnail Embedu 2 ogłoszenia rekordu).
 *
 * Tiery graficzne:
 *  - #1  — złoty medal z koroną, laurem i czerwoną wstęgą
 *  - #2  — srebrny medal z laurem i niebieską wstęgą
 *  - #3  — brązowy medal z laurem i zieloną wstęgą
 *  - #4–10   — niebieska (blurple) tarcza z gwiazdą
 *  - #11–30  — turkusowy heksagon
 *  - #31–100 — stalowy okrągły badge z pierścieniem
 *  - #101+   — grafitowy minimalistyczny okrąg
 *
 * Render: SVG → PNG 256×256 (przezroczyste tło) przez sharp — ta sama technika
 * co chartService (Arial/sans-serif, bez emoji — librsvg ich nie wspiera).
 */

const SIZE = 256;

/** Rozmiar fontu liczby zależny od liczby cyfr (Arial bold). */
function _numberFontSize(pos) {
    const digits = String(pos).length;
    return { 1: 96, 2: 86, 3: 68, 4: 54 }[digits] || 44;
}

/** Tekst liczby wycentrowany w (cx, cy) — bez dominant-baseline (słabe wsparcie librsvg). */
function _numberText(pos, cx, cy, fontSize, fill, strokeColor = null) {
    const y = cy + fontSize * 0.35;
    const stroke = strokeColor
        ? ` stroke="${strokeColor}" stroke-width="6" paint-order="stroke fill"`
        : '';
    return `<text x="${cx}" y="${y.toFixed(1)}" font-family="Arial,sans-serif" font-size="${fontSize}" font-weight="bold" text-anchor="middle" fill="${fill}"${stroke}>${pos}</text>`;
}

/** Pięcioramienna gwiazda. */
function _star(cx, cy, rOuter, rInner, fill, opacity = 1) {
    const pts = [];
    for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? rOuter : rInner;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
    }
    return `<polygon points="${pts.join(' ')}" fill="${fill}" opacity="${opacity}"/>`;
}

/** Wieniec laurowy wokół dolnej połowy medalu — liście jako obrócone elipsy wzdłuż łuku. */
function _laurelWreath(cx, cy, r, leafFill) {
    const parts = [];
    // Dwie gałązki: lewa (dół → lewa góra) i prawa (dół → prawa góra); kąty w układzie SVG (0°=prawo, 90°=dół)
    const branches = [
        { from: 100, to: 205 },
        { from: 80, to: -25 },
    ];
    for (const br of branches) {
        const count = 8;
        for (let i = 0; i < count; i++) {
            const t = i / (count - 1);
            const deg = br.from + (br.to - br.from) * t;
            const rad = (deg * Math.PI) / 180;
            const rr = r + (i % 2 === 0 ? 3 : -3);
            const x = cx + rr * Math.cos(rad);
            const y = cy + rr * Math.sin(rad);
            const rot = deg + 90 + (i % 2 === 0 ? 22 : -22);
            const scale = 0.7 + 0.3 * (1 - t); // liście mniejsze ku końcowi gałązki
            parts.push(
                `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${(13 * scale).toFixed(1)}" ry="${(5.2 * scale).toFixed(1)}" fill="${leafFill}" transform="rotate(${rot.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`
            );
        }
    }
    return parts.join('\n');
}

/** Medale podium (#1 złoto + korona, #2 srebro, #3 brąz) — unikatowa paleta i wstęga per miejsce. */
function _medalSvg(pos) {
    const P = {
        1: {
            metal: ['#FFF3B0', '#F7C325', '#B77E0B'], rim: '#8A5A00', text: '#7A4E00',
            leaf: '#C9961B', ribbonL: '#C0392B', ribbonR: '#E74C3C', crown: true,
        },
        2: {
            metal: ['#FFFFFF', '#C9D1D9', '#8E99A4'], rim: '#5C6670', text: '#454C55',
            leaf: '#8C97A2', ribbonL: '#2C5AA0', ribbonR: '#3E74C9', crown: false,
        },
        3: {
            metal: ['#F6C79A', '#D07C33', '#8F4F1B'], rim: '#6E3A0F', text: '#5E320D',
            leaf: '#B26A2B', ribbonL: '#1E7A46', ribbonR: '#2E9C5C', crown: false,
        },
    }[pos];

    const cx = 128, cy = 142, r = 78;

    const crown = P.crown
        ? `<path d="M100,70 L100,44 L114,56 L128,34 L142,56 L156,44 L156,70 Z" fill="#FFD84D" stroke="#A06B00" stroke-width="4" stroke-linejoin="round"/>
           <circle cx="100" cy="40" r="5" fill="#FFD84D" stroke="#A06B00" stroke-width="3"/>
           <circle cx="128" cy="29" r="5" fill="#FFD84D" stroke="#A06B00" stroke-width="3"/>
           <circle cx="156" cy="40" r="5" fill="#FFD84D" stroke="#A06B00" stroke-width="3"/>`
        : _star(cx, cy - r + 16, 11, 4.5, P.rim, 0.85);

    return `<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="metal" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${P.metal[0]}"/>
      <stop offset="0.5" stop-color="${P.metal[1]}"/>
      <stop offset="1" stop-color="${P.metal[2]}"/>
    </linearGradient>
  </defs>
  <polygon points="98,0 126,0 136,58 106,66" fill="${P.ribbonL}"/>
  <polygon points="130,0 158,0 150,66 120,58" fill="${P.ribbonR}"/>
  ${_laurelWreath(cx, cy, r + 7, P.leaf)}
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#metal)" stroke="${P.rim}" stroke-width="5"/>
  <circle cx="${cx}" cy="${cy}" r="${r - 15}" fill="#00000018" stroke="${P.rim}" stroke-width="2" stroke-opacity="0.55"/>
  <ellipse cx="${cx - 26}" cy="${cy - 34}" rx="30" ry="16" fill="#FFFFFF" opacity="0.28" transform="rotate(-32 ${cx - 26} ${cy - 34})"/>
  ${crown}
  ${_numberText(pos, cx, cy + 4, 88, P.text)}
</svg>`;
}

/** #4–10 — niebieska (blurple) tarcza z gwiazdą. */
function _shieldSvg(pos) {
    const cx = 128, cy = 138;
    return `<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#7289DA"/>
      <stop offset="1" stop-color="#4752C4"/>
    </linearGradient>
  </defs>
  <path d="M128,22 C154,38 180,44 200,47 L200,118 C200,172 170,210 128,234 C86,210 56,172 56,118 L56,47 C76,44 102,38 128,22 Z"
        fill="url(#bg)" stroke="#2C3680" stroke-width="7" stroke-linejoin="round"/>
  <path d="M128,38 C150,51 172,56 186,58 L186,116 C186,162 161,194 128,214 C95,194 70,162 70,116 L70,58 C84,56 106,51 128,38 Z"
        fill="none" stroke="#FFFFFF" stroke-width="2.5" stroke-opacity="0.22"/>
  ${_star(cx, 66, 14, 5.8, '#FFFFFF', 0.9)}
  ${_numberText(pos, cx, cy + 4, _numberFontSize(pos), '#FFFFFF', '#2C3680')}
</svg>`;
}

/** #11–30 — turkusowy heksagon. */
function _hexSvg(pos) {
    const cx = 128, cy = 130;
    const hexPts = (R) => {
        const pts = [];
        for (let i = 0; i < 6; i++) {
            const a = -Math.PI / 2 + (i * Math.PI) / 3;
            pts.push(`${(cx + R * Math.cos(a)).toFixed(1)},${(cy + R * Math.sin(a)).toFixed(1)}`);
        }
        return pts.join(' ');
    };
    return `<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2BD9B0"/>
      <stop offset="1" stop-color="#149C7E"/>
    </linearGradient>
  </defs>
  <polygon points="${hexPts(96)}" fill="url(#bg)" stroke="#0B6B57" stroke-width="7" stroke-linejoin="round"/>
  <polygon points="${hexPts(79)}" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-opacity="0.22"/>
  ${_numberText(pos, cx, cy, _numberFontSize(pos), '#FFFFFF', '#0B6B57')}
</svg>`;
}

/** #31–100 — stalowy okrągły badge z podwójnym pierścieniem. */
function _steelSvg(pos) {
    const cx = 128, cy = 130;
    return `<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#90A4AE"/>
      <stop offset="1" stop-color="#546E7A"/>
    </linearGradient>
  </defs>
  <circle cx="${cx}" cy="${cy}" r="94" fill="url(#bg)" stroke="#2F3E48" stroke-width="7"/>
  <circle cx="${cx}" cy="${cy}" r="78" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-opacity="0.25"/>
  ${_numberText(pos, cx, cy, _numberFontSize(pos), '#FFFFFF', '#2F3E48')}
</svg>`;
}

/** #101+ — grafitowy, minimalistyczny okrąg (paleta Discord dark). */
function _darkSvg(pos) {
    const cx = 128, cy = 130;
    return `<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
  <circle cx="${cx}" cy="${cy}" r="92" fill="#313338" stroke="#5C5F66" stroke-width="6"/>
  <circle cx="${cx}" cy="${cy}" r="76" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-opacity="0.12"/>
  ${_numberText(pos, cx, cy, _numberFontSize(pos), '#DBDEE1', '#1E1F22')}
</svg>`;
}

/**
 * Generuje PNG (Buffer) z grafiką pozycji globalnej.
 * @param {number} position - pozycja w rankingu globalnym (>= 1)
 * @returns {Promise<Buffer|null>} bufor PNG lub null gdy pozycja nieprawidłowa
 */
async function generatePositionIcon(position) {
    const pos = parseInt(position, 10);
    if (!Number.isFinite(pos) || pos < 1) return null;

    let svg;
    if (pos <= 3) svg = _medalSvg(pos);
    else if (pos <= 10) svg = _shieldSvg(pos);
    else if (pos <= 30) svg = _hexSvg(pos);
    else if (pos <= 100) svg = _steelSvg(pos);
    else svg = _darkSvg(pos);

    return sharp(Buffer.from(svg)).png().toBuffer();
}

module.exports = { generatePositionIcon };
