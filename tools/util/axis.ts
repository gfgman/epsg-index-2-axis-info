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

interface AxisInfo {
  name: string;
  abbrev: string;
  orientation: string;
  coordinate_system_order: number;
  unit_name: string;
  conv_factor: number;
}

export function getAxisInfo(db: DatabaseSync, epsgCode: number): AxisInfo[] {
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

  const rows = db.prepare(query).all(String(epsgCode), String(epsgCode));

  return isAxisInfoArray(rows) ? rows : [];
}

export function toProj4Axis(axes: AxisInfo[]) {
  const orientationMap: Record<string, string> = {
    east: 'e',
    west: 'w',
    north: 'n',
    south: 's',
    up: 'u',
    down: 'd',
  };

  const sorted = [...axes].sort((a, b) => a.coordinate_system_order - b.coordinate_system_order);

  // proj4js always expects a 3-char string, pad with 'u' (up) if 2D
  const chars = sorted.map((a) => {
    const key = a.orientation.toLowerCase();
    const char = orientationMap[key];
    if (!char) throw new Error(`Unknown axis orientation: "${a.orientation}"`);
    return char;
  });

  while (chars.length < 3) chars.push('u');

  return chars.join('');
}
