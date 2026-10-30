// generates the oidc flow diagrams: node resources/flow/generate.ts
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from './diagram.ts';
import { diagram as backend } from './backend/backend.ts';
import { diagram as frontend } from './frontend/frontend.ts';
import { diagram as machineToMachine } from './machine-to-machine/machine-to-machine.ts';

const FLOW_DIR = dirname(fileURLToPath(import.meta.url));

const FLOWS = {
  frontend,
  backend,
  'machine-to-machine': machineToMachine,
};

Object.entries(FLOWS).forEach(([name, diagram]) => {
  const target = join(FLOW_DIR, name, `${name}.svg`);
  const svg = render(diagram);
  const [, width, height] = /viewBox="0 0 (\d+) (\d+)"/.exec(svg) ?? [];

  writeFileSync(target, svg);

  console.log(`${target}: ${width}x${height}`);
});
