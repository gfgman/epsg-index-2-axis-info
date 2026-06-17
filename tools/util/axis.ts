import type { DatabaseSync } from 'node:sqlite';

function isAxisInfo(obj: unknown): obj is AxisInfo {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    'name' in obj &&
    typeof (obj as any).name === 'string' &&
    'abbrev' in obj &&
    typeof (obj as any).abbrev === 'string' &&
    'orientation' in obj &&
    typeof (obj as any).orientation === 'string' &&
    'coordinate_system_order' in obj &&
    typeof (obj as any).coordinate_system_order === 'number' &&
    'unit_name' in obj &&
    typeof (obj as any).unit_name === 'string' &&
    'conv_factor' in obj &&
    typeof (obj as any).conv_factor === 'number'
  );
}

function isAxisInfoArray(arr: unknown): arr is AxisInfo[] {
  return Array.isArray(arr) && arr.every(isAxisInfo);
}

/**
 * Get axis information for a given EPSG code from the proj.db SQLite database.
 * @param projDb - the SQLite database connection to proj.db
 * @param epsgCode - the EPSG code of the CRS to get axis info for
 * @returns an array of axis info objects, sorted by coordinate_system_order
 */
export function getAxisInfo(projDb: DatabaseSync, epsgCode: number): AxisInfo[] {
  const query = `
    SELECT
      a.name,
      a.abbrev,
      a.orientation,
      a.coordinate_system_order,
      u.name        AS unit_name,
      u.conv_factor
    FROM projected_crs p
    JOIN axis a
      ON  a.coordinate_system_auth_name = p.coordinate_system_auth_name
      AND a.coordinate_system_code      = p.coordinate_system_code
    LEFT JOIN unit_of_measure u
      ON  u.auth_name = a.uom_auth_name
      AND u.code      = a.uom_code
    WHERE p.auth_name = 'EPSG' AND p.code = ?

    UNION ALL

    SELECT
      a.name,
      a.abbrev,
      a.orientation,
      a.coordinate_system_order,
      u.name        AS unit_name,
      u.conv_factor
    FROM geodetic_crs g
    JOIN axis a
      ON  a.coordinate_system_auth_name = g.coordinate_system_auth_name
      AND a.coordinate_system_code      = g.coordinate_system_code
    LEFT JOIN unit_of_measure u
      ON  u.auth_name = a.uom_auth_name
      AND u.code      = a.uom_code
    WHERE g.auth_name = 'EPSG' AND g.code = ?

    ORDER BY coordinate_system_order
  `;

  const rows = projDb.prepare(query).all(String(epsgCode), String(epsgCode));

  return isAxisInfoArray(rows) ? rows : [];
}

interface AxisInfo {
  name: string;
  abbrev: string;
  orientation: string;
  coordinate_system_order: number;
  unit_name: string;
  conv_factor: number;
}

// Orientations that don't correspond to a proj4 +axis direction at all
// (geocentric, spherical, unspecified, etc.) — these CRS types shouldn't use +axis.
const NON_AXIS_ORIENTATIONS = new Set(['geocentricX', 'geocentricY', 'geocentricZ', 'unspecified']);
const AXIS_ORIENTATION_MAP = {
  east: 'e',
  west: 'w',
  north: 'n',
  south: 's',
  up: 'u',
  down: 'd',
} as const;
type Orientation = keyof typeof AXIS_ORIENTATION_MAP;
const ORIENTATION_KEY_SET = Object.keys(AXIS_ORIENTATION_MAP);

function getOrientation(axis: AxisInfo): Orientation | null {
  const orientation = axis.orientation.toLowerCase();
  if (orientation in AXIS_ORIENTATION_MAP) {
    return orientation as Orientation;
  } else if (orientation.startsWith('north')) {
    return 'north';
  } else if (orientation.startsWith('south')) {
    return 'south';
  } else if (orientation.startsWith('east')) {
    return 'east';
  } else if (orientation.startsWith('west')) {
    return 'west';
  } else if (orientation.startsWith('up')) {
    return 'up';
  } else if (orientation.startsWith('down')) {
    return 'down';
  }
  return null;
}

export function toProj4Axis(axes: AxisInfo[]) {
  const sorted = [...axes].sort((a, b) => a.coordinate_system_order - b.coordinate_system_order);

  // If any axis uses a non-compass orientation, +axis doesn't apply for this CRS
  if (sorted.some((a) => NON_AXIS_ORIENTATIONS.has(a.orientation))) {
    return null;
  }

  // proj4js always expects a 3-char string, pad with 'u' (up) if 2D
  const chars = sorted.map((a) => {
    const orientation = getOrientation(a);
    const char = orientation && AXIS_ORIENTATION_MAP[orientation];
    if (!char) throw new Error(`Unknown axis orientation: "${a.orientation}"`);
    return char;
  });

  while (chars.length < 3) chars.push('u');

  return chars.join('');
}
