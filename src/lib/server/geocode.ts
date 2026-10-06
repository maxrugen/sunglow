/**
 * Open-Meteo's geocoder matches the whole query against place names, so
 * "Jackson Wyoming" finds nothing, while "Jackson, Wyoming" treats the part
 * after the comma as a region or country (state names, US state codes, country
 * names and ISO codes all work). These helpers turn what people type into
 * queries it understands.
 */

/** Common country names the geocoder doesn't know, mapped to ISO codes it does. */
const COUNTRY_ALIASES: Record<string, string> = {
  usa: 'US',
  'u.s.': 'US',
  'u.s.a.': 'US',
  america: 'US',
  'united states of america': 'US',
  uk: 'GB',
  'u.k.': 'GB',
  britain: 'GB',
  'great britain': 'GB',
  uae: 'AE',
  holland: 'NL',
};

/** How many trailing words a qualifier may have ("Wyoming", "New Mexico"). */
const MAX_QUALIFIER_WORDS = 2;

function qualifier(text: string): string {
  return COUNTRY_ALIASES[text.trim().toLowerCase()] ?? text.trim();
}

/** The query to try first: as typed, with a known country alias after the last comma replaced. */
export function primaryQuery(query: string): string {
  const comma = query.lastIndexOf(',');
  if (comma < 0) return query;
  return `${query.slice(0, comma).trim()}, ${qualifier(query.slice(comma + 1))}`;
}

/**
 * Queries to try when the first one finds nothing: the last one or two words
 * as a region or country ("Salt Lake City Utah" → "Salt Lake City, Utah").
 * Empty if the query already has a comma or is a single word.
 */
export function fallbackQueries(query: string): string[] {
  if (query.includes(',')) return [];
  const words = query.trim().split(/\s+/);
  const queries: string[] = [];
  for (let k = 1; k <= Math.min(MAX_QUALIFIER_WORDS, words.length - 1); k++) {
    queries.push(`${words.slice(0, -k).join(' ')}, ${qualifier(words.slice(-k).join(' '))}`);
  }
  return queries;
}
