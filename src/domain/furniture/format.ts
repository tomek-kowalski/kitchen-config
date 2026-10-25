const MILLIMETERS = new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 1, useGrouping: false });

/** Millimeters for display: at most one decimal, Polish decimal comma (e.g. `794,8`). */
export function formatMm(value: number): string {
  return MILLIMETERS.format(value);
}

const PLURAL_RULES = new Intl.PluralRules("pl-PL");

/** Picks the Polish plural form: `one` (1), `few` (2–4, 22–24, …) or `many` (5–21, 25–31, …). */
export function pluralPl(count: number, forms: { one: string; few: string; many: string }): string {
  const category = PLURAL_RULES.select(count);
  return category === "one" ? forms.one : category === "few" ? forms.few : forms.many;
}
