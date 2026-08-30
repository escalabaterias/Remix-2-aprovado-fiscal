import { describe, expect, it } from "vitest";

import {
  formatReviewDate,
  intervalLabel,
  predominantIntensity,
  REVIEW_INTENSITY_LABELS,
  REVIEW_TYPE_LABELS,
  urgencyBand,
  urgencyPercentLabel,
} from "./presentation";

describe("review presentation", () => {
  it("classifica faixas visuais de urgência", () => {
    expect(urgencyBand(0)).toBe("baixa");
    expect(urgencyBand(0.29)).toBe("baixa");
    expect(urgencyBand(0.3)).toBe("moderada");
    expect(urgencyBand(0.69)).toBe("moderada");
    expect(urgencyBand(0.7)).toBe("alta");
    expect(urgencyBand(1)).toBe("alta");
  });

  it("formata percentual sem alterar o valor original", () => {
    expect(urgencyPercentLabel(0.42)).toBe("42%");
    expect(urgencyPercentLabel(1.5)).toBe("100%");
    expect(urgencyPercentLabel(Number.NaN)).toBe("0%");
  });

  it("formata datas em pt-BR e trata inválidas", () => {
    expect(formatReviewDate("2026-03-05")).toBe("05/03/2026");
    expect(formatReviewDate("invalido")).toBe("—");
  });

  it("formata intervalo em dias", () => {
    expect(intervalLabel(1)).toBe("1 dia");
    expect(intervalLabel(7)).toBe("7 dias");
    expect(intervalLabel(Number.NaN)).toBe("0 dias");
  });

  it("expõe rótulos para todos os tipos e intensidades", () => {
    expect(Object.keys(REVIEW_TYPE_LABELS)).toHaveLength(4);
    expect(Object.keys(REVIEW_INTENSITY_LABELS)).toHaveLength(3);
  });

  it("calcula intensidade predominante", () => {
    expect(predominantIntensity([])).toBeNull();
    expect(
      predominantIntensity([
        { reviewIntensity: "leve" },
        { reviewIntensity: "leve" },
        { reviewIntensity: "intensiva" },
      ]),
    ).toBe("leve");
    expect(
      predominantIntensity([{ reviewIntensity: "intensiva" }, { reviewIntensity: "moderada" }]),
    ).toBe("intensiva");
  });
});
