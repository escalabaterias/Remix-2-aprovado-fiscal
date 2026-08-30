/**
 * SERVER FUNCTION — Extração e criação de questões via Gemini
 *
 * Encapsula extractAndCreateQuestions() numa createServerFn do TanStack Start.
 * Executa exclusivamente no servidor, garantindo que API keys e acesso ao
 * Supabase nunca vazem para o bundle do cliente.
 *
 * Usa requireSupabaseAuth middleware para propagar o contexto autenticado
 * do usuário, permitindo que createQuestion() funcione com RLS.
 *
 * A rota de importação (questoes/importar.tsx) chama esta Server Function
 * em vez de chamar extractAndCreateQuestions() diretamente.
 */

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ImageExtractionRequest } from "../adapters/image-adapter";
import { extractAndCreateQuestions, type ExtractAndCreateResult } from "./gemini-service";

// ─────────────────────────────────────────────────────────────────────────────
// TIPOS — input da Server Function
// ─────────────────────────────────────────────────────────────────────────────

export type ServerExtractionInput = {
  /** Dados da imagem em base64 */
  imageBase64: string;
  /** MIME type da imagem (ex: image/png) */
  mimeType: string;
  /** Nome original do arquivo */
  fileName: string;
  /** Tamanho do arquivo em bytes */
  fileSize: number;
  /** Metadados opcionais do concurso */
  contestMetadata: {
    examBoard: string | null;
    contestName: string | null;
    year: number | null;
    position: string | null;
    organization: string | null;
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// SERVER FUNCTION
// ─────────────────────────────────────────────────────────────────────────────

export const serverExtractAndCreateQuestions = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .validator((input: ServerExtractionInput): ServerExtractionInput => {
    // Validação básica dos campos obrigatórios
    if (!input.imageBase64 || input.imageBase64.trim().length === 0) {
      throw new Error("Dados da imagem estão vazios.");
    }
    if (!input.mimeType || !input.mimeType.startsWith("image/")) {
      throw new Error("Tipo de arquivo inválido. Envie uma imagem.");
    }
    return input;
  })
  .handler(async ({ data, context }): Promise<ExtractAndCreateResult> => {
    const payloadId = `img-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const request: ImageExtractionRequest = {
      payloadId,
      contentType: "image_base64",
      imageData: data.imageBase64,
      contestMetadata: data.contestMetadata,
      sourceMetadata: {
        fileName: data.fileName,
        fileSize: data.fileSize,
        mimeType: data.mimeType,
      },
      receivedAt: new Date().toISOString(),
    };

    // Pass the authenticated Supabase client from middleware context
    return extractAndCreateQuestions(request, undefined, context.supabase);
  });
