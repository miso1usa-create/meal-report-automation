export type MealType = 'morning' | 'noon' | 'evening' | 'snack';

export type MealItem = {
  name: string;
  note?: string;
  calories?: number;
};

export type MealRow = {
  timestamp: Date;
  mealType: MealType;
  items: MealItem[];
  memo?: string;
  calories?: number;
  photoUrl?: string;

  proteinG?: number;
  fatG?: number;
  carbsG?: number;
  fiberG?: number;
  saltG?: number;
  waterL?: number;

  tags?: string[];
};

