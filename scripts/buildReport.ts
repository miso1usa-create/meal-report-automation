import fs from 'node:fs/promises';
import path from 'node:path';
import Handlebars from 'handlebars';
import { getEnv } from './config.js';
import { fetchMealsForRecentDays, fetchMealsForTargetDate } from './fetchMealsFromSheets.js';
import { formatJstYmd } from './time.js';
import type { MealItem, MealRow, MealType } from './types.js';

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatNumber(n: number | undefined, digits = 0): string {
  if (n === undefined) return '0';
  return n.toLocaleString('ja-JP', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function sum(nums: Array<number | undefined>): number {
  return nums.reduce<number>((acc, v) => acc + (v ?? 0), 0);
}

function clampPct(p: number): number {
  if (!Number.isFinite(p)) return 0;
  return Math.max(0, Math.min(100, p));
}

function pct(value: number, goal: number): number {
  if (!goal) return 0;
  return clampPct((value / goal) * 100);
}

function mealTypeLabel(type: MealType): string {
  if (type === 'morning') return '朝食';
  if (type === 'noon') return '昼食';
  if (type === 'evening') return '夕食';
  return '間食';
}

function pickMeal(meals: MealRow[], type: MealType): MealRow | undefined {
  return meals.find((m) => m.mealType === type);
}

function mealCalories(meal: MealRow | undefined): number {
  if (!meal) return 0;
  if (meal.calories !== undefined) return meal.calories;
  return sum(meal.items.map((i) => i.calories));
}

function itemsToHtml(items: MealItem[]): string {
  if (items.length === 0) {
    return `<li class="text-sm" style="color: var(--ink-soft);">（記録なし）</li>`;
  }
  return items
    .map((it) => {
      const name = escapeHtml(it.name);
      const note = it.note ? ` <span style="color: var(--ink-soft);">(${escapeHtml(it.note)})</span>` : '';
      const kcal =
        it.calories !== undefined
          ? `<span class="font-latin text-xs" style="color: var(--ink-soft);">${formatNumber(it.calories)} kcal</span>`
          : `<span class="font-latin text-xs" style="color: var(--ink-soft);">—</span>`;
      return `
<li class="flex items-baseline gap-2">
  <span style="color: var(--gold);">◦</span>
  <span class="flex-1">${name}${note}</span>
  ${kcal}
</li>`.trim();
    })
    .join('\n');
}

function memoToHtml(memo?: string): string {
  if (!memo) return escapeHtml('—');
  return escapeHtml(memo).replace(/\r?\n/g, '<br>');
}

function photoHtml(photoUrl?: string): string {
  if (!photoUrl) {
    return `<div class="text-xs font-latin italic" style="color: rgba(255,255,255,0.85);">no photo</div>`;
  }
  const safe = escapeHtml(photoUrl);
  return `<img src="${safe}" alt="" class="w-full h-full object-cover" />`;
}

function formatHm(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
}

function formatJpDate(dateYmd: string): { jp: string; weekday: string } {
  const [y, m, d] = dateYmd.split('-').map((v) => Number(v));
  const date = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short'
  }).formatToParts(date);
  const year = parts.find((p) => p.type === 'year')?.value ?? String(y);
  const month = parts.find((p) => p.type === 'month')?.value ?? String(m);
  const day = parts.find((p) => p.type === 'day')?.value ?? String(d);
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  return { jp: `${year}年 ${month}月 ${day}日`, weekday };
}

function waterGauge(pctValue: number): string {
  const filled = Math.round(clampPct(pctValue) / 10);
  return `${'●'.repeat(filled)}${'○'.repeat(Math.max(0, 10 - filled))}`;
}

function stars(rating: number): string {
  const r = Math.max(0, Math.min(5, Math.round(rating)));
  return `${'★'.repeat(r)}${'☆'.repeat(5 - r)}`;
}

function calcReportNumber(dateYmd: string): string {
  // Stable, deterministic-ish number for aesthetics (not a true sequence).
  const numeric = Number(dateYmd.replace(/-/g, ''));
  const n = (numeric % 9000) + 1000;
  return String(n).padStart(4, '0');
}

