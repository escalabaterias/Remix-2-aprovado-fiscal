/**
 * TESTES DA CONFIGURAÇÃO SEGURA DO GOOGLE GEMINI
 *
 * Cobertura:
 *   - GEMINI_API_KEY ausente → lança GeminiConfigError com MISSING_API_KEY
 *   - GEMINI_API_KEY vazia → lança GeminiConfigError com MISSING_API_KEY
 *   - GEMINI_API_KEY apenas espaços → lança GeminiConfigError com MISSING_API_KEY
 *   - GEMINI_API_KEY válida → retorna GeminiProviderConfig correto
 *   - Overrides de model, timeoutMs e baseUrl são repassados
 *   - Key retornada é trimada
 *   - Config sem overrides usa apenas a apiKey
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getGeminiConfig, GeminiConfigError } from "./gemini-config";

// ─────────────────────────────────────────────────────────────────────────────
// SETUP — salvar e restaurar process.env.GEMINI_API_KEY
// ─────────────────────────────────────────────────────────────────────────────

let originalValue: string | undefined;

beforeEach(() => {
  originalValue = process.env.GEMINI_API_KEY;
});

afterEach(() => {
  if (originalValue === undefined) {
    delete process.env.GEMINI_API_KEY;
  } else {
    process.env.GEMINI_API_KEY = originalValue;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// TESTES — configuração ausente
// ─────────────────────────────────────────────────────────────────────────────

describe("getGeminiConfig — configuração ausente", () => {
  it("lança GeminiConfigError quando GEMINI_API_KEY não está definida", () => {
    delete process.env.GEMINI_API_KEY;

    expect(() => getGeminiConfig()).toThrow(GeminiConfigError);

    try {
      getGeminiConfig();
    } catch (error) {
      const configError = error as GeminiConfigError;
      expect(configError.code).toBe("MISSING_API_KEY");
      expect(configError.message).toContain("GEMINI_API_KEY");
      expect(configError.name).toBe("GeminiConfigError");
    }
  });

  it("lança GeminiConfigError quando GEMINI_API_KEY é string vazia", () => {
    process.env.GEMINI_API_KEY = "";

    expect(() => getGeminiConfig()).toThrow(GeminiConfigError);

    try {
      getGeminiConfig();
    } catch (error) {
      const configError = error as GeminiConfigError;
      expect(configError.code).toBe("MISSING_API_KEY");
    }
  });

  it("lança GeminiConfigError quando GEMINI_API_KEY contém apenas espaços", () => {
    process.env.GEMINI_API_KEY = "   ";

    expect(() => getGeminiConfig()).toThrow(GeminiConfigError);

    try {
      getGeminiConfig();
    } catch (error) {
      const configError = error as GeminiConfigError;
      expect(configError.code).toBe("MISSING_API_KEY");
    }
  });

  it("mensagem de erro orienta sobre .env.local ou variáveis de deploy", () => {
    delete process.env.GEMINI_API_KEY;

    try {
      getGeminiConfig();
    } catch (error) {
      const configError = error as GeminiConfigError;
      expect(configError.message).toContain(".env.local");
      expect(configError.message).toContain("deploy");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TESTES — configuração válida
// ─────────────────────────────────────────────────────────────────────────────

describe("getGeminiConfig — configuração válida", () => {
  it("retorna GeminiProviderConfig com a apiKey do ambiente", () => {
    process.env.GEMINI_API_KEY = "AIzaSyTest1234567890";

    const config = getGeminiConfig();

    expect(config.apiKey).toBe("AIzaSyTest1234567890");
  });

  it("trima a apiKey", () => {
    process.env.GEMINI_API_KEY = "  AIzaSyTest1234567890  ";

    const config = getGeminiConfig();

    expect(config.apiKey).toBe("AIzaSyTest1234567890");
  });

  it("retorna config sem model, timeoutMs e baseUrl quando sem overrides", () => {
    process.env.GEMINI_API_KEY = "AIzaSyTest1234567890";

    const config = getGeminiConfig();

    expect(config.apiKey).toBe("AIzaSyTest1234567890");
    expect(config.model).toBeUndefined();
    expect(config.timeoutMs).toBeUndefined();
    expect(config.baseUrl).toBeUndefined();
  });

  it("repassa override de model", () => {
    process.env.GEMINI_API_KEY = "AIzaSyTest1234567890";

    const config = getGeminiConfig({ model: "gemini-1.5-pro" });

    expect(config.apiKey).toBe("AIzaSyTest1234567890");
    expect(config.model).toBe("gemini-1.5-pro");
  });

  it("repassa override de timeoutMs", () => {
    process.env.GEMINI_API_KEY = "AIzaSyTest1234567890";

    const config = getGeminiConfig({ timeoutMs: 60_000 });

    expect(config.timeoutMs).toBe(60_000);
  });

  it("repassa override de baseUrl", () => {
    process.env.GEMINI_API_KEY = "AIzaSyTest1234567890";

    const config = getGeminiConfig({
      baseUrl: "https://custom.api.example.com/v1",
    });

    expect(config.baseUrl).toBe("https://custom.api.example.com/v1");
  });

  it("repassa todos os overrides juntos", () => {
    process.env.GEMINI_API_KEY = "AIzaSyTest1234567890";

    const config = getGeminiConfig({
      model: "gemini-3.6-flash",
      timeoutMs: 15_000,
      baseUrl: "https://proxy.example.com/gemini",
    });

    expect(config.apiKey).toBe("AIzaSyTest1234567890");
    expect(config.model).toBe("gemini-3.6-flash");
    expect(config.timeoutMs).toBe(15_000);
    expect(config.baseUrl).toBe("https://proxy.example.com/gemini");
  });

  it("a key retornada corresponde exatamente à variável de ambiente (sem mutação)", () => {
    const key = "AIzaSyExactKey_abc123-XYZ";
    process.env.GEMINI_API_KEY = key;

    const config = getGeminiConfig();

    expect(config.apiKey).toBe(key);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TESTES — GeminiConfigError é instância de Error
// ─────────────────────────────────────────────────────────────────────────────

describe("GeminiConfigError", () => {
  it("é instância de Error", () => {
    const error = new GeminiConfigError("MISSING_API_KEY", "teste");

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(GeminiConfigError);
    expect(error.name).toBe("GeminiConfigError");
    expect(error.code).toBe("MISSING_API_KEY");
    expect(error.message).toBe("teste");
  });
});
