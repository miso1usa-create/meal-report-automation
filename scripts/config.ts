import { z } from 'zod';

const EnvSchema = z.object({
  SHEETS_ID: z.string().min(1),
  SHEETS_RANGE: z.string().min(1).default('meals!A:Z'),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().min(1),

  REPORT_TZ: z.string().min(1).default('Asia/Tokyo'),
  REPORT_TARGET: z.enum(['yesterday', 'today']).default('yesterday'),

  CALORIE_GOAL: z.coerce.number().positive().default(2000),
  PROTEIN_GOAL_G: z.coerce.number().positive().default(90),
  FAT_GOAL_G: z.coerce.number().positive().default(60),
  CARBS_GOAL_G: z.coerce.number().positive().default(270),
  FIBER_GOAL_G: z.coerce.number().positive().default(21),
  SALT_GOAL_G: z.coerce.number().positive().default(7.5),
  WATER_GOAL_L: z.coerce.number().positive().default(2.25)
});

export type Env = z.infer<typeof EnvSchema>;

export function getEnv(raw: NodeJS.ProcessEnv): Env {
  return EnvSchema.parse(raw);
}

