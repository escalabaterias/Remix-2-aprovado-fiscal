const { createClient } = require("@supabase/supabase-js");
const url = process.env.VITE_SUPABASE_URL || "https://wdxqvcqcxtwhcxnlyqqx.supabase.co";
const key =
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY;
const supabase = createClient(url, key);

async function test() {
  const { data, error, status } = await supabase.from("topic_prerequisites").select("*").limit(1);
  console.log(`[topic_prerequisites] Status: ${status}, Error: ${error ? error.message : "None"}`);
}
test();
