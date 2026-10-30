# Fonts

Subsets of the [Noto](https://notofonts.github.io/) fonts, embedded into the flow diagrams (`../flow/*/*.svg`) by `../flow/diagram.ts` so that they render with the same fonts on every system.

| File             | Font           | Weight | Source version |
| ---------------- | -------------- | ------ | -------------- |
| `sans-400.woff2` | Noto Sans      | 400    | 2.013          |
| `sans-700.woff2` | Noto Sans      | 700    | 2.013          |
| `mono-400.woff2` | Noto Sans Mono | 400    | 2.014          |

- **Origin:** [notofonts/latin-greek-cyrillic](https://github.com/notofonts/latin-greek-cyrillic), Copyright 2022 The Noto Project Authors. Taken from the variable fonts `NotoSans[wght].ttf` and `NotoSansMono[wght].ttf` (Fedora package `google-noto-fonts` 20240401).
- **License:** [SIL Open Font License, Version 1.1](https://openfontlicense.org) ([OFL.txt](https://github.com/notofonts/latin-greek-cyrillic/blob/main/OFL.txt) within the source repository). The license permits embedding the fonts into documents and distributing modified (subsetted) versions, as long as this license accompanies them. No Reserved Font Name is declared for these fonts.
- **Modifications:** Each file is a static instance of the variable font at the given weight, subsetted to the printable ASCII characters plus `→ · … ± § • – ×`, converted to WOFF2 with [subset-font](https://www.npmjs.com/package/subset-font) 2.7.0 (HarfBuzz). Text using other characters needs a new subset.
- **`metrics.json`:** Advance width per character (in em) of each subset, read by the generator to measure and wrap the text.
