const { createClient } = require("@supabase/supabase-js");
const url = process.env.VITE_SUPABASE_URL || "https://wdxqvcqcxtwhcxnlyqqx.supabase.co";
const key =
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY;
const supabase = createClient(url, key);

async function test() {
  const today = new Date().toISOString().split("T")[0];
  const weekStart = today;
  const weekEnd = today;

  const results = await Promise.all([
    supabase
      .from("contests")
      .select("id, name, role_title, exam_board, exam_date, status, organization")
      .order("exam_date", { ascending: true }),
    supabase
      .from("study_plans")
      .select("id, name, contest_id, start_date, end_date, is_active")
      .eq("is_active", true)
      .order("created_at", { ascending: false }),
    supabase
      .from("plan_tasks")
      .select(
        "id, title, status, planned_minutes, actual_minutes, gross_minutes, activity_type, priority_score, priority_reason, plan_id, position, scheduled_date, source",
      )
      .eq("scheduled_date", today)
      .order("position", { ascending: true }),
    supabase
      .from("plan_tasks")
      .select(
        "id, title, status, planned_minutes, actual_minutes, gross_minutes, activity_type, priority_score, priority_reason, plan_id, position, scheduled_date, source",
      )
      .lt("scheduled_date", today)
      .in("status", ["pendente", "em_andamento", "reagendada"])
      .order("scheduled_date", { ascending: false }),
    supabase
      .from("plan_tasks")
      .select("id, planned_minutes, actual_minutes, status, scheduled_date")
      .gte("scheduled_date", weekStart)
      .lte("scheduled_date", weekEnd),
    supabase
      .from("study_sessions")
      .select("net_seconds, session_date, questions_count, correct_count"),
    supabase.from("question_attempts").select("is_correct"),
    supabase
      .from("review_events")
      .select("id", { count: "exact", head: true })
      .not("completed_at", "is", null),
    supabase
      .from("error_entries")
      .select("id", { count: "exact", head: true })
      .eq("is_resolved", false),
  ]);

  results.forEach((res, index) => {
    if (res.error) {
      console.log(`Query ${index} FAILED:`, res.error);
    } else {
      console.log(`Query ${index} OK (Status ${res.status})`);
    }
  });
}
test();
