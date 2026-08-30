const { createClient } = require("@supabase/supabase-js");

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(url, key);
const supabaseAdmin = createClient(url, serviceKey);

const results = {};
const cleanupIds = { subjects: [], topics: [], questions: [], user: null };

async function runTest(name, fn) {
  try {
    const res = await fn();
    results[name] = { status: "🟢 PASSOU", details: res };
  } catch (err) {
    results[name] = { status: "🔴 FALHOU", error: err.message };
  }
}

async function main() {
  const email = `admin_test_${Date.now()}@test.com`;
  const password = "Password123!";
  let authUser = null;

  await runTest("Autenticação", async () => {
    const { data: adminData, error: adminErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (adminErr) throw adminErr;
    authUser = adminData.user;
    cleanupIds.user = authUser.id;

    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError) throw signInError;

    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", authUser.id)
      .single();
    if (profileErr) throw profileErr;
    if (!profile) throw new Error("Profile not created automatically");

    return "Cadastro (via Admin), Login e Profile OK";
  });

  if (!authUser) {
    console.log("Auth failed, aborting further tests.");
    return;
  }

  await runTest("Dashboard", async () => {
    const today = new Date().toISOString().split("T")[0];
    await Promise.all([
      supabase.from("contests").select("id").limit(1),
      supabase.from("study_plans").select("id").limit(1),
      supabase.from("plan_tasks").select("id").eq("scheduled_date", today).limit(1),
    ]).then((resps) =>
      resps.forEach((r) => {
        if (r.error) throw r.error;
      }),
    );

    return "Consultas do Dashboard OK";
  });

  let contestId = null;
  await runTest("Concursos", async () => {
    const { data, error } = await supabase
      .from("contests")
      .insert({
        user_id: authUser.id,
        name: "Concurso Teste",
        status: "ativo",
      })
      .select()
      .single();
    if (error) throw error;
    contestId = data.id;

    const { data: list, error: errList } = await supabase.from("contests").select("*");
    if (errList) throw errList;
    if (list.length === 0) throw new Error("List is empty");

    return "Criação e listagem OK";
  });

  let subjectId = null;
  let topicId = null;
  await runTest("Matérias", async () => {
    const { data: subj, error: subjErr } = await supabase
      .from("subjects")
      .insert({
        name: "Matéria Teste " + Date.now(),
        area: "Geral",
        created_by: authUser.id,
      })
      .select()
      .single();
    if (subjErr) throw subjErr;
    subjectId = subj.id;
    cleanupIds.subjects.push(subjectId);

    const { data: topic, error: topErr } = await supabase
      .from("topics")
      .insert({
        subject_id: subjectId,
        name: "Tópico Teste",
        created_by: authUser.id,
      })
      .select()
      .single();
    if (topErr) throw topErr;
    topicId = topic.id;
    cleanupIds.topics.push(topicId);

    return "Criação de matéria e tópico OK";
  });

  let questionId = null;
  await runTest("Questões", async () => {
    const { data: q, error: qErr } = await supabase
      .from("questions")
      .insert({
        user_id: authUser.id,
        topic_id: topicId,
        statement: "Quanto é 2+2?",
        alternatives: [{ id: "d", text: "4" }],
        correct_answer: "d",
        difficulty: 1,
      })
      .select()
      .single();
    if (qErr) throw qErr;
    questionId = q.id;
    cleanupIds.questions.push(questionId);

    const { data: attempt, error: attErr } = await supabase
      .from("question_attempts")
      .insert({
        user_id: authUser.id,
        question_id: questionId,
        chosen_answer: "d",
        is_correct: true,
        time_spent_seconds: 10,
      })
      .select()
      .single();
    if (attErr) throw attErr;

    return "Busca, resposta e registro da tentativa OK";
  });

  await runTest("Central de Erros", async () => {
    const { data: attempt, error: attErr } = await supabase
      .from("question_attempts")
      .insert({
        user_id: authUser.id,
        question_id: questionId,
        chosen_answer: "a",
        is_correct: false,
        time_spent_seconds: 5,
      })
      .select()
      .single();
    if (attErr) throw attErr;

    const { data: errs, error } = await supabase
      .from("error_entries")
      .select("*")
      .eq("user_id", authUser.id);
    if (error) throw error;

    return `Listagem de erros OK. (${errs.length} encontrados)`;
  });

  let planId = null;
  await runTest("Plano", async () => {
    const { data, error } = await supabase
      .from("study_plans")
      .insert({
        user_id: authUser.id,
        contest_id: contestId,
        name: "Plano Teste",
        start_date: "2026-08-01",
        end_date: "2026-12-31",
        is_active: true,
      })
      .select()
      .single();
    if (error) throw error;
    planId = data.id;

    const { error: taskErr } = await supabase.from("plan_tasks").insert({
      user_id: authUser.id,
      plan_id: planId,
      title: "Tarefa 1",
      scheduled_date: "2026-08-30",
      status: "pendente",
    });
    if (taskErr) throw taskErr;

    return "Criação de plano e tarefa OK";
  });

  await runTest("Disponibilidade", async () => {
    const { error } = await supabase.from("availability_weeks").insert({
      user_id: authUser.id,
      week_start: "2026-08-24",
      minutes_mon: 120,
      minutes_tue: 120,
      minutes_wed: 120,
      minutes_thu: 120,
      minutes_fri: 120,
      minutes_sat: 240,
      minutes_sun: 0,
    });
    if (error) throw error;
    return "Criação de disponibilidade semanal OK";
  });

  await runTest("Revisão", async () => {
    const { data, error } = await supabase
      .from("review_events")
      .select("*")
      .eq("user_id", authUser.id);
    if (error) throw error;
    return "Busca na fila de revisão OK";
  });

  console.log("\n### RESUMO ###");
  Object.entries(results).forEach(([k, v]) => {
    console.log(`| ${k} | ${v.status} | ${v.error || v.details} |`);
  });

  console.log("\nCleaning up...");
  if (cleanupIds.questions.length)
    await supabaseAdmin.from("questions").delete().in("id", cleanupIds.questions);
  if (cleanupIds.topics.length)
    await supabaseAdmin.from("topics").delete().in("id", cleanupIds.topics);
  if (cleanupIds.subjects.length)
    await supabaseAdmin.from("subjects").delete().in("id", cleanupIds.subjects);
  if (cleanupIds.user) await supabaseAdmin.auth.admin.deleteUser(cleanupIds.user);
  console.log("Cleanup complete.");
}
main();
