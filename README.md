# Fiscal Mastermind

APROVADO FISCAL — PROMPT 01

FUNDAÇÃO TÉCNICA E ARQUITETURA DO SISTEMA

Quero iniciar a construção do APROVADO FISCAL, uma plataforma pessoal de preparação para concursos fiscais, orientada por dados, resolução de questões, recuperação ativa, revisão adaptativa e inteligência artificial.

⚠️ REGRA FUNDAMENTAL DESTA ETAPA

Nesta primeira etapa, NÃO quero construir o sistema inteiro.

O objetivo é criar uma fundação técnica sólida, organizada, segura e escalável, preparada para receber os módulos inteligentes nas próximas etapas.

Não avance automaticamente para a Etapa 2.

Não implemente funcionalidades que não estejam explicitamente solicitadas neste prompt.

Ao finalizar, faça uma auditoria técnica e aguarde minha aprovação.

1. VISÃO DO PRODUTO

O APROVADO FISCAL não será simplesmente:

um banco de questões;

um aplicativo de flashcards;

uma agenda de estudos;

uma biblioteca de PDFs;

um chatbot de IA.

O objetivo é construir um sistema que futuramente conecte:

CONCURSO → EDITAL → MATÉRIA → TÓPICO → CONCEITO → PRÉ-REQUISITO → FONTE → QUESTÃO → RESPOSTA → ERRO → DIAGNÓSTICO → INTERVENÇÃO → REVISÃO → RETENÇÃO → DESEMPENHO → PLANO

O Coach de IA será construído posteriormente sobre essa estrutura.

2. STACK E ARQUITETURA

Utilize uma arquitetura moderna, modular e escalável.

Priorizar:

React;

TypeScript;

Supabase;

PostgreSQL;

autenticação segura;

Row Level Security (RLS);

componentes reutilizáveis;

separação adequada entre apresentação, lógica e dados;

código limpo e organizado.

A aplicação deve nascer preparada para funcionar como Web App/PWA, com boa experiência em:

desktop;

notebook;

tablet;

celular.

Não criar aplicativos nativos separados nesta etapa.

3. AUTENTICAÇÃO

Implementar autenticação individual.

Deve existir:

cadastro;

login;

logout;

recuperação de senha;

sessão persistente;

proteção das rotas privadas.

Criar estrutura de perfil vinculada ao usuário autenticado.

A arquitetura deve ser preparada para futura expansão para múltiplos usuários.

4. PERFIL DO USUÁRIO

Criar uma estrutura de perfil relacionada ao usuário autenticado.

Preparar campos para:

nome;

preferências;

área de concursos;

nível de experiência;

disponibilidade semanal;

fuso horário;

intensidade do Coach;

nível de autonomia do Coach;

configurações;

created_at;

updated_at.

Não implementar ainda a lógica do Coach.

5. CONCURSOS

Criar entidade para concursos.

Um usuário poderá acompanhar vários concursos simultaneamente.

Preparar campos para:

id;

nome;

órgão;

cargo;

área;

banca;

data da prova;

status;

descrição;

fonte do edital;

created_at;

updated_at.

Status possíveis:

futuro;

ativo;

concluído;

arquivado.

O sistema NÃO deve assumir que existe apenas um concurso por usuário.

6. EDITAIS

Criar estrutura de editais relacionada aos concursos.

Permitir futuramente:

edital original;

retificações;

versões posteriores.

Campos preparados para:

versão;

data;

fonte;

arquivo;

URL;

conteúdo processado;

status;

observações;

created_at;

updated_at.

A arquitetura deverá permitir posteriormente comparar versões e identificar:

conteúdo adicionado;

conteúdo removido;

conteúdo alterado.

Não implementar essa inteligência agora.

7. MATÉRIAS

Criar entidade global de matérias.

Exemplos:

Língua Portuguesa;

Direito Constitucional;

Direito Administrativo;

Direito Tributário;

Contabilidade;

Matemática;

Raciocínio Lógico-Matemático;

Estatística;

Tecnologia da Informação;

outras.

Uma matéria deve existir independentemente de um concurso.

