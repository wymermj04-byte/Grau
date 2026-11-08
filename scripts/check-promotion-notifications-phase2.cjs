const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (name) =>
  fs.readFileSync(path.join(__dirname, "..", "docs", name), "utf8");

const plan = read("promotion-notifications-phase2-implementation-plan.md");
const inventory = read("promotion-notifications-phase2-live-contract-inventory.sql");
const migrationGate = read("promotion-notifications-phase2-migration.sql");
const rollbackGate = read("promotion-notifications-phase2-rollback.sql");
const edgeWorker = read("promotion-notifications-phase2-edge-worker.md");
const independentMigration = read("promotion-notifications-phase2-independent-migration.sql");
const promotionIntegration = read("promotion-notifications-phase2-record-promotion-integration.sql");
const promotionComparison = read("promotion-notifications-phase2-record-promotion-integration-comparison.md");
const deploymentVerification = read("promotion-notifications-phase2-deployment-verification.sql");
const deploymentChecklist = read("promotion-notifications-phase2-main-deployment-checklist.md");
const rolloutControl = read("promotion-notifications-gym4-rollout-control.sql");
const rolloutRunbook = read("promotion-notifications-gym4-rollout-runbook.md");
const controlledTesting = read("promotion-notifications-phase2-controlled-testing.md");
const operations = read("promotion-notifications-phase2-operations.md");
const mainReadiness = read("promotion-notifications-phase2-main-readiness.sql");
const edgeWorkerSource = fs.readFileSync(
  path.join(__dirname, "..", "supabase", "functions", "promotion-notification-worker", "index.ts"),
  "utf8",
);
const edgeFunctionConfig = fs.readFileSync(
  path.join(__dirname, "..", "supabase", "config.toml"),
  "utf8",
);
const notificationFeature = fs.readFileSync(
  path.join(__dirname, "..", "lib", "promotion-notifications-feature.ts"),
  "utf8",
);
const notificationClient = fs.readFileSync(
  path.join(__dirname, "..", "lib", "promotion-notifications.ts"),
  "utf8",
);
const notificationScreen = fs.readFileSync(
  path.join(__dirname, "..", "app", "promotion-notifications.tsx"),
  "utf8",
);

