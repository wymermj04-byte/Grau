# Student photos: staged private-bucket deployment

Status: planning only. The draft policy migration in
`student-photos-private-access-migration.sql` remains intentionally
non-deployable because Main currently has a public bucket, six legacy object
keys, and no student-photo Storage policies.

Nothing in this plan authorizes an update to Main. It does not move, copy,
delete, rename, or overwrite the six existing objects, and it never updates
`public.students.photo_url`.

## Current facts

- `student-photos` is public.
- Six photo objects use legacy paths, not the future five-folder key contract.
- Six existing `students.photo_url` values must remain unchanged.
- There are no current student-photo Storage policies.
- Family access must require the same user, student, and gym on a link with
  `status = 'approved'`, non-null `approved_at`, and null `revoked_at`.
- The bucket remains JPEG-only. This plan does not add PNG or WebP support.

## Stage 0 — capture a review-only baseline

Before any future deployment, save a read-only inventory of:

1. The six `storage.objects` records: id, bucket id, object name, metadata,
   MIME type, size, and created/updated timestamps.
2. The six affected students: `studentId`, `gym_id`, and exact `photo_url`.
3. The bucket's `public`, `allowed_mime_types`, and size-limit configuration.
4. Every existing Storage policy, confirming none applies to `student-photos`.
5. The exact legacy object-name to student/gym mapping.

This inventory is the immutable review artifact. Do not mutate objects or
URLs to create it.

## Stage 1 — establish a safe legacy authorization bridge

The private-policy draft currently validates only the future key shape:

`gym/{gym_id}/students/{student_id}/photos/{filename}.jpg`

It must not be applied while the six legacy names exist. Prepare a follow-up
policy revision that authorizes each existing legacy object only through the
captured, deterministic student/gym mapping. It must use the same approved,
unrevoked family-link checks as the new-path helper.

The bridge must not infer an owner from a filename and must not grant a whole
legacy prefix. If the existing object key cannot be mapped uniquely to a
student and gym without changing `students.photo_url`, private conversion is
blocked until a narrowly scoped mapping record is designed and reviewed.

New uploads can use the five-folder contract only after the bridge is ready.
The six existing files remain in place and keep their original names.

## Stage 2 — release app support before privatizing Storage

The current app passes `students.photo_url` directly to the avatar image. A
private bucket cannot rely on public URLs, and signed URLs cannot be stored as
permanent values because they expire.

Before setting `student-photos` private, release a separately reviewed app
change that:

1. Resolves the object key from the unchanged stored photo URL.
2. Obtains a fresh, short-lived signed URL only after the caller passes the
   Storage select policy.
3. Keeps object keys and original `students.photo_url` values stable; it does
   not write a signed URL back to the database.
4. Handles loading and signing failures without exposing a broken image.

Signed URLs are bearer links. Storage checks access when a URL is issued, not
on every use of the resulting token. Revoking a family link prevents future
issuance but cannot invalidate a URL already issued; use the shortest expiry
that works for the app and avoid logging, caching durably, or sharing URLs.

## Separate app-only improvement: avatar fallback

After a photo fails to load, `MemberAvatar` should show the existing initials
fallback in the same avatar surface. This is independent of the Storage
migration and can be released first.

The scoped implementation is:

1. Track an image-error state inside `MemberAvatar`.
2. Reset that state when `photoUrl` changes.
3. Use Expo Image's error callback to set the state.
4. Render the existing initials text whenever no URL exists or image loading
   fails.

It must not upload files, sign URLs, change students, or alter any backend
authorization. It is deliberately not implemented by this planning task.

## Stage 3 — final policy and private-bucket change

Only after the signed-URL release and legacy bridge are validated with real
approved family and active staff accounts:

1. Apply the reviewed policy migration variant that supports both the six
   mapped legacy names and the future five-folder JPEG paths.
2. Confirm active staff can manage only their gym's photos, and approved
   family members can read only their linked students' photos.
3. Confirm revoked, pending, mismatched-gym, and anonymous callers cannot
   issue a signed URL.
4. Set the existing `student-photos` bucket to private in the same controlled
   deployment window.
5. Recheck the six objects and all six stored photo URLs for exact equality
   with the Stage 0 inventory.

Do not touch the `member-waivers` bucket or its policies in any student-photo
deployment.

## Stage 4 — future cleanup, only after a separate review

Keep legacy bridge access while any existing photo uses a legacy key. Removing
the bridge requires a later, explicitly authorized object migration and a
fresh plan for retaining the original `students.photo_url` values. It is not
part of the private-bucket rollout.

## Deployment blockers

- A unique legacy object-to-student/gym mapping is not yet captured.
- The app does not yet mint fresh signed URLs from unchanged stored photo URLs.
- The draft migration rejects the current public bucket and legacy paths by
  design; it must not be deployed as-is.
- The private schema must be excluded from Supabase PostgREST exposed schemas
  before the finalized helper functions are deployed.
