// layout engine for the oidc sequence diagrams, see generate.ts
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Segment = { t: string; mono?: boolean; bold?: boolean; color?: string; href?: string };
export type Line = string | ReadonlyArray<string | Segment>;
export type Color = 'blue' | 'purple' | 'green' | 'orange';
export type Participant = {
  id: string;
  color: Color;
  title: string;
  subtitle: Line;
  bullets: ReadonlyArray<Line>;
};
export type Item =
  | { kind: 'band'; title: string; subtitle: Line }
  | { kind: 'note'; lane: string; lines: ReadonlyArray<Line>; error?: boolean }
  | { kind: 'arrow'; from: string; to: string; lines: ReadonlyArray<Line>; response?: boolean };
export type Layout = { laneGap: number; participantWidth: number; noteWidth: number };
export type Diagram = {
  title: string;
  intro: string;
  label: string;
  participants: ReadonlyArray<Participant>;
  items: ReadonlyArray<Item>;
  specs: Line;
  layout?: Partial<Layout>;
};

type Font = 'sans-400' | 'sans-700' | 'mono-400';
type Metrics = Record<Font, Record<string, number>>;
type LaneStyle = { x: number; stroke: string; fill: string; text: string };
type Lanes = Record<string, LaneStyle>;
type Fragment = { height: number; elements: ReadonlyArray<string> };
type State = { y: number; step: number; elements: ReadonlyArray<string> };
type TextOptions = { size?: number; anchor?: 'start' | 'middle'; color?: string; halo?: boolean };

const MARGIN = 20;

const DEFAULT_LAYOUT: Layout = { laneGap: 300, participantWidth: 280, noteWidth: 270 };

// the fonts are embedded (subset of Noto Sans / Noto Sans Mono, OFL, see ../fonts/README.md), so the diagrams render the
// same everywhere and the text can be measured with the real glyph advances (../fonts/metrics.json, per character in em)
const FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fonts');
const FONTS: Record<Font, { family: string; weight: number }> = {
  'sans-400': { family: 'Noto Sans', weight: 400 },
  'sans-700': { family: 'Noto Sans', weight: 700 },
  'mono-400': { family: 'Noto Sans Mono', weight: 400 },
};
const METRICS: Metrics = JSON.parse(readFileSync(join(FONT_DIR, 'metrics.json'), 'utf8'));
const FONT_FACES = Object.entries(FONTS)
  .map(([name, { family, weight }]) => {
    const data = readFileSync(join(FONT_DIR, `${name}.woff2`)).toString('base64');

    return `@font-face{font-family:'${family}';font-weight:${weight};src:url(data:font/woff2;base64,${data}) format('woff2');}`;
  })
  .join('\n');

const SANS = "'Noto Sans', sans-serif";
const MONO = "'Noto Sans Mono', monospace";

const C = {
  bg: '#ffffff',
  text: '#1f2328',
  muted: '#59636e',
  line: '#d1d9e0',
  arrow: '#59636e',
  band: '#f6f8fa',
  red: '#cf222e',
  redBg: '#ffebe9',
};

const PALETTE: Record<Color, Omit<LaneStyle, 'x'>> = {
  blue: { stroke: '#0969da', fill: '#ddf4ff', text: '#0550ae' },
  purple: { stroke: '#8250df', fill: '#fbefff', text: '#6639ba' },
  green: { stroke: '#1a7f37', fill: '#dafbe1', text: '#116329' },
  orange: { stroke: '#bc4c00', fill: '#fff1e5', text: '#953800' },
};

const esc = (value: string): string => {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
};

// a line is a string or an array of segments, a segment is a string or { t, mono, bold, color }
const seg = (s: string | Segment): Segment => (typeof s === 'string' ? { t: s } : s);
export const m = (t: string): Segment => ({ t, mono: true });
export const b = (t: string): Segment => ({ t, bold: true });
export const r = (t: string): Segment => ({ t, color: C.red });
export const rm = (t: string): Segment => ({ t, mono: true, color: C.red });
export const muted = (t: string): Segment => ({ t, color: C.muted });
export const link = (t: string, href: string, style: Omit<Segment, 't' | 'href'> = {}): Segment => ({
  t,
  href,
  ...style,
});

