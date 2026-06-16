/**
 * fetch-proj-db.ts
 *
 * Downloads the latest `proj.db` (the PROJ/EPSG definitions SQLite database)
 * by pulling it out of the latest pyproj wheel published on PyPI.
 *
 * Usage:
 *   npx tsx fetch-proj-db.ts [outputDir]
 *
 * Requires: adm-zip (npm install adm-zip @types/adm-zip)
 */

import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';

const PYPI_URL = 'https://pypi.org/pypi/pyproj/json';

// Path of proj.db inside the pyproj wheel
const PROJ_DB_PATH_IN_WHEEL = 'pyproj/proj_dir/share/proj/proj.db';

const DEFAULT_OUTPUT_DIR = './data';

interface PyPiUrlEntry {
  filename: string;
  url: string;
  packagetype: string;
}

interface PyPiResponse {
  info: { version: string };
  urls: PyPiUrlEntry[];
}

/**
 * Pick a wheel to download. proj.db is platform-independent, so any wheel
 * that bundles the PROJ data works -- we just want a small/reliable one.
 * Preference order: manylinux x86_64 -> macOS arm64 -> any wheel.
 */
function pickWheel(urls: PyPiUrlEntry[]): PyPiUrlEntry {
  const wheels = urls.filter((u) => u.packagetype === 'bdist_wheel');

  const preferred =
    wheels.find((u) => u.filename.includes('manylinux') && u.filename.includes('x86_64')) ??
    wheels.find((u) => u.filename.includes('macosx') && u.filename.includes('arm64')) ??
    wheels[0];

  if (!preferred) {
    throw new Error('No suitable pyproj wheel found on PyPI');
  }

  return preferred;
}

export async function fetchProjDb() {
  const outDir = process.argv[2] ?? DEFAULT_OUTPUT_DIR;
  fs.mkdirSync(outDir, { recursive: true });

  console.log('Fetching pyproj release metadata from PyPI...');
  const metaRes = await fetch(PYPI_URL);
  if (!metaRes.ok) {
    throw new Error(`PyPI request failed: ${metaRes.status} ${metaRes.statusText}`);
  }
  const meta = (await metaRes.json()) as PyPiResponse;

  console.log(`Latest pyproj version: ${meta.info.version}`);

  const wheel = pickWheel(meta.urls);
  console.log(`Selected wheel: ${wheel.filename}`);

  console.log('Downloading wheel...');
  const wheelRes = await fetch(wheel.url);
  if (!wheelRes.ok) {
    throw new Error(`Wheel download failed: ${wheelRes.status} ${wheelRes.statusText}`);
  }
  const wheelBuf = Buffer.from(await wheelRes.arrayBuffer());
  console.log(`Downloaded ${(wheelBuf.length / (1024 * 1024)).toFixed(1)} MB`);

  console.log(`Extracting ${PROJ_DB_PATH_IN_WHEEL}...`);
  const zip = new AdmZip(wheelBuf);
  const entry = zip.getEntry(PROJ_DB_PATH_IN_WHEEL);
  if (!entry) {
    throw new Error(`${PROJ_DB_PATH_IN_WHEEL} not found in wheel ${wheel.filename}`);
  }

  const projDbBuf = entry.getData();
  const outPath = path.join(outDir, 'proj.db');
  fs.writeFileSync(outPath, projDbBuf);

  console.log(
    `Wrote ${outPath} (${(projDbBuf.length / (1024 * 1024)).toFixed(1)} MB, ` + `from pyproj ${meta.info.version})`,
  );
}
