import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Aprovado Fiscal — Preparação orientada por dados" },
      {
        name: "description",
        content:
          "Fundação da plataforma pessoal de estudos para concursos fiscais: concursos, editais, matérias, tópicos, questões e revisões em uma única base de conhecimento.",
      },
      { property: "og:title", content: "Aprovado Fiscal — Preparação orientada por dados" },
      {
        property: "og:description",
        content:
          "Plataforma pessoal de preparação para concursos fiscais com base de conhecimento reutilizável, questões, revisão e desempenho.",
      },
    ],
  }),
  component: Landing,
});

const PILLARS = [
  {
    title: "Base de conhecimento reutilizável",
    body: "Matérias, tópicos e conceitos existem independentemente do concurso. O que você domina é aproveitado em qualquer edital.",
  },
  {
    title: "Contexto por concurso",
    body: "Concursos, editais e retificações organizados separadamente, com prioridade, peso e incidência por tópico.",
  },
  {
    title: "Dados de desempenho",
    body: "Tentativas, erros, sessões e revisões registrados desde o início para alimentar diagnóstico e plano adaptativo.",
  },
];

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-6 sm:px-6">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-base font-semibold tracking-tight">APROVADO</span>
          <span className="font-display text-base font-semibold tracking-tight text-primary">
            FISCAL
          </span>
        </div>
        <Link
          to="/auth"
          className="rounded-md border border-input px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
        >
          Entrar
        </Link>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-20 sm:px-6">
        <section className="pt-10 sm:pt-16">
          <p className="label-eyebrow">Etapa 1 — Fundação técnica</p>
          <h1 className="mt-4 max-w-3xl text-3xl font-semibold leading-tight sm:text-5xl">
            Preparação para concursos fiscais orientada por dados, não por intuição.
          </h1>
          <p className="mt-5 max-w-2xl text-base text-muted-foreground">
            O Aprovado Fiscal conecta concurso, edital, matéria, tópico, conceito, fonte, questão,
            erro e revisão em um único modelo de conhecimento — a base sobre a qual os módulos
            inteligentes serão construídos.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to="/auth"
              className="inline-flex items-center justify-center rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Criar minha conta
            </Link>
            <Link
              to="/dashboard"
              className="inline-flex items-center justify-center rounded-md border border-input px-5 py-2.5 text-sm font-medium transition-colors hover:bg-accent"
            >
              Acessar o painel
            </Link>
          </div>
        </section>

        <section className="mt-16 grid gap-4 sm:grid-cols-3">
          {PILLARS.map((p) => (
            <article key={p.title} className="panel px-5 py-5">
              <h2 className="font-display text-sm font-semibold">{p.title}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{p.body}</p>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}
