# Batch geocoding: toggleable cleanup + rolling re-geocode

Implementation plan for two new features in `src/lib/geocoding/batch-geocode.ts`:

1. **Toggleable Google address cleanup** — enable/disable the Google address-cleanup
   step. When it is disabled and Geocodio returns not-found for a *new* address,
   record it so it is retried later once cleanup is re-enabled.
2. **Rolling full-database re-geocode** — when there is no new imported work to do,
   re-geocode the existing database on a slow rolling cycle (~1 year) to pick up
   Geocodio accuracy improvements and clean up older/low-quality coordinates.

**Requirement — never downgrade a SUCCESS:** re-geocoding must never turn a `SUCCESS`
into a `NOT_FOUND`. If a row previously had coordinates but Geocodio now can't find it,
keep the coordinates we had. Handled by the `PRESERVE` branch in §7 (keyed off
`originalStatus == SUCCESS`, so it protects any previously-successful row).

---

## 0. Decisions locked in

- `geocode_status` becomes: `PENDING=0, SUCCESS=1, NOT_FOUND_RAW_ADDRESS=2, NOT_FOUND=3`.
- New `no_geocode` boolean absorbs PO boxes **and** opt-outs **and** manual (`'mn'`)
  rows. The `geocode_provider != 'mn'` check disappears everywhere.
- `geocode_provider = 'gc'` written on every Geocodio success going forward
  (informational only; used for the odd manual query).
- Two toggles, both via the existing `isEnvEnabled` pattern: address cleanup on/off,
  rolling re-geocode on/off.
- Over-quota is handled by the existing non-200 bail (Geocodio free plan returns 403
  when the daily quota is exhausted; the batch simply fails for a few hours and
  resumes next day at no cost). No rate management needed.

---

## 1. The priority concern — resolved without a 5th status

Concern: new-data raw failures and re-geocode raw failures both landing in
`NOT_FOUND_RAW_ADDRESS`, with no way to prioritise new data.

Resolution: make **`NOT_FOUND_RAW_ADDRESS` mean "new-data forward-geocode failure,
cleanup not yet tried" by construction** — the re-geocode path never writes it.
Why that holds:

- `NOT_FOUND_RAW_ADDRESS` is only ever written when **cleanup is off AND the row was
  `PENDING`** (fresh import). When cleanup is on, a failed new row goes
  Geocodio → Google → Geocodio → `NOT_FOUND` (fully exhausted). So the only way to
  produce `NOT_FOUND_RAW_ADDRESS` is a new import failing during a cleanup-off window.
- The re-geocode query (query 2) only ever selects `SUCCESS` and `NOT_FOUND` rows. A
  failed re-geocode preserves `SUCCESS` (existing protection) or stays `NOT_FOUND` —
  it never creates `NOT_FOUND_RAW_ADDRESS`.
- Historical `NOT_FOUND` rows still get a cleanup retry — automatically — whenever the
  rolling re-geocode reaches them during a cleanup-on period (the Google step runs on
  *any* failure in the batch, whatever query fed it).

So `NOT_FOUND_RAW_ADDRESS` is exclusively new data, and query 1 processes it ahead of
the re-geocode by definition (query 2 only fills leftover batch capacity). New data
gets strict priority, with no fifth status.

**Linchpin:** the migration must map old `NOT_FOUND` to the *new* `NOT_FOUND (3)`, not
`NOT_FOUND_RAW_ADDRESS (2)`, so the entire historical failure backlog rolls through the
low-priority re-geocode instead of flooding high-priority query 1. See §3 step 2.

(If re-geocode raw-failures ever need separate tracking, add `NOT_FOUND_RECHECK` then —
but start without it.)

---

## 2. Schema change (`src/db/schema.ts`)

Add to `hamAddress`:

```ts
noGeocode: tinyint("no_geocode").default(0).notNull(),
```

Add two composite indexes (both queries filter `no_geocode = 0` first):

```ts
index("ham_address__forward").on(table.noGeocode, table.geocodeStatus, table.addressAdministrativeArea, table.id),
index("ham_address__regeocode").on(table.noGeocode, table.geocodeStatus, table.geocodeTime, table.id),
```

---

## 3. One-time migration SQL (run once, order matters)

```sql
-- add column (or via drizzle push)
ALTER TABLE ham_address ADD COLUMN no_geocode TINYINT NOT NULL DEFAULT 0;

-- 1a. PO boxes (current status 3) -> no_geocode. Do this BEFORE step 2.
UPDATE ham_address SET no_geocode = 1 WHERE geocode_status = 3;

-- 1b. Manual geocodes -> no_geocode (keeps their SUCCESS status + location).
UPDATE ham_address SET no_geocode = 1 WHERE geocode_provider = 'mn';

-- 2. Old NOT_FOUND (2) -> new NOT_FOUND (3), so they roll through re-geocode, NOT query 1.
UPDATE ham_address SET geocode_status = 3 WHERE geocode_status = 2 AND no_geocode = 0;
```

PO-box rows end up with `geocode_status = 3` + `no_geocode = 1`; the status is
irrelevant since `no_geocode` gates them out of both queries and they have no location.
Manual rows keep `SUCCESS` + `location_id` so they stay on the map, and
`no_geocode = 1` protects them from the rolling re-geocode.

---

## 4. Constants (`src/lib/constants.ts`)

```ts
export const GEOCODE_STATUS_PENDING = 0;
export const GEOCODE_STATUS_SUCCESS = 1;
export const GEOCODE_STATUS_NOT_FOUND_RAW_ADDRESS = 2;
export const GEOCODE_STATUS_NOT_FOUND = 3;
// remove GEOCODE_STATUS_PO_BOX
```