function buildHighlights(highlights: string[]): string {
  const items = highlights.slice(0, 3);
  while (items.length < 3) items.push('—');
  return items
    .map((t, idx) => {
      const no = String(idx + 1).padStart(2, '0');
      return `
<li class="flex items-start gap-3">
  <span class="font-latin font-bold text-2xl leading-none" style="color: var(--gold);">${no}</span>
  <div class="flex-1 text-sm leading-relaxed">${escapeHtml(t)}</div>
</li>`.trim();
    })
    .join('\n');
}

function groupByYmd(meals: MealRow[], timeZone: string): Map<string, MealRow[]> {
  const m = new Map<string, MealRow[]>();
  for (const meal of meals) {
    const ymd = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(meal.timestamp);
    const arr = m.get(ymd) ?? [];
    arr.push(meal);
    m.set(ymd, arr);
  }
  for (const [k, arr] of m) arr.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  return m;
}

function buildWeeklyCellsHtml(ymds: string[], dailyTotals: Map<string, number>, targetYmd: string): string {
  // Determine day number from ymd and bar heights based on rough ratios.
  return ymds
    .map((ymd) => {
      const day = Number(ymd.split('-')[2]);
      const total = dailyTotals.get(ymd) ?? 0;
      const isTarget = ymd === targetYmd;

      // Split into fake breakfast/lunch/dinner bars by heuristics (we only need a visual).
      const b = total * 0.28;
      const l = total * 0.42;
      const d = total * 0.30;
      const max = Math.max(1, ...Array.from(dailyTotals.values()));
      const hb = Math.max(5, (b / max) * 100);
      const hl = Math.max(5, (l / max) * 100);
      const hd = Math.max(5, (d / max) * 100);

      const style = isTarget ? ` style="background: var(--paper-deep); border-color: var(--accent);"` : '';
      const dayStyle = isTarget
        ? `class="font-latin text-xs font-bold" style="color: var(--accent);"`
        : `class="font-latin text-xs" style="color: var(--ink-soft);"`;
      const totalStyle = isTarget
        ? `class="font-latin text-[0.6rem] text-center font-bold" style="color: var(--accent);"`
        : `class="font-latin text-[0.6rem] text-center" style="color: var(--ink-soft);"`;

      return `
<div class="calendar-cell rounded p-2 flex flex-col"${style}>
  <span ${dayStyle}>${day}</span>
  <div class="flex-1 flex items-end justify-center gap-0.5">
    <span class="w-1 bg-current rounded-t" style="height: ${hb}%; color: #b89668;"></span>
    <span class="w-1 bg-current rounded-t" style="height: ${hl}%; color: #b8543a;"></span>
    <span class="w-1 bg-current rounded-t" style="height: ${hd}%; color: #6b7a3e;"></span>
  </div>
  <span ${totalStyle}>${formatNumber(total)}</span>
</div>`.trim();
    })
    .join('\n');
}