Isso é importante porque o conhecimento adquirido pelo usuário deve ser reutilizável em concursos diferentes.

8. TÓPICOS

Criar entidade de tópicos vinculada às matérias.

Permitir estrutura hierárquica:

MATÉRIA → TÓPICO → SUBTÓPICO → CONCEITO

A profundidade não deve ser rigidamente limitada.

Exemplo:

Direito Tributário
→ Crédito Tributário
→ Lançamento
→ Modalidades de lançamento

9. CONCURSO × MATÉRIA × TÓPICO

Um mesmo tópico poderá aparecer em vários concursos.

Não duplicar desnecessariamente o conhecimento.

Criar relacionamento que permita registrar que determinado tópico:

aparece em determinado edital;

possui determinada prioridade;

possui determinado peso;

está previsto;

foi estudado;

possui observações específicas naquele concurso.

Preparar campos para futura análise de incidência e relevância.

10. PRÉ-REQUISITOS

Criar estrutura para relacionamentos de dependência entre conceitos/tópicos.

Isso será especialmente importante para exatas.

Exemplo:

Operações básicas
→ Frações
→ Razão e proporção
→ Porcentagem
→ Equações
→ Funções
→ Matemática Financeira

IMPORTANTE:

Essa lógica será utilizada principalmente para matérias quantitativas/exatas.

Não obrigar todas as matérias teóricas a possuir pré-requisitos.

Posteriormente o Coach poderá identificar:

"O erro em um conteúdo avançado provavelmente possui origem em uma lacuna básica."

11. CONHECIMENTO REUTILIZÁVEL

A arquitetura deve separar:

CONHECIMENTO DO USUÁRIO

de:

CONTEXTO DO CONCURSO

Exemplo:

O usuário pode dominar "Porcentagem" enquanto estuda para uma SEFAZ.

Se depois estudar para a Receita Federal, o mesmo conhecimento deve poder ser reutilizado.

Não criar cópias independentes do mesmo conhecimento para cada concurso.

12. FONTES E MATERIAIS

Criar entidade genérica para fontes.

Preparar suporte para:

PDF;

vídeo;

YouTube;

livro;

legislação;

jurisprudência;

prova;

questão;

anotação;

site;

documento;

material próprio.

Preparar campos para:

título;

tipo;

origem;

autor;

URL;

arquivo;

data;

matéria;

tópico;

concurso;

confiabilidade;

status de processamento;

data de processamento;

metadados.

Posteriormente será implementada uma hierarquia contextual de fontes.

13. QUESTÕES

Criar estrutura inicial para questões.

Não implementar ainda o motor completo de resolução.

Preparar campos para:

enunciado;

alternativas;

resposta correta;

banca;

concurso;

ano;

matéria;

tópico;

dificuldade;

fonte;

explicação/comentário;

imagem;

origem;

created_at;

updated_at.

Preparar suporte futuro para classificação:

conhecida;

nova;

inédita;

variação.

14. ORIGEM DA QUESTÃO

Registrar a origem da questão.

Possíveis origens:

banco externo;

cadastrada manualmente;

print/OCR;

prova oficial;

gerada por IA;

variação gerada pelo sistema.

Não implementar OCR ou geração de questões agora.

Somente preparar a estrutura.

15. HISTÓRICO DE RESOLUÇÃO

Criar estrutura para registrar futuramente cada tentativa.

Preparar campos para:

usuário;

questão;

resposta escolhida;

acerto/erro;

tempo;

confiança declarada;

data;

modo de resolução;

número da tentativa;

observações.

Essa estrutura será usada posteriormente para calcular:

domínio;

retenção;

velocidade;

consistência;

transferência;

padrões de erro.

16. CENTRAL DE ERROS

Criar estrutura para registrar erros separadamente do histórico bruto de resolução.

Preparar classificações futuras:

conhecimento;

esquecimento;

interpretação;

cálculo;

atenção;

estratégia;

velocidade;

outros.

Permitir relacionamento futuro com:

questão;

tópico;

conceito;

intervenção;

revisão.

Não implementar ainda o diagnóstico inteligente.

17. FLASHCARDS

