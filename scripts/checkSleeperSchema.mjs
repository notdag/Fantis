// Checks that every Sleeper GraphQL call lib/sleeperWrite.ts makes still
// exists in Sleeper's live private schema (introspection needs no login).
// The write calls originally came from a community reference whose names had
// gone stale (move_to_ir, create_free_agent, cancel_trade ... no longer exist),
// so run this before trusting a write path:
//   node scripts/checkSleeperSchema.mjs
// Exits non-zero if anything the app calls is missing.

const MUTATIONS = {
  update_matchup_leg: ["league_id", "roster_id", "leg", "round", "starters", "starters_games"],
  roster_update_reserve: ["league_id", "roster_id", "reserve"],
  league_create_transaction: ["type", "league_id", "k_adds", "v_adds", "k_drops", "v_drops"],
  submit_waiver_claim: ["league_id", "k_adds", "v_adds", "k_drops", "v_drops", "k_settings", "v_settings"],
  accept_trade: ["league_id", "transaction_id", "leg"],
  reject_trade: ["league_id", "transaction_id", "leg"],
  cancel_waiver_claim: ["league_id", "transaction_id", "leg"],
};
const QUERIES = {
  league_transactions_filtered: ["league_id", "type_filters", "status_filters", "roster_id_filters", "limit"],
};

async function fieldsOf(typeName) {
  const query = `{ __type(name: "${typeName}") { fields { name args { name } } } }`;
  const res = await fetch("https://sleeper.com/graphql", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  if (!json.data?.__type) throw new Error(`Introspection failed for ${typeName}: ${JSON.stringify(json).slice(0, 200)}`);
  return new Map(json.data.__type.fields.map((f) => [f.name, f.args.map((a) => a.name)]));
}

let bad = 0;
for (const [typeName, expected] of [
  ["RootMutationType", MUTATIONS],
  ["RootQueryType", QUERIES],
]) {
  const fields = await fieldsOf(typeName);
  for (const [name, args] of Object.entries(expected)) {
    const have = fields.get(name);
    if (!have) {
      bad++;
      console.log(`MISSING  ${name} (not in ${typeName})`);
      continue;
    }
    const missingArgs = args.filter((a) => !have.includes(a));
    if (missingArgs.length) {
      bad++;
      console.log(`ARGS     ${name}: schema has no argument(s) ${missingArgs.join(", ")}`);
    } else {
      console.log(`ok       ${name}`);
    }
  }
}
console.log(bad ? `\n${bad} problem(s) — fix lib/sleeperWrite.ts before trusting writes.` : "\nAll Sleeper calls match the live schema.");
process.exit(bad ? 1 : 0);
