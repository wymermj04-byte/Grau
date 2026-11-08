# Class update contract

The application updates an existing scheduled class through the authenticated
Supabase client in `lib/database.ts`; it does not use the generated REST
endpoint's narrow request schema.

`database.updateClass(classId, body)` always applies both filters:

- `id = classId`
- `gym_id =` the signed-in staff member's single active gym

The Edit Class screen sends only these class fields:

- `class_name`
- `class_date` as `YYYY-MM-DDT00:00:00+00:00`
- `start_time` and `end_time` as `HH:MM`
- `coach_name`
- `status` (`Scheduled` or `Cancelled`)
- `class_type`
- `class_audience` (`kids`, `adults`, or `mixed`)
- `stripe_progress_classification` (`qualifying`, `open_mat`, or `non_qualifying`)

It never changes `id`, `gym_id`, `is_active`, attendance, students,
promotions, or historical boundaries. Active admins and coaches may edit
Scheduled classes. Only active admins may correct Completed classes, and their
status remains Completed. In Progress and Cancelled classes cannot be edited.
Changing date, start time, or stripe-progress classification first checks for
saved attendance and requires explicit confirmation. The stronger warning notes
possible timestamp-based promotion-boundary effects. Saved attendance keeps its
own classification snapshot and is never rewritten by a class edit.

Completed-class attendance corrections use the same authenticated, gym-scoped
attendance helpers without reopening the class. Active admins and coaches can
add a missed check-in using the class's current stripe-progress classification,
or explicitly confirm removal of only one student/class/gym attendance record.
Existing timestamps and classification snapshots are never rewritten, and the
roster is never deleted and recreated. The existing attendance RLS policies
remain the server-side authority for both inserts and removals; the app neither
adds nor bypasses database permissions.

The class session reloads its saved, gym-scoped attendance whenever the route
regains focus. A failed refresh pauses further edits but retains any previously
confirmed check-ins in the visible roster instead of replacing them with an
empty selection.
