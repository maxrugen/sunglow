// Builds src/lib/data/airlines.json from Wikidata (CC0): one entry per IATA
// airline code, for the airline picker in route search.
//
//   node scripts/build-airlines.mjs
//
// Several Wikidata items can share a code (sub-brands like "United Express",
// or a defunct airline whose code was reused). Dissolved ones are dropped and
// the best-known of the rest (most Wikipedia language editions) names the code.
// The file is ordered best-known first; search results keep that order.
// AirLabs is queried by code, so the name only affects what people see.
import { writeFileSync } from 'node:fs';

const QUERY = `
SELECT ?item ?itemLabel ?iata ?icao ?links WHERE {
  ?item wdt:P229 ?iata ;
        wikibase:sitelinks ?links .
  OPTIONAL { ?item wdt:P230 ?icao }
  FILTER NOT EXISTS { ?item wdt:P576 ?dissolved . FILTER(?dissolved <= NOW()) }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;

const res = await fetch(`https://query.wikidata.org/sparql?query=${encodeURIComponent(QUERY)}`, {
  headers: {
    Accept: 'application/sparql-results+json',
    'User-Agent': 'sunglow-airline-table/1.0 (https://github.com/maxrugen/sunglow)',
  },
});
if (!res.ok) throw new Error(`Wikidata query failed: ${res.status}`);
const rows = (await res.json()).results.bindings;

const best = new Map();
for (const row of rows) {
  const iata = row.iata.value.trim().toUpperCase();
  const name = row.itemLabel.value.trim();
  // Skip malformed codes and items without an English label (the label falls back to the Q-id).
  if (!/^[A-Z0-9]{2}$/.test(iata) || !/[A-Z]/.test(iata) || /^Q\d+$/.test(name)) continue;
  const icao = row.icao?.value.trim().toUpperCase();
  const links = Number(row.links.value);
  const current = best.get(iata);
  if (!current || links > current.links) {
    best.set(iata, { iata, ...(icao && /^[A-Z]{3}$/.test(icao) ? { icao } : {}), name, links });
  }
}

// Best-known first, so a name search ("United") lists the major airline before namesakes.
const airlines = [...best.values()]
  .sort((a, b) => b.links - a.links || a.iata.localeCompare(b.iata))
  .map(({ links: _links, ...airline }) => airline);

writeFileSync(new URL('../src/lib/data/airlines.json', import.meta.url), JSON.stringify(airlines) + '\n');
console.log(`Wrote ${airlines.length} airlines.`);
