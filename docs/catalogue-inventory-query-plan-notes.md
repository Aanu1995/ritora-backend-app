# Catalogue And Inventory Query Plan Notes

Date: 2026-04-18

## Scope

This note records the local query-plan follow-up for the Shelf backend:

- catalogue search
- catalogue product URL lookup
- inventory list pagination
- inventory search pagination
- inventory stats

The checks were run against the local Postgres database after migrations. Where the real dataset was too small to exercise a path meaningfully, a rollback-only temporary data set was used so no permanent data was added.

## Local Database State

- `catalogue_products`: 40 rows
- `inventory_products`: 0 rows
- `inventory` users with products: 0

Because inventory was empty, real-data `EXPLAIN ANALYZE` for inventory was not representative. A rollback-only sample of 5,000 inventory rows was inserted for one existing user, analyzed, measured, and then rolled back.

## Real Dataset Findings

### Catalogue search

Query shape:

- brand/name contains match
- exact/prefix relevance ordering
- `LIMIT 31`

Observed plan:

- `Seq Scan` + `Sort`
- planning time: about `0.603 ms`
- execution time: about `0.107 ms`

Interpretation:

- with only 40 catalogue rows, a sequential scan is expected and correct
- the trigram indexes are present for future growth, but the planner does not need them at this size

### Catalogue product URL lookup

Query shape:

- exact normalized match on `manufacturer->>'productUrl'`

Observed plan on the real 40-row catalogue:

- `Seq Scan`
- planning time: about `0.064 ms`
- execution time: about `1.093 ms`

Interpretation:

- the table is still tiny, so this is acceptable
- this was rechecked with rollback-only scale data, where the dedicated expression index was used correctly

## Rollback-Only Inventory Findings

Temporary sample:

- 5,000 inventory rows
- realistic status mix
- realistic date mix
- realistic search terms
- `ANALYZE inventory_products` run before plan capture

### Inventory list, recently added

Observed plan:

- `Index Scan`
- index: `IDX_inventory_products_user_created_id`
- planning time: about `0.395 ms`
- execution time: about `0.024 ms`

Result:

- the recent-list pagination path is using the intended index

### Inventory search, alphabetical

Observed plan:

- `Index Scan`
- index: `IDX_inventory_products_user_name_id`
- planning time: about `0.107 ms`
- execution time: about `0.034 ms`

Result:

- the paginated inventory search path stays fast with the current search document and ordering strategy

### Inventory stats

Observed plan:

- `Seq Scan` + `Aggregate`
- planning time: about `0.046 ms`
- execution time: about `3.734 ms`

Interpretation:

- this is one aggregate over a user-scoped slice, which is much better than the old multi-query approach
- for a few thousand rows per user, this is acceptable
- if some users eventually hold very large shelves, this is the first place to consider cached counters or materialized stats

## Rollback-Only Catalogue Scale Check

Temporary sample:

- 10,000 additional catalogue rows
- `ANALYZE catalogue_products` run before plan capture
- transaction rolled back after inspection

### Catalogue search

Observed plan:

- `Seq Scan` + `Sort`
- planning time: about `0.383 ms`
- execution time: about `5.361 ms`

Interpretation:

- the broad query tested here matched a large portion of the table, so the planner still preferred a sequential scan
- that is not automatically a problem
- if catalogue size grows significantly and broad search latency becomes an issue, the next step is a dedicated ranked search document rather than trying to force index usage for every broad query

### Catalogue product URL lookup

Observed plan:

- `Index Scan`
- index: `IDX_catalogue_products_product_url_lookup`
- planning time: about `0.077 ms`
- execution time: about `0.013 ms`

Result:

- the product URL lookup index is behaving correctly once table size is large enough for the planner to prefer it

## Practical Conclusions

- inventory pagination is in good shape
- inventory search is not fetching the full database and is using DB-side filtering
- inventory stats are now one aggregate query, which is a solid improvement
- catalogue search is fine for the current size, but it is the most likely future hotspot when the catalogue grows substantially
- exact product URL lookup is well covered by the new expression index

## Recommended Load Testing Strategy

### Phase 1: API-Level Load Test

Use a realistic mix of authenticated requests:

- `50%` inventory list
- `20%` inventory search
- `15%` inventory detail
- `10%` inventory stats
- `5%` catalogue search / resolve URL

Data sizes to seed:

- per-user inventory: `100`, `1,000`, `5,000`, `10,000`
- catalogue: `10,000`, `50,000`, `100,000`

Success targets:

- inventory list p95 under `100 ms`
- inventory search p95 under `150 ms`
- inventory stats p95 under `150 ms`
- catalogue search p95 under `200 ms`

### Phase 2: Query-Plan Regression Check

Before each release that changes indexing or filtering:

- run `EXPLAIN ANALYZE` for:
  - inventory recently added
  - inventory search
  - inventory stats
  - catalogue search
  - catalogue resolve URL
- verify the plan shape did not regress unexpectedly

### Phase 3: Abuse And Burst Testing

Focus on:

- repeated catalogue search requests
- repeated bulk archive / bulk delete payloads near the 100-id cap
- concurrent inventory list + search from the same user

Verify:

- throttling stays effective
- memory does not climb over time under sustained pagination/search traffic
- no request path falls back to loading the full table into application memory

## Next Upgrade Trigger

If catalogue search becomes a real hotspot, the next improvement should be:

1. add a dedicated catalogue `search_document`
2. move search ranking onto `pg_trgm` or PostgreSQL full-text search
3. keep cursor pagination, but search against the ranked document instead of repeated expression-based brand/name logic

That is the clean next step if the current broad-query sequential scan becomes too expensive at larger catalogue sizes.