---

## 5. Fetch rewrite (`getAddresses` in `batch-geocode.ts`)

Two queries merged into the one `Map`. Toggles: `GEOCODE_ADDRESS_CLEANUP_ENABLED`,
`GEOCODE_REGEOCODE_ENABLED`.

**Query 1 — forward (new data):**

- WHERE `no_geocode = 0 AND geocode_status IN (statuses)`
  - cleanup **off**: statuses = `{PENDING}`
  - cleanup **on**: statuses = `{PENDING, NOT_FOUND_RAW_ADDRESS}`
- ORDER BY `geocode_status ASC, address__administrative_area, id` — `geocode_status ASC`
  puts `PENDING (0)` strictly ahead of `NOT_FOUND_RAW_ADDRESS (2)` (new imports before
  the deferred backlog); state is the secondary sort to keep state-by-state progress
  within each tier.
- LIMIT `GEOCODE_BATCH_SIZE`.

**Query 2 — re-geocode (only if re-geocode enabled AND query 1 returned < batch):**

- WHERE `no_geocode = 0 AND geocode_status IN (SUCCESS, NOT_FOUND)`
- ORDER BY `geocode_time, id` — pure rolling cycle, oldest first. (No
  `geocode_status DESC`; it would starve `SUCCESS` re-geocoding behind `NOT_FOUND`.)
- LIMIT `GEOCODE_BATCH_SIZE - query1Count`.

Disjoint status sets mean the two results never overlap. Each row's `originalStatus` is
set from its real `geocode_status` (already read today) — the not-found write rules
depend on it.

---

## 6. `doBatch` — cleanup toggle

Wrap the Google block (currently `batch-geocode.ts:72-111`) in
`if (isEnvEnabled("GEOCODE_ADDRESS_CLEANUP_ENABLED")) { ... }`. When off, failures skip
Google entirely and flow straight to the write rules below. Pass the cleanup flag into
`updateDatabase`.

---

## 7. `updateDatabase` — not-found write rules + rolling-cycle fix

For each address in the batch, in order:

```
if success:                         -> SUCCESS  (location_id, provider='gc', geocode_time)
elif originalStatus == SUCCESS:     -> PRESERVE (keep location_id + status; bump geocode_time only)
elif cleanupOff and originalStatus == PENDING:
                                    -> NOT_FOUND_RAW_ADDRESS (geocode_time)
else:                               -> NOT_FOUND (geocode_time)
```

**Two changes from today:**

1. The preserve-`SUCCESS` branch (currently `batch-geocode.ts:137`) `continue`s and
   skips the `geocode_time` bump — so a re-geocoded success that fails keeps its old
   timestamp and gets re-selected forever. Replace the `continue` with a
   **`geocode_time`-only update** (leave `location_id`, `geocode_status`,
   `geocode_provider` untouched).
2. Split the failure write between `NOT_FOUND_RAW_ADDRESS` and `NOT_FOUND` per the rules
   above (today it is always `NOT_FOUND`). The `originalStatus == PENDING` guard on the
   raw-address branch keeps re-geocoded old-`NOT_FOUND` rows from being demoted back
   into query 1.

`updateOneAddress` gains `geocode_provider = 'gc'` on the SUCCESS path.

---

## 8. Import PO-box step (`src/lib/imports/sql-updates.ts`)

`setPoBox` → set `no_geocode = 1` instead of `geocode_status = PO_BOX`, and drop the
`geocode_provider != 'mn'` clause (manual rows already carry `no_geocode = 1`):

```sql
UPDATE ham_address SET no_geocode = 1
WHERE address__address_line1 LIKE 'PO Box%' AND no_geocode = 0
```

Remove the now-unused `GEOCODE_STATUS_PO_BOX` import.

---

## 9. `.env` / `.env.example`

```
GEOCODE_ADDRESS_CLEANUP_ENABLED=true
GEOCODE_REGEOCODE_ENABLED=false
```

Start with re-geocode **off** so the migration can be verified against unchanged
forward geocoding before enabling the year-long roll.

---

## 10. Also check (outside this repo)

`ham-next` and any export query must not rely on `geocode_status = 3` meaning PO box, or
on `geocode_provider = 'mn'`. Map/export display should already key off
`location_id`/`SUCCESS`, which is unaffected — but grep the web side before deploying,
since the meaning of `3` flips.

---

## 11. Rollout order

1. Schema column + indexes.
2. Run migration SQL (§3).
3. Ship code (constants, fetch, doBatch toggle, updateDatabase, setPoBox) with
   `GEOCODE_REGEOCODE_ENABLED=false`, cleanup on.
4. Watch one cron cycle — forward geocoding should behave exactly as before.
5. Flip `GEOCODE_REGEOCODE_ENABLED=true` and confirm quiet-hour batches now fill from
   oldest `geocode_time`.

---

## Confirmed design points

- **New-data ordering:** `PENDING` strictly ahead of the `NOT_FOUND_RAW_ADDRESS`
  backlog (`geocode_status ASC`). A large post-cleanup-off backlog may take days at
  125/hr while fresh weekly imports still jump the queue. **Confirmed.**
- **Old `NOT_FOUND` → new `NOT_FOUND (3)`** (§3 step 2), so history rolls through
  low-priority re-geocode rather than flooding query 1. **Confirmed** — this is the
  linchpin of the no-5th-status design.
