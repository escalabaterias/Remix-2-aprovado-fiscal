import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { ExtractAndCreateResult } from "@/lib/questions/providers/gemini-service";
import { serverExtractAndCreateQuestions } from "@/lib/questions/providers/gemini-server-fn";

export const Route = createFileRoute("/_authenticated/questoes/importar")({
  head: () => ({
    meta: [
      { title: "Importar Questão por Imagem — Aprovado Fiscal" },
      {
        name: "description",
        content:
          "Cole uma imagem (Ctrl+V) ou selecione um arquivo para extrair questões automaticamente.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ImportarQuestaoPage,
});

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Remove the data:image/...;base64, prefix
      const base64 = result.includes(",") ? result.split(",")[1]! : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("Falha ao ler o arquivo."));
    reader.readAsDataURL(file);
  });
}

function fileToPreviewUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Falha ao gerar preview."));
    reader.readAsDataURL(file);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENTE PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────

function ImportarQuestaoPage() {
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<ExtractAndCreateResult | null>(null);

  // Metadados opcionais
  const [examBoard, setExamBoard] = useState("");
  const [contestName, setContestName] = useState("");
  const [year, setYear] = useState("");
  const [position, setPosition] = useState("");
  const [organization, setOrganization] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Listener de paste global ──
  const handlePaste = useCallback(
    async (e: ClipboardEvent) => {
      if (isProcessing) return;

      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (!file) continue;

          try {
            const url = await fileToPreviewUrl(file);
            setImageFile(file);
            setPreviewUrl(url);
            setResult(null);
            toast.success("Imagem colada com sucesso.");
          } catch {
            toast.error("Falha ao processar a imagem colada.");
          }
          return;
        }
      }
    },
    [isProcessing],
  );

  useEffect(() => {
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [handlePaste]);

  // ── Selecionar arquivo ──
  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Selecione um arquivo de imagem.");
      return;
    }

    try {
      const url = await fileToPreviewUrl(file);
      setImageFile(file);
      setPreviewUrl(url);
      setResult(null);
    } catch {
      toast.error("Falha ao processar o arquivo.");
    }

    // Reset input para permitir selecionar o mesmo arquivo novamente
    e.target.value = "";
  }, []);

  // ── Processar imagem ──
  const handleProcess = useCallback(async () => {
    if (!imageFile) return;

    setIsProcessing(true);
    setResult(null);

    try {
      const base64 = await fileToBase64(imageFile);

      const yearNum = year.trim() ? parseInt(year.trim(), 10) : null;

      const extractionResult = await serverExtractAndCreateQuestions({
        data: {
          imageBase64: base64,
          mimeType: imageFile.type,
          fileName: imageFile.name,
          fileSize: imageFile.size,
          contestMetadata: {
            examBoard: examBoard.trim() || null,
            contestName: contestName.trim() || null,
            year: yearNum !== null && Number.isFinite(yearNum) ? yearNum : null,
            position: position.trim() || null,
            organization: organization.trim() || null,
          },
        },
      });

      setResult(extractionResult);

      if (extractionResult.created.length > 0) {
        toast.success(`${extractionResult.created.length} questão(ões) importada(s) com sucesso.`);
      } else if (extractionResult.extraction.errors.length > 0) {
        toast.error("Falha na extração. Verifique os erros abaixo.");
      } else {
        toast.warning("Nenhuma questão foi extraída da imagem.");
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Erro desconhecido ao processar a imagem.";
      toast.error(message);
    } finally {
      setIsProcessing(false);
    }
  }, [imageFile, examBoard, contestName, year, position, organization]);

  // ── Limpar ──
  const handleClear = useCallback(() => {
    setImageFile(null);
    setPreviewUrl(null);
    setResult(null);
  }, []);

  // ── Render ──
  return (
    <AppShell
      title="Importar Questão por Imagem"
      description="Cole uma imagem (Ctrl+V) ou selecione um arquivo para extrair questões automaticamente."
    >
      <div className="mx-auto max-w-3xl space-y-6">
        {/* Área de captura */}
        {!previewUrl && (
          <Card>
            <CardContent className="py-12">
              <div className="flex flex-col items-center justify-center gap-4 text-center">
                <div className="rounded-full bg-muted p-4">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="32"
                    height="32"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-muted-foreground"
                    aria-hidden="true"
                  >
                    <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                    <circle cx="9" cy="9" r="2" />
                    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                  </svg>
                </div>
                <div className="space-y-1">
                  <p className="text-lg font-medium text-foreground">Cole uma imagem aqui</p>
                  <p className="text-sm text-muted-foreground">
                    Use{" "}
                    <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
                      Win + Shift + S
                    </kbd>{" "}
                    para capturar a tela, depois{" "}
                    <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
                      Ctrl + V
                    </kbd>{" "}
                    para colar aqui.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Separator className="w-12" />
                  <span className="text-xs text-muted-foreground">ou</span>
                  <Separator className="w-12" />
                </div>
                <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                  Selecionar arquivo
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFileSelect}
                  aria-label="Selecionar imagem do computador"
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Preview da imagem */}
        {previewUrl && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Preview da imagem</CardTitle>
                <Button variant="ghost" size="sm" onClick={handleClear}>
                  Limpar
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-hidden rounded-md border border-border">
                <img
                  src={previewUrl}
                  alt="Preview da questão a ser extraída"
                  className="max-h-[400px] w-full object-contain bg-muted/30"
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Metadados opcionais */}
        {previewUrl && !result && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Metadados (opcional)</CardTitle>
              <CardDescription>
                Informar a banca e o ano ajuda o extrator a identificar melhor o formato da questão.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="meta-examBoard">Banca</Label>
                  <Input
                    id="meta-examBoard"
                    placeholder="Ex: CESPE"
                    value={examBoard}
                    onChange={(e) => setExamBoard(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="meta-contestName">Concurso</Label>
                  <Input
                    id="meta-contestName"
                    placeholder="Ex: AFRFB 2023"
                    value={contestName}
                    onChange={(e) => setContestName(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="meta-year">Ano</Label>
                  <Input
                    id="meta-year"
                    placeholder="Ex: 2024"
                    value={year}
                    onChange={(e) => setYear(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="meta-position">Cargo</Label>
                  <Input
                    id="meta-position"
                    placeholder="Ex: Auditor Fiscal"
                    value={position}
                    onChange={(e) => setPosition(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="meta-organization">Órgão</Label>
                  <Input
                    id="meta-organization"
                    placeholder="Ex: Receita Federal"
                    value={organization}
                    onChange={(e) => setOrganization(e.target.value)}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Botão processar */}
        {previewUrl && !result && (
          <div className="flex justify-end">
            <Button onClick={handleProcess} disabled={isProcessing}>
              {isProcessing ? "Processando…" : "Processar imagem"}
            </Button>
          </div>
        )}

        {/* Estado de carregamento */}
        {isProcessing && (
          <Card>
            <CardContent className="py-8">
              <div className="flex flex-col items-center justify-center gap-3 text-center">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                <p className="text-sm text-muted-foreground">
                  Extraindo questões da imagem com IA…
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Resultado */}
        {result && <ExtractionResultView result={result} onClear={handleClear} />}
      </div>
    </AppShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// VISUALIZAÇÃO DO RESULTADO
// ─────────────────────────────────────────────────────────────────────────────

function ExtractionResultView({
  result,
  onClear,
}: {
  result: ExtractAndCreateResult;
  onClear: () => void;
}) {
  const { extraction, created, creationErrors } = result;
  const hasQuestions = extraction.questions.length > 0;
  const hasErrors = extraction.errors.length > 0;
  const hasCreationErrors = creationErrors.length > 0;

  return (
    <div className="space-y-4">
      {/* Resumo */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Resultado da extração</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Badge variant={extraction.success ? "default" : "destructive"}>
              {extraction.success ? "Extração bem-sucedida" : "Falha na extração"}
            </Badge>
            <Badge variant="outline">{extraction.totalExtracted} questão(ões) extraída(s)</Badge>
            <Badge variant="outline">
              Confiança: {(extraction.overallConfidence * 100).toFixed(0)}% (
              {extraction.confidenceLevel})
            </Badge>
            {created.length > 0 && (
              <Badge variant="default">{created.length} salva(s) no banco</Badge>
            )}
            {hasCreationErrors && (
              <Badge variant="destructive">{creationErrors.length} erro(s) ao salvar</Badge>
            )}
          </div>

          {/* Erros de extração */}
          {hasErrors && (
            <div className="space-y-1">
              <p className="text-sm font-medium text-destructive">Erros de extração:</p>
              <ul className="list-inside list-disc space-y-0.5">
                {extraction.errors.map((err, i) => (
                  <li key={i} className="text-sm text-destructive">
                    [{err.code}] {err.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Erros de criação */}
          {hasCreationErrors && (
            <div className="space-y-1">
              <p className="text-sm font-medium text-destructive">Erros ao salvar:</p>
              <ul className="list-inside list-disc space-y-0.5">
                {creationErrors.map((err, i) => (
                  <li key={i} className="text-sm text-destructive">
                    {err.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Warnings */}
          {extraction.warnings.length > 0 && (
            <div className="space-y-1">
              <p className="text-sm font-medium text-yellow-600 dark:text-yellow-400">Avisos:</p>
              <ul className="list-inside list-disc space-y-0.5">
                {extraction.warnings.map((w, i) => (
                  <li key={i} className="text-sm text-yellow-600 dark:text-yellow-400">
                    {w.field}: {w.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Questões extraídas */}
      {hasQuestions && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-foreground">
            Questões extraídas ({extraction.questions.length})
          </h3>
          {extraction.questions.map((eq, idx) => {
            const wasSaved = created.some((c) => c.statement === eq.statement);
            return (
              <Card key={eq.extractionId ?? idx}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-sm font-semibold leading-relaxed">
                      {idx + 1}. {eq.statement}
                    </CardTitle>
                    <Badge variant={wasSaved ? "default" : "destructive"} className="shrink-0">
                      {wasSaved ? "Salva" : "Não salva"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {/* Alternativas */}
                  {eq.alternatives && eq.alternatives.length > 0 && (
                    <div className="space-y-1">
                      {eq.alternatives.map((alt, altIdx) => (
                        <div
                          key={altIdx}
                          className={`flex items-start gap-2 rounded px-2 py-1 text-sm ${
                            alt.isCorrect === true
                              ? "bg-green-500/10 text-green-700 dark:text-green-400"
                              : ""
                          }`}
                        >
                          <span className="font-mono text-xs font-semibold text-muted-foreground">
                            {alt.letter})
                          </span>
                          <span>{alt.text}</span>
                          {alt.isCorrect === true && (
                            <Badge variant="outline" className="ml-auto text-xs">
                              Correta
                            </Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Metadados da questão */}
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {eq.correctAnswer && (
                      <Badge variant="outline" className="text-xs">
                        Gabarito: {eq.correctAnswer}
                      </Badge>
                    )}
                    {eq.isTrueFalse && (
                      <Badge variant="secondary" className="text-xs">
                        V/F
                      </Badge>
                    )}
                    {eq.difficulty !== null && (
                      <Badge variant="secondary" className="text-xs">
                        Dificuldade: {eq.difficulty}
                      </Badge>
                    )}
                    {eq.subjectLabel && (
                      <Badge variant="outline" className="text-xs">
                        {eq.subjectLabel}
                      </Badge>
                    )}
                    {eq.topicLabel && (
                      <Badge variant="outline" className="text-xs">
                        {eq.topicLabel}
                      </Badge>
                    )}
                    {eq.contestMetadata?.examBoard && (
                      <Badge variant="outline" className="text-xs">
                        {eq.contestMetadata.examBoard}
                      </Badge>
                    )}
                    {eq.contestMetadata?.year && (
                      <Badge variant="outline" className="text-xs">
                        {eq.contestMetadata.year}
                      </Badge>
                    )}
                    <Badge variant="outline" className="text-xs">
                      Confiança: {(eq.extractionConfidence * 100).toFixed(0)}%
                    </Badge>
                    {eq.tags &&
                      eq.tags.map((tag) => (
                        <Badge key={tag} variant="outline" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                  </div>

                  {/* Explicação */}
                  {eq.explanation && (
                    <div className="rounded border border-border bg-muted/30 px-3 py-2">
                      <p className="text-xs font-medium text-muted-foreground">Explicação:</p>
                      <p className="text-sm text-foreground">{eq.explanation}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Ações */}
      <div className="flex justify-end gap-3 pt-2">
        <Button variant="outline" onClick={onClear}>
          Importar outra imagem
        </Button>
      </div>
    </div>
  );
}