const toSegments = (line: Line): ReadonlyArray<Segment> => (Array.isArray(line) ? line : [line]).map(seg);

// the whole line in muted color, unless a segment brings its own
const mutedLine = (line: Line): ReadonlyArray<Segment> => toSegments(line).map((s) => ({ color: C.muted, ...s }));

const fontOf = (s: Segment): Font => (s.mono ? 'mono-400' : s.bold ? 'sans-700' : 'sans-400');

// width of a text run in px: glyph advances without kerning (kerning only makes it narrower), plus a little slack
const measure = (line: Line, size: number): number => {
  return (
    toSegments(line).reduce((width, s) => {
      const widths = METRICS[fontOf(s)];

      return width + [...s.t].reduce((sum, ch) => sum + (widths[ch] ?? 0.6), 0);
    }, 0) *
    size *
    1.02
  );
};

const trimLast = (segments: ReadonlyArray<Segment>): ReadonlyArray<Segment> => {
  return segments.map((s, i) => (i === segments.length - 1 ? { ...s, t: s.t.trimEnd() } : s));
};

// a token which does not fit into a line on its own (a long identifier, ...) gets broken by character
const chunk = (token: Segment, maxWidth: number, size: number): ReadonlyArray<Segment> => {
  return [...token.t].reduce<ReadonlyArray<Segment>>((chunks, ch) => {
    const current = chunks.at(-1);

    return current && measure([{ ...current, t: `${current.t}${ch}` }], size) <= maxWidth
      ? [...chunks.slice(0, -1), { ...current, t: `${current.t}${ch}` }]
      : [...chunks, { ...token, t: ch }];
  }, []);
};

// greedy word wrap (after spaces and slashes) keeping the segment styles, returns the lines as segment arrays
const wrap = (line: Line, maxWidth: number, size: number): ReadonlyArray<ReadonlyArray<Segment>> => {
  const tokens = toSegments(line)
    .flatMap((s) => s.t.split(/(?<=[ /])/).map((t) => ({ ...s, t })))
    .flatMap((token) => (measure([token], size) <= maxWidth ? [token] : chunk(token, maxWidth, size)));

  return tokens
    .reduce<ReadonlyArray<ReadonlyArray<Segment>>>(
      (lines, token) => {
        const current = lines.at(-1) ?? [];
        const fits = measure(trimLast([...current, token]), size) <= maxWidth;

        return fits || current.length === 0 ? [...lines.slice(0, -1), [...current, token]] : [...lines, [token]];
      },
      [[]],
    )
    .map(trimLast);
};

const indent = (lines: ReadonlyArray<ReadonlyArray<Segment>>, by: string): ReadonlyArray<ReadonlyArray<Segment>> => {
  return lines.map((tokens, i) => (i === 0 ? tokens : [{ t: by }, ...tokens]));
};

const text = (line: Line, x: number, y: number, options: TextOptions = {}): string => {
  const { size = 12, anchor = 'start', color = C.text, halo = false } = options;
  const haloAttributes = halo ? ` paint-order="stroke" stroke="${C.bg}" stroke-width="5" stroke-linejoin="round"` : '';
  const spans = toSegments(line)
    .map((s) => {
      const attributes = [
        `font-family="${s.mono ? MONO : SANS}"`,
        ...(s.bold ? ['font-weight="bold"'] : []),
        ...(s.color ? [`fill="${s.color}"`] : []),
      ];

      const tspan = `<tspan ${attributes.join(' ')}${s.href ? ' text-decoration="underline"' : ''}>${esc(s.t)}</tspan>`;

      // links work when the svg is opened directly, not within an <img> (e.g. the readme on github)
      return s.href ? `<a href="${esc(s.href)}" target="_blank">${tspan}</a>` : tspan;
    })
    .join('');

  return `<text x="${x}" y="${y}" font-family="${SANS}" font-size="${size}" fill="${color}" text-anchor="${anchor}"${haloAttributes}>${spans}</text>`;
};

