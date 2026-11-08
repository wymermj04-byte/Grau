# Sandusky Bay waiver — review draft

Status: **wording confirmed; not yet deployed, active, or signable.**

This document preserves the confirmed exact wording from the supplied one-page waiver. It must still be deployed as an approved waiver version before staff can collect a signature in the app.

## Exact draft transcription

**Waiver of Liability and Photo Release for Sandusky Bay Jiu-Jitsu @ Phil’s Dojo LLC.**

I hereby understand and acknowledge that the training and events held by Sandusky Bay Jiu-Jitsu @ Phil’s Dojo LLC may expose me to many inherent risks, including accidents, injury, illness, or even death. I assume all risk of injuries associated with participation including but not limited to falls, contact with other participants, effects of weather and environment (including high heat, humidity and snow/ice covered parking lots, steps, etc., ), and all other such risks being known and appreciated by me.

After having read this waiver and knowing these facts, and in consideration of acceptance of my participation in these events, I agree, for myself and anyone entitled to act on my behalf, to HOLD HARMLESS WAIVE AND RELEASE Sandusky Bay Jiu-Jitsu @ Phil’s Dojo LLC, its officers, employees, organizers, representatives’ and successors from any responsibility, liabilities, demands, or claims of any kind arising out of my participation in Sandusky Bay Jiu-Jitsu @ Phil’s Dojo LLC’s events.

I accept full responsibility for my health and well-being in these voluntary classes/ physical training activities. I understand that should I feel lightheaded, faint, dizzy, nauseated, or experience pain or discomfort, it is my responsibility to immediately stop the activity and inform Owner/Professor Philip Montgomery at Sandusky Bay Jiu-Jitsu @ Phil’s Dojo LLC, or associated staff.

I do hereby give Sandusky Bay Jiu-Jitsu @ Phil’s Dojo LLC, its assigns, licensees, and legal representatives, the irrevocable right to use my name, video, picture, portrait, likeness, or photograph in all forms and media in all manners, including composites, for advertising, publication, or any other lawful purpose, and I waive any right to inspect or approve the finished product, including written copy, which may be created in connection therewith. By my signature, I indicate that I have read and understand this Waiver of Liability and Photo Release.

I am aware that this is a waiver and a release of liability, and I voluntarily agree to its terms. It is my expressed intent that this release and hold harmless agreement shall bind the members of my family and spouse, if I am alive, and my heirs, assigns and personal representatives, if I am deceased, and shall be deemed as a release, waive, discharge, and convention to sue the above named releasees.

Form labels:

- Participant’s Name (print):
- Participant or Parent Signature:
- Date:
- Emergency Contact:
- Phone #:

The photograph visibly says **“convention to sue.”** It is preserved without correction.

## Proposed private-record contract

This is a schema and storage design, not executable SQL. It must be checked against the live Supabase schema before a migration is prepared.

### Version record

`waiver_versions` would store the immutable, gym-scoped source text and source-document fingerprint:

- `id`, `gym_id`, `title`, `exact_text`, `content_sha256`, and `source_document_path`
- `approval_status` (`draft`, `approved`, or `retired`), with `approved_at` and `approved_by`
- `created_at` and `created_by`

The supplied version remains `draft`. Only one explicitly approved version may be offered for a gym at a time. A version’s text and hash must be immutable after creation; corrections create a new version.

### Submission record

`member_waiver_submissions` would be append-only and gym-scoped:

- `id`, `gym_id`, `student_id`, and `waiver_version_id`
- `participant_name`, `signer_name`, and `signer_role` (`participant` or `parent_guardian`)
- `emergency_contact_name` and `emergency_contact_phone`
- `signature_object_path` and `signed_waiver_object_path`
- server-assigned `signed_at`, plus `recorded_by = auth.uid()` for the assisting staff member
- `created_at` and a request idempotency key

The signer and assisting staff member are deliberately separate. Historical `students.waiver_signed` values are never backfilled into this table.

### Private storage layout

After approval, create a non-public bucket dedicated to waiver evidence. Object paths should be deterministic only after the server allocates a submission ID:

```text
gym/{gym_id}/members/{student_id}/waivers/{submission_id}/signature.png
gym/{gym_id}/members/{student_id}/waivers/{submission_id}/signed-waiver.pdf
```

Storage policies must require an active `gym_staff` membership for the same `gym_id`; anonymous access and public URLs must be denied. The signed PDF and signature image are required private files, not display assets.

## Finalization rule

The eventual server-side, transactional finalization function must:

1. Require an authenticated active staff member and confirm the member belongs to that staff member’s active gym.
2. Require an explicitly approved active waiver version for that gym.
3. Validate complete required fields and both expected private object paths before any status change.
4. Override client-provided staff identity with `auth.uid()` and server-record the signing timestamp.
5. Insert the immutable submission, then update `students.waiver_signed` only after that insert succeeds, in the same transaction.

If validation, storage verification, or the insert fails, no digital submission is created and `waiver_signed` is unchanged.

## Staff-assisted interface states

Until Phil approves the wording, the member profile must show the existing legacy status only; it must not expose a signature pad, uploaded-file control, or a submit action.

After approval and deployment, the staff flow will be available from the member profile:

```text
Member profile
  Waiver
    Pending                       -> Sign current waiver
    Previously marked signed      -> Sign current waiver
    Signed                        -> View signed record

Staff-assisted signing
  1. Read current approved waiver
  2. Confirm participant full name
  3. Enter signer full name and role
  4. Capture signature
  5. Enter emergency contact name and phone
  6. Review and save
```

Status is derived without inventing history:

- A completed digital submission for the member: **Signed**.
- Existing `waiver_signed = true` with no digital submission: **Previously marked signed**.
- Existing `waiver_signed = false` with no digital submission: **Pending**.

“Sign current waiver” always creates a new digital submission for the active version and never rewrites or deletes the legacy indicator or previous submissions.

## Required review before implementation

- Phil approves the exact draft text, including “convention to sue.”
- The live `students`, `gym_staff`, and gym primary-key/foreign-key definitions are inventoried before executable SQL is produced.
- The connected Supabase project exposes a private storage bucket and authenticated migration path.
- The approved access policy names the staff roles that may create, retrieve, and audit signed records.
