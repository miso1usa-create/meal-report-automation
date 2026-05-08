import { google } from 'googleapis';
import { z } from 'zod';
import { getEnv } from './config.js';
import { getTargetDateInTz, getYmdInTz } from './time.js';
import type { MealItem, MealRow, MealType } from './types.js';

const Header = z.object({
  timestamp: z.string().min(1),
  meal_type: z.string().min(1),
  items: z.string().optional(),
  calories: z.string().optional(),
  memo: z.string().optional(),
  photo_url: z.string().optional(),
  protein_g: z.string().optional(),
  fat_g: z.string().optional(),
  carbs_g: z.string().optional(),
  fiber_g: z.string().optional(),
  salt_g: z.string().optional(),
  water_l: z.string().optional(),
  tags: z.string().optional()
});

function normalizeMealType(raw: string): MealType {
  const v = raw.trim().toLowerCase();
  if (['morning', 'breakfast', '朝', '朝食', 'あさ'].includes(v)) return 'morning';
  if (['noon', 'lunch', '昼', '昼食', 'ひる'].includes(v)) return 'noon';
  if (['evening', 'dinner', '夕', '夕食', 'よる'].includes(v)) return 'evening';
  return 'snack';
}

function parseNumber(raw?: string): number | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed.replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

function parseItems(raw?: string): MealItem[] {
  if (!raw) return [];
  const s = raw.trim();
  if (!s) return [];

  // Accept JSON array or a simple newline / comma separated list.
  if (s.startsWith('[')) {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) {
        return parsed
          .map((x) => {
            if (typeof x === 'string') return { name: x } satisfies MealItem;
            if (x && typeof x === 'object') {
              const obj = x as Record<string, unknown>;
              const name = typeof obj.name === 'string' ? obj.name : '';
              if (!name) return null;
              const note = typeof obj.note === 'string' ? obj.note : undefined;
              const calories = typeof obj.calories === 'number' ? obj.calories : undefined;
              return { name, note, calories } satisfies MealItem;
            }
            return null;
          })
          .filter((x): x is MealItem => x !== null);
      }
    } catch {
      // fallthrough to plain text parse
    }
  }

  const parts = s
    .split(/\r?\n|,|、/g)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.map((name) => ({ name }));
}

function parseTags(raw?: string): string[] | undefined {
  if (!raw) return undefined;
  const s = raw.trim();
  if (!s) return undefined;
  return s
    .split(/,|、|\s+/g)
    .map((p) => p.trim())
    .filter(Boolean);
}

function parseTimestamp(raw: string): Date | null {
  const s = raw.trim();
  if (!s) return null;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d;

  // Fallback for common Japanese formats like "2026/05/08 07:30"
  const m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const da = Number(m[3]);
  const hh = m[4] ? Number(m[4]) : 0;
  const mm = m[5] ? Number(m[5]) : 0;
  // Treat as local time; report-day filter uses timeZone formatting later.
  return new Date(y, mo - 1, da, hh, mm, 0);
}

async function fetchAllMealsFromSheet(): Promise<{ env: ReturnType<typeof getEnv>; allMeals: MealRow[] }> {
  const env = getEnv(process.env);

  const sa = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON) as {
    client_email: string;
    private_key: string;
  };

  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
  });

  const sheets = google.sheets({ version: 'v4', auth });
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: env.SHEETS_ID,
    range: env.SHEETS_RANGE
  });

  const values = resp.data.values ?? [];
  if (values.length === 0) return { env, allMeals: [] };

  const headerRow = values[0].map((h) => String(h ?? '').trim().toLowerCase());
  const rows = values.slice(1);

  const headerIndex: Record<string, number> = {};
  for (let i = 0; i < headerRow.length; i++) headerIndex[headerRow[i]] = i;

  const required = ['timestamp', 'meal_type'] as const;
  for (const r of required) {
    if (headerIndex[r] === undefined) {
      throw new Error(
        `Sheet header must include "${r}". Current headers: ${headerRow.filter(Boolean).join(', ')}`
      );
    }
  }

  const meals: MealRow[] = [];
  for (const row of rows) {
    const get = (key: string) => {
      const idx = headerIndex[key];
      if (idx === undefined) return undefined;
      const v = row[idx];
      return v === undefined || v === null ? undefined : String(v);
    };

    const timestampRaw = get('timestamp');
    const mealTypeRaw = get('meal_type');
    if (!timestampRaw || !mealTypeRaw) continue;

    const timestamp = parseTimestamp(timestampRaw);
    if (!timestamp) continue;

    const mealType = normalizeMealType(mealTypeRaw);
    const items = parseItems(get('items'));

    const m: MealRow = {
      timestamp,
      mealType,
      items,
      memo: get('memo')?.trim() || undefined,
      calories: parseNumber(get('calories')),
      photoUrl: get('photo_url')?.trim() || undefined,
      proteinG: parseNumber(get('protein_g')),
      fatG: parseNumber(get('fat_g')),
      carbsG: parseNumber(get('carbs_g')),
      fiberG: parseNumber(get('fiber_g')),
      saltG: parseNumber(get('salt_g')),
      waterL: parseNumber(get('water_l')),
      tags: parseTags(get('tags'))
    };

    meals.push(m);
  }

  meals.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  return { env, allMeals: meals };
}

export async function fetchMealsForTargetDate(): Promise<{ targetYmd: string; meals: MealRow[] }> {
  const { env, allMeals } = await fetchAllMealsFromSheet();
  const now = new Date();
  const targetDate = getTargetDateInTz(now, env.REPORT_TZ, env.REPORT_TARGET);
  const targetYmd = getYmdInTz(targetDate, env.REPORT_TZ);
  const meals = allMeals.filter((m) => getYmdInTz(m.timestamp, env.REPORT_TZ) === targetYmd);
  return { targetYmd, meals };
}

export async function fetchMealsForRecentDays(days: number): Promise<{ ymds: string[]; meals: MealRow[] }> {
  const { env, allMeals } = await fetchAllMealsFromSheet();
  const now = new Date();
  const targetDate = getTargetDateInTz(now, env.REPORT_TZ, env.REPORT_TARGET);
  const targetYmd = getYmdInTz(targetDate, env.REPORT_TZ);

  const ymds: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(targetDate.getTime() - i * 24 * 60 * 60 * 1000);
    ymds.push(getYmdInTz(d, env.REPORT_TZ));
  }

  const ymdSet = new Set(ymds);
  const meals = allMeals.filter((m) => ymdSet.has(getYmdInTz(m.timestamp, env.REPORT_TZ)));
  return { ymds, meals };
}

// For ad-hoc debugging locally / in Actions logs
if (process.argv[1]?.endsWith('fetchMealsFromSheets.js')) {
  fetchMealsForTargetDate()
    .then((r) => {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ targetYmd: r.targetYmd, count: r.meals.length }, null, 2));
    })
    .catch((e) => {
      // eslint-disable-next-line no-console
      console.error(e);
      process.exitCode = 1;
    });
}

