import { z } from 'zod';

function emptyToUndefined(v: unknown): unknown {
  if (typeof v === 'string' && v.trim() === '') return undefined;
  return v;
}

const EnvSchema = z.object({
  SHEETS_ID: z.preprocess(emptyToUndefined, z.string().min(1)),
  SHEETS_RANGE: z.preprocess(emptyToUndefined, z.string().min(1)).default('meals!A:Z'),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.preprocess(emptyToUndefined, z.string().min(1)),

  REPORT_TZ: z.preprocess(emptyToUndefined, z.string().min(1)).default('Asia/Tokyo'),
  REPORT_TARGET: z.enum(['yesterday', 'today']).default('yesterday'),

  CALORIE_GOAL: z.preprocess(emptyToUndefined, z.coerce.number().positive()).default(2000),
  PROTEIN_GOAL_G: z.preprocess(emptyToUndefined, z.coerce.number().positive()).default(90),
  FAT_GOAL_G: z.preprocess(emptyToUndefined, z.coerce.number().positive()).default(60),
  CARBS_GOAL_G: z.preprocess(emptyToUndefined, z.coerce.number().positive()).default(270),
  FIBER_GOAL_G: z.preprocess(emptyToUndefined, z.coerce.number().positive()).default(21),
  SALT_GOAL_G: z.preprocess(emptyToUndefined, z.coerce.number().positive()).default(7.5),
  WATER_GOAL_L: z.preprocess(emptyToUndefined, z.coerce.number().positive()).default(2.25)
});

export type Env = z.infer<typeof EnvSchema>;

export function getEnv(raw: NodeJS.ProcessEnv): Env {
  return EnvSchema.parse(raw);
}