Criar estrutura inicial de flashcards.

Preparar campos para:

frente;

verso;

tipo;

tópico;

matéria;

fonte;

usuário;

dificuldade;

tags;

origem;

created_at;

updated_at.

Preparar suporte futuro para:

pergunta/resposta;

cloze;

contraste;

pegadinha;

recuperação ativa.

Não implementar ainda o algoritmo adaptativo.

18. MATERIAIS GERADOS

Criar estrutura para materiais gerados pelo sistema:

resumos;

mapas mentais;

mnemônicos;

PDFs;

materiais de revisão.

Relacionar futuramente com:

usuário;

concurso;

matéria;

tópico;

fontes utilizadas.

19. SESSÕES DE ESTUDO

Criar estrutura para registrar sessões.

Preparar:

usuário;

data;

início;

término;

tempo bruto;

tempo líquido;

matéria;

tópico;

atividade;

quantidade de questões;

acertos;

erros.

Isso servirá posteriormente para o cronômetro e métricas de horas líquidas.

20. PLANO DE ESTUDOS

Criar estrutura inicial para:

planos;

blocos;

tarefas;

matérias;

tópicos;

datas;

duração planejada;

duração realizada;

status.

Preparar para futura recalibração automática.

Não implementar ainda o algoritmo adaptativo.

21. REVISÕES

Criar estrutura inicial para eventos de revisão.

Preparar:

usuário;

conteúdo;

tópico;

flashcard;

questão;

data prevista;

data realizada;

resultado;

dificuldade;

intervalo;

próxima revisão.

Não implementar ainda o algoritmo de curva de esquecimento.

22. DASHBOARD

Criar somente a estrutura inicial.

Preparar áreas para:

concurso ativo;

progresso;

plano do dia;

horas estudadas;

questões;

revisões;

erros;

domínio;

prontidão.

Não inventar métricas ou dados fictícios.

23. NAVEGAÇÃO

Criar navegação principal preparada para:

Dashboard;

Meus Concursos;

Plano;

Questões;

Revisões;

Flashcards;

Biblioteca;

Materiais;

Central de Erros;

Simulados;

Coach;

Relatórios;

Configurações.

Módulos ainda não implementados podem permanecer bloqueados, ocultos ou identificados como "em breve".

Não criar telas falsas repletas de informações fictícias.

24. DESIGN SYSTEM

Criar um design system consistente.

O APROVADO FISCAL deve transmitir:

foco;

inteligência;

performance;

organização;

estudo sério.

Evitar:

gamificação infantil;

excesso de cores;

dashboards poluídos;

excesso de cards;

elementos decorativos sem função.

Priorizar:

hierarquia visual;

legibilidade;

velocidade;

acessibilidade;

responsividade.

Criar componentes reutilizáveis.

25. SEGURANÇA

Implementar RLS corretamente.

Usuários não podem:

consultar dados de outros usuários;

alterar dados de outros usuários;

excluir dados de outros usuários.

Dados globais devem possuir políticas próprias.

Nunca expor chaves secretas no frontend.

26. PREPARAÇÃO PARA IA

Criar uma camada de serviço desacoplada para futuras integrações com IA.

A arquitetura futura deverá permitir separar:

IA RÁPIDA

Operações simples e frequentes.

IA INTELIGENTE

Diagnóstico, planejamento e raciocínio.

IA PROFUNDA

Processamento pesado de documentos, questões, provas e grandes bases.

Preparar suporte futuro para:

cache;

processamento assíncrono;

armazenamento dos resultados;

reutilização de resultados já processados.

Princípio:

PROCESSAR UMA VEZ → ARMAZENAR → REUTILIZAR.

Não implementar ainda chamadas complexas de IA.

27. PERFORMANCE

Desde a fundação:

utilizar índices adequados no PostgreSQL;

paginação;

carregamento sob demanda;

consultas eficientes;

componentes reutilizáveis;

evitar processamento desnecessário;

evitar chamadas repetidas;

evitar carregar grandes volumes no frontend.

28. HISTÓRICO E AUDITORIA

Utilizar:

created_at;

updated_at.

Quando necessário, preservar histórico em vez de sobrescrever dados importantes.