const lane = (lanes: Lanes, id: string): LaneStyle => {
  const style = lanes[id];

  if (!style) {
    throw new Error(`Unknown lane "${id}", known lanes are ${Object.keys(lanes).join(', ')}`);
  }

  return style;
};

export const render = (diagram: Diagram): string => {
  const { laneGap, participantWidth, noteWidth } = { ...DEFAULT_LAYOUT, ...diagram.layout };
  const W = 2 * MARGIN + (diagram.participants.length - 1) * laneGap + participantWidth;

  const lanes: Lanes = Object.fromEntries(
    diagram.participants.map(({ id, color }, i) => [
      id,
      { x: MARGIN + participantWidth / 2 + i * laneGap, ...PALETTE[color] },
    ]),
  );

  // a paragraph of muted text wrapped to the page width
  const paragraph = (line: Line, y: number, size: number): Fragment => {
    const lines = wrap(line, W - 80, size);

    return {
      height: lines.length * (size + 4),
      elements: lines.map((tokens, i) => text(mutedLine(tokens), 40, y + i * (size + 4), { size })),
    };
  };

  // the box is at least as high as its content, all boxes of a row share the height of the tallest one
  const participant = (y: number, { id, title, subtitle, bullets }: Participant, minHeight = 0): Fragment => {
    const { x, stroke, fill, text: color } = lane(lanes, id);
    const subtitles = wrap(subtitle, participantWidth - 20, 11.5);
    const bulletsY = y + 42 + subtitles.length * 15 + 9;
    const lines = bullets.flatMap((line) =>
      wrap(line, participantWidth - 28 - 12, 12).map((tokens, i) => [{ t: i === 0 ? '• ' : '   ' }, ...tokens]),
    );
    const height = Math.max(minHeight, bulletsY - y + lines.length * 17 + 5);

    return {
      height,
      elements: [
        `<rect x="${x - participantWidth / 2}" y="${y}" width="${participantWidth}" height="${height}" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`,
        text([b(title)], x, y + 24, { size: 16, anchor: 'middle', color }),
        ...subtitles.map((line, i) => text(line, x, y + 42 + i * 15, { size: 11.5, anchor: 'middle', color: C.muted })),
        ...lines.map((line, i) => text(line, x - participantWidth / 2 + 14, bulletsY + i * 17)),
      ],
    };
  };

  const band = (state: State, title: string, subtitle: Line): State => {
    const y = state.y + 12;
    const lines = wrap([b(title), muted('   '), ...mutedLine(subtitle)], W - 112, 13.5);
    const height = 14 + lines.length * 18;

    return {
      ...state,
      y: y + height + 18,
      elements: [
        ...state.elements,
        `<rect x="40" y="${y}" width="${W - 80}" height="${height}" rx="6" fill="${C.band}" stroke="${C.line}"/>`,
        ...lines.map((line, i) => text(line, 56, y + 23 + i * 18, { size: 13.5 })),
      ],
    };
  };

  const note = (state: State, id: string, lines: ReadonlyArray<Line>, error: boolean): State => {
    const { x, stroke, fill } = lane(lanes, id);
    const wrapped = lines.flatMap((line) => indent(wrap(line, noteWidth - 24 - 10, 12), '  '));
    const height = wrapped.length * 16 + 16;
    const y = state.y + 6;

    return {
      ...state,
      y: y + height + 10,
      elements: [
        ...state.elements,
        `<rect x="${x - noteWidth / 2}" y="${y}" width="${noteWidth}" height="${height}" rx="5" fill="${error ? C.redBg : fill}" stroke="${error ? C.red : stroke}" stroke-width="1"/>`,
        ...wrapped.map((line, i) => text(line, x - noteWidth / 2 + 12, y + 20 + i * 16)),
      ],
    };
  };

  const arrow = (state: State, from: string, to: string, lines: ReadonlyArray<Line>, response: boolean): State => {
    const x1 = lane(lanes, from).x;
    const x2 = lane(lanes, to).x;
    const mid = (x1 + x2) / 2;
    // labels may reach a little beyond the two lanes, the halo keeps them readable across a lifeline
    const wrapped = lines.flatMap((line) => wrap(line, Math.abs(x2 - x1) + 100, 12));
    const y = state.y + wrapped.length * 15 + 14;
    const direction = x2 > x1 ? 1 : -1;
    const step = state.step + 1;

    return {
      y: y + 16,
      step,
      elements: [
        ...state.elements,
        ...wrapped.map((line, i) => {
          return text(line, mid, y - 16 - (wrapped.length - 1 - i) * 15, { anchor: 'middle', halo: true });
        }),
        `<line x1="${x1 + direction * 12}" y1="${y}" x2="${x2 - direction * 8}" y2="${y}" stroke="${C.arrow}" stroke-width="1.5"${response ? ' stroke-dasharray="6 4"' : ''} marker-end="url(#arrow)"/>`,
        `<circle cx="${x1}" cy="${y}" r="11" fill="${C.bg}" stroke="${C.arrow}" stroke-width="1.5"/>`,
        text([b(String(step))], x1, y + 4, { size: 11, anchor: 'middle', color: C.arrow }),
      ],
    };
  };

  const item = (state: State, current: Item): State => {
    switch (current.kind) {
      case 'band':
        return band(state, current.title, current.subtitle);
      case 'note':
        return note(state, current.lane, current.lines, current.error ?? false);
      case 'arrow':
        return arrow(state, current.from, current.to, current.lines, current.response ?? false);
    }
  };

  const TITLE_Y = 44;
  const intro = paragraph(diagram.intro, TITLE_Y + 24, 13);
  const participantsY = TITLE_Y + 24 + intro.height + 16;
  const participantsHeight = Math.max(
    ...diagram.participants.map((current) => participant(participantsY, current).height),
  );
  const participants = diagram.participants.map((current) => participant(participantsY, current, participantsHeight));
  const lifelineStart = participantsY + participantsHeight + 24;
  const sequence = diagram.items.reduce(item, { y: lifelineStart, step: 0, elements: [] });
  const legendY = sequence.y + 12 + 24;
  const specs = paragraph(diagram.specs, legendY + 22, 11.5);
  const H = legendY + 22 + specs.height + 8;

  const lifelines = Object.values(lanes).map(({ x, stroke }) => {
    return `<line x1="${x}" y1="${lifelineStart}" x2="${x}" y2="${legendY - 24}" stroke="${stroke}" stroke-width="1.5" stroke-dasharray="4 6" opacity="0.6"/>`;
  });

  const legend: ReadonlyArray<string> = [
    `<line x1="40" y1="${sequence.y + 12}" x2="${W - 40}" y2="${sequence.y + 12}" stroke="${C.line}"/>`,
    `<line x1="40" y1="${legendY - 4}" x2="80" y2="${legendY - 4}" stroke="${C.arrow}" stroke-width="1.5" marker-end="url(#arrow)"/>`,
    text('request', 88, legendY),
    `<line x1="150" y1="${legendY - 4}" x2="190" y2="${legendY - 4}" stroke="${C.arrow}" stroke-width="1.5" stroke-dasharray="6 4" marker-end="url(#arrow)"/>`,
    text('response', 198, legendY),
    `<rect x="270" y="${legendY - 13}" width="18" height="12" rx="2" fill="${C.redBg}" stroke="${C.red}"/>`,
    text('rejected request / error', 296, legendY),
    text([m('mono'), ' spec parameter, claim, header or code of this library'], 460, legendY),
    ...specs.elements,
  ];

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(diagram.label)}">
<title>${esc(diagram.title)}</title>
<defs>
<style>
${FONT_FACES}
</style>
<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${C.arrow}"/></marker>
</defs>
<rect width="${W}" height="${H}" fill="${C.bg}"/>
${[
  ...lifelines,
  text([b(diagram.title)], 40, TITLE_Y, { size: 22 }),
  ...intro.elements,
  ...participants.flatMap(({ elements }) => elements),
  ...sequence.elements,
  ...legend,
].join('\n')}
</svg>
`;
};
