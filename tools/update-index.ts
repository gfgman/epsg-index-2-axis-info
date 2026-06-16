/// <reference path="../index.d.ts" />
import { Value } from '@sinclair/typebox/value';
import { join } from 'node:path';
import { env } from 'node:process';
import { writeFile } from 'node:fs/promises';
import { TNull, TSchema, TUnion, Type } from '@sinclair/typebox';
import { getAxisInfo, toProj4Axis } from './util/axis.js';
import { DatabaseSync } from 'node:sqlite';
import { fetchProjDb } from './util/proj-db';

const MAPTILER_KEY = env['MAPTILER_KEY'];

if (!MAPTILER_KEY)
  throw new Error(
    'MAPTILER_KEY environment variable is not set. Please add a key from https://cloud.maptiler.com/account/keys/',
  );

const LIMIT = 50;
const AUTHORITY = 'EPSG';
const OUT_FILE = join(import.meta.dirname, '..', 'all.json');

// Optional factory function for union type
function Optional<T extends TSchema>(schema: T): TUnion<[T, TNull]> {
  return Type.Union([schema, Type.Null()]) as TUnion<[T, TNull]>;
}

// Id schema
const IdSchema = Type.Object({
  authority: Type.String(),
  code: Type.Integer(),
});

// ExportItem schema
const ExportItemSchema = Type.Object({
  proj4: Optional(Type.String()),
  wkt: Optional(Type.String()),
});

// GridFile schema
const GridFileSchema = Type.Object({
  path: Type.String(),
});

// TransformationItem schema
const TransformationItemSchema = Type.Object({
  accuracy: Optional(Type.Number()),
  area: Optional(Type.String()),
  bbox: Optional(Type.Tuple([Type.Number(), Type.Number(), Type.Number(), Type.Number()])),
  deprecated: Type.Boolean(),
  exports: Optional(ExportItemSchema),
  grids: Type.Array(GridFileSchema),
  id: IdSchema,
  name: Type.String(),
  reversible: Type.Boolean(),
  target_crs: Optional(IdSchema),
  unit: Optional(Type.String()),
  usable: Type.Boolean(),
});

// DefaultTransformation schema (same as Id)
const DefaultTransformationSchema = IdSchema;

// SearchItem schema
const SearchItemSchema = Type.Object({
  accuracy: Optional(Type.Number()),
  area: Optional(Type.String()),
  bbox: Optional(Type.Tuple([Type.Number(), Type.Number(), Type.Number(), Type.Number()])),
  default_transformation: Optional(DefaultTransformationSchema),
  deprecated: Type.Boolean(),
  exports: Optional(ExportItemSchema),
  id: IdSchema,
  kind: Type.String(),
  name: Type.String(),
  transformations: Optional(Type.Array(Type.Union([TransformationItemSchema, Type.Integer()]))),
  unit: Optional(Type.String()),
});

const SearchResultSchema = Type.Object({
  results: Type.Array(SearchItemSchema),
  total: Type.Integer(),
});

/**
 * Fetches all EPSG codes from the MapTiler API, including their WKT and Proj4 definitions, and optionally appends axis information from a local PROJ database.
 * @param projDb Optional database connection to fetch axis info for each code. If not provided, the `proj4` field will be used as-is without appending axis information.
 * @returns Array of {@link EPSG} code definitions
 */
async function fetchAllCodes(projDb?: DatabaseSync) {
  const allCodes: EPSG[] = [];

  let offset = 0;
  while (true) {
    const response = await fetch(
      `https://api.maptiler.com/coordinates/search/EPSG deprecated:*.json?key=${MAPTILER_KEY}&limit=${LIMIT}&offset=${offset}&exports=1`,
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch data: ${response.status} ${response.statusText}`);
    }
    const data: unknown = await response.json();
    if (!Value.Check(SearchResultSchema, data)) {
      throw new Error(`Invalid data format: ${Array.from(Value.Errors(SearchResultSchema, data)).join(', ')}`);
    }

    for (const element of data.results) {
      if (element.id.authority !== AUTHORITY) {
        console.log(`Skipping ${element.id.authority}:${element.id.code}`);
        continue;
      }

      const { id, name, exports, bbox, unit, area, accuracy, deprecated } = element;

      let proj4WithAxis: string | null = null;
      try {
        const proj4Axis = projDb ? `+axis=${toProj4Axis(getAxisInfo(projDb, id.code))}` : '';
        proj4WithAxis = exports?.proj4 ? `${exports?.proj4} ${proj4Axis}`.trim() : null;
      } catch (err) {
        console.warn(`Failed to get axis info for EPSG:${id.code}:`, err);
      } finally {
        proj4WithAxis = proj4WithAxis ?? exports?.proj4 ?? null;
      }

      allCodes.push({
        code: id.code,
        name,
        wkt: exports?.wkt ?? null,
        proj4: proj4WithAxis,
        bbox: bbox,
        unit: unit,
        area: area,
        accuracy: accuracy,
        deprecated: deprecated,
      });
    }

    console.log(`Loaded ${offset + data.results.length} out of ${data.total}`);

    offset += LIMIT;
    if (offset >= data.total) break;
  }

  return allCodes;
}

try {
  await fetchProjDb();
} catch (err) {
  console.error('Failed to fetch proj.db:', err);
}
const db = new DatabaseSync('./data/proj.db', { readOnly: true });

try {
  const allCodes = await fetchAllCodes(db);
  await writeFile(
    OUT_FILE,
    JSON.stringify(
      allCodes.sort((a, b) => a.code - b.code),
      undefined,
      4,
    ),
  );
} catch (err) {
  throw err;
} finally {
  db.close();
}