O histórico será essencial para o futuro motor de performance.

29. DADOS DE TESTE

NÃO preencher o sistema com grandes quantidades de dados fictícios.

Se dados de teste forem absolutamente necessários:

utilizar quantidade mínima;

identificá-los claramente;

impedir que contaminem métricas reais.

30. PREPARAÇÃO PARA O GRAFO DE CONHECIMENTO

Não é necessário criar ainda uma visualização gráfica.

Porém, o modelo de dados precisa permitir conexões entre:

Concurso → Edital → Matéria → Tópico → Conceito → Pré-requisito → Fonte → Questão → Tentativa → Erro → Revisão → Flashcard → Sessão → Desempenho

Essa estrutura será a base do futuro Grafo de Conhecimento do APROVADO FISCAL.

31. PREPARAÇÃO PARA O MOTOR DE FUNDAMENTOS DE EXATAS

A estrutura deve permitir posteriormente identificar que determinados conceitos são pré-requisitos de outros.

Exemplo:

Frações
→ Porcentagem
→ Regra de três
→ Equações
→ Matemática Financeira.

Essa lógica será utilizada principalmente nas matérias de exatas.

O sistema deverá futuramente testar a base do usuário antes de simplesmente assumir que ele precisa começar do zero.

Nesta etapa, apenas preparar a arquitetura.

32. NÃO IMPLEMENTAR NESTA ETAPA

Não implementar ainda:

Coach completo;

Professor Socrático;

OCR completo;

geração automática de questões;

geração automática de flashcards;

revisão adaptativa completa;

Central de Erros inteligente;

simulados;

DNA completo do usuário;

inteligência avançada de bancas;

análise estatística de padrões de provas;

pesquisa externa;

processamento avançado de YouTube;

Índice de Prontidão;

Motor de Memorização completo;

integração completa com Anki;

gamificação avançada.

Tudo isso será construído posteriormente.

33. CRITÉRIOS DE CONCLUSÃO

Considere a etapa concluída somente quando:

autenticação funcionar;

RLS estiver funcionando;

banco estiver estruturado;

relacionamentos principais estiverem corretos;

concursos puderem ser cadastrados;

editais puderem ser cadastrados;

matérias puderem ser cadastradas;

tópicos puderem ser cadastrados;

estrutura de pré-requisitos estiver preparada;

estrutura de fontes estiver preparada;

estrutura de questões estiver preparada;

histórico de resolução estiver preparado;

Central de Erros estiver preparada;

flashcards estiverem preparados;

materiais estiverem preparados;

sessões de estudo estiverem preparadas;

plano estiver preparado;

revisões estiverem preparadas;

navegação principal estiver estruturada;

aplicação estiver responsiva;

não existirem dados fictícios contaminando o sistema;

arquitetura estiver preparada para as próximas etapas.

34. AUDITORIA OBRIGATÓRIA

Ao finalizar, NÃO avance para a próxima etapa.

Apresente uma auditoria contendo:

IMPLEMENTADO

O que realmente foi construído.

BANCO DE DADOS

Liste todas as tabelas criadas e suas principais relações.

RLS

Liste as políticas de segurança implementadas.

ARQUITETURA

Explique como a estrutura está preparada para os próximos módulos.

PENDÊNCIAS

Informe qualquer coisa que não tenha sido concluída.

RISCOS

Informe qualquer problema arquitetural ou técnico identificado.

PRÓXIMA ETAPA

Apenas descreva o que deverá ser construído posteriormente.

Não implemente a próxima etapa sem minha aprovação explícita.

REGRA FINAL

Se alguma decisão técnica necessária não estiver especificada neste prompt, escolha a solução mais simples, segura e escalável que preserve a arquitetura futura do APROVADO FISCAL.

Não complique o MVP.

Não crie funcionalidades apenas para "encher" a aplicação.

O objetivo desta etapa é construir uma fundação excelente para um sistema de estudos inteligente, não uma demonstração visual.

Execute somente esta etapa e aguarde minha aprovação.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/a9ac169f-8ba3-4723-951b-bdfb570b8e63).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
