/**
 * Itens de navegação do sistema.
 * Centralizado para evitar duplicação entre AppShell, mobile menu, etc.
 */

export type NavItem = {
  label: string;
  to: string | null;
  group: "estudo" | "conhecimento" | "inteligencia" | "sistema";
};

export const NAV_GROUP_LABELS: Record<NavItem["group"], string> = {
  estudo: "Estudo",
  conhecimento: "Conhecimento",
  inteligencia: "Inteligência",
  sistema: "Sistema",
};

export const NAV_ITEMS: NavItem[] = [
  { label: "Centro de Comando", to: "/dashboard", group: "estudo" },
  { label: "Sessão de Estudo", to: "/estudo", group: "estudo" },
  { label: "Questões", to: "/questoes", group: "estudo" },
  { label: "Importar Questão", to: "/questoes/importar", group: "estudo" },
  { label: "Concursos", to: "/concursos", group: "estudo" },
  { label: "Matérias", to: "/materias", group: "estudo" },
  { label: "Plano de Estudos", to: "/plano", group: "estudo" },
  { label: "Disponibilidade", to: "/disponibilidade", group: "estudo" },

  { label: "Central de Erros", to: "/central-erros", group: "conhecimento" },
  { label: "Domínio", to: "/dominio", group: "conhecimento" },
  { label: "Revisões", to: "/revisao", group: "conhecimento" },
  { label: "Flashcards", to: null, group: "conhecimento" },

  { label: "Coach IA", to: null, group: "inteligencia" },
  { label: "Análise de Bancas", to: null, group: "inteligencia" },

  { label: "Configurações", to: "/configuracoes", group: "sistema" },
];
