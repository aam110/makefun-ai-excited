// main.ts — FIRST LIGHT, a make.fun ai-excited-01 entry.
//
// Renders one deterministic 1024x1024 PNG ("a tiny spark ignites a
// ringed-planet eclipse") and writes it to entry.png in
// MAKEFUN_OUTPUT_DIR, or /output when that variable is unset (the
// grader's container). Node 22, standard library only, no network, no
// assets: the picture is computed from a fixed seed, so every run
// produces byte-identical output — verified locally with two runs
// (identical sha256), each about 6 s, far inside the 60 s budget.
//
// Local run:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { render, WIDTH, HEIGHT } from './render.ts';
import { encodePng } from './png.ts';

const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outDir, { recursive: true });

const started = Date.now();
const pixels = render();
const png = encodePng(WIDTH, HEIGHT, pixels);
const outPath = join(outDir, 'entry.png');
writeFileSync(outPath, png);

const sha256 = createHash('sha256').update(png).digest('hex');
const elapsed = ((Date.now() - started) / 1000).toFixed(1);
console.error(`FIRST LIGHT: wrote ${outPath} (${WIDTH}x${HEIGHT}, ${png.length} bytes, sha256 ${sha256}) in ${elapsed}s`);
