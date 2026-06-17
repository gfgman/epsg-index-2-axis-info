import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { getAxisInfo, toProj4Axis } from './axis';
import { fetchProjDb } from './proj-db';

let db: DatabaseSync;

beforeAll(async () => {
  try {
    await fetchProjDb();
  } catch (err) {
    console.error('Failed to fetch proj.db:', err);
  }
  db = new DatabaseSync('./data/proj.db', { readOnly: true });
});

afterAll(() => {
  db.close();
});

describe('proj4js axis info', () => {
  it('should work with a few examples', () => {
    expect(toProj4Axis(getAxisInfo(db, 4326))).toBe('neu');
    expect(toProj4Axis(getAxisInfo(db, 4978))).toBe(null); // geocentric, no +axis
    expect(toProj4Axis(getAxisInfo(db, 4258))).toBe('neu');
    expect(toProj4Axis(getAxisInfo(db, 32633))).toBe('enu');
    expect(toProj4Axis(getAxisInfo(db, 27700))).toBe('enu');
    expect(toProj4Axis(getAxisInfo(db, 3857))).toBe('enu');
    expect(toProj4Axis(getAxisInfo(db, 31469))).toBe('neu');
    expect(toProj4Axis(getAxisInfo(db, 31468))).toBe('neu');
    expect(toProj4Axis(getAxisInfo(db, 900913))).toBe('enu');
  });
});