assert.match(plan, /promotion_effective_at > generation_floor_at/);
assert.match(plan, /ON CONFLICT DO NOTHING/);
assert.match(plan, /legacy direct-insert fallback/i);
assert.match(plan, /6 -> 5/);
assert.match(plan, /must never\s+be milestone sources/);
assert.match(plan, /approved, non-revoked/i);
assert.match(plan, /mark read/i);
assert.match(plan, /pg_cron.*availability is not assumed/i);
assert.match(inventory, /pg_get_functiondef/);
assert.match(inventory, /record_student_promotion\(bigint,text,integer,text\)/);
assert.match(inventory, /pg_extension/);
assert.match(migrationGate, /^begin;/m);
assert.match(migrationGate, /^rollback;/m);
assert.match(migrationGate, /STOP: Phase 2 requires/);
assert.doesNotMatch(migrationGate, /\bcommit;/i);
assert.match(rollbackGate, /^begin;/m);
assert.match(rollbackGate, /^rollback;/m);
assert.match(rollbackGate, /promotion_notification_outbox row\s+-- is unresolved/i);
assert.doesNotMatch(rollbackGate, /\bdrop\s+(table|function|schema)/i);
assert.match(edgeWorker, /withSupabase\(\{ auth: 'secret' \}/);
assert.match(edgeWorker, /process_gym4_promotion_notification_outbox/);
assert.match(edgeWorker, /outside the mobile app/i);
assert.match(edgeWorker, /external trusted scheduler/i);
assert.match(independentMigration, /enqueue_verified_promotion_celebration/);
assert.match(independentMigration, /promotion_effective_at <= rollout\.generation_floor_at/);
assert.match(independentMigration, /for share/);
assert.match(independentMigration, /process_gym4_promotion_notification_outbox/);
assert.match(independentMigration, /auth\.role\(\) is distinct from 'service_role'/);
assert.match(independentMigration, /get stacked diagnostics worker_error_code = returned_sqlstate/);
assert.match(independentMigration, /returning outbox\.attempt_count into attempt_after_claim/);
assert.match(independentMigration, /outbox lease was lost while recording a worker failure/i);
assert.match(independentMigration, /member_link\.status = 'approved'/);
assert.match(independentMigration, /current_link\.status = 'approved'/);
assert.match(independentMigration, /current_link\.revoked_at is null/);
assert.match(independentMigration, /current_link\.user_id = recipient\.family_user_id/);
assert.match(independentMigration, /current_link\.student_id = current_outbox\.student_id/);
assert.match(independentMigration, /where inbox\.id = current_inbox\.id\s+and inbox\.read_at is null/g);
assert.match(independentMigration, /set state = 'dead_letter',[\s\S]*?lease_token = null,[\s\S]*?lease_expires_at = null/);
assert.match(independentMigration, /with exhausted as \([\s\S]*?for update skip locked[\s\S]*?\)/);
assert.match(independentMigration, /outbox\.attempt_count >= 5\s+and \([\s\S]*?outbox\.state = 'processing' and outbox\.lease_expires_at <= now\(\)/);
assert.match(independentMigration, /outbox\.attempt_count < 5\s+and \(/);
assert.match(independentMigration, /outbox\.state in \('pending', 'retry_scheduled'\)/);
assert.match(independentMigration, /guard_outbox_mutation\(\)/);
assert.match(independentMigration, /old\.notification_kind is distinct from new\.notification_kind/);
assert.match(independentMigration, /old\.created_at is distinct from new\.created_at/);
assert.match(independentMigration, /verified Phase 1 outbox mutation guard contract does not match/);
assert.match(independentMigration, /when exhausted\.state = 'processing' then 'lease_expired'/);
assert.match(independentMigration, /else 'attempts_exhausted'/);
assert.match(independentMigration, /A Phase 1 unique constraint required for idempotency is missing/);
assert.match(independentMigration, /Private notification schema objects must not grant browser or service roles access/);
assert.match(independentMigration, /family_promotion_notification_inbox/);
assert.match(independentMigration, /mark_family_promotion_notification_read/);
assert.match(independentMigration, /staff_promotion_notification_inbox/);
assert.match(independentMigration, /mark_staff_promotion_notification_read/);
assert.match(independentMigration, /on conflict \(promotion_id, notification_kind\) do nothing/i);
assert.doesNotMatch(independentMigration, /create\s+(or replace\s+)?function\s+public\.record_student_promotion/i);
assert.match(promotionIntegration, /create or replace function public\.record_student_promotion/i);
assert.match(promotionIntegration, /normalized_type := lower\(trim\(coalesce\(p_promotion_type, ''\)\)\);/);
assert.match(promotionIntegration, /for update;/);
assert.match(promotionIntegration, /returning id into created_promotion_id;/);
assert.match(promotionIntegration, /enqueue_verified_promotion_celebration/);
assert.match(promotionIntegration, /promotion_effective_at/);
assert.match(promotionIntegration, /update public\.students/);
assert.match(promotionComparison, /pg_get_functiondef/);
assert.match(promotionComparison, /RETURNING id INTO created_promotion_id/i);
assert.match(edgeWorkerSource, /withSupabase\(\{ auth: "secret" \}/);
assert.match(edgeWorkerSource, /process_gym4_promotion_notification_outbox/);
assert.match(edgeWorkerSource, /request\.method !== "POST"/);
assert.doesNotMatch(edgeWorkerSource, /service_role|SUPABASE_SERVICE_ROLE_KEY/);
assert.match(edgeWorkerSource, /error\.code === "42501"\s*&&\s*error\.message === "Promotion notifications are not enabled for this gym\."/);
assert.match(edgeFunctionConfig, /\[functions\.promotion-notification-worker\]/);
assert.match(edgeFunctionConfig, /verify_jwt = false/);
assert.match(deploymentVerification, /^-- READ ONLY/m);
const deploymentVerificationStatements = deploymentVerification
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");
assert.doesNotMatch(deploymentVerificationStatements, /\b(insert|update|delete|create|alter|drop|grant|revoke|perform|call)\b/i);
assert.match(deploymentVerification, /gym4_enabled_rows/);
assert.match(deploymentVerification, /uses_official_enqueue_helper/);
assert.match(deploymentVerification, /has_function_privilege\('service_role', 'public\.process_gym4_promotion_notification_outbox/);
assert.match(deploymentChecklist, /zero rollout rows and zero enabled\s+rows/i);
assert.match(deploymentChecklist, /no trusted rollout-control function/i);
assert.match(rolloutControl, /session_user <> 'postgres'/);
assert.match(rolloutControl, /gym4_only check \(gym_id = 4\)/i);
assert.match(rolloutControl, /pg_advisory_xact_lock\(40917, 4\)/);
assert.match(rolloutControl, /on conflict on constraint gym_notification_rollouts_pkey do nothing/i);
assert.match(rolloutControl, /force row level security/i);
assert.doesNotMatch(rolloutControl, /grant execute/i);
assert.match(rolloutControl, /Fresh on every activation by policy/);
assert.match(rolloutControl, /resulting_generation_floor_at/);
assert.match(rolloutControl, /Request ID was already used with different rollout parameters/);
assert.match(rolloutControl, /request_matches_current_state boolean/);
assert.match(rolloutControl, /event\.reason is distinct from normalized_reason/);
assert.match(rolloutControl, /gym_notification_rollouts has an unexpected enabled trigger/);
assert.match(rolloutRunbook, /not cryptographic proof/i);
assert.match(rolloutRunbook, /provision_disabled/);
assert.match(rolloutRunbook, /same request UUID is idempotent/i);
assert.match(rolloutRunbook, /fresh `generation_floor_at`/i);
assert.match(controlledTesting, /requires explicit approval/i);
assert.match(controlledTesting, /sixth processing attempt/i);
assert.match(controlledTesting, /revok/i);
assert.match(operations, /external scheduler/i);
assert.match(operations, /Gym 4 disabled/i);
assert.match(mainReadiness, /^-- READ ONLY/m);
assert.match(mainReadiness, /record_student_promotion\(bigint,text,integer,text\)/);
assert.match(mainReadiness, /set_gym4_promotion_notification_rollout\(boolean,uuid,text,uuid\)/);
assert.match(mainReadiness, /gym4_generation_floor_at/);
assert.match(mainReadiness, /pg_cron_installed/);
const mainReadinessStatements = mainReadiness
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");
assert.doesNotMatch(mainReadinessStatements, /\b(insert|update|delete|create|alter|drop|grant|revoke|perform|call)\b/i);
assert.match(notificationFeature, /enabled: false/);
assert.match(notificationClient, /family_promotion_notification_inbox/);
assert.match(notificationClient, /mark_staff_promotion_notification_read/);
assert.match(notificationClient, /'five_remaining'/);
assert.match(notificationClient, /'eligible_for_review'/);
assert.match(notificationScreen, /isPromotionNotificationsEnabled/);
assert.match(notificationScreen, /markPromotionNotificationRead/);
assert.match(notificationScreen, /Five classes remaining/);

console.log("PASS: Phase 2 promotion-notification review package is fail-closed and documents required deployment gates");
