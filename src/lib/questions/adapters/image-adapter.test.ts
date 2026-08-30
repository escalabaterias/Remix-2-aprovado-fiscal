/**
 * TESTES DO ADAPTADOR DE INGESTÃO POR IMAGEM/PRINT
 *
 * Cobertura:
 *   - Payload válido (image_base64 e image_url)
 *   - Payload sem imagem (rawData vazio)
 *   - Origem incorreta
 *   - ContentType não-imagem
 *   - Metadados preservados (completos, parciais, ausentes)
 *   - Comportamento determinístico
 *   - Tipo de erro retornado
 */

import { describe, it, expect } from "vitest";
import {
  prepareImagePayload,
  extractContestMetadata,
  type ImageExtractionRequest,
  type ImageAdapterError,
} from "./image-adapter";
import type { RawIngestionPayload } from "../ingestion";

// ─────────────────────────────────────────────────────────────────────────────
// FACTORIES
// ─────────────────────────────────────────────────────────────────────────────

function makeImagePayload(overrides: Partial<RawIngestionPayload> = {}): RawIngestionPayload {
  return {
    payloadId: "img-payload-1",
    source: "imagem_print",
    contentType: "image_base64",
    rawData: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk",
    sourceMetadata: {
      examBoard: "CESPE",
      contestName: "TRF 1ª Região",
      year: 2024,
      position: "Analista Judiciário",
      organization: "TRF1",
    },
    receivedAt: "2026-08-30T04:00:00Z",
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// prepareImagePayload — Payloads válidos
// ─────────────────────────────────────────────────────────────────────────────

describe("prepareImagePayload", () => {
  describe("payloads válidos", () => {
    it("aceita payload com image_base64", () => {
      const result = prepareImagePayload(makeImagePayload());

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.payloadId).toBe("img-payload-1");
      expect(result.data.contentType).toBe("image_base64");
      expect(result.data.imageData).toBe(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk",
      );
      expect(result.data.receivedAt).toBe("2026-08-30T04:00:00Z");
    });

    it("aceita payload com image_url", () => {
      const result = prepareImagePayload(
        makeImagePayload({
          contentType: "image_url",
          rawData: "https://example.com/prova.png",
        }),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.contentType).toBe("image_url");
      expect(result.data.imageData).toBe("https://example.com/prova.png");
    });

    it("preserva sourceMetadata integralmente no resultado", () => {
      const metadata = {
        examBoard: "FGV",
        contestName: "TJ-SP",
        year: 2023,
        customField: "valor-customizado",
      };
      const result = prepareImagePayload(makeImagePayload({ sourceMetadata: metadata }));

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.sourceMetadata).toEqual(metadata);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Origem incorreta
  // ─────────────────────────────────────────────────────────────────────────

  describe("origem incorreta", () => {
    it("rejeita payload com source manual", () => {
      const result = prepareImagePayload(makeImagePayload({ source: "manual" }));

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.code).toBe("INVALID_SOURCE");
      expect(result.error.message).toContain("manual");
    });

    it("rejeita payload com source pdf_prova", () => {
      const result = prepareImagePayload(makeImagePayload({ source: "pdf_prova" }));

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.code).toBe("INVALID_SOURCE");
    });

    it("rejeita payload com source banco_externo", () => {
      const result = prepareImagePayload(makeImagePayload({ source: "banco_externo" }));

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.code).toBe("INVALID_SOURCE");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // ContentType não-imagem
  // ─────────────────────────────────────────────────────────────────────────

  describe("contentType não-imagem", () => {
    it("rejeita text_json", () => {
      const result = prepareImagePayload(makeImagePayload({ contentType: "text_json" }));

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.code).toBe("INVALID_CONTENT_TYPE");
      expect(result.error.message).toContain("text_json");
    });

    it("rejeita text_plain", () => {
      const result = prepareImagePayload(makeImagePayload({ contentType: "text_plain" }));

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.code).toBe("INVALID_CONTENT_TYPE");
    });

    it("rejeita pdf_base64", () => {
      const result = prepareImagePayload(makeImagePayload({ contentType: "pdf_base64" }));

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.code).toBe("INVALID_CONTENT_TYPE");
    });

    it("rejeita text_csv", () => {
      const result = prepareImagePayload(makeImagePayload({ contentType: "text_csv" }));

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.code).toBe("INVALID_CONTENT_TYPE");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Dados da imagem vazios
  // ─────────────────────────────────────────────────────────────────────────

  describe("dados da imagem", () => {
    it("rejeita rawData vazio", () => {
      const result = prepareImagePayload(makeImagePayload({ rawData: "" }));

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.code).toBe("EMPTY_IMAGE_DATA");
    });

    it("rejeita rawData com apenas espaços", () => {
      const result = prepareImagePayload(makeImagePayload({ rawData: "   " }));

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.code).toBe("EMPTY_IMAGE_DATA");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Metadados de concurso
  // ─────────────────────────────────────────────────────────────────────────

  describe("metadados de concurso", () => {
    it("preserva todos os metadados de concurso", () => {
      const result = prepareImagePayload(makeImagePayload());

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.contestMetadata.examBoard).toBe("CESPE");
      expect(result.data.contestMetadata.contestName).toBe("TRF 1ª Região");
      expect(result.data.contestMetadata.year).toBe(2024);
      expect(result.data.contestMetadata.position).toBe("Analista Judiciário");
      expect(result.data.contestMetadata.organization).toBe("TRF1");
    });

    it("preserva metadados parciais", () => {
      const result = prepareImagePayload(
        makeImagePayload({
          sourceMetadata: { examBoard: "FCC", year: 2022 },
        }),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.contestMetadata.examBoard).toBe("FCC");
      expect(result.data.contestMetadata.year).toBe(2022);
      expect(result.data.contestMetadata.contestName).toBeNull();
      expect(result.data.contestMetadata.position).toBeNull();
      expect(result.data.contestMetadata.organization).toBeNull();
    });

    it("retorna metadados null quando sourceMetadata é null", () => {
      const result = prepareImagePayload(makeImagePayload({ sourceMetadata: null }));

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.contestMetadata.examBoard).toBeNull();
      expect(result.data.contestMetadata.contestName).toBeNull();
      expect(result.data.contestMetadata.year).toBeNull();
      expect(result.data.contestMetadata.position).toBeNull();
      expect(result.data.contestMetadata.organization).toBeNull();
    });

    it("aceita nomes alternativos em português nos metadados", () => {
      const result = prepareImagePayload(
        makeImagePayload({
          sourceMetadata: {
            banca: "VUNESP",
            concurso: "PM-SP",
            ano: 2025,
            cargo: "Soldado",
            orgao: "PM-SP",
          },
        }),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.contestMetadata.examBoard).toBe("VUNESP");
      expect(result.data.contestMetadata.contestName).toBe("PM-SP");
      expect(result.data.contestMetadata.year).toBe(2025);
      expect(result.data.contestMetadata.position).toBe("Soldado");
      expect(result.data.contestMetadata.organization).toBe("PM-SP");
    });

    it("aceita ano como string numérica", () => {
      const result = prepareImagePayload(
        makeImagePayload({
          sourceMetadata: { year: "2023" },
        }),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.contestMetadata.year).toBe(2023);
    });

    it("ignora valores não-string para campos de texto", () => {
      const result = prepareImagePayload(
        makeImagePayload({
          sourceMetadata: {
            examBoard: 123,
            contestName: true,
            year: 2024,
          },
        }),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.contestMetadata.examBoard).toBeNull();
      expect(result.data.contestMetadata.contestName).toBeNull();
      expect(result.data.contestMetadata.year).toBe(2024);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Determinismo
  // ─────────────────────────────────────────────────────────────────────────

  describe("determinismo", () => {
    it("mesmo input → mesmo output (payload válido)", () => {
      const payload = makeImagePayload();
      const r1 = prepareImagePayload(payload);
      const r2 = prepareImagePayload(payload);
      expect(r1).toEqual(r2);
    });

    it("mesmo input → mesmo output (payload inválido)", () => {
      const payload = makeImagePayload({ source: "manual" });
      const r1 = prepareImagePayload(payload);
      const r2 = prepareImagePayload(payload);
      expect(r1).toEqual(r2);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Estrutura do erro
  // ─────────────────────────────────────────────────────────────────────────

  describe("estrutura do erro", () => {
    it("erro tem code e message", () => {
      const result = prepareImagePayload(makeImagePayload({ source: "manual" }));

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error).toHaveProperty("code");
      expect(result.error).toHaveProperty("message");
      expect(typeof result.error.code).toBe("string");
      expect(typeof result.error.message).toBe("string");
    });

    it("cada tipo de erro tem code distinto", () => {
      const sourceErr = prepareImagePayload(makeImagePayload({ source: "manual" }));
      const typeErr = prepareImagePayload(makeImagePayload({ contentType: "text_json" }));
      const dataErr = prepareImagePayload(makeImagePayload({ rawData: "" }));

      expect(!sourceErr.ok && sourceErr.error.code).toBe("INVALID_SOURCE");
      expect(!typeErr.ok && typeErr.error.code).toBe("INVALID_CONTENT_TYPE");
      expect(!dataErr.ok && dataErr.error.code).toBe("EMPTY_IMAGE_DATA");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// extractContestMetadata (unidade)
// ─────────────────────────────────────────────────────────────────────────────

describe("extractContestMetadata", () => {
  it("retorna todos null para null", () => {
    const meta = extractContestMetadata(null);
    expect(meta.examBoard).toBeNull();
    expect(meta.contestName).toBeNull();
    expect(meta.year).toBeNull();
    expect(meta.position).toBeNull();
    expect(meta.organization).toBeNull();
  });

  it("retorna todos null para undefined", () => {
    const meta = extractContestMetadata(undefined);
    expect(meta.examBoard).toBeNull();
  });

  it("retorna todos null para objeto vazio", () => {
    const meta = extractContestMetadata({});
    expect(meta.examBoard).toBeNull();
    expect(meta.year).toBeNull();
  });

  it("ignora strings vazias", () => {
    const meta = extractContestMetadata({ examBoard: "", contestName: "   " });
    expect(meta.examBoard).toBeNull();
    expect(meta.contestName).toBeNull();
  });

  it("prioriza nomes em inglês sobre português", () => {
    const meta = extractContestMetadata({
      examBoard: "CESPE",
      banca: "FCC",
    });
    expect(meta.examBoard).toBe("CESPE");
  });

  it("usa nome em português como fallback", () => {
    const meta = extractContestMetadata({ banca: "FCC" });
    expect(meta.examBoard).toBe("FCC");
  });

  it("é determinístico", () => {
    const input = { examBoard: "CESPE", year: 2024 };
    expect(extractContestMetadata(input)).toEqual(extractContestMetadata(input));
  });
});
