# Promotion Alerts Phase 2 — official-promotion integration comparison

This is a review artifact, not a deployment instruction. Main's fresh
`pg_get_functiondef` result has been compared with the supplied live function.
It matches the approved base definition. The doubled quotes in the CSV export
are transport escaping only.

## Expected semantic delta

The approved patch must preserve every existing statement and make only these
changes to `public.record_student_promotion(bigint,text,integer,text)`:

| Location | Existing behavior | Patch behavior |
| --- | --- | --- |
| `declare` | Existing six variables | Adds `created_promotion_id bigint` and `created_promotion_effective_at timestamptz`. |
| `normalized_type` assignment | `lower(trim(coalesce(p_promotion_type, '')))` | Unchanged. |
| `INSERT public."Promotions"` | Inserts the exact existing columns and values | Adds only `RETURNING id INTO created_promotion_id`. |
| Immediately after that `INSERT` | No notification action | Reads the trigger-assigned `promotion_effective_at` for that exact promotion/student/gym and calls the private helper. |
| Student update | Existing belt/stripe update | Unchanged and remains after the helper call. |

No other authorization predicate, lock, rank/stripe rule, source table,
promotion field, attendance rule, or client-facing signature may change.

## Required live comparison result

The fresh Main definition must confirm all of the following before patch review
can proceed:

1. Same four parameters and `RETURNS void`.
2. `SECURITY DEFINER` and `search_path = public, auth, pg_temp` remain set.
3. Exactly-one active admin/coach membership remains required.
4. The selected student row remains locked with `FOR UPDATE`.
5. The promotion row insert still precedes the existing student update.
6. The insert trigger supplies a non-null `promotion_effective_at` for the
   newly inserted row.

## Additional-change review

No additional semantic changes were found. Specifically, the patch does not
change the signature, owner, `SECURITY DEFINER`, `search_path`, membership
query, student `FOR UPDATE` lock, rank/stripe validations, inserted promotion
columns or values, or student update. Formatting/case changes in the SQL file
are not behavioral changes.