export async function buildReport(): Promise<void> {
  const env = getEnv(process.env);
  const { targetYmd, meals } = await fetchMealsForTargetDate();
  const { ymds, meals: recentMeals } = await fetchMealsForRecentDays(7);

  const byType: Record<MealType, MealRow | undefined> = {
    morning: pickMeal(meals, 'morning'),
    noon: pickMeal(meals, 'noon'),
    evening: pickMeal(meals, 'evening'),
    snack: pickMeal(meals, 'snack')
  };

  const breakfastKcal = mealCalories(byType.morning);
  const lunchKcal = mealCalories(byType.noon);
  const dinnerKcal = mealCalories(byType.evening);
  const snackKcal = mealCalories(byType.snack);
  const totalKcal = breakfastKcal + lunchKcal + dinnerKcal + snackKcal;

  const protein = sum(meals.map((m) => m.proteinG));
  const fat = sum(meals.map((m) => m.fatG));
  const carbs = sum(meals.map((m) => m.carbsG));
  const fiber = sum(meals.map((m) => m.fiberG));
  const salt = sum(meals.map((m) => m.saltG));
  const water = sum(meals.map((m) => m.waterL));

  const calorieGoalPct = Math.round(pct(totalKcal, env.CALORIE_GOAL));
  const waterPct = Math.round(pct(water, env.WATER_GOAL_L));

  const mealsLogged = ['morning', 'noon', 'evening', 'snack'].filter((t) => byType[t as MealType]).length;
  const snackCount = byType.snack ? 1 : 0;
  const mealsLoggedLabel = `${mealsLogged - snackCount}食${snackCount ? ` + 間食${snackCount}` : ''}`;
  const mealsLoggedNote = mealsLogged >= 3 ? '朝・昼・夕 記録あり' : '記録の抜けあり';

  const tags = new Set<string>();
  for (const m of meals) for (const t of m.tags ?? []) tags.add(t);
  const tagsUsed = tags.size ? Array.from(tags).slice(0, 2).join(' ・ ') : '—';

  const { jp: reportDateJp, weekday: weekdayJp } = formatJpDate(targetYmd);
  const now = new Date();
  const generatedAtJst = new Intl.DateTimeFormat('ja-JP', {
    timeZone: env.REPORT_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(now);
  const generatedAtFullJst = `${targetYmd.replace(/-/g, '.')} ${generatedAtJst} JST`;
  const nextRunDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const nextRunJst = `${formatJstYmd(nextRunDate).replace(/-/g, '.')} 06:00 JST`;

  const pctBreakfast = totalKcal ? Math.round((breakfastKcal / totalKcal) * 100) : 0;
  const pctLunch = totalKcal ? Math.round((lunchKcal / totalKcal) * 100) : 0;
  const pctDinner = totalKcal ? Math.round((dinnerKcal / totalKcal) * 100) : 0;
  const pctSnack = Math.max(0, 100 - pctBreakfast - pctLunch - pctDinner);

  const dashBreakfast = (251 * pctBreakfast) / 100;
  const dashLunch = (251 * pctLunch) / 100;
  const dashDinner = (251 * pctDinner) / 100;
  const dashSnack = (251 * pctSnack) / 100;

  const dashBreakfastPlusLunch = dashBreakfast + dashLunch;
  const dashBreakfastPlusLunchPlusDinner = dashBreakfastPlusLunch + dashDinner;

  const recentByYmd = groupByYmd(recentMeals, env.REPORT_TZ);
  const dailyTotals = new Map<string, number>();
  for (const ymd of ymds) {
    const dayMeals = recentByYmd.get(ymd) ?? [];
    const tot = sum(dayMeals.map((m) => m.calories)) || sum(dayMeals.map((m) => sum(m.items.map((i) => i.calories))));
    dailyTotals.set(ymd, Math.round(tot));
  }
  const weeklyAvg = Math.round(sum(Array.from(dailyTotals.values())) / Math.max(1, ymds.length));
  let bestDay = ymds[0] ?? targetYmd;
  for (const ymd of ymds) {
    if ((dailyTotals.get(ymd) ?? 0) > (dailyTotals.get(bestDay) ?? 0)) bestDay = ymd;
  }
  const bestDayLabel = `${Number(bestDay.split('-')[1])}月${Number(bestDay.split('-')[2])}日`;
  const bestDayNote = 'バランス◎';
  const weekRangeLabel = `${Number(ymds[0].split('-')[1])} ${Number(ymds[0].split('-')[2])} — ${Number(ymds[6].split('-')[1])} ${Number(ymds[6].split('-')[2])}`;

  const weeklyCellsHtml = buildWeeklyCellsHtml(ymds, dailyTotals, targetYmd);

  const templatePath = path.join(process.cwd(), 'report', 'template.html');
  const templateText = await fs.readFile(templatePath, 'utf8');
  const template = Handlebars.compile(templateText, { noEscape: true });

  const reportYear = targetYmd.slice(0, 4);
  const reportNumber = calcReportNumber(targetYmd);

  const breakfastTime = byType.morning ? formatHm(byType.morning.timestamp, env.REPORT_TZ) : '—';
  const lunchTime = byType.noon ? formatHm(byType.noon.timestamp, env.REPORT_TZ) : '—';
  const dinnerTime = byType.evening ? formatHm(byType.evening.timestamp, env.REPORT_TZ) : '—';

  const highlights = [
    fiber >= env.FIBER_GOAL_G ? '食物繊維が目標を超えた。' : '食物繊維を少し増やしたい。',
    salt > env.SALT_GOAL_G ? '塩分がやや多め。汁物の調整を。' : '塩分は目標範囲内。',
    mealsLogged >= 3 ? '三食の記録がそろった。' : '記録の抜けを埋めたい。'
  ];

  const html = template({
    reportDateYmdDots: targetYmd.replace(/-/g, '.'),
    reportNumber,
    reportYear,
    reportDateJp,
    weekdayJp,
    weather: '—',
    temperature: '—',
    mood: '—',
    moodStars: stars(3),
    generatedAtJst,
    generatedAtFullJst,
    nextRunJst,

    totalCalories: formatNumber(Math.round(totalKcal)),
    calorieGoal: formatNumber(env.CALORIE_GOAL),
    calorieGoalPct,
    mealsLogged: mealsLogged - snackCount,
    mealsLoggedLabel,
    mealsLoggedNote,
    waterLiters: (water || 0).toFixed(1),
    waterGauge: waterGauge(waterPct),
    waterPct,
    streakDays: 1,
    streakNote: '記録継続中',

    breakfastTime,
    breakfastCalories: formatNumber(Math.round(breakfastKcal)),
    breakfastItemsHtml: itemsToHtml(byType.morning?.items ?? []),
    breakfastMemoHtml: memoToHtml(byType.morning?.memo),
    breakfastPhotoHtml: photoHtml(byType.morning?.photoUrl),
    breakfastPhotoTimeLabel: byType.morning ? `📷 ${breakfastTime}` : '',

    lunchTime,
    lunchCalories: formatNumber(Math.round(lunchKcal)),
    lunchItemsHtml: itemsToHtml(byType.noon?.items ?? []),
    lunchMemoHtml: memoToHtml(byType.noon?.memo),
    lunchPhotoHtml: photoHtml(byType.noon?.photoUrl),
    lunchPhotoTimeLabel: byType.noon ? `📷 ${lunchTime}` : '',

    dinnerTime,
    dinnerCalories: formatNumber(Math.round(dinnerKcal)),
    dinnerItemsHtml: itemsToHtml(byType.evening?.items ?? []),
    dinnerMemoHtml: memoToHtml(byType.evening?.memo),
    dinnerPhotoHtml: photoHtml(byType.evening?.photoUrl),
    dinnerPhotoTimeLabel: byType.evening ? `📷 ${dinnerTime}` : '',

    proteinG: formatNumber(Math.round(protein)),
    proteinGoalG: formatNumber(env.PROTEIN_GOAL_G),
    proteinPct: Math.round(pct(protein, env.PROTEIN_GOAL_G)),

    fatG: formatNumber(Math.round(fat)),
    fatGoalG: formatNumber(env.FAT_GOAL_G),
    fatPct: Math.round(pct(fat, env.FAT_GOAL_G)),

    carbsG: formatNumber(Math.round(carbs)),
    carbsGoalG: formatNumber(env.CARBS_GOAL_G),
    carbsPct: Math.round(pct(carbs, env.CARBS_GOAL_G)),

    fiberG: formatNumber(Math.round(fiber)),
    fiberGoalG: formatNumber(env.FIBER_GOAL_G),
    fiberPct: Math.round(pct(fiber, env.FIBER_GOAL_G)),
    fiberOkMark: fiber >= env.FIBER_GOAL_G ? '✓' : '',

    saltG: formatNumber(Number(salt.toFixed(1))),
    saltGoalG: formatNumber(env.SALT_GOAL_G, 1),
    saltPct: Math.round(pct(salt, env.SALT_GOAL_G)),
    saltWarnMark: salt > env.SALT_GOAL_G ? '!' : '',

    dashBreakfast: dashBreakfast.toFixed(1),
    dashLunch: dashLunch.toFixed(1),
    dashDinner: dashDinner.toFixed(1),
    dashSnack: dashSnack.toFixed(1),
    dashBreakfastPlusLunch: dashBreakfastPlusLunch.toFixed(1),
    dashBreakfastPlusLunchPlusDinner: dashBreakfastPlusLunchPlusDinner.toFixed(1),

    pctBreakfast,
    pctLunch,
    pctDinner,
    pctSnack,

    weekRangeLabel,
    weeklyCellsHtml,
    weeklyAvgCalories: formatNumber(weeklyAvg),
    bestDayLabel,
    bestDayNote,
    tagsUsed,

    todaysNoteHtml: memoToHtml(''),
    highlightsHtml: buildHighlights(highlights)
  });

  const outDir = path.join(process.cwd(), 'dist');
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, 'index.html'), html, 'utf8');
}

if (process.argv[1]?.endsWith('buildReport.js')) {
  buildReport().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exitCode = 1;
  });
}

