const { createClient } = require("@supabase/supabase-js");
const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(url, serviceKey);

async function run() {
  const { data: users } = await supabaseAdmin.auth.admin.listUsers();
  const userId = users.users[0]?.id;
  console.log("User:", userId);

  const tables = ["contests", "subjects", "questions", "study_plans"];
  for (const t of tables) {
    const { data } = await supabaseAdmin.from(t).select("id");
    console.log(`${t} count:`, data?.length);
  }
}
run();
