/**
 * UTILITÁRIOS DE NORMALIZAÇÃO E DEDUPLICAÇÃO DE QUESTÕES
 *
 * Módulo centralizado para:
 * 1. Normalização de Bancas Examinadoras (Banca Normalizer)
 * 2. Normalização de texto (remoção de acentos, espaços extras, diacríticos)
 * 3. Geração determinística de Content Hash para deduplicação de questões
 *
 * PRINCÍPIOS:
 * - Funções puras: mesmo input → mesmo output.
 * - Determinístico e sem efeitos colaterais.
 * - Compatível com ambiente Node, Browser e Vitest.
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. NORMALIZAÇÃO DE TEXTO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normaliza uma string para comparação:
 * - Converte para minúsculas
 * - Remove acentos e caracteres diacríticos (NFD)
 * - Remove espaços extras nas pontas e colapsa múltiplos espaços em um único
 *
 * @param text - Texto a ser normalizado.
 * @returns Texto normalizado em minúsculas sem acentos.
 */
export function normalizeText(text: string): string {
  if (!text) return "";
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normaliza um nome para chave de busca/comparação (usado em subjects, topics, etc).
 */
export function normalizeName(name: string): string {
  return normalizeText(name);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. NORMALIZAÇÃO DE BANCAS EXAMINADORAS (EXAM BOARDS)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Dicionário de sinônimos e variações de nomes de bancas examinadoras.
 * As chaves são representações simplificadas (sem pontuação/acentos em minúsculas).
 */
const EXAM_BOARD_MAP: Readonly<Record<string, string>> = {
  // CEBRASPE / CESPE
  cebraspe: "CEBRASPE",
  cespe: "CEBRASPE",
  "cespe cebraspe": "CEBRASPE",
  "cespe / cebraspe": "CEBRASPE",
  "cespe - cebraspe": "CEBRASPE",
  "cebraspe cespe": "CEBRASPE",
  "cespe unb": "CEBRASPE",
  "cespe / unb": "CEBRASPE",
  "cespe - unb": "CEBRASPE",
  "unb cespe": "CEBRASPE",
  "centro de selecao e de promocao de eventos": "CEBRASPE",
  "centro brasileiro de pesquisa em avaliacao e selecao e de promocao de eventos": "CEBRASPE",

  // FCC
  fcc: "FCC",
  "fundacao carlos chagas": "FCC",
  "carlos chagas": "FCC",

  // FGV
  fgv: "FGV",
  "fundacao getulio vargas": "FGV",
  "getulio vargas": "FGV",

  // VUNESP
  vunesp: "VUNESP",
  "fundacao vunesp": "VUNESP",
  "fundacao para o vestibular da universidade estadual paulista": "VUNESP",

  // CESGRANRIO
  cesgranrio: "CESGRANRIO",
  "fundacao cesgranrio": "CESGRANRIO",

  // IBFC
  ibfc: "IBFC",
  "instituto brasileiro de formacao e capacitacao": "IBFC",

  // AOCP
  aocp: "AOCP",
  "instituto aocp": "AOCP",
  "assessoria em organizacao de concursos publicos": "AOCP",

  // IDECAN
  idecan: "IDECAN",
  "instituto de desenvolvimento educacional cultural e assistencial nacional": "IDECAN",

  // QUADRIX
  quadrix: "QUADRIX",
  "instituto quadrix": "QUADRIX",

  // SELECON
  selecon: "SELECON",
  "instituto selecon": "SELECON",

  // IADES
  iades: "IADES",
  "instituto americano de desenvolvimento": "IADES",

  // FUNDATEC
  fundatec: "FUNDATEC",
  "fundacao universidade empresa de tecnologia e ciencias": "FUNDATEC",

  // CONSULPLAN
  consulplan: "CONSULPLAN",
  "instituto consulplan": "CONSULPLAN",

  // IBADE
  ibade: "IBADE",
  "instituto brasileiro de apoio e desenvolvimento executivo": "IBADE",

  // FAURGS
  faurgs: "FAURGS",
  "fundacao de apoio da universidade federal do rio grande do sul": "FAURGS",

  // FURB
  furb: "FURB",
  "fundacao universidade regional de blumenau": "FURB",

  // FAEPESUL
  faepesul: "FAEPESUL",

  // FUNDEP
  fundep: "FUNDEP",
  "fundacao de desenvolvimento da pesquisa": "FUNDEP",

  // ITAME
  itame: "ITAME",
  "instituto de consultoria e concursos itame": "ITAME",

  // AVANÇA SP
  "avanca sp": "AVANÇA SP",
  "instituto avanca sp": "AVANÇA SP",

  // INSTITUTO LEGATUS
  legatus: "INSTITUTO LEGATUS",
  "instituto legatus": "INSTITUTO LEGATUS",

  // OBJETIVA
  objetiva: "OBJETIVA CONCURSOS",
  "objetiva concursos": "OBJETIVA CONCURSOS",

  // FUMARC
  fumarc: "FUMARC",
  "fundacao mariana resende costa": "FUMARC",

  // COSEAC / UFF
  coseac: "COSEAC",
  "coseac uff": "COSEAC",

  // COMPERVE / UFRN
  comperve: "COMPERVE",
  "comperve ufrn": "COMPERVE",

  // ESAF (Histórica)
  esaf: "ESAF",
  "escola de administracao fazendaria": "ESAF",
};

/**
 * Normaliza o nome da banca examinadora para sua forma canônica padrão.
 *
 * Exemplos:
 * - "CESPE/CEBRASPE" -> "CEBRASPE"
 * - "cespe - unb" -> "CEBRASPE"
 * - "Fundação Getulio Vargas" -> "FGV"
 * - "Fundação Carlos Chagas" -> "FCC"
 * - "  fcc  " -> "FCC"
 * - null / "" -> null
 *
 * Se a banca não constar no dicionário, retorna a string limpa e formatada
 * em maiúsculas (uppercase).
 *
 * @param raw - Nome bruto da banca.
 * @returns Nome canônico normalizado ou null.
 */
export function normalizeExamBoard(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;

  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  // Simplifica para chave de dicionário: remove pontuações, parênteses, barras e hífens
  const key = normalizeText(trimmed)
    .replace(/[()[\]/\\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (EXAM_BOARD_MAP[key]) {
    return EXAM_BOARD_MAP[key];
  }

  // Verifica se alguma chave conhecida é substring expressiva
  if (key.includes("cebraspe") || key.includes("cespe")) {
    return "CEBRASPE";
  }
  if (key.includes("carlos chagas") || key === "fcc") {
    return "FCC";
  }
  if (key.includes("getulio vargas") || key === "fgv") {
    return "FGV";
  }
  if (key.includes("vunesp")) {
    return "VUNESP";
  }
  if (key.includes("cesgranrio")) {
    return "CESGRANRIO";
  }
  if (key.includes("ibfc")) {
    return "IBFC";
  }
  if (key.includes("aocp")) {
    return "INSTITUTO AOCP";
  }
  if (key.includes("idecan")) {
    return "IDECAN";
  }
  if (key.includes("quadrix")) {
    return "QUADRIX";
  }
  if (key.includes("selecon")) {
    return "SELECON";
  }
  if (key.includes("consulplan")) {
    return "CONSULPLAN";
  }
  if (key.includes("fundatec")) {
    return "FUNDATEC";
  }
  if (key.includes("iades")) {
    return "IADES";
  }

  // Fallback: retorna trimmed em uppercase se sigla curta ou limpo
  return trimmed.replace(/\s+/g, " ").toUpperCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. CONTENT HASH PARA DEDUPLICAÇÃO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Implementação pura e determinística de SHA-256 em TypeScript.
 * Funciona de maneira idêntica em qualquer ambiente (Node, Browser, Test).
 */
function sha256Pure(str: string): string {
  function rightRotate(value: number, amount: number): number {
    return (value >>> amount) | (value << (32 - amount));
  }

  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  let lengthProperty = "length";
  let i: number, j: number;
  let result = "";

  const words: number[] = [];
  const asciiBitLength = str[lengthProperty] * 8;

  let hash = ((sha256Pure as unknown as { h?: number[] }).h =
    (sha256Pure as unknown as { h?: number[] }).h || []);
  const k = ((sha256Pure as unknown as { k?: number[] }).k =
    (sha256Pure as unknown as { k?: number[] }).k || []);
  let primeCounter = k[lengthProperty];

  const isComposite: Record<number, number> = {};
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (i = 0; i < 300; i += candidate) {
        isComposite[i] = candidate;
      }
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }

  str += "\x80";
  while ((str[lengthProperty] % 64) - 56) str += "\x00";
  for (i = 0; i < str[lengthProperty]; i++) {
    j = str.charCodeAt(i);
    if (j >> 8) return ""; // non-ASCII
    words[i >> 2] |= j << (((3 - i) % 4) * 8);
  }
  words[words[lengthProperty]] = (asciiBitLength / maxWord) | 0;
  words[words[lengthProperty]] = asciiBitLength;

  for (j = 0; j < words[lengthProperty];) {
    const w = words.slice(j, (j += 16));
    const oldHash = hash;
    hash = hash.slice(0, 8);

    for (i = 0; i < 64; i++) {
      const w15 = w[i - 15],
        w2 = w[i - 2];

      const s0 = rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3);
      const s1 = rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10);
      w[i] = i < 16 ? w[i] : (((w[i - 16] + s0) | 0) + ((w[i - 7] + s1) | 0)) | 0;

      const s1h = rightRotate(hash[4], 6) ^ rightRotate(hash[4], 11) ^ rightRotate(hash[4], 25);
      const ch = (hash[4] & hash[5]) ^ (~hash[4] & hash[6]);
      const temp1 = ((((hash[7] + s1h) | 0) + ((ch + k[i]) | 0)) | 0) + w[i];
      const s0h = rightRotate(hash[0], 2) ^ rightRotate(hash[0], 13) ^ rightRotate(hash[0], 22);
      const maj = (hash[0] & hash[1]) ^ (hash[0] & hash[2]) ^ (hash[1] & hash[2]);
      const temp2 = (s0h + maj) | 0;

      hash = [
        (temp1 + temp2) | 0,
        hash[0],
        hash[1],
        hash[2],
        (hash[3] + temp1) | 0,
        hash[4],
        hash[5],
        hash[6],
      ];
    }

    for (i = 0; i < 8; i++) {
      hash[i] = (hash[i] + oldHash[i]) | 0;
    }
  }

  for (i = 0; i < 8; i++) {
    for (j = 3; j + 1; j--) {
      const b = (hash[i] >> (j * 8)) & 255;
      result += (b < 16 ? "0" : "") + b.toString(16);
    }
  }
  return result;
}

/**
 * Gera um hash determinístico (SHA-256) a partir do enunciado e das alternativas de uma questão.
 *
 * Processo:
 * 1. Normaliza o enunciado (minúsculas, sem acentos, sem espaços extras).
 * 2. Ordena e normaliza as alternativas (letra, texto normalizado, se é correta).
 * 3. Concatena os elementos num payload determinístico.
 * 4. Calcula o hash SHA-256 em hexadecimal.
 *
 * @param statement - Enunciado da questão.
 * @param alternatives - Lista de alternativas (pode ser vazia no caso de Certo/Errado puro).
 * @returns String hexadecimal de 64 caracteres do SHA-256.
 */
export function computeQuestionContentHash(
  statement: string,
  alternatives: Array<{
    letter?: string;
    text?: string;
    isCorrect?: boolean | null;
  }> = [],
): string {
  const normStatement = normalizeText(statement);

  const normAlternatives = (alternatives || [])
    .map((alt) => {
      const letter = (alt.letter || "").trim().toUpperCase();
      const text = normalizeText(alt.text || "");
      const isCorrect = alt.isCorrect === true ? "1" : "0";
      return `${letter}:${text}:${isCorrect}`;
    })
    .sort()
    .join(";");

  const combined = `stmt=${normStatement}|alts=${normAlternatives}`;
  return sha256Pure(combined);
}
